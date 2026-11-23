import pool from '../config/db.js';
import { signMagic } from '../middleware/auth.js';
import { sendLogged } from './whatsapp.js';

// WhatsApp-first, like Waynur: students, parents and teachers get what
// they need on WhatsApp, and every link opens the app already logged in.
// Each function returns counts, and each message is sent at most once per
// person (whatsapp_messages unique index), so it is safe to press again.

const STUDENT_WEAK_BELOW = Number(process.env.LOOP_STUDENT_WEAK_BELOW) || 50;
const appUrl = () => (process.env.APP_URL || 'https://competitive.waynur.com').replace(/\/+$/, '');

export function studentLink(student, centreId, path) {
  return `${appUrl()}/go/${signMagic({ student_id: student.id, centre_id: centreId, path })}`;
}

function tally(results) {
  const out = { sent: 0, failed: 0, skipped: 0, already: 0, no_number: 0 };
  for (const r of results) {
    if (r === 'no_number') out.no_number += 1;
    else if (r.status === 'duplicate') out.already += 1;
    else out[r.status] = (out[r.status] || 0) + 1;
  }
  return out;
}

async function centreName(centreId) {
  return (await pool.query('SELECT name FROM centres WHERE id = $1', [centreId])).rows[0]?.name || 'your centre';
}

/** A published online test → every active student in the batch. */
export async function notifyTestOpen(test) {
  if (test.mode !== 'online') return tally([]);
  const name = await centreName(test.centre_id);
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.phone FROM batch_students bs JOIN students s ON s.id = bs.student_id
      WHERE bs.batch_id = $1 AND s.active ORDER BY s.id`, [test.batch_id]);
  const results = [];
  for (const s of rows) {
    results.push(await sendLogged({
      centreId: test.centre_id, phone: s.phone, kind: 'test_open', refType: 'test', refId: test.id,
      template: 'test_open', params: [s.name, test.title, name, studentLink(s, test.centre_id, `/test/${test.id}`)],
    }));
  }
  return tally(results);
}

/** Practice sets from the next-class plan → each weak student. */
export async function notifyPractice(test) {
  const name = await centreName(test.centre_id);
  const { rows } = await pool.query(
    `SELECT p.id AS set_id, s.id, s.name, s.phone, t.name AS topic
       FROM practice_sets p JOIN interventions i ON i.id = p.intervention_id
       JOIN students s ON s.id = p.student_id JOIN topics t ON t.id = i.topic_id
      WHERE i.test_id = $1 AND p.completed_at IS NULL AND s.active ORDER BY p.id`, [test.id]);
  const results = [];
  for (const r of rows) {
    results.push(await sendLogged({
      centreId: test.centre_id, phone: r.phone, kind: 'practice', refType: 'practice_set', refId: r.set_id,
      template: 'practice', params: [r.name, name, r.topic, studentLink(r, test.centre_id, `/practice/${r.set_id}`)],
    }));
  }
  return tally(results);
}

/** Each submitted attempt → the student's parent (if a parent number is saved). */
export async function notifyParents(test, studentIds = null) {
  const name = await centreName(test.centre_id);
  const { rows: atts } = await pool.query(
    `SELECT a.id, a.score, s.id AS student_id, s.name, s.parent_phone
       FROM attempts a JOIN students s ON s.id = a.student_id
      WHERE a.test_id = $1 AND a.submitted_at IS NOT NULL AND ($2::int[] IS NULL OR a.student_id = ANY($2::int[]))
      ORDER BY a.id`, [test.id, studentIds]);
  const qCount = (await pool.query('SELECT count(*)::int AS n FROM test_questions WHERE test_id = $1', [test.id])).rows[0].n;
  const max = Math.round(qCount * Number(test.marks_correct) * 100) / 100;
  const results = [];
  for (const a of atts) {
    if (!a.parent_phone) { results.push('no_number'); continue; }
    const { rows: topics } = await pool.query(
      `SELECT t.name, round(100.0 * count(*) FILTER (WHERE r.is_correct) / count(*), 1) AS acc
         FROM responses r JOIN questions q ON q.id = r.question_id JOIN topics t ON t.id = q.topic_id
        WHERE r.attempt_id = $1 GROUP BY t.name ORDER BY acc`, [a.id]);
    const weak = topics.filter((t) => Number(t.acc) < STUDENT_WEAK_BELOW).map((t) => t.name);
    results.push(await sendLogged({
      centreId: test.centre_id, phone: a.parent_phone, kind: 'result_parent', refType: 'attempt', refId: a.id,
      template: 'result_parent',
      params: [name, a.name, `${Number(a.score)} / ${max}`, test.title, weak.length ? weak.join(', ') : 'none, well done'],
    }));
  }
  return tally(results);
}

/** The next-class plan → the teacher who made the test. */
export async function notifyTeacher(test) {
  const { rows } = await pool.query('SELECT u.name, u.phone FROM users u WHERE u.id = $1 AND u.active', [test.created_by]);
  const teacher = rows[0];
  if (!teacher?.phone) return tally(['no_number']);
  const name = await centreName(test.centre_id);
  const sub = (await pool.query(
    `SELECT (SELECT count(*)::int FROM attempts WHERE test_id = $1 AND submitted_at IS NOT NULL) AS done,
            (SELECT count(*)::int FROM batch_students WHERE batch_id = $2) AS total`, [test.id, test.batch_id])).rows[0];
  const { rows: re } = await pool.query(
    `SELECT t.name, i.accuracy FROM interventions i JOIN topics t ON t.id = i.topic_id
      WHERE i.test_id = $1 AND i.kind = 'reteach' ORDER BY i.accuracy NULLS LAST`, [test.id]);
  const reteach = re.length ? re.map((r) => `${r.name} (${Math.round(Number(r.accuracy))}%)`).join(', ') : 'nothing, the batch did well';
  return tally([await sendLogged({
    centreId: test.centre_id, phone: teacher.phone, kind: 'teacher_report', refType: 'test', refId: test.id,
    template: 'teacher_report', params: [name, test.title, `${sub.done} of ${sub.total}`, reteach, test.id],
  })]);
}

// Fire-and-forget: WhatsApp must never slow down or break the action the
// teacher/student just took. NOTIFY_SYNC=1 (tests) waits for it instead.
export async function dispatch(fn, what) {
  const run = Promise.resolve().then(fn).catch((err) => console.error(`[notify] ${what} failed:`, err.message));
  if (process.env.NOTIFY_SYNC === '1') await run;
}

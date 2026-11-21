import pool from '../config/db.js';
import { normalizePhone } from './util.js';
import { centreForPhoneNumberId, sendLogged } from './whatsapp.js';
import { diagnose } from './loop.js';
import { createActions, createRetest, ownTest, setTestStatus, testData } from './loopActions.js';
import { notifyPractice, notifyTestOpen, studentLink } from './notify.js';

// Everything that arrives on a centre's WhatsApp number, like Waynur's
// routes/whatsapp.js: the sender's number decides who they are.
//   teacher / owner (users.phone)  → commands: TESTS, REPORT, PLAN, PUBLISH, RETEST
//   student (students.phone)       → their open tests and practice, as links
//   parent (students.parent_phone) → their child's latest results
// Replies are free text: allowed because the person has just messaged us
// (Meta's 24-hour window).

const STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

async function recordStatus(st) {
  if (!STATUS_RANK[st.status]) return;
  const err = st.status === 'failed' ? (st.errors?.[0]?.title || st.errors?.[0]?.message || 'WhatsApp could not deliver this message') : null;
  // Only move forward (sent → delivered → read); "failed" always wins.
  await pool.query(
    `UPDATE whatsapp_messages SET status = $1, error = COALESCE($2, error)
      WHERE wa_message_id = $3 AND (
        $1 = 'failed' OR (CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 9 END) < $4)`,
    [st.status, err, st.id, STATUS_RANK[st.status]]
  );
}

const TEACHER_HELP = [
  'Waynur Competitive commands:',
  'TESTS: your latest tests',
  'REPORT 12: results of test 12 (REPORT alone = latest test)',
  'PLAN 12: make the next-class plan and send practice to weak students',
  'PUBLISH 12: open test 12 and send the link to students',
  'RETEST 12: make a fresh re-test of test 12 and send it to students',
].join('\n');

async function teacherCommand(centre, user, text) {
  const [word, arg] = text.trim().split(/\s+/, 2);
  const cmd = (word || '').toUpperCase();
  const c = centre.centre_id;
  const pickTest = async () => {
    if (arg && /^\d+$/.test(arg)) return ownTest(c, arg);
    const { rows } = await pool.query(`SELECT * FROM tests WHERE centre_id = $1 AND status <> 'draft' ORDER BY created_at DESC LIMIT 1`, [c]);
    if (!rows.length) throw Object.assign(new Error('No published tests yet.'), { status: 400 });
    return rows[0];
  };

  if (cmd === 'TESTS') {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.status, b.name AS batch,
              (SELECT count(*)::int FROM attempts a WHERE a.test_id = t.id AND a.submitted_at IS NOT NULL) AS done,
              (SELECT count(*)::int FROM batch_students bs WHERE bs.batch_id = t.batch_id) AS total
         FROM tests t JOIN batches b ON b.id = t.batch_id WHERE t.centre_id = $1 ORDER BY t.created_at DESC LIMIT 8`, [c]);
    if (!rows.length) return 'No tests yet. Make one in the Waynur Competitive panel.';
    return `Latest tests:\n${rows.map((t) => `#${t.id} ${t.title} (${t.batch}) ${t.status}, ${t.done}/${t.total} done`).join('\n')}\n\nReply REPORT <number> for results.`;
  }
  if (cmd === 'REPORT') {
    const test = await pickTest();
    const d = diagnose(await testData(test));
    const lines = d.topics.map((t) => `${t.reteach ? '⚠️' : '✅'} ${t.name}: ${t.accuracy ?? '-'}% (${t.weak_students.length} weak)`);
    return [`#${test.id} ${test.title}`, `Submitted: ${d.participation.submitted} of ${d.participation.total}`, ...lines,
      d.topics.some((t) => t.reteach) ? `\nReply PLAN ${test.id} to send practice to the weak students.` : ''].join('\n').trim();
  }
  if (cmd === 'PLAN') {
    const test = await pickTest();
    const out = await createActions(c, test);
    const sent = await notifyPractice(test);
    return `Next-class plan for #${test.id} is ready (${out.created} new items). Practice sent to ${sent.sent} students${sent.skipped ? `, ${sent.skipped} not sent` : ''}. See the full plan in the panel.`;
  }
  if (cmd === 'PUBLISH') {
    if (!arg) return 'Send PUBLISH with the test number, e.g. PUBLISH 12';
    let test = await ownTest(c, arg);
    if (test.status !== 'published') test = await setTestStatus(test, 'published');
    const r = await notifyTestOpen(test);
    return `#${test.id} is open. Link sent to ${r.sent} students${r.already ? ` (${r.already} already had it)` : ''}.`;
  }
  if (cmd === 'RETEST') {
    if (!arg) return 'Send RETEST with the original test number, e.g. RETEST 12';
    const out = await createRetest(c, await ownTest(c, arg), user.id);
    const test = await setTestStatus(out.test, 'published');
    const r = await notifyTestOpen(test);
    return `Re-test #${test.id} (${out.questions} fresh questions) is open and sent to ${r.sent} students. When they finish, open it in the panel to see if the plan worked.`;
  }
  return TEACHER_HELP;
}

async function studentReply(centre, student) {
  const c = centre.centre_id;
  const { rows: tests } = await pool.query(
    `SELECT t.id, t.title FROM tests t JOIN batch_students bs ON bs.batch_id = t.batch_id AND bs.student_id = $1
       LEFT JOIN attempts a ON a.test_id = t.id AND a.student_id = $1
      WHERE t.centre_id = $2 AND t.mode = 'online' AND t.status = 'published' AND a.submitted_at IS NULL
      ORDER BY t.created_at DESC LIMIT 5`, [student.id, c]);
  const { rows: sets } = await pool.query(
    `SELECT p.id, t.name AS topic FROM practice_sets p JOIN interventions i ON i.id = p.intervention_id JOIN topics t ON t.id = i.topic_id
      WHERE p.student_id = $1 AND i.centre_id = $2 AND p.completed_at IS NULL ORDER BY p.id DESC LIMIT 5`, [student.id, c]);
  if (!tests.length && !sets.length) {
    return `Hi ${student.name}, no tests or practice are due right now. All your results: ${studentLink(student, c, '/')}`;
  }
  const out = [`Hi ${student.name}, here is what is waiting for you:`];
  for (const t of tests) out.push(`📝 ${t.title}: ${studentLink(student, c, `/test/${t.id}`)}`);
  for (const p of sets) out.push(`🔁 Practice, ${p.topic}: ${studentLink(student, c, `/practice/${p.id}`)}`);
  return out.join('\n');
}

async function parentReply(centre, phone) {
  const { rows: kids } = await pool.query('SELECT id, name FROM students WHERE centre_id = $1 AND parent_phone = $2 AND active ORDER BY name', [centre.centre_id, phone]);
  const out = [];
  for (const k of kids) {
    const { rows } = await pool.query(
      `SELECT t.title, a.score, t.marks_correct, (SELECT count(*)::int FROM test_questions q WHERE q.test_id = t.id) AS qs, a.submitted_at
         FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.student_id = $1 AND a.submitted_at IS NOT NULL
        ORDER BY a.submitted_at DESC LIMIT 3`, [k.id]);
    out.push(`${k.name}:`);
    if (!rows.length) out.push('  No results yet.');
    for (const r of rows) {
      const date = new Date(r.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
      out.push(`  ${r.title}: ${Number(r.score)} / ${Math.round(r.qs * Number(r.marks_correct) * 100) / 100} (${date})`);
    }
  }
  return `Latest results from ${centre.name}\n${out.join('\n')}`;
}

async function handleMessage(centre, msg) {
  const phone = normalizePhone(msg.from);
  const c = centre.centre_id;
  const text = msg.type === 'text' ? String(msg.text?.body || '') : String(msg[msg.type]?.caption || msg.button?.text || msg.interactive?.button_reply?.title || '');
  if (!phone) return;
  // Meta re-sends a webhook it thinks we missed; answer each message once.
  if (msg.id && (await pool.query(`SELECT 1 FROM whatsapp_messages WHERE direction = 'in' AND wa_message_id = $1`, [msg.id])).rowCount) return;
  await pool.query(
    `INSERT INTO whatsapp_messages (centre_id, direction, phone, kind, body, status, wa_message_id) VALUES ($1,'in',$2,'inbound',$3,'received',$4)`,
    [c, phone, text.slice(0, 2000) || `[${msg.type}]`, msg.id || null]);

  let reply;
  try {
    const user = (await pool.query('SELECT id, name, role FROM users WHERE centre_id = $1 AND phone = $2 AND active LIMIT 1', [c, phone])).rows[0];
    const student = !user && (await pool.query('SELECT id, name FROM students WHERE centre_id = $1 AND phone = $2 AND active', [c, phone])).rows[0];
    const isParent = !user && !student
      && (await pool.query('SELECT 1 FROM students WHERE centre_id = $1 AND parent_phone = $2 AND active LIMIT 1', [c, phone])).rowCount;
    if (user) reply = text.trim() ? await teacherCommand(centre, user, text) : TEACHER_HELP;
    else if (student) reply = await studentReply(centre, student);
    else if (isParent) reply = await parentReply(centre, phone);
    else reply = `This number is not registered at ${centre.name}. Please ask the centre to add it.`;
  } catch (err) {
    reply = err.status && err.status < 500 ? err.message : 'Something went wrong. Please try again, or use the Waynur Competitive panel.';
    if (!(err.status < 500)) console.error('[waInbound]', err);
  }
  await sendLogged({ centreId: c, phone, kind: 'reply', text: reply });
}

/** Processes one webhook POST body from Meta. */
export async function processWebhook(body) {
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const centre = await centreForPhoneNumberId(v.metadata?.phone_number_id);
      if (!centre || centre.status !== 'active') continue;
      for (const st of v.statuses || []) await recordStatus(st);
      for (const msg of v.messages || []) await handleMessage(centre, msg);
    }
  }
}

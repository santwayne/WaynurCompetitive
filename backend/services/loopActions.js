import pool from '../config/db.js';
import { bad, intId, notFound } from './util.js';
import { buildParallel, diagnose, pickPractice, planInterventions } from './loop.js';
import { rewriteActions } from './aiLoop.js';

// The Loop's actions, shared by the web panel (routes/tests.js) and the
// teacher's WhatsApp commands (services/waInbound.js), so both behave the same.

export async function ownTest(centreId, testId) {
  const { rows } = await pool.query('SELECT * FROM tests WHERE id = $1 AND centre_id = $2', [intId(testId, 'test'), centreId]);
  if (!rows.length) throw notFound('Test not found');
  return rows[0];
}

export async function approvedBank(centreId, topicIds) {
  const { rows } = await pool.query(
    `SELECT id, topic_id FROM questions WHERE centre_id = $1 AND status = 'approved' AND topic_id = ANY($2::int[])`,
    [centreId, topicIds]
  );
  const byTopic = new Map();
  for (const q of rows) byTopic.set(q.topic_id, [...(byTopic.get(q.topic_id) || []), q]);
  return byTopic;
}

export async function insertTest(client, fields, questionIds) {
  const { rows } = await client.query(
    `INSERT INTO tests (centre_id, batch_id, title, kind, mode, parent_test_id, duration_min, marks_correct, marks_wrong, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [fields.centre_id, fields.batch_id, fields.title, fields.kind, fields.mode, fields.parent_test_id ?? null,
      fields.duration_min, fields.marks_correct, fields.marks_wrong, fields.created_by]
  );
  const test = rows[0];
  for (const [i, qid] of questionIds.entries()) {
    await client.query('INSERT INTO test_questions (test_id, question_id, position) VALUES ($1,$2,$3)', [test.id, qid, i + 1]);
  }
  return test;
}

// Everything diagnose() needs for one test. onlyStudents narrows to a set of ids.
export async function testData(test, onlyStudents = null) {
  const [students, questions, attempts] = await Promise.all([
    pool.query(`SELECT s.id, s.name FROM batch_students bs JOIN students s ON s.id = bs.student_id WHERE bs.batch_id = $1`, [test.batch_id]),
    pool.query(`SELECT q.id, q.topic_id FROM test_questions tq JOIN questions q ON q.id = tq.question_id WHERE tq.test_id = $1 ORDER BY tq.position`, [test.id]),
    pool.query(`SELECT a.id, a.student_id, a.score FROM attempts a WHERE a.test_id = $1 AND a.submitted_at IS NOT NULL`, [test.id]),
  ]);
  const topicIds = [...new Set(questions.rows.map((q) => q.topic_id))];
  const topics = await pool.query('SELECT id, name, subject FROM topics WHERE id = ANY($1::int[])', [topicIds]);
  const keep = onlyStudents ? new Set(onlyStudents) : null;
  const atts = attempts.rows.filter((a) => !keep || keep.has(a.student_id));
  const resp = atts.length
    ? (await pool.query('SELECT attempt_id, question_id, chosen_index, is_correct FROM responses WHERE attempt_id = ANY($1::int[])', [atts.map((a) => a.id)])).rows
    : [];
  const byAttempt = new Map();
  for (const r of resp) byAttempt.set(r.attempt_id, [...(byAttempt.get(r.attempt_id) || []), r]);
  return {
    students: students.rows.filter((s) => !keep || keep.has(s.id)),
    questions: questions.rows,
    topics: topics.rows,
    attempts: atts.map((a) => ({ student_id: a.student_id, score: Number(a.score), responses: byAttempt.get(a.id) || [] })),
  };
}

const STATUS_MOVES = { draft: ['published'], published: ['closed'], closed: ['published'] };
export async function setTestStatus(test, next) {
  if (!STATUS_MOVES[test.status]?.includes(next)) throw bad(`A ${test.status} test can't be moved to ${next}`);
  await pool.query('UPDATE tests SET status = $1 WHERE id = $2', [next, test.id]);
  return { ...test, status: next };
}

/** Diagnosis → next-class actions + per-student practice sets. Safe to run twice. */
export async function createActions(centreId, test) {
  const data = await testData(test);
  const diag = diagnose(data);
  if (!diag.participation.submitted) throw bad('No one has submitted this test yet');
  let plan = planInterventions(diag);
  plan = await rewriteActions(centreId, plan, diag); // AI wording if configured; numbers stay ours
  const used = data.questions.map((q) => q.id);
  const bank = await approvedBank(centreId, [...new Set(plan.map((p) => p.topic_id))]);
  let created = 0;
  let practiceSets = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of plan) {
      const ins = await client.query(
        `INSERT INTO interventions (centre_id, test_id, topic_id, kind, accuracy, note) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (test_id, topic_id, kind) DO NOTHING RETURNING id`,
        [centreId, test.id, item.topic_id, item.kind, item.accuracy, item.note]
      );
      if (!ins.rowCount) continue;
      created += 1;
      for (const studentId of item.students) {
        const ids = pickPractice(bank.get(item.topic_id) || [], used);
        if (!ids.length) continue;
        await client.query('INSERT INTO practice_sets (intervention_id, student_id, question_ids) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [ins.rows[0].id, studentId, ids]);
        practiceSets += 1;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { created, practice_sets: practiceSets, diagnosis: diag };
}

/** A parallel re-test: same topics, same count per topic, fresh approved questions. Draft. */
export async function createRetest(centreId, test, userId) {
  if (test.kind === 'retest') throw bad('Make the re-test from the original test');
  const { rows: qs } = await pool.query(
    `SELECT q.id, q.topic_id FROM test_questions tq JOIN questions q ON q.id = tq.question_id WHERE tq.test_id = $1`, [test.id]);
  const bank = await approvedBank(centreId, [...new Set(qs.map((q) => q.topic_id))]);
  const { questionIds, short } = buildParallel(qs, bank);
  if (!questionIds.length) throw bad('No fresh approved questions in these topics. Add more to the bank first.');
  const retest = await insertTest(pool, {
    ...test, title: `Re-test: ${test.title}`.slice(0, 160), kind: 'retest', parent_test_id: test.id, created_by: userId,
  }, questionIds);
  return { test: retest, questions: questionIds.length, short };
}

import { Router } from 'express';
import pool from '../config/db.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { ownBatch } from './centre.js';
import { bad, intId, notFound, route, text } from '../services/util.js';
import {
  buildParallel, commonStudents, compareTopics, diagnose, pickPractice, planInterventions, scoreResponses,
} from '../services/loop.js';
import { rewriteActions } from '../services/aiLoop.js';

const router = Router();
router.use(requireAuth, requireStaff);

async function ownTest(centreId, testId) {
  const { rows } = await pool.query('SELECT * FROM tests WHERE id = $1 AND centre_id = $2', [intId(testId, 'test'), centreId]);
  if (!rows.length) throw notFound('Test not found');
  return rows[0];
}

async function approvedBank(centreId, topicIds) {
  const { rows } = await pool.query(
    `SELECT id, topic_id FROM questions WHERE centre_id = $1 AND status = 'approved' AND topic_id = ANY($2::int[])`,
    [centreId, topicIds]
  );
  const byTopic = new Map();
  for (const q of rows) byTopic.set(q.topic_id, [...(byTopic.get(q.topic_id) || []), q]);
  return byTopic;
}

async function insertTest(client, fields, questionIds) {
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

// POST /api/tests — create a draft test.
//  { batchId, title, kind: 'exit_ticket'|'scheduled', mode: 'online'|'paper',
//    picks: [{ topicId, count }]  OR  questionIds: [..],
//    durationMin?, marksCorrect?, marksWrong? }   (defaults come from the batch's exam pattern)
router.post('/', route(async (req, res) => {
  const b = req.body;
  const batch = await ownBatch(req.user.centre_id, b.batchId);
  if (!['exit_ticket', 'scheduled'].includes(b.kind)) throw bad('Kind must be exit_ticket or scheduled');
  const { kind } = b;
  const mode = b.mode === 'paper' ? 'paper' : 'online';

  let questionIds = [];
  if (Array.isArray(b.questionIds) && b.questionIds.length) {
    questionIds = [...new Set(b.questionIds.map((x) => intId(x, 'question')))];
    const ok = await pool.query(
      `SELECT count(*)::int AS n FROM questions WHERE centre_id = $1 AND status = 'approved' AND id = ANY($2::int[])`,
      [req.user.centre_id, questionIds]
    );
    if (ok.rows[0].n !== questionIds.length) throw bad('Every question must be an approved question from your bank');
  } else if (Array.isArray(b.picks) && b.picks.length) {
    const picks = b.picks.map((p) => ({ topicId: intId(p.topicId, 'topic'), count: intId(p.count, 'count') }));
    const bank = await approvedBank(req.user.centre_id, picks.map((p) => p.topicId));
    for (const p of picks) {
      const avail = bank.get(p.topicId) || [];
      if (avail.length < p.count) throw bad(`Only ${avail.length} approved question(s) in one of the topics, you asked for ${p.count}`);
      questionIds.push(...pickPractice(avail, [], p.count));
    }
  } else {
    throw bad('Pick topics or questions for the test');
  }
  if (questionIds.length > 200) throw bad('Up to 200 questions per test');

  const pattern = batch.exam_pattern_id
    ? (await pool.query('SELECT duration_min, marks_correct, marks_wrong FROM exam_patterns WHERE id = $1', [batch.exam_pattern_id])).rows[0]
    : null;
  const num = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : Number(v));
  const fields = {
    centre_id: req.user.centre_id,
    batch_id: batch.id,
    title: text(b.title, 'Title', { max: 160 }),
    kind,
    mode,
    duration_min: num(b.durationMin, kind === 'exit_ticket' ? 10 : pattern?.duration_min ?? 60),
    marks_correct: num(b.marksCorrect, pattern?.marks_correct ?? 1),
    marks_wrong: num(b.marksWrong, pattern?.marks_wrong ?? 0),
    created_by: req.user.user_id,
  };
  if (!(fields.duration_min > 0) || !(fields.marks_correct > 0) || !(fields.marks_wrong >= 0)) throw bad('Check duration and marks');
  const test = await insertTest(pool, fields, questionIds);
  res.status(201).json({ test, questions: questionIds.length });
}));

router.get('/:id', route(async (req, res) => {
  const test = await ownTest(req.user.centre_id, req.params.id);
  const { rows: questions } = await pool.query(
    `SELECT q.id, q.stem, q.options, q.correct_index, q.explanation, q.topic_id, t.name AS topic, t.subject, tq.position
       FROM test_questions tq JOIN questions q ON q.id = tq.question_id JOIN topics t ON t.id = q.topic_id
      WHERE tq.test_id = $1 ORDER BY tq.position`, [test.id]
  );
  const { rows: attempts } = await pool.query(
    `SELECT a.student_id, s.name, a.source, a.score, a.submitted_at FROM attempts a JOIN students s ON s.id = a.student_id
      WHERE a.test_id = $1 ORDER BY s.name`, [test.id]
  );
  res.json({ test, questions, attempts });
}));

router.post('/:id/status', route(async (req, res) => {
  const test = await ownTest(req.user.centre_id, req.params.id);
  const next = req.body.status;
  const allowed = { draft: ['published'], published: ['closed'], closed: ['published'] };
  if (!allowed[test.status]?.includes(next)) throw bad(`A ${test.status} test can't be moved to ${next}`);
  await pool.query('UPDATE tests SET status = $1 WHERE id = $2', [next, test.id]);
  res.json({ ok: true, status: next });
}));

// POST /api/tests/:id/paper — marks from a paper test.
//  { results: [{ studentId, answers: [chosenIndex | null, …] }] }  answers follow the test's question order.
router.post('/:id/paper', route(async (req, res) => {
  const test = await ownTest(req.user.centre_id, req.params.id);
  const { rows: qs } = await pool.query(
    `SELECT q.id, q.correct_index, jsonb_array_length(q.options) AS n FROM test_questions tq JOIN questions q ON q.id = tq.question_id
      WHERE tq.test_id = $1 ORDER BY tq.position`, [test.id]
  );
  const roster = new Set((await pool.query('SELECT student_id FROM batch_students WHERE batch_id = $1', [test.batch_id])).rows.map((r) => r.student_id));
  const results = Array.isArray(req.body.results) ? req.body.results : [];
  if (!results.length) throw bad('No results to save');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of results) {
      const studentId = intId(r.studentId, 'student');
      if (!roster.has(studentId)) throw bad(`Student ${studentId} is not in this batch`);
      if (!Array.isArray(r.answers) || r.answers.length !== qs.length) throw bad(`Give ${qs.length} answers per student (null for skipped)`);
      const responses = qs.map((q, i) => {
        const v = r.answers[i];
        const chosen = v === null || v === '' || v === undefined ? null : Number(v);
        if (chosen !== null && (!Number.isInteger(chosen) || chosen < 0 || chosen >= q.n)) throw bad(`Answer ${i + 1} for student ${studentId} is not a valid option`);
        return { question_id: q.id, chosen_index: chosen, is_correct: chosen === q.correct_index };
      });
      const score = scoreResponses(responses, test.marks_correct, test.marks_wrong);
      const a = await client.query(
        `INSERT INTO attempts (test_id, student_id, source, submitted_at, score) VALUES ($1,$2,'paper',now(),$3)
         ON CONFLICT (test_id, student_id) DO UPDATE SET source = 'paper', submitted_at = now(), score = EXCLUDED.score
         RETURNING id`, [test.id, studentId, score]
      );
      await client.query('DELETE FROM responses WHERE attempt_id = $1', [a.rows[0].id]);
      for (const x of responses) {
        await client.query('INSERT INTO responses (attempt_id, question_id, chosen_index, is_correct) VALUES ($1,$2,$3,$4)',
          [a.rows[0].id, x.question_id, x.chosen_index, x.is_correct]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json({ saved: results.length });
}));

// Everything diagnose() needs for one test. onlyStudents narrows to a set of ids.
async function testData(test, onlyStudents = null) {
  const [students, questions, attempts] = await Promise.all([
    pool.query(`SELECT s.id, s.name FROM batch_students bs JOIN students s ON s.id = bs.student_id WHERE bs.batch_id = $1`, [test.batch_id]),
    pool.query(`SELECT q.id, q.topic_id FROM test_questions tq JOIN questions q ON q.id = tq.question_id WHERE tq.test_id = $1 ORDER BY tq.position`, [test.id]),
    pool.query(
      `SELECT a.id, a.student_id, a.score FROM attempts a WHERE a.test_id = $1 AND a.submitted_at IS NOT NULL`, [test.id]),
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

router.get('/:id/diagnosis', route(async (req, res) => {
  const test = await ownTest(req.user.centre_id, req.params.id);
  const diag = diagnose(await testData(test));
  res.json({ test, diagnosis: diag, plan: planInterventions(diag) });
}));

// POST /api/tests/:id/actions — turn the diagnosis into the next-class action
// list and per-student practice sets. Safe to press twice: existing items are kept.
router.post('/:id/actions', route(async (req, res) => {
  const test = await ownTest(req.user.centre_id, req.params.id);
  const data = await testData(test);
  const diag = diagnose(data);
  if (!diag.participation.submitted) throw bad('No one has submitted this test yet');
  let plan = planInterventions(diag);
  plan = await rewriteActions(req.user.centre_id, plan, diag); // AI wording if configured; numbers stay ours
  const used = data.questions.map((q) => q.id);
  const bank = await approvedBank(req.user.centre_id, [...new Set(plan.map((p) => p.topic_id))]);
  let created = 0;
  let practiceSets = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of plan) {
      const ins = await client.query(
        `INSERT INTO interventions (centre_id, test_id, topic_id, kind, accuracy, note) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (test_id, topic_id, kind) DO NOTHING RETURNING id`,
        [req.user.centre_id, test.id, item.topic_id, item.kind, item.accuracy, item.note]
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
  res.json({ created, practice_sets: practiceSets });
}));

router.get('/:id/actions', route(async (req, res) => {
  const test = await ownTest(req.user.centre_id, req.params.id);
  const { rows } = await pool.query(
    `SELECT i.id, i.topic_id, t.name AS topic, t.subject, i.kind, i.accuracy, i.note, i.status,
            count(p.id)::int AS practice_sets, count(p.completed_at)::int AS practice_done,
            COALESCE(json_agg(json_build_object('student_id', s.id, 'name', s.name, 'phone', s.phone, 'questions', cardinality(p.question_ids), 'done', p.completed_at IS NOT NULL) ORDER BY s.name)
                     FILTER (WHERE p.id IS NOT NULL), '[]') AS students
       FROM interventions i JOIN topics t ON t.id = i.topic_id
       LEFT JOIN practice_sets p ON p.intervention_id = i.id LEFT JOIN students s ON s.id = p.student_id
      WHERE i.test_id = $1 GROUP BY i.id, t.name, t.subject ORDER BY i.kind DESC, i.accuracy NULLS LAST`, [test.id]
  );
  res.json({ actions: rows });
}));

router.patch('/actions/:actionId', route(async (req, res) => {
  if (!['open', 'done'].includes(req.body.status)) throw bad('Status must be open or done');
  const { rowCount } = await pool.query('UPDATE interventions SET status = $1 WHERE id = $2 AND centre_id = $3',
    [req.body.status, intId(req.params.actionId, 'action'), req.user.centre_id]);
  if (!rowCount) throw notFound('Action not found');
  res.json({ ok: true });
}));

// POST /api/tests/:id/retest — a parallel test: same topics, same count per
// topic, fresh approved questions. Created as a draft the teacher publishes.
router.post('/:id/retest', route(async (req, res) => {
  const test = await ownTest(req.user.centre_id, req.params.id);
  if (test.kind === 'retest') throw bad('Make the re-test from the original test');
  const { rows: qs } = await pool.query(
    `SELECT q.id, q.topic_id FROM test_questions tq JOIN questions q ON q.id = tq.question_id WHERE tq.test_id = $1`, [test.id]);
  const bank = await approvedBank(req.user.centre_id, [...new Set(qs.map((q) => q.topic_id))]);
  const { questionIds, short } = buildParallel(qs, bank);
  if (!questionIds.length) throw bad('No fresh approved questions in these topics. Add more to the bank first.');
  const retest = await insertTest(pool, {
    ...test, title: `Re-test: ${test.title}`.slice(0, 160), kind: 'retest', parent_test_id: test.id, created_by: req.user.user_id,
  }, questionIds);
  res.status(201).json({ test: retest, questions: questionIds.length, short });
}));

// GET /api/tests/:id/verify — on a re-test: did the intervention work?
router.get('/:id/verify', route(async (req, res) => {
  const retest = await ownTest(req.user.centre_id, req.params.id);
  if (retest.kind !== 'retest' || !retest.parent_test_id) throw bad('Verify works on a re-test');
  const original = await ownTest(req.user.centre_id, retest.parent_test_id);
  const [a, b] = [await testData(original), await testData(retest)];
  const both = commonStudents(a.attempts, b.attempts);
  const before = diagnose(await testData(original, both));
  const after = diagnose(await testData(retest, both));
  res.json({ original: { id: original.id, title: original.title }, retest: { id: retest.id, title: retest.title }, comparison: compareTopics(before, after) });
}));

export default router;

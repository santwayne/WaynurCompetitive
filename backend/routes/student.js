import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { requireAuth, requireStudent } from '../middleware/auth.js';
import { bad, intId, notFound, route } from '../services/util.js';
import { scoreResponses } from '../services/loop.js';
import { hintFor } from '../services/aiLoop.js';

const router = Router();
router.use(requireAuth, requireStudent);
const GRACE_MS = 2 * 60 * 1000; // late submits within 2 minutes still count (slow networks)

// Published tests in the student's batches.
router.get('/tests', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.kind, t.duration_min, t.marks_correct, t.marks_wrong, t.status, b.name AS batch,
            (SELECT count(*)::int FROM test_questions q WHERE q.test_id = t.id) AS questions,
            a.started_at, a.submitted_at, a.score
       FROM tests t JOIN batches b ON b.id = t.batch_id
       JOIN batch_students bs ON bs.batch_id = t.batch_id AND bs.student_id = $1
       LEFT JOIN attempts a ON a.test_id = t.id AND a.student_id = $1
      WHERE t.centre_id = $2 AND t.mode = 'online' AND (t.status = 'published' OR a.submitted_at IS NOT NULL)
      ORDER BY t.created_at DESC`,
    [req.user.student_id, req.user.centre_id]
  );
  res.json({ tests: rows });
}));

async function myTest(req, testId) {
  const { rows } = await pool.query(
    `SELECT t.* FROM tests t JOIN batch_students bs ON bs.batch_id = t.batch_id AND bs.student_id = $1
      WHERE t.id = $2 AND t.centre_id = $3 AND t.mode = 'online'`,
    [req.user.student_id, intId(testId, 'test'), req.user.centre_id]
  );
  if (!rows.length) throw notFound('Test not found');
  return rows[0];
}

// POST /api/student/tests/:id/start — returns questions WITHOUT answers.
router.post('/tests/:id/start', route(async (req, res) => {
  const test = await myTest(req, req.params.id);
  if (test.status !== 'published') throw bad('This test is not open');
  const { rows } = await pool.query(
    `INSERT INTO attempts (test_id, student_id, source) VALUES ($1,$2,'online')
     ON CONFLICT (test_id, student_id) DO UPDATE SET test_id = EXCLUDED.test_id RETURNING started_at, submitted_at`,
    [test.id, req.user.student_id]
  );
  if (rows[0].submitted_at) throw bad('You have already submitted this test');
  const { rows: questions } = await pool.query(
    `SELECT q.id, q.stem, q.options, tq.position FROM test_questions tq JOIN questions q ON q.id = tq.question_id
      WHERE tq.test_id = $1 ORDER BY tq.position`, [test.id]
  );
  const endsAt = new Date(new Date(rows[0].started_at).getTime() + test.duration_min * 60000);
  res.json({ test: { id: test.id, title: test.title, duration_min: test.duration_min, marks_correct: test.marks_correct, marks_wrong: test.marks_wrong }, started_at: rows[0].started_at, ends_at: endsAt, questions });
}));

// POST /api/student/tests/:id/submit — { answers: { [questionId]: chosenIndex | null }, times?: { [questionId]: ms } }
router.post('/tests/:id/submit', route(async (req, res) => {
  const test = await myTest(req, req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const a = await client.query(
      'SELECT id, started_at, submitted_at FROM attempts WHERE test_id = $1 AND student_id = $2 FOR UPDATE', [test.id, req.user.student_id]);
    const attempt = a.rows[0];
    if (!attempt) throw bad('Start the test first');
    if (attempt.submitted_at) throw bad('You have already submitted this test');
    // Past the time limit (+ grace): the answers still count, so a dropped
    // connection never zeroes a student; the teacher sees it as late.
    const late = Date.now() > new Date(attempt.started_at).getTime() + test.duration_min * 60000 + GRACE_MS;
    const { rows: qs } = await client.query(
      `SELECT q.id, q.correct_index, jsonb_array_length(q.options) AS n FROM test_questions tq JOIN questions q ON q.id = tq.question_id
        WHERE tq.test_id = $1`, [test.id]);
    const answers = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const times = req.body.times && typeof req.body.times === 'object' ? req.body.times : {};
    const responses = qs.map((q) => {
      const v = answers[q.id];
      let chosen = v === null || v === undefined || v === '' ? null : Number(v);
      if (chosen !== null && (!Number.isInteger(chosen) || chosen < 0 || chosen >= q.n)) chosen = null;
      const t = Number(times[q.id]);
      return { question_id: q.id, chosen_index: chosen, is_correct: chosen === q.correct_index, time_ms: Number.isFinite(t) && t >= 0 ? Math.min(t, 3600000) : null };
    });
    const score = scoreResponses(responses, test.marks_correct, test.marks_wrong);
    for (const r of responses) {
      await client.query('INSERT INTO responses (attempt_id, question_id, chosen_index, is_correct, time_ms) VALUES ($1,$2,$3,$4,$5)',
        [attempt.id, r.question_id, r.chosen_index, r.is_correct, r.time_ms]);
    }
    await client.query('UPDATE attempts SET submitted_at = now(), score = $1 WHERE id = $2', [score, attempt.id]);
    await client.query('COMMIT');
    res.json({ score, correct: responses.filter((r) => r.is_correct).length, total: responses.length, late });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// GET /api/student/tests/:id/result — answers and explanations, only after submitting.
router.get('/tests/:id/result', route(async (req, res) => {
  const test = await myTest(req, req.params.id);
  const a = await pool.query('SELECT id, score, submitted_at FROM attempts WHERE test_id = $1 AND student_id = $2', [test.id, req.user.student_id]);
  if (!a.rows[0]?.submitted_at) throw bad('Submit the test to see the answers');
  const { rows } = await pool.query(
    `SELECT q.id, q.stem, q.options, q.correct_index, q.explanation, t.name AS topic, r.chosen_index, r.is_correct
       FROM test_questions tq JOIN questions q ON q.id = tq.question_id JOIN topics t ON t.id = q.topic_id
       LEFT JOIN responses r ON r.attempt_id = $2 AND r.question_id = q.id
      WHERE tq.test_id = $1 ORDER BY tq.position`, [test.id, a.rows[0].id]
  );
  res.json({ test: { id: test.id, title: test.title }, score: a.rows[0].score, questions: rows });
}));

// ── Practice sets (from the Loop) ────────────────────────────────────────
router.get('/practice', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, t.name AS topic, t.subject, cardinality(p.question_ids) AS questions,
            (SELECT count(*)::int FROM jsonb_object_keys(p.answers)) AS answered, p.completed_at, i.created_at
       FROM practice_sets p JOIN interventions i ON i.id = p.intervention_id JOIN topics t ON t.id = i.topic_id
      WHERE p.student_id = $1 AND i.centre_id = $2 ORDER BY p.completed_at NULLS FIRST, i.created_at DESC`,
    [req.user.student_id, req.user.centre_id]
  );
  res.json({ practice: rows });
}));

async function mySet(req, id) {
  const { rows } = await pool.query(
    `SELECT p.*, i.topic_id, t.notes FROM practice_sets p JOIN interventions i ON i.id = p.intervention_id JOIN topics t ON t.id = i.topic_id
      WHERE p.id = $1 AND p.student_id = $2 AND i.centre_id = $3`,
    [intId(id, 'practice set'), req.user.student_id, req.user.centre_id]
  );
  if (!rows.length) throw notFound('Practice set not found');
  return rows[0];
}

// Answered questions show the right answer + explanation; the rest don't.
router.get('/practice/:id', route(async (req, res) => {
  const set = await mySet(req, req.params.id);
  const { rows } = await pool.query('SELECT id, stem, options, correct_index, explanation FROM questions WHERE id = ANY($1::int[])', [set.question_ids]);
  const byId = new Map(rows.map((q) => [q.id, q]));
  const questions = set.question_ids.map((qid) => byId.get(qid)).filter(Boolean).map((q) => {
    const chosen = set.answers[q.id];
    const done = chosen !== undefined;
    return { id: q.id, stem: q.stem, options: q.options, chosen: done ? chosen : null,
      correct_index: done ? q.correct_index : undefined, explanation: done ? q.explanation : undefined };
  });
  res.json({ id: set.id, completed_at: set.completed_at, questions });
}));

router.post('/practice/:id/answer', route(async (req, res) => {
  const set = await mySet(req, req.params.id);
  const qid = intId(req.body.questionId, 'question');
  if (!set.question_ids.includes(qid)) throw bad('That question is not in this set');
  const q = (await pool.query('SELECT correct_index, explanation, jsonb_array_length(options) AS n FROM questions WHERE id = $1', [qid])).rows[0];
  const chosen = Number(req.body.chosen);
  if (!Number.isInteger(chosen) || chosen < 0 || chosen >= q.n) throw bad('Pick an option');
  if (set.answers[qid] !== undefined) throw bad('Already answered');
  const answers = { ...set.answers, [qid]: chosen };
  const complete = set.question_ids.every((id) => answers[id] !== undefined);
  await pool.query('UPDATE practice_sets SET answers = $1, completed_at = CASE WHEN $2 THEN now() ELSE completed_at END WHERE id = $3',
    [JSON.stringify(answers), complete, set.id]);
  res.json({ correct: chosen === q.correct_index, correct_index: q.correct_index, explanation: q.explanation, completed: complete });
}));

router.post('/practice/:id/hint', route(async (req, res) => {
  const set = await mySet(req, req.params.id);
  const qid = intId(req.body.questionId, 'question');
  if (!set.question_ids.includes(qid)) throw bad('That question is not in this set');
  const q = (await pool.query('SELECT stem, options, correct_index, explanation FROM questions WHERE id = $1', [qid])).rows[0];
  res.json(await hintFor(req.user.centre_id, q, set.notes, req.body.note));
}));

router.post('/password', route(async (req, res) => {
  const { rows } = await pool.query('SELECT password_hash FROM students WHERE id = $1', [req.user.student_id]);
  if (!(await bcrypt.compare(String(req.body.current || ''), rows[0].password_hash))) throw bad('Current password is wrong');
  if (typeof req.body.next !== 'string' || req.body.next.length < 8) throw bad('New password must be at least 8 characters');
  await pool.query('UPDATE students SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(req.body.next, 10), req.user.student_id]);
  res.json({ ok: true });
}));

export default router;

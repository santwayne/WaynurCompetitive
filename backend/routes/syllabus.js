import { Router } from 'express';
import pool from '../config/db.js';
import { requireAuth, requireLead, requireStaff } from '../middleware/auth.js';
import { bad, intId, notFound, parseCsv, route, text } from '../services/util.js';

// Exam patterns, the subject → topic map, and the teacher-approved question bank.
const router = Router();
router.use(requireAuth, requireStaff);

// ── Exam patterns ────────────────────────────────────────────────────────
router.get('/exam-patterns', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, code, name, version, duration_min, marks_correct, marks_wrong, sections, centre_id IS NULL AS shared
       FROM exam_patterns WHERE centre_id IS NULL OR centre_id = $1 ORDER BY centre_id NULLS FIRST, name, version DESC`,
    [req.user.centre_id]
  );
  res.json({ patterns: rows });
}));

router.post('/exam-patterns', requireLead, route(async (req, res) => {
  const b = req.body;
  const num = (v, what, min) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min) throw bad(`${what} must be ${min} or more`);
    return n;
  };
  const sections = Array.isArray(b.sections) ? b.sections.map((s) => ({
    subject: text(s.subject, 'Section subject', { max: 80 }),
    questions: num(s.questions, 'Section questions', 1),
  })) : [];
  try {
    const { rows } = await pool.query(
      `INSERT INTO exam_patterns (centre_id, code, name, version, duration_min, marks_correct, marks_wrong, sections)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.centre_id, text(b.code, 'Code', { max: 40 }).toUpperCase(), text(b.name, 'Name', { max: 120 }),
        text(b.version, 'Version', { max: 20 }), num(b.durationMin, 'Duration', 1), num(b.marksCorrect, 'Marks per correct answer', 0.25),
        num(b.marksWrong ?? 0, 'Negative marks', 0), JSON.stringify(sections)]
    );
    res.status(201).json({ pattern: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw bad('That exam code and version already exist');
    throw err;
  }
}));

// ── Topics ───────────────────────────────────────────────────────────────
router.get('/topics', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.subject, t.name, t.notes,
            count(q.id) FILTER (WHERE q.status = 'approved')::int AS approved,
            count(q.id) FILTER (WHERE q.status = 'draft')::int AS drafts
       FROM topics t LEFT JOIN questions q ON q.topic_id = t.id
      WHERE t.centre_id = $1 GROUP BY t.id ORDER BY t.subject, t.name`,
    [req.user.centre_id]
  );
  res.json({ topics: rows });
}));

async function ensureTopic(db, centreId, subject, name) {
  const s = text(subject, 'Subject', { max: 80 });
  const n = text(name, 'Topic', { max: 120 });
  const { rows } = await db.query(
    `INSERT INTO topics (centre_id, subject, name) VALUES ($1,$2,$3)
     ON CONFLICT (centre_id, subject, name) DO UPDATE SET subject = EXCLUDED.subject RETURNING id`,
    [centreId, s, n]
  );
  return rows[0].id;
}

router.post('/topics', route(async (req, res) => {
  const id = await ensureTopic(pool, req.user.centre_id, req.body.subject, req.body.name);
  if (req.body.notes !== undefined) {
    await pool.query('UPDATE topics SET notes = $1 WHERE id = $2', [text(req.body.notes, 'Notes', { max: 20000, required: false }), id]);
  }
  res.status(201).json({ topic_id: id });
}));

router.patch('/topics/:id', route(async (req, res) => {
  const { rowCount } = await pool.query(
    'UPDATE topics SET notes = $1 WHERE id = $2 AND centre_id = $3',
    [text(req.body.notes, 'Notes', { max: 20000, required: false }), intId(req.params.id, 'topic'), req.user.centre_id]
  );
  if (!rowCount) throw notFound('Topic not found');
  res.json({ ok: true });
}));

// ── Questions ────────────────────────────────────────────────────────────
function questionFields(b) {
  const options = Array.isArray(b.options) ? b.options.map((o) => String(o ?? '').trim()).filter(Boolean) : [];
  if (options.length < 2 || options.length > 6) throw bad('A question needs 2 to 6 options');
  const correct = Number(b.correctIndex);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw bad('Pick which option is correct');
  const difficulty = [1, 2, 3].includes(Number(b.difficulty)) ? Number(b.difficulty) : 2;
  return {
    stem: text(b.stem, 'Question', { max: 4000 }),
    options,
    correct,
    explanation: text(b.explanation, 'Explanation', { max: 4000, required: false }),
    difficulty,
  };
}

async function ownTopic(centreId, topicId) {
  const { rows } = await pool.query('SELECT id FROM topics WHERE id = $1 AND centre_id = $2', [intId(topicId, 'topic'), centreId]);
  if (!rows.length) throw bad('Unknown topic');
  return rows[0].id;
}

router.get('/questions', route(async (req, res) => {
  const params = [req.user.centre_id];
  let where = 'q.centre_id = $1';
  if (req.query.topicId) { params.push(intId(req.query.topicId, 'topic')); where += ` AND q.topic_id = $${params.length}`; }
  if (['draft', 'approved', 'retired'].includes(req.query.status)) { params.push(req.query.status); where += ` AND q.status = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT q.id, q.topic_id, t.subject, t.name AS topic, q.stem, q.options, q.correct_index, q.explanation,
            q.difficulty, q.status, q.source, q.created_at
       FROM questions q JOIN topics t ON t.id = q.topic_id WHERE ${where} ORDER BY q.created_at DESC LIMIT 500`,
    params
  );
  res.json({ questions: rows });
}));

// Leads' questions are approved straight away; a teacher's wait for approval.
const initialStatus = (user) => (['owner', 'academic_head'].includes(user.role) ? 'approved' : 'draft');

router.post('/questions', route(async (req, res) => {
  const topicId = await ownTopic(req.user.centre_id, req.body.topicId);
  const f = questionFields(req.body);
  const status = initialStatus(req.user);
  const { rows } = await pool.query(
    `INSERT INTO questions (centre_id, topic_id, stem, options, correct_index, explanation, difficulty, status, source, created_by, approved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,$10) RETURNING id, status`,
    [req.user.centre_id, topicId, f.stem, JSON.stringify(f.options), f.correct, f.explanation, f.difficulty, status,
      req.user.user_id, status === 'approved' ? req.user.user_id : null]
  );
  res.status(201).json({ question: rows[0] });
}));

router.put('/questions/:id', route(async (req, res) => {
  const f = questionFields(req.body);
  const topicId = await ownTopic(req.user.centre_id, req.body.topicId);
  // An edit by a teacher sends the question back for approval.
  const status = initialStatus(req.user);
  const { rowCount } = await pool.query(
    `UPDATE questions SET topic_id=$1, stem=$2, options=$3, correct_index=$4, explanation=$5, difficulty=$6,
            status = CASE WHEN status = 'retired' THEN 'retired' ELSE $7 END,
            approved_by = CASE WHEN $7 = 'approved' THEN $8 ELSE NULL END
      WHERE id = $9 AND centre_id = $10`,
    [topicId, f.stem, JSON.stringify(f.options), f.correct, f.explanation, f.difficulty, status, req.user.user_id,
      intId(req.params.id, 'question'), req.user.centre_id]
  );
  if (!rowCount) throw notFound('Question not found');
  res.json({ ok: true, status });
}));

// POST /api/syllabus/questions/status — { ids: [..], status: 'approved' | 'retired' | 'draft' }
router.post('/questions/status', requireLead, route(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map((x) => intId(x, 'question')) : [];
  if (!ids.length) throw bad('Pick at least one question');
  if (!['approved', 'retired', 'draft'].includes(req.body.status)) throw bad('Unknown status');
  const { rowCount } = await pool.query(
    `UPDATE questions SET status = $1, approved_by = CASE WHEN $1 = 'approved' THEN $2 ELSE approved_by END
      WHERE centre_id = $3 AND id = ANY($4::int[])`,
    [req.body.status, req.user.user_id, req.user.centre_id, ids]
  );
  res.json({ updated: rowCount });
}));

// POST /api/syllabus/questions/import — { csv }
// Columns: subject,topic,question,option_a,option_b,option_c,option_d,answer,explanation,difficulty
// answer = A/B/C/D (or 1–4). Topics are created as needed. All or nothing.
router.post('/questions/import', route(async (req, res) => {
  const rows = parseCsv(req.body.csv);
  if (!rows.length) throw bad('The file has no rows. First line must be: subject,topic,question,option_a,option_b,option_c,option_d,answer,explanation,difficulty');
  if (rows.length > 2000) throw bad('Up to 2000 questions per file');
  const status = initialStatus(req.user);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [i, r] of rows.entries()) {
      try {
        const options = ['option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'option_f'].map((k) => r[k]).filter(Boolean);
        const ans = String(r.answer || '').trim().toUpperCase();
        const correctIndex = /^[A-F]$/.test(ans) ? ans.charCodeAt(0) - 65 : Number(ans) - 1;
        const f = questionFields({ stem: r.question, options, correctIndex, explanation: r.explanation, difficulty: r.difficulty });
        const topicId = await ensureTopic(client, req.user.centre_id, r.subject, r.topic);
        await client.query(
          `INSERT INTO questions (centre_id, topic_id, stem, options, correct_index, explanation, difficulty, status, source, created_by, approved_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'csv',$9,$10)`,
          [req.user.centre_id, topicId, f.stem, JSON.stringify(f.options), f.correct, f.explanation, f.difficulty, status,
            req.user.user_id, status === 'approved' ? req.user.user_id : null]
        );
      } catch (err) {
        throw bad(`Row ${i + 2}: ${err.message}`);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json({ imported: rows.length, status });
}));

export default router;

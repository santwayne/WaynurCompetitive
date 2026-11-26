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

// "Maths / Percentage" and "math / Percentages " are the same topic: the
// match ignores case, spaces, punctuation and a plural "s", so weak-topic
// reports are not split across near-duplicates. The first spelling stays.
export function topicKey(v) {
  return String(v ?? '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/)
    .filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
}

async function ensureTopic(db, centreId, subject, name) {
  const s = text(subject, 'Subject', { max: 80 }).replace(/\s+/g, ' ');
  const n = text(name, 'Topic', { max: 120 }).replace(/\s+/g, ' ');
  const { rows: all } = await db.query('SELECT id, subject, name FROM topics WHERE centre_id = $1 ORDER BY id', [centreId]);
  const sk = topicKey(s);
  const nk = topicKey(n);
  const same = all.find((t) => topicKey(t.subject) === sk && topicKey(t.name) === nk);
  if (same) return same.id;
  // A known subject keeps its first spelling too ("math" → "Maths").
  const subj = all.find((t) => topicKey(t.subject) === sk)?.subject ?? s;
  const { rows } = await db.query(
    `INSERT INTO topics (centre_id, subject, name) VALUES ($1,$2,$3)
     ON CONFLICT (centre_id, subject, name) DO UPDATE SET subject = EXCLUDED.subject RETURNING id`,
    [centreId, subj, n]
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

// POST /api/syllabus/topics/merge — { fromId, intoId } (owner / academic head).
// Fixes duplicates made before the matching above: questions, re-teach notes
// and practice move to "into", then "from" is deleted.
router.post('/topics/merge', requireLead, route(async (req, res) => {
  const fromId = await ownTopic(req.user.centre_id, req.body.fromId);
  const intoId = await ownTopic(req.user.centre_id, req.body.intoId);
  if (fromId === intoId) throw bad('Pick two different topics');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const moved = await client.query('UPDATE questions SET topic_id = $1 WHERE topic_id = $2 AND centre_id = $3', [intoId, fromId, req.user.centre_id]);
    // One re-teach / practice row per test and topic: where both topics have
    // one for the same test, keep the one already on "into".
    await client.query(
      `DELETE FROM interventions f USING interventions i
        WHERE f.topic_id = $1 AND i.topic_id = $2 AND f.test_id = i.test_id AND f.kind = i.kind`, [fromId, intoId]);
    await client.query('UPDATE interventions SET topic_id = $1 WHERE topic_id = $2', [intoId, fromId]);
    await client.query(
      `UPDATE topics SET notes = CASE WHEN COALESCE(notes, '') = '' THEN (SELECT notes FROM topics WHERE id = $2)
                                      ELSE notes END WHERE id = $1`, [intoId, fromId]);
    await client.query('DELETE FROM topics WHERE id = $1', [fromId]);
    await client.query('COMMIT');
    res.json({ ok: true, questions_moved: moved.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ── Questions ────────────────────────────────────────────────────────────
const DIFFICULTY = { 1: 1, 2: 2, 3: 3, easy: 1, medium: 2, hard: 3 };
function questionFields(b) {
  const options = Array.isArray(b.options) ? b.options.map((o) => String(o ?? '').trim()).filter(Boolean) : [];
  if (options.length < 2 || options.length > 6) throw bad('A question needs 2 to 6 options');
  // No default answer: a question saved without choosing one would mark students wrong.
  const raw = b.correctIndex;
  const correct = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw bad('Pick which option is the correct answer');
  const d = String(b.difficulty ?? '').trim().toLowerCase();
  if (d && !(d in DIFFICULTY)) throw bad('Difficulty must be 1 (easy), 2 (medium) or 3 (hard)');
  const difficulty = d ? DIFFICULTY[d] : 2;
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
            status = CASE WHEN status = 'retired' THEN 'retired' ELSE $7::text END,
            approved_by = CASE WHEN $7::text = 'approved' THEN $8::int ELSE NULL END
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
        if (!ans) throw bad('The answer column is empty (use A, B, C or D)');
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
        throw bad(`Row ${i + 2} of the file: ${err.message}. No questions were imported. Fix this row and import the whole file again.`);
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

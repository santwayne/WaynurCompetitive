import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { requireAuth, requireLead, requireStaff } from '../middleware/auth.js';
import { bad, intId, normalizePhone, notFound, parseCsv, route, text } from '../services/util.js';

// Centre set-up: staff, batches, students. Every query is scoped by
// req.user.centre_id from the token.
const router = Router();
router.use(requireAuth, requireStaff);

// ── Staff ────────────────────────────────────────────────────────────────
router.get('/staff', route(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, phone, role, active FROM users WHERE centre_id = $1 ORDER BY name', [req.user.centre_id]
  );
  res.json({ staff: rows });
}));

router.post('/staff', requireLead, route(async (req, res) => {
  const role = ['academic_head', 'teacher'].includes(req.body.role) ? req.body.role : 'teacher';
  const mail = text(req.body.email, 'Email', { max: 200 }).toLowerCase();
  if (typeof req.body.password !== 'string' || req.body.password.length < 8) throw bad('Password must be at least 8 characters');
  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [mail]);
  if (exists.rowCount) throw bad('That email already has an account');
  const { rows } = await pool.query(
    `INSERT INTO users (centre_id, name, email, phone, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, name, email, phone, role, active`,
    [req.user.centre_id, text(req.body.name, 'Name', { max: 120 }), mail, normalizePhone(req.body.phone), await bcrypt.hash(req.body.password, 10), role]
  );
  res.status(201).json({ user: rows[0] });
}));

// ── Batches ──────────────────────────────────────────────────────────────
router.get('/batches', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.active, b.exam_pattern_id, p.name AS exam_pattern,
            (SELECT count(*)::int FROM batch_students bs WHERE bs.batch_id = b.id) AS students,
            (SELECT count(*)::int FROM tests t WHERE t.batch_id = b.id) AS tests
       FROM batches b LEFT JOIN exam_patterns p ON p.id = b.exam_pattern_id
      WHERE b.centre_id = $1 ORDER BY b.active DESC, b.name`,
    [req.user.centre_id]
  );
  res.json({ batches: rows });
}));

async function patternVisible(centreId, patternId) {
  if (patternId == null) return null;
  const id = intId(patternId, 'exam pattern');
  const p = await pool.query('SELECT id FROM exam_patterns WHERE id = $1 AND (centre_id IS NULL OR centre_id = $2)', [id, centreId]);
  if (!p.rowCount) throw bad('Unknown exam pattern');
  return id;
}

router.post('/batches', requireLead, route(async (req, res) => {
  const name = text(req.body.name, 'Batch name', { max: 120 });
  const patternId = await patternVisible(req.user.centre_id, req.body.examPatternId ?? null);
  try {
    const { rows } = await pool.query(
      'INSERT INTO batches (centre_id, name, exam_pattern_id) VALUES ($1,$2,$3) RETURNING *', [req.user.centre_id, name, patternId]
    );
    res.status(201).json({ batch: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw bad('A batch with that name already exists');
    throw err;
  }
}));

async function ownBatch(centreId, batchId) {
  const { rows } = await pool.query('SELECT * FROM batches WHERE id = $1 AND centre_id = $2', [intId(batchId, 'batch'), centreId]);
  if (!rows.length) throw notFound('Batch not found');
  return rows[0];
}

router.get('/batches/:id', route(async (req, res) => {
  const batch = await ownBatch(req.user.centre_id, req.params.id);
  const [students, tests] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, s.phone, s.roll_no, s.active FROM batch_students bs JOIN students s ON s.id = bs.student_id
        WHERE bs.batch_id = $1 ORDER BY s.name`, [batch.id]),
    pool.query(
      `SELECT t.id, t.title, t.kind, t.mode, t.status, t.created_at, t.parent_test_id,
              (SELECT count(*)::int FROM attempts a WHERE a.test_id = t.id AND a.submitted_at IS NOT NULL) AS submitted,
              (SELECT count(*)::int FROM test_questions q WHERE q.test_id = t.id) AS questions
         FROM tests t WHERE t.batch_id = $1 ORDER BY t.created_at DESC`, [batch.id]),
  ]);
  res.json({ batch, students: students.rows, tests: tests.rows });
}));

// ── Students ─────────────────────────────────────────────────────────────
// Creates (or finds by phone) a student and optionally adds them to a batch.
async function upsertStudent(client, centreId, { name, phone, roll_no, password }, batchId) {
  const p = normalizePhone(phone);
  if (!p) throw bad(`"${phone}" is not a valid 10-digit mobile number`);
  const nm = text(name, 'Student name', { max: 120 });
  const existing = await client.query('SELECT id FROM students WHERE centre_id = $1 AND phone = $2', [centreId, p]);
  let id = existing.rows[0]?.id;
  let created = false;
  if (!id) {
    // Default password = the student's mobile number; the teacher can tell them to change it.
    const hash = await bcrypt.hash(password && password.length >= 6 ? password : p, 10);
    const r = await client.query(
      'INSERT INTO students (centre_id, name, phone, roll_no, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [centreId, nm, p, roll_no || null, hash]
    );
    id = r.rows[0].id;
    created = true;
  }
  if (batchId) await client.query('INSERT INTO batch_students (batch_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [batchId, id]);
  return { id, created };
}

router.post('/students', route(async (req, res) => {
  const batch = req.body.batchId ? await ownBatch(req.user.centre_id, req.body.batchId) : null;
  const r = await upsertStudent(pool, req.user.centre_id, req.body, batch?.id);
  res.status(r.created ? 201 : 200).json({ student_id: r.id, created: r.created });
}));

// POST /api/centre/batches/:id/students/import — { csv: "name,phone,roll_no\n…" }
// All or nothing: one bad row rolls the whole file back and names the row.
router.post('/batches/:id/students/import', route(async (req, res) => {
  const batch = await ownBatch(req.user.centre_id, req.params.id);
  const rows = parseCsv(req.body.csv);
  if (!rows.length) throw bad('The file has no rows. First line must be: name,phone,roll_no');
  if (rows.length > 2000) throw bad('Up to 2000 students per file');
  const client = await pool.connect();
  let created = 0;
  try {
    await client.query('BEGIN');
    for (const [i, row] of rows.entries()) {
      try {
        const r = await upsertStudent(client, req.user.centre_id, row, batch.id);
        if (r.created) created += 1;
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
  res.json({ rows: rows.length, created, added_to_batch: rows.length });
}));

router.delete('/batches/:id/students/:studentId', route(async (req, res) => {
  const batch = await ownBatch(req.user.centre_id, req.params.id);
  await pool.query('DELETE FROM batch_students WHERE batch_id = $1 AND student_id = $2', [batch.id, intId(req.params.studentId, 'student')]);
  res.json({ ok: true });
}));

export { ownBatch };
export default router;

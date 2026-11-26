import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { requireAuth, requireLead, requireOwner, requireStaff } from '../middleware/auth.js';
import { bad, intId, normalizePhone, notFound, parseCsv, route, text } from '../services/util.js';

// Centre set-up: staff, batches, students. Every query is scoped by
// req.user.centre_id from the token.
const router = Router();
router.use(requireAuth, requireStaff);

// ── Staff ────────────────────────────────────────────────────────────────
// Only the owner sees everyone's email and number; others see names and
// roles, plus their own details.
router.get('/staff', route(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, phone, role, active FROM users WHERE centre_id = $1 ORDER BY name', [req.user.centre_id]
  );
  const owner = req.user.role === 'owner';
  res.json({
    staff: rows.map((u) => (owner || u.id === req.user.user_id ? u : { ...u, email: null, phone: null })),
  });
}));

// Owner only. The new person must change this password on first login.
router.post('/staff', requireOwner, route(async (req, res) => {
  const role = ['academic_head', 'teacher'].includes(req.body.role) ? req.body.role : 'teacher';
  const mail = text(req.body.email, 'Email', { max: 200 }).toLowerCase();
  if (typeof req.body.password !== 'string' || req.body.password.length < 8) throw bad('Password must be at least 8 characters');
  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [mail]);
  if (exists.rowCount) throw bad('That email already has an account');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw bad('Enter a valid email');
  const phone = String(req.body.phone || '').trim() ? normalizePhone(req.body.phone) : null;
  if (String(req.body.phone || '').trim() && !phone) throw bad('WhatsApp number must be a 10-digit mobile number');
  const { rows } = await pool.query(
    `INSERT INTO users (centre_id, name, email, phone, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,true)
     RETURNING id, name, email, phone, role, active`,
    [req.user.centre_id, text(req.body.name, 'Name', { max: 120 }), mail, phone, await bcrypt.hash(req.body.password, 10), role]
  );
  const centre = (await pool.query('SELECT name FROM centres WHERE id = $1', [req.user.centre_id])).rows[0];
  res.status(201).json({ user: rows[0], centre_name: centre.name });
}));

// PATCH /api/centre/staff/:id — { phone?, active?, role? } (owner only).
// The phone is the teacher's WhatsApp number: reports and commands use it.
router.patch('/staff/:id', requireOwner, route(async (req, res) => {
  const id = intId(req.params.id, 'staff');
  const cur = (await pool.query('SELECT * FROM users WHERE id = $1 AND centre_id = $2', [id, req.user.centre_id])).rows[0];
  if (!cur) throw notFound('Staff member not found');
  let phone = cur.phone;
  if (req.body.phone !== undefined) {
    phone = String(req.body.phone || '').trim() ? normalizePhone(req.body.phone) : null;
    if (String(req.body.phone || '').trim() && !phone) throw bad('WhatsApp number must be a 10-digit mobile number');
  }
  const isOwner = cur.role === 'owner';
  const role = !isOwner && ['academic_head', 'teacher'].includes(req.body.role) ? req.body.role : cur.role;
  const active = !isOwner && typeof req.body.active === 'boolean' ? req.body.active : cur.active;
  const { rows } = await pool.query('UPDATE users SET phone = $1, role = $2, active = $3 WHERE id = $4 RETURNING id, name, email, phone, role, active',
    [phone, role, active, id]);
  res.json({ user: rows[0] });
}));

// ── Batches ──────────────────────────────────────────────────────────────
router.get('/batches', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.active, b.exam_pattern_id, p.name AS exam_pattern,
            (SELECT count(*)::int FROM batch_students bs JOIN students s ON s.id = bs.student_id WHERE bs.batch_id = b.id AND s.active) AS students,
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

// PATCH /api/centre/batches/:id — { name?, examPatternId?, active? }. Tests
// already made keep the marks they were made with.
router.patch('/batches/:id', requireLead, route(async (req, res) => {
  const batch = await ownBatch(req.user.centre_id, req.params.id);
  const b = req.body;
  const patternId = b.examPatternId !== undefined ? await patternVisible(req.user.centre_id, b.examPatternId || null) : batch.exam_pattern_id;
  try {
    const { rows } = await pool.query('UPDATE batches SET name = $1, exam_pattern_id = $2, active = $3 WHERE id = $4 RETURNING *',
      [b.name !== undefined ? text(b.name, 'Batch name', { max: 120 }) : batch.name, patternId,
        typeof b.active === 'boolean' ? b.active : batch.active, batch.id]);
    res.json({ batch: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw bad('A batch with that name already exists');
    throw err;
  }
}));

router.get('/batches/:id', route(async (req, res) => {
  const batch = await ownBatch(req.user.centre_id, req.params.id);
  const [students, tests] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, s.phone, s.roll_no, s.parent_name, s.parent_phone, s.active FROM batch_students bs JOIN students s ON s.id = bs.student_id
        WHERE bs.batch_id = $1 ORDER BY s.active DESC, s.name`, [batch.id]),
    pool.query(
      `SELECT t.id, t.title, t.kind, t.mode, t.status, t.created_at, t.parent_test_id,
              (SELECT count(*)::int FROM attempts a WHERE a.test_id = t.id AND a.submitted_at IS NOT NULL) AS submitted,
              (SELECT count(*)::int FROM test_questions q WHERE q.test_id = t.id) AS questions
         FROM tests t WHERE t.batch_id = $1 ORDER BY t.created_at DESC`, [batch.id]),
  ]);
  res.json({ batch, students: students.rows, tests: tests.rows });
}));

// ── Students ─────────────────────────────────────────────────────────────
// The plan's student limit, set by the Super Admin. Only students who are
// still active count; a student who left frees their place.
async function checkStudentLimit(db, centreId) {
  const lim = await db.query(
    `SELECT c.student_limit, (SELECT count(*)::int FROM students s WHERE s.centre_id = c.id AND s.active) AS n FROM centres c WHERE c.id = $1`, [centreId]);
  if (lim.rows[0].student_limit != null && lim.rows[0].n >= lim.rows[0].student_limit) {
    throw bad(`Your plan allows ${lim.rows[0].student_limit} students. Mark students who left as "Left coaching", or contact Waynur to add more.`);
  }
}

// Creates (or finds by phone) a student and optionally adds them to a batch.
async function upsertStudent(client, centreId, { name, phone, roll_no, password, parent_phone, parent_name }, batchId) {
  const p = normalizePhone(phone);
  if (!p) throw bad(`"${phone}" is not a valid 10-digit mobile number`);
  const nm = text(name, 'Student name', { max: 120 });
  let parent = null;
  if (parent_phone && String(parent_phone).trim()) {
    parent = normalizePhone(parent_phone);
    if (!parent) throw bad(`Parent number "${parent_phone}" is not a valid 10-digit mobile number`);
  }
  const pName = parent_name ? text(parent_name, 'Parent name', { max: 120, required: false }) : null;
  const existing = await client.query('SELECT id, active FROM students WHERE centre_id = $1 AND phone = $2', [centreId, p]);
  let id = existing.rows[0]?.id;
  let created = false;
  if (id && !existing.rows[0].active) {
    // Adding a student who had left brings them back (counts in the limit again).
    await checkStudentLimit(client, centreId);
    await client.query('UPDATE students SET active = true WHERE id = $1', [id]);
  }
  if (!id) {
    await checkStudentLimit(client, centreId);
    // Default password = the student's mobile number. Students can also log in with a WhatsApp code.
    const hash = await bcrypt.hash(password && password.length >= 6 ? password : p, 10);
    const r = await client.query(
      'INSERT INTO students (centre_id, name, phone, roll_no, password_hash, parent_phone, parent_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [centreId, nm, p, roll_no || null, hash, parent, pName]
    );
    id = r.rows[0].id;
    created = true;
  } else if (parent) {
    await client.query('UPDATE students SET parent_phone = $1, parent_name = COALESCE($2, parent_name) WHERE id = $3', [parent, pName, id]);
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
  if (!rows.length) throw bad('The file has no rows. First line must be: name,phone,roll_no,parent_phone,parent_name');
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
        throw bad(`Row ${i + 2} of the file: ${err.message}. No students were added. Fix this row and import the whole file again.`);
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

// PATCH /api/centre/students/:id — { name?, phone?, roll_no?, parent_phone?, parent_name?, active? }
// active: false = "left the coaching": the student can no longer log in and
// no longer counts in the plan's limit; their old results stay.
router.patch('/students/:id', route(async (req, res) => {
  const id = intId(req.params.id, 'student');
  const cur = (await pool.query('SELECT * FROM students WHERE id = $1 AND centre_id = $2', [id, req.user.centre_id])).rows[0];
  if (!cur) throw notFound('Student not found');
  const b = req.body;
  let parent = cur.parent_phone;
  if (b.parent_phone !== undefined) {
    parent = String(b.parent_phone || '').trim() ? normalizePhone(b.parent_phone) : null;
    if (String(b.parent_phone || '').trim() && !parent) throw bad('Parent number must be a 10-digit mobile number');
  }
  let phone = cur.phone;
  if (b.phone !== undefined) {
    phone = normalizePhone(b.phone);
    if (!phone) throw bad('Student mobile must be a 10-digit mobile number');
  }
  const active = typeof b.active === 'boolean' ? b.active : cur.active;
  if (active && !cur.active) await checkStudentLimit(pool, req.user.centre_id);
  // A password that was still the old mobile number follows the new number.
  let hash = cur.password_hash;
  if (phone !== cur.phone && await bcrypt.compare(cur.phone, cur.password_hash)) hash = await bcrypt.hash(phone, 10);
  try {
    const { rows } = await pool.query(
      `UPDATE students SET name = $1, phone = $2, roll_no = $3, parent_phone = $4, parent_name = $5, active = $6, password_hash = $8 WHERE id = $7
       RETURNING id, name, phone, roll_no, parent_name, parent_phone, active`,
      [b.name !== undefined ? text(b.name, 'Name', { max: 120 }) : cur.name, phone,
        b.roll_no !== undefined ? text(String(b.roll_no ?? ''), 'Roll no', { max: 40, required: false }) : cur.roll_no, parent,
        b.parent_name !== undefined ? text(b.parent_name, 'Parent name', { max: 120, required: false }) : cur.parent_name,
        active, id, hash]
    );
    res.json({ student: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw bad('Another student in your centre already has this mobile number');
    throw err;
  }
}));

// POST /api/centre/students/:id/move — { fromBatchId, toBatchId }
router.post('/students/:id/move', route(async (req, res) => {
  const id = intId(req.params.id, 'student');
  const st = await pool.query('SELECT 1 FROM students WHERE id = $1 AND centre_id = $2', [id, req.user.centre_id]);
  if (!st.rowCount) throw notFound('Student not found');
  const from = await ownBatch(req.user.centre_id, req.body.fromBatchId);
  const to = await ownBatch(req.user.centre_id, req.body.toBatchId);
  if (from.id === to.id) throw bad('Pick a different batch');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM batch_students WHERE batch_id = $1 AND student_id = $2', [from.id, id]);
    await client.query('INSERT INTO batch_students (batch_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [to.id, id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true, batch: { id: to.id, name: to.name } });
}));

// GET /api/centre/whatsapp — is the centre's WhatsApp connected (the Waynur team connects it).
router.get('/whatsapp', route(async (req, res) => {
  const c = await pool.query('SELECT display_number, verified_name FROM centre_whatsapp WHERE centre_id = $1', [req.user.centre_id]);
  const m = await pool.query(
    `SELECT kind, phone, body, status, error, created_at, direction FROM whatsapp_messages WHERE centre_id = $1 ORDER BY id DESC LIMIT 50`,
    [req.user.centre_id]);
  res.json({ connected: c.rowCount > 0, number: c.rows[0]?.display_number || null, name: c.rows[0]?.verified_name || null, messages: m.rows });
}));

router.delete('/batches/:id/students/:studentId', route(async (req, res) => {
  const batch = await ownBatch(req.user.centre_id, req.params.id);
  await pool.query('DELETE FROM batch_students WHERE batch_id = $1 AND student_id = $2', [batch.id, intId(req.params.studentId, 'student')]);
  res.json({ ok: true });
}));

export { ownBatch };
export default router;

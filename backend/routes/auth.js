import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { loginLimiter, onboardingLimiter } from '../middleware/rateLimit.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { bad, normalizePhone, route, text } from '../services/util.js';

const router = Router();
const MIN_PASSWORD = 8;

function password(v) {
  if (typeof v !== 'string' || v.length < MIN_PASSWORD) throw bad(`Password must be at least ${MIN_PASSWORD} characters`);
  return v;
}
const email = (v) => {
  const e = text(v, 'Email', { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('Enter a valid email');
  return e;
};

// POST /api/auth/signup — a new centre and its owner account.
router.post('/signup', onboardingLimiter, route(async (req, res) => {
  const centreName = text(req.body.centreName, 'Centre name', { max: 120 });
  const city = text(req.body.city, 'City', { max: 80, required: false });
  const name = text(req.body.name, 'Your name', { max: 120 });
  const mail = email(req.body.email);
  const hash = await bcrypt.hash(password(req.body.password), 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taken = await client.query('SELECT 1 FROM users WHERE email = $1', [mail]);
    if (taken.rowCount) throw bad('That email already has an account');
    const c = await client.query('INSERT INTO centres (name, city) VALUES ($1, $2) RETURNING id, name', [centreName, city]);
    const u = await client.query(
      `INSERT INTO users (centre_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'owner') RETURNING id, name, role`,
      [c.rows[0].id, name, mail, hash]
    );
    await client.query('COMMIT');
    const user = u.rows[0];
    res.status(201).json({
      token: signToken({ kind: 'staff', user_id: user.id, centre_id: c.rows[0].id, role: user.role }),
      user: { ...user, centre: c.rows[0] },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// POST /api/auth/login — teachers and owners.
router.post('/login', loginLimiter, route(async (req, res) => {
  const mail = String(req.body.email || '').trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.role, u.password_hash, u.active, u.centre_id, c.name AS centre_name, c.status
       FROM users u JOIN centres c ON c.id = u.centre_id WHERE u.email = $1`,
    [mail]
  );
  const u = rows[0];
  // Same message for unknown email and wrong password.
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  if (!u.active || u.status !== 'active') return res.status(403).json({ error: 'This account is not active' });
  res.json({
    token: signToken({ kind: 'staff', user_id: u.id, centre_id: u.centre_id, role: u.role }),
    user: { id: u.id, name: u.name, role: u.role, centre: { id: u.centre_id, name: u.centre_name } },
  });
}));

// POST /api/auth/student-login — { centreId, phone, password }
router.post('/student-login', loginLimiter, route(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const centreId = Number(req.body.centreId);
  if (!phone || !Number.isInteger(centreId)) return res.status(401).json({ error: 'Wrong mobile number or password' });
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.password_hash, s.active, c.id AS centre_id, c.name AS centre_name, c.status
       FROM students s JOIN centres c ON c.id = s.centre_id WHERE s.centre_id = $1 AND s.phone = $2`,
    [centreId, phone]
  );
  const s = rows[0];
  if (!s || !(await bcrypt.compare(String(req.body.password || ''), s.password_hash))) {
    return res.status(401).json({ error: 'Wrong mobile number or password' });
  }
  if (!s.active || s.status !== 'active') return res.status(403).json({ error: 'This account is not active' });
  res.json({
    token: signToken({ kind: 'student', student_id: s.id, centre_id: s.centre_id }),
    student: { id: s.id, name: s.name, centre: { id: s.centre_id, name: s.centre_name } },
  });
}));

// GET /api/auth/centre/:id — public: the centre name on the student login page.
router.get('/centre/:id', route(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, name, city FROM centres WHERE id = $1 AND status = 'active'`, [Number(req.params.id) || 0]);
  if (!rows.length) return res.status(404).json({ error: 'Centre not found' });
  res.json({ centre: rows[0] });
}));

router.get('/me', requireAuth, route(async (req, res) => {
  const c = await pool.query('SELECT id, name, city FROM centres WHERE id = $1', [req.user.centre_id]);
  if (req.user.kind === 'staff') {
    const u = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [req.user.user_id]);
    return res.json({ kind: 'staff', user: u.rows[0], centre: c.rows[0] });
  }
  const s = await pool.query('SELECT id, name, phone FROM students WHERE id = $1', [req.user.student_id]);
  res.json({ kind: 'student', student: s.rows[0], centre: c.rows[0] });
}));

export default router;

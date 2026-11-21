import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { loginLimiter, onboardingLimiter } from '../middleware/rateLimit.js';
import crypto from 'crypto';
import { centreBlock, requireAuth, signToken, verifyMagic } from '../middleware/auth.js';
import { sendLogged } from '../services/whatsapp.js';
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
// New centres start on a trial (TRIAL_DAYS, TRIAL_STUDENT_LIMIT); the Super
// Admin moves them to a paid plan. PUBLIC_SIGNUP=false turns this off so only
// the Super Admin can create centres.
router.post('/signup', onboardingLimiter, route(async (req, res) => {
  if (process.env.PUBLIC_SIGNUP === 'false') return res.status(403).json({ error: 'Sign-up is closed. Contact Waynur to get your centre set up.' });
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
    const c = await client.query(
      `INSERT INTO centres (name, city, plan, valid_until, student_limit, contact_phone)
       VALUES ($1, $2, 'trial', current_date + $3::int, $4, $5) RETURNING id, name`,
      [centreName, city, Number(process.env.TRIAL_DAYS) || 14, Number(process.env.TRIAL_STUDENT_LIMIT) || 100, normalizePhone(req.body.phone)]
    );
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

// ── Login with a WhatsApp code (students) ────────────────────────────────
// POST /api/auth/student-otp { centreId, phone } → a 6-digit code on the
// centre's WhatsApp. Same answer whether or not the number is registered.
const OTP_MINUTES = 10;
const hashCode = (centreId, phone, code) => crypto.createHash('sha256').update(`${centreId}:${phone}:${code}:${process.env.JWT_SECRET}`).digest('hex');

router.post('/student-otp', loginLimiter, route(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const centreId = Number(req.body.centreId);
  if (!phone || !Number.isInteger(centreId)) throw bad('Enter your 10-digit mobile number');
  const reply = { ok: true, message: 'If this number is registered, a code has been sent on WhatsApp.' };
  const s = (await pool.query('SELECT id FROM students WHERE centre_id = $1 AND phone = $2 AND active', [centreId, phone])).rows[0];
  if (!s || await centreBlock(centreId)) return res.json(reply);
  const recent = await pool.query(
    `SELECT count(*)::int AS n FROM login_codes WHERE centre_id = $1 AND phone = $2 AND created_at > now() - interval '15 minutes'`, [centreId, phone]);
  if (recent.rows[0].n >= 3) throw bad('Too many codes asked for. Please wait 15 minutes.');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await pool.query(`INSERT INTO login_codes (centre_id, phone, code_hash, expires_at) VALUES ($1,$2,$3, now() + interval '${OTP_MINUTES} minutes')`,
    [centreId, phone, hashCode(centreId, phone, code)]);
  const sent = await sendLogged({ centreId, phone, kind: 'otp', template: 'otp', params: [code] });
  if (sent.status !== 'sent') throw bad('Could not send the code on WhatsApp. Log in with your password, or ask your teacher.');
  res.json(reply);
}));

// POST /api/auth/student-otp/verify { centreId, phone, code }
router.post('/student-otp/verify', loginLimiter, route(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const centreId = Number(req.body.centreId);
  const code = String(req.body.code || '').trim();
  const fail = () => res.status(401).json({ error: 'Wrong or expired code' });
  if (!phone || !Number.isInteger(centreId) || !/^\d{6}$/.test(code)) return fail();
  const row = (await pool.query(
    `SELECT id, code_hash, attempts FROM login_codes WHERE centre_id = $1 AND phone = $2 AND used_at IS NULL AND expires_at > now()
      ORDER BY id DESC LIMIT 1`, [centreId, phone])).rows[0];
  if (!row || row.attempts >= 5) return fail();
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hashCode(centreId, phone, code)));
  if (!ok) {
    await pool.query('UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    return fail();
  }
  await pool.query('UPDATE login_codes SET used_at = now() WHERE id = $1', [row.id]);
  const s = (await pool.query(
    `SELECT s.id, s.name, c.id AS centre_id, c.name AS centre_name FROM students s JOIN centres c ON c.id = s.centre_id
      WHERE s.centre_id = $1 AND s.phone = $2 AND s.active`, [centreId, phone])).rows[0];
  if (!s) return fail();
  res.json({
    token: signToken({ kind: 'student', student_id: s.id, centre_id: s.centre_id }),
    student: { id: s.id, name: s.name, centre: { id: s.centre_id, name: s.centre_name } },
  });
}));

// POST /api/auth/magic { token } — a WhatsApp link → a student session + where to go.
router.post('/magic', loginLimiter, route(async (req, res) => {
  let p;
  try { p = verifyMagic(req.body.token); } catch { return res.status(401).json({ error: 'This link has expired. Ask for a new one by sending any message to your centre on WhatsApp.' }); }
  const blocked = await centreBlock(p.centre_id);
  if (blocked) return res.status(403).json({ error: blocked });
  const s = (await pool.query(
    `SELECT s.id, s.name, c.id AS centre_id, c.name AS centre_name FROM students s JOIN centres c ON c.id = s.centre_id
      WHERE s.id = $1 AND s.centre_id = $2 AND s.active`, [p.student_id, p.centre_id])).rows[0];
  if (!s) return res.status(401).json({ error: 'This account is not active' });
  const path = /^\/(test|practice|result)\/\d+$/.test(p.path || '') ? p.path : '/';
  res.json({
    token: signToken({ kind: 'student', student_id: s.id, centre_id: s.centre_id }),
    student: { id: s.id, name: s.name, centre: { id: s.centre_id, name: s.centre_name } },
    path,
  });
}));

// GET /api/auth/centre/:id — public: the centre name on the student login page.
router.get('/centre/:id', route(async (req, res) => {
  const { rows } = await pool.query(`SELECT id, name, city FROM centres WHERE id = $1 AND status = 'active'`, [Number(req.params.id) || 0]);
  if (!rows.length) return res.status(404).json({ error: 'Centre not found' });
  res.json({ centre: rows[0] });
}));

router.get('/me', requireAuth, route(async (req, res) => {
  if (req.user.kind === 'super_admin') {
    const a = await pool.query('SELECT id, name, email FROM super_admins WHERE id = $1', [req.user.admin_id]);
    return res.json({ kind: 'super_admin', admin: a.rows[0] });
  }
  const c = await pool.query('SELECT id, name, city FROM centres WHERE id = $1', [req.user.centre_id]);
  if (req.user.kind === 'staff') {
    const u = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [req.user.user_id]);
    return res.json({ kind: 'staff', user: u.rows[0], centre: c.rows[0] });
  }
  const s = await pool.query('SELECT id, name, phone FROM students WHERE id = $1', [req.user.student_id]);
  res.json({ kind: 'student', student: s.rows[0], centre: c.rows[0] });
}));

export default router;

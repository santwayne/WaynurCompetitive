import jwt from 'jsonwebtoken';
import pool from '../config/db.js';

// Same idea as Waynur's requireAuth: the JWT says who you are and which
// centre you belong to, so centre_id is never taken from the request body.
// Token payload: { kind: 'staff', user_id, centre_id, role }
//             or { kind: 'student', student_id, centre_id }

const TOKEN_TTL = process.env.TOKEN_TTL || '12h';

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set (32+ characters)');
  return s;
}

export function signToken(payload) {
  return jwt.sign(payload, secret(), { expiresIn: TOKEN_TTL });
}

// WhatsApp links open the app already logged in as that student, straight
// at a test or practice set. They only work for 72 hours and only for that
// one student; a forwarded link gives no more than the student had.
const MAGIC_TTL = process.env.MAGIC_LINK_TTL || '72h';
export function signMagic({ student_id, centre_id, path }) {
  return jwt.sign({ kind: 'magic', student_id, centre_id, path }, secret(), { expiresIn: MAGIC_TTL });
}
export function verifyMagic(token) {
  const p = jwt.verify(String(token || ''), secret(), { algorithms: ['HS256'] });
  if (p.kind !== 'magic') throw new Error('Not a login link');
  return p;
}

// Shared check for staff/student tokens: centre active and its plan not expired.
export async function centreBlock(centreId) {
  const { rows } = await pool.query('SELECT status, valid_until < current_date AS expired FROM centres WHERE id = $1', [centreId]);
  if (!rows.length || rows[0].status !== 'active') return 'This centre is suspended. Please contact Waynur.';
  if (rows[0].expired) return "This centre's plan has ended. Please contact Waynur to renew.";
  return null;
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in' });
  let payload;
  try {
    payload = jwt.verify(token, secret(), { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Your session has ended, please log in again' });
  }
  try {
    if (payload.kind === 'super_admin') {
      const a = await pool.query('SELECT 1 FROM super_admins WHERE id = $1', [payload.admin_id]);
      if (!a.rowCount) return res.status(401).json({ error: 'Invalid session' });
      req.user = payload;
      return next();
    }
    const blocked = await centreBlock(payload.centre_id);
    if (blocked) return res.status(403).json({ error: blocked });
    if (payload.kind === 'staff') {
      const u = await pool.query('SELECT active FROM users WHERE id = $1 AND centre_id = $2', [payload.user_id, payload.centre_id]);
      if (!u.rows[0]?.active) return res.status(401).json({ error: 'This account is not active' });
    } else if (payload.kind === 'student') {
      const s = await pool.query('SELECT active FROM students WHERE id = $1 AND centre_id = $2', [payload.student_id, payload.centre_id]);
      if (!s.rows[0]?.active) return res.status(401).json({ error: 'This account is not active' });
    } else {
      return res.status(401).json({ error: 'Invalid session' });
    }
  } catch (err) {
    return next(err);
  }
  req.user = payload;
  next();
}

export function requireStaff(req, res, next) {
  if (req.user?.kind !== 'staff') return res.status(403).json({ error: 'Teacher login required' });
  next();
}

// Owner / academic head: centre set-up, staff, approving questions.
export function requireLead(req, res, next) {
  if (req.user?.kind !== 'staff' || !['owner', 'academic_head'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Owner or academic head only' });
  }
  next();
}

export function requireSuperAdmin(req, res, next) {
  if (req.user?.kind !== 'super_admin') return res.status(403).json({ error: 'Super Admin only' });
  next();
}

export function requireStudent(req, res, next) {
  if (req.user?.kind !== 'student') return res.status(403).json({ error: 'Student login required' });
  next();
}

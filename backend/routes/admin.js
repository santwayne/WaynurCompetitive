import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { bad, intId, normalizePhone, notFound, route, text } from '../services/util.js';
import { connectCentre, connectionInfo, disconnectCentre, sendLogged } from '../services/whatsapp.js';
import { TEMPLATES, templateLang } from '../services/waTemplates.js';

// Super Admin = the Waynur team. Manages every centre: plans, limits,
// suspend/renew, WhatsApp connection, usage, and the shared exam patterns.
// Super Admins are not tied to a centre and cannot open centre data screens
// (requireStaff rejects their token); they see counts, not students' answers.
const router = Router();

router.post('/login', loginLimiter, route(async (req, res) => {
  const mail = String(req.body.email || '').trim().toLowerCase();
  const a = (await pool.query('SELECT * FROM super_admins WHERE email = $1', [mail])).rows[0];
  if (!a || !(await bcrypt.compare(String(req.body.password || ''), a.password_hash))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  const token = jwt.sign({ kind: 'super_admin', admin_id: a.id }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, admin: { id: a.id, name: a.name, email: a.email } });
}));

router.use(requireAuth, requireSuperAdmin);

const PLANS = ['trial', 'basic', 'ai'];
// Local calendar day (IST on the server) as YYYY-MM-DD.
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ── Overview ─────────────────────────────────────────────────────────────
router.get('/overview', route(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM centres) AS centres,
      (SELECT count(*)::int FROM centres WHERE status = 'active' AND (valid_until IS NULL OR valid_until >= current_date)) AS active,
      (SELECT count(*)::int FROM centres WHERE status = 'suspended') AS suspended,
      (SELECT count(*)::int FROM centres WHERE valid_until < current_date) AS expired,
      (SELECT count(*)::int FROM centres WHERE status = 'active' AND valid_until BETWEEN current_date AND current_date + 7) AS expiring_7d,
      (SELECT count(*)::int FROM centres WHERE plan = 'trial') AS on_trial,
      (SELECT count(*)::int FROM centres WHERE valid_until IS NULL OR student_limit IS NULL) AS missing_limits,
      (SELECT count(*)::int FROM students WHERE active) AS students,
      (SELECT count(*)::int FROM tests WHERE created_at > now() - interval '30 days') AS tests_30d,
      (SELECT count(*)::int FROM attempts WHERE submitted_at > now() - interval '30 days') AS attempts_30d,
      (SELECT count(*)::int FROM ai_usage WHERE created_at > now() - interval '1 day') AS ai_today,
      (SELECT count(*)::int FROM ai_usage WHERE created_at > now() - interval '30 days') AS ai_30d,
      (SELECT count(*)::int FROM centre_whatsapp) AS whatsapp_connected,
      (SELECT count(*)::int FROM whatsapp_messages WHERE direction = 'out' AND status IN ('sent','delivered','read') AND created_at > now() - interval '30 days') AS wa_sent_30d,
      (SELECT count(*)::int FROM whatsapp_messages WHERE direction = 'out' AND status = 'failed' AND created_at > now() - interval '30 days') AS wa_failed_30d
  `);
  const { rows: plans } = await pool.query('SELECT plan, count(*)::int AS n FROM centres GROUP BY plan');
  res.json({ ...rows[0], by_plan: Object.fromEntries(plans.map((p) => [p.plan, p.n])) });
}));

// ── Centres ──────────────────────────────────────────────────────────────
const CENTRE_LIST = `
  SELECT c.id, c.code, c.name, c.city, c.status, c.plan, c.student_limit, c.valid_until, c.ai_daily_limit, c.contact_phone, c.created_at,
         (c.valid_until < current_date) AS expired,
         o.name AS owner_name, o.email AS owner_email, o.phone AS owner_phone,
         (SELECT count(*)::int FROM students s WHERE s.centre_id = c.id AND s.active) AS students,
         (SELECT count(*)::int FROM users u WHERE u.centre_id = c.id AND u.active) AS staff,
         (SELECT count(*)::int FROM batches b WHERE b.centre_id = c.id) AS batches,
         (SELECT count(*)::int FROM tests t WHERE t.centre_id = c.id AND t.created_at > now() - interval '30 days') AS tests_30d,
         (SELECT count(*)::int FROM ai_usage a WHERE a.centre_id = c.id AND a.created_at > now() - interval '30 days') AS ai_30d,
         (SELECT max(t.created_at) FROM tests t WHERE t.centre_id = c.id) AS last_test_at,
         w.display_number AS whatsapp_number
    FROM centres c
    LEFT JOIN LATERAL (SELECT name, email, phone FROM users WHERE centre_id = c.id AND role = 'owner' ORDER BY id LIMIT 1) o ON true
    LEFT JOIN centre_whatsapp w ON w.centre_id = c.id`;

router.get('/centres', route(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const { rows } = await pool.query(
    `${CENTRE_LIST} WHERE ($1 = '' OR c.code = upper($1) OR c.name ILIKE '%' || $1 || '%' OR c.city ILIKE '%' || $1 || '%' OR o.email ILIKE '%' || $1 || '%')
     ORDER BY c.created_at DESC`, [q]);
  res.json({ centres: rows });
}));

async function centreRow(id) {
  const { rows } = await pool.query(`${CENTRE_LIST} WHERE c.id = $1`, [id]);
  if (!rows.length) throw notFound('Centre not found');
  return rows[0];
}

function planFields(b, current = {}) {
  const plan = b.plan !== undefined ? b.plan : current.plan ?? 'trial';
  if (!PLANS.includes(plan)) throw bad('Plan must be trial, basic or ai');
  const num = (v, what) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw bad(`${what} must be a whole number`);
    return n;
  };
  // Every centre needs an end date and a student limit, so nothing runs
  // open-ended by mistake. A trial can run at most TRIAL_MAX_DAYS from today.
  let validUntil = b.validUntil !== undefined ? b.validUntil : current.valid_until ?? null;
  if (validUntil instanceof Date) validUntil = isoDay(validUntil);
  if (!validUntil) throw bad('Set a "Valid until" date. Every centre needs an end date.');
  validUntil = String(validUntil).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || Number.isNaN(Date.parse(validUntil))) throw bad('Valid until must be a date (YYYY-MM-DD)');
  if (plan === 'trial') {
    const maxDays = Number(process.env.TRIAL_MAX_DAYS) || 30;
    const max = new Date(); max.setDate(max.getDate() + maxDays);
    if (validUntil > isoDay(max)) throw bad(`A trial can run for at most ${maxDays} days (until ${isoDay(max)}). Move the centre to a paid plan for longer.`);
  }
  const studentLimit = num(b.studentLimit, 'Student limit');
  const aiLimit = num(b.aiDailyLimit, 'AI calls per day');
  const limit = studentLimit === undefined ? current.student_limit ?? null : studentLimit;
  if (limit == null || limit < 1) throw bad('Set a student limit (1 or more).');
  return {
    plan,
    valid_until: validUntil,
    student_limit: limit,
    ai_daily_limit: aiLimit === undefined ? current.ai_daily_limit ?? null : aiLimit,
  };
}

// POST /api/admin/centres — set up a centre and its owner login.
router.post('/centres', route(async (req, res) => {
  const b = req.body;
  const name = text(b.name, 'Centre name', { max: 120 });
  const ownerEmail = text(b.ownerEmail, 'Owner email', { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw bad('Enter a valid owner email');
  if (typeof b.ownerPassword !== 'string' || b.ownerPassword.length < 8) throw bad('Owner password must be at least 8 characters');
  const ownerPhone = b.ownerPhone ? normalizePhone(b.ownerPhone) : null;
  if (b.ownerPhone && !ownerPhone) throw bad('Owner WhatsApp number must be a 10-digit mobile number');
  const f = planFields(b);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query('SELECT 1 FROM users WHERE email = $1', [ownerEmail])).rowCount) throw bad('That email already has an account');
    const c = await client.query(
      `INSERT INTO centres (name, city, plan, valid_until, student_limit, ai_daily_limit, contact_phone, admin_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [name, text(b.city, 'City', { max: 80, required: false }), f.plan, f.valid_until, f.student_limit, f.ai_daily_limit, ownerPhone,
        text(b.notes, 'Notes', { max: 2000, required: false })]);
    await client.query(
      `INSERT INTO users (centre_id, name, email, phone, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,$5,'owner',true)`,
      [c.rows[0].id, text(b.ownerName, 'Owner name', { max: 120 }), ownerEmail, ownerPhone, await bcrypt.hash(b.ownerPassword, 10)]);
    await client.query('COMMIT');
    res.status(201).json({ centre: await centreRow(c.rows[0].id) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.get('/centres/:id', route(async (req, res) => {
  const id = intId(req.params.id, 'centre');
  const centre = await centreRow(id);
  const [staff, batches, notes, ai, wa] = await Promise.all([
    pool.query('SELECT id, name, email, phone, role, active, created_at FROM users WHERE centre_id = $1 ORDER BY role, name', [id]),
    pool.query(`SELECT b.name, p.name AS exam_pattern, (SELECT count(*)::int FROM batch_students bs JOIN students s ON s.id = bs.student_id WHERE bs.batch_id = b.id AND s.active) AS students
                  FROM batches b LEFT JOIN exam_patterns p ON p.id = b.exam_pattern_id WHERE b.centre_id = $1 ORDER BY b.name`, [id]),
    pool.query('SELECT admin_notes FROM centres WHERE id = $1', [id]),
    pool.query(`SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS n FROM ai_usage
                 WHERE centre_id = $1 AND created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`, [id]),
    pool.query(`SELECT kind, status, count(*)::int AS n FROM whatsapp_messages
                 WHERE centre_id = $1 AND direction = 'out' AND created_at > now() - interval '30 days' GROUP BY kind, status`, [id]),
  ]);
  res.json({
    centre: { ...centre, admin_notes: notes.rows[0].admin_notes },
    staff: staff.rows, batches: batches.rows, ai_by_day: ai.rows, whatsapp_30d: wa.rows,
    whatsapp: await connectionInfo(id),
  });
}));

// PATCH /api/admin/centres/:id — { name?, city?, status?, plan?, validUntil?, studentLimit?, aiDailyLimit?, contactPhone?, notes? }
router.patch('/centres/:id', route(async (req, res) => {
  const id = intId(req.params.id, 'centre');
  const cur = (await pool.query('SELECT * FROM centres WHERE id = $1', [id])).rows[0];
  if (!cur) throw notFound('Centre not found');
  const b = req.body;
  const f = planFields(b, cur);
  const status = b.status !== undefined ? b.status : cur.status;
  if (!['active', 'suspended'].includes(status)) throw bad('Status must be active or suspended');
  let phone = cur.contact_phone;
  if (b.contactPhone !== undefined) {
    phone = String(b.contactPhone || '').trim() ? normalizePhone(b.contactPhone) : null;
    if (String(b.contactPhone || '').trim() && !phone) throw bad('Contact number must be a 10-digit mobile number');
  }
  await pool.query(
    `UPDATE centres SET name = $1, city = $2, status = $3, plan = $4, valid_until = $5, student_limit = $6, ai_daily_limit = $7,
            contact_phone = $8, admin_notes = $9 WHERE id = $10`,
    [b.name !== undefined ? text(b.name, 'Centre name', { max: 120 }) : cur.name,
      b.city !== undefined ? text(b.city, 'City', { max: 80, required: false }) : cur.city,
      status, f.plan, f.valid_until, f.student_limit, f.ai_daily_limit, phone,
      b.notes !== undefined ? text(b.notes, 'Notes', { max: 2000, required: false }) : cur.admin_notes, id]);
  res.json({ centre: await centreRow(id) });
}));

// POST /api/admin/centres/:id/staff/:userId/password { password } — when an owner is locked out.
router.post('/centres/:id/staff/:userId/password', route(async (req, res) => {
  if (typeof req.body.password !== 'string' || req.body.password.length < 8) throw bad('Password must be at least 8 characters');
  const { rowCount } = await pool.query('UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2 AND centre_id = $3',
    [await bcrypt.hash(req.body.password, 10), intId(req.params.userId, 'user'), intId(req.params.id, 'centre')]);
  if (!rowCount) throw notFound('Staff member not found');
  res.json({ ok: true });
}));

// ── WhatsApp connection per centre ───────────────────────────────────────
// PUT { number, phoneNumberId, accessToken?, wabaId? } — checked with Meta before saving.
router.put('/centres/:id/whatsapp', route(async (req, res) => {
  const id = intId(req.params.id, 'centre');
  await centreRow(id);
  const b = req.body;
  res.json({ whatsapp: await connectCentre({ centreId: id, number: b.number, phoneNumberId: b.phoneNumberId, accessToken: b.accessToken, wabaId: b.wabaId, adminId: req.user.admin_id }) });
}));

router.delete('/centres/:id/whatsapp', route(async (req, res) => {
  await disconnectCentre(intId(req.params.id, 'centre'));
  res.json({ ok: true });
}));

// POST { phone } — sends a plain message to check the number works. The
// receiver must have messaged the centre's number in the last 24 hours
// (Meta's rule for non-template messages), e.g. send "hi" from your phone first.
router.post('/centres/:id/whatsapp/test', route(async (req, res) => {
  const id = intId(req.params.id, 'centre');
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw bad('Enter a 10-digit mobile number');
  const r = await sendLogged({ centreId: id, phone, kind: 'admin_test', text: 'Test message from Waynur Competitive. WhatsApp is connected.' });
  res.json(r);
}));

router.get('/centres/:id/messages', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, direction, phone, kind, template, body, status, error, created_at FROM whatsapp_messages
      WHERE centre_id = $1 ORDER BY id DESC LIMIT 100`, [intId(req.params.id, 'centre')]);
  res.json({ messages: rows });
}));

router.get('/whatsapp/templates', route(async (req, res) => {
  res.json({ language: templateLang(), templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, ...t })) });
}));

// ── Shared exam patterns (centre_id NULL) ────────────────────────────────
router.get('/exam-patterns', route(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*, (SELECT count(*)::int FROM batches b WHERE b.exam_pattern_id = p.id) AS batches
       FROM exam_patterns p WHERE p.centre_id IS NULL ORDER BY p.code, p.version DESC`);
  res.json({ patterns: rows });
}));

function patternFields(b) {
  const duration = Number(b.durationMin);
  const correct = Number(b.marksCorrect);
  const wrong = Number(b.marksWrong ?? 0);
  if (!Number.isInteger(duration) || duration <= 0) throw bad('Duration must be minutes, e.g. 60');
  if (!(correct > 0) || !(wrong >= 0)) throw bad('Check the marks: correct > 0, wrong ≥ 0');
  const sections = Array.isArray(b.sections) ? b.sections.map((x) => ({ subject: text(x.subject, 'Section subject', { max: 120 }), questions: intId(x.questions, 'section questions') })) : [];
  return { duration, correct, wrong, sections };
}

// POST — a new shared pattern, or a new version when the official pattern changes.
router.post('/exam-patterns', route(async (req, res) => {
  const b = req.body;
  const f = patternFields(b);
  try {
    const { rows } = await pool.query(
      `INSERT INTO exam_patterns (centre_id, code, name, version, duration_min, marks_correct, marks_wrong, sections)
       VALUES (NULL,$1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [text(b.code, 'Code', { max: 40 }).toUpperCase(), text(b.name, 'Name', { max: 120 }), text(b.version, 'Version', { max: 20 }),
        f.duration, f.correct, f.wrong, JSON.stringify(f.sections)]);
    res.status(201).json({ pattern: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw bad('That code and version already exist. Use a new version, e.g. 2026.');
    throw err;
  }
}));

// PATCH — fix a typo in a shared pattern. Tests already made keep the marks they were made with.
router.patch('/exam-patterns/:id', route(async (req, res) => {
  const id = intId(req.params.id, 'pattern');
  const cur = (await pool.query('SELECT * FROM exam_patterns WHERE id = $1 AND centre_id IS NULL', [id])).rows[0];
  if (!cur) throw notFound('Shared pattern not found');
  const b = { durationMin: cur.duration_min, marksCorrect: cur.marks_correct, marksWrong: cur.marks_wrong, sections: cur.sections, ...req.body };
  const f = patternFields(b);
  const { rows } = await pool.query(
    'UPDATE exam_patterns SET name = $1, duration_min = $2, marks_correct = $3, marks_wrong = $4, sections = $5 WHERE id = $6 RETURNING *',
    [b.name !== undefined ? text(b.name, 'Name', { max: 120 }) : cur.name, f.duration, f.correct, f.wrong, JSON.stringify(f.sections), id]);
  res.json({ pattern: rows[0] });
}));

export default router;

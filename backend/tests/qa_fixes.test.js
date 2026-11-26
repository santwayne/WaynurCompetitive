// The QA bug list (Nov 2026): one test per fix, through the HTTP API.
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/wc_test npm test
// The database is wiped and migrated at the start.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = DB;
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789';
delete process.env.ANTHROPIC_API_KEY;
const skip = !DB && 'set TEST_DATABASE_URL to run the API tests';

let request; let app; let pool;
before(async () => {
  if (skip) return;
  ({ default: request } = await import('supertest'));
  ({ default: pool } = await import('../config/db.js'));
  const { createApp } = await import('../app.js');
  app = createApp();
  const here = path.dirname(fileURLToPath(import.meta.url));
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const schema = fs.readFileSync(path.join(here, '../models/schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(schema); // migrations must be safe to run again
});
after(async () => { if (pool) await pool.end(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const S = {};

async function staffLogin(email, password, newPassword) {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  if (r.body.user.must_change_password) {
    const c = await request(app).post('/api/auth/change-password').set(auth(r.body.token)).send({ currentPassword: password, newPassword });
    assert.equal(c.status, 200, JSON.stringify(c.body));
  }
  return r.body.token;
}

test('set-up: centre, owner, academic head, teacher', { skip }, async () => {
  const r = await request(app).post('/api/auth/signup').send({ centreName: 'Sharma Classes', name: 'Owner', email: 'o@sc.in', password: 'password123' });
  assert.equal(r.status, 201);
  S.owner = r.body.token;
  S.code = r.body.user.centre.code;
  for (const [email, role] of [['head@sc.in', 'academic_head'], ['t@sc.in', 'teacher']]) {
    const a = await request(app).post('/api/centre/staff').set(auth(S.owner)).send({ name: role, email, phone: '9800000002', password: 'given-pass-1', role });
    assert.equal(a.status, 201, JSON.stringify(a.body));
  }
  S.head = await staffLogin('head@sc.in', 'given-pass-1', 'head-own-pass');
  S.teacher = await staffLogin('t@sc.in', 'given-pass-1', 'teacher-own-pass');
  await request(app).patch('/api/centre/staff/1').set(auth(S.owner)).send({ phone: '9800000001' });
});

test('centre code: random, and the plain id no longer finds the centre', { skip }, async () => {
  assert.match(S.code, /^[A-Z2-9]{6}$/);
  assert.equal((await request(app).get(`/api/auth/centre/${S.code.toLowerCase()}`)).status, 200);
  assert.equal((await request(app).get('/api/auth/centre/1')).status, 404);
  const me = await request(app).get('/api/auth/me').set(auth(S.owner));
  assert.equal(me.body.centre.code, S.code);
});

test('only the owner manages staff; the academic head cannot change the owner number or add staff', { skip }, async () => {
  assert.equal((await request(app).post('/api/centre/staff').set(auth(S.head)).send({ name: 'X', email: 'x@sc.in', password: 'password123' })).status, 403);
  assert.equal((await request(app).patch('/api/centre/staff/1').set(auth(S.head)).send({ phone: '9811111111' })).status, 403);
  const staff = (await request(app).get('/api/centre/staff').set(auth(S.owner))).body.staff;
  assert.equal(staff.find((u) => u.role === 'owner').phone, '9800000001');
});

test('teachers do not see other people\'s email and number', { skip }, async () => {
  const staff = (await request(app).get('/api/centre/staff').set(auth(S.teacher))).body.staff;
  const owner = staff.find((u) => u.role === 'owner');
  assert.equal(owner.email, null);
  assert.equal(owner.phone, null);
  assert.equal(staff.find((u) => u.role === 'teacher').email, 't@sc.in', 'own details still shown');
});

test('students: edit name and mobile, mark as left (frees the limit), restore, move batch', { skip }, async () => {
  await pool.query('UPDATE centres SET student_limit = 2');
  const a = (await request(app).post('/api/centre/batches').set(auth(S.owner)).send({ name: 'A' })).body.batch.id;
  const b = (await request(app).post('/api/centre/batches').set(auth(S.owner)).send({ name: 'B' })).body.batch.id;
  const s1 = (await request(app).post('/api/centre/students').set(auth(S.owner)).send({ name: 'Amn', phone: '9876500001', batchId: a })).body.student_id;
  await request(app).post('/api/centre/students').set(auth(S.owner)).send({ name: 'Bal', phone: '9876500002', batchId: a });
  const full = await request(app).post('/api/centre/students').set(auth(S.owner)).send({ name: 'Ch', phone: '9876500003', batchId: a });
  assert.equal(full.status, 400);

  const e = await request(app).patch(`/api/centre/students/${s1}`).set(auth(S.teacher)).send({ name: 'Aman', phone: '+91 98765 00009', roll_no: '7' });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.student.phone, '9876500009');
  assert.equal(e.body.student.name, 'Aman');
  const login = await request(app).post('/api/auth/student-login').send({ centreCode: S.code, phone: '9876500009', password: '9876500009' });
  assert.equal(login.status, 200, 'the default password follows the new number');
  const dup = await request(app).patch(`/api/centre/students/${s1}`).set(auth(S.owner)).send({ phone: '9876500002' });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /already has this mobile/);

  assert.equal((await request(app).patch(`/api/centre/students/${s1}`).set(auth(S.owner)).send({ active: false })).status, 200);
  assert.equal((await request(app).post('/api/centre/students').set(auth(S.owner)).send({ name: 'Ch', phone: '9876500003', batchId: a })).status, 201, 'a left student frees their place');
  const back = await request(app).patch(`/api/centre/students/${s1}`).set(auth(S.owner)).send({ active: true });
  assert.equal(back.status, 400, 'restoring respects the limit');

  const mv = await request(app).post(`/api/centre/students/${s1}/move`).set(auth(S.owner)).send({ fromBatchId: a, toBatchId: b });
  assert.equal(mv.status, 200);
  const batchB = (await request(app).get(`/api/centre/batches/${b}`).set(auth(S.owner))).body.students;
  assert.deepEqual(batchB.map((x) => x.id), [s1]);
  const batches = (await request(app).get('/api/centre/batches').set(auth(S.owner))).body.batches;
  assert.equal(batches.find((x) => x.id === a).students, 2, 'left students are not counted');
  await pool.query('UPDATE centres SET student_limit = 100');
  S.batch = a;
});

test('a batch exam pattern can be set after the batch was made', { skip }, async () => {
  const p = (await request(app).get('/api/syllabus/exam-patterns').set(auth(S.owner))).body.patterns[0];
  const r = await request(app).patch(`/api/centre/batches/${S.batch}`).set(auth(S.owner)).send({ examPatternId: p.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.batch.exam_pattern_id, p.id);
  assert.equal((await request(app).patch(`/api/centre/batches/${S.batch}`).set(auth(S.teacher)).send({ examPatternId: null })).status, 403);
});

test('topics: "Maths/Percentage" and "math/Percentages" are one topic; old duplicates can be merged', { skip }, async () => {
  const t1 = (await request(app).post('/api/syllabus/topics').set(auth(S.owner)).send({ subject: 'Maths', name: 'Percentage' })).body.topic_id;
  const t2 = (await request(app).post('/api/syllabus/topics').set(auth(S.owner)).send({ subject: 'math', name: ' Percentages ' })).body.topic_id;
  assert.equal(t1, t2);
  const t3 = (await request(app).post('/api/syllabus/topics').set(auth(S.owner)).send({ subject: 'math', name: 'Time and Work' })).body.topic_id;
  const subj = (await pool.query('SELECT subject FROM topics WHERE id = $1', [t3])).rows[0].subject;
  assert.equal(subj, 'Maths', 'a known subject keeps its first spelling');
  // An old duplicate (made before this fix) is merged.
  const old = (await pool.query(`INSERT INTO topics (centre_id, subject, name) VALUES (1, 'math', 'Percentages') RETURNING id`)).rows[0].id;
  await request(app).post('/api/syllabus/questions').set(auth(S.owner)).send({ topicId: old, stem: 'Q?', options: ['a', 'b'], correctIndex: 1 });
  const m = await request(app).post('/api/syllabus/topics/merge').set(auth(S.owner)).send({ fromId: old, intoId: t1 });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.equal(m.body.questions_moved, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM topics WHERE id = $1', [old])).rows[0].n, 0);
  S.topic = t1;
});

test('questions: no default answer, difficulty, and editing', { skip }, async () => {
  const none = await request(app).post('/api/syllabus/questions').set(auth(S.owner)).send({ topicId: S.topic, stem: 'No answer?', options: ['a', 'b'], correctIndex: null });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /correct answer/);
  const q = await request(app).post('/api/syllabus/questions').set(auth(S.owner)).send({ topicId: S.topic, stem: '10% of 50?', options: ['4', '5'], correctIndex: 1, difficulty: 3 });
  assert.equal(q.status, 201);
  const e = await request(app).put(`/api/syllabus/questions/${q.body.question.id}`).set(auth(S.owner))
    .send({ topicId: S.topic, stem: '10% of 50 is?', options: ['4', '5', '6'], correctIndex: 1, difficulty: 'easy' });
  assert.equal(e.status, 200);
  const row = (await pool.query('SELECT stem, difficulty, options FROM questions WHERE id = $1', [q.body.question.id])).rows[0];
  assert.equal(row.stem, '10% of 50 is?');
  assert.equal(row.difficulty, 1);
  const csv = 'subject,topic,question,option_a,option_b,option_c,option_d,answer,explanation,difficulty\nMaths,Percentage,Q,1,2,3,4,,x,2';
  const imp = await request(app).post('/api/syllabus/questions/import').set(auth(S.owner)).send({ csv });
  assert.equal(imp.status, 400);
  assert.match(imp.body.error, /Row 2 of the file.*No questions were imported/);
});

test('CSV student import says plainly that nothing was added', { skip }, async () => {
  const r = await request(app).post(`/api/centre/batches/${S.batch}/students/import`).set(auth(S.owner)).send({ csv: 'name,phone\nOk,9876511111\nBad,123' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Row 3 of the file.*No students were added/);
});

test('Super Admin: end date and student limit are required; a trial is capped', { skip }, async () => {
  const bcrypt = (await import('bcryptjs')).default;
  await pool.query(`INSERT INTO super_admins (name, email, password_hash) VALUES ('A', 'a@w.in', $1)`, [await bcrypt.hash('super-secret-pass', 10)]);
  const admin = (await request(app).post('/api/admin/login').send({ email: 'a@w.in', password: 'super-secret-pass' })).body.token;
  const base = { name: 'X', ownerName: 'Y', ownerEmail: 'y@x.in', ownerPassword: 'password123', plan: 'basic' };
  const noDate = await request(app).post('/api/admin/centres').set(auth(admin)).send({ ...base, studentLimit: 50 });
  assert.equal(noDate.status, 400);
  assert.match(noDate.body.error, /Valid until/);
  const noLimit = await request(app).post('/api/admin/centres').set(auth(admin)).send({ ...base, validUntil: '2099-01-01' });
  assert.equal(noLimit.status, 400);
  assert.match(noLimit.body.error, /student limit/);
  const longTrial = await request(app).post('/api/admin/centres').set(auth(admin)).send({ ...base, plan: 'trial', studentLimit: 50, validUntil: '2028-01-01' });
  assert.equal(longTrial.status, 400);
  assert.match(longTrial.body.error, /trial can run/);
  // An old centre with no end date must get one before anything else is saved.
  const old = (await pool.query(`INSERT INTO centres (name) VALUES ('pankaj thakur') RETURNING id`)).rows[0].id;
  const p = await request(app).patch(`/api/admin/centres/${old}`).set(auth(admin)).send({ notes: 'hi' });
  assert.equal(p.status, 400);
  const ov = (await request(app).get('/api/admin/overview').set(auth(admin))).body;
  assert.ok(ov.missing_limits >= 1);
});

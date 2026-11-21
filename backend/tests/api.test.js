// End to end through the HTTP API against a real Postgres.
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
delete process.env.ANTHROPIC_API_KEY; // the no-AI fallbacks are what we test
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
  await pool.query(fs.readFileSync(path.join(here, '../models/schema.sql'), 'utf8'));
});
after(async () => { if (pool) await pool.end(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const S = {}; // shared state across the steps below (they run in order)

test('owner signs up a centre and sees the SSC / RRB templates', { skip }, async () => {
  const res = await request(app).post('/api/auth/signup').send({ centreName: 'Gill Academy', city: 'Ludhiana', name: 'Harpreet', email: 'owner@gill.in', password: 'password123' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  S.owner = res.body.token;
  S.centreId = res.body.user.centre.id;
  const p = await request(app).get('/api/syllabus/exam-patterns').set(auth(S.owner));
  const cgl = p.body.patterns.find((x) => x.code === 'SSC-CGL-T1');
  assert.equal(Number(cgl.marks_wrong), 0.5);
  S.cgl = cgl.id;
  assert.equal((await request(app).post('/api/auth/signup').send({ centreName: 'X', name: 'Y', email: 'OWNER@gill.in', password: 'password123' })).status, 400);
});

test('batch, students from CSV (one bad row rejects the file), teacher account', { skip }, async () => {
  const b = await request(app).post('/api/centre/batches').set(auth(S.owner)).send({ name: 'CGL Morning', examPatternId: S.cgl });
  assert.equal(b.status, 201);
  S.batch = b.body.batch.id;

  const bad = await request(app).post(`/api/centre/batches/${S.batch}/students/import`).set(auth(S.owner))
    .send({ csv: 'name,phone,roll_no\nAman,9876500001,1\nBroken,12345,2' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Row 3/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM students')).rows[0].n, 0, 'nothing saved from a bad file');

  const csv = ['name,phone,roll_no', 'Aman,9876500001,1', 'Baljit,9876500002,2', 'Chetna,+91 98765 00003,3', 'Deep,9876500004,4'].join('\n');
  const ok = await request(app).post(`/api/centre/batches/${S.batch}/students/import`).set(auth(S.owner)).send({ csv });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.created, 4);

  const t = await request(app).post('/api/centre/staff').set(auth(S.owner)).send({ name: 'Ravi', email: 'ravi@gill.in', password: 'password123', role: 'teacher' });
  assert.equal(t.status, 201);
  S.teacher = (await request(app).post('/api/auth/login').send({ email: 'ravi@gill.in', password: 'password123' })).body.token;
  assert.equal((await request(app).post('/api/centre/staff').set(auth(S.teacher)).send({ name: 'Z', email: 'z@gill.in', password: 'password123' })).status, 403);
});

test('question bank: CSV import (owner → approved), teacher question waits for approval', { skip }, async () => {
  const head = 'subject,topic,question,option_a,option_b,option_c,option_d,answer,explanation,difficulty';
  const rows = [];
  for (let i = 1; i <= 6; i += 1) rows.push(`Quant,Percentages,"What is ${i * 10}% of 200?",${i * 20},${i * 10},${i * 30},${i * 5},A,"${i * 10}% of 200 = ${i * 10}/100 × 200 = ${i * 20}.",2`);
  for (let i = 1; i <= 6; i += 1) rows.push(`Quant,Time & Work,"A does a job in ${i + 1} days. Work per day?",1/${i + 1},${i + 1},1,0,A,"Work per day is the reciprocal of the days taken.",2`);
  const imp = await request(app).post('/api/syllabus/questions/import').set(auth(S.owner)).send({ csv: [head, ...rows].join('\n') });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  assert.equal(imp.body.status, 'approved');
  const topics = (await request(app).get('/api/syllabus/topics').set(auth(S.owner))).body.topics;
  S.pct = topics.find((t) => t.name === 'Percentages').id;
  S.tw = topics.find((t) => t.name === 'Time & Work').id;
  assert.equal(topics.find((t) => t.id === S.pct).approved, 6);

  const q = await request(app).post('/api/syllabus/questions').set(auth(S.teacher))
    .send({ topicId: S.pct, stem: 'Draft one?', options: ['a', 'b'], correctIndex: 1 });
  assert.equal(q.status, 201);
  assert.equal(q.body.question.status, 'draft');
  assert.equal((await request(app).post('/api/syllabus/questions/status').set(auth(S.teacher)).send({ ids: [q.body.question.id], status: 'approved' })).status, 403);
  S.draftQ = q.body.question.id;
});

test('a test uses approved questions only and takes marks from the exam pattern', { skip }, async () => {
  const withDraft = await request(app).post('/api/tests').set(auth(S.teacher))
    .send({ batchId: S.batch, title: 'x', kind: 'scheduled', questionIds: [S.draftQ] });
  assert.equal(withDraft.status, 400);

  const t = await request(app).post('/api/tests').set(auth(S.teacher))
    .send({ batchId: S.batch, title: 'Quant check 1', kind: 'exit_ticket', picks: [{ topicId: S.pct, count: 2 }, { topicId: S.tw, count: 2 }] });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(Number(t.body.test.marks_correct), 2);
  assert.equal(Number(t.body.test.marks_wrong), 0.5);
  assert.equal(t.body.test.duration_min, 10, 'exit tickets default to 10 minutes');
  S.test = t.body.test.id;
});

async function studentToken(phone) {
  const res = await request(app).post('/api/auth/student-login').send({ centreId: S.centreId, phone, password: phone });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

// Each student answers: Percentages all right; Time & Work as given.
async function takeTest(token, testId, timeAndWorkRight) {
  const start = await request(app).post(`/api/student/tests/${testId}/start`).set(auth(token));
  assert.equal(start.status, 200, JSON.stringify(start.body));
  for (const q of start.body.questions) assert.equal(q.correct_index, undefined, 'no answers sent to the student');
  const ids = start.body.questions.map((q) => q.id);
  const { rows } = await pool.query('SELECT id, topic_id, correct_index FROM questions WHERE id = ANY($1::int[])', [ids]);
  const answers = {};
  for (const q of rows) answers[q.id] = q.topic_id === S.pct || timeAndWorkRight ? q.correct_index : (q.correct_index + 1) % 4;
  return request(app).post(`/api/student/tests/${testId}/submit`).set(auth(token)).send({ answers });
}

test('students take the test online (not before it is published), scores use negative marking', { skip }, async () => {
  S.students = {};
  for (const p of ['9876500001', '9876500002', '9876500003', '9876500004']) S.students[p] = await studentToken(p);
  assert.equal((await request(app).post(`/api/student/tests/${S.test}/start`).set(auth(S.students['9876500001']))).status, 400);
  assert.equal((await request(app).post(`/api/tests/${S.test}/status`).set(auth(S.teacher)).send({ status: 'published' })).status, 200);

  const sub = await takeTest(S.students['9876500001'], S.test, true);
  assert.deepEqual([sub.body.score, sub.body.correct], [8, 4]);
  const weak = await takeTest(S.students['9876500002'], S.test, false);
  assert.equal(weak.body.score, 3); // 2×2 − 2×0.5
  await takeTest(S.students['9876500003'], S.test, false);
  // 9876500004 skips the test
  assert.equal((await request(app).post(`/api/student/tests/${S.test}/start`).set(auth(S.students['9876500001']))).status, 400, 'no restart after submitting');
  assert.equal((await request(app).post(`/api/student/tests/${S.test}/submit`).set(auth(S.students['9876500001'])).send({ answers: {} })).status, 400, 'no second submit');
  assert.equal((await request(app).get('/api/centre/batches').set(auth(S.students['9876500001']))).status, 403, 'students stay out of staff routes');
});

test('diagnosis → next-class actions + practice sets (no AI key: template text)', { skip }, async () => {
  const d = await request(app).get(`/api/tests/${S.test}/diagnosis`).set(auth(S.teacher));
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.diagnosis.participation, { submitted: 3, total: 4, pct: 75 });
  const tw = d.body.diagnosis.topics.find((t) => t.topic_id === S.tw);
  assert.equal(tw.accuracy, 33.3);
  assert.equal(tw.reteach, true);
  assert.equal(d.body.diagnosis.not_attempted[0].name, 'Deep');

  const a = await request(app).post(`/api/tests/${S.test}/actions`).set(auth(S.teacher));
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(a.body, { created: 2, practice_sets: 2 });
  assert.deepEqual((await request(app).post(`/api/tests/${S.test}/actions`).set(auth(S.teacher))).body, { created: 0, practice_sets: 0 }, 'pressing twice adds nothing');
  const list = (await request(app).get(`/api/tests/${S.test}/actions`).set(auth(S.teacher))).body.actions;
  assert.deepEqual(list.map((x) => x.kind).sort(), ['practice', 'reteach']);
  assert.match(list.find((x) => x.kind === 'reteach').note, /Time & Work/);
});

test('a weak student practises: fresh questions, answer shown after answering, hint without AI', { skip }, async () => {
  const tok = S.students['9876500002'];
  const sets = (await request(app).get('/api/student/practice').set(auth(tok))).body.practice;
  assert.equal(sets.length, 1);
  assert.equal(sets[0].topic, 'Time & Work');
  const set = (await request(app).get(`/api/student/practice/${sets[0].id}`).set(auth(tok))).body;
  const testQs = (await pool.query('SELECT question_id FROM test_questions WHERE test_id = $1', [S.test])).rows.map((r) => r.question_id);
  assert.equal(set.questions.length, 4); // 6 in the topic − 2 used in the test
  assert.ok(set.questions.every((q) => !testQs.includes(q.id) && q.correct_index === undefined));

  const hint = await request(app).post(`/api/student/practice/${sets[0].id}/hint`).set(auth(tok)).send({ questionId: set.questions[0].id });
  assert.equal(hint.body.ai, false);
  assert.match(hint.body.hint, /^Start here: Work per day is the reciprocal/);

  for (const q of set.questions) {
    const right = (await pool.query('SELECT correct_index FROM questions WHERE id = $1', [q.id])).rows[0].correct_index;
    const ans = await request(app).post(`/api/student/practice/${sets[0].id}/answer`).set(auth(tok)).send({ questionId: q.id, chosen: right });
    assert.equal(ans.body.correct, true);
  }
  assert.ok((await request(app).get('/api/student/practice').set(auth(tok))).body.practice[0].completed_at);
  assert.equal((await request(app).get(`/api/student/practice/${sets[0].id}`).set(auth(S.students['9876500001']))).status, 404, 'not someone else\'s set');
});

test('re-test with fresh questions, then verify shows the change for students in both', { skip }, async () => {
  const r = await request(app).post(`/api/tests/${S.test}/retest`).set(auth(S.teacher));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.test.kind, 'retest');
  assert.equal(r.body.questions, 4);
  S.retest = r.body.test.id;
  const orig = new Set((await pool.query('SELECT question_id FROM test_questions WHERE test_id = $1', [S.test])).rows.map((x) => x.question_id));
  const fresh = (await pool.query('SELECT question_id FROM test_questions WHERE test_id = $1', [S.retest])).rows.map((x) => x.question_id);
  assert.ok(fresh.every((id) => !orig.has(id)));

  await request(app).post(`/api/tests/${S.retest}/status`).set(auth(S.teacher)).send({ status: 'published' });
  await takeTest(S.students['9876500002'], S.retest, true); // improved after practice
  await takeTest(S.students['9876500004'], S.retest, true); // missed the first test → not compared

  const v = await request(app).get(`/api/tests/${S.retest}/verify`).set(auth(S.teacher));
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.comparison.students_in_both, 1);
  const tw = v.body.comparison.topics.find((t) => t.topic_id === S.tw);
  assert.deepEqual([tw.before, tw.after, tw.change], [0, 100, 100]);
});

test('paper test: teacher enters answers, scores and diagnosis work the same', { skip }, async () => {
  const t = await request(app).post('/api/tests').set(auth(S.teacher))
    .send({ batchId: S.batch, title: 'Paper test', kind: 'scheduled', mode: 'paper', picks: [{ topicId: S.pct, count: 2 }], durationMin: 20 });
  const test = (await request(app).get(`/api/tests/${t.body.test.id}`).set(auth(S.teacher))).body;
  const right = test.questions.map((q) => q.correct_index);
  const ids = (await pool.query('SELECT id, phone FROM students ORDER BY phone')).rows;
  const save = await request(app).post(`/api/tests/${t.body.test.id}/paper`).set(auth(S.teacher)).send({
    results: [{ studentId: ids[0].id, answers: right }, { studentId: ids[1].id, answers: [null, (right[1] + 1) % 4] }],
  });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const after = (await request(app).get(`/api/tests/${t.body.test.id}`).set(auth(S.teacher))).body.attempts;
  assert.deepEqual(after.map((a) => Number(a.score)).sort((x, y) => x - y), [-0.5, 4]); // 2 right × 2; 1 skipped + 1 wrong × −0.5
  const bad = await request(app).post(`/api/tests/${t.body.test.id}/paper`).set(auth(S.teacher)).send({ results: [{ studentId: ids[0].id, answers: [0] }] });
  assert.equal(bad.status, 400);
});

test('another centre sees none of this', { skip }, async () => {
  const other = (await request(app).post('/api/auth/signup').send({ centreName: 'Other', name: 'O', email: 'o@other.in', password: 'password123' })).body.token;
  assert.equal((await request(app).get(`/api/tests/${S.test}`).set(auth(other))).status, 404);
  assert.equal((await request(app).get(`/api/tests/${S.test}/diagnosis`).set(auth(other))).status, 404);
  assert.equal((await request(app).get(`/api/centre/batches/${S.batch}`).set(auth(other))).status, 404);
  assert.deepEqual((await request(app).get('/api/syllabus/questions').set(auth(other))).body.questions, []);
  assert.equal((await request(app).post('/api/tests').set(auth(other)).send({ batchId: S.batch, title: 'x', kind: 'scheduled', questionIds: [1] })).status, 404);
  const login = await request(app).post('/api/auth/student-login').send({ centreId: S.centreId + 1, phone: '9876500001', password: '9876500001' });
  assert.equal(login.status, 401, 'a student belongs to one centre only');
});

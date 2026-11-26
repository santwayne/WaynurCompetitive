// Super Admin panel + WhatsApp-first flows, end to end against a real
// Postgres and a fake Meta Graph API (WHATSAPP_API_BASE).
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/wc_test npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = DB;
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789';
process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-credentials-key-0123456789abcdef';
process.env.WHATSAPP_APP_SECRET = 'app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
process.env.APP_URL = 'https://competitive.example';
process.env.NOTIFY_SYNC = '1';
delete process.env.ANTHROPIC_API_KEY;
const skip = !DB && 'set TEST_DATABASE_URL to run the API tests';

// ── Fake Graph API ───────────────────────────────────────────────────────
const PHONE_ID = '1234567890123';
const TOKEN = 'EAAGtesttoken0000xyz';
const sent = []; // every POST /<phone_id>/messages body
let meta;
function startMeta() {
  return new Promise((resolve) => {
    meta = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const ok = req.headers.authorization === `Bearer ${TOKEN}`;
        res.setHeader('Content-Type', 'application/json');
        if (!ok) { res.statusCode = 401; return res.end(JSON.stringify({ error: { code: 190, message: 'Invalid OAuth access token' } })); }
        if (req.method === 'GET' && req.url.startsWith(`/${PHONE_ID}`)) {
          return res.end(JSON.stringify({ display_phone_number: '+91 98140 00000', verified_name: 'Gill Academy', quality_rating: 'GREEN' }));
        }
        if (req.method === 'POST' && req.url === `/${PHONE_ID}/messages`) {
          const b = JSON.parse(body);
          sent.push(b);
          return res.end(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }));
        }
        res.statusCode = 404; res.end('{}');
      });
    }).listen(0, () => {
      process.env.WHATSAPP_API_BASE = `http://127.0.0.1:${meta.address().port}`;
      resolve();
    });
  });
}

let request; let app; let pool; let processWebhook;
before(async () => {
  if (skip) return;
  await startMeta();
  ({ default: request } = await import('supertest'));
  ({ default: pool } = await import('../config/db.js'));
  ({ processWebhook } = await import('../services/waInbound.js'));
  const { createApp } = await import('../app.js');
  app = createApp();
  const here = path.dirname(fileURLToPath(import.meta.url));
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(fs.readFileSync(path.join(here, '../models/schema.sql'), 'utf8'));
  const bcrypt = (await import('bcryptjs')).default;
  await pool.query(`INSERT INTO super_admins (name, email, password_hash) VALUES ('Pankaj', 'admin@waynur.com', $1)`, [await bcrypt.hash('super-secret-pass', 10)]);
});
after(async () => { if (pool) await pool.end(); if (meta) meta.close(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const S = {};
const textOf = (m) => m.text?.body || '';
const sentTo = (phone10) => sent.filter((m) => m.to === `91${phone10}`);
const inbound = (from, body, id) => ({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_ID }, messages: [{ id, from: `91${from}`, type: 'text', text: { body } }] } }] }],
});

test('super admin logs in; tokens cannot cross between the admin and centre panels', { skip }, async () => {
  assert.equal((await request(app).post('/api/admin/login').send({ email: 'admin@waynur.com', password: 'wrong' })).status, 401);
  const r = await request(app).post('/api/admin/login').send({ email: 'ADMIN@waynur.com', password: 'super-secret-pass' });
  assert.equal(r.status, 200);
  S.admin = r.body.token;
  assert.equal((await request(app).get('/api/admin/overview').set(auth(S.admin))).status, 200);
  assert.equal((await request(app).get('/api/centre/batches').set(auth(S.admin))).status, 403, 'admin token is not a centre login');
});

test('admin creates a centre with owner, plan and a student limit', { skip }, async () => {
  const c = await request(app).post('/api/admin/centres').set(auth(S.admin)).send({
    name: 'Gill Academy', city: 'Ludhiana', ownerName: 'Harpreet', ownerEmail: 'owner@gill.in', ownerPassword: 'password123',
    ownerPhone: '9814011111', plan: 'basic', studentLimit: 3, validUntil: '2099-12-31',
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  S.centre = c.body.centre.id;
  S.code = c.body.centre.code;
  assert.match(S.code, /^[A-Z2-9]{6}$/, 'random centre code, not the id');
  assert.equal(c.body.centre.plan, 'basic');

  const o = await request(app).post('/api/auth/login').send({ email: 'owner@gill.in', password: 'password123' });
  S.owner = o.body.token;
  S.ownerId = o.body.user.id;
  // The Super Admin chose this password, so the owner must set their own first.
  assert.equal(o.body.user.must_change_password, true);
  const blocked = await request(app).get('/api/centre/batches').set(auth(S.owner));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'must_change_password');
  assert.equal((await request(app).post('/api/auth/change-password').set(auth(S.owner)).send({ currentPassword: 'password123', newPassword: 'password123' })).status, 400);
  assert.equal((await request(app).post('/api/auth/change-password').set(auth(S.owner)).send({ currentPassword: 'password123', newPassword: 'owner-own-pass' })).status, 200);
  assert.equal((await request(app).get('/api/admin/overview').set(auth(S.owner))).status, 403, 'owner is not a super admin');

  const p = (await request(app).get('/api/syllabus/exam-patterns').set(auth(S.owner))).body.patterns.find((x) => x.code === 'SSC-CGL-T1');
  S.batch = (await request(app).post('/api/centre/batches').set(auth(S.owner)).send({ name: 'CGL Eve', examPatternId: p.id })).body.batch.id;
  const csv = ['name,phone,roll_no,parent_phone,parent_name', 'Aman,9876500001,1,9888800001,Mr Singh', 'Baljit,9876500002,2,,', 'Chetna,9876500003,3,9888800003,Mrs Kaur'].join('\n');
  const imp = await request(app).post(`/api/centre/batches/${S.batch}/students/import`).set(auth(S.owner)).send({ csv });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  const over = await request(app).post('/api/centre/students').set(auth(S.owner)).send({ name: 'Deep', phone: '9876500004', batchId: S.batch });
  assert.equal(over.status, 400);
  assert.match(over.body.error, /allows 3 students/);

  const qcsv = ['subject,topic,question,option_a,option_b,option_c,option_d,answer,explanation,difficulty']
    .concat([1, 2, 3, 4, 5, 6, 7, 8].map((i) => `Quant,Percentages,What is ${i}0% of 100?,${i}0,${i}1,${i}2,${i}3,A,${i}0/100 x 100 = ${i}0.,2`))
    .join('\n');
  assert.equal((await request(app).post('/api/syllabus/questions/import').set(auth(S.owner)).send({ csv: qcsv })).status, 200);
  // The owner's phone is their WhatsApp number for reports and commands.
  const staff = (await request(app).get('/api/centre/staff').set(auth(S.owner))).body.staff;
  assert.equal(staff[0].phone, '9814011111');
});

test('suspend and plan end both lock the centre out; renew opens it again', { skip }, async () => {
  await request(app).patch(`/api/admin/centres/${S.centre}`).set(auth(S.admin)).send({ status: 'suspended' });
  assert.equal((await request(app).get('/api/centre/batches').set(auth(S.owner))).status, 403);
  await request(app).patch(`/api/admin/centres/${S.centre}`).set(auth(S.admin)).send({ status: 'active', validUntil: '2020-01-01' });
  const r = await request(app).get('/api/centre/batches').set(auth(S.owner));
  assert.equal(r.status, 403);
  assert.match(r.body.error, /plan has ended/);
  await request(app).patch(`/api/admin/centres/${S.centre}`).set(auth(S.admin)).send({ validUntil: '2099-12-31' });
  assert.equal((await request(app).get('/api/centre/batches').set(auth(S.owner))).status, 200);
});

test('without WhatsApp connected, messages are logged as skipped, not lost silently', { skip }, async () => {
  const t = await request(app).post('/api/tests').set(auth(S.owner)).send({ batchId: S.batch, title: 'Warm-up', kind: 'exit_ticket', picks: [{ topicId: await topicId(), count: 2 }] });
  await request(app).post(`/api/tests/${t.body.test.id}/status`).set(auth(S.owner)).send({ status: 'published' });
  const w = (await request(app).get(`/api/tests/${t.body.test.id}/whatsapp`).set(auth(S.owner))).body;
  assert.equal(w.connected, false);
  assert.equal(w.summary.test_open.skipped, 3);
  assert.equal(sent.length, 0);
});

async function topicId() {
  return (await pool.query(`SELECT id FROM topics WHERE centre_id = $1 AND name = 'Percentages'`, [S.centre])).rows[0].id;
}

test('admin connects the centre WhatsApp: keys checked with Meta, token stored encrypted', { skip }, async () => {
  const wrongNumber = await request(app).put(`/api/admin/centres/${S.centre}/whatsapp`).set(auth(S.admin))
    .send({ number: '+91 98140 99999', phoneNumberId: PHONE_ID, accessToken: TOKEN });
  assert.equal(wrongNumber.status, 400);
  assert.match(wrongNumber.body.error, /belong to/);
  const badToken = await request(app).put(`/api/admin/centres/${S.centre}/whatsapp`).set(auth(S.admin))
    .send({ number: '+91 98140 00000', phoneNumberId: PHONE_ID, accessToken: 'nope' });
  assert.equal(badToken.status, 400);

  const ok = await request(app).put(`/api/admin/centres/${S.centre}/whatsapp`).set(auth(S.admin))
    .send({ number: '98140 00000', phoneNumberId: PHONE_ID, accessToken: TOKEN, wabaId: '99887766554433' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.whatsapp.connected, true);
  assert.ok(!JSON.stringify(ok.body).includes(TOKEN), 'token never returned');
  const row = (await pool.query('SELECT access_token_enc FROM centre_whatsapp WHERE centre_id = $1', [S.centre])).rows[0];
  assert.ok(row.access_token_enc.startsWith('v1:') && !row.access_token_enc.includes(TOKEN));
});

test('publishing a test sends each student a login link once; the link opens the test', { skip }, async () => {
  const t = await request(app).post('/api/tests').set(auth(S.owner)).send({ batchId: S.batch, title: 'Percentages exit ticket', kind: 'exit_ticket', picks: [{ topicId: await topicId(), count: 4 }] });
  S.test = t.body.test.id;
  await request(app).post(`/api/tests/${S.test}/status`).set(auth(S.owner)).send({ status: 'published' });
  const toAman = sentTo('9876500001');
  assert.equal(toAman.length, 1);
  assert.equal(toAman[0].template.name, 'wc_test_open');
  const link = toAman[0].template.components[0].parameters[3].text;
  assert.match(link, /^https:\/\/competitive\.example\/go\//);

  const again = await request(app).post(`/api/tests/${S.test}/whatsapp`).set(auth(S.owner)).send({ send: 'students' });
  assert.equal(again.body.result.already, 3);
  assert.equal(sentTo('9876500001').length, 1, 'never twice');

  const m = await request(app).post('/api/auth/magic').send({ token: link.split('/go/')[1] });
  assert.equal(m.status, 200);
  assert.equal(m.body.path, `/test/${S.test}`);
  S.aman = m.body.token;
  assert.equal((await request(app).post('/api/auth/magic').send({ token: 'garbage' })).status, 401);
});

test('a submitted test sends the result to the parent (only if a parent number is saved)', { skip }, async () => {
  const st = await request(app).post(`/api/student/tests/${S.test}/start`).set(auth(S.aman)).send({});
  const answers = Object.fromEntries(st.body.questions.map((q) => [q.id, 1])); // all wrong
  await request(app).post(`/api/student/tests/${S.test}/submit`).set(auth(S.aman)).send({ answers });
  const toParent = sentTo('9888800001');
  assert.equal(toParent.length, 1);
  assert.equal(toParent[0].template.name, 'wc_result_parent');
  const params = toParent[0].template.components[0].parameters.map((p) => p.text);
  assert.equal(params[1], 'Aman');
  assert.equal(params[2], '-2 / 8'); // 4 wrong × −0.5 on SSC CGL marking
  assert.equal(params[4], 'Percentages');

  // Baljit has no parent number: nothing sent, counted as no_number.
  const b = await studentLogin('9876500002');
  const st2 = await request(app).post(`/api/student/tests/${S.test}/start`).set(auth(b)).send({});
  await request(app).post(`/api/student/tests/${S.test}/submit`).set(auth(b)).send({ answers: Object.fromEntries(st2.body.questions.map((q) => [q.id, 0])) });
  const r = await request(app).post(`/api/tests/${S.test}/whatsapp`).set(auth(S.owner)).send({ send: 'parents' });
  assert.equal(r.body.result.no_number, 1);
  assert.equal(r.body.result.already, 1);
});

async function studentLogin(phone) {
  return (await request(app).post('/api/auth/student-login').send({ centreCode: S.code, phone, password: phone })).body.token;
}

test('next-class plan sends practice links to weak students and the summary to the teacher', { skip }, async () => {
  const r = await request(app).post(`/api/tests/${S.test}/actions`).set(auth(S.owner)).send({});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const practice = sentTo('9876500001').filter((m) => m.template?.name === 'wc_practice');
  assert.equal(practice.length, 1, 'Aman was weak');
  assert.equal(sentTo('9876500002').filter((m) => m.template?.name === 'wc_practice').length, 0, 'Baljit was not');
  const toTeacher = sentTo('9814011111');
  assert.equal(toTeacher.at(-1).template.name, 'wc_teacher_report');
});

test('webhook: Meta handshake, signature required', { skip }, async () => {
  const hs = await request(app).get('/api/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '42' });
  assert.equal(hs.text, '42');
  assert.equal((await request(app).get('/api/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x' })).status, 403);

  const body = JSON.stringify(inbound('9814011111', 'TESTS', 'wamid.in.0'));
  const unsigned = await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').send(body);
  assert.equal(unsigned.status, 401);
  const sig = `sha256=${crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
  const signed = await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body);
  assert.equal(signed.status, 200);
  // The webhook answers Meta first and works after; wait for the reply.
  for (let i = 0; i < 50 && !textOf(sent.at(-1)).startsWith('Latest tests'); i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.match(textOf(sent.at(-1)), /^Latest tests:\n#\d+ Percentages exit ticket/);
});

test('teacher runs the Loop from WhatsApp: REPORT, RETEST', { skip }, async () => {
  const before = sent.length;
  await processWebhook(inbound('9814011111', `report ${S.test}`, 'wamid.in.1'));
  const reply = textOf(sent.at(-1));
  assert.equal(sent.length, before + 1);
  assert.match(reply, /Submitted: 2 of 3/);
  assert.match(reply, /Percentages: 50%/);

  await processWebhook(inbound('9814011111', `report ${S.test}`, 'wamid.in.1')); // Meta re-sends
  assert.equal(sent.length, before + 1, 'a repeated webhook is answered once');

  await processWebhook(inbound('9814011111', `RETEST ${S.test}`, 'wamid.in.2'));
  const re = (await pool.query(`SELECT id, status FROM tests WHERE parent_test_id = $1`, [S.test])).rows[0];
  assert.equal(re.status, 'published');
  assert.ok(sentTo('9876500003').some((m) => m.template?.name === 'wc_test_open' && m.template.components[0].parameters[1].text.startsWith('Re-test')));
  assert.match(textOf(sent.at(-1)), /Re-test #\d+ .* is open and sent to 3 students/);

  await processWebhook(inbound('9814011111', 'hello', 'wamid.in.3'));
  assert.match(textOf(sent.at(-1)), /commands/);
});

test('students and parents get answers on WhatsApp; unknown numbers are told to register', { skip }, async () => {
  await processWebhook(inbound('9876500001', 'hi', 'wamid.in.4'));
  const s = textOf(sent.at(-1));
  assert.match(s, /Hi Aman/);
  assert.match(s, /Practice, Percentages: https:\/\/competitive\.example\/go\//);

  await processWebhook(inbound('9888800001', 'REPORT', 'wamid.in.5'));
  assert.match(textOf(sent.at(-1)), /Aman:\n {2}Percentages exit ticket: -2 \/ 8/);

  await processWebhook(inbound('9000000000', 'hi', 'wamid.in.6'));
  assert.match(textOf(sent.at(-1)), /not registered at Gill Academy/);
});

test('delivery reports from Meta update the message status', { skip }, async () => {
  const row = (await pool.query(`SELECT wa_message_id FROM whatsapp_messages WHERE kind = 'result_parent' AND status = 'sent' LIMIT 1`)).rows[0];
  await processWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: row.wa_message_id, status: 'read' }] } }] }] });
  await processWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: row.wa_message_id, status: 'delivered' }] } }] }] });
  const after1 = (await pool.query('SELECT status FROM whatsapp_messages WHERE wa_message_id = $1', [row.wa_message_id])).rows[0];
  assert.equal(after1.status, 'read', 'never goes backwards');
});

test('students can log in with a WhatsApp code instead of the password', { skip }, async () => {
  const before = sent.length;
  const r = await request(app).post('/api/auth/student-otp').send({ centreCode: S.code, phone: '9876500003' });
  assert.equal(r.status, 200);
  const msg = sent[before];
  assert.equal(msg.template.name, 'wc_login_otp');
  const code = msg.template.components[0].parameters[0].text;
  assert.match(code, /^\d{6}$/);
  assert.equal((await request(app).post('/api/auth/student-otp/verify').send({ centreCode: S.code, phone: '9876500003', code: code === '000000' ? '111111' : '000000' })).status, 401);
  const ok = await request(app).post('/api/auth/student-otp/verify').send({ centreCode: S.code, phone: '9876500003', code });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal((await request(app).post('/api/auth/student-otp/verify').send({ centreCode: S.code, phone: '9876500003', code })).status, 401, 'one use');
  // Unknown number: same reply, nothing sent.
  const n = sent.length;
  assert.equal((await request(app).post('/api/auth/student-otp').send({ centreCode: S.code, phone: '9000000001' })).status, 200);
  assert.equal(sent.length, n);
});

test('admin sees the centre: usage, WhatsApp log, and edits a shared exam pattern', { skip }, async () => {
  const d = (await request(app).get(`/api/admin/centres/${S.centre}`).set(auth(S.admin))).body;
  assert.equal(d.centre.students, 3);
  assert.equal(d.whatsapp.connected, true);
  assert.ok(!JSON.stringify(d).includes(TOKEN));
  const ov = (await request(app).get('/api/admin/overview').set(auth(S.admin))).body;
  assert.equal(ov.whatsapp_connected, 1);
  assert.ok(ov.wa_sent_30d > 5);
  const pats = (await request(app).get('/api/admin/exam-patterns').set(auth(S.admin))).body.patterns;
  const cgl = pats.find((p) => p.code === 'SSC-CGL-T1');
  const upd = await request(app).patch(`/api/admin/exam-patterns/${cgl.id}`).set(auth(S.admin)).send({ marksWrong: 0.25 });
  assert.equal(Number(upd.body.pattern.marks_wrong), 0.25);
  const v = await request(app).post('/api/admin/exam-patterns').set(auth(S.admin)).send({ code: 'SSC-CGL-T1', name: 'SSC CGL Tier 1', version: '2025', durationMin: 60, marksCorrect: 2, marksWrong: 0.5 });
  assert.equal(v.status, 400, 'same code + version is refused');
  const reset = await request(app).post(`/api/admin/centres/${S.centre}/staff/${S.ownerId}/password`).set(auth(S.admin)).send({ password: 'new-password-1' });
  assert.equal(reset.status, 200);
  const again = await request(app).post('/api/auth/login').send({ email: 'owner@gill.in', password: 'new-password-1' });
  assert.equal(again.status, 200);
  assert.equal(again.body.user.must_change_password, true, 'a reset password must be changed too');
});

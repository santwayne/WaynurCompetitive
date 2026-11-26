# Waynur Competitive

Teaching-intelligence software for coaching centres that prepare students for government exams (SSC, Railways, Banking, Police, State PSC).

It runs the **Waynur Loop** on every class:

1. **Teach**: the teacher takes the class as usual.
2. **Check**: a 10-minute exit ticket, taken on the phone or on paper.
3. **Diagnose**: accuracy for each topic and each student, the most-missed question, and who is weak (below 50%).
4. **Intervene**: a next-class re-teach list, plus a 5-question practice set for each weak student, with hints from the centre's own notes. Practice links go out on WhatsApp.
5. **Verify**: a one-click parallel re-test on fresh questions, compared only for the students who took both tests.

Marking follows the exam pattern of the batch, e.g. SSC CGL +2 / −0.5 and RRB NTPC +1 / −0.33. Shared patterns are seeded; a centre can add its own.

## Stack
- **backend/**: Node 20 + Express (ESM), Postgres, JWT, with optional Anthropic API calls for hints and wording. If there is no key, the app falls back to plain templates. AI calls are capped per centre per day.
- **frontend/**: React 18 + Vite + Tailwind, with the same look as Waynur. The student screens are made for phones.

A single database serves many centres. Every query is scoped by the `centre_id` in the signed-in token, never by a value from the request.

## WhatsApp-first (same model as Waynur)
Each centre sends from its own WhatsApp Business number, connected by the Waynur team from the Super Admin panel (token stored encrypted). Nothing needs a password for daily use:

| Who | Gets on WhatsApp | Can send |
|---|---|---|
| Student | a link that opens each new test, and their practice set (links log them in, 72 h) | any message → their open tests and practice; login code (`wc_login_otp`) |
| Parent | score and weak topics after every test | `REPORT` → latest results |
| Teacher (number saved under Team) | summary + re-teach list when the next-class plan is made | `TESTS`, `REPORT 12`, `PLAN 12`, `PUBLISH 12`, `RETEST 12` |

Every message is logged (`whatsapp_messages`) and sent at most once per person. Without a connection, messages are logged as *skipped*. Templates to create in Meta are in `backend/services/waTemplates.js` and on the Super Admin → WhatsApp set-up page. Webhook: `https://<domain>/api/whatsapp/webhook` (needs `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`).

## Super Admin panel (`/admin`)
For the Waynur team: all centres with usage, create a centre + owner, plan (trial / basic / AI), valid-until date and student limit (both required; a trial runs at most `TRIAL_MAX_DAYS`, default 30), AI calls per day, suspend, reset a staff password, connect the centre's WhatsApp (checked with Meta before saving), WhatsApp log, shared exam patterns.

Create the first Super Admin on the server:
```bash
cd backend && SUPER_ADMIN_PASSWORD='a long password' npm run create-admin -- admin@waynur.com "Pankaj Thakur"
```
A suspended centre, or one whose plan has ended, cannot log in (staff or students). Public sign-up gives a trial (`TRIAL_DAYS`, `TRIAL_STUDENT_LIMIT`); set `PUBLIC_SIGNUP=false` to allow only Super Admin set-up.

## Roles
| Who | Can |
|---|---|
| Owner | everything, and only the owner adds staff and changes staff WhatsApp numbers |
| Academic head | batches, approving and merging questions/topics, tests (not staff) |
| Teacher | batches, tests, diagnosis, next-class plan; questions they add stay drafts until approved |
| Student | logs in at `/s/<centre code>` (a random 6-character code, shown on the Batches page) with mobile number (password = mobile number until changed); takes tests, sees results, does practice |

Staff whose password was set by someone else (the owner, or the Super Admin) must choose their own on first login. Teachers see colleagues' names and roles, not their emails and numbers.

## Run locally
```bash
# 1. Postgres: create a database, then
cd backend
cp .env.example .env        # fill DATABASE_URL and JWT_SECRET (openssl rand -hex 32)
npm install
npm run migrate             # idempotent; safe on every deploy
npm run seed                # optional demo centre (prints the logins)
npm run dev                 # API on :4100

cd ../frontend
npm install
npm run dev                 # http://localhost:5174 (proxies /api to :4100)
```

## Tests
```bash
cd backend
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/wc_test npm test
```
There are 9 unit tests for the loop rules and 24 end-to-end API tests (14 of them for the Super Admin panel and WhatsApp, against a fake Meta API). The end-to-end tests cover signup, the full loop, paper marking, late submits, data from another centre, and the teacher/lead permissions. **The test database is wiped on every run**, so never point TEST_DATABASE_URL at real data.

## Deploy (one small server)
```bash
cd backend && npm ci --omit=dev && npm run migrate
pm2 start server.js --name waynur-competitive --update-env
cd ../frontend && npm ci && npm run build      # serve frontend/dist with nginx
```
nginx should serve `frontend/dist` and send `/api/` to `127.0.0.1:4100`. Set `CORS_ORIGINS` only if the frontend is on a different domain.

## CSV formats
- Students (into a batch): `name,phone,roll_no,parent_phone,parent_name` (parent columns optional)
- Questions: `subject,topic,question,option_a,option_b,option_c,option_d,answer,explanation,difficulty` (answer = A–D, required; difficulty = 1 easy / 2 medium / 3 hard, or the words, empty = medium)

Topics match ignoring case, spaces and a plural "s" ("Maths / Percentage" = "math / Percentages"); older duplicates can be merged on the Question bank page.

Imports are all-or-nothing, and errors name the row (e.g. "Row 7: phone is not a 10-digit mobile number").

## Loop thresholds
These can be changed in `.env`:

| Variable | Default | Meaning |
|---|---|---|
| `LOOP_STUDENT_WEAK_BELOW` | 50 | a student is weak in a topic below this % |
| `LOOP_TOPIC_WEAK_BELOW` | 60 | a topic is re-taught if batch accuracy is below this % |
| `LOOP_SHARED_SHARE` | 40 | …or if this % of students are weak in it |
| `LOOP_PRACTICE_SIZE` | 5 | questions per practice set |

Check each exam pattern's marks and timing against the latest official notification before a batch relies on it.

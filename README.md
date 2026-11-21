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

## Roles
| Who | Can |
|---|---|
| Owner / academic head | everything: staff, batches, approving questions, tests |
| Teacher | batches, tests, diagnosis, next-class plan; questions they add stay drafts until approved |
| Student | logs in at `/s/<centreId>` with mobile number (password = mobile number until changed); takes tests, sees results, does practice |

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
There are 9 unit tests for the loop rules and 10 end-to-end API tests. The end-to-end tests cover signup, the full loop, paper marking, late submits, data from another centre, and the teacher/lead permissions. **The test database is wiped on every run**, so never point TEST_DATABASE_URL at real data.

## Deploy (one small server)
```bash
cd backend && npm ci --omit=dev && npm run migrate
pm2 start server.js --name waynur-competitive --update-env
cd ../frontend && npm ci && npm run build      # serve frontend/dist with nginx
```
nginx should serve `frontend/dist` and send `/api/` to `127.0.0.1:4100`. Set `CORS_ORIGINS` only if the frontend is on a different domain.

## CSV formats
- Students (into a batch): `name,phone,roll_no`
- Questions: `subject,topic,question,option_a,option_b,option_c,option_d,answer,explanation,difficulty` (answer = A–D)

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

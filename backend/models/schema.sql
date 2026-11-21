-- Waynur Competitive — schema (idempotent: safe to run again on every deploy).
-- One database serves many coaching centres; every row that belongs to a
-- centre carries centre_id, and every query is scoped by the centre in the
-- signed-in user's token (never by an id from the request body).

CREATE TABLE IF NOT EXISTS centres (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Staff: the owner / academic head buys, teachers use it daily.
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  centre_id      INT NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  phone          TEXT,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('owner', 'academic_head', 'teacher')),
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Students log in with their mobile number + a password the centre sets.
CREATE TABLE IF NOT EXISTS students (
  id             SERIAL PRIMARY KEY,
  centre_id      INT NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL,
  roll_no        TEXT,
  password_hash  TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (centre_id, phone)
);

-- Versioned exam patterns. centre_id NULL = a shared template (SSC CGL,
-- RRB NTPC…) every centre can use; a centre can add its own.
CREATE TABLE IF NOT EXISTS exam_patterns (
  id              SERIAL PRIMARY KEY,
  centre_id       INT REFERENCES centres(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  version         TEXT NOT NULL,
  duration_min    INT NOT NULL CHECK (duration_min > 0),
  marks_correct   NUMERIC(5,2) NOT NULL CHECK (marks_correct > 0),
  marks_wrong     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (marks_wrong >= 0), -- deducted per wrong answer
  sections        JSONB NOT NULL DEFAULT '[]', -- [{ subject, questions }]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_patterns_code_version
  ON exam_patterns (COALESCE(centre_id, 0), code, version);

CREATE TABLE IF NOT EXISTS batches (
  id               SERIAL PRIMARY KEY,
  centre_id        INT NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  exam_pattern_id  INT REFERENCES exam_patterns(id) ON DELETE SET NULL,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (centre_id, name)
);
CREATE TABLE IF NOT EXISTS batch_students (
  batch_id    INT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  student_id  INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (batch_id, student_id)
);
CREATE TABLE IF NOT EXISTS batch_teachers (
  batch_id  INT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (batch_id, user_id)
);

-- Syllabus: subject → topic map, owned by the centre.
CREATE TABLE IF NOT EXISTS topics (
  id          SERIAL PRIMARY KEY,
  centre_id   INT NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  name        TEXT NOT NULL,
  notes       TEXT, -- centre-owned teaching notes; the AI tutor stays inside these
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (centre_id, subject, name)
);

-- Question bank. Only 'approved' questions go into tests and practice.
CREATE TABLE IF NOT EXISTS questions (
  id             SERIAL PRIMARY KEY,
  centre_id      INT NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  topic_id       INT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  stem           TEXT NOT NULL,
  options        JSONB NOT NULL, -- ["A text", "B text", ...] 2–6 options
  correct_index  INT NOT NULL CHECK (correct_index >= 0),
  explanation    TEXT,
  difficulty     INT NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'ai')),
  created_by     INT REFERENCES users(id) ON DELETE SET NULL,
  approved_by    INT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS questions_topic ON questions (centre_id, topic_id, status);

-- Tests: an exit ticket after class, a scheduled test, or the re-test that
-- checks whether an intervention worked (parent_test_id = the original).
CREATE TABLE IF NOT EXISTS tests (
  id              SERIAL PRIMARY KEY,
  centre_id       INT NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  batch_id        INT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('exit_ticket', 'scheduled', 'retest')),
  mode            TEXT NOT NULL DEFAULT 'online' CHECK (mode IN ('online', 'paper')),
  parent_test_id  INT REFERENCES tests(id) ON DELETE SET NULL,
  duration_min    INT NOT NULL CHECK (duration_min > 0),
  marks_correct   NUMERIC(5,2) NOT NULL,
  marks_wrong     NUMERIC(5,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  created_by      INT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS test_questions (
  test_id      INT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_id  INT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  position     INT NOT NULL,
  PRIMARY KEY (test_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id            SERIAL PRIMARY KEY,
  test_id       INT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  student_id    INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'paper')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at  TIMESTAMPTZ,
  score         NUMERIC(7,2),
  UNIQUE (test_id, student_id)
);
CREATE TABLE IF NOT EXISTS responses (
  attempt_id    INT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id   INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  chosen_index  INT,          -- NULL = skipped
  is_correct    BOOLEAN NOT NULL DEFAULT false,
  time_ms       INT,
  PRIMARY KEY (attempt_id, question_id)
);

-- The Loop's output: what the teacher does next class, and who gets practice.
CREATE TABLE IF NOT EXISTS interventions (
  id           SERIAL PRIMARY KEY,
  centre_id    INT NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  test_id      INT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  topic_id     INT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('reteach', 'practice')),
  accuracy     NUMERIC(5,2),   -- topic accuracy that triggered it (0–100)
  note         TEXT NOT NULL,  -- the next-class action, in plain words
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (test_id, topic_id, kind)
);
CREATE TABLE IF NOT EXISTS practice_sets (
  id               SERIAL PRIMARY KEY,
  intervention_id  INT NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
  student_id       INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_ids     INT[] NOT NULL,
  answers          JSONB NOT NULL DEFAULT '{}', -- { questionId: chosenIndex }
  completed_at     TIMESTAMPTZ,
  UNIQUE (intervention_id, student_id)
);

-- Every AI call is metered so a centre's AI cost can be capped.
CREATE TABLE IF NOT EXISTS ai_usage (
  id          SERIAL PRIMARY KEY,
  centre_id   INT REFERENCES centres(id) ON DELETE CASCADE,
  feature     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_centre_day ON ai_usage (centre_id, created_at);

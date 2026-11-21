// The Waynur Loop: Teach → Check → Diagnose → Intervene → Verify.
// Everything here is plain functions over plain data, so the rules can be
// tested without a database and explained to a teacher in one line each.

import { pct, shuffle } from './util.js';

// Thresholds (percent). Overridable per deploy, same for every centre.
export const RULES = {
  studentWeakBelow: Number(process.env.LOOP_STUDENT_WEAK_BELOW) || 50, // a student is weak in a topic below this
  topicWeakBelow: Number(process.env.LOOP_TOPIC_WEAK_BELOW) || 60,     // batch accuracy below this → re-teach
  sharedShare: Number(process.env.LOOP_SHARED_SHARE) || 40,            // …or this % of students weak → re-teach
  practiceSize: Number(process.env.LOOP_PRACTICE_SIZE) || 5,
};

/** Marks for one attempt: +correct, −wrong, 0 for skipped. */
export function scoreResponses(responses, marksCorrect, marksWrong) {
  let score = 0;
  for (const r of responses) {
    if (r.chosen_index === null || r.chosen_index === undefined) continue;
    score += r.is_correct ? Number(marksCorrect) : -Number(marksWrong);
  }
  return Math.round(score * 100) / 100;
}

/**
 * Diagnose one test for one batch.
 *  students:  [{ id, name }]                    everyone in the batch
 *  questions: [{ id, topic_id }]                 the test's questions
 *  topics:    [{ id, name, subject }]
 *  attempts:  [{ student_id, score, responses: [{ question_id, chosen_index, is_correct }] }]  submitted only
 * A skipped question counts as not correct (it is still a gap to close).
 */
export function diagnose({ students, questions, topics, attempts }, rules = RULES) {
  const topicOf = new Map(questions.map((q) => [q.id, q.topic_id]));
  const qsByTopic = new Map();
  for (const q of questions) qsByTopic.set(q.topic_id, (qsByTopic.get(q.topic_id) || 0) + 1);
  const topicInfo = new Map(topics.map((t) => [t.id, t]));
  const nameOf = new Map(students.map((s) => [s.id, s.name]));

  const perQuestion = new Map(questions.map((q) => [q.id, { asked: 0, correct: 0, skipped: 0 }]));
  const perTopic = new Map([...qsByTopic.keys()].map((t) => [t, { asked: 0, correct: 0, weak: [] }]));
  const studentRows = [];

  for (const a of attempts) {
    const byTopic = new Map();
    let correct = 0;
    const answered = new Map(a.responses.map((r) => [r.question_id, r]));
    for (const q of questions) {
      const r = answered.get(q.id);
      const ok = Boolean(r?.is_correct);
      const pq = perQuestion.get(q.id);
      pq.asked += 1;
      if (ok) pq.correct += 1;
      if (!r || r.chosen_index === null || r.chosen_index === undefined) pq.skipped += 1;
      const bt = byTopic.get(q.topic_id) || { asked: 0, correct: 0 };
      bt.asked += 1;
      if (ok) { bt.correct += 1; correct += 1; }
      byTopic.set(q.topic_id, bt);
    }
    const weakTopics = [];
    for (const [topicId, t] of byTopic) {
      const pt = perTopic.get(topicId);
      pt.asked += t.asked;
      pt.correct += t.correct;
      if (pct(t.correct, t.asked) < rules.studentWeakBelow) {
        weakTopics.push(topicId);
        pt.weak.push(a.student_id);
      }
    }
    studentRows.push({
      student_id: a.student_id,
      name: nameOf.get(a.student_id) ?? `Student ${a.student_id}`,
      score: a.score,
      accuracy: pct(correct, questions.length),
      weak_topics: weakTopics,
    });
  }

  const submitted = attempts.length;
  const topicRows = [...perTopic.entries()].map(([topicId, t]) => {
    const accuracy = pct(t.correct, t.asked);
    const weakShare = pct(t.weak.length, submitted);
    const reteach = submitted > 0 && (accuracy < rules.topicWeakBelow || weakShare >= rules.sharedShare);
    // The question most students got wrong — the teacher starts there.
    const mostMissed = questions
      .filter((q) => q.topic_id === topicId)
      .map((q) => ({ id: q.id, ...perQuestion.get(q.id) }))
      .sort((x, y) => x.correct / (x.asked || 1) - y.correct / (y.asked || 1))[0];
    const info = topicInfo.get(topicId) || {};
    return {
      topic_id: topicId,
      name: info.name ?? `Topic ${topicId}`,
      subject: info.subject ?? '',
      questions: qsByTopic.get(topicId),
      accuracy,
      weak_students: t.weak,
      weak_share: weakShare,
      reteach,
      most_missed_question_id: mostMissed?.id ?? null,
    };
  }).sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101));

  const attempted = new Set(attempts.map((a) => a.student_id));
  return {
    participation: { submitted, total: students.length, pct: pct(submitted, students.length) },
    topics: topicRows,
    students: studentRows.sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0)),
    not_attempted: students.filter((s) => !attempted.has(s.id)).map((s) => ({ student_id: s.id, name: s.name })),
    questions: questions.map((q) => ({ question_id: q.id, topic_id: q.topic_id, ...perQuestion.get(q.id) })),
  };
}

/**
 * Turn a diagnosis into the next-class action list.
 *  - reteach: topics the batch as a whole is weak in (one 15-minute block each)
 *  - practice: every student weak in a topic gets a short practice set
 * Notes are template text; the AI may rewrite them later, never invent numbers.
 */
export function planInterventions(diag) {
  const out = [];
  for (const t of diag.topics) {
    if (t.reteach) {
      out.push({
        topic_id: t.topic_id,
        kind: 'reteach',
        accuracy: t.accuracy,
        note: `Re-teach ${t.name} for 15 minutes next class: batch accuracy ${t.accuracy}%, ${t.weak_students.length} of ${diag.participation.submitted} students below ${RULES.studentWeakBelow}%. Start with the most-missed question, then do 3 quick checks.`,
        students: [],
      });
    }
    if (t.weak_students.length) {
      out.push({
        topic_id: t.topic_id,
        kind: 'practice',
        accuracy: t.accuracy,
        note: `Practice set on ${t.name} for ${t.weak_students.length} student(s) who scored below ${RULES.studentWeakBelow}% in it.`,
        students: t.weak_students,
      });
    }
  }
  return out;
}

/**
 * Pick practice questions: approved, same topic, not in the test the
 * student just took. Fewer than wanted is fine — the teacher sees the count.
 */
export function pickPractice(pool, excludeIds, size = RULES.practiceSize, rand = Math.random) {
  const skip = new Set(excludeIds);
  return shuffle(pool.filter((q) => !skip.has(q.id)), rand).slice(0, size).map((q) => q.id);
}

/**
 * Parallel re-test: the same number of questions per topic as the original,
 * drawn from approved questions the batch has not seen in that test.
 * Returns { questionIds, short: [{ topic_id, needed, found }] }.
 */
export function buildParallel(originalQuestions, bankByTopic, rand = Math.random) {
  const used = new Set(originalQuestions.map((q) => q.id));
  const need = new Map();
  for (const q of originalQuestions) need.set(q.topic_id, (need.get(q.topic_id) || 0) + 1);
  const questionIds = [];
  const short = [];
  for (const [topicId, count] of need) {
    const fresh = shuffle((bankByTopic.get(topicId) || []).filter((q) => !used.has(q.id)), rand).slice(0, count);
    questionIds.push(...fresh.map((q) => q.id));
    if (fresh.length < count) short.push({ topic_id: topicId, needed: count, found: fresh.length });
  }
  return { questionIds, short };
}

/** Student ids that submitted both tests. */
export function commonStudents(beforeAttempts, afterAttempts) {
  const before = new Set(beforeAttempts.map((a) => a.student_id));
  return afterAttempts.map((a) => a.student_id).filter((id) => before.has(id));
}

/**
 * Verify: did the intervention help? Pass two diagnoses built from the SAME
 * students (those who took both tests — see commonStudents) so absentees
 * don't skew the comparison.
 */
export function compareTopics(before, after) {
  const common = after.students.map((s) => s.student_id);
  const afterBy = new Map(after.topics.map((t) => [t.topic_id, t]));
  return {
    students_in_both: common.length,
    topics: before.topics.map((t) => {
      const a = afterBy.get(t.topic_id);
      return {
        topic_id: t.topic_id,
        name: t.name,
        before: t.accuracy,
        after: a?.accuracy ?? null,
        change: a?.accuracy != null && t.accuracy != null ? Math.round((a.accuracy - t.accuracy) * 10) / 10 : null,
        weak_before: t.weak_students.length,
        weak_after: a ? a.weak_students.length : null,
      };
    }),
  };
}

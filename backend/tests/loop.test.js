import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildParallel, commonStudents, compareTopics, diagnose, pickPractice, planInterventions, scoreResponses,
} from '../services/loop.js';
import { normalizePhone, parseCsv } from '../services/util.js';

// 4 students, 4 questions: 2 on Percentages (topic 1), 2 on Time & Work (topic 2).
const topics = [{ id: 1, name: 'Percentages', subject: 'Quant' }, { id: 2, name: 'Time & Work', subject: 'Quant' }];
const questions = [{ id: 11, topic_id: 1 }, { id: 12, topic_id: 1 }, { id: 21, topic_id: 2 }, { id: 22, topic_id: 2 }];
const students = [1, 2, 3, 4].map((id) => ({ id, name: `S${id}` }));
const r = (q, ok, skipped = false) => ({ question_id: q, chosen_index: skipped ? null : ok ? 0 : 1, is_correct: ok });

test('score: +correct, −wrong, 0 for skipped (SSC: +2 / −0.5)', () => {
  assert.equal(scoreResponses([r(1, true), r(2, false), r(3, false, true)], 2, 0.5), 1.5);
  assert.equal(scoreResponses([r(1, false), r(2, false)], 1, 0.33), -0.66);
});

test('diagnose: topic accuracy, weak students, re-teach flag, most-missed question', () => {
  const attempts = [
    { student_id: 1, score: 4, responses: [r(11, true), r(12, true), r(21, false), r(22, true)] },
    { student_id: 2, score: 2, responses: [r(11, true), r(12, true), r(21, false), r(22, false)] },
    { student_id: 3, score: 1, responses: [r(11, true), r(12, false), r(21, false, true), r(22, false)] },
    // student 4 did not take it
  ];
  const d = diagnose({ students, questions, topics, attempts });
  assert.deepEqual(d.participation, { submitted: 3, total: 4, pct: 75 });
  assert.deepEqual(d.not_attempted, [{ student_id: 4, name: 'S4' }]);
  const tw = d.topics.find((t) => t.topic_id === 2);
  assert.equal(tw.accuracy, 16.7); // 1 of 6
  assert.deepEqual(tw.weak_students.sort(), [2, 3]); // 0% each; student 1 is at 50%, not below
  assert.equal(tw.reteach, true);
  assert.equal(tw.most_missed_question_id, 21); // nobody got 21 right
  const pc = d.topics.find((t) => t.topic_id === 1);
  assert.equal(pc.accuracy, 83.3);
  assert.equal(pc.reteach, false);
  assert.deepEqual(pc.weak_students, []); // student 3 is at exactly 50%
  assert.equal(d.topics[0].topic_id, 2, 'weakest topic first');
  assert.equal(d.questions.find((q) => q.question_id === 21).skipped, 1);
});

test('a student missing from the responses counts every question as not correct', () => {
  const d = diagnose({ students, questions, topics, attempts: [{ student_id: 1, score: 0, responses: [] }] });
  assert.equal(d.topics[0].accuracy, 0);
  assert.equal(d.students[0].accuracy, 0);
});

test('plan: re-teach for shared weak topics, practice for every weak student', () => {
  const attempts = [
    { student_id: 1, score: 0, responses: [r(11, true), r(12, true), r(21, false), r(22, false)] },
    { student_id: 2, score: 0, responses: [r(11, true), r(12, false), r(21, false), r(22, false)] },
  ];
  const plan = planInterventions(diagnose({ students, questions, topics, attempts }));
  const reteach = plan.filter((p) => p.kind === 'reteach');
  assert.deepEqual(reteach.map((p) => p.topic_id), [2]);
  assert.match(reteach[0].note, /Time & Work.*0%/);
  const practice = plan.find((p) => p.kind === 'practice' && p.topic_id === 2);
  assert.deepEqual(practice.students.sort(), [1, 2]);
  assert.equal(plan.some((p) => p.topic_id === 1), false, 'no action where everyone is at 50% or more');
});

test('no submissions → no plan', () => {
  assert.deepEqual(planInterventions(diagnose({ students, questions, topics, attempts: [] })), []);
});

test('practice never repeats the questions from the test', () => {
  const pool = [{ id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }];
  const ids = pickPractice(pool, [11, 12], 5);
  assert.deepEqual(ids.sort(), [13, 14]);
});

test('parallel re-test: same count per topic, fresh questions, reports shortfalls', () => {
  const bank = new Map([
    [1, [{ id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }]],
    [2, [{ id: 21 }, { id: 22 }, { id: 23 }]],
  ]);
  const { questionIds, short } = buildParallel(questions, bank, () => 0.3);
  assert.deepEqual(questionIds.filter((id) => id < 20).sort(), [13, 14]);
  assert.deepEqual(questionIds.filter((id) => id > 20), [23]);
  assert.deepEqual(short, [{ topic_id: 2, needed: 2, found: 1 }]);
});

test('verify compares only the students who took both tests', () => {
  const before = [{ student_id: 1, score: 0, responses: [r(21, false), r(22, false)] }, { student_id: 2, score: 0, responses: [r(21, false), r(22, false)] }];
  const after = [{ student_id: 1, score: 0, responses: [r(21, true), r(22, true)] }, { student_id: 3, score: 0, responses: [r(21, true), r(22, true)] }];
  const both = commonStudents(before, after);
  assert.deepEqual(both, [1]);
  const qs = questions.filter((q) => q.topic_id === 2);
  const only = (list) => list.filter((a) => both.includes(a.student_id));
  const cmp = compareTopics(
    diagnose({ students, questions: qs, topics, attempts: only(before) }),
    diagnose({ students, questions: qs, topics, attempts: only(after) })
  );
  assert.equal(cmp.students_in_both, 1);
  assert.deepEqual(cmp.topics[0], { topic_id: 2, name: 'Time & Work', before: 0, after: 100, change: 100, weak_before: 1, weak_after: 0 });
});

test('phone and CSV helpers', () => {
  assert.equal(normalizePhone('+91 98765 43210'), '9876543210');
  assert.equal(normalizePhone('09876543210'), '9876543210');
  assert.equal(normalizePhone('12345'), null);
  const rows = parseCsv('Name,Phone\r\n"Singh, Aman",9876543210\n\n"He said ""hi""",9876543211');
  assert.deepEqual(rows, [{ name: 'Singh, Aman', phone: '9876543210' }, { name: 'He said "hi"', phone: '9876543211' }]);
});

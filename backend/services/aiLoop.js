import pool from '../config/db.js';
import { aiConfigured, askJSON } from './aiText.js';

// AI is optional everywhere: no key, over the daily cap, a timeout or an odd
// answer → the plain template is used. The AI never sets numbers or picks
// questions; it only words things.

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT_PER_CENTRE) || 300;

async function takeQuota(centreId, feature) {
  if (!aiConfigured()) return false;
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM ai_usage WHERE centre_id = $1 AND created_at > now() - interval '1 day'`, [centreId]
  );
  const c = await pool.query('SELECT plan, ai_daily_limit FROM centres WHERE id = $1', [centreId]);
  if (c.rows[0]?.plan === 'basic') return false; // the Basic plan has no AI
  const limit = c.rows[0]?.ai_daily_limit ?? DAILY_LIMIT;
  if (rows[0].n >= limit) return false;
  await pool.query('INSERT INTO ai_usage (centre_id, feature) VALUES ($1, $2)', [centreId, feature]);
  return true;
}

/** Rewrite the re-teach notes into a short, concrete next-class plan. */
export async function rewriteActions(centreId, plan, diag) {
  const reteach = plan.filter((p) => p.kind === 'reteach');
  if (!reteach.length || !(await takeQuota(centreId, 'actions'))) return plan;
  const out = await askJSON({
    system: 'You help a coaching-centre teacher plan the next class for a government-exam batch (SSC/Railway). '
      + 'For each topic, write one note (max 45 words) for a 15-minute re-teach: what to re-explain and one quick check. '
      + 'Keep every number exactly as given. Return {"notes": {"<topic_id>": "<note>"}}.',
    payload: {
      batch_size: diag.participation.submitted,
      topics: reteach.map((p) => {
        const t = diag.topics.find((x) => x.topic_id === p.topic_id);
        return { topic_id: p.topic_id, topic: t?.name, subject: t?.subject, batch_accuracy: p.accuracy, students_weak: t?.weak_students.length };
      }),
    },
    maxTokens: 600,
  });
  const notes = out?.notes && typeof out.notes === 'object' ? out.notes : {};
  return plan.map((p) => {
    const n = p.kind === 'reteach' ? notes[String(p.topic_id)] : null;
    return typeof n === 'string' && n.trim() && n.length <= 400 ? { ...p, note: n.trim() } : p;
  });
}

// Same idea as Waynur's tutor rules: guide, don't hand over the answer.
const HINT_RULES = 'You are a patient tutor at an Indian government-exam coaching centre. '
  + 'Give ONE short hint (max 60 words) that points the student to the method, without revealing which option is correct. '
  + 'Use only the centre\'s explanation and notes in the data. Reply in the language the student used for their question, or simple English. '
  + 'Return {"hint": "<text>"}.';

/** A guided hint for one practice question. Falls back to the first step of the centre's explanation. */
export async function hintFor(centreId, question, topicNotes, studentNote = '') {
  // Without AI the hint comes from the centre's topic notes (the method),
  // never from the question's explanation, which usually gives the answer away.
  const fallback = () => {
    const notes = String(topicNotes || '').trim();
    if (notes) return `Method: ${notes.split(/(?<=[.!?।])\s+/).slice(0, 2).join(' ')}`;
    return 'Read the question again and write down what is given and what is asked. Which formula or rule links them?';
  };
  if (!(await takeQuota(centreId, 'hint'))) return { hint: fallback(), ai: false };
  const out = await askJSON({
    system: HINT_RULES,
    payload: {
      question: question.stem,
      options: question.options,
      centre_explanation: question.explanation || null,
      centre_notes: topicNotes ? String(topicNotes).slice(0, 3000) : null,
      student_says: String(studentNote || '').slice(0, 500) || null,
    },
    maxTokens: 250,
  });
  const hint = typeof out?.hint === 'string' ? out.hint.trim() : '';
  // Never let a hint name the correct option's text outright.
  const answer = String(question.options[question.correct_index] || '').trim().toLowerCase();
  if (!hint || hint.length > 600 || (answer.length > 2 && hint.toLowerCase().includes(answer))) return { hint: fallback(), ai: false };
  return { hint, ai: true };
}

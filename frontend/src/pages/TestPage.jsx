import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { api, getSession, KIND_LABEL } from '../api.js';
import { Bar, ErrorNote, Loading, Stat, useApi } from '../components/ui.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function waLink(phone, text) {
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
}

function PaperEntry({ test, questions, students, onSaved }) {
  const [rows, setRows] = useState(() => Object.fromEntries(students.map((s) => [s.id, questions.map(() => '')])));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setErr(null); setBusy(true);
    const results = Object.entries(rows)
      .filter(([, a]) => a.some((x) => x !== ''))
      .map(([studentId, a]) => ({ studentId: Number(studentId), answers: a.map((x) => (x === '' ? null : Number(x))) }));
    try { await api(`/tests/${test.id}/paper`, { method: 'POST', body: { results } }); onSaved(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <section className="card space-y-3">
      <h2 className="h2">Enter paper answers</h2>
      <p className="text-sm text-ink-soft">Pick each student's answer (blank = skipped). Students with every box blank are treated as absent.</p>
      <ErrorNote error={err} />
      <div className="overflow-x-auto"><table className="text-sm">
        <thead><tr><th className="py-1 pr-3 text-left">Student</th>{questions.map((q, i) => <th key={q.id} className="px-1">Q{i + 1}</th>)}</tr></thead>
        <tbody>{students.map((s) => (
          <tr key={s.id} className="border-t border-border">
            <td className="py-1 pr-3 whitespace-nowrap">{s.name}</td>
            {questions.map((q, i) => (
              <td key={q.id} className="px-1">
                <select className="rounded border border-input bg-card px-1 py-0.5" aria-label={`${s.name}, question ${i + 1}`} value={rows[s.id][i]}
                  onChange={(e) => setRows({ ...rows, [s.id]: rows[s.id].map((x, j) => (j === i ? e.target.value : x)) })}>
                  <option value="">–</option>{q.options.map((_, k) => <option key={k} value={k}>{LETTERS[k]}</option>)}
                </select>
              </td>))}
          </tr>))}
        </tbody>
      </table></div>
      <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save marks'}</button>
    </section>
  );
}

const SEND = [
  { key: 'students', kind: 'test_open', label: 'Test link to students', when: (t) => t.status === 'published' && t.mode === 'online' },
  { key: 'parents', kind: 'result_parent', label: 'Results to parents', when: (t, d) => d.participation.submitted > 0 },
  { key: 'practice', kind: 'practice', label: 'Practice to weak students', when: (t, d, a) => a.some((x) => x.kind === 'practice') },
  { key: 'teacher', kind: 'teacher_report', label: 'Summary to the teacher', when: (t, d, a) => a.length > 0 },
];

// What went out on WhatsApp for this test. Sending happens automatically;
// these buttons resend to anyone who was missed (no one gets it twice).
function WhatsAppPanel({ test, diag, actions }) {
  const [data, error, reload] = useApi(() => api(`/tests/${test.id}/whatsapp`), [test.id, test.status, diag.participation.submitted, actions.length]);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const items = SEND.filter((x) => x.when(test, diag, actions));
  async function send(key) {
    setBusy(key); setErr(null); setMsg(null);
    try {
      const { result: r } = await api(`/tests/${test.id}/whatsapp`, { method: 'POST', body: { send: key } });
      setMsg(`${r.sent} sent${r.already ? `, ${r.already} already had it` : ''}${r.no_number ? `, ${r.no_number} with no number saved` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}${r.failed ? `, ${r.failed} failed` : ''}.`);
      reload();
    } catch (x) { setErr(x.message); } finally { setBusy(null); }
  }
  const count = (kind, st) => data.summary[kind]?.[st] || 0;
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="h2 flex items-center gap-2"><MessageCircle size={18} aria-hidden="true" />WhatsApp</h2>
        <span className="text-sm text-ink-soft">{data.connected ? `From ${data.number}` : 'Not connected yet: the Waynur team connects your number'}</span>
      </div>
      <ErrorNote error={err} />{msg && <p className="text-sm">{msg}</p>}
      {items.length ? (
        <ul className="divide-y divide-border text-sm">
          {items.map((x) => {
            const ok = count(x.kind, 'sent') + count(x.kind, 'delivered') + count(x.kind, 'read');
            return (
              <li key={x.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><strong>{x.label}</strong> <span className="text-ink-soft">· {ok} sent{count(x.kind, 'read') ? `, ${count(x.kind, 'read')} read` : ''}{count(x.kind, 'failed') ? `, ${count(x.kind, 'failed')} failed` : ''}{count(x.kind, 'skipped') ? `, ${count(x.kind, 'skipped')} skipped` : ''}</span></span>
                {data.connected && <button className="btn-ghost px-3 py-1" disabled={!!busy} onClick={() => send(x.key)}>{busy === x.key ? 'Sending…' : 'Send to anyone missed'}</button>}
              </li>);
          })}
        </ul>
      ) : <p className="text-sm text-ink-soft">Publish the test to send students their link.</p>}
    </section>
  );
}

function Verify({ id }) {
  const [data, error] = useApi(() => api(`/tests/${id}/verify`), [id]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const c = data.comparison;
  return (
    <section className="card space-y-3">
      <h2 className="h2">Did it work?</h2>
      <p className="text-sm text-ink-soft">Compared with <Link className="text-terracotta" to={`/tests/${data.original.id}`}>{data.original.title}</Link>, for the {c.students_in_both} student(s) who took both.</p>
      {c.students_in_both === 0 ? <p className="text-sm">No student has taken both tests yet.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-ink-soft"><th className="py-2">Topic</th><th>Before</th><th>After</th><th>Change</th><th>Students still weak</th></tr></thead>
          <tbody>{c.topics.map((t) => (
            <tr key={t.topic_id} className="border-t border-border">
              <td className="py-2 font-medium">{t.name}</td><td>{t.before}%</td><td>{t.after ?? '–'}%</td>
              <td className={t.change > 0 ? 'font-semibold text-green-700' : t.change < 0 ? 'font-semibold text-destructive' : ''}>{t.change == null ? '–' : `${t.change > 0 ? '+' : ''}${t.change} pts`}</td>
              <td>{t.weak_before} → {t.weak_after ?? '–'}</td>
            </tr>))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function TestPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const s = getSession();
  const [data, error, reload] = useApi(() => Promise.all([api(`/tests/${id}`), api(`/tests/${id}/diagnosis`), api(`/tests/${id}/actions`)]), [id]);
  const [roster] = useApi(() => (data ? api(`/centre/batches/${data[0].test.batch_id}`) : Promise.resolve(null)), [data?.[0]?.test?.batch_id]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  async function act(name, fn) {
    setErr(null); setBusy(name);
    try { await fn(); } catch (x) { setErr(x.message); } finally { setBusy(null); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const [{ test, questions }, { diagnosis: d }, { actions }] = data;
  const reteach = actions.filter((a) => a.kind === 'reteach');
  const practice = actions.filter((a) => a.kind === 'practice');
  const loginLink = `${window.location.origin}/s/${s.centreId}`;
  const avg = d.students.length ? Math.round((d.students.reduce((a, x) => a + Number(x.score), 0) / d.students.length) * 10) / 10 : null;
  const topicName = new Map(d.topics.map((t) => [t.topic_id, t.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/batch/${test.batch_id}`} className="text-sm text-ink-soft">← Batch</Link>
          <h1 className="h1">{test.title}</h1>
          <p className="text-sm text-ink-soft">{KIND_LABEL[test.kind]} · {test.mode === 'paper' ? 'on paper' : 'online'} · {questions.length} questions · {test.duration_min} min · +{Number(test.marks_correct)} / −{Number(test.marks_wrong)} · <span className="capitalize">{test.status}</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          {test.status === 'draft' && <button className="btn-primary" disabled={!!busy} onClick={() => act('pub', async () => { await api(`/tests/${id}/status`, { method: 'POST', body: { status: 'published' } }); reload(); })}>Publish to students</button>}
          {test.status === 'published' && <button className="btn-ghost" disabled={!!busy} onClick={() => act('close', async () => { await api(`/tests/${id}/status`, { method: 'POST', body: { status: 'closed' } }); reload(); })}>Close test</button>}
          {test.kind !== 'retest' && d.participation.submitted > 0 && (
            <button className="btn-ghost" disabled={!!busy} onClick={() => act('retest', async () => { const r = await api(`/tests/${id}/retest`, { method: 'POST' }); nav(`/tests/${r.test.id}`); })}>{busy === 'retest' ? 'Making…' : 'Make re-test'}</button>
          )}
        </div>
      </div>
      <ErrorNote error={err} />
      {test.status === 'published' && test.mode === 'online' && <p className="rounded-lg bg-secondary px-3 py-2 text-sm">Each student got a WhatsApp link that opens this test. They can also open <code>{loginLink}</code> and log in with their mobile number.</p>}

      {test.mode === 'paper' && roster && <PaperEntry test={test} questions={questions} students={roster.students} onSaved={reload} />}

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Submitted" value={`${d.participation.submitted} / ${d.participation.total}`} hint={d.participation.pct != null ? `${d.participation.pct}% of the batch` : null} />
        <Stat label="Average score" value={avg ?? '–'} hint={`out of ${questions.length * Number(test.marks_correct)}`} />
        <Stat label="Topics to re-teach" value={d.topics.filter((t) => t.reteach).length} hint="below 60%, or 40%+ of students weak" />
      </section>

      <WhatsAppPanel test={test} diag={d} actions={actions} />

      {test.kind === 'retest' && <Verify id={id} />}

      {d.participation.submitted > 0 && (
        <section className="card">
          <h2 className="h2 mb-3">Topics, weakest first</h2>
          <ul className="space-y-3">
            {d.topics.map((t) => (
              <li key={t.topic_id}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span><strong>{t.name}</strong> <span className="text-ink-soft">· {t.subject} · {t.questions} q</span>{t.reteach && <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">Re-teach</span>}</span>
                  <span>{t.accuracy}% · {t.weak_students.length} student(s) below 50%</span>
                </div>
                <Bar value={t.accuracy} />
              </li>))}
          </ul>
        </section>
      )}

      {d.participation.submitted > 0 && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2">Next class</h2>
            <button className="btn-primary" disabled={!!busy} onClick={() => act('plan', async () => { await api(`/tests/${id}/actions`, { method: 'POST' }); reload(); })}>
              {busy === 'plan' ? 'Planning…' : actions.length ? 'Update plan' : 'Make next-class plan'}
            </button>
          </div>
          {!actions.length && <p className="text-sm text-ink-soft">Turns these results into a short re-teach list and a practice set for each weak student.</p>}
          {reteach.map((a) => (
            <label key={a.id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={a.status === 'done'} onChange={(e) => act('done', async () => { await api(`/tests/actions/${a.id}`, { method: 'PATCH', body: { status: e.target.checked ? 'done' : 'open' } }); reload(); })} />
              <span><strong>{a.topic}</strong>: {a.note}</span>
            </label>
          ))}
          {practice.map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="mb-2"><strong>Practice · {a.topic}</strong> <span className="text-ink-soft">({a.practice_done} of {a.practice_sets} done)</span></div>
              <ul className="divide-y divide-border">
                {a.students.map((st) => (
                  <li key={st.student_id} className="flex items-center justify-between py-1.5">
                    <span>{st.name} · {st.questions} questions {st.done && <span className="text-green-700">✓ done</span>}</span>
                    {!st.done && (
                      <a className="inline-flex items-center gap-1 text-terracotta" target="_blank" rel="noreferrer"
                        href={waLink(st.phone, `Hi ${st.name}, you have a short practice set on ${a.topic}. Open ${loginLink} and log in with your mobile number.`)}>
                        <MessageCircle size={15} aria-hidden="true" />Send on WhatsApp
                      </a>)}
                  </li>))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {d.students.length > 0 && (
        <section className="card">
          <h2 className="h2 mb-3">Students</h2>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-ink-soft"><th className="py-2">Student</th><th>Score</th><th>Accuracy</th><th>Weak topics</th></tr></thead>
            <tbody>{d.students.map((st) => (
              <tr key={st.student_id} className="border-t border-border">
                <td className="py-2">{st.name}</td><td>{st.score}</td><td>{st.accuracy}%</td>
                <td>{st.weak_topics.map((t) => topicName.get(t)).join(', ') || '–'}</td>
              </tr>))}
            </tbody>
          </table></div>
          {d.not_attempted.length > 0 && <p className="mt-3 text-sm text-ink-soft">Not taken yet: {d.not_attempted.map((x) => x.name).join(', ')}</p>}
        </section>
      )}

      <details className="card">
        <summary className="cursor-pointer font-semibold">Questions in this test</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          {questions.map((q) => <li key={q.id}><span className="text-ink-soft">{q.topic}: </span>{q.stem} <span className="text-ink-soft">(answer {LETTERS[q.correct_index]})</span></li>)}
        </ol>
      </details>
    </div>
  );
}

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';
import { api } from '../api.js';
import { ErrorNote, Loading, useApi } from '../components/ui.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function Practice() {
  const { id } = useParams();
  const [data, error, reload] = useApi(() => api(`/student/practice/${id}`), [id]);
  const [hints, setHints] = useState({});
  const [err, setErr] = useState(null);
  async function answer(qid, chosen) {
    setErr(null);
    try { await api(`/student/practice/${id}/answer`, { method: 'POST', body: { questionId: qid, chosen } }); reload(); } catch (e) { setErr(e.message); }
  }
  async function hint(qid) {
    setErr(null);
    try { const r = await api(`/student/practice/${id}/hint`, { method: 'POST', body: { questionId: qid } }); setHints({ ...hints, [qid]: r.hint }); } catch (e) { setErr(e.message); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to="/" className="text-sm text-ink-soft">← My tests</Link>
      <h1 className="h1">Practice</h1>
      {data.completed_at && <p className="rounded-lg bg-secondary px-3 py-2 text-sm">All done. Well done! Your teacher can see you finished.</p>}
      <ErrorNote error={err} />
      {data.questions.map((q, i) => {
        const done = q.chosen !== null;
        return (
          <div key={q.id} className="card space-y-3 text-sm">
            <div className="text-xs text-ink-soft">Question {i + 1} of {data.questions.length}</div>
            <p className="text-base font-medium">{q.stem}</p>
            <div className="space-y-2">
              {q.options.map((o, k) => {
                const style = !done ? 'border-border hover:bg-secondary' : k === q.correct_index ? 'border-green-600 bg-green-50 font-semibold' : k === q.chosen ? 'border-destructive bg-destructive/10' : 'border-border opacity-70';
                return (
                  <button key={k} type="button" disabled={done} onClick={() => answer(q.id, k)} className={`flex w-full gap-3 rounded-lg border px-3 py-2.5 text-left ${style}`}>
                    <span className="w-5">{LETTERS[k]}</span>{o}
                  </button>);
              })}
            </div>
            {done && q.explanation && <p className="rounded-lg bg-secondary px-3 py-2">{q.explanation}</p>}
            {!done && (hints[q.id]
              ? <p className="flex gap-2 rounded-lg bg-amber-warm/30 px-3 py-2"><Lightbulb size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{hints[q.id]}</p>
              : <button className="btn-ghost px-3 py-1.5" onClick={() => hint(q.id)}><Lightbulb size={15} aria-hidden="true" />Get a hint</button>)}
          </div>);
      })}
    </div>
  );
}

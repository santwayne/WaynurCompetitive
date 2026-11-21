import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorNote, Loading, useApi } from '../components/ui.jsx';

export default function NewTest() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, error] = useApi(() => Promise.all([api(`/centre/batches/${id}`), api('/syllabus/topics')]), [id]);
  const [f, setF] = useState({ title: '', kind: 'exit_ticket', mode: 'online', durationMin: '' });
  const [counts, setCounts] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function create(e) {
    e.preventDefault(); setErr(null);
    const picks = Object.entries(counts).filter(([, n]) => Number(n) > 0).map(([topicId, count]) => ({ topicId: Number(topicId), count: Number(count) }));
    if (!picks.length) { setErr('Pick at least one topic and how many questions from it.'); return; }
    setBusy(true);
    try {
      const r = await api('/tests', { method: 'POST', body: { batchId: Number(id), ...f, durationMin: f.durationMin || undefined, picks } });
      nav(`/tests/${r.test.id}`);
    } catch (x) { setErr(x.message); setBusy(false); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const [{ batch }, { topics }] = data;
  const total = Object.values(counts).reduce((a, n) => a + (Number(n) || 0), 0);
  return (
    <form onSubmit={create} className="space-y-6">
      <div><Link to={`/batch/${id}`} className="text-sm text-ink-soft">← {batch.name}</Link><h1 className="h1">New test</h1></div>
      <ErrorNote error={err} />
      <div className="card grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label" htmlFor="t">Title</label><input id="t" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Percentages exit ticket, 21 Nov" required /></div>
        <div><label className="label" htmlFor="k">Type</label>
          <select id="k" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="exit_ticket">Exit ticket (short, after class)</option><option value="scheduled">Scheduled test</option>
          </select></div>
        <div><label className="label" htmlFor="m">How students take it</label>
          <select id="m" className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
            <option value="online">Online (phone or computer)</option><option value="paper">On paper (you enter the answers)</option>
          </select></div>
        <div><label className="label" htmlFor="d">Minutes (blank = default)</label><input id="d" className="input" type="number" min="1" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} placeholder={f.kind === 'exit_ticket' ? '10' : 'from exam pattern'} /></div>
        <p className="self-end text-sm text-ink-soft">Marks and negative marking come from the batch's exam pattern.</p>
      </div>
      <div className="card">
        <h2 className="h2 mb-1">Questions per topic</h2>
        <p className="mb-3 text-sm text-ink-soft">Picked at random from approved questions. Total: <strong>{total}</strong></p>
        <div className="grid gap-2 sm:grid-cols-2">
          {topics.filter((t) => t.approved > 0).map((t) => (
            <label key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <span>{t.subject} · <strong>{t.name}</strong> <span className="text-ink-soft">({t.approved} available)</span></span>
              <input type="number" min="0" max={t.approved} className="input w-20" aria-label={`Questions from ${t.name}`} value={counts[t.id] ?? ''} onChange={(e) => setCounts({ ...counts, [t.id]: e.target.value })} />
            </label>
          ))}
        </div>
        {!topics.some((t) => t.approved > 0) && <p className="text-sm text-ink-soft">No approved questions yet. <Link to="/questions" className="text-terracotta">Add some to the question bank</Link>.</p>}
      </div>
      <button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create test'}</button>
    </form>
  );
}

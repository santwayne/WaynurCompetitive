import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getSession } from '../api.js';
import { ErrorNote, Loading, useApi } from '../components/ui.jsx';

export default function Dashboard() {
  const s = getSession();
  const lead = ['owner', 'academic_head'].includes(s.role);
  const [data, error, reload] = useApi(() => Promise.all([api('/centre/batches'), api('/syllabus/exam-patterns')]));
  const [f, setF] = useState({ name: '', examPatternId: '' });
  const [err, setErr] = useState(null);
  const studentLink = `${window.location.origin}/s/${s.centreId}`;

  async function add(e) {
    e.preventDefault(); setErr(null);
    try {
      await api('/centre/batches', { method: 'POST', body: { name: f.name, examPatternId: f.examPatternId ? Number(f.examPatternId) : null } });
      setF({ name: '', examPatternId: '' }); reload();
    } catch (x) { setErr(x.message); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const [{ batches }, { patterns }] = data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Batches</h1>
          <p className="text-sm text-ink-soft">Teach → Check → Diagnose → Intervene → Verify. Open a batch to run a test.</p>
        </div>
        <div className="text-sm text-ink-soft">Student login link: <code className="rounded bg-secondary px-2 py-1">{studentLink}</code></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {batches.map((b) => (
          <Link key={b.id} to={`/batch/${b.id}`} className="card block hover:border-terracotta">
            <div className="h2">{b.name}</div>
            <div className="mt-1 text-sm text-ink-soft">{b.exam_pattern || 'No exam pattern'}</div>
            <div className="mt-3 text-sm text-ink-soft">{b.students} students · {b.tests} tests</div>
          </Link>
        ))}
        {!batches.length && <p className="text-sm text-ink-soft">No batches yet{lead ? '. Add your first one below.' : '. Ask the owner to add one.'}</p>}
      </div>
      {lead && (
        <form onSubmit={add} className="card grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div><label className="label" htmlFor="bn">New batch name</label><input id="bn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. CGL Morning 2026" required /></div>
          <div><label className="label" htmlFor="bp">Exam pattern</label>
            <select id="bp" className="input" value={f.examPatternId} onChange={(e) => setF({ ...f, examPatternId: e.target.value })}>
              <option value="">None</option>
              {patterns.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.version}) · +{Number(p.marks_correct)} / −{Number(p.marks_wrong)}</option>)}
            </select>
          </div>
          <button className="btn-primary">Add batch</button>
          <div className="sm:col-span-3"><ErrorNote error={err} /></div>
        </form>
      )}
    </div>
  );
}

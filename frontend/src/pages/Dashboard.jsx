import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getSession, studentLoginLink, updateSession } from '../api.js';
import { ErrorNote, Loading, useApi } from '../components/ui.jsx';

export default function Dashboard() {
  const s = getSession();
  const lead = ['owner', 'academic_head'].includes(s.role);
  const [data, error, reload] = useApi(() => Promise.all([api('/centre/batches'), api('/syllabus/exam-patterns'), api('/centre/whatsapp'), api('/auth/me')]));
  const [f, setF] = useState({ name: '', examPatternId: '' });
  const [err, setErr] = useState(null);

  async function add(e) {
    e.preventDefault(); setErr(null);
    // Without a pattern a batch's tests are +1 with no negative marking.
    if (f.examPatternId === 'none' && !window.confirm('No exam pattern: tests in this batch will give +1 per correct answer and no negative marking. Continue?')) return;
    try {
      await api('/centre/batches', { method: 'POST', body: { name: f.name, examPatternId: f.examPatternId && f.examPatternId !== 'none' ? Number(f.examPatternId) : null } });
      setF({ name: '', examPatternId: '' }); reload();
    } catch (x) { setErr(x.message); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const [{ batches }, { patterns }, wa, me] = data;
  const code = me.centre?.code;
  if (code && code !== s.centreCode) updateSession({ centreCode: code });
  const studentLink = studentLoginLink(code);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Batches</h1>
          <p className="text-sm text-ink-soft">Teach → Check → Diagnose → Intervene → Verify. Open a batch to run a test.</p>
        </div>
        <div className="text-sm text-ink-soft">Student login link: <code className="rounded bg-secondary px-2 py-1">{studentLink}</code> · App centre code: <code className="rounded bg-secondary px-2 py-1 font-semibold tracking-widest">{code}</code></div>
      </div>
      {!wa.connected && (
        <p className="rounded-lg bg-secondary px-3 py-2 text-sm">WhatsApp is not connected yet, so students, parents and teachers get nothing on WhatsApp. The Waynur team connects your centre's number. <Link to="/whatsapp" className="font-semibold text-terracotta">What it does</Link></p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {batches.map((b) => (
          <Link key={b.id} to={`/batch/${b.id}`} className="card block hover:border-terracotta">
            <div className="h2">{b.name}</div>
            <div className={`mt-1 text-sm ${b.exam_pattern ? 'text-ink-soft' : 'font-semibold text-destructive'}`}>{b.exam_pattern || 'No exam pattern: no negative marking'}</div>
            <div className="mt-3 text-sm text-ink-soft">{b.students} students · {b.tests} tests</div>
          </Link>
        ))}
        {!batches.length && <p className="text-sm text-ink-soft">No batches yet{lead ? '. Add your first one below.' : '. Ask the owner to add one.'}</p>}
      </div>
      {lead && (
        <form onSubmit={add} className="card grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div><label className="label" htmlFor="bn">New batch name</label><input id="bn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. CGL Morning 2026" required /></div>
          <div><label className="label" htmlFor="bp">Exam pattern</label>
            <select id="bp" className="input" value={f.examPatternId} onChange={(e) => setF({ ...f, examPatternId: e.target.value })} required>
              <option value="" disabled>Choose the exam pattern…</option>
              {patterns.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.version}) · +{Number(p.marks_correct)} / −{Number(p.marks_wrong)}</option>)}
              <option value="none">No exam pattern (+1, no negative marking)</option>
            </select>
          </div>
          <button className="btn-primary">Add batch</button>
          <div className="sm:col-span-3"><ErrorNote error={err} /></div>
        </form>
      )}
    </div>
  );
}

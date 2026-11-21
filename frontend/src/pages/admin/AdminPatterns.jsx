import { useState } from 'react';
import { api } from '../../api.js';
import { ErrorNote, Loading, useApi } from '../../components/ui.jsx';

// Shared exam patterns every centre can pick for a batch. When the official
// pattern changes, add a new version rather than editing the old one.
function Row({ p, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: p.name, durationMin: p.duration_min, marksCorrect: Number(p.marks_correct), marksWrong: Number(p.marks_wrong) });
  const [err, setErr] = useState(null);
  async function save() {
    setErr(null);
    try { await api(`/admin/exam-patterns/${p.id}`, { method: 'PATCH', body: f }); setEdit(false); onSaved(); }
    catch (x) { setErr(x.message); }
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!edit) {
    return (
      <tr className="border-t border-border">
        <td className="py-2 font-medium">{p.name}<div className="text-xs text-ink-soft">{p.code}</div></td><td>{p.version}</td><td>{p.duration_min} min</td>
        <td>+{Number(p.marks_correct)} / −{Number(p.marks_wrong)}</td><td>{p.sections.map((s) => `${s.subject} ${s.questions}`).join(' · ') || '–'}</td><td>{p.batches}</td>
        <td className="text-right"><button className="text-sm font-semibold text-terracotta" onClick={() => setEdit(true)}>Edit</button></td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-border bg-secondary/40">
      <td className="py-2"><input className="input" aria-label="Name" value={f.name} onChange={set('name')} /></td><td>{p.version}</td>
      <td><input className="input w-20" aria-label="Minutes" value={f.durationMin} onChange={set('durationMin')} /></td>
      <td className="whitespace-nowrap">+<input className="input inline w-16" aria-label="Marks for correct" value={f.marksCorrect} onChange={set('marksCorrect')} /> −<input className="input inline w-16" aria-label="Marks cut for wrong" value={f.marksWrong} onChange={set('marksWrong')} /></td>
      <td colSpan={2}><ErrorNote error={err} /></td>
      <td className="whitespace-nowrap text-right"><button className="btn-primary px-3 py-1" onClick={save}>Save</button> <button className="btn-ghost px-3 py-1" onClick={() => setEdit(false)}>Cancel</button></td>
    </tr>
  );
}

export default function AdminPatterns() {
  const [data, error, reload] = useApi(() => api('/admin/exam-patterns'));
  const [f, setF] = useState({ code: '', name: '', version: String(new Date().getFullYear()), durationMin: 60, marksCorrect: 2, marksWrong: 0.5, sections: '' });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function add(e) {
    e.preventDefault(); setErr(null);
    try {
      // Sections: one per line, "Subject: 25"
      const sections = f.sections.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const m = l.match(/^(.+?)\s*[:\-–]\s*(\d+)$/);
        if (!m) throw new Error(`Write sections as "Subject: 25". Could not read "${l}"`);
        return { subject: m[1], questions: Number(m[2]) };
      });
      await api('/admin/exam-patterns', { method: 'POST', body: { ...f, sections } });
      reload();
    } catch (x) { setErr(x.message); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-6">
      <div><h1 className="h1">Exam patterns</h1><p className="text-sm text-ink-soft">Shared by every centre. Check marks and timing against each new official notification. Tests already made keep their own marks.</p></div>
      <section className="card overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-ink-soft"><th className="py-2">Pattern</th><th>Version</th><th>Time</th><th>Marks</th><th>Sections</th><th>Batches</th><th /></tr></thead>
        <tbody>{data.patterns.map((p) => <Row key={p.id} p={p} onSaved={reload} />)}</tbody>
      </table></section>
      <form onSubmit={add} className="card grid gap-3 sm:grid-cols-3">
        <h2 className="h2 sm:col-span-3">Add a pattern or a new version</h2>
        <div className="sm:col-span-3"><ErrorNote error={err} /></div>
        <div><label className="label" htmlFor="xc">Code</label><input id="xc" className="input" value={f.code} onChange={set('code')} placeholder="SSC-MTS" required /></div>
        <div><label className="label" htmlFor="xn">Name</label><input id="xn" className="input" value={f.name} onChange={set('name')} placeholder="SSC MTS" required /></div>
        <div><label className="label" htmlFor="xv">Version</label><input id="xv" className="input" value={f.version} onChange={set('version')} required /></div>
        <div><label className="label" htmlFor="xd">Minutes</label><input id="xd" className="input" inputMode="numeric" value={f.durationMin} onChange={set('durationMin')} required /></div>
        <div><label className="label" htmlFor="xm">Marks per correct</label><input id="xm" className="input" value={f.marksCorrect} onChange={set('marksCorrect')} required /></div>
        <div><label className="label" htmlFor="xw">Marks cut per wrong</label><input id="xw" className="input" value={f.marksWrong} onChange={set('marksWrong')} required /></div>
        <div className="sm:col-span-3"><label className="label" htmlFor="xs">Sections, one per line ("Subject: questions")</label><textarea id="xs" className="input h-24" value={f.sections} onChange={set('sections')} placeholder={'Reasoning: 25\nGeneral Awareness: 25'} /></div>
        <button className="btn-primary sm:w-fit">Add</button>
      </form>
    </div>
  );
}

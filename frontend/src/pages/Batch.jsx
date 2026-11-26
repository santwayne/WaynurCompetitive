import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getSession, KIND_LABEL } from '../api.js';
import { CsvBox, ErrorNote, Loading, useApi } from '../components/ui.jsx';

// One student row: edit details, move to another batch, take out of this
// batch, or mark as "left coaching" (frees a place in the plan's limit).
function StudentRow({ s, batchId, otherBatches, onDone, onError }) {
  const [mode, setMode] = useState(null); // null | 'edit' | 'move'
  const [f, setF] = useState(null);
  const [to, setTo] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function run(fn) {
    onError(null);
    try { await fn(); setMode(null); onDone(); } catch (x) { onError(x.message); }
  }
  const save = (e) => { e.preventDefault(); run(() => api(`/centre/students/${s.id}`, { method: 'PATCH', body: f })); };
  return (
    <li className={`py-2 ${s.active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap justify-between gap-2">
        <span>{s.roll_no ? `${s.roll_no}. ` : ''}{s.name}{!s.active && <span className="ml-1 text-xs text-destructive">(left coaching)</span>}</span>
        <span className="text-ink-soft">{s.phone}</span>
      </div>
      <div className="text-xs text-ink-soft">Parent: {s.parent_phone ? `${s.parent_name ? `${s.parent_name}, ` : ''}${s.parent_phone}` : 'no WhatsApp number'}</div>
      {mode === 'edit' && (
        <form className="mt-2 grid gap-2 sm:grid-cols-2" onSubmit={save}>
          <input className="input py-1" aria-label="Student name" placeholder="Name" value={f.name} onChange={set('name')} required />
          <input className="input py-1" aria-label="Student mobile" placeholder="Student mobile" inputMode="tel" value={f.phone} onChange={set('phone')} required />
          <input className="input py-1" aria-label="Roll number" placeholder="Roll no" value={f.roll_no} onChange={set('roll_no')} />
          <input className="input py-1" aria-label="Parent name" placeholder="Parent name" value={f.parent_name} onChange={set('parent_name')} />
          <input className="input py-1" aria-label="Parent WhatsApp" placeholder="Parent mobile" inputMode="tel" value={f.parent_phone} onChange={set('parent_phone')} />
          <div className="flex gap-2"><button className="btn-primary px-3 py-1">Save</button><button type="button" className="btn-ghost px-3 py-1" onClick={() => setMode(null)}>Cancel</button></div>
          <p className="text-xs text-ink-soft sm:col-span-2">If you change the mobile, the student logs in with the new number. If their password was still the old number, it becomes the new number.</p>
        </form>
      )}
      {mode === 'move' && (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (to) run(() => api(`/centre/students/${s.id}/move`, { method: 'POST', body: { fromBatchId: Number(batchId), toBatchId: Number(to) } })); }}>
          <select className="input w-auto py-1" aria-label="Move to batch" value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">Move to…</option>{otherBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="btn-primary px-3 py-1">Move</button><button type="button" className="btn-ghost px-3 py-1" onClick={() => setMode(null)}>Cancel</button>
        </form>
      )}
      {!mode && (
        <div className="mt-1 flex flex-wrap gap-3 text-xs font-semibold">
          <button className="text-terracotta" onClick={() => { setF({ name: s.name, phone: s.phone, roll_no: s.roll_no || '', parent_name: s.parent_name || '', parent_phone: s.parent_phone || '' }); setMode('edit'); }}>Edit</button>
          {otherBatches.length > 0 && <button className="text-terracotta" onClick={() => setMode('move')}>Move to batch</button>}
          <button className="text-ink-soft" onClick={() => window.confirm(`Take ${s.name} out of this batch? They stay in the centre and in other batches.`) && run(() => api(`/centre/batches/${batchId}/students/${s.id}`, { method: 'DELETE' }))}>Remove from batch</button>
          {s.active
            ? <button className="text-destructive" onClick={() => window.confirm(`Mark ${s.name} as left the coaching? They can no longer log in and no longer count in your student limit. Old results stay.`) && run(() => api(`/centre/students/${s.id}`, { method: 'PATCH', body: { active: false } }))}>Left coaching</button>
            : <button className="text-terracotta" onClick={() => run(() => api(`/centre/students/${s.id}`, { method: 'PATCH', body: { active: true } }))}>Bring back</button>}
        </div>
      )}
    </li>
  );
}

function PatternEdit({ batch, patterns, onDone }) {
  const [v, setV] = useState(batch.exam_pattern_id ? String(batch.exam_pattern_id) : 'none');
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);
  async function save() {
    setErr(null); setOk(false);
    if (v === 'none' && !window.confirm('No exam pattern: new tests give +1 per correct answer and no negative marking. Continue?')) return;
    try { await api(`/centre/batches/${batch.id}`, { method: 'PATCH', body: { examPatternId: v === 'none' ? null : Number(v) } }); setOk(true); onDone(); }
    catch (x) { setErr(x.message); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="bpat" className="text-ink-soft">Exam pattern</label>
      <select id="bpat" className="input w-auto py-1" value={v} onChange={(e) => { setOk(false); setV(e.target.value); }}>
        {patterns.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.version}) · +{Number(p.marks_correct)} / −{Number(p.marks_wrong)}</option>)}
        <option value="none">No exam pattern (+1, no negative marking)</option>
      </select>
      <button className="btn-ghost px-3 py-1" onClick={save}>Save</button>
      {ok && <span className="text-green-700">Saved. New tests use this marking.</span>}
      <ErrorNote error={err} />
    </div>
  );
}

export default function Batch() {
  const { id } = useParams();
  const lead = ['owner', 'academic_head'].includes(getSession().role);
  const [data, error, reload] = useApi(() => Promise.all([api(`/centre/batches/${id}`), api('/centre/batches'), api('/syllabus/exam-patterns')]), [id]);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [one, setOne] = useState({ name: '', phone: '', parent_phone: '' });

  async function importCsv(csv, clear) {
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await api(`/centre/batches/${id}/students/import`, { method: 'POST', body: { csv } }); setMsg(`${r.rows} students added (${r.created} new).`); clear(); reload(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  async function addOne(e) {
    e.preventDefault(); setErr(null);
    try { await api('/centre/students', { method: 'POST', body: { ...one, batchId: Number(id) } }); setOne({ name: '', phone: '', parent_phone: '' }); reload(); }
    catch (x) { setErr(x.message); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const [{ batch, students, tests }, { batches }, { patterns }] = data;
  const active = students.filter((s) => s.active);
  const otherBatches = batches.filter((b) => b.id !== batch.id);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Link to="/" className="text-sm text-ink-soft">← Batches</Link><h1 className="h1">{batch.name}</h1>
          {!batch.exam_pattern_id && <p className="text-sm font-semibold text-destructive">No exam pattern set: tests get no negative marking.</p>}
        </div>
        <Link to={`/batch/${id}/new-test`} className="btn-primary">New test</Link>
      </div>

      {lead && <section className="card"><PatternEdit key={batch.exam_pattern_id ?? 'none'} batch={batch} patterns={patterns} onDone={reload} /></section>}

      <section className="card">
        <h2 className="h2 mb-3">Tests</h2>
        {tests.length ? (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-ink-soft"><th className="py-2">Test</th><th>Type</th><th>Status</th><th>Submitted</th><th /></tr></thead>
            <tbody>{tests.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="py-2 font-medium">{t.title}</td>
                <td>{KIND_LABEL[t.kind]}{t.mode === 'paper' ? ' (paper)' : ''}</td>
                <td className="capitalize">{t.status}</td>
                <td>{t.submitted} / {active.length}</td>
                <td className="text-right"><Link to={`/tests/${t.id}`} className="font-semibold text-terracotta">Open</Link></td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <p className="text-sm text-ink-soft">No tests yet. Start with a 10-minute exit ticket after today's class.</p>}
      </section>

      <ErrorNote error={err} />{msg && <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p>}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="h2 mb-3">Students ({active.length}{students.length > active.length ? `, ${students.length - active.length} left` : ''})</h2>
          <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto text-sm">
            {students.map((s) => <StudentRow key={s.id} s={s} batchId={id} otherBatches={otherBatches} onDone={reload} onError={setErr} />)}
          </ul>
          {!students.length && <p className="text-sm text-ink-soft">No students yet.</p>}
        </div>
        <div className="card space-y-4">
          <h2 className="h2">Add students</h2>
          <form onSubmit={addOne} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <input className="input" aria-label="Student name" placeholder="Name" value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} required />
            <input className="input" aria-label="Mobile number" placeholder="Student mobile" inputMode="tel" value={one.phone} onChange={(e) => setOne({ ...one, phone: e.target.value })} required />
            <input className="input" aria-label="Parent mobile number" placeholder="Parent mobile" inputMode="tel" value={one.parent_phone} onChange={(e) => setOne({ ...one, parent_phone: e.target.value })} />
            <button className="btn-ghost">Add</button>
          </form>
          <div><p className="mb-2 text-sm text-ink-soft">Or import a CSV with columns <code>name,phone,roll_no,parent_phone,parent_name</code> (parent columns optional). Parents get results on WhatsApp.</p>
            <CsvBox busy={busy} onSubmit={importCsv} placeholder={'name,phone,roll_no,parent_phone,parent_name\nAman Gill,9876500001,1,9888800001,Mr Gill'} /></div>
        </div>
      </section>
    </div>
  );
}

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, KIND_LABEL } from '../api.js';
import { CsvBox, ErrorNote, Loading, useApi } from '../components/ui.jsx';

export default function Batch() {
  const { id } = useParams();
  const [data, error, reload] = useApi(() => api(`/centre/batches/${id}`), [id]);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [one, setOne] = useState({ name: '', phone: '' });

  async function importCsv(csv, clear) {
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await api(`/centre/batches/${id}/students/import`, { method: 'POST', body: { csv } }); setMsg(`${r.rows} students added (${r.created} new).`); clear(); reload(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  async function addOne(e) {
    e.preventDefault(); setErr(null);
    try { await api('/centre/students', { method: 'POST', body: { ...one, batchId: Number(id) } }); setOne({ name: '', phone: '' }); reload(); }
    catch (x) { setErr(x.message); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const { batch, students, tests } = data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Link to="/" className="text-sm text-ink-soft">← Batches</Link><h1 className="h1">{batch.name}</h1></div>
        <Link to={`/batch/${id}/new-test`} className="btn-primary">New test</Link>
      </div>

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
                <td>{t.submitted} / {students.length}</td>
                <td className="text-right"><Link to={`/tests/${t.id}`} className="font-semibold text-terracotta">Open</Link></td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <p className="text-sm text-ink-soft">No tests yet. Start with a 10-minute exit ticket after today's class.</p>}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="h2 mb-3">Students ({students.length})</h2>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto text-sm">
            {students.map((s) => <li key={s.id} className="flex justify-between py-1.5"><span>{s.roll_no ? `${s.roll_no}. ` : ''}{s.name}</span><span className="text-ink-soft">{s.phone}</span></li>)}
          </ul>
          {!students.length && <p className="text-sm text-ink-soft">No students yet.</p>}
        </div>
        <div className="card space-y-4">
          <h2 className="h2">Add students</h2>
          <ErrorNote error={err} />{msg && <p className="text-sm text-ink">{msg}</p>}
          <form onSubmit={addOne} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input className="input" aria-label="Student name" placeholder="Name" value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} required />
            <input className="input" aria-label="Mobile number" placeholder="Mobile" inputMode="tel" value={one.phone} onChange={(e) => setOne({ ...one, phone: e.target.value })} required />
            <button className="btn-ghost">Add</button>
          </form>
          <div><p className="mb-2 text-sm text-ink-soft">Or import a CSV with columns <code>name,phone,roll_no</code>. Each student's first password is their mobile number.</p>
            <CsvBox busy={busy} onSubmit={importCsv} placeholder={'name,phone,roll_no\nAman Gill,9876500001,1'} /></div>
        </div>
      </section>
    </div>
  );
}

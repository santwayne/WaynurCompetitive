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
  const [one, setOne] = useState({ name: '', phone: '', parent_phone: '' });
  const [editing, setEditing] = useState(null);

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
            {students.map((s) => (
              <li key={s.id} className="py-1.5">
                <div className="flex justify-between gap-2"><span>{s.roll_no ? `${s.roll_no}. ` : ''}{s.name}</span><span className="text-ink-soft">{s.phone}</span></div>
                {editing?.id === s.id ? (
                  <form className="mt-1 flex gap-2" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await api(`/centre/students/${s.id}`, { method: 'PATCH', body: { parent_phone: editing.parent_phone, parent_name: editing.parent_name } }); setEditing(null); reload(); } catch (x) { setErr(x.message); } }}>
                    <input className="input py-1" aria-label="Parent name" placeholder="Parent name" value={editing.parent_name} onChange={(e) => setEditing({ ...editing, parent_name: e.target.value })} />
                    <input className="input py-1" aria-label="Parent WhatsApp" placeholder="Parent mobile" inputMode="tel" value={editing.parent_phone} onChange={(e) => setEditing({ ...editing, parent_phone: e.target.value })} />
                    <button className="btn-primary px-3 py-1">Save</button>
                  </form>
                ) : (
                  <button className="text-xs text-ink-soft hover:text-terracotta" onClick={() => setEditing({ id: s.id, parent_name: s.parent_name || '', parent_phone: s.parent_phone || '' })}>
                    Parent: {s.parent_phone ? `${s.parent_name ? `${s.parent_name}, ` : ''}${s.parent_phone}` : 'add WhatsApp number'}
                  </button>
                )}
              </li>))}
          </ul>
          {!students.length && <p className="text-sm text-ink-soft">No students yet.</p>}
        </div>
        <div className="card space-y-4">
          <h2 className="h2">Add students</h2>
          <ErrorNote error={err} />{msg && <p className="text-sm text-ink">{msg}</p>}
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

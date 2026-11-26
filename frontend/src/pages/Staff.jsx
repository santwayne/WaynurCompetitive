import { useState } from 'react';
import { api, getSession } from '../api.js';
import { ErrorNote, Loading, useApi } from '../components/ui.jsx';

const ROLE = { owner: 'Owner', academic_head: 'Academic head', teacher: 'Teacher' };
const EMPTY = { name: '', email: '', phone: '', password: '', role: 'teacher' };
const waLink = (phone, text) => `https://wa.me/${phone ? `91${phone.replace(/\D/g, '').slice(-10)}` : ''}?text=${encodeURIComponent(text)}`;

// Only the owner adds staff and changes their WhatsApp numbers. Others see
// names and roles, not personal emails and numbers.
export default function Staff() {
  const owner = getSession().role === 'owner';
  const [data, error, reload] = useApi(() => api('/centre/staff'));
  const [f, setF] = useState(EMPTY);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(null); // login details to hand over
  async function add(e) {
    e.preventDefault(); setErr(null); setAdded(null); setBusy(true);
    try {
      const r = await api('/centre/staff', { method: 'POST', body: f });
      const text = `Hi ${r.user.name}, your Waynur Competitive login for ${r.centre_name}:\n${window.location.origin}/login\nEmail: ${r.user.email}\nPassword: ${f.password}\nYou will be asked to set your own password the first time you log in.`;
      setAdded({ name: r.user.name, phone: r.user.phone, text });
      setF(EMPTY);
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); reload(); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-6">
      <h1 className="h1">Team</h1>
      <ErrorNote error={err} />
      <p className="text-sm text-ink-soft">The WhatsApp number is how each teacher gets test summaries and sends commands (TESTS, REPORT 12, PLAN 12…).{!owner && ' Only the owner can add staff or change their numbers.'}</p>
      {added && (
        <div className="card space-y-2 border-green-300">
          <p className="text-sm font-semibold text-green-800">{added.name} added. Send them their login details:</p>
          <pre className="whitespace-pre-wrap rounded bg-secondary p-2 text-xs">{added.text}</pre>
          <div className="flex flex-wrap gap-2">
            <a className="btn-primary" href={waLink(added.phone, added.text)} target="_blank" rel="noreferrer">Send on WhatsApp</a>
            <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(added.text)}>Copy</button>
            <button className="btn-ghost" onClick={() => setAdded(null)}>Done</button>
          </div>
        </div>
      )}
      <div className="card overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-ink-soft"><th className="py-2">Name</th>{owner && <th>Email</th>}<th>WhatsApp</th><th>Role</th></tr></thead>
        <tbody>{data.staff.map((u) => (
          <tr key={u.id} className="border-t border-border">
            <td className="py-2">{u.name}{!u.active && <span className="text-ink-soft"> (inactive)</span>}{!owner && u.email && <div className="text-xs text-ink-soft">{u.email} (you)</div>}</td>
            {owner && <td>{u.email}</td>}
            <td>{edit?.id === u.id ? (
              <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await api(`/centre/staff/${u.id}`, { method: 'PATCH', body: { phone: edit.phone } }); setEdit(null); reload(); } catch (x) { setErr(x.message); } }}>
                <input className="input py-1" aria-label={`WhatsApp number for ${u.name}`} inputMode="tel" autoComplete="off" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                <button className="btn-primary px-3 py-1">Save</button>
              </form>
            ) : (
              <span>{u.phone || <span className="text-ink-soft">–</span>}{owner && <button className="ml-2 text-xs text-terracotta" onClick={() => setEdit({ id: u.id, phone: u.phone || '' })}>Edit</button>}</span>
            )}</td>
            <td>{ROLE[u.role]}</td>
          </tr>))}</tbody>
      </table></div>
      {owner && (
        <form onSubmit={add} autoComplete="off" className="card grid gap-3 sm:grid-cols-2">
          <h2 className="h2 sm:col-span-2">Add a teacher</h2>
          <input className="input" aria-label="Name" placeholder="Name" autoComplete="off" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <input className="input" aria-label="Email" type="email" placeholder="Their email (login)" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          <input className="input" aria-label="WhatsApp number" inputMode="tel" placeholder="Their WhatsApp number" autoComplete="off" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <input className="input" aria-label="First password" type="text" placeholder="First password (8+, they change it on first login)" autoComplete="off" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
          <select className="input" aria-label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="teacher">Teacher (questions wait for approval)</option>
            <option value="academic_head">Academic head (approves questions)</option>
          </select>
          <button className="btn-primary sm:col-span-2 sm:w-fit" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
        </form>
      )}
    </div>
  );
}

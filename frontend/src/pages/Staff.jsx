import { useState } from 'react';
import { api, getSession } from '../api.js';
import { ErrorNote, Loading, useApi } from '../components/ui.jsx';

const ROLE = { owner: 'Owner', academic_head: 'Academic head', teacher: 'Teacher' };

export default function Staff() {
  const lead = ['owner', 'academic_head'].includes(getSession().role);
  const [data, error, reload] = useApi(() => api('/centre/staff'));
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'teacher' });
  const [err, setErr] = useState(null);
  async function add(e) {
    e.preventDefault(); setErr(null);
    try { await api('/centre/staff', { method: 'POST', body: f }); setF({ name: '', email: '', password: '', role: 'teacher' }); reload(); }
    catch (x) { setErr(x.message); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-6">
      <h1 className="h1">Team</h1>
      <div className="card"><table className="w-full text-sm">
        <thead><tr className="text-left text-ink-soft"><th className="py-2">Name</th><th>Email</th><th>Role</th></tr></thead>
        <tbody>{data.staff.map((u) => <tr key={u.id} className="border-t border-border"><td className="py-2">{u.name}</td><td>{u.email}</td><td>{ROLE[u.role]}</td></tr>)}</tbody>
      </table></div>
      {lead && (
        <form onSubmit={add} className="card grid gap-3 sm:grid-cols-2">
          <h2 className="h2 sm:col-span-2">Add a teacher</h2>
          <ErrorNote error={err} />
          <input className="input" aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <input className="input" aria-label="Email" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          <input className="input" aria-label="Password" type="password" placeholder="Password (8+ characters)" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
          <select className="input" aria-label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="teacher">Teacher (questions wait for approval)</option>
            <option value="academic_head">Academic head (approves questions)</option>
          </select>
          <button className="btn-primary sm:col-span-2 sm:w-fit">Add</button>
        </form>
      )}
    </div>
  );
}

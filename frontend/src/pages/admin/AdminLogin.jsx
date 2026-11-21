import { useState } from 'react';
import { api, setSession } from '../../api.js';
import { ErrorNote } from '../../components/ui.jsx';

export default function AdminLogin() {
  const [f, setF] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const d = await api('/admin/login', { method: 'POST', body: f });
      setSession({ token: d.token, kind: 'super_admin', name: d.admin.name, centre: 'Super Admin' });
      window.location.assign('/admin');
    } catch (x) { setError(x.message); setBusy(false); }
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div>
          <div className="font-display text-xl font-semibold text-terracotta">Waynur <span className="text-ink">Competitive</span></div>
          <h1 className="mt-1 text-sm text-ink-soft">Super Admin login (Waynur team)</h1>
        </div>
        <ErrorNote error={error} />
        <div><label className="label" htmlFor="ae">Email</label><input id="ae" type="email" className="input" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></div>
        <div><label className="label" htmlFor="ap">Password</label><input id="ap" type="password" className="input" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </main>
  );
}

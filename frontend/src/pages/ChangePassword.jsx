import { useState } from 'react';
import { api, getSession, setSession, updateSession } from '../api.js';
import { ErrorNote } from '../components/ui.jsx';

// Shown on first login (and after a password reset): the person must choose
// their own password before they can use the app.
export default function ChangePassword() {
  const s = getSession();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setErr(null);
    if (f.newPassword !== f.confirm) { setErr('The two new passwords do not match'); return; }
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
      updateSession({ mustChange: false });
      window.location.assign('/');
    } catch (x) { setErr(x.message); setBusy(false); }
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={save} className="card w-full max-w-sm space-y-4">
        <div>
          <div className="font-display text-xl font-semibold text-terracotta">Waynur <span className="text-ink">Competitive</span></div>
          <h1 className="mt-1 text-sm text-ink-soft">{s?.mustChange ? `Welcome${s?.name ? `, ${s.name}` : ''}. Please set your own password to continue.` : 'Change your password'}</h1>
        </div>
        <ErrorNote error={err} />
        <div><label className="label" htmlFor="cur">Password you were given</label><input id="cur" type="password" className="input" autoComplete="current-password" value={f.currentPassword} onChange={set('currentPassword')} required /></div>
        <div><label className="label" htmlFor="np">New password (8+ characters)</label><input id="np" type="password" className="input" autoComplete="new-password" minLength={8} value={f.newPassword} onChange={set('newPassword')} required /></div>
        <div><label className="label" htmlFor="np2">New password again</label><input id="np2" type="password" className="input" autoComplete="new-password" minLength={8} value={f.confirm} onChange={set('confirm')} required /></div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        <button type="button" className="w-full text-xs text-ink-soft" onClick={() => { setSession(null); window.location.assign('/login'); }}>Log out</button>
      </form>
    </main>
  );
}

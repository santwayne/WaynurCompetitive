import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, setSession } from '../api.js';
import { ErrorNote } from '../components/ui.jsx';

export default function Signup() {
  const [f, setF] = useState({ centreName: '', city: '', name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const d = await api('/auth/signup', { method: 'POST', body: f });
      setSession({ token: d.token, kind: 'staff', role: d.user.role, name: d.user.name, centre: d.user.centre.name, centreId: d.user.centre.id, centreCode: d.user.centre.code });
      window.location.assign('/');
    } catch (err) { setError(err.message); setBusy(false); }
  }
  const field = (k, label, props = {}) => (
    <div><label className="label" htmlFor={k}>{label}</label><input id={k} className="input" value={f[k]} onChange={set(k)} {...props} /></div>
  );
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <form onSubmit={submit} className="card w-full max-w-md space-y-4">
        <h1 className="h1">Set up your centre</h1>
        <ErrorNote error={error} />
        {field('centreName', 'Centre name', { required: true })}
        {field('city', 'City')}
        {field('name', 'Your name', { required: true })}
        {field('email', 'Email', { type: 'email', required: true, autoComplete: 'email' })}
        {field('password', 'Password (8+ characters)', { type: 'password', required: true, minLength: 8, autoComplete: 'new-password' })}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create centre'}</button>
        <p className="text-sm text-ink-soft">Have an account? <Link to="/login" className="font-semibold text-terracotta">Log in</Link></p>
      </form>
    </main>
  );
}

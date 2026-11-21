import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, setSession } from '../api.js';
import { ErrorNote } from '../components/ui.jsx';

// Staff log in with email. Students open their centre's link (/s/<centreId>)
// and log in with their mobile number.
export default function Login({ student = false }) {
  const { centreId } = useParams();
  const [centre, setCentre] = useState(null);
  const [form, setForm] = useState({ email: '', phone: '', password: '', code: '' });
  const [otp, setOtp] = useState(null); // null = password login; 'ask' = get a code; 'sent' = enter the code
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (student) api(`/auth/centre/${centreId}`).then((d) => setCentre(d.centre)).catch((e) => setError(e.message));
  }, [student, centreId]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (student && otp === 'ask') {
        const d = await api('/auth/student-otp', { method: 'POST', body: { centreId: Number(centreId), phone: form.phone } });
        setNote(d.message); setOtp('sent'); setBusy(false);
        return;
      }
      if (student) {
        const d = otp === 'sent'
          ? await api('/auth/student-otp/verify', { method: 'POST', body: { centreId: Number(centreId), phone: form.phone, code: form.code } })
          : await api('/auth/student-login', { method: 'POST', body: { centreId: Number(centreId), phone: form.phone, password: form.password } });
        setSession({ token: d.token, kind: 'student', name: d.student.name, centre: d.student.centre.name, centreId: d.student.centre.id });
      } else {
        const d = await api('/auth/login', { method: 'POST', body: { email: form.email, password: form.password } });
        setSession({ token: d.token, kind: 'staff', role: d.user.role, name: d.user.name, centre: d.user.centre.name, centreId: d.user.centre.id });
      }
      window.location.assign('/');
    } catch (err) { setError(err.message); setBusy(false); }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div>
          <div className="font-display text-xl font-semibold text-terracotta">Waynur <span className="text-ink">Competitive</span></div>
          <h1 className="mt-1 text-sm text-ink-soft">{student ? (centre ? `Student login · ${centre.name}` : 'Student login') : 'Teacher and owner login'}</h1>
        </div>
        <ErrorNote error={error} />
        {student ? (
          <div><label className="label" htmlFor="phone">Mobile number</label><input id="phone" className="input" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} required /></div>
        ) : (
          <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" className="input" autoComplete="email" value={form.email} onChange={set('email')} required /></div>
        )}
        {note && <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{note}</p>}
        {otp === 'sent' && (
          <div><label className="label" htmlFor="code">6-digit code from WhatsApp</label><input id="code" className="input tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={form.code} onChange={set('code')} required /></div>
        )}
        {!otp && (
          <div><label className="label" htmlFor="pw">Password</label><input id="pw" type="password" className="input" autoComplete="current-password" value={form.password} onChange={set('password')} required /></div>
        )}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : otp === 'ask' ? 'Send code on WhatsApp' : 'Log in'}</button>
        {student && (
          <button type="button" className="w-full text-sm font-semibold text-terracotta" onClick={() => { setOtp(otp ? null : 'ask'); setNote(null); setError(null); }}>
            {otp ? 'Use password instead' : 'Get a login code on WhatsApp'}
          </button>
        )}
        {student && (
          <button type="button" className="w-full text-xs text-ink-soft" onClick={() => { try { localStorage.removeItem('wc_centre_code'); } catch { /* ignore */ } window.location.assign('/app'); }}>
            Not your centre? Change centre code
          </button>
        )}
        {student
          ? <p className="text-xs text-muted-foreground">Links your centre sends on WhatsApp open your test directly. First time with a password? It is your mobile number.</p>
          : <p className="text-sm text-ink-soft">New centre? <Link to="/signup" className="font-semibold text-terracotta">Create an account</Link></p>}
      </form>
    </main>
  );
}

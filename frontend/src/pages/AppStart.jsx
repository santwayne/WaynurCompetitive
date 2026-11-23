import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { getSession } from '../api.js';

// The Android app opens here. A student types their centre code once (the
// teacher sees it on the Batches page); after that the app remembers it.
const KEY = 'wc_centre_code';

export default function AppStart() {
  const nav = useNavigate();
  const saved = (() => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } })();
  const [code, setCode] = useState(saved);
  if (getSession()) return <Navigate to="/" replace />;
  if (saved) return <Navigate to={`/s/${saved}`} replace />;
  function go(e) {
    e.preventDefault();
    const c = code.trim();
    if (!/^\d+$/.test(c)) return;
    try { localStorage.setItem(KEY, c); } catch { /* private mode */ }
    nav(`/s/${c}`);
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={go} className="card w-full max-w-sm space-y-4">
        <div>
          <div className="font-display text-xl font-semibold text-terracotta">Waynur <span className="text-ink">Competitive</span></div>
          <h1 className="mt-1 text-sm text-ink-soft">Enter your coaching centre's code</h1>
        </div>
        <div><label className="label" htmlFor="cc">Centre code</label><input id="cc" className="input text-lg tracking-widest" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 12" required /></div>
        <button className="btn-primary w-full">Continue</button>
        <p className="text-xs text-muted-foreground">Your teacher gives you this code. Links sent on WhatsApp open your test directly.</p>
        <p className="text-sm text-ink-soft">Teacher or owner? <Link to="/login" className="font-semibold text-terracotta">Log in here</Link></p>
      </form>
    </main>
  );
}

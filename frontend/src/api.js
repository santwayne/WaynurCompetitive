// Same-origin API (nginx in production, Vite proxy in development).
const KEY = 'wc_session';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function setSession(s) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export async function api(path, { method = 'GET', body } = {}) {
  const s = getSession();
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(s?.token ? { Authorization: `Bearer ${s.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && s) { setSession(null); window.location.assign(s.kind === 'super_admin' ? '/admin/login' : '/login'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const KIND_LABEL = { exit_ticket: 'Exit ticket', scheduled: 'Scheduled test', retest: 'Re-test' };

export const PLAN_LABEL = { trial: 'Trial', basic: 'Basic (no AI)', ai: 'AI' };
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

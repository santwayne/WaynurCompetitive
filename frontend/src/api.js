// Same-origin API (nginx in production, Vite proxy in development).
//
// The Super Admin session and the centre session (staff / student) are kept
// under separate keys, so logging in to /admin in one tab no longer logs the
// centre out in another tab (and the other way round).
const KEY = 'wc_session';
const ADMIN_KEY = 'wc_admin_session';

const onAdminPage = () => window.location.pathname.startsWith('/admin');
const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const write = (key, s) => { try { s ? localStorage.setItem(key, JSON.stringify(s)) : localStorage.removeItem(key); } catch { /* private mode */ } };

// The session for the part of the app that is open (/admin or the rest).
export function getSession() {
  return read(onAdminPage() ? ADMIN_KEY : KEY);
}
export function setSession(s) {
  if (s) write(s.kind === 'super_admin' ? ADMIN_KEY : KEY, s);
  else write(onAdminPage() ? ADMIN_KEY : KEY, null);
}
export function updateSession(patch) {
  const s = getSession();
  if (s) setSession({ ...s, ...patch });
}

export async function api(path, { method = 'GET', body } = {}) {
  const adminCall = path.startsWith('/admin/');
  const key = adminCall ? ADMIN_KEY : KEY;
  const s = read(key);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(s?.token ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // The request may or may not have reached the server.
    throw new Error(method === 'GET'
      ? 'Could not reach the server. Check the internet connection and try again.'
      : 'Could not reach the server. Check the internet, then refresh to see whether it was saved before trying again.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && s && !path.endsWith('/login')) {
    write(key, null);
    window.location.assign(adminCall ? '/admin/login' : '/login');
  }
  if (res.status === 403 && data.code === 'must_change_password' && !adminCall) {
    if (s) write(key, { ...s, mustChange: true });
    if (window.location.pathname !== '/change-password') window.location.assign('/change-password');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const KIND_LABEL = { exit_ticket: 'Exit ticket', scheduled: 'Scheduled test', retest: 'Re-test' };

export const PLAN_LABEL = { trial: 'Trial', basic: 'Basic (no AI)', ai: 'AI' };
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export const studentLoginLink = (code) => (code ? `${window.location.origin}/s/${code}` : null);

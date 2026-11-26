import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, PLAN_LABEL } from '../../api.js';
import { ErrorNote, Loading, Stat, useApi } from '../../components/ui.jsx';

const ROLE = { owner: 'Owner', academic_head: 'Academic head', teacher: 'Teacher' };
const KIND = { test_open: 'Test link', practice: 'Practice link', result_parent: 'Result to parent', teacher_report: 'Teacher report', otp: 'Login code', reply: 'Reply', inbound: 'Received', admin_test: 'Test message' };

function PlanForm({ centre, onSaved }) {
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setF({
      name: centre.name, city: centre.city || '', plan: centre.plan, status: centre.status,
      validUntil: centre.valid_until || '', studentLimit: centre.student_limit ?? '', aiDailyLimit: centre.ai_daily_limit ?? '',
      contactPhone: centre.contact_phone || '', notes: centre.admin_notes || '',
    });
  }, [centre]);
  if (!f) return null;
  const set = (k) => (e) => { setOk(false); setF({ ...f, [k]: e.target.value }); };
  async function save(e) {
    e.preventDefault(); setErr(null);
    try { await api(`/admin/centres/${centre.id}`, { method: 'PATCH', body: f }); setOk(true); onSaved(); }
    catch (x) { setErr(x.message); }
  }
  return (
    <form onSubmit={save} className="card grid gap-3 sm:grid-cols-2">
      <h2 className="h2 sm:col-span-2">Plan and access</h2>
      <div className="sm:col-span-2"><ErrorNote error={err} />{ok && <p className="text-sm text-green-700">Saved.</p>}
        {(!centre.valid_until || centre.student_limit == null) && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">This centre has no {!centre.valid_until ? 'end date' : ''}{!centre.valid_until && centre.student_limit == null ? ' and no ' : ''}{centre.student_limit == null ? 'student limit' : ''}. Set {!centre.valid_until && centre.student_limit == null ? 'them' : 'it'} and save.</p>}</div>
      <div><label className="label" htmlFor="pn">Centre name</label><input id="pn" className="input" value={f.name} onChange={set('name')} required /></div>
      <div><label className="label" htmlFor="pc">City</label><input id="pc" className="input" value={f.city} onChange={set('city')} /></div>
      <div><label className="label" htmlFor="pp">Plan</label>
        <select id="pp" className="input" value={f.plan} onChange={set('plan')}>{Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div><label className="label" htmlFor="ps">Status</label>
        <select id="ps" className="input" value={f.status} onChange={set('status')}><option value="active">Active</option><option value="suspended">Suspended (no one can log in)</option></select></div>
      <div><label className="label" htmlFor="pv">Valid until</label><input id="pv" type="date" className="input" value={f.validUntil} onChange={set('validUntil')} required /><p className="mt-1 text-xs text-ink-soft">Required. A trial can run at most 30 days.</p></div>
      <div><label className="label" htmlFor="pl">Student limit</label><input id="pl" className="input" inputMode="numeric" value={f.studentLimit} onChange={set('studentLimit')} placeholder="e.g. 100" required /></div>
      <div><label className="label" htmlFor="pa">AI calls per day</label><input id="pa" className="input" inputMode="numeric" value={f.aiDailyLimit} onChange={set('aiDailyLimit')} placeholder="blank = server default" /></div>
      <div><label className="label" htmlFor="pph">Contact number</label><input id="pph" className="input" inputMode="tel" value={f.contactPhone} onChange={set('contactPhone')} /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="pno">Notes (only the Waynur team sees these)</label><textarea id="pno" className="input h-20" value={f.notes} onChange={set('notes')} /></div>
      <button className="btn-primary sm:w-fit">Save</button>
    </form>
  );
}

function WhatsAppForm({ centreId, info, onSaved }) {
  const [f, setF] = useState({ number: info.display_number || '', phoneNumberId: info.phone_number_id || '', wabaId: info.waba_id || '', accessToken: '' });
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function run(fn) {
    setErr(null); setMsg(null); setBusy(true);
    try { await fn(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="h2">WhatsApp</h2>
        {info.connected
          ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Connected · {info.display_number}{info.verified_name ? ` · ${info.verified_name}` : ''}</span>
          : <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold">Not connected</span>}
      </div>
      <p className="text-sm text-ink-soft">The centre's own WhatsApp Business number. Keys are checked with Meta before saving; the token is stored encrypted and never shown again{info.token_hint ? ` (saved: ${info.token_hint})` : ''}.</p>
      <ErrorNote error={err} />{msg && <p className="text-sm text-green-700">{msg}</p>}
      {/* Not a login form: no password-type field, autofill off, so Chrome neither fills the
          admin email/password here nor offers to save the token as a password. */}
      <form className="grid gap-3 sm:grid-cols-2" autoComplete="off" data-lpignore="true" onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/admin/centres/${centreId}/whatsapp`, { method: 'PUT', body: f }); setF({ ...f, accessToken: '' }); setMsg('Connected. Meta accepted the keys.'); onSaved(); }); }}>
        <div><label className="label" htmlFor="wn">WhatsApp Business number</label><input id="wn" name="wa-display-number" className="input" inputMode="tel" autoComplete="off" data-lpignore="true" value={f.number} onChange={set('number')} placeholder="+91 98140 00000" required /></div>
        <div><label className="label" htmlFor="wp">Phone Number ID</label><input id="wp" name="wa-phone-number-id" className="input" inputMode="numeric" autoComplete="off" data-lpignore="true" value={f.phoneNumberId} onChange={set('phoneNumberId')} required /></div>
        <div><label className="label" htmlFor="ww">WhatsApp Business Account ID</label><input id="ww" name="wa-business-account-id" className="input" inputMode="numeric" autoComplete="off" data-lpignore="true" value={f.wabaId} onChange={set('wabaId')} /></div>
        <div><label className="label" htmlFor="wt">Permanent access token</label><input id="wt" name="wa-access-token" type="text" className="input font-mono" style={{ WebkitTextSecurity: 'disc' }} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true" value={f.accessToken} onChange={set('accessToken')} placeholder={info.connected ? 'leave blank to keep the saved one' : ''} required={!info.connected} /></div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button className="btn-primary" disabled={busy}>{busy ? 'Checking with Meta…' : info.connected ? 'Update' : 'Connect'}</button>
          {info.connected && <button type="button" className="btn-ghost" disabled={busy} onClick={() => window.confirm('Disconnect WhatsApp? Nothing will be sent until it is connected again.') && run(async () => { await api(`/admin/centres/${centreId}/whatsapp`, { method: 'DELETE' }); onSaved(); })}>Disconnect</button>}
        </div>
      </form>
      {info.connected && (
        <form className="flex flex-wrap items-end gap-2 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api(`/admin/centres/${centreId}/whatsapp/test`, { method: 'POST', body: { phone: testPhone } }); if (r.status !== 'sent') throw new Error(r.error || `Not sent (${r.status})`); setMsg('Test message sent.'); }); }}>
          <div><label className="label" htmlFor="tp">Send a test message to</label><input id="tp" className="input" inputMode="tel" autoComplete="off" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} required /></div>
          <button className="btn-ghost" disabled={busy}>Send test</button>
          <p className="w-full text-xs text-ink-soft">First send "hi" to the centre's number from that phone: Meta only allows plain messages within 24 hours of the person writing.</p>
        </form>
      )}
    </section>
  );
}

function Staff({ centreId, staff }) {
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  async function reset(u) {
    const pw = window.prompt(`New password for ${u.name} (8+ characters):`);
    if (!pw) return;
    setErr(null); setMsg(null);
    try { await api(`/admin/centres/${centreId}/staff/${u.id}/password`, { method: 'POST', body: { password: pw } }); setMsg(`Password changed for ${u.name}. Share it with them privately; they must set their own when they next log in.`); }
    catch (x) { setErr(x.message); }
  }
  return (
    <section className="card space-y-2">
      <h2 className="h2">Staff</h2>
      <ErrorNote error={err} />{msg && <p className="text-sm text-green-700">{msg}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-ink-soft"><th className="py-2">Name</th><th>Email</th><th>WhatsApp</th><th>Role</th><th /></tr></thead>
        <tbody>{staff.map((u) => (
          <tr key={u.id} className="border-t border-border">
            <td className="py-2">{u.name}{!u.active && <span className="text-ink-soft"> (inactive)</span>}</td><td>{u.email}</td><td>{u.phone || '–'}</td><td>{ROLE[u.role]}</td>
            <td className="text-right"><button className="text-sm font-semibold text-terracotta" onClick={() => reset(u)}>Reset password</button></td>
          </tr>))}
        </tbody>
      </table>
    </section>
  );
}

function Messages({ centreId }) {
  const [data, error] = useApi(() => api(`/admin/centres/${centreId}/messages`), [centreId]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">WhatsApp log (last 100)</summary>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-ink-soft"><th className="py-2">When</th><th>To / from</th><th>Type</th><th>Status</th><th>Message</th></tr></thead>
        <tbody>{data.messages.map((m) => (
          <tr key={m.id} className="border-t border-border align-top">
            <td className="whitespace-nowrap py-2">{new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td>{m.direction === 'in' ? '← ' : '→ '}{m.phone}</td><td>{KIND[m.kind] || m.kind}</td>
            <td className={m.status === 'failed' ? 'text-destructive' : ''}>{m.status}{m.error ? `: ${m.error}` : ''}</td>
            <td className="max-w-md whitespace-pre-line text-ink-soft">{m.body}</td>
          </tr>))}
        </tbody>
      </table></div>
      {!data.messages.length && <p className="mt-2 text-sm text-ink-soft">Nothing yet.</p>}
    </details>
  );
}

export default function AdminCentre() {
  const { id } = useParams();
  const [data, error, reload] = useApi(() => api(`/admin/centres/${id}`), [id]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const { centre: c, staff, batches, ai_by_day: ai, whatsapp_30d: wa, whatsapp } = data;
  const waSent = wa.filter((x) => ['sent', 'delivered', 'read'].includes(x.status)).reduce((a, x) => a + x.n, 0);
  const waFailed = wa.filter((x) => x.status === 'failed').reduce((a, x) => a + x.n, 0);
  const studentLink = `${window.location.origin}/s/${c.code}`;
  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin" className="text-sm text-ink-soft">← Centres</Link>
        <h1 className="h1">{c.name}</h1>
        <p className="text-sm text-ink-soft">{c.city || '–'} · since {fmtDate(c.created_at)} · centre code <code className="rounded bg-secondary px-1 font-semibold tracking-widest">{c.code}</code> · student login <code className="rounded bg-secondary px-1">{studentLink}</code></p>
      </div>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Students" value={c.student_limit != null ? `${c.students} / ${c.student_limit}` : c.students} hint={`${c.staff} staff · ${c.batches} batches`} />
        <Stat label="Tests in 30 days" value={c.tests_30d} hint={c.last_test_at ? `last ${fmtDate(c.last_test_at)}` : 'no tests yet'} />
        <Stat label="AI calls in 30 days" value={c.ai_30d} hint={ai.length ? `busiest day ${Math.max(...ai.map((x) => x.n))}` : 'none'} />
        <Stat label="WhatsApp in 30 days" value={waSent} hint={`${waFailed} failed`} />
      </section>
      <PlanForm centre={c} onSaved={reload} />
      <WhatsAppForm key={whatsapp.phone_number_id || 'none'} centreId={c.id} info={whatsapp} onSaved={reload} />
      <Staff centreId={c.id} staff={staff} />
      <section className="card">
        <h2 className="h2 mb-2">Batches</h2>
        <ul className="divide-y divide-border text-sm">{batches.map((b) => <li key={b.name} className="flex justify-between py-1.5"><span>{b.name} <span className="text-ink-soft">· {b.exam_pattern || 'no pattern'}</span></span><span>{b.students} students</span></li>)}</ul>
        {!batches.length && <p className="text-sm text-ink-soft">No batches yet.</p>}
      </section>
      <Messages centreId={c.id} />
    </div>
  );
}

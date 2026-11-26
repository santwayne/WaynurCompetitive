import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, PLAN_LABEL } from '../../api.js';
import { ErrorNote, Loading, Stat, useApi } from '../../components/ui.jsx';

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const empty = () => ({ name: '', city: '', ownerName: '', ownerEmail: '', ownerPhone: '', ownerPassword: '', plan: 'trial', studentLimit: '100', validUntil: inDays(14) });

function status(c) {
  if (c.status === 'suspended') return <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">Suspended</span>;
  if (c.expired) return <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">Plan ended</span>;
  if (!c.valid_until || c.student_limit == null) return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">Active · set end date / limit</span>;
  return <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-800">Active</span>;
}

export default function AdminHome() {
  const [q, setQ] = useState('');
  const [data, error, reload] = useApi(() => Promise.all([api('/admin/overview'), api(`/admin/centres?q=${encodeURIComponent(q)}`)]), [q]);
  const [f, setF] = useState(empty);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function create(e) {
    e.preventDefault(); setErr(null);
    try { await api('/admin/centres', { method: 'POST', body: f }); setF(empty()); setOpen(false); reload(); }
    catch (x) { setErr(x.message); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const [o, { centres }] = data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="h1">Centres</h1><p className="text-sm text-ink-soft">Every coaching centre on Waynur Competitive.</p></div>
        <button className="btn-primary" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Add a centre'}</button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active centres" value={`${o.active} / ${o.centres}`} hint={`${o.on_trial} on trial · ${o.suspended} suspended · ${o.expired} ended`} />
        <Stat label="Plans ending in 7 days" value={o.expiring_7d} hint={o.missing_limits ? `${o.missing_limits} centres have no end date or limit` : 'renew or follow up'} />
        <Stat label="Students" value={o.students} hint={`${o.tests_30d} tests, ${o.attempts_30d} submissions in 30 days`} />
        <Stat label="WhatsApp (30 days)" value={o.wa_sent_30d} hint={`${o.wa_failed_30d} failed · ${o.whatsapp_connected} centres connected · AI calls today ${o.ai_today}`} />
      </section>

      {open && (
        <form onSubmit={create} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <h2 className="h2 sm:col-span-2 lg:col-span-3">New centre and owner login</h2>
          <div className="sm:col-span-2 lg:col-span-3"><ErrorNote error={err} /></div>
          <div><label className="label" htmlFor="cn">Centre name</label><input id="cn" className="input" value={f.name} onChange={set('name')} required /></div>
          <div><label className="label" htmlFor="cc">City</label><input id="cc" className="input" value={f.city} onChange={set('city')} /></div>
          <div><label className="label" htmlFor="on">Owner name</label><input id="on" className="input" value={f.ownerName} onChange={set('ownerName')} required /></div>
          <div><label className="label" htmlFor="oe">Owner email (login)</label><input id="oe" type="email" className="input" value={f.ownerEmail} onChange={set('ownerEmail')} required /></div>
          <div><label className="label" htmlFor="op">Owner WhatsApp number</label><input id="op" className="input" inputMode="tel" value={f.ownerPhone} onChange={set('ownerPhone')} placeholder="98765 43210" /></div>
          <div><label className="label" htmlFor="opw">First password (8+)</label><input id="opw" className="input" autoComplete="off" minLength={8} value={f.ownerPassword} onChange={set('ownerPassword')} required /><p className="mt-1 text-xs text-ink-soft">They must change it on first login.</p></div>
          <div><label className="label" htmlFor="pl">Plan</label>
            <select id="pl" className="input" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value, validUntil: e.target.value === 'trial' ? inDays(14) : f.validUntil })}>{Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="label" htmlFor="sl">Student limit</label><input id="sl" className="input" inputMode="numeric" value={f.studentLimit} onChange={set('studentLimit')} placeholder="e.g. 100" required /></div>
          <div><label className="label" htmlFor="vu">Plan valid until</label><input id="vu" type="date" className="input" value={f.validUntil} onChange={set('validUntil')} required /><p className="mt-1 text-xs text-ink-soft">Trial: at most 30 days.</p></div>
          <button className="btn-primary sm:w-fit">Create centre</button>
        </form>
      )}

      <section className="card space-y-3">
        <input className="input max-w-sm" aria-label="Search centres" placeholder="Search name, city, code or owner email" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-ink-soft"><th className="py-2">Centre</th><th>Owner</th><th>Plan</th><th>Valid until</th><th>Students</th><th>Tests 30d</th><th>WhatsApp</th><th>Status</th></tr></thead>
          <tbody>{centres.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="py-2"><Link to={`/admin/centres/${c.id}`} className="font-semibold text-terracotta">{c.name}</Link><div className="text-xs text-ink-soft">{c.city || '–'} · code <span className="font-semibold tracking-wider">{c.code}</span></div></td>
              <td>{c.owner_name || '–'}<div className="text-xs text-ink-soft">{c.owner_email}</div></td>
              <td>{PLAN_LABEL[c.plan]}</td>
              <td>{fmtDate(c.valid_until)}</td>
              <td>{c.students}{c.student_limit != null && <span className="text-ink-soft"> / {c.student_limit}</span>}</td>
              <td>{c.tests_30d}</td>
              <td>{c.whatsapp_number || <span className="text-ink-soft">Not connected</span>}</td>
              <td>{status(c)}</td>
            </tr>))}
          </tbody>
        </table></div>
        {!centres.length && <p className="text-sm text-ink-soft">No centres found.</p>}
      </section>
    </div>
  );
}

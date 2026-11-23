import { api } from '../api.js';
import { ErrorNote, Loading, useApi } from '../components/ui.jsx';

const KIND = { test_open: 'Test link', practice: 'Practice link', result_parent: 'Result to parent', teacher_report: 'Teacher report', otp: 'Login code', reply: 'Reply', inbound: 'Received', admin_test: 'Test message' };

// The centre's WhatsApp: what it does, the teacher commands, and the log.
export default function WhatsApp() {
  const [data, error] = useApi(() => api('/centre/whatsapp'));
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">WhatsApp</h1>
        {data.connected
          ? <p className="text-sm text-ink-soft">Connected: <strong>{data.number}</strong>{data.name ? ` (${data.name})` : ''}. Students, parents and teachers can message this number.</p>
          : <p className="rounded-lg bg-secondary px-3 py-2 text-sm">WhatsApp is not connected yet. The Waynur team connects your centre's WhatsApp Business number. Until then nothing is sent, and each message shows as "skipped" below.</p>}
      </div>
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card space-y-2 text-sm">
          <h2 className="h2">Sent automatically</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Publish an online test → each student gets a link that opens it directly.</li>
            <li>A student submits, or you save paper marks → the parent gets the score and topics to work on.</li>
            <li>Make the next-class plan → weak students get their practice link, and you get the summary.</li>
          </ul>
          <p className="text-ink-soft">No one gets the same message twice.</p>
        </div>
        <div className="card space-y-2 text-sm">
          <h2 className="h2">Teacher commands</h2>
          <p className="text-ink-soft">Send from the WhatsApp number saved for you under Team:</p>
          <ul className="space-y-1 font-mono text-xs">
            <li>TESTS</li><li>REPORT 12</li><li>PLAN 12</li><li>PUBLISH 12</li><li>RETEST 12</li>
          </ul>
        </div>
        <div className="card space-y-2 text-sm">
          <h2 className="h2">Students and parents</h2>
          <p>A student who sends any message gets links to their open tests and practice.</p>
          <p>A parent who sends REPORT gets their child's latest results. Add parent numbers in each batch.</p>
        </div>
      </section>
      <section className="card">
        <h2 className="h2 mb-3">Latest messages</h2>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-ink-soft"><th className="py-2">When</th><th>Number</th><th>Type</th><th>Status</th><th>Message</th></tr></thead>
          <tbody>{data.messages.map((m, i) => (
            <tr key={i} className="border-t border-border align-top">
              <td className="whitespace-nowrap py-2">{new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td>{m.direction === 'in' ? '← ' : '→ '}{m.phone}</td><td>{KIND[m.kind] || m.kind}</td>
              <td className={m.status === 'failed' ? 'text-destructive' : ''}>{m.status}{m.error ? `: ${m.error}` : ''}</td>
              <td className="max-w-md whitespace-pre-line text-ink-soft">{m.body}</td>
            </tr>))}
          </tbody>
        </table></div>
        {!data.messages.length && <p className="text-sm text-ink-soft">Nothing yet.</p>}
      </section>
    </div>
  );
}

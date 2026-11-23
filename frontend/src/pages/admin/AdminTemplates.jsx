import { api } from '../../api.js';
import { ErrorNote, Loading, useApi } from '../../components/ui.jsx';

// What Sant (or whoever sets up a centre's WhatsApp) must create in Meta.
export default function AdminTemplates() {
  const [data, error] = useApi(() => api('/admin/whatsapp/templates'));
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const hook = `${window.location.origin}/api/whatsapp/webhook`;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">WhatsApp set-up</h1>
        <p className="text-sm text-ink-soft">For every new centre: create these templates on the centre's WhatsApp Business Account (WhatsApp Manager → Message templates), wait for approval, then connect the number on the centre's page.</p>
      </div>
      <section className="card space-y-1 text-sm">
        <h2 className="h2 mb-1">Webhook (once, in the Meta app)</h2>
        <p>Callback URL: <code className="rounded bg-secondary px-1">{hook}</code></p>
        <p>Verify token: the value of <code>WHATSAPP_VERIFY_TOKEN</code> on the server. Subscribe to the <code>messages</code> field.</p>
        <p>Template language: <code>{data.language}</code></p>
      </section>
      {data.templates.map((t) => (
        <section key={t.key} className="card space-y-2 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="h2 font-mono">{t.name}</h2>
            <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold">{t.category}</span>
          </div>
          <p className="text-ink-soft">Sent to: {t.sentTo}</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-secondary p-3 font-mono text-xs">{t.body}</pre>
          <p className="text-ink-soft">Sample values for Meta: {t.example.map((x, i) => <span key={i}><code>{`{{${i + 1}}}`}</code> = {x}{i < t.example.length - 1 ? ' · ' : ''}</span>)}</p>
        </section>
      ))}
    </div>
  );
}

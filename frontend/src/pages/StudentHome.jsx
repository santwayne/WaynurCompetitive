import { Link } from 'react-router-dom';
import { api, KIND_LABEL } from '../api.js';
import { ErrorNote, Loading, useApi } from '../components/ui.jsx';

export default function StudentHome() {
  const [data, error] = useApi(() => Promise.all([api('/student/tests'), api('/student/practice')]));
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const [{ tests }, { practice }] = data;
  const open = tests.filter((t) => !t.submitted_at);
  const done = tests.filter((t) => t.submitted_at);
  const todo = practice.filter((p) => !p.completed_at);
  return (
    <div className="space-y-6">
      <h1 className="h1">My tests</h1>
      {todo.length > 0 && (
        <section className="card border-terracotta">
          <h2 className="h2 mb-2">Practice for you</h2>
          <ul className="space-y-2">{todo.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-sm">
              <span><strong>{p.topic}</strong> · {p.answered}/{p.questions} done</span>
              <Link className="btn-primary px-3 py-1.5" to={`/practice/${p.id}`}>{p.answered ? 'Continue' : 'Start'}</Link>
            </li>))}
          </ul>
        </section>
      )}
      <section className="card">
        <h2 className="h2 mb-2">Open now</h2>
        {open.length ? <ul className="divide-y divide-border">{open.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span><strong>{t.title}</strong><br /><span className="text-ink-soft">{KIND_LABEL[t.kind]} · {t.questions} questions · {t.duration_min} min · +{Number(t.marks_correct)} / −{Number(t.marks_wrong)}</span></span>
            <Link className="btn-primary px-3 py-1.5" to={`/test/${t.id}`}>{t.started_at ? 'Continue' : 'Start'}</Link>
          </li>))}</ul> : <p className="text-sm text-ink-soft">No open tests right now.</p>}
      </section>
      {done.length > 0 && (
        <section className="card">
          <h2 className="h2 mb-2">Finished</h2>
          <ul className="divide-y divide-border">{done.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2 text-sm">
              <span>{t.title} · <strong>{Number(t.score)}</strong> marks</span>
              <Link className="text-terracotta" to={`/result/${t.id}`}>See answers</Link>
            </li>))}</ul>
        </section>
      )}
      {practice.some((p) => p.completed_at) && <p className="text-sm text-ink-soft">Finished practice sets: {practice.filter((p) => p.completed_at).map((p) => p.topic).join(', ')}</p>}
    </div>
  );
}

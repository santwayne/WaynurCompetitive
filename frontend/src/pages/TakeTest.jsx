import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorNote, Loading } from '../components/ui.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function TakeTest() {
  const { id } = useParams();
  const nav = useNavigate();
  const [t, setT] = useState(null);
  const [answers, setAnswers] = useState({});
  const [i, setI] = useState(0);
  const [left, setLeft] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const times = useRef({});
  const shownAt = useRef(Date.now());
  const sent = useRef(false);

  useEffect(() => { api(`/student/tests/${id}/start`, { method: 'POST' }).then(setT).catch((e) => setErr(e.message)); }, [id]);

  const track = useCallback(() => {
    const q = t?.questions[i];
    if (q) times.current[q.id] = (times.current[q.id] || 0) + (Date.now() - shownAt.current);
    shownAt.current = Date.now();
  }, [t, i]);

  const submit = useCallback(async () => {
    if (sent.current) return;
    sent.current = true; setBusy(true); track();
    try { await api(`/student/tests/${id}/submit`, { method: 'POST', body: { answers, times: times.current } }); nav(`/result/${id}`); }
    catch (e) { sent.current = false; setErr(e.message); setBusy(false); }
  }, [answers, id, nav, track]);

  useEffect(() => {
    if (!t) return undefined;
    const end = new Date(t.ends_at).getTime();
    const tick = () => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) submit(); // time is up: submit what is answered
    };
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [t, submit]);

  if (err && !t) return <ErrorNote error={err} />;
  if (!t) return <Loading />;
  const q = t.questions[i];
  const go = (n) => { track(); setI(n); };
  const answered = Object.values(answers).filter((v) => v !== null && v !== undefined).length;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="h2">{t.test.title}</h1>
        <span className={`rounded-lg px-3 py-1 font-mono text-sm font-semibold ${left < 60 ? 'bg-destructive/10 text-destructive' : 'bg-secondary'}`} aria-live="polite">
          {left == null ? '' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
        </span>
      </div>
      <p className="text-xs text-ink-soft">+{Number(t.test.marks_correct)} for a right answer, −{Number(t.test.marks_wrong)} for a wrong one, 0 if you skip. Answered {answered} of {t.questions.length}.</p>
      <ErrorNote error={err} />
      <div className="card space-y-4">
        <div className="text-sm text-ink-soft">Question {i + 1} of {t.questions.length}</div>
        <p className="text-base font-medium">{q.stem}</p>
        <div className="space-y-2" role="radiogroup" aria-label={`Question ${i + 1} options`}>
          {q.options.map((o, k) => (
            <button key={k} type="button" role="radio" aria-checked={answers[q.id] === k}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm ${answers[q.id] === k ? 'border-terracotta bg-secondary font-semibold' : 'border-border bg-card hover:bg-secondary'}`}
              onClick={() => setAnswers({ ...answers, [q.id]: answers[q.id] === k ? null : k })}>
              <span className="w-5">{LETTERS[k]}</span>{o}
            </button>))}
        </div>
        <p className="text-xs text-ink-soft">Tap your answer again to clear it (skip).</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" disabled={i === 0} onClick={() => go(i - 1)}>Previous</button>
        {i < t.questions.length - 1 ? <button className="btn-primary" onClick={() => go(i + 1)}>Next</button>
          : <button className="btn-primary" disabled={busy} onClick={() => { if (window.confirm(`Submit now? You answered ${answered} of ${t.questions.length}.`)) submit(); }}>{busy ? 'Submitting…' : 'Submit test'}</button>}
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Jump to question">
        {t.questions.map((x, n) => (
          <button key={x.id} onClick={() => go(n)} aria-label={`Question ${n + 1}`}
            className={`h-8 w-8 rounded text-xs font-semibold ${n === i ? 'ring-2 ring-ring' : ''} ${answers[x.id] != null ? 'bg-terracotta text-white' : 'bg-secondary'}`}>{n + 1}</button>))}
      </div>
    </div>
  );
}

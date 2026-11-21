import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorNote, Loading, useApi } from '../components/ui.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function Result() {
  const { id } = useParams();
  const [data, error] = useApi(() => api(`/student/tests/${id}/result`), [id]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const right = data.questions.filter((q) => q.is_correct).length;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to="/" className="text-sm text-ink-soft">← My tests</Link>
      <h1 className="h1">{data.test.title}</h1>
      <div className="card"><span className="font-display text-3xl font-semibold">{Number(data.score)}</span> marks · {right} of {data.questions.length} right</div>
      <p className="text-sm text-ink-soft">Your teacher will use these results to plan the next class. If a topic needs more work, a practice set will appear on your home page.</p>
      {data.questions.map((q, i) => (
        <div key={q.id} className="card space-y-2 text-sm">
          <div className="text-xs text-ink-soft">Q{i + 1} · {q.topic} · {q.chosen_index == null ? 'Skipped' : q.is_correct ? 'Right' : 'Wrong'}</div>
          <p className="font-medium">{q.stem}</p>
          <ul>{q.options.map((o, k) => (
            <li key={k} className={k === q.correct_index ? 'font-semibold text-green-700' : k === q.chosen_index ? 'text-destructive line-through' : ''}>{LETTERS[k]}) {o}</li>))}
          </ul>
          {q.explanation && <p className="rounded-lg bg-secondary px-3 py-2">{q.explanation}</p>}
        </div>))}
    </div>
  );
}

import { useState } from 'react';
import { api, getSession } from '../api.js';
import { CsvBox, ErrorNote, Loading, useApi } from '../components/ui.jsx';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const DIFF = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
// No answer is picked at the start: the teacher must choose the correct one.
const empty = { id: null, subject: '', topic: '', stem: '', options: ['', '', '', ''], correctIndex: null, explanation: '', difficulty: '2' };

export default function Questions() {
  const lead = ['owner', 'academic_head'].includes(getSession().role);
  const [topicId, setTopicId] = useState('');
  const [status, setStatus] = useState('');
  const [data, error, reload] = useApi(() => Promise.all([
    api('/syllabus/topics'),
    api(`/syllabus/questions?${new URLSearchParams({ ...(topicId && { topicId }), ...(status && { status }) })}`),
  ]), [topicId, status]);
  const [q, setQ] = useState(empty);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(null);
  const [merge, setMerge] = useState(null); // { fromId, intoId }

  async function saveQuestion(e) {
    e.preventDefault(); setErr(null); setMsg(null);
    if (q.correctIndex == null || !String(q.options[q.correctIndex] || '').trim()) { setErr('Pick which option is the correct answer (the round button next to it).'); return; }
    // Empty options are dropped, so send the answer as its place among the filled ones.
    const filled = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
    const body = { stem: q.stem, options: filled.map((x) => x.o), correctIndex: filled.findIndex((x) => x.i === q.correctIndex), explanation: q.explanation, difficulty: Number(q.difficulty) };
    try {
      const t = await api('/syllabus/topics', { method: 'POST', body: { subject: q.subject, name: q.topic } });
      let status;
      if (q.id) {
        status = (await api(`/syllabus/questions/${q.id}`, { method: 'PUT', body: { ...body, topicId: t.topic_id } })).status;
        setMsg(status === 'approved' ? 'Question updated.' : 'Question updated. It waits for approval again before it goes into tests.');
      } else {
        status = (await api('/syllabus/questions', { method: 'POST', body: { ...body, topicId: t.topic_id } })).question.status;
        setMsg(status === 'approved' ? 'Question added to the bank.' : 'Question saved. It goes into tests once the owner or academic head approves it.');
      }
      setQ({ ...empty, subject: q.subject, topic: q.topic, difficulty: q.difficulty }); reload();
    } catch (x) { setErr(x.message); }
  }
  function startEdit(x) {
    const options = [...x.options, '', '', '', ''].slice(0, Math.max(4, x.options.length));
    setQ({ id: x.id, subject: x.subject, topic: x.topic, stem: x.stem, options, correctIndex: x.correct_index, explanation: x.explanation || '', difficulty: String(x.difficulty || 2) });
    setMsg(null); setErr(null);
    document.getElementById('qform')?.scrollIntoView({ behavior: 'smooth' });
  }
  async function mergeTopics() {
    const from = topicsById.get(Number(merge.fromId));
    const into = topicsById.get(Number(merge.intoId));
    if (!from || !into || from.id === into.id) { setErr('Pick two different topics'); return; }
    if (!window.confirm(`Move all questions of "${from.subject} · ${from.name}" into "${into.subject} · ${into.name}" and delete "${from.name}"?`)) return;
    try { const r = await api('/syllabus/topics/merge', { method: 'POST', body: { fromId: from.id, intoId: into.id } }); setMsg(`Merged. ${r.questions_moved} questions moved.`); setMerge(null); reload(); }
    catch (x) { setErr(x.message); }
  }
  async function importCsv(csv, clear) {
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await api('/syllabus/questions/import', { method: 'POST', body: { csv } }); setMsg(`${r.imported} questions imported (${r.status}).`); clear(); reload(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  async function setQStatus(ids, s) {
    try { await api('/syllabus/questions/status', { method: 'POST', body: { ids, status: s } }); reload(); } catch (x) { setErr(x.message); }
  }
  async function saveNotes() {
    try { await api(`/syllabus/topics/${notes.id}`, { method: 'PATCH', body: { notes: notes.text } }); setNotes(null); reload(); } catch (x) { setErr(x.message); }
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const [{ topics }, { questions }] = data;
  const drafts = questions.filter((x) => x.status === 'draft');
  const topicsById = new Map(topics.map((t) => [t.id, t]));
  const subjects = [...new Set(topics.map((t) => t.subject))];
  return (
    <div className="space-y-6">
      <div><h1 className="h1">Question bank</h1><p className="text-sm text-ink-soft">Only approved questions go into tests and practice sets.</p></div>
      <ErrorNote error={err} />{msg && <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p>}

      <section className="card">
        <h2 className="h2 mb-3">Topics</h2>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-ink-soft"><th className="py-2">Subject</th><th>Topic</th><th>Approved</th><th>Waiting</th><th>Tutor notes</th></tr></thead>
          <tbody>{topics.map((t) => (
            <tr key={t.id} className="border-t border-border">
              <td className="py-2">{t.subject}</td><td className="font-medium">{t.name}</td><td>{t.approved}</td><td>{t.drafts}</td>
              <td><button className="text-terracotta" onClick={() => setNotes({ id: t.id, name: t.name, text: t.notes || '' })}>{t.notes ? 'Edit' : 'Add'}</button></td>
            </tr>))}
          </tbody>
        </table></div>
        {!topics.length && <p className="text-sm text-ink-soft">No topics yet. Import questions or add one below; topics are created as you go.</p>}
        {lead && topics.length > 1 && (merge ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span>Merge</span>
            <select className="input w-auto py-1" aria-label="Duplicate topic" value={merge.fromId} onChange={(e) => setMerge({ ...merge, fromId: e.target.value })}>
              <option value="">duplicate topic…</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.subject} · {t.name}</option>)}
            </select>
            <span>into</span>
            <select className="input w-auto py-1" aria-label="Topic to keep" value={merge.intoId} onChange={(e) => setMerge({ ...merge, intoId: e.target.value })}>
              <option value="">topic to keep…</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.subject} · {t.name}</option>)}
            </select>
            <button className="btn-primary px-3 py-1" onClick={mergeTopics}>Merge</button>
            <button className="btn-ghost px-3 py-1" onClick={() => setMerge(null)}>Cancel</button>
          </div>
        ) : <button className="mt-3 text-sm font-semibold text-terracotta" onClick={() => setMerge({ fromId: '', intoId: '' })}>Same topic twice? Merge topics</button>)}
        {notes && (
          <div className="mt-4 space-y-2">
            <label className="label" htmlFor="notes">Notes for {notes.name} (the AI tutor's hints stay inside these)</label>
            <textarea id="notes" className="input h-32" value={notes.text} onChange={(e) => setNotes({ ...notes, text: e.target.value })} />
            <div className="flex gap-2"><button className="btn-primary" onClick={saveNotes}>Save notes</button><button className="btn-ghost" onClick={() => setNotes(null)}>Cancel</button></div>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <form id="qform" onSubmit={saveQuestion} className="card space-y-3">
          <h2 className="h2">{q.id ? 'Edit question' : 'Add a question'}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input" aria-label="Subject" list="subject-list" placeholder="Subject (e.g. Quant)" value={q.subject} onChange={(e) => setQ({ ...q, subject: e.target.value })} required />
            <input className="input" aria-label="Topic" list="topic-list" placeholder="Topic (e.g. Percentages)" value={q.topic} onChange={(e) => setQ({ ...q, topic: e.target.value })} required />
            <datalist id="subject-list">{subjects.map((x) => <option key={x} value={x} />)}</datalist>
            <datalist id="topic-list">{topics.filter((t) => !q.subject || t.subject.toLowerCase() === q.subject.trim().toLowerCase()).map((t) => <option key={t.id} value={t.name} />)}</datalist>
          </div>
          <textarea className="input h-20" aria-label="Question" placeholder="Question" value={q.stem} onChange={(e) => setQ({ ...q, stem: e.target.value })} required />
          {q.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <input type="radio" name="correct" checked={q.correctIndex === i} onChange={() => setQ({ ...q, correctIndex: i })} aria-label={`Option ${LETTERS[i]} is correct`} />
              <span className="w-4 font-semibold">{LETTERS[i]}</span>
              <input className="input" aria-label={`Option ${LETTERS[i]}`} value={o} onChange={(e) => setQ({ ...q, options: q.options.map((x, j) => (j === i ? e.target.value : x)) })} required={i < 2} />
            </label>
          ))}
          <p className={`text-xs ${q.correctIndex == null ? 'font-semibold text-destructive' : 'text-ink-soft'}`}>{q.correctIndex == null ? 'Click the round button next to the correct answer.' : `Correct answer: ${LETTERS[q.correctIndex]}`}</p>
          <textarea className="input h-16" aria-label="Explanation" placeholder="Explanation (shown after answering; used for hints)" value={q.explanation} onChange={(e) => setQ({ ...q, explanation: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="qdiff" className="text-sm text-ink-soft">Difficulty</label>
            <select id="qdiff" className="input w-auto py-1" value={q.difficulty} onChange={(e) => setQ({ ...q, difficulty: e.target.value })}>
              {Object.entries(DIFF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary">{q.id ? 'Save changes' : 'Save question'}</button>
            {q.id && <button type="button" className="btn-ghost" onClick={() => setQ({ ...empty, subject: q.subject, topic: q.topic })}>Cancel edit</button>}
          </div>
        </form>
        <div className="card space-y-2">
          <h2 className="h2">Import from CSV</h2>
          <p className="text-sm text-ink-soft">Columns: <code>subject,topic,question,option_a,option_b,option_c,option_d,answer,explanation,difficulty</code>.</p>
          <ul className="list-disc pl-5 text-sm text-ink-soft">
            <li><strong>answer</strong>: the letter of the correct option, A, B, C or D (must not be empty).</li>
            <li><strong>difficulty</strong>: 1 = easy, 2 = medium, 3 = hard (or the words easy / medium / hard). Empty = medium.</li>
            <li>Use the same subject and topic spelling as the topics above. One bad row cancels the whole file and names the row.</li>
          </ul>
          <CsvBox busy={busy} onSubmit={importCsv} placeholder={'subject,topic,question,option_a,option_b,option_c,option_d,answer,explanation,difficulty\nQuant,Percentages,What is 20% of 150?,30,20,25,35,A,20/100 × 150 = 30,1'} />
        </div>
      </section>

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="h2 mr-auto">Questions</h2>
          <select className="input w-auto" aria-label="Filter by topic" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">All topics</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.subject} · {t.name}</option>)}
          </select>
          <select className="input w-auto" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option><option value="draft">Waiting for approval</option><option value="approved">Approved</option><option value="retired">Retired</option>
          </select>
          {lead && drafts.length > 0 && <button className="btn-ghost" onClick={() => setQStatus(drafts.map((x) => x.id), 'approved')}>Approve all {drafts.length} waiting</button>}
        </div>
        <ul className="divide-y divide-border">
          {questions.map((x) => (
            <li key={x.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <div className="mr-auto max-w-3xl">
                  <div className="text-xs text-ink-soft">{x.subject} · {x.topic} · {DIFF[x.difficulty] || 'Medium'} · <span className="capitalize">{x.status === 'draft' ? 'waiting' : x.status}</span></div>
                  <div className="font-medium">{x.stem}</div>
                  <div className="mt-1 text-ink-soft">{x.options.map((o, i) => <span key={i} className={`mr-3 ${i === x.correct_index ? 'font-semibold text-ink' : ''}`}>{LETTERS[i]}) {o}</span>)}</div>
                </div>
                <button className="btn-ghost px-3 py-1" onClick={() => startEdit(x)}>Edit</button>
                {lead && x.status !== 'approved' && <button className="btn-ghost px-3 py-1" onClick={() => setQStatus([x.id], 'approved')}>Approve</button>}
                {lead && x.status === 'approved' && <button className="btn-ghost px-3 py-1" onClick={() => setQStatus([x.id], 'retired')}>Retire</button>}
              </div>
            </li>))}
        </ul>
        {!questions.length && <p className="text-sm text-ink-soft">No questions match.</p>}
      </section>
    </div>
  );
}

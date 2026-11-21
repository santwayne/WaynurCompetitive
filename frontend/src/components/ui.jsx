import { useEffect, useState } from 'react';

// Loads data from the API; returns [data, error, reload].
export function useApi(load, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load().then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return [data, error, () => setN((x) => x + 1)];
}

export const ErrorNote = ({ error }) => (error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null);
export const Loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;

export function Bar({ value }) {
  const v = value ?? 0;
  const color = value == null ? 'bg-muted' : v < 50 ? 'bg-destructive' : v < 60 ? 'bg-amber-warm' : 'bg-joy-leaf';
  return (
    <div className="h-2.5 w-full rounded-full bg-secondary" aria-hidden="true">
      <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="card">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

// Upload a .csv file or paste its text.
export function CsvBox({ onSubmit, placeholder, busy }) {
  const [csv, setCsv] = useState('');
  return (
    <div className="space-y-2">
      <input type="file" accept=".csv,text/csv" className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
      <textarea className="input h-28 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={placeholder} />
      <button className="btn-primary" disabled={!csv.trim() || busy} onClick={() => onSubmit(csv, () => setCsv(''))}>{busy ? 'Importing…' : 'Import'}</button>
    </div>
  );
}

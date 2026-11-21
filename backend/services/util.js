// Small shared helpers.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps an async route so thrown errors reach the error handler.
export const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const bad = (message) => new HttpError(400, message);
export const notFound = (what = 'Not found') => new HttpError(404, what);

export function intId(v, what = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`Invalid ${what}`);
  return n;
}

export function text(v, what, { max = 500, required = true } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && required) throw bad(`${what} is required`);
  if (s.length > max) throw bad(`${what} is too long (max ${max} characters)`);
  return s || null;
}

// Indian mobile → 10 digits (drops +91 / 0 / spaces). Same rule as Waynur's utils/phone.js.
export function normalizePhone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

// Minimal RFC-4180 CSV parser (quoted fields, "" escapes, CRLF). Returns rows
// as objects keyed by the lower-cased header.
export function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(input ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// Fisher–Yates on a copy; `rand` is injectable so tests are repeatable.
export function shuffle(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

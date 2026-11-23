import pool from '../config/db.js';
import { decryptSecret, encryptSecret, maskSecret } from './secretBox.js';
import { TEMPLATES, templateLang } from './waTemplates.js';
import { HttpError } from './util.js';

// Same model as Waynur's services/whatsappService.js + whatsappConnection.js:
// every centre sends from ITS OWN WhatsApp Business number, connected by a
// Super Admin. There is NO shared fallback number: a centre with no
// connection simply does not send, and each message is logged as "skipped"
// so the teacher can see why.

// WHATSAPP_API_BASE: only for tests / a local mock of the Graph API.
const graphBase = () => process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0';

const CACHE_MS = 60 * 1000;
const cache = new Map(); // centreId -> { at, creds }
export const clearWhatsAppCache = (centreId) => (centreId == null ? cache.clear() : cache.delete(Number(centreId)));

/** { phoneNumberId, accessToken, displayNumber } or null if not connected. */
export async function getCentreWhatsApp(centreId) {
  const id = Number(centreId);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.creds;
  const { rows } = await pool.query('SELECT * FROM centre_whatsapp WHERE centre_id = $1', [id]);
  let creds = null;
  if (rows[0]) {
    try {
      creds = { phoneNumberId: rows[0].phone_number_id, accessToken: decryptSecret(rows[0].access_token_enc), displayNumber: rows[0].display_number };
    } catch (err) {
      console.error(`[WhatsApp] centre ${id}: stored token could not be decrypted:`, err.message);
    }
  }
  cache.set(id, { at: Date.now(), creds });
  return creds;
}

async function graph(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${graphBase()}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data?.error?.message || `Meta returned ${res.status}`);
    e.meta = data?.error;
    throw e;
  }
  return data;
}

// Meta rejects empty variables and ones with new lines / tabs / 4+ spaces.
export function cleanParam(v) {
  const t = String(v ?? '').replace(/[\r\n\t\f\v\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (!t) return '-';
  return t.length > 900 ? `${t.slice(0, 899)}…` : t;
}

const toWa = (phone10) => `91${phone10}`;

function templatePayload(key, params) {
  const t = TEMPLATES[key];
  const components = [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: cleanParam(p) })) }];
  // Authentication templates carry the code again in the "Copy code" button.
  if (t.category === 'AUTHENTICATION') {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: cleanParam(params[0]) }] });
  }
  return { type: 'template', template: { name: t.name, language: { code: templateLang() }, components } };
}

/**
 * Send one message and log it. Never throws for delivery problems: the
 * result is recorded on the whatsapp_messages row and returned.
 *   { centreId, phone (10-digit), kind, refType?, refId?, template?: key in TEMPLATES, params?, text? }
 * A message with a ref is sent at most once per recipient (unique index).
 */
export async function sendLogged({ centreId, phone, kind, refType = null, refId = null, template = null, params = [], text = null }) {
  const body = template ? TEMPLATES[template].body.replace(/\{\{(\d+)\}\}/g, (_, n) => cleanParam(params[n - 1])) : text;
  const ins = await pool.query(
    `INSERT INTO whatsapp_messages (centre_id, direction, phone, kind, ref_type, ref_id, template, body)
     VALUES ($1,'out',$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
    [centreId, phone, kind, refType, refId, template ? TEMPLATES[template].name : null, body]
  );
  if (!ins.rowCount) return { status: 'duplicate' };
  const rowId = ins.rows[0].id;
  const finish = async (status, error = null, waId = null) => {
    await pool.query('UPDATE whatsapp_messages SET status = $1, error = $2, wa_message_id = $3 WHERE id = $4', [status, error, waId, rowId]);
    return { status, error };
  };
  const creds = await getCentreWhatsApp(centreId);
  if (!creds) return finish('skipped', 'WhatsApp is not connected for this centre');
  try {
    const payload = template ? templatePayload(template, params) : { type: 'text', text: { body: text, preview_url: true } };
    const data = await graph(`${creds.phoneNumberId}/messages`, {
      method: 'POST', token: creds.accessToken, body: { messaging_product: 'whatsapp', to: toWa(phone), ...payload },
    });
    return finish('sent', null, data?.messages?.[0]?.id || null);
  } catch (err) {
    console.error(`[WhatsApp] centre ${centreId} ${kind} to ${phone} failed:`, err.message);
    return finish('failed', err.message.slice(0, 500));
  }
}

// ── Connection (Super Admin only) ────────────────────────────────────────
const isMetaId = (v) => /^\d{5,30}$/.test(String(v || ''));

function businessNumber(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 15) return null;
  return `+${d.length === 10 ? `91${d}` : d}`;
}

/** Asks Meta whether this Phone Number ID + token are real, before saving. */
export async function verifyCredentials(phoneNumberId, accessToken) {
  try {
    const d = await graph(`${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, { token: accessToken });
    return { ok: true, displayNumber: d.display_phone_number || null, verifiedName: d.verified_name || null, quality: d.quality_rating || null };
  } catch (err) {
    return {
      ok: false,
      error: err.meta?.code === 190 ? 'Meta rejected the access token (invalid or expired). Use a permanent System User token.' : err.message,
    };
  }
}

export async function connectionInfo(centreId) {
  const { rows } = await pool.query(
    'SELECT display_number, phone_number_id, waba_id, verified_name, token_hint, connected_at FROM centre_whatsapp WHERE centre_id = $1', [centreId]);
  return rows[0] ? { connected: true, ...rows[0] } : { connected: false };
}

export async function connectCentre({ centreId, number, phoneNumberId, accessToken, wabaId, adminId }) {
  const num = businessNumber(number);
  if (!num) throw new HttpError(400, 'Enter the full WhatsApp Business number, e.g. +91 98765 43210');
  const pid = String(phoneNumberId || '').trim();
  if (!isMetaId(pid)) throw new HttpError(400, 'Phone Number ID must be the numeric ID from Meta (WhatsApp → API Setup)');
  const waba = String(wabaId || '').trim() || null;
  if (waba && !isMetaId(waba)) throw new HttpError(400, 'WhatsApp Business Account ID must be numeric');

  let token = String(accessToken || '').trim();
  if (!token) {
    const old = await pool.query('SELECT access_token_enc FROM centre_whatsapp WHERE centre_id = $1', [centreId]);
    if (!old.rowCount) throw new HttpError(400, 'Access token is required');
    token = decryptSecret(old.rows[0].access_token_enc);
  }
  const taken = await pool.query('SELECT 1 FROM centre_whatsapp WHERE phone_number_id = $1 AND centre_id <> $2', [pid, centreId]);
  if (taken.rowCount) throw new HttpError(409, 'This Phone Number ID is already connected to another centre');

  const check = await verifyCredentials(pid, token);
  if (!check.ok) throw new HttpError(400, `Meta did not accept these keys: ${check.error}`);
  const metaDigits = String(check.displayNumber || '').replace(/\D/g, '');
  if (metaDigits && metaDigits !== num.replace(/\D/g, '')) {
    throw new HttpError(400, `These keys belong to ${check.displayNumber}, not ${num}. Check the number or the Phone Number ID.`);
  }
  await pool.query(
    `INSERT INTO centre_whatsapp (centre_id, display_number, phone_number_id, waba_id, verified_name, access_token_enc, token_hint, connected_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (centre_id) DO UPDATE SET display_number = EXCLUDED.display_number, phone_number_id = EXCLUDED.phone_number_id,
       waba_id = EXCLUDED.waba_id, verified_name = EXCLUDED.verified_name, access_token_enc = EXCLUDED.access_token_enc,
       token_hint = EXCLUDED.token_hint, connected_by = EXCLUDED.connected_by, connected_at = now()`,
    [centreId, num, pid, waba, check.verifiedName, encryptSecret(token), maskSecret(token), adminId]
  );
  clearWhatsAppCache(centreId);
  return { ...(await connectionInfo(centreId)), quality: check.quality };
}

export async function disconnectCentre(centreId) {
  await pool.query('DELETE FROM centre_whatsapp WHERE centre_id = $1', [centreId]);
  clearWhatsAppCache(centreId);
}

/** Which centre a webhook event is for, from Meta's phone_number_id. */
export async function centreForPhoneNumberId(phoneNumberId) {
  const { rows } = await pool.query(
    `SELECT w.centre_id, c.name, c.status FROM centre_whatsapp w JOIN centres c ON c.id = w.centre_id WHERE w.phone_number_id = $1`,
    [String(phoneNumberId || '')]
  );
  return rows[0] || null;
}

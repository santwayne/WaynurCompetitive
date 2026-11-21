import { Router } from 'express';
import crypto from 'crypto';
import { webhookLimiter } from '../middleware/rateLimit.js';
import { processWebhook } from '../services/waInbound.js';

// Meta calls these. One callback URL serves every centre: the event's
// phone_number_id says which centre it is for (services/waInbound.js).
//   Callback URL:  https://competitive.waynur.com/api/whatsapp/webhook
//   Verify token:  WHATSAPP_VERIFY_TOKEN
const router = Router();

router.get('/webhook', (req, res) => {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  res.sendStatus(403);
});

// Every POST is signed by Meta with the App Secret (X-Hub-Signature-256 over
// the raw body). Unsigned or wrongly signed posts are refused, and with no
// WHATSAPP_APP_SECRET set nothing is processed (fails closed), same as Waynur.
export function validSignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !req.rawBody) return false;
  const [, given] = String(req.get('x-hub-signature-256') || '').split('=');
  if (!given) return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest();
  const provided = Buffer.from(given, 'hex');
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

router.post('/webhook', webhookLimiter, async (req, res) => {
  if (!validSignature(req)) {
    if (!process.env.WHATSAPP_APP_SECRET) console.error('[WhatsApp webhook] WHATSAPP_APP_SECRET is not set; refusing webhooks');
    return res.sendStatus(401);
  }
  // Answer Meta at once (it retries slow webhooks), then do the work.
  res.sendStatus(200);
  const run = processWebhook(req.body).catch((err) => console.error('[WhatsApp webhook]', err));
  if (process.env.NOTIFY_SYNC === '1') await run;
});

export default router;

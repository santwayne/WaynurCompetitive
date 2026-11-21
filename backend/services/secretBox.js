import crypto from 'crypto';

// AES-256-GCM for secrets we must store and use later (a centre's WhatsApp
// access token). Copied from Waynur's utils/secretBox.js. Only
// services/whatsapp.js decrypts, in memory, right before calling Meta.
//
// Key: CREDENTIALS_ENCRYPTION_KEY. Falls back to JWT_SECRET, but set a
// dedicated key in production: rotating JWT_SECRET would otherwise make
// every stored token unreadable (each centre would need reconnecting).
function key() {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('CREDENTIALS_ENCRYPTION_KEY (or JWT_SECRET) must be set to store WhatsApp credentials');
  return crypto.createHash('sha256').update(`waynur-competitive-credentials:${secret}`).digest();
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(blob) {
  const [version, ivB64, tagB64, dataB64] = String(blob || '').split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Stored credential is not in a readable format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

// "EAAG…x9Qz": enough for the Super Admin to recognise which token is saved.
export function maskSecret(plain) {
  const s = String(plain || '');
  return s.length <= 8 ? '••••' : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

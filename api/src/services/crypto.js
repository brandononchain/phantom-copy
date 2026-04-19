// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Credential encryption (AES-256-GCM)
// ─────────────────────────────────────────────────────────────────────────────
// Encrypts the JSON blob stored in accounts.credentials_encrypted so broker
// passwords, API keys, and OAuth tokens are never at rest as plaintext.
//
// Key source: process.env.CREDS_KEY (32-byte key, hex or base64).
// Format on disk: "enc:v1:<iv_b64>:<tag_b64>:<ct_b64>"
// Backwards-compat: plain JSON (legacy rows) is returned as-is by decryptCreds.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';

const ALG = 'aes-256-gcm';
const PREFIX = 'enc:v1:';
let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.CREDS_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CREDS_KEY environment variable is required in production');
    }
    console.warn('[CRYPTO] CREDS_KEY not set — credentials will be stored as plaintext (DEV ONLY)');
    cachedKey = null;
    return null;
  }
  let buf;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'base64');
  }
  if (buf.length !== 32) {
    throw new Error(`CREDS_KEY must decode to 32 bytes (got ${buf.length})`);
  }
  cachedKey = buf;
  return cachedKey;
}

export function encryptJSON(obj) {
  const json = JSON.stringify(obj || {});
  const key = loadKey();
  if (!key) return json; // dev fallback (plaintext)

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + iv.toString('base64') + ':' + tag.toString('base64') + ':' + ct.toString('base64');
}

export function decryptJSON(stored) {
  if (stored == null || stored === '') return {};

  // Legacy plaintext row
  if (typeof stored === 'string' && !stored.startsWith(PREFIX)) {
    try { return JSON.parse(stored); } catch { return {}; }
  }

  const key = loadKey();
  if (!key) return {}; // encrypted row, no key — refuse to guess

  try {
    const rest = stored.slice(PREFIX.length);
    const [ivB64, tagB64, ctB64] = rest.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const decipher = crypto.createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch (err) {
    console.error('[CRYPTO] Failed to decrypt credentials:', err.message);
    return {};
  }
}

// Returns true if the key is configured (safe to encrypt new rows properly)
export function hasEncryptionKey() {
  try { return !!loadKey(); } catch { return false; }
}

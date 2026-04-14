// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Broker Token Refresh Service
// ─────────────────────────────────────────────────────────────────────────────
// Tradovate/NinjaTrader OAuth tokens expire in 90 minutes.
// This service runs a background loop that refreshes tokens before expiry.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/pool.js';
import { copyEngine } from './copy-engine.js';

const TRADOVATE_API = 'https://live.tradovateapi.com/v1';
const TRADOVATE_DEMO_API = 'https://demo.tradovateapi.com/v1';
const REFRESH_BUFFER_MS = 10 * 60 * 1000; // Refresh 10 minutes before expiry
const CHECK_INTERVAL_MS = 2 * 60 * 1000;  // Check every 2 minutes

let refreshTimer = null;

export function startTokenRefreshLoop() {
  console.log('[TOKEN-REFRESH] Starting background token refresh loop');
  refreshTimer = setInterval(checkAndRefreshTokens, CHECK_INTERVAL_MS);
  // Run immediately on start
  setTimeout(checkAndRefreshTokens, 5000);
}

export function stopTokenRefreshLoop() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function checkAndRefreshTokens() {
  try {
    // Find tokens expiring within the buffer window
    const result = await query(
      `SELECT bt.*, a.platform, a.broker_account_id, a.label, a.credentials_encrypted
       FROM broker_tokens bt
       JOIN accounts a ON a.id = bt.account_id
       WHERE bt.expires_at IS NOT NULL
         AND bt.expires_at < NOW() + INTERVAL '${REFRESH_BUFFER_MS / 1000} seconds'
         AND bt.refresh_token IS NOT NULL`
    );

    if (result.rows.length === 0) return;

    console.log(`[TOKEN-REFRESH] ${result.rows.length} token(s) need refresh`);

    for (const token of result.rows) {
      try {
        await refreshToken(token);
      } catch (err) {
        console.error(`[TOKEN-REFRESH] Failed for account ${token.account_id} (${token.label}): ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[TOKEN-REFRESH] Check failed:', err.message);
  }
}

async function refreshToken(tokenRow) {
  const { account_id, platform, refresh_token } = tokenRow;

  if (platform !== 'tradovate' && platform !== 'ninjatrader') return;

  const baseUrl = TRADOVATE_DEMO_API; // TODO: detect live vs demo from account config

  console.log(`[TOKEN-REFRESH] Refreshing ${platform} token for account ${account_id}`);

  const res = await fetch(`${baseUrl}/auth/renewaccesstoken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh_token }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Tradovate refresh failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const newAccessToken = data.accessToken || data['p-ticket'];
  const newExpiry = data.expirationTime ? new Date(data.expirationTime) : new Date(Date.now() + 85 * 60 * 1000);

  if (!newAccessToken) throw new Error('No access token in refresh response');

  // Update broker_tokens table
  await query(
    `UPDATE broker_tokens SET access_token = $1, expires_at = $2, last_refreshed_at = NOW() WHERE account_id = $3`,
    [newAccessToken, newExpiry, account_id]
  );

  // Update the account's credentials_encrypted with the new token
  let creds = {};
  try { creds = JSON.parse(tokenRow.credentials_encrypted || '{}'); } catch {}
  creds.token = newAccessToken;

  await query(
    `UPDATE accounts SET credentials_encrypted = $1 WHERE id = $2`,
    [JSON.stringify(creds), account_id]
  );

  // Invalidate the cached copy client so it picks up the new token
  copyEngine.invalidateClient(account_id);

  console.log(`[TOKEN-REFRESH] Refreshed ${platform} token for account ${account_id}, expires ${newExpiry.toISOString()}`);
}

// ── Store a new token (called on OAuth callback) ─────────────────────────────

export async function storeToken({ userId, accountId, platform, accessToken, refreshToken, expiresAt }) {
  await query(
    `INSERT INTO broker_tokens (user_id, account_id, platform, access_token, refresh_token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (account_id) DO UPDATE SET
       access_token = $4, refresh_token = $5, expires_at = $6, last_refreshed_at = NOW()`,
    [userId, accountId, platform, accessToken, refreshToken, expiresAt]
  );
}

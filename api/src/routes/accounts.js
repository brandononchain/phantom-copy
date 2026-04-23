import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired, requirePlan } from '../middleware/auth.js';
import { sendAccountConnectedEmail } from '../services/email.js';
import { encryptJSON } from '../services/crypto.js';
import { storeToken } from '../services/token-refresh.js';
import { listenerManager } from '../services/listener-manager.js';

const router = Router();

// ── List accounts ─────────────────────────────────────────────────────────────

router.get('/', authRequired, async (req, res) => {
  const result = await query(
    `SELECT a.*, pa.ip_address, pa.provider, pa.region, pa.health
     FROM accounts a
     LEFT JOIN proxy_assignments pa ON pa.account_id = a.id
     WHERE a.user_id = $1
     ORDER BY a.role DESC, a.created_at`,
    [req.user.id]
  );
  // Never echo the encrypted creds blob to clients
  const accounts = result.rows.map(({ credentials_encrypted, ...rest }) => rest);
  res.json({ accounts });
});

// ── Connect account ───────────────────────────────────────────────────────────

router.post('/', authRequired, async (req, res) => {
  const { platform, role, brokerAccountId, label, credentials } = req.body;

  // Plan check: basic limited to 5 followers (trial grants Pro limits)
  if (role === 'follower') {
    const count = await query(
      `SELECT COUNT(*) FROM accounts WHERE user_id = $1 AND role = 'follower'`,
      [req.user.id]
    );
    const userPlan = await query('SELECT plan, trial_ends_at, trial_plan FROM users WHERE id = $1', [req.user.id]);
    const row = userPlan.rows[0] || {};
    const trialActive = row.trial_ends_at && new Date(row.trial_ends_at) > new Date();
    const plan = trialActive ? (row.trial_plan || 'pro') : (row.plan || 'basic');

    if (plan === 'basic' && parseInt(count.rows[0].count) >= 5) {
      return res.status(403).json({
        error: 'follower_limit',
        message: 'Basic plan limited to 5 follower accounts. Upgrade to Pro for unlimited.',
      });
    }
  }

  // Only one master allowed
  if (role === 'master') {
    const existing = await query(
      `SELECT id FROM accounts WHERE user_id = $1 AND role = 'master'`,
      [req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Master account already connected' });
    }
  }

  // Encrypt the creds JSON blob with AES-256-GCM before storing.
  // Accepts either a JSON string (legacy callers) or an object.
  let credsObj = {};
  if (credentials) {
    if (typeof credentials === 'string') {
      try { credsObj = JSON.parse(credentials); } catch { credsObj = {}; }
    } else if (typeof credentials === 'object') {
      credsObj = credentials;
    }
  }
  const encryptedCreds = encryptJSON(credsObj);

  const result = await query(
    `INSERT INTO accounts (user_id, platform, role, broker_account_id, label, credentials_encrypted)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.id, platform, role, brokerAccountId, label, encryptedCreds]
  );

  // If this is a Tradovate/NinjaTrader OAuth account and the creds include a
  // refresh token / expiry, register it with the token-refresh loop so BOTH
  // master AND follower tokens get refreshed before the 90-min expiry.
  if ((platform === 'tradovate' || platform === 'ninjatrader') && credsObj.token) {
    const expiresInSec = parseInt(credsObj.expiresIn || credsObj.expires_in || 5400);
    const expiresAt = credsObj.expiresAt ? new Date(credsObj.expiresAt) : new Date(Date.now() + expiresInSec * 1000);
    await storeToken({
      userId: req.user.id,
      accountId: result.rows[0].id,
      platform,
      accessToken: credsObj.token,
      refreshToken: credsObj.refreshToken || credsObj.refresh_token || null,
      expiresAt,
    }).catch(err => console.error('[ACCOUNTS] storeToken failed:', err.message));
  }

  // Send account connected email (non-blocking)
  const userInfo = await query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
  if (userInfo.rows[0]) {
    sendAccountConnectedEmail(userInfo.rows[0].email, { name: userInfo.rows[0].name, platform, role, label }).catch(() => {});
  }

  // Don't echo the encrypted blob back
  const { credentials_encrypted, ...safeAccount } = result.rows[0];
  res.status(201).json({ account: safeAccount });
});

// ── Disconnect account ────────────────────────────────────────────────────────

router.delete('/:id', authRequired, async (req, res) => {
  try {
    // Check if this is a master account — stop listener session
    const acct = await query('SELECT role FROM accounts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (acct.rows.length === 0) return res.status(404).json({ error: 'Account not found' });

    if (acct.rows[0].role === 'master') {
      // Stop the in-memory listener first so it doesn't keep copying trades
      await listenerManager.stopByAccount(parseInt(req.params.id)).catch(() => {});
      await query('UPDATE listener_sessions SET status = $1, stopped_at = NOW() WHERE account_id = $2 AND status = $3', ['stopped', req.params.id, 'active']);
    }

    // Clean up related data (listener_sessions + listener_events lack ON DELETE CASCADE,
    // so remove them explicitly before deleting the account row).
    await query(
      `DELETE FROM listener_events WHERE session_id IN
         (SELECT id FROM listener_sessions WHERE account_id = $1)`,
      [req.params.id]
    ).catch(() => {});
    await query('DELETE FROM listener_sessions WHERE account_id = $1', [req.params.id]).catch(() => {});
    await query('DELETE FROM follower_overrides WHERE account_id = $1', [req.params.id]);
    await query('DELETE FROM proxy_assignments WHERE account_id = $1', [req.params.id]);
    await query('DELETE FROM broker_tokens WHERE account_id = $1', [req.params.id]).catch(() => {});
    await query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[ACCOUNTS] Delete error:', err.message);
    res.status(500).json({ error: 'Failed to disconnect account' });
  }
});

export default router;

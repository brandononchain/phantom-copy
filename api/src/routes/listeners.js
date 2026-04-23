import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';
import { listenerManager } from '../services/listener-manager.js';
import { copyEngine } from '../services/copy-engine.js';
import { decryptJSON } from '../services/crypto.js';

const router = Router();

// ── Start master listener ─────────────────────────────────────────────────────

router.post('/start', authRequired, async (req, res) => {
  const { accountId, credentials: credsOverride } = req.body;

  if (!accountId) {
    return res.status(400).json({ error: 'accountId required' });
  }

  // Verify account belongs to user and is a master
  const acct = await query(
    'SELECT * FROM accounts WHERE id = $1 AND user_id = $2',
    [accountId, req.user.id]
  );
  if (acct.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
  if (acct.rows[0].role !== 'master') return res.status(400).json({ error: 'Can only start listener on master accounts' });

  const account = acct.rows[0];
  const platform = account.platform;

  // Hydrate credentials from DB. The accounts API never echoes the decrypted
  // creds to the client, so the frontend can't send them directly. We load
  // them here from:
  //   1) accounts.credentials_encrypted  (encrypted JSON blob)
  //   2) broker_tokens                   (latest OAuth access token)
  // Optional req.body.credentials fields override (useful for re-auth flows).
  let credentials = {};
  if (account.credentials_encrypted) {
    try {
      credentials = decryptJSON(account.credentials_encrypted) || {};
    } catch (err) {
      console.error('[LISTENERS] decrypt creds failed:', err.message);
    }
  }

  if (platform === 'tradovate' || platform === 'ninjatrader') {
    const tok = await query(
      `SELECT access_token, expires_at FROM broker_tokens
       WHERE account_id = $1 ORDER BY last_refreshed_at DESC NULLS LAST, id DESC LIMIT 1`,
      [accountId]
    );
    if (tok.rows[0]?.access_token) {
      credentials.token = tok.rows[0].access_token;
    }
    // Ensure brokerAccountId and userId are populated from the account row
    credentials.brokerAccountId = credentials.brokerAccountId || account.broker_account_id;
    credentials.userId = credentials.userId || credentials.brokerUserId || account.broker_account_id;
  }

  // Apply any client-supplied overrides last
  if (credsOverride && typeof credsOverride === 'object') {
    credentials = { ...credentials, ...credsOverride };
  }

  // Get proxy assignment for this account
  const proxyResult = await query(
    'SELECT * FROM proxy_assignments WHERE account_id = $1',
    [accountId]
  );
  const proxyAssignment = proxyResult.rows[0] || null;

  try {
    const result = await listenerManager.startListener({
      userId: req.user.id,
      accountId: parseInt(accountId),
      platform,
      credentials,
      proxyAssignment,
    });

    res.json(result);
  } catch (err) {
    console.error('[LISTENERS] start failed:', err.stack || err.message);
    res.status(500).json({ error: 'Failed to start listener', message: err.message });
  }
});

// ── Stop master listener ──────────────────────────────────────────────────────

router.post('/stop', authRequired, async (req, res) => {
  const { accountId, sessionId } = req.body;

  try {
    let result;
    if (sessionId) {
      result = await listenerManager.stopListener(sessionId);
    } else if (accountId) {
      result = await listenerManager.stopByAccount(parseInt(accountId));
    } else {
      return res.status(400).json({ error: 'accountId or sessionId required' });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop listener', message: err.message });
  }
});

// ── Get active sessions for user ──────────────────────────────────────────────

router.get('/sessions', authRequired, async (req, res) => {
  const activeSessions = listenerManager.getActiveSessions(req.user.id);

  // Also get recent DB sessions
  const dbSessions = await query(
    `SELECT ls.*, a.label, a.platform FROM listener_sessions ls
     JOIN accounts a ON a.id = ls.account_id
     WHERE ls.user_id = $1 ORDER BY ls.started_at DESC LIMIT 20`,
    [req.user.id]
  );

  res.json({
    active: activeSessions,
    history: dbSessions.rows,
  });
});

// ── Get events for a session ──────────────────────────────────────────────────

router.get('/sessions/:sessionId/events', authRequired, async (req, res) => {
  // Verify session belongs to user
  const session = await query(
    'SELECT * FROM listener_sessions WHERE id = $1 AND user_id = $2',
    [req.params.sessionId, req.user.id]
  );
  if (session.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

  const events = await listenerManager.getSessionEvents(
    parseInt(req.params.sessionId),
    parseInt(req.query.limit) || 50
  );

  res.json({ events });
});

// ── Get copy engine stats ─────────────────────────────────────────────────────

router.get('/stats', authRequired, async (req, res) => {
  const stats = copyEngine.getStats();

  // Get recent executions from DB
  const recentExecs = await query(
    `SELECT ce.*, a.label as master_label FROM copy_executions ce
     JOIN accounts a ON a.id = ce.master_account_id
     WHERE ce.user_id = $1 ORDER BY ce.timestamp DESC LIMIT 20`,
    [req.user.id]
  );

  // Get fill stats
  const fillStats = await query(
    `SELECT
       COUNT(*) FILTER (WHERE cf.status = 'filled') as total_fills,
       COUNT(*) FILTER (WHERE cf.status = 'error') as total_errors,
       AVG(cf.latency_ms) FILTER (WHERE cf.status = 'filled') as avg_latency,
       MIN(cf.latency_ms) FILTER (WHERE cf.status = 'filled') as min_latency,
       MAX(cf.latency_ms) FILTER (WHERE cf.status = 'filled') as max_latency
     FROM copy_fills cf
     JOIN copy_executions ce ON ce.id = cf.execution_id
     WHERE ce.user_id = $1`,
    [req.user.id]
  );

  res.json({
    engine: stats,
    recentExecutions: recentExecs.rows,
    fillStats: fillStats.rows[0],
  });
});

// ── System status (user-scoped) ───────────────────────────────────────────────

router.get('/status', authRequired, async (req, res) => {
  const sessions = listenerManager.getActiveSessions(req.user.id);
  res.json({ activeSessions: sessions.length, sessions });
});

export default router;

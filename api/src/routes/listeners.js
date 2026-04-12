import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';
import { listenerManager } from '../services/listener-manager.js';
import { copyEngine } from '../services/copy-engine.js';

const router = Router();

// ── Start master listener ─────────────────────────────────────────────────────

router.post('/start', authRequired, async (req, res) => {
  const { accountId, credentials } = req.body;

  if (!accountId || !credentials) {
    return res.status(400).json({ error: 'accountId and credentials required' });
  }

  // Verify account belongs to user and is a master
  const acct = await query(
    'SELECT * FROM accounts WHERE id = $1 AND user_id = $2',
    [accountId, req.user.id]
  );
  if (acct.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
  if (acct.rows[0].role !== 'master') return res.status(400).json({ error: 'Can only start listener on master accounts' });

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
      platform: acct.rows[0].platform,
      credentials,
      proxyAssignment,
    });

    res.json(result);
  } catch (err) {
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

// ── System status (admin-level) ───────────────────────────────────────────────

router.get('/status', authRequired, async (req, res) => {
  const status = listenerManager.getStatus();
  res.json(status);
});

export default router;

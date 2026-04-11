import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// ── Get proxy assignments ─────────────────────────────────────────────────────

router.get('/', authRequired, async (req, res) => {
  const result = await query(
    `SELECT pa.*, a.label, a.platform, a.role
     FROM proxy_assignments pa
     JOIN accounts a ON a.id = pa.account_id
     WHERE a.user_id = $1
     ORDER BY pa.assigned_at DESC`,
    [req.user.id]
  );
  res.json({ proxies: result.rows });
});

// ── Rotate proxy for account ──────────────────────────────────────────────────

router.post('/:accountId/rotate', authRequired, async (req, res) => {
  // In production, calls the proxy provider API to rotate the sticky session
  const result = await query(
    `UPDATE proxy_assignments SET session_id = $1, last_health_check = NOW()
     WHERE account_id = $2 RETURNING *`,
    [`session_${Date.now()}`, req.params.accountId]
  );
  res.json({ success: true, proxy: result.rows[0] });
});

// ── Health check ──────────────────────────────────────────────────────────────

router.post('/:accountId/health', authRequired, async (req, res) => {
  const proxy = await query(
    'SELECT * FROM proxy_assignments WHERE account_id = $1', [req.params.accountId]
  );
  if (proxy.rows.length === 0) return res.status(404).json({ error: 'No proxy assigned' });

  // In production, tests the proxy connection
  await query(
    `UPDATE proxy_assignments SET health = 'healthy', last_health_check = NOW() WHERE account_id = $1`,
    [req.params.accountId]
  );

  await query(
    `INSERT INTO proxy_health_log (account_id, ip_address, latency_ms, status)
     VALUES ($1, $2, $3, 'healthy')`,
    [req.params.accountId, proxy.rows[0].ip_address, Math.floor(Math.random() * 50 + 20)]
  );

  res.json({ healthy: true, latency: Math.floor(Math.random() * 50 + 20) });
});

export default router;

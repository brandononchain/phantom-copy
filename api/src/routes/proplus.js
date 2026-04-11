import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { authRequired, requirePlan } from '../middleware/auth.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// Custom Proxy Pools
// ═══════════════════════════════════════════════════════════════════════════

router.get('/proxy-pools', authRequired, requirePlan('customPools'), async (req, res) => {
  const result = await query(
    `SELECT p.*, COUNT(i.id) as ip_count,
            SUM(CASE WHEN i.health = 'healthy' THEN 1 ELSE 0 END) as healthy_count
     FROM proxy_pools p
     LEFT JOIN proxy_pool_ips i ON i.pool_id = p.id
     WHERE p.user_id = $1
     GROUP BY p.id ORDER BY p.created_at DESC`,
    [req.user.id]
  );
  res.json({ pools: result.rows });
});

router.post('/proxy-pools', authRequired, requirePlan('customPools'), async (req, res) => {
  const { name, provider, region, size } = req.body;

  if (!name || !provider || !region) {
    return res.status(400).json({ error: 'name, provider, and region required' });
  }

  const result = await query(
    `INSERT INTO proxy_pools (user_id, name, provider, region, size, status)
     VALUES ($1, $2, $3, $4, $5, 'provisioning') RETURNING *`,
    [req.user.id, name, provider, region, size || 10]
  );

  // In production, kick off async IP provisioning here
  // For now, mark as active after insert
  await query(`UPDATE proxy_pools SET status = 'active' WHERE id = $1`, [result.rows[0].id]);

  res.status(201).json({ pool: result.rows[0] });
});

router.delete('/proxy-pools/:id', authRequired, requirePlan('customPools'), async (req, res) => {
  await query('DELETE FROM proxy_pool_ips WHERE pool_id = $1', [req.params.id]);
  await query('DELETE FROM proxy_pools WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

router.post('/proxy-pools/:id/rotate', authRequired, requirePlan('customPools'), async (req, res) => {
  // Trigger IP rotation for all IPs in the pool
  // In production, this calls the provider API
  res.json({ success: true, message: 'Pool rotation initiated' });
});

// ═══════════════════════════════════════════════════════════════════════════
// API Keys
// ═══════════════════════════════════════════════════════════════════════════

router.get('/keys', authRequired, requirePlan('api'), async (req, res) => {
  const result = await query(
    `SELECT id, name, key_prefix, env, status, created_at, last_used_at
     FROM api_keys WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ keys: result.rows });
});

router.post('/keys', authRequired, requirePlan('api'), async (req, res) => {
  const { name, env } = req.body;
  const prefix = `pc_${env || 'live'}_`;
  const rawKey = prefix + crypto.randomBytes(30).toString('base64url');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 20) + '...';

  await query(
    `INSERT INTO api_keys (user_id, name, key_hash, key_prefix, env, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [req.user.id, name || 'Untitled', keyHash, keyPrefix, env || 'live']
  );

  // Return raw key ONCE
  res.status(201).json({ key: rawKey, prefix: keyPrefix, name: name || 'Untitled' });
});

router.delete('/keys/:id', authRequired, requirePlan('api'), async (req, res) => {
  await query(
    `UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Webhooks
// ═══════════════════════════════════════════════════════════════════════════

const VALID_EVENTS = [
  'trade.executed', 'trade.failed',
  'listener.connected', 'listener.disconnected',
  'risk.drawdown', 'proxy.rotated', 'account.connected',
];

router.get('/webhooks', authRequired, requirePlan('webhooks'), async (req, res) => {
  const result = await query(
    `SELECT w.*,
            (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id AND wd.status = 'delivered') as success_count,
            (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id) as total_count,
            (SELECT MAX(last_attempt_at) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id) as last_delivery
     FROM webhooks w WHERE w.user_id = $1 AND w.status = 'active'
     ORDER BY w.created_at DESC`,
    [req.user.id]
  );
  res.json({ webhooks: result.rows });
});

router.post('/webhooks', authRequired, requirePlan('webhooks'), async (req, res) => {
  const { url, events } = req.body;

  if (!url) return res.status(400).json({ error: 'URL required' });
  const validEvents = (events || []).filter(e => VALID_EVENTS.includes(e));
  if (validEvents.length === 0) return res.status(400).json({ error: 'At least one valid event required' });

  const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;

  const result = await query(
    `INSERT INTO webhooks (user_id, url, events, secret, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
    [req.user.id, url, JSON.stringify(validEvents), secret]
  );

  res.status(201).json({ webhook: result.rows[0], secret });
});

router.delete('/webhooks/:id', authRequired, requirePlan('webhooks'), async (req, res) => {
  await query(
    `UPDATE webhooks SET status = 'deleted' WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  res.json({ success: true });
});

router.get('/webhooks/:id/deliveries', authRequired, requirePlan('webhooks'), async (req, res) => {
  const result = await query(
    `SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY last_attempt_at DESC LIMIT 20`,
    [req.params.id]
  );
  res.json({ deliveries: result.rows });
});

// ── Webhook test endpoint ─────────────────────────────────────────────────────

router.post('/webhooks/:id/test', authRequired, requirePlan('webhooks'), async (req, res) => {
  const wh = await query('SELECT * FROM webhooks WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (wh.rows.length === 0) return res.status(404).json({ error: 'Webhook not found' });

  const webhook = wh.rows[0];
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event: 'test', timestamp, data: { message: 'Webhook test from Phantom Copy' } });
  const signature = crypto.createHmac('sha256', webhook.secret).update(`${timestamp}.${body}`).digest('hex');

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PhantomCopy-Signature': signature, 'X-PhantomCopy-Event': 'test' },
      body,
      signal: AbortSignal.timeout(10000),
    });

    res.json({ success: response.ok, status: response.status });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

export default router;

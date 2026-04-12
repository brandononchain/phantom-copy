import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// ── Get notification preferences ──────────────────────────────────────────────

router.get('/preferences', authRequired, async (req, res) => {
  const result = await query('SELECT * FROM notification_preferences WHERE user_id = $1', [req.user.id]);
  res.json({
    preferences: result.rows[0] || {
      channel: 'email', copy_failures: true, proxy_health: true,
      listener_disconnects: true, drawdown_alerts: true, daily_pnl: false,
    },
  });
});

// ── Save notification preferences ─────────────────────────────────────────────

router.put('/preferences', authRequired, async (req, res) => {
  const { channel, copy_failures, proxy_health, listener_disconnects, drawdown_alerts, daily_pnl } = req.body;

  const result = await query(
    `INSERT INTO notification_preferences (user_id, channel, copy_failures, proxy_health, listener_disconnects, drawdown_alerts, daily_pnl, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       channel = COALESCE($2, notification_preferences.channel),
       copy_failures = COALESCE($3, notification_preferences.copy_failures),
       proxy_health = COALESCE($4, notification_preferences.proxy_health),
       listener_disconnects = COALESCE($5, notification_preferences.listener_disconnects),
       drawdown_alerts = COALESCE($6, notification_preferences.drawdown_alerts),
       daily_pnl = COALESCE($7, notification_preferences.daily_pnl),
       updated_at = NOW()
     RETURNING *`,
    [req.user.id, channel || 'email', copy_failures, proxy_health, listener_disconnects, drawdown_alerts, daily_pnl]
  );

  res.json({ preferences: result.rows[0] });
});

// ── Get notifications ─────────────────────────────────────────────────────────

router.get('/', authRequired, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const result = await query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [req.user.id, limit]
  );
  const unread = await query(
    'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false',
    [req.user.id]
  );
  res.json({ notifications: result.rows, unread: parseInt(unread.rows[0].count) });
});

// ── Mark notification as read ─────────────────────────────────────────────────

router.patch('/:id/read', authRequired, async (req, res) => {
  await query('UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

// ── Mark all as read ──────────────────────────────────────────────────────────

router.post('/read-all', authRequired, async (req, res) => {
  await query('UPDATE notifications SET read = true WHERE user_id = $1', [req.user.id]);
  res.json({ success: true });
});

// ── Delete notification ───────────────────────────────────────────────────────

router.delete('/:id', authRequired, async (req, res) => {
  await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

export default router;

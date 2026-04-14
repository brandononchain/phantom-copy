import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// ── Get risk rules ────────────────────────────────────────────────────────────

router.get('/risk', authRequired, async (req, res) => {
  try {
    const result = await query('SELECT * FROM risk_rules WHERE user_id = $1', [req.user.id]);
    res.json({
      rules: result.rows[0] || {
        max_qty: 10,
        daily_loss_limit: 500,
        max_trades_per_day: 50,
        trailing_drawdown: null,
        auto_flatten_time: null,
        kill_switch: false,
        copy_delay_ms: 0,
        latency_jitter_ms: 0,
        token_refresh_min: 85,
        ws_heartbeat_sec: 2.5,
        max_reconnects: 20,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// ── Save risk rules (ALL fields) ──────────────────────────────────────────────

router.put('/risk', authRequired, async (req, res) => {
  const {
    max_qty,
    daily_loss_limit,
    max_trades_per_day,
    trailing_drawdown,
    auto_flatten_time,
    kill_switch,
    copy_delay_ms,
    latency_jitter_ms,
    token_refresh_min,
    ws_heartbeat_sec,
    max_reconnects,
  } = req.body;

  try {
    // Self-heal: ensure columns exist (idempotent)
    await query(`
      ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS copy_delay_ms INTEGER DEFAULT 0;
      ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS latency_jitter_ms INTEGER DEFAULT 0;
      ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS token_refresh_min INTEGER DEFAULT 85;
      ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS ws_heartbeat_sec DECIMAL(4,1) DEFAULT 2.5;
      ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS max_reconnects INTEGER DEFAULT 20;
    `).catch(() => {});

    const result = await query(
      `INSERT INTO risk_rules (
        user_id, max_qty, daily_loss_limit, max_trades_per_day,
        trailing_drawdown, auto_flatten_time, kill_switch,
        copy_delay_ms, latency_jitter_ms, token_refresh_min,
        ws_heartbeat_sec, max_reconnects
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (user_id) DO UPDATE SET
        max_qty = COALESCE($2, risk_rules.max_qty),
        daily_loss_limit = COALESCE($3, risk_rules.daily_loss_limit),
        max_trades_per_day = COALESCE($4, risk_rules.max_trades_per_day),
        trailing_drawdown = $5,
        auto_flatten_time = $6,
        kill_switch = COALESCE($7, risk_rules.kill_switch),
        copy_delay_ms = COALESCE($8, risk_rules.copy_delay_ms),
        latency_jitter_ms = COALESCE($9, risk_rules.latency_jitter_ms),
        token_refresh_min = COALESCE($10, risk_rules.token_refresh_min),
        ws_heartbeat_sec = COALESCE($11, risk_rules.ws_heartbeat_sec),
        max_reconnects = COALESCE($12, risk_rules.max_reconnects)
      RETURNING *`,
      [
        req.user.id,
        max_qty ?? null,
        daily_loss_limit ?? null,
        max_trades_per_day ?? null,
        trailing_drawdown ?? null,
        auto_flatten_time ?? null,
        kill_switch ?? false,
        copy_delay_ms ?? 0,
        latency_jitter_ms ?? 0,
        token_refresh_min ?? 85,
        ws_heartbeat_sec ?? 2.5,
        max_reconnects ?? 20,
      ]
    );

    res.json({ rules: result.rows[0] });
  } catch (err) {
    console.error('[SETTINGS] Save failed:', err.message);
    res.status(500).json({ error: 'Save failed' });
  }
});

// ── Get follower overrides ────────────────────────────────────────────────────

router.get('/overrides', authRequired, async (req, res) => {
  try {
    const result = await query(
      `SELECT fo.*, a.label FROM follower_overrides fo
       JOIN accounts a ON a.id = fo.account_id
       WHERE fo.user_id = $1`,
      [req.user.id]
    );
    res.json({ overrides: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load overrides' });
  }
});

// ── Save follower override ────────────────────────────────────────────────────

router.put('/overrides/:accountId', authRequired, async (req, res) => {
  const { max_qty, daily_loss_limit, size_multiplier } = req.body;

  try {
    const result = await query(
      `INSERT INTO follower_overrides (user_id, account_id, max_qty, daily_loss_limit, size_multiplier)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, account_id) DO UPDATE SET
         max_qty = $3, daily_loss_limit = $4, size_multiplier = $5
       RETURNING *`,
      [req.user.id, req.params.accountId, max_qty || null, daily_loss_limit || null, size_multiplier || 1.0]
    );

    res.json({ override: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Override save failed' });
  }
});

export default router;

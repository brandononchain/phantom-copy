import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

const SELF_HEAL_SQL = `
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS copy_delay_ms INTEGER DEFAULT 0;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS latency_jitter_ms INTEGER DEFAULT 0;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS token_refresh_min INTEGER DEFAULT 85;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS ws_heartbeat_sec DECIMAL(4,1) DEFAULT 2.5;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS max_reconnects INTEGER DEFAULT 20;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS copy_symbols TEXT DEFAULT 'NQ,ES,YM,RTY';
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS size_mode VARCHAR(20) DEFAULT 'multiplier';
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS size_multiplier DECIMAL(5,2) DEFAULT 1.0;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS fixed_qty INTEGER DEFAULT 1;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS copy_brackets BOOLEAN DEFAULT true;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS copy_modifications BOOLEAN DEFAULT true;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS invert_signals BOOLEAN DEFAULT false;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS session_filter VARCHAR(10) DEFAULT 'all';
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS rotation_mode VARCHAR(20) DEFAULT 'manual';
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS rotation_interval INTEGER DEFAULT 24;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS health_check_interval INTEGER DEFAULT 30;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS auto_rotate_on_fail BOOLEAN DEFAULT true;
  ALTER TABLE risk_rules ADD COLUMN IF NOT EXISTS max_latency_threshold INTEGER DEFAULT 100;
`;

const DEFAULTS = {
  max_qty: 10, daily_loss_limit: 500, max_trades_per_day: 50, trailing_drawdown: null,
  kill_switch: false, copy_delay_ms: 0, latency_jitter_ms: 0, token_refresh_min: 85,
  ws_heartbeat_sec: 2.5, max_reconnects: 20, copy_symbols: 'NQ,ES,YM,RTY',
  size_mode: 'multiplier', size_multiplier: 1.0, fixed_qty: 1,
  copy_brackets: true, copy_modifications: true, invert_signals: false,
  session_filter: 'all', rotation_mode: 'manual', rotation_interval: 24,
  health_check_interval: 30, auto_rotate_on_fail: true, max_latency_threshold: 100,
};

router.get('/risk', authRequired, async (req, res) => {
  try {
    await query(SELF_HEAL_SQL).catch(() => {});
    const result = await query('SELECT * FROM risk_rules WHERE user_id = $1', [req.user.id]);
    res.json({ rules: result.rows[0] || DEFAULTS });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.put('/risk', authRequired, async (req, res) => {
  try {
    await query(SELF_HEAL_SQL).catch(() => {});
    const b = req.body;
    const result = await query(
      `INSERT INTO risk_rules (
        user_id, max_qty, daily_loss_limit, max_trades_per_day, trailing_drawdown, kill_switch,
        copy_delay_ms, latency_jitter_ms, token_refresh_min, ws_heartbeat_sec, max_reconnects,
        copy_symbols, size_mode, size_multiplier, fixed_qty,
        copy_brackets, copy_modifications, invert_signals, session_filter,
        rotation_mode, rotation_interval, health_check_interval, auto_rotate_on_fail, max_latency_threshold
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      ON CONFLICT (user_id) DO UPDATE SET
        max_qty=COALESCE($2,risk_rules.max_qty), daily_loss_limit=COALESCE($3,risk_rules.daily_loss_limit),
        max_trades_per_day=COALESCE($4,risk_rules.max_trades_per_day), trailing_drawdown=$5,
        kill_switch=COALESCE($6,risk_rules.kill_switch), copy_delay_ms=COALESCE($7,risk_rules.copy_delay_ms),
        latency_jitter_ms=COALESCE($8,risk_rules.latency_jitter_ms), token_refresh_min=COALESCE($9,risk_rules.token_refresh_min),
        ws_heartbeat_sec=COALESCE($10,risk_rules.ws_heartbeat_sec), max_reconnects=COALESCE($11,risk_rules.max_reconnects),
        copy_symbols=COALESCE($12,risk_rules.copy_symbols), size_mode=COALESCE($13,risk_rules.size_mode),
        size_multiplier=COALESCE($14,risk_rules.size_multiplier), fixed_qty=COALESCE($15,risk_rules.fixed_qty),
        copy_brackets=COALESCE($16,risk_rules.copy_brackets), copy_modifications=COALESCE($17,risk_rules.copy_modifications),
        invert_signals=COALESCE($18,risk_rules.invert_signals), session_filter=COALESCE($19,risk_rules.session_filter),
        rotation_mode=COALESCE($20,risk_rules.rotation_mode), rotation_interval=COALESCE($21,risk_rules.rotation_interval),
        health_check_interval=COALESCE($22,risk_rules.health_check_interval),
        auto_rotate_on_fail=COALESCE($23,risk_rules.auto_rotate_on_fail),
        max_latency_threshold=COALESCE($24,risk_rules.max_latency_threshold)
      RETURNING *`,
      [req.user.id, b.max_qty??null, b.daily_loss_limit??null, b.max_trades_per_day??null,
       b.trailing_drawdown??null, b.kill_switch??false, b.copy_delay_ms??0, b.latency_jitter_ms??0,
       b.token_refresh_min??85, b.ws_heartbeat_sec??2.5, b.max_reconnects??20,
       b.copy_symbols??'NQ,ES,YM,RTY', b.size_mode??'multiplier', b.size_multiplier??1.0, b.fixed_qty??1,
       b.copy_brackets??true, b.copy_modifications??true, b.invert_signals??false, b.session_filter??'all',
       b.rotation_mode??'manual', b.rotation_interval??24, b.health_check_interval??30,
       b.auto_rotate_on_fail??true, b.max_latency_threshold??100]
    );
    res.json({ rules: result.rows[0] });
  } catch (err) {
    console.error('[SETTINGS] Save error:', err.message);
    res.status(500).json({ error: 'Settings save failed', message: err.message });
  }
});

router.get('/overrides', authRequired, async (req, res) => {
  try {
    const result = await query('SELECT * FROM follower_overrides WHERE user_id = $1', [req.user.id]);
    const map = {};
    for (const o of result.rows) {
      map[o.account_id] = { maxQty: o.max_qty, dailyLoss: o.daily_loss_limit, sizeMultiplier: o.size_multiplier };
    }
    res.json({ overrides: map });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load overrides' });
  }
});

router.put('/overrides/:accountId', authRequired, async (req, res) => {
  const { max_qty, daily_loss_limit, size_multiplier } = req.body;
  const userPlan = await query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
  const plan = userPlan.rows[0]?.plan || 'basic';
  if (plan === 'basic') {
    return res.status(403).json({ error: 'plan_required', message: 'Pro or Pro+ plan required' });
  }
  try {
    const result = await query(
      `INSERT INTO follower_overrides (user_id, account_id, max_qty, daily_loss_limit, size_multiplier)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, account_id) DO UPDATE SET max_qty=$3, daily_loss_limit=$4, size_multiplier=COALESCE($5,1.0)
       RETURNING *`,
      [req.user.id, req.params.accountId, max_qty||null, daily_loss_limit||null, size_multiplier||1.0]
    );
    res.json({ override: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Override save failed' });
  }
});

export default router;

import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// ── Get risk rules ────────────────────────────────────────────────────────────

router.get('/risk', authRequired, async (req, res) => {
  const result = await query('SELECT * FROM risk_rules WHERE user_id = $1', [req.user.id]);
  res.json({ rules: result.rows[0] || { max_qty: 10, daily_loss_limit: 500, max_trades_per_day: 50, kill_switch: false } });
});

// ── Save risk rules ───────────────────────────────────────────────────────────

router.put('/risk', authRequired, async (req, res) => {
  const { max_qty, daily_loss_limit, max_trades_per_day, trailing_drawdown, auto_flatten_time, kill_switch } = req.body;

  const result = await query(
    `INSERT INTO risk_rules (user_id, max_qty, daily_loss_limit, max_trades_per_day, trailing_drawdown, auto_flatten_time, kill_switch)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       max_qty = COALESCE($2, risk_rules.max_qty),
       daily_loss_limit = COALESCE($3, risk_rules.daily_loss_limit),
       max_trades_per_day = COALESCE($4, risk_rules.max_trades_per_day),
       trailing_drawdown = $5,
       auto_flatten_time = $6,
       kill_switch = COALESCE($7, risk_rules.kill_switch)
     RETURNING *`,
    [req.user.id, max_qty, daily_loss_limit, max_trades_per_day, trailing_drawdown || null, auto_flatten_time || null, kill_switch || false]
  );

  res.json({ rules: result.rows[0] });
});

// ── Get follower overrides ────────────────────────────────────────────────────

router.get('/overrides', authRequired, async (req, res) => {
  const result = await query(
    `SELECT fo.*, a.label FROM follower_overrides fo
     JOIN accounts a ON a.id = fo.account_id
     WHERE fo.user_id = $1`,
    [req.user.id]
  );
  res.json({ overrides: result.rows });
});

// ── Save follower override ────────────────────────────────────────────────────

router.put('/overrides/:accountId', authRequired, async (req, res) => {
  const { max_qty, daily_loss_limit, size_multiplier } = req.body;

  const result = await query(
    `INSERT INTO follower_overrides (user_id, account_id, max_qty, daily_loss_limit, size_multiplier)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, account_id) DO UPDATE SET
       max_qty = $3, daily_loss_limit = $4, size_multiplier = $5
     RETURNING *`,
    [req.user.id, req.params.accountId, max_qty || null, daily_loss_limit || null, size_multiplier || 1.0]
  );

  res.json({ override: result.rows[0] });
});

export default router;

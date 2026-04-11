import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// ── List executions ───────────────────────────────────────────────────────────

router.get('/', authRequired, async (req, res) => {
  const { limit = 50, offset = 0, symbol, side, status } = req.query;

  let sql = `
    SELECT ce.*, a.label as master_label, a.platform,
           json_agg(json_build_object(
             'id', cf.id, 'account_id', cf.follower_account_id,
             'fill_price', cf.fill_price, 'slippage', cf.slippage_ticks,
             'latency_ms', cf.latency_ms, 'proxy_ip', cf.proxy_ip,
             'status', cf.status
           )) as fills
    FROM copy_executions ce
    JOIN accounts a ON a.id = ce.master_account_id
    LEFT JOIN copy_fills cf ON cf.execution_id = ce.id
    WHERE ce.user_id = $1
  `;
  const params = [req.user.id];
  let paramIdx = 2;

  if (symbol) { sql += ` AND ce.contract_id ILIKE $${paramIdx}`; params.push(`%${symbol}%`); paramIdx++; }
  if (side) { sql += ` AND ce.side = $${paramIdx}`; params.push(side); paramIdx++; }

  sql += ` GROUP BY ce.id, a.label, a.platform ORDER BY ce.timestamp DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
  params.push(parseInt(limit), parseInt(offset));

  const result = await query(sql, params);
  res.json({ trades: result.rows });
});

// ── Trade stats ───────────────────────────────────────────────────────────────

router.get('/stats', authRequired, async (req, res) => {
  const stats = await query(
    `SELECT
       COUNT(*) as total_trades,
       COUNT(DISTINCT ce.contract_id) as symbols_traded,
       AVG(cf.latency_ms) as avg_latency,
       SUM(CASE WHEN cf.slippage_ticks = 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(cf.id), 0) * 100 as zero_slip_pct,
       MAX(ce.timestamp) as last_trade
     FROM copy_executions ce
     LEFT JOIN copy_fills cf ON cf.execution_id = ce.id
     WHERE ce.user_id = $1 AND ce.timestamp > NOW() - INTERVAL '30 days'`,
    [req.user.id]
  );
  res.json({ stats: stats.rows[0] });
});

export default router;

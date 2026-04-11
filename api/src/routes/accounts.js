import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired, requirePlan } from '../middleware/auth.js';

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
  res.json({ accounts: result.rows });
});

// ── Connect account ───────────────────────────────────────────────────────────

router.post('/', authRequired, async (req, res) => {
  const { platform, role, brokerAccountId, label, credentials } = req.body;

  // Plan check: basic limited to 5 followers
  if (role === 'follower') {
    const count = await query(
      `SELECT COUNT(*) FROM accounts WHERE user_id = $1 AND role = 'follower'`,
      [req.user.id]
    );
    const userPlan = await query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
    const plan = userPlan.rows[0]?.plan || 'basic';

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

  const result = await query(
    `INSERT INTO accounts (user_id, platform, role, broker_account_id, label, credentials_encrypted)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.id, platform, role, brokerAccountId, label, credentials]
  );

  res.status(201).json({ account: result.rows[0] });
});

// ── Disconnect account ────────────────────────────────────────────────────────

router.delete('/:id', authRequired, async (req, res) => {
  await query('DELETE FROM proxy_assignments WHERE account_id = $1', [req.params.id]);
  await query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

export default router;

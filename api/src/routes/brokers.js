import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

const PROJECTX_API = 'https://api.thefuturesdesk.projectx.com';

// ── TopStepX / ProjectX Auth ──────────────────────────────────────────────────
// Frontend calls this instead of ProjectX directly (avoids CORS)

router.post('/topstepx/auth', authRequired, async (req, res) => {
  const { username, apiKey } = req.body;

  if (!username || !apiKey) {
    return res.status(400).json({ error: 'Username and API key required' });
  }

  try {
    const response = await fetch(`${PROJECTX_API}/api/Auth/loginKey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/plain' },
      body: JSON.stringify({ userName: username, apiKey }),
    });

    const data = await response.json();

    if (!data.success || data.errorCode !== 0) {
      return res.status(401).json({
        error: 'auth_failed',
        message: data.errorMessage || 'ProjectX authentication failed. Check your username and API key.',
      });
    }

    // Return the JWT token (valid 24h)
    res.json({ token: data.token, platform: 'topstepx' });
  } catch (err) {
    res.status(502).json({ error: 'gateway_error', message: `Could not reach ProjectX: ${err.message}` });
  }
});

// ── Fetch TopStepX accounts using the JWT token ──────────────────────────────

router.post('/topstepx/accounts', authRequired, async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'ProjectX token required' });
  }

  try {
    const response = await fetch(`${PROJECTX_API}/api/Account/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/plain',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ onlyActiveAccounts: true }),
    });

    const data = await response.json();

    if (!data.success) {
      return res.status(401).json({ error: 'Failed to fetch accounts', message: data.errorMessage });
    }

    // Map to our standard account format
    const accounts = (data.accounts || []).map(acc => ({
      id: String(acc.id),
      name: acc.name,
      canTrade: acc.canTrade,
      isVisible: acc.isVisible,
      balance: acc.balance,
      simulated: acc.simulated,
    }));

    res.json({ accounts });
  } catch (err) {
    res.status(502).json({ error: 'gateway_error', message: `Could not reach ProjectX: ${err.message}` });
  }
});

// ── Tradovate OAuth proxy (placeholder for when Tradovate is implemented) ────

router.post('/tradovate/auth', authRequired, async (req, res) => {
  // TODO: implement Tradovate OAuth flow
  res.status(501).json({ error: 'not_implemented', message: 'Tradovate connection coming soon' });
});

router.post('/tradovate/accounts', authRequired, async (req, res) => {
  res.status(501).json({ error: 'not_implemented', message: 'Tradovate connection coming soon' });
});

// ── Rithmic (placeholder) ────────────────────────────────────────────────────

router.post('/rithmic/auth', authRequired, async (req, res) => {
  res.status(501).json({ error: 'not_implemented', message: 'Rithmic connection coming soon' });
});

// ── NinjaTrader (placeholder) ────────────────────────────────────────────────

router.post('/ninjatrader/auth', authRequired, async (req, res) => {
  res.status(501).json({ error: 'not_implemented', message: 'NinjaTrader connection coming soon' });
});

export default router;

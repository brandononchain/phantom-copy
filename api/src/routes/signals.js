// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: TradingView Signal Webhook
// ─────────────────────────────────────────────────────────────────────────────
// Receives trading signals from TradingView alerts, TrendSpider, or custom code.
// Places orders on the user's master account, then the copy engine replicates
// to all followers through their dedicated proxy IPs.
//
// Signal URL format: POST /api/signals/:signalKey
// No auth header needed - the signalKey IS the authentication.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { copyEngine } from '../services/copy-engine.js';

const router = Router();

// ── Contract ID mappings ─────────────────────────────────────────────────────
// TradingView sends ticker symbols (NQ, ES, MNQ, etc.)
// TopStepX/Tradovate use numeric contractIds
// This maps common futures symbols to their IDs

const SYMBOL_MAP = {
  // E-mini futures - TopStepX uses CON.F.US.{SYMBOL}.{MONTH_CODE}{YEAR} format
  // We use a function to resolve the current front month
  'ES':   { tradovate: 'ES',  name: 'E-mini S&P 500' },
  'NQ':   { tradovate: 'NQ',  name: 'E-mini Nasdaq 100' },
  'YM':   { tradovate: 'YM',  name: 'E-mini Dow' },
  'RTY':  { tradovate: 'RTY', name: 'E-mini Russell 2000' },
  'GC':   { tradovate: 'GC',  name: 'Gold' },
  'CL':   { tradovate: 'CL',  name: 'Crude Oil' },
  'SI':   { tradovate: 'SI',  name: 'Silver' },
  // Micro futures
  'MES':  { tradovate: 'MES', name: 'Micro E-mini S&P 500' },
  'MNQ':  { tradovate: 'MNQ', name: 'Micro E-mini Nasdaq 100' },
  'MYM':  { tradovate: 'MYM', name: 'Micro E-mini Dow' },
  'M2K':  { tradovate: 'M2K', name: 'Micro E-mini Russell' },
  'MGC':  { tradovate: 'MGC', name: 'Micro Gold' },
  'MCL':  { tradovate: 'MCL', name: 'Micro Crude Oil' },
};

// TopStepX uses CON.F.US.{SYMBOL}.{MONTH_CODE}{YY} format
// Month codes: F=Jan, G=Feb, H=Mar, J=Apr, K=May, M=Jun, N=Jul, Q=Aug, U=Sep, V=Oct, X=Nov, Z=Dec
function getProjectXContractId(ticker) {
  const months = ['F','G','H','J','K','M','N','Q','U','V','X','Z'];
  const now = new Date();
  // Get front month (current or next month)
  let monthIdx = now.getMonth();
  let year = now.getFullYear() % 100;
  // If we're past the 15th, use next month
  if (now.getDate() > 15) {
    monthIdx = (monthIdx + 1) % 12;
    if (monthIdx === 0) year++;
  }
  return `CON.F.US.${ticker}.${months[monthIdx]}${year}`;
}

// ── Parse TradingView/TrendSpider/Custom signal ──────────────────────────────

function parseSignal(body) {
  // Normalize field names (TradingView, TrendSpider, and custom formats)
  const ticker = (body.ticker || body.symbol || body.instrument || '').toUpperCase().replace(/[0-9!@#$%^&*()]/g, '').trim();
  const rawAction = (body.action || body.side || body.order_action || body.signal || '').toLowerCase().trim();
  const qty = parseInt(body.qty || body.quantity || body.contracts || body.size || body.order_qty || 1);
  const price = parseFloat(body.price || body.limit_price || 0);
  const orderType = (body.order_type || body.type || 'market').toLowerCase();
  const sentiment = (body.sentiment || body.market_position || '').toLowerCase();

  // Determine action
  let action = null;
  let side = null;

  if (['buy', 'long', 'buy_to_open', 'enter_long'].includes(rawAction)) {
    action = 'OPEN'; side = 'Buy';
  } else if (['sell', 'short', 'sell_to_open', 'enter_short', 'sell_short'].includes(rawAction)) {
    action = 'OPEN'; side = 'Sell';
  } else if (['close', 'exit', 'flatten', 'close_all', 'exit_long', 'exit_short', 'buy_to_close', 'sell_to_close'].includes(rawAction)) {
    action = 'CLOSE';
    // For close, determine side from sentiment or default
    if (rawAction.includes('long') || sentiment === 'long') side = 'Sell'; // close long = sell
    else if (rawAction.includes('short') || sentiment === 'short') side = 'Buy'; // close short = buy
    else side = 'Sell'; // default close = sell (assumes long position)
  } else if (rawAction === 'reverse' || rawAction === 'flip') {
    action = 'REVERSE';
    side = sentiment === 'short' ? 'Sell' : 'Buy';
  }

  // TradingView strategy format uses sentiment for direction
  if (!action && sentiment) {
    if (sentiment === 'long') { action = 'OPEN'; side = 'Buy'; }
    else if (sentiment === 'short') { action = 'OPEN'; side = 'Sell'; }
    else if (sentiment === 'flat') { action = 'CLOSE'; side = 'Sell'; }
  }

  if (!action || !side) {
    return { error: `Cannot parse action from: "${rawAction}" sentiment: "${sentiment}"` };
  }

  if (!ticker) {
    return { error: 'Missing ticker/symbol in payload' };
  }

  return {
    ticker,
    action,
    side,
    qty: Math.max(1, qty || 1),
    price,
    orderType: orderType === 'limit' ? 'Limit' : orderType === 'stop' ? 'Stop' : 'Market',
    raw: body,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Signal Key Management
// ═══════════════════════════════════════════════════════════════════════════════

// Generate a new signal key
router.post('/keys', async (req, res) => {
  // This needs auth - check cookie or API key
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let userId;
  try {
    const jwt = await import('jsonwebtoken');
    const { config } = await import('../config/index.js');
    const decoded = jwt.default.verify(token, config.jwt.secret);
    userId = decoded.id;
  } catch { return res.status(401).json({ error: 'Invalid session' }); }

  const { name } = req.body;

  // Generate unique signal key
  const signalKey = `tv_${crypto.randomBytes(16).toString('base64url')}`;
  const keyHash = crypto.createHash('sha256').update(signalKey).digest('hex');

  try {
    // Store in DB (reuse api_keys table with env='signal')
    await query(
      `INSERT INTO api_keys (user_id, name, key_hash, key_prefix, env, status)
       VALUES ($1, $2, $3, $4, 'signal', 'active')`,
      [userId, name || 'TradingView Signal', keyHash, signalKey.slice(0, 12) + '...']
    );

    // Get the user's signal URL
    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'https://api-production-e175.up.railway.app';

    res.status(201).json({
      signalKey,
      signalUrl: `${baseUrl}/api/signals/${signalKey}`,
      name: name || 'TradingView Signal',
      instructions: {
        tradingview: {
          webhook_url: `${baseUrl}/api/signals/${signalKey}`,
          message_format: '{"ticker": "{{ticker}}", "action": "{{strategy.order.action}}", "qty": {{strategy.order.contracts}}, "price": "{{close}}", "sentiment": "{{strategy.market_position}}"}',
        },
        trendspider: {
          webhook_url: `${baseUrl}/api/signals/${signalKey}`,
          message_format: '{"ticker": "%alert_symbol%", "action": "buy", "qty": 1, "price": "%last_price%"}',
        },
        custom_curl: `curl -X POST ${baseUrl}/api/signals/${signalKey} -H "Content-Type: application/json" -d '{"ticker": "NQ", "action": "buy", "qty": 1}'`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create signal key', message: err.message });
  }
});

// List signal keys
router.get('/keys', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let userId;
  try {
    const jwt = await import('jsonwebtoken');
    const { config } = await import('../config/index.js');
    const decoded = jwt.default.verify(token, config.jwt.secret);
    userId = decoded.id;
  } catch { return res.status(401).json({ error: 'Invalid session' }); }

  const result = await query(
    `SELECT id, name, key_prefix, status, created_at, last_used_at
     FROM api_keys WHERE user_id = $1 AND env = 'signal' AND status = 'active'
     ORDER BY created_at DESC`,
    [userId]
  );

  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://api-production-e175.up.railway.app';

  res.json({
    keys: result.rows.map(k => ({
      ...k,
      signalUrl: `${baseUrl}/api/signals/${k.key_prefix.replace('...', '')}...`,
    })),
  });
});

// Delete signal key
router.delete('/keys/:id', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let userId;
  try {
    const jwt = await import('jsonwebtoken');
    const { config } = await import('../config/index.js');
    const decoded = jwt.default.verify(token, config.jwt.secret);
    userId = decoded.id;
  } catch { return res.status(401).json({ error: 'Invalid session' }); }

  await query(
    `UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND user_id = $2 AND env = 'signal'`,
    [req.params.id, userId]
  );
  res.json({ success: true });
});

// Get signal execution history
router.get('/history', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let userId;
  try {
    const jwt = await import('jsonwebtoken');
    const { config } = await import('../config/index.js');
    const decoded = jwt.default.verify(token, config.jwt.secret);
    userId = decoded.id;
  } catch { return res.status(401).json({ error: 'Invalid session' }); }

  const result = await query(
    `SELECT ce.*, a.label as master_label,
       (SELECT COUNT(*) FROM copy_fills cf WHERE cf.execution_id = ce.id AND cf.status = 'filled') as fills,
       (SELECT COUNT(*) FROM copy_fills cf WHERE cf.execution_id = ce.id AND cf.status = 'error') as errors
     FROM copy_executions ce
     JOIN accounts a ON a.id = ce.master_account_id
     WHERE ce.user_id = $1 ORDER BY ce.timestamp DESC LIMIT 50`,
    [userId]
  );

  res.json({ history: result.rows });
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE SIGNAL ENDPOINT - This is what TradingView hits
// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/signals/:signalKey
// No auth header needed. The signalKey in the URL IS the authentication.

router.post('/:signalKey', async (req, res) => {
  const { signalKey } = req.params;
  const receivedAt = Date.now();

  // 1. Validate signal key
  const keyHash = crypto.createHash('sha256').update(signalKey).digest('hex');
  const keyResult = await query(
    `SELECT ak.*, u.plan FROM api_keys ak
     JOIN users u ON u.id = ak.user_id
     WHERE ak.key_hash = $1 AND ak.env = 'signal' AND ak.status = 'active'`,
    [keyHash]
  );

  if (keyResult.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid or revoked signal key' });
  }

  const key = keyResult.rows[0];
  const userId = key.user_id;

  // Update last used
  await query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [key.id]);

  // 2. Parse the signal
  const signal = parseSignal(req.body);
  if (signal.error) {
    // Log the failed signal
    await logSignal(userId, null, 'PARSE_ERROR', req.body, signal.error);
    return res.status(400).json({ error: signal.error, received: req.body });
  }

  // 3. Find the user's master account
  const masterResult = await query(
    `SELECT a.*, pa.ip_address FROM accounts a
     LEFT JOIN proxy_assignments pa ON pa.account_id = a.id
     WHERE a.user_id = $1 AND a.role = 'master' AND a.status != 'paused'
     LIMIT 1`,
    [userId]
  );

  if (masterResult.rows.length === 0) {
    await logSignal(userId, null, 'NO_MASTER', req.body, 'No active master account found');
    return res.status(400).json({ error: 'No active master account connected. Connect a master account first.' });
  }

  const master = masterResult.rows[0];

  // 4. Resolve contract ID for the master's platform
  const symbolInfo = SYMBOL_MAP[signal.ticker];
  let contractId;

  if (master.platform === 'topstepx') {
    // TopStepX uses CON.F.US.NQ.M26 format
    contractId = getProjectXContractId(signal.ticker);
  } else if (master.platform === 'tradovate') {
    contractId = symbolInfo?.tradovate || signal.ticker;
  } else {
    contractId = signal.ticker;
  }

  // 5. Place order on master account
  let masterOrderResult;
  try {
    const creds = JSON.parse(master.credentials_encrypted || '{}');

    if (master.platform === 'topstepx') {
      // Place via TopStepX REST API
      const orderBody = {
        accountId: parseInt(master.broker_account_id),
        contractId: contractId, // String like "CON.F.US.MNQ.M26"
        type: signal.orderType === 'Market' ? 2 : signal.orderType === 'Limit' ? 1 : 4,
        side: signal.side === 'Buy' ? 0 : 1,
        size: signal.qty,
      };
      if (signal.orderType === 'Limit' && signal.price) orderBody.limitPrice = signal.price;
      if (signal.orderType === 'Stop' && signal.price) orderBody.stopPrice = signal.price;

      const orderRes = await fetch('https://api.topstepx.com/api/Order/place', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
          'Accept': 'text/plain',
        },
        body: JSON.stringify(orderBody),
      });
      const orderData = await orderRes.json();

      if (!orderData.success) {
        throw new Error(orderData.errorMessage || `Order rejected (code ${orderData.errorCode})`);
      }
      masterOrderResult = { orderId: orderData.orderId, platform: 'topstepx' };

    } else if (master.platform === 'tradovate') {
      // Place via Tradovate REST API
      const baseUrl = 'https://demo.tradovateapi.com/v1';
      const orderRes = await fetch(`${baseUrl}/order/placeorder`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accountSpec: master.broker_account_id,
          accountId: parseInt(master.broker_account_id),
          action: signal.side === 'Buy' ? 'Buy' : 'Sell',
          symbol: contractId,
          orderQty: signal.qty,
          orderType: signal.orderType,
          isAutomated: true,
        }),
      });
      const orderData = await orderRes.json();
      if (orderData.failureReason) {
        throw new Error(orderData.failureReason);
      }
      masterOrderResult = { orderId: orderData.orderId, platform: 'tradovate' };
    } else {
      throw new Error(`Signal execution not supported for platform: ${master.platform}`);
    }
  } catch (err) {
    await logSignal(userId, master.id, 'MASTER_ORDER_FAILED', req.body, err.message);
    return res.status(500).json({
      error: 'Master order failed',
      message: err.message,
      signal: { ticker: signal.ticker, action: signal.action, side: signal.side, qty: signal.qty },
    });
  }

  // 6. Trigger copy to followers via the copy engine
  const copySignal = {
    action: signal.action,
    contractId,
    side: signal.side,
    qty: signal.qty,
    price: signal.price || 0,
    timestamp: receivedAt,
    platform: master.platform,
    masterAccountId: master.id,
    source: 'tradingview_webhook',
  };

  // Fire and forget - the copy engine handles replication async
  copyEngine.handleCopySignal(copySignal, master.id).catch(err => {
    console.error('[SIGNAL] Copy engine error:', err.message);
  });

  const latency = Date.now() - receivedAt;

  // 7. Log the successful signal
  await logSignal(userId, master.id, 'EXECUTED', req.body, null, {
    ticker: signal.ticker, action: signal.action, side: signal.side,
    qty: signal.qty, latency, masterOrderId: masterOrderResult?.orderId,
  });

  // 8. Return success
  res.json({
    success: true,
    signal: {
      ticker: signal.ticker,
      action: signal.action,
      side: signal.side,
      qty: signal.qty,
      orderType: signal.orderType,
    },
    master: {
      platform: master.platform,
      orderId: masterOrderResult?.orderId,
    },
    latency: `${latency}ms`,
    timestamp: new Date().toISOString(),
  });
});

// ── Signal logging helper ────────────────────────────────────────────────────

async function logSignal(userId, masterAccountId, status, payload, error, details) {
  try {
    await query(
      `INSERT INTO copy_executions (user_id, master_account_id, signal_type, contract_id, side, qty, master_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        masterAccountId,
        `WEBHOOK_${status}`,
        details?.ticker || payload?.ticker || 'unknown',
        details?.side || payload?.action || 'unknown',
        details?.qty || parseInt(payload?.qty) || 0,
        details?.price || parseFloat(payload?.price) || 0,
      ]
    );
  } catch (err) {
    console.error('[SIGNAL] Failed to log signal:', err.message);
  }
}

export default router;

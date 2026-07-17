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
import { resolveContractId, normalizeTicker, getContractInfo } from '../services/contracts.js';
import { authRequired } from '../middleware/auth.js';
import { encryptJSON, decryptJSON } from '../services/crypto.js';

const router = Router();

// ── Contract ID mappings ─────────────────────────────────────────────────────
// TradingView sends ticker symbols (NQ, ES, MNQ, etc.)
// TopStepX/Tradovate use numeric contractIds
// This maps common futures symbols to their IDs

// Contract resolution handled by services/contracts.js

// ── Parse TradingView/TrendSpider/Custom signal ──────────────────────────────

function parseSignal(body) {
  // Normalize field names (TradingView, TrendSpider, and custom formats)
  // Keep alphanumerics plus the ':' exchange-prefix and '!' continuous-contract
  // markers so normalizeTicker() can resolve forms like CME_MINI:NQ1! and 6E.
  const ticker = (body.ticker || body.symbol || body.instrument || '').toUpperCase().replace(/[^A-Z0-9:!]/g, '').trim();
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
router.post('/keys', authRequired, async (req, res) => {
  const userId = req.user.id;

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
      : 'https://www.tradevanish.com';

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
router.get('/keys', authRequired, async (req, res) => {
  const userId = req.user.id;

  const result = await query(
    `SELECT id, name, key_prefix, status, created_at, last_used_at
     FROM api_keys WHERE user_id = $1 AND env = 'signal' AND status = 'active'
     ORDER BY created_at DESC`,
    [userId]
  );

  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://www.tradevanish.com';

  res.json({
    keys: result.rows.map(k => ({
      ...k,
      signalUrl: `${baseUrl}/api/signals/${k.key_prefix.replace('...', '')}...`,
    })),
  });
});

// Delete signal key
router.delete('/keys/:id', authRequired, async (req, res) => {
  const userId = req.user.id;

  await query(
    `UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND user_id = $2 AND env = 'signal'`,
    [req.params.id, userId]
  );
  res.json({ success: true });
});

// Get signal execution history
router.get('/history', authRequired, async (req, res) => {
  const userId = req.user.id;

  const result = await query(
    `SELECT se.id, se.status, se.ticker, se.action, se.side, se.qty, se.price,
            se.order_type, se.master_order_id, se.latency_ms, se.error, se.created_at,
            a.label AS master_label
       FROM signal_events se
       LEFT JOIN accounts a ON a.id = se.master_account_id
      WHERE se.user_id = $1
      ORDER BY se.created_at DESC
      LIMIT 50`,
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
    await logSignal({ userId, signalKeyId: key.id, status: 'PARSE_ERROR', payload: req.body, error: signal.error });
    return res.status(400).json({ error: signal.error, received: req.body });
  }

  // 2a. Idempotency — dedupe identical signals within a 3s window
  //     (TradingView retries on slow responses; this prevents duplicate orders)
  const idempotencyKey = crypto.createHash('sha1')
    .update(`${userId}:${signal.ticker}:${signal.action}:${signal.side}:${signal.qty}:${Math.floor(receivedAt / 3000)}`)
    .digest('hex')
    .slice(0, 16);
  if (!globalThis.__signalIdempotency) globalThis.__signalIdempotency = new Map();
  const idMap = globalThis.__signalIdempotency;
  if (idMap.has(idempotencyKey)) {
    return res.status(200).json({ success: true, deduped: true, message: 'Duplicate signal ignored' });
  }
  idMap.set(idempotencyKey, receivedAt);
  // Evict old entries (keep < 500)
  if (idMap.size > 500) {
    const cutoff = receivedAt - 10000;
    for (const [k, t] of idMap) if (t < cutoff) idMap.delete(k);
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
    await logSignal({ userId, signalKeyId: key.id, status: 'NO_MASTER', payload: req.body, error: 'No active master account found' });
    return res.status(400).json({ error: 'No active master account connected. Connect a master account first.' });
  }

  const master = masterResult.rows[0];

  // 3a. Enforce kill switch BEFORE placing master order
  const riskRow = await query('SELECT kill_switch FROM risk_rules WHERE user_id = $1', [userId]);
  if (riskRow.rows[0]?.kill_switch) {
    await logSignal({ userId, signalKeyId: key.id, masterAccountId: master.id, status: 'KILL_SWITCH', payload: req.body, error: 'Kill switch enabled', signal });
    return res.status(403).json({ error: 'Kill switch enabled — signals rejected' });
  }

  // 4. Resolve contract ID for the master's platform
  const normalizedTicker = normalizeTicker(signal.ticker) || signal.ticker;
  const contractInfo = getContractInfo(normalizedTicker);
  const contractId = resolveContractId(normalizedTicker, master.platform);

  // 5. Place order on master account (with token re-auth on 401)
  let masterOrderResult;
  try {
    masterOrderResult = await placeMasterOrder(master, signal, contractId);
  } catch (err) {
    await logSignal({ userId, signalKeyId: key.id, masterAccountId: master.id, status: 'MASTER_ORDER_FAILED', payload: req.body, error: err.message, signal });
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
  await logSignal({
    userId,
    signalKeyId: key.id,
    masterAccountId: master.id,
    status: 'EXECUTED',
    payload: req.body,
    signal,
    latencyMs: latency,
    masterOrderId: masterOrderResult?.orderId,
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

// ── Signal logging helper (writes to dedicated signal_events table) ──────────

async function logSignal({ userId, signalKeyId = null, masterAccountId = null, status, payload, error = null, signal = null, latencyMs = null, masterOrderId = null }) {
  try {
    const ticker = signal?.ticker || payload?.ticker || payload?.symbol || null;
    const action = signal?.action || null;
    const side = signal?.side || null;
    const qty = signal?.qty ?? (payload?.qty ? parseInt(payload.qty) : null);
    const price = signal?.price ?? (payload?.price ? parseFloat(payload.price) : null);
    const orderType = signal?.orderType || null;
    await query(
      `INSERT INTO signal_events
         (user_id, signal_key_id, master_account_id, status, ticker, action, side, qty, price, order_type, master_order_id, latency_ms, error, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [userId, signalKeyId, masterAccountId, status, ticker, action, side, qty, price, orderType, masterOrderId, latencyMs, error, payload ? JSON.stringify(payload) : null]
    );
  } catch (err) {
    console.error('[SIGNAL] Failed to log signal:', err.message);
  }
}

// ── Master order placement with token re-auth ───────────────────────────────

async function placeMasterOrder(master, signal, contractId) {
  let creds = decryptJSON(master.credentials_encrypted);

  if (master.platform === 'topstepx') {
    const orderBody = {
      accountId: parseInt(master.broker_account_id),
      contractId,
      type: signal.orderType === 'Market' ? 2 : signal.orderType === 'Limit' ? 1 : 4,
      side: signal.side === 'Buy' ? 0 : 1,
      size: signal.qty,
    };
    if (signal.orderType === 'Limit' && signal.price) orderBody.limitPrice = signal.price;
    if (signal.orderType === 'Stop' && signal.price) orderBody.stopPrice = signal.price;

    const doPlace = async (token) => {
      const r = await fetch('https://api.topstepx.com/api/Order/place', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'text/plain',
        },
        body: JSON.stringify(orderBody),
      });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };

    let { status, data } = await doPlace(creds.token);

    // Token expired? Re-auth using stored apiKey + username
    const looksExpired = status === 401 || data?.errorCode === 3 || /token|unauth|expired/i.test(data?.errorMessage || '');
    if (looksExpired && creds.apiKey && creds.username) {
      try {
        const authRes = await fetch('https://api.topstepx.com/api/Auth/loginKey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/plain' },
          body: JSON.stringify({ userName: creds.username, apiKey: creds.apiKey }),
        });
        const authData = await authRes.json();
        if (authData.success && authData.token) {
          creds.token = authData.token;
          await query(
            'UPDATE accounts SET credentials_encrypted = $1 WHERE id = $2',
            [encryptJSON(creds), master.id]
          );
          ({ status, data } = await doPlace(creds.token));
        } else {
          throw new Error(`Re-auth failed: ${authData.errorMessage || 'unknown'}`);
        }
      } catch (err) {
        throw new Error(`TopStepX session expired and re-auth failed: ${err.message}`);
      }
    }

    if (!data.success) {
      throw new Error(data.errorMessage || `Order rejected (code ${data.errorCode})`);
    }
    return { orderId: data.orderId, platform: 'topstepx' };
  }

  if (master.platform === 'tradovate') {
    const isLive = creds.isLive === true || creds.environment === 'live';
    const baseUrl = isLive ? 'https://live.tradovateapi.com/v1' : 'https://demo.tradovateapi.com/v1';
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
    if (orderRes.status === 401 || orderData.failureReason === 'Unauthorized') {
      throw new Error('Tradovate session expired — please reconnect your account');
    }
    if (orderData.failureReason) {
      throw new Error(orderData.failureReason);
    }
    return { orderId: orderData.orderId, platform: 'tradovate' };
  }

  throw new Error(`Signal execution not supported for platform: ${master.platform}`);
}

export default router;

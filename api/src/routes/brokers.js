import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// ─── Broker API Endpoints ────────────────────────────────────────────────────

const APIS = {
  tradovate: {
    demo: 'https://demo.tradovateapi.com/v1',
    live: 'https://live.tradovateapi.com/v1',
  },
  projectx: 'https://api.topstepx.com',
};

// ═══════════════════════════════════════════════════════════════════════════════
// TopStepX / ProjectX
// Auth: POST /api/Auth/loginKey { userName, apiKey } -> { token }
// Accounts: POST /api/Account/search { onlyActiveAccounts: true }
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/topstepx/auth', authRequired, async (req, res) => {
  const { username, apiKey } = req.body;
  if (!username || !apiKey) return res.status(400).json({ error: 'Username and API key required' });

  try {
    const r = await fetch(`${APIS.projectx}/api/Auth/loginKey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
      body: JSON.stringify({ userName: username, apiKey }),
    });
    const data = await r.json();
    if (!data.success || data.errorCode !== 0) {
      const errorMessages = {
        1: 'Server error on ProjectX. Try again in a moment.',
        2: 'Account locked or disabled. Contact TopStepX support.',
        3: 'Invalid credentials. Check your username (often your email) and API key.',
        4: 'API key expired. Generate a new key in your TopStepX dashboard.',
      };
      return res.status(401).json({
        error: 'auth_failed',
        message: data.errorMessage || errorMessages[data.errorCode] || `ProjectX rejected login (code ${data.errorCode}). Verify your username and API key.`,
        errorCode: data.errorCode,
      });
    }
    res.json({ token: data.token, platform: 'topstepx' });
  } catch (err) {
    res.status(502).json({ error: 'gateway_error', message: `ProjectX unreachable: ${err.message}` });
  }
});

router.post('/topstepx/accounts', authRequired, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const r = await fetch(`${APIS.projectx}/api/Account/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/plain', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ onlyActiveAccounts: true }),
    });
    const data = await r.json();
    if (!data.success) return res.status(401).json({ error: 'Failed to fetch accounts', message: data.errorMessage });

    res.json({
      accounts: (data.accounts || []).map(a => ({
        id: String(a.id), name: a.name, canTrade: a.canTrade,
        isVisible: a.isVisible, balance: a.balance, simulated: a.simulated,
      })),
    });
  } catch (err) {
    res.status(502).json({ error: 'gateway_error', message: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// Tradovate - OAuth Flow
// Step 1: GET /tradovate/auth-url -> returns the OAuth URL to redirect user to
// Step 2: Tradovate redirects to /tradovate/callback?code=XXX -> exchanges for token
// Step 3: POST /tradovate/accounts { token } -> fetches account list
// ═══════════════════════════════════════════════════════════════════════════════

import { config as appConfig } from '../config/index.js';

// Step 1: Generate the OAuth URL for the frontend to redirect to
router.post('/tradovate/auth', authRequired, async (req, res) => {
  const { environment } = req.body;
  const env = environment || 'demo';

  const clientId = appConfig.tradovate.clientId;
  if (!clientId) {
    return res.status(500).json({ error: 'Tradovate OAuth not configured. Missing CLIENT_ID.' });
  }

  const redirectUri = appConfig.tradovate.redirectUri;

  // Build the OAuth authorization URL
  const authUrl = `${appConfig.tradovate.authUrl}`
    + `?response_type=code`
    + `&client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.json({
    oauthUrl: authUrl,
    environment: env,
    platform: 'tradovate',
  });
});

// Step 2: OAuth callback - Tradovate redirects here with ?code=XXX
router.get('/tradovate/callback', async (req, res) => {
  const { code, error } = req.query;
  const frontendUrl = (appConfig.cors.origin || 'https://www.tradevanish.com') + '/app';

  if (error || !code) {
    return res.redirect(`${frontendUrl}?tradovate_error=${encodeURIComponent(error || 'no_code')}`);
  }

  try {
    // Exchange code for token - try demo first, then live
    let tokenData;
    for (const exchangeUrl of [appConfig.tradovate.demoExchangeUrl, appConfig.tradovate.liveExchangeUrl]) {
      const tokenRes = await fetch(exchangeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_uri: appConfig.tradovate.redirectUri,
          client_id: appConfig.tradovate.clientId,
          client_secret: appConfig.tradovate.clientSecret,
        }),
      });

      tokenData = await tokenRes.json();
      if (tokenData.access_token) break;
    }

    if (!tokenData.access_token) {
      return res.redirect(`${frontendUrl}?tradovate_error=${encodeURIComponent(tokenData.error_description || tokenData.error || 'token_exchange_failed')}`);
    }

    return res.redirect(`${frontendUrl}?tradovate_token=${encodeURIComponent(tokenData.access_token)}&tradovate_expires=${tokenData.expires_in || 5400}&tradovate_env=demo`);
  } catch (err) {
    return res.redirect(`${frontendUrl}?tradovate_error=${encodeURIComponent(err.message)}`);
  }
});

// Step 3: Fetch accounts using the OAuth token
router.post('/tradovate/accounts', authRequired, async (req, res) => {
  const { token, environment } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const baseUrl = environment === 'live' ? APIS.tradovate.live : APIS.tradovate.demo;

  try {
    const r = await fetch(`${baseUrl}/account/list`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!r.ok) return res.status(r.status).json({ error: 'Failed to fetch accounts' });
    const accounts = await r.json();

    res.json({
      accounts: accounts.map(a => ({
        id: String(a.id),
        name: a.name,
        nickname: a.nickname,
        balance: a.cashBalance,
        active: a.active,
        type: a.accountType === 'Customer' ? 'Live' : a.accountType || 'Demo',
      })),
    });
  } catch (err) {
    res.status(502).json({ error: 'gateway_error', message: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// Rithmic
// R|Protocol uses WebSocket + Protobuf. No REST API available.
// We validate credentials by attempting a WebSocket login server-side.
// The actual persistent connection happens via the listener service.
//
// For the connect flow, we accept and store credentials, then validate
// by attempting a handshake to the Rithmic server.
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/rithmic/auth', authRequired, async (req, res) => {
  const { username, password, environment, fcmId, ibId } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  // Rithmic server URLs by environment
  const servers = {
    'Rithmic Paper Trading': 'wss://rprotocol.rithmic.com:443',
    'Rithmic 01 (Live)': 'wss://rituz00100.rithmic.com:443',
    'Rithmic Demo': 'wss://rprotocol-demo.rithmic.com:443',
  };
  const serverUrl = servers[environment] || servers['Rithmic Paper Trading'];

  // Validate credentials by attempting a WebSocket login handshake
  try {
    const WebSocket = (await import('ws')).default;
    const result = await new Promise((resolve, reject) => {
      const ws = new WebSocket(serverUrl, { headers: { 'User-Agent': 'Tradevanish/1.0' } });
      const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Connection timeout')); }, 15000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          template_id: 10, // LOGIN_REQUEST
          user: username,
          password: password,
          app_name: 'Tradevanish',
          app_version: '1.0',
          system_name: environment || 'Rithmic Paper Trading',
          infra_type: 2,
          fcm_id: fcmId || undefined,
          ib_id: ibId || undefined,
        }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.template_id === 11) { // LOGIN_RESPONSE
            clearTimeout(timeout);
            ws.close();
            if (msg.rp_code === '0' || msg.rp_code === 0 || !msg.rp_code) {
              resolve({ success: true, accounts: msg.accounts || [] });
            } else {
              reject(new Error(msg.text_msg || `Login rejected (code ${msg.rp_code})`));
            }
          }
        } catch {}
      });

      ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
      ws.on('close', () => { clearTimeout(timeout); });
    });

    const sessionId = `rith_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    res.json({
      token: sessionId,
      serverUrl,
      platform: 'rithmic',
      accounts: result.accounts,
    });
  } catch (err) {
    res.status(401).json({
      error: 'auth_failed',
      message: `Rithmic authentication failed: ${err.message}`,
    });
  }
});

router.post('/rithmic/accounts', authRequired, async (req, res) => {
  const { token, username, environment, password, fcmId, ibId } = req.body;

  if (!token) return res.status(400).json({ error: 'Token required' });

  // Try to get accounts via WebSocket login
  try {
    const WebSocket = (await import('ws')).default;
    const servers = {
      'Rithmic Paper Trading': 'wss://rprotocol.rithmic.com:443',
      'Rithmic 01 (Live)': 'wss://rituz00100.rithmic.com:443',
      'Rithmic Demo': 'wss://rprotocol-demo.rithmic.com:443',
    };
    const serverUrl = servers[environment] || servers['Rithmic Paper Trading'];

    const accounts = await new Promise((resolve, reject) => {
      const ws = new WebSocket(serverUrl, { headers: { 'User-Agent': 'Tradevanish/1.0' } });
      const timeout = setTimeout(() => { ws.terminate(); resolve([]); }, 15000);
      const collected = [];

      ws.on('open', () => {
        ws.send(JSON.stringify({
          template_id: 10,
          user: username,
          password: password,
          app_name: 'Tradevanish',
          app_version: '1.0',
          system_name: environment || 'Rithmic Paper Trading',
          infra_type: 2,
          fcm_id: fcmId || undefined,
          ib_id: ibId || undefined,
        }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.template_id === 11 && msg.rp_code !== '0' && msg.rp_code !== 0 && msg.rp_code !== undefined) {
            clearTimeout(timeout); ws.close(); resolve([]);
          }
          if (msg.template_id === 11) {
            // After login, request account list
            ws.send(JSON.stringify({ template_id: 302, fcm_id: fcmId, ib_id: ibId }));
          }
          if (msg.template_id === 303) {
            if (msg.account_id) collected.push({ id: msg.account_id, name: msg.account_id, fcm_id: msg.fcm_id, ib_id: msg.ib_id });
            // Rithmic sends one message per account, with is_last flag
            if (msg.is_last) { clearTimeout(timeout); ws.close(); resolve(collected); }
          }
        } catch {}
      });

      ws.on('error', () => { clearTimeout(timeout); resolve([]); });
    });

    if (accounts.length > 0) {
      return res.json({
        accounts: accounts.map(a => ({
          id: a.id,
          name: a.name || `Rithmic ${a.id}`,
          balance: null,
          type: 'Rithmic',
          fcm_id: a.fcm_id,
          ib_id: a.ib_id,
        })),
      });
    }
  } catch {}

  // Fallback: return the basic account info
  res.json({
    accounts: [
      {
        id: `rith-${username || 'user'}`,
        name: `${username || 'Rithmic'} Trading Account`,
        balance: null,
        type: 'Rithmic',
        note: 'Account details loaded when listener connects',
      },
    ],
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// NinjaTrader
// Uses the same Tradovate OAuth flow (merged companies, same infrastructure).
// The /tradovate/callback handles both. NinjaTrader auth just redirects to same OAuth.
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/ninjatrader/auth', authRequired, async (req, res) => {
  // NinjaTrader uses the exact same Tradovate OAuth flow
  const clientId = appConfig.tradovate.clientId;
  if (!clientId) {
    return res.status(500).json({ error: 'OAuth not configured.' });
  }
  const redirectUri = appConfig.tradovate.redirectUri;
  const authUrl = `${appConfig.tradovate.authUrl}?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.json({ oauthUrl: authUrl, platform: 'ninjatrader' });
});

router.post('/ninjatrader/accounts', authRequired, async (req, res) => {
  const { token, environment } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const baseUrl = environment === 'live' ? APIS.tradovate.live : APIS.tradovate.demo;

  try {
    const r = await fetch(`${baseUrl}/account/list`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!r.ok) return res.status(r.status).json({ error: 'Failed to fetch accounts' });
    const accounts = await r.json();

    res.json({
      accounts: accounts.map(a => ({
        id: String(a.id),
        name: a.nickname || a.name,
        balance: a.cashBalance,
        active: a.active,
        type: 'NinjaTrader',
      })),
    });
  } catch (err) {
    res.status(502).json({ error: 'gateway_error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Account Stats (Balance, Equity, Trading Days, Win Rate)
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/stats', authRequired, async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: 'accountId required' });

  const acct = await query('SELECT * FROM accounts WHERE id = $1 AND user_id = $2', [accountId, req.user.id]);
  if (acct.rows.length === 0) return res.status(404).json({ error: 'Account not found' });

  const account = acct.rows[0];
  let creds;
  try { creds = JSON.parse(account.credentials_encrypted || '{}'); } catch { return res.status(400).json({ error: 'Invalid credentials' }); }

  if (account.platform === 'topstepx') {
    try {
      // Fetch account balance
      const acctRes = await fetch('https://api.topstepx.com/api/Account/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/plain', Authorization: `Bearer ${creds.token}` },
        body: JSON.stringify({ onlyActiveAccounts: true }),
      });
      const acctData = await acctRes.json();
      const brokerAcct = (acctData.accounts || []).find(a => String(a.id) === String(account.broker_account_id));

      // Fetch trade history
      const tradeRes = await fetch('https://api.topstepx.com/api/Trade/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/plain', Authorization: `Bearer ${creds.token}` },
        body: JSON.stringify({ accountId: parseInt(account.broker_account_id) }),
      });
      const tradeData = await tradeRes.json();
      const trades = tradeData.trades || [];

      const wins = trades.filter(t => t.profitAndLoss && t.profitAndLoss > 0);
      const losses = trades.filter(t => t.profitAndLoss && t.profitAndLoss < 0);
      const tradingDays = new Set(trades.map(t => t.creationTimestamp?.slice(0, 10)).filter(Boolean));
      const totalPnl = trades.reduce((s, t) => s + (t.profitAndLoss || 0), 0);
      const totalFees = trades.reduce((s, t) => s + (t.fees || 0), 0);

      res.json({
        balance: brokerAcct?.balance || null,
        equity: brokerAcct?.balance ? brokerAcct.balance : null,
        tradingDays: tradingDays.size,
        totalTrades: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: (wins.length + losses.length) > 0 ? Math.round(wins.length / (wins.length + losses.length) * 1000) / 10 : null,
        totalPnl: Math.round(totalPnl * 100) / 100,
        totalFees: Math.round(totalFees * 100) / 100,
        canTrade: brokerAcct?.canTrade || false,
      });
    } catch (err) {
      res.status(502).json({ error: 'Failed to fetch stats', message: err.message });
    }
  } else if (account.platform === 'tradovate') {
    try {
      const baseUrl = 'https://demo.tradovateapi.com/v1';
      const acctRes = await fetch(`${baseUrl}/account/list`, {
        headers: { Authorization: `Bearer ${creds.token}`, Accept: 'application/json' },
      });
      const accounts = await acctRes.json();
      const brokerAcct = accounts.find(a => String(a.id) === String(account.broker_account_id));

      res.json({
        balance: brokerAcct?.cashBalance || null,
        equity: brokerAcct?.cashBalance || null,
        tradingDays: null,
        totalTrades: null,
        wins: null,
        losses: null,
        winRate: null,
        totalPnl: null,
        totalFees: null,
        canTrade: brokerAcct?.active || false,
      });
    } catch (err) {
      res.status(502).json({ error: 'Failed to fetch stats', message: err.message });
    }
  } else {
    res.json({ balance: null, equity: null, tradingDays: null, winRate: null });
  }
});

export default router;

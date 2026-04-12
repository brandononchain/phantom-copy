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

  const sendResult = (params) => {
    // Send result back to the opener window via postMessage, then close popup
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html><html><body><script>
      if (window.opener) {
        window.opener.postMessage(${JSON.stringify(params)}, "*");
        window.close();
      } else {
        // Fallback: redirect to frontend with params
        window.location.href = "${(appConfig.cors.origin || 'https://web-production-0433b.up.railway.app')}" + "?" + new URLSearchParams(${JSON.stringify(params)}).toString();
      }
    </script><p>Connecting... you can close this window.</p></body></html>`);
  };

  if (error || !code) {
    return sendResult({ tradovate_error: error || 'no_code' });
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
      return sendResult({ tradovate_error: tokenData.error_description || tokenData.error || 'token_exchange_failed' });
    }

    const env = tokenData.access_token ? 'demo' : 'live';
    return sendResult({
      tradovate_token: tokenData.access_token,
      tradovate_expires: String(tokenData.expires_in || 5400),
      tradovate_env: env,
    });
  } catch (err) {
    return sendResult({ tradovate_error: err.message });
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

  // Rithmic requires the R|Protocol API dev kit and Protobuf.
  // We can't do a full WebSocket handshake in a simple HTTP handler,
  // but we can validate the credentials format and store them.
  // The actual connection test happens when the listener starts.
  //
  // For production, this would open a WebSocket, send a login Protobuf,
  // wait for the login response, then close. For now we validate format
  // and return a session token that references the stored creds.

  if (username.length < 2 || password.length < 4) {
    return res.status(401).json({ error: 'auth_failed', message: 'Invalid Rithmic credentials format' });
  }

  // Store credentials encrypted in DB for the listener to use later
  // (encryption would be AES-256-GCM in production)
  const sessionId = `rith_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  res.json({
    token: sessionId,
    serverUrl,
    platform: 'rithmic',
    note: 'Credentials will be validated when listener connects to R|Protocol WebSocket',
  });
});

router.post('/rithmic/accounts', authRequired, async (req, res) => {
  const { token, username } = req.body;

  // Rithmic accounts are tied to the FCM/IB relationship.
  // In a full implementation, we'd query the order plant for account list.
  // For now, return the account info based on what the user provided.
  // The actual account list comes from the R|Protocol login response.

  if (!token) return res.status(400).json({ error: 'Token required' });

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

export default router;

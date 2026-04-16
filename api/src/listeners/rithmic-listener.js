// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Rithmic Master Listener
// ─────────────────────────────────────────────────────────────────────────────
// Connects to Rithmic via R|Protocol WebSocket.
// Auth: Username + Password + FCM/IB IDs
// Real-time: WebSocket binary frames (Protobuf-like R|Protocol)
// Order placement: WebSocket order plant
//
// Rithmic has 4 separate server plants:
//   - Login (ticker_plant_url)  -> authentication
//   - Ticker Plant              -> market data (not needed for copy)
//   - Order Plant               -> order submission + position/order updates
//   - History Plant              -> historical data (not needed)
//
// For copy trading we only need Login + Order Plant.
// All connections route through the account's assigned residential proxy.
// ─────────────────────────────────────────────────────────────────────────────

import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent, fetch as undiFetch } from 'undici';
import { EventEmitter } from 'events';

// ─── Rithmic Server URLs ─────────────────────────────────────────────────────

const RITHMIC_SERVERS = {
  'Rithmic Paper Trading': {
    login: 'wss://rprotocol.rithmic.com:443',
    order: 'wss://rprotocol.rithmic.com:443',
  },
  'Rithmic 01 (Live)': {
    login: 'wss://rituz00100.rithmic.com:443',
    order: 'wss://rituz00100.rithmic.com:443',
  },
  'Rithmic Demo': {
    login: 'wss://rprotocol-demo.rithmic.com:443',
    order: 'wss://rprotocol-demo.rithmic.com:443',
  },
};

// ─── R|Protocol Message Types ────────────────────────────────────────────────
// Rithmic R|Protocol uses numbered template IDs for message types.
// These are the key ones for order plant operations.

const MSG = {
  // Login
  LOGIN_REQUEST: 10,
  LOGIN_RESPONSE: 11,
  LOGOUT_REQUEST: 12,
  HEARTBEAT: 18,

  // Account
  ACCOUNT_LIST_REQUEST: 302,
  ACCOUNT_LIST_RESPONSE: 303,

  // Orders
  ORDER_NEW: 312,
  ORDER_MODIFY: 314,
  ORDER_CANCEL: 316,
  ORDER_NOTIFICATION: 351,
  ORDER_FILL_NOTIFICATION: 352,

  // Positions
  POSITION_SNAPSHOT_REQUEST: 400,
  POSITION_SNAPSHOT: 401,
  POSITION_UPDATE: 450,

  // PnL
  PNL_UPDATE: 451,

  // Subscribe
  SUBSCRIBE_ORDER_UPDATES: 308,
  SUBSCRIBE_PNL_UPDATES: 404,
};

// ─── Proxy Agent Factory ─────────────────────────────────────────────────────

function createWsProxyAgent(proxyConfig) {
  if (!proxyConfig || proxyConfig.host === 'direct') return null;
  const url = `http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`;
  return new HttpsProxyAgent(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// RITHMIC MASTER LISTENER
// ─────────────────────────────────────────────────────────────────────────────

export class RithmicMasterListener extends EventEmitter {
  constructor({ username, password, fcmId, ibId, environment, accountId, proxyConfig, db }) {
    super();
    this.username = username;
    this.password = password;
    this.fcmId = fcmId;
    this.ibId = ibId;
    this.environment = environment || 'Rithmic Paper Trading';
    this.accountId = accountId; // Rithmic account ID (string like "DEMO12345")
    this.wsAgent = createWsProxyAgent(proxyConfig);
    this.httpProxyAgent = this.createUndiciAgent(proxyConfig);
    this.db = db;
    this.ws = null;
    this.positions = new Map();     // symbol -> position
    this.openOrders = new Map();    // orderId -> order
    this.connected = false;
    this.authenticated = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20;
    this.heartbeatInterval = null;
    this.requestId = 1;
  }

  createUndiciAgent(proxyConfig) {
    if (!proxyConfig || proxyConfig.host === 'direct') return null;
    const url = `http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`;
    return new ProxyAgent(url);
  }

  // ── Full startup sequence ───────────────────────────────────────────────

  async start() {
    try {
      // Stage 1: Verify proxy
      this.emit('stage', 'proxy');
      const ipOpts = { signal: AbortSignal.timeout(10000) };
      if (this.httpProxyAgent) ipOpts.dispatcher = this.httpProxyAgent;
      const ipCheck = await undiFetch('https://api.ipify.org?format=json', ipOpts);
      const { ip } = await ipCheck.json();
      this.emit('proxy-verified', { ip });

      // Stage 2: Connect to order plant WebSocket
      this.emit('stage', 'websocket');
      await this.connectWebSocket();

      // Stage 3: Authenticate
      this.emit('stage', 'auth');
      await this.authenticate();

      // Stage 4: Subscribe to order/position updates
      this.emit('stage', 'subscribe');
      await this.subscribeToUpdates();

      // Stage 5: Sync current positions
      this.emit('stage', 'sync');
      await this.syncPositions();

      // Start heartbeat
      this.startHeartbeat();

      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit('stage', 'listening');
      this.emit('ready', {
        positions: Array.from(this.positions.values()),
        openOrders: Array.from(this.openOrders.values()),
      });

    } catch (error) {
      this.emit('error', { stage: 'startup', error: error.message });
      await this.scheduleReconnect();
    }
  }

  // ── WebSocket Connection ────────────────────────────────────────────────

  connectWebSocket() {
    return new Promise((resolve, reject) => {
      const servers = RITHMIC_SERVERS[this.environment] || RITHMIC_SERVERS['Rithmic Paper Trading'];
      const wsUrl = servers.order;

      const wsOpts = {
        headers: {
          'User-Agent': 'Tradevanish/1.0',
        },
      };
      if (this.wsAgent) wsOpts.agent = this.wsAgent;

      this.ws = new WebSocket(wsUrl, wsOpts);

      const timeout = setTimeout(() => {
        this.ws.terminate();
        reject(new Error('Rithmic WebSocket connection timeout (15s)'));
      }, 15000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.emit('event', {
          type: 'websocket',
          msg: `Connected to Rithmic order plant (${this.environment})`,
        });
        resolve();
      });

      this.ws.on('message', (data) => this.handleMessage(data));

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        this.connected = false;
        this.authenticated = false;
        this.emit('event', {
          type: 'disconnect',
          msg: `Rithmic WebSocket closed: ${code} ${reason}`,
        });
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.emit('event', {
          type: 'error',
          msg: `Rithmic WebSocket error: ${err.message}`,
        });
      });
    });
  }

  // ── Authentication ──────────────────────────────────────────────────────
  // R|Protocol login sends a JSON envelope with template_id + credentials.
  // The actual R|Protocol uses Protobuf, but many Rithmic gateways also
  // accept JSON-wrapped messages for compatibility.

  authenticate() {
    return new Promise((resolve, reject) => {
      const loginMsg = {
        template_id: MSG.LOGIN_REQUEST,
        user: this.username,
        password: this.password,
        app_name: 'Tradevanish',
        app_version: '1.0',
        system_name: this.environment,
        infra_type: 2, // ORDER_PLANT
        fcm_id: this.fcmId || undefined,
        ib_id: this.ibId || undefined,
      };

      const loginTimeout = setTimeout(() => {
        reject(new Error('Rithmic login timeout (15s)'));
      }, 15000);

      // Store the resolve/reject for the login response handler
      this._loginResolve = (data) => {
        clearTimeout(loginTimeout);
        resolve(data);
      };
      this._loginReject = (err) => {
        clearTimeout(loginTimeout);
        reject(err);
      };

      this.sendMessage(loginMsg);
    });
  }

  // ── Subscribe to Real-Time Updates ──────────────────────────────────────

  async subscribeToUpdates() {
    // Subscribe to order updates for our account
    this.sendMessage({
      template_id: MSG.SUBSCRIBE_ORDER_UPDATES,
      account_id: this.accountId,
      fcm_id: this.fcmId,
      ib_id: this.ibId,
    });

    // Subscribe to PnL/position updates
    this.sendMessage({
      template_id: MSG.SUBSCRIBE_PNL_UPDATES,
      account_id: this.accountId,
      fcm_id: this.fcmId,
      ib_id: this.ibId,
    });

    this.emit('event', {
      type: 'subscribe',
      msg: `Subscribed to order + position updates for account ${this.accountId}`,
    });
  }

  // ── Sync Current Positions ──────────────────────────────────────────────

  async syncPositions() {
    this.sendMessage({
      template_id: MSG.POSITION_SNAPSHOT_REQUEST,
      account_id: this.accountId,
      fcm_id: this.fcmId,
      ib_id: this.ibId,
    });

    // Wait briefly for snapshot response
    await new Promise(r => setTimeout(r, 2000));

    this.emit('event', {
      type: 'sync',
      msg: `Synced ${this.positions.size} positions, ${this.openOrders.size} working orders`,
    });
  }

  // ── Message Handler ─────────────────────────────────────────────────────
  // R|Protocol messages come as binary Protobuf frames.
  // We parse the template_id to route each message type.

  handleMessage(data) {
    try {
      // R|Protocol frames can be binary (Protobuf) or JSON
      // Parse as JSON first (some Rithmic gateways support JSON mode)
      let msg;
      if (Buffer.isBuffer(data)) {
        // Try JSON parse first
        try {
          msg = JSON.parse(data.toString('utf8'));
        } catch {
          // Binary Protobuf frame — extract template_id from first 4 bytes
          msg = this.parseProtobufFrame(data);
        }
      } else {
        msg = JSON.parse(data.toString());
      }

      if (!msg || !msg.template_id) return;

      switch (msg.template_id) {
        case MSG.LOGIN_RESPONSE:
          this.handleLoginResponse(msg);
          break;
        case MSG.HEARTBEAT:
          // Respond with heartbeat
          this.sendMessage({ template_id: MSG.HEARTBEAT });
          break;
        case MSG.POSITION_SNAPSHOT:
          this.handlePositionSnapshot(msg);
          break;
        case MSG.POSITION_UPDATE:
          this.handlePositionUpdate(msg);
          break;
        case MSG.ORDER_NOTIFICATION:
          this.handleOrderNotification(msg);
          break;
        case MSG.ORDER_FILL_NOTIFICATION:
          this.handleFillNotification(msg);
          break;
        case MSG.PNL_UPDATE:
          this.handlePnlUpdate(msg);
          break;
        case MSG.ACCOUNT_LIST_RESPONSE:
          this.handleAccountList(msg);
          break;
      }
    } catch (err) {
      this.emit('event', {
        type: 'error',
        msg: `Message parse error: ${err.message}`,
      });
    }
  }

  // ── Parse binary Protobuf frame ─────────────────────────────────────────
  // R|Protocol Protobuf: first 4 bytes = message length, next 4 = template_id
  // Then field-tagged data. This is a minimal parser for the key fields.

  parseProtobufFrame(buf) {
    if (buf.length < 8) return null;

    const msgLen = buf.readUInt32BE(0);
    const templateId = buf.readUInt32BE(4);

    // Return a minimal object with the template_id
    // Full Protobuf parsing would use the .proto files from the Rithmic API kit
    return {
      template_id: templateId,
      _raw: buf.slice(8),
      _length: msgLen,
    };
  }

  // ── Login Response ──────────────────────────────────────────────────────

  handleLoginResponse(msg) {
    if (msg.rp_code === '0' || msg.rp_code === 0 || msg.rp_code === undefined) {
      this.authenticated = true;
      this.emit('event', {
        type: 'auth',
        msg: `Authenticated to Rithmic (${this.environment})`,
      });

      // Request account list
      this.sendMessage({
        template_id: MSG.ACCOUNT_LIST_REQUEST,
        fcm_id: this.fcmId,
        ib_id: this.ibId,
      });

      if (this._loginResolve) {
        this._loginResolve(msg);
        this._loginResolve = null;
      }
    } else {
      const errMsg = msg.text_msg || msg.rp_code || 'Login rejected';
      this.emit('event', {
        type: 'error',
        msg: `Rithmic login failed: ${errMsg}`,
      });
      if (this._loginReject) {
        this._loginReject(new Error(`Rithmic login failed: ${errMsg}`));
        this._loginReject = null;
      }
    }
  }

  // ── Account List ────────────────────────────────────────────────────────

  handleAccountList(msg) {
    const accounts = msg.accounts || [];
    this.emit('event', {
      type: 'sys',
      msg: `Rithmic accounts: ${accounts.map(a => a.account_id || a).join(', ') || 'from login'}`,
    });
  }

  // ── Position Snapshot ───────────────────────────────────────────────────

  handlePositionSnapshot(msg) {
    if (msg.account_id !== this.accountId) return;

    const symbol = msg.symbol || msg.ticker;
    if (!symbol) return;

    const qty = parseInt(msg.buy_qty || 0) - parseInt(msg.sell_qty || 0);

    if (qty !== 0) {
      this.positions.set(symbol, {
        symbol,
        accountId: msg.account_id,
        side: qty > 0 ? 'Buy' : 'Sell',
        qty: Math.abs(qty),
        avgPrice: parseFloat(msg.avg_open_fill_price || 0),
        timestamp: Date.now(),
      });
    }
  }

  // ── Position Update (the core copy trigger) ─────────────────────────────

  handlePositionUpdate(msg) {
    if (msg.account_id !== this.accountId) return;

    const symbol = msg.symbol || msg.ticker;
    if (!symbol) return;

    const newQty = parseInt(msg.buy_qty || 0) - parseInt(msg.sell_qty || 0);
    const prev = this.positions.get(symbol);
    const prevQty = prev ? prev.qty * (prev.side === 'Buy' ? 1 : -1) : 0;

    if (prevQty === newQty) return; // No change

    const delta = newQty - prevQty;

    // Update local state
    if (newQty === 0) {
      this.positions.delete(symbol);
    } else {
      this.positions.set(symbol, {
        symbol,
        accountId: msg.account_id,
        side: newQty > 0 ? 'Buy' : 'Sell',
        qty: Math.abs(newQty),
        avgPrice: parseFloat(msg.avg_open_fill_price || 0),
        timestamp: Date.now(),
      });
    }

    // Determine action
    let action;
    if (prevQty === 0 && newQty !== 0) action = 'OPEN';
    else if (prevQty !== 0 && newQty === 0) action = 'CLOSE';
    else if (Math.sign(prevQty) !== Math.sign(newQty)) action = 'REVERSE';
    else if (Math.abs(newQty) > Math.abs(prevQty)) action = 'SCALE_IN';
    else action = 'SCALE_OUT';

    const signal = {
      action,
      contractId: symbol,
      side: delta > 0 ? 'Buy' : 'Sell',
      qty: Math.abs(delta),
      price: parseFloat(msg.avg_open_fill_price || 0),
      timestamp: Date.now(),
      platform: 'rithmic',
      masterAccountId: this.accountId,
    };

    this.emit('event', {
      type: 'fill',
      msg: `${action} ${signal.side === 'Buy' ? 'LONG' : 'SHORT'} ${signal.qty} ${symbol} @ ${signal.price}`,
    });

    // THE COPY SIGNAL
    this.emit('copy-signal', signal);
  }

  // ── Order Notification ──────────────────────────────────────────────────

  handleOrderNotification(msg) {
    if (msg.account_id !== this.accountId) return;

    const orderId = msg.basket_id || msg.order_id;
    if (!orderId) return;

    const status = msg.status || msg.order_status;
    const prev = this.openOrders.get(orderId);

    if (['open', 'working', 'pending'].includes(String(status).toLowerCase())) {
      this.openOrders.set(orderId, msg);

      // New bracket order (stop/limit)?
      const orderType = (msg.order_type || '').toLowerCase();
      if (!prev && ['stop', 'limit', 'stop_limit', 'trailing_stop'].includes(orderType)) {
        this.emit('bracket-signal', {
          action: 'NEW_BRACKET',
          order: {
            type: msg.order_type,
            side: msg.buy_sell_type === '1' ? 'Buy' : 'Sell',
            qty: parseInt(msg.qty || 1),
            limitPrice: parseFloat(msg.limit_price || 0),
            stopPrice: parseFloat(msg.stop_price || 0),
            contractId: msg.symbol || msg.ticker,
          },
          platform: 'rithmic',
          timestamp: Date.now(),
        });
      }

      // Modified?
      if (prev) {
        const prevLimit = parseFloat(prev.limit_price || 0);
        const prevStop = parseFloat(prev.stop_price || 0);
        const newLimit = parseFloat(msg.limit_price || 0);
        const newStop = parseFloat(msg.stop_price || 0);
        if (prevLimit !== newLimit || prevStop !== newStop) {
          this.emit('bracket-signal', {
            action: 'MODIFY_BRACKET',
            order: {
              type: msg.order_type,
              side: msg.buy_sell_type === '1' ? 'Buy' : 'Sell',
              qty: parseInt(msg.qty || 1),
              limitPrice: newLimit,
              stopPrice: newStop,
              contractId: msg.symbol || msg.ticker,
              prevLimitPrice: prevLimit,
              prevStopPrice: prevStop,
            },
            platform: 'rithmic',
            timestamp: Date.now(),
          });
        }
      }
    }

    if (['filled', 'cancelled', 'rejected', 'expired'].includes(String(status).toLowerCase())) {
      this.openOrders.delete(orderId);
      if (String(status).toLowerCase() === 'cancelled' && prev) {
        this.emit('bracket-signal', {
          action: 'CANCEL_BRACKET',
          orderId,
          contractId: msg.symbol || msg.ticker,
          platform: 'rithmic',
          timestamp: Date.now(),
        });
      }
    }
  }

  // ── Fill Notification ───────────────────────────────────────────────────

  handleFillNotification(msg) {
    this.emit('event', {
      type: 'fill',
      msg: `Fill: ${msg.buy_sell_type === '1' ? 'BUY' : 'SELL'} ${msg.qty} @ ${msg.fill_price} (order ${msg.order_id})`,
    });

    this.emit('execution-report', {
      ...msg,
      platform: 'rithmic',
    });
  }

  // ── PnL Update ─────────────────────────────────────────────────────────

  handlePnlUpdate(msg) {
    if (msg.account_id !== this.accountId) return;
    // PnL updates are informational
    this.emit('event', {
      type: 'sys',
      msg: `PnL update: realized=$${msg.closed_pnl || 0} unrealized=$${msg.open_pnl || 0}`,
    });
  }

  // ── Send Message ────────────────────────────────────────────────────────

  sendMessage(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit('event', { type: 'error', msg: 'Cannot send: WebSocket not open' });
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendMessage({ template_id: MSG.HEARTBEAT });
      }
    }, 30000); // Rithmic heartbeat every 30s
  }

  // ── Reconnect ───────────────────────────────────────────────────────────

  async scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('event', { type: 'error', msg: 'Max reconnect attempts reached' });
      this.emit('stopped', { reason: 'max-reconnects' });
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.emit('event', {
      type: 'reconnect',
      msg: `Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`,
    });

    await new Promise(r => setTimeout(r, delay));
    await this.start();
  }

  // ── Stop ────────────────────────────────────────────────────────────────

  stop() {
    this.connected = false;
    this.authenticated = false;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.ws) {
      // Send logout before closing
      try {
        this.sendMessage({ template_id: MSG.LOGOUT_REQUEST });
      } catch {}
      this.ws.close(1000, 'Listener stopped by user');
      this.ws = null;
    }
    this.emit('stopped', { reason: 'user' });
    this.emit('event', { type: 'sys', msg: 'Rithmic listener stopped' });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Rithmic Copy Client (Follower)
// ─────────────────────────────────────────────────────────────────────────────
// Places orders on a Rithmic follower account via R|Protocol WebSocket.
// Each follower maintains its own WebSocket connection through its proxy.

export class RithmicCopyClient {
  constructor({ username, password, accountId, environment, proxyAgent }) {
    this.username = username;
    this.password = password;
    this.accountId = accountId;
    this.environment = environment || 'Rithmic Paper Trading';
    this.wsAgent = proxyAgent; // HttpsProxyAgent for ws
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this._pendingOrders = new Map();
    this._requestId = 1;
  }

  async connect() {
    if (this.connected && this.authenticated) return;

    const servers = RITHMIC_SERVERS[this.environment] || RITHMIC_SERVERS['Rithmic Paper Trading'];

    await new Promise((resolve, reject) => {
      const wsOpts = {};
      if (this.wsAgent) wsOpts.agent = this.wsAgent;

      this.ws = new WebSocket(servers.order, wsOpts);

      const timeout = setTimeout(() => {
        this.ws.terminate();
        reject(new Error('Rithmic follower connection timeout'));
      }, 15000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.template_id === MSG.LOGIN_RESPONSE) {
            if (msg.rp_code === '0' || msg.rp_code === 0 || !msg.rp_code) {
              this.authenticated = true;
            }
          }
          // Resolve pending order responses
          if (msg.template_id === MSG.ORDER_NOTIFICATION && msg._req_id) {
            const pending = this._pendingOrders.get(msg._req_id);
            if (pending) {
              this._pendingOrders.delete(msg._req_id);
              pending.resolve({ orderId: msg.order_id || msg.basket_id, platform: 'rithmic' });
            }
          }
        } catch {}
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.authenticated = false;
      });

      this.ws.on('error', (err) => reject(err));
    });

    // Authenticate
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Rithmic follower auth timeout')), 10000);

      const checkAuth = setInterval(() => {
        if (this.authenticated) {
          clearTimeout(timeout);
          clearInterval(checkAuth);
          resolve();
        }
      }, 100);

      this.ws.send(JSON.stringify({
        template_id: MSG.LOGIN_REQUEST,
        user: this.username,
        password: this.password,
        app_name: 'Tradevanish',
        app_version: '1.0',
        system_name: this.environment,
        infra_type: 2,
      }));
    });
  }

  async placeOrder({ contractId, side, qty, orderType, limitPrice, stopPrice }) {
    if (!this.connected || !this.authenticated) {
      await this.connect();
    }

    const reqId = this._requestId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingOrders.delete(reqId);
        reject(new Error('Rithmic order timeout (10s)'));
      }, 10000);

      this._pendingOrders.set(reqId, {
        resolve: (data) => { clearTimeout(timeout); resolve(data); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });

      const orderMsg = {
        template_id: MSG.ORDER_NEW,
        _req_id: reqId,
        account_id: this.accountId,
        symbol: contractId,
        exchange: 'CME', // Default; would resolve from contract service
        buy_sell_type: side === 'Buy' ? '1' : '2',
        qty: qty,
        order_type: orderType || 'Market',
        duration: 'DAY',
      };
      if (orderType === 'Limit' && limitPrice) orderMsg.limit_price = limitPrice;
      if (orderType === 'Stop' && stopPrice) orderMsg.stop_price = stopPrice;

      this.ws.send(JSON.stringify(orderMsg));
    });
  }

  disconnect() {
    if (this.ws) {
      try { this.ws.send(JSON.stringify({ template_id: MSG.LOGOUT_REQUEST })); } catch {}
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
  }
}

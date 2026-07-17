// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish Master Listener Service
// ─────────────────────────────────────────────────────────────────────────────
// This is the core backend service that:
//   1. Opens a proxied WebSocket to the master's broker
//   2. Authenticates using captured OAuth token or credentials
//   3. Subscribes to real-time order/position events
//   4. Syncs current open positions on connect
//   5. Fans out every master trade to follower accounts
//   6. Each follower order routes through its own proxy IP
//
// Supports: Tradovate (WebSocket + REST)
// ─────────────────────────────────────────────────────────────────────────────

import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent, fetch as undiFetch } from 'undici';
import { EventEmitter } from 'events';
import crypto from 'crypto';

// ─── Configuration ───────────────────────────────────────────────────────────

const TRADOVATE_ENDPOINTS = {
  live: { ws: 'wss://live.tradovateapi.com/v1/websocket', api: 'https://live.tradovateapi.com/v1' },
  demo: { ws: 'wss://demo.tradovateapi.com/v1/websocket', api: 'https://demo.tradovateapi.com/v1' },
};
const TRADOVATE_TOKEN_REFRESH_MS = 85 * 60 * 1000; // Refresh at 85 min (expires at 90)

// ─── Proxy Agent Factory ─────────────────────────────────────────────────────
// Creates an HTTP agent that routes all traffic through the assigned proxy

function createProxyAgent(proxyConfig) {
  // proxyConfig shape:
  // {
  //   host: 'brd.superproxy.io',
  //   port: 22225,
  //   username: 'brd-customer-XXXX-zone-residential-session-tv_acc01-country-us',
  //   password: 'proxy_password'
  // }
  const url = `http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`;
  return new HttpsProxyAgent(url);
}

// ─── Token Encryption ────────────────────────────────────────────────────────
// All broker tokens/credentials encrypted at rest with AES-256-GCM

const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY; // 32-byte hex from KMS

function encryptToken(plaintext) {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { encrypted, iv: iv.toString('hex'), tag };
}

function decryptToken(encrypted, ivHex, tagHex) {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRADOVATE MASTER LISTENER
// ─────────────────────────────────────────────────────────────────────────────

export class TradovateMasterListener extends EventEmitter {
  constructor({ accessToken, userId, accountId, proxyConfig, db, isLive = false }) {
    super();
    this.accessToken = accessToken;
    this.userId = userId;
    this.accountId = accountId; // Tradovate account ID (number)
    const endpoints = isLive ? TRADOVATE_ENDPOINTS.live : TRADOVATE_ENDPOINTS.demo;
    this.wsUrl = endpoints.ws;
    this.apiUrl = endpoints.api;
    this.wsProxyAgent = createProxyAgent(proxyConfig); // For ws library
    this.httpProxyAgent = this.createUnidiciAgent(proxyConfig); // For REST calls via undici
    this.db = db;
    this.ws = null;
    this.requestId = 1;
    this.pendingRequests = new Map();
    this.positions = new Map();     // symbol -> position
    this.openOrders = new Map();    // orderId -> order
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20;
    this.heartbeatInterval = null;
    this.tokenRefreshInterval = null;
  }

  createUnidiciAgent(proxyConfig) {
    if (!proxyConfig || proxyConfig.host === 'direct') return null;
    const url = `http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`;
    return new ProxyAgent(url);
  }

  // ── Stage 1: Connect through proxy ──────────────────────────────────────

  async start() {
    this.emit('stage', 'proxy');

    try {
      // Verify proxy is working before connecting to broker
      const ipOpts = { signal: AbortSignal.timeout(10000) };
      if (this.httpProxyAgent) ipOpts.dispatcher = this.httpProxyAgent;
      const proxyCheck = await undiFetch('https://api.ipify.org?format=json', ipOpts);
      const { ip } = await proxyCheck.json();
      this.emit('proxy-verified', { ip });

      // Open WebSocket through the proxy
      this.emit('stage', 'websocket');
      await this.connectWebSocket();

      // Authenticate the WebSocket
      this.emit('stage', 'auth');
      await this.authenticate();

      // Subscribe to position & order events
      this.emit('stage', 'subscribe');
      await this.subscribeToEvents();

      // Sync current open positions
      this.emit('stage', 'sync');
      await this.syncPositions();

      // Start heartbeat + token refresh timers
      this.startHeartbeat();
      this.startTokenRefresh();

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

  // ── Stage 2: WebSocket connection ───────────────────────────────────────

  connectWebSocket() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, {
        agent: this.wsProxyAgent, // All traffic routed through dedicated IP
        headers: {
          'User-Agent': 'Tradevanish/1.0',
        },
      });

      const timeout = setTimeout(() => {
        this.ws.terminate();
        reject(new Error('WebSocket connection timeout (15s)'));
      }, 15000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.emit('event', {
          type: 'websocket',
          msg: 'WebSocket connection established',
        });
        resolve();
      });

      this.ws.on('message', (data) => this.handleMessage(data.toString()));

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        this.connected = false;
        this.emit('event', {
          type: 'disconnect',
          msg: `WebSocket closed: ${code} ${reason}`,
        });
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.emit('event', {
          type: 'error',
          msg: `WebSocket error: ${err.message}`,
        });
      });
    });
  }

  // ── Stage 3: Authenticate the WebSocket ─────────────────────────────────
  //
  // Tradovate WebSocket frame format:
  //   "endpoint\nrequestId\n\nJSON_BODY"
  //
  // After connection, send an authorize frame with the OAuth access token.

  authenticate() {
    return this.sendRequest('authorize', '', this.accessToken);
  }

  // ── Stage 4: Subscribe to real-time events ──────────────────────────────
  //
  // user/syncrequest subscribes us to ALL real-time updates for this user:
  //   - Position changes (opened, closed, partial fills)
  //   - Order lifecycle (placed, working, filled, cancelled, rejected)
  //   - Account balance changes

  async subscribeToEvents() {
    // Subscribe to user-level sync (positions + orders)
    await this.sendRequest('user/syncrequest', JSON.stringify({
      users: [this.userId],
    }));

    // Also subscribe to specific account for execution reports
    await this.sendRequest(
      'user/syncrequest',
      JSON.stringify({ accounts: [this.accountId] })
    );

    this.emit('event', {
      type: 'subscribe',
      msg: `Subscribed to user ${this.userId} events`,
    });
  }

  // ── Stage 5: Sync current open positions ────────────────────────────────
  //
  // On connect (or reconnect), pull current state via REST to reconcile.
  // This catches any trades that happened during a disconnect gap.

  async syncPositions() {
    // GET /position/list via REST (through proxy)
    const positionsRes = await this.apiRequest('GET', '/position/list');

    for (const pos of positionsRes) {
      if (pos.netPos !== 0) {
        this.positions.set(pos.contractId, {
          contractId: pos.contractId,
          accountId: pos.accountId,
          symbol: pos.contractMaturityDate, // Need to resolve to symbol
          side: pos.netPos > 0 ? 'Buy' : 'Sell',
          qty: Math.abs(pos.netPos),
          avgPrice: pos.netPrice,
          timestamp: pos.timestamp,
        });
      }
    }

    // Also pull working orders
    const ordersRes = await this.apiRequest('GET', '/order/list');
    for (const order of ordersRes) {
      if (['Working', 'Accepted'].includes(order.ordStatus)) {
        this.openOrders.set(order.id, order);
      }
    }

    this.emit('event', {
      type: 'sync',
      msg: `Synced ${this.positions.size} positions, ${this.openOrders.size} working orders`,
    });
  }

  // ── Message Handler ─────────────────────────────────────────────────────
  //
  // Tradovate WebSocket pushes frames in this format:
  //   "a"                     → heartbeat (respond with same)
  //   "o"                     → open confirmation
  //   "entity/event\nid\n\n{}" → data frame
  //
  // Key events we watch for:
  //   position/item   → position changed (new fill or close)
  //   order/item      → order status update
  //   fill/item       → individual fill report
  //   executionReport → detailed fill with price

  handleMessage(raw) {
    // Heartbeat
    if (raw === 'a') {
      this.ws.send('[]'); // Respond to keep-alive
      this.emit('heartbeat');
      return;
    }

    // Open confirmation
    if (raw === 'o') return;

    // Parse structured frames
    // Tradovate sends arrays of frames: a][ [{...}, {...}] ]
    try {
      // Strip the leading "a[" wrapper if present
      let cleaned = raw;
      if (cleaned.startsWith('a[')) {
        cleaned = cleaned.slice(1);
      }

      const frames = JSON.parse(cleaned);

      for (const frame of frames) {
        if (frame.e === 'props') {
          this.handlePropsEvent(frame);
        } else if (frame.e === 'shutdown') {
          this.emit('event', { type: 'shutdown', msg: 'Server requested shutdown' });
          this.scheduleReconnect();
        }
      }
    } catch (e) {
      // Not JSON, try line-delimited format
      this.handleLineFrame(raw);
    }
  }

  handlePropsEvent(frame) {
    // frame.d contains entity type and data
    // frame.d.entityType: 'position', 'order', 'fill', 'executionReport'
    const { entityType, entity } = frame.d || {};

    switch (entityType) {
      case 'position':
        this.handlePositionUpdate(entity);
        break;
      case 'order':
        this.handleOrderUpdate(entity);
        break;
      case 'fill':
        this.handleFillEvent(entity);
        break;
      case 'executionReport':
        this.handleExecutionReport(entity);
        break;
    }
  }

  handleLineFrame(raw) {
    const lines = raw.split('\n');
    if (lines.length < 1) return;

    const endpoint = lines[0];
    const requestId = lines[1];
    const body = lines.slice(3).join('\n');

    // Resolve pending requests
    if (requestId && this.pendingRequests.has(parseInt(requestId))) {
      const { resolve } = this.pendingRequests.get(parseInt(requestId));
      this.pendingRequests.delete(parseInt(requestId));
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(body);
      }
    }

    // Handle entity updates from sync subscription
    if (endpoint.includes('position/')) {
      try { this.handlePositionUpdate(JSON.parse(body)); } catch {}
    }
    if (endpoint.includes('order/')) {
      try { this.handleOrderUpdate(JSON.parse(body)); } catch {}
    }
  }

  // ── Position Change Handler ─────────────────────────────────────────────
  //
  // This is the core trigger. When the master's position changes,
  // we determine WHAT changed and emit a copy signal.

  handlePositionUpdate(pos) {
    if (!pos || pos.accountId !== this.accountId) return;

    const prevPos = this.positions.get(pos.contractId);
    const prevQty = prevPos ? prevPos.qty * (prevPos.side === 'Buy' ? 1 : -1) : 0;
    const newQty = pos.netPos || 0;

    if (prevQty === newQty) return; // No actual change

    const delta = newQty - prevQty;

    // Update local state
    if (newQty === 0) {
      this.positions.delete(pos.contractId);
    } else {
      this.positions.set(pos.contractId, {
        contractId: pos.contractId,
        accountId: pos.accountId,
        side: newQty > 0 ? 'Buy' : 'Sell',
        qty: Math.abs(newQty),
        avgPrice: pos.netPrice,
        timestamp: pos.timestamp,
      });
    }

    // Determine trade action
    let action;
    if (prevQty === 0 && newQty !== 0) {
      action = 'OPEN';
    } else if (prevQty !== 0 && newQty === 0) {
      action = 'CLOSE';
    } else if (Math.sign(prevQty) !== Math.sign(newQty)) {
      action = 'REVERSE';
    } else if (Math.abs(newQty) > Math.abs(prevQty)) {
      action = 'SCALE_IN';
    } else {
      action = 'SCALE_OUT';
    }

    const signal = {
      action,
      contractId: pos.contractId,
      side: delta > 0 ? 'Buy' : 'Sell',
      qty: Math.abs(delta),
      price: pos.netPrice,
      timestamp: Date.now(),
      platform: 'tradovate',
      masterAccountId: this.accountId,
      prevPosition: prevPos || null,
      newPosition: newQty === 0 ? null : this.positions.get(pos.contractId),
    };

    this.emit('event', {
      type: 'fill',
      msg: `${action} ${signal.side} ${signal.qty} @ ${signal.price}`,
    });

    // THIS IS THE COPY SIGNAL
    // The CopyExecutor listens for this and fans out to all followers
    this.emit('copy-signal', signal);
  }

  // ── Order Update Handler ────────────────────────────────────────────────
  //
  // Tracks working orders (stops, limits, brackets) so we can
  // replicate them to followers.

  handleOrderUpdate(order) {
    if (!order || order.accountId !== this.accountId) return;

    const prevOrder = this.openOrders.get(order.id);

    switch (order.ordStatus) {
      case 'Working':
      case 'Accepted':
        this.openOrders.set(order.id, order);

        // If this is a NEW stop/limit, replicate to followers
        if (!prevOrder) {
          this.emit('bracket-signal', {
            action: 'NEW_BRACKET',
            order: {
              type: order.ordType,         // 'Stop', 'Limit', 'StopLimit'
              side: order.action,           // 'Buy' or 'Sell'
              qty: order.orderQty,
              price: order.price,
              stopPrice: order.stopPrice,
              contractId: order.contractId,
            },
            timestamp: Date.now(),
          });
          this.emit('event', {
            type: 'bracket',
            msg: `${order.ordType} ${order.action} ${order.orderQty} @ ${order.price || order.stopPrice}`,
          });
        }

        // If existing order was MODIFIED (stop moved, etc.)
        if (prevOrder && (prevOrder.price !== order.price || prevOrder.stopPrice !== order.stopPrice)) {
          this.emit('bracket-signal', {
            action: 'MODIFY_BRACKET',
            order: {
              type: order.ordType,
              side: order.action,
              qty: order.orderQty,
              price: order.price,
              stopPrice: order.stopPrice,
              contractId: order.contractId,
              prevPrice: prevOrder.price,
              prevStopPrice: prevOrder.stopPrice,
            },
            timestamp: Date.now(),
          });
          this.emit('event', {
            type: 'modify',
            msg: `${order.ordType} moved: ${prevOrder.stopPrice || prevOrder.price} → ${order.stopPrice || order.price}`,
          });
        }
        break;

      case 'Filled':
      case 'Cancelled':
      case 'Rejected':
        this.openOrders.delete(order.id);
        if (order.ordStatus === 'Cancelled') {
          this.emit('bracket-signal', {
            action: 'CANCEL_BRACKET',
            orderId: order.id,
            contractId: order.contractId,
            timestamp: Date.now(),
          });
        }
        break;
    }
  }

  // ── Fill Event (detailed execution report) ──────────────────────────────

  handleFillEvent(fill) {
    this.emit('event', {
      type: 'fill',
      msg: `Fill: ${fill.action} ${fill.qty} @ ${fill.price} (order ${fill.orderId})`,
    });
  }

  handleExecutionReport(report) {
    // Execution reports contain the most detailed fill info
    // including exact timestamps from the exchange
    this.emit('execution-report', report);
  }

  // ── REST API calls (through proxy) ──────────────────────────────────────

  async apiRequest(method, path, body) {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    };
    if (this.httpProxyAgent) opts.dispatcher = this.httpProxyAgent;

    const response = await undiFetch(`${this.apiUrl}${path}`, opts);

    if (!response.ok) {
      throw new Error(`Tradovate API ${method} ${path}: ${response.status}`);
    }

    return response.json();
  }

  // ── WebSocket send helper ───────────────────────────────────────────────

  sendRequest(endpoint, body, rawBody) {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, { resolve, reject });

      // Tradovate frame format: "endpoint\nrequestId\n\nbody"
      const frame = rawBody
        ? `${endpoint}\n${id}\n\n${rawBody}`
        : `${endpoint}\n${id}\n\n${body}`;

      this.ws.send(frame);

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${endpoint}`));
        }
      }, 10000);
    });
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('[]');
      }
    }, 2500); // Tradovate expects heartbeat every 2.5s
  }

  // ── Token Refresh ───────────────────────────────────────────────────────
  //
  // Tradovate OAuth tokens expire at 90 minutes.
  // We refresh at 85 minutes to avoid any gap.

  startTokenRefresh() {
    this.tokenRefreshInterval = setInterval(async () => {
      try {
        const response = await this.apiRequest('POST', '/auth/renewaccesstoken');
        this.accessToken = response.accessToken;

        // Re-authenticate the WebSocket with new token
        await this.authenticate();

        // Store refreshed token (encrypted)
        const { encrypted, iv, tag } = encryptToken(this.accessToken);
        await this.db.updateAccountToken(this.accountId, encrypted, iv, tag);

        this.emit('event', {
          type: 'token-refresh',
          msg: 'OAuth token refreshed successfully',
        });
      } catch (error) {
        this.emit('event', {
          type: 'error',
          msg: `Token refresh failed: ${error.message}`,
        });
      }
    }, TRADOVATE_TOKEN_REFRESH_MS);
  }

  // ── Reconnect Logic ─────────────────────────────────────────────────────

  async scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('event', {
        type: 'error',
        msg: 'Max reconnect attempts reached. Listener stopped.',
      });
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

  // ── Cleanup ─────────────────────────────────────────────────────────────

  stop() {
    this.connected = false;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.tokenRefreshInterval) clearInterval(this.tokenRefreshInterval);
    if (this.ws) {
      this.ws.close(1000, 'Listener stopped by user');
      this.ws = null;
    }
    this.emit('stopped', { reason: 'user' });
    this.emit('event', { type: 'shutdown', msg: 'Master listener stopped' });
  }
}

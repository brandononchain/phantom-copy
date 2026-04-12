// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: ProjectX (TopStepX) Master Listener
// ─────────────────────────────────────────────────────────────────────────────
// Connects to the ProjectX Gateway API via SignalR User Hub.
// Auth: Username + API key -> JWT token (24h expiry)
// Real-time: SignalR (Microsoft) over WebSocket
// Order placement: REST POST /api/Order/place
//
// All connections route through the account's assigned residential proxy.
// ─────────────────────────────────────────────────────────────────────────────

import { HubConnectionBuilder, HttpTransportType } from '@microsoft/signalr';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { EventEmitter } from 'events';

const PROJECTX_API    = 'https://api.topstepx.com';
const PROJECTX_USER_HUB = 'https://rtc.thefuturesdesk.projectx.com/hubs/user';
const TOKEN_REFRESH_MS  = 23 * 60 * 60 * 1000; // 23 hours (tokens last 24h)

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function authenticateProjectX(username, apiKey, proxyAgent) {
  const response = await fetch(`${PROJECTX_API}/api/Auth/loginKey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/plain' },
    body: JSON.stringify({ userName: username, apiKey }),
    agent: proxyAgent,
  });

  const data = await response.json();

  if (!data.success || data.errorCode !== 0) {
    throw new Error(`ProjectX auth failed: ${data.errorMessage || 'Unknown error'}`);
  }

  return data.token; // JWT session token
}

// ─── Validate Session ────────────────────────────────────────────────────────

export async function validateSession(token, proxyAgent) {
  const response = await fetch(`${PROJECTX_API}/api/Auth/validate`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/plain',
    },
    agent: proxyAgent,
  });

  return response.ok;
}

// ─── Master Listener ─────────────────────────────────────────────────────────

export class ProjectXMasterListener extends EventEmitter {
  constructor({ username, apiKey, accountId, proxyConfig, db }) {
    super();
    this.username = username;
    this.apiKey = apiKey;
    this.accountId = accountId; // ProjectX account ID (number)
    this.proxyAgent = this.createAgent(proxyConfig);
    this.db = db;
    this.token = null;
    this.connection = null;
    this.positions = new Map();
    this.openOrders = new Map();
    this.connected = false;
    this.reconnectAttempts = 0;
    this.tokenRefreshInterval = null;
  }

  createAgent(proxyConfig) {
    const url = `http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`;
    return new HttpsProxyAgent(url);
  }

  // ── Full startup sequence ───────────────────────────────────────────────

  async start() {
    try {
      // Stage 1: Proxy
      this.emit('stage', 'proxy');
      const ipCheck = await fetch('https://api.ipify.org?format=json', {
        agent: this.proxyAgent,
        signal: AbortSignal.timeout(10000),
      });
      const { ip } = await ipCheck.json();
      this.emit('proxy-verified', { ip });

      // Stage 2: Authenticate
      this.emit('stage', 'auth');
      this.token = await authenticateProjectX(this.username, this.apiKey, this.proxyAgent);
      this.emit('event', { type: 'ws', msg: 'JWT token validated by ProjectX Gateway' });

      // Stage 3: Connect SignalR User Hub
      this.emit('stage', 'websocket');
      await this.connectSignalR();

      // Stage 4: Subscribe to events
      this.emit('stage', 'subscribe');
      await this.subscribeToEvents();

      // Stage 5: Sync positions
      this.emit('stage', 'sync');
      await this.syncPositions();

      // Start token refresh
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

  // ── SignalR Connection ──────────────────────────────────────────────────
  //
  // ProjectX uses Microsoft SignalR over WebSocket.
  // The User Hub provides real-time updates for:
  //   - GatewayUserAccount  (account status, balance)
  //   - GatewayUserOrder    (order lifecycle)
  //   - GatewayUserPosition (position changes)
  //   - GatewayUserTrade    (fill/trade events)

  async connectSignalR() {
    const hubUrl = `${PROJECTX_USER_HUB}?access_token=${this.token}`;

    this.connection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        skipNegotiation: true,
        transport: HttpTransportType.WebSockets,
        accessTokenFactory: () => this.token,
        timeout: 15000,
        // Route through proxy
        httpClient: {
          // Custom HTTP client that uses our proxy agent
          post: async (url, httpRequest) => {
            const res = await fetch(url, {
              method: 'POST',
              headers: httpRequest.headers,
              body: httpRequest.content,
              agent: this.proxyAgent,
            });
            return {
              statusCode: res.status,
              statusText: res.statusText,
              content: await res.text(),
            };
          },
        },
      })
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext) => {
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
          return Math.min(1000 * Math.pow(2, retryContext.previousRetryCount), 30000);
        },
      })
      .build();

    // Wire up event handlers BEFORE starting
    this.wireEventHandlers();

    await this.connection.start();
    this.emit('event', { type: 'ws', msg: 'SignalR User Hub connected' });

    // Handle reconnection
    this.connection.onreconnecting((error) => {
      this.connected = false;
      this.emit('event', { type: 'reconnect', msg: `SignalR reconnecting: ${error?.message || 'connection lost'}` });
    });

    this.connection.onreconnected((connectionId) => {
      this.connected = true;
      this.emit('event', { type: 'sys', msg: 'SignalR reconnected' });
      // Re-subscribe after reconnection
      this.subscribeToEvents();
    });

    this.connection.onclose((error) => {
      this.connected = false;
      this.emit('event', { type: 'error', msg: `SignalR closed: ${error?.message || 'unknown'}` });
      this.scheduleReconnect();
    });
  }

  // ── Event Handlers ──────────────────────────────────────────────────────

  wireEventHandlers() {
    // Position updates (the core copy trigger)
    this.connection.on('GatewayUserPosition', (data) => {
      this.handlePositionUpdate(data);
    });

    // Order updates (for bracket/stop replication)
    this.connection.on('GatewayUserOrder', (data) => {
      this.handleOrderUpdate(data);
    });

    // Trade/fill events
    this.connection.on('GatewayUserTrade', (data) => {
      this.handleTradeEvent(data);
    });

    // Account updates (balance, canTrade status)
    this.connection.on('GatewayUserAccount', (data) => {
      this.emit('event', {
        type: 'sys',
        msg: `Account update: balance=$${data.balance?.toFixed(2)}, canTrade=${data.canTrade}`,
      });

      // If account gets locked (risk violation), emit kill signal
      if (data.canTrade === false) {
        this.emit('event', { type: 'error', msg: 'Account trading disabled by firm (risk violation)' });
        this.emit('kill-signal', { reason: 'account-locked', accountId: data.id });
      }
    });
  }

  // ── Subscribe ───────────────────────────────────────────────────────────

  async subscribeToEvents() {
    await this.connection.invoke('SubscribeAccounts');
    await this.connection.invoke('SubscribeOrders', this.accountId);
    await this.connection.invoke('SubscribePositions', this.accountId);
    await this.connection.invoke('SubscribeTrades', this.accountId);

    this.emit('event', {
      type: 'ws',
      msg: `Subscribed to account ${this.accountId} events (Orders, Positions, Trades)`,
    });
  }

  // ── Position Handler ────────────────────────────────────────────────────
  //
  // GatewayUserPosition payload:
  // { id, accountId, contractId, type (1=Long, 2=Short), size, averagePrice }
  //
  // When a position changes, we compute the delta and emit a copy signal.

  handlePositionUpdate(pos) {
    if (pos.accountId !== this.accountId) return;

    const prev = this.positions.get(pos.contractId);
    const prevQty = prev ? prev.size * (prev.type === 1 ? 1 : -1) : 0;
    const newQty = (pos.size || 0) * (pos.type === 1 ? 1 : pos.type === 2 ? -1 : 0);

    if (prevQty === newQty) return;

    const delta = newQty - prevQty;

    // Update local state
    if (pos.size === 0 || pos.type === 0) {
      this.positions.delete(pos.contractId);
    } else {
      this.positions.set(pos.contractId, pos);
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
      contractId: pos.contractId,
      side: delta > 0 ? 'Buy' : 'Sell',
      qty: Math.abs(delta),
      price: pos.averagePrice,
      timestamp: Date.now(),
      platform: 'topstepx',
      masterAccountId: this.accountId,
    };

    this.emit('event', {
      type: 'fill',
      msg: `${action} ${signal.side === 'Buy' ? 'LONG' : 'SHORT'} ${signal.qty} ${pos.contractId} @ ${signal.price}`,
    });

    // THE COPY SIGNAL
    this.emit('copy-signal', signal);
  }

  // ── Order Handler ───────────────────────────────────────────────────────
  //
  // GatewayUserOrder payload:
  // { id, accountId, contractId, status, type, side, size, limitPrice, stopPrice }
  //
  // OrderStatus: 0=None, 1=Open, 2=Filled, 3=Cancelled, 4=Expired, 5=Rejected, 6=Pending
  // OrderType: 1=Limit, 2=Market, 3=StopLimit, 4=Stop, 5=TrailingStop

  handleOrderUpdate(order) {
    if (order.accountId !== this.accountId) return;

    const prev = this.openOrders.get(order.id);

    if (order.status === 1 || order.status === 6) { // Open or Pending
      this.openOrders.set(order.id, order);

      if (!prev && [3, 4, 5].includes(order.type)) {
        // New stop/limit/trailing stop -> replicate bracket
        this.emit('bracket-signal', {
          action: 'NEW_BRACKET',
          order: {
            type: order.type === 4 ? 'Stop' : order.type === 3 ? 'StopLimit' : order.type === 5 ? 'TrailingStop' : 'Limit',
            side: order.side === 0 ? 'Buy' : 'Sell', // ProjectX: 0=Bid, 1=Ask
            qty: order.size,
            limitPrice: order.limitPrice,
            stopPrice: order.stopPrice,
            contractId: order.contractId,
          },
          platform: 'topstepx',
          timestamp: Date.now(),
        });
      }

      // Check for modifications
      if (prev && (prev.limitPrice !== order.limitPrice || prev.stopPrice !== order.stopPrice)) {
        this.emit('bracket-signal', {
          action: 'MODIFY_BRACKET',
          order: {
            type: order.type === 4 ? 'Stop' : 'Limit',
            side: order.side === 0 ? 'Buy' : 'Sell',
            qty: order.size,
            limitPrice: order.limitPrice,
            stopPrice: order.stopPrice,
            contractId: order.contractId,
            prevLimitPrice: prev.limitPrice,
            prevStopPrice: prev.stopPrice,
          },
          platform: 'topstepx',
          timestamp: Date.now(),
        });
        this.emit('event', {
          type: 'modify',
          msg: `Order modified: ${prev.stopPrice || prev.limitPrice} -> ${order.stopPrice || order.limitPrice}`,
        });
      }
    }

    if ([2, 3, 4, 5].includes(order.status)) { // Filled, Cancelled, Expired, Rejected
      this.openOrders.delete(order.id);

      if (order.status === 3 && prev) {
        this.emit('bracket-signal', {
          action: 'CANCEL_BRACKET',
          orderId: order.id,
          contractId: order.contractId,
          platform: 'topstepx',
          timestamp: Date.now(),
        });
      }
    }
  }

  // ── Trade/Fill Handler ──────────────────────────────────────────────────

  handleTradeEvent(trade) {
    if (trade.accountId !== this.accountId) return;

    this.emit('event', {
      type: 'fill',
      msg: `Fill: ${trade.side === 0 ? 'BUY' : 'SELL'} ${trade.size} @ ${trade.price} (P&L: $${trade.profitAndLoss?.toFixed(2) || '0.00'})`,
    });

    this.emit('execution-report', {
      ...trade,
      platform: 'topstepx',
    });
  }

  // ── Position Sync ───────────────────────────────────────────────────────

  async syncPositions() {
    // GET positions via REST
    const posRes = await this.apiRequest('POST', '/api/Position/search', {
      accountId: this.accountId,
    });

    if (posRes.positions) {
      for (const pos of posRes.positions) {
        if (pos.size > 0) {
          this.positions.set(pos.contractId, pos);
        }
      }
    }

    // GET open orders
    const orderRes = await this.apiRequest('POST', '/api/Order/search', {
      accountId: this.accountId,
    });

    if (orderRes.orders) {
      for (const order of orderRes.orders) {
        if (order.status === 1) { // Open
          this.openOrders.set(order.id, order);
        }
      }
    }

    this.emit('event', {
      type: 'rest',
      msg: `Synced ${this.positions.size} positions, ${this.openOrders.size} working orders`,
    });
  }

  // ── REST Helper ─────────────────────────────────────────────────────────

  async apiRequest(method, path, body) {
    const response = await fetch(`${PROJECTX_API}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'text/plain',
      },
      body: body ? JSON.stringify(body) : undefined,
      agent: this.proxyAgent,
    });

    if (!response.ok) {
      throw new Error(`ProjectX API ${method} ${path}: ${response.status}`);
    }

    return response.json();
  }

  // ── Token Refresh ───────────────────────────────────────────────────────

  startTokenRefresh() {
    this.tokenRefreshInterval = setInterval(async () => {
      try {
        // Re-authenticate to get a fresh 24h token
        this.token = await authenticateProjectX(this.username, this.apiKey, this.proxyAgent);
        this.emit('event', { type: 'sys', msg: 'JWT token refreshed (24h)' });
      } catch (error) {
        this.emit('event', { type: 'error', msg: `Token refresh failed: ${error.message}` });
      }
    }, TOKEN_REFRESH_MS);
  }

  // ── Reconnect ───────────────────────────────────────────────────────────

  async scheduleReconnect() {
    if (this.reconnectAttempts >= 20) {
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
    if (this.tokenRefreshInterval) clearInterval(this.tokenRefreshInterval);
    if (this.connection) {
      this.connection.stop();
      this.connection = null;
    }
    this.emit('stopped', { reason: 'user' });
    this.emit('event', { type: 'sys', msg: 'ProjectX listener stopped' });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// ProjectX Copy Client (Follower)
// ─────────────────────────────────────────────────────────────────────────────
// Places orders on a TopStepX follower account through its dedicated proxy.

export class ProjectXCopyClient {
  constructor({ token, accountId, proxyAgent }) {
    this.token = token;
    this.accountId = accountId;
    this.agent = proxyAgent;
  }

  // ProjectX order sides: 0=Bid(Buy), 1=Ask(Sell)
  // ProjectX order types: 1=Limit, 2=Market, 3=StopLimit, 4=Stop, 5=TrailingStop

  async placeOrder({ contractId, side, qty, orderType = 'Market', limitPrice, stopPrice }) {
    const typeMap = { Market: 2, Limit: 1, Stop: 4, StopLimit: 3, TrailingStop: 5 };
    const sideMap = { Buy: 0, Sell: 1 }; // ProjectX: Bid=0(Buy), Ask=1(Sell)

    const body = {
      accountId: this.accountId,
      contractId,
      type: typeMap[orderType] || 2,
      side: sideMap[side] || 0,
      size: qty,
    };

    if (limitPrice) body.limitPrice = limitPrice;
    if (stopPrice) body.stopPrice = stopPrice;

    const response = await fetch(`${PROJECTX_API}/api/Order/place`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'text/plain',
      },
      body: JSON.stringify(body),
      agent: this.agent, // Routes through follower's unique proxy IP
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(`Order failed: ${data.errorMessage || `errorCode ${data.errorCode}`}`);
    }

    return {
      orderId: data.orderId,
      platform: 'topstepx',
    };
  }

  async modifyOrder({ orderId, size, limitPrice, stopPrice }) {
    const response = await fetch(`${PROJECTX_API}/api/Order/modify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderId, size, limitPrice, stopPrice }),
      agent: this.agent,
    });

    return response.json();
  }

  async cancelOrder(orderId) {
    const response = await fetch(`${PROJECTX_API}/api/Order/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderId }),
      agent: this.agent,
    });

    return response.json();
  }

  async getAccounts() {
    const response = await fetch(`${PROJECTX_API}/api/Account/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ onlyActiveAccounts: true }),
      agent: this.agent,
    });

    const data = await response.json();
    return data.accounts || [];
  }
}

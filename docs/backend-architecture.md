# PhantomCopy Backend Architecture

## System Overview

PhantomCopy is a copy trading platform with built-in IP isolation. Users connect broker accounts through embedded OAuth flows (no API keys, no code), and the system assigns each account a dedicated residential proxy. Master trades replicate to all followers in sub-50ms, with every follower's API traffic routed through its unique masked IP.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          PhantomCopy Cloud                              │
│                                                                         │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────────────┐   │
│  │  Dashboard   │◄──►│  API Gateway  │◄──►│     Service Layer         │   │
│  │  (Next.js)   │    │  (Express)   │    │                           │   │
│  └─────────────┘    └──────────────┘    │  ┌─────────────────────┐  │   │
│                                          │  │  Auth Service        │  │   │
│                                          │  │  (OAuth + Sessions)  │  │   │
│                                          │  └─────────────────────┘  │   │
│                                          │  ┌─────────────────────┐  │   │
│                                          │  │  Copy Engine         │  │   │
│                                          │  │  (WebSocket Relay)   │  │   │
│                                          │  └─────────────────────┘  │   │
│                                          │  ┌─────────────────────┐  │   │
│                                          │  │  Proxy Manager       │  │   │
│                                          │  │  (IP Assignment)     │  │   │
│                                          │  └─────────────────────┘  │   │
│                                          │  ┌─────────────────────┐  │   │
│                                          │  │  Risk Engine         │  │   │
│                                          │  │  (Per-Account Rules) │  │   │
│                                          │  └─────────────────────┘  │   │
│                                          └───────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     Proxy Layer (SOCKS5/HTTP)                    │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │    │
│  │  │ IP: .43  │ │ IP: .91  │ │ IP: .17  │ │ IP: .62  │  ...     │    │
│  │  │ Acc #1   │ │ Acc #2   │ │ Acc #3   │ │ Acc #4   │          │    │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │    │
│  └───────┼─────────────┼─────────────┼─────────────┼──────────────┘    │
└──────────┼─────────────┼─────────────┼─────────────┼──────────────────┘
           │             │             │             │
           ▼             ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
    │Tradovate │  │Tradovate │  │ Rithmic  │  │Tradovate │
    │  API     │  │  API     │  │  R|Proto  │  │  API     │
    └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

---

## 1. Auth Service: Seamless Broker Login

The core UX principle: users log in to their broker, not to PhantomCopy. No API keys, no tokens to copy-paste.

### Tradovate OAuth Flow

Tradovate supports standard OAuth 2.0 authorization code flow. PhantomCopy registers as an OAuth client with Tradovate and receives a `client_id` and `client_secret`.

```
User clicks "Connect Tradovate"
         │
         ▼
┌─────────────────────────────┐
│  Embedded OAuth Window      │
│  (iframe or popup)          │
│                             │
│  URL: https://trader.       │
│  tradovate.com/oauth/       │
│  authorize?                 │
│    response_type=code       │
│    &client_id=PHANTOM_ID    │
│    &redirect_uri=https://   │
│    app.phantomcopy.com/     │
│    callback/tradovate       │
│                             │
│  User enters their          │
│  Tradovate credentials      │
│  directly on Tradovate's    │
│  domain. PhantomCopy never  │
│  sees the password.         │
└──────────────┬──────────────┘
               │
               ▼
   Tradovate redirects to callback
   with ?code=AUTHORIZATION_CODE
               │
               ▼
┌─────────────────────────────┐
│  PhantomCopy Backend        │
│                             │
│  POST /auth/oauthtoken      │
│  {                          │
│    grant_type:              │
│      "authorization_code",  │
│    code: AUTH_CODE,         │
│    client_id: PHANTOM_ID,  │
│    client_secret: SECRET,  │
│    redirect_uri: CALLBACK  │
│  }                          │
│                             │
│  Response:                  │
│  {                          │
│    accessToken: "eyJ...",   │
│    expirationTime: "...",   │
│    userId: 12345,           │
│    name: "trader@email"     │
│  }                          │
└──────────────┬──────────────┘
               │
               ▼
   Token encrypted (AES-256-GCM)
   and stored in DB. Account ready.
```

### Rithmic Credential Flow

Rithmic uses R|Protocol API over WebSockets with Protocol Buffers. There is no OAuth. Users provide their R|Trader credentials (username + password), which PhantomCopy uses to authenticate directly against Rithmic's infrastructure.

```
User enters Rithmic credentials
in embedded login form
         │
         ▼
┌─────────────────────────────┐
│  PhantomCopy Backend        │
│                             │
│  1. Open WSS connection to  │
│     Rithmic system gateway  │
│     wss://rituz00100.       │
│     rithmic.com:443         │
│                             │
│  2. Send login request      │
│     (protobuf encoded):     │
│     {                       │
│       template_id: 10,      │
│       user: "username",     │
│       password: "pass",     │
│       app_name:             │
│         "PhantomCopy",      │
│       app_version: "1.0",   │
│       system_name:          │
│         "Rithmic Paper"     │
│     }                       │
│                             │
│  3. Receive login response  │
│     with session token      │
│                             │
│  4. Encrypt + store creds   │
│     (needed for reconnect)  │
└─────────────────────────────┘
```

**Security model**: Rithmic credentials are encrypted at rest with per-user keys derived from a master key in AWS KMS / GCP Cloud KMS. The encryption key never leaves the HSM. On each connection, the system decrypts in memory, authenticates, and immediately zeroes the plaintext buffer.

### NinjaTrader Connection

NinjaTrader connects via Rithmic or Tradovate under the hood. Users select which data feed their NT instance uses, then follow the corresponding flow above.

---

## 2. Proxy Manager: IP Isolation Layer

Every connected account gets its own dedicated residential IP. The broker sees each account originating from a unique address.

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Proxy Manager Service               │
│                                                       │
│  ┌─────────────────┐    ┌────────────────────────┐   │
│  │  IP Pool         │    │  Assignment Registry    │   │
│  │                  │    │                         │   │
│  │  BrightData      │    │  acc_01 → 184.72.xx.43 │   │
│  │    - Zone: US    │    │  acc_02 → 203.45.xx.91 │   │
│  │    - Zone: EU    │    │  acc_03 → 91.134.xx.17 │   │
│  │  Oxylabs         │    │  acc_04 → 45.89.xx.62  │   │
│  │  SmartProxy      │    │  ...                    │   │
│  │  IPRoyal         │    │                         │   │
│  └─────────────────┘    └────────────────────────┘   │
│                                                       │
│  ┌─────────────────┐    ┌────────────────────────┐   │
│  │  Health Monitor  │    │  Rotation Engine       │   │
│  │                  │    │                         │   │
│  │  Ping every 30s  │    │  Manual rotate         │   │
│  │  Measure latency │    │  Auto on failure       │   │
│  │  Detect IP bans  │    │  Scheduled rotation    │   │
│  └─────────────────┘    └────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### BrightData Integration (Primary Provider)

```javascript
// proxy-manager/providers/brightdata.js

class BrightDataProvider {
  constructor(config) {
    this.zone = config.zone;          // 'residential'
    this.customer = config.customer;  // BrightData customer ID
    this.password = config.password;  // Zone password
  }

  // Get a sticky session proxy for a specific account
  // Sticky sessions maintain the same IP for extended periods
  getProxyForAccount(accountId, region) {
    const sessionId = `phantom_${accountId}_${Date.now()}`;

    return {
      host: 'brd.superproxy.io',
      port: 22225,
      auth: {
        username: `brd-customer-${this.customer}`
                + `-zone-${this.zone}`
                + `-session-${sessionId}`
                + `-country-${this.regionToCountry(region)}`,
        password: this.password,
      },
      protocol: 'http', // BrightData supports HTTP CONNECT
    };
  }

  // Rotate IP by generating a new session ID
  rotateIP(accountId, region) {
    // New session ID = new IP from the pool
    return this.getProxyForAccount(accountId, region);
  }

  regionToCountry(region) {
    const map = {
      'US-East': 'us', 'US-West': 'us',
      'US-Central': 'us', 'EU-West': 'gb',
      'EU-Central': 'de',
    };
    return map[region] || 'us';
  }
}
```

### Proxied HTTP Agent

All broker API calls route through the assigned proxy using a custom HTTP agent:

```javascript
// proxy-manager/proxied-agent.js
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

class ProxiedBrokerClient {
  constructor(accountId, proxyConfig) {
    this.accountId = accountId;
    this.agent = this.createAgent(proxyConfig);
  }

  createAgent(proxy) {
    const proxyUrl = `http://${proxy.auth.username}:`
      + `${proxy.auth.password}@${proxy.host}:${proxy.port}`;
    return new HttpsProxyAgent(proxyUrl);
  }

  // All Tradovate API calls go through the proxy
  async tradovateRequest(method, path, body, accessToken) {
    const response = await fetch(
      `https://live.tradovateapi.com/v1${path}`,
      {
        method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        agent: this.agent, // Routes through residential proxy
      }
    );
    return response.json();
  }

  // Rithmic WebSocket through proxy
  createRithmicWebSocket(gatewayUrl) {
    const ws = new WebSocket(gatewayUrl, {
      agent: this.agent, // WS connection tunneled through proxy
    });
    return ws;
  }
}
```

### Health Monitor

```javascript
// proxy-manager/health.js

class ProxyHealthMonitor {
  constructor(registry, interval = 30000) {
    this.registry = registry; // Map<accountId, proxyConfig>
    this.metrics = new Map(); // Map<accountId, healthMetrics>
    this.interval = interval;
  }

  start() {
    setInterval(() => this.checkAll(), this.interval);
  }

  async checkHealth(accountId) {
    const proxy = this.registry.get(accountId);
    const agent = new HttpsProxyAgent(proxy.url);
    const start = performance.now();

    try {
      // Ping through the proxy to measure latency
      const res = await fetch('https://live.tradovateapi.com/v1/auth/me', {
        agent,
        signal: AbortSignal.timeout(10000),
      });

      const latency = Math.round(performance.now() - start);
      const externalIP = res.headers.get('x-forwarded-for');

      this.metrics.set(accountId, {
        healthy: true,
        latency,
        externalIP,
        lastCheck: Date.now(),
        uptime: this.calculateUptime(accountId),
      });

      // Detect if IP was rotated unexpectedly
      const prev = this.metrics.get(accountId);
      if (prev?.externalIP && prev.externalIP !== externalIP) {
        this.emit('ip-changed', { accountId, oldIP: prev.externalIP, newIP: externalIP });
      }
    } catch (error) {
      this.metrics.set(accountId, {
        healthy: false,
        latency: null,
        error: error.message,
        lastCheck: Date.now(),
      });

      // Auto-rotate on failure
      await this.registry.rotateIP(accountId);
      this.emit('proxy-rotated', { accountId, reason: 'health-check-failed' });
    }
  }

  async checkAll() {
    const accounts = Array.from(this.registry.keys());
    await Promise.allSettled(
      accounts.map(id => this.checkHealth(id))
    );
  }
}
```

---

## 3. Copy Engine: Trade Replication

The copy engine watches the master account for new positions and replicates them to all followers in parallel, each through its own proxy.

### Architecture

```
Master Account (Tradovate WebSocket)
         │
         │  Position update event
         ▼
┌─────────────────────────────────────┐
│         Copy Engine                  │
│                                      │
│  1. Parse position change            │
│  2. Apply risk filters per follower  │
│  3. Fan out to all follower clients  │
│  4. Each client uses its own proxy   │
│  5. Log execution + latency          │
└──────┬────────┬────────┬─────────────┘
       │        │        │
       ▼        ▼        ▼
   Follower  Follower  Follower
   (IP .91)  (IP .17)  (IP .62)
```

### Tradovate WebSocket Listener

```javascript
// copy-engine/tradovate-listener.js

class TradovateListener {
  constructor(accessToken, proxyAgent) {
    this.token = accessToken;
    this.agent = proxyAgent;
    this.ws = null;
    this.handlers = new Map();
  }

  async connect() {
    // Connect to Tradovate's WebSocket through proxy
    this.ws = new WebSocket(
      'wss://live.tradovateapi.com/v1/websocket',
      { agent: this.agent }
    );

    this.ws.on('open', () => {
      // Authenticate the WebSocket connection
      this.send('authorize\n1\n\n' + this.token);
    });

    this.ws.on('message', (data) => {
      this.parseFrame(data.toString());
    });

    this.ws.on('close', () => {
      // Auto reconnect with exponential backoff
      setTimeout(() => this.connect(), this.backoff());
    });
  }

  // Subscribe to user position changes
  subscribePositions(userId) {
    const subscribeMsg = `user/syncrequest\n3\n\n`
      + JSON.stringify({ users: [userId] });
    this.send(subscribeMsg);
  }

  parseFrame(raw) {
    // Tradovate WS frames:
    // "a]" heartbeat
    // "o]" open confirmation
    // Frame format: "event\nid\n\npayload"
    if (raw.startsWith('a')) return; // heartbeat

    const lines = raw.split('\n');
    const event = lines[0];

    if (event.includes('position/list') || event.includes('position/item')) {
      const payload = JSON.parse(lines.slice(3).join('\n'));
      this.emit('position-update', payload);
    }

    if (event.includes('order/item')) {
      const payload = JSON.parse(lines.slice(3).join('\n'));
      this.emit('order-update', payload);
    }
  }

  // Subscribe to real-time fill events
  onFill(callback) {
    this.handlers.set('fill', callback);
  }
}
```

### Copy Executor

```javascript
// copy-engine/executor.js

class CopyExecutor {
  constructor(db, proxyManager) {
    this.db = db;
    this.proxyManager = proxyManager;
    this.followers = new Map(); // accountId -> BrokerClient
  }

  async handleMasterTrade(masterTrade) {
    const {
      symbol, side, qty, price,
      stopLoss, takeProfit, orderId
    } = masterTrade;

    const followers = await this.db.getFollowers(masterTrade.masterId);
    const startTime = performance.now();

    // Fan out to all followers in parallel
    const results = await Promise.allSettled(
      followers.map(async (follower) => {
        // Get the proxied client for this follower
        const client = this.followers.get(follower.id);
        if (!client) return { error: 'client-not-initialized' };

        // Apply per-account risk rules
        const adjQty = this.applyRiskRules(follower, qty);
        if (adjQty === 0) return { skipped: 'risk-filter' };

        // Place the order through this follower's unique IP
        const order = await client.placeOrder({
          accountSpec: follower.accountSpec,
          accountId: follower.brokerAccountId,
          action: side === 'Buy' ? 'Buy' : 'Sell',
          symbol,
          orderQty: adjQty,
          orderType: 'Market',
          isAutomated: true,
        });

        return {
          followerId: follower.id,
          orderId: order.id,
          fillPrice: order.avgPx,
          latency: Math.round(performance.now() - startTime),
        };
      })
    );

    // Log all results
    await this.db.logCopyExecution({
      masterOrderId: orderId,
      symbol,
      side,
      qty,
      results: results.map(r => r.value || r.reason),
      totalLatency: Math.round(performance.now() - startTime),
      timestamp: Date.now(),
    });

    return results;
  }

  applyRiskRules(follower, masterQty) {
    const rules = follower.riskRules;

    // Scale quantity based on follower's account size
    let qty = Math.round(masterQty * (rules.sizeMultiplier || 1));

    // Max position size cap
    if (rules.maxQty && qty > rules.maxQty) qty = rules.maxQty;

    // Daily loss limit check
    if (rules.dailyLossLimit) {
      const todayPnL = follower.todayPnL;
      if (todayPnL <= -rules.dailyLossLimit) return 0;
    }

    // Max daily trades check
    if (rules.maxDailyTrades) {
      if (follower.todayTrades >= rules.maxDailyTrades) return 0;
    }

    return qty;
  }
}
```

### Rithmic Copy Client

```javascript
// copy-engine/rithmic-client.js

import protobuf from 'protobufjs';

class RithmicCopyClient {
  constructor(credentials, proxyAgent) {
    this.creds = credentials;
    this.agent = proxyAgent;
    this.orderPlant = null;  // WebSocket for order routing
    this.tickerPlant = null; // WebSocket for market data
  }

  async connect() {
    // Rithmic uses separate WebSocket connections (plants)
    // for different functions
    this.orderPlant = await this.connectPlant(
      'wss://rituz00100.rithmic.com:443', // Order plant gateway
      'ORDER_PLANT'
    );

    this.tickerPlant = await this.connectPlant(
      'wss://rituz00100.rithmic.com:443', // Ticker plant gateway
      'TICKER_PLANT'
    );
  }

  async connectPlant(url, plantType) {
    const ws = new WebSocket(url, { agent: this.agent });

    return new Promise((resolve, reject) => {
      ws.on('open', () => {
        // Send protobuf-encoded login request
        const loginReq = this.encodeLogin(plantType);
        ws.send(loginReq);
      });

      ws.on('message', (data) => {
        const msg = this.decodeProtobuf(data);
        if (msg.templateId === 11) { // Login response
          if (msg.rpCode === '0') resolve(ws);
          else reject(new Error(`Rithmic login failed: ${msg.rpCode}`));
        }
      });
    });
  }

  encodeLogin(plantType) {
    // Protobuf template_id 10 = login request
    return protobuf.encode({
      templateId: 10,
      templateVersion: '3.9',
      user: this.creds.username,
      password: this.creds.password,
      appName: 'PhantomCopy',
      appVersion: '1.0.0',
      systemName: this.creds.environment, // Rithmic 01, Paper, etc
      infraType: plantType === 'ORDER_PLANT' ? 1 : 2,
    });
  }

  async placeOrder(params) {
    // Protobuf template_id 312 = new order
    const orderReq = protobuf.encode({
      templateId: 312,
      fcmId: params.fcmId,
      ibId: params.ibId,
      accountId: params.accountId,
      symbol: params.symbol,
      exchange: params.exchange || 'CME',
      quantity: params.qty,
      transactionType: params.side === 'Buy' ? 1 : 2,
      duration: 1, // DAY
      priceType: 1, // MARKET
      manualOrAuto: 2, // AUTO
    });

    this.orderPlant.send(orderReq);

    // Wait for fill confirmation
    return new Promise((resolve) => {
      const handler = (data) => {
        const msg = this.decodeProtobuf(data);
        // template_id 351 = order fill
        if (msg.templateId === 351 && msg.basketId === orderReq.basketId) {
          this.orderPlant.off('message', handler);
          resolve({
            id: msg.orderId,
            avgPx: msg.avgFillPrice,
            filledQty: msg.totalFillQty,
          });
        }
      };
      this.orderPlant.on('message', handler);
    });
  }
}
```

---

## 4. Database Schema

```sql
-- Users
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Connected broker accounts
CREATE TABLE accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  label           VARCHAR(100) NOT NULL,
  platform        VARCHAR(20) NOT NULL, -- tradovate, rithmic, ninjatrader
  role            VARCHAR(10) NOT NULL, -- master, follower
  status          VARCHAR(20) DEFAULT 'connected',

  -- Encrypted OAuth token (Tradovate) or credentials (Rithmic)
  encrypted_token BYTEA,
  token_iv        BYTEA,
  token_expires   TIMESTAMPTZ,

  -- Broker-specific IDs
  broker_user_id  VARCHAR(100),
  broker_account_id VARCHAR(100),

  -- Risk rules (JSONB)
  risk_rules      JSONB DEFAULT '{}',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Proxy assignments (1:1 with accounts)
CREATE TABLE proxy_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  provider        VARCHAR(50) NOT NULL,  -- BrightData, Oxylabs, etc
  session_id      VARCHAR(200) NOT NULL, -- Sticky session identifier
  region          VARCHAR(20) NOT NULL,
  external_ip     VARCHAR(45),           -- Current assigned IP
  last_rotated    TIMESTAMPTZ DEFAULT NOW(),
  latency_ms      INT,
  healthy         BOOLEAN DEFAULT TRUE,
  uptime_pct      DECIMAL(5,2) DEFAULT 100.0
);

-- Copy execution log
CREATE TABLE copy_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_account_id UUID REFERENCES accounts(id),
  master_order_id   VARCHAR(100),
  symbol            VARCHAR(20) NOT NULL,
  side              VARCHAR(10) NOT NULL,
  master_qty        INT NOT NULL,
  master_price      DECIMAL(12,4),
  executed_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Individual follower fills per copy execution
CREATE TABLE copy_fills (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id      UUID REFERENCES copy_executions(id),
  follower_id       UUID REFERENCES accounts(id),
  follower_order_id VARCHAR(100),
  fill_qty          INT,
  fill_price        DECIMAL(12,4),
  slippage_ticks    INT,
  latency_ms        INT,
  status            VARCHAR(20) DEFAULT 'filled',
  proxy_ip_used     VARCHAR(45),  -- The IP this order was placed from
  error_message     TEXT
);

-- Proxy health snapshots (time series)
CREATE TABLE proxy_health_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID REFERENCES accounts(id),
  external_ip VARCHAR(45),
  latency_ms  INT,
  healthy     BOOLEAN,
  checked_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. API Routes

```
POST   /api/auth/register           Register new user
POST   /api/auth/login              Login, returns JWT
POST   /api/auth/refresh            Refresh JWT

# Account management
GET    /api/accounts                List all connected accounts
POST   /api/accounts/connect        Start broker OAuth flow
GET    /api/accounts/callback/:plat OAuth callback handler
POST   /api/accounts/connect-creds  Connect via credentials (Rithmic)
DELETE /api/accounts/:id            Disconnect account
PATCH  /api/accounts/:id/role       Change master/follower role
PATCH  /api/accounts/:id/risk       Update risk rules

# Proxy management
GET    /api/proxies                 List all proxy assignments
POST   /api/proxies/:accountId/rotate  Rotate IP for account
POST   /api/proxies/rotate-all     Rotate all IPs
GET    /api/proxies/health          Get health status for all proxies
PATCH  /api/proxies/:accountId      Update proxy config (region, provider)

# Copy engine
POST   /api/copy/start              Start copy engine
POST   /api/copy/stop               Stop copy engine
GET    /api/copy/status             Current engine status
GET    /api/copy/executions         List copy executions
GET    /api/copy/executions/:id     Detailed execution with fills

# Trade log
GET    /api/trades                  All trades (master + follower)
GET    /api/trades/pnl              Aggregated P&L by account
GET    /api/trades/live             SSE stream of live trades

# WebSocket
WS     /ws/trades                   Real-time trade updates
WS     /ws/proxy-health             Real-time proxy health
```

---

## 6. Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React, Tailwind CSS |
| API Gateway | Express.js with rate limiting |
| Copy Engine | Node.js worker threads |
| WebSockets | ws library (master listener + client push) |
| Protobuf | protobufjs (Rithmic R|Protocol) |
| Database | PostgreSQL 16 (Supabase or self-hosted) |
| Cache/Queue | Redis (session cache, job queue) |
| Proxy Providers | BrightData (primary), Oxylabs (fallback) |
| Token Encryption | AES-256-GCM via Node crypto |
| Key Management | AWS KMS or GCP Cloud KMS |
| Hosting | Railway / Render / AWS ECS |
| Monitoring | Prometheus + Grafana |

---

## 7. Security Considerations

**Token storage**: All broker tokens and credentials are encrypted at rest using AES-256-GCM. Encryption keys are managed by a cloud KMS and never stored on disk.

**Credential isolation**: Tradovate uses OAuth so PhantomCopy never handles raw passwords. For Rithmic, credentials are encrypted immediately on receipt, decrypted only in-memory for connection establishment, then zeroed.

**Proxy IP logging**: The `copy_fills` table records which proxy IP was used for each order. This creates an audit trail proving IP uniqueness per account.

**Rate limiting**: Per-user rate limits on proxy rotation (max 10 rotations/hour) to prevent abuse of residential proxy pools.

**Session management**: JWT with 15-minute expiry for the dashboard, plus refresh tokens stored in HTTP-only cookies. Broker OAuth tokens refreshed on a separate schedule (Tradovate: every 85 minutes).

---

## 8. Deployment Flow

```
1. User signs up on phantomcopy.com
2. Clicks "Connect Account" → selects Tradovate
3. Embedded OAuth window opens trader.tradovate.com
4. User logs in with their broker credentials
5. PhantomCopy receives OAuth code → exchanges for token
6. Proxy Manager assigns a sticky residential IP from BrightData
7. Health monitor verifies the proxy works
8. User designates the account as Master or Follower
9. For subsequent accounts, repeat steps 2-8
10. User clicks "Start Copying"
11. Copy Engine opens WebSocket to master's Tradovate feed
12. On each master trade:
    a. Parse the position change
    b. Apply risk rules per follower
    c. Place orders on each follower through its unique proxy
    d. Log execution, slippage, and latency
```

---

## 9. File Structure

```
phantomcopy/
├── apps/
│   └── web/                    # Next.js frontend
│       ├── app/
│       │   ├── (dashboard)/
│       │   │   ├── overview/
│       │   │   ├── accounts/
│       │   │   ├── proxies/
│       │   │   ├── trades/
│       │   │   └── settings/
│       │   ├── callback/       # OAuth callback routes
│       │   │   └── tradovate/
│       │   └── layout.tsx
│       └── components/
├── packages/
│   └── api/                    # Express API server
│       ├── routes/
│       │   ├── auth.js
│       │   ├── accounts.js
│       │   ├── proxies.js
│       │   ├── copy.js
│       │   └── trades.js
│       ├── services/
│       │   ├── auth-service.js
│       │   ├── proxy-manager/
│       │   │   ├── index.js
│       │   │   ├── providers/
│       │   │   │   ├── brightdata.js
│       │   │   │   ├── oxylabs.js
│       │   │   │   └── smartproxy.js
│       │   │   ├── health.js
│       │   │   └── proxied-agent.js
│       │   ├── copy-engine/
│       │   │   ├── index.js
│       │   │   ├── tradovate-listener.js
│       │   │   ├── rithmic-client.js
│       │   │   ├── executor.js
│       │   │   └── risk-engine.js
│       │   └── encryption.js
│       ├── db/
│       │   ├── schema.sql
│       │   └── migrations/
│       └── server.js
├── docker-compose.yml
├── .env.example
└── README.md
```

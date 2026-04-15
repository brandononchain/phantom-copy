# Tradevanish — Technical Documentation

**Version 1.1.0 | April 2026**
**Repository:** github.com/brandononchain/phantom-copy

---

## 1. Executive Summary

Tradevanish is a stealth copy trading platform for prop firm futures traders. Its core purpose is to replicate trades from a single master broker account to unlimited follower accounts, with each connection routed through a unique residential proxy IP to prevent detection by prop firms that monitor for correlated trading activity.

The platform solves three problems simultaneously: trade replication (one signal, many executions), IP isolation (each account appears independent), and operational stealth (configurable latency jitter and timing randomization eliminate correlation patterns).

Supported brokers: TopStepX (ProjectX API), Tradovate (OAuth), NinjaTrader (OAuth), Rithmic (WebSocket). Cross-platform copying is supported — a TopStepX master can copy to Tradovate followers.

The business model is tiered SaaS: Basic ($39/mo, 5 followers, BrightData only), Pro ($69/mo, unlimited followers, 4 providers), Pro+ ($89/mo, adds REST API, webhooks, custom proxy pools).

---

## 2. Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        VERCEL (Frontend)                        │
│   Next.js 14 App Router · SSR Landing · CSR Dashboard          │
│   /           → Landing page (Aura WebGL background)           │
│   /app        → Dashboard (single-file React app ~4000 lines)  │
│   /sign-in    → Auth screen (login mode)                       │
│   /sign-up    → Auth screen (register mode)                    │
│   /docs       → 13-page documentation center                   │
│   /api/*      → Reverse proxy to Railway API                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS (Vercel rewrites)
┌───────────────────────────▼─────────────────────────────────────┐
│                      RAILWAY (Backend API)                      │
│   Express.js · Node 22 · ES Modules                            │
│                                                                 │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │  Routes   │  │ Services │  │Listeners │  │Middleware│      │
│   │ 12 files  │  │ 8 files  │  │ 2 files  │  │ 1 file   │      │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────┘      │
│        │              │              │                           │
│   ┌────▼──────────────▼──────────────▼────┐                    │
│   │            PostgreSQL (Railway)        │                    │
│   │  18 tables · 9 migrations · 10 indexes│                    │
│   └───────────────────────────────────────┘                    │
│   ┌───────────────────────────────────────┐                    │
│   │            Redis (Railway)             │                    │
│   │  BullMQ copy execution queue          │                    │
│   │  10x parallel workers · priority queue│                    │
│   └───────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘

External Services:
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  BrightData │ │  Tradovate  │ │  TopStepX   │ │   Resend    │
│  Residential│ │  OAuth +    │ │  ProjectX   │ │   Email     │
│  Proxies    │ │  WebSocket  │ │  REST API   │ │   15 tmpl   │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

### Directory Structure

```
phantom-copy/
├── api/                          # Express backend
│   ├── src/
│   │   ├── config/index.js       # All env vars + defaults
│   │   ├── db/
│   │   │   ├── pool.js           # pg Pool singleton
│   │   │   └── migrate.js        # 9 migrations, self-healing
│   │   ├── middleware/
│   │   │   └── auth.js           # JWT + API key + plan gating
│   │   ├── routes/
│   │   │   ├── auth.js           # Register, login, 2FA, reset
│   │   │   ├── accounts.js       # CRUD broker accounts
│   │   │   ├── brokers.js        # Broker auth + stats + OAuth
│   │   │   ├── proxies.js        # Assign, rotate, health, test
│   │   │   ├── settings.js       # Risk rules + overrides (24 fields)
│   │   │   ├── listeners.js      # Start/stop WebSocket listeners
│   │   │   ├── trades.js         # Copy execution history
│   │   │   ├── signals.js        # TradingView/TrendSpider webhooks
│   │   │   ├── proplus.js        # API keys, webhooks, proxy pools
│   │   │   ├── billing.js        # Stripe checkout + plans
│   │   │   └── notifications.js  # In-app notifications
│   │   ├── services/
│   │   │   ├── copy-engine.js    # Trade replication engine
│   │   │   ├── copy-queue.js     # BullMQ Redis queue
│   │   │   ├── proxy-provider.js # BrightData + 3 providers
│   │   │   ├── contracts.js      # 40+ futures contract resolver
│   │   │   ├── email.js          # 15 branded email templates
│   │   │   ├── listener-manager.js # WebSocket session manager
│   │   │   ├── token-refresh.js  # Tradovate token auto-refresh
│   │   │   └── webhook-delivery.js # 3x retry webhook delivery
│   │   └── listeners/
│   │       ├── projectx-listener.js  # TopStepX WebSocket listener
│   │       └── tradovate-listener.js # Tradovate WebSocket listener
│   └── package.json
├── web/                          # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.js           # Landing page (Aura background)
│   │   │   ├── layout.js         # Root layout + SEO + JSON-LD
│   │   │   ├── app/page.js       # Dashboard entry
│   │   │   ├── sign-in/page.js   # Auth (login mode)
│   │   │   ├── sign-up/page.js   # Auth (register mode)
│   │   │   ├── docs/[[...slug]]/page.js  # 13-page docs center
│   │   │   ├── terms/page.js     # Terms & Conditions
│   │   │   └── privacy/page.js   # Privacy Policy
│   │   └── components/
│   │       └── Dashboard.jsx     # Entire dashboard (~4000 lines)
│   ├── public/
│   │   ├── sitemap.xml           # 18 URLs
│   │   ├── robots.txt            # AI crawler friendly
│   │   └── logo.png
│   └── vercel.json               # API proxy rewrites
└── README.md
```

---

## 3. Data Flows

### Copy Trading Signal Flow (Master → Followers)

```
Master Trader places trade on broker platform
           │
           ▼
┌──────────────────────┐
│  WebSocket Listener  │  (projectx-listener.js or tradovate-listener.js)
│  Detects position Δ  │  Runs server-side, persists across logouts
└──────────┬───────────┘
           │ Signal: { action, contractId, side, qty, price }
           ▼
┌──────────────────────┐
│    Copy Engine        │  (copy-engine.js)
│  1. Apply copy delay  │  configurable ms + random jitter
│  2. Check risk rules  │  kill switch, daily loss, max trades
│  3. Resolve contract  │  NQ1! → NQM26 (platform-specific)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│   BullMQ Queue       │  (copy-queue.js)
│   Redis-backed       │  10x parallel workers
│   Priority: closes   │  Close orders execute before opens
│   before opens       │
└──────────┬───────────┘
           │ Fan out to all followers
           ▼
┌──────────────────────┐
│  For EACH follower:  │
│  1. Load proxy creds │  from proxy_assignments table
│  2. Create undici    │  ProxyAgent (BrightData residential)
│  3. Place order via  │  broker API through proxy
│  4. Log fill to DB   │  copy_fills table
│  5. Fire webhook     │  trade.executed event (Pro+)
└──────────────────────┘
```

### Authentication Flow

```
User → POST /api/auth/login { email, password }
  │
  ├─ If 2FA enabled → returns { requires_2fa: true }
  │   └─ User → POST /api/auth/login { email, password, totp_code }
  │
  ├─ Returns: { user, token } (JWT, 7-day expiry)
  │   ├─ Token stored in httpOnly cookie (for SSR)
  │   └─ Token stored in localStorage (for Bearer auth)
  │
  └─ Tradovate OAuth flow:
      1. GET /api/brokers/tradovate/auth-url → redirect to Tradovate
      2. Tradovate → GET /api/brokers/tradovate/callback?code=XXX
      3. Server exchanges code for token
      4. Redirect to /app?tradovate_token=XXX
      5. Dashboard picks up token, opens connect modal
```

### Proxy Assignment Flow

```
User clicks "Connect Account" → Step 3 (Proxy)
           │
           ▼
POST /api/proxies/test-ip { provider, region }
           │
           ▼
┌──────────────────────────────────┐
│  proxy-provider.js → assignProxy │
│  1. Generate session ID          │  pc_{accountId}_{timestamp}
│  2. Build proxy URL              │  BrightData gateway format
│  3. Create undici ProxyAgent     │
│  4. Fetch https://api.ipify.org  │  through the proxy
│  5. Return resolved external IP  │  Real residential IP
└──────────────────────────────────┘
           │
           ▼
Frontend displays real IP (e.g., 63.72.116.87)
User changes region → new IP resolves automatically
```

---

## 4. API Routes

### Auth (`/api/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /register | None | Create account |
| POST | /login | None | Login (returns JWT) |
| GET | /me | JWT | Get current user |
| PATCH | /me | JWT | Update profile |
| POST | /logout | None | Clear cookie |
| POST | /reset-password | None | Send 6-digit reset code |
| POST | /reset-password/confirm | None | Reset with code |
| POST | /change-password | JWT | Change password |
| POST | /2fa/setup | JWT | Generate TOTP QR |
| POST | /2fa/verify | JWT | Enable 2FA |
| POST | /2fa/disable | JWT | Disable 2FA |

### Accounts (`/api/accounts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | / | JWT | List all accounts |
| POST | / | JWT | Connect account (enforces follower limit) |
| DELETE | /:id | JWT | Disconnect account |

### Brokers (`/api/brokers`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /topstepx/auth | JWT | Authenticate with ProjectX API |
| POST | /topstepx/accounts | JWT | List TopStepX accounts |
| POST | /tradovate/auth | JWT | Get Tradovate OAuth URL |
| GET | /tradovate/callback | None | OAuth callback |
| POST | /tradovate/accounts | JWT | List Tradovate accounts |
| POST | /rithmic/auth | JWT | Authenticate Rithmic |
| POST | /rithmic/accounts | JWT | List Rithmic accounts |
| POST | /ninjatrader/auth | JWT | Auth NinjaTrader |
| POST | /ninjatrader/accounts | JWT | List NinjaTrader accounts |
| POST | /stats | JWT | Get account balance/equity/P&L/trades |

### Proxies (`/api/proxies`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | / | JWT | List all proxy assignments |
| GET | /providers | JWT | List available providers |
| POST | /test-ip | JWT | Resolve real proxy IP (no save) |
| POST | /assign | JWT | Assign proxy to account (plan-gated) |
| POST | /:id/rotate | JWT | Rotate to new IP |
| POST | /:id/health | JWT | Health check through proxy |
| POST | /health-check-all | JWT | Health check all proxies |
| GET | /:id/health-history | JWT | Historical health data |

### Settings (`/api/settings`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /risk | JWT | Load all 24 settings fields |
| PUT | /risk | JWT | Save all 24 settings fields |
| GET | /overrides | JWT | Load follower overrides |
| PUT | /overrides/:accountId | JWT | Save follower override (Pro+) |

### Listeners (`/api/listeners`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /start | JWT | Start master WebSocket listener |
| POST | /stop | JWT | Stop listener |
| GET | /sessions | JWT | List listener sessions |
| GET | /sessions/:id/events | JWT | Get session events |
| GET | /stats | JWT | Listener statistics |
| GET | /status | JWT | Check if listener is running |

### Signals (`/api/signals`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /:signalKey | Key | Receive TradingView/TrendSpider signal |
| POST | /keys | JWT | Create signal key |
| GET | /keys | JWT | List signal keys |
| DELETE | /keys/:id | JWT | Revoke signal key |
| GET | /history | JWT | Signal execution history |

### Pro+ (`/api/proplus`) — All require Pro+ plan

| Method | Path | Description |
|--------|------|-------------|
| GET/POST/DELETE | /keys | REST API key management |
| GET/POST/DELETE | /webhooks | Webhook endpoint management |
| GET/POST | /webhooks/:id/deliveries | Webhook delivery logs |
| POST | /webhooks/:id/test | Test webhook delivery |
| GET/POST/DELETE | /proxy-pools | Custom proxy pool management |
| POST | /proxy-pools/:id/rotate | Rotate pool IP |

---

## 5. Database

### Schema Overview (18 tables)

```
users ──────────────────────────── accounts
  │  id, email, password_hash,      │  id, user_id, platform, role,
  │  name, plan, totp_secret,       │  broker_account_id, label,
  │  totp_enabled, created_at       │  status, credentials_encrypted
  │                                  │
  ├── risk_rules (24+ fields)       ├── proxy_assignments
  │   max_qty, daily_loss,          │   provider, region, ip_address,
  │   copy_delay, rotation_mode,    │   proxy_url, session_id, health
  │   copy_symbols, size_mode...    │
  │                                  ├── copy_executions
  ├── follower_overrides            │   signal_type, contract_id,
  │   account_id, max_qty,          │   side, qty, master_price
  │   daily_loss, size_multiplier   │
  │                                  ├── copy_fills
  ├── api_keys (Pro+)               │   follower_account_id, fill_price,
  │   key_hash, env, status         │   slippage_ticks, latency_ms,
  │                                  │   proxy_ip, status
  ├── webhooks (Pro+)               │
  │   url, events, secret,          ├── listener_sessions
  │   status                        │   account_id, platform, status
  │                                  │
  ├── broker_tokens                 ├── listener_events
  │   access_token, refresh_token,  │   session_id, type, data
  │   expires_at                    │
  │                                  └── proxy_health_log
  ├── notification_preferences          account_id, ip, latency, status
  │   email_*, in_app_*
  │
  ├── notifications
  │   type, message, read
  │
  └── webhook_deliveries
      webhook_id, payload, status,
      response_code, attempts
```

---

## 6. External Dependencies

| Service | Purpose | Auth Method | Key Config |
|---------|---------|-------------|------------|
| **BrightData** | Residential proxy IPs | Username/password in proxy URL | `BRIGHTDATA_USERNAME`, `_PASSWORD`, `_ZONE` |
| **Tradovate** | Broker OAuth + WebSocket | OAuth 2.0 client credentials | `TRADOVATE_CLIENT_ID`, `_SECRET`, `_REDIRECT_URI` |
| **TopStepX** | Broker REST API | JWT login key | User provides API key |
| **Rithmic** | Broker WebSocket | Username/password | User provides credentials |
| **Resend** | Transactional email | API key | `RESEND_API_KEY`, from: noreply@tradevanish.com |
| **Stripe** | Payment processing | Secret key + webhooks | `STRIPE_SECRET_KEY`, `_WEBHOOK_SECRET` |
| **Redis** | BullMQ job queue | Connection URL | `REDIS_URL` (Railway internal) |
| **PostgreSQL** | Primary database | Connection URL | `DATABASE_URL` (Railway) |

---

## 7. Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `web/src/components/Dashboard.jsx` | ~4000 | Entire dashboard UI — all pages, modals, components in one file |
| `api/src/services/copy-engine.js` | ~440 | Trade replication engine — signal processing, risk checks, fan-out |
| `api/src/listeners/projectx-listener.js` | ~550 | TopStepX WebSocket — connects, authenticates, streams positions |
| `api/src/listeners/tradovate-listener.js` | ~850 | Tradovate WebSocket — OAuth, position monitoring, copy fan-out |
| `api/src/services/proxy-provider.js` | ~250 | BrightData integration — URL construction, IP resolution, health |
| `api/src/routes/settings.js` | ~125 | 24-field settings with self-healing ALTER TABLE |
| `api/src/middleware/auth.js` | ~100 | JWT auth, API key auth, plan feature gating |
| `api/src/services/contracts.js` | ~200 | 40+ futures contracts, front month roll, ticker normalization |
| `api/src/services/email.js` | ~300 | 15 branded HTML email templates via Resend |
| `api/src/db/migrate.js` | ~160 | 9 migrations, idempotent, runs on boot |

---

## 8. Common Gotchas

**Node.js fetch() does NOT support proxy agents.** Native `fetch()` in Node 18+ ignores the `agent` option. Must use `undici`'s `fetch()` with `dispatcher: new ProxyAgent(url)` for all proxy-routed requests. This was the root cause of BrightData showing zero usage — every proxy request silently went direct.

**Tradovate OAuth callback URL must point to /app.** After the route restructure (landing at `/`, dashboard at `/app`), the OAuth callback was redirecting to `/` (landing page) with the token in the URL. The `frontendUrl` in `brokers.js` must append `/app`.

**Settings self-healing is critical.** The `risk_rules` table gains new columns over time. The PUT handler runs `ALTER TABLE ADD COLUMN IF NOT EXISTS` before every save to ensure columns exist regardless of migration state. Without this, saves fail silently on new deploys.

**MasterStatsBar returns null if broker token expired.** TopStepX tokens last 24 hours. If the stored token in `accounts.credentials_encrypted` expires, the stats endpoint returns an error and the component renders nothing. Fixed by always rendering with fallback "--" values.

**Browser autofill corrupts password on login after reset.** After password reset, browsers auto-fill the OLD saved password. The password input needs `autoComplete="current-password"` and a React `key` prop that changes on mode switch to force DOM recreation.

**Express route order matters for parameterized paths.** `/test-ip` must be declared BEFORE `/:accountId/health` or Express matches "test-ip" as an accountId. This caused 404s on the proxy test endpoint.

**BullMQ falls back to inline if no Redis.** If `REDIS_URL` is not set, the copy engine processes signals synchronously instead of through the queue. This is intentional for local development but means no parallel execution.

**Onboarding shows for every login if created_at not checked.** The `handleAuth` callback must compare `user.created_at` to `Date.now()` and only show onboarding within 60 seconds of account creation. The login response must include `created_at`.

---

## 9. Common Operations

### Local Development

```bash
# API
cd api && npm install
cp .env.example .env  # Fill in DATABASE_URL, JWT_SECRET, etc.
npm run dev           # node --watch src/index.js

# Frontend
cd web && npm install
npm run dev           # Next.js dev server on :3000
```

### Deployment

```bash
# Push to main triggers auto-deploy on both platforms:
git push origin main

# Vercel: auto-deploys web/ (root dir: web)
# Railway: auto-deploys api/ (root dir: api)

# Typical deploy cycle: 60-90 seconds
# Railway restarts: listeners auto-restore from DB
```

### Testing Proxy Connection

```bash
# Resolve real BrightData IP
curl -X POST https://www.tradevanish.com/api/proxies/test-ip \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"brightdata","region":"us-east"}'

# Health check existing proxy
curl -X POST https://www.tradevanish.com/api/proxies/2/health \
  -H "Authorization: Bearer $TOKEN"

# Rotate IP
curl -X POST https://www.tradevanish.com/api/proxies/2/rotate \
  -H "Authorization: Bearer $TOKEN"
```

### Testing Settings Persistence

```bash
# Save
curl -X PUT https://www.tradevanish.com/api/settings/risk \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"max_qty":8,"copy_symbols":"NQ,ES","rotation_mode":"interval"}'

# Verify
curl https://www.tradevanish.com/api/settings/risk \
  -H "Authorization: Bearer $TOKEN"
```

### Admin Operations

```bash
# Reset user password + upgrade plan
curl -X POST https://www.tradevanish.com/api/auth/admin/upgrade \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","newPassword":"NewPass123!","adminKey":"pc_admin_2026","plan":"proplus"}'

# Check system health
curl https://www.tradevanish.com/api/health
```

### Debugging

```bash
# Railway logs (real-time)
railway logs -f

# Check listener status
curl https://www.tradevanish.com/api/listeners/status \
  -H "Authorization: Bearer $TOKEN"

# Check queue stats
curl https://www.tradevanish.com/api/health | python3 -m json.tool

# Proxy debug info
curl https://www.tradevanish.com/api/proxies/2/debug \
  -H "Authorization: Bearer $TOKEN"
```

---

*Generated April 2026. Covers all code as of commit `17a7bd9`.*

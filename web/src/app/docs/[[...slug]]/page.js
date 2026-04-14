'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

// ═══════════════════════════════════════════════════════════════════════════════
// TRADEVANISH DOCUMENTATION CENTER
// ═══════════════════════════════════════════════════════════════════════════════

const DOCS = [
  {
    section: "Getting Started",
    items: [
      {
        slug: "",
        title: "Introduction",
        icon: "📖",
        content: `
# Welcome to Tradevanish

**Tradevanish** is a stealth copy trading platform for prop firm traders. It lets you copy trades from a master account to unlimited follower accounts, with each account routed through a unique residential proxy IP.

## Why Tradevanish?

Prop firms monitor for copy trading by detecting shared IP addresses, identical order timing, and correlated trade patterns across accounts. Tradevanish solves all three:

- **IP Isolation** — Each connected account gets its own dedicated residential proxy IP from BrightData's network. No two accounts share an IP.
- **Latency Jitter** — Orders are placed with randomized sub-second delays to prevent timing correlation.
- **Proxy Rotation** — IPs can be rotated on demand or on a schedule to maintain freshness.

## How It Works

1. **Connect** your master broker account (TopStepX, Tradovate, NinjaTrader, or Rithmic)
2. **Connect** your follower accounts on any supported platform
3. **Start** the master listener — it monitors your master account via WebSocket
4. When you trade on your master, the **Copy Engine** automatically replicates to all followers
5. Each follower order routes through its own **residential proxy IP**

## Supported Platforms

| Platform | Auth Method | Status |
|----------|-------------|--------|
| TopStepX | API Key (loginKey) | ✅ Full support |
| Tradovate | OAuth 2.0 | ✅ Full support |
| NinjaTrader | OAuth 2.0 (same as Tradovate) | ✅ Full support |
| Rithmic | Username + Password | ✅ Full support |

## Plans

| Feature | Basic ($39/mo) | Pro ($69/mo) | Pro+ ($89/mo) |
|---------|:-:|:-:|:-:|
| Follower accounts | 5 | Unlimited | Unlimited |
| Proxy providers | BrightData | Multi-provider | Multi-provider |
| Follower overrides | ❌ | ✅ | ✅ |
| REST API | ❌ | ❌ | ✅ |
| Webhooks | ❌ | ❌ | ✅ |
| TradingView Signals | ✅ | ✅ | ✅ |
| Custom Proxy Pools | ❌ | ❌ | ✅ |
        `
      },
      {
        slug: "quickstart",
        title: "Quick Start",
        icon: "🚀",
        content: `
# Quick Start Guide

Get copy trading running in under 5 minutes.

## Step 1: Create Your Account

Go to [tradevanish.com](https://www.tradevanish.com) and click **Create Account**. Enter your email, name, and password.

You'll receive a welcome email confirming your account is active.

## Step 2: Connect Your Master Account

1. Click **Connect Master** on the Accounts page
2. Select your broker platform (TopStepX, Tradovate, etc.)
3. Enter your credentials or complete the OAuth flow
4. Select the account you want to use as your signal source
5. Name it (e.g., "TopStep 100k Master")

A residential proxy IP is automatically assigned to your master account.

## Step 3: Connect Follower Accounts

1. Click **Connect Follower** on the Accounts page
2. Select the platform and authenticate
3. Repeat for each prop firm account you want to copy trades to

Each follower gets its own unique IP address.

## Step 4: Start the Listener

Click **Start Listener** on your master account. The listener connects to your broker's WebSocket feed and monitors for new positions and orders in real time.

When you place a trade on your master account, the copy engine automatically:
1. Detects the new position
2. Applies your risk rules (max qty, daily loss limit, size multiplier)
3. Places matching orders on each follower through their dedicated proxy

## Step 5: Verify

Place a small test trade on your master. You should see it replicate to all followers within seconds. Check the **Trade Log** page for execution details.
        `
      },
      {
        slug: "connect-broker",
        title: "Connecting Brokers",
        icon: "🔗",
        content: `
# Connecting Broker Accounts

## TopStepX

TopStepX uses API key authentication (loginKey).

1. Log into your TopStepX account
2. Go to **Settings > API** and generate a login key
3. In Tradevanish, select **TopStepX** as the platform
4. Enter your **username** and **API Key**
5. Select the account from the list

The connection uses TopStepX's SignalR hub for real-time position updates.

## Tradovate / NinjaTrader

Tradovate and NinjaTrader use OAuth 2.0.

1. Select **Tradovate** or **NinjaTrader** in the connect modal
2. Click **Authorize** — you'll be redirected to Tradovate's login page
3. Log in and grant access
4. You'll be redirected back to Tradevanish with your accounts listed
5. Select the account to connect

**Note:** Tradovate tokens expire after 90 minutes. Tradevanish handles token refresh automatically.

## Rithmic

Rithmic uses direct credential authentication.

1. Select **Rithmic** in the connect modal
2. Enter your Rithmic username and password
3. The connection validates against Rithmic's WebSocket

## Master vs. Follower

- **Master**: Your signal source. Only one master account allowed. The listener monitors this account for trades.
- **Follower**: Copy target. Unlimited followers (Pro/Pro+ plans). Trades from the master are replicated here.
        `
      }
    ]
  },
  {
    section: "Core Features",
    items: [
      {
        slug: "copy-engine",
        title: "Copy Engine",
        icon: "⚡",
        content: `
# Copy Engine

The copy engine is the core of Tradevanish. It receives signals from your master account and replicates them across all followers.

## How Signals Flow

\`\`\`
Master Account (WebSocket listener)
    ↓ Position change detected
Copy Engine
    ↓ Apply risk rules
    ↓ Calculate follower quantities
    ↓ Route through dedicated proxy per follower
Follower 1 (IP: 208.x.x.126) → TopStepX
Follower 2 (IP: 142.x.x.089) → Tradovate
Follower N (IP: xxx.x.x.xxx) → NinjaTrader
\`\`\`

## Signal Types

| Signal | Description |
|--------|-------------|
| OPEN | New position opened on master |
| CLOSE | Position closed on master |
| MODIFY | Stop loss or take profit changed |
| REVERSE | Position flipped (long → short or vice versa) |

## Risk Rules

Configure these in **Settings > Risk Management**:

- **Max Quantity** — Maximum contracts per follower order
- **Daily Loss Limit** — Stop copying if daily P&L drops below this
- **Max Trades Per Day** — Limit total trade count
- **Trailing Drawdown** — Track running drawdown against threshold
- **Kill Switch** — Emergency stop all trading across all accounts

## Follower Overrides (Pro/Pro+)

Per-follower customization:
- **Size Multiplier** — Scale position sizes (e.g., 0.5x for half size)
- **Max Quantity** — Override the global max per follower
- **Daily Loss Limit** — Independent loss limit per follower
        `
      },
      {
        slug: "proxy-system",
        title: "Proxy System",
        icon: "🌐",
        content: `
# Proxy System

Every connected broker account routes its API calls through a dedicated residential proxy IP.

## Why Residential Proxies?

Datacenter IPs are flagged by prop firms. Residential IPs appear as normal home internet connections, making your trading activity indistinguishable from a regular trader.

## How It Works

1. When you connect an account, Tradevanish assigns a residential IP from BrightData's network
2. All API calls (order placement, position queries, account info) for that account route through that specific IP
3. The IP persists across sessions using sticky sessions — your account always uses the same IP
4. You can rotate the IP on demand from the dashboard

## Proxy Health

Each proxy is monitored for:
- **Latency** — Response time to the broker API. Green (<20ms), Amber (<50ms), Red (>50ms)
- **Health Status** — Healthy, Degraded, or Down
- **Uptime** — Percentage of successful connections

## IP Rotation

Click **Rotate IP** on any account to get a fresh residential IP. Use cases:
- Switching regions (US East → US West)
- After a suspicious activity warning from a prop firm
- Scheduled rotation for operational security

## Providers

| Provider | Availability |
|----------|:--:|
| BrightData | ✅ All plans |
| Oxylabs | ✅ Pro/Pro+ |
| SmartProxy | ✅ Pro/Pro+ |
| IPRoyal | ✅ Pro/Pro+ |
        `
      },
      {
        slug: "tradingview-signals",
        title: "TradingView Signals",
        icon: "📊",
        content: `
# TradingView Signal Webhooks

Receive trading signals from TradingView, TrendSpider, or any custom code. Signals execute on your master account and auto-copy to all followers.

## Setup

1. Go to **Profile > Signal Webhooks**
2. Click **+ New Signal Webhook**
3. Name your strategy (e.g., "NQ Scalper")
4. Click **Generate Webhook URL**
5. Copy the URL — it's shown only once

## Configure TradingView

1. Open your TradingView chart
2. Create or edit an alert
3. Check **Webhook URL** and paste your Tradevanish signal URL
4. In the **Message** field, use this JSON:

\`\`\`json
{
  "ticker": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "qty": {{strategy.order.contracts}},
  "price": "{{close}}",
  "sentiment": "{{strategy.market_position}}"
}
\`\`\`

## Supported Actions

| Action | Aliases | Description |
|--------|---------|-------------|
| buy | long, buy_to_open, enter_long | Open long position |
| sell | short, sell_to_open, enter_short | Open short position |
| close | exit, flatten, close_all | Close current position |
| reverse | flip | Reverse position direction |

## Symbol Mapping

Tradevanish automatically maps TradingView symbols to broker contract IDs:

| Symbol | TopStepX | Tradovate |
|--------|----------|-----------|
| NQ | CON.F.US.NQ.{month}{year} | NQ |
| ES | CON.F.US.ES.{month}{year} | ES |
| MNQ | CON.F.US.MNQ.{month}{year} | MNQ |
| MES | CON.F.US.MES.{month}{year} | MES |
| GC | CON.F.US.GC.{month}{year} | GC |
| CL | CON.F.US.CL.{month}{year} | CL |

## Custom Code Example

\`\`\`bash
curl -X POST https://www.tradevanish.com/api/signals/tv_YOUR_KEY \\
  -H "Content-Type: application/json" \\
  -d '{"ticker": "NQ", "action": "buy", "qty": 1}'
\`\`\`
        `
      }
    ]
  },
  {
    section: "Pro+ Features",
    items: [
      {
        slug: "rest-api",
        title: "REST API",
        icon: "🔌",
        content: `
# REST API (Pro+)

Programmatic access to your Tradevanish account. Manage accounts, proxies, trades, and listeners via API.

## Authentication

Generate an API key in **Profile > REST API > Generate Key**.

\`\`\`bash
curl -H "Authorization: Bearer pc_live_YOUR_API_KEY" \\
  https://www.tradevanish.com/api/accounts
\`\`\`

API keys are hashed with SHA-256 and stored securely. The raw key is shown only once on creation.

## Endpoints

### Accounts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/accounts | List all connected accounts |
| POST | /api/accounts | Connect a new account |
| DELETE | /api/accounts/:id | Disconnect an account |
| PATCH | /api/accounts/:id/pause | Pause/resume a follower |

### Broker Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/brokers/stats | Get live balance, equity, win rate |
| POST | /api/brokers/topstepx/auth | Authenticate with TopStepX |
| POST | /api/brokers/tradovate/auth | Get Tradovate OAuth URL |

### Proxies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/proxies | List all proxy assignments |
| POST | /api/proxies/:accountId/rotate | Rotate an account's IP |
| POST | /api/proxies/:accountId/test | Test proxy health |
| GET | /api/proxies/providers | List available providers |

### Listeners

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/listeners/start | Start the master listener |
| POST | /api/listeners/stop | Stop the master listener |
| GET | /api/listeners/status | Get listener state and stats |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/settings/risk | Get risk rule configuration |
| PUT | /api/settings/risk | Update risk rules |

### Signals

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/signals/:signalKey | Receive a trading signal (no auth needed) |
| POST | /api/signals/keys | Generate a new signal key |
| GET | /api/signals/keys | List active signal keys |
| GET | /api/signals/history | View signal execution history |

## Rate Limits

API requests are limited to 60 requests per minute per API key.

## Error Responses

\`\`\`json
{
  "error": "plan_required",
  "message": "This feature requires Pro+. Current plan: basic",
  "upgrade_url": "/api/billing/plans"
}
\`\`\`
        `
      },
      {
        slug: "webhooks",
        title: "Webhooks",
        icon: "🪝",
        content: `
# Webhooks (Pro+)

Receive real-time HTTP callbacks for trade executions, listener events, risk alerts, and proxy rotations.

## Setup

1. Go to **Profile > Webhooks**
2. Click **+ Add Webhook**
3. Enter your endpoint URL (e.g., \`https://your-server.com/tradevanish\`)
4. Select the events you want to receive
5. Click **Create Webhook**

You'll receive a webhook secret (\`whsec_...\`) for signature verification.

## Events

| Event | Description |
|-------|-------------|
| trade.executed | Copy trade filled on a follower |
| trade.failed | Follower order rejected |
| listener.connected | Master WebSocket connected |
| listener.disconnected | Master WebSocket dropped |
| risk.drawdown | Account hit drawdown limit |
| proxy.rotated | IP rotation on any account |
| account.connected | New broker account added |

## Payload Format

\`\`\`json
{
  "event": "trade.executed",
  "timestamp": 1713000000,
  "data": {
    "ticker": "NQ",
    "side": "Buy",
    "qty": 2,
    "price": 21500.50,
    "follower": "Tradovate Account #1",
    "latency_ms": 45
  }
}
\`\`\`

## Signature Verification

Every webhook includes an \`X-Tradevanish-Signature\` header:

\`\`\`
X-Tradevanish-Signature: <hmac_sha256>
X-Tradevanish-Event: trade.executed
\`\`\`

Verify with:
\`\`\`javascript
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(timestamp + '.' + rawBody)
  .digest('hex');
\`\`\`

## Testing

Click **Test** next to any webhook in the dashboard to send a test payload to your endpoint.
        `
      },
      {
        slug: "proxy-pools",
        title: "Custom Proxy Pools",
        icon: "🏊",
        content: `
# Custom Proxy Pools (Pro+)

Create dedicated pools of residential IPs for different strategies or regions.

## Create a Pool

1. Go to **Profile > Custom Proxy Pools**
2. Click **+ Add Pool**
3. Configure:
   - **Pool Name** — e.g., "US East Trading"
   - **Provider** — BrightData, Oxylabs, SmartProxy, or IPRoyal
   - **Region** — US East, US West, EU West, Asia Pacific
   - **Pool Size** — Number of IPs to provision
4. Click **Create Pool**

## Using Pools

Assign accounts to specific pools for regional control. Accounts in a pool will only use IPs from that pool's provider and region.

## Pool Rotation

Click **Rotate All** to simultaneously rotate every IP in a pool. Useful for:
- Scheduled rotation before market open
- After any suspicious activity
- Moving to a fresh IP set for a new trading week
        `
      }
    ]
  },
  {
    section: "Security",
    items: [
      {
        slug: "two-factor-auth",
        title: "Two-Factor Authentication",
        icon: "🔐",
        content: `
# Two-Factor Authentication (2FA)

Protect your account with TOTP-based two-factor authentication using any authenticator app.

## Enable 2FA

1. Go to **Profile > Security** (or call \`POST /api/auth/2fa/setup\`)
2. Scan the QR code with Google Authenticator, Authy, or any TOTP app
3. Enter the 6-digit code from your app to verify
4. 2FA is now active — you'll need the code every time you sign in

## Signing In With 2FA

1. Enter your email and password as usual
2. You'll be prompted for your 6-digit authenticator code
3. Enter the current code from your app
4. You're signed in

## Disable 2FA

1. Go to **Profile > Security**
2. Click **Disable 2FA**
3. Enter your account password to confirm
4. 2FA is removed

**Recommendation:** Keep 2FA enabled. Your Tradevanish account controls access to all your prop firm broker connections.
        `
      },
      {
        slug: "risk-management",
        title: "Risk Management",
        icon: "🛡️",
        content: `
# Risk Management

Tradevanish includes built-in risk controls to protect your prop firm accounts.

## Global Risk Rules

Configure in **Settings > Risk Management**:

| Rule | Description | Default |
|------|-------------|---------|
| Max Quantity | Maximum contracts per order | 10 |
| Daily Loss Limit | Stop copying if daily loss exceeds this | $1,500 |
| Max Trades/Day | Maximum number of trades per day | Unlimited |
| Trailing Drawdown | Track running drawdown | Off |
| Kill Switch | Emergency stop all trading | Off |

## Kill Switch

The kill switch immediately halts all copy trading activity. When activated:
- All pending orders are cancelled
- No new orders are placed
- The listener keeps running (so you can see positions)
- A **Kill Switch Activated** email is sent to your inbox

Re-enable from **Settings** after reviewing your positions.

## Per-Follower Overrides (Pro/Pro+)

Customize risk rules per follower account:
- **Size Multiplier** — 0.5x for half size, 2x for double
- **Max Quantity** — Independent limit per account
- **Daily Loss Limit** — Per-account loss threshold

This lets you run different position sizes on different prop firm accounts based on their specific rules.
        `
      }
    ]
  },
  {
    section: "Account",
    items: [
      {
        slug: "billing",
        title: "Billing & Plans",
        icon: "💳",
        content: `
# Billing & Plans

## Plan Comparison

| | Basic | Pro | Pro+ |
|---|:-:|:-:|:-:|
| **Price** | $39/mo | $69/mo | $89/mo |
| **Followers** | 5 | Unlimited | Unlimited |
| **Proxy Providers** | BrightData | 4 providers | 4 providers |
| **Follower Overrides** | ❌ | ✅ | ✅ |
| **TradingView Signals** | ✅ | ✅ | ✅ |
| **REST API** | ❌ | ❌ | ✅ |
| **Webhooks** | ❌ | ❌ | ✅ |
| **Custom Proxy Pools** | ❌ | ❌ | ✅ |

## Changing Plans

Go to **Profile > Subscription > Change Plan** to upgrade or downgrade. Changes take effect immediately. Pro-rated billing is handled automatically.

## Payment Methods

We accept all major credit and debit cards through Stripe. Your card details are never stored on our servers.
        `
      },
      {
        slug: "notifications",
        title: "Notifications",
        icon: "🔔",
        content: `
# Notifications

Tradevanish sends automated email notifications for critical trading events.

## Notification Types

| Notification | Description |
|-------------|-------------|
| Welcome | Sent when you create your account |
| Password Reset | 6-digit code for password recovery |
| Password Changed | Confirmation when password is updated |
| 2FA Enabled/Disabled | Security status changes |
| Account Connected | New broker account linked |
| Trade Copied | Successful copy execution |
| Trade Failed | Follower order rejected |
| Drawdown Alert | Account hits loss threshold |
| Listener Disconnected | WebSocket connection dropped |
| Proxy Rotated | IP address changed |
| Kill Switch | Emergency stop activated |
| Daily P&L Summary | End-of-day performance report |

## Configure

Go to **Profile > Notifications** to toggle individual notification types and choose your delivery channel (Email, SMS, or Both).
        `
      }
    ]
  }
];

// ─── Markdown Renderer ───────────────────────────────────────────────────────
function Markdown({ text }) {
  if (!text) return null;
  const lines = text.trim().split('\n');
  const elements = [];
  let i = 0;
  let inCodeBlock = false;
  let codeLines = [];
  let codeLang = '';
  let inTable = false;
  let tableRows = [];

  const flushTable = () => {
    if (!tableRows.length) return;
    const headers = tableRows[0];
    const rows = tableRows.slice(2);
    elements.push(
      <div key={`tbl-${i}`} className="tv-doc-table-wrap">
        <table className="tv-doc-table">
          <thead><tr>{headers.map((h, j) => <th key={j} dangerouslySetInnerHTML={{ __html: renderInline(h.trim()) }} />)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} dangerouslySetInnerHTML={{ __html: renderInline(c.trim()) }} />)}</tr>)}</tbody>
        </table>
      </div>
    );
    tableRows = [];
    inTable = false;
  };

  const renderInline = (t) => {
    if (!t) return t;
    return t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\`(.+?)\`/g, '<code class="tv-doc-inline-code">$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="tv-doc-link">$1</a>')
      .replace(/❌/g, '<span style="opacity:0.3">—</span>')
      .replace(/✅/g, '<span style="color:#00E5A0">✓</span>');
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(<pre key={`code-${i}`} className="tv-doc-code"><code>{codeLines.join('\n')}</code></pre>);
        codeLines = []; inCodeBlock = false;
      } else {
        if (inTable) flushTable();
        codeLang = line.slice(3).trim();
        inCodeBlock = true;
      }
      i++; continue;
    }
    if (inCodeBlock) { codeLines.push(line); i++; continue; }

    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1);
      if (!inTable) inTable = true;
      tableRows.push(cells);
      i++; continue;
    } else if (inTable) {
      flushTable();
    }

    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="tv-doc-h1">{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="tv-doc-h2" id={line.slice(3).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="tv-doc-h3">{line.slice(4)}</h3>);
    } else if (line.startsWith('- ')) {
      elements.push(<div key={i} className="tv-doc-li"><span className="tv-doc-bullet">▸</span><span dangerouslySetInnerHTML={{ __html: renderInline(line.slice(2)) }} /></div>);
    } else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\./)[1];
      elements.push(<div key={i} className="tv-doc-li tv-doc-oli"><span className="tv-doc-onum">{num}</span><span dangerouslySetInnerHTML={{ __html: renderInline(line.replace(/^\d+\.\s/, '')) }} /></div>);
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="tv-doc-spacer" />);
    } else {
      elements.push(<p key={i} className="tv-doc-p" dangerouslySetInnerHTML={{ __html: renderInline(line) }} />);
    }
    i++;
  }
  if (inTable) flushTable();

  return <div className="tv-doc-content">{elements}</div>;
}

// ─── Main Docs Component ─────────────────────────────────────────────────────
export default function DocsPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug ? params.slug.join('/') : '';
  const [search, setSearch] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  const currentDoc = DOCS.flatMap(s => s.items).find(d => d.slug === slug) || DOCS[0].items[0];

  const filteredDocs = search
    ? DOCS.map(s => ({ ...s, items: s.items.filter(d => d.title.toLowerCase().includes(search.toLowerCase()) || d.content.toLowerCase().includes(search.toLowerCase())) })).filter(s => s.items.length)
    : DOCS;

  const navigate = (s) => {
    router.push(s ? `/docs/${s}` : '/docs');
    setMobileNav(false);
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .tv-docs { display: flex; min-height: 100vh; background: #050508; color: #fff; font-family: 'Inter', -apple-system, sans-serif; }
        .tv-docs-side { width: 280px; background: #08080d; border-right: 1px solid rgba(255,255,255,0.06); padding: 24px 0; position: fixed; top: 0; left: 0; bottom: 0; overflow-y: auto; z-index: 100; }
        .tv-docs-side-brand { display: flex; align-items: center; gap: 10px; padding: 0 20px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 16px; }
        .tv-docs-side-brand img { width: 28px; height: 28px; border-radius: 6px; }
        .tv-docs-side-brand span { font-weight: 700; font-size: 16px; letter-spacing: -0.02em; }
        .tv-docs-side-brand a { color: rgba(255,255,255,0.3); font-size: 11px; text-decoration: none; margin-left: auto; }
        .tv-docs-side-brand a:hover { color: #6366f1; }
        .tv-docs-search { margin: 0 16px 16px; }
        .tv-docs-search input { width: 100%; padding: 8px 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; color: #fff; font-size: 13px; font-family: inherit; outline: none; }
        .tv-docs-search input:focus { border-color: rgba(99,102,241,0.4); }
        .tv-docs-search input::placeholder { color: rgba(255,255,255,0.25); }
        .tv-docs-section-title { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: rgba(255,255,255,0.3); padding: 12px 20px 6px; text-transform: uppercase; }
        .tv-docs-nav-item { display: flex; align-items: center; gap: 8px; padding: 8px 20px; font-size: 13px; color: rgba(255,255,255,0.5); cursor: pointer; transition: all 0.15s; border: none; background: none; width: 100%; text-align: left; font-family: inherit; }
        .tv-docs-nav-item:hover { color: #fff; background: rgba(255,255,255,0.03); }
        .tv-docs-nav-item.active { color: #fff; background: rgba(99,102,241,0.08); border-right: 2px solid #6366f1; }
        .tv-docs-nav-icon { font-size: 14px; width: 20px; text-align: center; }
        .tv-docs-main { flex: 1; margin-left: 280px; padding: 40px 60px 80px; max-width: 820px; }
        .tv-doc-content { line-height: 1.7; }
        .tv-doc-h1 { font-size: 32px; font-weight: 800; letter-spacing: -0.03em; margin: 0 0 8px; color: #fff; }
        .tv-doc-h2 { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin: 40px 0 12px; color: #fff; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.04); }
        .tv-doc-h3 { font-size: 15px; font-weight: 600; margin: 24px 0 8px; color: rgba(255,255,255,0.9); }
        .tv-doc-p { font-size: 14px; color: rgba(255,255,255,0.65); margin: 0 0 12px; }
        .tv-doc-p strong { color: #fff; font-weight: 600; }
        .tv-doc-spacer { height: 8px; }
        .tv-doc-li { display: flex; gap: 8px; font-size: 14px; color: rgba(255,255,255,0.65); margin: 4px 0; padding-left: 4px; }
        .tv-doc-li strong { color: #fff; }
        .tv-doc-bullet { color: #6366f1; font-size: 10px; margin-top: 5px; flex-shrink: 0; }
        .tv-doc-oli { padding-left: 0; }
        .tv-doc-onum { color: #6366f1; font-weight: 700; font-size: 13px; min-width: 20px; flex-shrink: 0; }
        .tv-doc-code { background: #0c0c14; border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 16px 20px; margin: 12px 0 16px; overflow-x: auto; }
        .tv-doc-code code { font-family: 'JetBrains Mono', 'SF Mono', monospace; font-size: 12.5px; color: rgba(255,255,255,0.7); line-height: 1.6; }
        .tv-doc-inline-code { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: rgba(99,102,241,0.1); color: #a5b4fc; padding: 2px 6px; border-radius: 4px; }
        .tv-doc-link { color: #6366f1; text-decoration: none; border-bottom: 1px solid rgba(99,102,241,0.3); }
        .tv-doc-link:hover { color: #818cf8; }
        .tv-doc-table-wrap { overflow-x: auto; margin: 12px 0 16px; }
        .tv-doc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .tv-doc-table th { text-align: left; padding: 10px 14px; background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.5); font-weight: 600; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .tv-doc-table td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); color: rgba(255,255,255,0.6); }
        .tv-doc-table td strong { color: #fff; }
        .tv-doc-table tr:hover td { background: rgba(255,255,255,0.015); }
        .tv-docs-mobile-btn { display: none; position: fixed; top: 12px; left: 12px; z-index: 200; background: #0c0c14; border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 14px; }
        @media (max-width: 768px) {
          .tv-docs-side { transform: translateX(-100%); transition: transform 0.2s; }
          .tv-docs-side.open { transform: translateX(0); }
          .tv-docs-main { margin-left: 0; padding: 60px 20px 80px; }
          .tv-docs-mobile-btn { display: block; }
        }
      `}</style>
      <div className="tv-docs">
        <button className="tv-docs-mobile-btn" onClick={() => setMobileNav(!mobileNav)}>☰ Docs</button>
        <nav className={`tv-docs-side ${mobileNav ? 'open' : ''}`}>
          <div className="tv-docs-side-brand">
            <img src="/logo.png" alt="TV" />
            <span>Docs</span>
            <a href="/">← App</a>
          </div>
          <div className="tv-docs-search">
            <input placeholder="Search docs..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {filteredDocs.map(section => (
            <div key={section.section}>
              <div className="tv-docs-section-title">{section.section}</div>
              {section.items.map(item => (
                <button key={item.slug} className={`tv-docs-nav-item ${currentDoc.slug === item.slug ? 'active' : ''}`} onClick={() => navigate(item.slug)}>
                  <span className="tv-docs-nav-icon">{item.icon}</span>
                  {item.title}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <main className="tv-docs-main">
          <Markdown text={currentDoc.content} />
        </main>
      </div>
    </>
  );
}

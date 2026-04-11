# Phantom Copy

**The Stealth Standard for Modern Prop Trading**

Copy trading platform with dedicated residential proxy IP isolation per account. Master trader signals replicate to unlimited follower accounts. Each connection routes through its own unique IP.

## Quick Start

```bash
# API server
cd api && cp .env.example .env
npm install && npm run migrate && npm run dev

# Web dashboard
cd web && cp .env.example .env.local
npm install && npm run dev
```

## Railway Deployment

Three services from one repo:

| Service | Root Dir | Build | Start |
|---------|----------|-------|-------|
| API | `/api` | `npm install` | `npm run migrate && npm start` |
| Web | `/web` | `npm install && npm run build` | `npm start` |
| PostgreSQL | - | Railway managed | - |

## Architecture

- **API**: Express, PostgreSQL, JWT + API key auth, Stripe billing, plan-gated middleware
- **Web**: Next.js 14, React dashboard with 7 pages + onboarding
- **Brokers**: Tradovate (OAuth/WebSocket), TopStepX (JWT/SignalR), Rithmic, NinjaTrader
- **Proxies**: BrightData, Oxylabs, SmartProxy, IPRoyal with sticky sessions

## Plans

| | Basic $39 | Pro $69 | Pro+ $89 |
|---|---|---|---|
| Followers | 5 | Unlimited | Unlimited |
| Providers | 1 | All | All |
| Overrides | - | Yes | Yes |
| Custom Pools | - | - | Yes |
| REST API | - | - | Yes |
| Webhooks | - | - | Yes |

## License

Proprietary. All rights reserved.

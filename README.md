# Phantom Copy

**The Stealth Standard for Modern Prop Trading**

Copy trading platform where each connected trading account routes API calls through a dedicated residential proxy IP. Master trader signals replicate to unlimited follower accounts with per-account IP isolation.

## Architecture

- **Dashboard**: React (JSX) single-file app with 7 pages (Overview, Accounts, IP Mixer, Trade Log, Settings, Profile, Onboarding)
- **Backend**: Node.js/Express with PostgreSQL
- **Brokers**: Tradovate (OAuth/WebSocket), TopStepX/ProjectX (JWT/SignalR), Rithmic (Protobuf), NinjaTrader
- **Proxies**: Residential proxy pool (BrightData, Oxylabs, SmartProxy, IPRoyal) with sticky sessions per account
- **Billing**: Stripe subscription with three tiers (Basic $39, Pro $69, Pro+ $89)
- **Invoices**: Python/reportlab PDF generator matched to dashboard dark theme

## Plans

| Feature | Basic | Pro | Pro+ |
|---|---|---|---|
| Follower accounts | 5 | Unlimited | Unlimited |
| Proxy providers | 1 | All | All |
| Per-follower overrides | No | Yes | Yes |
| Custom proxy pools | No | No | Yes |
| REST API access | No | No | Yes |
| Webhook integrations | No | No | Yes |
| SLA guarantee | No | No | Yes |

## Project Structure

```
phantom-copy/
  src/
    dashboard/
      App.jsx              # Full interactive dashboard (React)
    backend/
      listeners/
        tradovate-listener.js   # Tradovate + Rithmic master listener + copy executor
        projectx-listener.js    # TopStepX/ProjectX SignalR listener + copy client
      services/
        proplus-services.js     # Custom Proxy Pools, API Keys, Webhooks
  docs/
    backend-architecture.md     # Full backend architecture spec
  invoices/
    generator.py                # Branded PDF invoice generator
    invoice-INV-0047.pdf        # Sample: standard monthly
    invoice-INV-0048-upgrade.pdf # Sample: upgrade proration
    invoice-INV-0042-with-tax.pdf # Sample: multi-line + tax
```

## Broker Integrations

### Tradovate
OAuth flow, WebSocket listener, position delta detection, bracket replication, token refresh at 85min.

### TopStepX (ProjectX Gateway)
JWT auth via `POST /api/Auth/loginKey`, SignalR User Hub for real-time events (`GatewayUserPosition`, `GatewayUserOrder`, `GatewayUserTrade`), REST order placement via `POST /api/Order/place`. Token refresh at 23h.

### Rithmic
R|Protocol/Protobuf WebSocket, referenced in architecture but listener uses similar pattern to Tradovate.

## Connect Flow
1. **Platform** - Select broker (Tradovate, TopStepX, Rithmic, NinjaTrader)
2. **Authenticate** - Broker-specific auth (OAuth, API key, credentials)
3. **IP** - Assign dedicated residential proxy
4. **Account** - Select which broker account to listen on (master only)
5. **Launch** - 6-stage boot sequence with live log

## License

Proprietary. All rights reserved.

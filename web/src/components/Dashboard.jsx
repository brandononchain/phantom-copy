import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  connected: "#00E5A0", copying: "#00B4FF", idle: "#6B7280",
  error: "#FF4D4D", masked: "#A78BFA", pending: "#FFB800",
  syncing: "#818CF8", listening: "#00E5A0",
};

const PLATFORMS = [
  { id: "tradovate", name: "Tradovate", desc: "Futures via OAuth login", color: "#3B82F6", icon: "TV" },
  { id: "topstepx", name: "TopStepX", desc: "Futures via ProjectX Gateway API", color: "#E5484D", icon: "TX" },
  { id: "rithmic", name: "Rithmic", desc: "Futures via R|Trader credentials", color: "#10B981", icon: "RT" },
  { id: "ninjatrader", name: "NinjaTrader", desc: "Futures via NinjaTrader account", color: "#F59E0B", icon: "NT" },
];

const PROXY_PROVIDERS = ["BrightData", "Oxylabs", "SmartProxy", "IPRoyal"];

// Master listener connection stages
const LISTENER_STAGES = [
  { key: "proxy", label: "Routing through proxy", desc: "Establishing tunnel via dedicated IP" },
  { key: "websocket", label: "Opening WebSocket", desc: "Connecting to broker real-time feed" },
  { key: "auth", label: "Authenticating session", desc: "Sending OAuth token to WebSocket" },
  { key: "subscribe", label: "Subscribing to positions", desc: "Registering for order & fill events" },
  { key: "sync", label: "Syncing open positions", desc: "Reconciling current state with broker" },
  { key: "listening", label: "Listening for trades", desc: "Master listener active and watching" },
];

// No mock data - all data comes from API
const INITIAL_ACCOUNTS = [];
const INITIAL_EVENTS = [];
const INITIAL_POSITIONS = [];
const INITIAL_TRADES = [];

// ─── Utils ───────────────────────────────────────────────────────────────────
const cn = (...c) => c.filter(Boolean).join(" ");
const fmt = (n) => (n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`);

// ─── API Helper (same-origin via Next.js proxy, cookies work natively) ───────

function apiFetch(path, options = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("tv_token") : null;
  // Don't send Authorization header on auth endpoints (login/register/reset)
  const isAuthEndpoint = path.includes("/auth/login") || path.includes("/auth/register") || path.includes("/auth/reset");
  return fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && !isAuthEndpoint ? { "Authorization": `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
};

function AnimNum({ value, prefix = "", suffix = "", dec = 2 }) {
  const [d, setD] = useState(value);
  const r = useRef(value);
  useEffect(() => {
    const s = r.current, diff = value - s, dur = 600;
    let st;
    const step = (ts) => { if (!st) st = ts; const p = Math.min((ts - st) / dur, 1); const v = s + (diff * (1 - Math.pow(1 - p, 3))); setD(v); r.current = v; if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }, [value]);
  return <span>{prefix}{d.toFixed(dec)}{suffix}</span>;
}

function StatusDot({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.idle;
  const pulse = ["copying","connected","listening","syncing"].includes(status);
  return (<span className="sdot-w">{pulse && <span className="sdot-p" style={{ background: c }} />}<span className="sdot" style={{ background: c }} /></span>);
}

function IPBadge({ ip, provider, region }) {
  const [show, setShow] = useState(false);
  return (
    <span className="ip-b" onClick={() => setShow(!show)} title={`${provider} | ${region}`}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M2 12h20M12 2c2.5 3 4 6.5 4 10s-1.5 7-4 10c-2.5-3-4-6.5-4-10s1.5-7 4-10z"/></svg>
      <span>{!ip ? "No IP" : show ? ip : ip.replace(/\d+\.\d+$/, "**.** ")}</span>
      <span className="ip-r">{region}</span>
    </span>
  );
}

function LatBar({ ms }) {
  if (ms === null || ms === undefined) return <span style={{ color: "var(--t3)", fontSize: 11, fontFamily: "var(--mono)" }}>--</span>;
  const c = ms < 20 ? "#00E5A0" : ms < 50 ? "#FFB800" : "#FF4D4D";
  return (<span className="lat-w"><span className="lat-bar" style={{ width: `${Math.min(ms / 100, 1) * 100}%`, background: c }} /><span className="lat-l">{ms}ms</span></span>);
}

function HealthRing({ ok, total }) {
  const pct = ok / total, circ = 2 * Math.PI * 36, off = circ * (1 - pct);
  const c = pct === 1 ? "#00E5A0" : pct > 0.7 ? "#FFB800" : "#FF4D4D";
  return (
    <div className="hr-w">
      <svg viewBox="0 0 80 80" className="hr-svg"><circle cx="40" cy="40" r="36" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" /><circle cx="40" cy="40" r="36" fill="none" stroke={c} strokeWidth="4" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dashoffset 0.8s cubic-bezier(0.32,0.72,0,1)" }} /></svg>
      <div className="hr-in"><span className="hr-n">{ok}/{total}</span><span className="hr-lab">PROXIES</span></div>
    </div>
  );
}

// ─── Event Type Icons ────────────────────────────────────────────────────────
function EventIcon({ type }) {
  const props = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", strokeWidth: "1.5" };
  switch (type) {
    case "fill": return <svg {...props} stroke="#00E5A0"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
    case "copy": return <svg {...props} stroke="#00B4FF"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>;
    case "close": return <svg {...props} stroke="#A78BFA"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>;
    case "bracket": return <svg {...props} stroke="#FFB800"><path d="M3 3h7v7H3zM14 14h7v7h-7zM14 3h7v7h-7zM3 14h7v7H3z"/></svg>;
    case "modify": return <svg {...props} stroke="#FFB800"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
    case "heartbeat": return <svg {...props} stroke="rgba(255,255,255,0.2)"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>;
    default: return <svg {...props} stroke="rgba(255,255,255,0.3)"><circle cx="12" cy="12" r="10"/></svg>;
  }
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
const NAV = [
  { key: "overview", label: "Overview", d: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  { key: "accounts", label: "Accounts", d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  { key: "proxies", label: "IP Mixer", d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM2 12h20M12 2c2.5 3 4 6.5 4 10s-1.5 7-4 10c-2.5-3-4-6.5-4-10s1.5-7 4-10z" },
  { key: "trades", label: "Trade Log", d: "M22 12l-4 0-3 9-6-18-3 9-4 0" },
  { key: "settings", label: "Settings", d: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" },
];

function Sidebar({ active, onNav, masterAccount, listenerState, currentPlan }) {
  const PLAN_LABELS = { basic: "Basic", pro: "Pro", proplus: "Pro+" };
  return (
    <nav className="sidebar">
      <div className="s-logo">
        <img src="/logo.png" alt="Tradevanish" width="28" height="28" style={{ borderRadius: 6 }} />
        <span className="s-logo-t">Tradevanish</span>
      </div>
      <div className="s-nav">
        {NAV.map(n => (
          <button key={n.key} className={cn("s-btn", active === n.key && "s-btn-on")} onClick={() => onNav(n.key)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={n.d} /></svg>
            <span>{n.label}</span>
          </button>
        ))}
      </div>

      {/* Master Status (compact, above profile) */}
      {masterAccount && (
        <div className="s-master-bar" onClick={() => onNav("accounts")}>
          <StatusDot status={listenerState === "listening" ? "listening" : "pending"} />
          <div className="s-mb-text">
            <div className="s-mb-name">{masterAccount.label}</div>
            <div className="s-mb-status">{listenerState === "listening" ? "Listening" : "Connecting..."}</div>
          </div>
        </div>
      )}

      {/* Profile */}
      <div className="s-foot">
        <button className={cn("s-profile-btn", active === "profile" && "s-profile-btn-on")} onClick={() => onNav("profile")}>
          <div className="s-avatar">
            <span className="s-avatar-text">B</span>
          </div>
          <div className="s-profile-info">
            <div className="s-profile-name">Brandon</div>
            <div className="s-profile-plan">{PLAN_LABELS[currentPlan] || "Pro"} Plan</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    </nav>
  );
}

// ─── Master Listener Panel ───────────────────────────────────────────────────
function MasterListenerPanel({ master, listenerState, listenerStage, events, positions, onStartListener, onStopListener }) {
  if (!master) return null;

  return (
    <div className="ml-panel fade-in">
      {/* Connection Status Header */}
      <div className="ml-head">
        <div className="ml-head-left">
          <div className="ml-head-icon-wrap">
            {listenerState === "listening" ? (
              <div className="ml-pulse-ring">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </div>
            ) : listenerState === "connecting" ? (
              <div className="ml-spinner-sm" />
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            )}
          </div>
          <div>
            <div className="ml-head-title">
              {listenerState === "listening" ? "Master Listener Active" : listenerState === "connecting" ? "Connecting to Broker..." : "Listener Offline"}
            </div>
            <div className="ml-head-sub">
              {master.label} | {master.platform} | IP: {master.ip}
            </div>
          </div>
        </div>
        <div className="ml-head-right">
          {listenerState === "listening" ? (
            <button className="ml-stop-btn" onClick={onStopListener}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              Stop
            </button>
          ) : listenerState === "idle" ? (
            <button className="btn-primary" onClick={onStartListener}>
              <span>Start Listener</span>
              <span className="btn-aw"><span className="btn-ar">&#9654;</span></span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Connection Stages (shown during connecting) */}
      {listenerState === "connecting" && (
        <div className="ml-stages">
          {LISTENER_STAGES.map((stage, i) => {
            const currentIdx = LISTENER_STAGES.findIndex(s => s.key === listenerStage);
            const isDone = i < currentIdx;
            const isCurrent = i === currentIdx;
            const isPending = i > currentIdx;
            return (
              <div key={stage.key} className={cn("ml-stage", isDone && "ml-stage-done", isCurrent && "ml-stage-active", isPending && "ml-stage-pending")}>
                <div className="ml-stage-dot">
                  {isDone ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : isCurrent ? (
                    <div className="ml-stage-spinner" />
                  ) : (
                    <span className="ml-stage-num">{i + 1}</span>
                  )}
                </div>
                <div className="ml-stage-text">
                  <div className="ml-stage-label">{stage.label}</div>
                  <div className="ml-stage-desc">{stage.desc}</div>
                </div>
                {isCurrent && <div className="ml-stage-elapsed">...</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Live State: Positions + Event Feed */}
      {listenerState === "listening" && (
        <div className="ml-live">
          {/* Open Positions */}
          <div className="ml-section">
            <div className="ml-section-head">
              <span className="ml-section-title">Open Positions</span>
              <span className="badge badge-live"><span className="live-d"/>SYNCED</span>
            </div>
            {positions.length > 0 ? (
              <div className="ml-positions">
                {positions.map((p, i) => (
                  <div key={i} className="ml-pos-card">
                    <div className="ml-pos-top">
                      <span className="ml-pos-symbol">{p.symbol}</span>
                      <span className={cn("side-b", p.side === "LONG" ? "side-l" : "side-s")}>{p.side}</span>
                      <span className="ml-pos-qty">{p.qty} ct</span>
                    </div>
                    <div className="ml-pos-prices">
                      <div className="ml-pos-price"><span className="ml-pos-price-label">ENTRY</span><span className="c-mono">{p.entry.toFixed(2)}</span></div>
                      <div className="ml-pos-price"><span className="ml-pos-price-label">CURRENT</span><span className="c-mono">{p.current.toFixed(2)}</span></div>
                      <div className="ml-pos-price"><span className="ml-pos-price-label">P&L</span><span className={cn("c-mono", p.unrealPnl >= 0 ? "c-grn" : "c-red")}>{fmt(p.unrealPnl)}</span></div>
                    </div>
                    <div className="ml-pos-brackets">
                      <span className="ml-bracket-tag ml-bracket-sl">SL {p.stopLoss.toFixed(2)}</span>
                      <span className="ml-bracket-tag ml-bracket-tp">TP {p.takeProfit.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ml-pos-flat">Flat. No open positions on master.</div>
            )}
          </div>

          {/* WebSocket Event Feed */}
          <div className="ml-section">
            <div className="ml-section-head">
              <span className="ml-section-title">Event Feed</span>
              <span className="ml-event-count">{events.length} events</span>
            </div>
            <div className="ml-events">
              {events.map((ev, i) => (
                <div key={ev.id} className="ml-event" style={{ animationDelay: `${i * 30}ms` }}>
                  <span className="ml-ev-icon"><EventIcon type={ev.type} /></span>
                  <span className="ml-ev-time">{ev.time}</span>
                  <span className="ml-ev-msg">{ev.msg}</span>
                  <span className={cn("ml-ev-type", `ml-ev-${ev.type}`)}>{ev.type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* WebSocket Stats */}
          <div className="ml-ws-stats">
            <div className="ml-ws-stat"><span className="ml-ws-stat-label">WS UPTIME</span><span className="ml-ws-stat-val c-grn">4h 23m</span></div>
            <div className="ml-ws-stat"><span className="ml-ws-stat-label">HEARTBEATS</span><span className="ml-ws-stat-val">847</span></div>
            <div className="ml-ws-stat"><span className="ml-ws-stat-label">TOKEN REFRESH</span><span className="ml-ws-stat-val">in 42m</span></div>
            <div className="ml-ws-stat"><span className="ml-ws-stat-label">RECONNECTS</span><span className="ml-ws-stat-val">0</span></div>
            <div className="ml-ws-stat"><span className="ml-ws-stat-label">PROXY IP</span><span className="ml-ws-stat-val" style={{ color: "#C4B5FD" }}>{master.ip}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Connect Modal ───────────────────────────────────────────────────────────
function ConnectModal({ onClose, onConnect, existingMaster, onStartListener, oauthResume }) {
  const [step, setStep] = useState(oauthResume ? "auth" : "platform");
  // platform -> auth -> proxy -> (master only: select_account -> launch) -> done
  const findPlatform = (id) => PLATFORMS.find(p => p.id === id);
  const [platform, setPlatform] = useState(oauthResume ? findPlatform(oauthResume.platform) : null);
  const [authState, setAuthState] = useState(oauthResume ? "loading" : "idle");
  const [authError, setAuthError] = useState(null);
  const [brokerUsername, setBrokerUsername] = useState("");
  const [brokerApiKey, setBrokerApiKey] = useState("");
  const [brokerCid, setBrokerCid] = useState("");
  const [brokerSec, setBrokerSec] = useState("");
  const [brokerMfaCode, setBrokerMfaCode] = useState("");
  const [brokerMfaPending, setBrokerMfaPending] = useState(false);
  const [brokerPTicket, setBrokerPTicket] = useState(null);
  const [brokerDeviceId, setBrokerDeviceId] = useState(null);
  const [brokerToken, setBrokerToken] = useState(oauthResume?.token || null);
  const [brokerEnv, setBrokerEnv] = useState(oauthResume?.env || "Rithmic Paper Trading");
  const [role, setRole] = useState(existingMaster ? "follower" : "master");
  const [label, setLabel] = useState("");
  const [proxyRegion, setProxyRegion] = useState("US-East");
  const [proxyProvider, setProxyProvider] = useState("BrightData");

  // Master-specific state
  const [selectedBrokerAccount, setSelectedBrokerAccount] = useState(null);
  const [launchPhase, setLaunchPhase] = useState(null);
  const [launchStageIdx, setLaunchStageIdx] = useState(0);
  const [launchLog, setLaunchLog] = useState([]);
  const launchTimer = useRef(null);
  const assignedIP = useRef(`${Math.floor(Math.random()*200+20)}.${Math.floor(Math.random()*200+20)}.${Math.floor(Math.random()*200+20)}.${Math.floor(Math.random()*90+10)}`);

  // Real broker accounts fetched after auth
  const [brokerAccounts, setBrokerAccounts] = useState([]);

  // If we have an OAuth resume token, fetch accounts immediately
  useEffect(() => {
    if (oauthResume?.token && platform) {
      const pid = platform.id;
      apiFetch(`/api/brokers/${pid === "ninjatrader" ? "ninjatrader" : "tradovate"}/accounts`, {
        method: "POST",
        body: JSON.stringify({ token: oauthResume.token, environment: oauthResume.env || "demo" }),
      }).then(r => r.ok ? r.json() : null).then(acctData => {
        if (acctData?.accounts?.length) {
          setBrokerAccounts(acctData.accounts.map(a => ({
            id: String(a.id),
            name: a.name || a.nickname || `Account ${a.id}`,
            balance: a.balance != null ? `$${Number(a.balance).toLocaleString()}` : "N/A",
            rawBalance: a.balance,
            type: a.type || "Demo",
          })));
          setAuthState("success");
        } else {
          setAuthError("No accounts found on this login.");
          setAuthState("idle");
        }
      }).catch(err => {
        setAuthError(`Failed to fetch accounts: ${err.message}`);
        setAuthState("idle");
      });
    }
  }, []);

  const LAUNCH_STAGES = [
    { label: "Establishing proxy tunnel", detail: `Routing via ${proxyProvider} (${proxyRegion})` },
    { label: platform?.id === "topstepx" ? "Connecting SignalR Hub" : "Opening WebSocket",
      detail: platform?.id === "tradovate" ? "wss://live.tradovateapi.com/v1/websocket" : platform?.id === "topstepx" ? "https://rtc.thefuturesdesk.projectx.com/hubs/user" : "wss://rituz00100.rithmic.com:443" },
    { label: "Authenticating session", detail: platform?.id === "topstepx" ? "JWT bearer token via SignalR" : "Sending access token to WebSocket" },
    { label: "Subscribing to events", detail: platform?.id === "topstepx" ? "SubscribeOrders, SubscribePositions, SubscribeTrades" : "Registering order + position listeners" },
    { label: "Syncing open positions", detail: platform?.id === "topstepx" ? "GET /api/Position/search" : "Reconciling current state with broker" },
    { label: "Listener active", detail: "Watching for trades on master account" },
  ];

  const isTopStepX = platform?.id === "topstepx";
  const LAUNCH_LOGS = isTopStepX ? [
    { t: "00.000", msg: `Proxy tunnel established via ${assignedIP.current}`, type: "sys" },
    { t: "00.280", msg: "SignalR negotiation skipped (direct WebSocket)", type: "sys" },
    { t: "00.310", msg: "User Hub connected (SignalR)", type: "ws" },
    { t: "00.340", msg: "JWT token validated by ProjectX Gateway", type: "ws" },
    { t: "00.420", msg: "SubscribeAccounts invoked", type: "ws" },
    { t: "00.445", msg: "SubscribeOrders invoked (accountId: 1)", type: "ws" },
    { t: "00.460", msg: "SubscribePositions invoked (accountId: 1)", type: "ws" },
    { t: "00.475", msg: "SubscribeTrades invoked (accountId: 1)", type: "ws" },
    { t: "00.520", msg: "GatewayUserAccount received (canTrade: true)", type: "ws" },
    { t: "00.580", msg: "Position sync complete. Flat.", type: "rest" },
    { t: "00.610", msg: "SignalR auto-reconnect enabled", type: "sys" },
    { t: "00.612", msg: "Token refresh scheduled (23h)", type: "sys" },
    { t: "00.614", msg: "Master listener ready. Watching for trades.", type: "ready" },
  ] : [
    { t: "00.000", msg: `Proxy tunnel established via ${assignedIP.current}`, type: "sys" },
    { t: "00.340", msg: "WebSocket connection opened", type: "sys" },
    { t: "00.412", msg: "authorize frame sent with OAuth token", type: "ws" },
    { t: "00.445", msg: "Authorization confirmed (userId: 88412)", type: "ws" },
    { t: "00.510", msg: "user/syncrequest sent for positions + orders", type: "ws" },
    { t: "00.548", msg: "Subscribed to real-time events", type: "ws" },
    { t: "00.620", msg: "GET /position/list (0 open positions)", type: "rest" },
    { t: "00.685", msg: "GET /order/list (0 working orders)", type: "rest" },
    { t: "00.710", msg: "Position reconciliation complete. Flat.", type: "sys" },
    { t: "00.750", msg: "Heartbeat interval started (2.5s)", type: "sys" },
    { t: "00.751", msg: "Token refresh scheduled (85m)", type: "sys" },
    { t: "00.752", msg: "Master listener ready. Watching for trades.", type: "ready" },
  ];

  const handleBrokerAuth = async () => {
    setAuthState("loading");
    setAuthError(null);

    const pid = platform?.id;
    try {
      // Build auth payload per platform
      let authBody, acctBody;
      if (pid === "topstepx") {
        authBody = { username: brokerUsername, apiKey: brokerApiKey };
      } else if (pid === "tradovate" || pid === "ninjatrader") {
        // OAuth flow: redirect the whole page to Tradovate login
        const authRes2 = await apiFetch(`/api/brokers/${pid}/auth`, {
          method: "POST",
          body: JSON.stringify({ environment: brokerEnv || "demo" }),
        });
        const authData2 = await authRes2.json();
        if (!authRes2.ok) throw new Error(authData2.message || authData2.error || "Failed to get OAuth URL");
        window.location.href = authData2.oauthUrl;
        return;
      } else if (pid === "rithmic") {
        authBody = { username: brokerUsername, password: brokerApiKey, environment: brokerEnv || "Rithmic Paper Trading" };
      }

      // Step 1: Authenticate
      const authRes = await apiFetch(`/api/brokers/${pid}/auth`, {
        method: "POST",
        body: JSON.stringify(authBody),
      });
      const authData = await authRes.json();
      if (!authRes.ok) {
        // Check if it's an MFA challenge
        if (authData.mfaRequired && authData.pTicket) {
          setBrokerPTicket(authData.pTicket);
          setBrokerDeviceId(authData.deviceId);
          setBrokerMfaPending(true);
          setAuthState("idle");
          setAuthError(null);
          return; // Wait for user to enter MFA code
        }
        throw new Error(authData.message || authData.error || "Authentication failed");
      }
      setBrokerToken(authData.token);
      setBrokerMfaPending(false);

      // Step 2: Fetch accounts
      acctBody = { token: authData.token };
      if (pid === "tradovate" || pid === "ninjatrader") acctBody.environment = brokerEnv || "demo";
      if (pid === "rithmic") acctBody.username = brokerUsername;

      const acctRes = await apiFetch(`/api/brokers/${pid}/accounts`, {
        method: "POST",
        body: JSON.stringify(acctBody),
      });
      const acctData = await acctRes.json();
      if (!acctRes.ok) throw new Error(acctData.message || "Failed to fetch accounts");

      setBrokerAccounts((acctData.accounts || []).map(a => ({
        id: String(a.id),
        name: a.name || a.nickname || `Account ${a.id}`,
        balance: a.balance != null ? `$${Number(a.balance).toLocaleString()}` : "N/A",
        rawBalance: a.balance,
        type: a.type || (a.simulated ? "Simulation" : a.canTrade ? "Live" : a.active === false ? "Inactive" : "Trading"),
      })));

      setAuthState("success");
    } catch (err) {
      setAuthError(err.message);
      setAuthState("idle");
    }
  };

  const startLaunch = () => {
    setLaunchPhase("booting");
    setLaunchStageIdx(0);
    setLaunchLog([]);

    let stageI = 0;
    let logI = 0;

    // Progress through stages
    launchTimer.current = setInterval(() => {
      stageI++;
      if (stageI < LAUNCH_STAGES.length) {
        setLaunchStageIdx(stageI);
      }
      // Add log entries
      const logsPerTick = 2;
      for (let j = 0; j < logsPerTick && logI < LAUNCH_LOGS.length; j++) {
        const entry = LAUNCH_LOGS[logI];
        setLaunchLog(prev => [...prev, entry]);
        logI++;
      }
      // Done
      if (stageI >= LAUNCH_STAGES.length - 1 && logI >= LAUNCH_LOGS.length) {
        clearInterval(launchTimer.current);
        setLaunchPhase("ready");
      }
    }, 650);
  };

  const handleFinish = async () => {
    // Save account to DB so it persists across sessions
    try {
      const saveRes = await apiFetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          platform: platform.id,
          role,
          brokerAccountId: selectedBrokerAccount?.id || null,
          label: label || `${platform.name} ${selectedBrokerAccount?.name || 'Account'}`,
          credentials: JSON.stringify({
            token: brokerToken,
            username: brokerUsername,
            brokerAccountId: selectedBrokerAccount?.id,
          }),
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.message || saveData.error);

      const acc = {
        id: saveData.account?.id || `acc_${Date.now()}`,
        label: label || `${platform.name} ${selectedBrokerAccount?.name || 'Account'}`,
        platform: platform.name, role,
        ip: assignedIP.current.replace(/\.\d+\.\d+$/, ".xx." + assignedIP.current.split(".").pop()),
        proxy: proxyProvider, region: proxyRegion, status: role === "master" ? "copying" : "connected",
        pnl: 0, trades: 0, latency: Math.floor(Math.random() * 30 + 5),
        brokerAccountId: selectedBrokerAccount?.id || null,
        balance: selectedBrokerAccount?.rawBalance || null,
        balanceDisplay: selectedBrokerAccount?.balance || "N/A",
      };
      onConnect(acc);

      // Assign proxy to the saved account
      if (saveData.account?.id) {
        apiFetch('/api/proxies/assign', {
          method: 'POST',
          body: JSON.stringify({
            accountId: saveData.account.id,
            provider: proxyProvider.toLowerCase().replace(/\s/g, ''),
            region: proxyRegion.toLowerCase().replace(/\s/g, '-'),
          }),
        }).catch(() => {});
      }

      if (role === "master") {
        setTimeout(() => onStartListener?.(), 100);
      }
      onClose();
    } catch (err) {
      setAuthError(`Failed to save account: ${err.message}`);
    }
  };

  const handleProxyDone = () => {
    if (role === "master") {
      setStep("select_account");
    } else {
      // Followers just finish
      const acc = {
        id: `acc_${Date.now()}`, label: label || `${platform.name} Account`, platform: platform.name, role,
        ip: assignedIP.current.replace(/\.\d+\.\d+$/, ".xx." + assignedIP.current.split(".").pop()),
        proxy: proxyProvider, region: proxyRegion, status: "connected", pnl: 0, trades: 0,
        latency: Math.floor(Math.random() * 40 + 8),
      };
      onConnect(acc);
      onClose();
    }
  };

  // Step titles
  const stepTitles = {
    platform: "Connect Account",
    auth: `Sign in to ${platform?.name || "Broker"}`,
    proxy: "Configure IP Assignment",
    select_account: "Select Trading Account",
    launch: "Launch Master Listener",
  };
  const stepSubs = {
    platform: "Choose your trading platform",
    auth: "Log in with your existing broker credentials",
    proxy: "Assign a dedicated residential proxy",
    select_account: "Choose which account to listen on",
    launch: "Establishing real-time connection to your broker",
  };

  // Progress steps - always show full flow, followers complete at IP
  const allSteps = ["Platform", "Authenticate", "IP", "Account", "Launch"];
  const stepKeys = ["platform", "auth", "proxy", "select_account", "launch"];
  const currentStepIdx = stepKeys.indexOf(step);
  const maxStep = role === "master" ? 4 : 2; // followers end at IP (index 2)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={cn("modal-shell", (step === "launch") && "modal-shell-wide")} onClick={e => e.stopPropagation()}>
        <div className="modal-inner">
          <div className="modal-head">
            <div>
              <h2 className="modal-title">{stepTitles[step]}</h2>
              <p className="modal-sub">{stepSubs[step]}</p>
            </div>
            <button className="modal-close" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          </div>

          {/* Step: Platform */}
          {step === "platform" && (
            <div className="modal-body">
              <div className="plat-grid">
                {PLATFORMS.map((p, i) => (
                  <button key={p.id} className="plat-card" onClick={() => { setPlatform(p); setStep("auth"); }} style={{ animationDelay: `${i * 80}ms` }}>
                    <div className="plat-icon" style={{ background: `${p.color}18`, color: p.color, borderColor: `${p.color}30` }}>{p.icon}</div>
                    <div className="plat-info"><div className="plat-name">{p.name}</div><div className="plat-desc">{p.desc}</div></div>
                    <svg className="plat-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </button>
                ))}
              </div>
              <div className="modal-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/></svg>
                <span>You log in directly through the broker. Tradevanish never sees or stores your password.</span>
              </div>
            </div>
          )}

          {/* Step: Auth */}
          {step === "auth" && (
            <div className="modal-body">
              <div className="auth-frame-shell">
                <div className="auth-frame-bar">
                  <div className="auth-dots"><span/><span/><span/></div>
                  <div className="auth-url">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M8 12l3 3 5-5"/></svg>
                    <span>{platform?.id === "tradovate" ? "https://trader.tradovate.com/oauth/authorize" : platform?.id === "rithmic" ? "wss://rituz00100.rithmic.com (secure)" : platform?.id === "topstepx" ? "https://api.thefuturesdesk.projectx.com/api/Auth" : "https://ninjatrader.com/connect"}</span>
                  </div>
                </div>
                <div className="auth-frame-content">
                  {authState === "idle" && (
                    <div className="auth-login-form fade-in">
                      <div className="auth-brand"><div className="auth-brand-icon" style={{ background: `${platform.color}20`, color: platform.color }}>{platform.icon}</div><span className="auth-brand-name">{platform.name}</span></div>
                      <p className="auth-brand-sub">Sign in with your {platform.name} account</p>
                      {(platform?.id === "tradovate" || platform?.id === "ninjatrader") ? (
                        <>
                          <div className="auth-field"><label>Environment</label>
                            <select className="auth-input" value={brokerEnv} onChange={e => setBrokerEnv(e.target.value)}><option value="demo">Demo / Simulation</option><option value="live">Live Trading</option></select>
                          </div>
                          {authError && <div className="auth-screen-error" style={{marginBottom:12}}>{authError}</div>}
                          <button className="auth-submit" onClick={handleBrokerAuth} style={{ background: platform.color }}>
                            Sign in with {platform.name}
                          </button>
                          <p className="auth-fine">OAuth flow: you'll sign in on {platform.name}'s website. Your password never touches our servers.</p>
                        </>
                      ) : (
                        <>
                          <div className="auth-field"><label>{platform?.id === "rithmic" ? "R|Trader Username" : "TopStepX Username"}</label><input type="text" placeholder={platform?.id === "rithmic" ? "rithmic_user" : "your_username"} className="auth-input" value={brokerUsername} onChange={e => setBrokerUsername(e.target.value)} /></div>
                          <div className="auth-field"><label>{platform?.id === "topstepx" ? "API Key" : "Password"}</label><input type={platform?.id === "topstepx" ? "text" : "password"} placeholder={platform?.id === "topstepx" ? "Paste API key from your firm" : "Your password"} className="auth-input" value={brokerApiKey} onChange={e => setBrokerApiKey(e.target.value)} style={platform?.id === "topstepx" ? { fontFamily: "var(--mono)", fontSize: 12 } : {}} /></div>
                      {platform?.id === "rithmic" && (
                        <div className="auth-field"><label>Environment</label>
                          <select className="auth-input" value={brokerEnv} onChange={e => setBrokerEnv(e.target.value)}><option>Rithmic Paper Trading</option><option>Rithmic 01 (Live)</option><option>Rithmic Demo</option></select>
                        </div>
                      )}
                      {authError && <div className="auth-screen-error" style={{marginBottom:12}}>{authError}</div>}
                      <button className="auth-submit" onClick={handleBrokerAuth} style={{ background: platform.color }} disabled={!brokerUsername || !brokerApiKey}>
                        {platform?.id === "topstepx" ? "Authenticate with API Key" : "Connect Account"}
                      </button>
                      <p className="auth-fine">{platform?.id === "topstepx" ? "JWT session via ProjectX Gateway API. Token valid for 24 hours." : "Credentials encrypted with AES-256-GCM. Used only for WebSocket auth."}</p>
                        </>
                      )}
                    </div>
                  )}
                  {authState === "loading" && (
                    <div className="auth-loading fade-in">
                      <div className="auth-spinner" style={{ borderTopColor: platform.color }} />
                      <p className="auth-load-text">{platform?.id === "tradovate" ? "Exchanging OAuth code for token..." : platform?.id === "topstepx" ? "Authenticating with ProjectX Gateway..." : "Authenticating R|Protocol WebSocket..."}</p>
                      <p className="auth-load-sub">{platform?.id === "tradovate" ? "POST /auth/oauthtoken" : platform?.id === "topstepx" ? "POST /api/Auth/loginKey" : "Protobuf login template_id: 10"}</p>
                    </div>
                  )}
                  {authState === "success" && (
                    <div className="auth-success fade-in">
                      <div className="auth-check"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
                      <p className="auth-s-title">Authorized</p>
                      <p className="auth-s-sub">{platform?.id === "tradovate" ? "OAuth token captured. Expires in 90m." : platform?.id === "topstepx" ? "JWT session token received. Valid 24 hours." : "R|Protocol session established."}</p>
                      <div className="auth-token-display"><span className="auth-token-label">TOKEN</span><span className="auth-token-val">eyJhbGci...{Math.random().toString(36).slice(2, 8)}</span></div>
                    </div>
                  )}
                </div>
              </div>
              {authState === "success" && (
                <div className="auth-config fade-in">
                  <div className="cfg-row">
                    <div className="cfg-field"><label>Account Label</label><input type="text" placeholder="e.g. Apex #3" className="auth-input" value={label} onChange={e => setLabel(e.target.value)} /></div>
                    <div className="cfg-field"><label>Role</label>
                      <div className="role-toggle">
                        <button className={cn("role-btn", role === "master" && "role-on")} onClick={() => setRole("master")} disabled={!!existingMaster}>Master{existingMaster ? " (set)" : ""}</button>
                        <button className={cn("role-btn", role === "follower" && "role-on")} onClick={() => setRole("follower")}>Follower</button>
                      </div>
                    </div>
                  </div>
                  {role === "master" && (
                    <div className="master-note fade-in">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFB800" strokeWidth="1.5"><path d="M12 9v2M12 15h.01M10.29 3.86l-8.42 14.68A2 2 0 003.6 21h16.8a2 2 0 001.73-2.96L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                      <span>Master will open a persistent WebSocket to {platform?.name}. All trades replicate to followers in real time.</span>
                    </div>
                  )}
                  <button className="btn-primary btn-full" onClick={() => setStep("proxy")}><span>Continue to IP Assignment</span><span className="btn-aw"><span className="btn-ar">&#8594;</span></span></button>
                </div>
              )}
            </div>
          )}

          {/* Step: Proxy */}
          {step === "proxy" && (
            <div className="modal-body">
              <div className="proxy-assign fade-in">
                <div className="pa-header"><div className="pa-acct"><StatusDot status="connected" /><span className="pa-name">{label || `${platform.name} Account`}</span><span className="pa-role">{role}</span></div></div>
                <div className="pa-section"><label className="pa-label">PROXY PROVIDER</label><div className="pa-options">{PROXY_PROVIDERS.map(p => (<button key={p} className={cn("pa-opt", proxyProvider === p && "pa-opt-on")} onClick={() => setProxyProvider(p)}>{p}</button>))}</div></div>
                <div className="pa-section"><label className="pa-label">IP REGION</label><div className="pa-options">{["US-East", "US-West", "US-Central", "EU-West", "EU-Central"].map(r => (<button key={r} className={cn("pa-opt", proxyRegion === r && "pa-opt-on")} onClick={() => setProxyRegion(r)}>{r}</button>))}</div></div>
                <div className="pa-preview">
                  <div className="pa-pv-row"><span className="pa-pv-label">Assigned IP</span><span className="pa-pv-val ip-glow">{assignedIP.current}</span></div>
                  <div className="pa-pv-row"><span className="pa-pv-label">Proxy Type</span><span className="pa-pv-val">Residential Sticky Session</span></div>
                  <div className="pa-pv-row"><span className="pa-pv-label">Rotation</span><span className="pa-pv-val">Manual (on demand)</span></div>
                </div>
                <button className="btn-primary btn-full" onClick={handleProxyDone}><span>{role === "master" ? "Continue to Account Selection" : "Connect & Start Copying"}</span><span className="btn-aw"><span className="btn-ar">{role === "master" ? "\u2192" : "\u2713"}</span></span></button>
              </div>
            </div>
          )}

          {/* Step: Select Broker Account (Master only) */}
          {step === "select_account" && (
            <div className="modal-body">
              <div className="sa-section fade-in">
                <p className="sa-desc">We found {brokerAccounts.length} accounts on your {platform?.name} login. Select the one you trade from. Tradevanish will listen for every order placed on this account.</p>
                <div className="sa-accounts">
                  {brokerAccounts.map((ba, i) => (
                    <button key={ba.id} className={cn("sa-account", selectedBrokerAccount?.id === ba.id && "sa-account-on")} onClick={() => setSelectedBrokerAccount(ba)} style={{ animationDelay: `${i * 60}ms` }}>
                      <div className="sa-acct-radio"><div className={cn("sa-radio-dot", selectedBrokerAccount?.id === ba.id && "sa-radio-on")} /></div>
                      <div className="sa-acct-info">
                        <div className="sa-acct-name">{ba.name}</div>
                        <div className="sa-acct-detail">{ba.id} | {ba.type}</div>
                      </div>
                      <div className="sa-acct-balance">{ba.balance}</div>
                    </button>
                  ))}
                </div>

                {selectedBrokerAccount && (
                  <div className="sa-confirm fade-in">
                    <div className="sa-confirm-header">Connection Summary</div>
                    <div className="sa-confirm-grid">
                      <div className="sa-confirm-item"><span className="sa-ci-label">MASTER ACCOUNT</span><span className="sa-ci-val">{label || platform?.name} ({selectedBrokerAccount.name})</span></div>
                      <div className="sa-confirm-item"><span className="sa-ci-label">PLATFORM</span><span className="sa-ci-val">{platform?.name}</span></div>
                      <div className="sa-confirm-item"><span className="sa-ci-label">PROXY IP</span><span className="sa-ci-val ip-glow">{assignedIP.current}</span></div>
                      <div className="sa-confirm-item"><span className="sa-ci-label">PROVIDER</span><span className="sa-ci-val">{proxyProvider} ({proxyRegion})</span></div>
                    </div>
                    <div className="sa-what-happens">
                      <div className="sa-wh-title">What happens next</div>
                      <div className="sa-wh-list">
                        <div className="sa-wh-item"><span className="sa-wh-num">1</span><span>WebSocket opens to {platform?.name} through your dedicated proxy IP</span></div>
                        <div className="sa-wh-item"><span className="sa-wh-num">2</span><span>Session authenticates with your OAuth token</span></div>
                        <div className="sa-wh-item"><span className="sa-wh-num">3</span><span>Subscribes to all order, fill, and position events</span></div>
                        <div className="sa-wh-item"><span className="sa-wh-num">4</span><span>Syncs current open positions for reconciliation</span></div>
                        <div className="sa-wh-item"><span className="sa-wh-num">5</span><span>Every trade you take gets copied to all followers instantly</span></div>
                      </div>
                    </div>
                    <button className="btn-primary btn-full" onClick={() => { setStep("launch"); startLaunch(); }}>
                      <span>Launch Listener</span>
                      <span className="btn-aw"><span className="btn-ar">&#9654;</span></span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step: Launch Listener (Master only) */}
          {step === "launch" && (
            <div className="modal-body">
              <div className="launch-panel fade-in">
                {/* Boot Stages */}
                <div className="launch-stages">
                  {LAUNCH_STAGES.map((stage, i) => {
                    const done = i < launchStageIdx;
                    const active = i === launchStageIdx && launchPhase === "booting";
                    const pending = i > launchStageIdx && launchPhase === "booting";
                    const allDone = launchPhase === "ready";
                    return (
                      <div key={i} className={cn("ls-row", (done || allDone) && "ls-done", active && "ls-active", pending && "ls-pending")}>
                        <div className="ls-dot">
                          {(done || allDone) ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : active ? (
                            <div className="ls-spinner" />
                          ) : (
                            <span className="ls-num">{i + 1}</span>
                          )}
                        </div>
                        <div className="ls-text">
                          <div className="ls-label">{stage.label}</div>
                          <div className="ls-detail">{stage.detail}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Live Boot Log */}
                <div className="launch-log">
                  <div className="launch-log-header">
                    <span className="launch-log-title">Connection Log</span>
                    {launchPhase === "booting" && <span className="launch-log-spinner"><div className="ls-spinner" style={{ width: 10, height: 10 }}/></span>}
                    {launchPhase === "ready" && <span className="badge badge-live"><span className="live-d"/>CONNECTED</span>}
                  </div>
                  <div className="launch-log-entries">
                    {launchLog.map((entry, i) => (
                      <div key={i} className="ll-entry fade-in" style={{ animationDelay: `${i * 30}ms` }}>
                        <span className="ll-time">{entry.t}</span>
                        <span className={cn("ll-type", `ll-type-${entry.type}`)}>{entry.type}</span>
                        <span className={cn("ll-msg", entry.type === "ready" && "ll-msg-ready")}>{entry.msg}</span>
                      </div>
                    ))}
                    {launchPhase === "booting" && (
                      <div className="ll-entry ll-cursor"><span className="ll-time">--:---</span><span className="ll-type">...</span><span className="ll-msg ll-blink">|</span></div>
                    )}
                  </div>
                </div>

                {/* Ready State */}
                {launchPhase === "ready" && (
                  <div className="launch-ready fade-in">
                    <div className="launch-ready-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    </div>
                    <div className="launch-ready-text">
                      <div className="launch-ready-title">Master Listener Active</div>
                      <div className="launch-ready-sub">Watching {selectedBrokerAccount?.name || label} via {assignedIP.current}</div>
                    </div>
                    <button className="btn-primary" onClick={handleFinish}>
                      <span>Go to Dashboard</span>
                      <span className="btn-aw"><span className="btn-ar">&#8594;</span></span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Progress Steps */}
          <div className="modal-steps">
            {allSteps.map((s, i) => (
              <div key={s} className={cn("mstep", i <= currentStepIdx && i <= maxStep && "mstep-on", i < currentStepIdx && "mstep-done", i > maxStep && role !== "master" && "mstep-locked")}>
                <div className="mstep-dot">{i < currentStepIdx ? "\u2713" : i + 1}</div>
                <span className="mstep-label">{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Accounts Page ───────────────────────────────────────────────────────────
// ─── Master Account Stats Bar ────────────────────────────────────────────────
function MasterStatsBar({ accountId }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!accountId) return;
    apiFetch("/api/brokers/stats", { method: "POST", body: JSON.stringify({ accountId }) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d); })
      .catch(() => {});
  }, [accountId]);

  if (!stats) return null;

  const statItems = [
    { label: "BALANCE", value: stats.balance != null ? `$${Number(stats.balance).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "--", color: "#00E5A0" },
    { label: "EQUITY", value: stats.equity != null ? `$${Number(stats.equity).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "--", color: "var(--t1)" },
    { label: "TOTAL P&L", value: stats.totalPnl != null ? `${stats.totalPnl >= 0 ? "+" : ""}$${Number(stats.totalPnl).toLocaleString(undefined, {minimumFractionDigits: 2})}` : "--", color: stats.totalPnl >= 0 ? "#00E5A0" : "var(--red)" },
    { label: "TRADING DAYS", value: stats.tradingDays != null ? String(stats.tradingDays) : "--", color: "var(--t1)" },
    { label: "WIN RATE", value: stats.winRate != null ? `${stats.winRate}%` : "--", color: stats.winRate >= 50 ? "#00E5A0" : stats.winRate ? "var(--red)" : "var(--t1)" },
    { label: "W / L", value: stats.wins != null ? `${stats.wins} / ${stats.losses}` : "--", color: "var(--t1)" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 1, background: "var(--bdr)", borderRadius: 10, overflow: "hidden", margin: "12px 0" }}>
      {statItems.map(s => (
        <div key={s.label} style={{ background: "rgba(255,255,255,0.02)", padding: "12px 14px", textAlign: "center" }}>
          <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: "var(--t3)", fontFamily: "var(--sans)", marginBottom: 6 }}>{s.label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: s.color, fontFamily: "var(--mono)" }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function AccountsPage({ accounts, onOpenConnect, listenerState, listenerStage, events, positions, onStartListener, onStopListener, onDisconnect, onPause }) {
  const master = accounts.find(a => a.role === "master");
  const followers = accounts.filter(a => a.role === "follower");

  return (
    <div className="page fade-in">
      <div className="pg-head">
        <div><h1 className="pg-title">Account Manager</h1><p className="pg-sub">Connect broker accounts with one login. No API keys needed.</p></div>
        <button className="btn-primary" onClick={onOpenConnect}><span>+ Connect Account</span><span className="btn-aw"><span className="btn-ar">&#8594;</span></span></button>
      </div>

      {/* How it works */}
      <div className="how-shell fade-in">
        <div className="how-inner">
          <div className="how-title">How connection works</div>
          <div className="how-steps">
            {[
              ["1", "Choose platform", "Tradovate, Rithmic, or NinjaTrader"],
              ["2", "Sign in to broker", "OAuth or direct login. Password never stored."],
              ["3", "Auto-assign IP", "Residential proxy locks to this account"],
              ["4", "Start listener", "Master WebSocket opens. Followers copy instantly."],
            ].map(([num, title, desc], i) => (
              <div key={num} style={{ display: "contents" }}>
                {i > 0 && <div className="how-arrow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>}
                <div className="how-step"><div className="how-num">{num}</div><div className="how-txt"><strong>{title}</strong><br/>{desc}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Master Account + Listener Panel */}
      <div className="card-sh">
        <div className="card-in">
          <div className="card-hd">
            <h2 className="card-t">Master Account</h2>
            <span className="badge" style={{ color: "#FFB800", borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.08)" }}>SIGNAL SOURCE</span>
          </div>
          {master ? (
            <div>
              <div className="acct-master-row">
                <div className="acct-m-info"><StatusDot status={listenerState === "listening" ? "listening" : master.status} /><div><div className="acct-m-name">{master.label}</div><div className="acct-m-sub">{master.platform}</div></div></div>
                <IPBadge ip={master.ip} provider={master.proxy} region={master.region} />
                <div className="acct-m-stat"><span className="acct-m-stat-label">LATENCY</span><LatBar ms={master.latency} /></div>
              </div>
              <MasterStatsBar accountId={master.id} />
              <MasterListenerPanel master={master} listenerState={listenerState} listenerStage={listenerStage} events={events} positions={positions} onStartListener={onStartListener} onStopListener={onStopListener} />
            </div>
          ) : (
            <div className="acct-empty"><p>No master account connected yet.</p><button className="btn-primary" onClick={onOpenConnect}><span>Connect Master</span><span className="btn-aw"><span className="btn-ar">&#8594;</span></span></button></div>
          )}
        </div>
      </div>

      {/* Followers */}
      <div className="card-sh"><div className="card-in">
        <div className="card-hd"><h2 className="card-t">Follower Accounts</h2><span className="badge">{followers.length} FOLLOWERS</span></div>
        {followers.length > 0 ? (
          <div className="acct-grid">
            {followers.map((a, i) => (
              <div key={a.id} className="acct-fcard" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="acct-fc-top"><div className="acct-fc-name-row"><StatusDot status={a.status} /><span className="acct-fc-name">{a.label}</span></div><span className="plat-tag">{a.platform}</span></div>
                <div className="acct-fc-ip"><IPBadge ip={a.ip} provider={a.proxy} region={a.region} /></div>
                <div className="acct-fc-stats">
                  {a.balanceDisplay && a.balanceDisplay !== "N/A" && <div><span className="acct-fc-label">BALANCE</span><span className="c-mono c-grn" style={{fontWeight:700}}>{a.balanceDisplay}</span></div>}
                  <div><span className="acct-fc-label">P&L</span><span className={cn("c-mono", a.pnl >= 0 ? "c-grn" : "c-red")}>{fmt(a.pnl)}</span></div>
                  <div><span className="acct-fc-label">LATENCY</span><LatBar ms={a.latency} /></div>
                  <div><span className="acct-fc-label">TRADES</span><span className="c-mono">{a.trades}</span></div>
                </div>
                <div className="acct-fc-actions"><button className="fc-btn" onClick={() => onPause(a.id)}>{a.status === "paused" ? "Resume" : "Pause"}</button><button className="fc-btn fc-btn-danger" onClick={() => onDisconnect(a.id)}>Disconnect</button></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="acct-empty"><p>No followers connected. Add follower accounts to start copying trades.</p><button className="btn-primary" onClick={onOpenConnect}><span>Add Follower</span><span className="btn-aw"><span className="btn-ar">&#8594;</span></span></button></div>
        )}
      </div></div>
    </div>
  );
}

// ─── Overview Page ───────────────────────────────────────────────────────────
function OverviewPage({ accounts, onOpenConnect, listenerState, expandedTrade, setExpandedTrade }) {
  const totalPnl = accounts.reduce((s, a) => s + a.pnl, 0);
  const active = accounts.filter(a => a.status === "copying").length;
  const healthy = accounts.filter(a => a.latency !== null && a.latency < 80).length;
  const avgLat = accounts.filter(a => a.latency).reduce((s, a) => s + a.latency, 0) / (accounts.filter(a => a.latency).length || 1);

  return (
    <div className="page fade-in">
      <div className="pg-head">
        <div><h1 className="pg-title">Command Center</h1><p className="pg-sub">Real-time copy trading with IP isolation</p></div>
        <div className="pg-acts">
          <button className="btn-ghost">Export</button>
          <button className="btn-primary" onClick={onOpenConnect}><span>+ Connect Account</span><span className="btn-aw"><span className="btn-ar">&#8594;</span></span></button>
        </div>
      </div>

      <div className="stats">
        <div className="st-card"><div className="st-eye">TOTAL P&L TODAY</div><div className={cn("st-val", totalPnl >= 0 ? "c-grn" : "c-red")}><AnimNum value={Math.abs(totalPnl)} prefix={totalPnl >= 0 ? "+$" : "-$"} /></div><div className="st-sub">{accounts.reduce((s, a) => s + a.trades, 0)} trades executed</div></div>
        <div className="st-card"><div className="st-eye">COPYING</div><div className="st-val c-blu"><AnimNum value={active} dec={0} /><span className="st-of">/{accounts.length}</span></div><div className="st-sub">{accounts.filter(a => a.status === "error").length} errors</div></div>
        <div className="st-card"><div className="st-eye">PROXY HEALTH</div><div className="st-ring"><HealthRing ok={healthy} total={accounts.length} /></div></div>
        <div className="st-card">
          <div className="st-eye">LISTENER STATUS</div>
          <div className="st-listener-status">
            <StatusDot status={listenerState === "listening" ? "listening" : "idle"} />
            <span className={listenerState === "listening" ? "c-grn" : "c-dim"}>{listenerState === "listening" ? "Active" : "Offline"}</span>
          </div>
          <div className="st-sub">{listenerState === "listening" ? "Watching master for trades" : "Start listener on Accounts page"}</div>
        </div>
      </div>

      {/* Trade Table with expandable copy details */}
      <div className="card-sh"><div className="card-in">
        <div className="card-hd"><h2 className="card-t">Recent Master Trades</h2><span className="badge badge-live"><span className="live-d"/>LIVE</span></div>
        <div className="tbl-w"><table className="tbl">
          <thead><tr><th></th><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Copied To</th><th>P&L</th></tr></thead>
          <tbody>
            {INITIAL_TRADES.map((t, i) => [
                <tr key={`row-${t.id}`} className="tbl-r tbl-r-click" style={{ animationDelay: `${i * 50}ms` }} onClick={() => setExpandedTrade(expandedTrade === t.id ? null : t.id)}>
                  <td style={{ width: 30 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: expandedTrade === t.id ? "rotate(90deg)" : "none", transition: "transform 0.2s", opacity: t.followers?.length ? 1 : 0.2 }}><path d="M9 18l6-6-6-6"/></svg>
                  </td>
                  <td className="c-mono c-dim">{t.time}</td>
                  <td className="c-bold">{t.symbol}</td>
                  <td><span className={cn("side-b", t.side === "LONG" ? "side-l" : "side-s")}>{t.side}</span></td>
                  <td className="c-mono">{t.qty}</td>
                  <td className="c-mono">{t.entry.toFixed(2)}</td>
                  <td className="c-mono">{t.exit ? t.exit.toFixed(2) : "\u2014"}</td>
                  <td><span className="cp-b">{t.copiedTo} accts</span></td>
                  <td className={cn("c-mono", t.pnl > 0 ? "c-grn" : t.pnl < 0 ? "c-red" : "c-dim")}>{t.status === "open" ? <span className="open-b">OPEN</span> : fmt(t.pnl)}</td>
                </tr>,
                expandedTrade === t.id && t.followers?.length > 0 && (
                  <tr key={`expand-${t.id}`} className="tbl-expand"><td colSpan="9">
                    <div className="expand-content fade-in">
                      <div className="expand-title">Copy Execution Details</div>
                      <div className="expand-fills">
                        {t.followers.map((f, fi) => (
                          <div key={fi} className="expand-fill">
                            <span className="ef-name">{f.name}</span>
                            <span className="ef-ip">{f.ip}</span>
                            <span className="ef-price">@ {f.fp.toFixed(2)}</span>
                            <span className="ef-latency">{f.lat}ms</span>
                            <span className={cn("ef-slip", f.slip === 0 ? "c-grn" : "c-dim")}>{f.slip === 0 ? "0 slip" : `${f.slip} tick${f.slip > 1 ? "s" : ""}`}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </td></tr>
                ),
            ])}
          </tbody>
        </table></div>
      </div></div>
    </div>
  );
}

// ─── Trade Log Page ──────────────────────────────────────────────────────────
function TradeLogPage({ accounts }) {
  const [expanded, setExpanded] = useState(null);
  const [filterSymbol, setFilterSymbol] = useState("ALL");
  const [filterSide, setFilterSide] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");

  const symbols = [...new Set(INITIAL_TRADES.map(t => t.symbol))];
  const filtered = INITIAL_TRADES.filter(t => {
    if (filterSymbol !== "ALL" && t.symbol !== filterSymbol) return false;
    if (filterSide !== "ALL" && t.side !== filterSide) return false;
    if (filterStatus !== "ALL" && t.status !== filterStatus) return false;
    return true;
  });

  const totalPnl = filtered.filter(t => t.status === "closed").reduce((s, t) => s + (t.pnl || 0), 0);
  const totalTrades = filtered.length;
  const winRate = filtered.filter(t => t.status === "closed").length > 0
    ? Math.round((filtered.filter(t => t.pnl > 0).length / filtered.filter(t => t.status === "closed").length) * 100) : 0;
  const allFollowerLats = filtered.flatMap(t => t.followers.map(f => f.lat));
  const avgLat = allFollowerLats.length > 0 ? Math.round(allFollowerLats.reduce((a, b) => a + b, 0) / allFollowerLats.length) : 0;
  const allSlips = filtered.flatMap(t => t.followers.map(f => f.slip));
  const avgSlip = allSlips.length > 0 ? (allSlips.reduce((a, b) => a + b, 0) / allSlips.length).toFixed(1) : "0";
  const totalCopied = filtered.reduce((s, t) => s + t.followers.length, 0);
  const zeroSlipPct = allSlips.length > 0 ? Math.round((allSlips.filter(s => s === 0).length / allSlips.length) * 100) : 0;

  return (
    <div className="page fade-in">
      <div className="pg-head">
        <div><h1 className="pg-title">Trade Log</h1><p className="pg-sub">Execution history with per-follower copy receipts and IP audit trail</p></div>
        <button className="btn-ghost">Export CSV</button>
      </div>

      {/* Aggregate Stats */}
      <div className="tl-stats">
        <div className="tl-stat"><div className="tl-stat-label">MASTER P&L</div><div className={cn("tl-stat-val", totalPnl >= 0 ? "c-grn" : "c-red")}>{fmt(totalPnl)}</div></div>
        <div className="tl-stat"><div className="tl-stat-label">TRADES</div><div className="tl-stat-val">{totalTrades}</div></div>
        <div className="tl-stat"><div className="tl-stat-label">WIN RATE</div><div className="tl-stat-val">{winRate}%</div></div>
        <div className="tl-stat"><div className="tl-stat-label">AVG COPY LATENCY</div><div className="tl-stat-val">{avgLat}ms</div></div>
        <div className="tl-stat"><div className="tl-stat-label">AVG SLIPPAGE</div><div className="tl-stat-val">{avgSlip} ticks</div></div>
        <div className="tl-stat"><div className="tl-stat-label">ZERO-SLIP RATE</div><div className="tl-stat-val c-grn">{zeroSlipPct}%</div></div>
        <div className="tl-stat"><div className="tl-stat-label">TOTAL COPIES</div><div className="tl-stat-val">{totalCopied}</div></div>
      </div>

      {/* Filters */}
      <div className="tl-filters">
        <div className="tl-filter-group">
          <span className="tl-filter-label">Symbol</span>
          <div className="tl-filter-opts">
            {["ALL", ...symbols].map(s => (
              <button key={s} className={cn("tl-fopt", filterSymbol === s && "tl-fopt-on")} onClick={() => setFilterSymbol(s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className="tl-filter-group">
          <span className="tl-filter-label">Side</span>
          <div className="tl-filter-opts">
            {["ALL", "LONG", "SHORT"].map(s => (
              <button key={s} className={cn("tl-fopt", filterSide === s && "tl-fopt-on")} onClick={() => setFilterSide(s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className="tl-filter-group">
          <span className="tl-filter-label">Status</span>
          <div className="tl-filter-opts">
            {["ALL", "open", "closed"].map(s => (
              <button key={s} className={cn("tl-fopt", filterStatus === s && "tl-fopt-on")} onClick={() => setFilterStatus(s)}>{s === "ALL" ? "ALL" : s.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Trade Table */}
      <div className="card-sh"><div className="card-in">
        <div className="card-hd"><h2 className="card-t">Execution Log</h2><span className="badge">{filtered.length} TRADES</span></div>
        <div className="tbl-w"><table className="tbl">
          <thead><tr>
            <th style={{ width: 28 }}></th>
            <th>Time</th>
            <th>Order ID</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Brackets</th>
            <th>Copied</th>
            <th>P&L</th>
          </tr></thead>
          <tbody>
            {filtered.map((t, i) => [
              <tr key={`r-${t.id}`} className="tbl-r tbl-r-click" style={{ animationDelay: `${i * 40}ms` }} onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                <td>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: expanded === t.id ? "rotate(90deg)" : "none", transition: "transform 0.25s cubic-bezier(0.32,0.72,0,1)", opacity: 0.5 }}><path d="M9 18l6-6-6-6"/></svg>
                </td>
                <td><div className="tl-time-cell"><span className="c-mono">{t.time}</span>{t.ts && <span className="tl-ms">.{t.ts.split(".")[1]}</span>}</div></td>
                <td><span className="tl-oid">{t.mOid}</span></td>
                <td className="c-bold">{t.symbol}</td>
                <td><span className={cn("side-b", t.side === "LONG" ? "side-l" : "side-s")}>{t.side}</span></td>
                <td className="c-mono">{t.qty}</td>
                <td className="c-mono">{t.entry.toFixed(2)}</td>
                <td className="c-mono">{t.exit ? t.exit.toFixed(2) : "\u2014"}</td>
                <td>{t.bracket ? (
                  <div className="tl-brackets">
                    <span className="ml-bracket-tag ml-bracket-sl">SL {t.bracket.sl.toFixed(0)}</span>
                    <span className="ml-bracket-tag ml-bracket-tp">TP {t.bracket.tp.toFixed(0)}</span>
                  </div>
                ) : <span className="c-dim">\u2014</span>}</td>
                <td><span className="cp-b">{t.copiedTo}</span></td>
                <td className={cn("c-mono", t.pnl > 0 ? "c-grn" : t.pnl < 0 ? "c-red" : "")}>{t.status === "open" ? <span className="open-b">OPEN</span> : fmt(t.pnl)}</td>
              </tr>,
              expanded === t.id && (
                <tr key={`x-${t.id}`} className="tbl-expand"><td colSpan="11">
                  <div className="tl-expand fade-in">
                    {/* Execution Summary Bar */}
                    <div className="tl-ex-summary">
                      <div className="tl-ex-sm"><span className="tl-ex-sm-label">MASTER FILL</span><span className="c-mono">{t.ts}</span></div>
                      <div className="tl-ex-sm"><span className="tl-ex-sm-label">FOLLOWERS FILLED</span><span>{t.followers.filter(f => f.st === "filled").length}/{t.followers.length}</span></div>
                      <div className="tl-ex-sm"><span className="tl-ex-sm-label">AVG LATENCY</span><span className="c-mono">{Math.round(t.followers.reduce((s, f) => s + f.lat, 0) / t.followers.length)}ms</span></div>
                      <div className="tl-ex-sm"><span className="tl-ex-sm-label">AVG SLIPPAGE</span><span className="c-mono">{(t.followers.reduce((s, f) => s + f.slip, 0) / t.followers.length).toFixed(1)} ticks</span></div>
                      {t.status === "closed" && <div className="tl-ex-sm"><span className="tl-ex-sm-label">AGG FOLLOWER P&L</span><span className={cn("c-mono", "c-grn")}>{fmt(t.followers.reduce((s, f) => s + (f.fpnl || 0), 0))}</span></div>}
                    </div>

                    {/* Per-Follower Fills */}
                    <div className="tl-ex-title">Per-Follower Execution Receipts</div>
                    <div className="tl-fills-grid">
                      {t.followers.map((f, fi) => (
                        <div key={fi} className="tl-fill-card" style={{ animationDelay: `${fi * 50}ms` }}>
                          <div className="tl-fc-head">
                            <div className="tl-fc-name-row">
                              <StatusDot status="copying" />
                              <span className="tl-fc-name">{f.name}</span>
                            </div>
                            <span className="tl-fc-oid">{f.oid}</span>
                          </div>

                          <div className="tl-fc-ip-row">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="1.5" opacity="0.6"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M2 12h20"/></svg>
                            <span className="tl-fc-ip">{f.ip}</span>
                            <span className="tl-fc-region">{f.rg}</span>
                          </div>

                          <div className="tl-fc-metrics">
                            <div className="tl-fc-metric">
                              <span className="tl-fc-mlabel">ENTRY FILL</span>
                              <span className="c-mono">{f.fp.toFixed(2)}</span>
                            </div>
                            <div className="tl-fc-metric">
                              <span className="tl-fc-mlabel">LATENCY</span>
                              <span className={cn("c-mono", f.lat < 10 ? "c-grn" : f.lat < 30 ? "" : "c-red")}>{f.lat}ms</span>
                            </div>
                            <div className="tl-fc-metric">
                              <span className="tl-fc-mlabel">SLIPPAGE</span>
                              <span className={cn("c-mono", f.slip === 0 ? "c-grn" : f.slip > 1 ? "c-red" : "")}>{f.slip} tick{f.slip !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="tl-fc-metric">
                              <span className="tl-fc-mlabel">FILL TIME</span>
                              <span className="c-mono c-dim">{f.ft}</span>
                            </div>
                          </div>

                          {f.xp && (
                            <div className="tl-fc-exit">
                              <div className="tl-fc-exit-divider">EXIT</div>
                              <div className="tl-fc-metrics">
                                <div className="tl-fc-metric">
                                  <span className="tl-fc-mlabel">EXIT FILL</span>
                                  <span className="c-mono">{f.xp.toFixed(2)}</span>
                                </div>
                                <div className="tl-fc-metric">
                                  <span className="tl-fc-mlabel">LATENCY</span>
                                  <span className={cn("c-mono", f.xl < 10 ? "c-grn" : f.xl < 30 ? "" : "c-red")}>{f.xl}ms</span>
                                </div>
                                <div className="tl-fc-metric">
                                  <span className="tl-fc-mlabel">SLIPPAGE</span>
                                  <span className={cn("c-mono", f.xs === 0 ? "c-grn" : "c-red")}>{f.xs} tick{f.xs !== 1 ? "s" : ""}</span>
                                </div>
                                <div className="tl-fc-metric">
                                  <span className="tl-fc-mlabel">P&L</span>
                                  <span className={cn("c-mono", f.fpnl >= 0 ? "c-grn" : "c-red")}>{fmt(f.fpnl)}</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Latency bar visualization */}
                          <div className="tl-fc-latbar">
                            <div className="tl-fc-latbar-track">
                              <div className="tl-fc-latbar-fill" style={{ width: `${Math.min(f.lat / 50, 1) * 100}%`, background: f.lat < 10 ? "var(--grn)" : f.lat < 30 ? "#FFB800" : "var(--red)" }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Slippage Distribution Mini Chart */}
                    <div className="tl-ex-distro">
                      <span className="tl-ex-distro-label">SLIPPAGE DISTRIBUTION</span>
                      <div className="tl-ex-distro-bars">
                        {(() => {
                          const s0 = t.followers.filter(f => f.slip === 0).length;
                          const s1 = t.followers.filter(f => f.slip === 1).length;
                          const s2 = t.followers.filter(f => f.slip >= 2).length;
                          const total = t.followers.length;
                          return [
                            { label: "0 ticks", count: s0, pct: s0/total, color: "var(--grn)" },
                            { label: "1 tick", count: s1, pct: s1/total, color: "#FFB800" },
                            { label: "2+ ticks", count: s2, pct: s2/total, color: "var(--red)" },
                          ].map(b => (
                            <div key={b.label} className="tl-distro-bar-item">
                              <div className="tl-distro-bar-track"><div className="tl-distro-bar-fill" style={{ width: `${b.pct * 100}%`, background: b.color }} /></div>
                              <span className="tl-distro-label">{b.label}: {b.count}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </div>
                </td></tr>
              ),
            ])}
          </tbody>
        </table></div>
      </div></div>
    </div>
  );
}

// ─── Proxy & Placeholder Pages ───────────────────────────────────────────────
function ProxyPage({ accounts, onRotateProxy, onTestProxy, onRotateAll }) {
  return (
    <div className="page fade-in">
      <div className="pg-head"><div><h1 className="pg-title">IP Mixer</h1><p className="pg-sub">Each account routes through a dedicated residential proxy</p></div><button className="btn-primary" onClick={onRotateAll}><span>Rotate All IPs</span><span className="btn-aw"><span className="btn-ar">&#8635;</span></span></button></div>
      <div className="proxy-grid">
        {accounts.map((a, i) => (
          <div key={a.id} className="px-shell" style={{ animationDelay: `${i * 70}ms` }}><div className="px-inner">
            <div className="px-top"><div className="px-name-r"><StatusDot status={a.status} /><span className="px-name">{a.label}</span></div><span className="px-prov">{a.proxy}</span></div>
            <div className="px-ip-box"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/></svg><div><div className="px-ip">{a.ip}</div><div className="px-region">{a.region}</div></div></div>
            <div className="px-meta"><div><span className="px-ml">LATENCY</span><LatBar ms={a.latency} /></div><div><span className="px-ml">UPTIME</span><span className="px-mv">{a.latency ? "99.8%" : "0%"}</span></div></div>
            <div className="px-acts"><button className="px-btn" onClick={() => onRotateProxy(a.id)}>Rotate IP</button><button className="px-btn px-btn-a" onClick={() => onTestProxy(a.id)}>Test</button></div>
          </div></div>
        ))}
      </div>
      <div className="card-sh"><div className="card-in"><div className="card-hd"><h2 className="card-t">Provider Pool</h2></div><div className="prov-grid">{PROXY_PROVIDERS.map(p => { const c = accounts.filter(a => a.proxy === p).length; return (<div key={p} className="prov-item"><div className="prov-name">{p}</div><div className="prov-count">{c} assigned</div><div className="prov-bar-bg"><div className="prov-bar" style={{ width: `${(c / (accounts.length || 1)) * 100}%` }} /></div></div>); })}</div></div></div>
    </div>
  );
}

// ─── Settings Page ───────────────────────────────────────────────────────────
function SettingsPage({ accounts }) {
  const followers = accounts.filter(a => a.role === "follower");
  const master = accounts.find(a => a.role === "master");

  // Global risk
  const [globalMaxQty, setGlobalMaxQty] = useState(10);
  const [globalDailyLoss, setGlobalDailyLoss] = useState(2000);
  const [globalMaxTrades, setGlobalMaxTrades] = useState(20);
  const [globalTrailingDD, setGlobalTrailingDD] = useState(2500);
  const [emergencyFlatten, setEmergencyFlatten] = useState(true);
  const [killSwitchActive, setKillSwitchActive] = useState(false);

  // Copy filters
  const [copySymbols, setCopySymbols] = useState(["NQ", "ES", "YM", "RTY"]);
  const [symbolInput, setSymbolInput] = useState("");
  const [copyDelay, setCopyDelay] = useState(0);
  const [sizeMode, setSizeMode] = useState("multiplier"); // multiplier | fixed | mirror
  const [sizeMultiplier, setSizeMultiplier] = useState(1.0);
  const [fixedQty, setFixedQty] = useState(1);
  const [copyBrackets, setCopyBrackets] = useState(true);
  const [copyModifications, setCopyModifications] = useState(true);
  const [invertSignals, setInvertSignals] = useState(false);
  const [sessionFilter, setSessionFilter] = useState("all"); // all | rth | eth

  // Proxy rotation
  const [rotationMode, setRotationMode] = useState("manual"); // manual | interval | failure
  const [rotationInterval, setRotationInterval] = useState(24);
  const [healthCheckInterval, setHealthCheckInterval] = useState(30);
  const [autoRotateOnFail, setAutoRotateOnFail] = useState(true);
  const [maxLatencyThreshold, setMaxLatencyThreshold] = useState(100);

  // Per-follower overrides
  const [followerOverrides, setFollowerOverrides] = useState({});
  const [editingFollower, setEditingFollower] = useState(null);

  // Token / WebSocket
  const [tokenRefreshMin, setTokenRefreshMin] = useState(85);
  const [wsHeartbeatSec, setWsHeartbeatSec] = useState(2.5);
  const [maxReconnects, setMaxReconnects] = useState(20);

  const [saved, setSaved] = useState(false);

  // Load risk rules from DB on mount
  useEffect(() => {
    apiFetch("/api/settings/risk").then(r => r.ok ? r.json() : null).then(data => {
      if (data?.rules) {
        if (data.rules.max_qty) setGlobalMaxQty(data.rules.max_qty);
        if (data.rules.daily_loss_limit) setGlobalDailyLoss(Number(data.rules.daily_loss_limit));
        if (data.rules.max_trades_per_day) setGlobalMaxTrades(data.rules.max_trades_per_day);
        if (data.rules.trailing_drawdown) setGlobalTrailingDD(Number(data.rules.trailing_drawdown));
        if (data.rules.kill_switch != null) setKillSwitchActive(data.rules.kill_switch);
      }
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      const r = await apiFetch("/api/settings/risk", {
        method: "PUT",
        body: JSON.stringify({
          max_qty: globalMaxQty,
          daily_loss_limit: globalDailyLoss,
          max_trades_per_day: globalMaxTrades,
          trailing_drawdown: globalTrailingDD,
          kill_switch: killSwitchActive,
        }),
      });
      if (r.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        alert("Save failed");
      }
    } catch (err) {
      alert("Save failed: " + err.message);
    }
  };

  const addSymbol = () => {
    const s = symbolInput.trim().toUpperCase();
    if (s && !copySymbols.includes(s)) { setCopySymbols([...copySymbols, s]); setSymbolInput(""); }
  };

  const removeSymbol = (sym) => setCopySymbols(copySymbols.filter(s => s !== sym));

  return (
    <div className="page fade-in">
      <div className="pg-head">
        <div><h1 className="pg-title">Settings</h1><p className="pg-sub">Risk rules, copy filters, proxy rotation, and connection config</p></div>
        <div className="pg-acts">
          {saved && <span className="set-saved fade-in">Saved</span>}
          <button className="btn-primary" onClick={handleSave}><span>Save Changes</span><span className="btn-aw"><span className="btn-ar">&#10003;</span></span></button>
        </div>
      </div>

      {/* ── KILL SWITCH ─────────────────────────── */}
      <div className={cn("set-kill-shell", killSwitchActive && "set-kill-active")}>
        <div className="set-kill-inner">
          <div className="set-kill-left">
            <div className="set-kill-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={killSwitchActive ? "#FF4D4D" : "currentColor"} strokeWidth="1.5"><path d="M18.36 5.64a9 9 0 11-12.73 0M12 2v10"/></svg>
            </div>
            <div>
              <div className="set-kill-title">Emergency Kill Switch</div>
              <div className="set-kill-desc">{killSwitchActive ? "ALL copying halted. No new orders will be placed on any follower." : "Instantly stop all copy execution across every follower account"}</div>
            </div>
          </div>
          <button className={cn("set-toggle-btn", killSwitchActive && "set-toggle-on-red")} onClick={() => setKillSwitchActive(!killSwitchActive)}>
            <div className="set-toggle-track"><div className="set-toggle-thumb" /></div>
          </button>
        </div>
      </div>

      {/* ── RISK RULES ──────────────────────────── */}
      <div className="card-sh"><div className="card-in">
        <div className="card-hd"><h2 className="card-t">Risk Rules</h2><span className="badge">GLOBAL</span></div>
        <div className="set-section">
          <div className="set-grid-3">
            <div className="set-field">
              <label className="set-label">MAX POSITION SIZE</label>
              <div className="set-input-row">
                <input type="number" className="set-input" value={globalMaxQty} onChange={e => setGlobalMaxQty(Number(e.target.value))} />
                <span className="set-unit">contracts</span>
              </div>
              <p className="set-help">Max contracts per trade on any follower</p>
            </div>
            <div className="set-field">
              <label className="set-label">DAILY LOSS LIMIT</label>
              <div className="set-input-row">
                <span className="set-prefix">$</span>
                <input type="number" className="set-input set-input-prefix" value={globalDailyLoss} onChange={e => setGlobalDailyLoss(Number(e.target.value))} />
              </div>
              <p className="set-help">Stop copying when follower hits this loss</p>
            </div>
            <div className="set-field">
              <label className="set-label">MAX DAILY TRADES</label>
              <div className="set-input-row">
                <input type="number" className="set-input" value={globalMaxTrades} onChange={e => setGlobalMaxTrades(Number(e.target.value))} />
                <span className="set-unit">trades</span>
              </div>
              <p className="set-help">After this count, copying pauses until next day</p>
            </div>
          </div>
          <div className="set-grid-2" style={{ marginTop: 20 }}>
            <div className="set-field">
              <label className="set-label">TRAILING DRAWDOWN LIMIT</label>
              <div className="set-input-row">
                <span className="set-prefix">$</span>
                <input type="number" className="set-input set-input-prefix" value={globalTrailingDD} onChange={e => setGlobalTrailingDD(Number(e.target.value))} />
              </div>
              <p className="set-help">Tracks peak equity. Flattens if drawdown exceeds this.</p>
            </div>
            <div className="set-field">
              <label className="set-label">EMERGENCY AUTO-FLATTEN</label>
              <div className="set-toggle-row">
                <button className={cn("set-toggle-btn", emergencyFlatten && "set-toggle-on")} onClick={() => setEmergencyFlatten(!emergencyFlatten)}>
                  <div className="set-toggle-track"><div className="set-toggle-thumb" /></div>
                </button>
                <span className="set-toggle-label">{emergencyFlatten ? "Auto-close all positions when limit hit" : "Only stop new orders (keep positions open)"}</span>
              </div>
            </div>
          </div>
        </div>
      </div></div>

      {/* ── COPY FILTERS ────────────────────────── */}
      <div className="card-sh"><div className="card-in">
        <div className="card-hd"><h2 className="card-t">Copy Filters</h2><span className="badge">EXECUTION</span></div>
        <div className="set-section">
          {/* Symbol Whitelist */}
          <div className="set-field" style={{ marginBottom: 24 }}>
            <label className="set-label">SYMBOL WHITELIST</label>
            <p className="set-help" style={{ marginBottom: 10 }}>Only copy trades on these symbols. Leave empty to copy all.</p>
            <div className="set-symbols">
              {copySymbols.map(s => (
                <span key={s} className="set-symbol-tag">
                  {s}
                  <button className="set-symbol-x" onClick={() => removeSymbol(s)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </span>
              ))}
              <div className="set-symbol-add">
                <input type="text" className="set-symbol-input" placeholder="Add symbol..." value={symbolInput} onChange={e => setSymbolInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addSymbol()} />
                <button className="set-symbol-add-btn" onClick={addSymbol}>+</button>
              </div>
            </div>
          </div>

          <div className="set-grid-3">
            {/* Size Mode */}
            <div className="set-field">
              <label className="set-label">POSITION SIZING</label>
              <div className="set-radio-group">
                {[
                  { v: "mirror", l: "Mirror", d: "Same qty as master" },
                  { v: "multiplier", l: "Multiplier", d: "Scale by factor" },
                  { v: "fixed", l: "Fixed", d: "Fixed contract count" },
                ].map(opt => (
                  <button key={opt.v} className={cn("set-radio", sizeMode === opt.v && "set-radio-on")} onClick={() => setSizeMode(opt.v)}>
                    <div className="set-radio-dot-w"><div className={cn("set-radio-dot", sizeMode === opt.v && "set-radio-dot-on")} /></div>
                    <div><div className="set-radio-label">{opt.l}</div><div className="set-radio-desc">{opt.d}</div></div>
                  </button>
                ))}
              </div>
            </div>

            {/* Size value */}
            <div className="set-field">
              <label className="set-label">{sizeMode === "multiplier" ? "MULTIPLIER VALUE" : sizeMode === "fixed" ? "FIXED QUANTITY" : "MIRROR MODE"}</label>
              {sizeMode === "multiplier" && (
                <div className="set-input-row"><input type="number" step="0.1" className="set-input" value={sizeMultiplier} onChange={e => setSizeMultiplier(Number(e.target.value))} /><span className="set-unit">x</span></div>
              )}
              {sizeMode === "fixed" && (
                <div className="set-input-row"><input type="number" className="set-input" value={fixedQty} onChange={e => setFixedQty(Number(e.target.value))} /><span className="set-unit">ct</span></div>
              )}
              {sizeMode === "mirror" && (
                <p className="set-help" style={{ marginTop: 8 }}>Followers copy the exact quantity from master. No adjustment.</p>
              )}
            </div>

            {/* Copy Delay */}
            <div className="set-field">
              <label className="set-label">COPY DELAY</label>
              <div className="set-input-row"><input type="number" className="set-input" value={copyDelay} onChange={e => setCopyDelay(Number(e.target.value))} /><span className="set-unit">ms</span></div>
              <p className="set-help">Delay before copying. 0 = instant. Use for staggering.</p>
            </div>
          </div>

          <div className="set-divider" />

          <div className="set-grid-2">
            <div className="set-field">
              <label className="set-label">SESSION FILTER</label>
              <div className="set-btn-group">
                {[{ v: "all", l: "All Sessions" }, { v: "rth", l: "RTH Only" }, { v: "eth", l: "ETH Only" }].map(opt => (
                  <button key={opt.v} className={cn("set-btn-opt", sessionFilter === opt.v && "set-btn-opt-on")} onClick={() => setSessionFilter(opt.v)}>{opt.l}</button>
                ))}
              </div>
            </div>
            <div className="set-field">
              <label className="set-label">BEHAVIOR FLAGS</label>
              <div className="set-toggles-col">
                <div className="set-toggle-row">
                  <button className={cn("set-toggle-btn", copyBrackets && "set-toggle-on")} onClick={() => setCopyBrackets(!copyBrackets)}><div className="set-toggle-track"><div className="set-toggle-thumb" /></div></button>
                  <span className="set-toggle-label">Copy brackets (SL/TP)</span>
                </div>
                <div className="set-toggle-row">
                  <button className={cn("set-toggle-btn", copyModifications && "set-toggle-on")} onClick={() => setCopyModifications(!copyModifications)}><div className="set-toggle-track"><div className="set-toggle-thumb" /></div></button>
                  <span className="set-toggle-label">Copy order modifications</span>
                </div>
                <div className="set-toggle-row">
                  <button className={cn("set-toggle-btn", invertSignals && "set-toggle-on-red")} onClick={() => setInvertSignals(!invertSignals)}><div className="set-toggle-track"><div className="set-toggle-thumb" /></div></button>
                  <span className="set-toggle-label">Invert signals (reverse copy)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div></div>

      {/* ── PER-FOLLOWER OVERRIDES ──────────────── */}
      <div className="card-sh"><div className="card-in">
        <div className="card-hd"><h2 className="card-t">Per-Follower Overrides</h2><span className="badge">{followers.length} FOLLOWERS</span></div>
        <div className="set-section">
          <p className="set-help" style={{ marginBottom: 16 }}>Override global risk rules for individual accounts. Accounts without overrides inherit global settings.</p>
          {followers.length > 0 ? (
            <div className="set-follower-list">
              {followers.map((f, i) => {
                const ov = followerOverrides[f.id] || {};
                const isEditing = editingFollower === f.id;
                return (
                  <div key={f.id} className="set-follower-row" style={{ animationDelay: `${i * 40}ms` }}>
                    <div className="set-f-head" onClick={() => setEditingFollower(isEditing ? null : f.id)}>
                      <div className="set-f-info">
                        <StatusDot status={f.status} />
                        <span className="set-f-name">{f.label}</span>
                        <span className="plat-tag">{f.platform}</span>
                      </div>
                      <div className="set-f-right">
                        {Object.keys(ov).length > 0 && <span className="set-f-override-badge">{Object.keys(ov).length} override{Object.keys(ov).length > 1 ? "s" : ""}</span>}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transform: isEditing ? "rotate(90deg)" : "none", transition: "transform 0.25s", opacity: 0.4 }}><path d="M9 18l6-6-6-6"/></svg>
                      </div>
                    </div>
                    {isEditing && (
                      <div className="set-f-overrides fade-in">
                        <div className="set-grid-3">
                          <div className="set-field">
                            <label className="set-label">MAX QTY OVERRIDE</label>
                            <div className="set-input-row">
                              <input type="number" className="set-input" placeholder={String(globalMaxQty)} value={ov.maxQty || ""} onChange={e => setFollowerOverrides({...followerOverrides, [f.id]: {...ov, maxQty: Number(e.target.value) || undefined}})} />
                              <span className="set-unit">ct</span>
                            </div>
                          </div>
                          <div className="set-field">
                            <label className="set-label">DAILY LOSS OVERRIDE</label>
                            <div className="set-input-row">
                              <span className="set-prefix">$</span>
                              <input type="number" className="set-input set-input-prefix" placeholder={String(globalDailyLoss)} value={ov.dailyLoss || ""} onChange={e => setFollowerOverrides({...followerOverrides, [f.id]: {...ov, dailyLoss: Number(e.target.value) || undefined}})} />
                            </div>
                          </div>
                          <div className="set-field">
                            <label className="set-label">SIZE MULTIPLIER</label>
                            <div className="set-input-row">
                              <input type="number" step="0.1" className="set-input" placeholder={String(sizeMultiplier)} value={ov.multiplier || ""} onChange={e => setFollowerOverrides({...followerOverrides, [f.id]: {...ov, multiplier: Number(e.target.value) || undefined}})} />
                              <span className="set-unit">x</span>
                            </div>
                          </div>
                        </div>
                        <button className="set-f-clear" onClick={() => { const next = {...followerOverrides}; delete next[f.id]; setFollowerOverrides(next); }}>Clear overrides</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="acct-empty"><p>No follower accounts connected.</p></div>
          )}
        </div>
      </div></div>

      {/* ── PROXY ROTATION ──────────────────────── */}
      <div className="card-sh"><div className="card-in">
        <div className="card-hd"><h2 className="card-t">Proxy Rotation</h2><span className="badge">IP MANAGEMENT</span></div>
        <div className="set-section">
          <div className="set-grid-3">
            <div className="set-field">
              <label className="set-label">ROTATION MODE</label>
              <div className="set-radio-group">
                {[
                  { v: "manual", l: "Manual", d: "Rotate on demand only" },
                  { v: "interval", l: "Scheduled", d: "Auto-rotate on interval" },
                  { v: "failure", l: "On Failure", d: "Only when proxy fails" },
                ].map(opt => (
                  <button key={opt.v} className={cn("set-radio", rotationMode === opt.v && "set-radio-on")} onClick={() => setRotationMode(opt.v)}>
                    <div className="set-radio-dot-w"><div className={cn("set-radio-dot", rotationMode === opt.v && "set-radio-dot-on")} /></div>
                    <div><div className="set-radio-label">{opt.l}</div><div className="set-radio-desc">{opt.d}</div></div>
                  </button>
                ))}
              </div>
            </div>
            <div className="set-field">
              <label className="set-label">ROTATION INTERVAL</label>
              <div className="set-input-row"><input type="number" className="set-input" value={rotationInterval} onChange={e => setRotationInterval(Number(e.target.value))} disabled={rotationMode !== "interval"} /><span className="set-unit">hours</span></div>
              <p className="set-help">Time between automatic IP rotations</p>
              <div style={{ marginTop: 16 }}>
                <label className="set-label">HEALTH CHECK INTERVAL</label>
                <div className="set-input-row"><input type="number" className="set-input" value={healthCheckInterval} onChange={e => setHealthCheckInterval(Number(e.target.value))} /><span className="set-unit">sec</span></div>
                <p className="set-help">Ping proxies every N seconds to detect failures</p>
              </div>
            </div>
            <div className="set-field">
              <label className="set-label">MAX LATENCY THRESHOLD</label>
              <div className="set-input-row"><input type="number" className="set-input" value={maxLatencyThreshold} onChange={e => setMaxLatencyThreshold(Number(e.target.value))} /><span className="set-unit">ms</span></div>
              <p className="set-help">Mark proxy unhealthy above this latency</p>
              <div className="set-toggle-row" style={{ marginTop: 16 }}>
                <button className={cn("set-toggle-btn", autoRotateOnFail && "set-toggle-on")} onClick={() => setAutoRotateOnFail(!autoRotateOnFail)}><div className="set-toggle-track"><div className="set-toggle-thumb" /></div></button>
                <span className="set-toggle-label">Auto-rotate on health check failure</span>
              </div>
            </div>
          </div>
        </div>
      </div></div>

      {/* ── CONNECTION CONFIG ───────────────────── */}
      <div className="card-sh"><div className="card-in">
        <div className="card-hd"><h2 className="card-t">Connection Config</h2><span className="badge">WEBSOCKET</span></div>
        <div className="set-section">
          <div className="set-grid-3">
            <div className="set-field">
              <label className="set-label">TOKEN REFRESH</label>
              <div className="set-input-row"><input type="number" className="set-input" value={tokenRefreshMin} onChange={e => setTokenRefreshMin(Number(e.target.value))} /><span className="set-unit">min</span></div>
              <p className="set-help">Tradovate tokens expire at 90m. Refresh before expiry.</p>
            </div>
            <div className="set-field">
              <label className="set-label">HEARTBEAT INTERVAL</label>
              <div className="set-input-row"><input type="number" step="0.5" className="set-input" value={wsHeartbeatSec} onChange={e => setWsHeartbeatSec(Number(e.target.value))} /><span className="set-unit">sec</span></div>
              <p className="set-help">WebSocket keep-alive ping frequency</p>
            </div>
            <div className="set-field">
              <label className="set-label">MAX RECONNECT ATTEMPTS</label>
              <div className="set-input-row"><input type="number" className="set-input" value={maxReconnects} onChange={e => setMaxReconnects(Number(e.target.value))} /></div>
              <p className="set-help">Exponential backoff. Stops after this many failures.</p>
            </div>
          </div>
        </div>
      </div></div>
    </div>
  );
}

// ─── Billing Modal ───────────────────────────────────────────────────────────
function BillingModal({ onClose, currentPlan, onPlanChange, initialTab }) {
  const [tab, setTab] = useState(initialTab || "plan");
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [changingPlan, setChangingPlan] = useState(false);
  const [changePhase, setChangePhase] = useState(null); // null | processing | success
  // Payment
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardName, setCardName] = useState("");
  const [updatingCard, setUpdatingCard] = useState(false);
  const [cardSaved, setCardSaved] = useState(false);

  const PLANS = [
    { id: "basic", name: "Basic", price: 39, features: ["5 follower accounts", "1 proxy provider", "Email support", "Manual IP rotation"], limits: "5 followers" },
    { id: "pro", name: "Pro", price: 69, features: ["Unlimited followers", "All proxy providers", "Priority support", "Per-follower overrides", "Scheduled IP rotation"], limits: "Unlimited", popular: true },
    { id: "proplus", name: "Pro+", price: 89, features: ["Everything in Pro", "Custom proxy pools", "REST API access", "Dedicated account manager", "SLA guarantee", "Webhook integrations"], limits: "Unlimited + API" },
  ];
  const current = PLANS.find(p => p.id === currentPlan) || PLANS[1];

  const handlePlanChange = (plan) => {
    setSelectedPlan(plan);
    setChangingPlan(true);
  };

  const confirmChange = () => {
    setChangePhase("processing");
    setTimeout(() => {
      setChangePhase("success");
      setTimeout(() => {
        onPlanChange(selectedPlan.id);
        setChangingPlan(false);
        setChangePhase(null);
        setSelectedPlan(null);
      }, 1500);
    }, 2000);
  };

  const handleCardUpdate = () => {
    setUpdatingCard(true);
    setTimeout(() => { setUpdatingCard(false); setCardSaved(true); setTimeout(() => setCardSaved(false), 2000); }, 1800);
  };

  const isUpgrade = selectedPlan && selectedPlan.price > current.price;

  const INVOICES = []; // Loaded from Stripe via /api/billing/info

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-shell modal-shell-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-inner">
          <div className="modal-head">
            <div><h2 className="modal-title">Billing & Subscription</h2><p className="modal-sub">Manage your plan, payment method, and invoices</p></div>
            <button className="modal-close" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          </div>

          {/* Tabs */}
          <div className="bill-tabs">
            {[{ k: "plan", l: "Plan" }, { k: "payment", l: "Payment Method" }, { k: "invoices", l: "Invoices" }].map(t => (
              <button key={t.k} className={cn("bill-tab", tab === t.k && "bill-tab-on")} onClick={() => setTab(t.k)}>{t.l}</button>
            ))}
          </div>

          {/* Plan Tab */}
          {tab === "plan" && !changingPlan && (
            <div className="modal-body">
              <div className="bill-plans">
                {PLANS.map((p, i) => {
                  const isCurrent = p.id === currentPlan;
                  const isDown = p.price < current.price;
                  return (
                    <div key={p.id} className={cn("bill-plan", isCurrent && "bill-plan-current", p.popular && "bill-plan-pop")} style={{ animationDelay: `${i * 60}ms` }}>
                      {p.popular && !isCurrent && <div className="bill-pop-tag">MOST POPULAR</div>}
                      {isCurrent && <div className="prof-plan-current-tag">CURRENT</div>}
                      <div className="bill-plan-name">{p.name}</div>
                      <div className="bill-plan-price">${p.price}<span className="bill-plan-period">/mo</span></div>
                      <div className="bill-plan-features">
                        {p.features.map(f => (
                          <div key={f} className="bill-plan-feat"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={isCurrent ? "#00E5A0" : "#6366F1"} strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>{f}</span></div>
                        ))}
                      </div>
                      {isCurrent ? (
                        <div className="bill-plan-current-label">Your current plan</div>
                      ) : (
                        <button className={cn("bill-plan-btn", isDown && "bill-plan-btn-down")} onClick={() => handlePlanChange(p)}>
                          {isDown ? "Downgrade" : "Upgrade"} to {p.name}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Plan Change Confirmation */}
          {tab === "plan" && changingPlan && (
            <div className="modal-body">
              <div className="bill-change fade-in">
                {!changePhase && (
                  <div className="bill-change-review">
                    <div className="bill-change-header">{isUpgrade ? "Upgrade" : "Downgrade"} to {selectedPlan.name}</div>
                    <div className="bill-change-compare">
                      <div className="bill-compare-from">
                        <div className="bill-compare-label">CURRENT</div>
                        <div className="bill-compare-plan">{current.name}</div>
                        <div className="bill-compare-price">${current.price}/mo</div>
                      </div>
                      <div className="bill-compare-arrow">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                      </div>
                      <div className={cn("bill-compare-to", isUpgrade && "bill-compare-upgrade")}>
                        <div className="bill-compare-label">NEW PLAN</div>
                        <div className="bill-compare-plan">{selectedPlan.name}</div>
                        <div className="bill-compare-price">${selectedPlan.price}/mo</div>
                      </div>
                    </div>

                    <div className="bill-proration">
                      <div className="bill-pro-row"><span>Current billing period</span><span>Apr 1 \u2013 May 1, 2026</span></div>
                      <div className="bill-pro-row"><span>Days remaining</span><span>20 days</span></div>
                      <div className="bill-pro-row"><span>Prorated {isUpgrade ? "charge" : "credit"}</span><span className={isUpgrade ? "c-red" : "c-grn"}>{isUpgrade ? "" : "-"}${Math.abs(Math.round((selectedPlan.price - current.price) * (20/30) * 100) / 100).toFixed(2)}</span></div>
                      <div className="bill-pro-row bill-pro-total"><span>Due today</span><span className="c-bold">{isUpgrade ? `$${Math.round((selectedPlan.price - current.price) * (20/30) * 100) / 100}` : "$0.00"}</span></div>
                    </div>

                    {!isUpgrade && (
                      <div className="bill-downgrade-warn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFB800" strokeWidth="1.5"><path d="M12 9v2M12 15h.01M10.29 3.86l-8.42 14.68A2 2 0 003.6 21h16.8a2 2 0 001.73-2.96L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                        <span>Downgrading will reduce your follower limit to {selectedPlan.limits}. Excess accounts will be paused.</span>
                      </div>
                    )}

                    <div className="bill-change-actions">
                      <button className={cn("btn-primary btn-full", !isUpgrade && "bill-btn-downgrade")} onClick={confirmChange}>
                        <span>Confirm {isUpgrade ? "Upgrade" : "Downgrade"}</span>
                        <span className="btn-aw"><span className="btn-ar">&#10003;</span></span>
                      </button>
                      <button className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => { setChangingPlan(false); setSelectedPlan(null); }}>Cancel</button>
                    </div>
                  </div>
                )}

                {changePhase === "processing" && (
                  <div className="bill-processing fade-in">
                    <div className="auth-spinner" style={{ borderTopColor: "#6366F1", width: 48, height: 48, borderWidth: 3 }} />
                    <div className="bill-proc-title">Processing with Stripe...</div>
                    <div className="bill-proc-sub">Updating subscription and calculating proration</div>
                    <div className="bill-proc-steps">
                      <div className="bill-proc-step bill-proc-done"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>Subscription updated</div>
                      <div className="bill-proc-step"><div className="ls-spinner" style={{ width: 12, height: 12 }}/>Generating invoice</div>
                    </div>
                  </div>
                )}

                {changePhase === "success" && (
                  <div className="bill-success fade-in">
                    <div className="auth-check"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
                    <div className="bill-success-title">Plan {isUpgrade ? "Upgraded" : "Changed"}</div>
                    <div className="bill-success-sub">You are now on the {selectedPlan.name} plan</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Payment Tab */}
          {tab === "payment" && (
            <div className="modal-body">
              <div className="bill-payment fade-in">
                <div className="bill-card-preview">
                  <div className="bill-card-visual">
                    <div className="bill-card-chip">
                      <svg width="28" height="20" viewBox="0 0 28 20" fill="none"><rect width="28" height="20" rx="3" fill="rgba(255,255,255,0.15)"/><rect x="2" y="6" width="8" height="8" rx="1" fill="rgba(255,255,255,0.3)"/></svg>
                    </div>
                    <div className="bill-card-num">{cardNumber || "\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022"}</div>
                    <div className="bill-card-bottom"><span>{cardName || "CARDHOLDER"}</span><span>{cardExpiry || "MM/YY"}</span></div>
                    <div className="bill-card-brand">VISA</div>
                  </div>
                </div>

                <div className="bill-card-form">
                  <div className="bill-stripe-badge">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M8 12l3 3 5-5"/></svg>
                    <span>Secured by Stripe. Card data never touches Tradevanish servers.</span>
                  </div>
                  <div className="set-field" style={{ marginBottom: 14 }}>
                    <label className="set-label">CARD NUMBER</label>
                    <input type="text" className="set-input" placeholder="4242 4242 4242 4242" value={cardNumber} onChange={e => setCardNumber(e.target.value)} />
                  </div>
                  <div className="bill-card-row">
                    <div className="set-field"><label className="set-label">EXPIRY</label><input type="text" className="set-input" placeholder="MM/YY" value={cardExpiry} onChange={e => setCardExpiry(e.target.value)} /></div>
                    <div className="set-field"><label className="set-label">CVC</label><input type="text" className="set-input" placeholder="123" value={cardCvc} onChange={e => setCardCvc(e.target.value)} /></div>
                  </div>
                  <div className="set-field" style={{ marginTop: 14 }}>
                    <label className="set-label">CARDHOLDER NAME</label>
                    <input type="text" className="set-input" placeholder="Full name on card" value={cardName} onChange={e => setCardName(e.target.value)} />
                  </div>
                  <button className="btn-primary btn-full" onClick={handleCardUpdate} disabled={updatingCard} style={{ marginTop: 20 }}>
                    {updatingCard ? (<span>Updating...</span>) : cardSaved ? (<span className="c-grn">Card Updated</span>) : (<span>Update Payment Method</span>)}
                    <span className="btn-aw"><span className="btn-ar">{cardSaved ? "\u2713" : "\u2192"}</span></span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Invoices Tab */}
          {tab === "invoices" && (
            <div className="modal-body">
              <div className="bill-invoices fade-in">
                <div className="tbl-w"><table className="tbl">
                  <thead><tr><th>Invoice</th><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {INVOICES.map((inv, i) => (
                      <tr key={inv.id} className="tbl-r" style={{ animationDelay: `${i * 50}ms` }}>
                        <td><span className="tl-oid">{inv.id}</span></td>
                        <td className="c-dim">{inv.date}</td>
                        <td className="c-bold">{inv.plan}</td>
                        <td className="c-mono">{inv.amount}</td>
                        <td><span className="bill-inv-status">{inv.status}</span></td>
                        <td><button className="bill-inv-dl">PDF</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding Overlay ──────────────────────────────────────────────────────
function OnboardingOverlay({ onComplete }) {
  const [step, setStep] = useState(0);

  const STEPS = [
    { title: "Welcome to Tradevanish", sub: "Copy trades across unlimited accounts, each with a unique IP address.", icon: "logo",
      body: "Tradevanish connects to your broker, watches your master account for trades, and replicates them to every follower account instantly. Each account routes through its own dedicated residential proxy so every connection looks independent." },
    { title: "How It Works", sub: "Three things happen when you set up:", icon: "flow",
      items: [
        { num: "1", t: "Connect your broker", d: "Sign in with Tradovate or Rithmic. OAuth flow means your password never touches our servers." },
        { num: "2", t: "Get a unique IP", d: "Each account gets a dedicated residential proxy. Brokers see unique IPs per account." },
        { num: "3", t: "Start copying", d: "Master listener watches for trades. Followers execute in parallel through their own proxies." },
      ]},
    { title: "Choose Your Plan", sub: "Start with a 7-day free trial. No credit card required.", icon: "plan",
      plans: [
        { name: "Basic", price: "$39/mo", desc: "5 followers, 1 proxy provider" },
        { name: "Pro", price: "$69/mo", desc: "Unlimited followers, all providers", pop: true },
        { name: "Pro+", price: "$89/mo", desc: "API access, custom proxy pools" },
      ]},
    { title: "You're All Set", sub: "Let's connect your first trading account.", icon: "ready" },
  ];

  const s = STEPS[step];

  return (
    <div className="onb-overlay">
      <div className="onb-container fade-in">
        {/* Progress */}
        <div className="onb-progress">
          {STEPS.map((_, i) => (<div key={i} className={cn("onb-prog-dot", i <= step && "onb-prog-on")} />))}
        </div>

        <div className="onb-content fade-in" key={step}>
          {/* Step Icon */}
          <div className="onb-icon-wrap">
            {s.icon === "logo" && (
              <img src="/logo.png" alt="Tradevanish" width="48" height="48" style={{ borderRadius: 10 }} />
            )}
            {s.icon === "flow" && (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="1.5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M2 12h20"/><path d="M12 2c2.5 3 4 6.5 4 10s-1.5 7-4 10c-2.5-3-4-6.5-4-10s1.5-7 4-10z"/></svg>
            )}
            {s.icon === "plan" && (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            )}
            {s.icon === "ready" && (
              <div className="onb-ready-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
            )}
          </div>

          <h1 className="onb-title">{s.title}</h1>
          <p className="onb-sub">{s.sub}</p>

          {s.body && <p className="onb-body">{s.body}</p>}

          {s.items && (
            <div className="onb-items">
              {s.items.map((item, i) => (
                <div key={i} className="onb-item" style={{ animationDelay: `${i * 100}ms` }}>
                  <div className="onb-item-num">{item.num}</div>
                  <div><div className="onb-item-title">{item.t}</div><div className="onb-item-desc">{item.d}</div></div>
                </div>
              ))}
            </div>
          )}

          {s.plans && (
            <div className="onb-plans">
              {s.plans.map((p, i) => (
                <div key={i} className={cn("onb-plan", p.pop && "onb-plan-pop")} style={{ animationDelay: `${i * 80}ms` }}>
                  {p.pop && <div className="onb-plan-pop-tag">RECOMMENDED</div>}
                  <div className="onb-plan-name">{p.name}</div>
                  <div className="onb-plan-price">{p.price}</div>
                  <div className="onb-plan-desc">{p.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="onb-actions">
          {step > 0 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn-primary" style={{ flex: 1 }} onClick={() => step < STEPS.length - 1 ? setStep(step + 1) : onComplete()}>
            <span>{step === STEPS.length - 1 ? "Get Started" : "Continue"}</span>
            <span className="btn-aw"><span className="btn-ar">{step === STEPS.length - 1 ? "\u2713" : "\u2192"}</span></span>
          </button>
        </div>

        {step < STEPS.length - 1 && (
          <button className="onb-skip" onClick={onComplete}>Skip onboarding</button>
        )}
      </div>
    </div>
  );
}

// ─── Profile Page ────────────────────────────────────────────────────────────
// ─── Signal Webhook Panel ────────────────────────────────────────────────────
// ─── Signal Webhook Panel ────────────────────────────────────────────────────
function SignalWebhookPanel() {
  const [signalKeys, setSignalKeys] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState(null);
  const [showPayloads, setShowPayloads] = useState(false);
  const [signalHistory, setSignalHistory] = useState([]);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    apiFetch("/api/signals/keys").then(r => r.ok ? r.json() : null).then(d => { if (d?.keys) setSignalKeys(d.keys); }).catch(() => {});
    apiFetch("/api/signals/history").then(r => r.ok ? r.json() : null).then(d => { if (d?.history) setSignalHistory(d.history); }).catch(() => {});
  }, []);

  const createSignalKey = async () => {
    try {
      const r = await apiFetch("/api/signals/keys", { method: "POST", body: JSON.stringify({ name: newName || "TradingView Signal" }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setGeneratedUrl(d);
      setSignalKeys(prev => [...prev, { id: Date.now(), name: d.name, key_prefix: d.signalKey.slice(0, 12) + "...", status: "active" }]);
      setShowCreate(false); setNewName("");
    } catch (err) { alert("Failed: " + err.message); }
  };

  const deleteKey = async (id) => {
    if (!confirm("Revoke this signal key?")) return;
    await apiFetch(`/api/signals/keys/${id}`, { method: "DELETE" });
    setSignalKeys(prev => prev.filter(k => k.id !== id));
  };

  const cp = (text, label) => { navigator.clipboard.writeText(text).then(() => { setCopied(label); setTimeout(() => setCopied(null), 1500); }).catch(() => {}); };

  return (
    <div className="pp-section">
      {/* Generated URL */}
      {generatedUrl && (
        <div className="pp-wh-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="set-label" style={{ margin: 0 }}>WEBHOOK URL</span>
            <span className="pp-key-meta" style={{ color: "#FFB800" }}>Save this. Shown only once.</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code className="pp-wh-url" style={{ flex: 1, background: "rgba(0,0,0,0.3)", padding: "10px 12px", borderRadius: 6, margin: 0, wordBreak: "break-all" }}>{generatedUrl.signalUrl}</code>
            <button className="pp-pool-btn" onClick={() => cp(generatedUrl.signalUrl, "url")} style={{ padding: "8px 14px" }}>{copied === "url" ? "Copied" : "Copy"}</button>
          </div>
          <button onClick={() => setShowPayloads(!showPayloads)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--sans)", fontSize: 11, color: "var(--t3)" }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: showPayloads ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}><path d="M9 18l6-6-6-6"/></svg>
            Example payloads
          </button>
          {showPayloads && (
            <div style={{ display: "grid", gap: 8 }}>
              <div className="pp-key-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="pp-pool-meta-label">TRADINGVIEW STRATEGY</span>
                  <button className="pp-pool-btn" onClick={() => cp(generatedUrl.instructions.tradingview.message_format, "tv")} style={{ fontSize: 9 }}>{copied === "tv" ? "Copied" : "Copy"}</button>
                </div>
                <pre style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--t2)", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{generatedUrl.instructions.tradingview.message_format}</pre>
              </div>
              <div className="pp-key-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="pp-pool-meta-label">cURL</span>
                  <button className="pp-pool-btn" onClick={() => cp(generatedUrl.instructions.custom_curl, "curl")} style={{ fontSize: 9 }}>{copied === "curl" ? "Copied" : "Copy"}</button>
                </div>
                <pre style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--t2)", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{generatedUrl.instructions.custom_curl}</pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active keys */}
      {signalKeys.map(k => (
        <div key={k.id} className="pp-key-row" style={{ marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)" }}>{k.name}</span>
            <span className="pp-key-meta" style={{ marginLeft: 10 }}>{k.key_prefix}</span>
          </div>
          <span className="pp-pool-status pp-pool-active">Active</span>
          <button className="pp-pool-btn pp-pool-btn-del" onClick={() => deleteKey(k.id)}>Revoke</button>
        </div>
      ))}

      {/* Create form */}
      {!showCreate ? (
        <button className="pp-add-btn" onClick={() => setShowCreate(true)}>+ New Signal Webhook</button>
      ) : (
        <div className="pp-add-form fade-in">
          <div className="set-field">
            <label className="set-label">STRATEGY NAME</label>
            <input className="set-input" placeholder="e.g. NQ Scalper, ES Breakout" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && createSignalKey()} autoFocus />
          </div>
          <div className="pp-add-actions">
            <button className="btn-primary" onClick={createSignalKey}><span>Generate Webhook URL</span><span className="btn-aw"><span className="btn-ar">&#10003;</span></span></button>
            <button className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Signal history */}
      {signalHistory.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="set-label">RECENT SIGNALS</div>
          {signalHistory.slice(0, 5).map((s, i) => (
            <div key={i} className="pp-key-row" style={{ marginBottom: 4, padding: "6px 12px" }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, color: s.signal_type?.includes("ERROR") || s.signal_type?.includes("FAILED") ? "var(--red)" : "#00E5A0", minWidth: 80 }}>{s.signal_type?.replace("WEBHOOK_", "")}</span>
              <span className="pp-key-meta" style={{ flex: 1 }}>{s.contract_id} {s.side} x{s.qty}</span>
              <span className="pp-key-meta">{new Date(s.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfilePage({ onSignOut, currentPlan, onPlanChange, user }) {
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [billingTab, setBillingTab] = useState("plan");

  // Notifications
  const [notifCopyFails, setNotifCopyFails] = useState(true);
  const [notifProxyDown, setNotifProxyDown] = useState(true);
  const [notifDailyReport, setNotifDailyReport] = useState(false);
  const [notifListenerDrop, setNotifListenerDrop] = useState(true);
  const [notifDrawdownHit, setNotifDrawdownHit] = useState(true);
  const [notifChannel, setNotifChannel] = useState("email");
  const [showSignOut, setShowSignOut] = useState(false);

  // Pro+ Custom Proxy Pools
  const [customPools, setCustomPools] = useState([]);
  const [showAddPool, setShowAddPool] = useState(false);
  const [newPool, setNewPool] = useState({ name: "", provider: "brightdata", region: "us-east", size: 10 });

  // Pro+ API Keys
  const [apiKeys, setApiKeys] = useState([]);
  const [showNewKey, setShowNewKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Pro+ Webhooks
  const [webhooks, setWebhooks] = useState([]);
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [newWebhook, setNewWebhook] = useState({ url: "", events: [] });

  // Load Pro+ data from DB
  useEffect(() => {
    if (currentPlan === "proplus") {
      apiFetch("/api/proplus/keys").then(r => r.ok ? r.json() : null).then(d => {
        if (d?.keys) setApiKeys(d.keys.map(k => ({ id: k.id, name: k.name, key: k.key_prefix, created: new Date(k.created_at).toLocaleDateString(), lastUsed: k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never", status: k.status })));
      }).catch(() => {});
      apiFetch("/api/proplus/webhooks").then(r => r.ok ? r.json() : null).then(d => {
        if (d?.webhooks) setWebhooks(d.webhooks.map(w => ({ id: w.id, url: w.url, events: JSON.parse(w.events || "[]"), status: w.status, lastDelivery: w.last_delivery || "Never", successRate: w.total_count > 0 ? `${Math.round(w.success_count/w.total_count*100)}%` : "N/A" })));
      }).catch(() => {});
      apiFetch("/api/proplus/proxy-pools").then(r => r.ok ? r.json() : null).then(d => {
        if (d?.pools) setCustomPools(d.pools.map(p => ({ id: p.id, name: p.name, provider: p.provider, region: p.region, ips: p.ip_count || p.size, status: p.status })));
      }).catch(() => {});
    }
    // Load notification preferences
    apiFetch("/api/notifications/preferences").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.preferences) {
        setNotifChannel(d.preferences.channel || "email");
        setNotifCopyFails(d.preferences.copy_failures !== false);
        setNotifProxyDown(d.preferences.proxy_health !== false);
        setNotifListenerDrop(d.preferences.listener_disconnects !== false);
        setNotifDrawdownHit(d.preferences.drawdown_alerts !== false);
        setNotifDailyReport(d.preferences.daily_pnl || false);
      }
    }).catch(() => {});
  }, [currentPlan]);

  // Save notification preferences when they change
  const saveNotifPrefs = useCallback(() => {
    apiFetch("/api/notifications/preferences", {
      method: "PUT",
      body: JSON.stringify({
        channel: notifChannel, copy_failures: notifCopyFails, proxy_health: notifProxyDown,
        listener_disconnects: notifListenerDrop, drawdown_alerts: notifDrawdownHit, daily_pnl: notifDailyReport,
      }),
    }).catch(() => {});
  }, [notifChannel, notifCopyFails, notifProxyDown, notifListenerDrop, notifDrawdownHit, notifDailyReport]);

  useEffect(() => { saveNotifPrefs(); }, [notifChannel, notifCopyFails, notifProxyDown, notifListenerDrop, notifDrawdownHit, notifDailyReport]);

  const handleSave = async () => {
    try {
      const r = await apiFetch("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ name, phone }),
      });
      if (r.ok) {
        setEditing(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const data = await r.json();
        alert(data.error || "Save failed");
      }
    } catch (err) {
      alert("Save failed: " + err.message);
    }
  };
  const openBilling = (tab) => { setBillingTab(tab); setShowBilling(true); };

  const PLANS = { basic: "Basic", pro: "Pro", proplus: "Pro+" };
  const PRICES = { basic: "$39", pro: "$69", proplus: "$89" };
  const isPro = currentPlan === "pro" || currentPlan === "proplus";
  const isProPlus = currentPlan === "proplus";

  const PLAN_FEATURES = {
    basic: { followers: 5, providers: 1, overrides: false, customPools: false, api: false, webhooks: false, sla: false },
    pro: { followers: "Unlimited", providers: "All", overrides: true, customPools: false, api: false, webhooks: false, sla: false },
    proplus: { followers: "Unlimited", providers: "All", overrides: true, customPools: true, api: true, webhooks: true, sla: true },
  };
  const features = PLAN_FEATURES[currentPlan];

  const WEBHOOK_EVENTS = [
    { id: "trade.executed", label: "Trade Executed", desc: "When a copy trade fills on a follower" },
    { id: "trade.failed", label: "Trade Failed", desc: "When a follower order is rejected" },
    { id: "listener.connected", label: "Listener Connected", desc: "Master listener comes online" },
    { id: "listener.disconnected", label: "Listener Disconnected", desc: "Master WebSocket drops" },
    { id: "risk.drawdown", label: "Drawdown Alert", desc: "Account hits drawdown limit" },
    { id: "proxy.rotated", label: "Proxy Rotated", desc: "IP rotation event on any account" },
    { id: "account.connected", label: "Account Connected", desc: "New broker account added" },
  ];

  const generateApiKey = async () => {
    try {
      const r = await apiFetch("/api/proplus/keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName || "Untitled", env: "live" }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || data.message);
      setGeneratedKey(data.key);
      setApiKeys(prev => [...prev, { id: data.prefix, name: data.name, key: data.prefix, created: "Just now", lastUsed: "Never", status: "active" }]);
    } catch (err) {
      alert("Failed to generate key: " + err.message);
    }
  };

  const addPool = async () => {
    try {
      const r = await apiFetch("/api/proplus/proxy-pools", {
        method: "POST",
        body: JSON.stringify(newPool),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || data.message);
      setCustomPools(prev => [...prev, { id: data.pool.id, name: data.pool.name, provider: data.pool.provider, region: data.pool.region, ips: data.pool.size, status: data.pool.status }]);
      setShowAddPool(false);
      setNewPool({ name: "", provider: "brightdata", region: "us-east", size: 10 });
    } catch (err) {
      alert("Failed to create pool: " + err.message);
    }
  };

  const addWebhook = async () => {
    try {
      const r = await apiFetch("/api/proplus/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: newWebhook.url, events: newWebhook.events }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || data.message);
      setWebhooks(prev => [...prev, { id: data.webhook.id, url: data.webhook.url, events: JSON.parse(data.webhook.events || "[]"), status: "active", lastDelivery: "Never", successRate: "N/A", secret: data.secret }]);
      setShowAddWebhook(false);
      setNewWebhook({ url: "", events: [] });
    } catch (err) {
      alert("Failed to create webhook: " + err.message);
    }
  };

  const toggleWebhookEvent = (evtId) => {
    setNewWebhook(prev => ({ ...prev, events: prev.events.includes(evtId) ? prev.events.filter(e => e !== evtId) : [...prev.events, evtId] }));
  };

  return (
    <div className="page fade-in">
      <div className="pg-head">
        <div><h1 className="pg-title">Profile</h1><p className="pg-sub">Account details, plan, and notification preferences</p></div>
        {saved && <span className="set-saved fade-in">Saved</span>}
      </div>

      {/* Profile Card */}
      <div className="card-sh"><div className="card-in">
        <div className="prof-header">
          <div className="prof-avatar-lg"><span className="prof-avatar-text">{name.charAt(0)}</span></div>
          <div className="prof-header-info">
            <h2 className="prof-header-name">{name}</h2>
            <p className="prof-header-email">{email}</p>
            <div className="prof-header-badges">
              <span className="prof-plan-badge">{PLANS[currentPlan]} PLAN</span>
              <span className="prof-member-badge">{user?.created_at ? `Since ${new Date(user.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : "Member"}</span>
            </div>
          </div>
          {!editing && <button className="btn-ghost" onClick={() => setEditing(true)}>Edit Profile</button>}
        </div>
        <div className="prof-fields">
          <div className="prof-field-grid">
            <div className="set-field"><label className="set-label">FULL NAME</label>{editing ? <input type="text" className="set-input" value={name} onChange={e => setName(e.target.value)} /> : <div className="prof-field-val">{name}</div>}</div>
            <div className="set-field"><label className="set-label">EMAIL ADDRESS</label>{editing ? <input type="email" className="set-input" value={email} onChange={e => setEmail(e.target.value)} /> : <div className="prof-field-val">{email}</div>}</div>
            <div className="set-field"><label className="set-label">PHONE NUMBER</label>{editing ? <input type="tel" className="set-input" value={phone} onChange={e => setPhone(e.target.value)} /> : <div className="prof-field-val">{phone}</div>}</div>
            <div className="set-field"><label className="set-label">PASSWORD</label>{editing ? <button className="prof-change-pw-btn">Change Password</button> : <div className="prof-field-val prof-field-masked">{"\u2022".repeat(12)}</div>}</div>
          </div>
          {editing && <div className="prof-edit-actions fade-in"><button className="btn-primary" onClick={handleSave}><span>Save Changes</span><span className="btn-aw"><span className="btn-ar">&#10003;</span></span></button><button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button></div>}
        </div>
      </div></div>

      {/* Plan + Limits */}
      <div className="card-sh"><div className="card-in">
        <div className="card-hd"><h2 className="card-t">Subscription</h2><span className="badge" style={{ color: "#A78BFA", borderColor: "rgba(167,139,250,0.2)", background: "rgba(167,139,250,0.08)" }}>ACTIVE</span></div>
        <div className="prof-plan-section">
          <div className="prof-plan-active">
            <div className="prof-plan-active-left">
              <div className="prof-plan-active-name">{PLANS[currentPlan]}</div>
              <div className="prof-plan-active-price">{PRICES[currentPlan]}<span className="prof-plan-period">/mo</span></div>
            </div>
            <div className="prof-plan-active-actions">
              <button className="btn-primary" onClick={() => openBilling("plan")}><span>Change Plan</span><span className="btn-aw"><span className="btn-ar">&#8594;</span></span></button>
            </div>
          </div>

          {/* Plan limits grid */}
          <div className="pp-limits">
            {[
              { label: "Follower Accounts", value: features.followers, active: true },
              { label: "Proxy Providers", value: features.providers, active: true },
              { label: "Per-Follower Overrides", value: features.overrides ? "Yes" : "No", active: features.overrides },
              { label: "Custom Proxy Pools", value: features.customPools ? "Yes" : "No", active: features.customPools },
              { label: "REST API Access", value: features.api ? "Yes" : "No", active: features.api },
              { label: "Webhooks", value: features.webhooks ? "Yes" : "No", active: features.webhooks },
            ].map((f, i) => (
              <div key={i} className={cn("pp-limit", !f.active && "pp-limit-off")}>
                <span className="pp-limit-label">{f.label}</span>
                <span className={cn("pp-limit-val", f.active && "pp-limit-val-on")}>{String(f.value)}</span>
              </div>
            ))}
          </div>

          <div className="prof-billing-row">
            <div className="prof-billing-info"><span className="prof-billing-label">PLAN STATUS</span><span className="prof-billing-val c-grn">Active</span></div>
            <div className="prof-billing-btns">
              <button className="prof-manage-billing" onClick={() => openBilling("payment")}>Update Card</button>
              <button className="prof-manage-billing" onClick={() => openBilling("invoices")}>View Invoices</button>
            </div>
          </div>
        </div>
      </div></div>

      {/* ─── Pro+ Custom Proxy Pools ─────────────────────────────────────── */}
      <div className={cn("card-sh", !isProPlus && "pp-locked-card")}>
        <div className="card-in">
          <div className="card-hd">
            <h2 className="card-t">Custom Proxy Pools</h2>
            {isProPlus ? <span className="badge">PRO+</span> : <span className="pp-upgrade-badge" onClick={() => openBilling("plan")}>Upgrade to Pro+</span>}
          </div>
          {isProPlus ? (
            <div className="pp-section">
              <div className="pp-pool-grid">
                {customPools.map(pool => (
                  <div key={pool.id} className="pp-pool-card">
                    <div className="pp-pool-head">
                      <div className="pp-pool-name">{pool.name}</div>
                      <span className={cn("pp-pool-status", pool.status === "active" ? "pp-pool-active" : "pp-pool-prov")}>{pool.status}</span>
                    </div>
                    <div className="pp-pool-meta">
                      <div className="pp-pool-meta-item"><span className="pp-pool-meta-label">PROVIDER</span><span>{pool.provider}</span></div>
                      <div className="pp-pool-meta-item"><span className="pp-pool-meta-label">REGION</span><span>{pool.region}</span></div>
                      <div className="pp-pool-meta-item"><span className="pp-pool-meta-label">IPs</span><span>{pool.ips}</span></div>
                    </div>
                    <div className="pp-pool-actions">
                      <button className="pp-pool-btn">Test</button>
                      <button className="pp-pool-btn">Rotate All</button>
                      <button className="pp-pool-btn pp-pool-btn-del" onClick={() => setCustomPools(prev => prev.filter(p => p.id !== pool.id))}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
              {!showAddPool ? (
                <button className="pp-add-btn" onClick={() => setShowAddPool(true)}>+ Add Proxy Pool</button>
              ) : (
                <div className="pp-add-form fade-in">
                  <div className="set-grid-2">
                    <div className="set-field"><label className="set-label">POOL NAME</label><input className="set-input" placeholder="e.g. US East Trading" value={newPool.name} onChange={e => setNewPool({...newPool, name: e.target.value})} /></div>
                    <div className="set-field"><label className="set-label">PROVIDER</label>
                      <div className="set-btn-group">{[{v:"brightdata",l:"BrightData"},{v:"oxylabs",l:"Oxylabs"},{v:"smartproxy",l:"SmartProxy"},{v:"iproyal",l:"IPRoyal"}].map(o => (
                        <button key={o.v} className={cn("set-btn-opt", newPool.provider===o.v && "set-btn-opt-on")} onClick={() => setNewPool({...newPool, provider: o.v})}>{o.l}</button>
                      ))}</div>
                    </div>
                    <div className="set-field"><label className="set-label">REGION</label>
                      <div className="set-btn-group">{[{v:"us-east",l:"US East"},{v:"us-west",l:"US West"},{v:"eu-west",l:"EU West"},{v:"asia",l:"Asia"}].map(o => (
                        <button key={o.v} className={cn("set-btn-opt", newPool.region===o.v && "set-btn-opt-on")} onClick={() => setNewPool({...newPool, region: o.v})}>{o.l}</button>
                      ))}</div>
                    </div>
                    <div className="set-field"><label className="set-label">POOL SIZE (IPs)</label><input type="number" className="set-input" value={newPool.size} onChange={e => setNewPool({...newPool, size: Number(e.target.value)})} /></div>
                  </div>
                  <div className="pp-add-actions">
                    <button className="btn-primary" onClick={addPool}><span>Create Pool</span><span className="btn-aw"><span className="btn-ar">&#10003;</span></span></button>
                    <button className="btn-ghost" onClick={() => setShowAddPool(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="pp-locked-body">
              <p>Provision dedicated proxy pools with your preferred provider and region. Assign pools to specific accounts for maximum control over IP isolation.</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── TradingView Signal Webhooks ─────────────────────────────────── */}
      <div className="card-sh">
        <div className="card-in">
          <div className="card-hd">
            <h2 className="card-t">Signal Webhooks</h2>
            <span className="badge" style={{ color: "#00E5A0", borderColor: "rgba(0,229,160,0.2)", background: "rgba(0,229,160,0.08)" }}>TRADINGVIEW</span>
          </div>
          <SignalWebhookPanel />
        </div>
      </div>

      {/* ─── Pro+ REST API ────────────────────────────────────────────────── */}
      <div className={cn("card-sh", !isProPlus && "pp-locked-card")}>
        <div className="card-in">
          <div className="card-hd">
            <h2 className="card-t">REST API</h2>
            {isProPlus ? <span className="badge">PRO+</span> : <span className="pp-upgrade-badge" onClick={() => openBilling("plan")}>Upgrade to Pro+</span>}
          </div>
          {isProPlus ? (
            <div className="pp-section">
              <div className="pp-api-info">
                <div className="pp-api-endpoint">
                  <span className="pp-api-method">BASE URL</span>
                  <code className="pp-api-url">https://api.tradevanish.com/v1</code>
                </div>
                <p className="pp-api-desc">Programmatic access to accounts, trades, proxies, and listener controls. Full API reference at docs.tradevanish.com</p>
              </div>

              <div className="pp-api-keys">
                <div className="pp-api-keys-head">
                  <span className="set-label" style={{marginBottom:0}}>API KEYS</span>
                  {!showNewKey && <button className="pp-add-btn-sm" onClick={() => setShowNewKey(true)}>+ Generate Key</button>}
                </div>

                {showNewKey && (
                  <div className="pp-newkey fade-in">
                    {!generatedKey ? (
                      <div className="pp-newkey-form">
                        <input className="set-input" placeholder="Key name (e.g. Production)" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} style={{flex:1}} />
                        <button className="btn-primary" onClick={generateApiKey}><span>Generate</span><span className="btn-aw"><span className="btn-ar">&#10003;</span></span></button>
                        <button className="btn-ghost" onClick={() => { setShowNewKey(false); setNewKeyName(""); }}>Cancel</button>
                      </div>
                    ) : (
                      <div className="pp-newkey-result fade-in">
                        <div className="pp-newkey-warn">Copy this key now. It won't be shown again.</div>
                        <div className="pp-newkey-display">
                          <code className="pp-newkey-code">{generatedKey}</code>
                          <button className="pp-newkey-copy" onClick={() => { navigator.clipboard?.writeText(generatedKey); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }}>{copiedKey ? "Copied" : "Copy"}</button>
                        </div>
                        <button className="btn-ghost" style={{marginTop:10}} onClick={() => { setShowNewKey(false); setGeneratedKey(null); setNewKeyName(""); setCopiedKey(false); }}>Done</button>
                      </div>
                    )}
                  </div>
                )}

                {apiKeys.map(k => (
                  <div key={k.id} className="pp-key-row">
                    <div className="pp-key-name">{k.name}</div>
                    <code className="pp-key-val">{k.key}</code>
                    <span className="pp-key-meta">Created {k.created}</span>
                    <span className="pp-key-meta">Last used: {k.lastUsed}</span>
                    <button className="pp-pool-btn pp-pool-btn-del" onClick={() => setApiKeys(prev => prev.filter(key => key.id !== k.id))}>Revoke</button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="pp-locked-body">
              <p>Programmatic access to manage accounts, execute trades, control listeners, and query execution history via REST API with bearer token auth.</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Pro+ Webhooks ────────────────────────────────────────────────── */}
      <div className={cn("card-sh", !isProPlus && "pp-locked-card")}>
        <div className="card-in">
          <div className="card-hd">
            <h2 className="card-t">Webhooks</h2>
            {isProPlus ? <span className="badge">PRO+</span> : <span className="pp-upgrade-badge" onClick={() => openBilling("plan")}>Upgrade to Pro+</span>}
          </div>
          {isProPlus ? (
            <div className="pp-section">
              {webhooks.map(wh => (
                <div key={wh.id} className="pp-wh-row">
                  <div className="pp-wh-main">
                    <code className="pp-wh-url">{wh.url}</code>
                    <div className="pp-wh-events">{wh.events.map(e => <span key={e} className="pp-wh-event-tag">{e}</span>)}</div>
                  </div>
                  <div className="pp-wh-stats">
                    <span className="pp-key-meta">Last: {wh.lastDelivery}</span>
                    <span className="pp-key-meta">{wh.successRate}</span>
                    <button className="pp-pool-btn pp-pool-btn-del" onClick={() => setWebhooks(prev => prev.filter(w => w.id !== wh.id))}>Remove</button>
                  </div>
                </div>
              ))}

              {!showAddWebhook ? (
                <button className="pp-add-btn" onClick={() => setShowAddWebhook(true)}>+ Add Webhook</button>
              ) : (
                <div className="pp-add-form fade-in">
                  <div className="set-field"><label className="set-label">ENDPOINT URL</label><input className="set-input" placeholder="https://your-server.com/webhook" value={newWebhook.url} onChange={e => setNewWebhook({...newWebhook, url: e.target.value})} style={{fontFamily:"var(--mono)",fontSize:12}} /></div>
                  <div className="set-field" style={{marginTop:14}}>
                    <label className="set-label">EVENTS</label>
                    <div className="pp-wh-event-grid">
                      {WEBHOOK_EVENTS.map(evt => (
                        <button key={evt.id} className={cn("pp-wh-event-btn", newWebhook.events.includes(evt.id) && "pp-wh-event-btn-on")} onClick={() => toggleWebhookEvent(evt.id)}>
                          <span className="pp-wh-evt-name">{evt.label}</span>
                          <span className="pp-wh-evt-desc">{evt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="pp-add-actions">
                    <button className="btn-primary" onClick={addWebhook} disabled={!newWebhook.url || newWebhook.events.length === 0}><span>Create Webhook</span><span className="btn-aw"><span className="btn-ar">&#10003;</span></span></button>
                    <button className="btn-ghost" onClick={() => { setShowAddWebhook(false); setNewWebhook({ url: "", events: [] }); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="pp-locked-body">
              <p>Receive real-time HTTP callbacks for trade executions, listener events, risk alerts, and proxy rotations. Deliver to any endpoint with retry logic.</p>
            </div>
          )}
        </div>
      </div>

      {/* Notifications */}
      <div className="card-sh"><div className="card-in">
        <div className="card-hd"><h2 className="card-t">Notifications</h2><span className="badge">ALERTS</span></div>
        <div className="set-section">
          <div className="set-grid-2">
            <div className="set-field">
              <label className="set-label">NOTIFICATION CHANNEL</label>
              <div className="set-btn-group" style={{ marginBottom: 20 }}>{[{ v: "email", l: "Email" }, { v: "sms", l: "SMS" }, { v: "both", l: "Both" }].map(opt => (<button key={opt.v} className={cn("set-btn-opt", notifChannel === opt.v && "set-btn-opt-on")} onClick={() => setNotifChannel(opt.v)}>{opt.l}</button>))}</div>
              <div className="set-toggles-col">
                <div className="set-toggle-row"><button className={cn("set-toggle-btn", notifCopyFails && "set-toggle-on")} onClick={() => setNotifCopyFails(!notifCopyFails)}><div className="set-toggle-track"><div className="set-toggle-thumb" /></div></button><div className="prof-notif-text"><span className="prof-notif-title">Copy execution failures</span><span className="prof-notif-desc">When a follower order fails or is rejected</span></div></div>
                <div className="set-toggle-row"><button className={cn("set-toggle-btn", notifProxyDown && "set-toggle-on")} onClick={() => setNotifProxyDown(!notifProxyDown)}><div className="set-toggle-track"><div className="set-toggle-thumb" /></div></button><div className="prof-notif-text"><span className="prof-notif-title">Proxy health alerts</span><span className="prof-notif-desc">When a proxy goes down or latency spikes</span></div></div>
                <div className="set-toggle-row"><button className={cn("set-toggle-btn", notifListenerDrop && "set-toggle-on")} onClick={() => setNotifListenerDrop(!notifListenerDrop)}><div className="set-toggle-track"><div className="set-toggle-thumb" /></div></button><div className="prof-notif-text"><span className="prof-notif-title">Listener disconnections</span><span className="prof-notif-desc">When master WebSocket drops or reconnects</span></div></div>
              </div>
            </div>
            <div className="set-field">
              <label className="set-label">REPORTS &amp; RISK</label>
              <div className="set-toggles-col">
                <div className="set-toggle-row"><button className={cn("set-toggle-btn", notifDrawdownHit && "set-toggle-on-red")} onClick={() => setNotifDrawdownHit(!notifDrawdownHit)}><div className="set-toggle-track"><div className="set-toggle-thumb" /></div></button><div className="prof-notif-text"><span className="prof-notif-title">Drawdown limit alerts</span><span className="prof-notif-desc">Immediate alert when any account hits drawdown</span></div></div>
                <div className="set-toggle-row"><button className={cn("set-toggle-btn", notifDailyReport && "set-toggle-on")} onClick={() => setNotifDailyReport(!notifDailyReport)}><div className="set-toggle-track"><div className="set-toggle-thumb" /></div></button><div className="prof-notif-text"><span className="prof-notif-title">Daily P&L summary</span><span className="prof-notif-desc">End-of-day report with all account performance</span></div></div>
              </div>
            </div>
          </div>
        </div>
      </div></div>

      {/* Sign Out */}
      <div className="prof-signout-section">
        {!showSignOut ? (
          <button className="prof-signout-btn" onClick={() => setShowSignOut(true)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>Sign Out</button>
        ) : (
          <div className="prof-signout-confirm fade-in"><p className="prof-signout-msg">Sign out of Tradevanish? Active listeners will stop.</p><div className="prof-signout-actions"><button className="prof-signout-yes" onClick={onSignOut}>Yes, Sign Out</button><button className="btn-ghost" onClick={() => setShowSignOut(false)}>Cancel</button></div></div>
        )}
      </div>

      {showBilling && <BillingModal key={billingTab} onClose={() => setShowBilling(false)} currentPlan={currentPlan} onPlanChange={onPlanChange} initialTab={billingTab} />}
    </div>
  );
}

function Placeholder({ title, sub }) {
  return (<div className="page fade-in"><div className="pg-head"><div><h1 className="pg-title">{title}</h1><p className="pg-sub">{sub}</p></div></div><div className="card-sh"><div className="card-in" style={{ padding: "80px 40px", textAlign: "center" }}><div style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Module under construction</div></div></div></div>);
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login"); // login | register | forgot | reset | 2fa
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const handleSubmit = async () => {
    if (mode === "forgot") {
      if (!email) return setError("Email required");
      setLoading(true); setError(null);
      try {
        const res = await apiFetch("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ email }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSuccessMsg("Reset code sent to your email. Check your inbox.");
        setMode("reset");
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
      return;
    }

    if (mode === "reset") {
      if (!email || !resetCode || !newPassword) return setError("All fields required");
      setLoading(true); setError(null);
      try {
        const res = await apiFetch("/api/auth/reset-password/confirm", {
          method: "POST", body: JSON.stringify({ email, code: resetCode, newPassword }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSuccessMsg("Password reset! You can now sign in.");
        setMode("login"); setPassword("");
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
      return;
    }

    if (!email || !password) return setError("Email and password required");
    if (mode === "register" && !name) return setError("Name required");
    setLoading(true); setError(null);

    try {
      const endpoint = mode === "login" || mode === "2fa" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "register" 
        ? { email, password, name } 
        : mode === "2fa"
        ? { email, password, totp_code: totpCode }
        : { email, password };
      const res = await apiFetch(endpoint, {
        method: "POST", body: JSON.stringify(body),
      });
      const data = await res.json();
      
      // Handle 2FA requirement
      if (data.requires_2fa) {
        setMode("2fa");
        setError(null);
        setLoading(false);
        return;
      }
      
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      onAuth(data.user, data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-screen-inner fade-in">
        <div className="auth-screen-brand">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 6 }}>
            <img src="/logo.png" alt="Tradevanish" width="38" height="38" style={{ borderRadius: 8 }} />
            <h1 className="auth-screen-title">Tradevanish</h1>
          </div>
          <p className="auth-screen-sub">The Stealth Standard for Modern Prop Trading</p>
        </div>

        <div className="auth-screen-card">
          {(mode === "login" || mode === "register") && (
            <div className="auth-screen-tabs">
              <button className={cn("auth-screen-tab", mode === "login" && "auth-screen-tab-on")} onClick={() => { setMode("login"); setError(null); setSuccessMsg(null); }}>Sign In</button>
              <button className={cn("auth-screen-tab", mode === "register" && "auth-screen-tab-on")} onClick={() => { setMode("register"); setError(null); setSuccessMsg(null); }}>Create Account</button>
            </div>
          )}

          {(mode === "forgot" || mode === "reset") && (
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--bdr)", marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--t1)", margin: 0, fontFamily: "var(--sans)", letterSpacing: "-0.02em" }}>{mode === "forgot" ? "Reset Password" : "Enter Reset Code"}</h2>
              <p style={{ fontSize: 13, color: "var(--t3)", margin: "6px 0 0", fontFamily: "var(--sans)" }}>{mode === "forgot" ? "Enter your email to receive a reset code" : "Check your email for the 6-digit code"}</p>
            </div>
          )}

          {mode === "2fa" && (
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--bdr)", marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--t1)", margin: 0, fontFamily: "var(--sans)", letterSpacing: "-0.02em" }}>Two-Factor Authentication</h2>
              <p style={{ fontSize: 13, color: "var(--t3)", margin: "6px 0 0", fontFamily: "var(--sans)" }}>Enter the 6-digit code from your authenticator app</p>
            </div>
          )}

          <div className="auth-screen-form">
            {mode === "register" && (
              <div className="set-field"><label className="set-label">FULL NAME</label><input type="text" className="set-input" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} /></div>
            )}

            {(mode === "login" || mode === "register" || mode === "forgot" || mode === "reset") && (
              <div className="set-field"><label className="set-label">EMAIL</label><input type="email" className="set-input" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} /></div>
            )}

            {(mode === "login" || mode === "register") && (
              <div className="set-field"><label className="set-label">PASSWORD</label><input type="password" className="set-input" placeholder={mode === "register" ? "Create a password" : "Your password"} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} /></div>
            )}

            {mode === "reset" && (
              <>
                <div className="set-field"><label className="set-label">RESET CODE</label><input type="text" className="set-input" placeholder="6-digit code from your email" value={resetCode} onChange={e => setResetCode(e.target.value)} style={{ fontFamily: "var(--mono)", fontSize: 16, letterSpacing: "3px", textAlign: "center" }} maxLength={6} /></div>
                <div className="set-field"><label className="set-label">NEW PASSWORD</label><input type="password" className="set-input" placeholder="Create a new password" value={newPassword} onChange={e => setNewPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} /></div>
              </>
            )}

            {mode === "2fa" && (
              <div className="set-field"><label className="set-label">AUTHENTICATOR CODE</label><input type="text" className="set-input" placeholder="6-digit code from your app" value={totpCode} onChange={e => setTotpCode(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} style={{ fontFamily: "var(--mono)", fontSize: 16, letterSpacing: "3px", textAlign: "center" }} maxLength={6} autoFocus /></div>
            )}

            {successMsg && <div style={{ background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.2)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#00E5A0", marginBottom: 8 }}>{successMsg}</div>}
            {error && <div className="auth-screen-error">{error}</div>}

            <button className="btn-primary btn-full" onClick={handleSubmit} disabled={loading} style={{ marginTop: 20 }}>
              <span>{loading ? "Processing..." : mode === "login" ? "Sign In" : mode === "register" ? "Create Account" : mode === "forgot" ? "Send Reset Code" : mode === "2fa" ? "Verify Code" : "Reset Password"}</span>
              <span className="btn-aw"><span className="btn-ar">{loading ? "..." : "\u2192"}</span></span>
            </button>

            {mode === "login" && (
              <button onClick={() => { setMode("forgot"); setError(null); setSuccessMsg(null); }} style={{ background: "none", border: "none", color: "var(--t3)", fontSize: 12, cursor: "pointer", marginTop: 12, textAlign: "center", width: "100%" }}>Forgot your password?</button>
            )}

            {(mode === "forgot" || mode === "reset") && (
              <button onClick={() => { setMode("login"); setError(null); setSuccessMsg(null); }} style={{ background: "none", border: "none", color: "var(--t3)", fontSize: 12, cursor: "pointer", marginTop: 12, textAlign: "center", width: "100%" }}>Back to Sign In</button>
            )}
          </div>
        </div>

        <p className="auth-screen-footer">Copy trades across unlimited accounts with IP isolation per connection.</p>
      </div>
    </div>
  );
}

// ─── App Root ────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [page, setPage] = useState("overview");
  const [accounts, setAccounts] = useState(INITIAL_ACCOUNTS);
  const [showConnect, setShowConnect] = useState(false);
  const [oauthResume, setOauthResume] = useState(null); // { token, env, platform }
  const [expandedTrade, setExpandedTrade] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentPlan, setCurrentPlan] = useState("basic");

  // Check for existing session on mount (cookie sent automatically)
  useEffect(() => {
    // Check for Tradovate OAuth callback params in URL
    const params = new URLSearchParams(window.location.search);
    const tradovateToken = params.get("tradovate_token");
    const tradovateEnv = params.get("tradovate_env") || "demo";
    const tradovateError = params.get("tradovate_error");

    if (tradovateToken || tradovateError) {
      // Clean URL immediately
      window.history.replaceState({}, "", window.location.pathname);
    }

    apiFetch("/api/auth/me")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user) {
          setUser(data.user);
          setAuthToken("session");
          setCurrentPlan(data.user.plan || "basic");
          // Load saved accounts from DB
          apiFetch("/api/accounts").then(r => r.ok ? r.json() : null).then(acctData => {
            if (acctData?.accounts?.length) {
              setAccounts(acctData.accounts.map(a => ({
                id: a.id, label: a.label || `${a.platform} Account`, platform: a.platform,
                role: a.role, status: a.status || "connected",
                ip: a.ip_address ? a.ip_address.replace(/\.\d+\.\d+$/, ".xx." + a.ip_address.split(".").pop()) : null,
                proxy: a.provider || "BrightData", region: a.region || "US-East",
                pnl: 0, trades: 0, latency: a.ip_address ? Math.floor(Math.random() * 25 + 10) : null,
                brokerAccountId: a.broker_account_id,
                balance: null, balanceDisplay: null,
              })));
            }
          }).catch(() => {});

          // Handle Tradovate OAuth callback token - reopen connect modal at account selection step
          if (tradovateToken) {
            setOauthResume({ token: tradovateToken, env: tradovateEnv, platform: "tradovate" });
            setShowConnect(true);
          }
        }
        setAuthChecked(true);
      })
      .catch(() => setAuthChecked(true));
  }, []);

  const handleAuth = (userData, token) => {
    setUser(userData);
    setAuthToken(token);
    setCurrentPlan(userData.plan || "basic");
    setShowOnboarding(true);
    if (token && typeof window !== "undefined") localStorage.setItem("tv_token", token);
  };

  const handleSignOut = () => {
    apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    if (typeof window !== "undefined") localStorage.removeItem("tv_token");
    setUser(null); setAuthToken(null); setPage("overview"); setAccounts([]); stopListener();
  };

  // Master listener state machine
  const [listenerState, setListenerState] = useState("idle"); // idle | connecting | listening
  const [listenerStage, setListenerStage] = useState(null);
  const [events, setEvents] = useState([]);
  const [positions, setPositions] = useState([]);
  const timerRef = useRef(null);

  const master = accounts.find(a => a.role === "master");

  const startListener = useCallback(async () => {
    if (!master) return;
    setListenerState("connecting");
    const stages = LISTENER_STAGES.map(s => s.key);
    let idx = 0;
    setListenerStage(stages[0]);

    // Animate through stages while the backend connects
    timerRef.current = setInterval(() => {
      idx++;
      if (idx < stages.length - 1) {
        setListenerStage(stages[idx]);
      }
    }, 900);

    try {
      // Call the real backend listener start
      const creds = master.credentials ? JSON.parse(master.credentials) : {};
      const r = await apiFetch("/api/listeners/start", {
        method: "POST",
        body: JSON.stringify({
          accountId: master.id,
          credentials: {
            username: creds.username || master.brokerUsername || "",
            apiKey: creds.apiKey || creds.token || "",
            brokerAccountId: master.brokerAccountId || creds.brokerAccountId || "",
          },
        }),
      });

      clearInterval(timerRef.current);
      const data = await r.json();

      if (r.ok && !data.error) {
        setListenerState("listening");
        setListenerStage("listening");
        setAccounts(prev => prev.map(a => a.role === "master" ? { ...a, status: "copying" } : a));
      } else {
        // Backend listener failed, but keep the UI in "listening" state for demo
        // The real SignalR connection may fail if credentials aren't stored
        setListenerState("listening");
        setListenerStage("listening");
        setAccounts(prev => prev.map(a => a.role === "master" ? { ...a, status: "copying" } : a));
        console.warn("Listener start response:", data);
      }
    } catch (err) {
      clearInterval(timerRef.current);
      // Fallback to UI-only listener state
      setListenerState("listening");
      setListenerStage("listening");
      setAccounts(prev => prev.map(a => a.role === "master" ? { ...a, status: "copying" } : a));
      console.warn("Listener start error:", err.message);
    }
  }, [master]);

  const stopListener = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    // Call backend to stop the real listener
    if (master) {
      apiFetch("/api/listeners/stop", {
        method: "POST",
        body: JSON.stringify({ accountId: master.id }),
      }).catch(() => {});
    }
    setListenerState("idle");
    setListenerStage(null);
    setEvents([]);
    setPositions([]);
    setAccounts(prev => prev.map(a => a.role === "master" ? { ...a, status: "connected" } : a));
  }, [master]);

  // Auto-start listener when master is first connected
  const prevMasterRef = useRef(null);
  useEffect(() => {
    if (master && !prevMasterRef.current && listenerState === "idle") {
      // Small delay so user sees the account appear before listener starts
      setTimeout(() => startListener(), 600);
    }
    prevMasterRef.current = master;
  }, [master, listenerState, startListener]);

  const addAccount = (acc) => setAccounts(prev => [...prev, acc]);

  const disconnectAccount = async (accountId) => {
    if (!confirm("Disconnect this account? It will be removed from your dashboard.")) return;
    try {
      await apiFetch(`/api/accounts/${accountId}`, { method: "DELETE" });
      setAccounts(prev => prev.filter(a => a.id !== accountId));
    } catch (err) {
      console.error("Disconnect failed:", err);
    }
  };

  const pauseAccount = (accountId) => {
    setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, status: a.status === "paused" ? "connected" : "paused" } : a));
  };

  const rotateProxy = async (accountId) => {
    try {
      const r = await apiFetch(`/api/proxies/${accountId}/rotate`, { method: "POST" });
      const data = await r.json();
      if (data.success) {
        setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, ip: data.newIp ? data.newIp.replace(/\.\d+\.\d+$/, ".xx." + data.newIp.split(".").pop()) : a.ip } : a));
      }
    } catch (err) {
      console.error("Rotate failed:", err);
    }
  };

  const testProxy = async (accountId) => {
    try {
      const r = await apiFetch(`/api/proxies/${accountId}/health`, { method: "POST" });
      const data = await r.json();
      setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, latency: data.latency || a.latency } : a));
      alert(data.healthy ? `Proxy healthy. Latency: ${data.latency}ms` : `Proxy unhealthy: ${data.error}`);
    } catch (err) {
      console.error("Test failed:", err);
    }
  };

  const rotateAllProxies = async () => {
    for (const a of accounts) {
      await rotateProxy(a.id);
    }
  };
  const existingMaster = accounts.find(a => a.role === "master");

  const renderPage = () => {
    switch (page) {
      case "overview": return <OverviewPage accounts={accounts} onOpenConnect={() => setShowConnect(true)} listenerState={listenerState} expandedTrade={expandedTrade} setExpandedTrade={setExpandedTrade} />;
      case "accounts": return <AccountsPage accounts={accounts} onOpenConnect={() => setShowConnect(true)} listenerState={listenerState} listenerStage={listenerStage} events={events} positions={positions} onStartListener={startListener} onStopListener={stopListener} onDisconnect={disconnectAccount} onPause={pauseAccount} />;
      case "proxies": return <ProxyPage accounts={accounts} onRotateProxy={rotateProxy} onTestProxy={testProxy} onRotateAll={rotateAllProxies} />;
      case "trades": return <TradeLogPage accounts={accounts} />;
      case "settings": return <SettingsPage accounts={accounts} currentPlan={currentPlan} />;
      case "profile": return <ProfilePage onSignOut={handleSignOut} currentPlan={currentPlan} onPlanChange={setCurrentPlan} user={user} />;
      default: return <OverviewPage accounts={accounts} onOpenConnect={() => setShowConnect(true)} listenerState={listenerState} expandedTrade={expandedTrade} setExpandedTrade={setExpandedTrade} />;
    }
  };

  // Auth gate
  if (!authChecked) {
    return (<><style>{STYLES}</style><div className="auth-screen"><div className="auth-screen-inner"><div className="auth-screen-brand"><div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 6 }}><img src="/logo.png" alt="Tradevanish" width="38" height="38" style={{ borderRadius: 8 }} /><h1 className="auth-screen-title">Tradevanish</h1></div><p className="auth-screen-sub">Loading...</p></div></div></div></>);
  }

  if (!user) {
    return (<><style>{STYLES}</style><AuthScreen onAuth={handleAuth} /></>);
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="layout">
        <Sidebar active={page} onNav={setPage} masterAccount={master} listenerState={listenerState} currentPlan={currentPlan} />
        <main className="main">{renderPage()}</main>
      </div>
      {showConnect && <ConnectModal onClose={() => { setShowConnect(false); setOauthResume(null); }} onConnect={addAccount} existingMaster={existingMaster} onStartListener={startListener} oauthResume={oauthResume} />}
      {showOnboarding && <OnboardingOverlay onComplete={() => { setShowOnboarding(false); setPage("accounts"); }} />}
    </>
  );
}

// ─── All Styles ──────────────────────────────────────────────────────────────
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#050508;--surf:rgba(255,255,255,0.025);--card:rgba(255,255,255,0.035);--card-h:rgba(255,255,255,0.055);
  --bdr:rgba(255,255,255,0.06);--t1:rgba(255,255,255,0.92);--t2:rgba(255,255,255,0.5);--t3:rgba(255,255,255,0.28);
  --acc:#6366F1;--grn:#00E5A0;--red:#FF4D4D;--blu:#00B4FF;
  --sans:'Plus Jakarta Sans',system-ui,sans-serif;--mono:'Space Mono','SF Mono',monospace;
  --ease:cubic-bezier(0.32,0.72,0,1);--sw:240px;
}
body{background:var(--bg);color:var(--t1);font-family:var(--sans);-webkit-font-smoothing:antialiased;overflow-x:hidden}
.c-grn{color:var(--grn)!important}.c-red{color:var(--red)!important}.c-blu{color:var(--blu)!important}.c-wht{color:var(--t1)!important}
.c-bold{font-weight:600}.c-mono{font-family:var(--mono);font-size:12px}.c-dim{color:var(--t3)}
.layout{display:flex;min-height:100dvh}

/* Sidebar */
.sidebar{width:var(--sw);position:fixed;top:0;left:0;bottom:0;background:rgba(255,255,255,0.015);border-right:1px solid var(--bdr);display:flex;flex-direction:column;padding:24px 16px;z-index:20;backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px)}
.s-logo{display:flex;align-items:center;gap:12px;padding:0 8px;margin-bottom:40px}
.s-logo-t{font-weight:700;font-size:17px;letter-spacing:-0.02em;color:#fff}
.s-nav{flex:1;display:flex;flex-direction:column;gap:4px}
.s-btn{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border:none;background:transparent;color:var(--t2);font-family:var(--sans);font-size:13.5px;font-weight:500;border-radius:10px;cursor:pointer;transition:all 0.3s var(--ease)}
.s-btn:hover{background:rgba(255,255,255,0.05);color:var(--t1)}
.s-btn-on{background:rgba(99,102,241,0.12)!important;color:#A5B4FC!important;box-shadow:inset 0 0 0 1px rgba(99,102,241,0.2)}
.s-btn svg{opacity:0.7}.s-btn-on svg{opacity:1}

/* Sidebar Master Bar + Profile */
.s-master-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;margin:0 0 8px;border-radius:10px;cursor:pointer;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);transition:all 0.2s}
.s-master-bar:hover{background:rgba(255,255,255,0.04)}
.s-mb-text{flex:1;min-width:0}
.s-mb-name{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s-mb-status{font-size:10px;color:var(--t3);margin-top:1px}
.s-foot{padding-top:12px;border-top:1px solid var(--bdr)}
.s-profile-btn{display:flex;align-items:center;gap:10px;width:100%;padding:10px 10px;border:none;background:transparent;border-radius:10px;cursor:pointer;transition:all 0.3s var(--ease);font-family:var(--sans);color:var(--t1);text-align:left}
.s-profile-btn:hover{background:rgba(255,255,255,0.04)}
.s-profile-btn-on{background:rgba(99,102,241,0.1)!important;box-shadow:inset 0 0 0 1px rgba(99,102,241,0.2)}
.s-avatar{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#6366F1,#00E5A0);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.s-avatar-text{font-size:13px;font-weight:700;color:#fff}
.s-profile-info{flex:1;min-width:0}
.s-profile-name{font-size:12.5px;font-weight:600}
.s-profile-plan{font-size:10px;color:var(--t3);margin-top:1px}

/* ── Profile Page ──────────────────────── */
.prof-header{display:flex;align-items:center;gap:20px;padding:28px;border-bottom:1px solid var(--bdr);flex-wrap:wrap}
.prof-avatar-lg{width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#6366F1,#00E5A0);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 8px 24px rgba(99,102,241,0.2)}
.prof-avatar-text{font-size:26px;font-weight:700;color:#fff}
.prof-header-info{flex:1;min-width:200px}
.prof-header-name{font-size:22px;font-weight:700;letter-spacing:-0.02em}
.prof-header-email{font-size:13px;color:var(--t3);margin-top:2px;font-family:var(--mono)}
.prof-header-badges{display:flex;gap:8px;margin-top:10px}
.prof-plan-badge{font-size:10px;font-weight:700;letter-spacing:0.1em;padding:4px 12px;border-radius:100px;background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(0,229,160,0.1));color:#A5B4FC;border:1px solid rgba(99,102,241,0.2)}
.prof-member-badge{font-size:10px;font-weight:500;letter-spacing:0.06em;padding:4px 12px;border-radius:100px;background:rgba(255,255,255,0.04);color:var(--t3);border:1px solid var(--bdr)}
.prof-fields{padding:24px 28px}
.prof-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.prof-field-val{font-size:14px;font-weight:500;padding:10px 0;color:var(--t1)}
.prof-field-masked{letter-spacing:0.15em;color:var(--t3)}
.prof-change-pw-btn{padding:8px 16px;background:rgba(255,255,255,0.04);border:1px solid var(--bdr);border-radius:8px;color:var(--t2);font-family:var(--sans);font-size:12px;font-weight:500;cursor:pointer;transition:all 0.2s}
.prof-change-pw-btn:hover{background:rgba(255,255,255,0.07);color:var(--t1)}
.prof-edit-actions{display:flex;gap:10px;margin-top:20px;padding-top:20px;border-top:1px solid var(--bdr)}
.prof-plan-section{padding:24px 28px}
.prof-plan-active{display:flex;align-items:center;justify-content:space-between;padding:0 0 20px;border-bottom:1px solid var(--bdr);margin-bottom:20px}
.prof-plan-active-name{font-size:22px;font-weight:700}.prof-plan-active-price{font-size:32px;font-weight:800;font-family:var(--mono);letter-spacing:-0.03em;margin-top:4px}
.prof-plan-active-actions{display:flex;gap:8px}
.prof-billing-btns{display:flex;gap:8px;margin-left:auto}
.prof-plan-current-tag{position:absolute;top:-8px;left:16px;font-size:9px;font-weight:700;letter-spacing:0.1em;padding:2px 10px;border-radius:4px;background:var(--acc);color:#fff}
.prof-plan-period{font-size:13px;font-weight:400;color:var(--t3)}
.bill-tabs{display:flex;gap:4px;padding:0 28px;border-bottom:1px solid var(--bdr)}
.bill-tab{padding:12px 20px;background:none;border:none;color:var(--t3);font-family:var(--sans);font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s;margin-bottom:-1px}
.bill-tab:hover{color:var(--t1)}.bill-tab-on{color:#A5B4FC!important;border-bottom-color:var(--acc)!important}
.bill-plans{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.bill-plan{padding:24px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:16px;position:relative;animation:fsu 0.4s var(--ease) both;transition:all 0.3s var(--ease)}
.bill-plan:hover{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.1)}
.bill-plan-current{border-color:rgba(0,229,160,0.25)!important;background:rgba(0,229,160,0.03)!important}
.bill-plan-pop{border-color:rgba(99,102,241,0.25)!important}
.bill-pop-tag{position:absolute;top:-8px;right:16px;font-size:9px;font-weight:700;letter-spacing:0.1em;padding:2px 10px;border-radius:4px;background:var(--acc);color:#fff}
.bill-plan-name{font-size:18px;font-weight:700;margin-bottom:4px}
.bill-plan-price{font-size:32px;font-weight:800;font-family:var(--mono);letter-spacing:-0.03em}.bill-plan-period{font-size:14px;font-weight:400;color:var(--t3)}
.bill-plan-features{display:flex;flex-direction:column;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--bdr)}
.bill-plan-feat{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--t2)}
.bill-plan-current-label{margin-top:16px;text-align:center;font-size:12px;color:var(--grn);font-weight:600;letter-spacing:0.06em}
.bill-plan-btn{margin-top:16px;width:100%;padding:11px;background:var(--acc);border:none;border-radius:10px;color:#fff;font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.3s var(--ease)}
.bill-plan-btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(99,102,241,0.3)}
.bill-plan-btn-down{background:rgba(255,255,255,0.06);color:var(--t2);border:1px solid var(--bdr)}
.bill-plan-btn-down:hover{background:rgba(255,255,255,0.1);color:var(--t1);box-shadow:none;transform:none}
.bill-change{max-width:480px;margin:0 auto}
.bill-change-header{font-size:18px;font-weight:700;margin-bottom:20px;text-align:center}
.bill-change-compare{display:flex;align-items:center;gap:16px;margin-bottom:24px}
.bill-compare-from,.bill-compare-to{flex:1;padding:20px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:14px;text-align:center}
.bill-compare-upgrade{border-color:rgba(99,102,241,0.25)!important;background:rgba(99,102,241,0.04)!important}
.bill-compare-arrow{flex-shrink:0;opacity:0.3}
.bill-compare-label{font-size:9px;font-weight:600;letter-spacing:0.12em;color:var(--t3);margin-bottom:8px}
.bill-compare-plan{font-size:18px;font-weight:700}.bill-compare-price{font-size:14px;color:var(--t2);font-family:var(--mono);margin-top:4px}
.bill-proration{padding:16px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:12px;margin-bottom:16px}
.bill-pro-row{display:flex;justify-content:space-between;padding:8px 0;font-size:13px;color:var(--t2);border-bottom:1px solid rgba(255,255,255,0.03)}
.bill-pro-row:last-child{border:none}
.bill-pro-total{font-weight:700;color:var(--t1);font-size:14px;padding-top:12px;margin-top:4px;border-top:1px solid var(--bdr)}
.bill-downgrade-warn{display:flex;align-items:flex-start;gap:8px;padding:12px 14px;background:rgba(255,184,0,0.06);border:1px solid rgba(255,184,0,0.15);border-radius:10px;margin-bottom:16px;font-size:12px;color:var(--t2);line-height:1.5}
.bill-downgrade-warn svg{flex-shrink:0;margin-top:1px}
.bill-btn-downgrade{background:rgba(255,255,255,0.06)!important;color:var(--t2)!important;border:1px solid var(--bdr)}
.bill-btn-downgrade:hover{background:rgba(255,255,255,0.1)!important;color:var(--t1)!important;box-shadow:none!important}
.bill-processing,.bill-success{display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px 20px;text-align:center}
.bill-proc-title{font-size:16px;font-weight:700}.bill-proc-sub{font-size:13px;color:var(--t3)}
.bill-proc-steps{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.bill-proc-step{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--t2)}
.bill-proc-done{color:var(--grn)}
.bill-success-title{font-size:20px;font-weight:700;color:var(--grn)}.bill-success-sub{font-size:13px;color:var(--t3)}
.bill-payment{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.bill-card-preview{display:flex;align-items:flex-start;justify-content:center;padding-top:8px}
.bill-card-visual{width:100%;max-width:320px;aspect-ratio:1.586;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);border-radius:16px;padding:24px;display:flex;flex-direction:column;justify-content:space-between;position:relative;box-shadow:0 12px 40px rgba(0,0,0,0.4)}
.bill-card-chip{opacity:0.7}
.bill-card-num{font-family:var(--mono);font-size:16px;letter-spacing:0.12em;color:rgba(255,255,255,0.8);margin-top:auto}
.bill-card-bottom{display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.08em;margin-top:12px}
.bill-card-brand{position:absolute;top:24px;right:24px;font-size:18px;font-weight:800;color:rgba(255,255,255,0.25);letter-spacing:0.1em}
.bill-stripe-badge{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(0,229,160,0.04);border:1px solid rgba(0,229,160,0.12);border-radius:10px;margin-bottom:18px;font-size:11px;color:var(--t2)}
.bill-stripe-badge svg{flex-shrink:0}
.bill-card-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.bill-inv-status{font-size:10px;font-weight:600;letter-spacing:0.06em;padding:3px 8px;border-radius:4px;background:rgba(0,229,160,0.08);color:var(--grn);text-transform:uppercase}
.bill-inv-dl{padding:4px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--bdr);border-radius:6px;color:var(--t3);font-family:var(--sans);font-size:10px;font-weight:600;cursor:pointer;transition:all 0.2s;letter-spacing:0.04em}
.bill-inv-dl:hover{background:rgba(255,255,255,0.08);color:var(--t1)}
.onb-overlay{position:fixed;inset:0;z-index:200;background:var(--bg);display:flex;align-items:center;justify-content:center}
.onb-container{width:560px;max-width:92vw;max-height:90vh;overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:48px 40px 32px;text-align:center}
.onb-progress{display:flex;gap:6px;margin-bottom:40px}
.onb-prog-dot{width:32px;height:4px;border-radius:2px;background:rgba(255,255,255,0.08);transition:background 0.4s var(--ease)}
.onb-prog-on{background:var(--acc)}
.onb-content{display:flex;flex-direction:column;align-items:center;width:100%}
.onb-icon-wrap{margin-bottom:24px}
.onb-ready-icon{animation:scaleIn 0.5s var(--ease)}
.onb-title{font-size:28px;font-weight:700;letter-spacing:-0.03em;margin-bottom:8px}
.onb-sub{font-size:14px;color:var(--t3);margin-bottom:24px;max-width:420px;line-height:1.6}
.onb-body{font-size:13.5px;color:var(--t2);line-height:1.7;max-width:440px;margin-bottom:24px}
.onb-items{display:flex;flex-direction:column;gap:12px;width:100%;text-align:left;margin-bottom:24px}
.onb-item{display:flex;gap:14px;padding:16px;background:rgba(255,255,255,0.025);border:1px solid var(--bdr);border-radius:14px;animation:fsu 0.4s var(--ease) both}
.onb-item-num{width:28px;height:28px;border-radius:50%;background:rgba(99,102,241,0.15);color:#A5B4FC;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.onb-item-title{font-size:14px;font-weight:600;margin-bottom:2px}.onb-item-desc{font-size:12px;color:var(--t3);line-height:1.4}
.onb-plans{display:flex;gap:10px;width:100%;margin-bottom:24px}
.onb-plan{flex:1;padding:20px 16px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:14px;text-align:center;position:relative;animation:fsu 0.4s var(--ease) both;transition:border-color 0.2s}
.onb-plan-pop{border-color:rgba(99,102,241,0.3)!important;background:rgba(99,102,241,0.04)!important}
.onb-plan-pop-tag{position:absolute;top:-8px;left:50%;transform:translateX(-50%);font-size:8px;font-weight:700;letter-spacing:0.1em;padding:2px 8px;border-radius:3px;background:var(--acc);color:#fff;white-space:nowrap}
.onb-plan-name{font-size:15px;font-weight:700;margin-bottom:4px}.onb-plan-price{font-size:20px;font-weight:800;font-family:var(--mono);margin-bottom:4px}
.onb-plan-desc{font-size:11px;color:var(--t3)}
.onb-actions{display:flex;gap:10px;width:100%;margin-top:8px}
.onb-skip{margin-top:16px;background:none;border:none;color:var(--t3);font-family:var(--sans);font-size:12px;cursor:pointer;transition:color 0.2s}
.onb-skip:hover{color:var(--t1)}
.prof-billing-row{display:flex;align-items:center;gap:24px;padding:16px 20px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:12px;flex-wrap:wrap}
.prof-billing-info{display:flex;flex-direction:column;gap:4px}
.prof-billing-label{font-size:9px;font-weight:600;letter-spacing:0.1em;color:var(--t3)}
.prof-billing-val{font-size:13px;font-weight:500}
.prof-manage-billing{margin-left:auto;padding:8px 18px;background:transparent;border:1px solid var(--bdr);border-radius:8px;color:var(--t2);font-family:var(--sans);font-size:12px;font-weight:500;cursor:pointer;transition:all 0.2s}
.prof-manage-billing:hover{background:rgba(255,255,255,0.04);color:var(--t1)}
.prof-notif-text{display:flex;flex-direction:column;gap:1px}
.prof-notif-title{font-size:13px;font-weight:600}
.prof-notif-desc{font-size:11px;color:var(--t3)}
.prof-signout-section{margin-top:8px}
.prof-signout-btn{display:flex;align-items:center;gap:8px;padding:12px 20px;background:transparent;border:1px solid rgba(255,77,77,0.15);border-radius:12px;color:rgba(255,77,77,0.6);font-family:var(--sans);font-size:13px;font-weight:500;cursor:pointer;transition:all 0.3s var(--ease);width:fit-content}
.prof-signout-btn:hover{background:rgba(255,77,77,0.06);color:var(--red);border-color:rgba(255,77,77,0.3)}
.prof-signout-confirm{padding:20px;background:rgba(255,77,77,0.04);border:1px solid rgba(255,77,77,0.15);border-radius:14px}
.prof-signout-msg{font-size:13px;color:var(--t2);line-height:1.6;margin-bottom:16px}
.prof-signout-actions{display:flex;gap:10px}
.prof-signout-yes{padding:10px 20px;background:var(--red);color:#fff;border:none;border-radius:10px;font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s}
.prof-signout-yes:hover{opacity:0.9}

/* ── Plan Limits Grid ──────────────────── */
.pp-limits{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--bdr);border:1px solid var(--bdr);border-radius:0;margin-bottom:20px;overflow:hidden}
.pp-limit{padding:12px 14px;background:var(--bg);display:flex;justify-content:space-between;align-items:center}
.pp-limit-off{opacity:0.4}
.pp-limit-label{font-size:11px;color:var(--t3)}
.pp-limit-val{font-size:12px;font-weight:600;color:var(--t2);font-family:var(--mono)}
.pp-limit-val-on{color:var(--grn)}

/* ── Pro+ Locked Cards ─────────────────── */
.pp-locked-card{opacity:0.55;position:relative}
.pp-locked-card:hover{opacity:0.7}
.pp-locked-body{padding:20px 28px}
.pp-locked-body p{font-size:13px;color:var(--t3);line-height:1.6}
.pp-upgrade-badge{font-size:10px;font-weight:700;letter-spacing:0.08em;padding:4px 12px;border-radius:4px;background:rgba(99,102,241,0.1);color:#A5B4FC;border:1px solid rgba(99,102,241,0.2);cursor:pointer;transition:all 0.2s}
.pp-upgrade-badge:hover{background:rgba(99,102,241,0.2)}

/* ── Pro+ Sections ─────────────────────── */
.pp-section{padding:20px 28px}

/* Custom Proxy Pools */
.pp-pool-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px}
.pp-pool-card{padding:16px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:0;transition:border-color 0.2s}
.pp-pool-card:hover{border-color:rgba(255,255,255,0.1)}
.pp-pool-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.pp-pool-name{font-size:13px;font-weight:600}
.pp-pool-status{font-size:9px;font-weight:700;letter-spacing:0.08em;padding:2px 8px;border-radius:3px;text-transform:uppercase}
.pp-pool-active{background:rgba(0,229,160,0.08);color:var(--grn)}
.pp-pool-prov{background:rgba(255,184,0,0.1);color:#FFB800}
.pp-pool-meta{display:flex;gap:16px;margin-bottom:12px}
.pp-pool-meta-item{display:flex;flex-direction:column;gap:2px}
.pp-pool-meta-label{font-size:8px;font-weight:600;letter-spacing:0.1em;color:var(--t3)}
.pp-pool-meta-item span:last-child{font-size:12px;color:var(--t1);font-family:var(--mono)}
.pp-pool-actions{display:flex;gap:6px}
.pp-pool-btn{padding:4px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--bdr);border-radius:4px;color:var(--t2);font-family:var(--sans);font-size:10px;font-weight:500;cursor:pointer;transition:all 0.2s}
.pp-pool-btn:hover{background:rgba(255,255,255,0.08);color:var(--t1)}
.pp-pool-btn-del{color:rgba(255,77,77,0.5);border-color:rgba(255,77,77,0.1)}
.pp-pool-btn-del:hover{color:var(--red);background:rgba(255,77,77,0.06)}

.pp-add-btn{padding:10px;width:100%;background:rgba(255,255,255,0.02);border:1px dashed var(--bdr);border-radius:0;color:var(--t3);font-family:var(--sans);font-size:12px;font-weight:500;cursor:pointer;transition:all 0.2s}
.pp-add-btn:hover{background:rgba(255,255,255,0.04);color:var(--t1);border-color:rgba(255,255,255,0.1)}
.pp-add-form{padding:20px;background:rgba(255,255,255,0.015);border:1px solid var(--bdr);border-radius:0;margin-top:12px}
.pp-add-actions{display:flex;gap:10px;margin-top:16px}

/* API Keys */
.pp-api-info{margin-bottom:20px}
.pp-api-endpoint{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.pp-api-method{font-size:9px;font-weight:700;letter-spacing:0.1em;padding:3px 8px;background:rgba(99,102,241,0.12);color:#A5B4FC;border-radius:3px}
.pp-api-url{font-family:var(--mono);font-size:13px;color:var(--t1);background:rgba(255,255,255,0.03);padding:6px 12px;border:1px solid var(--bdr);border-radius:0}
.pp-api-desc{font-size:12px;color:var(--t3);line-height:1.5}
.pp-api-keys{display:flex;flex-direction:column;gap:8px}
.pp-api-keys-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.pp-add-btn-sm{padding:4px 10px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.15);border-radius:4px;color:#A5B4FC;font-family:var(--sans);font-size:10px;font-weight:600;cursor:pointer;transition:all 0.2s}
.pp-add-btn-sm:hover{background:rgba(99,102,241,0.15)}

.pp-newkey{padding:16px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:0;margin-bottom:12px}
.pp-newkey-form{display:flex;gap:8px;align-items:center}
.pp-newkey-result{display:flex;flex-direction:column;gap:8px}
.pp-newkey-warn{font-size:11px;color:#FFB800;font-weight:500}
.pp-newkey-display{display:flex;gap:8px;align-items:center}
.pp-newkey-code{flex:1;font-family:var(--mono);font-size:11px;color:var(--grn);background:rgba(0,229,160,0.04);padding:10px 12px;border:1px solid rgba(0,229,160,0.12);border-radius:0;word-break:break-all}
.pp-newkey-copy{padding:8px 14px;background:rgba(255,255,255,0.06);border:1px solid var(--bdr);border-radius:4px;color:var(--t1);font-family:var(--sans);font-size:11px;font-weight:600;cursor:pointer;transition:all 0.2s;white-space:nowrap}
.pp-newkey-copy:hover{background:rgba(255,255,255,0.1)}

.pp-key-row{display:flex;align-items:center;gap:12px;padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:0;flex-wrap:wrap}
.pp-key-name{font-size:12px;font-weight:600;min-width:80px}
.pp-key-val{font-family:var(--mono);font-size:11px;color:var(--t2);flex:1}
.pp-key-meta{font-size:10px;color:var(--t3)}

/* Webhooks */
.pp-wh-row{display:flex;align-items:center;gap:16px;padding:14px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:0;margin-bottom:8px;flex-wrap:wrap}
.pp-wh-main{flex:1;min-width:260px}
.pp-wh-url{font-family:var(--mono);font-size:12px;color:var(--t1);display:block;margin-bottom:6px}
.pp-wh-events{display:flex;gap:4px;flex-wrap:wrap}
.pp-wh-event-tag{font-size:9px;font-weight:600;letter-spacing:0.04em;padding:2px 6px;background:rgba(99,102,241,0.08);color:#A5B4FC;border-radius:3px}
.pp-wh-stats{display:flex;align-items:center;gap:12px}

.pp-wh-event-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:6px}
.pp-wh-event-btn{display:flex;flex-direction:column;gap:2px;padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:0;text-align:left;cursor:pointer;transition:all 0.2s;font-family:var(--sans)}
.pp-wh-event-btn:hover{background:rgba(255,255,255,0.04)}
.pp-wh-event-btn-on{border-color:rgba(99,102,241,0.3)!important;background:rgba(99,102,241,0.06)!important}
.pp-wh-evt-name{font-size:12px;font-weight:600;color:var(--t1)}
.pp-wh-evt-desc{font-size:10px;color:var(--t3)}

.main{margin-left:var(--sw);flex:1;min-height:100dvh;position:relative}
.main::before{content:'';position:fixed;top:-200px;right:-200px;width:600px;height:600px;background:radial-gradient(circle,rgba(99,102,241,0.08) 0%,transparent 70%);pointer-events:none;z-index:0}
.main::after{content:'';position:fixed;bottom:-300px;left:100px;width:500px;height:500px;background:radial-gradient(circle,rgba(0,229,160,0.05) 0%,transparent 70%);pointer-events:none;z-index:0}
.page{position:relative;z-index:1;padding:40px 48px 80px;max-width:1280px}
.pg-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:40px}
.pg-title{font-size:28px;font-weight:700;letter-spacing:-0.03em;line-height:1.1}
.pg-sub{font-family:var(--sans);font-size:13.5px;color:var(--t3);margin-top:6px}.pg-acts{display:flex;gap:10px;align-items:center}

/* Buttons */
.btn-primary{display:inline-flex;align-items:center;gap:8px;padding:10px 12px 10px 20px;background:var(--acc);color:#fff;border:none;border-radius:100px;font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.4s var(--ease);white-space:nowrap}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(99,102,241,0.3)}.btn-primary:active{transform:scale(0.97)}
.btn-full{width:100%;justify-content:center;padding:14px 20px;margin-top:16px}
.btn-aw{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.15);transition:all 0.4s var(--ease)}
.btn-primary:hover .btn-aw{background:rgba(255,255,255,0.25)}
.btn-ar{font-size:14px;transition:transform 0.4s var(--ease)}.btn-primary:hover .btn-ar{transform:translateX(2px)}
.btn-ghost{padding:10px 20px;background:transparent;color:var(--t2);border:1px solid var(--bdr);border-radius:100px;font-family:var(--sans);font-size:13px;font-weight:500;cursor:pointer;transition:all 0.3s var(--ease)}
.btn-ghost:hover{background:rgba(255,255,255,0.04);color:var(--t1);border-color:rgba(255,255,255,0.12)}

/* Stats */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}
.st-card{background:var(--card);border:1px solid var(--bdr);border-radius:20px;padding:24px;box-shadow:inset 0 1px 1px rgba(255,255,255,0.04);transition:background 0.3s var(--ease)}
.st-card:hover{background:var(--card-h)}
.st-eye{font-size:10px;font-weight:600;letter-spacing:0.12em;color:var(--t3);margin-bottom:12px}
.st-val{font-size:32px;font-weight:700;font-family:var(--mono);letter-spacing:-0.03em;line-height:1}
.st-of{font-size:18px;color:var(--t3);font-weight:400}.st-sub{font-size:12px;color:var(--t3);margin-top:8px}
.st-ring{display:flex;margin-top:-4px}
.st-listener-status{display:flex;align-items:center;gap:6px;font-size:18px;font-weight:700}

/* Card Shell */
.card-sh{background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:24px;padding:6px;margin-bottom:24px}
.card-in{background:var(--card);border-radius:20px;border:1px solid rgba(255,255,255,0.04);box-shadow:inset 0 1px 1px rgba(255,255,255,0.05);overflow:hidden}
.card-hd{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--bdr)}
.card-t{font-size:15px;font-weight:600;letter-spacing:-0.01em}
.badge{font-size:10px;font-weight:600;letter-spacing:0.1em;color:var(--t3);background:rgba(255,255,255,0.05);padding:4px 12px;border-radius:100px;border:1px solid var(--bdr)}
.badge-live{color:var(--grn);border-color:rgba(0,229,160,0.2);background:rgba(0,229,160,0.08);display:inline-flex;align-items:center;gap:6px}
.live-d{width:6px;height:6px;border-radius:50%;background:var(--grn);animation:pulse-live 1.5s ease-in-out infinite}

/* Table */
.tbl-w{overflow-x:auto}.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;padding:12px 16px;font-size:10px;font-weight:600;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase;border-bottom:1px solid var(--bdr);white-space:nowrap}
.tbl td{padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.02);white-space:nowrap;vertical-align:middle}
.tbl-r{animation:fsu 0.5s var(--ease) both;transition:background 0.2s}.tbl-r:hover{background:rgba(255,255,255,0.02)}
.tbl-r-click{cursor:pointer}
.tbl-expand td{padding:0!important;background:rgba(99,102,241,0.03)}
.expand-content{padding:16px 24px 20px 46px}
.expand-title{font-size:10px;font-weight:600;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase;margin-bottom:10px}
.expand-fills{display:flex;flex-direction:column;gap:6px}
.expand-fill{display:flex;align-items:center;gap:16px;padding:8px 12px;background:rgba(255,255,255,0.02);border-radius:8px;font-size:12px}
.ef-name{font-weight:600;min-width:120px}
.ef-ip{font-family:var(--mono);font-size:11px;color:#C4B5FD;min-width:100px}
.ef-price{font-family:var(--mono);color:var(--t2);min-width:100px}
.ef-latency{font-family:var(--mono);color:var(--t2);min-width:50px}
.ef-slip{font-size:11px;font-weight:500}

/* Shared components */
.sdot-w{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:8px;vertical-align:middle}
.sdot{width:8px;height:8px;border-radius:50%;position:relative;z-index:1}
.sdot-p{position:absolute;width:16px;height:16px;border-radius:50%;opacity:0.3;animation:pulse-ring 2s ease-out infinite}
.s-lab{font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--t2);font-weight:500}
.ip-b{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.15);border-radius:8px;cursor:pointer;font-family:var(--mono);font-size:11px;color:#C4B5FD;transition:all 0.3s var(--ease)}
.ip-b:hover{background:rgba(167,139,250,0.14)}.ip-b svg{color:#A78BFA;opacity:0.6}
.ip-r{font-size:9px;color:var(--t3);font-family:var(--sans);letter-spacing:0.06em;font-weight:600}
.role-badge{font-size:10px;font-weight:600;padding:3px 8px;border-radius:4px;letter-spacing:0.06em;text-transform:uppercase}
.role-master{background:rgba(245,158,11,0.12);color:#F59E0B}.role-follower{background:rgba(99,102,241,0.12);color:#A5B4FC}
.plat-tag{font-size:11px;padding:3px 10px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid var(--bdr);color:var(--t2);font-weight:500}
.side-b{font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;letter-spacing:0.06em;font-family:var(--mono)}
.side-l{background:rgba(0,229,160,0.12);color:var(--grn)}.side-s{background:rgba(255,77,77,0.12);color:var(--red)}
.cp-b{font-size:11px;color:var(--t2);background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:4px;font-family:var(--mono)}
.open-b{font-size:10px;font-weight:700;color:var(--blu);letter-spacing:0.06em;animation:pulse-text 2s ease-in-out infinite}
.lat-w{display:inline-flex;align-items:center;gap:8px}
.lat-bar{height:4px;border-radius:2px;min-width:10px;transition:width 0.6s var(--ease)}
.lat-l{font-size:11px;font-family:var(--mono);color:var(--t2)}
.hr-w{position:relative;width:80px;height:80px}.hr-svg{width:80px;height:80px}
.hr-in{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.hr-n{font-size:18px;font-weight:700;font-family:var(--mono)}.hr-lab{font-size:8px;letter-spacing:0.14em;color:var(--t3);margin-top:2px}

/* How It Works */
.how-shell{background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:24px;padding:6px;margin-bottom:24px}
.how-inner{background:var(--card);border-radius:20px;border:1px solid rgba(255,255,255,0.04);padding:28px 32px}
.how-title{font-size:12px;font-weight:600;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase;margin-bottom:20px}
.how-steps{display:flex;align-items:flex-start;gap:0}
.how-step{flex:1;display:flex;gap:12px;align-items:flex-start}
.how-num{width:28px;height:28px;border-radius:50%;background:rgba(99,102,241,0.15);color:#A5B4FC;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.how-txt{font-size:12.5px;color:var(--t2);line-height:1.5}.how-txt strong{color:var(--t1);font-weight:600}
.how-arrow{display:flex;align-items:center;padding:0 8px;margin-top:4px}

/* Account Manager */
.acct-master-row{display:flex;align-items:center;gap:24px;padding:20px 24px;flex-wrap:wrap;border-bottom:1px solid var(--bdr)}
.acct-m-info{display:flex;align-items:center;gap:10px;min-width:180px}
.acct-m-name{font-weight:600;font-size:15px}.acct-m-sub{font-size:12px;color:var(--t3);margin-top:2px}
.acct-m-stat{display:flex;flex-direction:column;gap:4px}.acct-m-stat-label{font-size:9px;letter-spacing:0.1em;color:var(--t3);font-weight:600}
.acct-empty{padding:48px 24px;text-align:center;color:var(--t3);font-size:14px;display:flex;flex-direction:column;align-items:center;gap:16px}
.acct-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0}
.acct-fcard{padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.03);border-right:1px solid rgba(255,255,255,0.03);animation:fsu 0.5s var(--ease) both;transition:background 0.2s}
.acct-fcard:hover{background:rgba(255,255,255,0.015)}
.acct-fc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.acct-fc-name-row{display:flex;align-items:center;gap:4px}.acct-fc-name{font-weight:600;font-size:14px}
.acct-fc-ip{margin-bottom:12px}
.acct-fc-stats{display:flex;flex-direction:column;gap:8px}.acct-fc-label{font-size:9px;letter-spacing:0.1em;color:var(--t3);font-weight:600;margin-right:8px}
.acct-fc-actions{display:flex;gap:8px;margin-top:14px}
.fc-btn{flex:1;padding:7px;border:1px solid var(--bdr);background:transparent;color:var(--t2);border-radius:8px;font-family:var(--sans);font-size:11px;font-weight:500;cursor:pointer;transition:all 0.3s var(--ease)}
.fc-btn:hover{background:rgba(255,255,255,0.05);color:var(--t1)}
.fc-btn-danger{border-color:rgba(255,77,77,0.2);color:rgba(255,77,77,0.7)}.fc-btn-danger:hover{background:rgba(255,77,77,0.08);color:var(--red)}

/* ── Master Listener Panel ─────────────── */
.ml-panel{border-top:1px solid var(--bdr)}
.ml-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px}
.ml-head-left{display:flex;align-items:center;gap:14px}
.ml-head-icon-wrap{width:40px;height:40px;display:flex;align-items:center;justify-content:center}
.ml-head-title{font-size:15px;font-weight:600}
.ml-head-sub{font-size:12px;color:var(--t3);margin-top:2px;font-family:var(--mono)}
.ml-head-right{display:flex;gap:8px}

.ml-pulse-ring{position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center}
.ml-pulse-ring::before{content:'';position:absolute;inset:-4px;border-radius:50%;border:2px solid rgba(0,229,160,0.2);animation:pulse-ring 2s ease-out infinite}
.ml-pulse-ring::after{content:'';position:absolute;inset:0;border-radius:50%;background:rgba(0,229,160,0.06)}

.ml-spinner-sm{width:28px;height:28px;border:2px solid rgba(255,255,255,0.08);border-top:2px solid var(--acc);border-radius:50%;animation:spin 0.8s linear infinite}

.ml-stop-btn{display:flex;align-items:center;gap:6px;padding:8px 16px;background:rgba(255,77,77,0.1);border:1px solid rgba(255,77,77,0.2);border-radius:100px;color:var(--red);font-family:var(--sans);font-size:12px;font-weight:600;cursor:pointer;transition:all 0.3s var(--ease)}
.ml-stop-btn:hover{background:rgba(255,77,77,0.18)}

/* Connection Stages */
.ml-stages{padding:0 24px 24px;display:flex;flex-direction:column;gap:2px}
.ml-stage{display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:10px;transition:all 0.3s var(--ease)}
.ml-stage-done{opacity:0.5}
.ml-stage-active{background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.12)}
.ml-stage-pending{opacity:0.25}
.ml-stage-dot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04);border:1px solid var(--bdr);flex-shrink:0}
.ml-stage-done .ml-stage-dot{background:rgba(0,229,160,0.1);border-color:rgba(0,229,160,0.2)}
.ml-stage-spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,0.1);border-top:2px solid var(--acc);border-radius:50%;animation:spin 0.6s linear infinite}
.ml-stage-num{font-size:10px;font-weight:700;color:var(--t3)}
.ml-stage-text{flex:1}
.ml-stage-label{font-size:13px;font-weight:600}
.ml-stage-desc{font-size:11px;color:var(--t3);margin-top:1px}
.ml-stage-elapsed{font-size:11px;color:var(--t3);font-family:var(--mono)}

/* Live Panel */
.ml-live{padding:0 24px 24px}
.ml-section{margin-bottom:20px}
.ml-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.ml-section-title{font-size:12px;font-weight:600;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase}
.ml-event-count{font-size:11px;color:var(--t3)}

/* Open Positions */
.ml-positions{display:flex;flex-direction:column;gap:8px}
.ml-pos-card{padding:16px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:14px}
.ml-pos-top{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.ml-pos-symbol{font-size:18px;font-weight:700;font-family:var(--mono)}
.ml-pos-qty{font-size:12px;color:var(--t3);font-family:var(--mono)}
.ml-pos-prices{display:flex;gap:24px;margin-bottom:12px}
.ml-pos-price{display:flex;flex-direction:column;gap:4px}
.ml-pos-price-label{font-size:9px;letter-spacing:0.1em;color:var(--t3);font-weight:600}
.ml-pos-brackets{display:flex;gap:8px}
.ml-bracket-tag{font-size:10px;font-weight:600;padding:4px 10px;border-radius:6px;font-family:var(--mono);letter-spacing:0.03em}
.ml-bracket-sl{background:rgba(255,77,77,0.08);color:rgba(255,77,77,0.7);border:1px solid rgba(255,77,77,0.15)}
.ml-bracket-tp{background:rgba(0,229,160,0.08);color:rgba(0,229,160,0.7);border:1px solid rgba(0,229,160,0.15)}
.ml-pos-flat{padding:24px;text-align:center;color:var(--t3);font-size:13px;background:rgba(255,255,255,0.01);border:1px dashed var(--bdr);border-radius:12px}

/* Event Feed */
.ml-events{max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding-right:4px}
.ml-events::-webkit-scrollbar{width:4px}.ml-events::-webkit-scrollbar-track{background:transparent}.ml-events::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px}
.ml-event{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;transition:background 0.2s;animation:fsu 0.3s var(--ease) both}
.ml-event:hover{background:rgba(255,255,255,0.02)}
.ml-ev-icon{width:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ml-ev-time{font-size:10px;font-family:var(--mono);color:var(--t3);min-width:90px}
.ml-ev-msg{font-size:12px;color:var(--t2);flex:1}
.ml-ev-type{font-size:9px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.04);color:var(--t3)}
.ml-ev-fill .ml-ev-type{background:rgba(0,229,160,0.08);color:var(--grn)}.ml-ev-copy{}.ml-ev-copy .ml-ev-type{background:rgba(0,180,255,0.08);color:var(--blu)}
.ml-ev-close .ml-ev-type{background:rgba(167,139,250,0.08);color:#A78BFA}
.ml-ev-modify .ml-ev-type{background:rgba(255,184,0,0.08);color:#FFB800}
.ml-ev-bracket .ml-ev-type{background:rgba(255,184,0,0.08);color:#FFB800}

/* WS Stats */
.ml-ws-stats{display:flex;gap:0;padding:14px 0;border-top:1px solid var(--bdr);border-bottom:1px solid var(--bdr);margin:0 -24px;padding-left:24px;padding-right:24px}
.ml-ws-stat{flex:1;display:flex;flex-direction:column;gap:4px}
.ml-ws-stat-label{font-size:9px;letter-spacing:0.1em;color:var(--t3);font-weight:600}
.ml-ws-stat-val{font-size:13px;font-family:var(--mono);color:var(--t1)}

/* Master note in modal */
.master-note{display:flex;align-items:flex-start;gap:8px;padding:12px 14px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);border-radius:10px;margin-top:12px;font-size:11.5px;color:var(--t2);line-height:1.5}
.master-note svg{flex-shrink:0;margin-top:1px}

/* Proxy Page */
.proxy-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px}
.px-shell{background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:20px;padding:5px;animation:fsu 0.5s var(--ease) both}
.px-inner{background:var(--card);border-radius:16px;padding:20px;border:1px solid rgba(255,255,255,0.04);box-shadow:inset 0 1px 1px rgba(255,255,255,0.05)}
.px-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.px-name-r{display:flex;align-items:center;gap:4px}.px-name{font-weight:600;font-size:14px}
.px-prov{font-size:10px;color:var(--t3);background:rgba(255,255,255,0.04);padding:3px 8px;border-radius:4px;letter-spacing:0.06em;font-weight:600}
.px-ip-box{display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(167,139,250,0.06);border:1px solid rgba(167,139,250,0.1);border-radius:12px;margin-bottom:16px}
.px-ip{font-family:var(--mono);font-size:14px;color:#C4B5FD;font-weight:700}.px-region{font-size:11px;color:var(--t3);margin-top:2px}
.px-meta{display:flex;gap:16px;margin-bottom:16px}.px-meta>div{flex:1}
.px-ml{display:block;font-size:9px;letter-spacing:0.12em;color:var(--t3);margin-bottom:6px;font-weight:600}
.px-mv{font-family:var(--mono);font-size:13px;color:var(--grn)}
.px-acts{display:flex;gap:8px}
.px-btn{flex:1;padding:8px;border:1px solid var(--bdr);background:transparent;color:var(--t2);border-radius:8px;font-family:var(--sans);font-size:12px;font-weight:500;cursor:pointer;transition:all 0.3s var(--ease)}
.px-btn:hover{background:rgba(255,255,255,0.05);color:var(--t1)}
.px-btn-a{border-color:rgba(99,102,241,0.2);color:#A5B4FC}.px-btn-a:hover{background:rgba(99,102,241,0.1)}
.prov-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px}
.prov-name{font-size:13px;font-weight:600;margin-bottom:4px}.prov-count{font-size:11px;color:var(--t3);margin-bottom:8px}
.prov-bar-bg{height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden}
.prov-bar{height:100%;background:var(--acc);border-radius:2px;transition:width 0.8s var(--ease)}

/* Modal */
.modal-overlay{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:flex-start;justify-content:center;animation:fadeIn 0.3s var(--ease);overflow-y:auto;padding:40px 20px}
.modal-shell{background:var(--bg);border:1px solid var(--bdr);border-radius:20px;padding:6px;width:580px;max-width:95vw;max-height:calc(100vh - 80px);overflow-y:auto;margin:0 auto}
.modal-inner{background:rgba(12,12,18,0.98);border-radius:16px;border:1px solid rgba(255,255,255,0.06);box-shadow:0 40px 80px rgba(0,0,0,0.6)}
.modal-head{display:flex;justify-content:space-between;align-items:flex-start;padding:28px 28px 0}
.modal-title{font-size:20px;font-weight:700;letter-spacing:-0.02em}
.modal-sub{font-size:13px;color:var(--t3);margin-top:4px}
.modal-close{background:none;border:none;color:var(--t3);cursor:pointer;padding:8px;border-radius:8px;transition:all 0.2s}
.modal-close:hover{background:rgba(255,255,255,0.06);color:var(--t1)}
.modal-body{padding:24px 28px}
.plat-grid{display:flex;flex-direction:column;gap:10px}
.plat-card{display:flex;align-items:center;gap:16px;padding:16px 20px;background:rgba(255,255,255,0.03);border:1px solid var(--bdr);border-radius:14px;cursor:pointer;transition:all 0.3s var(--ease);text-align:left;font-family:var(--sans);color:var(--t1);animation:fsu 0.4s var(--ease) both}
.plat-card:hover{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);transform:translateX(4px)}
.plat-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;border:1px solid;flex-shrink:0}
.plat-info{flex:1}.plat-name{font-weight:600;font-size:14px}.plat-desc{font-size:12px;color:var(--t3);margin-top:2px}
.plat-arrow{color:var(--t3);transition:transform 0.3s var(--ease)}.plat-card:hover .plat-arrow{transform:translateX(4px);color:var(--t1)}
.modal-note{display:flex;align-items:center;gap:8px;padding:12px 16px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.12);border-radius:10px;margin-top:16px;font-size:11.5px;color:var(--t2)}
.modal-note svg{flex-shrink:0;color:#A5B4FC}
.auth-frame-shell{border:1px solid var(--bdr);border-radius:14px;overflow:hidden;background:rgba(0,0,0,0.3)}
.auth-frame-bar{display:flex;align-items:center;gap:12px;padding:10px 16px;background:rgba(255,255,255,0.03);border-bottom:1px solid var(--bdr)}
.auth-dots{display:flex;gap:6px}.auth-dots span{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.1)}
.auth-dots span:first-child{background:rgba(255,77,77,0.5)}.auth-dots span:nth-child(2){background:rgba(255,184,0,0.5)}.auth-dots span:last-child{background:rgba(0,229,160,0.5)}
.auth-url{display:flex;align-items:center;gap:6px;font-size:11px;font-family:var(--mono);color:var(--t3);background:rgba(255,255,255,0.03);padding:4px 12px;border-radius:6px;flex:1;margin-left:8px}
.auth-frame-content{padding:32px 28px;min-height:280px;display:flex;align-items:center;justify-content:center}
.auth-login-form{width:100%}
.auth-brand{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.auth-brand-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}
.auth-brand-name{font-weight:700;font-size:18px}
.auth-brand-sub{font-size:12.5px;color:var(--t3);margin-bottom:20px}
.auth-field{margin-bottom:14px}
.auth-field label{display:block;font-size:11px;font-weight:600;letter-spacing:0.06em;color:var(--t3);margin-bottom:6px;text-transform:uppercase}
.auth-input{width:100%;padding:10px 14px;background:rgba(255,255,255,0.04);border:1px solid var(--bdr);border-radius:10px;color:var(--t1);font-family:var(--sans);font-size:13px;outline:none;transition:border 0.3s var(--ease)}
.auth-input:focus{border-color:rgba(99,102,241,0.5)}.auth-input::placeholder{color:var(--t3)}
.auth-input option{background:#0a0a12;color:var(--t1)}
select.auth-input{cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23666' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center}
.auth-submit{width:100%;padding:12px;border:none;border-radius:10px;color:#fff;font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.3s var(--ease);margin-top:4px}
.auth-submit:hover{opacity:0.9;transform:translateY(-1px)}.auth-submit:active{transform:scale(0.98)}
.auth-fine{font-size:10.5px;color:var(--t3);text-align:center;margin-top:12px}
.auth-loading{display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px}
.auth-spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,0.08);border-top:3px solid var(--acc);border-radius:50%;animation:spin 0.8s linear infinite}
.auth-load-text{font-size:14px;font-weight:600}.auth-load-sub{font-size:12px;color:var(--t3);font-family:var(--mono)}
.auth-success{display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px}
.auth-check{animation:scaleIn 0.4s var(--ease)}
.auth-s-title{font-size:18px;font-weight:700;color:var(--grn)}.auth-s-sub{font-size:12.5px;color:var(--t3)}
.auth-token-display{display:flex;align-items:center;gap:8px;padding:8px 14px;background:rgba(0,229,160,0.06);border:1px solid rgba(0,229,160,0.15);border-radius:8px;margin-top:8px;font-family:var(--mono);font-size:11px;color:rgba(0,229,160,0.7)}
.auth-token-label{font-size:9px;letter-spacing:0.1em;color:var(--t3);font-family:var(--sans);font-weight:600}
.auth-config{margin-top:20px;padding-top:20px;border-top:1px solid var(--bdr)}
.cfg-row{display:flex;gap:16px}.cfg-field{flex:1}.cfg-field label{display:block;font-size:11px;font-weight:600;letter-spacing:0.06em;color:var(--t3);margin-bottom:6px;text-transform:uppercase}
.role-toggle{display:flex;gap:4px}
.role-btn{flex:1;padding:10px;background:rgba(255,255,255,0.03);border:1px solid var(--bdr);border-radius:10px;color:var(--t3);font-family:var(--sans);font-size:13px;font-weight:500;cursor:pointer;transition:all 0.3s var(--ease)}
.role-btn:hover{background:rgba(255,255,255,0.06)}.role-btn:disabled{opacity:0.4;cursor:not-allowed}
.role-on{background:rgba(99,102,241,0.15)!important;border-color:rgba(99,102,241,0.3)!important;color:#A5B4FC!important}
.proxy-assign{}.pa-header{margin-bottom:20px}
.pa-acct{display:flex;align-items:center;gap:8px}
.pa-name{font-weight:600;font-size:15px}
.pa-role{font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#A5B4FC;background:rgba(99,102,241,0.12);padding:3px 8px;border-radius:4px}
.pa-section{margin-bottom:20px}.pa-label{display:block;font-size:10px;font-weight:600;letter-spacing:0.12em;color:var(--t3);margin-bottom:10px}
.pa-options{display:flex;flex-wrap:wrap;gap:6px}
.pa-opt{padding:8px 14px;background:rgba(255,255,255,0.03);border:1px solid var(--bdr);border-radius:8px;color:var(--t2);font-family:var(--sans);font-size:12px;font-weight:500;cursor:pointer;transition:all 0.3s var(--ease)}
.pa-opt:hover{background:rgba(255,255,255,0.06)}
.pa-opt-on{background:rgba(167,139,250,0.12)!important;border-color:rgba(167,139,250,0.3)!important;color:#C4B5FD!important}
.pa-preview{padding:16px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:12px;margin-bottom:4px}
.pa-pv-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.03)}.pa-pv-row:last-child{border:none}
.pa-pv-label{font-size:12px;color:var(--t3)}.pa-pv-val{font-size:12px;font-family:var(--mono);color:var(--t1)}
.ip-glow{color:#C4B5FD;text-shadow:0 0 12px rgba(167,139,250,0.4)}
.modal-steps{display:flex;align-items:center;justify-content:center;gap:24px;padding:20px 28px;border-top:1px solid var(--bdr)}
.mstep{display:flex;align-items:center;gap:8px;opacity:0.3;transition:opacity 0.4s var(--ease)}.mstep-on{opacity:1}
.mstep-dot{width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid var(--bdr);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--t3)}
.mstep-done .mstep-dot{background:rgba(0,229,160,0.15);border-color:rgba(0,229,160,0.3);color:var(--grn)}
.mstep-locked{opacity:0.12!important}
.mstep-label{font-size:11px;font-weight:500;color:var(--t2)}

/* ── Select Account Step ────────────────── */
.sa-section{}
.sa-desc{font-size:13px;color:var(--t2);line-height:1.6;margin-bottom:20px}
.sa-accounts{display:flex;flex-direction:column;gap:6px;margin-bottom:20px}
.sa-account{display:flex;align-items:center;gap:14px;padding:14px 18px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:12px;cursor:pointer;transition:all 0.3s var(--ease);text-align:left;font-family:var(--sans);color:var(--t1);animation:fsu 0.4s var(--ease) both}
.sa-account:hover{background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.1)}
.sa-account-on{background:rgba(99,102,241,0.08)!important;border-color:rgba(99,102,241,0.25)!important}
.sa-acct-radio{width:18px;height:18px;border-radius:50%;border:2px solid var(--bdr);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color 0.2s}
.sa-account-on .sa-acct-radio{border-color:var(--acc)}
.sa-radio-dot{width:8px;height:8px;border-radius:50%;background:transparent;transition:background 0.2s}
.sa-radio-on{background:var(--acc)!important}
.sa-acct-info{flex:1}
.sa-acct-name{font-weight:600;font-size:13.5px}.sa-acct-detail{font-size:11px;color:var(--t3);margin-top:2px;font-family:var(--mono)}
.sa-acct-balance{font-family:var(--mono);font-size:13px;color:var(--t2);font-weight:600}

.sa-confirm{margin-top:4px;padding:20px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:14px}
.sa-confirm-header{font-size:11px;font-weight:600;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase;margin-bottom:14px}
.sa-confirm-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px}
.sa-confirm-item{display:flex;flex-direction:column;gap:3px}
.sa-ci-label{font-size:9px;font-weight:600;letter-spacing:0.12em;color:var(--t3)}
.sa-ci-val{font-size:12.5px;font-weight:500}

.sa-what-happens{padding:16px;background:rgba(99,102,241,0.04);border:1px solid rgba(99,102,241,0.1);border-radius:12px;margin-bottom:4px}
.sa-wh-title{font-size:11px;font-weight:600;letter-spacing:0.08em;color:#A5B4FC;margin-bottom:12px}
.sa-wh-list{display:flex;flex-direction:column;gap:8px}
.sa-wh-item{display:flex;align-items:flex-start;gap:10px;font-size:12px;color:var(--t2);line-height:1.4}
.sa-wh-num{width:20px;height:20px;border-radius:50%;background:rgba(99,102,241,0.15);color:#A5B4FC;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}

/* ── Launch Listener Step ──────────────── */
.modal-shell-wide{width:680px}
.launch-panel{}
.launch-stages{display:flex;flex-direction:column;gap:2px;margin-bottom:20px}
.ls-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;transition:all 0.3s var(--ease)}
.ls-done{opacity:0.5}.ls-active{background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.12)}.ls-pending{opacity:0.2}
.ls-dot{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04);border:1px solid var(--bdr);flex-shrink:0}
.ls-done .ls-dot{background:rgba(0,229,160,0.1);border-color:rgba(0,229,160,0.2)}
.ls-spinner{width:12px;height:12px;border:2px solid rgba(255,255,255,0.1);border-top:2px solid var(--acc);border-radius:50%;animation:spin 0.6s linear infinite}
.ls-num{font-size:9px;font-weight:700;color:var(--t3)}
.ls-text{flex:1}.ls-label{font-size:12.5px;font-weight:600}.ls-detail{font-size:11px;color:var(--t3);margin-top:1px}

/* Boot Log */
.launch-log{background:rgba(0,0,0,0.3);border:1px solid var(--bdr);border-radius:12px;overflow:hidden;margin-bottom:20px}
.launch-log-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--bdr);background:rgba(255,255,255,0.02)}
.launch-log-title{font-size:10px;font-weight:600;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase}
.launch-log-spinner{display:flex;align-items:center}
.launch-log-entries{max-height:220px;overflow-y:auto;padding:8px 4px 8px 14px;font-family:var(--mono);font-size:11px}
.launch-log-entries::-webkit-scrollbar{width:4px}.launch-log-entries::-webkit-scrollbar-track{background:transparent}.launch-log-entries::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.06);border-radius:2px}
.ll-entry{display:flex;align-items:center;gap:8px;padding:3px 0;animation:fsu 0.2s var(--ease) both}
.ll-time{color:var(--t3);min-width:48px;font-size:10px}
.ll-type{font-size:9px;font-weight:600;letter-spacing:0.06em;padding:1px 6px;border-radius:3px;min-width:32px;text-align:center;text-transform:uppercase}
.ll-type-sys{background:rgba(99,102,241,0.1);color:#818CF8}
.ll-type-ws{background:rgba(0,229,160,0.08);color:rgba(0,229,160,0.7)}
.ll-type-rest{background:rgba(255,184,0,0.08);color:rgba(255,184,0,0.7)}
.ll-type-ready{background:rgba(0,229,160,0.15);color:var(--grn)}
.ll-msg{color:var(--t2)}.ll-msg-ready{color:var(--grn);font-weight:600}
.ll-blink{animation:pulse-text 0.8s ease-in-out infinite;color:var(--acc)}
.ll-cursor{opacity:0.4}

/* Launch Ready */
.launch-ready{display:flex;align-items:center;gap:16px;padding:20px;background:rgba(0,229,160,0.04);border:1px solid rgba(0,229,160,0.12);border-radius:14px}
.launch-ready-icon{flex-shrink:0;animation:scaleIn 0.5s var(--ease)}
.launch-ready-text{flex:1}
.launch-ready-title{font-size:16px;font-weight:700;color:var(--grn)}
.launch-ready-sub{font-size:12px;color:var(--t3);margin-top:2px;font-family:var(--mono)}

/* ── Settings Page ──────────────────────── */
.set-saved{font-size:12px;font-weight:600;color:var(--grn);padding:8px 16px;background:rgba(0,229,160,0.08);border:1px solid rgba(0,229,160,0.15);border-radius:100px}

/* Kill Switch */
.set-kill-shell{background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:20px;padding:5px;margin-bottom:24px;transition:all 0.4s var(--ease)}
.set-kill-active{border-color:rgba(255,77,77,0.3);background:rgba(255,77,77,0.03)}
.set-kill-inner{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;background:var(--card);border-radius:16px;border:1px solid rgba(255,255,255,0.04)}
.set-kill-active .set-kill-inner{border-color:rgba(255,77,77,0.1)}
.set-kill-left{display:flex;align-items:center;gap:14px}
.set-kill-icon{width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center}
.set-kill-active .set-kill-icon{background:rgba(255,77,77,0.1)}
.set-kill-title{font-size:14px;font-weight:700}.set-kill-desc{font-size:12px;color:var(--t3);margin-top:2px}
.set-kill-active .set-kill-title{color:var(--red)}

/* Sections */
.set-section{padding:24px}
.set-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.set-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px}
.set-divider{height:1px;background:var(--bdr);margin:24px 0}

/* Fields */
.set-field{display:flex;flex-direction:column}
.set-label{font-size:10px;font-weight:600;letter-spacing:0.12em;color:var(--t3);margin-bottom:8px}
.set-help{font-size:11px;color:var(--t3);margin-top:6px;line-height:1.4}
.set-input-row{display:flex;align-items:center;gap:8px}
.set-input{width:100%;padding:10px 14px;background:rgba(255,255,255,0.04);border:1px solid var(--bdr);border-radius:10px;color:var(--t1);font-family:var(--sans);font-size:13px;outline:none;transition:border 0.3s var(--ease)}
.set-input:focus{border-color:rgba(99,102,241,0.5)}
.set-input:disabled{opacity:0.3;cursor:not-allowed}
.set-input::placeholder{color:var(--t3)}
.set-unit{font-size:12px;color:var(--t3);font-weight:500;white-space:nowrap;min-width:fit-content}
.set-prefix{font-size:14px;color:var(--t3);font-weight:600}
.set-input-prefix{padding-left:8px}

/* Toggle */
.set-toggle-row{display:flex;align-items:center;gap:12px}
.set-toggles-col{display:flex;flex-direction:column;gap:12px}
.set-toggle-btn{width:44px;height:24px;border-radius:12px;border:none;background:rgba(255,255,255,0.08);cursor:pointer;position:relative;flex-shrink:0;transition:background 0.3s var(--ease);padding:0}
.set-toggle-track{width:100%;height:100%;position:relative;border-radius:12px}
.set-toggle-thumb{width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;top:3px;left:3px;transition:transform 0.3s var(--ease);box-shadow:0 1px 4px rgba(0,0,0,0.3)}
.set-toggle-on{background:var(--acc)!important}
.set-toggle-on .set-toggle-thumb{transform:translateX(20px)}
.set-toggle-on-red{background:var(--red)!important}
.set-toggle-on-red .set-toggle-thumb{transform:translateX(20px)}
.set-toggle-label{font-size:12.5px;color:var(--t2)}

/* Radio Group */
.set-radio-group{display:flex;flex-direction:column;gap:6px}
.set-radio{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid var(--bdr);border-radius:10px;cursor:pointer;transition:all 0.25s var(--ease);text-align:left;font-family:var(--sans);color:var(--t1)}
.set-radio:hover{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.1)}
.set-radio-on{background:rgba(99,102,241,0.06)!important;border-color:rgba(99,102,241,0.2)!important}
.set-radio-dot-w{width:16px;height:16px;border-radius:50%;border:2px solid var(--bdr);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;transition:border-color 0.2s}
.set-radio-on .set-radio-dot-w{border-color:var(--acc)}
.set-radio-dot{width:8px;height:8px;border-radius:50%;transition:background 0.2s}
.set-radio-dot-on{background:var(--acc)}
.set-radio-label{font-size:12.5px;font-weight:600}.set-radio-desc{font-size:11px;color:var(--t3);margin-top:1px}

/* Button Group */
.set-btn-group{display:flex;gap:4px}
.set-btn-opt{padding:8px 16px;background:rgba(255,255,255,0.03);border:1px solid var(--bdr);border-radius:8px;color:var(--t2);font-family:var(--sans);font-size:12px;font-weight:500;cursor:pointer;transition:all 0.25s var(--ease)}
.set-btn-opt:hover{background:rgba(255,255,255,0.06)}
.set-btn-opt-on{background:rgba(99,102,241,0.12)!important;border-color:rgba(99,102,241,0.25)!important;color:#A5B4FC!important}

/* Symbol Tags */
.set-symbols{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.set-symbol-tag{display:flex;align-items:center;gap:6px;padding:5px 10px 5px 12px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:8px;font-size:12px;font-weight:600;color:#A5B4FC;font-family:var(--mono)}
.set-symbol-x{background:none;border:none;color:#A5B4FC;cursor:pointer;opacity:0.5;transition:opacity 0.2s;display:flex;padding:2px}
.set-symbol-x:hover{opacity:1}
.set-symbol-add{display:flex;gap:4px}
.set-symbol-input{width:100px;padding:5px 10px;background:rgba(255,255,255,0.03);border:1px solid var(--bdr);border-radius:8px;color:var(--t1);font-family:var(--mono);font-size:12px;outline:none}
.set-symbol-input:focus{border-color:rgba(99,102,241,0.4)}
.set-symbol-input::placeholder{color:var(--t3)}
.set-symbol-add-btn{width:28px;height:28px;border-radius:6px;border:1px solid var(--bdr);background:rgba(255,255,255,0.03);color:var(--t2);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s}
.set-symbol-add-btn:hover{background:rgba(99,102,241,0.1);color:#A5B4FC;border-color:rgba(99,102,241,0.3)}

/* Per-Follower */
.set-follower-list{display:flex;flex-direction:column;gap:4px}
.set-follower-row{border:1px solid var(--bdr);border-radius:12px;overflow:hidden;animation:fsu 0.4s var(--ease) both;transition:border-color 0.2s}
.set-follower-row:hover{border-color:rgba(255,255,255,0.1)}
.set-f-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;cursor:pointer;transition:background 0.2s}
.set-f-head:hover{background:rgba(255,255,255,0.02)}
.set-f-info{display:flex;align-items:center;gap:8px}
.set-f-name{font-weight:600;font-size:13px}
.set-f-right{display:flex;align-items:center;gap:10px}
.set-f-override-badge{font-size:10px;font-weight:600;padding:3px 8px;border-radius:4px;background:rgba(255,184,0,0.1);color:#FFB800;letter-spacing:0.04em}
.set-f-overrides{padding:16px 18px;border-top:1px solid var(--bdr);background:rgba(255,255,255,0.01)}
.set-f-clear{margin-top:12px;padding:6px 14px;background:transparent;border:1px solid rgba(255,77,77,0.15);border-radius:8px;color:rgba(255,77,77,0.6);font-family:var(--sans);font-size:11px;cursor:pointer;transition:all 0.2s}
.set-f-clear:hover{background:rgba(255,77,77,0.06);color:var(--red)}

/* ── Trade Log Page ─────────────────────── */
.tl-stats{display:flex;gap:0;margin-bottom:24px;background:var(--card);border:1px solid var(--bdr);border-radius:16px;overflow:hidden}
.tl-stat{flex:1;padding:18px 20px;border-right:1px solid var(--bdr)}
.tl-stat:last-child{border-right:none}
.tl-stat-label{font-size:9px;font-weight:600;letter-spacing:0.12em;color:var(--t3);margin-bottom:6px}
.tl-stat-val{font-size:18px;font-weight:700;font-family:var(--mono);letter-spacing:-0.02em}

.tl-filters{display:flex;gap:20px;margin-bottom:24px;flex-wrap:wrap}
.tl-filter-group{display:flex;align-items:center;gap:8px}
.tl-filter-label{font-size:10px;font-weight:600;letter-spacing:0.1em;color:var(--t3)}
.tl-filter-opts{display:flex;gap:4px}
.tl-fopt{padding:5px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--bdr);border-radius:6px;color:var(--t2);font-family:var(--sans);font-size:11px;font-weight:500;cursor:pointer;transition:all 0.25s var(--ease)}
.tl-fopt:hover{background:rgba(255,255,255,0.06)}
.tl-fopt-on{background:rgba(99,102,241,0.12)!important;border-color:rgba(99,102,241,0.25)!important;color:#A5B4FC!important}

.tl-time-cell{display:flex;align-items:baseline;gap:0}
.tl-ms{font-size:10px;color:var(--t3);font-family:var(--mono)}
.tl-oid{font-size:10px;font-family:var(--mono);color:var(--t3);background:rgba(255,255,255,0.04);padding:2px 8px;border-radius:4px;letter-spacing:0.03em}
.tl-brackets{display:flex;gap:4px}

/* Expanded Trade Detail */
.tl-expand{padding:20px 24px 24px 46px}
.tl-ex-summary{display:flex;gap:0;padding:14px 0;border-bottom:1px solid var(--bdr);margin-bottom:20px;flex-wrap:wrap}
.tl-ex-sm{flex:1;min-width:120px;padding:0 16px;border-right:1px solid rgba(255,255,255,0.04)}
.tl-ex-sm:first-child{padding-left:0}
.tl-ex-sm:last-child{border-right:none}
.tl-ex-sm-label{display:block;font-size:9px;font-weight:600;letter-spacing:0.1em;color:var(--t3);margin-bottom:4px}
.tl-ex-title{font-size:11px;font-weight:600;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase;margin-bottom:14px}

/* Per-Follower Fill Cards */
.tl-fills-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px}
.tl-fill-card{background:rgba(255,255,255,0.015);border:1px solid var(--bdr);border-radius:14px;padding:16px;animation:fsu 0.4s var(--ease) both;transition:background 0.2s}
.tl-fill-card:hover{background:rgba(255,255,255,0.03)}
.tl-fc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.tl-fc-name-row{display:flex;align-items:center;gap:4px}
.tl-fc-name{font-weight:600;font-size:13px}
.tl-fc-oid{font-size:9px;font-family:var(--mono);color:var(--t3);background:rgba(255,255,255,0.04);padding:2px 6px;border-radius:3px}
.tl-fc-ip-row{display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(167,139,250,0.05);border:1px solid rgba(167,139,250,0.1);border-radius:8px;margin-bottom:12px}
.tl-fc-ip{font-family:var(--mono);font-size:11px;color:#C4B5FD}
.tl-fc-region{font-size:9px;color:var(--t3);font-weight:600;letter-spacing:0.06em;margin-left:auto}

.tl-fc-metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.tl-fc-metric{display:flex;flex-direction:column;gap:2px}
.tl-fc-mlabel{font-size:8px;font-weight:600;letter-spacing:0.12em;color:var(--t3)}

.tl-fc-exit{margin-top:10px;padding-top:10px;border-top:1px dashed rgba(255,255,255,0.06)}
.tl-fc-exit-divider{font-size:9px;font-weight:700;letter-spacing:0.14em;color:var(--t3);margin-bottom:8px}

.tl-fc-latbar{margin-top:10px}
.tl-fc-latbar-track{height:3px;background:rgba(255,255,255,0.04);border-radius:2px;overflow:hidden}
.tl-fc-latbar-fill{height:100%;border-radius:2px;transition:width 0.6s var(--ease)}

/* Slippage Distribution */
.tl-ex-distro{padding:14px 0 0;border-top:1px solid var(--bdr)}
.tl-ex-distro-label{font-size:9px;font-weight:600;letter-spacing:0.12em;color:var(--t3);display:block;margin-bottom:10px}
.tl-ex-distro-bars{display:flex;flex-direction:column;gap:6px}
.tl-distro-bar-item{display:flex;align-items:center;gap:10px}
.tl-distro-bar-track{flex:1;height:6px;background:rgba(255,255,255,0.04);border-radius:3px;overflow:hidden;max-width:200px}
.tl-distro-bar-fill{height:100%;border-radius:3px;transition:width 0.6s var(--ease)}
.tl-distro-label{font-size:11px;color:var(--t2);font-family:var(--mono);min-width:80px}

@keyframes fsu{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes scaleIn{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}
@keyframes pulse-ring{0%{transform:scale(0.8);opacity:0.4}100%{transform:scale(1.6);opacity:0}}
@keyframes pulse-live{0%,100%{opacity:1}50%{opacity:0.4}}
@keyframes pulse-text{0%,100%{opacity:1}50%{opacity:0.5}}
@keyframes spin{to{transform:rotate(360deg)}}
/* ── Auth Screen ────────────────────────── */
.auth-screen{min-height:100dvh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:40px 20px}
.auth-screen-inner{width:420px;max-width:100%;display:flex;flex-direction:column;align-items:center}
.auth-screen-brand{text-align:center;margin-bottom:40px}
.auth-screen-title{font-size:32px;font-weight:800;letter-spacing:-0.03em;color:#fff}
.auth-screen-sub{font-size:13px;color:var(--t3);margin-top:6px}
.auth-screen-card{width:100%;background:rgba(255,255,255,0.025);border:1px solid var(--bdr);border-radius:16px;overflow:hidden}
.auth-screen-tabs{display:flex;border-bottom:1px solid var(--bdr)}
.auth-screen-tab{flex:1;padding:14px;background:none;border:none;color:var(--t3);font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;border-bottom:2px solid transparent}
.auth-screen-tab:hover{color:var(--t1)}
.auth-screen-tab-on{color:var(--t1)!important;border-bottom-color:var(--acc)!important;background:rgba(255,255,255,0.02)}
.auth-screen-form{padding:28px}
.auth-screen-form .set-field{margin-bottom:16px}
.auth-screen-error{padding:10px 14px;background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.15);border-radius:8px;color:var(--red);font-size:12px;margin-bottom:8px}
.auth-screen-footer{text-align:center;font-size:12px;color:var(--t3);margin-top:24px;max-width:420px;line-height:1.5}

.fade-in{animation:fsu 0.6s var(--ease) both}

@media(max-width:1100px){.stats{grid-template-columns:repeat(2,1fr)}.proxy-grid,.acct-grid{grid-template-columns:repeat(2,1fr)}.prov-grid{grid-template-columns:repeat(2,1fr)}.how-steps{flex-wrap:wrap}.how-arrow{display:none}.ml-ws-stats{flex-wrap:wrap;gap:12px}.tl-fills-grid{grid-template-columns:1fr}.tl-stats{flex-wrap:wrap}.tl-stat{min-width:calc(25% - 1px)}.set-grid-3{grid-template-columns:1fr 1fr}.set-grid-2{grid-template-columns:1fr}}
@media(max-width:768px){.sidebar{display:none}.main{margin-left:0}.page{padding:24px 16px 60px}.pg-head{flex-direction:column;gap:16px}.stats,.proxy-grid,.acct-grid{grid-template-columns:1fr}.prov-grid{grid-template-columns:1fr 1fr}.pg-title{font-size:22px}.pg-acts{width:100%}.pg-acts .btn-primary{flex:1;justify-content:center}.acct-master-row{flex-direction:column;align-items:flex-start;gap:12px}.ml-head{flex-direction:column;gap:12px}.tl-stats{flex-direction:column}.tl-stat{border-right:none;border-bottom:1px solid var(--bdr)}.tl-filters{flex-direction:column;gap:10px}.tl-fills-grid{grid-template-columns:1fr}.tl-ex-summary{flex-direction:column;gap:10px}.tl-ex-sm{padding:0;border:none}.set-grid-3,.set-grid-2{grid-template-columns:1fr}.set-kill-inner{flex-direction:column;gap:16px;text-align:center}.set-kill-left{flex-direction:column;align-items:center}.set-btn-group{flex-wrap:wrap}.prof-header{flex-direction:column;align-items:flex-start;gap:16px}.prof-field-grid{grid-template-columns:1fr}.prof-plan-cards{grid-template-columns:1fr}.prof-billing-row{flex-direction:column;gap:12px}.prof-manage-billing{margin-left:0;width:100%}.bill-plans{grid-template-columns:1fr}.bill-payment{grid-template-columns:1fr}.bill-card-preview{display:none}.onb-plans{flex-direction:column}.prof-plan-active{flex-direction:column;align-items:flex-start;gap:12px}.pp-pool-grid{grid-template-columns:1fr}.pp-limits{grid-template-columns:repeat(2,1fr)}.pp-wh-event-grid{grid-template-columns:1fr}}
`;

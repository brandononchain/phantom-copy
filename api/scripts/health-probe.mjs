#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// External health probe — run from GitHub Actions, a cron box, or uptime svc.
// Hits /api/health, parses latency, exits non-zero if slow or unhealthy so
// it can trigger pager/Slack alerts.
//
// Usage:
//   HEALTH_URL=https://api-production-e175.up.railway.app/api/health \
//   HEALTH_THRESHOLD_MS=800 \
//   node api/scripts/health-probe.mjs
// ─────────────────────────────────────────────────────────────────────────────

const URL_ = process.env.HEALTH_URL || 'https://api-production-e175.up.railway.app/api/health';
const THRESHOLD = parseInt(process.env.HEALTH_THRESHOLD_MS || '800', 10);

async function main() {
  const t0 = Date.now();
  let res, body;
  try {
    res = await fetch(URL_, { method: 'GET' });
    body = await res.json();
  } catch (err) {
    console.error(JSON.stringify({ ok: false, stage: 'fetch', error: err.message }));
    process.exit(2);
  }
  const wallMs = Date.now() - t0;

  const out = {
    ok: res.ok && body.status === 'healthy',
    status: res.status,
    wallMs,
    reportedTotalMs: body?.latency?.totalMs ?? null,
    reportedDbMs:    body?.latency?.dbMs    ?? null,
    queueMode: body?.queue?.mode ?? null,
    queueWaiting: body?.queue?.waiting ?? null,
    queueFailed:  body?.queue?.failed ?? null,
    listeners: body?.listeners?.activeSessions ?? null,
  };

  const slow = wallMs > THRESHOLD || (out.reportedTotalMs ?? 0) > THRESHOLD;
  if (slow) out.warning = `slow (threshold=${THRESHOLD}ms)`;

  console.log(JSON.stringify(out));

  if (!out.ok) process.exit(3);
  if (slow)   process.exit(4);
}

main();

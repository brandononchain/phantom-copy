#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BrightData / residential proxy connectivity test
// ─────────────────────────────────────────────────────────────────────────────
// Runs both direct (no proxy) and through-proxy requests to api.ipify.org so
// you can see:
//   1) your Railway egress IP   (direct)
//   2) the rotated residential IP (via BrightData)
//   3) the exact error if the proxy handshake fails
//
// Usage (locally):
//   BRIGHTDATA_USERNAME=brd-customer-... BRIGHTDATA_PASSWORD=... \
//   BRIGHTDATA_ZONE=residential node api/scripts/test-proxy.mjs
//
// Usage (against Railway env):
//   railway run --service API -- node api/scripts/test-proxy.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { ProxyAgent, fetch as uFetch } from 'undici';

const USER = process.env.BRIGHTDATA_USERNAME;
const PASS = process.env.BRIGHTDATA_PASSWORD;
const ZONE = process.env.BRIGHTDATA_ZONE || 'residential';
const REGION = process.env.TEST_REGION || 'us-east';
const REGION_MAP = {
  'us-east':    { country: 'us', state: 'new_york' },
  'us-west':    { country: 'us', state: 'california' },
  'us-central': { country: 'us', state: 'illinois' },
  'eu-west':    { country: 'gb' },
  'eu-central': { country: 'de' },
};

function fail(msg) { console.error(`✗ ${msg}`); process.exitCode = 1; }
function ok(msg)   { console.log(`✓ ${msg}`); }

async function resolveIp(dispatcher, label) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await uFetch('https://api.ipify.org?format=json', { dispatcher, signal: ac.signal });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON response */ }
    if (parsed?.ip) {
      ok(`${label}: ${parsed.ip}  (HTTP ${res.status})`);
      return parsed.ip;
    }
    fail(`${label}: HTTP ${res.status} — non-JSON body (${text.length} bytes)`);
    if (text.length > 0) console.error('  body:', text.slice(0, 500));
    else console.error('  body: <empty>  (common causes: IP not whitelisted, zone paused, quota exhausted)');
    return null;
  } catch (err) {
    fail(`${label}: ${err.cause?.code || err.code || err.message}`);
    if (err.cause) console.error('  cause:', err.cause);
    return null;
  } finally { clearTimeout(t); }
}

async function main() {
  console.log('── Residential proxy connectivity test ──\n');

  // 1) Direct request — baseline
  await resolveIp(undefined, 'Direct egress IP');

  // 2) Env checks
  if (!USER || !PASS) {
    fail('BRIGHTDATA_USERNAME / BRIGHTDATA_PASSWORD not set — nothing more to test.');
    return;
  }
  ok(`Creds present. Zone="${ZONE}" User="${USER.slice(0,20)}..."`);

  // 3) Build proxy URL exactly like proxy-provider.js does
  const sessionId = `pc_test_${Date.now().toString(36)}`;
  const geo = REGION_MAP[REGION] || REGION_MAP['us-east'];
  let proxyUser = `${USER}-zone-${ZONE}-session-${sessionId}-country-${geo.country}`;
  if (geo.state) proxyUser += `-state-${geo.state}`;
  const proxyUrl = `http://${proxyUser}:${PASS}@brd.superproxy.io:33335`;
  ok(`Proxy URL built (session=${sessionId} region=${REGION})`);

  // 4) Request through proxy
  const dispatcher = new ProxyAgent({ uri: proxyUrl, requestTls: { rejectUnauthorized: false } });
  const ip = await resolveIp(dispatcher, 'Via BrightData');

  if (ip) {
    console.log('\nAll good. BrightData is reachable and rotating IPs.');
  } else {
    console.log('\nTroubleshooting:');
    console.log('  • Is the zone active in https://brightdata.com/cp/zones ?');
    console.log('  • Did you whitelist the Railway egress IP printed above on BrightData?');
    console.log('  • Is the zone name exactly "' + ZONE + '"?');
    console.log('  • Are your account\'s monthly GB exhausted?');
  }
}

main().catch(e => { console.error(e); process.exit(1); });

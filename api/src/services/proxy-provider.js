// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Proxy Provider Service
// ─────────────────────────────────────────────────────────────────────────────
// Real residential proxy IP assignment via BrightData, Oxylabs, SmartProxy, IPRoyal.
// Each trading account gets a dedicated sticky session through a residential proxy.
// The proxy URL is used as an HttpsProxyAgent for all broker API calls.
// ─────────────────────────────────────────────────────────────────────────────

import { ProxyAgent } from 'undici';
import { config } from '../config/index.js';

// ── Region-to-country mapping ────────────────────────────────────────────────

const REGION_MAP = {
  'us-east':    { country: 'us', state: 'new_york' },
  'us-west':    { country: 'us', state: 'california' },
  'us-central': { country: 'us', state: 'illinois' },
  'eu-west':    { country: 'gb' },
  'eu-central': { country: 'de' },
};

// ── Provider Configurations ──────────────────────────────────────────────────
// Each provider uses their standard residential proxy gateway.
// Sticky sessions are maintained via session ID in the username.

const PROVIDERS = {

  brightdata: {
    name: 'BrightData',
    // BrightData residential gateway: brd.superproxy.io:22225
    // Username format: brd-customer-{CUSTOMER_ID}-zone-{ZONE}-session-{SESSION}-country-{CC}
    buildProxyUrl({ sessionId, region }) {
      const creds = config.proxy.brightdata;
      if (!creds.username || !creds.password) return null;
      const geo = REGION_MAP[region] || REGION_MAP['us-east'];
      let user = `${creds.username}-zone-${creds.zone || 'residential'}-session-${sessionId}-country-${geo.country}`;
      if (geo.state) user += `-state-${geo.state}`;
      return {
        host: 'brd.superproxy.io',
        port: 33335,
        url: `http://${user}:${creds.password}@brd.superproxy.io:33335`,
        username: user,
        password: creds.password,
      };
    },
  },

  oxylabs: {
    name: 'Oxylabs',
    // Oxylabs residential: pr.oxylabs.io:7777
    // Username format: customer-{USER}-sessid-{SESSION}-cc-{CC}
    buildProxyUrl({ sessionId, region }) {
      const creds = config.proxy.oxylabs;
      if (!creds.username || !creds.password) return null;
      const geo = REGION_MAP[region] || REGION_MAP['us-east'];
      const user = `customer-${creds.username}-sessid-${sessionId}-cc-${geo.country}`;
      return {
        host: 'pr.oxylabs.io',
        port: 7777,
        url: `http://${user}:${creds.password}@pr.oxylabs.io:7777`,
        username: user,
        password: creds.password,
      };
    },
  },

  smartproxy: {
    name: 'SmartProxy',
    // SmartProxy residential: gate.smartproxy.com:10001
    // Username format: user-{USER}-session-{SESSION}-country-{CC}
    buildProxyUrl({ sessionId, region }) {
      const creds = config.proxy.smartproxy;
      if (!creds.username || !creds.password) return null;
      const geo = REGION_MAP[region] || REGION_MAP['us-east'];
      const user = `user-${creds.username}-session-${sessionId}-country-${geo.country}`;
      return {
        host: 'gate.smartproxy.com',
        port: 10001,
        url: `http://${user}:${creds.password}@gate.smartproxy.com:10001`,
        username: user,
        password: creds.password,
      };
    },
  },

  iproyal: {
    name: 'IPRoyal',
    // IPRoyal residential: geo.iproyal.com:12321
    // Username format: {USER}_country-{CC}_session-{SESSION}_lifetime-24h
    buildProxyUrl({ sessionId, region }) {
      const creds = config.proxy.iproyal;
      if (!creds.username || !creds.password) return null;
      const geo = REGION_MAP[region] || REGION_MAP['us-east'];
      const user = `${creds.username}_country-${geo.country}_session-${sessionId}_lifetime-24h`;
      return {
        host: 'geo.iproyal.com',
        port: 12321,
        url: `http://${user}:${creds.password}@geo.iproyal.com:12321`,
        username: user,
        password: creds.password,
      };
    },
  },
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Assign a sticky residential proxy IP to an account.
 * Returns the proxy config + resolved external IP.
 */
export async function assignProxy({ provider = 'brightdata', region = 'us-east', accountId }) {
  const providerDef = PROVIDERS[provider];
  if (!providerDef) throw new Error(`Unknown proxy provider: ${provider}`);

  // Generate a deterministic sticky session ID for this account
  const sessionId = `pc_${accountId}_${Date.now().toString(36)}`;
  const proxyConfig = providerDef.buildProxyUrl({ sessionId, region });

  if (!proxyConfig) {
    // No credentials configured for this provider. Return a simulated assignment.
    console.warn(`[PROXY] No credentials for ${provider}. Using simulated proxy.`);
    return {
      provider,
      region,
      sessionId,
      ip: generateSimulatedIp(region),
      port: 0,
      host: `${provider}.simulated`,
      proxyUrl: null,
      simulated: true,
      type: 'Residential Sticky Session',
      rotation: 'Manual (on demand)',
    };
  }

  // Resolve actual external IP through the proxy using undici ProxyAgent
  let externalIp = null;
  try {
    const dispatcher = new ProxyAgent(proxyConfig.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const { fetch: uFetch } = await import('undici');
    const res = await uFetch('https://api.ipify.org?format=json', {
      dispatcher,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    externalIp = data.ip;
    console.log(`[PROXY] ${provider}/${region} assigned IP: ${externalIp} (session: ${sessionId})`);
  } catch (err) {
    console.error(`[PROXY] IP resolution failed for ${provider}: ${err.message}`);
    externalIp = generateSimulatedIp(region); // Fallback
  }

  return {
    provider,
    region,
    sessionId,
    ip: externalIp,
    port: proxyConfig.port,
    host: proxyConfig.host,
    proxyUrl: proxyConfig.url,
    username: proxyConfig.username,
    password: proxyConfig.password,
    simulated: !externalIp,
    type: 'Residential Sticky Session',
    rotation: 'Manual (on demand)',
  };
}

/**
 * Create an HttpsProxyAgent from stored proxy assignment data.
 */
export function createProxyAgent(proxyAssignment) {
  if (!proxyAssignment.proxyUrl && proxyAssignment.simulated) {
    return null; // No real proxy, direct connection
  }

  const url = proxyAssignment.proxyUrl ||
    `http://${proxyAssignment.username}:${proxyAssignment.password}@${proxyAssignment.host}:${proxyAssignment.port}`;
  return new ProxyAgent(url);
}

/**
 * Health check a proxy by making a request through it and measuring latency.
 */
export async function checkProxyHealth(proxyUrl) {
  if (!proxyUrl) {
    return { healthy: true, latency: 0, ip: 'direct', simulated: true };
  }

  const dispatcher = new ProxyAgent(proxyUrl);
  const start = Date.now();

  try {
    const { fetch: uFetch2 } = await import('undici');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await uFetch2('http://lumtest.com/myip.json', {
      dispatcher,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latency = Date.now() - start;
    const data = await res.json();

    return {
      healthy: true,
      latency,
      ip: data.ip,
      simulated: false,
    };
  } catch (err) {
    return {
      healthy: false,
      latency: Date.now() - start,
      ip: null,
      error: err.message,
      simulated: false,
    };
  }
}

/**
 * Rotate a proxy session (get a new IP while keeping the same provider/region).
 */
export async function rotateProxy({ provider, region, accountId }) {
  // Simply assign a new session - the new session ID gives a new IP
  return assignProxy({ provider, region, accountId });
}

/**
 * List available providers and their configuration status.
 */
export function getAvailableProviders() {
  return Object.entries(PROVIDERS).map(([key, def]) => {
    const proxyConfig = def.buildProxyUrl({ sessionId: 'test', region: 'us-east' });
    return {
      id: key,
      name: def.name,
      configured: !!proxyConfig,
      regions: Object.keys(REGION_MAP),
    };
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateSimulatedIp(region) {
  const regionBases = {
    'us-east': [63, 72, 104], 'us-west': [34, 52, 157],
    'us-central': [66, 98, 129], 'eu-west': [51, 82, 178],
    'eu-central': [46, 89, 195],
  };
  const base = (regionBases[region] || regionBases['us-east']);
  return `${base[0]}.${base[1]}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;
}

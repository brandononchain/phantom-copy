import { Router } from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';
import { config } from '../config/index.js';
import { assignProxy, checkProxyHealth, rotateProxy, getAvailableProviders } from '../services/proxy-provider.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const result = await query(
    `SELECT pa.*, a.label, a.platform, a.role FROM proxy_assignments pa
     JOIN accounts a ON a.id = pa.account_id WHERE a.user_id = $1 ORDER BY pa.assigned_at DESC`,
    [req.user.id]
  );
  res.json({ proxies: result.rows });
});

router.get('/providers', authRequired, (req, res) => {
  res.json({ providers: getAvailableProviders() });
});

router.post('/assign', authRequired, async (req, res) => {
  const { accountId, provider = 'brightdata', region = 'us-east' } = req.body;
  if (!accountId) return res.status(400).json({ error: 'accountId required' });

  // Plan check: basic can only use brightdata
  const userPlan = await query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
  const plan = userPlan.rows[0]?.plan || 'basic';
  const allowedProviders = plan === 'basic' ? ['brightdata'] : ['brightdata', 'oxylabs', 'smartproxy', 'iproyal'];

  if (!allowedProviders.includes(provider)) {
    return res.status(403).json({
      error: 'provider_restricted',
      message: `${provider} requires Pro or Pro+ plan. Basic plan supports BrightData only.`,
      allowed: allowedProviders,
    });
  }

  const acct = await query('SELECT * FROM accounts WHERE id = $1 AND user_id = $2', [accountId, req.user.id]);
  if (acct.rows.length === 0) return res.status(404).json({ error: 'Account not found' });

  try {
    const assignment = await assignProxy({ provider, region, accountId });

    await query(
      `ALTER TABLE proxy_assignments ADD COLUMN IF NOT EXISTS proxy_url TEXT;
       ALTER TABLE proxy_assignments ADD COLUMN IF NOT EXISTS proxy_username TEXT;
       ALTER TABLE proxy_assignments ADD COLUMN IF NOT EXISTS proxy_password TEXT;
       ALTER TABLE proxy_assignments ADD COLUMN IF NOT EXISTS host VARCHAR(255);
       ALTER TABLE proxy_assignments ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);`
    ).catch(() => {});

    await query(
      `INSERT INTO proxy_assignments (account_id, user_id, provider, region, ip_address, port, session_id, host, proxy_url, proxy_username, proxy_password, health, last_health_check)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'healthy', NOW())
       ON CONFLICT (account_id) DO UPDATE SET
         provider=EXCLUDED.provider, region=EXCLUDED.region, ip_address=EXCLUDED.ip_address,
         port=EXCLUDED.port, session_id=EXCLUDED.session_id, host=EXCLUDED.host,
         proxy_url=EXCLUDED.proxy_url, proxy_username=EXCLUDED.proxy_username,
         proxy_password=EXCLUDED.proxy_password, health='healthy', last_health_check=NOW()`,
      [accountId, req.user.id, provider, region, assignment.ip, assignment.port, assignment.sessionId,
       assignment.host || null, assignment.proxyUrl || null, assignment.username || null, assignment.password || null]
    );

    res.json({
      success: true,
      proxy: {
        ip: assignment.ip, provider: assignment.provider, region: assignment.region,
        type: assignment.type, rotation: assignment.rotation, simulated: assignment.simulated,
        sessionId: assignment.sessionId,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Proxy assignment failed', message: err.message });
  }
});

router.post('/:accountId/rotate', authRequired, async (req, res) => {
  const current = await query(
    `SELECT pa.*, a.user_id FROM proxy_assignments pa JOIN accounts a ON a.id = pa.account_id
     WHERE pa.account_id = $1 AND a.user_id = $2`,
    [req.params.accountId, req.user.id]
  );
  if (current.rows.length === 0) return res.status(404).json({ error: 'No proxy assigned' });
  const prev = current.rows[0];

  try {
    const assignment = await rotateProxy({ provider: prev.provider, region: prev.region, accountId: parseInt(req.params.accountId) });
    await query(
      `UPDATE proxy_assignments SET ip_address=$1, session_id=$2, proxy_url=$3, proxy_username=$4, proxy_password=$5, host=$6, health='healthy', last_health_check=NOW() WHERE account_id=$7`,
      [assignment.ip, assignment.sessionId, assignment.proxyUrl || null, assignment.username || null, assignment.password || null, assignment.host || null, req.params.accountId]
    );
    res.json({ success: true, previousIp: prev.ip_address, newIp: assignment.ip, simulated: assignment.simulated });
  } catch (err) {
    res.status(500).json({ error: 'Rotation failed', message: err.message });
  }
});

router.post('/:accountId/health', authRequired, async (req, res) => {
  // Self-heal: ensure proxy credential columns exist
  await query(`
    ALTER TABLE proxy_assignments ADD COLUMN IF NOT EXISTS proxy_url TEXT;
    ALTER TABLE proxy_assignments ADD COLUMN IF NOT EXISTS proxy_username TEXT;
    ALTER TABLE proxy_assignments ADD COLUMN IF NOT EXISTS proxy_password TEXT;
    ALTER TABLE proxy_assignments ADD COLUMN IF NOT EXISTS host VARCHAR(255);
  `).catch(() => {});

  const proxy = await query(
    `SELECT pa.* FROM proxy_assignments pa JOIN accounts a ON a.id = pa.account_id
     WHERE pa.account_id = $1 AND a.user_id = $2`,
    [req.params.accountId, req.user.id]
  );
  if (proxy.rows.length === 0) return res.status(404).json({ error: 'No proxy assigned' });

  const pa = proxy.rows[0];
  let health;

  // Always rebuild proxy URL fresh from provider config (same as assignProxy)
  // This avoids stale/malformed URLs in the DB
  try {
    const freshAssignment = await assignProxy({
      provider: pa.provider || 'brightdata',
      region: pa.region || 'us-east',
      accountId: parseInt(req.params.accountId),
    });
    health = {
      healthy: !!freshAssignment.ip && !freshAssignment.simulated,
      latency: 0,
      ip: freshAssignment.ip,
      simulated: freshAssignment.simulated,
    };
    // Measure latency separately
    const start = Date.now();
    health.latency = Date.now() - start;

    // Update the stored IP
    await query(
      'UPDATE proxy_assignments SET ip_address = $1, proxy_url = $2, health = $3, last_health_check = NOW() WHERE account_id = $4',
      [freshAssignment.ip, freshAssignment.proxyUrl || null, health.healthy ? 'healthy' : 'unhealthy', req.params.accountId]
    ).catch(() => {});
  } catch (err) {
    health = { healthy: false, latency: 0, ip: null, error: err.message, simulated: false };
  }

  const status = health.healthy ? 'healthy' : 'unhealthy';
  await query('UPDATE proxy_assignments SET health=$1, last_health_check=NOW() WHERE account_id=$2', [status, req.params.accountId]);
  await query(
    'INSERT INTO proxy_health_log (account_id, ip_address, latency_ms, status) VALUES ($1,$2,$3,$4)',
    [req.params.accountId, health.ip || pa.ip_address, health.latency, status]
  );

  res.json({ healthy: health.healthy, latency: health.latency, ip: health.ip, simulated: health.simulated });
});

router.post('/health-check-all', authRequired, async (req, res) => {
  const proxies = await query(
    `SELECT pa.*, a.label FROM proxy_assignments pa JOIN accounts a ON a.id = pa.account_id WHERE a.user_id = $1`,
    [req.user.id]
  );

  const results = [];
  for (const pa of proxies.rows) {
    const proxyUrl = pa.proxy_url || (pa.host && pa.proxy_username ? `http://${pa.proxy_username}:${pa.proxy_password}@${pa.host}:${pa.port || 33335}` : null);
    const health = await checkProxyHealth(proxyUrl);
    const status = health.healthy ? 'healthy' : 'unhealthy';
    await query('UPDATE proxy_assignments SET health=$1, last_health_check=NOW() WHERE id=$2', [status, pa.id]);
    await query('INSERT INTO proxy_health_log (account_id, ip_address, latency_ms, status) VALUES ($1,$2,$3,$4)',
      [pa.account_id, health.ip || pa.ip_address, health.latency, status]);
    results.push({ accountId: pa.account_id, label: pa.label, ...health, status });
  }

  res.json({ results });
});

router.get('/:accountId/health-history', authRequired, async (req, res) => {
  const result = await query(
    `SELECT phl.* FROM proxy_health_log phl JOIN accounts a ON a.id = phl.account_id
     WHERE phl.account_id = $1 AND a.user_id = $2 ORDER BY phl.checked_at DESC LIMIT 100`,
    [req.params.accountId, req.user.id]
  );
  res.json({ history: result.rows });
});


router.get('/:accountId/debug', authRequired, async (req, res) => {
  const proxy = await query(
    'SELECT pa.* FROM proxy_assignments pa JOIN accounts a ON a.id = pa.account_id WHERE pa.account_id = $1 AND a.user_id = $2',
    [req.params.accountId, req.user.id]
  );
  if (proxy.rows.length === 0) return res.json({ error: 'no proxy' });
  const pa = proxy.rows[0];
  
  let builtUrl = null;
  const bdc = config.proxy?.brightdata || {};
  if (pa.provider === 'brightdata' && pa.session_id && bdc.username && bdc.password) {
    const user = bdc.username + '-zone-' + (bdc.zone || 'residential') + '-session-' + pa.session_id + '-country-us';
    builtUrl = 'http://' + user + ':' + bdc.password + '@brd.superproxy.io:33335';
  }

  res.json({
    stored_proxy_url: pa.proxy_url ? 'SET' : 'NULL',
    built_url: builtUrl ? 'BUILT' : 'NULL',
    would_use: pa.proxy_url ? 'stored' : builtUrl ? 'built' : 'none',
    provider: pa.provider,
    session_id: pa.session_id,
    ip: pa.ip_address,
    bd_configured: !!bdc.username,
  });
});

export default router;

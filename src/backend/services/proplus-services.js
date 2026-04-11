// ─────────────────────────────────────────────────────────────────────────────
// Phantom Copy: Pro+ Backend Services
// ─────────────────────────────────────────────────────────────────────────────
// Three services exclusive to Pro+ plan:
//   1. Custom Proxy Pool Manager
//   2. REST API Key Manager
//   3. Webhook Delivery Engine
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import { EventEmitter } from 'events';

// ─── Plan Gate Middleware ─────────────────────────────────────────────────────

const PLAN_FEATURES = {
  basic:   { maxFollowers: 5,  providers: ['brightdata'], overrides: false, customPools: false, api: false, webhooks: false },
  pro:     { maxFollowers: Infinity, providers: ['brightdata','oxylabs','smartproxy','iproyal'], overrides: true, customPools: false, api: false, webhooks: false },
  proplus: { maxFollowers: Infinity, providers: ['brightdata','oxylabs','smartproxy','iproyal'], overrides: true, customPools: true, api: true,  webhooks: true },
};

export function requirePlan(requiredFeature) {
  return (req, res, next) => {
    const plan = req.user?.plan || 'basic';
    const features = PLAN_FEATURES[plan];

    if (!features || !features[requiredFeature]) {
      return res.status(403).json({
        error: 'plan_required',
        message: `This feature requires the Pro+ plan. Current plan: ${plan}`,
        upgrade_url: '/api/billing/plans',
      });
    }

    req.planFeatures = features;
    next();
  };
}

export function requirePro() {
  return (req, res, next) => {
    const plan = req.user?.plan || 'basic';
    if (plan === 'basic') {
      return res.status(403).json({ error: 'pro_required', message: 'Pro or Pro+ plan required' });
    }
    req.planFeatures = PLAN_FEATURES[plan];
    next();
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 1. Custom Proxy Pool Manager
// ─────────────────────────────────────────────────────────────────────────────
//
// Pro+ users can provision dedicated proxy pools with their preferred provider
// and region. Each pool maintains a set of sticky residential IPs that can be
// assigned to specific trading accounts.
//
// Database schema:
//   proxy_pools: id, user_id, name, provider, region, size, status, created_at
//   proxy_pool_ips: id, pool_id, ip_address, port, session_id, health, last_check
//
// Providers supported: BrightData, Oxylabs, SmartProxy, IPRoyal

export class CustomProxyPoolManager {
  constructor({ db, providers }) {
    this.db = db;
    this.providers = providers; // Map of provider name -> adapter
  }

  async createPool(userId, { name, provider, region, size }) {
    // Validate provider
    const adapter = this.providers.get(provider);
    if (!adapter) throw new Error(`Unsupported provider: ${provider}`);

    // Create pool record
    const pool = await this.db.query(
      `INSERT INTO proxy_pools (user_id, name, provider, region, size, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'provisioning', NOW()) RETURNING *`,
      [userId, name, provider, region, size]
    );

    // Provision IPs asynchronously
    this.provisionIPs(pool.rows[0].id, adapter, region, size).catch(err => {
      console.error(`Pool provisioning failed: ${err.message}`);
      this.db.query(`UPDATE proxy_pools SET status = 'failed' WHERE id = $1`, [pool.rows[0].id]);
    });

    return pool.rows[0];
  }

  async provisionIPs(poolId, adapter, region, count) {
    const ips = await adapter.allocateStickyIPs(region, count);

    for (const ip of ips) {
      await this.db.query(
        `INSERT INTO proxy_pool_ips (pool_id, ip_address, port, session_id, health, last_check)
         VALUES ($1, $2, $3, $4, 'healthy', NOW())`,
        [poolId, ip.host, ip.port, ip.sessionId]
      );
    }

    await this.db.query(
      `UPDATE proxy_pools SET status = 'active' WHERE id = $1`,
      [poolId]
    );
  }

  async getPools(userId) {
    const result = await this.db.query(
      `SELECT p.*, COUNT(i.id) as ip_count,
              SUM(CASE WHEN i.health = 'healthy' THEN 1 ELSE 0 END) as healthy_count
       FROM proxy_pools p
       LEFT JOIN proxy_pool_ips i ON i.pool_id = p.id
       WHERE p.user_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async assignPoolToAccount(poolId, accountId) {
    // Get next available healthy IP from pool
    const ip = await this.db.query(
      `SELECT * FROM proxy_pool_ips
       WHERE pool_id = $1 AND health = 'healthy'
       AND id NOT IN (SELECT proxy_ip_id FROM proxy_assignments WHERE proxy_ip_id IS NOT NULL)
       LIMIT 1`,
      [poolId]
    );

    if (ip.rows.length === 0) throw new Error('No available IPs in pool');

    await this.db.query(
      `UPDATE proxy_assignments SET proxy_ip_id = $1, pool_id = $2 WHERE account_id = $3`,
      [ip.rows[0].id, poolId, accountId]
    );

    return ip.rows[0];
  }

  async rotatePoolIPs(poolId) {
    const pool = await this.db.query(`SELECT * FROM proxy_pools WHERE id = $1`, [poolId]);
    if (!pool.rows[0]) throw new Error('Pool not found');

    const adapter = this.providers.get(pool.rows[0].provider);

    // Get all IPs in pool
    const ips = await this.db.query(`SELECT * FROM proxy_pool_ips WHERE pool_id = $1`, [poolId]);

    for (const ip of ips.rows) {
      const newSession = await adapter.rotateSession(ip.session_id);
      await this.db.query(
        `UPDATE proxy_pool_ips SET session_id = $1, ip_address = $2, last_check = NOW() WHERE id = $3`,
        [newSession.sessionId, newSession.host, ip.id]
      );
    }
  }

  async deletePool(poolId, userId) {
    // Unassign any accounts using this pool
    await this.db.query(
      `UPDATE proxy_assignments SET proxy_ip_id = NULL, pool_id = NULL
       WHERE pool_id = $1`,
      [poolId]
    );

    await this.db.query(`DELETE FROM proxy_pool_ips WHERE pool_id = $1`, [poolId]);
    await this.db.query(`DELETE FROM proxy_pools WHERE id = $1 AND user_id = $2`, [poolId, userId]);
  }

  async healthCheck(poolId) {
    const ips = await this.db.query(`SELECT * FROM proxy_pool_ips WHERE pool_id = $1`, [poolId]);
    const pool = await this.db.query(`SELECT * FROM proxy_pools WHERE id = $1`, [poolId]);
    const adapter = this.providers.get(pool.rows[0]?.provider);

    const results = await Promise.allSettled(
      ips.rows.map(async (ip) => {
        const healthy = await adapter.testIP(ip.ip_address, ip.port);
        await this.db.query(
          `UPDATE proxy_pool_ips SET health = $1, last_check = NOW() WHERE id = $2`,
          [healthy ? 'healthy' : 'unhealthy', ip.id]
        );
        return { ip: ip.ip_address, healthy };
      })
    );

    return results.map(r => r.status === 'fulfilled' ? r.value : { healthy: false });
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 2. REST API Key Manager
// ─────────────────────────────────────────────────────────────────────────────
//
// Pro+ users get programmatic access to Phantom Copy via REST API.
// Keys use the format: pc_live_{40 random chars} or pc_test_{40 chars}
//
// Keys are hashed (SHA-256) before storage. The raw key is shown once at
// creation and never again.
//
// Database schema:
//   api_keys: id, user_id, name, key_hash, key_prefix, env, status, created_at, last_used_at
//
// Auth flow: Bearer token in Authorization header -> hash -> lookup in api_keys

export class APIKeyManager {
  constructor({ db }) {
    this.db = db;
  }

  generateKey(env = 'live') {
    const prefix = `pc_${env}_`;
    const random = crypto.randomBytes(30).toString('base64url');
    return prefix + random;
  }

  hashKey(rawKey) {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  async createKey(userId, name, env = 'live') {
    const rawKey = this.generateKey(env);
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 16) + '...';

    await this.db.query(
      `INSERT INTO api_keys (user_id, name, key_hash, key_prefix, env, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW())`,
      [userId, name, keyHash, keyPrefix, env]
    );

    // Return the raw key ONCE. After this, only the prefix is stored.
    return { rawKey, prefix: keyPrefix, name, env };
  }

  async validateKey(rawKey) {
    const keyHash = this.hashKey(rawKey);

    const result = await this.db.query(
      `SELECT ak.*, u.id as uid, u.plan
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
       WHERE ak.key_hash = $1 AND ak.status = 'active'`,
      [keyHash]
    );

    if (result.rows.length === 0) return null;

    // Update last used
    await this.db.query(
      `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
      [result.rows[0].id]
    );

    return {
      userId: result.rows[0].user_id,
      plan: result.rows[0].plan,
      keyId: result.rows[0].id,
      env: result.rows[0].env,
    };
  }

  async listKeys(userId) {
    const result = await this.db.query(
      `SELECT id, name, key_prefix, env, status, created_at, last_used_at
       FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async revokeKey(keyId, userId) {
    await this.db.query(
      `UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND user_id = $2`,
      [keyId, userId]
    );
  }
}

// Express middleware for API key auth
export function apiKeyAuth(keyManager) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer pc_')) {
      return res.status(401).json({ error: 'missing_api_key', message: 'Provide API key as Bearer token' });
    }

    const rawKey = authHeader.slice(7);
    const keyData = await keyManager.validateKey(rawKey);

    if (!keyData) {
      return res.status(401).json({ error: 'invalid_api_key', message: 'API key is invalid or revoked' });
    }

    if (keyData.plan !== 'proplus') {
      return res.status(403).json({ error: 'plan_required', message: 'API access requires Pro+ plan' });
    }

    req.user = { id: keyData.userId, plan: keyData.plan };
    req.apiKey = keyData;
    next();
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 3. Webhook Delivery Engine
// ─────────────────────────────────────────────────────────────────────────────
//
// Pro+ users register webhook endpoints and select which events to receive.
// The engine handles delivery with exponential backoff retry (max 5 attempts),
// signature verification (HMAC-SHA256), and delivery logging.
//
// Database schema:
//   webhooks: id, user_id, url, events (jsonb), secret, status, created_at
//   webhook_deliveries: id, webhook_id, event_type, payload, status, attempts,
//                       last_attempt_at, response_code, response_body
//
// Supported events:
//   trade.executed, trade.failed
//   listener.connected, listener.disconnected
//   risk.drawdown
//   proxy.rotated
//   account.connected

const WEBHOOK_EVENTS = [
  'trade.executed', 'trade.failed',
  'listener.connected', 'listener.disconnected',
  'risk.drawdown', 'proxy.rotated', 'account.connected',
];

export class WebhookEngine extends EventEmitter {
  constructor({ db }) {
    super();
    this.db = db;
    this.retryDelays = [0, 5000, 30000, 120000, 600000]; // immediate, 5s, 30s, 2m, 10m
  }

  async registerWebhook(userId, { url, events }) {
    // Validate events
    const validEvents = events.filter(e => WEBHOOK_EVENTS.includes(e));
    if (validEvents.length === 0) throw new Error('No valid events specified');

    // Generate signing secret
    const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;

    const result = await this.db.query(
      `INSERT INTO webhooks (user_id, url, events, secret, status, created_at)
       VALUES ($1, $2, $3, $4, 'active', NOW()) RETURNING *`,
      [userId, url, JSON.stringify(validEvents), secret]
    );

    return { ...result.rows[0], secret };
  }

  async listWebhooks(userId) {
    const result = await this.db.query(
      `SELECT w.*,
              (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id AND wd.status = 'delivered') as success_count,
              (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id) as total_count,
              (SELECT MAX(last_attempt_at) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id) as last_delivery
       FROM webhooks w WHERE w.user_id = $1 AND w.status = 'active'
       ORDER BY w.created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async deleteWebhook(webhookId, userId) {
    await this.db.query(
      `UPDATE webhooks SET status = 'deleted' WHERE id = $1 AND user_id = $2`,
      [webhookId, userId]
    );
  }

  // ── Dispatch an event to all matching webhooks for a user ──────────────

  async dispatch(userId, eventType, payload) {
    if (!WEBHOOK_EVENTS.includes(eventType)) return;

    const webhooks = await this.db.query(
      `SELECT * FROM webhooks
       WHERE user_id = $1 AND status = 'active'
       AND events::jsonb ? $2`,
      [userId, eventType]
    );

    const deliveries = webhooks.rows.map(wh =>
      this.deliver(wh, eventType, payload)
    );

    await Promise.allSettled(deliveries);
  }

  // ── Deliver a single webhook with retry ────────────────────────────────

  async deliver(webhook, eventType, payload, attempt = 0) {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      event: eventType,
      timestamp,
      data: payload,
    });

    // HMAC-SHA256 signature
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    // Create delivery record on first attempt
    let deliveryId;
    if (attempt === 0) {
      const del = await this.db.query(
        `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status, attempts, last_attempt_at)
         VALUES ($1, $2, $3, 'pending', 0, NOW()) RETURNING id`,
        [webhook.id, eventType, body]
      );
      deliveryId = del.rows[0].id;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PhantomCopy-Signature': signature,
          'X-PhantomCopy-Timestamp': String(timestamp),
          'X-PhantomCopy-Event': eventType,
          'User-Agent': 'PhantomCopy-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseBody = await response.text().catch(() => '');

      if (response.ok) {
        // Success
        if (deliveryId) {
          await this.db.query(
            `UPDATE webhook_deliveries
             SET status = 'delivered', attempts = $1, last_attempt_at = NOW(),
                 response_code = $2, response_body = $3
             WHERE id = $4`,
            [attempt + 1, response.status, responseBody.slice(0, 500), deliveryId]
          );
        }
        return { success: true, status: response.status };
      }

      throw new Error(`HTTP ${response.status}`);

    } catch (error) {
      // Update delivery record
      if (deliveryId) {
        await this.db.query(
          `UPDATE webhook_deliveries
           SET attempts = $1, last_attempt_at = NOW(), response_body = $2
           WHERE id = $3`,
          [attempt + 1, error.message.slice(0, 500), deliveryId]
        );
      }

      // Retry with backoff
      if (attempt < this.retryDelays.length - 1) {
        const delay = this.retryDelays[attempt + 1];
        setTimeout(() => this.deliver(webhook, eventType, payload, attempt + 1), delay);
      } else {
        // Max retries exhausted
        if (deliveryId) {
          await this.db.query(
            `UPDATE webhook_deliveries SET status = 'failed' WHERE id = $1`,
            [deliveryId]
          );
        }
        this.emit('delivery-failed', { webhookId: webhook.id, eventType, error: error.message });
      }
    }
  }

  // ── Get delivery history ──────────────────────────────────────────────

  async getDeliveries(webhookId, limit = 20) {
    const result = await this.db.query(
      `SELECT * FROM webhook_deliveries
       WHERE webhook_id = $1
       ORDER BY last_attempt_at DESC
       LIMIT $2`,
      [webhookId, limit]
    );
    return result.rows;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Express Routes
// ─────────────────────────────────────────────────────────────────────────────

export function mountProPlusRoutes(app, { db, proxyProviders }) {
  const poolManager = new CustomProxyPoolManager({ db, providers: proxyProviders });
  const keyManager = new APIKeyManager({ db });
  const webhookEngine = new WebhookEngine({ db });

  // ── Custom Proxy Pools ─────────────────────────────────────────────────

  app.get('/api/proxy-pools', requirePlan('customPools'), async (req, res) => {
    const pools = await poolManager.getPools(req.user.id);
    res.json({ pools });
  });

  app.post('/api/proxy-pools', requirePlan('customPools'), async (req, res) => {
    const { name, provider, region, size } = req.body;
    const pool = await poolManager.createPool(req.user.id, { name, provider, region, size });
    res.status(201).json({ pool });
  });

  app.post('/api/proxy-pools/:id/rotate', requirePlan('customPools'), async (req, res) => {
    await poolManager.rotatePoolIPs(req.params.id);
    res.json({ success: true });
  });

  app.post('/api/proxy-pools/:id/health', requirePlan('customPools'), async (req, res) => {
    const results = await poolManager.healthCheck(req.params.id);
    res.json({ results });
  });

  app.delete('/api/proxy-pools/:id', requirePlan('customPools'), async (req, res) => {
    await poolManager.deletePool(req.params.id, req.user.id);
    res.json({ success: true });
  });

  app.post('/api/proxy-pools/:id/assign', requirePlan('customPools'), async (req, res) => {
    const { accountId } = req.body;
    const ip = await poolManager.assignPoolToAccount(req.params.id, accountId);
    res.json({ assigned: ip });
  });

  // ── API Keys ───────────────────────────────────────────────────────────

  app.get('/api/keys', requirePlan('api'), async (req, res) => {
    const keys = await keyManager.listKeys(req.user.id);
    res.json({ keys });
  });

  app.post('/api/keys', requirePlan('api'), async (req, res) => {
    const { name, env } = req.body;
    const key = await keyManager.createKey(req.user.id, name, env || 'live');
    res.status(201).json({ key });
  });

  app.delete('/api/keys/:id', requirePlan('api'), async (req, res) => {
    await keyManager.revokeKey(req.params.id, req.user.id);
    res.json({ success: true });
  });

  // ── Webhooks ───────────────────────────────────────────────────────────

  app.get('/api/webhooks', requirePlan('webhooks'), async (req, res) => {
    const webhooks = await webhookEngine.listWebhooks(req.user.id);
    res.json({ webhooks });
  });

  app.post('/api/webhooks', requirePlan('webhooks'), async (req, res) => {
    const { url, events } = req.body;
    const webhook = await webhookEngine.registerWebhook(req.user.id, { url, events });
    res.status(201).json({ webhook });
  });

  app.delete('/api/webhooks/:id', requirePlan('webhooks'), async (req, res) => {
    await webhookEngine.deleteWebhook(req.params.id, req.user.id);
    res.json({ success: true });
  });

  app.get('/api/webhooks/:id/deliveries', requirePlan('webhooks'), async (req, res) => {
    const deliveries = await webhookEngine.getDeliveries(req.params.id);
    res.json({ deliveries });
  });

  // Expose webhook engine for event dispatching from copy engine
  return { poolManager, keyManager, webhookEngine };
}

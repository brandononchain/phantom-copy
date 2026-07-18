import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';

// Routes
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import tradeRoutes from './routes/trades.js';
import proxyRoutes from './routes/proxies.js';
import billingRoutes from './routes/billing.js';
import proplusRoutes from './routes/proplus.js';
import brokerRoutes from './routes/brokers.js';
import listenerRoutes from './routes/listeners.js';
import settingsRoutes from './routes/settings.js';
import notificationRoutes from './routes/notifications.js';
import signalRoutes from './routes/signals.js';
import { listenerManager } from './services/listener-manager.js';
import { copyEngine } from './services/copy-engine.js';
import { initRedis, startWorker, shutdownQueue, getQueueStats } from './services/copy-queue.js';
import { decryptJSON } from './services/crypto.js';
import { startTokenRefreshLoop, stopTokenRefreshLoop } from './services/token-refresh.js';

const app = express();

// Railway terminates TLS and forwards via X-Forwarded-For.
// Trust the first hop so express-rate-limit can identify clients correctly.
app.set('trust proxy', 1);

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      config.cors.origin,
      'https://tradevanish.com',
      'https://www.tradevanish.com',
      'https://app.tradevanish.com',
      'https://web-production-0433b.up.railway.app',
      'http://localhost:3000',
    ].filter(Boolean).map(a => a.replace(/\/$/, ''));
    // No-origin requests (curl, server-to-server, TradingView webhooks) always allowed
    if (!origin) return callback(null, true);
    const ok = allowed.some(a => origin === a || origin.startsWith(a + '/'));
    if (ok) return callback(null, true);
    // In dev, allow anything; in prod, reject so cookie auth can't leak.
    // API-key + signal-key endpoints don't use cookies so they remain reachable from any origin.
    if (config.isDev) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
// Redact signal keys from access logs — they travel in the URL and are the sole
// credential for the webhook, so never write them to stdout/proxy logs verbatim.
morgan.token('url', (req) => (req.originalUrl || req.url || '').replace(/(\/api\/signals\/)[A-Za-z0-9_-]+/, '$1tv_***'));
app.use(morgan(config.isDev ? 'dev' : 'combined'));
app.use(cookieParser());

// Stripe webhook needs raw body - must be before express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// Rate limiting. The webhook is exempted from the shared per-IP limiter because
// TradingView egresses all customers' alerts from a handful of IPs — one global
// budget would drop legitimate signals under load. It gets its own per-key limiter.
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.isDev ? 1000 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => (req.originalUrl || '').startsWith('/api/signals/'),
}));

// Per-signal-key limiter for the webhook (keyed by URL, which carries the key).
const signalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.isDev ? 1000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.originalUrl || req.ip,
  validate: false,
  message: { error: 'Signal rate limit exceeded — max 300/min per key' },
});

// ── Health ────────────────────────────────────────────────────────────────────

// Threshold (ms) above which the health check emits a [HEALTH-SLOW] log line.
// Railway/Grafana/pager log-based alerts can match on this prefix.
const HEALTH_SLOW_MS = parseInt(process.env.HEALTH_SLOW_MS || '500', 10);

app.get('/api/health', async (req, res) => {
  const t0 = Date.now();
  try {
    const dbStart = Date.now();
    await pool.query('SELECT 1');
    const dbMs = Date.now() - dbStart;

    const listenerStatus = listenerManager?.getStatus?.() || { activeSessions: 0 };
    const copyStats = copyEngine?.getStats?.() || {};
    const queueStats = await getQueueStats().catch(() => ({ mode: 'inline' }));
    const totalMs = Date.now() - t0;

    if (dbMs > HEALTH_SLOW_MS || totalMs > HEALTH_SLOW_MS) {
      console.warn(`[HEALTH-SLOW] db=${dbMs}ms total=${totalMs}ms threshold=${HEALTH_SLOW_MS}ms`);
    }

    res.json({
      status: 'healthy',
      ts: new Date().toISOString(),
      v: '1.1.0',
      db: 'connected',
      latency: { dbMs, totalMs },
      listeners: listenerStatus,
      copyEngine: {
        totalSignals: copyStats.totalSignals || 0,
        totalFills: copyStats.totalFills || 0,
        cachedClients: copyStats.cachedClients || 0,
      },
      queue: queueStats,
      uptime: Math.floor(process.uptime()),
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
    });
  } catch (err) {
    console.error(`[HEALTH-FAIL] ${err.message}`);
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// ── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/proxies', proxyRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/proplus', proplusRoutes);
app.use('/api/brokers', brokerRoutes);
app.use('/api/listeners', listenerRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
// Accept text/plain and header-less bodies too — TradingView alerts default to
// text/plain, which the global application/json parser would leave unparsed.
app.use('/api/signals', signalLimiter, express.json({ type: () => true, limit: '1mb' }), signalRoutes);

// ── 404 ──────────────────────────────────────────────────────────────────────

app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (config.isDev) console.error(err.stack);
  res.status(err.status || 500).json({
    error: config.isDev ? err.message : 'Internal server error',
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

async function start() {
  // Run migrations
  try {
    console.log('[STARTUP] Running migrations...');
    await runMigrations(pool);
  } catch (err) {
    console.error('[STARTUP] Migration failed:', err.message);
  }

  const port = config.port;
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[API] Tradevanish API listening on port ${port}`);
    console.log(`[API] Env: ${config.nodeEnv} | CORS: ${config.cors.origin}`);
  });

  // ── Initialize Redis Queue (optional, degrades gracefully) ───────────────
  const redisReady = initRedis();
  // SERVICE_ROLE:
  //   'api'    → HTTP + listener-manager only; BullMQ worker runs in a separate service
  //   'worker' → handled by src/worker.js (never reaches here)
  //   unset    → backward-compatible single-process mode (both)
  const role = (process.env.SERVICE_ROLE || 'both').toLowerCase();
  if (redisReady && role !== 'api') {
    startWorker(copyEngine);
  } else if (redisReady) {
    console.log('[API] SERVICE_ROLE=api — BullMQ worker disabled in this process');
  }

  // ── Start Tradovate Token Refresh Loop ───────────────────────────────────
  startTokenRefreshLoop();

  // ── Restore active listeners from DB on startup ──────────────────────────
  // If the server restarted, reconnect any listeners that were running
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (ls.account_id)
              ls.*, a.credentials_encrypted, a.platform, a.broker_account_id,
              pa.proxy_url, pa.host AS proxy_host, pa.port AS proxy_port,
              pa.proxy_username, pa.proxy_password, pa.ip_address AS proxy_ip
       FROM listener_sessions ls
       JOIN accounts a ON a.id = ls.account_id
       LEFT JOIN proxy_assignments pa ON pa.account_id = a.id
       WHERE ls.status IN ('active', 'restarting')
       ORDER BY ls.account_id, ls.started_at DESC`
    );
    if (rows.length > 0) {
      console.log(`[STARTUP] Restoring ${rows.length} active listener(s)...`);
      for (const session of rows) {
        try {
          let creds = decryptJSON(session.credentials_encrypted);
          // TopStepX needs apiKey to re-auth on restore; Tradovate needs token
          const hasRequiredCreds =
            (session.platform === 'topstepx' && creds.apiKey && creds.username) ||
            (session.platform === 'tradovate' && creds.token) ||
            (session.platform === 'rithmic' && creds.username && creds.password);

          if (hasRequiredCreds) {
            await listenerManager.startListener({
              userId: session.user_id,
              accountId: session.account_id,
              platform: session.platform,
              brokerAccountId: session.broker_account_id,
              credentials: creds,
              proxyAssignment: session.proxy_url ? {
                proxyUrl: session.proxy_url,
                host: session.proxy_host,
                port: session.proxy_port,
                username: session.proxy_username,
                password: session.proxy_password,
                ip: session.proxy_ip,
              } : undefined,
            });
            console.log(`[STARTUP] Restored listener for account ${session.account_id}`);
          } else {
            console.warn(`[STARTUP] Skipping restore for account ${session.account_id}: missing credentials (user must reconnect)`);
            await pool.query(
              `UPDATE listener_sessions SET status = 'stopped', stopped_at = NOW() WHERE id = $1`,
              [session.id]
            );
          }
        } catch (err) {
          console.error(`[STARTUP] Failed to restore listener ${session.account_id}: ${err.message}`);
          await pool.query(
            `UPDATE listener_sessions SET status = 'stopped', stopped_at = NOW() WHERE id = $1`,
            [session.id]
          );
        }
      }
      // Clean up any stragglers still marked 'restarting' (e.g. account was deleted)
      await pool.query(`UPDATE listener_sessions SET status = 'stopped', stopped_at = NOW() WHERE status = 'restarting'`);
    }
  } catch (err) {
    console.error('[STARTUP] Listener restore failed:', err.message);
  }

  // ── Graceful Shutdown ────────────────────────────────────────────────────
  async function shutdown(signal) {
    console.log(`[API] ${signal} received. Graceful shutdown...`);

    server.close(() => {
      console.log('[API] HTTP server closed');
    });

    // Mark all active listeners as stopped (they'll be restored on next boot)
    try {
      await pool.query(
        `UPDATE listener_sessions SET status = 'restarting' WHERE status = 'active'`
      );
    } catch {}

    try {
      await pool.end();
      console.log('[API] Database pool closed');
    } catch {}

    // Stop token refresh and queue
    stopTokenRefreshLoop();
    await shutdownQueue().catch(() => {});

    setTimeout(() => process.exit(0), 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('uncaughtException', (err) => {
  console.error('[API] Uncaught exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[API] Unhandled rejection:', reason);
});

start().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});

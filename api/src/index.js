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

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    // Allow Railway domains, localhost, and configured frontend URL
    const allowed = [
      config.cors.origin,
      'https://app.tradevanish.com', 'https://www.tradevanish.com', 'https://web-production-0433b.up.railway.app',
      'https://tradevanish.com',
      'https://www.tradevanish.com',
      'http://localhost:3000',
    ].filter(Boolean);
    if (!origin || allowed.some(a => origin.startsWith(a.replace(/\/$/, '')))) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in production for now (API key auth is the real gate)
    }
  },
  credentials: true,
}));
app.use(morgan(config.isDev ? 'dev' : 'combined'));
app.use(cookieParser());

// Stripe webhook needs raw body - must be before express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.isDev ? 1000 : 600,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT 1');
    const listenerStatus = listenerManager?.getStatus?.() || { activeSessions: 0 };
    const copyStats = copyEngine?.getStats?.() || {};
    res.json({
      status: 'healthy',
      ts: new Date().toISOString(),
      v: '1.0.0',
      db: 'connected',
      listeners: listenerStatus,
      copyEngine: {
        totalSignals: copyStats.totalSignals || 0,
        totalFills: copyStats.totalFills || 0,
        cachedClients: copyStats.cachedClients || 0,
      },
      uptime: Math.floor(process.uptime()),
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
    });
  } catch (err) {
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
app.use('/api/signals', signalRoutes);

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

  // ── Restore active listeners from DB on startup ──────────────────────────
  // If the server restarted, reconnect any listeners that were running
  try {
    const { rows } = await pool.query(
      `SELECT ls.*, a.credentials_encrypted, a.platform, a.broker_account_id
       FROM listener_sessions ls
       JOIN accounts a ON a.id = ls.account_id
       WHERE ls.status = 'active'`
    );
    if (rows.length > 0) {
      console.log(`[STARTUP] Restoring ${rows.length} active listener(s)...`);
      for (const session of rows) {
        try {
          let creds = {};
          try { creds = JSON.parse(session.credentials_encrypted || '{}'); } catch {}
          if (creds.token || creds.loginKey) {
            await listenerManager.startListener({
              userId: session.user_id,
              accountId: session.account_id,
              platform: session.platform,
              brokerAccountId: session.broker_account_id,
              credentials: creds,
            });
            console.log(`[STARTUP] Restored listener for account ${session.account_id}`);
          }
        } catch (err) {
          console.error(`[STARTUP] Failed to restore listener ${session.account_id}: ${err.message}`);
          await pool.query(
            `UPDATE listener_sessions SET status = 'stopped', stopped_at = NOW() WHERE id = $1`,
            [session.id]
          );
        }
      }
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

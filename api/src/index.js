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

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    // Allow Railway domains, localhost, and configured frontend URL
    const allowed = [
      config.cors.origin,
      'https://web-production-0433b.up.railway.app',
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
  max: config.isDev ? 1000 : 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', ts: new Date().toISOString(), v: '1.0.0' });
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
    // Don't exit - DB might not be ready yet on first deploy, Railway will restart
  }

  const port = config.port;
  app.listen(port, '0.0.0.0', () => {
    console.log(`[API] Phantom Copy API listening on port ${port}`);
    console.log(`[API] Env: ${config.nodeEnv} | CORS: ${config.cors.origin}`);
  });
}

start().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});

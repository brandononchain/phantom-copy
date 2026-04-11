import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import { pool } from './db/pool.js';

// Routes
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import tradeRoutes from './routes/trades.js';
import proxyRoutes from './routes/proxies.js';
import billingRoutes from './routes/billing.js';
import proplusRoutes from './routes/proplus.js';

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));
app.use(morgan(config.isDev ? 'dev' : 'combined'));
app.use(cookieParser());

// Raw body for Stripe webhooks (must be before json parser)
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// JSON parser for everything else
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: config.isDev ? 1000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), version: '1.0.0' });
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

// ── Error handler ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(err.status || 500).json({
    error: config.isDev ? err.message : 'Internal server error',
    ...(config.isDev && { stack: err.stack }),
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

async function start() {
  // Run migrations on startup
  try {
    const { pool: dbPool } = await import('./db/pool.js');
    const client = await dbPool.connect();

    // Check if migrations table exists
    const migCheck = await client.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '_migrations')
    `);

    if (!migCheck.rows[0].exists) {
      console.log('[STARTUP] Running initial migrations...');
      client.release();
      // Import and run migrations
      await import('./db/migrate.js');
    } else {
      client.release();
      console.log('[STARTUP] Database ready');
    }
  } catch (err) {
    console.warn('[STARTUP] Migration check skipped:', err.message);
  }

  app.listen(config.port, () => {
    console.log(`[API] Phantom Copy API running on port ${config.port}`);
    console.log(`[API] Environment: ${config.nodeEnv}`);
    console.log(`[API] CORS origin: ${config.cors.origin}`);
  });
}

start();

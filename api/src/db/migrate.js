import pg from 'pg';
import { config } from '../config/index.js';

const migrations = [
  {
    id: '001_initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, name VARCHAR(255), phone VARCHAR(50), plan VARCHAR(20) DEFAULT 'basic' CHECK (plan IN ('basic','pro','proplus')), stripe_customer_id VARCHAR(255), stripe_subscription_id VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS accounts (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, platform VARCHAR(50) NOT NULL, role VARCHAR(20) NOT NULL CHECK (role IN ('master','follower')), broker_account_id VARCHAR(255), label VARCHAR(255), status VARCHAR(50) DEFAULT 'connected', credentials_encrypted TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
      CREATE TABLE IF NOT EXISTS proxy_assignments (id SERIAL PRIMARY KEY, account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE UNIQUE, provider VARCHAR(50) NOT NULL, region VARCHAR(50), ip_address VARCHAR(45), port INTEGER, session_id VARCHAR(255), pool_id INTEGER, proxy_ip_id INTEGER, health VARCHAR(20) DEFAULT 'healthy', last_health_check TIMESTAMPTZ, assigned_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS copy_executions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), master_account_id INTEGER REFERENCES accounts(id), signal_type VARCHAR(50), contract_id VARCHAR(100), side VARCHAR(10), qty INTEGER, master_price DECIMAL(20,8), timestamp TIMESTAMPTZ DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS idx_executions_user ON copy_executions(user_id);
      CREATE INDEX IF NOT EXISTS idx_executions_ts ON copy_executions(timestamp DESC);
      CREATE TABLE IF NOT EXISTS copy_fills (id SERIAL PRIMARY KEY, execution_id INTEGER REFERENCES copy_executions(id) ON DELETE CASCADE, follower_account_id INTEGER REFERENCES accounts(id), fill_price DECIMAL(20,8), slippage_ticks INTEGER DEFAULT 0, latency_ms INTEGER, proxy_ip VARCHAR(45), status VARCHAR(20) DEFAULT 'filled', error_message TEXT, filled_at TIMESTAMPTZ DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS idx_fills_execution ON copy_fills(execution_id);
      CREATE TABLE IF NOT EXISTS proxy_health_log (id SERIAL PRIMARY KEY, account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE, ip_address VARCHAR(45), latency_ms INTEGER, status VARCHAR(20), checked_at TIMESTAMPTZ DEFAULT NOW());
    `,
    down: `DROP TABLE IF EXISTS proxy_health_log, copy_fills, copy_executions, proxy_assignments, accounts, users CASCADE;`,
  },
  {
    id: '002_proplus_features',
    up: `
      CREATE TABLE IF NOT EXISTS proxy_pools (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, provider VARCHAR(50) NOT NULL, region VARCHAR(50), size INTEGER DEFAULT 10, status VARCHAR(20) DEFAULT 'provisioning', created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS proxy_pool_ips (id SERIAL PRIMARY KEY, pool_id INTEGER REFERENCES proxy_pools(id) ON DELETE CASCADE, ip_address VARCHAR(45), port INTEGER, session_id VARCHAR(255), health VARCHAR(20) DEFAULT 'healthy', last_check TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(255), key_hash VARCHAR(64) NOT NULL UNIQUE, key_prefix VARCHAR(30), env VARCHAR(10) DEFAULT 'live' CHECK (env IN ('live','test')), status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW(), last_used_at TIMESTAMPTZ);
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
      CREATE TABLE IF NOT EXISTS webhooks (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, url TEXT NOT NULL, events JSONB NOT NULL DEFAULT '[]', secret VARCHAR(255) NOT NULL, status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS webhook_deliveries (id SERIAL PRIMARY KEY, webhook_id INTEGER REFERENCES webhooks(id) ON DELETE CASCADE, event_type VARCHAR(50), payload TEXT, status VARCHAR(20) DEFAULT 'pending', attempts INTEGER DEFAULT 0, last_attempt_at TIMESTAMPTZ, response_code INTEGER, response_body TEXT);
      CREATE INDEX IF NOT EXISTS idx_wh_deliveries ON webhook_deliveries(webhook_id, last_attempt_at DESC);
    `,
    down: `DROP TABLE IF EXISTS webhook_deliveries, webhooks, api_keys, proxy_pool_ips, proxy_pools CASCADE;`,
  },
  {
    id: '003_sessions_and_risk',
    up: `
      CREATE TABLE IF NOT EXISTS listener_sessions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), account_id INTEGER REFERENCES accounts(id), platform VARCHAR(50), status VARCHAR(20) DEFAULT 'active', proxy_ip VARCHAR(45), started_at TIMESTAMPTZ DEFAULT NOW(), stopped_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS listener_events (id SERIAL PRIMARY KEY, session_id INTEGER REFERENCES listener_sessions(id) ON DELETE CASCADE, event_type VARCHAR(50), message TEXT, timestamp TIMESTAMPTZ DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS idx_listener_events ON listener_events(session_id, timestamp DESC);
      CREATE TABLE IF NOT EXISTS risk_rules (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE, max_qty INTEGER DEFAULT 10, daily_loss_limit DECIMAL(10,2) DEFAULT 500, max_trades_per_day INTEGER DEFAULT 50, trailing_drawdown DECIMAL(10,2), auto_flatten_time TIME, kill_switch BOOLEAN DEFAULT false);
      CREATE TABLE IF NOT EXISTS follower_overrides (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), account_id INTEGER REFERENCES accounts(id), max_qty INTEGER, daily_loss_limit DECIMAL(10,2), size_multiplier DECIMAL(5,2) DEFAULT 1.0, UNIQUE(user_id, account_id));
    `,
    down: `DROP TABLE IF EXISTS follower_overrides, risk_rules, listener_events, listener_sessions CASCADE;`,
  },
];

export async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (id VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`);
    for (const m of migrations) {
      const exists = await client.query('SELECT id FROM _migrations WHERE id = $1', [m.id]);
      if (exists.rows.length === 0) {
        console.log(`[MIGRATE] Running: ${m.id}`);
        await client.query(m.up);
        await client.query('INSERT INTO _migrations (id) VALUES ($1)', [m.id]);
        console.log(`[MIGRATE] Applied: ${m.id}`);
      }
    }
    console.log('[MIGRATE] Complete.');
  } finally {
    client.release();
  }
}

// CLI mode
if (process.argv[1]?.endsWith('migrate.js')) {
  const { Pool } = pg;
  const p = new Pool({ connectionString: config.db.url, ssl: config.db.ssl });
  const dir = process.argv[2] || 'up';
  if (dir === 'up') {
    await runMigrations(p);
  } else {
    const c = await p.connect();
    try {
      for (const m of [...migrations].reverse()) {
        const ex = await c.query('SELECT id FROM _migrations WHERE id = $1', [m.id]);
        if (ex.rows.length > 0) { console.log(`[MIGRATE] Reverting: ${m.id}`); await c.query(m.down); await c.query('DELETE FROM _migrations WHERE id = $1', [m.id]); }
      }
    } finally { c.release(); }
  }
  await p.end();
  process.exit(0);
}

import { pool } from './pool.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const migrations = [
  {
    id: '001_initial_schema',
    up: `
      -- Users
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        phone VARCHAR(50),
        plan VARCHAR(20) DEFAULT 'basic' CHECK (plan IN ('basic', 'pro', 'proplus')),
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Broker accounts
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        platform VARCHAR(50) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('master', 'follower')),
        broker_account_id VARCHAR(255),
        label VARCHAR(255),
        status VARCHAR(50) DEFAULT 'connected',
        credentials_encrypted TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX idx_accounts_user ON accounts(user_id);

      -- Proxy assignments
      CREATE TABLE IF NOT EXISTS proxy_assignments (
        id SERIAL PRIMARY KEY,
        account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE UNIQUE,
        provider VARCHAR(50) NOT NULL,
        region VARCHAR(50),
        ip_address VARCHAR(45),
        port INTEGER,
        session_id VARCHAR(255),
        pool_id INTEGER,
        proxy_ip_id INTEGER,
        health VARCHAR(20) DEFAULT 'healthy',
        last_health_check TIMESTAMPTZ,
        assigned_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Copy executions
      CREATE TABLE IF NOT EXISTS copy_executions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        master_account_id INTEGER REFERENCES accounts(id),
        signal_type VARCHAR(50),
        contract_id VARCHAR(100),
        side VARCHAR(10),
        qty INTEGER,
        master_price DECIMAL(20, 8),
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX idx_executions_user ON copy_executions(user_id);
      CREATE INDEX idx_executions_ts ON copy_executions(timestamp DESC);

      -- Copy fills (per follower)
      CREATE TABLE IF NOT EXISTS copy_fills (
        id SERIAL PRIMARY KEY,
        execution_id INTEGER REFERENCES copy_executions(id) ON DELETE CASCADE,
        follower_account_id INTEGER REFERENCES accounts(id),
        fill_price DECIMAL(20, 8),
        slippage_ticks INTEGER DEFAULT 0,
        latency_ms INTEGER,
        proxy_ip VARCHAR(45),
        status VARCHAR(20) DEFAULT 'filled',
        error_message TEXT,
        filled_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX idx_fills_execution ON copy_fills(execution_id);

      -- Proxy health log
      CREATE TABLE IF NOT EXISTS proxy_health_log (
        id SERIAL PRIMARY KEY,
        account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
        ip_address VARCHAR(45),
        latency_ms INTEGER,
        status VARCHAR(20),
        checked_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
    down: `
      DROP TABLE IF EXISTS proxy_health_log CASCADE;
      DROP TABLE IF EXISTS copy_fills CASCADE;
      DROP TABLE IF EXISTS copy_executions CASCADE;
      DROP TABLE IF EXISTS proxy_assignments CASCADE;
      DROP TABLE IF EXISTS accounts CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `,
  },
  {
    id: '002_proplus_features',
    up: `
      -- Custom proxy pools (Pro+)
      CREATE TABLE IF NOT EXISTS proxy_pools (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        region VARCHAR(50),
        size INTEGER DEFAULT 10,
        status VARCHAR(20) DEFAULT 'provisioning',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Pool IPs
      CREATE TABLE IF NOT EXISTS proxy_pool_ips (
        id SERIAL PRIMARY KEY,
        pool_id INTEGER REFERENCES proxy_pools(id) ON DELETE CASCADE,
        ip_address VARCHAR(45),
        port INTEGER,
        session_id VARCHAR(255),
        health VARCHAR(20) DEFAULT 'healthy',
        last_check TIMESTAMPTZ DEFAULT NOW()
      );

      -- API keys (Pro+)
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255),
        key_hash VARCHAR(64) NOT NULL UNIQUE,
        key_prefix VARCHAR(30),
        env VARCHAR(10) DEFAULT 'live' CHECK (env IN ('live', 'test')),
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      );
      CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

      -- Webhooks (Pro+)
      CREATE TABLE IF NOT EXISTS webhooks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        events JSONB NOT NULL DEFAULT '[]',
        secret VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Webhook deliveries
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id SERIAL PRIMARY KEY,
        webhook_id INTEGER REFERENCES webhooks(id) ON DELETE CASCADE,
        event_type VARCHAR(50),
        payload TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        response_code INTEGER,
        response_body TEXT
      );
      CREATE INDEX idx_wh_deliveries ON webhook_deliveries(webhook_id, last_attempt_at DESC);
    `,
    down: `
      DROP TABLE IF EXISTS webhook_deliveries CASCADE;
      DROP TABLE IF EXISTS webhooks CASCADE;
      DROP TABLE IF EXISTS api_keys CASCADE;
      DROP TABLE IF EXISTS proxy_pool_ips CASCADE;
      DROP TABLE IF EXISTS proxy_pools CASCADE;
    `,
  },
  {
    id: '003_sessions_and_listeners',
    up: `
      -- Active listener sessions
      CREATE TABLE IF NOT EXISTS listener_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        account_id INTEGER REFERENCES accounts(id),
        platform VARCHAR(50),
        status VARCHAR(20) DEFAULT 'active',
        proxy_ip VARCHAR(45),
        started_at TIMESTAMPTZ DEFAULT NOW(),
        stopped_at TIMESTAMPTZ
      );

      -- Listener event log
      CREATE TABLE IF NOT EXISTS listener_events (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES listener_sessions(id) ON DELETE CASCADE,
        event_type VARCHAR(50),
        message TEXT,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX idx_listener_events ON listener_events(session_id, timestamp DESC);

      -- Risk rules per user
      CREATE TABLE IF NOT EXISTS risk_rules (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        max_qty INTEGER DEFAULT 10,
        daily_loss_limit DECIMAL(10, 2) DEFAULT 500,
        max_trades_per_day INTEGER DEFAULT 50,
        trailing_drawdown DECIMAL(10, 2),
        auto_flatten_time TIME,
        kill_switch BOOLEAN DEFAULT false
      );

      -- Follower overrides (Pro/Pro+)
      CREATE TABLE IF NOT EXISTS follower_overrides (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        account_id INTEGER REFERENCES accounts(id),
        max_qty INTEGER,
        daily_loss_limit DECIMAL(10, 2),
        size_multiplier DECIMAL(5, 2) DEFAULT 1.0,
        UNIQUE(user_id, account_id)
      );
    `,
    down: `
      DROP TABLE IF EXISTS follower_overrides CASCADE;
      DROP TABLE IF EXISTS risk_rules CASCADE;
      DROP TABLE IF EXISTS listener_events CASCADE;
      DROP TABLE IF EXISTS listener_sessions CASCADE;
    `,
  },
];

// ── Migration runner ──────────────────────────────────────────────────────

async function run(direction = 'up') {
  const client = await pool.connect();

  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    if (direction === 'up') {
      for (const migration of migrations) {
        const exists = await client.query('SELECT id FROM _migrations WHERE id = $1', [migration.id]);
        if (exists.rows.length === 0) {
          console.log(`[MIGRATE] Running: ${migration.id}`);
          await client.query(migration.up);
          await client.query('INSERT INTO _migrations (id) VALUES ($1)', [migration.id]);
          console.log(`[MIGRATE] Done: ${migration.id}`);
        } else {
          console.log(`[MIGRATE] Skip (already applied): ${migration.id}`);
        }
      }
    } else if (direction === 'down') {
      for (const migration of [...migrations].reverse()) {
        const exists = await client.query('SELECT id FROM _migrations WHERE id = $1', [migration.id]);
        if (exists.rows.length > 0) {
          console.log(`[MIGRATE] Reverting: ${migration.id}`);
          await client.query(migration.down);
          await client.query('DELETE FROM _migrations WHERE id = $1', [migration.id]);
          console.log(`[MIGRATE] Reverted: ${migration.id}`);
        }
      }
    }

    console.log('[MIGRATE] Complete.');
  } finally {
    client.release();
  }

  await pool.end();
}

// Run if called directly
const direction = process.argv[2] || 'up';
run(direction).catch(err => {
  console.error('[MIGRATE] Failed:', err.message);
  process.exit(1);
});

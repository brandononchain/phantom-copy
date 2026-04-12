// ─────────────────────────────────────────────────────────────────────────────
// Phantom Copy: Copy Execution Engine
// ─────────────────────────────────────────────────────────────────────────────
// Receives copy-signal events from master listeners and replicates trades
// across all follower accounts, each through their dedicated proxy IP.
// ─────────────────────────────────────────────────────────────────────────────

import { EventEmitter } from 'events';
import { query } from '../db/pool.js';
import { ProjectXCopyClient } from '../listeners/projectx-listener.js';
import { createProxyAgent } from './proxy-provider.js';

export class CopyEngine extends EventEmitter {
  constructor() {
    super();
    this.activeListeners = new Map(); // sessionId -> listener instance
    this.followerClients = new Map(); // accountId -> CopyClient
    this.stats = { totalSignals: 0, totalFills: 0, totalErrors: 0 };
  }

  // ── Register a master listener ─────────────────────────────────────────

  registerListener(sessionId, listener, masterId) {
    this.activeListeners.set(sessionId, { listener, masterId });

    // Wire up the copy signal from this listener
    listener.on('copy-signal', async (signal) => {
      await this.handleCopySignal(signal, masterId);
    });

    listener.on('bracket-signal', async (signal) => {
      await this.handleBracketSignal(signal, masterId);
    });

    console.log(`[COPY-ENGINE] Registered listener for master account ${masterId} (session: ${sessionId})`);
  }

  // ── Unregister ─────────────────────────────────────────────────────────

  unregisterListener(sessionId) {
    const entry = this.activeListeners.get(sessionId);
    if (entry) {
      entry.listener.removeAllListeners('copy-signal');
      entry.listener.removeAllListeners('bracket-signal');
      this.activeListeners.delete(sessionId);
      console.log(`[COPY-ENGINE] Unregistered listener for session ${sessionId}`);
    }
  }

  // ── Handle Copy Signal ─────────────────────────────────────────────────
  // This is THE core function. When the master opens/closes/scales a position,
  // we replicate across all followers.

  async handleCopySignal(signal, masterId) {
    this.stats.totalSignals++;
    const startTime = Date.now();

    console.log(`[COPY-ENGINE] Signal: ${signal.action} ${signal.side} ${signal.qty} contractId=${signal.contractId}`);

    try {
      // 1. Find the master account row
      const masterResult = await query(
        'SELECT * FROM accounts WHERE id = $1 AND role = $2',
        [masterId, 'master']
      );
      if (masterResult.rows.length === 0) {
        console.error(`[COPY-ENGINE] Master account ${masterId} not found`);
        return;
      }
      const master = masterResult.rows[0];

      // 2. Log the execution
      const execResult = await query(
        `INSERT INTO copy_executions (user_id, master_account_id, signal_type, contract_id, side, qty, master_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [master.user_id, masterId, signal.action, signal.contractId, signal.side, signal.qty, signal.price || 0]
      );
      const executionId = execResult.rows[0].id;

      // 3. Find all follower accounts for this user on the same platform
      const followers = await query(
        `SELECT a.*, pa.ip_address, pa.provider, pa.session_id AS proxy_session
         FROM accounts a
         LEFT JOIN proxy_assignments pa ON pa.account_id = a.id
         WHERE a.user_id = $1 AND a.role = 'follower' AND a.platform = $2 AND a.status = 'connected'`,
        [master.user_id, master.platform]
      );

      if (followers.rows.length === 0) {
        console.log(`[COPY-ENGINE] No followers to replicate to for master ${masterId}`);
        return;
      }

      // 4. Check follower overrides and risk rules
      const riskResult = await query(
        'SELECT * FROM risk_rules WHERE user_id = $1',
        [master.user_id]
      );
      const riskRules = riskResult.rows[0] || {};

      // Kill switch check
      if (riskRules.kill_switch) {
        console.log(`[COPY-ENGINE] Kill switch active for user ${master.user_id}. Skipping.`);
        this.emit('event', { type: 'risk', msg: 'Kill switch active. Trade not copied.' });
        return;
      }

      // 5. Execute on each follower (parallel)
      const results = await Promise.allSettled(
        followers.rows.map(follower => this.executeOnFollower({
          follower,
          signal,
          executionId,
          riskRules,
          userId: master.user_id,
        }))
      );

      // 6. Summarize
      const filled = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      const failed = results.length - filled;

      this.stats.totalFills += filled;
      this.stats.totalErrors += failed;

      const latency = Date.now() - startTime;
      console.log(`[COPY-ENGINE] ${signal.action} replicated: ${filled}/${followers.rows.length} fills, ${latency}ms total`);

      // 7. Emit webhook events
      this.emit('execution-complete', {
        executionId,
        signal,
        filled,
        failed,
        total: followers.rows.length,
        latencyMs: latency,
      });

    } catch (err) {
      this.stats.totalErrors++;
      console.error(`[COPY-ENGINE] Signal handling error:`, err.message);
      this.emit('error', { signal, error: err.message });
    }
  }

  // ── Execute on a single follower ───────────────────────────────────────

  async executeOnFollower({ follower, signal, executionId, riskRules, userId }) {
    const start = Date.now();

    try {
      // Get follower override for qty multiplier
      const overrideResult = await query(
        'SELECT * FROM follower_overrides WHERE user_id = $1 AND account_id = $2',
        [userId, follower.id]
      );
      const override = overrideResult.rows[0] || {};
      const multiplier = override.size_multiplier || 1.0;

      // Apply qty limits
      let adjustedQty = Math.max(1, Math.round(signal.qty * multiplier));
      if (riskRules.max_qty && adjustedQty > riskRules.max_qty) {
        adjustedQty = riskRules.max_qty;
      }
      if (override.max_qty && adjustedQty > override.max_qty) {
        adjustedQty = override.max_qty;
      }

      // Get or create copy client for this follower
      const client = await this.getFollowerClient(follower);

      // Place the order
      const result = await client.placeOrder({
        contractId: signal.contractId,
        side: signal.side,
        qty: adjustedQty,
        orderType: 'Market',
      });

      const latency = Date.now() - start;

      // Log the fill
      await query(
        `INSERT INTO copy_fills (execution_id, follower_account_id, fill_price, slippage_ticks, latency_ms, proxy_ip, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'filled')`,
        [executionId, follower.id, signal.price || 0, 0, latency, follower.ip_address || 'direct']
      );

      console.log(`[COPY-ENGINE] Filled follower ${follower.label || follower.id}: ${signal.side} ${adjustedQty} in ${latency}ms`);

      return { success: true, orderId: result.orderId, latency };

    } catch (err) {
      const latency = Date.now() - start;

      // Log the error
      await query(
        `INSERT INTO copy_fills (execution_id, follower_account_id, latency_ms, proxy_ip, status, error_message)
         VALUES ($1, $2, $3, $4, 'error', $5)`,
        [executionId, follower.id, latency, follower.ip_address || 'direct', err.message]
      );

      console.error(`[COPY-ENGINE] Follower ${follower.id} failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ── Get/Create Follower Client ─────────────────────────────────────────

  async getFollowerClient(follower) {
    if (this.followerClients.has(follower.id)) {
      return this.followerClients.get(follower.id);
    }

    // Decrypt credentials
    let creds;
    try {
      creds = JSON.parse(follower.credentials_encrypted || '{}');
    } catch {
      throw new Error('Invalid follower credentials');
    }

    if (!creds.token) {
      throw new Error('Follower has no active broker token');
    }

    // Build proxy agent from assignment
    const proxyAssignment = await query(
      'SELECT * FROM proxy_assignments WHERE account_id = $1',
      [follower.id]
    );
    const pa = proxyAssignment.rows[0];
    const agent = pa ? createProxyAgent({
      proxyUrl: pa.proxy_url,
      host: pa.host,
      port: pa.port,
      username: pa.proxy_username,
      password: pa.proxy_password,
      simulated: !pa.proxy_url,
    }) : null;

    // Create platform-specific client
    let client;
    if (follower.platform === 'topstepx') {
      client = new ProjectXCopyClient({
        token: creds.token,
        accountId: parseInt(follower.broker_account_id),
        proxyAgent: agent,
      });
    } else {
      throw new Error(`Copy client not implemented for platform: ${follower.platform}`);
    }

    this.followerClients.set(follower.id, client);
    return client;
  }

  // ── Handle Bracket Signal ──────────────────────────────────────────────

  async handleBracketSignal(signal, masterId) {
    // For bracket orders (stops, limits), replicate to followers
    console.log(`[COPY-ENGINE] Bracket: ${signal.action} ${signal.order?.type} ${signal.order?.side} ${signal.order?.qty}`);

    // Same flow as copy signal but for working orders
    // This handles stop loss / take profit replication
    try {
      const master = await query('SELECT * FROM accounts WHERE id = $1', [masterId]);
      if (master.rows.length === 0) return;

      const followers = await query(
        `SELECT a.*, pa.ip_address FROM accounts a
         LEFT JOIN proxy_assignments pa ON pa.account_id = a.id
         WHERE a.user_id = $1 AND a.role = 'follower' AND a.platform = $2 AND a.status = 'connected'`,
        [master.rows[0].user_id, master.rows[0].platform]
      );

      for (const follower of followers.rows) {
        try {
          const client = await this.getFollowerClient(follower);

          if (signal.action === 'NEW_BRACKET') {
            await client.placeOrder({
              contractId: signal.order.contractId,
              side: signal.order.side,
              qty: signal.order.qty,
              orderType: signal.order.type,
              limitPrice: signal.order.limitPrice,
              stopPrice: signal.order.stopPrice,
            });
          } else if (signal.action === 'CANCEL_BRACKET') {
            // Would need to track order mapping between master and follower
            // For now, log it
            console.log(`[COPY-ENGINE] Cancel bracket not yet mapped for follower ${follower.id}`);
          }
        } catch (err) {
          console.error(`[COPY-ENGINE] Bracket replication failed for follower ${follower.id}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`[COPY-ENGINE] Bracket handling error:`, err.message);
    }
  }

  // ── Invalidate Follower Client (on token refresh, etc) ─────────────────

  invalidateClient(accountId) {
    this.followerClients.delete(accountId);
  }

  // ── Stats ──────────────────────────────────────────────────────────────

  getStats() {
    return {
      ...this.stats,
      activeListeners: this.activeListeners.size,
      cachedClients: this.followerClients.size,
    };
  }
}

// Singleton
export const copyEngine = new CopyEngine();

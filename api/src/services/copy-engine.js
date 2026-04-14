// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Copy Execution Engine
// ─────────────────────────────────────────────────────────────────────────────
// Receives copy-signal events from master listeners and replicates trades
// across all follower accounts, each through their dedicated proxy IP.
// ─────────────────────────────────────────────────────────────────────────────

import { EventEmitter } from 'events';
import { query } from '../db/pool.js';
import { ProjectXCopyClient } from '../listeners/projectx-listener.js';
import { createProxyAgent } from './proxy-provider.js';
import { deliverWebhook } from './webhook-delivery.js';

export class CopyEngine extends EventEmitter {
  constructor() {
    super();
    this.activeListeners = new Map(); // sessionId -> listener instance
    this.followerClients = new Map(); // accountId -> CopyClient
    this.stats = { totalSignals: 0, totalFills: 0, totalErrors: 0 };
    
    // Periodic client cache cleanup every 10 minutes
    setInterval(() => this.cleanupStaleClients(), 10 * 60 * 1000);
  }

  // ── Register a master listener ─────────────────────────────────────────

  registerListener(sessionId, listener, masterId) {
    this.activeListeners.set(sessionId, { listener, masterId });

    // Wire up the copy signal from this listener
    listener.on('copy-signal', async (signal) => {
      // Apply copy delay from user's risk rules
      const delayResult = await query(
        'SELECT copy_delay_ms, latency_jitter_ms FROM risk_rules WHERE user_id = (SELECT user_id FROM accounts WHERE id = $1)',
        [masterId]
      ).catch(() => ({ rows: [] }));
      const rules = delayResult.rows[0] || {};
      const baseDelay = parseInt(rules.copy_delay_ms) || 0;
      const jitter = parseInt(rules.latency_jitter_ms) || 0;
      const totalDelay = baseDelay + (jitter > 0 ? Math.floor(Math.random() * jitter) : 0);

      if (totalDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, totalDelay));
      }

      // Try queue first, fall back to inline
      try {
        const { enqueueCopySignal } = await import('./copy-queue.js');
        await enqueueCopySignal(signal, masterId, this);
      } catch {
        await this.handleCopySignal(signal, masterId);
      }
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

      // 3. Find all follower accounts for this user
      //    AND fetch risk rules + overrides + user plan in ONE query batch
      const [followers, riskResult, overridesResult, dailyStats, userResult] = await Promise.all([
        query(
          `SELECT a.*, pa.ip_address, pa.provider, pa.session_id AS proxy_session
           FROM accounts a
           LEFT JOIN proxy_assignments pa ON pa.account_id = a.id
           WHERE a.user_id = $1 AND a.role = 'follower' AND a.status = 'connected'`,
          [master.user_id]
        ),
        query('SELECT * FROM risk_rules WHERE user_id = $1', [master.user_id]),
        query('SELECT * FROM follower_overrides WHERE user_id = $1', [master.user_id]),
        query(
          `SELECT COUNT(*) as trade_count, COALESCE(SUM(master_price), 0) as daily_pnl
           FROM copy_executions WHERE user_id = $1 AND timestamp >= CURRENT_DATE`,
          [master.user_id]
        ),
        query('SELECT plan FROM users WHERE id = $1', [master.user_id]),
      ]);

      // Enforce follower limit by plan
      const userPlan = userResult.rows[0]?.plan || 'basic';
      let activeFollowers = followers.rows;
      if (userPlan === 'basic' && activeFollowers.length > 5) {
        activeFollowers = activeFollowers.slice(0, 5);
        console.log(`[COPY-ENGINE] Basic plan: capping to 5 followers (${followers.rows.length} connected)`);
      }

      if (activeFollowers.length === 0) {
        console.log(`[COPY-ENGINE] No followers to replicate to for master ${masterId}`);
        return;
      }

      // 4. Check risk rules (fetched in batch above)
      const riskRules = riskResult.rows[0] || {};
      const overridesMap = new Map(overridesResult.rows.map(o => [o.account_id, o]));
      const todayStats = dailyStats.rows[0] || { trade_count: 0, daily_pnl: 0 };

      // Kill switch check
      if (riskRules.kill_switch) {
        console.log(`[COPY-ENGINE] Kill switch active for user ${master.user_id}. Skipping.`);
        this.emit('event', { type: 'risk', msg: 'Kill switch active. Trade not copied.' });
        return;
      }

      // Daily loss limit check
      if (riskRules.daily_loss_limit && Math.abs(parseFloat(todayStats.daily_pnl)) >= parseFloat(riskRules.daily_loss_limit)) {
        console.log(`[COPY-ENGINE] Daily loss limit reached ($${todayStats.daily_pnl}). Skipping.`);
        this.emit('event', { type: 'risk', msg: `Daily loss limit reached: $${todayStats.daily_pnl}` });
        return;
      }

      // Max trades per day check
      if (riskRules.max_trades_per_day && parseInt(todayStats.trade_count) >= parseInt(riskRules.max_trades_per_day)) {
        console.log(`[COPY-ENGINE] Max trades/day reached (${todayStats.trade_count}). Skipping.`);
        this.emit('event', { type: 'risk', msg: `Max trades per day reached: ${todayStats.trade_count}` });
        return;
      }

      // 5. Execute on each follower (parallel)
      const results = await Promise.allSettled(
        activeFollowers.map(follower => this.executeOnFollower({
          follower,
          signal,
          executionId,
          riskRules,
          userId: master.user_id,
          override: overridesMap.get(follower.id) || {},
        }))
      );

      // 6. Summarize
      const filled = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      const failed = results.length - filled;

      this.stats.totalFills += filled;
      this.stats.totalErrors += failed;

      const latency = Date.now() - startTime;
      console.log(`[COPY-ENGINE] ${signal.action} replicated: ${filled}/${activeFollowers.length} fills, ${latency}ms total`);

      // 7. Emit webhook events
      this.emit('execution-complete', {
        executionId,
        signal,
        filled,
        failed,
        total: activeFollowers.length,
        latencyMs: latency,
      });

      // 8. Deliver webhooks to user's endpoints
      if (filled > 0) {
        deliverWebhook(master.user_id, 'trade.executed', {
          ticker: signal.contractId, side: signal.side, qty: signal.qty,
          price: signal.price, followerCount: filled, latencyMs: latency,
        }).catch(() => {});
      }
      if (failed > 0) {
        deliverWebhook(master.user_id, 'trade.failed', {
          ticker: signal.contractId, side: signal.side, qty: signal.qty,
          failedCount: failed, totalFollowers: activeFollowers.length,
        }).catch(() => {});
      }

    } catch (err) {
      this.stats.totalErrors++;
      console.error(`[COPY-ENGINE] Signal handling error:`, err.message);
      this.emit('error', { signal, error: err.message });
    }
  }

  // ── Execute on a single follower ───────────────────────────────────────

  async executeOnFollower({ follower, signal, executionId, riskRules, userId, override }) {
    const start = Date.now();

    try {
      // Use pre-fetched override (no DB call needed)
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
    } else if (follower.platform === 'tradovate' || follower.platform === 'ninjatrader') {
      // Tradovate REST API client with undici proxy
      client = {
        async placeOrder({ contractId, side, qty, orderType, limitPrice, stopPrice }) {
          const baseUrl = 'https://demo.tradovateapi.com/v1';
          const body = {
            accountSpec: follower.broker_account_id,
            accountId: parseInt(follower.broker_account_id),
            action: side === 'Buy' ? 'Buy' : 'Sell',
            symbol: contractId,
            orderQty: qty,
            orderType: orderType || 'Market',
            isAutomated: true,
          };
          if (orderType === 'Limit' && limitPrice) body.price = limitPrice;
          if (orderType === 'Stop' && stopPrice) body.stopPrice = stopPrice;

          const fetchOpts = {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          };
          if (agent) fetchOpts.dispatcher = agent;

          const { default: undici } = await import('undici');
          const res = await undici.fetch(`${baseUrl}/order/placeorder`, fetchOpts);
          const data = await res.json();
          if (data.failureReason) throw new Error(data.failureReason);
          return { orderId: data.orderId, platform: 'tradovate' };
        }
      };
    } else if (follower.platform === 'rithmic') {
      // Rithmic placeholder - requires WebSocket protocol
      client = {
        async placeOrder() {
          throw new Error('Rithmic copy execution requires active WebSocket session');
        }
      };
    } else {
      throw new Error(`Unknown platform: ${follower.platform}`);
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

  // ── Client Cache Cleanup (prevents memory leak at scale) ────────────────

  cleanupStaleClients() {
    // Remove clients for accounts that are no longer connected
    const activeAccountIds = new Set();
    for (const [, session] of this.activeListeners) {
      activeAccountIds.add(session.masterId);
    }
    
    let cleaned = 0;
    for (const [accountId] of this.followerClients) {
      // Keep clients that were used recently (rely on invalidateClient for explicit removal)
      // But cap total cached clients at 500 to prevent unbounded growth
      if (this.followerClients.size > 500) {
        this.followerClients.delete(accountId);
        cleaned++;
      }
    }
    if (cleaned > 0) console.log(`[COPY-ENGINE] Cleaned ${cleaned} stale clients`);
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

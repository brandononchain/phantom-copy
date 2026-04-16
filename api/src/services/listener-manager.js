// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Listener Manager
// ─────────────────────────────────────────────────────────────────────────────
// Manages the lifecycle of master account WebSocket listeners.
// Starts/stops SignalR connections, stores session state in DB,
// and wires listeners to the copy execution engine.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/pool.js';
import { ProjectXMasterListener } from '../listeners/projectx-listener.js';
import { TradovateMasterListener } from '../listeners/tradovate-listener.js';
import { RithmicMasterListener } from '../listeners/rithmic-listener.js';
import { assignProxy, createProxyAgent, checkProxyHealth } from './proxy-provider.js';
import { copyEngine } from './copy-engine.js';

class ListenerManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> { listener, dbSessionId, accountId, userId }
  }

  // ── Start a master listener ────────────────────────────────────────────

  async startListener({ userId, accountId, platform, credentials, proxyAssignment }) {
    // Check if already running
    const existing = this.findSession(accountId);
    if (existing) {
      return { error: 'Listener already running for this account', sessionId: existing.sessionId };
    }

    // Get proxy config
    let proxyConfig;
    if (proxyAssignment && proxyAssignment.proxyUrl) {
      // Real proxy
      proxyConfig = {
        host: proxyAssignment.host,
        port: proxyAssignment.port,
        username: proxyAssignment.username,
        password: proxyAssignment.password,
      };
    } else {
      // No proxy configured, use direct connection
      proxyConfig = null;
    }

    // Create DB session
    const sessionResult = await query(
      `INSERT INTO listener_sessions (user_id, account_id, platform, status, proxy_ip)
       VALUES ($1, $2, $3, 'starting', $4) RETURNING id`,
      [userId, accountId, platform, proxyAssignment?.ip || 'direct']
    );
    const dbSessionId = sessionResult.rows[0].id;
    const sessionId = `session_${dbSessionId}_${Date.now()}`;

    // Create platform-specific listener
    let listener;

    if (platform === 'topstepx') {
      listener = new ProjectXMasterListener({
        username: credentials.username,
        apiKey: credentials.apiKey,
        accountId: parseInt(credentials.brokerAccountId),
        proxyConfig: proxyConfig || { host: 'direct', port: 0, username: '', password: '' },
        db: { query },
      });
    } else if (platform === 'tradovate' || platform === 'ninjatrader') {
      listener = new TradovateMasterListener({
        accessToken: credentials.token,
        userId: parseInt(credentials.userId || credentials.brokerAccountId),
        accountId: parseInt(credentials.brokerAccountId),
        proxyConfig: proxyConfig || { host: 'direct', port: 0, username: '', password: '' },
        db: { query },
      });
    } else if (platform === 'rithmic') {
      listener = new RithmicMasterListener({
        username: credentials.username,
        password: credentials.password,
        fcmId: credentials.fcmId || '',
        ibId: credentials.ibId || '',
        environment: credentials.environment || 'Rithmic Paper Trading',
        accountId: credentials.brokerAccountId,
        proxyConfig: proxyConfig || { host: 'direct', port: 0, username: '', password: '' },
        db: { query },
      });
    } else {
      await query('UPDATE listener_sessions SET status = $1 WHERE id = $2', ['error', dbSessionId]);
      throw new Error(`Platform ${platform} listener not implemented yet`);
    }

    // Store session
    this.sessions.set(sessionId, {
      listener,
      dbSessionId,
      accountId,
      userId,
      platform,
      startedAt: new Date(),
    });

    // Wire up event logging
    listener.on('stage', async (stage) => {
      await this.logEvent(dbSessionId, 'stage', `Listener stage: ${stage}`);
    });

    listener.on('event', async (evt) => {
      await this.logEvent(dbSessionId, evt.type, evt.msg);
    });

    listener.on('proxy-verified', async ({ ip }) => {
      await query('UPDATE listener_sessions SET proxy_ip = $1 WHERE id = $2', [ip, dbSessionId]);
      await this.logEvent(dbSessionId, 'proxy', `Proxy verified: ${ip}`);
    });

    listener.on('ready', async () => {
      await query('UPDATE listener_sessions SET status = $1 WHERE id = $2', ['active', dbSessionId]);
      await this.logEvent(dbSessionId, 'sys', 'Listener ready and actively monitoring');
    });

    listener.on('error', async ({ stage, error }) => {
      await this.logEvent(dbSessionId, 'error', `Error in ${stage}: ${error}`);
    });

    listener.on('stopped', async ({ reason }) => {
      await query(
        'UPDATE listener_sessions SET status = $1, stopped_at = NOW() WHERE id = $2',
        ['stopped', dbSessionId]
      );
      await this.logEvent(dbSessionId, 'sys', `Listener stopped: ${reason}`);
      this.sessions.delete(sessionId);
    });

    // Register with copy engine
    copyEngine.registerListener(sessionId, listener, accountId);

    // Start the listener (async, don't await - it runs in background)
    listener.start().catch(err => {
      console.error(`[LISTENER-MGR] Start failed for session ${sessionId}:`, err.message);
    });

    console.log(`[LISTENER-MGR] Started ${platform} listener for account ${accountId} (session: ${sessionId})`);

    return {
      sessionId,
      dbSessionId,
      status: 'starting',
    };
  }

  // ── Stop a listener ────────────────────────────────────────────────────

  async stopListener(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      // Try to find by accountId
      return { error: 'Session not found' };
    }

    session.listener.stop();
    copyEngine.unregisterListener(sessionId);
    this.sessions.delete(sessionId);

    await query(
      'UPDATE listener_sessions SET status = $1, stopped_at = NOW() WHERE id = $2',
      ['stopped', session.dbSessionId]
    );

    return { success: true };
  }

  // ── Stop by account ID ─────────────────────────────────────────────────

  async stopByAccount(accountId) {
    const session = this.findSession(accountId);
    if (session) {
      return this.stopListener(session.sessionId);
    }
    return { error: 'No active listener for this account' };
  }

  // ── Get active sessions for a user ─────────────────────────────────────

  getActiveSessions(userId) {
    const result = [];
    for (const [sessionId, session] of this.sessions) {
      if (session.userId === userId) {
        result.push({
          sessionId,
          accountId: session.accountId,
          platform: session.platform,
          startedAt: session.startedAt,
          connected: session.listener?.connected || false,
          positions: session.listener?.positions?.size || 0,
          openOrders: session.listener?.openOrders?.size || 0,
        });
      }
    }
    return result;
  }

  // ── Get session events from DB ─────────────────────────────────────────

  async getSessionEvents(dbSessionId, limit = 50) {
    const result = await query(
      'SELECT * FROM listener_events WHERE session_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [dbSessionId, limit]
    );
    return result.rows;
  }

  // ── Find session by account ID ─────────────────────────────────────────

  findSession(accountId) {
    for (const [sessionId, session] of this.sessions) {
      if (session.accountId === accountId) {
        return { sessionId, ...session };
      }
    }
    return null;
  }

  // ── Log event ──────────────────────────────────────────────────────────

  async logEvent(dbSessionId, type, message) {
    try {
      await query(
        'INSERT INTO listener_events (session_id, event_type, message) VALUES ($1, $2, $3)',
        [dbSessionId, type, message]
      );
    } catch (err) {
      console.error(`[LISTENER-MGR] Failed to log event:`, err.message);
    }
  }

  // ── Status summary ─────────────────────────────────────────────────────

  getStatus() {
    return {
      activeSessions: this.sessions.size,
      copyEngineStats: copyEngine.getStats(),
      sessions: Array.from(this.sessions.entries()).map(([id, s]) => ({
        sessionId: id,
        accountId: s.accountId,
        platform: s.platform,
        connected: s.listener?.connected || false,
      })),
    };
  }
}

// Singleton
export const listenerManager = new ListenerManager();

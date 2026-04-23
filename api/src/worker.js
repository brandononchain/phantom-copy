// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Dedicated BullMQ Worker
// ─────────────────────────────────────────────────────────────────────────────
// Entry point for the standalone Worker Railway service.
// Consumes the `copy-execution` queue and runs follower trade replication.
// The API service emits signals via listener-manager → copy-engine →
// enqueueCopySignal(), and this process picks them up.
//
// Deployment (Railway):
//   1) In Railway dashboard, create a new service from the same repo.
//   2) Set Root Directory: api
//   3) Set Start Command:  node src/worker.js
//   4) Set env vars: DATABASE_URL, REDIS_URL, ENCRYPTION_KEY, and any
//      proxy / broker credentials that the copy engine needs.
//   5) Set SERVICE_ROLE=worker on THIS service (optional; informational).
//   6) Set SERVICE_ROLE=api on the existing API service so it stops running
//      the worker in-process.
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import { pool } from './db/pool.js';
import { copyEngine } from './services/copy-engine.js';
import { initRedis, startWorker, shutdownQueue, getQueueStats } from './services/copy-queue.js';

const PORT = parseInt(process.env.PORT || '3002', 10);

// Minimal /healthz so Railway can keep this service alive without needing a
// full Express stack. Returns queue stats so you can curl it for diagnostics.
const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz' || req.url === '/api/health') {
    try {
      await pool.query('SELECT 1');
      const queue = await getQueueStats().catch(() => ({ mode: 'unknown' }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        role: 'worker',
        uptime: Math.floor(process.uptime()),
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
        queue,
      }));
    } catch (err) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy', error: err.message }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

async function main() {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[WORKER] healthz listening on ${PORT}`);
  });

  const ok = initRedis();
  if (!ok) {
    console.error('[WORKER] REDIS_URL is required for the worker role. Exiting.');
    process.exit(1);
  }

  // BullMQ Worker pulls jobs and calls copyEngine.handleCopySignal()
  startWorker(copyEngine);
  console.log('[WORKER] Ready. Consuming queue: copy-execution');
}

async function shutdown(signal) {
  console.log(`[WORKER] ${signal} received, shutting down...`);
  try { await shutdownQueue(); } catch {}
  try { await pool.end(); } catch {}
  server.close(() => process.exit(0));
  // Hard exit if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[WORKER] unhandledRejection:', reason);
});

main().catch(err => {
  console.error('[WORKER] Fatal startup error:', err);
  process.exit(1);
});

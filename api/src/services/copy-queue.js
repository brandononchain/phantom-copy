// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Copy Execution Queue (BullMQ + Redis)
// ─────────────────────────────────────────────────────────────────────────────
// Decouples signal receipt from execution. Enables horizontal scaling:
// multiple API instances can enqueue signals, worker processes dequeue.
//
// If REDIS_URL is not set, falls back to direct inline execution.
// ─────────────────────────────────────────────────────────────────────────────

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
let connection = null;
let copyQueue = null;
let copyWorker = null;
let isRedisAvailable = false;

// ── Initialize Redis ─────────────────────────────────────────────────────────

export function initRedis() {
  if (!REDIS_URL) {
    console.log('[QUEUE] No REDIS_URL set. Using inline execution (single-process mode).');
    return false;
  }

  try {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    connection.on('connect', () => {
      console.log('[QUEUE] Redis connected');
      isRedisAvailable = true;
    });
    connection.on('error', (err) => {
      console.error('[QUEUE] Redis error:', err.message);
      isRedisAvailable = false;
    });
    connection.on('close', () => {
      isRedisAvailable = false;
    });

    connection.connect().catch(() => {
      console.log('[QUEUE] Redis unavailable, falling back to inline execution');
    });

    // Create the queue
    copyQueue = new Queue('copy-execution', {
      connection: { ...parseRedisUrl(REDIS_URL) },
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
        attempts: 2,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });

    console.log('[QUEUE] Copy execution queue initialized');
    return true;
  } catch (err) {
    console.error('[QUEUE] Init failed:', err.message);
    return false;
  }
}

// ── Start the Worker ─────────────────────────────────────────────────────────
// Call this from index.js AFTER copyEngine is available

export function startWorker(copyEngine) {
  if (!REDIS_URL || !connection) return;

  copyWorker = new Worker(
    'copy-execution',
    async (job) => {
      const { signal, masterId, timestamp } = job.data;
      const queueLatency = Date.now() - timestamp;

      console.log(`[QUEUE] Processing signal: ${signal.action} ${signal.side} ${signal.qty} (queue latency: ${queueLatency}ms)`);

      await copyEngine.handleCopySignal(signal, masterId);
    },
    {
      connection: { ...parseRedisUrl(REDIS_URL) },
      concurrency: 10, // Process up to 10 signals in parallel
      limiter: {
        max: 50,
        duration: 1000, // Max 50 signals per second
      },
    }
  );

  copyWorker.on('completed', (job) => {
    const totalMs = Date.now() - job.data.timestamp;
    if (totalMs > 500) {
      console.warn(`[QUEUE] Slow execution: ${totalMs}ms for job ${job.id}`);
    }
  });

  copyWorker.on('failed', (job, err) => {
    console.error(`[QUEUE] Job ${job?.id} failed: ${err.message}`);
  });

  console.log('[QUEUE] Worker started (concurrency: 10)');
}

// ── Enqueue a copy signal ────────────────────────────────────────────────────
// If Redis is available, enqueue. Otherwise, execute inline.

export async function enqueueCopySignal(signal, masterId, copyEngine) {
  if (isRedisAvailable && copyQueue) {
    await copyQueue.add(
      `copy-${signal.action}-${Date.now()}`,
      { signal, masterId, timestamp: Date.now() },
      { priority: signal.action === 'CLOSE' ? 1 : 2 } // Closes get priority
    );
    return { queued: true };
  }

  // Inline fallback (no Redis)
  await copyEngine.handleCopySignal(signal, masterId);
  return { queued: false, inline: true };
}

// ── Queue stats ──────────────────────────────────────────────────────────────

export async function getQueueStats() {
  if (!copyQueue) return { mode: 'inline', redis: false };
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      copyQueue.getWaitingCount(),
      copyQueue.getActiveCount(),
      copyQueue.getCompletedCount(),
      copyQueue.getFailedCount(),
    ]);
    return { mode: 'queue', redis: true, waiting, active, completed, failed };
  } catch {
    return { mode: 'inline', redis: false };
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export async function shutdownQueue() {
  if (copyWorker) await copyWorker.close();
  if (copyQueue) await copyQueue.close();
  if (connection) await connection.quit();
}

// ── Redis URL parser ─────────────────────────────────────────────────────────

function parseRedisUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: parseInt(u.port) || 6379,
      password: u.password || undefined,
      username: u.username || undefined,
      tls: u.protocol === 'rediss:' ? {} : undefined,
    };
  } catch {
    return { host: '127.0.0.1', port: 6379 };
  }
}

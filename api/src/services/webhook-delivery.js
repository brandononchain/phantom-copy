// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Webhook Delivery Service with Retry
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import { query } from '../db/pool.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 30000, 120000]; // 5s, 30s, 2min

export async function deliverWebhook(userId, event, data) {
  // Find all active webhooks for this user that subscribe to this event
  const result = await query(
    `SELECT * FROM webhooks WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );

  for (const webhook of result.rows) {
    const events = typeof webhook.events === 'string' ? JSON.parse(webhook.events) : webhook.events;
    if (!events.includes(event)) continue;

    // Fire and forget with retry
    deliverToEndpoint(webhook, event, data).catch(err => {
      console.error(`[WEBHOOK] Delivery failed for ${webhook.url}: ${err.message}`);
    });
  }
}

async function deliverToEndpoint(webhook, event, data, attempt = 0) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event, timestamp, data });
  const signature = crypto
    .createHmac('sha256', webhook.secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tradevanish-Signature': signature,
        'X-Tradevanish-Event': event,
        'X-Tradevanish-Timestamp': String(timestamp),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    // Log delivery
    await query(
      `INSERT INTO webhook_deliveries (webhook_id, event, status, response_code, last_attempt_at, attempts)
       VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [webhook.id, event, response.ok ? 'delivered' : 'failed', response.status, attempt + 1]
    );

    if (!response.ok && attempt < MAX_RETRIES) {
      console.log(`[WEBHOOK] Retry ${attempt + 1}/${MAX_RETRIES} for ${webhook.url} (got ${response.status})`);
      setTimeout(() => deliverToEndpoint(webhook, event, data, attempt + 1), RETRY_DELAYS[attempt]);
    }
  } catch (err) {
    await query(
      `INSERT INTO webhook_deliveries (webhook_id, event, status, response_code, last_attempt_at, attempts)
       VALUES ($1, $2, 'error', 0, NOW(), $3)`,
      [webhook.id, event, attempt + 1]
    ).catch(() => {});

    if (attempt < MAX_RETRIES) {
      console.log(`[WEBHOOK] Retry ${attempt + 1}/${MAX_RETRIES} for ${webhook.url}: ${err.message}`);
      setTimeout(() => deliverToEndpoint(webhook, event, data, attempt + 1), RETRY_DELAYS[attempt]);
    } else {
      console.error(`[WEBHOOK] All retries exhausted for ${webhook.url}`);
    }
  }
}

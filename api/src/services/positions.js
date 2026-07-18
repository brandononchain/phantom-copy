// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Position tracking + position-aware order computation
// ─────────────────────────────────────────────────────────────────────────────
// Copy trading needs CLOSE and REVERSE to act on the ACTUAL position, not fire a
// guessed-side market order. We keep a per-account/per-contract net-position
// ledger (updated on every fill we place) and, for the master where the trader
// may also act manually, reconcile against the broker's live position when
// available. The core order math (computeTargetOrder) is a pure function so it
// can be exhaustively unit-tested without a broker.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../db/pool.js';

// ── Pure order math ──────────────────────────────────────────────────────────
// Given the current signed net position and the incoming signal, return the
// single order { side, qty } that moves the account to the intended position,
// or null when it's already there (no-op).
//   net  : signed current position (>0 long, <0 short, 0 flat)
//   action: 'OPEN' | 'CLOSE' | 'REVERSE' (anything else treated as OPEN)
//   side : 'Buy' | 'Sell' — the signal's direction
//   qty  : positive size from the signal
export function computeTargetOrder(action, net, side, qty) {
  const n = Number(net) || 0;
  const q = Math.max(0, Math.round(Number(qty) || 0));
  const signed = side === 'Buy' ? q : -q;

  let targetNet;
  if (action === 'CLOSE') {
    targetNet = 0;                 // flatten to zero
  } else if (action === 'REVERSE') {
    targetNet = signed;            // flip to the new position
  } else {
    targetNet = n + signed;        // OPEN / default: additive (pyramiding-safe)
  }

  const delta = targetNet - n;
  if (delta === 0) return null;    // already at target — no order
  return { side: delta > 0 ? 'Buy' : 'Sell', qty: Math.abs(delta) };
}

// ── Ledger ───────────────────────────────────────────────────────────────────

export async function getLedgerPosition(accountId, contractId) {
  const r = await query(
    'SELECT net_qty FROM positions WHERE account_id = $1 AND contract_id = $2',
    [accountId, contractId]
  );
  return r.rows[0] ? Number(r.rows[0].net_qty) : 0;
}

// Apply a filled order to the ledger. side/qty describe the order that filled.
export async function applyFill(accountId, contractId, side, qty) {
  const delta = (side === 'Buy' ? 1 : -1) * Math.abs(Math.round(Number(qty) || 0));
  if (delta === 0) return;
  await query(
    `INSERT INTO positions (account_id, contract_id, net_qty, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (account_id, contract_id)
     DO UPDATE SET net_qty = positions.net_qty + $3, updated_at = NOW()`,
    [accountId, contractId, delta]
  );
}

// Overwrite the ledger to a known net (used when the broker is authoritative).
export async function setLedgerPosition(accountId, contractId, net) {
  await query(
    `INSERT INTO positions (account_id, contract_id, net_qty, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (account_id, contract_id)
     DO UPDATE SET net_qty = $3, updated_at = NOW()`,
    [accountId, contractId, Math.round(Number(net) || 0)]
  );
}

// ── Broker position lookup (best-effort, authoritative for the master) ────────
// Returns a signed net position for the contract, or null when it can't be
// determined confidently — callers MUST fall back to the ledger on null so an
// unreachable/limited broker never produces a wrong flatten.
export async function getBrokerPosition(platform, creds, brokerAccountId, contractId, opts = {}) {
  try {
    if (platform === 'topstepx') {
      const r = await fetch('https://api.topstepx.com/api/Position/searchOpen', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${creds.token}`, 'Content-Type': 'application/json', 'Accept': 'text/plain' },
        body: JSON.stringify({ accountId: parseInt(brokerAccountId) }),
      });
      if (!r.ok) return null;
      const data = await r.json().catch(() => null);
      const list = data?.positions || (Array.isArray(data) ? data : null);
      if (!Array.isArray(list)) return null;
      // ProjectX: type 1 = Long, 2 = Short; size is unsigned. Match by contractId.
      // No matching position = flat (0), which is itself authoritative.
      let net = 0;
      for (const p of list) {
        const pid = String(p.contractId ?? p.contractCode ?? p.symbol ?? '');
        if (pid && contractId && !pid.includes(contractId) && !contractId.includes(pid)) continue;
        const size = Math.abs(Number(p.size ?? p.netPos ?? p.quantity ?? 0));
        const dir = (p.type === 2 || p.side === 'Sell' || Number(p.netPos) < 0) ? -1 : 1;
        net += dir * size;
      }
      return net;
    }

    if (platform === 'tradovate' || platform === 'ninjatrader') {
      const isLive = creds.isLive === true || creds.environment === 'live';
      const base = isLive ? 'https://live.tradovateapi.com/v1' : 'https://demo.tradovateapi.com/v1';
      // Tradovate positions key by numeric contractId, so resolve our symbol
      // (e.g. ESU26) to Tradovate's contract id first. If we can't resolve it we
      // return null so the caller safely falls back to the ledger.
      const brokerContractId = opts.brokerContractId ?? await resolveTradovateContractId(base, creds.token, contractId);
      if (brokerContractId == null) return null;
      const r = await fetch(`${base}/position/list`, {
        headers: { 'Authorization': `Bearer ${creds.token}` },
      });
      if (!r.ok) return null;
      const list = await r.json().catch(() => null);
      if (!Array.isArray(list)) return null;
      const acct = parseInt(brokerAccountId);
      let net = 0;
      for (const p of list) {
        if (Number(p.contractId) !== Number(brokerContractId)) continue;
        if (!Number.isNaN(acct) && p.accountId != null && Number(p.accountId) !== acct) continue;
        net += Number(p.netPos ?? 0);
      }
      return net; // no matching position = flat
    }
  } catch {
    return null;
  }
  return null;
}

// ── Tradovate symbol → numeric contract id ────────────────────────────────────
// Positions and orders from /position/list reference a numeric contractId, but
// we work in symbols (ESU26). Resolve via /contract/find and cache the mapping
// (a contract name always maps to the same id). Never caches failures.
const _tvContractCache = new Map(); // name -> numeric id

export async function resolveTradovateContractId(base, token, name) {
  if (!name) return null;
  if (_tvContractCache.has(name)) return _tvContractCache.get(name);
  try {
    const r = await fetch(`${base}/contract/find?name=${encodeURIComponent(name)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    const id = data?.id ?? (Array.isArray(data) ? data[0]?.id : null);
    if (id != null) { _tvContractCache.set(name, id); return id; }
    return null;
  } catch {
    return null;
  }
}

// Test/ops helper: clear the contract-id cache.
export function _clearTradovateContractCache() { _tvContractCache.clear(); }

// Resolve the net position to act on: broker-authoritative when available
// (reconciling the ledger), otherwise the ledger. Followers pass
// preferBroker=false (we're the only actor on them, so the ledger is exact).
export async function resolveNetPosition({ accountId, contractId, platform, creds, brokerAccountId, preferBroker }) {
  const ledger = await getLedgerPosition(accountId, contractId);
  if (!preferBroker) return ledger;
  const broker = await getBrokerPosition(platform, creds, brokerAccountId, contractId);
  if (broker === null || Number.isNaN(broker)) return ledger;
  if (broker !== ledger) {
    // Broker wins; correct the ledger so future signals stay consistent.
    await setLedgerPosition(accountId, contractId, broker).catch(() => {});
  }
  return broker;
}

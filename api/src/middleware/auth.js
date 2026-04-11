import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import crypto from 'crypto';

// ── JWT Auth (dashboard sessions) ────────────────────────────────────────────

export function authRequired(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'auth_required', message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', message: 'Token expired or invalid' });
  }
}

// ── API Key Auth (Pro+ programmatic access) ──────────────────────────────────

export async function apiKeyAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer pc_')) {
    return res.status(401).json({ error: 'missing_api_key', message: 'Provide API key as Bearer token' });
  }

  const rawKey = authHeader.slice(7);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  try {
    const result = await query(
      `SELECT ak.*, u.plan FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
       WHERE ak.key_hash = $1 AND ak.status = 'active'`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'invalid_api_key', message: 'API key is invalid or revoked' });
    }

    const key = result.rows[0];

    if (key.plan !== 'proplus') {
      return res.status(403).json({ error: 'plan_required', message: 'API access requires Pro+ plan' });
    }

    // Update last used
    await query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [key.id]);

    req.user = { id: key.user_id, plan: key.plan };
    req.apiKey = { id: key.id, env: key.env };
    next();
  } catch (err) {
    return res.status(500).json({ error: 'auth_error', message: 'Authentication failed' });
  }
}

// ── Combined auth (accepts either JWT or API key) ────────────────────────────

export async function flexAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';

  if (authHeader.startsWith('Bearer pc_')) {
    return apiKeyAuth(req, res, next);
  }

  return authRequired(req, res, next);
}

// ── Plan gating ──────────────────────────────────────────────────────────────

const PLAN_FEATURES = {
  basic:   { maxFollowers: 5,  providers: ['brightdata'], overrides: false, customPools: false, api: false, webhooks: false },
  pro:     { maxFollowers: Infinity, providers: ['brightdata','oxylabs','smartproxy','iproyal'], overrides: true, customPools: false, api: false, webhooks: false },
  proplus: { maxFollowers: Infinity, providers: ['brightdata','oxylabs','smartproxy','iproyal'], overrides: true, customPools: true, api: true, webhooks: true },
};

export function requirePlan(feature) {
  return async (req, res, next) => {
    // Fetch fresh plan from DB
    const result = await query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
    const plan = result.rows[0]?.plan || 'basic';
    const features = PLAN_FEATURES[plan];

    if (!features?.[feature]) {
      return res.status(403).json({
        error: 'plan_required',
        message: `This feature requires Pro+. Current plan: ${plan}`,
        upgrade_url: '/api/billing/plans',
      });
    }

    req.user.plan = plan;
    req.planFeatures = features;
    next();
  };
}

export function requirePro(req, res, next) {
  const plan = req.user?.plan;
  if (plan === 'basic') {
    return res.status(403).json({ error: 'pro_required', message: 'Pro or Pro+ plan required' });
  }
  next();
}

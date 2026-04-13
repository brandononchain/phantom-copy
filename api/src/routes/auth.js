import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { authRequired } from '../middleware/auth.js';
import { sendWelcomeEmail, sendPasswordResetEmail, sendPasswordChangedEmail, send2FASetupEmail, send2FADisabledEmail } from '../services/email.js';

const router = Router();

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, plan: user.plan || 'basic' }, config.jwt.secret, { expiresIn: '7d' });
}

function setTokenCookie(res, token) {
  res.cookie('token', token, { httpOnly: true, secure: !config.isDev, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
}

// ── Register ─────────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (exists.rows.length > 0) return res.status(409).json({ error: 'An account with this email already exists' });

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (email, password_hash, name, plan) VALUES ($1, $2, $3, $4) RETURNING id, email, name, plan',
      [email.toLowerCase().trim(), hash, name || null, 'basic']
    );
    const user = result.rows[0];
    const token = signToken(user);
    setTokenCookie(res, token);

    // Send welcome email (non-blocking)
    sendWelcomeEmail(user.email, user.name).catch(() => {});

    res.status(201).json({ user, token });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── Login ────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password, totp_code } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await query(
      'SELECT id, email, name, plan, password_hash, totp_secret, totp_enabled FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // 2FA check
    if (user.totp_enabled && user.totp_secret) {
      if (!totp_code) {
        return res.status(200).json({ requires_2fa: true, message: 'Enter your 2FA code' });
      }
      const verified = speakeasy.totp.verify({
        secret: user.totp_secret,
        encoding: 'base32',
        token: totp_code,
        window: 1,
      });
      if (!verified) return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    const token = signToken(user);
    setTokenCookie(res, token);
    res.json({ user: { id: user.id, email: user.email, name: user.name, plan: user.plan }, token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Me ───────────────────────────────────────────────────────────────────────

router.get('/me', authRequired, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, name, phone, plan, stripe_customer_id, totp_enabled, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    // Return a fresh token so the frontend can store it in localStorage
    const freshToken = signToken(result.rows[0]);
    res.json({ user: result.rows[0], token: freshToken });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── Update profile ───────────────────────────────────────────────────────────

router.patch('/me', authRequired, async (req, res) => {
  const { name, phone } = req.body;
  try {
    const result = await query(
      'UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone) WHERE id = $3 RETURNING id, email, name, phone, plan',
      [name, phone, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ── Logout ───────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// ── Password Reset Request ───────────────────────────────────────────────────

router.post('/reset-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const user = await query('SELECT id, email FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    // Always return success to prevent email enumeration
    if (user.rows.length === 0) {
      return res.json({ success: true, message: 'If that email is registered, a reset code has been sent.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000);

    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(10), ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ`).catch(() => {});
    await query('UPDATE users SET reset_code = $1, reset_expires = $2 WHERE id = $3', [code, expiry, user.rows[0].id]);

    // Send reset email
    await sendPasswordResetEmail(user.rows[0].email, code);

    res.json({ success: true, message: 'If that email is registered, a reset code has been sent.' });
  } catch (err) {
    res.status(500).json({ error: 'Reset request failed' });
  }
});

// ── Password Reset Confirm ───────────────────────────────────────────────────

router.post('/reset-password/confirm', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ error: 'Email, code, and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const user = await query('SELECT id, reset_code, reset_expires FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (user.rows.length === 0) return res.status(400).json({ error: 'Invalid reset request' });

    const u = user.rows[0];
    if (!u.reset_code || u.reset_code !== code) return res.status(400).json({ error: 'Invalid or expired reset code' });
    if (new Date(u.reset_expires) < new Date()) return res.status(400).json({ error: 'Reset code has expired. Request a new one.' });

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1, reset_code = NULL, reset_expires = NULL WHERE id = $2', [hash, u.id]);

    res.json({ success: true, message: 'Password has been reset. You can now sign in.' });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// ── Change Password (authenticated) ─────────────────────────────────────────

router.post('/change-password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const user = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    const u = await query('SELECT email, name FROM users WHERE id = $1', [req.user.id]); sendPasswordChangedEmail(u.rows[0].email, u.rows[0].name).catch(() => {}); res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Password change failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2FA (TOTP)
// ═══════════════════════════════════════════════════════════════════════════════

// Step 1: Generate a TOTP secret and QR code
router.post('/2fa/setup', authRequired, async (req, res) => {
  try {
    const user = await query('SELECT email, totp_enabled FROM users WHERE id = $1', [req.user.id]);
    if (user.rows[0].totp_enabled) return res.status(400).json({ error: '2FA is already enabled' });

    const secret = speakeasy.generateSecret({
      name: `Tradevanish (${user.rows[0].email})`,
      issuer: 'Tradevanish',
    });

    // Store the secret temporarily (not enabled yet until verified)
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255), ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false`).catch(() => {});
    await query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret.base32, req.user.id]);

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

    res.json({
      secret: secret.base32,
      qrCode: qrDataUrl,
      message: 'Scan the QR code with your authenticator app, then verify with a code',
    });
  } catch (err) {
    res.status(500).json({ error: '2FA setup failed' });
  }
});

// Step 2: Verify the TOTP code and enable 2FA
router.post('/2fa/verify', authRequired, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Verification code required' });

  try {
    const user = await query('SELECT email, name, totp_secret, totp_enabled FROM users WHERE id = $1', [req.user.id]);
    if (user.rows[0].totp_enabled) return res.status(400).json({ error: '2FA is already enabled' });
    if (!user.rows[0].totp_secret) return res.status(400).json({ error: 'Call /2fa/setup first' });

    const verified = speakeasy.totp.verify({
      secret: user.rows[0].totp_secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!verified) return res.status(400).json({ error: 'Invalid code. Try again.' });

    await query('UPDATE users SET totp_enabled = true WHERE id = $1', [req.user.id]);

    // Send confirmation email
    send2FASetupEmail(user.rows[0].email, user.rows[0].name).catch(() => {});

    res.json({ success: true, message: '2FA has been enabled on your account' });
  } catch (err) {
    res.status(500).json({ error: '2FA verification failed' });
  }
});

// Disable 2FA
router.post('/2fa/disable', authRequired, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required to disable 2FA' });

  try {
    const user = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    await query('UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1', [req.user.id]); const u2 = await query('SELECT email, name FROM users WHERE id = $1', [req.user.id]); send2FADisabledEmail(u2.rows[0].email, u2.rows[0].name).catch(() => {});
    res.json({ success: true, message: '2FA has been disabled' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// ── Admin: Upgrade plan / reset password ─────────────────────────────────────

router.post('/admin/upgrade', async (req, res) => {
  const { email, plan, adminKey, newPassword } = req.body;
  if (adminKey !== 'pc_admin_2026') return res.status(403).json({ error: 'Forbidden' });

  try {
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (plan) { updates.push(`plan = $${paramIdx++}`); params.push(plan); }
    if (newPassword) {
      const hash = await bcrypt.hash(newPassword, 12);
      updates.push(`password_hash = $${paramIdx++}`);
      params.push(hash);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    params.push(email);
    const result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE email = $${paramIdx} RETURNING id, email, name, plan`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0], passwordReset: !!newPassword });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

export default router;

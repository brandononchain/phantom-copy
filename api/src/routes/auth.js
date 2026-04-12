import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// ── Register ──────────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const exists = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (email, password_hash, name, plan) VALUES ($1, $2, $3, 'basic') RETURNING id, email, name, plan`,
      [email, hash, name || '']
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

    res.cookie('token', token, { httpOnly: true, secure: !config.isDev, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.status(201).json({ user, token });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed', message: err.message });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

    res.cookie('token', token, { httpOnly: true, secure: !config.isDev, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ user: { id: user.id, email: user.email, name: user.name, plan: user.plan }, token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Me ────────────────────────────────────────────────────────────────────────

router.get('/me', authRequired, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, name, phone, plan, stripe_customer_id, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── Update profile ────────────────────────────────────────────────────────────

router.patch('/me', authRequired, async (req, res) => {
  const { name, phone } = req.body;

  try {
    const result = await query(
      'UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone), updated_at = NOW() WHERE id = $3 RETURNING id, email, name, phone, plan',
      [name, phone, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// ── Password Reset Request ────────────────────────────────────────────────────
// Step 1: User submits email -> we generate a reset token and store it
// In production, this would send an email. For now, the token is returned for testing.

router.post('/reset-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const user = await query('SELECT id, email FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      // Don't reveal whether email exists
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    // Generate reset token (6-digit code for simplicity)
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min expiry

    // Store the reset code (add columns if they don't exist)
    await query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(10),
      ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ
    `).catch(() => {});

    await query(
      'UPDATE users SET reset_code = $1, reset_expires = $2 WHERE id = $3',
      [code, expiry, user.rows[0].id]
    );

    // In production: send email with code
    // For now, return success message (code would be emailed)
    console.log(`[AUTH] Password reset code for ${email}: ${code}`);

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ error: 'Reset request failed' });
  }
});

// ── Password Reset Confirm ────────────────────────────────────────────────────
// Step 2: User submits email + code + new password

router.post('/reset-password/confirm', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, code, and new password required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const user = await query(
      'SELECT id, reset_code, reset_expires FROM users WHERE email = $1',
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid reset request' });
    }

    const u = user.rows[0];

    if (!u.reset_code || u.reset_code !== code) {
      return res.status(400).json({ error: 'Invalid or expired reset code' });
    }

    if (new Date(u.reset_expires) < new Date()) {
      return res.status(400).json({ error: 'Reset code has expired. Request a new one.' });
    }

    // Update password and clear reset code
    const hash = await bcrypt.hash(newPassword, 12);
    await query(
      'UPDATE users SET password_hash = $1, reset_code = NULL, reset_expires = NULL WHERE id = $2',
      [hash, u.id]
    );

    res.json({ success: true, message: 'Password has been reset. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// ── Change Password (authenticated) ──────────────────────────────────────────

router.post('/change-password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }

  try {
    const user = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Password change failed' });
  }
});

// ── Admin: Upgrade plan / reset password (temporary) ─────────────────────────

router.post('/admin/upgrade', async (req, res) => {
  const { email, plan, adminKey, newPassword } = req.body;
  if (adminKey !== 'pc_admin_2026') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (plan) {
      updates.push(`plan = $${paramIdx++}`);
      params.push(plan);
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Email Service (Resend)
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || 'missing_key');
const FROM = process.env.EMAIL_FROM || 'Tradevanish <noreply@tradevanish.com>';

function baseTemplate(content) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050508;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:40px 24px">
  <div style="text-align:center;margin-bottom:32px">
    <span style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em">Tradevanish</span>
  </div>
  <div style="background:#0c0c14;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:32px 28px">
    ${content}
  </div>
  <div style="text-align:center;margin-top:24px;font-size:11px;color:rgba(255,255,255,0.3);line-height:1.6">
    Tradevanish &mdash; The Stealth Standard for Modern Prop Trading<br>
    <a href="https://www.tradevanish.com" style="color:rgba(255,255,255,0.4);text-decoration:none">www.tradevanish.com</a>
  </div>
</div></body></html>`;
}

export async function sendWelcomeEmail(email, name) {
  const html = baseTemplate(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff">Welcome to Tradevanish</h1>
    <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.5);line-height:1.6">
      ${name ? `Hey ${name},` : 'Hey there,'} your account is ready.
    </p>
    <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.6);line-height:1.6">
      Copy trades across unlimited prop firm accounts, each routed through a unique residential proxy IP. Connect your first broker account to get started.
    </p>
    <div style="text-align:center;margin:28px 0 8px">
      <a href="https://www.tradevanish.com" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">Open Dashboard</a>
    </div>
  `);

  try {
    await resend.emails.send({ from: FROM, to: email, subject: 'Welcome to Tradevanish', html });
    console.log(`[EMAIL] Welcome email sent to ${email}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] Failed to send welcome email to ${email}:`, err.message);
    return false;
  }
}

export async function sendPasswordResetEmail(email, code) {
  const html = baseTemplate(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff">Reset Your Password</h1>
    <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.5);line-height:1.6">
      Use this code to reset your password. It expires in 15 minutes.
    </p>
    <div style="text-align:center;margin:24px 0">
      <div style="display:inline-block;padding:16px 40px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#fff">${code}</div>
    </div>
    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);line-height:1.6">
      If you didn't request this, you can safely ignore this email.
    </p>
  `);

  try {
    await resend.emails.send({ from: FROM, to: email, subject: 'Tradevanish - Password Reset Code', html });
    console.log(`[EMAIL] Reset code sent to ${email}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] Failed to send reset email to ${email}:`, err.message);
    return false;
  }
}

export async function send2FASetupEmail(email, name) {
  const html = baseTemplate(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#fff">Two-Factor Authentication Enabled</h1>
    <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.5);line-height:1.6">
      ${name ? `Hey ${name},` : 'Hey,'} 2FA has been enabled on your account. You'll need your authenticator app to sign in from now on.
    </p>
    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);line-height:1.6">
      If you didn't do this, change your password immediately and contact support.
    </p>
  `);

  try {
    await resend.emails.send({ from: FROM, to: email, subject: 'Tradevanish - 2FA Enabled', html });
    return true;
  } catch (err) {
    console.error(`[EMAIL] Failed to send 2FA email:`, err.message);
    return false;
  }
}

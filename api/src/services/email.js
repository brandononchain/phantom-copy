// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Email Service
// ─────────────────────────────────────────────────────────────────────────────
// All automated transactional emails. Dark-themed, branded templates.
// Uses Resend (resend.com) for delivery.
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || 'missing_key');
const FROM = process.env.EMAIL_FROM || 'Tradevanish <noreply@tradevanish.com>';
const DASHBOARD_URL = 'https://www.tradevanish.com';

// ─── Brand tokens ────────────────────────────────────────────────────────────
const B = {
  bg: '#050508',
  card: '#0c0c14',
  border: 'rgba(255,255,255,0.06)',
  t1: '#ffffff',
  t2: 'rgba(255,255,255,0.7)',
  t3: 'rgba(255,255,255,0.4)',
  muted: 'rgba(255,255,255,0.25)',
  green: '#00E5A0',
  red: '#FF4D4D',
  purple: '#6366f1',
  purpleGrad: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
  amber: '#FFB800',
  mono: "'SF Mono','Courier New',monospace",
  sans: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
};

// ─── Base template ───────────────────────────────────────────────────────────
function template(content, preheader = '') {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:${B.bg};-webkit-text-size-adjust:100%}a{color:${B.green};text-decoration:none}img{border:0;display:block}</style>
${preheader ? `<span style="display:none;font-size:1px;color:${B.bg};max-height:0;overflow:hidden">${preheader}</span>` : ''}
</head><body style="margin:0;padding:0;background:${B.bg};font-family:${B.sans}">
<div style="max-width:520px;margin:0 auto;padding:48px 20px 32px">
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px"><tr>
    <td align="center">
      <div style="display:inline-flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;background:${B.purpleGrad};border-radius:8px"></div>
        <span style="font-size:20px;font-weight:800;color:${B.t1};letter-spacing:-0.03em">Tradevanish</span>
      </div>
    </td>
  </tr></table>
  <div style="background:${B.card};border:1px solid ${B.border};border-radius:16px;padding:32px 28px">
    ${content}
  </div>
  <div style="text-align:center;margin-top:28px;padding:0 12px">
    <div style="font-size:11px;color:${B.muted};line-height:1.7;margin-bottom:12px">
      Tradevanish &mdash; The Stealth Standard for Modern Prop Trading
    </div>
    <div style="font-size:10px;color:${B.muted};line-height:1.7">
      <a href="${DASHBOARD_URL}" style="color:${B.t3}">Dashboard</a>
      &nbsp;&middot;&nbsp;
      <a href="${DASHBOARD_URL}" style="color:${B.t3}">Support</a>
    </div>
    <div style="font-size:10px;color:rgba(255,255,255,0.15);margin-top:12px">
      You received this because you have a Tradevanish account.<br>
      &copy; ${new Date().getFullYear()} Tradevanish. All rights reserved.
    </div>
  </div>
</div></body></html>`;
}

function heading(t) { return `<h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:${B.t1};letter-spacing:-0.01em">${t}</h1>`; }
function subtext(t) { return `<p style="margin:0 0 24px;font-size:14px;color:${B.t2};line-height:1.6">${t}</p>`; }
function button(t, url) { return `<div style="text-align:center;margin:28px 0 4px"><a href="${url}" style="display:inline-block;padding:13px 36px;background:${B.purpleGrad};color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">${t}</a></div>`; }
function codeBlock(code) { return `<div style="text-align:center;margin:24px 0"><div style="display:inline-block;padding:16px 44px;background:rgba(255,255,255,0.03);border:1px solid ${B.border};border-radius:12px;font-family:${B.mono};font-size:32px;font-weight:700;letter-spacing:8px;color:${B.t1}">${code}</div></div>`; }
function infoRow(label, value, color = B.t1) { return `<tr><td style="padding:8px 0;font-size:12px;font-weight:600;color:${B.t3};letter-spacing:0.06em;text-transform:uppercase;width:140px">${label}</td><td style="padding:8px 0;font-size:14px;font-weight:600;color:${color};font-family:${B.mono}">${value}</td></tr>`; }
function divider() { return `<div style="border-top:1px solid ${B.border};margin:20px 0"></div>`; }
function footnote(t) { return `<p style="margin:20px 0 0;font-size:11px;color:${B.muted};line-height:1.5">${t}</p>`; }

async function send(to, subject, html) {
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
    console.log(`[EMAIL] Sent "${subject}" to ${to}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] Failed "${subject}" to ${to}:`, err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. WELCOME
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendWelcomeEmail(email, name) {
  return send(email, 'Welcome to Tradevanish', template(`
    ${heading('Welcome to Tradevanish')}
    ${subtext(`${name ? name + ', your' : 'Your'} account is live. You're now part of the stealth standard for modern prop trading.`)}
    ${divider()}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Next Step', 'Connect your first broker')}
      ${infoRow('IP Isolation', 'Unique residential IP per account')}
      ${infoRow('Copy Engine', 'Master signals replicate instantly')}
    </table>
    ${button('Open Dashboard', DASHBOARD_URL)}
    ${footnote('Need help? Reply to this email.')}
  `, 'Your Tradevanish account is ready.'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PASSWORD RESET CODE
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendPasswordResetEmail(email, code) {
  return send(email, 'Tradevanish - Password Reset Code', template(`
    ${heading('Reset Your Password')}
    ${subtext('Enter this code in the app to set a new password. It expires in 15 minutes.')}
    ${codeBlock(code)}
    ${footnote('If you didn\'t request this, ignore this email. Your password stays unchanged.')}
  `, `Your reset code is ${code}`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PASSWORD CHANGED
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendPasswordChangedEmail(email, name) {
  return send(email, 'Tradevanish - Password Changed', template(`
    ${heading('Password Updated')}
    ${subtext(`${name ? name + ', your' : 'Your'} password was just changed. If this was you, no action needed.`)}
    ${footnote('Didn\'t make this change? Reset your password immediately and contact support.')}
  `, 'Your Tradevanish password was changed.'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 2FA ENABLED
// ═══════════════════════════════════════════════════════════════════════════════
export async function send2FASetupEmail(email, name) {
  return send(email, 'Tradevanish - 2FA Enabled', template(`
    ${heading('Two-Factor Authentication Enabled')}
    ${subtext(`${name ? name + ', 2FA' : '2FA'} is now active. You'll need your authenticator app every time you sign in.`)}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Status', 'Enabled', B.green)}
      ${infoRow('Method', 'TOTP (Authenticator App)')}
    </table>
    ${footnote('If you didn\'t enable this, change your password immediately.')}
  `, '2FA enabled on your Tradevanish account.'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 2FA DISABLED
// ═══════════════════════════════════════════════════════════════════════════════
export async function send2FADisabledEmail(email, name) {
  return send(email, 'Tradevanish - 2FA Disabled', template(`
    ${heading('Two-Factor Authentication Disabled')}
    ${subtext(`${name ? name + ', 2FA' : '2FA'} has been removed. Your account is protected by password only.`)}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Status', 'Disabled', B.red)}
    </table>
    ${footnote('We strongly recommend keeping 2FA enabled. Re-enable it anytime in Settings.')}
  `, '2FA disabled on your Tradevanish account.'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. ACCOUNT CONNECTED
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendAccountConnectedEmail(email, { name, platform, role, label }) {
  const p = platform?.charAt(0).toUpperCase() + platform?.slice(1) || 'Unknown';
  return send(email, `Tradevanish - ${p} Account Connected`, template(`
    ${heading('Broker Account Connected')}
    ${subtext(`A new ${role} account has been linked to your dashboard.`)}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Account', label || 'Untitled')}
      ${infoRow('Platform', p)}
      ${infoRow('Role', role === 'master' ? 'Master (Signal Source)' : 'Follower (Copy Target)')}
      ${infoRow('Proxy', 'Residential IP assigned', B.green)}
    </table>
    ${button('View Accounts', DASHBOARD_URL)}
    ${footnote('Didn\'t connect this? Disconnect it immediately from your dashboard.')}
  `, `${p} ${role} account connected.`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. TRADE COPIED
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendTradeExecutedEmail(email, { ticker, side, qty, price, followerCount, masterLabel }) {
  return send(email, `Tradevanish - ${side} ${qty}x ${ticker} Copied`, template(`
    ${heading('Trade Copied')}
    ${subtext('A master signal was replicated across your follower accounts.')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Signal', `${side} ${qty}x ${ticker}`, side === 'Buy' ? B.green : B.red)}
      ${infoRow('Price', price ? `$${Number(price).toLocaleString()}` : 'Market')}
      ${infoRow('Master', masterLabel || 'Primary')}
      ${infoRow('Copied To', `${followerCount} follower${followerCount !== 1 ? 's' : ''}`, B.green)}
    </table>
    ${button('View Trade Log', DASHBOARD_URL)}
  `, `${side} ${qty}x ${ticker} copied to ${followerCount} accounts.`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. TRADE FAILED
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendTradeFailedEmail(email, { ticker, side, qty, error, followerLabel }) {
  return send(email, `Tradevanish - Trade Failed on ${followerLabel || 'Follower'}`, template(`
    ${heading('Copy Trade Failed')}
    ${subtext('A trade failed to execute on a follower account.')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Signal', `${side} ${qty}x ${ticker}`, B.red)}
      ${infoRow('Follower', followerLabel || 'Unknown')}
      ${infoRow('Error', error || 'Order rejected', B.red)}
    </table>
    ${button('Check Accounts', DASHBOARD_URL)}
    ${footnote('Common causes: insufficient margin, daily loss limit, or expired broker session.')}
  `, `Trade failed: ${side} ${qty}x ${ticker}.`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. DRAWDOWN ALERT
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendDrawdownAlertEmail(email, { accountLabel, currentDrawdown, limit }) {
  return send(email, `Tradevanish - Drawdown Alert: ${accountLabel}`, template(`
    ${heading('Drawdown Alert')}
    ${subtext('An account has hit the drawdown warning threshold.')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Account', accountLabel)}
      ${infoRow('Current Loss', `$${Math.abs(currentDrawdown).toLocaleString()}`, B.red)}
      ${infoRow('Daily Limit', `$${Number(limit).toLocaleString()}`, B.amber)}
    </table>
    ${divider()}
    <p style="margin:0;font-size:13px;color:${B.amber};line-height:1.5;font-weight:600">Consider pausing this account or reducing position sizes.</p>
    ${button('Manage Risk Settings', DASHBOARD_URL)}
  `, `Drawdown alert on ${accountLabel}.`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. LISTENER DISCONNECTED
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendListenerDisconnectedEmail(email, { masterLabel, reason, reconnecting }) {
  return send(email, 'Tradevanish - Listener Disconnected', template(`
    ${heading('Master Listener Disconnected')}
    ${subtext('The WebSocket connection to your master account dropped. Copy trading is paused.')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Master', masterLabel || 'Primary')}
      ${infoRow('Reason', reason || 'Connection lost')}
      ${infoRow('Auto-Reconnect', reconnecting ? 'Attempting...' : 'Manual restart needed', reconnecting ? B.amber : B.red)}
    </table>
    ${button('Restart Listener', DASHBOARD_URL)}
  `, `Master listener disconnected: ${masterLabel}.`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. PROXY ROTATED
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendProxyRotatedEmail(email, { accountLabel, oldIp, newIp, reason }) {
  return send(email, 'Tradevanish - Proxy IP Rotated', template(`
    ${heading('Proxy IP Rotated')}
    ${subtext('A residential proxy IP was rotated on one of your accounts.')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Account', accountLabel)}
      ${infoRow('Previous IP', oldIp || 'N/A')}
      ${infoRow('New IP', newIp || 'Assigning...', B.green)}
      ${infoRow('Reason', reason || 'Scheduled rotation')}
    </table>
    ${footnote('IP rotation keeps your trading activity undetectable by prop firm monitoring.')}
  `, `Proxy rotated on ${accountLabel}.`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. PLAN UPGRADED
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendPlanUpgradedEmail(email, { name, plan, price }) {
  const names = { basic: 'Basic', pro: 'Pro', proplus: 'Pro+' };
  return send(email, `Tradevanish - Upgraded to ${names[plan] || plan}`, template(`
    ${heading('Plan Upgraded')}
    ${subtext(`${name ? name + ', you\'re' : 'You\'re'} now on ${names[plan] || plan}. New features are available immediately.`)}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('New Plan', names[plan] || plan, B.green)}
      ${infoRow('Billing', price ? `$${price}/mo` : 'Active')}
      ${plan === 'proplus' ? infoRow('Unlocked', 'API, Webhooks, Proxy Pools', B.green) : ''}
      ${plan === 'pro' ? infoRow('Unlocked', 'Unlimited followers, Multi-provider', B.green) : ''}
    </table>
    ${button('Explore New Features', DASHBOARD_URL)}
  `, `Upgraded to ${names[plan] || plan}.`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. DAILY P&L SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendDailyPnlEmail(email, { name, date, totalPnl, totalTrades, accounts }) {
  const sign = totalPnl >= 0 ? '+' : '';
  const color = totalPnl >= 0 ? B.green : B.red;
  const rows = (accounts || []).map(a =>
    `<tr><td style="padding:6px 0;font-size:12px;color:${B.t2}">${a.label}</td><td style="padding:6px 0;font-size:12px;font-family:${B.mono};color:${a.pnl >= 0 ? B.green : B.red};text-align:right">${a.pnl >= 0 ? '+' : ''}$${Math.abs(a.pnl).toFixed(2)}</td></tr>`
  ).join('');
  return send(email, `Tradevanish - Daily P&L: ${sign}$${Math.abs(totalPnl).toFixed(2)}`, template(`
    ${heading('Daily P&L Report')}
    ${subtext(`${name ? name + ', here\'s' : 'Here\'s'} your summary for ${date || 'today'}.`)}
    <div style="text-align:center;margin:20px 0">
      <div style="font-size:11px;font-weight:600;color:${B.t3};letter-spacing:0.1em;margin-bottom:6px">TOTAL P&L</div>
      <div style="font-size:36px;font-weight:800;color:${color};font-family:${B.mono};letter-spacing:-0.02em">${sign}$${Math.abs(totalPnl).toFixed(2)}</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">${infoRow('Total Trades', String(totalTrades || 0))}</table>
    ${accounts?.length ? `${divider()}<div style="font-size:11px;font-weight:600;color:${B.t3};letter-spacing:0.1em;margin-bottom:8px">BY ACCOUNT</div><table width="100%" cellpadding="0" cellspacing="0">${rows}</table>` : ''}
    ${button('View Full Trade Log', DASHBOARD_URL)}
  `, `Daily P&L: ${sign}$${Math.abs(totalPnl).toFixed(2)}.`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 14. KILL SWITCH TRIGGERED
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendKillSwitchEmail(email, { name, reason, accountLabel }) {
  return send(email, 'Tradevanish - KILL SWITCH ACTIVATED', template(`
    <div style="border-left:3px solid ${B.red};padding-left:16px;margin-bottom:20px">
      ${heading('Kill Switch Activated')}
    </div>
    ${subtext('All copy trading has been halted due to a risk rule trigger.')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Status', 'ALL TRADING STOPPED', B.red)}
      ${infoRow('Trigger', reason || 'Daily loss limit exceeded')}
      ${accountLabel ? infoRow('Account', accountLabel) : ''}
    </table>
    ${divider()}
    <p style="margin:0 0 16px;font-size:13px;color:${B.t2};line-height:1.6">Review your positions and risk settings before resuming.</p>
    ${button('Review & Resume', DASHBOARD_URL)}
  `, 'KILL SWITCH ACTIVATED - All trading stopped.'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 15. WEBHOOK SIGNAL RECEIVED
// ═══════════════════════════════════════════════════════════════════════════════
export async function sendSignalReceivedEmail(email, { ticker, side, qty, source, status }) {
  return send(email, `Tradevanish - Signal: ${side} ${qty}x ${ticker}`, template(`
    ${heading('Signal Received')}
    ${subtext('A trading signal was received via your webhook endpoint.')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${infoRow('Signal', `${side} ${qty}x ${ticker}`, side === 'Buy' ? B.green : B.red)}
      ${infoRow('Source', source || 'TradingView')}
      ${infoRow('Status', status || 'Executed', status === 'Executed' ? B.green : B.red)}
    </table>
    ${button('View Signal History', DASHBOARD_URL)}
  `, `Signal: ${side} ${qty}x ${ticker}.`));
}

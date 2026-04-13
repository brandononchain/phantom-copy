'use client';

const STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }
.lp { min-height: 100vh; background: #050508; color: rgba(255,255,255,0.7); font-family: 'Inter', -apple-system, sans-serif; }
.lp-head { padding: 20px 40px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 10px; }
.lp-head img { width: 24px; height: 24px; border-radius: 5px; }
.lp-head a { font-size: 15px; font-weight: 700; color: #fff; text-decoration: none; letter-spacing: -0.02em; }
.lp-head span { color: rgba(255,255,255,0.3); font-size: 13px; margin-left: auto; }
.lp-head span a { font-weight: 400; color: rgba(255,255,255,0.4); font-size: 13px; }
.lp-body { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; }
.lp-body h1 { font-size: 32px; font-weight: 800; color: #fff; letter-spacing: -0.03em; margin: 0 0 8px; }
.lp-body .lp-updated { font-size: 12px; color: rgba(255,255,255,0.3); margin-bottom: 32px; }
.lp-body h2 { font-size: 18px; font-weight: 700; color: #fff; margin: 36px 0 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.04); }
.lp-body h3 { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.9); margin: 20px 0 8px; }
.lp-body p { font-size: 14px; line-height: 1.7; margin: 0 0 12px; }
.lp-body ul { padding-left: 20px; margin: 0 0 12px; }
.lp-body li { font-size: 14px; line-height: 1.7; margin: 4px 0; }
.lp-body strong { color: #fff; }
.lp-body a { color: #6366f1; text-decoration: none; }
.lp-body table { width: 100%; border-collapse: collapse; margin: 12px 0 16px; font-size: 13px; }
.lp-body th { text-align: left; padding: 10px 14px; background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.5); font-weight: 600; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.06); }
.lp-body td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); }
`;

export default function PrivacyPage() {
  return (
    <>
      <style>{STYLES}</style>
      <div className="lp">
        <div className="lp-head">
          <img src="/logo.png" alt="TV" />
          <a href="/">Tradevanish</a>
          <span><a href="/terms">Terms & Conditions</a></span>
        </div>
        <div className="lp-body">
          <h1>Privacy Policy</h1>
          <div className="lp-updated">Last updated: April 13, 2026</div>

          <p>Tradevanish ("Company", "we", "us") is committed to protecting your privacy. This policy describes how we collect, use, store, and share your personal data when you use our platform at www.tradevanish.com ("Service").</p>

          <h2>1. Information We Collect</h2>

          <h3>1.1 Account Information</h3>
          <ul>
            <li><strong>Registration data:</strong> Email address, name, phone number (optional), password (stored as bcrypt hash)</li>
            <li><strong>Authentication data:</strong> JWT session tokens, TOTP 2FA secrets (encrypted)</li>
            <li><strong>Billing data:</strong> Processed by Stripe. We store your Stripe customer ID but never store credit card numbers</li>
          </ul>

          <h3>1.2 Broker Credentials</h3>
          <ul>
            <li><strong>API keys and OAuth tokens:</strong> Required to connect your broker accounts. Stored encrypted in our database</li>
            <li><strong>Broker account IDs:</strong> Used to identify and operate your connected accounts</li>
            <li><strong>Trade execution data:</strong> Order details, fills, positions, P&L — logged for your trade history and platform operation</li>
          </ul>
          <p><strong>We never share your broker credentials with third parties.</strong> Credentials are used solely to execute trades on your behalf according to your configuration.</p>

          <h3>1.3 Technical Data</h3>
          <ul>
            <li><strong>IP addresses:</strong> Your real IP (for security) and assigned proxy IPs (for trading)</li>
            <li><strong>Device information:</strong> Browser type, operating system, screen resolution (via standard HTTP headers)</li>
            <li><strong>Usage data:</strong> Pages visited, features used, session duration, error logs</li>
            <li><strong>WebSocket connection data:</strong> Listener session timestamps, connection status, reconnection events</li>
          </ul>

          <h3>1.4 Trading Data</h3>
          <ul>
            <li>Trade execution records (ticker, side, quantity, price, timestamp)</li>
            <li>Copy engine performance metrics (latency, fill rates, slippage)</li>
            <li>Risk rule configurations and trigger events</li>
            <li>Signal webhook payloads and execution history</li>
            <li>Account balances, equity, and performance statistics fetched from brokers</li>
          </ul>

          <h2>2. How We Use Your Data</h2>
          <table>
            <thead>
              <tr><th>Purpose</th><th>Legal Basis</th></tr>
            </thead>
            <tbody>
              <tr><td>Operate the copy trading service</td><td>Contract performance</td></tr>
              <tr><td>Execute trades on your connected accounts</td><td>Your explicit authorization</td></tr>
              <tr><td>Send transactional emails (welcome, password reset, trade alerts)</td><td>Contract performance</td></tr>
              <tr><td>Process subscription payments</td><td>Contract performance</td></tr>
              <tr><td>Maintain security and prevent fraud</td><td>Legitimate interest</td></tr>
              <tr><td>Improve platform performance and reliability</td><td>Legitimate interest</td></tr>
              <tr><td>Comply with legal obligations</td><td>Legal requirement</td></tr>
            </tbody>
          </table>

          <h2>3. Data Storage & Security</h2>
          <h3>3.1 Infrastructure</h3>
          <ul>
            <li><strong>Application hosting:</strong> Vercel (frontend), Railway (API and database)</li>
            <li><strong>Database:</strong> PostgreSQL on Railway with encrypted connections</li>
            <li><strong>Email:</strong> Resend (transactional email delivery)</li>
            <li><strong>Payments:</strong> Stripe (PCI DSS compliant)</li>
            <li><strong>Proxy network:</strong> BrightData (residential proxy provider)</li>
          </ul>

          <h3>3.2 Security Measures</h3>
          <ul>
            <li>All data transmitted over HTTPS/TLS encryption</li>
            <li>Passwords hashed with bcrypt (12 rounds)</li>
            <li>Broker credentials encrypted at rest</li>
            <li>API keys stored as SHA-256 hashes (raw keys never stored)</li>
            <li>TOTP two-factor authentication available</li>
            <li>JWT tokens with 7-day expiration</li>
            <li>CORS restrictions and rate limiting on API endpoints</li>
          </ul>

          <h3>3.3 Data Retention</h3>
          <table>
            <thead>
              <tr><th>Data Type</th><th>Retention Period</th></tr>
            </thead>
            <tbody>
              <tr><td>Account information</td><td>Duration of account + 30 days after deletion</td></tr>
              <tr><td>Broker credentials</td><td>Deleted within 30 days of account disconnection</td></tr>
              <tr><td>Trade execution logs</td><td>90 days after account closure</td></tr>
              <tr><td>Billing records</td><td>7 years (legal/tax requirement)</td></tr>
              <tr><td>Security logs</td><td>12 months</td></tr>
              <tr><td>Email delivery logs</td><td>30 days</td></tr>
            </tbody>
          </table>

          <h2>4. Data Sharing</h2>
          <p>We do NOT sell your personal data. We share data only with:</p>
          <ul>
            <li><strong>Broker platforms</strong> (TopStepX, Tradovate, NinjaTrader, Rithmic) — Only the credentials and order data necessary to execute trades on your behalf</li>
            <li><strong>Stripe</strong> — Payment processing (name, email, payment method)</li>
            <li><strong>Resend</strong> — Email delivery (email address, message content)</li>
            <li><strong>BrightData</strong> — Proxy network access (no personal data shared; proxy sessions are anonymous)</li>
            <li><strong>Law enforcement</strong> — Only when legally compelled by court order or subpoena</li>
          </ul>

          <h2>5. Cookies & Local Storage</h2>
          <ul>
            <li><strong>Authentication cookie:</strong> HttpOnly, Secure, SameSite=Lax — contains your session JWT</li>
            <li><strong>localStorage:</strong> Stores authentication token for API requests. Cleared on logout</li>
            <li>We do NOT use advertising cookies, tracking pixels, or third-party analytics</li>
          </ul>

          <h2>6. Your Rights</h2>
          <p>Depending on your jurisdiction (including GDPR, CCPA), you may have the right to:</p>
          <ul>
            <li><strong>Access:</strong> Request a copy of all personal data we hold about you</li>
            <li><strong>Rectification:</strong> Correct inaccurate personal data</li>
            <li><strong>Deletion:</strong> Request deletion of your account and associated data</li>
            <li><strong>Portability:</strong> Receive your data in a structured, machine-readable format</li>
            <li><strong>Restriction:</strong> Limit how we process your data</li>
            <li><strong>Objection:</strong> Object to processing based on legitimate interest</li>
            <li><strong>Withdraw consent:</strong> At any time, without affecting prior processing</li>
          </ul>
          <p>To exercise these rights, contact <strong>privacy@tradevanish.com</strong>. We will respond within 30 days.</p>

          <h2>7. International Transfers</h2>
          <p>Your data may be processed in the United States and other countries where our service providers operate. We ensure appropriate safeguards are in place for international transfers, including standard contractual clauses where applicable.</p>

          <h2>8. Children's Privacy</h2>
          <p>Tradevanish is not intended for users under 18 years of age. We do not knowingly collect data from minors. If you believe a minor has created an account, contact us immediately.</p>

          <h2>9. Changes to This Policy</h2>
          <p>We may update this Privacy Policy periodically. Material changes will be communicated via email to your registered address at least 14 days before taking effect. The "Last updated" date at the top reflects the most recent revision.</p>

          <h2>10. Data Protection Officer</h2>
          <p>For privacy-related inquiries or to exercise your data rights:</p>
          <p><strong>Email:</strong> privacy@tradevanish.com<br />
          <strong>Subject:</strong> Privacy Request — [Your Name]</p>
          <p>We aim to resolve all privacy requests within 30 calendar days.</p>
        </div>
      </div>
    </>
  );
}

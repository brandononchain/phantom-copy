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
.lp-body .lp-warn { background: rgba(255,77,77,0.06); border: 1px solid rgba(255,77,77,0.12); border-radius: 10px; padding: 16px 20px; margin: 16px 0; font-size: 13px; line-height: 1.6; }
.lp-body .lp-warn strong { color: #FF4D4D; }
`;

export default function TermsPage() {
  return (
    <>
      <style>{STYLES}</style>
      <div className="lp">
        <div className="lp-head">
          <img src="/logo.png" alt="TV" />
          <a href="/">Tradevanish</a>
          <span><a href="/privacy">Privacy Policy</a></span>
        </div>
        <div className="lp-body">
          <h1>Terms & Conditions</h1>
          <div className="lp-updated">Last updated: April 13, 2026</div>

          <div className="lp-warn">
            <strong>IMPORTANT RISK DISCLOSURE:</strong> Tradevanish is a trade replication tool. It is NOT a trading advisory service and does NOT provide financial advice. Futures trading involves substantial risk of loss and is not suitable for all investors. You could lose more than your initial investment. Past performance is not indicative of future results. You are solely responsible for all trading decisions and their consequences.
          </div>

          <h2>1. Acceptance of Terms</h2>
          <p>By accessing or using Tradevanish ("Service"), operated by Tradevanish ("Company", "we", "us"), you ("User", "you") agree to be bound by these Terms & Conditions. If you do not agree, do not use the Service.</p>
          <p>We reserve the right to modify these terms at any time. Continued use after changes constitutes acceptance. Material changes will be communicated via email to your registered address.</p>

          <h2>2. Service Description</h2>
          <p>Tradevanish is a cloud-based trade replication platform that:</p>
          <ul>
            <li>Copies trading signals from a designated master account to one or more follower accounts</li>
            <li>Routes API calls through dedicated residential proxy IP addresses</li>
            <li>Receives and executes trading signals from third-party platforms (TradingView, TrendSpider)</li>
            <li>Provides risk management tools including position sizing, loss limits, and kill switches</li>
          </ul>
          <p>Tradevanish does NOT: provide trading signals, investment advice, asset management, or portfolio recommendations. We are a technology platform only.</p>

          <h2>3. Eligibility</h2>
          <p>You must be at least 18 years old and legally able to enter binding contracts in your jurisdiction. You represent that you have the legal authority to connect and operate any broker accounts linked to the Service.</p>

          <h2>4. Account Registration</h2>
          <p>You agree to provide accurate, current, and complete registration information. You are responsible for maintaining the confidentiality of your account credentials, including passwords, API keys, and two-factor authentication codes. You are liable for all activity under your account.</p>
          <p>We reserve the right to suspend or terminate accounts that violate these terms, engage in fraudulent activity, or pose a security risk to the platform.</p>

          <h2>5. Broker Account Connections</h2>
          <p>By connecting broker accounts to Tradevanish, you:</p>
          <ul>
            <li>Authorize the Service to place, modify, and cancel orders on your behalf according to your configured rules</li>
            <li>Confirm you own or are authorized to operate each connected account</li>
            <li>Understand that the Service acts on your instructions and configuration, not independently</li>
            <li>Accept full responsibility for all trades executed through the Service</li>
          </ul>
          <p>Tradevanish stores broker credentials in encrypted form. We do not share your credentials with third parties. OAuth tokens may expire and require re-authentication.</p>

          <h2>6. Prop Firm Compliance</h2>
          <div className="lp-warn">
            <strong>PROP FIRM RISK:</strong> Many proprietary trading firms ("prop firms") have terms of service that may restrict or prohibit the use of copy trading, trade replication, or shared signal services. By using Tradevanish, you acknowledge that:
          </div>
          <ul>
            <li>It is YOUR sole responsibility to review and comply with the terms of service of every prop firm account you connect</li>
            <li>Tradevanish does NOT guarantee that the use of our Service is permitted by any specific prop firm</li>
            <li>We are NOT liable for any account suspensions, disqualifications, profit denials, or penalties imposed by prop firms</li>
            <li>The use of residential proxy IPs does not guarantee undetectability or compliance</li>
            <li>You accept all risk of prop firm rule violations, including loss of funded accounts and evaluation fees</li>
          </ul>

          <h2>7. Risk Disclosure</h2>
          <h3>Trading Risk</h3>
          <p>Futures, options, and other derivatives trading carries a high level of risk. You can lose substantially more than your initial investment. The use of leverage magnifies both gains and losses. Do not trade with funds you cannot afford to lose.</p>

          <h3>Technology Risk</h3>
          <p>Trade replication involves technology dependencies including internet connectivity, API availability, WebSocket connections, proxy networks, and broker systems. Failures in any component may result in:</p>
          <ul>
            <li>Delayed or missed trade executions</li>
            <li>Partial fills or order rejections</li>
            <li>Incorrect position sizing</li>
            <li>Unintended open positions</li>
            <li>Slippage beyond expected parameters</li>
          </ul>
          <p>You acknowledge these risks and agree that Tradevanish is not liable for losses arising from technology failures, network outages, broker API changes, or third-party service interruptions.</p>

          <h3>Proxy Network Risk</h3>
          <p>Residential proxy IP addresses are provided by third-party networks. IP availability, geographic location, and connection quality may vary. Proxy rotation or failure may temporarily interrupt trading activity.</p>

          <h2>8. Not Financial Advice</h2>
          <p><strong>Tradevanish does not provide financial, investment, legal, or tax advice.</strong> Nothing on our platform, documentation, marketing materials, or communications constitutes a recommendation to buy, sell, or hold any financial instrument. You should consult qualified professionals before making trading decisions.</p>

          <h2>9. Subscription & Billing</h2>
          <ul>
            <li>Subscriptions are billed monthly through Stripe</li>
            <li>Prices are listed in USD: Basic ($39/mo), Pro ($69/mo), Pro+ ($89/mo)</li>
            <li>You may cancel at any time; access continues until the end of the billing period</li>
            <li>No refunds for partial months or unused features</li>
            <li>We reserve the right to change pricing with 30 days notice</li>
            <li>Failed payments may result in service suspension after a 7-day grace period</li>
          </ul>

          <h2>10. Acceptable Use</h2>
          <p>You agree NOT to:</p>
          <ul>
            <li>Use the Service for any illegal purpose</li>
            <li>Attempt to reverse engineer, decompile, or extract source code</li>
            <li>Share your account credentials or API keys with unauthorized parties</li>
            <li>Resell or redistribute the Service without authorization</li>
            <li>Overwhelm our systems with excessive API requests beyond published rate limits</li>
            <li>Use the Service to manipulate markets or engage in wash trading</li>
            <li>Connect accounts you do not own or are not authorized to operate</li>
          </ul>

          <h2>11. Data & Security</h2>
          <p>We implement industry-standard security measures including encrypted credential storage (bcrypt + AES), HTTPS/TLS encryption, JWT authentication, and optional TOTP two-factor authentication. See our <a href="/privacy">Privacy Policy</a> for details on data collection and processing.</p>

          <h2>12. Intellectual Property</h2>
          <p>All content, code, designs, and trademarks associated with Tradevanish are the property of the Company. You may not copy, modify, or distribute any part of the Service without written permission.</p>

          <h2>13. Limitation of Liability</h2>
          <p><strong>TO THE MAXIMUM EXTENT PERMITTED BY LAW:</strong></p>
          <ul>
            <li>Tradevanish is provided "AS IS" and "AS AVAILABLE" without warranties of any kind, express or implied</li>
            <li>We do not warrant uninterrupted, error-free, or secure operation</li>
            <li>Our total liability for any claim shall not exceed the amount you paid for the Service in the 3 months preceding the claim</li>
            <li>We are NOT liable for lost profits, trading losses, consequential damages, or damages arising from prop firm actions</li>
            <li>We are NOT liable for actions or omissions of third-party brokers, proxy providers, or signal platforms</li>
          </ul>

          <h2>14. Indemnification</h2>
          <p>You agree to indemnify, defend, and hold harmless Tradevanish and its officers, directors, employees, and agents from any claims, damages, losses, or expenses (including legal fees) arising from your use of the Service, violation of these terms, or infringement of any third party's rights.</p>

          <h2>15. Termination</h2>
          <p>Either party may terminate this agreement at any time. Upon termination:</p>
          <ul>
            <li>Your access to the Service will cease</li>
            <li>Active listeners and copy trading will be stopped</li>
            <li>Broker credentials will be deleted from our systems within 30 days</li>
            <li>Trade execution logs will be retained for 90 days for audit purposes</li>
          </ul>

          <h2>16. Governing Law</h2>
          <p>These terms are governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to conflict of law principles. Any disputes shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association.</p>

          <h2>17. Severability</h2>
          <p>If any provision of these terms is found unenforceable, the remaining provisions shall continue in full force and effect.</p>

          <h2>18. Contact</h2>
          <p>For questions about these Terms & Conditions, contact us at <strong>legal@tradevanish.com</strong>.</p>
        </div>
      </div>
    </>
  );
}

export const metadata = {
  metadataBase: new URL('https://www.tradevanish.com'),
  title: {
    default: 'Tradevanish | Stealth Copy Trading for Prop Firm Traders',
    template: '%s | Tradevanish',
  },
  description: 'Copy trades from one master account to unlimited prop firm accounts. Each connection routed through a unique residential proxy IP. TopStepX, Tradovate, NinjaTrader, and Rithmic supported.',
  keywords: ['copy trading', 'prop firm', 'trade copier', 'stealth trading', 'residential proxy trading', 'TopStepX copy trade', 'Tradovate copy trading', 'prop firm copy trader', 'futures copy trading', 'IP isolation trading'],
  authors: [{ name: 'Tradevanish' }],
  creator: 'Tradevanish',
  publisher: 'Tradevanish',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-video-preview': -1, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://www.tradevanish.com',
    siteName: 'Tradevanish',
    title: 'Tradevanish — Stealth Copy Trading for Prop Firm Traders',
    description: 'Copy trades from one master account to unlimited prop firm accounts. Each connection routed through a unique residential proxy IP.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Tradevanish Dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tradevanish — Stealth Copy Trading for Prop Firms',
    description: 'One master trade executes everywhere. Each account behind its own residential IP.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
    shortcut: '/favicon.ico',
  },
  manifest: '/site.webmanifest',
  alternates: {
    canonical: 'https://www.tradevanish.com',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "Tradevanish",
              "applicationCategory": "FinanceApplication",
              "operatingSystem": "Web",
              "description": "Stealth copy trading platform for prop firm traders. Replicates master trades to unlimited follower accounts, each routed through a dedicated residential proxy IP.",
              "url": "https://www.tradevanish.com",
              "offers": [
                { "@type": "Offer", "name": "Basic", "price": "39.00", "priceCurrency": "USD", "billingIncrement": "P1M" },
                { "@type": "Offer", "name": "Pro", "price": "69.00", "priceCurrency": "USD", "billingIncrement": "P1M" },
                { "@type": "Offer", "name": "Pro+", "price": "89.00", "priceCurrency": "USD", "billingIncrement": "P1M" }
              ],
              "featureList": [
                "Copy trading across TopStepX, Tradovate, NinjaTrader, Rithmic",
                "Dedicated residential proxy IP per account",
                "Real-time WebSocket trade replication",
                "TradingView and TrendSpider signal webhooks",
                "Risk management with kill switch and daily loss limits",
                "REST API and webhook integrations",
                "40+ CME, COMEX, and NYMEX futures contracts"
              ],
              "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "4.8",
                "reviewCount": "127"
              }
            })
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              "mainEntity": [
                {
                  "@type": "Question",
                  "name": "What is Tradevanish?",
                  "acceptedAnswer": { "@type": "Answer", "text": "Tradevanish is a stealth copy trading platform that replicates trades from a master broker account to unlimited follower accounts. Each account routes through its own dedicated residential proxy IP, making each connection appear independent to prop firms." }
                },
                {
                  "@type": "Question",
                  "name": "Which brokers does Tradevanish support?",
                  "acceptedAnswer": { "@type": "Answer", "text": "Tradevanish supports TopStepX (via ProjectX API), Tradovate (OAuth), NinjaTrader (OAuth), and Rithmic (WebSocket). Cross-platform copy trading is supported — for example, a TopStepX master can copy to Tradovate followers." }
                },
                {
                  "@type": "Question",
                  "name": "How does Tradevanish prevent detection by prop firms?",
                  "acceptedAnswer": { "@type": "Answer", "text": "Each connected broker account is routed through a unique residential proxy IP from BrightData's network. This means every account has a different IP address, preventing IP correlation. Configurable copy delays and latency jitter further reduce timing correlation between accounts." }
                },
                {
                  "@type": "Question",
                  "name": "What futures contracts does Tradevanish support?",
                  "acceptedAnswer": { "@type": "Answer", "text": "Tradevanish supports 40+ futures contracts across CME (ES, NQ, YM, RTY and micros), CME FX (6E, 6J, 6B, 6A), COMEX metals (GC, SI, HG), NYMEX energy (CL, NG, RB, HO), and CME interest rates (ZB, ZN, ZF). Automatic front month roll logic is included." }
                },
                {
                  "@type": "Question",
                  "name": "Does copy trading continue when I log out?",
                  "acceptedAnswer": { "@type": "Answer", "text": "Yes. Tradevanish runs listeners and copy trading server-side in the cloud. Logging out only clears your browser session — your master listener and copy engine continue operating. You can close your laptop and trades will still replicate." }
                }
              ]
            })
          }}
        />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#050508', color: '#fff', fontFamily: "'Inter', -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}

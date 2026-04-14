'use client';

import { useEffect } from 'react';

export default function LandingPage() {

  useEffect(() => {
    // Load UnicornStudio for animated background
    if (!window.UnicornStudio) {
      window.UnicornStudio = { isInitialized: false };
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.29/dist/unicornStudio.umd.js';
      s.onload = () => {
        if (!window.UnicornStudio.isInitialized) {
          UnicornStudio.init();
          window.UnicornStudio.isInitialized = true;
        }
      };
      document.head.appendChild(s);
    } else if (window.UnicornStudio.isInitialized) {
      UnicornStudio.init();
    }
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{background:#030306;overflow-x:hidden}

        .hero{position:relative;min-height:100vh;display:flex;flex-direction:column;align-items:center;font-family:'Instrument Sans',-apple-system,sans-serif;color:#fff}

        /* Aura background */
        .aura-bg{position:absolute;top:0;left:0;width:100%;height:800px;saturate:1.5;filter:saturate(1.5);z-index:0;mask-image:linear-gradient(transparent,black 0%,black 80%,transparent);-webkit-mask-image:linear-gradient(transparent,black 0%,black 80%,transparent)}
        .aura-bg>div{position:absolute;top:0;left:0;width:100%;height:100%}

        /* Noise */
        .hero::after{content:'';position:fixed;top:0;left:0;right:0;bottom:0;background:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");pointer-events:none;z-index:1}

        .hero-nav{position:relative;z-index:10;width:100%;max-width:1200px;display:flex;align-items:center;justify-content:space-between;padding:24px 32px;opacity:0;animation:fadeDown .8s ease forwards .2s}
        .hero-nav-brand{display:flex;align-items:center;gap:10px}
        .hero-nav-brand img{width:28px;height:28px;border-radius:6px}
        .hero-nav-brand span{font-size:17px;font-weight:700;letter-spacing:-.03em}
        .hero-nav-links{display:flex;align-items:center;gap:28px}
        .hero-nav-links a{color:rgba(255,255,255,.45);text-decoration:none;font-size:13.5px;font-weight:500;transition:color .2s;letter-spacing:-.01em}
        .hero-nav-links a:hover{color:#fff}
        .hero-nav-cta{background:rgba(255,255,255,.06)!important;border:1px solid rgba(255,255,255,.08);color:#fff!important;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;transition:all .2s}
        .hero-nav-cta:hover{background:rgba(255,255,255,.1)!important;border-color:rgba(255,255,255,.15)}

        .hero-content{position:relative;z-index:10;text-align:center;max-width:800px;padding:120px 24px 0}
        .hero-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 14px 6px 8px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.15);border-radius:100px;font-size:12px;font-weight:500;color:rgba(255,255,255,.6);margin-bottom:28px;opacity:0;animation:fadeUp .7s ease forwards .4s;letter-spacing:-.01em}
        .hero-badge-dot{width:6px;height:6px;background:#6366f1;border-radius:50%;animation:pulse 2s ease-in-out infinite}
        .hero-h1{font-size:clamp(40px,6vw,68px);font-weight:700;line-height:1.05;letter-spacing:-.04em;margin-bottom:20px;opacity:0;animation:fadeUp .8s ease forwards .5s}
        .hero-h1 .accent{background:linear-gradient(135deg,#6366f1 0%,#a78bfa 50%,#6366f1 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:shimmer 4s linear infinite}
        .hero-sub{font-size:clamp(16px,2vw,19px);color:rgba(255,255,255,.4);line-height:1.6;max-width:560px;margin:0 auto 40px;font-weight:400;letter-spacing:-.01em;opacity:0;animation:fadeUp .8s ease forwards .65s}
        .hero-actions{display:flex;align-items:center;justify-content:center;gap:14px;opacity:0;animation:fadeUp .8s ease forwards .8s}
        .hero-btn-primary{padding:14px 32px;background:linear-gradient(135deg,#6366f1,#7c3aed);color:#fff;border:none;border-radius:10px;font-size:14.5px;font-weight:600;cursor:pointer;text-decoration:none;transition:all .25s;letter-spacing:-.01em;box-shadow:0 0 30px rgba(99,102,241,.2)}
        .hero-btn-primary:hover{transform:translateY(-1px);box-shadow:0 0 50px rgba(99,102,241,.35)}
        .hero-btn-ghost{padding:14px 28px;background:transparent;color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.08);border-radius:10px;font-size:14.5px;font-weight:500;cursor:pointer;text-decoration:none;transition:all .2s;letter-spacing:-.01em}
        .hero-btn-ghost:hover{color:#fff;border-color:rgba(255,255,255,.15);background:rgba(255,255,255,.03)}

        .hero-preview{position:relative;z-index:10;width:100%;max-width:1100px;margin:60px auto 0;padding:0 24px 80px;opacity:0;animation:fadeUp 1s ease forwards 1s}
        .hero-preview-frame{position:relative;width:100%;aspect-ratio:16/9.5;background:#0a0a12;border:1px solid rgba(255,255,255,.06);border-radius:16px;overflow:hidden;box-shadow:0 4px 60px rgba(99,102,241,.08),0 0 0 1px rgba(255,255,255,.03),inset 0 1px 0 rgba(255,255,255,.04)}
        .hero-preview-chrome{display:flex;align-items:center;gap:6px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.04);background:rgba(255,255,255,.015)}
        .hero-preview-dot{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.08)}
        .hero-preview-dot:first-child{background:rgba(255,77,77,.5)}
        .hero-preview-dot:nth-child(2){background:rgba(255,184,0,.5)}
        .hero-preview-dot:nth-child(3){background:rgba(0,229,160,.5)}
        .hero-preview-url{margin-left:12px;font-size:11px;font-family:'DM Mono',monospace;color:rgba(255,255,255,.2);letter-spacing:.02em}
        .hero-preview-body{position:relative;width:100%;height:calc(100% - 40px);display:flex;align-items:center;justify-content:center;overflow:hidden}
        .hero-preview-body img{width:100%;height:100%;object-fit:cover;object-position:top}

        /* Placeholder skeleton */
        .hero-pp{width:100%;height:100%;padding:20px;display:grid;grid-template-columns:200px 1fr;gap:16px}
        .hero-pp-sb{background:rgba(255,255,255,.02);border-radius:10px;padding:16px}
        .hero-pp-ni{height:10px;background:rgba(255,255,255,.04);border-radius:4px;margin-bottom:10px;width:70%}
        .hero-pp-ni.act{background:rgba(99,102,241,.15);width:85%}
        .hero-pp-m{display:flex;flex-direction:column;gap:12px}
        .hero-pp-sr{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
        .hero-pp-st{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.03);border-radius:10px;padding:14px;height:72px}
        .hero-pp-sl{height:6px;width:40%;background:rgba(255,255,255,.06);border-radius:3px;margin-bottom:10px}
        .hero-pp-sv{height:12px;width:65%;background:rgba(99,102,241,.1);border-radius:4px}
        .hero-pp-ch{flex:1;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.03);border-radius:10px;min-height:200px;position:relative;overflow:hidden}
        .hero-pp-ch::after{content:'';position:absolute;bottom:20%;left:5%;right:5%;height:2px;background:linear-gradient(90deg,rgba(99,102,241,.1),rgba(0,229,160,.2),rgba(99,102,241,.1));border-radius:1px}
        .hero-preview-fade{position:absolute;bottom:0;left:0;right:0;height:120px;background:linear-gradient(transparent,#030306);z-index:2;pointer-events:none}

        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeDown{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{background-position:0% center}100%{background-position:200% center}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @media(max-width:768px){.hero-content{padding-top:60px}.hero-nav-links a:not(.hero-nav-cta){display:none}.hero-actions{flex-direction:column;width:100%;padding:0 20px}.hero-btn-primary,.hero-btn-ghost{width:100%;text-align:center}.hero-pp{grid-template-columns:1fr}.hero-pp-sb{display:none}.hero-pp-sr{grid-template-columns:repeat(2,1fr)}}
      `}</style>

      <div className="hero">
        {/* Aura animated background */}
        <div className="aura-bg" data-alpha-mask="80">
          <div data-us-project="bcBYZIStYXwiogchBNHO" />
        </div>

        <nav className="hero-nav">
          <div className="hero-nav-brand">
            <img src="/logo.png" alt="Tradevanish" />
            <span>Tradevanish</span>
          </div>
          <div className="hero-nav-links">
            <a href="/docs">Docs</a>
            <a href="/docs/rest-api">API</a>
            <a href="/docs/quickstart">Quick Start</a>
            <a href="/app" className="hero-nav-cta">Launch App</a>
          </div>
        </nav>

        <div className="hero-content">
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            Stealth copy trading for prop firm traders
          </div>

          <h1 className="hero-h1">
            Trade once.<br />
            <span className="accent">Execute everywhere.</span>
          </h1>

          <p className="hero-sub">
            One master trade replicates to every prop firm account instantly.
            Each connection isolated behind its own residential IP.<br />
            <span style={{color:'rgba(255,255,255,0.55)',fontWeight:500}}>No shared fingerprints. No correlation. No detection.</span>
          </p>

          <div className="hero-actions">
            <a href="/sign-up" className="hero-btn-primary">Get Started Free</a>
            <a href="/docs" className="hero-btn-ghost">Read the Docs</a>
          </div>
        </div>

        <div className="hero-preview">
          <div className="hero-preview-frame">
            <div className="hero-preview-chrome">
              <div className="hero-preview-dot" />
              <div className="hero-preview-dot" />
              <div className="hero-preview-dot" />
              <span className="hero-preview-url">www.tradevanish.com</span>
            </div>
            <div className="hero-preview-body">
              {/* Replace with: <img src="/dashboard-preview.png" alt="Dashboard" /> */}
              <div className="hero-pp">
                <div className="hero-pp-sb">
                  <div className="hero-pp-ni act" />
                  <div className="hero-pp-ni" />
                  <div className="hero-pp-ni" />
                  <div className="hero-pp-ni" />
                  <div className="hero-pp-ni" />
                </div>
                <div className="hero-pp-m">
                  <div className="hero-pp-sr">
                    {[0,1,2,3].map(i => (
                      <div key={i} className="hero-pp-st">
                        <div className="hero-pp-sl" />
                        <div className="hero-pp-sv" />
                      </div>
                    ))}
                  </div>
                  <div className="hero-pp-ch" />
                </div>
              </div>
            </div>
            <div className="hero-preview-fade" />
          </div>
        </div>
      </div>
    </>
  );
}

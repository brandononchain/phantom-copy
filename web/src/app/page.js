'use client';

import { useEffect } from 'react';

export default function LandingPage() {

  useEffect(() => {
    // If Tradovate OAuth callback landed here, redirect to /app
    if (typeof window !== 'undefined' && window.location.search.includes('tradovate_token')) {
      window.location.href = '/app' + window.location.search;
      return;
    }

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
        
        /* Hidden scrollbars globally - sleek UX */
        html{scrollbar-width:none;-ms-overflow-style:none}
        html::-webkit-scrollbar,body::-webkit-scrollbar,*::-webkit-scrollbar{width:0;height:0;display:none}
        *{scrollbar-width:none;-ms-overflow-style:none}

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
        /* ═══════════ Dashboard Mockup Preview ═══════════ */
        .dash-mockup{width:100%;height:100%;display:flex;background:#050508;font-family:'Plus Jakarta Sans',-apple-system,sans-serif;color:rgba(255,255,255,0.92);font-size:11px;overflow:hidden}
        
        /* Sidebar */
        .dm-sidebar{width:170px;flex-shrink:0;background:#050508;border-right:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;padding:14px 8px}
        .dm-brand{display:flex;align-items:center;gap:8px;padding:4px 8px;margin-bottom:16px}
        .dm-logo{width:22px;height:22px;border-radius:5px;background:linear-gradient(135deg,#6366F1,#A78BFA);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:#fff}
        .dm-brand span{font-size:12px;font-weight:700;letter-spacing:-0.02em}
        .dm-nav{flex:1;display:flex;flex-direction:column;gap:1px}
        .dm-nav-btn{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:none;background:transparent;color:rgba(255,255,255,0.5);font-family:inherit;font-size:10.5px;font-weight:500;border-radius:7px;cursor:pointer;transition:all 0.2s;text-align:left}
        .dm-nav-btn:hover{background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.92)}
        .dm-nav-btn.active{background:rgba(99,102,241,0.1);color:#fff}
        .dm-nav-btn svg{width:13px;height:13px;opacity:0.5;flex-shrink:0}
        .dm-nav-btn.active svg{opacity:1;stroke:#6366F1}
        .dm-live-badge{margin-left:auto;background:rgba(0,229,160,0.1);color:#00E5A0;font-size:7px;font-weight:700;padding:1px 5px;border-radius:20px;font-family:'DM Mono',monospace;letter-spacing:0.05em}
        .dm-profile{margin-top:auto;padding:8px;border-top:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:7px}
        .dm-avatar{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#6366F1,#A78BFA);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:9px;color:#fff;flex-shrink:0}
        .dm-profile-name{font-size:10px;font-weight:600;line-height:1.2}
        .dm-profile-plan{font-size:7.5px;color:#6366F1;font-weight:700;letter-spacing:0.05em;margin-top:1px}

        /* Main */
        .dm-main{flex:1;padding:18px 22px;overflow:hidden}
        .dm-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;gap:12px}
        .dm-title{font-size:17px;font-weight:800;letter-spacing:-0.02em;line-height:1.1}
        .dm-sub{font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px}

        /* Stats */
        .dm-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
        .dm-stat-card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:9px;padding:10px 11px}
        .dm-stat-label{font-size:7.5px;font-weight:600;letter-spacing:0.1em;color:rgba(255,255,255,0.3);margin-bottom:5px}
        .dm-stat-val{font-size:16px;font-weight:800;font-family:'DM Mono',monospace;letter-spacing:-0.03em;line-height:1}
        .dm-stat-sub{font-size:8.5px;color:rgba(255,255,255,0.3);margin-top:3px;font-family:'DM Mono',monospace}

        /* Cards */
        .dm-card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px 14px;margin-bottom:10px}
        .dm-card-hd{display:flex;align-items:center;gap:8px;margin-bottom:10px}
        .dm-card-t{font-size:11px;font-weight:700}
        .dm-badge{font-size:7px;font-weight:700;letter-spacing:0.08em;padding:2px 5px;border-radius:4px;border:1px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.02);display:inline-flex;align-items:center;gap:3px}
        .dm-badge-warn{color:#FFB800;border-color:rgba(255,184,0,0.2);background:rgba(255,184,0,0.08)}
        .dm-badge-live{background:rgba(0,229,160,0.08);color:#00E5A0;border-color:rgba(0,229,160,0.2)}
        .dm-live-dot{width:4px;height:4px;border-radius:50%;background:#00E5A0;animation:pulse 2s infinite}
        
        /* Master row */
        .dm-master-row{display:flex;align-items:center;gap:12px;padding:6px 0}
        .dm-m-info{display:flex;align-items:center;gap:7px}
        .dm-m-name{font-size:10.5px;font-weight:700}
        .dm-m-sub{font-size:8.5px;color:rgba(255,255,255,0.3)}
        .dm-dot-active{width:6px;height:6px;border-radius:50%;background:#00E5A0;box-shadow:0 0 6px rgba(0,229,160,0.5);flex-shrink:0}
        .dm-ip-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.15);border-radius:5px;font-family:'DM Mono',monospace;font-size:8.5px;color:#C4B5FD;margin-left:auto}
        .dm-lat{display:flex;align-items:center;gap:5px;font-family:'DM Mono',monospace;font-size:8.5px}
        .dm-lat-label{color:rgba(255,255,255,0.3);font-weight:600}
        .dm-lat-fill{width:30px;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden}
        .dm-lat-fill span{display:block;height:100%;border-radius:2px}
        .dm-m-balance{font-family:'DM Mono',monospace;font-size:10.5px;font-weight:700;color:#00E5A0}

        /* Stats bar */
        .dm-stats-bar{display:grid;grid-template-columns:repeat(6,1fr);gap:1px;background:rgba(255,255,255,0.06);border-radius:7px;overflow:hidden;margin-top:8px}
        .dm-sb-item{background:rgba(255,255,255,0.015);padding:8px 8px;text-align:center}
        .dm-sb-label{font-size:7px;font-weight:600;letter-spacing:0.1em;color:rgba(255,255,255,0.3);margin-bottom:3px}
        .dm-sb-val{font-size:10px;font-weight:700;font-family:'DM Mono',monospace}

        /* Trade table */
        .dm-tbl{width:100%;border-collapse:collapse}
        .dm-tbl th{font-size:7px;font-weight:600;letter-spacing:0.1em;color:rgba(255,255,255,0.3);text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06)}
        .dm-tbl td{font-size:9.5px;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,0.03);font-family:'DM Mono',monospace}
        .dm-tbl tr:last-child td{border-bottom:none}
        .dm-tbl-dim{color:rgba(255,255,255,0.3)}
        .dm-tbl-bold{font-weight:700;color:rgba(255,255,255,0.92);font-family:'Plus Jakarta Sans',sans-serif}

        /* Hide dashboard scrollbars */
        .dash-mockup,.dm-main,.dm-sidebar{scrollbar-width:none;-ms-overflow-style:none}
        .dash-mockup::-webkit-scrollbar,.dm-main::-webkit-scrollbar,.dm-sidebar::-webkit-scrollbar{display:none}

        .hero-preview-fade{position:absolute;bottom:0;left:0;right:0;height:120px;background:linear-gradient(transparent,#030306);z-index:2;pointer-events:none}
        /* ═══════════ End Dashboard Mockup ═══════════ */

        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeDown{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{background-position:0% center}100%{background-position:200% center}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @media(max-width:768px){.hero-content{padding-top:48px}.hero-nav{padding:16px 20px}.hero-nav-links a:not(.hero-nav-cta){display:none}.hero-h1{font-size:clamp(32px,8vw,42px);margin-bottom:16px}.hero-sub{font-size:15px;margin-bottom:28px;max-width:100%;padding:0 8px}.hero-actions{flex-direction:column;width:100%;padding:0 20px;gap:10px}.hero-btn-primary,.hero-btn-ghost{width:100%;text-align:center;padding:16px 24px;font-size:15px;min-height:48px}.hero-preview{margin-top:36px;padding:0 16px 40px}.hero-preview-frame{border-radius:12px;aspect-ratio:auto;height:340px}.hero-badge{font-size:11px}
        /* Mobile dashboard mockup */
        .dm-sidebar{width:54px;padding:10px 4px}
        .dm-brand span,.dm-profile-name,.dm-profile-plan,.dm-nav-btn span,.dm-live-badge{display:none}
        .dm-brand{justify-content:center;padding:4px;margin-bottom:10px}
        .dm-nav-btn{justify-content:center;padding:7px}
        .dm-nav-btn svg{width:15px;height:15px}
        .dm-profile{justify-content:center;padding:4px}
        .dm-profile>div:last-child{display:none}
        .dm-main{padding:12px}
        .dm-title{font-size:13px}
        .dm-sub{display:none}
        .dm-stats{grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:10px}
        .dm-stat-card{padding:7px 8px}
        .dm-stat-val{font-size:12px}
        .dm-stat-label{font-size:6.5px}
        .dm-stat-sub{font-size:7px}
        .dm-card{padding:8px 10px;margin-bottom:8px}
        .dm-card-t{font-size:10px}
        .dm-stats-bar{grid-template-columns:repeat(3,1fr)}
        .dm-sb-val{font-size:8.5px}
        .dm-tbl th{font-size:6px;padding:4px 5px}
        .dm-tbl td{font-size:8px;padding:4px 5px}
        .dm-master-row{flex-wrap:wrap;gap:8px}
        .dm-ip-badge{font-size:7.5px}
        .dm-head .hero-btn-primary{padding:7px 12px!important;font-size:10px!important}
        }
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
              <div className="dash-mockup">
                <aside className="dm-sidebar">
                  <div className="dm-brand">
                    <div className="dm-logo">T</div>
                    <span>Tradevanish</span>
                  </div>
                  <nav className="dm-nav">
                    <button className="dm-nav-btn active">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                      Overview
                      <span className="dm-live-badge">LIVE</span>
                    </button>
                    <button className="dm-nav-btn">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                      Accounts
                    </button>
                    <button className="dm-nav-btn">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                      IP Mixer
                    </button>
                    <button className="dm-nav-btn">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                      Trade Log
                    </button>
                    <button className="dm-nav-btn">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                      Settings
                    </button>
                  </nav>
                  <div className="dm-profile">
                    <div className="dm-avatar">AT</div>
                    <div>
                      <div className="dm-profile-name">Alex Trader</div>
                      <div className="dm-profile-plan">PRO+ PLAN</div>
                    </div>
                  </div>
                </aside>

                <main className="dm-main">
                  <header className="dm-head">
                    <div>
                      <h1 className="dm-title">Overview</h1>
                      <p className="dm-sub">Real-time copy trading performance across all accounts</p>
                    </div>
                    <a href="/sign-up" className="hero-btn-primary" style={{padding:'10px 20px',fontSize:'12.5px',borderRadius:'10px',display:'inline-flex',alignItems:'center',gap:'8px',boxShadow:'0 0 20px rgba(99,102,241,0.2)'}}>
                      <span>+ Connect Account</span>
                    </a>
                  </header>

                  <div className="dm-stats">
                    <div className="dm-stat-card">
                      <div className="dm-stat-label">TOTAL BALANCE</div>
                      <div className="dm-stat-val" style={{color:'#00E5A0'}}>$247,850.00</div>
                      <div className="dm-stat-sub">+$3,420.50 today</div>
                    </div>
                    <div className="dm-stat-card">
                      <div className="dm-stat-label">ACTIVE FOLLOWERS</div>
                      <div className="dm-stat-val">12</div>
                      <div className="dm-stat-sub">across 3 platforms</div>
                    </div>
                    <div className="dm-stat-card">
                      <div className="dm-stat-label">TODAY'S TRADES</div>
                      <div className="dm-stat-val">38</div>
                      <div className="dm-stat-sub">92% fill rate</div>
                    </div>
                    <div className="dm-stat-card">
                      <div className="dm-stat-label">COPY LATENCY</div>
                      <div className="dm-stat-val" style={{color:'#00E5A0'}}>18ms</div>
                      <div className="dm-stat-sub">avg across followers</div>
                    </div>
                  </div>

                  <div className="dm-card">
                    <div className="dm-card-hd">
                      <h2 className="dm-card-t">Master Account</h2>
                      <span className="dm-badge dm-badge-warn">SIGNAL SOURCE</span>
                    </div>
                    <div className="dm-master-row">
                      <div className="dm-m-info">
                        <span className="dm-dot-active" />
                        <div>
                          <div className="dm-m-name">TopStep 100k Master</div>
                          <div className="dm-m-sub">TopStepX</div>
                        </div>
                      </div>
                      <div className="dm-ip-badge">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="1.5"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="7" cy="12" r="1.5" fill="#A78BFA"/></svg>
                        63.72.xx.87
                      </div>
                      <div className="dm-lat">
                        <span className="dm-lat-label">LATENCY</span>
                        <div className="dm-lat-fill"><span style={{width:'25%',background:'#00E5A0'}}/></div>
                        <span style={{color:'#00E5A0',fontWeight:700}}>12ms</span>
                      </div>
                      <div className="dm-m-balance">$150,000.00</div>
                    </div>

                    <div className="dm-stats-bar">
                      <div className="dm-sb-item"><div className="dm-sb-label">BALANCE</div><div className="dm-sb-val" style={{color:'#00E5A0'}}>$150,000</div></div>
                      <div className="dm-sb-item"><div className="dm-sb-label">EQUITY</div><div className="dm-sb-val">$151,245</div></div>
                      <div className="dm-sb-item"><div className="dm-sb-label">P&L</div><div className="dm-sb-val" style={{color:'#00E5A0'}}>+$3,420</div></div>
                      <div className="dm-sb-item"><div className="dm-sb-label">TRADES</div><div className="dm-sb-val">142</div></div>
                      <div className="dm-sb-item"><div className="dm-sb-label">WIN RATE</div><div className="dm-sb-val" style={{color:'#00E5A0'}}>68.3%</div></div>
                      <div className="dm-sb-item"><div className="dm-sb-label">W / L</div><div className="dm-sb-val">97 / 45</div></div>
                    </div>
                  </div>

                  <div className="dm-card">
                    <div className="dm-card-hd">
                      <h2 className="dm-card-t">Recent Trades</h2>
                      <span className="dm-badge dm-badge-live"><span className="dm-live-dot"/>LIVE</span>
                    </div>
                    <table className="dm-tbl">
                      <thead>
                        <tr><th>TIME</th><th>CONTRACT</th><th>SIDE</th><th>QTY</th><th>PRICE</th><th>FILLS</th><th>LATENCY</th><th>STATUS</th></tr>
                      </thead>
                      <tbody>
                        <tr><td className="dm-tbl-dim">14:32:18</td><td className="dm-tbl-bold">NQM26</td><td style={{color:'#00E5A0'}}>BUY</td><td>2</td><td>21,847.50</td><td>12 / 12</td><td style={{color:'#00E5A0'}}>14ms</td><td><span className="dm-badge dm-badge-live"><span className="dm-live-dot"/>FILLED</span></td></tr>
                        <tr><td className="dm-tbl-dim">14:28:44</td><td className="dm-tbl-bold">ESM26</td><td style={{color:'#FF4D4D'}}>SELL</td><td>1</td><td>5,892.25</td><td>12 / 12</td><td style={{color:'#00E5A0'}}>18ms</td><td><span className="dm-badge dm-badge-live"><span className="dm-live-dot"/>FILLED</span></td></tr>
                        <tr><td className="dm-tbl-dim">14:15:02</td><td className="dm-tbl-bold">NQM26</td><td style={{color:'#FF4D4D'}}>SELL</td><td>2</td><td>21,832.00</td><td>11 / 12</td><td style={{color:'#FFB800'}}>42ms</td><td><span className="dm-badge dm-badge-warn">PARTIAL</span></td></tr>
                      </tbody>
                    </table>
                  </div>
                </main>
              </div>
            </div>
            <div className="hero-preview-fade" />
          </div>
        </div>
      </div>
    </>
  );
}

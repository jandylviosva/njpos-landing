import { useState } from 'react';

const P = '#2563EB';
const P_DARK = '#1E40AF';
const NAVY = '#0f1629';

const css = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --p:#2563EB;--p-light:#60A5FA;--p-dark:#1E40AF;
    --p-glow:rgba(37,99,235,0.35);
    --navy:#0f1629;--navy2:#141c35;
    --gold:#f59e0b;--green:#10b981;
    --white:#fff;--off:#f5f5ff;
    --gray:#6b7280;--gray-light:#9ca3af;
    --border:#e5e7eb;--text:#111827;
    --radius:12px;--font:'Inter',sans-serif;
  }
  html{scroll-behavior:smooth}
  body{font-family:var(--font);color:var(--text);background:#fff;line-height:1.6;-webkit-font-smoothing:antialiased}
  .announce-bar{background:linear-gradient(90deg,var(--p-dark),var(--p));padding:9px 5vw;text-align:center;font-size:13px;font-weight:600;color:#fff;display:flex;align-items:center;justify-content:center;gap:8px}
  @keyframes pulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.4);opacity:.5}}
  .pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;opacity:.9;animation:pulse 2s ease infinite}
  nav{position:sticky;top:0;z-index:100;background:rgba(15,22,41,.95);backdrop-filter:blur(14px);border-bottom:1px solid rgba(255,255,255,.07);padding:0 5vw;height:64px;display:flex;align-items:center;justify-content:space-between}
  .nav-logo{display:flex;align-items:center;gap:10px;text-decoration:none}
  .nav-logo-icon{width:36px;height:36px;border-radius:9px;overflow:hidden;flex-shrink:0}
  .nav-logo-icon img{width:100%;height:100%;object-fit:contain}
  .nav-logo-text{font-size:17px;font-weight:800;color:#fff;letter-spacing:-.3px}
  .nav-links{display:flex;align-items:center;gap:28px}
  .nav-links a{color:rgba(255,255,255,.65);text-decoration:none;font-size:14px;font-weight:500;transition:color .15s}
  .nav-links a:hover{color:#fff}
  .nav-right{display:flex;align-items:center;gap:12px}
  .nav-price{font-size:13px;font-weight:700;color:rgba(255,255,255,.45);white-space:nowrap}
  .nav-price strong{color:var(--p-light)}
  .nav-cta{background:var(--p);color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;transition:background .15s,transform .1s;box-shadow:0 2px 10px var(--p-glow)}
  .nav-cta:hover{background:var(--p-dark);transform:translateY(-1px)}
  .nav-hamburger{display:none;background:none;border:none;cursor:pointer;color:#fff;font-size:22px}
  .hero{background:var(--navy);padding:72px 5vw 80px;display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;min-height:calc(100vh - 100px);position:relative;overflow:hidden}
  .hero::before{content:'';position:absolute;top:-160px;right:-160px;width:560px;height:560px;background:radial-gradient(circle,rgba(37,99,235,.2) 0%,transparent 68%);pointer-events:none}
  .hero-eyebrow{display:inline-flex;align-items:center;gap:7px;background:rgba(37,99,235,.15);border:1px solid rgba(96,165,250,.35);border-radius:20px;padding:5px 14px;font-size:12px;font-weight:700;color:var(--p-light);margin-bottom:18px}
  .hero h1{font-size:clamp(30px,4.2vw,54px);font-weight:900;color:#fff;line-height:1.08;letter-spacing:-1.5px;margin-bottom:16px}
  .hero h1 em{font-style:normal;background:linear-gradient(130deg,#93C5FD,#60A5FA,#3B82F6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .hero-price-hook{display:inline-flex;align-items:center;gap:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px 18px;margin-bottom:22px;flex-wrap:wrap}
  .hero-price-main{display:flex;align-items:baseline;gap:4px}
  .hero-price-currency{font-size:18px;font-weight:800;color:rgba(255,255,255,.6)}
  .hero-price-amount{font-size:38px;font-weight:900;color:#fff;letter-spacing:-1.5px;line-height:1}
  .hero-price-period{font-size:14px;font-weight:600;color:rgba(255,255,255,.4)}
  .hero-price-divider{width:1px;height:36px;background:rgba(255,255,255,.1);flex-shrink:0}
  .hero-price-perks{display:flex;flex-direction:column;gap:3px}
  .hero-price-perk{font-size:12px;font-weight:600;color:rgba(255,255,255,.55);display:flex;align-items:center;gap:5px}
  .hero-price-perk i{color:var(--green);font-size:12px}
  .hero-sub{font-size:16px;color:rgba(255,255,255,.55);margin-bottom:30px;max-width:460px;line-height:1.75}
  .hero-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:28px}
  .btn-primary{background:var(--p);color:#fff;padding:14px 26px;border-radius:10px;font-size:15px;font-weight:800;text-decoration:none;display:inline-flex;align-items:center;gap:8px;transition:background .15s,transform .12s,box-shadow .15s;box-shadow:0 4px 20px var(--p-glow);border:none;cursor:pointer;font-family:var(--font)}
  .btn-primary:hover{background:var(--p-dark);transform:translateY(-2px);box-shadow:0 8px 28px var(--p-glow)}
  .btn-ghost{color:rgba(255,255,255,.75);padding:14px 22px;font-size:15px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.14);border-radius:10px;transition:border-color .15s,color .15s,background .15s}
  .btn-ghost:hover{border-color:rgba(255,255,255,.3);color:#fff;background:rgba(255,255,255,.05)}
  .btn-white{background:#fff;color:var(--p);padding:15px 32px;border-radius:10px;font-size:15px;font-weight:800;text-decoration:none;display:inline-flex;align-items:center;gap:8px;box-shadow:0 8px 28px rgba(0,0,0,.25);transition:transform .12s,box-shadow .15s;border:none;cursor:pointer;font-family:var(--font)}
  .btn-white:hover{transform:translateY(-2px);box-shadow:0 14px 40px rgba(0,0,0,.3)}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
  .mockup-wrap{position:relative}
  .mockup-phone{background:#fff;border-radius:22px;box-shadow:0 40px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.06);overflow:hidden;max-width:330px;margin:0 auto;animation:float 5s ease-in-out infinite}
  .mockup-topbar{background:var(--navy);padding:10px 14px;display:flex;align-items:center;justify-content:space-between}
  .mockup-logo{display:flex;align-items:center;gap:8px}
  .mockup-logo-icon{width:28px;height:28px;border-radius:7px;overflow:hidden}
  .mockup-logo-icon img{width:100%;height:100%;object-fit:cover}
  .mockup-store{font-size:12px;font-weight:700;color:#fff}
  .mockup-store span{font-size:9px;color:rgba(255,255,255,.4);display:block;font-weight:400}
  .mockup-sync{display:flex;align-items:center;gap:5px}
  .mockup-sync-dot{width:7px;height:7px;border-radius:50%;background:#10b981;box-shadow:0 0 6px #10b981}
  .mockup-sync-text{font-size:9px;color:rgba(255,255,255,.4)}
  .mockup-cats{display:flex;gap:5px;padding:7px 10px;background:#f5f5ff;border-bottom:1px solid #e5e7eb;overflow-x:auto;scrollbar-width:none}
  .mockup-cat{padding:3px 10px;border-radius:20px;font-size:9px;font-weight:700;background:#e5e7eb;color:#6b7280;white-space:nowrap}
  .mockup-cat.active{background:var(--mockup-accent, var(--p));color:#fff}
  .mockup-products{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;padding:7px;background:#f0f0f8}
  .mockup-product{background:#fff;border-radius:8px;padding:6px 4px;text-align:center;border:1.5px solid #e5e7eb;font-size:8px}
  .mockup-product.active{border-color:var(--mockup-accent, var(--p))}
  .mockup-prod-img{width:30px;height:30px;border-radius:5px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;margin:0 auto 3px;font-size:14px;overflow:hidden}
  .mockup-prod-img img{width:100%;height:100%;object-fit:cover}
  .mockup-prod-name{font-weight:700;color:#111;line-height:1.2;margin-bottom:1px}
  .mockup-prod-price{color:var(--mockup-accent, var(--p));font-weight:800}
  .mockup-prod-stock{color:#9ca3af;font-size:7px}
  .mockup-cart{background:#fff;border-top:1px solid #e5e7eb;padding:9px}
  .mockup-cart-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}
  .mockup-cart-title{font-size:11px;font-weight:800}
  .mockup-cart-badge{background:var(--mockup-accent, var(--p));color:#fff;border-radius:10px;padding:1px 6px;font-size:8px;font-weight:800}
  .mockup-cart-item{display:flex;justify-content:space-between;align-items:center;font-size:9px;padding:3px 0;color:#374151;border-bottom:.5px solid #f3f4f6}
  .mockup-total-row{display:flex;justify-content:space-between;font-size:12px;font-weight:800;padding-top:6px;margin-top:3px;border-top:1px dashed #e5e7eb}
  .mockup-total-row span:last-child{color:var(--mockup-accent, var(--p))}
  .mockup-charge-btn{width:100%;margin-top:7px;background:var(--mockup-accent, var(--p));color:#fff;border:none;border-radius:8px;padding:9px;font-size:11px;font-weight:800;cursor:pointer}
  .mockup-badge{position:absolute;z-index:5;background:#fff;border-radius:10px;padding:8px 11px;box-shadow:0 8px 24px rgba(0,0,0,.14);font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px;white-space:nowrap;animation:float 5s ease-in-out infinite}
  .mockup-badge i{font-size:14px}
  .badge-gcash{top:36px;right:-32px;color:#007bff;animation-delay:.6s}
  .badge-sync{bottom:130px;left:-44px;color:var(--green);animation-delay:1.2s}
  .badge-sale{bottom:48px;right:-28px;color:var(--p);animation-delay:1.8s}
  .stats{background:var(--navy2);border-top:1px solid rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.05);padding:0 5vw;display:grid;grid-template-columns:repeat(4,1fr)}
  .stat{text-align:center;padding:32px 16px;border-right:1px solid rgba(255,255,255,.06)}
  .stat:last-child{border-right:none}
  .stat-num{font-size:32px;font-weight:900;color:#fff;letter-spacing:-1px;line-height:1;margin-bottom:5px}
  .stat-num .accent{color:var(--p-light)}
  .stat-label{font-size:12px;color:rgba(255,255,255,.38);font-weight:500;line-height:1.4}
  .value-strip{background:linear-gradient(135deg,#f5f3ff,#ede9fe);border-bottom:1px solid #ddd6fe;padding:18px 5vw;display:flex;align-items:center;justify-content:center;gap:32px;flex-wrap:wrap}
  .value-item{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#4338ca}
  .value-item i{font-size:16px;color:var(--p)}
  section{padding:80px 5vw}
  .section-eyebrow{font-size:11px;font-weight:800;color:var(--p);text-transform:uppercase;letter-spacing:2px;margin-bottom:10px}
  .section-title{font-size:clamp(24px,3.2vw,38px);font-weight:900;letter-spacing:-.8px;line-height:1.15;color:var(--text);margin-bottom:12px}
  .section-sub{font-size:15px;color:var(--gray);max-width:520px;line-height:1.75;margin-bottom:48px}
  .section-center{text-align:center}
  .section-center .section-sub{margin-left:auto;margin-right:auto}
  .features{background:var(--off)}
  .features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px}
  .feature-card{background:#fff;border-radius:14px;padding:26px;border:1px solid var(--border);transition:box-shadow .22s,transform .22s,border-color .22s;cursor:default}
  .feature-card:hover{box-shadow:0 16px 48px rgba(37,99,235,.1);transform:translateY(-4px);border-color:rgba(37,99,235,.18)}
  .feature-icon{width:44px;height:44px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:14px}
  .feature-card h3{font-size:15px;font-weight:800;margin-bottom:7px;color:var(--text)}
  .feature-card p{font-size:13px;color:var(--gray);line-height:1.7}
  .feature-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}
  .feature-tag{font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;background:#f5f5ff;color:#3B82F6;border:1px solid #e0e7ff}
  .how{background:#fff}
  .how-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;position:relative}
  .how-steps::before{content:'';position:absolute;top:28px;left:calc(16.67% + 24px);right:calc(16.67% + 24px);height:2px;background:linear-gradient(90deg,var(--p),var(--p-light));opacity:.2}
  .how-step{text-align:center}
  .how-step-num{width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--p-dark));color:#fff;font-size:20px;font-weight:900;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;box-shadow:0 8px 24px var(--p-glow)}
  .how-step h3{font-size:15px;font-weight:800;margin-bottom:7px}
  .how-step p{font-size:13px;color:var(--gray);line-height:1.7}
  .payments{background:var(--navy);padding:60px 5vw;text-align:center}
  .payments h2{font-size:clamp(20px,3vw,32px);font-weight:900;color:#fff;margin-bottom:8px;letter-spacing:-.5px}
  .payments p{color:rgba(255,255,255,.45);font-size:14px;margin-bottom:32px}
  .payment-methods{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}
  .payment-pill{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:11px 18px;display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700;color:#fff;transition:background .15s}
  .payment-pill:hover{background:rgba(255,255,255,.11)}
  .payment-pill i{font-size:17px}
  .pill-cash i{color:#10b981}
  .pill-gcash i{color:#60a5fa}
  .pill-maya i{color:#a78bfa}
  .pill-card i{color:#f59e0b}
  .pill-qr i{color:#34d399}
  .pricing{background:var(--off);padding:80px 5vw}
  .pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;max-width:1100px;margin:0 auto}
  .pricing-card{background:#fff;border-radius:18px;padding:36px 30px;border:2px solid var(--border);position:relative;transition:box-shadow .22s}
  .pricing-card:hover{box-shadow:0 20px 56px rgba(0,0,0,.08)}
  .pricing-card.featured{border-color:var(--p);box-shadow:0 20px 56px rgba(37,99,235,.18)}
  .pricing-badge{position:absolute;top:-13px;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,var(--p-dark),var(--p));color:#fff;font-size:11px;font-weight:800;padding:4px 16px;border-radius:20px;white-space:nowrap}
  .pricing-urgency{display:flex;align-items:center;gap:6px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:7px 12px;margin-bottom:20px;font-size:12px;font-weight:700;color:#dc2626}
  .pricing-name{font-size:12px;font-weight:800;color:var(--gray);margin-bottom:8px;text-transform:uppercase;letter-spacing:1.2px}
  .pricing-amount{font-size:44px;font-weight:900;letter-spacing:-2px;color:var(--text);line-height:1;margin-bottom:4px}
  .pricing-amount sup{font-size:22px;font-weight:700;vertical-align:super;letter-spacing:0}
  .pricing-amount .mo{font-size:16px;font-weight:500;color:var(--gray);letter-spacing:0}
  .pricing-note{font-size:12px;color:var(--gray-light);margin-bottom:6px}
  .pricing-compare{display:flex;align-items:center;gap:8px;background:#f0fdf4;border-radius:8px;padding:8px 12px;margin-bottom:24px;font-size:12px;font-weight:700;color:#166534}
  .pricing-compare i{font-size:14px;color:var(--green)}
  .pricing-features{list-style:none;display:flex;flex-direction:column;gap:9px;margin-bottom:26px}
  .pricing-features li{display:flex;align-items:flex-start;gap:9px;font-size:13px;color:#374151;line-height:1.5}
  .pricing-features li i{font-size:15px;color:var(--green);flex-shrink:0;margin-top:1px}
  .pricing-features li.muted{color:var(--gray-light)}
  .pricing-features li.muted i{color:#d1d5db}
  .pricing-cta{display:block;width:100%;padding:13px;border-radius:10px;font-size:15px;font-weight:800;text-align:center;cursor:pointer;border:2px solid transparent;font-family:var(--font);transition:background .15s,transform .12s}
  .pricing-cta.filled{background:var(--p);color:#fff;box-shadow:0 4px 20px var(--p-glow)}
  .pricing-cta.filled:hover{background:var(--p-dark);transform:translateY(-1px)}
  .pricing-cta.outline{background:#fff;color:var(--p);border-color:var(--p)}
  .pricing-cta.outline:hover{background:var(--p);color:#fff}
  .pricing-cta-secondary{display:block;width:100%;padding:9px;margin-top:8px;border-radius:8px;font-size:12px;font-weight:700;text-align:center;cursor:pointer;background:none;border:none;color:var(--gray);font-family:var(--font);text-decoration:underline;text-underline-offset:2px}
  .pricing-cta-secondary:hover{color:var(--p)}
  .pricing-cta-note{text-align:center;font-size:11px;color:var(--gray-light);margin-top:9px}
  .pricing-addons{max-width:860px;margin:32px auto 0;background:#fff;border-radius:16px;border:1px solid var(--border);padding:26px 28px}
  .pricing-addons h3{font-size:15px;font-weight:800;margin-bottom:14px;color:var(--text)}
  .addons-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
  .addon{background:var(--off);border-radius:10px;padding:13px 15px;border:1px solid var(--border)}
  .addon-name{font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px}
  .addon-price{font-size:13px;font-weight:800;color:var(--p);margin-bottom:3px}
  .addon-desc{font-size:11px;color:var(--gray)}
  .testimonials{background:#fff}
  .testi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}
  .testi-card{background:var(--off);border-radius:14px;padding:24px;border:1px solid var(--border);transition:box-shadow .2s,transform .2s}
  .testi-card:hover{box-shadow:0 12px 36px rgba(0,0,0,.07);transform:translateY(-3px)}
  .testi-quote{font-size:28px;color:var(--p-light);line-height:1;margin-bottom:10px;opacity:.6}
  .testi-stars{color:var(--gold);font-size:13px;margin-bottom:10px;letter-spacing:2px}
  .testi-text{font-size:13px;line-height:1.75;color:#374151;margin-bottom:14px}
  .testi-author{display:flex;align-items:center;gap:10px;padding-top:12px;border-top:1px solid var(--border)}
  .testi-avatar{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:800;flex-shrink:0}
  .testi-name{font-size:13px;font-weight:700;color:var(--text)}
  .testi-biz{font-size:11px;color:var(--gray)}
  .faq{background:var(--off)}
  .faq-list{max-width:700px;margin:0 auto;display:flex;flex-direction:column;gap:4px}
  .faq-item{background:#fff;border-radius:10px;border:1px solid var(--border);overflow:hidden;transition:box-shadow .2s}
  .faq-item.open{box-shadow:0 4px 16px rgba(37,99,235,.08);border-color:rgba(37,99,235,.2)}
  .faq-q{width:100%;background:none;border:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:17px 20px;font-size:14px;font-weight:700;color:var(--text);text-align:left;gap:12px;transition:background .15s;font-family:var(--font)}
  .faq-q:hover{background:#fafafe}
  .faq-q i{font-size:17px;color:var(--p);flex-shrink:0;transition:transform .25s}
  .faq-item.open .faq-q i{transform:rotate(45deg)}
  .faq-a{font-size:13px;color:var(--gray);line-height:1.75;max-height:0;overflow:hidden;transition:max-height .3s ease,padding .2s;padding:0 20px}
  .faq-item.open .faq-a{max-height:300px;padding:0 20px 17px}
  .cta-banner{background:linear-gradient(135deg,#2e1065,var(--p-dark),var(--p));padding:84px 5vw;text-align:center;position:relative;overflow:hidden}
  .cta-banner h2{font-size:clamp(24px,4vw,42px);font-weight:900;color:#fff;letter-spacing:-1px;margin-bottom:12px}
  .cta-banner p{font-size:16px;color:rgba(255,255,255,.65);margin-bottom:10px;max-width:440px;margin-left:auto;margin-right:auto}
  .cta-price-callout{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:10px 20px;margin-bottom:28px;font-size:15px;font-weight:700;color:rgba(255,255,255,.85)}
  .cta-price-callout strong{color:#fff;font-size:18px}
  .cta-guarantee{font-size:12px;color:rgba(255,255,255,.4);margin-top:16px}
  footer{background:var(--navy);padding:56px 5vw 28px}
  .footer-top{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:44px;margin-bottom:44px;padding-bottom:36px;border-bottom:1px solid rgba(255,255,255,.07)}
  .footer-brand p{font-size:13px;color:rgba(255,255,255,.35);line-height:1.75;margin-top:12px;max-width:240px}
  .footer-col h4{font-size:11px;font-weight:800;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:1.4px;margin-bottom:14px}
  .footer-col a{display:block;font-size:13px;color:rgba(255,255,255,.4);text-decoration:none;margin-bottom:9px;transition:color .15s}
  .footer-col a:hover{color:#fff}
  .footer-bottom{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
  .footer-bottom p{font-size:12px;color:rgba(255,255,255,.25)}
  .footer-bottom-links{display:flex;gap:18px}
  .footer-bottom-links a{font-size:12px;color:rgba(255,255,255,.25);text-decoration:none;transition:color .15s}
  .footer-bottom-links a:hover{color:rgba(255,255,255,.55)}
  .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:200;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
  .modal-overlay.open{display:flex}
  @keyframes modalIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
  .modal-box{background:#fff;border-radius:22px;padding:36px 32px;width:100%;max-width:420px;position:relative;box-shadow:0 28px 70px rgba(0,0,0,.3);animation:modalIn .2s ease}
  .modal-close-btn{position:absolute;top:14px;right:14px;background:none;border:none;cursor:pointer;color:#9ca3af;font-size:22px;line-height:1}
  .modal-icon{width:52px;height:52px;border-radius:14px;overflow:hidden;margin:0 auto 12px}
  .modal-icon img{width:100%;height:100%;object-fit:contain}
  .modal-title{font-size:20px;font-weight:900;color:var(--text);margin-bottom:4px;text-align:center}
  .modal-sub{font-size:14px;color:var(--gray);text-align:center;margin-bottom:22px}
  .form-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
  .form-label{font-size:11px;font-weight:800;color:var(--gray);text-transform:uppercase;letter-spacing:.5px}
  .form-input{padding:10px 13px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;font-family:var(--font);outline:none;transition:border-color .15s,box-shadow .15s;background:#fff;color:var(--text);width:100%}
  .form-input:focus{border-color:var(--p);box-shadow:0 0 0 3px rgba(37,99,235,.1)}
  .modal-note{text-align:center;font-size:12px;color:var(--gray-light);margin-top:12px;display:flex;align-items:center;justify-content:center;gap:5px}
  .modal-note i{color:var(--green);font-size:13px}
  .modal-success{text-align:center;padding:10px 0}
  @media(max-width:960px){
    .hero{grid-template-columns:1fr;padding:64px 5vw 60px;min-height:auto;text-align:center;gap:44px}
    .hero-sub{margin:0 auto 28px}
    .hero-actions{justify-content:center}
    .hero-price-hook{justify-content:center}
    .nav-links{display:none}
    .nav-price{display:none}
    .nav-hamburger{display:block}
    .how-steps{grid-template-columns:1fr}
    .how-steps::before{display:none}
    .stats{grid-template-columns:repeat(2,1fr)}
    .stat{border-right:none;border-bottom:1px solid rgba(255,255,255,.06)}
    .stat:nth-child(odd){border-right:1px solid rgba(255,255,255,.06)}
    .stat:nth-last-child(-n+2){border-bottom:none}
    .footer-top{grid-template-columns:1fr 1fr}
    .footer-brand{grid-column:1/-1}
    .badge-gcash{top:20px;right:-8px}
    .badge-sync{bottom:110px;left:-10px}
    .badge-sale{bottom:24px;right:-6px}
  }
  @media(max-width:600px){
    .hero{padding:56px 5vw 52px}
    .hero h1{font-size:30px;letter-spacing:-1px}
    .hero-price-hook{flex-direction:column;gap:10px}
    .hero-price-divider{display:none}
    .stats{grid-template-columns:1fr 1fr;padding:0 5vw}
    .stat{padding:22px 10px}
    .footer-top{grid-template-columns:1fr}
    .footer-bottom{flex-direction:column;text-align:center}
    .modal-box{padding:28px 22px}
    .value-strip{gap:12px;padding:14px 5vw}
    .value-item{font-size:12px}
  }
  @media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;

const LOGO = '/icons/icon-192.png';

/* ── CLIENT MOCKUP BRANDING ──
   Baga Burger Malaria uses red (#f90b0b) as their POS theme color.
   This only affects the hero mockup phone — not the rest of the landing page.
   Replace MOCKUP_LOGO with their real logo once uploaded, e.g.:
   const MOCKUP_LOGO = '/images/clients/baga-burger-logo.png';
*/
const MOCKUP_ACCENT = '#f90b0b';
const MOCKUP_LOGO = '/images/clients/baga-burger-malaria-logo.jpg'; // ← replace with real logo file

/* ── HERO MOCKUP PRODUCT DATA ──
   Real client store: Baga Burger Malaria
   Placeholder images below — replace src paths with real product photos.
   1. Drop real images into the repo at: public/images/products/
   2. Use these exact filenames (or update the paths below to match yours):
      beefy-baga.jpg, cheesy-bacon-baga.jpg, chicken-crunch.jpg,
      hotdog-sandwich.jpg, longganiza-burger.jpg, coke.jpg
   Until those files exist, each thumbnail safely falls back to a 🍔 emoji
   (handled by the ProductThumb component below via onError).
*/
const MOCKUP_PRODUCTS = [
  { img: '/images/products/beefy-baga.jpg',        name: 'Beefy Baga',         price: '₱45',  stock: 89,  active: true  },
  { img: '/images/products/cheesy-bacon-baga.jpg', name: 'Cheesy Bacon Baga',  price: '₱87',  stock: 89,  active: false },
  { img: '/images/products/chicken-crunch.jpg',    name: 'Chicken Crunch',     price: '₱50',  stock: 48,  active: true  },
  { img: '/images/products/hotdog-sandwich.jpg',   name: 'Hotdog Sandwich',    price: '₱45',  stock: 50,  active: false },
  { img: '/images/products/longganiza-burger.jpg', name: 'Longganiza Burger',  price: '₱45',  stock: 75,  active: false },
  { img: '/images/products/coke.jpg',              name: 'Coke',               price: '₱25',  stock: 100, active: false },
];

function ProductThumb({ src, fallback }) {
  const [errored, setErrored] = useState(false);
  if (errored || !src) return <span>{fallback}</span>;
  return <img src={src} alt="" onError={() => setErrored(true)}/>;
}

function NavLogo() {
  return (
    <a className="nav-logo" href="#">
      <div className="nav-logo-icon"><img src={LOGO} alt="NJ POS"/></div>
      <span style={{fontFamily:"'Michroma',sans-serif",fontSize:15,letterSpacing:0.5}}><span style={{color:"#60A5FA"}}>NJ</span><span style={{color:"#fff"}}>POS</span></span>
    </a>
  );
}

function TrialModal({ open, onClose }) {
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const name  = e.target.name.value.trim();
    const store = e.target.store.value.trim();
    const email = e.target.email.value.trim().toLowerCase();
    setSending(true); setErr('');
    try {
      const r = await fetch('https://owner.nj-systems.com/api/start-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, storeName: store, ownerName: name }),
      });
      const data = await r.json();
      if (r.ok) { setDone(true); }
      else { setErr(data.error || 'Something went wrong.'); }
    } catch { setErr('Network error. Check your connection.'); }
    setSending(false);
  };

  const close = () => { onClose(); setDone(false); setErr(''); };

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} onClick={e => e.target === e.currentTarget && close()}>
      <div className="modal-box">
        <button className="modal-close-btn" onClick={close}><i className="ti ti-x"/></button>
        {!done ? (
          <>
            <div className="modal-icon"><img src={LOGO} alt="NJ POS"/></div>
            <div className="modal-title">Start Your Free Trial</div>
            <div className="modal-sub">3 days of full access — no payment required</div>
            <form onSubmit={submit}>
              <div className="form-field">
                <label className="form-label">Full Name</label>
                <input name="name" className="form-input" type="text" placeholder="e.g. Maria Santos" required/>
              </div>
              <div className="form-field">
                <label className="form-label">Store Name</label>
                <input name="store" className="form-input" type="text" placeholder="e.g. Maria's Carinderia" required/>
              </div>
              <div className="form-field">
                <label className="form-label">Email Address</label>
                <input name="email" className="form-input" type="email" placeholder="your@email.com" required/>
              </div>
              {err && <div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:13,color:'#991b1b',marginBottom:10}}>{err}</div>}
              <button type="submit" className="btn-primary" disabled={sending} style={{width:'100%',justifyContent:'center',marginTop:4}}>
                <i className={`ti ${sending ? 'ti-loader-2' : 'ti-rocket'}`}/>
                {sending ? 'Sending…' : 'Start Free Trial'}
              </button>
            </form>
            <div className="modal-note"><i className="ti ti-shield-check"/> No credit card · No commitment · Cancel anytime</div>
          </>
        ) : (
          <div className="modal-success">
            <div style={{fontSize:44,marginBottom:12}}>✅</div>
            <div style={{fontSize:19,fontWeight:900,marginBottom:8}}>Trial Code Sent!</div>
            <div style={{fontSize:14,color:'#6b7280',marginBottom:16}}>Check your email for your <strong>TRIAL-XXXX-XXXX</strong> activation code.</div>
            <div style={{background:'#f5f3ff',border:'1px solid #c4b5fd',borderRadius:10,padding:'12px 16px',fontSize:13,color:'#5b21b6'}}>
              📧 Enter the code at <a href="https://pos.nj-systems.com" style={{color:'#2563EB',fontWeight:700}}>pos.nj-systems.com</a> to activate your store.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faq-item${open ? ' open' : ''}`}>
      <button className="faq-q" onClick={() => setOpen(o => !o)}>
        {q}<i className="ti ti-plus"/>
      </button>
      <div className="faq-a">{a}</div>
    </div>
  );
}

export default function App() {
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const openTrial = () => setModalOpen(true);

  return (
    <>
      <style>{css}</style>

      <div className="announce-bar">
        <span className="pulse"/>
        <span><strong>3-day free trial</strong> — No credit card. No commitment. Full access.</span>
        <span className="pulse"/>
      </div>

      <nav>
        <NavLogo/>
        <div className="nav-links" style={menuOpen ? {display:'flex',flexDirection:'column',position:'fixed',top:64,left:0,right:0,background:'rgba(15,22,41,.98)',padding:'20px 5vw 24px',gap:18,zIndex:99,borderBottom:'1px solid rgba(255,255,255,.07)'} : {}}>
          <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
          <a href="#how" onClick={() => setMenuOpen(false)}>How It Works</a>
          <a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
        </div>
        <div className="nav-right">
          <span className="nav-price">from <strong>₱399/mo</strong></span>
          <a href="https://owner.nj-systems.com" className="nav-cta">Owner Login</a>
        </div>
        <button className="nav-hamburger" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
          <i className={`ti ${menuOpen ? 'ti-x' : 'ti-menu-2'}`}/>
        </button>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <div className="hero-eyebrow"><i className="ti ti-bolt"/> Built for Filipino stores</div>
          <h1>Simple Setup,<br/><em>Solid Sales.</em></h1>
          <div className="hero-price-hook">
            <div className="hero-price-main">
              <span className="hero-price-currency">₱</span>
              <span className="hero-price-amount">399</span>
              <span className="hero-price-period">/month</span>
            </div>
            <div className="hero-price-divider"/>
            <div className="hero-price-perks">
              <div className="hero-price-perk"><i className="ti ti-check"/>All features included</div>
              <div className="hero-price-perk"><i className="ti ti-check"/>Cancel anytime</div>
              <div className="hero-price-perk"><i className="ti ti-check"/>3-day free trial</div>
            </div>
          </div>
          <p className="hero-sub">Complete POS for your store — sales, inventory, shifts, GCash, receipts, and reports. No complicated setup, no IT needed.</p>
          <div className="hero-actions">
            <button className="btn-primary" onClick={openTrial}><i className="ti ti-rocket"/>Try Free for 3 Days</button>
            <a href="#features" className="btn-ghost"><i className="ti ti-play"/>See Features</a>
          </div>
        </div>
        <div className="hero-mockup">
          <div className="mockup-wrap">
            <div className="mockup-badge badge-gcash"><i className="ti ti-brand-google-pay"/>GCash accepted</div>
            <div className="mockup-badge badge-sync"><i className="ti ti-cloud-check"/>Cloud synced</div>
            <div className="mockup-badge badge-sale"><i className="ti ti-chart-bar"/>₱12,450 today</div>
            <div className="mockup-phone" style={{'--mockup-accent': MOCKUP_ACCENT}}>
              <div className="mockup-topbar">
                <div className="mockup-logo">
                  <div className="mockup-logo-icon" style={{background:MOCKUP_ACCENT}}>
                    <ProductThumb src={MOCKUP_LOGO} fallback="🍔"/>
                  </div>
                  <div className="mockup-store">BAGA BURGER MALARIA<span>NJ POS</span></div>
                </div>
                <div className="mockup-sync"><div className="mockup-sync-dot"/><span className="mockup-sync-text">Synced</span></div>
              </div>
              <div className="mockup-cats">
                {['All','BEEF BURGER','CHICKEN CRUNCH','DRINKS'].map((c,i) => <div key={c} className={`mockup-cat${i===0?' active':''}`}>{c}</div>)}
              </div>
              <div className="mockup-products">
                {MOCKUP_PRODUCTS.map(p => (
                  <div key={p.name} className={`mockup-product${p.active?' active':''}`}>
                    <div className="mockup-prod-img">
                      <ProductThumb src={p.img} fallback="🍔"/>
                    </div>
                    <div className="mockup-prod-name">{p.name}</div>
                    <div className="mockup-prod-price">{p.price}</div>
                    <div className="mockup-prod-stock">Stock: {p.stock}</div>
                  </div>
                ))}
              </div>
              <div className="mockup-cart">
                <div className="mockup-cart-header">
                  <div className="mockup-cart-title">Order <span className="mockup-cart-badge">2</span></div>
                </div>
                <div className="mockup-cart-item"><span>Beefy Baga ×1</span><span style={{fontWeight:800}}>₱45</span></div>
                <div className="mockup-cart-item"><span>Chicken Crunch ×2</span><span style={{fontWeight:800}}>₱100</span></div>
                <div className="mockup-total-row"><span>Total</span><span>₱145.00</span></div>
                <button className="mockup-charge-btn">Charge ₱145.00</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="stats">
        {[{n:'₱399',a:'',l:'Per month · all features'},{n:'3',a:'-day',l:'Free trial · no card needed'},{n:'5',a:'+',l:'Payment methods accepted'},{n:'',a:'∞',l:'Products, orders & staff'}].map((s,i) => (
          <div key={i} className="stat">
            <div className="stat-num">{s.n && !s.a.startsWith('-') && <span className="accent">{i===0?'₱':''}</span>}{i===0?'399':s.n}<span className="accent">{s.a}</span></div>
            <div className="stat-label">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="value-strip">
        {[['ti-wifi-off','Works offline'],['ti-cloud-upload','Cloud backup'],['ti-device-mobile','Any phone or tablet'],['ti-shield-check','BIR VAT-ready'],['ti-clock','Setup in minutes']].map(([icon,label]) => (
          <div key={label} className="value-item"><i className={`ti ${icon}`}/>{label}</div>
        ))}
      </div>

      <section className="features" id="features">
        <div className="section-center" style={{marginBottom:44}}>
          <div className="section-eyebrow">Everything you need</div>
          <h2 className="section-title">A full POS — not just a cashier app</h2>
          <p className="section-sub">Every feature your store actually needs, from your first order to your end-of-month BIR report.</p>
        </div>
        <div className="features-grid">
          {[
            {bg:'#ede9fe',c:'#7c3aed',icon:'ti-shopping-cart',title:'Fast POS Cashiering',desc:'Tap a product, pick the order type, collect payment — done in seconds. Scan with a physical barcode scanner, or use the camera on your phone or tablet — no extra hardware required to get started. Built-in Dine-in/Take-out for food businesses, or turn them off and set up your own order types for retail and service businesses.',tags:['Any business type','Camera or physical scanner','Customer numbers','Table numbers']},
            {bg:'#e0f2fe',c:'#0284c7',icon:'ti-arrows-split',title:'Split & Online Payments',desc:'Cash, GCash, Maya, or any e-wallet you accept — or split one sale across both, part cash and part online, with the change and totals worked out automatically. No separate transactions, no manual math at the counter.',tags:['Cash + online in one sale','Any configured e-wallet','Auto-calculated totals']},
            {bg:'#fdf2f8',c:'#be185d',icon:'ti-calendar-time',title:'Preorders & Downpayments',desc:'Take a downpayment now and collect the rest when the customer picks up — even for items not in stock yet, since stock only deducts on pickup, not on order. Cancel a preorder with a clear refund-or-forfeit choice, and every downpayment and balance payment is tracked separately for accurate shift reconciliation.',tags:['Partial payment now','Stock reserved on pickup','Refund or forfeit on cancel']},
            {bg:'#dcfce7',c:'#16a34a',icon:'ti-box',title:'Real-time Inventory',desc:'Stock updates automatically on every sale. Add products with photos — upload or snap a picture right from your camera — set up size, color, or flavor variants with their own pricing and stock, build combo/bundle items that auto-deduct their ingredients, import or export via CSV (including variants and combos, with a sample template to guide you), and track every adjustment in a full audit log.',tags:['Auto deductions','Product variants','Combo/bundle items','CSV import/export']},
            {bg:'#f5f3ff',c:'#7c3aed',icon:'ti-barcode',title:'Barcode Label Generator',desc:'Pick any products from your inventory, set how many labels you need for each, and print ready-to-scan barcodes in one batch — right from the app, no separate software. Choose what shows underneath each code — product name, price, category — and how many labels fit per row on your paper.',tags:['Batch printing','Any quantity per item','Custom label info','Works offline']},
            {bg:'#f0fdfa',c:'#0f766e',icon:'ti-scale',title:'Sold by Weight Pricing',desc:'Selling meat, fish, rice, or anything priced by weight or volume? Set a price per unit — kilo, gram, liter, whatever fits your product — and the cashier just types the amount, or taps a quick quarter/half/three-quarter-kilo button for common cuts. The price calculates instantly, no calculator needed. Perfect for wet markets, groceries, and food stalls.',tags:['Any unit: kg, g, L…','Quick-pick common weights','Stock tracked by unit','Accurate receipts']},
            {bg:'#dbeafe',c:'#1d4ed8',icon:'ti-chart-bar',title:'Sales Reports & Analytics',desc:'Top products, busiest hours, cashier performance, daily trends — all in one screen. Export or email reports. BIR VAT summary included.',tags:['Daily trend chart','Hourly heatmap','BIR tax tab','Email reports']},
            {bg:'#eef2ff',c:'#4338ca',icon:'ti-report-money',title:'Inventory Value & Profit Tracking',desc:'Set a cost price per product and instantly see your total inventory value, potential profit, and margin — broken down by category. Know exactly how much cash is tied up on your shelves, and what it\'s worth.',tags:['Cost vs. retail value','Profit & margin %','By-category breakdown','Track your ROI']},
            {bg:'#fef3c7',c:'#b45309',icon:'ti-clock',title:'Shift Management',desc:'Staff open and close shifts with cash counts, and every register runs its own independent shift — so two cashiers on two devices work fully in parallel, no waiting on each other. A shift survives an app crash or accidental refresh, and handing a register to a different cashier mid-shift takes one tap. Owners can also restrict which staff can log in on which device.',tags:['Multi-register support','Opening cash','Per-shift reports','Staff handoff','Device access control']},
            {bg:'#f0fdf4',c:'#15803d',icon:'ti-users',title:'Staff & Roles',desc:'Owner, Manager, and Staff roles with fine-grained permissions. Control who can void orders, edit prices, or view reports.',tags:['Multiple accounts','Role permissions','Activity logs','Secure login']},
            {bg:'#fce7f3',c:'#be185d',icon:'ti-cloud-upload',title:'Cloud Sync & Owner Portal',desc:'Data syncs in real time. Check today\'s sales, manage products, and add staff from any device via the Owner Portal — or right from a second device running the POS app itself, set up purely for monitoring. The app keeps itself up to date automatically, so you\'re always on the latest version.',tags:['Works offline','Auto sync','Auto-updates','Multi-device']},
            {bg:'#e0f2fe',c:'#0369a1',icon:'ti-receipt',title:'Receipt Printing',desc:'Print thermal receipts on 58mm or 80mm paper. Connect a USB or Bluetooth printer directly for instant, one-tap printing with no pop-up — or use any printer through the standard print dialog. Kitchen Order Ticket available as add-on.',tags:['58mm & 80mm','Direct USB/Bluetooth print','Custom receipt logo','Kitchen tickets']},
            {bg:'#fff7ed',c:'#c2410c',icon:'ti-discount-2',title:'Discounts & VAT',desc:'Senior Citizen and PWD 20% discounts with one tap. Custom percentage discounts and per-order VAT toggle included.',tags:['SC / PWD 20%','Custom %','VAT per order','BIR-ready']},
            {bg:'#f5f3ff',c:'#6d28d9',icon:'ti-truck',title:'Purchase Orders & Invoices',desc:'Manage supplier POs and customer invoices inside NJ POS. Receive deliveries — including product variants, tracked down to the specific size or flavor received — and stock updates automatically. Print official, ready-to-send documents.',tags:['PO management','Variant-aware receiving','Customer invoices','Print-ready docs']},
          ].map(f => (
            <div key={f.title} className="feature-card">
              <div className="feature-icon" style={{background:f.bg,color:f.c}}><i className={`ti ${f.icon}`}/></div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              <div className="feature-tags">{f.tags.map(t => <span key={t} className="feature-tag">{t}</span>)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="how" id="how">
        <div className="section-center" style={{marginBottom:56}}>
          <div className="section-eyebrow">Getting started</div>
          <h2 className="section-title">Up and running in under 10 minutes</h2>
          <p className="section-sub">No installation, no IT setup, no training videos. If you can use a phone, you can use NJ POS.</p>
        </div>
        <div className="how-steps">
          {[
            {n:1,t:'Request your trial code',d:'Enter your store name and email. We send a TRIAL code instantly — no payment, no credit card needed.'},
            {n:2,t:'Activate & add products',d:'Enter the code on any phone, tablet, or browser. Add your products and prices — takes less than 10 minutes.'},
            {n:3,t:'Sell and check reports',d:'Start processing orders. Monitor your store from the Owner Portal — even when you\'re not on-site.'},
          ].map(s => (
            <div key={s.n} className="how-step">
              <div className="how-step-num">{s.n}</div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="payments">
        <h2>Accepts all the ways Filipinos pay</h2>
        <p>Built-in QR Ph P2P — GCash and Maya ready out of the box</p>
        <div className="payment-methods">
          {[['ti-cash','Cash','pill-cash'],['ti-brand-google-pay','GCash','pill-gcash'],['ti-credit-card','Maya','pill-maya'],['ti-credit-card-pay','Card','pill-card'],['ti-qrcode','QR Ph P2P','pill-qr']].map(([icon,label,cls]) => (
            <div key={label} className={`payment-pill ${cls}`}><i className={`ti ${icon}`}/>{label}</div>
          ))}
        </div>
      </div>

      <section className="pricing" id="pricing">
        <div className="section-center" style={{marginBottom:44}}>
          <div className="section-eyebrow">Simple pricing</div>
          <h2 className="section-title">One plan. Everything included.</h2>
          <p className="section-sub">No hidden charges, no feature unlocks, no surprises. Start free, pay only when you're ready.</p>
        </div>
        <div className="pricing-grid">
          <div className="pricing-card">
            <div className="pricing-name">Trial</div>
            <div className="pricing-amount">Free</div>
            <div className="pricing-note">3 days · full access · no card</div>
            <ul className="pricing-features" style={{marginTop:16}}>
              {['All POS features unlocked','1 device, unlimited products','Cloud sync & Owner Portal','GCash, Maya, Cash payments'].map(f => <li key={f}><i className="ti ti-check"/>{f}</li>)}
              <li className="muted"><i className="ti ti-x"/>Expires after 3 days</li>
            </ul>
            <button className="pricing-cta outline" onClick={openTrial}>Start Free Trial</button>
            <p className="pricing-cta-note">No credit card required</p>
          </div>
          <div className="pricing-card featured">
            <div className="pricing-badge">Most Popular</div>
            <div className="pricing-urgency"><i className="ti ti-clock"/><span>Trial converts to ₱399/mo — upgrade anytime</span></div>
            <div className="pricing-name">Standard</div>
            <div className="pricing-amount"><sup>₱</sup>399<span className="mo">/mo</span></div>
            <div className="pricing-note">Billed monthly · cancel anytime</div>
            <div className="pricing-compare"><i className="ti ti-coin-peso"/>That's only ₱13/day for a complete POS system</div>
            <ul className="pricing-features">
              {['Everything in Trial, permanently','Unlimited products, orders & staff','Full reports + BIR VAT tab','Shift management & audit logs','Receipt printing (58mm & 80mm)','SC / PWD discount support','GCash & Maya QR payments','Owner Portal — manage remotely','Cloud backup — never lose data'].map(f => <li key={f}><i className="ti ti-check"/>{f}</li>)}
            </ul>
            <button className="pricing-cta filled" onClick={openTrial}>Get Started — Free Trial</button>
            <button className="pricing-cta-secondary" onClick={()=>window.location.href='https://owner.nj-systems.com/payment?plan=monthly'}>Already decided? Pay Now</button>
            <p className="pricing-cta-note"><i className="ti ti-lock" style={{fontSize:11,color:'#10b981'}}/> No credit card · cancel anytime</p>
          </div>
          <div className="pricing-card">
            <div className="pricing-badge" style={{background:'#0369a1'}}>Best Value</div>
            <div className="pricing-name">Lifetime</div>
            <div className="pricing-amount"><sup>₱</sup>8,999</div>
            <div className="pricing-note">One-time payment · yours forever, no renewals</div>
            <div className="pricing-compare"><i className="ti ti-coin-peso"/>Pays for itself vs. Standard in under 2 years</div>
            <ul className="pricing-features">
              {['Everything in Standard, forever','No monthly fees, ever again','Unlimited products, orders & staff','Full reports + BIR VAT tab','Receipt printing (58mm & 80mm)','Owner Portal — manage remotely','Cloud backup — never lose data'].map(f => <li key={f}><i className="ti ti-check"/>{f}</li>)}
            </ul>
            <button className="pricing-cta outline" onClick={openTrial}>Get Started — Free Trial</button>
            <button className="pricing-cta-secondary" onClick={()=>window.location.href='https://owner.nj-systems.com/payment?plan=lifetime'}>Already decided? Pay Now</button>
            <p className="pricing-cta-note">One payment, no subscription</p>
          </div>
        </div>
        <div className="pricing-addons">
          <h3>Optional Add-ons</h3>
          <div className="addons-grid">
            {[['Extra Device Slot','₱149/device/mo (or ₱149 one-time on Lifetime)','Connect a 2nd or 3rd POS terminal to the same store'],['Purchase Orders Module','₱99 one-time','Manage supplier POs, deliveries & auto stock receiving'],['Invoicing Module','₱99 one-time','Create and track customer invoices with payment status'],['Kitchen Ticket Printing','₱99 one-time','Print a kitchen order ticket below each customer receipt'],['Open Bills','₱99 one-time','Save an order as a tab and come back to pay it later']].map(([n,p,d]) => (
              <div key={n} className="addon"><div className="addon-name">{n}</div><div className="addon-price">{p}</div><div className="addon-desc">{d}</div></div>
            ))}
          </div>
        </div>
      </section>

      <section className="testimonials" id="testimonials">
        <div className="section-center" style={{marginBottom:44}}>
          <div className="section-eyebrow">Store owners say</div>
          <h2 className="section-title">Trusted by stores like yours</h2>
        </div>
        <div className="testi-grid">
          {[
            {init:'MA',bg:P,name:'Maria A.',biz:'Carinderia · Cebu City',text:'Before NJ POS I was manually counting sales at the end of the day. Now I just open the report and everything is there — by cashier, by product, by hour. Grabe ang convenience.'},
            {init:'JR',bg:'#0891b2',name:'Jun R.',biz:'Sari-sari Store · Davao',text:'Hindi ako mahilig sa tech pero setup lang ng ilang minuto naka-process na kami ng orders. GCash QR works perfectly. My staff learned it in one afternoon.'},
            {init:'CL',bg:'#7c3aed',name:'Cynthia L.',biz:'Bakeshop · Butuan City',text:'The Owner Portal is my favorite — I check my store even when I\'m away. Sales, stock, who\'s on shift. ₱399 is nothing for that peace of mind.'},
          ].map(t => (
            <div key={t.name} className="testi-card">
              <div className="testi-quote">"</div>
              <div className="testi-stars">★★★★★</div>
              <p className="testi-text">{t.text}</p>
              <div className="testi-author">
                <div className="testi-avatar" style={{background:t.bg}}>{t.init}</div>
                <div><div className="testi-name">{t.name}</div><div className="testi-biz">{t.biz}</div></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="faq" id="faq">
        <div className="section-center" style={{marginBottom:44}}>
          <div className="section-eyebrow">Questions</div>
          <h2 className="section-title">Frequently asked</h2>
        </div>
        <div className="faq-list">
          {[
            ['Do I need internet to use NJ POS?','No. NJ POS saves data locally first so you can keep selling even without internet. Once you\'re back online, everything syncs automatically. A connection is only required for the Owner Portal and cloud features.'],
            ['What devices does it work on?','Any modern browser — Android, iPhone, iPad, laptop, or desktop. No app download required. You can also install it as a PWA on your home screen for a full-screen app experience.'],
            ['Can I print receipts without a pop-up every time?','Yes — connect a USB or Bluetooth thermal printer directly in Settings and receipts print instantly with no pop-up, on Android tablets, Windows, or Mac using Chrome, Edge, or Brave. On iPhone/iPad, printing still works great through the standard print screen — that is an Apple restriction that applies to every app, not just ours. Either way, your receipts always print; direct connection is just a convenience upgrade where your device supports it.'],
            ['How does the free trial work?','Request a trial and we email you a TRIAL activation code. Enter it in the app to activate your store — no payment or credit card needed. After 3 days you can upgrade to keep all your data and continue selling.'],
            ['Can I use multiple devices in one store?','Yes. The Standard plan includes 1 device. Add more for ₱149/device/month. All devices share the same inventory and data, synced in real time.'],
            ['What if I lose my phone or it breaks?','No problem. All your data is backed up in the cloud automatically. Just log in on a new device and everything — products, orders, shifts, reports — restores instantly.'],
            ['Does it support Senior Citizen and PWD discounts?','Yes. One-tap 20% SC and PWD discounts are built in. Custom percentage discounts are also available for any other promotions your store runs.'],
            ['Can I cancel anytime?','Yes. Month-to-month, no lock-in, no cancellation fees. Your data is always exportable as a backup file from inside the app.'],
          ].map(([q,a]) => <FaqItem key={q} q={q} a={a}/>)}
        </div>
      </section>

      <div className="cta-banner">
        <h2>Your store deserves better<br/>than a notebook.</h2>
        <p>Full POS system — sales, inventory, GCash, reports, shifts — all in one.</p>
        <div className="cta-price-callout">
          <i className="ti ti-coin-peso"/>
          Start free · then only <strong>₱399/month</strong> · cancel anytime
        </div>
        <br/>
        <button className="btn-white" onClick={openTrial}><i className="ti ti-rocket"/>Try NJ POS Free for 3 Days</button>
        <p className="cta-guarantee"><i className="ti ti-shield-check" style={{color:'rgba(255,255,255,.4)',fontSize:13}}/> No credit card · No commitment · Setup in minutes</p>
      </div>

      <footer>
        <div className="footer-top">
          <div className="footer-brand">
            <NavLogo/>
            <p>Affordable cloud-synced Point of Sale built for small and medium stores in the Philippines.</p>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#how">How It Works</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="footer-col">
            <h4>Access</h4>
            <a href="https://owner.nj-systems.com">Owner Portal</a>
            <a href="#" onClick={e=>{e.preventDefault();openTrial()}}>Start Free Trial</a>
          </div>
          <div className="footer-col">
            <h4>Contact</h4>
            <a href="mailto:pos_support@nj-systems.com">pos_support@nj-systems.com</a>
            <a href="https://www.facebook.com/NJPOS" target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:7}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.884v2.27h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
              NJ POS
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© 2026 NJ POS. All rights reserved.</p>
          <div className="footer-bottom-links">
            <a href="/privacy-policy">Privacy Policy</a>
            <a href="/terms-of-service">Terms of Service</a>
          </div>
        </div>
      </footer>

      <TrialModal open={modalOpen} onClose={() => setModalOpen(false)}/>

      {/* Floating Messenger Button */}
      <a
        href="https://m.me/NJPOS"
        target="_blank"
        rel="noopener noreferrer"
        title="Chat with us on Messenger"
        style={{
          position:"fixed",
          bottom:24,
          right:24,
          width:52,
          height:52,
          borderRadius:"50%",
          background:"linear-gradient(135deg,#00B2FF 0%,#006AFF 100%)",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          boxShadow:"0 4px 16px rgba(0,106,255,0.4)",
          zIndex:999,
          transition:"transform 0.2s,box-shadow 0.2s",
          textDecoration:"none",
        }}
        onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.1)";e.currentTarget.style.boxShadow="0 6px 20px rgba(0,106,255,0.55)";}}
        onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.boxShadow="0 4px 16px rgba(0,106,255,0.4)";}}
      >
        <svg width="26" height="26" viewBox="0 0 36 36" fill="white" aria-label="Messenger">
          <path d="M18 2C9.163 2 2 8.71 2 17c0 4.445 1.897 8.447 4.962 11.337V34l4.805-2.64C13.012 31.77 15.463 32 18 32c8.837 0 16-6.71 16-15S26.837 2 18 2zm1.758 20.293l-4.076-4.34-7.956 4.34 8.748-9.293 4.176 4.34 7.856-4.34-8.748 9.293z"/>
        </svg>
      </a> 
    </>
  );
}

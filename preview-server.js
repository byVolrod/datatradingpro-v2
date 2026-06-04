/**
 * preview-server.js — Serveur LOCAL de prévisualisation (jamais déployé). N'ENVOIE AUCUN email.
 *   /            → index léger (liens)
 *   /gallery     → galerie des emails (iframes) = identique à /admin/emails en prod
 *   /raw/:key    → un email en PAGE DIRECTE (sans iframe) → capturable
 *   /analyst     → aperçu d'un rapport Analyst (vrai style.css + structure réelle du lecteur)
 * Les env ci-dessous sont des PLACEHOLDERS (aucune vraie clé) : reflètent l'ordre des fournisseurs.
 */
'use strict';
process.env.GMAIL_USER         = process.env.GMAIL_USER         || 'datatradingpro.contact@gmail.com';
process.env.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'preview-placeholder';
process.env.MAILJET_API_KEY    = process.env.MAILJET_API_KEY    || 'preview-placeholder';
process.env.MAILJET_SECRET_KEY = process.env.MAILJET_SECRET_KEY || 'preview-placeholder';
process.env.EMAIL_FROM         = process.env.EMAIL_FROM         || 'DataTradingPro <datatradingpro.contact@gmail.com>';

const path    = require('path');
const express = require('express');
const mailer  = require('./mailer');
const app = express();

// ── Emails ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  const cat = mailer.getEmailCatalog();
  const links = cat.map(e => `<li><a href="/raw/${e.key}" style="color:#f7941d;">${e.audience} — ${e.label}</a></li>`).join('');
  res.type('html').send(`<!doctype html><html><head><meta charset=utf-8><title>Preview DTP</title></head>
    <body style="background:#0c0c0e;color:#e6e9ef;font-family:sans-serif;padding:40px;">
      <h1 style="color:#f7941d;">DataTradingPro — Preview</h1>
      <p><a href="/analyst" style="color:#f7941d;font-size:18px;">→ Aperçu d'un rapport Analyst</a></p>
      <p><a href="/gallery" style="color:#f7941d;">→ Galerie des emails</a></p>
      <ul style="line-height:2;">${links}</ul>
    </body></html>`);
});
app.get('/gallery', (_req, res) => res.type('html').send(mailer.renderEmailGallery()));
app.get('/raw/:key', (req, res) => {
  const e = mailer.getEmailCatalog().find(x => x.key === req.params.key);
  if (!e) return res.status(404).type('html').send('not found');
  res.type('html').send(e.html);
});

// ── Aperçu d'un rapport Analyst (rendu réel : style.css + structure du lecteur) ──
function _bullet(html) { return `<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>${html}</span></div>`; }
function _section(title, bullets) {
  return `<hr class="arlib-rdivider"><div class="arlib-rsection">${title}</div>` + bullets.map(_bullet).join('');
}
function _card(text, asset, sig) {
  const head = asset ? `<div class="ai-card-head"><span class="ai-card-asset">${asset}</span>${sig ? `<span class="ai-bias ai-bias--${sig.toLowerCase()}">${sig}</span>` : ''}</div>` : '';
  return `<div class="ai-insights-card">${head}<div class="ai-card-text">${text}</div></div>`;
}
function analystPreview() {
  const tags = ['construction','economy','infrastructure','housing','realestate','manufacturing','inflation','investment','globalmarkets','businessnews'];
  const insights = [
    _card('European stocks ended mostly higher, with healthcare and consumer sectors leading gains, while energy and telecoms lagged.'),
    _card('Crude oil prices softened due to US-Iran mediation efforts, but found support after Hezbollah rejected a ceasefire.'),
    _card('The US dollar weakened against G10 currencies, with the Swiss franc outperforming despite soft inflation data.'),
    _card('US jobless claims exceeded expectations, indicating potential early signs of labor market deterioration.'),
    _card('Choppy price action as the BoJ June meeting comes into focus; rate-hike odds keep the yen volatile.', 'USD/JPY', 'SELL'),
    _card('Found support at its 200-day moving average as energy weakness lifted havens.', 'Spot Gold', 'BUY'),
  ];
  const fx = [
    'G10s were exponentially firmer against the Buck throughout London FX trade. CHF led despite soft inflation metrics; Kiwi stabilised after historic recent losses; JPY was choppy on not-too-surprising BoJ source reports.',
    'DXY set to hand over to the domestic session lower by <strong>0.3%</strong> after lower energy benchmarks hit the Buck. DXY trundled lower throughout the late London morning, from a <strong>99.54</strong> peak to a trough of <strong>99.18</strong>. Challenger layoffs saw May Job Cuts rise <strong>16%</strong> from April, the highest May total since 2020. NFP due Friday.',
    'JPY initially led. Sources told Bloomberg and Reuters that the BoJ would raise rates at the June meeting, in line with market expectations (<strong>43bps</strong> by year-end). The BBG report saw a 35-pip move lower in <strong>USD/JPY</strong>, swiftly pared; the pair trades higher by <strong>0.1%</strong>, a touch below the <strong>160.00</strong> mark.',
    'CHF was the best performer, with some technicals in play (<strong>0.7920</strong> in the USD pair) alongside Inflation data today. Policy is expected to remain at the ZLB for the foreseeable future. <strong>EUR/CHF -0.2%</strong>, <strong>USD/CHF -0.6%</strong>.',
  ];
  const fi = [
    'Fixed income benchmarks started the European session with mild gains, taking the lead from slightly lower energy prices. This stemmed from comments via President Trump, who stated that a deal could happen over the weekend.',
  ];
  const cmdty = [
    'Crude — Crude was on a softer footing amid ongoing mediation efforts to broker a US-Iran deal. WTI Jul and Brent Aug were subdued within <strong>USD 91.91-95.91/bbl</strong> and <strong>USD 93.93-97.44/bbl</strong> ranges.',
    'Precious Metals — Spot gold and silver were firmer as energy fell, with gold finding support at its 200 DMA (<strong>USD 4,423/oz</strong>) before rebounding to the top of a <strong>USD 4,423-4,514/oz</strong> range.',
    'Base Metals — Base metals eventually traded mixed after initially trading mostly lower; 3M LME copper eked mild gains but remained below <strong>USD 14,000/t</strong>.',
    'World Gold Council said global gold ETFs recorded a <strong>USD 2.0bln</strong> net outflow in May, reducing total AuM <strong>2%</strong> to <strong>USD 604bln</strong>.',
  ];
  const eudata = [
    'EU Retail Sales YoY (Apr) Y/Y <strong>1.0%</strong> (Prev. <strong>1.2%</strong>).',
    'EU S&amp;P Global Construction PMI (May) <strong>43.7</strong> (Prev. <strong>41.7</strong>).',
    'UK S&amp;P Global Construction PMI (May) <strong>38.2</strong> vs. Exp. <strong>40.4</strong> (Prev. <strong>39.7</strong>).',
    'German S&amp;P Global Construction PMI (May) <strong>42.4</strong> (Prev. <strong>42.1</strong>).',
    'Swiss Inflation Rate YoY (May) Y/Y <strong>0.6%</strong> vs. Exp. <strong>0.8%</strong> (Prev. <strong>0.6%</strong>).',
  ];
  const eye = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  const content = _section('FX', fx) + _section('FIXED INCOME', fi) + _section('COMMODITIES', cmdty) + _section('EUROPEAN DATA', eudata);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aperçu rapport Analyst — DTP</title>
<link rel="stylesheet" href="/css/style.css">
<style>
  body { margin:0; background:#0a0a0a; }
  .pv-panel { height:100vh; display:flex; flex-direction:column; background:#0c0c0e; }
  .pv-head { display:flex; align-items:center; justify-content:space-between; height:40px; padding:0 16px;
             border-bottom:1px solid #1c1c20; font-family:var(--font-pmt,sans-serif); }
  .pv-head .t { color:#e6e9ef; font-size:13px; font-weight:700; }
  .pv-head .x { color:#777; font-size:16px; }
  .arlib-reader-view { flex:1; min-height:0; }
</style></head>
<body>
  <div class="pv-panel">
    <div class="pv-head"><span class="t">Analyst Reports</span><span class="x">✕</span></div>
    <div class="arlib-reader-view" id="arlib-reader-view">
      <div class="arlib-rnav">
        <button class="arlib-back-btn">‹ Back to List</button>
        <span class="arlib-rnav-title">London Session Recap : The Global Construction Slowdown Signals Broader Economic Weakness</span>
        <div class="arlib-rnav-right">
          <button class="arlib-hide-insights">${eye} Masquer Insights</button>
          <span class="arlib-dtp-badge">DTP</span>
        </div>
      </div>
      <div class="arlib-rtags-bar">
        <button class="arlib-rtags-arrow" id="arlib-rtags-prev">‹</button>
        <div class="arlib-rtags-scroll" id="arlib-rtags-scroll">${tags.map(t => `<span class="arlib-rtag">${t}</span>`).join('')}</div>
        <button class="arlib-rtags-arrow" id="arlib-rtags-next">›</button>
        <div class="arlib-rdate" id="arlib-rdate"></div>
      </div>
      <div id="arlib-ai-insights">
        <div class="ai-insights-head">
          <span class="ai-insights-title"><img class="ai-insights-logo" src="/assets/images/macro-ai-logo.png" alt="Macro AI" width="16" height="16"> AI Insights</span>
          <span class="ai-insights-nav"><button type="button">‹</button><span class="ai-insights-count">${insights.length} insights</span><button type="button">›</button></span>
        </div>
        <div class="ai-insights-cards">${insights.join('')}</div>
      </div>
      <div class="arlib-rcontent" id="arlib-rcontent">${content}</div>
    </div>
  </div>
</body></html>`;
}
app.get('/analyst', (_req, res) => res.type('html').send(analystPreview()));

// Sert les fichiers statiques (CSS, images, logo macro-ai) APRÈS les routes spécifiques.
app.use(express.static(path.join(__dirname, 'public')));

app.listen(5099, () => console.log('[preview] http://localhost:5099  (/analyst, /gallery, /raw/:key)'));

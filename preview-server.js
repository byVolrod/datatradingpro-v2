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
  const links = cat.map(e => `<li><a href="/raw/${e.key}" style="color:#e3b23a;">${e.audience} — ${e.label}</a></li>`).join('');
  res.type('html').send(`<!doctype html><html><head><meta charset=utf-8><title>Preview DTP</title></head>
    <body style="background:#0c0c0e;color:#e6e9ef;font-family:sans-serif;padding:40px;">
      <h1 style="color:#e3b23a;">DataTradingPro — Preview</h1>
      <p><a href="/analyst" style="color:#e3b23a;font-size:18px;">→ Aperçu d'un rapport Analyst</a></p>
      <p><a href="/gallery" style="color:#e3b23a;">→ Galerie des emails</a></p>
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
             border-bottom:1px solid #1c1c20; font-family:var(--font-desk,sans-serif); }
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
          <span class="ai-insights-nav"><button type="button">‹</button><span class="ai-insights-count">1-4 of ${insights.length}</span><button type="button">›</button></span>
        </div>
        <div class="ai-insights-cards">${insights.join('')}</div>
      </div>
      <div class="arlib-rcontent" id="arlib-rcontent">${content}</div>
    </div>
  </div>
</body></html>`;
}
app.get('/analyst', (_req, res) => res.type('html').send(analystPreview()));

// ── Aperçu du volet chat Macro AI (message de bienvenue + avatar, vrai style.css) ──
app.get('/chat', (_req, res) => {
  res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aperçu chat Macro AI — DTP</title>
<link rel="stylesheet" href="/css/style.css">
<style>
  body { margin:0; background:#0a0a0c; }
  /* Volet forcé VISIBLE et plein écran pour l'aperçu (en prod il est en drawer à droite, sous la topbar) */
  .ai-panel { position:fixed !important; inset:0 !important; transform:none !important; opacity:1 !important; visibility:visible !important;
              width:100% !important; max-width:420px !important; height:100vh !important; display:flex !important; flex-direction:column !important; }
</style></head>
<body>
  <div class="ai-panel" id="ai-panel">
    <div class="ai-header">
      <div class="ai-header-left">
        <span class="ai-head-ic" aria-hidden="true">AI</span>
        <div class="ai-head-meta">
          <div class="ai-head-title">Macro AI Assistant</div>
          <div class="ai-head-status"><span class="ai-status-dot"></span>Online</div>
        </div>
      </div>
      <div class="ai-header-right">
        <button class="ai-hdr-btn" title="Fermer"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      </div>
    </div>
    <div class="ai-messages" id="ai-messages">
      <div class="ai-day-sep"><span>Today</span></div>
      <div class="ai-row ai-row--ai">
        <div class="ai-chip"><img class="ai-chip-img" src="/assets/images/macro-ai-logo.png" alt="Macro AI" width="22" height="22" decoding="sync"></div>
        <div class="ai-ai-body">
          <div class="ai-ai-text">Bonjour ! Je suis votre assistant IA Macro. Posez-moi des questions sur les tendances du marché, les indicateurs économiques ou les perspectives des marchés mondiaux.</div>
          <div class="ai-time">20:48</div>
        </div>
      </div>
    </div>
    <div class="ai-inputbar">
      <button class="ai-attach" type="button"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></button>
      <button class="ai-attach" type="button"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg></button>
      <textarea class="ai-input" rows="1" placeholder="Type your message..."></textarea>
      <button class="ai-send"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg></button>
    </div>
    <div class="ai-inputhint">Press Enter to send, Shift + Enter for new line</div>
  </div>
</body></html>`);
});

// ── Aperçu de l'onglet Week Ahead (vrai style.css + amCharts via CDN, données d'exemple) ──
app.get('/weekahead', (_req, res) => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const days = [
    { dow: 'Monday', date: '1', month: 'JUN', title: 'Manufacturing Momentum and Labour Market Signals', impact: 'HIGH', open: true, description: 'The week begins with a broad set of manufacturing and activity indicators, including Global Manufacturing Final PMIs, South Korean trade data, German and Swiss retail sales, Swiss GDP, Eurozone unemployment, and the US ISM Manufacturing PMI. Attention will focus on whether the strong rebound seen in US manufacturing is sustained after S&P Global’s flash survey reached a multi-year high.' },
    { dow: 'Tuesday', date: '2', month: 'JUN', title: 'Inflation Takes Centre Stage in Europe', impact: 'HIGH', description: 'Tuesday’s focus is inflation, led by the Eurozone HICP release alongside South Korean CPI, New Zealand export and import prices, and Poland’s central bank policy announcement. Eurozone inflation is expected to remain around 3.0% year-on-year.' },
    { dow: 'Wednesday', date: '3', month: 'JUN', title: 'Growth and Services Activity Under Scrutiny', impact: 'HIGH', description: 'Wednesday brings a heavy schedule featuring Australian GDP, Eurozone producer prices, US ADP employment, ISM Services PMI, Factory Orders, the Fed Beige Book, and Global Final PMIs.' },
    { dow: 'Thursday', date: '4', month: 'JUN', title: 'European Inflation Watch and Labour Market Updates', impact: 'HIGH', description: 'Inflation data from Sweden and Switzerland headline Thursday’s calendar, alongside Australian trade figures, Spanish industrial production, Eurozone retail sales and construction PMI, plus US Challenger layoffs and weekly jobless claims.' },
    { dow: 'Friday', date: '5', month: 'JUN', title: 'Global Labour Market Test and Key Central Bank Decision', impact: 'HIGH', description: 'Friday concludes the week with the RBI policy announcement, Canadian employment data, US Non-Farm Payrolls, Japanese household spending, Eurozone employment and GDP revisions.' },
  ];
  const rows = days.map(d => {
    const hi = /high/i.test(d.impact), today = d.date === '4';
    return `<div class="wa-day${today ? ' wa-day--today' : ''}">
      <div class="wa-node"><span class="wa-dow">${d.dow.slice(0, 3).toUpperCase()}</span><span class="wa-date">${d.date}</span><span class="wa-month">${d.month}</span></div>
      <div class="wa-card${d.open ? ' wa-card--open' : ''}">
        <div class="wa-card-head"><span class="wa-card-title">${esc(d.title)}</span><span class="wa-impact wa-impact--${hi ? 'high' : 'medium'}">${hi ? 'HIGH IMPACT' : 'MEDIUM IMPACT'}</span></div>
        <div class="wa-card-desc">${esc(d.description)}</div>
        <button class="wa-more" onclick="waToggle(this)">${d.open ? 'Show Less <span class="wa-more-chev">∧</span>' : 'Read More <span class="wa-more-chev">∨</span>'}</button>
      </div></div>`;
  }).join('');
  res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/style.css">
<script src="https://cdn.amcharts.com/lib/5/index.js"></script>
<script src="https://cdn.amcharts.com/lib/5/xy.js"></script>
<style>body{margin:0;background:#0c0c0e;}.wa-scroll{height:100vh;}</style></head>
<body>
<div class="wa-scroll"><div class="wa-wrap">
  <div class="wa-head"><span class="wa-title">Week Ahead</span><span class="wa-week">1-5 June</span></div>
  <div class="wa-chartbox"><div class="wa-chart-label">WEEKLY RISK PROFILE</div><div class="wa-chart" id="wa-risk-chart"></div></div>
  <div class="wa-timeline">${rows}</div>
</div></div>
<script>
function waToggle(b){var c=b.closest('.wa-card');var o=c.classList.toggle('wa-card--open');b.innerHTML=o?'Show Less <span class="wa-more-chev">∧</span>':'Read More <span class="wa-more-chev">∨</span>';}
window.addEventListener('load',function(){
  if(typeof am5==='undefined'||typeof am5xy==='undefined')return;
  try{
    var root=am5.Root.new('wa-risk-chart');try{root._logo&&root._logo.dispose();}catch(e){}
    var chart=root.container.children.push(am5xy.XYChart.new(root,{panX:false,panY:false,paddingLeft:4,paddingRight:4,paddingTop:4,paddingBottom:0}));
    var xAxis=chart.xAxes.push(am5xy.CategoryAxis.new(root,{categoryField:'day',renderer:am5xy.AxisRendererX.new(root,{minGridDistance:16})}));
    xAxis.get('renderer').grid.template.set('forceHidden',true);
    xAxis.get('renderer').labels.template.setAll({fill:am5.color(0x8a8a90),fontSize:10});
    var yAxis=chart.yAxes.push(am5xy.ValueAxis.new(root,{min:0,max:100,renderer:am5xy.AxisRendererY.new(root,{})}));
    yAxis.get('renderer').grid.template.set('forceHidden',true);yAxis.get('renderer').labels.template.set('forceHidden',true);
    var series=chart.series.push(am5xy.SmoothedXLineSeries.new(root,{xAxis:xAxis,yAxis:yAxis,valueYField:'risk',categoryXField:'day',stroke:am5.color(0xe28b41),fill:am5.color(0xe28b41)}));
    series.strokes.template.setAll({strokeWidth:2});
    series.fills.template.setAll({visible:true,fillGradient:am5.LinearGradient.new(root,{rotation:90,stops:[{color:am5.color(0xe28b41),opacity:0.35},{color:am5.color(0x0c0c0e),opacity:0}]})});
    var data=[{day:'Mon',risk:72},{day:'Tue',risk:80},{day:'Wed',risk:68},{day:'Thu',risk:64},{day:'Fri',risk:88}];
    xAxis.data.setAll(data);series.data.setAll(data);
  }catch(e){console.error(e);}
});
</script>
</body></html>`);
});

// Sert les fichiers statiques (CSS, images, logo macro-ai) APRÈS les routes spécifiques.
app.use(express.static(path.join(__dirname, 'public')));

app.listen(5099, () => console.log('[preview] http://localhost:5099  (/analyst, /gallery, /raw/:key)'));

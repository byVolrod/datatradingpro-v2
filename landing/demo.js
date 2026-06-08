/* ============================================================================
   DataTradingPro — Terminal de DÉMO interactif (immersion "temps simulé").
   Overlay plein écran, autonome, sans login. Déclenché par le bouton
   « Voir le terminal ». Données SIMULÉES (fictives) à des fins d'illustration.
   API: window.DTPDemo.open() / window.DTPDemo.close()
   ============================================================================ */
(function () {
  if (window.DTPDemo) return;

  var WHOP = 'https://whop.com/joined/justonetrader/products/jot-dtp/';
  var timers = [], root = null, chartState = null, prevFocus = null;

  /* ---------- styles ---------- */
  var CSS = `
  #dtp-demo{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:hidden;
    background:rgba(4,4,6,.88);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;opacity:0;transition:opacity .25s}
  #dtp-demo.on{opacity:1}
  #dtp-demo *{box-sizing:border-box}
  .dd-win{position:relative;width:min(1220px,100%);max-width:100%;height:min(88vh,800px);display:flex;flex-direction:column;
    background:#0a0a0c;border:1px solid #26262e;border-radius:12px;overflow:hidden;
    box-shadow:0 60px 160px -40px #000,0 0 0 1px rgba(247,148,29,.05);
    transform:translateY(14px) scale(.99);transition:transform .28s cubic-bezier(.2,.8,.2,1)}
  #dtp-demo.on .dd-win{transform:none}
  .dd-mono{font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace}
  .up{color:#00e676}.down{color:#ff3d00}.amb{color:#ffb300}
  /* header */
  .dd-top{display:flex;align-items:center;gap:11px;padding:9px 14px;background:#0d0d11;border-bottom:1px solid #1c1c22;flex-shrink:0}
  .dd-logo{display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px;color:#f0f0f2;letter-spacing:-.01em}
  .dd-logo svg{width:20px;height:20px}
  .dd-logo b{color:#f7941d}
  .dd-sim{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.07em;color:#f7941d;background:rgba(247,148,29,.1);border:1px solid rgba(247,148,29,.32);padding:3px 9px;border-radius:100px}
  .dd-sim .pd{width:6px;height:6px;border-radius:50%;background:#f7941d;animation:ddpulse 1.5s infinite}
  @keyframes ddpulse{0%,100%{opacity:1}50%{opacity:.25}}
  .dd-clock{margin-left:4px;font-size:11.5px;color:#7f7f88}
  .dd-top>.dd-cta{margin-left:auto}
  .dd-cta{background:#f7941d;color:#0a0a0a;font-weight:700;font-size:12.5px;padding:8px 15px;border-radius:7px;border:0;cursor:pointer;text-decoration:none;transition:.15s;white-space:nowrap}
  .dd-cta:hover{background:#ffae42;box-shadow:0 8px 22px -8px rgba(247,148,29,.6)}
  .dd-x{width:30px;height:30px;border-radius:7px;border:1px solid #2a2a32;background:transparent;color:#9a9aa3;cursor:pointer;font-size:17px;line-height:1;display:flex;align-items:center;justify-content:center}
  .dd-x:hover{color:#fff;border-color:#3a3a44}
  /* ticker */
  .dd-tick{display:flex;overflow:hidden;background:#08080a;border-bottom:1px solid #1c1c22;flex-shrink:0;white-space:nowrap}
  .dd-tick .it{display:flex;align-items:center;gap:7px;padding:6px 15px;border-right:1px solid #15151b;font-size:11px}
  .dd-tick .sym{color:#c2c2c9;font-weight:600}
  .dd-tick .px{color:#e8e8ea}
  .dd-tick .ch{font-size:10.5px}
  /* grid */
  .dd-grid{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1.45fr 1fr;grid-template-rows:1fr 1fr;gap:1px;background:#15151d}
  .dd-p{background:#0b0b0e;display:flex;flex-direction:column;min-height:0;overflow:hidden}
  .dd-news{grid-row:span 2}
  .dd-ph{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #16161c;flex-shrink:0}
  .dd-ph .ttl{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9a9aa3}
  .dd-ph .live{margin-left:auto;font-size:9px;font-weight:700;color:#00e676;display:flex;align-items:center;gap:5px;letter-spacing:.05em}
  .dd-ph .live .pd{width:5px;height:5px;border-radius:50%;background:#00e676;animation:ddpulse 1.4s infinite}
  /* news feed */
  .dd-feed{overflow-y:auto;padding:2px 0}
  .dd-feed::-webkit-scrollbar{width:6px}.dd-feed::-webkit-scrollbar-thumb{background:#26262e;border-radius:3px}
  .dd-itm{display:grid;grid-template-columns:auto 1fr;gap:9px;padding:8px 12px;border-bottom:1px solid #121218;animation:ddin .45s ease}
  @keyframes ddin{from{opacity:0;transform:translateY(-7px)}to{opacity:1;transform:none}}
  .dd-bdg{font-size:8px;font-weight:800;letter-spacing:.03em;padding:2px 6px;border-radius:3px;height:fit-content;margin-top:2px}
  .b-high{background:rgba(255,61,0,.15);color:#ff6b3d;border:1px solid rgba(255,61,0,.35)}
  .b-med{background:rgba(247,148,29,.13);color:#ffae42;border:1px solid rgba(247,148,29,.3)}
  .b-low{background:rgba(0,230,118,.1);color:#34d684;border:1px solid rgba(0,230,118,.3)}
  .dd-itx{font-size:12px;line-height:1.42;color:#d4d4d8}
  .dd-itm .meta{font-size:9.5px;color:#6a6a73;margin-top:3px}
  .dd-itm .meta b{color:#9a9aa3;font-weight:600}
  /* chart */
  .dd-chart-wrap{position:relative;flex:1;min-height:0}
  .dd-chart-wrap canvas{position:absolute;inset:0;width:100%;height:100%}
  .dd-px{position:absolute;top:8px;left:12px;font-size:19px;font-weight:700}
  .dd-px small{display:block;font-size:10px;color:#7f7f88;font-weight:500;margin-top:1px;letter-spacing:.04em}
  /* bias matrix */
  .dd-bmx{padding:10px 12px;font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;overflow:auto}
  .dd-brow{display:grid;grid-template-columns:58px repeat(5,1fr);gap:2px;margin-bottom:2px}
  .dd-bhead span{color:#6a6a73;text-align:center;font-weight:700;font-size:9px;padding:1px 0}
  .dd-bhead span:first-child{text-align:left}
  .dd-blbl{display:flex;align-items:center;color:#8a8a93;font-size:9px}
  .dd-brow i{display:flex;align-items:center;justify-content:center;height:22px;border-radius:3px;color:#fff;font-size:9px;font-weight:700;font-style:normal;transition:background .5s}
  .vb{background:#047857}.b{background:#059669}.n{background:#6b7280}.be{background:#dc2626}.vbe{background:#991b1b}
  /* strength */
  .dd-cse{flex:1;display:flex;align-items:stretch;justify-content:space-between;gap:5px;padding:12px 10px;min-height:0}
  .dd-col{display:flex;flex-direction:column;align-items:center;flex:1}
  .dd-cup,.dd-cdn{display:flex;flex-direction:column;gap:2px;width:100%;align-items:center;flex:1}
  .dd-cup{justify-content:flex-end}.dd-cdn{justify-content:flex-start}
  .dd-seg{width:74%;height:5px;border-radius:1px;background:#1a1a20;transition:background .4s}
  .dd-seg.g{background:rgba(0,218,80,.867)}
  .dd-seg.r{background:rgba(255,0,0,.78)}
  .dd-cax{height:2px;width:100%;background:#2a2a32;margin:4px 0}
  .dd-clbl{font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;font-size:9px;color:#8a8a93;margin-top:5px}
  /* calendar */
  .dd-cal{overflow-y:auto;padding:2px 0}
  .dd-crow{display:grid;grid-template-columns:42px auto 1fr auto;gap:8px;align-items:center;padding:7px 12px;border-bottom:1px solid #121218;font-size:11px}
  .dd-crow .tm{color:#7f7f88;font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;font-size:10px}
  .dd-crow .ev{color:#cfcfd4;font-size:11px;line-height:1.3}
  .dd-crow .cc{font-weight:700;color:#c2c2c9;font-size:10px}
  .dd-val{font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;text-align:right}
  .dd-val .f{color:#6a6a73}
  /* footer */
  .dd-foot{display:flex;align-items:center;gap:14px;padding:9px 14px;background:#0d0d11;border-top:1px solid #1c1c22;flex-shrink:0;flex-wrap:wrap}
  .dd-foot .note{font-size:10.5px;color:#6a6a73}
  .dd-foot .grow{flex:1}
  .dd-foot .msg{font-size:12px;color:#cfcfd4}
  .dd-foot .msg b{color:#f7941d}
  @media(max-width:820px){
    .dd-grid{grid-template-columns:1fr 1fr}
    .dd-news{grid-row:span 1;grid-column:span 2}
  }
  @media(max-width:560px){
    #dtp-demo{padding:0}
    .dd-win{height:100%;height:100dvh;max-width:100vw;border-radius:0;border:0}
    .dd-top{flex-wrap:wrap;gap:8px 9px;padding:8px 12px}
    .dd-logo{font-size:12px}.dd-logo svg{width:18px;height:18px}
    .dd-sim{font-size:9px;padding:3px 7px}
    .dd-x{order:4;margin-left:auto}
    .dd-top>.dd-cta{order:5;flex-basis:100%;margin-left:0;text-align:center;font-size:12px;padding:9px 12px}
    .dd-grid{grid-template-columns:1fr;grid-auto-rows:210px;grid-template-rows:none;overflow-y:auto;overflow-x:hidden}
    .dd-news,.dd-bias{grid-column:span 1}
    .dd-clock,.dd-tick{display:none}
    .dd-bmx{padding:9px 8px;overflow-x:hidden}
    .dd-brow{grid-template-columns:44px repeat(5,1fr);gap:3px}
    .dd-foot{gap:8px 12px}
    .dd-foot .grow{display:none}
  }`;

  /* ---------- données simulées ---------- */
  var NEWS = [
    ['HIGH','USD','CPI américain : 3,4 % a/a, conforme aux attentes'],
    ['MED','USD','Powell : approche dépendante des données, pas d\'urgence à baisser'],
    ['MED','EUR','Lagarde (BCE) : la désinflation se poursuit, prudence maintenue'],
    ['MED','GBP','La Banque d\'Angleterre maintient ses taux, ton prudent'],
    ['LOW','JPY','Le yen se renforce après la révision à la hausse du PIB'],
    ['MED','OIL','Le WTI recule sous 78 $ sur des craintes de demande'],
    ['LOW','XAU','L\'or se stabilise au-dessus de 2 010 $'],
    ['HIGH','USD','Ventes au détail US au-dessus des prévisions (+0,6 %)'],
    ['LOW','EUR','Production industrielle de la zone euro : −0,6 % m/m'],
    ['LOW','BTC','Le Bitcoin tient au-dessus de 66 000 $, flux ETF positifs'],
    ['MED','CAD','Emploi canadien meilleur qu\'attendu, le CAD se raffermit'],
    ['HIGH','EUR','PMI manufacturier de la zone euro repasse en expansion'],
    ['MED','AUD','La RBA laisse la porte ouverte à une hausse supplémentaire'],
    ['LOW','CHF','Inflation suisse stable, le franc peu réactif'],
    ['HIGH','USD','Le rapport NFP surprend : +275k emplois créés']
  ];
  var TICK = [
    ['EUR/USD',1.0774,4],['USD/JPY',156.92,2],['GBP/USD',1.2618,4],
    ['XAU/USD',2013.4,1],['S&P 500',5026.61,2],['NASDAQ',17891,0],
    ['BTC/USD',66240,0],['WTI',77.9,2]
  ];
  var CCY = ['USD','EUR','GBP','JPY','AUD'];
  var INDS = ['Croiss.','Inflat.','Emploi','Taux','PMI'];
  var BCLS = ['vb','b','n','be','vbe'];
  var BSYM = {vb:'++',b:'+',n:'•',be:'–',vbe:'––'};
  var STR = [['USD',3],['EUR',1],['GBP',2],['JPY',-3],['CHF',2],['AUD',-1],['CAD',-2],['NZD',-4]];
  var CAL = [
    ['13:30','USD','HIGH','Indice des prix à la consommation','3,4 %'],
    ['14:00','EUR','MED','Discours de Mme Lagarde (BCE)','—'],
    ['15:30','USD','MED','Stocks de pétrole brut (EIA)','-1,2M'],
    ['16:00','USD','HIGH','Discours de J. Powell (Fed)','—'],
    ['22:45','NZD','LOW','Balance commerciale','+0,1B']
  ];

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function fmt(v, dp) { return v.toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp }); }

  /* ---------- graphique (random walk) ---------- */
  function initChart(canvas, pxEl) {
    var n = 70, base = 1.0774, prices = [];
    for (var i = 0; i < n; i++) prices.push(base + Math.sin(i / 7) * 0.0009 + rnd(-0.0004, 0.0004));
    chartState = { canvas: canvas, pxEl: pxEl, prices: prices, base: prices[0] };
    drawChart();
  }
  function tickChart() {
    if (!chartState) return;
    var p = chartState.prices, last = p[p.length - 1];
    var nx = last + rnd(-0.00055, 0.00055);
    nx = Math.max(chartState.base - 0.004, Math.min(chartState.base + 0.004, nx));
    p.push(nx); p.shift();
    drawChart();
  }
  function drawChart() {
    var s = chartState; if (!s) return;
    var c = s.canvas, ctx = c.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var p = s.prices, min = Math.min.apply(null, p), max = Math.max.apply(null, p), rg = (max - min) || 1;
    var padT = 36, padB = 14, padL = 6, padR = 64;
    var x = function (i) { return padL + (i / (p.length - 1)) * (w - padL - padR); };
    var y = function (v) { return padT + (1 - (v - min) / rg) * (h - padT - padB); };
    var up = p[p.length - 1] >= s.base;
    var col = up ? '#00e676' : '#ff3d00';
    // grille
    ctx.strokeStyle = '#15151c'; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) { var gy = padT + g / 4 * (h - padT - padB); ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke(); }
    // aire
    var grad = ctx.createLinearGradient(0, padT, 0, h);
    grad.addColorStop(0, up ? 'rgba(0,230,118,.22)' : 'rgba(255,61,0,.20)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.moveTo(x(0), y(p[0]));
    for (var i = 1; i < p.length; i++) ctx.lineTo(x(i), y(p[i]));
    ctx.lineTo(x(p.length - 1), h - padB); ctx.lineTo(x(0), h - padB); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // ligne
    ctx.beginPath(); ctx.moveTo(x(0), y(p[0]));
    for (var j = 1; j < p.length; j++) ctx.lineTo(x(j), y(p[j]));
    ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
    // dernier point + étiquette
    var lx = x(p.length - 1), ly = y(p[p.length - 1]);
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, 7); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = col; ctx.fillRect(w - padR + 4, ly - 9, padR - 8, 18);
    ctx.fillStyle = '#06140c'; ctx.font = '600 11px ui-monospace,Menlo,monospace'; ctx.textBaseline = 'middle';
    ctx.fillText(p[p.length - 1].toFixed(4), w - padR + 9, ly + 1);
    // étiquette prix haut-gauche
    if (s.pxEl) {
      var chg = (p[p.length - 1] - s.base) / s.base * 100;
      s.pxEl.className = 'dd-px ' + (up ? 'up' : 'down');
      s.pxEl.innerHTML = p[p.length - 1].toFixed(4) + ' <span style="font-size:12px">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</span><small>EUR/USD · M5 · simulé</small>';
    }
  }

  /* ---------- rendu des panneaux ---------- */
  function renderBias(box) {
    var rows = [];
    for (var r = 0; r < INDS.length; r++) { var cells = []; for (var k = 0; k < CCY.length; k++) cells.push(pick(BCLS)); rows.push(cells); }
    box._rows = rows; box._el = box;
    var h = '<div class="dd-brow dd-bhead"><span>Ind.</span>' + CCY.map(function (c) { return '<span>' + c + '</span>'; }).join('') + '</div>';
    h += rows.map(function (rw, ri) {
      return '<div class="dd-brow"><span class="dd-blbl">' + INDS[ri] + '</span>' + rw.map(function (cl, ci) { return '<i data-r="' + ri + '" data-c="' + ci + '" class="' + cl + '">' + BSYM[cl] + '</i>'; }).join('') + '</div>';
    }).join('');
    box.innerHTML = h;
  }
  function flipBias(box) {
    var ri = Math.floor(rnd(0, INDS.length)), ci = Math.floor(rnd(0, CCY.length));
    var cell = box.querySelector('i[data-r="' + ri + '"][data-c="' + ci + '"]'); if (!cell) return;
    var cl = pick(BCLS); cell.className = cl; cell.textContent = BSYM[cl];
  }
  function renderStrength(box) {
    box.innerHTML = STR.map(function (d) {
      var v = d[1], up = '', dn = '', i;
      for (i = 4; i >= 1; i--) up += '<span class="dd-seg' + (v >= i ? ' g' : '') + '"></span>';
      for (i = 1; i <= 4; i++) dn += '<span class="dd-seg' + (v <= -i ? ' r' : '') + '"></span>';
      return '<div class="dd-col"><div class="dd-cup">' + up + '</div><div class="dd-cax"></div><div class="dd-cdn">' + dn + '</div><div class="dd-clbl">' + d[0] + '</div></div>';
    }).join('');
  }
  function nudgeStrength(box) {
    for (var i = 0; i < STR.length; i++) { if (Math.random() < 0.5) { STR[i][1] += (Math.random() < 0.5 ? -1 : 1); STR[i][1] = Math.max(-4, Math.min(4, STR[i][1])); } }
    renderStrength(box);
  }
  function newsItem(d) {
    var bcl = d[0] === 'HIGH' ? 'b-high' : d[0] === 'MED' ? 'b-med' : 'b-low';
    var lab = d[0] === 'HIGH' ? 'HIGH' : d[0] === 'MED' ? 'MED' : 'LOW';
    return '<div class="dd-itm"><span class="dd-bdg ' + bcl + '">' + lab + '</span><div><div class="dd-itx">' + d[2] + '</div><div class="meta"><b>' + d[1] + '</b> · à l\'instant</div></div></div>';
  }

  /* ---------- construction de l'overlay ---------- */
  function build() {
    var clockTxt = '13:42:07';
    var tickHtml = TICK.map(function (t) {
      var chg = rnd(-0.4, 0.5); var cls = chg >= 0 ? 'up' : 'down';
      return '<div class="it"><span class="sym">' + t[0] + '</span><span class="px dd-mono">' + fmt(t[1], t[3]) + '</span><span class="ch dd-mono ' + cls + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</span></div>';
    }).join('');
    var calHtml = CAL.map(function (c, i) {
      var bcl = c[2] === 'HIGH' ? 'b-high' : c[2] === 'MED' ? 'b-med' : 'b-low';
      return '<div class="dd-crow" data-i="' + i + '"><span class="tm">' + c[0] + '</span><span class="dd-bdg ' + bcl + '">' + c[2] + '</span><span class="ev">' + c[3] + '</span><span class="dd-val"><span class="f">prév. ' + c[4] + '</span></span></div>';
    }).join('');

    root = el('<div id="dtp-demo" role="dialog" aria-modal="true" aria-label="Démo DataTradingPro — aperçu en simulation"></div>');
    root.innerHTML =
      '<div class="dd-win">' +
        '<div class="dd-top">' +
          '<span class="dd-logo"><svg viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#101014"/><rect x="18" y="22" width="7" height="22" rx="1.5" fill="#22c55e"/><rect x="20.5" y="14" width="2" height="38" fill="#22c55e"/><rect x="39" y="26" width="7" height="18" rx="1.5" fill="#f7941d"/><rect x="41.5" y="18" width="2" height="34" fill="#f7941d"/></svg>Data<b>TradingPro</b></span>' +
          '<span class="dd-sim"><span class="pd"></span>SIMULATION</span>' +
          '<span class="dd-clock dd-mono" id="dd-clock">' + clockTxt + '</span>' +
          '<a class="dd-cta" href="' + WHOP + '">Accéder au terminal — 24,99 €/mois →</a><button class="dd-x" aria-label="Fermer">✕</button>' +
        '</div>' +
        '<div class="dd-tick">' + tickHtml + '</div>' +
        '<div class="dd-grid">' +
          '<div class="dd-p dd-news"><div class="dd-ph"><span class="ttl">Live News</span><span class="live"><span class="pd"></span>EN DIRECT</span></div><div class="dd-feed" id="dd-feed"></div></div>' +
          '<div class="dd-p"><div class="dd-ph"><span class="ttl">EUR/USD · M5</span><span class="live"><span class="pd"></span>LIVE</span></div><div class="dd-chart-wrap"><div class="dd-px" id="dd-px"></div><canvas id="dd-canvas"></canvas></div></div>' +
          '<div class="dd-p dd-bias"><div class="dd-ph"><span class="ttl">Smart Bias</span></div><div class="dd-bmx" id="dd-bias"></div></div>' +
          '<div class="dd-p"><div class="dd-ph"><span class="ttl">Force des devises</span></div><div class="dd-cse" id="dd-str"></div></div>' +
          '<div class="dd-p"><div class="dd-ph"><span class="ttl">Calendrier éco.</span></div><div class="dd-cal" id="dd-cal">' + calHtml + '</div></div>' +
        '</div>' +
        '<div class="dd-foot">' +
          '<span class="note">Démo en temps simulé — données fictives à des fins d\'illustration.</span>' +
          '<span class="grow"></span>' +
          '<span class="msg">Le <b>vrai terminal</b> est encore plus complet, en données réelles.</span>' +
          '<a class="dd-cta" href="' + WHOP + '">Commencer →</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    // remplissage initial du flux news
    var feed = root.querySelector('#dd-feed');
    var seed = NEWS.slice(0, 6); seed.forEach(function (d) { feed.insertAdjacentHTML('beforeend', newsItem(d)); });
    renderBias(root.querySelector('#dd-bias'));
    renderStrength(root.querySelector('#dd-str'));
    initChart(root.querySelector('#dd-canvas'), root.querySelector('#dd-px'));

    // interactions de fermeture
    root.querySelector('.dd-x').addEventListener('click', close);
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });
    document.addEventListener('keydown', onKey);

    // boucles "vivantes"
    var clk = root.querySelector('#dd-clock'); var sec = 13 * 3600 + 42 * 60 + 7;
    var reduce = false; try { reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (!reduce) {
    timers.push(setInterval(function () { sec = (sec + 1) % 86400; var hh = (sec / 3600 | 0), mm = ((sec % 3600) / 60 | 0), ss = sec % 60; clk.textContent = ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2) + ':' + ('0' + ss).slice(-2); }, 1000));
    timers.push(setInterval(tickChart, 130));
    timers.push(setInterval(function () {
      var d = pick(NEWS);
      feed.insertAdjacentHTML('afterbegin', newsItem(d));
      while (feed.children.length > 9) feed.removeChild(feed.lastChild);
    }, 2600));
    timers.push(setInterval(function () { flipBias(root.querySelector('#dd-bias')); }, 2300));
    timers.push(setInterval(function () { nudgeStrength(root.querySelector('#dd-str')); }, 1500));
    timers.push(setInterval(function () { refreshTicker(root); }, 1300));
    timers.push(setInterval(function () { revealActual(root); }, 4200));
    }
    window.addEventListener('resize', drawChart);
  }
  function refreshTicker(root) {
    var its = root.querySelectorAll('.dd-tick .it');
    its.forEach(function (it, i) {
      var base = TICK[i]; var chg = rnd(-0.45, 0.5); var cls = chg >= 0 ? 'up' : 'down';
      var px = base[1] * (1 + rnd(-0.0006, 0.0006));
      it.querySelector('.px').textContent = fmt(px, base[3]);
      var ch = it.querySelector('.ch'); ch.className = 'ch dd-mono ' + cls; ch.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    });
  }
  function revealActual(root) {
    var rows = root.querySelectorAll('#dd-cal .dd-crow');
    var r = rows[Math.floor(rnd(0, rows.length))]; if (!r) return;
    var i = +r.getAttribute('data-i'); var fcs = CAL[i][4];
    if (fcs === '—') return;
    var beat = Math.random() < 0.5;
    r.querySelector('.dd-val').innerHTML = '<span class="' + (beat ? 'up' : 'down') + '">' + (beat ? '▲ ' : '▼ ') + fcs + '</span> <span class="f">prév. ' + fcs + '</span>';
  }
  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab' && root) {
      var f = root.querySelectorAll('a[href],button,[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  /* ---------- API ---------- */
  function open() {
    if (root) return;
    prevFocus = document.activeElement;
    if (!document.getElementById('dtp-demo-style')) { var st = document.createElement('style'); st.id = 'dtp-demo-style'; st.textContent = CSS; document.head.appendChild(st); }
    build();
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { root.classList.add('on'); setTimeout(drawChart, 60); var x = root.querySelector('.dd-x'); if (x) x.focus(); });
  }
  function close() {
    if (!root) return;
    timers.forEach(clearInterval); timers = [];
    window.removeEventListener('resize', drawChart);
    document.removeEventListener('keydown', onKey);
    var r = root; root = null; chartState = null;
    r.classList.remove('on');
    document.body.style.overflow = '';
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} } prevFocus = null;
    setTimeout(function () { if (r && r.parentNode) r.parentNode.removeChild(r); }, 260);
  }
  window.DTPDemo = { open: open, close: close };

  // Ouverture par ancre #demo (deep-link partageable + survit aux rechargements)
  function maybeAuto() { if (location.hash === '#demo') open(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeAuto); else maybeAuto();
  window.addEventListener('hashchange', function () { if (location.hash === '#demo') { if (!root) open(); } else if (root) close(); });
})();

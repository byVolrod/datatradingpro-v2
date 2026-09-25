/* ═══ DTP V3 · RECHERCHE MULTI-ACTIFS (comptes admin, « Aperçu V3 ») ══════════════════════════════════
   Demande user (25/09, capture : « sp » → « Aucune paire ») : « incorpore métaux, crypto, actions
   dans la barre de recherche », sans dénaturer le Forex. La barre reste UNE barre : elle reconnaît
   la classe de ce qu'on tape (EURUSD → Forex, XAUUSD → Métaux, BTC → Crypto, US100 → Indices,
   AAPL → Actions) et range les résultats par classe, avec des filtres rapides au-dessus.
   · Une PAIRE DE DEVISES (et l'or, l'argent) ouvre la vue paire existante : rien ne change pour le
     trader Forex, c'est lui le cœur du desk.
   · Tout autre actif ouvre sa FICHE : graphique, cotation du jour, et les dépêches du fil qui en
     parlent. Les widgets universels (graphique, performance, actualités) valent pour tous les actifs ;
     les widgets propres au Forex (biais, COT, particuliers) restent sur la vue paire.
   Le catalogue est ici, côté client : c'est une LISTE DE NOMS, pas une donnée de marché. Les cotations
   viennent de /api/v2/multi-actifs, déjà servie au widget Multi-actifs (aucune route de plus). */
(function () {
  'use strict';
  if (window.DTPRechercheActifs) return;

  var CLASSES = [['forex', 'Forex'], ['indices', 'Indices'], ['actions', 'Actions'], ['metaux', 'Métaux'], ['energie', 'Énergie'], ['crypto', 'Crypto']];
  // [code affiché, nom, classe, symbole TradingView, alias de recherche, symbole Yahoo du widget Multi-actifs]
  var CATALOGUE = [
    ['XAUUSD', 'Or', 'metaux', 'FX:XAUUSD', 'or gold xau', 'GC=F'],
    ['XAGUSD', 'Argent', 'metaux', 'FX:XAGUSD', 'argent silver xag', 'SI=F'],
    ['XPTUSD', 'Platine', 'metaux', 'TVC:PLATINUM', 'platine platinum xpt', 'PL=F'],
    ['XPDUSD', 'Palladium', 'metaux', 'TVC:PALLADIUM', 'palladium xpd', 'PA=F'],
    ['COPPER', 'Cuivre', 'metaux', 'COMEX:HG1!', 'cuivre copper hg', 'HG=F'],
    ['WTI', 'Pétrole WTI', 'energie', 'TVC:USOIL', 'petrole oil crude wti usoil cl', 'CL=F'],
    ['BRENT', 'Pétrole Brent', 'energie', 'TVC:UKOIL', 'petrole oil crude brent ukoil', 'BZ=F'],
    ['NATGAS', 'Gaz naturel', 'energie', 'NYMEX:NG1!', 'gaz gas natural ng natgas', 'NG=F'],
    ['US500', 'S&P 500', 'indices', 'SP:SPX', 'sp sp500 spx s&p es us500 spy', '^GSPC'],
    ['US100', 'Nasdaq 100', 'indices', 'NASDAQ:NDX', 'nasdaq nas100 ndx nq us100 qqq', '^NDX'],
    ['US30', 'Dow Jones', 'indices', 'DJ:DJI', 'dow jones dji us30 ym', '^DJI'],
    ['DE40', 'DAX', 'indices', 'XETR:DAX', 'dax ger40 de40 allemagne', '^GDAXI'],
    ['FR40', 'CAC 40', 'indices', 'EURONEXT:PX1', 'cac cac40 fra40 fr40 france', '^FCHI'],
    ['UK100', 'FTSE 100', 'indices', 'TVC:UKX', 'ftse uk100 ukx londres', '^FTSE'],
    ['JP225', 'Nikkei 225', 'indices', 'TVC:NI225', 'nikkei jp225 nky japon', '^N225'],
    ['HK50', 'Hang Seng', 'indices', 'TVC:HSI', 'hang seng hsi hk50 hong kong', '^HSI'],
    ['EU50', 'Euro Stoxx 50', 'indices', 'TVC:SX5E', 'stoxx eu50 sx5e eurostoxx', ''],
    ['DXY', 'Dollar index', 'indices', 'TVC:DXY', 'dxy dollar index usdx', 'DX-Y.NYB'],
    ['VIX', 'VIX', 'indices', 'TVC:VIX', 'vix volatilite volatility peur', '^VIX'],
    ['BTCUSD', 'Bitcoin', 'crypto', 'BITSTAMP:BTCUSD', 'btc bitcoin xbt', 'BTC-USD'],
    ['ETHUSD', 'Ethereum', 'crypto', 'BITSTAMP:ETHUSD', 'eth ethereum ether', 'ETH-USD'],
    ['SOLUSD', 'Solana', 'crypto', 'COINBASE:SOLUSD', 'sol solana', 'SOL-USD'],
    ['XRPUSD', 'XRP', 'crypto', 'BITSTAMP:XRPUSD', 'xrp ripple', 'XRP-USD'],
    ['BNBUSD', 'BNB', 'crypto', 'BINANCE:BNBUSDT', 'bnb binance', ''],
    ['ADAUSD', 'Cardano', 'crypto', 'COINBASE:ADAUSD', 'ada cardano', ''],
    ['DOGEUSD', 'Dogecoin', 'crypto', 'BINANCE:DOGEUSDT', 'doge dogecoin', ''],
    ['AAPL', 'Apple', 'actions', 'NASDAQ:AAPL', 'apple aapl iphone', ''],
    ['MSFT', 'Microsoft', 'actions', 'NASDAQ:MSFT', 'microsoft msft', ''],
    ['NVDA', 'Nvidia', 'actions', 'NASDAQ:NVDA', 'nvidia nvda', ''],
    ['AMZN', 'Amazon', 'actions', 'NASDAQ:AMZN', 'amazon amzn', ''],
    ['GOOGL', 'Alphabet (Google)', 'actions', 'NASDAQ:GOOGL', 'google alphabet googl goog', ''],
    ['META', 'Meta', 'actions', 'NASDAQ:META', 'meta facebook', ''],
    ['TSLA', 'Tesla', 'actions', 'NASDAQ:TSLA', 'tesla tsla musk', ''],
    ['NFLX', 'Netflix', 'actions', 'NASDAQ:NFLX', 'netflix nflx', ''],
    ['AMD', 'AMD', 'actions', 'NASDAQ:AMD', 'amd', ''],
    ['JPM', 'JPMorgan Chase', 'actions', 'NYSE:JPM', 'jpmorgan jpm', ''],
    ['GS', 'Goldman Sachs', 'actions', 'NYSE:GS', 'goldman sachs gs', ''],
    ['BRK.B', 'Berkshire Hathaway', 'actions', 'NYSE:BRK.B', 'berkshire buffett brk', ''],
    ['MC', 'LVMH', 'actions', 'EURONEXT:MC', 'lvmh mc luxe', ''],
    ['TTE', 'TotalEnergies', 'actions', 'EURONEXT:TTE', 'total totalenergies tte', ''],
    ['AIR', 'Airbus', 'actions', 'EURONEXT:AIR', 'airbus air', ''],
    ['ASML', 'ASML', 'actions', 'EURONEXT:ASML', 'asml', ''],
    ['SAP', 'SAP', 'actions', 'XETR:SAP', 'sap', ''],
  ].map(function (a) { return { code: a[0], nom: a[1], cl: a[2], tv: a[3], alias: a[4], yf: a[5] }; });

  var norm = function (t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9&.]+/g, ' ').trim(); };
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var nomClasse = function (k) { return (CLASSES.filter(function (c) { return c[0] === k; })[0] || [k, k])[1]; };
  var PASTILLE = { indices: 'Idx', actions: 'Act', metaux: 'Mét', energie: 'Éng', crypto: '₿' };

  /* Score de correspondance : 0 = rien. Code exact > début de code > début de nom ou d'alias > contenu.
     Deux lettres ne trouvent qu'un DÉBUT (« sp » → S&P 500, pas « ASML ») ; au-delà, le contenu compte. */
  function score(a, q) {
    if (!q) return 0;
    var code = norm(a.code).replace(/[^a-z0-9]/g, ''), qc = q.replace(/[^a-z0-9]/g, '');
    if (qc && code === qc) return 100;
    if (qc && code.indexOf(qc) === 0) return 80;
    var mots = (norm(a.nom) + ' ' + a.alias).split(/\s+/);
    if (mots.some(function (m) { return m === q || m.replace(/[^a-z0-9]/g, '') === qc; })) return 70;
    if (mots.some(function (m) { return m.indexOf(q) === 0; }) || norm(a.nom).indexOf(q) === 0) return 60;
    if (q.length >= 3 && (norm(a.nom).indexOf(q) >= 0 || a.alias.indexOf(q) >= 0)) return 30;
    return 0;
  }
  function chercher(requete, filtre) {
    var q = norm(requete);
    return CATALOGUE.map(function (a) { return { a: a, s: score(a, q) }; })
      .filter(function (x) { return x.s > 0 && (!filtre || filtre === 'tout' || x.a.cl === filtre); })
      .sort(function (x, y) { return y.s - x.s || x.a.nom.localeCompare(y.a.nom); })
      .map(function (x) { return x.a; });
  }
  // La classe d'un code tapé (EURUSD → forex) : la barre l'annonce sans qu'on ait à choisir.
  function classeDe(requete, estPaire) {
    if (estPaire) return 'forex';
    var r = chercher(requete)[0];
    return r ? r.cl : null;
  }
  function ligne(a) {
    return '<div class="sym-dd-row sym-dd-row--actif" data-actif="' + esc(a.code) + '">'
      + '<span class="sym-dd-flags"><span class="sym-dd-flag sym-dd-flag--cl sym-dd-flag--' + a.cl + '">' + esc(PASTILLE[a.cl] || '·') + '</span></span>'
      + '<span class="sym-dd-txt"><span class="sym-dd-sym">' + esc(a.code) + '</span><span class="sym-dd-name">' + esc(a.nom) + '</span></span>'
      + '<span class="sym-dd-cl">' + esc(nomClasse(a.cl)) + '</span></div>';
  }
  var filtreCourant = 'tout';
  function puces() {
    return '<div class="sym-dd-puces" role="tablist">' + [['tout', 'Tout']].concat(CLASSES).map(function (c) {
      return '<button type="button" class="sym-dd-puce' + (c[0] === filtreCourant ? ' on' : '') + '" data-filtre="' + c[0] + '" role="tab" aria-selected="' + (c[0] === filtreCourant) + '">' + esc(c[1]) + '</button>';
    }).join('') + '</div>';
  }
  /* Appelé par charts.js (renderDd) sous l'Aperçu V3 : `fx` = le HTML des paires déjà calculé,
     `nFx` = leur nombre. Rend la barre de filtres puis les sections par classe. */
  function sections(requete, fx, nFx) {
    var h = puces();
    var q = norm(requete);
    if (!q) {
      if (filtreCourant === 'tout' || filtreCourant === 'forex') return h + fx;
      var tous = CATALOGUE.filter(function (a) { return a.cl === filtreCourant; });
      return h + '<div class="sym-dd-head"><span class="sym-dd-hash">#</span> ' + esc(nomClasse(filtreCourant)) + ' <span class="sym-dd-count">(' + tous.length + ')</span></div>' + tous.map(ligne).join('');
    }
    var res = chercher(requete, filtreCourant === 'forex' ? 'aucun' : filtreCourant);
    if (filtreCourant === 'tout' || filtreCourant === 'forex') h += fx;
    CLASSES.forEach(function (c) {
      if (c[0] === 'forex') return;
      var l = res.filter(function (a) { return a.cl === c[0]; }).slice(0, 8);
      if (l.length) h += '<div class="sym-dd-head"><span class="sym-dd-hash">#</span> ' + esc(c[1]) + ' <span class="sym-dd-count">(' + l.length + ')</span></div>' + l.map(ligne).join('');
    });
    var vide = !nFx && !res.length;
    if (vide) h += '<div class="sym-dd-empty">Aucun actif ne correspond' + (filtreCourant !== 'tout' ? ' dans « ' + esc(nomClasse(filtreCourant)) + ' »' : '') + '</div>';
    return h;
  }
  function filtrer(k) { filtreCourant = k || 'tout'; }

  /* ── LA FICHE D'UN ACTIF : graphique, cotation du jour, dépêches ─────────────────────────────── */
  var cotes = null, cotesAt = 0;
  function lireCotes() {
    if (cotes && Date.now() - cotesAt < 90000) return Promise.resolve(cotes);
    return fetch('/api/v2/multi-actifs', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.classes) { cotes = d; cotesAt = Date.now(); } return cotes; }).catch(function () { return cotes; });
  }
  function nf(v, d) { return v == null ? '·' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function depeches(a) {
    var items = [];
    try { items = typeof allItems !== 'undefined' && Array.isArray(allItems) ? allItems : []; } catch (e) {}
    var corr = window._rechercheCorrespond;
    if (typeof corr !== 'function') return [];
    var cles = [a.nom].concat(a.alias.split(/\s+/).filter(function (m) { return m.length >= 3; }));
    return items.filter(function (it) { return cles.some(function (k) { return corr(it, k); }); }).slice(0, 12);
  }
  function fermer() { var o = document.getElementById('v3a-fiche'); if (o) o.remove(); document.removeEventListener('keydown', echap); }
  function echap(e) { if (e.key === 'Escape') fermer(); }
  function ouvrir(code) {
    var a = CATALOGUE.filter(function (x) { return x.code === code; })[0];
    if (!a) return;
    // L'or et l'argent ont déjà leur vue complète (biais, COT, saisonnalité) : on y va.
    if ((code === 'XAUUSD' || code === 'XAGUSD') && typeof window.openSymbol === 'function') { window.openSymbol(code); return; }
    fermer();
    var o = document.createElement('div');
    o.id = 'v3a-fiche'; o.className = 'v3a-fiche';
    o.innerHTML = '<div class="v3a-fiche-fond"></div><article class="v3a-fiche-carte" role="dialog" aria-label="' + esc(a.nom) + '">'
      + '<header><span class="v3a-fiche-t"><b>' + esc(a.nom) + '</b><small>' + esc(a.code) + '</small><em class="v3a-fiche-cl v3a-fiche-cl--' + a.cl + '">' + esc(nomClasse(a.cl)) + '</em></span>'
      + '<span class="v3a-fiche-cote" aria-live="polite"></span><button type="button" class="v3a-fiche-x" aria-label="Fermer">×</button></header>'
      + '<div class="v3a-fiche-corps"><div class="v3a-fiche-graph" id="v3a-fiche-tv"><div class="v3a-fiche-attente">Chargement du graphique…</div></div>'
      + '<aside class="v3a-fiche-fil"><h4>Dans le fil</h4><div class="v3a-fiche-liste"></div></aside></div></article>';
    document.body.appendChild(o);
    o.querySelector('.v3a-fiche-fond').onclick = fermer;
    o.querySelector('.v3a-fiche-x').onclick = fermer;
    document.addEventListener('keydown', echap);
    // Dépêches : le même moteur que la recherche du fil (titre affiché, accents, équivalents anglais).
    var liste = o.querySelector('.v3a-fiche-liste'), deps = depeches(a);
    liste.innerHTML = deps.length ? deps.map(function (it) {
      var t = it._titreFr || it.headline || '', h = it.timestamp ? new Date(it.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
      return '<div class="v3a-fiche-dep"><time>' + esc(h) + '</time><span>' + esc(t) + '</span></div>';
    }).join('') : '<p class="v3a-fiche-vide">Aucune dépêche récente sur ' + esc(a.nom) + '.</p>';
    // Cotation du jour, quand l'actif est suivi par le widget Multi-actifs.
    if (a.yf) lireCotes().then(function (d) {
      if (!d || !o.isConnected) return;
      var x = null; d.classes.forEach(function (c) { c.items.forEach(function (i) { if (i.sym === a.yf) x = i; }); });
      if (!x || !x.ok) return;
      var s = x.chg > 0 ? 'up' : x.chg < 0 ? 'dn' : 'eq';
      o.querySelector('.v3a-fiche-cote').innerHTML = '<b>' + nf(x.prix, x.dec) + (x.rendement ? '%' : '') + '</b><span class="v3a-' + s + '">'
        + (x.chg > 0 ? '+' : '') + (x.rendement ? nf(x.chg, 1) + ' pb' : nf(x.chg, 2) + '%') + '</span>';
    });
    // Graphique : le même fournisseur que la vue paire (TradingView), chargé à la demande.
    var monter = function () {
      if (!o.isConnected || !window.TradingView) return;
      try {
        new window.TradingView.widget({ container_id: 'v3a-fiche-tv', symbol: a.tv, interval: '60', autosize: true, theme: 'dark', style: '1',
          locale: 'fr', timezone: 'Europe/Paris', hide_side_toolbar: false, allow_symbol_change: false, withdateranges: true,
          backgroundColor: '#0a0a0c', gridColor: 'rgba(255,255,255,0.04)', toolbar_bg: '#0c0c0e' });
      } catch (e) {}
    };
    if (window.TradingView) monter();
    else {
      var s = document.createElement('script'); s.src = 'https://s3.tradingview.com/tv.js'; s.async = true; s.onload = monter;
      // Fournisseur injoignable (réseau, bloqueur) : on le dit au lieu d'un cadre vide.
      s.onerror = function () { var w = o.querySelector('.v3a-fiche-attente'); if (w) w.textContent = 'Graphique indisponible pour le moment.'; };
      document.head.appendChild(s);
    }
  }

  // Habillage : injecté ici pour que le module reste d'un seul tenant (même idiome que multi.js).
  var CSS = ''
    + 'html.dtp-v2 .sym-dd-puces{display:flex;flex-wrap:nowrap;gap:4px;padding:8px 10px 7px;border-bottom:1px solid var(--v3-ligne, #16161a);position:sticky;top:0;z-index:2;background:inherit;overflow-x:auto;scrollbar-width:none}'
    + 'html.dtp-v2 .sym-dd-puces::-webkit-scrollbar{display:none}html.dtp-v2 .sym-dd-puce{flex:0 0 auto}'
    + 'html.dtp-v2 .sym-dd-puce{border:1px solid var(--v3-bord, #24242a);background:transparent;color:var(--v3-doux, #8e8e98);font:500 11px/1 "Inter Tight",system-ui,sans-serif;padding:5px 9px;border-radius:12px;cursor:pointer}'
    + 'html.dtp-v2 .sym-dd-puce:hover{color:var(--v3-titre, #ececf0)}html.dtp-v2 .sym-dd-puce.on{color:var(--v3-or-texte, #e3b23a);border-color:rgba(227,178,58,.55);background:rgba(227,178,58,.08)}'
    + 'html.dtp-v2 .sym-dd-row--actif{align-items:center}html.dtp-v2 .sym-dd-cl{margin-left:auto;font:500 10.5px/1 "Inter Tight",system-ui,sans-serif;color:var(--v3-pale, #6f6f78);padding-left:8px}'
    + 'html.dtp-v2 .sym-dd-flag--cl{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font:700 8.5px/1 "Inter Tight",system-ui,sans-serif;letter-spacing:.02em;color:#0c0c0e}'
    + 'html.dtp-v2 .sym-dd-flag--indices{background:#8fb3ff}html.dtp-v2 .sym-dd-flag--actions{background:#b9a4ff}html.dtp-v2 .sym-dd-flag--metaux{background:#e3b23a}'
    + 'html.dtp-v2 .sym-dd-flag--energie{background:#ff9f5a}html.dtp-v2 .sym-dd-flag--crypto{background:#f7c46c}'
    + '.v3a-fiche{position:fixed;inset:0;z-index:1500;display:flex;align-items:center;justify-content:center}'
    + '.v3a-fiche-fond{position:absolute;inset:0;background:rgba(5,5,7,.62);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}'
    + '.v3a-fiche-carte{position:relative;width:min(1100px,calc(100vw - 32px));height:min(680px,calc(100dvh - 64px));display:flex;flex-direction:column;background:#0c0c0e;border:1px solid #1c1c20;border-radius:8px;box-shadow:0 24px 60px rgba(0,0,0,.55);overflow:hidden;animation:v3aFiche .22s ease-out}'
    + '@keyframes v3aFiche{from{opacity:0;transform:translateY(8px) scale(.99)}}'
    + '.v3a-fiche-carte header{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid #16161a}'
    + '.v3a-fiche-t{display:flex;align-items:baseline;gap:9px;min-width:0}.v3a-fiche-t b{font:600 20px/1.1 "Fraunces",Georgia,serif;color:#f2f2f4}'
    + '.v3a-fiche-t small{font:500 12px/1 ui-monospace,Menlo,monospace;color:#8e8e98}'
    + '.v3a-fiche-cl{font:600 10.5px/1 "Inter Tight",system-ui,sans-serif;font-style:normal;color:#e3b23a;border:1px solid rgba(227,178,58,.45);border-radius:10px;padding:3px 8px}'
    + '.v3a-fiche-cote{margin-left:auto;display:flex;align-items:baseline;gap:10px;font:600 16px/1 ui-monospace,Menlo,monospace;color:#f2f2f4;font-variant-numeric:tabular-nums}'
    + '.v3a-fiche-cote span{font-size:13px}.v3a-up{color:#00e676}.v3a-dn{color:#ff3d00}.v3a-eq{color:#8e8e98}'
    + '.v3a-fiche-x{border:0;background:none;color:#8e8e98;font-size:24px;line-height:1;cursor:pointer;padding:0 4px}.v3a-fiche-x:hover{color:#f2f2f4}'
    + '.v3a-fiche-corps{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 300px}'
    + '.v3a-fiche-graph{min-height:0;position:relative}.v3a-fiche-attente{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6f6f78;font:500 12.5px/1.4 "Inter Tight",system-ui,sans-serif}.v3a-fiche-fil{border-left:1px solid #16161a;display:flex;flex-direction:column;min-height:0}'
    + '.v3a-fiche-fil h4{margin:0;padding:10px 14px;font:600 11.5px/1 "Inter Tight",system-ui,sans-serif;color:#8e8e98;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #16161a}'
    + '.v3a-fiche-liste{flex:1;overflow-y:auto}.v3a-fiche-dep{display:flex;gap:9px;padding:9px 14px;border-bottom:1px solid #121215;font-size:12.5px;line-height:1.4;color:#d6d6dc}'
    + '.v3a-fiche-dep time{flex:0 0 auto;font:500 11px/1.4 ui-monospace,Menlo,monospace;color:#6f6f78}.v3a-fiche-vide{padding:16px 14px;color:#6f6f78;font-size:12.5px}'
    + '@media (max-width:820px){.v3a-fiche-carte{width:100vw;height:100dvh;border-radius:0}.v3a-fiche-corps{grid-template-columns:1fr;grid-template-rows:minmax(0,1.4fr) minmax(0,1fr)}.v3a-fiche-fil{border-left:0;border-top:1px solid #16161a}}';
  (function styles() { if (document.getElementById('v3a-rech-styles')) return; var st = document.createElement('style'); st.id = 'v3a-rech-styles'; st.textContent = CSS; document.head.appendChild(st); })();

  window.DTPRechercheActifs = { sections: sections, filtrer: filtrer, ouvrir: ouvrir, chercher: chercher, classeDe: classeDe, CATALOGUE: CATALOGUE };
})();

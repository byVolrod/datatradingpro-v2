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
  // [code affiché, nom, classe, symbole TradingView, alias de recherche, symbole Yahoo (cotation Multi-actifs
  //  quand il la suit, et historique de la fiche : Performance, Moteurs)]
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
    ['EU50', 'Euro Stoxx 50', 'indices', 'TVC:SX5E', 'stoxx eu50 sx5e eurostoxx', '^STOXX50E'],
    ['DXY', 'Dollar index', 'indices', 'TVC:DXY', 'dxy dollar index usdx', 'DX-Y.NYB'],
    ['VIX', 'VIX', 'indices', 'TVC:VIX', 'vix volatilite volatility peur', '^VIX'],
    ['BTCUSD', 'Bitcoin', 'crypto', 'BITSTAMP:BTCUSD', 'btc bitcoin xbt', 'BTC-USD'],
    ['ETHUSD', 'Ethereum', 'crypto', 'BITSTAMP:ETHUSD', 'eth ethereum ether', 'ETH-USD'],
    ['SOLUSD', 'Solana', 'crypto', 'COINBASE:SOLUSD', 'sol solana', 'SOL-USD'],
    ['XRPUSD', 'XRP', 'crypto', 'BITSTAMP:XRPUSD', 'xrp ripple', 'XRP-USD'],
    ['BNBUSD', 'BNB', 'crypto', 'BINANCE:BNBUSDT', 'bnb binance', 'BNB-USD'],
    ['ADAUSD', 'Cardano', 'crypto', 'COINBASE:ADAUSD', 'ada cardano', 'ADA-USD'],
    ['DOGEUSD', 'Dogecoin', 'crypto', 'BINANCE:DOGEUSDT', 'doge dogecoin', 'DOGE-USD'],
    ['AAPL', 'Apple', 'actions', 'NASDAQ:AAPL', 'apple aapl iphone', 'AAPL'],
    ['MSFT', 'Microsoft', 'actions', 'NASDAQ:MSFT', 'microsoft msft', 'MSFT'],
    ['NVDA', 'Nvidia', 'actions', 'NASDAQ:NVDA', 'nvidia nvda', 'NVDA'],
    ['AMZN', 'Amazon', 'actions', 'NASDAQ:AMZN', 'amazon amzn', 'AMZN'],
    ['GOOGL', 'Alphabet (Google)', 'actions', 'NASDAQ:GOOGL', 'google alphabet googl goog', 'GOOGL'],
    ['META', 'Meta', 'actions', 'NASDAQ:META', 'meta facebook', 'META'],
    ['TSLA', 'Tesla', 'actions', 'NASDAQ:TSLA', 'tesla tsla musk', 'TSLA'],
    ['NFLX', 'Netflix', 'actions', 'NASDAQ:NFLX', 'netflix nflx', 'NFLX'],
    ['AMD', 'AMD', 'actions', 'NASDAQ:AMD', 'amd', 'AMD'],
    ['JPM', 'JPMorgan Chase', 'actions', 'NYSE:JPM', 'jpmorgan jpm', 'JPM'],
    ['GS', 'Goldman Sachs', 'actions', 'NYSE:GS', 'goldman sachs gs', 'GS'],
    ['BRK.B', 'Berkshire Hathaway', 'actions', 'NYSE:BRK.B', 'berkshire buffett brk', 'BRK-B'],
    ['MC', 'LVMH', 'actions', 'EURONEXT:MC', 'lvmh mc luxe', 'MC.PA'],
    ['TTE', 'TotalEnergies', 'actions', 'EURONEXT:TTE', 'total totalenergies tte', 'TTE.PA'],
    ['AIR', 'Airbus', 'actions', 'EURONEXT:AIR', 'airbus air', 'AIR.PA'],
    ['ASML', 'ASML', 'actions', 'EURONEXT:ASML', 'asml', 'ASML.AS'],
    ['SAP', 'SAP', 'actions', 'XETR:SAP', 'sap', 'SAP.DE'],
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
  /* ── LA FICHE D'UN ACTIF, EN SOUS-ONGLETS PROPRES À SA CLASSE (26/09, multi-actifs étape 4) ─────
     Un trader d'indices, de métaux ou de crypto ne regarde pas les mêmes choses qu'un trader Forex,
     ni entre eux : la fiche se range donc en onglets, et leur JEU dépend de la classe.
     · Aperçu : graphique et dépêches du fil (pour tous).
     · Performance : horizons de 1 jour à 1 an, fourchette sur un an, tendance, volatilité.
     · Moteurs : ce avec quoi l'actif a bougé sur 60 séances, choisis PAR CLASSE côté serveur (un
       métal face au dollar et aux taux, une crypto face au Nasdaq, une action face à SON indice :
       l'onglet s'appelle alors « Face à son indice »).
     · Agenda : les rendez-vous qui le font bouger (devise de sa place, stocks et OPEP pour
       l'énergie).
     · Sa classe : tous les actifs de la même classe, classés par variation du jour (sauf les
       actions, que le flux Multi-actifs ne suit pas).
     Performance et Moteurs partagent UNE requête, lancée dès l'ouverture : changer d'onglet est
     instantané. Chaque attente a sa sortie (délai borné, message d'indisponibilité). */
  var ONGLETS = {
    indices: [['apercu', 'Aperçu'], ['perf', 'Performance'], ['moteurs', 'Moteurs'], ['agenda', 'Agenda'], ['classe', 'Indices mondiaux']],
    metaux: [['apercu', 'Aperçu'], ['perf', 'Performance'], ['moteurs', 'Moteurs'], ['agenda', 'Agenda'], ['classe', 'Tous les métaux']],
    energie: [['apercu', 'Aperçu'], ['perf', 'Performance'], ['moteurs', 'Moteurs'], ['agenda', 'Stocks et agenda'], ['classe', 'Toute l’énergie']],
    crypto: [['apercu', 'Aperçu'], ['perf', 'Performance'], ['moteurs', 'Moteurs'], ['classe', 'Marché crypto'], ['agenda', 'Agenda']],
    actions: [['apercu', 'Aperçu'], ['perf', 'Performance'], ['moteurs', 'Face à son indice'], ['agenda', 'Agenda']],
  };
  var DEVISE_INDICE = { US500: 'USD', US100: 'USD', US30: 'USD', VIX: 'USD', DXY: 'USD', DE40: 'EUR', FR40: 'EUR', EU50: 'EUR', UK100: 'GBP', JP225: 'JPY', HK50: 'CNY' };
  var MOTIF_ENERGIE = /crude|oil|gasoline|distillate|natural gas|heating|opec|rig count|\beia\b|p[ée]trole|brut|\bgaz\b|opep/i;
  // Les rendez-vous qui comptent pour cet actif : la devise de sa place, plus un motif pour l'énergie.
  function agendaRegle(a) {
    if (a.cl === 'indices') return { dev: [DEVISE_INDICE[a.code] || 'USD'] };
    if (a.cl === 'metaux') return { dev: a.code === 'COPPER' ? ['USD', 'CNY'] : ['USD'] };
    if (a.cl === 'energie') return { dev: ['USD'], motif: MOTIF_ENERGIE };
    if (a.cl === 'actions') return { dev: [/^(EURONEXT|XETR):/.test(a.tv) ? 'EUR' : 'USD'] };
    return { dev: ['USD'] };
  }
  function agendaFiltre(evs, a, maintenant) {
    var r = agendaRegle(a), debut = maintenant - 24 * 3600e3, fin = maintenant + 7 * 86400e3;
    return (evs || []).filter(function (e) {
      if (!e || !e.timestamp || e.timestamp < debut || e.timestamp > fin) return false;
      var fort = String(e.impact || '').toLowerCase() === 'high';
      if (r.motif && r.motif.test(e.title || '')) return true;
      return fort && r.dev.indexOf(e.currency) >= 0;
    }).sort(function (x, y) { return x.timestamp - y.timestamp; }).slice(0, 16);
  }
  var decDe = function (v) { var x = Math.abs(v); return x >= 10000 ? 0 : x >= 1000 ? 1 : x >= 10 ? 2 : x >= 1 ? 3 : 4; };
  var prix = function (v) { return v == null ? '·' : nf(v, decDe(v)); };
  var signe = function (v, d, u) { if (v == null) return '·'; return (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), d) + (u == null ? '%' : u); };
  var sensCl = function (v) { return v > 0 ? 'v3a-up' : v < 0 ? 'v3a-dn' : 'v3a-eq'; };
  var borne = function (url, ms) {
    return (window.dtpFetchBorne ? window.dtpFetchBorne(url, { credentials: 'same-origin' }, ms) : fetch(url, { credentials: 'same-origin' }))
      .then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; });
  };
  var attente = function (t) { return '<div class="v3a-pane-attente"><span class="v3a-pt"></span><span class="v3a-pt"></span><span class="v3a-pt"></span><em>' + esc(t) + '</em></div>'; };
  var vide = function (t) { return '<p class="v3a-pane-vide">' + esc(t) + '</p>'; };

  // Courbe d'un an, avec survol : la date et le cours sous le doigt.
  function courbeAn(serie) {
    if (!serie || serie.length < 2) return '';
    var W = 600, H = 170, vs = serie.map(function (p) { return p[1]; });
    var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs), et = (mx - mn) || 1;
    var X = function (i) { return (i / (serie.length - 1)) * W; }, Y = function (v) { return 8 + (1 - (v - mn) / et) * (H - 16); };
    var pts = serie.map(function (p, i) { return X(i).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ');
    return '<div class="v3a-an" data-serie="' + esc(JSON.stringify(serie)) + '">'
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="v3aAnG" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="#e3b23a" stop-opacity=".28"/><stop offset="1" stop-color="#e3b23a" stop-opacity="0"/></linearGradient></defs>'
      + '<polygon points="0,' + H + ' ' + pts + ' ' + W + ',' + H + '" fill="url(#v3aAnG)"/>'
      + '<polyline points="' + pts + '" fill="none" stroke="#e3b23a" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>'
      + '<span class="v3a-an-max">' + prix(mx) + '</span><span class="v3a-an-min">' + prix(mn) + '</span>'
      + '<i class="v3a-an-curseur" hidden></i><span class="v3a-an-bulle" hidden></span></div>';
  }
  function survolAn(hote) {
    var an = hote.querySelector('.v3a-an'); if (!an) return;
    var serie = []; try { serie = JSON.parse(an.getAttribute('data-serie')); } catch (e) {}
    var cur = an.querySelector('.v3a-an-curseur'), bulle = an.querySelector('.v3a-an-bulle');
    var bouger = function (ev) {
      var r = an.getBoundingClientRect(), x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      var i = Math.max(0, Math.min(serie.length - 1, Math.round((x / r.width) * (serie.length - 1))));
      var p = serie[i]; if (!p) return;
      var px = (i / (serie.length - 1)) * r.width;
      cur.hidden = false; bulle.hidden = false; cur.style.left = px + 'px';
      var d = new Date(p[0] + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      bulle.innerHTML = '<b>' + prix(p[1]) + '</b> ' + esc(d);
      bulle.style.left = Math.max(4, Math.min(r.width - bulle.offsetWidth - 4, px - bulle.offsetWidth / 2)) + 'px';
    };
    var cacher = function () { cur.hidden = true; bulle.hidden = true; };
    an.addEventListener('mousemove', bouger); an.addEventListener('touchmove', bouger, { passive: true });
    an.addEventListener('mouseleave', cacher); an.addEventListener('touchend', cacher);
  }
  function rendrePerf(p, a) {
    var tuiles = p.perf.map(function (h) {
      return '<div class="v3a-hz-t"><span>' + esc(h.lbl) + '</span><b class="' + (h.v == null ? 'v3a-eq' : sensCl(h.v)) + '">' + signe(h.v, 2) + '</b></div>';
    }).join('');
    var an = p.an, t = p.tendance, vo = p.vol;
    var loinHaut = an.haut ? (p.dernier / an.haut - 1) * 100 : null;
    var tend = function (e, n) {
      if (e == null) return '<li><span>Moyenne ' + n + ' jours</span><b class="v3a-eq">historique trop court</b></li>';
      return '<li><span>Moyenne ' + n + ' jours</span><b class="' + sensCl(e) + '">' + (e >= 0 ? 'au-dessus' : 'en dessous') + ' · ' + signe(e, 1) + '</b></li>';
    };
    var lecture = t.e50 != null && t.e200 != null
      ? (t.e50 >= 0 && t.e200 >= 0 ? 'Tendance haussière : au-dessus de ses moyennes 50 et 200 jours.'
        : t.e50 < 0 && t.e200 < 0 ? 'Tendance baissière : sous ses moyennes 50 et 200 jours.'
          : 'Tendance hésitante : entre ses moyennes 50 et 200 jours.') : '';
    var motVol = vo.rang == null ? '' : vo.rang >= 80 ? 'agitée' : vo.rang >= 50 ? 'plutôt agitée' : vo.rang >= 20 ? 'normale' : 'calme';
    // Le sens de l'année se lit dans le titre, pas sur la courbe (il la masquait sur téléphone).
    var s0 = p.serie && p.serie.length > 1 ? p.serie : null, monte = s0 && s0[s0.length - 1][1] >= s0[0][1];
    return '<div class="v3a-hz">' + tuiles + '</div>'
      + '<div class="v3a-perf-g"><div class="v3a-perf-c"><h5>Sur un an' + (s0 ? ' <span class="' + (monte ? 'v3a-up' : 'v3a-dn') + '">· ' + (monte ? 'en hausse' : 'en baisse') + '</span>' : '') + '</h5>' + courbeAn(p.serie) + '</div><div class="v3a-perf-d">'
      + '<section><h5>Fourchette sur un an</h5><div class="v3a-four"><span>' + prix(an.bas) + '</span><div class="v3a-four-b"><i style="left:' + an.pos + '%"></i></div><span>' + prix(an.haut) + '</span></div>'
      + '<p>' + (an.pos >= 95 ? 'Tout près de son plus haut sur un an.' : an.pos <= 5 ? 'Tout près de son plus bas sur un an.' : 'À ' + an.pos + '% de sa fourchette annuelle, ' + nf(Math.abs(loinHaut || 0), 1) + '% sous son plus haut.') + '</p></section>'
      + '<section><h5>Tendance</h5><ul class="v3a-tend">' + tend(t.e50, 50) + tend(t.e200, 200) + '</ul>' + (lecture ? '<p>' + lecture + '</p>' : '') + '</section>'
      + '<section><h5>Volatilité sur 20 séances</h5>' + (vo.v20 == null ? vide('Historique trop court.')
        : '<div class="v3a-vol"><b>' + nf(vo.v20, 1) + '%</b><span>annualisée · ' + motVol + '</span></div><div class="v3a-rang"><i style="width:' + vo.rang + '%"></i></div>'
        + '<p>Plus élevée que ' + vo.rang + '% des 12 derniers mois.</p>') + '</section>'
      + '</div></div><p class="v3a-src">Cours de clôture au ' + esc(new Date(p.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })) + ' · ' + esc(p.source) + '</p>';
  }
  function motLien(c) { var x = Math.abs(c); return x >= 0.7 ? 'lien fort' : x >= 0.4 ? 'lien net' : x >= 0.2 ? 'lien faible' : 'pas de lien net'; }
  function rendreMoteurs(p, a) {
    if (!p.moteurs || !p.moteurs.length) return vide('Pas assez de séances communes pour mesurer un lien.');
    var lignes = p.moteurs.map(function (m) {
      var c = m.c60, g = c >= 0 ? 50 : 50 + c * 50, w = Math.abs(c) * 50;
      var sens = Math.abs(c) < 0.2 ? '' : c > 0 ? 'dans le même sens' : 'en sens inverse';
      var bouge = Math.abs(m.c20 - m.c60) >= 0.35
        ? '<em class="v3a-mot-chg">' + (Math.sign(m.c20) !== Math.sign(m.c60) && Math.abs(m.c20) >= 0.2 ? 'Lien inversé' : Math.abs(m.c20) > Math.abs(m.c60) ? 'Lien renforcé' : 'Lien affaibli') + ' ces 4 dernières semaines (' + signe(m.c20, 2, '') + ')</em>' : '';
      var reg = Math.abs(c) >= 0.3
        ? '<p class="v3a-mot-reg">' + esc(m.nom) + ' ' + (m.taux ? '+10 pb' : '+1%') + ' → ' + esc(a.nom) + ' <b class="' + sensCl(m.sens) + '">' + signe(m.sens, 2) + '</b> en moyenne</p>' : '';
      return '<div class="v3a-mot-l"><div class="v3a-mot-h"><span class="v3a-mot-n">' + esc(m.nom) + '</span><span class="v3a-mot-q">' + motLien(c) + (sens ? ' · ' + sens : '') + '</span>'
        + '<b class="v3a-mot-v ' + (c >= 0 ? 'pos' : 'neg') + '">' + signe(c, 2, '') + '</b></div>'
        + '<div class="v3a-mot-b"><i class="' + (c >= 0 ? 'pos' : 'neg') + '" style="left:' + g + '%;width:' + w + '%"></i><em></em></div>' + reg + bouge + '</div>';
    }).join('');
    return '<p class="v3a-intro">Avec quoi <b>' + esc(a.nom) + '</b> a bougé sur les 60 dernières séances. Proche de +1 : ils montent et baissent ensemble ; proche de −1 : ils vont en sens inverse.</p>'
      + '<div class="v3a-mot-ax"><span>−1 · sens inverse</span><span>0</span><span>même sens · +1</span></div>' + lignes
      + '<p class="v3a-src">Corrélation des variations quotidiennes, sur les séances communes aux deux marchés · ' + esc(p.source) + '</p>';
  }
  function rendreAgenda(evs, a) {
    var l = agendaFiltre(evs, a, Date.now()), r = agendaRegle(a), drap = typeof CAL_FLAG === 'function' ? CAL_FLAG : function () { return ''; };
    var pour = r.motif ? 'les stocks, l’OPEP et les chiffres forts du dollar' : 'les chiffres à fort impact ' + r.dev.map(function (d) { return d === 'USD' ? 'du dollar' : d === 'EUR' ? 'de la zone euro' : d === 'GBP' ? 'du Royaume-Uni' : d === 'JPY' ? 'du Japon' : 'de la Chine'; }).join(' et ');
    var t = '<p class="v3a-intro">Ce qui peut faire bouger <b>' + esc(a.nom) + '</b> : ' + esc(pour) + ', des dernières 24 heures aux 7 prochains jours.</p>';
    if (!l.length) return t + vide('Aucun rendez-vous de ce type sur la période.');
    var jour = '';
    return t + l.map(function (e) {
      var d = new Date(e.timestamp), j = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      var h = (j !== jour ? '<div class="v3a-ag-j">' + esc(j) + '</div>' : '');
      jour = j;
      var passe = e.timestamp <= Date.now(), imp = String(e.impact || '').toLowerCase();
      return h + '<div class="v3a-ag-l' + (passe ? ' passe' : '') + '"><time>' + esc(d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })) + '</time>'
        + drap(e.currency) + '<span class="v3a-ag-t">' + esc(e.title || '') + '</span>'
        + (passe && e.actual ? '<span class="v3a-ag-v">' + esc(String(e.actual)) + (e.forecast ? ' / ' + esc(String(e.forecast)) : '') + '</span>' : e.forecast ? '<span class="v3a-ag-v">prév. ' + esc(String(e.forecast)) + '</span>' : '')
        + '<em class="v3a-ag-i v3a-ag-i--' + (imp === 'high' ? 'h' : imp === 'medium' ? 'm' : 'l') + '">' + (imp === 'high' ? 'Élevé' : imp === 'medium' ? 'Moyen' : 'Faible') + '</em></div>';
    }).join('');
  }
  function rendreClasse(d, a) {
    var c = d && d.classes && d.classes.filter(function (k) { return k.k === a.cl; })[0];
    var l = c ? c.items.filter(function (x) { return x.ok; }) : [];
    if (!l.length) return vide('Cotations indisponibles pour le moment.');
    l.sort(function (x, y) { return y.chg - x.chg; });
    var mx = Math.max.apply(null, l.map(function (x) { return Math.abs(x.chg); })) || 1;
    var parYf = {}; CATALOGUE.forEach(function (x) { if (x.yf) parYf[x.yf] = x.code; });
    return '<p class="v3a-intro">' + esc(c.n) + ', classés par variation du jour.</p>' + l.map(function (x) {
      var w = Math.abs(x.chg) / mx * 50, code = parYf[x.sym];
      return '<div class="v3a-cl-l' + (x.sym === a.yf ? ' moi' : '') + (code && x.sym !== a.yf ? ' ouvrable' : '') + '"' + (code ? ' data-code="' + esc(code) + '"' : '') + '>'
        + '<span class="v3a-cl-n">' + esc(x.nom) + '</span><span class="v3a-cl-p">' + nf(x.prix, x.dec) + '</span>'
        + '<div class="v3a-cl-b"><i class="' + (x.chg >= 0 ? 'pos' : 'neg') + '" style="' + (x.chg >= 0 ? 'left:50%' : 'left:' + (50 - w) + '%') + ';width:' + w + '%"></i><em></em></div>'
        + '<b class="' + sensCl(x.chg) + '">' + signe(x.chg, 2) + '</b></div>';
    }).join('');
  }

  function fermer() { var o = document.getElementById('v3a-fiche'); if (o) o.remove(); document.removeEventListener('keydown', echap); }
  function echap(e) { if (e.key === 'Escape') fermer(); }
  function ouvrir(code, onglet) {
    var a = CATALOGUE.filter(function (x) { return x.code === code; })[0];
    if (!a) return;
    // L'or et l'argent ont déjà leur vue complète (biais, COT, saisonnalité) : on y va.
    if ((code === 'XAUUSD' || code === 'XAGUSD') && typeof window.openSymbol === 'function') { fermer(); window.openSymbol(code); return; }
    fermer();
    var jeu = ONGLETS[a.cl] || ONGLETS.actions;
    var o = document.createElement('div');
    o.id = 'v3a-fiche'; o.className = 'v3a-fiche';
    o.innerHTML = '<div class="v3a-fiche-fond"></div><article class="v3a-fiche-carte v3a-fiche-carte--' + a.cl + '" role="dialog" aria-label="' + esc(a.nom) + '">'
      + '<header><span class="v3a-fiche-t"><b>' + esc(a.nom) + '</b><small>' + esc(a.code) + '</small><em class="v3a-fiche-cl v3a-fiche-cl--' + a.cl + '">' + esc(nomClasse(a.cl)) + '</em></span>'
      + '<span class="v3a-fiche-cote" aria-live="polite"></span><button type="button" class="v3a-fiche-x" aria-label="Fermer">×</button></header>'
      + '<nav class="v3a-onglets" role="tablist">' + jeu.map(function (t, i) {
        return '<button type="button" role="tab" class="v3a-og' + (i ? '' : ' on') + '" data-og="' + t[0] + '" aria-selected="' + (!i) + '">' + esc(t[1]) + '</button>';
      }).join('') + '</nav>'
      + '<div class="v3a-fiche-corps" data-pane="apercu"><div class="v3a-fiche-graph" id="v3a-fiche-tv"><div class="v3a-fiche-attente">Chargement du graphique…</div></div>'
      + '<aside class="v3a-fiche-fil"><h4>Dans le fil</h4><div class="v3a-fiche-liste"></div></aside></div>'
      + jeu.slice(1).map(function (t) { return '<div class="v3a-pane v3a-pane--' + t[0] + '" data-pane="' + t[0] + '" hidden></div>'; }).join('')
      + '</article>';
    document.body.appendChild(o);
    o.querySelector('.v3a-fiche-fond').onclick = fermer;
    o.querySelector('.v3a-fiche-x').onclick = fermer;
    document.addEventListener('keydown', echap);
    var pane = function (k) { return o.querySelector('[data-pane="' + k + '"]'); };

    // Performance et Moteurs : UNE requête, partie dès l'ouverture (changer d'onglet est instantané).
    var profil = a.yf ? borne('/api/v2/actif-profil?sym=' + encodeURIComponent(a.yf), 25000) : Promise.resolve(null);
    var rendus = {};
    var remplir = {
      perf: function (h) {
        h.innerHTML = attente('Calcul de la performance sur un an…');
        profil.then(function (p) { if (!o.isConnected) return; h.innerHTML = p && p.perf ? rendrePerf(p, a) : vide('Historique indisponible pour le moment.'); survolAn(h); });
      },
      moteurs: function (h) {
        h.innerHTML = attente('Mesure des liens sur 60 séances…');
        profil.then(function (p) { if (!o.isConnected) return; h.innerHTML = p ? rendreMoteurs(p, a) : vide('Historique indisponible pour le moment.'); });
      },
      agenda: function (h) {
        var deja = null; try { deja = typeof _calEvents !== 'undefined' && Array.isArray(_calEvents) && _calEvents.length ? _calEvents : null; } catch (e) {}
        if (deja) { h.innerHTML = rendreAgenda(deja, a); return; }
        h.innerHTML = attente('Lecture du calendrier économique…');
        borne('/api/calendar-events', 15000).then(function (d) { if (!o.isConnected) return; h.innerHTML = d && d.items ? rendreAgenda(d.items, a) : vide('Calendrier indisponible pour le moment.'); });
      },
      classe: function (h) {
        h.innerHTML = attente('Lecture des cotations…');
        lireCotes().then(function (d) {
          if (!o.isConnected) return;
          h.innerHTML = rendreClasse(d, a);
          h.onclick = function (ev) { var l = ev.target.closest('.v3a-cl-l.ouvrable'); if (l) ouvrir(l.getAttribute('data-code'), 'classe'); };
        });
      },
    };
    var choisir = function (k) {
      o.querySelectorAll('.v3a-og').forEach(function (b) {
        var on = b.getAttribute('data-og') === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
        // Sur téléphone la barre défile : l'onglet ouvert reste entier à l'écran.
        if (on) { try { b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
      });
      o.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== k; });
      if (k !== 'apercu' && !rendus[k] && remplir[k]) { rendus[k] = 1; remplir[k](pane(k)); }
    };
    o.querySelector('.v3a-onglets').onclick = function (ev) { var b = ev.target.closest('.v3a-og'); if (b) choisir(b.getAttribute('data-og')); };
    if (onglet && onglet !== 'apercu' && jeu.some(function (t) { return t[0] === onglet; })) choisir(onglet);

    // Dépêches : le même moteur que la recherche du fil (titre affiché, accents, équivalents anglais).
    var liste = o.querySelector('.v3a-fiche-liste'), deps = depeches(a);
    liste.innerHTML = deps.length ? deps.map(function (it) {
      var t = it._titreFr || it.headline || '', h = it.timestamp ? new Date(it.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
      return '<div class="v3a-fiche-dep"><time>' + esc(h) + '</time><span>' + esc(t) + '</span></div>';
    }).join('') : '<p class="v3a-fiche-vide">Aucune dépêche récente sur ' + esc(a.nom) + '.</p>';
    // Cotation du jour : le flux Multi-actifs quand il suit l'actif, sinon la dernière clôture du profil.
    var coteEl = o.querySelector('.v3a-fiche-cote');
    var poser = function (px, chg, taux, d) {
      coteEl.innerHTML = '<b>' + nf(px, d) + (taux ? '%' : '') + '</b><span class="' + sensCl(chg) + '">' + (taux ? signe(chg, 1, ' pb') : signe(chg, 2)) + '</span>';
    };
    lireCotes().then(function (d) {
      if (!o.isConnected) return;
      var x = null; if (d && a.yf) d.classes.forEach(function (c) { c.items.forEach(function (i) { if (i.sym === a.yf) x = i; }); });
      if (x && x.ok) { poser(x.prix, x.chg, x.rendement, x.dec); return; }
      profil.then(function (p) { if (p && o.isConnected && !coteEl.innerHTML) poser(p.dernier, p.perf[0] && p.perf[0].v, false, decDe(p.dernier)); });
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
    // Sous-onglets de la fiche (étape 4) : même grammaire que les onglets du desk, trait or sous l'onglet ouvert.
    + '.v3a-fiche-carte [hidden]{display:none!important}'
    + '.v3a-onglets{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid #16161a;overflow-x:auto;scrollbar-width:none;flex:0 0 auto}.v3a-onglets::-webkit-scrollbar{display:none}'
    + '.v3a-og{position:relative;flex:0 0 auto;border:0;background:none;color:#8e8e98;font:600 12px/1 "Inter Tight",system-ui,sans-serif;padding:11px 10px;cursor:pointer;transition:color .15s}'
    + '.v3a-og:hover{color:#ececf0}.v3a-og.on{color:#e3b23a}.v3a-og.on::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:#e3b23a}'
    + '.v3a-pane{flex:1;min-height:0;overflow-y:auto;padding:14px 16px 18px;animation:v3aPane .18s ease-out}@keyframes v3aPane{from{opacity:0;transform:translateY(4px)}}'
    + '.v3a-pane-attente{display:flex;align-items:center;justify-content:center;gap:5px;height:100%;min-height:160px;color:#6f6f78}.v3a-pane-attente em{font:500 12.5px/1.4 "Inter Tight",system-ui,sans-serif;font-style:normal;margin-left:8px}'
    + '.v3a-pt{width:5px;height:5px;border-radius:50%;background:#6f6f78;animation:v3aPt 1s infinite ease-in-out}.v3a-pt:nth-child(2){animation-delay:.15s}.v3a-pt:nth-child(3){animation-delay:.3s}@keyframes v3aPt{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}'
    + '.v3a-pane-vide{padding:26px 4px;color:#6f6f78;font-size:12.5px;text-align:center}'
    + '.v3a-intro{margin:0 0 12px;color:#a6a6b0;font-size:12.5px;line-height:1.5}.v3a-intro b{color:#ececf0;font-weight:600}'
    + '.v3a-src{margin:14px 0 0;color:#5c5c66;font-size:11px}'
    + '.v3a-pane h5{margin:0 0 8px;font:600 11px/1 "Inter Tight",system-ui,sans-serif;color:#8e8e98;text-transform:uppercase;letter-spacing:.06em}'
    // Performance : horizons, courbe d'un an, fourchette, tendance, volatilité.
    + '.v3a-hz{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin-bottom:14px}'
    + '.v3a-hz-t{border:1px solid #1c1c20;border-radius:6px;padding:9px 8px;display:flex;flex-direction:column;gap:6px;background:#0f0f12;transition:border-color .15s}.v3a-hz-t:hover{border-color:rgba(227,178,58,.45)}'
    + '.v3a-hz-t span{font:500 10.5px/1 "Inter Tight",system-ui,sans-serif;color:#8e8e98;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.v3a-hz-t b{font:600 15px/1 ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}'
    + '.v3a-perf-g{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px}'
    + '.v3a-perf-c{display:flex;flex-direction:column}.v3a-an{position:relative;flex:1;min-height:190px;border:1px solid #16161a;border-radius:6px;background:#0a0a0c;cursor:crosshair;overflow:hidden}.v3a-an svg{position:absolute;inset:0;width:100%;height:100%}'
    + '.v3a-an-max,.v3a-an-min{position:absolute;left:8px;font:500 10.5px/1 ui-monospace,Menlo,monospace;color:#6f6f78;pointer-events:none}.v3a-an-max{top:7px}.v3a-an-min{bottom:7px}.v3a-pane h5 span{text-transform:none;letter-spacing:0}'
    + '.v3a-an-curseur{position:absolute;top:0;bottom:0;width:1px;background:rgba(236,236,240,.35);pointer-events:none}'
    + '.v3a-an-bulle{position:absolute;bottom:22px;padding:5px 8px;border-radius:5px;background:#16161a;border:1px solid #24242a;font:500 11px/1 "Inter Tight",system-ui,sans-serif;color:#a6a6b0;white-space:nowrap;pointer-events:none}.v3a-an-bulle b{color:#f2f2f4;font-family:ui-monospace,Menlo,monospace}'
    + '.v3a-perf-d{display:flex;flex-direction:column;gap:14px}.v3a-perf-d section{border-bottom:1px solid #141417;padding-bottom:12px}.v3a-perf-d section:last-child{border-bottom:0}.v3a-perf-d p{margin:7px 0 0;color:#a6a6b0;font-size:12px;line-height:1.45}'
    + '.v3a-four{display:flex;align-items:center;gap:8px;font:500 11px/1 ui-monospace,Menlo,monospace;color:#8e8e98}.v3a-four-b{position:relative;flex:1;height:6px;border-radius:3px;background:linear-gradient(90deg,rgba(255,61,0,.35),rgba(142,142,152,.25),rgba(0,230,118,.35))}'
    + '.v3a-four-b i{position:absolute;top:50%;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;background:#e3b23a;box-shadow:0 0 0 2px #0c0c0e}'
    + '.v3a-tend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.v3a-tend li{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:#a6a6b0}.v3a-tend b{font:600 12px/1.3 ui-monospace,Menlo,monospace}'
    + '.v3a-vol{display:flex;align-items:baseline;gap:8px}.v3a-vol b{font:600 18px/1 ui-monospace,Menlo,monospace;color:#f2f2f4}.v3a-vol span{font-size:12px;color:#8e8e98}'
    + '.v3a-rang{margin-top:8px;height:4px;border-radius:2px;background:#1c1c20;overflow:hidden}.v3a-rang i{display:block;height:100%;background:#e3b23a;border-radius:2px}'
    // Moteurs : barre divergente autour de zéro, or pour « même sens », bleu pour « sens inverse ».
    + '.v3a-mot-ax{display:flex;justify-content:space-between;margin:0 0 6px;font:500 10px/1 "Inter Tight",system-ui,sans-serif;color:#5c5c66}'
    + '.v3a-mot-l{padding:10px 0;border-bottom:1px solid #141417}.v3a-mot-h{display:flex;align-items:baseline;gap:10px}'
    + '.v3a-mot-n{font:600 13px/1.2 "Inter Tight",system-ui,sans-serif;color:#ececf0}.v3a-mot-q{font-size:11.5px;color:#8e8e98}'
    + '.v3a-mot-v{margin-left:auto;font:600 14px/1 ui-monospace,Menlo,monospace}.v3a-mot-v.pos{color:#e3b23a}.v3a-mot-v.neg{color:#8fb3ff}'
    + '.v3a-mot-b,.v3a-cl-b{position:relative;height:6px;margin-top:8px;border-radius:3px;background:#16161a}.v3a-mot-b i,.v3a-cl-b i{position:absolute;top:0;bottom:0;border-radius:3px;transition:width .4s ease-out}'
    + '.v3a-mot-b em,.v3a-cl-b em{position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:#3a3a42}'
    + '.v3a-mot-b i.pos{background:#e3b23a}.v3a-mot-b i.neg{background:#8fb3ff}'
    + '.v3a-mot-reg{margin:7px 0 0;font-size:12px;color:#a6a6b0}.v3a-mot-reg b{font-family:ui-monospace,Menlo,monospace}'
    + '.v3a-mot-chg{display:block;margin-top:5px;font-size:11.5px;font-style:normal;color:#ffb300}'
    // Agenda : un séparateur par jour, heure en chiffres, impact en badge.
    + '.v3a-ag-j{margin:12px 0 4px;font:600 11px/1 "Inter Tight",system-ui,sans-serif;color:#8e8e98}.v3a-ag-j::first-letter{text-transform:uppercase}'
    + '.v3a-ag-l{display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid #16161a;border-radius:6px;background:rgba(18,18,20,.4);margin-bottom:5px;font-size:12.5px;color:#d6d6dc}.v3a-ag-l.passe{opacity:.62}'
    + '.v3a-ag-l time{flex:0 0 auto;font:500 11.5px/1 ui-monospace,Menlo,monospace;color:#8e8e98}.v3a-ag-l .cal-flag-wrap{flex:0 0 auto;width:16px;height:16px;border-radius:50%;overflow:hidden;display:inline-flex}.v3a-ag-l .cal-flag-img{width:22px;height:22px;object-fit:cover;margin:-3px}'
    + '.v3a-ag-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.v3a-ag-v{flex:0 0 auto;font:500 11.5px/1 ui-monospace,Menlo,monospace;color:#a6a6b0}'
    + '.v3a-ag-i{flex:0 0 auto;font:700 9.5px/1 "Inter Tight",system-ui,sans-serif;font-style:normal;text-transform:uppercase;letter-spacing:.04em;padding:3px 6px;border-radius:4px}'
    + '.v3a-ag-i--h{color:#ff3d00;background:rgba(255,61,0,.12)}.v3a-ag-i--m{color:#ffb300;background:rgba(255,179,0,.12)}.v3a-ag-i--l{color:#8e8e98;background:rgba(142,142,152,.12)}'
    // Sa classe : variation du jour de chaque actif, l'actif ouvert en or, les autres s'ouvrent au clic.
    + '.v3a-cl-l{display:grid;grid-template-columns:minmax(0,1.2fr) 96px minmax(60px,1fr) 70px;align-items:center;gap:12px;padding:8px 8px;border-radius:6px;font-size:12.5px;color:#d6d6dc}'
    + '.v3a-cl-l.ouvrable{cursor:pointer}.v3a-cl-l.ouvrable:hover{background:#121215}.v3a-cl-l.moi{background:rgba(227,178,58,.07);box-shadow:inset 2px 0 0 #e3b23a}.v3a-cl-l.moi .v3a-cl-n{color:#e3b23a}'
    + '.v3a-cl-n{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.v3a-cl-p{font:500 12px/1 ui-monospace,Menlo,monospace;color:#a6a6b0;text-align:right}.v3a-cl-l>b{font:600 12.5px/1 ui-monospace,Menlo,monospace;text-align:right}'
    + '.v3a-cl-b{margin-top:0}.v3a-cl-b i.pos{background:rgba(0,230,118,.75)}.v3a-cl-b i.neg{background:rgba(255,61,0,.75)}'
    + '@media (max-width:820px){.v3a-hz{grid-template-columns:repeat(4,minmax(0,1fr))}.v3a-perf-g{grid-template-columns:1fr}.v3a-cl-l{grid-template-columns:minmax(0,1fr) auto 64px;gap:8px}.v3a-cl-b{display:none}}'
    // Téléphone : le nom tient sur une ligne, le code s'efface (la pastille de classe reste).
    + '@media (max-width:560px){.v3a-fiche-t b{font-size:17px;white-space:nowrap}.v3a-fiche-t small{display:none}.v3a-fiche-carte header{gap:10px;padding:10px 12px}}'
    + '@media (max-width:820px){.v3a-fiche-carte{width:100vw;height:100dvh;border-radius:0}.v3a-fiche-corps{grid-template-columns:1fr;grid-template-rows:minmax(0,1.4fr) minmax(0,1fr)}.v3a-fiche-fil{border-left:0;border-top:1px solid #16161a}}';
  (function styles() { if (document.getElementById('v3a-rech-styles')) return; var st = document.createElement('style'); st.id = 'v3a-rech-styles'; st.textContent = CSS; document.head.appendChild(st); })();

  window.DTPRechercheActifs = { sections: sections, filtrer: filtrer, ouvrir: ouvrir, chercher: chercher, classeDe: classeDe, CATALOGUE: CATALOGUE,
    ONGLETS: ONGLETS, agenda: agendaFiltre };
})();

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   MON DESK — système de widgets composable (DataTradingPro)
   ═══════════════════════════════════════════════════════════════════════════════════════════════
   L'utilisateur choisit ses widgets, les arrange, et retrouve son agencement sur tous ses appareils
   (persistance PAR COMPTE : KV serveur `wdg:<userId>`, endpoints GET/POST /api/widgets).

   ⚠️ FICHIER ISOLÉ (même parti pris que sessionmap.js) : app.js fait 10 000+ lignes et une erreur
   au niveau racine y tue TOUT le fichier (incident déjà vécu sur ce projet). Ici tout est encapsulé
   et gardé → le desk existant ne peut pas tomber à cause de ce module.

   ÉTAPE 1 (livrée derrière le FLAG ADMIN, pour validation en prod réelle sans impact client) :
   catalogue + grille + bibliothèque + persistance. Glisser-déposer libre = étape 2.

   IDENTITÉ : 100 % DTP (or #e3b23a, Fraunces, libellés FR originaux).

   ── API DU DESK RÉELLEMENT UTILISÉES (vérifiées, pas supposées) ──
   · window.activateView          charts.js:2574  (routage ; navbar #topbar-nav = listener DÉLÉGUÉ
                                                   charts.js:2576 → un onglet ajouté après coup marche)
   · buildIsolatedStrength(id,…)  charts.js:931   (async, AUTONOME : fetch ses propres données)
   · buildRiskHistoryChart(id,d)  charts.js:1353  (rend un contrôleur ; données à fournir)
   · disposeRoot(id)              charts.js:54    (cherche le root amCharts PAR ID → id unique requis)
   · CAL_FLAG / calImpDots        charts.js:2922 / 2936
   · window.getNewsMaster()       app.js:475      (GETTER — allItems est réassigné par le WS)
   · window.buildNewsItem(item)   app.js:476      (rendu .news-item officiel, handlers inclus)

   ── PIÈGES TRAITÉS ──
   · amCharts sort en 0×0 si le conteneur est caché → montage APRÈS affichage (requestAnimationFrame).
   · ids amCharts uniques obligatoires (disposeRoot cherche par id) → un id généré par instance.
   · aucun widget du desk n'expose de destroy() → ici chaque mount() rend sa fonction de nettoyage,
     appelée au retrait ET en quittant l'onglet (sinon : roots orphelins + timers à vie = fuite).
   · window._pdIsAdmin est ASYNCHRONE (posé dans le .then() de /api/auth/me) → on l'attend.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STATE = { cfg: null, mounted: [], saveT: null, booted: false };
  var HOST_ID = 'wdg-grid';
  var _reopen = null;                     // idx dont le panneau RÉGLAGES doit rester ouvert après un renderGrid
  var _LMAX = 12;                         // = _WDG_MAX_LAYOUTS côté serveur (plafond de templates)
  var GRID_COLS = 12, ROW_PX = 26;        // vraie grille : 12 colonnes fluides + unité de ligne 26px (snap)
  var _fullscreenIdx = null;              // widget en plein écran (null = aucun)
  var _mountToken = 0;                    // jeton anti-course : seul le rAF du DERNIER renderGrid monte
  function _clamp(v, a, b) { v = v | 0; return v < a ? a : (v > b ? b : v); }
  // Normalise un item vers le NOUVEAU modèle { gw:1-12 colonnes, gh:lignes } et MIGRE l'ancien { h:px, col:1|2 }
  // (col 2 = pleine largeur → gw 12 ; sinon gw 6 ; hauteur px → lignes). Idempotent.
  function _normItem(it) {
    if (!it) return it;
    if (it.gw == null) it.gw = (it.col === 2 ? 12 : 6);
    if (it.gh == null) it.gh = _clamp(Math.round((it.h || 300) / ROW_PX) + 1, 5, 40);
    it.gw = _clamp(it.gw, 1, GRID_COLS); it.gh = _clamp(it.gh, 3, 60);
    return it;
  }
  var _delConfirm = null;                 // id du layout en attente de confirmation de suppression (inline, pas de dialog natif)
  // Icônes d'en-tête — dessins DTP ORIGINAUX (organisation façon desk pro : info + réglages regroupés) :
  // info = « i » cerclé ; réglages = curseurs d'ajustement.
  var ICO = {
    info: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.7" r="0.7" fill="currentColor" stroke="none"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 8h16M4 16h16"/><circle cx="9" cy="8" r="2.3" fill="#0d0e11"/><circle cx="15" cy="16" r="2.3" fill="#0d0e11"/></svg>',
    grip: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-.5 3"/><path d="M20 5v5h-5"/></svg>',
    dup: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5H6.5a2 2 0 0 0-2 2v9" stroke-linecap="round"/></svg>',
    expand: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  // Échappe AUSSI les guillemets : le module injecte des valeurs dans des attributs double-quotés
  // (value="…", title="…") → sans ça, un nom de layout importé piégé (`" onfocus=…`) s'exécuterait (revue 23/07).
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function uid() { return 'w' + Math.random().toString(36).slice(2, 9); }
  function fallback(host, msg) { if (host) host.innerHTML = '<div class="wdg-empty">' + esc(msg) + '</div>'; }

  /* ── COLONNES DU JOURNAL = MIROIR EXACT DU DESK (24/07, demande user « toutes tes colonnes perso »).
     Réplique fidèle de _jrColsFromStore/_jrCell/_jrChip d'app.js (closure inaccessible) → le widget rend
     les MÊMES colonnes que le vrai journal (perso importées ou 21 par défaut), avec les MÊMES cellules
     (chips/rings/progress/badges via les classes GLOBALES jr-chip, jr-cv, jr-ring, jr-prog, jr-pos). */
  var _WJR_DIR_DISP = { BUY: 'Long', SELL: 'Short' };
  var _WJR_COLDEF = [
    { k: 'pair', label: 'Paires', type: 'title', w: 94 }, { k: 'ts', label: 'Date', type: 'date', w: 120 },
    { k: 'result', label: 'Résultat', type: 'select', w: 86 }, { k: 'day', label: 'Jour', type: 'day', w: 100 },
    { k: 'session', label: 'Session', type: 'select', w: 92 }, { k: 'dir', label: 'Direction', type: 'select', w: 92, disp: _WJR_DIR_DISP },
    { k: 'fonda', label: 'Force Fonda', type: 'progress', w: 128, max: 100 }, { k: 'conf', label: 'Confluence', type: 'multi', w: 172 },
    { k: 'tf', label: 'Unité de Temps', type: 'multi', w: 128 }, { k: 'setup', label: 'Setup', type: 'multi', w: 172 },
    { k: 'entryT', label: 'Entrée', type: 'multi', w: 144 }, { k: 'sl', label: 'SL', type: 'multi', w: 124 },
    { k: 'grade', label: 'Note', type: 'ring', w: 74, max: 5 }, { k: 'rr', label: 'Objectif RR', type: 'num', w: 88 },
    { k: 'risk', label: 'Risque %', type: 'num', w: 80, suffix: ' %' }, { k: 'r', label: 'R PNL', type: 'num', w: 80, signed: true },
    { k: 'pnlPct', label: '% PNL', type: 'num', w: 82, suffix: ' %', signed: true }, { k: 'pl', label: '$PNL', type: 'money', w: 106, signed: true },
    { k: 'equity', label: '$ Capital', type: 'money', w: 124 }, { k: 'err', label: 'ERREUR', type: 'multi', w: 132 },
    { k: 'account', label: 'Compte', type: 'select', w: 124 },
  ];
  var _WJR_BUILTIN = {}; _WJR_COLDEF.forEach(function (c) { _WJR_BUILTIN[c.k] = c; });
  var _WJR_CELLTYPES = ['title', 'date', 'day', 'select', 'multi', 'num', 'money', 'progress', 'ring', 'text'];
  var _WJR_CHIPS = [
    { bg: 'rgba(127,179,255,.15)', fg: '#a8ccff', bd: 'rgba(127,179,255,.32)' }, { bg: 'rgba(255,196,120,.15)', fg: '#ffd093', bd: 'rgba(255,196,120,.32)' },
    { bg: 'rgba(120,230,170,.14)', fg: '#8ef0bd', bd: 'rgba(120,230,170,.30)' }, { bg: 'rgba(255,140,180,.15)', fg: '#ffa6c6', bd: 'rgba(255,140,180,.32)' },
    { bg: 'rgba(186,140,255,.15)', fg: '#ccaaff', bd: 'rgba(186,140,255,.32)' }, { bg: 'rgba(255,168,120,.15)', fg: '#ffba93', bd: 'rgba(255,168,120,.32)' },
    { bg: 'rgba(120,224,224,.14)', fg: '#8fe6e6', bd: 'rgba(120,224,224,.30)' }, { bg: 'rgba(206,220,130,.14)', fg: '#dde88f', bd: 'rgba(206,220,130,.30)' },
    { bg: 'rgba(165,170,190,.14)', fg: '#c2c6d6', bd: 'rgba(165,170,190,.30)' },
  ];
  var _WJR_SEMCOL = {
    result: { profit: '#00e676', tp: '#00cc99', be: '#ffb300', sl: '#ff8f00', loss: '#ff3d00' },
    dir: { buy: '#00e676', long: '#00e676', sell: '#ff3d00', short: '#ff3d00' },
    session: { london: '#7fb3ff', 'new york': '#ffb27f', us: '#ffb27f', asia: '#c5a3ff', sydney: '#8fe6e6' },
  };
  var _WJR_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var _WJR_DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  function _wjrHash(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function _wjrHexChip(hex) { var n = hex.replace('#', ''), r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16), lt = function (c) { return Math.round(c + (255 - c) * 0.58); }; return { bg: 'rgba(' + r + ',' + g + ',' + b + ',.19)', fg: 'rgb(' + lt(r) + ',' + lt(g) + ',' + lt(b) + ')', bd: 'rgba(' + r + ',' + g + ',' + b + ',.42)' }; }
  function _wjrChip(colKey, value) { var sem = _WJR_SEMCOL[colKey] && _WJR_SEMCOL[colKey][String(value).toLowerCase()]; return sem ? _wjrHexChip(sem) : _WJR_CHIPS[_wjrHash(colKey + '|' + value) % _WJR_CHIPS.length]; }
  function _wjrChipHtml(text, c) { return '<span class="jr-chip" style="background:' + c.bg + ';color:' + c.fg + ';border-color:' + c.bd + '">' + esc(text) + '</span>'; }
  function _wjrFmtDateFr(ts) { try { var d = new Date(ts); return d.getDate() + ' ' + _WJR_MONTHS[d.getMonth()] + ' ' + d.getFullYear(); } catch (e) { return '—'; } }
  function _wjrDayEn(ts) { try { return _WJR_DAYS[new Date(ts).getDay()]; } catch (e) { return ''; } }
  function _wjrFmtNum(v, signed) { if (v == null || v === '') return ''; var n = Number(v); if (!isFinite(n)) return esc(String(v)); var s = (Math.round(n * 100) / 100).toString().replace('.', ','); return (signed && n > 0 ? '+' : '') + s; }
  function _wjrRingHtml(val, max) { var f = Math.max(0, Math.min(1, val / (max || 5))), R = 8.5, C = 2 * Math.PI * R, c = f >= 0.8 ? '#00e676' : f >= 0.5 ? '#ffb300' : '#e3b23a'; return '<span class="jr-ring"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="' + R + '" fill="none" stroke="#26262c" stroke-width="2.6"/><circle cx="12" cy="12" r="' + R + '" fill="none" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="' + (f * C).toFixed(2) + ' ' + C.toFixed(2) + '" transform="rotate(-90 12 12)"/></svg><b>' + _wjrFmtNum(val) + '</b></span>'; }
  function _wjrGet(e, col) { return col.builtin ? e[col.k] : (e.props && e.props[col.k]); }
  function _wjrColsFromStore(stored) {
    if (!Array.isArray(stored) || !stored.length) return _WJR_COLDEF.map(function (c) { return Object.assign({}, c, { builtin: true, hidden: false }); });
    var seen = {}, cols = [];
    stored.forEach(function (s) {
      var k = String((s && s.k) || '').slice(0, 32); if (!k || seen[k]) return; seen[k] = 1;
      if (s.builtin !== false && _WJR_BUILTIN[k]) cols.push(Object.assign({}, _WJR_BUILTIN[k], { builtin: true, label: String(s.label || _WJR_BUILTIN[k].label).slice(0, 40), hidden: !!s.hidden }));
      else { var type = _WJR_CELLTYPES.indexOf(s.type) >= 0 ? s.type : 'text'; cols.push({ k: k, label: String(s.label || k).slice(0, 40), type: type, builtin: false, hidden: !!s.hidden, w: Math.max(70, Math.min(280, (+s.w) || 130)) }); }
    });
    if (!cols.some(function (c) { return c.k === 'pair'; })) cols.unshift(Object.assign({}, _WJR_BUILTIN.pair, { builtin: true, hidden: false }));
    return cols;
  }
  function _wjrCell(e, col) {
    var v = _wjrGet(e, col);
    switch (col.type) {
      case 'title': return '<span class="jr-cv-title">' + (e.pair ? esc(e.pair) : '<i class="jr-ph">—</i>') + '</span>';
      case 'text': return (v == null || v === '') ? '<i class="jr-ph">—</i>' : '<span class="jr-cv-text">' + esc(v) + '</span>';
      case 'date': { var ts = col.builtin ? e.ts : v; return ts ? '<span class="jr-cv-date">' + _wjrFmtDateFr(ts) + '</span>' : '<i class="jr-ph">—</i>'; }
      case 'day': { var d = e.ts ? _wjrDayEn(e.ts) : ''; return d ? _wjrChipHtml(d, _WJR_CHIPS[8]) : '<i class="jr-ph">—</i>'; }
      case 'select': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; return _wjrChipHtml((col.disp && col.disp[v]) || v, _wjrChip(col.k, v)); }
      case 'multi': { var arr = Array.isArray(v) ? v : (v ? [v] : []); return arr.length ? arr.map(function (x) { return _wjrChipHtml(x, _wjrChip(col.k, x)); }).join('') : '<i class="jr-ph">—</i>'; }
      case 'num': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; var n = Number(v), cls = col.signed ? (n > 0 ? 'jr-pos' : n < 0 ? 'jr-neg' : '') : ''; return '<span class="jr-cv-num ' + cls + '">' + _wjrFmtNum(v, col.signed) + (col.suffix || '') + '</span>'; }
      case 'money': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; var n2 = Number(v), cls2 = col.signed ? (n2 > 0 ? 'jr-pos' : n2 < 0 ? 'jr-neg' : '') : ''; return '<span class="jr-cv-num ' + cls2 + '">' + (col.signed && n2 > 0 ? '+' : '') + n2.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' $</span>'; }
      case 'progress': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; var pct = Math.max(0, Math.min(100, Number(v) / (col.max || 100) * 100)), bc = pct >= 87.5 ? '#00e676' : pct >= 62.5 ? '#ffb300' : '#e3b23a'; return '<div class="jr-prog"><div class="jr-prog-t"><i style="width:' + pct + '%;background:' + bc + '"></i></div><span class="jr-prog-l">' + _wjrFmtNum(v) + ' %</span></div>'; }
      case 'ring': return (v == null || v === '') ? '<i class="jr-ph">—</i>' : _wjrRingHtml(Number(v), col.max || 5);
    }
    return '';
  }

  /* ── CATALOGUE ─────────────────────────────────────────────────────────────────────────────────
     mount(host) reçoit un conteneur VIDE et VISIBLE ; il renvoie sa fonction de nettoyage.
     RÈGLE : un widget ne doit JAMAIS écrire un id DOM en dur — il peut vivre en 2 exemplaires. */
  var CATALOG = [
    {
      id: 'force-devises', name: 'Force des Devises', cat: 'Devises', h: 300,
      desc: 'Qui mène, qui décroche, sur la semaine.',
      mount: function (host) {
        var id = HOST_ID + '-fx-' + uid();
        host.innerHTML = '<div id="' + id + '" style="width:100%;height:100%;"></div>';
        if (typeof buildIsolatedStrength !== 'function') { fallback(host, 'Force des Devises indisponible.'); return null; }
        try { buildIsolatedStrength(id, null, 'week'); } catch (e) { fallback(host, 'Force des Devises indisponible.'); }
        return function () { try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {} };
      },
    },
    {
      id: 'barometre', name: 'Baromètre des Devises', cat: 'Devises', h: 300,
      desc: 'La force des 8 majeures en égaliseur bidirectionnel (le vrai baromètre du desk).',
      // Réutilise buildMeterChart du desk (HTML pur, classes .meter-*). Son timer interne s'auto-termine
      // hors de l'onglet METER (garde #rtab-meter) → snapshot rafraîchi à chaque réouverture, zéro fuite.
      mount: function (host) {
        var id = HOST_ID + '-mt-' + uid();
        host.innerHTML = '<div id="' + id + '" style="height:100%;"></div>';
        if (typeof buildMeterChart !== 'function') { fallback(host, 'Baromètre indisponible.'); return null; }
        try { buildMeterChart(id); } catch (e) { fallback(host, 'Baromètre indisponible.'); }
        return null;
      },
    },
    // (« Classement des Devises » RETIRÉ du catalogue le 23/07, demande user — les configs qui le
    //  contiennent encore sont ignorées proprement par renderGrid : byId() → null → carte sautée.)
    {
      id: 'risque-historique', name: 'Historique du Sentiment', cat: 'Risque', h: 260,
      desc: "L'appétit pour le risque des 60 derniers jours.",
      mount: function (host) {
        var id = HOST_ID + '-rh-' + uid();
        host.innerHTML = '<div id="' + id + '" style="width:100%;height:100%;"></div>';
        if (typeof buildRiskHistoryChart !== 'function') { fallback(host, 'Historique indisponible.'); return null; }
        fetch('/api/risk-history?days=60').then(function (r) { return r.json(); }).then(function (d) {
          if (!document.getElementById(id)) return;                        // widget retiré pendant le fetch
          try { buildRiskHistoryChart(id, d); } catch (e) { fallback(host, 'Historique indisponible.'); }
        }).catch(function () { fallback(host, 'Historique indisponible.'); });
        return function () { try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {} };
      },
    },
    {
      id: 'calendrier-jour', name: 'Calendrier économique', cat: 'Macro', h: 300,
      desc: 'Les prochaines publications, heure de Paris.',
      // IDENTIQUE AU DESK : on reproduit la table du calendrier du desk (renderCalTable, charts.js:2995)
      // — mêmes classes `cal-table`/`cth-*`, séparateurs de jour, 10 colonnes, états de ligne — et on
      // appelle SES helpers globaux (calFormatTime, CAL_FLAG, calImpDots, calActualCell). Le widget
      // hérite ainsi du style exact du desk. Lecture seule (le déroulé inline reste dans l'onglet dédié).
      mount: function (host) {
        host.innerHTML = '<div class="wdg-cal-wrap custom-scrollbar"><div class="wdg-load">Chargement…</div></div>';
        fetch('/api/calendar-events').then(function (r) { return r.json(); }).then(function (j) {
          if (!host.isConnected) return;
          var now = Date.now();
          var evs = ((j && j.items) || [])
            .filter(function (e) { return e && (e.timestamp || 0) > now - 2 * 3600e3; })
            .sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); })
            .slice(0, 40);
          if (!evs.length) return fallback(host, 'Aucun événement à venir.');
          var nextIdx = evs.findIndex(function (e) { return (e.timestamp || 0) >= now; });
          var fmtTime = (typeof calFormatTime === 'function') ? calFormatTime : function () { return ''; };
          var flag = (typeof CAL_FLAG === 'function') ? CAL_FLAG : function () { return ''; };
          var dots = (typeof calImpDots === 'function') ? calImpDots : function () { return ''; };
          var actCell = (typeof calActualCell === 'function') ? calActualCell : function () { return ''; };
          var vspan = function (raw, cls) { return raw && raw !== '' ? '<span class="' + cls + '">' + esc(raw) + '</span>' : '<span class="cv-empty">—</span>'; };
          var tbody = '', lastDay = '';
          evs.forEach(function (ev, i) {
            var dayKey = ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('en-GB') : '';
            if (dayKey && dayKey !== lastDay) {
              var d = new Date(ev.timestamp);
              var wd = d.toLocaleDateString('fr-FR', { weekday: 'long' });
              var ds = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
              tbody += '<tr class="cal-day-sep"><td colspan="10">' + esc(wd) + ', ' + ds + '</td></tr>';
              lastDay = dayKey;
            }
            var imp = (ev.impact || '').toLowerCase();
            var cls = 'cal-row';
            if (i === nextIdx) cls += ' cal-row--next';
            if ((ev.timestamp || 0) < now) cls += ' cal-row--past';
            if (imp === 'high') cls += ' cal-row--high'; else if (imp === 'medium') cls += ' cal-row--med';
            tbody += '<tr class="' + cls + '">'
              + '<td class="cth-time">' + (esc(fmtTime(ev.timestamp)) || esc(ev.time) || '—') + '</td>'
              + '<td class="cth-flag">' + flag(ev.currency) + '</td>'
              + '<td class="cth-curr">' + esc(ev.currency || '') + '</td>'
              + '<td class="cth-imp">' + dots(ev.impact) + '</td>'
              + '<td class="cth-event">' + esc(ev.title || '') + '</td>'
              + '<td class="cth-val">' + actCell(ev.actual, ev.forecast, ev.low, ev.title) + '</td>'
              + '<td class="cth-val">' + vspan(ev.high, 'cv-forecast') + '</td>'
              + '<td class="cth-val">' + vspan(ev.forecast, 'cv-forecast') + '</td>'
              + '<td class="cth-val">' + vspan(ev.low, 'cv-prev') + '</td>'
              + '<td class="cth-val">' + vspan(ev.previous, 'cv-prev') + '</td></tr>';
          });
          host.innerHTML = '<div class="wdg-cal-wrap custom-scrollbar"><table class="cal-table">'
            + '<thead><tr><th class="cth-time">Heure</th><th class="cth-flag">CNTRY</th><th class="cth-curr">CURR.</th>'
            + '<th class="cth-imp">IMPACT</th><th class="cth-event">ÉVÉNEMENT</th><th class="cth-val">RÉEL</th>'
            + '<th class="cth-val">HIGH</th><th class="cth-val">PRÉVISION</th><th class="cth-val">LOW</th>'
            + '<th class="cth-val">PRÉCÉDENT</th></tr></thead><tbody>' + tbody + '</tbody></table></div>';
        }).catch(function () { fallback(host, 'Calendrier indisponible.'); });
        return null;
      },
    },
    {
      id: 'radar-biais', name: 'Radar de Biais', cat: 'Macro', h: 320,
      desc: 'Le biais net de chaque devise, du plus haussier au plus baissier.',
      // AUTONOME : lit /api/smart-bias (auth-gaté, cookie desk) et rend une synthèse compacte HTML — biais net
      // (conclusion, la source de vérité du desk) coloré selon la charte sémantique DTP + les 4 piliers en FR.
      // Aucun état partagé, aucun root amCharts → cleanup null.
      mount: function (host) {
        host.innerHTML = '<div class="wdg-load">Chargement du biais…</div>';
        var COL = {
          'Very Bullish': 'vb', 'Bullish': 'b', 'Weak Bullish': 'wb', 'Neutral': 'n',
          'Weak Bearish': 'wr', 'Bearish': 'r', 'Very Bearish': 'vr',
        };
        var LBL = {
          'Very Bullish': 'Très haussier', 'Bullish': 'Haussier', 'Weak Bullish': 'Faible hausse',
          'Neutral': 'Neutre', 'Weak Bearish': 'Faible baisse', 'Bearish': 'Baissier', 'Very Bearish': 'Très baissier',
        };
        var RANK = { 'Very Bullish': 3, 'Bullish': 2, 'Weak Bullish': 1, 'Neutral': 0, 'Weak Bearish': -1, 'Bearish': -2, 'Very Bearish': -3 };
        var LVL = { High: 'Élevée', Moderate: 'Modérée', Low: 'Basse' };
        var GE  = { Strong: 'Solide', Weak: 'Faible', Neutral: 'Neutre' };
        var DIR = { Hike: 'Hausse', Cut: 'Baisse', Hold: 'Maintien' };
        var flag = (typeof CAL_FLAG === 'function') ? CAL_FLAG : function () { return ''; };
        fetch('/api/smart-bias').then(function (r) { return r.json(); }).then(function (d) {
          if (!host.isConnected) return;
          var curr = d && d.currencies, concl = (d && d.conclusion) || {}, mt = (d && d.macroTable) || {};
          if (!curr || !curr.length) return fallback(host, 'Biais indisponible.');
          var ordered = curr.slice().sort(function (a, b) { return (RANK[concl[b]] || 0) - (RANK[concl[a]] || 0); });
          var rows = ordered.map(function (c) {
            var bias = concl[c] || 'Neutral';
            var m = mt[c] || {};
            var sub = [];
            if (m.monetary && m.monetary.stance) sub.push('Monét. ' + esc(m.monetary.stance));
            if (m.inflation && m.inflation.level) sub.push('Infl. ' + (LVL[m.inflation.level] || m.inflation.level));
            if (m.growth) sub.push('Crois. ' + (GE[m.growth] || m.growth));
            if (m.employment) sub.push('Empl. ' + (GE[m.employment] || m.employment));
            return '<div class="wdg-bias-row">'
              + '<span class="wdg-bias-cur">' + flag(c) + '<b>' + esc(c) + '</b></span>'
              + '<span class="wdg-bias-tag wdg-bias-' + (COL[bias] || 'n') + '">' + esc(LBL[bias] || bias) + '</span>'
              + '<span class="wdg-bias-sub">' + sub.join(' · ') + '</span></div>';
          }).join('');
          host.innerHTML = '<div class="wdg-bias custom-scrollbar">' + rows + '</div>';
        }).catch(function () { fallback(host, 'Biais indisponible.'); });
        return null;
      },
    },
    {
      id: 'taux-cb', name: 'Taux directeurs', cat: 'Macro', h: 320,
      desc: 'Où en sont les banques centrales : taux actuel + prochaine décision anticipée.',
      // AUTONOME : lit /api/rates (probabilités marché). Rend une carte par banque : taux actuel, scénario de base
      // (Maintien/Hausse/Baisse) de la prochaine réunion + probabilité + date. HTML pur, cleanup null.
      mount: function (host) {
        host.innerHTML = '<div class="wdg-load">Chargement des taux…</div>';
        var MV = { Hike: { c: 'up', t: 'Hausse' }, Cut: { c: 'down', t: 'Baisse' }, Hold: { c: 'flat', t: 'Maintien' } };
        var flag = (typeof CAL_FLAG === 'function') ? CAL_FLAG : function () { return ''; };
        var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
        var fmtD = function (iso) { try { var p = String(iso).split('-'); return parseInt(p[2], 10) + ' ' + MOIS[parseInt(p[1], 10) - 1]; } catch (e) { return esc(iso); } };
        fetch('/api/rates').then(function (r) { return r.json(); }).then(function (d) {
          if (!host.isConnected) return;
          var banks = (d && d.banks) || [];
          if (!banks.length) return fallback(host, 'Taux indisponibles.');
          var rows = banks.map(function (b) {
            var sc = b.scenario || {};
            // Scénario de base = celui de plus forte probabilité pour la PROCHAINE réunion.
            var cands = [['Hold', sc.hold], ['Hike', sc.hike], ['Cut', sc.cut]].filter(function (x) { return x[1] != null; });
            cands.sort(function (a, b2) { return (b2[1] || 0) - (a[1] || 0); });
            var base = cands[0] ? cands[0][0] : (b.move || 'Hold');
            var prob = cands[0] ? Math.round(cands[0][1]) : null;
            var mv = MV[base] || MV.Hold;
            var when = b.next ? fmtD(b.next) + (b.nextDays != null ? ' · ' + (b.nextDays <= 0 ? "aujourd'hui" : b.nextDays + ' j') : '') : '';
            return '<div class="wdg-taux-row">'
              + '<span class="wdg-taux-bank">' + flag(b.code) + '<b>' + esc(b.bank || b.code) + '</b></span>'
              + '<span class="wdg-taux-rate">' + (b.rate != null ? esc(String(b.rate).replace('.', ',')) + ' %' : '—') + '</span>'
              + '<span class="wdg-taux-move wdg-taux-' + mv.c + '">' + mv.t + (prob != null ? ' ' + prob + ' %' : '') + '</span>'
              + '<span class="wdg-taux-when">' + when + '</span></div>';
          }).join('');
          host.innerHTML = '<div class="wdg-taux custom-scrollbar">'
            + '<div class="wdg-taux-head"><span>Banque</span><span>Taux</span><span>Prochaine décision</span><span class="r">Réunion</span></div>'
            + rows + '</div>';
        }).catch(function () { fallback(host, 'Taux indisponibles.'); });
        return null;
      },
    },
    {
      id: 'risque-jauge', name: 'Sentiment de Risque', cat: 'Risque', h: 300,
      desc: "L'appétit / l'aversion du marché en direct (risk-on / risk-off).",
      // IDENTIQUE AU DESK (23/07) : réplique instance-scopée de buildRiskGauge (charts.js) — mêmes classes
      // (.risk-ticker / .risk-gauge-stage / .risk-readout), même arc am5radar (dégradé 7 stops), même
      // triangle ClockHand teinté _riskArcColor, mêmes helpers globaux (_riskBandInner, GAUGE_LABEL_FR).
      // Root amCharts PAR INSTANCE (le singleton _riskGaugeRoot reste au desk) + suit le snapshot partagé
      // dtp-risk (source unique app.js) → toujours la même valeur que la jauge de l'onglet RISQUE.
      mount: function (host) {
        if (!(window.am5 && window.am5radar) || typeof _riskArcColor !== 'function' || typeof _riskBandInner !== 'function' || typeof GAUGE_LABEL_FR === 'undefined') { fallback(host, 'Jauge indisponible.'); return null; }
        host.innerHTML = '<div class="risk-widget-container wdg-riskwrap"></div>';
        var wrap = host.firstChild;
        var root = null, handDI = null, hand = null, built = false;
        function render(data) {
          if (!host.isConnected || !data || data.error) return;
          try {
            var frLabel = GAUGE_LABEL_FR[data.label] || data.label;
            var isOn = /risk-on/i.test(data.label), isOff = /risk-off/i.test(data.label);
            var cls = isOn ? 'risk-on' : isOff ? 'risk-off' : 'neutral';
            var gaugeVal = Math.max(-100, Math.min(100, +((typeof data.pct === 'number' ? data.pct : (data.score || 0) * 50)).toFixed(1)));
            if (!built) {
              built = true;
              wrap.innerHTML = '<div class="risk-ticker ' + cls + '">' + _riskBandInner(data) + '</div>'
                + '<div class="risk-gauge-stage"><div class="wdg-riskgauge"></div>'
                + '<div class="risk-readout"><div class="risk-readout-badge ' + cls + '"></div></div></div>';
              wrap.querySelector('.risk-readout-badge').textContent = frLabel;
              root = am5.Root.new(wrap.querySelector('.wdg-riskgauge'));
              root.setThemes(typeof applyTerminalTheme === 'function' ? [am5themes_Animated.new(root), applyTerminalTheme(root)] : [am5themes_Animated.new(root)]);
              if (root._logo) root._logo.set('forceHidden', true);
              var chart = root.container.children.push(am5radar.RadarChart.new(root, {
                panX: false, panY: false, startAngle: -180, endAngle: 0,
                radius: am5.percent(86), innerRadius: am5.percent(78),
                paddingTop: 12, paddingBottom: 26, paddingLeft: 28, paddingRight: 28,
              }));
              var axisRenderer = am5radar.AxisRendererCircular.new(root, { strokeOpacity: 0 });
              axisRenderer.labels.template.setAll({ visible: false });
              axisRenderer.ticks.template.setAll({ visible: false });
              axisRenderer.grid.template.setAll({ visible: false });
              var axis = chart.xAxes.push(am5xy.ValueAxis.new(root, { min: -100, max: 100, strictMinMax: true, renderer: axisRenderer }));
              var arc = axis.createAxisRange(axis.makeDataItem({ value: -100, endValue: 100 }));
              arc.get('axisFill').setAll({
                visible: true, fillOpacity: 1, strokeOpacity: 0, fill: am5.color(0xddb23a),
                fillGradient: am5.LinearGradient.new(root, { rotation: 0, stops: [
                  { color: am5.color(0xc63430) }, { color: am5.color(0xdb5a2c) }, { color: am5.color(0xe88a28) },
                  { color: am5.color(0xddb23a) }, { color: am5.color(0xa9c64a) }, { color: am5.color(0x5cb060) }, { color: am5.color(0x2a9e60) },
                ] }),
              });
              if (arc.get('grid')) arc.get('grid').setAll({ visible: false });
              if (arc.get('tick')) arc.get('tick').setAll({ visible: false });
              if (arc.get('label')) arc.get('label').setAll({ visible: false });
              handDI = axis.makeDataItem({ value: 0 });
              hand = am5radar.ClockHand.new(root, { pinRadius: 0, radius: am5.percent(64), innerRadius: am5.percent(43), bottomWidth: 26, topWidth: 0 });
              hand.pin.setAll({ forceHidden: true });
              hand.hand.setAll({ fill: am5.color(_riskArcColor(gaugeVal)), fillOpacity: 0.95, strokeOpacity: 0 });
              handDI.set('bullet', am5xy.AxisBullet.new(root, { sprite: hand }));
              axis.createAxisRange(handDI);
              if (handDI.get('grid')) handDI.get('grid').setAll({ visible: false });
              handDI.animate({ key: 'value', to: gaugeVal, duration: 1000, easing: am5.ease.out(am5.ease.cubic) });
            } else {
              if (handDI) handDI.animate({ key: 'value', to: gaugeVal, duration: 800, easing: am5.ease.out(am5.ease.cubic) });
              if (hand) hand.hand.set('fill', am5.color(_riskArcColor(gaugeVal)));
              var badgeUp = wrap.querySelector('.risk-readout-badge');
              if (badgeUp) { badgeUp.textContent = frLabel; badgeUp.className = 'risk-readout-badge ' + cls; }
              var tickUp = wrap.querySelector('.risk-ticker');
              if (tickUp) { tickUp.className = 'risk-ticker ' + cls; tickUp.innerHTML = _riskBandInner(data); }
            }
            // Badge + bande d'état teintés par la couleur d'arc COURANTE (même logique que le desk)
            var arcHex = '#' + _riskArcColor(gaugeVal).toString(16).padStart(6, '0');
            var badge = wrap.querySelector('.risk-readout-badge');
            if (badge) { badge.style.color = arcHex; badge.style.borderColor = arcHex; }
            var ticker = wrap.querySelector('.risk-ticker');
            if (ticker) {
              ticker.style.color = 'color-mix(in oklab, ' + arcHex + ' 52%, #c7cacc)';
              ticker.style.background = 'color-mix(in oklab, ' + arcHex + ' 13%, #0c0e13)';
              ticker.style.borderColor = 'color-mix(in oklab, ' + arcHex + ' 30%, transparent)';
              var dt = ticker.querySelector('.risk-ticker-dot'); if (dt) dt.style.background = arcHex;
              var st = ticker.querySelector('strong'); if (st) st.style.color = arcHex;
            }
          } catch (e) { if (!built) fallback(host, 'Jauge indisponible.'); }
        }
        function onRisk(e) { render(e && e.detail); }
        window.addEventListener('dtp-risk', onRisk);
        if (window._dtpRisk) render(window._dtpRisk);
        else fetch('/api/risk-sentiment').then(function (r) { return r.json(); }).then(function (d) { if (!d || d.error) return fallback(host, 'Sentiment indisponible.'); window._dtpRisk = window._dtpRisk || d; render(window._dtpRisk); }).catch(function () { fallback(host, 'Sentiment indisponible.'); });
        return function () { window.removeEventListener('dtp-risk', onRisk); try { if (root) root.dispose(); } catch (e) {} };
      },
    },
    {
      id: 'cot-inst', name: 'Positionnement COT', cat: 'Risque', h: 340,
      desc: 'Le positionnement net des institutionnels (CFTC), par devise.',
      // IDENTIQUE AU DESK (23/07) : réutilise buildCOTChart(gridId, type) de charts.js (rendu rétrocompatible)
      // → mêmes cartes donut SVG .cot-cell, mêmes 5 catégories CFTC (barre .cot-type-bar reproduite, handlers
      // SCOPÉS au widget — ceux du desk sont scopés #rtab-cot). Zéro root amCharts → cleanup null.
      mount: function (host) {
        if (typeof buildCOTChart !== 'function') { fallback(host, 'COT indisponible.'); return null; }
        var gid = HOST_ID + '-cotg-' + uid();
        var TYPES = [['noncomm', 'Non-comm.'], ['dealer', 'Teneur'], ['asset_mgr', 'Gérant'], ['lev_money', 'Effet de levier'], ['other_rept', 'Autre']];
        host.innerHTML = '<div class="wdg-cotwrap">'
          + '<div class="cot-type-bar">' + TYPES.map(function (t) {
              return '<button class="cot-type-btn' + (t[0] === 'lev_money' ? ' cot-type-btn--active' : '') + '" data-cot-type="' + t[0] + '">' + t[1] + '</button>';
            }).join('') + '</div>'
          + '<div id="' + gid + '" class="cot-grid custom-scrollbar"></div></div>';
        try { buildCOTChart(gid, 'lev_money'); } catch (e) { fallback(host, 'COT indisponible.'); return null; }
        host.querySelectorAll('.cot-type-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            host.querySelectorAll('.cot-type-btn').forEach(function (b) { b.classList.remove('cot-type-btn--active'); });
            btn.classList.add('cot-type-btn--active');
            try { buildCOTChart(gid, btn.dataset.cotType); } catch (e) {}
          });
        });
        return null;
      },
    },
    {
      id: 'dmx-retail', name: 'Aperçu DMX', cat: 'Risque', h: 340,
      desc: 'Le positionnement long/short de la foule (contrarian), par paire.',
      // IDENTIQUE AU DESK (23/07) : réutilise buildDMXChart(force, {wrapId, period, sort}) de charts.js
      // → mêmes barres .dmx2-row, même en-tête (boutons TF 1D/4H/1H + tri) et même légende Long/Short.
      // Le widget gère SON intervalle 60 s (le _dmxTimer du desk reste gaté sur #rtab-dmx) → cleanup.
      mount: function (host) {
        if (typeof buildDMXChart !== 'function') { fallback(host, 'DMX indisponible.'); return null; }
        var wid = HOST_ID + '-dmxw-' + uid();
        host.innerHTML = '<div class="wdg-dmxwrap">'
          + '<div class="dmx-header-bar">'
          + '<div class="dmx-tf-group"><button class="dmx-tf-btn" data-tf="D1">1D</button><button class="dmx-tf-btn" data-tf="H4">4H</button><button class="dmx-tf-btn dmx-tf-btn--active" data-tf="H1">1H</button></div>'
          + '<span style="flex:1"></span>'
          + '<select class="dmx-sort-select"><option value="az">Paire (A-Z)</option><option value="long">Long ↓</option><option value="short">Short ↓</option></select>'
          + '</div>'
          + '<div class="dmx-legend-bar"><span class="dmx-legend-dot dmx-legend-long-dot"></span><span class="dmx-legend-text">Long</span><span class="dmx-legend-dot dmx-legend-short-dot"></span><span class="dmx-legend-text">Short</span></div>'
          + '<div id="' + wid + '" class="dmx-table-wrap custom-scrollbar"></div></div>';
        function optsNow() {
          var tf = host.querySelector('.dmx-tf-btn--active');
          var sel = host.querySelector('.dmx-sort-select');
          return { wrapId: wid, period: tf ? tf.dataset.tf : 'H1', sort: sel ? sel.value : 'az' };
        }
        function refresh(force) { try { buildDMXChart(!!force, optsNow()); } catch (e) {} }
        refresh(false);
        host.querySelectorAll('.dmx-tf-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            host.querySelectorAll('.dmx-tf-btn').forEach(function (b) { b.classList.remove('dmx-tf-btn--active'); });
            btn.classList.add('dmx-tf-btn--active');
            refresh(true);
          });
        });
        var sel = host.querySelector('.dmx-sort-select');
        if (sel) sel.addEventListener('change', function () { refresh(false); });
        var iv = setInterval(function () { if (!host.isConnected) { clearInterval(iv); return; } refresh(false); }, 60000);
        return function () { clearInterval(iv); };
      },
    },
    {
      id: 'saison', name: 'Saisonnalité', cat: 'Macro', h: 300,
      desc: "La table de performance mensuelle par année (rendements × 5 ans).",
      // IDENTIQUE AU DESK (23/07) : même table heatmap .season-table (cellules rendues par le MÊME
      // _seasonCell global de charts.js — vert/rouge ∝ |valeur|, flèches, colonne Moy.), même badge
      // [PAIRE] ; paire du COMPTE (/api/season-pair, GET au montage + POST au changement, comme le desk).
      mount: function (host) {
        if (typeof _seasonCell !== 'function') { fallback(host, 'Saisonnalité indisponible.'); return null; }
        var fmt = (typeof _seasonFmtPair === 'function') ? _seasonFmtPair : function (c) { return c; };
        var pairs = (typeof _SEASON_PAIRS !== 'undefined') ? _SEASON_PAIRS.slice() : ['EURUSD'];
        host.innerHTML = '<div class="wdg-seawrap">'
          + '<div class="dmx-header-bar"><span class="season-pair-badge wdg-sea-badge">[EUR/USD]</span><span style="flex:1"></span>'
          + '<select class="dmx-sort-select wdg-sea-sel">' + pairs.sort(function (a, b) { return fmt(a).localeCompare(fmt(b), 'fr', { numeric: true, sensitivity: 'base' }); }).map(function (p) { return '<option value="' + esc(p) + '">' + esc(fmt(p)) + '</option>'; }).join('') + '</select></div>'
          + '<div class="season-table-wrap custom-scrollbar wdg-sea-tbl"><div class="wdg-load">Chargement…</div></div>';
        var sel = host.querySelector('.wdg-sea-sel'), badge = host.querySelector('.wdg-sea-badge'), tblWrap = host.querySelector('.wdg-sea-tbl');
        var cur = null;
        function load(p) {
          cur = p;
          if (sel && !sel.querySelector('option[value="' + p.replace(/"/g, '') + '"]')) {   // paire du compte hors liste FX (catalogue Stocks/Indices…)
            var op = document.createElement('option'); op.value = p; op.textContent = fmt(p); sel.insertBefore(op, sel.firstChild);
          }
          if (sel) sel.value = p;
          if (badge) badge.textContent = '[' + fmt(p) + ']';
          fetch('/api/seasonality?symbol=' + encodeURIComponent(p)).then(function (r) { return r.json(); }).then(function (data) {
            if (!host.isConnected || p !== cur) return;                    // réponse périmée (changement de paire)
            if (!data || !Array.isArray(data.rows) || !data.rows.length) return fallback(tblWrap, 'Aucune donnée');
            if (badge && data.symbol) badge.textContent = '[' + data.symbol + ']';
            var yrs = data.years || [];
            var head = '<tr><th class="season-th season-th--m"></th>' + yrs.map(function (y) { return '<th class="season-th">\'' + String(y).slice(2) + '</th>'; }).join('') + '<th class="season-th season-th--avg">Moy.</th></tr>';
            var body = data.rows.map(function (row) {
              return '<tr><td class="season-month">' + esc(row.month) + '</td>' + (row.vals || []).map(function (v) { return _seasonCell(v, false); }).join('') + _seasonCell(row.avg, true) + '</tr>';
            }).join('');
            tblWrap.innerHTML = '<table class="season-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
          }).catch(function () { if (host.isConnected && p === cur) fallback(tblWrap, 'Saisonnalité indisponible.'); });
        }
        fetch('/api/season-pair').then(function (r) { return r.json(); }).then(function (d) {
          load((d && d.pair) ? d.pair : 'EURUSD');
        }).catch(function () { load('EURUSD'); });
        if (sel) sel.addEventListener('change', function () {
          var p = sel.value;
          try { fetch('/api/season-pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pair: p }) }); } catch (e) {}
          load(p);
        });
        return null;
      },
    },
    {
      id: 'sessions', name: 'Sessions de marché', cat: 'Macro', h: 340,
      desc: 'La carte du monde des 4 grandes sessions FX, en direct.',
      // IDENTIQUE AU DESK (23/07) : réplique instance-scopée de la VRAIE carte Leaflet de l'onglet MONDE
      // (sessionmap.js) — continents GeoJSON on-brand (geodata amCharts partagé), terminateur jour/nuit,
      // badges villes .lf-city (classes globales → rendu identique), halos de session, résumé d'en-tête.
      // Instance Leaflet DÉDIÉE (window._dtpLfMap reste au desk) + timers locaux → cleanup complet.
      mount: function (host) {
        if (typeof L === 'undefined') { fallback(host, 'Carte indisponible.'); return null; }
        host.innerHTML = '<div class="wdg-mapwrap"><div class="chart-header-sub wdg-map-sub"></div><div class="wdg-lfmap"></div></div>';
        var el = host.querySelector('.wdg-lfmap'), sub = host.querySelector('.wdg-map-sub');
        var CITIES = [
          { name: 'Sydney', tz: 'Australia/Sydney', lon: 151.2, lat: -33.9, open: 9, close: 17 },
          { name: 'Tokyo', tz: 'Asia/Tokyo', lon: 139.7, lat: 35.7, open: 9, close: 15 },
          { name: 'Londres', tz: 'Europe/London', lon: -0.12, lat: 51.5, open: 8, close: 17 },
          { name: 'New York', tz: 'America/New_York', lon: -74.0, lat: 40.7, open: 9, close: 17 },
        ];
        function cityState(c, now) {
          var local = new Date(now.toLocaleString('en-US', { timeZone: c.tz }));
          var h = local.getHours() + local.getMinutes() / 60, dow = local.getDay();
          if (dow >= 1 && dow <= 5 && h >= c.open && h < c.close) return { open: true, soon: false, mins: Math.max(1, Math.round((c.close - h) * 60)) };
          for (var dd = 0; dd < 8; dd++) { var cand = new Date(local); cand.setDate(local.getDate() + dd); cand.setHours(c.open, 0, 0, 0); if (cand > local && cand.getDay() >= 1 && cand.getDay() <= 5) { var m = Math.max(1, Math.round((cand - local) / 60000)); return { open: false, soon: m <= 45, mins: m }; } }
          return { open: false, soon: false, mins: 0 };
        }
        function frDur(m) { var h = Math.floor(m / 60), mm = m % 60; if (h <= 0) return mm + ' min'; if (h >= 24) return Math.floor(h / 24) + ' j ' + (h % 24) + ' h'; return h + ' h' + (mm ? ' ' + (mm < 10 ? '0' + mm : mm) : ''); }
        function cityHtml(c, now, st) {
          var t = now.toLocaleTimeString('fr-FR', { timeZone: c.tz, hour: '2-digit', minute: '2-digit' });
          var cls = st.open ? 'lf-open' : (st.soon ? 'lf-closed lf-soon' : 'lf-closed');
          return '<div class="lf-city ' + cls + '"><div class="lf-row"><span class="lf-dot"></span><b>' + t + '</b><span class="lf-name">' + c.name + '</span></div><div class="lf-sub">' + (st.open ? 'ferme dans ' + frDur(st.mins) : 'ouvre dans ' + frDur(st.mins)) + '</div></div>';
        }
        function mkIcon(c, now, st) { return L.divIcon({ className: 'lf-city-wrap', html: cityHtml(c, now, st), iconSize: [0, 0], iconAnchor: [0, 0] }); }
        // Même clip antiméridien que sessionmap.js (retire les anneaux qui croisent ±180° → pas de « smear »)
        function clipDateline(geo) {
          function crosses(ring) { var e = false, w = false; for (var i = 0; i < ring.length; i++) { if (ring[i][0] > 150) e = true; else if (ring[i][0] < -150) w = true; } return e && w; }
          var feats = [];
          (geo.features || []).forEach(function (f) {
            if (!f.geometry) return;
            var g = f.geometry, coords;
            if (g.type === 'Polygon') coords = g.coordinates.filter(function (r) { return !crosses(r); });
            else if (g.type === 'MultiPolygon') coords = g.coordinates.map(function (poly) { return poly.filter(function (r) { return !crosses(r); }); }).filter(function (poly) { return poly.length; });
            else { feats.push(f); return; }
            if (coords.length) feats.push({ type: f.type || 'Feature', properties: f.properties, geometry: { type: g.type, coordinates: coords } });
          });
          return { type: geo.type || 'FeatureCollection', features: feats };
        }
        el.style.background = 'radial-gradient(125% 105% at 55% 32%, #16181f 0%, #0b0c10 52%, #07080a 100%)';
        var map = L.map(el, {
          center: [18, 6], zoom: 1.4, minZoom: 1, maxZoom: 7, zoomSnap: 0,
          zoomControl: false, attributionControl: false,
          worldCopyJump: false, maxBounds: [[-74, -180], [84, 180]], maxBoundsViscosity: 1.0,
          dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false,
        });
        var hasVector = false;
        try {
          if (typeof am5geodata_worldLow !== 'undefined' && am5geodata_worldLow && am5geodata_worldLow.features) {
            var gj = L.geoJSON(clipDateline(am5geodata_worldLow), { interactive: false, style: { fillColor: '#237a42', fillOpacity: 1, color: '#164d2b', weight: 0.5, opacity: 0.7 } });
            if (gj.getLayers().length > 5) { gj.addTo(map); hasVector = true; }
          }
        } catch (e) {}
        if (!hasVector) { try { L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map); } catch (e) {} }
        var nightIv = null;
        if (typeof L.terminator === 'function') {
          try {
            var term = L.terminator({ fillColor: '#070b14', fillOpacity: 0.5, color: '#070b14', weight: 0, interactive: false, className: 'lf-terminator' });
            term.addTo(map);
            nightIv = setInterval(function () { try { term.setTime(new Date()); } catch (e) {} }, 60000);
          } catch (e) {}
        }
        CITIES.forEach(function (c) {
          c._halo = L.circle([c.lat, c.lon], { radius: 2200000, stroke: false, fillColor: '#00e676', fillOpacity: 0, interactive: false }).addTo(map);
          c._lfm = L.marker([c.lat, c.lon], { icon: mkIcon(c, new Date(), cityState(c, new Date())), interactive: false, keyboard: false }).addTo(map);
        });
        function refreshSessions(now) {
          var openNames = [], nextUp = null;
          CITIES.forEach(function (c) {
            var st = cityState(c, now);
            if (c._lfm) c._lfm.setIcon(mkIcon(c, now, st));
            if (c._halo) { try { c._halo.setStyle({ fillOpacity: st.open ? 0.09 : 0 }); } catch (e) {} }
            if (st.open) openNames.push(c.name);
            else if (!nextUp || st.mins < nextUp.mins) nextUp = { name: c.name, mins: st.mins };
          });
          if (sub) {
            if (openNames.length) { sub.textContent = openNames.join(' · ') + (openNames.length > 1 ? ' ouvertes' : ' ouverte'); sub.style.color = '#00e676'; }
            else if (nextUp) { sub.textContent = 'Fermé · ' + nextUp.name + ' ouvre dans ' + frDur(nextUp.mins); sub.style.color = '#8a8f98'; }
          }
        }
        refreshSessions(new Date());
        var clockIv = setInterval(function () { refreshSessions(new Date()); }, 30000);
        // Gardes anti-vue-aberrante (mêmes que sessionmap.js, bug app desktop 23/07) : jamais de fit ni de
        // mémorisation sur un conteneur pas encore posé (0×0 → zoom clampé « tout vert »), et une vue
        // au-delà de zoom ~3.5 est invalide (le monde entier tient toujours en dessous) → re-fit.
        var savedView = null, ZMAX = 3.5;
        function fit() {
          try {
            if (!el.isConnected) return;
            if (el.offsetWidth < 80 || el.offsetHeight < 80) { setTimeout(fit, 700); return; }
            map.invalidateSize();
            map.fitBounds([[-56, -168], [74, 178]], { animate: false, padding: [3, 3] });
            var z = map.getZoom();
            if (z <= ZMAX) savedView = { center: map.getCenter(), zoom: z };
          } catch (e) {}
        }
        setTimeout(fit, 250);
        setTimeout(fit, 900);
        // Le widget est REDIMENSIONNABLE (coin) → recale la taille SANS refit (vue figée, comme _dtpLfRefit)
        var ro = null;
        try {
          ro = new ResizeObserver(function () {
            try {
              map.invalidateSize();
              if (savedView && savedView.zoom <= ZMAX) map.setView(savedView.center, savedView.zoom, { animate: false });
              else fit();
            } catch (e) {}
          });
          ro.observe(el);
        } catch (e) {}
        return function () {
          clearInterval(clockIv);
          if (nightIv) clearInterval(nightIv);
          try { if (ro) ro.disconnect(); } catch (e) {}
          try { map.remove(); } catch (e) {}
        };
      },
    },
    {
      id: 'fil-news', name: "Fil d'actualité", cat: 'News', h: 320,
      desc: 'Les dernières news du desk, en direct.',
      mount: function (host) {
        var sig = '';
        var render = function () {
          if (!host.isConnected) return;
          var items = (typeof window.getNewsMaster === 'function') ? (window.getNewsMaster() || []) : [];
          var rows = items.slice(0, 15);
          if (!rows.length) { fallback(host, 'Fil en cours de chargement…'); return; }
          var s = rows.map(function (i) { return i.id; }).join('|');
          if (s === sig) return;                                            // rien de neuf → pas de re-render
          sig = s;
          host.innerHTML = '';
          var box = document.createElement('div');
          box.className = 'wdg-news';
          rows.forEach(function (i) {
            try {
              if (typeof window.buildNewsItem === 'function') box.appendChild(window.buildNewsItem(i));
              else {
                var d = document.createElement('div');
                d.className = 'wdg-news-row';
                d.textContent = i.headline || '';
                box.appendChild(d);
              }
            } catch (e) {}
          });
          host.appendChild(box);
        };
        render();
        var t = setInterval(render, 20000);                                 // le WS réassigne allItems → on resuit
        return function () { clearInterval(t); };
      },
    },
    {
      id: 'calculatrice', name: 'Calculatrice de position', cat: 'Outils', h: 280,
      desc: 'Taille de lot depuis capital, risque % et stop (pips).',
      // AUTONOME (aucune dépendance au desk) et VOLATILE (charte DTP : pas de localStorage) — calcul instantané.
      mount: function (host) {
        var f = function (lbl, val, suf) {
          return '<label class="wdg-calc-row"><span class="wdg-calc-lbl">' + lbl + '</span>'
            + '<span class="wdg-calc-in"><input type="number" inputmode="decimal" value="' + val + '" step="any" min="0">'
            + (suf ? '<em>' + suf + '</em>' : '') + '</span></label>';
        };
        host.innerHTML = '<div class="wdg-calc">'
          + f('Capital', 10000, '$') + f('Risque', 1, '%') + f('Stop-loss', 20, 'pips') + f('Valeur du pip (1 lot)', 10, '$')
          + '<div class="wdg-calc-out"><div class="wdg-calc-o"><span>Risque</span><b class="wdg-calc-risk">—</b></div>'
          + '<div class="wdg-calc-o wdg-calc-o--main"><span>Taille de position</span><b class="wdg-calc-lots">—</b></div></div>'
          + '<div class="wdg-calc-note">Position = (capital × risque %) ÷ (stop × valeur du pip).</div>'
          + '</div>';
        var ins = host.querySelectorAll('input');
        var compute = function () {
          var cap = parseFloat(ins[0].value) || 0, rk = parseFloat(ins[1].value) || 0,
              sl = parseFloat(ins[2].value) || 0, pv = parseFloat(ins[3].value) || 0;
          var risk = cap * rk / 100;
          var lots = (sl > 0 && pv > 0) ? risk / (sl * pv) : 0;
          var rEl = host.querySelector('.wdg-calc-risk'), lEl = host.querySelector('.wdg-calc-lots');
          if (rEl) rEl.textContent = risk > 0 ? risk.toFixed(2) + ' $' : '—';
          if (lEl) lEl.textContent = lots > 0 ? lots.toFixed(2) + ' lot' + (lots >= 2 ? 's' : '') : '—';
        };
        ins.forEach(function (i) { i.addEventListener('input', compute); });
        compute();
        return null;
      },
    },
    {
      id: 'journal-mini', name: 'Journal de trading', cat: 'Outils', h: 300,
      desc: 'Tes derniers trades et ton taux de réussite, en un coup d\'œil.',
      // MIROIR du vrai Journal du desk (refonte 23/07 « il ressemble pas au vrai widget ») : on lit le MODÈLE
      // RÉEL de /api/journal — champs builtin ts / pair / dir / result / pl / r / pnlPct (cf. _jrAddRow app.js),
      // avec repli sur e.props (journal PERSO importé). Rendu = mêmes codes que le desk : date FR, paire en gras,
      // badge ACHAT/VENTE, chip résultat (TP vert · BE ambre · SL rouge), P&L signé. Jamais de valeur inventée.
      mount: function (host) {
        var chartId = HOST_ID + '-jreq-' + uid();
        function build(j) {
          if (!host.isConnected) return;
          var entries = (j && j.entries) || [];
          if (!entries.length) {
            host.innerHTML = '<div class="wdg-jr-empty"><div>Aucun trade enregistré.</div>'
              + '<button class="wdg-btn" type="button">Ouvrir le Journal ›</button></div>';
            var b0 = host.querySelector('button');
            if (b0) b0.addEventListener('click', function () { if (typeof activateView === 'function') activateView('journal'); });
            return;
          }
          var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
          var fmtD = function (ts) { try { var d = new Date(ts); if (!isFinite(d.getTime())) return ''; return d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2); } catch (e) { return ''; } };
          var num = function (v) { if (v == null || v === '') return null; var n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };
          var prop = function (e, rx) {                                    // repli journal importé : cherche dans e.props
            var p = e && e.props; if (!p) return null;
            for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k) && rx.test(k)) return p[k];
            return null;
          };
          var fld = function (e, k, rx) { var v = e ? e[k] : null; return (v != null && v !== '') ? v : prop(e, rx); };
          var fmtMoney = function (n) { return (n > 0 ? '+' : '') + n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' $'; };
          // P&L affiché : $ (pl) en priorité, sinon R, sinon % — même hiérarchie que les stats du desk.
          var pnlOf = function (e) {
            var v = num(e.pl); if (v != null) return { n: v, txt: fmtMoney(v) };
            v = num(e.r); if (v != null) return { n: v, txt: (v > 0 ? '+' : '') + String(Math.round(v * 100) / 100).replace('.', ',') + ' R' };
            v = num(e.pnlPct); if (v != null) return { n: v, txt: (v > 0 ? '+' : '') + String(Math.round(v * 100) / 100).replace('.', ',') + ' %' };
            v = num(prop(e, /pnl|p&l|profit|gain|\$/i)); if (v != null) return { n: v, txt: fmtMoney(v) };
            return null;
          };
          var sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
          // Résultat UNIFIÉ (-1/0/1) façon desk (_jrOutcome) : R → $PNL → libellé Résultat.
          var outcome = function (e) {
            var r = num(e.r); if (r != null) return r > 0 ? 1 : r < 0 ? -1 : 0;
            var pl = num(e.pl); if (pl != null) return pl > 0 ? 1 : pl < 0 ? -1 : 0;
            var res = String(fld(e, 'result', /r[ée]sultat|result|issue|outcome/i) || '');
            if (/tp|profit|win|gagn/i.test(res)) return 1;
            if (/\bsl\b|loss|perte|perd/i.test(res)) return -1;
            if (/\bbe\b|break/i.test(res)) return 0;
            return null;
          };
          // ── STATISTIQUES PRO (en mémoire, miroir du Tableau de bord du desk) ──
          var rs = entries.map(function (e) { return num(e.r); }).filter(function (v) { return v != null; });
          var winsR = rs.filter(function (v) { return v > 0; }), lossR = rs.filter(function (v) { return v < 0; });
          var totR = sum(rs);
          var pls = entries.map(function (e) { return num(e.pl); }).filter(function (v) { return v != null; });
          var totD = sum(pls), cum = totD, cumOk = pls.length === entries.length && pls.length > 0;
          var outs = entries.map(outcome).filter(function (v) { return v != null; });
          var oW = outs.filter(function (v) { return v > 0; }).length, oL = outs.filter(function (v) { return v < 0; }).length;
          var wr = (oW + oL) ? Math.round(oW / (oW + oL) * 100) : null;
          var avgW = winsR.length ? sum(winsR) / winsR.length : 0, avgL = lossR.length ? sum(lossR) / lossR.length : 0;
          var gD = sum(pls.filter(function (v) { return v > 0; })), lD = Math.abs(sum(pls.filter(function (v) { return v < 0; })));
          var gR = sum(winsR), lR = Math.abs(sum(lossR));
          var pf = lD > 0 ? gD / lD : (lR > 0 ? gR / lR : null);
          var expR = (rs.length && (oW + oL)) ? (oW / (oW + oL)) * avgW + (oL / (oW + oL)) * avgL : null;
          var chronAll = entries.slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
          var ddInD = pls.length > 0, _cum = 0, _peak = 0, maxDD = 0;
          chronAll.forEach(function (e) { var v = ddInD ? (num(e.pl) || 0) : (num(e.r) || 0); _cum += v; if (_cum > _peak) _peak = _cum; var dd = _peak - _cum; if (dd > maxDD) maxDD = dd; });
          var _stk = 0, worst = 0;
          chronAll.forEach(function (e) { var o = outcome(e); if (o == null) return; if (o < 0) { _stk++; if (_stk > worst) worst = _stk; } else if (o > 0) _stk = 0; });
          var longN = entries.filter(function (e) { return !/sell|short|vente/i.test(String(fld(e, 'dir', /^(sens|dir(ection)?|side|type)$/i) || '')); }).length;
          var shortN = entries.length - longN;
          var rrs = entries.map(function (e) { return num(e.rr); }).filter(function (v) { return v != null && v > 0; });
          var rrAvg = rrs.length ? sum(rrs) / rrs.length : null;
          var RES = ['Profit', 'TP', 'BE', 'SL', 'Loss'], RESCOL = { Profit: '#00e676', TP: '#00cc99', BE: '#ffb300', SL: '#ff8f00', Loss: '#ff3d00' };
          var resMap = {}; RES.forEach(function (k) { resMap[k] = 0; });
          entries.forEach(function (e) {
            var res = String(fld(e, 'result', /r[ée]sultat|result|issue|outcome/i) || ''), k = null;
            if (/^tp\b|take.?profit/i.test(res)) k = 'TP'; else if (/^be\b|break.?even/i.test(res)) k = 'BE';
            else if (/^sl\b|stop.?loss/i.test(res)) k = 'SL'; else if (/loss|perte|perd/i.test(res)) k = 'Loss';
            else if (/profit|win|gagn/i.test(res)) k = 'Profit';
            if (!k) { var pp = pnlOf(e); if (pp) k = pp.n > 0 ? 'Profit' : pp.n < 0 ? 'Loss' : 'BE'; }
            if (k) resMap[k]++;
          });
          var fmtR = function (v) { return (v > 0 ? '+' : '') + (Math.round(v * 100) / 100).toString().replace('.', ','); };
          var fmtK = function (v) { var a = Math.abs(v); if (a >= 1000) return (v > 0 ? '+' : '') + (Math.round(v / 100) / 10).toString().replace('.', ',') + ' k$'; return (v > 0 ? '+' : '') + Math.round(v) + ' $'; };

          // ── COURBE : bascule %/$PNL/R/$Capital (comme le desk) ──
          var startCap = num(j && j.startCap);
          var haveField = function (getter) { return entries.some(function (e) { return getter(e) != null; }); };
          var hasPl = haveField(function (e) { return num(e.pl); }), hasRc = haveField(function (e) { return num(e.r); }), hasPct = haveField(function (e) { return num(e.pnlPct); });
          var hasCap = startCap != null && startCap > 0 && hasPl;
          var eqMode = hasCap ? 'cap' : hasPl ? 'pl' : hasRc ? 'r' : hasPct ? 'pct' : null;
          var EQ_LBL = { cap: '$ Capital', pl: '$ PNL', r: 'R cumulé', pct: '% cumulé' };
          function eqDataFor(mode) {
            var valOf = mode === 'r' ? function (e) { return num(e.r); } : mode === 'pct' ? function (e) { return num(e.pnlPct); } : function (e) { return num(e.pl); };
            var unit = mode === 'pct' ? ' %' : mode === 'r' ? ' R' : ' $';
            var chron = entries.filter(function (e) { return valOf(e) != null && e.ts; }).sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
            var run = (mode === 'cap') ? startCap : 0;
            var fmtV = function (v) { return (mode === 'cap' ? '' : (v > 0 ? '+' : '')) + (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + unit; };
            var out = [];
            for (var ci = 0; ci < chron.length; ci++) { var pv = run; run += (valOf(chron[ci]) || 0); out.push({ t: chron[ci].ts, v: Math.round(run * 100) / 100, vLbl: fmtV(run), dLbl: fmtD(chron[ci].ts), varLbl: 'Variation : ' + fmtV(run - pv) }); }
            return out;
          }
          var eqData = eqMode ? eqDataFor(eqMode) : [];
          var hasCurve = eqData.length >= 2;

          // TABLEAU IDENTIQUE AU VRAI JOURNAL (24/07, demande user « toutes tes colonnes perso ») : mêmes
          // colonnes que le desk (perso du compte via j.cols, sinon les 21 par défaut), mêmes cellules
          // (chips/rings/progress/badges réutilisant les classes globales .jr-*). Scroll horizontal comme le
          // desk. Cap 100 (anti-OOM), plus récent en haut. Édition rapide = crayon (champs cœur) ; édition
          // fine d'une colonne = « Ouvrir le Journal ».
          var _pen = '<button class="wdg-jrt-edit" type="button" title="Modifier ce trade" aria-label="Modifier"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>';
          var visCols = _wjrColsFromStore(j && j.cols).filter(function (c) { return !c.hidden; });
          var sortedE = entries.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 100);
          var jrThead = '<tr>' + visCols.map(function (c) { return '<th class="wdg-jrt-th" style="min-width:' + (c.w || 110) + 'px">' + esc(c.label) + '</th>'; }).join('') + '<th class="wdg-jrt-th wdg-jrt-th--act"></th></tr>';
          var jrTbody = sortedE.map(function (e) {
            return '<tr class="wdg-jrt-row" data-id="' + esc(e.id || '') + '" title="Ouvrir dans le Journal">'
              + visCols.map(function (c) { return '<td class="wdg-jrt-c jr-c--' + c.type + '">' + _wjrCell(e, c) + '</td>'; }).join('')
              + '<td class="wdg-jrt-c wdg-jrt-c--act">' + _pen + '</td></tr>';
          }).join('');
          var jrTable = '<div class="wdg-jrt-scroll custom-scrollbar"><table class="wdg-jrt"><thead>' + jrThead + '</thead><tbody>' + jrTbody + '</tbody></table></div>';
          var modeBtns = [['pct', hasPct], ['pl', hasPl], ['r', hasRc], ['cap', hasCap]].filter(function (x) { return x[1]; })
            .map(function (x) { return '<button data-m="' + x[0] + '"' + (x[0] === eqMode ? ' class="on"' : '') + '>' + EQ_LBL[x[0]] + '</button>'; }).join('');
          var lastV = hasCurve ? eqData[eqData.length - 1] : null;
          var qaForm = '<form class="wdg-jr-qa" hidden>'
            + '<input class="wdg-jr-qa-pair" placeholder="Paire (EUR/USD)" maxlength="16" autocomplete="off">'
            + '<select class="wdg-jr-qa-dir"><option value="BUY">Achat</option><option value="SELL">Vente</option></select>'
            + '<input class="wdg-jr-qa-pl" type="number" step="any" placeholder="P&L $" inputmode="decimal">'
            + '<select class="wdg-jr-qa-res"><option value="">Résultat…</option><option>Profit</option><option>TP</option><option>BE</option><option>SL</option><option>Loss</option></select>'
            + '<button type="submit" class="wdg-jr-qa-save">Ajouter</button>'
            + '<button type="button" class="wdg-jr-qa-del" title="Supprimer ce trade" hidden>Suppr.</button>'
            + '<button type="button" class="wdg-jr-qa-cancel" title="Annuler">✕</button></form>';
          var tradesView = '<div class="wdg-jr-tools"><button class="wdg-jr-add" type="button">+ Nouveau trade</button>'
            + '<button class="wdg-jr-open" type="button">Ouvrir le Journal ↗</button></div>' + qaForm
            + '<div class="wdg-jr-stats"><span><b>' + entries.length + '</b> trade' + (entries.length > 1 ? 's' : '') + '</span>'
            + (wr != null ? '<span>Réussite <b class="' + (wr >= 50 ? 'up' : 'down') + '">' + wr + ' %</b></span>' : '')
            + (cumOk ? '<span>P&amp;L <b class="' + (cum > 0 ? 'up' : cum < 0 ? 'down' : '') + '">' + esc(fmtMoney(cum)) + '</b></span>' : '') + '</div>'
            + (hasCurve ? '<div class="wdg-jr-chartwrap"><div class="wdg-jr-chartlbl"><b class="wdg-jr-eqval">' + esc(lastV.vLbl) + '</b>'
                + (modeBtns ? '<span class="wdg-jr-eqtog">' + modeBtns + '</span>' : '') + '</div><div class="wdg-jr-chart" id="' + chartId + '"></div></div>' : '')
            + jrTable;

          // ── VUE TABLEAU DE BORD (anneaux KPI + donut + métriques clés, comme le desk) ──
          function ring(txt, col, label, sub) {
            return '<div class="wdg-jrk"><span class="wdg-jrk-circ" style="border-color:' + col + ';color:' + col + '">' + esc(txt) + '</span>'
              + '<span class="wdg-jrk-lbl">' + esc(label) + '</span>' + (sub ? '<span class="wdg-jrk-sub">' + esc(sub) + '</span>' : '') + '</div>';
          }
          var totRes = RES.reduce(function (a, k) { return a + resMap[k]; }, 0), acc = 0, stops = [];
          RES.forEach(function (k) { if (!resMap[k]) return; var f = resMap[k] / totRes; stops.push(RESCOL[k] + ' ' + (acc * 360).toFixed(1) + 'deg ' + ((acc + f) * 360).toFixed(1) + 'deg'); acc += f; });
          var donut = totRes ? '<div class="wdg-jrd-donutwrap"><div class="wdg-jrd-donut" style="background:conic-gradient(' + stops.join(',') + ')"><span class="wdg-jrd-hole"><b>' + entries.length + '</b><em>trades</em></span></div>'
            + '<div class="wdg-jrd-legend">' + RES.filter(function (k) { return resMap[k]; }).map(function (k) { return '<span><i style="background:' + RESCOL[k] + '"></i>' + k + ' <b>' + resMap[k] + '</b></span>'; }).join('') + '</div></div>' : '';
          var dashView = '<div class="wdg-jrd custom-scrollbar">'
            + '<div class="wdg-jrd-sec">Performance pilote</div>'
            + '<div class="wdg-jrk-row">'
              + (rs.length ? ring(fmtR(totR), totR >= 0 ? '#00e676' : '#ff3d00', 'Total R') : '')
              + (pls.length ? ring(fmtK(totD), totD >= 0 ? '#00e676' : '#ff3d00', 'Total $') : '')
              + ring(String(entries.length), '#e3b23a', 'Trades')
              + (wr != null ? ring(wr + ' %', wr >= 50 ? '#00e676' : '#ff3d00', 'Taux de réussite', oW + ' G / ' + oL + ' P') : '')
            + '</div>'
            + (donut ? '<div class="wdg-jrd-sec">Répartition des résultats</div>' + donut : '')
            + '<div class="wdg-jrd-sec">Performance clé</div>'
            + '<div class="wdg-jrk-row">'
              + (winsR.length ? ring(fmtR(avgW), '#00e676', 'R moy. gagnant') : '')
              + (lossR.length ? ring(fmtR(avgL), '#ff3d00', 'R moy. perdant') : '')
              + ring(longN + ' / ' + shortN, '#3b82f6', 'Long / Short')
              + (rrAvg != null ? ring((Math.round(rrAvg * 100) / 100).toString().replace('.', ','), '#a78bfa', 'RR cible moyen') : '')
              + (pf != null ? ring((Math.round(pf * 100) / 100).toString().replace('.', ','), '#00e676', 'Profit factor', 'gains / pertes') : '')
              + (expR != null ? ring(fmtR(expR), '#00cc99', 'Espérance / trade', 'en R') : '')
              + (maxDD > 0 ? ring(ddInD ? fmtK(-maxDD) : fmtR(-maxDD), '#ff8f00', 'Max drawdown') : '')
              + (worst > 0 ? ring(String(worst), '#ff3d00', 'Série perdante max') : '')
            + '</div></div>';

          host.innerHTML = '<div class="wdg-jr">'
            + '<div class="wdg-jrtab"><button class="on" data-v="trades">Trades</button><button data-v="dash">Tableau de bord</button></div>'
            + '<div class="wdg-jr-view" data-view="trades">' + tradesView + '</div>'
            + '<div class="wdg-jr-view" data-view="dash" hidden>' + dashView + '</div></div>';

          host.querySelectorAll('.wdg-jrtab button').forEach(function (b) {
            b.addEventListener('click', function () {
              host.querySelectorAll('.wdg-jrtab button').forEach(function (x) { x.classList.toggle('on', x === b); });
              host.querySelectorAll('.wdg-jr-view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== b.getAttribute('data-v'); });
            });
          });
          host.querySelectorAll('.wdg-jr-eqtog button').forEach(function (b) {
            b.addEventListener('click', function () {
              var m = b.getAttribute('data-m'), data = eqDataFor(m);
              host.querySelectorAll('.wdg-jr-eqtog button').forEach(function (x) { x.classList.toggle('on', x === b); });
              var ve = host.querySelector('.wdg-jr-eqval'); if (ve && data.length) ve.textContent = data[data.length - 1].vLbl;
              if (data.length >= 2) _wdgJrEquityChart(chartId, data);
            });
          });
          if (hasCurve) requestAnimationFrame(function () { _wdgJrEquityChart(chartId, eqData); });

          // ── ACTIONS (demande user 23/07 : ajouter / MODIFIER SUR PLACE / ouvrir la page) ──
          var openDesk = function () { if (typeof activateView === 'function') activateView('journal'); };
          var ob = host.querySelector('.wdg-jr-open'); if (ob) ob.addEventListener('click', openDesk);
          var qa = host.querySelector('.wdg-jr-qa'), addBtn = host.querySelector('.wdg-jr-add');
          var saveBtn = qa && qa.querySelector('.wdg-jr-qa-save');
          var delBtn  = qa && qa.querySelector('.wdg-jr-qa-del');
          var editId = null;   // null = mode AJOUT ; sinon id du trade en cours d'édition
          // POST commun : préserve custom/cols/startCap du compte ; en cas d'échec, restaure le bouton.
          function postEntries(next, busyLbl) {
            var payload = { entries: next, custom: !!(j && j.custom) };
            if (j && j.cols) payload.cols = j.cols;
            var sc = num(j && j.startCap); if (sc != null && sc > 0) payload.startCap = sc;
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = busyLbl || '…'; }
            if (delBtn) delBtn.disabled = true;
            return fetch('/api/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
              .then(function (r) { return r.json(); }).then(function () { reload(); })
              .catch(function () { if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = editId ? 'Enregistrer' : 'Ajouter'; } if (delBtn) delBtn.disabled = false; });
          }
          function resetForm() {
            editId = null;
            if (!qa) return;
            qa.hidden = true; qa.reset();
            if (saveBtn) saveBtn.textContent = 'Ajouter';
            if (delBtn) delBtn.hidden = true;
          }
          // MODIFIER : clic sur le crayon d'une ligne → le formulaire (le même que « + Nouveau trade »)
          // s'ouvre PRÉ-REMPLI, le bouton devient « Enregistrer » et « Suppr. » apparaît. stopPropagation :
          // le crayon ne déclenche pas l'ouverture du Journal (clic ligne = ouvrir la page, conservé).
          host.querySelectorAll('.wdg-jrt-row').forEach(function (row) {
            row.addEventListener('click', function () { openDesk(); });
            var pen = row.querySelector('.wdg-jrt-edit');
            if (pen && qa) pen.addEventListener('click', function (ev) {
              ev.stopPropagation();
              var id = row.getAttribute('data-id');
              var e = (j.entries || []).filter(function (x) { return String(x.id || '') === id; })[0];
              if (!e) return;
              editId = id;
              qa.querySelector('.wdg-jr-qa-pair').value = fld(e, 'pair', /paire|pair|symbol|instrument|actif/i) || '';
              var dv = String(fld(e, 'dir', /^(sens|dir(ection)?|side|type)$/i) || '');
              qa.querySelector('.wdg-jr-qa-dir').value = /sell|short|vente/i.test(dv) ? 'SELL' : 'BUY';
              var plv = num(e.pl); qa.querySelector('.wdg-jr-qa-pl').value = plv != null ? plv : '';
              var rv = String(fld(e, 'result', /r[ée]sultat|result|issue|outcome/i) || '');
              var rsel = qa.querySelector('.wdg-jr-qa-res');
              rsel.value = Array.prototype.some.call(rsel.options, function (o) { return o.value === rv; }) ? rv : '';
              if (saveBtn) saveBtn.textContent = 'Enregistrer';
              if (delBtn) { delBtn.hidden = false; delBtn.disabled = false; }
              qa.hidden = false;
              try { qa.scrollIntoView({ block: 'nearest' }); } catch (e2) {}
              var pi = qa.querySelector('.wdg-jr-qa-pair'); if (pi) pi.focus();
            });
          });
          if (addBtn && qa) {
            // + Nouveau trade : bascule le formulaire en mode AJOUT (annule un éventuel mode édition).
            addBtn.addEventListener('click', function () {
              var wasEdit = !!editId; resetForm();
              if (wasEdit || qa.hidden) { qa.hidden = false; var pi = qa.querySelector('.wdg-jr-qa-pair'); if (pi) pi.focus(); }
              else qa.hidden = true;
            });
            var cancel = qa.querySelector('.wdg-jr-qa-cancel'); if (cancel) cancel.addEventListener('click', resetForm);
            // SUPPRIMER (mode édition) : retire le trade par id → POST → reload.
            if (delBtn) delBtn.addEventListener('click', function () {
              if (!editId) return;
              var next = (j.entries || []).filter(function (x) { return String(x.id || '') !== editId; });
              postEntries(next, '…');
            });
            qa.addEventListener('submit', function (ev) {
              ev.preventDefault();
              var pairV = (qa.querySelector('.wdg-jr-qa-pair').value || '').trim().toUpperCase();
              var dirV = qa.querySelector('.wdg-jr-qa-dir').value;
              var plV = num(qa.querySelector('.wdg-jr-qa-pl').value);
              var resV = qa.querySelector('.wdg-jr-qa-res').value;
              if (editId) {
                // ÉDITION SUR PLACE : met à jour les champs natifs du trade, préserve tout le reste
                // (id, ts, r, pnlPct, rr, note, props d'un import) → le desk garde ses données fines.
                var next = (j.entries || []).map(function (x) {
                  if (String(x.id || '') !== editId) return x;
                  var u = {}; for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) u[k] = x[k];
                  u.pair = pairV.slice(0, 16); u.dir = dirV; u.pl = plV; u.result = resV;
                  return u;
                });
                postEntries(next, 'Enregistrer');
                return;
              }
              if (!pairV && plV == null && !resV) { qa.hidden = true; return; }   // rien saisi → on referme
              var e = { id: 'w' + (typeof Date !== 'undefined' ? Date.now().toString(36) : uid()) + Math.random().toString(36).slice(2, 5),
                ts: Date.now(), pair: pairV.slice(0, 16), dir: dirV, pl: plV, result: resV,
                r: null, pnlPct: null, rr: null, note: '', props: {} };
              postEntries((j.entries || []).concat([e]), 'Ajouter');
            });
          }
        }
        function reload() { host.innerHTML = '<div class="wdg-load">Chargement…</div>'; fetch('/api/journal').then(function (r) { return r.json(); }).then(build).catch(function () { fallback(host, 'Journal indisponible.'); }); }
        reload();
        return function () { try { if (typeof disposeRoot === 'function') disposeRoot(chartId); } catch (e) {} };
      },
    },
  ];

  // Courbe de capital du widget Journal (miroir de _jrBuildEquityChart du desk) : aire dégradée OR, axes discrets,
  // tooltip riche FR (date · valeur · variation). amCharts globaux ; root disposé par le cleanup du widget.
  function _wdgJrEquityChart(id, data) {
    var el = document.getElementById(id);
    if (!el || typeof am5 === 'undefined' || typeof am5xy === 'undefined') return;
    try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {}
    var root = am5.Root.new(id);
    try { root.setThemes([typeof am5themes_Animated !== 'undefined' ? am5themes_Animated.new(root) : null].filter(Boolean)); } catch (e) {}
    if (root._logo) root._logo.set('forceHidden', true);
    var chart = root.container.children.push(am5xy.XYChart.new(root, { panX: false, panY: false, wheelX: 'none', wheelY: 'none', paddingLeft: 0, paddingRight: 2, paddingTop: 6, paddingBottom: 2 }));
    var xr = am5xy.AxisRendererX.new(root, { minGridDistance: 62 });
    xr.grid.template.setAll({ stroke: am5.color(0x2b2b31), strokeOpacity: 0.16, strokeDasharray: [2, 4] });
    xr.labels.template.setAll({ fill: am5.color(0x6b7280), fontSize: 9 });
    var xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, { baseInterval: { timeUnit: 'day', count: 1 }, renderer: xr, extraMin: 0, extraMax: 0 }));
    xAxis.set('dateFormats', { day: 'dd MMM', week: 'dd MMM', month: 'MMM yy' });
    xAxis.set('periodChangeDateFormats', { day: 'dd MMM', month: 'MMM yy' });
    var yr = am5xy.AxisRendererY.new(root, { opposite: true, minWidth: 44 });
    yr.grid.template.setAll({ stroke: am5.color(0x2b2b31), strokeOpacity: 0.16, strokeDasharray: [2, 4] });
    yr.labels.template.setAll({ fill: am5.color(0x94a3b8), fontSize: 8.5 });
    yr.labels.template.adapters.add('text', function (t) { return t == null ? t : String(t).replace('.', ','); });
    var yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { renderer: yr, maxDeviation: 0.12 }));
    var z = yAxis.createAxisRange(yAxis.makeDataItem({ value: 0 }));
    z.get('grid').setAll({ stroke: am5.color(0xffffff), strokeOpacity: 0.28, strokeWidth: 1 });
    if (z.get('label')) z.get('label').set('visible', false);
    var tip = am5.Tooltip.new(root, { getFillFromSprite: false, autoTextColor: false, labelText: '[#8a8a92 fontSize:9.5px]{dLbl}[/]\n[bold #e3b23a fontSize:13px]{vLbl}[/]\n[#9aa0aa fontSize:9.5px]{varLbl}[/]' });
    tip.get('background').setAll({ fill: am5.color(0x141417), stroke: am5.color(0x33333a), strokeWidth: 1, fillOpacity: 0.98, cornerRadius: 6 });
    if (tip.label) tip.label.setAll({ fill: am5.color(0xe6e6ea), paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8 });
    var series = chart.series.push(am5xy.LineSeries.new(root, { xAxis: xAxis, yAxis: yAxis, valueXField: 't', valueYField: 'v', stroke: am5.color(0xe3b23a), fill: am5.color(0xe3b23a), tooltip: tip }));
    series.strokes.template.setAll({ strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' });
    series.fills.template.setAll({ visible: true, fillGradient: am5.LinearGradient.new(root, { rotation: 90, stops: [{ color: am5.color(0xe3b23a), opacity: 0.40 }, { color: am5.color(0xcfa233), opacity: 0.10 }, { color: am5.color(0xe3b23a), opacity: 0 }] }) });
    series.data.setAll(data);
    var cursor = chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none', xAxis: xAxis, yAxis: yAxis, snapToSeries: [series] }));
    cursor.lineX.setAll({ stroke: am5.color(0xe3b23a), strokeOpacity: 0.5, strokeWidth: 1, strokeDasharray: [2, 3] });
    cursor.lineY.set('visible', false);
    series.appear(600); chart.appear(600, 60);
  }

  function byId(id) { for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i]; return null; }

  /* ── PRESET proposé au premier lancement ── */
  function defaultCfg() {
    return {
      active: 'mon-desk',
      // Le nom du layout ne doit PAS reprendre celui du panneau : l'en-tête affichait
      // « Mon Desk · Mon Desk · BÊTA » (constaté au banc d'essai).
      layouts: [{
        id: 'mon-desk', name: 'Vue générale', fav: true, items: [
          { w: 'force-devises', gw: 8, gh: 12 },
          { w: 'calendrier-jour', gw: 4, gh: 12 },
          { w: 'fil-news', gw: 12, gh: 11 },
        ],
      }],
    };
  }

  /* ── PERSISTANCE PAR COMPTE ── */
  // 'mon-desk' = le DESK PAR DÉFAUT, PROTÉGÉ (demande user 23/07) : toujours présent (recréé s'il a été
  // supprimé par une ancienne version) et NON SUPPRIMABLE (garde dans deleteLayout + cadenas au gestionnaire).
  var PROTECTED_ID = 'mon-desk';
  function ensureDefaultLayout(c) {
    if (!c || !Array.isArray(c.layouts)) return c;
    if (!c.layouts.some(function (l) { return l && l.id === PROTECTED_ID; })) {
      c.layouts.unshift(JSON.parse(JSON.stringify(defaultCfg().layouts[0])));
      c.layouts[0].fav = false;                       // ne vole jamais l'étoile d'un template choisi par le user
    }
    return c;
  }
  function load() {
    return fetch('/api/widgets').then(function (r) { return r.json(); }).then(function (j) {
      STATE.cfg = ensureDefaultLayout((j && j.cfg && j.cfg.layouts && j.cfg.layouts.length) ? j.cfg : defaultCfg());
    }).catch(function () { STATE.cfg = defaultCfg(); });
  }
  function save() {                        // débouncé ; le serveur re-sanitise de toute façon
    clearTimeout(STATE.saveT);
    STATE.saveT = setTimeout(function () {
      fetch('/api/widgets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(STATE.cfg),
      }).catch(function () {});
    }, 700);
  }
  function activeLayout() {
    var c = STATE.cfg; if (!c) return null;
    for (var i = 0; i < c.layouts.length; i++) if (c.layouts[i].id === c.active) return c.layouts[i];
    return c.layouts[0] || null;
  }

  /* ── GRILLE ── */
  function unmountAll() {
    STATE.mounted.forEach(function (fn) { try { if (typeof fn === 'function') fn(); } catch (e) {} });
    STATE.mounted = [];
  }

  /* ── AGENCEMENT SMART : glisser-déposer (réordonner) + poignée de redimensionnement (hauteur) ──
     Tout en DÉLÉGATION sur l'hôte #wdg-grid (qui persiste entre les renderGrid) → câblé UNE fois.
     Le drag part de la POIGNÉE (⠿) du header pour ne jamais gêner le contenu du widget ; le resize
     part de la poignée basse. On persiste (save) et on re-rend pour remonter proprement les charts. */
  function _reorderBefore(from, before) {
    var l = activeLayout(); if (!l) return;
    from = from | 0; before = before | 0;
    if (from < 0 || from >= l.items.length) return;
    var it = l.items.splice(from, 1)[0];
    if (from < before) before--;                                  // le retrait a décalé les indices suivants
    before = Math.max(0, Math.min(l.items.length, before));
    l.items.splice(before, 0, it);
    save(); renderGrid();
  }
  function _wireGrid(host) {
    if (!host || host._wdgWired) return; host._wdgWired = true;
    var dragIdx = null, rz = null;
    var clearHints = function () { host.querySelectorAll('.wdg-drop-before,.wdg-drop-after').forEach(function (c) { c.classList.remove('wdg-drop-before', 'wdg-drop-after'); }); };
    // — Glisser-déposer (réordonner) —
    host.addEventListener('dragstart', function (e) {
      var grip = e.target.closest && e.target.closest('.wdg-grip');
      var card = grip && grip.closest('.wdg-card');
      if (!card) { if (e.preventDefault) e.preventDefault(); return; }             // drag AUTORISÉ seulement depuis la poignée
      dragIdx = +card.getAttribute('data-idx');
      card.classList.add('wdg-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragIdx)); e.dataTransfer.setDragImage(card, 24, 18); } catch (_) {}
    });
    host.addEventListener('dragover', function (e) {
      if (dragIdx == null) return; e.preventDefault();
      var card = e.target.closest && e.target.closest('.wdg-card'); clearHints();
      if (!card || +card.getAttribute('data-idx') === dragIdx) return;
      var r = card.getBoundingClientRect();
      card.classList.add((e.clientY - r.top) > r.height / 2 ? 'wdg-drop-after' : 'wdg-drop-before');
    });
    host.addEventListener('drop', function (e) {
      if (dragIdx == null) return; e.preventDefault();
      var card = e.target.closest && e.target.closest('.wdg-card');
      if (card) {
        var to = +card.getAttribute('data-idx'), r = card.getBoundingClientRect();
        _reorderBefore(dragIdx, (e.clientY - r.top) > r.height / 2 ? to + 1 : to);
      }
      dragIdx = null; clearHints();
    });
    host.addEventListener('dragend', function () { dragIdx = null; clearHints(); host.querySelectorAll('.wdg-dragging').forEach(function (c) { c.classList.remove('wdg-dragging'); }); });
    // — Redimensionnement LIBRE par la poignée de COIN : largeur en COLONNES (1→12, jusqu'à 100%) + hauteur en
    //   LIGNES, avec SNAP sur la grille et aperçu live. (demande user : resize libre, largeur pleine, snap.)
    var GAP = 10;
    host.addEventListener('pointerdown', function (e) {
      var h = e.target.closest && e.target.closest('.wdg-resize'); var card = h && h.closest('.wdg-card');
      if (!card) return; e.preventDefault();
      var l = activeLayout(); var idx = +card.getAttribute('data-idx'); var it = l && l.items[idx];
      if (!it || it.locked) return; _normItem(it);
      rz = { it: it, card: card, x0: e.clientX, y0: e.clientY, gw0: it.gw, gh0: it.gh, gw: it.gw, gh: it.gh,
             colUnit: (card.offsetWidth + GAP) / Math.max(1, it.gw) };
      card.classList.add('wdg-resizing');
      try { host.setPointerCapture(e.pointerId); } catch (_) {}
    });
    host.addEventListener('pointermove', function (e) {
      if (!rz) return;
      rz.gw = _clamp(rz.gw0 + Math.round((e.clientX - rz.x0) / rz.colUnit), 1, GRID_COLS);
      rz.gh = _clamp(rz.gh0 + Math.round((e.clientY - rz.y0) / (ROW_PX + GAP)), 3, 60);
      rz.card.style.setProperty('--gw', rz.gw); rz.card.style.setProperty('--gh', rz.gh);   // aperçu live (snap)
    });
    var endResize = function (e) {
      if (!rz) return;
      var changed = (rz.gw !== rz.gw0 || rz.gh !== rz.gh0);
      if (changed) { rz.it.gw = rz.gw; rz.it.gh = rz.gh; save(); }
      rz.card.classList.remove('wdg-resizing');
      try { host.releasePointerCapture(e.pointerId); } catch (_) {}
      rz = null;
      if (changed) renderGrid();                                                    // remonte les charts à la bonne taille
    };
    host.addEventListener('pointerup', endResize);
    host.addEventListener('pointercancel', endResize);
  }

  function renderGrid() {
    var host = document.getElementById(HOST_ID); if (!host) return;
    _wireGrid(host);
    unmountAll();
    var lay = activeLayout();
    if (!lay || !lay.items.length) {
      host.innerHTML = '<div class="wdg-blank"><div class="wdg-blank-t">Ton desk est vide</div>'
        + '<div class="wdg-blank-s">Ajoute tes premiers widgets depuis la bibliothèque.</div>'
        + '<button class="wdg-btn wdg-btn--gold" onclick="DTPWidgets.openLib()">+ Ajouter un widget</button></div>';
      return;
    }
    host.innerHTML = lay.items.map(function (it, idx) {
      var w = byId(it.w);
      if (!w) return '';                                                     // widget retiré du catalogue → ignoré
      _normItem(it);
      var locked = !!it.locked;
      var step = function (lbl, cur, act) {
        return '<div class="wdg-set-row"><span class="wdg-set-lbl">' + lbl + '</span>'
          + '<span class="wdg-stepper"><button class="wdg-step" onclick="DTPWidgets.' + act + '(' + idx + ',-1)" aria-label="moins">−</button>'
          + '<span class="wdg-step-val">' + cur + '</span>'
          + '<button class="wdg-step" onclick="DTPWidgets.' + act + '(' + idx + ',1)" aria-label="plus">+</button></span></div>';
      };
      // Carte = cellule de grille (span colonnes/lignes via --gw/--gh). Header TERMINAL : déplacer · actualiser ·
      // réglages · dupliquer · plein écran · verrouiller · retirer. Icônes discrètes, hover doré.
      return '<section class="wdg-card' + (locked ? ' wdg-card--locked' : '') + '" data-idx="' + idx + '" style="--gw:' + it.gw + ';--gh:' + it.gh + ';">'
        + '<header class="wdg-head">'
        +   '<button class="wdg-grip" draggable="' + (locked ? 'false' : 'true') + '" title="Déplacer" aria-label="Déplacer">' + ICO.grip + '</button>'
        +   '<span class="wdg-title" title="' + esc(w.name) + '">' + esc(w.name) + '</span>'
        +   '<span class="wdg-actions">'
        +     '<button class="wdg-ico" title="Actualiser" onclick="DTPWidgets.refresh(' + idx + ')">' + ICO.refresh + '</button>'
        +     '<button class="wdg-ico" title="Réglages" onclick="DTPWidgets.toggleSettings(' + idx + ')">' + ICO.gear + '</button>'
        +     '<button class="wdg-ico" title="Dupliquer" onclick="DTPWidgets.duplicate(' + idx + ')">' + ICO.dup + '</button>'
        +     '<button class="wdg-ico" title="Plein écran" onclick="DTPWidgets.fullscreen(' + idx + ')">' + ICO.expand + '</button>'
        +     '<button class="wdg-ico' + (locked ? ' on' : '') + '" title="' + (locked ? 'Déverrouiller' : 'Verrouiller') + '" onclick="DTPWidgets.toggleLock(' + idx + ')">' + (locked ? ICO.lock : ICO.unlock) + '</button>'
        +     '<button class="wdg-ico wdg-ico--x" title="Retirer" onclick="DTPWidgets.remove(' + idx + ')">' + ICO.close + '</button>'
        +   '</span>'
        + '</header>'
        + '<div class="wdg-pop wdg-settings" id="' + HOST_ID + '-s' + idx + '" hidden>'
        +   '<div class="wdg-pop-t">' + esc(w.name) + '</div><div class="wdg-pop-d">' + esc(w.desc) + '</div>'
        +   step('Largeur', it.gw + '/12', 'setGw') + step('Hauteur', it.gh, 'setGh')
        + '</div>'
        + '<div class="wdg-body" id="' + HOST_ID + '-b' + idx + '"></div>'
        + '<div class="wdg-resize" title="Glisser (coin) pour redimensionner"></div></section>';
    }).join('');
    // Plein écran : la carte ciblée recouvre la zone de travail (overlay), la grille est figée derrière.
    if (_fullscreenIdx != null) {
      var fsCard = host.querySelector('.wdg-card[data-idx="' + _fullscreenIdx + '"]');
      if (fsCard) { host.classList.add('wdg-fs-mode'); fsCard.classList.add('wdg-fs'); } else _fullscreenIdx = null;
    }
    if (_fullscreenIdx == null) host.classList.remove('wdg-fs-mode');
    // Rouvre le panneau réglages du widget qu'on vient d'ajuster (sinon il se referme à chaque clic).
    if (_reopen != null) { var sp = document.getElementById(HOST_ID + '-s' + _reopen); if (sp) sp.hidden = false; _reopen = null; }
    // MONTAGE APRÈS insertion et affichage : amCharts mesure 0×0 dans un conteneur caché.
    // JETON anti-course (23/07) : deux renderGrid rapprochés = deux rAF en file ; sans jeton, le rAF
    // PÉRIMÉ montait une 2e fois dans les nouveaux conteneurs (root amCharts / carte orphelins).
    var tok = ++_mountToken;
    requestAnimationFrame(function () {
      if (tok !== _mountToken) return;                       // un renderGrid plus récent a repris la main
      lay.items.forEach(function (it, idx) {
        var w = byId(it.w), body = document.getElementById(HOST_ID + '-b' + idx);
        if (!w || !body || body._wdgClean) return;            // _wdgClean : déjà monté par refresh() entre-temps
        try { var un = w.mount(body); if (typeof un === 'function') { STATE.mounted.push(un); body._wdgClean = un; } }
        catch (e) { fallback(body, 'Widget indisponible.'); }
      });
    });
  }
  function layoutById(id) {
    var c = STATE.cfg; if (!c) return null;
    for (var i = 0; i < c.layouts.length; i++) if (c.layouts[i].id === id) return c.layouts[i];
    return null;
  }
  // Onglets de layouts (templates) dans l'en-tête : clic = bascule, DOUBLE-CLIC = renommer (inline), ＋ = créer.
  function renderBar() {
    var el = document.getElementById('wdg-layouts'); var c = STATE.cfg;
    if (!el) return;
    if (!c || !c.layouts.length) { el.innerHTML = ''; return; }
    var tabs = c.layouts.map(function (l) {
      return '<button class="wdg-lay' + (l.id === c.active ? ' on' : '') + '" data-lay="' + l.id + '" title="' + esc(l.name) + ' — double-clic pour renommer"'
        + ' onclick="DTPWidgets.switchLayout(\'' + l.id + '\')" ondblclick="DTPWidgets.editTab(\'' + l.id + '\')">'
        + '<span class="wdg-lay-chv">›</span>'                                    // chevron › = grammaire nav ACTUS
        + (l.fav ? '<span class="wdg-lay-star">★</span>' : '')
        + '<span class="wdg-lay-name">' + esc(l.name) + '</span></button>';
    }).join('');
    el.innerHTML = tabs
      + (c.layouts.length < _LMAX
          ? '<button class="wdg-lay wdg-lay-add" title="Créer un layout" onclick="DTPWidgets.createLayout()">+</button>'
          : '');
  }
  // Renommage INLINE d'un onglet (double-clic) : le nom devient un champ, Entrée/blur valide, Échap annule.
  function editTab(id) {
    var l = layoutById(id); if (!l) return;
    var btn = document.querySelector('.wdg-lay[data-lay="' + id + '"]'); if (!btn) return;
    var span = btn.querySelector('.wdg-lay-name'); if (!span) return;
    var input = document.createElement('input');
    input.className = 'wdg-lay-edit';
    input.value = l.name; input.maxLength = 40; input.spellcheck = false;
    span.replaceWith(input);
    input.focus(); input.select();
    var done = false;
    var commit = function (keep) {
      if (done) return; done = true;
      if (keep) API.renameLayout(id, input.value);
      renderBar();
    };
    input.addEventListener('blur', function () { commit(true); });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      else if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });   // ne pas re-déclencher switchLayout
  }
  // Gestionnaire de layouts (overlay) : favori · renommer (inline) · ouvrir · supprimer (confirmation inline).
  function renderManager() {
    var box = document.getElementById('wdg-mgr-list'); var c = STATE.cfg;
    if (!box || !c) return;
    box.innerHTML = c.layouts.map(function (l) {
      var active = l.id === c.active;
      var del = (l.id === PROTECTED_ID)
        ? '<span class="wdg-mgr-lock" title="Desk par défaut — non supprimable">' + ICO.lock + '</span>'
        : (l.id === _delConfirm)
          ? '<button class="wdg-mgr-del confirm" onclick="DTPWidgets.deleteLayout(\'' + l.id + '\')">Supprimer ?</button>'
          : '<button class="wdg-mgr-del" title="Supprimer" onclick="DTPWidgets.askDelete(\'' + l.id + '\')">×</button>';
      return '<div class="wdg-mgr-row' + (active ? ' on' : '') + '">'
        + '<button class="wdg-mgr-star' + (l.fav ? ' on' : '') + '" title="Template par défaut (s\'ouvre à l\'arrivée sur Mon Desk)" onclick="DTPWidgets.toggleFav(\'' + l.id + '\')">★</button>'
        + _thumb(l.items)
        + '<input class="wdg-mgr-name" value="' + esc(l.name) + '" maxlength="40" spellcheck="false"'
        +   ' onchange="DTPWidgets.renameLayout(\'' + l.id + '\', this.value)">'
        + '<span class="wdg-mgr-count">' + l.items.length + ' widget' + (l.items.length > 1 ? 's' : '') + '</span>'
        + '<button class="wdg-mgr-open" onclick="DTPWidgets.switchLayout(\'' + l.id + '\')">' + (active ? 'Actif' : 'Ouvrir') + '</button>'
        + del + '</div>';
    }).join('')
      + (c.layouts.length < _LMAX
          ? '<button class="wdg-mgr-new" onclick="DTPWidgets.createLayout()">+ Créer un layout</button>'
          : '<div class="wdg-mgr-full">Plafond de ' + _LMAX + ' layouts atteint.</div>')
      // MODÈLES PRÊTS : agencements pré-composés — un clic crée un NOUVEAU layout (rien d'écrasé).
      + '<div class="wdg-lib-sec">Modèles prêts</div>'
      + PRESETS.map(function (p, i) {
          var names = p.items.map(function (it) { var w = byId(it.w); return w ? w.name : ''; }).filter(Boolean).join(' · ');
          return '<div class="wdg-mgr-row wdg-mgr-row--preset">'
            + _thumb(p.items)
            + '<span class="wdg-mgr-pname">' + esc(p.name) + '<em>' + esc(names) + '</em></span>'
            + '<button class="wdg-mgr-open" onclick="DTPWidgets.usePreset(' + i + ')"'
            + (c.layouts.length >= _LMAX ? ' disabled title="Plafond de layouts atteint"' : '') + '>Utiliser</button></div>';
        }).join('');
  }
  // Icônes de widget (dessins DTP originaux) — par id, repli sur l'icône de sa catégorie.
  var WICO = {
    'force-devises': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 6-8"/><path d="M18 6h3v3"/></svg>',
    'barometre': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 12v-5M9 12v-8M13 12v-3M17 12v-7M5 12v4M9 12v2M13 12v6M17 12v3"/><path d="M3 12h18" opacity=".45"/></svg>',
    'classement-devises': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 6h10M4 12h14M4 18h7"/><circle cx="20" cy="6" r="1.4" fill="currentColor" stroke="none"/></svg>',
    'risque-historique': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16c2-1 3-6 5-6s3 8 5 8 3-11 5-11 2 4 3 4"/></svg>',
    'calendrier-jour': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8 3.5v3M16 3.5v3"/></svg>',
    'radar-biais': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" opacity=".4"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
    'taux-cb': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M6 20V9l6-4 6 4v11"/><path d="M9 20v-5h6v5"/></svg>',
    'risque-jauge': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l4-4"/><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none"/></svg>',
    'cot-inst': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 12h7M13 12h7" opacity=".5"/><rect x="4" y="8" width="7" height="3.2" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="12.8" width="7" height="3.2" rx="1" fill="currentColor" stroke="none" opacity=".55"/></svg>',
    'dmx-retail': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M13.5 20c.3-2.3 1.8-3.6 3.5-3.6S20 17.7 20.5 20"/></svg>',
    'saison': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 12h18" opacity=".45"/><path d="M5 12V8M9 12v-4M9 12v3M13 12v-6M17 12V9M17 12v4M21 12v-2"/></svg>',
    'sessions': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>',
    'fil-news': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 6h14M5 10.5h14M5 15h9"/><circle cx="18.5" cy="17.5" r="2" /></svg>',
    'calculatrice': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 7.5h7"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/></svg>',
    'journal-mini': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z"/><path d="M6 3.5v17M9.5 8h5.5M9.5 12h5.5"/></svg>',
  };
  var _libQ = '';                            // filtre de recherche de la bibliothèque (volatil)
  function renderLib() {
    var box = document.getElementById('wdg-lib-grid'); if (!box) return;
    var lay = activeLayout(), used = {};
    (lay ? lay.items : []).forEach(function (i) { used[i.w] = (used[i.w] || 0) + 1; });
    var q = _libQ.toLowerCase();
    var match = function (w) { return !q || (w.name + ' ' + w.desc + ' ' + w.cat).toLowerCase().indexOf(q) !== -1; };
    // BIBLIOTHÈQUE PAR FAMILLES (demande user 23/07 : reprendre l'ORGANISATION du terminal PMT — 2 rails :
    // « Fonctions » = panneaux de données/outils qu'on consulte ; « Analytics » = panneaux d'analyse de marché.
    // Identité 100% DTP, aucune reprise visuelle PMT). FAM_OF mappe chaque widget à sa famille.
    var FAM_OF = {
      'force-devises': 'Analytics', 'barometre': 'Analytics', 'risque-historique': 'Analytics', 'radar-biais': 'Analytics',
      'risque-jauge': 'Analytics', 'cot-inst': 'Analytics', 'dmx-retail': 'Analytics', 'saison': 'Analytics', 'sessions': 'Analytics',
      'calendrier-jour': 'Fonctions', 'taux-cb': 'Fonctions', 'fil-news': 'Fonctions', 'journal-mini': 'Fonctions', 'calculatrice': 'Fonctions',
    };
    var FAMS = ['Analytics', 'Fonctions'];   // ordre d'affichage des 2 familles
    // GALERIE DE MODÈLES en TÊTE de la bibliothèque (demande user 23/07 : « on doit pouvoir choisir le template
    // en cliquant sur l'icône bibliothèque ») : chaque modèle = VIGNETTE d'agencement + NOM CENTRÉ DESSOUS —
    // jamais de nom à droite. Un clic crée un nouveau desk pré-composé (usePreset).
    var atMax = STATE.cfg && STATE.cfg.layouts.length >= _LMAX;
    var pmatch = function (p) { return !q || p.name.toLowerCase().indexOf(q) !== -1; };
    var tplCards = PRESETS.map(function (p, i) {
      if (!pmatch(p)) return '';
      return '<button class="wdg-tpl-card" onclick="DTPWidgets.usePreset(' + i + ')"'
        + (atMax ? ' disabled title="Plafond de layouts atteint"' : ' title="Créer un desk « ' + esc(p.name) + ' »"') + '>'
        + _thumb(p.items)
        + '<span class="wdg-tpl-name">' + esc(p.name) + '</span>'
        + '<span class="wdg-tpl-n">' + p.items.length + ' widgets</span></button>';
    }).join('');
    var tplHtml = PRESETS.some(pmatch) ? '<div class="wdg-lib-sec">Modèles prêts</div><div class="wdg-tpl-row">' + tplCards + '</div>' : '';

    var FAM_SUB = { Analytics: 'Analyse de marché', Fonctions: 'Données & outils' };
    var html = FAMS.map(function (fam) {
      var list = CATALOG.filter(function (w) { return (FAM_OF[w.id] || 'Fonctions') === fam && match(w); });
      if (!list.length) return '';
      var cards = list.map(function (w) {
        return '<button class="wdg-lib-card" onclick="DTPWidgets.add(\'' + w.id + '\')" title="Ajouter « ' + esc(w.name) + ' »">'
          + '<span class="wdg-lib-ico">' + (WICO[w.id] || '') + '</span>'
          + '<span class="wdg-lib-main"><span class="wdg-lib-name">' + esc(w.name) + '</span>'
          + '<span class="wdg-lib-desc">' + esc(w.desc) + '</span></span>'
          + (used[w.id] ? '<span class="wdg-lib-used">' + used[w.id] + '×</span>' : '<span class="wdg-lib-plus">+</span>')
          + '</button>';
      }).join('');
      return '<div class="wdg-lib-sec">' + esc(fam) + '<span class="wdg-lib-sub">' + esc(FAM_SUB[fam] || '') + '</span></div><div class="wdg-lib-row">' + cards + '</div>';
    }).join('');
    box.innerHTML = (tplHtml + html) || '<div class="wdg-empty">Rien ne correspond à « ' + esc(_libQ) + ' ».</div>';
  }

  /* ── MODÈLES PRÊTS (presets) : un clic → un nouveau layout pré-composé (modifiable ensuite). ── */
  var PRESETS = [
    // « Terminal » = cockpit multi-zones façon terminal pro (organisation PMT : gros panneau central + colonnes
    //  d'analytics et de fonctions autour), rendu en identité 100% DTP. Le modèle phare de Mon Desk.
    { name: 'Terminal', items: [
      { w: 'force-devises', gw: 8, gh: 12 }, { w: 'radar-biais', gw: 4, gh: 12 },
      { w: 'calendrier-jour', gw: 4, gh: 11 }, { w: 'fil-news', gw: 4, gh: 11 }, { w: 'taux-cb', gw: 4, gh: 11 },
      { w: 'barometre', gw: 6, gh: 8 }, { w: 'journal-mini', gw: 6, gh: 8 },
    ] },
    { name: 'Desk complet', items: [{ w: 'force-devises', gw: 8, gh: 12 }, { w: 'calendrier-jour', gw: 4, gh: 12 }, { w: 'fil-news', gw: 7, gh: 11 }, { w: 'barometre', gw: 5, gh: 11 }] },
    { name: 'Focus macro', items: [{ w: 'calendrier-jour', gw: 7, gh: 15 }, { w: 'radar-biais', gw: 5, gh: 8 }, { w: 'taux-cb', gw: 5, gh: 7 }] },
    { name: 'Trading actif', items: [{ w: 'journal-mini', gw: 7, gh: 12 }, { w: 'calculatrice', gw: 5, gh: 12 }, { w: 'force-devises', gw: 12, gh: 10 }] },
  ];
  // Miniature d'un agencement : la grille 12 colonnes en réduction (aperçu visuel, gestionnaire + modèles).
  function _thumb(items) {
    var blocks = (items || []).slice(0, 10).map(function (it) {
      it = _normItem(JSON.parse(JSON.stringify(it)));
      return '<i style="grid-column:span ' + it.gw + ';grid-row:span ' + Math.max(1, Math.min(4, Math.round(it.gh / 5))) + '"></i>';
    }).join('');
    return '<span class="wdg-thumb" aria-hidden="true">' + blocks + '</span>';
  }

  // Bascule un panneau overlay (info 'i' / réglages 's') d'une carte ; ferme tous les autres.
  function _togglePop(idx, kind) {
    var host = document.getElementById(HOST_ID); if (!host) return;
    var target = document.getElementById(HOST_ID + '-' + kind + idx);
    var willOpen = target && target.hidden;
    host.querySelectorAll('.wdg-pop').forEach(function (p) { p.hidden = true; });   // un seul ouvert à la fois
    if (target) target.hidden = !willOpen;
  }

  /* ── ACTIONS (exposées : les onclick du HTML généré les appellent) ── */
  var API = {
    open: function () {                                   // appelé par activateView('widgets')
      document.body.classList.add('wdg-mode');            // masque la nav principale (Mon Desk = espace autonome)
      // TEMPLATE PAR DÉFAUT (demande user 23/07) : à l'ARRIVÉE sur Mon Desk (icône/logo, chargement), on ouvre
      // le layout marqué ★ (par défaut) — pas le dernier utilisé. Sans ★ : dernier actif (comportement d'avant).
      var _applyDefault = function () {
        var c = STATE.cfg; if (!c) return;
        var fav = (c.layouts || []).find(function (l) { return l && l.fav; });
        if (fav) c.active = fav.id;
      };
      if (!STATE.booted) { STATE.booted = true; load().then(function () { _applyDefault(); renderBar(); renderGrid(); }); }
      else { _applyDefault(); renderBar(); renderGrid(); }
    },
    close: function () { document.body.classList.remove('wdg-mode'); unmountAll(); },   // restaure la nav + libère roots/timers
    exit: function () { if (typeof activateView === 'function') activateView('news'); }, // « ‹ Retour au desk » (la nav est masquée en mode Mon Desk)
    remove: function (i) { var l = activeLayout(); if (!l) return; l.items.splice(i, 1); save(); renderGrid(); },
    move: function (i, d) {
      var l = activeLayout(); if (!l) return;
      var j = i + d; if (j < 0 || j >= l.items.length) return;
      var t = l.items[i]; l.items[i] = l.items[j]; l.items[j] = t;
      _reopen = j; save(); renderGrid();                 // garde les réglages ouverts sur le widget déplacé
    },
    setGw: function (i, d) {
      var l = activeLayout(); if (!l || !l.items[i]) return; _normItem(l.items[i]);
      l.items[i].gw = _clamp(l.items[i].gw + d, 1, GRID_COLS); _reopen = i; save(); renderGrid();
    },
    setGh: function (i, d) {
      var l = activeLayout(); if (!l || !l.items[i]) return; _normItem(l.items[i]);
      l.items[i].gh = _clamp(l.items[i].gh + d * 2, 3, 60); _reopen = i; save(); renderGrid();
    },
    duplicate: function (i) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var copy = JSON.parse(JSON.stringify(l.items[i])); copy.locked = false;
      l.items.splice(i + 1, 0, copy); save(); renderGrid();
    },
    toggleLock: function (i) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      l.items[i].locked = !l.items[i].locked; save(); renderGrid();
    },
    refresh: function (i) {                                  // re-monte CE widget seul (rafraîchit sa donnée)
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var w = byId(l.items[i].w), body = document.getElementById(HOST_ID + '-b' + i); if (!w || !body) return;
      var card = body.closest('.wdg-card'); if (card) { card.classList.remove('wdg-refresh'); void card.offsetWidth; card.classList.add('wdg-refresh'); }
      // Exécute d'ABORD le cleanup de l'ancien montage (root amCharts / carte Leaflet / timers / listeners)
      // — sans ça, chaque « Actualiser » orphelinait l'instance précédente jusqu'au prochain renderGrid.
      if (body._wdgClean) { try { body._wdgClean(); } catch (e) {} STATE.mounted = STATE.mounted.filter(function (f) { return f !== body._wdgClean; }); body._wdgClean = null; }
      body.innerHTML = ''; try { var un = w.mount(body); if (typeof un === 'function') { STATE.mounted.push(un); body._wdgClean = un; } } catch (e) {}
    },
    fullscreen: function (i) { _fullscreenIdx = (_fullscreenIdx === i ? null : i); renderGrid(); },
    toggleInfo: function (i) { _togglePop(i, 'i'); },
    toggleSettings: function (i) { _togglePop(i, 's'); },
    add: function (wid) {
      var l = activeLayout(), w = byId(wid); if (!l || !w) return;
      l.items.push({ w: wid, gw: 6, gh: _clamp(Math.round((w.h || 300) / ROW_PX) + 1, 5, 40) }); save(); API.closeLib(); renderGrid();
    },
    openLib: function () {
      var d = document.getElementById('wdg-lib'); if (!d) return;
      d.classList.add('open'); _libQ = '';
      var s = document.getElementById('wdg-lib-search'); if (s) { s.value = ''; setTimeout(function () { s.focus(); }, 60); }
      renderLib();
    },
    closeLib: function () { var d = document.getElementById('wdg-lib'); if (d) d.classList.remove('open'); },
    filterLib: function (q) { _libQ = String(q || '').trim(); renderLib(); },

    // ── MODÈLES PRÊTS : crée un NOUVEAU layout depuis le preset (jamais d'écrasement) et l'ouvre. ──
    usePreset: function (i) {
      var c = STATE.cfg, p = PRESETS[i]; if (!c || !p || c.layouts.length >= _LMAX) return;
      var id = 'lay-' + uid();
      c.layouts.push({ id: id, name: p.name, fav: false, items: JSON.parse(JSON.stringify(p.items)) });
      c.active = id; save(); API.closeManager(); API.closeLib(); renderBar(); renderGrid();   // depuis la biblio OU le gestionnaire → fermer les deux
    },

    // ── EXPORT / IMPORT de la configuration (fichier JSON : sauvegarde personnelle / passage de compte) ──
    exportCfg: function () {
      var c = STATE.cfg; if (!c) return;
      var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
      var name = 'mon-desk-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
      var blob = new Blob([JSON.stringify({ dtpWidgets: 1, cfg: c }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    },
    importCfg: function (input) {                       // AJOUTE les layouts du fichier (rien d'écrasé, plafond respecté)
      var f = input && input.files && input.files[0]; if (!f) return;
      var slot = document.getElementById('wdg-mgr-bak');
      var note = function (msg) { if (slot) { var n = document.createElement('div'); n.className = 'wdg-mgr-note'; n.textContent = msg; slot.parentNode.insertBefore(n, slot); setTimeout(function () { n.remove(); }, 6000); } };
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var j = JSON.parse(String(rd.result || ''));
          var lays = (j && j.cfg && j.cfg.layouts) || (j && j.layouts) || null;
          if (!Array.isArray(lays) || !lays.length) { note('Fichier non reconnu (export Mon Desk attendu).'); return; }
          var c = STATE.cfg, added = 0;
          lays.forEach(function (l) {
            if (!l || !Array.isArray(l.items) || c.layouts.length >= _LMAX) return;
            var items = l.items.filter(function (it) { return it && byId(it.w); }).map(function (it) {
              return _normItem({ w: it.w, gw: it.gw, gh: it.gh, h: it.h, col: it.col, locked: !!it.locked });
            });
            c.layouts.push({ id: 'lay-' + uid(), name: String(l.name || '').replace(/[<>"']/g, '').trim().slice(0, 40) || 'Importé', fav: false, items: items });
            added++;
          });
          if (added) { save(); renderBar(); renderManager(); note(added + ' layout' + (added > 1 ? 's' : '') + ' importé' + (added > 1 ? 's' : '') + ' ✓'); }
          else note('Rien à importer (plafond atteint ou widgets inconnus).');
        } catch (e) { note('Fichier illisible (JSON attendu).'); }
        input.value = '';
      };
      rd.readAsText(f);
    },

    // ── LAYOUTS (templates) ──
    switchLayout: function (id) {
      var c = STATE.cfg; if (!c || !layoutById(id)) return;
      _delConfirm = null; c.active = id; save(); renderBar(); renderManager(); renderGrid();
    },
    createLayout: function () {
      var c = STATE.cfg; if (!c || c.layouts.length >= _LMAX) return;
      _delConfirm = null;
      var id = 'lay-' + uid();
      c.layouts.push({ id: id, name: 'Nouveau layout', fav: false, items: [] });
      c.active = id; save(); renderBar(); renderManager(); renderGrid();
      setTimeout(function () { editTab(id); }, 60);   // le NOM passe direct en édition (demande user : renommer l'onglet à la création)
    },
    renameLayout: function (id, name) {
      var l = layoutById(id); if (!l) return;
      l.name = String(name || '').replace(/[<>]/g, '').trim().slice(0, 40) || 'Sans nom';   // même règle que le serveur
      save(); renderBar(); renderManager();
    },
    toggleFav: function (id) {
      // ★ = TEMPLATE PAR DÉFAUT (exclusif, demande user 23/07) : une seule étoile — la poser sur un layout la
      // retire des autres ; re-cliquer la retire (→ retour au comportement « dernier utilisé »).
      var l = layoutById(id); if (!l) return;
      _delConfirm = null;
      var was = !!l.fav;
      (STATE.cfg.layouts || []).forEach(function (x) { x.fav = false; });
      l.fav = !was;
      save(); renderBar(); renderManager();
    },
    askDelete: function (id) { if (id === PROTECTED_ID) return; _delConfirm = id; renderManager(); },   // 1er clic : confirmation inline (jamais pour le desk par défaut)
    deleteLayout: function (id) {
      var c = STATE.cfg; if (!c) return;
      _delConfirm = null;
      if (id === PROTECTED_ID) return;                                       // desk par défaut = NON supprimable
      if (c.layouts.length <= 1) { API.reset(); API.openManager(); return; } // jamais 0 layout → retour au défaut
      c.layouts = c.layouts.filter(function (l) { return l.id !== id; });
      if (c.active === id) c.active = c.layouts[0].id;
      save(); renderBar(); renderManager(); renderGrid();
    },
    openManager: function () {
      var d = document.getElementById('wdg-mgr'); if (!d) return;
      _delConfirm = null; d.classList.add('open'); renderManager();
      // SAUVEGARDE PAR COMPTE (demande user « récupérable si un souci s'impose ») : affiche la date du
      // snapshot serveur + bouton Restaurer (réversible : la config courante devient la sauvegarde).
      var slot = document.getElementById('wdg-mgr-bak');
      if (!slot) { slot = document.createElement('div'); slot.id = 'wdg-mgr-bak'; slot.className = 'wdg-mgr-bak'; var foot = d.querySelector('.wdg-mgr-foot'); if (foot) foot.insertBefore(slot, foot.firstChild); }
      slot.innerHTML = '';
      fetch('/api/widgets/backup').then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.at || !slot.isConnected) return;
        var dt = new Date(j.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        slot.innerHTML = '<span class="wdg-mgr-bak-lbl">Sauvegarde auto du ' + esc(dt) + '</span>'
          + '<button class="wdg-btn" onclick="DTPWidgets.restoreBackup()" title="Revenir à cette sauvegarde (réversible : l\'état actuel devient la sauvegarde)">Restaurer</button>';
      }).catch(function () {});
    },
    restoreBackup: function () {
      fetch('/api/widgets/restore', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok || !j.cfg) return;
        STATE.cfg = j.cfg;
        renderBar(); renderManager(); renderGrid();
        API.openManager();   // rafraîchit la date de sauvegarde (désormais = l'ancien état courant, ré-échangeable)
      }).catch(function () {});
    },
    closeManager: function () { var d = document.getElementById('wdg-mgr'); if (d) d.classList.remove('open'); },
    editTab: editTab,                                     // double-clic sur un onglet → renommage inline

    reset: function () { _delConfirm = null; STATE.cfg = defaultCfg(); save(); renderBar(); renderManager(); renderGrid(); },
  };
  window.DTPWidgets = API;

  /* ── AMORÇAGE ──────────────────────────────────────────────────────────────────────────────────
     L'ICÔNE n'est créée QUE pour l'admin : tant que le système n'est pas validé, aucun client ne la
     voit. Le desk reste STRICTEMENT inchangé pour tous les autres comptes.
     Entrée = une icône TOPBAR (même convention que Journal / Calculatrice), placée à LEUR GAUCHE. */
  function boot() {
    if (document.getElementById('widgets-btn')) return;                      // déjà posée
    var journal = document.getElementById('journal-btn');
    var center = journal && journal.parentNode;                              // .topbar-center
    if (!center) return;
    var icon = document.createElement('div');
    icon.id = 'widgets-btn';
    icon.className = 'topbar-icon topbar-icon--desk';                        // hérite du style topbar (dont --active or)
    icon.title = 'Mon Desk — mes widgets';
    icon.setAttribute('role', 'button');
    // Icône « tableau de bord / template » (panneaux composables) — dessin DTP original.
    // Marges internes ALIGNÉES sur Journal/Calc (glyphe x=4→20 dans le viewBox 24, comme eux) → écart
    // OPTIQUE égal entre les 3 icônes de la topbar (demande user 23/07 ; avant : x=3→21, glyphe plus large).
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24">'
      + '<rect x="4" y="4" width="7" height="7" rx="1.5" fill="currentColor" opacity=".2"/>'
      + '<rect x="4" y="4" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<rect x="13" y="4" width="7" height="4.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<rect x="13" y="10.5" width="7" height="9.5" rx="1.5" fill="currentColor" opacity=".2"/>'
      + '<rect x="13" y="10.5" width="7" height="9.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<rect x="4" y="13" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    // Badge « NOUVEAU » : pastille or coin haut-droit, pulse subtil ×3 puis statique. Affiché pendant les
    // 20 PREMIÈRES CONNEXIONS au desk de chaque compte (demande user 23/07) : le GET /api/widgets-new-seen
    // incrémente le compteur serveur à chaque chargement et répond seen=true au-delà de 20. Le clic ne
    // masque le badge que pour la SESSION en cours (aucun POST) — il revient tant que la fenêtre court.
    var badge = document.createElement('span');
    badge.className = 'topbar-new-badge wdg-new-badge';
    badge.textContent = 'NOUVEAU';
    badge.style.display = 'none';
    icon.appendChild(badge);
    fetch('/api/widgets-new-seen').then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.seen === false) { badge.style.display = ''; badge.classList.add('pulse'); }
    }).catch(function () {});
    // TOGGLE (23/07) : la nav principale est MASQUÉE en mode Mon Desk (dashboard autonome, demande user)
    // → l'icône fait entrer ET sortir (re-clic = retour au fil d'actus).
    icon.addEventListener('click', function () {
      badge.style.display = 'none';                           // confort visuel : masqué pour cette session
      if (typeof activateView !== 'function') return;
      activateView(document.body.classList.contains('wdg-mode') ? 'news' : 'widgets');
    });
    center.insertBefore(icon, journal);                                      // à GAUCHE de Journal / Calculatrice
    // PRÉCHARGE la config (léger) → hasDefault() connu sans ouvrir Mon Desk (sert au clic sur le LOGO).
    if (!STATE.cfg) load().catch(function () {});
    // LOGO → TEMPLATE PAR DÉFAUT (demande user 23/07) : si un layout ★ existe, cliquer le logo
    // DataTradingPro atterrit sur Mon Desk (open() y applique le ★). Sans ★ : le logo reste inerte.
    var logo = document.querySelector('.logo-text');
    if (logo && !logo._wdgWired) {
      logo._wdgWired = true;
      logo.style.cursor = 'pointer';
      logo.addEventListener('click', function () {
        var hasFav = !!(STATE.cfg && (STATE.cfg.layouts || []).some(function (l) { return l && l.fav; }));
        if (hasFav && typeof activateView === 'function') activateView('widgets');
      });
    }
    // Rechargement ADMIN sur Mon Desk : le boot restore de charts.js l'a neutralisé par sécurité
    // (dtp_active_view='widgets' → 'news', car _pdIsAdmin n'y était pas encore résolu). ICI, boot() ne
    // tourne QUE pour un admin (poll _pdIsAdmin) → on peut rouvrir. La garde d'activateView
    // (view==='widgets' && !_pdIsAdmin) laisse passer puisque _pdIsAdmin est désormais vrai.
    try {
      if (localStorage.getItem('dtp_active_view') === 'widgets' && typeof activateView === 'function') activateView('widgets');
    } catch (e) {}
  }
  // Le flag arrive dans le .then() de /api/auth/me → on sonde jusqu'à ~10 s, puis on renonce (aucun onglet).
  var tries = 0;
  var iv = setInterval(function () {
    if (window._pdIsAdmin) { clearInterval(iv); boot(); }
    else if (++tries > 20) clearInterval(iv);
  }, 500);
})();

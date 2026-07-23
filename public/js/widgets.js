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
        host.innerHTML = '<div class="wdg-load">Chargement…</div>';
        fetch('/api/journal').then(function (r) { return r.json(); }).then(function (j) {
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
          var wins = 0, losses = 0, cum = 0, cumOk = true;
          entries.forEach(function (e) {
            var p = pnlOf(e), res = String(fld(e, 'result', /r[ée]sultat|result|issue|outcome/i) || '');
            if (p && p.n !== 0) { if (p.n > 0) wins++; else losses++; }
            else if (/tp|profit|win|gagn/i.test(res)) wins++;
            else if (/\bsl\b|loss|perte|perd/i.test(res)) losses++;
            var m = num(e.pl); if (m != null) cum += m; else cumOk = false;   // cumul $ seulement si TOUTES les lignes l'ont
          });
          var tot = wins + losses;
          var wr = tot ? Math.round(wins / tot * 100) : null;

          // ── COURBE DE CAPITAL (comme le vrai Journal du desk _jrBuildEquityChart) : Capital = capital de
          //    départ + cumul des $PNL si dispo, sinon cumul $PNL, sinon cumul R, sinon cumul %. Points {t,v}
          //    triés par date. amCharts (globaux) → root disposé au démontage (cleanup renvoyé par mount).
          var startCap = num(j && j.startCap);
          var eqLabel = 'P&L cumulé', eqUnit = ' $', eqMode = 'pl';
          var haveField = function (getter) { return entries.some(function (e) { return getter(e) != null; }); };
          if (startCap != null && startCap > 0 && haveField(function (e) { return num(e.pl); })) { eqMode = 'cap'; eqLabel = 'Capital'; }
          else if (haveField(function (e) { return num(e.pl); })) { eqMode = 'pl'; eqLabel = 'P&L cumulé'; eqUnit = ' $'; }
          else if (haveField(function (e) { return num(e.r); })) { eqMode = 'r'; eqLabel = 'R cumulé'; eqUnit = ' R'; }
          else if (haveField(function (e) { return num(e.pnlPct); })) { eqMode = 'pct'; eqLabel = '% cumulé'; eqUnit = ' %'; }
          else { eqMode = null; }
          var eqData = [];
          if (eqMode) {
            var valOf = function (e) { return eqMode === 'r' ? num(e.r) : eqMode === 'pct' ? num(e.pnlPct) : num(e.pl); };
            var chron = entries.filter(function (e) { return valOf(e) != null && e.ts; }).sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
            var run = (eqMode === 'cap') ? startCap : 0;
            var fmtV = function (v) { return (eqMode === 'cap' ? '' : (v > 0 ? '+' : '')) + (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + eqUnit; };
            for (var ci = 0; ci < chron.length; ci++) {
              var prevV = run; run += (valOf(chron[ci]) || 0);
              eqData.push({ t: chron[ci].ts, v: Math.round(run * 100) / 100, vLbl: fmtV(run), dLbl: fmtD(chron[ci].ts), varLbl: 'Variation : ' + fmtV(run - prevV) });
            }
          }

          // TOUT le journal DANS le widget (demande user) : liste complète scrollable (cap 100 anti-OOM),
          // PLUS RÉCENT EN HAUT (tri par date réelle — même ordre que le vrai Journal du desk).
          var rows = entries.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 100).map(function (e) {
            var dts = e.ts;
            if (!dts) { var dv = prop(e, /date|jour/i); if (dv) { var dd = new Date(dv); if (isFinite(dd.getTime())) dts = dd.getTime(); } }
            var pair = fld(e, 'pair', /paire|pair|symbol|instrument|actif/i) || '';
            var dir = String(fld(e, 'dir', /^(sens|dir(ection)?|side|type)$/i) || '');
            var dirHtml = /buy|long|achat/i.test(dir) ? '<span class="wdg-jr-tag buy">ACHAT</span>'
              : /sell|short|vente/i.test(dir) ? '<span class="wdg-jr-tag sell">VENTE</span>'
              : (dir ? '<span class="wdg-jr-tag">' + esc(dir.toUpperCase().slice(0, 8)) + '</span>' : '<i class="wdg-jr-ph">—</i>');
            var res = String(fld(e, 'result', /r[ée]sultat|result|issue|outcome/i) || '');
            var resCls = /tp|profit|win|gagn/i.test(res) ? 'tp' : /\bbe\b|breakeven/i.test(res) ? 'be' : /\bsl\b|loss|perte|perd/i.test(res) ? 'sl' : '';
            var resHtml = res ? '<span class="wdg-jr-tag ' + resCls + '">' + esc(res.toUpperCase().slice(0, 10)) + '</span>' : '<i class="wdg-jr-ph">—</i>';
            var p = pnlOf(e);
            var pCls = p ? (p.n > 0 ? 'up' : p.n < 0 ? 'down' : '') : '';
            return '<div class="wdg-jr-row">'
              + '<span class="wdg-jr-date">' + (dts ? esc(fmtD(dts)) : '—') + '</span>'
              + '<span class="wdg-jr-pair" title="' + esc(pair) + '">' + esc(pair) + '</span>'
              + '<span class="wdg-jr-side">' + dirHtml + '</span>'
              + '<span class="wdg-jr-restag">' + resHtml + '</span>'
              + '<span class="wdg-jr-res ' + pCls + '">' + (p ? esc(p.txt) : '—') + '</span></div>';
          }).join('');
          var lastEq = eqData.length ? eqData[eqData.length - 1].v : null;
          host.innerHTML = '<div class="wdg-jr">'
            + '<div class="wdg-jr-stats"><span><b>' + entries.length + '</b> trade' + (entries.length > 1 ? 's' : '') + '</span>'
            + (wr != null ? '<span>Réussite <b class="' + (wr >= 50 ? 'up' : 'down') + '">' + wr + ' %</b></span>' : '')
            + (cumOk && entries.length ? '<span>P&amp;L <b class="' + (cum > 0 ? 'up' : cum < 0 ? 'down' : '') + '">' + esc(fmtMoney(cum)) + '</b></span>' : '')
            + '</div>'
            + (eqData.length >= 2
                ? '<div class="wdg-jr-chartwrap"><div class="wdg-jr-chartlbl"><span>' + eqLabel + '</span>'
                  + (lastEq != null ? '<b class="' + (eqMode === 'cap' ? '' : (lastEq > 0 ? 'up' : lastEq < 0 ? 'down' : '')) + '">' + esc(eqData[eqData.length - 1].vLbl) + '</b>' : '')
                  + '</div><div class="wdg-jr-chart" id="' + chartId + '"></div></div>'
                : '')
            + '<div class="wdg-jr-head"><span>Date</span><span>Paire</span><span>Sens</span><span>Résultat</span><span class="r">P&amp;L</span></div>'
            + '<div class="wdg-jr-list custom-scrollbar">' + rows + '</div></div>';
          // Montage APRÈS insertion + affichage (amCharts mesure 0×0 dans un conteneur caché).
          if (eqData.length >= 2) requestAnimationFrame(function () { _wdgJrEquityChart(chartId, eqData); });
        }).catch(function () { fallback(host, 'Journal indisponible.'); });
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
  function load() {
    return fetch('/api/widgets').then(function (r) { return r.json(); }).then(function (j) {
      STATE.cfg = (j && j.cfg && j.cfg.layouts && j.cfg.layouts.length) ? j.cfg : defaultCfg();
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
    requestAnimationFrame(function () {
      lay.items.forEach(function (it, idx) {
        var w = byId(it.w), body = document.getElementById(HOST_ID + '-b' + idx);
        if (!w || !body) return;
        try { var un = w.mount(body); if (typeof un === 'function') STATE.mounted.push(un); }
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
      var del = (l.id === _delConfirm)
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
      body.innerHTML = ''; try { var un = w.mount(body); if (typeof un === 'function') STATE.mounted.push(un); } catch (e) {}
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
    askDelete: function (id) { _delConfirm = id; renderManager(); },        // 1er clic : demande confirmation inline
    deleteLayout: function (id) {
      var c = STATE.cfg; if (!c) return;
      _delConfirm = null;
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
    // TOGGLE (23/07) : la nav principale est MASQUÉE en mode Mon Desk (dashboard autonome, demande user)
    // → l'icône fait entrer ET sortir (re-clic = retour au fil d'actus).
    icon.addEventListener('click', function () {
      if (typeof activateView !== 'function') return;
      activateView(document.body.classList.contains('wdg-mode') ? 'news' : 'widgets');
    });
    center.insertBefore(icon, journal);                                      // à GAUCHE de Journal / Calculatrice
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

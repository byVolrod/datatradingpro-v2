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

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
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
    {
      id: 'classement-devises', name: 'Classement des Devises', cat: 'Devises', h: 300,
      desc: 'Le classement de force des 8 majeures, de la plus forte à la plus faible.',
      // Réutilise buildStrengthSnapshot(containerId, data) du desk (liste .cs-rank-*), alimenté par
      // /api/currency-strength (même source que la Force des Devises).
      mount: function (host) {
        var id = HOST_ID + '-cs-' + uid();
        host.innerHTML = '<div id="' + id + '" class="wdg-cs-wrap"></div>';
        if (typeof buildStrengthSnapshot !== 'function') { fallback(host, 'Classement indisponible.'); return null; }
        fetch('/api/currency-strength?period=week').then(function (r) { return r.json(); }).then(function (d) {
          if (!document.getElementById(id)) return;                        // widget retiré pendant le fetch
          if (!d || !d.currencies || !d.series) return fallback(host, 'Classement indisponible.');
          try { buildStrengthSnapshot(id, d); } catch (e) { fallback(host, 'Classement indisponible.'); }
        }).catch(function () { fallback(host, 'Classement indisponible.'); });
        return null;
      },
    },
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
          + '<div class="wdg-calc-note">Position = (capital × risque %) ÷ (stop × valeur du pip). <button class="wdg-calc-open" type="button">Calculatrice complète ›</button></div>'
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
        var open = host.querySelector('.wdg-calc-open');
        if (open) open.addEventListener('click', function () { if (typeof activateView === 'function') activateView('calculator'); });
        compute();
        return null;
      },
    },
    {
      id: 'journal-mini', name: 'Journal de trading', cat: 'Outils', h: 300,
      desc: 'Tes derniers trades et ton taux de réussite, en un coup d\'œil.',
      // Lecture seule de /api/journal (source de vérité du compte). Détection SOUPLE des colonnes (gabarit DTP
      // OU journal importé) : paire / sens / résultat / P&L par alias — jamais de valeur inventée.
      mount: function (host) {
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
          var keys = Object.keys(entries[0] || {});
          var find = function (rx) { for (var i = 0; i < keys.length; i++) if (rx.test(keys[i])) return keys[i]; return null; };
          var kDate = find(/date|jour/i), kPair = find(/paire|pair|symbol|instrument|actif/i),
              kSide = find(/sens|side|direction|\btype\b/i), kRes = find(/r[ée]sultat|result|issue|outcome/i),
              kPnl = find(/pnl|p&l|profit|gain|\$/i);
          var wins = 0, losses = 0;
          entries.forEach(function (e) {
            var pnl = kPnl ? parseFloat(String(e[kPnl]).replace(/[^0-9.\-]/g, '')) : NaN;
            var res = kRes ? String(e[kRes]) : '';
            if (isFinite(pnl) && pnl !== 0) { if (pnl > 0) wins++; else losses++; }
            else if (/tp|profit|win|gagn/i.test(res)) wins++;
            else if (/\bsl\b|loss|perte|perd/i.test(res)) losses++;
          });
          var tot = wins + losses;
          var wr = tot ? Math.round(wins / tot * 100) : null;
          var rows = entries.slice(-6).reverse().map(function (e) {
            var pnl = kPnl ? parseFloat(String(e[kPnl]).replace(/[^0-9.\-]/g, '')) : NaN;
            var res = kRes ? String(e[kRes] || '') : '';
            var good = (isFinite(pnl) && pnl > 0) || /tp|profit|win|gagn/i.test(res);
            var bad = (isFinite(pnl) && pnl < 0) || /\bsl\b|loss|perte|perd/i.test(res);
            var cls = good ? 'up' : bad ? 'down' : '';
            var resTxt = isFinite(pnl) && pnl !== 0 ? ((pnl > 0 ? '+' : '') + pnl) : (res || '—');
            return '<div class="wdg-jr-row">'
              + '<span class="wdg-jr-date">' + esc(kDate ? e[kDate] : '') + '</span>'
              + '<span class="wdg-jr-pair">' + esc(kPair ? e[kPair] : '') + '</span>'
              + '<span class="wdg-jr-side">' + esc(kSide ? e[kSide] : '') + '</span>'
              + '<span class="wdg-jr-res ' + cls + '">' + esc(resTxt) + '</span></div>';
          }).join('');
          host.innerHTML = '<div class="wdg-jr">'
            + '<div class="wdg-jr-stats"><span><b>' + entries.length + '</b> trade' + (entries.length > 1 ? 's' : '') + '</span>'
            + (wr != null ? '<span>Réussite <b class="' + (wr >= 50 ? 'up' : 'down') + '">' + wr + ' %</b></span>' : '')
            + '<button class="wdg-jr-openbtn" type="button">Ouvrir ›</button></div>'
            + '<div class="wdg-jr-list custom-scrollbar">' + rows + '</div></div>';
          var b = host.querySelector('.wdg-jr-openbtn');
          if (b) b.addEventListener('click', function () { if (typeof activateView === 'function') activateView('journal'); });
        }).catch(function () { fallback(host, 'Journal indisponible.'); });
        return null;
      },
    },
  ];

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
        + '<button class="wdg-mgr-star' + (l.fav ? ' on' : '') + '" title="Favori" onclick="DTPWidgets.toggleFav(\'' + l.id + '\')">★</button>'
        + '<input class="wdg-mgr-name" value="' + esc(l.name) + '" maxlength="40" spellcheck="false"'
        +   ' onchange="DTPWidgets.renameLayout(\'' + l.id + '\', this.value)">'
        + '<span class="wdg-mgr-count">' + l.items.length + ' widget' + (l.items.length > 1 ? 's' : '') + '</span>'
        + '<button class="wdg-mgr-open" onclick="DTPWidgets.switchLayout(\'' + l.id + '\')">' + (active ? 'Actif' : 'Ouvrir') + '</button>'
        + del + '</div>';
    }).join('')
      + (c.layouts.length < _LMAX
          ? '<button class="wdg-mgr-new" onclick="DTPWidgets.createLayout()">+ Créer un layout</button>'
          : '<div class="wdg-mgr-full">Plafond de ' + _LMAX + ' layouts atteint.</div>');
  }
  // Icônes de widget (dessins DTP originaux) — par id, repli sur l'icône de sa catégorie.
  var WICO = {
    'force-devises': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 6-8"/><path d="M18 6h3v3"/></svg>',
    'barometre': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 12v-5M9 12v-8M13 12v-3M17 12v-7M5 12v4M9 12v2M13 12v6M17 12v3"/><path d="M3 12h18" opacity=".45"/></svg>',
    'classement-devises': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 6h10M4 12h14M4 18h7"/><circle cx="20" cy="6" r="1.4" fill="currentColor" stroke="none"/></svg>',
    'risque-historique': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16c2-1 3-6 5-6s3 8 5 8 3-11 5-11 2 4 3 4"/></svg>',
    'calendrier-jour': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8 3.5v3M16 3.5v3"/></svg>',
    'fil-news': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 6h14M5 10.5h14M5 15h9"/><circle cx="18.5" cy="17.5" r="2" /></svg>',
    'calculatrice': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 7.5h7"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/></svg>',
    'journal-mini': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z"/><path d="M6 3.5v17M9.5 8h5.5M9.5 12h5.5"/></svg>',
  };
  function renderLib() {
    var box = document.getElementById('wdg-lib-grid'); if (!box) return;
    var lay = activeLayout(), used = {};
    (lay ? lay.items : []).forEach(function (i) { used[i.w] = (used[i.w] || 0) + 1; });
    // GROUPÉE PAR CATÉGORIE (ordre d'apparition du catalogue) : un intitulé de section + les cartes de la famille.
    var cats = [];
    CATALOG.forEach(function (w) { if (cats.indexOf(w.cat) === -1) cats.push(w.cat); });
    box.innerHTML = cats.map(function (cat) {
      var cards = CATALOG.filter(function (w) { return w.cat === cat; }).map(function (w) {
        return '<button class="wdg-lib-card" onclick="DTPWidgets.add(\'' + w.id + '\')" title="Ajouter « ' + esc(w.name) + ' »">'
          + '<span class="wdg-lib-ico">' + (WICO[w.id] || '') + '</span>'
          + '<span class="wdg-lib-main"><span class="wdg-lib-name">' + esc(w.name) + '</span>'
          + '<span class="wdg-lib-desc">' + esc(w.desc) + '</span></span>'
          + (used[w.id] ? '<span class="wdg-lib-used">' + used[w.id] + '×</span>' : '<span class="wdg-lib-plus">+</span>')
          + '</button>';
      }).join('');
      return '<div class="wdg-lib-sec">' + esc(cat) + '</div><div class="wdg-lib-row">' + cards + '</div>';
    }).join('');
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
      document.body.classList.add('wdg-mode');            // masque la nav principale → la barre Mon Desk la REMPLACE (demande user)
      if (!STATE.booted) { STATE.booted = true; load().then(function () { renderBar(); renderGrid(); }); }
      else { renderBar(); renderGrid(); }
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
    openLib: function () { var d = document.getElementById('wdg-lib'); if (d) { d.classList.add('open'); renderLib(); } },
    closeLib: function () { var d = document.getElementById('wdg-lib'); if (d) d.classList.remove('open'); },

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
      var l = layoutById(id); if (!l) return;
      _delConfirm = null; l.fav = !l.fav; save(); renderBar(); renderManager();
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
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24">'
      + '<rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" opacity=".2"/>'
      + '<rect x="3" y="3" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<rect x="13" y="3" width="8" height="5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<rect x="13" y="10.5" width="8" height="10.5" rx="1.5" fill="currentColor" opacity=".2"/>'
      + '<rect x="13" y="10.5" width="8" height="10.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<rect x="3" y="13" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    icon.addEventListener('click', function () { if (typeof activateView === 'function') activateView('widgets'); });
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

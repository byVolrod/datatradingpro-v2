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
          { w: 'force-devises', h: 300, col: 2 },
          { w: 'calendrier-jour', h: 280, col: 1 },
          { w: 'fil-news', h: 280, col: 1 },
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
  function renderGrid() {
    var host = document.getElementById(HOST_ID); if (!host) return;
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
      return '<section class="wdg-card' + (it.col === 2 ? ' wdg-card--full' : '') + '" style="--wdg-h:' + it.h + 'px;">'
        + '<header class="wdg-head"><span class="wdg-title">' + esc(w.name) + '</span>'
        + '<span class="wdg-actions">'
        + '<button class="wdg-ico" title="Demi-largeur / pleine largeur" onclick="DTPWidgets.toggleCol(' + idx + ')">⇔</button>'
        + '<button class="wdg-ico" title="Monter" onclick="DTPWidgets.move(' + idx + ',-1)">↑</button>'
        + '<button class="wdg-ico" title="Descendre" onclick="DTPWidgets.move(' + idx + ',1)">↓</button>'
        + '<button class="wdg-ico wdg-ico--x" title="Retirer" onclick="DTPWidgets.remove(' + idx + ')">×</button>'
        + '</span></header><div class="wdg-body" id="' + HOST_ID + '-b' + idx + '"></div></section>';
    }).join('');
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
  function renderBar() {
    var el = document.getElementById('wdg-bar-name'), lay = activeLayout();
    if (el) el.textContent = lay ? lay.name : '—';
  }
  function renderLib() {
    var box = document.getElementById('wdg-lib-grid'); if (!box) return;
    var lay = activeLayout(), used = {};
    (lay ? lay.items : []).forEach(function (i) { used[i.w] = (used[i.w] || 0) + 1; });
    box.innerHTML = CATALOG.map(function (w) {
      return '<button class="wdg-lib-card" onclick="DTPWidgets.add(\'' + w.id + '\')">'
        + '<span class="wdg-lib-cat">' + esc(w.cat) + '</span>'
        + '<span class="wdg-lib-name">' + esc(w.name) + '</span>'
        + '<span class="wdg-lib-desc">' + esc(w.desc) + '</span>'
        + (used[w.id] ? '<span class="wdg-lib-used">déjà ' + used[w.id] + '×</span>' : '')
        + '</button>';
    }).join('');
  }

  /* ── ACTIONS (exposées : les onclick du HTML généré les appellent) ── */
  var API = {
    open: function () {                                   // appelé par activateView('widgets')
      if (!STATE.booted) { STATE.booted = true; load().then(function () { renderBar(); renderGrid(); }); }
      else { renderBar(); renderGrid(); }
    },
    close: function () { unmountAll(); },                 // libère roots amCharts + timers en quittant l'onglet
    remove: function (i) { var l = activeLayout(); if (!l) return; l.items.splice(i, 1); save(); renderGrid(); },
    move: function (i, d) {
      var l = activeLayout(); if (!l) return;
      var j = i + d; if (j < 0 || j >= l.items.length) return;
      var t = l.items[i]; l.items[i] = l.items[j]; l.items[j] = t; save(); renderGrid();
    },
    toggleCol: function (i) {
      var l = activeLayout(); if (!l) return;
      l.items[i].col = l.items[i].col === 2 ? 1 : 2; save(); renderGrid();
    },
    add: function (wid) {
      var l = activeLayout(), w = byId(wid); if (!l || !w) return;
      l.items.push({ w: wid, h: w.h, col: 1 }); save(); API.closeLib(); renderGrid();
    },
    openLib: function () { var d = document.getElementById('wdg-lib'); if (d) { d.classList.add('open'); renderLib(); } },
    closeLib: function () { var d = document.getElementById('wdg-lib'); if (d) d.classList.remove('open'); },
    reset: function () { STATE.cfg = defaultCfg(); save(); renderBar(); renderGrid(); },
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

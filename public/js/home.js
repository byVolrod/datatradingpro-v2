/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   DTP — ESPACE D'ACCUEIL (« workstation ») · v1 RÉSERVÉE AU COMPTE ADMIN (volrod.dev@gmail.com)
   le temps de finaliser l'idée (demande user 28/07, inspiré des workstations de terminaux premium,
   identité 100 % DTP). À la connexion : salutation, ses desks en cartes (ouvrir/créer), accès
   rapide aux vues, et l'agenda éco du jour. Overlay au-dessus du desk : AUCUNE modification du
   routeur de vues (activateView) → zéro risque de régression pour les autres comptes.
   Affiché une fois par session (sessionStorage, volatil par design).
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var GATE_EMAIL = 'volrod.dev@gmail.com';           // v1 : admin uniquement — élargir ici le jour venu
  var FLAG = 'dtp_home_seen';

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function salut() {
    var h = 0; try { h = parseInt(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date()), 10) || 0; } catch (e) {}
    return h < 6 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  }
  function dateFr() {
    try { return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()); } catch (e) { return ''; }
  }

  function close() {
    try { sessionStorage.setItem(FLAG, '1'); } catch (e) {}
    var el = document.getElementById('dtp-home'); if (el) el.remove();
  }
  // Ouvre un desk précis depuis une carte (Mon Desk + layout choisi), ou une vue du desk classique.
  function openDesk(id) { close(); try { window.DTPWidgets && DTPWidgets.open(); if (id) setTimeout(function () { DTPWidgets.switchLayout(id); }, 60); } catch (e) {} }
  function openView(v) { close(); try { if (typeof activateView === 'function') activateView(v); } catch (e) {} }
  function createDesk() { close(); try { DTPWidgets.open(); setTimeout(function () { DTPWidgets.openManager(); }, 120); } catch (e) {} }

  function layoutCards(cfg) {
    var lays = (cfg && cfg.layouts || []).filter(function (l) { return l && !l.hidden; }).slice(0, 8);
    var cards = lays.map(function (l) {
      var n = (l.items || []).length;
      // Vignette RÉELLE du desk (même moteur que le gestionnaire) : on reconnaît son layout à sa forme
      // et aux couleurs de familles, sans avoir à lire le nom.
      var mini = '';
      try { mini = (window.DTPWidgets && DTPWidgets.thumb) ? DTPWidgets.thumb(l.items, { labels: true }) : ''; } catch (e) {}
      return '<button class="home-card" onclick="DTPHome.openDesk(\'' + esc(l.id) + '\')">'
        + '<span class="home-card-fav">' + (l.fav ? '★' : '') + '</span>'
        + (mini ? '<span class="home-card-thumb">' + mini + '</span>' : '')
        + '<span class="home-card-name">' + esc(l.name || 'Desk') + '</span>'
        + '<span class="home-card-meta">' + n + ' widget' + (n > 1 ? 's' : '') + '</span>'
        + '<span class="home-card-go">Ouvrir →</span></button>';
    }).join('');
    return cards + '<button class="home-card home-card--new" onclick="DTPHome.createDesk()">'
      + '<span class="home-card-plus">+</span><span class="home-card-name">Nouveau desk</span>'
      + '<span class="home-card-meta">disposition, modèle ou widgets un à un</span></button>';
  }

  var VUES = [
    ['news', 'Actus'], ['calendar', 'Calendrier'], ['fxlist', 'Liste FX'], ['institution', 'Institutions'],
    ['analystes', 'Analystes'], ['bias', 'Biais'], ['weekahead', 'Semaine à venir'], ['taux', 'Taux'], ['banques', 'Banques'],
  ];

  /* ── ÉTAT DE SÉANCE ────────────────────────────────────────────────────────────────────────────
     MÊME table et MÊME règle que la carte des sessions du desk (app.js, renderSessionMap) : heures
     LOCALES de chaque place, week-end fermé. Dupliquer la règle ferait dire deux choses différentes
     au même produit — si elle bouge là-bas, elle doit bouger ici. */
  var SESSIONS = [
    { n: 'Sydney', o: 9, c: 17, tz: 'Australia/Sydney' },
    { n: 'Tokyo', o: 9, c: 15, tz: 'Asia/Tokyo' },
    { n: 'Londres', o: 8, c: 17, tz: 'Europe/London' },
    { n: 'New York', o: 9, c: 17, tz: 'America/New_York' },
  ];
  function _localHeure(tz) {
    var d = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    return { h: d.getHours() + d.getMinutes() / 60, jour: d.getDay() };
  }
  function _duree(h) {                                  // heures décimales → « 3 h 20 » / « 45 min »
    var m = Math.max(0, Math.round(h * 60));
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  }
  function sessionsHtml() {
    return SESSIONS.map(function (s) {
      var l = _localHeure(s.tz);
      var weekend = l.jour === 0 || l.jour === 6;
      var ouverte = !weekend && l.h >= s.o && l.h < s.c;
      var reste = ouverte ? _duree(s.c - l.h) : (weekend ? null : _duree((l.h < s.o ? s.o - l.h : 24 - l.h + s.o)));
      return '<div class="home-sess' + (ouverte ? ' is-open' : '') + '">'
        + '<span class="home-sess-dot"></span>'
        + '<span class="home-sess-n">' + s.n + '</span>'
        + '<span class="home-sess-t">' + (weekend ? 'week-end' : ouverte ? 'ferme dans ' + reste : 'ouvre dans ' + reste) + '</span>'
        + '</div>';
    }).join('');
  }

  /* ── À SUIVRE AUJOURD'HUI : publications à FORT impact restant à venir, heure de Paris.
     On ne montre QUE le fort impact : un accueil qui liste 40 lignes ne sert personne. */
  function eventsHtml(items) {
    var now = Date.now();
    var finJour = (function () {
      var p = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      p.setHours(23, 59, 59, 999);
      return now + (p - new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' })));
    })();
    var evs = (items || []).filter(function (e) {
      return e && String(e.impact || '').toLowerCase() === 'high' && (e.timestamp || 0) > now && (e.timestamp || 0) <= finJour;
    }).sort(function (a, b) { return a.timestamp - b.timestamp; }).slice(0, 5);
    if (!evs.length) return '<div class="home-empty">Plus de publication à fort impact aujourd\'hui.</div>';
    return evs.map(function (e) {
      var t = '';
      try { t = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(e.timestamp)); } catch (x) {}
      return '<div class="home-ev"><span class="home-ev-h">' + esc(t) + '</span>'
        + '<span class="home-ev-ccy">' + esc(e.currency || '') + '</span>'
        + '<span class="home-ev-t">' + esc(e.title || '') + '</span></div>';
    }).join('');
  }

  /* ── HIÉRARCHIE DES DEVISES : qui mène, qui décroche sur la séance. Trois en tête, trois en queue —
     l'information utile au réveil, pas les huit lignes du widget complet. */
  function forceHtml(d) {
    if (!d || !d.currencies || !d.series) return '<div class="home-empty">Force des devises indisponible.</div>';
    var vals = d.currencies.map(function (c) {
      var pts = (d.series[c] || []).filter(function (p) { return p && p.v != null; });
      return { c: c, v: pts.length ? pts[pts.length - 1].v : null };
    }).filter(function (x) { return x.v != null; }).sort(function (a, b) { return b.v - a.v; });
    if (vals.length < 4) return '<div class="home-empty">Force des devises indisponible.</div>';
    var max = Math.max.apply(null, vals.map(function (x) { return Math.abs(x.v); })) || 1;
    var ligne = function (x) {
      var pct = Math.round(Math.abs(x.v) / max * 100);
      return '<div class="home-fx' + (x.v >= 0 ? ' is-up' : ' is-down') + '">'
        + '<span class="home-fx-c">' + esc(x.c) + '</span>'
        + '<span class="home-fx-bar"><i style="width:' + pct + '%"></i></span>'
        + '<span class="home-fx-v">' + (x.v >= 0 ? '+' : '') + x.v.toFixed(2) + '</span></div>';
    };
    return vals.slice(0, 3).map(ligne).join('')
      + '<div class="home-fx-sep"></div>'
      + vals.slice(-3).map(ligne).join('');
  }

  function build(user, cfg) {
    var prenom = esc((user.name || '').split(' ')[0] || 'trader');
    var el = document.createElement('div');
    el.id = 'dtp-home'; el.className = 'home-overlay';
    el.innerHTML = ''
      + '<div class="home-inner">'
      +   '<button class="home-skip" onclick="DTPHome.close()" title="Passer">Accéder au desk ✕</button>'
      +   '<div class="home-hero">'
      +     '<div class="home-eyebrow">Espace de travail</div>'
      +     '<div class="home-title">' + salut() + ', <span class="home-name">' + prenom + '</span></div>'
      +     '<div class="home-sub">' + esc(dateFr()) + ' — ton desk est prêt.</div>'
      +   '</div>'
      +   '<div class="home-strip" id="home-strip">' + sessionsHtml() + '</div>'
      +   '<div class="home-cols">'
      +     '<div class="home-col">'
      +       '<div class="home-sec">Mes desks</div>'
      +       '<div class="home-cards">' + layoutCards(cfg) + '</div>'
      +       '<div class="home-sec">Accès rapide</div>'
      +       '<div class="home-chips">' + VUES.map(function (v) {
                return '<button class="home-chip" onclick="DTPHome.openView(\'' + v[0] + '\')">› ' + esc(v[1]) + '</button>';
              }).join('') + '</div>'
      +     '</div>'
      +     '<div class="home-col home-col--side">'
      +       '<div class="home-sec">À suivre aujourd\'hui</div>'
      +       '<div class="home-box" id="home-ev"><div class="home-empty">Lecture du calendrier…</div></div>'
      +       '<div class="home-sec">Hiérarchie des devises</div>'
      +       '<div class="home-box" id="home-fx"><div class="home-empty">Lecture de la force des devises…</div></div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(el);

    // Les sessions avancent : on les rafraîchit tant que l'écran est là (le minuteur meurt avec lui).
    var iv = setInterval(function () {
      var st = document.getElementById('home-strip');
      if (!st) { clearInterval(iv); return; }
      st.innerHTML = sessionsHtml();
    }, 30000);

    // Chaque bloc se remplit indépendamment : un endpoint muet n'empêche pas les autres de servir.
    var poser = function (id, html) { var h = document.getElementById(id); if (h) h.innerHTML = html; };
    fetch('/api/calendar-events').then(function (r) { return r.json(); })
      .then(function (j) { poser('home-ev', eventsHtml(j && j.items)); })
      .catch(function () { poser('home-ev', '<div class="home-empty">Calendrier indisponible.</div>'); });
    fetch('/api/currency-strength?period=today').then(function (r) { return r.json(); })
      .then(function (j) { poser('home-fx', forceHtml(j)); })
      .catch(function () { poser('home-fx', '<div class="home-empty">Force des devises indisponible.</div>'); });
  }

  window.DTPHome = { close: close, openDesk: openDesk, openView: openView, createDesk: createDesk };

  // Démarrage : gate compte + 1×/session. On attend l'auth (même endpoint que le reste du desk).
  try { if (sessionStorage.getItem(FLAG)) return; } catch (e) {}
  fetch('/api/auth/me').then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.loggedIn || !d.user) return;
    if (String(d.user.email || '').toLowerCase() !== GATE_EMAIL) return;   // v1 : admin seulement
    fetch('/api/widgets').then(function (r) { return r.json(); }).then(function (j) {
      build(d.user, (j && j.cfg) || { layouts: [] });
    }).catch(function () { build(d.user, { layouts: [] }); });
  }).catch(function () {});
})();

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
      return '<button class="home-card" onclick="DTPHome.openDesk(\'' + esc(l.id) + '\')">'
        + '<span class="home-card-fav">' + (l.fav ? '★' : '') + '</span>'
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

  function agendaHtml(days) {
    try {
      var todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
      var d = (days || []).find(function (x) { return x && String(x.iso || x.date || '').slice(0, 10) === todayKey; }) || (days || [])[0];
      if (!d) return '';
      var evs = (d.events || []).slice(0, 6).map(function (e) {
        return '<div class="home-ev"><span class="home-ev-ccy">' + esc(e.ccy || '') + '</span><span class="home-ev-t">' + esc(e.title || '') + '</span></div>';
      }).join('');
      return '<div class="home-agenda-h">' + esc(d.headline || 'Au programme aujourd\'hui') + '</div>' + (evs || '<div class="home-ev-empty">Séance calme au calendrier.</div>');
    } catch (e) { return ''; }
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
      +       '<div class="home-sec">Aujourd\'hui</div>'
      +       '<div class="home-agenda" id="home-agenda"><div class="home-ev-empty">Chargement de l\'agenda…</div></div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(el);
    // Agenda du jour (Semaine à Venir) — best-effort, la carte se masque si rien.
    fetch('/api/week-ahead').then(function (r) { return r.json(); }).then(function (j) {
      var host = document.getElementById('home-agenda'); if (!host) return;
      var html = agendaHtml(j && j.days);
      if (html) host.innerHTML = html; else host.parentElement.style.display = 'none';
    }).catch(function () { var h = document.getElementById('home-agenda'); if (h) h.parentElement.style.display = 'none'; });
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

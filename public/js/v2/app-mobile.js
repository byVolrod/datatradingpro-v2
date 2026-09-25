/* ═══ DTP V2 · L'APP MOBILE (comptes admin, interrupteur « Aperçu V2 ») ═══════════════════════════
   Demande user (24/09) : « je veux une app mobile, vraiment, pas une web app — mais en version web
   d'abord, avant de basculer vers la création de l'app ». Référence : les 14 captures du dossier
   Drive (application mobile d'un terminal concurrent), dont on reprend l'ERGONOMIE et l'emplacement
   des boutons, jamais l'habillage :
     · en-tête : titre d'écran + point vert « en direct » (le mot est retiré le 25/09 : trop de place) ; à droite IA, cloche (nombre de non-lus), compte ;
     · barre du bas, 5 onglets : Fil · Calendrier · Marchés · Analystes · Banques (Calendrier à la place de Macro le 25/09) ;
     · Alertes : feuille plein écran, 4 filtres (Tout · Rapports · Actu · Calendrier), non-lus comptés ;
     · Compte : écran à sections (fuseau, abonnement, préférences, assistance) et déconnexion.
   Les écrans de LISTE sont natifs (construits ici), et leurs données sont celles que le desk a DÉJÀ en
   mémoire : le fil (`getFilteredItems`, alimenté en direct par le WebSocket), les rapports
   (`getArlibItems`, `_brArticles`), les alertes (`_npItems`). Aucun second chargeur, aucune donnée
   recalculée. Ouvrir un rapport passe par le LECTEUR du desk (`renderArlibReader`, `renderBrReader`),
   éprouvé par ses bancs ; les outils (calendrier, taux, biais…) restent les vues du desk.
   ⚠️ LE DESK DESSOUS NE DOIT RIEN SAVOIR DE CE FICHIER. Tout passe par des fonctions déjà publiques et
   par une classe sur <html> (`dtp-app`) que seule css/v2/app.css lit. Retirer ce fichier = le desk
   exact d'avant. Actif seulement en largeur de téléphone ; au-delà il s'efface. */
(function () {
  'use strict';
  if (window._dtpV2App) return;
  window._dtpV2App = true;

  /* L'APP EST POUR LES ÉCRANS TACTILES, PAS POUR LES FENÊTRES ÉTROITES (25/09, capture user : sur PC,
     fenêtre Chrome rétrécie pour éprouver le responsive → le desk et son modèle par défaut cédaient
     la place aux écrans de l'app, « j'ai pas compris pourquoi c'est différent »). La largeur seule
     ne dit pas qu'on est sur un téléphone ; le pointeur principal, si. Un PC reste donc sur Mon
     Desk à toutes les largeurs, et c'est la grille qui s'adapte. Même condition, écrite au même
     endroit, dans boot.js (mémo), index.html (voile) et desk.js / desk.css (habillage). */
  var MQ = window.matchMedia('(max-width: 820px) and (pointer: coarse)');
  var H = document.documentElement;

  var svg = function (d, w, epais) {
    return '<svg viewBox="0 0 24 24" width="' + (w || 24) + '" height="' + (w || 24) + '" fill="none" stroke="currentColor" '
      + 'stroke-width="' + (epais || 1.6) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  };
  /* Icônes de la barre du bas dans le STYLE DU DESK (barre du haut) : un aplat léger (opacité .18)
     sous un trait fin de 1,5 px. Même grammaire que la cloche, la bulle et le Copilote du desk. */
  var svgDuo = function (fond, trait, w) {
    return '<svg viewBox="0 0 24 24" width="' + (w || 26) + '" height="' + (w || 26) + '" aria-hidden="true">'
      + '<path d="' + fond + '" fill="currentColor" opacity=".18"/>'
      + '<path d="' + trait + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  };
  var DUO = {
    fil: ['M5 4h11v16H6a1 1 0 0 1-1-1z', 'M5 4h11v16H6a1 1 0 0 1-1-1zM16 8h3v11a1 1 0 0 1-1 1h-2M8 8h5M8 12h5M8 16h3'],
    macro: ['M3 17l6-6 4 4 8-8v13H3z', 'M3 17l6-6 4 4 8-8M15 7h6v6'],
    calendar: ['M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M9 3v4M15 3v4M8 14h2M14 14h2M8 17h2'],
    markets: ['M4 4h7v7H4zM13 13h7v7h-7z', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
    analystes: ['M7 3h7l5 5v13H7z', 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6'],
    banques: ['M4 8l8-4 8 4v13H4z', 'M4 21V8l8-4 8 4v13M4 21h16M8 11v2M12 11v2M16 11v2M8 16v2M12 16v2M16 16v2']
  };
  var I = {
    macro: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    fil: 'M5 4h11v16H6a1 1 0 0 1-1-1zM16 8h3v11a1 1 0 0 1-1 1h-2M8 8h5M8 12h5M8 16h3',
    marches: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    analyst: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
    banques: 'M4 21V7l8-4 8 4v14M4 21h16M8 10v2M12 10v2M16 10v2M8 15v2M12 15v2M16 15v2',
    cloche: 'M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15zM10 21h4',
    compte: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    photo: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    crayon: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
    cadenas: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    x: 'M6 6l12 12M18 6L6 18',
    retour: 'M15 5l-7 7 7 7',
    suite: 'M9 5l7 7-7 7',
    bas: 'M6 9l6 6 6-6',
    cal: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M9 3v4M15 3v4',
    doc: 'M7 3h7l5 5v13H7zM14 3v5h5',
    actu: 'M4 5h12v14H5a1 1 0 0 1-1-1zM16 9h4v9a1 1 0 0 1-1 1h-3M7 9h6M7 13h6M7 16h4',
    risque: 'M12 3l9 16H3zM12 10v4M12 17h.01',
    horloge: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    carte: 'M3 7h18v12H3zM3 11h18',
    bulle: 'M4 5h16v11H9l-5 4z',
    son: 'M5 9v6h4l5 4V5L9 9zM17 9a4 4 0 0 1 0 6',
    etoile: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z',
    sortie: 'M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9',
    langue: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
    hausse: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    baisse: 'M3 7l6 6 4-4 8 8M15 17h6v-6'
  };
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var vibre = function () { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {} };
  var appel = function (nom) { var f = window[nom]; if (typeof f === 'function') { try { return f.apply(null, [].slice.call(arguments, 1)); } catch (e) {} } return undefined; };
  /* Les FONCTIONS de premier niveau d'app.js sont sur window ; ses `let` / `const` n'y sont pas, mais
     l'environnement lexical global est PARTAGÉ entre scripts classiques : on les lit par leur nom,
     derrière un `typeof` (le desk pourrait ne pas les avoir encore déclarés). Aucun eval. */
  var glob = function (nom) {
    try {
      switch (nom) {
        case '_brArticles':        return typeof _brArticles !== 'undefined' ? _brArticles : undefined;
        case '_npItems':           return typeof _npItems !== 'undefined' ? _npItems : undefined;
        case 'newsEssentialMode':  return typeof newsEssentialMode !== 'undefined' ? newsEssentialMode : undefined;
        case '_npEnabled':         return typeof _npEnabled !== 'undefined' ? _npEnabled : undefined;
        case '_brReadIds':         return typeof _brReadIds !== 'undefined' ? _brReadIds : undefined;
        case 'NEWS_TAG_FR':        return typeof NEWS_TAG_FR !== 'undefined' ? NEWS_TAG_FR : undefined;
      }
    } catch (e) { return undefined; }
    return window[nom];
  };
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var dateHeure = function (ts) { var d = new Date(ts); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() + ' | ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  var jourLong = function (ts) { try { return new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\s(\d)/, ' $1'); } catch (e) { return ''; } };
  var dateCourte = function (ts) { try { return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
  var ilYa = function (ts) {
    var f = glob('_npTimeAgo'); if (typeof f === 'function') return f(ts);
    var s = Math.max(0, (Date.now() - ts) / 1000); return s < 3600 ? 'il y a ' + Math.floor(s / 60) + ' min' : 'il y a ' + Math.floor(s / 3600) + ' h';
  };

  /* ── Les onglets (référence : 5 onglets, pas de « Plus ») et les outils du desk ─────────────────── */
  var ONGLETS = [
    { v: 'fil',       t: 'Fil',       titre: 'Fil en direct', ico: I.fil },
    /* CALENDRIER À LA PLACE DE MACRO (25/09, demande user). C'est la vue Calendrier du desk, comme
       les autres outils : même données, même rendu. L'écran Macro (publications du desk) reste dans
       « Tous les outils » ; ses publications sont aussi dans Analystes. */
    { v: 'calendar',  t: 'Calendrier', titre: 'Calendrier',    ico: I.cal },
    { v: 'markets',   t: 'Marchés',   titre: 'Marchés',       ico: I.marches },
    { v: 'analystes', t: 'Analystes', titre: 'Analystes',     ico: I.analyst },
    { v: 'banques',   t: 'Banques',   titre: 'Banques',       ico: I.banques }
  ];
  var OUTILS = [
    { v: 'macro',       t: 'Publications DTP',  ico: I.macro, natif: true },
    { v: 'taux',        t: 'Taux',              ico: 'M5 19L19 5M7 7h.01M17 17h.01' },
    { v: 'bias',        t: 'Radar de Biais',    ico: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l7-7' },
    { v: 'weekahead',   t: 'Semaine à venir',   ico: 'M5 5h14v14H5zM5 9h14M9 13h2M13 13h2M9 16h2' },
    { v: 'fxlist',      t: 'Liste FX',          ico: 'M4 6h16M4 12h16M4 18h16M8 3v18' },
    { v: 'bank',        t: 'Positions banques', ico: 'M4 18l5-6 4 3 7-9M20 6v5M20 6h-5' },
    { v: 'journal',     t: 'Journal',           ico: 'M6 3h11a2 2 0 0 1 2 2v16l-4-2-4 2-4-2-3 2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6' },
    { v: 'calculator',  t: 'Calculatrice',      ico: 'M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01' },
    { v: 'widgets',     t: 'Mon Desk',          ico: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z' }
  ];
  var TITRES = { news: 'Fil en direct', analyst: 'Analystes', institution: 'Banques', symbol: 'Paire', compte: 'Compte' };
  ONGLETS.forEach(function (o) { TITRES[o.v] = o.titre; });
  OUTILS.forEach(function (o) { if (!TITRES[o.v]) TITRES[o.v] = o.t; });
  // Vue du desk → onglet de l'app qui l'éclaire (le lecteur d'un rapport garde son onglet allumé).
  var PARENT = { news: 'fil', analyst: 'analystes', institution: 'banques' };
  var existe = function (v) { return !!document.getElementById('view-' + v); };

  /* ── Construction de la coquille (une seule fois) ──────────────────────────────────────────────── */
  var tete, barre, feuille, voile, alertes, courant = '', ecrans = {};
  function construire() {
    if (tete) return;
    tete = document.createElement('header');
    tete.className = 'v2a-tete';
    tete.innerHTML = '<div class="v2a-titre-bloc"><button type="button" class="v2a-retour" id="v2a-retour" aria-label="Retour" hidden>' + svg(I.retour, 22, 2) + '</button>'
      + '<h1 class="v2a-titre" id="v2a-titre">Fil en direct</h1><span class="v2a-direct" role="img" aria-label="En direct" title="En direct"><i></i></span></div>'
      + '<div class="v2a-actions">'
      + '<button type="button" class="v2a-bt v2a-ia" id="v2a-ia" aria-label="Copilote Macro (IA)"><img src="/assets/images/macro-ai-spark.svg" alt=""></button>'
      + '<button type="button" class="v2a-bt" id="v2a-alertes" aria-label="Alertes">' + svg(I.cloche, 25) + '<b class="v2a-compteur" id="v2a-compteur" hidden></b><b class="v2a-point" id="v2a-point"></b></button>'
      + '<button type="button" class="v2a-bt v2a-compte" id="v2a-compte" aria-label="Mon compte">' + svg(I.compte, 25) + '</button>'
      + '</div>';
    document.body.insertBefore(tete, document.body.firstChild);

    barre = document.createElement('nav');
    barre.className = 'v2a-barre';
    barre.setAttribute('aria-label', 'Navigation');
    barre.innerHTML = ONGLETS.map(function (o) {
      return '<button type="button" class="v2a-onglet" data-v2v="' + o.v + '">' + (DUO[o.v] ? svgDuo(DUO[o.v][0], DUO[o.v][1]) : svg(o.ico, 27, 1.5)) + '<span>' + o.t + '</span></button>';
    }).join('');
    document.body.appendChild(barre);

    // La feuille « Tous les outils » : ouverte depuis l'écran Marchés (et par un appui long sur Marchés).
    voile = document.createElement('div');
    voile.className = 'v2a-voile';
    feuille = document.createElement('div');
    feuille.className = 'v2a-feuille';
    feuille.setAttribute('role', 'dialog');
    feuille.setAttribute('aria-label', 'Tous les outils');
    feuille.innerHTML = '<div class="v2a-poignee"></div><div class="v2a-feuille-titre">Tous les outils</div><div class="v2a-grille">'
      + OUTILS.filter(function (o) { return o.natif || existe(o.v); }).map(function (o) {
        return '<button type="button" class="v2a-tuile" data-v2v="' + o.v + '">' + svg(o.ico, 24) + '<span>' + o.t + '</span></button>';
      }).join('') + '</div>';
    document.body.appendChild(voile);
    document.body.appendChild(feuille);

    // Les écrans natifs, dans cet ordre (le premier reçoit la carte du Briefing, cf. briefing-ui.js) :
    // depuis que Macro a quitté la barre, c'est le Fil qui la porte, en tête.
    ['fil', 'macro', 'markets', 'analystes', 'banques', 'compte'].forEach(function (k) {
      var s = document.createElement('section');
      s.className = 'v2a-ecran'; s.dataset.ecran = k;
      s.setAttribute('aria-label', TITRES[k] || k);
      document.body.appendChild(s);
      ecrans[k] = s;
    });

    // ── Événements ──
    barre.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v2v]'); if (!b) return;
      vibre(); ouvrirPlus(false); fermerAlertes(); fermerVolets(); aller(b.dataset.v2v);
    });
    feuille.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v2v]'); if (!b) return;
      if (b.dataset.v2v === 'widgets') window._v2aDeskDemande = true;
      vibre(); ouvrirPlus(false); aller(b.dataset.v2v);
    });
    voile.addEventListener('click', function () { ouvrirPlus(false); });
    var y0 = null;   // glisser la feuille vers le bas la referme (geste natif attendu)
    feuille.addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    feuille.addEventListener('touchmove', function (e) { if (y0 == null) return; var d = e.touches[0].clientY - y0; if (d > 0) feuille.style.transform = 'translateY(' + d + 'px)'; }, { passive: true });
    feuille.addEventListener('touchend', function (e) { if (y0 == null) return; var d = e.changedTouches[0].clientY - y0; y0 = null; feuille.style.transform = ''; if (d > 70) ouvrirPlus(false); });
    document.getElementById('v2a-ia').addEventListener('click', function () { vibre(); fermerAlertes(); var b = document.getElementById('ai-btn'); if (b) b.click(); });
    document.getElementById('v2a-alertes').addEventListener('click', function () { vibre(); fermerVolets(); if (alertes && alertes.classList.contains('v2a-ouverte')) fermerAlertes(); else ouvrirAlertes(); });
    document.getElementById('v2a-compte').addEventListener('click', function () { vibre(); fermerAlertes(); fermerVolets(); aller('compte'); });
    document.getElementById('v2a-retour').addEventListener('click', function () { vibre(); retour(); });

    /* LES ICÔNES DE L'EN-TÊTE SONT CELLES DU DESK, clonées depuis sa barre du haut (Copilote, cloche,
       avatar) : desk et app ne peuvent pas diverger, une retouche de l'un est la retouche de l'autre. */
    var clone = function (src, dst, taille) {
      var a = document.querySelector(src + ' svg'), b = document.getElementById(dst); if (!a || !b) return;
      var c = a.cloneNode(true); c.setAttribute('width', taille); c.setAttribute('height', taille); c.removeAttribute('id');
      var vieux = b.querySelector('svg, img'); if (vieux) vieux.replaceWith(c); else b.insertBefore(c, b.firstChild);
    };
    clone('#np-bell-btn', 'v2a-alertes', 23);
    // Le Copilote : l'icône COMPLÈTE du desk (étoile verte + « IA »), pas seulement son dessin.
    var ia = document.getElementById('ai-btn'), iaApp = document.getElementById('v2a-ia');
    if (ia && iaApp) { iaApp.innerHTML = ia.innerHTML; var sv = iaApp.querySelector('svg'); if (sv) { sv.setAttribute('width', 18); sv.setAttribute('height', 18); } }
    var av = document.getElementById('topbar-avatar'), cpt = document.getElementById('v2a-compte');
    var syncAv = function () { if (av && cpt) { cpt.innerHTML = '<span class="v2a-av">' + av.innerHTML + '</span>'; } };
    if (av && window.MutationObserver) new MutationObserver(syncAv).observe(av, { childList: true, subtree: true, attributes: true, characterData: true });
    syncAv();

    // Le compteur de la cloche SUIT le badge du desk (même source, aucun second calcul).
    var badge = document.getElementById('notif-badge');
    var syncBadge = function () {
      var n = badge && badge.style.display !== 'none' ? (parseInt(badge.textContent, 10) || 0) : 0;
      var c = document.getElementById('v2a-compteur'), pt = document.getElementById('v2a-point');
      if (c) { c.hidden = !n; c.textContent = n > 99 ? '99+' : String(n); }
      if (pt) pt.classList.toggle('v2a-on', !!(badge && badge.style.display !== 'none') && !n);
    };
    if (badge) new MutationObserver(syncBadge).observe(badge, { attributes: true, childList: true, characterData: true, subtree: true });
    syncBadge();
  }

  function ouvrirPlus(on) {
    if (!feuille) return;
    feuille.classList.toggle('v2a-ouverte', !!on);
    voile.classList.toggle('v2a-ouverte', !!on);
  }

  /* ── Navigation ─────────────────────────────────────────────────────────────────────────────────── */
  var pile = [];   // écrans d'outil / lecteur ouverts depuis un onglet : « Retour » y ramène
  function marquer(v) {
    courant = v;
    var t = document.getElementById('v2a-titre');
    if (t) t.textContent = TITRES[v] || 'DataTradingPro';
    var onglet = ONGLETS.some(function (o) { return o.v === v; }) ? v : (PARENT[v] || (v === 'compte' ? '' : 'markets'));
    if (barre) barre.querySelectorAll('.v2a-onglet').forEach(function (b) { b.classList.toggle('v2a-actif', b.dataset.v2v === onglet); });
    var r = document.getElementById('v2a-retour');
    if (r) r.hidden = !(v === 'compte' || !ONGLETS.some(function (o) { return o.v === v; }));
    H.classList.toggle('v2a-sous-ecran', v === 'compte');
  }
  function montrerEcran(k) {
    Object.keys(ecrans).forEach(function (x) { ecrans[x].classList.toggle('v2a-visible', x === k); });
    if (k && ecrans[k]) { var e = ecrans[k]; e.classList.remove('v2a-entre'); void e.offsetWidth; e.classList.add('v2a-entre'); }
    /* ⚠️ UN ÉCRAN NATIF MASQUE LE DESK DESSOUS (25/09, capture : le Calendrier transparaissait sous le
       Fil). L'écran natif entre en fondu ; pendant ce fondu, la vue du desk restée ouverte dessous se
       voyait à travers. Tant qu'un écran natif est affiché, le desk est masqué (sans être démonté :
       ses widgets et ses minuteurs continuent). */
    H.classList.toggle('v2a-natif', !!(k && ecrans[k]));
    if (k !== 'markets') arreterMarches();
  }
  var RENDUS = {};
  function aller(v, opts) {
    opts = opts || {};
    if (ecrans[v]) {
      if (ONGLETS.some(function (o) { return o.v === v; })) pile = [];
      else if (courant && courant !== v) pile.push(courant);
      montrerEcran(v); marquer(v);
      if (RENDUS[v]) RENDUS[v]();
      return;
    }
    // Une vue du desk (outil, lecteur) : les écrans natifs s'effacent, la vue apparaît dessous.
    // Un onglet de la barre (le Calendrier) remet la pile à zéro, comme les onglets natifs.
    if (ONGLETS.some(function (o) { return o.v === v; })) pile = [];
    else if (courant && courant !== v && !opts.sansPile) pile.push(courant);
    montrerEcran(null);
    if (typeof window.activateView !== 'function') return;
    window.activateView(v);
    var p = document.getElementById('view-' + v);
    if (p) { p.classList.remove('v2a-entre'); void p.offsetWidth; p.classList.add('v2a-entre'); }
    marquer(v);
  }
  function retour() {
    // Un volet (IA, support) ouvert : Retour le referme, comme le geste retour d'une app.
    if (voletOuvert()) { fermerVolets(); return; }
    if (courant === 'compte' && sousCompte) { sousCompte = null; RENDUS.compte(true); return; }
    // Un lecteur de rapport du desk : on le referme aussi, sans quoi la vue du desk resterait
    // bloquée sur ce rapport à la prochaine visite.
    if (courant === 'analyst') { var ba = document.getElementById('arlib-back-btn'); if (ba) ba.click(); }
    if (courant === 'institution') { var bb = document.getElementById('br-back-btn'); if (bb) bb.click(); }
    var v = pile.pop();
    if (!v) v = 'fil';
    // Un lecteur de rapport ouvert : on referme d'abord le lecteur, on revient à la liste native.
    aller(v, { sansPile: true });
  }
  window._v2aAller = aller;
  /* Ouvrir ce qu'une notification annonce (25/09) : appelé par app.js (_dtpOuvrirCible), avec
     réessai tant que la liste n'est pas arrivée. Rend true quand c'est fait. */
  window._v2aOuvrirCible = function (type, id, dernier) {
    var onglet = { fil: 'fil', calendrier: 'calendar', marches: 'markets', banques: 'banques', analystes: 'analystes' }[type];
    if (!onglet) return true;
    if (!id) { aller(onglet); return true; }
    if (type === 'fil') {
      if (courant !== 'fil') aller('fil');
      var n = document.querySelector('#v2a-fil .v2a-news[data-id="' + cssEsc(id) + '"]');
      if (!n) return !!dernier;
      n.scrollIntoView({ block: 'center' });
      if (!n.classList.contains('v2a-ouvert')) n.click();
      n.classList.add('v2a-cible'); setTimeout(function () { n.classList.remove('v2a-cible'); }, 2600);
      return true;
    }
    if (type === 'banques') {
      var br = glob('_brArticles') || [], it = null;
      for (var i = 0; i < br.length; i++) if (br[i] && (String(br[i].id) === id || br[i].url === id)) { it = br[i]; break; }
      if (!it) { if (dernier) aller('banques'); return !!dernier; }
      try { var mk = glob('markBrRead'); if (typeof mk === 'function') mk(it.id); } catch (x) {}
      aller('institution');
      var t = document.getElementById('v2a-titre'); if (t) t.textContent = 'Rapport';
      try { var r = glob('renderBrReader'); if (typeof r === 'function') r(it); } catch (x) {}
      return true;
    }
    if (type === 'analystes') {
      var ra = itemsRapports(), ia = null, cleDe = glob('_dtpCleRapport');
      for (var k = 0; k < ra.length; k++) if (ra[k] && (String(ra[k].id) === id || (typeof cleDe === 'function' && cleDe(ra[k]) === id) || ra[k].url === id || ra[k].link === id)) { ia = ra[k]; break; }
      if (!ia) { if (dernier) aller('analystes'); return !!dernier; }
      ouvrirRapport(ia);
      return true;
    }
    aller(onglet); return true;
  };

  /* ── Les volets du desk (Copilote IA, support) dans l'app : titre d'écran et bouton Retour. Sans
     cela, le volet s'ouvrait sous un en-tête qui annonçait encore l'écran d'avant. ── */
  var VOLETS = [['ai-panel', 'Copilote Macro', 'aiClose'], ['chat-panel', 'Support DTP', 'chatClose'], ['sqwk-panel', 'Flash Marché', 'sqwkClose']];
  function voletOuvert() { for (var i = 0; i < VOLETS.length; i++) { var p = document.getElementById(VOLETS[i][0]); if (p && p.classList.contains('open')) return VOLETS[i]; } return null; }
  function fermerVolets() { VOLETS.forEach(function (v) { var p = document.getElementById(v[0]); if (p && p.classList.contains('open')) appel(v[2]); }); syncVolet(); }
  function syncVolet() {
    if (!H.classList.contains('dtp-app')) return;
    var v = voletOuvert(), t = document.getElementById('v2a-titre'), r = document.getElementById('v2a-retour');
    H.classList.toggle('v2a-volet', !!v);
    if (v) { if (t) t.textContent = v[1]; if (r) r.hidden = false; }
    else if (courant) marquer(courant);
  }
  function brancherVolets() {
    VOLETS.forEach(function (v) {
      var p = document.getElementById(v[0]);
      if (p && !p._v2a && window.MutationObserver) { p._v2a = true; new MutationObserver(syncVolet).observe(p, { attributes: true, attributeFilter: ['class'] }); }
    });
  }

  // Toute navigation faite AILLEURS (ouverture d'une paire, lien d'une alerte…) resynchronise la barre.
  var origine = window.activateView;
  if (typeof origine === 'function' && !origine._v2) {
    var enveloppe = function (v) {
      /* Mon Desk se rouvre tout seul au démarrage d'un admin (widgets.js) : c'est une composition de
         GRAND écran. Dans l'app, seule la tuile « Mon Desk » l'ouvre ; toute autre ouverture
         automatique retombe sur l'écran d'accueil de l'app. */
      if (v === 'widgets' && H.classList.contains('dtp-app') && !window._v2aDeskDemande) {
        window._v2aDeskDemande = false;
        setTimeout(function () { aller('fil'); }, 0);
        return;
      }
      window._v2aDeskDemande = false;
      if (H.classList.contains('dtp-app')) montrerEcran(null);
      var r = origine.apply(this, arguments); try { if (H.classList.contains('dtp-app')) marquer(v); } catch (e) {} return r;
    };
    enveloppe._v2 = true;
    window.activateView = enveloppe;
  }

  /* ══ ADMINISTRATION : le panneau admin dans une feuille de l'app, sans quitter l'app ═══════════════
     Même origine, même session : la page /admin se charge dans un cadre plein écran. Elle se sait
     embarquée (admin.html pose `adm-embarque`) et masque alors ses boutons « Retour au desk » et
     « Déconnexion », qui n'ont pas de sens ici : la croix ramène à l'app. */
  var feuilleAdmin = null;
  function ouvrirAdmin() {
    if (!window._pdIsAdmin) return;
    if (!feuilleAdmin) {
      feuilleAdmin = document.createElement('div');
      feuilleAdmin.className = 'v2a-alertes v2a-admin';
      feuilleAdmin.setAttribute('role', 'dialog'); feuilleAdmin.setAttribute('aria-label', 'Administration');
      feuilleAdmin.innerHTML = '<header><h2>Administration</h2><button type="button" class="v2a-x" aria-label="Fermer">' + svg(I.x, 24, 2) + '</button></header>'
        + '<iframe class="v2a-admin-cadre" title="Panneau d’administration" src="/admin?app=1"></iframe>';
      document.body.appendChild(feuilleAdmin);
      feuilleAdmin.querySelector('.v2a-x').addEventListener('click', function () { vibre(); feuilleAdmin.classList.remove('v2a-ouverte'); });
    }
    requestAnimationFrame(function () { feuilleAdmin.classList.add('v2a-ouverte'); });
  }

  /* ══ PAIRES : la vue paire du desk (COT, saisonnalité, particuliers, biais) depuis l'app ════════════
     Les 28 croisements des 8 devises du desk, plus l'or, rangés par devise de base. Un toucher ouvre
     la vue paire du desk (`openSymbol`), comme la recherche de symboles de la barre du haut. */
  var DEV8 = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];
  var DRAP8 = { EUR: 'eu', GBP: 'gb', AUD: 'au', NZD: 'nz', USD: 'us', CAD: 'ca', CHF: 'ch', JPY: 'jp' };
  var feuillePaires = null;
  function ouvrirPaires() {
    if (!feuillePaires) {
      feuillePaires = document.createElement('div');
      feuillePaires.className = 'v2a-alertes v2a-paires';
      feuillePaires.setAttribute('role', 'dialog'); feuillePaires.setAttribute('aria-label', 'Paires');
      var groupes = DEV8.slice(0, 7).map(function (b, i) {
        var ps = DEV8.slice(i + 1).map(function (q) { return b + q; });
        return '<h3 class="v2a-rubrique">' + b + '</h3><div class="v2a-paires-g">' + ps.map(function (p) {
          return '<button type="button" data-p="' + p + '"><span class="v2a-p-fl"><img src="https://flagcdn.com/w40/' + DRAP8[p.slice(0, 3)] + '.png" alt=""><img src="https://flagcdn.com/w40/' + DRAP8[p.slice(3)] + '.png" alt=""></span>' + p.slice(0, 3) + '/' + p.slice(3) + '</button>';
        }).join('') + '</div>';
      }).join('');
      feuillePaires.innerHTML = '<header><h2>Paires</h2><button type="button" class="v2a-x" aria-label="Fermer">' + svg(I.x, 24, 2) + '</button></header>'
        + '<div class="v2a-al-liste"><h3 class="v2a-rubrique">Or</h3><div class="v2a-paires-g"><button type="button" data-p="XAUUSD"><span class="v2a-p-fl"><i class="v2a-p-or">Au</i><img src="https://flagcdn.com/w40/us.png" alt=""></span>XAU/USD</button></div>' + groupes + '</div>';
      document.body.appendChild(feuillePaires);
      feuillePaires.querySelector('.v2a-x').addEventListener('click', function () { vibre(); feuillePaires.classList.remove('v2a-ouverte'); });
      feuillePaires.addEventListener('click', function (e) {
        var b = e.target.closest('[data-p]'); if (!b) return; vibre();
        feuillePaires.classList.remove('v2a-ouverte');
        appel('openSymbol', b.dataset.p);
      });
    }
    fermerVolets();
    requestAnimationFrame(function () { feuillePaires.classList.add('v2a-ouverte'); });
  }

  /* ══ ÉCRAN MACRO : le briefing du matin sourcé + les publications du desk, en fil de lecture ══════
     Référence « MacroFeed » : des publications longues, un auteur, une date, un titre, le texte, « Lire
     la suite ». Chez DTP, ces publications existent : ce sont les récaps et analyses rédigés par le
     desk (même liste que l'onglet Analystes, filtrée sur la source DTP). Le Briefing du matin se pose
     tout seul en tête (briefing-ui.js). Rien n'est rédigé ici. */
  function itemsRapports() { var f = glob('getArlibItems'); try { return typeof f === 'function' ? (f() || []) : []; } catch (e) { return []; } }
  function titreRapport(it) { var f = glob('standardizeReportTitle'); try { return typeof f === 'function' ? f(it) : (it.headline || it.title || ''); } catch (e) { return it.headline || it.title || ''; } }
  function estDtp(it) { var f = glob('isPrimerItem'); return it.source === 'DTP' || it._briefing || it._marketWrap || !!it._reportType || (typeof f === 'function' && f(it)); }
  function ouvrirRapport(it) {
    var mk = glob('markRead'), rk = glob('_reportReadKey');
    try { if (typeof mk === 'function' && typeof rk === 'function') mk(rk(it)); } catch (e) {}
    aller('analyst');
    var t = document.getElementById('v2a-titre'); if (t) t.textContent = 'Rapport';
    try { var r = glob('renderArlibReader'); if (typeof r === 'function') r(it); var s = glob('arlibShowReader'); if (typeof s === 'function') s(); } catch (e) {}
  }
  RENDUS.macro = function () {
    var e = ecrans.macro, zone = e.querySelector('.v2a-macro-liste');
    if (!zone) { zone = document.createElement('div'); zone.className = 'v2a-macro-liste'; e.appendChild(zone); }
    var items = itemsRapports().filter(estDtp).sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); }).slice(0, 14);
    if (!items.length) { zone.innerHTML = '<p class="v2a-vide">Les publications du desk arrivent…</p>'; appel('loadAnalystView'); setTimeout(function () { if (courant === 'macro') RENDUS.macro(); }, 2500); return; }
    zone.innerHTML = items.map(function (it, i) {
      var txt = String(it.description || it.summary || '').trim();
      return '<article class="v2a-post" data-i="' + i + '"><div class="v2a-post-av"><img src="/favicon.svg" alt=""></div><div class="v2a-post-c">'
        + '<div class="v2a-post-meta"><b>' + esc(it._reportType ? 'Desk DTP · ' + it._reportType : 'Desk DTP') + '</b><span>' + esc(dateHeure(it.timestamp)) + '</span></div>'
        + '<h2 class="v2a-post-t">' + esc(titreRapport(it)) + '</h2>'
        + (txt ? '<p class="v2a-post-txt">' + esc(txt) + '</p>' : '')
        + '<button type="button" class="v2a-lire" data-lire="' + i + '">Lire le rapport ' + svg(I.suite, 14, 2) + '</button></div></article>';
    }).join('');
    zone.onclick = function (ev) { var b = ev.target.closest('[data-lire], .v2a-post-t'); if (!b) return; var a = b.closest('.v2a-post'); vibre(); ouvrirRapport(items[+a.dataset.i]); };
  };

  /* ══ ÉCRAN FIL : le fil en direct, natif ══════════════════════════════════════════════════════════
     Mêmes éléments que le fil du desk (`getFilteredItems` : filtre Essentiel et sections compris),
     même titre affiché (`_newsDisplayTitle` : la traduction française quand elle existe), même règle
     d'importance (`_estNewsRouge`). Il se met à jour quand le desk reçoit une dépêche. */
  var filMode = 'tout', filLimite = 60, filOuverts = {}, filParId = {};
  /* ══ LE FIL DE L'APP PARLE COMME LE DESK (25/09, demande user : « met les bons tags et descriptions
     du desk web pour l'app mobile, garder cette cohérence »). Capture à l'appui : l'app affichait les
     tags BRUTS du serveur (« GEOPOLITICAL », « OIL »), en capitales, et une description réduite au
     texte source, là où le desk affiche « Géopolitique », la paire exposée (XAUUSD), l'indicateur
     avec son drapeau, puis Info / Analyse / Impact marché.
     ⚠️ ON NE RECOPIE PAS LES RÈGLES DU DESK, ON LES FAIT TOURNER. Les tags du desk tiennent sur une
     douzaine de filtres (doublons de catégorie, tags masqués, pays déjà dit par la devise, garde des
     taux, paire déduite, or sur le géopolitique, plafond des rapports…) écrits DANS buildNewsItem.
     Une copie divergerait au premier réglage. On lit donc la ligne que le desk a déjà construite
     (#news-list), ou on la lui fait construire, et on en reprend les tags tels quels.
     Même principe pour le dépliage : le contenu d'Info / Analyse / Impact marché est celui que le
     desk écrit dans SON panneau (résumé en cache, dépêche en repli, traduction en place, synthèse
     d'analyse d'événement…). Une ligne du desk, montée hors écran, ouvre son panneau ; l'app en
     reflète le contenu, y compris quand il change (squelette → texte définitif). */
  var PILLS = { analysis: '.tag--analyse', info: '.tag--info', impact: '.tag--impact' };
  var ORDRE_ONGLETS = ['analysis', 'info', 'impact'];   // l'ordre du dépliage par défaut du desk (_togglePanel)
  var rangsDesk = new Map();
  var cssEsc = function (x) { x = String(x); return window.CSS && CSS.escape ? CSS.escape(x) : x.replace(/["\\]/g, '\\$&'); };
  function rangDesk(it) {
    var r = null;
    try { r = document.querySelector('#news-list .news-item[data-id="' + cssEsc(it.id) + '"]'); } catch (e) {}
    if (r) return r;
    var c = rangsDesk.get(it.id);
    if (c && c.it === it) return c.el;
    var b = glob('buildNewsItem');
    if (typeof b !== 'function') return null;
    try { r = b(it); } catch (e) { return null; }
    rangsDesk.set(it.id, { it: it, el: r });
    if (rangsDesk.size > 400) rangsDesk.delete(rangsDesk.keys().next().value);
    return r;
  }
  // Tags du desk (sans les boutons de panneau) + onglets disponibles, dans l'ordre du desk.
  function tagsDesk(it) {
    var r = rangDesk(it);
    var zone = r && r.querySelector('.news-tags');
    if (!zone) return null;
    var html = '', onglets = [];
    Array.prototype.forEach.call(zone.children, function (t) {
      if (!t.classList || !t.classList.contains('tag')) return;
      if (t.classList.contains('tag--reaction')) return;   // graphique de réaction : desk seulement
      for (var k in PILLS) if (t.matches(PILLS[k])) { onglets.push({ k: k, html: t.innerHTML }); return; }
      html += '<span class="' + esc(t.className.replace(/\btag--active\b/g, '')) + '"' + (t.dataset.cat ? ' data-cat="' + esc(t.dataset.cat) + '"' : '') + '>' + t.innerHTML + '</span>';
    });
    // Les boutons gardent l'ordre du desk ; l'onglet ouvert par défaut suit sa préférence.
    var defaut = ORDRE_ONGLETS.filter(function (k) { return onglets.some(function (o) { return o.k === k; }); })[0] || null;
    return { html: html, onglets: onglets, defaut: defaut };
  }
  var miroirs = {};
  function hoteMiroir() {
    var h = document.getElementById('v2a-miroir-fil');
    if (!h) {
      h = document.createElement('div');
      h.id = 'v2a-miroir-fil'; h.setAttribute('aria-hidden', 'true');
      h.style.cssText = 'position:fixed;left:-10000px;top:0;width:560px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none';
      document.body.appendChild(h);
    }
    return h;
  }
  function panneauMiroir(m) { return m && m.el.querySelector('.news-content > .news-description'); }
  function copierMiroir(id) {
    var m = miroirs[id], exp = panneauMiroir(m);
    if (!exp) return;
    var corps = document.querySelector('#v2a-fil .v2a-news[data-id="' + cssEsc(id) + '"] .v2a-news-corps');
    if (corps && corps.innerHTML !== exp.innerHTML) corps.innerHTML = exp.innerHTML;
  }
  function fermerMiroir(id) {
    var m = miroirs[id];
    if (!m) return;
    delete miroirs[id];
    if (m.obs) m.obs.disconnect();
    // Refermer par le desk lui-même : il oublie alors le panneau (_openNewsPanels) et promeut ce
    // qu'il tenait en réserve pendant la lecture.
    if (m.tab) { var p = m.el.querySelector('.news-tags ' + PILLS[m.tab]); if (p) { try { p.click(); } catch (e) {} } }
    m.el.remove();
  }
  function ouvrirOnglet(it, k) {
    var m = miroirs[it.id];
    if (m && m.it !== it) { fermerMiroir(it.id); m = null; }
    if (!m) {
      var b = glob('buildNewsItem');
      if (typeof b !== 'function') return false;
      var el; try { el = b(it); } catch (e) { return false; }
      hoteMiroir().appendChild(el);
      m = miroirs[it.id] = { it: it, el: el, tab: null, obs: null };
      var exp = panneauMiroir(m);
      if (exp) { m.obs = new MutationObserver(function () { copierMiroir(it.id); }); m.obs.observe(exp, { childList: true, subtree: true, characterData: true }); }
    }
    var p = m.el.querySelector('.news-tags ' + PILLS[k]);
    if (!p) return false;
    if (m.tab !== k) { try { p.click(); } catch (e) { return false; } m.tab = k; }
    filOuverts[it.id] = k;
    copierMiroir(it.id);
    return true;
  }
  function modeEssentiel() { try { return !!glob('newsEssentialMode'); } catch (e) { return false; } }
  RENDUS.fil = function () {
    var e = ecrans.fil;
    if (!e.querySelector('#v2a-puces-fil')) {
      e.innerHTML = '<div class="v2a-puces" id="v2a-puces-fil"><button type="button" data-mode="tout">Tout</button><button type="button" data-mode="essentiel">Essentiel</button>'
        + '<button type="button" data-mode="important">Importantes</button></div><div class="v2a-fil" id="v2a-fil"></div>';
      e.querySelector('#v2a-puces-fil').addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return; vibre();
        var m = b.dataset.mode;
        var veutEss = m === 'essentiel';
        if (m !== 'important' && veutEss !== modeEssentiel()) appel('_toggleNewsMode');
        if (m === 'important' && modeEssentiel()) appel('_toggleNewsMode');
        filMode = m; filLimite = 60; RENDUS.fil();
      });
      e.querySelector('#v2a-fil').addEventListener('click', function (ev) {
        var plus = ev.target.closest('[data-plus]');
        if (plus) { filLimite += 60; RENDUS.fil(); return; }
        var art = ev.target.closest('.v2a-news'); if (!art || !art.dataset.ouvrable) return;
        var id = art.dataset.id, it = filParId[id];
        var og = ev.target.closest('[data-onglet]');
        if (!og && ev.target.closest('.v2a-news-corps')) return;   // lire / sélectionner le texte ne referme pas
        vibre();
        if (it && art.dataset.onglets) {
          // Même geste que le desk : un onglet ouvre SON contenu ; retoucher l'onglet actif, ou la
          // ligne, referme. La ligne ouvre l'onglet par défaut du desk (Analyse, sinon Info, sinon Impact).
          var k = og ? og.dataset.onglet : (filOuverts[id] ? filOuverts[id] : (art.dataset.defaut || art.dataset.onglets.split(',')[0]));
          if (filOuverts[id] === k) {
            delete filOuverts[id]; fermerMiroir(id);
            art.classList.remove('v2a-ouvert');
          } else if (ouvrirOnglet(it, k)) {
            art.classList.add('v2a-ouvert');
          }
          art.querySelectorAll('[data-onglet]').forEach(function (b) { b.classList.toggle('tag--active', b.dataset.onglet === filOuverts[id]); });
          return;
        }
        filOuverts[id] = !filOuverts[id]; art.classList.toggle('v2a-ouvert', !!filOuverts[id]);
      });
    }
    var eff = modeEssentiel() && filMode !== 'important' ? 'essentiel' : filMode;
    e.querySelectorAll('#v2a-puces-fil button').forEach(function (b) { b.classList.toggle('v2a-puce-on', b.dataset.mode === eff); });
    var src = glob('getFilteredItems'), rouge = glob('_estNewsRouge'), titre = glob('_newsDisplayTitle'), cat = glob('catFr');
    var items = [];
    try { items = typeof src === 'function' ? src().slice() : []; } catch (x) {}
    items.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    if (filMode === 'important' && typeof rouge === 'function') items = items.filter(function (it) { try { return rouge(it); } catch (x) { return false; } });
    /* LES PROPOS D'UN MÊME ORATEUR, REGROUPÉS COMME AU DESK (25/09, capture user : « je tape sur le
       tag Info, il s'affiche pas », sous « Fed's Schmid: … »). Le desk rassemble les déclarations
       d'une même intervention sous la première (`_groupSpeakerQuotes`), et c'est ce regroupement qui
       porte le tag Info : il ouvre la liste des propos. L'app affichait la liste BRUTE (trois lignes
       « Fed's Schmid » séparées), prenait les tags de la ligne regroupée du desk… puis reconstruisait
       la ligne hors écran depuis l'élément BRUT, qui n'a pas de propos rattachés, donc pas de tag
       Info : le toucher ne trouvait rien à ouvrir. On regroupe ici avec la fonction du desk (jamais
       une copie de ses règles) : même liste, même carte, même Info. */
    var grouper = glob('_groupSpeakerQuotes');
    if (typeof grouper === 'function') { try { items = grouper(items); } catch (x) {} }
    var liste = document.getElementById('v2a-fil');
    if (!items.length) { liste.innerHTML = '<p class="v2a-vide">Le fil est en direct : les dépêches apparaissent dès leur publication.</p>'; return; }
    var html = '', jour = '';
    filParId = {};
    items.slice(0, filLimite).forEach(function (it) {
      filParId[it.id] = it;
      var j = new Date(it.timestamp || 0).toDateString();
      if (j !== jour) { jour = j; html += '<div class="v2a-jour">' + esc(jourLong(it.timestamp)) + '</div>'; }
      var imp = false; try { imp = typeof rouge === 'function' && rouge(it); } catch (x) {}
      var t = ''; try { t = typeof titre === 'function' ? titre(it) : (it._titreFr || it.headline); } catch (x) { t = it.headline; }
      var desc = String(it._descFr || it.description || '').replace(/<[^>]+>/g, ' ').trim();
      var c = it.category ? (typeof cat === 'function' ? cat(it.category) : it.category) : '';
      var dk = null; try { dk = tagsDesk(it); } catch (x) {}
      if (dk) {
        // Ligne alignée sur le desk : ses tags, puis ses boutons Info / Analyse / Impact marché.
        var ks = dk.onglets.map(function (o) { return o.k; });
        var ouvert = filOuverts[it.id] && ks.indexOf(filOuverts[it.id]) >= 0 ? filOuverts[it.id] : null;
        if (filOuverts[it.id] && !ouvert) { delete filOuverts[it.id]; fermerMiroir(it.id); }
        html += '<article class="v2a-news v2a-news-dk' + (imp ? ' v2a-imp' : '') + (ouvert ? ' v2a-ouvert' : '') + '" data-id="' + esc(it.id) + '"' + (ks.length ? ' data-ouvrable="1" data-onglets="' + ks.join(',') + '" data-defaut="' + dk.defaut + '"' : '') + '>'
          + '<div class="v2a-news-meta">' + (imp ? '<span class="v2a-excl">!</span>' : '') + '<span>' + esc(dateHeure(it.timestamp)) + '</span>' + (c ? '<b>' + esc(c) + '</b>' : '') + '</div>'
          + '<div class="v2a-news-l">' + (ks.length ? '<span class="v2a-plus"><i></i></span>' : '') + '<p>' + esc(t) + '</p></div>'
          + '<div class="v2a-tags">' + dk.html + dk.onglets.map(function (o) { return '<button type="button" class="tag ' + PILLS[o.k].slice(1) + (o.k === ouvert ? ' tag--active' : '') + '" data-onglet="' + o.k + '">' + o.html + '</button>'; }).join('') + '</div>'
          + (ks.length ? '<div class="v2a-news-corps"></div>' : '') + '</article>';
        return;
      }
      // Repli (desk indisponible) : l'ancienne ligne, libellés traduits comme au desk.
      var trad = glob('NEWS_TAG_FR') || {};
      var tags = (Array.isArray(it.tags) ? it.tags : []).slice(0, 3).filter(function (x) { return x && x !== it.category; });
      html += '<article class="v2a-news' + (imp ? ' v2a-imp' : '') + (filOuverts[it.id] ? ' v2a-ouvert' : '') + '" data-id="' + esc(it.id) + '"' + (desc ? ' data-ouvrable="1"' : '') + '>'
        + '<div class="v2a-news-meta">' + (imp ? '<span class="v2a-excl">!</span>' : '') + '<span>' + esc(dateHeure(it.timestamp)) + '</span>' + (c ? '<b>' + esc(c) + '</b>' : '') + '</div>'
        + '<div class="v2a-news-l">' + (desc ? '<span class="v2a-plus"><i></i></span>' : '') + '<p>' + esc(t) + '</p></div>'
        + (desc ? '<div class="v2a-news-desc">' + esc(desc) + '</div>' : '')
        + '<div class="v2a-tags">' + tags.map(function (x) { return '<span>' + esc(trad[x] || x) + '</span>'; }).join('') + '</div></article>';
    });
    if (items.length > filLimite) html += '<button type="button" class="v2a-charger" data-plus="1">Charger plus (' + (items.length - filLimite) + ')</button>';
    liste.innerHTML = html;
    // Le fil vient d'être réécrit : on y reverse le contenu des panneaux ouverts.
    Object.keys(miroirs).forEach(function (id) { if (filOuverts[id]) copierMiroir(id); else fermerMiroir(id); });
  };
  // Le desk reçoit une dépêche → il redessine #news-list → l'écran Fil suit (regroupé, 400 ms).
  var filMaj = null;
  function brancherFil() {
    var nl = document.getElementById('news-list');
    if (!nl || nl._v2a) return; nl._v2a = true;
    new MutationObserver(function () { if (courant !== 'fil') return; clearTimeout(filMaj); filMaj = setTimeout(RENDUS.fil, 400); }).observe(nl, { childList: true });
  }

  /* ══ ÉCRAN MARCHÉS : régime de risque + force des devises (référence « Heatmaps ») + outils ════════
     Rien d'inventé : le régime vient de /api/risk-sentiment (la jauge du desk), la force de
     /api/currency-strength à l'échelle de la courbe du desk (même formule que `computeScale`). */
  var LIB_RISQUE = { 'STRONG RISK-ON': 'Risk-on marqué', 'RISK-ON': 'Risk-on', 'WEAK RISK-ON': 'Risk-on léger', 'NEUTRAL': 'Neutre',
    'WEAK RISK-OFF': 'Risk-off léger', 'RISK-OFF': 'Risk-off', 'STRONG RISK-OFF': 'Risk-off marqué' };
  var NOMS = { USD: 'Dollar américain', EUR: 'Euro', JPY: 'Yen japonais', GBP: 'Livre sterling', AUD: 'Dollar australien',
    CHF: 'Franc suisse', CAD: 'Dollar canadien', NZD: 'Dollar néo-zélandais' };
  var PAYS = { USD: 'us', EUR: 'eu', JPY: 'jp', GBP: 'gb', AUD: 'au', CHF: 'ch', CAD: 'ca', NZD: 'nz' };
  var UT = [['today', 'TD'], ['week', 'TW'], ['8h', '8H'], ['1d', '1D'], ['7d', '7D'], ['1m', '1M']];
  var periode = 'today', minuterie = null;
  var heure = function (iso) { try { return new Date(iso || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  function echelle(d) {
    var BASE = 100, abs = [];
    (d.currencies || []).forEach(function (c) { (d.series[c] || []).forEach(function (x) { if (x.v != null) abs.push(Math.abs(x.v)); }); });
    abs.sort(function (a, b) { return a - b; });
    var ref = abs.length > 10 ? abs[Math.floor(abs.length * 0.99)] : (abs[abs.length - 1] || 0.01);
    var refMax = ref * BASE, CAP = 70;
    return refMax > CAP ? (BASE * CAP / refMax) : BASE;
  }
  window._v2aEchelle = echelle;
  function arreterMarches() { if (minuterie) { clearInterval(minuterie); minuterie = null; } }
  RENDUS.markets = function () {
    var e = ecrans.markets;
    if (!e.querySelector('#v2a-risque')) {
      e.insertAdjacentHTML('beforeend', '<div class="v2a-carte" id="v2a-risque"><div class="v2a-carte-titre">Sentiment de risque</div><div class="v2a-attente">Chargement…</div></div>'
        + '<div class="v2a-carte"><div class="v2a-carte-titre">Force des devises</div>'
        + '<div class="v2a-ut">' + UT.map(function (u) { return '<button type="button" data-ut="' + u[0] + '"' + (u[0] === periode ? ' class="v2a-ut-on"' : '') + '>' + u[1] + '</button>'; }).join('') + '</div>'
        + '<div id="v2a-force"><div class="v2a-attente">Chargement…</div></div></div>'
        // Même grille et même carte que le desk V3 (cohérence desk / app, demande user du 24/09).
        + '<div class="v2a-carte"><div class="v2a-carte-titre">Multi-actifs</div><div id="v2a-multi" class="v2a-embarque" style="height:460px"></div></div>'
        + '<div class="v2a-carte"><div class="v2a-carte-titre">Carte du monde</div><div id="v2a-carte-monde" class="v2a-embarque" style="height:420px"></div></div>'
        + '<div class="v2a-carte v2a-outils"><div class="v2a-carte-titre">Outils du desk</div><div class="v2a-grille">'
        + OUTILS.filter(function (o) { return o.natif || existe(o.v); }).map(function (o) { return '<button type="button" class="v2a-tuile" data-v2v="' + o.v + '">' + svg(o.ico, 22) + '<span>' + o.t + '</span></button>'; }).join('')
        + '<button type="button" class="v2a-tuile" id="v2a-detail">' + svg(I.horloge, 22) + '<span>Horloges & sessions</span></button>'
        // Ce que le desk offrait et que l'app n'ouvrait pas (25/09, « il manque encore des choses du desk ») :
        // le Flash Marché et la vue d'une paire (COT, saisonnalité, particuliers, biais).
        + '<button type="button" class="v2a-tuile" id="v2a-flash">' + svg('M4 12h2l2-6 4 12 3-9 2 3h3', 22) + '<span>Flash Marché</span></button>'
        + '<button type="button" class="v2a-tuile" id="v2a-paires">' + svg('M4 7h12l-3-3M20 17H8l3 3', 22) + '<span>Paires</span></button>'
        + '</div></div>');
      e.querySelector('.v2a-ut').addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-ut]'); if (!b) return;
        vibre(); periode = b.dataset.ut;
        e.querySelectorAll('.v2a-ut button').forEach(function (x) { x.classList.toggle('v2a-ut-on', x === b); });
        chargerForce();
      });
      e.querySelector('.v2a-outils').addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-v2v]'); if (!b) return;
        if (b.dataset.v2v === 'widgets') window._v2aDeskDemande = true;
        vibre(); aller(b.dataset.v2v);
      });
      document.getElementById('v2a-flash').addEventListener('click', function () { vibre(); appel('sqwkOpen'); });
      document.getElementById('v2a-paires').addEventListener('click', function () { vibre(); ouvrirPaires(); });
      document.getElementById('v2a-detail').addEventListener('click', function () { vibre(); montrerEcran(null); pile.push('markets'); window.activateView('markets'); marquer('markets'); H.classList.add('v2a-sous-ecran'); var r = document.getElementById('v2a-retour'); if (r) r.hidden = false; });
    }
    // Les deux widgets V3 se montent une fois (ils se relisent seuls) ; leurs scripts peuvent arriver
    // après l'écran : on réessaie à chaque ouverture tant qu'ils ne sont pas là.
    var mu = document.getElementById('v2a-multi'), cm = document.getElementById('v2a-carte-monde');
    if (mu && !mu._monte && typeof window._v3MultiMonter === 'function') { mu._monte = true; window._v3MultiMonter(mu); }
    if (cm && !cm._monte && typeof window._v3CarteMonter === 'function') { cm._monte = true; window._v3CarteMonter(cm, {}); }
    chargerRisque(); chargerForce();
    arreterMarches();
    minuterie = setInterval(function () { if (document.visibilityState === 'visible') { chargerRisque(); chargerForce(); } }, 60000);
  };
  function chargerRisque() {
    fetch('/api/risk-sentiment').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var el = document.getElementById('v2a-risque'); if (!el) return;
      if (!d || !d.label) { el.innerHTML = '<div class="v2a-carte-titre">Sentiment de risque</div><div class="v2a-attente">Donnée momentanément indisponible.</div>'; return; }
      var on = 0, off = 0;
      (d.assets || []).forEach(function (a) { var s = (+a.chg || 0) * (+a.dir || 0); if (s > 0) on++; else if (s < 0) off++; });
      var ton = /RISK-ON/.test(d.label) ? 'on' : (/RISK-OFF/.test(d.label) ? 'off' : 'neutre');
      var pct = Math.max(-100, Math.min(100, +d.pct || 0));
      el.innerHTML = '<div class="v2a-carte-titre">Sentiment de risque</div>'
        + '<div class="v2a-risque-pill v2a-' + ton + '"><span class="v2a-risque-lib">' + esc(LIB_RISQUE[d.label] || d.label) + '</span>' + svg(ton === 'off' ? I.baisse : I.hausse, 20, 1.8) + '</div>'
        + '<div class="v2a-risque-cpt">Risk-on : <b class="v2a-on">' + on + '</b> · Risk-off : <b class="v2a-off">' + off + '</b> · Score : <b>' + (pct > 0 ? '+' : '') + pct.toFixed(1).replace('.', ',') + '%</b></div>'
        + '<div class="v2a-jauge"><i style="left:' + (50 + pct / 2) + '%"></i></div>'
        + (d.description ? '<p class="v2a-risque-txt">' + esc(d.description) + '</p>' : '');   // ligne « N actifs suivis · cotations » retirée (25/09)
    }).catch(function () {});
  }
  function chargerForce() {
    var p = periode;
    fetch('/api/currency-strength?period=' + encodeURIComponent(p)).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var el = document.getElementById('v2a-force'); if (!el || p !== periode) return;
      if (!d || !d.series) { el.innerHTML = '<div class="v2a-attente">Donnée momentanément indisponible.</div>'; return; }
      var k = echelle(d);
      var lignes = (d.currencies || []).map(function (c) {
        var s = d.series[c] || [], der = null;
        for (var i = s.length - 1; i >= 0; i--) if (s[i] && s[i].v != null) { der = s[i].v; break; }
        return { c: c, v: der == null ? null : der * k };
      }).filter(function (x) { return x.v != null; }).sort(function (a, b) { return b.v - a.v; });
      var max = Math.max.apply(null, lignes.map(function (x) { return Math.abs(x.v); }).concat([1]));
      el.innerHTML = lignes.map(function (x) {
        var larg = Math.min(50, Math.abs(x.v) / max * 50), sens = x.v >= 0 ? 'pos' : 'neg';
        return '<div class="v2a-force-ligne"><div class="v2a-force-h">'
          + '<img src="https://flagcdn.com/w40/' + PAYS[x.c] + '.png" alt="" loading="lazy">'
          + '<div class="v2a-force-nom"><b>' + x.c + '</b><span>' + (NOMS[x.c] || '') + '</span></div>'
          + '<div class="v2a-force-val v2a-' + sens + '">' + svg(sens === 'pos' ? I.hausse : I.baisse, 16, 1.8) + (x.v > 0 ? '+' : '') + x.v.toFixed(2).replace('.', ',') + '</div></div>'
          + '<div class="v2a-force-barre"><i class="v2a-' + sens + '" style="width:' + larg.toFixed(1) + '%;' + (sens === 'pos' ? 'left:50%' : 'right:50%') + '"></i><s></s></div></div>';
      }).join('') + '<div class="v2a-source">Même calcul que la courbe du desk · ' + heure(d.updatedAt) + '</div>';
    }).catch(function () {});
  }

  /* ══ ÉCRAN ANALYSTES : la liste des rapports en cartes (référence « Analysts Reports ») ═══════════ */
  /* ══ ANALYSTES, ALIGNÉ SUR LE DESK (25/09, « idem pour l'onglet Analystes ») ═══════════════════════
     La liste affichait sous chaque titre les tags BRUTS du rapport (« USD / JPY », « boj »), que le
     desk n'affiche nulle part : sa liste porte la date, le titre standardisé, le logo DTP et un filtre
     par TYPE de fichier. On reprend exactement ce vocabulaire (arlibItemType + les libellés du
     sélecteur #arlib-type), en puces : seuls les types présents dans la liste sont proposés.
     ⚠️ La liste ne se dessinait qu'UNE fois : les rapports qui arrivent après les récaps de séance
     (hebdo, récap quotidien, lus sur trois routes différentes) n'apparaissaient qu'en quittant puis en
     rouvrant l'onglet. Elle suit désormais le rendu du desk (#arlib-list), comme le Fil suit #news-list. */
  var TYPES_RAPPORT = [['all', 'Tous'], ['fxdaily', 'Récap FX quotidien'], ['recap', 'Récap de session'], ['weekly', 'Récap hebdomadaire'], ['briefing', 'Briefing quotidien']];
  var typeRapport = 'all', anMaj = null;
  function libelleType(k) { for (var i = 0; i < TYPES_RAPPORT.length; i++) if (TYPES_RAPPORT[i][0] === k) return TYPES_RAPPORT[i][1]; return ''; }
  function brancherAnalystes() {
    var l = document.getElementById('arlib-list');
    if (!l || l._v2a) return; l._v2a = true;
    new MutationObserver(function () { if (courant !== 'analystes') return; clearTimeout(anMaj); anMaj = setTimeout(RENDUS.analystes, 400); }).observe(l, { childList: true });
  }
  RENDUS.analystes = function () {
    var e = ecrans.analystes;
    brancherAnalystes();
    var tf = glob('arlibItemType');
    var typeDe = function (it) { try { return typeof tf === 'function' ? tf(it) : ''; } catch (x) { return ''; } };
    var tous = itemsRapports().slice();   // l'ordre du desk (getArlibItems), pas un tri refait ici
    if (!tous.length) { e.innerHTML = '<p class="v2a-vide">Chargement des rapports…</p>'; appel('loadAnalystView'); setTimeout(function () { if (courant === 'analystes') RENDUS.analystes(); }, 2500); return; }
    var presents = {}; tous.forEach(function (it) { presents[typeDe(it)] = true; });
    if (typeRapport !== 'all' && !presents[typeRapport]) typeRapport = 'all';
    var items = (typeRapport === 'all' ? tous : tous.filter(function (it) { return typeDe(it) === typeRapport; })).slice(0, 80);
    var lu = glob('isRead'), rk = glob('_reportReadKey');
    var puces = TYPES_RAPPORT.filter(function (t) { return t[0] === 'all' || presents[t[0]]; });
    e.innerHTML = (puces.length > 2 ? '<div class="v2a-puces v2a-puces-an">' + puces.map(function (t) { return '<button type="button" data-type="' + t[0] + '"' + (t[0] === typeRapport ? ' class="v2a-puce-on"' : '') + '>' + esc(t[1]) + '</button>'; }).join('') + '</div>' : '')
      + '<div class="v2a-liste">' + items.map(function (it, i) {
      var dejaLu = false; try { dejaLu = typeof lu === 'function' && typeof rk === 'function' && lu(rk(it)); } catch (x) {}
      var ia = estDtp(it), lib = libelleType(typeDe(it));
      return '<button type="button" class="v2a-rapport' + (dejaLu ? ' v2a-lu' : '') + '" data-i="' + i + '">'
        + (ia ? '<span class="v2a-badge-ia">' + svg('M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z', 13, 1.6) + 'Rédigé par le desk DTP</span>' : '')
        + '<span class="v2a-rapport-t">' + esc(titreRapport(it)) + '</span>'
        + '<span class="v2a-rapport-d">' + esc(dateCourte(it.timestamp)) + '</span>'
        + (lib ? '<span class="v2a-rapport-s">' + esc(lib) + '</span>' : '')
        + '</button>';
    }).join('') + (items.length ? '' : '<p class="v2a-vide">Aucun rapport de ce type pour le moment.</p>') + '</div>';
    e.onclick = function (ev) {
      var t = ev.target.closest('[data-type]');
      if (t) { vibre(); typeRapport = t.dataset.type; RENDUS.analystes(); return; }
      var b = ev.target.closest('.v2a-rapport'); if (!b) return; vibre(); ouvrirRapport(items[+b.dataset.i]);
    };
  };

  /* ══ ÉCRAN BANQUES : les rapports institutionnels en cartes (référence « Bank Reports ») ═══════════ */
  RENDUS.banques = function () {
    var e = ecrans.banques;
    var br = glob('_brArticles'), badgeF = glob('_instBadge'), coul = glob('_instBrandColor'), ok = glob('_brAllowed');
    var items = (Array.isArray(br) ? br : []).filter(function (it) { try { return typeof ok !== 'function' || ok(it); } catch (x) { return true; } })
      .slice().sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); }).slice(0, 60);
    /* ⚠️ Jamais de chargement sans fin (25/09) : après six essais vides (≈ 20 s), l'écran le dit et
       propose de réessayer, au lieu de « Chargement… » à perpétuité. */
    if (!items.length) {
      RENDUS.banques._essais = (RENDUS.banques._essais || 0) + 1;
      if (RENDUS.banques._essais > 6) {
        e.innerHTML = '<div class="v2a-vide">Les rapports de banques ne répondent pas pour le moment.<br><button type="button" class="v2a-reessai">Réessayer</button></div>';
        e.onclick = function (ev) { if (!ev.target.closest('.v2a-reessai')) return; vibre(); RENDUS.banques._essais = 0; RENDUS.banques(); };
        return;
      }
      e.innerHTML = '<p class="v2a-vide">Chargement des rapports de banques…</p>';
      if (RENDUS.banques._essais === 1 || RENDUS.banques._essais % 2 === 0) appel('_loadBrArticles', 0);
      setTimeout(function () { if (courant === 'banques') RENDUS.banques(); }, 3000);
      return;
    }
    RENDUS.banques._essais = 0;
    var luBr = glob('_brReadIds');
    e.innerHTML = '<div class="v2a-cartes">' + items.map(function (it, i) {
      var b = 'DTP'; try { b = typeof badgeF === 'function' ? badgeF(it) : (it.institution || 'Banque'); } catch (x) {}
      var c = '#e3b23a'; try { if (typeof coul === 'function') c = coul(b); } catch (x) {}
      var tags = (Array.isArray(it.tags) ? it.tags : []).slice(0, 3);
      var estLu = false; try { estLu = !!(luBr && luBr.has && luBr.has(it.id)); } catch (x) {}
      return '<button type="button" class="v2a-banque' + (estLu ? ' v2a-lu' : '') + '" data-i="' + i + '"><span class="v2a-banque-h"><span class="v2a-banque-logo" style="background:' + esc(c) + '">' + esc(b.charAt(0)) + '</span>'
        + '<b style="color:' + esc(c) + '">' + esc(b) + '</b><span class="v2a-banque-d">' + svg(I.cal, 15) + esc(dateCourte(it.timestamp)) + '</span></span>'
        + '<span class="v2a-banque-t">' + esc(it.title || it.headline || '') + '</span>'
        + '<span class="v2a-banque-p">' + tags.map(function (x) { return '<i>' + esc(x) + '</i>'; }).join('') + '<em>' + svg(I.suite, 18, 1.8) + '</em></span></button>';
    }).join('') + '</div>';
    e.onclick = function (ev) {
      var b = ev.target.closest('.v2a-banque'); if (!b) return; vibre();
      var it = items[+b.dataset.i];
      try { var mk = glob('markBrRead'); if (typeof mk === 'function') mk(it.id); } catch (x) {}
      aller('institution');
      var t = document.getElementById('v2a-titre'); if (t) t.textContent = 'Rapport';
      try { var r = glob('renderBrReader'); if (typeof r === 'function') r(it); } catch (x) {}
    };
  };

  /* ══ NOTIFICATIONS DU TÉLÉPHONE (Web Push, 24/09) ══════════════════════════════════════════════════
     Demande user : « recevoir la notif sur mon iPhone comme une app installée, idem Android, jusqu'à
     l'écran verrouillé ». Trois conditions, toutes vérifiées ici plutôt que supposées :
       · iPhone : iOS 16.4 ou plus, ET DTP ouvert depuis l'icône de l'écran d'accueil (Safari seul
         n'expose pas PushManager) ;
       · l'autorisation se demande dans un TOUCHER de l'utilisateur, jamais au chargement ;
       · l'abonnement suit la clé du serveur : si elle a changé, on se réabonne. */
  var WP = { etat: '', message: '' };
  var wpIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  var wpAutonome = (window.navigator.standalone === true) || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  var wpPossible = function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; };
  var wpPlat = function () { return wpIOS ? 'ios' : (/Android/i.test(navigator.userAgent) ? 'android' : 'ordinateur'); };
  function wpOctets(b) { var p = '='.repeat((4 - b.length % 4) % 4), r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
  function wpMemeCle(sub, cle) {
    try { var a = new Uint8Array(sub.options.applicationServerKey), b = wpOctets(cle); if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; } catch (e) { return true; }
  }
  function wpJson(url, corps) {
    return fetch(url, corps ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps), credentials: 'same-origin' } : { credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d._statut = r.status; return d; }); });
  }
  // Attente bornée : `serviceWorker.ready` n'aboutit jamais sans service worker enregistré.
  function wpPret() { return Promise.race([navigator.serviceWorker.ready, new Promise(function (_, ko) { setTimeout(function () { ko(new Error('Service de notifications indisponible sur cet appareil.')); }, 8000); })]); }
  function wpLireEtat() {
    if (!wpPossible()) { WP.etat = (wpIOS && !wpAutonome) ? 'ecran' : 'impossible'; return Promise.resolve(); }
    if (Notification.permission === 'denied') { WP.etat = 'refuse'; return Promise.resolve(); }
    return wpPret().then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) { WP.etat = (sub && Notification.permission === 'granted') ? 'actif' : 'inactif'; })
      .catch(function () { WP.etat = 'inactif'; });
  }
  function wpActiver() {
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { WP.etat = perm === 'denied' ? 'refuse' : 'inactif'; throw new Error('Autorisation non accordée.'); }
      return Promise.all([wpPret(), wpJson('/api/webpush/cle')]);
    }).then(function (x) {
      var reg = x[0], cle = x[1] && x[1].cle;
      if (!cle) throw new Error('Clé du serveur indisponible.');
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub && !wpMemeCle(sub, cle)) return sub.unsubscribe().then(function () { return null; });
        return sub;
      }).then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wpOctets(cle) }); });
    }).then(function (sub) {
      return wpJson('/api/webpush/abonner', { abonnement: sub.toJSON(), plat: wpPlat() });
    }).then(function (d) { if (!d.ok) throw new Error('Enregistrement refusé par le serveur.'); WP.etat = 'actif'; });
  }
  function wpDesactiver() {
    return wpPret().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return sub.unsubscribe().then(function () { return wpJson('/api/webpush/desabonner', { endpoint: ep }); });
    }).then(function () { WP.etat = 'inactif'; });
  }
  /* Ce qui peut sonner (25/09) : les cinq familles du serveur, le son et le vibreur. Le choix vit sur
     le COMPTE (/api/push-prefs) : il vaut pour le desk, le téléphone et l'app native à la fois. */
  var PP = { prefs: null, familles: [], banques: [], charge: false };
  // « Nouveau » pendant trois mois (25/09) : l'étiquette invite à activer, puis disparaît d'elle-même.
  var NOUVEAU_JUSQUA = Date.UTC(2026, 11, 26);
  var nouveau = function () { return Date.now() < NOUVEAU_JUSQUA ? '<em class="v2a-neuf">Nouveau</em>' : ''; };
  function ppCharger() {
    if (PP.charge) return; PP.charge = true;
    wpJson('/api/push-prefs').then(function (d) {
      if (d && d.ok) { PP.prefs = d.prefs; PP.familles = d.familles || []; PP.banques = d.banquesDispo || []; if (courant === 'compte') RENDUS.compte(true); }
      else PP.charge = false;
    }).catch(function () { PP.charge = false; });
  }
  function ppBloc() {
    if (!PP.prefs) { ppCharger(); return ''; }
    var bascule = function (on, dis) { return '<i class="v2a-bascule' + (on ? ' v2a-on-b' : '') + (dis ? ' v2a-bascule-off' : '') + '"></i>'; };
    var ligneP = function (act, k, nom, desc, on, dis) { return '<button type="button" class="v2a-ligne v2a-choix" data-act="' + act + '"' + (k ? ' data-k="' + k + '"' : '') + (dis ? ' disabled' : '') + '><span class="v2a-choix-t"><b>' + esc(nom) + '</b>' + (desc ? '<small>' + esc(desc) + '</small>' : '') + '</span>' + bascule(on, dis) + '</button>'; };
    // Sous une famille cochée, ses réglages fins : une rangée de choix, un seul toucher.
    var segs = function (act, val, opts) { return '<div class="v2a-segs">' + opts.map(function (o) { return '<button type="button" class="v2a-seg-b' + (val === o[0] ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; };
    var fins = function (k) {
      var p = PP.prefs;
      if (k === 'news') return segs('ppfil', p.fil || 'tout', [['tout', 'Toutes les importantes'], ['eco', 'Économie'], ['geo', 'Géopolitique']]);
      if (k === 'analystes') return segs('pprecaps', p.recaps || 'tous', [['tous', 'Tous les récaps'], ['quotidien', 'Quotidiens'], ['hebdo', 'Hebdo']]);
      if (k === 'banques' && PP.banques.length) {
        var ch = p.banques || [];
        return '<div class="v2a-segs v2a-segs--b"><button type="button" class="v2a-seg-b' + (ch.length ? '' : ' on') + '" data-act="ppbanque" data-v="*">Toutes</button>'
          + PP.banques.map(function (b) { return '<button type="button" class="v2a-seg-b' + (ch.indexOf(b) >= 0 ? ' on' : '') + '" data-act="ppbanque" data-v="' + esc(b) + '">' + esc(b) + '</button>'; }).join('') + '</div>';
      }
      return '';
    };
    var h = '</div><h3 class="v2a-rubrique">Ce que vous recevez ' + nouveau() + '<small>sur tous vos appareils</small></h3><div class="v2a-groupe">';
    PP.familles.forEach(function (f) { var on = PP.prefs.cats.indexOf(f.k) >= 0; h += ligneP('pp', f.k, f.nom, f.desc, on) + (on ? fins(f.k) : ''); });
    h += ligneP('ppson', '', 'Son', '', PP.prefs.son);
    h += ligneP('ppvib', '', 'Vibreur', PP.prefs.son ? '' : 'Sans le son, le téléphone ne vibre pas non plus.', PP.prefs.son && PP.prefs.vibreur, !PP.prefs.son);
    h += '<div class="v2a-wp-aide">Seul l’important part : une pause par famille regroupe le reste en une seule notification, et une dépêche urgente passe toujours. Sur iPhone, le son et la vibration suivent aussi les réglages de notifications de l’iPhone.</div>';
    return h;
  }
  function wpBloc() {
    var ligne = function (ico, txt, act, extra) { return '<button type="button" class="v2a-ligne" data-act="' + act + '">' + svg(ico, 22) + '<span>' + txt + '</span>' + (extra || svg(I.suite, 18, 1.8)) + '</button>'; };
    var h = '<h3 class="v2a-rubrique">Notifications du téléphone</h3><div class="v2a-groupe">';
    if (WP.etat === 'ecran') {
      h += '<div class="v2a-wp-aide"><b>Sur iPhone, une étape d’abord</b>Dans Safari, touchez <b>Partager</b> puis <b>Sur l’écran d’accueil</b>, et rouvrez DTP depuis son icône. Les notifications arrivent alors comme celles d’une application, écran verrouillé compris (iOS 16.4 ou plus).</div>';
    } else if (WP.etat === 'impossible' && window.ReactNativeWebView) {
      // Dans l'app native, les notifications passent par l'app elle-même : il ne reste qu'à choisir.
      h += '<div class="v2a-wp-aide">Les alertes arrivent par l’application DataTradingPro. Choisissez ci-dessous ce qui peut sonner.</div>' + ppBloc();
    } else if (WP.etat === 'impossible') {
      h += '<div class="v2a-wp-aide">Ce navigateur ne prend pas en charge les notifications. Utilisez Chrome sur Android, ou DTP ajouté à l’écran d’accueil sur iPhone.</div>';
    } else if (WP.etat === 'refuse') {
      h += '<div class="v2a-wp-aide"><b>Notifications bloquées</b>Autorisez-les pour DataTradingPro dans les réglages du téléphone, puis revenez ici.</div>';
    } else {
      h += ligne(I.cloche, 'Recevoir les alertes sur cet appareil', 'wp', '<i class="v2a-bascule' + (WP.etat === 'actif' ? ' v2a-on-b' : '') + '"></i>');
      h += ppBloc();   // le choix vaut pour tous les appareils du compte : visible avant même l'abonnement
    }
    if (WP.message) h += '<div class="v2a-wp-msg' + (WP.erreur ? ' v2a-wp-err' : '') + '">' + esc(WP.message) + '</div>';
    return h + '</div>';
  }

  /* ══ ÉCRAN COMPTE (référence « Account ») ══════════════════════════════════════════════════════════ */
  var LANGUES = [['fr', 'Français', 'fr'], ['en', 'English', 'gb'], ['de', 'Deutsch', 'de'], ['es', 'Español', 'es']];
  var langue = function () { try { return (localStorage.getItem('dtp_lang') || 'fr').slice(0, 2).toLowerCase(); } catch (x) { return 'fr'; } };
  /* ══ COMPTE EN PAGES (25/09, « quand je clique ça ne marche pas : que ça emmène vers l'espace ») ═══
     L'écran Compte est un SOMMAIRE, comme les réglages d'un téléphone : chaque ligne ouvre sa page
     (Fuseau horaire, Abonnement, Notifications, Préférences, Langue), et Retour ramène au sommaire.
     Les alertes rejoignent la page Notifications. */
  var sousCompte = null;
  var PAGES_COMPTE = { profil: 'Profil', nom: 'Nom affiché', email: 'Adresse e-mail', mdp: 'Mot de passe', fuseau: 'Fuseau horaire', abo: 'Abonnement', notifs: 'Notifications', prefs: 'Préférences', langue: 'Langue' };
  /* PROFIL ÉDITABLE (25/09, demande user) : toucher la photo la change (une pastille appareil photo le
     dit), le nom se modifie sur place ; l'e-mail quitte l'en-tête pour la page « Profil », première du
     sommaire ; « Identifiants » regroupe nom, e-mail et mot de passe. La photo passe par le sélecteur
     du desk (#pd-avatar-file) : même recadrage, même poids, même enregistrement sur le compte. */
  var CPT = { edNom: false, msg: '', err: false };
  var dateFr = function (d) { try { var x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; } };
  var dateCourte = function (d) { try { var x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); } catch (e) { return ''; } };
  function choisirPhoto() {
    var i = document.getElementById('pd-avatar-file'); if (!i) return;
    // Le desk met l'avatar à jour à la fin de la lecture : on repeint le Compte juste après.
    var apres = function () { i.removeEventListener('change', apres); setTimeout(function () { if (courant === 'compte') RENDUS.compte(true); }, 900); };
    i.addEventListener('change', apres); i.click();
  }
  function enregistrerNom(nom) {
    nom = String(nom || '').replace(/\s+/g, ' ').trim();
    if (!nom) { CPT.msg = 'Le nom ne peut pas être vide.'; CPT.err = true; RENDUS.compte(true); return; }
    fetch('/api/auth/me/profile', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nom }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok && d && d.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error((x.d && x.d.error) || 'Enregistrement impossible.');
        if (window._pdUser) window._pdUser.name = x.d.name || nom;
        var h = document.getElementById('pd-hdr-username'); if (h) h.textContent = x.d.name || nom;
        var c = document.getElementById('pd-name'); if (c) c.value = x.d.name || nom;
        CPT.edNom = false; CPT.msg = 'Nom enregistré.'; CPT.err = false;
      })
      .catch(function (e) { CPT.msg = e.message || 'Enregistrement impossible.'; CPT.err = true; })
      .then(function () { RENDUS.compte(true); });
  }
  function changerMdp(f) {
    var cur = f.cur.value, n1 = f.n1.value, n2 = f.n2.value;
    var ko = !cur || !n1 ? 'Remplissez les trois champs.' : n1 !== n2 ? 'Les deux nouveaux mots de passe ne correspondent pas.' : n1.length < 8 ? 'Au moins 8 caractères.' : '';
    if (ko) { CPT.msg = ko; CPT.err = true; RENDUS.compte(true); return; }
    fetch('/api/auth/me/password', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: cur, newPassword: n1 }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d || !d.ok) throw new Error((d && d.error) || 'Changement refusé.'); CPT.msg = 'Mot de passe modifié. Vos autres appareils devront se reconnecter.'; CPT.err = false; })
      .catch(function (e) { CPT.msg = e.message || 'Changement refusé.'; CPT.err = true; })
      .then(function () { RENDUS.compte(true); });
  }
  var FUSEAUX = ['Europe/Paris', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Dubai', 'UTC'];
  var nomTz = function (tz) { return String(tz || '').replace(/_/g, ' ').replace('/', ' / '); };
  var tzAppareil = function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (x) { return ''; } };
  var tzChoisi = function () { try { return localStorage.getItem('dtp_tz') || tzAppareil() || 'Europe/Paris'; } catch (x) { return tzAppareil() || 'Europe/Paris'; } };
  var heureTz = function (tz) { try { return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date()); } catch (x) { return ''; } };
  var PLANS = { full: 'Accès complet', pro: 'Professionnel', professionnel: 'Professionnel', premium: 'Premium', trial: 'Essai', essai: 'Essai', basic: 'Essentiel' };
  var nomPlan = function (u) { var p = String(u.planLabel || u.plan || '').trim(); return PLANS[p.toLowerCase()] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Accès DTP'); };
  RENDUS.compte = function (relu) {
    if (!relu) { sousCompte = null; CPT.edNom = false; CPT.msg = ''; }
    var u = window._pdUser || {}, e = ecrans.compte;
    var av = document.getElementById('topbar-avatar');
    var ech = u.expires_at || u.expiresAt;
    var t = document.getElementById('v2a-titre'); if (t) t.textContent = sousCompte ? PAGES_COMPTE[sousCompte] : 'Compte';
    var ligne = function (ico, txt, act, extra) { return '<button type="button" class="v2a-ligne" data-act="' + act + '">' + svg(ico, 22) + '<span>' + txt + '</span>' + (extra || svg(I.suite, 18, 1.8)) + '</button>'; };
    var valeur = function (v) { return '<em class="v2a-val">' + esc(v) + '</em>' + svg(I.suite, 18, 1.8); };
    var coche = svg('M5 12l5 5 9-11', 18, 2.2);
    var h = '';
    if (!sousCompte) {
      var notifsOn = WP.etat === 'actif' || (WP.etat === 'impossible' && !!window.ReactNativeWebView);
      var nom = u.name || u.username || 'Mon compte';
      h = '<div class="v2a-profil">'
        + '<button type="button" class="v2a-profil-ph" data-act="photo" aria-label="Changer la photo de profil"><span class="v2a-profil-av">' + (av ? av.innerHTML : '') + '</span>'
        + '<i class="v2a-profil-cam">' + svg(I.photo, 13, 2) + '</i></button>'
        + (CPT.edNom
          ? '<form class="v2a-profil-ed" data-form="nom"><input class="v2a-champ" name="nom" maxlength="80" value="' + esc(nom) + '" autocomplete="name" aria-label="Votre nom"><button type="submit" class="v2a-mini-ok">OK</button></form>'
          : '<button type="button" class="v2a-profil-nom" data-act="nom"><b>' + esc(nom) + '</b>' + svg(I.crayon, 14, 2) + '</button>')
        + '<span class="v2a-profil-plan">' + esc(nomPlan(u)) + '</span>'
        + (CPT.msg ? '<div class="v2a-wp-msg' + (CPT.err ? ' v2a-wp-err' : '') + '">' + esc(CPT.msg) + '</div>' : '') + '</div>'
        + '<h3 class="v2a-rubrique">Profil</h3><div class="v2a-groupe">'
        + ligne(I.compte, 'Informations personnelles', 'page:profil')
        + '</div>'
        + '<h3 class="v2a-rubrique">Identifiants</h3><div class="v2a-groupe">'
        + ligne(I.crayon, 'Nom affiché', 'page:nom', valeur(nom))
        + ligne(I.mail, 'Adresse e-mail', 'page:email', valeur(u.email || ''))
        + ligne(I.cadenas, 'Mot de passe', 'page:mdp', valeur('••••••••'))
        + '</div>'
        + '<h3 class="v2a-rubrique">Réglages</h3><div class="v2a-groupe">'
        + ligne(I.horloge, 'Fuseau horaire', 'page:fuseau', valeur(nomTz(tzChoisi())))
        + ligne(I.carte, 'Abonnement', 'page:abo', valeur(ech ? 'Jusqu’au ' + dateCourte(ech) : nomPlan(u)))
        + ligne(I.cloche, 'Notifications ' + nouveau(), 'page:notifs', valeur(notifsOn ? 'Activées' : 'Désactivées'))
        + ligne(I.etoile, 'Préférences', 'page:prefs')
        + ligne(I.langue, 'Langue', 'page:langue', valeur((LANGUES.filter(function (l) { return l[0] === langue(); })[0] || LANGUES[0])[1]))
        + '</div>'
        + (window._pdIsAdmin ? '<h3 class="v2a-rubrique">Administration</h3><div class="v2a-groupe">' + ligne('M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z', 'Panneau d’administration', 'admin') + '</div>' : '')
        + '<h3 class="v2a-rubrique">Assistance</h3><div class="v2a-groupe">' + ligne(I.bulle, 'Écrire au support DTP', 'support') + '</div>'
        + '<button type="button" class="v2a-sortie" data-act="sortie">' + svg(I.sortie, 20) + 'Se déconnecter</button>';
    } else if (sousCompte === 'profil') {
      var kvp = function (k, v) { return v ? '<div class="v2a-kv"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; };
      h = '<div class="v2a-profil v2a-profil--page"><button type="button" class="v2a-profil-ph" data-act="photo" aria-label="Changer la photo de profil"><span class="v2a-profil-av">' + (av ? av.innerHTML : '') + '</span>'
        + '<i class="v2a-profil-cam">' + svg(I.photo, 13, 2) + '</i></button><button type="button" class="v2a-lien" data-act="photo">Changer la photo</button></div>'
        + '<div class="v2a-groupe v2a-fiche">'
        + kvp('Nom', u.name || u.username || '') + kvp('Adresse e-mail', u.email || '') + kvp('Formule', nomPlan(u))
        + kvp('Abonné depuis le', dateFr(u.aboDepuis || u.createdAt)) + (u.aboDepuis && dateFr(u.aboDepuis) !== dateFr(u.createdAt) ? kvp('Membre depuis le', dateFr(u.createdAt)) : '')
        + kvp(ech && new Date(ech) >= new Date() ? 'Accès jusqu’au' : 'Échu le', ech ? dateFr(ech) : '')
        + '</div><div class="v2a-groupe">' + ligne(I.crayon, 'Modifier mes identifiants', 'page:nom') + '</div>';
    } else if (sousCompte === 'nom') {
      h = '<form class="v2a-form" data-form="nomp"><label class="v2a-lbl" for="v2a-nom">Nom affiché</label>'
        + '<input class="v2a-champ" id="v2a-nom" name="nom" maxlength="80" autocomplete="name" value="' + esc(u.name || '') + '">'
        + '<button type="submit" class="v2a-bouton">Enregistrer</button></form>'
        + (CPT.msg ? '<div class="v2a-wp-msg' + (CPT.err ? ' v2a-wp-err' : '') + '">' + esc(CPT.msg) + '</div>' : '')
        + '<div class="v2a-wp-aide">C’est le nom qui s’affiche sur votre profil et dans vos échanges avec le support.</div>';
    } else if (sousCompte === 'email') {
      h = '<div class="v2a-groupe v2a-fiche"><div class="v2a-kv"><span>Adresse actuelle</span><b>' + esc(u.email || '') + '</b></div></div>'
        + '<div class="v2a-wp-aide">Votre adresse e-mail est votre identifiant de connexion et le lien avec votre abonnement. Pour la changer sans interrompre votre accès, le support la met à jour pour vous, en général dans la journée.</div>'
        + '<div class="v2a-groupe">' + ligne(I.bulle, 'Demander le changement d’adresse', 'support') + '</div>';
    } else if (sousCompte === 'mdp') {
      h = '<form class="v2a-form" data-form="mdp">'
        + '<label class="v2a-lbl" for="v2a-mdp0">Mot de passe actuel</label><input class="v2a-champ" id="v2a-mdp0" name="cur" type="password" autocomplete="current-password">'
        + '<label class="v2a-lbl" for="v2a-mdp1">Nouveau mot de passe</label><input class="v2a-champ" id="v2a-mdp1" name="n1" type="password" autocomplete="new-password" minlength="8">'
        + '<label class="v2a-lbl" for="v2a-mdp2">Confirmer le nouveau mot de passe</label><input class="v2a-champ" id="v2a-mdp2" name="n2" type="password" autocomplete="new-password" minlength="8">'
        + '<button type="submit" class="v2a-bouton">Changer le mot de passe</button></form>'
        + (CPT.msg ? '<div class="v2a-wp-msg' + (CPT.err ? ' v2a-wp-err' : '') + '">' + esc(CPT.msg) + '</div>' : '')
        + '<div class="v2a-wp-aide">Au moins 8 caractères, avec majuscule, minuscule, chiffre et caractère spécial. Les autres appareils connectés devront se reconnecter.</div>';
    } else if (sousCompte === 'fuseau') {
      var tzA = tzAppareil(), liste = FUSEAUX.slice();
      if (tzA && liste.indexOf(tzA) < 0) liste.unshift(tzA);
      h = '<div class="v2a-wp-aide">L’horloge de votre profil suit le fuseau choisi. Il est enregistré sur cet appareil.</div>'
        + '<div class="v2a-groupe">' + liste.map(function (tz) {
          return '<button type="button" class="v2a-ligne v2a-choixliste" data-act="tz" data-tz="' + esc(tz) + '"><span>' + esc(nomTz(tz)) + (tz === tzA ? ' <small>cet appareil</small>' : '') + '</span><em class="v2a-val">' + heureTz(tz) + '</em>' + (tz === tzChoisi() ? coche : '<i class="v2a-vide-coche"></i>') + '</button>';
        }).join('') + '</div>';
    } else if (sousCompte === 'abo') {
      var fin = ech ? new Date(ech) : null, jours = fin ? Math.ceil((fin - Date.now()) / 864e5) : null;
      var statut = !u.active ? 'Suspendu' : (u.isTrial ? 'Essai gratuit' : 'Actif');
      var kv = function (k, v, cls) { return '<div class="v2a-kv"><span>' + k + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(v) + '</b></div>'; };
      h = '<div class="v2a-groupe v2a-fiche">'
        + kv('Formule', nomPlan(u))
        + kv('Statut', statut, u.active ? 'v2a-ok' : 'v2a-ko')
        // Début de l'abonnement EN COURS (une reprise repart à zéro), pas la création du compte.
        + ((u.aboDepuis || u.createdAt) ? kv('Abonné depuis le', dateFr(u.aboDepuis || u.createdAt)) : '')
        + (u.aboDepuis && dateFr(u.aboDepuis) !== dateFr(u.createdAt) ? kv('Membre depuis le', dateFr(u.createdAt)) : '')
        + (fin ? kv(jours >= 0 ? 'Prochaine échéance' : 'Échu le', fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })) : '')
        + (jours != null && jours >= 0 ? kv('Jours restants', String(jours)) : '')
        + '</div>'
        + '<div class="v2a-groupe">' + ligne(I.carte, 'Gérer mon abonnement (Whop)', 'whop') + ligne(I.bulle, 'Une question sur mon abonnement', 'support') + '</div>';
    } else if (sousCompte === 'notifs') {
      h = '<div class="v2a-groupe">'
        + ligne(I.son, 'Alertes sonores du desk', 'son', '<i class="v2a-bascule' + (glob('_npEnabled') ? ' v2a-on-b' : '') + '"></i>')
        + ligne(I.cloche, 'Voir les alertes', 'alertes')
        + '</div>' + wpBloc();
    } else if (sousCompte === 'prefs') {
      h = '<div class="v2a-groupe">' + ligne(I.etoile, 'Aperçu V3 (nouvelle interface)', 'v2', '<i class="v2a-bascule v2a-on-b"></i>') + '</div>';
    } else if (sousCompte === 'langue') {
      h = '<div class="v2a-groupe">' + LANGUES.map(function (l) {
        return '<button type="button" class="v2a-ligne v2a-langue" data-act="lg" data-lg="' + l[0] + '"><img src="https://flagcdn.com/w40/' + l[2] + '.png" alt="" loading="lazy"><span>' + l[1] + '</span>' + (l[0] === langue() ? coche : '') + '</button>';
      }).join('') + '</div><div class="v2a-wp-aide">Le desk et l’application se rechargent dans la langue choisie.</div>';
    }
    e.innerHTML = h;
    e.scrollTop = 0;
    e.onclick = function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return; var a = b.dataset.act; if (a === 'rien') return; vibre();
      if (a.indexOf('page:') === 0) { sousCompte = a.slice(5); CPT.msg = ''; RENDUS.compte(true); return; }
      if (a === 'photo') { choisirPhoto(); return; }
      if (a === 'nom') { CPT.edNom = true; CPT.msg = ''; RENDUS.compte(true); var ch = e.querySelector('.v2a-profil-ed input'); if (ch) { ch.focus(); ch.select(); } return; }
      if (a === 'tz') { try { localStorage.setItem('dtp_tz', b.dataset.tz); } catch (x) {} var s0 = document.getElementById('pd-timezone'); if (s0) { if (![].some.call(s0.options, function (o) { return o.value === b.dataset.tz; })) s0.add(new Option(b.dataset.tz, b.dataset.tz)); s0.value = b.dataset.tz; appel('pdUpdateClock'); } RENDUS.compte(true); return; }
      if (a === 'lg') { var l = LANGUES.filter(function (x) { return x[0] === b.dataset.lg; })[0]; if (l && l[0] !== langue()) appel('pdLangPick', l[0], l[1], l[2]); return; }
      if (a === 'whop') { window.open('https://whop.com/@me/settings/memberships/', '_blank', 'noopener'); return; }
      if (a === 'alertes') { ouvrirAlertes(); return; }
      if (a === 'support') appel('chatToggle');
      else if (a === 'admin') ouvrirAdmin();
      else if (a === 'son') { appel('npToggleEnabled'); RENDUS.compte(true); }
      else if (a === 'v2') { var s = document.getElementById('v2-interrupteur'); if (s) s.click(); }
      else if (a === 'pp' || a === 'ppson' || a === 'ppvib' || a === 'ppfil' || a === 'pprecaps' || a === 'ppbanque') {
        if (!PP.prefs || b.disabled) return;
        if (a === 'ppfil') PP.prefs.fil = b.dataset.v;
        else if (a === 'pprecaps') PP.prefs.recaps = b.dataset.v;
        else if (a === 'ppbanque') { var l = PP.prefs.banques || [], x = b.dataset.v; PP.prefs.banques = x === '*' ? [] : (l.indexOf(x) >= 0 ? l.filter(function (y) { return y !== x; }) : l.concat(x)); }
        else if (a === 'pp') { var k = b.dataset.k, i = PP.prefs.cats.indexOf(k); if (i >= 0) PP.prefs.cats.splice(i, 1); else PP.prefs.cats.push(k); }
        else if (a === 'ppson') PP.prefs.son = !PP.prefs.son;
        else PP.prefs.vibreur = !PP.prefs.vibreur;
        wpJson('/api/push-prefs', PP.prefs);
        RENDUS.compte(true);
      }
      else if (a === 'sortie') appel('logoutUser');
      else if (a === 'wp') {
        WP.message = ''; WP.erreur = false;
        var suite = WP.etat === 'actif' ? wpDesactiver().then(function () { WP.message = 'Notifications coupées sur cet appareil.'; })
          : wpActiver().then(function () { WP.message = 'Notifications activées sur cet appareil.'; });
        RENDUS.compte(true);
        suite.catch(function (x) { WP.message = (x && x.message) || 'Échec.'; WP.erreur = true; }).then(function () { RENDUS.compte(true); });
      }
    };
    e.onsubmit = function (ev) {
      var f = ev.target.closest('form[data-form]'); if (!f) return;
      ev.preventDefault(); vibre();
      if (f.dataset.form === 'nom' || f.dataset.form === 'nomp') enregistrerNom(f.nom.value);
      else if (f.dataset.form === 'mdp') changerMdp(f);
    };
    // État réel de l'abonnement, relu à chaque ouverture (l'utilisateur a pu couper dans les réglages).
    if (!relu) wpLireEtat().then(function () { if (e.isConnected) RENDUS.compte(true); });
  };

  /* ══ ALERTES : feuille plein écran, 4 filtres (référence « Alerts ») ══════════════════════════════
     Les éléments sont ceux du panneau d'alertes du desk (`_npItems`, même pré-remplissage : on passe
     par `npOpen`, refermé dans la même tâche, donc jamais affiché) et leur classement est `_npKind`. */
  var FILTRES = [['tout', 'Tout'], ['rapports', 'Rapports'], ['actu', 'Actu'], ['calendrier', 'Calendrier']];
  var filtreAl = 'tout', nonLus = {};
  function ouvrirAlertes() {
    if (!alertes) {
      alertes = document.createElement('div');
      alertes.className = 'v2a-alertes';
      alertes.setAttribute('role', 'dialog'); alertes.setAttribute('aria-label', 'Alertes');
      alertes.innerHTML = '<header><h2>Alertes</h2><button type="button" class="v2a-x" aria-label="Fermer">' + svg(I.x, 24, 2) + '</button></header>'
        + '<nav class="v2a-seg">' + FILTRES.map(function (f) { return '<button type="button" data-f="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</nav>'
        + '<div class="v2a-al-liste"></div>';
      document.body.appendChild(alertes);
      alertes.querySelector('.v2a-x').addEventListener('click', function () { vibre(); fermerAlertes(); });
      alertes.querySelector('.v2a-seg').addEventListener('click', function (e) { var b = e.target.closest('[data-f]'); if (!b) return; vibre(); filtreAl = b.dataset.f; rendreAlertes(); });
      alertes.querySelector('.v2a-al-liste').addEventListener('click', function (e) {
        var more = e.target.closest('[data-suite]');
        if (more) { more.closest('.v2a-al').classList.toggle('v2a-ouvert'); return; }
        var a = e.target.closest('.v2a-al'); if (!a) return; vibre();
        var it = (glob('_npItems') || []).filter(function (x) { return String(x.id) === a.dataset.id; })[0]; if (!it) return;
        fermerAlertes();
        if (it._reportNotif === 'institution') aller('banques');
        else if (it._reportNotif === 'analyst' || estDtp(it)) aller('analystes');
        else { filOuverts[it.id] = true; aller('fil'); setTimeout(function () { var el = ecrans.fil.querySelector('.v2a-news[data-id="' + (window.CSS && CSS.escape ? CSS.escape(String(it.id)) : it.id) + '"]'); if (el) el.scrollIntoView({ block: 'center' }); }, 60); }
      });
    }
    // Les non-lus sont notés AVANT d'ouvrir le panneau du desk (qui les marque comme lus).
    nonLus = {}; (glob('_npItems') || []).forEach(function (i) { if (i && i._new) nonLus[i.id] = true; });
    var np = glob('npOpen'), nc = glob('npClose');
    try { if (typeof np === 'function') { np(); if (typeof nc === 'function') nc(); } } catch (e) {}
    rendreAlertes();
    alertes.classList.add('v2a-ouverte');
    H.classList.add('v2a-al-ouvert');
  }
  function fermerAlertes() { if (alertes) alertes.classList.remove('v2a-ouverte'); H.classList.remove('v2a-al-ouvert'); }
  function rendreAlertes() {
    var kind = glob('_npKind'), titre = glob('_newsDisplayTitle'), apercu = glob('_npApercu'), cat = glob('catFr');
    var limite = Date.now() - 7 * 864e5;
    var tous = (glob('_npItems') || []).filter(function (i) { return i && (i.timestamp || 0) >= limite; }).slice().sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    var cle = function (i) { try { return typeof kind === 'function' ? kind(i).key : 'news'; } catch (e) { return 'news'; } };
    var garde = { tout: function () { return true; }, rapports: function (k) { return k === 'analyst' || k === 'institution' || k === 'dtp'; }, actu: function (k) { return k === 'news'; }, calendrier: function (k) { return k === 'eco'; } }[filtreAl];
    var items = tous.filter(function (i) { return garde(cle(i)); });
    var n = Object.keys(nonLus).length;
    alertes.querySelectorAll('.v2a-seg button').forEach(function (b) { b.classList.toggle('v2a-on', b.dataset.f === filtreAl); });
    var ICO = { news: I.actu, eco: I.cal, analyst: I.doc, institution: I.banques, dtp: I.doc };
    var z = alertes.querySelector('.v2a-al-liste');
    z.innerHTML = (filtreAl === 'tout' ? '<div class="v2a-nonlus">Non lues <b>' + n + '</b></div>' : '')
      + (items.length ? items.slice(0, 120).map(function (i) {
        var k = cle(i), t = i.headline || '';
        try { if (k === 'news' || k === 'eco') t = typeof titre === 'function' ? titre(i) : t; } catch (e) {}
        var d = String(i._descFr || i.description || '').replace(/<[^>]+>/g, ' ').trim();
        try { if (d && typeof apercu === 'function') d = apercu(d, 260); } catch (e) {}
        var risque = /risk[- ]?(on|off)/i.test(t) && /(changed|pass|bascule|detected|détect)/i.test(t + d);
        return '<div class="v2a-al' + (nonLus[i.id] ? ' v2a-nl' : '') + '" data-id="' + esc(i.id) + '"><span class="v2a-al-ico">' + svg(risque ? I.risque : (ICO[k] || I.actu), 26, 1.5) + '</span>'
          + '<div class="v2a-al-c"><b>' + esc(t) + '</b>' + (d ? '<p>' + esc(d) + '</p>' + (d.length > 160 ? '<button type="button" class="v2a-suite" data-suite="1">Lire la suite ' + svg(I.bas, 14, 2) + '</button>' : '') : '')
          + '<span class="v2a-al-t">' + esc(ilYa(i.timestamp)) + (i.category && k !== 'dtp' ? ' · ' + esc(typeof cat === 'function' ? cat(i.category) : i.category) : '') + '</span></div>'
          + (nonLus[i.id] ? '<i class="v2a-al-pt"></i>' : '') + '</div>';
      }).join('') : '<p class="v2a-vide">Aucune alerte dans cette catégorie sur les 7 derniers jours.</p>');
  }

  /* ── Mise en route ─────────────────────────────────────────────────────────────────────────────── */
  function vueCourante() {
    var p = document.querySelector('.view-panel:not(.hidden)');
    return p ? p.id.replace(/^view-/, '') : 'news';
  }
  /* ── Une app ne zoome pas : pincement et double-tap coupés TANT QUE l'app est active (la balise
     viewport d'origine est rendue dès qu'on quitte l'app, grand écran compris). ── */
  var vpOrig = null;
  function verrouZoom(on) {
    var m = document.querySelector('meta[name="viewport"]'); if (!m) return;
    if (vpOrig == null) vpOrig = m.getAttribute('content') || '';
    m.setAttribute('content', on ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' : vpOrig);
  }
  // Mémo pour le chargement suivant : index.html masque le desk web le temps que l'app se pose.
  function memoApp(on) { try { if (on) localStorage.setItem('dtp_v3_app', String(Date.now())); else localStorage.removeItem('dtp_v3_app'); } catch (e) {} }
  /* Le voile d'attente ne tombe qu'une fois la feuille de l'app CHARGÉE : ce script peut s'exécuter
     avant elle, et lever le voile trop tôt montrait le desk web une fraction de seconde. */
  function leverVoile() {
    var l = document.querySelector('link[href*="/css/v2/app.css"]');
    var fini = function () { requestAnimationFrame(function () { H.classList.remove('dtp-app-attente'); }); };
    var prete = false;
    try { prete = !l || !!(l.sheet && l.sheet.cssRules && l.sheet.cssRules.length); } catch (e) { prete = true; }
    if (prete) return fini();
    l.addEventListener('load', fini, { once: true });
    l.addEventListener('error', fini, { once: true });
    setTimeout(fini, 4000);
  }
  /* ⚠️ L'ACCUEIL DU DESK N'A PAS SA PLACE DANS L'APP (25/09, captures user : « Rapport » vide dans
     Banques ET Analystes). home.js pose `body.home-mode` à chaque connexion de l'admin (et des comptes
     à accueil activé) ; la feuille masquait son écran dans l'app, mais PAS la classe — et
     `body.home-mode .view-panel { visibility: hidden }` rendait alors INVISIBLES toutes les vues du
     desk ouvertes depuis l'app : lecteurs de rapports, Calendrier, outils. Il ne restait que le fond
     de la colonne. On referme l'accueil par sa propre fonction (qui retire la classe et marque la
     connexion comme vue), et on le refait si home.js le construit plus tard (réponse réseau lente). */
  function sansAccueil() {
    var fermer = function () {
      if (!H.classList.contains('dtp-app')) return;
      if (document.body.classList.contains('home-mode') || document.getElementById('dtp-home')) {
        try { if (window.DTPHome && typeof DTPHome.close === 'function') DTPHome.close(); } catch (e) {}
        document.body.classList.remove('home-mode');
        var o = document.getElementById('dtp-home'); if (o) o.remove();
      }
    };
    fermer();
    if (!sansAccueil._obs && window.MutationObserver) {
      sansAccueil._obs = new MutationObserver(fermer);
      sansAccueil._obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }
  function appliquer() {
    if (MQ.matches) {
      var premiere = !tete;
      construire();
      brancherFil();
      H.classList.add('dtp-app');
      sansAccueil();
      verrouZoom(true); memoApp(true); brancherVolets();
      leverVoile();
      if (premiere) aller('fil'); else if (courant) marquer(courant);
      setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }, 60);
    } else {
      H.classList.remove('dtp-app', 'v2a-sous-ecran', 'v2a-al-ouvert', 'v2a-volet', 'dtp-app-attente');
      verrouZoom(false); memoApp(false);
      ouvrirPlus(false); fermerAlertes(); montrerEcran(null);
      setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }, 60);
    }
  }
  window._v2aOuvrirOutils = function () { ouvrirPlus(true); };
  if (MQ.addEventListener) MQ.addEventListener('change', appliquer); else if (MQ.addListener) MQ.addListener(appliquer);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appliquer); else appliquer();
})();

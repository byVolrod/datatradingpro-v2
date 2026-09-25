/* ═══ DTP V3 · HABILLAGE DU DESK GRAND ÉCRAN : ce que la feuille seule ne peut pas faire ═══════════════
   (comptes admin, « Aperçu V3 » ; la feuille css/v2/desk.css porte tout l'aspect)
   · la puce « V3 » à côté du logo : la mise à jour doit se VOIR dès l'arrivée ;
   · l'apparition échelonnée des cartes de Mon Desk : chaque carte reçoit son rang (--v3i), y compris
     celles qu'on ajoute ensuite (observateur sur la grille).
   Rien d'autre : aucune donnée, aucun comportement du desk n'est touché. Retirer ce fichier = le desk
   exact d'avant, et la feuille s'efface avec la classe `dtp-v2`. */
(function () {
  'use strict';
  if (window._dtpV3Desk) return;
  window._dtpV3Desk = true;
  function puce() {
    var l = document.querySelector('.topbar .logo');
    if (l && !l.querySelector('.v3-puce')) l.insertAdjacentHTML('beforeend', '<span class="v3-puce" title="Nouvelle interface DTP">V3</span>');
  }
  function rangs(g) { if (!g) return; var i = 0; g.querySelectorAll(':scope > .wdg-card').forEach(function (c) { if (!c.style.getPropertyValue('--v3i')) c.style.setProperty('--v3i', String(Math.min(i, 14))); i++; }); }
  /* PAIRES OUVERTES EN ONGLETS (référence : « USDJPY · GBPUSD » dans la barre). Le desk n'a qu'un
     onglet de paire (#nav-symbol, la paire active) ; la V3 garde à côté les dernières paires
     consultées, lues dans l'historique que le desk tient déjà (dtp_sym_recent, synchronisé par
     compte). Un clic rouvre la paire par la fonction du desk (openSymbol) ; la croix retire l'onglet
     pour la session, sans toucher à l'historique. */
  var DRAP = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', CAD: 'ca', AUD: 'au', NZD: 'nz', XAU: 'xau' };
  var fermees = {};
  function recentes() { try { var r = JSON.parse(localStorage.getItem('dtp_sym_recent') || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  function onglets() {
    var nav = document.getElementById('topbar-nav'); if (!nav) return;
    var actif = document.getElementById('nav-symbol');
    var p0 = actif ? (actif.textContent || '').replace(/[^A-Z]/g, '').slice(0, 6) : '';
    var liste = recentes().filter(function (p) { return /^[A-Z]{6}$/.test(p) && p !== p0 && !fermees[p]; }).slice(0, 3);
    var cle = liste.join(',');
    if (nav.dataset.v3p === cle && (!liste.length || nav.querySelector('.v3-paire'))) return;
    nav.dataset.v3p = cle;
    nav.querySelectorAll('.v3-paire').forEach(function (x) { x.remove(); });
    var ancre = actif ? actif.nextSibling : (nav.querySelector('.nav-item--mobile-only') || null);
    liste.forEach(function (p) {
      var a = document.createElement('a');
      a.href = '#'; a.className = 'nav-item v3-paire'; a.dataset.paire = p; a.title = 'Rouvrir ' + p.slice(0, 3) + '/' + p.slice(3);
      var f = DRAP[p.slice(0, 3)];
      a.innerHTML = (f && f !== 'xau' ? '<img class="sym-tab-flag" src="https://flagcdn.com/16x12/' + f + '.png" alt="">' : '')
        + '<span>' + p.slice(0, 3) + '/' + p.slice(3) + '</span><span class="v3-paire-x" title="Retirer">×</span>';
      nav.insertBefore(a, ancre);
    });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.v3-paire'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    var p = a.dataset.paire;
    if (e.target.closest('.v3-paire-x')) { fermees[p] = true; onglets(); return; }
    if (typeof window.openSymbol === 'function') window.openSymbol(p);
  }, true);
  /* Voix officielle FinancialJuice (admin) : ouvre la Voice News sur financialjuice.com, dans une
     petite fenêtre, avec la session de l'admin. C'est le seul moyen d'entendre la VRAIE voix sans la
     rediffuser : le flux audio appartient à FinancialJuice (licence partenaire pour les clients). */
  function voixFJ() {
    var pied = document.querySelector('#sqwk-panel .sqwk-footer');
    if (!pied || document.getElementById('v3-fj-voix')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'v3-fj-voix'; b.className = 'v3-fj-voix';
    b.textContent = 'Écouter la voix FinancialJuice ↗';
    b.title = 'Ouvre la Voice News officielle sur financialjuice.com, avec votre compte FinancialJuice';
    b.addEventListener('click', function () {
      var w = window.open('https://www.financialjuice.com/home', 'dtp_fj_voix', 'popup,width=460,height=780');
      if (w) { try { w.opener = null; } catch (e) {} }
    });
    pied.appendChild(b);
  }
  /* Carte à onglets : UNE seule ligne d'en-tête (24/09, capture user « Horloge · Rebours » : sous la
     barre d'onglets, un second bandeau « Compte à rebours » répétait les mêmes boutons). Le nom est
     déjà porté par l'onglet ; les commandes du widget rejoignent la plaque de la carte, à côté des
     commandes du panneau. Les widgets en case d'un onglet composite gardent leur bandeau : là, il
     est le seul à les nommer. Grand écran seulement, comme le reste de cet habillage. */
  // Le desk, c'est tout ce qui n'est pas l'app : grand écran, OU tout écran sans pointeur tactile
  // (un PC à fenêtre étroite reste un desk — voir app-mobile.js).
  var MQ_DESK = window.matchMedia ? window.matchMedia('(min-width: 821px), not all and (pointer: coarse)') : { matches: true };
  function fusion(carte) {
    var plaque = carte.querySelector(':scope > .wdg-head .wdg-actions');
    if (!plaque || !carte.querySelector('.wdgt-bar')) return;
    // Un seul corps d'onglet à la fois (widgets.js le vide à chaque changement, et purge alors toute
    // commande de sous-widget de la carte, plaque comprise) : le bandeau présent est celui de l'onglet actif.
    var bandeau = carte.querySelector('.wdgt-body > .wdgt-subname');
    var dansPlaque = plaque.querySelector(':scope > .wdgt-subacts');
    if (!MQ_DESK.matches || !bandeau) {
      if (dansPlaque && bandeau) bandeau.appendChild(dansPlaque);
      if (bandeau) bandeau.classList.remove('v3-fondu');
      carte.classList.remove('v3-fusion');
      return;
    }
    var acts = bandeau.querySelector('.wdgt-subacts');
    if (acts) plaque.insertBefore(acts, plaque.querySelector(':scope > .wdg-ico--x'));
    bandeau.classList.add('v3-fondu');
    var g0 = plaque.querySelector(':scope > .wdg-ico'); if (g0 && g0.title === 'Réglages') g0.title = 'Réglages du panneau';
    carte.classList.toggle('v3-fusion', !!(acts || dansPlaque));
  }
  function fusions() { document.querySelectorAll('#wdg-grid .wdg-card').forEach(function (c) { try { fusion(c); } catch (e) {} }); }
  var fusionPrevue = 0;
  function planifierFusions() { if (fusionPrevue) return; fusionPrevue = requestAnimationFrame(function () { fusionPrevue = 0; fusions(); barres(); }); }
  /* ── BARRE D'ONGLETS SUR UNE LIGNE (25/09, « le responsive doit être mieux », fenêtre rétrécie sur
     PC : la barre s'empilait sur trois à cinq rangées). On MESURE chaque barre, libellés visibles :
     s'ils ne tiennent pas, la barre passe « serrée » (onglets inactifs en icône seule, desk.css) ; si
     même les icônes ne tiennent pas À CÔTÉ des boutons de la carte, la barre prend SA PROPRE LIGNE,
     pleine largeur, sous eux (même principe que `wdg-card--tabs-2lignes` de widgets.js, qui ne
     regarde que le plus large onglet) ; elle ne défile qu'en tout dernier recours. Mesuré à chaque
     rendu d'onglets et à chaque changement de taille de la grille — jamais figé à l'arrivée. */
  function barres() {
    var g = document.getElementById('wdg-grid'); if (!g) return;
    g.querySelectorAll('.wdg-card--tabs .wdgt-bar').forEach(function (b) {
      var carte = b.closest('.wdg-card'), tient = function () { return b.scrollWidth <= b.clientWidth + 1; };
      b.classList.remove('v3-serre', 'v3-defile'); if (carte) carte.classList.remove('v3-2lignes');
      if (!MQ_DESK.matches || tient()) return;
      b.classList.add('v3-serre');
      if (tient()) return;
      if (carte && !carte.classList.contains('wdg-card--tabs-2lignes')) { carte.classList.add('v3-2lignes'); if (tient()) return; }
      b.classList.add('v3-defile');
    });
  }
  /* ── CASSE DES ONGLETS (25/09, capture user : « des fois tout est en majuscule et d'autres fois
     non ») ─────────────────────────────────────────────────────────────────────────────────────
     La V3 retire la mise en capitales des onglets (desk.css, `text-transform: none`). Les libellés
     s'affichaient donc tels qu'ils sont ENREGISTRÉS : ceux par défaut en capitales (« ACTUS »,
     « SENTIMENT », « FORCE »), ceux renommés par l'utilisateur en casse normale (« Institutions »,
     « Baromètre ») — une barre sur deux registres. On passe à l'AFFICHAGE tout libellé entièrement en
     capitales en casse normale (« Actus », « Semaine à venir »), en gardant les sigles (FX, COT, DMX,
     BCE, CPI…). Un libellé déjà en casse mixte n'est pas touché, et rien n'est réécrit dans la
     configuration : c'est une règle de rendu de la V3, qui s'efface avec elle. */
  var SIGLES = /^(FX|COT|DMX|IA|AI|US|UK|EU|UE|USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|CNY|BCE|BNS|FOMC|RBA|RBNZ|SNB|ECB|CPI|NFP|PMI|PIB|GDP|VIX|DXY|XAU|XAG|WTI|DTP|JOT|TV|G7|G20|OPEP|CFTC|ETF|PDF|OK)$/;
  var MIXTES = { FED: 'Fed', BOE: 'BoE', BOJ: 'BoJ', BOC: 'BoC', BCE: 'BCE', VIEW: 'View' };
  function casseNormale(t) {
    if (!/[A-ZÀ-Ý]/.test(t) || /[a-zß-ÿ]/.test(t)) return t;   // sans lettre, ou déjà en casse mixte
    var premier = true;
    return t.replace(/[A-Za-zÀ-ÿ]+/g, function (m) {
      var r = MIXTES[m] || (SIGLES.test(m) ? m : (premier ? m.charAt(0) + m.slice(1).toLowerCase() : m.toLowerCase()));
      premier = false;
      return r;
    });
  }
  var CIBLES = '#topbar-nav .nav-item, .wdg-bar .nav-item, .right-panel-tabs .right-tab, .wdgt-tab, .wdgt-subname';
  function casses() {
    if (/^en/i.test(document.documentElement.lang || '')) return;   // l'anglais garde ses propres libellés
    document.querySelectorAll(CIBLES).forEach(function (el) {
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) { var v = n.nodeValue, c = casseNormale(v); if (c !== v) n.nodeValue = c; }
    });
  }
  var cassePrevue = 0;
  function planifierCasses() { if (cassePrevue) return; cassePrevue = requestAnimationFrame(function () { cassePrevue = 0; casses(); }); }
  window._v3CasseNormale = casseNormale;   // pour les bancs

  /* ── LES CHIFFRES VIVENT (25/09, « améliore tous les widgets pour la V3 : finitions, détails,
     animations ») ─────────────────────────────────────────────────────────────────────────────
     Un chiffre de widget qui change EN PLACE (cours, variation, score) s'allume un instant : vert
     s'il monte, rouge s'il baisse, or si le sens ne se lit pas. C'est la respiration d'un terminal :
     l'œil voit ce qui vient de bouger sans relire la grille.
     ⚠️ BORNÉ À DESSEIN : seulement une feuille de texte courte et numérique, à l'intérieur d'un corps
     de widget, dont l'ÉLÉMENT survit à la mise à jour (un widget qui reconstruit sa table ne
     clignote pas : il n'y a rien à comparer). Au plus 40 allumages par seconde. Grand écran et
     mouvement autorisé seulement. */
  var RX_NB = /^[\s+\-−–]*[$€£¥]?\s*\d[\d\s.,\u202f]*\s*(%|pb|bp|k|K|M|Md|B|pips?)?\s*$/;
  // Nombre lu tel qu'il s'affiche : « 1,2345 » (virgule décimale), « 1 234,5 », « 1,234,567 » ou
  // « 1.2345 ». Une seule virgule sans point = décimale ; plusieurs = milliers ; avec un point, la
  // dernière marque est la décimale. Seul compte le SENS, donc une lecture constante suffit.
  var nbDe = function (t) {
    var x = String(t).replace(/[\s  ]/g, '').replace(/−|–/g, '-').replace(/[^\d.,\-]/g, '');
    var v = (x.match(/,/g) || []).length, pt = x.indexOf('.') >= 0;
    if (v && pt) x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
    else if (v === 1) x = x.replace(',', '.');
    else if (v > 1) x = x.replace(/,/g, '');
    var m = x.match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null;
  };
  var flashs = 0, flashT = 0;
  function vivre(muts) {
    if (!MQ_DESK.matches || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    var t = Date.now(); if (t - flashT > 1000) { flashT = t; flashs = 0; }
    for (var i = 0; i < muts.length && flashs < 40; i++) {
      var n = muts[i].target, e = n.nodeType === 3 ? n.parentNode : n;
      if (!e || e.nodeType !== 1 || e.children.length || !e.closest || !e.closest('.wdg-body')) continue;
      var tx = e.textContent; if (!tx || tx.length > 16 || !RX_NB.test(tx)) continue;
      var v = nbDe(tx), avant = e._v3nb; e._v3nb = v;
      if (avant == null || v == null || v === avant) continue;
      e.classList.remove('v3-maj-h', 'v3-maj-b'); void e.offsetWidth;
      e.classList.add(v > avant ? 'v3-maj-h' : 'v3-maj-b'); flashs++;
      clearTimeout(e._v3t); e._v3t = setTimeout(function (x) { x.classList.remove('v3-maj-h', 'v3-maj-b'); }.bind(null, e), 1100);
    }
  }

  function demarrer() {
    puce();
    casses();
    ['topbar-nav', 'view-widgets', 'right-panel'].forEach(function (id) {
      var z = document.getElementById(id);
      if (z && window.MutationObserver) new MutationObserver(planifierCasses).observe(z, { childList: true, subtree: true, characterData: true });
    });
    document.querySelectorAll('.right-panel-tabs').forEach(function (z) { if (window.MutationObserver) new MutationObserver(planifierCasses).observe(z, { childList: true, subtree: true, characterData: true }); });
    voixFJ();
    onglets();
    var nav = document.getElementById('topbar-nav');
    if (nav && window.MutationObserver) new MutationObserver(function () { setTimeout(onglets, 0); }).observe(nav, { childList: true, subtree: true, characterData: true });
    var g = document.getElementById('wdg-grid');
    rangs(g);
    if (g && window.MutationObserver) new MutationObserver(function () { rangs(g); }).observe(g, { childList: true });
    // ⚠️ `barres()` retire puis repose la classe de la barre pour la mesurer : ces mutations-là ne
    // doivent pas relancer le cycle, sinon il tournerait à chaque image, indéfiniment.
    var siMesure = function (r) {
      if (r.type !== 'attributes' || !r.target.classList) return false;
      if (r.target.classList.contains('wdgt-bar')) return true;
      // Sur la carte, seule la bascule « deux lignes » posée par barres() est ignorée.
      var avant = String(r.oldValue || '').split(/\s+/).filter(Boolean), apres = [].slice.call(r.target.classList);
      var diff = avant.filter(function (c) { return apres.indexOf(c) < 0; }).concat(apres.filter(function (c) { return avant.indexOf(c) < 0; }));
      return diff.length > 0 && diff.every(function (c) { return c === 'v3-2lignes'; });
    };
    if (g && window.MutationObserver) new MutationObserver(function (m) { if (m.every(siMesure)) return; planifierFusions(); }).observe(g, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class'] });
    // La largeur d'une carte change sans mutation (fenêtre redimensionnée, colonne masquée) : la
    // barre d'onglets se re-mesure alors aussi.
    if (g && window.ResizeObserver) { var tR = 0; new ResizeObserver(function () { cancelAnimationFrame(tR); tR = requestAnimationFrame(barres); }).observe(g); }
    if (g && window.MutationObserver) new MutationObserver(vivre).observe(g, { childList: true, subtree: true, characterData: true });
    if (MQ_DESK.addEventListener) MQ_DESK.addEventListener('change', planifierFusions);
    planifierFusions();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();

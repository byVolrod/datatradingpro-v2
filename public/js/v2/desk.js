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
    b.textContent = 'Voix officielle FinancialJuice (mon compte) ↗';
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
  var MQ_DESK = window.matchMedia ? window.matchMedia('(min-width: 821px)') : { matches: true };
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
  function planifierFusions() { if (fusionPrevue) return; fusionPrevue = requestAnimationFrame(function () { fusionPrevue = 0; fusions(); }); }
  function demarrer() {
    puce();
    voixFJ();
    onglets();
    var nav = document.getElementById('topbar-nav');
    if (nav && window.MutationObserver) new MutationObserver(function () { setTimeout(onglets, 0); }).observe(nav, { childList: true, subtree: true, characterData: true });
    var g = document.getElementById('wdg-grid');
    rangs(g);
    if (g && window.MutationObserver) new MutationObserver(function () { rangs(g); }).observe(g, { childList: true });
    if (g && window.MutationObserver) new MutationObserver(planifierFusions).observe(g, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    if (MQ_DESK.addEventListener) MQ_DESK.addEventListener('change', planifierFusions);
    planifierFusions();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();

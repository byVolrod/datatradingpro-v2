/* noinspect.js — dissuasion d'inspection / protection de contenu.
 * Bloque : clic droit (menu contextuel), F12, Ctrl/Cmd+Shift+I·J·C (DevTools), Ctrl/Cmd+U (code source),
 * glisser-déposer d'images. C'est un FREIN efficace contre l'inspection occasionnelle et la copie via le
 * menu — PAS une protection absolue (le menu ⋮ du navigateur reste accessible et JS peut être désactivé). */
(function () {
  'use strict';
  var block = function (e) { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} return false; };

  // Clic droit → pas de menu contextuel (Inspecter / Afficher la source / Enregistrer l'image…)
  document.addEventListener('contextmenu', block, { capture: true });

  // Raccourcis clavier : F12, Ctrl/Cmd+Shift+I·J·C (DevTools / console / sélecteur), Ctrl/Cmd+U (source)
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    var mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F12'
      || (mod && e.shiftKey && (k === 'i' || k === 'j' || k === 'c'))
      || (e.metaKey && e.altKey && (k === 'i' || k === 'j' || k === 'c'))
      || (mod && k === 'u')) return block(e);
  }, { capture: true });

  // Glisser-déposer d'images (extraction rapide du contenu)
  document.addEventListener('dragstart', function (e) {
    if (e.target && e.target.tagName === 'IMG') return block(e);
  }, { capture: true });
})();

/**
 * Preload DataTradingPro — pont MINIMAL entre la coquille Electron et le desk distant.
 * ─────────────────────────────────────────────────────────────────────────────────
 * Rôle unique : signaler à la page (chargée depuis desk.datatradingpro.com) qu'elle
 * tourne DANS l'application native, pour qu'elle applique le style « title bar intégrée »
 * (zone de déplacement + marge des boutons système). Aucune donnée exposée, aucun accès Node
 * offert à la page (contextIsolation + sandbox conservés). N'affecte JAMAIS la version web.
 */
'use strict';
const { ipcRenderer } = require('electron');

const PLATFORM_CLASS = process.platform === 'darwin' ? 'dtp-mac'
  : process.platform === 'win32' ? 'dtp-win' : 'dtp-linux';

// Habillage de la barre native intégrée. IMPORTANT : on N'UTILISE PLUS -webkit-app-region:drag — sur cette
// config Windows (titleBarStyle:'hidden') il s'avérait inopérant ET, quand il est actif, l'OS intercepte le
// pointerdown → notre déplacement MANUEL (pointer capture + main.js) ne démarre jamais. Le déplacement est
// donc géré à 100 % côté JS (voir plus bas). Ici on ne garde QUE le décalage réservé aux boutons système
// (droite sous Windows, feux macOS à gauche) et un curseur adapté sur la zone de saisie du header.
const DRAG_CSS = `
  html.dtp-win .topbar { padding-right: 146px; }
  html.dtp-mac .logo { padding-left: 74px; }
  html.dtp-desktop .topbar { cursor: default; }
`;

function injectDragStyle() {
  try {
    if (document.getElementById('dtp-drag-style')) return;
    const s = document.createElement('style');
    s.id = 'dtp-drag-style';
    s.textContent = DRAG_CSS;
    (document.head || document.documentElement).appendChild(s);
  } catch (_) {}
}

function markDesktop() {
  try {
    const root = document.documentElement;
    root.classList.add('dtp-desktop', PLATFORM_CLASS);
    injectDragStyle();
  } catch (_) {}
}

// La page peut ne pas être encore parsée quand le preload s'exécute.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markDesktop, { once: true });
else markDesktop();
// Filet supplémentaire : ré-applique après le chargement complet (SPA / navigation interne / <head> tardif).
try { window.addEventListener('load', markDesktop, { once: true }); } catch (_) {}

// État actif / inactif de la fenêtre (détail premium : topbar légèrement estompée hors focus).
ipcRenderer.on('dtp-window-focus', (_e, focused) => {
  try { document.documentElement.classList.toggle('dtp-inactive', !focused); } catch (_) {}
});

// Éléments INTERACTIFS de la topbar : ni drag, ni double-clic maximise (pour ne pas gêner leurs clics).
const NO_DRAG_SEL = '.topbar-icon, .topbar-symbol-search, .topbar-sentiment, #topbar-avatar, input, button, a, select, textarea, [onclick], [role="button"]';
const _inTopbar = t => t && t.closest && t.closest('.topbar');
const _interactive = t => t && t.closest && t.closest(NO_DRAG_SEL);

// ── DÉPLACEMENT MANUEL de la fenêtre (ne dépend PAS de -webkit-app-region, qui s'avère inopérant avec
//    titleBarStyle:'hidden' sur certaines configs Windows — bug user 16/07 « fenêtre fixe »). On capture le
//    pointeur (setPointerCapture) → les événements continuent MÊME hors de la fenêtre → glisser multi-écrans
//    fluide et natif ; le repositionnement réel est fait côté main (win.setPosition) via IPC en coords ÉCRAN. ──
let _dragPtr = null;
window.addEventListener('pointerdown', e => {
  try {
    if (e.button !== 0) return;                       // clic gauche seulement
    if (!_inTopbar(e.target) || _interactive(e.target)) return;   // zone vide du header uniquement
    _dragPtr = e.pointerId;
    // La capture garantit que le pointerup FINAL nous parvient même quand le curseur sort de la fenêtre
    // (il en sort en permanence pendant un glisser multi-écrans) → arrêt propre du déplacement.
    try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (_) {}
    ipcRenderer.send('dtp-win-drag-start');           // le MAIN lit lui-même la position du curseur (coords DIP, tous écrans)
  } catch (_) {}
}, true);
const _endDrag = e => {
  if (_dragPtr === null) return;
  try { if (e && e.target && e.target.releasePointerCapture) e.target.releasePointerCapture(_dragPtr); } catch (_) {}
  _dragPtr = null;
  try { ipcRenderer.send('dtp-win-drag-end'); } catch (_) {}
};
window.addEventListener('pointerup', _endDrag, true);
window.addEventListener('pointercancel', _endDrag, true);
window.addEventListener('lostpointercapture', _endDrag, true);   // filet supplémentaire si la capture est perdue

// DOUBLE-CLIC sur une zone vide de la topbar = agrandir/restaurer (convention native Windows/macOS).
window.addEventListener('dblclick', e => {
  try {
    if (!_inTopbar(e.target) || _interactive(e.target)) return;
    ipcRenderer.send('dtp-titlebar-dblclick');
  } catch (_) {}
}, true);

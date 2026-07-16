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

function markDesktop() {
  try {
    const root = document.documentElement;
    root.classList.add('dtp-desktop', PLATFORM_CLASS);
  } catch (_) {}
}

// La page peut ne pas être encore parsée quand le preload s'exécute.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markDesktop, { once: true });
else markDesktop();

// État actif / inactif de la fenêtre (détail premium : topbar légèrement estompée hors focus).
ipcRenderer.on('dtp-window-focus', (_e, focused) => {
  try { document.documentElement.classList.toggle('dtp-inactive', !focused); } catch (_) {}
});

// DOUBLE-CLIC sur la topbar = agrandir/restaurer la fenêtre (convention native Windows/macOS —
// Notion, Discord, VS Code). Ignoré sur les éléments INTERACTIFS de la barre (icônes, recherche,
// sentiment, avatar, champs) pour ne jamais interférer avec leurs clics.
const NO_DBL = '.topbar-icon, .topbar-symbol-search, .topbar-sentiment, #topbar-avatar, input, button, a, select, textarea, [onclick]';
window.addEventListener('dblclick', e => {
  try {
    const t = e.target;
    if (!t || !t.closest) return;
    if (!t.closest('.topbar') && !t.closest('#dtp-drag-strip')) return;   // uniquement la barre supérieure
    if (t.closest(NO_DBL)) return;                                        // jamais sur un élément interactif
    ipcRenderer.send('dtp-titlebar-dblclick');
  } catch (_) {}
}, true);

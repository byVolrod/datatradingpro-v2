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

// Zone de déplacement AUTONOME : on injecte le CSS de drag DEPUIS l'app (au lieu de dépendre du style.css
// distant, qui peut être servi en cache dans une version antérieure aux règles .dtp-desktop). Ainsi le
// déplacement de la fenêtre fonctionne dès que le binaire tourne, quel que soit l'état du CSS du desk.
// (Bug user 16/07 « la fenêtre reste fixe » : le drag ne s'appliquait pas côté page.)
const DRAG_CSS = `
  html.dtp-desktop .topbar { -webkit-app-region: drag !important; app-region: drag !important; }
  html.dtp-desktop .topbar .topbar-icon,
  html.dtp-desktop .topbar .topbar-symbol-search,
  html.dtp-desktop .topbar .topbar-sentiment,
  html.dtp-desktop .topbar #topbar-avatar,
  html.dtp-desktop .topbar .topbar-center > *,
  html.dtp-desktop .topbar .topbar-right > *,
  html.dtp-desktop .topbar input,
  html.dtp-desktop .topbar button,
  html.dtp-desktop .topbar a { -webkit-app-region: no-drag !important; app-region: no-drag !important; }
  html.dtp-win .topbar { padding-right: 146px; }
  html.dtp-mac .logo { padding-left: 74px; }
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

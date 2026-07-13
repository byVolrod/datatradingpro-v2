/**
 * DataTradingPro — application bureau (Windows / macOS)
 * ─────────────────────────────────────────────────────
 * Coquille Electron minimaliste qui charge le desk en ligne : l'app bénéficie ainsi de
 * TOUTES les mises à jour du site sans jamais devoir être réinstallée. Session persistante
 * (cookies « Rester connecté » conservés entre les lancements), liens externes ouverts dans
 * le navigateur système, page de secours locale si hors-ligne.
 */
'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

// ── MISE À JOUR AUTOMATIQUE (electron-updater) ────────────────────────────────────────────────
// L'app vérifie au lancement (puis toutes les 6 h) le flux https://desk.datatradingpro.com/downloads/
// (latest.yml). Si une version plus récente existe, elle est téléchargée EN FOND puis installée au
// redémarrage → plus JAMAIS de réinstallation manuelle. Publier une MAJ = bumper la version dans
// package.json, `npm run build:win`, uploader Setup.exe + Setup.exe.blockmap + latest.yml dans /downloads/.
// Robuste : désactivé en dev (non empaqueté) ; toute erreur est non bloquante (l'app charge le site normalement).
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;                 // filet : installée au prochain quit même si l'user reporte
  autoUpdater.on('update-downloaded', () => {
    if (!win || win.isDestroyed()) return;
    dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Redémarrer maintenant', 'Plus tard'],
      defaultId: 0, cancelId: 1,
      title: 'Mise à jour disponible',
      message: 'Une nouvelle version de DataTradingPro est prête.',
      detail: 'Elle s’installera au redémarrage de l’application (nouveautés et nouvelle icône incluses).',
    }).then(r => { if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall()); }).catch(() => {});
  });
  autoUpdater.on('error', (err) => { try { console.warn('[AutoUpdate]', (err && err.message) || err); } catch (_) {} });
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
}

// L'app charge la RACINE du desk : le serveur décide — pas de session → page de LOGIN ;
// session valide (« Rester connecté ») → directement le terminal. Exactement le flux web.
const DESK_URL = 'https://desk.datatradingpro.com/';
const ALLOWED  = ['https://desk.datatradingpro.com', 'https://datatradingpro.com', 'https://www.datatradingpro.com'];

// Une seule instance de l'app (un 2e lancement réactive la fenêtre existante)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;

// Menu applicatif minimal (FR) — surtout pour les RACCOURCIS : PLEIN ÉCRAN (F11 sous Windows,
// Ctrl+Cmd+F sous macOS), zoom, recharger. La barre reste masquée (Alt l'affiche sous Windows).
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ label: 'DataTradingPro', submenu: [
      { role: 'about',   label: 'À propos de DataTradingPro' },
      { type: 'separator' },
      { role: 'hide',    label: 'Masquer' },
      { role: 'unhide',  label: 'Tout afficher' },
      { type: 'separator' },
      { role: 'quit',    label: 'Quitter DataTradingPro' },
    ] }] : []),
    { label: 'Affichage', submenu: [
      { role: 'togglefullscreen', label: 'Plein écran' },        // F11 (Windows) / Ctrl+Cmd+F (macOS)
      { type: 'separator' },
      { role: 'resetZoom', label: 'Zoom 100 %' },
      { role: 'zoomIn',    label: 'Zoom +' },
      { role: 'zoomOut',   label: 'Zoom −' },
      { type: 'separator' },
      { role: 'reload',    label: 'Recharger' },
    ] },
    { label: 'Édition', submenu: [
      { role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' },
      { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' },
    ] },
    { label: 'Fenêtre', submenu: [
      { role: 'minimize', label: 'Réduire' },
      ...(process.platform === 'darwin' ? [{ role: 'zoom', label: 'Agrandir' }] : [{ role: 'close', label: 'Fermer' }]),
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: '#0c0c0e',          // fond HUD pendant le chargement (pas de flash blanc)
    autoHideMenuBar: true,               // barre de menu masquée (Alt pour l'afficher sous Windows)
    fullscreenable: true,                // plein écran : F11 (Windows) / Ctrl+Cmd+F ou bouton vert (macOS)
    title: 'DataTradingPro',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,            // la page web n'a AUCUN accès Node (sécurité)
      contextIsolation: true,
      spellcheck: false,
    },
  });

  win.loadURL(DESK_URL);

  // Liens hors-domaine → navigateur système ; le desk (et la landing) restent dans l'app
  const isInternal = url => ALLOWED.some(a => url === a || url.startsWith(a + '/'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  // Hors-ligne / serveur injoignable → page de secours locale avec bouton « Réessayer »
  win.webContents.on('did-fail-load', (_e, _code, _desc, _validatedURL, isMainFrame) => {
    if (isMainFrame && win && !win.isDestroyed()) win.loadFile(path.join(__dirname, 'offline.html'));
  });

  // Menu CLIC-DROIT (contextuel) : Couper / Copier / Coller / Tout sélectionner. Electron n'en fournit AUCUN
  // par défaut → sans ça, impossible de COLLER (clic-droit) un mot de passe reçu par e-mail dans le champ login.
  win.webContents.on('context-menu', (_e, params) => {
    const ef = params.editFlags || {};
    const hasSel = !!(params.selectionText && params.selectionText.trim());
    const tpl = [];
    if (params.isEditable) tpl.push({ role: 'cut', label: 'Couper', enabled: ef.canCut && hasSel });
    if (params.isEditable || hasSel) tpl.push({ role: 'copy', label: 'Copier', enabled: ef.canCopy && hasSel });
    if (params.isEditable) tpl.push({ role: 'paste', label: 'Coller', enabled: ef.canPaste !== false });
    if (tpl.length) {
      tpl.push({ type: 'separator' }, { role: 'selectAll', label: 'Tout sélectionner' });
      Menu.buildFromTemplate(tpl).popup({ window: win });
    }
  });

  // Autorise le presse-papiers (app first-party de confiance) → le bouton « Coller » du login (navigator.clipboard)
  // fonctionne aussi dans l'app, en plus du clic-droit et de Ctrl+V.
  try {
    win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'clipboard-read' || permission === 'clipboard-sanitized-write' || permission === 'fullscreen' || permission === 'notifications');
    });
  } catch (_) {}

  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => { buildMenu(); createWindow(); setupAutoUpdate(); });

// macOS : l'app reste dans le Dock fenêtre fermée ; clic Dock → rouvre
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

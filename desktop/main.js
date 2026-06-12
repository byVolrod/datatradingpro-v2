/**
 * DataTradingPro — application bureau (Windows / macOS)
 * ─────────────────────────────────────────────────────
 * Coquille Electron minimaliste qui charge le desk en ligne : l'app bénéficie ainsi de
 * TOUTES les mises à jour du site sans jamais devoir être réinstallée. Session persistante
 * (cookies « Rester connecté » conservés entre les lancements), liens externes ouverts dans
 * le navigateur système, page de secours locale si hors-ligne.
 */
'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const DESK_URL = 'https://desk.datatradingpro.com/';
const ALLOWED  = ['https://desk.datatradingpro.com', 'https://datatradingpro.com', 'https://www.datatradingpro.com'];

// Une seule instance de l'app (un 2e lancement réactive la fenêtre existante)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: '#0c0c0e',          // fond HUD pendant le chargement (pas de flash blanc)
    autoHideMenuBar: true,               // barre de menu masquée (Alt pour l'afficher sous Windows)
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

  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(createWindow);

// macOS : l'app reste dans le Dock fenêtre fermée ; clic Dock → rouvre
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

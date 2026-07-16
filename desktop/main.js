/**
 * DataTradingPro — application bureau (Windows / macOS)
 * ─────────────────────────────────────────────────────
 * Coquille Electron minimaliste qui charge le desk en ligne : l'app bénéficie ainsi de
 * TOUTES les mises à jour du site sans jamais devoir être réinstallée. Session persistante
 * (cookies « Rester connecté » conservés entre les lancements), liens externes ouverts dans
 * le navigateur système, page de secours locale si hors-ligne.
 */
'use strict';

const { app, BrowserWindow, Menu, shell, dialog, nativeTheme, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

// Modal de mise à jour AUX COULEURS DTP (les dialogues natifs de l'OS ne sont pas stylables) : petite
// fenêtre enfant sans cadre, fond sombre + accent or, cohérente avec l'app. Renvoie 'primary'|'secondary'.
function showUpdateModal({ title, message, detail, primary, secondary } = {}) {
  return new Promise(resolve => {
    if (!win || win.isDestroyed()) return resolve('secondary');
    const search = new URLSearchParams({
      title: title || 'Mise à jour', message: message || '', detail: detail || '',
      primary: primary || 'OK', secondary: secondary || 'Plus tard',
    }).toString();
    let m = new BrowserWindow({
      width: 460, height: 240, parent: win, modal: true, show: false,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      frame: false, transparent: true, backgroundColor: '#00000000', roundedCorners: true,
      webPreferences: { nodeIntegration: true, contextIsolation: false },   // fichier LOCAL de confiance uniquement
    });
    let done = false;
    const finish = choice => {
      if (done) return; done = true;
      try { ipcMain.removeListener('dtp-update-choice', onChoice); } catch (_) {}
      if (m && !m.isDestroyed()) m.close(); m = null;
      resolve(choice);
    };
    const onChoice = (e, choice) => { if (m && !m.isDestroyed() && e.sender === m.webContents) finish(choice === 'primary' ? 'primary' : 'secondary'); };
    ipcMain.on('dtp-update-choice', onChoice);
    m.once('ready-to-show', () => { if (m && !m.isDestroyed()) m.show(); });
    m.on('closed', () => finish('secondary'));   // croix / fermeture = « Plus tard »
    m.loadFile(path.join(__dirname, 'update-modal.html'), { search });
  });
}

// Hauteur de la barre supérieure du desk (doit rester alignée sur --topbar-h côté .dtp-desktop dans
// style.css). Sert à positionner PARFAITEMENT les contrôles système natifs dans la topbar DTP :
//  · Windows → hauteur de la surface min/max/close (titleBarOverlay)
//  · macOS   → centrage vertical des feux tricolores (trafficLightPosition)
const TOPBAR_H = 50;
// Couleurs alignées sur l'identité du desk (var --bg2 / texte estompé) → les boutons système se fondent
// dans la topbar au lieu de trancher (fin de l'aspect « barre Windows classique »).
const TITLEBAR_BG     = '#16171b';   // = --bg2 (fond de la topbar)
const TITLEBAR_SYMBOL = '#9a9aa4';   // glyphes min/max/close estompés (survol géré par l'OS)

// ── MISE À JOUR — PROPOSÉE DÈS LE LANCEMENT ───────────────────────────────────────────────────
// Dès l'ouverture (puis toutes les 6 h), l'app compare sa version au flux /downloads/.
//  · Windows (electron-updater) : si une version plus récente existe → dialogue « Mettre à jour maintenant ? »
//    IMMÉDIAT (autoDownload=false → on ne télécharge qu'après l'accord de l'utilisateur), puis redémarrage.
//    Filet autoInstallOnAppQuit : appliquée au prochain quit même si l'user reporte.
//  · macOS (non signé → pas d'auto-install Squirrel) : vérification manuelle de latest-mac.yml → dialogue
//    « Télécharger la mise à jour » qui ouvre le bon .dmg (Apple Silicon vs Intel).
// Publier une MAJ = bumper package.json, build CI, uploader Setup.exe+blockmap+latest.yml (+ .dmg/.zip+latest-mac.yml).
// Robuste : désactivé en dev (non empaqueté) ; toute erreur est non bloquante (l'app charge le site normalement).
const DL_BASE = 'https://desk.datatradingpro.com/downloads/';
const _verGt = (a, b) => {   // a > b ? (versions sémantiques x.y.z)
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
  return false;
};

// macOS : compare la version distante (latest-mac.yml) et propose le téléchargement du bon .dmg.
let _macPromptShown = false;
function checkMacUpdate() {
  if (_macPromptShown) return;
  https.get(DL_BASE + 'latest-mac.yml', res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => {
      const m = d.match(/version:\s*([0-9][0-9.]*)/i);
      const remote = m && m[1];
      if (!remote || !_verGt(remote, app.getVersion())) return;
      if (_macPromptShown || !win || win.isDestroyed()) return;
      _macPromptShown = true;
      const dmg = process.arch === 'arm64' ? 'DataTradingPro-macOS.dmg' : 'DataTradingPro-macOS-Intel.dmg';
      showUpdateModal({
        title: 'Mise à jour disponible',
        message: `Une nouvelle version de DataTradingPro (${remote}) est disponible.`,
        detail: 'Téléchargez le fichier .dmg, puis glissez DataTradingPro dans Applications (remplace l’ancienne version).',
        primary: 'Télécharger la mise à jour', secondary: 'Plus tard',
      }).then(c => { if (c === 'primary') shell.openExternal(DL_BASE + dmg).catch(() => {}); });
    });
  }).on('error', () => {});
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;

  // macOS : pas d'auto-update Squirrel sans signature Apple → vérification manuelle + proposition de download.
  if (process.platform === 'darwin') {
    setTimeout(checkMacUpdate, 3500);                                  // au lancement (fenêtre prête)
    setInterval(checkMacUpdate, 6 * 60 * 60 * 1000);
    return;
  }

  // Windows : electron-updater, mais on PROPOSE avant de télécharger (dialogue dès la détection au lancement).
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = false;                        // on ne télécharge qu'APRÈS l'accord de l'utilisateur
  autoUpdater.autoInstallOnAppQuit = true;                 // filet : appliquée au prochain quit
  let _downloading = false;

  autoUpdater.on('update-available', (info) => {
    if (_downloading || !win || win.isDestroyed()) return;
    showUpdateModal({
      title: 'Mise à jour disponible',
      message: `Une nouvelle version de DataTradingPro${info && info.version ? ' (' + info.version + ')' : ''} est disponible.`,
      detail: 'Elle apporte les dernières améliorations de l’application. Le téléchargement se fait en arrière-plan, puis l’app redémarre.',
      primary: 'Mettre à jour maintenant', secondary: 'Plus tard',
    }).then(c => { if (c === 'primary') { _downloading = true; autoUpdater.downloadUpdate().catch(() => {}); } });
  });

  autoUpdater.on('update-downloaded', () => {
    if (!win || win.isDestroyed()) return;
    showUpdateModal({
      title: 'Mise à jour prête',
      message: 'La mise à jour de DataTradingPro est téléchargée.',
      detail: 'Redémarrez pour l’appliquer (elle s’installera aussi automatiquement à la prochaine fermeture).',
      primary: 'Redémarrer maintenant', secondary: 'Plus tard',
    }).then(c => { if (c === 'primary') setImmediate(() => autoUpdater.quitAndInstall()); });
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
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: '#0d0e11',          // fond HUD du desk pendant le chargement (zéro flash blanc)
    show: false,                         // on n'affiche qu'au 'ready-to-show' → apparition propre, sans clignotement
    autoHideMenuBar: true,               // barre de menu masquée (Alt pour l'afficher sous Windows)
    fullscreenable: true,                // plein écran : F11 (Windows) / Ctrl+Cmd+F ou bouton vert (macOS)
    title: 'DataTradingPro',
    icon: path.join(__dirname, 'build', 'icon.png'),

    // ── FENÊTRE NATIVE MODERNE — la barre de titre « Windows classique » est supprimée : le contenu du
    //    desk s'étend jusqu'en haut et les contrôles système sont intégrés DANS la topbar DTP. On garde
    //    le cadre natif (déplacement, redimensionnement, accroche, ombres, coins arrondis OS) — on ne
    //    passe PAS par frame:false (comportements natifs préservés = plus propre et maintenable).
    // titleBarStyle:'hidden' UNIQUEMENT Windows/macOS (les 2 seules cibles buildées) : sous Linux (dev),
    // on garde le cadre natif par défaut pour ne jamais se retrouver sans boutons de fermeture.
    ...((isWin || isMac) ? { titleBarStyle: 'hidden' } : {}),
    ...(isWin ? {
      // Windows 11 : boutons min/max/close en surimpression, teintés aux couleurs du desk + fond Mica natif.
      titleBarOverlay: { color: TITLEBAR_BG, symbolColor: TITLEBAR_SYMBOL, height: TOPBAR_H },
      backgroundMaterial: 'mica',        // matériau natif Win11 (repli automatique sur les versions plus anciennes)
    } : {}),
    ...(isMac ? {
      // macOS : feux tricolores natifs, centrés verticalement dans la topbar ; vibrance sous-fenêtre.
      trafficLightPosition: { x: 18, y: Math.round((TOPBAR_H - 16) / 2) },
      vibrancy: 'under-window',
      visualEffectState: 'active',       // la vibrance reste vive même fenêtre inactive (fini le gris terne)
    } : {}),
    roundedCorners: true,                // coins arrondis natifs (macOS toujours ; Win11 via DWM)

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),   // signale « je tourne dans l'app » → style topbar intégrée
      nodeIntegration: false,            // la page web n'a AUCUN accès Node (sécurité)
      contextIsolation: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => { if (win && !win.isDestroyed()) win.show(); });
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

  // État actif / inactif : on prévient la page (topbar légèrement estompée hors focus — détail premium).
  const pushFocus = focused => { try { if (win && !win.isDestroyed()) win.webContents.send('dtp-window-focus', focused); } catch (_) {} };
  win.on('focus', () => pushFocus(true));
  win.on('blur',  () => pushFocus(false));
  win.webContents.on('did-finish-load', () => pushFocus(win && win.isFocused()));

  // Double-clic sur la topbar (relayé par le preload) = agrandir/restaurer — convention native.
  // macOS : respecte l'action système du double-clic titre (Agrandir/Réduire dans Réglages) via getUserDefault.
  ipcMain.removeAllListeners('dtp-titlebar-dblclick');
  ipcMain.on('dtp-titlebar-dblclick', (e) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    if (process.platform === 'darwin') {
      try {
        const { systemPreferences } = require('electron');
        const action = systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string');
        if (action === 'Minimize') return win.minimize();
        if (action === 'None') return;
      } catch (_) {}
    }
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });

  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => { buildMenu(); createWindow(); setupAutoUpdate(); });

// macOS : l'app reste dans le Dock fenêtre fermée ; clic Dock → rouvre
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

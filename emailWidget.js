// emailWidget.js — rend les VRAIS widgets du desk en image PNG (via puppeteer), pour les e-mails.
// Un e-mail ne peut pas exécuter amCharts/JS ; on capture donc le widget réel (rendu avec les VRAIES
// données) et on sert un PNG que tous les clients mail (Gmail/Outlook) savent afficher.
// La page de rendu interne (/internal/email-widget/<type>) charge le vrai public/js/charts.js + amCharts
// et reçoit les données injectées côté serveur (aucune auth, aucun fetch client).
const puppeteer = require('puppeteer-extra');
const Stealth   = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

// Même résolution Chrome que le scraper FinancialJuice (Windows local / Linux VPS).
function _resolveChromeExec() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.env.CHROME_EXEC)               return process.env.CHROME_EXEC;
  if (process.platform === 'win32')  return 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const { existsSync } = require('fs');
  const known = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/nix/var/nix/profiles/default/bin/chromium'];
  const found = known.find(existsSync);
  if (found) return found;
  try { const { execSync } = require('child_process'); const p = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null').toString().trim(); if (p) return p; } catch {}
  return 'chromium';
}
const CHROME_PATH = _resolveChromeExec();
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

// Catalogue des widgets rendus (chaque type = une route de rendu + un sélecteur + une taille logique).
const SPECS = {
  strength:            { path: '/internal/email-widget/strength',          sel: '#box',          w: 600, h: 300 },
  regime:              { path: '/internal/email-widget/regime',            sel: '#risk-widget',  w: 600, h: 360 },
  'strength-snapshot': { path: '/internal/email-widget/strength-snapshot', sel: '#box',          w: 600, h: 380 },
  'risk-history':      { path: '/internal/email-widget/risk-history',      sel: '#box',          w: 600, h: 210 },
  bias:                { path: '/internal/email-widget/bias',              sel: '#bias-content', w: 640, h: 470 },
  'week-ahead':        { path: '/internal/email-widget/week-ahead',        sel: '.wa-wrap',      w: 640, h: 900, clipLast: '.wa-card' },
  cot:                 { path: '/internal/email-widget/cot',              sel: '#cot-grid',     w: 640, h: 640, clipLast: '.cot-cell' },
};

// ─── Navigateur partagé (lancé à la demande, refermé après inactivité pour ménager la RAM du VPS) ───
let _browser = null, _launching = null, _idleTimer = null;
async function _getBrowser() {
  if (_browser && _browser.connected) return _browser;   // puppeteer v25 : propriete .connected (isConnected() supprime)
  if (_launching) return _launching;
  _launching = puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb'],
  }).then(b => {
    _browser = b; _launching = null;
    b.on('disconnected', () => { _browser = null; });
    return b;
  }).catch(e => { _launching = null; throw e; });
  return _launching;
}
function _scheduleIdleClose() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(async () => {
    if (_inflight.size) return _scheduleIdleClose();          // un rendu est en cours → on repousse
    try { if (_browser) await _browser.close(); } catch {}
    _browser = null;
  }, 3 * 60 * 1000);
}

// ─── Cache mémoire des PNG (par type+période) + déduplication des rendus concurrents ───
const TTL = 10 * 60 * 1000;   // 10 min : un mail ouvert plusieurs fois ne relance pas Chrome
const _cache = new Map();      // key -> { png, ts }
const _inflight = new Map();   // key -> Promise

async function renderWidgetPng(type, opts = {}) {
  const spec = SPECS[type];
  if (!spec) throw new Error('widget inconnu: ' + type);
  const period = String(opts.period || 'week').replace(/[^a-z0-9]/gi, '') || 'week';
  const key = type + ':' + period;

  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.png;
  if (_inflight.has(key)) return _inflight.get(key);

  const job = (async () => {
    const browser = await _getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: spec.w + 24, height: spec.h + 24, deviceScaleFactor: 2 });   // 2x = net en HD
      await page.goto(`${BASE}${spec.path}?period=${period}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForFunction('window.__ready === true', { timeout: 20000 }).catch(() => {});   // chaque page de rendu pose __ready apres le rendu (+ delai d'animation)
      const el = await page.$(spec.sel);
      if (!el) throw new Error('element introuvable: ' + spec.sel);
      let shot;
      if (spec.clipLast) {
        // Certains conteneurs du desk gardent une hauteur "pleine fenetre" → on decoupe pile au bas du
        // dernier element de contenu (fini l'espace vide en bas), au lieu de capturer toute la boite.
        const clip = await page.evaluate((rootSel, lastSel) => {
          const root = document.querySelector(rootSel);
          if (!root) return { _err: 'no root ' + rootSel };
          const r = root.getBoundingClientRect();
          const items = document.querySelectorAll(lastSel);
          const last = items[items.length - 1];
          const bottom = last ? last.getBoundingClientRect().bottom : r.bottom;
          return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.max(1, r.width), height: Math.max(40, bottom - r.y + 16) };
        }, spec.sel, spec.clipLast);
        shot = clip
          ? await page.screenshot({ type: 'png', clip, captureBeyondViewport: true })
          : await el.screenshot({ type: 'png' });
      } else {
        shot = await el.screenshot({ type: 'png' });
      }
      const png = Buffer.from(shot);
      _cache.set(key, { png, ts: Date.now() });
      return png;
    } finally {
      await page.close().catch(() => {});
    }
  })().finally(() => { _inflight.delete(key); _scheduleIdleClose(); });

  _inflight.set(key, job);
  return job;
}

module.exports = { renderWidgetPng, SPECS, CHROME_PATH };

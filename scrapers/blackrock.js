/**
 * BlackRock Investment Institute — Weekly Commentary (Puppeteer + Stealth)
 * ------------------------------------------------------------------------
 * La page "weekly-commentary" est une SPA derrière Akamai (403 en HTTP simple).
 * On charge donc la page dans un vrai Chromium (stealth), puis on extrait par REGEX
 * sur le HTML rendu TOUS les liens PDF au format officiel :
 *     /literature/market-commentary/weekly-investment-commentary-en-us-YYYYMMDD-<slug>.pdf
 * Chaque URL porte la DATE (YYYYMMDD) + le SLUG (titre) → tout ce qu'il faut.
 *
 * Lancement ONE-SHOT (launch → scrape → close) : aucun navigateur gardé en vie
 * (anti-OOM). Profil persistant (.chrome_profile_blackrock) → les cookies/clairance
 * Akamai survivent entre deux passages. Cache 3 h (contenu hebdomadaire).
 * Échec silencieux si Akamai bloque → le serveur garde son seed 2026 + dernier cache.
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

function _resolveChromeExec() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.env.CHROME_EXEC)               return process.env.CHROME_EXEC;
  if (process.platform === 'win32')  return 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const { existsSync } = require('fs');
  const knownPaths = [
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    '/nix/var/nix/profiles/default/bin/chromium',
  ];
  const found = knownPaths.find(existsSync);
  if (found) return found;
  try {
    const { execSync } = require('child_process');
    const p = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null').toString().trim();
    if (p) return p;
  } catch {}
  return 'chromium';
}

const CHROME_PATH = _resolveChromeExec();
const USER_DATA   = path.join(__dirname, '..', '.chrome_profile_blackrock');
const CACHE_FILE  = path.join(__dirname, '..', 'cache_blackrock.json');
const CACHE_TTL   = 3 * 60 * 60 * 1000;   // 3 h — contenu hebdomadaire, inutile de scraper souvent
const UA          = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Pages liste à tenter (us/individual d'abord, repli corporate).
const LIST_URLS = [
  'https://www.blackrock.com/us/individual/insights/blackrock-investment-institute/weekly-commentary',
  'https://www.blackrock.com/corporate/insights/blackrock-investment-institute/publications/weekly-commentary',
];

// Pattern officiel des PDF (relatif OU absolu).
const PDF_RE = /(?:https?:\/\/www\.blackrock\.com)?(\/[a-z0-9/\-]*?literature\/market-commentary\/weekly-investment-commentary-en-us-\d{8}-[a-z0-9-]+\.pdf)/gi;

let _cache = { items: [], ts: 0 };
let _busy  = false;

function loadDisk() { try { const r = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); if (Array.isArray(r.items) && r.items.length) return r.items; } catch {} return null; }
function saveDisk(items) { try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), items })); } catch {} }

function _extractFromHtml(html) {
  const out = new Map();   // url → { url }
  if (!html) return [];
  let m;
  PDF_RE.lastIndex = 0;
  while ((m = PDF_RE.exec(html)) !== null) {
    const url = 'https://www.blackrock.com' + m[1];
    if (!out.has(url)) out.set(url, { url });
  }
  return [...out.values()];
}

async function _launch() {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: USER_DATA,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
      '--single-process', '--no-zygote', '--disable-gpu', '--disable-extensions',
      '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-software-rasterizer', '--disable-background-networking', '--disable-default-apps', '--disable-sync',
      '--mute-audio', '--blink-settings=imagesEnabled=false', '--js-flags=--max-old-space-size=192',
    ],
  });
}

async function _scrapeOnce() {
  let browser = null;
  try {
    browser = await _launch();
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    let found = [];
    for (const url of LIST_URLS) {
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 35_000 }).catch(() => {});
        // Laisser Akamai/SPA se résoudre (le challenge tourne in-page, sans navigation).
        for (let i = 0; i < 20; i++) {
          let t = ''; try { t = await page.title(); } catch {}
          if (t && !/just a moment|access denied|forbidden|attention required|pardon/i.test(t)) break;
          await new Promise(r => setTimeout(r, 1000));
        }
        await page.waitForFunction(() => document.querySelectorAll('a[href]').length > 20, { timeout: 12_000, polling: 500 }).catch(() => {});
        // Scroll pour déclencher le lazy-load de l'archive.
        for (let i = 0; i < 5; i++) { try { await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight)); } catch {} await new Promise(r => setTimeout(r, 1100)); }
        let html = ''; try { html = await page.content(); } catch {}
        const items = _extractFromHtml(html);
        if (items.length) { found = items; break; }   // une page liste a suffi
      } catch (e) { /* on tente l'URL suivante */ }
    }
    try { await page.close(); } catch {}
    if (found.length) {
      _cache = { items: found, ts: Date.now() }; saveDisk(found);
      console.log(`[BlackRock] ${found.length} PDF hebdo découverts`);
      return found;
    }
    console.warn('[BlackRock] aucun PDF trouvé (Akamai a probablement bloqué la page) — seed conservé');
    return [];
  } catch (e) {
    console.error('[BlackRock]', e.message);
    return [];
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

// API publique : renvoie la liste des { url } de PDF (best-effort, jamais d'exception).
async function scrapeBlackRock() {
  if (Date.now() - _cache.ts < CACHE_TTL && _cache.items.length) return _cache.items;
  if (_busy) return _cache.items.length ? _cache.items : (loadDisk() || []);
  _busy = true;
  try {
    const items = await _scrapeOnce();
    if (items.length) return items;
    const disk = loadDisk();
    if (disk) { _cache = { items: disk, ts: Date.now() - CACHE_TTL + 30 * 60 * 1000 }; return disk; }
    return [];
  } finally { _busy = false; }
}

module.exports = { scrapeBlackRock };

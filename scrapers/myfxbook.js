/**
 * Myfxbook Community Outlook — retail trader sentiment
 *
 * Primary path: Myfxbook REST API (login → session → community-outlook).
 * Fallback:     Puppeteer DOM extraction (no API interception — the page's
 *               XHR returns volume %, not position %; DOM tooltip has the
 *               correct "Short 42% ... lots" position percentages).
 * Cache TTL: 5 min (shared across H1/H4/D1 — one dataset).
 */

const puppeteer    = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

puppeteer.use(StealthPlugin());

// Détecte le chemin Chrome/Chromium selon l'environnement (Windows local, Linux cloud…)
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
    if (p) { console.log('[Chrome] found via PATH:', p); return p; }
  } catch {}
  return 'chromium';
}

const CHROME_PATH  = _resolveChromeExec();
const OUTLOOK_URL  = 'https://www.myfxbook.com/community/outlook';
const LOGIN_URL    = 'https://www.myfxbook.com/login';
const LOGIN_API    = 'https://www.myfxbook.com/api/login.json';
const OUTLOOK_API  = 'https://www.myfxbook.com/api/get-community-outlook.json';
const CACHE_FILE   = path.join(__dirname, '..', 'cache_myfxbook.json');
const USER_DATA    = path.join(__dirname, '..', '.chrome_profile_myfxbook');
const CACHE_TTL    = 5 * 60 * 1000;    // 5 min in-memory cache
const DISK_TTL     = 30 * 60 * 1000;   // 30 min disk cache (survives server restart)
const SESSION_TTL  = 55 * 60 * 1000;   // 55 min session cache (token expires ~1h)

const MFB_EMAIL = process.env.MFB_EMAIL || 'gostan.dev@gmail.com';
const MFB_PASS  = process.env.MFB_PASS  || 'Turquie25#';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _browser   = null;
let _launching = false;
let _mem = {}, _memTs = {};
let _session   = null;
let _sessionTs = 0;

// ─── Disk cache ───────────────────────────────────────────────────────────────

function saveDisk(period, data) {
  try {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
    all[period] = { ts: Date.now(), data };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(all));
  } catch {}
}

function loadDisk(period) {
  try {
    const all = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const e   = all[period];
    if (e && Date.now() - e.ts < DISK_TTL && Array.isArray(e.data) && e.data.length > 0)
      return e.data;
  } catch {}
  return null;
}

// ─── Normalise raw symbol array ───────────────────────────────────────────────

function round1(n) { return Math.round(n * 10) / 10; }

function normalise(raw) {
  const result = raw
    .filter(s => s && (s.name || s.symbol) &&
      (s.shortPercentage != null || s.longPercentage != null ||
       s.shortVolume != null     || s.short != null || s.shorts != null))
    .map(s => {
      let shortPct;
      if (s.shortPercentage != null)     shortPct = round1(+s.shortPercentage);
      else if (s.short != null)          shortPct = round1(+s.short);
      else if (s.shorts != null)         shortPct = round1(+s.shorts);
      else if (s.shortVolume != null && s.longVolume != null) {
        const total = +s.shortVolume + +s.longVolume;
        shortPct = total > 0 ? round1(+s.shortVolume / total * 100) : 50;
      } else {
        shortPct = 50;
      }
      shortPct = Math.max(0, Math.min(100, shortPct));
      const longPct = round1(100 - shortPct);
      return {
        symbol:  (s.name || s.symbol || '').toUpperCase().replace(/[^A-Z]/g, ''),
        shortPct,
        longPct,
        trend:   shortPct > longPct ? 'Short' : 'Long',
      };
    })
    .filter(s => s.symbol.length >= 3);

  return result.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// ─── REST API session ─────────────────────────────────────────────────────────

async function getApiSession() {
  if (_session && Date.now() - _sessionTs < SESSION_TTL) return _session;

  const r = await axios.get(LOGIN_API, {
    params: { email: MFB_EMAIL, password: MFB_PASS },
    timeout: 15_000,
    headers: { 'User-Agent': UA },
    validateStatus: () => true,
  });

  if (r.data?.error === false && r.data?.session) {
    _session   = r.data.session;
    _sessionTs = Date.now();
    console.log('[Myfxbook] API session obtained');
    return _session;
  }
  throw new Error(`Login API failed: ${r.data?.message || r.status}`);
}

async function fetchViaApi() {
  const session = await getApiSession();
  // Pass session directly in the URL — the login API returns an already-URL-encoded
  // token; using axios `params` would double-encode it (% → %25) causing "Invalid session".
  const r = await axios.get(`${OUTLOOK_API}?session=${session}`, {
    timeout: 15_000,
    headers: { 'User-Agent': UA, 'Referer': OUTLOOK_URL },
    validateStatus: () => true,
  });
  if (r.data?.error === false && Array.isArray(r.data?.symbols) && r.data.symbols.length > 0) {
    console.log(`[Myfxbook] ${r.data.symbols.length} symbols via REST API`);
    return r.data.symbols;
  }
  // Session may have expired — invalidate so next call gets a fresh one
  _session = null;
  throw new Error(`Community outlook API returned: ${r.data?.message || r.status}`);
}

// ─── Browser management ───────────────────────────────────────────────────────

async function getBrowser() {
  if (_browser) {
    try { await _browser.pages(); return _browser; } catch {}
    _browser = null;
  }
  if (_launching) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (_browser) return _browser;
    }
    throw new Error('Browser launch timeout');
  }
  _launching = true;
  try {
    _browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      userDataDir: USER_DATA,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        // Économie mémoire (hébergement 512 Mo)
        '--single-process', '--no-zygote', '--disable-gpu', '--disable-extensions',
      ],
    });
    _browser.on('disconnected', () => { _browser = null; });
    console.log('[Myfxbook] Browser launched');
    return _browser;
  } finally {
    _launching = false;
  }
}

// ─── Login helper ─────────────────────────────────────────────────────────────

let _loggedIn = false;

async function ensureLoggedIn(browser) {
  if (_loggedIn) return;
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30_000 });

    const url = page.url();
    if (!url.includes('/login')) { _loggedIn = true; return; }

    await page.waitForSelector('input[type="email"], input[type="text"]', { timeout: 8_000 });
    const emailSel = await page.$('input[type="email"]') || await page.$('input[type="text"]');
    const passSel  = await page.$('input[type="password"]');
    if (emailSel && passSel) {
      await emailSel.click({ clickCount: 3 }); await emailSel.type(MFB_EMAIL, { delay: 40 });
      await passSel.click({ clickCount: 3 });  await passSel.type(MFB_PASS,  { delay: 40 });
      await passSel.press('Enter');
      await new Promise(r => setTimeout(r, 5000));
      _loggedIn = !page.url().includes('/login');
      console.log('[Myfxbook] Web login', _loggedIn ? 'OK' : 'FAILED');
    }
  } catch (e) {
    console.warn('[Myfxbook] Web login failed:', e.message);
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Puppeteer fallback — DOM extraction only (no API interception) ───────────
//
// IMPORTANT: We do NOT intercept XHR responses here.
// The page's XHR returns VOLUME percentages (e.g. 1.2% for EURUSD).
// The POSITION percentages (42%) are only in the tooltip cell text:
//   "Short 42% 8158.16 lots 29978 Long 58% 11244.90 lots 31500"
// We identify position cells by the "lots" keyword.

async function fetchViaPuppeteer() {
  const browser = await getBrowser();
  await ensureLoggedIn(browser);

  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.goto(OUTLOOK_URL, { waitUntil: 'networkidle2', timeout: 45_000 });
    await new Promise(r => setTimeout(r, 4000));

    const domData = await page.evaluate(() => {
      const result = [];
      const seen   = new Set();

      document.querySelectorAll('table tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')];
        if (cells.length < 2) return;

        const symRaw = cells[0].textContent.replace(/[^A-Z]/gi, '').toUpperCase();
        if (symRaw.length < 5 || symRaw.length > 7) return;
        const symbol = symRaw.slice(0, 6);
        if (seen.has(symbol)) return;

        // Only match cells that contain "lots" — these are the position % cells
        // (volume cells don't mention lots; position tooltip format is:
        //  "Short 42% 8158.16 lots 29978 Long 58% 11244.90 lots 31500")
        let shortPct = null, longPct = null;
        for (const cell of cells) {
          const text = cell.textContent;
          if (!text.toLowerCase().includes('lots')) continue;
          const sm = text.match(/Short\s+(\d+(?:\.\d+)?)\s*%/i);
          const lm = text.match(/Long\s+(\d+(?:\.\d+)?)\s*%/i);
          if (sm && lm) {
            shortPct = parseFloat(sm[1]);
            longPct  = parseFloat(lm[1]);
            break;
          }
        }

        if (shortPct !== null && longPct !== null) {
          seen.add(symbol);
          result.push({ name: symbol, shortPercentage: shortPct, longPercentage: longPct });
        }
      });

      return result;
    });

    if (domData.length > 0) {
      console.log(`[Myfxbook] DOM extracted: ${domData.length} rows (Puppeteer fallback)`);
      return domData;
    }

    console.warn('[Myfxbook] Puppeteer: page loaded but no data found');
    return null;

  } catch (e) {
    console.error('[Myfxbook] Puppeteer error:', e.message);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Charge le cache disque SANS contrôle d'âge (servir des données un peu datées > rien)
function loadDiskAny(period) {
  try {
    const all = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const e   = all[period];
    if (e && Array.isArray(e.data) && e.data.length > 0) return e.data;
  } catch {}
  return null;
}

// Le VRAI fetch (API → Puppeteer), met en cache les 3 périodes. Renvoie les données ou [].
// Déduplication par promesse : un seul fetch concurrent (évite 2 Puppeteer au démarrage).
let _fetchPromise = null;
function _doFetch() {
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = (async () => {
    const save = data => {
      for (const p of ['H1', 'H4', 'D1']) { _mem[p] = data; _memTs[p] = Date.now(); saveDisk(p, data); }
    };
    // Attempt 1: REST API (rapide) — 2 essais (session fraîche au 2e)
    for (let i = 0; i < 2; i++) {
      try {
        const data = normalise(await fetchViaApi());
        if (data.length > 0) { save(data); return data; }
      } catch (e) { console.warn(`[Myfxbook] API attempt ${i + 1} failed:`, e.message); }
    }
    // Attempt 2: Puppeteer DOM (lent) — uniquement si l'API a échoué
    try {
      const raw = await fetchViaPuppeteer();
      if (raw && raw.length > 0) {
        const data = normalise(raw);
        if (data.length > 0) { save(data); return data; }
      }
    } catch (e) {
      console.error('[Myfxbook] Puppeteer attempt failed:', e.message);
    } finally {
      await closeBrowser();   // libère Chromium (~150 Mo) sur hébergement 512 Mo
    }
    console.warn('[Myfxbook] all methods failed — returning empty');
    return [];
  })().finally(() => { _fetchPromise = null; });
  return _fetchPromise;
}

// Rafraîchissement EN ARRIÈRE-PLAN (jamais bloquant)
function _bgRefresh() { _doFetch().catch(() => {}); }

// API publique — STALE-WHILE-REVALIDATE : on sert le cache INSTANTANÉMENT,
// on rafraîchit en arrière-plan. Ne bloque QUE s'il n'y a aucune donnée du tout.
async function fetchCommunityOutlook(period = 'H1') {
  // 1) cache mémoire FRAIS (< 5 min) → instantané
  if (_mem[period] && Date.now() - (_memTs[period] || 0) < CACHE_TTL) return _mem[period];
  // 2) cache mémoire périmé OU cache disque (même daté) → on SERT tout de suite + refresh en fond
  let cached = (_mem[period] && _mem[period].length) ? _mem[period] : loadDiskAny(period);
  if (cached && cached.length >= 5) {
    _mem[period] = cached; if (!_memTs[period]) _memTs[period] = Date.now();
    _bgRefresh();
    return cached;
  }
  // 3) AUCUN cache → on attend le fetch (première fois seulement)
  return await _doFetch();
}

// Force un rafraîchissement en arrière-plan (sans vider le cache → aucun blocage)
function refreshOutlookBg() { _bgRefresh(); }
// Fetch FRAIS attendu (pour le refresh périodique serveur / préchauffage)
async function forceFetchOutlook() { return _doFetch(); }

async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch {} _browser = null; _loggedIn = false; }
}

function clearOutlookCache() {
  _mem = {};
  _memTs = {};
  _session = null;
  _sessionTs = 0;
}

module.exports = { fetchCommunityOutlook, refreshOutlookBg, forceFetchOutlook, clearOutlookCache, closeBrowser };

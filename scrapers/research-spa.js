/**
 * Recherche institutionnelle sur sites SPA (Puppeteer + Stealth) — générique, piloté par config.
 * ------------------------------------------------------------------------------------------------
 * Certains sites de recherche (Natixis, Danske…) sont des SPA derrière protection anti-bot : le
 * HTTP simple ne voit qu'un loader. On rend donc la page dans un vrai Chromium (stealth) puis on
 * extrait les liens de publications (titre + date + URL) par heuristique STRICTE (pour ne PAS
 * polluer l'onglet Institution avec de la navigation). Lancement ONE-SHOT (anti-OOM), profil
 * persistant par site (cookies/clairance), échec silencieux si bloqué.
 *
 * Une publication n'est retenue que si : href same-host + matche le pattern d'article du site +
 * titre plausible (>=3 mots, 18-180 car.). La date est extraite du contexte de la carte si présente,
 * sinon « maintenant » (les Morning Line sont quotidiennes → les plus récentes restent justes).
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
puppeteer.use(StealthPlugin());

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
const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TTL = 2 * 60 * 60 * 1000;   // 2 h — recherche quotidienne, inutile de relancer Chromium souvent

const _cache = {};   // source → { items, ts }
const _busy  = {};

async function _launch(profile) {
  return puppeteer.launch({
    executablePath: CHROME_PATH, headless: true, userDataDir: profile,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--single-process', '--no-zygote', '--disable-gpu', '--disable-extensions',
      '--disable-features=IsolateOrigins,site-per-process,TranslateUI', '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-software-rasterizer',
      '--disable-background-networking', '--disable-default-apps', '--disable-sync', '--mute-audio',
      '--blink-settings=imagesEnabled=false', '--js-flags=--max-old-space-size=192'],
  });
}

function _parseDate(ctx) {
  if (!ctx) return null;
  let m;
  if ((m = ctx.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)))                          { const t = Date.UTC(+m[1], +m[2] - 1, +m[3], 12); return isNaN(t) ? null : t; }
  if ((m = ctx.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\b/)))              { const t = Date.UTC(+m[3], +m[2] - 1, +m[1], 12); return isNaN(t) ? null : t; }
  if ((m = ctx.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i))) { const t = Date.parse(`${m[1]} ${m[2]} ${m[3]}`); return isNaN(t) ? null : t; }
  if ((m = ctx.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i))) { const t = Date.parse(`${m[2]} ${m[1]} ${m[3]}`); return isNaN(t) ? null : t; }
  return null;
}

async function _scrapeSite(cfg) {
  let browser = null;
  try {
    browser = await _launch(path.join(__dirname, '..', '.chrome_profile_' + cfg.source));
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(cfg.url, { waitUntil: 'load', timeout: 35_000 }).catch(() => {});
    for (let i = 0; i < 18; i++) { let t = ''; try { t = await page.title(); } catch {} if (t && !/just a moment|access denied|forbidden|attention required|pardon|robot/i.test(t)) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.waitForFunction(() => document.querySelectorAll('a[href]').length > 15, { timeout: 12_000, polling: 500 }).catch(() => {});
    for (let i = 0; i < 3; i++) { try { await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight)); } catch {} await new Promise(r => setTimeout(r, 1000)); }
    const raw = await page.evaluate((reSrc, host) => {
      const re = new RegExp(reSrc, 'i');
      const out = []; const seen = new Set();
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href || '';
        if (!href || href.indexOf(host) < 0 || !re.test(href)) return;
        const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (title.length < 18 || title.length > 180 || title.split(/\s+/).length < 3) return;
        if (/^(home|log ?in|sign ?in|register|subscribe|contact|about|privacy|terms|cookies?|all publications|read more|see all|view all|latest publications|load more)\b/i.test(title)) return;
        const key = href.split('#')[0].split('?')[0];
        if (seen.has(key)) return; seen.add(key);
        const card = a.closest('li, article, [class*="card"], [class*="item"], [class*="row"], [class*="publication"], [class*="result"]') || a.parentElement;
        const ctx  = (card ? card.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 280);
        out.push({ url: key, title, ctx });
      });
      return out.slice(0, 40);
    }, cfg.hrefRe.source, cfg.host);
    try { await page.close(); } catch {}
    return raw || [];
  } catch (e) {
    console.error('[ResearchSPA ' + cfg.source + ']', e.message);
    return [];
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

// Renvoie [{ title, url, ts }] (best-effort, jamais d'exception).
async function scrapeResearchSpa(cfg) {
  const key = cfg.source;
  if (_cache[key] && Date.now() - _cache[key].ts < TTL && _cache[key].items.length) return _cache[key].items;
  if (_busy[key]) return (_cache[key] && _cache[key].items) || [];
  _busy[key] = true;
  try {
    const raw = await _scrapeSite(cfg);
    const seen = new Set(); const items = []; let dated = 0;
    for (const r of raw) {
      if (seen.has(r.url)) continue; seen.add(r.url);
      const real = _parseDate(r.ctx);
      if (real) dated++;
      items.push({ title: r.title, url: r.url, ts: real || Date.now() });
    }
    const top = items.slice(0, 14);
    if (top.length) { _cache[key] = { items: top, ts: Date.now() }; console.log(`[ResearchSPA ${key}] ${top.length} publications (${dated} datées) sur ${raw.length} liens bruts`); }
    else console.warn(`[ResearchSPA ${key}] 0 publication retenue (${raw.length} liens bruts) — bloqué ou pattern à ajuster`);
    return top;
  } finally { _busy[key] = false; }
}

module.exports = { scrapeResearchSpa };

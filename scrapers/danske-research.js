/**
 * Danske Bank Research — récupération via l'API publique (api5.danskebank.com), 0 IA.
 * ------------------------------------------------------------------------------------------------
 * research.danskebank.com est une SPA React dont l'API de LISTE (gateway IBM) REJETTE toute requête
 * hors-navigateur (500 « Index out of bounds » même avec le client-id/secret) : il faut le contexte
 * complet du navigateur (cookies/Origin). On rend donc la page UNE fois dans Chromium (stealth) et on
 * INTERCEPTE la réponse JSON de l'API de liste — elle porte TOUT en un appel : title, published_url
 * (= PDF NATIF sur research.danskebank.com/link/<id>/$file/<nom>.pdf), mobile_text (contenu complet),
 * published_date, categoryInfo. One-shot, caché 2 h, échec silencieux (jamais d'exception).
 *
 * NB : le PDF natif (published_url) est servable tel quel via /api/pdf-proxy (danskebank.com whitelisté).
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const { existsSync } = require('fs');
puppeteer.use(StealthPlugin());

function _chrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.env.CHROME_EXEC)               return process.env.CHROME_EXEC;
  if (process.platform === 'win32')  return 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const known = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/nix/var/nix/profiles/default/bin/chromium'];
  return known.find(existsSync) || 'chromium';
}
const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TTL = 2 * 60 * 60 * 1000;   // 2 h — recherche quotidienne, inutile de relancer Chromium souvent

let _cache = null, _cacheTs = 0, _busy = false;

const _strip = h => String(h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// Date : published_date si parsable, sinon le DDMMYY du nom de fichier du PDF (ex. ..._190626.pdf), sinon maintenant.
function _date(a) {
  const d = a && a.published_date && Date.parse(a.published_date);
  if (d && !isNaN(d)) return d;
  const m = String((a && a.published_url) || '').match(/(\d{2})(\d{2})(\d{2})\D*\.pdf/i);
  if (m) { const t = Date.UTC(2000 + (+m[3]), (+m[2]) - 1, +m[1], 12); if (!isNaN(t)) return t; }
  return Date.now();
}

// Renvoie [{ articleid, title, pdfUrl, ts, content, summary, subcategory }] (best-effort, jamais d'exception).
async function fetchDanskeResearch() {
  if (_cache && Date.now() - _cacheTs < TTL && _cache.length) return _cache;
  if (_busy) return _cache || [];
  _busy = true;
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: _chrome(), headless: true,
      userDataDir: path.join(__dirname, '..', '.chrome_profile_danske'),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage',
        '--no-first-run', '--no-default-browser-check', '--single-process', '--no-zygote', '--disable-gpu', '--disable-extensions',
        '--disable-background-networking', '--disable-default-apps', '--disable-sync', '--mute-audio',
        '--blink-settings=imagesEnabled=false', '--js-flags=--max-old-space-size=192'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    // La SPA émet PLUSIEURS appels de liste (highlights, latest-research, top-articles, par sous-catégorie) :
    // on AGRÈGE TOUS les articles interceptés (dédup par articleid) → couverture maximale des derniers rapports.
    const byId = new Map();
    page.on('response', async (res) => {
      try {
        if (res.url().indexOf('api5.danskebank.com') < 0) return;
        const txt = await res.text();
        const j = JSON.parse(txt);
        const arr = Array.isArray(j) ? j : (j.articles || j.data || []);
        if (arr.length && arr[0] && arr[0].published_url !== undefined) {
          for (const a of arr) { const k = (a && (a.articleid || a.published_url)); if (k && !byId.has(k)) byId.set(k, a); }
        }
      } catch {}
    });
    await page.goto('https://research.danskebank.com/research/', { waitUntil: 'networkidle2', timeout: 45_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 6000));
    try { await page.close(); } catch {}
    const best = [...byId.values()];
    if (!best.length) { console.warn('[Danske] aucune liste interceptée (SPA bloquée ?)'); return _cache || []; }

    const items = [], seen = new Set();
    for (const a of best) {
      if (!a || !a.published_url || !/\.pdf(\?|$)/i.test(a.published_url)) continue;   // ignore webinaires/sans PDF
      const pdf = String(a.published_url).replace(/ /g, '%20');                         // espaces → %20 (proxy OK)
      if (seen.has(pdf)) continue; seen.add(pdf);
      const cat   = (a.categoryInfo && a.categoryInfo[0]) || {};
      const title = String(a.title || '').replace(/\s+-\s+/, ' | ').replace(/\s+/g, ' ').trim();   // « X - Y » → « X | Y » (façon PMT)
      if (!title) continue;
      items.push({
        articleid: a.articleid || '', title, pdfUrl: pdf, ts: _date(a),
        content: _strip(a.mobile_text || a.summary || ''), summary: _strip(a.summary || ''),
        subcategory: cat.subcategory || cat.SubCategory || '',
      });
    }
    if (items.length) { _cache = items; _cacheTs = Date.now(); console.log(`[Danske] ${items.length} rapports (PDF natifs) interceptés`); }
    return _cache || items;
  } catch (e) {
    console.error('[Danske]', e.message);
    return _cache || [];
  } finally {
    _busy = false;
    if (browser) { try { await browser.close(); } catch {} }
  }
}

module.exports = { fetchDanskeResearch };

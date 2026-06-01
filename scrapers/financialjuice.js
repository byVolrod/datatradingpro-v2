/**
 * FinancialJuice scraper
 *
 * Primary:  Centrifugo WebSocket (real-time push)
 * Fallback: HTTP polling of the FJ news page every 60 s
 *
 * Flow:
 *  1. Login via ASP.NET form → .ASPXAUTH cookie
 *  2. Get JWT from /widgets/centrifugo-token.ashx
 *  3. Try WebSocket — if blocked (503), fall back to HTTP scrape
 *  4. scrapeFinancialJuice() called every 60 s:
 *       - drains WS buffer (if connected)
 *       - OR fetches fresh items via HTTP (if WS is down)
 */

const axios     = require('axios');
const cheerio   = require('cheerio');
const WebSocket = require('ws');
const path      = require('path');
const puppeteer = require('puppeteer-extra');
const Stealth   = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

// Détecte le chemin Chrome/Chromium selon l'environnement (Windows local, Linux cloud…)
function _resolveChromeExec() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.env.CHROME_EXEC)               return process.env.CHROME_EXEC;
  if (process.platform === 'win32')  return 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  // Linux (Railway nixpacks, Render, Fly.io, Debian…)
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

const CHROME_PATH = _resolveChromeExec();
const FJ_PROFILE  = path.join(__dirname, '..', '.chrome_profile_fj');

const FJ_EMAIL  = process.env.FJ_EMAIL  || 'volrod.dev@gmail.com';
const FJ_PASS   = process.env.FJ_PASS   || '123123Pp';
const HOME_URL  = 'https://www.financialjuice.com/home';
const TOKEN_URL = 'https://www.financialjuice.com/widgets/centrifugo-token.ashx';
const WS_URL    = 'wss://rt.financialjuice.com/connection/websocket';
const UA        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

let _cookies      = {};
let _ws           = null;
let _msgId        = 0;
let _buffer       = [];
let _timer        = null;
let _initialized  = false;
let _pushCallback = null;
let _wsUp         = false;      // true when WS is open & confirmed
let _authDone     = false;      // true once first authenticate() completed
let _seenHttp     = new Set();  // deduplicate HTTP-polled items
let _rawLogCount  = 0;          // log raw field names for first few items
let _wsRetryCount = 0;          // consecutive WS failures — drives exponential backoff
let _pagePollingTimer = null;   // setInterval handle for in-page news polling

// ─── Minimal cookie jar ───────────────────────────────────────────────────────

function parseCookies(raw) {
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  arr.forEach(h => {
    const [pair] = h.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) _cookies[pair.substring(0, eq).trim()] = pair.substring(eq + 1).trim();
  });
}

function cookieStr() {
  return Object.entries(_cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ─── Authentication ───────────────────────────────────────────────────────────

async function authenticate() {
  _cookies = {};

  const r1 = await axios.get(HOME_URL, {
    headers: { 'User-Agent': UA },
    timeout: 12000,
    maxRedirects: 3,
    validateStatus: () => true,
  });
  console.log(`[FJ auth] GET home → ${r1.status}`);
  if (r1.status !== 200) throw new Error(`Home page returned ${r1.status}`);
  parseCookies(r1.headers['set-cookie']);

  const $ = cheerio.load(r1.data);
  const viewstate   = $('#__VIEWSTATE').val() || '';
  const vsgenerator = $('#__VIEWSTATEGENERATOR').val() || '';

  const form = new URLSearchParams();
  form.append('__VIEWSTATE', viewstate);
  form.append('__VIEWSTATEGENERATOR', vsgenerator);
  form.append('__EVENTTARGET', 'ctl00$SignInSignUp$loginForm1$btnLogin');
  form.append('__EVENTARGUMENT', '');
  form.append('ctl00$SignInSignUp$loginForm1$inputEmail', FJ_EMAIL);
  form.append('ctl00$SignInSignUp$loginForm1$inputPassword', FJ_PASS);
  form.append('ctl00$SignInSignUp$loginForm1$btnLogin', 'Login');

  const r2 = await axios.post(HOME_URL, form.toString(), {
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieStr(),
      'Referer': HOME_URL,
      'Origin': 'https://www.financialjuice.com',
    },
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: 15000,
  });
  console.log(`[FJ auth] POST login → ${r2.status}`);
  parseCookies(r2.headers['set-cookie']);

  if (!_cookies['.ASPXAUTH']) throw new Error('Login failed — no auth cookie');
  _authDone = true;
  _seenHttp.clear();
  console.log('[FinancialJuice] Logged in');
}

// ─── Token retrieval ──────────────────────────────────────────────────────────

async function getToken() {
  // Try plain HTTP first (fast path)
  const r = await axios.get(TOKEN_URL, {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr(), 'Referer': HOME_URL },
    timeout: 10000,
    validateStatus: () => true,
  });
  if (r.status === 200) {
    const token = r.data?.token || r.data;
    if (token && typeof token === 'string') {
      console.log('[FJ token] obtained via HTTP');
      return token;
    }
  }
  // Cloudflare challenge — fall back to real browser
  console.log(`[FJ token] HTTP blocked (${r.status}) — trying browser`);
  return getTokenViaBrowser();
}

let _fjBrowser = null;

async function getFJBrowser() {
  if (_fjBrowser) {
    try { await _fjBrowser.pages(); return _fjBrowser; } catch { _fjBrowser = null; }
  }
  _fjBrowser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: FJ_PROFILE,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });
  _fjBrowser.on('disconnected', () => { _fjBrowser = null; });
  console.log('[FJ browser] launched');
  return _fjBrowser;
}

async function getTokenViaBrowser() {
  const browser = await getFJBrowser();
  const page    = await browser.newPage();
  try {
    await page.setUserAgent(UA);

    // Inject any cookies we already have (ASPXAUTH etc.)
    if (Object.keys(_cookies).length) {
      const domain = 'www.financialjuice.com';
      for (const [name, value] of Object.entries(_cookies)) {
        await page.setCookie({ name, value, domain, path: '/' }).catch(() => {});
      }
    }

    // Navigate to token endpoint — stealth handles CF challenge automatically
    await page.goto(TOKEN_URL, { waitUntil: 'networkidle2', timeout: 30_000 });

    // If still on CF challenge page, wait up to 15s for resolution
    for (let i = 0; i < 15; i++) {
      const title = await page.title();
      if (!/just a moment/i.test(title)) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    // Check if we landed on the login page instead
    const url = page.url();
    if (url.includes('/home') || url.includes('/login')) {
      console.log('[FJ browser] Not logged in — performing login');
      await page.waitForSelector('input[name*="inputEmail"]', { timeout: 10_000 });
      await page.type('input[name*="inputEmail"]', FJ_EMAIL, { delay: 30 });
      await page.type('input[name*="inputPassword"]', FJ_PASS, { delay: 30 });
      await Promise.all([
        page.waitForNavigation({ timeout: 15_000 }),
        page.click('input[name*="btnLogin"], button[type="submit"]'),
      ]);
      // Now go to token URL
      await page.goto(TOKEN_URL, { waitUntil: 'networkidle2', timeout: 20_000 });
    }

    // Extract token from page body
    const body = await page.evaluate(() => document.body.innerText || document.body.textContent || '');
    let token;
    try { token = JSON.parse(body)?.token || JSON.parse(body); } catch { token = body.trim(); }
    if (!token || typeof token !== 'string' || token.length < 20) {
      throw new Error(`Browser token response invalid: ${body.substring(0, 100)}`);
    }

    // Sync browser cookies back to _cookies for WS connection
    const browserCookies = await page.cookies('https://www.financialjuice.com');
    for (const c of browserCookies) _cookies[c.name] = c.value;

    console.log('[FJ browser] token obtained');
    return token;
  } finally {
    await page.close();
  }
}

// ─── Economic data agency detection ──────────────────────────────────────────

const ECON_AGENCIES = [
  [/\bpmi\b|purchasing managers|markit/i,                              'S&P Global'],
  [/\bism\b/i,                                                          'ISM'],
  [/nfp|non.?farm payroll|initial claims|continuing claims|challenger|jobless claims/i, 'BLS'],
  [/\bpce\b|personal income|personal spending|unit labor|labor cost/i, 'BEA'],
  [/\bifo\b/i,                                                          'IFO Institute'],
  [/\bzew\b/i,                                                          'ZEW'],
  [/\bdestatis\b|german.*cpi|cpi.*german|german.*retail|retail.*german/i, 'Destatis'],
  [/eurozone|euro.?area|european.*cpi|cpi.*european|eurostat/i,        'Eurostat'],
  [/\buk\b.*cpi|cpi.*\buk\b|\buk\b.*gdp|gdp.*\buk\b|\buk\b.*retail|\brpi\b/i, 'ONS'],
  [/australia.*cpi|cpi.*australia|australia.*trade|aus.*gdp/i,         'ABS'],
  [/canada.*cpi|cpi.*canada|canada.*gdp|canadian.*retail/i,            'Statistics Canada'],
  [/japan.*cpi|japan.*gdp|japan.*pmi|tankan/i,                         'Statistics Japan'],
  [/china.*pmi|china.*cpi|china.*gdp|\bnbs\b/i,                        'NBS China'],
  [/swiss.*cpi|cpi.*swiss|swiss.*gdp|switzerland.*unemployment/i,      'Statistics CH'],
  [/\bnfib\b/i,                                                         'NFIB'],
  [/case.shiller|house price|home price|existing home|pending home|housing starts/i, 'NAR / Census'],
  [/consumer confidence|consumer sentiment/i,                           'Conference Board'],
  [/\bcboe\b|\bvix\b/i,                                                 'CBOE'],
];

function detectEconAgency(text) {
  for (const [rx, agency] of ECON_AGENCIES) {
    if (rx.test(text)) return agency;
  }
  return null;
}

// ─── Category detection ───────────────────────────────────────────────────────

function detectCategory(text) {
  const t = (text || '').toLowerCase();
  if (/\bfed\b|federal reserve|fomc|powell/.test(t))                          return 'Fed';
  if (/\becb\b|lagarde|european central bank/.test(t))                         return 'ECB';
  if (/\bboj\b|bank of japan|ueda/.test(t))                                    return 'BoJ';
  if (/\bboe\b|bank of england|bailey/.test(t))                                return 'BoE';
  if (/\bboc\b|bank of canada|macklem/.test(t))                                return 'BoC';
  if (/\brba\b|reserve bank of australia/.test(t))                             return 'RBA';
  if (/\bsnb\b|swiss national bank/.test(t))                                   return 'SNB';
  if (/\brbnz\b|reserve bank of new zealand/.test(t))                          return 'RBNZ';
  if (/oil|energy|gas\b|opec|brent|wti|crude|petroleum/.test(t))              return 'Energy & Power';
  if (/\bgold\b|silver|copper|nickel|metal|platinum|palladium/.test(t))        return 'Metals';
  if (/bitcoin|crypto|ethereum|\bbtc\b|\beth\b|blockchain|defi/.test(t))       return 'Crypto';
  if (/war|conflict|geopolit|russia|ukraine|iran|israel|china|taiwan|nato|missile/.test(t)) return 'Geopolitical';
  // FJ-style prefix "EU Data: Eurozone CPI..." — checked before generic catch-all
  if (/^eu\s+data\b/.test(t))                                            return 'EU Data';
  if (/^us\s+data\b/.test(t))                                            return 'US Data';
  if (/^uk\s+data\b/.test(t))                                            return 'UK Data';
  if (/^swiss\s+data\b/.test(t))                                         return 'Swiss Data';
  if (/^japa(?:n|nese)\s+data\b/.test(t))                               return 'Japanese Data';
  if (/^canad(?:a|ian)\s+data\b/.test(t))                               return 'Canadian Data';
  if (/^austral(?:ia|ian)\s+data\b/.test(t))                            return 'Australian Data';
  if (/^chin(?:a|ese)\s+data\b/.test(t))                                return 'Chinese Data';
  if (/^(?:german|french|italian|spanish)\s+data\b/.test(t))            return 'EU Data';
  // Regional data by content keywords (fallback)
  if (/\bgdp\b|inflation|\bcpi\b|\bppi\b|\bpmi\b|\bnfp\b|payroll|unemployment|retail sales|industrial prod/.test(t)) {
    if (/eurozone|euro.?area|eurostat/.test(t))                          return 'EU Data';
    if (/(?:swiss|switzerland).*(?:cpi|gdp|pmi)/.test(t))               return 'Swiss Data';
    if (/\buk\b.*(?:cpi|gdp|pmi)|brit(?:ain|ish).*(?:cpi|gdp)/.test(t)) return 'UK Data';
    if (/japan.*(?:cpi|gdp|pmi|tankan)|japanese.*(?:cpi|gdp)/.test(t))  return 'Japanese Data';
    if (/canad.*(?:cpi|gdp|pmi|employment)/.test(t))                    return 'Canadian Data';
    if (/austral.*(?:cpi|gdp|pmi|employment)/.test(t))                  return 'Australian Data';
    if (/\bchina\b.*(?:cpi|gdp|pmi)|chinese.*(?:cpi|gdp)/.test(t))     return 'Chinese Data';
  }
  if (/gdp|inflation|cpi|ppi|\bpmi\b|nfp|unemployment|payroll|consumer price/.test(t))     return 'Economic Commentary';
  if (/\busd\b|\beur\b|\bgbp\b|\bjpy\b|\bchf\b|forex|currency|fx |exchange rate/.test(t)) return 'FX Flows';
  if (/nasdaq|s&p|dow|dax|cac|ftse|equity|equities|stock market/.test(t))     return 'Market Analysis';
  if (/bond yield|treasury yield|gilt|bund|fixed income|sovereign debt/.test(t)) return 'Fixed Income';
  if (/\btrade\b|tariff|export|import|wto|supply chain/.test(t))               return 'Trade';
  return 'Global News';
}

// ─── Paris time helper (bypasses ICU / timezone parsing issues) ───────────────

function toParisTimeStr(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  // Last Sunday of March at 01:00 UTC → CEST begins
  const mar31     = new Date(Date.UTC(y, 2, 31));
  const cestStart = Date.UTC(y, 2, 31 - mar31.getUTCDay()) + 3600000;
  // Last Sunday of October at 01:00 UTC → CET resumes
  const oct31    = new Date(Date.UTC(y, 9, 31));
  const cetStart = Date.UTC(y, 9, 31 - oct31.getUTCDay()) + 3600000;
  const offset   = (ts >= cestStart && ts < cetStart) ? 2 : 1;
  const local    = new Date(ts + offset * 3600000);
  return String(local.getUTCHours()).padStart(2, '0') + ':' + String(local.getUTCMinutes()).padStart(2, '0');
}

// Force UTC interpretation for ISO strings that lack a timezone marker
function parseRawTs(rawTs) {
  if (!rawTs) return NaN;
  if (typeof rawTs === 'number') return rawTs;
  const s = String(rawTs).trim();
  // ISO datetime without timezone → append Z so it's always read as UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = new Date(s + 'Z').getTime();
    console.log(`[FJ ts] forced UTC: "${s}" → ${toParisTimeStr(t)} Paris`);
    return t;
  }
  return new Date(s).getTime();
}

// ─── Item normalizer ──────────────────────────────────────────────────────────

function normalizeItem(data) {
  const text = data.Text || data.text || data.Title || data.title || data.headline || data.content || data.description || '';
  if (!text || text.length < 10) return null;

  const rawTs = data.DatePublished || data.Time || data.time || data.pubDate || data.timestamp || data.date || data.PublishDate || data.PublishedDate;
  const ts    = parseRawTs(rawTs);
  const tsOk  = isNaN(ts) ? Date.now() : ts;

  const category   = detectCategory(text);
  const idSrc      = data.NewsID || data.ID || data.Id || data.id || data.headlineid || Buffer.from(text).toString('base64').substring(0, 12);
  const econAgency = category === 'Economic Commentary' ? detectEconAgency(text) : null;

  // Log raw field names for the first few items to discover FJ's data format
  if (_rawLogCount < 4) {
    console.log(`[FJ raw fields] ${Object.keys(data).join(', ')}`);
    _rawLogCount++;
  }

  // Extract full article body when available (WS push or HTML scrape may include it)
  const bodyRaw = data.Body       || data.body       ||
                  data.FullText   || data.fullText   ||
                  data.Post       || data.post       ||
                  data.Message    || data.message    ||
                  data.Summary    || data.summary    ||
                  data.ArticleBody|| data.articleBody||
                  data.BodyText   || data.bodyText   || '';
  const bodyClean = typeof bodyRaw === 'string' ? bodyRaw.replace(/\s+/g, ' ').trim() : '';
  // Only set description when it's different from the headline and has real content
  const description = bodyClean && bodyClean !== text.trim() && bodyClean.length > 20
                      ? bodyClean.substring(0, 1500)
                      : undefined;

  // ── URGENCE : strictement basée sur les flags bruts de FinancialJuice ────────
  // Le rouge est réservé aux news que FJ marque elle-même comme urgentes/rouges.
  // Aucune décision basée sur le texte ou la catégorie ici.
  const isUrgentBool = !!(data.IsUrgent || data.IsBreaking || data.isUrgent || data.isBreaking ||
                           data.Urgent   || data.Breaking   || data.urgent   || data.breaking   ||
                           data.IsPriority || data.isPriority || data.IsAlert || data.isAlert   ||
                           data.IsHot || data.isHot || data.IsBold || data.isBold);
  const rawColor = String(data.Color || data.color || data.Background || data.background ||
                          data.Theme  || data.theme  || data.Urgency   || data.urgency   ||
                          data.Type   || data.type   || data.ColorClass || data.colorClass || '');
  // FJ utilise la couleur rouge (#c..#e..) pour les news importantes
  const isUrgentColor = /\b(red|urgent|breaking|critical|danger|alert)\b/i.test(rawColor) ||
                        /^#[cde][0-9a-f]{5}$/i.test(rawColor);
  // FJ Level field : Level=1 = rouge/important sur leur site
  const isUrgentLevel = +data.Level === 1 || +data.level === 1;
  // urgent = UNIQUEMENT si FJ l'a explicitement marqué (pas de heuristique texte/catégorie)
  const urgent = isUrgentBool || isUrgentColor || isUrgentLevel;

  return {
    id:          `fj-${idSrc}`,
    time:        toParisTimeStr(tsOk),
    timestamp:   tsOk,
    category,
    source:      econAgency || 'FinancialJuice',
    headline:    text.replace(/\s+/g, ' ').trim().substring(0, 250),
    ...(description ? { description } : {}),
    tags:        [category],
    // high seulement si CB majeure OU explicitement urgent côté FJ
    priority:    (['Fed', 'ECB'].includes(category) || urgent) ? 'high' : 'normal',
    urgent,
  };
}

// ─── HTTP news fallback ───────────────────────────────────────────────────────

// Candidate endpoints tried in order; first one that returns items wins
const HTTP_CANDIDATES = [
  // JSON API patterns (tried first — cheapest parse)
  { url: 'https://www.financialjuice.com/api/headlines',               type: 'json' },
  { url: 'https://www.financialjuice.com/api/news',                    type: 'json' },
  { url: 'https://www.financialjuice.com/widgets/headlines.ashx',      type: 'json' },
  { url: 'https://www.financialjuice.com/widgets/get-headlines.ashx',  type: 'json' },
  // RSS feed (XML parsed via cheerio)
  { url: 'https://www.financialjuice.com/rss',                         type: 'rss'  },
  { url: 'https://www.financialjuice.com/feed',                        type: 'rss'  },
  // Authenticated homepage HTML — last resort
  { url: HOME_URL,                                                      type: 'html' },
];

let _workingHttpUrl = null;  // cache the first URL that worked

async function fetchNewsViaHttp() {
  const headers = {
    'User-Agent':  UA,
    'Cookie':      cookieStr(),
    'Referer':     HOME_URL,
    'Accept':      'application/json, application/xml, text/html, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const candidates = _workingHttpUrl
    ? [{ url: _workingHttpUrl, type: 'auto' }, ...HTTP_CANDIDATES.filter(c => c.url !== _workingHttpUrl)]
    : HTTP_CANDIDATES;

  for (const { url, type } of candidates) {
    try {
      const r = await axios.get(url, { headers, timeout: 12000 });
      const ct = (r.headers['content-type'] || '').toLowerCase();
      const bodySnip = typeof r.data === 'string' ? r.data.substring(0, 300).replace(/\s+/g, ' ') : JSON.stringify(r.data).substring(0, 200);
      console.log(`[FJ HTTP] ${url} → ${r.status} ${ct.split(';')[0]} | ${bodySnip}`);
      const resolvedType = type === 'auto'
        ? (ct.includes('json') ? 'json' : ct.includes('xml') ? 'rss' : 'html')
        : type;

      let items = [];

      if (resolvedType === 'json') {
        const raw = Array.isArray(r.data) ? r.data
                  : Array.isArray(r.data?.items)     ? r.data.items
                  : Array.isArray(r.data?.headlines) ? r.data.headlines
                  : Array.isArray(r.data?.data)      ? r.data.data
                  : null;
        if (raw) items = raw.map(normalizeItem).filter(Boolean);
      }

      if (resolvedType === 'rss') {
        const $ = cheerio.load(r.data, { xmlMode: true });
        $('item').each((_, el) => {
          const title   = $(el).find('title').text().trim();
          const desc    = $(el).find('description').text().trim();
          const pubDate = $(el).find('pubDate').text().trim();
          const text    = title || desc;
          // Pass desc as Body so normalizeItem populates description when it differs from title
          if (text) items.push(normalizeItem({ Text: text, Body: (desc && desc !== text) ? desc : '', pubDate }));
        });
        items = items.filter(Boolean);
      }

      if (resolvedType === 'html' && typeof r.data === 'string') {
        const $ = cheerio.load(r.data);
        const seen = new Set();
        const selectors = [
          '.news-item-text', '.headline-text', '.newsitem-content',
          '[class*="headline"]', '[class*="news-item"]', '[class*="feed-item"]',
          '[class*="ticker"]', '.item-text', 'li.news p', '.newstext',
        ];
        $(selectors.join(', ')).each((_, el) => {
          const text = $(el).text().replace(/\s+/g, ' ').trim();
          if (text.length >= 20 && text.length <= 400 && !seen.has(text)) {
            seen.add(text);
            const item = normalizeItem({ Text: text });
            if (item) items.push(item);
          }
        });
      }

      if (items.length >= 2) {
        if (_workingHttpUrl !== url) {
          console.log(`[FJ HTTP] Working endpoint found: ${url} (${items.length} items)`);
          _workingHttpUrl = url;
        }
        // Filter items we've already seen in previous polls
        const fresh = items.filter(it => !_seenHttp.has(it.id));
        fresh.forEach(it => _seenHttp.add(it.id));
        // Trim cache to prevent unbounded growth
        if (_seenHttp.size > 2000) {
          const arr = [..._seenHttp];
          _seenHttp = new Set(arr.slice(arr.length - 1000));
        }
        return fresh;
      }
    } catch {
      // try next candidate
    }
  }

  console.warn('[FJ HTTP] All endpoints exhausted — no items');
  return [];
}

// ─── Decode JWT payload to discover subscribed channels ──────────────────────

function getTokenChannels(token) {
  try {
    const payload = token.split('.')[1];
    const padded  = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = JSON.parse(Buffer.from(padded, 'base64url').toString('utf8'));
    const chans   = Object.keys(decoded.subs || decoded.channels || {});
    return chans.length ? chans : null;
  } catch {
    return null;
  }
}

// ─── Centrifugo WebSocket ─────────────────────────────────────────────────────

function ingestRawData(rawData, label) {
  if (!rawData) return;
  if (Array.isArray(rawData)) {
    for (const d of rawData) ingestRawData(d, label);
    return;
  }
  if (typeof rawData !== 'object') return;

  // FJ envelope: { ev: "sendUpdates"|"sendHeadlineUpdated", msg: "[{...}]" }
  if (rawData.ev && typeof rawData.msg === 'string') {
    try {
      const parsed = JSON.parse(rawData.msg);
      if (Array.isArray(parsed)) {
        for (const d of parsed) ingestRawData(d, label);
      } else if (parsed && typeof parsed === 'object') {
        ingestRawData(parsed, label);
      }
    } catch (e) {
      console.error('[FJ ingest] msg parse error:', e.message, rawData.msg.substring(0, 80));
    }
    return;
  }

  const item = normalizeItem(rawData);
  if (!item) return;
  if (_seenHttp.has(item.id)) return;
  _seenHttp.add(item.id);
  _buffer.push(item);
  console.log(`[FJ ${label}] ${item.headline.substring(0, 70)}`);
  if (label === 'LIVE' && _pushCallback) try { _pushCallback(item); } catch {}
}

function handleCentrifugoMsg(msg) {
  // ── Centrifugo ping — must reply with empty pong ──────────────────────────
  if (Object.keys(msg).length === 0) {
    if (_ws?.readyState === 1) _ws.send('{}');
    return;
  }

  // ── Connect confirmation ──────────────────────────────────────────────────
  if (msg.connect) {
    const ttl   = msg.connect.ttl || 3600;
    const delay = Math.max((ttl - 120) * 1000, 300_000);
    _timer = setTimeout(doRefreshToken, delay);
    console.log(`[FinancialJuice] Connected v${msg.connect.version} — TTL ${ttl}s`);
    const autoSubs = Object.keys(msg.connect.subs || {});
    console.log('[FJ] Auto-subscribed:', autoSubs.join(', ') || '(none)');
    // Explicit subscription belt-and-suspenders
    setTimeout(() => {
      if (_ws?.readyState === 1) {
        _ws.send(JSON.stringify({ id: ++_msgId, subscribe: { channel: 'feed:all' } }));
        _ws.send(JSON.stringify({ id: ++_msgId, subscribe: { channel: 'feed:lite' } }));
        console.log('[FJ] Sent explicit subscribe: feed:all, feed:lite');
      }
    }, 800);
    return;
  }

  // ── Log errors explicitly ─────────────────────────────────────────────────
  if (msg.error) {
    console.error('[FJ error]', JSON.stringify(msg.error));
    return;
  }

  // ── Subscribe confirmation ────────────────────────────────────────────────
  if (msg.id && msg.result !== undefined) {
    if (msg.result?.recoverable !== undefined || msg.result?.seq !== undefined || msg.result?.epoch !== undefined) {
      console.log(`[FJ sub confirmed] id=${msg.id}`);
    }
    return;
  }

  // ── Real-time push ────────────────────────────────────────────────────────
  if (msg.push) {
    const ch      = msg.push.channel || '?';
    const rawData = msg.push?.pub?.data || msg.push?.data;
    if (rawData) {
      console.log(`[FJ push] ch=${ch} data=${JSON.stringify(rawData).substring(0, 120)}`);
      ingestRawData(rawData, 'LIVE');
    } else {
      console.log('[FJ push] no data path:', JSON.stringify(msg.push).substring(0, 200));
    }
    return;
  }

  // ── Catch-all ─────────────────────────────────────────────────────────────
  console.log('[FJ msg] unhandled:', JSON.stringify(msg).substring(0, 120));
}

let _lastToken   = '';
let _wsFailCount = 0;
let _fjWsPage    = null;  // Puppeteer page kept open for browser-based WS relay

// ─── Direct Node.js WebSocket ─────────────────────────────────────────────────

function connectCentrifugo(token) {
  _lastToken = token;
  if (_ws) { try { _ws.terminate(); } catch {} _ws = null; }
  clearTimeout(_timer);
  _msgId = 0;
  _wsUp  = false;

  _ws = new WebSocket(WS_URL, {
    headers: {
      'Origin':          'https://www.financialjuice.com',
      'Cookie':          cookieStr(),
      'User-Agent':      UA,
      'Referer':         HOME_URL,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  _ws.on('open', () => {
    _wsUp      = true;
    _wsFailCount = 0;
    _ws.send(JSON.stringify({ id: ++_msgId, connect: { token, name: 'js', version: '0.0.1' } }));
    console.log('[FinancialJuice] WS open — sending connect');
  });

  _ws.on('message', (rawFrame) => {
    const text = Buffer.isBuffer(rawFrame) ? rawFrame.toString('utf8') : rawFrame.toString();
    console.log('[FJ ws-raw]', text.substring(0, 200));
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { handleCentrifugoMsg(JSON.parse(trimmed)); }
      catch (e) { console.error('[FJ msg parse]', e.message, trimmed.substring(0, 80)); }
    }
  });

  _ws.on('error', err => console.error('[FJ WS]', err.message));

  _ws.on('close', code => {
    _wsUp = false;
    _wsFailCount++;
    clearTimeout(_timer);

    // After any failure switch to browser intercept (handles CF + connection limits)
    console.log(`[FJ] WS closed (${code}) — switching to browser intercept in 5s`);
    _timer = setTimeout(() => connectCentrifugoViaBrowser().catch(e => {
      console.error('[FJ browser] setup failed:', e.message);
      _timer = setTimeout(doReconnect, 120_000);
    }), 5_000);
  });
}

// ─── Browser-based WS relay — intercept FJ's own connection ──────────────────
//
// Instead of creating a new WS (which would exceed connection limits),
// we intercept the WS that FJ's own JavaScript creates after page load.
// This piggybacks on their existing session — zero extra connections.

async function connectCentrifugoViaBrowser() {
  _wsUp = false;

  const browser = await getFJBrowser();

  if (_fjWsPage) { try { await _fjWsPage.close(); } catch {} _fjWsPage = null; }
  _fjWsPage = await browser.newPage();

  // Expose relay callbacks to the page
  await _fjWsPage.exposeFunction('_fjRelay', (rawData) => {
    if (rawData) ingestRawData(rawData, 'LIVE');
  });
  await _fjWsPage.exposeFunction('_fjHistRelay', (pubs) => {
    if (Array.isArray(pubs) && pubs.length > 0) {
      console.log(`[FJ history] ${pubs.length} items`);
      for (const pub of pubs) ingestRawData(pub.data, 'hist');
    }
  });
  await _fjWsPage.exposeFunction('_fjConnected', (version, ttl) => {
    _wsUp         = true;
    _wsFailCount  = 0;
    _wsRetryCount = 0;
    console.log(`[FJ browser] intercepted WS v${version} TTL=${ttl}s`);
    clearTimeout(_timer);
    _timer = setTimeout(doRefreshToken, Math.max((ttl - 120) * 1000, 300_000));
  });
  await _fjWsPage.exposeFunction('_fjClosed', (code) => {
    _wsUp = false;
    _wsRetryCount++;
    // Exponential backoff: 30 s → 60 s → 120 s → 240 s → 300 s max
    const backoff = code === 3012
      ? 180_000
      : Math.min(30_000 * Math.pow(2, Math.min(_wsRetryCount - 1, 3)), 300_000);
    console.log(`[FJ browser] WS closed (${code}) — retry in ${backoff / 1000}s (attempt #${_wsRetryCount})`);
    clearTimeout(_timer);
    _timer = setTimeout(doReconnectBrowser, backoff);
  });

  // Relay news items fetched from in-page API calls back to Node
  await _fjWsPage.exposeFunction('_fjPageNewsRelay', (items) => {
    if (!Array.isArray(items) || items.length === 0) return;
    let count = 0;
    for (const raw of items) {
      const item = normalizeItem(raw);
      if (!item || _seenHttp.has(item.id)) continue;
      _seenHttp.add(item.id);
      _buffer.push(item);
      if (_pushCallback) try { _pushCallback(item); } catch {}
      count++;
    }
    if (count > 0) console.log(`[FJ page-poll] +${count} new items via in-page API`);
  });

  await _fjWsPage.setUserAgent(UA);

  // Inject auth cookies so FJ's app loads as logged-in user
  if (Object.keys(_cookies).length) {
    const cookieList = Object.entries(_cookies).map(([name, value]) => ({
      name, value, domain: 'www.financialjuice.com', path: '/', httpOnly: false, secure: true,
    }));
    for (const c of cookieList) await _fjWsPage.setCookie(c).catch(() => {});
  }

  // Intercept WebSocket BEFORE FJ's JS runs — hook into their WS instance
  await _fjWsPage.evaluateOnNewDocument(() => {
    const _NWS = window.WebSocket;
    window.WebSocket = function(url, ...args) {
      const ws = new _NWS(url, ...args);
      if (typeof url === 'string' && url.includes('rt.financialjuice')) {
        // Tap into FJ's own WS — forward messages without creating a new connection
        console.log('[FJ-intercept] WS created for', url);
        ws.addEventListener('message', (e) => {
          const text = e.data;
          console.log('[FJ-intercept] msg:', text.substring(0, 120));
          for (const line of text.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            try {
              const msg = JSON.parse(t);
              if (msg.connect) {
                console.log('[FJ-intercept] connected, subs:', Object.keys(msg.connect.subs || {}).join(','));
                window._fjConnected(msg.connect.version || '?', msg.connect.ttl || 3600);
              }
              const rawData = msg.push?.pub?.data || msg.push?.data;
              if (rawData) {
                console.log('[FJ-intercept] push data:', JSON.stringify(rawData).substring(0, 100));
                window._fjRelay(rawData);
              }
            } catch {}
          }
        });
        ws.addEventListener('close', (e) => { console.log('[FJ-intercept] closed', e.code); window._fjClosed(e.code); });
      }
      return ws;
    };
    window.WebSocket.CONNECTING = 0;
    window.WebSocket.OPEN       = 1;
    window.WebSocket.CLOSING    = 2;
    window.WebSocket.CLOSED     = 3;
    window.WebSocket.prototype  = _NWS.prototype;
  });

  // Relay browser console to Node.js for debugging
  _fjWsPage.on('console', msg => {
    if (msg.text().startsWith('[FJ-intercept]')) console.log('[FJ page]', msg.text());
  });

  // Navigate — FJ's JS will naturally create the WS, which we now intercept
  console.log('[FJ browser] navigating to intercept FJ WS…');
  try {
    await _fjWsPage.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 45_000 });
    console.log('[FJ browser] page loaded — waiting for WS…');
  } catch (e) {
    console.log('[FJ browser] nav timeout (OK) — WS interceptor still active');
  }

  // Start in-page API polling so news flows even when WS is blocked
  clearInterval(_pagePollingTimer);
  const _activePage = _fjWsPage;
  setTimeout(() => pollPageForNews(_activePage), 4_000);   // first poll shortly after load
  _pagePollingTimer = setInterval(() => pollPageForNews(_activePage), 60_000);
  _activePage.once('close', () => clearInterval(_pagePollingTimer));
}

// ─── In-page news polling ──────────────────────────────────────────────────────
//
// Uses the browser's authenticated session to call FJ's internal API endpoints.
// This bypasses cookie/header mismatches that make axios calls fail.

async function pollPageForNews(page) {
  if (!page) return;
  try {
    const result = await page.evaluate(async () => {
      // ── 1. Try authenticated JSON API calls ────────────────────────────────
      const candidates = [
        '/widgets/get-headlines.ashx?count=50&format=json',
        '/widgets/get-headlines.ashx?pageIndex=1&pageSize=50',
        '/widgets/headlines.ashx?count=50',
        '/Home/GetHeadlines?count=50',
        '/api/headlines?count=50&format=json',
      ];
      for (const url of candidates) {
        try {
          const r = await fetch(url, { credentials: 'same-origin' });
          const ct = r.headers.get('content-type') || '';
          if (!ct.includes('json')) continue;
          const data = await r.json();
          const items = Array.isArray(data) ? data
            : (data?.items || data?.headlines || data?.data || data?.news || []);
          if (Array.isArray(items) && items.length > 0) {
            window._fjPageNewsRelay(items);
            return `api:${url}:${items.length}`;
          }
        } catch {}
      }

      // ── 2. DOM scrape — works because the browser fully renders the page ──
      const selectors = [
        '.headline-item', '.news-item', '.newsItem',
        '.news-item-text', '.headline-text', '.newsitem-content',
        '[class*="headline"]', '[class*="news-item"]', '[class*="feed-item"]',
        '[class*="ticker"]', '.item-text', 'li.news p', '.newstext',
      ];
      const seen = new Set();
      const domItems = [];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
          const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length >= 20 && text.length <= 400 && !seen.has(text)) {
            seen.add(text);
            domItems.push({ Text: text });
          }
        });
        if (domItems.length >= 5) break;
      }
      if (domItems.length > 0) {
        window._fjPageNewsRelay(domItems);
        return `dom:${domItems.length}`;
      }
      return 'none';
    });
    console.log(`[FJ page-poll] ${result}`);
  } catch {
    // Page was closed or navigated away — ignore
  }
}

async function doReconnectBrowser() {
  try {
    await connectCentrifugoViaBrowser();
  } catch (e) {
    console.error('[FJ browser] reconnect failed:', e.message, '— retry in 60s');
    _timer = setTimeout(doReconnectBrowser, 60_000);
  }
}

// ─── Token refresh & reconnect ────────────────────────────────────────────────

async function doRefreshToken() {
  try {
    const token = await getToken();
    _lastToken  = token;
    console.log('[FinancialJuice] Token refreshed');
    connectCentrifugo(token);
  } catch (err) {
    console.error('[FJ] Token refresh failed:', err.message, '— full re-auth');
    doReconnect();
  }
}

async function doReconnect() {
  try {
    if (!_cookies['.ASPXAUTH']) await authenticate();
    const token = await getToken();
    _lastToken = token;
    connectCentrifugo(token);  // try direct WS first; falls back to browser on close
  } catch (err) {
    console.error('[FJ] Reconnect failed:', err.message, '— retry in 60s');
    _timer = setTimeout(doReconnect, 60_000);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function initFinancialJuice() {
  if (_initialized) return;
  _initialized = true;
  try {
    await authenticate();
    const token = await getToken();
    connectCentrifugo(token);
  } catch (err) {
    console.error('[FinancialJuice] Init failed:', err.message, '— retry in 60s');
    _timer = setTimeout(doReconnect, 60_000);
  }
}

async function scrapeFinancialJuice() {
  // Drain real-time buffer
  const items = [..._buffer];
  _buffer = [];

  // HTTP fallback when WebSocket is down — only if auth already completed
  if (!_wsUp && _authDone) {
    try {
      const httpItems = await fetchNewsViaHttp();
      if (httpItems.length > 0) console.log(`[FJ HTTP] +${httpItems.length} items via fallback`);
      return [...items, ...httpItems];
    } catch (e) {
      console.error('[FJ HTTP fallback]', e.message);
    }
  }

  return items;
}

function setOnPushCallback(fn) { _pushCallback = fn; }

// ─── Historical backfill ──────────────────────────────────────────────────────

async function fetchCentrifugoHistory(channel) {
  if (!_ws || _ws.readyState !== 1) return [];
  return new Promise(resolve => {
    const reqId = ++_msgId;
    const out   = [];
    const timer = setTimeout(() => { _ws.removeListener('message', onMsg); resolve(out); }, 12000);

    function onMsg(raw) {
      try {
        const msg = JSON.parse(raw);
        if (msg.id !== reqId) return;
        clearTimeout(timer);
        _ws.removeListener('message', onMsg);
        for (const pub of (msg.result?.publications || [])) {
          const d = pub.data;
          if (!d) continue;
          if (d.ev && typeof d.msg === 'string') {
            try {
              const arr = JSON.parse(d.msg);
              for (const x of (Array.isArray(arr) ? arr : [arr])) {
                const item = normalizeItem(x);
                if (item) out.push(item);
              }
            } catch {}
          } else {
            const item = normalizeItem(d);
            if (item) out.push(item);
          }
        }
        resolve(out);
      } catch {}
    }
    _ws.on('message', onMsg);
    _ws.send(JSON.stringify({ id: reqId, history: { channel, limit: 5000, reverse: false } }));
  });
}

async function fetchPaginatedHistory(cutoff) {
  const headers = { 'User-Agent': UA, 'Cookie': cookieStr(), 'Referer': HOME_URL, 'Accept': 'application/json, */*' };

  const PAGE_FNS = [
    p => `https://www.financialjuice.com/api/headlines?pageIndex=${p}&pageSize=50`,
    p => `https://www.financialjuice.com/widgets/get-headlines.ashx?pageIndex=${p}&pageSize=50`,
    p => `https://www.financialjuice.com/api/news?page=${p}&count=50`,
    p => `https://www.financialjuice.com/widgets/get-headlines.ashx?page=${p}&count=50`,
  ];

  for (const urlFn of PAGE_FNS) {
    try {
      const r1 = await axios.get(urlFn(1), { headers, timeout: 8000, validateStatus: () => true });
      if (r1.status !== 200) continue;
      const raw1 = Array.isArray(r1.data) ? r1.data : r1.data?.items || r1.data?.headlines || r1.data?.data;
      if (!Array.isArray(raw1) || raw1.length === 0) continue;

      console.log(`[FJ Backfill] Paginated endpoint: ${urlFn(1)} — ${raw1.length} items/page`);
      const out = [];
      const process = arr => arr.forEach(d => { const i = normalizeItem(d); if (i) out.push(i); });
      process(raw1);

      for (let p = 2; p <= 25; p++) {
        const r = await axios.get(urlFn(p), { headers, timeout: 8000, validateStatus: () => true });
        const raw = Array.isArray(r.data) ? r.data : r.data?.items || r.data?.headlines || r.data?.data;
        if (!Array.isArray(raw) || raw.length === 0) break;
        process(raw);
        // Stop when all items in batch are older than cutoff
        const batchMin = Math.min(...raw.map(d => {
          const t = parseRawTs(d.DatePublished || d.Time || d.pubDate || d.date || '');
          return isNaN(t) ? Date.now() : t;
        }));
        if (batchMin < cutoff) break;
        await new Promise(r => setTimeout(r, 150));
      }
      return out;
    } catch {}
  }
  return [];
}

function ingestToMap(rawData, map, cutoff) {
  if (!rawData) return;
  if (Array.isArray(rawData)) { rawData.forEach(d => ingestToMap(d, map, cutoff)); return; }
  if (typeof rawData !== 'object') return;
  if (rawData.ev && typeof rawData.msg === 'string') {
    try { (Array.isArray(JSON.parse(rawData.msg)) ? JSON.parse(rawData.msg) : [JSON.parse(rawData.msg)])
      .forEach(d => ingestToMap(d, map, cutoff)); } catch {}
    return;
  }
  const item = normalizeItem(rawData);
  if (item && item.timestamp > cutoff) map.set(item.id, item);
}

async function backfillViaBrowser(cutoff) {
  const browser = await getFJBrowser();
  const page    = await browser.newPage();
  const out     = new Map();

  try {
    await page.setUserAgent(UA);
    const domain = 'www.financialjuice.com';
    for (const [name, value] of Object.entries(_cookies))
      await page.setCookie({ name, value, domain, path: '/' }).catch(() => {});

    // Expose relay — called from page JS via exposed function
    await page.exposeFunction('_fjBkRelay', d => ingestToMap(d, out, cutoff));

    // Intercept the page's native Centrifugo WS:
    //  - capture push messages (live)
    //  - capture result.publications (history sent on subscribe/recovery)
    await page.evaluateOnNewDocument(() => {
      const _NWS = window.WebSocket;
      window.WebSocket = function(url, proto) {
        const ws = new _NWS(url, proto);
        ws.addEventListener('message', e => {
          try {
            const msg = JSON.parse(e.data);
            // Live push
            const d = msg.push?.pub?.data || msg.push?.data;
            if (d) window._fjBkRelay(d);
            // Subscribe response — publications are historical recovery
            if (msg.result?.publications?.length) {
              msg.result.publications.forEach(p => { if (p.data) window._fjBkRelay(p.data); });
            }
          } catch {}
        });
        return ws;
      };
      window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1;
      window.WebSocket.CLOSING    = 2; window.WebSocket.CLOSED = 3;
      window.WebSocket.prototype  = _NWS.prototype;
    });

    await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 40_000 });

    // Wait for WS to deliver live + recovery messages
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const prev = out.size;
      await new Promise(r => setTimeout(r, 1000));
      if (out.size === prev && i >= 2) break;  // stop if no new items arriving
    }
    console.log(`[FJ Backfill Browser] ${out.size} items captured via WS`);
  } catch (e) {
    console.log('[FJ Backfill Browser] error:', e.message);
  } finally {
    await page.close().catch(() => {});
  }
  return [...out.values()];
}

async function backfillHistoricalNews(daysBack = 7) {
  // Wait up to 20 s for auth to complete
  for (let i = 0; i < 20 && !_authDone; i++) await new Promise(r => setTimeout(r, 1000));
  if (!_authDone) { console.log('[FJ Backfill] auth not ready — skipped'); return []; }

  console.log(`[FJ Backfill] Starting ${daysBack}-day historical backfill…`);
  const cutoff    = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const collected = new Map();

  // 1) Centrifugo WS history (cheapest)
  if (_ws?.readyState === 1) {
    for (const ch of ['feed:lite', 'feed:all', 'feed:lite_rid:16']) {
      try {
        const items = await fetchCentrifugoHistory(ch);
        items.forEach(i => collected.set(i.id, i));
        console.log(`[FJ Backfill WS] ${items.length} items from ${ch}`);
        if (collected.size > 200) break;
      } catch {}
    }
  }

  // 2) Paginated HTTP API
  if (collected.size < 100) {
    try {
      const items = await fetchPaginatedHistory(cutoff);
      items.forEach(i => { if (i.timestamp > cutoff) collected.set(i.id, i); });
    } catch {}
  }

  // 3) Browser DOM scrape as last resort
  if (collected.size < 30) {
    try {
      const items = await backfillViaBrowser(cutoff);
      items.forEach(i => collected.set(i.id, i));
    } catch {}
  }

  const result = [...collected.values()]
    .filter(i => i.timestamp > cutoff)
    .sort((a, b) => b.timestamp - a.timestamp);
  console.log(`[FJ Backfill] Done — ${result.length} items from last ${daysBack} days`);
  return result;
}

module.exports = { scrapeFinancialJuice, initFinancialJuice, setOnPushCallback, backfillHistoricalNews };

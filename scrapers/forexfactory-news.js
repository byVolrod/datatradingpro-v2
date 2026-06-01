/**
 * ForexFactory — Breaking News (Puppeteer + Stealth)
 * Bypasses Cloudflare by using a real Chrome instance.
 * Browser is kept alive; CF clearance persists across calls.
 * Cache: 90s in-memory + 30 min disk fallback.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios  = require('axios');
const crypto = require('crypto');
const fs   = require('fs');
const path = require('path');

function toParisTimeStr(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const mar31     = new Date(Date.UTC(y, 2, 31));
  const cestStart = Date.UTC(y, 2, 31 - mar31.getUTCDay()) + 3600000;
  const oct31    = new Date(Date.UTC(y, 9, 31));
  const cetStart = Date.UTC(y, 9, 31 - oct31.getUTCDay()) + 3600000;
  const offset   = (ts >= cestStart && ts < cetStart) ? 2 : 1;
  const local    = new Date(ts + offset * 3600000);
  return String(local.getUTCHours()).padStart(2, '0') + ':' + String(local.getUTCMinutes()).padStart(2, '0');
}

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
const FF_NEWS_URL  = 'https://www.forexfactory.com/news';
const CACHE_FILE   = path.join(__dirname, '..', 'cache_ff_news.json');
const USER_DATA    = path.join(__dirname, '..', '.chrome_profile_ff');
const CACHE_TTL    = 18 * 1000;         // 18s — fast poll cycle
const DISK_TTL     = 30 * 60 * 1000;   // 30 min

let _browser      = null;
let _cache        = { items: [], ts: 0 };
let _launching    = false;
let _fetchingLock = false;
let _pollCb       = null;
let _seenPollIds  = new Set();

// ─── Disk cache ───────────────────────────────────────────────────────────────

function saveDisk(items) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), items })); } catch {}
}

function loadDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(raw.items) && raw.items.length > 0) return raw.items;
  } catch {}
  return null;
}

// ─── Relative time → ms timestamp ────────────────────────────────────────────

function parseRelativeTime(str) {
  const now = Date.now();
  if (!str || /just now|moments? ago/i.test(str)) return now;
  const s   = str.toLowerCase();
  let ms    = 0;
  const hr  = s.match(/(\d+)\s*hr/);
  const min = s.match(/(\d+)\s*min/);
  const sec = s.match(/(\d+)\s*sec/);
  if (hr)  ms += parseInt(hr[1])  * 3_600_000;
  if (min) ms += parseInt(min[1]) *    60_000;
  if (sec) ms += parseInt(sec[1]) *     1_000;
  return ms > 0 ? now - ms : now;
}

// ─── Browser management ───────────────────────────────────────────────────────

async function getBrowser() {
  if (_browser) {
    try { await _browser.pages(); return _browser; } catch {}
    _browser = null;
  }
  if (_launching) {
    // Wait up to 15s for the ongoing launch
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
    console.log('[FF-News] Browser launched');
    return _browser;
  } finally {
    _launching = false;
  }
}

// ─── HTTP probe — try FF endpoints without Puppeteer ─────────────────────────

const FF_HTTP_PROBES = [
  // RSS — most reliable, no auth needed
  { url: 'https://www.forexfactory.com/news.rss',      type: 'rss' },
  { url: 'https://www.forexfactory.com/rss/news',      type: 'rss' },
  { url: 'https://www.forexfactory.com/feed/news',     type: 'rss' },
  { url: 'https://www.forexfactory.com/news.xml',      type: 'rss' },
  // JSON API guesses
  { url: 'https://www.forexfactory.com/api/headlines', type: 'json' },
  { url: 'https://www.forexfactory.com/news.json',     type: 'json' },
];

const HTTP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function tryFFHttpProbe() {
  for (const { url, type } of FF_HTTP_PROBES) {
    try {
      const r = await axios.get(url, {
        headers: { 'User-Agent': HTTP_UA, 'Accept': 'application/rss+xml,application/xml,application/json,*/*' },
        timeout: 6000,
        validateStatus: s => s === 200,
      });
      const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);

      if (type === 'rss' && body.includes('<item>') && body.includes('<title>')) {
        console.log(`[FF-News] HTTP RSS success: ${url}`);
        const rows = [];
        const seen = new Set();
        const re = /<item[\s\S]*?<\/item>/gi;
        let m;
        while ((m = re.exec(body)) !== null) {
          const chunk  = m[0];
          const title  = (chunk.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                          chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/))?.[1]?.trim() || '';
          const link   = (chunk.match(/<link>([\s\S]*?)<\/link>/) ||
                          chunk.match(/<guid>([\s\S]*?)<\/guid>/))?.[1]?.trim() || '';
          const pubDate = chunk.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
          const source  = (chunk.match(/<source[^>]*>([\s\S]*?)<\/source>/) ||
                           chunk.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/))?.[1]?.trim() || '';
          const hl = title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
          if (hl.length >= 12 && !seen.has(hl)) {
            seen.add(hl);
            rows.push({ headline: hl, url: link, source, timeText: pubDate, impact: 'Normal' });
          }
        }
        if (rows.length >= 3) return rows;
      }

      if (type === 'json') {
        const raw = Array.isArray(r.data) ? r.data
          : (r.data?.items || r.data?.news || r.data?.data || r.data?.articles);
        if (Array.isArray(raw) && raw.length >= 3) {
          console.log(`[FF-News] HTTP JSON success: ${url} (${raw.length} items)`);
          return raw.map(d => ({
            headline: (d.title || d.headline || d.name || '').substring(0, 260),
            url: d.url || d.link || '',
            source: d.source || d.publisher || '',
            timeText: d.pubDate || d.date || d.published_at || '',
            impact: d.impact || 'Normal',
          })).filter(r => r.headline.length >= 12);
        }
      }
    } catch {}
  }
  return null; // nothing worked — fall back to Puppeteer
}

// ─── Scrape logic ─────────────────────────────────────────────────────────────

// Cached API endpoint discovered via network intercept
let _ffApiEndpoint = null;
let _ffApiItems    = null;
let _ffApiTs       = 0;

async function fetchFromPage() {
  // Try lightweight HTTP/RSS first — no Puppeteer, no Cloudflare
  const httpRows = await tryFFHttpProbe();
  if (httpRows && httpRows.length >= 3) return httpRows;
  console.log('[FF-News] HTTP probes failed — falling back to Puppeteer');

  const browser = await getBrowser();
  const page    = await browser.newPage();

  // Intercept XHR/fetch responses to discover FF's internal news API
  const apiCandidates = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    const ct  = resp.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    // Skip clearly non-news URLs (analytics, ads, tracking)
    if (/analytics|tracking|beacon|pixel|advert|segment|metrics|collect|telemetr|gtm|ga\.js|fbq|hotjar/i.test(url)) return;
    try {
      const json = await resp.json();
      const arr = Array.isArray(json) ? json
        : (json.data || json.items || json.articles || json.stories || json.news
           || json.results || json.content || json.feed || json.entries);
      if (Array.isArray(arr) && arr.length >= 3) {
        const first = arr[0];
        if (first && (first.title || first.headline || first.name || first.subject)) {
          apiCandidates.push({ url, data: arr });
          console.log(`[FF-News] API endpoint found: ${url} (${arr.length} items)`);
        }
      }
    } catch {}
  });

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(FF_NEWS_URL, { waitUntil: 'load', timeout: 35_000 });

    // Poll until Cloudflare resolves — CF's JS challenge runs in-page (no navigation event)
    for (let i = 0; i < 30; i++) {
      const t = await page.title();
      if (!/just a moment|checking your browser|cloudflare/i.test(t)) break;
      if (i === 0) console.log('[FF-News] CF challenge detected — waiting up to 30s...');
      await new Promise(r => setTimeout(r, 1000));
    }
    const pageTitle = await page.title();
    console.log(`[FF-News] Page title: "${pageTitle}"`);

    // Ensure real FF content has loaded (not just a CF shell)
    try {
      await page.waitForFunction(
        () => !document.title.toLowerCase().includes('just a moment') &&
              document.querySelectorAll('a[href]').length > 15,
        { timeout: 12_000, polling: 500 }
      );
    } catch {}

    // If we discovered an API endpoint, use that data
    if (apiCandidates.length > 0) {
      const best = apiCandidates.sort((a, b) => b.data.length - a.data.length)[0];
      _ffApiEndpoint = best.url;
      console.log(`[FF-News] Using API data from ${best.url} (${best.data.length} items)`);
      // Normalise API items to our row format
      const apiRows = best.data.map(item => ({
        headline: (item.title || item.headline || item.name || '').substring(0, 260),
        url:      item.url || item.link || item.href || '',
        impact:   item.impact || item.importance || 'Normal',
        source:   item.source || item.publisher || '',
        timeText: item.time || item.date || item.published_at || item.created_at || '',
      })).filter(r => r.headline);
      if (apiRows.length > 0) return apiRows;
    }

    // Multi-step scroll to trigger lazy-load of ALL sections
    await page.evaluate(() => window.scrollTo(0, 600));
    await new Promise(r => setTimeout(r, 900));
    await page.evaluate(() => window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.5)));
    await new Promise(r => setTimeout(r, 2200));

    const items = await page.evaluate(() => {
      const rows = [];
      const seen = new Set();

      function addRow(headline, url, source, timeText, impact, preview) {
        const h = headline.trim();
        if (!h || h.length < 15) return;
        if (seen.has(h)) return;
        seen.add(h);
        rows.push({ headline: h, url: url || '', source: source || '', timeText: timeText || '', impact: impact || 'Normal', preview: preview || '' });
      }

      // ── Hot Stories (featured articles) ──────────────────────────────────
      let hotCount = 0;
      document.querySelectorAll('.hot-story, [class*="hot-story"]').forEach(el => {
        const titleEl = el.querySelector('a[class*="title"], h2 a, h3 a, h4 a, a[title]');
        if (!titleEl) return;
        const headline  = titleEl.getAttribute('title') || titleEl.textContent?.trim() || '';
        const url       = titleEl.getAttribute('href') || '';
        const srcEl     = el.querySelector('a.darklink, [class*="source"], [class*="publisher"]');
        const source    = srcEl?.textContent?.trim().replace(/^From\s*/i, '') || '';
        const timeEl    = el.querySelector('time, [class*="time"], span.nowrap');
        const timeText  = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
        const imgCls    = el.querySelector('img[class*="impact"]')?.className || '';
        const impact    = imgCls.includes('high') ? 'High' : imgCls.includes('medium') ? 'Medium' : 'Normal';
        // Capture preview text from the article teaser shown on the news listing page
        const previewEl = el.querySelector('[class*="preview"], [class*="summary"], [class*="excerpt"], [class*="teaser"], [class*="description"], [class*="body"], p');
        const preview   = previewEl ? previewEl.textContent.replace(/\s+/g, ' ').trim() : '';
        addRow(headline, url, source, timeText, impact, preview);
        hotCount++;
      });

      // ── Latest Stories — try multiple selector generations ────────────────
      // Latest Stories: FF uses .news-block__items; try it first, then fallbacks
      const latestContainerSelectors = [
        '.news-block__items', '[class*="news-block__items"]',
        '.latest-news',    '.latest-stories',   '.news-latest',
        '.newsboard',      '.news-board',        '.news-panel',
        '[class*="latest-news"]', '[class*="latest-stories"]', '[class*="news-list"]',
        '[class*="news-board"]',  '[class*="newsboard"]',      '[class*="news-feed"]',
        '[class*="flx-news"]',    '[class*="article-list"]',   '[class*="story-list"]',
      ];
      let latestCount = 0;

      for (const containerSel of latestContainerSelectors) {
        const container = document.querySelector(containerSel);
        if (!container) continue;
        const prevLen = rows.length;
        const itemEls = container.querySelectorAll('li, [class*="item"], [class*="story"], [class*="article"], tr, div[class]');
        itemEls.forEach(el => {
          const aEl = el.querySelector('a[href], a[class*="title"], h2 a, h3 a');
          if (!aEl) return;
          const href = aEl.getAttribute('href') || '';
          if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
          // For news-block items the headline lives in a title div, not the image link
          let headline = aEl.getAttribute('title') || aEl.textContent?.trim() || '';
          if (headline.length < 12) {
            const titleEl = el.querySelector('[class*="title"], h2, h3, h4, [class*="headline"]');
            if (titleEl) headline = titleEl.textContent?.trim() || '';
          }
          if (headline.length < 12) return;
          // Reject source-attribution stubs like "From globalnews.ca" or "@LiveSquawk"
          if (/^(from\s+\S+|@\S+)$/i.test(headline.trim()) || headline.split(/\s+/).filter(Boolean).length < 4) return;
          // Reject forum comments like "Username commented some opinion..."
          if (/^\w+\s+commented\s+/i.test(headline)) return;
          const srcEl    = el.querySelector('[class*="source"], [class*="publisher"], a.darklink, .flx-news-source');
          const source   = srcEl?.textContent?.trim().replace(/^From\s*/i, '') || '';
          const timeEl   = el.querySelector('time, [class*="time"], [class*="age"], [class*="date"]');
          const timeText = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
          // Capture preview/body text from news-block__body or similar
          const previewEl = el.querySelector('[class*="body"], [class*="preview"], [class*="summary"], [class*="excerpt"], p');
          const preview   = previewEl ? previewEl.textContent.replace(/\s+/g, ' ').trim() : '';
          addRow(headline, href, source, timeText, 'Normal', preview);
          latestCount++;
        });
        if (rows.length > prevLen) break; // only stop when unique items were added
      }

      // ── Nuclear fallback: scan ALL headline-sized links on page ─────────
      // IMPORTANT: do NOT exclude .sidebar — Latest Stories live in the right column
      // which FF renders as a sidebar. Only skip pure navigation chrome.
      if (latestCount === 0) {
        document.querySelectorAll('a').forEach(aEl => {
          const href = aEl.getAttribute('href') || '';
          if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
          // Skip pure navigation chrome only (NOT sidebar content)
          if (aEl.closest('nav, header, footer, [role="navigation"], .topnav, [class*="topnav"], [class*="breadcrumb"]')) return;
          const headline = aEl.getAttribute('title') || aEl.textContent?.trim() || '';
          if (headline.length < 12 || headline.length > 280) return;
          // Must look like a headline: at least 3 words
          if (headline.split(/\s+/).length < 3) return;
          if (/^(log in|sign up|subscribe|home|news|calendar|forum|trade|broker|markets|education|analysis|tools|help|about|contact|privacy|terms|cookies?|advertis)$/i.test(headline)) return;
          const container = aEl.closest('li, tr, [class*="story"], [class*="article"], [class*="item"], [class*="row"], div[class]');
          const srcEl  = container?.querySelector('[class*="source"], [class*="author"], a.darklink, .flx-news-source');
          let source   = srcEl?.textContent?.trim().replace(/^From\s*/i, '').replace(/^\s*@/, '@') || '';
          if (!source) {
            const nearbyText = container?.textContent || '';
            const twitterMatch = nearbyText.match(/@([A-Za-z0-9_]{3,25})/);
            source = twitterMatch ? twitterMatch[0] : '';
          }
          const timeEl = container?.querySelector('time, [class*="time"], [class*="age"], [class*="date"], span.nowrap');
          const timeText = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
          addRow(headline, href, source, timeText, 'Normal');
          latestCount++;
        });
      }

      // Always log class names for debugging — helps identify page structure
      const debugInfo = [...document.querySelectorAll('[class]')]
        .filter(el => /(latest|news|story|article|feed|flash|breaking|stream|ticker|squawk|wire)/i.test(el.className || ''))
        .map(el => `${el.tagName.toLowerCase()}.${(el.className || '').trim().split(/\s+/)[0]}`)
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 30)
        .join(' | ');

      return { rows, hotCount, latestCount, debugInfo };
    });

    console.log(`[FF-News] DOM scrape: hot=${items.hotCount} latest=${items.latestCount} total=${items.rows.length}`);
    if (items.debugInfo) console.log(`[FF-News] Page classes: ${items.debugInfo || '(none found)'}`);
    return items.rows;
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Category / tag helpers (matching server.js logic) ───────────────────────

function detectCategory(text) {
  const t = (text || '').toLowerCase();
  if (/\bfed\b|federal reserve|fomc|powell|yellen/.test(t))          return 'Fed';
  if (/\becb\b|lagarde|european central bank/.test(t))               return 'ECB';
  if (/\bboj\b|bank of japan|ueda|kuroda/.test(t))                   return 'BoJ';
  if (/\bboe\b|bank of england|bailey/.test(t))                      return 'BoE';
  if (/\bboc\b|bank of canada|macklem/.test(t))                      return 'BoC';
  if (/\brba\b|reserve bank of australia/.test(t))                   return 'RBA';
  if (/\bsnb\b|swiss national bank/.test(t))                         return 'SNB';
  if (/\brbnz\b|reserve bank of new zealand/.test(t))               return 'RBNZ';
  if (/oil\b|crude|brent|wti|opec|energy\b|gas price|petroleum|hormuz/.test(t)) return 'Energy & Power';
  if (/\bgold\b|silver|copper|nickel|metal|platinum|palladium/.test(t)) return 'Metals';
  if (/bitcoin|crypto|ethereum|\bbtc\b|\beth\b|blockchain|defi/.test(t)) return 'Crypto';
  if (/war|conflict|geopolit|russia|ukraine|iran|israel|hamas|hezbollah|taiwan|nato|missile|troops|military|sanction/.test(t)) return 'Geopolitical';
  if (/gdp|inflation|cpi|ppi|\bpmi\b|nfp|payroll|unemployment|retail sales|consumer price/.test(t)) return 'Economic Commentary';
  if (/\busd\b|\beur\b|\bgbp\b|\bjpy\b|\bchf\b|forex|fx |exchange rate|currency|dollar|yen/.test(t)) return 'FX Flows';
  if (/nasdaq|s&p|dow|dax|cac|ftse|equity|equities|stock market/.test(t)) return 'Market Analysis';
  if (/bond yield|treasury yield|gilt|bund|fixed income|sovereign debt/.test(t)) return 'Fixed Income';
  if (/\btrade\b|tariff|export|import|wto|supply chain/.test(t))    return 'Trade';
  if (/\basia\b|japan|china|korea|singapore|hong kong/.test(t))      return 'Asian News';
  return 'Global News';
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function scrapeForexFactoryNews() {
  // In-memory cache hit
  if (Date.now() - _cache.ts < CACHE_TTL && _cache.items.length > 0) return _cache.items;
  // Prevent concurrent fetches — return stale cache while one is in progress
  if (_fetchingLock) return _cache.items;
  _fetchingLock = true;

  try {
    const raw = await fetchFromPage();
    if (!raw.length) throw new Error('No items from page');

    const now   = Date.now();
    console.log(`[FF-News] Scraped ${raw.length} items from page`);
    const items = raw.map(r => {
      const ts       = parseRelativeTime(r.timeText);
      const category = detectCategory(r.headline);
      const id       = `ff-news-${crypto.createHash('md5').update(r.url || r.headline).digest('hex').substring(0, 16)}`;

      const tags = [category];
      const t    = r.headline.toLowerCase();
      if (/(united states|\bus\b|trump|dollar|fed\b)/.test(t)) tags.push('US');
      if (/(united kingdom|\buk\b|britain|pound|sterling)/.test(t)) tags.push('UK');
      if (/(china|beijing|yuan|renminbi)/.test(t)) tags.push('China');
      if (/(europe|european|\beu\b|euro\b|ecb\b)/.test(t)) tags.push('EU');
      if (r.impact === 'High')   tags.push('High');
      if (r.impact === 'Medium') tags.push('Medium');

      const fullUrl = r.url
        ? (r.url.startsWith('http') ? r.url : `https://www.forexfactory.com${r.url}`)
        : '';

      // Use preview text captured from the news listing page as the description.
      // This avoids a second Puppeteer fetch on the article page.
      const preview = (r.preview || '').trim();
      const PREVIEW_NOISE = /code of conduct|website coordinator|newsstand|posted by|medium impact|high impact|breaking\s+\d|forum rules|pic\.twitter|@\w{3,}\s*[|]/i;
      const cleanPreview = preview.length > 40 && !PREVIEW_NOISE.test(preview)
        ? preview.substring(0, 800)
        : '';

      return {
        id,
        time:      toParisTimeStr(ts),
        timestamp: ts,
        category,
        source:    'ForexFactory',
        headline:  r.headline.substring(0, 260),
        url:       fullUrl,
        description: cleanPreview,
        tags: [...new Set(tags)],
        priority:  r.impact === 'High' ? 'high' : 'normal',
      };
    });

    _cache = { items, ts: now };
    saveDisk(items);
    console.log(`  [FF-News] ${items.length} breaking news items`);
    return items;

  } catch (err) {
    console.error('[FF-News]', err.message);
    const disk = loadDisk();
    if (disk) { _cache = { items: disk, ts: Date.now() - CACHE_TTL + 60_000 }; return disk; }
    return _cache.items;
  } finally {
    _fetchingLock = false;
  }
}

// ─── Fast polling — calls callback with only genuinely new items ──────────────

async function _pollOnce() {
  try {
    const items = await scrapeForexFactoryNews();
    if (!_pollCb || !items.length) return;
    const fresh = items.filter(it => !_seenPollIds.has(it.id));
    if (!fresh.length) return;
    fresh.forEach(it => _seenPollIds.add(it.id));
    if (_seenPollIds.size > 2000) {
      const arr = [..._seenPollIds];
      _seenPollIds = new Set(arr.slice(arr.length - 1000));
    }
    console.log(`[FF-News LIVE →] ${fresh.length} new item(s)`);
    _pollCb(fresh);
  } catch (e) {
    console.error('[FF-News poll]', e.message);
  }
}

function startFFNewsPoll(callback, intervalMs = 20_000) {
  _pollCb = callback;
  _pollOnce();
  setInterval(_pollOnce, intervalMs);
}

// ─── Article content fetch ────────────────────────────────────────────────────

const _articleCache = new Map(); // url → { points, label, ts }
const ARTICLE_CACHE_TTL = 30 * 60 * 1000;

async function getArticleContent(url, headline = '') {
  if (!url) return null;

  // Cache key includes headline so same URL with different headlines gets filtered correctly
  const cacheKey = url + '||' + headline.substring(0, 80);
  const cached = _articleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ARTICLE_CACHE_TTL) return cached;

  const browser = await getBrowser();
  const page    = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });

    const title = await page.title();
    if (/just a moment/i.test(title)) {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => {});
    }

    // Build keyword set from headline for relevance filtering
    const hlWords = headline
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !/^(that|this|with|from|been|have|will|they|their|said|says|into|over|also|after|before|about|more|than|when|were|which)$/.test(w));

    const result = await page.evaluate((hlWords) => {
      const isFF = /forexfactory\.com/.test(location.hostname);

      // ── Remove structural noise sections before extracting ──
      // ForexFactory: remove hot-stories list, news-block lists (sidebar), comments
      const removeSelectors = [
        // FF-specific (from observed DOM)
        'div.hot-story__comments', 'div.hot-story__comment', 'div.hot-story__comment-form',
        'div.news-block__items',  // "latest news" list sidebar
        // Generic forum/thread noise
        '.thread-replies', '.thread-reply', '.forum-replies',
        '[class*="comment"]', '[class*="reply"]', '[class*="sidebar"]',
        // Ads / overlays
        '.overlay', '[class*="overlay"]', '[class*="advertisement"]',
        // Navigation / footer
        'nav', 'footer', 'header',
      ];
      removeSelectors.forEach(sel => {
        try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
      });

      // ── Article container (specificity order) ──
      const containerSelectors = [
        // ForexFactory article page containers
        '.news-article', '.news-body', '[class*="news-article"]', '[class*="news-body"]',
        // Hot story content (FF featured article)
        '.hot-story__content', '.hot-story__preview',
        // Reuters
        '[data-testid="ArticleBody"]', '[data-testid="article-body"]',
        // Bloomberg / FT / WSJ / CNBC
        '.body-content', '[class*="body-content"]',
        '[class*="article__content"]', '[class*="article-content"]',
        '[class*="ArticleBody"]',  '[class*="article-body"]',
        // Generic
        '[class*="news-content"]', '.content-body',
        'article main', 'article', 'main',
      ];

      let bodyEl = null;
      for (const sel of containerSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim().length > 80) { bodyEl = el; break; }
        } catch {}
      }
      if (!bodyEl) bodyEl = document.body;

      // ── Hard noise filter ──
      const NOISE = /\b(code of conduct|thread has|misleading title|website coordinator|newsstand|forum rules|report post|posted by\s+\w|medium impact|high impact|low impact|breaking\s+\d|\d+\s+comments?|min ago|hr ago|days? ago|\d{1,2}:\d{2}(am|pm)|\d+,\d{3}|livesquawk|pic\.twitter|@\w{3,}\s*[|\(]|click here|read more|sign up|newsletter|subscribe|advertisement|cookie|terms of use|privacy policy|all rights reserved|follow us|share this|get the latest)\b/i;

      // ── Extract all candidate paragraphs ──
      const candidates = [...bodyEl.querySelectorAll('p, li')]
        .map(el => el.textContent.replace(/\s+/g, ' ').trim())
        .filter(t => t.length >= 45 && t.length <= 600)
        .filter(t => !NOISE.test(t))
        .filter(t => /[a-z]{5,}/.test(t))
        // Reject mostly-uppercase lines (repeated headlines, tweet content)
        .filter(t => {
          const letters = t.replace(/[^a-zA-Z]/g, '');
          return letters.length > 0 && (t.replace(/[^a-z]/g, '').length / letters.length) > 0.45;
        });

      // ── Relevance filter: keep only paragraphs sharing keywords with headline ──
      function relevanceScore(text) {
        if (hlWords.length === 0) return 1; // no headline → accept all
        const lower = text.toLowerCase();
        return hlWords.filter(w => lower.includes(w)).length;
      }

      // Keep paragraphs with at least 1 keyword match, or first 2 candidates if none match
      let paras = candidates.filter(t => relevanceScore(t) >= 1);
      if (paras.length === 0) paras = candidates.slice(0, 2);

      // Deduplicate (headline repeated verbatim in body)
      paras = paras.reduce((acc, t) => {
        if (!acc.some(e => e.substring(0, 55) === t.substring(0, 55))) acc.push(t);
        return acc;
      }, []).slice(0, 5);

      // ── Article type detection ──
      const sample = (bodyEl.innerText || document.body.innerText).substring(0, 600).toLowerCase();
      const isSpeech   = /\bsays?\b|\bsaid\b|\bstates?\b|\badds?\b|\bnotes?\b|\bcalled\b/.test(sample);
      const isReaction = /market reaction|immediate reaction|price action|jumped|fell sharply/.test(sample);

      return { paras, isSpeech, isReaction };
    }, hlWords);

    const label = result.isReaction ? 'Reaction' : result.isSpeech ? 'Says' : 'Analysis';
    const out = { points: result.paras, label, ts: Date.now() };
    _articleCache.set(cacheKey, out);
    return out;

  } catch (err) {
    console.error('[FF-Article]', err.message);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

// Warm the browser on module load (non-blocking)
getBrowser().catch(e => console.error('[FF-News] Pre-launch failed:', e.message));

module.exports = { scrapeForexFactoryNews, getArticleContent, startFFNewsPoll };

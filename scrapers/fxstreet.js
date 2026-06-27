/**
 * FXStreet — RSS News Feed
 * Public RSS, no auth needed. Cache: 5 min in-memory + 30 min disk.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs   = require('fs');
const path = require('path');

const RSS_URL   = 'https://www.fxstreet.com/rss/news';
const CACHE_FILE = path.join(__dirname, '..', 'cache_fxstreet.json');
const CACHE_TTL  = 5 * 60 * 1000;
const DISK_TTL   = 30 * 60 * 1000;
const MAX_AGE    = 6 * 3600 * 1000;   // drop items older than 6 h

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
};

let _cache = { items: [], ts: 0 };

function saveDisk(items) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), items })); } catch {}
}
function loadDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Date.now() - raw.ts < DISK_TTL && Array.isArray(raw.items) && raw.items.length > 0)
      return raw.items;
  } catch {}
  return null;
}

// Diplomatie / resolution de conflit (ceasefire, accord-cadre, retrait de troupes...) -> prime sur Energy
// (sinon un titre d'accord citant "oil/energy/gas" tombe en "Energy & Power"). Lookbehind (?<!trade ) :
// un "trade framework agreement" reste commercial (pas Geopolitical).
const GEO_DIPLO = /\b(cease[\s-]?fire|truce|armistice|peace\s+(?:deal|talks?|accord|agreement|plan|process|summit|treaty)|(?<!trade\s)(?:framework|trilateral|bilateral)\s+(?:agreement|framework|deal|accord|pact|understanding)|normaliz\w+\s+(?:deal|agreement|accord|of\s+(?:ties|relations))|hostage\s+(?:deal|release|exchange|swap)|prisoner\s+(?:swap|exchange|release)|de[\s-]?escalat\w+|diplomatic\s+(?:breakthrough|agreement|resolution|push)|withdraw\w*\s+(?:its\s+|their\s+)?troops|troop\s+withdrawal|sign\w*\s+(?:a\s+|an\s+|the\s+|initial\s+|framework\s+|landmark\s+|historic\s+)?(?:peace|ceasefire|cease-fire|security|framework|trilateral|bilateral)\s+(?:agreement|accord|pact|deal|treaty|framework))\b/i;
function detectCategory(text) {
  const t = (text || '').toLowerCase();
  if (/\bfed\b|federal reserve|fomc|powell/.test(t))                              return 'Fed';
  if (/\becb\b|lagarde|european central bank/.test(t))                             return 'ECB';
  if (/\bboj\b|bank of japan|ueda/.test(t))                                        return 'BoJ';
  if (/\bboe\b|bank of england|bailey/.test(t))                                    return 'BoE';
  if (/\bboc\b|bank of canada|macklem/.test(t))                                    return 'BoC';
  if (/\brba\b|reserve bank of australia/.test(t))                                 return 'RBA';
  if (/\bsnb\b|swiss national bank/.test(t))                                       return 'SNB';
  if (/\brbnz\b|reserve bank of new zealand/.test(t))                              return 'RBNZ';
  if (GEO_DIPLO.test(t)) return 'Geopolitical';   // accord/ceasefire/retrait diplomatique -> Geopolitical AVANT Energy
  if (/oil\b|crude|brent|wti|opec|energy\b|gas price|natural gas|petroleum/.test(t)) return 'Energy & Power';
  if (/\bgold\b|silver|copper|nickel|metal|platinum|palladium/.test(t))            return 'Metals';
  if (/bitcoin|crypto|ethereum|\bbtc\b|\beth\b|blockchain|defi/.test(t))           return 'Crypto';
  if (/war|conflict|geopolit|russia|ukraine|iran|israel|taiwan|nato|missile|military|sanction/.test(t)) return 'Geopolitical';
  if (/gdp|inflation|cpi|ppi|\bpmi\b|nfp|payroll|unemployment|retail sales/.test(t)) return 'Economic Commentary';
  if (/\busd\b|\beur\b|\bgbp\b|\bjpy\b|\bchf\b|forex|fx |exchange rate|currency|dollar|yen/.test(t)) return 'FX Flows';
  if (/nasdaq|s&p|dow|dax|cac|ftse|equity|equities|stock market/.test(t))         return 'Market Analysis';
  if (/bond yield|treasury yield|gilt|bund|fixed income/.test(t))                 return 'Fixed Income';
  if (/\btrade\b|tariff|export|import|wto|supply chain/.test(t))                  return 'Trade';
  if (/\basia\b|japan|china|korea|singapore|hong kong/.test(t))                   return 'Asian News';
  return 'Global News';
}

async function scrapeFXStreet() {
  if (Date.now() - _cache.ts < CACHE_TTL && _cache.items.length > 0) return _cache.items;

  try {
    const res = await axios.get(RSS_URL, { headers: HEADERS, timeout: 12000, responseType: 'text' });
    const $   = cheerio.load(res.data, { xmlMode: true });

    const now   = Date.now();
    const items = [];

    $('item').each((_, el) => {
      const $el    = $(el);
      const title  = $el.find('title').text().trim();
      const pubDate = $el.find('pubDate').text().trim();
      const link   = $el.find('link').text().trim() || $el.find('guid').text().trim();
      const desc   = $el.find('description').text().replace(/<[^>]+>/g, '').trim().substring(0, 200);

      if (!title || title.length < 10) return;
      const ts = pubDate ? new Date(pubDate).getTime() : now;
      const tsOk = isNaN(ts) ? now : ts;
      if (now - tsOk > MAX_AGE) return;

      const category = detectCategory(title + ' ' + desc);
      const id       = `fxs-${Buffer.from(link || title).toString('base64').substring(0, 12)}`;

      const tags = [category];
      const t = title.toLowerCase();
      if (/(united states|\bus\b|trump|dollar|fed\b)/.test(t)) tags.push('US');
      if (/(united kingdom|\buk\b|britain|pound|sterling)/.test(t)) tags.push('UK');
      if (/(china|beijing|yuan)/.test(t)) tags.push('China');
      if (/(europe|european|\beu\b|euro\b|ecb\b)/.test(t)) tags.push('EU');

      items.push({
        id,
        time:      new Date(tsOk).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
        timestamp: tsOk,
        category,
        source:    'FXStreet',
        headline:  title.substring(0, 260),
        description: desc,
        tags:      [...new Set(tags)],
        priority:  ['Fed', 'ECB', 'Geopolitical', 'Energy & Power'].includes(category) ? 'high' : 'normal',
      });
    });

    items.sort((a, b) => b.timestamp - a.timestamp);
    const result = items.slice(0, 40);

    _cache = { items: result, ts: now };
    saveDisk(result);
    console.log(`  [FXStreet] ${result.length} items`);
    return result;

  } catch (err) {
    console.error('[FXStreet]', err.message);
    const disk = loadDisk();
    if (disk) { _cache = { items: disk, ts: Date.now() - CACHE_TTL + 60_000 }; return disk; }
    return _cache.items;
  }
}

module.exports = { scrapeFXStreet };

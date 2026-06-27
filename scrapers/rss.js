const axios = require('axios');
const cheerio = require('cheerio');

const FEEDS = [
  // Core FX / Forex news
  { url: 'https://www.forexlive.com/feed/news',                                                                           source: 'ForexLive',     priority: 'high'   },
  { url: 'https://www.fxstreet.com/rss/news',                                                                             source: 'FXStreet',      priority: 'high'   },
  // Macro / markets
  { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',                                                                source: 'WSJ Markets',   priority: 'normal' },
  { url: 'http://feeds.marketwatch.com/marketwatch/topstories/',                                                          source: 'MarketWatch',   priority: 'normal' },
  { url: 'https://finance.yahoo.com/rss/topfinstories',                                                                   source: 'Yahoo Finance', priority: 'normal' },
  { url: 'https://www.investing.com/rss/news.rss',                                                                        source: 'Investing.com', priority: 'normal' },
  { url: 'https://feeds.feedburner.com/zerohedge/feed',                                                                   source: 'ZeroHedge',     priority: 'normal' },
  // Google News RSS — aggregates many sources per topic
  { url: 'https://news.google.com/rss/search?q=forex+currency+central+bank&hl=en-US&gl=US&ceid=US:en',                   source: 'Google News',   priority: 'high'   },
  { url: 'https://news.google.com/rss/search?q=oil+gold+inflation+interest+rate&hl=en-US&gl=US&ceid=US:en',              source: 'Google News',   priority: 'high'   },
  { url: 'https://news.google.com/rss/search?q=Fed+ECB+BOJ+monetary+policy&hl=en-US&gl=US&ceid=US:en',                   source: 'Google News',   priority: 'high'   },
  { url: 'https://news.google.com/rss/search?q=geopolitical+risk+trade+war+sanctions&hl=en-US&gl=US&ceid=US:en',         source: 'Google News',   priority: 'high'   },
  // Mehr News (Iran) — TOP 10 marqués IMPORTANTS (géopolitique Moyen-Orient), sans doublon
  { url: 'https://en.mehrnews.com/rss',                                                                                   source: 'Mehr News',     limit: 10 },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

function detectCategory(text) {
  const t = (text || '').toLowerCase();
  if (/\bfed\b|federal reserve|fomc|powell|jerome|yellen/.test(t)) return 'Fed';
  if (/\becb\b|lagarde|european central bank|frankfurt/.test(t)) return 'ECB';
  if (/\bboj\b|bank of japan|ueda|kuroda/.test(t)) return 'BoJ';
  if (/\bboe\b|bank of england|bailey|threadneedle/.test(t)) return 'BoE';
  if (/\bboc\b|bank of canada|macklem/.test(t)) return 'BoC';
  if (/\brba\b|reserve bank of australia|bullock/.test(t)) return 'RBA';
  if (/\bsnb\b|swiss national bank|jordan/.test(t)) return 'SNB';
  if (/\brbnz\b|reserve bank of new zealand/.test(t)) return 'RBNZ';
  if (/oil\b|crude|brent|wti|opec|adnoc|energy|gas price|natural gas|petroleum|refin|hormuz/.test(t)) return 'Energy & Power';
  if (/\bgold\b|silver|copper|nickel|zinc|aluminum|iron ore|metal|platinum|palladium/.test(t)) return 'Metals';
  if (/bitcoin|crypto|ethereum|\bbtc\b|\beth\b|blockchain|defi|nft|altcoin|stablecoin/.test(t)) return 'Crypto';
  if (/war|conflict|geopolit|russia|ukraine|iran|israel|hamas|hezbollah|taiwan|nato|missile|troops|military|sanction/.test(t)) return 'Geopolitical';
  if (/gdp|inflation|cpi|ppi|\bpmi\b|nfp|payroll|unemployment|jobless|retail sales|consumer price|producer price|trade balance|current account/.test(t)) return 'Economic Commentary';
  if (/\busd\b|\beur\b|\bgbp\b|\bjpy\b|\bchf\b|\bausd\b|\bnzd\b|\bcad\b|forex|fx |exchange rate|currency pair|dollar|euro|pound|yen/.test(t)) return 'FX Flows';
  if (/nasdaq|s&p 500|s&p500|dow jones|dax|cac 40|ftse 100|nikkei|hang seng|equity|equities|stock market|shares|ipo/.test(t)) return 'Market Analysis';
  if (/bond yield|treasury yield|gilt|bund|t-bill|spread|fixed income|sovereign debt/.test(t)) return 'Fixed Income';
  if (/\btrade\b|tariff|export|import|wto|supply chain|trade war|protectionism/.test(t)) return 'Trade';
  if (/\basia\b|japan|china|korea|singapore|hong kong|thailand|vietnam|indonesia|india/.test(t)) return 'Asian News';
  if (/wheat|corn|soy|cotton|coffee|sugar|cocoa|agriculture|crop|livestock|cattle/.test(t)) return 'Ags & Softs';
  if (/prime minister|parliament|election|vote|congress|senate|white house/.test(t)) return 'Gov Update';
  return 'Global News';
}

// Affectation de tags PRÉCISE et conservatrice : on ne pose un tag que sur un signal FORT
// et non ambigu (on évite "us" le pronom, "london" le lieu, "eu" trop court…). Beaucoup de
// news ne reçoivent AUCUN tag supplémentaire — c'est voulu (toutes n'ont pas besoin de tags).
function extractTags(category, text) {
  const orig = ' ' + (text || '') + ' ';                                              // garde la CASSE (US ≠ us)
  const t    = ' ' + (text || '').toLowerCase().replace(/[^a-z0-9.%/&'-]+/g, ' ') + ' ';
  const tags = [];
  const add = tag => { if (!tags.includes(tag)) tags.push(tag); };

  // Pays / zones — codes-pays en MAJUSCULES (sur le texte original) pour ne JAMAIS confondre
  // "US" (pays) avec "us" (pronom), puis mots forts non ambigus en minuscules.
  if (/\b(US|U\.S\.A?\.?|USA)\b/.test(orig) ||
      /\b(united states|federal reserve|fomc|powell|washington|white house|greenback)\b/.test(t) ||
      /\bfed\b/.test(t)) add('US');
  if (/\b(UK|U\.K\.)\b/.test(orig) ||
      /\b(united kingdom|britain|british|sterling|gbp|bank of england|boe|gilt)\b/.test(t)) add('UK');
  if (/\b(EU|ECB)\b/.test(orig) ||
      /\b(euro ?zone|european union|lagarde|brussels|bund|euro)\b/.test(t)) add('EU');
  if (/\b(china|chinese|beijing|pboc|yuan|renminbi)\b/.test(t)) add('China');
  if (/\b(BOJ|JPY)\b/.test(orig) ||
      /\b(japan|japanese|tokyo|yen|ueda)\b/.test(t)) add('Japan');

  // Thèmes de marché
  if (/\b(cpi|ppi|pce|gdp|nfp|non-?farm|payrolls?|unemployment|jobless claims|retail sales|industrial production|durable goods|factory orders|trade balance|current account|consumer price|producer price|inflation|pmi|ism|ifo|zew)\b/.test(t)) add('Data');
  if (/\b(rate (decision|hike|cut|hold|pause|increase)|interest rate|basis points?|bps|monetary policy|policy rate|benchmark rate|repo rate|overnight rate|quantitative (easing|tightening)|hawkish|dovish)\b/.test(t)) add('Rates');
  if (/\b(oil|crude|brent|wti|opec|natural gas|gasoline|petroleum)\b/.test(t)) add('Oil');
  if (/\b(gold|silver|copper|platinum|palladium|bullion|xau|xag)\b/.test(t)) add('Metals');
  if (/\b(war|conflict|missile|airstrike|sanctions?|ceasefire|nuclear|geopolit|invasion|military|hostage|hezbollah|hamas)\b/.test(t)) add('Geopolitics');
  if (/\b(bitcoin|crypto|ethereum|btc|eth|stablecoin|blockchain)\b/.test(t)) add('Crypto');

  // On garde la catégorie en tête (le front l'affiche déjà ailleurs / la masque), puis au plus
  // 3 tags THÉMATIQUES nets. Si aucun signal fort → la news n'a que sa catégorie (souvent masquée).
  return [...new Set([category, ...tags.slice(0, 3)])];
}

function parseRSSDate(dateStr) {
  if (!dateStr) return Date.now();
  try { return new Date(dateStr).getTime() || Date.now(); }
  catch { return Date.now(); }
}

function toParisTimeStr(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const mar31     = new Date(Date.UTC(y, 2, 31));
  const cestStart = Date.UTC(y, 2, 31 - mar31.getUTCDay()) + 3600000;
  const oct31     = new Date(Date.UTC(y, 9, 31));
  const cetStart  = Date.UTC(y, 9, 31 - oct31.getUTCDay()) + 3600000;
  const offset    = (ts >= cestStart && ts < cetStart) ? 2 : 1;
  const local     = new Date(ts + offset * 3600000);
  return String(local.getUTCHours()).padStart(2,'0') + ':' + String(local.getUTCMinutes()).padStart(2,'0');
}

async function fetchFeed(feed) {
  try {
    const res = await axios.get(feed.url, {
      headers: HEADERS,
      timeout: 7000,
      responseType: 'text',
    });

    const $ = cheerio.load(res.data, { xmlMode: true });
    const items = [];
    const maxItems = feed.limit || 100;            // certains flux (ex. Mehr News) limités au top N
    const seenTitles = new Set();                  // anti-doublon par titre AU SEIN du flux

    $('item').each((i, el) => {
      if (items.length >= maxItems) return false;   // top N atteint → on s'arrête
      const $el = $(el);
      const title = $el.find('title').first().text().trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
      const desc  = $el.find('description').first().text().trim().replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/<[^>]*>/g, '');
      const pubDate = $el.find('pubDate, published, dc\\:date').first().text().trim();
      const link  = $el.find('link').first().text().trim() || $el.find('guid').first().text().trim();

      if (!title || title.length < 8) return;
      const titleKey = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seenTitles.has(titleKey)) return;         // doublon de titre → on saute
      seenTitles.add(titleKey);

      const combined = title + ' ' + desc;
      const category = detectCategory(combined);
      const ts = parseRSSDate(pubDate);

      // "important" : flux marqué important (ex. Mehr News top 10) OU high-priority sur catégorie sensible
      // Importance = CONTENU (decidee par upgradeItemPriority cote server.js), PAS le flux : on ne flagge
      // plus en masse la geopolitique (sinon, en periode de conflit, 30% du feed passe rouge a tort).
      // Seules les vraies CB restent (rares + justifiees) ; le reste est upgrade au cas par cas si le contenu le merite.
      const isImportant = (feed.priority === 'high' && ['Fed','ECB','BoJ','BoE'].includes(category));

      items.push({
        id: `rss-${feed.source.replace(/\s/g,'').toLowerCase()}-${Buffer.from(link || title).toString('base64').substring(0,10)}-${ts}`,
        time: toParisTimeStr(ts),
        timestamp: ts,
        category,
        source: feed.source,
        headline: title.replace(/\s+/g, ' ').substring(0, 260),
        description: desc.substring(0, 500),
        url: link,
        tags: extractTags(category, combined),
        priority: isImportant ? 'high' : 'normal',
        important: isImportant || undefined,        // marqueur explicite pour le front (news importante)
      });
    });

    console.log(`  [RSS] ${feed.source}: ${items.length} items`);
    return items;
  } catch (err) {
    console.error(`  [RSS] ${feed.source}: ${err.message}`);
    return [];
  }
}

async function fetchAllRSS() {
  const results = await Promise.allSettled(FEEDS.map(f => fetchFeed(f)));
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

module.exports = { fetchAllRSS };

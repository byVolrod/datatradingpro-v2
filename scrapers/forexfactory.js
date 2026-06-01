/**
 * ForexFactory — Economic Calendar (XML)
 * Source: nfs.faireconomy.media (public mirror, no Cloudflare gating)
 * Cache: in-memory (15 min TTL) + disk fallback for 429 / errors
 */
const axios   = require('axios');
const cheerio = require('cheerio');
const fs      = require('fs');
const path    = require('path');

const CALENDAR_URL      = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
const CALENDAR_URL_NEXT = 'https://nfs.faireconomy.media/ff_calendar_nextweek.xml';
const CACHE_FILE        = path.join(__dirname, '..', 'cache_ff.json');
const RAW_CACHE_FILE    = path.join(__dirname, '..', 'cache_ff_raw.json');
const CACHE_TTL         = 15 * 60 * 1000;   // 15 min in-memory
const DISK_TTL          = 60 * 60 * 1000;   // 1 h disk cache (on 429)

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'application/xml, text/xml, */*',
};

// ─── In-memory cache ─────────────────────────────────────────────────────────
let _cache = { items: [], ts: 0 };
let _rawCalEvents = [];  // raw events with individual fields for calendar view

// Pre-load raw calendar events from disk so the endpoint isn't empty on first request
(function preloadRawCalendar() {
  try {
    const raw = JSON.parse(fs.readFileSync(RAW_CACHE_FILE, 'utf8'));
    if (Array.isArray(raw.items) && raw.items.length > 0 && Date.now() - raw.ts < DISK_TTL) {
      _rawCalEvents = raw.items;
      console.log(`  [ForexFactory] Preloaded ${_rawCalEvents.length} raw calendar events from disk`);
    }
  } catch {}
})();

function fromMemCache() {
  return Date.now() - _cache.ts < CACHE_TTL ? _cache.items : null;
}

// ─── Disk cache ───────────────────────────────────────────────────────────────
function saveDisk(items) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), items })); } catch {}
}

function loadDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Date.now() - raw.ts < DISK_TTL && Array.isArray(raw.items) && raw.items.length > 0) {
      console.log(`  [ForexFactory] Using disk cache (${raw.items.length} events)`);
      return raw.items;
    }
  } catch {}
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function currencyToCategory(c) {
  return { USD:'Fed', EUR:'ECB', GBP:'BoE', JPY:'BoJ', CAD:'BoC', AUD:'RBA', NZD:'RBNZ', CHF:'SNB' }[c] || 'Economic Commentary';
}

function detectCBFromTitle(title) {
  const t = (title || '').toLowerCase();
  if (/\bfed\b|fomc|powell|federal reserve/.test(t)) return 'Fed';
  if (/\becb\b|lagarde|european central bank|governing council/.test(t)) return 'ECB';
  if (/\bboe\b|bank of england|bailey/.test(t)) return 'BoE';
  if (/\bboj\b|bank of japan|ueda/.test(t)) return 'BoJ';
  if (/\bboc\b|bank of canada|macklem/.test(t)) return 'BoC';
  if (/\brba\b|reserve bank of australia/.test(t)) return 'RBA';
  if (/\bsnb\b|swiss national bank/.test(t)) return 'SNB';
  if (/\brbnz\b|reserve bank of new zealand/.test(t)) return 'RBNZ';
  return null;
}

function parseEventTime(dateStr, timeStr) {
  try {
    // dateStr: "MM-DD-YYYY", timeStr: "6:29am" — ForexFactory uses Eastern Time (ET)
    const [mm, dd, yyyy] = (dateStr || '').split('-').map(Number);
    if (!mm || !dd || !yyyy) return Date.now();

    let hh = 0, min = 0;
    if (timeStr) {
      const m = timeStr.match(/^(\d+):(\d+)\s*(am|pm)$/i);
      if (m) {
        hh = +m[1]; min = +m[2];
        if (/pm/i.test(m[3]) && hh !== 12) hh += 12;
        if (/am/i.test(m[3]) && hh === 12)  hh = 0;
      }
    }

    // Determine EDT (-04:00) vs EST (-05:00)
    const base   = new Date(yyyy, mm - 1, dd);
    const edtStart = new Date(yyyy, 2, 8);  while (edtStart.getDay() !== 0) edtStart.setDate(edtStart.getDate() + 1);
    const edtEnd   = new Date(yyyy, 10, 1); while (edtEnd.getDay()   !== 0)   edtEnd.setDate(edtEnd.getDate() + 1);
    const offset = (base >= edtStart && base < edtEnd) ? '-04:00' : '-05:00';

    const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}T${String(hh).padStart(2,'0')}:${String(min).padStart(2,'0')}:00${offset}`;
    const ts  = new Date(iso).getTime();
    return isNaN(ts) ? Date.now() : ts;
  } catch { return Date.now(); }
}

// ─── XML parser — populates items[] and rawEvs[] from a cheerio $ instance ────
function parseCalendarXml($, items, rawEvs, now, windowMs) {
  const seenIds = new Set(items.map(i => i.id));

  $('event').each((_, el) => {
    const $el     = $(el);
    const title   = $el.find('title').text().trim();
    const country = $el.find('country').text().trim();
    const impact  = $el.find('impact').text().trim();
    const dateStr = $el.find('date').text().trim();
    const timeStr = $el.find('time').text().trim();
    const forecast = $el.find('forecast').text().trim();
    const previous = $el.find('previous').text().trim();
    const actual   = $el.find('actual').text().trim();

    if (!title || impact === 'Holiday' || impact === 'Non-Economic') return;
    const ts = parseEventTime(dateStr, timeStr);
    const id = `ff-cal-${Buffer.from(title + dateStr).toString('base64').substring(0, 12)}`;
    if (seenIds.has(id)) return; // dedup across this/next week
    seenIds.add(id);

    rawEvs.push({
      id, timestamp: ts,
      time:     new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
      currency: country, impact, title, actual, forecast, previous,
    });

    // Feed items: only events within the 2-week window (current + next)
    if (ts < now - 24 * 3600 * 1000 || ts > now + windowMs) return;

    const isPast   = ts < now && actual;
    const isFuture = ts > now;
    if (isFuture && impact === 'Low') return;

    let headline;
    if (isPast) {
      const aNum = parseFloat(actual), fNum = parseFloat(forecast), pNum = parseFloat(previous);
      let arrow = '';
      if (!isNaN(aNum) && !isNaN(fNum))      arrow = aNum > fNum ? ' ↑' : aNum < fNum ? ' ↓' : '';
      else if (!isNaN(aNum) && !isNaN(pNum)) arrow = aNum > pNum ? ' ↑' : aNum < pNum ? ' ↓' : '';
      let hl = title;
      if (actual) {
        hl += ` ${actual}${arrow}`;
        if (forecast) hl += ` vs. Exp. ${forecast}`;
        if (previous) hl += ` (Prev. ${previous})`;
      }
      headline = hl;
    } else {
      const parts = [`[${country}] ${title}`, timeStr ? `@ ${timeStr}` : ''];
      if (forecast) parts.push(`Exp: ${forecast}`);
      if (previous) parts.push(`Prev: ${previous}`);
      headline = parts.filter(Boolean).join(' ');
    }

    const category  = detectCBFromTitle(title) || (actual ? currencyToCategory(country) : 'Economic Commentary');
    const impactTag = impact === 'High' ? 'High' : impact === 'Medium' ? 'Medium' : null;
    const descParts = [];
    if (actual)   descParts.push(`Actual: ${actual}`);
    if (forecast) descParts.push(`Expected: ${forecast}`);
    if (previous) descParts.push(`Previous: ${previous}`);

    items.push({
      id, timestamp: ts,
      time:        new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
      category,
      source:      'ForexFactory',
      headline:    headline.substring(0, 260),
      description: descParts.join(' | '),
      tags:        [category, country, ...(impactTag ? [impactTag] : [])].filter(Boolean),
      impact,                                      // 'High' | 'Medium' | 'Low' — utilisé pour le fond rouge High Impact
      priority:    impact === 'High' ? 'high' : 'normal',
    });
  });
}

// ─── Main scraper ─────────────────────────────────────────────────────────────
async function scrapeForexFactory() {
  // Return from in-memory cache if fresh
  const cached = fromMemCache();
  if (cached) return cached;

  try {
    const now     = Date.now();
    const twoWeeks = 14 * 24 * 3600 * 1000;

    // Fetch this week and next week in parallel
    const [resThis, resNext] = await Promise.allSettled([
      axios.get(CALENDAR_URL,      { headers: HEADERS, timeout: 10000, responseType: 'text' }),
      axios.get(CALENDAR_URL_NEXT, { headers: HEADERS, timeout: 10000, responseType: 'text' }),
    ]);

    const items  = [];
    const rawEvs = [];

    if (resThis.status === 'fulfilled') {
      const $ = cheerio.load(resThis.value.data, { xmlMode: true });
      parseCalendarXml($, items, rawEvs, now, twoWeeks);
    } else {
      console.warn('[ForexFactory] This-week fetch failed:', resThis.reason?.message);
    }

    if (resNext.status === 'fulfilled') {
      const $ = cheerio.load(resNext.value.data, { xmlMode: true });
      parseCalendarXml($, items, rawEvs, now, twoWeeks);
    } else {
      console.warn('[ForexFactory] Next-week fetch failed:', resNext.reason?.message);
    }

    if (items.length === 0 && rawEvs.length === 0) throw new Error('No events parsed');

    items.sort((a, b) => Math.abs(a.timestamp - now) - Math.abs(b.timestamp - now));
    const result = items.slice(0, 60);

    // Update caches
    _cache = { items: result, ts: Date.now() };
    _rawCalEvents = rawEvs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    saveDisk(result);
    try { fs.writeFileSync(RAW_CACHE_FILE, JSON.stringify({ ts: Date.now(), items: _rawCalEvents })); } catch {}

    console.log(`  [ForexFactory] ${result.length} feed events, ${rawEvs.length} raw calendar events (this+next week)`);
    return result;

  } catch (err) {
    const is429 = err.response?.status === 429;
    if (is429) console.warn('[ForexFactory] Rate-limited (429) — using cache');
    else        console.error('[ForexFactory]', err.message);

    // Try disk cache on any error
    const disk = loadDisk();
    if (disk) { _cache = { items: disk, ts: Date.now() - CACHE_TTL + 60000 }; return disk; }
    return _cache.items.length ? _cache.items : [];
  }
}

function getCalendarRaw() { return _rawCalEvents; }
module.exports = { scrapeForexFactory, getCalendarRaw };

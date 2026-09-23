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
/* ⚠️ UN CACHE QUI DOIT SURVIVRE À UN DÉPLOIEMENT VIT DANS UN VOLUME MONTÉ (16/09).
   `docker-compose.yml` ne monte que `/app/.chrome_profile_*` et `/app/data` ; tout le reste
   appartient à la couche d'image, que `docker compose build` détruit et reconstruit. Un fichier
   écrit à la RACINE du conteneur survit donc à un redémarrage, et à RIEN d'autre — or pousser sur
   main déploie, donc reconstruit. Le défaut avait été trouvé le 10/09 sur le cache du DMX, corrigé
   là, et déclaré clos : six jours plus tard le balayage automatique de `volume-verif` en a trouvé
   HUIT AUTRES, parce que le banc tenait une liste écrite à la main. La liste était le défaut.
   MIGRATION SANS PERTE : si l'ancien fichier existe encore et que le nouveau n'existe pas, on le
   recopie UNE fois. Idempotent, et tous les lecteurs existants continuent de marcher sans changer. */
const _DOSSIER_DONNEES = path.join(__dirname, '..', 'data');
try { fs.mkdirSync(_DOSSIER_DONNEES, { recursive: true }); } catch {}
function _migrerCache(neuf, ancien) {
  try { if (!fs.existsSync(neuf) && fs.existsSync(ancien)) fs.copyFileSync(ancien, neuf); } catch {}
  return neuf;
}
const CACHE_FILE        = _migrerCache(path.join(_DOSSIER_DONNEES, 'cache_ff.json'), path.join(__dirname, '..', 'cache_ff.json'));
const RAW_CACHE_FILE    = _migrerCache(path.join(_DOSSIER_DONNEES, 'cache_ff_raw.json'), path.join(__dirname, '..', 'cache_ff_raw.json'));
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
    // On précharge MÊME si périmé : un calendrier un peu daté vaut mieux qu'un calendrier
    // vide au démarrage ; le scrape planifié le rafraîchit ensuite.
    if (Array.isArray(raw.items) && raw.items.length > 0) {
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

function loadDisk(ignoreTtl = false) {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if ((ignoreTtl || Date.now() - raw.ts < DISK_TTL) && Array.isArray(raw.items) && raw.items.length > 0) {
      console.log(`  [ForexFactory] Using disk cache (${raw.items.length} events${ignoreTtl ? ', stale' : ''})`);
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
  if (/\bfed\b|fomc|\bpowell\b|federal reserve/.test(t)) return 'Fed';
  if (/\becb\b|\blagarde\b|european central bank|governing council/.test(t)) return 'ECB';
  if (/\bboe\b|bank of england|\bbailey\b/.test(t)) return 'BoE';
  if (/\bboj\b|bank of japan|\bueda\b/.test(t)) return 'BoJ';
  if (/\bboc\b|bank of canada|\bmacklem\b/.test(t)) return 'BoC';
  if (/\brba\b|reserve bank of australia/.test(t)) return 'RBA';
  if (/\bsnb\b|swiss national bank/.test(t)) return 'SNB';
  if (/\brbnz\b|reserve bank of new zealand/.test(t)) return 'RBNZ';
  return null;
}

/* ⚠️ L'HORLOGE DE CE FLUX EST EN UTC, PAS EN HEURE DE NEW YORK (16/09, capture user comparant notre
   calendrier à forexfactory.com). La ligne de commentaire disait « ForexFactory uses Eastern Time »
   et le code retranchait donc l'offset américain : chaque rendez-vous du flux atterrissait
   QUATRE HEURES TROP TARD l'été (cinq l'hiver). Mesuré sur l'archive servie, huit publications,
   quatre devises, réparties sur toute la journée, TOUTES décalées d'exactement +4 h :
     IPC britannique 08h00 Paris servi à 12h00 · IPC américain 14h30 servi à 18h30 · ISM 16h00 servi
     à 20h00 · BCE 14h15 servie à 18h15 · SNB 08h30 servie à 12h30 · RBNZ 04h00 servie à 08h00 ·
     PIB australien 03h30 servi à 07h30 · conférence de presse BCE 14h45 servie à 18h45.
   Lire l'horloge du flux comme de l'UTC replace les huit à la seconde près.
   CE DÉCALAGE EST LA CAUSE RACINE DE TROIS DÉFAUTS VISIBLES, pas d'un seul :
   1. LE DOUBLON. `_calFusionFF` (server.js) apparie une ligne FF à sa jumelle TradingView dans une
      fenêtre de ±90 min. À 240 min d'écart elles ne se reconnaissaient JAMAIS : la ligne FF entrait
      comme un événement de plus, et l'archive `_calHist` rejouait la ligne TradingView retirée.
      Deux « CPI y/y » le même jour, à quatre heures l'un de l'autre.
   2. LE RÉSULTAT FAUX. Faute d'appariement, le résultat de la ligne FF venait du rattrapage large de
      `_refreshTVActuals` (UN seul mot-clé commun suffit) : sur l'IPC britannique il a pris le chiffre
      du RPI publié à la même heure — « CPI y/y 3,4 % » au lieu de 3,1 %. Même mécanisme pour
      « CPI m/m 334.98 » (le NIVEAU de l'indice), « Official Cash Rate 25b » ou un pourcentage posé
      sur une conférence de presse.
   3. L'HEURE AFFICHÉE. Le desk annonçait 12h00 un rendez-vous de 08h00 — un client qui s'y fie rate
      la publication.
   NE PAS « CORRIGER » EN REMETTANT UN OFFSET : le rattrapage de fuseau de `_refreshTVActuals`
   (médiane des écarts, liste d'essais contenant -4 h et -5 h) est né de ce défaut, pas l'inverse.
   Banc : scripts/calendrier-verif.js — il JOUE cette fonction sur les huit publications mesurées. */
function parseEventTime(dateStr, timeStr) {
  try {
    // dateStr: "MM-DD-YYYY", timeStr: "6:29am" — horloge UTC (mesuré, cf. bloc ci-dessus)
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

    const iso = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}T${String(hh).padStart(2,'0')}:${String(min).padStart(2,'0')}:00Z`;
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
    const eventUrl = $el.find('url').text().trim();   // page FF de l'événement (Specs + History au clic)

    if (!title || impact === 'Holiday' || impact === 'Non-Economic') return;
    const ts = parseEventTime(dateStr, timeStr);
    const id = `ff-cal-${Buffer.from(title + dateStr).toString('base64').substring(0, 12)}`;
    if (seenIds.has(id)) return; // dedup across this/next week
    seenIds.add(id);

    rawEvs.push({
      id, timestamp: ts,
      time:     new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
      currency: country, impact, title, actual, forecast, previous,
      url: eventUrl,
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

    const items  = [];
    const rawEvs = [];

    // "thisweek" est le SEUL flux encore servi par le miroir (nextweek/lastweek → 404).
    // On le récupère ; en cas d'échec (429/timeout) on bascule sur le cache disque.
    const resThis = await axios.get(CALENDAR_URL, { headers: HEADERS, timeout: 10000, responseType: 'text', validateStatus: s => s === 200 });
    const $this = cheerio.load(resThis.data, { xmlMode: true });
    parseCalendarXml($this, items, rawEvs, now, twoWeeks);

    // "nextweek" : best-effort, totalement silencieux (le miroir renvoie 404 actuellement).
    // Si le flux revient un jour, ses événements seront automatiquement intégrés.
    try {
      const resNext = await axios.get(CALENDAR_URL_NEXT, { headers: HEADERS, timeout: 8000, responseType: 'text', validateStatus: s => s === 200 });
      const $next = cheerio.load(resNext.data, { xmlMode: true });
      parseCalendarXml($next, items, rawEvs, now, twoWeeks);
    } catch { /* flux nextweek indisponible (404) — ignoré */ }

    if (items.length === 0 && rawEvs.length === 0) throw new Error('No events parsed');

    items.sort((a, b) => Math.abs(a.timestamp - now) - Math.abs(b.timestamp - now));
    const result = items.slice(0, 60);

    // Update caches
    _cache = { items: result, ts: Date.now() };
    _rawCalEvents = rawEvs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    saveDisk(result);
    try { fs.writeFileSync(RAW_CACHE_FILE, JSON.stringify({ ts: Date.now(), items: _rawCalEvents })); } catch {}

    console.log(`  [ForexFactory] ${result.length} feed events, ${rawEvs.length} raw calendar events`);
    return result;

  } catch (err) {
    const is429 = err.response?.status === 429;
    if (is429) console.warn('[ForexFactory] Rate-limited (429) — using cache');
    else        console.error('[ForexFactory]', err.message);

    // Cache disque : d'abord le frais, puis (dernier recours) le PÉRIMÉ — un calendrier
    // un peu daté reste préférable à un calendrier vide. Le scrape suivant le rafraîchira.
    const disk = loadDisk() || loadDisk(true);
    if (disk) { _cache = { items: disk, ts: Date.now() - CACHE_TTL + 60000 }; return disk; }
    return _cache.items.length ? _cache.items : [];
  }
}

function getCalendarRaw() { return _rawCalEvents; }
// `parseEventTime` est exporté POUR LE BANC (scripts/calendrier-verif.js). On l'expose plutôt que de
// le laisser extraire du source : une borne d'extraction est un contrat qu'un simple déplacement
// casse (leçon du 10/09 sur `tactile-verif`), alors qu'un export suit la fonction où qu'elle aille.
module.exports = { scrapeForexFactory, getCalendarRaw, parseEventTime };

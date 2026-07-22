/**
 * TradingView Economic Calendar — actual/forecast/previous en HTTP simple (PAS de Cloudflare).
 * Source fiable pour remplir la colonne ACTUAL du calendrier (mêmes valeurs que ForexFactory).
 * Endpoint public utilisé par le widget TradingView.
 */
const axios = require('axios');

// Pays TradingView → devise (les pays de la zone euro → EUR)
const CC2CCY = {
  US: 'USD', EU: 'EUR', GB: 'GBP', JP: 'JPY', AU: 'AUD', NZ: 'NZD',
  CA: 'CAD', CH: 'CHF', CN: 'CNY',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', PT: 'EUR',
  GR: 'EUR', IE: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR',
};
const COUNTRIES = 'US,EU,GB,JP,AU,NZ,CA,CH,CN,DE,FR,IT,ES,NL,PT,GR,IE,BE,AT,FI';
const TTL = 5 * 60 * 1000;   // 5 min
let _cache = { ts: 0, events: [] };

// Formate la valeur comme ForexFactory : 57.3 | -0.3% | 122K | -8.0M | 3.2B
function _fmt(val, unit, scale) {
  if (val == null) return '';
  let s = String(Math.round(val * 1e6) / 1e6);          // enlève le bruit flottant
  if (scale && /^[kmbt]$/i.test(scale)) return s + scale.toUpperCase();
  if (unit === '%') return s + '%';
  return s;
}

async function fetchTVCalendar() {
  if (Date.now() - _cache.ts < TTL && _cache.events.length) return _cache.events;
  const now = Date.now();
  const from = new Date(now - 5 * 86400000).toISOString();
  const to   = new Date(now + 2 * 86400000).toISOString();
  const url  = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=${COUNTRIES}`;
  try {
    const r = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Origin': 'https://www.tradingview.com',
        'Referer': 'https://www.tradingview.com/',
        'Accept': 'application/json',
      },
    });
    const items = Array.isArray(r.data) ? r.data : (r.data && r.data.result) || [];
    const events = items
      .filter(e => e && e.title && e.actual != null)         // uniquement ceux qui ONT un actual
      .map(e => ({
        currency: CC2CCY[e.country] || e.country,
        country:  e.country || '',   // pays d'ORIGINE conservé (DE/FR/ES… sous EUR) → étiquetage zone euro côté desk
        title:    String(e.title),
        actual:   _fmt(e.actual,   e.unit, e.scale),
        forecast: e.forecast != null ? _fmt(e.forecast, e.unit, e.scale) : '',
        previous: e.previous != null ? _fmt(e.previous, e.unit, e.scale) : '',
        ts:       new Date(e.date).getTime(),
      }))
      .filter(e => e.actual && Number.isFinite(e.ts));
    if (events.length) {
      _cache = { ts: Date.now(), events };
      console.log(`[TVCalendar] ${events.length} événements avec actual`);
    }
    return _cache.events;
  } catch (e) {
    console.error('[TVCalendar]', e.response ? e.response.status : e.message);
    return _cache.events;
  }
}

// Importance TradingView → impact façon ForexFactory
function _impact(imp) {
  if (imp == null) return 'Medium';
  const n = Number(imp);
  if (n >= 1) return 'High';
  if (n <= -1) return 'Low';
  const s = String(imp).toLowerCase();
  if (s === 'high') return 'High';
  if (s === 'low')  return 'Low';
  return 'Medium';
}

// Mapping COMMUN (complet + plage) : brut TradingView → événement { currency, title, impact, actual, forecast, previous, ts }, trié.
function _mapFull(items) {
  return items
    .filter(e => e && e.title && e.date)
    .map(e => ({
      currency: CC2CCY[e.country] || e.country,
      country:  e.country || '',   // pays d'ORIGINE (DE/FR/ES… sous EUR) → étiquetage zone euro côté desk
      title:    String(e.title),
      impact:   _impact(e.importance),
      actual:   e.actual   != null ? _fmt(e.actual,   e.unit, e.scale) : '',
      forecast: e.forecast != null ? _fmt(e.forecast, e.unit, e.scale) : '',
      previous: e.previous != null ? _fmt(e.previous, e.unit, e.scale) : '',
      ts:       new Date(e.date).getTime(),
    }))
    .filter(e => e.currency && Number.isFinite(e.ts))
    .sort((a, b) => a.ts - b.ts);
}

// Calendrier COMPLET TradingView : TOUS les events (passés ET futurs) avec actual/forecast/previous
// + importance, sur une fenêtre LARGE (35 j passé → 14 j futur). Source DIRECTE des actuals →
// aucun matching, donc la colonne ACTUAL est exacte et couvre aussi les anciennes données.
let _fullCache = { ts: 0, events: [] };
async function fetchTVCalendarFull() {
  if (Date.now() - _fullCache.ts < TTL && _fullCache.events.length) return _fullCache.events;
  const now = Date.now();
  const from = new Date(now - 21 * 86400000).toISOString();   // 3 semaines passées (anciennes données)
  const to   = new Date(now + 10 * 86400000).toISOString();   // 10 jours à venir
  const url  = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=${COUNTRIES}`;
  try {
    const r = await axios.get(url, {
      timeout: 14000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Origin': 'https://www.tradingview.com',
        'Referer': 'https://www.tradingview.com/',
        'Accept': 'application/json',
      },
    });
    const items = Array.isArray(r.data) ? r.data : (r.data && r.data.result) || [];
    const events = _mapFull(items);
    if (events.length) {
      _fullCache = { ts: Date.now(), events };
      console.log(`[TVCalendar] complet : ${events.length} événements (${events.filter(e => e.actual).length} avec actual)`);
    }
    return _fullCache.events;
  } catch (e) {
    console.error('[TVCalendar full]', e.response ? e.response.status : e.message);
    return _fullCache.events;
  }
}

// Calendrier sur une PLAGE PERSONNALISÉE (from/to ISO) : mêmes champs que le complet, mais bornes fournies.
// Utilisé par la navigation historique du desk (flèches ‹ ›, jusqu'à 3 mois en arrière). Cache court par plage.
const _rangeCache = new Map();   // "from|to" → { ts, events }
async function fetchTVCalendarRange(fromISO, toISO) {
  const key = fromISO + '|' + toISO;
  const hit = _rangeCache.get(key);
  if (hit && Date.now() - hit.ts < TTL && hit.events.length) return hit.events;
  const url = `https://economic-calendar.tradingview.com/events?from=${fromISO}&to=${toISO}&countries=${COUNTRIES}`;
  try {
    const r = await axios.get(url, {
      timeout: 16000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Origin': 'https://www.tradingview.com',
        'Referer': 'https://www.tradingview.com/',
        'Accept': 'application/json',
      },
    });
    const items = Array.isArray(r.data) ? r.data : (r.data && r.data.result) || [];
    const events = _mapFull(items);
    if (events.length) {
      _rangeCache.set(key, { ts: Date.now(), events });
      if (_rangeCache.size > 8) { const oldest = [..._rangeCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]; if (oldest) _rangeCache.delete(oldest[0]); }
      console.log(`[TVCalendar] plage ${fromISO.slice(0, 10)}→${toISO.slice(0, 10)} : ${events.length} événements`);
    }
    return (_rangeCache.get(key) || { events: [] }).events;
  } catch (e) {
    console.error('[TVCalendar range]', e.response ? e.response.status : e.message);
    return (hit && hit.events) || [];
  }
}

module.exports = { fetchTVCalendar, fetchTVCalendarFull, fetchTVCalendarRange };

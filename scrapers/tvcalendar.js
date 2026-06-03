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

module.exports = { fetchTVCalendar };

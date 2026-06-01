/**
 * COT — Commitment of Traders (multi-type)
 * Non-Commercial: CFTC Legacy Futures Only (jun7-fc8e)
 * Dealer / Asset Mgr / Leveraged / Other: CFTC TFF Futures Only (gpe5-46if)
 * Cache: 6 h per type.
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// CME currency futures contract codes (shared across both CFTC endpoints)
const FX_CONTRACTS = [
  { key: 'EUR', code: '099741', search: 'EURO FX' },
  { key: 'GBP', code: '096742', search: 'BRITISH POUND' },
  { key: 'JPY', code: '097741', search: 'JAPANESE YEN' },
  { key: 'CHF', code: '092741', search: 'SWISS FRANC' },
  { key: 'CAD', code: '090741', search: 'CANADIAN DOLLAR' },
  { key: 'AUD', code: '232741', search: 'AUSTRALIAN DOLLAR' },
  { key: 'NZD', code: '112741', search: 'NEW ZEALAND DOLLAR' },
];

const TYPE_CONFIG = {
  noncomm:    { longCol: 'noncomm_positions_long_all',    shortCol: 'noncomm_positions_short_all',    endpoint: 'jun7-fc8e', label: 'Non-Commercial' },
  dealer:     { longCol: 'dealer_positions_long_all',  shortCol: 'dealer_positions_short_all',  endpoint: 'gpe5-46if', label: 'Dealer/Intermediary' },
  asset_mgr:  { longCol: 'asset_mgr_positions_long',   shortCol: 'asset_mgr_positions_short',   endpoint: 'gpe5-46if', label: 'Asset Manager' },
  lev_money:  { longCol: 'lev_money_positions_long',   shortCol: 'lev_money_positions_short',   endpoint: 'gpe5-46if', label: 'Leveraged Funds' },
  other_rept: { longCol: 'other_rept_positions_long',  shortCol: 'other_rept_positions_short',  endpoint: 'gpe5-46if', label: 'Other Reportables' },
};

const VALID_TYPES = Object.keys(TYPE_CONFIG);

let _cache = {}; // { [type]: { data, ts } }

function getCacheFile(type) {
  return path.join(__dirname, '..', `cache_cot_${type}.json`);
}

function saveDisk(type, data) {
  try { fs.writeFileSync(getCacheFile(type), JSON.stringify({ ts: Date.now(), data })); } catch {}
}

function loadDisk(type) {
  try {
    const raw = JSON.parse(fs.readFileSync(getCacheFile(type), 'utf8'));
    if (Date.now() - raw.ts < CACHE_TTL && Array.isArray(raw.data) && raw.data.length > 0)
      return raw.data;
  } catch {}
  return null;
}

async function fetchCOTData(type = 'noncomm') {
  if (!VALID_TYPES.includes(type)) type = 'noncomm';

  if (_cache[type] && Date.now() - _cache[type].ts < CACHE_TTL) return _cache[type].data;

  const disk = loadDisk(type);
  if (disk) { _cache[type] = { data: disk, ts: Date.now() }; return disk; }

  const cfg = TYPE_CONFIG[type];

  try {
    const codes = FX_CONTRACTS.map(c => `'${c.code}'`).join(',');
    const url = `https://publicreporting.cftc.gov/resource/${cfg.endpoint}.json`
      + `?$select=market_and_exchange_names,cftc_contract_market_code`
      + `,report_date_as_yyyy_mm_dd,${cfg.longCol},${cfg.shortCol}`
      + `&$where=cftc_contract_market_code in(${codes})`
      + `&$order=report_date_as_yyyy_mm_dd DESC`
      + `&$limit=21`;

    const r = await axios.get(url, { timeout: 20000, headers: { Accept: 'application/json' } });
    if (!Array.isArray(r.data) || r.data.length === 0) throw new Error('Empty CFTC response');

    // Latest row per contract code
    const byCode = {};
    for (const row of r.data) {
      const c = row.cftc_contract_market_code;
      if (!byCode[c] || row.report_date_as_yyyy_mm_dd > byCode[c].report_date_as_yyyy_mm_dd)
        byCode[c] = row;
    }

    let latestDate = '';
    let usdCalcLong = 0, usdCalcShort = 0;
    const result = [];

    for (const c of FX_CONTRACTS) {
      let row = byCode[c.code];
      if (!row) {
        row = Object.values(byCode).find(r =>
          (r.market_and_exchange_names || '').toUpperCase().includes(c.search));
      }
      if (!row) { console.warn(`[COT/${type}] ${c.key} not found`); continue; }

      const longPos  = parseInt(row[cfg.longCol])  || 0;
      const shortPos = parseInt(row[cfg.shortCol]) || 0;
      const total    = longPos + shortPos;
      if (total === 0) continue;

      const longPct  = Math.round(longPos / total * 100);
      const shortPct = 100 - longPct;
      const net      = longPos - shortPos;

      if (row.report_date_as_yyyy_mm_dd > latestDate) latestDate = row.report_date_as_yyyy_mm_dd;

      usdCalcLong  += shortPos;
      usdCalcShort += longPos;

      result.push({
        key: c.key, longPct, shortPct, net, longPos, shortPos,
        sentiment:  net > 0 ? 'Bullish' : net < 0 ? 'Bearish' : 'Neutral',
        reportDate: row.report_date_as_yyyy_mm_dd,
      });
    }

    // Derived USD (inverse aggregate of other currencies)
    const usdTotal = usdCalcLong + usdCalcShort;
    if (usdTotal > 0) {
      const usdLongPct = Math.round(usdCalcLong / usdTotal * 100);
      result.push({
        key: 'USD', longPct: usdLongPct, shortPct: 100 - usdLongPct,
        net: usdCalcLong - usdCalcShort, longPos: usdCalcLong, shortPos: usdCalcShort,
        sentiment: usdCalcLong > usdCalcShort ? 'Bullish' : 'Bearish',
        reportDate: latestDate, derived: true,
      });
    }

    console.log(`[COT/${type}] ${result.length} currencies (report: ${latestDate})`);
    _cache[type] = { data: result, ts: Date.now() };
    saveDisk(type, result);
    return result;
  } catch (err) {
    console.error(`[COT/${type}]`, err.message);
    return loadDisk(type) || [];
  }
}

module.exports = { fetchCOTData };

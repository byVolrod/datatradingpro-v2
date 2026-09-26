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
/* ⚠️ LE COT EST « À JOUR » QUAND ON A LE DERNIER RAPPORT PARU, PAS QUAND LE CACHE EST JEUNE (26/09).
   La CFTC publie le VENDREDI à 15 h 30, heure de New York, les positions arrêtées au MARDI précédent.
   Un cache aveugle de 6 h, rempli à 15 h 25, gardait le rapport de la semaine d'avant jusqu'à 21 h 25 ;
   et un vendredi de publication décalée, rien ne relisait avant le passage suivant. On calcule donc le
   rapport ATTENDU à l'instant présent : tant que celui en main est plus ancien, le cache ne vaut que
   RELANCE (quinze minutes) ; dès qu'il est le bon, il retrouve ses six heures. Une semaine calme ne
   coûte donc rien de plus, et le vendredi soir le nouveau rapport arrive dans le quart d'heure. */
const RELANCE = 15 * 60 * 1000;
const _JOURS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function rapportAttendu(now) {
  now = now || Date.now();
  let an, mois, jour, js, minutes;
  try {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(new Date(now)).forEach(x => { p[x.type] = x.value; });
    an = +p.year; mois = +p.month; jour = +p.day; js = _JOURS[p.weekday]; minutes = (+p.hour % 24) * 60 + +p.minute;
  } catch (e) {
    const d = new Date(now - 4 * 3600e3);   // repli sans fuseau : heure d'été de New York
    an = d.getUTCFullYear(); mois = d.getUTCMonth() + 1; jour = d.getUTCDate(); js = d.getUTCDay(); minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  let depuisVendredi = (js - 5 + 7) % 7;
  if (depuisVendredi === 0 && minutes < 15 * 60 + 30) depuisVendredi = 7;
  return new Date(Date.UTC(an, mois - 1, jour) - (depuisVendredi + 3) * 864e5).toISOString().slice(0, 10);
}
// Date (AAAA-MM-JJ) du rapport le plus récent d'une liste : la CFTC renvoie « 2026-09-22T00:00:00.000 ».
const _jourRapport = d => String(d || '').slice(0, 10);
function _dernierRapport(data) {
  return (Array.isArray(data) ? data : []).reduce((m, x) => { const d = _jourRapport(x && x.reportDate); return d > m ? d : m; }, '');
}
const _ttlDe = (dernier, now) => (dernier && dernier >= rapportAttendu(now) ? CACHE_TTL : RELANCE);

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

/* ⚠️ UN CACHE QUI DOIT SURVIVRE À UN DÉPLOIEMENT VIT DANS UN VOLUME MONTÉ (16/09).
   `docker-compose.yml` ne monte que `/app/.chrome_profile_*` et `/app/data` : un fichier écrit à
   la racine du conteneur survit à un redémarrage, et à RIEN d'autre — or pousser sur main déploie,
   donc reconstruit. Ce cache-ci est PLUS qu'un confort : `fetchCOTData` s'en sert de REPLI quand la
   CFTC ne répond pas (`return loadDisk(type) || []`). À la racine, ce repli était vide après chaque
   livraison : une panne de la source juste après un déploiement rendait le positionnement
   entièrement muet, au lieu de servir le dernier rapport connu.
   Ce chemin est FABRIQUÉ PAR UNE FONCTION, et c'est par là qu'il avait échappé au balayage du banc
   pendant six jours : celui-ci ne regardait que les constantes. Il regarde désormais les deux. */
const _DOSSIER_DONNEES = path.join(__dirname, '..', 'data');
try { fs.mkdirSync(_DOSSIER_DONNEES, { recursive: true }); } catch {}
function getCacheFile(type) {
  const neuf = path.join(_DOSSIER_DONNEES, `cache_cot_${type}.json`);
  // Migration sans perte : l'ancien fichier, s'il existe encore, est recopié UNE fois.
  try {
    const ancien = path.join(__dirname, '..', `cache_cot_${type}.json`);
    if (!fs.existsSync(neuf) && fs.existsSync(ancien)) fs.copyFileSync(ancien, neuf);
  } catch {}
  return neuf;
}

function saveDisk(type, data) {
  try { fs.writeFileSync(getCacheFile(type), JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// `repli` : lecture de SECOURS (la CFTC ne répond pas) → le dernier rapport connu, quel que soit son
// âge. Un repli qui expire rend le positionnement muet au pire moment ; un rapport d'une semaine
// reste une vraie donnée, datée comme telle à l'écran.
function loadDisk(type, repli) {
  try {
    const raw = JSON.parse(fs.readFileSync(getCacheFile(type), 'utf8'));
    if (!Array.isArray(raw.data) || !raw.data.length) return null;
    if (repli || Date.now() - raw.ts < _ttlDe(_dernierRapport(raw.data))) return raw.data;
  } catch {}
  return null;
}

const _enCours = {};   // une seule lecture CFTC par type à la fois (512 Mo : pas de rafale en parallèle)
async function fetchCOTData(type = 'noncomm') {
  if (!VALID_TYPES.includes(type)) type = 'noncomm';

  if (_cache[type] && Date.now() - _cache[type].ts < _ttlDe(_dernierRapport(_cache[type].data))) return _cache[type].data;

  if (!_cache[type]) {
    const disk = loadDisk(type);
    if (disk) { _cache[type] = { data: disk, ts: Date.now() }; return disk; }
  }
  if (_enCours[type]) return _enCours[type];
  _enCours[type] = _lireCOT(type).finally(() => { delete _enCours[type]; });
  return _enCours[type];
}
async function _lireCOT(type) {
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
    // Dernier rapport connu (mémoire, puis disque, sans limite d'âge) ; horodaté MAINTENANT pour ne
    // pas relancer à chaque requête : s'il est en retard sur le rapport attendu, son cache ne vaut
    // que RELANCE, donc on retente dans le quart d'heure.
    const repli = (_cache[type] && _cache[type].data) || loadDisk(type, true) || [];
    if (repli.length) _cache[type] = { data: repli, ts: Date.now() };
    return repli;
  }
}


/* ═══ HISTORIQUE COT PAR DEVISE (V3, vue paire en grille — 24/09) ════════════════════════════════════
   Même source officielle et gratuite (CFTC Public Reporting), mêmes colonnes que le dernier rapport,
   mais sur N semaines : position nette, longs, shorts, par devise, avec l'USD dérivé comme partout
   ailleurs (agrégat inverse des six autres, date par date). UNE requête pour les 7 contrats, gardée
   12 h en mémoire (le rapport est hebdomadaire). Semaines plafonnées à 780 (15 ans). */
const _histo = {};   // "type|semaines" → { ts, data }
/* Colonnes COMPLÉMENTAIRES du tableau détaillé (intérêt ouvert, spreads, nombre de traders). Elles ne
   sont demandées qu'en PLUS : si la CFTC renomme ou refuse l'une d'elles (400), la lecture retombe sur
   longs / shorts seuls — le tableau perd des colonnes, jamais l'historique. Les variations et les % de
   l'intérêt ouvert se CALCULENT côté client à partir de ces valeurs : rien n'est recopié deux fois. */
const HISTO_EXTRA = {
  noncomm:    { oi: 'open_interest_all', spread: 'noncomm_postions_spread_all', tl: 'traders_noncomm_long_all', ts: 'traders_noncomm_short_all', tsp: 'traders_noncomm_spread_all', tt: 'traders_tot_all' },
  lev_money:  { oi: 'open_interest_all', spread: 'lev_money_positions_spread', tl: 'traders_lev_money_long_all', ts: 'traders_lev_money_short_all', tsp: 'traders_lev_money_spread', tt: 'traders_tot_all' },
  asset_mgr:  { oi: 'open_interest_all', spread: 'asset_mgr_positions_spread', tl: 'traders_asset_mgr_long_all', ts: 'traders_asset_mgr_short_all', tsp: 'traders_asset_mgr_spread', tt: 'traders_tot_all' },
  dealer:     { oi: 'open_interest_all', spread: 'dealer_positions_spread_all', tl: 'traders_dealer_long_all', ts: 'traders_dealer_short_all', tsp: 'traders_dealer_spread_all', tt: 'traders_tot_all' },
  other_rept: { oi: 'open_interest_all', spread: 'other_rept_positions_spread', tl: 'traders_other_rept_long_all', ts: 'traders_other_rept_short', tsp: 'traders_other_rept_spread', tt: 'traders_tot_all' },
};
const _entier = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
function _histoDepuisLignes(rows, cfg, extra) {
  const parDate = {};
  for (const row of rows) {
    const c = FX_CONTRACTS.find(x => x.code === row.cftc_contract_market_code);
    if (!c) continue;
    const date = String(row.report_date_as_yyyy_mm_dd || '').slice(0, 10);
    if (!date) continue;
    const l = parseInt(row[cfg.longCol]) || 0, s = parseInt(row[cfg.shortCol]) || 0;
    const o = { long: l, short: s, net: l - s };
    if (extra) for (const k of Object.keys(extra)) { const v = _entier(row[extra[k]]); if (v != null) o[k] = v; }
    (parDate[date] = parDate[date] || {})[c.key] = o;
  }
  const dates = Object.keys(parDate).sort();
  const out = {};
  for (const d of dates) {
    const j = parDate[d];
    for (const k of Object.keys(j)) (out[k] = out[k] || []).push(Object.assign({ date: d }, j[k]));
    // USD dérivé : seulement si les SIX autres devises sont publiées ce jour-là (sinon l'agrégat mentirait).
    const autres = FX_CONTRACTS.map(c => j[c.key]).filter(Boolean);
    if (autres.length === FX_CONTRACTS.length) {
      const l = autres.reduce((a, x) => a + x.short, 0), s = autres.reduce((a, x) => a + x.long, 0);
      (out.USD = out.USD || []).push({ date: d, long: l, short: s, net: l - s });
    }
  }
  return out;
}
// Date du rapport le plus récent d'un historique { EUR: [{ date }…], … } (séries triées par date).
function _histoDernier(h) {
  let m = '';
  for (const k of Object.keys(h || {})) { const s = h[k]; const d = s && s.length ? s[s.length - 1].date : ''; if (d > m) m = d; }
  return m;
}
async function fetchCOTHistory(type = 'noncomm', semaines = 260) {
  if (!VALID_TYPES.includes(type)) type = 'noncomm';
  const n = Math.max(8, Math.min(780, parseInt(semaines, 10) || 260));
  const k = type + '|' + n;
  if (_histo[k] && Date.now() - _histo[k].ts < (_histoDernier(_histo[k].data) >= rapportAttendu() ? 12 * 3600e3 : RELANCE)) return _histo[k].data;
  const cfg = TYPE_CONFIG[type];
  const extra = HISTO_EXTRA[type] || null;
  const codes = FX_CONTRACTS.map(c => `'${c.code}'`).join(',');
  const url = cols => `https://publicreporting.cftc.gov/resource/${cfg.endpoint}.json`
    + `?$select=cftc_contract_market_code,report_date_as_yyyy_mm_dd,${cols.join(',')}`
    + `&$where=cftc_contract_market_code in(${codes})`
    + `&$order=report_date_as_yyyy_mm_dd DESC&$limit=${n * FX_CONTRACTS.length + 20}`;
  const base = [cfg.longCol, cfg.shortCol];
  try {
    let r, avecExtra = !!extra;
    try {
      r = await axios.get(url(extra ? base.concat([...new Set(Object.values(extra))]) : base), { timeout: 25000, headers: { Accept: 'application/json' } });
    } catch (e) {
      if (!(extra && e.response && e.response.status === 400)) throw e;
      avecExtra = false;   // une colonne complémentaire refusée : on garde l'essentiel
      r = await axios.get(url(base), { timeout: 25000, headers: { Accept: 'application/json' } });
    }
    if (!Array.isArray(r.data) || !r.data.length) throw new Error('réponse CFTC vide');
    const data = _histoDepuisLignes(r.data, cfg, avecExtra ? extra : null);
    _histo[k] = { ts: Date.now(), data };
    return data;
  } catch (e) {
    if (_histo[k]) return _histo[k].data;   // dernière lecture connue plutôt que rien
    throw e;
  }
}

module.exports = { fetchCOTData, fetchCOTHistory, _histoDepuisLignes, HISTO_EXTRA, VALID_TYPES, TYPE_CONFIG, rapportAttendu, _dernierRapport };

/**
 * tradingeconomics.com — données fondamentales RÉELLES par pays (valeur actuelle + précédente), 0 IA.
 * ------------------------------------------------------------------------------------------------
 * Le Smart Bias « Fundamental Data » se basait sur le CALENDRIER (surprise vs prévision, 1 seul event
 * récent par catégorie) → ÉPARS et peu fiable (ex. NZD noté sur 1 publication). On lit désormais la page
 * /<pays>/indicators de TradingEconomics (HTML statique, sans Cloudflare) : elle porte la valeur ACTUELLE
 * et PRÉCÉDENTE de CHAQUE indicateur → notation fiable, toujours renseignée, pour les 8 catégories fondamentales.
 *
 * Notation : PMI = NIVEAU vs 50 (expansion/contraction) ; autres = TENDANCE (dernier vs précédent), la
 * hausse étant haussière pour la devise (économie plus forte / banque centrale plus hawkish). Caché 8 h
 * (TE bouge ~quotidiennement), fetch en tâche de fond, échec silencieux (jamais d'exception).
 */
const axios = require('axios');
const cheerio = require('cheerio');

const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TTL = 8 * 60 * 60 * 1000;   // 8 h

const COUNTRY = { USD: 'united-states', EUR: 'euro-area', GBP: 'united-kingdom', CAD: 'canada', AUD: 'australia', NZD: 'new-zealand', JPY: 'japan', CHF: 'switzerland' };
// Catégories fondamentales alignées sur le PDF « Learning Economics News » (familles Inflation / Emploi /
// Croissance). MÊMES libellés que _SB_FUND_SUBS (server.js) = clé de jointure. NFP/PCE/PPI sont US-only →
// par devise on utilise l'équivalent TradingEconomics par pays (inflation, chômage, salaires, PIB, ventes, PMI).
const CATS = [
  { key: 'Inflation (CPI)',    re: /^Inflation Rate$/i,                              mode: 'trend' },   // inflation en hausse → hawkish → haussier devise
  { key: 'Emploi (chômage)',   re: /^Unemployment Rate$/i,                           mode: 'inv'   },   // chômage en HAUSSE → dovish → BAISSIER devise (inversé)
  { key: 'Salaires',           re: /^Wages$|^Wage Growth$|Average Hourly Earnings/i, mode: 'trend' },   // salaires en hausse → pression inflationniste → haussier
  { key: 'Croissance (PIB)',   re: /^GDP Growth Rate$|^GDP Annual Growth Rate$/i,    mode: 'trend' },
  { key: 'Ventes au détail',   re: /^Retail Sales MoM$|^Retail Sales YoY$/i,         mode: 'trend' },
  { key: 'PMI Manufacturier',  re: /Manufacturing PMI/i,                             mode: 'pmi'   },
  { key: 'PMI Services',       re: /Services PMI/i,                                  mode: 'pmi'   },
];

/* ── MARCHÉS : le rendement souverain, lu SUR LA PAGE DÉJÀ CHARGÉE (16/09) ──────────────────────
   La page /<pays>/indicators porte, dans son bloc « Markets », le rendement de l'emprunt d'État à
   10 ans et le taux directeur. `_fetchCountry` INDEXAIT DÉJÀ ces lignes (son index couvre tous les
   `<tr>` à trois cellules) puis les jetait, faute de quelqu'un pour les demander. On les lève donc
   SANS UN SEUL APPEL RÉSEAU DE PLUS : même page, même cache de 8 h, même chemin éprouvé en
   production depuis que le Radar de Biais s'en nourrit.
   POURQUOI CETTE SOURCE ET PAS UNE AUTRE : les flux de rendements gratuits (Stooq, FRED, portail
   BCE) demandent chacun un nouveau chemin réseau qu'il faudrait éprouver en production avant d'y
   confier un chiffre affiché. Ici le chemin est déjà éprouvé. Le jour où l'on voudra le 2 ans et le
   30 ans, ce sera une vraie source à ajouter, avec sa vérification.
   ⚠️ ABSENCE ASSUMÉE : si TradingEconomics cesse de publier la ligne, la valeur vaut `null` et le
   desk le DIT. On n'invente jamais un rendement, et on ne ressert pas le dernier connu sous une
   date d'aujourd'hui : un taux périmé se lit exactement comme un taux frais. */
const MARCHES = [
  { key: 'oblig10', re: /^Government Bond 10Y$/i, re2: /government bond 10/i },
  { key: 'directeur', re: /^Interest Rate$/i, re2: /^central bank rate$/i },
];

const _num = v => { const x = parseFloat(String(v == null ? '' : v).replace(/[, ]/g, '').replace(/[^0-9.\-]/g, '')); return isNaN(x) ? null : x; };
function _rate(mode, last, prev) {
  const L = _num(last), P = _num(prev);
  if (L == null) return null;
  if (mode === 'pmi') return L >= 52 ? 'Very Bullish' : L >= 50 ? 'Bullish' : L >= 48 ? 'Bearish' : 'Very Bearish';   // ligne des 50
  if (P == null || Math.abs(L - P) < 1e-9) return 'Neutral';
  const rel = P !== 0 ? Math.abs((L - P) / P) : 1;
  const strong = rel >= 0.30 && Math.abs(L - P) >= 0.3;   // mouvement marqué → « Very » (plancher absolu : évite le « Very » sur un PIB quasi nul)
  const up = L > P;
  // mode 'inv' (chômage) : une HAUSSE est BAISSIERE pour la devise (marché du travail qui se degrade → dovish).
  if (mode === 'inv') return up ? (strong ? 'Very Bearish' : 'Bearish') : (strong ? 'Very Bullish' : 'Bullish');
  return up ? (strong ? 'Very Bullish' : 'Bullish') : (strong ? 'Very Bearish' : 'Bearish');
}

const _SC = { 'Very Bullish': 2, 'Bullish': 1, 'Neutral': 0, 'Bearish': -1, 'Very Bearish': -2 };
function _parent(subs) {
  let s = 0, n = 0; subs.forEach(x => { if (_SC[x.value] != null && x.value !== 'Neutral') { s += _SC[x.value]; n++; } else if (x.value === 'Neutral') { n++; } });
  const a = n ? s / n : 0;
  return a >= 1.4 ? 'Very Bullish' : a >= 0.35 ? 'Bullish' : a <= -1.4 ? 'Very Bearish' : a <= -0.35 ? 'Bearish' : 'Neutral';
}

const _cache = {}, _busy = {};
async function _fetchCountry(slug) {
  const r = await axios.get('https://tradingeconomics.com/' + slug + '/indicators', { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en' }, timeout: 20000, validateStatus: s => s < 500 });
  if (r.status !== 200 || typeof r.data !== 'string') return null;
  const $ = cheerio.load(r.data);
  const idx = new Map();   // nom indicateur → {last, prev} (1re occurrence)
  $('tr').each((_, tr) => {
    const tds = $(tr).find('td'); if (tds.length < 3) return;
    const name = $(tds[0]).text().replace(/\s+/g, ' ').trim();
    const last = $(tds[1]).text().trim(), prev = $(tds[2]).text().trim();
    if (name && last && !idx.has(name)) idx.set(name, { last, prev });
  });
  if (!idx.size) return null;
  const names = [...idx.keys()];
  // Les lignes « Markets » de la MÊME page (cf. MARCHES ci-dessus) : aucune requête de plus.
  const marches = {};
  for (const m of MARCHES) {
    const nm = names.find(n => m.re.test(n)) || names.find(n => m.re2.test(n));
    const v = nm ? _num(idx.get(nm).last) : null;
    const p = nm ? _num(idx.get(nm).prev) : null;
    marches[m.key] = (v == null) ? null : { valeur: v, precedent: p, nom: nm };
  }
  /* ⚠️ L'EXTRACTION SE DÉCLARE (16/09). Je ne peux pas, depuis une session distante, ouvrir la page
     de TradingEconomics pour confirmer qu'elle nomme bien sa ligne « Government Bond 10Y ». Livrer
     un intitulé supposé, c'est risquer un widget vide en production sans que rien ne dise pourquoi.
     On emporte donc les noms de lignes CANDIDATS lus sur la vraie page : si la correspondance rate,
     le diagnostic administrateur montre comment TradingEconomics appelle réellement la ligne, et la
     correction tient en une expression régulière au lieu d'une enquête. */
  marches._candidats = names.filter(n => /bond|yield|interest rate/i.test(n)).slice(0, 12);
  const subs = CATS.map(c => {
    const nm = names.find(n => c.re.test(n));
    if (!nm) return { label: c.key, value: 'Neutral', last: null, prev: null, name: '' };
    const { last, prev } = idx.get(nm);
    return { label: c.key, value: (_rate(c.mode, last, prev) || 'Neutral'), last, prev, name: nm };
  });
  return { subs, marches };
}

// Renvoie { subs:[{label,value,last,prev,name}], parent } pour UNE devise (caché 8 h, best-effort).
async function fetchTEFundamental(cc) {
  if (_cache[cc] && Date.now() - _cache[cc].ts < TTL) return _cache[cc];
  if (_busy[cc]) return _cache[cc] || null;
  _busy[cc] = true;
  try {
    const slug = COUNTRY[cc]; if (!slug) return null;
    const lu = await _fetchCountry(slug);
    if (!lu || !lu.subs) return _cache[cc] || null;
    const { subs, marches } = lu;
    // `subs` et `parent` gardent EXACTEMENT leur forme : le Radar de Biais lit cet objet depuis le
    // 11/08 et ne doit rien voir changer. `marches` s'ajoute à côté.
    _cache[cc] = { subs, parent: _parent(subs), marches: marches || {}, ts: Date.now() };
    return _cache[cc];
  } catch (e) { console.warn('[TE ' + cc + ']', e.message); return _cache[cc] || null; }
  finally { _busy[cc] = false; }
}

// Toutes les devises → { USD:{subs,parent}, … } (séquentiel pour ménager TE ; échec par devise toléré).
async function fetchTEAll(currencies) {
  const out = {};
  for (const cc of currencies) { try { const r = await fetchTEFundamental(cc); if (r) out[cc] = r; } catch {} }
  return out;
}

module.exports = { fetchTEFundamental, fetchTEAll };

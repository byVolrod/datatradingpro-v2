#!/usr/bin/env node
/* ═══ LA SOURCE DU CALENDRIER, C'EST FOREXFACTORY ══════════════════════════════════════════════════
   Décision utilisateur du 01/09 : « la source du calendrier éco doit être celle de forexfactory ».
   Elle n'était tenue qu'à moitié depuis le 11/08 — ForexFactory RENOMMAIT les lignes de TradingView,
   il ne disait pas lesquelles existent. D'où les deux défauts symétriques signalés fin août : une
   ligne de chez TradingView que le trader ne retrouve pas sur forexfactory.com (« je ne la vois pas
   non plus dans notre calendrier », 31/08), et — plus silencieux — une ligne de chez FF qui
   n'apparaissait JAMAIS, puisqu'un renommage ne sait qu'habiller l'existant.

   CE QUE CE BANC ÉPROUVE. Le VRAI `_calFusionFF` de server.js, EXTRAIT du fichier avec ses
   dépendances, jamais recopié : une copie diverge le jour où quelqu'un touche à l'original, et le
   banc validerait alors du code que personne n'exécute.
   Le point délicat n'est pas l'ajout — une ligne en trop se voit. C'est le RETRAIT : une ligne qui
   n'est plus là ne se remarque pas. Les trois verrous qui l'encadrent sont donc éprouvés un par un,
   chacun dans la situation où il doit dire NON.

   NOTE D'EXTRACTION : le lecteur de déclarations compte les accolades, crochets et parenthèses en
   sautant les chaînes et les commentaires — il suppose qu'une expression régulière littérale est
   elle-même équilibrée. Elle l'est dans tout ce qu'on extrait ici (vérifié), et un déséquilibre
   ferait échouer l'extraction BRUYAMMENT, jamais silencieusement. */
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server.js');
const src = fs.readFileSync(SERVER, 'utf8');
let ko = 0;
const verif = (nom, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + nom + (ok || !detail ? '' : '\n      → ' + detail));
  if (!ok) ko++;
};

console.log('\n── La source du calendrier économique est ForexFactory ──');

// ── Extraction d'une déclaration complète (const/function), accolades comptées ──────────────────
function extraire(nom) {
  const rx = new RegExp('^(?:const|let|function)\\s+' + nom.replace(/[$]/g, '\\$') + '\\b', 'm');
  const m = src.match(rx);
  if (!m) throw new Error('déclaration introuvable : ' + nom);
  // Une FONCTION se termine à l'accolade qui ferme son corps (les parenthèses de paramètres ne
  // comptent pas) ; une CONSTANTE, au point-virgule laissé à découvert par tous les délimiteurs.
  const fonction = /^function/.test(m[0]);
  let i = m.index, prof = 0, corps = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (fonction) {
      if (c === '{') { prof++; corps = true; continue; }
      if (c === '}') { prof--; if (corps && prof === 0) return src.slice(m.index, i + 1); continue; }
      continue;
    }
    if (c === '{' || c === '[' || c === '(') { prof++; continue; }
    if (c === '}' || c === ']' || c === ')') { prof--; continue; }
    if (c === ';' && prof === 0) return src.slice(m.index, i + 1);
  }
  throw new Error('déclaration non terminée : ' + nom);
}

const NOMS = ['_CAL_STOP', '_CAL_CTRY', '_calTitleTokens', '_calOverlap', '_FF_EURO_CTRY_ADJ',
  '_CAL_VITAL_RX', '_calVitalLift', '_calKey', '_calKeyDated', '_calActualsMap', '_overlayActuals',
  '_FF_JOUR_MIN', '_FF_APPARIEMENT_MIN', '_FF_FENETRE_MS', '_calJourUTC', '_FF_ADJ_CTRY', '_ffCtry',
  '_calFusionFF'];
let bloc;
try { bloc = NOMS.map(extraire).join('\n'); }
catch (e) { verif('le code de fusion est extractible de server.js', false, e.message); console.log('\n✗ ' + ko + ' ÉCHEC(S)\n'); process.exit(1); }
verif('le code de fusion (18 déclarations) est extractible de server.js', true);

// Doublures : le flux FF (injecté par scénario) et `_WA.poidsMajeur`, dont `_calVitalLift` se sert
// pour peser un rendez-vous vital. Tout le reste est le vrai code.
let FLUX = [];
let fusion;
try {
  // eslint-disable-next-line no-eval
  fusion = eval('(function(){' +
    'const getCalendarRaw = () => FLUX;' +
    'const _WA = { poidsMajeur: e => /jackson hole|powell|symposium/i.test(e.title || "") ? 5 : 3 };' +
    bloc + '\nreturn { _calFusionFF, _ffCtry, _calActualsMap };})()');
} catch (e) {
  verif('il s\'évalue sans erreur', false, e.message);
  console.log('\n✗ ' + ko + ' ÉCHEC(S)\n'); process.exit(1);
}
const { _calFusionFF, _ffCtry } = fusion;

// ── Fixture : mercredi 2 septembre 2026, une journée de calendrier ordinaire ────────────────────
const J = Date.UTC(2026, 8, 2);
const h = (hh, mm) => J + hh * 3600000 + (mm || 0) * 60000;
const ffEv = (ccy, title, ts, imp, o) => Object.assign({ currency: ccy, title, timestamp: ts, impact: imp, actual: '', forecast: '', previous: '', url: 'https://www.forexfactory.com/calendar/' }, o || {});
const tvEv = (ccy, title, ts, imp, o) => Object.assign({ id: 'tv-x' + ts + ccy, currency: ccy, title, timestamp: ts, impact: imp, actual: '', forecast: '', previous: '', ctry: '', url: '' }, o || {});

const FF_JOURNEE = [
  ffEv('USD', 'ISM Services PMI',      h(16, 0),  'High',   { forecast: '52.3', previous: '51.1' }),
  ffEv('USD', 'ADP Non-Farm Employment Change', h(14, 15), 'High', { forecast: '65K' }),
  ffEv('USD', 'Unemployment Claims',   h(14, 30), 'Medium', { forecast: '230K' }),
  ffEv('EUR', 'German Prelim CPI m/m', h(12, 0),  'High',   { forecast: '0.2%' }),
  ffEv('GBP', 'Final Services PMI',    h(9, 30),  'Medium', { forecast: '53.0' }),
];
const TV_JOURNEE = [
  tvEv('USD', 'ISM Services PMI',      h(16, 0),  'High',   { actual: '54.5', forecast: '52.3', previous: '51.1' }),
  tvEv('USD', 'Unemployment Claims',   h(14, 30), 'Medium', { forecast: '230K' }),
  tvEv('EUR', 'German Prelim CPI m/m', h(12, 0),  'Medium', { forecast: '0.2%', ctry: 'DE' }),
  tvEv('GBP', 'Final Services PMI',    h(9, 30),  'Medium', { forecast: '53.0' }),
];
const titres = l => l.map(e => e.currency + ' ' + e.title);
const a = (l, ccy, t) => l.find(e => e.currency === ccy && e.title === t);

// ── 1. Une ligne présente chez FF et absente de TradingView ENTRE dans le calendrier ────────────
{
  FLUX = FF_JOURNEE;
  const out = _calFusionFF(TV_JOURNEE);
  verif('une ligne du flux FF absente de TradingView est AJOUTÉE (ADP Non-Farm)',
    !!a(out, 'USD', 'ADP Non-Farm Employment Change'), titres(out).join(' · '));
  verif('elle porte la prévision de ForexFactory',
    (a(out, 'USD', 'ADP Non-Farm Employment Change') || {}).forecast === '65K');
  verif('elle porte le lien vers sa page ForexFactory (Specs + History au clic)',
    /forexfactory\.com\/calendar/.test((a(out, 'USD', 'ADP Non-Farm Employment Change') || {}).url || ''));
}

// ── 2. Une ligne TradingView SANS contrepartie FF est RETIRÉE ───────────────────────────────────
{
  FLUX = FF_JOURNEE;
  const tv = TV_JOURNEE.concat([tvEv('USD', 'Redbook Index yoy', h(13, 55), 'Medium', { actual: '5.1%' })]);
  const out = _calFusionFF(tv);
  verif('une ligne TradingView que ForexFactory ne liste pas est RETIRÉE (Redbook)',
    !a(out, 'USD', 'Redbook Index yoy'), titres(out).join(' · '));
}

// ── 3. Un événement apparié ne sort qu'UNE fois, avec l'identité FF et la valeur de qui l'a ─────
{
  FLUX = FF_JOURNEE;
  const out = _calFusionFF(TV_JOURNEE);
  const ism = out.filter(e => e.title === 'ISM Services PMI');
  verif('un événement présent des DEUX côtés ne sort qu\'une fois', ism.length === 1, ism.length + ' occurrence(s)');
  verif('il garde le résultat de TradingView quand le flux FF est muet dessus', ism[0] && ism[0].actual === '54.5');
  const cpi = a(out, 'EUR', 'German Prelim CPI m/m');
  verif('l\'impact affiché est celui de ForexFactory (High), pas celui de TradingView (Medium)',
    !!cpi && cpi.impact === 'High', cpi && cpi.impact);
  verif('le pays d\'origine sous EUR est conservé (DE)', !!cpi && cpi.ctry === 'DE', cpi && cpi.ctry);
}

// ── 4. VERROU 1 — une journée que FF couvre mal n'est pas arbitrée par FF ───────────────────────
{
  FLUX = FF_JOURNEE.slice(0, 2);                       // 2 rendez-vous < _FF_JOUR_MIN (3)
  const tv = TV_JOURNEE.concat([tvEv('USD', 'Redbook Index yoy', h(13, 55), 'Medium')]);
  const out = _calFusionFF(tv);
  verif('flux FF trop maigre sur la journée → AUCUN retrait (le calendrier ne peut pas se vider)',
    tv.every(e => !!a(out, e.currency, e.title)), titres(out).join(' · '));
}
{
  FLUX = [];
  const out = _calFusionFF(TV_JOURNEE);
  verif('flux FF vide (429, cache périmé) → la liste TradingView revient intacte',
    out.length === TV_JOURNEE.length && TV_JOURNEE.every(e => !!a(out, e.currency, e.title)));
}
{
  FLUX = FF_JOURNEE;
  const tv = TV_JOURNEE.concat([tvEv('CNY', 'Caixin Services PMI', h(1, 45), 'Medium')]);
  const out = _calFusionFF(tv);
  verif('une devise que FF ne couvre pas ce jour-là garde ses lignes (CNY)',
    !!a(out, 'CNY', 'Caixin Services PMI'));
}

// ── 5. VERROU 2 — si les deux sources ne se reconnaissent plus, le retrait se DÉSARME seul ──────
{
  FLUX = FF_JOURNEE.map(e => Object.assign({}, e, { timestamp: e.timestamp + 6 * 3600000 }));   // horloge FF décalée de 6 h
  const tv = TV_JOURNEE.concat([tvEv('USD', 'Redbook Index yoy', h(13, 55), 'Medium')]);
  const out = _calFusionFF(tv);
  verif('appariement effondré (horloges décalées) → AUCUNE ligne TradingView retirée',
    tv.every(e => !!a(out, e.currency, e.title)), titres(out).join(' · '));
  verif('… mais les lignes FF sont quand même ajoutées (on n\'appauvrit jamais le calendrier)',
    out.length > tv.length, out.length + ' lignes pour ' + tv.length + ' entrées TradingView');
}

// ── 6. VERROU 3 — un rendez-vous vital n'est JAMAIS retiré ──────────────────────────────────────
{
  FLUX = FF_JOURNEE;                                   // FF exclut « Non-Economic » : ni OPEP, ni symposium
  const tv = TV_JOURNEE.concat([
    tvEv('USD', 'Fed Chair Powell Speech at Jackson Hole', h(15, 0), 'Low'),
    tvEv('USD', 'OPEC Meetings', h(11, 0), 'Low'),
  ]);
  const out = _calFusionFF(tv);
  verif('Jackson Hole reste au calendrier même s\'il est absent du flux FF',
    !!a(out, 'USD', 'Fed Chair Powell Speech at Jackson Hole'));
  verif('la réunion de l\'OPEP aussi', !!a(out, 'USD', 'OPEC Meetings'));
}

// ── 7. Le pays d'origine lu dans le libellé ForexFactory ────────────────────────────────────────
verif('« German Prelim CPI m/m » → pays DE', _ffCtry('German Prelim CPI m/m') === 'DE');
verif('« French Flash CPI y/y » → pays FR', _ffCtry('French Flash CPI y/y') === 'FR');
verif('« CPI y/y » (agrégat zone euro) → aucun pays, comme sur ForexFactory', _ffCtry('CPI y/y') === '');
verif('« Spanish Unemployment Change » → pays ES', _ffCtry('Spanish Unemployment Change') === 'ES');

/* ── 8. Le tout est BRANCHÉ, pas seulement défini ─────────────────────────────────────────────────
   Contrôlé sur un server.js DÉCOMMENTÉ. Première écriture de ce banc : les trois vérifications
   ci-dessous restaient VERTES alors que l'appel de `_buildTVCalendar` venait d'être mis en
   commentaire — une ligne commentée contient encore son texte, et une recherche de motif ne fait pas
   la différence. C'est le défaut exact que cette section est censée attraper, en train de passer
   sous elle. Les commentaires sont donc retirés d'abord. */
const srcNu = src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
verif('la fusion est branchée sur le calendrier courant (`_buildTVCalendar`)',
  /_buildTVCalendar\(force\)[\s\S]{0,2600}?_calFusionFF\(items\)/.test(srcNu));
verif('elle l\'est aussi sur la fenêtre d\'archive (`_buildTVCalendarRange`), pour que les flèches ‹ › disent la même chose',
  /_buildTVCalendarRange\(backMonths\)[\s\S]{0,4200}?_calFusionFF\(items\)/.test(srcNu));
verif('TradingView muet et sans instantané → le calendrier sort quand même de ForexFactory seul',
  /_calFusionFF\(\[\]\)/.test(srcNu));
verif('les résultats déjà collectés sont reposés sur la liste fusionnée (`_overlayActuals`)',
  /return _overlayActuals\(sortie\.sort/.test(srcNu));

// ── 9. Ordre chronologique (le calendrier se lit de haut en bas) ────────────────────────────────
{
  FLUX = FF_JOURNEE;
  const out = _calFusionFF(TV_JOURNEE);
  let croissant = true;
  for (let i = 1; i < out.length; i++) if (out[i].timestamp < out[i - 1].timestamp) croissant = false;
  verif('la liste fusionnée sort en ordre chronologique', croissant);
}

if (ko) { console.log('\n✗ ' + ko + ' ÉCHEC(S)\n'); process.exit(1); }
console.log('\n✓ LA SOURCE DU CALENDRIER EST FOREXFACTORY\n');

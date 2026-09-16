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
  '_calSansResultatFutur',
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
    bloc + '\nreturn { _calFusionFF, _ffCtry, _calActualsMap, _calKeyDated, _calSansResultatFutur };})()');
} catch (e) {
  verif('il s\'évalue sans erreur', false, e.message);
  console.log('\n✗ ' + ko + ' ÉCHEC(S)\n'); process.exit(1);
}
const { _calFusionFF, _ffCtry, _calActualsMap, _calKeyDated, _calSansResultatFutur } = fusion;

// ── Fixture : mercredi 2 septembre 2026, une journée de calendrier ordinaire ────────────────────
const J = Date.UTC(2026, 8, 2);
const h = (hh, mm) => J + hh * 3600000 + (mm || 0) * 60000;
/* « MAINTENANT » FIGÉ EN FIN DE JOURNÉE (01/09, ajout de `_calSansResultatFutur` : la fusion compare
   désormais chaque horodatage à Date.now() RÉEL avant de laisser passer un résultat). Sans ce
   verrou, toutes les lignes de la fixture ci-dessus — bâties sur `J`, le 2 septembre 2026, une date
   future par construction (pour rester stable, jamais rejouée un jour différent) — se seraient vues
   dépouillées de leur résultat par ce même garde-fou : correct en production, faux ici, puisque la
   fixture n'a pas de rapport avec l'horloge réelle de la machine qui exécute ce banc. On fige donc
   « maintenant » à 22h le jour de la fixture, après la dernière heure utilisée par les scénarios
   1 à 9 (16h) : leurs événements restent au PASSÉ, comme le suppose leur écriture. Les scénarios de
   la section 10, qui ÉPROUVENT justement ce garde-fou, posent leur propre horloge locale (héritée
   puis restaurée) autour de la frontière passé/futur qui les intéresse. */
Date.now = () => h(22, 0);
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
  /_overlayActuals\(sortie\.sort/.test(srcNu));
verif('… et une ligne encore à venir ne peut pas ressortir avec un résultat publié (`_calSansResultatFutur`)',
  /return _calSansResultatFutur\(_overlayActuals\(sortie\.sort/.test(srcNu));

// ── 9. Ordre chronologique (le calendrier se lit de haut en bas) ────────────────────────────────
{
  FLUX = FF_JOURNEE;
  const out = _calFusionFF(TV_JOURNEE);
  let croissant = true;
  for (let i = 1; i < out.length; i++) if (out[i].timestamp < out[i - 1].timestamp) croissant = false;
  verif('la liste fusionnée sort en ordre chronologique', croissant);
}

// ── 10. GARDE-FOU : UNE LIGNE À VENIR NE PORTE JAMAIS DE RÉSULTAT ────────────────────────────────
/* 01/09, capture utilisateur : « JOLTS Job Openings » à 16h00 (passé, résultat 7,271M) et une
   seconde ligne « JOLTS Job Openings » à 20h00 — ENCORE À VENIR, marquée « prochaine échéance »
   par le rendu (isNext = timestamp >= now) — affichait déjà le MÊME 7,271M en résultat. Preuve par
   le code : `_overlayActuals` recherche un résultat manquant sous une clé devise+intitulé+JOUR
   CALENDAIRE (`_calKeyDated`), sans l'heure — deux lignes du même jour partagent donc la même clé,
   et la ligne publiée dépose un résultat que la ligne à venir récupère à tort au tour suivant.
   `_calSansResultatFutur` ferme la porte en dernier, quelle que soit la source du résultat mal daté :
   AUCUNE ligne dont l'horodatage dépasse « maintenant » ne peut porter de résultat publié. */
console.log('\n── 10. Une ligne à venir ne porte jamais de résultat publié ──');
{
  const NOW = Date.UTC(2026, 8, 1, 17, 0);   // 19h Paris (CEST, UTC+2) = 17h UTC — strictement ENTRE les deux JOLTS (16h/20h Paris)
  const _ancienNow = Date.now;
  Date.now = () => NOW;
  try {
    const H = (hh) => Date.UTC(2026, 8, 1, hh - 2, 0);   // heure Paris → UTC (CEST, +2)
    /* a. LE SCÉNARIO EXACT DE LA CAPTURE, rejoué sur le VRAI `_calFusionFF`. Le flux XML de
       ForexFactory NE PORTE PAS D'ACTUALS (cf. scrapers/forexfactory.js) : ses lignes arrivent
       toujours avec `actual: ''`, remplies ensuite par l'overlay. Ici FF déclare « JOLTS Job
       Openings » à DEUX horaires du même jour (16h et 20h — un vrai doublon côté fournisseur,
       largeur bien au-delà des 90 min de tolérance d'appariement : les deux lignes restent
       distinctes, ni fusionnées ni retirées, exactement le doublon vu sur la capture). TradingView,
       lui, n'a QU'UNE seule vraie publication, à 16h, avec son résultat. La ligne FF de 16h
       s'apparie donc avec elle et hérite du résultat authentique ; celle de 20h ne s'apparie à
       rien (aucune ligne TV à 240 min) et reste sans résultat À SA SORTIE DE FUSION — c'est
       l'overlay qui, ensuite, la sert à tort (la clé datée ne voit pas l'heure). */
    FLUX = [
      ffEv('USD', 'JOLTS Job Openings', H(16), 'High', { forecast: '7.3M', previous: '7.182M' }),
      ffEv('USD', 'JOLTS Job Openings', H(20), 'High', { forecast: '7.33M', previous: '7.36M' }),
      ffEv('USD', 'ISM Manufacturing PMI', H(16), 'High', { forecast: '55.2', previous: '55.6' }),
      ffEv('USD', 'Fed Barr Speech', H(15) + 5 * 60000, 'Medium', {}),
    ];
    const tvJour = [
      tvEv('USD', 'JOLTS Job Openings', H(16), 'High', { actual: '7.271M', forecast: '7.3M', previous: '7.182M' }),
      tvEv('USD', 'ISM Manufacturing PMI', H(16), 'High', { forecast: '55.2', previous: '55.6' }),
      tvEv('USD', 'Fed Barr Speech', H(15) + 5 * 60000, 'Medium', {}),
    ];
    // On amorce le cache des résultats persistés comme le ferait `_refreshTVActuals` après la
    // publication de 16h00 : c'est LUI qui pose l'entrée sous la clé datée (jour, sans l'heure).
    _calActualsMap.set(_calKeyDated('USD', 'JOLTS Job Openings', H(16)), { actual: '7.271M', forecast: '7.3M', previous: '7.182M' });
    const out = _calFusionFF(tvJour);
    const j16 = out.find(e => e.currency === 'USD' && e.title === 'JOLTS Job Openings' && e.timestamp === H(16));
    const j20 = out.find(e => e.currency === 'USD' && e.title === 'JOLTS Job Openings' && e.timestamp === H(20));
    verif('la ligne PASSÉE (16h) garde son résultat authentique', !!j16 && j16.actual === '7.271M', j16 && j16.actual);
    verif('la ligne À VENIR (20h) ne récupère PAS le résultat de la ligne passée (le contresens de la capture)',
      !!j20 && (j20.actual === '' || j20.actual == null), j20 && JSON.stringify(j20.actual));
    verif('… elle garde sa PRÉVISION, elle', !!j20 && j20.forecast === '7.33M', j20 && j20.forecast);
  } finally { Date.now = _ancienNow; }

  // b. MÊME GARDE-FOU, APPELÉ DIRECTEMENT (pas au travers de la fusion FF, dont les verrous de
  //    densité/appariement sont hors sujet ici) : une ligne à venir arrive avec SON PROPRE `actual`
  //    déjà posé PAR SA SOURCE (le second « ISM Manufacturing PMI » de la capture, à un horaire
  //    différent — un désaccord d'horaire entre fournisseurs, pas un vide comblé par l'overlay).
  //    Preuve que le garde-fou agit sur TOUTE origine d'un résultat mal daté, pas seulement celle
  //    réparée en (a).
  const _ancienNow2 = Date.now;
  Date.now = () => Date.UTC(2026, 8, 1, 17, 0);   // 19h Paris, comme en (a) — strictement avant 20h
  try {
    const H = (hh) => Date.UTC(2026, 8, 1, hh - 2, 0);
    const brut = [
      tvEv('USD', 'ISM Manufacturing PMI', H(16), 'High', { actual: '54.6', forecast: '55.2', previous: '55.6' }),
      tvEv('USD', 'ISM Manufacturing PMI', H(20), 'High', { actual: '53.9', forecast: '55.2', previous: '55.6' }),   // encore à venir, ET DÉJÀ un résultat à sa propre source
    ];
    const out2 = _calSansResultatFutur(brut);
    const p16 = out2.find(e => e.timestamp === H(16));
    const p20 = out2.find(e => e.timestamp === H(20));
    verif('la ligne passée (16h) garde son résultat', !!p16 && p16.actual === '54.6', p16 && p16.actual);
    verif('la ligne À VENIR (20h) perd le résultat posé par SA PROPRE source (pas un simple vide comblé)',
      !!p20 && (p20.actual === '' || p20.actual == null), p20 && JSON.stringify(p20.actual));
  } finally { Date.now = _ancienNow2; }
}

// ── 11. L'ARCHIVE NE RESSUSCITE JAMAIS UN RÉSULTAT ENCORE À VENIR ───────────────────────────────
/* 01/09, SECONDE capture utilisateur, APRÈS déploiement du garde-fou de la section 10 : le JOLTS de
   20h était bien redevenu vide (le correctif marchait), mais « ISM Manufacturing PMI · 20:00 »
   affichait TOUJOURS 53.9 à 16h45. Cause racine : `/api/calendar-events` ne sert pas la sortie de
   `_calFusionFF` telle quelle, il la passe ENSUITE dans `_calHistMerge`, qui réinjecte l'archive
   persistée (`calhist:events`, Supabase). Cette archive avait absorbé le 53.9 AVANT le correctif ;
   elle survit donc aux redémarrages, et la ligne fraîchement nettoyée n'entrant plus dans l'ensemble
   « déjà publié » (son résultat est désormais vide), rien n'empêchait la ligne d'archive de repasser
   devant. Pire, la clé d'archive ne remplaçant une entrée que sur un horodatage STRICTEMENT plus
   récent, la valeur bidon horodatée 20h ne pouvait jamais être corrigée par le vrai chiffre de 20h.
   Trois verrous éprouvés ici : ne rien absorber du futur, réparer sur place à horodatage égal,
   n'émettre que du passé. */
console.log('\n── 11. L\'archive ne ressuscite jamais un résultat encore à venir ──');
{
  let blocH;
  try { blocH = ['_calHistKey', '_calHistAbsorb', '_calHistMerge'].map(extraire).join('\n'); }
  catch (e) { verif('le code de l\'archive est extractible de server.js', false, e.message); blocH = null; }
  if (blocH) {
    verif('le code de l\'archive (3 déclarations) est extractible de server.js', true);
    const NOW = Date.UTC(2026, 8, 1, 17, 0);   // 19h Paris — strictement entre 16h et 20h Paris
    const H = (hh) => Date.UTC(2026, 8, 1, hh - 2, 0);
    const _ancienNow = Date.now;
    Date.now = () => NOW;
    let arch;
    try {
      /* Doublures : `_calHistDirty` (drapeau de persistance, sans effet ici) et un `setInterval`
         neutralisé — le vrai code en pose un pour la sauvegarde Supabase toutes les 5 min.
         ⚠️ 16/09 — `_ffDisplayTitle` et `_CAL_SPEECH_RX` SONT DES DOUBLURES AJOUTÉES CE JOUR-LÀ, et
         leur absence a fait rougir ce banc sur du code parfaitement sain. `_calHistMerge` s'est mis
         à reconnaître une publication par son nom AFFICHÉ (une même sortie porte deux noms selon le
         fournisseur, d'où le doublon « CPI y/y » de la capture client) : deux dépendances de plus,
         qui ne sont pas dans la tranche extraite ici. C'est la leçon du 10/09, mot pour mot : UNE
         BORNE D'EXTRACTION EST UN CONTRAT, et ajouter une dépendance à une fonction extraite
         ailleurs est DEUX gestes. La doublure de renommage est neutre (elle rend le titre tel quel),
         ce qui suffit à cette section : elle éprouve les VERROUS de l'archive, pas le renommage,
         qui a ses propres contrôles dans calendrier-verif.js. */
      // eslint-disable-next-line no-eval
      arch = eval('(function(){ let _calHist = new Map(); let _calHistDirty = false;' +
        'const _ffDisplayTitle = e => (e && e.title) || ""; const _CAL_SPEECH_RX = /speaks|speech|testimony|testifies|press conf|discours|audition/i;' +
        blocH + '\nreturn { _calHistAbsorb, _calHistMerge, _calHistKey, hist: () => _calHist, poser: m => { _calHist = m; } };})()');
    } catch (e) { verif('il s\'évalue sans erreur', false, e.message); }
    if (arch) {
      verif('il s\'évalue sans erreur', true);
      const ligne = (o) => Object.assign({ currency: 'USD', ctry: 'united states', title: 'ISM Manufacturing PMI', impact: 'High', timestamp: 0, actual: '', forecast: '55.2', previous: '55.6' }, o);

      /* a. LE SCÉNARIO EXACT DE LA CAPTURE. L'archive porte déjà le 53.9 horodaté 20h (empoisonnée
         la veille, avant le correctif, et rechargée depuis Supabase au démarrage). La fenêtre
         fraîche, elle, est PROPRE : la section 10 a fait son travail, la ligne de 20h y arrive sans
         résultat. C'est `_calHistMerge` qui remettait le 53.9. */
      const empoisonnee = ligne({ timestamp: H(20), actual: '53.9' });
      empoisonnee._k = arch._calHistKey(empoisonnee);
      empoisonnee._h = [{ t: H(20) - 30 * 86400000, a: '48.0', f: '49', p: '50' }];   // la vraie publication du mois précédent
      arch.poser(new Map([[empoisonnee._k, empoisonnee]]));
      const fenetre = [ligne({ timestamp: H(16), actual: '54.6' }), ligne({ timestamp: H(20), actual: '' })];
      const sortie = arch._calHistMerge(fenetre);
      const futurAvecResultat = sortie.filter(e => (e.timestamp || 0) > NOW && e.actual != null && e.actual !== '');
      verif('AUCUNE ligne servie au-delà de « maintenant » ne porte de résultat (le 53.9 de la capture)',
        futurAvecResultat.length === 0, JSON.stringify(futurAvecResultat.map(e => e.title + '@' + new Date(e.timestamp).toISOString() + ' = ' + e.actual)));
      verif('… la ligne PASSÉE de la fenêtre est toujours servie avec son résultat',
        sortie.some(e => e.timestamp === H(16) && e.actual === '54.6'));
      verif('… et la publication réelle du mois précédent, elle, est bien ressuscitée de l\'archive',
        sortie.some(e => e.actual === '48.0' && e.timestamp === H(20) - 30 * 86400000));

      /* b. L'ARCHIVE NE S'EMPOISONNE PLUS. Une source qui sert un résultat sur une ligne encore à
         venir (le cas de la section 10 (b), si jamais un chemin contournait la fusion) ne doit rien
         laisser dans l'archive — sinon le 53.9 y retomberait à chaque relevé.
         NOTE HONNÊTE, mesurée au contrôle négatif : ce que cette assertion prouve est le RÉSULTAT
         (l'archive reste propre), pas le verrou 1 pris isolément. Désarmer le seul verrou 1 laisse
         le banc vert, parce que la purge (verrou 3) tourne dans le MÊME appel et retire l'entrée
         aussitôt écrite. Il faut désarmer les deux pour faire rougir — c'est le propre d'une défense
         en profondeur, et le verrou 1 garde sa raison d'être : ne pas écrire pour purger derrière,
         donc ne pas lever le drapeau de persistance Supabase à chaque relevé. */
      arch.poser(new Map());
      arch._calHistAbsorb([ligne({ timestamp: H(20), actual: '53.9' })]);
      verif('un résultat daté du FUTUR n\'entre pas dans l\'archive', arch.hist().size === 0, 'taille = ' + arch.hist().size);
      arch._calHistAbsorb([ligne({ timestamp: H(16), actual: '54.6' })]);
      verif('… alors qu\'un résultat PASSÉ y entre normalement', arch.hist().size === 1, 'taille = ' + arch.hist().size);

      /* c. RÉPARATION À HORODATAGE ÉGAL. C'est le verrou qui aurait figé le mensonge pour toujours :
         quand 20h arrive et que le VRAI chiffre tombe, il porte le MÊME horodatage que la valeur
         bidon — le test « strictement plus récent » le rejetait. */
      const bidon = ligne({ timestamp: H(20), actual: '53.9' });
      bidon._k = arch._calHistKey(bidon); bidon._h = [];
      arch.poser(new Map([[bidon._k, bidon]]));
      const _n2 = Date.now; Date.now = () => H(21);   // 20h est passé : le vrai chiffre tombe
      try { arch._calHistAbsorb([ligne({ timestamp: H(20), actual: '48.7' })]); } finally { Date.now = _n2; }
      const rep = arch.hist().get(bidon._k);
      verif('à horodatage égal, le vrai chiffre REMPLACE la valeur archivée', !!rep && rep.actual === '48.7', rep && rep.actual);
      verif('… sans créer de faux point de série (c\'est la même publication, révisée)',
        !!rep && (rep._h || []).length === 0, rep && JSON.stringify(rep._h));

      /* d. PURGE D'UNE ARCHIVE DÉJÀ ÉCRITE. Le stock persisté hérité d'avant le correctif se répare
         de lui-même au premier relevé : l'entrée future est remplacée par sa dernière valeur réelle,
         sans attendre que l'horodatage fautif finisse par entrer dans le passé. */
      const vieux = ligne({ timestamp: H(20), actual: '53.9' });
      vieux._k = arch._calHistKey(vieux);
      vieux._h = [{ t: H(20) - 60 * 86400000, a: '49.1', f: '50', p: '51' }, { t: H(20) - 30 * 86400000, a: '48.0', f: '49', p: '50' }];
      arch.poser(new Map([[vieux._k, vieux]]));
      arch._calHistAbsorb([]);   // un simple relevé suffit à déclencher la purge
      const soigne = arch.hist().get(vieux._k);
      verif('une entrée d\'archive future est ramenée à sa dernière valeur RÉELLE',
        !!soigne && soigne.actual === '48.0' && soigne.timestamp === H(20) - 30 * 86400000, soigne && soigne.actual + '@' + (soigne && soigne.timestamp));
      verif('… en conservant la série antérieure', !!soigne && (soigne._h || []).length === 1 && soigne._h[0].a === '49.1', soigne && JSON.stringify(soigne._h));
      const orphelin = ligne({ timestamp: H(20), actual: '53.9' });
      orphelin._k = arch._calHistKey(orphelin); orphelin._h = [];
      arch.poser(new Map([[orphelin._k, orphelin]]));
      arch._calHistAbsorb([]);
      verif('… et une entrée future SANS aucune valeur réelle derrière est simplement supprimée', arch.hist().size === 0, 'taille = ' + arch.hist().size);
    }
    Date.now = _ancienNow;
  }
}

/* ⚠️ LE BILAN EST À LA FIN, ET IL DOIT Y RESTER (01/09). Il était posé juste après la section 9,
   donc AVANT les sections 10 et 11 : leurs échecs s'affichaient à l'écran mais le banc sortait
   quand même en 0 (le `process.exit` était déjà passé) — un banc vert sur un desk cassé, exactement
   ce que ces bancs existent pour empêcher. Toute nouvelle section s'insère AU-DESSUS de ce bloc. */
if (ko) { console.log('\n✗ ' + ko + ' ÉCHEC(S)\n'); process.exit(1); }
console.log('\n✓ LA SOURCE DU CALENDRIER EST FOREXFACTORY, ET AUCUNE LIGNE À VENIR NE PORTE DE RÉSULTAT\n');

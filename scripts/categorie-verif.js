#!/usr/bin/env node
/**
 * categorie-verif.js — UNE SORTIE DE CALENDRIER TOMBE-T-ELLE DANS LA BONNE CATÉGORIE ?
 * ------------------------------------------------------------------------------------------------
 * 31/08, capture à l'appui : « US Core PCE Price Index MoM Actual 0.2% (Forecast 0.2%, Previous
 * 0.1%) » s'affichait en « Actualités mondiales ». La question posée était « vérifie si on a bien un
 * truc pour catégoriser les sorties de news Calendrier économique » — et la réponse est oui : les
 * huit catégories « Données <Pays> » existent depuis toujours.
 *
 * LA CAUSE N'ÉTAIT DONC PAS UNE CATÉGORIE MANQUANTE, MAIS LE CLASSEUR. Il route les publications sur
 * une LISTE DE MOTS-CLÉS écrite à la main : `gdp|inflation|cpi|ppi|pmi|nfp|payroll|unemployment|
 * retail sales|industrial prod`. Le PCE n'y figure pas. « Price index » non plus. L'item traversait
 * les quarante règles et tombait dans le fourre-tout. Le même trou valait pour l'ISM, le JOLTS,
 * l'Ifo, le ZEW, le Tankan — et pour l'indicateur qu'on ajoutera demain : une liste de mots est
 * toujours en retard d'une publication.
 *
 * LA RÈGLE POSÉE N'EST PAS UN MOT MAIS UNE PROPRIÉTÉ : ces lignes portent leur résultat face au
 * consensus (« Actual … Forecast … Previous »), signature qu'aucune dépêche rédactionnelle n'a.
 *
 * Ce contrôle EXÉCUTE le vrai `detectCategory` extrait de server.js — jamais une copie.
 *
 *   node scripts/categorie-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

/* EXTRACTION DU VRAI CLASSEUR. Il s'appuie sur des constantes déclarées ailleurs dans server.js :
   on les emporte avec lui, sinon la fonction lèverait à la première ligne. */
function bloc(debut, fin) {
  const d = SRV.indexOf(debut);
  if (d < 0) throw new Error('introuvable : ' + debut);
  const f = SRV.indexOf(fin, d);
  if (f < 0) throw new Error('fin introuvable : ' + debut);
  return SRV.slice(d, f + fin.length);
}
let detectCategory = null;
const manquants = [];
try {
  const corps = bloc('function detectCategory(text) {', "\n  return 'Global News';\n}");
  /* Les DEUX expressions rationnelles dont le classeur dépend sont déclarées ailleurs dans
     server.js. On les emporte TELLES QUELLES — pas une copie réécrite ici, qui divergerait le jour
     où l'une d'elles changerait. Chacune tient sur une déclaration `const … = /…/…;`. */
  let pre = '';
  for (const nom of ['_GEO_OVERRIDE_RX', 'GEO_DIPLO']) {
    const m = new RegExp('^const ' + nom + '\\s*=[\\s\\S]*?;\\s*$', 'm').exec(SRV);
    if (!m) { manquants.push(nom); pre += 'const ' + nom + ' = /(?!)/;\n'; continue; }   // neutre : ne matche jamais
    pre += m[0] + '\n';
  }
  detectCategory = new Function(pre + corps + '\nreturn detectCategory;')();
} catch (e) {
  console.log('\n  ✗ extraction impossible : ' + e.message + '\n');
  process.exit(1);
}

console.log('\n═══ CATEGORIE-VERIF — les sorties de calendrier trouvent leur rubrique ═══');
console.log('\n── 1. Le cas de la capture, et ses voisins que la liste de mots ratait aussi ──');
/* Chacun de ces intitulés est une VRAIE forme du fournisseur. Aucun ne contient un mot de la liste
   d'origine : tous tombaient dans « Actualités mondiales ». */
[
  ['US Core PCE Price Index MoM Actual 0.2% (Forecast 0.2%, Previous 0.1%)', 'US Data'],
  ['US ISM Services PMI Actual 52.1 (Forecast 51.5, Previous 50.8)', 'US Data'],
  ['US JOLTS Job Openings Actual 7.18M (Forecast 7.40M, Previous 7.36M)', 'US Data'],
  ['German Ifo Business Climate Actual 88.6 (Forecast 89.0, Previous 88.4)', 'EU Data'],
  ['Japan Tankan Large Manufacturers Index Actual 13 (Forecast 12, Previous 13)', 'Japanese Data'],
  ['Canada Building Permits MoM Actual -2.1% (Forecast 1.0%, Previous 4.3%)', 'Canadian Data'],
  ['Australia Westpac Consumer Confidence Actual 92.1 (Previous 93.1)', 'Australian Data'],
  ['Swiss KOF Leading Indicator Actual 97.4 (Forecast 98.0, Previous 96.9)', 'Swiss Data'],
  ['UK Nationwide Housing Prices MoM Actual 0.3% (Forecast 0.1%, Previous 0.6%)', 'UK Data'],
].forEach(([h, attendu]) => {
  const c = detectCategory(h);
  v(attendu + ' ← « ' + h.slice(0, 46) + '… »', c === attendu, 'rendu : ' + c);
});

console.log('\n── 2. Ce qui NE doit PAS basculer ──');
/* La règle est posée APRÈS les banques centrales et les grands thèmes, et c'est ce qui la rend sûre.
   Une décision de taux porte la MÊME signature : sans cet ordre, elle quitterait sa banque. */
[
  ['RBA Interest Rate Decision Actual 4.35% (Forecast 4.35%, Previous 4.35%)', 'RBA'],
  ['Fed Interest Rate Decision Actual 5.50% (Forecast 5.50%, Previous 5.50%)', 'Fed'],
  ['ECB Deposit Facility Rate Actual 3.25% (Forecast 3.25%, Previous 3.50%)', 'ECB'],
].forEach(([h, attendu]) => {
  const c = detectCategory(h);
  v('une décision de taux reste dans sa banque (' + attendu + ')', c === attendu, 'rendu : ' + c);
});
/* Un pays qu'on ne sait pas nommer ne prend JAMAIS la rubrique d'un autre : c'est la règle qui
   empêche cette détection de devenir un aspirateur. Mais il ne repart plus non plus dans le
   fourre-tout (02/09) : la SIGNATURE prouve qu'on a affaire à une publication, seul le pays est
   inconnu. Suède, Norvège, Brésil, Mexique, Inde tombent donc dans la 9e rubrique. */
[
  'Brazil Retail Sales YoY Actual 2.1% (Forecast 1.8%, Previous 1.4%)',
  'Swedish CPI YoY Actual 2.1% (Forecast 2.0%, Previous 2.3%)',
  'Norway Unemployment Rate Actual 3.9% (Forecast 4.0%, Previous 4.0%)',
  'India Industrial Production Actual 5.2% (Forecast 4.8%, Previous 4.1%)',
].forEach(h => {
  const c = detectCategory(h);
  v('« ' + h.slice(0, 30) + '… » → Données (autres pays)', c === 'Other Data', 'rendu : ' + c);
  v('… et surtout PAS la rubrique d\'un autre pays',
    !/^(?:US|UK|EU|Swiss|Japanese|Canadian|Australian|Chinese) Data$/.test(c), 'rendu : ' + c);
});
/* ⚠️ ET LA 9e RUBRIQUE NE DOIT PAS DEVENIR LE NOUVEAU FOURRE-TOUT. Elle est posée APRÈS le test de
   signature : sans lui, tout ce qui n'a pas de pays reconnu y tomberait, y compris les dépêches. */
v('une dépêche sans chiffre ne tombe PAS dans la 9e rubrique',
  detectCategory('Sweden central bank governor speaks in Stockholm') !== 'Other Data',
  'rendu : ' + detectCategory('Sweden central bank governor speaks in Stockholm'));
/* Et une dépêche RÉDACTIONNELLE n'a pas cette signature : c'est tout l'intérêt du test de forme. */
[
  'Euro surges as traders ignore soft German data',
  'US President Trump posts about tariffs on Canada',
  'Fed\'s Collins says inflation is still too high',
].forEach(h => {
  const c = detectCategory(h);
  v('un récit ne devient pas une publication (« ' + h.slice(0, 34) + '… »)',
    !/ Data$/.test(c), 'rendu : ' + c);
});

console.log('\n── 3. La règle est une PROPRIÉTÉ, pas une liste ──');
/* Le contrôle qui compte : un indicateur INVENTÉ, qu'aucune liste de mots ne peut connaître, doit
   quand même trouver sa rubrique. C'est la différence entre corriger un cas et corriger la cause. */
const _demain = detectCategory('US Zorglub Activity Index Actual 51.2 (Forecast 50.0, Previous 49.8)');
v('un indicateur qui n\'existe pas encore est quand même classé', _demain === 'US Data', 'rendu : ' + _demain);
v('… et sans lui, il tombait bien dans le fourre-tout',
  detectCategory('US Zorglub Activity Index rises in July') === 'Global News',
  'rendu : ' + detectCategory('US Zorglub Activity Index rises in July'));

console.log('');
if (manquants.length) console.log('  · dépendances non extraites (sans effet ici) : ' + manquants.join(', ') + '\n');
if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');

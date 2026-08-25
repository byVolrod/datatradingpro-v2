#!/usr/bin/env node
/**
 * scripts/seance-verif.js — LE RÉCAP DE SÉANCE FABRIQUÉ PAR LE DESK.
 *
 * Le module seance.js est pur : tout s'y éprouve exactement, y compris ce qui fait qu'un récap
 * chiffré est juste ou faux — un chômage en hausse annoncé comme une bonne surprise, un rendement
 * exprimé en pourcentage, un écart calculé entre deux grandeurs qui ne se comparent pas.
 *
 *   node scripts/seance-verif.js            → contrôle
 *   node scripts/seance-verif.js --demo     → rendu d'exemple, données ILLUSTRATIVES
 */
const S = require('../seance');
let ko = 0, ok = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

if (process.argv.includes('--demo')) {
  const perfs = [
    { label: 'EUR/USD', pct: 0.42 }, { label: 'GBP/USD', pct: 0.18 }, { label: 'DAX', pct: -1.13 },
    { label: 'FTSE 100', pct: -0.34 }, { label: 'DXY', pct: -0.29 }, { label: 'Brent', pct: 0.87 },
  ];
  const macros = [
    { currency: 'EUR', title: 'German Prelim CPI m/m', actual: '2.3%', forecast: '2.1%', previous: '2.0%', h: '14h00' },
    { currency: 'GBP', title: 'Retail Sales m/m', actual: '0.4%', forecast: '0.4%', previous: '-0.2%', h: '08h00' },
    { currency: 'EUR', title: 'ECB Lane Speaks', actual: '', forecast: '', previous: '', h: '10h30' },
    { currency: 'GBP', title: 'Claimant Count Change', actual: '32K', forecast: '24K', previous: '19K', h: '08h00' },
  ];
  console.log('\n\x1b[33m╔══ APERÇU — Récap séance Londres ═══════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[2m   (données ILLUSTRATIVES : cette session n\'a pas accès aux flux réels)\x1b[0m\n');
  console.log('  ' + S.synthese('Londres', perfs, macros.filter(m => m.actual)));
  console.log('\n  \x1b[1mPHOTO DE SÉANCE\x1b[0m');
  console.log('  · ' + S.lignePerf(perfs));
  console.log('\n  \x1b[1mCHIFFRES DE LA SÉANCE\x1b[0m');
  macros.forEach(m => { const l = S.ligneMacro(m, m.h); if (l) console.log('  · ' + l); });
  console.log('\n\x1b[2m  (puis Géopolitique · Macro · Analyse de séance · À surveiller, inchangés)\x1b[0m');
  console.log('\x1b[33m╚════════════════════════════════════════════════════════════════════════╝\x1b[0m\n');
  process.exit(0);
}

console.log('\n── 1. Écart au consensus ──');
v('au-dessus des attentes', S.ecart({ title: 'CPI', actual: '2.3%', forecast: '2.1%' }).sens === 'au-dessus');
v('en dessous des attentes', S.ecart({ title: 'CPI', actual: '1.9%', forecast: '2.1%' }).sens === 'en dessous');
v('conforme', S.ecart({ title: 'CPI', actual: '2.1%', forecast: '2.1%' }).sens === 'conforme');
v('sans consensus → on ne calcule aucun écart', S.ecart({ title: 'x', actual: '2.3%' }).sansConsensus === true);
v('sans résultat → rien à raconter', S.ecart({ title: 'x', forecast: '2.1%' }) === null);
// Deux grandeurs qui ne se comparent pas ne produisent JAMAIS un écart inventé.
v('% contre K → pas d\'écart', S.ecart({ title: 'x', actual: '2.3%', forecast: '75K' }).sansConsensus === true);
v('K contre M → pas d\'écart', S.ecart({ title: 'x', actual: '104K', forecast: '1.2M' }).sansConsensus === true);

console.log('\n── 2. Les indicateurs INVERSÉS (le piège du récap automatique) ──');
// Un chômage EN HAUSSE est une MAUVAISE nouvelle : l'annoncer comme une bonne surprise est l'erreur
// classique. Le signe brut ne suffit pas, il faut connaître le sens de l'indicateur.
v('chômage en hausse = en dessous des attentes', S.ecart({ title: 'Unemployment Rate', actual: '4.3%', forecast: '4.1%' }).sens === 'en dessous');
v('inscriptions au chômage en hausse = idem', S.ecart({ title: 'Unemployment Claims', actual: '240K', forecast: '230K' }).sens === 'en dessous');
v('Claimant Count en hausse = idem', S.ecart({ title: 'Claimant Count Change', actual: '32K', forecast: '24K' }).sens === 'en dessous');
v('stocks de pétrole en hausse = idem', S.ecart({ title: 'Crude Oil Inventories', actual: '3.2M', forecast: '1.1M' }).sens === 'en dessous');
v('un CPI en hausse reste au-dessus', S.ecart({ title: 'CPI y/y', actual: '2.3%', forecast: '2.1%' }).sens === 'au-dessus');

console.log('\n── 3. L\'écart s\'écrit dans l\'unité du chiffre ──');
v('points de pourcentage', S.ecartTexte(S.ecart({ title: 'CPI', actual: '2.3%', forecast: '2.1%' })) === '+0,2 pt', S.ecartTexte(S.ecart({ title: 'CPI', actual: '2.3%', forecast: '2.1%' })));
v('milliers', S.ecartTexte(S.ecart({ title: 'NFP', actual: '104K', forecast: '75K' })) === '+29K', S.ecartTexte(S.ecart({ title: 'NFP', actual: '104K', forecast: '75K' })));
v('écart négatif', S.ecartTexte(S.ecart({ title: 'NFP', actual: '60K', forecast: '75K' })) === '−15K', S.ecartTexte(S.ecart({ title: 'NFP', actual: '60K', forecast: '75K' })));
v('conforme → aucun écart écrit', S.ecartTexte(S.ecart({ title: 'CPI', actual: '2.1%', forecast: '2.1%' })) === '');

console.log('\n── 4. Un rendement se mesure en points de base ──');
v('+9 pb', S.bps(0.09) === '+9 pb', S.bps(0.09));
v('−4 pb', S.bps(-0.045) === '−4 pb', S.bps(-0.045));
v('inchangé', S.bps(0) === 'inchangé');
const lp = S.lignePerf([{ label: '10 ans US', pct: 2.1, delta: 0.09, bp: true }, { label: 'S&P 500', pct: -0.62 }]);
v('la ligne mélange correctement pb et %', /10 ans US \+9 pb/.test(lp) && /S&P 500 −0,62 %/.test(lp), lp);

console.log('\n── 5. Aucune ligne vide, jamais ──');
v('un rendez-vous sans chiffre est OMIS', S.ligneMacro({ currency: 'USD', title: 'Fed Chair Powell Speaks' }, '16h') === '');
v('un actif sans donnée est OMIS', S.lignePerf([{ label: 'DAX', pct: null }, { label: 'Or', pct: 0.31 }]) === 'Or +0,31 %');
v('aucun actif mesuré → aucune ligne', S.lignePerf([]) === '');
v('« stable » plutôt qu\'un faux zéro signé', S.pct(0.001) === 'stable', S.pct(0.001));

console.log('\n── 6. La synthèse ne dit que ce qui est mesuré ──');
const sy = S.synthese('Londres', [{ label: 'DAX', pct: -1.13 }], [{ title: 'CPI', actual: '2.3%', forecast: '2.1%' }, { title: 'PMI', actual: '52', forecast: '52' }]);
v('elle compte les publications', /2 publications/.test(sy), sy);
v('elle compte les surprises', /1 hors consensus/.test(sy), sy);
v('elle nomme le plus fort mouvement', /DAX −1,13 %/.test(sy), sy);
const vide = S.synthese('Asie', [], []);
v('séance vide → elle le dit, sans meubler', /sans publication majeure ni mouvement notable/.test(vide), vide);
const conf = S.synthese('Asie', [], [{ title: 'CPI', actual: '2.1%', forecast: '2.1%' }]);
v('tout conforme → elle le dit aussi', /toutes conformes/.test(conf), conf);

console.log('\n── 7. Fenêtres et actifs par séance ──');
v('trois séances définies', Object.keys(S.FENETRES).length === 3);
v('l\'Asie ne parle pas du S&P 500', !S.ACTIFS['Asia Session Recap'].some(a => a.sym === '^GSPC'));
v('Londres suit le DAX et le FTSE', S.ACTIFS['London Session Recap'].some(a => a.sym === '^GDAXI') && S.ACTIFS['London Session Recap'].some(a => a.sym === '^FTSE'));
v('New York suit le 10 ans, en points de base', (S.ACTIFS['US Session Recap'].find(a => a.sym === '^TNX') || {}).bp === true);
v('chaque séance a ses devises', Object.values(S.FENETRES).every(f => Array.isArray(f.dev) && f.dev.length));

console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
process.exit(ko ? 1 : 0);

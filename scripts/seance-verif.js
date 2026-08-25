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

// Un taux ne concourt pas avec un indice : neuf points de base ne sont pas « plus gros » qu'un
// pour cent de Nasdaq, les deux grandeurs ne se comparent pas.
const avecTaux = [{ label: '10 ans US', pct: 2.1, delta: 0.09, bp: true }, { label: 'Nasdaq', pct: -0.94 }, { label: 'S&P 500', pct: -0.62 }];
v('le taux ne prend pas la tête de la ligne', /^Nasdaq/.test(S.lignePerf(avecTaux)), S.lignePerf(avecTaux));
v('il est rendu en fin de ligne, en points de base', /10 ans US \+9 pb$/.test(S.lignePerf(avecTaux)), S.lignePerf(avecTaux));
const syT = S.synthese('New York', avecTaux, []);
v('la synthèse ne désigne pas un taux comme plus fort mouvement', /Nasdaq −0,94 %/.test(syT), syT);
v('…et n\'écrit jamais un taux en pourcentage', !/10 ans US \+2/.test(syT), syT);

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

console.log('\n── 7b. Les chiffres sont ranges par famille, comme le Récap Quotidien ──');
const FAM = [
  ['German Prelim CPI m/m', 'Inflation'], ['Core PCE Price Index m/m', 'Inflation'],
  // Les salaires vont dans EMPLOI, pas dans Inflation : c'est le classement du Récap Quotidien
  // (ils font partie du rapport emploi), et c'est lui qui fait foi.
  ['Average Hourly Earnings m/m', 'Emploi'],
  ['Claimant Count Change', 'Emploi'], ['Unemployment Claims', 'Emploi'], ['Non-Farm Employment Change', 'Emploi'],
  ['Prelim GDP q/q', 'Croissance économique'], ['Ifo Business Climate', 'Croissance économique'],
  ['ISM Manufacturing PMI', 'Croissance économique'], ['CB Consumer Confidence', 'Croissance économique'],
  ['Federal Funds Rate', 'Politique monétaire'], ['ECB Press Conference', 'Politique monétaire'],
  ['FOMC Meeting Minutes', 'Politique monétaire'], ['Fed Chair Powell Speaks', 'Politique monétaire'],
  ['Trade Balance', 'Commerce'], ['Crude Oil Inventories', 'Autres'],
];
FAM.forEach(([t, att]) => v(`« ${t} » → ${att}`, S.famille(t) === att, S.famille(t)));
// Les noms ET l'ordre sont ceux du Recap Quotidien (_ORDRE_FAM) : deux rapports lus a la suite le
// meme jour doivent ranger pareil, sinon le lecteur se reoriente a chaque fois.
v('mêmes familles, même ordre que le Quotidien',
  S.ORDRE_FAM.join('|') === 'Inflation|Croissance économique|Emploi|Politique monétaire|Commerce|Autres', S.ORDRE_FAM.join('|'));
const g = S.parFamille([
  { titre: 'Claimant Count Change', ligne: 'A' }, { titre: 'German Prelim CPI m/m', ligne: 'B' },
  { titre: 'Prelim GDP q/q', ligne: 'C' }, { titre: 'Ifo Business Climate', ligne: 'D' },
]);
v('l\'affichage suit l\'ordre du Quotidien', g.map(x => x.famille).join('|') === 'Inflation|Croissance économique|Emploi', g.map(x => x.famille).join('|'));
v('les lignes d\'une même famille restent groupées', (g.find(x => x.famille === 'Croissance économique') || {}).lignes.join('') === 'CD');
v('une famille sans chiffre ne s\'écrit pas', !g.some(x => x.famille === 'Commerce'));
v('une entrée sans ligne est ignorée', S.parFamille([{ titre: 'CPI', ligne: '' }]).length === 0);
v('aucune entrée → aucun groupe', S.parFamille([]).length === 0);
// Le regroupement est bien branche dans le recap, et il remplace la liste plate.
const srv = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
v('le récap groupe par famille', /const groupes = _SEA\.parFamille\(entrees\);/.test(srv));
v('la liste plate « Chiffres de la séance » a disparu', !/'Chiffres de la séance'/.test(srv));

console.log('\n── 7c. La rubrique MACRO du rapport REELLEMENT lu ──');
/* Le recap de seance que l utilisateur lit est le wrap SEGMENTE PAR L IA (sections Geopolitique ·
   Macro · Analyse de seance · A surveiller), pas les puces deterministes. Sa rubrique Macro sortait
   en liste plate. On la range, avec la MEME table que le Quotidien, et on le range NOUS : l IA ecrit,
   le code classe -- elle ne peut donc ni inventer une famille ni en oublier une. */
const MACRO = [
  '**Ifo Business Climate** Allemagne août : 88,8 (vs 87,2 att.) → surprise haussière.',
  '**Confiance des consommateurs** France août : 86 (vs 87 att.) → léger recul.',
  '**PIB** Allemagne T2 final : +0,3% t/t → révision à la hausse.',
  'La **BoJ** laisse son taux directeur inchangé → yen stable.',
  'Les **inscriptions au chômage** américaines reculent à 230K.',
  "L'**inflation** allemande accélère à 2,3% → pression sur la BCE.",
];
const gm = S.parFamille(MACRO.map(i => ({ titre: i, ligne: i })));
v('la Macro est bien decoupee en familles', gm.length >= 4, gm.map(x => x.famille).join(' | '));
v('elle suit l ordre du Quotidien', gm.map(x => x.famille).join('|') === 'Inflation|Croissance économique|Emploi|Politique monétaire', gm.map(x => x.famille).join('|'));
v('aucune puce ne tombe en « Autres »', !gm.some(x => x.famille === 'Autres'), gm.map(x => x.famille).join('|'));
v('les trois indicateurs de croissance sont ensemble', (gm.find(x => x.famille === 'Croissance économique') || { lignes: [] }).lignes.length === 3);
// Les banques centrales appartiennent a Macro dans le Quotidien : elles doivent y etre ici aussi.
[['La Fed maintient ses taux, ton hawkish', 'Politique monétaire'], ['Federal Funds Rate', 'Politique monétaire'],
 ['ECB Press Conference', 'Politique monétaire'], ['Claimant Count Change', 'Emploi']]
  .forEach(([t, att]) => v(`« ${t.slice(0, 34)} » → ${att}`, S.famille(t) === att, S.famille(t)));
// Un chiffre d inflation cite AVEC une banque centrale reste de l inflation : c est le chiffre le sujet.
v('inflation citee avec une banque centrale reste Inflation', S.famille("l'inflation pousse la BCE à temporiser") === 'Inflation');
const srv2 = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const wsg = require('fs').readFileSync(require('path').join(__dirname, '..', 'wrapseg.js'), 'utf8');
v('le rapport segmente groupe sa Macro', /const groupes = _SEA\.parFamille\(r\.entrees\);/.test(wsg));
v('un groupe unique ne recoit pas de sous-titre', /if \(groupes\.length > 1\)/.test(wsg));
v('la version de segmentation a ete bumpee', /const SW_SEG_VER  = 'v14:'/.test(srv2));

console.log('\n── 7c-bis. La table de classement, partagée MOT POUR MOT par les trois rapports ──');
/* La même table vit dans seance.js (récaps de séance), public/js/app.js (Récap Quotidien du desk) et
   mailer.js (l'e-mail). Trois copies : si l'une dérive, un même chiffre change de famille selon
   l'endroit où on le lit — et personne ne s'en aperçoit. On compare donc les trois LIGNE À LIGNE.
   Cette garde manquait ; elle est posée le 26/08, en même temps que l'élargissement de la table. */
const fs2 = require('fs'), pa2 = require('path');
const lignesFam = f => {
  const src = fs2.readFileSync(pa2.join(__dirname, '..', f), 'utf8');
  return (src.match(/\['(?:Inflation|Emploi|Croissance économique|Politique monétaire|Commerce)', \/.*?\/i\]/g) || []);
};
const tSea = lignesFam('seance.js'), tApp = lignesFam('public/js/app.js'), tMail = lignesFam('mailer.js');
v('la table est bien retrouvée dans les trois fichiers', tSea.length === 5 && tApp.length === 5 && tMail.length === 5, `${tSea.length}/${tApp.length}/${tMail.length}`);
tSea.forEach((l, i) => {
  const fam = (l.match(/^\['([^']+)'/) || [])[1];
  v(`« ${fam} » identique dans le desk`, l === tApp[i], 'seance.js ≠ app.js');
  v(`« ${fam} » identique dans l'e-mail`, l === tMail[i], 'seance.js ≠ mailer.js');
});
v('l\'ordre d\'affichage est le même partout', /const _ORDRE_FAM = \['Inflation', 'Croissance économique', 'Emploi', 'Politique monétaire', 'Commerce', 'Autres'\]/.test(fs2.readFileSync(pa2.join(__dirname, '..', 'public/js/app.js'), 'utf8'))
  && S.ORDRE_FAM.join('|') === "Inflation|Croissance économique|Emploi|Politique monétaire|Commerce|Autres");

console.log('\n── 7c-ter. Ce que le calendrier apporte, la table doit savoir le ranger ──');
/* Les puces d'un récap parlent d'une dizaine d'indicateurs ; le CALENDRIER en publie des centaines.
   En complétant la Macro avec le calendrier, on a mesuré 21 intitulés sur 74 qui tombaient en
   « Autres » — une rubrique qui prétend classer et qui range un quart des lignes dans le fourre-tout
   ne classe pas. La table est élargie ici, aux TROIS endroits à la fois. */
const RANGEMENTS = [
  ['Existing Home Sales', 'Croissance économique'], ['Pending Home Sales m/m', 'Croissance économique'],
  ['HPI m/m', 'Croissance économique'], ['Nationwide HPI m/m', 'Croissance économique'],
  ['Business Inventories m/m', 'Croissance économique'], ['Wholesale Inventories m/m', 'Croissance économique'],
  ['Personal Spending m/m', 'Croissance économique'], ['Personal Income m/m', 'Croissance économique'],
  ['Sentix Investor Confidence', 'Croissance économique'], ['GfK Consumer Climate', 'Croissance économique'],
  ['Economic Sentiment Indicator', 'Croissance économique'], ['Leading Index m/m', 'Croissance économique'],
  ['Tertiary Industry Activity m/m', 'Croissance économique'], ['Vehicle Sales', 'Croissance économique'],
  ['Consumer Credit m/m', 'Croissance économique'], ['Prelim Machine Tool Orders y/y', 'Croissance économique'],
  ['M3 Money Supply y/y', 'Politique monétaire'], ['Private Loans y/y', 'Politique monétaire'],
];
RANGEMENTS.forEach(([t2, att]) => v(`« ${t2} » → ${att}`, S.famille(t2) === att, S.famille(t2)));
/* LE PIÈGE « \bfed\b ». « Philly Fed Manufacturing Index » est une enquête d'activité régionale, pas
   une décision de la Fed : il tombait en Politique monétaire à cause du seul mot « Fed », dans le
   Récap Quotidien comme ailleurs. La règle d'enquête régionale est testée AVANT — sans emporter les
   discours de banquiers centraux, qui doivent rester en Politique monétaire. */
[['Philly Fed Manufacturing Index', 'Croissance économique'], ['Dallas Fed Manufacturing Index', 'Croissance économique'],
 ['KC Fed Manufacturing Index', 'Croissance économique'], ['Empire State Manufacturing Index', 'Croissance économique'],
 ['Richmond Manufacturing Index', 'Croissance économique'], ['Dallas Fed President Speaks', 'Politique monétaire'],
 ['Fed Chair Powell Speaks', 'Politique monétaire'], ['FOMC Meeting Minutes', 'Politique monétaire'],
 ['Federal Funds Rate', 'Politique monétaire'], ['BOJ Gov Ueda Speaks', 'Politique monétaire']]
  .forEach(([t2, att]) => v(`« ${t2} » → ${att}`, S.famille(t2) === att, S.famille(t2)));
// Un stock d'énergie n'est pas une famille macro : « Autres » est la réponse honnête, pas un défaut.
v('les stocks pétroliers restent en « Autres »', S.famille('Crude Oil Inventories') === 'Autres');
v('les élargissements n\'ont pas mangé l\'inflation', S.famille('Core PCE Price Index m/m') === 'Inflation' && S.famille('CPI m/m') === 'Inflation');
v('ni l\'emploi', S.famille('Employment Level') === 'Emploi' && S.famille('Claimant Count Change') === 'Emploi');
v('ni le commerce', S.famille('Trade Balance') === 'Commerce' && S.famille('Current Account') === 'Commerce');

console.log('\n── 7d. La MACRO est COMPLÉTÉE par notre calendrier ──');
/* « check les news sorties durant la session, classe les dans leur catégories de la partie macro »
   (26/08). Le wrap ne raconte que ce que SON auteur a retenu ; notre calendrier sait tout ce qui est
   tombé pendant la fenêtre. On complète — sans jamais répéter ce qui est déjà dit. */
const H = 3600000;
const JOUR = Date.parse('2026-08-26T00:00:00Z');                 // mercredi, heure d'été (Paris = UTC+2)
const CAL = [
  { timestamp: JOUR + 8 * H,  currency: 'EUR', title: 'German Ifo Business Climate', actual: '88.6', forecast: '88.0', previous: '88.2', impact: 'Medium' },
  { timestamp: JOUR + 6.75*H, currency: 'EUR', title: 'French Consumer Confidence',  actual: '87',   forecast: '88',   previous: '89',   impact: 'Low' },
  { timestamp: JOUR + 6 * H,  currency: 'GBP', title: 'Retail Sales m/m',            actual: '0.6%', forecast: '0.3%', previous: '0.1%', impact: 'High' },
  { timestamp: JOUR + 12* H,  currency: 'EUR', title: 'German Prelim CPI m/m',       actual: '0.1%', forecast: '0.1%', previous: '0.3%', impact: 'High' },
  { timestamp: JOUR + 20* H,  currency: 'USD', title: 'CB Consumer Confidence',      actual: '94.1', forecast: '96.5', previous: '98.7', impact: 'High' },
  { timestamp: JOUR + 9 * H,  currency: 'EUR', title: 'ECB Lane Speaks',             actual: '',     forecast: '',     previous: '',     impact: 'Medium' },
  { timestamp: JOUR + 3 * H,  currency: 'JPY', title: 'BOJ Core CPI y/y',            actual: '2.4%', forecast: '2.3%', previous: '2.3%', impact: 'Medium' },
];
const WRAP_LDN = { session: 'European', timestamp: JOUR + 10 * H };
const bw = S.bornesPourWrap(WRAP_LDN, JOUR + 23 * H);
v('la fenêtre du récap de séance est celle de SA séance', bw && bw.nom === 'Londres');
v('elle commence à 08h00 Paris', bw && bw.debutTs === JOUR + 6 * H, bw && new Date(bw.debutTs).toISOString());
v('elle va jusqu\'au bout de la séance, pas jusqu\'à la publication', bw && bw.finTs === JOUR + 16 * H, bw && new Date(bw.finTs).toISOString());
v('elle ne dépasse jamais maintenant', S.bornesPourWrap(WRAP_LDN, JOUR + 11 * H).finTs === JOUR + 11 * H);
v('un article qui n\'est pas un récap de séance n\'a pas de fenêtre', S.bornesPourWrap({ session: 'Global', timestamp: JOUR }, JOUR) === null);
v('ni un récap sans horodatage', S.bornesPourWrap({ session: 'European', timestamp: 0 }, JOUR) === null);

const dansLdn = S.trierMacro(S.filtreFenetre(CAL, bw));
v('seules les devises de la séance sont retenues', dansLdn.every(e => ['EUR', 'GBP', 'CHF'].includes(e.currency)), dansLdn.map(e => e.currency).join(','));
v('le CPI japonais de 05h00 est hors séance Londres', !dansLdn.some(e => /BOJ/.test(e.title)));
v('la confiance US de 22h00 est hors séance Londres', !dansLdn.some(e => /CB Consumer/.test(e.title)));
v('un rendez-vous sans résultat n\'est pas une publication', !dansLdn.some(e => /Lane Speaks/.test(e.title)));
v('les forts d\'abord, puis l\'heure', dansLdn.map(e => e.title).join(' > ') === 'Retail Sales m/m > German Prelim CPI m/m > French Consumer Confidence > German Ifo Business Climate', dansLdn.map(e => e.title).join(' > '));

// L'anti-doublon : ce que l'IA a déjà écrit ne se répète pas, ce qu'elle a omis s'ajoute.
const PUCES = [
  "L'indice **Ifo** du climat des affaires en Allemagne ressort à 88,6 → surprise haussière.",
  'La **confiance des consommateurs** en France recule à 87 → plus bas depuis avril.',
  'Les **ventes au détail** au Royaume-Uni progressent de 0,6% m/m → **GBP** se renforce.',
];
const dd = (t, att) => { const e = CAL.find(x => x.title === t); v(`« ${t} » ${att ? 'déjà dit' : 'à ajouter'}`, S.dejaDit(e, PUCES) === att, 'a rendu ' + S.dejaDit(e, PUCES)); };
dd('German Ifo Business Climate', true);          // sigle distinctif
dd('French Consumer Confidence', true);           // deux mots communs + même pays
dd('Retail Sales m/m', true);                     // deux mots communs (bilingue FR↔EN)
dd('German Prelim CPI m/m', false);               // absente des puces
dd('CB Consumer Confidence', false);              // MÊMES MOTS que la France, PAYS DIFFÉRENT
/* LE PAYS TRANCHE. « US Consumer Confidence » partageait « consumer » et « confidence » avec la puce
   française et disparaissait — la publication américaine sautait du Macro, exactement le trou que
   cette rubrique doit boucher. Le pays se lit dans l'intitulé, à défaut dans la devise. */
v('le pays se lit dans l\'intitulé', S.dejaDit({ title: 'US Consumer Confidence', currency: 'USD', actual: '94.1' }, PUCES) === false);
v('à défaut, la devise le donne', S.dejaDit({ title: 'CB Consumer Confidence', currency: 'USD', actual: '94.1' }, PUCES) === false);
v('une puce sans pays reste comparable à tout', S.dejaDit({ title: 'Retail Sales m/m', currency: 'GBP', actual: '0.6%' }, ['Les ventes au détail progressent de 0,6% m/m']) === true);
v('un chiffre publié suffit à reconnaître la publication', S.dejaDit({ title: 'Machin Index', currency: 'EUR', actual: '88.6' }, PUCES) === true);
v('un chiffre trop court ne prouve rien', S.dejaDit({ title: 'Machin Index', currency: 'EUR', actual: '87' }, ['La cote est à 87 % chez les bookmakers']) === false);
v('sans puces, rien n\'est déjà dit', S.dejaDit(CAL[0], []) === false);

// Les lignes ajoutées portent le style du desk et se rangent avec les puces de l'IA.
const ajouts = dansLdn.filter(e => !S.dejaDit(e, PUCES));
v('une seule publication manquait', ajouts.length === 1 && ajouts[0].title === 'German Prelim CPI m/m', ajouts.map(e => e.title).join(','));
const lmd = S.ligneMacroMd(ajouts[0], '14h00');
v('la ligne ajoutée est chiffrée', /0\.1%/.test(lmd) && /conforme aux attentes/.test(lmd), lmd);
v('elle porte l\'heure de Paris', /^14h00 /.test(lmd), lmd);
v('devise et indicateur en gras, comme les puces de l\'IA', /\*\*EUR\*\*/.test(lmd) && /\*\*German Prelim CPI m\/m\*\*/.test(lmd), lmd);
v('une publication sans résultat ne produit aucune ligne', S.ligneMacroMd({ currency: 'EUR', title: 'ECB Lane Speaks' }, '11h00') === '');
const fusion = S.parFamille([...PUCES.map(i => ({ titre: i, ligne: i })), { titre: ajouts[0].title, ligne: lmd }]);
v('la ligne ajoutée se range dans sa famille', (fusion.find(g => g.famille === 'Inflation') || { lignes: [] }).lignes.some(l => l === lmd), fusion.map(g => g.famille).join('|'));
v('elle ne tombe pas en « Autres »', !fusion.some(g => g.famille === 'Autres' && g.lignes.includes(lmd)));

// Chaque séance lit SA fenêtre : les trois récaps du jour sont traités, pas seulement celui de Londres.
const parSess = { 'Asia-Pacific': 'BOJ Core CPI y/y', 'European': 'German Prelim CPI m/m', 'Americas': 'CB Consumer Confidence' };
Object.entries(parSess).forEach(([sess, attendu]) => {
  const b = S.bornesPourWrap({ session: sess, timestamp: JOUR + 10 * H }, JOUR + 23 * H);
  const evs = S.trierMacro(S.filtreFenetre(CAL, b));
  v(`séance « ${sess} » → ${attendu}`, evs.some(e => e.title === attendu), evs.map(e => e.title).join(',') || '(aucune)');
});


console.log('\n── 7e. LE RAPPORT RENDU — tel que l\'utilisateur le lit ──');
/* Le rendu complet est un module PUR (wrapseg.js) : on le rend ici pour de vrai, avec les sections
   d'un wrap et les publications du calendrier, et on regarde le HTML sortant. C'est le seul contrôle
   qui prouve que la Macro affichée EST complétée, rangée, et sans doublon. */
const W = require('../wrapseg');
const SECTIONS = [
  { section: 'LEAD', items: ['Séance européenne calme, **EUR** stable avant le CPI allemand.'] },
  { section: 'Géopolitique', items: ['Négociations en cours → prime de risque en repli.'] },
  { section: 'Macro', items: PUCES.slice() },
  { section: 'Analyse de séance', items: ['**DXY** recule de 0,2%.'] },
  { section: 'À surveiller', items: ['**CPI** US demain → catalyseur Fed.'] },
];
const rendu = W.html(SECTIONS, dansLdn);
v('la publication manquante apparaît dans le rendu', /German Prelim CPI m\/m/.test(rendu.html), rendu.html.slice(0, 200));
v('le rendu le compte', rendu.ajouts === 1, String(rendu.ajouts));
v('elle est chiffrée dans le rendu', /0\.1%, conforme aux attentes/.test(rendu.html));
v('elle porte son heure de Paris', /14h00 \*\*EUR\*\*/.test(rendu.html), (rendu.html.match(/\d\dh\d\d \*\*EUR\*\*/) || [])[0]);
const nbIfo = (rendu.html.match(/Ifo/g) || []).length;
v('l\'Ifo déjà raconté n\'est PAS répété', nbIfo === 1, nbIfo + ' occurrence(s)');
v('la confiance française non plus', (rendu.html.match(/onfiance des consommateurs/g) || []).length === 1);
v('les ventes au détail non plus', (rendu.html.match(/entes au détail/g) || []).length === 1);
v('la Macro est découpée en familles', /<strong>Macro<\/strong><em>Inflation<\/em>/.test(rendu.html), rendu.html.slice(rendu.html.indexOf('<strong>Macro'), rendu.html.indexOf('<strong>Macro') + 120));
v('les autres rubriques restent intactes', /<strong>Géopolitique<\/strong><ul><li>Négociations/.test(rendu.html));
v('l\'ordre des rubriques est conservé', rendu.html.indexOf('<strong>Géopolitique') < rendu.html.indexOf('<strong>Macro') && rendu.html.indexOf('<strong>Macro') < rendu.html.indexOf('<strong>Analyse de séance'));
v('le HTML est échappé', W.html([{ section: 'Macro', items: ['<script>x</script>'] }], []).html.includes('&lt;script&gt;'));

// Sans calendrier, le rapport est EXACTEMENT celui d'avant : la complétion n'abîme rien.
const sansCal = W.html(SECTIONS, []);
v('sans calendrier, le rendu est inchangé', sansCal.ajouts === 0 && !/German Prelim CPI/.test(sansCal.html));
// Les trois puces tombent dans la MÊME famille : un groupe unique ne prend pas de sous-titre. C'est
// le CPI venu du calendrier qui ouvre « Inflation » — la complétion crée le découpage, elle ne le simule pas.
v('une famille unique ne prend pas de sous-titre', !/<strong>Macro<\/strong><em>/.test(sansCal.html));
v('c\'est la publication ajoutée qui ouvre « Inflation »', /<em>Inflation<\/em>/.test(rendu.html) && !/<em>Inflation<\/em>/.test(sansCal.html));

// L'article ne parlait d'aucune donnée : la rubrique Macro doit NAÎTRE du calendrier.
const sansMacro = [SECTIONS[0], SECTIONS[1], SECTIONS[3], SECTIONS[4]];
const ne = W.html(sansMacro, dansLdn);
v('une Macro absente naît du calendrier', /<strong>Macro<\/strong>/.test(ne.html));
v('elle porte les quatre publications de la séance', ne.ajouts === 4, String(ne.ajouts));
v('elle se place après Géopolitique, pas en fin de rapport', ne.html.indexOf('<strong>Macro') > ne.html.indexOf('<strong>Géopolitique') && ne.html.indexOf('<strong>Macro') < ne.html.indexOf('<strong>Analyse de séance'));
v('sans Géopolitique, elle suit le LEAD', (() => { const h = W.html([SECTIONS[0], SECTIONS[3]], dansLdn).html; return h.indexOf('<strong>Macro') < h.indexOf('<strong>Analyse de séance'); })());
// Aucune donnée nulle part → aucune rubrique Macro inventée.
v('pas de calendrier et pas de Macro → aucune rubrique vide', !/<strong>Macro<\/strong>/.test(W.html(sansMacro, []).html));
v('une rubrique sans contenu ne s\'écrit pas', !/Vide/.test(W.html([{ section: 'Vide', items: [] }, SECTIONS[0]], []).html));

console.log('\n── 7f. Le câblage côté serveur ──');
const srv3 = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
v('le serveur rend via le module pur', /const r = _WSEG\.html\(JSON\.parse\(m\[0\]\), _macroCalendrierPourWrap\(item\)\);/.test(srv3));
v('le récap est passé au segmenteur (préchauffage)', /_segmentWrapAI\(points, \{ noClaude: true \}, item\)/.test(srv3));
v('… à la re-segmentation du jour', /_segmentWrapAI\(points, \{\}, w\)/.test(srv3));
v('… et à l\'ouverture du rapport', /_segmentWrapAI\(points, \{\}, cached\)/.test(srv3));
v('la complétion est tracée dans les logs', /Macro complétée par notre calendrier/.test(srv3));
/* « et compare au calendrier éco de ce jour » : une route admin met face à face, pour CHAQUE récap
   du jour, la Macro du rapport publié et tout ce que le calendrier a enregistré sur la fenêtre. */
v('une route compare le rapport au calendrier du jour', /app\.get\('\/api\/admin\/wrap-macro-apercu', requireAdmin/.test(srv3));
v('elle couvre les trois séances du jour', /_SEA\.TYPE_PAR_SESSION\[String\(w\.session \|\| ''\)\] && _jourParis\(w\.timestamp\) === jour/.test(srv3));
v('elle relit la Macro du rapport RÉELLEMENT publié', /seg\.split\(\/<strong>\/i\)\.find/.test(srv3));
v('elle marque chaque publication « déjà dit » ou « AJOUTÉE »', /deja \? 'déjà dit' : 'AJOUTÉE'/.test(srv3));
v('elle ne publie rien et n\'appelle aucune IA', !/wrap-macro-apercu[\s\S]{0,2600}?(generateText|aiNote\()/.test(srv3));
/* Le préchauffage tourne au boot. S'il segmente un récap avant que le calendrier ne soit chargé, la
   Macro part amputée — ET EN CACHE. On saute le tour plutôt que de figer un rapport incomplet. */
v('on ne segmente pas un récap de séance calendrier vide', /if \(_SEA\.TYPE_PAR_SESSION\[String\(item\.session \|\| ''\)\] && !_calPret\(\)\) return false;/.test(srv3));
v('une seule implémentation des bornes', /const _bornesSeance = \(reportType, now, finRef\) => _SEA\.bornes/.test(srv3));

console.log('\n── 8. Mise à jour automatique des récaps du jour ──');
/* Le format de séance porte une version, et les récaps déjà publiés sous une version périmée se
   refont AU DÉMARRAGE. Sans ce mécanisme, une amélioration ne touchait que les récaps à venir et il
   fallait appeler trois routes à la main — ce n'est pas publier, c'est déléguer. */
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
v('le format de séance porte une version', /const SEANCE_VER = \d+;/.test(src));
v('elle est posée sur les récaps de séance, et sur eux seuls',
  /if \(_SEA\.FENETRES\[reportType\]\) item\._seanceVer = SEANCE_VER;/.test(src));
v('un rattrapage tourne au démarrage', /_rattraperSeancesDuJour\(\)/.test(src));
v('il ne refait QUE les récaps au format périmé', /publie\._seanceVer === SEANCE_VER\) continue;/.test(src));
v('il ignore une séance qui n\'a pas commencé', /now < b\.debutTs\) continue;/.test(src));
v('il ne republie pas un récap qui n\'existe pas', /if \(!publie\) continue;/.test(src));
v('il attend la première mesure de performance', /\}, 90000\);/.test(src));
v('une seule fois par démarrage', /_seanceRattrapFait = true;/.test(src));
// Un récap refait à partir d'une fenêtre vidée serait plus MAIGRE que celui qu'il remplace : il
// gagnerait trois rubriques chiffrées et perdrait son récit. On compte la matière avant de toucher.
v('il compte la matière encore disponible avant de refaire', /const matiere = allNews\.filter/.test(src));
v('il ne remplace pas un récap par un plus pauvre', /if \(matiere < Math\.max\(5, avant\)\)/.test(src));
v('et il le dit au lieu de le taire', /rattrapage NON fait \(matière insuffisante/.test(src));

console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
process.exit(ko ? 1 : 0);

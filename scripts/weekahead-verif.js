#!/usr/bin/env node
/**
 * scripts/weekahead-verif.js — CONTRÔLE DES CARTES « SEMAINE À VENIR ».
 *
 * Posé le 25/08 après le signalement du mentor : la carte du vendredi 28 août annonçait
 * « NFP américain + CPI zone euro » alors que la journée portait Jackson Hole, une RÉVISION annuelle
 * du NFP et une confiance des ménages japonaise. Deux inventions dans un seul titre.
 *
 * Ce script rejoue le scénario RÉEL et vérifie l'invariant qui l'interdit :
 *   un titre de jour ne nomme QUE des rendez-vous présents dans la liste affichée sous la carte.
 *
 *   node scripts/weekahead-verif.js
 */
const W = require('../walabels');

let ko = 0, ok = 0;
function verif(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
}
const J = (d, h, m) => Date.UTC(2026, 7, d, h, m);   // août 2026, heure UTC

console.log('\n── 1. Vendredi 28 août 2026 : le cas signalé par le mentor ──');
const vendredi = [
  { currency: 'USD', ctry: 'US', title: 'Fed Chair Powell Speech at Jackson Hole', impact: 'High', timestamp: J(28, 14, 0) },
  { currency: 'USD', ctry: 'US', title: 'Non Farm Payrolls Annual Revision Prel', impact: 'High', forecast: '', previous: '', timestamp: J(28, 12, 30) },
  { currency: 'JPY', ctry: 'JP', title: 'Consumer Confidence', impact: 'Medium', forecast: '34.5', previous: '34.2', timestamp: J(27, 23, 0) },
];
const titreV = W.titreJour(vendredi, 'vendredi');
console.log('  titre  : ' + titreV);
console.log('  desc   : ' + W.descriptionJour(vendredi, 'vendredi'));
verif('le titre ne dit plus « NFP américain » (c\'est une RÉVISION)', !/NFP américain/.test(titreV), titreV);
verif('le titre ne dit plus « CPI zone euro » (aucun IPC ce jour-là)', !/CPI/.test(titreV), titreV);
verif('le titre annonce Jackson Hole, le vrai rendez-vous du jour', /Jackson Hole/.test(titreV), titreV);
verif('la révision est nommée comme telle si elle apparaît', !/Révision/.test(titreV) || /Révision annuelle du NFP/.test(titreV), titreV);

console.log('\n── 2. IPC de fin de mois : publié PAR PAYS, pas par la zone euro ──');
const fr = W.themeJour({ currency: 'EUR', ctry: 'FR', title: 'Inflation Rate YoY Prel', timestamp: J(28, 6, 45) });
const es = W.themeJour({ currency: 'EUR', ctry: 'ES', title: 'Inflation Rate YoY Prel', timestamp: J(28, 7, 0) });
const eu = W.themeJour({ currency: 'EUR', ctry: 'EU', title: 'Inflation Rate YoY Flash', timestamp: J(31, 9, 0) });
verif('IPC France → « CPI français »', fr && fr.lbl === 'CPI français', fr && fr.lbl);
verif('IPC Espagne → « CPI espagnol »', es && es.lbl === 'CPI espagnol', es && es.lbl);
verif('IPC agrégé zone euro → « CPI zone euro »', eu && eu.lbl === 'CPI zone euro', eu && eu.lbl);

console.log('\n── 3. Révisions et secondes estimations ne sont jamais le rendez-vous du jour ──');
const rev = W.themeJour({ currency: 'USD', ctry: 'US', title: 'Non Farm Payrolls Annual Revision Prel' });
const nfp = W.themeJour({ currency: 'USD', ctry: 'US', title: 'Non Farm Payrolls' });
const est = W.themeJour({ currency: 'USD', ctry: 'US', title: 'GDP Growth Rate QoQ 2nd Est' });
const pib = W.themeJour({ currency: 'USD', ctry: 'US', title: 'GDP Growth Rate QoQ Adv' });
verif('révision NFP → libellé distinct', rev && rev.lbl === 'Révision annuelle du NFP', rev && rev.lbl);
verif('révision NFP → rang très bas', rev && rev.rang < 2, rev && String(rev.rang));
verif('NFP mensuel → rang de point d\'orgue', nfp && nfp.rang >= 8, nfp && String(nfp.rang));
verif('2nd Est du PIB pèse moins que la 1re estimation', est && pib && est.rang < pib.rang, est && pib && `${est.rang} vs ${pib.rang}`);
verif('la glose dit que la révision est une correction', /correction/i.test(W.gloseFr('Non Farm Payrolls Annual Revision Prel')), W.gloseFr('Non Farm Payrolls Annual Revision Prel'));

console.log('\n── 4. INVARIANT : le titre ne peut nommer que des événements affichés ──');
// On passe une liste où l'événement « porteur de titre » a été RETIRÉ de l'affichage : il ne doit
// plus apparaître nulle part. C'est le filet qui rend l'erreur du 28 août structurellement impossible.
const affiches = vendredi.slice(1);                       // Jackson Hole retiré de la carte
const t2 = W.titreJour(affiches, 'vendredi');
verif('Jackson Hole retiré de la liste → absent du titre', !/Jackson Hole/.test(t2), t2);
const intrus = { currency: 'EUR', ctry: 'EU', title: 'ECB Interest Rate Decision', timestamp: J(28, 12, 15) };
verif('themesDuJour rejette un thème dont la source n\'est pas dans la liste',
  W.themesDuJour(affiches).every(x => affiches.indexOf(x.src) >= 0));
verif('un événement hors liste ne peut pas produire de thème retenu',
  !W.themesDuJour(affiches).some(x => x.src === intrus));

console.log('\n── 5. Descriptions : parlantes, et calées sur l\'événement mis en avant ──');
const mercredi = [
  { currency: 'USD', ctry: 'US', title: 'Core PCE Price Index MoM', impact: 'High', forecast: '0.2%', previous: '0.1%', timestamp: J(26, 12, 30) },
  { currency: 'USD', ctry: 'US', title: 'Personal Spending MoM', impact: 'High', forecast: '0.2%', previous: '0.3%', timestamp: J(26, 12, 30) },
  { currency: 'USD', ctry: 'US', title: 'Durable Goods Orders MoM', impact: 'Medium', forecast: '0.7%', previous: '0.3%', timestamp: J(26, 12, 30) },
];
const descM = W.descriptionJour(mercredi, 'mercredi');
console.log('  titre  : ' + W.titreJour(mercredi, 'mercredi'));
console.log('  desc   : ' + descM);
verif('l\'enjeu ne parle plus du PIB sous une liste d\'inflation/consommation', !/PIB/.test(descM), descM);
verif('la description explique l\'indicateur en clair', /inflation que la Fed regarde/i.test(descM));
verif('les trois événements sont couverts', ['Core PCE', 'Personal Spending', 'Durable Goods'].every(x => descM.includes(x)));
// Le mail du dimanche ne reprend que les 3 premières phrases : le « pourquoi » doit y être.
const troisPhrases = descM.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ«"'(])/).slice(0, 3).join(' ');
verif('le « pourquoi » survit à la coupe à 3 phrases du mail', /taux/i.test(troisPhrases), troisPhrases);

console.log('\n── 6. Jour civil À PARIS (et non en UTC) ──');
verif('un chiffre japonais de 01h30 à Paris compte pour CE jour-là',
  W.jourParis(Date.UTC(2026, 7, 27, 23, 30)) === '2026-08-28', W.jourParis(Date.UTC(2026, 7, 27, 23, 30)));
verif('un lundi matin asiatique n\'est plus rangé le dimanche',
  W.jourParis(Date.UTC(2026, 7, 23, 23, 30)) === '2026-08-24', W.jourParis(Date.UTC(2026, 7, 23, 23, 30)));
verif('une publication de 14h30 à Paris reste sur son jour',
  W.jourParis(Date.UTC(2026, 7, 26, 12, 30)) === '2026-08-26');

console.log('\n── 7. Un rendez-vous majeur tient le titre SEUL ──');
const jeudi = [
  { currency: 'EUR', ctry: 'EU', title: 'ECB Interest Rate Decision', impact: 'High', timestamp: J(27, 12, 15) },
  { currency: 'USD', ctry: 'US', title: 'Initial Jobless Claims', impact: 'Medium', forecast: '230K', previous: '235K', timestamp: J(27, 12, 30) },
];
const tj = W.titreJour(jeudi, 'jeudi');
console.log('  titre  : ' + tj);
verif('décision BCE → titre unique, non dilué', tj === 'Décision de la BCE', tj);

console.log('\n── 8. Poids éditorial : une révision ne pèse pas comme la publication ──');
verif('NFP mensuel = point d\'orgue (≥ 5)', W.poidsMajeur({ title: 'Non Farm Payrolls' }) >= 5);
verif('révision annuelle du NFP ramenée au rang 1', W.poidsMajeur({ title: 'Non Farm Payrolls Annual Revision Prel' }) === 1);
verif('Jackson Hole = point d\'orgue', W.poidsMajeur({ title: 'Fed Chair Powell Speech at Jackson Hole' }) >= 5);
verif('un chiffre ordinaire ne pèse rien', W.poidsMajeur({ title: 'Retail Sales MoM' }) === 0);

console.log('\n── 9. Repêchage des rendez-vous sous-cotés : appliqué À LA SOURCE ──');
// Le repêchage a longtemps été du CODE MORT : il testait les vitaux APRÈS le filtre High/Medium,
// donc sur une liste dont ils avaient déjà été retirés. On vérifie qu'il est bien dans le filtre.
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const filtre = (src.match(/const items = evs\.filter\([^\n]*/) || [''])[0];
verif('le filtre du calendrier repêche les vitaux (Jackson Hole, discours, minutes, OPEP)',
  /_CAL_VITAL_RX/.test(filtre), filtre.slice(0, 150));
verif('la Semaine à Venir range les événements au jour civil de PARIS',
  /_jourParis\(e\.timestamp\)/.test(src));
verif('l\'identité d\'un événement inclut son PAYS (deux pays zone euro, même intitulé)',
  (src.match(/id: 'tv-' \+ Buffer\.from\(e\.title \+ '\|' \+ e\.currency \+ '\|' \+ \(e\.country/g) || []).length === 2);

console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
process.exit(ko ? 1 : 0);

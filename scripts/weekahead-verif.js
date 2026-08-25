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
let _attente = Promise.resolve();   // contrôles asynchrones (section 16) attendus avant le bilan

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
verif('décision BCE → titre unique, non dilué', tj === 'BCE', tj);

console.log('\n── 7b. VOCABULAIRE FOREXFACTORY (notre calendrier sert ses noms, pas ceux du flux) ──');
// La Semaine à Venir lit desormais « notre calendrier », c est-a-dire des lignes RENOMMEES en
// ForexFactory. Si les regles de themes ne connaissaient que le vocabulaire du fournisseur, la
// normalisation aurait tout casse : « Federal Funds Rate » ne ressemble pas a « rate decision ».
const FF = [
  [{ currency: 'USD', ctry: 'US', title: 'Federal Funds Rate' }, 'Décision de la Fed'],
  [{ currency: 'GBP', ctry: 'GB', title: 'Official Bank Rate' }, 'Décision de la BoE'],
  [{ currency: 'EUR', ctry: 'EU', title: 'Main Refinancing Rate' }, 'Décision de la BCE'],
  [{ currency: 'JPY', ctry: 'JP', title: 'BOJ Policy Rate' }, 'Décision de la BoJ'],
  [{ currency: 'CAD', ctry: 'CA', title: 'Overnight Rate' }, 'Décision de la BoC'],
  [{ currency: 'CHF', ctry: 'CH', title: 'SNB Policy Rate' }, 'Décision de la BNS'],
  [{ currency: 'NZD', ctry: 'NZ', title: 'Official Cash Rate' }, 'Décision de la RBNZ'],
  [{ currency: 'AUD', ctry: 'AU', title: 'Cash Rate' }, 'Décision de la RBA'],
  [{ currency: 'USD', ctry: 'US', title: 'FOMC Statement' }, 'Décision de la Fed'],
  [{ currency: 'USD', ctry: 'US', title: 'Non-Farm Employment Change' }, 'NFP américain'],
  [{ currency: 'USD', ctry: 'US', title: 'Unemployment Claims' }, 'Emploi américain'],
  [{ currency: 'USD', ctry: 'US', title: 'Prelim GDP q/q' }, 'PIB américain'],
  [{ currency: 'USD', ctry: 'US', title: 'Core PCE Price Index m/m' }, 'Inflation PCE américaine'],
  [{ currency: 'EUR', ctry: 'DE', title: 'German Prelim CPI m/m' }, 'CPI allemand'],
  [{ currency: 'USD', ctry: 'US', title: 'Core Retail Sales m/m' }, 'Ventes au détail américaines'],
  [{ currency: 'USD', ctry: 'US', title: 'ISM Manufacturing PMI' }, 'PMI américain'],
];
FF.forEach(([e, attendu]) => {
  const th = W.themeJour(e);
  verif(`« ${e.title} » → ${attendu}`, th && th.lbl === attendu, th ? th.lbl : '(aucun thème)');
});

console.log('\n── 7c. Les DEUX noms sont lus : renommer ne doit rien effacer ──');
// Piege majeur du passage aux noms ForexFactory : il nomme la revision annuelle comme le rapport
// mensuel. Sans lecture du nom d origine, la normalisation REINTRODUISAIT le bug du 28 aout.
const revFF = { currency: 'USD', ctry: 'US', title: 'Non-Farm Employment Change', _tvTitle: 'Non Farm Payrolls Annual Revision Prel' };
const thRev = W.themeJour(revFF);
verif('révision reconnue même sous le nom ForexFactory du rapport mensuel',
  thRev && thRev.lbl === 'Révision annuelle du NFP', thRev && thRev.lbl);
verif('sa glose avertit toujours que c\'est une correction', /correction/i.test(W.gloseEv(revFF)), W.gloseEv(revFF));
const jh = { currency: 'USD', ctry: 'US', title: 'Fed Chair Powell Speaks', _tvTitle: 'Fed Chair Powell Speech at Jackson Hole' };
verif('Jackson Hole survit au renommage ForexFactory', (W.themeJour(jh) || {}).lbl === 'Jackson Hole', (W.themeJour(jh) || {}).lbl);
verif('et garde la glose la plus précise des deux noms',
  /rendez-vous annuel des banquiers/.test(W.gloseEv(jh)), W.gloseEv(jh));
verif('l\'affichage ne montre QUE le nom ForexFactory', W.nomEv(jh) === 'USD Fed Chair Powell Speaks', W.nomEv(jh));

console.log('\n── 7d. Le libellé ne contredit plus sa propre glose ──');
const gdpRev = { currency: 'USD', ctry: 'US', title: 'Revised GDP q/q', _tvTitle: 'GDP Growth Rate QoQ 2nd Est' };
verif('une révision de PIB le dit dans son libellé', (W.themeJour(gdpRev) || {}).lbl === 'PIB américain (révision)', (W.themeJour(gdpRev) || {}).lbl);
verif('« French Prelim CPI » ne se voit pas accoler « (France) »',
  W.intituleAffiche({ currency: 'EUR', ctry: 'FR', title: 'French Prelim CPI m/m' }) === 'French Prelim CPI m/m');
verif('un intitulé muet sur le pays, lui, est complété',
  W.intituleAffiche({ currency: 'EUR', ctry: 'DE', title: 'Ifo Business Climate' }) === 'Ifo Business Climate (Allemagne)');
verif('l\'agrégat de la zone euro reste sans mention de pays',
  W.intituleAffiche({ currency: 'EUR', ctry: 'EU', title: 'Inflation Rate YoY Flash' }) === 'Inflation Rate YoY Flash');

console.log('\n── 7e. TITRES = LES TERMES DU CALENDRIER, courts (demande user 25/08) ──');
// « Moral des entreprises allemandes » ne dit rien à un lecteur de calendrier : il cherche « Ifo ».
// Le titre SITUE avec le terme du calendrier, la description EXPLIQUE en français.
const SG = [
  [{ currency: 'USD', ctry: 'US', title: 'Core PCE Price Index m/m' }, 'Core PCE USD'],
  [{ currency: 'USD', ctry: 'US', title: 'CPI m/m' }, 'CPI USD'],
  [{ currency: 'USD', ctry: 'US', title: 'PPI m/m' }, 'PPI USD'],
  [{ currency: 'USD', ctry: 'US', title: 'Prelim GDP q/q' }, 'GDP USD'],
  [{ currency: 'USD', ctry: 'US', title: 'Non-Farm Employment Change' }, 'NFP'],
  [{ currency: 'USD', ctry: 'US', title: 'Non Farm Payrolls Annual Revision Prel' }, 'NFP (rév.)'],
  [{ currency: 'USD', ctry: 'US', title: 'Federal Funds Rate' }, 'Fed'],
  [{ currency: 'GBP', ctry: 'GB', title: 'Official Bank Rate' }, 'BoE'],
  [{ currency: 'JPY', ctry: 'JP', title: 'BOJ Policy Rate' }, 'BoJ'],
  [{ currency: 'AUD', ctry: 'AU', title: 'RBA Meeting Minutes' }, 'RBA Minutes'],
  [{ currency: 'EUR', ctry: 'DE', title: 'German Ifo Business Climate' }, 'Ifo'],
  [{ currency: 'EUR', ctry: 'FR', title: 'French Prelim CPI m/m' }, 'CPI FR'],
  [{ currency: 'EUR', ctry: 'EU', title: 'Core CPI Flash Estimate y/y' }, 'Core CPI EUR'],
  [{ currency: 'USD', ctry: 'US', title: 'Jackson Hole Symposium' }, 'Jackson Hole'],
  [{ currency: 'USD', ctry: 'US', title: 'Fed Chair Powell Speech at Jackson Hole' }, 'Jackson Hole'],
  [{ currency: 'USD', ctry: 'US', title: 'Treasury Secretary Bessent Speech' }, 'Treasury'],
  [{ currency: 'USD', ctry: 'US', title: 'ISM Manufacturing PMI' }, 'ISM Manufacturing'],
  [{ currency: 'USD', ctry: 'US', title: 'Unemployment Claims' }, 'Jobless Claims USD'],
  [{ currency: 'USD', ctry: 'US', title: 'Durable Goods Orders m/m' }, 'Durable Goods USD'],
  [{ currency: 'GBP', ctry: 'GB', title: 'Retail Sales m/m' }, 'Retail Sales GBP'],
];
SG.forEach(([e, attendu]) => verif(`« ${e.title} » → ${attendu}`, W.sigleEv(e) === attendu, W.sigleEv(e)));
verif('un intitulé inconnu garde son nom de calendrier, nettoyé',
  W.sigleEv({ currency: 'USD', ctry: 'US', title: 'Wholesale Trade Sales m/m' }) === 'Wholesale Trade Sales USD',
  W.sigleEv({ currency: 'USD', ctry: 'US', title: 'Wholesale Trade Sales m/m' }));
verif('le pays prime sur la devise pour une publication nationale de la zone euro',
  W.codeEv({ currency: 'EUR', ctry: 'ES', title: 'x' }) === 'ES');
verif('l\'agrégat de la zone garde EUR', W.codeEv({ currency: 'EUR', ctry: 'EU', title: 'x' }) === 'EUR');
// Le titre reste court : c'est tout l'objet de la demande.
[[['Core PCE Price Index m/m', 'Durable Goods Orders m/m'], 'USD'], [['CPI m/m', 'Retail Sales m/m'], 'GBP']].forEach(([ts, c]) => {
  const t = W.titreJour(ts.map(x => ({ currency: c, ctry: c === 'USD' ? 'US' : 'GB', title: x, impact: 'High' })), 'lundi');
  verif(`« ${t} » tient en une ligne`, t.length <= 44, t.length + ' caractères');
});
// Le français n'a pas disparu : il a changé de place.
const dJ = W.descriptionJour([{ currency: 'EUR', ctry: 'DE', title: 'German Ifo Business Climate', impact: 'Medium', forecast: '88.5', previous: '88.6', timestamp: J(25, 8, 0) }], 'mardi');
verif('la description, elle, explique toujours en français', /moral des chefs d\'entreprise/.test(dJ), dJ);

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
verif('la Semaine à Venir passe par _calFfNames (noms ForexFactory)', /const up = _calFfNames\(upBrut\)/.test(src));
verif('« À surveiller » des récaps passe aussi par _calFfNames', /const propre = _calFfNames\(dans\)/.test(src));
verif('le nom ForexFactory de la décision de taux dépend de la BANQUE', /_FF_TAUX\s*=\s*\{/.test(src));
verif('l\'identité d\'un événement inclut son PAYS (deux pays zone euro, même intitulé)',
  (src.match(/id: 'tv-' \+ Buffer\.from\(e\.title \+ '\|' \+ e\.currency \+ '\|' \+ \(e\.country/g) || []).length === 2);

console.log('\n── 10. Rendez-vous qui s\'étalent : deux journées ne se ressemblent plus ──');
const JH = j => ({ currency: 'USD', ctry: 'US', title: 'Jackson Hole Symposium', impact: 'High', timestamp: J(26 + j, 0, 0) });
const d1 = W.descriptionJour([JH(1)], 'jeudi', { suite: { lbl: 'Jackson Hole', sigle: 'Jackson Hole', jour: 1, total: 3 } });
const d2 = W.descriptionJour([JH(2)], 'vendredi', { suite: { lbl: 'Jackson Hole', sigle: 'Jackson Hole', jour: 2, total: 3 } });
const d3 = W.descriptionJour([JH(3)], 'samedi', { suite: { lbl: 'Jackson Hole', sigle: 'Jackson Hole', jour: 3, total: 3, fin: true } });
console.log('  j2 : ' + d2);
verif('le titre du 2e jour le dit', W.titreJour([JH(2)], 'vendredi', { suite: { lbl: 'Jackson Hole', sigle: 'Jackson Hole', jour: 2, total: 3 } }) === 'Jackson Hole · jour 2');
verif('le dernier jour est nommé comme tel', W.titreJour([JH(3)], 'samedi', { suite: { lbl: 'Jackson Hole', sigle: 'Jackson Hole', jour: 3, total: 3, fin: true } }) === 'Jackson Hole · dernier jour');
verif('les trois descriptions sont DIFFÉRENTES', d1 !== d2 && d2 !== d3 && d1 !== d3);
verif('le 2e jour annonce sa deuxième journée', /^Jackson Hole, deuxième journée/.test(d2), d2.slice(0, 60));
verif('le dernier jour parle de bilan', /bilan de ces trois jours/.test(d3), d3.slice(0, 70));
// Un jour de suite qui porte AUSSI du neuf mène avec le neuf, pas avec la redite.
const mixte = [JH(3), { currency: 'USD', ctry: 'US', title: 'Non-Farm Employment Change', impact: 'High', forecast: '165K', previous: '142K', timestamp: J(29, 12, 30) }];
const tMix = W.titreJour(mixte, 'vendredi', { suite: { lbl: 'Jackson Hole', sigle: 'Jackson Hole', jour: 3, total: 3, fin: true } });
const dMix = W.descriptionJour(mixte, 'vendredi', { suite: { lbl: 'Jackson Hole', sigle: 'Jackson Hole', jour: 3, total: 3, fin: true } });
verif('ce qui est neuf passe devant dans le titre', /^NFP \+ Jackson Hole \(dernier jour\)$/.test(tMix), tMix);
verif('la description mène sur le neuf', /^Vendredi, 14h30 : USD Non-Farm Employment Change/.test(dMix), dMix.slice(0, 60));
verif('le symposium n\'est pas relisté après avoir été nommé', (dMix.match(/Jackson Hole/g) || []).length === 1, dMix);
verif('pas de majuscule parasite après les deux-points', !/ : [A-ZÀ-Þ]/.test(dMix.replace(/ : USD| : EUR| : GBP| : JPY/g, '')), dMix);

// La phrase d\'enjeu ne doit pas re-servir la glose : le lecteur lisait deux fois la même chose.
const tres = [{ currency: 'USD', ctry: 'US', title: 'Treasury Secretary Bessent Speech', impact: 'Medium', timestamp: J(24, 15, 0) }];
const dTres = W.descriptionJour(tres, 'lundi');
const glTres = W.gloseEv(tres[0]);
verif('l\'enjeu ne recopie pas la glose', dTres.split(glTres).length === 2, dTres);

// « Dernier jour » n\'est dit que si la fin est CONSTATÉE : un symposium qui court au-delà du
// vendredi ne montre que deux journées chez nous, l\'annoncer « dernière » serait faux.
const finInconnue = { lbl: 'Jackson Hole', sigle: 'Jackson Hole', jour: 2, total: 2 };   // pas de `fin`
verif('sans preuve de fin, on numérote au lieu d\'annoncer la dernière',
  W.titreJour([JH(2)], 'vendredi', { suite: finInconnue }) === 'Jackson Hole · jour 2',
  W.titreJour([JH(2)], 'vendredi', { suite: finInconnue }));
verif('…et la description ne parle pas de bilan',
  !/bilan/.test(W.descriptionJour([JH(2)], 'vendredi', { suite: finInconnue })));

verif('la tournure évite l\'article qui sortait faux (« de Sommet du G20 »)',
  /^Sommet du G20, dernière journée/.test(W.descriptionJour(
    [{ currency: 'USD', ctry: 'US', title: 'G20 Meetings', impact: 'Medium', timestamp: J(25, 8, 0) }],
    'mardi', { suite: { lbl: 'Sommet du G20', sigle: 'G20', jour: 2, total: 2, fin: true } })),
  W.descriptionJour([{ currency: 'USD', ctry: 'US', title: 'G20 Meetings', impact: 'Medium', timestamp: J(25, 8, 0) }], 'mardi', { suite: { lbl: 'Sommet du G20', sigle: 'G20', jour: 2, total: 2, fin: true } }));
verif('une journée de suite ne redonne pas la glose de la veille',
  !/sommet de chefs d\'État/.test(W.descriptionJour(
    [{ currency: 'USD', ctry: 'US', title: 'G20 Meetings', impact: 'Medium', timestamp: J(25, 8, 0) }],
    'mardi', { suite: { lbl: 'Sommet du G20', sigle: 'G20', jour: 2, total: 2, fin: true } })));
verif('un rendez-vous sans consensus ne promet pas d\'« écart avec la prévision »',
  !/écart avec la prévision/.test(W.descriptionJour(
    [{ currency: 'USD', ctry: 'US', title: 'G20 Meetings', impact: 'Medium', timestamp: J(24, 8, 0) }], 'lundi')),
  W.descriptionJour([{ currency: 'USD', ctry: 'US', title: 'G20 Meetings', impact: 'Medium', timestamp: J(24, 8, 0) }], 'lundi'));

console.log('\n── 10b. Une suite se repère sur l\'ÉVÉNEMENT, pas sur le thème ──');
// Deux publications d\'emploi différentes dans la semaine donnent le même thème sans rien continuer.
verif('le repérage porte sur devise + intitulé', /const _cleEv = e => String\(e\.currency/.test(src));
verif('les journées doivent être CONSÉCUTIVES', /idx\.every\(\(v, k\) => k === 0 \|\| v === idx\[k - 1\] \+ 1\)/.test(src));
verif('« dernier jour » exige que la fin soit visible dans la semaine', /const finVisible = idx\[idx\.length - 1\] < _prep\.length - 1/.test(src));

console.log('\n── 10c. L\'impact d\'un rendez-vous repêché est relevé À LA SOURCE ──');
verif('le relèvement vit dans le calendrier, pas dans une seule vue', /function _calVitalLift\(e\)/.test(src));
verif('appliqué à la fenêtre courante ET à l\'historique', (src.match(/\.map\(_calVitalLift\)/g) || []).length >= 2);

console.log('\n── 11. Semaine ouvrée : lundi → vendredi, rien d\'autre ──');
// Le lundi SUIVANT s'invitait au bout de la semaine : la fenêtre était en horodatages UTC pendant
// que le rangement passait au jour de Paris. On énumère desormais les cinq jours visés.
const lundi = Date.UTC(2026, 7, 24);
const semaine = []; for (let i = 0; i < 5; i++) semaine.push(new Date(lundi + i * 86400000 + 12 * 3600000).toISOString().slice(0, 10));
verif('la semaine du 24 août = 24 → 28', semaine.join(',') === '2026-08-24,2026-08-25,2026-08-26,2026-08-27,2026-08-28', semaine.join(','));
verif('le lundi suivant n\'en fait pas partie', !semaine.includes('2026-08-31'));
// JPY Retail Sales à 01h50 heure de Paris le lundi 31 = dimanche 30 à 23h50 UTC : AVANT monday+7j,
// donc admis par l'ancienne borne. Le jour de Paris, lui, le range bien au 31.
verif('la publication asiatique du lundi suivant est bien datée du 31',
  W.jourParis(Date.UTC(2026, 7, 30, 23, 50)) === '2026-08-31');
verif('…et se trouve donc hors de la semaine', !semaine.includes(W.jourParis(Date.UTC(2026, 7, 30, 23, 50))));
verif('la sélection se fait sur le jour de Paris, pas sur un horodatage',
  /SEMAINE\.has\(_jourParis\(e\.timestamp\)\)/.test(src));
verif('les jours retenus viennent de la liste des cinq', /const keys = JOURS_SEMAINE\.filter/.test(src));

console.log('\n── 12. Un seul fort ne vide plus la carte de ses moyens ──');
verif('la carte prend les dix premiers de la journée, forts en tête',
  /const _affiches = evs\.slice\(0, 10\)/.test(src));
const journee = [
  { currency: 'USD', ctry: 'US', title: 'Jackson Hole Symposium', impact: 'High', timestamp: J(27, 0, 0) },
  { currency: 'USD', ctry: 'US', title: 'Unemployment Claims', impact: 'Medium', forecast: '230K', previous: '235K', timestamp: J(27, 12, 30) },
];
verif('un moyen reste cité quand un fort est présent', /Unemployment Claims/.test(W.descriptionJour(journee, 'jeudi')));

console.log('\n── 13. Titres de repli COURTS ──');
const repli = W.titreJour([
  { currency: 'USD', ctry: 'US', title: 'Wholesale Inventories MoM Adv', impact: 'Medium' },
  { currency: 'JPY', ctry: 'JP', title: 'Coincident Index Final', impact: 'Medium' },
  { currency: 'EUR', ctry: 'EU', title: 'Construction Output YoY', impact: 'Medium' },
], 'mardi');
console.log('  repli : ' + repli);
verif('la ferraille de période est retirée (MoM, Final, Adv…)', !/\b(MoM|YoY|Final|Adv|Prel)\b/.test(repli), repli);
verif('deux intitulés au plus', repli.split(' + ').length <= 2, repli);
verif('le repli tient en une ligne de carte', repli.length <= 80, repli.length + ' caractères');
verif('« Treasury Secretary » a enfin un thème',
  (W.themeJour({ currency: 'USD', ctry: 'US', title: 'Treasury Secretary Bessent Speech' }) || {}).lbl === 'Discours du Trésor américain');

console.log('\n── 14. Le contrôle de fraîcheur ne contredit plus le cache ──');
// L\'agenda se disait « une génération par semaine couverte » pendant que la route exigeait une
// régénération toutes les 40 minutes, en forçant — donc en court-circuitant ce cache.
verif('la régénération se déclenche sur la SEMAINE, pas sur des minutes',
  /_weekAhead\.monday !== _waLundiCible\(Date\.now\(\)\)/.test(src));
verif('plus de seuil à 40 minutes', !/> 40 \* 60 \* 1000/.test(src));
verif('le lundi cible n\'est calculé qu\'à UN endroit',
  (src.match(/const _toMon = \(_dow === 0\)/g) || []).length === 1);
verif('la navigation en archive utilise la même ancre', /_target = _waLundiCible\(Date\.now\(\)\)/.test(src));

console.log('\n── 15. Classement IA : vocabulaire FERMÉ, invention impossible ──');
// L'IA ne rédige aucun titre : elle rend une CLÉ. Tout ce qui n'est pas exactement une clé connue
// est rejeté. C'est la seule chose qui la rende admissible dans ces cartes après la v20.
verif('une clé connue passe', W.familleValide('inflation') === 'inflation');
[['Décision de taux de la Fed', 'du texte libre'], ['inflation US', 'une clé enjolivée'],
 ['INFLATION', 'une casse différente'], ['taux', 'un mot isolé'], ['toString', 'une propriété héritée'],
 ['constructor', 'un piège de prototype']].forEach(([v, quoi]) =>
  verif(`${quoi} est rejeté (« ${v} »)`, W.familleValide(v) === null, String(W.familleValide(v))));
[null, undefined, 42, {}, [], true].forEach(v =>
  verif(`une réponse de type ${Object.prototype.toString.call(v)} est rejetée`, W.familleValide(v) === null));
verif('les 18 familles sont toutes valides', W.FAMILLES_CLES.every(k => W.familleValide(k) === k));

console.log('\n── 15b. Le libellé français est construit par le CODE, pas par l\'IA ──');
const parFam = (ccy, ctry, fam) => (W.themeDeFamille({ currency: ccy, ctry, title: 'X' }, fam) || {}).lbl;
verif('accord féminin', parFam('USD', 'US', 'inflation') === 'Inflation américaine', parFam('USD', 'US', 'inflation'));
verif('accord masculin', parFam('USD', 'US', 'emploi') === 'Emploi américain', parFam('USD', 'US', 'emploi'));
verif('masculin pluriel', parFam('JPY', 'JP', 'salaires') === 'Salaires japonais', parFam('JPY', 'JP', 'salaires'));
verif('pays d\'origine de la zone euro', parFam('EUR', 'DE', 'activite') === 'Activité allemande', parFam('EUR', 'DE', 'activite'));
verif('agrégat de la zone euro', parFam('EUR', 'EU', 'croissance') === 'Croissance zone euro', parFam('EUR', 'EU', 'croissance'));
verif('une famille inconnue ne produit aucun libellé', W.themeDeFamille({ currency: 'USD', title: 'X' }, 'n_importe_quoi') === null);

console.log('\n── 15c. L\'IA n\'est sollicitée QUE sur ce qui échappe aux règles ──');
const connu = { currency: 'USD', ctry: 'US', title: 'Core PCE Price Index m/m', impact: 'High' };
const inconnu = { currency: 'USD', ctry: 'US', title: 'Wholesale Trade Sales m/m', impact: 'Medium' };
verif('un intitulé reconnu n\'a pas besoin de classement', !!W.themeJour(connu));
verif('un intitulé inconnu tombe en repli sans classement', W.titreEstRepli([inconnu]));
inconnu._fam = 'consommation';
verif('classé, il porte un nom français', (W.themeJour(inconnu) || {}).lbl === 'Consommation américaine', (W.themeJour(inconnu) || {}).lbl);
verif('…et ne tombe plus en repli', !W.titreEstRepli([inconnu]));
const faux = { currency: 'USD', ctry: 'US', title: 'Wholesale Trade Sales m/m', _fam: 'famille_inventee' };
verif('une famille hors liste posée sur l\'événement reste sans effet', W.themeJour(faux) === null);
verif('la famille n\'est consultée qu\'APRÈS toutes les règles',
  (W.themeJour({ currency: 'USD', ctry: 'US', title: 'Federal Funds Rate', _fam: 'ferie' }) || {}).lbl === 'Décision de la Fed');
verif('le classement est gardé en cache persistant', /_WA_FAM_KEY = 'watheme:familles'/.test(src));
verif('un intitulé non classable est mémorisé, pas redemandé', /_waFam\.set\(k, cle\); _waFamDirty = true;/.test(src));
verif('le classement est sous quota', /aiAllowed\('analyst', \{ priority: 'background' \}\)/.test(src));
verif('sans IA, l\'agenda sort quand même', /catch \(e\) \{ console\.warn\('\[WeekAhead\] classement:'/.test(src));

console.log('\n── 16. Le classement IA éprouvé DE BOUT EN BOUT, avec une IA simulée ──');
/* On n'éprouve pas une copie du code : on extrait le VRAI bloc de server.js et on l'exécute avec
   des doublures (cache, IA, quota). C'est la seule façon de vérifier ce qui se passe quand l'IA
   répond de travers — ce qu'aucun test de fonction pure ne montre. */
(function classementBoutEnBout() {
  const i = src.indexOf("const _WA_FAM_KEY = 'watheme:familles'");
  const j = src.indexOf('setTimeout(() => { _waFamLoad()', i);
  if (i < 0 || j < 0) { verif('le bloc de classement est extractible', false, 'introuvable dans server.js'); return; }
  const code = src.slice(i, j) + '\nreturn { _waClasserInconnus, _waFamLoad };';
  const bac = (reponseIA, opts) => {
    const o = opts || {}; let appels = 0; const logs = [];
    const api = new Function('auth', 'ai', 'aiAllowed', 'aiNote', '_WA', 'console', code)(
      { aiCacheGet: async () => (o.cache || {}), aiCacheSet: async () => {} },
      { generateText: async () => { appels++; return reponseIA; } },
      () => o.quota !== false, () => {}, W,
      { log: m => logs.push(String(m)), warn: m => logs.push('WARN ' + m) });
    return { api, logs, appels: () => appels };
  };
  const EV = () => ([
    { currency: 'USD', ctry: 'US', title: 'Wholesale Trade Sales m/m', impact: 'Medium' },
    { currency: 'USD', ctry: 'US', title: 'Redbook y/y', impact: 'Medium' },
    { currency: 'USD', ctry: 'US', title: 'Core PCE Price Index m/m', impact: 'High' },
  ]);
  // Les contrôles asynchrones sont chaînés, puis attendus avant le bilan (voir _attente).
  const files = [];
  { const b = bac('{"1":"consommation","2":"consommation"}'); const evs = EV();
    files.push(b.api._waClasserInconnus(evs).then(() => {
      verif('réponse correcte : les deux inconnus sont classés', evs[0]._fam === 'consommation' && evs[1]._fam === 'consommation', JSON.stringify(evs.map(e => e._fam)));
      verif('l\'événement déjà reconnu par une règle est laissé tranquille', !evs[2]._fam);
      verif('un seul appel IA pour tout le lot', b.appels() === 1, String(b.appels()));
      verif('le titre reprend les termes du calendrier', W.titreJour(evs.slice(0, 2), 'mardi') === 'Wholesale Trade Sales USD + Redbook USD', W.titreJour(evs.slice(0, 2), 'mardi'));
    })); }
  { const b = bac('{"1":"decision_de_taux_fed","2":"Inflation US"}'); const evs = EV();
    files.push(b.api._waClasserInconnus(evs).then(() => {
      verif('clés INVENTÉES par l\'IA : rien n\'est posé', !evs[0]._fam && !evs[1]._fam, JSON.stringify(evs.map(e => e._fam)));
      verif('…le repli déterministe reprend la main', W.titreEstRepli(evs.slice(0, 2)));
      verif('…et le rejet est journalisé', b.logs.some(l => /hors liste/.test(l)), b.logs.join(' | '));
    })); }
  { const b = bac('Je pense que ce sont des ventes de gros.'); const evs = EV();
    files.push(b.api._waClasserInconnus(evs).then(() => verif('réponse en prose : aucune exception, rien de posé', !evs[0]._fam))); }
  { const b = bac('{"1":"consommation",,}'); const evs = EV();
    files.push(b.api._waClasserInconnus(evs).then(() => verif('JSON malformé : aucune exception', !evs[0]._fam))); }
  { const b = bac('{"1":"consommation"}', { quota: false }); const evs = EV();
    files.push(b.api._waClasserInconnus(evs).then(() => {
      verif('quota épuisé : aucun appel IA', b.appels() === 0);
      verif('…et le repli est annoncé', b.logs.some(l => /quota IA indisponible/.test(l)), b.logs.join(' | '));
    })); }
  { const b = bac('{"1":"budget"}', { cache: { 'wholesale trade sales m/m': 'consommation', 'redbook y/y': 'consommation' } }); const evs = EV();
    files.push(b.api._waFamLoad().then(() => b.api._waClasserInconnus(evs)).then(() => {
      verif('déjà en cache : les familles en viennent', evs[0]._fam === 'consommation' && evs[1]._fam === 'consommation');
      verif('…et aucun appel IA n\'est fait', b.appels() === 0, String(b.appels()));
    })); }
  { const b = bac('{"1":null,"2":null}'); const evs = EV(); const evs2 = EV();
    files.push(b.api._waClasserInconnus(evs).then(() => b.api._waClasserInconnus(evs2)).then(() => {
      verif('intitulé non classable : rien n\'est posé', !evs[0]._fam);
      verif('…et il n\'est pas redemandé au tour suivant', b.appels() === 1, b.appels() + ' appel(s)');
    })); }
  _attente = Promise.all(files);
})();

_attente.then(() => {
  console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
  process.exit(ko ? 1 : 0);
});

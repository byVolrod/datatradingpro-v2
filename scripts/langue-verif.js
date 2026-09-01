#!/usr/bin/env node
/* ═══ LE FIL NE SORT QUE DU FRANÇAIS ═══════════════════════════════════════════════════════════
   Capture user du 01/09 : cinq lignes du fil EN ITALIEN (« Esportazioni coreane… »), verdict sans
   appel — « je veux pas voir ça ».

   LA CAUSE. Les deux pré-traductions de fond (titres, descriptions) ne testaient que deux choses
   avant de STOCKER ce que rendait le traducteur : que la réponse ne soit pas vide, et qu'elle
   diffère de la source. Ces deux gardes visent le même défaut — « _traduireLot rend la SOURCE
   quand il échoue » — et une réponse italienne les passe toutes les deux : elle n'est ni vide, ni
   identique à l'anglais d'origine. Elle atterrissait donc dans `_titreFr` / `_descFr`, qui sont
   des champs d'AFFICHAGE, et y restait pour toujours : un champ rempli n'est jamais retenté.
   Le détecteur `_looksFr` existait pourtant déjà — mais utilisé seulement EN AMONT (« cette
   dépêche est-elle déjà française ? alors ne paie pas sa traduction »). Jamais en aval.

   CE QUE CE BANC ÉPROUVE. Le vrai `_traductionFrValide` de server.js — EXTRAIT du fichier, jamais
   recopié : une copie diverge le jour où quelqu'un touche à l'original, et le banc validerait
   alors du code que personne n'exécute.
   Deux exigences, en tension, et c'est le point : refuser l'italien / l'espagnol / l'anglais SANS
   jamais refuser du français réel. D'où les pièges : « Los Angeles » et « Las Vegas » (`los`/`las`
   sont espagnols mais reviennent dans toute dépêche), et « mais », qui EST un mot français. */
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server.js');
let ko = 0;
const verif = (nom, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + nom + (ok || !detail ? '' : '\n      → ' + detail));
  if (!ok) ko++;
};

console.log('\n── Le fil n\'affiche que du français (contrôle de sortie des traductions) ──');

const src = fs.readFileSync(SERVER, 'utf8');
const pick = (rx, quoi) => {
  const m = src.match(rx);
  if (!m) { verif('le code de ' + quoi + ' est extractible de server.js', false, 'motif introuvable : ' + rx); return null; }
  return m[0];
};

const l1 = pick(/const _looksFr = [^\n]+/, '`_looksFr`');
const l2 = pick(/const _RX_NON_FR = [^\n]+/, '`_RX_NON_FR`');
const l3 = pick(/const _traductionFrValide = [^\n]+/, '`_traductionFrValide`');

if (!l1 || !l2 || !l3) {
  console.log('\n✗ ' + ko + ' ÉCHEC(S)\n');
  process.exit(1);
}
verif('le contrôle de sortie est présent dans server.js', true);

let valide;
try {
  // eslint-disable-next-line no-eval
  valide = eval('(function(){' + [l1, l2, l3].join('\n') + '\nreturn _traductionFrValide;})()');
} catch (e) {
  verif('il s\'évalue sans erreur', false, e.message);
  console.log('\n✗ ' + ko + ' ÉCHEC(S)\n');
  process.exit(1);
}

/* Les cinq lignes sont celles de la capture, au caractère près : ce banc rejoue le défaut réel,
   pas une approximation de laboratoire. */
const REFUS = [
  ['italien (capture du 01/09)', 'Surplus commerciale provvisorio della Corea del Sud ad agosto: 34,75 miliardi di dollari contro 30,39 miliardi di dollari a luglio'],
  ['italien (capture du 01/09)', 'Esportazioni medie coreane per giorno lavorativo ad agosto in aumento del 72,5% su base annua'],
  ['italien (capture du 01/09)', 'Esportazioni coreane ad agosto in crescita del 68,7% su base annua, superando il sondaggio del 62,6%'],
  ['italien (capture du 01/09)', 'Importazioni coreane preliminari effettive 22,5% (previsto 25%, precedente 26,5%)'],
  ['italien (capture du 01/09)', 'Esportazioni coreane preliminari effettive 68,7% (previsto 63%, precedente 63,0%)'],
  ['espagnol', 'Las exportaciones coreanas aumentaron un 68,7% interanual en agosto, según el sondeo'],
  ['espagnol', 'El superávit comercial de Corea del Sur alcanzó 34,75 millones de dólares'],
  ['portugais', 'As exportações coreanas não são maiores este mês'],
  ['anglais (le traducteur a rendu la source)', 'South Korea trade surplus widens in August'],
  ['vide', ''],
];
const ACCEPTE = [
  ['la traduction FRANÇAISE de la ligne italienne', 'Excédent commercial provisoire de la Corée du Sud en août : 34,75 milliards de dollars'],
  ['français', 'Exportations coréennes en hausse de 68,7 % sur un an, au-dessus du consensus'],
  ['français', 'Le dollar se renforce après le discours de Powell à Jackson Hole'],
  ['français', 'La BCE maintient ses taux inchangés'],
  ['français', 'Trump signe un décret sur les droits de douane'],
  ['français', 'Inflation allemande : 2,9 % sur un an (attendu 3 %)'],
  ['français', 'Les marchés attendent le rapport sur l\'emploi américain'],
  ['français', 'Pétrole en forte baisse, le Brent sous 70 dollars'],
  ['PIÈGE : « Los Angeles » / « Las Vegas » dans du français', 'Le sondage place Los Angeles et Las Vegas en tête des villes visées'],
  ['PIÈGE : « mais » est un mot français', 'Mais le marché n\'y croit pas encore, selon les analystes'],
];

let refusesOk = 0;
for (const [quoi, t] of REFUS) if (!valide(t)) refusesOk++; else verif('refuse ' + quoi, false, JSON.stringify(String(t).slice(0, 70)));
verif('refuse les ' + REFUS.length + ' textes qui ne sont pas du français', refusesOk === REFUS.length,
  refusesOk + '/' + REFUS.length + ' refusés');

let acceptesOk = 0;
for (const [quoi, t] of ACCEPTE) if (valide(t)) acceptesOk++; else verif('accepte ' + quoi, false, JSON.stringify(String(t).slice(0, 70)));
verif('accepte les ' + ACCEPTE.length + ' textes français légitimes (pièges compris)', acceptesOk === ACCEPTE.length,
  acceptesOk + '/' + ACCEPTE.length + ' acceptés');

/* Le contrôle doit être BRANCHÉ, pas seulement défini : c'est l'erreur qui a créé le défaut —
   `_looksFr` existait et ne servait qu'en amont. On exige donc son appel aux deux points de
   stockage, et le balayage qui répare les traductions déjà posées en base. */
verif('il est branché sur le stockage des TITRES (`_titreFr` / `_hlFr`)',
  /_traductionFrValide\(fr\)[^\n]*\n?[^\n]*_titreFr|if \(!_traductionFrValide\(fr\)\)/.test(src));
verif('il est branché sur le stockage des DESCRIPTIONS (`_descFr`)',
  /_traductionFrValide\(fr\)[^\n]*_descFr|_descFr = fr[^\n]*\}\s*else/.test(src) || /if \(_traductionFrValide\(fr\)\) \{ c\.it\._descFr/.test(src));
verif('les traductions DÉJÀ posées en base sont balayées et retirées si elles ne sont pas françaises',
  /for \(const champ of \['_titreFr', '_hlFr', '_descFr'\]\)/.test(src) && /delete it\[champ\]/.test(src));

if (ko) { console.log('\n✗ ' + ko + ' ÉCHEC(S)\n'); process.exit(1); }
console.log('\n✓ LE FIL NE SORT QUE DU FRANÇAIS\n');

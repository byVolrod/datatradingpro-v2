#!/usr/bin/env node
/**
 * reaction-verif.js — LE GRAPHIQUE DE RÉACTION COUVRE-T-IL L'HEURE DE LA PUBLICATION ?
 * ------------------------------------------------------------------------------------------------
 * 29/08, capture à l'appui : « Réaction indisponible : les cotations à la minute ne couvrent plus
 * l'heure de cette publication », sur un chiffre australien de 04:00 regardé à 11:08. Sept heures,
 * pas sept jours — la donnée existait.
 *
 * LA CAUSE. `/api/react-ohlc` demande d'abord une journée de bougies d'une minute, et se rabat sur
 * cinq jours si la réponse est maigre. Ce repli, posé un dimanche pour les week-ends sans séance, ne
 * regardait que le NOMBRE de bougies. Or le fournisseur peut très bien rendre une séance entière —
 * plusieurs centaines de bougies, le compte est donc largement dépassé — qui COMMENCE APRÈS
 * l'instant demandé. Le garde-fou passait, le repli n'était jamais tenté, et le lecteur voyait le
 * message d'indisponibilité alors qu'une seconde requête aurait suffi.
 *
 * Ce contrôle éprouve la règle de couverture sur le VRAI code extrait de server.js, et vérifie que
 * la route s'en sert. Calcul pur : aucun réseau, aucun navigateur.
 *
 *   node scripts/reaction-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

const D = SRV.indexOf('function _reactCouvre(candles, t0) {');
if (D < 0) { console.log('\n  ✗ _reactCouvre introuvable dans server.js\n'); process.exit(1); }
const couvre = new Function(SRV.slice(D, SRV.indexOf('\n}\n', D) + 3) + '\nreturn _reactCouvre;')();

const MIN = 60e3;
const serie = (debut, n) => Array.from({ length: n }, (_, i) => ({ t: debut + i * MIN, c: 1 }));
const T0 = Date.UTC(2026, 7, 26, 2, 0, 0);          // 04:00 à Paris = 02:00 UTC, l'heure de la capture

console.log('\n── 1. « Couvrir » veut dire ENCADRER l\'instant, pas « avoir des bougies » ──');
v('une séance qui encadre l\'instant le couvre', couvre(serie(T0 - 60 * MIN, 180), T0) === true);
/* LE CAS DE LA CAPTURE, ET IL EST CONTRE-INTUITIF : 400 bougies, largement plus que le seuil de 8
   du garde-fou d'origine — et pas une seule avant l'instant demandé. C'est exactement ce que le
   compte ne pouvait pas voir. */
v('400 bougies qui commencent APRÈS l\'instant ne le couvrent PAS', couvre(serie(T0 + 30 * MIN, 400), T0) === false,
  'c\'est le cas de la capture : le compte passe, la couverture non');
v('une séance qui se termine AVANT l\'instant ne le couvre pas non plus', couvre(serie(T0 - 600 * MIN, 400), T0) === false);
v('une bougie pile sur l\'instant suffit', couvre([{ t: T0, c: 1 }], T0) === true);
v('une série vide ne couvre rien', couvre([], T0) === false);
v('sans instant demandé, on n\'affirme rien et on ne déclenche pas de repli', couvre([], 0) === true,
  'répondre « non » ferait une requête de plus sur une question qu\'on n\'a pas posée');
v('une bougie sans horodatage ne compte pas', couvre([{ c: 1 }, { t: null, c: 1 }], T0) === false);

console.log('\n── 2. La route s\'en sert, et au bon endroit ──');
/* Le repli DOIT tester la couverture en plus du compte : c'est la moitié qui manquait. Et il ne doit
   remplacer la série que si le repli fait MIEUX — couvrir prime sur être plus long, sinon une
   réponse plus longue mais toujours décalée écraserait une réponse courte mais juste. */
v('le repli 5 jours se déclenche aussi sur un défaut de couverture',
  /if \(\(candles\.length < 8 \|\| !_reactCouvre\(candles, t0\)\) && range === '1d'\)/.test(SRV));
v('… et ne remplace que si le repli couvre mieux',
  /const mieux = \(_reactCouvre\(c2, t0\) && !_reactCouvre\(candles, t0\)\) \|\| c2\.length > candles\.length;/.test(SRV));
v('l\'instant demandé est lu une seule fois, en tête de route', /const t0 = parseInt\(req\.query\.ts, 10\) \|\| 0;/.test(SRV));
v('la réponse dit si elle couvre l\'instant', /couvre: _reactCouvre\(candles, t0\)/.test(SRV),
  'le client peut ainsi distinguer « pas de donnée » de « donnée décalée »');

console.log('\n── 3. Le message du client reste honnête ──');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
/* Le message n'est pas un bug : quand la donnée n'existe vraiment pas, il faut le dire. Ce qui était
   faux, c'est qu'il s'affichait alors qu'elle existait. On vérifie qu'il est toujours là — un
   graphique vide sans explication serait pire. */
v('le client explique l\'absence au lieu d\'afficher un cadre vide',
  /Réaction indisponible : les cotations à la minute ne couvrent plus l\\?'heure de cette publication\./.test(APP));
v('… et il vérifie lui aussi que la série précède la publication', /!brut\.some\(c => c\.t <= t0\)/.test(APP));

console.log('');
if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');

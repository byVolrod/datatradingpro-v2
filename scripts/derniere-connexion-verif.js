#!/usr/bin/env node
/**
 * scripts/derniere-connexion-verif.js — LA COLONNE « DERNIÈRE CONNEXION » SE LIT SANS ENQUÊTER
 *
 * POURQUOI (16/09, demande utilisateur : « améliore la lisibilité/visibilité des connexions ici »,
 * capture de la liste des comptes du panneau admin à l'appui).
 * Trois choix qui réduisent chacun la lisibilité se cumulaient dans UNE cellule, celle qu'on lit en
 * premier en ouvrant la liste : 11 px, chasse FIXE, et `--text3`, le gris le plus éteint de la
 * palette. La chasse fixe n'y servait même à rien : elle aligne des chiffres en colonne, or
 * « il y a 3 j » et « à l'instant » n'ont pas un chiffre à la même place. Surtout, AUCUNE couleur
 * ne séparait les états : un compte connecté il y a cinq minutes et un compte qui ne s'est JAMAIS
 * connecté s'écrivaient dans le même gris, alors que c'est exactement ce qu'on cherche en balayant
 * la liste. Et la date exacte n'existait qu'au SURVOL, c'est-à-dire nulle part au doigt.
 *
 * CE QUE CE BANC ÉPROUVE. Il EXTRAIT `relTime`, `conxCell` et le VRAI `esc` d'admin.js et les
 * EXÉCUTE sur des horodatages construits à la main. Une relecture dirait « il y a bien une classe
 * par état » sans jamais vérifier qu'un compte de 45 jours tombe dans la bonne, ni qu'un compte
 * jamais connecté ne se retrouve pas dans « vif » par un `j` qui vaut NaN.
 *
 * ⚠️ ET IL VÉRIFIE QUE CHAQUE CLASSE ÉMISE EXISTE DANS LA FEUILLE. C'est le piège symétrique de
 * celui déjà payé ici (un id dans le HTML que personne n'écrit) : une classe écrite par le JS sans
 * règle en CSS ne lève AUCUNE erreur, ne casse AUCUNE page, et laisse simplement la cellule dans
 * son gris d'origine. Le défaut qu'on vient de corriger reviendrait donc à l'identique, en silence,
 * à la première faute de frappe.
 *
 *   node scripts/derniere-connexion-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const ADM = fs.readFileSync(path.join(RACINE, 'public/js/admin.js'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/css/admin.css'), 'utf8');

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ══ 1. LE VRAI CODE, EXTRAIT ET JOUÉ ═════════════════════════════════════════════════════════ */
console.log('\n── La cellule, jouée sur le vrai code d\'admin.js ──');
const SRC_ESC = (/function esc\(s\) \{[^\n]*\}/.exec(ADM) || [])[0] || null;
const SRC_REL = (/function relTime\(ts\) \{[\s\S]*?\n  \}/.exec(ADM) || [])[0] || null;
const SRC_CEL = (/function conxCell\(ts\) \{[\s\S]*?\n  \}/.exec(ADM) || [])[0] || null;
v('esc est extractible', !!SRC_ESC);
v('relTime est extractible', !!SRC_REL);
v('conxCell est extractible', !!SRC_CEL);

const J = 86400000;
let CELL = null;
if (SRC_ESC && SRC_REL && SRC_CEL) {
  CELL = new Function(`${SRC_ESC}\n${SRC_REL}\n${SRC_CEL}\nreturn conxCell;`)();

  const jamais = CELL(null);
  v('jamais connecté → sa propre classe, et il le DIT', /u-conx--jamais/.test(jamais) && /jamais connect/i.test(jamais), jamais);
  v('… et il ne tombe pas dans « vif » par un calcul sur null', !/u-conx--vif/.test(jamais), jamais);

  const vif = CELL(Date.now() - 5 * 60000);
  v('connecté il y a 5 min → « vif »', /u-conx--vif/.test(vif) && /à l’instant|il y a 5 min/.test(vif), vif);

  const hier = CELL(Date.now() - 20 * 3600000);
  v('… et 20 h après aussi (le seuil est le JOUR écoulé, pas minuit)', /u-conx--vif/.test(hier), hier);

  const frais = CELL(Date.now() - 5 * J);
  v('5 jours → « frais », le cas ordinaire, sans signal', /u-conx--frais/.test(frais), frais);

  const tiede = CELL(Date.now() - 45 * J);
  v('45 jours → « tiède », le compte décroche', /u-conx--tiede/.test(tiede), tiede);

  // LE SEUIL, DES DEUX CÔTÉS : un banc qui n'éprouve qu'un côté ne mesure pas un seuil, il mesure un cas.
  v('le seuil des 30 jours mord des deux côtés',
    /u-conx--frais/.test(CELL(Date.now() - 29 * J)) && /u-conx--tiede/.test(CELL(Date.now() - 31 * J)));

  /* LE CŒUR DE LA DEMANDE : la date absolue est DANS la cellule, plus seulement au survol. */
  const abs = CELL(new Date('2026-07-24T21:51:00Z').getTime());
  v('la date absolue est écrite dans la cellule, pas seulement au survol', /u-conx-abs/.test(abs) && /juil/i.test(abs), abs);
  v('… avec l’heure, et sans les secondes (qui n’apprennent rien ici)', /\d{2}:\d{2}</.test(abs) && !/\d{2}:\d{2}:\d{2}</.test(abs), abs);
  v('… et la mention relative reste, au-dessus', /u-conx-rel/.test(abs), abs);
  v('le survol garde la seconde près (title complet)', /title="/.test(abs) && /\d{2}:\d{2}:\d{2}/.test(abs), abs);

  v('une date invalide ne rend ni « vif » ni une cellule cassée',
    !/u-conx--vif|u-conx--tiede|u-conx--frais/.test(CELL('pas une date')), CELL('pas une date'));

  /* ⚠️ LES TROIS CHOIX D'ORIGINE NE DOIVENT PAS REVENIR PAR LE STYLE EN LIGNE. La cellule était
     mise en forme dans le HTML, pas dans la feuille : c'est ainsi qu'on empile trois réglages
     illisibles sans que personne ne les voie ensemble. */
  const toutes = [jamais, vif, frais, tiede, abs].join(' ');
  v('aucune mise en forme en ligne n’est revenue dans la cellule', !/style="/.test(toutes), toutes.slice(0, 160));
  v('… ni la chasse fixe, qui n’alignait rien ici', !/font-mono/.test(toutes));
}

/* ══ 2. CHAQUE CLASSE ÉMISE A UNE RÈGLE ═══════════════════════════════════════════════════════ */
console.log('\n── Du JS à la feuille : aucune classe orpheline ──');
const CLASSES = ['u-conx', 'u-conx-rel', 'u-conx-abs', 'u-conx--vif', 'u-conx--frais', 'u-conx--tiede', 'u-conx--jamais'];
const aUneRegle = c => new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![\\w-])').test(CSS);
for (const c of CLASSES) v(`.${c} a une règle dans admin.css`, aUneRegle(c));

// Et l'inverse : le JS émet-il bien TOUTES celles que la feuille prévoit pour les états ?
if (CELL) {
  const emises = new Set();
  for (const ts of [null, Date.now(), Date.now() - 5 * J, Date.now() - 45 * J])
    for (const m of String(CELL(ts)).matchAll(/u-conx[\w-]*/g)) emises.add(m[0]);
  const manquantes = CLASSES.filter(c => !emises.has(c));
  v('les quatre états sont réellement atteignables depuis conxCell', manquantes.length === 0, 'jamais émises : ' + manquantes.join(', '));
}

/* ── TÉMOIN ── Sans lui, « chaque classe a une règle » pourrait être vert en ne cherchant rien. */
v('(témoin) une classe inventée n’a, elle, aucune règle', !aUneRegle('u-conx--temoin-inexistant'));

/* ── TÉMOIN ── Sans lui, les contrôles de seuil pourraient être verts sur une fonction figée. */
if (SRC_ESC && SRC_REL && SRC_CEL) {
  const mutant = SRC_CEL.replace('j < 30', 'j < 3');
  v('(témoin) le seuil est bien modifiable dans le source', mutant !== SRC_CEL);
  const M = new Function(`${SRC_ESC}\n${SRC_REL}\n${mutant}\nreturn conxCell;`)();
  v('(témoin) seuil ramené à 3 j → un compte de 5 j bascule en « tiède », le contrôle mord',
    /u-conx--tiede/.test(M(Date.now() - 5 * J)), M(Date.now() - 5 * J));
}

console.log(`\n${ko === 0 ? '✅' : '❌'} derniere-connexion-verif : ${ok} contrôle(s) vert(s), ${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * scripts/decision-verif.js — LA DÉCISION DE TAUX SE LIT DU POINT DE VUE DE LA DEVISE
 *
 * POURQUOI (03/09/2026, capture utilisateur : « pourquoi t'as mis en rouge alors que c positif ? »).
 * Le panneau déplié d'une décision de banque centrale affichait « RBNZ RELÈVE ses taux » EN ROUGE.
 * Sur un desk FX, une hausse est hawkish : elle SOUTIENT la devise. Le rouge disait l'inverse de ce
 * que la ligne racontait — et il le disait à chaque publication, pas une fois.
 *
 * La même capture portait un second défaut, plus grave parce qu'il touche le CHIFFRE : `actual`
 * valait « 25b » (vingt-cinq points de base, le MOUVEMENT) quand `forecast` et `previous` donnaient
 * des NIVEAUX en pourcentage (2,75 % et 2,50 %). `_calNum` ne lit que le premier nombre : 25. Le
 * desk a donc écrit « RELÈVE ses taux à 25% (+22,5 pt) » et « au-dessus des attentes (2,75% prévu) ».
 * Deux phrases fausses, énoncées avec l'aplomb du code.
 *
 * CE BANC ÉPROUVE LE VRAI `_calDecisionOutcome`, extrait de charts.js — jamais une copie.
 *
 *   node scripts/decision-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const CHARTS = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* Extraction par comptage d'accolades, commentaires ET chaînes sautés (une apostrophe française en
   commentaire ouvrirait une fausse chaîne et avalerait la fonction — piège relevé le 02/09). */
function extraire(src, depart) {
  const d = src.indexOf(depart);
  if (d < 0) return null;
  let i = src.indexOf('{', d), prof = 0, ch = null;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1], n = src[i + 1];
    if (ch) { if (c === ch && p !== '\\') ch = null; continue; }
    if (c === '/' && n === '/') { const f = src.indexOf('\n', i); if (f < 0) return null; i = f; continue; }
    if (c === '/' && n === '*') { const f = src.indexOf('*/', i + 2); if (f < 0) return null; i = f + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { ch = c; continue; }
    if (c === '{') prof++;
    else if (c === '}') { prof--; if (prof === 0) return src.slice(d, i + 1); }
  }
  return null;
}

console.log('\n── Extraction du vrai code de charts.js ──');
const SRC_OUT = extraire(CHARTS, 'function _calDecisionOutcome(');
const SRC_NUM = (/function _calNum\(s\) \{[^\n]*\}/.exec(CHARTS) || [null])[0];
const SRC_BPS = (/function _calBpsSuspect\([^)]*\) \{[^\n]*\}/.exec(CHARTS) || [null])[0];
v('_calDecisionOutcome extractible', !!SRC_OUT);
v('_calNum extractible', !!SRC_NUM);
v('_calBpsSuspect extractible', !!SRC_BPS);

/* Les déclarations de fonction se hissent dans un CORPS, pas dans une expression : l'opérateur
   virgule évalue des expressions et ne déclare rien. Premier jet fait ainsi → ReferenceError. */
const F = (SRC_OUT && SRC_NUM && SRC_BPS)
  ? new Function(SRC_NUM + '\n' + SRC_BPS
    + '\nfunction _calEsc(s){return String(s==null?"":s);}\n'
    + SRC_OUT + '\nreturn _calDecisionOutcome;')()
  : null;

const VERT = '#00e676', ROUGE = '#ff3d00', GRIS = '#9aa0aa';

console.log('\n── 1. La couleur suit la DEVISE, pas l\'emprunteur ──');
if (F) {
  const hausse = F({ __bank: 'RBNZ', actual: '2.75%', forecast: '2.50%', previous: '2.50%' });
  v('LE CAS DE LA CAPTURE — une HAUSSE de taux sort en VERT', hausse && hausse.couleur === VERT,
    'couleur rendue : ' + (hausse && hausse.couleur) + ' — le rouge disait l\'inverse de la phrase');
  v('… et la phrase nomme bien le geste', hausse && /RELÈVE ses taux à 2,75%/.test(hausse.sens), hausse && hausse.sens);

  const baisse = F({ __bank: 'BCE', actual: '2.00%', forecast: '2.25%', previous: '2.25%' });
  v('une BAISSE de taux sort en ROUGE (dovish → pèse sur la devise)', baisse && baisse.couleur === ROUGE,
    'couleur : ' + (baisse && baisse.couleur));
  v('… et elle est bien nommée « ABAISSE »', baisse && /ABAISSE/.test(baisse.sens), baisse && baisse.sens);

  const maintien = F({ __bank: 'Fed (FOMC)', actual: '3.75%', forecast: '3.75%', previous: '3.75%' });
  v('un MAINTIEN reste neutre (gris)', maintien && maintien.couleur === GRIS, maintien && maintien.couleur);

  /* LA COHÉRENCE AVEC LE RESTE DU PRODUIT, LUE DANS app.js — c'est elle qui rend le sens du vert
     et du rouge non négociable ici : deux endroits du desk ne peuvent pas dire l'inverse l'un de
     l'autre sur la même question. */
  const mtCls = (/if \(kind === 'ratedir'\)\s+return ([^\n]+)/.exec(APP) || [''])[1] || '';
  v('le tableau macro colore DÉJÀ « Hausse » en positif (même règle, autre écran)',
    /up\/i\.test\(v\) \? 'mt-pos'/.test(mtCls) && /down\/i\.test\(v\) \? 'mt-neg'/.test(mtCls),
    'lu dans app.js : ' + mtCls.slice(0, 90));
}

console.log('\n── 2. On ne compare pas des points de base à des pourcentages ──');
if (F) {
  /* LE CAS EXACT DE LA CAPTURE : actual en bps, voisins en %. */
  const rbnz = F({ __bank: 'RBNZ', actual: '25b', forecast: '2.75%', previous: '2.50%' });
  v('LE CONTRÔLE CLÉ — « 25b » face à 2,75 % n\'invente plus de niveau',
    rbnz && rbnz.incomparable === true, JSON.stringify(rbnz));
  v('… aucun « +22,5 pt » fabriqué', rbnz && !/22,5|\+\d+,\d+ pt/.test(rbnz.sens), rbnz && rbnz.sens);
  v('… aucune « surprise » affirmée sur des unités différentes', rbnz && !rbnz.attente, rbnz && rbnz.attente);
  v('… et la valeur publiée reste montrée telle quelle', rbnz && /25b/.test(rbnz.sens), rbnz && rbnz.sens);
  v('… en gris : on ne colore pas une lecture qu\'on refuse de faire', rbnz && rbnz.couleur === GRIS);

  /* ⚠️ CHAQUE FILET DOIT ÊTRE ÉPROUVÉ SEUL. Écrits d'abord avec les deux scénarios ci-dessus, mes
     contrôles négatifs ne mordaient pas : « 25b » face à 2,50 % déclenche AUSSI le seuil (22,5 > 5),
     donc retirer le détecteur d'unité ne rougissait rien, et réciproquement. Deux gardes qui se
     couvrent l'une l'autre donnent un banc qui ne sait pas laquelle travaille — et le jour où l'une
     casse, personne ne l'apprend. Ce cas-ci n'est attrapable QUE par le marqueur d'unité : 3 points
     de base et 2,50 % sont numériquement voisins (0,5 d'écart), le seuil ne peut pas le voir. */
  const petitBps = F({ __bank: 'SNB', actual: '3b', forecast: '2.75', previous: '2.50' });
  v('un « 3b » proche du niveau n\'est attrapé QUE par le marqueur d\'unité',
    petitBps && petitBps.incomparable === true,
    'écart numérique de 0,5 seulement : aucun seuil ne peut le distinguer, seule l\'unité le dit');

  /* LE SECOND FILET, sans marqueur d'unité : un écart de plus de 5 points en une réunion. */
  const absurde = F({ __bank: 'BoC', actual: '250', forecast: '2.75', previous: '2.50' });
  v('un écart invraisemblable (250 vs 2,50) est refusé lui aussi', absurde && absurde.incomparable === true);

  /* ⚠️ LA MOITIÉ QUI COMPTE AUTANT : une VRAIE décision, même large, doit PASSER. Un garde-fou trop
     serré supprimerait des décisions légitimes — et on ne le verrait jamais, puisqu'il ne rend rien. */
  const large = F({ __bank: 'CBRT', actual: '45.00%', forecast: '42.50%', previous: '42.50%' });
  v('[témoin] une vraie hausse de 2,5 pts passe (seuil pas trop serré)',
    large && !large.incomparable && large.couleur === VERT, JSON.stringify(large));
  const normal = F({ __bank: 'BoE', actual: '4.00%', forecast: '4.25%', previous: '4.25%' });
  v('[témoin] une baisse ordinaire passe aussi', normal && !normal.incomparable && normal.couleur === ROUGE);
}

console.log('\n── 3. La surprise vs consensus reste juste quand les unités concordent ──');
if (F) {
  const dessus = F({ __bank: 'RBNZ', actual: '2.75%', forecast: '2.50%', previous: '2.50%' });
  v('au-dessus du consensus → « surprise restrictive »', dessus && /surprise restrictive/.test(dessus.attente), dessus && dessus.attente);
  const dessous = F({ __bank: 'RBA', actual: '3.50%', forecast: '3.75%', previous: '3.75%' });
  v('en dessous du consensus → « surprise accommodante »', dessous && /surprise accommodante/.test(dessous.attente), dessous && dessous.attente);
  const pile = F({ __bank: 'Fed (FOMC)', actual: '3.75%', forecast: '3.75%', previous: '3.75%' });
  v('conforme → « conforme aux attentes »', pile && /conforme aux attentes/.test(pile.attente), pile && pile.attente);
}

console.log('\n──────────────────────────────────────────────────────────────────────');
if (ko) { console.log(`❌ decision-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
console.log(`✅ decision-verif : ${ok} contrôle(s) au vert.`);

#!/usr/bin/env node
/**
 * scripts/ton-verif.js — LE BADGE DE TON DIT-IL LA MÊME CHOSE QUE LA PHRASE À CÔTÉ ?
 *
 * POURQUOI (09/09, retour utilisateur capture à l'appui : « met les bonnes couleurs appropriées au
 * ton, soit neutre, rouge ou vert »). Deux défauts, tous deux invisibles en lecture de code, tous
 * deux mesurés avant d'être corrigés :
 *
 *   1. LE TON SE LISAIT SUR L'ÉTIQUETTE TRADUITE. Les tests étaient `/hawk/i.test(ton.label)` et
 *      `/dov/i.test(ton.label)`. L'étiquette a été traduite le 28/08 : « Restrictif »,
 *      « Accommodant ». Aucune des deux expressions ne trouve plus rien — la phrase de lecture
 *      tombait donc TOUJOURS dans la branche neutre. Le desk affichait un badge ROUGE
 *      « Accommodant » suivi de « sans posture affirmée » : la couleur disait une chose, le texte
 *      collé à côté disait le contraire. `_calToneOf` conserve pourtant une clé interne que la
 *      traduction ne touche jamais ; encore fallait-il s'en servir.
 *
 *   2. LA PHRASE LA PLUS RESTRICTIVE DU LEXIQUE RESSORTAIT GRISE. Les trois listes étaient
 *      appliquées au même texte indépendamment. Or la liste restrictive contient des tournures qui
 *      NIENT un mot accommodant (« premature to cut »). « premature to cut » comptait donc un point
 *      restrictif ET un point accommodant, les deux s'annulaient, et le badge sortait « Neutre ».
 *
 * CE BANC EXTRAIT LA VRAIE FONCTION de `public/js/charts.js` — pas une copie, qui divergerait — et
 * la fait tourner sur des propos réels.
 *
 *   node scripts/ton-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}

const CHARTS = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');

/* EXTRACTION. On prend le bloc qui va des listes de vocabulaire à la fin de `_calToneOf`. Le banc
   ne récite donc jamais sa propre version des règles : neutraliser la correction dans `charts.js`
   doit le faire rougir, et c'est ce qui est vérifié par les témoins en fin de fichier. */
function extraireToneOf() {
  const a = CHARTS.indexOf('const _CAL_HAWK_RX');
  const b = CHARTS.indexOf('// Découpe un propos');
  if (a < 0 || b < a) return null;
  try { return new Function(CHARTS.slice(a, b) + '; return _calToneOf;')(); } catch (e) { return null; }
}
const toneOf = extraireToneOf();
console.log('\n[1] La fonction de ton, extraite de charts.js');
t('_calToneOf est extraite et exécutable', typeof toneOf === 'function');

/* LA CHARTE (CLAUDE.md) : restrictif = resserrement = soutient la devise → VERT. Accommodant →
   ROUGE. Neutre → gris. Ces trois valeurs sont celles du desk entier ; un badge qui en sortirait
   contredirait le Radar de Biais pour la même banque. */
const VERT = '#22c55e', ROUGE = '#ef4444', GRIS = '#9a9aa4';
const CAS = [
  ['un propos ouvertement restrictif', 'inflation remains too high, further tightening is needed', 'hawk', 'Restrictif', VERT],
  ['« premature to cut », le piège du lexique', 'it would be premature to cut rates', 'hawk', 'Restrictif', VERT],
  ['« not done » et « higher for longer »', 'we are not done, higher for longer', 'hawk', 'Restrictif', VERT],
  ['un propos accommodant', 'the committee is ready to act, disinflation is under way', 'dove', 'Accommodant', ROUGE],
  ['un propos attentiste', 'we remain data-dependent, wait-and-see', 'hold', 'Neutre', GRIS],
];
console.log('\n[2] Chaque ton sort avec sa couleur de charte');
if (toneOf) {
  for (const [nom, propos, cle, etiquette, couleur] of CAS) {
    const r = toneOf([propos]);
    t(nom + ' → ' + etiquette,
      !!r && r.key === cle && r.label === etiquette && r.color === couleur,
      r ? ('reçu ' + r.key + ' / ' + r.label + ' / ' + r.color) : 'aucun ton');
  }
  /* TÉMOIN INVERSE : sans propos, il n'y a pas de ton — et surtout pas un « Neutre » fabriqué.
     Un badge gris affirmerait une posture mesurée là où rien n'a été dit. */
  t('TÉMOIN — aucun propos ne donne AUCUN ton (et pas un « Neutre » inventé)', toneOf(['']) === null);
  t('TÉMOIN — un propos hors sujet ne donne aucun ton', toneOf(['the building was repainted last week']) === null);
}

/* ══ PHASE 3 — LA PHRASE DE LECTURE SUIT-ELLE LE BADGE ? ════════════════════════════════════════
   C'est le défaut n°1, et il ne se voit QUE sur la sortie : le code compile parfaitement, l'étiquette
   s'affiche bien, la couleur est juste — c'est la phrase à côté qui raconte autre chose. On rejoue
   donc le VRAI aiguillage tel qu'il est écrit dans `charts.js`.                                    */
console.log('\n[3] La phrase de lecture suit le badge');
function sensRendu(ton) {
  // Le vrai aiguillage, extrait de charts.js par ses deux branches nommées.
  const i = CHARTS.indexOf('const sens2 = ');
  if (i < 0) return null;
  const j = CHARTS.indexOf(';', CHARTS.indexOf('garde tout son poids', i));
  try { return new Function('ton2', CHARTS.slice(i, j + 1) + ' return sens2;')(ton); } catch (e) { return null; }
}
if (toneOf) {
  const r1 = toneOf(['inflation remains too high, further tightening is needed']);
  const r2 = toneOf(['the committee is ready to act, disinflation is under way']);
  const r3 = toneOf(['we remain data-dependent, wait-and-see']);
  t('un ton restrictif est décrit comme AMPLIFIANT', /AMPLIFIE/.test(sensRendu(r1) || ''), JSON.stringify(sensRendu(r1)));
  t('un ton accommodant est décrit comme AMORTISSANT', /AMORTIT/.test(sensRendu(r2) || ''), JSON.stringify(sensRendu(r2)));
  t('un ton neutre est le SEUL à dire « sans posture affirmée »',
    /sans posture affirmée/.test(sensRendu(r3) || '')
    && !/sans posture affirmée/.test(sensRendu(r1) || '')
    && !/sans posture affirmée/.test(sensRendu(r2) || ''));
  /* TÉMOIN QUI TIENT TOUT LE BANC : l'aiguillage ne doit PAS se décider sur l'étiquette. On lui
     passe un ton dont la clé est bonne et l'étiquette absurde ; si la phrase change, c'est qu'il
     lit encore le texte affiché — donc qu'une prochaine traduction le recassera en silence. */
  t('TÉMOIN — l\'aiguillage ignore l\'étiquette et ne lit que la clé',
    sensRendu({ key: 'hawk', label: 'dovish' }) === sensRendu(r1),
    'l\'étiquette « dovish » a changé la phrase alors que la clé dit « hawk »');
}

console.log('\n[Ton] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

#!/usr/bin/env node
/**
 * scripts/risque-verif.js — LA JAUGE DE RISQUE SE SERT-ELLE DE SON ARC ?
 *
 * POURQUOI (09/09, retour utilisateur devant une capture : « accentue plus, j'ai l'impression qu'on
 * est toujours au milieu, l'aiguille »). Le constat était juste et mesurable : l'axe va de −100 à
 * +100, alors que le score de risque vit, en régime ordinaire, entre −30 et +30. Les trois quarts
 * de l'arc ne servaient jamais, et deux séances aux humeurs franchement différentes plaçaient
 * l'aiguille à quelques degrés l'une de l'autre. Une jauge qui ne bouge pas n'informe pas.
 *
 * LA CORRECTION EST UNE ÉCHELLE, PAS UN MAQUILLAGE — et c'est toute la difficulté de ce banc.
 * On étend le centre par une puissance (|x|^0,55). Trois propriétés doivent tenir, sans quoi la
 * jauge mentirait au lieu d'informer :
 *   · MONOTONIE STRICTE : si un score est plus risk-on qu'un autre, son aiguille est plus à droite.
 *     C'est la seule promesse qu'une jauge fait vraiment.
 *   · EXTRÉMITÉS FIXES : −100 tout à gauche, 0 au centre, +100 tout à droite. Une échelle qui
 *     déplacerait le zéro rendrait « neutre » illisible.
 *   · EXPANSION RÉELLE : sinon la correction n'en est pas une, et le contrôle serait décoratif.
 * Le pourcentage affiché et le badge de régime, eux, restent la valeur exacte du serveur.
 *
 *   node scripts/risque-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}
const C = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');

console.log('\n[1] L\'échelle de la jauge, extraite de charts.js');
const f = (() => {
  const a = C.indexOf('const _RISK_EXPANSION');
  const b = C.indexOf('// Arc LISSE & PRO', a);
  if (a < 0 || b < a) return null;
  try { return new Function(C.slice(a, b) + '; return _riskAngleVal;')(); } catch (e) { return null; }
})();
t('_riskAngleVal est extraite et exécutable', typeof f === 'function');

if (f) {
  console.log('\n[2] Les trois propriétés qui rendent l\'échelle honnête');
  /* EXTRÉMITÉS. Elles ancrent la lecture : sans elles, « neutre » cesserait d'être au milieu. */
  t('0 reste exactement au centre', f(0) === 0, String(f(0)));
  t('−100 reste tout à gauche', Math.round(f(-100)) === -100, String(f(-100)));
  t('+100 reste tout à droite', Math.round(f(100)) === 100, String(f(100)));
  t('une valeur hors bornes est ramenée dans l\'arc', f(250) <= 100 && f(-250) >= -100,
    f(-250) + ' … ' + f(250));

  /* MONOTONIE STRICTE, éprouvée sur tout l'intervalle au pas de 1 : c'est la promesse de la jauge. */
  let monotone = true, contre = '';
  for (let v = -100; v < 100; v++) {
    if (!(f(v) < f(v + 1))) { monotone = false; contre = v + ' → ' + v + 1; break; }
  }
  t('l\'ordre n\'est JAMAIS inversé, sur tout l\'intervalle', monotone, contre);
  t('la symétrie est conservée', Math.abs(f(-37) + f(37)) < 1e-9, f(-37) + ' vs ' + f(37));

  /* EXPANSION RÉELLE — le contrôle qui donne son sens au chantier. Sans lui, une fonction identité
     passerait tous les contrôles ci-dessus (elle est monotone, symétrique et fixe les extrêmes) et
     le banc serait vert sur le défaut qu'on vient de corriger. */
  const cas = [[5, 15], [10, 25], [15, 30], [30, 45]];
  for (const [v, mini] of cas) {
    t('un score de ' + v + ' occupe au moins ' + mini + ' % de la demi-course',
      f(v) >= mini, 'mesuré ' + f(v).toFixed(1));
  }
  /* Et l'expansion doit RALENTIR vers les bords, sinon on ne fait que translater le problème :
     l'écart entre deux valeurs voisines doit être plus grand près de zéro que près de l'extrême. */
  t('la course est plus fine au centre qu\'aux extrêmes',
    (f(10) - f(5)) > (f(95) - f(90)),
    'centre ' + (f(10) - f(5)).toFixed(2) + ' vs bord ' + (f(95) - f(90)).toFixed(2));
}

console.log('\n[3] Ce que l\'échelle ne touche pas');
/* Le chiffre écrit et le badge doivent rester la valeur du serveur : l'échelle est une place, pas
   une donnée. On vérifie donc que l'expansion n'entre PAS dans ces deux chemins. */
{
  const iLbl = C.indexOf('const display   =');
  const ligne = iLbl > 0 ? C.slice(iLbl, C.indexOf('\n', iLbl)) : '';
  t('le pourcentage affiché reste la valeur exacte', !!ligne && !/_riskAngleVal/.test(ligne), ligne.trim());
  t('la couleur du triangle suit la valeur VRAIE, pas sa position',
    /_riskArcColor\(gaugeVal\)/.test(C) && !/_riskArcColor\(_riskAngleVal/.test(C));
  t('seule la position de l\'aiguille est étendue',
    (C.match(/_riskAngleVal\(gaugeVal\)/g) || []).length === 2,
    (C.match(/_riskAngleVal\(/g) || []).length + ' appel(s) au total');
}

console.log('\n[Risque] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

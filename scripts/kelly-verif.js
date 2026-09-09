#!/usr/bin/env node
/**
 * scripts/kelly-verif.js — LE WIDGET KELLY CALCULE-T-IL JUSTE, ET SE TAIT-IL QUAND IL LE FAUT ?
 *
 * POURQUOI. Un widget de dimensionnement est un widget qui peut coûter de l'argent. Deux dangers,
 * et le second est le vrai :
 *
 *   1. LA FORMULE. f* = W − (1 − W) / G, avec G = gain moyen / perte moyenne. Une inversion de G,
 *      un pourcentage traité comme une fraction, et le chiffre reste plausible tout en étant faux.
 *      Le banc éprouve donc des cas dont la réponse se calcule à la main.
 *   2. LE CAS OÙ IL N'Y A PAS D'AVANTAGE. Quand l'espérance est négative, Kelly rend une valeur
 *      NÉGATIVE, et la seule réponse honnête est « aucune taille ». Afficher un petit pourcentage
 *      prudent laisserait croire qu'une taille modeste rend une méthode perdante viable : elle ne
 *      fait que ralentir la perte. C'est la règle déjà écrite dans le bloc CALIBRAGE du Journal, et
 *      ce banc vérifie que le widget la tient MOT POUR MOT plutôt que de la réinventer.
 *
 * Il extrait la VRAIE fonction de calcul du widget (public/js/widgets.js) et la fait tourner sur un
 * faux document : ce qui est mesuré, ce sont les valeurs RENDUES, pas le code qui les produit.
 *
 *   node scripts/kelly-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}
const W = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');

console.log('\n[1] Le widget existe et se déclare correctement');
t('le widget Kelly est au catalogue', /id: 'kelly', name: 'Critère de Kelly'/.test(W));
t('il porte un libellé court', /id: 'kelly'[^\n]*court: 'Kelly'/.test(W));
t('il ne recalcule PAS les statistiques du journal', /window\.dtpKellyStats/.test(W),
  'une seconde définition de « trade gagnant » finirait par diverger de celle du Journal');
t('… et le Journal les expose bien', /window\.dtpKellyStats = function/.test(
  fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8')));

/* EXTRACTION : on prend le corps de `calcul` tel qu'il est écrit dans le widget, et on lui donne un
   faux document. Les valeurs lues sont celles qui seraient RÉELLEMENT affichées. */
console.log('\n[2] La formule, éprouvée sur des cas calculables à la main');
/* ⚠️ L'EXTRACTION PART DE `var pct`, PAS DE `var calcul` — ET CE DÉTAIL EST TOUTE L'HISTOIRE DU
   09/09. Ce banc injectait sa PROPRE copie de `pct` en paramètre. Le jour où le produit a recollé
   le pourcent à son chiffre (règle du dépôt : « 40% », jamais « 40 % » — pourcent-verif la tient),
   trois contrôles de mise en forme sont restés VERTS sur l'ancienne écriture : ils mesuraient la
   copie du banc, pas ce que le client lit. L'en-tête promettait pourtant « les valeurs RENDUES ».
   Une copie ne dérive jamais au même moment que l'original : elle ment le jour où l'original
   change. La tranche englobe donc la VRAIE fonction de mise en forme, et plus rien n'est injecté. */
const corps = (() => {
  const a = W.indexOf('        var pct = function (x) {');
  const b = W.indexOf('        host.querySelectorAll(\'.wdg-kly input\')', a);
  return (a < 0 || b < a) ? null : W.slice(a, b);
})();
t('la fonction de calcul est extraite', !!corps);

function rendre(tr, gain, perte) {
  const sorties = {};
  const champs = { tr, gain, perte };
  const faux = {
    querySelectorAll: () => Object.keys(champs).map(k => ({
      getAttribute: () => k, value: String(champs[k]), addEventListener: () => {},
    })),
    querySelector: (sel) => {
      const m = sel.match(/\[data-o="([a-z]+)"\]/);
      if (!m) return null;
      return { set textContent(v) { sorties[m[1]] = v; }, set className(v) { sorties[m[1] + ':cls'] = v; } };
    },
  };
  new Function('host', corps + '\n calcul();')(faux);
  return sorties;
}
if (corps) {
  /* CAS 1 — l'exemple canonique : 60 % de réussite, gain moyen 2R, perte moyenne 1R.
     G = 2 ; f* = 0,6 − 0,4/2 = 0,4 → 40 %. Demi = 20 %, quart = 10 %. */
  const a = rendre(60, 2, 1);
  t('60% · 2R / 1R → Kelly complet 40%', a.plein === '40%', JSON.stringify(a.plein));
  t('… demi-Kelly 20%', a.demi === '20%', JSON.stringify(a.demi));
  t('… quart de Kelly 10%', a.quart === '10%', JSON.stringify(a.quart));
  t('… espérance +0,8 R', /\+0,8 R/.test(a.esp || ''), JSON.stringify(a.esp));

  /* CAS 2 — le gain et la perte ne sont PAS interchangeables. Avec 60 % mais 1R de gain pour 2R de
     perte, G = 0,5 et f* = 0,6 − 0,4/0,5 = −0,2 : négatif. Si le widget rendait ici la même chose
     qu'au cas 1, c'est que G est inversé — l'erreur la plus facile à commettre, et invisible. */
  const b = rendre(60, 1, 2);
  t('le rapport gain/perte n\'est pas inversé', b.plein !== '40%', JSON.stringify(b.plein));

  /* CAS 3 — LE CAS QUI COMPTE : pas d'avantage. 40 % de réussite, 1R contre 1R.
     f* = 0,4 − 0,6 = −0,2. Le widget doit rendre ZÉRO et le DIRE. */
  const c = rendre(40, 1, 1);
  t('sans avantage, aucune taille n\'est proposée', c.plein === '0%' && c.demi === '0%' && c.quart === '0%',
    JSON.stringify([c.plein, c.demi, c.quart]));
  t('… et il le dit en toutes lettres', /Aucun avantage/.test(c.note || ''), JSON.stringify(c.note));
  t('… l\'espérance sort en négatif', /−0,2 R/.test(c.esp || ''), JSON.stringify(c.esp));
  t('… avec le rouge sémantique de la charte', /wdg-kly-neg/.test(c['esp:cls'] || ''), JSON.stringify(c['esp:cls']));

  /* CAS 4 — le plafond du desk. 80 % · 3R / 1R → f* = 0,8 − 0,2/3 ≈ 73,3 %, demi ≈ 36,7 % : très
     au-dessus des 2 % du desk. La carte doit le signaler plutôt que de laisser lire 36,7 %. */
  const d = rendre(80, 3, 1);
  t('un demi-Kelly au-dessus de 2% rappelle la limite du desk', /limite de 2%/.test(d.note || ''),
    JSON.stringify(d.note));
  /* TÉMOIN INVERSE : la limite ne doit PAS être rappelée quand elle ne s'applique pas — sinon
     l'avertissement devient un décor qu'on n'ira plus lire le jour où il compte. */
  /* ⚠️ CE JEU D'ESSAI A DÛ ÊTRE REFAIT, ET LA RAISON MÉRITE D'ÊTRE ÉCRITE. La première version
     prenait 51 % · 1,05R / 1R en croyant rester sous la limite. Or f* = 0,51 − 0,49/1,05 = 4,33 %,
     donc un demi-Kelly de 2,17 % : la limite S'APPLIQUAIT. Le banc rougissait sur du code juste,
     parce que le cas d'essai avait été posé à vue de nez au lieu d'être calculé. Un témoin dont on
     n'a pas calculé la réponse attendue ne teste pas le code, il teste l'intuition de son auteur.
     Ici : f* = 0,51 − 0,49/1,02 = 2,96 %, demi-Kelly 1,48 %, sous les 2 % — vérifié à la main. */
  const e = rendre(51, 1.02, 1);
  t('TÉMOIN — et elle se tait quand elle ne s\'applique pas', !/limite de 2%/.test(e.note || ''),
    JSON.stringify(e.note));

  /* CAS 5 — saisies impossibles. Un taux de 0 ou de 100 % n'est pas une statistique, c'est une
     saisie incomplète : on n'affiche rien plutôt qu'un infini ou un zéro trompeur. */
  const f = rendre(0, 2, 1), g = rendre(60, 0, 1);
  t('un taux nul ne produit aucun chiffre', f.plein === '-' && f.demi === '-');
  t('un gain nul non plus', g.plein === '-' && g.demi === '-');
  t('… et la carte explique quoi saisir', /Renseignez un taux/.test(f.note || ''), JSON.stringify(f.note));
}

console.log('\n[Kelly] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

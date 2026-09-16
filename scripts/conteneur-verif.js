#!/usr/bin/env node
/**
 * conteneur-verif.js — UNE REQUÊTE DE CONTENEUR DOIT AVOIR UN CONTENEUR.
 * ------------------------------------------------------------------------------------------------
 * 16/09, retour user : « corrige on voit pas le texte » sur le sélecteur de disposition d'un onglet.
 * MESURÉ : la feuille contenait `@container dtpwdg (max-width: 340px)`, mais AUCUN élément ne portait
 * `container-name: dtpwdg`. Une requête de conteneur dont le conteneur n'est déclaré nulle part ne
 * s'applique JAMAIS, et rien ne le signale : pas d'erreur, pas d'avertissement, la règle est
 * simplement inerte. L'adaptation écrite pour les cartes étroites n'avait donc jamais fonctionné,
 * et personne ne pouvait le voir en relisant la feuille — les deux morceaux sont justes séparément,
 * c'est leur LIAISON qui manquait.
 *
 * C'est la même famille que l'identifiant fantôme que `js-verif` traque dans le JS : un nom lu,
 * déclaré nulle part. Ce banc fait pour le CSS ce que celui-là fait pour le JS.
 */
const fs = require('fs');
const path = require('path');

let ok = 0, ko = 0;
const vert = m => { ok++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const rouge = (m, d) => { ko++; console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); };

const RACINE = path.join(__dirname, '..');
const FEUILLES = ['public/css/style.css', 'public/css/admin.css'].filter(f => fs.existsSync(path.join(RACINE, f)));

console.log('\n── Chaque requête de conteneur vise un conteneur réellement déclaré ──');
let total = 0;
const orphelins = [];
for (const f of FEUILLES) {
  const css = fs.readFileSync(path.join(RACINE, f), 'utf8');
  /* Les noms DÉCLARÉS : `container-name: x` et la forme courte `container: x / type`. */
  const declares = new Set();
  for (const m of css.matchAll(/container-name\s*:\s*([A-Za-z_][\w-]*)/g)) declares.add(m[1]);
  for (const m of css.matchAll(/(?:^|[;{]\s*)container\s*:\s*([A-Za-z_][\w-]*)\s*\//g)) declares.add(m[1]);
  /* Les noms INTERROGÉS. `@container (…)` sans nom vise le conteneur le plus proche : toujours valide. */
  for (const m of css.matchAll(/@container\s+([A-Za-z_][\w-]*)\s*\(/g)) {
    total++;
    if (!declares.has(m[1])) {
      const ligne = css.slice(0, m.index).split('\n').length;
      orphelins.push(f + ':' + ligne + '  @container ' + m[1]);
    }
  }
}
vert(total + ' requête(s) de conteneur nommées balayées dans ' + FEUILLES.length + ' feuille(s)');
if (!orphelins.length) vert('aucune ne vise un conteneur qui n\'existe pas');
else rouge(orphelins.length + ' requête(s) inerte(s) : leur conteneur n\'est déclaré nulle part',
  orphelins.join('\n      → '));

console.log('\n── Le sélecteur de disposition s\'adapte à une carte COURTE ──');
{
  const css = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8');
  /* Une requête de HAUTEUR exige `container-type: size` ; avec `inline-size` elle ne matche jamais.
     C'est le piège suivant, et il est invisible lui aussi. */
  const decl = /\.wdgt-body:has\(\.wdgt-dispo\)\s*\{[^}]*container-type:\s*size[^}]*container-name:\s*dtpwdg/.test(css);
  if (decl) vert('le corps d\'onglet est un conteneur de TAILLE (hauteur interrogeable), nommé dtpwdg');
  else rouge('le conteneur manque ou n\'est pas de type `size` : les requêtes de hauteur seraient inertes');

  if (/@container dtpwdg \(max-height/.test(css)) vert('… et une règle adapte bien la carte courte');
  else rouge('rien n\'adapte la carte courte : les libellés resteraient rognés');

  if (/\.wdgt-dispo \.wdg-dispo-name\s*\{[^}]*line-height/.test(css)) vert('le nom d\'une disposition passe à la ligne au lieu d\'être coupé');
  else rouge('le nom peut encore être rogné en hauteur');
}

console.log('\n── Témoin : le balayage sait-il encore reconnaître un orphelin ? ──');
{
  const faux = '@container jamaisDeclareIci (max-width: 100px) { .x { color: red } }';
  const declares = new Set(['dtpw', 'dtpwdg']);
  const vu = [...faux.matchAll(/@container\s+([A-Za-z_][\w-]*)\s*\(/g)].some(m => !declares.has(m[1]));
  if (vu) vert('un nom de conteneur inventé est bien repéré comme orphelin');
  else rouge('le balayage ne repère plus un orphelin : il pourrait être vert sans rien vérifier');
  const nomme = '@container dtpw (max-height: 100px) { .x { color: red } }';
  const faux2 = [...nomme.matchAll(/@container\s+([A-Za-z_][\w-]*)\s*\(/g)].some(m => !declares.has(m[1]));
  if (!faux2) vert('… et un nom réellement déclaré n\'est pas accusé à tort');
  else rouge('le balayage accuse un conteneur valide');
}

console.log(`\n${ko ? '\x1b[31m✗' : '\x1b[32m✓'} ${ok} contrôle${ok > 1 ? 's' : ''} au vert${ko ? `, \x1b[31m${ko} au rouge` : ''}\x1b[0m`);
process.exit(ko ? 1 : 0);

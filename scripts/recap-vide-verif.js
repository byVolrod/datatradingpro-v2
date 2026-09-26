#!/usr/bin/env node
/**
 * scripts/recap-vide-verif.js — UNE RUBRIQUE VIDE DU RÉCAP HEBDO SE DIT D'UNE SEULE FAÇON.
 * ------------------------------------------------------------------------------------------------
 * 26/09, capture utilisateur : sous INFLATION, « → Aucune donnée d'inflation spécifique au NZD
 * publiée cette semaine. » en lecture dorée, quand EMPLOI et CROISSANCE ÉCONOMIQUE disent sobrement
 * « Aucune publication cette semaine. ». Une prose qui ne dit QUE « rien n'a été publié » est rendue
 * par la phrase sobre, sur le desk (app.js) ET dans l'e-mail (mailer.js). Le banc extrait la VRAIE
 * règle des deux fichiers et vérifie qu'elle reconnaît le cas signalé sans avaler une vraie lecture.
 *
 *   node scripts/recap-vide-verif.js
 */
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(R, 'public/js/app.js'), 'utf8');
const MAIL = fs.readFileSync(path.join(R, 'mailer.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const extraire = (src, md) => { const m = src.match(/const _ditRien = (t => \{[^\n]*\});/); return m ? new Function('_md', 'return ' + m[1])(md) : null; };
const regles = { desk: extraire(APP, null), 'e-mail': extraire(MAIL, x => String(x == null ? '' : x).trim()) };
console.log('\n── La règle, lue dans les deux rendus ──');
v('la règle existe sur le desk ET dans l\'e-mail', regles.desk && regles['e-mail']);
const RIEN = ['→ Aucune donnée d\'inflation spécifique au NZD publiée cette semaine.', 'Aucune publication d\'inflation cette semaine pour le CHF.',
  'Pas de donnée d\'inflation publiée cette semaine.', 'Il n\'y a eu aucun chiffre d\'inflation cette semaine.'];
const LECTURE = ['L\'inflation reste au-dessus de la cible : la RBNZ surveille les prix des services.', 'Aucune surprise côté prix : l\'inflation sous-jacente ralentit à 2,8%.',
  'Le CPI publié mardi confirme la désinflation, ce qui soutient une baisse de taux en décembre.'];
for (const [nom, f] of Object.entries(regles)) {
  if (!f) continue;
  v(nom + ' : « rien de publié » reconnu (dont la phrase de la capture)', RIEN.every(f), RIEN.filter(t => !f(t)).join(' | '));
  v(nom + ' : une vraie lecture de l\'inflation reste affichée', LECTURE.every(t => !f(t)), LECTURE.filter(f).join(' | '));
}
console.log('\n── Le branchement ──');
v('desk : sans chiffre ET prose « rien de publié » → « Aucune publication cette semaine. »', /const _infRien = !infPrints\.length && \(!cd\.inflation \|\| _ditRien\(cd\.inflation\)\);/.test(APP) && /if \(_infRien\) body \+= _rien;/.test(APP));
v('e-mail : la même rubrique passe en phrase sobre', /const infRien = !infPr && _ditRien\(cd\.inflation\);/.test(MAIL) && /titre: 'Inflation', html: infL, vide: !infL && \(declVide\('inflation'\) \|\| infRien\)/.test(MAIL));
console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

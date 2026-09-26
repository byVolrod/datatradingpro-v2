#!/usr/bin/env node
/**
 * scripts/structure-verif.js — UN </div> DE TROP NE DOIT PLUS SORTIR UN BOUTON DE SON VOLET.
 * ------------------------------------------------------------------------------------------------
 * 26/09, deux captures utilisateur : un bouton rouge « Déconnexion » en bas du desk, et un volet
 * profil dont les sections Abonnement, Parrainages, Support et Panel Admin étaient repoussées tout en
 * bas, sous un grand vide. Une seule cause : en retirant les menus morts de la section Apparence
 * (25/09), un </div> était resté. Il fermait le corps du volet (.pd-body) trop tôt : les sections
 * suivantes tombaient hors de la zone qui défile, et le pied (.pd-footer, le bouton Déconnexion)
 * sortait du volet lui-même, affiché sur la page.
 * Le navigateur ne signale RIEN : un HTML mal imbriqué se « répare » en silence, ailleurs. Aucun
 * banc ne le voyait. Celui-ci compte les balises et vérifie l'imbrication RÉELLE (pile de balises),
 * pas une expression régulière sur le texte.
 *
 *   node scripts/structure-verif.js
 */
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
const nettoyer = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '');

// Pile des <div> : pour chaque div ouvert, ses classes et son id. Rend l'ascendance de chaque nœud.
function arbre(html) {
  const pile = [], noeuds = [], erreurs = [];
  const re = /<(\/?)div\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1]) {
      const a = m[2], cls = ((a.match(/class="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(Boolean), id = (a.match(/id="([^"]*)"/) || [])[1] || '';
      const n = { cls, id, parents: pile.slice() }; noeuds.push(n); pile.push(n);
    } else if (!pile.pop()) erreurs.push('</div> sans ouverture à l\'index ' + m.index);
  }
  return { noeuds, erreurs, restants: pile.length };
}
const dans = (n, pred) => n.parents.some(pred);

console.log('\n── Équilibre des <div> sur chaque page ──');
for (const f of ['index.html', 'admin.html', 'login.html', 'week-ahead.html']) {
  const A = arbre(nettoyer(fs.readFileSync(path.join(PUB, f), 'utf8')));
  v(f + ' : chaque <div> ouvert est fermé, aucun </div> orphelin', !A.erreurs.length && !A.restants, A.erreurs.concat(A.restants ? [A.restants + ' non fermé(s)'] : []).join(' ; '));
}

console.log('\n── Volet profil : chaque pièce à sa place ──');
const A = arbre(nettoyer(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')));
const estVolet = p => p.id === 'pd-drawer', estCorps = p => p.cls.includes('pd-body');
const pied = A.noeuds.find(n => n.cls.includes('pd-footer'));
v('le pied (bouton Déconnexion) est DANS le volet, pas sur la page', pied && dans(pied, estVolet), pied ? 'parents : ' + pied.parents.map(p => p.id || p.cls.join('.')).join(' > ') : 'introuvable');
v('… et hors du corps qui défile (il reste visible en bas du volet)', pied && !dans(pied, estCorps));
const sections = A.noeuds.filter(n => n.cls.includes('pd-section'));
const dehors = sections.filter(s => !dans(s, estCorps));
v('toutes les sections (' + sections.length + ') sont dans le corps du volet, sans vide intercalé', sections.length >= 6 && !dehors.length, dehors.length + ' section(s) hors du corps');
const corps = A.noeuds.find(estCorps);
v('le corps est un enfant direct du volet', corps && corps.parents.length && estVolet(corps.parents[corps.parents.length - 1]));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

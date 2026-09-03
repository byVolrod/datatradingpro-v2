#!/usr/bin/env node
/**
 * scripts/abonnement-verif.js — LA CHAÎNE DES ABONNEMENTS, DU SÉLECTEUR À L'ÉCHÉANCE
 *
 * POURQUOI (03/09/2026). Un abonnement payé a été révoqué par une lecture périmée (cf. miroir-verif).
 * En remontant toute la chaîne, deux autres défauts sont apparus — aucun des deux n'était visible à
 * l'écran, et c'est précisément ce qui les rend coûteux.
 *
 *   1. `computeExpiry` échouait EN ACCORDANT L'ACCÈS. Une durée non reconnue retombait sur
 *      `return null`, et `null` ne veut pas dire « pas d'échéance » : il veut dire ILLIMITÉ. Le
 *      garde-fou du 28/07 avait fermé ce chemin pour la date personnalisée, en écrivant noir sur
 *      blanc « null silencieux = accès ILLIMITÉ accordé par accident » — puis avait laissé le repli
 *      général faire exactement cela, quinze lignes plus bas. Le sélecteur n'envoie que des valeurs
 *      connues, donc rien ne casse à l'écran ; mais l'API accepte le champ tel quel.
 *
 *   2. `updateUser` ne mettait le miroir à jour QUE par id. Or c'est le miroir que la convergence
 *      repousse vers les quatre bases : une modification qui ne l'atteint pas est ANNULÉE au
 *      passage suivant, alors qu'elle a réussi en base. `_supaWhere` gère déjà ce cas pour
 *      l'écriture en base (id hérité entier d'un côté, uuid de l'autre) ; ici, on l'avait oublié.
 *
 * Ce banc éprouve le VRAI `computeExpiry` extrait de server.js, et LIT le vrai `updateUser`.
 *
 *   node scripts/abonnement-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const AUTH   = fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8');
const ADMINH = fs.readFileSync(path.join(RACINE, 'public/admin.html'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ⚠️ L'EXTRACTEUR DES AUTRES BANCS SE SERAIT ARRÊTÉ SUR LE PREMIER `{`. Or `computeExpiry` prend un
   PARAMÈTRE DÉSTRUCTURÉ — `function computeExpiry({ duration, expiresAt, startDate })` — dont
   l'accolade s'ouvre et se referme AVANT le corps : le compteur retombait à zéro sur la liste des
   paramètres et rendait trois lignes inutilisables. Aucun autre banc ne l'avait rencontré parce
   qu'aucune des fonctions extraites jusqu'ici n'a de paramètre déstructuré. On part donc du `{` qui
   suit la parenthèse FERMANTE de la signature, pas du premier venu. */
function extraire(src, depart) {
  const d = src.indexOf(depart);
  if (d < 0) return null;
  let par = 0, j = src.indexOf('(', d);
  for (; j < src.length; j++) { if (src[j] === '(') par++; else if (src[j] === ')') { par--; if (par === 0) break; } }
  let i = src.indexOf('{', j), prof = 0, ch = null;
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

console.log('\n── 0. Extraction ──');
const SRC_CE = extraire(SERVER, 'function computeExpiry(');
v('computeExpiry extractible', !!SRC_CE);
const CE = SRC_CE ? new Function(SRC_CE + '\nreturn computeExpiry;')() : null;

console.log('\n── 1. Une durée inconnue n\'offre plus un abonnement à vie ──');
if (CE) {
  for (const mauvaise of ['annuel', '12mois', 'lifetime', '', 'abc', '0', '-3']) {
    let a_jete = false;
    try { CE({ duration: mauvaise }); } catch { a_jete = true; }
    v(`« ${mauvaise || '(vide)'} » est REFUSÉE (avant : accès illimité, en silence)`, a_jete);
  }
  /* LA MOITIÉ QUI COMPTE AUTANT : l'illimité VOULU doit continuer de passer. Un garde-fou qui
     refuse tout casserait le seul cas où `null` est la bonne réponse. */
  v('[témoin] « unlimited » rend bien null — l\'illimité DÉLIBÉRÉ reste possible', CE({ duration: 'unlimited' }) === null);
}

console.log('\n── 2. Toute valeur du sélecteur admin est comprise ──');
if (CE) {
  /* ⚠️ LES VALEURS SONT LUES DANS admin.html, PAS RECOPIÉES. Écrites en dur ici, ce banc resterait
     vert le jour où l'on ajoute une option au sélecteur sans l'apprendre à computeExpiry — c'est-à-
     dire le jour EXACT où il devrait rougir. */
  const bloc = /<select[^>]*id="edit-duration"[^>]*>([\s\S]*?)<\/select>/.exec(ADMINH);
  const vals = bloc ? [...bloc[1].matchAll(/value="([^"]*)"/g)].map(m => m[1]).filter(Boolean) : [];
  v('les valeurs du sélecteur sont LUES dans admin.html', vals.length >= 6, 'lues : ' + vals.join(', '));
  vals.forEach(val => {
    let sortie, jete = false;
    try { sortie = CE({ duration: val, expiresAt: '2026-12-31' }); } catch { jete = true; }
    v(`« ${val} » est comprise par computeExpiry`, !jete, 'le sélecteur propose une durée que le serveur refuse');
    if (!jete && val !== 'unlimited') {
      v(`  … et rend une date exploitable`, sortie != null && Number.isFinite(Date.parse(sortie)), String(sortie));
    }
  });
}

console.log('\n── 3. Un mois plus tard, c\'est le même jour du mois ──');
if (CE) {
  /* setMonth DÉBORDE quand le jour n'existe pas à l'arrivée : le 31 janvier + 1 mois donnait le
     3 mars (trois jours offerts), le 31 août + 1 mois le 1er octobre. En faveur du client, donc
     personne ne s'en plaint — mais l'échéance affichée devient inexplicable. */
  const d1 = new Date(CE({ duration: '1', startDate: '2026-01-31T12:00:00Z' }));
  v('31 janvier + 1 mois → 28 février (et non le 3 mars)', d1.getMonth() === 1 && d1.getDate() === 28, d1.toISOString());
  const d2 = new Date(CE({ duration: '1', startDate: '2026-08-31T12:00:00Z' }));
  v('31 août + 1 mois → 30 septembre (et non le 1er octobre)', d2.getMonth() === 8 && d2.getDate() === 30, d2.toISOString());
  const d3 = new Date(CE({ duration: '1', startDate: '2026-09-15T12:00:00Z' }));
  v('[témoin] un cas ordinaire ne bouge pas : 15 septembre + 1 mois → 15 octobre', d3.getMonth() === 9 && d3.getDate() === 15, d3.toISOString());
  /* ⚠️ CE TÉMOIN M'A PRIS EN DÉFAUT, ET C'EST LUI QUI AVAIT TORT. Écrit d'abord avec le
     « 29 février 2026 », il rougissait : 2026 N'EST PAS BISSEXTILE, cette date n'existe pas, et
     JavaScript la reporte silencieusement au 1er mars. Le banc mesurait donc le report d'une date
     inventée, pas la règle qu'il prétendait éprouver. 2028 est bissextile. */
  const d4 = new Date(CE({ duration: '12', startDate: '2028-02-29T12:00:00Z' }));
  v('[témoin] 29 février (2028, bissextile) + 12 mois → 28 février 2029', d4.getFullYear() === 2029 && d4.getMonth() === 1 && d4.getDate() === 28, d4.toISOString());
  const s1 = new Date(CE({ duration: '1week', startDate: '2026-09-03T12:00:00Z' }));
  v('[témoin] une semaine reste une semaine', s1.getDate() === 10 && s1.getMonth() === 8, s1.toISOString());
}

console.log('\n── 4. Une modification d\'administration atteint TOUJOURS le miroir ──');
{
  /* C'est le miroir que la convergence repousse vers les quatre bases : une maj qui ne l'atteint
     pas est défaite au passage suivant, sans que rien ne le dise. */
  const src = extraire(AUTH, 'async function updateUser(');
  v('updateUser extractible', !!src);
  if (src) {
    v('le miroir est cherché par id PUIS par email (comme _supaWhere pour la base)',
      /_mirrorGetById\(id\)/.test(src) && /_mirrorGet\(w\.val\)/.test(src),
      'sans repli email, un id hérité face à un uuid rend null et la maj est perdue');
    v('… et l\'absence des DEUX est signalée, pas avalée',
      /console\.warn\([^)]*miroir/i.test(src) || /AUCUNE ligne au miroir/.test(src));
    v('… la convergence est toujours déclenchée après la maj', /_convSoon\(/.test(src));
    v('… et l\'écriture en base est CONFIRMÉE ligne par ligne (0 ligne ≠ succès)',
      /\.select\('id'\)/.test(src) && /Array\.isArray\(data\) && data\.length/.test(src));
  }
}

console.log('\n──────────────────────────────────────────────────────────────────────');
if (ko) { console.log(`❌ abonnement-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
console.log(`✅ abonnement-verif : ${ok} contrôle(s) au vert.`);

#!/usr/bin/env node
/**
 * scripts/attestation.js — LA SUITE COMPLÈTE NE TOURNE PLUS DEUX FOIS (24/09, minutes GitHub Actions)
 * ------------------------------------------------------------------------------------------------
 * URGENCE user (capture GitHub : « 90% des minutes Actions utilisées, 1 800 / 2 000 ») : mesuré sur
 * les 60 derniers passages, le workflow « Déployer le desk » consommait ~475 min PAR SEMAINE
 * (42 poussées × 11,3 min), soit tout le forfait mensuel à lui seul — et 16 min sur 16 de chaque
 * passage étaient `npm run check`, déjà joué EN LOCAL, sur le même contenu, juste avant la poussée.
 *
 * LE PRINCIPE : après un `npm run check` VERT en local, on écrit l'EMPREINTE exacte du contenu testé
 * (index git : chemin + blob de chaque fichier suivi) dans `.dtp-check-ok`. En CI, si l'empreinte du
 * commit poussé est IDENTIQUE, la suite complète a déjà tourné sur exactement ces octets : on ne
 * joue que la garde rapide (syntaxe, identifiants fantômes, annonces, déploiement), ~1 min. Sinon
 * — attestation absente, périmée, ou un seul octet différent — la suite COMPLÈTE tourne, comme avant.
 * Aucune poussée non vérifiée ne part donc en production ; seules les vérifications en double sautent.
 *
 *   node scripts/attestation.js --ecrire     (après `npm run check` vert, fichiers déjà indexés)
 *   node scripts/attestation.js --verifier   (en CI : code 0 si le commit est attesté)
 *   npm run check:attester                   (= npm run check, puis --ecrire)
 */
'use strict';
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const FICHIER = '.dtp-check-ok';
const sh = c => execSync(c, { cwd: R, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// L'empreinte : la liste « mode blob étape chemin » de l'index, SANS le fichier d'attestation
// lui-même (sinon il se contiendrait). En local c'est ce qui va être commité ; en CI, après le
// checkout, l'index EST le commit poussé. Même commande, même format des deux côtés.
function empreinte() {
  const lignes = sh('git ls-files -s').split('\n').filter(l => l && !l.endsWith('\t' + FICHIER));
  return crypto.createHash('sha256').update(lignes.join('\n')).digest('hex');
}

const mode = process.argv[2];
if (mode === '--ecrire') {
  // Refus si ce qui a été TESTÉ n'est pas ce qui sera COMMITÉ : un fichier modifié non indexé, ou un
  // fichier nouveau non suivi, a été vu par la suite mais ne partirait pas (ou l'inverse).
  const etat = sh('git status --porcelain').split('\n').filter(Boolean)
    .filter(l => !l.endsWith(' ' + FICHIER));
  const horsIndex = etat.filter(l => l[1] !== ' ' || l.startsWith('??'));
  if (horsIndex.length) {
    console.error('✗ attestation refusée : des modifications ne sont pas indexées (git add d\'abord) :\n  ' + horsIndex.slice(0, 8).join('\n  '));
    process.exit(1);
  }
  const e = empreinte();
  fs.writeFileSync(path.join(R, FICHIER), JSON.stringify({ empreinte: e, date: new Date().toISOString(), note: 'npm run check vert sur exactement ce contenu (scripts/attestation.js)' }, null, 1) + '\n');
  console.log('✓ attestation écrite (' + e.slice(0, 12) + '…) — git add ' + FICHIER + ' avant de commiter.');
  process.exit(0);
}
if (mode === '--verifier') {
  let a = null;
  try { a = JSON.parse(fs.readFileSync(path.join(R, FICHIER), 'utf8')); } catch (e) {}
  if (!a || !a.empreinte) { console.log('Attestation absente → suite complète.'); process.exit(1); }
  const e = empreinte();
  if (e !== a.empreinte) { console.log('Attestation périmée (contenu différent de celui testé) → suite complète.'); process.exit(1); }
  console.log('✓ Contenu attesté : npm run check a tourné VERT sur exactement ces fichiers (' + a.date + ').');
  process.exit(0);
}
console.error('usage : node scripts/attestation.js --ecrire | --verifier');
process.exit(2);

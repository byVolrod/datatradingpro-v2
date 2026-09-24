#!/usr/bin/env node
/**
 * scripts/attestation-verif.js — L'ATTESTATION NE PEUT PAS LAISSER PASSER UN CONTENU NON TESTÉ (24/09)
 * ------------------------------------------------------------------------------------------------
 * `scripts/attestation.js` permet à la CI de ne jouer que la garde rapide quand la suite complète a
 * déjà tourné vert en local sur EXACTEMENT le même contenu (urgence minutes GitHub Actions). Ce banc
 * prouve, dans un dépôt git jetable, que la dispense ne s'accorde que dans ce cas-là :
 *   · même contenu → attesté ; un octet changé → suite complète ; attestation absente → complète ;
 *   · l'attestation refuse de s'écrire si des modifications ne sont pas indexées (testé ≠ commité) ;
 *   · le workflow ne saute la suite complète QUE si la vérification réussit.
 *
 *   node scripts/attestation-verif.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const R = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-attest-'));
const git = (...a) => execFileSync('git', a, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const script = path.join(tmp, 'scripts', 'attestation.js');
const joue = mode => spawnSync(process.execPath, [script, mode], { cwd: tmp, encoding: 'utf8' });
try {
  git('init', '-q'); git('config', 'user.email', 'banc@dtp'); git('config', 'user.name', 'banc');
  fs.mkdirSync(path.join(tmp, 'scripts'));
  fs.copyFileSync(path.join(R, 'scripts', 'attestation.js'), script);
  fs.writeFileSync(path.join(tmp, 'a.js'), 'console.log(1)\n');
  git('add', '-A'); git('commit', '-qm', 'base');

  console.log('\n── 1. La dispense ne vaut que pour le contenu testé ──');
  v('sans attestation → suite complète (code ≠ 0)', joue('--verifier').status !== 0);
  fs.writeFileSync(path.join(tmp, 'a.js'), 'console.log(2)\n');
  git('add', '-A');
  const e = joue('--ecrire');
  v('attestation écrite sur un index propre', e.status === 0, e.stderr || e.stdout);
  git('add', '.dtp-check-ok'); git('commit', '-qm', 'modif attestée');
  v('commit identique au contenu testé → attesté (code 0)', joue('--verifier').status === 0);
  fs.writeFileSync(path.join(tmp, 'a.js'), 'console.log(3)\n');
  git('add', '-A'); git('commit', '-qm', 'modif NON attestée');
  v('un octet changé après l\'attestation → suite complète', joue('--verifier').status !== 0);

  console.log('\n── 2. On n\'atteste jamais autre chose que ce qui sera commité ──');
  fs.writeFileSync(path.join(tmp, 'a.js'), 'console.log(4)\n');   // modifié, NON indexé
  v('modification non indexée → attestation refusée', joue('--ecrire').status !== 0);
  git('add', '-A');
  fs.writeFileSync(path.join(tmp, 'b.js'), 'x\n');                   // fichier nouveau non suivi
  v('fichier non suivi → attestation refusée', joue('--ecrire').status !== 0);
} catch (err) {
  v('le banc se déroule', false, err.message);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}

console.log('\n── 3. Le workflow ne saute la suite complète QUE sur attestation valide ──');
const wf = fs.readFileSync(path.join(R, '.github/workflows/deploy-desk.yml'), 'utf8');
v('la vérification choisit entre garde rapide et suite complète',
  /if node scripts\/attestation\.js --verifier; then[\s\S]{0,300}npm run check:rapide[\s\S]{0,40}else\s*\n\s*npm run check\s*\n\s*fi/.test(wf));
const pk = require(path.join(R, 'package.json')).scripts;
v('la garde rapide garde les contrôles bloquants essentiels (syntaxe/identifiants, annonces, déploiement)',
  /js-verif/.test(pk['check:rapide']) && /dtp-updates-verif/.test(pk['check:rapide']) && /deploiement-verif/.test(pk['check:rapide']));
v('check:attester = la suite COMPLÈTE puis l\'attestation (jamais l\'inverse)', /^npm run check && node scripts\/attestation\.js --ecrire$/.test(pk['check:attester'] || ''));
const ka = fs.readFileSync(path.join(R, '.github/workflows/supabase-keepalive.yml'), 'utf8');
v('le keep-alive GitHub ne démarre plus sans la variable DTP_KEEPALIVE_GITHUB (zéro minute facturée)', /vars\.DTP_KEEPALIVE_GITHUB == 'oui'/.test(ka));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

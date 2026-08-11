#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   dtp-updates-verif — GARDE-FOU DES « NOUVEAUTÉS DTP »

   POURQUOI. La règle du projet est claire : toute évolution VISIBLE PAR LES CLIENTS doit être
   annoncée dans DTP_UPDATES (server.js), DANS LE MÊME COMMIT, pour que l'onglet DTP du panneau
   ALERTES tienne les utilisateurs au courant. Elle a quand même été oubliée plusieurs fois le
   11/08 : quatre changements bien visibles (noms du calendrier, « À surveiller », lecture des
   rapports, widget COT) sont partis sans un mot. Une règle qu'on peut oublier n'est pas une règle,
   c'est une intention — d'où ce vérificateur.

   CE QU'IL FAIT. Il regarde les fichiers du commit en préparation (index git) : si l'un d'eux est
   VISIBLE PAR LES CLIENTS et que le tableau DTP_UPDATES n'a pas bougé, il refuse le commit et dit
   quoi écrire. Rien d'autre — il ne juge pas le contenu de l'annonce.

   COMMENT S'EN SERVIR.
     node scripts/dtp-updates-verif.js            → vérifie l'index (usage du hook pre-commit)
     node scripts/dtp-updates-verif.js --last     → vérifie le DERNIER commit (contrôle après coup)
     node scripts/dtp-updates-verif.js --install  → installe le hook pre-commit sur cette machine
   Contournement volontaire (refonte interne, correctif invisible) : `git commit --no-verify`.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sh = c => execSync(c, { cwd: ROOT, encoding: 'utf8' }).trim();

// ── Ce qui compte comme « visible par les clients » ────────────────────────────────────────────
// Le desk (JS/CSS/HTML servis au navigateur) et les gabarits d'e-mail. server.js est le cas
// particulier : il contient AUSSI DTP_UPDATES, donc on ne le déclare visible que si son diff
// touche autre chose que ce tableau (voir plus bas).
const VISIBLE_RX = /^(public\/js\/.+\.js|public\/css\/.+\.css|public\/.+\.html|mailer\.js)$/;
const IGNORE_RX  = /^public\/js\/i18n-dicts\.js$/;   // dictionnaire de traduction : jamais une nouveauté à soi seul

function fichiers(mode) {
  const cmd = mode === 'last' ? 'git diff --name-only HEAD~1 HEAD' : 'git diff --cached --name-only';
  try { return sh(cmd).split('\n').map(s => s.trim()).filter(Boolean); } catch { return []; }
}
function diffDe(fichier, mode) {
  const cmd = mode === 'last' ? `git diff HEAD~1 HEAD -- "${fichier}"` : `git diff --cached -- "${fichier}"`;
  try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; }
}
// Le diff de server.js contient-il une NOUVELLE entrée DTP_UPDATES ? (ligne ajoutée « id: 'dtpu-… »)
const aNouvelleAnnonce = d => /^\+.*id:\s*'dtpu-/m.test(d);
// … et touche-t-il à autre chose que ce tableau ? (au moins une ligne ajoutée/retirée hors « dtpu- »)
const toucheAutreChose = d => d.split('\n').some(l => /^[+-][^+-]/.test(l) && !/id:\s*'dtpu-/.test(l));

function main() {
  const mode = process.argv.includes('--last') ? 'last' : 'index';
  const list = fichiers(mode);
  if (!list.length) process.exit(0);

  const dServer = list.includes('server.js') ? diffDe('server.js', mode) : '';
  const annonce = aNouvelleAnnonce(dServer);

  const visibles = list.filter(f => VISIBLE_RX.test(f) && !IGNORE_RX.test(f));
  if (list.includes('server.js') && toucheAutreChose(dServer)) visibles.push('server.js');

  if (!visibles.length) process.exit(0);          // rien de visible → rien à annoncer
  if (annonce) {                                   // annonce présente → on laisse passer
    console.log('[Nouveautés DTP] ✓ une annonce accompagne ce commit.');
    process.exit(0);
  }

  const j = new Date();
  const stamp = `${j.getFullYear()}${String(j.getMonth() + 1).padStart(2, '0')}${String(j.getDate()).padStart(2, '0')}`;
  console.error('\n╭─ NOUVEAUTÉS DTP — ANNONCE MANQUANTE ────────────────────────────────────────');
  console.error('│ Ce commit touche des fichiers VUS PAR LES CLIENTS :');
  visibles.slice(0, 8).forEach(f => console.error('│   · ' + f));
  if (visibles.length > 8) console.error(`│   … et ${visibles.length - 8} autre(s)`);
  console.error('│');
  console.error('│ Or DTP_UPDATES (server.js) ne contient aucune entrée nouvelle : les utilisateurs');
  console.error('│ ne verront pas passer le changement dans l\'onglet DTP des ALERTES.');
  console.error('│');
  console.error('│ Ajoute une ligne EN TÊTE du tableau DTP_UPDATES, ton annonce produit, sans jargon :');
  console.error(`│   { id: 'dtpu-${stamp}-mon-sujet', ts: Date.UTC(${j.getFullYear()}, ${j.getMonth()}, ${j.getDate()}, 12, 0),`);
  console.error('│     title: \'…\', desc: \'…\' },');
  console.error('│');
  console.error('│ Changement réellement invisible (refonte interne, correctif de panne) ?');
  console.error('│   git commit --no-verify');
  console.error('╰─────────────────────────────────────────────────────────────────────────────\n');
  process.exit(1);
}

function installer() {
  const dir = path.join(ROOT, '.git', 'hooks');
  if (!fs.existsSync(dir)) { console.error('Aucun dossier .git/hooks — dépôt git introuvable.'); process.exit(1); }
  const f = path.join(dir, 'pre-commit');
  const sc = '#!/bin/sh\n# Garde-fou « Nouveautés DTP » (scripts/dtp-updates-verif.js).\nexec node scripts/dtp-updates-verif.js\n';
  fs.writeFileSync(f, sc, { mode: 0o755 });
  try { fs.chmodSync(f, 0o755); } catch {}
  console.log('Hook pre-commit installé : ' + f);
  console.log('Il refusera désormais un commit visible par les clients sans entrée DTP_UPDATES.');
}

if (process.argv.includes('--install')) installer();
else main();

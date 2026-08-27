#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════════════════════════
   BUMP DU CACHE-BUSTING — TOUTES LES PAGES, PAS SEULEMENT LE DESK
   ──────────────────────────────────────────────────────────────────────────────────────────────
   POURQUOI CE SCRIPT EXISTE (06/08). Le rituel de déploiement ne bumpait que `public/index.html`.
   Les autres pages — panneau admin, connexion, Semaine à Venir — gardaient donc le jeton du jour où
   quelqu'un avait pensé à les toucher : `admin.js?v=20260729bbg394`, soit huit jours de retard.
   Or `express.static` sert les JS/CSS avec `maxAge: 30d` : tant que l'URL ne change pas, le
   navigateur ne redemande RIEN. Le serveur livrait le fichier neuf, l'admin voyait l'ancien, et on
   cherchait le bug dans le code livré. Le symptôme est traître parce qu'il ressemble à un
   déploiement raté alors que le déploiement a parfaitement fonctionné.

   CE QU'IL FAIT : aligne le `?v=` de toutes les ressources LOCALES `/css/*.css` et `/js/*.js` de
   `public/*.html` sur un jeton unique.

   CE QU'IL NE TOUCHE PAS, volontairement : tout `?v=` qui n'est pas sur une ressource /css ou /js —
   notamment les liens de téléchargement de l'application (`DataTradingPro-Setup.exe?v=113`), où le
   `v` est le NUMÉRO DE VERSION de l'installeur. Le confondre avec un cache-buster ferait pointer le
   lien vers un fichier inexistant.

   USAGE :  node scripts/bump-cache.js            → jeton du jour, suffixe auto (bbgN+1)
            node scripts/bump-cache.js 20260806bbg562
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const DOSSIER = path.join(__dirname, '..', 'public');
// Ressource LOCALE /css/… ou /js/… suivie d'un ?v=… : c'est le seul cas où `v` est un cache-buster.
const MOTIF = /((?:href|src)="\/(?:css|js)\/[^"?]+\?v=)([^"]*)(")/g;

function jetonSuivant() {
  // On repart du jeton le PLUS AVANCÉ déjà présent (index.html est le mieux tenu) et on incrémente.
  let max = '';
  for (const f of fs.readdirSync(DOSSIER).filter(f => f.endsWith('.html'))) {
    const s = fs.readFileSync(path.join(DOSSIER, f), 'utf8');
    for (const m of s.matchAll(MOTIF)) if (/^\d{8}bbg\d+$/.test(m[2]) && m[2] > max) max = m[2];
  }
  const d = new Date();
  const jour = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const n = max ? parseInt(max.split('bbg')[1], 10) + 1 : 1;
  return jour + 'bbg' + n;
}

const jeton = process.argv[2] || jetonSuivant();
if (!/^[0-9a-zA-Z.-]+$/.test(jeton)) { console.error('Jeton invalide : ' + jeton); process.exit(1); }

let fichiers = 0, refs = 0;
for (const f of fs.readdirSync(DOSSIER).filter(f => f.endsWith('.html'))) {
  const p = path.join(DOSSIER, f);
  const avant = fs.readFileSync(p, 'utf8');
  let n = 0;
  const apres = avant.replace(MOTIF, (_, a, vieux, c) => { if (vieux !== jeton) n++; return a + jeton + c; });
  if (n) { fs.writeFileSync(p, apres); fichiers++; refs += n; console.log('  ' + f.padEnd(18) + n + ' référence(s)'); }
  else console.log('  ' + f.padEnd(18) + 'déjà à jour');
}
/* ══ LE SERVICE WORKER FAIT PARTIE DU RITUEL, SINON IL LE CONTOURNE (27/08) ══════════════════════
   Le cache-busting repose sur une idée simple : changer l'URL pour forcer le navigateur à
   redemander. Un service worker, lui, répond AVANT le réseau — et son cache d'installation
   (`/offline.html`, favicon, icônes) ne porte aucun jeton d'URL : il n'est balayé qu'au changement
   de sa propre constante VERSION. Laisser cette constante à la main, c'est reproduire exactement
   le défaut du 06/08 — le serveur livre le fichier neuf, le client garde l'ancien — mais d'un cran
   plus bas, là où même un Ctrl+F5 ne peut rien, puisqu'il passe lui aussi par le service worker.
   On bumpe donc VERSION avec le reste : une seule commande, un seul jeton, aucune pièce oubliée. */
const SW = path.join(DOSSIER, 'sw.js');
if (fs.existsSync(SW)) {
  const avant = fs.readFileSync(SW, 'utf8');
  const apres = avant.replace(/(const VERSION = ')[^']*(')/, (_, a, b) => a + 'dtp-sw-' + jeton + b);
  if (apres !== avant) { fs.writeFileSync(SW, apres); console.log('  sw.js             VERSION → dtp-sw-' + jeton); }
  else console.log('  sw.js             déjà à jour');
}

console.log('\nJeton : ' + jeton + '  —  ' + refs + ' référence(s) dans ' + fichiers + ' fichier(s).');
if (!refs) console.log('Rien à faire : toutes les pages étaient déjà alignées.');

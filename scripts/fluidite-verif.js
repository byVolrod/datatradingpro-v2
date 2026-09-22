#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════════════════════════
   BANC DE LA FLUIDITÉ DU FIL — « fluide à la connexion, lent après quelques secondes » (22/09)
   ──────────────────────────────────────────────────────────────────────────────────────────────
   `renderNews` reconstruit ~100 nœuds du fil (innerHTML='' puis rebuild). Il était appelé
   SYNCHRONEMENT à chaque lot WebSocket : FinancialJuice poussant en rafale, plusieurs rebuilds
   complets s'enchaînaient et saturaient le thread principal — figeant TOUTE l'UI, navigation
   comprise, dès que le flux devenait actif. La correction coalesce les rebuilds du CHEMIN WS sur
   une frame (requestAnimationFrame) : N messages en rafale → 1 rebuild.
   Ce banc empêche la régression : le chemin WS doit rester coalescé, le rendu initial et les
   actions utilisateur doivent rester synchrones (réactivité au clic non différée).
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 300) : '')); } };
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');

console.log('\n── Le rebuild du fil est coalescé sur le chemin WebSocket ──');
v('un planificateur de rendu coalescé existe', /function _renderNewsCoalesce\(/.test(APP));
v('… il coalesce sur une frame (requestAnimationFrame, repli setTimeout)',
  /requestAnimationFrame/.test(APP) && /_renderNewsCoalesce/.test(APP));
v('… il ne re-planifie pas s’il est déjà planifié (garde anti-doublon)',
  /if \(_renderNewsRAF\) return;/.test(APP),
  'sans cette garde, chaque message re-planifierait un rendu et la coalescence ne servirait à rien.');
v('… il conserve le drapeau hasNew par OU logique (la bannière LIVE reste correcte)',
  /_renderNewsPendingNew = _renderNewsPendingNew \|\| !!hasNew/.test(APP));

console.log('\n── Le chemin WS appelle le coalescé, PAS le rendu synchrone ──');
// Les deux points du handler WS (lot avec neuf, et « patch seul ») doivent passer par le coalescé.
v('le rendu du lot WS neuf est coalescé', /_renderNewsCoalesce\(!isFirstUpdate\)/.test(APP),
  'un renderNews() synchrone ici rebâtit le fil à chaque message — la cause du figement.');
v('le rendu « patch seul » (WS) est coalescé aussi', /if \(_patched\) _renderNewsCoalesce\(true\)/.test(APP));

console.log('\n── Le rendu INITIAL et les actions utilisateur restent SYNCHRONES ──');
// Ne PAS différer le premier paint ni la réactivité au clic : seul le flux WS est batché.
v('le rendu initial (fin du spinner) reste un renderNews() direct',
  /renderNews\(\); \/\/ always clear the spinner/.test(APP),
  'coalescer le rendu initial retarderait le premier affichage du fil.');
v('renderNews reste une fonction appelable directement (actions utilisateur, filtres)',
  /function renderNews\(hasNew = false\)/.test(APP));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert') + '\n');
process.exit(ko ? 1 : 0);

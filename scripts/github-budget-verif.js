#!/usr/bin/env node
/**
 * scripts/github-budget-verif.js — LE QUOTA GRATUIT GITHUB MODELS NE SE CRAME PLUS (23/09)
 * ------------------------------------------------------------------------------------------------
 * Demande user : « mets une règle pour ne pas cramer mon API GitHub, préserve-la le plus longtemps
 * possible » + vérifier les VRAIES limites GitHub. Mesuré : gratuit = ~50/j pour gpt-4o, ~150/j pour
 * gpt-4o-mini, PAR (modèle, token), + ~10/min. La temporisation existante est RÉACTIVE (attend le
 * 429) ; on ajoute un budget PROACTIF qui s'arrête AVANT — un compte martelé en 429 finit gelé.
 *
 * On EXÉCUTE le vrai budget extrait d'ai.js (jamais une copie), avec une horloge simulée, et un
 * témoin retire le cap pour prouver que le banc mord.
 *
 *   node scripts/github-budget-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AI = fs.readFileSync(path.join(__dirname, '..', 'ai.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const debut = AI.indexOf('const GH_CAP_HIGH');
const fin = AI.indexOf('// ── fin budget GitHub ──');
const bloc = (debut >= 0 && fin > debut) ? AI.slice(debut, fin) : null;

// Horloge simulée : on contrôle Date (jour) et Date.now() (espacement).
const monter = (code) => {
  let now = Date.UTC(2026, 8, 23, 10, 0, 0);
  class D extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const api = new Function('process', 'Date', code + '\nreturn { _ghBudgetOk, _ghBudgetNote, _ghCapFor, _ghBudgetEtat, GH_CAP_HIGH, GH_CAP_LOW, GH_MIN_GAP };')({ env: {} }, D);
  return { api, avancer: ms => { now += ms; }, maintenant: () => now };
};

console.log('\n── 1. Le bloc budget est extractible d\'ai.js ──');
v('le bloc GH_CAP…_ghBudgetEtat est extractible', !!bloc);
v('le budget est BRANCHÉ dans _githubModels (skip + note), pas juste défini',
  /!_ghBudgetOk\(model, idx\)\) continue;/.test(AI) && (AI.match(/_ghBudgetNote\(model, idx\);/g) || []).length >= 2);

if (bloc) {
  console.log('\n── 2. Les caps sont sous les plafonds GitHub, mini > high ──');
  const m = monter(bloc);
  v('cap gpt-4o (high) = 40, sous le plafond GitHub de 50/j', m.api.GH_CAP_HIGH === 40 && m.api._ghCapFor('gpt-4o') === 40);
  v('cap gpt-4o-mini (low) = 120, sous le plafond de 150/j', m.api.GH_CAP_LOW === 120 && m.api._ghCapFor('gpt-4o-mini') === 120);
  v('l\'espacement (débit) est ≥ 6 s pour tenir sous 10/min', m.api.GH_MIN_GAP >= 6000);

  console.log('\n── 3. Le cap journalier arrête AVANT le plafond GitHub ──');
  const g = monter(bloc);
  let refus = 0;
  for (let i = 0; i < 50; i++) {                         // on tente 50 appels gpt-4o|0 (le plafond GitHub)
    if (g.api._ghBudgetOk('gpt-4o', 0)) g.api._ghBudgetNote('gpt-4o', 0); else refus++;
    g.avancer(g.api.GH_MIN_GAP);                         // on espace assez pour que SEUL le cap bloque
  }
  v('sur 50 tentatives gpt-4o, exactement 40 passent (cap) et 10 sont préservées', refus === 10, refus + ' refus');
  v('… et une fois le cap atteint, budget refusé', g.api._ghBudgetOk('gpt-4o', 0) === false);
  v('… mais un AUTRE token du même modèle a encore sa réserve', g.api._ghBudgetOk('gpt-4o', 1) === true);
  v('… et le modèle mini du même token a sa PROPRE réserve (cap par modèle ET token)', g.api._ghBudgetOk('gpt-4o-mini', 0) === true);

  console.log('\n── 4. Le compteur se remet à zéro au changement de jour ──');
  v('lendemain → la réserve gpt-4o|0 est de nouveau pleine', (() => { g.avancer(24 * 3600 * 1000); return g.api._ghBudgetOk('gpt-4o', 0); })());

  console.log('\n── 5. L\'espacement (débit) bloque deux appels trop rapprochés ──');
  const s = monter(bloc);
  v('premier appel : autorisé', s.api._ghBudgetOk('gpt-4o', 0) === true);
  s.api._ghBudgetNote('gpt-4o', 0);
  v('immédiatement après : refusé (trop rapproché)', s.api._ghBudgetOk('gpt-4o', 0) === false);
  s.avancer(s.api.GH_MIN_GAP - 100);
  v('… encore refusé juste avant la fin de l\'espacement', s.api._ghBudgetOk('gpt-4o', 0) === false);
  s.avancer(200);
  v('… autorisé une fois l\'espacement écoulé', s.api._ghBudgetOk('gpt-4o', 0) === true);

  console.log('\n── 6. Le Moniteur voit ce qui reste ──');
  const e = monter(bloc);
  e.api._ghBudgetNote('gpt-4o', 0); e.api._ghBudgetNote('gpt-4o', 0);
  const etat = e.api._ghBudgetEtat();
  v('_ghBudgetEtat rend l\'usage du jour par (modèle, token)', Array.isArray(etat) && etat.some(x => x.k === 'gpt-4o|0' && x.n === 2 && x.cap === 40), JSON.stringify(etat));

  console.log('\n── 7. Témoin : sans le cap, rien ne préserve ──');
  const mut = bloc.replace('if (e.n >= _ghCapFor(model)) return false;', 'if (false) return false;');
  v('(témoin) la mutation retire bien le cap', mut !== bloc);
  if (mut !== bloc) {
    const t = monter(mut);
    let passe = 0;
    for (let i = 0; i < 60; i++) { if (t.api._ghBudgetOk('gpt-4o', 0)) { passe++; t.api._ghBudgetNote('gpt-4o', 0); } t.avancer(t.api.GH_MIN_GAP); }
    v('(témoin) sans cap, les 60 passent (le quota se cramerait)', passe === 60, passe + ' passés');
  }
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

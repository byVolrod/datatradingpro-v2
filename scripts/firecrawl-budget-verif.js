#!/usr/bin/env node
/**
 * scripts/firecrawl-budget-verif.js — LE QUOTA FIRECRAWL NE SE CRAME PLUS, ET IL RESTE UN DERNIER RECOURS (23/09)
 * ------------------------------------------------------------------------------------------------
 * Demande user : « ajoute Firecrawl, sers-t'en pour alléger, mets-le au quota si besoin ». Firecrawl est
 * une passerelle de DERNIER RECOURS pour les sources de marché LÉGITIMES (l'API ASX quand l'adresse du VPS
 * est refusée) — JAMAIS pour forcer une protection anti-robot (rateprobability/Cloudflare restent hors de
 * portée). Comme GitHub Models, un budget PROACTIF s'arrête AVANT d'épuiser le quota : plafond/jour +
 * espacement, et rien ne part sans clé.
 *
 * On EXÉCUTE le vrai budget extrait de server.js (jamais une copie), horloge simulée, et un témoin retire
 * le plafond pour prouver que le banc mord.
 *
 *   node scripts/firecrawl-budget-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const bloc = (() => {
  const d = SRV.indexOf('const FC_KEY =');
  const f = SRV.indexOf('async function _firecrawlFetch');
  return (d >= 0 && f > d) ? SRV.slice(d, f) : null;
})();

const monter = (code, key) => {
  let now = Date.UTC(2026, 8, 23, 10, 0, 0);
  class D extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const api = new Function('process', 'Date',
    code + '\nreturn { _fcBudgetOk, _fcNote, _fcEtat, FC_CAP_JOUR, FC_MIN_GAP, FC_KEY };')(
    { env: key ? { FIRECRAWL_API_KEY: key } : {} }, D);
  return { api, avancer: ms => { now += ms; } };
};

console.log('\n── 1. Le budget est extractible, et branché ──');
v('le bloc FC_KEY…_fcEtat est extractible de server.js', !!bloc);
v('_firecrawlFetch passe par le budget (garde + note)',
  /if \(!_fcBudgetOk\(\)\) return null;\s*\n\s*_fcNote\(\);/.test(SRV));
v('Firecrawl est le DERNIER recours de l\'ASX (pas un chemin primaire)',
  /const fc = await _firecrawlFetch\(ASX_IB_URL\);/.test(SRV));
v('la clé ne vit QUE dans le .env (jamais en dur)',
  /process\.env\.FIRECRAWL_API_KEY \|\| process\.env\.FIRECRAWL_KEY/.test(SRV) && !/fc-[0-9a-f]{20}/.test(SRV));
v('la ligne rouge est écrite : jamais pour forcer une protection anti-robot',
  /JAMAIS pour forcer une protection anti-robot/.test(SRV) && /rateprobability et son défi Cloudflare restent hors de/.test(SRV));
v('la télémétrie est exposée à l\'admin (Pipeline taux)', /firecrawl: _fcEtat\(\),/.test(SRV));

if (bloc) {
  console.log('\n── 2. Sans clé, la passerelle est ÉTEINTE ──');
  const sansCle = monter(bloc, '');
  v('pas de clé → budget refusé (jamais d\'appel à vide)', sansCle.api._fcBudgetOk() === false && sansCle.api.FC_KEY === '');

  console.log('\n── 3. Avec clé : le plafond quotidien arrête avant d\'épuiser le quota ──');
  const g = monter(bloc, 'fc-test');
  const CAP = g.api.FC_CAP_JOUR;
  v('cap par défaut = 40 appels/jour', CAP === 40);
  v('espacement par défaut ≥ 4 s', g.api.FC_MIN_GAP >= 4000);
  let refus = 0;
  for (let i = 0; i < CAP + 10; i++) {
    if (g.api._fcBudgetOk()) g.api._fcNote(); else refus++;
    g.avancer(g.api.FC_MIN_GAP);            // on espace assez pour que SEUL le plafond bloque
  }
  v('sur cap+10 tentatives, exactement 10 sont refusées (le plafond a tenu)', refus === 10, refus + ' refus');
  v('… et une fois le plafond atteint, budget refusé', g.api._fcBudgetOk() === false);

  console.log('\n── 4. L\'espacement bloque deux appels trop rapprochés ──');
  const s = monter(bloc, 'fc-test');
  v('premier appel autorisé', s.api._fcBudgetOk() === true);
  s.api._fcNote();
  v('immédiatement après : refusé (trop rapproché)', s.api._fcBudgetOk() === false);
  s.avancer(s.api.FC_MIN_GAP + 50);
  v('… autorisé une fois l\'espacement écoulé', s.api._fcBudgetOk() === true);

  console.log('\n── 5. Le compteur se remet à zéro au changement de jour ──');
  const d2 = monter(bloc, 'fc-test');
  for (let i = 0; i < d2.api.FC_CAP_JOUR; i++) { if (d2.api._fcBudgetOk()) d2.api._fcNote(); d2.avancer(d2.api.FC_MIN_GAP); }
  v('plafond atteint aujourd\'hui', d2.api._fcBudgetOk() === false);
  d2.avancer(24 * 3600 * 1000);
  v('lendemain → réserve de nouveau pleine', d2.api._fcBudgetOk() === true);

  console.log('\n── 6. _fcEtat rend l\'état pour l\'admin ──');
  const e = monter(bloc, 'fc-test');
  e.api._fcNote(); e.api._fcNote();
  const etat = e.api._fcEtat();
  v('_fcEtat : clé posée, appels du jour, plafond', etat.pose === true && etat.n === 2 && etat.capJour === 40, JSON.stringify(etat));
  const etatSans = monter(bloc, '').api._fcEtat();
  v('… et sans clé, pose = false', etatSans.pose === false);

  console.log('\n── 7. Témoin : sans le plafond, rien ne préserve le quota ──');
  const mut = bloc.replace('if (_fcTel.n >= FC_CAP_JOUR) return false;', 'if (false) return false;');
  v('(témoin) la mutation retire bien le plafond', mut !== bloc);
  if (mut !== bloc) {
    const t = monter(mut, 'fc-test');
    let passe = 0;
    for (let i = 0; i < 60; i++) { if (t.api._fcBudgetOk()) { passe++; t.api._fcNote(); } t.avancer(t.api.FC_MIN_GAP); }
    v('(témoin) sans plafond, les 60 passent (le quota se cramerait)', passe === 60, passe + ' passés');
  }
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

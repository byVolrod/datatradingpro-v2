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
  const f = SRV.indexOf('function _fcCle(');
  return (d >= 0 && f > d) ? SRV.slice(d, f) : null;
})();

/* 24/09 : le budget est désormais PAR CYCLE (crédits mensuels de Firecrawl), lissé sur les jours
   restants, DURABLE (relu au démarrage depuis ai_cache) et calé sur le vrai solde. `auth` est une
   doublure en mémoire : elle joue le rôle d'ai_cache, ce qui permet de simuler un redéploiement. */
const monter = (code, key, stock, t0, env2) => {
  let now = t0 || Date.UTC(2026, 8, 24, 10, 0, 0);
  class D extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const kv = stock || {};
  const auth = { aiCacheGet: async k => kv[k] ? JSON.parse(JSON.stringify(kv[k])) : null, aiCacheSet: async (k, v) => { kv[k] = JSON.parse(JSON.stringify(v)); } };
  const tm = { setTimeout: (f) => { Promise.resolve().then(f); return { unref() {} }; }, setInterval: () => ({ unref() {} }) };   // différé : comme un vrai minuteur
  const api = new Function('process', 'Date', 'auth', 'setTimeout', 'setInterval', 'fetch',
    code + '\nreturn { _fcBudgetOk, _fcNote, _fcEtat, _fcAllocationJour, _fcTel, FC_CAP_JOUR, FC_MIN_GAP, FC_KEY, FC_RESERVE };')(
    { env: Object.assign(key ? { FIRECRAWL_API_KEY: key } : {}, env2 || {}) }, D, auth, tm.setTimeout, tm.setInterval, async () => ({ ok: false }));
  return { api, kv, avancer: ms => { now += ms; }, now: () => now };
};
const tick = () => new Promise(z => setImmediate(z));

console.log('\n── 1. Le budget est extractible, et branché ──');
v('le bloc du budget Firecrawl est extractible de server.js', !!bloc);
v('_firecrawlFetch passe par le budget (garde + note), APRÈS la page gardée',
  /if \(page && Date\.now\(\) - page\.at < ttl\) return page\.c \|\| null;\s*\n\s*if \(!_fcBudgetOk\(opts\.prio\)\) return null;\s*\n\s*_fcNote\(\);/.test(SRV));
v('Firecrawl est le DERNIER recours de l\'ASX (pas un chemin primaire)', /const fc = await _firecrawlFetch\(ASX_IB_URL, null, \{ prio: 'essentiel'/.test(SRV));
v('la clé ne vit QUE dans le .env (jamais en dur)',
  /process\.env\.FIRECRAWL_API_KEY \|\| process\.env\.FIRECRAWL_KEY/.test(SRV) && !/fc-[0-9a-f]{20}/.test(SRV));
v('la ligne rouge est écrite : jamais pour résoudre un défi anti-robot',
  /JAMAIS pour résoudre un défi anti-robot/.test(SRV) && /DÉCISION USER DU 24\/09/.test(SRV));
v('rateprobability via Firecrawl : au plus une lecture toutes les 12 h par banque',
  /const RP_FC_MS = 12 \* 3600e3;/.test(SRV) && /!\(_rpFcAt\[slug\] && Date\.now\(\) - _rpFcAt\[slug\] < RP_FC_MS\)/.test(SRV));
v('… et une banque lue il y a moins de 12 h n\'est pas réinterrogée (sauf réunion depuis)',
  /if \(!force && at0 && now - at0 < RP_FC_MS && !reunionDepuis\)/.test(SRV));
v('proxy de base explicite (le proxy « stealth » coûte 5 crédits)', /proxy: 'basic'/.test(SRV));
v('la télémétrie est exposée à l\'admin (Pipeline taux)', /firecrawl: _fcEtat\(\),/.test(SRV));

(async () => {
if (bloc) {
  console.log('\n── 2. Sans clé, ou avant la relecture des compteurs : ÉTEINT ──');
  const sansCle = monter(bloc, '');
  await tick();
  v('pas de clé → budget refusé (jamais d\'appel à vide)', sansCle.api._fcBudgetOk() === false && sansCle.api.FC_KEY === '');

  console.log('\n── 3. Le cas du courriel : 500 crédits sur 1 000 déjà partis, 29 jours à tenir ──');
  const g = monter(bloc, 'fc-test');
  await tick();
  g.api._fcEtat();   // ouvre le cycle courant avant d'y poser l'état simulé
  g.api._fcTel.util = 500;            // état réel du 24/09 (courriel Firecrawl)
  const alloc = g.api._fcAllocationJour();
  v('part du jour lissée : (500 − réserve 100) ÷ 29 j ≈ 13 appels', alloc === Math.floor((500 - 100) / 29), alloc + ' appels');
  let passe = 0;
  for (let i = 0; i < 60; i++) { if (g.api._fcBudgetOk()) { passe++; g.api._fcNote(); } g.avancer(g.api.FC_MIN_GAP); }
  v('sur 60 tentatives dans la journée, seule la part du jour passe', passe === alloc, passe + ' passés');
  v('… un appel ESSENTIEL (taux directeurs) peut entamer la réserve', g.api._fcBudgetOk('essentiel') === true);

  console.log('\n── 4. Un REDÉPLOIEMENT ne rend plus la réserve pleine (le défaut du 24/09) ──');
  await tick(); await new Promise(z => setTimeout(z, 10));
  const apres = monter(bloc, 'fc-test', g.kv, g.now());
  await tick();
  v('les compteurs sont relus : le jour reste consommé', apres.api._fcTel.n === passe && apres.api._fcTel.util === 500 + passe, JSON.stringify({ n: apres.api._fcTel.n, util: apres.api._fcTel.util }));
  v('… donc aucun appel ordinaire de plus aujourd\'hui', apres.api._fcBudgetOk() === false);

  console.log('\n── 5. Le lendemain, la part est recalculée sur ce qui reste ──');
  apres.avancer(24 * 3600e3);
  v('nouveau jour → appels de nouveau possibles', apres.api._fcBudgetOk() === true);
  v('… et la part suit le solde restant, pas un forfait fixe', apres.api._fcAllocationJour() === Math.min(40, Math.floor((1000 - 500 - passe - 100) / 28)), String(apres.api._fcAllocationJour()));

  console.log('\n── 6. Cycle épuisé → plus rien, sauf l\'essentiel jusqu\'à 2% ──');
  const x = monter(bloc, 'fc-test'); await tick();
  x.api._fcEtat();   // ouvre le cycle courant avant d'y poser l'état simulé
  x.api._fcTel.util = 975;
  v('restant 25 (< réserve) : aucun appel ordinaire', x.api._fcBudgetOk() === false);
  v('… l\'essentiel passe encore (restant > 2% du cycle)', x.api._fcBudgetOk('essentiel') === true);
  x.api._fcTel.util = 985;
  v('… mais plus sous 2%', x.api._fcBudgetOk('essentiel') === false);

  console.log('\n── 7. Le vrai solde Firecrawl prime sur notre compte ──');
  const y = monter(bloc, 'fc-test'); await tick();
  y.api._fcEtat();   // ouvre le cycle courant avant d'y poser l'état simulé
  y.api._fcTel.soldeApi = 120; y.api._fcTel.utilAuSolde = y.api._fcTel.util;
  v('solde réel 120 → part du jour ≈ (120 − 100) ÷ 29', y.api._fcAllocationJour() === 0, String(y.api._fcAllocationJour()));

  console.log('\n── 8. Témoin : sans la relecture au démarrage, le défaut revient ──');
  const mut = bloc.replace("if (v && typeof v === 'object') for (const k of", "if (false) for (const k of");
  v('(témoin) la mutation retire bien la relecture', mut !== bloc);
  if (mut !== bloc) {
    const t = monter(mut, 'fc-test', g.kv, g.now()); await tick();
    v('(témoin) sans elle, un redéploiement rouvre la journée entière', t.api._fcBudgetOk() === true && t.api._fcTel.n === 0);
  }
}
console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);
})();

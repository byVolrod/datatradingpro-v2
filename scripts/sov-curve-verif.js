#!/usr/bin/env node
/**
 * scripts/sov-curve-verif.js — LA COURBE SOUVERAINE DONNE UN BIAIS DE MARCHÉ RÉEL, HONNÊTE ET BORNÉ (23/09)
 * ------------------------------------------------------------------------------------------------
 * Demande user : « un système ultra fiable, temps réel, basé sur des datas concrètes » pour les banques
 * sans futures gratuits. On lit la COURBE SOUVERAINE COURTE — des prix de marché réels — depuis les API
 * OFFICIELLES et gratuites (Bank of Canada « Valet », BCE Data Portal). L'écart (rendement 3M − taux
 * directeur) donne la DIRECTION et une conviction BORNÉE (jamais la quasi-certitude d'un future : ce n'est
 * pas une probabilité par réunion, les échéances des bons ne tombent pas sur les dates de réunion).
 *
 * On EXÉCUTE le vrai code extrait de server.js (jamais une copie) sur les CHARGES RÉELLES mesurées le
 * 23/09 (sondes BoC + BCE, HTTP 200), avec un _jsonGet bouchonné, et des témoins qui MORDENT.
 *
 *   node scripts/sov-curve-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.01 : eps);

// Charges RÉELLES mesurées le 23/09 (structure exacte des API officielles).
const BOC = { observations: [
  { d: '2026-09-16', V80691346: { v: '2.99' }, V80691342: { v: '2.27' }, V80691344: { v: '2.34' }, V80691345: { v: '2.57' } },
  { d: '2025-07-29', V1592248173: { v: '2.72' } },
  { d: '2026-09-22', V80691303: { v: '2.39' }, V80691304: { v: '2.59' }, V80691305: { v: '2.97' } },
] };
const ECB = { dataSets: [{ series: { '0:0:0:0:0:0:0': { observations: { '0': [2.5678486798, 0, 0, null, null] } } } }] };

const A = (() => { const s = SRV.indexOf('const _sovCurve = {};'); return s >= 0 ? SRV.slice(s, s + 'const _sovCurve = {};'.length) : null; })();
const B = (() => { const d = SRV.indexOf('async function _bocValet()'); const f = SRV.indexOf('function _refreshSovCurve()'); return (d >= 0 && f > d) ? SRV.slice(d, f) : null; })();

function monter(bB, jsonGet, cur, textGet) {
  return new Function('_jsonGet', '_textGet', '_ratesState', 'CB', 'auth', 'console',
    A + '\n' + bB + '\nreturn { _bocValet, _ecbYield, _jgbFetch, _computeSovCurve, _sovCurve, SOV };')(
    jsonGet, textGet || (async () => null),
    { banks: { CAD: { rate: cur }, EUR: { rate: cur }, JPY: { rate: cur } } },
    [{ code: 'CAD', rate: cur }, { code: 'EUR', rate: cur }, { code: 'JPY', rate: cur }],
    { aiCacheSet: async () => {}, aiCacheGet: async () => null }, { log() {}, warn() {}, error() {} });
}
const stub = () => async (url) => (String(url).includes('bankofcanada') ? BOC : String(url).includes('ecb.europa') ? ECB : null);

(async () => {
  console.log('\n── 1. Le code est extractible et branché ──');
  v('le bloc courbe souveraine est extractible', !!A && !!B && /_computeSovCurve/.test(B || ''));
  v('le biais LIVE est appliqué dans /api/rates (bb.bias/bb.conv)', /if \(_sovFrais\) \{ bb\.bias = _sov\.bias; bb\.conv = _sov\.conv; \}/.test(SRV));
  v('la carte expose la lecture de courbe (sovCurve)', /sovCurve: _sovFrais \?/.test(SRV));
  v('l\'admin voit la courbe par banque (sov dans _tauxEtat)', /sov: Object\.fromEntries\(Object\.entries\(_sovCurve\)/.test(SRV));
  v('la source est nommée honnêtement (courbe souveraine, distincte des futures)',
    /courbe souveraine \(bons du Trésor, Banque du Canada\)/.test(SRV) && /distinct des futures/.test(SRV));
  v('rafraîchi en tâche de fond', /setInterval\(_refreshSovCurve, 30 \* 60 \* 1000\)/.test(SRV));
  if (!A || !B) { console.log('\n✗ banc interrompu\n'); process.exit(1); }

  const api = monter(B, stub(), 2.25);

  console.log('\n── 2. Les parseurs lisent les VRAIES API officielles ──');
  const boc = await api._bocValet();
  v('Bank of Canada Valet → bon 3M = 2,39 % et 1A = 2,97 %', boc && near(boc.y3, 2.39) && near(boc.y1y, 2.97), JSON.stringify(boc));
  const ecb = await api._ecbYield();
  v('BCE Data Portal → spot AAA 3M = 2,5678 %', ecb && near(ecb.y3, 2.5678, 0.001), JSON.stringify(ecb));

  console.log('\n── 3. Le biais de marché est déduit de l\'écart (rendement − taux directeur) ──');
  const cad = await api._computeSovCurve('CAD');
  v('CAD : écart +0,14 pt → biais HAUSSE', cad && cad.bias === 'hike' && near(cad.spread, 0.14), JSON.stringify(cad));
  v('… conviction BORNÉE et modérée (≤ 0,80, jamais la certitude d\'un future)', cad && cad.conv <= 0.80 && cad.conv >= 0.55 && near(cad.conv, 0.62, 0.02), String(cad && cad.conv));
  const eur = await api._computeSovCurve('EUR');
  v('EUR : écart +0,32 pt → biais HAUSSE, conviction ~0,71', eur && eur.bias === 'hike' && near(eur.spread, 0.318, 0.005) && near(eur.conv, 0.71, 0.02), JSON.stringify(eur));
  // JPY : source CSV (min. des Finances Japon), parseur format-agnostique (1re colonne numérique = 1 an).
  const MOF = 'Date,1Y,2Y,5Y,10Y\r\n2026-09-18,1.10,1.28,1.60,2.10\r\n2026-09-21,1.15,1.30,1.62,2.12\r\n';
  const jpApi = monter(B, stub(), 1.00, async () => MOF);
  const jgb = await jpApi._jgbFetch();
  v('JGB (min. Finances Japon) → 1 an lu = 1,15 (colonne la plus courte, pas la date)', jgb && near(jgb.y3, 1.15), JSON.stringify(jgb));
  const jp = await jpApi._computeSovCurve('JPY');
  v('JPY : écart +0,15 pt (1,15 vs 1,00) → biais hausse', jp && jp.bias === 'hike' && near(jp.spread, 0.15), JSON.stringify(jp));
  v('JPY est branché sur la source JGB officielle', /JPY: \{ fetch: _jgbFetch/.test(SRV));

  console.log('\n── 4. Rien n\'est inventé : donnée absente ou aberrante → aucun biais ──');
  v('aucune donnée (réseau KO) → null (repli maison)', (await monter(B, async () => null, 2.25)._computeSovCurve('CAD')) === null);
  const aberr = await monter(B, async () => ({ observations: [{ d: '2026-09-22', V80691303: { v: '5.00' } }] }), 2.25)._computeSovCurve('CAD');
  v('écart aberrant (5,00 vs 2,25) → null (donnée cassée écartée)', aberr === null, JSON.stringify(aberr));

  console.log('\n── 5. Un écart dans le bruit de la prime de terme ne bascule pas la direction ──');
  const plat = await monter(B, async () => ({ observations: [{ d: '2026-09-22', V80691303: { v: '2.29' }, V80691305: { v: '2.30' } }] }), 2.25)._computeSovCurve('CAD');
  v('écart +0,04 pt (< seuil 0,10, pente plate) → statu quo, pas de hausse fabriquée', plat && plat.bias === 'hold', JSON.stringify(plat));

  console.log('\n── 6. Témoin : sans la garde d\'aberration, une donnée cassée passe ──');
  const mut = B.replace('if (Math.abs(spread) > 1.5) return null;', '');
  v('(témoin) la mutation retire bien la garde', mut !== B);
  if (mut !== B) {
    const t = await monter(mut, async () => ({ observations: [{ d: '2026-09-22', V80691303: { v: '5.00' } }] }), 2.25)._computeSovCurve('CAD');
    v('(témoin) sans elle, un écart de 2,75 pt serait servi comme un biais', !!t && t.bias === 'hike', JSON.stringify(t));
  }

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();

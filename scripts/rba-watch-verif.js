#!/usr/bin/env node
/**
 * scripts/rba-watch-verif.js — LA RBA EST PRICÉE PAR LE MARCHÉ RÉEL, PAS PAR UNE ESTIMATION (23/09)
 * ------------------------------------------------------------------------------------------------
 * Demande user : « accède aux sites que je t'ai donnés et récupère les datas… fiable, temps réel ».
 * L'AUD rejoint la Fed : ses probabilités de prochaine réunion viennent des contrats à terme IB de
 * l'ASX (endpoint public markitdigital, celui du « RBA Rate Tracker »), prix = 100 − taux cash moyen
 * du mois. Deux méthodes selon la position de la réunion dans le mois (contrat du mois, ou 1er mois
 * suivant vierge de réunion) — la réunion du 29/09 tombe dans le second cas (octobre est vierge).
 *
 * On EXÉCUTE le vrai `_computeRbaWatch` extrait de server.js (jamais une copie), avec la charge ASX
 * RÉELLE mesurée le 23/09 (sonde Firecrawl : HTTP 200), une horloge simulée, et des témoins qui
 * MORDENT (garde d'aberration retirée, câblage absent).
 *
 *   node scripts/rba-watch-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.01 : eps);

// ── Extraction : les helpers purs, puis _computeRbaWatch (sans _asxIbItems, injecté en doublure réseau) ──
const PURE = (() => {
  const d = SRV.indexOf('function _asxIbParse(txt) {');
  const f = SRV.indexOf('async function _asxIbItems()');
  return (d >= 0 && f > d) ? SRV.slice(d, f) : null;
})();
const COMPUTE = (() => {
  const d = SRV.indexOf('let _rbaWatch = null;');
  const f = SRV.indexOf("auth.aiCacheGet('rates:rbawatch')");
  return (d >= 0 && f > d) ? SRV.slice(d, f) : null;
})();

// Charge ASX RÉELLE du 23/09 (contrats IB proches, prix de règlement du jour de bourse).
const ITEMS = [
  { dateExpiry: '2026-09-28', pricePreviousSettlement: 95.645, priceLastTrade: 95.64,  volume: 154, symbol: 'IBU2026' },
  { dateExpiry: '2026-10-28', pricePreviousSettlement: 95.435, priceLastTrade: 95.43,  volume: 770, symbol: 'IBV2026' },
  { dateExpiry: '2026-11-28', pricePreviousSettlement: 95.325, priceLastTrade: 95.32,  volume: 790, symbol: 'IBX2026' },
  { dateExpiry: '2026-12-29', pricePreviousSettlement: 95.275, priceLastTrade: 95.255, volume: 0,   symbol: 'IBZ2026' },
];
const RAW = JSON.stringify({ data: { items: ITEMS, chart: { svg: '' } } });
const CAL_RBA = ['2026-02-03', '2026-03-17', '2026-05-05', '2026-06-16', '2026-08-11', '2026-09-29', '2026-11-03', '2026-12-08'];

const faireDate = nowMs => class D extends Date { constructor(...a) { super(...(a.length ? a : [nowMs])); } static now() { return nowMs; } };
function monter(src, nowMs, meetings, curRate, asxStub) {
  const D = faireDate(nowMs);
  const auth = { aiCacheSet: async () => {}, aiCacheGet: async () => null };
  const factory = new Function('CB_MEETINGS', '_ratesState', 'CB', 'auth', 'console', 'Date', '_asxIbItems',
    PURE + '\n' + src + '\nreturn { _computeRbaWatch, _asxImplied, _asxMonthItem, _asxIbParse };');
  return factory({ AUD: meetings }, { banks: { AUD: { rate: curRate } } }, [{ code: 'AUD', rate: curRate }],
    auth, { log() {}, warn() {}, error() {} }, D, asxStub);
}

(async () => {
  console.log('\n── 1. Le code est extractible de server.js ──');
  v('les helpers ASX purs sont extractibles', !!PURE && /_asxImplied/.test(PURE || '') && /_asxMonthItem/.test(PURE || ''));
  v('_computeRbaWatch est extractible', !!COMPUTE && /async function _computeRbaWatch/.test(COMPUTE || ''));
  if (!PURE || !COMPUTE) { console.log('\n✗ banc interrompu\n'); process.exit(1); }

  const api = monter(COMPUTE, Date.UTC(2026, 8, 23, 12, 0, 0), CAL_RBA, 4.35, async () => ITEMS);

  console.log('\n── 2. Les helpers purs lisent le prix ASX ──');
  v('_asxIbParse rend les contrats depuis le JSON réel', (api._asxIbParse(RAW) || []).length === 4);
  v('… rejette un JSON invalide', api._asxIbParse('pas du json') === null);
  v('… rejette une réponse trop grosse (garde mémoire)', api._asxIbParse('{'.padEnd(250001, ' ')) === null);
  v('_asxImplied = 100 − prix de règlement (95,435 → 4,565)', near(api._asxImplied({ pricePreviousSettlement: 95.435 }), 4.565));
  v('… préfère le règlement au dernier échange', near(api._asxImplied({ pricePreviousSettlement: 95.435, priceLastTrade: 99.9 }), 4.565));
  v('… retombe sur le dernier échange si pas de règlement', near(api._asxImplied({ priceLastTrade: 95.43 }), 4.57));
  v('… refuse un prix hors bornes (jamais de NaN servi)', api._asxImplied({ pricePreviousSettlement: 50 }) === null && api._asxImplied({ pricePreviousSettlement: 105 }) === null);
  v('_asxMonthItem trouve le contrat par mois d\'expiry (octobre → IBV)', (api._asxMonthItem(ITEMS, 2026, 9) || {}).symbol === 'IBV2026');

  console.log('\n── 3. RÉUNION DU 29/09 : fin de mois → 1er mois suivant vierge (octobre) ──');
  const r = await api._computeRbaWatch();
  v('une mesure est émise pour la réunion du 29/09', !!r && r.meeting === '2026-09-29', JSON.stringify(r));
  if (r) {
    v('méthode = mois suivant vierge (le contrat de septembre est déjà réglé le 28)', /mois suivant vierge/.test(r.meth || ''), r.meth);
    v('taux implicite post-réunion = octobre (4,565)', near(r.impliedRate, 4.565), String(r.impliedRate));
    v('hausse pricée ≈ 86 % (contre 58 % en estimation maison)', r.hike === 86 && r.hold === 14 && r.cut === 0, JSON.stringify(r));
    v('Δ attendu = +21,5 bps', near(r.changeBps, 21.5, 0.05), String(r.changeBps));
    v('la source est nommée (ASX IB futures)', /ASX.*interbank futures/i.test(r.src || ''), r.src);
  }

  console.log('\n── 4. RÉUNION TÔT DANS LE MOIS : pondération sur le contrat du mois ──');
  // Réunion du 03/11 vue depuis le 15/10 : jour 3, 27 jours post → branche « contrat du mois » (novembre).
  const b = await monter(COMPUTE, Date.UTC(2026, 9, 15, 12, 0, 0), ['2026-11-03', '2026-12-08'], 4.60, async () => ITEMS)._computeRbaWatch();
  v('une mesure est émise pour la réunion du 03/11', !!b && b.meeting === '2026-11-03', JSON.stringify(b));
  if (b) {
    v('méthode = contrat du mois', /contrat du mois/.test(b.meth || ''), b.meth);
    // novembre IBX = 4,675 ; expectedAfter = (4,675×30 − 3×4,60)/27 = 4,683 ; Δ = +8,3 bps ; hausse 33 %.
    v('taux implicite ≈ 4,683 et hausse ≈ 33 %', near(b.impliedRate, 4.683) && b.hike === 33 && b.hold === 67, JSON.stringify(b));
  }

  console.log('\n── 5. Rien n\'est inventé : contrats absents ou mouvement aberrant → aucune émission ──');
  v('aucun contrat ASX (réseau KO) → null (repli maison)', (await monter(COMPUTE, Date.UTC(2026, 8, 23, 12, 0, 0), CAL_RBA, 4.35, async () => null)._computeRbaWatch()) === null);
  const aberr = await monter(COMPUTE, Date.UTC(2026, 8, 23, 12, 0, 0), CAL_RBA, 3.00, async () => ITEMS)._computeRbaWatch();
  v('taux courant incohérent (3,00 vs 4,565 pricé) → mouvement > 2 pas → null', aberr === null, JSON.stringify(aberr));

  console.log('\n── 6. Témoin : sans la garde d\'aberration, le chiffre douteux passe ──');
  const mut = COMPUTE.replace('if (Math.abs(change) > 0.60) return null;', '');
  v('(témoin) la mutation retire bien la garde', mut !== COMPUTE);
  if (mut !== COMPUTE) {
    const t = await monter(mut, Date.UTC(2026, 8, 23, 12, 0, 0), CAL_RBA, 3.00, async () => ITEMS)._computeRbaWatch();
    v('(témoin) sans elle, une hausse à 100 % est émise sur un taux courant faux', !!t && t.hike === 100, JSON.stringify(t));
  }

  console.log('\n── 7. Le calcul est BRANCHÉ dans /api/rates (pas seulement défini) ──');
  v('la prochaine réunion AUD prend le pricing ASX quand il porte la même date',
    /b\.code === 'AUD' && meetings\[0\] && _rbaWatch && _rbaWatch\.meeting === meetings\[0\]\.date/.test(SRV));
  v('marketImplied expose le cross-check ASX pour l\'AUD',
    /b\.code === 'AUD' && _rbaWatch\) \? _rbaWatch/.test(SRV));
  v('_computeRbaWatch tourne en tâche de fond (~10 min, comme FedWatch)',
    /setInterval\(_computeRbaWatch, 10 \* 60 \* 1000\)/.test(SRV) && /setTimeout\(_computeRbaWatch, 11000\)/.test(SRV));

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();

#!/usr/bin/env node
/**
 * scripts/crypto-actions-verif.js — LES WIDGETS CRYPTO ET ACTIONS (V3, multi-actifs étape 5).
 * ------------------------------------------------------------------------------------------------
 * 26/09. « Marché crypto » (sept cryptos, ETH / BTC, lien Bitcoin–Nasdaq) et « Géants de la cote »
 * (sept grandes valeurs américaines face au S&P 500). Tout y est calculé : horizons, volatilité,
 * rapport, corrélation, moyenne du panier. Ce banc rejoue le VRAI code — la tranche de la fiche
 * actif ET celle des deux tableaux, ensemble, comme en production — sur des séries dont on connaît
 * la réponse, puis la VRAIE lecture et le VRAI rendu du module client, et tient les contrats avec
 * la fiche actif (chaque ligne s'ouvre sur une fiche qui existe) et la bibliothèque.
 *
 *   node scripts/crypto-actions-verif.js
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const MOD = fs.readFileSync(path.join(RACINE, 'public/js/v2/crypto.js'), 'utf8');
const RA = fs.readFileSync(path.join(RACINE, 'public/js/v2/recherche-actifs.js'), 'utf8');
const WJ = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
const IDX = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
const BOOT = fs.readFileSync(path.join(RACINE, 'public/js/v2/boot.js'), 'utf8');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
const proche = (a, b, e) => a != null && Math.abs(a - b) <= (e == null ? 1e-6 : e);

console.log('\n── Tableaux crypto et grandes valeurs (vraies tranches de server.js) ──');
const a1 = SRV.indexOf('const _ACTIF_YF = {'), b1 = SRV.indexOf("app.get('/api/v2/actif-profil'");
const a2 = SRV.indexOf('const _CRYPTO_TABLEAU = ['), b2 = SRV.indexOf("app.get('/api/v2/crypto-tableau'");
v('les deux tranches sont trouvées (fiche actif, puis tableaux)', a1 > 0 && b1 > a1 && a2 > b1 && b2 > a2);
const SERIES = {};
const brut = s => ({ chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: s.ts, indicators: { quote: [{ close: s.c, high: s.c, low: s.c }] } }] } });
const _yfChart = async sym => ({ raw: SERIES[sym] ? brut(SERIES[sym]) : null });
const J0 = Date.parse('2025-09-26T16:00:00Z');
const serie = (fn, tous) => { const ts = [], c = []; for (let i = 0; i <= 365; i++) { const t = J0 + i * 864e5, w = new Date(t).getUTCDay(); if (!tous && (w === 0 || w === 6)) continue; ts.push(t / 1000); c.push(fn(i)); } return { ts, c }; };
let T = null;
try { T = new Function('_yfChart', SRV.slice(a1, b1) + SRV.slice(a2, b2) + '\nreturn { _tableauLigne, _rapportSeries, _cryptoLire, _geantsLire, _actifSerieDe, _CRYPTO_TABLEAU, _GRANDES_VALEURS };')(_yfChart); }
catch (e) { v('les tranches s\'évaluent ensemble', false, e.message); }

(async () => {
  if (T) {
    const S = fn => T._actifSerieDe(brut(serie(fn, true)));
    const plat = S(i => (i === 365 ? 105 : 100));
    const L = T._tableauLigne('BTC-USD', 'Bitcoin', 'BTCUSD', plat);
    v('une ligne : dernier cours et horizons (24 h, 7 j, 30 j, depuis janvier) lus sur la série', L.ok && L.dernier === 105 && [L.j1, L.s1, L.m1].every(x => proche(x, 5, 1e-9)), JSON.stringify(L));
    const zz = T._tableauLigne('X', 'X', 'X', S(i => 100 * Math.exp((i % 2) * 0.01)));
    v('volatilité 30 jours annualisée sur 365 (la crypto ne ferme jamais) : ±1% par jour → ≈ 19,6%', proche(zz.vol30, 19.4, 0.8), String(zz.vol30));
    v('série trop courte : ligne marquée indisponible, jamais des zéros', T._tableauLigne('X', 'X', 'X', plat.slice(0, 10)).ok === false);
    const eth = S(i => 2000 + i), btc = S(i => (2000 + i) * 25);
    const R = T._rapportSeries(eth, btc);
    v('ETH / BTC : le bon sens (Ethereum divisé par Bitcoin, 0,04 ici)', R && proche(R.dernier, 0.04, 1e-9) && proche(R.m1, 0, 1e-9), JSON.stringify(R));
    // Scénario complet : sept cryptos + Nasdaq, SOL muet.
    const marche = i => 100 * Math.exp(0.02 * Math.sin(i * 1.7) + 0.01 * Math.cos(i * 0.9));
    T._CRYPTO_TABLEAU.forEach(([s], k) => { SERIES[s] = serie(i => marche(i + k) * (k + 1), true); });
    SERIES['SOL-USD'] = null;
    SERIES['^NDX'] = serie(marche);
    const C = await T._cryptoLire();
    v('Marché crypto : sept lignes, une crypto muette reste affichée « indisponible »', C && C.lignes.length === 7 && C.lignes.find(l => l.sym === 'SOL-USD').ok === false && C.lignes.filter(l => l.ok).length === 6, JSON.stringify(C && C.lignes.map(l => l.sym + ':' + l.ok)));
    v('… ETH / BTC et lien Bitcoin–Nasdaq présents (séances communes : corrélation +1 ici)', C && C.ethBtc && C.lienNdx && proche(C.lienNdx.c60, 1, 0.01), JSON.stringify(C && C.lienNdx));
    // Les séries sont gardées 30 min (comme en production) : on pose le scénario AVANT la première lecture.
    // Les actions ne cotent pas le week-end : le saut de cours est posé 6 jours avant la fin.
    T._GRANDES_VALEURS.forEach(([s], k) => { SERIES[s] = serie(i => (i >= 360 ? 100 + k : 100)); });
    SERIES['^GSPC'] = serie(i => (i >= 360 ? 101 : 100));
    const G = await T._geantsLire();
    const attendu = T._GRANDES_VALEURS.map((_, k) => k).reduce((x, y) => x + y, 0) / 7;
    v('Géants : sept valeurs et le S&P 500 en référence', G && G.lignes.length === 7 && G.lignes.every(l => l.ok) && G.sp && G.sp.ok && proche(G.sp.m1, 1, 1e-9), JSON.stringify(G && G.sp));
    v('… le panier est la moyenne SIMPLE des sept (annoncée comme telle)', G && proche(G.panier.m1, +attendu.toFixed(2), 1e-9), JSON.stringify(G && G.panier) + ' attendu ' + attendu);
  }
  for (const [route, ttl, vol] of [['crypto-tableau', '10 \\* 60e3', '_cryptoVol'], ['grandes-valeurs', '10 \\* 60e3', '_geantsVol']]) {
    const r = (SRV.match(new RegExp("app\\.get\\('/api/v2/" + route + "'[\\s\\S]*?\\n\\}\\);")) || [''])[0];
    v('/api/v2/' + route + ' : aperçu V3 seulement, cache 10 min, une lecture à la fois', /requireAdmin/.test(r) && /_v2Actif\(\)/.test(r) && new RegExp(ttl).test(r) && r.includes(vol));
  }

  console.log('\n── Module client (vrai v2/crypto.js) ──');
  const reg = [];
  const win = { DTPWidgets: { enregistrer: w => reg.push(w) } };
  new Function('window', 'document', 'DTPWidgets', MOD)(win, { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) }, win.DTPWidgets);
  const M = win._v3CryptoActions || {};
  v('deux widgets : « Marché crypto » et « Géants de la cote », avec vignette, aide, source, « à surveiller »', reg.map(w => w.id).join() === 'v3-crypto,v3-geants' && reg.every(w => /<svg/.test(w.apercu) && w.aide && w.src && w.watch));
  v('ETH / BTC se lit en tendance sur un mois (±3%)', /s’étend/.test(M.lectureEthBtc({ m1: 4 })) && /se replie/.test(M.lectureEthBtc({ m1: -4 })) && /Stable/.test(M.lectureEthBtc({ m1: 1 })));
  v('Bitcoin–Nasdaq : fort, net, faible, inverse', /Lien fort/.test(M.lectureNdx({ c60: 0.6 })) && /Lien net/.test(M.lectureNdx({ c60: 0.3 })) && /Peu de lien/.test(M.lectureNdx({ c60: 0.05 })) && /inverse/.test(M.lectureNdx({ c60: -0.4 })));
  v('Géants : mènent, suivent, ou le marché avance sans eux (écart d\'un point sur le mois)', /mènent/.test(M.lectureGeants({ panier: { m1: 3 }, sp: { ok: true, m1: 1 } })) && /sans eux/.test(M.lectureGeants({ panier: { m1: -1 }, sp: { ok: true, m1: 1 } })) && /au rythme/.test(M.lectureGeants({ panier: { m1: 1.2 }, sp: { ok: true, m1: 1 } })));
  const lc = (o) => Object.assign({ ok: true, dernier: 64000, j1: 1.2, s1: -3.4, m1: 8.1, ytd: 20, vol30: 48 }, o);
  const hc = M.rendreCrypto({ at: Date.now(), lignes: [lc({ sym: 'BTC-USD', nom: 'Bitcoin', code: 'BTCUSD' }), { sym: 'SOL-USD', nom: 'Solana', code: 'SOLUSD', ok: false }], ethBtc: { dernier: 0.0385, m1: 4.2, rang: 40 }, lienNdx: { c60: 0.52 } });
  v('rendu crypto : cours, variations signées et teintées, ligne muette « indisponible », aucun NaN', /64.000/.test(hc) && /\+1,20%/.test(hc) && /−3,40%/.test(hc) && /rgba\(0,230,118/.test(hc) && /indisponible pour le moment/.test(hc) && !/NaN|undefined/.test(hc), hc.slice(0, 200));
  const hg = M.rendreGeants({ at: Date.now(), lignes: [lc({ sym: 'NVDA', nom: 'Nvidia', code: 'NVDA', dernier: 181.2 })], panier: { j1: 0.4, m1: 3, ytd: 18 }, sp: lc({ sym: '^GSPC', nom: 'S&P 500', code: 'US500', dernier: 5956.3, m1: 1 }) });
  v('rendu géants : moyenne des sept puis S&P 500 en référence, lecture en clair', /Moyenne des sept/.test(hg) && /S&amp;P 500/.test(hg) && /mènent la hausse/.test(hg) && !/NaN|undefined/.test(hg));
  // Contrat avec la fiche actif : chaque ligne s'ouvre sur une fiche qui existe.
  const codes = new Set([...RA.matchAll(/\['([A-Z0-9.]+)', '[^']+', '(?:crypto|actions|indices)'/g)].map(m => m[1]));
  const orph = [...(hc + hg).matchAll(/data-code="([^"]+)"/g)].map(m => m[1]).filter(c => !codes.has(c));
  const orphServ = T ? T._CRYPTO_TABLEAU.map(x => x[2]).concat(T._GRANDES_VALEURS.map(x => x[0])).filter(c => !codes.has(c)) : ['?'];
  v('chaque ligne ouvre une fiche qui existe au catalogue de la recherche', !orph.length && !orphServ.length, orph.concat(orphServ).join(','));

  console.log('\n── Bibliothèque ──');
  v('filtre de marché : « Marché crypto » sous Crypto, « Géants de la cote » sous Actions', /'v3-crypto': \['crypto'\]/.test(WJ) && /'v3-geants': \['actions'\]/.test(WJ));
  v('la bibliothèque propose la puce « Actions »', /data-classe="actions"[^>]*>Actions</.test(IDX));
  v('le module est chargé par l\'aperçu V3 (boot.js)', /\/js\/v2\/crypto\.js\?v=/.test(BOOT));

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('✗ banc en erreur :', e.stack); process.exit(1); });

#!/usr/bin/env node
/**
 * scripts/fiche-actif-verif.js — LA FICHE D'UN ACTIF, EN SOUS-ONGLETS PROPRES À SA CLASSE (V3).
 * ------------------------------------------------------------------------------------------------
 * 26/09, multi-actifs étape 4. La fiche d'un actif (recherche du desk) se range en onglets dont le
 * jeu dépend de la classe : Aperçu, Performance, Moteurs (« Face à son indice » pour une action),
 * Agenda, et la classe entière (sauf les actions). Deux onglets reposent sur des CALCULS serveur
 * (horizons, fourchette, tendance, volatilité, corrélations) : un calcul faux s'affiche avec
 * l'autorité d'un chiffre, et rien à l'écran ne le trahit. Ce banc les rejoue donc sur des séries
 * dont on connaît la réponse, avec le VRAI code extrait de server.js (pas une copie).
 *
 * Il tient aussi les CONTRATS entre les deux moitiés :
 *   · chaque actif du catalogue client a son symbole Yahoo dans la liste FERMÉE du serveur, dans la
 *     bonne classe (sinon l'onglet Performance répond « actif inconnu ») ;
 *   · la route refuse un symbole hors liste (jamais de lecture arbitraire chez Yahoo) ;
 *   · les caches restent bornés (512 Mo de RAM sur le VPS).
 *
 *   node scripts/fiche-actif-verif.js
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const MOD = fs.readFileSync(path.join(RACINE, 'public/js/v2/recherche-actifs.js'), 'utf8');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
const proche = (a, b, e) => a != null && Math.abs(a - b) <= (e == null ? 1e-6 : e);

/* ══ 1. LE MODULE CLIENT : jeux d'onglets, catalogue, agenda ══════════════════════════════════ */
console.log('\n── Fiche actif : onglets par classe (vrai module v2/recherche-actifs.js) ──');
const win = {}, doc = { getElementById: () => ({}), head: { appendChild() {} }, createElement: () => ({}) };
new Function('window', 'document', MOD)(win, doc);
const R = win.DTPRechercheActifs;
v('le module expose ses onglets et son filtre d\'agenda', !!(R && R.ONGLETS && R.agenda && R.CATALOGUE));
const O = (R && R.ONGLETS) || {};
const cles = cl => (O[cl] || []).map(t => t[0]), noms = cl => (O[cl] || []).map(t => t[1]);
v('chaque classe du catalogue a son jeu d\'onglets, qui commence par « Aperçu »',
  ['indices', 'actions', 'metaux', 'energie', 'crypto'].every(cl => O[cl] && O[cl][0][0] === 'apercu' && O[cl][0][1] === 'Aperçu'));
v('Performance et Moteurs partout (le profil serveur sert toutes les classes)', Object.keys(O).every(cl => cles(cl).includes('perf') && cles(cl).includes('moteurs')));
v('une action se lit « Face à son indice », et n\'a PAS d\'onglet de classe (le flux Multi-actifs ne la suit pas)',
  noms('actions').includes('Face à son indice') && !cles('actions').includes('classe'));
v('indices, métaux, énergie et crypto ont leur onglet de classe, nommé pour elle',
  noms('indices').includes('Indices mondiaux') && noms('metaux').includes('Tous les métaux') && noms('energie').includes('Toute l’énergie') && noms('crypto').includes('Marché crypto'));
v('l\'agenda de l\'énergie dit ce qu\'il montre (« Stocks et agenda »)', noms('energie').includes('Stocks et agenda'));
v('le jeu d\'onglets DIFFÈRE selon la classe (sinon ce ne sont pas des onglets « par classe »)',
  new Set(Object.keys(O).map(cl => noms(cl).join('|'))).size === Object.keys(O).length);

// Le contrat client ↔ serveur : chaque symbole Yahoo du catalogue est dans la liste FERMÉE du serveur.
const LISTE = (() => { try { return eval('(' + (SRV.match(/const _ACTIF_YF = (\{[\s\S]*?\n\});/) || [, 'null'])[1] + ')'); } catch (e) { return null; } })();
v('la liste fermée du serveur (_ACTIF_YF) est lisible', !!LISTE && Object.keys(LISTE).length >= 40);
const cat = (R && R.CATALOGUE) || [];
const sansYf = cat.filter(a => !a.yf).map(a => a.code);
v('chaque actif du catalogue a un symbole Yahoo (sinon Performance et Moteurs restent vides)', cat.length >= 40 && !sansYf.length, sansYf.join(','));
const horsListe = cat.filter(a => a.yf && (!LISTE || LISTE[a.yf] !== a.cl)).map(a => a.code + '→' + a.yf + '(' + (LISTE && LISTE[a.yf]) + ')');
v('… chacun est dans la liste du serveur, DANS SA CLASSE', !!LISTE && !horsListe.length, horsListe.join(', '));
const orphelins = LISTE ? Object.keys(LISTE).filter(y => !cat.some(a => a.yf === y)) : ['?'];
v('… et la liste du serveur n\'ouvre rien que le catalogue ne propose', !orphelins.length, orphelins.join(','));

// L'agenda : la devise de la place, et un motif pour l'énergie.
const M = Date.parse('2026-09-28T10:00:00Z');
const EV = [
  { timestamp: M + 3600e3, title: 'CPI m/m', currency: 'USD', impact: 'High' },
  { timestamp: M + 7200e3, title: 'ECB Main Refinancing Rate', currency: 'EUR', impact: 'High' },
  { timestamp: M + 9000e3, title: 'German Ifo', currency: 'EUR', impact: 'Medium' },
  { timestamp: M + 26 * 3600e3, title: 'Crude Oil Inventories', currency: 'USD', impact: 'Medium' },
  { timestamp: M + 30 * 3600e3, title: 'OPEC-JMMC Meetings', currency: 'ALL', impact: 'Low' },
  { timestamp: M - 3 * 86400e3, title: 'NFP (trop ancien)', currency: 'USD', impact: 'High' },
  { timestamp: M + 9 * 86400e3, title: 'FOMC (trop loin)', currency: 'USD', impact: 'High' },
  { timestamp: M - 3600e3, title: 'GDP q/q', currency: 'USD', impact: 'High', actual: '0.4%' },
];
const ag = code => R.agenda(EV, cat.find(a => a.code === code), M).map(e => e.title);
v('DAX : la zone euro à fort impact, pas le dollar ni l\'impact moyen', ag('DE40').join('|') === 'ECB Main Refinancing Rate', ag('DE40').join('|'));
v('S&P 500 : le dollar à fort impact, y compris ce qui vient de tomber (24 h)', ag('US500').join('|') === 'GDP q/q|CPI m/m', ag('US500').join('|'));
v('pétrole : les stocks et l\'OPEP, quel que soit leur impact affiché', ['Crude Oil Inventories', 'OPEC-JMMC Meetings'].every(t => ag('WTI').includes(t)) && ag('WTI').includes('CPI m/m'), ag('WTI').join('|'));
v('une action européenne suit l\'euro (LVMH), une américaine le dollar (Apple)', ag('MC').includes('ECB Main Refinancing Rate') && !ag('MC').includes('CPI m/m') && ag('AAPL').includes('CPI m/m'));
v('rien au-delà de 7 jours, rien d\'avant 24 h', !ag('US500').some(t => /trop/.test(t)));
v('l\'agenda est rangé dans l\'ordre du temps', (() => { const l = R.agenda(EV, cat.find(a => a.code === 'WTI'), M); return l.every((e, i) => !i || l[i - 1].timestamp <= e.timestamp); })());

/* ══ 2. LES CALCULS DU SERVEUR (vraie tranche de server.js) ═══════════════════════════════════ */
console.log('\n── Fiche actif : performance et moteurs (vraie tranche de server.js) ──');
const a = SRV.indexOf('const _ACTIF_YF = {'), b = SRV.indexOf("app.get('/api/v2/actif-profil'");
v('la tranche est trouvée dans server.js', a > 0 && b > a, a + ' → ' + b);
const SERIES = {};   // symbole → { ts[], c[], off } : ce que « Yahoo » répondra
let appels = 0;
const brut = (s) => ({ chart: { result: [{ meta: { gmtoffset: s.off || 0 }, timestamp: s.ts, indicators: { quote: [{ close: s.c, high: s.c.map(x => x == null ? null : x * 1.01), low: s.c.map(x => x == null ? null : x * 0.99) }] } }] } });
const _yfChart = async (sym) => { appels++; const s = SERIES[sym]; return { raw: s ? brut(s) : null, via: s ? 'session' : 'aucun' }; };
let T = null;
try {
  T = new Function('_yfChart', SRV.slice(a, b) + '\nreturn { _ACTIF_YF, _actifMoteursDe, _actifSerieDe, _actifSerie, _actifPerf, _actifStats, _actifLien, _actifProfil, _actifSeries, _actifProfils };')(_yfChart);
} catch (e) { v('la tranche s\'évalue', false, e.message); }

// Générateur : un point par jour ouvré (ou chaque jour pour la crypto), clôture à 16 h UTC.
const J0 = Date.parse('2025-09-26T16:00:00Z');
const serie = (fn, tousLesJours, n) => {
  const ts = [], c = [];
  for (let i = 0; i <= (n || 365); i++) {
    const t = J0 + i * 86400e3, wd = new Date(t).getUTCDay();
    if (!tousLesJours && (wd === 0 || wd === 6)) continue;
    ts.push(Math.floor(t / 1000)); c.push(fn(i, t));
  }
  return { ts, c };
};

if (T) {
  // Dates LOCALES : une clôture de Tokyo (15 h UTC, décalage +9 h) tombe le LENDEMAIN à Tokyo.
  const s1 = T._actifSerieDe(brut({ ts: [Date.parse('2026-09-24T15:00:00Z') / 1000, Date.parse('2026-09-24T20:00:00Z') / 1000], c: [100, 101], off: 32400 }));
  v('la date d\'une séance est celle de SA place (gmtoffset), pour aligner Tokyo et New York', s1.length === 1 && s1[0].d === '2026-09-25' && s1[0].c === 101, JSON.stringify(s1));
  const s2 = T._actifSerieDe(brut({ ts: [1, 86401, 172801], c: [100, null, 102] }));
  v('une clôture manquante est ignorée, jamais lue comme zéro', s2.length === 2 && s2.every(p => p.c > 0));

  // Horizons : prix constant, puis +10% le dernier jour → 1 jour = 1 an = +10%.
  const plat = T._actifSerieDe(brut(serie((i, t) => i === 365 ? 110 : 100, true)));
  const P = Object.fromEntries(T._actifPerf(plat).map(h => [h.k, h.v]));
  v('sept horizons, de 1 jour à 1 an', Object.keys(P).join() === '1J,1S,1M,3M,6M,YTD,1A');
  v('+10% le dernier jour : +10% sur chaque horizon', ['1J', '1S', '1M', '3M', '6M', 'YTD', '1A'].every(k => proche(P[k], 10, 1e-9)), JSON.stringify(P));
  // Depuis janvier : la référence est la DERNIÈRE clôture de l'année précédente, pas le 1er janvier.
  const ytd = T._actifSerieDe(brut(serie((i, t) => new Date(t).getUTCFullYear() < 2026 ? (new Date(t).getUTCMonth() === 11 && new Date(t).getUTCDate() === 31 ? 80 : 90) : 100, true)));
  const Y = T._actifPerf(ytd).find(h => h.k === 'YTD').v;
  v('« Depuis janvier » part de la clôture du 31 décembre (80 → 100 = +25%)', proche(Y, 25, 1e-9), String(Y));

  // Statistiques : fourchette, moyennes, volatilité.
  const monte = T._actifSerieDe(brut(serie(i => 100 + i * 0.1)));
  const St = T._actifStats(monte, 'indices');
  // Fourchette lue sur les HAUTS et BAS de séance (fixture : haut = clôture + 1%), pas sur les clôtures.
  const dern = monte[monte.length - 1].c;
  v('fourchette sur les hauts et bas de séance : clôture au sommet = 96% (le haut du jour est 1% au-dessus)',
    proche(St.an.haut, dern * 1.01, 1e-9) && St.an.pos === Math.round(100 * (dern - St.an.bas) / (St.an.haut - St.an.bas)) && St.an.pos === 96, JSON.stringify(St.an));
  v('tendance régulière à la hausse : au-dessus des moyennes 50 ET 200 jours', St.tendance.e50 > 0 && St.tendance.e200 > St.tendance.e50, JSON.stringify(St.tendance));
  v('la courbe d\'un an est allégée (≤ 91 points) et finit sur la dernière séance', St.serie.length <= 91 && St.serie[St.serie.length - 1][1] === monte[monte.length - 1].c);
  // Volatilité : rendements alternés ±1% → écart-type ≈ 1% par séance → ≈ 15,9% annualisé sur 252.
  const zz = T._actifSerieDe(brut(serie(i => 100 * Math.exp((i % 2 ? 1 : 0) * 0.01))));
  const Vz = T._actifStats(zz, 'indices').vol;
  v('volatilité 20 séances annualisée sur 252 séances (±1% par jour → ≈ 16%)', proche(Vz.v20, 16.3, 0.6), JSON.stringify(Vz));
  const Vc = T._actifStats(T._actifSerieDe(brut(serie(i => 100 * Math.exp((i % 2 ? 1 : 0) * 0.01), true))), 'crypto').vol;
  v('… et sur 365 pour la crypto, qui ne ferme jamais (≈ 19,6%)', proche(Vc.v20, 19.6, 0.7), JSON.stringify(Vc));
  const calme = T._actifSerieDe(brut(serie(i => 100 * Math.exp((i % 2 ? 1 : 0) * (i > 330 ? 0.001 : 0.01)))));
  v('une volatilité au plus bas de l\'année se classe tout en bas (rang ≤ 5%)', T._actifStats(calme, 'indices').vol.rang <= 5, JSON.stringify(T._actifStats(calme, 'indices').vol));

  // Liens : même série → +1 ; série inverse → −1 ; sensibilité à un taux en % pour +10 pb.
  const marche = (i) => 100 * Math.exp(0.02 * Math.sin(i * 1.7) + 0.01 * Math.cos(i * 0.9));
  const X = T._actifSerieDe(brut(serie(marche)));
  const inv = T._actifSerieDe(brut(serie(i => 1 / marche(i))));
  const L1 = T._actifLien(X, X, false), L2 = T._actifLien(X, inv, false);
  v('un actif face à lui-même : corrélation +1, sensibilité +1% pour +1%', proche(L1.c60, 1, 0.005) && proche(L1.sens, 1, 0.01), JSON.stringify(L1));
  v('face à son inverse : −1, sur 60 variations (61 séances communes)', proche(L2.c60, -1, 0.005) && L2.n === 60, JSON.stringify(L2));
  const taux = T._actifSerieDe(brut(serie(i => 4 + 0.05 * Math.sin(i * 1.7))));
  const dep = T._actifSerieDe(brut(serie(i => 100 * Math.exp(-0.05 * (0.05 * Math.sin(i * 1.7))))));
  const L3 = T._actifLien(dep, taux, true);
  v('face à un TAUX : variations en points, sensibilité lue pour +10 pb (−0,5%)', proche(L3.c60, -1, 0.005) && proche(L3.sens, -0.5, 0.01), JSON.stringify(L3));
  // Crypto (7 j/7) face à un indice (5 j/7) : seules les dates COMMUNES comptent.
  const btc = T._actifSerieDe(brut(serie(marche, true))), idx = T._actifSerieDe(brut(serie(marche)));
  const L4 = T._actifLien(btc, idx, false);
  v('crypto face à un indice : aligné sur les séances communes (corrélation +1, pas de week-end fantôme)', L4 && proche(L4.c60, 1, 0.005), JSON.stringify(L4));
  v('moins de 21 séances communes : pas de lien affiché plutôt qu\'un chiffre au hasard', T._actifLien(X.slice(-15), X.slice(-15), false) === null);

  // Moteurs par classe.
  const md = s => T._actifMoteursDe(s).map(m => m[0]);
  v('une action se mesure d\'abord à SON indice (LVMH → CAC 40, SAP → DAX, Apple → Nasdaq 100)', md('MC.PA')[0] === '^FCHI' && md('SAP.DE')[0] === '^GDAXI' && md('AAPL')[0] === '^NDX');
  v('un actif n\'est jamais son propre moteur, et en a quatre', md('^GSPC').length === 4 && !md('^GSPC').includes('^GSPC') && !md('GC=F').includes('GC=F') && !md('BTC-USD').includes('BTC-USD'));
  v('un métal face au dollar et aux taux ; une crypto face au Nasdaq', md('SI=F').slice(0, 2).join() === 'DX-Y.NYB,^TNX' && md('ETH-USD')[0] === '^NDX');

  // Le profil complet, et ses caches.
  (async () => {
    for (const s of ['BTC-USD', '^NDX', 'DX-Y.NYB', 'GC=F', '^VIX']) SERIES[s] = serie((i) => marche(i + s.length), s === 'BTC-USD');
    const p = await T._actifProfil('BTC-USD');
    v('profil complet : 7 horizons, 4 moteurs, fourchette, tendance, volatilité, source', p && p.perf.length === 7 && p.moteurs.length === 4 && p.an && p.tendance && p.vol && /Yahoo/.test(p.source), p && JSON.stringify(Object.keys(p)));
    const n1 = appels; await T._actifProfil('BTC-USD');
    v('second appel servi par le cache (aucune lecture Yahoo de plus)', appels === n1, (appels - n1) + ' lecture(s)');
    SERIES['SOL-USD'] = null;
    v('Yahoo muet : pas de profil (la route répond 502, jamais un profil vide présenté comme vrai)', (await T._actifProfil('SOL-USD')) === null);
    for (let i = 0; i < 75; i++) { SERIES['T' + i] = serie(marche, true, 40); await T._actifSerie('T' + i); }
    v('le cache des séries reste borné (60 au plus : 512 Mo de RAM)', T._actifSeries.size <= 60, String(T._actifSeries.size));
    const route = (SRV.match(/app\.get\('\/api\/v2\/actif-profil'[\s\S]*?\n\}\);/) || [''])[0];
    v('la route est réservée à l\'aperçu V3 (requireAdmin + _v2Actif)', /requireAdmin/.test(route) && /_v2Actif\(\)/.test(route));
    v('… et refuse un symbole hors liste AVANT toute lecture', /hasOwnProperty\.call\(_ACTIF_YF, sym\)[\s\S]*400/.test(route) && route.indexOf('hasOwnProperty') < route.indexOf('_actifProfil('));
    fin();
  })().catch(e => { v('le profil se calcule', false, e.stack); fin(); });
} else fin();

function fin() {
  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
}

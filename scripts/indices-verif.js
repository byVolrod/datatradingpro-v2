#!/usr/bin/env node
/**
 * scripts/indices-verif.js — LES WIDGETS DES INDICES (V3, multi-actifs étape 5).
 * ------------------------------------------------------------------------------------------------
 * 26/09. Deux widgets propres aux indices : « Indices mondiaux » et « Régime de volatilité ».
 * Leurs défauts possibles sont de ceux qu'aucune capture ne montre le jour où on la prend :
 *   · un état de séance faux une semaine sur deux (changement d'heure), à la pause de midi de
 *     Tokyo, ou le week-end — l'écran affiche « Ouvert » avec aplomb ;
 *   · une courbe du VIX dite « normale » alors qu'elle est inversée ;
 *   · une tuile qui ne s'ouvre sur rien, parce que le code de la fiche n'existe pas au catalogue.
 * Ce banc rejoue donc le VRAI code (module client chargé tel quel, tranche de server.js) à des
 * instants choisis, et tient les contrats entre le widget, le flux Multi-actifs et la fiche.
 *
 *   node scripts/indices-verif.js
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const IX = fs.readFileSync(path.join(RACINE, 'public/js/v2/indices.js'), 'utf8');
const RA = fs.readFileSync(path.join(RACINE, 'public/js/v2/recherche-actifs.js'), 'utf8');
const WJ = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
const BOOT = fs.readFileSync(path.join(RACINE, 'public/js/v2/boot.js'), 'utf8');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };

console.log('\n── Indices mondiaux : état des séances (vrai module v2/indices.js) ──');
const reg = [];
const win = { DTPWidgets: { enregistrer: w => reg.push(w) } };
const doc = { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) };
new Function('window', 'document', 'DTPWidgets', IX)(win, doc, win.DTPWidgets);
const I = win._v3Indices;
v('le module se charge et enregistre ses deux widgets', !!(I && I.etatPlace) && reg.map(w => w.id).join() === 'v3-indices,v3-vix', reg.map(w => w.id).join());
const P = (I && I.PLACES) || {};
const e = (sym, iso) => I.etatPlace(P[sym], Date.parse(iso));
// New York : 9 h 30 – 16 h, heure de New York (UTC−4 en été, UTC−5 en hiver).
v('New York, vendredi 15 h (heure locale, été) : ouvert, ferme dans 1 h', (x => x.ouvert && x.mins === 60)(e('^GSPC', '2026-09-25T19:00:00Z')), JSON.stringify(e('^GSPC', '2026-09-25T19:00:00Z')));
v('… même heure UTC en hiver (14 h locale) : encore ouvert, 2 h restantes (changement d\'heure suivi)', (x => x.ouvert && x.mins === 120)(e('^GSPC', '2026-12-04T19:00:00Z')), JSON.stringify(e('^GSPC', '2026-12-04T19:00:00Z')));
v('… 9 h 29 : fermé, ouvre dans 1 min', (x => !x.ouvert && x.mins === 1)(e('^GSPC', '2026-09-24T13:29:00Z')), JSON.stringify(e('^GSPC', '2026-09-24T13:29:00Z')));
// Samedi 12 h à New York → lundi 9 h 30 : 45 h 30 (2 730 min), le dimanche compris.
v('… samedi midi : fermé, ouvre lundi 9 h 30, soit dans 45 h 30', (x => !x.ouvert && x.mins === 2730)(e('^GSPC', '2026-09-26T16:00:00Z')), JSON.stringify(e('^GSPC', '2026-09-26T16:00:00Z')));
v('Tokyo, 12 h locale : pause de midi, reprise dans 30 min', (x => !x.ouvert && x.pause && x.mins === 30)(e('^N225', '2026-09-24T03:00:00Z')), JSON.stringify(e('^N225', '2026-09-24T03:00:00Z')));
v('Londres, 8 h 15 heure d\'été (7 h 15 UTC) : ouvert', e('^FTSE', '2026-09-24T07:15:00Z').ouvert === true);
v('… 7 h 15 UTC en hiver (7 h 15 à Londres) : fermé, ouvre dans 45 min', (x => !x.ouvert && x.mins === 45)(e('^FTSE', '2026-12-03T07:15:00Z')), JSON.stringify(e('^FTSE', '2026-12-03T07:15:00Z')));
v('Hong Kong, vendredi 16 h 30 locale : fermé, rouvre lundi', (x => !x.ouvert && x.mins > 2 * 1440)(e('^HSI', '2026-09-25T08:30:00Z')), JSON.stringify(e('^HSI', '2026-09-25T08:30:00Z')));

console.log('\n── Contrats : flux Multi-actifs, fiche actif, bibliothèque ──');
const multi = [...(SRV.match(/const _MULTI_CLASSES = \[[\s\S]*?\n\];/) || [''])[0].matchAll(/\['([^']+)', '/g)].map(m => m[1]);
const sansFlux = Object.keys(P).filter(s => !multi.includes(s));
v('chaque place du widget est servie par /api/v2/multi-actifs (sinon sa tuile n\'apparaît jamais)', Object.keys(P).length >= 9 && !sansFlux.length, sansFlux.join(','));
const codes = [...RA.matchAll(/\['([A-Z0-9.]+)', '[^']+', 'indices'/g)].map(m => m[1]);
const sansFiche = Object.values(P).map(p => p.code).filter(c => !codes.includes(c));
v('chaque tuile ouvre une fiche qui existe au catalogue de la recherche', !sansFiche.length, sansFiche.join(','));
v('le filtre de marché range les deux widgets sous « Indices » seulement', /'v3-indices': \['indices'\], 'v3-vix': \['indices'\]/.test(WJ));
v('le module est chargé par l\'aperçu V3 (boot.js)', /\/js\/v2\/indices\.js\?v=/.test(BOOT));
v('chaque widget a sa vignette, son aide, sa source et « à surveiller »', reg.every(w => /<svg/.test(w.apercu || '') && w.aide && w.src && w.watch));

console.log('\n── Régime de volatilité (module + vraie tranche de server.js) ──');
const R = I && I.regime;
v('quatre régimes aux seuils annoncés dans l\'aide (15, 20, 30)', R && R(14.9).mot === 'Calme' && R(15).mot === 'Normal' && R(19.99).mot === 'Normal' && R(20).mot === 'Tension' && R(30).mot === 'Stress');
v('… « calme » en vert, « stress » en rouge (charte)', R && R(12).c === '#00e676' && R(35).c === '#ff3d00');
const a = SRV.indexOf('const _VIX_TERME = ['), b = SRV.indexOf("app.get('/api/v2/vix-structure'");
v('la tranche VIX est trouvée dans server.js', a > 0 && b > a);
let C = null;
try { C = new Function(SRV.slice(a, b) + '\nreturn { _vixCalc, _VIX_TERME };')(); } catch (x) { v('la tranche s\'évalue', false, x.message); }
if (C) {
  const serie = Array.from({ length: 250 }, (_, i) => ({ d: 'j' + i, c: 12 + (i % 25) }));   // 12 → 36
  const d1 = C._vixCalc({ '^VIX9D': { prix: 14.8 }, '^VIX': { prix: 16.4, chg: -3.1 }, '^VIX3M': { prix: 18.9 }, '^VIX6M': { prix: 20.1 } }, serie);
  v('courbe qui monte : pente VIX / VIX 3 mois sous 1', d1 && d1.pente < 1 && d1.terme.map(t => t.lbl).join() === '9 jours,1 mois,3 mois,6 mois', JSON.stringify(d1 && d1.terme));
  const d2 = C._vixCalc({ '^VIX9D': { prix: 34 }, '^VIX': { prix: 31, chg: 22 }, '^VIX3M': { prix: 26 } }, serie);
  v('courbe inversée (VIX 31 > VIX 3 mois 26) : pente au-dessus de 1, point manquant à null', d2.pente > 1 && d2.terme[3].v === null, JSON.stringify(d2));
  v('rang sur l\'année : part des clôtures sous le niveau du jour', d1.rang === Math.round(100 * serie.filter(p => p.c <= 16.4).length / 250) && d1.an.haut === 36 && d1.an.bas === 12, JSON.stringify({ rang: d1.rang, an: d1.an }));
  v('sans VIX : pas de réponse inventée (la route répond 502 ou sert le dernier état)', C._vixCalc({ '^VIX3M': { prix: 20 } }, serie) === null);
  v('historique trop court : rang absent plutôt que faux', C._vixCalc({ '^VIX': { prix: 16 } }, serie.slice(0, 5)).rang === null);
}
const route = (SRV.match(/app\.get\('\/api\/v2\/vix-structure'[\s\S]*?\n\}\);/) || [''])[0];
v('la route est réservée à l\'aperçu V3, en cache 5 min, une lecture à la fois', /requireAdmin/.test(route) && /_v2Actif\(\)/.test(route) && /5 \* 60e3/.test(route) && /_vixVol/.test(route));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

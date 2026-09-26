#!/usr/bin/env node
/**
 * scripts/finition-verif.js — FINITION V3 DE LA BIBLIOTHÈQUE (lot 1).
 * ------------------------------------------------------------------------------------------------
 * 26/09, feuille de route V3 point 3. Baromètre et Radar de Biais gardent le DESSIN fixé par la
 * charte (égaliseur, matrice sémantique) et reçoivent un en-tête de chiffres clés ; le COT passe en
 * barres acheteurs / vendeurs ; la Carte de chaleur devient une matrice 8 × 8.
 * Ce qui peut mentir sans que l'écran le trahisse :
 *   · une « paire la plus nette » écrite à l'envers (USD/EUR) ou avec la mauvaise devise ;
 *   · une case de la matrice dont le signe n'est pas inversé quand la paire cote dans l'autre sens
 *     (JPY face à EUR = −(EUR/JPY)) : toute une moitié de la carte serait fausse ;
 *   · un COT qui dit « Acheteur » à une devise à l'équilibre, ou « N.D. » rangé en tête ;
 *   · un montage branché sur un widget qui n'existe plus au catalogue (il ne s'afficherait jamais).
 * Le banc rejoue le VRAI module (public/js/v2/finition.js) et lit le VRAI catalogue.
 *
 *   node scripts/finition-verif.js
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const MOD = fs.readFileSync(path.join(RACINE, 'public/js/v2/finition.js'), 'utf8');
const WJ = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
const BOOT = fs.readFileSync(path.join(RACINE, 'public/js/v2/boot.js'), 'utf8');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };

console.log('\n── Branchement ──');
const branches = {};
const win = { DTPWidgets: { v3Montage: (id, fn) => { branches[id] = fn; return true; } } };
new Function('window', 'document', 'DTPWidgets', MOD)(win, { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) }, win.DTPWidgets);
const F = win._v3Finition || {};
const ids = ['barometre', 'radar-biais', 'cot-inst', 'heatmap-seance'];
v('quatre montages branchés : Baromètre, Radar de biais, COT, Carte de chaleur', ids.every(id => typeof branches[id] === 'function') && Object.keys(branches).length === 4, Object.keys(branches).join(','));
const catalogue = new Set([...WJ.matchAll(/id: '([a-z0-9-]+)',\s*name: /g)].map(m => m[1]));
v('… chacun sur un widget qui existe au catalogue (sinon le montage ne s\'afficherait jamais)', ids.every(id => catalogue.has(id)), ids.filter(id => !catalogue.has(id)).join(','));
v('le module est chargé par l\'aperçu V3 (boot.js)', /\/js\/v2\/finition\.js\?v=/.test(BOOT));
v('Baromètre et Radar : le widget d\'ORIGINE est monté dans le corps (dessin de la charte conservé)', /function barometre[\s\S]*?W\._v3Orig\.call\(W, c\.corps, it\)/.test(MOD) && /function radar[\s\S]*?W\._v3Orig\.call\(W, c\.corps, it\)/.test(MOD));

console.log('\n── Paire la plus nette, dans son sens de cotation ──');
v('EUR et USD → EUR/USD ; USD et JPY → USD/JPY ; JPY et GBP → GBP/JPY', F.paire('USD', 'EUR') === 'EUR/USD' && F.paire('USD', 'JPY') === 'USD/JPY' && F.paire('JPY', 'GBP') === 'GBP/JPY');
v('AUD et NZD → AUD/NZD ; CHF et CAD → CAD/CHF', F.paire('NZD', 'AUD') === 'AUD/NZD' && F.paire('CHF', 'CAD') === 'CAD/CHF');

console.log('\n── Baromètre : les chiffres clés ──');
const serie = (fin) => Array.from({ length: 20 }, (_, i) => ({ t: i, v: fin * i / 19 }));
const FS = { currencies: ['USD', 'EUR', 'GBP', 'JPY'], series: { USD: serie(0.3), EUR: serie(-0.1), GBP: serie(0.8), JPY: serie(-0.7) } };
const fv = F.forces(FS);
v('la valeur lue est la DERNIÈRE de la séance (comme l\'égaliseur)', fv && Math.abs(fv.GBP.v - 0.8) < 1e-9 && Math.abs(fv.JPY.v + 0.7) < 1e-9, JSON.stringify(fv));
const tb = F.teteBarometre(fv);
v('plus forte GBP, plus faible JPY, paire la plus nette GBP/JPY', /Plus forte.*GBP.*\+0,80/.test(tb) && /Plus faible.*JPY.*−0,70/.test(tb) && /GBP\/JPY/.test(tb), tb.replace(/<[^>]+>/g, ' '));
v('source vide : pas de chiffres inventés', F.forces({}) === null && F.forces({ currencies: ['USD'], series: { USD: serie(1) } }) === null);

console.log('\n── Radar de biais : la lecture du jour ──');
const tbi = F.teteBiais({ generatedAt: Date.UTC(2026, 8, 26, 4), conclusion: { USD: 'Bullish', EUR: 'Neutral', GBP: 'Very Bullish', JPY: 'Very Bearish', CHF: 'Bearish' } }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
v('compte haussières / baissières, extrêmes en français, paire la plus nette', /2 haussières · 2 baissières/.test(tbi) && /GBP Très haussier/.test(tbi) && /JPY Très baissier/.test(tbi) && /GBP\/JPY/.test(tbi), tbi);
const tbn = F.teteBiais({ conclusion: { USD: 'Neutral', EUR: 'Bullish', GBP: 'Neutral' } });
v('sans devise baissière : pas de « paire la plus nette » inventée', !/Paire la plus nette/.test(tbn));

console.log('\n── COT : acheteurs contre vendeurs ──');
const C = [{ key: 'EUR', longPct: 62, shortPct: 38, longPos: 620, shortPos: 380 }, { key: 'NZD', longPct: 51, shortPct: 49, longPos: 510, shortPos: 490 },
  { key: 'JPY', longPct: 22, shortPct: 78, longPos: 220, shortPos: 780 }, { key: 'CHF', longPct: 0, shortPct: 0, longPos: NaN, shortPos: NaN }];
v('moins de 4 points d\'écart : « Neutre », jamais « Acheteur » (même règle que le widget d\'origine)', F.etatCot(C[1]) === 'flat' && F.etatCot(C[0]) === 'bull' && F.etatCot(C[2]) === 'bear' && F.etatCot(C[3]) === 'na');
const rc = F.rendreCot({ currencies: C }, 'lev_money');
const ordre = [...rc.corps.matchAll(/class="dev">[^<]*(?:<img[^>]*>)?([A-Z]{3})/g)].map(m => m[1]);
v('rangé de la plus achetée à la plus vendue, rapport manquant en dernier', ordre.join() === 'EUR,NZD,JPY,CHF', ordre.join());
v('position étirée (≥ 75% d\'un côté) signalée, catégorie nommée en français', /ÉTIRÉ/.test(rc.corps) && (rc.corps.match(/ÉTIRÉ<\/span>/g) || []).length === 1 && /Fonds à effet de levier/.test(rc.tete));
v('rapport manquant : « pas de rapport publié », aucun NaN', /pas de rapport publié/.test(rc.corps) && !/NaN|undefined/.test(rc.corps + rc.tete));
v('source vide : pas de rendu (la carte le dit et réessaie)', F.rendreCot({ currencies: [] }) === null);

console.log('\n── Carte de chaleur : la matrice 8 × 8 ──');
const P = [{ symbol: 'EUR/USD', base: 'EUR', quote: 'USD', changePct: 0.4 }, { symbol: 'USD/JPY', base: 'USD', quote: 'JPY', changePct: -0.6 }, { symbol: 'EUR/JPY', base: 'EUR', quote: 'JPY', changePct: -0.2 }, { symbol: 'GBP/USD', base: 'GBP', quote: 'USD', changePct: null }];
const M = F.matrice(P);
v('l\'inverse d\'une paire change de signe (USD face à EUR = −0,4)', M.m.USD.EUR === -0.4 && M.m.EUR.USD === 0.4 && M.m.JPY.USD === 0.6);
v('une variation absente reste absente (jamais lue comme zéro)', !(M.m.GBP && M.m.GBP.USD != null) && !(M.m.USD.GBP != null));
v('score d\'une devise = moyenne face aux autres (EUR : (0,4 − 0,2) / 2 = 0,1)', Math.abs(M.score.EUR - 0.1) < 1e-9 && Math.abs(M.score.JPY - (0.6 + 0.2) / 2) < 1e-9, JSON.stringify(M.score));
const rm = F.rendreMatrice({ pairs: P }, 'var');
const lignes = [...rm.corps.matchAll(/<th class="r">(?:<img[^>]*>)?([A-Z]{3})<\/th>/g)].map(m => m[1]);
v('lignes rangées de la plus forte à la plus faible', lignes.join() === 'JPY,EUR,USD', lignes.join());
v('chaque case s\'ouvre sur la paire dans son sens usuel (USD face à EUR → EUR/USD)', /data-p="EUR\/USD" data-k="USDEUR"/.test(rm.corps) && !/data-p="USD\/EUR"/.test(rm.corps));
v('diagonale neutre, aucun NaN', /class="diag">EUR</.test(rm.corps) && !/NaN|undefined/.test(rm.corps + rm.tete));
v('tri alphabétique : l\'ordre de cotation usuel', [...F.rendreMatrice({ pairs: P }, 'alpha').corps.matchAll(/<th class="r">(?:<img[^>]*>)?([A-Z]{3})<\/th>/g)].map(m => m[1]).join() === 'EUR,USD,JPY');

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

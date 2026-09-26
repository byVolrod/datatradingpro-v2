#!/usr/bin/env node
/**
 * scripts/metaux-verif.js — LE WIDGET DES MÉTAUX (V3, multi-actifs étape 5).
 * ------------------------------------------------------------------------------------------------
 * 26/09. « Ratios des métaux » : Or / Argent, Cuivre / Or, Or / Platine. Un ratio faux se lit avec
 * la même assurance qu'un vrai, et sa lecture en clair (« le marché reste prudent ») hérite de
 * l'erreur. Les pièges possibles : diviser dans le mauvais sens, comparer des séances qui ne se
 * correspondent pas (un contrat muet un jour), mal ranger le niveau dans son année, ou lire une
 * tendance sur un mois qui n'en est pas un. Ce banc rejoue le VRAI calcul de server.js sur des
 * séries dont on connaît la réponse, et la VRAIE lecture du module client.
 *
 *   node scripts/metaux-verif.js
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const MX = fs.readFileSync(path.join(RACINE, 'public/js/v2/metaux.js'), 'utf8');
const WJ = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
const BOOT = fs.readFileSync(path.join(RACINE, 'public/js/v2/boot.js'), 'utf8');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
const proche = (a, b, e) => a != null && Math.abs(a - b) <= (e == null ? 1e-6 : e);

console.log('\n── Ratios des métaux : calcul (vraie tranche de server.js) ──');
const a = SRV.indexOf('const _RATIOS_METAUX = ['), b = SRV.indexOf("app.get('/api/v2/ratios-metaux'");
v('la tranche est trouvée dans server.js', a > 0 && b > a);
let C = null;
try { C = new Function(SRV.slice(a, b) + '\nreturn { _ratioCalc, _RATIOS_METAUX };')(); } catch (e) { v('la tranche s\'évalue', false, e.message); }
const jour = i => new Date(Date.UTC(2025, 9, 1) + i * 86400e3).toISOString().slice(0, 10);
const serie = (fn, n, saut) => Array.from({ length: n || 300 }, (_, i) => ({ d: jour(i), c: fn(i) })).filter((_, i) => !saut || !saut(i));
if (C) {
  const D = k => C._RATIOS_METAUX.find(d => d.k === k);
  v('trois ratios : Or / Argent, Cuivre / Or, Or / Platine', C._RATIOS_METAUX.map(d => d.nom).join('|') === 'Or / Argent|Cuivre / Or|Or / Platine');
  v('… dans le bon sens (numérateur, dénominateur)', D('or-argent').a === 'GC=F' && D('or-argent').b === 'SI=F' && D('cuivre-or').a === 'HG=F' && D('cuivre-or').b === 'GC=F' && D('or-platine').b === 'PL=F');
  const r1 = C._ratioCalc(D('or-argent'), serie(() => 2600), serie(() => 32.5));
  v('or 2 600, argent 32,5 : 80 onces d\'argent pour une once d\'or', r1 && proche(r1.dernier, 80), JSON.stringify(r1 && { d: r1.dernier }));
  const r2 = C._ratioCalc(D('cuivre-or'), serie(() => 4.5), serie(() => 2500));
  v('cuivre / or affiché × 1 000 (4,5 / 2 500 → 1,8), note dite à l\'écran', r2 && proche(r2.dernier, 1.8) && r2.note === '× 1 000', JSON.stringify(r2 && { d: r2.dernier, n: r2.note }));
  // Alignement : l'argent muet un jour sur trois → seules les séances communes comptent.
  const rA = C._ratioCalc(D('or-argent'), serie(i => 2000 + i), serie(i => (2000 + i) / 80, 300, i => i % 3 === 0));
  v('séances communes seulement : un contrat muet un jour ne fausse pas le ratio (80 partout)', rA && rA.serie.every(p => proche(p[1], 80, 1e-6)), JSON.stringify(rA && rA.serie.slice(0, 3)));
  // Rang : ratio qui monte régulièrement → au plus haut (100%) ; qui baisse → tout en bas.
  const monte = C._ratioCalc(D('or-argent'), serie(i => 2000 + i * 5), serie(() => 30));
  const baisse = C._ratioCalc(D('or-argent'), serie(i => 3500 - i * 5), serie(() => 30));
  v('rang dans l\'année : au plus haut 100%, au plus bas 0% ou presque', monte.rang === 100 && baisse.rang <= 1, monte.rang + ' / ' + baisse.rang);
  // Un mois : référence 30 jours avant la DERNIÈRE séance.
  const m = C._ratioCalc(D('or-argent'), serie(i => (i >= 270 ? 2200 : 2000)), serie(() => 25));
  v('variation sur un mois : +10% quand le ratio passe de 80 à 88 dans le mois', proche(m.m1, 10, 1e-9), String(m.m1));
  v('moins de 30 séances communes : pas de ratio plutôt qu\'un chiffre fragile', C._ratioCalc(D('or-argent'), serie(() => 1, 20), serie(() => 1, 20)) === null);
  v('courbe allégée (≤ 71 points) et fourchette annuelle exacte', monte.serie.length <= 71 && proche(monte.haut, (2000 + 299 * 5) / 30, 0.01) && proche(monte.bas, 2000 / 30, 0.01), monte.serie.length + ' pts');
}
const route = (SRV.match(/app\.get\('\/api\/v2\/ratios-metaux'[\s\S]*?\n\}\);/) || [''])[0];
v('la route est réservée à l\'aperçu V3, en cache 10 min, une lecture à la fois', /requireAdmin/.test(route) && /_v2Actif\(\)/.test(route) && /10 \* 60e3/.test(route) && /_ratiosVol/.test(route));
v('… et lit les séries par la porte commune (_actifSerie : cache 30 min, 60 séries au plus)', /_actifSerie\(s\)/.test(SRV.slice(b - 1200, b)));

console.log('\n── Ratios des métaux : module client (vrai v2/metaux.js) ──');
const reg = [];
const win = { DTPWidgets: { enregistrer: w => reg.push(w) } };
new Function('window', 'document', 'DTPWidgets', MX)(win, { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) }, win.DTPWidgets);
const L = win._v3Metaux && win._v3Metaux.lecture;
v('le module enregistre « Ratios des métaux » avec vignette, aide, source et « à surveiller »', reg.length === 1 && reg[0].id === 'v3-ratios' && /<svg/.test(reg[0].apercu) && reg[0].aide && reg[0].src && reg[0].watch);
v('Or / Argent au plus haut de l\'année : « marché prudent »', L && /prudent/.test(L({ k: 'or-argent', rang: 92 })) && /argent mène/.test(L({ k: 'or-argent', rang: 8 })));
v('Cuivre / Or se lit en TENDANCE sur un mois (±2%), pas en niveau', L && /croissance/.test(L({ k: 'cuivre-or', m1: 3.1, rang: 5 })) && /Stable/.test(L({ k: 'cuivre-or', m1: 0.4, rang: 99 })) && /prudence/.test(L({ k: 'cuivre-or', m1: -2.6 })));
v('Or / Platine : haut de fourchette = platine bon marché', L && /platine est bon marché/.test(L({ k: 'or-platine', rang: 85 })));
v('le filtre de marché range le widget sous « Métaux » seulement', /'v3-ratios': \['metaux'\]/.test(WJ));
v('le module est chargé par l\'aperçu V3 (boot.js)', /\/js\/v2\/metaux\.js\?v=/.test(BOOT));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

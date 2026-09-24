#!/usr/bin/env node
/**
 * scripts/core-verif.js — « CORE RETAIL SALES » ET « RETAIL SALES » SONT DEUX PUBLICATIONS (24/09)
 * ------------------------------------------------------------------------------------------------
 * Capture user : ForexFactory affiche à 14 h 30 « Core Retail Sales m/m » ET « Retail Sales m/m »
 * pour le CAD ; le desk n'en montrait qu'UNE. Cause : « core » est un mot vide de l'appariement
 * (pour que « Core CPI » rejoigne son relevé TradingView), les deux noms FF ont donc les mêmes
 * mots-clés ; le premier gagnait l'égalité, les deux lignes TradingView prenaient le même nom, et le
 * garde-fou des homonymes en supprimait une.
 * On EXÉCUTE la vraie chaîne de nommage extraite de server.js (tokens → nom FF → retrait des
 * homonymes) sur le cas de la capture, avec un témoin : sans la garde, la ligne disparaît de nouveau.
 *
 *   node scripts/core-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const a = SRV.indexOf('const _CAL_STOP = new Set(');
const b = SRV.indexOf('let _tvActualsBusy = false;');
v('la chaîne de nommage est extractible de server.js', a > 0 && b > a);
if (!(a > 0 && b > a)) { console.log('\n✗ banc interrompu\n'); process.exit(1); }
const BLOC = SRV.slice(a, b);

const T = Date.UTC(2026, 8, 24, 12, 30);
const FF = [   // flux ForexFactory (getCalendarRaw) : l'ordre de la capture, « Core » d'abord
  { currency: 'CAD', title: 'Core Retail Sales m/m', timestamp: T },
  { currency: 'CAD', title: 'Retail Sales m/m', timestamp: T },
  { currency: 'USD', title: 'Core PCE Price Index m/m', timestamp: T },
];
const TV = [   // flux TradingView servi au client
  { currency: 'CAD', title: 'Retail Sales MoM', timestamp: T, impact: 'Medium', actual: '-0.7%', forecast: '-0.8%', previous: '0.6%' },
  { currency: 'CAD', title: 'Retail Sales ex Autos MoM', timestamp: T, impact: 'Medium', actual: '-0.7%', forecast: '-0.5%', previous: '0.5%' },
  { currency: 'USD', title: 'Core PCE Price Index MoM', timestamp: T, impact: 'High', forecast: '0.3%' },
];
const monter = src => new Function('getCalendarRaw', src + '\nreturn { _calFfNames, _ffDisplayTitle };')(() => FF);

console.log('\n── 1. Les deux ventes au détail canadiennes restent deux lignes ──');
{
  const api = monter(BLOC);
  const out = api._calFfNames(TV).filter(e => e.currency === 'CAD');
  const noms = out.map(e => e.title).sort();
  v('deux lignes CAD à 14 h 30, comme sur ForexFactory', out.length === 2, JSON.stringify(noms));
  v('… avec les DEUX noms ForexFactory', noms.join('|') === 'Core Retail Sales m/m|Retail Sales m/m', JSON.stringify(noms));
  const glob = out.find(e => e.title === 'Retail Sales m/m') || {}, core = out.find(e => e.title === 'Core Retail Sales m/m') || {};
  v('… et chacune ses propres chiffres (global −0,8% attendu, core −0,5% attendu)', glob.forecast === '-0.8%' && core.forecast === '-0.5%', JSON.stringify({ glob, core }));
  v('« Core PCE » garde toujours son nom FF (la garde ne sépare pas un core de son propre relevé)', api._ffDisplayTitle(TV[2]) === 'Core PCE Price Index m/m');
}

console.log('\n── 2. La garde est branchée sur les trois appariements ──');
v('nommage FF', /_calPeriodeConflit\(tok, c\.tok\) \|\| _calCoreConflit\(ev\.title, c\.title\)/.test(SRV));
v('remplissage des résultats TradingView', /if \(_calCoreConflit\(ev\.title, x\.t\.title\)\) continue;/.test(SRV));
v('fusion ForexFactory ↔ TradingView', /if \(_calCoreConflit\(f\.title, c\.e\.title\)\) continue;/.test(SRV));

console.log('\n── 3. Témoin ──');
{
  const mut = BLOC.replace('if (_calPeriodeConflit(tok, c.tok) || _calCoreConflit(ev.title, c.title)) continue;', '');
  v('(témoin) la mutation retire bien la garde du nommage', mut !== BLOC);
  const out = monter(mut)._calFfNames(TV).filter(e => e.currency === 'CAD');
  v('(témoin) sans elle, une des deux ventes au détail disparaît (le défaut de la capture)', out.length === 1, out.length + ' ligne(s)');
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

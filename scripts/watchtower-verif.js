#!/usr/bin/env node
/**
 * scripts/watchtower-verif.js — BNS ET RBNZ EN PRICING DE MARCHÉ, PAR LA COURBE PUBLIQUE WATCHTOWER (24/09)
 * ------------------------------------------------------------------------------------------------
 * Demande user : « la BNS et la RBNZ sont réservées à l'offre payante de rateprobability → utilise
 * un autre site ». La page publique watchtowerterminal.com/central-bank-rate-probability publie le
 * taux implicite après chaque réunion pour 7 banques, dont les deux manquantes.
 *
 * On EXÉCUTE les vraies fonctions extraites de server.js (pas une copie) sur un extrait RÉEL de la
 * page (relevé le 24/09), en markdown (Firecrawl) ET en HTML (lecture directe), et on vérifie :
 *   · les probabilités retombent sur celles que la page annonce elle-même (« priced for it ») ;
 *   · les trois gardes mordent : taux directeur différent, réunion passée depuis, page trop vieille ;
 *   · le résumé et le tableau des instruments, qui portent aussi les noms, ne sont jamais pris ;
 *   · /api/rates, le chat IA, les analyses d'événements et le Radar de Biais passent par elle.
 *
 *   node scripts/watchtower-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const tranche = (debut, fin) => {
  const a = SRV.indexOf(debut), b = SRV.indexOf(fin, a + 1);
  if (a < 0 || b < 0) throw new Error('tranche introuvable : ' + debut);
  return SRV.slice(a, b);
};
let F;
try {
  const code = [
    tranche('function _txtCellules(txt) {', 'function _eurexSaronParse('),
    tranche('function _rpDirMove(meetings, rate) {', '/* La Fed annonce une FOURCHETTE'),
    tranche("const _WT_NOMS = {", '// Courbe WatchTower d\'une banque'),
  ].join('\n');
  F = new Function('CB_MEETINGS', code.replace('let _wtCache = { at: 0, banks: {} };', 'let _wtCache = { at: 0, banks: {} };\nthis.pose = c => { _wtCache = c; };')
    + '\nreturn { _wtParse, _wtCarte, pose: this.pose };');
} catch (e) { console.log('\n✗ extraction impossible : ' + e.message + '\n'); process.exit(1); }

// Extrait RÉEL de la page (markdown Firecrawl, 24/09) : trois sections + le résumé + le tableau des instruments.
const MD = `ECBBOEBOJSNBRBABOCRBNZ

## Bank of England

Exchange-traded futures, WatchTower model

As of 23 September 2026

Next decision —

Priced for it 64.7% _hike 25bp_

Policy rate3.75% _GBP_

| Meeting | Implied rate | vs now | Priced outcome |
| --- | --- | --- | --- |
| 5 Nov 2026 | 3.91% | +16bp | _cut_— | _hold_— | _hike_— |
| 17 Dec 2026 | 4.11% | +36bp | _cut_— | _hold_— | _hike_— |
| 4 Feb 2027 | 4.29% | +54bp | _cut_— | _hold_— | _hike_— |

Implied rate is where the market prices the policy rate after that meeting.

## Swiss National Bank

Exchange-traded futures, WatchTower model

As of 23 September 2026

Next decision —

Priced for it 73.8% _hold_

Policy rate0.00% _CHF_

| Meeting | Implied rate | vs now | Priced outcome |
| --- | --- | --- | --- |
| 24 Sept 2026 | 0.07% | +7bp | _cut_— | _hold_— | _hike_— |
| 10 Dec 2026 | 0.26% | +26bp | _cut_— | _hold_— | _hike_— |
| 18 Mar 2027 | 0.45% | +45bp | _cut_— | _hold_— | _hike_— |

Implied rate is where the market prices the policy rate after that meeting.

## Reserve Bank of New Zealand

Exchange-traded futures, WatchTower model

As of 23 September 2026

Next decision —

Priced for it 100.0% _hike 25bp_

Policy rate2.75% _NZD_

| Meeting | Implied rate | vs now | Priced outcome |
| --- | --- | --- | --- |
| 28 Oct 2026 | 3.01% | +26bp | _cut_— | _hold_— | _hike_— |
| 9 Dec 2026 | 3.28% | +53bp | _cut_— | _hold_— | _hike_— |
| 10 Feb 2027 | 3.48% | +73bp | _cut_— | _hold_— | _hike_— |

Implied rate is where the market prices the policy rate after that meeting.

**SNB** _Swiss National Bank_ 0.00%  —  hold firmly priced Exchange-traded futures, WatchTower model

Swiss National BankSwitzerlandExchange-traded futures, WatchTower model
Reserve Bank of New ZealandNew ZealandExchange-traded futures, WatchTower model _Bank bills carry a credit spread over the policy rate_
`;
// La même section en HTML (lecture directe depuis le VPS).
const HTML = `<section><h2>Reserve Bank of New Zealand</h2><p>Exchange-traded futures, WatchTower model</p><p>As of <time>23 September 2026</time></p>
<div>Policy rate<b>2.75%</b> <i>NZD</i></div><table><tr><th>Meeting</th><th>Implied rate</th><th>vs now</th></tr>
<tr><td>28 Oct 2026</td><td>3.01%</td><td>+26bp</td></tr><tr><td>9 Dec 2026</td><td>3.28%</td><td>+53bp</td></tr></table>
<p>Implied rate is where the market prices the policy rate after that meeting.</p></section>`;

const REUNIONS = { GBP: ['2026-09-17', '2026-11-05'], CHF: ['2026-06-18', '2026-09-24', '2026-12-10'], NZD: ['2026-08-19', '2026-10-28', '2026-12-09'] };
const LE_23 = Date.UTC(2026, 8, 23, 18), LE_25 = Date.UTC(2026, 8, 25, 9);

console.log('\n── 1. Lecture de la page (markdown et HTML) ──');
const W = F(REUNIONS);
const lu = W._wtParse(MD);
v('BoE, BNS et RBNZ lues', !!(lu.GBP && lu.CHF && lu.NZD), Object.keys(lu).join(','));
v('… taux directeurs relus (3,75 / 0 / 2,75)', lu.GBP && lu.GBP.policy === 3.75 && lu.CHF.policy === 0 && lu.NZD.policy === 2.75);
v('… trajectoire BNS : trois réunions, « Sept » compris', lu.CHF && lu.CHF.rows.length === 3 && lu.CHF.rows[0].date === '2026-09-24' && lu.CHF.rows[1].impl === 0.26, JSON.stringify(lu.CHF && lu.CHF.rows));
v('… date de la page : 23 septembre', lu.CHF && lu.CHF.asOf === Date.UTC(2026, 8, 23));
v('le résumé et le tableau des instruments ne créent pas de fausse section', Object.keys(lu).length === 3);
const luH = W._wtParse(HTML);
v('la même section en HTML se lit pareil (lecture directe)', luH.NZD && luH.NZD.policy === 2.75 && luH.NZD.rows.length === 2 && luH.NZD.rows[1].date === '2026-12-09', JSON.stringify(luH));
v('une page vide ne rend rien', Object.keys(W._wtParse('<html>Access denied</html>')).length === 0);

console.log('\n── 2. Les probabilités retombent sur celles que la page annonce ──');
W.pose({ at: LE_23, banks: lu });
const boe = W._wtCarte('GBP', LE_23, 3.75);
v('BoE 5 nov : 64 % de hausse (la page : 64,7 %)', boe && boe.meetings[0].hike === 64 && boe.meetings[0].baseCase === 'HIKE', boe && JSON.stringify(boe.meetings[0]));
const snb = W._wtCarte('CHF', LE_23, 0);
v('BNS 24 sept : 72 % de maintien (la page : 73,8 %)', snb && snb.meetings[0].hold === 72 && snb.meetings[0].hike === 28, snb && JSON.stringify(snb.meetings[0]));
v('… réunion suivante mesurée depuis la précédente (Δ +19 pb, pas +26)', snb && snb.meetings[1].impliedBps === 19);
const nz = W._wtCarte('NZD', LE_23, 2.75);
v('RBNZ 28 oct : 100 % de hausse (la page : 100 %)', nz && nz.meetings[0].hike === 100 && nz.meetings[0].hold === 0, nz && JSON.stringify(nz.meetings[0]));
v('… carte de marché complète (source, fournisseur, prochaine réunion, tendance)', nz && nz.source === 'market' && nz.provider === 'WatchTower' && nz.next === '2026-10-28' && nz.move === 'HIKE');

console.log('\n── 3. Les gardes mordent ──');
v('taux tenu différent du taux de la page → rien (une décision est passée)', W._wtCarte('NZD', LE_23, 3.00) === null);
v('BNS le 25/09 : la réunion du 24 est tombée APRÈS la page → rien', W._wtCarte('CHF', LE_25, 0) === null);
v('… (témoin) RBNZ le même jour, sans réunion depuis → servie', !!W._wtCarte('NZD', LE_25, 2.75));
v('page de plus de 4 jours → rien', W._wtCarte('NZD', Date.UTC(2026, 8, 29, 1), 2.75) === null);
v('banque absente de la page → rien', W._wtCarte('USD', LE_23, 4) === null);

console.log('\n── 4. Le desk s\'en sert ──');
v('/api/rates : WatchTower quand rateprobability manque', /let rp = _rpInstantaneUtilisable\([^\n]+\n[\s\S]{0,300}if \(!rp\) \{[\s\S]{0,300}_wtCarte\(b\.code, now,/.test(SRV));
v('… la carte dit de quel fournisseur vient le pricing', /source: 'market', provider: _fournisseur/.test(SRV));
v('chat IA, analyses d\'événements et Radar de Biais passent aussi par elle', (SRV.match(/_wtPour\((?:b\.code|ccy|code)\)/g) || []).length >= 3);
v('lecture bornée à une fois toutes les 12 h, direct puis Firecrawl', /Date\.now\(\) - _wtCache\.at < RP_FC_MS/.test(SRV) && /_pageMarche\(WT_URL, t => Object\.keys\(_wtParse\(t\)\)\.length >= 2\)/.test(SRV));
v('le cache survit à un redémarrage (base) et le panneau admin le montre', /aiCacheSet\('rates:watchtower'/.test(SRV) && /watchtower: \{ at: _wtCache\.at/.test(SRV));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

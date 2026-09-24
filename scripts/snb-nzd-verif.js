#!/usr/bin/env node
/**
 * scripts/snb-nzd-verif.js — BNS (CHF) ET RBNZ (NZD) : DES LECTURES DE MARCHÉ, JAMAIS INVENTÉES (24/09)
 * ------------------------------------------------------------------------------------------------
 * Demande user : « je veux les taux fiables et réels de toutes les banques ». CHF et NZD n'avaient
 * aucune source de marché (offre payante chez le fournisseur habituel). On lit désormais :
 *   · CHF → règlements quotidiens des contrats SARON 3 mois d'Eurex ;
 *   · NZD → tableau B2 de la RBNZ (bons bancaires 30/60/90 jours).
 * On EXÉCUTE les vraies fonctions extraites de server.js, sur des extraits RÉELS des deux pages
 * (relevés le 24/09 via Firecrawl), avec des témoins qui mordent.
 *
 *   node scripts/snb-nzd-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const fn = (nom) => {
  const d = SRV.indexOf('function ' + nom + '(');
  if (d < 0) return null;
  let prof = 0;
  for (let k = SRV.indexOf('{', SRV.indexOf(')', d)); k < SRV.length; k++) {
    if (SRV[k] === '{') prof++;
    else if (SRV[k] === '}') { prof--; if (prof === 0) return SRV.slice(d, k + 1); }
  }
  return null;
};
const NOMS = ['_txtCellules', '_eurexSaronParse', '_saronProchaine', '_rbnzB2Parse', '_nzdCourbe'];
const monter = (src) => new Function(src + '\nreturn {' + NOMS.join(',') + '};')();
const SRCS = NOMS.map(fn);
console.log('\n── 1. Le code est extractible et branché ──');
v('les cinq fonctions sont extractibles de server.js', SRCS.every(Boolean), NOMS.filter((n, i) => !SRCS[i]).join(', '));
if (!SRCS.every(Boolean)) { console.log('\n✗ banc interrompu\n'); process.exit(1); }
const SRC = SRCS.join('\n');
const F = monter(SRC);
v('la BNS en repli prend la prochaine réunion des contrats SARON (même garde que la RBA)',
  /b\.code === 'CHF' && meetings\[0\] && _snbWatch && _snbWatch\.meeting === meetings\[0\]\.date/.test(SRV));
v('la NZD alimente la lecture de marché déjà appliquée au repli (_sovCurve)', /_sovCurve\.NZD = out;/.test(SRV));
v('les deux lectures sont rafraîchies en tâche de fond, sans attendre un client', /setInterval\(\(\) => \{ _computeSnbWatch\(\)\.catch\(\(\) => \{\}\); _computeNzdCourbe\(\)\.catch\(\(\) => \{\}\); \}, 4 \* 3600e3\)/.test(SRV));
v('le panneau admin montre les deux sources', /snbWatch: _snbWatch \?/.test(SRV) && /nzdCourbe: _sovCurve\.NZD \?/.test(SRV));

// Extrait RÉEL du tableau des règlements Eurex (markdown Firecrawl, 24/09), tel quel.
const EUREX = `| Contract Type | Contract Date | Open | High | Low | Last | D. Settle | Volume | OI adj |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| _M_ | _16/09/2026_ | _0.00_ | _0.00_ | _0.00_ | _0.00_ | _100.03_ | _0_ | _0_ |
| _M_ | _16/12/2026_ | _0.00_ | _0.00_ | _0.00_ | _0.00_ | _99.905_ | _0_ | _0_ |
| _M_ | _17/03/2027_ | _0.00_ | _0.00_ | _0.00_ | _0.00_ | _99.68_ | _0_ | _0_ |
| _M_ | _16/06/2027_ | _0.00_ | _0.00_ | _0.00_ | _0.00_ | _99.46_ | _0_ | _0_ |`;
const REU_CHF = ['2026-03-19', '2026-06-18', '2026-09-24', '2026-12-10', '2027-03-18', '2027-06-24'];
const J = (y, m, d, h) => Date.UTC(y, m - 1, d, h || 12);

console.log('\n── 2. CHF : les règlements Eurex sont lus tels quels ──');
{
  const cs = F._eurexSaronParse(EUREX);
  v('quatre échéances lues, dans l\'ordre', cs.length === 4 && cs[1].date === Date.UTC(2026, 11, 16), JSON.stringify(cs));
  v('taux implicite = 100 − règlement (déc. 2026 : 0,095 %)', Math.abs(cs[1].r - 0.095) < 1e-9 && Math.abs(cs[2].r - 0.32) < 1e-9, JSON.stringify(cs.map(c => c.r)));
  v('la même ligne en HTML se lit pareil', F._eurexSaronParse('<tr><td>M</td><td>16/12/2026</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td>99.905</td><td>0</td></tr>').length === 1);
  v('un prix absurde n\'est jamais retenu', F._eurexSaronParse('| M | 16/12/2026 | 0 | 0 | 0 | 0 | 0.00 | 0 |').length === 0);
}

console.log('\n── 3. CHF : probabilité de la prochaine réunion, sans constante supposée ──');
{
  // Le 24/09 au matin, les règlements datent de la VEILLE : la réunion du jour y est encore pricée.
  const cs = F._eurexSaronParse(EUREX);
  const perime = F._saronProchaine(cs, 0, REU_CHF, J(2026, 9, 24, 14));
  v('règlements arrêtés AVANT la décision du jour → rien n\'est publié (écart SARON incohérent)', perime === null, JSON.stringify(perime));
  // Lendemain, marché repricé : SARON à −3 pb du taux, +12,5 pb attendus en décembre.
  const s = -0.03, d = 0.125, w = 5 / 91;
  const frais = [{ date: Date.UTC(2026, 11, 16), r: s + 0 + w * d }, { date: Date.UTC(2027, 2, 17), r: s + d }, { date: Date.UTC(2027, 5, 16), r: s + d + 0.1 }];
  const o = F._saronProchaine(frais, 0, REU_CHF, J(2026, 9, 25));
  v('lecture cohérente → prochaine réunion = 10 décembre', o && o.meeting === '2026-12-10', JSON.stringify(o));
  v('… +12,5 pb attendus → 50 % de hausse, 50 % de maintien', o && o.hike === 50 && o.hold === 50 && o.cut === 0 && Math.abs(o.changeBps - 12.5) < 0.2, JSON.stringify(o));
  v('… et l\'écart SARON est MESURÉ, pas supposé (−3 pb)', o && Math.abs(o.spreadBps + 3) < 0.2, o && String(o.spreadBps));
  const baisse = F._saronProchaine([{ date: Date.UTC(2026, 11, 16), r: s + 0.5 - w * 0.25 }, { date: Date.UTC(2027, 2, 17), r: s + 0.5 - 0.25 }], 0.5, REU_CHF, J(2026, 9, 25));
  v('une baisse pleinement pricée → 100 % de baisse', baisse && baisse.cut === 100 && baisse.hold === 0, JSON.stringify(baisse));
  // TÉMOIN : sans la garde de l'écart SARON, la lecture périmée du matin serait publiée.
  const mut = SRC.replace('if (!(s >= -0.25 && s <= 0.05)) return null;', '');
  v('(témoin) la mutation retire bien la garde', mut !== SRC);
  const M = monter(mut)._saronProchaine(cs, 0, REU_CHF, J(2026, 9, 24, 14));
  v('(témoin) sans elle, un règlement de la veille publierait une hausse fantôme', M && M.hike > 50, JSON.stringify(M));
}

// Extrait RÉEL du tableau B2 de la RBNZ (markdown Firecrawl, 24/09).
const B2 = `| Date | Official Cash Rate (OCR) | Overnight Deposit Rate | Overnight Reverse Repurchase Facility Rate | Overnight interbank cash rate | 30 days | 60 days | 90 days | 1 year | 2 year | 5 year | 10 year | 2-10s |
| 22 Sept 2026 | 2.75 | 2.75 | 3.25 | - | 2.97 | 3.07 | 3.17 | 3.20 | 3.87 | 4.47 | 4.95 | 61 |
| 23 Sept 2026 | 2.75 | 2.75 | 3.25 | 2.78 | 2.98 | 3.09 | 3.19 | 3.19 | 3.83 | 4.42 | 4.92 | 62 |`;

console.log('\n── 4. NZD : la courbe officielle des bons bancaires ──');
{
  const b = F._rbnzB2Parse(B2);
  v('dernière ligne datée lue (23 Sept 2026)', b && b.date === '23 Sept 2026' && b.ocr === 2.75 && b.b30 === 2.98 && b.b60 === 3.09 && b.b90 === 3.19, JSON.stringify(b));
  v('une colonne « - » (interbancaire absent) ne décale pas les suivantes', F._rbnzB2Parse(B2.split('\n').slice(0, 2).join('\n')).b30 === 2.97);
  const c = F._nzdCourbe(b);
  v('le taux à terme 30→60 j au-dessus du 30 j → biais HAUSSE', c && c.bias === 'hike', JSON.stringify(c));
  v('… conviction bornée (jamais au-delà de 0,80)', c && c.conv > 0.55 && c.conv <= 0.80, c && String(c.conv));
  v('… source nommée et datée', c && /RBNZ, tableau B2, 23 Sept 2026/.test(c.src));
  const plat = F._nzdCourbe({ date: 'x', ocr: 2.75, b30: 2.98, b60: 2.99, b90: 3.00 });
  v('courbe plate → maintien', plat && plat.bias === 'hold', JSON.stringify(plat));
  v('donnée aberrante → rien (jamais inventé)', F._nzdCourbe({ date: 'x', ocr: 2.75, b30: 9, b60: 9, b90: 9 }) === null);
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

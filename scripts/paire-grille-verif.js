#!/usr/bin/env node
/**
 * scripts/paire-grille-verif.js — VUE PAIRE EN GRILLE : DES CHIFFRES VRAIS, CALCULÉS JUSTE (V3, 24/09)
 * ------------------------------------------------------------------------------------------------
 * On EXÉCUTE les vrais calculs (saison.js, historique COT de scrapers/cot.js) sur des séries dont
 * on connaît la réponse : un mois sans clôture précédente reste vide (jamais extrapolé), une courbe
 * n'existe que si l'historique couvre son horizon, l'USD dérivé n'apparaît qu'aux dates où les six
 * autres devises sont publiées. Plus le branchement serveur (admin + V2) et client.
 *
 *   node scripts/paire-grille-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const S = require(path.join(R, 'saison.js'));
const COT = require(path.join(R, 'scrapers', 'cot.js'));
const SRV = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
const BOOT = fs.readFileSync(path.join(R, 'public/js/v2/boot.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

console.log('\n── 1. Saisonnalité : rendements mensuels, carte de chaleur, année type ──');
{
  // 16 ans de clôtures mensuelles : chaque mars monte de 2%, chaque septembre baisse de 1%, le reste est plat.
  const ts = [], cl = []; let c = 1.1;
  for (let a = 2010; a <= 2026; a++) for (let m = 0; m < 12; m++) {
    if (a === 2026 && m > 8) break;
    if (m === 2) c *= 1.02; else if (m === 8) c *= 0.99;
    ts.push(Date.UTC(a, m, 28) / 1000); cl.push(c);
  }
  const d = S.saisonnalite(ts, cl, Date.UTC(2026, 8, 24));
  v('chaque mars à +2%, chaque septembre à −1% (clôture à clôture)', d.table[2015][2] === 2 && d.table[2015][8] === -1 && d.table[2015][5] === 0, JSON.stringify(d.table[2015]));
  v('le premier mois de la série reste VIDE (pas de clôture précédente : rien d\'extrapolé)', d.table[2010][0] === null);
  v('année type 5 / 10 / 15 ans calculées (historique suffisant)', d.courbes.a5 && d.courbes.a10 && d.courbes.a15);
  v('… et justes : +2% en mars, +1% cumulé en fin d\'année', d.courbes.a10[2] === 2 && d.courbes.a10[11] === 1, JSON.stringify(d.courbes.a10));
  v('statistiques du mois courant (septembre) : 16 années complètes (2010 → 2025), 0 en hausse, moyenne −1%', d.moisCourant === 8 && d.stat.annees === 16 && d.stat.hausse === 0 && d.stat.moyenne === -1, JSON.stringify(d.stat));
  const court = S.saisonnalite(ts.slice(-40), cl.slice(-40), Date.UTC(2026, 8, 24));
  v('historique de 3 ans : pas de courbe 5/10/15 ans inventée', court.courbes.a5 === null && court.courbes.a15 === null);
  const trou = S.rendementsMensuels([Date.UTC(2020, 0, 28) / 1000, Date.UTC(2020, 2, 28) / 1000], [1, 1.1]);
  v('deux clôtures NON consécutives (février manquant) → aucun rendement fabriqué', trou.length === 0);
}

console.log('\n── 2. Historique COT : par devise, USD dérivé seulement quand il est calculable ──');
{
  const cfg = { longCol: 'l', shortCol: 's' };
  const codes = ['099741', '096742', '097741', '092741', '090741', '232741', '112741'];
  const rows = [];
  codes.forEach((code, i) => rows.push({ cftc_contract_market_code: code, report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000', l: String(100 + i), s: '50' }));
  rows.push({ cftc_contract_market_code: '099741', report_date_as_yyyy_mm_dd: '2026-09-08T00:00:00.000', l: '80', s: '60' });   // une seule devise ce jour-là
  const h = COT._histoDepuisLignes(rows, cfg);
  v('EUR : deux rapports, dans l\'ordre, avec la position nette', h.EUR.length === 2 && h.EUR[0].date === '2026-09-08' && h.EUR[0].net === 20 && h.EUR[1].net === 50, JSON.stringify(h.EUR));
  v('USD dérivé = agrégat inverse des six autres, le 15/09 seulement', h.USD && h.USD.length === 1 && h.USD[0].date === '2026-09-15' && h.USD[0].long === 350 && h.USD[0].short === 721, JSON.stringify(h.USD));
  v('la lecture CFTC est plafonnée à 15 ans et gardée 12 h', /Math\.min\(780,/.test(fs.readFileSync(path.join(R, 'scrapers/cot.js'), 'utf8')) && /Date\.now\(\) - _histo\[k\]\.ts < 12 \* 3600e3/.test(fs.readFileSync(path.join(R, 'scrapers/cot.js'), 'utf8')));
}

console.log('\n── 3. Branchement ──');
v('les deux routes sont réservées à l\'admin ET à la V2 active', /app\.get\('\/api\/v2\/cot-historique', requireAdmin,/.test(SRV) && /app\.get\('\/api\/v2\/saisonnalite', requireAdmin,/.test(SRV)
  && (SRV.match(/app\.get\('\/api\/v2\/(?:cot-historique|saisonnalite)', requireAdmin, async \(req, res\) => \{\s*\n\s*if \(!_v2Actif\(\)\) return res\.status\(404\)\.end\(\);/g) || []).length === 2);
v('la saisonnalité est gardée 12 h par paire (une clôture mensuelle bouge une fois par mois)', /c && Date\.now\(\) - c\.at < 12 \* 3600e3\) return res\.json\(c\.data\)/.test(SRV));
v('le chargeur V2 charge la vue paire en grille', /\/js\/v2\/paire\.js\?v=/.test(BOOT));
console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

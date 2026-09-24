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
const PAIRE = fs.readFileSync(path.join(R, 'public/js/v2/paire.js'), 'utf8');
const COTSRC = fs.readFileSync(path.join(R, 'scrapers/cot.js'), 'utf8');
let ok = 0, ko = 0;
(async () => {
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

console.log('\n── 2 bis. Tableau COT complet : colonnes en plus, jamais au prix de l\'historique ──');
{
  const rows = [{ cftc_contract_market_code: '099741', report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000', l: '100', s: '40', oi: '500', sp: '7', tl: 'x' }];
  const h = COT._histoDepuisLignes(rows, { longCol: 'l', shortCol: 's' }, { oi: 'oi', spread: 'sp', tl: 'tl' });
  v('intérêt ouvert et spreads lus, une valeur illisible OMISE (pas de 0 inventé)', h.EUR[0].oi === 500 && h.EUR[0].spread === 7 && !('tl' in h.EUR[0]), JSON.stringify(h.EUR[0]));
  v('chaque catégorie CFTC a ses colonnes complémentaires', COT.VALID_TYPES.every(t => COT.HISTO_EXTRA[t] && COT.HISTO_EXTRA[t].oi));
  // La vraie fonction, avec un faux axios : la CFTC refuse une colonne complémentaire (400).
  const appels = [];
  const faux = { get: async url => { appels.push(url); if (/open_interest_all/.test(url)) { const e = new Error('400'); e.response = { status: 400 }; throw e; }
    return { data: [{ cftc_contract_market_code: '099741', report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000', noncomm_positions_long_all: '120', noncomm_positions_short_all: '20' }] }; } };
  const charger = src => { const m = { exports: {} }; new Function('module', 'exports', 'require', '__dirname', src)(m, m.exports, x => x === 'axios' ? faux : require(x), path.join(R, 'scrapers')); return m.exports; };
  const mod = charger(COTSRC);
  const r = await mod.fetchCOTHistory('noncomm', 52).catch(e => ({ err: e.message }));
  v('colonne refusée → nouvelle lecture avec longs / shorts seuls, l\'historique est servi', appels.length === 2 && r.EUR && r.EUR[0].net === 100 && !('oi' in r.EUR[0]), JSON.stringify({ appels: appels.length, r }));
  const temoin = COTSRC.replace("if (!(extra && e.response && e.response.status === 400)) throw e;", 'throw e;');
  v('(témoin) la mutation retire bien le repli', temoin !== COTSRC);
  appels.length = 0;
  const r2 = await charger(temoin).fetchCOTHistory('noncomm', 52).catch(e => ({ err: e.message }));
  v('(témoin) sans le repli, une seule colonne refusée faisait perdre tout l\'historique', !!r2.err, JSON.stringify(r2));
}

console.log('\n── 2 ter. Saisonnalité au jour près, projection statistique ──');
{
  // 16 ans de jours ouvrés, prix plat sauf un saut de +2% chaque 1er mars et de +1% chaque 26 septembre.
  const ts = [], cl = []; let c = 1;
  for (let t = Date.UTC(2010, 0, 4); t <= Date.UTC(2026, 8, 24); t += 864e5) {
    const d = new Date(t); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    if (d.getUTCMonth() === 2 && d.getUTCDate() === 1) c *= 1.02;
    if (d.getUTCMonth() === 8 && d.getUTCDate() === 26) c *= 1.01;
    ts.push(t / 1000); cl.push(c);
  }
  // Les 1er mars et 26 septembre tombant parfois un week-end, on pose le saut au jour ouvré suivant.
  const ts2 = [], cl2 = []; c = 1; let dueM = false, dueS = false;
  for (let t = Date.UTC(2010, 0, 4); t <= Date.UTC(2026, 8, 24); t += 864e5) {
    const d = new Date(t);
    if (d.getUTCMonth() === 2 && d.getUTCDate() === 1) dueM = true;
    if (d.getUTCMonth() === 8 && d.getUTCDate() === 26) dueS = true;
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    if (dueM) { c *= 1.02; dueM = false; } if (dueS) { c *= 1.01; dueS = false; }
    ts2.push(t / 1000); cl2.push(c);
  }
  const D = S.saisonnaliteComplete(ts2, cl2, Date.UTC(2026, 8, 24, 12));
  const j = D.journalier;
  v('année type : 0% en janvier, +2% après le 1er mars, +3,02% en fin d\'année (5 et 15 ans)', j.a5[10] === 0 && Math.abs(j.a5[100] - 2) < 1e-6 && Math.abs(j.a5[364] - 3.02) < 1e-6 && Math.abs(j.a15[364] - 3.02) < 1e-6, JSON.stringify([j.a5[10], j.a5[100], j.a5[364]]));
  v('l\'année en cours s\'arrête à aujourd\'hui (jour 266), pas de trajectoire future', j.cetteAnnee.length === 267 && j.jourCourant === 266, j.cetteAnnee.length + ' / ' + j.jourCourant);
  const P = D.projection;
  v('projection : les 15 années passées ont monté de 1% entre le 24/09 et le 29/09 → 100% de hausse, médiane = dernier cours +1%',
    P && P.tableau[0].h === 5 && P.tableau[0].proba === 100 && P.tableau[0].annees === 15 && Math.abs(P.tableau[0].base / P.depuis.c - 1.01) < 1e-4, JSON.stringify(P && P.tableau[0]));
  v('huit horizons au tableau (5 à 54 jours) et 54 jours de bandes, 16e ≤ médiane ≤ 84e centile', P.tableau.length === 8 && P.bandes.length === 54 && P.bandes.every(b => b.p025 <= b.p16 && b.p16 <= b.p50 && b.p50 <= b.p84 && b.p84 <= b.p975));
  const court = S.saisonnaliteComplete(ts2.slice(-900), cl2.slice(-900), Date.UTC(2026, 8, 24, 12));
  v('3 ans et demi d\'historique : ni courbe 5 ans, ni projection (moins de 5 années observées)', court.journalier.a5 === null && court.projection === null);
}

console.log('\n── 3. Branchement ──');
v('les trois routes sont réservées à l\'admin ET à la V2 active',
  (SRV.match(/app\.get\('\/api\/v2\/(?:cot-historique|saisonnalite|particuliers-historique)', requireAdmin, async \(req, res\) => \{\s*\n\s*if \(!_v2Actif\(\)\) return res\.status\(404\)\.end\(\);/g) || []).length === 3);
v('la catégorie COT demandée est filtrée par une liste blanche', /const type = _COT_CATEGORIES\[req\.query\.type\] \? req\.query\.type : 'noncomm';/.test(SRV));
v('l\'historique des particuliers n\'écrit RIEN sans lecture Myfxbook fraîche, et ne lance jamais de navigateur', /if \(!lu \|\| Date\.now\(\) - lu > 2 \* 3600e3\) return;/.test(SRV) && !/_dmxHistRelever[\s\S]{0,1500}forceFetchOutlook/.test(SRV));
v('la saisonnalité est gardée 12 h par paire (une clôture mensuelle bouge une fois par mois)', /c && Date\.now\(\) - c\.at < 12 \* 3600e3\) return res\.json\(c\.data\)/.test(SRV));
v('le chargeur V2 charge la vue paire en grille', /\/js\/v2\/paire\.js\?v=/.test(BOOT));
v('la grille couvre COT base, COT cotée, Saisonnalité et Particuliers', ['sym-sub-cotbase', 'sym-sub-cotquote', 'sym-sub-seasonality', 'sym-sub-retail'].every(id => PAIRE.includes("libre('" + id + "'")));
v('les graphiques sont tracés AU PIXEL (aucun SVG étiré, qui déforme textes et traits)', !/preserveAspectRatio="none"/.test(PAIRE) && /ResizeObserver/.test(PAIRE));
console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);
})();

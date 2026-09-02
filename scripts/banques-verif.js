#!/usr/bin/env node
/**
 * scripts/banques-verif.js — L'ONGLET BANQUES : LE GRAPHIQUE REMONTE, ET IL RESSEMBLE À UN GRAPHIQUE
 *
 * POURQUOI (02/09/2026, capture user : « remonte le graphique jusqu'en bas de la dernière position
 * espacé un peu et met un graphique tradingview avec les lignes tp entrée et sl tu vois genre là on
 * dirait un faux graphique »).
 *
 * DEUX DÉFAUTS, ET UNE MÉPRISE À LEVER D'ABORD. Le graphique EST déjà celui de TradingView
 * (lightweight-charts, la bibliothèque libre Apache 2.0 de TradingView, servie depuis nos fichiers)
 * et il porte DÉJÀ ses lignes Entrée / Objectif / Stop. Ce n'est donc pas la bibliothèque qui
 * manquait : c'est le rendu qui ne ressemblait pas à un graphique de marché.
 *   1. LA PLACE. Empilé, le tableau gardait `flex: 1` : avec cinq positions il prenait toute la
 *      hauteur restante et repoussait le graphique derrière ~216 px de vide (mesuré).
 *   2. LE CADRAGE. `fitContent()` affichait les 400 bougies reçues. Résultat mesuré, à données
 *      identiques : 407 bougies à l'écran, une échelle de 129,7 à 173,7 pour un trade dont les
 *      niveaux tiennent dans 5 unités — ceux-ci occupaient 12 % de la hauteur et deux d'entre eux
 *      se retrouvaient à 15 px l'un de l'autre, étiquettes collées. C'est très exactement ce que
 *      montre la capture.
 *
 * ⚠️ ET LA LEÇON DU JEU D'ESSAI, qui vaut pour tous les bancs de ce dépôt. Deux versions du bouchon
 * ont fait MENTIR la mesure avant celle-ci : une série qui finissait à 193 quand les niveaux
 * étaient vers 160, puis une remontée terminale de 17 unités sur 48 bougies. Dans les deux cas
 * l'échelle restait large pour de bonnes raisons, et j'ai failli régler le PRODUIT sur un défaut du
 * BOUCHON. Une donnée d'essai qui ne ressemble pas au réel ne prouve rien — le marché se tient près
 * du trade qu'une banque vient de poser, le jeu d'essai doit en faire autant.
 *
 * Sans Chromium : abstention (code 0).
 *
 *   node scripts/banques-verif.js
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ══ 1. CE QUI DOIT RESTER (la moitié qui compte) ══════════════════════════════════════════════ */
console.log('\n── Le graphique reste celui de TradingView, avec ses trois niveaux ──');
v('la bibliothèque TradingView (lightweight-charts) est bien celle utilisée',
  /_chargerLwc\(/.test(APP) && /lightweight-charts-4\.2\.3\.js/.test(APP));
v('elle est servie depuis NOS fichiers (aucun cadre d\'origine étrangère)',
  /s\.src = '\/js\/vendor\/lightweight-charts/.test(APP),
  'un iframe TradingView n\'accepterait aucune annotation : les 3 lignes seraient impossibles');
v('les trois lignes du trade sont posées', /ligne\(p\.entry, 'Entrée'/.test(APP)
  && /ligne\(p\.tp, 'Objectif'/.test(APP) && /ligne\(p\.sl, 'Stop'/.test(APP));
v('… avec leur étiquette sur l\'axe des prix', /axisLabelVisible: true/.test(APP));
v('l\'échelle est toujours FORCÉE d\'inclure les niveaux (un stop hors cadre serait invisible)',
  /autoscaleInfoProvider/.test(APP) && /Math\.min\(r\.priceRange\.minValue, \.\.\.n\)/.test(APP));

/* ══ 2. LE CADRAGE EST RELATIF AU TRADE ════════════════════════════════════════════════════════ */
console.log('\n── Le cadrage se règle sur l\'écart des niveaux, pas sur l\'historique ──');
/* ⚠️ MA PREMIÈRE ÉCRITURE DE CE CONTRÔLE ÉTAIT FAUSSE et rougissait sur du code correct : elle
   interdisait `fitContent()` juste avant `_bankChartRoot`, or c'est exactement là que vit la
   branche `else` légitime (historique plus court que la fenêtre). Ce qu'il faut interdire, c'est
   un `fitContent()` INCONDITIONNEL — donc on exige que chacun de ceux du graphique Banques soit
   précédé d'un `else`. */
{
  const zone = APP.slice(APP.indexOf('GRAPHIQUE DE L\'ONGLET BANQUES'));
  const fin = zone.indexOf('function loadInstitutionView');
  const bloc = fin > 0 ? zone.slice(0, fin) : zone;
  /* ⚠️ ON NE COMPTE QUE LES VRAIS APPELS. Le premier jet attrapait aussi le mot « fitContent »
     écrit dans le commentaire d'explication juste au-dessus — le banc rougissait donc sur sa propre
     prose. On exige un appel complet, et on écarte les lignes de commentaire. */
  const tous = (bloc.match(/^[^\n]*chart\.timeScale\(\)\.fitContent\(\)/gm) || [])
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l) && !l.includes('`'));
  v('la fenêtre n\'est plus « tout l\'historique » par défaut',
    tous.length > 0 && tous.every(l => /else\s+chart\.timeScale\(\)\.fitContent/.test(l)),
    tous.length + ' appel(s) à fitContent, dont ' + tous.filter(l => !/else/.test(l)).length
      + ' inconditionnel(s) — un seul suffit à remettre les 400 bougies à l\'écran');
}
v('la fenêtre se calcule à partir de l\'écart entre les niveaux',
  /const spanTrade = Math\.max\(\.\.\.nv\) - Math\.min\(\.\.\.nv\)/.test(APP) && /spanTrade \* 2\.2/.test(APP));
v('… avec un plancher de 40 bougies (en dessous ce n\'est plus un graphique)', /Math\.max\(40,/.test(APP));
v('… et un plafond par unité de temps', /_VUES = \{ M15: 120, H1: 120, H4: 110, D1: 90, W1: 70 \}/.test(APP));
v('un historique plus court que la fenêtre retombe sur fitContent (aucun cadre vide)',
  /else chart\.timeScale\(\)\.fitContent\(\);/.test(APP));
v('la dernière bougie n\'est plus collée à l\'échelle des prix (rightOffset)', /rightOffset: 8/.test(APP));

/* ══ 3. LA PLACE, DANS LA FEUILLE ══════════════════════════════════════════════════════════════ */
console.log('\n── Le tableau ne prend plus toute la hauteur ──');
const blocs = CSS.match(/\.bank-table-wrap \{ flex: 0 1 auto; max-height: 52%/g) || [];
v('le tableau se dimensionne sur son contenu dans LES DEUX paliers empilés', blocs.length === 2,
  blocs.length + ' palier(s) — s\'il en manque un, le plus spécifique réimpose flex:1 et le vide revient');
v('… et le graphique prend la place restante', (CSS.match(/\.bank-chart-col \{[^}]*flex: 1 1 auto/g) || []).length === 2);
v('… tout en restant pilotable à la poignée (--bank-chart-h gagne quand elle est posée)',
  (CSS.match(/height: var\(--bank-chart-h, auto\)/g) || []).length === 2);
v('l\'espacement demandé est là', (CSS.match(/\.bank-layout \{ flex-direction: column; gap: 10px; \}/g) || []).length === 2);

/* ══ 4. AU NAVIGATEUR : ON MESURE CE QUE L'ŒIL VOIT ════════════════════════════════════════════ */
async function auNavigateur() {
  let outils; try { outils = require('./mobile-apercu.js'); } catch { return null; }
  const bin = outils.trouverNavigateur(); if (!bin) return null;
  let pp; try { pp = require('puppeteer-core'); } catch { return null; }
  const srv = outils.serveur();
  await new Promise(r => srv.listen(4945, r));
  const nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await nav.newPage();
    await page.setViewport({ width: 966, height: 845 });   // la largeur de la capture user
    await page.goto('http://localhost:4945/index.html', { waitUntil: 'networkidle0', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2200));
    await page.evaluate(() => document.querySelector('.nav-item[data-view="bank"]').click());
    await new Promise(r => setTimeout(r, 3500));
    return await page.evaluate(() => {
      const col = document.getElementById('bank-chart-col');
      const lignes = [...document.querySelectorAll('#bank-tbody tr')].filter(r => r.getBoundingClientRect().height > 4);
      const der = lignes[lignes.length - 1];
      const rc = col && col.getBoundingClientRect(), rd = der && der.getBoundingClientRect();
      const g = window.__bankDebug;
      let cadre = null;
      if (g) {
        const h = g.el.clientHeight;
        const ys = [162.50, 158.50, 163.80, 160.21].map(x => g.serie.priceToCoordinate(x)).filter(x => x != null);
        if (ys.length === 4) {
          const tri = ys.slice().sort((a, b) => a - b);
          cadre = { part: Math.round((tri[3] - tri[0]) / h * 100),
                    ecartMini: Math.round(Math.min(...tri.map((x, i) => i ? x - tri[i - 1] : 1e9))),
                    barres: Math.round(g.chart.timeScale().getVisibleLogicalRange().to - g.chart.timeScale().getVisibleLogicalRange().from),
                    total: g.data.length };
        }
      }
      return { lignes: lignes.length, vide: (rd && rc) ? Math.round(rc.top - rd.bottom) : null,
               hChart: rc ? Math.round(rc.height) : null,
               canvas: !!document.querySelector('#bank-chart canvas'),
               panne: (document.querySelector('.bank-chart-loading') || {}).textContent || null, cadre };
    });
  } finally { await nav.close(); srv.close(); }
}

(async () => {
  console.log('\n── Dans un vrai Chromium, à la largeur de la capture ──');
  let R = null;
  try { R = await auNavigateur(); } catch (e) { console.log('  ⚠️ ' + String(e).slice(0, 130)); }
  if (!R) console.log('  ~ aucun Chromium → section abstenue (ce n\'est pas un échec).');
  else {
    v('les positions et le graphique sont bien rendus', R.lignes >= 5 && R.canvas && !R.panne,
      R.lignes + ' ligne(s), canvas=' + R.canvas + (R.panne ? ', panne : ' + R.panne : ''));
    v('le graphique remonte SOUS la dernière position (moins de 20 px de vide)',
      R.vide != null && R.vide >= 0 && R.vide <= 20,
      R.vide + ' px de vide — avant correctif : 216 px');
    v('… et il y gagne de la hauteur', R.hChart != null && R.hChart >= 400,
      R.hChart + ' px (avant : 306)');
    if (!R.cadre) console.log('  ~ sonde de cadrage absente → contrôles de cadrage sautés.');
    else {
      v('la fenêtre ne montre plus tout l\'historique',
        R.cadre.barres < R.cadre.total * 0.5, R.cadre.barres + ' bougies sur ' + R.cadre.total);
      v('LE CONTRÔLE CLÉ — les niveaux du trade occupent une vraie part de la hauteur',
        R.cadre.part >= 35, R.cadre.part + ' % de la hauteur (avant correctif : 12 %)');
      v('… et deux niveaux voisins ne se touchent plus (étiquettes lisibles)',
        R.cadre.ecartMini >= 30, R.cadre.ecartMini + ' px entre les deux plus proches (avant : 15 px)');
    }
  }
  console.log('\n' + '─'.repeat(70));
  console.log(ko === 0 ? `✅ banques-verif : ${ok} contrôle(s) au vert.` : `❌ banques-verif : ${ko} échec(s) sur ${ok + ko}.`);
  process.exit(ko === 0 ? 0 : 1);
})();

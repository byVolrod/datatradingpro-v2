#!/usr/bin/env node
/**
 * scripts/journal-barre-verif.js — LA BARRE DU JOURNAL : UNE SEULE LIGNE, DES CHIFFRES QUI SE LISENT
 *
 * POURQUOI CE BANC (09/09, capture user : « réorganise, améliore ceci »).
 * Deux défauts sur la même bande, et le second ne se voit qu'en MESURANT :
 *
 *   1. TROIS RANGÉES POUR QUATRE NOMBRES ET QUATRE BOUTONS. Statistiques, actions et filtres
 *      occupaient trois bandes pleine largeur avant le premier trade. Sur un desk dense, c'est
 *      une carte de moins à l'écran. Les statistiques et les actions tiennent sur UNE ligne.
 *   2. LE VERT ET LE ROUGE NE SORTAIENT PAS. `_jrRenderStats` pose bien `jr-pos` / `jr-neg` sur
 *      la valeur — la charte du desk dit vert `#00e676` au gain, rouge à la perte — mais la
 *      feuille écrivait `.jr-stat b { color: var(--text) }`, sélecteur PLUS FORT (0,1,1) que la
 *      classe sémantique (0,1,0). Résultat mesuré sur la capture : « +27,58 » et « +13 316 $ »
 *      en BLANC, comme un nombre neutre. Le code posait la couleur, la feuille la retirait —
 *      relire le JS ne pouvait pas le montrer, seul le style CALCULÉ le dit.
 *
 * MÉTHODE. On extrait les VRAIES fonctions de rendu (app.js) et la VRAIE structure (index.html),
 * on les sert avec la VRAIE feuille de style dans un Chromium, et on mesure ce qui est peint et
 * ce qui est positionné. Aucune copie de balisage : une copie ne dérive jamais en même temps que
 * l'original, elle ment le jour où l'original change.
 *
 *   node scripts/journal-barre-verif.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const PORT = 8823;
let ok = 0, ko = 0;
const t = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
};

const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');

/* ── EXTRACTION 1 : la structure réelle de la vue « Trades », telle qu'elle est écrite dans la
   page. On prend le bloc #jr-log-view entier — c'est lui qui décide si les rangées sont sœurs
   ou empilées. ── */
const struct = (() => {
  const a = HTML.indexOf('<div id="jr-log-view">');
  const b = HTML.indexOf('</div>\n      <div id="jr-dashboard"', a);
  return (a < 0 || b < a) ? null : HTML.slice(a, b + 6);
})();

/* ── EXTRACTION 2 : les deux fonctions de rendu, jouées dans un faux document pour récupérer le
   BALISAGE EXACT qu'un client reçoit (valeurs, classes, titres compris). ── */
function corpsEntre(debut, fin) {
  const a = APP.indexOf(debut);
  const b = APP.indexOf(fin, a);
  return (a < 0 || b < a) ? null : APP.slice(a, b);
}
const srcStats = corpsEntre('  function _jrRenderStats() {', '  // ═══ TRADE LOG : GRILLE ÉDITABLE');
const srcBarre = corpsEntre('  function _jrRenderToolbar() {', '  // Export CSV (round-trip');

function rendre(src, appel, vue) {
  let html = '';
  const faux = {
    getElementById: (id) => (id === 'jr-stats' || id === 'jr-toolbar')
      ? { set innerHTML(v) { html = v; } } : null,
  };
  new Function('document', '_jrView', '_jrOutcome', '_jrCustom', src + '\n' + appel)(
    faux,
    () => vue,
    (e) => (e.r == null ? null : Number(e.r)),
    true,
  );
  return html;
}

/* Le jeu d'essai de la capture : 44 trades, 69% de réussite, +27,58 R, +13 316 $ — et un second
   jeu en PERTE, sans quoi on ne mesurerait que la moitié de la règle. */
const gagnants = (n, r, pl) => Array.from({ length: n }, (_, i) => ({ r: i < 30 ? r : -0.5, pl: pl / n }));

console.log('\n[1] Les deux rendus sont extractibles (aucune copie de balisage)');
t('la structure #jr-log-view est lue dans la page', !!struct);
t('_jrRenderStats est extraite', !!srcStats);
t('_jrRenderToolbar est extraite', !!srcBarre);

let htmlStats = '', htmlStatsNeg = '', htmlBarre = '';
if (srcStats) {
  htmlStats = rendre(srcStats, '_jrRenderStats();', gagnants(44, 1.2, 13316));
  htmlStatsNeg = rendre(srcStats, '_jrRenderStats();', [{ r: -1.5, pl: -820 }, { r: -0.8, pl: -410 }]);
}
if (srcBarre) htmlBarre = rendre(srcBarre, '_jrRenderToolbar();', []);

console.log('\n[2] Le balisage porte bien la sémantique (avant même la peinture)');
t('la valeur positive reçoit la classe de gain', /class="jr-pos"/.test(htmlStats), htmlStats.slice(0, 120));
t('… et la valeur négative celle de perte', /class="jr-neg"/.test(htmlStatsNeg));
t('le taux de réussite a sa cellule dédiée (l\'or de la marque)', /jr-stat--taux/.test(htmlStats));
t('les boutons gardent leur explication en infobulle malgré un libellé court',
  (htmlBarre.match(/title="/g) || []).length >= 4, (htmlBarre.match(/title="/g) || []).length + ' infobulles');

(async () => {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { console.log('\n[Journal] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }
  const bin = process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/pw-browsers/chromium'
    || '/usr/bin/chromium';
  const dispo = fs.existsSync(bin);
  if (!dispo) { console.log('\n[Journal] Chromium introuvable → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }

  /* Un serveur minuscule : la VRAIE feuille de style, la VRAIE structure, le VRAI balisage. */
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/css/')) {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(fs.readFileSync(path.join(RACINE, 'public', req.url.split('?')[0])));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8">'
      + '<link rel="stylesheet" href="/css/style.css"></head><body>'
      + '<div class="view-panel" id="view-journal">' + struct + '</div>'
      + '<script>document.getElementById("jr-stats").innerHTML = ' + JSON.stringify(htmlStats) + ';'
      + 'document.getElementById("jr-toolbar").innerHTML = ' + JSON.stringify(htmlBarre) + ';<\/script>'
      + '</body></html>');
  });
  await new Promise(r => srv.listen(PORT, r));
  let nav;
  try {
    nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  } catch (e) {
    console.log('\n[Journal] Chromium refuse de démarrer → phase navigateur abstenue (' + String(e.message).slice(0, 70) + ').\n');
    srv.close(); process.exit(ko ? 1 : 0);
  }
  try {
    const page = await nav.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 30000 });

    console.log('\n[3] Ce qui est PEINT (style calculé, pas classe posée)');
    const couleurs = await page.evaluate(() => {
      const g = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).color : null; };
      return {
        pos: g('.jr-stat b.jr-pos'),
        taux: g('.jr-stat--taux b'),
        neutre: g('.jr-stat b:not(.jr-pos):not(.jr-neg)'),
      };
    });
    t('un gain se lit en VERT (charte : #00e676), pas en blanc',
      couleurs.pos === 'rgb(0, 230, 118)', String(couleurs.pos));
    t('le taux de réussite garde l\'or de la marque', /227, 178, 58|184, 134, 11/.test(String(couleurs.taux)), String(couleurs.taux));
    t('… et un nombre sans signe reste neutre (le témoin : tout n\'est pas repeint)',
      couleurs.neutre !== 'rgb(0, 230, 118)', String(couleurs.neutre));

    const negCol = await page.evaluate((h) => {
      document.getElementById('jr-stats').innerHTML = h;
      const el = document.querySelector('.jr-stat b.jr-neg');
      return el ? getComputedStyle(el).color : null;
    }, htmlStatsNeg);
    t('une perte se lit en ROUGE', /rgb\(255, (77|61), (46|0)\)/.test(String(negCol)), String(negCol));

    console.log('\n[4] Ce qui est POSITIONNÉ (une seule bande, et elle se replie)');
    await page.evaluate((h) => { document.getElementById('jr-stats').innerHTML = h; }, htmlStats);
    const large = await page.evaluate(() => {
      const s = document.getElementById('jr-stats').getBoundingClientRect();
      const b = document.getElementById('jr-toolbar').getBoundingClientRect();
      const doc = document.documentElement;
      return { sy: s.top + s.height / 2, by: b.top + b.height / 2, sx: s.left, bx: b.left,
        sr: s.right, deb: doc.scrollWidth - doc.clientWidth };
    });
    t('à 1440px, chiffres et actions sont sur la MÊME ligne',
      Math.abs(large.sy - large.by) < 10, 'centres à ' + Math.round(large.sy) + 'px et ' + Math.round(large.by) + 'px');
    t('… les chiffres à gauche, les actions à droite',
      large.bx > large.sx, 'x = ' + Math.round(large.sx) + ' / ' + Math.round(large.bx));
    t('… et rien ne déborde horizontalement', large.deb <= 1, 'débord ' + large.deb + 'px');

    /* ══ LA VUE ADOPTÉE DANS UNE CARTE ÉTROITE (10/09) ═══════════════════════════════════════
       Le Journal est ADOPTABLE : `widgets.js` déplace physiquement `.panel-journal` de
       `#view-journal` dans une carte à onglets de `#view-widgets`, puis le remet. Cette carte
       coupe à `overflow: hidden`. Mesuré le jour même de la refonte de la bande : à 414px de
       carte, la barre d'actions débordait de 92px — quatre boutons devenus INATTEIGNABLES, dont
       « + Nouveau ». Elle déclarait pourtant `flex-wrap: wrap` ; mais en `flex: 0 0 auto` dans la
       bande, rien ne contraignait sa largeur, donc son repli ne se déclenchait jamais. Une
       propriété de repli ne sert à rien sans une contrainte qui la déclenche.
       ⚠️ ON ÉPROUVE LES DEUX CONTEXTES : la vue adoptée n'a pas les mêmes règles que la vue
       normale (`#view-widgets .jr-toolbar`, `#view-widgets .jr-tb-spacer`), et c'est justement
       celle que personne ne regarde en développant. */
    for (const ctx of ['view-widgets', 'view-journal']) {
      for (const w of [900, 560, 414, 342]) {
        const m = await page.evaluate((ctx, w) => {
          const hote = document.getElementById('view-journal') || document.querySelector('.view-panel');
          hote.id = ctx;                                   // on rejoue le contexte, la feuille fait le reste
          const cadre = document.querySelector('.panel-journal') || hote;
          cadre.style.width = w + 'px';
          cadre.style.overflow = 'hidden';
          const c = cadre.getBoundingClientRect();
          const s = document.getElementById('jr-stats').getBoundingClientRect();
          const t = document.getElementById('jr-toolbar').getBoundingClientRect();
          const btns = [...document.querySelectorAll('#jr-toolbar > button')].map(e => e.getBoundingClientRect());
          return { debord: Math.round(Math.max(s.right, t.right) - c.right),
            vus: btns.filter(b => b.right <= c.right + 1 && b.width > 0).length, total: btns.length };
        }, ctx, w);
        t('bande à ' + w + 'px dans ' + ctx + ' : rien ne déborde de la carte',
          m.debord <= 1, 'débord ' + m.debord + 'px');
        t('… et les ' + m.total + ' boutons restent atteignables',
          m.total > 0 && m.vus === m.total, m.vus + '/' + m.total);
      }
    }
    await page.evaluate(() => {
      const h = document.querySelector('.view-panel'); if (h) h.id = 'view-journal';
      const c = document.querySelector('.panel-journal'); if (c) { c.style.width = ''; c.style.overflow = ''; }
    });

    await page.setViewport({ width: 700, height: 900 });
    await new Promise(r => setTimeout(r, 200));
    const etroit = await page.evaluate(() => {
      const s = document.getElementById('jr-stats').getBoundingClientRect();
      const b = document.getElementById('jr-toolbar').getBoundingClientRect();
      const doc = document.documentElement;
      return { sb: s.bottom, bt: b.top, deb: doc.scrollWidth - doc.clientWidth };
    });
    t('à 700px la bande se replie proprement (les actions passent dessous)',
      etroit.bt >= etroit.sb - 2, 'bas des chiffres ' + Math.round(etroit.sb) + ', haut des actions ' + Math.round(etroit.bt));
    t('… sans débord horizontal non plus', etroit.deb <= 1, 'débord ' + etroit.deb + 'px');
  } finally {
    if (nav) await nav.close();
    srv.close();
  }
  console.log('\n[Journal barre] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
  process.exit(ko ? 1 : 0);
})();

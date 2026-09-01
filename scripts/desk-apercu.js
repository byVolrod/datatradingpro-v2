#!/usr/bin/env node
/**
 * desk-apercu.js — LE DESK DE BUREAU, EN IMAGE, ET SES MESURES
 * ------------------------------------------------------------------------------------------------
 * Le pendant BUREAU de `mobile-apercu.js`, né le 02/09 d'une demande d'harmonisation visuelle
 * (« interface plus premium, propre, cohérente entre les panneaux »).
 *
 * POURQUOI IL EXISTE. Juger « est-ce que ça respire, est-ce que c'est aligné » en lisant 21 000
 * lignes de feuille de style ne marche pas : la cascade a le dernier mot, pas la déclaration qu'on
 * lit. Le défaut qui a motivé cet outil le prouve — `.panel-header` et `.chart-header` DÉCLARENT le
 * même fond `--head-bg`, et le rendu donnait transparent d'un côté, #101012 de l'autre, parce qu'un
 * voile « premium » écrit en raccourci `background` effaçait la couleur cent lignes plus bas. Aucune
 * lecture de code ne montre ça. Une mesure, si.
 *
 * CE QU'IL FAIT. Il ouvre le VRAI desk (même index.html, mêmes scripts, même feuille) dans un
 * Chromium de bureau, avec l'API bouchonnée par le serveur de `mobile-apercu` — donc le MÊME jeu
 * d'essai que les bancs, jamais un second décor qui divergerait. Il en sort une image et un relevé
 * des grandeurs qui font l'harmonie : hauteurs de barres, fonds, bordures, rayons, gouttières.
 *
 *   node scripts/desk-apercu.js [sortie.png] [largeur] [hauteur]
 *
 * S'abstient proprement (code 0) sans Chromium : ce n'est pas un banc, c'est une loupe.
 */
const path = require('path');
const { serveur, trouverNavigateur } = require('./mobile-apercu.js');

const PORT = 4915;
const SORTIE = process.argv[2] || path.join(__dirname, '..', 'apercu-desk.png');
const LARGEUR = parseInt(process.argv[3], 10) || 1920;
const HAUTEUR = parseInt(process.argv[4], 10) || 1080;

(async () => {
  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Desk] aucun Chromium → aperçu abstenu (ce n\'est pas un échec).\n'); process.exit(0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Desk] puppeteer-core absent → aperçu abstenu.\n'); process.exit(0); }

  const srv = serveur();
  await new Promise(r => srv.listen(PORT, r));
  const nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await nav.newPage();
    await page.setViewport({ width: LARGEUR, height: HAUTEUR, deviceScaleFactor: 1 });
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e).slice(0, 160)));
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle0', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2600));
    await page.screenshot({ path: SORTIE });

    /* LES GRANDEURS QUI FONT L'HARMONIE. On relève ce qui doit se ressembler d'un panneau à l'autre :
       si deux barres qui jouent le même rôle sortent avec deux fonds ou deux hauteurs, ça se voit
       ici en une ligne, alors que ça se cherche pendant une heure dans la feuille de style. */
    const m = await page.evaluate(() => {
      const lot = (sel) => [...document.querySelectorAll(sel)]
        .filter(e => e.getBoundingClientRect().height > 4)
        .slice(0, 4)
        .map(e => {
          const c = getComputedStyle(e), b = e.getBoundingClientRect();
          return { h: Math.round(b.height), bg: c.backgroundColor, bordBas: c.borderBottomColor + ' ' + c.borderBottomWidth };
        });
      const boite = (sel) => { const e = document.querySelector(sel); if (!e) return null;
        const c = getComputedStyle(e), b = e.getBoundingClientRect();
        return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height), bord: c.borderTopWidth, rad: c.borderRadius }; };
      return {
        barres: { 'panel-header': lot('.panel-header'), 'chart-header': lot('.chart-header') },
        colonnes: { gauche: boite('#views-col'), droite: boite('#panel-right') },
        onglets: [...document.querySelectorAll('.nav-item')].slice(0, 2).map(e => {
          const c = getComputedStyle(e), b = e.getBoundingClientRect();
          return { h: Math.round(b.height), pad: c.padding, bg: c.backgroundColor, rad: c.borderRadius }; }),
      };
    }).catch(e => ({ err: String(e).slice(0, 200) }));

    console.log('\nAperçu écrit : ' + SORTIE + '  (' + LARGEUR + 'x' + HAUTEUR + ')\n');
    console.log(JSON.stringify(m, null, 1));
    if (erreurs.length) console.log('\n⚠️ erreurs de page : ' + erreurs.slice(0, 3).join(' | '));
  } finally {
    await nav.close(); srv.close();
  }
  process.exit(0);
})();

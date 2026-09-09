#!/usr/bin/env node
/**
 * scripts/document-verif.js — UN RAPPORT D'INSTITUTION SE PRÉSENTE-T-IL COMME UNE PAGE ?
 *
 * POURQUOI (09/09, retour utilisateur devant un rapport Goldman enfin lisible : « c'est mal
 * affiché, affiche bien comme leur PDF, tu vois »).
 *
 * LA COMPARAISON VIENT DU DESK LUI-MÊME, et c'est ce qui la rend imparable. Quand une banque publie
 * un VRAI fichier PDF, le lecteur l'ouvre dans une visionneuse : page blanche, texte noir, marges
 * franches. Quand elle publie une page web fermée dont on extrait le texte — le cas de Goldman —
 * le même onglet rendait une carte SOMBRE, pleine largeur, sans page. Deux rapports voisins dans la
 * même liste n'avaient donc rien en commun, et l'un des deux avait l'air cassé.
 * S'ajoutait une marge BLANCHE autour du document : aucune règle ne peignait le fond du volet, qui
 * héritait donc de ce que le navigateur voulait bien lui donner.
 *
 * CE BANC MESURE LE RENDU, PAS LE CODE. Il ouvre le lecteur dans un vrai Chromium avec la VRAIE
 * feuille de styles et lit les valeurs CALCULÉES : la page est-elle claire, l'encre sombre, la
 * colonne bornée, la marge autour aux couleurs du desk. Une relecture de CSS ne peut établir aucune
 * de ces quatre choses — la cascade décide, pas la déclaration.
 *
 *   node scripts/document-verif.js
 *
 * Sans navigateur disponible, le contrôle S'ABSTIENT (code 0) plutôt que de bloquer.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const PORT = 4637;
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}
function trouverNavigateur() {
  const bases = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  const cand = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const b of bases) {
    try {
      for (const d of fs.readdirSync(b)) {
        for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) cand.push(path.join(b, d, rel));
      }
    } catch {}
  }
  return cand.find(c => c && fs.existsSync(c)) || null;
}
// « rgb(r, g, b) » → luminance perçue 0-255. Sert à dire « clair » ou « sombre » sans supposer
// une valeur exacte : ce qui compte est le CONTRASTE entre la page et son encre, pas un hex précis.
function lum(css) {
  const m = String(css || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
}

(async () => {
  console.log('\n[1] Le rapport, rendu dans un vrai navigateur');
  const bin = trouverNavigateur();
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { puppeteer = null; }
  if (!bin || !puppeteer) {
    console.log('  … navigateur absent → contrôle abstenu.');
    console.log('\n[Document] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
    process.exit(0);
  }

  const CSS = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8');
  /* On reconstruit la structure EXACTE que produit `renderBrReader` : volet, contenu, document,
     en-tête, titre, accroche, corps. Le banc éprouve la feuille de styles réelle sur ce squelette. */
  const PAGE = '<div class="br-reader-view" style="height:600px">'
    + '<div class="br-rcontent" id="br-rcontent">'
    + '<div class="br-document">'
    + '<div class="br-ing-header"><span class="br-ing-tagline">Goldman Sachs</span></div>'
    + '<div class="br-ing-meta"><span class="br-ing-type">Article</span>'
    + '<span class="br-ing-sep">|</span><span class="br-ing-date">20 août 2026</span></div>'
    + '<div class="br-doc-title">European Stocks Defy Global Shocks</div>'
    + '<div class="br-ing-lead">Une accroche de rapport.</div>'
    + '<div class="br-doc-body"><p id="para">Le corps du rapport, sur plusieurs lignes.</p>'
    + '<h2 id="soustitre">Un intertitre</h2><p><strong id="fort">un passage en gras</strong></p></div>'
    + '</div></div></div>';

  const srv = http.createServer((req, res) => {
    if (req.url === '/style.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end(CSS); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head>'
      + '<body style="margin:0">' + PAGE + '</body></html>');
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await nav.newPage();
    await page.setViewport({ width: 1400, height: 700 });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
    const m = await page.evaluate(() => {
      const g = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
      const doc = document.querySelector('.br-document');
      const cont = document.querySelector('.br-rcontent');
      return {
        pageFond: g('.br-document', 'backgroundColor'),
        pageLargeur: doc ? doc.getBoundingClientRect().width : 0,
        contLargeur: cont ? cont.getBoundingClientRect().width : 0,
        pageGauche: doc ? doc.getBoundingClientRect().left : 0,
        contGauche: cont ? cont.getBoundingClientRect().left : 0,
        marge: g('.br-rcontent', 'backgroundColor'),
        corps: g('#para', 'color'),
        titre: g('.br-doc-title', 'color'),
        fort: g('#fort', 'color'),
        soustitre: g('#soustitre', 'color'),
        meta: g('.br-ing-date', 'color'),
        accroche: g('.br-ing-lead', 'color'),
      };
    });

    console.log('\n[2] La page est une PAGE : claire, encrée, bornée, centrée');
    const lPage = lum(m.pageFond), lCorps = lum(m.corps);
    t('le document a un fond CLAIR', lPage != null && lPage > 200, m.pageFond);
    t('son texte est une encre SOMBRE', lCorps != null && lCorps < 90, m.corps);
    /* LE CONTRASTE EST LA SEULE CHOSE QUI COMPTE VRAIMENT : deux valeurs claires, ou deux valeurs
       sombres, donneraient un rapport illisible tout en satisfaisant des contrôles pris séparément. */
    t('le contraste page / encre est franc', lPage != null && lCorps != null && (lPage - lCorps) > 140,
      'écart de luminance ' + Math.round((lPage || 0) - (lCorps || 0)));
    t('la colonne de lecture est bornée', m.pageLargeur > 0 && m.pageLargeur <= 900,
      Math.round(m.pageLargeur) + ' px');
    /* Bornée ET CENTRÉE : bornée seule collerait la page à gauche, avec un vide à droite — c'est
       exactement le reproche fait le même jour à la courbe du récap. */
    const gaucheRel = m.pageGauche - m.contGauche;
    const droiteRel = (m.contGauche + m.contLargeur) - (m.pageGauche + m.pageLargeur);
    t('elle est centrée dans le volet', Math.abs(gaucheRel - droiteRel) < 3,
      'gauche ' + Math.round(gaucheRel) + ' px, droite ' + Math.round(droiteRel) + ' px');

    console.log('\n[3] Ce qui entoure la page appartient au desk');
    const lMarge = lum(m.marge);
    t('la marge autour est SOMBRE, pas blanche', lMarge != null && lMarge < 60, m.marge);

    console.log('\n[4] Rien n\'est resté écrit pour un fond sombre');
    /* Chaque élément du document portait une couleur claire, pensée pour l'ancienne carte sombre.
       Oublier l'un d'eux le rend BLANC SUR BLANC : invisible, et invisible sans aucune erreur. */
    for (const [nom, val] of [['le titre', m.titre], ['les intertitres', m.soustitre],
                              ['le gras', m.fort], ['l\'accroche', m.accroche], ['la ligne de date', m.meta]]) {
      const l = lum(val);
      t(nom + ' reste lisible sur la page', l != null && l < 150, val);
    }
  } finally {
    await nav.close().catch(() => {});
    await new Promise(r => srv.close(r));
  }
  console.log('\n[Document] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
  process.exit(ko ? 1 : 0);
})();

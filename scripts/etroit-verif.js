#!/usr/bin/env node
/**
 * etroit-verif.js — CE QUI SORT DE SA CARTE SUR UN ÉCRAN ÉTROIT.
 * ------------------------------------------------------------------------------------------------
 * 29/08, capture d'iPhone à l'appui : dans une actualité dépliée, on lisait « npact marché : » — le
 * I mangé par le bord gauche de la liste.
 *
 * LA MÉCANIQUE, ET POURQUOI AUCUN AUTRE CONTRÔLE NE POUVAIT LA VOIR. Le sous-titre d'une description
 * se déporte de 18 px vers la GAUCHE pour se détacher des puces. Sur grand écran il puise dans le
 * padding du panneau (`--news-desc-bleed`, ~248 px : la somme des colonnes d'une ligne d'actualité)
 * et 18 px n'y coûtent rien. Sous 640 px la carte se réorganise, le bleed retombe à la marge de
 * carte — 12 px, 10 px sur les plus étroits — et les 18 px sortent du cadre. Rien dans le code ne
 * change entre les deux cas : c'est la MÊME règle qui donne un résultat juste à 1400 px et rogné à
 * 390. Une relecture de la feuille ne peut pas trancher ; seule une mesure le peut.
 *
 * On ouvre donc la vraie feuille de style dans un vrai Chromium, à sept largeurs, et on compare deux
 * abscisses : le bord gauche du sous-titre et celui de la liste qui le contient (`.news-list` est en
 * `overflow-x: auto` — tout ce qui passe à sa gauche est rogné).
 *
 *   node scripts/etroit-verif.js
 *
 * Sans Chromium, il s'abstient (code 0) : il tourne là où il peut, il ne bloque jamais une livraison.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4718;
const LARGEURS = [360, 390, 430, 560, 640, 768, 1400];

/* ⚠️ SANS CE BOUT DE CODE, LA MAQUETTE MENT — ET ELLE MENT PILE SUR L'ÉCRAN DU CLIENT.
   Sous 560 px la ligne d'actualité devient une GRILLE, et le panneau déplié y hérite de la colonne
   du titre : il commence 44 px à droite du bord, où un déport de 18 px ne gêne personne. Ce n'est
   pas ce que voit le client : à l'ouverture, `_fondPleineLargeur` (app.js) ramène le panneau au
   bord de la carte par une marge négative mesurée. C'est APRÈS ce recalage que le sous-titre sort
   du cadre. Une maquette sans lui aurait donné un vert parfait sur la largeur exacte de la capture.
   On extrait donc la vraie fonction — pas une copie qui pourrait diverger d'elle. */
const APP = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
const _d = APP.indexOf('function _fondPleineLargeur(el) {');
const _f = _d < 0 ? -1 : APP.indexOf('\n}', _d);
const SRC_FOND = _d < 0 ? null : APP.slice(_d, _f + 2);

let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, rel)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x)) || null;
}

/* La maquette reprend l'imbrication EXACTE d'une actualité dépliée : c'est elle qui met le retrait
   de la liste à zéro (`.news-description.visible .article-points`) et qui laisse donc le déport du
   sous-titre puiser dans le seul padding du panneau. Une maquette approximative rendrait le
   contrôle inutile — c'est précisément cette cascade qu'on éprouve. */
const MAQUETTE = (port) => '<html data-theme="dark"><head>'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<link rel="stylesheet" href="http://localhost:' + port + '/css/style.css"></head><body style="margin:0">'
  + '<div class="news-list" id="liste">'
  +   '<div class="news-item news-item--open">'
  +     '<div class="news-icon-col"></div><div class="news-time">08:14</div>'
  +     '<div class="news-category-text">MARCHÉS</div>'
  +     '<div class="news-content"><div class="news-title">Titre d\'actualité</div>'
  +       '<div class="news-description visible">'
  +         '<ul class="article-points article-points--clean">'
  +           '<li class="ip-head" id="tete">Impact marché</li>'
  +           '<li id="puce">Une puce ordinaire de la description.</li>'
  +         '</ul></div></div>'
  +     '<div class="news-arrow-col"></div>'
  +   '</div></div></body></html>';

/* ══ LA DÉCORATION QUI OUVRE UNE BARRE DE DÉFILEMENT ═══════════════════════════════════════════
   29/08, capture client : une barre de défilement HORIZONTALE sous la carte « Semaine à Venir » de
   Mon Desk. « Ça sert à rien » — et c'était exact : défilée à fond, la zone gagnée était VIDE.
   LA CAUSE N'ÉTAIT PAS DANS LE WIDGET. `body.dtp-premium .view-panel::after` est une aura d'or
   décorative, un dégradé à 6 % d'opacité posé DERRIÈRE la vue (z-index négatif), large de 820px en
   dur. Sur le desk plein écran elle ne se voit ni ne gêne. Dans une carte de 461px, elle porte la
   zone défilable à 858px : Chrome affiche une barre vers 397 pixels de vide.
   ⚠️ ET LE COMMENTAIRE DE LA FEUILLE AFFIRMAIT « COÛT NUL EN MISE EN PAGE : pseudo-éléments hors
   flux ». C'est le piège exact : « hors flux » n'est pas « hors mise en page ». Un absolu ne pousse
   plus ses voisins, mais il compte toujours dans la ZONE DÉFILABLE de son bloc conteneur. Aucune
   relecture de code ne tranche ça — seule une mesure le fait, et c'est pour ça que ce contrôle
   existe.
   ⚠️ LA MOITIÉ QUI COMPTE : l'aura doit RESTER telle quelle là où elle se voit. Un correctif qui
   l'aurait supprimée aurait réglé la barre en enlevant la décoration qu'on paie. On vérifie donc
   les deux : plus de zone vide sur un panneau étroit, taille d'origine sur un panneau large. */
const PANNEAU = (port, largeur) => '<html data-theme="dark"><head>'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<link rel="stylesheet" href="http://localhost:' + port + '/css/style.css"></head>'
  + '<body class="dtp-premium" style="margin:0">'
  /* `overflow-y: auto` seul suffit à faire naître la barre horizontale : par la spécification CSS,
     l'axe laissé en `visible` face à un axe non-visible se calcule en `auto`. C'est la situation
     réelle du panneau Semaine à Venir sous 1024px. */
  + '<div class="view-panel" id="p" style="width:' + largeur + 'px;height:300px;overflow-y:auto">'
  +   '<div style="height:200px">contenu</div>'
  + '</div></body></html>';

(async () => {
  console.log('\n═══ ÉTROIT-VERIF — rien ne sort de sa carte ═══');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { console.log('  · puppeteer-core absent → abstention.\n'); process.exit(0); }
  const bin = trouverNavigateur();
  if (!bin) { console.log('  · aucun Chromium → abstention.\n'); process.exit(0); }

  const srv = http.createServer((rq, rs) => {
    const f = path.join(PUB, rq.url.split('?')[0].replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f)) { rs.writeHead(404); return rs.end('404'); }
    rs.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : 'text/plain' });
    fs.createReadStream(f).pipe(rs);
  }).listen(PORT);

  let nav = null;
  try {
    nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    console.log('\n── Le sous-titre d\'une description dépliée ──');
    v('_fondPleineLargeur est extraite d\'app.js', !!SRC_FOND && /marginLeft = \(-g\)/.test(SRC_FOND),
      'sans elle, la maquette ne reproduit pas ce que voit le client');
    if (!SRC_FOND) throw new Error('_fondPleineLargeur introuvable dans app.js');
    for (const L of LARGEURS) {
      await page.setViewport({ width: L, height: 780, isMobile: L <= 768, hasTouch: L <= 768, deviceScaleFactor: 2 });
      /* `networkidle0` ne revient pas au deuxieme passage : la feuille est deja en cache, aucune
         connexion ne s'ouvre. On attend donc la CASCADE elle-meme — un token qui n'existe que
         dans style.css — plutot qu'un evenement reseau qui n'aura pas lieu. */
      await page.setContent(MAQUETTE(PORT), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const el = document.querySelector('.news-item');
        return el && getComputedStyle(el).getPropertyValue('--c-pad').trim() !== '';
      }, { timeout: 15000 });
      await page.evaluate((src) => { eval(src); _fondPleineLargeur(document.querySelector('.news-description')); }, SRC_FOND);
      const m = await page.evaluate(() => {
        const t = document.getElementById('tete').getBoundingClientRect();
        const p = document.getElementById('puce').getBoundingClientRect();
        const l = document.getElementById('liste').getBoundingClientRect();
        return { tete: t.x, puce: p.x, liste: l.x,
          marge: getComputedStyle(document.getElementById('tete')).marginLeft,
          bleed: getComputedStyle(document.querySelector('.news-item')).getPropertyValue('--news-desc-bleed').trim() };
      });
      const dedans = m.tete >= m.liste - 0.5;
      v(L + ' px — le sous-titre reste dans la liste', dedans,
        'bord du sous-titre ' + m.tete.toFixed(1) + ' px · bord de la liste ' + m.liste.toFixed(1)
        + ' px · marge ' + m.marge + ' · bleed ' + (m.bleed || '(vide)'));
      /* Le déport a une RAISON : détacher le sous-titre des puces. Le borner ne doit pas l'annuler,
         sinon on aurait corrigé le rognage en supprimant la hiérarchie qu'il servait. */
      v('… tout en restant détaché des puces', m.tete < m.puce - 1,
        'sous-titre ' + m.tete.toFixed(1) + ' px · puce ' + m.puce.toFixed(1) + ' px');
      if (L === 1400) v('… et le grand écran garde son déport de 18 px', m.marge === '-18px', 'marge calculée ' + m.marge);
    }
    console.log('\n── L\'aura décorative n\'ouvre plus de zone vide ──');
    for (const L of [420, 461, 640, 900]) {
      await page.setViewport({ width: Math.max(L + 40, 380), height: 700 });
      await page.setContent(PANNEAU(PORT, L), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => getComputedStyle(document.body).getPropertyValue('--radius').trim() !== '', { timeout: 15000 });
      const m = await page.evaluate(() => {
        const el = document.getElementById('p');
        const a = getComputedStyle(el, '::after');
        return { cw: el.clientWidth, sw: el.scrollWidth, aura: a.width, posee: a.content === '""' };
      });
      /* ⚠️ L'AURA DOIT ÊTRE LÀ POUR QUE LA MESURE VEUILLE DIRE QUELQUE CHOSE. Sans ce contrôle, la
         supprimer rendait le banc vert : plus de décoration, donc plus de débordement — on aurait
         « corrigé » la barre en enlevant ce qu'elle décorait. */
      v(L + ' px — l\'aura est bien posée', m.posee, 'aucun pseudo-élément ::after sur .view-panel');
      v(L + ' px — aucune zone défilable vide à droite', m.sw <= m.cw + 1,
        'panneau ' + m.cw + ' px · zone défilable ' + m.sw + ' px (soit ' + (m.sw - m.cw) + ' px de vide) · aura ' + m.aura);
    }
    /* ⚠️ ET L'AURA GARDE SA TAILLE LÀ OÙ ELLE SE VOIT. 820px est la valeur d'origine ; au-delà de
       ~892px de panneau (820 / 0,92), le plafond reprend la main et rien ne change à l'écran. */
    await page.setViewport({ width: 1500, height: 700 });
    await page.setContent(PANNEAU(PORT, 1400), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => getComputedStyle(document.body).getPropertyValue('--radius').trim() !== '', { timeout: 15000 });
    const large = await page.evaluate(() => {
      const el = document.getElementById('p');
      return { cw: el.clientWidth, sw: el.scrollWidth, aura: getComputedStyle(el, '::after').width };
    });
    v('sur un panneau large, l\'aura garde ses 820 px', large.aura === '820px', 'aura mesurée ' + large.aura);
    v('… sans ouvrir de zone vide pour autant', large.sw <= large.cw + 1, large.cw + ' → ' + large.sw);
    await page.close();
  } catch (e) {
    v('les mesures s\'exécutent', false, e.message);
  } finally {
    if (nav) try { await nav.close(); } catch {}
    srv.close();
  }

  console.log('');
  if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
  console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');
  process.exit(0);
})();

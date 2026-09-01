#!/usr/bin/env node
/**
 * mobile-apercu.js — LE DESK, DANS UN VRAI TÉLÉPHONE, EN IMAGE
 * ------------------------------------------------------------------------------------------------
 * 04/09, demande utilisateur : « fais le développement mobile et montre-le-moi sur un écran de
 * preview que je puisse voir en direct le développement mobile ».
 *
 * CE QUE CE SCRIPT EST, ET CE QU'IL N'EST PAS. Ce n'est pas une maquette : il ouvre le VRAI desk —
 * le même index.html, les mêmes scripts, la même feuille de style — dans un Chromium configuré en
 * téléphone (taille d'écran, densité de pixels, agent utilisateur, événements tactiles), avec l'API
 * bouchonnée comme au banc. Ce qui s'affiche est donc ce qui s'affichera, aux données près.
 *
 * POURQUOI ÇA COMPTE PLUS QU'UN SIMULATEUR REDIMENSIONNÉ. Trois choses ne se voient QUE dans ces
 * conditions : les règles `@media (hover: none)` qui changent l'interface au doigt, le
 * `deviceScaleFactor` qui révèle les textes trop fins, et la hauteur réelle disponible une fois la
 * barre système déduite. Réduire une fenêtre de bureau n'active aucune des trois.
 *
 *   node scripts/mobile-apercu.js [sortie.png]      (s'abstient sans Chromium)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4812;
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

/* Les appareils de référence. Pas choisis au hasard : le 12 mini est l'écran le plus ÉTROIT encore
   courant (375 pt) — si le desk tient là, il tient partout ; le Pixel 7 est la cible Android
   principale ; l'iPhone 15 Pro Max donne le cas inverse, celui où l'espace est large et où une mise
   en page pensée pour l'étroit peut se déliter en s'étirant. */
const APPAREILS = [
  { nom: 'iPhone 12 mini', w: 375, h: 812, dpr: 3, ios: true },
  { nom: 'Pixel 7',        w: 412, h: 915, dpr: 2.6, ios: false },
  { nom: 'iPhone 15 Pro Max', w: 430, h: 932, dpr: 3, ios: true },
];
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const UTIL = { id: 'u1', email: 'apercu@datatradingpro.com', name: 'Aperçu', role: 'client', plan: 'professionnel',
  active: true, expiresAt: new Date(Date.now() + 90 * 864e5).toISOString() };

/* ⚠️ DEUX PIÈGES DANS LE JEU D'ESSAI, ET LES DEUX RENDENT LE FIL VIDE — donc un aperçu qui montre
   un écran de chargement au lieu du produit, et pire : qui ferait croire à une panne mobile qui
   n'existe pas.

   1. LA FORME. Écrite « au plus simple » (titre, date, catégorie), la première version manquait
      `time` et `tags`, que le desk exige. On reprend la forme éprouvée de desk-verif.

   2. LE VOCABULAIRE DES RUBRIQUES, et celui-là ne se devine pas. Le fil ne garde que les
      catégories INTERNES du produit — `Fed`, `US Data`, `FX Flows`, `Geopolitical`… — et
      `getFilteredItems` rejette tout le reste sans un mot. Des dépêches étiquetées « Forex » ou
      « Commodities », qui semblent pourtant les plus naturelles du monde, sont donc TOUTES
      écartées : 30 dépêches entrent, zéro ligne sort, et le fil reste sur son spinner. C'est
      exactement ce qui s'est passé ici. Ces noms-ci viennent d'`INTERNAL_CATS` (app.js).
      ⚠️ `Economic Commentary` est la seule rubrique COUPÉE par défaut (migration one-shot) : la
      mettre dans un jeu d'essai revient à écrire des dépêches invisibles.

   Les titres sont réellement DISTINCTS : le fil dédoublonne les titres quasi identiques, et une
   série « dépêche 1, 2, 3… » s'effondrerait sur une seule ligne. */
const CATS = ['Fed', 'US Data', 'FX Flows', 'Market Analysis', 'Geopolitical', 'Global News',
  'EU Data', 'Energy & Power'];
const SUJ = ['Le dollar', 'L euro', 'La livre', 'Le yen', 'Le franc suisse', 'Le dollar canadien',
  'Le Brent', 'L or', 'Le Nasdaq', 'Le Bund 10 ans', 'Le CAC 40', 'Le Nikkei'];
const VRB = ['progresse', 'recule', 'se stabilise', 'efface ses gains', 'touche un plus bas', 'rebondit'];
const CTX = ['avant la Fed', 'apres l inflation allemande', 'sur fond de tensions commerciales',
  'porte par les rendements', 'avant le rapport emploi', 'sur un dollar plus ferme'];
function news(n) {
  return Array.from({ length: n }, (_, k) => ({
    id: 'n' + k,
    headline: (k === 0 ? 'BREAKING : la BCE laisse ses taux inchanges et maintient son biais restrictif'
      : SUJ[k % SUJ.length] + ' ' + VRB[(k / SUJ.length | 0) % VRB.length] + ' ' + CTX[(k / (SUJ.length * VRB.length) | 0) % CTX.length] + ' (' + k + ')'),
    description: 'Contexte de marche fourni par le desk pour l\'apercu mobile.',
    category: k === 0 ? 'ECB' : CATS[k % CATS.length],
    source: ['Reuters', 'Bloomberg', 'MarketWatch'][k % 3],
    time: '12:00', timestamp: Date.now() - k * 7 * 60000,
    priority: k === 0 ? 'high' : 'normal', urgent: k === 0,
    tags: [['USD', 'EUR', 'GBP', 'JPY'][k % 4]],
  }));
}
const TOUT = news(60);

/* Jeu d'essai LISTE FX (01/09) — voir la route /api/fxlist plus bas.
   ⚠️ LA FORME COMPTE AUTANT QUE LES VALEURS. `sparkLast`, `trend` et `seasonal` sont des SÉRIES,
   pas des nombres : un premier jet les avait mis en scalaires, `_fxlPriceSpark` a levé une
   TypeError au premier `.filter`, et tout le corps du tableau est resté vide. Un jeu d'essai qui ne
   respecte pas la forme du vrai payload ne prouve rien. Champs recopiés sur ce que sert vraiment
   server.js (`symbol` porte une barre oblique, `fund`/`research`/`bias` sont ajoutés ensuite). */
const _serie = (n, base, amp) => Array.from({ length: n }, (_, i) => base + Math.sin(i / 2.5) * amp + i * amp / 40);
const FXL_ESSAI = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'XAU/USD'].map((sym, i) => ({
  symbol: sym, base: sym.slice(0, 3), quote: sym.slice(4),
  last: 1.0842 + i, changePct: (i % 2 ? -1 : 1) * (0.12 + i * 0.07),
  sparkLast: _serie(24, 1.08 + i, 0.01 * (i + 1)),
  trend: _serie(48, 1.08 + i, 0.02 * (i + 1)),
  pattern: _serie(10, 1.08 + i, 0.01),
  seasonal: _serie(12, 0, 1 + i * 0.3),
  dmx: 20 + i * 13,
  fund: ['Bullish', 'Bearish', 'Neutral'][i % 3],
  research: ['Bearish', 'Neutral', 'Bullish'][i % 3],
  bias: i === 4 ? null : ['Neutral', 'Bullish', 'Bearish'][i % 3],   // un null : la cellule « - » doit tenir
  ret1M: (i - 2) * 1.4, ret3M: (2 - i) * 2.1, ret12M: i === 3 ? null : (i - 1) * 3.3,
  strength: (i - 2.5) * 0.8,
}));

function serveur() {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const j = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.startsWith('/api/')) {
      if (u === '/api/news') return j({ items: TOUT.slice(0, 30), total: TOUT.length });
      if (u === '/api/news/history') return j({ items: TOUT.slice(30), total: TOUT.length });
      if (u === '/api/session-wraps') return j([]);
      if (u === '/api/weekly-reports') return j({ items: [], generating: false });
      /* LISTE FX : un vrai payload, sinon la table ne se dessine JAMAIS dans les bancs navigateur.
         Le fourre-tout plus bas renvoie `{items:[]}` — sans `pairs`, donc le corps du tableau restait
         sur son squelette et tout contrôle « autant de <td> que de <th> » se faisait sur du vide,
         au vert. Six paires suffisent à compter des cellules ; les champs sont ceux que lit
         `_fxlCell` (charts.js), volontairement variés (une valeur nulle, un badge de chaque). */
      if (u === '/api/fxlist') return j({ updatedAt: new Date().toISOString(), pairs: FXL_ESSAI });
      return j({ items: [], total: 0, ok: true, loggedIn: true, authenticated: true, user: UTIL, ...UTIL });
    }
    const f = path.join(PUB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
  }
  return c.find((x) => x && fs.existsSync(x)) || null;
}

/* Le banc téléphone (mobile-verif.js) réutilise CE serveur et CE jeu d'essai plutôt que d'en
   recopier un troisième. La raison est fraîche : c'est une divergence de jeu d'essai — des
   rubriques hors vocabulaire — qui a rendu le fil vide ici pendant qu'il se remplissait ailleurs.
   Deux copies d'un décor, c'est deux vérités possibles. */
module.exports = { serveur, trouverNavigateur, APPAREILS, UA_IOS, UA_AND, TOUT };

if (require.main === module) (async () => {
  const sortie = process.argv[2] || path.join(RACINE, 'apercu-mobile.png');
  let pp; try { pp = require('puppeteer-core'); } catch { console.log('· puppeteer-core absent → abstention.'); process.exit(0); }
  const exe = trouverNavigateur();
  if (!exe) { console.log('· aucun Chromium → abstention.'); process.exit(0); }

  const srv = serveur().listen(PORT);
  const nav = await pp.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const vues = [];
  try {
    for (const a of APPAREILS) {
      const page = await nav.newPage();
      const fatales = [];
      page.on('pageerror', (e) => fatales.push(String(e.message).slice(0, 160)));
      await page.setUserAgent(a.ios ? UA_IOS : UA_AND);
      await page.setViewport({ width: a.w, height: a.h, deviceScaleFactor: a.dpr, isMobile: true, hasTouch: true });
      /* ⚠️ PAS `networkidle` : le desk est un terminal TEMPS RÉEL, il sonde en permanence. Le réseau
         n'y devient jamais « inactif », et l'attente expire au lieu de capturer. On attend le
         document, puis on laisse au fil le temps de se peindre. */
      await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      /* On ATTEND LE FIL, on ne dort pas un temps fixe : une durée arbitraire capture tantôt un
         spinner, tantôt le produit, selon la charge de la machine — et une planche qui montre un
         spinner ne prouve rien. */
      await page.waitForFunction(() => document.querySelectorAll('.news-item').length > 0,
        { timeout: 30000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      const png = await page.screenshot({ encoding: 'base64' });
      const mes = await page.evaluate(() => ({
        lignes: document.querySelectorAll('.news-item').length,
        deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }));
      vues.push({ titre: a.nom, sous: a.w + ' × ' + a.h + ' · ' + mes.lignes + ' lignes'
        + (mes.deborde ? ' · ⚠ débordement latéral' : '') + (fatales.length ? ' · ⚠ ' + fatales.length + ' erreur(s)' : ''),
        png, w: a.w, h: a.h });
      if (fatales.length) [...new Set(fatales)].slice(0, 3).forEach((f) => console.log('  ⚠ ' + a.nom + ' : ' + f));
      await page.close();
    }
    // La page hors-ligne, dans les mêmes conditions : c'est un écran du produit, pas un repli caché.
    {
      const page = await nav.newPage();
      await page.setUserAgent(UA_AND);
      await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
      await page.goto(`http://localhost:${PORT}/offline.html`, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 500));
      vues.push({ titre: 'Réseau perdu', sous: 'écran hors-ligne', png: await page.screenshot({ encoding: 'base64' }), w: 412, h: 915 });
      await page.close();
    }

    /* La planche : chaque capture dans un CADRE de téléphone. Ce n'est pas de la décoration — sans
       cadre, on juge une image de 375 px de large sur un écran de 27 pouces et tout paraît immense.
       Le cadre rend l'échelle, qui est justement ce qu'on vient vérifier. */
    const page = await nav.newPage();
    await page.setViewport({ width: 1640, height: 1000, deviceScaleFactor: 1.5 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#08080a;
      font-family:Inter,system-ui,sans-serif;padding:26px;display:flex;gap:26px;align-items:flex-start;justify-content:center">
      ${vues.map((v) => `<div style="flex:0 0 auto;text-align:center">
        <div style="color:#e3b23a;font-size:13px;font-weight:800;letter-spacing:.04em;margin:0 0 3px">${v.titre}</div>
        <div style="color:#6f6f79;font-size:11px;margin:0 0 12px">${v.sous}</div>
        <div style="width:${v.w * 0.86 + 16}px;padding:8px;background:#17171b;border:1px solid #26262c;border-radius:34px;box-shadow:0 18px 50px rgba(0,0,0,.6)">
          <img src="data:image/png;base64,${v.png}" style="width:100%;display:block;border-radius:27px">
        </div></div>`).join('')}
      </body>`);
    await new Promise((r) => setTimeout(r, 500));
    const h = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewport({ width: 1640, height: h + 20, deviceScaleFactor: 1.5 });
    await new Promise((r) => setTimeout(r, 250));
    await page.screenshot({ path: sortie });
    console.log('Aperçu écrit : ' + sortie);
    vues.forEach((v) => console.log('  · ' + v.titre + ' — ' + v.sous));
  } finally {
    await nav.close();
    srv.close();
  }
})();

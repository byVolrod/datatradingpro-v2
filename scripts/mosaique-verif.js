#!/usr/bin/env node
/**
 * scripts/mosaique-verif.js — LA MOSAÏQUE DE CONNEXION SE REMPLIT-ELLE D'UN COUP ?
 *
 * POURQUOI (09/09, capture utilisateur : « les images prennent du temps à charger, corrige dans
 * l'espace de connexion »). Sur la capture, la moitié des tuiles est noire plusieurs secondes après
 * l'ouverture de la page. Deux causes, indépendantes, toutes deux invisibles en lecture de code :
 *
 *   1. CHAQUE TUILE ÉTAIT EN CHARGEMENT PARESSEUX sauf la toute première. Or ces vignettes pèsent
 *      5 Ko (636 Ko pour les 80 réunies, en même origine) : il n'y avait rien à économiser. Pire,
 *      le déclenchement du chargement paresseux se décide sur la position de MISE EN PAGE, que le
 *      `transform: translateX()` de la piste animée ne change pas — une tuile bien visible pouvait
 *      donc être jugée lointaine, et attendre.
 *
 *   2. L'ARRIVÉE DES PHOTOS D'ACTU RECONSTRUISAIT TOUTE LA MOSAÏQUE. `build()` jetait cent tuiles
 *      déjà peintes pour repartir de balises vides, cette fois vers des serveurs de presse
 *      DISTANTS. L'écran se vidait au moment précis où il venait de se remplir.
 *
 * CE BANC OUVRE LA VRAIE `login.html` DANS UN CHROMIUM, sert les images localement, bouchonne
 * `/api/mosaic-images` avec des photos « distantes » LENTES, et regarde la seule chose qui compte :
 * combien de tuiles portent une image affichable, et à quel moment. Aucune lecture de source ne
 * peut établir cela — c'est un comportement de rendu.
 *
 *   node scripts/mosaique-verif.js
 *
 * Sans navigateur disponible, le contrôle S'ABSTIENT (code 0) plutôt que de bloquer.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4623;
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

/* ══ PHASE 1 — CE QUI SE LIT DANS LA SOURCE (le strict minimum) ═════════════════════════════════ */
console.log('\n[1] La source ne rebâtit plus la mosaïque sur les photos d\'actu');
const LOGIN = fs.readFileSync(path.join(PUB, 'login.html'), 'utf8');
{
  /* ⚠️ ON BORNE SUR `fetch(API`, PAS SUR UN TITRE DE COMMENTAIRE. La première écriture de ce banc
     cherchait « PHOTOS D'ACTU LIVE » — une chaîne qui apparaît DEUX fois, et dont la première
     occurrence est l'en-tête général de la mosaïque, dix mille caractères plus haut. Le contrôle
     regardait donc le mauvais bout de fichier et rougissait sur du code parfaitement correct. Un
     repère de banc doit être choisi pour son UNICITÉ, jamais pour sa lisibilité. */
  const i = LOGIN.indexOf('fetch(API');
  const bloc = i >= 0 ? LOGIN.slice(i, i + 1200) : '';
  t('le bloc des photos d\'actu existe', i >= 0 && LOGIN.indexOf('fetch(API', i + 1) < 0, 'repère non unique');
  t('il n\'appelle plus build()', i >= 0 && !/\bbuild\(\);/.test(bloc),
    'un build() subsiste : la mosaïque se videra encore');
  t('il remplace tuile par tuile', /remplacerParLesActus\(/.test(bloc));
}

/* ══ PHASE 2 — LA MOSAÏQUE, DANS UN VRAI NAVIGATEUR ═════════════════════════════════════════════ */
(async () => {
  console.log('\n[2] La mosaïque, dans un vrai navigateur');
  const bin = trouverNavigateur();
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { puppeteer = null; }
  if (!bin || !puppeteer) {
    console.log('  … navigateur absent → phase abstenue.');
    console.log('\n[Mosaïque] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
    process.exit(ko ? 1 : 0);
  }

  /* Une image PNG minuscule, servie telle quelle pour toutes les vignettes locales : le banc mesure
     le COMPORTEMENT de chargement, pas le poids des fichiers réels. */
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let distantesDemandees = 0;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/api/mosaic-images') {
      // 20 adresses « distantes » qui pointent en réalité vers ce banc, servies LENTEMENT.
      const live = Array.from({ length: 20 }, (_, i) => 'http://127.0.0.1:' + PORT + '/distante/' + i + '.png');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(live));
      return;
    }
    if (u.pathname.startsWith('/distante/')) {
      distantesDemandees++;
      // 400 ms chacune : c'est la lenteur d'un serveur de presse, celle qui vidait l'écran.
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PIXEL); }, 400);
      return;
    }
    if (/\.(png|jpe?g|webp|ico|svg)$/i.test(u.pathname)) {
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PIXEL); return;
    }
    if (u.pathname === '/login' || u.pathname === '/' || u.pathname === '/login.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(LOGIN); return;
    }
    const fp = path.join(PUB, u.pathname);
    if (fp.indexOf(PUB) === 0 && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      res.writeHead(200, { 'Content-Type': u.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
      res.end(fs.readFileSync(fp)); return;
    }
    res.writeHead(404).end();
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await nav.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://127.0.0.1:' + PORT + '/login', { waitUntil: 'domcontentloaded' });

    // Une tuile est « peinte » quand son image est complète ET porte de vraies dimensions.
    const compte = () => page.evaluate(() => {
      const imgs = [...document.querySelectorAll('.im-tile img')];
      const visible = imgs.filter(i => i.loading !== 'lazy');
      return {
        total: imgs.length,
        franches: visible.length,
        peintes: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
        peintesVisibles: visible.filter(i => i.complete && i.naturalWidth > 0).length,
        vides: imgs.filter(i => !i.getAttribute('src')).length,
      };
    });

    await new Promise(r => setTimeout(r, 700));
    const a = await compte();
    t('la mosaïque est bâtie', a.total > 20, a.total + ' tuile(s)');
    t('aucune tuile n\'est sans adresse', a.vides === 0, a.vides + ' tuile(s) sans src');
    /* ⚠️ CE QUI SE MESURE ICI, ET CE QUI NE SE MESURE PAS — À LIRE AVANT DE « RENFORCER » LE BANC.
       On ne peut PAS prouver au chronomètre, dans un navigateur sans tête, que le chargement
       paresseux retardait les tuiles : la marge de déclenchement y est si large que TOUT se charge
       de toute façon, et un banc qui servirait une image d'un octet depuis la boucle locale serait
       vert des deux côtés. Ce contrôle-là a été écrit une première fois ainsi, il ne prouvait rien,
       et il a fallu le casser exprès pour s'en apercevoir.
       La justification du changement est une MESURE, pas une intuition : ces vignettes pèsent 5 Ko
       (636 Ko pour les 80, en même origine). Il n'y avait rien à économiser, et le déclenchement se
       décide sur la position de mise en page, que le `transform` de la piste animée ne change pas.
       Ce qui SE vérifie ici, en revanche, est exactement ce qui compte au quotidien : la copie
       visible n'est plus déclarée paresseuse, et la copie de bouclage l'est toujours. */
    const paresse = await page.evaluate(() => {
      const par = [...document.querySelectorAll('.im-row-track')].map((p) => {
        const imgs = [...p.querySelectorAll('img')];
        const m = Math.floor(imgs.length / 2);
        return {
          visiblesParesseuses: imgs.slice(0, m).filter(i => i.loading === 'lazy').length,
          bouclageParesseuses: imgs.slice(m).filter(i => i.loading === 'lazy').length,
          moitie: m,
        };
      });
      return par;
    });
    t('aucune tuile VISIBLE n\'est en chargement paresseux',
      paresse.length > 0 && paresse.every(p => p.visiblesParesseuses === 0),
      JSON.stringify(paresse.map(p => p.visiblesParesseuses)));
    t('TÉMOIN — la copie de bouclage, elle, reste paresseuse',
      paresse.length > 0 && paresse.every(p => p.bouclageParesseuses === p.moitie),
      'la moitié qui ne sert qu\'à boucler charge pour rien : ' + JSON.stringify(paresse.map(p => p.bouclageParesseuses + '/' + p.moitie)));
    t('toutes les tuiles finissent peintes',
      a.franches > 0 && a.peintesVisibles === a.franches,
      a.peintesVisibles + ' peintes sur ' + a.franches + ' visibles');

    /* L'ÉPREUVE DE LA RECONSTRUCTION : on laisse arriver les photos « distantes » lentes, et on
       vérifie qu'AUCUNE tuile n'est jamais redevenue vide entre-temps. C'est la panne de la
       capture : l'écran se vidait au moment où les photos d'actu arrivaient. */
    let creuxMax = a.peintesVisibles;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 400));
      const c = await compte();
      if (c.peintesVisibles < creuxMax) creuxMax = c.peintesVisibles;
    }
    const b = await compte();
    t('les photos d\'actu ont bien été demandées', distantesDemandees > 0, distantesDemandees + ' demande(s)');
    t('aucune tuile n\'est retombée vide pendant leur arrivée',
      creuxMax === a.franches, 'creux mesuré : ' + creuxMax + ' peintes sur ' + a.franches);
    t('et la mosaïque est toujours complète à la fin',
      b.peintesVisibles === b.franches && b.vides === 0,
      b.peintesVisibles + '/' + b.franches + ', ' + b.vides + ' sans src');

    /* Les jumelles doivent porter la MÊME image : sinon la boucle du défilement montre une couture. */
    const couture = await page.evaluate(() => {
      let mauvaises = 0, paires = 0;
      document.querySelectorAll('.im-row-track').forEach((p) => {
        const imgs = [...p.querySelectorAll('img')];
        const m = Math.floor(imgs.length / 2);
        for (let i = 0; i < m; i++) { paires++; if (imgs[i].src !== imgs[i + m].src) mauvaises++; }
      });
      return { paires, mauvaises };
    });
    t('chaque tuile et sa jumelle portent la même image (boucle sans couture)',
      couture.paires > 0 && couture.mauvaises === 0,
      couture.mauvaises + ' paire(s) désaccordée(s) sur ' + couture.paires);
  } finally {
    await nav.close().catch(() => {});
    await new Promise(r => srv.close(r));
  }
  console.log('\n[Mosaïque] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
  process.exit(ko ? 1 : 0);
})();

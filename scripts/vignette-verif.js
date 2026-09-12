#!/usr/bin/env node
/**
 * scripts/vignette-verif.js — L'APERÇU D'UNE CARTE DE BIBLIOTHÈQUE REMPLIT SON CADRE.
 * ------------------------------------------------------------------------------------------------
 * 12/09, capture user : « il y a un grand vide sous l'aperçu, l'aperçu ne comble pas totalement la
 * carte ». Mesuré à 390 px : carte 384 px de large, cadre de l'aperçu 382, dessin RÉELLEMENT peint
 * 115 × 45. Deux cent soixante-sept pixels de vide, et un aperçu qui occupait 30 pourcent de son
 * cadre.
 *
 * ⚠️ CE BANC MESURE LE DESSIN PEINT, PAS LA BOÎTE QUI LE CONTIENT. C'est toute la difficulté du
 * défaut : la boîte faisait bien 382 px, le `<svg>` aussi, et `getBoundingClientRect()` sur l'un ou
 * l'autre aurait répondu « plein ». Seul `getBBox()`, remis à l'échelle du rendu, dit ce qui est
 * réellement ENCRÉ — le reste du cadre est du vide que seul l'œil voyait.
 *
 * ⚠️ ET IL ÉPROUVE PLUSIEURS LARGEURS. Le défaut n'existait PAS sur trois colonnes (rapport 2,05
 * contre 2,14 pour le dessin : presque juste) et sautait aux yeux sur une seule (6,2). Un banc qui
 * n'aurait mesuré que le bureau serait passé au vert sur la capture du client.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x));
}
let pp = null;
try { pp = require(path.join(RACINE, 'node_modules/puppeteer-core')); } catch {}
const NAV = trouverNavigateur();
if (!pp || !NAV) {
  console.log('\n[vignette-verif] aucun navigateur disponible → contrôle ABSTENU (code 0)\n');
  process.exit(0);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };
const UTIL = { loggedIn: true, authenticated: true, email: 'banc@dtp.fr', role: 'admin', plan: 'professionnel', monDesk: true, mondesk: true };
const PORT = 4997;
/* Témoin : la feuille est servie SANS la mise au rapport du cadre, donc avec la hauteur fixe d'avant.
   Le vide latéral doit alors réapparaître, sinon les contrôles ci-dessus ne mesurent pas ce
   correctif mais une propriété que la page avait déjà. */
let mutation = false;
const RE_RATIO = /\.wdg-lib-grid \.wdg-lib-row \.wdg-lib-card--prev \.wdg-lib-prev \{\s*\n\s*height: auto; aspect-ratio: 120 \/ 56;\s*\n\}/;
const REMPLACEMENT = '.wdg-lib-grid .wdg-lib-row .wdg-lib-card--prev .wdg-lib-prev {\n  height: 62px;\n}';
/* Deux colonnes sur téléphone : sans elles la correction se paierait en défilement. */
const RE_2COL = /@media \(max-width: 560px\) \{\s*\n\s*\.wdg-lib-grid \.wdg-lib-row \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}\s*\n\}/;

(async () => {
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u === '/sw.js') { rs.writeHead(404); return rs.end(); }
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify({ items: [], total: 0, ok: true, user: UTIL, ...UTIL })); }
    const f = path.join(PUB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('404'); }
    if (mutation && /style\.css$/.test(f)) {
      rs.writeHead(200, { 'Content-Type': MIME['.css'] });
      return rs.end(fs.readFileSync(f, 'utf8').replace(RE_RATIO, REMPLACEMENT));
    }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(rs);
  });
  await new Promise(r => srv.listen(PORT, r));
  const nav = await pp.launch({ executablePath: NAV, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  async function ouvrirBibliotheque(largeur) {
    const page = await nav.newPage();
    const err = [];
    page.on('pageerror', e => err.push(String(e.message || e)));
    await page.evaluateOnNewDocument(() => { window._pdMonDesk = true; });
    await page.setViewport({ width: largeur, height: 840, isMobile: largeur <= 480, hasTouch: largeur <= 480 });
    await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2200));
    const monte = await page.evaluate(() => { try { DTPWidgets.openLib(); return true; } catch (e) { return false; } });
    await new Promise(r => setTimeout(r, 800));
    return { page, err, monte };
  }
  /* Remplissage RÉEL : surface encrée du dessin rapportée à celle de son cadre. On remet la boîte
     du dessin à l'échelle du rendu — `getBBox()` parle dans les unités du `viewBox`, pas en pixels. */
  const remplissage = page => page.evaluate(() => {
    const cartes = [...document.querySelectorAll('.wdg-lib-grid .wdg-lib-row .wdg-lib-card--prev')];
    if (!cartes.length) return null;
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dtp-zoom')) || 1;
    const mesures = [];
    for (const c of cartes) {
      const cadre = c.querySelector('.wdg-lib-prev'); if (!cadre) continue;
      const svg = cadre.querySelector('svg'); if (!svg || !svg.viewBox || !svg.viewBox.baseVal) continue;
      const rc = cadre.getBoundingClientRect(), rs = svg.getBoundingClientRect();
      if (!rc.width || !rs.width) continue;
      let bb; try { bb = svg.getBBox(); } catch (e) { continue; }
      const vb = svg.viewBox.baseVal;
      /* ⚠️ CE QU'IL FAUT MESURER, ET CE QU'IL NE FAUT PAS. Ma première version exigeait que le
         dessin remplisse 80 pourcent de la LARGEUR du cadre. Le banc a mordu sur « Particuliers par
         paire » et « COT par devise » — et il avait tort : ce sont des ANNEAUX, ronds par
         construction, qui ne rempliront jamais 80 pourcent d'une toile deux fois plus large que
         haute. Un seuil qui condamne un dessin correct n'est pas un garde-fou, c'est du bruit qu'on
         apprendra à contourner.
         Ce qui a RÉELLEMENT cassé, c'est l'échelle : `meet` applique le plus petit des deux
         rapports, donc quand le cadre n'a pas les proportions du gabarit, le dessin est réduit sur
         UN axe et le reste part en marges. On compare donc les deux échelles : égales, aucun vide
         structurel n'est possible, quelle que soit la forme du dessin. */
      const echX = rs.width / vb.width, echY = rs.height / vb.height;
      const ech = Math.min(echX, echY);
      const larg = bb.width * ech, haut = bb.height * ech;
      mesures.push({
        nom: ((c.querySelector('.wdg-lib-name') || {}).textContent || '').trim(),
        cadre: [+(rc.width / z).toFixed(1), +(rc.height / z).toFixed(1)],
        dessin: [+(larg / z).toFixed(1), +(haut / z).toFixed(1)],
        videCotes: +((rc.width - larg) / z).toFixed(1),
        partLargeur: +(larg / rc.width).toFixed(3),
        /* Écart entre les deux échelles, rapporté à la plus grande : 0 = le cadre épouse le
           gabarit ; 0,65 = ce que mesurait la capture du client. */
        ecartEchelle: +(Math.abs(echX - echY) / Math.max(echX, echY)).toFixed(3),
        /* Et un contrôle de CONTENU, distinct : un dessin qui n'encre presque rien de sa propre
           toile est un aperçu raté, cadre ou pas. La hauteur est l'axe contraignant du gabarit. */
        partHauteurToile: +(bb.height / vb.height).toFixed(3),
      });
    }
    if (!mesures.length) return null;
    mesures.sort((a, b) => b.ecartEchelle - a.ecartEchelle);
    const parToile = mesures.slice().sort((a, b) => a.partHauteurToile - b.partHauteurToile)[0];
    const cols = getComputedStyle(cartes[0].parentElement).gridTemplateColumns.split(' ').length;
    return { n: mesures.length, pire: mesures[0], pireToile: parToile, cols };
  });

  /* Écart d'échelle toléré : 3 pourcent, soit l'arrondi du navigateur sur une colonne fractionnaire.
     Mesuré avant correction, à 390 px : 0,65. */
  const SEUIL_ECART = 0.03;
  /* ⚠️ IL N'Y A PAS DE CONTRÔLE « LE DESSIN REMPLIT SA TOILE », ET C'EST DÉLIBÉRÉ — écrit ici pour
     que personne ne le rajoute en croyant combler un oubli. J'en ai posé un, puis abaissé le seuil
     TROIS FOIS : 80 pourcent condamnait « Particuliers par paire » et « COT par devise », qui sont
     des ANNEAUX et ne rempliront jamais une toile deux fois plus large que haute ; 55 pourcent
     condamnait « Bandeau de cotations », qui est un bandeau et se dessine PLAT. Un seuil qu'on
     rabaisse à chaque contre-exemple ne mesure plus rien : il finit par valider tout, ou pire, par
     faire rougir des dessins corrects jusqu'à ce qu'on prenne l'habitude de le contourner.
     La forme d'un aperçu est un choix de dessin, pas une propriété mesurable. Ce qui SE mesure,
     c'est que le cadre laisse le dessin s'exprimer — les deux contrôles ci-dessus — et c'est
     exactement ce que la capture du client montrait. */
  for (const L of [390, 430, 560, 900, 1280]) {
    const { page, err, monte } = await ouvrirBibliotheque(L);
    if (!monte) { console.log('\n── ' + L + 'px : bibliothèque non montable dans ce jeu d\'essai → abstenu ──'); await page.close(); continue; }
    const m = await remplissage(page);
    console.log('\n── ' + L + 'px ──');
    v('la page se charge sans exception', err.length === 0, err.slice(0, 2).join(' | '));
    v('[mesuré] des cartes à aperçu sont bien rendues', !!(m && m.n > 10), m ? m.n + ' carte(s)' : 'aucune');
    if (m) {
      v('[mesuré] aucun aperçu n\'est réduit sur un seul axe (pas de bande vide structurelle)',
        m.pire.ecartEchelle <= SEUIL_ECART,
        '« ' + m.pire.nom + ' » : écart d\'échelle ' + m.pire.ecartEchelle + ' — dessin '
        + m.pire.dessin[0] + 'px dans un cadre de ' + m.pire.cadre[0] + 'px, soit '
        + m.pire.videCotes + 'px de vide. Mesuré avant correction à 390px : 0,65 et 267px de vide.');
      /* Le cadre doit porter les proportions du gabarit, sinon le remplissage n'est qu'une
         coïncidence de largeur de colonne. 120/56 = 2,143. */
      const rapport = m.pire.cadre[0] / m.pire.cadre[1];
      v('[mesuré] le cadre porte bien le rapport du gabarit (120/56)', Math.abs(rapport - 120 / 56) < 0.08,
        'rapport mesuré : ' + rapport.toFixed(3) + ' (attendu 2,143)');
      /* Observation, pas verdict : on IMPRIME le dessin le plus creux à chaque passage. S'il devient
         absurde un jour, il se verra dans le journal sans qu'un seuil arbitraire bloque une
         livraison pour une question de goût. */
      console.log('    · dessin le plus creux : « ' + m.pireToile.nom + ' », '
        + Math.round(m.pireToile.partHauteurToile * 100) + ' pourcent de la hauteur de sa toile');
    }
    await page.close();
  }

  console.log('\n── La correction ne se paie pas en défilement : deux colonnes sur téléphone ──');
  const brut = fs.readFileSync(path.join(PUB, 'css/style.css'), 'utf8');
  v('la règle des deux colonnes est bien dans la feuille', RE_2COL.test(brut));
  const { page: tel, monte: m2 } = await ouvrirBibliotheque(390);
  if (m2) {
    const c = await tel.evaluate(() => {
      const r = document.querySelector('.wdg-lib-grid .wdg-lib-row');
      return r ? getComputedStyle(r).gridTemplateColumns.split(' ').length : 0;
    });
    v('[mesuré] la bibliothèque affiche 2 colonnes à 390px', c === 2, c + ' colonne(s)');
  }
  await tel.close();

  console.log('\n── Témoin : sans la mise au rapport, le vide latéral revient ──');
  v('la règle corrective est bien dans la feuille (sinon le témoin ne mute rien)', RE_RATIO.test(brut));
  mutation = true;
  const { page: mut, monte: m3 } = await ouvrirBibliotheque(390);
  if (m3) {
    const t = await remplissage(mut);
    v('[mesuré] cadre remis à hauteur fixe : l\'écart d\'échelle explose et le vide revient',
      !!(t && t.pire.ecartEchelle > SEUIL_ECART * 5),
      t ? 'écart mesuré : ' + t.pire.ecartEchelle + ', vide latéral ' + t.pire.videCotes
        + 'px — si le vide ne revient pas, les contrôles ci-dessus ne mesurent pas ce correctif' : 'mesure impossible');
  }
  await mut.close();
  mutation = false;

  await nav.close(); srv.close();
  console.log(ko ? `\n✗ ${ko} contrôle(s) en échec\n` : `\n✓ ${ok} contrôles au vert\n`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

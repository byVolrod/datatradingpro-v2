#!/usr/bin/env node
/**
 * reaction-verif.js — LE GRAPHIQUE DE RÉACTION COUVRE-T-IL L'HEURE DE LA PUBLICATION ?
 * ------------------------------------------------------------------------------------------------
 * 29/08, capture à l'appui : « Réaction indisponible : les cotations à la minute ne couvrent plus
 * l'heure de cette publication », sur un chiffre australien de 04:00 regardé à 11:08. Sept heures,
 * pas sept jours — la donnée existait.
 *
 * LA CAUSE. `/api/react-ohlc` demande d'abord une journée de bougies d'une minute, et se rabat sur
 * cinq jours si la réponse est maigre. Ce repli, posé un dimanche pour les week-ends sans séance, ne
 * regardait que le NOMBRE de bougies. Or le fournisseur peut très bien rendre une séance entière —
 * plusieurs centaines de bougies, le compte est donc largement dépassé — qui COMMENCE APRÈS
 * l'instant demandé. Le garde-fou passait, le repli n'était jamais tenté, et le lecteur voyait le
 * message d'indisponibilité alors qu'une seconde requête aurait suffi.
 *
 * Ce contrôle éprouve la règle de couverture sur le VRAI code extrait de server.js, et vérifie que
 * la route s'en sert. Calcul pur : aucun réseau, aucun navigateur.
 *
 *   node scripts/reaction-verif.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const PORT = 4827;

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

const D = SRV.indexOf('function _reactCouvre(candles, t0) {');
if (D < 0) { console.log('\n  ✗ _reactCouvre introuvable dans server.js\n'); process.exit(1); }
const couvre = new Function(SRV.slice(D, SRV.indexOf('\n}\n', D) + 3) + '\nreturn _reactCouvre;')();

const MIN = 60e3;
const serie = (debut, n) => Array.from({ length: n }, (_, i) => ({ t: debut + i * MIN, c: 1 }));
const T0 = Date.UTC(2026, 7, 26, 2, 0, 0);          // 04:00 à Paris = 02:00 UTC, l'heure de la capture

console.log('\n── 1. « Couvrir » veut dire ENCADRER l\'instant, pas « avoir des bougies » ──');
v('une séance qui encadre l\'instant le couvre', couvre(serie(T0 - 60 * MIN, 180), T0) === true);
/* LE CAS DE LA CAPTURE, ET IL EST CONTRE-INTUITIF : 400 bougies, largement plus que le seuil de 8
   du garde-fou d'origine — et pas une seule avant l'instant demandé. C'est exactement ce que le
   compte ne pouvait pas voir. */
v('400 bougies qui commencent APRÈS l\'instant ne le couvrent PAS', couvre(serie(T0 + 30 * MIN, 400), T0) === false,
  'c\'est le cas de la capture : le compte passe, la couverture non');
v('une séance qui se termine AVANT l\'instant ne le couvre pas non plus', couvre(serie(T0 - 600 * MIN, 400), T0) === false);
v('une bougie pile sur l\'instant suffit', couvre([{ t: T0, c: 1 }], T0) === true);
v('une série vide ne couvre rien', couvre([], T0) === false);
v('sans instant demandé, on n\'affirme rien et on ne déclenche pas de repli', couvre([], 0) === true,
  'répondre « non » ferait une requête de plus sur une question qu\'on n\'a pas posée');
v('une bougie sans horodatage ne compte pas', couvre([{ c: 1 }, { t: null, c: 1 }], T0) === false);

console.log('\n── 2. La route s\'en sert, et au bon endroit ──');
/* Le repli DOIT tester la couverture en plus du compte : c'est la moitié qui manquait. Et il ne doit
   remplacer la série que si le repli fait MIEUX — couvrir prime sur être plus long, sinon une
   réponse plus longue mais toujours décalée écraserait une réponse courte mais juste. */
v('le repli 5 jours se déclenche aussi sur un défaut de couverture',
  /if \(\(candles\.length < 8 \|\| !_reactCouvre\(candles, t0\)\) && range === '1d'\)/.test(SRV));
v('… et ne remplace que si le repli couvre mieux',
  /const mieux = \(_reactCouvre\(c2, t0\) && !_reactCouvre\(candles, t0\)\) \|\| c2\.length > candles\.length;/.test(SRV));
v('l\'instant demandé est lu une seule fois, en tête de route', /const t0 = parseInt\(req\.query\.ts, 10\) \|\| 0;/.test(SRV));
v('la réponse dit si elle couvre l\'instant', /couvre: _reactCouvre\(candles, t0\)/.test(SRV),
  'le client peut ainsi distinguer « pas de donnée » de « donnée décalée »');

console.log('\n── 3. Le message du client reste honnête ──');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
/* Le message n'est pas un bug : quand la donnée n'existe vraiment pas, il faut le dire. Ce qui était
   faux, c'est qu'il s'affichait alors qu'elle existait. On vérifie qu'il est toujours là — un
   graphique vide sans explication serait pire. */
v('le client explique l\'absence au lieu d\'afficher un cadre vide',
  /Réaction indisponible : les cotations à la minute ne couvrent plus l\\?'heure de cette publication\./.test(APP));
v('… et il vérifie lui aussi que la série précède la publication', /!brut\.some\(c => c\.t <= t0\)/.test(APP));

/* ══ 2. LE REPÈRE, DANS UN VRAI GRAPHIQUE, ET DANS LES PIXELS RÉELLEMENT PEINTS ══════════════════
   31/08, capture : « le trait rouge est pas bien et le cercle trop petit par rapport à la bougie ».
   Deux défauts qu'aucune lecture de code ne tranche — ce sont des pixels. On sert la page, on charge
   la VRAIE bibliothèque (elle est dans le dépôt, pas sur un CDN), on exécute le VRAI
   `_dessinerReaction` extrait d'app.js, on photographie, ET ON RELIT LES PIXELS.

   ⚠️ DEUX PIÈGES, LES DEUX RENCONTRÉS EN ÉCRIVANT CE BANC :
     · LE STYLE CALCULÉ NE PROUVE PAS QUE C'EST PEINT. La première version se contentait de lire
       `background-image` sur le trait : elle serait restée verte devant un trait invisible. On relit
       donc la COLONNE de pixels, en cherchant à la fois un tiret (une couleur nettement au-dessus du
       fond) et un intervalle (la couleur du fond) — sans quoi un trait plein passerait pour tireté.
     · IL FAUT ATTENDRE QUE LA BIBLIOTHÈQUE AIT FINI. `placer()` est rappelé quand l'échelle de temps
       se stabilise : le repère se déplace APRÈS la construction. Mesuré : x = 535 juste après
       l'appel, x = 414 une fois posé — 121 px d'écart. Une sonde qui mesure trop tôt lit la colonne
       d'à côté et conclut que rien n'est peint. */
function phaseRepere() {
  return new Promise((resolve) => {
    let puppeteer;
    try { puppeteer = require('puppeteer-core'); }
    catch { console.log('\n  · puppeteer-core absent → phase navigateur abstenue.'); return resolve(); }
    const cand = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
      try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) cand.push(path.join(b, d, r)); } catch {}
    }
    const exe = cand.find(x => x && fs.existsSync(x));
    if (!exe) { console.log('\n  · aucun Chromium → phase navigateur abstenue.'); return resolve(); }

    const PUB = path.join(RACINE, 'public');
    const MIME = { '.js': 'text/javascript', '.css': 'text/css' };
    const srv = http.createServer((rq, rs) => {
      const f = path.join(PUB, rq.url.split('?')[0].replace(/^\/+/, ''));
      if (!f.startsWith(PUB) || !fs.existsSync(f)) { rs.writeHead(404); return rs.end('404'); }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
      fs.createReadStream(f).pipe(rs);
    }).listen(PORT);

    (async () => {
      let nav = null;
      try {
        // Le VRAI `_dessinerReaction`, découpé dans app.js : une copie resterait verte le jour où
        // l'original changerait.
        const d = APP.indexOf('function _dessinerReaction(hote, candles, t0, paire) {');
        const f = APP.indexOf('\n}\n', d);
        v('_dessinerReaction est extractible d\'app.js', d >= 0 && f > d);
        if (d < 0 || f < 0) return;
        /* ⚠️ LE REGISTRE PART AVEC LA FONCTION, ET CE N'EST PAS UN DÉTAIL DE PLOMBERIE. Le banc
           posait ici trois variables `_rxChart / _rxObs / _rxTimer` de son cru pour que le code
           extrait s'exécute : il fabriquait donc lui-même le mécanisme qu'il était censé éprouver.
           Le 04/09, ces trois variables SE SONT RÉVÉLÉES ÊTRE LE DÉFAUT (une seule place pour tout
           le desk, donc un deuxième panneau détruisait le premier) — et le banc, en les recréant,
           n'aurait rien pu voir. On extrait désormais le VRAI registre d'app.js, comme la fonction. */
        const r0 = APP.indexOf('const _rxVivants = new Map();');
        v('le registre des graphiques vivants est extractible d\'app.js', r0 >= 0 && r0 < d,
          'sans lui, le banc recréerait lui-même le mécanisme qu\'il éprouve');
        if (r0 < 0 || r0 >= d) return;
        /* ⚠️ `const` DÉCLARÉ DANS UN `eval` INDIRECT VA DANS L'ENVIRONNEMENT LEXICAL GLOBAL, que
           `page.evaluate` ne voit pas depuis son propre monde (les `function`, elles, atterrissent
           sur l'objet global et restent visibles). La référence au registre est donc publiée DANS
           le source évalué, seul endroit d'où elle soit atteignable. */
        const SRC = APP.slice(r0, d) + APP.slice(d, f + 2)
          + '\nfunction _deskLight(){return false;}'
          + '\nwindow._rxRef = _rxVivants;';

        nav = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

        /* Le jeu d'essai reproduit le cas de la capture : une séance ordinaire, puis UNE bougie de
           publication dont l'amplitude décroche. `amp0` la règle — c'est ce qui permet d'éprouver
           que le cercle SUIT la bougie au lieu d'être simplement « plus grand qu'avant ». */
        const dessiner = async (amp0, decalMin, finK) => {
          const page = await nav.newPage();
          await page.setViewport({ width: 1000, height: 420, deviceScaleFactor: 1 });
          await page.setContent('<html data-theme="dark"><head>'
            + '<link rel="stylesheet" href="http://localhost:' + PORT + '/css/style.css">'
            + '<script src="http://localhost:' + PORT + '/js/vendor/lightweight-charts-4.2.3.js"></script>'
            + '</head><body style="margin:20px;background:#0c0c0e"><div class="nrx-lwc" id="g" style="width:940px"></div></body></html>',
            { waitUntil: 'networkidle0' });
          await page.evaluate((src, a0, dm, fk) => {
            const T0 = Date.UTC(2026, 7, 26, 12, 38, 0); const c = []; let px = 1.1680;
            for (let k = -60; k <= (fk == null ? 60 : fk); k++) {
              const amp = (k === 0) ? a0 : 0.00035;
              px += Math.sin(k / 7) * 0.00012;
              c.push({ t: T0 + k * 60000, o: px, h: px + amp / 2, l: px - amp / 2, c: px + amp / 6 });
            }
            eval(src);
            _dessinerReaction(document.getElementById('g'), c, T0 + (dm || 0) * 60000, 'EUR/USD');
          }, SRC, amp0, decalMin, finK);
          // ⚠️ Attendre la POSE définitive du repère (cf. le piège décrit plus haut).
          await page.evaluate(() => new Promise(r => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 300)));
          const geo = await page.evaluate(() => {
            const b = document.querySelector('.nrx-vline').getBoundingClientRect();
            const r = document.querySelector('.nrx-rond').getBoundingClientRect();
            const g = document.getElementById('g').getBoundingClientRect();
            const cs = getComputedStyle(document.querySelector('.nrx-vline'));
            const cr = getComputedStyle(document.querySelector('.nrx-rond'));
            return { lx: b.x, ly: b.y, lh: b.height, rond: { x: r.x, y: r.y, w: r.width, h: r.height },
              cadre: { y: g.y, h: g.height }, bordTrait: cs.borderLeftStyle, fondTrait: cs.backgroundImage,
              bordRond: cr.borderTopColor, fondRond: cr.backgroundColor,
              visible: getComputedStyle(document.querySelector('.nrx-cible')).display };
          });
          const png = await page.screenshot({ encoding: 'base64' });
          await page.close();
          // La lecture des pixels se fait dans une page NEUTRE : on y décode l'image et on
          // échantillonne la colonne du trait, au-dessus du cercle (là où rien d'autre ne peint).
          const lec = await nav.newPage();
          await lec.setContent('<html><body></body></html>');
          const col = await lec.evaluate(async (b64, x, y0, y1) => {
            const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
            const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
            const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
            const out = [];
            for (let y = Math.ceil(y0); y < Math.floor(y1); y++) {
              const p = cx.getImageData(Math.round(x), y, 1, 1).data;
              out.push([p[0], p[1], p[2]]);
            }
            return out;
          }, png, geo.lx, geo.ly + 2, Math.min(geo.rond.y - 4, geo.ly + 70));
          await lec.close();
          return { geo, col };
        };

        /* ══ 24/09 (capture user : « le cercle est souvent décalé, il doit être sur la grande bougie
           verte, c'est la bougie de l'annonce éco ») ══ Une analyse sort ~11 min après la décision ;
           le flux a ~10 min de retard. Avant : le repère tombait sur la DERNIÈRE bougie connue. */
        console.log('\n── 1 ter. Le cercle se pose sur la bougie de l\'ANNONCE, pas sur l\'heure de la dépêche ──');
        const cx = g => g.geo.rond.x + g.geo.rond.w / 2;
        const ref = await dessiner(0.0020, 0, 6);           // repère posé à l'heure exacte de l'annonce
        const tard = await dessiner(0.0020, 11, 6);         // dépêche 11 min après, flux arrêté à +6 min
        v('dépêche 11 min après l\'annonce, flux en retard : le cercle est sur la bougie de l\'annonce',
          Math.abs(cx(ref) - cx(tard)) <= 2, 'annonce x=' + Math.round(cx(ref)) + ' · dépêche x=' + Math.round(cx(tard)));
        const ref60 = await dessiner(0.0020, 0, 60);         // même jeu de bougies (flux complet), même échelle
        const flash = await dessiner(0.0020, 2, 60);        // flash 2 min après le chiffre
        v('flash 2 min après le chiffre, flux complet : même bougie que l\'annonce', Math.abs(cx(ref60) - cx(flash)) <= 2,
          'annonce x=' + Math.round(cx(ref60)) + ' · flash x=' + Math.round(cx(flash)));
        const calme = await dessiner(0.00035, 11, 6);       // séance sans impulsion : rien à désigner
        v('(témoin) séance calme : aucune bougie d\'annonce inventée, le repère reste en bout de flux',
          cx(calme) - cx(ref) > 20, 'calme x=' + Math.round(cx(calme)) + ' · annonce x=' + Math.round(cx(ref)));

        console.log('\n── 2. Le repère de publication, mesuré dans un vrai graphique ──');
        const gros = await dessiner(0.0020);
        v('le repère est visible', gros.geo.visible !== 'none', String(gros.geo.visible));

        /* LE TRAIT, DANS LES PIXELS. Un `border: 1px dashed` rend des tirets d'UN pixel sous Chrome :
           un pointillé grésillant, et c'est ce que montrait la capture. Le motif est désormais écrit
           au pixel près. On exige les deux moitiés du motif : des pixels clairement au-dessus du
           fond (les tirets) ET des pixels au niveau du fond (les intervalles). */
        const FOND = 15 + 15 + 18;                       // la couleur de fond du cadre, en somme RVB
        const som = p => p[0] + p[1] + p[2];
        const tiretsPx = gros.col.filter(p => som(p) > FOND + 120);
        const creux = gros.col.filter(p => som(p) <= FOND + 20).length;
        v('le trait est réellement PEINT (pas seulement dans la feuille)', tiretsPx.length >= 4,
          tiretsPx.length + ' pixel(s) de tiret sur ' + gros.col.length + ' relus');
        v('… et il est bien TIRETÉ, pas plein', creux >= 4, creux + ' pixel(s) d\'intervalle');
        v('… sans passer par un `border: dashed` (tirets d\'un pixel sous Chrome)', gros.geo.bordTrait === 'none',
          'style de bordure : ' + gros.geo.bordTrait);
        /* ⚠️ LA COULEUR SE LIT DANS LES PIXELS, PAS DANS LA PROPRIÉTÉ. Éprouvée sur
           `background-image`, l'assertion rendait 'none' — donc VERTE — dès qu'on repassait à une
           bordure rouge : elle validait exactement le défaut qu'elle surveille. Un tiret neutre a
           ses trois canaux voisins ; un tiret rouge a son canal R très au-dessus du bleu. */
        const rouges = tiretsPx.filter(p => p[0] - p[2] > 40).length;
        v('… et il n\'est plus rouge : le rouge est la couleur du repère', tiretsPx.length > 0 && rouges === 0,
          rouges + ' tiret(s) à dominante rouge · échantillon ' + JSON.stringify(tiretsPx[0] || null));
        v('le cercle, lui, garde le rouge', /rgba?\(\s*239/.test(gros.geo.bordRond) || /rgba?\(\s*239/.test(gros.geo.fondRond),
          gros.geo.bordRond + ' / ' + gros.geo.fondRond);

        /* LE CERCLE. 46 px FIXES, c'était la valeur d'avant : sur une bougie de publication — celle
           qui décroche, tout l'objet du panneau — il se retrouvait DEDANS. */
        v('le cercle n\'est plus figé à 46 px', Math.round(gros.geo.rond.w) > 50, Math.round(gros.geo.rond.w) + ' px');
        v('… il est rond', Math.abs(gros.geo.rond.w - gros.geo.rond.h) <= 1, gros.geo.rond.w + '×' + gros.geo.rond.h);
        v('… et il ne mange pas le cadre', gros.geo.rond.w <= gros.geo.cadre.h * .66,
          Math.round(gros.geo.rond.w) + ' px pour un cadre de ' + Math.round(gros.geo.cadre.h));

        /* LA PROPRIÉTÉ, ET NON UNE VALEUR : le diamètre SUIT la bougie. Un cercle simplement agrandi
           passerait les contrôles ci-dessus tout en restant faux sur la bougie suivante. */
        const petit = await dessiner(0.00040);
        v('sur une bougie ordinaire, le cercle reprend sa petite taille',
          petit.geo.rond.w < gros.geo.rond.w * .7,
          Math.round(petit.geo.rond.w) + ' px contre ' + Math.round(gros.geo.rond.w) + ' px sur la grande bougie');
        /* Le plancher se mesure là où il SERT : une bougie plate. 46 px déclarés valent ~41 px à
           l'écran, le desk appliquant un zoom de page de 90 %. */
        const plat = await dessiner(0);
        v('une bougie plate garde un repère visible (le plancher)', plat.geo.rond.w >= 40,
          Math.round(plat.geo.rond.w) + ' px à l\'écran pour 46 px déclarés');

        /* LA LIGNE DE « DERNIER PRIX » DE LA BIBLIOTHÈQUE : rouge, horizontale, sur toute la largeur,
           avec son étiquette sur l'axe — et sans aucun sens sur une fenêtre passée. */
        v('la ligne de dernier prix de la bibliothèque est coupée',
          /lastValueVisible: false, priceLineVisible: false,/.test(APP),
          'sans elle, un second trait rouge court sur toute la largeur');

        /* ══ 3. DEUX PANNEAUX OUVERTS EN MÊME TEMPS (04/09, capture utilisateur) ═══════════════
           SIGNALEMENT : « je peux pas ouvrir les 2 en même temps ». Sur la capture, deux
           publications de 14 h 30 ont leur panneau ouvert : celle du bas montre ses bougies, celle
           du HAUT est un rectangle noir où ne survivent que le trait en pointillé et le rond rouge.

           CE QUE MESURE CE CONTRÔLE, ET POURQUOI PAS AUTRE CHOSE. La bibliothèque pose ses canevas
           DANS l'hôte ; son `remove()` les retire, mais laisse le calque `.nrx-cible` que nous
           posons nous-mêmes avant elle — d'où le cadre vide surmonté d'un repère, exactement la
           capture. On compte donc les canevas de CHAQUE hôte après avoir dessiné dans les deux.
           Lire un état interne (une variable, une taille de registre) n'aurait rien dit du canevas
           réellement présent, qui est ce que le client regarde.
           ⚠️ ET LA CONTREPARTIE EST ÉPROUVÉE DANS LA FOULÉE. Le nettoyage global était juste dans
           son intention : sans lui, chaque ouverture laisserait un graphique et un observateur
           derrière elle. Redessiner DEUX FOIS dans le même hôte ne doit donc pas empiler deux jeux
           de canevas. Sans ce second contrôle, « supprimer le nettoyage » passerait le premier. */
        console.log('\n── 3. Deux panneaux ouverts en même temps ──');
        const duo = await (async () => {
          const page = await nav.newPage();
          await page.setViewport({ width: 1000, height: 900, deviceScaleFactor: 1 });
          await page.setContent('<html data-theme="dark"><head>'
            + '<link rel="stylesheet" href="http://localhost:' + PORT + '/css/style.css">'
            + '<script src="http://localhost:' + PORT + '/js/vendor/lightweight-charts-4.2.3.js"></script>'
            + '</head><body style="margin:20px;background:#0c0c0e">'
            + '<div class="nrx-lwc" id="a" style="width:900px"></div>'
            + '<div class="nrx-lwc" id="b" style="width:900px"></div>'
            + '</body></html>', { waitUntil: 'networkidle0' });
          const compter = () => page.evaluate(() => ({
            a: document.querySelectorAll('#a canvas').length,
            b: document.querySelectorAll('#b canvas').length,
            cibleA: !!document.querySelector('#a .nrx-cible'),
            vivants: window._rxRef ? window._rxRef.size : -1,
          }));
          await page.evaluate((src) => {
            const T0 = Date.UTC(2026, 7, 26, 12, 38, 0); const c = []; let px = 1.1680;
            for (let k = -60; k <= 60; k++) {
              px += Math.sin(k / 7) * 0.00012;
              c.push({ t: T0 + k * 60000, o: px, h: px + 0.0002, l: px - 0.0002, c: px + 0.00005 });
            }
            /* ⚠️ `eval` DIRECT DÉCLARE DANS LA PORTÉE LOCALE DU RAPPEL, et cette phase-ci appelle
               `_dessinerReaction` depuis un AUTRE rappel — il faut donc la portée globale. L'appel
               indirect `(0, eval)` l'obtient ; l'`eval` direct rendait « _dessinerReaction is not
               defined » au deuxième panneau. */
            (0, eval)(src);
            window._jeu = c; window._T0 = T0;
            _dessinerReaction(document.getElementById('a'), c, T0, 'EUR/USD');
          }, SRC);
          await page.evaluate(() => new Promise(r => setTimeout(r, 250)));
          const seul = await compter();
          // LE SECOND PANNEAU : c'est son ouverture qui effaçait le premier.
          await page.evaluate(() => { _dessinerReaction(document.getElementById('b'), window._jeu, window._T0, 'EUR/USD'); });
          await page.evaluate(() => new Promise(r => setTimeout(r, 250)));
          const deux = await compter();
          // LA CONTREPARTIE : rouvrir le MÊME panneau ne doit rien empiler.
          await page.evaluate(() => { _dessinerReaction(document.getElementById('a'), window._jeu, window._T0, 'EUR/USD'); });
          await page.evaluate(() => new Promise(r => setTimeout(r, 250)));
          const redessine = await compter();
          await page.close();
          return { seul, deux, redessine };
        })();

        v('un premier panneau seul peint bien ses canevas', duo.seul.a >= 1,
          duo.seul.a + ' canevas dans le premier hôte');
        /* LE CONTRÔLE QUI PORTE LE SIGNALEMENT. */
        v('ouvrir un SECOND panneau n\'efface pas le premier', duo.deux.a >= 1 && duo.deux.b >= 1,
          'premier hôte : ' + duo.deux.a + ' canevas · second : ' + duo.deux.b
            + (duo.deux.a === 0 && duo.deux.cibleA ? ' — le cadre noir surmonté du repère, exactement la capture' : ''));
        v('… et les deux graphiques sont bien deux, pas un partagé', duo.deux.vivants === 2,
          duo.deux.vivants + ' graphique(s) au registre');
        v('rouvrir le MÊME panneau ne l\'empile pas (le nettoyage reste)',
          duo.redessine.a === duo.seul.a && duo.redessine.vivants === 2,
          duo.redessine.a + ' canevas dans le premier hôte (contre ' + duo.seul.a
            + ' à l\'origine) · ' + duo.redessine.vivants + ' au registre');
      } catch (e) {
        v('la phase navigateur s\'exécute', false, e.message);
      } finally {
        if (nav) try { await nav.close(); } catch {}
        srv.close();
        resolve();
      }
    })();
  });
}

function fin() {
  console.log('');
  if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
  console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');
  process.exit(0);
}
phaseRepere().then(fin, e => { v('la phase du repère se termine', false, e.message); fin(); });

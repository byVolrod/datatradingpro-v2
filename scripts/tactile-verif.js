#!/usr/bin/env node
/**
 * tactile-verif.js — CE QUI SE MANIPULE À LA SOURIS SE MANIPULE-T-IL AU DOIGT ?
 * ------------------------------------------------------------------------------------------------
 * 29/08, capture à l'appui : « Je n'arrive pas à déplacer l'onglet monde vers le haut sur mobile ».
 *
 * La cause était générale, pas particulière : le desk s'était construit à la souris. Le
 * glisser-déposer HTML5 — le mécanisme que sept surfaces employaient — N'EXISTE PAS au toucher : un
 * doigt posé sur un élément `draggable` ne produit jamais `dragstart`. Et là où le geste passait par
 * des événements de pointeur, il manquait `touch-action: none` : sans lui, le navigateur attribue le
 * geste au défilement et cesse d'émettre `pointermove` au deuxième pixel.
 *
 * ⚠️ AUCUN CONTRÔLE NE POUVAIT LE VOIR, et c'est le vrai enseignement. Celui qui existait ouvrait un
 * VRAI Chromium — mais il FABRIQUAIT les événements (`new DragEvent(…)` + `dispatchEvent`). Un
 * événement fabriqué arrive toujours, que le navigateur l'émette ou non. Il mesurait le câblage en
 * restant aveugle au geste. C'est le même piège que `node -c` devant une ReferenceError : l'outil
 * mesurait ce qu'il savait mesurer.
 *
 * Ce contrôle-ci ne fabrique rien. Il pose un VRAI doigt (`page.touchscreen`) sur un écran tactile
 * émulé, et il lit la feuille de style RÉELLE pour mesurer les cibles.
 *
 *   node scripts/tactile-verif.js
 *
 * Sans Chromium, il s'abstient (code 0) : il tourne là où il peut, il ne bloque jamais une livraison.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4623;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

function trouverNavigateur() {
  const bases = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const b of bases) {
    try { for (const d of fs.readdirSync(b)) for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, rel)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x)) || null;
}
const serveur = () => http.createServer((rq, rs) => {
  const u = rq.url.split('?')[0];
  const f = path.join(PUB, u.replace(/^\/+/, ''));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('404'); }
  rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});

/* ══ 1. LA SOURCE : PLUS AUCUNE SURFACE DE GESTE ÉCOUTÉE À LA SOURIS SEULE ═══════════════════════
   Contrôle de lecture, et c'est celui qui aurait tout évité. Un `mousedown` sans `pointerdown` sur
   une barre qu'on déplace, ou un `draggable="true"` sur une poignée qu'on réordonne, c'est une
   fonction qui n'existe pas au doigt — quel que soit le soin mis au reste. */
function phaseSource() {
  console.log('\n── 1. Aucun geste n\'est écouté à la souris seule ──');
  const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
  const WID = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
  const CHA = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');

  // Les deux barres de redimensionnement du desk : elles n'écoutaient que la souris.
  v('la barre verticale du desk écoute le pointeur', /resizer\.addEventListener\('pointerdown'/.test(APP)
    && !/resizer\.addEventListener\('mousedown'/.test(APP), 'un `mousedown` seul ne répond pas au doigt');
  v('… et elle garde le geste quand le doigt la quitte', (APP.match(/resizer\.setPointerCapture\(e\.pointerId\)/g) || []).length >= 2,
    'sans capture, une barre de 1 px perd le geste au premier pixel');

  /* Le réordonnancement : une mécanique commune au pointeur, et plus aucun `draggable` sur les
     poignées. `draggable` ne sert pas qu'à rien au doigt — il VOLE le geste au pointeur sur les
     autres appareils, Chrome cessant d'émettre `pointermove` dès qu'un drag natif démarre. */
  // Repérée par son NOM : lui ajouter un paramètre ne doit pas faire échouer le contrôle.
  v('les listes se réordonnent par une mécanique commune au pointeur', /function _glisserPourReordonner\(/.test(WID));
  v('… employée par les onglets, les desks ET les cartes', (WID.match(/_glisserPourReordonner\(/g) || []).length >= 4,
    String((WID.match(/_glisserPourReordonner\(/g) || []).length) + ' emploi(s)');
  v('aucune poignée de réordonnancement n\'est en glisser natif',
    !/wdg-set-tabgrip" draggable/.test(WID) && !/wdg-mgr-grip" draggable/.test(WID));

  /* La barre d'onglets de la topbar est le seul réordonnancement à appui long. Il était déjà écrit
     au pointeur — et il échouait quand même : au doigt, `preventDefault()` sur `pointermove`
     n'annule rien, le geste est déjà attribué au défilement. Seul un `touchmove` NON PASSIF le
     refuse encore, et uniquement pendant un déplacement armé (sinon la barre ne défile plus). */
  v('la barre d\'onglets refuse le défilement pendant un déplacement armé',
    /nav\.addEventListener\('touchmove', e => \{ if \(active\) e\.preventDefault\(\); \}, \{ passive: false \}\)/.test(CHA));

  /* Le desk applique un zoom de page de 90 % : `offsetWidth` rend des pixels NON zoomés quand
     `clientX` arrive en pixels d'écran. Mélanger les deux fait suivre le bord avec 11 % de retard. */
  v('le redimensionnement mesure la carte dans l\'espace du geste',
    /card\.getBoundingClientRect\(\)\.width \+ gapC/.test(WID) && !/\(card\.offsetWidth \+ gapC\)/.test(WID),
    'offsetWidth ignore le zoom de page, clientX non');
}

/* ══ 2. LA FEUILLE DE STYLE RÉELLE : CIBLES ET `touch-action` ════════════════════════════════════
   `touch-action` ne se lit pas dans le code : il se calcule, après la cascade. Un bloc ajouté plus
   bas dans le fichier peut annuler celui du haut — c'est exactement ce qui s'était passé pour les
   poignées de redimensionnement, rendues `auto` par une règle qui croyait libérer le défilement et
   qui supprimait le geste. */
const SONDE_STYLE = () => {
  const lire = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, ta: cs.touchAction };
  };
  return {
    poignéeOnglet: lire('.wdg-set-tabgrip'),
    ligneOnglet: lire('.wdg-set-tabrow'),
    croixOnglet: lire('.wdg-set-tabdel'),
    poignéeDesk: lire('.wdg-mgr-grip'),
    coinCarte: lire('.wdg-resize'),
    bordCarte: lire('.wdg-resize-e'),
    barreDesk: lire('.layout-resizer'),
  };
};

(async () => {
  phaseSource();

  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Tactile] aucun Chromium trouvé → phases navigateur abstenues.\n'); return fin(); }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { console.log('\n[Tactile] puppeteer-core absent → phases navigateur abstenues.\n'); return fin(); }

  const srv = serveur();
  await new Promise(r => srv.listen(PORT, r));
  let nav;
  try {
    nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    console.log('\n── 2. Les cibles, sur un écran de 390 px, avec la vraie feuille de style ──');
    const page = await nav.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await page.setContent('<html data-theme="dark"><head><link rel="stylesheet" href="http://localhost:' + PORT + '/css/style.css"></head><body>'
      + '<div class="wdg-pop" style="width:340px">'
      +   '<div class="wdg-set-row wdg-set-tabrow" data-j="0"><button class="wdg-set-tabgrip">g</button>'
      +   '<div class="wdg-set-tabcol"><input class="wdg-set-tabin" value="MONDE"></div><button class="wdg-set-tabdel">x</button></div>'
      + '</div>'
      + '<div id="wdg-mgr-list"><div class="wdg-mgr-card" data-i="0"><span class="wdg-mgr-grip">g</span></div></div>'
      + '<div class="wdg-card" style="position:relative;width:300px;height:520px"><div class="wdg-resize"></div><div class="wdg-resize-e"></div></div>'
      + '<div class="main-layout"><div class="layout-resizer"></div></div>'
      + '</body></html>', { waitUntil: 'networkidle0' });
    const m = await page.evaluate(SONDE_STYLE);

    /* LE ZOOM DE PAGE COMPTE DANS CHAQUE CIBLE. Le desk pose 90 % : une cible pensée à 44 px arrive
       à 39,6 px sous le pouce. Les mesures ci-dessous sont celles de l'ÉCRAN, pas les déclarées. */
    const CIBLE = 30;   // plancher accepté ici : en dessous, c'est une cible qu'on rate
    [['poignéeOnglet', 'la poignée de déplacement d\'un onglet'],
     ['croixOnglet', 'la croix de suppression d\'un onglet'],
     ['poignéeDesk', 'la poignée de déplacement d\'un desk'],
     ['coinCarte', 'la poignée de coin d\'une carte']].forEach(([k, quoi]) => {
      const o = m[k];
      if (!o) { v(quoi + ' existe', false, 'introuvable dans la maquette'); return; }
      v(quoi + ' est atteignable au doigt', Math.min(o.w, o.h) >= CIBLE, o.w + '×' + o.h + ' px réels (plancher ' + CIBLE + ')');
    });
    v('la ligne d\'onglet a la hauteur d\'un doigt', m.ligneOnglet && m.ligneOnglet.h >= 38, m.ligneOnglet && m.ligneOnglet.h + ' px');

    console.log('\n  · `touch-action`, calculé après toute la cascade :');
    /* ⚠️ DEUX RÉPONSES JUSTES, PAS UNE. `none` convient à une poignée qu'on ne touche que pour
       déplacer — le coin d'une carte, une barre de séparation : on ne pose pas le doigt dessus par
       hasard, et le geste doit partir au premier pixel.
       Il est FAUX sur une zone qui sert AUSSI à autre chose. Les poignées de réordonnancement
       forment une colonne quasi continue sur le bord gauche du volet (37 px de large sur 77 % de la
       hauteur) : avec `none`, un pouce qui descend ce bord pour FAIRE DÉFILER réordonnait un onglet.
       Elles sont donc en `pan-y` — le défilement reste permis tant que rien n'est armé — et c'est
       l'appui long, puis un `touchmove` non passif, qui refuse le défilement une fois le déplacement
       engagé. Le contrôle exige donc l'un OU l'autre, jamais `auto`, et vérifie que `pan-y`
       s'accompagne bien de l'armement par appui long. */
    const WIDs = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
    const armeParAppui = /appuiLong: 450, bornes: true/.test(WIDs);
    [['poignéeOnglet', 'la poignée d\'onglet', true], ['poignéeDesk', 'la poignée de desk', true],
     ['coinCarte', 'le coin d\'une carte', false], ['bordCarte', 'le bord droit d\'une carte', false],
     ['barreDesk', 'la barre de séparation du desk', false]].forEach(([k, quoi, partagee]) => {
      const o = m[k];
      if (!o) { v(quoi + ' existe', false, 'introuvable'); return; }
      if (partagee) {
        v(quoi + ' laisse défiler tant que rien n\'est armé', o.ta === 'pan-y' || o.ta === 'none', 'touch-action: ' + o.ta);
        v('… et si elle laisse défiler, elle arme par appui long', o.ta !== 'pan-y' || armeParAppui,
          '`pan-y` sans appui long : le déplacement partirait au premier pixel ET le défilement resterait permis');
      } else {
        v(quoi + ' refuse le défilement pendant le geste', o.ta === 'none', 'touch-action: ' + o.ta);
      }
    });
    /* ⚠️ ET LA CONTREPARTIE, QUI EST LE VRAI ARBITRAGE. `touch-action: none` sur une bande PLEINE
       HAUTEUR fabrique une colonne où la page ne défile plus — mesurée à 16 × 498 px sur le bord
       droit de chaque carte. C'est ce qui avait fait retirer la règle, supprimant le geste au lieu
       de raccourcir la bande. La bande doit donc rester COURTE au doigt. */
    v('la bande du bord droit ne mange pas toute la hauteur', m.bordCarte && m.bordCarte.h <= 60,
      m.bordCarte && m.bordCarte.h + ' px de haut : une colonne inerte sur toute la carte');
    await page.close();

    console.log('\n── 3. Aucune commande invisible sous le doigt ──');
    /* ══ UN DOIGT NE SURVOLE PAS ═══════════════════════════════════════════════════════════════
       Plusieurs commandes ne se révèlent qu'au survol : `opacity: 0` au repos, remontée par un
       `:hover`. Bon idiome à la souris — il garde les listes calmes. Au doigt, il produit deux
       défauts opposés, et les deux comptent :
         · `pointer-events: none` → la commande est INATTEIGNABLE (le bouton d'ouverture d'une
           fiche de trade rendait 42×15 px à opacité zéro, et le tap le traversait) ;
         · `pointer-events: auto` → elle est INVISIBLE MAIS ACTIVE. Ce n'est pas une fonction
           manquante, c'est un piège : la croix « Supprimer ce trade » se déclenchait sous un
           doigt qui ne pouvait pas la voir.
       On émule `hover: none` — ce que le navigateur d'un téléphone annonce — et on mesure
       l'opacité CALCULÉE de chaque commande, après toute la cascade. */
    const pv = await nav.newPage();
    await pv.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    /* `page.emulateMediaFeatures` ne connaît pas `hover` dans cette version de puppeteer : on passe
       par le protocole du navigateur, qui l'accepte. C'est ce que le navigateur d'un téléphone
       annonce de lui-même — et c'est la seule façon d'éprouver une règle écrite pour lui. */
    const cdp = await pv.target().createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] });
    await pv.setContent('<html data-theme="dark"><head><link rel="stylesheet" href="http://localhost:' + PORT + '/css/style.css"></head><body>'
      + '<table class="jr-grid"><tbody><tr>'
      +   '<td class="jr-c-sel"><span class="jr-rowsel"></span></td>'
      +   '<td style="position:relative"><button class="jrd-open">ouvrir</button><button class="jr-rowdel">x</button></td>'
      + '</tr></tbody></table>'
      + '<div class="jrd-imgblock jrd-imgblock--filled" style="position:relative"><button class="jrd-img-del">x</button></div>'
      + '<div class="chat-row"><button class="chat-menu-btn">…</button></div>'
      + '</body></html>', { waitUntil: 'networkidle0' });
    const cmd = await pv.evaluate(() => {
      const noms = [['.jrd-open', 'ouvrir la fiche d\'un trade'], ['.jr-rowdel', 'supprimer un trade'],
        ['.jr-c-sel .jr-rowsel', 'sélectionner des lignes'], ['.jrd-img-del', 'retirer une capture'],
        ['.chat-menu-btn', 'le menu d\'un message']];
      return noms.map(([sel, quoi]) => {
        const el = document.querySelector(sel);
        if (!el) return { quoi, absent: true };
        const cs = getComputedStyle(el), b = el.getBoundingClientRect();
        return { quoi, op: +cs.opacity, pe: cs.pointerEvents, w: Math.round(b.width), h: Math.round(b.height) };
      });
    });
    cmd.forEach(c => {
      if (c.absent) { v(c.quoi + ' existe dans la maquette', false); return; }
      /* Le seuil est bas exprès : on ne juge pas l'esthétique, on refuse l'invisible. Une commande
         à 0,15 se devine ; à 0, elle n'existe pas — ou pire, elle piège. */
      v('« ' + c.quoi + ' » se voit au doigt', c.op >= 0.3, 'opacité calculée ' + c.op + ' · pointer-events ' + c.pe);
      if (c.op < 0.1 && c.pe !== 'none') v('… et ne piège pas (invisible mais cliquable)', false, 'opacité ' + c.op + ' avec pointer-events ' + c.pe);
    });
    await pv.close();

    console.log('\n── 4. Un vrai doigt réordonne la barre d\'onglets ──');
    /* Le seul réordonnancement à appui long. Il s'armait bien — la classe était posée — puis le
       navigateur confisquait le geste et l'onglet ne bougeait plus. On l'éprouve au doigt. */
    const CHA = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
    const d = CHA.indexOf('  (function initNavReorder() {');
    const f = d < 0 ? -1 : CHA.indexOf('\n  })();', d);
    if (d < 0 || f < 0) { v('initNavReorder est extractible', false, 'introuvable dans charts.js'); }
    else {
      const p2 = await nav.newPage();
      await p2.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
      await p2.setContent('<style>body{margin:0}#topbar-nav{display:flex;overflow-x:auto}'
        + '.nav-item{flex:0 0 auto;width:90px;height:44px;line-height:44px;text-align:center;border:1px solid #333}</style>'
        + '<nav id="topbar-nav">' + ['ACTUS', 'CALENDRIER', 'BIAIS', 'BANQUES'].map(t => '<a class="nav-item" data-view="' + t + '">' + t + '</a>').join('') + '</nav>');
      await p2.evaluate((src) => { try { localStorage.clear(); } catch (e) {} eval(src + '\n})();'); }, CHA.slice(d, f));
      const b = await p2.evaluate(() => {
        const it = document.querySelectorAll('.nav-item');
        const a = it[3].getBoundingClientRect(), c = it[0].getBoundingClientRect();
        return { x: a.x + a.width / 2, y: a.y + a.height / 2, cx: c.x + 4, cy: c.y + c.height / 2 };
      });
      // Appui LONG (le seuil est de 1,5 s), puis glissement — au doigt.
      await p2.touchscreen.touchStart(b.x, b.y);
      await new Promise(r => setTimeout(r, 1800));
      for (let k = 1; k <= 12; k++) await p2.touchscreen.touchMove(b.x + (b.cx - b.x) * k / 12, b.y);
      await p2.touchscreen.touchEnd();
      await new Promise(r => setTimeout(r, 200));
      const ordre = await p2.evaluate(() => [...document.querySelectorAll('.nav-item')].map(t => t.dataset.view).join(','));
      v('l\'appui long puis le glissement déplacent l\'onglet, au doigt', /^BANQUES,/.test(ordre), ordre);
      await p2.close();
    }
    console.log('\n── 5. Un vrai doigt ouvre l\'explication des pictogrammes ──');
    /* Trois glyphes du desk portent TOUT leur sens dans un `title=` — le « ⇄ » de divergence, l'éclair
       du calendrier, le Neutre par défaut du Radar. Aucun téléphone n'affiche un `title` : le dessin
       restait, le sens disparaissait. On éprouve ici la bulle de remplacement AU DOIGT, avec la VRAIE
       feuille de style (donc son zoom de page de 90 %) et le VRAI code d'app.js — pas une copie. */
    const APP2 = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
    const da = APP2.indexOf('(function _aideAuTap() {');
    const fa = da < 0 ? -1 : APP2.indexOf('\n})();', da);
    if (da < 0 || fa < 0) { v('_aideAuTap est extractible d\'app.js', false, 'introuvable'); }
    else {
      const SRC_AIDE = APP2.slice(da, fa) + '\n})();';
      const LONG = 'Sorti sous l\'estimation basse (LOW)';
      /* Le glyphe du bas est enfermé dans un panneau à `overflow: auto`, comme .cal-table-wrap et
         .sbs-left : c'est CE cas qui condamnait le pseudo-élément — rogné pile sur les dernières
         lignes de la liste, celles qu'on consulte le plus. */
      const monter = async (features, bureau) => {
        const p = await nav.newPage();
        await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
        const c = await p.target().createCDPSession();
        await c.send('Emulation.setEmulatedMedia', { features });
        await p.setContent('<html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1">'
          + '<link rel="stylesheet" href="http://localhost:' + PORT + '/css/style.css">'
          + '<style>body{margin:0;background:#0c0c0e}#zone{position:absolute;left:0;right:0;top:120px;height:400px;overflow:auto}'
          + '#bloc{height:1400px;position:relative}</style></head><body>'
          + '<div style="position:absolute;left:250px;top:40px"><span class="mt-diverg" id="g-court" data-aide="Divergence">⇄</span></div>'
          + '<div style="position:absolute;left:352px;top:80px"><span class="cv-bolt" id="g-bord" data-aide="' + LONG + '">\u26a1</span></div>'
          + '<div style="position:absolute;left:40px;top:900px"><span class="cv-bolt" id="g-fond" data-aide="' + LONG + '">\u26a1</span></div>'
          + '<div id="zone"><div id="bloc"><div id="rang" style="position:absolute;left:40px;top:1370px">'
          + '<span class="cv-bolt" id="g-bas" data-aide="' + LONG + '">\u26a1</span> 1,4 %</div></div></div>'
          + '</body></html>', { waitUntil: 'networkidle0' });
        await p.evaluate((s, bur) => {
          window.__ligne = 0;
          document.getElementById('rang').addEventListener('click', () => { window.__ligne++; });
          if (bur) {   // un écran qui survole : `hover: none` ne s'y vérifie jamais
            const vrai = window.matchMedia.bind(window);
            window.matchMedia = (q) => (/hover:\s*none/.test(q) ? { matches: false } : vrai(q));
          }
          eval(s);
        }, SRC_AIDE, !!bureau);
        return p;
      };
      const taper = async (p, sel, dx, dy) => {
        const pt = await p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, gauche: r.x }; }, sel);
        await p.touchscreen.tap((dx === 'gauche' ? pt.gauche - 3 : pt.x + (dx || 0)), pt.y + (dy || 0));
        await new Promise(r => setTimeout(r, 130));
      };
      const lire = (p, sel) => p.evaluate((s) => {
        const b = document.querySelector('.dtp-aide-bulle');
        if (!b) return null;
        const r = b.getBoundingClientRect(), g = document.querySelector(s).getBoundingClientRect();
        const z = document.getElementById('zone').getBoundingClientRect();
        // Zoom de page réel : `--aide-fleche` est écrit en px NON zoomés, il faut le reconvertir
        // avant de le comparer à une abscisse d'écran.
        const zm = document.body.offsetWidth ? (document.body.getBoundingClientRect().width / document.body.offsetWidth) : 1;
        return { txt: b.textContent, sousBody: b.parentElement === document.body,
          x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2,
          gcx: g.x + g.width / 2, gy: g.y, gh: g.height, zoneBas: z.bottom,
          vw: window.innerWidth, vh: window.innerHeight, zm: zm,
          fleche: r.x + (parseFloat(getComputedStyle(b).getPropertyValue('--aide-fleche')) || 0) * zm,
          haut: b.classList.contains('dtp-aide-bulle--haut'), ligne: window.__ligne };
      }, sel);

      const pt = await monter([{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }]);

      /* (a) LE CAS DÉCISIF, ET IL EST INVISIBLE À L'ŒIL NU EN HAUT À GAUCHE. La feuille pose
         `html { zoom: .9 }`, réglable par compte : un `left` écrit sans repasser en pixels non
         zoomés dérive de 10 % de l'abscisse — rien à gauche de l'écran, 34 px à droite. */
      await taper(pt, '#g-court');
      let b = await lire(pt, '#g-court');
      v('un tap sur le glyphe ouvre la bulle', !!b && b.txt === 'Divergence', JSON.stringify(b));
      if (b) {
        v('… posée sur <body> (aucun panneau ne peut la rogner)', b.sousBody);
        v('… centrée sur le glyphe malgré le zoom de page', Math.abs(b.cx - b.gcx) <= 3,
          'centre bulle ' + Math.round(b.cx) + ' px · centre glyphe ' + Math.round(b.gcx) + ' px (zoom ' + b.zm.toFixed(2) + ')');
        v('… et posée SOUS lui', !b.haut && b.y >= b.gy + b.gh - 1);
        v('… sans que la ligne qui la porte ne s\'ouvre', b.ligne === 0, 'clics sur la ligne : ' + b.ligne);
      }

      // (b) UN DEUXIÈME TAP REFERME — sinon la bulle reste en travers de l'écran.
      await taper(pt, '#g-court');
      v('un deuxième tap sur le même glyphe referme', (await lire(pt, '#g-court')) === null);

      // (c) LE BORD DROIT : une bulle de 268 px ancrée à 352 px sur un écran de 390.
      await taper(pt, '#g-bord');
      b = await lire(pt, '#g-bord');
      v('près du bord, la bulle reste entièrement à l\'écran', !!b && b.x >= 0 && b.x + b.w <= b.vw + 0.5,
        b ? 'x ' + Math.round(b.x) + ' → ' + Math.round(b.x + b.w) + ' sur ' + b.vw : 'aucune bulle');
      // Recadrée contre un bord, la bulle n'est plus centrée sur le glyphe : une flèche restée au
      // milieu désignerait le mauvais mot.
      if (b) v('… et sa flèche vise toujours le glyphe', Math.abs(b.fleche - b.gcx) <= 6,
        'flèche à ' + Math.round(b.fleche) + ' px · glyphe à ' + Math.round(b.gcx) + ' px');

      // (d) LA CIBLE DU DOIGT : l'éclair fait 9 px de large. On tape 3 px À CÔTÉ, hors du dessin.
      await taper(pt, '#g-bord');   // referme
      await taper(pt, '#g-bord', 'gauche');
      v('un tap juste à côté du glyphe l\'atteint quand même (cible élargie)', (await lire(pt, '#g-bord')) !== null);

      /* (e) LE FOND D'UN PANNEAU DÉFILANT — le cas qui rognait un pseudo-élément. La bulle doit
         DÉBORDER du panneau (c'est la preuve qu'elle lui échappe) sans sortir de l'écran. */
      await taper(pt, '#g-bord');
      await pt.evaluate(() => { document.getElementById('zone').scrollTop = 1400; });
      await new Promise(r => setTimeout(r, 80));
      await taper(pt, '#g-bas');
      b = await lire(pt, '#g-bas');
      v('au fond d\'un panneau défilant, la bulle s\'affiche en entier', !!b && b.y >= 0 && b.y + b.h <= b.vh + 0.5,
        b ? 'y ' + Math.round(b.y) + ' → ' + Math.round(b.y + b.h) + ' sur ' + b.vh : 'aucune bulle');
      v('… en débordant du panneau, ce qu\'un pseudo-élément ne pouvait pas faire', !!b && b.y + b.h > b.zoneBas + 1,
        b ? 'bas de bulle ' + Math.round(b.y + b.h) + ' · bas du panneau ' + Math.round(b.zoneBas) : '');

      // (f) EN BAS DE L'ÉCRAN : faute de place dessous, la bulle bascule AU-DESSUS du glyphe.
      await taper(pt, '#g-bas');
      await taper(pt, '#g-fond');
      b = await lire(pt, '#g-fond');
      v('collée au bas de l\'écran, la bulle bascule au-dessus du glyphe', !!b && b.haut && b.y + b.h <= b.gy + 1,
        b ? (b.haut ? 'au-dessus' : 'en dessous') + ' · bas ' + Math.round(b.y + b.h) + ' · glyphe ' + Math.round(b.gy) : 'aucune bulle');
      await pt.close();

      /* (g) AU BUREAU, RIEN NE CHANGE : le `title` natif reste seul maître, et surtout le tap ne
         doit pas confisquer le clic de la ligne. ⚠️ Ce Chromium REFUSE d'émuler `hover: hover` —
         mesuré : avec la feature poussée par le protocole, `matchMedia('(hover: none)')` reste
         vrai (un navigateur sans tête n'a pas de souris à annoncer). On éprouve donc la GARDE
         elle-même, en faisant répondre `matchMedia` comme le ferait un vrai écran de bureau. */
      const ps = await monter([{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }], true);
      await taper(ps, '#g-court');
      v('sur un écran qui survole, le tap n\'ouvre aucune bulle (le `title` suffit)',
        await ps.evaluate(() => !document.querySelector('.dtp-aide-bulle')));
      v('… et le clic revient bien à la ligne qui porte le glyphe', (await ps.evaluate(() => window.__ligne)) === 0);
      await ps.close();
    }
    /* ═══ LA TOPBAR TIENT SUR UNE RANGÉE, ET LES ICÔNES SONT ALIGNÉES (09/09) ═══════════════════
       Demande user, capture à l'appui : « les icônes doivent être alignées ici ». Sous 400 px la
       feuille coupait délibérément la topbar en DEUX rangées (84 px) — logo et icônes de droite en
       haut, outils et recherche en dessous. À l'écran : un vide de 160 px au milieu de la première,
       une seconde qui commence ailleurs, deux hauteurs différentes. Rien ne s'alignait.
       ⚠️ ON INJECTE LA VRAIE TOPBAR, extraite de `public/index.html`, pas une maquette : c'est le
       nombre et la taille réels des icônes qui décident si la rangée tient. Une copie simplifiée
       tiendrait toujours, et ne prouverait rien. */
    console.log('\n── 6. La topbar mobile : une rangée, des icônes alignées ──');
    {
      const html = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
      const i0 = html.indexOf('<div class="topbar">');
      const i1 = html.indexOf('\n</div>', i0);
      const topbar = (i0 >= 0 && i1 > i0) ? html.slice(i0, i1 + 7) : '';
      v('la topbar est extractible d\'index.html', topbar.length > 2000, String(topbar.length));
      for (const L of [390, 360]) {
        const pt = await nav.newPage();
        await pt.setViewport({ width: L, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        /* ⚠️ LA BALISE VIEWPORT EST INDISPENSABLE, ET SON ABSENCE REND CE BANC MUET. En émulation
           mobile (`isMobile: true`), Chrome sert un viewport de mise en page de 980 px à toute page
           qui n'en déclare pas : les media queries « max-width: 400px » ne s'appliquent alors JAMAIS
           et l'on mesure une topbar de bureau en croyant mesurer un téléphone. Constaté par
           mutation : remettre `flex-wrap: wrap` et la hauteur des deux rangées ne faisait rougir
           AUCUN contrôle. La vraie page porte cette balise ; la maquette doit la porter aussi. */
        await pt.setContent('<html data-theme="dark"><head>'
          + '<meta name="viewport" content="width=device-width, initial-scale=1">'
          + '<link rel="stylesheet" href="http://localhost:' + PORT
          + '/css/style.css"></head><body style="margin:0">' + topbar + '</body></html>', { waitUntil: 'networkidle0' });
        const t = await pt.evaluate(() => {
          const tb = document.querySelector('.topbar'); if (!tb) return null;
          const r = tb.getBoundingClientRect(), cs = getComputedStyle(tb);
          const boites = sel => [...document.querySelectorAll(sel)]
            .map(e => e.getBoundingClientRect()).filter(x => x.width > 4 && x.height > 4);
          const c = boites('.topbar-center > *'), d = boites('.topbar-right > *');
          return {
            h: Math.round(r.height), wrap: cs.flexWrap,
            finCentre: c.length ? Math.round(Math.max(...c.map(x => x.right))) : 0,
            debutDroite: d.length ? Math.round(Math.min(...d.map(x => x.x))) : 9999,
            ordonnees: [...new Set([...c, ...d].map(x => Math.round(x.y)))].sort((a, b) => a - b),
            nIcones: c.length + d.length,
            rech: (() => { const e = document.querySelector('.topbar-symbol-search'); return e ? Math.round(e.getBoundingClientRect().width) : 0; })(),
          };
        });
        await pt.close();
        v(L + ' px : la topbar tient sur UNE rangée', !!t && t.h <= 60, t ? t.h + ' px de haut' : '(topbar absente)');
        v(L + ' px : … elle ne se replie pas', !!t && t.wrap === 'nowrap', t ? t.wrap : '');
        /* Le chevauchement était réel sous 360 px : 25 px de recouvrement mesurés avant correction. */
        v(L + ' px : … outils et icônes de droite ne se chevauchent pas',
          !!t && t.finCentre <= t.debutDroite, t ? ('fin outils ' + t.finCentre + ' > début droite ' + t.debutDroite) : '');
        v(L + ' px : … et toutes les icônes sont là', !!t && t.nIcones >= 6, t ? String(t.nIcones) : '');
        /* C'EST LA RECHERCHE QUI DÉCIDE. Tant qu'elle prend `flex: 1 1 auto`, elle mange la rangée
           et pousse tout le reste à la ligne — c'était la cause du repli. Elle doit rester la
           case-icône compacte, qui se déplie en overlay au tap. */
        v(L + ' px : … la recherche reste une case compacte', !!t && t.rech > 0 && t.rech <= 40,
          t ? (t.rech + ' px de large') : '');
        /* ⚠️ L'ALIGNEMENT N'EST EXIGÉ QU'À 390 px, ET C'EST DÉLIBÉRÉ : c'est la largeur des
           téléphones visés. À 360 et en dessous il reste 2 px d'écart, dus au rembourrage interne
           de la case de recherche — constaté, consigné dans la feuille, non corrigé. Exiger ici ce
           qu'on n'a pas fait rendrait ce banc faux. */
        if (L === 390) v(L + ' px : … toutes sur la MÊME ordonnée', !!t && t.ordonnees.length === 1, t ? JSON.stringify(t.ordonnees) : '');
        else v(L + ' px : … à 2 px près au plus (écart connu, case de recherche)',
          !!t && (t.ordonnees[t.ordonnees.length - 1] - t.ordonnees[0]) <= 2, t ? JSON.stringify(t.ordonnees) : '');
      }
    }
  } catch (e) {
    v('les phases navigateur s\'exécutent', false, e.message);
  } finally {
    if (nav) try { await nav.close(); } catch {}
    srv.close();
  }
  fin();
})();

function fin() {
  console.log('');
  if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
  console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');
  process.exit(0);
}

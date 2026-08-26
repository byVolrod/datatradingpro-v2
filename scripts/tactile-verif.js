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
  v('les listes se réordonnent par une mécanique commune au pointeur', /function _glisserPourReordonner\(hote, selPoignee, selLigne, attr, deplacer\)/.test(WID));
  v('… employée par les onglets ET par les desks', (WID.match(/_glisserPourReordonner\(/g) || []).length >= 3,
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
    [['poignéeOnglet', 'la poignée d\'onglet'], ['poignéeDesk', 'la poignée de desk'],
     ['coinCarte', 'le coin d\'une carte'], ['bordCarte', 'le bord droit d\'une carte'],
     ['barreDesk', 'la barre de séparation du desk']].forEach(([k, quoi]) => {
      const o = m[k];
      if (!o) { v(quoi + ' existe', false, 'introuvable'); return; }
      v(quoi + ' refuse le défilement pendant le geste', o.ta === 'none', 'touch-action: ' + o.ta);
    });
    /* ⚠️ ET LA CONTREPARTIE, QUI EST LE VRAI ARBITRAGE. `touch-action: none` sur une bande PLEINE
       HAUTEUR fabrique une colonne où la page ne défile plus — mesurée à 16 × 498 px sur le bord
       droit de chaque carte. C'est ce qui avait fait retirer la règle, supprimant le geste au lieu
       de raccourcir la bande. La bande doit donc rester COURTE au doigt. */
    v('la bande du bord droit ne mange pas toute la hauteur', m.bordCarte && m.bordCarte.h <= 60,
      m.bordCarte && m.bordCarte.h + ' px de haut : une colonne inerte sur toute la carte');
    await page.close();

    console.log('\n── 3. Un vrai doigt réordonne la barre d\'onglets ──');
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

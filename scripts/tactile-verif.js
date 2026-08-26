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
    console.log('\n── 5. Un vrai doigt deplace une carte du desk — et le desk defile toujours ──');
    /* LE CAS LE PLUS COUTEUX, et le moins visible : sous 560 px la grille passe a UNE colonne, donc
       l'ordre des cartes EST toute la disposition. Il n'existe aucun repli — le panneau de reglages
       n'a ni « monter » ni « descendre », et la poignee a ete retiree le 04/08. Sur telephone, on ne
       pouvait pas rearranger son desk du tout.
       Ce qu'on eprouve ici est le COUPLE, parce que c'est lui qui est delicat : l'en-tete sert a
       DEUX choses — faire defiler le desk, et saisir la carte. Un glissement franc doit defiler ; un
       appui insistant puis un glissement doit deplacer. Les deux sont mesures. */
    const WID = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
    const dg = WID.indexOf('  function _glisserPourReordonner(');
    if (dg < 0) { v('la mécanique de déplacement est extractible', false, 'introuvable'); }
    else {
      const fg = WID.indexOf('\n  }\n', dg);
      const p3 = await nav.newPage();
      await p3.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
      await p3.setContent('<style>body{margin:0}#g{height:2400px}'
        + '.wdg-card{height:300px;border:1px solid #333;margin:8px}'
        + '.wdg-head{height:40px;background:#181820}</style>'
        + '<div id="g">' + [0, 1, 2, 3].map(i => '<div class="wdg-card" data-idx="' + i + '"><header class="wdg-head">carte ' + i + '</header></div>').join('') + '</div>');
      await p3.evaluate((src) => {
        window.__ordres = [];
        const host = document.getElementById('g');
        const _reorderBefore = (from, to) => window.__ordres.push([from, to]);
        eval(src + '\n_glisserPourReordonner(host, ".wdg-head", ".wdg-card", "data-idx", _reorderBefore,'
          + ' { appuiLong: 450, exclus: "button, input", refuse: c => c.classList.contains("wdg-card--locked") });');
      }, WID.slice(dg, fg + 4));
      const pos = await p3.evaluate(() => {
        const h = document.querySelectorAll('.wdg-head');
        const a = h[2].getBoundingClientRect(), c = h[0].getBoundingClientRect();
        return { x: a.x + a.width / 2, y: a.y + a.height / 2, cy: c.y + 6 };
      });
      // (a) GLISSEMENT FRANC, sans insister : ce doit etre un DEFILEMENT, pas un deplacement.
      await p3.touchscreen.touchStart(pos.x, pos.y);
      for (let k = 1; k <= 10; k++) await p3.touchscreen.touchMove(pos.x, pos.y - 12 * k);
      await p3.touchscreen.touchEnd();
      await new Promise(r => setTimeout(r, 150));
      let o = await p3.evaluate(() => window.__ordres.slice());
      v('un glissement franc sur l\'en-tête ne déplace pas la carte (c\'est un défilement)', o.length === 0, JSON.stringify(o));
      // (b) APPUI INSISTANT puis glissement : la carte doit se deplacer.
      await p3.evaluate(() => { window.__ordres.length = 0; window.scrollTo(0, 0); });
      const p2b = await p3.evaluate(() => {
        const h = document.querySelectorAll('.wdg-head');
        const a = h[2].getBoundingClientRect(), c = h[0].getBoundingClientRect();
        return { x: a.x + a.width / 2, y: a.y + a.height / 2, cy: c.y + 6 };
      });
      await p3.touchscreen.touchStart(p2b.x, p2b.y);
      await new Promise(r => setTimeout(r, 700));
      for (let k = 1; k <= 12; k++) await p3.touchscreen.touchMove(p2b.x, p2b.y + (p2b.cy - p2b.y) * k / 12);
      await p3.touchscreen.touchEnd();
      await new Promise(r => setTimeout(r, 150));
      o = await p3.evaluate(() => window.__ordres.slice());
      v('un appui insistant puis un glissement déplace la carte, au doigt', o.length === 1 && o[0][0] === 2, JSON.stringify(o));
      v('aucune marque ne reste sur la carte après le dépôt',
        (await p3.evaluate(() => document.querySelectorAll('.wdg-reord-src,.wdg-drop-before,.wdg-drop-after').length)) === 0);
      await p3.close();
    }
    // Le glisser natif ne doit plus etre promis nulle part sur ces surfaces.
    v('l\'en-tête de carte n\'est plus en glisser natif', !/<header class="wdg-head" draggable=/.test(WID));
    v('la barre d\'onglets non plus', !/bar\.setAttribute\('draggable', 'true'\)/.test(WID));
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

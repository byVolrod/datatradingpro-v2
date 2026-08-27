#!/usr/bin/env node
/**
 * scripts/mobile-verif.js — LE DESK TIENT-IL DANS UN TÉLÉPHONE ?
 * ------------------------------------------------------------------------------------------------
 * POURQUOI (26/08). L'aperçu téléphone (`mobile-apercu.js`) a sorti sa première planche et deux
 * défauts s'y voyaient immédiatement — la 2e rangée de la barre du haut RECOUVRAIT la rangée
 * d'onglets sur 375 pt, et cette rangée d'onglets se coupait en plein mot sans rien indiquer.
 * Aucun contrôle du projet ne pouvait les voir :
 *   · `node -c` et `js-verif` ne lisent que du texte ;
 *   · `desk-verif` ouvre bien un vrai navigateur, mais à la taille par défaut d'un bureau —
 *     et les deux défauts n'existent QUE sous 400 pt et au doigt ;
 *   · une planche d'images, elle, ne dit rien à un ordinateur : il faut la regarder.
 * Ce banc-ci MESURE ce que la planche montre, à trois largeurs de téléphone réelles.
 *
 * ⚠️ CE QU'IL FAUT COMPRENDRE POUR LIRE LES CHIFFRES : le desk applique `html { zoom: .9 }`.
 * `getBoundingClientRect()` rend des pixels D'ÉCRAN (déjà réduits), les déclarations CSS et les
 * media queries, elles, comptent en pixels CSS non réduits. Un téléphone de 375 pt offre donc
 * 416,7 px de MISE EN PAGE tout en déclenchant `@media (max-width: 400px)` — c'est ce décalage qui
 * fabrique les défauts qu'on mesure ici. Les seuils tactiles sont donc exprimés en px D'ÉCRAN.
 *
 * ⚠️ CHAQUE CONTRÔLE A ÉTÉ ÉPROUVÉ EN CASSANT CE QU'IL SURVEILLE — et deux d'entre eux sont nés
 * FAUX, ce qui est exactement la raison de le faire :
 *   · retirer `.topbar .logo { height: … }` → rouge sur 375 SEULEMENT (là où le défaut vit) ;
 *   · retirer TOUT le fondu de la feuille de style → le contrôle restait VERT : il ne regardait que
 *     la classe posée par le JS, c'est-à-dire l'interrupteur d'une lampe qu'on n'avait pas branchée.
 *     Il lit désormais le pseudo-élément peint (`::after`), et il rougit ;
 *   · passer la navigation en `overflow-x: hidden` → le contrôle restait VERT : un conteneur caché
 *     se laisse parfaitement défiler PAR SCRIPT, ce que le doigt ne peut pas faire. Il exige
 *     désormais un débordement réellement défilable, et il rougit ;
 *   · retirer la bascule `nav-au-bout` du JS → rouge sur les trois appareils.
 *
 *   node scripts/mobile-verif.js
 *
 * Sans Chromium, le banc S'ABSTIENT (code 0) : il ne rend jamais un poste inutilisable.
 */
const fs = require('fs');
const path = require('path');
const { serveur, trouverNavigateur, UA_IOS, UA_AND } = require('./mobile-apercu.js');

const PORT = 4816;
/* Trois largeurs, trois régimes DIFFÉRENTS de la feuille de style — c'est le point : un seul
   téléphone n'aurait éprouvé qu'une branche. 375 déclenche la barre à deux rangées (≤400), 412 et
   430 restent sur une rangée mais débordent latéralement de la navigation. */
const APPAREILS = [
  { nom: 'iPhone 12 mini', w: 375, h: 812, dpr: 3, ios: true },
  { nom: 'Pixel 7', w: 412, h: 915, dpr: 2.6, ios: false },
  { nom: 'iPhone 15 Pro Max', w: 430, h: 932, dpr: 3, ios: true },
];

/* Le seuil tactile du projet : 32 px RÉELS à l'écran (voir le bloc « CIBLES TACTILES » de
   style.css). On mesure donc des rectangles rendus, pas des déclarations. */
const CIBLE_MIN = 32;

/* ══ PHASE 0 : LE SERVICE WORKER, SANS NAVIGATEUR ═══════════════════════════════════════════════
   Ces trois contrôles sont du calcul pur, et ils gardent le défaut le plus coûteux de toute la
   couche mobile : un fichier mémorisé PAR ERREUR par un service worker n'est rattrapable par
   AUCUN rechargement côté client — le service worker répond avant le réseau, Ctrl+F5 compris.
   Le jour où ça arrive, on ne peut plus rien pour les clients déjà touchés. */
function phaseServiceWorker() {
  let ko = 0;
  const v2 = (nom, cond, detail) => { if (cond) console.log('  ✓ ' + nom); else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
  const RACINE = path.join(__dirname, '..');
  const sw = fs.readFileSync(path.join(RACINE, 'public/sw.js'), 'utf8');

  console.log('\n── Service worker : ce qu\'il a le droit de mémoriser ──');
  /* On extrait la VRAIE fonction, pas une transcription : une copie dériverait sans prévenir, et
     c'est précisément ce qui s'est produit — l'en-tête du fichier annonçait « pas de jeton, pas de
     cache » pendant que le code, lui, décidait sur l'extension. */
  const i = sw.indexOf('function estActifVersionne');
  const j = sw.indexOf('self.addEventListener(\'fetch\'');
  if (i < 0 || j < 0) { console.log('  ✗ estActifVersionne introuvable dans sw.js'); return 1; }
  const API = new Function('self', sw.slice(i, j) + '\nreturn estActifVersionne;')({ location: { origin: 'https://desk.datatradingpro.com' } });
  const u = (p) => new URL(p, 'https://desk.datatradingpro.com');

  v2('un script versionné est mémorisé', API(u('/js/app.js?v=20260827bbg990')) === true);
  v2('une feuille versionnée aussi', API(u('/css/style.css?v=20260827bbg990')) === true);
  /* LE CAS QUI A MORDU : les logos de banques sont injectés par le JS, sans jeton. Mémorisés par
     extension, ils l'étaient À VIE — remplacer un logo n'atteignait plus jamais un client. */
  v2('un logo de banque SANS jeton n\'est PAS mémorisé', API(u('/assets/images/banks/HSBC.png')) === false,
    'c\'est le défaut du 27/08 : mémorisé à vie, irrattrapable côté client');
  v2('une image sans jeton non plus', API(u('/assets/images/macro-ai-spark.svg')) === false);
  v2('aucune donnée d\'API n\'est mémorisable', API(u('/api/news?v=1')) === false);
  v2('rien d\'un autre domaine', API(new URL('https://cdn.amcharts.com/lib/5/index.js?v=1')) === false);

  /* LE JETON DU SERVICE WORKER DOIT SUIVRE CELUI DES PAGES. Son cache d'installation
     (`/offline.html`, favicon, icônes) ne porte aucun jeton d'URL : il n'est balayé qu'au
     changement de VERSION. Bumper les pages sans bumper VERSION reproduit le défaut du 06/08, un
     cran plus bas — là où le client ne peut rien. */
  const html = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
  const jetonPage = (html.match(/(?:href|src)="\/(?:css|js)\/[^"?]+\?v=([^"]+)"/) || [])[1];
  const jetonSw = (sw.match(/const VERSION = 'dtp-sw-([^']*)'/) || [])[1];
  v2('le service worker porte le MÊME jeton que les pages', !!jetonPage && jetonSw === jetonPage,
    'pages ' + jetonPage + ' · service worker ' + jetonSw);
  const bump = fs.readFileSync(path.join(RACINE, 'scripts/bump-cache.js'), 'utf8');
  v2('… et le rituel de bump s\'en charge tout seul', /const VERSION = '\)[^]*?dtp-sw-/.test(bump) || /sw\.js/.test(bump) && /VERSION/.test(bump));

  /* Un service worker servi derrière une session ne s'installe jamais pour un visiteur déconnecté,
     et `/.well-known/` est ce que Google exige pour prouver qu'un domaine et une app vont ensemble.
     Les deux se règlent au même endroit : la liste des chemins publics du serveur. */
  const srv = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
  const zonePublique = srv.slice(srv.indexOf('const _PUBLIC_PATHS'), srv.indexOf('// Jeton d\'appel INTERNE'));
  v2('/sw.js est servi sans session', zonePublique.indexOf("'/sw.js'") > 0);
  v2('/offline.html aussi', zonePublique.indexOf("'/offline.html'") > 0);
  v2('/.well-known/ est ouvert (preuve de domaine pour Google Play)', zonePublique.indexOf("'/.well-known/'") > 0);
  return ko;
}

(async () => {
  const koSw = phaseServiceWorker();
  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Mobile] aucun Chromium → phase navigateur abstenue.\n'); process.exit(koSw ? 1 : 0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Mobile] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(koSw ? 1 : 0); }

  const srv = serveur();
  await new Promise((r) => srv.listen(PORT, r));
  let ko = koSw, nav;
  const v = (nom, cond, detail) => {
    if (cond) console.log('  ✓ ' + nom);
    else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
  };

  try {
    nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    for (const a of APPAREILS) {
      const page = await nav.newPage();
      const fatales = [];
      page.on('pageerror', (e) => fatales.push(e.message));
      await page.setUserAgent(a.ios ? UA_IOS : UA_AND);
      await page.setViewport({ width: a.w, height: a.h, deviceScaleFactor: a.dpr, isMobile: true, hasTouch: true });
      await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => document.querySelectorAll('.news-item').length > 0, { timeout: 30000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));

      const m = await page.evaluate(async (CIBLE_MIN) => {
        const pause = (ms) => new Promise((r) => setTimeout(r, ms));
        const barre = document.querySelector('.topbar');
        const nav = document.querySelector('.navbar');
        const hautNav = nav ? nav.getBoundingClientRect().top : Infinity;

        /* [1] LE CHEVAUCHEMENT SE MESURE SUR LES PIXELS PEINTS, PAS SUR LES TOKENS. C'est toute la
           leçon du défaut : `--topbar-h` valait 84, `.topbar` mesurait 84 — tout était juste, et
           le CONTENU débordait quand même de sa boîte. On parcourt donc les descendants VISIBLES
           de la barre et on retient celui qui descend le plus bas sous le haut de la navigation. */
        let deborde = 0, coupable = '';
        if (barre && nav) {
          for (const e of barre.querySelectorAll('*')) {
            const b = e.getBoundingClientRect();
            if (!b.width || !b.height) continue;
            const cs = getComputedStyle(e);
            if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
            const d = b.bottom - hautNav;
            if (d > deborde) { deborde = +d.toFixed(1); coupable = (e.className.baseVal !== undefined ? e.className.baseVal : e.className) || e.tagName; }
          }
        }

        /* [2] « ATTEIGNABLE » NE VEUT PAS DIRE « VISIBLE » : la rangée peut dépasser tant qu'elle
           DÉFILE. On l'amène au bout pour de vrai et on vérifie que le dernier onglet entre dans
           le cadre — un `overflow-x: auto` déclaré ne prouve rien si un parent le rogne. */
        /* ⚠️ « JE PEUX LE FAIRE DÉFILER EN JS » NE PROUVE RIEN. Un conteneur en `overflow: hidden`
           se laisse parfaitement défiler par script — le doigt, lui, n'y arrive pas. Passer la
           navigation en `hidden` laissait donc ce contrôle vert avec la moitié des onglets
           définitivement hors d'atteinte. On exige donc AUSSI un débordement réellement
           défilable. */
        const ovNav = nav ? getComputedStyle(nav).overflowX : '';
        const defilable = ovNav === 'auto' || ovNav === 'scroll';
        const onglets = nav ? [...nav.querySelectorAll('.nav-item')] : [];
        const dernier = onglets[onglets.length - 1];
        /* ⚠️ LE FONDU SE MESURE PEINT, PAS DÉCLARÉ. Première version de ce contrôle : elle ne
           regardait que la classe `nav-au-bout`. Retirer TOUT le fondu de la feuille de style la
           laissait verte — elle éprouvait la bascule JS et rien d'autre, c'est-à-dire l'interrupteur
           d'une lampe qu'on n'avait pas branchée. On lit donc le pseudo-élément lui-même. */
        const ps = nav ? getComputedStyle(nav, '::after') : null;
        const peint = !!ps && ps.content !== 'none' && ps.backgroundImage !== 'none' && parseFloat(ps.width) >= 20;
        const avant = { fondu: nav ? !nav.classList.contains('nav-au-bout') : false, sl: nav ? nav.scrollLeft : 0,
          opacite: ps ? parseFloat(ps.opacity) : null };
        let dernierVisible = null;
        if (nav && dernier) {
          nav.scrollLeft = nav.scrollWidth;
          nav.dispatchEvent(new Event('scroll'));
          const b = dernier.getBoundingClientRect(), n = nav.getBoundingClientRect();
          dernierVisible = b.left >= n.left - 1 && b.right <= n.right + 1;
        }
        /* ⚠️ ON LAISSE LA TRANSITION FINIR. `getComputedStyle` rend la valeur EN COURS
           d'interpolation : lue dans la foulée du défilement, l'opacité vaut encore 1 alors que la
           classe est déjà posée — le contrôle accusait le code à tort. 260 ms > les 180 ms de la
           transition déclarée. */
        await pause(260);
        const psApres = nav ? getComputedStyle(nav, '::after') : null;
        const apres = { fondu: nav ? !nav.classList.contains('nav-au-bout') : false,
          opacite: psApres ? parseFloat(psApres.opacity) : null };
        if (nav) { nav.scrollLeft = avant.sl; nav.dispatchEvent(new Event('scroll')); }

        // [3] Le produit, pas un écran d'attente.
        const lignes = document.querySelectorAll('.news-item').length;

        // [4] Rien ne doit pousser la PAGE de côté : c'est le défaut qui casse tout le reste.
        const debordePage = document.documentElement.scrollWidth - document.documentElement.clientWidth;

        // [5] Cibles tactiles de la barre du haut, en px d'écran.
        let pluspetite = Infinity, petiteQui = '';
        for (const e of document.querySelectorAll('.topbar-icon, #topbar-avatar')) {
          const b = e.getBoundingClientRect();
          if (!b.width || !b.height) continue;
          const c = Math.min(b.width, b.height);
          if (c < pluspetite) { pluspetite = +c.toFixed(1); petiteQui = e.id || e.className; }
        }
        return { deborde, coupable, onglets: onglets.length, dernierVisible, ovNav, defilable, fonduAvant: avant.fondu,
          fonduApres: apres.fondu, peint, opAvant: avant.opacite, opApres: apres.opacite,
          debordeNav: nav ? nav.scrollWidth - nav.clientWidth : 0,
          lignes, debordePage, cible: pluspetite === Infinity ? null : pluspetite, cibleQui: petiteQui,
          hauteurBarre: barre ? +barre.getBoundingClientRect().height.toFixed(1) : null };
      }, CIBLE_MIN);

      console.log('\n── ' + a.nom + ' (' + a.w + ' × ' + a.h + ', dpr ' + a.dpr + ') ──');
      v('rien de la barre du haut ne mord sur la rangée d\'onglets',
        m.deborde <= 0.5, m.deborde + ' px recouverts par « ' + m.coupable + ' » (barre : ' + m.hauteurBarre + ' px)');
      v('le fil affiche le produit, pas un écran d\'attente', m.lignes >= 10, m.lignes + ' ligne(s)');
      v('la page ne se décale pas latéralement', m.debordePage <= 1, m.debordePage + ' px de débordement');
      v('tous les onglets sont atteignables au doigt',
        m.onglets > 0 && m.dernierVisible === true && (m.debordeNav <= 2 || m.defilable),
        m.onglets + ' onglet(s), dernier visible : ' + m.dernierVisible + ', overflow-x: ' + m.ovNav);
      /* Le fondu ne se contrôle que là où il a une raison d'être : si la rangée tient entière, il
         ne doit PAS s'allumer — et ce cas-là est vérifié par la seconde moitié de la condition. */
      v('un fondu est réellement PEINT au bord de la rangée', m.peint,
        'pseudo-élément ::after absent ou sans dégradé');
      v('la rangée coupée l\'annonce, et le fondu s\'efface au bout',
        m.debordeNav > 2 ? (m.fonduAvant === true && m.opAvant === 1 && m.fonduApres === false && m.opApres === 0)
                         : (m.fonduAvant === false && m.opApres === 0),
        'débordement ' + m.debordeNav + ' px · opacité avant=' + m.opAvant + ' après=' + m.opApres);
      v('les cibles tactiles de la barre tiennent le seuil de 32 px réels',
        m.cible !== null && m.cible >= CIBLE_MIN, m.cible + ' px sur « ' + m.cibleQui + ' »');
      v('aucune erreur d\'exécution', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));
      await page.close();
    }
  } finally {
    if (nav) await nav.close();
    srv.close();
  }

  console.log(ko ? '\n✗ ' + ko + ' ÉCHEC(S)\n' : '\n✓ le desk tient dans un téléphone.\n');
  process.exit(ko ? 1 : 0);
})();

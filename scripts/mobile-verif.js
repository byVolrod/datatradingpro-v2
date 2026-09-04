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
    /* ══ LES WIDGETS DE MON DESK MONTRENT-ILS LEUR CONTENU ? (02/09, capture user) ═══════════════
       « Sur mobile agrandis le bloc ou trouve une solution pour afficher bien le widget, car là on
       ne voit pas toutes les informations. »
       CE QUI SE PASSAIT, mesuré à 390x844 (le desk est à 90 % de zoom : 433x938 en pixels CSS) :
       une carte à onglets porte deux barres EN FLUX avant tout contenu — la piste d'onglets (30 px
       CSS) et l'en-tête de la vue adoptée (40 px). La plaque de commandes, elle, est un calque
       `absolute` et ne coûte RIEN en hauteur, contrairement à ce que la capture laisse croire.
       Restaient 542 px de contenu pour des vues qui en réclament 610 à 684 : Institutions perdait
       81 px, Analystes 63, Semaine à venir 155.
       ⚠️ ET LA MÉTRIQUE A DÛ ÊTRE REFAITE : mesurer « ce que le contenu demande » par le
       `scrollHeight` d'un conteneur qui s'étire AVEC la carte est circulaire — la valeur suit la
       carte et grandit avec elle. Mon premier relevé montrait ainsi 610 qui devenait 758 dès que
       j'agrandissais la carte, ce qui ne prouvait rien. On mesure donc le DÉBORDEMENT réel
       (`scrollHeight - clientHeight`) élément par élément, en les nommant : une liste de dépêches
       qui déborde est NORMALE (elle défile par nature), un tableau ou un agenda coupés ne le sont
       pas. C'est cette liste nommée qui est contrôlée ici. */
    if (APPAREILS.length) {
      /* L'onglet « Mon Desk » n'est créé que pour un compte ADMIN (widgets.js). Le bouchon commun
         sert un compte client : on le DÉRIVE le temps de cette section plutôt que d'en écrire un
         second, qui divergerait — et plutôt que de basculer le bouchon partagé en admin, ce qui
         changerait le décor de tous les autres bancs. */
      const srvAdmin = require('http').createServer((rq, rs) => {
        const u = rq.url.split('?')[0];
        if (u === '/api/me' || u === '/api/auth/me' || u === '/api/session' || u === '/api/user') {
          rs.writeHead(200, { 'Content-Type': 'application/json' });
          return rs.end(JSON.stringify({ ok: true, loggedIn: true, authenticated: true, role: 'admin',
            user: { id: 'u1', email: 'banc@datatradingpro.com', name: 'Banc', role: 'admin', plan: 'professionnel', active: true } }));
        }
        srv.emit('request', rq, rs);
      });
      await new Promise(r => srvAdmin.listen(PORT + 1, r));
      const page = await nav.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      let R = null, plancherPetit = null;
      try {
        await page.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'networkidle0', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2400));
        const ouvert = await page.evaluate(() => { const b = document.getElementById('widgets-btn'); if (!b) return false; b.click(); return true; });
        if (ouvert) {
          await new Promise(r => setTimeout(r, 2800));
          await page.keyboard.press('Escape');          // le voile du gestionnaire recouvre la page
          await new Promise(r => setTimeout(r, 1200));
          /* ⚠️ ON RELÈVE D'ABORD LE PLANCHER SUR UN ONGLET QUI PORTE DE PETITS WIDGETS, PUIS SUR
             UN ONGLET QUI ADOPTE UNE VUE DU DESK. Le plancher n'est plus uniforme (02/09) : il se
             lit sur `.wdg-vuehost`, donc sur CE QUI EST MONTÉ. Un relevé fait sur un seul onglet
             ne verrait qu'une moitié de la règle — et c'est très exactement l'erreur d'origine,
             qui avait imposé les 760 px d'une vue à une carte n'affichant qu'un compte à rebours. */
          plancherPetit = await page.evaluate(() => {
            const c = document.querySelector('.wdg-card--tabs');
            if (!c) return null;
            return { vue: !!c.querySelector('.wdg-vuehost'), minH: getComputedStyle(c).minHeight };
          });
          const surVue = await page.evaluate(() => {
            const c = document.querySelector('.wdg-card--tabs');
            if (!c) return false;
            const ts = [...c.querySelectorAll('.wdgt-bar .wdgt-tab')];
            const t = ts.find(x => /LISTE FX|BANQUES|BIAIS|TAUX/i.test(x.textContent || ''));
            if (!t) return false;
            t.click(); return true;
          });
          if (surVue) await new Promise(r => setTimeout(r, 2200));
          R = await page.evaluate(() => {
            const cartes = [...document.querySelectorAll('.wdg-card')];
            if (!cartes.length) return null;
            const coupes = [];
            cartes.forEach(c => {
              c.querySelectorAll('*').forEach(e => {
                const d = e.scrollHeight - e.clientHeight;
                /* Le fil d'actualité est EXCLU volontairement : c'est une liste de soixante
                   dépêches, elle doit défiler. L'exclure n'affaiblit pas le contrôle — c'est le
                   seul élément dont le débordement est le comportement voulu.
                   ⚠️ L'EXCLUSION A DÛ ÊTRE RESSERRÉE : elle portait aussi sur `custom-scrollb`, la
                   classe de TOUTE zone à défilement stylé du desk — dont l'horloge mondiale. Le
                   contrôle négatif l'a montré : en remettant le plancher de l'horloge à 320 px,
                   ses quatorze pixels coupés revenaient et le banc restait VERT, parce qu'il
                   s'était interdit de la regarder. On ne nomme donc que les éléments dont le
                   débordement EST le comportement voulu. Une exclusion large est un aveuglement
                   large.
                   ⚠️ ET LA CARTE DU MONDE A DÛ REJOINDRE LA LISTE — au prix de TROIS déploiements
                   bloqués (02/09). Une carte à tuiles glissante déborde son cadre PAR CONSTRUCTION :
                   Leaflet peint autour de la zone visible pour qu'un glissement n'affiche jamais de
                   vide. Le contrôle relevait donc « 34 px cachés » qui sont le fonctionnement normal
                   du composant, pas une information perdue.
                   ET CE DÉFAUT NE POUVAIT PAS SE VOIR EN BAC À SABLE : sans réseau, Leaflet ne
                   charge pas ses tuiles et la carte reste plate. C'est la livraison, qui a le
                   réseau, qui l'a révélé. Leçon retenue : un banc écrit sans réseau ne voit qu'une
                   partie du produit, et ce qu'il ne voit pas peut bloquer la mise en ligne. */
                const cls = String(e.className || '');
                if (d > 8 && e.clientHeight > 40 && !/news-list|leaflet-container|wdg-lfmap/.test(cls)) {
                  coupes.push({ cls: cls.trim().slice(0, 26), cache: d });
                }
              });
            });
            return { nCartes: cartes.length, coupes,
                     hauteurs: cartes.map(c => Math.round(c.getBoundingClientRect().height)),
                     minH: cartes.map(c => getComputedStyle(c).minHeight) };
          });
        }
      } catch (e) { R = null; }
      await page.close();
      /* ⚠️ LE BOUCHON RESTE OUVERT JUSQU'À LA FIN DE LA SECTION. Il était fermé ICI, avant les
         contrôles : la page ouverte plus bas pour mesurer la chaîne de défilement ne pouvait donc
         rien charger et le contrôle s'abstenait — vert, sans avoir rien regardé. */
      if (!R) console.log('\n  ~ Mon Desk indisponible dans ce jeu d\'essai → section abstenue.');
      else {
        console.log('\n  · Mon Desk sur téléphone : ' + R.nCartes + ' carte(s), hauteurs ' + R.hauteurs.join('/') + ' px écran');
        v('une carte à onglets qui ADOPTE une vue du desk a la hauteur que cette vue réclame',
          R.minH.some(x => parseInt(x, 10) >= 700),
          'planchers : ' + R.minH.join(' · ') + ' — une vue adoptée demande jusqu\'à 684 px CSS');
        /* LE PENDANT DU CONTRÔLE PRÉCÉDENT, ET IL A COÛTÉ UNE LIVRAISON (02/09, capture user).
           Le plancher de 760 px avait été posé sur `.wdg-card--tabs` tout court : il s'appliquait
           donc AUSSI à une carte à onglets ne portant que de petits widgets, et le Compte à
           rebours — 186 px nominaux, une seule information — se retrouvait centré au milieu de
           sept cents pixels de vide. Sans ce second contrôle, remettre un plancher uniforme
           laisserait le banc au vert. */
        if (plancherPetit) {
          v('… et une carte à onglets SANS vue adoptée reste à la hauteur d\'une carte ordinaire',
            !plancherPetit.vue && parseInt(plancherPetit.minH, 10) <= 520,
            'onglet de petits widgets : plancher ' + plancherPetit.minH
            + ' (attendu ≈ 490 px = les 460 d\'une carte ordinaire + les 30 de la piste d\'onglets)'
            + (plancherPetit.vue ? ' — une vue était adoptée, le relevé ne prouve rien' : ''));
        }
        v('aucun contenu de widget n\'est coupé (hors fil d\'actualité, qui défile par nature)',
          R.coupes.length === 0,
          R.coupes.map(x => x.cls + ' : ' + x.cache + ' px cachés').join(' · '));
      }
      /* ══ LE DOIGT N'EST PAS ENFERMÉ DANS UN WIDGET (02/09, capture user) ═══════════════════════
         « Je ne peux pas descendre plus bas dans le fil d'actualité, ça me bloque. »
         RELEVÉ, en remontant la chaîne depuis le fil : le vrai ascenseur de la page est
         `.wdg-grid` (394 px à parcourir) ; entre lui et le fil, quatre conteneurs n'ont rien à
         défiler. Et `overscroll-behavior: contain` sur le fil COUPE la chaîne : arrivé au bout de
         ses 2 183 px, le geste ne passe pas au conteneur suivant. Sur un téléphone la carte occupe
         presque tout l'écran — il ne reste que deux minces bandeaux pour atteindre le reste.
         ⚠️ ON MESURE À LA MOLETTE, PAS AU GESTE TACTILE SYNTHÉTIQUE. `Input.synthesizeScrollGesture`
         est capté par les gestionnaires de glisser de la carte (l'en-tête et la piste d'onglets
         SONT des zones de saisie) : mon premier relevé ne bougeait ni avec le défaut ni sans lui,
         et ne prouvait donc rien. La molette suit la même chaîne de défilement et n'est captée par
         personne ici. */
      if (APPAREILS.length) {
        const pageD = await nav.newPage();
        await pageD.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        let D = null;
        try {
          await pageD.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'networkidle0', timeout: 45000 });
          await new Promise(r => setTimeout(r, 2400));
          const ok = await pageD.evaluate(() => { const b = document.getElementById('widgets-btn'); if (!b) return false; b.click(); return true; });
          if (ok) {
            await new Promise(r => setTimeout(r, 2800));
            await pageD.keyboard.press('Escape');
            await new Promise(r => setTimeout(r, 1500));
            const pret = await pageD.evaluate(() => {
              const l = document.querySelector('#view-widgets .news-list');
              const g = document.querySelector('#view-widgets .wdg-grid');
              if (!l || !g) return null;
              l.scrollTop = l.scrollHeight; g.scrollTop = 0;       // fil en bout de course, grille au départ
              const r = l.getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
                       reste: Math.round(g.scrollHeight - g.clientHeight) };
            });
            if (pret && pret.reste > 40) {
              for (let i = 0; i < 5; i++) {
                await pageD.mouse.move(pret.x, pret.y);
                await pageD.mouse.wheel({ deltaY: 260 });
                await new Promise(r => setTimeout(r, 350));
              }
              D = await pageD.evaluate(() => {
                const g = document.querySelector('#view-widgets .wdg-grid');
                const l = document.querySelector('#view-widgets .news-list');
                return { y: Math.round(g.scrollTop), max: Math.round(g.scrollHeight - g.clientHeight),
                         ob: getComputedStyle(l).overscrollBehaviorY };
              });
            }
          }
        } catch (e) { D = null; }
        await pageD.close();
        if (!D) console.log('\n  ~ Chaîne de défilement non mesurable dans ce jeu d\'essai → contrôle abstenu.');
        else {
          console.log('\n  · Défilement : le fil est en bout de course, on continue le geste dessus — la grille avance de '
            + D.y + ' px sur ' + D.max + ' (overscroll du fil : ' + D.ob + ')');
          v('arrivé au bout du fil, le geste passe au desk au lieu de rester bloqué',
            D.y > D.max * 0.5,
            'la grille n\'a bougé que de ' + D.y + ' px sur ' + D.max + ' — le doigt reste enfermé dans le widget');
        }
      }

      /* ══ TOUTE LA BIBLIOTHÈQUE AU FORMAT TÉLÉPHONE (02/09) ═══════════════════════════════════
         « Revoir les blocs sur mobile pour que ce soit adapté en fonction du widget. »
         J'ai commencé par vouloir tirer la hauteur du bloc de la hauteur NOMINALE que chaque
         widget déclare. La mesure a écarté cette piste : la nominale ne prédit rien. Le Compte à
         rebours en déclare 186 et le Sentiment de risque 460, alors que sur téléphone ils perdent
         de l'information au même endroit ; les écarts entre nominale et besoin réel vont de −220
         à +176 px. Une formule assise sur ce nombre aurait rétréci des blocs qui n'en avaient pas
         besoin et laissé courts ceux qui en avaient.
         CE QUE LA MESURE DIT VRAIMENT : au plancher en production, AUCUN widget de la
         bibliothèque ne perd d'information. Les trois plus gourmands demandent 280, 300 et 340 px,
         les trente-sept autres tiennent en 240. Le manque de hauteur n'était donc pas le problème
         — c'était l'EXCÈS (760 px imposés à un widget d'une seule information) et une hauteur vue
         à zéro par les requêtes de conteneur. Les deux sont traités ailleurs.
         Reste à ce que cela DURE : ce contrôle monte les widgets de la bibliothèque un par un au
         format téléphone et refuse qu'un seul soit coupé. Le prochain widget trop gourmand sera
         donc arrêté ici, et non par une capture d'écran d'un client.
         ⚠️ ON NE COMPTE QUE LES VRAIES COUPURES : un élément dont l'`overflow-y` calculé vaut
         `auto` ou `scroll` est un ASCENSEUR, son contenu est FAIT pour défiler. Le compter
         reviendrait à exiger qu'une liste de soixante dépêches tienne en entier dans la carte —
         c'est ce que faisait mon premier relevé, qui « trouvait » cinq widgets trop courts et
         n'en avait vu aucun. */
      if (APPAREILS.length) {
        const LIB = ('amplitude-jour amplitude-seance bandeau-ticker barometre calculatrice calendrier-jour '
          + 'correlations cot-devise cot-inst courbe-taux-us distribution-variations dmx-paire dmx-retail '
          + 'dmx-stats ecart-consensus evenement-rebours force-devises frequence-amplitude graphique hauts-bas '
          + 'heatmap-seance horloge indices-matieres journal-mini matrice-croisee notes perf-semaine radar-biais '
          + 'reunion-bc risque-historique risque-jauge saison saison-courbe serie-indicateur sessions '
          + 'stats-volatilite taux-cb taux-diff ticklist vol-horaire').split(' ');
        /* ⚠️ `actV: 2` EST INDISPENSABLE DEPUIS LE 04/09, ET SON ABSENCE MESURAIT AUTRE CHOSE. Ce jeu
           d'essai décrit un compte DÉJÀ MIGRÉ — c'est bien le cas qu'on veut éprouver. Sans `actV`,
           `ensureDefaultLayout` déclenche sa migration one-shot du 03/08 (« met vue d'ensemble par
           défaut ») et force `active` sur « Vue générale » : le banc mesurait alors le layout PAR
           DÉFAUT, pas le sien, et ne trouvait aucun Compte à rebours.
           Il passait quand même, mais pour une mauvaise raison : `open()` réécrivait ensuite `active`
           avec le layout ★, ce qui ramenait par accident le bon décor. Cette réécriture est le défaut
           corrigé le 04/09 (le modèle de l'utilisateur changeait en naviguant) ; en la retirant, on a
           découvert que ce banc s'appuyait dessus. Le jeu d'essai dit maintenant ce qu'il veut dire. */
        const CFG = { cfg: { active: 'b', gap: 'tight', gapV: 2, deskV: 99, actV: 2, tipSeen: 1, layouts: [{ id: 'b', name: 'Banc', fav: true,
          items: LIB.map(id => ({ w: id, gw: 12, gh: 10 })) }] } };
        const srvLib = require('http').createServer((rq, rs) => {
          const u = rq.url.split('?')[0];
          if (u === '/api/me' || u === '/api/auth/me' || u === '/api/session' || u === '/api/user') {
            rs.writeHead(200, { 'Content-Type': 'application/json' });
            return rs.end(JSON.stringify({ ok: true, loggedIn: true, authenticated: true, role: 'admin',
              user: { id: 'u1', email: 'banc@datatradingpro.com', name: 'Banc', role: 'admin', plan: 'professionnel', active: true } }));
          }
          if (u === '/api/widgets') { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify(CFG)); }
          srv.emit('request', rq, rs);
        });
        await new Promise(r => srvLib.listen(PORT + 2, r));
        const pageL = await nav.newPage();
        await pageL.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        let L = null;
        try {
          await pageL.goto(`http://localhost:${PORT + 2}/index.html`, { waitUntil: 'networkidle0', timeout: 60000 });
          await new Promise(r => setTimeout(r, 2400));
          const ok = await pageL.evaluate(() => { const b = document.getElementById('widgets-btn'); if (!b) return false; b.click(); return true; });
          if (ok) {
            await new Promise(r => setTimeout(r, 4000));
            await pageL.keyboard.press('Escape');
            await new Promise(r => setTimeout(r, 3000));
            L = await pageL.evaluate(() => {
              const coupes = [];
              document.querySelectorAll('#view-widgets .wdg-card').forEach(c => {
                const nom = ((c.querySelector('.wdg-title') || {}).textContent || '?').trim();
                let pire = 0, ou = '';
                c.querySelectorAll('*').forEach(e => {
                  const d = e.scrollHeight - e.clientHeight;
                  if (d <= 8 || e.clientHeight <= 40) return;
                  const oy = getComputedStyle(e).overflowY;
                  if (oy === 'auto' || oy === 'scroll') return;      // ascenseur assumé, pas une coupure
                  /* LA CARTE À TUILES DÉBORDE PAR CONSTRUCTION, et son conteneur est en
                     `overflow: hidden` — le filtre par ascenseur ne l'écarte donc pas. Leaflet peint
                     AUTOUR de la zone visible pour qu'un glissement n'affiche jamais de vide ; ce
                     n'est pas de l'information perdue. Elle est nommée, comme dans le contrôle du
                     desk plus haut, et pour la même raison. Une exclusion nommée, jamais large. */
                  if (/leaflet-container|wdg-lfmap/.test(String(e.className || ''))) return;
                  if (pire < d) { pire = d; ou = String(e.className || e.tagName).trim().slice(0, 30); }
                });
                /* ON NOMME L'ÉLÉMENT COUPÉ, pas seulement le widget. Le premier jet ne rendait que
                   « Sentiment de Risque : 25 px » : le banc échouait en livraison, et il fallait
                   deviner OÙ. Un banc qui ne dit pas où regarder coûte un cycle de déploiement. */
                if (pire > 0) coupes.push(nom + ' : ' + pire + ' px sur `' + ou + '`');
              });
              return { n: document.querySelectorAll('#view-widgets .wdg-card').length, coupes };
            });
          }
        } catch (e) { L = null; }
        await pageL.close();
        srvLib.close();
        if (!L || L.n < 20) console.log('\n  ~ Bibliothèque non montable dans ce jeu d\'essai → contrôle abstenu.');
        else {
          console.log('\n  · Bibliothèque au format téléphone : ' + L.n + ' widget(s) montés, ' + L.coupes.length + ' coupure(s)');
          v('aucun widget de la bibliothèque ne perd d\'information sur téléphone',
            L.coupes.length === 0, L.coupes.slice(0, 8).join(' · '));
        }
      }
      srvAdmin.close();
    }
  } finally {
    if (nav) await nav.close();
    srv.close();
  }

  console.log(ko ? '\n✗ ' + ko + ' ÉCHEC(S)\n' : '\n✓ le desk tient dans un téléphone.\n');
  process.exit(ko ? 1 : 0);
})();

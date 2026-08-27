#!/usr/bin/env node
/* ═══ RECAPTURER LES VISUELS DU SITE VITRINE, DEPUIS LE DESK RÉEL ══════════════════════════════
   09/09, constat de l'utilisateur : « t'as pas mis à jour comme demandé, il y a 3 icônes
   maintenant à côté du logo ». En ouvrant les fichiers, plus grave que « périmé » :
     · `desk-accueil.jpg` affichait « Bonsoir JustOneTrader, » EN CLAIR sur la page d'accueil
       publique — le nom que le propriétaire a demandé de retirer partout du site vitrine —,
       l'ancien mot-symbole « DataTradingPro » et une topbar qui n'existe plus ;
     · `hero-desk.jpg` montre des onglets EN ANGLAIS (MEWS, CALENDAR, FX LIST, WEEK AHEAD…) alors
       que le produit est en français de bout en bout.
   Une capture faite à la main se re-périme à la première évolution du desk, et personne ne le voit
   avant un client. Ce script la REFAIT : il ouvre le VRAI desk dans Chromium, avec une API
   bouchonnée et un compte de démonstration NEUTRE, et écrit les fichiers du site vitrine.

   ⚠️ AUCUNE DONNÉE RÉELLE, AUCUN NOM RÉEL. Le bouchon sert un compte « Trader » et des dépêches
   écrites ici. C'est la seule façon d'avoir une capture publiable : une capture d'écran du desk en
   production porterait le nom du compte connecté, ses layouts et son fil.

     node scripts/vitrine-captures.js            → écrit landing/img/*.jpg
     node scripts/vitrine-captures.js --check    → ne rien écrire, juste vérifier que ça rend

   Sans Chromium, le script S'ABSTIENT (code 0) : il tourne là où il peut. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const IMG = path.join(RACINE, 'landing', 'img');
const PORT = 4617;
const CHECK = process.argv.includes('--check');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function trouverNavigateur() {
  const cands = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try {
      for (const d of fs.readdirSync(b)) {
        for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) cands.push(path.join(b, d, rel));
      }
    } catch {}
  }
  return cands.find(c => c && fs.existsSync(c)) || null;
}

/* ── LE FIL DE DÉMONSTRATION ───────────────────────────────────────────────────────────────────
   Écrit à la main, et pas repris du jeu d'essai de `desk-verif.js` : celui-là numérote ses titres
   (« Le dollar progresse (17) ») pour éprouver la pagination, ce qui est parfait pour un banc et
   ridicule sur une page de vente. Les titres ci-dessous sont ceux qu'un desk voit réellement : des
   dépêches d'agence, en anglais comme le fil les reçoit, avec leurs rubriques françaises. */
const T = Date.now();
const min = n => T - n * 60000;
const FIL = [
  { headline: 'Fed\'s Hammack says "now" is the time to tackle inflation', category: 'Fed', source: 'FinancialJuice', priority: 'high', urgent: true, tags: ['USD'], t: 4 },
  { headline: 'US Core PCE Price Index 2.6% vs 2.7% expected', category: 'US Data', source: 'Reuters', priority: 'high', _highImpact: true, tags: ['USD'], t: 12 },
  { headline: 'ECB\'s Lagarde: wage growth is moderating faster than expected', category: 'Central Banks', source: 'Bloomberg', tags: ['EUR'], t: 21 },
  { headline: 'Japan\'s top banks regain access to dollar funding after freeze', category: 'Global News', source: 'Nikkei', tags: ['JPY'], t: 28 },
  { headline: 'Brent crude holds above $78 as OPEC+ signals steady output', category: 'Energy & Power', source: 'Reuters', tags: ['OIL'], t: 35 },
  { headline: 'Canada\'s Finance Minister: tariffs on steel imports under review', category: 'Geopolitical', source: 'Reuters', tags: ['CAD'], t: 44 },
  { headline: 'German Ifo business climate improves for a third month', category: 'EU Data', source: 'Bloomberg', tags: ['EUR'], t: 52 },
  { headline: 'BoE\'s Mann speaks on the outlook for UK inflation', category: 'Central Banks', source: 'FinancialJuice', tags: ['GBP'], t: 61 },
  { headline: 'Gold steadies near record as real yields drift lower', category: 'Market Analysis', source: 'MarketWatch', tags: ['XAU'], t: 70 },
  { headline: 'Australian retail sales rebound 0.6% MoM in July', category: 'FX Flows', source: 'Reuters', tags: ['AUD'], t: 83 },
  { headline: 'US 2-year yield slips to 3.71% after dovish Fed remarks', category: 'US Data', source: 'Bloomberg', tags: ['USD'], t: 95 },
  { headline: 'Swiss franc firms as risk appetite fades into the close', category: 'FX Flows', source: 'Reuters', tags: ['CHF'], t: 108 },
  { headline: 'Oil inventories draw more than forecast, EIA reports', category: 'Energy & Power', source: 'Reuters', tags: ['OIL'], t: 121 },
  { headline: 'Euro holds gains ahead of Friday\'s flash CPI release', category: 'FX Flows', source: 'MarketWatch', tags: ['EUR'], t: 134 },
  { headline: 'China industrial profits rise 3.1% year-on-year', category: 'Global News', source: 'Reuters', tags: ['CNY'], t: 150 },
  { headline: 'Nasdaq futures edge higher as chip stocks stabilise', category: 'Market Analysis', source: 'Bloomberg', tags: ['NAS'], t: 166 },
  { headline: 'Norway\'s sovereign fund trims US equity exposure', category: 'Global News', source: 'Reuters', tags: ['NOK'], t: 181 },
  { headline: 'Mexican peso extends rally on carry demand', category: 'FX Flows', source: 'Bloomberg', tags: ['MXN'], t: 198 },
  { headline: 'UK mortgage approvals hold near a two-year high', category: 'EU Data', source: 'Reuters', tags: ['GBP'], t: 215 },
  { headline: 'Treasury refunding announcement lands in line with estimates', category: 'US Data', source: 'MarketWatch', tags: ['USD'], t: 232 },
].map((x, i) => ({
  id: 'v' + i, timestamp: min(x.t),
  time: new Date(min(x.t)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  description: '', priority: x.priority || 'normal', ...x,
}));
const UTIL = { id: 'demo', email: 'demo@datatradingpro.com', name: 'Trader', role: 'client', plan: 'professionnel', active: true, expiry: null };

function serveur() {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.startsWith('/api/')) {
      if (u === '/api/news') return j({ items: FIL, total: FIL.length });
      if (u === '/api/news/history') return j({ items: [], total: FIL.length });
      if (u === '/api/session-wraps') return j([]);
      // `loggedIn` est LE champ que lisent les gardes d'authentification : sans lui la page part
      // sur /login et on capturerait un écran de connexion en croyant capturer le desk.
      return j({ items: [], total: 0, ok: true, loggedIn: true, authenticated: true, user: UTIL, ...UTIL });
    }
    const f = path.join(PUB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}

/* Ce qu'on masque avant de déclencher l'obturateur. Ce ne sont pas des retouches : ce sont des
   éléments qui n'existent QUE parce que le desk tourne contre un bouchon (pas de WebSocket, pas de
   cotations), et qui mentiraient sur le produit s'ils apparaissaient sur une page de vente. */
const CACHER = `
  /* Le badge d'état du flux temps réel (app.js, showStatus → .connection-status). Il n'existe ici
     que parce qu'il n'y a pas de WebSocket derrière le bouchon, et il est INJECTÉ TARDIVEMENT
     (à la première tentative de reconnexion) : c'est pour ça qu'on l'écarte par une règle CSS et
     non par un retrait ponctuel, qui laisserait passer celui qui arrive après. */
  .connection-status { display: none !important; }
  .dtp-toast, .toast, #dtp-toasts { display: none !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
`;

/* ⚠️ CE QUE CET ENVIRONNEMENT NE PEUT PAS RENDRE, ET POURQUOI ON LE MASQUE PLUTÔT QUE LE MONTRER.
   La CARTE DES SESSIONS est dessinée par amCharts, chargé depuis `cdn.amcharts.com` ; les drapeaux
   viennent de `flagcdn.com`. Les deux sont des hôtes EXTERNES, et cette capture tourne derrière une
   passerelle qui les refuse. Le panneau se peint donc en rectangle noir — un grand vide au milieu
   d'une page de vente, qui dit du produit l'inverse de la vérité.
   On retire donc le panneau AVANT l'obturateur. Ce n'est pas une retouche : c'est refuser de
   publier une avarie de l'atelier. La capture montre moins que le desk, jamais autre chose. */
async function masquerCeQuiNeRendPas(pg) {
  return pg.evaluate(() => {
    const titres = [...document.querySelectorAll('*')].filter(e =>
      e.children.length === 0 && /CARTE DES SESSIONS/i.test(e.textContent || ''));
    let n = 0;
    for (const t of titres) {
      // On remonte jusqu'au bloc qui porte le panneau entier (en-tête + corps), sans sortir du desk.
      let p = t;
      for (let k = 0; k < 6 && p && p.parentElement; k++) {
        p = p.parentElement;
        const r = p.getBoundingClientRect();
        if (r.height > 120) { p.style.display = 'none'; n++; break; }
      }
    }
    return n;
  });
}

(async () => {
  const bin = trouverNavigateur();
  if (!bin) { console.log('[Vitrine] Chromium absent → capture abstenue (pas un échec).'); process.exit(0); }
  let pup;
  try { pup = require('puppeteer-core'); }
  catch { console.log('[Vitrine] puppeteer-core absent → capture abstenue.'); process.exit(0); }

  const srv = serveur();
  await new Promise(r => srv.listen(PORT, r));
  const nav = await pup.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=2'] });
  let ko = 0;
  try {
    const pg = await nav.newPage();
    await pg.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });   // largeur CONFORTABLE : c'est là que le desk se range correctement
    await pg.setRequestInterception(true);
    pg.on('request', r => { const u = r.url(); (u.startsWith('http://localhost') || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
    await pg.goto('http://localhost:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 7000));                                 // le fil, l'horloge et la carte se peignent
    await pg.addStyleTag({ content: CACHER });
    const masques = await masquerCeQuiNeRendPas(pg);
    console.log('  · panneaux masqués (assets externes indisponibles) : ' + masques);
    await new Promise(r => setTimeout(r, 600));

    const etat = await pg.evaluate(() => ({
      url: location.pathname,
      lignes: document.querySelectorAll('.news-item[data-id]').length,
      marque: (document.querySelector('.topbar .logo, .tb-logo, #tb-logo') || {}).textContent || '',
      texte: document.body.innerText.slice(0, 4000),
      /* ⚠️ « MOT DE PASSE » NE PROUVE RIEN. Le premier jet cherchait ce mot dans le texte de la
         page pour détecter l'écran de connexion : il tombait sur « Mot de passe et sécurité », le
         titre d'une section du panneau de réglages, présent dans le desk lui-même. Le contrôle
         rougissait sur une page parfaitement correcte. La vraie question est : y a-t-il un champ de
         mot de passe VISIBLE ? On la pose. */
      champMdp: [...document.querySelectorAll('input[type="password"]')].some(e => {
        const r = e.getBoundingClientRect();
        /* ⚠️ AVOIR UNE TAILLE NE VEUT PAS DIRE ÊTRE À L'ÉCRAN. Les panneaux latéraux du desk sont
           déplacés hors cadre par un `transform` : leurs champs gardent une boîte de mise en page
           parfaitement mesurable. Le deuxième jet de ce contrôle tombait donc dessus. On demande
           l'intersection réelle avec la fenêtre. */
        return r.width > 10 && r.height > 10
          && r.left < innerWidth && r.right > 0 && r.top < innerHeight && r.bottom > 0;
      }),
    }));
    console.log('  · page          : ' + etat.url);
    console.log('  · lignes du fil : ' + etat.lignes);

    /* GARDES AVANT ÉCRITURE. Une capture vide ou portant un nom réel est PIRE que l'ancienne : elle
       part en production sans que personne ne la regarde. On refuse d'écrire plutôt que de publier. */
    const g = (nom, cond, det) => { if (!cond) { ko++; console.log('  ✗ ' + nom + (det ? ' → ' + det : '')); } else console.log('  ✓ ' + nom); };
    g('le desk est bien affiché (pas la page de connexion)', etat.url === '/' && !etat.champMdp,
      etat.url + (etat.champMdp ? ' · un champ de mot de passe est visible' : ''));
    g('le fil porte des lignes', etat.lignes >= 10, String(etat.lignes));
    g('aucun nom de marque tiers n\'apparaît', !/JustOneTrader/i.test(etat.texte));
    g('l\'interface est en français', /CALENDRIER|ACTUS|BIAIS/.test(etat.texte));
    g('aucun message d\'erreur visible', !/Erreur de connexion|indisponible/i.test(etat.texte),
      (etat.texte.match(/.{0,40}(Erreur de connexion|indisponible).{0,30}/) || [''])[0]);

    if (ko) { console.log('\n✗ ' + ko + ' garde(s) en échec — AUCUN fichier écrit.'); }
    else if (CHECK) { console.log('\n✓ rendu conforme (--check : rien écrit).'); }
    else {
      /* ⚠️ LE CADRAGE EST DICTÉ PAR LA CONTRAINTE CI-DESSUS, PAS PAR L'ESTHÉTIQUE. La colonne de
         droite (carte des sessions, drapeaux) dépend d'assets externes que cette passerelle refuse.
         On capture donc à la LARGEUR où le desk range ses panneaux en UNE colonne : le cadre est
         alors entièrement rempli par le fil, qui se peint sans rien d'externe, au lieu de garder un
         grand vide noir à droite. Rien n'est ajouté, rien n'est déguisé — on cadre sur ce qui rend.
         Pour l'écran COMPLET il faut une machine qui atteigne cdn.amcharts.com et flagcdn.com. */
      const cible = path.join(IMG, 'desk-accueil.jpg');
      /* CADRAGE SUR LA COLONNE DU FIL. On mesure la VRAIE boîte du panneau et on coupe au format de
         la vitrine (1064×535). Le premier jet coupait sur le premier ancêtre trouvé — 664 px, soit
         un gros plan sur trois dépêches : on mesure donc le panneau du fil lui-même, celui qui porte
         l'en-tête « FIL D'ACTUALITÉ EN DIRECT », et on prend toute sa largeur. */
      const droite = await pg.evaluate(() => {
        const t = [...document.querySelectorAll('*')].find(e =>
          e.children.length === 0 && /FIL D'ACTUALIT/i.test(e.textContent || ''));
        let p = t;
        for (let k = 0; k < 8 && p && p.parentElement; k++) {
          p = p.parentElement;
          const r = p.getBoundingClientRect();
          if (r.width > 700 && r.height > 400) return Math.round(r.right);
        }
        return 0;
      });
      const L = droite || 1000;
      const clip = { x: 0, y: 0, width: L, height: Math.round(L * 535 / 1064) };
      console.log('  · cadrage : ' + clip.width + '×' + clip.height + ' (colonne du fil)');
      await pg.screenshot({ path: cible, type: 'jpeg', quality: 92, clip });
      const ko2 = Math.round(fs.statSync(cible).size / 1024);
      console.log('\n✓ ' + path.relative(RACINE, cible) + ' réécrite (' + ko2 + ' ko)');
    }
  } catch (e) { ko++; console.log('  ✗ capture impossible : ' + e.message); }
  finally { await nav.close(); srv.close(); }
  process.exit(ko ? 1 : 0);
})();

#!/usr/bin/env node
/**
 * scripts/desk-verif.js — LE DESK TOURNE-T-IL VRAIMENT ?
 *
 * POURQUOI (25/08). Une variable supprimée en trop a vidé le FIL D'ACTUALITÉ en production. Aucun
 * contrôle du projet ne pouvait le voir : `node -c` ne lit que la grammaire, et js-verif (posé le
 * même jour) n'attrape que les identifiants déclarés NULLE PART — pas une erreur de portée, pas un
 * appel à une fonction disparue, pas un rendu qui produit zéro ligne.
 *
 * Ce contrôle-ci fait la seule chose qui tranche : il OUVRE LE DESK dans un vrai Chromium, avec une
 * API bouchonnée, et vérifie que les lignes s'affichent. Une exception dans la construction d'une
 * ligne, une fonction manquante, un filtre qui avale tout : tout cela se voit ici, et nulle part
 * ailleurs.
 *
 *   node scripts/desk-verif.js
 *
 * Sans navigateur disponible, le contrôle S'ABSTIENT (code 0) au lieu de bloquer : il tourne là où
 * il peut, il ne rend jamais un poste de travail inutilisable.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4599;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

// Chromium : chemins connus, du plus probable au moins. Absent → on s'abstient.
function trouverNavigateur() {
  const bases = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  const candidats = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const b of bases) {
    try {
      for (const d of fs.readdirSync(b)) {
        for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
          candidats.push(path.join(b, d, rel));
        }
      }
    } catch {}
  }
  return candidats.find(c => c && fs.existsSync(c)) || null;
}

const T = Date.now();
/* JEU D'ESSAI. Cinq entrées « caractérisées » pour le rendu (dont une ANALYSE DU DESK et une dépêche
   urgente, qui doivent ressortir en rouge), puis du volume : 240 dépêches réparties sur DEUX
   journées de Paris. Ce volume est là pour le bouton « Charger plus », qui doit dérouler la journée
   ENTIÈRE — sans volume, on ne testerait qu'un bouton qui n'a rien à charger. */
function midiParis(joursEnArriere) {
  const d = new Date(T);
  d.setUTCDate(d.getUTCDate() - joursEnArriere);
  d.setUTCHours(10, 0, 0, 0);            // 12h à Paris en été : jamais à cheval sur un changement de jour
  return d.getTime();
}
const J0 = midiParis(0), J1 = midiParis(1);
/* ⚠️ LES RUBRIQUES DOIVENT ÊTRE CELLES DU PRODUIT, ET C'EST TOUT SAUF UN DÉTAIL (26/08).
   Ce jeu d'essai portait « Forex », « Commodities », « Central Banks », « Equities » — les mots
   qu'on emploie naturellement en parlant du desk, et AUCUN d'eux n'existe dans `INTERNAL_CATS`
   (app.js). Or `getFilteredItems` écarte sans un mot toute dépêche dont la rubrique n'y figure
   pas : 100 dépêches entraient, `getFilteredItems()` en rendait ZÉRO, et le panneau classique
   `#news-list` restait sur son spinner pendant TOUT le contrôle.
   Le banc restait vert quand même — les 25 lignes qu'il comptait venaient de la copie widget
   `.news-list.wdg-news`, qui ne passe pas par ce filtre. Autrement dit : le contrôle central du
   projet éprouvait un chemin sur deux, et la panne du 25/08 aurait pu se rejouer dans le panneau
   classique sans que rien ne s'allume. Les rubriques ci-dessous sont donc les VRAIES.
   ⚠️ `Economic Commentary` est la seule rubrique COUPÉE par défaut (migration one-shot) : l'employer
   dans un jeu d'essai, c'est écrire des dépêches invisibles. */
const CATS = ['Fed', 'US Data', 'FX Flows', 'Market Analysis', 'Geopolitical', 'Global News', 'EU Data', 'Energy & Power'];
const CARACT = [
  { id: 'n1', headline: 'US ADP Employment Change beats forecast', description: 'Actual: 104K Forecast: 75K',
    category: 'US Data', source: 'Reuters', time: '16:09', timestamp: J0, priority: 'normal', tags: ['USD'] },
  { id: 'eva-adp-1', headline: 'ANALYSE ADP US : Emploi privé US ADP en hausse, marché équilibré', description: '<p>Le chiffre…</p>',
    category: 'US Data', source: 'DTP Markets', time: '16:09', timestamp: J0 - 1000, priority: 'high',
    _eventAnalysis: true, _reportType: 'ADP', _pair: 'EURUSD', tags: ['USD'] },
  { id: 'fj-1', headline: 'BREAKING: Fed officials signal caution', description: '…', category: 'Fed',
    source: 'FinancialJuice', time: '15:40', timestamp: J0 - 2000, urgent: true, priority: 'high', tags: ['USD'] },
  { id: 'n2', headline: 'Euro steady ahead of German Ifo', description: '…', category: 'EU Data', source: 'Reuters',
    time: '15:10', timestamp: J0 - 3000, priority: 'normal', tags: ['EUR'] },
  { id: 'n3', headline: 'Oil edges higher on supply concerns', description: '…', category: 'Energy & Power', source: 'Reuters',
    time: '14:55', timestamp: J0 - 4000, priority: 'normal', tags: ['OIL'] },
];
/* Le fil DÉDOUBLONNE les titres quasi identiques (_newsKey) : un jeu d'essai fait de « dépêche
   numéro 1, 2, 3… » se serait effondré sur une seule ligne, et le contrôle aurait mesuré le
   dédoublonnage en croyant mesurer la pagination. Les titres sont donc réellement distincts. */
const SUJ = ['Le dollar', 'L euro', 'La livre', 'Le yen', 'Le franc suisse', 'Le dollar canadien', 'Le peso mexicain',
  'Le Brent', 'L or', 'Le cuivre', 'Le Nasdaq', 'Le Bund 10 ans', 'Le Treasury 2 ans', 'Le CAC 40', 'Le Nikkei', 'Le Bitcoin'];
const VRB = ['progresse', 'recule', 'se stabilise', 'efface ses gains', 'atteint un plus haut', 'touche un plus bas',
  'reste sous pression', 'rebondit', 'consolide', 'accelere'];
const CTX = ['avant la Fed', 'apres l inflation allemande', 'sur fond de tensions commerciales', 'malgre un PMI decevant',
  'porte par les rendements', 'dans un marche etroit', 'apres les minutes de la BCE', 'sur des flux de fin de mois',
  'avant le rapport emploi', 'sur un dollar plus ferme'];
const VOLUME = [];
let _v = 0;
function depeche(prefixe, ts) {
  const i = _v++;
  return { id: prefixe + '-' + i,
    headline: `${SUJ[i % SUJ.length]} ${VRB[(i / SUJ.length | 0) % VRB.length]} ${CTX[(i / (SUJ.length * VRB.length) | 0) % CTX.length]} (${i})`,
    description: 'Contexte de marche pour le controle automatique.',
    category: CATS[i % CATS.length],
    source: ['Reuters', 'Bloomberg', 'MarketWatch'][i % 3],
    time: '12:00', timestamp: ts, priority: 'normal', tags: [['USD', 'EUR', 'GBP', 'JPY'][i % 4]] };
}
for (let k = 0; k < 160; k++) VOLUME.push(depeche('j0', J0 - 10000 - k * 60000));
for (let k = 0; k < 80; k++) VOLUME.push(depeche('j1', J1 - k * 60000));
const TOUT = [...CARACT, ...VOLUME].sort((a, b) => b.timestamp - a.timestamp);
const NB_J0 = TOUT.filter(i => i.timestamp > J1 + 6 * 3600000).length;   // tout ce qui est de la journée du jour
const NEWS = TOUT.slice(0, 100);                                          // le 1er lot, comme /api/news
const UTIL = { id: 'u1', email: 'verif@dtp', name: 'Verif', role: 'admin', plan: 'pro', active: true, expiry: null };

/* Récaps de séance servis à l'onglet ANALYSTES : de quoi remplir la liste tout de suite. */
const WRAPS = Array.from({ length: 6 }, (_, k) => ({
  id: 'sw' + k, title: 'Asia-Pacific market moving news wrap ' + (k + 1), headline: 'Asia-Pacific market moving news wrap ' + (k + 1),
  url: 'https://investinglive.com/news/wrap-' + k + '/', timestamp: J0 - k * 3600000,
  session: 'Asia-Pacific', description: '', _source: 'investinglive',
}));
function serveur() {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.startsWith('/api/')) {
      if (u === '/api/news') return j({ items: NEWS, total: TOUT.length });
      if (u === '/api/news/history') {
        const q = new URL(req.url, 'http://x').searchParams;
        const before = parseInt(q.get('before')) || Date.now();
        const limit = Math.min(parseInt(q.get('limit')) || 100, 200);
        // Le vrai serveur renvoie « strictement plus ancien que `before` », trié du plus récent au
        // plus ancien. On le reproduit tel quel, doublons de frontière compris.
        return j({ items: TOUT.filter(i => i.timestamp < before).slice(0, limit), total: TOUT.length });
      }
      /* ONGLET ANALYSTES : trois sources rapides, UNE LENTE. C'est la forme réelle du problème du
         26/08 (« le chargement est long ») — /api/weekly-reports attendait Supabase pendant que les
         trois autres répondaient depuis leur cache, et le desk attendait les quatre. On reproduit
         donc la lenteur ici, exprès : sans elle, le contrôle passerait même avec le défaut. */
      if (u === '/api/session-wraps') return j(WRAPS);
      if (u === '/api/bank-research') return j([]);
      if (u === '/api/fx-daily')      return j([]);
      if (u === '/api/weekly-reports') return setTimeout(() => j({ items: [], generating: false }), 3000);
      // `loggedIn` est LE champ que lisent toutes les gardes d'authentification (index.html + app.js) :
      // sans lui la page part sur /login et le contrôle mesure une page vide en croyant tester le desk.
      return j({ items: [], total: 0, ok: true, loggedIn: true, authenticated: true, user: UTIL, ...UTIL });
    }
    const f = path.join(PUB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}

/* ── PHASE 1 : LA LOGIQUE DU BOUTON, SANS NAVIGATEUR ────────────────────────────────────────────
   La décision « quelle journée le prochain clic déroule-t-il ? » est du calcul pur : elle se prouve
   ici, exactement, sur des cas construits. On extrait le VRAI bloc de app.js — pas une copie — pour
   que le contrôle suive le code et non une transcription qui dériverait. */
function phaseLogique() {
  let ko = 0;
  const v = (nom, cond, detail) => { if (cond) console.log('  ✓ ' + nom); else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
  const src = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
  const i = src.indexOf('const _jourParis = ts =>');
  const j = src.indexOf('async function loadMore()');
  if (i < 0 || j < 0) { console.log('  ✗ bloc « Charger plus » introuvable dans app.js'); return 1; }
  const API = new Function(src.slice(i, j) + '\nreturn { _cibleChargerPlus, _libelleChargerPlus, _jourParis, _jourVeille };')();
  const midi = (jour, h) => Date.UTC(2026, 7, jour, h - 2, 0, 0);   // h = heure de Paris en été
  const item = (jour, h) => ({ timestamp: midi(jour, h) });
  // Journée du 25 partiellement montrée (3 sur 5) → le clic doit dérouler CETTE journée.
  const partiel = [item(25, 18), item(25, 16), item(25, 14), item(25, 12), item(25, 10)];
  let c = API._cibleChargerPlus(partiel, 3);
  v('journée entamée → on la déroule elle', c && c.jour === '2026-08-25' && c.memeJour === true, JSON.stringify(c));
  v('le bouton le dit', API._libelleChargerPlus(c) === 'Voir toute la journée', API._libelleChargerPlus(c));
  // Journée du 25 entièrement montrée, la veille est déjà en mémoire → on vise la veille.
  const complet = [item(25, 18), item(25, 16), item(24, 20), item(24, 18)];
  c = API._cibleChargerPlus(complet, 2);
  v('journée finie → on vise la précédente', c && c.jour === '2026-08-24' && c.memeJour === false, JSON.stringify(c));
  v('le bouton nomme cette journée', /^Charger .*24 août/.test(API._libelleChargerPlus(c)), API._libelleChargerPlus(c));
  // Journée finie et RIEN d'autre en mémoire → on vise quand même la veille (elle sera cherchée au serveur).
  c = API._cibleChargerPlus([item(25, 18), item(25, 16)], 2);
  v('rien en mémoire au-delà → on vise quand même la veille', c && c.jour === '2026-08-24', JSON.stringify(c));
  /* ── LE SAUT DE JOURNÉE (corrigé le 26/08) ────────────────────────────────────────────────────
     Le cas exact du produit : le premier lot fait 100 éléments, la journée en compte davantage au
     serveur. En mémoire, tout est montré et rien n'est caché — la seule chose qui distingue « la
     journée est finie » de « je n'en ai reçu qu'un bout », c'est le RESTE AU SERVEUR. Sans lui, le
     bouton annonçait la veille et déroulait deux journées d'un coup. */
  const lot = [item(25, 18), item(25, 16), item(25, 14)];
  c = API._cibleChargerPlus(lot, 3, true);
  v('tout montré mais le serveur en a encore → on reste sur CETTE journée',
    c && c.jour === '2026-08-25' && c.memeJour === true, JSON.stringify(c));
  v('… et le bouton ne promet pas la veille', API._libelleChargerPlus(c) === 'Voir toute la journée', API._libelleChargerPlus(c));
  c = API._cibleChargerPlus(lot, 3, false);
  v('historique épuisé → on passe bien à la veille', c && c.jour === '2026-08-24' && c.memeJour === false, JSON.stringify(c));
  // Le reste au serveur ne doit RIEN changer quand la mémoire tranche déjà : la veille est là.
  c = API._cibleChargerPlus(complet, 2, true);
  v('la veille déjà en mémoire l\'emporte sur le reste au serveur', c && c.jour === '2026-08-24', JSON.stringify(c));
  // La veille d'un 1er du mois est le dernier jour du mois précédent.
  v('le calcul de la veille passe les changements de mois', API._jourVeille('2026-09-01') === '2026-08-31', API._jourVeille('2026-09-01'));
  v('…et les changements d\'année', API._jourVeille('2027-01-01') === '2026-12-31', API._jourVeille('2027-01-01'));
  // Une publication asiatique de 01h à Paris appartient à SA journée parisienne, pas à la veille UTC.
  v('la journée se compte à Paris', API._jourParis(Date.UTC(2026, 7, 24, 23, 30)) === '2026-08-25', API._jourParis(Date.UTC(2026, 7, 24, 23, 30)));
  v('liste vide → pas de cible', API._cibleChargerPlus([], 0) === null);
  return ko;
}

(async () => {
  console.log('\n── Logique du bouton « Charger plus » (calcul pur) ──');
  const koLogique = phaseLogique();
  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Desk] aucun Chromium trouvé → phase navigateur abstenue (ce n\'est pas un échec).\n'); process.exit(koLogique ? 1 : 0); }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { console.log('\n[Desk] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(koLogique ? 1 : 0); }

  const srv = serveur();
  await new Promise(r => srv.listen(PORT, r));
  let ko = 0, nav;
  const verif = (nom, cond, detail) => { if (cond) console.log('  ✓ ' + nom); else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
  try {
    nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    const fatales = [];
    page.on('pageerror', e => fatales.push(e.message));
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 4000));
    /* ⚠️ ON COMPTE DANS UN PANNEAU, PLUS DANS TOUT LE DOCUMENT (26/08). Le fil est rendu DEUX
       fois — le panneau classique `#news-list` et la copie du widget `.news-list.wdg-news`, qui
       est celle que le lecteur voit en mode widget (le mode par défaut). Tant que le jeu d'essai
       portait des rubriques hors vocabulaire, le panneau classique restait vide et un compte
       global tombait juste par accident ; les rubriques corrigées, le même compte a doublé —
       « 4 rouges au lieu de 2 », « 25 doublons » — sans qu'aucun défaut n'existe. Chaque nombre
       est donc rapporté à SON panneau, et les deux sont éprouvés. */
    const d = await page.evaluate(() => {
      const cl = document.getElementById('news-list');
      const wd = document.querySelector('.news-list.wdg-news');
      const n = (r, sel) => (r ? r.querySelectorAll(sel).length : -1);
      return {
        page: location.pathname,
        liste: !!cl,
        lignes: n(cl, '.news-item'),
        widget: n(wd, '.news-item'),
        rouges: n(cl, '.news-item--breaking'),
        rougesWidget: n(wd, '.news-item--breaking'),
        enTetes: n(cl, '.date-header'),
        vide: n(cl, '.empty-state'),
      };
    });
    console.log('\n── Desk ouvert dans Chromium, API bouchonnée ──');
    verif('la page reste sur le desk (pas de renvoi vers /login)', d.page === '/index.html', d.page);
    verif('le conteneur du fil existe', d.liste);
    verif('le fil affiche des actualités', d.lignes >= 20, d.lignes + ' ligne(s) rendue(s) dans #news-list');
    /* Le mode widget est le mode PAR DÉFAUT : cette copie-ci est celle qu'un client a sous les
       yeux. Elle se remplit par son propre chemin — la vérifier à part, c'est éprouver les DEUX
       rendus au lieu d'un seul, ce qui est précisément ce que ce banc a manqué jusqu'ici. */
    verif('… et la copie du widget, celle que le lecteur voit, aussi', d.widget >= 20, d.widget + ' ligne(s) dans .wdg-news');
    verif('l\'en-tête de journée est là', d.enTetes >= 1, String(d.enTetes));
    verif('aucun message « aucun élément »', d.vide === 0);
    // Une analyse du desk et une dépêche urgente : deux lignes rouges attendues.
    verif('les news majeures ressortent en rouge', d.rouges === 2, d.rouges + ' rouge(s) au lieu de 2 dans #news-list');
    verif('… dans la copie du widget aussi', d.rougesWidget === 2, d.rougesWidget + ' rouge(s) au lieu de 2 dans .wdg-news');
    verif('aucune erreur d\'exécution', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));

    /* ── ANDROID : UNE NOTIFICATION SYSTÈME QUI ÉCHOUE NE FIGE PAS LE FIL (04/09) ────────────────
       Chrome sur Android REFUSE `new Notification(...)` — il impose
       `ServiceWorkerRegistration.showNotification()` et lève « Illegal constructor ». L'appel
       n'était protégé par aucun try/catch et se trouvait à l'avant-dernière ligne de `npPush` :
       l'exception remontait jusqu'à l'appelant, qui n'appelait donc plus `renderNews()`. Le fil
       restait sur son état précédent.
       ⚠️ ET LA PANNE ÉTAIT INDÉTECTABLE AU BUREAU, pour deux raisons qui se cumulent : ce chemin ne
       s'exécute QUE si le lot contient un élément prioritaire ou urgent, et le constructeur ne lève
       QUE sur Android. Sur un desktop, avec un lot ordinaire, tout marche. Le client Android voyait
       son fil se figer précisément sur la dépêche qu'il attendait — et jamais sur les autres.
       On reproduit donc les DEUX conditions à la fois : constructeur qui lève, élément urgent. */
    const andro = await page.evaluate(() => {
      const out = { avant: document.querySelectorAll('.news-item').length, jete: null, retour: null, apres: null };
      const vrai = window.Notification;
      try {
        // Le constructeur d'Android, à l'identique : il lève, toujours.
        function NotifAndroid() { throw new TypeError("Failed to construct 'Notification': Illegal constructor."); }
        NotifAndroid.permission = 'granted';
        NotifAndroid.requestPermission = () => Promise.resolve('granted');
        window.Notification = NotifAndroid;
        const urgent = [{ id: 'and-' + Date.now(), headline: 'Test Android', timestamp: Date.now(),
          priority: 'high', urgent: true, source: 'Test', category: 'Global News' }];
        try { out.retour = npPush(urgent); out.jete = false; }
        catch (e) { out.jete = true; out.err = String(e && e.message); }
      } finally { window.Notification = vrai; }
      out.apres = document.querySelectorAll('.news-item').length;
      return out;
    });
    verif('un constructeur de notification qui LÈVE ne fait pas remonter d\'exception',
      andro.jete === false, andro.err || 'npPush a laissé passer l\'exception');
    verif('… npPush rend bien sa valeur de retour (l\'appelant continue son travail)',
      typeof andro.retour === 'number', String(andro.retour));
    verif('… et le fil n\'a pas perdu ses lignes au passage',
      andro.apres >= andro.avant, andro.avant + ' → ' + andro.apres);

    /* ── LA FRISE DES SESSIONS : L'ÉTAT SE LIT AU BOUT DE LA LIGNE ─────────────────────────────
       01/09, référence fournie. Le badge était collé au nom, en petit texte gris : sur quatre
       places, l'œil devait le chercher à quatre abscisses différentes, les noms n'ayant pas la même
       longueur. Il passe au bout, à droite, où il forme une COLONNE — quatre états se lisent d'un
       seul balayage vertical.
       ⚠️ ET LE CONTRÔLE VÉRIFIE AUSSI CE QU'ON N'A PAS FAIT : la référence affiche « CLOSED » en
       ROUGE. La charte du projet réserve le rouge au baissier et à l'alerte ; un marché fermé n'est
       ni l'un ni l'autre — c'est la décision du 20/08, « fermé n'est pas une alerte ». On a pris le
       placement de la référence, pas sa couleur, et ce contrôle empêche qu'on l'oublie. */
    const fr = await page.evaluate(() => {
      const l = (nom, ouvert) => '<div class="wdg-frise-ligne' + (ouvert ? ' est-ouvert' : '') + '">'
        + '<div class="wdg-frise-tete"><span class="wdg-frise-place"><i></i>' + nom + '</span>'
        + '<span class="wdg-frise-reste">ouvre dans 2 h</span>'
        + '<span class="wdg-frise-badge">' + (ouvert ? 'OUVERT' : 'FERMÉ') + '</span></div>'
        + '<div class="wdg-frise-piste"><span class="wdg-frise-bloc' + (ouvert ? ' est-ouvert' : '')
        + '" style="left:20%;width:40%;--frise-ton:#e3b23a"><b>09:00 - 18:00</b></span></div></div>';
      const box = document.createElement('div');
      box.style.width = '760px';
      box.innerHTML = '<div class="wdg-frise">' + l('Sydney', false) + l('Londres', true) + '</div>';
      document.body.appendChild(box);
      const q = s => box.querySelector(s);
      const r = e => e.getBoundingClientRect();
      const tete = r(q('.wdg-frise-tete'));
      const out = {
        badgeFerme: { x: r(q('.wdg-frise-ligne:not(.est-ouvert) .wdg-frise-badge')).right, cs: getComputedStyle(q('.wdg-frise-ligne:not(.est-ouvert) .wdg-frise-badge')) },
        badgeOuvert: getComputedStyle(q('.est-ouvert .wdg-frise-badge')),
        teteDroite: tete.right,
        resteDroite: r(q('.wdg-frise-reste')).right,
        piste: r(q('.wdg-frise-piste')).height,
        z: document.body.offsetWidth ? (document.body.getBoundingClientRect().width / document.body.offsetWidth) : 1,
      };
      const res = { badgeFermeDroite: out.badgeFerme.x, teteDroite: out.teteDroite, resteDroite: out.resteDroite,
        piste: out.piste, z: out.z,
        fermeCouleur: out.badgeFerme.cs.color, fermeBordure: out.badgeFerme.cs.borderTopColor,
        ouvertCouleur: out.badgeOuvert.color, ouvertBordure: out.badgeOuvert.borderTopColor };
      box.remove();
      return res;
    });
    console.log('\n── Frise des sessions : l\'état se lit au bout de la ligne ──');
    verif('le badge d\'état est le DERNIER élément de la ligne', fr.badgeFermeDroite > fr.resteDroite,
      'badge à ' + fr.badgeFermeDroite.toFixed(0) + ', temps restant à ' + fr.resteDroite.toFixed(0));
    verif('… et calé sur le bord droit', Math.abs(fr.badgeFermeDroite - fr.teteDroite) < 2,
      'écart au bord : ' + (fr.teteDroite - fr.badgeFermeDroite).toFixed(1) + ' px');
    /* La piste : 12 px, c'était une réglette. La hauteur n'est pas décorative — c'est elle qui laisse
       l'horaire s'écrire DEDANS lisiblement, et qui rend le chevauchement visible d'un coup d'œil. */
    verif('la piste a une vraie épaisseur', fr.piste / (fr.z || 1) >= 20,
      Math.round(fr.piste / (fr.z || 1)) + ' px déclarés (12 avant)');
    /* LA CHARTE, ÉPROUVÉE : « OUVERT » est vert, « FERMÉ » est NEUTRE — pas rouge, malgré la
       référence. Le rouge est réservé au baissier et à l'alerte. */
    const _rouge = c => { const m = String(c).match(/(\d+),\s*(\d+),\s*(\d+)/); return m && +m[1] > 140 && +m[1] - +m[3] > 60; };
    verif('« OUVERT » est vert', /0,\s*230,\s*118/.test(fr.ouvertCouleur), fr.ouvertCouleur);
    verif('« FERMÉ » reste NEUTRE (le rouge est réservé au baissier)',
      !_rouge(fr.fermeCouleur) && !_rouge(fr.fermeBordure), fr.fermeCouleur + ' / ' + fr.fermeBordure);
    verif('… mais il porte bien un cadre, comme les autres états du desk',
      parseFloat(fr.fermeBordure) !== 0 && fr.fermeBordure !== 'rgba(0, 0, 0, 0)', fr.fermeBordure);

    /* ── CHAQUE TAG SON RÔLE : INFO NE DÉROULE PLUS LE RAPPORT ENTIER ──────────────────────────
       31/08 : « le tag info pourquoi il est aussi long ? chaque tag a son rôle tu vois ». Capture :
       le panneau Info d'une ANALYSE PCE déroulait SIX sections, pendant que les boutons Analyse et
       Impact marché en répétaient des morceaux. La référence tient en quatre encadrés courts.
       On ouvre les panneaux pour de vrai — `openPanel` sur une vraie ligne — et on compte ce que
       chacun contient. */
    const rôles = await page.evaluate(async () => {
      const DESC = [
        "L'indice des prix PCE global américain a progressé de 3,7% en glissement annuel en juillet, dépassant le consensus de 3,6%.",
        "Cette divergence a entraîné une réaction mitigée sur les marchés, le dollar s'appréciant face à l'euro.",
        'Chiffres clés (vs attendu) :',
        "- L'indice PCE global (YoY) a atteint 3,7%, supérieur aux 3,6% attendus.",
        "- L'indice PCE de base (YoY) est resté stable à 3,3%.",
        'Ce qui a surpris :',
        '- Le PCE global mensuel à 0,2% a surpris à la hausse.',
        'Réaction de marché :',
        "- L'EUR/USD a reculé sous une légère pression.",
        'Implications banque centrale :',
        "- La lecture de base conforme a limité l'impact sur les anticipations de taux.",
        'Impact marché :',
        '- **Légèrement haussier pour le dollar américain.**',
      ].join('\n');
      const it = { id: 'eva1', headline: 'ANALYSE PCE US : PCE global au-dessus du consensus, cœur conforme',
        description: DESC, category: 'Economic Commentary', tags: ['Inflation', 'PCE', 'USD'],
        timestamp: Date.now(), priority: 'high', _eventAnalysis: true, _reportType: 'PCE Analysis',
        _pair: 'EUR/USD', _indic: 'PCE', _ccy: 'USD',
        _impact: 'Légèrement haussier pour le dollar américain.\nLa conformité du cœur limite le repricing.' };
      const el = window.buildNewsItem(it);
      document.body.appendChild(el);
      const lire = () => {
        const p = el.querySelector('.news-description');
        return { txt: (p.textContent || '').replace(/\s+/g, ' ').trim(),
          titres: [...p.querySelectorAll('.ip-head')].map(h => h.textContent.trim()) };
      };
      const boutons = [...el.querySelectorAll('.news-tags .tag')].map(t => t.textContent.trim());
      // Le panneau Info : c'est le tag « Info » qui l'ouvre.
      const clic = nom => { const b = [...el.querySelectorAll('.news-tags .tag')].find(t => t.textContent.trim() === nom); if (b) b.click(); };
      clic('Info'); await new Promise(r => setTimeout(r, 60));
      const info = lire();
      clic('Analyse'); await new Promise(r => setTimeout(r, 60));
      const ana = lire();
      clic('Impact marché'); await new Promise(r => setTimeout(r, 60));
      const imp = lire();
      el.remove();
      return { boutons, info, ana, imp };
    });
    console.log('\n── Chaque tag son rôle : Info ne déroule plus le rapport entier ──');
    verif('les quatre boutons sont là', ['Info', 'Analyse', 'Impact marché'].every(b => rôles.boutons.includes(b)),
      JSON.stringify(rôles.boutons));
    /* LE CŒUR DE LA DEMANDE : Info porte l'accroche, donc AUCUN intertitre de section. Compter les
       intertitres est le test juste — mesurer une longueur en caractères se réglerait au petit
       bonheur, alors qu'un intertitre dans Info EST le défaut. */
    verif('Info ne contient plus aucune section', rôles.info.titres.length === 0,
      'sections trouvées : ' + JSON.stringify(rôles.info.titres));
    verif('… mais bien l\'accroche', /PCE global américain a progressé de 3,7%/.test(rôles.info.txt), rôles.info.txt.slice(0, 90));
    verif('… et rien du dossier', !/Ce qui a surpris|Implications banque centrale/.test(rôles.info.txt), rôles.info.txt.slice(0, 140));
    /* RIEN N'EST PERDU : ce qu'Info ne porte plus se lit sous Analyse. Un correctif qui aurait
       simplement tronqué le texte aurait passé le contrôle précédent et échoué celui-ci. */
    verif('Analyse porte le dossier', rôles.ana.titres.length >= 3, JSON.stringify(rôles.ana.titres));
    ['Chiffres clés (vs attendu)', 'Ce qui a surpris', 'Réaction de marché', 'Implications banque centrale']
      .forEach(t => verif('… dont « ' + t + ' »', rôles.ana.titres.includes(t), JSON.stringify(rôles.ana.titres)));
    /* … SAUF « Impact marché », qui a son propre bouton : l'y laisser aurait déplacé le doublon au
       lieu de le retirer. */
    verif('Analyse ne reprend PAS « Impact marché »', !rôles.ana.titres.includes('Impact marché'), JSON.stringify(rôles.ana.titres));
    verif('… qui se lit bien sous son bouton', /haussier pour le dollar/.test(rôles.imp.txt), rôles.imp.txt.slice(0, 90));

    /* ── « IMPACT MARCHÉ » TOUT SEUL : LE BOUTON QUI N'OUVRAIT RIEN ────────────────────────────
       27/08, capture client : une dépêche GÉOPOLITIQUE tier-1 (« Chinese executives may join Xi's
       US trip… ») portait le seul bouton « Impact marché », et le clic ne faisait RIEN.
       LA CAUSE, et elle tient en une condition : le conteneur du panneau n'était créé que si
       l'item avait Info, Analyse ou Éco — `hasImpact` n'y figurait pas. Une news qui porte une
       lecture d'impact SANS description ni analyse — exactement le cas d'une géopolitique — se
       retrouvait donc avec un bouton cliquable et AUCUN panneau derrière ; `openPanel` sortait sur
       son `if (!expandEl) return;` et le clic était avalé en silence. Aucune erreur en console,
       rien à voir dans le fil : le défaut invisible par excellence.
       ⚠️ LE CAS DE L'ESSAI PRÉCÉDENT NE POUVAIT PAS L'ATTRAPER : son item porte une description
       complète, donc le conteneur existait pour une AUTRE raison et le panneau Impact fonctionnait.
       C'est l'item DÉPOUILLÉ qui est le vrai cas — et c'est celui que les clients voient. */
    const seul = await page.evaluate(async () => {
      const it = { id: 'geo-seul',
        headline: "Chinese executives may join Xi's US trip, as trade truce extension 'almost certain'",
        description: '', category: 'Geopolitics', tags: [], timestamp: Date.now(),
        priority: 'high', _highImpact: true,
        _impact: 'Détente commerciale : le canal est la prime de risque, pas la politique monétaire.\nUne trêve prolongée soutient les actifs cycliques et allège la demande de refuge.\nBrent ↑ · Or ↓ · AUD/USD ↑' };
      const el = window.buildNewsItem(it);
      document.body.appendChild(el);
      const boutons = [...el.querySelectorAll('.news-tags .tag')].map(t => t.textContent.trim());
      const b = [...el.querySelectorAll('.news-tags .tag')].find(t => /Impact marché/.test(t.textContent));
      let leve = null;
      if (b) { try { b.click(); } catch (e) { leve = String(e && e.message || e); } }
      await new Promise(r => setTimeout(r, 80));
      const p = el.querySelector('.news-description');
      const r = { boutons, leve,
        panneauExiste: !!p,
        visible: !!(p && p.classList.contains('visible')),
        txt: p ? (p.textContent || '').replace(/\s+/g, ' ').trim() : '' };
      /* ⚠️ LE CHEVRON EST UN SECOND CHEMIN, et il ne vise pas forcément le même onglet que le
         bouton : il ouvre le PREMIER panneau disponible d'une chaîne de repli. Créer le conteneur
         pour « Impact marché » fait apparaître ce chevron sur des news qui n'en avaient pas — s'il
         visait un onglet absent, on aurait simplement DÉPLACÉ le clic mort. On l'éprouve donc à
         part : on referme, puis on ouvre par le chevron seul. */
      if (b) { b.click(); await new Promise(r2 => setTimeout(r2, 60)); }   // referme
      const fleche = el.querySelector('.news-arrow-col');
      if (fleche) { try { fleche.click(); } catch (e) { leve = leve || String(e && e.message || e); } }
      await new Promise(r2 => setTimeout(r2, 80));
      const p2 = el.querySelector('.news-description');
      r.chevronExiste = !!fleche;
      r.chevronOuvre = !!(p2 && p2.classList.contains('visible'));
      r.chevronTxt = p2 ? (p2.textContent || '').replace(/\s+/g, ' ').trim() : '';
      r.leve = leve;
      el.remove();
      return r;
    });
    console.log('\n── « Impact marché » seul sur une dépêche géopolitique ──');
    verif('le bouton « Impact marché » est bien posé', seul.boutons.some(b => /Impact marché/.test(b)),
      JSON.stringify(seul.boutons));
    /* LE CONTRÔLE QUI COMPTE : le clic ouvre-t-il quelque chose ? Un bouton qui ne fait rien est
       pire qu'un bouton absent — le lecteur croit à une panne du desk. */
    verif('… et son clic OUVRE un panneau', seul.visible,
      seul.panneauExiste ? 'le panneau existe mais reste fermé' : 'AUCUN panneau n\'a été créé pour cet item');
    verif('… qui contient bien la lecture d\'impact', /prime de risque/.test(seul.txt), seul.txt.slice(0, 120));
    verif('… et ses actifs exposés', /Brent/.test(seul.txt) && /Or/.test(seul.txt), seul.txt.slice(0, 160));
    /* LE SECOND CHEMIN : le chevron. Il apparaît maintenant sur ces news — il doit donc mener
       quelque part, et à la bonne chose. */
    verif('le chevron est là lui aussi', seul.chevronExiste);
    verif('… et il ouvre le panneau', seul.chevronOuvre,
      'le chevron vise un onglet qui n\'existe pas sur cette news');
    verif('… sur la lecture d\'impact, pas sur un onglet vide',
      /prime de risque/.test(seul.chevronTxt), seul.chevronTxt.slice(0, 120));
    verif('aucun des deux clics ne lève d\'exception', !seul.leve, seul.leve || '');
    /* ⚠️ UNE SEULE FABRIQUE DE PANNEAU, ÉPROUVÉE SUR LA SOURCE. Le bouton « Réaction » portait un
       rattrapage LOCAL (« Create expandEl dynamically… ») : c'est ce cloisonnement qui a laissé
       « Impact marché » sans panneau pendant des semaines — un rattrapage par bouton ne protège
       que le bouton qui l'a écrit. La création passe désormais par `assurerPanneau()`, et ce
       contrôle refuse qu'on recrée un `document.createElement` de panneau à côté.
       Il est LEXICAL et non joué dans le navigateur, et c'est assumé : éprouver le rattrapage de
       Réaction au clic demanderait un jeu de bougies complet pour un chemin qui n'est pas celui du
       défaut. Mieux vaut une garde honnête sur la source qu'une couverture qu'on n'a pas. */
    const _APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
    verif('la fabrique de panneau existe et est unique',
      (_APP.match(/function assurerPanneau\(\)/g) || []).length === 1);
    const _fabriques = (_APP.match(/expandEl = document\.createElement\('div'\)/g) || []).length;
    verif('… et personne ne fabrique un panneau à côté d\'elle', _fabriques === 1,
      _fabriques + ' création(s) de panneau dans app.js — il ne doit y en avoir qu\'une, dans la fabrique');
    verif('le rattrapage du bouton Réaction passe par la fabrique',
      /if \(!expandEl\) \{\s*(?:\/\*[\s\S]*?\*\/\s*)?assurerPanneau\(\);/.test(_APP));

    /* ── LA POIGNÉE « ÉLARGIR » LAISSE-T-ELLE LA BARRE DE DÉFILEMENT TRANQUILLE ? ──────────────
       31/08 : « j'ai du mal à bien choper le scroller, mon curseur est sur l'élargissement du bloc ».
       ⚠️ CE QUE CE BANC PEUT ET NE PEUT PAS FAIRE, dit avant de le lire : ce Chromium sans tête
       emploie des barres FLOTTANTES — largeur de mise en page nulle, absentes du test de survol,
       et l'option qui les désactive n'y change rien (mesuré : `offsetWidth - clientWidth` = 0 dans
       les deux cas). On ne peut donc PAS reproduire la barre du client ici. On mesure la GÉOMÉTRIE,
       qui est la vraie question : la poignée empiète-t-elle sur les 8 px que la barre occupe ?
       Les 8 px viennent de la feuille elle-même (`::-webkit-scrollbar { width: 8px }`), pas d'un
       chiffre inventé pour le contrôle. */
    const bar = await page.evaluate(() => {
      const box = document.createElement('div');
      box.innerHTML = '<div class="wdg-grid" style="height:300px">'
        + '<section class="wdg-card" id="c1" style="--gw:6;--gh:12"><header class="wdg-head"><span>T</span></header>'
        + '<div class="wdg-body" id="b1"><div style="height:2000px">long</div></div>'
        + '<div class="wdg-resize-e"></div></section>'
        + '<section class="wdg-card" id="c2" style="--gw:6;--gh:12"><header class="wdg-head"><span>T</span></header>'
        + '<div class="wdg-body" id="b2"><div style="height:10px">court</div></div>'
        + '<div class="wdg-resize-e"></div></section></div>';
      document.body.appendChild(box);
      const geo = id => {
        const c = document.getElementById(id);
        const h = c.querySelector('.wdg-resize-e').getBoundingClientRect();
        const b = c.querySelector('.wdg-body').getBoundingClientRect();
        return { hGauche: h.x, hDroite: h.x + h.width, bDroite: b.right, carteDroite: c.getBoundingClientRect().right };
      };
      const av = { c1: geo('c1'), c2: geo('c2') };
      // La classe telle que widgets.js la pose quand le corps déborde.
      document.getElementById('c1').classList.add('wdg-card--barre');
      const ap = { c1: geo('c1'), c2: geo('c2') };
      // La largeur de barre déclarée par la feuille — on ne l'invente pas.
      const sb = (() => { for (const f of document.styleSheets) { try { for (const r of f.cssRules) {
        if (r.selectorText === '::-webkit-scrollbar') return parseFloat(r.style.width) || 0; } } catch (e) {} } return 0; })();
      // ⚠️ LES DEUX ESPACES. `getBoundingClientRect` rend des px ÉCRAN, la feuille déclare des px CSS,
      // et le desk applique un zoom de page : comparer les deux directement se trompe de 10 % —
      // c'est-à-dire, ici, de presque un pixel, soit exactement l'écart en litige.
      const z = document.body.offsetWidth ? (document.body.getBoundingClientRect().width / document.body.offsetWidth) : 1;
      box.remove();
      return { av, ap, sb, z };
    });
    console.log('\n── La poignée « Élargir » laisse la barre de défilement tranquille ──');
    verif('la feuille déclare bien une barre de 8 px', bar.sb === 8, 'largeur déclarée : ' + bar.sb);
    const BANDE = bar.sb * (bar.z || 1);   // la bande de la barre, ramenée en pixels d'écran
    /* AVANT : la poignée mord sur la bande de la barre — c'est le défaut, et on le mesure pour que le
       contrôle dise ce qu'il corrige, pas seulement ce qu'il constate. */
    const chevauche = g => g.hDroite > g.bDroite - BANDE + 0.5;
    verif('sans la classe, elle recouvre bien la bande de la barre (c\'est le défaut)', chevauche(bar.av.c1),
      'poignée jusqu\'à ' + bar.av.c1.hDroite.toFixed(1) + ', bande de barre à partir de ' + (bar.av.c1.bDroite - BANDE).toFixed(1));
    verif('une carte qui DÉFILE libère la bande de la barre', !chevauche(bar.ap.c1),
      'poignée jusqu\'à ' + bar.ap.c1.hDroite.toFixed(1) + ', bande de barre à partir de ' + (bar.ap.c1.bDroite - BANDE).toFixed(1));
    /* Et elle ne fuit pas trop loin : une poignée réfugiée au milieu de la carte ne se trouverait
       plus. Elle reste collée à la bande, juste à sa gauche. */
    verif('… sans s\'éloigner du bord (elle reste contre la barre)',
      bar.ap.c1.hDroite >= bar.ap.c1.bDroite - BANDE - 1.5,
      'écart : ' + (bar.ap.c1.bDroite - BANDE - bar.ap.c1.hDroite).toFixed(1) + ' px');
    /* UNE CARTE QUI NE DÉFILE PAS NE DOIT RIEN PERDRE : sa poignée reste au bord, là où la main la
       cherche. C'est ce qui distingue ce correctif d'un décalage appliqué partout. */
    verif('une carte qui ne défile pas garde sa poignée au bord',
      Math.abs(bar.ap.c2.hDroite - bar.ap.c2.carteDroite) < 1.5,
      'poignée à ' + bar.ap.c2.hDroite.toFixed(1) + ', bord de carte à ' + bar.ap.c2.carteDroite.toFixed(1));
    /* ── LA DÉTECTION ELLE-MÊME, ÉPROUVÉE SUR LE VRAI CODE ──────────────────────────────────────
       ⚠️ CE CONTRÔLE A DÛ ÊTRE RÉÉCRIT (04/09) et la raison mérite d'être gardée : il exigeait la
       PRÉSENCE LITTÉRALE de `body.scrollHeight > body.clientHeight + 1`. Il est donc passé au rouge
       le jour où cette ligne a été REMPLACÉE PAR MIEUX — un banc qui accuse le code parce qu'il
       s'améliore pousse à ne plus l'améliorer. On éprouve désormais la PROPRIÉTÉ, sur la vraie
       fonction découpée dans widgets.js.
       Et la propriété est plus large qu'on ne l'avait écrite : capture user du 04/09, « mon curseur
       est sur le truc du scroller et ça affiche pas le scroller mais le truc pour élargir ». La
       détection ne regardait QUE `.wdg-body`. Or le desk empile une douzaine de conteneurs
       défilants À L'INTÉRIEUR du corps, et dans un panneau à onglets ce n'est jamais le corps qui
       défile. Le défaut n'avait pas disparu en août : il s'était réduit aux widgets simples, ceux
       sur lesquels on l'avait éprouvé. */
    const WID2 = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
    const SRC_DET = (() => {
      const d = WID2.indexOf('    function _barreAuBord(el, bord) {');
      if (d < 0) return null;
      const f = WID2.indexOf('\n    }\n', WID2.indexOf('function _carteDefile(card) {', d));
      return f < 0 ? null : WID2.slice(d, f + 6);
    })();
    verif('la détection de barre est extractible de widgets.js', !!SRC_DET);
    if (SRC_DET) {
      const det = await page.evaluate((src) => {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:0;top:0;width:520px;height:320px;';
        /* Quatre cartes, quatre situations réelles. La troisième est celle qui manquait : le
           conteneur défilant est IMBRIQUÉ, comme dans un panneau à onglets. */
        box.innerHTML = ''
          + '<section class="wdg-card" id="d1" style="width:240px;height:120px"><div class="wdg-body" style="height:100px;overflow:auto"><div style="height:900px"></div></div></section>'
          + '<section class="wdg-card" id="d2" style="width:240px;height:120px"><div class="wdg-body" style="height:100px;overflow:auto"><div style="height:10px"></div></div></section>'
          + '<section class="wdg-card" id="d3" style="width:240px;height:120px"><div class="wdg-body" style="height:100px;overflow:hidden">'
          +   '<div class="onglet" style="height:100px;overflow-y:auto"><div style="height:900px"></div></div></div></section>'
          /* Un défilant qui n'est PAS au bord droit : sa barre ne passe pas sous la poignée, donc
             la décaler l'éloignerait du bord sans rien protéger. C'est la précision qui compte —
             et non « la barre prend-elle des pixels », qui dépend du navigateur (mesuré : dans ce
             Chromium la barre est en surimpression et n'en prend aucun). */
          + '<section class="wdg-card" id="d4" style="width:240px;height:120px"><div class="wdg-body" style="height:100px;overflow:hidden">'
          +   '<div style="height:100px;width:60px;overflow-y:auto"><div style="height:900px"></div></div></div></section>';
        document.body.appendChild(box);
        // eslint-disable-next-line no-eval
        const F = eval('(function(){' + src + '\nreturn _carteDefile;})()');
        const r = {
          corps:    F(document.getElementById('d1')),
          rien:     F(document.getElementById('d2')),
          imbrique: F(document.getElementById('d3')),
          sansBarre: F(document.getElementById('d4')),
        };
        box.remove();
        return r;
      }, SRC_DET);
      verif('un corps qui défile est détecté', det.corps === true);
      verif('une carte sans débordement ne l\'est pas', det.rien === false);
      verif('UN DÉFILEMENT IMBRIQUÉ est détecté (le cas du panneau à onglets)', det.imbrique === true,
        'c\'est le défaut du 04/09 : la détection ne voyait que .wdg-body');
      /* PRÉCISION : déborder ne suffit pas, il faut que la barre PRENNE DES PIXELS. Sinon on
         décalerait la poignée loin du bord pour protéger une bande qui n'existe pas. */
      verif('… mais un défilant LOIN du bord droit, non', det.sansBarre === false,
        'la poignée s\'éloignerait du bord sans rien à protéger');
    }

    /* ══ CE QU'ON VOIT EST-IL CE QU'ON PEUT PRENDRE ? ═════════════════════════════════════════
       Capture user (27/08) : « regarde moi ce curseur n'est pas précis je comprends pas ».
       MESURÉ AVANT CORRECTIF, sur une carte de 358 px de haut : la zone qui change le curseur en ↔
       courait sur 306 px, le repère orange n'en dessinait que 26, CENTRÉS — 8,5 % de la zone, et
       140 px aveugles de chaque côté. Le geste marchait partout, la marque ne s'allumait qu'au
       milieu : on survolait le bord, le curseur promettait « redimensionner », et l'œil cherchait
       une poignée cent quarante pixels plus loin. Ce genre de défaut ne casse rien et déroute tout.
       ⚠️ CE CONTRÔLE MESURE UN RAPPORT, PAS DES PIXELS. Écrire « le repère fait 306 px » figerait la
       hauteur d'une carte d'essai ; ce qui doit rester vrai, c'est que le repère ÉPOUSE la zone —
       sur une carte haute comme sur une carte basse, aujourd'hui comme après un changement de
       gabarit. On éprouve donc le recouvrement, sur DEUX hauteurs de carte très différentes. */
    const rep = await page.evaluate(() => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;top:0;width:600px;';
      box.innerHTML = '<div class="wdg-grid" style="height:520px">'
        + '<section class="wdg-card" id="r1" style="--gw:6;--gh:20"><header class="wdg-head"><span>T</span></header>'
        + '<div class="wdg-body"><div style="height:2000px">long</div></div><div class="wdg-resize-e"></div></section>'
        + '<section class="wdg-card" id="r2" style="--gw:6;--gh:4"><header class="wdg-head"><span>T</span></header>'
        + '<div class="wdg-body"><div style="height:2000px">long</div></div><div class="wdg-resize-e"></div></section></div>';
      document.body.appendChild(box);
      const mesure = (id) => {
        const c = document.getElementById(id);
        const h = c.querySelector('.wdg-resize-e');
        const rh = h.getBoundingClientRect();
        const cs = getComputedStyle(h, '::after');
        /* ⚠️ DEUX ESPACES DE MESURE. `getComputedStyle` rend des px CSS, `getBoundingClientRect` des
           px ÉCRAN, et le desk applique un zoom de page : comparer les deux directement se trompe
           de 10 %. Le même piège que le calcul du pas de grille dans widgets.js. */
        const zoom = h.offsetHeight ? (rh.height / h.offsetHeight) : 1;
        const aH = parseFloat(cs.height) * zoom;
        const centre = !!(cs.transform && cs.transform !== 'none');
        const y0 = centre ? (rh.top + rh.height / 2 - aH / 2) : (rh.top + parseFloat(cs.top) * zoom);
        /* Le recouvrement RÉEL : l'intersection des deux segments, pas le rapport des hauteurs —
           un repère de la bonne taille mais décalé passerait le second et raterait le premier. */
        const inter = Math.max(0, Math.min(rh.bottom, y0 + aH) - Math.max(rh.top, y0));
        return { zone: rh.height, repere: aH, couvert: rh.height > 0 ? inter / rh.height : 0,
                 debord: aH > 0 ? (aH - inter) / aH : 0, opRepos: parseFloat(getComputedStyle(h, '::after').opacity) };
      };
      const c1 = document.getElementById('r1'), c2 = document.getElementById('r2');
      // Le repère ne se peint qu'au survol de la carte : la feuille le tient à `opacity: 0` au repos.
      const dormant = mesure('r1').opRepos;
      c1.classList.add('wdg-hov-test'); c2.classList.add('wdg-hov-test');
      const st = document.createElement('style');
      st.textContent = '.wdg-hov-test .wdg-resize-e::after { opacity: .3 }';
      document.head.appendChild(st);
      const r = { haute: mesure('r1'), basse: mesure('r2'), dormant };
      st.remove(); box.remove();
      return r;
    });
    console.log('\n── La poignée « Élargir » : ce qu\'on voit est ce qu\'on peut prendre ──');
    verif('le repère ÉPOUSE la zone saisissable sur une carte haute',
      rep.haute.couvert > 0.97,
      'zone ' + rep.haute.zone.toFixed(0) + ' px, repère ' + rep.haute.repere.toFixed(0)
      + ' px → ' + (rep.haute.couvert * 100).toFixed(1) + ' % couverts (le défaut mesuré valait 8,5 %)');
    verif('… et sur une carte basse, où la zone est bien plus courte',
      rep.basse.couvert > 0.97,
      'zone ' + rep.basse.zone.toFixed(0) + ' px, repère ' + rep.basse.repere.toFixed(0)
      + ' px → ' + (rep.basse.couvert * 100).toFixed(1) + ' % couverts');
    /* L'INVERSE COMPTE AUTANT : un repère qui débordait de la zone promettrait une prise là où le
       curseur ne change pas — le même malentendu, retourné. */
    verif('… sans déborder de ce qui se saisit vraiment',
      rep.haute.debord < 0.03 && rep.basse.debord < 0.03,
      'débord haute ' + (rep.haute.debord * 100).toFixed(1) + ' %, basse ' + (rep.basse.debord * 100).toFixed(1) + ' %');
    /* LA CONTREPARTIE DU RAIL PLEINE HAUTEUR : il doit rester INVISIBLE au repos. Un trait de 3 px
       sur toute la hauteur de la carte, peint en permanence, serait une seconde bordure. */
    verif('… et il ne se peint pas tant que la carte n\'est pas survolée', rep.dormant === 0,
      'opacité au repos : ' + rep.dormant);

    /* ══ CIBLES MORTES (audit 28/08, trois défauts prouvés au clic dans Chromium) ═══════════════
       1. Recherche de la topbar : l'input ne faisait que 12px sur les 34 de la case — la loupe et
          les deux tiers du cadre ne posaient PAS le curseur.
       2. Champs de recherche INSTITUTIONS / ANALYSTES : `flex: 1` (= base 0%) ne force jamais le
          retour à la ligne — 0px mesurés en carte de 701px, 30px avec input débordant en 432px.
       3. Bouton « Retirer » d'un sous-widget : la poignée Est (z-6) le recouvrait à 54% — clic au
          centre mort. Chaque contrôle rejoue la MESURE du défaut, pas la présence d'une règle.
       ⚠️ VIEWPORT DESKTOP OBLIGATOIRE : le zoom 90% du desk fait passer les 800px du banc SOUS le
       seuil mobile de 768 — on testerait la case-icône REPLIÉE du mobile (input volontairement
       invisible et non focusable au repos), pas la case desktop que l'audit a mesurée. */
    await page.setViewport({ width: 1440, height: 900 });
    await new Promise(res => setTimeout(res, 400));
    const cibles = await page.evaluate(async () => {
      const r = {};
      // 1 — topbar : géométrie + vrai focus au clic relayé
      const env = document.querySelector('.topbar-symbol-search');
      const inp = document.getElementById('topbar-symbol-input');
      if (env && inp) {
        const re = env.getBoundingClientRect(), ri = inp.getBoundingClientRect();
        r.topbar = { envH: re.height, inpH: ri.height, inpL: ri.width, loupe: null };
        const loupe = env.querySelector('.search-icon');
        if (loupe) {
          /* Le bouchon du banc déclenche le bandeau LIVE, qui recouvre légitimement la case le
             temps du flash : on l'écarte pour éprouver l'état NORMAL de la case, pas l'overlay. */
          const flash = env.querySelector('.breaking-news-flash');
          const avFlash = flash ? flash.style.display : '';
          if (flash) flash.style.display = 'none';
          /* ⚠️ PAS d'elementFromPoint ici : sous le zoom 90% du desk, il ne parle pas la même
             unité que getBoundingClientRect (piège documenté du dépôt) et viserait à côté. On
             éprouve le MÉCANISME lui-même : (1) la loupe est traversante — un clic dessus est
             donc livré à l'enveloppe par le navigateur ; (2) ce mousedown-là pose le focus. */
          const rl = loupe.getBoundingClientRect();
          r.topbar.traversante = getComputedStyle(loupe).pointerEvents === 'none';
          let prevente = null;
          document.addEventListener('mousedown', e => { prevente = e.defaultPrevented; }, { once: true });
          env.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true,
            clientX: rl.left + rl.width / 2, clientY: rl.top + rl.height / 2 }));
          await new Promise(res => setTimeout(res, 30));
          r.topbar.relaisVu = prevente;   // true = notre relais a bien traité l'événement (preventDefault posé)
          r.topbar.loupe = document.activeElement === inp;
          try { inp.blur(); } catch {}
          if (flash) flash.style.display = avFlash;
        }
      }
      // 2 — toolbars clonées (DOM réel, feuille réelle) dans des boîtes aux largeurs de l'audit
      const mesureToolbar = (sel, larg) => {
        const src = document.querySelector(sel);
        if (!src) return null;
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:0;top:0;width:' + larg + 'px;background:#000;';
        box.appendChild(src.cloneNode(true));
        document.body.appendChild(box);
        const wrap = box.querySelector('.br-search-wrap, .arlib-search-wrap');
        const input = box.querySelector('.br-search, .arlib-search');
        const rw = wrap ? wrap.getBoundingClientRect() : null;
        const ri = input ? input.getBoundingClientRect() : null;
        const out = { wrap: rw ? rw.width : -1, input: ri ? ri.width : -1,
                      deborde: (rw && ri) ? Math.max(0, ri.right - rw.right) : -1 };
        box.remove();
        return out;
      };
      r.brLarge = mesureToolbar('.br-toolbar', 701);
      r.brEtroit = mesureToolbar('.br-toolbar', 432);
      r.arlibEtroit = mesureToolbar('.arlib-toolbar', 432);
      // 3 — la rangée de commandes d'un sous-widget face à la poignée, aux classes réelles
      const fx = document.createElement('div');
      // sous la topbar (fixe, au-dessus de tout en y=0) : elementFromPoint doit voir NOTRE fixture
      fx.style.cssText = 'position:fixed;left:0;top:220px;width:300px;';
      fx.innerHTML = '<section class="wdg-card wdg-card--barre" style="height:200px;position:relative">'
        + '<div style="display:flex;justify-content:flex-end;padding-top:34px">'
        + '<div class="wdg-subgear wdgt-subacts"><div class="wdg-ico" id="cx-ret" title="Retirer">×</div></div></div>'
        + '<div class="wdg-resize-e"></div></section>';
      document.body.appendChild(fx);
      const btn = fx.querySelector('#cx-ret');
      const rb = btn.getBoundingClientRect();
      const auCentre = document.elementFromPoint(rb.left + rb.width / 2, rb.top + rb.height / 2);
      const sousLeBouton = document.elementFromPoint(rb.left + rb.width / 2, rb.bottom + 50);
      r.retirer = { centre: !!(auCentre && (auCentre === btn || btn.contains(auCentre) || auCentre.closest('.wdgt-subacts'))),
                    centreQui: auCentre ? auCentre.className : '(rien)',
                    poigneeVit: !!(sousLeBouton && sousLeBouton.classList.contains('wdg-resize-e')) };
      fx.remove();
      return r;
    });
    console.log('\n── Cibles mortes de l\'audit : la case, les champs, la croix ──');
    verif('l\'input de la recherche topbar épouse la hauteur de sa case',
      cibles.topbar && cibles.topbar.inpH >= cibles.topbar.envH * 0.8,
      cibles.topbar ? cibles.topbar.inpH.toFixed(0) + ' px sur ' + cibles.topbar.envH.toFixed(0) + ' (le défaut : 12 sur 32)' : 'case introuvable');
    verif('… et un clic sur la LOUPE pose le curseur dans le champ',
      cibles.topbar && cibles.topbar.traversante === true && cibles.topbar.loupe === true,
      cibles.topbar ? (cibles.topbar.traversante
        ? 'le relais mousedown ne pose pas le focus (relais vu: ' + cibles.topbar.relaisVu + ', input ' + Math.round(cibles.topbar.inpL) + 'px)'
        : 'la loupe intercepte le clic (pointer-events)') : 'case introuvable');
    verif('INSTITUTIONS en carte de 701px : le champ de recherche est utilisable',
      cibles.brLarge && cibles.brLarge.input >= 120,
      cibles.brLarge ? cibles.brLarge.input.toFixed(0) + ' px (le défaut mesuré : 0)' : 'toolbar introuvable');
    verif('… et en carte de 432px, il garde son plancher',
      cibles.brEtroit && cibles.brEtroit.wrap >= 140,
      cibles.brEtroit ? cibles.brEtroit.wrap.toFixed(0) + ' px' : 'toolbar introuvable');
    verif('ANALYSTES en carte étroite : la zone de saisie ne se dessine plus HORS du champ',
      cibles.arlibEtroit && cibles.arlibEtroit.deborde <= 1 && cibles.arlibEtroit.wrap >= 140,
      cibles.arlibEtroit ? 'wrap ' + cibles.arlibEtroit.wrap.toFixed(0) + ' px, débord ' + cibles.arlibEtroit.deborde.toFixed(0) + ' px (le défaut : wrap 30, input 154)' : 'toolbar introuvable');
    verif('le CENTRE du bouton « Retirer » touche le bouton, plus la poignée',
      cibles.retirer.centre, 'elementFromPoint rend : ' + cibles.retirer.centreQui);
    verif('… et la poignée reste vivante hors de la rangée de commandes',
      cibles.retirer.poigneeVit, 'le z-index des commandes ne doit pas éteindre la poignée ailleurs');

    /* ── LE SPLITTER N'EST PLUS UN « SCROLLER DORÉ » (30/08, capture user) ─────────────────────
       Au survol/glissement, la ligne pleine hauteur du redimensionneur passait à l'or : collée à
       l'ascenseur sombre du panneau voisin, elle se lisait comme un SECOND ascenseur. On MESURE
       les pixels calculés (pas les déclarations) : classe is-resizing posée pour de vrai, puis
       lecture du ::before ; et la zone de préhension ::after doit faire ≥20px (la précision). */
    console.log('\n── Le splitter : retour visuel neutre, prise élargie ──');
    const splitter = await page.evaluate(() => {
      const rz = document.querySelector('.layout-resizer');
      if (!rz) return null;
      document.body.classList.add('is-resizing');
      const av = getComputedStyle(rz, '::before');
      const actif = { bg: av.backgroundColor, w: parseFloat(av.width) || 0 };
      document.body.classList.remove('is-resizing');
      const ap = getComputedStyle(rz, '::after');
      const gauche = Math.abs(parseFloat(ap.left) || 0), droite = Math.abs(parseFloat(ap.right) || 0);
      const prise = (rz.getBoundingClientRect().width || 0) + gauche + droite;
      return { actif, prise, gauche };
    });
    verif('en glissement, la ligne du splitter est NEUTRE (plus jamais or)',
      !!splitter && !/227,\s*178|184,\s*134|243,\s*195/.test(splitter.actif.bg),
      splitter ? 'peinte : ' + splitter.actif.bg + ' — l\'or à côté d\'un ascenseur fabrique le « 2e scroller »' : 'resizer introuvable');
    verif('… et elle s\'épaissit pour se voir (≥2px)', !!splitter && splitter.actif.w >= 2,
      splitter ? splitter.actif.w + 'px' : '');
    verif('la zone de préhension fait au moins 20px (précision du curseur)',
      !!splitter && splitter.prise >= 20, splitter ? splitter.prise.toFixed(0) + 'px (avant : 13)' : '');
    verif('… sans déborder de plus de 4px sur le panneau gauche (sa scrollbar reste cliquable)',
      !!splitter && splitter.gauche <= 4, splitter ? splitter.gauche + 'px à gauche' : '');
    const _cssTexte = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8');
    verif('plus aucun pouce d\'ascenseur doré au survol dans la feuille',
      !/scrollbar-thumb:hover\{background:var\(--orange-dim/.test(_cssTexte),
      'la règle globale du polish #2 redorait TOUS les ascenseurs survolés');
    /* Les splitters de la VUE SYMBOLE suivent la même règle (30/08, 2e capture : trait doré pleine
       hauteur au bord du GRAPHIQUE + coin or à la jonction avec l'horizontal). Plus d'or ; prise
       ::after asymétrique (2px max côté graphe → un drag sur le graphique ne peut plus attraper le
       splitter) ; et le glissement se fait en DELTA (1px de souris = 1px de splitter, zéro saut à
       la prise), plus jamais en position absolue qui ignorait le padding de la grille. */
    verif('les splitters du graphique (vue symbole) ne passent plus à l\'or',
      !/sym-[vh]split[^\n{]*(?:hover|dragging)[^{]*\{[^}]*227,\s*178/.test(_cssTexte));
    verif('… leur prise est élargie par ::after, curseur resize, 2px max côté graphe',
      /\.sym-vsplit::after \{[^}]*left: -2px; right: -8px; cursor: col-resize;/.test(_cssTexte)
      && /\.sym-hsplit::after \{[^}]*top: -2px; bottom: -8px; cursor: row-resize;/.test(_cssTexte));
    const _chartsTexte = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
    verif('le glissement des splitters du graphique est en DELTA (zéro saut à la prise)',
      /base \+ \(p\.clientX - dep\)/.test(_chartsTexte) && /base \+ \(p\.clientY - dep\)/.test(_chartsTexte)
      && !/rect\.width \* 0\.78, p\.clientX - rect\.left/.test(_chartsTexte),
      'le calcul absolu clientX - rect.left faisait sauter la ligne sous le curseur à la prise');

    // Retour au viewport historique du banc : les sections suivantes mesurent dans cet état-là.
    await page.setViewport({ width: 800, height: 600 });
    await new Promise(res => setTimeout(res, 400));

    /* ── L'ANALYSE D'UN CHIFFRE PORTE-T-ELLE LE TAG DE SON INDICATEUR ? ────────────────────────
       31/08 : « il manque le tag comme ceci », capture d'une ligne de calendrier portant son tag
       « drapeau + PCE ». L'ANALYSE du même chiffre ne l'avait pas — les rapports maison étaient
       exclus en bloc du tag d'indicateur, ce qui est juste pour un récap et faux pour une analyse
       d'événement, dont le sujet EST un indicateur.
       On construit une VRAIE ligne avec `buildNewsItem` (la fabrique du fil, exposée par app.js) et
       on lit les tags rendus. Deux formes sont éprouvées, parce qu'elles empruntent deux chemins :
       l'analyse (le desk NOMME l'indicateur) et la donnée brute (la table le reconnaît au titre). */
    const tg = await page.evaluate(() => {
      const lire = it => {
        const el = window.buildNewsItem(it);
        const tags = [...el.querySelectorAll('.news-tags .tag')].map(t => ({
          txt: (t.textContent || '').trim(), cls: t.className,
          drapeau: !!t.querySelector('.tag-flag'), src: (t.querySelector('.tag-flag') || {}).getAttribute
            ? t.querySelector('.tag-flag').getAttribute('src') : '', titre: t.getAttribute('title') || '',
        }));
        return tags;
      };
      return {
        analyse: lire({ id: 'x1', headline: 'ANALYSE PCE US : Inflation PCE américaine supérieure aux attentes en juillet',
          description: 'Texte.', category: 'Economic Commentary', tags: ['Inflation', 'PCE', 'USD'], timestamp: Date.now(),
          priority: 'high', _eventAnalysis: true, _reportType: 'PCE Analysis', _pair: 'EUR/USD', _indic: 'PCE', _ccy: 'USD' }),
        pib: lire({ id: 'x2', headline: 'ANALYSE PIB US : PIB US révisé à 1.5%, déflateur au-dessus des attentes',
          description: 'Texte.', category: 'Economic Commentary', tags: ['GDP', 'Growth', 'USD'], timestamp: Date.now(),
          priority: 'high', _eventAnalysis: true, _reportType: 'GDP Analysis', _pair: 'EUR/USD', _indic: 'PIB', _ccy: 'USD' }),
        brute: lire({ id: 'x3', headline: 'US Core PCE Price Index MoM Actual 0.2% (Forecast 0.2%, Previous 0.1%)',
          description: '', category: 'Economic Commentary', tags: ['Inflation', 'USD'], timestamp: Date.now(), priority: 'high' }),
        recap: lire({ id: 'x4', headline: 'Récap de séance — Londres', description: 'Texte.', category: 'Market Analysis',
          tags: ['FX'], timestamp: Date.now(), priority: 'normal', _reportType: 'Session Wrap' }),
        // La définition ATTENDUE, lue dans la fiche elle-même : le contrôle compare deux valeurs de
        // la page, il ne re-décrit pas l'indicateur dans le banc (une copie finirait par diverger).
        defPce: (typeof dtpKbParNom === 'function' && (dtpKbParNom('PCE') || {}).what) || '',
      };
    });
    const _indicDe = l => (l || []).find(t => /tag--indic/.test(t.cls));
    console.log('\n── L\'analyse d\'un chiffre porte le tag de son indicateur ──');
    const iA = _indicDe(tg.analyse);
    verif('l\'analyse PCE porte le tag « PCE »', !!iA && iA.txt === 'PCE', JSON.stringify(tg.analyse.map(t => t.txt)));
    verif('… avec le drapeau de la devise de L\'ÉVÉNEMENT (US, pas la zone euro)',
      !!iA && iA.drapeau && /\/us\.png$/.test(iA.src), iA && iA.src);
    /* La définition vient de la fiche du calendrier : le survol explique l'indicateur, exactement
       comme sur la ligne de donnée brute. Sans elle, le tag ne serait qu'une étiquette de plus. */
    verif('… et la définition de la fiche en infobulle', !!iA && !!tg.defPce && iA.titre === tg.defPce,
      'infobulle « ' + (iA && iA.titre) + ' » · fiche « ' + tg.defPce + ' »');
    /* PIB est le cas qui prouve que le nom vient du SERVEUR : la table de reconnaissance lit
       « gdp | gross domestic », elle ne trouve rien dans un titre français. */
    const iP = _indicDe(tg.pib);
    verif('l\'analyse PIB le porte aussi, alors que le titre est en français',
      !!iP && iP.txt === 'PIB', JSON.stringify(tg.pib.map(t => t.txt)));
    verif('le tag n\'est pas répété en double', (tg.analyse.filter(t => t.txt === 'PCE').length) === 1,
      JSON.stringify(tg.analyse.map(t => t.txt)));
    // La donnée brute garde le sien : on n'a rien cassé du chemin d'origine.
    verif('la ligne de donnée brute garde son tag', !!_indicDe(tg.brute), JSON.stringify(tg.brute.map(t => t.txt)));
    // Et un récap maison n'en gagne pas : son sujet n'est pas un indicateur.
    verif('un récap de séance n\'en gagne pas', !_indicDe(tg.recap), JSON.stringify(tg.recap.map(t => t.txt)));

    /* ── ONGLET ANALYSTES : LA LISTE NE DOIT PAS ATTENDRE LA SOURCE LA PLUS LENTE ──────────────
       Le 26/08, l'onglet restait sur « Chargement des rapports… » plusieurs secondes : les quatre
       sources étaient attendues ENSEMBLE et /api/weekly-reports attendait lui-même Supabase. Ici la
       route lente met 3 s exprès. On ouvre l'onglet, on regarde 700 ms plus tard : la liste doit
       DÉJÀ être remplie par les trois sources rapides. Un contrôle qui attendrait la fin passerait
       même avec le défaut — c'est le délai court qui fait la preuve. */
    const t0 = Date.now();
    await page.evaluate(() => window.activateView && window.activateView('analyst'));
    await new Promise(r => setTimeout(r, 700));
    const a = await page.evaluate(() => {
      const l = document.getElementById('arlib-list');
      return {
        chargeur: !!(l && l.querySelector('.dtp-loader')),
        lignes: l ? l.querySelectorAll('.arl-row:not(.arl-skel-row)').length : -1,
        pied: (document.getElementById('arlib-foot') || {}).textContent || '',
      };
    });
    const dt = Date.now() - t0;
    console.log('\n── Onglet ANALYSTES, source lente bouchonnée à 3 s ──');
    verif('le chargeur a disparu bien avant la source lente', !a.chargeur, 'chargeur encore affiché après ' + dt + ' ms');
    verif('des rapports sont déjà listés', a.lignes >= 5, a.lignes + ' ligne(s) après ' + dt + ' ms');
    verif('le compteur est renseigné', /\d+ sur \d+/.test(a.pied), a.pied || '(vide)');
    verif('mesuré AVANT la réponse lente', dt < 2500, dt + ' ms');
    // Et quand la source lente répond enfin, rien ne casse ni ne disparaît.
    await new Promise(r => setTimeout(r, 3000));
    const b = await page.evaluate(() => {
      const l = document.getElementById('arlib-list');
      return { lignes: l ? l.querySelectorAll('.arl-row:not(.arl-skel-row)').length : -1, chargeur: !!(l && l.querySelector('.dtp-loader')) };
    });
    verif('la liste tient après la réponse lente', !b.chargeur && b.lignes >= a.lignes, b.lignes + ' ligne(s) (avant : ' + a.lignes + ')');
    verif('toujours aucune erreur d\'exécution', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));

    /* Les deux moitiés de la correction, relues dans le code : le client n'attend plus les quatre
       sources ensemble, et la route lente n'attend plus Supabase quand elle a de quoi répondre. */
    const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
    const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
    verif('le client rend AVANT tout appel réseau', /function loadAnalystView\(\) \{\s*\n\s*renderArlibList\(\);/.test(APP));
    verif('plus d\'attente groupée des quatre sources', !/Promise\.allSettled\(\[\s*\n\s*fetch\('\/api\/session-wraps'\)/.test(APP));
    verif('chaque source rafraîchit dès son arrivée', /_lire\(url, fn\)|const _lire = \(url, fn\)/.test(APP));
    /* ⚠️ CE CONTRÔLE ÉPINGLAIT LA DURÉE EXACTE (`DAY`) alors que son intention est « les hebdo ont un
       repli local ». Il est donc passé au rouge le 27/08 quand cette durée est passée à huit jours —
       un correctif, pas une régression. Intention et valeur sont désormais deux contrôles séparés :
       le premier survit à un réglage, le second dit pourquoi ce réglage-là. */
    verif('les rapports hebdo ont enfin un cache local', /lsGet\('dtp_wk',/.test(APP) && /lsSet\('dtp_wk'/.test(APP));
    /* HUIT JOURS, pas un : un hebdo ne change QU'UNE FOIS PAR SEMAINE, et une péremption d'un jour
       jetait un contenu encore valable — l'onglet repartait alors sur un vide le temps du réseau,
       ce qui était précisément le défaut signalé. */
    verif('… et il vit plus longtemps qu\'une journée', /lsGet\('dtp_wk', 8 \* DAY\)/.test(APP));
    verif('… tandis que les sources QUOTIDIENNES gardent leur journée',
      /lsGet\('dtp_sw', DAY\)/.test(APP) && /lsGet\('dtp_br', DAY\)/.test(APP));
    verif('la route hebdo ne bloque plus sur Supabase quand elle a de quoi répondre',
      /if \(_dejaEnMemoire\) _loadPersistedWeekly\(\)\.catch\(\(\) => \{\}\);\s*\n\s*else await _loadPersistedWeekly\(\);/.test(SRV));
    verif('elle attend encore quand la mémoire est vide (sinon régénération inutile)', /else await _loadPersistedWeekly\(\);/.test(SRV));

    /* ── LES DEUX RAPPORTS SE RESSEMBLENT-ILS VRAIMENT ? ───────────────────────────────────────
       « Une synthèse comme ça, faut la même identité visuelle » / « pour que les rapports se
       ressemblent » / « idem pour les titres des parties ». Une règle CSS partagée par deux
       sélecteurs le garantit sur le papier ; on le vérifie ici DANS LE NAVIGATEUR, en comparant les
       styles CALCULÉS — c'est le seul niveau où une surcharge oubliée ailleurs dans la feuille se
       verrait. */
    const st = await page.evaluate(() => {
      const box = document.createElement('div');
      /* Le Récap HEBDO entre dans la comparaison (04/09) : c'est LUI la référence désormais, et une
         référence qu'on ne mesure pas est une référence qu'on cesse de suivre. */
      /* ⚠️ UN FRÈRE AVANT CHAQUE TITRE, ET CE N'EST PAS DÉCORATIF. Sans lui, chaque titre est le
         PREMIER ENFANT de son conteneur et déclenche la règle `:first-child` qui rabote la marge
         haute du premier titre d'un rapport. On comparait donc trois cas particuliers en croyant
         mesurer le cas général — et le contrôle est effectivement sorti rouge sur `marginTop`, pour
         une différence qui n'existe pas dans un vrai rapport. */
      box.innerHTML = '<div class="fxdr"><p>.</p><div class="fxdr-section">A</div><div class="fxdr-grp-title">S</div><div class="fxdr-bullets"><ul class="article-points"><li>b</li></ul></div><div class="fxdr-exec"><p class="wr-p">x</p></div></div>'
        + '<div class="arlib-rbody"><p>.</p><div class="arlib-rsection">A</div><div class="arlib-rexec"><p class="wr-p">x</p></div></div>'
        + '<div class="wr-body"><p>.</p><div class="wr-section-title">A</div><div class="wr-macro-heading">S</div><p class="wr-bullet">b</p><div class="wr-text wr-summary fxdr-exec"><p class="wr-p">x</p></div></div>';
      document.body.appendChild(box);
      const cs = (sel, pseudo) => {
        const e = box.querySelector(sel); if (!e) return null;
        const c = getComputedStyle(e, pseudo || null), o = {};
        ['display', 'color', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'marginTop',
         'marginBottom', 'paddingBottom', 'borderBottomWidth', 'borderBottomColor', 'gap',
         'backgroundColor', 'borderLeftWidth', 'borderLeftColor', 'borderRadius', 'padding',
         'width', 'height', 'content', 'lineHeight', 'fontFamily'].forEach(k => { o[k] = c[k]; });
        return o;
      };
      const r = {
        titreQ: cs('.fxdr-section'), titreS: cs('.arlib-rsection'), titreH: cs('.wr-section-title'),
        /* LE HEBDO SE CALE SUR LE QUOTIDIEN (27/08). Mesuré AVANT correction : sous-titre du Hebdo
           en 13 px / graisse 600 / BLANC, contre 10 px / 700 / GRIS chez les deux autres — il
           criait ses sous-titres au rang de ses titres, et c'est ce qui le faisait paraître chargé. */
        sousQ: cs('.fxdr-grp-title'), sousH: cs('.wr-macro-heading'),
        puceQ: cs('.fxdr-bullets li'), puceH: cs('.wr-bullet'),
        boxH: cs('.wr-body .fxdr-exec'),
        barreQ: cs('.fxdr-section', '::before'), barreS: cs('.arlib-rsection', '::before'),
        boxQ: cs('.fxdr-exec'), boxS: cs('.arlib-rexec'),
        paraQ: cs('.fxdr-exec .wr-p'), paraS: cs('.arlib-rexec .wr-p'),
      };
      box.remove();
      return r;
    });
    const memeStyle = (a, b, cles) => a && b && cles.every(k => a[k] === b[k]);
    const diff = (a, b, cles) => (a && b) ? cles.filter(k => a[k] !== b[k]).map(k => k + ': ' + a[k] + ' ≠ ' + b[k]).join(' | ') : '(élément absent)';
    const CT = ['display', 'color', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'marginTop', 'marginBottom', 'paddingBottom', 'borderBottomWidth', 'borderBottomColor', 'gap', 'fontFamily'];
    const CB = ['width', 'height', 'backgroundColor', 'borderRadius'];
    const CE = ['backgroundColor', 'borderLeftWidth', 'borderLeftColor', 'borderRadius', 'padding'];
    const CP = ['fontSize', 'color', 'lineHeight', 'fontFamily'];
    /* ── RÉCAP HEBDO : LE DOUBLE TRAIT SOUS « LA SEMAINE DEVISE PAR DEVISE » ────────────────────
       04/09, capture user. Le premier bloc devise portait un filet supérieur qui venait doubler
       celui du titre. La règle censée l'annuler visait `:first-of-type` — le premier élément DE SON
       TYPE parmi ses frères, c'est-à-dire le premier `div`, qui est le TITRE. Elle ne s'appliquait
       donc à personne. Le piège se lit « le premier de cette classe », ce qu'il n'est pas.
       On mesure le filet PEINT, pas la présence d'une règle : c'est le seul niveau où un sélecteur
       qui ne matche rien se voit. */
    const dbl = await page.evaluate(() => {
      const box = document.createElement('div');
      box.innerHTML = '<div class="wr-body">'
        + '<div class="wr-section-title wr-ccy-sectitle">T</div>'
        + '<div class="wr-ccy-block wr-ccy-block--flow" id="b1">USD</div>'
        + '<div class="wr-ccy-block wr-ccy-block--flow" id="b2">EUR</div></div>';
      document.body.appendChild(box);
      const w = id => getComputedStyle(document.getElementById(id)).borderTopWidth;
      const r = { premier: w('b1'), second: w('b2') };
      box.remove(); return r;
    });
    console.log('\n── Récap Hebdo : un seul trait sous le titre des devises ──');
    verif('le PREMIER bloc devise n\'ajoute pas son filet sous le titre',
      Math.round(parseFloat(dbl.premier || '0')) === 0, 'filet de ' + dbl.premier);
    /* Et les suivants le gardent : c'est lui qui sépare les devises entre elles. Sans ce contrôle,
       supprimer le filet PARTOUT passerait aussi pour un correctif. */
    verif('… mais les suivants gardent le leur (il sépare les devises)',
      Math.round(parseFloat(dbl.second || '0')) >= 1, 'filet de ' + dbl.second);

    /* ── LA MACRO EST DE RETOUR, ET À SA PLACE ───────────────────────────────────────────────────
       04/09 : « il manque la partie macro avant la partie devises ». L'ordre est l'information —
       une section macro rendue APRÈS les devises ne servirait à rien. On lit donc les positions
       réelles des trois titres dans le code de rendu. */
    const APP3 = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
    const posGeo = APP3.indexOf('<div class="wr-section-title">Géopolitique</div>');
    const posMac = APP3.indexOf('<div class="wr-section-title">Macro</div>');
    const posDev = APP3.indexOf('<div class="wr-section-title wr-ccy-sectitle">La semaine devise par devise</div>');
    verif('la section Macro existe dans le Récap Hebdo', posMac > 0);
    verif('… elle est rendue APRÈS la géopolitique et AVANT les devises',
      posGeo > 0 && posMac > posGeo && posDev > posMac,
      'géo@' + posGeo + ' macro@' + posMac + ' devises@' + posDev);
    /* ⚠️ ET LE THÈME GÉOPOLITIQUE NE DOIT PAS Y REVENIR. Quand une chronologie existe, `_geoTheme`
       vaut null et le thème géo RESTE dans `w.macro` : le filtrer sur la seule référence d'objet le
       ferait réapparaître ici, juste sous la section qui vient de le raconter. */
    verif('… en excluant le thème géopolitique par son INTITULÉ, pas par identité d\'objet',
      /\(w\.macro \|\| \[\]\)\.flatMap\(sec[\s\S]{0,300}g\[ée\]opolit/.test(APP3),
      'le thème géo réapparaîtrait sous la section qui vient de le raconter');
    /* ══ LA MACRO DU HEBDO PREND LA GRAMMAIRE DES QUOTIDIENS (29/08, demande user) ═══════════════
       « enlève Performance cross-asset » + « classe d'abord banque centrale, inflation, croissance
       économique puis emploi, puis les autres ». Le prompt produit les nouveaux en-têtes, mais les
       rapports ARCHIVÉS portent l'ancienne grammaire : c'est donc le RENDU qui ordonne et filtre,
       et c'est lui qu'on éprouve — sur la vraie logique extraite, pas une copie. */
    {
      const dR = APP3.indexOf('const _WR_MACRO_RANG = [');
      const fR = APP3.indexOf('// _macroReste prêt (repère du banc : fin d\'extraction)', dR);
      verif('le rangement macro du Hebdo est extractible', dR > 0 && fR > dR);
      if (dR > 0 && fR > dR) {
        const F = new Function('w', APP3.slice(dR, fR) + '\nreturn _macroReste;');
        const themes = F({ macro: [
          { heading: 'Technologie & Innovation', bullets: ['x'] },
          { heading: 'Performance Cross-Asset', bullets: ['x'] },
          { heading: 'Emploi', bullets: ['x'] },
          { heading: 'Inflation', bullets: ['x'] },
          { heading: 'Géopolitique', bullets: ['x'] },
          { heading: 'Un thème inconnu', bullets: ['x'] },
          { heading: 'Banque centrale', bullets: ['x'] },
          { heading: 'Croissance économique', bullets: ['x'] },
          { heading: 'Commerce International & Tarifs', bullets: ['x'] },
        ] }).map(t => t.heading);
        verif('« Performance Cross-Asset » ne se rend plus (archives comprises)', !themes.includes('Performance Cross-Asset'), themes.join(' | '));
        verif('« Commerce International & Tarifs » non plus (retiré le 30/08 sur demande user)',
          !themes.some(h => /commerce/i.test(h)), themes.join(' | '));
        verif('l\'ordre est Banque centrale → Inflation → Croissance → Emploi → Technologie',
          themes.slice(0, 5).join('|') === 'Banque centrale|Inflation|Croissance économique|Emploi|Technologie & Innovation',
          themes.join(' | '));
        verif('… et un en-tête inconnu passe en QUEUE, jamais à la poubelle', themes[themes.length - 1] === 'Un thème inconnu', themes.join(' | '));
        /* ⚠️ L'EN-TÊTE FUSIONNÉ EST ÉCLATÉ, PLUS JAMAIS RENDU (30/08, 2e capture user : « je
           t'avais dit de séparer les catégories » — la 1re passe le gardait aux archives,
           seulement reclassé). Chaque puce rejoint SA famille des quotidiens ; l'inclassable va
           dans « Autres chiffres de la semaine », en queue ; une famille recréée FUSIONNE avec
           la native. Les puces d'essai sont celles de la capture du user. */
        const vieux = F({ macro: [
          { heading: 'Inflation', bullets: ['**EUR Inflation :** l’IPC préliminaire accélère à 2,4%.'] },
          { heading: 'Commerce International & Tarifs', bullets: ['x'] },
          { heading: 'Inflation & Croissance', bullets: [
            '**USD Core PCE :** l’indice des prix PCE de base ressort à 0,2%.',
            '**CAD PIB :** le PIB canadien du T2 progresse de 0,8%.',
            '**USD Emploi :** les révisions des payrolls retirent 79 000 postes.',
            '**Fed :** a maintenu son taux directeur, ton prudent.',
            '**Sujet mystère :** un fait qui ne se classe nulle part.',
          ] },
        ] });
        const vT = vieux.map(t => t.heading);
        verif('l\'en-tête fusionné des archives est ÉCLATÉ, plus jamais rendu',
          !vT.some(h => /inflation.*croiss|croiss.*inflation/i.test(h)), vT.join(' | '));
        verif('… chaque puce rejoint SA famille des quotidiens, dans l\'ordre des quotidiens (Commerce filtré)',
          vT.join('|') === 'Banque centrale|Inflation|Croissance économique|Emploi|Autres chiffres de la semaine',
          vT.join(' | '));
        const vInfl = vieux.filter(s => s.heading === 'Inflation');
        verif('… la famille recréée FUSIONNE avec la native (une seule « Inflation », deux puces)',
          vInfl.length === 1 && vInfl[0].bullets.length === 2,
          vInfl.length + ' section(s), ' + (vInfl[0] ? vInfl[0].bullets.length : 0) + ' puce(s)');
        verif('… et l\'inclassable finit dans « Autres chiffres de la semaine », jamais à la poubelle',
          vT[vT.length - 1] === 'Autres chiffres de la semaine' && vieux[vieux.length - 1].bullets.length === 1,
          vT[vT.length - 1]);
        /* ⚠️ LES NOMS D'INDICATEURS ANGLAIS SE CLASSENT AUSSI (30/08, 3e capture user : sur le
           Hebdo livré, « Unemployment Rate » (JPY et EUR), « Ifo Business Climate » et « Personal
           Income MoM » échouaient TOUS dans « Autres chiffres de la semaine » — le calendrier
           livre les noms d'indicateurs en anglais, et « unemployment » ne contient pas « emploi »).
           Classement demandé par le user : Unemployment → Emploi ; Ifo et revenus des ménages →
           Croissance ; et par cohérence wages/earnings → Inflation, comme « salaires ». Les puces
           d'essai sont celles de la capture. */
        const anglais = F({ macro: [{ heading: 'Inflation & Croissance', bullets: [
          '**Vendredi 28 août · JPY :** Unemployment Rate : 2.4% (attendu 2.5%, préc. 2.5%).',
          '**Jeudi 27 août · EUR :** Unemployment Rate : 6.2% (attendu 6.3%, préc. 6.3%).',
          '**Mardi 25 août · EUR :** Ifo Business Climate : 88.8 (attendu 88.5, préc. 88.1).',
          '**Mercredi 26 août · USD :** Personal Income MoM : 0.4% (attendu 0.3%, préc. 0.4%).',
          '**USD :** Average Hourly Earnings : +0.3%, la pression salariale se maintient.',
        ] }] });
        const _fam = (h) => { const s = anglais.find(x => x.heading === h); return s ? s.bullets : []; };
        verif('« Unemployment Rate » (JPY comme EUR) rejoint Emploi, comme demandé',
          _fam('Emploi').length === 2 && _fam('Emploi').every(b => /Unemployment/.test(b)),
          JSON.stringify(anglais.map(s => s.heading + ':' + s.bullets.length)));
        verif('« Ifo Business Climate » et « Personal Income » rejoignent Croissance économique',
          _fam('Croissance économique').length === 2
          && _fam('Croissance économique').some(b => /Ifo/.test(b))
          && _fam('Croissance économique').some(b => /Personal Income/.test(b)),
          JSON.stringify(anglais.map(s => s.heading + ':' + s.bullets.length)));
        verif('« Average Hourly Earnings » rejoint Inflation, comme « salaires »',
          _fam('Inflation').length === 1 && /Earnings/.test(_fam('Inflation')[0] || ''),
          JSON.stringify(anglais.map(s => s.heading)));
        verif('… et plus AUCUNE des puces de la capture n\'échoue dans « Autres chiffres de la semaine »',
          !anglais.some(s => s.heading === 'Autres chiffres de la semaine'),
          JSON.stringify(anglais.map(s => s.heading)));
        /* Mutation : on retire les mots-clés anglais de la copie extraite et les mêmes puces
           doivent retomber dans « Autres chiffres de la semaine » — preuve que ce sont EUX qui
           portent le classement, pas un hasard d'un autre mot de la puce. */
        const _srcMut = APP3.slice(dR, fR)
          .replace('|(?:un)?employment|jobless|labou?r', '')
          .replace('|prices?|wages?|earnings', '')
          .replace('|ifo|zew|tankan|business climate|confidence|sentiment|personal (?:income|spending)|durable|housing|homes?|permits?|orders', '');
        /* On vérifie l'absence des FORMES REGEX (avec leurs pipes), pas des mots nus : le
           commentaire du code cite « unemployment » et « Ifo Business Climate » en prose, et la
           prose vit dans la même tranche extraite. */
        verif('(mutation) la copie mutée a bien perdu les mots anglais des trois familles',
          !_srcMut.includes('(?:un)?employment') && !_srcMut.includes('|earnings')
          && !_srcMut.includes('|business climate|'));
        const FM = new Function('w', _srcMut + '\nreturn _macroReste;');
        const mut = FM({ macro: [{ heading: 'Inflation & Croissance', bullets: [
          '**Vendredi 28 août · JPY :** Unemployment Rate : 2.4% (attendu 2.5%, préc. 2.5%).',
        ] }] });
        verif('(mutation) sans eux, « Unemployment Rate » retombe dans « Autres chiffres de la semaine »',
          mut.length === 1 && mut[0].heading === 'Autres chiffres de la semaine',
          JSON.stringify(mut.map(s => s.heading)));
        /* ⚠️ ET LA « BANQUE CENTRALE » MANQUANTE DES ARCHIVES EST RECONSTITUÉE (même capture :
           l'ancien prompt interdisait ce thème dans la macro, et la section dédiée qui portait la
           matière a été retirée du rendu — les propos des banques ne s'affichaient nulle part).
           Trois cas : archive sans thème CB mais avec matière dédiée → reconstituée EN TÊTE ;
           rapport neuf avec thème natif → jamais de doublon ; aucune matière → rien d'inventé. */
        const _cbData = [
          { bank: 'Fed (FOMC)', narrative: 'Posture prudente maintenue, réunion de septembre ouverte.', quotes: [{ quote: 'x', analysis: 'y' }] },
          { bank: 'BCE (ECB)', narrative: '', quotes: [{ quote: 'Le conseil reste vigilant.', analysis: 'Ton mesuré, aucun engagement.' }] },
          { bank: 'BoJ', narrative: '', quotes: [] },
        ];
        const sansCb = F({ macro: [{ heading: 'Inflation', bullets: ['x'] }], centralBanks: _cbData });
        verif('la « Banque centrale » manquante d\'une archive est reconstituée depuis sa matière dédiée',
          sansCb[0] && sansCb[0].heading === 'Banque centrale' && sansCb[0].bullets.length === 2
          && /Fed \(FOMC\)/.test(sansCb[0].bullets[0]) && /Ton mesuré/.test(sansCb[0].bullets[1]),
          JSON.stringify(sansCb.map(s => s.heading)));
        verif('… la banque muette (aucun propos ni narratif) n\'y entre pas',
          !sansCb[0].bullets.some(b => /BoJ/.test(b)));
        const avecCb = F({ macro: [{ heading: 'Banque centrale', bullets: ['**Fed :** natif.'] }], centralBanks: _cbData });
        verif('… un rapport NEUF au thème natif ne reçoit JAMAIS de doublon',
          avecCb.filter(s => /banque centrale/i.test(s.heading)).length === 1
          && avecCb[0].bullets.length === 1 && /natif/.test(avecCb[0].bullets[0]),
          JSON.stringify(avecCb.map(s => s.heading)));
        const sansRien = F({ macro: [{ heading: 'Inflation', bullets: ['x'] }] });
        verif('… et sans matière dédiée, rien n\'est inventé',
          !sansRien.some(s => /banque centrale/i.test(s.heading)), JSON.stringify(sansRien.map(s => s.heading)));
      }
      /* Le prompt du serveur suit la même grammaire : plus de cross-asset, banque centrale en tête. */
      const SRV4 = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      verif('le prompt du Hebdo produit les en-têtes des quotidiens',
        /"Géopolitique", "Banque centrale", "Inflation", "Croissance économique", "Emploi", "Technologie & Innovation"/.test(SRV4));
      verif('… et ne commande plus de « Performance Cross-Asset »',
        !/catégorisés[^\n]{0,400}Performance Cross-Asset/.test(SRV4));
      /* L'absence se mesure PRÈS de l'ancre « catégorisés » (la liste du prompt), comme pour
         Cross-Asset : l'historique RECAP_VER cite l'ancienne liste verbatim, et c'est légitime. */
      verif('… ni de « Commerce International & Tarifs » : la liste l\'a perdu, l\'interdit est écrit, le commerce va à la Géopolitique',
        !/catégorisés[^\n]{0,400}Commerce International/.test(SRV4)
        && /PAS de thème « Commerce International & Tarifs »/.test(SRV4)
        && /guerre commerciale\/sanctions commerciales→Géopolitique/.test(SRV4));
      /* « Commerce International » quitte aussi la Synthèse du Global Economic Weekly (30/08, même
         demande, étendue par le user à tout le desk) : le prompt ne le commande plus, et les DEUX
         rendus (desk + mail) filtrent l'en-tête pour que les GEW déjà archivés le perdent aussi. */
      verif('le prompt du GEW ne commande plus « Commerce International »',
        !/"Croissance & Emploi", "Commerce International"/.test(SRV4)
        && /PAS de thème « Commerce International »/.test(SRV4));
      verif('… et les deux rendus du GEW filtrent l\'en-tête (desk + mail), archives comprises',
        /w\.synthese\.filter\(s => s && !\/commerce international\/i\.test\(String\(s\.heading \|\| ''\)\)\)/.test(APP3)
        && /\.filter\(x => !\/commerce international\/i\.test\(x\.h\)\)/.test(fs.readFileSync(path.join(RACINE, 'mailer.js'), 'utf8')));
    }

    /* ══ LES RESTES ANGLAIS DU DESK (audit 28/08, angle « texte produit resté en anglais ») ═════
       Quatre surfaces relevées au navigateur : les tags d'un rapport ouvert (« Geopolitical » à
       deux clics du fil qui dit « Géopolitique »), les en-têtes du menu de recherche de symbole,
       la colonne « Seasonal » de LISTE FX, le bouton « Masquer Insights » posé 40px au-dessus du
       bloc qu'il nomme « Éclairages desk ». Le premier s'éprouve sur la VRAIE fonction extraite ;
       les autres sur la source, où vivait le libellé fautif. */
    {
      console.log('\n── Le desk ne parle plus anglais : tags, menu symbole, colonnes, boutons ──');
      const CH3 = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
      const dT = APP3.indexOf('const _ARLIB_TAG_FR');
      const finT = 'return s.charAt(0).toUpperCase() + s.slice(1);\n}';
      const fT = APP3.indexOf(finT, dT);
      verif('le nettoyeur de tags du lecteur est extractible', dT > 0 && fT > dT);
      if (dT > 0 && fT > dT) {
        const FT = new Function('NEWS_TAG_FR', '_ARLIB_TAG_HIDE',
          APP3.slice(dT, fT + finT.length) + '\nreturn _arlibTagClean;');
        const clean = FT({ 'Geopolitical': 'Géopolitique', 'Equities': 'Actions' }, new Set(['report']));
        verif('« Geopolitical » se rend « Géopolitique », comme dans le fil', clean('Geopolitical') === 'Géopolitique', clean('Geopolitical'));
        verif('le vocabulaire propre aux rapports est traduit aussi (Oil → Pétrole)', clean('Oil') === 'Pétrole', clean('Oil'));
        verif('… et un tag inconnu reste tel quel : le doute profite à la source', clean('Zorbl') === 'Zorbl', clean('Zorbl'));
      }
      verif('le menu symbole titre en français', !CH3.includes("' Recent Searches '") && !/['"]Recent Searches['"]/.test(CH3) && !/['"]Foreign Exchange['"]/.test(CH3),
        'un en-tête anglais est revenu dans renderDd');
      verif('… et nomme les devises par leur CODE (veto user 28/08), les métaux en français',
        /CCY_NAME = \{ USD:'USD'/.test(CH3) && /XAU:'Or', XAG:'Argent'/.test(CH3));
      verif('la colonne de LISTE FX dit « Saisonnalité »', /label: 'Saisonnalité'/.test(CH3) && !/label: 'Seasonal'/.test(CH3));
      verif('le bouton du lecteur parle des « éclairages », plus des « Insights »',
        !APP3.includes('Masquer Insights') && !APP3.includes('Afficher Insights') && APP3.includes('Masquer les éclairages'),
        '« Insights » est revenu dans un libellé de bouton');
      const DICTS = fs.readFileSync(path.join(RACINE, 'public/js/i18n-dicts.js'), 'utf8');
      verif('… et les trois dictionnaires suivent le nouveau wording (pas de clé morte)',
        DICTS.includes('"Masquer les éclairages"') && !DICTS.includes('"Masquer Insights"'));
      /* Le badge de ton du Décryptage : « Restrictif / Accommodant », plus « Hawkish / Dovish » —
         le Radar de Biais dit « Restrictive / Accommodante » pour la MÊME banque (audit 28/08).
         Les clés internes 'hawk'/'dove' restent : seule l'étiquette affichée est en français. */
      verif('le badge de ton du Décryptage parle français (Restrictif / Accommodant)',
        /label: 'Restrictif'/.test(CH3) && /label: 'Accommodant'/.test(CH3)
        && !/key: 'hawk', label: 'Hawkish'/.test(CH3) && !/key: 'dove', label: 'Dovish'/.test(CH3));
    }

    /* ══ TROIS MOIS D'ARCHIVES DANS L'ONGLET ANALYSTES (29/08, demande user « tous les récaps
       doivent rester 3 mois ») ═══════════════════════════════════════════════════════════════════
       La rétention est une CHAÎNE : scrape (SW/BR_MAX_AGE) → mémoire (_capNews) → persistance
       (_persistHistory, weeklyReportList) → route (cutoff 95 j, slice fx-daily) → client (cutoff
       92 j). Le maillon le plus court décide de ce que le lecteur voit, et l'histoire du dépôt le
       prouve : « le plafond de 40 jours écrêtait les rapports que le stockage conservait pourtant —
       la limite était ici, pas dans la génération » (05/08) ; la liste ING coupait à 30 ce que le
       cache garde 90 j. Chaque nombre est CAPTURÉ puis comparé en ≥ : resserrer un maillon rougit,
       l'élargir passe. */
    {
      console.log('\n── Trois mois d\'archives dans l\'onglet ANALYSTES : la chaîne entière ──');
      const SRV5 = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      const AUTH5 = fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8');
      const nb = (src, rx) => { const m = src.match(rx); return m ? parseInt(m[1], 10) : -1; };
      verif('les récaps de séance sont gardés 90 j au scrape (SW_MAX_AGE)',
        nb(SRV5, /const SW_MAX_AGE\s*=\s*(\d+) \* 24/) >= 90, 'SW_MAX_AGE = ' + nb(SRV5, /const SW_MAX_AGE\s*=\s*(\d+) \* 24/) + ' j');
      verif('les notes d\'institutions aussi (BR_MAX_AGE)',
        nb(SRV5, /const BR_MAX_AGE\s*=\s*(\d+) \* 24/) >= 90, 'BR_MAX_AGE = ' + nb(SRV5, /const BR_MAX_AGE\s*=\s*(\d+) \* 24/) + ' j');
      verif('la persistance Supabase suit (~92 j, HISTORY_KEEP_MS)',
        nb(SRV5, /const HISTORY_KEEP_MS\s*=\s*(\d+) \* 24/) >= 90);
      verif('… avec des plafonds d\'items qui tiennent 3 mois (900 institution / 450 wraps)',
        /key === 'bank_research' \? 900 : 450/.test(SRV5));
      verif('la mémoire protège les rapports du flux (300 places dédiées, jamais évincés par les news)',
        nb(SRV5, /rapports\.slice\(0, (\d+)\)/) >= 300);
      verif('la route hebdo/quotidiens sert 3 mois (cutoff 95 j)',
        nb(SRV5, /const cutoff = Date\.now\(\) - (\d+) \* 24 \* 60 \* 60 \* 1000;\n  const items = allNews\.filter\(i => _WK_TYPES/) >= 95);
      verif('le rechargement Supabase couvre 13 semaines d\'hebdos ET 3 mois pleins de quotidiens',
        nb(AUTH5, /NB_HEBDO = complet \? (\d+) :/) >= 30 && nb(AUTH5, /NB_QUOTI = complet \? (\d+) :/) >= 190,
        'NB_HEBDO=' + nb(AUTH5, /NB_HEBDO = complet \? (\d+) :/) + ', NB_QUOTI=' + nb(AUTH5, /NB_QUOTI = complet \? (\d+) :/) + ' (130 nécessaires + marge)');
      verif('la liste FX Daily (ING) ne coupe plus à 6 semaines',
        nb(SRV5, /FX Daily\\b[\s\S]{0,700}?\.slice\(0, (\d+)\)/) >= 70,
        'slice = ' + nb(SRV5, /FX Daily\\b[\s\S]{0,700}?\.slice\(0, (\d+)\)/) + ' (70 ≈ 14 semaines de jours ouvrés)');
      verif('et le client affiche la même fenêtre (92 j, aucun écrêtage de rendu)',
        nb(APP3, /const cutoff = Date\.now\(\) - (\d+) \* 24 \* 60 \* 60 \* 1000/) >= 92
        && !/items = items\.slice\(0, \d+\)/.test(APP3.slice(APP3.indexOf('function renderArlibList'), APP3.indexOf('function renderArlibList') + 3000)));
    }

    console.log('\n── Identité visuelle : Récap Quotidien ↔ récap de séance ──');
    verif('le titre de rubrique a le MÊME style calculé', memeStyle(st.titreQ, st.titreS, CT), diff(st.titreQ, st.titreS, CT));
    // Le desk applique une échelle globale : 3 px déclarés rendent 2,986 px calculés. On mesure donc
    // à l'arrondi près, pas au pixel littéral — sinon le contrôle échouerait sur une page correcte.
    const px = v => Math.round(parseFloat(v || '0'));
    /* ⚠️ LE LISERÉ VERTICAL A DISPARU, ET C'EST DEMANDÉ (04/09 : « les titres doivent ressembler à
       celui-ci sans avoir de trait à gauche du titre »). Ce banc exigeait sa PRÉSENCE, et à 3×13 px
       exactement — il aurait donc bloqué le retrait qu'on vient de faire. On inverse la contrainte :
       aucun des deux rapports ne porte plus de barre, et le contrôle le vérifie sur le pseudo-élément
       lui-même, pas sur l'absence de règle dans la feuille. */
    const sansBarre = b => !b || b.content === 'none' || px(b.width) === 0;
    verif('aucun titre ne porte plus de liseré vertical à gauche',
      sansBarre(st.barreQ) && sansBarre(st.barreS),
      'Quotidien : ' + (st.barreQ && st.barreQ.width) + ' · Séance : ' + (st.barreS && st.barreS.width));
    /* ET LES TROIS RAPPORTS PARLENT LA MÊME LANGUE. Le Hebdo est la référence : si le Quotidien et
       la séance s'en écartent, c'est le même desk qui se contredit d'un rapport à l'autre. */
    verif('… et le titre s\'aligne sur celui du Récap Hebdo, qui est la référence',
      memeStyle(st.titreS, st.titreH, ['color', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'marginTop', 'marginBottom', 'paddingBottom', 'borderBottomWidth']),
      diff(st.titreS, st.titreH, ['color', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'marginTop', 'marginBottom', 'paddingBottom', 'borderBottomWidth']));
    verif('l\'encadré de synthèse a le MÊME style calculé', memeStyle(st.boxQ, st.boxS, CE), diff(st.boxQ, st.boxS, CE));
    /* ── LE HEBDO REJOINT LE QUOTIDIEN (27/08, demande utilisateur : « j'aime bien la structure
       design du rapport quotidien, applique-la au hebdo pour que ce soit épuré pareil »). Trois
       écarts MESURÉS, trois contrôles. La fonte des titres, elle, reste volontairement différente :
       le Hebdo suit la règle de marque (Inter Tight sur tous les titres du desk), c'est le
       Quotidien qui y échappe — l'aligner aurait éloigné les deux de la charte. */
    verif('le sous-titre du Hebdo a le MÊME style que celui du Quotidien',
      memeStyle(st.sousQ, st.sousH, CT.filter(k => k !== 'fontFamily')), diff(st.sousQ, st.sousH, CT.filter(k => k !== 'fontFamily')));
    verif('… et sa puce aussi', memeStyle(st.puceQ, st.puceH, ['fontSize', 'color', 'lineHeight']), diff(st.puceQ, st.puceH, ['fontSize', 'color', 'lineHeight']));
    verif('… et sa synthèse porte le MÊME encadré doré', memeStyle(st.boxQ, st.boxH, CE), diff(st.boxQ, st.boxH, CE));
    /* Le contrôle décisif : sans liseré, la synthèse du Hebdo redevient de la prose nue — l'état
       d'avant, qu'aucune comparaison de couleurs seule n'aurait distingué d'un fond transparent. */
    verif('… un liseré RÉELLEMENT peint, pas une classe posée',
      parseFloat(st.boxH && st.boxH.borderLeftWidth || '0') > 0.5, 'liseré ' + (st.boxH && st.boxH.borderLeftWidth));
    verif('son texte aussi', memeStyle(st.paraQ, st.paraS, CP), diff(st.paraQ, st.paraS, CP));
    verif('le titre de rubrique est bien or', st.titreS && st.titreS.color === 'rgb(227, 178, 58)', st.titreS && st.titreS.color);
    verif('l\'encadré porte le liseré or', st.boxS && /227, 178, 58/.test(st.boxS.borderLeftColor), st.boxS && st.boxS.borderLeftColor);
    // Plus de double trait : le titre porte sa bordure, il n'est plus précédé d'un filet.
    const APP2 = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
    /* Le titre de rubrique du LECTEUR DE RAPPORTS était écrit à quatre endroits ; il passe désormais
       par un point de pose unique, qui mémorise la rubrique courante (ce dont la Synthèse a besoin
       pour se rendre en encadré). Les deux autres occurrences de la classe sont ailleurs et
       assumées : l'autre rendu de rapport (puces « Rubrique: … ») et l'encadré « Niveaux clés ». */
    verif('le lecteur de rapports pose son titre en UN point', /const _poserRubrique = \(t\) => \{/.test(APP2) && (APP2.match(/_poserRubrique\(/g) || []).length === 4,
      (APP2.match(/_poserRubrique\(/g) || []).length + ' appel(s)');
    verif('plus de filet collé au titre', !/arlib-rdivider"><div class="arlib-rsection"/.test(APP2));
    verif('la SYNTHÈSE se rend en encadré, pas en puces', /tag === 'ul' && \/\^SYNTH\[ÈE\]SE\$\/\.test\(_rubrique\)/.test(APP2));
    verif('la règle CSS est partagée, pas dupliquée', /\.fxdr-section,\s*\n\.arlib-rsection \{/.test(fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8')));

    /* ── « C'EST COLLÉ AU CALENDRIER » : ON MESURE L'ÉCART, EN PIXELS ──────────────────────────
       30/08, capture : sous le tableau de « À surveiller », la première puce démarrait SUR la
       dernière ligne du calendrier. `.arlib-rbullet` ne porte qu'une marge BASSE ; rien ne la
       séparait donc de ce qui la précède. Une lecture de la feuille ne tranche pas — il faut
       poser les deux éléments l'un sous l'autre et mesurer ce qu'il y a entre eux.
       On mesure les DEUX formes : celle d'aujourd'hui (le tableau, l'intitulé « Autres », les
       puces) et le filet posé pour l'autre (une puce qui suivrait le tableau directement, sur un
       rapport plus ancien). */
    const ec = await page.evaluate(() => {
      const box = document.createElement('div');
      box.style.width = '760px';
      box.innerHTML =
        '<div class="arlib-rbody" id="A">'
        + '<div class="fxdr-callike"><div class="fxdr-tablewrap"><table class="cal-table"><tbody>'
        + '<tr class="cal-row"><td class="cth-time">12:00</td><td class="cth-event">CBI Distributive Trades</td></tr>'
        + '</tbody></table></div></div>'
        + '<div class="arlib-rsubsection">Autres</div>'
        + '<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>Résultats du T2 de Nvidia.</span></div>'
        + '</div>'
        + '<div class="arlib-rbody" id="B">'
        + '<div class="fxdr-callike"><div class="fxdr-tablewrap"><table class="cal-table"><tbody>'
        + '<tr class="cal-row"><td class="cth-time">12:00</td><td class="cth-event">CBI Distributive Trades</td></tr>'
        + '</tbody></table></div></div>'
        + '<div class="arlib-rbullet"><span class="arlib-rbullet-dot"></span><span>Résultats du T2 de Nvidia.</span></div>'
        + '</div>';
      document.body.appendChild(box);
      const bas = (id, sel) => document.querySelector('#' + id + ' ' + sel).getBoundingClientRect().bottom;
      const haut = (id, sel) => document.querySelector('#' + id + ' ' + sel).getBoundingClientRect().top;
      const r = {
        // Le desk applique une échelle globale : on ramène en pixels DÉCLARÉS pour raisonner sur
        // les valeurs de la feuille, sinon 20 px écrits rendent 18 px mesurés et le seuil ment.
        z: document.body.offsetWidth ? (document.body.getBoundingClientRect().width / document.body.offsetWidth) : 1,
        avecTitre: haut('A', '.arlib-rsubsection') - bas('A', '.fxdr-callike'),
        titreAPuce: haut('A', '.arlib-rbullet') - bas('A', '.arlib-rsubsection'),
        sansTitre: haut('B', '.arlib-rbullet') - bas('B', '.fxdr-callike'),
        filet: getComputedStyle(document.querySelector('#A .arlib-rsubsection')).borderTopWidth,
      };
      box.remove();
      return r;
    });
    const _dec = v => Math.round(v / (ec.z || 1));   // pixels déclarés
    console.log('\n── « À surveiller » : les puces ne collent plus au calendrier ──');
    /* Le seuil est à 18 et non à 14 : `.arlib-rsubsection` porte DÉJÀ 14 px de marge haute, un
       contrôle à 14 serait donc vert sans la règle qu'il prétend éprouver. On mesure la respiration
       RENFORCÉE posée sous le tableau (20 px), pas celle qu'un sous-titre a partout. */
    verif('l\'intitulé « Autres » respire sous le tableau', _dec(ec.avecTitre) >= 18,
      _dec(ec.avecTitre) + ' px déclarés entre le bas du tableau et l\'intitulé');
    verif('… avec un filet qui sépare franchement les deux', parseFloat(ec.filet) > 0, 'bordure haute : ' + ec.filet);
    verif('la puce suit son intitulé sans s\'en détacher', _dec(ec.titreAPuce) >= 0 && _dec(ec.titreAPuce) <= 12,
      _dec(ec.titreAPuce) + ' px déclarés');
    /* LE FILET, pour un rapport d'avant le 30/08 ou une rubrique sans intitulé : une puce ne doit
       jamais revenir se coller au tableau. Mesuré avant correction : 0 px. */
    verif('une puce qui suit le tableau directement garde un écart', _dec(ec.sansTitre) >= 12,
      _dec(ec.sansTitre) + ' px déclarés (0 avant correction)');

    /* ── LE RÉCAP QUOTIDIEN S'AFFICHE-T-IL ? ───────────────────────────────────────────────────
       AUCUN contrôle n'ouvrait ce rapport. Le 26/08, une extraction de fonction y a emporté trois
       lignes de l'appelant : `body` n'existait plus dans la fonction d'accueil, et le rapport
       levait une ReferenceError DÈS QU'IL AVAIT DES ÉCHÉANCES. `node -c` ne voit rien (syntaxe
       valide) et js-verif non plus (`body` est bien déclaré ailleurs dans le fichier). Seul un
       rendu réel le voit — d'où ce contrôle : on rend le rapport avec un jeu d'essai et on regarde
       s'il produit son tableau, sans exception. */
    const q = await page.evaluate(() => {
      const J = Date.now() + 3600000;
      const fx = {
        title: 'FX Daily Recap', dateLabel: 'mercredi 26 août', summary: 'Séance sans direction.',
        geopolitics: [], geoKeyPoints: [], cb: [], macro: [
          'Tarifs canadiens : la ministre du Commerce annonce des tarifs de 50% sur des biens américains → pression sur le **CAD**.',
          'Prix du pétrole (Brent) : recul de -3,0% à 87,78 $ le baril → affaiblit les devises exportatrices.',
          '**CPI** allemand : 0,4%',
        ],
        regions: [], pairs: [], headlines: [], insights: [], fils: ['Médiation en cours → à suivre.'],
        lookahead: [
          { ts: J, ccy: 'USD', event: 'Core PCE Price Index m/m', importance: 'High', actual: '', forecast: '0.2%', previous: '0.1%' },
          { ts: J + 7200000, ccy: 'EUR', event: 'GfK Consumer Confidence', importance: 'Medium', actual: '', forecast: '', previous: '-29.6' },
        ],
      };
      /* `_renderFXDailyRecap` écrit dans #arlib-rcontent, qui existe déjà dans la page du desk : on
         lui emprunte le conteneur le temps du contrôle, puis on rétablit son contenu. */
      const hote = document.getElementById('arlib-rcontent');
      if (!hote || typeof _renderFXDailyRecap !== 'function') return { absent: true };
      const avant = hote.innerHTML;
      let err = '';
      try { _renderFXDailyRecap({ _fxr: fx, headline: 'FX Daily Recap', timestamp: Date.now() }); }
      catch (e) { err = e.message; }
      const h = hote.innerHTML;
      hote.innerHTML = avant;
      return {
        err, rendu: h.length,
        section: /À surveiller/.test(h),
        table: /class="cal-table"/.test(h),
        lignes: (h.match(/class="cal-row fxdr-cal-clic"/g) || []).length,
        colonnes: (h.match(/<th class="cth/g) || []).length,
        haut: /cth-val--haut/.test(h) || /cth-val--bas/.test(h),
        fils: /Médiation en cours/.test(h),
        macro: (() => {
          /* LA RUBRIQUE MACRO, DÉCOUPÉE À LA SECTION SUIVANTE. Ce qu'on mesure : AUCUNE puce ne doit
             précéder le premier sous-titre de famille (28/08, capture à l'appui : « il manque une
             souspartie ici corrige » — la rubrique ouvrait sur deux puces nues, « Tarifs canadiens »
             et « Prix du pétrole »). */
          const d = h.indexOf('<div class="fxdr-section">Macro</div>');
          if (d < 0) return { absent: true };
          const suite = h.indexOf('<div class="fxdr-section">', d + 10);
          const z = h.slice(d, suite < 0 ? h.length : suite);
          const t1 = z.indexOf('fxdr-grp-title'), p1 = z.indexOf('wr-bullet');
          return {
            titres: (z.match(/<div class="fxdr-grp-title">([^<]*)<\/div>/g) || []).map(x => x.replace(/<[^>]+>/g, '')),
            puces: (z.match(/class="wr-bullet"/g) || []).length,
            puceAvantTitre: p1 >= 0 && (t1 < 0 || p1 < t1),
          };
        })(),
      };
    });
    console.log('\n── Récap Quotidien : la rubrique « À surveiller » se rend ──');
    if (q.absent) {
      console.log('  · fonction de rendu non exposée globalement → contrôle abstenu.');
    } else {
      verif('le rapport se rend sans exception', !q.err, q.err);
      verif('la rubrique « À surveiller » est là', q.section);
      verif('elle contient le VRAI tableau du calendrier', q.table);
      verif('une ligne par échéance', q.lignes === 2, q.lignes + ' ligne(s)');
      verif('les colonnes HAUT et BAS ont disparu', !q.haut);
      verif('il reste huit colonnes', q.colonnes === 8, q.colonnes + ' colonne(s)');
      verif('les fils ouverts sont rendus avant le tableau', q.fils);
      /* ── MACRO : AUCUNE PUCE SANS SOUS-TITRE (28/08, « il manque une souspartie ici corrige ») ──
         Ce qui ne rentre pas dans les quatre rubriques du Radar — une mesure commerciale, un prix du
         brut — se rendait EN TÊTE et SANS intitulé. C'était mon arbitrage (rendues APRÈS un groupe
         titré, ces puces se lisaient comme sa suite) et c'est le MÊME que le user avait déjà tranché
         le 26/08 sur le récap de séance. Depuis le 30/08 (demande user), la famille « Commerce »
         est RETIRÉE : la mesure tarifaire vit dans « Autres », qui porte toujours son intitulé.
         Le contrôle est fait sur un RENDU RÉEL : le classement est écrit en dur dans une fonction de
         500 lignes, aucune lecture de source ne dirait ce que le lecteur voit. */
      const m = q.macro || {};
      if (m.absent) {
        verif('la rubrique Macro se rend', false, 'section absente du rendu');
      } else {
        verif('Macro : aucune puce avant le premier sous-titre', !m.puceAvantTitre, (m.titres || []).join(' · '));
        verif('Macro : toutes les puces sont rendues', m.puces === 3, m.puces + ' puce(s)');
        verif('Macro : plus aucun intitulé « Commerce » (famille retirée le 30/08)',
          (m.titres || []).indexOf('Commerce') < 0, (m.titres || []).join(' · '));
        verif('Macro : la mesure tarifaire vit sous « Autres », toujours intitulée',
          (m.titres || []).indexOf('Autres') >= 0, (m.titres || []).join(' · '));
        verif('Macro : les rubriques du Radar passent en premier',
          (m.titres || []).indexOf('Inflation') < (m.titres || []).indexOf('Autres'), (m.titres || []).join(' · '));
        verif('Macro : « Autres » ferme la rubrique',
          (m.titres || []).indexOf('Autres') === (m.titres || []).length - 1, (m.titres || []).join(' · '));
      }
    }

    /* « CHARGER PLUS » DÉROULE LA JOURNÉE ENTIÈRE (demande user 25/08).
       L'assertion porte sur l'INVARIANT, mesuré avec les propres fonctions du fil : après le clic,
       tout ce que le fil retient pour la journée affichée doit être visible. Compter des lignes
       attendues depuis le jeu d'essai reviendrait à mesurer le dédoublonnage et les filtres du
       produit en croyant mesurer la pagination — et à faire échouer le contrôle pour de mauvaises
       raisons le jour où l'un d'eux évolue. */
    const sonde = () => page.evaluate(() => {
      const jr = ts => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
      const f = (typeof getFilteredItems === 'function') ? getFilteredItems() : [];
      const jour = f.length ? jr(f[0].timestamp) : '';
      // Même règle qu'au-dessus : un seul panneau, sinon chaque ligne se compte deux fois.
      const cl = document.getElementById('news-list');
      const b = cl.querySelector('.load-more-btn') || document.querySelector('.load-more-btn');
      const ids = [...cl.querySelectorAll('.news-item[data-id]')].map(e => e.dataset.id);
      return {
        jour,
        duJour: f.filter(i => jr(i.timestamp) === jour).length,
        montresDuJour: f.slice(0, displayLimit).filter(i => jr(i.timestamp) === jour).length,
        lignes: ids.length, uniques: new Set(ids).size,
        enTetes: cl.querySelectorAll('.date-header').length,
        titresJours: [...cl.querySelectorAll('.date-header')].map(e => e.textContent.trim()),
        parJour: (() => { const o = {}; for (const e of cl.querySelectorAll('.news-item[data-id]')) { const it = allItems.find(x => x.id === e.dataset.id); const k = it ? jr(it.timestamp) : '?'; o[k] = (o[k] || 0) + 1; } return o; })(),
        libelle: b ? b.textContent.trim() : '(aucun bouton)',
      };
    });
    const av = await sonde();

    await page.evaluate(() => document.querySelector('.load-more-btn').click());
    await new Promise(r => setTimeout(r, 4000));
    const ap = await sonde();
    verif('le clic déroule des actualités supplémentaires', ap.lignes > av.lignes, av.lignes + ' → ' + ap.lignes + ' ligne(s)');
    verif('aucun doublon', ap.lignes === ap.uniques, (ap.lignes - ap.uniques) + ' doublon(s)');
    verif('on ne déborde pas sur la journée précédente', ap.enTetes === 1,
      ap.enTetes + ' en-tête(s) : ' + JSON.stringify(ap.titresJours) + ' · lignes par journée ' + JSON.stringify(ap.parJour)
      + ' · avant le clic ' + JSON.stringify(av.parJour) + ' · du jour ' + av.duJour + ', montrés ' + av.montresDuJour);
    verif('le bouton propose maintenant le jour précédent',
      /^Charger \p{L}+/u.test(ap.libelle) && !/toute la journée/i.test(ap.libelle), ap.libelle);
  } catch (e) {
    ko++; console.log('  ✗ le desk n\'a pas pu être ouvert : ' + e.message);
  } finally {
    try { if (nav) await nav.close(); } catch {}
    srv.close();
  }
  const total = ko + koLogique;
  console.log(`\n${total === 0 ? '✓ LE DESK REND SON FIL' : '✗ ' + total + ' ÉCHEC(S)'}\n`);
  process.exit(total ? 1 : 0);
})();

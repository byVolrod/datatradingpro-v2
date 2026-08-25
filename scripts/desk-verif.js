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
const CARACT = [
  { id: 'n1', headline: 'US ADP Employment Change beats forecast', description: 'Actual: 104K Forecast: 75K',
    category: 'Economic Commentary', source: 'Reuters', time: '16:09', timestamp: J0, priority: 'normal', tags: ['USD'] },
  { id: 'eva-adp-1', headline: 'ANALYSE ADP US : Emploi privé US ADP en hausse, marché équilibré', description: '<p>Le chiffre…</p>',
    category: 'Economic Commentary', source: 'DTP Markets', time: '16:09', timestamp: J0 - 1000, priority: 'high',
    _eventAnalysis: true, _reportType: 'ADP', _pair: 'EURUSD', tags: ['USD'] },
  { id: 'fj-1', headline: 'BREAKING: Fed officials signal caution', description: '…', category: 'Central Banks',
    source: 'FinancialJuice', time: '15:40', timestamp: J0 - 2000, urgent: true, priority: 'high', tags: ['USD'] },
  { id: 'n2', headline: 'Euro steady ahead of German Ifo', description: '…', category: 'Forex', source: 'Reuters',
    time: '15:10', timestamp: J0 - 3000, priority: 'normal', tags: ['EUR'] },
  { id: 'n3', headline: 'Oil edges higher on supply concerns', description: '…', category: 'Commodities', source: 'Reuters',
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
    category: ['Forex', 'Commodities', 'Central Banks', 'Equities'][i % 4],
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
    const d = await page.evaluate(() => ({
      page: location.pathname,
      liste: !!document.getElementById('news-list'),
      lignes: document.querySelectorAll('.news-item').length,
      rouges: document.querySelectorAll('.news-item--breaking').length,
      enTetes: document.querySelectorAll('.date-header').length,
      vide: document.querySelectorAll('.empty-state').length,
    }));
    console.log('\n── Desk ouvert dans Chromium, API bouchonnée ──');
    verif('la page reste sur le desk (pas de renvoi vers /login)', d.page === '/index.html', d.page);
    verif('le conteneur du fil existe', d.liste);
    verif('le fil affiche des actualités', d.lignes >= 20, d.lignes + ' ligne(s) rendue(s)');
    verif('l\'en-tête de journée est là', d.enTetes >= 1, String(d.enTetes));
    verif('aucun message « aucun élément »', d.vide === 0);
    // Une analyse du desk et une dépêche urgente : deux lignes rouges attendues.
    verif('les news majeures ressortent en rouge', d.rouges === 2, d.rouges + ' rouge(s) au lieu de 2');
    verif('aucune erreur d\'exécution', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));

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
    verif('les rapports hebdo ont enfin un cache local', /lsGet\('dtp_wk', DAY\)/.test(APP) && /lsSet\('dtp_wk'/.test(APP));
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
      box.innerHTML = '<div class="fxdr"><div class="fxdr-section">A</div><div class="fxdr-exec"><p class="wr-p">x</p></div></div>'
        + '<div class="arlib-rbody"><div class="arlib-rsection">A</div><div class="arlib-rexec"><p class="wr-p">x</p></div></div>';
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
        titreQ: cs('.fxdr-section'), titreS: cs('.arlib-rsection'),
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
    console.log('\n── Identité visuelle : Récap Quotidien ↔ récap de séance ──');
    verif('le titre de rubrique a le MÊME style calculé', memeStyle(st.titreQ, st.titreS, CT), diff(st.titreQ, st.titreS, CT));
    // Le desk applique une échelle globale : 3 px déclarés rendent 2,986 px calculés. On mesure donc
    // à l'arrondi près, pas au pixel littéral — sinon le contrôle échouerait sur une page correcte.
    const px = v => Math.round(parseFloat(v || '0'));
    verif('le liseré or existe des deux côtés', st.barreS && px(st.barreS.width) === 3 && px(st.barreS.height) === 13,
      st.barreS ? st.barreS.width + '×' + st.barreS.height : '(aucun)');
    verif('… et il est identique', memeStyle(st.barreQ, st.barreS, CB), diff(st.barreQ, st.barreS, CB));
    verif('l\'encadré de synthèse a le MÊME style calculé', memeStyle(st.boxQ, st.boxS, CE), diff(st.boxQ, st.boxS, CE));
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
      const b = document.querySelector('.load-more-btn');
      const ids = [...document.querySelectorAll('.news-item[data-id]')].map(e => e.dataset.id);
      return {
        jour,
        duJour: f.filter(i => jr(i.timestamp) === jour).length,
        montresDuJour: f.slice(0, displayLimit).filter(i => jr(i.timestamp) === jour).length,
        lignes: ids.length, uniques: new Set(ids).size,
        enTetes: document.querySelectorAll('.date-header').length,
        libelle: b ? b.textContent.trim() : '(aucun bouton)',
      };
    });
    const av = await sonde();

    await page.evaluate(() => document.querySelector('.load-more-btn').click());
    await new Promise(r => setTimeout(r, 4000));
    const ap = await sonde();
    verif('le clic déroule des actualités supplémentaires', ap.lignes > av.lignes, av.lignes + ' → ' + ap.lignes + ' ligne(s)');
    verif('aucun doublon', ap.lignes === ap.uniques, (ap.lignes - ap.uniques) + ' doublon(s)');
    verif('on ne déborde pas sur la journée précédente', ap.enTetes === 1, ap.enTetes + ' en-tête(s) de journée');
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

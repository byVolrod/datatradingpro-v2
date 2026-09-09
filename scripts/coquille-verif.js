#!/usr/bin/env node
/**
 * scripts/coquille-verif.js — LE DESK PEUT-IL ENCORE S'AFFICHER SANS STYLES ?
 *
 * POURQUOI (09/09). Deux membres — signalement Discord — ont vu le desk en HTML BRUT à la
 * connexion. Le diagnostic a trouvé trois faiblesses qui se cumulaient, et aucune n'était visible en
 * lisant le code :
 *
 *   1. `public/css/style.css` pèse 1,4 Mo et partait EN CLAIR. `express.static` ne compresse rien et
 *      aucun middleware de compression n'était monté. Sur un lien mobile, c'est plusieurs secondes
 *      de transfert pour un seul fichier.
 *   2. Un transfert coupé en route ne lève PAS d'erreur exploitable : `onerror` d'un <link> ne se
 *      déclenche que sur un échec franc, jamais sur un corps tronqué que le navigateur applique
 *      partiellement. Rien dans la page ne s'en apercevait, donc rien ne le réparait.
 *   3. Le service worker répondait `respondWith(fetch(req))` SANS repli : une coupure d'une seconde
 *      sur un actif versionné donnait une erreur réseau franche, donc un desk sans feuille de
 *      styles. Et il mémorisait toute réponse 200, y compris une réponse REDIRIGÉE — la page de
 *      connexion mise en cache sous l'URL de la feuille de styles aurait donné un desk nu à chaque
 *      ouverture, définitivement, puisqu'un service worker répond avant le réseau.
 *
 * CE BANC N'EN LIT AUCUNE. Il EXÉCUTE le middleware extrait de `server.js`, il CHARGE le vrai
 * `sw.js` dans un bac à sable et lui envoie de vrais événements, et il OUVRE une page dans un vrai
 * Chromium avec une feuille TRONQUÉE pour voir si elle se répare toute seule. Une relecture ne voit
 * aucun des trois défauts : ils sont tous dans le comportement, pas dans la grammaire.
 *
 *   node scripts/coquille-verif.js
 *
 * Sans navigateur disponible, seule la phase 4 s'abstient — les trois autres tournent partout.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const zlib = require('zlib');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}

/* ══ PHASE 1 — LA SENTINELLE EST-ELLE LA DERNIÈRE RÈGLE DE LA FEUILLE ? ═════════════════════════
   Elle ne prouve quelque chose QUE si rien ne la suit. Placée en tête ou au milieu, elle serait
   présente sur une feuille tronquée et affirmerait le contraire de ce qu'elle est censée établir —
   une sentinelle qui ment est pire que pas de sentinelle, parce qu'on lui fait confiance. */
console.log('\n[1] La sentinelle est la dernière règle de la feuille');
const CSS = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8');
const MARQUE = '--dtp-coquille';
t('la feuille porte la sentinelle', CSS.indexOf(MARQUE) >= 0);
{
  const i = CSS.lastIndexOf(MARQUE);
  // Ce qui suit la sentinelle, commentaires et blancs retirés : il ne doit RIEN rester.
  const apres = CSS.slice(i).replace(/\/\*[\s\S]*?\*\//g, '');
  const reste = apres.slice(apres.indexOf('}') + 1).trim();
  t('aucune règle ne la suit', reste === '', JSON.stringify(reste.slice(0, 80)));
  t('elle n\'apparaît qu\'une fois', CSS.indexOf(MARQUE) === i);
}

/* ══ PHASE 2 — LE MIDDLEWARE DE COMPRESSION, EXÉCUTÉ ════════════════════════════════════════════
   On extrait le VRAI bloc de `server.js` (pas une copie : une copie diverge, et c'est la copie
   qu'on testerait) et on l'exécute avec un `app` espion. On lui envoie ensuite de vraies requêtes.  */
console.log('\n[2] Le middleware de compression, exécuté');
const SERVEUR = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const DEBUT = '/* ══ COMPRESSION DES ACTIFS DE LA COQUILLE';
const FIN = "app.use(express.static(path.join(__dirname, 'public'), {";
let poigneeGz = null, motifGz = null;
{
  const a = SERVEUR.indexOf(DEBUT), b = SERVEUR.indexOf(FIN);
  t('le bloc est présent dans server.js, AVANT express.static', a >= 0 && b > a, 'a=' + a + ' b=' + b);
  if (a >= 0 && b > a) {
    const src = SERVEUR.slice(a, b);
    const app = { get: (rx, fn) => { motifGz = rx; poigneeGz = fn; } };
    const bac = { require, path, fs, __dirname: RACINE, app, console };
    vm.createContext(bac);
    try { vm.runInContext(src, bac, { filename: 'server.js#gzip' }); }
    catch (e) { t('le bloc s\'exécute', false, e.message); }
    // ⚠️ PAS `instanceof RegExp` : le bloc est exécuté dans un autre contexte, donc son RegExp
    //    n'est pas le nôtre et la comparaison serait FAUSSE alors que tout marche.
    t('le bloc enregistre une route',
      typeof poigneeGz === 'function' && Object.prototype.toString.call(motifGz) === '[object RegExp]');
  }
}

// Réponse espionne : assez fidèle pour que la vraie poignée ne voie pas la différence.
function fausseReponse() {
  const r = {
    entetes: {}, code: 200, corps: null, fini: false,
    set(k, v) { r.entetes[String(k).toLowerCase()] = String(v); return r; },
    type(v) { r.entetes['content-type'] = v; return r; },
    status(c) { r.code = c; return r; },
    end(b) { r.fini = true; r.corps = b || null; return r; },
  };
  return r;
}
function demander(chemin, entetes) {
  const req = { path: chemin, method: 'GET', headers: Object.assign({ 'accept-encoding': 'gzip, deflate, br' }, entetes || {}) };
  const res = fausseReponse();
  let suivant = false;
  poigneeGz(req, res, () => { suivant = true; });
  return { req, res, suivant };
}
function demanderAsync(chemin, entetes) {
  const req = { path: chemin, method: 'GET', headers: Object.assign({ 'accept-encoding': 'gzip, deflate, br' }, entetes || {}) };
  const res = fausseReponse();
  let suivant = false;
  const p = poigneeGz(req, res, () => { suivant = true; });
  return Promise.resolve(p).then(() => ({ req, res, get suivant() { return suivant; } }));
}

async function phaseCompression() {
  if (!poigneeGz) return;
  t('le motif accepte /css/style.css', motifGz.test('/css/style.css'));
  t('le motif refuse une donnée', !motifGz.test('/api/news'));
  t('le motif refuse un chemin qui remonte', !motifGz.test('/css/../server.js'));
  /* TÉMOIN INVERSE : les données ne doivent JAMAIS passer par ici. Un `compression()` global
     mettrait en tampon le flux SSE de l'IA — la réponse arriverait d'un bloc à la fin au lieu
     d'au fil de l'eau, et rien côté serveur ne le signalerait. */
  t('le flux SSE de l\'IA n\'est pas concerné', !motifGz.test('/api/ai/chat'));

  const brut = fs.readFileSync(path.join(RACINE, 'public/css/style.css'));

  // ── Un navigateur moderne : brotli.
  const a = await demanderAsync('/css/style.css');
  t('la feuille repart compressée en brotli', a.res.entetes['content-encoding'] === 'br', JSON.stringify(a.res.entetes));
  t('elle annonce son type', /text\/css/.test(a.res.entetes['content-type'] || ''));
  t('elle porte Vary: Accept-Encoding', /accept-encoding/i.test(a.res.entetes['vary'] || ''));
  t('elle porte une empreinte', !!a.res.entetes['etag']);
  t('le corps brotli se déplie à l\'identique',
    Buffer.isBuffer(a.res.corps) && zlib.brotliDecompressSync(a.res.corps).equals(brut));

  // ── Un client plus ancien : gzip. Une empreinte DISTINCTE, sinon un cache intermédiaire pourrait
  //    servir l'un pour l'autre — deux corps différents ne peuvent pas porter la même empreinte.
  const g = await demanderAsync('/css/style.css', { 'accept-encoding': 'gzip, deflate' });
  t('un client sans brotli reçoit du gzip', g.res.entetes['content-encoding'] === 'gzip');
  t('le corps gzip se déplie à l\'identique',
    Buffer.isBuffer(g.res.corps) && zlib.gunzipSync(g.res.corps).equals(brut));
  t('les deux codages portent des empreintes DIFFÉRENTES', g.res.entetes['etag'] !== a.res.entetes['etag'],
    'même empreinte pour deux corps différents');

  /* LA MESURE QUI JUSTIFIE TOUT LE CHANTIER : le temps d'exposition à une coupure est
     proportionnel au nombre d'octets. On exige un facteur 3 au PIRE des cas (le client le moins
     bien équipé, en gzip) — mesuré 3,5 en gzip et 4,4 en brotli sur la feuille réelle. Sous ce
     seuil, la compression cesserait d'être une assurance et ne serait plus qu'un détail de perf. */
  const pire = brut.length / g.res.corps.length;
  t('même au pire, la feuille pèse 3 fois moins', pire >= 3, 'facteur ' + pire.toFixed(2));

  const b = await demanderAsync('/css/style.css', { 'if-none-match': a.res.entetes['etag'] });
  t('une seconde visite reçoit 304', b.res.code === 304 && !b.res.corps);

  const c = await demanderAsync('/css/style.css', { 'accept-encoding': 'identity' });
  t('un client sans compression repart vers express.static', c.suivant === true && !c.res.entetes['content-encoding']);

  const d = await demanderAsync('/css/jamais-vu-ici.css');
  t('un fichier absent repart vers express.static', d.suivant === true);
}

/* ══ PHASE 3 — LE SERVICE WORKER, CHARGÉ ET SOLLICITÉ ═══════════════════════════════════════════
   On charge le VRAI fichier dans un bac à sable muni d'un faux `self`, d'un faux `caches` et d'un
   faux `fetch`, puis on lui envoie de vrais événements et on lit ce qu'il répond. Les quatre
   scénarios sont ceux qui ont fait la panne, pas des cas de laboratoire.                          */
console.log('\n[3] Le service worker, chargé et sollicité');
function chargerSW(source) {
  const memoire = new Map();               // nom de cache → Map(url → réponse)
  const listeners = {};
  const faireCache = (nom) => {
    if (!memoire.has(nom)) memoire.set(nom, new Map());
    const m = memoire.get(nom);
    return {
      match: (req) => Promise.resolve(m.get(String(req.url || req)) || undefined),
      put: (req, rep) => { m.set(String(req.url || req), rep); return Promise.resolve(); },
      delete: (req) => Promise.resolve(m.delete(String(req.url || req))),
      keys: () => Promise.resolve([...m.keys()].map((u) => ({ url: u }))),
      add: () => Promise.resolve(),
    };
  };
  const caches = {
    open: (nom) => Promise.resolve(faireCache(nom)),
    keys: () => Promise.resolve([...memoire.keys()]),
    delete: (nom) => Promise.resolve(memoire.delete(nom)),
    match: (req) => {
      for (const m of memoire.values()) { const h = m.get(String(req.url || req)); if (h) return Promise.resolve(h); }
      return Promise.resolve(undefined);
    },
  };
  const bac = {
    self: {
      addEventListener: (n, f) => { listeners[n] = f; },
      location: { origin: 'https://desk.datatradingpro.com' },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
      registration: {},
    },
    caches, URL, Promise, Response: function () {}, Error, console,
    fetch: () => Promise.reject(new Error('pas de réseau dans le banc')),
    setTimeout, RegExp, String, Object, Array, JSON, Map, Number, Date,
  };
  bac.self.caches = caches;
  vm.createContext(bac);
  /* Un `sw.js` illisible doit faire ROUGIR, pas mourir : sans ce filet, le banc s'arrêtait sur la
     trace d'exception de Node, sans résumé et sans code de sortie parlant — on aurait cru le banc
     cassé alors que c'est le fichier éprouvé qui l'est. */
  try { vm.runInContext(source, bac, { filename: 'sw.js' }); }
  catch (e) { t('le service worker se charge', false, e.message); return null; }
  return { bac, listeners, memoire, faireCache };
}
// Un événement `fetch` fidèle : `respondWith` retient la promesse, comme le navigateur.
function envoyerFetch(listeners, url, options) {
  let rep = null;
  const ev = { request: { method: 'GET', url, mode: (options && options.mode) || 'no-cors' },
    respondWith: (p) => { rep = p; } };
  listeners.fetch(ev);
  return rep;
}
const SW_SRC = fs.readFileSync(path.join(RACINE, 'public/sw.js'), 'utf8');
const URL_CSS = 'https://desk.datatradingpro.com/css/style.css?v=20260904bbg1140';
t('le service worker se charge', !!chargerSW(SW_SRC));

/* CAS A — LE SCÉNARIO RÉEL : on vient de déployer (jeton neuf), le cache porte la feuille d'HIER
   (autre jeton), et le réseau lâche. Le desk doit garder des styles au lieu de s'afficher nu.
   ⚠️ Ce cas ne se confond PAS avec « le cache a déjà la bonne URL » : là, le service worker répond
   depuis le cache SANS jamais toucher au réseau, donc un repli MORT passerait quand même le
   contrôle. C'est l'erreur que ce banc a d'abord commise : la première écriture du repli relisait
   le cache À LA MÊME URL, c'est-à-dire exactement la lecture qui venait d'échouer — du code mort
   à l'apparence d'un filet, et un contrôle vert qui ne prouvait rien. */
{
  const s = chargerSW(SW_SRC);
  if (s) {
    const c = s.faireCache('dtp-sw-20260901bbg1000-coquille');
    const hier = { ok: true, status: 200, redirected: false, type: 'basic', _quoi: 'la feuille d\'hier', clone() { return this; } };
    c.put({ url: 'https://desk.datatradingpro.com/css/style.css?v=20260901bbg1000' }, hier);
    const p = envoyerFetch(s.listeners, URL_CSS);          // jeton NEUF, absent du cache
    t('CAS A — déploiement + réseau coupé : une réponse est quand même servie', !!p);
    if (p) p.then((r) => t('CAS A — et c\'est la feuille de la version précédente', r && r._quoi === 'la feuille d\'hier',
                           'reçu : ' + JSON.stringify(r && r._quoi)),
                  (e) => t('CAS A — et c\'est la feuille de la version précédente', false, 'promesse rejetée : ' + e.message));
  }
}
// CAS B — le réseau lâche et AUCUN voisin n'est en cache : l'erreur doit remonter, pas être maquillée.
{
  const s = chargerSW(SW_SRC);
  if (s) {
    const p = envoyerFetch(s.listeners, URL_CSS);
    if (p) p.then(() => t('CAS B — aucun voisin en cache, l\'erreur remonte', false, 'une réponse a été fabriquée'),
                  () => t('CAS B — aucun voisin en cache, l\'erreur remonte', true));
    else t('CAS B — aucun voisin en cache, l\'erreur remonte', false, 'aucune réponse');
  }
}
// CAS C — le réseau répond 200 mais REDIRIGÉ (la page de connexion) : rien ne doit être mémorisé.
{
  const s = chargerSW(SW_SRC);
  if (s) {
    const page = { ok: true, status: 200, redirected: true, type: 'basic', _quoi: 'page de connexion', clone() { return this; } };
    s.bac.fetch = () => Promise.resolve(page);
    const p = envoyerFetch(s.listeners, URL_CSS);
    const verdict = () => {
      let trouve = false;
      for (const m of s.memoire.values()) if (m.get(URL_CSS)) trouve = true;
      t('CAS C — une réponse redirigée n\'est jamais mémorisée', !trouve,
        'la page de connexion a été mise en cache sous l\'URL de la feuille');
    };
    if (p) p.then(() => setTimeout(verdict, 10), () => setTimeout(verdict, 10));
    else setTimeout(verdict, 10);
  }
}
// CAS D — la demande de SECOURS de la sentinelle ne doit ni sortir du cache ni y entrer.
{
  const s = chargerSW(SW_SRC);
  if (s) {
    s.faireCache('dtp-sw-test-coquille').put({ url: URL_CSS + '&secours=1-42' }, { _quoi: 'copie abîmée', clone() { return this; } });
    const p = envoyerFetch(s.listeners, URL_CSS + '&secours=1-42');
    t('CAS D — le secours ne passe pas par le service worker', p === null,
      'le secours a été intercepté : il pourrait rejouer la copie abîmée');
  }
}

/* ══ PHASE 4 — LA SENTINELLE, DANS UN VRAI NAVIGATEUR ═══════════════════════════════════════════
   Le seul contrôle qui prouve la réparation de bout en bout. On sert une feuille TRONQUÉE — donc
   sans sa dernière règle, exactement comme un transfert coupé — et on regarde si la page redemande
   la feuille d'elle-même et finit stylée. Aucune lecture de code ne peut établir cela.            */
console.log('\n[4] La sentinelle, dans un vrai navigateur');
function trouverNavigateur() {
  const bases = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  const cand = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const b of bases) {
    try {
      for (const d of fs.readdirSync(b)) {
        for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) cand.push(path.join(b, d, rel));
      }
    } catch {}
  }
  return cand.find(c => c && fs.existsSync(c)) || null;
}

const INDEX = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
// On isole le <script> de la sentinelle DEPUIS index.html : c'est le vrai code qui est éprouvé.
const SENT = (() => {
  const i = INDEX.indexOf('SENTINELLE DE LA FEUILLE DE STYLES');
  if (i < 0) return null;
  const a = INDEX.indexOf('<script>', i);
  const b = INDEX.indexOf('</script>', a);
  return (a < 0 || b < 0) ? null : INDEX.slice(a, b + 9);
})();
t('la sentinelle est bien dans index.html', !!SENT);

async function phaseNavigateur() {
  const bin = trouverNavigateur();
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { puppeteer = null; }
  if (!bin || !puppeteer) { console.log('  … navigateur absent → phase abstenue.'); return; }

  const PORT = 4611;
  let demandesCss = 0, secours = 0;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/css/style.css') {
      demandesCss++;
      const estSecours = u.searchParams.has('secours');
      if (estSecours) secours++;
      res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' });
      // 1re demande : feuille TRONQUÉE (la sentinelle manque) — 2e (secours) : feuille entière.
      res.end(estSecours
        ? 'body{background:#0c0c0e}\n:root{--dtp-coquille:1}'
        : 'body{background:#0c0c0e}\n/* transfert coupé i');
      return;
    }
    if (u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><head><meta charset="utf-8">'
        + '<link rel="stylesheet" href="/css/style.css?v=banc">' + SENT
        + '</head><body>desk</body></html>');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await nav.newPage();
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
    await page.waitForFunction(
      "getComputedStyle(document.documentElement).getPropertyValue('--dtp-coquille').trim() === '1'",
      { timeout: 8000 }
    ).catch(() => {});
    const arrive = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dtp-coquille').trim());
    t('une feuille TRONQUÉE est détectée et redemandée', secours >= 1, secours + ' demande(s) de secours');
    t('et la page finit stylée', arrive === '1', 'sentinelle = ' + JSON.stringify(arrive));
    t('la demande de secours porte bien le marqueur', demandesCss >= 2, demandesCss + ' demande(s) au total');

    /* TÉMOIN INVERSE — sans lui, le contrôle ci-dessus passerait aussi sur une page qui ne répare
       rien : il suffirait que la 1re feuille soit déjà complète. On sert donc une feuille ENTIÈRE
       du premier coup et on exige ZÉRO secours. Le contrôle ne peut pas être vert des deux côtés. */
    secours = 0; demandesCss = 0;
    const srv2 = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname === '/css/style.css') {
        demandesCss++; if (u.searchParams.has('secours')) secours++;
        res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' });
        res.end('body{background:#0c0c0e}\n:root{--dtp-coquille:1}');
        return;
      }
      if (u.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head><meta charset="utf-8">'
          + '<link rel="stylesheet" href="/css/style.css?v=banc">' + SENT
          + '</head><body>desk</body></html>');
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise(r => srv2.listen(PORT + 1, '127.0.0.1', r));
    const p2 = await nav.newPage();
    await p2.goto('http://127.0.0.1:' + (PORT + 1) + '/', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 900));
    t('TÉMOIN — une feuille entière ne déclenche AUCUN secours', secours === 0, secours + ' secours de trop');
    await new Promise(r => srv2.close(r));
  } finally {
    await nav.close().catch(() => {});
    await new Promise(r => srv.close(r));
  }
}

(async () => {
  try { await phaseCompression(); } catch (e) { console.log('  ✗ phase compression : ' + e.message); ko++; }
  try { await phaseNavigateur(); } catch (e) { console.log('  ✗ phase navigateur : ' + e.message); ko++; }
  await new Promise(r => setTimeout(r, 120));   // laisse les vérifications asynchrones de la phase 3 conclure
  console.log('\n[Coquille] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
  process.exit(ko ? 1 : 0);
})();

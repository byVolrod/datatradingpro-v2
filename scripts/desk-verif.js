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
/* Jeu d'essai : une dépêche ordinaire, une ANALYSE DU DESK (qui doit ressortir en rouge), une
   dépêche urgente (rouge aussi), et deux news de routine. Cinq lignes attendues, deux rouges. */
const NEWS = [
  { id: 'n1', headline: 'US ADP Employment Change beats forecast', description: 'Actual: 104K Forecast: 75K',
    category: 'Economic Commentary', source: 'Reuters', time: '16:09', timestamp: T - 60000, priority: 'normal', tags: ['USD'] },
  { id: 'eva-adp-1', headline: 'ANALYSE ADP US : Emploi privé US ADP en hausse, marché équilibré', description: '<p>Le chiffre…</p>',
    category: 'Economic Commentary', source: 'DTP Markets', time: '16:09', timestamp: T - 50000, priority: 'high',
    _eventAnalysis: true, _reportType: 'ADP', _pair: 'EURUSD', tags: ['USD'] },
  { id: 'fj-1', headline: 'BREAKING: Fed officials signal caution', description: '…', category: 'Central Banks',
    source: 'FinancialJuice', time: '15:40', timestamp: T - 120000, urgent: true, priority: 'high', tags: ['USD'] },
  { id: 'n2', headline: 'Euro steady ahead of German Ifo', description: '…', category: 'Forex', source: 'Reuters',
    time: '15:10', timestamp: T - 300000, priority: 'normal', tags: ['EUR'] },
  { id: 'n3', headline: 'Oil edges higher on supply concerns', description: '…', category: 'Commodities', source: 'Reuters',
    time: '14:55', timestamp: T - 400000, priority: 'normal', tags: ['OIL'] },
];
const UTIL = { id: 'u1', email: 'verif@dtp', name: 'Verif', role: 'admin', plan: 'pro', active: true, expiry: null };

function serveur() {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.startsWith('/api/')) {
      if (u === '/api/news') return j({ items: NEWS, total: NEWS.length });
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

(async () => {
  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Desk] aucun Chromium trouvé → contrôle abstenu (ce n\'est pas un échec).\n'); process.exit(0); }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { console.log('\n[Desk] puppeteer-core absent → contrôle abstenu.\n'); process.exit(0); }

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
    verif(`les ${NEWS.length} actualités s'affichent`, d.lignes === NEWS.length, d.lignes + ' ligne(s) rendue(s)');
    verif('l\'en-tête de journée est là', d.enTetes >= 1, String(d.enTetes));
    verif('aucun message « aucun élément »', d.vide === 0);
    // Une analyse du desk et une dépêche urgente : deux lignes rouges attendues.
    verif('les news majeures ressortent en rouge', d.rouges === 2, d.rouges + ' rouge(s) au lieu de 2');
    verif('aucune erreur d\'exécution', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));
  } catch (e) {
    ko++; console.log('  ✗ le desk n\'a pas pu être ouvert : ' + e.message);
  } finally {
    try { if (nav) await nav.close(); } catch {}
    srv.close();
  }
  console.log(`\n${ko === 0 ? '✓ LE DESK REND SON FIL' : '✗ ' + ko + ' ÉCHEC(S)'}\n`);
  process.exit(ko ? 1 : 0);
})();

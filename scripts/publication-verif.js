#!/usr/bin/env node
/**
 * publication-verif.js — SEPT LIGNES POUR UNE PUBLICATION, EST-CE BIEN FINI ?
 * ------------------------------------------------------------------------------------------------
 * 03/09, capture utilisateur à l'appui. À 14 h 30, une seule publication américaine produisait SEPT
 * lignes dans le fil — PIB, déflateur du PIB, PIB QoQ, PCE core prelim, PCE core annuel, PCE core
 * mensuel, PCE annuel — chacune avec ses quatre boutons. Sept lignes, vingt-huit panneaux, un seul
 * événement. Le lecteur qui descend son fil croit voir sept nouvelles ; il en voit une, répétée.
 *
 * CE QUE CE BANC ÉPROUVE, ET POURQUOI C'EST DÉLICAT. Regrouper, c'est FAIRE DISPARAÎTRE des lignes :
 * un regroupement trop large avale une dépêche qui n'a rien à voir, et personne ne s'en aperçoit —
 * l'information n'est pas fausse, elle est simplement absente. Les contrôles portent donc autant sur
 * ce qui DOIT être groupé que sur ce qui ne doit JAMAIS l'être, et sur la conservation : chaque
 * dépêche entrée doit ressortir, soit comme ligne, soit dans une grappe.
 *
 * Le jeu d'essai est la capture elle-même, à la virgule près.
 *
 *   node scripts/publication-verif.js       (s'abstient sans Chromium)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4773;
let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x)) || null;
}
function decouper(src, entete, fin) {
  const d = src.indexOf(entete);
  if (d < 0) return null;
  const f = src.indexOf(fin, d + entete.length);
  return f < 0 ? null : src.slice(d, f + fin.length);
}

const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const CHA = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
const MORCEAUX = {
  NUM:   decouper(APP, 'const _NP_NUM = ', '\n'),
  VALS:  decouper(APP, 'function _npABCVals(item) {', '\n}\n'),
  CLE:   decouper(APP, 'function _pubCle(item) {', '\n}\n'),
  NOM:   decouper(APP, 'function _pubNom(item) {', '\n}\n'),
  GRP:   decouper(APP, 'function _grouperPublications(items) {', '\n}\n'),
  PUCES: decouper(APP, 'function _pubPucesEl(liste) {', '\n}\n'),
  DEV:   decouper(CHA, 'const CAL_INVERTED_RX = ', '\nwindow.deviationClass = deviationClass;'),
};

/* LA CAPTURE, TRANSCRITE. Sept lignes à 14 h 30, plus trois pièges : une publication d'un AUTRE
   pays à la même minute, une publication US à une AUTRE minute, et un récit sans chiffres. */
const T1430 = Date.UTC(2026, 7, 28, 12, 30, 0);
const ITEMS = [
  { id: 'a1', timestamp: T1430, category: 'US Data', priority: 'high',
    headline: 'US Core PCE Price Index YoY Actual 3.3% (Forecast 3.3%, Previous 3.3%)' },
  { id: 'a2', timestamp: T1430 + 4000, category: 'US Data',
    headline: 'US Core PCE Price Index MoM Actual 0.2% (Forecast 0.2%, Previous 0.1%)' },
  { id: 'a3', timestamp: T1430 + 7000, category: 'US Data',
    headline: 'US PCE Price Index YoY Actual 3.7% (Forecast 3.6%, Previous 3.7%)' },
  { id: 'a4', timestamp: T1430 + 9000, category: 'US Data',
    headline: 'US Core PCE Prices Prelim Actual 3.6% (Forecast 3.4%, Previous 3.4%)' },
  { id: 'a5', timestamp: T1430 + 11000, category: 'US Data',
    headline: 'US GDP Price Index Actual 6.4% (Forecast 6.2%, Previous 6.2%)' },
  { id: 'a6', timestamp: T1430 + 13000, category: 'US Data',
    headline: 'US GDP QoQ 2nd Estimate Actual 1.5% (Forecast 1.5%, Previous 1.5%)' },
  { id: 'a7', timestamp: T1430 + 15000, category: 'US Data',
    headline: 'US Initial Jobless Claims Actual 207K (Forecast 215K, Previous 219K)' },
  // Pièges.
  { id: 'b1', timestamp: T1430 + 2000, category: 'Canadian Data',
    headline: 'Canada Retail Sales MoM Actual 0.9% (Forecast 0.5%, Previous 0.2%)' },
  { id: 'c1', timestamp: T1430 + 62000, category: 'US Data',
    headline: 'US Chicago PMI Actual 46.1 (Forecast 45.0, Previous 47.2)' },
  { id: 'd1', timestamp: T1430 + 5000, category: 'Economic Commentary',
    headline: 'US GDP 2nd estimate for Q2 1.5% vs 1.5% preliminary.' },
  { id: 'e1', timestamp: T1430 + 6000, category: 'Global News',
    headline: 'Euro surges as traders ignore soft German data' },
];

(async () => {
  console.log('\n═══ PUBLICATION-VERIF — une publication, une ligne ═══');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.log('  · puppeteer-core absent → abstention.\n'); process.exit(0); }
  const exe = trouverNavigateur();
  if (!exe) { console.log('  · aucun Chromium → abstention.\n'); process.exit(0); }

  const manquants = Object.keys(MORCEAUX).filter(k => !MORCEAUX[k]);
  v('le regroupement et ses aides sont extractibles des sources', manquants.length === 0,
    'introuvable(s) : ' + manquants.join(', '));
  if (manquants.length) { console.log('\n  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n'); process.exit(1); }

  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u === '/banc') {
      rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return rs.end('<!doctype html><html data-theme="dark"><head><meta charset="utf-8">'
        + '<link rel="stylesheet" href="/css/style.css"></head>'
        + '<body style="margin:0;background:#0c0c0e"><div class="news-item" style="width:720px">'
        + '<div class="news-content" id="p"></div></div></body></html>');
    }
    const f = path.join(PUB, u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f)) { rs.writeHead(404); return rs.end('404'); }
    rs.writeHead(200, { 'Content-Type': u.endsWith('.css') ? 'text/css' : 'text/plain' });
    fs.createReadStream(f).pipe(rs);
  }).listen(PORT);

  let nav = null;
  try {
    nav = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    await page.setViewport({ width: 1200, height: 700 });
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message)));
    await page.goto('http://localhost:' + PORT + '/banc', { waitUntil: 'networkidle0' });

    const res = await page.evaluate((M, items) => {
      // Un seul eval : les `const` extraits restent liés au bloc, les fonctions remontent.
      eval(M.NUM + '\n' + M.DEV + '\n' + M.VALS + '\n' + M.CLE + '\n' + M.NOM + '\n' + M.GRP + '\n' + M.PUCES);   // eslint-disable-line no-eval
      // eslint-disable-next-line no-undef
      const out = _grouperPublications(items);
      const chef = out.find(x => Array.isArray(x._groupedPubs) && x._groupedPubs.length);
      let puces = [];
      if (chef) {
        // eslint-disable-next-line no-undef
        const el = _pubPucesEl(chef._groupedPubs);
        document.getElementById('p').innerHTML = '';
        document.getElementById('p').appendChild(el);
        puces = [...el.querySelectorAll('.news-pub')].map(p => ({
          nom: p.querySelector('i').textContent,
          val: p.querySelector('b').textContent,
          cls: p.querySelector('b').className,
          teinte: getComputedStyle(p.querySelector('b')).color,
          visible: p.getBoundingClientRect().height > 6,
          titre: p.title,
        }));
      }
      return {
        lignes: out.map(x => ({ id: x.id, n: (x._groupedPubs || []).length,
          ids: (x._groupedPubs || []).map(y => y.id) })),
        chef: chef ? chef.id : null,
        puces,
        // eslint-disable-next-line no-undef
        noms: items.slice(0, 3).map(i => _pubNom(i)),
        // eslint-disable-next-line no-undef
        cles: items.map(i => _pubCle(i)),
      };
    }, MORCEAUX, ITEMS);

    console.log('\n── 1. Sept lignes deviennent une ──');
    v('aucune exception à l\'exécution', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    const usLigne = res.lignes.find(l => l.id === res.chef);
    v('les sept publications US de 14 h 30 forment UNE ligne', !!usLigne && usLigne.n === 6,
      'chef=' + res.chef + ' repliées=' + (usLigne ? usLigne.n : 0));
    /* Le chef de file est la publication de PREMIER RANG : c'est elle qu'on commente, et c'est son
       titre que le lecteur doit voir. Le prendre au hasard ferait remonter le déflateur du PIB
       au-dessus du PCE core. */
    v('… et c\'est la publication de premier rang qui mène', res.chef === 'a1', 'chef=' + res.chef);
    v('le fil passe de 11 lignes à 5', res.lignes.length === 5,
      res.lignes.length + ' ligne(s) : ' + res.lignes.map(l => l.id).join(', '));

    console.log('\n── 2. Ce qui ne doit JAMAIS être avalé ──');
    /* C'est la moitié qui compte le plus : une dépêche absorbée à tort DISPARAÎT de l'écran, et rien
       ne le signale — ni erreur, ni trou visible. */
    const ids = new Set(res.lignes.map(l => l.id));
    v('une publication d\'un AUTRE pays à la même minute reste sa propre ligne', ids.has('b1'));
    v('une publication US d\'une AUTRE minute reste sa propre ligne', ids.has('c1'));
    v('un récit sans chiffres (« US GDP 2nd estimate… ») n\'est pas absorbé', ids.has('d1'));
    v('une dépêche de marché ne l\'est pas non plus', ids.has('e1'));
    v('… et leurs clés de regroupement sont bien nulles',
      res.cles.slice(7).filter(k => k === null).length === 2, JSON.stringify(res.cles.slice(7)));

    console.log('\n── 3. Rien ne se perd ──');
    const vus = new Set();
    res.lignes.forEach(l => { vus.add(l.id); l.ids.forEach(x => vus.add(x)); });
    v('chaque dépêche entrée ressort — en ligne ou dans la grappe', vus.size === ITEMS.length,
      vus.size + '/' + ITEMS.length);

    console.log('\n── 4. Les valeurs restent lisibles SANS rien ouvrir ──');
    /* Sinon on aurait remplacé une répétition par un tiroir, ce qui ne règle rien : le lecteur d'un
       fil balaie, il ne déplie pas. */
    v('les six publications repliées sont affichées en puces', res.puces.length === 6, res.puces.length + ' puce(s)');
    v('… toutes réellement peintes (hauteur non nulle)', res.puces.every(p => p.visible));
    v('le nom de la puce est débarrassé du pays et de la queue « Actual… »',
      res.puces.some(p => p.nom === 'Core PCE Price Index MoM'), JSON.stringify(res.puces.map(p => p.nom)));
    v('… et porte la valeur réelle', res.puces.some(p => p.val === '0.2%'), JSON.stringify(res.puces.map(p => p.val)));
    /* La couleur vient de `deviationClass` : le déflateur du PIB à 6,4 % pour 6,2 % attendus est une
       surprise HAUSSIÈRE, donc verte ; un chiffre pile au consensus n'emprunte ni vert ni rouge. */
    const rgb = t => (String(t).match(/\d+/g) || []).map(Number);
    const vert = t => { const c = rgb(t); return c.length >= 3 && c[1] - c[0] > 40; };
    const pDefl = res.puces.find(p => /GDP Price Index/i.test(p.nom));
    const pPile = res.puces.find(p => /Core PCE Price Index MoM/i.test(p.nom));
    v('un chiffre au-dessus du consensus est peint en vert', !!pDefl && vert(pDefl.teinte),
      pDefl ? pDefl.nom + ' → ' + pDefl.teinte : 'puce introuvable');
    v('un chiffre PILE au consensus n\'emprunte pas cette couleur', !!pPile && !vert(pPile.teinte),
      pPile ? pPile.nom + ' → ' + pPile.teinte : 'puce introuvable');
    v('le consensus reste accessible en infobulle', res.puces.every(p => /attendu/.test(p.titre || '')),
      JSON.stringify(res.puces.map(p => p.titre).slice(0, 2)));
  } catch (e) {
    ko++; console.log('  ✗ banc interrompu\n      → ' + e.message);
  } finally {
    try { if (nav) await nav.close(); } catch {}
    try { srv.close(); } catch {}
  }

  console.log('\n───────────────────────────────────────');
  console.log('  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n');
  process.exit(ko ? 1 : 0);
})();

#!/usr/bin/env node
/**
 * horloge-verif.js — L'HORLOGE MONDIALE MONTRE-T-ELLE TOUT CE QU'ELLE AFFICHE ?
 * ------------------------------------------------------------------------------------------------
 * 02/09, capture utilisateur : « on voit même pas toutes les informations de l'horloge mondiale ».
 * Troisième signalement du même défaut (26/07, 23/08, 02/09) — donc un banc, plutôt qu'un quatrième
 * correctif à l'œil.
 *
 * LA MÉCANIQUE, ET POURQUOI ELLE SE RETOURNE CONTRE ELLE-MÊME. Le widget a DEUX dispositifs
 * d'adaptation, posés à des dates différentes, et ils se contredisent :
 *   — des requêtes de CONTENEUR (`@container dtphorloge`) qui compactent le contenu d'une cellule
 *     quand la carte est basse : typo réduite, puis météo masquée ;
 *   — un PLANCHER de rangée (`grid-auto-rows: minmax(136px, 1fr)`), posé pour qu'une grille repliée
 *     sur plusieurs rangées n'écrase pas ses cellules.
 * Le plancher ne connaît pas les paliers. Sur une carte basse, le contenu se compacte à ~90 px
 * pendant que la rangée reste bloquée à 136 : la grille dépasse son cadre, le wrap se met à défiler,
 * et le lecteur ne voit plus le bas de ses horloges — alors que tout tiendrait.
 *
 * CE BANC MESURE DONC LA SEULE CHOSE QUI COMPTE : à une hauteur de carte donnée, le contenu
 * DÉBORDE-T-IL ? Il exécute le vrai `renderClocks` d'app.js et la vraie feuille de style.
 *
 *   node scripts/horloge-verif.js       (s'abstient sans Chromium)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4769;
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

(async () => {
  console.log('\n═══ HORLOGE-VERIF — l\'horloge mondiale montre-t-elle tout ? ═══');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.log('  · puppeteer-core absent → abstention.\n'); process.exit(0); }
  const exe = trouverNavigateur();
  if (!exe) { console.log('  · aucun Chromium → abstention.\n'); process.exit(0); }

  const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
  const REND = decouper(APP, 'function renderClocks(barEl, liste) {', '\n}\n');
  const OFF  = decouper(APP, 'function getUTCOffset(tz) {', '\n}\n');
  const OPEN = decouper(APP, 'function isMarketOpen(tz, now) {', '\n}\n');
  const LIST = decouper(APP, 'const _CLOCK_ALL = [', '\n];\n') || decouper(APP, 'const CLOCKS = ', '\n');
  v('renderClocks est extractible d\'app.js', !!REND);
  v('ses aides (fuseau, ouverture) le sont aussi', !!OFF && !!OPEN);
  if (!REND || !OFF || !OPEN) { console.log('\n  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n'); process.exit(1); }

  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u === '/banc') {
      rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return rs.end('<!doctype html><html data-theme="dark"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<link rel="stylesheet" href="/css/style.css"></head>'
        + '<body style="margin:0;background:#0c0c0e">'
        + '<section class="wdg-card" id="carte" style="width:760px;height:170px;display:flex;flex-direction:column">'
        + '<header class="wdg-head" style="flex:0 0 auto;height:28px"><span class="wdg-title">Horloge mondiale</span></header>'
        + '<div class="wdg-body" id="h"><div class="wdg-clockwrap custom-scrollbar"><div class="clocks-bar wdg-clocks-bar"></div></div></div>'
        + '</section></body></html>');
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
    /* ⚠️ FENÊTRE LARGE, ET C'EST UNE CORRECTION DU BANC. À 900 px de large, la règle
       `@media (max-width: 900px) { .wdg-card { min-height: 200px } }` s'applique : la carte refusait
       de rétrécir, le cadre restait à 151 px à TOUTES les hauteurs demandées, et les cinq contrôles
       de débordement étaient verts sans rien avoir éprouvé. On mesure donc en fenêtre de bureau. */
    await page.setViewport({ width: 1400, height: 700 });
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message)));
    await page.goto('http://localhost:' + PORT + '/banc', { waitUntil: 'networkidle0' });

    const mesures = await page.evaluate(async (rend, off, open, hauteurs) => {
      window._weatherCache = { Londres: { temp: 18, wind: 12, windDir: 90, icon: '☁' } };
      window._clockWant = () => false;
      window.refreshWeather = () => {};
      window.windArrow = () => '↗';
      window.CLOCK_WIND_ICON = '<i></i>';
      // Les 5 places du modèle par défaut : LON, NY, TKY, DXB, PAR.
      window.CLOCKS = [
        { code: 'LON', city: 'Londres', tz: 'Europe/London', country: 'UK' },
        { code: 'NY', city: 'New York', tz: 'America/New_York', country: 'US' },
        { code: 'TKY', city: 'Tokyo', tz: 'Asia/Tokyo', country: 'JP' },
        { code: 'DXB', city: 'Dubaï', tz: 'Asia/Dubai', country: 'AE' },
        { code: 'PAR', city: 'Paris', tz: 'Europe/Paris', country: 'FR' },
      ];
      eval(off + '\n' + open + '\n' + rend);                // eslint-disable-line no-eval
      const carte = document.getElementById('carte');
      const out = [];
      for (const H of hauteurs) {
        carte.style.height = H + 'px';
        // eslint-disable-next-line no-undef
        renderClocks(document.querySelector('.wdg-clocks-bar'));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const wrap = document.querySelector('.wdg-clockwrap');
        const bar = document.querySelector('.wdg-clocks-bar');
        const items = [...document.querySelectorAll('.clock-item')];
        const rw = wrap.getBoundingClientRect();
        out.push({
          H,
          wrapH: Math.round(rw.height),
          defile: wrap.scrollHeight > wrap.clientHeight + 1,
          deborde: Math.round(Math.max(0, wrap.scrollHeight - wrap.clientHeight)),
          colonnes: new Set(items.map(i => Math.round(i.getBoundingClientRect().left))).size,
          rangees: new Set(items.map(i => Math.round(i.getBoundingClientRect().top))).size,
          cellule: items.length ? Math.round(items[0].getBoundingClientRect().height) : 0,
          // Le bas de la DERNIÈRE cellule dépasse-t-il le cadre visible ?
          coupe: items.filter(i => i.getBoundingClientRect().bottom > rw.bottom + 1).length,
          meteo: !!(items[0] && getComputedStyle(items[0].querySelector('.clock-sub-row')).display !== 'none'),
        });
      }
      return out;
    }, REND, OFF, OPEN, [230, 170, 150, 130, 110, 96, 82]);

    const par = h => mesures.find(m => m.H === h) || {};
    console.log('\n── 1. Les cinq places s\'affichent ──');
    v('aucune exception à l\'exécution', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    v('cinq colonnes sur une carte large', par(170).colonnes === 5, par(170).colonnes + ' colonne(s)');
    v('une seule rangée (les cinq places tiennent côte à côte)',
      mesures.every(m => m.rangees === 1), mesures.map(m => m.H + ':' + m.rangees).join(' '));

    console.log('\n── 2. Rien n\'est coupé, à aucune hauteur de carte ──');
    /* LE CONTRÔLE DEMANDÉ. Une rangée unique qui déborde de son cadre est un défaut pur : le
       contenu se compacte déjà par requêtes de conteneur, il n'y a aucune raison de le rogner. */
    for (const m of mesures) {
      v('carte de ' + m.H + ' px : le contenu tient dans le cadre (cellule ' + m.cellule + ' px, cadre ' + m.wrapH + ' px)',
        !m.defile && m.coupe === 0,
        'débordement=' + m.deborde + 'px cellule=' + m.cellule + ' wrap=' + m.wrapH + ' météo=' + m.meteo);
    }

    console.log('\n── 3. Sur plusieurs rangées, le défilement de dernier recours reste ──');
    /* Le plancher aligné sur le cadre ne doit PAS supprimer le comportement voulu quand la grille se
       replie : là, une rangée par cadre serait illisible. Le plancher reprend ses 136 px, la grille
       dépasse, et le wrap défile — c'est la décision du 23/08, on la garde. */
    const etroit = await page.evaluate(async () => {
      const carte = document.getElementById('carte');
      carte.style.width = '300px'; carte.style.height = '200px';
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const wrap = document.querySelector('.wdg-clockwrap');
      const items = [...document.querySelectorAll('.clock-item')];
      return { rangees: new Set(items.map(i => Math.round(i.getBoundingClientRect().top))).size,
        defile: wrap.scrollHeight > wrap.clientHeight + 1,
        cellule: items.length ? Math.round(items[0].getBoundingClientRect().height) : 0 };
    });
    v('une carte étroite replie bien la grille sur plusieurs rangées', etroit.rangees > 1, JSON.stringify(etroit));
    v('… les cellules y gardent leur hauteur lisible', etroit.cellule >= 110, etroit.cellule + 'px');
    v('… et ce qui dépasse reste atteignable par le défilement', etroit.defile === true, JSON.stringify(etroit));

    console.log('\n── 4. La compaction reste graduée ──');
    /* Le plancher doit SUIVRE les paliers, pas les contredire : plus la carte est basse, plus la
       cellule est courte — sans quoi le plancher rouvre le débordement que les paliers évitaient. */
    v('la cellule rétrécit quand la carte rétrécit',
      par(170).cellule > par(110).cellule, '170→' + par(170).cellule + 'px, 110→' + par(110).cellule + 'px');
    v('la météo est encore là sur une carte confortable', par(170).meteo === true);
    v('… et cède seulement sur une carte très basse (l\'heure prime)', par(96).meteo === false,
      'météo à 96px : ' + par(96).meteo);
    console.log('\n── 5. Le repère doré d\'avant-titre reste retiré ──');
    /* ══ IL EST REVENU UNE FOIS, IL NE DOIT PAS REVENIR DEUX ══════════════════════════════════════
       Demande du 19/08 : « enlève ce trait orange à côté des titres des widgets/bloc ». Une règle
       d'extinction avait été posée — sans `.wdg-title` — puis un bloc de « finition épurée » écrit
       deux jours plus tard l'a REDESSINÉ pour les trois familles de titres, plus bas dans la
       feuille. Signalé de nouveau le 02/09. Un contrôle vaut mieux qu'un troisième correctif : on
       lit le pseudo-élément ET on relit le pixel devant le titre, une règle pouvant être neutralisée
       sans que le trait cesse d'être peint par un autre chemin. */
    const trait = await page.evaluate(() => {
      const t = document.querySelector('.wdg-title');
      const av = getComputedStyle(t, '::before');
      // MESURE GÉOMÉTRIQUE, et c'est elle qui compte : un pseudo-élément déclaré `content: none`
      // peut être rétabli par n'importe quelle règle en aval. Ce qui ne ment pas, c'est la position
      // du TEXTE dans son propre élément — un repère de 2 px suivi de 8 px de marge le décale de
      // dix pixels vers la droite. On compare donc le bord gauche du texte à celui de la boîte.
      const r = document.createRange();
      r.selectNodeContents(t);
      const dec = Math.round(r.getBoundingClientRect().left - t.getBoundingClientRect().left);
      return { contenu: av.content, largeur: av.width, decalage: dec };
    });
    v('aucun pseudo-élément ::before ne dessine devant le titre',
      trait.contenu === 'none' || trait.contenu === 'normal', 'content=' + trait.contenu + ' width=' + trait.largeur);
    v('… et le texte du titre commence bien au bord de sa boîte (aucun repère ne le décale)',
      trait.decalage <= 1, 'décalage mesuré : ' + trait.decalage + ' px');
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

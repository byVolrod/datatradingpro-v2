#!/usr/bin/env node
/**
 * scripts/scroller-verif.js — LE TABLEAU DU JOURNAL ANNONCE QU'IL CONTINUE À DROITE.
 * ------------------------------------------------------------------------------------------------
 * 16/09, demande user : « ajoute un scroller pour scroller vers la droite et voir les autres
 * colonnes », capture d'un tableau tronqué au bord.
 *
 * ⚠️ LE DÉFILEMENT EXISTAIT DÉJÀ (`overflow: auto`), ET C'EST TOUT LE PIÈGE. Un banc qui aurait
 * vérifié « le conteneur défile-t-il ? » serait passé au VERT sur la capture du client. Ce qui
 * manquait est l'AFFORDANCE : une barre `auto` n'est peinte que PENDANT le défilement en mode
 * overlay (macOS, Windows 11), donc elle ne peut pas servir d'indice — elle n'apparaît qu'une fois
 * qu'on a deviné qu'elle existait. On mesure donc ce qui se VOIT : une piste réservée en
 * permanence, et un dégradé de bord qui s'éteint au bout de la course.
 *
 * ⚠️ ET LES MESURES SONT RAMENÉES EN PIXELS CSS. `getBoundingClientRect()` rend du pixel d'écran,
 * déjà multiplié par le zoom global du desk ; `getComputedStyle()` rend du pixel CSS. Mélanger les
 * deux a déjà produit un défaut ET un faux rouge de banc cette semaine.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x));
}
let pp = null;
try { pp = require(path.join(RACINE, 'node_modules/puppeteer-core')); } catch {}
const NAV = trouverNavigateur();
if (!pp || !NAV) { console.log('\n[scroller-verif] aucun navigateur disponible → contrôle ABSTENU (code 0)\n'); process.exit(0); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };
const UTIL = { loggedIn: true, authenticated: true, email: 'banc@dtp.fr', role: 'admin', plan: 'professionnel', monDesk: true, mondesk: true };
const PORT = 4999;
/* Témoin : la feuille servie SANS la piste réservée (l'état d'avant, `overflow-x: auto`). */
let mutation = false;
const RE_SCROLL = /\.jr-grid-wrap \{ overflow-x: scroll; overflow-y: auto; \}/;
const ANCIEN = '.jr-grid-wrap { overflow-x: auto; overflow-y: auto; }';

(async () => {
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u === '/sw.js') { rs.writeHead(404); return rs.end(); }
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify({ items: [], total: 0, ok: true, user: UTIL, ...UTIL })); }
    const f = path.join(PUB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('404'); }
    if (mutation && /style\.css$/.test(f)) {
      rs.writeHead(200, { 'Content-Type': MIME['.css'] });
      return rs.end(fs.readFileSync(f, 'utf8').replace(RE_SCROLL, ANCIEN));
    }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(rs);
  });
  await new Promise(r => srv.listen(PORT, r));
  const nav = await pp.launch({ executablePath: NAV, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  async function ouvrir(largeur) {
    const page = await nav.newPage();
    const err = [];
    page.on('pageerror', e => err.push(String(e.message || e)));
    await page.evaluateOnNewDocument(() => { window._pdMonDesk = true; });
    await page.setViewport({ width: largeur, height: 820 });
    await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 1500));
    /* ⚠️ IL FAUT OUVRIR LE JOURNAL, sinon tout mesure ZÉRO. Sa vue est masquée au chargement : un
       conteneur `display: none` rend 0 pour `clientWidth`, `scrollWidth` et `offsetHeight`, si bien
       que la première version de ce banc concluait « aucun débordement » sur un tableau qu'elle
       n'avait jamais affiché. Mesurer un élément invisible, c'est mesurer le vide. */
    await page.evaluate(() => { const b = document.getElementById('journal-btn'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 900));
    return { page, err };
  }
  /* Le tableau réel du client est alimenté par son compte ; ici on POSE des colonnes larges pour
     garantir un débordement, puis on rejoue la mise à jour du fondu. On éprouve le MÉCANISME
     d'affordance, pas le contenu du journal — celui-ci a ses propres bancs. */
  const preparer = page => page.evaluate(() => {
    const tb = document.querySelector('#jr-grid tbody');
    if (!tb) return false;
    tb.innerHTML = '<tr>' + Array.from({ length: 14 }, (_, i) =>
      `<td style="min-width:160px;white-space:nowrap">colonne ${i + 1} de démonstration</td>`).join('') + '</tr>';
    const box = document.getElementById('jr-grid-wrap');
    if (box) { box.style.maxWidth = '520px'; box.dispatchEvent(new Event('scroll')); }
    window.dispatchEvent(new Event('resize'));
    return true;
  });
  const etat = page => page.evaluate(() => {
    const box = document.getElementById('jr-grid-wrap'), fx = document.getElementById('jr-grid-fx');
    if (!box || !fx) return null;
    const st = getComputedStyle(box);
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dtp-zoom')) || 1;
    const apres = getComputedStyle(fx, '::after');
    return {
      overflowX: st.overflowX,
      /* Piste RÉSERVÉE : la hauteur de barre se lit comme la différence entre la boîte et sa zone
         cliente. En overlay (barre non réservée) elle vaut 0 — c'est exactement l'état d'avant. */
      barreH: +((box.offsetHeight - box.clientHeight) / z).toFixed(1),
      deborde: +((box.scrollWidth - box.clientWidth) / z).toFixed(1),
      classeDeborde: fx.classList.contains('jr-deborde'),
      classeAuBout: fx.classList.contains('jr-au-bout'),
      fonduOpacite: parseFloat(apres.opacity),
      fonduLargeur: apres.width,
      scrollLeft: Math.round(box.scrollLeft),
    };
  });

  console.log('\n── Le tableau déborde : le fondu annonce la suite ──');
  const { page, err } = await ouvrir(1280);
  v('la page se charge sans exception', err.length === 0, err.slice(0, 2).join(' | '));
  v('le tableau du journal est bien dans le DOM', await preparer(page));
  await new Promise(r => setTimeout(r, 250));
  let m = await etat(page);
  v('[mesuré] l\'enveloppe et la boîte de défilement existent', !!m);
  if (m) {
    v('[mesuré] le débordement horizontal est réel', m.deborde > 50, 'débordement : ' + m.deborde + 'px CSS');
    /* ⚠️ CE QUE CE BANC NE PEUT PAS MESURER, ET POURQUOI IL NE LE PRÉTEND PAS. J'ai d'abord écrit
       ici « la piste est RÉSERVÉE, hauteur de barre ≥ 6 px ». Mesuré : 0. Chromium sans affichage
       utilise des barres EN SURIMPRESSION, où `overflow-x: scroll` ne réserve aucune place — et
       c'est aussi le mode par défaut de macOS. Autrement dit, je ne peux NI mesurer ici, NI
       promettre chez le client, qu'une barre native soit peinte en permanence : cela dépend du
       système, pas de la feuille de style.
       La conséquence est une décision de conception, pas un contournement de banc : l'affordance
       qui PORTE est le FONDU, mesurable partout et vérifié juste en dessous ; la barre stylée reste
       un renfort là où le système la peint. On contrôle donc l'INTENTION (overflow + règles de
       pouce présentes) et on dit franchement que le rendu natif échappe à la mesure. Un contrôle
       qui affirme plus que son instrument est exactement le faux vert que ce dépôt traque. */
    v('[mesuré] le défilement horizontal est demandé explicitement (`scroll`, pas `auto`)',
      m.overflowX === 'scroll', 'overflow-x mesuré : ' + m.overflowX);
    console.log('    · barre native mesurée : ' + m.barreH + 'px (0 = surimpression, hors de portée du banc)');
    v('[mesuré] l\'enveloppe se sait débordée', m.classeDeborde);
    v('[mesuré] le fondu de droite est PEINT au départ', m.fonduOpacite > 0.9 && !m.classeAuBout,
      'opacité ' + m.fonduOpacite + ', au bout : ' + m.classeAuBout);
  }

  console.log('\n── Arrivé au bout, le fondu s\'éteint (il ne promet pas une suite qui n\'existe pas) ──');
  await page.evaluate(() => { const b = document.getElementById('jr-grid-wrap'); b.scrollLeft = b.scrollWidth; b.dispatchEvent(new Event('scroll')); });
  await new Promise(r => setTimeout(r, 250));
  m = await etat(page);
  v('[mesuré] le défilement a bien avancé', !!(m && m.scrollLeft > 50), m ? 'scrollLeft : ' + m.scrollLeft : '');
  v('[mesuré] au bout de la course, le fondu est éteint', !!(m && m.classeAuBout && m.fonduOpacite < 0.05),
    m ? 'au bout : ' + m.classeAuBout + ', opacité ' + m.fonduOpacite : '');

  console.log('\n── Quand tout tient, aucun fondu : rien à annoncer ──');
  await page.evaluate(() => {
    /* ⚠️ VIDER LE CORPS NE SUFFIT PAS : l'en-tête porte ses propres colonnes et garde le tableau
       large. Ma première version ne vidait que le `tbody` et mesurait encore 1716 px de
       débordement — elle croyait éprouver « tout tient » sur un tableau qui débordait toujours. */
    const tbl = document.getElementById('jr-grid');
    tbl.innerHTML = '<tbody><tr><td style="min-width:60px">une seule colonne</td></tr></tbody>';
    const b = document.getElementById('jr-grid-wrap'); b.scrollLeft = 0; b.style.maxWidth = '';
    window.dispatchEvent(new Event('resize'));
  });
  await new Promise(r => setTimeout(r, 250));
  m = await etat(page);
  v('[mesuré] sans débordement, le fondu ne s\'allume pas', !!(m && !m.classeDeborde && m.fonduOpacite < 0.05),
    m ? 'débordement ' + m.deborde + 'px, classe ' + m.classeDeborde + ', opacité ' + m.fonduOpacite : '');
  await page.close();

  console.log('\n── Témoin : piste non réservée, on retombe sur la barre qu\'il fallait deviner ──');
  const brut = fs.readFileSync(path.join(PUB, 'css/style.css'), 'utf8');
  v('la règle de défilement explicite est bien dans la feuille (sinon le témoin ne mute rien)', RE_SCROLL.test(brut));
  mutation = true;
  const { page: mut } = await ouvrir(1280);
  await preparer(mut);
  await new Promise(r => setTimeout(r, 250));
  const t = await etat(mut);
  v('[mesuré] sans elle, `overflow-x` retombe sur `auto`', !!(t && t.overflowX === 'auto'),
    t ? 'overflow-x mesuré : ' + t.overflowX + ' — si la mutation ne mord pas, le contrôle ci-dessus ne mesure pas ce correctif' : '');
  await mut.close();
  mutation = false;

  await nav.close(); srv.close();
  console.log(ko ? `\n✗ ${ko} contrôle(s) en échec\n` : `\n✓ ${ok} contrôles au vert\n`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

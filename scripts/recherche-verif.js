#!/usr/bin/env node
/**
 * scripts/recherche-verif.js — LA LOUPE DE RECHERCHE SE VOIT VRAIMENT.
 * ------------------------------------------------------------------------------------------------
 * 12/09, capture user : « je ne vois pas l'icône de recherche ». Le premier réflexe était d'ajouter
 * une loupe ; il aurait été FAUX. Le mécanisme mobile existait déjà et marchait : une case-icône
 * tapable dans la topbar, qui se déplie en pleine largeur au focus. Mesuré dans Chromium à 390 px,
 * la loupe était bien rendue — 13,5 px, au bon endroit, opacité 1 — mais peinte en `var(--text4)`
 * (#444444) sur le fond de topbar (#16171b), soit 1,91:1 de contraste là où la norme demande 3:1
 * pour un élément d'interface porteur de sens. Elle était donc littéralement invisible. Ajouter un
 * second bouton aurait dupliqué une mécanique existante POUR NE PAS RÉPARER la cause.
 *
 * ⚠️ CE BANC CALCULE LE CONTRASTE RENDU, il ne relit pas un nom de token. Une variable renommée, un
 * thème ajouté, un `--text4` réglé plus sombre : tout cela repasse sous le seuil sans qu'aucune
 * règle n'ait « disparu » du fichier. Seule la couleur RÉELLEMENT peinte, lue dans le navigateur et
 * comparée au fond RÉELLEMENT peint derrière, dit la vérité — c'est la leçon déjà écrite pour le
 * compte à rebours (09/09), et c'est le même défaut qui revient ici.
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
if (!pp || !NAV) {
  /* Même règle que desk-verif : sans navigateur on s'abstient, on ne bloque pas une livraison. */
  console.log('\n[recherche-verif] aucun navigateur disponible → contrôle ABSTENU (code 0)\n');
  process.exit(0);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };
const UTIL = { loggedIn: true, authenticated: true, email: 'banc@dtp.fr', role: 'client', plan: 'professionnel' };
const PORT = 4994;
const SEUIL = 3;                     // WCAG 1.4.11 : 3:1 pour un élément d'interface porteur de sens
/* Témoin : quand il est posé, la feuille est servie SANS le bloc correctif. Le contraste doit alors
   retomber sous le seuil — sinon les contrôles ci-dessus ne mesureraient pas ce qu'ils prétendent. */
let mutation = false;
const RE_CORRECTIF = /\.topbar-symbol-search \.search-icon \{ color: var\(--text3\); \}[\s\S]*?@media \(max-width: 768px\) \{\s*\n\s*\.topbar-symbol-search \.search-icon \{ color: #aeb6c2; \}[\s\S]*?\n\}/;

(async () => {
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u === '/sw.js') { rs.writeHead(404); return rs.end(); }
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify({ items: [], total: 0, ok: true, user: UTIL, ...UTIL })); }
    const f = path.join(PUB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('404'); }
    if (mutation && /style\.css$/.test(f)) {
      rs.writeHead(200, { 'Content-Type': MIME['.css'] });
      return rs.end(fs.readFileSync(f, 'utf8').replace(RE_CORRECTIF, ''));
    }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(rs);
  });
  await new Promise(r => srv.listen(PORT, r));
  const nav = await pp.launch({ executablePath: NAV, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* Contraste calculé sur les couleurs RÉELLEMENT peintes. Le fond est cherché en remontant les
     parents jusqu'au premier qui en porte un opaque : un élément transparent n'est pas « noir », il
     montre ce qu'il y a derrière, et c'est CE fond-là qui décide de la lisibilité. */
  const mesurer = page => page.evaluate(() => {
    const lum = (r, g, b) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const rgb = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const fondDe = el => { let n = el; while (n && n !== document.documentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c && c.a > 0.9) return c; n = n.parentElement; } return { r: 0, g: 0, b: 0, a: 1 }; };
    const ico = document.querySelector('.topbar-symbol-search .search-icon');
    const boite = document.querySelector('.topbar-symbol-search');
    if (!ico || !boite) return null;
    const cIco = rgb(getComputedStyle(ico).color), cFond = fondDe(ico);
    const l1 = lum(cIco.r, cIco.g, cIco.b), l2 = lum(cFond.r, cFond.g, cFond.b);
    const contraste = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const svg = ico.querySelector('svg'), rs = svg && svg.getBoundingClientRect(), rb = boite.getBoundingClientRect();
    return {
      couleurIcone: getComputedStyle(ico).color, couleurFond: `rgb(${cFond.r}, ${cFond.g}, ${cFond.b})`,
      contraste: Math.round(contraste * 100) / 100,
      glyphe: rs ? Math.round(rs.width) : 0,
      cible: { w: Math.round(rb.width), h: Math.round(rb.height) },
      iconeVisible: getComputedStyle(ico).display !== 'none' && getComputedStyle(ico).visibility !== 'hidden' && parseFloat(getComputedStyle(ico).opacity) > 0.1,
      focusInput: document.activeElement === document.getElementById('topbar-symbol-input'),
      largeurCaseDepliee: Math.round(rb.width),
      viewport: window.innerWidth,
    };
  });

  async function ouvrir(largeur, hauteur) {
    const page = await nav.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message || e)));
    await page.setViewport({ width: largeur, height: hauteur, isMobile: largeur <= 480, hasTouch: largeur <= 480 });
    await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 900));
    return { page, erreurs };
  }

  console.log('\n── Sur un téléphone (390px) : la loupe se VOIT ──');
  const { page: mob, erreurs: errMob } = await ouvrir(390, 780);
  let m = await mesurer(mob);
  v('la page se charge sans exception', errMob.length === 0, errMob.join(' | '));
  v('la loupe et sa case sont bien dans le DOM', !!m);
  if (m) {
    v('[mesuré] la loupe est peinte (pas masquée, pas transparente)', m.iconeVisible);
    v(`[mesuré] son contraste atteint le seuil de ${SEUIL}:1 — mesuré ${m.contraste}:1`, m.contraste >= SEUIL,
      `${m.couleurIcone} sur ${m.couleurFond} = ${m.contraste}:1. Avant correctif : #444444 sur #16171b = 1,91:1, ` +
      'soit une icône rendue mais invisible — exactement ce que décrit la capture user.');
    v('[mesuré] son glyphe a la taille de ses voisines de topbar (≥ 16px)', m.glyphe >= 16,
      'glyphe mesuré : ' + m.glyphe + 'px (les icônes Journal / Calculatrice / Mon Desk font 18px)');
    v('[mesuré] sa cible tactile reste confortable (≥ 30px)', m.cible.w >= 30 && m.cible.h >= 30,
      'cible : ' + m.cible.w + '×' + m.cible.h);
  }

  console.log('\n── Et elle marche toujours : un tap déplie le champ ──');
  await mob.click('.topbar-symbol-search');
  await new Promise(r => setTimeout(r, 300));
  m = await mesurer(mob);
  v('[mesuré] le curseur est dans le champ après le tap', !!(m && m.focusInput),
    'sans focus, la case dépliée ne sert à rien');
  v('[mesuré] la case dépliée prend la largeur de l\'écran', !!(m && m.largeurCaseDepliee >= m.viewport * 0.8),
    'largeur ' + (m ? m.largeurCaseDepliee : 0) + 'px pour ' + (m ? m.viewport : 0) + 'px d\'écran');
  v('[mesuré] dépliée, la loupe reste au-dessus du seuil', !!(m && m.contraste >= SEUIL),
    m ? (m.couleurIcone + ' = ' + m.contraste + ':1') : '');
  await mob.close();

  console.log('\n── Sur grand écran : lisible aussi, sans devenir criarde ──');
  const { page: desk, erreurs: errDesk } = await ouvrir(1400, 900);
  const d = await mesurer(desk);
  v('la page se charge sans exception', errDesk.length === 0, errDesk.join(' | '));
  v(`[mesuré] le contraste y atteint aussi ${SEUIL}:1 — mesuré ${d ? d.contraste : '?'}:1`, !!(d && d.contraste >= SEUIL),
    d ? (d.couleurIcone + ' sur ' + d.couleurFond) : '',
  );
  await desk.close();

  console.log('\n── Témoin : sans le correctif, la loupe redevient invisible ──');
  const brut = fs.readFileSync(path.join(PUB, 'css/style.css'), 'utf8');
  v('le bloc correctif est bien présent dans la feuille (sinon le témoin ne mute rien)', RE_CORRECTIF.test(brut));
  mutation = true;
  const { page: mut } = await ouvrir(390, 780);
  const t = await mesurer(mut);
  v(`[mesuré] sans lui, le contraste retombe SOUS ${SEUIL}:1 — mesuré ${t ? t.contraste : '?'}:1`,
    !!(t && t.contraste < SEUIL),
    'si le contraste reste bon ici, le contrôle plus haut ne mesure pas le correctif : ' + JSON.stringify(t));
  await mut.close();

  await nav.close(); srv.close();
  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('✗ banc en erreur :', e.message); process.exit(1); });

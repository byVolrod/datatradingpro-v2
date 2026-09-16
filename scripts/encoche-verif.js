#!/usr/bin/env node
/**
 * scripts/encoche-verif.js — LE CHAMP DE RECHERCHE DÉPLIÉ NE PASSE PAS SOUS L'ENCOCHE.
 * ------------------------------------------------------------------------------------------------
 * 12/09, capture user (iPhone à Dynamic Island) : au tap sur la loupe, la barre de recherche se
 * déploie MAIS son haut est tranché par la barre d'état, et elle se pose AU-DESSUS de la rangée
 * d'icônes au lieu de se centrer dedans.
 *
 * ⚠️ CE DÉFAUT AVAIT DÉJÀ ÉTÉ CORRIGÉ, PUIS ROUVERT PAR UNE CORRECTION PLUS TARDIVE. Le bloc
 * « RECHERCHE DE SYMBOLE SUR MOBILE » portait la bonne règle et la documentait ; le bloc du 31/08,
 * écrit plus bas dans la feuille et donc vainqueur de la cascade, l'a remplacée par un calcul qui
 * repart du haut de l'ÉCRAN. Aucun banc ne mesurait cet état — c'est pourquoi la régression a tenu.
 *
 * ⚠️ ET CHROMIUM NE FOURNIT AUCUNE ENCOCHE : `env(safe-area-inset-top)` y vaut 0, donc la feuille
 * s'y comporte comme sur un écran plat et le défaut est INVISIBLE en essai. On FABRIQUE donc
 * l'encoche : la feuille est servie avec `env(safe-area-inset-top, 0px)` substitué par une valeur
 * réelle. Ce n'est pas une doublure du composant — c'est le VRAI CSS, avec la seule grandeur que le
 * navigateur d'essai ne sait pas produire. Sans cette substitution, ce banc serait vert sur le
 * défaut même qu'il prétend garder.
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
if (!pp || !NAV) { console.log('\n[encoche-verif] aucun navigateur disponible → contrôle ABSTENU (code 0)\n'); process.exit(0); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };
const UTIL = { loggedIn: true, authenticated: true, email: 'banc@dtp.fr', role: 'admin', plan: 'professionnel', monDesk: true, mondesk: true };
const PORT = 4998;
/* 59 px : le retrait haut d'un iPhone à Dynamic Island en points CSS. La valeur exacte importe peu,
   ce qui compte est qu'elle soit FRANCHE — un défaut de quelques pixels ne se mesure pas. */
const ENCOCHE = 59;
let encoche = 0;
/* ⚠️ LES DEUX ÉCRITURES, ET C'EST LE BANC QUI ME L'A APPRIS. Je ne substituais que la forme AVEC
   repli (`env(…, 0px)`) ; or `.topbar` pose son retrait en `padding-top: env(safe-area-inset-top)`,
   SANS repli. L'encoche n'était donc jamais posée sur la barre elle-même, et le banc mesurait un
   écran plat en croyant simuler un iPhone. Un banc qui simule à moitié est pire qu'un banc absent :
   il rend un vert. */
const RE_ENV = /env\(safe-area-inset-top(?:,\s*0px)?\)/g;
/* Témoin : la feuille servie avec l'ancien calcul (celui du 31/08, qui repart du haut de l'écran). */
let mutation = false;
const RE_FIX = /top: calc\(env\(safe-area-inset-top, 0px\) \+ \(var\(--topbar-h, 54px\) - env\(safe-area-inset-top, 0px\) - 36px\) \/ 2\);/;
const ANCIEN = 'top: calc((var(--topbar-h, 54px) - 36px) / 2);';

(async () => {
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u === '/sw.js') { rs.writeHead(404); return rs.end(); }
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify({ items: [], total: 0, ok: true, user: UTIL, ...UTIL })); }
    const f = path.join(PUB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('404'); }
    if (/style\.css$/.test(f)) {
      let css = fs.readFileSync(f, 'utf8');
      if (mutation) css = css.replace(RE_FIX, ANCIEN);
      if (encoche) css = css.replace(RE_ENV, encoche + 'px');
      rs.writeHead(200, { 'Content-Type': MIME['.css'] });
      return rs.end(css);
    }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(rs);
  });
  await new Promise(r => srv.listen(PORT, r));
  const nav = await pp.launch({ executablePath: NAV, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  async function ouvrirEtDeplier(largeur) {
    const page = await nav.newPage();
    const err = [];
    page.on('pageerror', e => err.push(String(e.message || e)));
    await page.evaluateOnNewDocument(() => { window._pdMonDesk = true; });
    await page.setViewport({ width: largeur, height: 800, isMobile: true, hasTouch: true });
    await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 1300));
    await page.evaluate(() => { const i = document.getElementById('topbar-symbol-input'); if (i) i.focus(); });
    await new Promise(r => setTimeout(r, 350));
    return { page, err };
  }
  const mesure = page => page.evaluate(() => {
    const boite = document.querySelector('.topbar-symbol-search');
    const bar = document.querySelector('.topbar');
    if (!boite || !bar) return null;
    const rb = boite.getBoundingClientRect(), rt = bar.getBoundingClientRect();
    const st = getComputedStyle(bar);
    /* ⚠️ DEUX ESPACES DE MESURE DANS LA MÊME COMPARAISON, ET C'EST LE PIÈGE DU JOUR.
       `getBoundingClientRect()` rend des pixels d'ÉCRAN, déjà multipliés par le zoom global du desk
       (`html{zoom:.9}`) ; `getComputedStyle()` rend des pixels CSS, qui l'ignorent. Comparer les deux
       directement faisait échouer ce banc sur un code JUSTE : 55,8 px de rectangle contre 59 px de
       rembourrage, soit « 3 px tranchés » qui n'existaient pas. C'est exactement l'erreur d'unité qui
       a produit le défaut des menus déroulants ce matin, retrouvée dans l'outil qui devait la
       surveiller. On ramène donc TOUTES les mesures de rectangle en pixels CSS. */
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dtp-zoom')) || 1;
    const px = x => +(x / z).toFixed(1);
    const inset = parseFloat(st.paddingTop) || 0;   // la topbar pose le retrait d'encoche en padding-top (déjà en px CSS)
    const ico = document.querySelector('.topbar-right .topbar-icon');
    const ri = ico ? ico.getBoundingClientRect() : null;
    return {
      hautChamp: px(rb.top), basChamp: px(rb.bottom), hauteur: px(rb.height),
      inset: +inset.toFixed(1), hautBarre: px(rt.top), basBarre: px(rt.bottom),
      position: getComputedStyle(boite).position,
      zoom: z,
      deplie: px(rb.width) > 200,
      /* Le champ doit se poser DANS la rangée d'icônes, pas au-dessus : on compare au centre d'une
         icône voisine, qui est la référence visuelle du client. */
      centreIcone: ri ? px((ri.top + ri.bottom) / 2) : null,
      centreChamp: px((rb.top + rb.bottom) / 2),
    };
  });

  for (const L of [402, 430, 440]) {
    encoche = ENCOCHE;
    const { page, err } = await ouvrirEtDeplier(L);
    const m = await mesure(page);
    console.log('\n── ' + L + 'px, encoche de ' + ENCOCHE + 'px ──');
    v('la page se charge sans exception', err.length === 0, err.slice(0, 2).join(' | '));
    v('[mesuré] le champ est bien DÉPLIÉ (c\'est cet état qu\'on éprouve)', !!(m && m.deplie),
      m ? 'largeur ' + Math.round(m.hautChamp) + ' / déplié=' + m.deplie : 'mesure impossible');
    if (m && m.deplie) {
      v('[mesuré] l\'encoche est bien simulée (la topbar porte son retrait)', m.inset >= ENCOCHE - 1,
        'padding-top mesuré : ' + m.inset + 'px — sans lui, ce banc ne prouve rien');
      /* LE contrôle de la capture : le haut du champ doit être SOUS la barre d'état. */
      v('[mesuré] le haut du champ ne passe pas sous la barre d\'état', m.hautChamp >= m.inset - 0.5,
        'haut du champ : ' + m.hautChamp + 'px CSS pour une encoche de ' + m.inset + 'px — '
        + Math.round(m.inset - m.hautChamp) + 'px du champ sont tranchés, c\'est la capture du client '
        + '(zoom ' + m.zoom + ', mesures ramenées en px CSS)');
      /* … et il doit se poser DANS la rangée, à la hauteur des icônes, pas au-dessus d'elles. */
      v('[mesuré] il se centre sur la rangée d\'icônes, pas au-dessus',
        m.centreIcone != null && Math.abs(m.centreChamp - m.centreIcone) <= 6,
        'centre du champ ' + m.centreChamp + 'px contre ' + m.centreIcone + 'px pour les icônes');
      v('[mesuré] il reste entièrement dans la barre du haut', m.basChamp <= m.basBarre + 0.5,
        'bas du champ ' + m.basChamp + 'px, bas de la barre ' + m.basBarre + 'px');
    }
    await page.close();
  }

  console.log('\n── Sans encoche, RIEN ne change (la correction ne touche pas les autres écrans) ──');
  encoche = 0;
  const { page: plat } = await ouvrirEtDeplier(430);
  const mp = await mesure(plat);
  v('[mesuré] sur un écran sans encoche le champ reste dans la barre', !!(mp && mp.deplie && mp.hautChamp >= -0.5 && mp.basChamp <= mp.basBarre + 0.5),
    mp ? 'haut ' + mp.hautChamp + ' / bas ' + mp.basChamp + ' / bas barre ' + mp.basBarre : '');
  await plat.close();

  console.log('\n── Témoin : l\'ancien calcul remis, le champ repasse sous l\'encoche ──');
  const brut = fs.readFileSync(path.join(PUB, 'css/style.css'), 'utf8');
  v('le calcul corrigé est bien dans la feuille (sinon le témoin ne mute rien)', RE_FIX.test(brut));
  mutation = true; encoche = ENCOCHE;
  const { page: mut } = await ouvrirEtDeplier(430);
  const mm = await mesure(mut);
  v('[mesuré] avec l\'ancien calcul, le haut du champ est bien TRANCHÉ par la barre d\'état',
    !!(mm && mm.deplie && mm.hautChamp < mm.inset - 1),
    mm ? 'haut du champ ' + mm.hautChamp + 'px pour une encoche de ' + mm.inset + 'px — si ce n\'est pas tranché, les contrôles ci-dessus ne mesurent pas ce correctif' : 'mesure impossible');
  await mut.close();
  mutation = false;

  await nav.close(); srv.close();
  console.log(ko ? `\n✗ ${ko} contrôle(s) en échec\n` : `\n✓ ${ok} contrôles au vert\n`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

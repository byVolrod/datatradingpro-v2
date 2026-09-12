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
/* ⚠️ UN COMPTE QUI A « MON DESK » : c'est la quatrième icône du centre, celle qui fait déborder la
   rangée. Le drapeau est posé par la RÉPONSE de l'API (app.js l'y lit) — le forcer côté page serait
   écrasé au chargement, et le banc retomberait sur la topbar allégée qui l'a rendu vert à tort. */
const UTIL = { loggedIn: true, authenticated: true, email: 'banc@dtp.fr', role: 'admin', plan: 'professionnel', monDesk: true, mondesk: true };
const PORT = 4994;
const SEUIL = 3;                     // WCAG 1.4.11 : 3:1 pour un élément d'interface porteur de sens
/* ⚠️ LE PLANCHER TACTILE EST CELUI DU PROJET, PAS UN QUE CE BANC SE CHOISIT (12/09). Sa première
   version se contentait de 30 px CSS — plus laxiste que la garde de `mobile-verif` (32 px RÉELS,
   soit 36 px CSS sous le zoom de 0,9). Elle est donc passée au VERT sur un correctif qui rétrécissait
   les icônes du centre à 32 px CSS, c'est-à-dire 28,8 px réels : `mobile-verif` l'a refusé, ce banc
   ne l'a pas vu. Deux bancs qui mesurent la même chose avec deux seuils différents, c'est le plus
   laxiste qui décide — et il décide à tort. On lit donc le MÊME seuil, et la conversion de px réels
   en px CSS est faite ici une fois pour toutes. */
const CIBLE_REELLE_MIN = 32;
/* En dessous de 375 px d'écran, une rangée de quatre boutons à 36 px CSS ne tient PAS, quel que soit
   l'espacement : le palier étroit y descend à 28 px CSS (25,2 réels). C'est un arbitrage assumé et
   ANTÉRIEUR à ce correctif — un bouton un peu petit mais ENTIER vaut mieux qu'un bouton coupé — et
   on l'écrit plutôt que de le laisser passer pour une conformité. */
const BORNE_36 = 375;
/* Témoin : quand il est posé, la feuille est servie SANS le bloc correctif. Le contraste doit alors
   retomber sous le seuil — sinon les contrôles ci-dessus ne mesureraient pas ce qu'ils prétendent. */
let mutation = false;
/* ══ LES TÉMOINS DU ROGNAGE, ET CE QUE CHACUN PROUVE EXACTEMENT ═════════════════════════════════
   Le correctif a DEUX moitiés, et elles ont été mesurées SÉPARÉMENT avant d'écrire une ligne de
   commentaire — parce que ma première rédaction attribuait tout le rognage aux marges en doublon, et
   le témoin l'a démentie : les marges remises, la case ne se coupait PLUS. Relevés à 375 px, en px
   d'écran, avec la topbar lourde :
     · état d'origine                       375 : coupée de 20,7 px  ·  390 : coupée de 5,7 px
     · remise à zéro des marges SEULE       375 : coupée de  8,1 px  ·  390 : entière
     · resserrement des espaces SEUL        375 : entière, 2 px de marge restante dans la barre
     · les deux                             375 : entière, 14 px de marge restante
   Donc : le RESSERREMENT est ce qui sauve 375 px, et la remise à zéro des marges est ce qui laisse
   une vraie réserve au lieu de 2 px. Les deux portent, mais pas la même chose — et chaque témoin
   n'affirme que ce qu'il mesure. */
let mutationMarges = false, mutationResserrement = false, mutationOrigine = false;
/* ⚠️ LE TÉMOIN LE PLUS FORT DISPONIBLE : la feuille TELLE QU'ELLE ÉTAIT quand le client a
   photographié le défaut. Pas une mutation que j'invente et dont je peux me convaincre qu'elle
   reproduit le symptôme : la version qui l'avait vraiment.
   ⚠️ ÉPINGLÉ SUR UN COMMIT, JAMAIS SUR `HEAD~1`. Ma première écriture lisait `HEAD~1` : une cible
   MOUVANTE, qui au commit suivant aurait éprouvé une feuille DÉJÀ corrigée et serait donc passée au
   vert en ne prouvant plus rien — un faux vert fabriqué par le banc lui-même, exactement la maladie
   que ce dépôt traque. `a402b35` est le commit de la capture, il ne bougera pas.
   ⚠️ ET IL S'ABSTIENT SI L'HISTORIQUE EST TRONQUÉ : le CI cloue la copie à un seul commit
   (`fetch-depth: 1`), l'objet n'y est donc pas lisible. Un témoin absent doit se taire, jamais
   bloquer un déploiement pour une raison qui n'a rien à voir avec le code livré. */
const SHA_CAPTURE = 'a402b35';
const CSS_ORIGINE = (() => {
  try { return require('child_process').execSync(`git show ${SHA_CAPTURE}:public/css/style.css`, { cwd: RACINE, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
  catch { return null; }
})();
const RE_MARGES = /\.topbar-center \.topbar-icon--desk,\s*\n\s*\.topbar-center \.topbar-icon--journal,\s*\n\s*\.topbar-center \.topbar-icon--calc \{ margin-right: 0; \}/;
const RE_RESSERREMENT = /\/\* Le resserrement de la bande étroite[\s\S]*?\n\}\n/;
const RE_CORRECTIF = /\.topbar-symbol-search \.search-icon \{ color: var\(--text3\); \}[\s\S]*?@media \(max-width: 768px\) \{\s*\n\s*\.topbar-symbol-search \.search-icon \{ color: #aeb6c2; \}[\s\S]*?\n\}/;

(async () => {
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u === '/sw.js') { rs.writeHead(404); return rs.end(); }
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify({ items: [], total: 0, ok: true, user: UTIL, ...UTIL })); }
    const f = path.join(PUB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('404'); }
    if (mutationOrigine && CSS_ORIGINE && /style\.css$/.test(f)) {
      rs.writeHead(200, { 'Content-Type': MIME['.css'] });
      return rs.end(CSS_ORIGINE);
    }
    if ((mutation || mutationMarges || mutationResserrement) && /style\.css$/.test(f)) {
      rs.writeHead(200, { 'Content-Type': MIME['.css'] });
      let css = fs.readFileSync(f, 'utf8');
      if (mutation) css = css.replace(RE_CORRECTIF, '');
      if (mutationMarges) css = css.replace(RE_MARGES, '');
      if (mutationResserrement) css = css.replace(RE_RESSERREMENT, '');
      return rs.end(css);
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
      zoom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dtp-zoom')) || 1,
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

  /* ⚠️ LA TOPBAR DU BANC DOIT ÊTRE CELLE DU CLIENT, PAS UNE PLUS LÉGÈRE (12/09). La première version
     de ce banc mesurait un compte sans « Mon Desk » : trois icônes au centre au lieu de quatre, donc
     une quinzaine de pixels de marge en trop. Elle est passée au vert sur une topbar où la case se
     faisait RÉELLEMENT couper chez l'utilisateur. On force donc le drapeau qui pose la quatrième
     icône — un banc qui teste une configuration plus confortable que la vraie est un faux vert. */
  async function ouvrir(largeur, hauteur) {
    const page = await nav.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message || e)));
    await page.evaluateOnNewDocument(() => { window._pdMonDesk = true; });
    await page.setViewport({ width: largeur, height: hauteur, isMobile: largeur <= 480, hasTouch: largeur <= 480 });
    await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 1200));
    return { page, erreurs };
  }

  /* Rognage : la case dépasse-t-elle le cadre de la rangée qui la contient ? C'est la mesure qui
     décrit la capture user (« elle est coupée »), et elle ne se déduit d'aucune règle CSS lue. */
  const rognage = page => page.evaluate(() => {
    const centre = document.querySelector('.topbar-center');
    const boite = document.querySelector('.topbar-symbol-search');
    if (!centre || !boite) return null;
    const c = centre.getBoundingClientRect(), b = boite.getBoundingClientRect();
    return {
      rognee: b.right > c.right + 0.5 || b.left < c.left - 0.5,
      depasse: Math.round(b.right - c.right),
      taille: Math.round(b.width),
      deskIcon: !!document.getElementById('widgets-btn'),
      nbIcones: centre.querySelectorAll('.topbar-icon').length,
      /* Cible de la plus petite icône VOISINE dans la rangée : la référence à laquelle la case doit
         s'aligner. En px réels, comme tout ce qui se juge au doigt. */
      cibleIcone: Math.min(...[...centre.querySelectorAll('.topbar-icon')].map(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }).filter(x => x > 0)),
      /* Réserve encore libre dans la barre, en px CSS : largeur de la barre moins ses rembourrages,
         ses écarts et ses trois groupes. C'est la mesure qui dit si la rangée tient de justesse ou
         avec de la marge — « 0 px » et « 14 px » se ressemblent tant qu'on ne les compte pas. */
      reserve: (() => {
        const b = document.querySelector('.topbar'); if (!b) return null;
        const sb = getComputedStyle(b), zz = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dtp-zoom')) || 1;
        const enfants = [...b.children].reduce((a, e) => a + e.getBoundingClientRect().width, 0);
        const ecarts = (b.children.length - 1) * parseFloat(sb.columnGap || 0);
        return +((b.getBoundingClientRect().width - parseFloat(sb.paddingLeft) - parseFloat(sb.paddingRight) - ecarts - enfants) / zz).toFixed(1);
      })(),
      /* La barre elle-même ne doit pas déborder : si le centre tient mais que la barre déborde, le
         contenu est simplement poussé hors de l'écran — un autre visage du même défaut. */
      debordeBarre: (() => { const b = document.querySelector('.topbar'); return b ? Math.round(b.scrollWidth - b.clientWidth) : null; })(),
      /* ⚠️ LE CONTRÔLE QUI MESURE CE QUE L'ŒIL VOIT, ET QUE LES PRÉCÉDENTS NE VOYAIENT PAS (12/09,
         3ᵉ retour user : « c'est coupé encore »). Comparer `case.right` à `centre.right` répond à
         « la case déborde-t-elle de sa boîte ? » — et une case EXACTEMENT à ras passe ce test tout
         en ayant l'air tranchée par le filet vertical, parce que le groupe voisin, plus tard dans le
         document, PEINT PAR-DESSUS. C'est exactement la capture du client. On interroge donc le
         navigateur là où ça se joue : quel élément est au-dessus, 2 px À L'INTÉRIEUR du bord droit
         de la case ? Si ce n'est pas la case, son bord est recouvert, quels que soient les chiffres
         de rectangles. Aucun raisonnement, un survol. */
      bordDroitDecouvert: (() => {
        const b = document.querySelector('.topbar-symbol-search'); if (!b) return null;
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.right - 2, r.top + r.height / 2);
        return !!(el && (el === b || b.contains(el)));
      })(),
      /* Et l'air qui reste avant le groupe voisin : « à ras » et « avec de la marge » ne se
         distinguent qu'en les comptant. */
      ecartDroite: (() => {
        const b = document.querySelector('.topbar-symbol-search'), d = document.querySelector('.topbar-right');
        return (b && d) ? +(d.getBoundingClientRect().left - b.getBoundingClientRect().right).toFixed(1) : null;
      })(),
    };
  });

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
    /* Le desk applique un zoom global : la cible se juge en px RÉELS, ceux que le doigt touche. */
    v(`[mesuré] sa cible tactile tient le plancher du projet (≥ ${CIBLE_REELLE_MIN}px réels)`,
      m.cible.w >= CIBLE_REELLE_MIN && m.cible.h >= CIBLE_REELLE_MIN,
      'cible : ' + m.cible.w + '×' + m.cible.h + 'px réels (zoom ' + m.zoom + ')');
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

  console.log('\n── Elle n\'est COUPÉE sur aucune largeur de téléphone ──');
  /* ⚠️ LES LARGEURS SONT ÉPROUVÉES UNE PAR UNE, jamais déduites l'une de l'autre : le défaut du
     12/09 vivait précisément dans une bande que personne n'avait mesurée (361-400 px, soit les
     iPhone SE 2/3 et les mini), entre deux paliers qui allaient bien chacun de leur côté. */
  /* ⚠️ LES DEUX CÔTÉS DE LA BORNE SONT MESURÉS (374 ET 375). Une borne de palier qu'on ne mesure
     que d'un côté est exactement l'endroit où le défaut du 12/09 s'était logé. */
  for (const L of [320, 360, 374, 375, 390, 400, 401, 412, 430]) {
    const { page: p } = await ouvrir(L, 780);
    const r = await rognage(p);
    const mm = await mesurer(p);
    v(`[mesuré] ${L}px : la case n'est pas coupée` + (r ? ` (marge ${r.depasse}px, ${r.nbIcones} icônes au centre)` : ''),
      !!(r && !r.rognee),
      r ? `la case déborde de ${r.depasse}px hors de la rangée : c'est le « elle est coupée » de la capture` : 'mesure impossible');
    v(`[mesuré] ${L}px : la barre du haut ne déborde pas non plus`, !!(r && r.debordeBarre <= 1),
      r ? `${r.debordeBarre}px de débordement : le contenu serait poussé hors de l'écran` : 'mesure impossible');
    /* ⚠️ LE CONTRÔLE QUI EMPÊCHE LE FAUX VERT DE REVENIR. La première version de ce banc mesurait une
       topbar SANS l'icône Mon Desk, donc plus légère d'un bouton et de son écart que celle du client :
       elle est passée au vert sur une case réellement coupée. On vérifie donc que la topbar mesurée
       EST bien la lourde — sinon tous les contrôles de cette boucle ne prouvent rien. */
    v(`[mesuré] ${L}px : le bord DROIT de la case est découvert (survol, pas un calcul)`,
      !!(r && r.bordDroitDecouvert),
      'un autre élément est peint par-dessus le bord droit : c\'est le « c\'est coupé » de la capture, ' +
      'et aucune comparaison de rectangles ne le voit quand la case est exactement à ras');
    v(`[mesuré] ${L}px : il reste de l'air avant le groupe d'icônes voisin (≥ 6px)`,
      !!(r && r.ecartDroite >= 6), r ? 'écart mesuré : ' + r.ecartDroite + 'px' : 'mesure impossible');
    v(`[mesuré] ${L}px : c'est bien la topbar LOURDE qui est mesurée (icône Mon Desk posée)`,
      !!(r && r.deskIcon),
      'sans Mon Desk, la rangée a un bouton de moins : le banc mesurerait une topbar plus confortable que la vraie');
    /* Sous 375px, le palier étroit descend volontairement à 28px CSS : la rangée ne tient pas
       autrement (mesuré), et entier vaut mieux que coupé. Au-dessus, le plancher du projet. */
    const plancher = L >= BORNE_36 ? CIBLE_REELLE_MIN : 25;
    v(`[mesuré] ${L}px : elle reste lisible et à la cible de ses voisines (≥ ${plancher}px réels)`,
      !!(mm && mm.contraste >= SEUIL && mm.cible.w >= plancher && mm.cible.h >= plancher),
      mm ? `contraste ${mm.contraste}:1, cible ${mm.cible.w}×${mm.cible.h}px réels` : '');
    /* ⚠️ ET LA CASE DOIT AVOIR LA MÊME CIBLE QUE SES VOISINES, pas seulement « une cible suffisante » :
       c'est le dernier élément de la rangée, donc celui sur qui se réglaient les comptes qui ne
       tombaient pas juste. Elle valait 25px quand les icônes en faisaient 28. */
    v(`[mesuré] ${L}px : la case a EXACTEMENT la cible des icônes voisines`,
      !!(r && mm && Math.abs(mm.cible.h - r.cibleIcone) <= 1),
      r && mm ? `case ${mm.cible.h}px réels, icônes voisines ${r.cibleIcone}px` : 'mesure impossible');
    await p.close();
  }

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
  mutation = false;

  console.log('\n── Témoin des MARGES : sans leur remise à zéro, la barre n\'a plus de réserve ──');
  const brutM = fs.readFileSync(path.join(PUB, 'css/style.css'), 'utf8');
  v('la remise à zéro des marges est bien dans la feuille (sinon le témoin ne mute rien)', RE_MARGES.test(brutM));
  const { page: pAvec } = await ouvrir(375, 780);
  const reserveAvec = (await rognage(pAvec)).reserve;
  await pAvec.close();
  mutationMarges = true;
  const { page: pSans } = await ouvrir(375, 780);
  const reserveSans = (await rognage(pSans)).reserve;
  await pSans.close();
  /* ⚠️ CE QUE CE TÉMOIN PROUVE, ET RIEN DE PLUS. Les marges remises, la case n'est PAS re-coupée —
     mesuré, et c'est ce qui a corrigé ma rédaction. Ce qu'elles coûtent, c'est la RÉSERVE : 14 px
     libres dans la barre avec la remise à zéro, 2 px sans. Deux px, c'est une rangée qui ne survit
     pas à l'ajout d'un seul élément, donc au prochain correctif. On mesure donc la réserve, pas un
     rognage qu'on n'obtient pas : un témoin qui affirme plus que sa mesure est un faux témoin. */
  v('[mesuré] les marges en doublon remises, la réserve de la barre s\'effondre (≥ 8px → ≤ 4px)',
    reserveAvec >= 8 && reserveSans <= 4,
    'réserve à 375px : ' + reserveAvec + 'px CSS avec la remise à zéro, ' + reserveSans + 'px sans');
  mutationMarges = false;

  console.log('\n── Témoin du RESSERREMENT : sans lui, la case est coupée à 375px ──');
  v('le bloc de resserrement est bien dans la feuille (sinon le témoin ne mute rien)', RE_RESSERREMENT.test(brutM));
  mutationResserrement = true;
  const { page: pr } = await ouvrir(375, 780);
  const rr375 = await rognage(pr);
  await pr.close();
  /* C'est CETTE moitié qui sauve 375 px : sans elle, 8,1 px de la case passent hors de la rangée —
     la capture user, à la largeur d'un iPhone SE 2/3 ou d'un 12/13 mini. */
  v('[mesuré] sans le resserrement, la case redevient coupée à 375px',
    !!(rr375 && (rr375.rognee || rr375.depasse > 0.5)),
    rr375 ? 'dépassement mesuré : ' + rr375.depasse + 'px (attendu : ~8px)' : 'mesure impossible');
  /* ⚠️ CE QUE CE TÉMOIN NE PROUVE PAS, et je l'ai vérifié avant de l'écrire : le bord droit n'y est
     PAS recouvert. Sans le resserrement la case déborde de sa rangée, mais dans du vide — le groupe
     voisin est encore plus loin. Le recouvrement, lui, demande que la case morde sur ce groupe, et
     c'est l'état d'origine qui le produit. Un témoin n'affirme que ce qu'il mesure : celui-là dit
     « elle déborde », celui d'en dessous dit « elle est recouverte ». */
  mutationResserrement = false;

  console.log('\n── Témoin d\'ORIGINE : la feuille du commit ' + SHA_CAPTURE + ', celle de la capture client ──');
  let couverts = 0, serres = 0, vus = 0;
  if (!CSS_ORIGINE) {
    console.log('  · historique tronqué : la feuille de ' + SHA_CAPTURE + ' n\'est pas lisible ici → témoin ABSTENU');
  } else {
    mutationOrigine = true;
    for (const L of [375, 390]) {
      const { page: po } = await ouvrir(L, 780);
      const ro = await rognage(po);
      await po.close();
      if (ro) { vus++; if (ro.bordDroitDecouvert === false) couverts++; if (ro.ecartDroite < 6) serres++; }
    }
  }
  /* ⚠️ LES DEUX VISAGES DU MÊME SYMPTÔME, ET ILS N'APPARAISSENT PAS AUX MÊMES LARGEURS — mesuré,
     après m'être trompé une fois de plus en l'écrivant d'avance. À 375 px la case est RECOUVERTE par
     le groupe voisin ; à 390 px elle ne l'est pas, elle est COLLÉE au filet vertical. À l'œil c'est
     identique : dans les deux cas le bord arrondi de droite n'existe pas. C'est donc l'AIR qui est le
     contrôle universel — il manque aux deux largeurs — et le recouvrement le contrôle du pire cas.
     Chacun n'affirme que ce qu'il mesure. */
  if (CSS_ORIGINE) {
    v('[mesuré] sur la feuille d\'origine, le bord droit est RECOUVERT au moins à une largeur',
      vus === 2 && couverts >= 1, couverts + ' largeur(s) sur ' + vus + ' recouvertes (mesuré : 375px oui, 390px collée)');
    v('[mesuré] … et AUCUNE des deux n\'avait d\'air avant le groupe voisin (le symptôme commun)',
      vus === 2 && serres === 2, serres + ' largeur(s) sur ' + vus + ' sous 6px d\'écart');
  }
  mutationOrigine = false;
  mutationResserrement = false;

  await nav.close(); srv.close();
  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('✗ banc en erreur :', e.message); process.exit(1); });

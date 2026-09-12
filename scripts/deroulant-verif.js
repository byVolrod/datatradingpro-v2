#!/usr/bin/env node
/**
 * scripts/deroulant-verif.js — LE MENU DÉROULANT PARTAGÉ SE TAPE, ET NE RECOUVRE PAS SA CARTE.
 * ------------------------------------------------------------------------------------------------
 * 12/09, capture user sur un sélecteur de paires : « il cache la paire affichée, et qu'on puisse
 * taper à l'écrit aussi la paire ». Deux défauts distincts, tous deux dans `dtpsel` (app.js), LE
 * composant par lequel passent tous les <select> stylés du desk.
 *
 * ⚠️ CE BANC MONTE LE VRAI COMPOSANT, il ne relit pas des règles CSS. Il sert une page qui charge
 * `public/js/app.js` tel quel, pose un <select> de 28 paires, ouvre le menu à la souris, TAPE dans
 * le champ et compte ce qui reste visible. Un filtre qui ne plie pas les accents, un `hidden` perdu
 * contre le `display:flex` de l'item, un panneau qui déborde de l'écran : rien de tout cela ne se
 * voit en lisant le code, et tout se mesure ici.
 *
 * ⚠️ ET IL ÉPROUVE LA PLACE, PAS SEULEMENT LA PRÉSENCE. Le recouvrement signalé n'était pas une
 * erreur de position mais d'absence de BORNE : le panneau s'ouvrait toujours sous le bouton, à
 * 300 px de haut, et mordait sur la carte dès que le bouton était bas dans l'écran. On place donc
 * le bouton en bas, en haut et au milieu, et on vérifie que le panneau tient dans l'écran.
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
  console.log('\n[deroulant-verif] aucun navigateur disponible → contrôle ABSTENU (code 0)\n');
  process.exit(0);
}

const PORT = 4996;
const PAIRES = ['AUD/CAD','AUD/CHF','AUD/JPY','AUD/NZD','AUD/USD','CAD/CHF','CAD/JPY','CHF/JPY',
  'EUR/AUD','EUR/CAD','EUR/CHF','EUR/GBP','EUR/JPY','EUR/NZD','EUR/USD','GBP/AUD','GBP/CAD',
  'GBP/CHF','GBP/JPY','GBP/NZD','GBP/USD','NZD/CAD','NZD/CHF','NZD/JPY','NZD/USD','USD/CAD',
  'USD/CHF','USD/JPY'];
/* Témoin : servi muté, `app.js` perd son champ de recherche. Les contrôles de frappe doivent alors
   tomber — sinon ils mesurent autre chose que le correctif. */
let mutation = false, mutationZoom = false;
const RE_RECH = /var DTPSEL_SEUIL_RECH = 14;/;
/* Témoin de la VRAIE cause du « il cache la paire affichée » : on remet l'écriture des coordonnées
   en pixels visuels (sans division par le zoom), telle qu'elle était avant le 12/09. Le panneau doit
   alors recouvrir le bouton, exactement comme sur la capture. */
const RE_ZOOM = /panel\.style\.top=\(\(r\.bottom\+5\)\/z\)\+'px';/;

/* Page MINIMALE : uniquement app.js et la feuille du desk. Charger tout index.html ferait dépendre
   ce banc du fil d'actualité, des graphiques et de vingt appels réseau — pour éprouver un menu. */
function page(posBouton) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/css/style.css"></head>
<body style="height:3000px;background:#0c0c0e">
<!-- Le strict minimum que init() d'app.js resout au chargement. Sans #search-input il jette
     une TypeError avant d'avoir fini, et la moitie du fichier ne s'execute jamais : le banc
     mesurerait alors un composant monte dans un contexte ampute, ce qui ne prouve rien. On pose
     donc ces quelques noeuds plutot que de FILTRER l'erreur : filtrer aurait laisse passer,
     demain, une vraie exception du menu. -->
<input id="search-input" hidden><span id="live-dot"></span><span id="notif-badge"></span>
<span id="item-count"></span><div id="news-list"></div>
<div id="boite" style="position:fixed;left:40px;${posBouton}">
  <select id="paire">${PAIRES.map((p, i) => `<option value="${p}"${p === 'AUD/JPY' ? ' selected' : ''}>${p}</option>`).join('')}</select>
</div>
<script src="/js/app.js"></script>
</body></html>`;
}

(async () => {
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end('{"ok":true,"items":[],"recent":[]}'); }
    if (u.startsWith('/page/')) {
      const pos = u === '/page/bas' ? 'bottom:24px' : (u === '/page/haut' ? 'top:24px' : 'top:50%');
      rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return rs.end(page(pos));
    }
    const f = path.join(PUB, u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('404'); }
    const t = /\.css$/.test(f) ? 'text/css' : (/\.js$/.test(f) ? 'application/javascript; charset=utf-8' : 'application/octet-stream');
    let txt = fs.readFileSync(f, 'utf8');
    if (mutation && /app\.js$/.test(f)) txt = txt.replace(RE_RECH, 'var DTPSEL_SEUIL_RECH = 99999;');
    if (mutationZoom && /app\.js$/.test(f)) txt = txt.replace(RE_ZOOM, "panel.style.top=(r.bottom+5)+'px';");
    rs.writeHead(200, { 'Content-Type': t }); rs.end(txt);
  });
  await new Promise(r => srv.listen(PORT, r));
  const nav = await pp.launch({ executablePath: NAV, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  async function ouvrir(ou, largeur, hauteur) {
    const page = await nav.newPage();
    const err = [];
    page.on('pageerror', e => err.push(String((e && e.stack) || e.message || e)));
    await page.setViewport({ width: largeur || 1280, height: hauteur || 760 });
    await page.goto(`http://localhost:${PORT}/page/${ou}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 400));
    await page.click('.dtpsel-btn');
    await new Promise(r => setTimeout(r, 250));
    return { page, err };
  }
  const etat = p => p.evaluate(() => {
    const panel = document.querySelector('.dtpsel-panel');
    if (!panel) return null;
    const items = [...panel.querySelectorAll('.dtpsel-item')];
    const visibles = items.filter(e => e.getBoundingClientRect().height > 0);
    const r = panel.getBoundingClientRect();
    const btn = document.querySelector('.dtpsel-btn').getBoundingClientRect();
    return {
      total: items.length,
      visibles: visibles.map(e => e.textContent.trim()),
      nbVisibles: visibles.length,
      champ: !!panel.querySelector('.dtpsel-rech'),
      champFocus: document.activeElement === panel.querySelector('.dtpsel-rech'),
      videAffiche: (() => { const x = panel.querySelector('.dtpsel-vide'); return !!x && !x.hidden; })(),
      /* Débordement de l'ÉCRAN, dans les deux sens : c'est la mesure du « il cache » — un panneau
         qui sort de l'écran est un panneau dont une partie est inatteignable. */
      deborde: Math.round(Math.max(0, r.bottom - window.innerHeight) + Math.max(0, -r.top)),
      hauteur: Math.round(r.height),
      chevaucheBouton: !(r.bottom <= btn.top + 0.5 || r.top >= btn.bottom - 0.5),
      _dbg: { pT: Math.round(r.top), pB: Math.round(r.bottom), bT: Math.round(btn.top), bB: Math.round(btn.bottom), vh: window.innerHeight, mm: (window.matchMedia('(hover: hover) and (pointer: fine)').matches) },
      libelleBouton: document.querySelector('.dtpsel-lbl').textContent.trim(),
    };
  });

  console.log('\n── Le menu s\'ouvre, et il offre un champ de recherche (28 entrées) ──');
  let { page: p, err } = await ouvrir('milieu');
  let m = await etat(p);
  v('la page se charge sans exception', err.length === 0, err.join(' | '));
  v('le menu partagé s\'ouvre bien', !!m);
  v('[mesuré] les 28 paires sont dans le panneau', !!(m && m.total === 28), m ? m.total + ' entrées' : '');
  v('[mesuré] un champ de recherche est posé (liste longue)', !!(m && m.champ));
  v('[mesuré] il prend le focus au pointeur fin (on peut taper tout de suite)', !!(m && m.champFocus),
    'sans focus automatique : ' + JSON.stringify(m && m._dbg));

  console.log('\n── On TAPE, et la liste se réduit ──');
  await p.type('.dtpsel-rech', 'audj');
  await new Promise(r => setTimeout(r, 150));
  m = await etat(p);
  v('[mesuré] « audj » ne laisse que AUD/JPY', !!(m && m.nbVisibles === 1 && m.visibles[0] === 'AUD/JPY'),
    m ? m.nbVisibles + ' entrée(s) : ' + m.visibles.slice(0, 6).join(', ') : '');
  /* La frappe naturelle d'un trader porte la barre oblique : « aud/j » doit marcher comme « audj »,
     sinon le champ punit la façon dont la paire s'écrit partout ailleurs dans le produit. */
  await p.evaluate(() => { const c = document.querySelector('.dtpsel-rech'); c.value = 'aud/j'; c.dispatchEvent(new Event('input')); });
  await new Promise(r => setTimeout(r, 150));
  m = await etat(p);
  v('[mesuré] « aud/j », avec la barre oblique, donne le même résultat', !!(m && m.nbVisibles === 1 && m.visibles[0] === 'AUD/JPY'),
    m ? m.nbVisibles + ' entrée(s)' : '');
  await p.evaluate(() => { const c = document.querySelector('.dtpsel-rech'); c.value = 'zzz'; c.dispatchEvent(new Event('input')); });
  await new Promise(r => setTimeout(r, 150));
  m = await etat(p);
  v('[mesuré] une recherche sans résultat le DIT au lieu d\'afficher le vide', !!(m && m.nbVisibles === 0 && m.videAffiche),
    m ? m.nbVisibles + ' visible(s), message affiché : ' + m.videAffiche : '');

  console.log('\n── Entrée valide la première entrée restante ──');
  await p.evaluate(() => { const c = document.querySelector('.dtpsel-rech'); c.value = 'gbpn'; c.dispatchEvent(new Event('input')); });
  await new Promise(r => setTimeout(r, 120));
  await p.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 200));
  const apres = await p.evaluate(() => ({
    valeur: document.getElementById('paire').value,
    libelle: document.querySelector('.dtpsel-lbl').textContent.trim(),
    ferme: !document.querySelector('.dtpsel-panel'),
  }));
  v('[mesuré] Entrée sélectionne la paire filtrée', apres.valeur === 'GBP/NZD', 'valeur : ' + apres.valeur);
  v('[mesuré] … le bouton affiche la nouvelle paire', apres.libelle === 'GBP/NZD', 'libellé : ' + apres.libelle);
  v('[mesuré] … et le menu se referme', apres.ferme);
  await p.close();

  console.log('\n── Il ne déborde de l\'écran à AUCUNE position du bouton ──');
  for (const ou of ['haut', 'milieu', 'bas']) {
    const { page: q } = await ouvrir(ou, 1280, 700);
    const e = await etat(q);
    v(`[mesuré] bouton en ${ou} : le panneau tient dans l'écran`, !!(e && e.deborde <= 1),
      e ? e.deborde + 'px hors de l\'écran (hauteur ' + e.hauteur + 'px)' : 'mesure impossible');
    v(`[mesuré] bouton en ${ou} : il ne recouvre pas le bouton lui-même`, !!(e && !e.chevaucheBouton),
      e ? 'le panneau chevauche le contrôle : ' + JSON.stringify(e._dbg) : '');
    await q.close();
  }
  /* Écran court : c'est là que la borne de hauteur se prouve. Sans elle, 300px de panneau sous un
     bouton posé bas sortent de l'écran — le « il cache » de la capture. */
  const { page: court } = await ouvrir('bas', 1280, 420);
  const ec = await etat(court);
  v('[mesuré] sur un écran de 420px de haut, le panneau tient encore', !!(ec && ec.deborde <= 1),
    ec ? ec.deborde + 'px hors de l\'écran (hauteur ' + ec.hauteur + 'px)' : '');
  v('[mesuré] … et il garde une hauteur utilisable (≥ 120px, il défile)', !!(ec && ec.hauteur >= 120),
    ec ? 'hauteur ' + ec.hauteur + 'px' : '');
  await court.close();

  console.log('\n── L\'option COURANTE est visible à l\'ouverture ──');
  const { page: sc } = await ouvrir('milieu');
  const vu = await sc.evaluate(() => {
    const panel = document.querySelector('.dtpsel-panel');
    const sel = panel.querySelector('.dtpsel-item.sel');
    if (!sel) return null;
    const rp = panel.getBoundingClientRect(), rs = sel.getBoundingClientRect();
    return { dedans: rs.top >= rp.top - 1 && rs.bottom <= rp.bottom + 1, txt: sel.textContent.trim() };
  });
  v('[mesuré] la paire déjà choisie est dans la partie visible du panneau', !!(vu && vu.dedans),
    vu ? 'option « ' + vu.txt +' » hors du cadre visible' : 'aucune option marquée sélectionnée');
  await sc.close();

  console.log('\n── Témoin : sans le champ, la frappe ne filtre plus rien ──');
  const brut = fs.readFileSync(path.join(PUB, 'js/app.js'), 'utf8');
  v('le seuil de recherche est bien dans app.js (sinon le témoin ne mute rien)', RE_RECH.test(brut));
  mutation = true;
  const { page: mut } = await ouvrir('milieu');
  const t = await etat(mut);
  v('[mesuré] seuil relevé : plus aucun champ de recherche', !!(t && !t.champ),
    'si le champ survit à la mutation, les contrôles de frappe ne mesurent pas ce correctif');
  await mut.close();
  mutation = false;

  console.log('\n── Témoin de la CAUSE : sans la division par le zoom, le panneau recouvre le bouton ──');
  v('l\'écriture compensée est bien dans app.js (sinon le témoin ne mute rien)', RE_ZOOM.test(brut));
  mutationZoom = true;
  const touches = [];
  let essais = 0;
  for (const ou of ['haut', 'milieu', 'bas']) {
    const { page: pz } = await ouvrir(ou, 1280, 700);
    const ez = await etat(pz);
    await pz.close();
    if (ez) { essais++; if (ez.chevaucheBouton) touches.push(ou); }
  }
  /* C'est LE contrôle qui décrit les deux captures. `getBoundingClientRect` rend du pixel VISUEL,
     `style.top` attend du pixel CSS : sans la division, le panneau se pose 10 pourcent trop haut et
     mord sur le contrôle. Mesuré avant correction : bouton 350-377, panneau 344-627.
     ⚠️ ET LE DÉFAUT NE SE VOIT PAS À TOUTES LES POSITIONS — vérifié, pas supposé. L'erreur vaut
     10 pourcent de la distance au HAUT de l'écran : près du bord supérieur elle ne fait que quelques
     pixels et ne recouvre rien ; plus on descend, plus elle mord. C'est exactement pourquoi le défaut
     a survécu si longtemps, et pourquoi un banc qui n'éprouverait qu'une seule position passerait au
     vert dessus. On exige donc qu'il morde quelque part, et on NOMME où. */
  v('[mesuré] coordonnées non compensées : le panneau recouvre le bouton plus bas dans l\'écran',
    essais === 3 && touches.length >= 1,
    'positions recouvertes : ' + (touches.join(', ') || 'aucune') + ' (sur ' + essais + ' éprouvées)');
  mutationZoom = false;

  await nav.close(); srv.close();
  console.log(ko ? `\n✗ ${ko} contrôle(s) en échec\n` : `\n✓ ${ok} contrôles au vert\n`);
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

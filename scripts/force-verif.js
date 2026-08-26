#!/usr/bin/env node
/**
 * force-verif.js — LE WIDGET « FORCE DES DEVISES » MONTRE-T-IL VRAIMENT LES HUIT DEVISES ?
 * ------------------------------------------------------------------------------------------------
 * 29/08, capture à l'appui : « Je ne vois pas à vu d'œil toutes les courbes informations de force
 * des devises ». Deux défauts distincts, mesurés, et le widget tombe TOUJOURS dans l'un des deux :
 *
 *   · quand le cadre se resserre sur le paquet (`cadrerSurLePaquet`), la devise laissée dehors perd
 *     sa PASTILLE — pas seulement sa courbe. Une pastille est le label d'une plage d'axe posée à la
 *     valeur de fin de courbe ; hors des bornes de l'axe, amCharts ne la rend pas. Mesuré : sept
 *     pastilles sur huit, et l'étiquette manquante a pourtant `visible: true` et son élément HTML.
 *   · quand il ne se resserre PAS (quatre fuyardes, ou gain jugé insuffisant), les huit courbes
 *     s'écrasent : mesuré 0,1 px entre deux fins de courbe voisines, pour un trait de 1,3 px.
 *
 * Ce contrôle mesure les deux, sur le VRAI code, dans un VRAI navigateur.
 *
 *   node scripts/force-verif.js
 *
 * ── amCharts ─────────────────────────────────────────────────────────────────────────────────────
 * Le desk charge amCharts 5 depuis son CDN. Un poste sans accès au CDN (intégration, conteneur
 * fermé) peut fournir un paquet local :
 *     DTP_AM5_BUNDLE=/chemin/vers/am5bundle.js node scripts/force-verif.js
 * Le paquet doit exposer `am5`, `am5xy` et `am5themes_Animated` sur `window` (esbuild --format=iife
 * sur un point d'entrée qui les y pose). À défaut, le contrôle tente le CDN ; s'il est injoignable
 * ou si Chromium manque, IL S'ABSTIENT (code 0) plutôt que de bloquer une livraison.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4614;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

let ok = 0, ko = 0;
const v = (titre, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + titre); }
  else { ko++; console.log('  ✗ ' + titre + (detail ? '\n      → ' + detail : '')); }
};

function trouverNavigateur() {
  const bases = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const b of bases) {
    try { for (const d of fs.readdirSync(b)) for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, rel)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x)) || null;
}

/* ══ JEUX D'ESSAI ════════════════════════════════════════════════════════════════════════════════
   Marches aléatoires REPRODUCTIBLES (générateur à graine, aucune horloge) à somme quasi nulle —
   c'est la nature de l'indicateur : si une devise gagne, les autres perdent mécaniquement.
     · « paquet »  : les huit dans la même bande. C'est le cas ordinaire d'une séance.
     · « fuyarde » : une devise décroche largement. C'est le cas qui casse le cadrage.
     · « ecrase »  : QUATRE devises décrochent → `bornesPaquet` renonce (elle exige que 60 % des
       devises restent dans le paquet) et les quatre autres se retrouvent aplaties au fond. */
const CCY = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CHF', 'CAD', 'NZD'];
/* Les séries sont CONSTRUITES pour finir sur des valeurs choisies : c'est la seule façon de garantir
   qu'un jeu d'essai atteint bien le régime qu'il prétend éprouver. Un marché aléatoire « qui devrait
   produire une fuyarde » n'en produit pas forcément — mesuré, et c'est ainsi qu'un contrôle passe au
   vert sans avoir rien éprouvé. Une rampe amène donc chaque devise à sa fin voulue, et le bruit
   par-dessus donne la texture (croisements, retournements) sans quoi on ne mesurerait pas un vrai
   tracé. Les valeurs restent sous le plafond de `computeScale` (99e centile × 100 ≤ 70) pour que
   l'échelle soit ×100 et que les fins voulues soient exactement les fins mesurées.
   `_verifRegimes` ci-dessous REJOUE le vrai `bornesPaquet` de charts.js et refuse de démarrer si un
   jeu n'atteint pas son régime. */
function jeu(nPts, dtMs, fins) {
  let s = 7; const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const t0 = Date.UTC(2026, 7, 24, 6, 0, 0);          // horodatage FIXE : un contrôle ne dépend pas de l'heure
  // 1) le bruit, d'abord, pour tout le monde — il donne la texture (croisements, retournements)
  const bruit = {}, cur = {}, vit = {};
  CCY.forEach(c => { bruit[c] = []; cur[c] = 0; vit[c] = 0; });
  for (let k = 0; k < nPts; k++) {
    const u = k / (nPts - 1);
    let somme = 0; const b = {};
    CCY.forEach((c, i) => {
      vit[c] = vit[c] * 0.97 + (r() - 0.5) * 0.00035;
      cur[c] += vit[c] + Math.sin(u * Math.PI * (1.6 + i * 0.5) + i) * 0.00009;
      b[c] = cur[c]; somme += cur[c];
    });
    CCY.forEach(c => bruit[c].push(b[c] - somme / 8));   // centré : l'indicateur est à somme quasi nulle
  }
  // 2) la rampe vers la fin voulue, ET le bruit annulé au dernier point : la fin mesurée EST la fin
  //    demandée, sinon le jeu d'essai ne prouve pas le régime qu'il annonce.
  const series = {};
  CCY.forEach(c => {
    const fin = bruit[c][nPts - 1];
    series[c] = bruit[c].map((n, k) => {
      const u = k / (nPts - 1);
      return { t: t0 + k * dtMs, v: (fins[c] / 100) * u + (n - fin * u) };
    });
  });
  return { currencies: CCY, series };
}

/* Trois régimes, et ce sont les trois que le widget rencontre en vrai :
     · paquet  — les huit dans la même bande. `bornesPaquet` ne compresse pas, elle n'a rien à faire.
     · fuyarde — une devise décroche. `bornesPaquet` COMPRESSE et la laisse dehors : c'est là que sa
                 pastille disparaissait.
     · écrasé  — QUATRE décrochent. `bornesPaquet` RENONCE (elle exige que 60 % des devises restent
                 dans le paquet) et les quatre du fond s'aplatissent. */
const JEUX = {
  paquet:  jeu(480, 60000,  { USD: 6.5, AUD: 6.0, GBP: 1.5, CAD: 1.2, JPY: -0.8, NZD: -1.5, EUR: -5.9, CHF: -7.2 }),
  fuyarde: jeu(1400, 300000, { USD: 42, AUD: 5.5, GBP: 1.6, CAD: 1.2, JPY: -0.9, NZD: -1.6, EUR: -5.4, CHF: -6.8 }),
  ecrase:  jeu(1400, 300000, { USD: 42, EUR: -38, JPY: 33, GBP: -31, AUD: 1.4, CHF: -1.2, CAD: 0.9, NZD: -1.6 }),
};

/* ON REJOUE LE VRAI `bornesPaquet` — celui de charts.js, extrait, pas une copie — pour VÉRIFIER que
   chaque jeu atteint son régime. Sans ce garde-fou, le jour où le seuil de `bornesPaquet` change, les
   jeux d'essai cesseraient silencieusement d'éprouver quoi que ce soit et tout resterait vert. */
function _bornesPaquetReel() {
  const src = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
  const d = src.indexOf('  function bornesPaquet(d, facteur) {');
  const f = src.indexOf('\n  var _dernieresDonnees = data;');
  if (d < 0 || f < 0) return null;
  try { return new Function('_hiddenCcy', '_only', src.slice(d, f) + '\nreturn bornesPaquet;')(new Set(), null); }
  catch (e) { return null; }
}
function _regimes() {
  const bp = _bornesPaquetReel();
  if (!bp) return { erreur: 'bornesPaquet introuvable dans charts.js' };
  const out = {};
  for (const [nom, d] of Object.entries(JEUX)) {
    const b = bp(d, 100);
    const fins = CCY.map(c => d.series[c][d.series[c].length - 1].v * 100);
    out[nom] = { compresse: !!b, cadre: b ? [+b.min.toFixed(1), +b.max.toFixed(1)] : null,
      dehors: b ? fins.filter(v => v < b.min || v > b.max).length : 0 };
  }
  return out;
}

const PAGE = (w, h, theme) => `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/css/style.css">
<style>
/* ⚠️ LE DESK APPLIQUE un zoom global de 90 % sur la page (style.css l.87), et la feuille pose aussi des
   marges de page. Le banc les neutralise pour le CADRE — sinon un widget déclaré 400 px serait
   mesuré à 360 px de large, et toutes les largeurs de ce contrôle seraient fausses de 10 %. Le zoom
   lui-même est CONSERVÉ à l'intérieur : c'est lui qui donne aux textes et aux pastilles leur taille
   réelle à l'écran. Les largeurs annoncées sont donc des pixels VRAIS. */
html, body { margin: 0 !important; padding: 0 !important; background: #0c0c0e; }
.banc { position: absolute; top: 0; left: 0; width: calc(${w}px / var(--dtp-zoom, 1)); height: calc(${h}px / var(--dtp-zoom, 1)); }
#g { width: 100%; height: 100%; }
</style>
${process.env.DTP_AM5_BUNDLE ? '<script src="/_am5.js"></script>'
  : '<script src="https://cdn.amcharts.com/lib/5/index.js"></script><script src="https://cdn.amcharts.com/lib/5/xy.js"></script><script src="https://cdn.amcharts.com/lib/5/themes/Animated.js"></script>'}
</head><body><div class="banc" id="banc"><div id="g"></div></div>
<script src="/js/charts.js"></script>
<script>
window.__err = []; window.__pret = false;
window.addEventListener('error', e => window.__err.push(String(e.message)));
(async () => {
  try {
    const p = new URLSearchParams(location.search);
    if (typeof am5 === 'undefined') { window.__err.push('amCharts absent'); window.__pret = true; return; }
    const d = await fetch('/api/currency-strength?p=' + p.get('p')).then(r => r.json());
    buildStrengthChart('g', d, JSON.parse(p.get('o') || '{}'));
  } catch (e) { window.__err.push('build: ' + e.message); }
  setTimeout(() => { window.__pret = true; }, 3500);
})();
</script></body></html>`;

function serveur() {
  return http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const q = new URL(req.url, 'http://x').searchParams;
    if (u === '/api/currency-strength') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(JEUX[q.get('p')] || JEUX.paquet)); }
    if (u === '/_am5.js' && process.env.DTP_AM5_BUNDLE) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(process.env.DTP_AM5_BUNDLE).pipe(res); }
    if (u === '/banc.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE(q.get('w') || 900, q.get('h') || 300, q.get('t') || 'dark')); }
    if (u.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}'); }
    const f = path.join(PUB, u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}

/* CE QUE L'ŒIL VOIT, MESURÉ. Le graphique est rendu EN CANVAS : ni les graduations, ni la légende,
   ni les courbes n'existent dans le DOM. Seules les pastilles sont du HTML. On mesure donc les
   pastilles dans le DOM, et tout le reste dans le MODÈLE amCharts (`_strengthRoot`). */
const SONDE = () => {
  const visible = el => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && b.width > 0 && b.height > 0; };
  const banc = document.getElementById('banc').getBoundingClientRect();
  const pastilles = [...document.querySelectorAll('.cs-badge')].filter(visible).map(e => {
    const b = e.getBoundingClientRect();
    return { ccy: ((e.querySelector('.cs-badge-ccy') || {}).textContent || '').trim(),
      x: Math.round(b.x - banc.x), y: Math.round(b.y - banc.y), w: Math.round(b.width), h: Math.round(b.height) };
  }).sort((a, b) => a.y - b.y);
  const heurte = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  const paires = [];
  for (let i = 0; i < pastilles.length; i++) for (let j = i + 1; j < pastilles.length; j++) if (heurte(pastilles[i], pastilles[j])) paires.push(pastilles[i].ccy + '/' + pastilles[j].ccy);
  const debordent = pastilles.filter(p => p.y < -1 || p.y + p.h > banc.height + 1 || p.x + p.w > banc.width + 1).map(p => p.ccy);

  let m = { dispo: false };
  try {
    /* On retrouve le graphique par le REGISTRE amCharts (`am5.registry.rootElements`), pas par la
       variable interne de charts.js : `am5` est sur `window`, la variable interne ne l'est pas — et
       un contrôle n'a pas a dependre d'un detail prive du fichier qu'il controle. */
    const root = (window.am5 && am5.registry && am5.registry.rootElements || []).find(r => r && r.dom && r.dom.id === 'g') || null;
    const chart = root && root.container.children.values.find(c => c.className === 'XYChart');
    if (chart) {
      const yAx = chart.yAxes.getIndex(0), xAx = chart.xAxes.getIndex(0), pc = chart.plotContainer;
      const lg = (root.container.children.values.concat(chart.children.values)).find(c => c.className === 'Legend');
      const min = yAx.getPrivate('min'), max = yAx.getPrivate('max'), h = pc.height();
      // Les series MASQUEES (mode paire, clic de legende) ne comptent pas : elles ne sont pas a l'ecran.
      const vues = chart.series.values.filter(s => { try { return !s.isHidden(); } catch (e) { return true; } });
      const fins = vues.map(s => { const d = s.data.values, l = d[d.length - 1]; return { ccy: s.get('name'), v: l ? l.v : null }; })
        .filter(o => o.v != null).sort((a, b) => b.v - a.v);
      const px = val => (max - val) / (max - min) * h;
      const ecarts = []; for (let i = 1; i < fins.length; i++) ecarts.push(Math.round((px(fins[i].v) - px(fins[i - 1].v)) * 10) / 10);
      /* LA PART DE HAUTEUR OCCUPÉE PAR LE PAQUET. C'est la mesure de « je ne vois pas les courbes » :
         huit courbes tassées dans 4 % de la hauteur sont huit courbes qu'on ne distingue pas. On
         mesure la bande des fins DANS le cadre — une devise hors cadre n'y entre pas, elle est
         ailleurs par construction. */
      const dedans = fins.filter(f => min == null || max == null || (f.v >= min && f.v <= max));
      /* ON MESURE LA BANDE REELLEMENT PEINTE, pas l'ecart entre les extremites. Une premiere version
         ne regardait que les fins de courbes : sur un cadre resserre elle criait « 48 % » alors que
         les courbes, elles, balayaient tout le cadre — leurs FINS etaient simplement rapprochees.
         Ce qu'on veut savoir est : quelle part de la hauteur du trace porte de la donnee ? */
      let bLo = Infinity, bHi = -Infinity;
      vues.forEach(s => s.data.values.forEach(d => {
        if (d.v == null) return;
        if (min != null && (d.v < min || d.v > max)) return;           // hors cadre : ce n'est pas de la hauteur perdue
        if (d.v < bLo) bLo = d.v; if (d.v > bHi) bHi = d.v;
      }));
      const partPaquet = (isFinite(bLo) && isFinite(bHi) && min != null && max > min) ? Math.round((bHi - bLo) / (max - min) * 100) : null;
      let nEtiqX = 0;
      try { xAx.get('renderer').labels.each(l => { if (l && !l.get('forceHidden') && l.get('visible') !== false) nEtiqX++; }); } catch (e) {}
      m = { dispo: true, plotH: Math.round(h), plotW: Math.round(pc.width()), partPaquet, nDedans: dedans.length, nEtiqX,
        legendeH: lg ? Math.round(lg.height()) : 0, legendeW: lg ? Math.round(lg.width()) : 0,
        gouttiere: Math.round(yAx.width()),
        yMin: min == null ? null : +min.toFixed(2), yMax: max == null ? null : +max.toFixed(2),
        ecartMin: ecarts.length ? Math.min(...ecarts) : null, ecarts,
        fins: fins.map(f => f.ccy + ':' + f.v.toFixed(1)) };
    }
  } catch (e) { m = { dispo: false, err: String(e && e.message) }; }
  // Une pastille dont la courbe sort du cadre porte un chevron : sans lui, elle prétendrait que la
  // devise finit pile au bord.
  const chevrons = [...document.querySelectorAll('.cs-badge--hors')].map(e => (e.textContent || '').replace(/[^A-Z]/g, ''));

  /* Une graduation TRANCHÉE par une pastille est le défaut visible de la capture : on compare la
     bande verticale de chaque graduation à celle de chaque pastille. Les graduations sont dessinées
     EN CANVAS — on les lit dans le modèle, en coordonnées du tracé, et on ramène les pastilles dans
     ce même repère (le desk applique un zoom de page : les boîtes DOM sont à l'échelle zoomée). */
  let tranchees = [];
  try {
    const root2 = (window.am5 && am5.registry && am5.registry.rootElements || []).find(r => r && r.dom && r.dom.id === 'g');
    const chart2 = root2 && root2.container.children.values.find(c => c.className === 'XYChart');
    const yAx2 = chart2 && chart2.yAxes.getIndex(0);
    if (yAx2) {
      /* ⚠️ MÊME REPÈRE DES DEUX CÔTÉS. Les pastilles sont du DOM (boîtes de page, à l'échelle du zoom
         de la page) ; les graduations sont dessinées dans le canvas, en unités amCharts, et leur `y`
         est relatif à leur conteneur, pas à la page. On ramène donc les graduations en coordonnées
         de PAGE via `toGlobal` et l'échelle réelle du canvas — sinon on compare deux origines
         différentes et on conclut à des collisions qui n'existent pas. */
      const cv = document.querySelector('#g canvas');
      const cr = cv && cv.getBoundingClientRect();
      const ech = (cr && root2.container.height()) ? cr.height / root2.container.height() : 1;
      const bancY = document.getElementById('banc').getBoundingClientRect().y;
      const bandes = pastilles.map(p => [p.y, p.y + p.h]);
      yAx2.get('renderer').labels.each(l => {
        try {
          if (!l || l.get('html') || l.get('forceHidden')) return;
          const hh = l.height() || 0;
          if (hh <= 0) return;
          const g = l.toGlobal({ x: 0, y: 0 });
          if (!g || !isFinite(g.y) || g.y < -500) return;
          /* ⚠️ ON MESURE UNE COUPURE, PAS UN CONTACT. Deux repères se reconstruisent ici dans deux
             espaces différents — la pastille est une boîte du document, la graduation est peinte
             dans le canvas et ramenée en coordonnées de page — et cette reconstruction porte
             fatalement une erreur de l'ordre du pixel. Compter un contact d'un demi-pixel comme un
             défaut ferait échouer le contrôle sur son propre bruit de mesure.
             Le défaut RÉEL, celui de la capture, est un chiffre coupé en deux sur toute sa largeur :
             il se mesure en plusieurs pixels. On exige donc un recouvrement franc. */
          const y0 = (cr.y - bancY) + g.y * ech, y1 = y0 + hh * ech;
          const rec = bandes.reduce((mx, b) => Math.max(mx, Math.min(y1, b[1]) - Math.max(y0, b[0])), 0);
          if (rec > 3) tranchees.push((l.get('text') || '?') + ' coupée sur ' + Math.round(rec) + ' px');
        } catch (e) {}
      });
    }
  } catch (e) {}

  return { banc: { w: Math.round(banc.width), h: Math.round(banc.height) }, pastilles, nPastilles: pastilles.length,
    heurtees: paires, debordent, chevrons, tranchees, modele: m, err: window.__err.slice(0, 4) };
};

/* LE SURVOL MET UNE COURBE EN AVANT. On ne simule pas un vrai pointeur (headless, canvas) : on
   appelle le mécanisme là où le produit l'appelle — l'événement de la légende — et on lit l'opacité
   RÉELLE des huit tracés. Ce qu'on vérifie est le résultat visible, pas qu'une fonction a été
   appelée. */
const SONDE_OPACITES = () => {
  try {
    const root = (window.am5 && am5.registry && am5.registry.rootElements || []).find(r => r && r.dom && r.dom.id === 'g');
    const chart = root && root.container.children.values.find(c => c.className === 'XYChart');
    if (!chart) return null;
    return chart.series.values.map(s => ({ ccy: s.get('name'), o: +(s.strokes.template.get('strokeOpacity')) }));
  } catch (e) { return null; }
};
/* OÙ CLIQUER : la légende est dessinée dans le canvas, elle n'a pas de boîte DOM. On demande à
   amCharts la position de l'entrée visée, on la ramène en coordonnées de page, et on y déplace un
   VRAI pointeur. Éprouver le mécanisme en appelant la fonction interne prouverait qu'une fonction
   marche ; éprouver le vrai chemin prouve que le survol marche. */
const SONDE_POS_LEGENDE = (i) => {
  try {
    const root = (window.am5 && am5.registry && am5.registry.rootElements || []).find(r => r && r.dom && r.dom.id === 'g');
    const chart = root && root.container.children.values.find(c => c.className === 'XYChart');
    const lg = chart && chart.children.values.find(c => c.className === 'Legend');
    const item = lg && lg.itemContainers.getIndex(i);
    const s = chart && chart.series.getIndex(i);
    if (!item || !s) return null;
    const cv = document.querySelector('#g canvas'); const cr = cv.getBoundingClientRect();
    const ech = cr.height / root.container.height();
    const g = item.toGlobal({ x: item.width() / 2, y: item.height() / 2 });
    return { ccy: s.get('name'), x: cr.x + g.x * ech, y: cr.y + g.y * ech };
  } catch (e) { return null; }
};

/* LA MATRICE. Ce n'est pas une liste de tailles jolies : chaque ligne reproduit un état RÉEL du
   produit. 400 px de large = la fenêtre étroite de la capture (sous 560 px, le widget bascule dans
   son rendu compact). 150 px de haut = la carte la plus courte du tableau de bord. */
const CAS = [
  { nom: 'fenêtre étroite, séance ordinaire',      w: 400,  h: 300, p: 'paquet' },
  { nom: 'fenêtre étroite, une devise décroche',   w: 400,  h: 300, p: 'fuyarde' },
  { nom: 'fenêtre étroite, quatre décrochent',     w: 400,  h: 300, p: 'ecrase' },
  { nom: 'carte de tableau de bord',               w: 600,  h: 300, p: 'fuyarde', survol: true },
  { nom: 'carte courte',                           w: 600,  h: 150, p: 'fuyarde' },
  { nom: 'carte très courte, fenêtre étroite',     w: 360,  h: 150, p: 'paquet' },
  { nom: 'carte très courte, une décroche',        w: 360,  h: 150, p: 'fuyarde' },
  { nom: 'bandeau large et bas',                   w: 1400, h: 200, p: 'fuyarde' },
  { nom: 'bandeau large et bas, quatre décrochent', w: 1400, h: 200, p: 'ecrase' },
  { nom: 'onglet du desk, pleine largeur',         w: 1150, h: 300, p: 'fuyarde' },
  { nom: 'onglet du desk, quatre décrochent',      w: 1150, h: 300, p: 'ecrase' },
  { nom: 'avec la valeur dans la pastille',        w: 600,  h: 300, p: 'fuyarde', o: { avecValeur: true } },
  { nom: 'thème clair',                            w: 600,  h: 300, p: 'fuyarde', t: 'light' },
  { nom: 'mode paire (EUR + AUD)',                 w: 600,  h: 300, p: 'fuyarde', o: { onlyCurrencies: ['EUR', 'AUD'] } },
];

module.exports = { JEUX, CAS, SONDE, SONDE_OPACITES, SONDE_POS_LEGENDE, serveur, trouverNavigateur, PORT, _regimes, _bornesPaquetReel };

if (require.main === module) {
  (async () => {
    const bin = trouverNavigateur();
    if (!bin) { console.log('\n[Force] aucun Chromium trouvé → contrôle abstenu (ce n\'est pas un échec).\n'); process.exit(0); }
    let puppeteer;
    try { puppeteer = require('puppeteer-core'); }
    catch { console.log('\n[Force] puppeteer-core absent → contrôle abstenu.\n'); process.exit(0); }

    const srv = serveur();
    await new Promise(r => srv.listen(PORT, r));
    let nav;
    try {
      nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      const mesures = [];
      for (const c of CAS) {
        const page = await nav.newPage();
        await page.setViewport({ width: c.w + 40, height: c.h + 80, deviceScaleFactor: 1 });
        await page.goto(`http://localhost:${PORT}/banc.html?w=${c.w}&h=${c.h}&p=${c.p}&t=${c.t || 'dark'}&o=${encodeURIComponent(JSON.stringify(c.o || {}))}`,
          { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
        await page.waitForFunction('window.__pret === true', { timeout: 20000 }).catch(() => {});
        const r = await page.evaluate(SONDE);
        r.survol = null;
        if (c.survol) {
          const pos = await page.evaluate(SONDE_POS_LEGENDE, 2);
          if (pos) {
            const avant = await page.evaluate(SONDE_OPACITES);
            await page.mouse.move(pos.x, pos.y); await new Promise(z => setTimeout(z, 250));
            const pendant = await page.evaluate(SONDE_OPACITES);
            await page.mouse.move(2, 2); await new Promise(z => setTimeout(z, 250));
            const apres = await page.evaluate(SONDE_OPACITES);
            r.survol = { dispo: true, ccy: pos.ccy, avant, pendant, apres };
          } else r.survol = { dispo: false, err: 'entrée de légende introuvable' };
        }
        mesures.push({ cas: c, r });
        await page.close();
      }
      if (mesures.every(m => (m.r.err || []).some(e => /amCharts absent/.test(e)))) {
        console.log('\n[Force] amCharts injoignable (CDN bloqué, pas de DTP_AM5_BUNDLE) → contrôle abstenu.\n');
        process.exit(0);
      }
      controler(mesures);
    } finally {
      if (nav) await nav.close();
      srv.close();
    }
    console.log('');
    if (ko) { console.log(`✗ ${ko} ÉCHEC(S) — ${ok} contrôle(s) OK, ${ko} KO\n`); process.exit(1); }
    console.log(`✓ TOUT PASSE — ${ok} contrôle(s) OK\n`);
  })();
}

function controler(mesures) {
  /* LE JEU D'ESSAI DOIT ATTEINDRE SON RÉGIME, SINON IL NE PROUVE RIEN. On rejoue le vrai
     `bornesPaquet` : « fuyarde » doit faire compresser le cadre ET laisser une devise dehors,
     « écrasé » doit au contraire faire RENONCER la règle. Le jour où ses seuils bougent, ce contrôle
     le dit au lieu de rester vert sans avoir rien éprouvé. */
  console.log('\n── Les jeux d\'essai atteignent-ils bien les régimes qu\'ils annoncent ? ──');
  const rg = _regimes();
  if (rg.erreur) { v('le vrai bornesPaquet est retrouvé dans charts.js', false, rg.erreur); }
  else {
    v('« séance ordinaire » : le cadre reste plein', rg.paquet && !rg.paquet.compresse, JSON.stringify(rg.paquet));
    v('« une devise décroche » : le cadre se resserre', rg.fuyarde && rg.fuyarde.compresse, JSON.stringify(rg.fuyarde));
    v('… et laisse bien une devise dehors', rg.fuyarde && rg.fuyarde.dehors === 1, JSON.stringify(rg.fuyarde));
    v('« quatre décrochent » : la règle renonce', rg.ecrase && !rg.ecrase.compresse, JSON.stringify(rg.ecrase));
  }

  console.log('\n── Force des Devises : les huit devises sont-elles lisibles ? ──');
  for (const { cas, r } of mesures) {
    const m = r.modele || {};
    const attendu = (cas.o && cas.o.onlyCurrencies) ? cas.o.onlyCurrencies.length : 8;
    console.log(`\n  · ${cas.nom} (${cas.w}×${cas.h})  —  ${r.nPastilles}/${attendu} pastille(s), cadre [${m.yMin}, ${m.yMax}], paquet ${m.partPaquet}% (${m.nDedans} dedans), écart min ${m.ecartMin} px, légende ${m.legendeH} px, tracé ${m.plotH} px`);
    if (process.env.DTP_FORCE_DEBUG) console.log('      fins : ' + (m.fins || []).join(' '));
    v('aucune erreur d\'exécution', (r.err || []).length === 0, (r.err || []).join(' | '));
    /* INVARIANT 1 — AUCUNE DEVISE MUETTE. C'est la demande, mot pour mot : « je ne vois pas toutes
       les informations ». Une devise dont la courbe sort du cadre garde sa pastille : c'est elle qui
       porte le nom et la valeur, donc l'information. */
    v('les huit devises ont leur pastille', r.nPastilles === attendu, r.nPastilles + '/' + attendu + ' — manque : ' + attendu);
    v('aucune pastille n\'en recouvre une autre', (r.heurtees || []).length === 0, (r.heurtees || []).join(' · '));
    v('aucune pastille ne sort du cadre', (r.debordent || []).length === 0, (r.debordent || []).join(' · '));
    /* INVARIANT 2 — LES COURBES OCCUPENT LA HAUTEUR. L'autre moitié de la demande : « je ne vois pas
       toutes les COURBES ». Mesuré avant correction : 0,7 px entre deux fins de courbe voisines, pour
       un trait de 1,3 px — deux courbes qui se touchent ne sont pas deux courbes.
       On ne mesure PAS un écart minimal entre voisines : deux devises qui finissent au même niveau
       finissent vraiment au même niveau, et aucun cadrage honnête ne les séparera. On mesure la BANDE
       occupée par l'ensemble de celles qui sont dans le cadre : c'est elle que le cadrage gouverne, et
       elle seule. Seuil à 55 % : en dessous, la moitié du graphique est du vide. */
    if (m.partPaquet != null && m.nDedans >= 4) {
      v('les courbes occupent la hauteur (≥ 55 %)', m.partPaquet >= 55, m.partPaquet + ' % de la hauteur pour ' + m.nDedans + ' devise(s) dans le cadre');
    }
    /* INVARIANT 3 — LA LÉGENDE NE MANGE PAS LE TRACÉ. À 400 px de large elle passe à DEUX lignes
       (mesuré : 28 px au lieu de 14) et prend 14 px sur les 300 du widget — soit 7 % du tracé, pour
       une information que les pastilles portent déjà à droite de chaque courbe. */
    v('la légende tient sur une ligne', (m.legendeH || 0) <= 16, m.legendeH + ' px de haut (une ligne = 14)');
    /* INVARIANT 4 — UNE PASTILLE NE MENT PAS SUR SA POSITION. Ramenée au bord du cadre, elle doit
       dire que la courbe continue au-delà : sans chevron, elle affirmerait que la devise finit pile
       sur le bord, ce qui serait faux d'autant que la devise s'est échappée. */
    if (m.nDedans != null && attendu > m.nDedans) {
      v('la devise hors cadre porte son chevron', (r.chevrons || []).length === attendu - m.nDedans,
        (r.chevrons || []).join(',') + ' — attendu ' + (attendu - m.nDedans));
    } else {
      v('aucun chevron quand tout est dans le cadre', (r.chevrons || []).length === 0, (r.chevrons || []).join(','));
    }
    /* INVARIANT 5 — AUCUNE GRADUATION TRANCHÉE. Pastilles et graduations partagent la gouttière ;
       la pastille est censée COUVRIR la graduation qui tombe à sa hauteur, pas la couper en deux.
       C'est ce bandeau de chiffres à moitié sorti qu'on voit sur la capture de l'utilisateur. */
    v('aucune graduation coupée par une pastille', (r.tranchees || []).length === 0, (r.tranchees || []).join(' · '));
    /* INVARIANT 6 — L'AXE X GARDE DES REPÈRES. Sous 500 px, la suite des pas sautait de 1 h à 3 h et
       il ne restait que deux heures lisibles sur toute la largeur : un mouvement ne se rattache plus
       à aucun moment. */
    v('l\'axe des heures garde au moins trois repères', (m.nEtiqX || 0) >= 3, m.nEtiqX + ' repère(s)');

    if (r.survol) {
      console.log('    — survol de la légende —');
      const sv = r.survol;
      if (!sv.dispo) { v('le survol met une courbe en avant', false, sv.err || 'mécanisme introuvable'); }
      else {
        const vise = sv.pendant.find(x => x.ccy === sv.ccy);
        const autres = sv.pendant.filter(x => x.ccy !== sv.ccy);
        v('avant survol, les huit courbes sont pleines', sv.avant.every(x => x.o >= 0.9), JSON.stringify(sv.avant));
        v('la devise visée reste pleine', vise && vise.o >= 0.9, JSON.stringify(vise));
        /* Elles s'effacent, elles ne DISPARAISSENT pas : garder le contexte est ce qui distingue une
           mise en avant d'un filtre. */
        v('les sept autres s\'effacent sans disparaître', autres.every(x => x.o > 0.05 && x.o < 0.3), JSON.stringify(autres.map(x => x.ccy + ':' + x.o)));
        v('quitter la légende rend le graphe entier', sv.apres.every(x => x.o >= 0.9), JSON.stringify(sv.apres));
      }
    }
  }

  /* ══ LES HUIT COULEURS SE VOIENT SUR LEUR FOND, DANS LES DEUX THÈMES ═══════════════════════════
     Calcul pur — pas besoin de navigateur, et c'est mieux ainsi : un contraste se prouve, il ne
     s'apprécie pas. Mesuré avant correction : sur le fond BLANC du thème clair, six des huit
     couleurs passaient sous 3:1, et l'USD — un blanc cassé — tombait à 1,21 : sa courbe était
     invisible. Le graphique promettait huit devises et en montrait deux ou trois. */
  console.log('\n── Les huit couleurs se voient-elles sur leur fond ? ──');
  const SRC = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
  const table = nom => {
    const d = SRC.indexOf('const ' + nom + ' = {');
    if (d < 0) return null;
    const f = SRC.indexOf('\n};', d);
    const o = {};
    for (const m of SRC.slice(d, f).matchAll(/(\w{3}):\s*(0x[0-9a-f]{6})/gi)) o[m[1]] = parseInt(m[2], 16);
    return Object.keys(o).length === 8 ? o : null;
  };
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = h => 0.2126 * lin((h >> 16) & 255) + 0.7152 * lin((h >> 8) & 255) + 0.0722 * lin(h & 255);
  const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const [nom, fond, quoi] of [['CS_COLORS', 0x0d0e11, 'thème sombre'], ['CS_COLORS_CLAIR', 0xffffff, 'thème clair']]) {
    const t = table(nom);
    if (!t) { v('la palette ' + nom + ' est retrouvée dans charts.js', false, 'huit devises attendues'); continue; }
    const faibles = Object.entries(t).filter(([, v2]) => contraste(v2, fond) < 3).map(([k, v2]) => k + ' ' + contraste(v2, fond).toFixed(2));
    v('les huit couleurs tiennent 3:1 en ' + quoi, faibles.length === 0, faibles.join(' · '));
  }
  const clair = table('CS_COLORS_CLAIR'), sombre = table('CS_COLORS');
  if (clair && sombre) v('les deux palettes nomment les mêmes devises',
    Object.keys(clair).sort().join() === Object.keys(sombre).sort().join(), Object.keys(clair).join());
  v('la couleur passe par un seul point de décision', /function _csCouleur\(ccy\) \{/.test(SRC) && !/CS_COLORS\[ccy\] \|\| 0x888888\)/.test(SRC.replace(/return t\[ccy\][^\n]*/, '')));
}

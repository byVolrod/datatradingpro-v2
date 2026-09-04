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
 *     ⚠️ ET CE N'A PAS SUFFI (02/09, troisième signalement du même manque) : rendre la PASTILLE
 *     d'une devise hors cadre ne rend pas sa COURBE, qui reste rognée par le masque du tracé.
 *     `bornesPaquet` exige donc désormais une PRÉSENCE — une devise doit passer plus de la moitié
 *     du temps dans le cadre pour qu'on accepte de la voir en sortir le reste.
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
     · « paquet »   : les huit dans la même bande. C'est le cas ordinaire d'une séance.
     · « fuyarde »  : une devise VIT AILLEURS toute la période. Depuis le 02/09 c'est le cas qui fait
       RENONCER le cadrage — la compresser dehors la rendrait invisible, ce que l'utilisateur est
       venu signaler (« on ne voit pas la courbe NZD »).
     · « echappee » : une devise reste dans le paquet, puis s'en va en fin de période. C'est le seul
       régime qui fasse encore compresser, et donc celui qui éprouve la pastille ramenée au bord.
     · « ecrase »   : QUATRE devises décrochent → `bornesPaquet` renonce (elle exige que 60 % des
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
/* `depart` (facultatif) : fraction de la fenêtre pendant laquelle une devise RESTE dans le paquet
   avant de s'en aller. Sans lui, toutes les rampes partent du premier point — ce qui ne produit que
   des devises « qui vivent ailleurs », jamais une devise qui décroche EN COURS de période. Depuis
   que le cadrage exige une PRÉSENCE (cf. `bornesPaquet`), les deux ne se comportent plus pareil :
   la première fait renoncer la compression, la seconde la déclenche. Il fallait donc pouvoir
   fabriquer les deux. */
function jeu(nPts, dtMs, fins, depart) {
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
    const dep = (depart && depart[c]) || 0;
    series[c] = bruit[c].map((n, k) => {
      const u = k / (nPts - 1);
      const w = dep ? Math.max(0, (u - dep) / (1 - dep)) : u;      // la rampe ne démarre qu'après `dep`
      return { t: t0 + k * dtMs, v: (fins[c] / 100) * w + (n - fin * u) };
    });
  });
  return { currencies: CCY, series };
}

/* Quatre régimes, et ce sont ceux que le widget rencontre en vrai :
     · paquet   — les huit dans la même bande. `bornesPaquet` ne compresse pas, elle n'a rien à faire.
     · fuyarde  — une devise vit ailleurs toute la période. `bornesPaquet` RENONCE depuis le 02/09 :
                  la compresser dehors la rendrait invisible (23 % de présence, mesuré).
     · echappee — une devise part en fin de période. `bornesPaquet` COMPRESSE et laisse sa fin
                  dehors : c'est là que sa pastille disparaissait, et c'est ce chemin-là qu'il faut
                  continuer d'éprouver.
     · écrasé   — QUATRE décrochent. `bornesPaquet` RENONCE (elle exige que 60 % des devises restent
                  dans le paquet) et les quatre du fond s'aplatissent. */
const JEUX = {
  paquet:  jeu(480, 60000,  { USD: 6.5, AUD: 6.0, GBP: 1.5, CAD: 1.2, JPY: -0.8, NZD: -1.5, EUR: -5.9, CHF: -7.2 }),
  fuyarde: jeu(1400, 300000, { USD: 42, AUD: 5.5, GBP: 1.6, CAD: 1.2, JPY: -0.9, NZD: -1.6, EUR: -5.4, CHF: -6.8 }),
  /* ÉCHAPPÉE TARDIVE (02/09) : l'USD reste dans le paquet les sept premiers dixièmes de la période,
     puis s'en va et finit dehors. C'est le SEUL des quatre régimes qui fasse encore compresser le
     cadre depuis que la présence est exigée — et c'est donc lui, désormais, qui éprouve la pastille
     ramenée au bord avec son chevron. Sans ce jeu, ce chemin de code ne serait plus emprunté par
     aucun contrôle et pourrait casser sans que rien ne le dise. Mesuré : présence de l'USD 75 %,
     compression active, fin hors cadre. */
  echappee: jeu(1400, 300000, { USD: 42, AUD: 5.5, GBP: 1.6, CAD: 1.2, JPY: -0.9, NZD: -1.6, EUR: -5.4, CHF: -6.8 }, { USD: 0.7 }),
  ecrase:  jeu(1400, 300000, { USD: 42, EUR: -38, JPY: 33, GBP: -31, AUD: 1.4, CHF: -1.2, CAD: 0.9, NZD: -1.6 }),
  /* ⚠️ LE « HIKE » : le pic monte TRÈS haut puis REVIENT dans le paquet (05/09, demande utilisateur
     « une vue d'ensemble à chaque fois que le prix fait des hikes hyper hauts »). C'est le régime
     que `bornesPaquet` ne peut pas voir : elle arbitre sur les valeurs de FIN, et cette fin-là est
     parfaitement rangée. Sans ce jeu, la condition « le cadre ne coupe jamais une courbe » ne serait
     éprouvée que sur des fuyardes, c'est-à-dire jamais sur le cas qui a motivé la demande. */
  hike:    (function () {
    const d = jeu(1400, 300000, { USD: 6.5, AUD: 6.0, GBP: 1.5, CAD: 1.2, JPY: 2.0, NZD: -1.5, EUR: -5.9, CHF: -7.2 });
    const se = d.series.JPY, n = se.length, a = Math.floor(n * 0.45), b = Math.floor(n * 0.72);
    for (let k = a; k < b; k++) {
      const t = (k - a) / (b - a);                                    // 0 → 1 → 0, un pic puis le retour
      se[k].v += 0.60 * Math.sin(Math.PI * t);
    }
    return d;
  })(),
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
    /* La PRÉSENCE de la devise la moins présente : c'est la grandeur sur laquelle la règle décide
       désormais, donc celle qu'il faut relever pour dire si un jeu atteint son régime. */
    let presMin = 1;
    if (b) CCY.forEach(c => {
      const se = d.series[c] || []; if (se.length < 20) return;
      const dedansN = se.filter(x => x.v != null && x.v * 100 >= b.min && x.v * 100 <= b.max).length;
      if (dedansN / se.length < presMin) presMin = dedansN / se.length;
    });
    out[nom] = { compresse: !!b, cadre: b ? [+b.min.toFixed(1), +b.max.toFixed(1)] : null,
      dehors: b ? fins.filter(v => v < b.min || v > b.max).length : 0,
      presenceMin: b ? Math.round(presMin * 100) : null };
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
      /* ⚠️ COMBIEN DE POINTS SONT COUPÉS PAR LE CADRE ? La mesure de « je ne vois pas la courbe
         JPY ». On compte les points de séries VISIBLES qui tombent hors des bornes, et on nomme les
         devises concernées — « il en manque » ne se corrige pas, « JPY est coupée » si. */
      const coupees = {};
      let ptsHors = 0;
      vues.forEach(s => s.data.values.forEach(d => {
        if (d.v == null || min == null || max == null) return;
        if (d.v < min || d.v > max) { ptsHors++; coupees[s.get('name')] = (coupees[s.get('name')] || 0) + 1; }
      }));
      let nEtiqX = 0;
      try { xAx.get('renderer').labels.each(l => { if (l && !l.get('forceHidden') && l.get('visible') !== false) nEtiqX++; }); } catch (e) {}
      /* Repères de l'axe des VALEURS réellement lisibles : ceux qu'amCharts fabrique MOINS ceux que
         la règle « une pastille masque sa graduation » a effacés. C'est ce nombre-là qui dit si
         l'échelle se lit ; compter les data items donnerait « sept » là où l'écran en montre quatre.
         ⚠️ RELEVÉ AU JOURNAL, PAS ÉRIGÉ EN CONTRÔLE, ET C'EST DÉLIBÉRÉ. J'ai voulu resserrer
         `minGridDistance` pour densifier l'échelle : sur une sonde à 371 px de tracé, on passait de
         4 repères lisibles à 10. Rejoué sur les QUINZE scénarios du banc, le gain disparaît — 3 à 5
         repères avant, 3 à 5 après, et un cas qui RECULE (6/8 → 3/8 sur un tracé de 155 px). Une
         amélioration qui ne se voit que sur la géométrie où on l'a cherchée n'en est pas une : le
         réglage a été retiré. Le relevé reste, pour que la prochaine tentative parte d'un chiffre. */
      let gradTotal = 0, gradVisibles = 0;
      try {
        yAx.dataItems.forEach(di => { const l = di.get('label'); if (!l) return; gradTotal++;
          if (!l.get('forceHidden') && l.get('visible') !== false) gradVisibles++; });
      } catch (e) {}
      m = { dispo: true, plotH: Math.round(h), plotW: Math.round(pc.width()), partPaquet, nDedans: dedans.length, nEtiqX,
        gradTotal, gradVisibles,
        legendeH: lg ? Math.round(lg.height()) : 0, legendeW: lg ? Math.round(lg.width()) : 0,
        gouttiere: Math.round(yAx.width()),
        yMin: min == null ? null : +min.toFixed(2), yMax: max == null ? null : +max.toFixed(2),
        ptsHors, coupees: Object.keys(coupees).map(c => c + ':' + coupees[c]),
        ecartMin: ecarts.length ? Math.min(...ecarts) : null, ecarts,
        fins: fins.map(f => f.ccy + ':' + f.v.toFixed(1)) };
    }
  } catch (e) { m = { dispo: false, err: String(e && e.message) }; }
  // Une pastille dont la courbe sort du cadre porte un chevron : sans lui, elle prétendrait que la
  // devise finit pile au bord.
  const chevrons = [...document.querySelectorAll('.cs-badge--hors')].map(e => (e.textContent || '').replace(/[^A-Z]/g, ''));
  /* Quelles devises portent RÉELLEMENT une pastille ? On croise avec la légende, seule liste sûre
     des devises affichées : compter les pastilles dit qu'il en manque une, les nommer dit laquelle. */
  const pastillesManquantes = (() => {
    try {
      const leg = [...document.querySelectorAll('.cs-legend-item, .cs-leg-item, .am5-legend-label')]
        .map(e => (e.textContent || '').trim().toUpperCase()).filter(t => /^[A-Z]{3}$/.test(t));
      /* ⚠️ SEULEMENT LES PASTILLES VISIBLES, exactement comme `nPastilles`. Ma première version
         comptait TOUTES celles du DOM : or le défaut consiste précisément à laisser une pastille
         vivante dans le document avec son conteneur en `display: none`. La sonde ne trouvait donc
         aucune absente et rendait « (non identifiée) », pendant que le contrôle, lui, en comptait
         sept sur huit. Deux mesures du même objet qui se contredisent, c'est la sonde qui a tort. */
      const vues = new Set([...document.querySelectorAll('.cs-badge')].filter(visible)
        .map(e => (e.textContent || '').replace(/[^A-Z]/g, '')).filter(Boolean));
      const src = leg.length ? leg : ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CHF', 'CAD', 'NZD'];
      return src.filter(c => !vues.has(c));
    } catch (e) { return []; }
  })();

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
    heurtees: paires, debordent, chevrons, pastillesManquantes, tranchees, modele: m, err: window.__err.slice(0, 4) };
};

/* LE SURVOL MET UNE COURBE EN AVANT. On ne simule pas un vrai pointeur (headless, canvas) : on
   appelle le mécanisme là où le produit l'appelle — l'événement de la légende — et on lit l'opacité
   RÉELLE des huit tracés. Ce qu'on vérifie est le résultat visible, pas qu'une fonction a été
   appelée. */
/* LA GRILLE DE FOND, LUE DANS L'OBJET RENDU (31/08 : « ajoute aussi la même grille en fond des
   courbes »). Elle existait à 0,2 d'opacité : présente dans le code, invisible à l'écran. Une
   grille sert à SITUER — à quelle heure, à quel niveau — et une grille qu'on ne voit pas ne situe
   rien. On interroge donc les DEUX axes du vrai graphique : opacité effective, et surtout MÊME
   style des deux côtés (la verticale était figée en gris sombre pendant que l'horizontale suivait
   le thème : sur le thème clair, un quadrillage à moitié peint). */
const SONDE_GRILLE = () => {
  try {
    const root = (window.am5 && am5.registry && am5.registry.rootElements || []).find(r => r && r.dom && r.dom.id === 'g');
    const chart = root && root.container.children.values.find(c => c.className === 'XYChart');
    if (!chart) return null;
    const lire = ax => { const g = ax.get('renderer').grid.template;
      return { op: +g.get('strokeOpacity'), w: +(g.get('strokeWidth') || 1),
        tirets: JSON.stringify(g.get('strokeDasharray') || []), col: String(g.get('stroke')) }; };
    return { x: lire(chart.xAxes.getIndex(0)), y: lire(chart.yAxes.getIndex(0)) };
  } catch (e) { return null; }
};

const SONDE_OPACITES = () => {
  try {
    const root = (window.am5 && am5.registry && am5.registry.rootElements || []).find(r => r && r.dom && r.dom.id === 'g');
    const chart = root && root.container.children.values.find(c => c.className === 'XYChart');
    if (!chart) return null;
    return chart.series.values.map(s => ({ ccy: s.get('name'), o: +(s.strokes.template.get('strokeOpacity')) }));
  } catch (e) { return null; }
};
/* OÙ POSER LA SOURIS. La légende est dessinée dans le canvas, elle n'a pas de boîte DOM : on
   demande à amCharts la position de l'entrée visée et on la ramène en coordonnées de page, pour y
   déplacer un VRAI pointeur.
   ⚠️ CE QUE CETTE SONDE ÉPROUVE A CHANGÉ DE SIGNE LE 30/08. Elle servait à prouver que le survol
   mettait une courbe en avant ; elle prouve maintenant qu'il n'en met AUCUNE. « Quand je glisse mon
   curseur sur une courbe ça cache les autres, enlève ça » — dans ce panneau on compare les huit
   devises, et le curseur se promène en permanence sur le tracé : l'effacement se déclenchait donc
   tout le temps, sans être demandé. La sonde reste, retournée : c'est elle qui empêchera de le
   remettre par inadvertance. */
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

/* LE TRACÉ, et pas seulement la légende : c'est là que le curseur se promène (« quand je GLISSE mon
   curseur sur une courbe »). On vise le milieu du tracé, à la hauteur de la courbe la plus centrale
   — l'endroit exact où le curseur accrochait une série et estompait les sept autres. */
const SONDE_POS_TRACE = () => {
  try {
    const root = (window.am5 && am5.registry && am5.registry.rootElements || []).find(r => r && r.dom && r.dom.id === 'g');
    const chart = root && root.container.children.values.find(c => c.className === 'XYChart');
    if (!chart) return null;
    const cv = document.querySelector('#g canvas'); const cr = cv.getBoundingClientRect();
    const ech = cr.height / root.container.height();
    const pc = chart.plotContainer;
    const g = pc.toGlobal({ x: pc.width() / 2, y: pc.height() / 2 });
    return { x: cr.x + g.x * ech, y: cr.y + g.y * ech };
  } catch (e) { return null; }
};

/* LA MATRICE. Ce n'est pas une liste de tailles jolies : chaque ligne reproduit un état RÉEL du
   produit. 400 px de large = la fenêtre étroite de la capture (sous 560 px, le widget bascule dans
   son rendu compact). 150 px de haut = la carte la plus courte du tableau de bord. */
const CAS = [
  { nom: 'fenêtre étroite, séance ordinaire',      w: 400,  h: 300, p: 'paquet' },
  { nom: 'fenêtre étroite, une devise décroche',   w: 400,  h: 300, p: 'fuyarde' },
  { nom: 'fenêtre étroite, quatre décrochent',     w: 400,  h: 300, p: 'ecrase' },
  { nom: 'carte de tableau de bord',               w: 600,  h: 300, p: 'echappee', survol: true },
  { nom: 'carte courte',                           w: 600,  h: 150, p: 'fuyarde' },
  { nom: 'carte très courte, fenêtre étroite',     w: 360,  h: 150, p: 'paquet' },
  { nom: 'carte très courte, une décroche',        w: 360,  h: 150, p: 'fuyarde' },
  { nom: 'bandeau large et bas',                   w: 1400, h: 200, p: 'fuyarde' },
  { nom: 'bandeau large et bas, quatre décrochent', w: 1400, h: 200, p: 'ecrase' },
  { nom: 'onglet du desk, pleine largeur',         w: 1150, h: 300, p: 'echappee' },
  { nom: 'onglet du desk, quatre décrochent',      w: 1150, h: 300, p: 'ecrase' },
  { nom: 'avec la valeur dans la pastille',        w: 600,  h: 300, p: 'echappee', o: { avecValeur: true } },
  /* Une carte HAUTE : aucun autre scénario ne dépasse 255 px de tracé, et c'est au-delà que
     l'échelle verticale a de la place pour ses repères. Le relevé « échelle X/Y » du journal se lit
     ici. */
  { nom: 'carte haute',                            w: 900,  h: 480, p: 'echappee' },
  { nom: 'thème clair',                            w: 600,  h: 300, p: 'fuyarde', t: 'light' },
  { nom: 'mode paire (EUR + AUD)',                 w: 600,  h: 300, p: 'fuyarde', o: { onlyCurrencies: ['EUR', 'AUD'] } },
  /* Le régime du 05/09 : un pic qui monte très haut PUIS revient dans le paquet. Deux géométries,
     parce que le cadrage dépend de la hauteur disponible. */
  { nom: 'un pic hyper haut qui redescend',        w: 950,  h: 480, p: 'hike' },
  { nom: 'un pic hyper haut, carte courte',        w: 600,  h: 200, p: 'hike' },
];

module.exports = { JEUX, CAS, SONDE, SONDE_GRILLE, SONDE_OPACITES, SONDE_POS_LEGENDE, SONDE_POS_TRACE, serveur, trouverNavigateur, PORT, _regimes, _bornesPaquetReel };

/* ══ LE RAFRAÎCHISSEMENT NE SE VOIT PAS ══════════════════════════════════════════════════════════
   01/09, demande utilisateur : « parfois le widget Force de la devise se refresh tout seul :
   l'affichage disparaît, ça recharge, puis les courbes réapparaissent. Évite complètement ce
   rechargement visuel. »
   CAUSE RACINE, lue dans le code : le minuteur de 60 s de la carte appelait `dessine()`, soit
   `disposeRoot` puis `buildIsolatedStrength` — laquelle ÉCRIT UN LOADER dans le cadre avant même de
   lancer sa requête. Chaque minute, le graphe était donc détruit, remplacé par « Chargement… »,
   puis rebâti de zéro. Le commentaire du minuteur annonçait pourtant l'inverse (« sans remonter la
   carte… ce qui ferait clignoter l'écran ») : il décrivait l'intention, pas le code.
   CE CONTRÔLE EST STATIQUE ET SANS NAVIGATEUR, donc il tourne TOUJOURS — y compris sur un poste
   sans Chromium, là où la partie visuelle ci-dessous s'abstient. Il lit le VRAI widgets.js. */
function _rafraichissementSilencieux() {
  console.log('\n── Le rafraîchissement de la carte ne détruit plus le graphe ──');
  const W = fs.readFileSync(path.join(PUB, 'js/widgets.js'), 'utf8');
  const i = W.indexOf("id: 'force-devises'");
  const mount = i < 0 ? '' : W.slice(i, W.indexOf("id: 'barometre'", i));
  v('la carte « Force des Devises » est retrouvée dans widgets.js', !!mount.length);
  if (!mount.length) return;
  const tic = (mount.match(/setInterval\(function \(\) \{[\s\S]{0,700}?\}, 60 \* 1000\)/) || [''])[0];
  v('son minuteur de 60 s est retrouvé', !!tic);
  v('le tour de minuteur ne RECONSTRUIT plus (plus d\'appel à `dessine`)',
    !!tic && !/\bdessine\(/.test(tic), tic.slice(0, 160));
  v('… il met à jour EN PLACE (`rafraichir`)', !!tic && /\brafraichir\(/.test(tic), tic.slice(0, 160));
  const raf = (mount.match(/function rafraichir\(p\) \{[\s\S]*?\n        \}/) || [''])[0];
  v('`rafraichir` existe', !!raf);
  v('… et passe les données au contrôleur vivant, sans rien détruire',
    !!raf && /ctl\.update\(d\)/.test(raf) && !/disposeRoot/.test(raf) && !/buildIsolatedStrength/.test(raf),
    raf.slice(0, 200));
  /* Le repli reste indispensable : sans graphe vivant (premier rendu, échec précédent, période
     changée), il FAUT reconstruire — sinon la carte resterait vide pour toujours. */
  v('… mais il reconstruit quand il n\'y a pas de graphe vivant à mettre à jour',
    !!raf && /if \(!ctl \|\| !ctl\.update \|\| p !== perCourante\) \{ dessine\(p\); return; \}/.test(raf), raf.slice(0, 200));
  /* Une réponse vide ou hors-sujet ne doit RIEN écraser : garder la dernière courbe valide à
     l'écran vaut mieux que la remplacer par une erreur — c'est le même principe que le repli. */
  v('… et ne touche à rien si la réponse est inexploitable ou la période a changé',
    !!raf && /if \(!d \|\| !d\.currencies \|\| p !== perCourante/.test(raf), raf.slice(0, 260));
  /* Le contrôleur ne peut être gardé que si le constructeur le rend : `buildIsolatedStrength` est
     asynchrone, donc la carte doit attendre sa promesse. Sans ça, `ctl` resterait nul et chaque
     tour retomberait sur la reconstruction — le banc serait vert et le clignotement intact. */
  v('le contrôleur est bien récupéré à la construction (promesse attendue)',
    /r\.then\(function \(c\) \{ if \(perCourante === p\) ctl = c \|\| null; \}\)/.test(mount),
    (mount.match(/.{0,80}buildIsolatedStrength\(id.{0,160}/) || [''])[0]);
  const CH = fs.readFileSync(path.join(PUB, 'js/charts.js'), 'utf8');
  v('… et `buildStrengthChart` le rend toujours, avec sa mise à jour en place',
    /return \{ root, seriesMap, update \};/.test(CH));
}

/* ══ LA PASTILLE SE RATTACHE À SA COURBE ═════════════════════════════════════════════════════════
   01/09, demande utilisateur sur capture : « il faut aligner les courbes à leurs devises qu'on
   puisse bien comprendre… sans que ça désordonne quoi que ce soit ».
   Quand huit devises finissent dans un mouchoir, l'anti-collision écarte les pastilles : elles
   forment alors une colonne régulière qui ne suit plus le bout des courbes. Un filet vertical les
   reliait déjà — mais il s'arrêtait dans le vide, au milieu de sept autres traits de la même
   largeur. On lui donne un POINT D'ARRIVÉE, à la fin réelle de la courbe.
   LA CONTRAINTE EST AUSSI IMPORTANTE QUE L'AJOUT : rien ne doit bouger. Ce contrôle éprouve donc
   les deux — le point existe, et le placement n'a pas été touché. Statique, sans navigateur : la
   partie visuelle s'abstient ici (amCharts vient d'un CDN injoignable). */
function _rattacherPastilles() {
  console.log('\n── La pastille se rattache au bout de sa courbe ──');
  const CH = fs.readFileSync(path.join(PUB, 'js/charts.js'), 'utf8');
  const CSS = fs.readFileSync(path.join(PUB, 'css/style.css'), 'utf8');
  const src = (CH.match(/function _csBadgeHtml\([\s\S]*?\n\}/) || [''])[0];
  v('`_csBadgeHtml` est retrouvée dans charts.js', !!src);
  if (!src) return;
  /* On EXÉCUTE la fabrique plutôt que de lire son texte : c'est le HTML rendu qui compte. */
  let f = null;
  try { f = new Function('_csTexteSur', 'return ' + src.replace(/^function /, 'function ') + ';')(() => '#000'); } catch (e) { v('… et elle s\'évalue', false, e.message); return; }
  v('… et elle s\'évalue', !!f);
  /* ⚠️ CINQ ARGUMENTS, PLUS SIX (02/09). La teinte éclaircie a quitté la signature avec le second
     pavé qu'elle servait. Ces trois appels passaient encore l'ancienne liste : la couleur claire
     tombait alors dans `valStr`, le décalage dans `dy`, et le banc éprouvait une pastille qui
     n'existe nulle part — en rougissant sur le filet, c'est-à-dire loin de la cause. Un banc qui
     appelle le produit doit suivre le produit. */
  const ecarte = f('USD', '#ffffff', '', 34, 0);     // pastille poussée VERS LE BAS
  const remonte = f('NZD', '#ff3d00', '', -21, 0);   // pastille remontée
  const pile = f('EUR', '#e3b23a', '', 0, 0);        // pastille pile sur sa courbe
  v('une pastille écartée porte son filet', /class="cs-link"/.test(ecarte) && /height:34px/.test(ecarte), ecarte);
  v('… et le filet porte un point d\'arrivée, dans la couleur de la devise',
    /<b style="background:#ffffff"><\/b>/.test(ecarte), ecarte);
  v('une pastille REMONTÉE tourne son filet vers le bas', /class="cs-link cs-link--bas"/.test(remonte) && /height:21px/.test(remonte), remonte);
  v('… avec son point à l\'autre bout, lui aussi', /cs-link--bas[^>]*>\s*<b /.test(remonte), remonte);
  /* Pile sur sa courbe, il n'y a RIEN à relier : un point posé là serait un artefact sur le tracé. */
  v('une pastille pile sur sa courbe n\'a ni filet ni point', !/cs-link/.test(pile) && !/<b /.test(pile), pile);
  /* Le point ne doit occuper AUCUNE place : il est absolu dans un filet lui-même absolu. */
  v('le point est en position absolue (il ne pousse rien)', /\.cs-link b \{[^}]*position: absolute/.test(CSS),
    (CSS.match(/\.cs-link b \{[^}]*\}/) || [''])[0]);
  v('… rond, et posé à l\'extrémité du filet', /\.cs-link b \{[^}]*border-radius: 50%/.test(CSS) && /\.cs-link--bas b \{[^}]*bottom:/.test(CSS));
  /* ⚠️ MESURÉ AU RENDU (le badge est du HTML/CSS pur, donc rendable sans amCharts) : avec huit
     devises, les huit filets courent dans la MÊME colonne de pixels et se recouvraient en une seule
     bande opaque — la CHF disparaissait derrière la NZD. Le trait est donc devenu FIN et DISCRET,
     et c'est le POINT qui porte l'information : c'est lui qui marque la fin de la courbe, et son
     halo dans la couleur du fond le détache de ses voisins quand deux devises finissent collées.
     Inverser ce rapport (trait épais, point discret) ramènerait la bande illisible. */
  v('le filet est fin et discret : c\'est le point qui porte l\'information',
    /\.cs-link \{[^}]*width: 1px/.test(CSS) && /\.cs-link \{[^}]*opacity: \.5/.test(CSS),
    (CSS.match(/\.cs-link \{[^}]*\}/) || [''])[0]);
  v('… et le point se détache de ses voisins par un halo au fond du panneau',
    /\.cs-link b \{[^}]*box-shadow: 0 0 0 1\.5px var\(--bg/.test(CSS),
    (CSS.match(/\.cs-link b \{[^}]*\}/) || [''])[0]);
  /* ⚠️ L'ÉCART EST LE MINIMUM, ET RIEN DE PLUS (02/09, seconde demande sur ce même sujet, référence
     à l'appui : « c'est pas aligné, ça fait pas pro du tout, regarde la 2ème image comme c'est bien
     aligné »). Un « écart de confort » (HB + 8) s'ajoutait dès qu'un paquet dépassait deux
     étiquettes : 25 px de pas là où 19 suffisent, soit SIX pixels d'écartement artificiel par
     étiquette et plus de quarante pixels de dérive cumulée sur huit devises. Chacune s'éloignait de
     sa courbe pour une raison qui n'était PAS la donnée.
     ⚠️ CE CONTRÔLE A CHANGÉ DE SENS, ET C'EST VOULU. Il exigeait auparavant que les constantes de
     placement ne bougent PAS — c'était la contrainte de la demande précédente (« sans que ça
     désordonne quoi que ce soit »). La contrainte a changé parce que l'utilisateur l'a changée : il
     veut désormais l'alignement de la référence, où la position de l'étiquette EST la donnée. On
     éprouve donc l'inverse : plus aucun écart de confort ne peut revenir. */
  v('l\'écartement de confort a disparu (plus de `pasConf`)', !/pasConf/.test(CH),
    (CH.match(/.{0,60}pasConf.{0,40}/) || [''])[0]);
  v('… l\'écart vaut le MINIMUM qui évite le recouvrement, borné par la place',
    /const gapFor = \(\) => Math\.min\(GMAX, pasMin\);/.test(CH),
    (CH.match(/const gapFor[^\n]*/) || [''])[0]);
  /* Le minimum, lui, reste la hauteur réelle de la pastille + 2 px de garde : descendre en dessous
     autoriserait le recouvrement par construction, ce que le 29/08 avait déjà mesuré et corrigé. */
  v('… et ce minimum reste la hauteur mesurée de la pastille + 2 px', /const pasMin  = HB \+ 2;/.test(CH));
  /* ⚠️ CE CONTRÔLE CHANGE DE VALEUR LE 02/09, ET C'EST LE POINT DE LA DEMANDE. « Valeur sur les
     étiquettes » doit rendre une pastille portant le SEUL nombre, dans la couleur pleine de la
     courbe (capture de référence de l'utilisateur). Elle en portait deux, code puis valeur, d'où
     une colonne de 70 px. Un pavé unique tient dans 51,5 px mesurés : la colonne descend à 58 et
     rend douze pixels au tracé. */
  v('la colonne « valeur » est dimensionnée pour UN pavé, pas deux',
    /_avecValeur \? \(_csEtroit \? 70 : 58\) : \(_csEtroit \? 56 : 50\)/.test(CH),
    (CH.match(/_avecValeur \? \([^\n]*/) || [''])[0]);

  /* ══ « VALEUR SUR LES ÉTIQUETTES » : LA VALEUR REMPLACE LE CODE (02/09) ═════════════════════════
     Le réglage, sa classe CSS et le commentaire du widget décrivaient tous les trois la valeur
     SEULE ; `_csBadgeHtml` rendait code + valeur. Trois écrits d'accord entre eux, une
     implémentation qui faisait autre chose — et personne pour s'en apercevoir, faute d'un contrôle
     qui REGARDE le HTML rendu quand le réglage est coché. Le voici. */
  const avecVal = f('NZD', '#ff4081', '49,39', 0, 0);
  const sansVal = f('NZD', '#ff4081', '', 0, 0);
  v('coché : la pastille porte la VALEUR, dans la couleur pleine de la courbe',
    /cs-badge-val--seul/.test(avecVal) && /49,39/.test(avecVal) && /background:#ff4081/.test(avecVal), avecVal);
  v('… et elle NE porte PLUS le code de la devise', !/cs-badge-ccy/.test(avecVal) && !/>NZD</.test(avecVal), avecVal);
  v('décoché : on retrouve la pastille de code, inchangée',
    /cs-badge-ccy/.test(sansVal) && />NZD</.test(sansVal) && !/cs-badge-val/.test(sansVal), sansVal);
  /* Le chevron « au-delà du cadre » qualifie la pastille quelle que soit sa forme : le perdre sur la
     pastille-valeur ferait croire qu'une devise finit pile au bord du cadre. */
  v('le chevron « au-delà du cadre » survit à la pastille-valeur',
    /cs-badge-hors/.test(f('NZD', '#ff4081', '49,39', 0, -1)));
  /* Un nombre n'a pas de largeur fixe : sans plancher, la colonne part en escalier. Les valeurs sont
     relevées au rendu (cf. la note de `.cs-badge-val--seul` dans la feuille), pas calculées. */
  v('la pastille-valeur a un plancher de largeur, comme celle de code',
    /\.cs-badge-val--seul \{[^}]*min-width: 5em/.test(CSS)
    && /\.cs-dense \.cs-badge-val--seul \{[^}]*min-width: 4\.2em/.test(CSS),
    (CSS.match(/\.cs-badge-val--seul \{[^}]*\}/) || [''])[0]);

  /* ══ ET LA VALEUR EST LE DÉFAUT (04/09, demande utilisateur, capture de référence) ══════════════
     « Met comme la 2e image pour la colonne là où il y a les étiquettes, tu vois, le nombre. » Le
     terminal de référence range huit NOMBRES au bout de ses huit courbes ; le desk rangeait huit
     CODES — l'information la moins utile des deux, puisque le code est déjà dans la légende du
     haut, en permanence et avec sa teinte. Le réglage reste, il est coché par défaut.
     ⚠️ `!== false` ET NON `!!` : un appelant muet doit recevoir la valeur, un appelant qui écrit
     `false` doit recevoir le code. Écrit `!!opts.avecValeur`, le défaut serait resté le code et ce
     banc aurait vu passer un réglage « par défaut » qui ne l'était pas. */
  v('l\'étiquette porte la valeur SANS qu\'on la demande',
    /const _avecValeur = opts\.avecValeur !== false;/.test(CH),
    (CH.match(/const _avecValeur = [^\n]*/) || [''])[0]);
  const WG = fs.readFileSync(path.join(__dirname, '..', 'public/js/widgets.js'), 'utf8');
  v('… et le réglage du widget est coché par défaut, pas seulement le code',
    /\{ k: 'valeurs', lbl: 'Valeur sur les étiquettes', type: 'bascule', def: true \}/.test(WG),
    'un défaut de code et un réglage décoché se contrediraient');

  /* ══ LES DEVISES DÉCOCHÉES SE MÉMORISENT (04/09, demande utilisateur) ═══════════════════════════
     « Quand l'utilisateur décoche certaines devises et qu'il change d'onglet puis revient, ça doit
     mémoriser. » Le magasin est `DTPPref` : compte d'abord, `localStorage` en cache — le choix suit
     donc l'utilisateur d'un appareil à l'autre, comme les autres réglages d'affichage. */
  v('le masquage d\'une devise est écrit dans le magasin de compte',
    /DTPPref\.set\(_CS_MEMO_KEY/.test(CH) && /DTPPref\.get\(_CS_MEMO_KEY/.test(CH));
  v('… et rejoué au montage suivant (courbe masquée d\'emblée)',
    /if \(_memoOff && _memoOff\.has\(ccy\)\) \{ try \{ series\.hide\(0\); \} catch \{\} \}/.test(CH));
  /* ⚠️ `appear` RÉ-AFFICHE CE QU'ON VIENT DE MASQUER — le piège est déjà connu du mode « paire »,
     et il se rejoue à l'identique ici. Sans cette exclusion, la devise décochée réapparaissait au
     bout de l'animation d'entrée : la mémoire aurait eu l'air de ne pas fonctionner. */
  v('… sans que l\'animation d\'apparition ne la ressuscite',
    /if \(_memoOff && _memoOff\.has\(s\.get\('name'\)\)\) return;/.test(CH));
  /* On n'écrit que sur un CLIC : nos propres masquages de restauration ne doivent pas se réécrire. */
  v('la mémoire ne s\'écrit qu\'après la construction (jamais sur sa propre restauration)',
    /let _memoActif = false;/.test(CH) && /_memoActif = true;/.test(CH)
    && /if \(_memoOff && _memoActif\) _csMemoEcris/.test(CH));
  /* Un rapport ou un courriel ne peut pas dépendre de qui le lit : la mémoire est réservée au
     panneau principal. */
  v('un graphique isolé, en focus ou en mode paire n\'hérite JAMAIS de cette mémoire',
    /const _memoOff = \(!opts\.isolated && !opts\.focusCurrency && !\(Array\.isArray\(opts\.onlyCurrencies\) && opts\.onlyCurrencies\.length\)\)/.test(CH),
    (CH.match(/const _memoOff = [^\n]*/) || [''])[0]);
}

function _densiteEtIntegrite() {
  /* ══ LA DENSITÉ DE TRACÉ, ET CE QU'ELLE COÛTE À LA LECTURE (02/09) ═══════════════════════════════
     « Les courbes sont très irrégulières… sur PMT elles sont beaucoup plus fluides » — et, dans la
     même demande, « ne cherche pas simplement à lisser artificiellement les données ».
     « Fluide » se mesure. Sur une série tracée dans un cadre donné : la DENSITÉ (points par pixel de
     largeur) et le nombre de CHANGEMENTS DE SENS pour 100 px. Au-delà d'un point par colonne de
     pixels, chaque colonne reçoit deux valeurs : le trait ne dessine plus une courbe mais une bande
     de bruit. La référence tient ~0,55 point par pixel ; notre TW montait à 1,6.
     `_csLTTB` ramène la densité à celle de la référence en NE GARDANT QUE DES POINTS RÉELS. Ce banc
     rejoue la VRAIE fonction de charts.js, et il vérifie les deux choses qui comptent : le rendu
     est-il devenu lisible, ET la donnée est-elle restée intacte. Le second contrôle est le plus
     important : c'est lui qui distingue ce qu'on fait d'un lissage. */
  console.log('\n── La densité de tracé, et l\'intégrité de la donnée ──');
  {
    const src = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
    const d = src.indexOf('  function _csLTTB(pts, cible) {');
    const f = src.indexOf('\n  }\n', d);
    let LTTB = null;
    try { if (d >= 0) LTTB = new Function(src.slice(d, f + 4) + '\nreturn _csLTTB;')(); } catch (e) { LTTB = null; }
    v('`_csLTTB` est retrouvée dans charts.js et s\'évalue', typeof LTTB === 'function');
    const cible = String(src.match(/CS_PT_PAR_PX\s*=\s*([0-9.]+)/) ? RegExp.$1 : '');
    v('la densité visée est celle mesurée sur la référence (0,55 pt/px)', cible === '0.55', 'lu : ' + cible);
    if (LTTB) {
      // Série réaliste, graine fixe : un banc ne dépend pas du hasard.
      let g = 7; const r = () => (g = (g * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const brut = []; let val = 0, vit = 0;
      for (let i = 0; i < 1416; i++) { vit = vit * 0.92 + (r() - 0.5) * 0.9; val += vit + Math.sin(i / 240) * 0.35; brut.push({ t: i * 60000, v: val + (r() - 0.5) * 1.2 }); }
      const W = 880, but = Math.max(60, Math.round(W * 0.55));
      const red = LTTB(brut, but);
      const dents = (pts) => {
        const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
        let lo = Infinity, hi = -Infinity; pts.forEach(p => { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; });
        const py = p => 300 - (p.v - lo) / (hi - lo) * 300;
        let n = 0, sens = 0;
        for (let i = 1; i < pts.length; i++) { const sn = Math.sign(py(pts[i]) - py(pts[i - 1])); if (sn && sens && sn !== sens) n++; if (sn) sens = sn; }
        return +(n / W * 100).toFixed(1);
      };
      const dAvant = dents(brut), dApres = dents(red);
      console.log('  · ' + brut.length + ' points sur ' + W + ' px (' + (brut.length / W).toFixed(2) + ' pt/px, '
        + dAvant + ' changements de sens/100 px) → ' + red.length + ' points ('
        + (red.length / W).toFixed(2) + ' pt/px, ' + dApres + ')');
      v('la densité tracée descend à celle de la référence', Math.abs(red.length / W - 0.55) < 0.05,
        (red.length / W).toFixed(2) + ' pt/px');
      v('… et la courbe cesse d\'être une bande de bruit', dApres < dAvant * 0.6, dAvant + ' → ' + dApres + ' changements de sens/100 px');
      /* ⚠️ LES TROIS CONTRÔLES QUI SUIVENT SONT LES PLUS IMPORTANTS DU LOT. Ils disent que ce n'est
         PAS un lissage : aucun point calculé, les extrêmes tenus, et la dernière valeur — celle que
         lit l'étiquette de droite et que le trader relève — rigoureusement identique. */
      const cle = new Set(brut.map(p => p.t + '|' + p.v));
      const inventes = red.filter(p => !cle.has(p.t + '|' + p.v)).length;
      v('aucun point n\'est calculé, moyenné ni inventé', inventes === 0, inventes + ' point(s) absent(s) de la série servie');
      const ex = (pts) => { let lo = Infinity, hi = -Infinity; pts.forEach(p => { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }); return [lo, hi]; };
      const a = ex(brut), b = ex(red), amp = a[1] - a[0];
      v('les extrêmes de la courbe sont conservés', Math.abs(a[0] - b[0]) < amp * 0.01 && Math.abs(a[1] - b[1]) < amp * 0.01,
        'avant [' + a[0].toFixed(1) + ' ; ' + a[1].toFixed(1) + '] · après [' + b[0].toFixed(1) + ' ; ' + b[1].toFixed(1) + ']');
      v('la DERNIÈRE valeur est rigoureusement intacte',
        red[red.length - 1].t === brut[brut.length - 1].t && red[red.length - 1].v === brut[brut.length - 1].v);
      v('… et la première aussi', red[0].t === brut[0].t && red[0].v === brut[0].v);
      /* Un cadre assez large n'a rien à réduire : on ne doit pas jeter de points quand la densité est
         déjà bonne. C'est ce qui garantit qu'un graphique en plein écran montre TOUT. */
      const large = LTTB(brut.slice(0, 400), Math.max(60, Math.round(1800 * 0.55)));
      v('un cadre assez large garde TOUS les points', large.length === 400, large.length + '/400');
    }
  }
}


/* ⚠️ CE LOT NE DOIT RIEN AU NAVIGATEUR, DONC IL NE L'ATTEND PLUS. Il vivait dans `controler()`,
   c'est-à-dire derrière amCharts : sur un poste sans accès au CDN — le développement courant — il
   ne tournait JAMAIS, et c'est ainsi qu'une seconde table de couleurs de devises a pu vivre dans
   app.js sans rien faire rougir. Même leçon que la densité, écrite plus haut dans ce fichier et
   pas encore appliquée ici : un contraste et une duplication se lisent dans le source, ils
   rougissent tôt. */
function _couleursDesDevises() {
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

/* ══ … ET CE POINT DE DÉCISION VAUT POUR TOUT LE DESK, PAS QUE POUR CE FICHIER (04/09) ═════════
   Le contrôle ci-dessus vérifiait l'unicité DANS charts.js. Elle y était. Le récap hebdomadaire,
   lui, portait dans app.js sa PROPRE table de huit couleurs de devises : les huit divergeaient,
   et l'USD changeait de famille — or de marque dans le récap, blanc dans le graphique. La même
   devise portait deux couleurs dans le même produit, et l'or, couleur de MARQUE, faisait un
   travail de donnée.
   ⚠️ ET LA COPIE N'AVAIT PAS DE VARIANTE CLAIRE : mesuré sur fond blanc, QUATRE des huit codes
   tombaient sous 3:1 — USD 1,96 · CHF 1,92 · GBP 2,28 · JPY 2,43. Le contrôle « thème clair »
   juste au-dessus existait depuis le 29/08 et ne regardait pas la copie : c'est la définition
   d'une duplication, on répare une fois sur deux sans le savoir. */
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
/* On cherche une littérale qui associe au moins quatre codes de devise à une couleur : c'est la
   FORME d'une seconde table, quel que soit le nom qu'on lui donne. Interdire le seul nom
   `_WR_COLOR` laisserait rentrer la même faute sous un autre. */
const secondes = [...APP.matchAll(/\{[^{}]*\}/g)].map((m) => m[0])
  .filter((b2) => (b2.match(/\b(?:USD|EUR|JPY|GBP|AUD|CHF|CAD|NZD)\b\s*:\s*['"]?#?(?:0x)?[0-9a-f]{6}/gi) || []).length >= 4);
v('le desk ne porte plus de SECONDE table de couleurs de devises',
  secondes.length === 0, secondes.length + ' table(s) trouvée(s) : ' + secondes.map((x) => x.slice(0, 70)).join(' | '));
v('… et charts.js expose ce point de décision au reste du desk',
  /window\.DTPCsCouleur = function \(ccy\)/.test(SRC));
v('… que le récap hebdomadaire consomme', /window\.DTPCsCouleur\b/.test(APP));
/* ⚠️ L'APPEL EST FAIT AU RENDU, PAS AU CHARGEMENT, et l'ordre des balises l'impose : app.js est
   chargé AVANT charts.js. Capturer la table dans une constante de module la trouverait vide, et
   les huit codes sortiraient à l'encre de repli — en silence, sans erreur. On exige donc que la
   seule mention vive DANS une fonction. */
const iApp = APP.indexOf('window.DTPCsCouleur');
const dansFonction = iApp > 0 && /function _wrCouleurDevise\(c\) \{[\s\S]{0,240}window\.DTPCsCouleur/.test(APP);
v('… au moment du RENDU, pas au chargement (app.js est chargé avant charts.js)', dansFonction,
  'une capture au chargement rendrait les huit codes à l\'encre, sans erreur');
const H = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
v('… et cet ordre de chargement est bien celui de la page', H.indexOf('/js/app.js') < H.indexOf('/js/charts.js'),
  'si l\'ordre s\'inversait un jour, la raison ci-dessus tomberait — mais l\'appel au rendu reste juste');
/* Le repli quand charts.js manque : de l'ENCRE, jamais une couleur de devise. Mieux vaut un code
   non coloré qu'un code peint de la couleur d'une AUTRE devise. */
const repli = /return '#e6e6ea';/.test(APP.slice(iApp, iApp + 300));
v('… et son repli est de l\'encre, pas une couleur de devise inventée', repli);
}

if (require.main === module) {
  (async () => {
    _rafraichissementSilencieux();
    _rattacherPastilles();
    /* ⚠️ LA DENSITÉ SE CONTRÔLE SANS NAVIGATEUR, DONC AVANT LUI. Posé d'abord dans `controler()`,
       ce lot ne tournait qu'avec amCharts joignable — c'est-à-dire jamais en développement, et
       seulement à la livraison. Or il n'éprouve que de l'arithmétique sur une série : il n'a aucune
       raison d'attendre un rendu, et toutes les raisons de rougir tôt. */
    _densiteEtIntegrite();
    _couleursDesDevises();
    const bin = trouverNavigateur();
    if (!bin) {
      console.log('\n[Force] aucun Chromium trouvé → la partie VISUELLE s\'abstient (ce n\'est pas un échec).');
      if (ko) { console.log(`\n✗ ${ko} ÉCHEC(S) — ${ok} contrôle(s) OK\n`); process.exit(1); }
      console.log('');
      process.exit(0);
    }
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
          r.grille = await page.evaluate(SONDE_GRILLE);
        const pl = await page.evaluate(SONDE_POS_LEGENDE, 2);
          const pt = await page.evaluate(SONDE_POS_TRACE);
          if (pl && pt) {
            const avant = await page.evaluate(SONDE_OPACITES);
            await page.mouse.move(pl.x, pl.y); await new Promise(z => setTimeout(z, 250));
            const surLegende = await page.evaluate(SONDE_OPACITES);
            // Un GLISSEMENT sur le tracé, pas un saut : c'est le geste décrit par l'utilisateur, et
            // c'est lui qui faisait accrocher une série au curseur.
            for (let k = 0; k <= 8; k++) { await page.mouse.move(pt.x - 60 + k * 15, pt.y); }
            await new Promise(z => setTimeout(z, 250));
            const surTrace = await page.evaluate(SONDE_OPACITES);
            await page.mouse.move(2, 2); await new Promise(z => setTimeout(z, 250));
            const apres = await page.evaluate(SONDE_OPACITES);
            r.survol = { dispo: true, ccy: pl.ccy, avant, surLegende, surTrace, apres };
          } else r.survol = { dispo: false, err: 'légende ou tracé introuvable' };
        }
        mesures.push({ cas: c, r });
        await page.close();
      }
      if (mesures.every(m => (m.r.err || []).some(e => /amCharts absent/.test(e)))) {
        // C'est la partie VISUELLE qui s'abstient : les contrôles statiques déjà passés, eux,
        // comptent. Sortir en 0 sans les regarder rendrait ce banc vert sur un défaut avéré.
        console.log('\n[Force] amCharts injoignable (CDN bloqué, pas de DTP_AM5_BUNDLE) → partie visuelle abstenue.');
        if (ko) { console.log(`\n✗ ${ko} ÉCHEC(S) — ${ok} contrôle(s) OK\n`); process.exit(1); }
        console.log('');
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
    /* ⚠️ CE CONTRÔLE A ÉTÉ RETOURNÉ LE 02/09, ET C'EST VOULU. Il exigeait auparavant que « une
       devise décroche » fasse COMPRESSER le cadre. C'est précisément ce que l'utilisateur est venu
       signaler : « on ne voit pas la courbe NZD, il faut que toutes les courbes apparaissent ».
       Une devise qui vit ailleurs pendant toute la période n'est plus compressée dehors — elle
       resterait invisible. Mesuré sur ce jeu : l'USD n'avait que 23 % de ses points dans le cadre.
       La compression est réservée à ce qu'elle sait faire sans rien cacher : l'échappée TARDIVE,
       éprouvée juste en dessous. */
    v('« une devise vit ailleurs » : la règle renonce, la courbe reste visible',
      rg.fuyarde && !rg.fuyarde.compresse, JSON.stringify(rg.fuyarde));
    v('« échappée tardive » : là, le cadre se resserre', rg.echappee && rg.echappee.compresse, JSON.stringify(rg.echappee));
    v('… et laisse bien une devise dehors', rg.echappee && rg.echappee.dehors === 1, JSON.stringify(rg.echappee));
    v('… sans jamais descendre sous la moitié de présence',
      rg.echappee && rg.echappee.presenceMin >= 50, JSON.stringify(rg.echappee));
    v('« quatre décrochent » : la règle renonce', rg.ecrase && !rg.ecrase.compresse, JSON.stringify(rg.ecrase));

    /* L'INVARIANT, sur TOUS les régimes : quand le cadre se resserre, aucune devise ne peut y être
       présente moins de la moitié du temps. C'est la règle elle-même, éprouvée sur les quatre jeux
       plutôt que sur celui qui l'illustre — un seuil qui bouge dans charts.js le fera rougir ici. */
    const fautifs = Object.entries(rg).filter(([, o]) => o && o.compresse && o.presenceMin < 50)
      .map(([n, o]) => n + ' (' + o.presenceMin + ' %)');
    v('aucun régime ne cache une courbe plus de la moitié du temps', fautifs.length === 0, fautifs.join(' · '));
  }

  console.log('\n── Force des Devises : les huit devises sont-elles lisibles ? ──');
  for (const { cas, r } of mesures) {
    const m = r.modele || {};
    const attendu = (cas.o && cas.o.onlyCurrencies) ? cas.o.onlyCurrencies.length : 8;
    console.log(`\n  · ${cas.nom} (${cas.w}×${cas.h})  —  ${r.nPastilles}/${attendu} pastille(s), cadre [${m.yMin}, ${m.yMax}], paquet ${m.partPaquet}% (${m.nDedans} dedans), écart min ${m.ecartMin} px, légende ${m.legendeH} px, tracé ${m.plotH} px, échelle ${m.gradVisibles}/${m.gradTotal} repère(s)`);
    if (process.env.DTP_FORCE_DEBUG) console.log('      fins : ' + (m.fins || []).join(' '));
    v('aucune erreur d\'exécution', (r.err || []).length === 0, (r.err || []).join(' | '));
    /* INVARIANT 1 — AUCUNE DEVISE MUETTE. C'est la demande, mot pour mot : « je ne vois pas toutes
       les informations ». Une devise dont la courbe sort du cadre garde sa pastille : c'est elle qui
       porte le nom et la valeur, donc l'information. */
    /* ⚠️ LE MESSAGE NOMMAIT LE NOMBRE ATTENDU, PAS LA DEVISE MANQUANTE (corrigé le 02/09). « 7/8 —
       manque : 8 » ne dit rien : il a fallu un aller-retour de livraison pour apprendre qu'il en
       manquait une, et je n'ai toujours pas su LAQUELLE. Un banc qui échoue doit livrer le fait,
       pas le rappel de son propre seuil. */
    v('les huit devises ont leur pastille', r.nPastilles === attendu,
      r.nPastilles + '/' + attendu + ' — absente(s) : ' + ((r.pastillesManquantes || []).join(', ') || '(non identifiée)'));
    v('aucune pastille n\'en recouvre une autre', (r.heurtees || []).length === 0, (r.heurtees || []).join(' · '));
    v('aucune pastille ne sort du cadre', (r.debordent || []).length === 0, (r.debordent || []).join(' · '));
    /* ══ INVARIANT 0 — LE CADRE NE COUPE JAMAIS UNE COURBE (05/09) ═══════════════════════════════
       Demande utilisateur, deux captures : « je ne vois pas la courbe JPY, corrige ça afin qu'on ait
       une vue d'ensemble à chaque fois que le prix fait des hikes hyper hauts — car à chaque fois je
       dois te dire pour que tu corriges ». C'est une règle, pas un cas, et elle passe devant le
       resserrement sur le paquet : celui-ci ne s'applique plus que s'il ne coupe RIEN.
       ⚠️ ON COMPTE DES POINTS, PAS DES FINS. `bornesPaquet` arbitre sur les valeurs de fin ; le pic
       du jeu « hike » revient dans le paquet, donc sa fin est parfaitement rangée. Un contrôle sur
       les fins serait vert sur le défaut même qui a motivé la demande.
       ⚠️ ET IL VA PAR PAIRE avec la part de hauteur occupée, mesurée juste en dessous : « rien n'est
       coupé » est trivialement vrai sur un cadre immense où les huit courbes tiennent dans 4 % de la
       hauteur — c'est-à-dire sur la plainte INVERSE, celle du 29/08. Les deux ensemble disent : tout
       est dans le cadre, ET le cadre est serré sur ce qu'il contient. */
    v('le cadre ne coupe AUCUNE courbe (vue d\'ensemble, même sur un pic)',
      (m.ptsHors || 0) === 0, (m.coupees || []).join(' · ') + ' — ' + (m.ptsHors || 0) + ' point(s) hors cadre');
    /* ══ INVARIANT 1 bis — LA COLONNE EST DROITE (02/09, demande utilisateur sur capture) ═════════
       « tous les labels parfaitement alignés sur le même axe vertical… un rendu propre, symétrique
       et parfaitement homogène. »
       CE QUE DIT LE CODE, et pourquoi ça ne suffit pas : les pastilles sont posées avec
       `centerX: percent(0)` et `paddingLeft: 0`, donc ancrées par leur bord GAUCHE sur l'axe — en
       théorie, la même abscisse pour les huit. Aucune règle de la feuille ne décale une pastille
       horizontalement (`--cs-badge-x` est une valeur unique et globale). La lecture du code conclut
       donc « c'est déjà aligné », et l'utilisateur voit le contraire : c'est exactement le genre de
       désaccord qu'une MESURE tranche et qu'une relecture ne tranchera jamais.
       ⚠️ CE CONTRÔLE NE PEUT PAS TOURNER SANS RÉSEAU : amCharts vient du CDN. En bac à sable il
       s'abstient avec tout le reste de cette section ; il travaille dans le workflow de livraison,
       qui a le réseau. C'est là qu'il dira si l'écart existe vraiment, et de combien.
       DEUX GRANDEURS. Les bords gauches d'abord : c'est « le même axe vertical ». Les largeurs
       ensuite : à bord gauche commun, deux pastilles de largeurs différentes donnent des bords
       DROITS en escalier — et le chevron « hors cadre » est précisément ce qui élargit une pastille.
       On tolère 1 px (arrondi de rendu), pas plus. */
    {
      const xs = (r.pastilles || []).map(p => p.x);
      const ws = (r.pastilles || []).map(p => p.w);
      const etendue = a => a.length ? Math.max.apply(null, a) - Math.min.apply(null, a) : 0;
      if (xs.length >= 2) {
        v('les pastilles partagent toutes le même bord gauche (le même axe vertical)',
          etendue(xs) <= 1,
          'écart de ' + etendue(xs) + ' px entre la plus à gauche et la plus à droite : '
            + (r.pastilles || []).map(p => p.ccy + '@' + p.x).join(' '));
        /* La largeur ne peut être uniforme que si AUCUNE pastille ne porte de chevron : une devise
           hors cadre en porte un, légitimement, et il l'élargit. On ne compare donc les largeurs que
           dans ce cas — sinon on exigerait une chose fausse, et le banc rougirait sur du code juste. */
        if (!(r.chevrons || []).length) {
          v('… et la même largeur (bords droits alignés eux aussi)', etendue(ws) <= 1,
            'écart de ' + etendue(ws) + ' px : ' + (r.pastilles || []).map(p => p.ccy + '=' + p.w).join(' '));
        }
      }
    }
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

    if (r.grille) {
      console.log('    — la grille de fond —');
      const g = r.grille;
      /* Le seuil : 0,2 était la valeur d'avant, invisible. On exige nettement plus, sans monter au
         point où la grille passerait devant les courbes. */
      v('la grille verticale se voit', g.x.op >= 0.35, 'opacité ' + g.x.op);
      v('la grille horizontale aussi', g.y.op >= 0.35, 'opacité ' + g.y.op);
      /* LE CONTRÔLE QUI COMPTE : le MÊME style des deux côtés. C'est lui qui attrape la moitié de
         quadrillage — une grille figée en sombre face à une grille qui suit le thème. */
      v('les deux axes portent le MÊME style de grille',
        g.x.op === g.y.op && g.x.col === g.y.col && g.x.tirets === g.y.tirets && g.x.w === g.y.w,
        JSON.stringify(g));
    }
    if (r.survol) {
      console.log('    — le survol ne cache rien —');
      const sv = r.survol;
      if (!sv.dispo) { v('la sonde de survol trouve la légende et le tracé', false, sv.err || 'mécanisme introuvable'); }
      else {
        const pleines = (l) => l.every(x => x.o >= 0.9);
        const dit = (l) => JSON.stringify(l.map(x => x.ccy + ':' + x.o));
        v('au repos, les huit courbes sont pleines', pleines(sv.avant), dit(sv.avant));
        /* Les deux entrées qui déclenchaient l'effacement. Le tracé est la décisive : c'est le geste
           de la capture, et c'est celui qui se produisait en permanence. */
        v('souris posée sur la légende, les huit restent pleines', pleines(sv.surLegende), dit(sv.surLegende));
        v('curseur glissé sur une courbe, les huit restent pleines', pleines(sv.surTrace), dit(sv.surTrace));
        v('… et rien ne traîne après le départ de la souris', pleines(sv.apres), dit(sv.apres));
      }
    }
  }

}

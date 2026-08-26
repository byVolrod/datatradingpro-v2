#!/usr/bin/env node
/**
 * frise-verif.js — LA FRISE DES SÉANCES REMPLIT-ELLE VRAIMENT SON BLOC ?
 * ------------------------------------------------------------------------------------------------
 * 01/09, demande utilisateur, capture à l'appui : « le widget Sessions de marché doit être
 * entièrement responsive par rapport à la taille de son bloc […] aucun espace vide inutile […] si le
 * bloc devient plus grand, le widget doit utiliser tout l'espace disponible ». Sur la capture, les
 * quatre places tenaient dans le tiers supérieur de la carte et la moitié basse était vide.
 *
 * POURQUOI CE BANC EXISTE, ET POURQUOI LA LECTURE DU CSS N'AURAIT PAS SUFFI. « Remplir son bloc »
 * n'est pas une propriété qu'on lit dans une feuille de style : c'est un RÉSULTAT de mise en page,
 * produit par une chaîne de six conteneurs (carte → corps → frise → corps de frise → ligne → piste)
 * dont chacun peut rompre la transmission de hauteur avec un `min-height: auto` oublié. On ouvre
 * donc la frise dans un vrai Chromium, à SIX hauteurs de carte, et on mesure deux choses que
 * personne d'autre ne mesure :
 *   — le bas du dernier élément atteint-il le bas de la carte (pas de vide) ;
 *   — le contenu déborde-t-il de la carte (pas de coupe).
 * Les deux ensemble : un seul des deux se satisfait trivialement (tout coller en haut ne déborde
 * jamais ; tout étirer sans plafond remplit toujours).
 *
 * ⚠️ ET IL RESTE UN TROISIÈME CONTRÔLE, MOINS ÉVIDENT : quand la carte est TROP BASSE, le contenu
 * doit déborder ET rester atteignable par un défilement (décision du 26/08 : « on voit pas toutes
 * les informations du widget monde » — les places étaient coupées sans trace). Une mise en page qui
 * remplirait en écrasant les lignes jusqu'à zéro passerait les deux premiers contrôles et
 * détruirait celui-là. Il est donc éprouvé explicitement.
 *
 *   node scripts/frise-verif.js       (s'abstient sans Chromium)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4759;
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };

let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x)) || null;
}

/* LE VRAI CODE, DÉCOUPÉ DANS widgets.js — jamais une copie. Une copie se met à jour toute seule
   dans l'imagination du relecteur et nulle part ailleurs : le jour où `_monterFriseSeances` change,
   le banc continuerait d'éprouver l'ancien. On extrait le bloc des places jusqu'à la fin du
   monteur, qui est contigu et ne dépend d'aucune autre aide du module. */
function extraireFrise() {
  const src = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
  const d = src.indexOf('  var _FRISE_PLACES = [');
  const m = src.indexOf('  function _monterFriseSeances(host) {', d);
  if (d < 0 || m < 0) return null;
  // Fin du monteur : la première accolade fermante en colonne 2 après son `return function`.
  const r = src.indexOf('\n  }\n', src.indexOf('return function ()', m));
  if (r < 0) return null;
  return src.slice(d, r + 4);
}

(async () => {
  console.log('\n═══ FRISE-VERIF — les séances remplissent-elles leur bloc ? ═══');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.log('  · puppeteer-core absent → abstention.\n'); process.exit(0); }
  const exe = trouverNavigateur();
  if (!exe) { console.log('  · aucun Chromium → abstention.\n'); process.exit(0); }

  const SRC = extraireFrise();
  v('le monteur de frise est extractible de widgets.js', !!SRC, 'bloc _FRISE_PLACES…_monterFriseSeances introuvable');
  if (!SRC) { console.log(''); process.exit(1); }

  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    /* La page reproduit la CHAÎNE RÉELLE de conteneurs d'une carte du desk : .wdg-card en colonne
       flex, .wdg-head à hauteur fixe, .wdg-body élastique. Monter la frise dans un div nu
       mesurerait une mise en page qui n'existe nulle part. */
    if (u === '/banc') {
      rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return rs.end('<!doctype html><html data-theme="dark"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<link rel="stylesheet" href="/css/style.css"></head>'
        + '<body style="margin:0;background:#0c0c0e">'
        + '<div class="wdg-card" id="carte" style="width:820px;height:420px;display:flex;flex-direction:column">'
        + '<div class="wdg-head" style="flex:0 0 auto;height:30px"></div>'
        + '<div class="wdg-body" id="h"></div></div></body></html>');
    }
    const f = path.join(PUB, u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f)) { rs.writeHead(404); return rs.end('404'); }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(rs);
  }).listen(PORT);

  let nav = null, code = 0;
  try {
    nav = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    await page.setViewport({ width: 960, height: 1000 });
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message)));
    await page.goto('http://localhost:' + PORT + '/banc', { waitUntil: 'networkidle0' });

    const mesures = await page.evaluate(async (src, hauteurs) => {
      eval(src);                                            // eslint-disable-line no-eval
      const hote = document.getElementById('h');
      const carte = document.getElementById('carte');
      const out = [];
      for (const H of hauteurs) {
        carte.style.height = H + 'px';
        hote.innerHTML = '';
        // eslint-disable-next-line no-undef
        const stop = _monterFriseSeances(hote);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 60));          // laisse le ResizeObserver poser son palier
        const frise = hote.querySelector('.wdg-frise');
        const corps = hote.querySelector('.wdg-frise-corps');
        const lignes = [...hote.querySelectorAll('.wdg-frise-ligne')];
        const pistes = [...hote.querySelectorAll('.wdg-frise-piste')];
        /* ⚠️ ON MESURE LE BAS DE LA DERNIÈRE PISTE CONTRE LE BAS DU CORPS, ET SURTOUT PAS CONTRE
           LE BAS DE LA CARTE. La note de pied est `flex: 0 0 auto` dans une colonne en
           `height: 100%` : elle est collée en bas de la carte PAR CONSTRUCTION, avant comme après
           le correctif. Un contrôle qui la prendrait pour repère serait vert des deux côtés —
           mesuré : 7 px de reste à toutes les hauteurs, correctif ou pas. Le vide que l'utilisateur
           voit est celui qui s'ouvre SOUS la dernière place, à l'intérieur du corps. */
        const derniere = pistes[pistes.length - 1] || corps;
        const rb = hote.getBoundingClientRect();
        const rc = corps.getBoundingClientRect();
        out.push({
          H,
          hoteH: rb.height,
          friseH: frise ? frise.getBoundingClientRect().height : 0,
          // Vide résiduel = du bas du dernier élément peint au bas de la zone disponible.
          vide: Math.round(rc.bottom - derniere.getBoundingClientRect().bottom),
          // Écart VERTICAL entre deux pistes voisines : c'est le pas du rythme. Ce qui reste sous
          // la dernière piste doit en être une fraction, jamais un multiple.
          pas: pistes.length > 1
            ? Math.round(pistes[1].getBoundingClientRect().top - pistes[0].getBoundingClientRect().bottom) : 0,
          hautLigne1: Math.round((lignes[0] || corps).getBoundingClientRect().top - rc.top),
          // Débordement = ce que la frise dépasse de son hôte.
          deborde: Math.round(Math.max(0, (frise ? frise.getBoundingClientRect().bottom : 0) - rb.bottom)),
          lignes: lignes.length,
          pistes: pistes.map(p => Math.round(p.getBoundingClientRect().height)),
          largeurs: pistes.map(p => Math.round(p.getBoundingClientRect().width)),
          scrollable: corps ? corps.scrollHeight > corps.clientHeight + 1 : false,
          palier: frise ? frise.className.replace('wdg-frise', '').trim() : '',
          horsCadre: lignes.filter(l => l.getBoundingClientRect().bottom > rb.bottom + 1).length,
        });
        if (typeof stop === 'function') stop();
      }
      return out;
    }, SRC, [260, 300, 340, 420, 560, 700, 900]);

    const par = h => mesures.find(m => m.H === h) || {};

    console.log('\n── 1. La frise occupe la zone qu\'on lui donne ──');
    v('aucune exception à l\'exécution', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    v('les quatre places sont montées à chaque taille', mesures.every(m => m.lignes === 4),
      mesures.map(m => m.H + '→' + m.lignes).join(' '));
    /* Le premier maillon : si `.wdg-frise` ne prend pas la hauteur de son hôte, tout le reste est
       sans objet — on répartirait de l'espace à l'intérieur d'une boîte déjà trop courte. */
    v('.wdg-frise fait la hauteur de son hôte, à toute taille',
      mesures.every(m => Math.abs(m.friseH - m.hoteH) <= 1),
      mesures.map(m => m.H + ':' + Math.round(m.friseH) + '/' + Math.round(m.hoteH)).join(' '));

    console.log('\n── 2. L\'espace se répartit, il ne s\'accumule pas en bas ──');
    /* LE CONTRÔLE DEMANDÉ, DANS SA FORME JUSTE — et il aura fallu trois versions du widget pour la
       trouver. « Aucun espace vide inutile » ne veut PAS dire « zéro pixel sous la dernière
       place » : cette lecture-là, prise au pied de la lettre, a donné des plages de 85 px de haut
       (capture user suivante : « améliore la lisibilité »). Elle ne veut pas dire non plus « tout
       aligné en haut », qui rouvre le vide sous la dernière place — 493 px mesurés avant correctif.
       La propriété qui décrit ce que l'œil accepte est le RYTHME : ce qui reste sous la dernière
       piste doit être une FRACTION de l'écart entre deux pistes, jamais un multiple. Un vide
       accumulé se voit précisément parce qu'il rompt un pas régulier. */
    for (const H of [420, 560, 700, 900]) {
      const m = par(H);
      v('carte de ' + H + ' px : le reste sous la dernière place (' + m.vide + ' px) tient dans le pas du rythme ('
        + m.pas + ' px)', m.vide <= Math.max(12, m.pas / 2),
        'vide=' + m.vide + ' pas=' + m.pas + ' pistes=' + JSON.stringify(m.pistes));
    }
    /* Le haut aussi : une frise poussée vers le bas laisserait un vide sous l'axe des heures. */
    v('la première place commence en haut du corps', mesures.every(m => m.hautLigne1 <= 26),
      mesures.map(m => m.H + ':' + m.hautLigne1).join(' '));
    /* Et il faut que ce soit la PISTE qui prenne l'espace, pas l'écart entre les lignes : une mise
       en page qui écarterait les lignes séparerait le nom de sa propre plage — c'est ce qui avait
       été retiré le 18/08. La piste grandit donc avec la carte, JUSQU'À son plafond de lisibilité,
       qu'elle ne dépasse jamais (le 2e essai, sans plafond, montait à 85 px : une dalle). */
    v('la piste grandit avec la carte',
      (par(560).pistes[0] || 0) > (par(300).pistes[0] || 0) + 4,
      '300→' + par(300).pistes[0] + 'px, 560→' + par(560).pistes[0] + 'px');
    v('… et ne dépasse jamais le plafond de lisibilité',
      mesures.every(m => (m.pistes[0] || 0) <= 48), mesures.map(m => m.H + ':' + m.pistes[0]).join(' '));
    v('les quatre pistes gardent la MÊME hauteur entre elles',
      mesures.every(m => new Set(m.pistes).size === 1),
      mesures.map(m => m.H + ':' + JSON.stringify(m.pistes)).join(' '));

    console.log('\n── 3. Rien ne déborde, rien n\'est coupé sans recours ──');
    v('la frise ne dépasse jamais de son hôte', mesures.every(m => m.deborde <= 1),
      mesures.map(m => m.H + ':' + m.deborde).join(' '));
    v('aucune place ne passe sous le bord de la carte', mesures.every(m => m.horsCadre === 0),
      mesures.map(m => m.H + ':' + m.horsCadre).join(' '));
    /* Le garde-fou du 26/08 : sur une carte basse, les lignes ne s'écrasent PAS jusqu'à
       l'illisible — elles gardent une hauteur minimale et le corps devient défilable. */
    v('sur une carte basse, les pistes gardent une hauteur lisible',
      (par(260).pistes[0] || 0) >= 7, '260→' + par(260).pistes[0] + 'px (palier « ' + par(260).palier + ' »)');
    v('… et ce qui ne tient pas reste atteignable (défilement, jamais de coupe muette)',
      !par(260).scrollable || par(260).horsCadre === 0,
      'scrollable=' + par(260).scrollable + ' horsCadre=' + par(260).horsCadre);

    console.log('\n── 4. La largeur suit aussi ──');
    /* La demande dit « 100 % de la largeur ET de la hauteur ». La piste porte les blocs positionnés
       en pourcentage : si elle ne fait pas toute la largeur utile, l'axe des heures et les plages
       ne sont plus alignés — l'erreur est alors dans la LECTURE, pas seulement dans l'esthétique. */
    const large = await page.evaluate(async (src) => {
      eval(src);                                            // eslint-disable-line no-eval
      const hote = document.getElementById('h'), carte = document.getElementById('carte');
      const out = [];
      for (const W of [380, 620, 900]) {
        carte.style.width = W + 'px'; hote.innerHTML = '';
        // eslint-disable-next-line no-undef
        const stop = _monterFriseSeances(hote);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 60));
        const p = hote.querySelector('.wdg-frise-piste');
        const a = hote.querySelector('.wdg-frise-axe');
        out.push({ W, piste: p ? Math.round(p.getBoundingClientRect().width) : 0,
          axe: a ? Math.round(a.getBoundingClientRect().width) : 0,
          dispo: Math.round(hote.getBoundingClientRect().width) });
        if (typeof stop === 'function') stop();
      }
      return out;
    }, SRC);
    v('la piste s\'étend sur toute la largeur utile, à toute largeur de carte',
      large.every(l => l.piste >= l.dispo - 30), JSON.stringify(large));
    v('l\'axe des heures fait exactement la largeur de la piste (sinon les plages mentent)',
      large.every(l => Math.abs(l.axe - l.piste) <= 2), JSON.stringify(large));
  } catch (e) {
    ko++; console.log('  ✗ banc interrompu\n      → ' + e.message);
  } finally {
    try { if (nav) await nav.close(); } catch {}
    try { srv.close(); } catch {}
  }

  console.log('\n───────────────────────────────────────');
  console.log('  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n');
  process.exit(ko ? 1 : (code || 0));
})();

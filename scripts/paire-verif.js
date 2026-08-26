#!/usr/bin/env node
/**
 * paire-verif.js — LE SÉLECTEUR DE PAIRE DU GRAPHIQUE SE CHERCHE-T-IL VRAIMENT ?
 * ------------------------------------------------------------------------------------------------
 * 02/09, référence fournie (« Price Chart Settings ») : le sélecteur de symbole de la référence
 * s'ouvre sur un champ de recherche, des puces de classe d'actif et un drapeau par ligne. Le nôtre
 * comptait quarante-deux entrées — Forex, indices, matières premières — dans un déroulé d'un seul
 * tenant : trouver CAD/CHF s'y faisait à l'œil, ligne par ligne.
 *
 * ⚠️ POURQUOI CE BANC EXISTE À CÔTÉ DE reglages-verif. Le champ de recherche du PANNEAU de réglages
 * (01/09) ne couvrait pas ce sélecteur : la paire du graphique est déclarée `cache: true`, elle
 * n'est donc pas rendue par le panneau mais par la barre du widget, via un `<select>` intercepté.
 * Deux surfaces, deux mises en œuvre — et un correctif posé sur l'une ne dit RIEN de l'autre. C'est
 * exactement l'écart relevé à l'audit du 02/09 ; ce banc est là pour qu'il ne se rouvre pas.
 *
 * CE QU'IL ÉPROUVE, ET QU'AUCUN CONTRÔLE STATIQUE NE VOIT :
 *   — le menu naît d'un écouteur DÉLÉGUÉ sur `document` : il n'existe qu'après un vrai mousedown ;
 *   — le filtre masque par l'attribut `hidden`, sur un élément en `display: flex`. Une déclaration
 *     d'auteur bat la feuille du navigateur : sans une règle `[hidden] { display: none }`, la
 *     recherche filtre correctement… et ne cache rien. On sert donc la VRAIE feuille et on relit le
 *     display calculé, pas la propriété `hidden` ;
 *   — le `preventDefault` du menu empêchait le champ de prendre le focus : on tapait dans le vide.
 *
 *   node scripts/paire-verif.js       (s'abstient sans Chromium)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4767;
let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x)) || null;
}

/* LE VRAI MÉCANISME, DÉCOUPÉ DANS widgets.js — des aides jusqu'au dernier écouteur. */
function extraire() {
  const src = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
  const d = src.indexOf("  var _DDM_SEL = ");
  const f = src.indexOf("  window.addEventListener('scroll', function () { var m = document.querySelector('.wdg-ddm')", d);
  if (d < 0 || f < 0) return null;
  return src.slice(d, src.indexOf('\n', f) + 1);
}

/* Le catalogue RÉEL du widget : on le lit dans le contrat du widget plutôt que d'en recopier un.
   Une liste inventée éprouverait un sélecteur qui n'existe pas. */
function extraireCatalogue() {
  const src = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
  const d = src.indexOf("            var FX28 = [");
  const f = src.indexOf('];', d);
  if (d < 0 || f < 0) return null;
  const noms = src.slice(d, f + 2).match(/'[^']+'/g) || [];
  return noms.map(s => s.slice(1, -1));
}

(async () => {
  console.log('\n═══ PAIRE-VERIF — le sélecteur de paire du graphique ═══');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.log('  · puppeteer-core absent → abstention.\n'); process.exit(0); }
  const exe = trouverNavigateur();
  if (!exe) { console.log('  · aucun Chromium → abstention.\n'); process.exit(0); }

  const SRC = extraire();
  const FX28 = extraireCatalogue();
  v('le menu maison est extractible de widgets.js', !!SRC);
  v('le catalogue de paires est extractible du contrat du widget', !!FX28 && FX28.length === 28, FX28 ? FX28.length + ' paires' : 'introuvable');
  if (!SRC || !FX28) { console.log('\n  ' + ok + ' vert(s), ' + ko + ' rouge(s)\n'); process.exit(1); }

  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u === '/banc') {
      rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return rs.end('<!doctype html><html data-theme="dark"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<link rel="stylesheet" href="/css/style.css"></head>'
        + '<body style="margin:0;background:#0c0c0e">'
        + '<section class="wdg-card" style="width:520px;height:300px"><div class="wdg-cdl-bar">'
        + '<select class="wdg-cdl-sym" id="sel" aria-label="Choisir la paire"></select>'
        + '</div></section></body></html>');
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
    await page.setViewport({ width: 900, height: 620 });
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message)));
    await page.goto('http://localhost:' + PORT + '/banc', { waitUntil: 'networkidle0' });

    const res = await page.evaluate((src, paires) => {
      window.esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      window.CAL_FLAG = c => '<span class="cal-flag-wrap"><img class="cal-flag-img" alt="' + c + '"></span>';
      eval(src);                                            // eslint-disable-line no-eval
      const sel = document.getElementById('sel');
      // Le catalogue réel : 28 croisements + indices + matières premières, comme sur le desk.
      const tout = paires.concat(['DAX', 'S&P 500', 'FTSE', 'CAC 40', 'Gold', 'Silver', 'Oil WTI']);
      sel.innerHTML = tout.map((p, i) => '<option value="' + p + '"' + (i === 0 ? ' selected' : '') + '>' + p + '</option>').join('');
      let change = null;
      sel.addEventListener('change', () => { change = sel.value; });

      const ouvre = () => sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      ouvre();
      const menu = document.querySelector('.wdg-ddm');
      if (!menu) return { menu: false };
      const champ = menu.querySelector('.wdg-ddm-rech');
      const vus = () => [...menu.querySelectorAll('.wdg-ddm-it')]
        .filter(b => getComputedStyle(b).display !== 'none').map(b => b.getAttribute('data-v'));
      const taper = t => {
        champ.value = t;
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        return vus();
      };
      const puce = c => {
        const b = [...menu.querySelectorAll('.wdg-ddm-cl')].find(x => x.getAttribute('data-cl') === c);
        if (b) b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        return vus();
      };
      const r = {
        menu: true,
        champ: !!champ,
        puces: [...menu.querySelectorAll('.wdg-ddm-cl')].map(b => b.textContent),
        total: menu.querySelectorAll('.wdg-ddm-it').length,
        drapeauxFx: menu.querySelector('.wdg-ddm-it[data-cl="fx"] .wdg-ddm-fl img') ? 2 : 0,
        drapeauxIdx: !!menu.querySelector('.wdg-ddm-it[data-cl="idx"] .wdg-ddm-fl'),
        focus: document.activeElement === champ,
      };
      r.deuxDrapeaux = menu.querySelectorAll('.wdg-ddm-it[data-cl="fx"] .wdg-ddm-fl img').length >= 2
        ? [...menu.querySelectorAll('.wdg-ddm-it[data-cl="fx"]')][0].querySelectorAll('.wdg-ddm-fl img').length : 0;
      r.cad = taper('cad/ch');
      r.rien = taper('zzzz');
      r.videMontre = getComputedStyle(menu.querySelector('.wdg-ddm-vide')).display !== 'none';
      r.reset = taper('');
      r.mp = puce('mp');
      r.mpEtRech = taper('gold');
      // Entrée prend la première entrée encore visible.
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      r.choisi = change;
      r.ferme = !document.querySelector('.wdg-ddm');
      // Échap referme sans rien choisir.
      ouvre();
      const m2 = document.querySelector('.wdg-ddm');
      m2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      r.echap = !document.querySelector('.wdg-ddm');
      return r;
    }, SRC, FX28);

    console.log('\n── 1. Le menu s\'ouvre et porte ce que montre la référence ──');
    v('aucune exception à l\'exécution', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    v('un mousedown sur le <select> ouvre le menu maison', res.menu === true);
    v('les 35 entrées sont listées', res.total === 35, res.total + ' entrée(s)');
    v('le champ de recherche est là', res.champ === true);
    /* Le focus : sans lui on ouvre un champ dans lequel on ne peut pas taper. Le `preventDefault`
       du menu, posé sur TOUT le menu, produisait exactement ça. */
    v('… et il a le focus dès l\'ouverture', res.focus === true);
    v('les puces de classe couvrent les trois familles du catalogue',
      res.puces.join('|') === 'Tout|Forex|Indices|Matières premières', res.puces.join('|'));

    console.log('\n── 2. Un drapeau par devise, et seulement où il a un sens ──');
    v('une paire porte les DEUX drapeaux de ses devises', res.deuxDrapeaux === 2, res.deuxDrapeaux + ' drapeau(x)');
    v('un indice ou une matière première n\'en porte aucun (il n\'a pas de pays)', res.drapeauxIdx === false);

    console.log('\n── 3. Taper filtre, et le filtre CACHE vraiment ──');
    /* ⚠️ On relit le `display` CALCULÉ, pas l'attribut `hidden`. `.wdg-ddm-it` est en `display: flex` :
       une déclaration d'auteur bat la feuille du navigateur, et sans règle `[hidden]` explicite le
       filtre marquerait les entrées sans en cacher une seule. */
    v('« cad/ch » ne laisse que CAD/CHF', res.cad.join('|') === 'CAD/CHF', JSON.stringify(res.cad));
    v('une recherche sans résultat ne laisse rien', res.rien.length === 0, JSON.stringify(res.rien));
    v('… et le dit au lieu de laisser un menu vide', res.videMontre === true);
    v('vider le champ rend toutes les entrées', res.reset.length === 35, res.reset.length + '/35');

    console.log('\n── 4. Les puces coupent par classe, et se combinent à la recherche ──');
    v('la puce « Matières premières » ne laisse que les matières premières',
      res.mp.join('|') === 'Gold|Silver|Oil WTI', JSON.stringify(res.mp));
    v('… et la recherche s\'y ajoute sans l\'annuler', res.mpEtRech.join('|') === 'Gold', JSON.stringify(res.mpEtRech));

    console.log('\n── 5. Clavier ──');
    v('Entrée choisit la première entrée visible et ferme', res.choisi === 'Gold' && res.ferme === true,
      'choisi=' + res.choisi + ' fermé=' + res.ferme);
    v('Échap referme sans rien choisir', res.echap === true);
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

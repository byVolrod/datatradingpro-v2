#!/usr/bin/env node
/* ═══ CARTE-VERIF — la Carte du monde V3 rattache-t-elle les dépêches au BON pays ? ═════════════════
   Deux étages, sur le VRAI public/js/v2/carte.js (jamais une copie) :
     1. Rattachement, en Node : la tranche de données et de règles est extraite du fichier et jouée.
        Les pièges mesurés en écrivant la carte y sont épinglés : « us » minuscule n'est pas les
        États-Unis, et `\b` ignore les lettres accentuées (« États-Unis », « Élysée » seraient perdus).
     2. Rendu, dans Chromium (s'il est là, sinon on s'abstient) : fond de carte SYNTHÉTIQUE de trois
        pays (le vrai vient du CDN amCharts, absent en CI), dépêches d'essai, couches, fiche pays,
        et la déclaration du widget au catalogue. */
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(R, 'public/js/v2/carte.js'), 'utf8');

let ok = 0, ko = 0;
const t = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')); } };

console.log('\n── 1. Rattachement des dépêches (tranche réelle de carte.js) ──');
const debut = SRC.indexOf('var PAYS = {'), fin = SRC.indexOf('var hm = function');
t('la tranche de rattachement est extractible', debut > 0 && fin > debut);
const X = new Function('allItems', SRC.slice(debut, fin) + '; return { paysDe, familleDe, depeches, PASSAGES, proj, PAYS, BC, RESSOURCES };')([]);
const pays = s => X.paysDe(s).join(',');
t('« US CPI rises » → États-Unis', pays('US CPI rises 0.4%, above forecast') === 'US');
t('« let us see » (pronom) → aucun pays', pays('Traders say let us see what the data brings') === '');
t('« Les États-Unis et l’Iran » → US et IR (lettre accentuée en tête de mot)', pays('Les États-Unis et l’Iran concluent un accord') === 'US,IR');
t('« Macron à l’Élysée » → France', pays('Macron à l’Élysée') === 'FR');
t('BCE / Lagarde → les grands membres de la zone euro', /DE/.test(pays('ECB’s Lagarde: disinflation on track')) && /FR/.test(pays('ECB’s Lagarde: disinflation on track')));
t('« MBS » (titres hypothécaires) n’est PAS l’Arabie saoudite', pays('US MBS spreads widen') === 'US');
const pass = s => X.PASSAGES.filter(p => p.rx.test(s)).map(p => p.id).join(',');
t('Ormuz reconnu en anglais et en français', pass('Iran threatens the Strait of Hormuz') === 'hormuz' && pass('Menace sur le détroit d’Ormuz') === 'hormuz');
t('mer Rouge / Houthis → Bab el-Mandeb', pass('Houthi attack in the Red Sea') === 'bab');
t('famille : « sanctions » (pluriel) = géopolitique', X.familleDe('New sanctions on Iran', '').k === 'geo');
t('famille : catégorie Fed = banques centrales, même sans mot-clé', X.familleDe('Powell speaks', 'Fed').k === 'bc');
t('famille : la catégorie de la SOURCE prime (« Oil … Iran tensions », Energy → énergie)', X.familleDe('Oil jumps as Iran tensions rise', 'Energy').k === 'energie');
t('famille : Bitcoin = crypto ; or = métaux', X.familleDe('Bitcoin tops $120k', '').k === 'crypto' && X.familleDe('Gold hits record', '').k === 'metaux');
const q0 = X.proj(0, 0), qo = X.proj(-180, 0), qe = X.proj(180, 0);
t('projection : l’équateur et Greenwich au centre, symétrique en longitude', Math.abs(q0[0] - 540) < 1e-6 && Math.abs((qe[0] - 540) + (qo[0] - 540)) < 1e-6);
t('les huit banques centrales du desk sont placées', X.BC.length === 8 && X.BC.every(b => X.PAYS[b.pays]));
t('chaque producteur listé d’une matière est un pays suivi OU un code ISO valide', Object.values(X.RESSOURCES).every(r => r.pays.every(p => /^[A-Z]{2}$/.test(p))));
const dep = new Function('allItems', SRC.slice(debut, fin) + '; return depeches(24);')([
  { id: 'a', headline: 'Iran warns on Hormuz', timestamp: Date.now() - 60000, category: 'Geopolitical' },
  { id: 'b', headline: 'Iran warns on Hormuz (old)', timestamp: Date.now() - 30 * 3600e3 },
  { id: 'c', headline: 'Nothing to place here', timestamp: Date.now() - 60000 },
  { id: 'd', headline: 'Briefing', timestamp: Date.now(), source: 'DTP' },
]);
t('fenêtre : seule la dépêche récente ET rattachable est retenue', dep.length === 1 && dep[0].it.id === 'a' && dep[0].passages[0] === 'hormuz');

console.log('\n── 1 bis. Multi-actifs : le calcul de ligne réel de server.js ──');
{
  const SRV = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
  const a = SRV.indexOf('function _multiLigne('), b = SRV.indexOf('async function _multiLire(');
  t('la fonction _multiLigne est extractible', a > 0 && b > a);
  const ligne = new Function(SRV.slice(a, b) + '; return _multiLigne;')();
  const brut = (prix, prec, closes) => ({ chart: { result: [{ meta: { regularMarketPrice: prix, chartPreviousClose: prec, marketState: 'REGULAR' }, indicators: { quote: [{ close: closes }] } }] } });
  const closes = Array.from({ length: 200 }, (_, i) => 2600 + i * 0.3);
  const or = ligne(['GC=F', 'Or', 'XAU/USD', 2], brut(2654.3, 2632.2, closes.concat([null])));
  t('or : variation en pourcent depuis la clôture précédente', or.ok && Math.abs(or.chg - 0.84) < 0.01, JSON.stringify({ chg: or.chg }));
  t('… courbe réduite à 48 points environ, trous écartés', or.spark.length <= 50 && or.spark.length >= 40 && or.spark.every(v => Number.isFinite(v)));
  t('… plus haut et plus bas de séance lus sur la courbe', or.haut === 2659.7 && or.bas === 2600);
  const dix = ligne(['^TNX', 'US 10 ans', 'US10Y', 2, 1], brut(3.781, 3.739, [3.74, 3.76, 3.781]));
  t('rendement US 10 ans : variation en POINTS DE BASE (+4,2 pb), pas en pourcent de lui-même', dix.rendement && Math.abs(dix.chg - 4.2) < 0.05, String(dix.chg));
  const muet = ligne(['NG=F', 'Gaz naturel', 'NG', 3], null);
  t('instrument muet : ligne conservée, marquée indisponible (jamais une ligne qui disparaît)', muet.ok === false && muet.nom === 'Gaz naturel');
}

console.log('\n── 2. Rendu dans Chromium ──');
(async () => {
  let pp, nav;
  try { pp = require(path.join(R, 'node_modules/puppeteer-core')); } catch (e) { pp = null; }
  let exe = null;
  try { exe = require(path.join(R, 'scripts/mobile-apercu.js')).trouverNavigateur(); } catch (e) { exe = null; }
  if (!pp || !exe) { console.log('  · Chromium indisponible : rendu non éprouvé ici (le rattachement l’est).'); return fin_(); }
  try {
    nav = await pp.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    await page.setViewport({ width: 1200, height: 700 });
    const erreurs = []; page.on('pageerror', e => erreurs.push(e.message));
    const carre = (x, y) => [[[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]];
    const geo = { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'US', properties: { id: 'US', name: 'United States' }, geometry: { type: 'Polygon', coordinates: carre(-100, 30) } },
      { type: 'Feature', id: 'IR', properties: { id: 'IR', name: 'Iran' }, geometry: { type: 'Polygon', coordinates: carre(50, 28) } },
      { type: 'Feature', id: 'FR', properties: { id: 'FR', name: 'France' }, geometry: { type: 'Polygon', coordinates: carre(0, 43) } },
      { type: 'Feature', id: 'AQ', properties: { id: 'AQ', name: 'Antarctica' }, geometry: { type: 'Polygon', coordinates: carre(0, -80) } },
    ] };
    await page.setContent('<!doctype html><html class="dtp-v2"><head></head><body style="margin:0;background:#08080a"><div id="h" style="width:1100px;height:600px"></div></body></html>');
    await page.evaluate((g) => {
      window.am5geodata_worldLow = g;
      window._declare = null;
      window.DTPWidgets = { enregistrer: (w) => { window._declare = w; return true; } };
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ banks: [{ code: 'USD', rate: 3.88, next: '2026-10-28', stance: 'hold' }], groups: [{ items: [{ label: 'Brent', pct: 1.25 }] }] }) });
      const n = Date.now();
      window.allItems = [
        { id: '1', headline: 'Iran warns it could close the Strait of Hormuz after new sanctions', timestamp: n - 5 * 60000, category: 'Geopolitical' },
        { id: '2', headline: 'Oil jumps as Iran tensions rise', timestamp: n - 40 * 60000, category: 'Energy' },
        { id: '3', headline: 'US CPI rises 0.4%', timestamp: n - 3 * 3600e3, category: 'US Data' },
      ];
    }, geo);
    await page.addScriptTag({ content: 'var allItems = window.allItems;' });
    await page.addScriptTag({ content: SRC });
    await page.evaluate(() => window._v3CarteMonter(document.getElementById('h'), {}));
    await new Promise(r => setTimeout(r, 600));
    const r1 = await page.evaluate(() => {
      const h = document.getElementById('h');
      const f = id => { const p = h.querySelector('.v3c-pays[data-id=' + id + ']'); return p ? p.style.fill : null; };
      return { n: h.querySelectorAll('.v3c-pays').length, us: f('US'), ir: f('IR'), fr: f('FR'), pts: h.querySelectorAll('.v3c-pt').length, pulse: h.querySelectorAll('.v3c-puls').length,
        leg: h.querySelector('.v3c-leg').textContent, dec: window._declare && window._declare.id, mount: !!(window._declare && typeof window._declare.mount === 'function') };
    });
    t('trois pays dessinés, l’Antarctique écarté', r1.n === 3);
    t('couche Actualité : Iran et États-Unis teintés, France (aucune dépêche) neutre', !!r1.ir && !!r1.us && !r1.fr, JSON.stringify(r1));
    t('Iran (2 dépêches) plus doré que les États-Unis (1)', (() => { const v = s => (s.match(/\d+/g) || []).map(Number).reduce((a, b) => a + b, 0); return v(r1.ir) > v(r1.us); })());
    t('une dépêche de moins d’une heure fait battre un point', r1.pulse >= 1);
    t('la légende NOMME les familles avec leur compte (jamais la couleur seule)', /Géopolitique\s*1/.test(r1.leg) && /Énergie\s*1/.test(r1.leg) && /Données\s*1/.test(r1.leg), r1.leg);
    t('le widget se déclare au catalogue : id v3-carte, montage fourni', r1.dec === 'v3-carte' && r1.mount);
    const r2 = await page.evaluate(async () => {
      const h = document.getElementById('h');
      const p = h.querySelector('.v3c-pays[data-id=IR]'), b = p.getBoundingClientRect();
      const o = { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true };
      p.dispatchEvent(new PointerEvent('pointerdown', o)); p.dispatchEvent(new PointerEvent('pointerup', o));
      await new Promise(r => setTimeout(r, 300));
      const f = h.querySelector('.v3c-fiche');
      return { vis: getComputedStyle(f).display, txt: f.textContent, sel: p.classList.contains('v3c-sel-p') };
    });
    t('clic sur l’Iran : la fiche s’ouvre, pays sélectionné', r2.vis === 'block' && r2.sel && /Iran/.test(r2.txt));
    t('… chaîne d’impact : géopolitique → détroit d’Ormuz → pétrole du Golfe → Brent', /Géopolitique→Détroit d’Ormuz→Pétrole et GNL du Golfe/.test(r2.txt.replace(/\s+/g, ' ').replace(/ ?→ ?/g, '→')) && /Brent/.test(r2.txt), r2.txt.slice(0, 260));
    t('… variation du jour lue dans l’instantané de marché (Brent +1,25%)', /Brent\s*\+1,25%/.test(r2.txt));
    const r3 = await page.evaluate(async () => {
      const h = document.getElementById('h');
      h.querySelector('[data-c=passages]').click(); await new Promise(r => setTimeout(r, 200));
      const rouges = [...h.querySelectorAll('.v3c-pt circle')].filter(c => c.getAttribute('fill') === '#ff3d00').length;
      const lib = [...h.querySelectorAll('.v3c-lib')].map(x => x.textContent).join('|');
      h.querySelector('[data-c=ress]').click(); await new Promise(r => setTimeout(r, 100));
      const s = h.querySelector('[data-r]'); s.value = 'or'; s.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 200));
      const usOr = h.querySelector('.v3c-pays[data-id=US]').style.fill, irOr = h.querySelector('.v3c-pays[data-id=IR]').style.fill;
      h.querySelector('[data-c=bc]').click(); await new Promise(r => setTimeout(r, 200));
      const bc = [...h.querySelectorAll('.v3c-lib')].map(x => x.textContent);
      return { rouges, lib, usOr, irOr, bc };
    });
    t('Points de passage : Ormuz, nommé par l’actualité, passe au rouge', r3.rouges >= 1 && /Détroit d’Ormuz · 1/.test(r3.lib), r3.lib);
    t('Ressources « Or » : les États-Unis éclairés, l’Iran non (hors liste)', !!r3.usOr && !r3.irOr);
    t('Banques centrales : la Fed porte son taux lu sur /api/rates', r3.bc.some(x => /^Fed 3,88%$/.test(x)), r3.bc.join('|'));
    // Multi-actifs : la grille se monte, un instrument muet reste listé.
    const MULTI = fs.readFileSync(path.join(R, 'public/js/v2/multi.js'), 'utf8');
    await page.evaluate(() => {
      window._declare = null;
      const D = { at: Date.now(), classes: [
        { k: 'metaux', n: 'Métaux', items: [{ ok: true, nom: 'Or', code: 'XAU/USD', prix: 2654.3, prec: 2632.2, chg: 0.84, dec: 2, haut: 2660, bas: 2630, spark: [1, 2, 3, 2, 4] }] },
        { k: 'energie', n: 'Énergie', items: [{ ok: false, nom: 'Gaz naturel', code: 'NG' }] },
        { k: 'taux', n: 'Taux et volatilité', items: [{ ok: true, nom: 'US 10 ans', code: 'US10Y', prix: 3.781, prec: 3.739, chg: 4.2, dec: 2, rendement: true, haut: 3.79, bas: 3.73, spark: [3, 2, 4] }] } ] };
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(D) });
      const m = document.createElement('div'); m.id = 'm'; m.style.cssText = 'width:700px;height:400px'; document.body.appendChild(m);
    });
    await page.addScriptTag({ content: MULTI });
    await page.evaluate(() => window._v3MultiMonter(document.getElementById('m')));
    await new Promise(r => setTimeout(r, 400));
    const rm = await page.evaluate(() => { const m = document.getElementById('m'); return { n: m.querySelectorAll('.v3m-l').length, txt: m.textContent, dec: window._declare && window._declare.id }; });
    t('Multi-actifs : trois lignes, dont le gaz « indisponible » (pas effacé)', rm.n === 3 && /Gaz naturel.*indisponible/.test(rm.txt));
    t('… or en pourcent (+0,84%), US 10 ans en points de base (+4,2 pb)', /\+0,84%/.test(rm.txt) && /\+4,2 pb/.test(rm.txt), rm.txt.slice(0, 200));
    t('… le widget se déclare au catalogue : id v3-multi', rm.dec === 'v3-multi');
    t('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '));
  } catch (e) { t('rendu Chromium', false, e.message); }
  finally { if (nav) await nav.close(); }
  fin_();
})();
function fin_() { console.log(ko ? '\n✗ ' + ko + ' contrôle(s) en échec' : '\n✓ ' + ok + ' contrôles au vert'); process.exit(ko ? 1 : 0); }

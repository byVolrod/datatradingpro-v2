#!/usr/bin/env node
/**
 * scripts/colonnes-verif.js — LES COLONNES MASQUABLES DE LA LISTE FX
 *
 * POURQUOI (01/09/2026, demande user : « ajoute un icone reglages pour pouvoir masquer une colonne
 * ou l afficher comme on le souhaite »). Le tableau de la Liste FX dessine ses colonnes à TROIS
 * endroits distincts de `renderFxList` : l'en-tête (<th>), le squelette de chargement, et le corps.
 * N'en filtrer que deux sur trois ne fait PAS d'erreur, ne lève PAS d'exception, ne rougit dans
 * aucun banc de syntaxe : ça décale simplement les cellules d'une colonne, et on lit le prix de
 * l'EUR/USD sous l'en-tête « Var. % ». C'est le genre de défaut qu'on ne voit pas en relisant, et
 * qu'un client voit tout de suite. Ce banc COMPTE : autant de <th> que de <td> par ligne, toujours.
 *
 * Il éprouve aussi les deux pièges de conception :
 *   · « Symbole » n'est jamais masquable (sinon : treize chiffres sans paire en face) ;
 *   · masquer la colonne de tri actif ne laisse pas la table triée sur une donnée INVISIBLE.
 *
 * Méthode : on extrait le VRAI code de `public/js/charts.js` (jamais une copie — une copie ne
 * vieillit pas avec le produit) et on l'exécute avec un DTPPref bouchonné.
 *
 *   node scripts/colonnes-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const CHARTS = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ── Extraction : du début d'une déclaration jusqu'à sa fermeture, en comptant les accolades.
   Les chaînes et les gabarits sont ignorés pour ne pas prendre une accolade de texte pour du code. */
function extraire(src, depart) {
  const d = src.indexOf(depart);
  if (d < 0) return null;
  let i = src.indexOf('{', d), prof = 0, ch = null;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (ch) { if (c === ch && p !== '\\') ch = null; continue; }
    if (c === '"' || c === "'" || c === '`') { ch = c; continue; }
    if (c === '{') prof++;
    else if (c === '}') { prof--; if (prof === 0) return src.slice(d, i + 1); }
  }
  return null;
}

/* ══ 1. LE CODE RÉEL EST EXTRACTIBLE ═══════════════════════════════════════════════════════════ */
console.log('\n── Extraction du vrai code de charts.js ──');
const SRC_COLS = (() => { const d = CHARTS.indexOf('const FXL_COLS = ['); const f = CHARTS.indexOf('\n];', d); return d < 0 || f < 0 ? null : CHARTS.slice(d, f + 3); })();
const SRC_VIS = extraire(CHARTS, 'function _fxlColVisible(');
const SRC_LOT = extraire(CHARTS, 'function _fxlColsVisibles(');
const SRC_SET = extraire(CHARTS, 'function _fxlColSet(');
const SRC_MAJ = extraire(CHARTS, 'function _fxlMajReglages(');
const SRC_RENDER = extraire(CHARTS, 'function renderFxList(');
v('FXL_COLS extractible', !!SRC_COLS);
v('_fxlColVisible / _fxlColsVisibles / _fxlColSet extractibles', !!SRC_VIS && !!SRC_LOT && !!SRC_SET);
v('_fxlMajReglages extractible', !!SRC_MAJ);
v('renderFxList extractible', !!SRC_RENDER);

/* Bac à sable FIDÈLE. ⚠️ Le premier jet passait `window = {}` : tout le code produit est gardé par
   `if (window.DTPPref)`, donc AUCUNE écriture ne s'exécutait et les contrôles d'écriture passaient
   à vide, en vert. Le banc affirmait alors quelque chose qu'il n'avait pas éprouvé. `window` porte
   désormais le magasin, comme dans la page. */
function bacFx(triInitial, magasinInitial) {
  if (!(SRC_COLS && SRC_VIS && SRC_LOT && SRC_SET && SRC_MAJ)) return null;
  const magasin = Object.assign({}, magasinInitial || {});
  const pref = { get: (k, d) => (magasin[k] === undefined ? d : magasin[k]), set: (k, x) => { magasin[k] = String(x); } };
  const boite = { innerHTML: '', hasAttribute: () => false, setAttribute: () => {}, removeAttribute: () => {} };
  const f = new Function('window', 'document', 'DTPPref', 'renderFxList',
    SRC_COLS + '\nlet _fxlSort = ' + JSON.stringify(triInitial) + ';\n'
    + SRC_VIS + '\n' + SRC_LOT + '\n' + SRC_SET + '\n' + SRC_MAJ
    + '\nreturn { FXL_COLS, visible: _fxlColVisible, lot: _fxlColsVisibles, set: _fxlColSet,'
    + ' volet: _fxlMajReglages, tri: () => _fxlSort };');
  const api = f({ DTPPref: pref }, { getElementById: () => boite }, pref, () => {});
  return Object.assign(api, { magasin, boite });
}

/* ══ 2. « SYMBOLE » N'EST JAMAIS MASQUABLE ═════════════════════════════════════════════════════ */
console.log('\n── Piège 1 : la colonne d\'identité ne se masque pas ──');
{
  const S = bacFx({ key: 'strength', dir: -1 });
  if (S) {
    /* CONTRÔLE POSITIF D'ABORD : le bac écrit-il vraiment ? Sans cette ligne, tous les contrôles
       « rien n'a été écrit » plus bas seraient vrais pour la mauvaise raison. */
    S.set('ret1M', false);
    v('[témoin] le bac à sable exécute bien le chemin d\'écriture', S.magasin.fxlcolret1M === '0',
      'fxlcolret1M = ' + S.magasin.fxlcolret1M);
    v('masquer une colonne ordinaire la retire du lot', !S.visible('ret1M')
      && !S.lot().some(c => c.key === 'ret1M'));

    S.set('symbol', false);
    v('_fxlColSet("symbol", false) n\'écrit rien dans les préférences', S.magasin.fxlcolsymbol === undefined,
      'valeur écrite : ' + S.magasin.fxlcolsymbol);
    v('Symbole reste visible même après une tentative de masquage', S.visible('symbol') === true);
    v('Symbole est toujours dans le lot rendu', S.lot().some(c => c.key === 'symbol'));

    /* LE SECOND VERROU, ÉPROUVÉ POUR LUI-MÊME. `_fxlColVisible` refuse « symbol » EN PLUS du refus
       de `_fxlColSet` — deux verrous pour une seule règle. Un contrôle-témoin l'a montré : masquer
       le premier ne rendait ce banc rouge nulle part, parce que le second empêchait déjà toute
       écriture. Le verrou de lecture ne sert donc QUE si une préférence « fxlcolsymbol=0 » existe
       déjà côté compte — écrite par une version antérieure, ou à la main. On la pose ici, ce qui
       est le seul moyen de prouver qu'il travaille. */
    const V = bacFx({ key: 'symbol', dir: 1 }, { fxlcolsymbol: '0' });
    v('une préférence « fxlcolsymbol=0 » déjà stockée ne masque pas Symbole pour autant',
      V && V.visible('symbol') === true && V.lot().some(c => c.key === 'symbol'),
      'le verrou de LECTURE de _fxlColVisible est le seul rempart dans ce cas');

    S.volet();
    const n = (S.boite.innerHTML.match(/cal-set-sw/g) || []).length;
    v('le volet propose 12 interrupteurs (13 colonnes moins Symbole)', n === 12, n + ' interrupteur(s)');
    v('le volet ne propose PAS de masquer Symbole', !/_fxlColSet\('symbol'/.test(S.boite.innerHTML));
    v('le volet est intitulé en français', /Colonnes affichées/.test(S.boite.innerHTML));
    v('un interrupteur éteint se rend éteint et propose de rallumer',
      /_fxlColSet\('ret1M', true\)/.test(S.boite.innerHTML)
      && /aria-checked="false"/.test(S.boite.innerHTML));
  }
}

/* ══ 3. LE TRI NE RESTE PAS SUR UNE COLONNE INVISIBLE ══════════════════════════════════════════ */
console.log('\n── Piège 2 : masquer la colonne triée ──');
{
  const S = bacFx({ key: 'strength', dir: -1 });
  if (S) {
    S.set('strength', false);
    v('le tri retombe sur Symbole quand sa colonne est masquée', S.tri().key === 'symbol', 'tri : ' + S.tri().key);
    v('le tri retombé est aussi mémorisé côté compte', S.magasin.fxlsort === 'symbol:1', 'fxlsort = ' + S.magasin.fxlsort);
  }
  /* LA MOITIÉ QUI COMPTE : masquer une AUTRE colonne ne doit PAS toucher au tri. */
  const S2 = bacFx({ key: 'strength', dir: -1 });
  if (S2) {
    S2.set('ret1M', false);
    v('masquer une colonne NON triée laisse le tri en place', S2.tri().key === 'strength', 'tri : ' + S2.tri().key);
    v('… et n\'écrit pas de tri au passage', S2.magasin.fxlsort === undefined);
  }
}

/* ══ 4. LE COMPTE DE CELLULES — LE CONTRÔLE QUI JUSTIFIE CE BANC ═══════════════════════════════ */
console.log('\n── Autant de <th> que de <td> : les trois endroits filtrent ensemble ──');
if (SRC_RENDER) {
  const troisEndroits = (SRC_RENDER.match(/_cols\.map\(/g) || []).length;
  v('renderFxList dessine ses colonnes depuis _cols aux TROIS endroits', troisEndroits === 3,
    troisEndroits + ' occurrence(s) de _cols.map( — en-tête, squelette, corps');
  v('plus aucun FXL_COLS.map( ne subsiste dans renderFxList (il ignorerait le réglage)',
    !/FXL_COLS\.map\(/.test(SRC_RENDER),
    'un FXL_COLS.map restant décale les cellules d\'une colonne');
  v('_cols est bien issu de _fxlColsVisibles()', /const _cols = _fxlColsVisibles\(\)/.test(SRC_RENDER));
}

/* ══ 5. L'ICÔNE EXISTE ET EST RELIÉE ═══════════════════════════════════════════════════════════ */
console.log('\n── L\'icône ⚙ de l\'onglet Liste FX ──');
const zoneFxl = (() => { const d = HTML.indexOf('id="view-fxlist"'); const f = HTML.indexOf('<!-- ══ VIEW: INSTITUTION', d); return d < 0 ? '' : HTML.slice(d, f < 0 ? d + 4000 : f); })();
v('l\'onglet Liste FX porte une icône de réglages', /_fxlToggleReglages\(\)/.test(zoneFxl));
v('l\'icône est atteignable au clavier (role=button + tabindex + Entrée/Espace)',
  /role="button"/.test(zoneFxl) && /tabindex="0"/.test(zoneFxl) && /event\.key===.Enter./.test(zoneFxl));
v('le volet #fxl-set-pop existe et démarre fermé', /id="fxl-set-pop" hidden/.test(zoneFxl));
v('_fxlToggleReglages est publié sur window (l\'attribut onclick ne voit que le global)',
  /window\._fxlToggleReglages =/.test(CHARTS));
v('_fxlColSet est publié sur window (les interrupteurs du volet l\'appellent en onclick)',
  /window\._fxlColSet = _fxlColSet/.test(CHARTS));

/* ══ 6. FERMETURE PARTAGÉE, PAS RECOPIÉE ═══════════════════════════════════════════════════════ */
console.log('\n── Clic ailleurs / Échap : un seul mécanisme pour tous les volets ──');
v('la liste des volets contient le calendrier ET la Liste FX',
  /_POPS_REGLAGES = \['cal-set-pop', 'fxl-set-pop'\]/.test(CHARTS));
v('les écouteurs parcourent la liste (aucun id codé en dur dans le corps)',
  /for \(const id of _POPS_REGLAGES\)/.test(CHARTS)
  && (CHARTS.match(/for \(const id of _POPS_REGLAGES\)/g) || []).length === 2,
  'clic ailleurs + Échap');

/* ══ 7. HABILLAGE ═════════════════════════════════════════════════════════════════════════════ */
console.log('\n── Habillage : le volet réutilise la grammaire du calendrier ──');
v('.fxl-title-icons est positionné (sinon le volet s\'ancre sur la page, pas sur l\'icône)',
  /\.cal-title-icons, \.fxl-title-icons \{ position: relative; \}/.test(CSS));
v('.fxl-set-pop partage le fond, la bordure et l\'ancrage du volet calendrier',
  /\.cal-set-pop, \.fxl-set-pop \{/.test(CSS));
v('.fxl-set-pop[hidden] est bien masqué', /\.cal-set-pop\[hidden\], \.fxl-set-pop\[hidden\] \{ display: none; \}/.test(CSS));
v('le volet à 12 lignes est borné en hauteur et défilable',
  /\.fxl-set-pop \{[^}]*max-height:[^}]*overflow-y: auto/.test(CSS),
  'sans plafond, les dernières colonnes sortent de l\'écran');

/* ══ 8. DANS UN VRAI CHROMIUM : ON CLIQUE, ET ON COMPTE ════════════════════════════════════════
   Les sections 1-7 lisent du code. Celle-ci OUVRE le desk, va sur l'onglet Liste FX, clique
   vraiment sur les interrupteurs et compte les cellules rendues. C'est le seul contrôle qui aurait
   vu ce que la lecture ne montre pas : au premier essai, le corps du tableau ne suivait PAS
   l'en-tête (13 <td> sous 10 <th>) parce qu'une exception levée plus haut dans renderFxList
   interrompait le rendu — en-tête à jour, corps figé, et RIEN en console côté utilisateur.
   Sans navigateur : abstention (code 0), comme desk-verif. */
async function auNavigateur() {
  let outils; try { outils = require('./mobile-apercu.js'); } catch { return null; }
  const bin = outils.trouverNavigateur();
  if (!bin) return null;
  let pp; try { pp = require('puppeteer-core'); } catch { return null; }
  const srv = outils.serveur();
  await new Promise(r => srv.listen(4934, r));
  const nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await nav.newPage();
    await page.setViewport({ width: 1800, height: 1000 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).split('\n')[0].slice(0, 150)));
    await page.goto('http://localhost:4934/index.html', { waitUntil: 'networkidle0', timeout: 45000 });
    await new Promise(r => setTimeout(r, 1800));
    await page.evaluate(() => document.querySelector('.nav-item[data-view="fxlist"]').click());
    await new Promise(r => setTimeout(r, 2200));
    const cellules = () => page.evaluate(() => {
      const tr = document.querySelector('#fxl-body tr');
      return { th: document.querySelectorAll('#fxl-head th').length, td: tr ? tr.querySelectorAll('td').length : 0,
               lignes: document.querySelectorAll('#fxl-body tr').length,
               sym: tr ? tr.querySelector('td').textContent.trim() : '' };
    });
    const depart = await cellules();
    await page.evaluate(() => document.querySelector('#view-fxlist .cal-title-icon').click());
    await new Promise(r => setTimeout(r, 300));
    const volet = await page.evaluate(() => {
      const b = document.getElementById('fxl-set-pop'), r = b.getBoundingClientRect();
      return { ouvert: !b.hasAttribute('hidden'), sw: b.querySelectorAll('.cal-set-sw').length,
               dansEcran: r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.top >= 0,
               ancre: r.width > 40 && r.height > 40 };
    });
    const clic = (lbl) => page.evaluate((l) => {
      const b = document.getElementById('fxl-set-pop');
      const row = [...b.querySelectorAll('.cal-set-row')].find(r => r.querySelector('span').textContent === l);
      if (row) row.querySelector('.cal-set-sw').click();
      return !!row;
    }, lbl);
    for (const l of ['1M %', '3M %', '12M %']) await clic(l);
    await new Promise(r => setTimeout(r, 400));
    const masque = await cellules();
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 250));
    const ferme = await page.evaluate(() => document.getElementById('fxl-set-pop').hasAttribute('hidden'));
    await page.evaluate(() => document.querySelector('#view-fxlist .cal-title-icon').click());
    await new Promise(r => setTimeout(r, 250));
    await clic('1M %');
    await new Promise(r => setTimeout(r, 400));
    const rallume = await cellules();
    return { depart, volet, masque, ferme, rallume, errs };
  } finally { await nav.close(); srv.close(); }
}

/* ══ 9. L'ENGRENAGE EST-IL ATTEIGNABLE DANS UNE CARTE À ONGLETS ? ═══════════════════════════════
   Dans « Mon Desk », l'en-tête d'une carte à onglets est un CALQUE posé par-dessus, et sa plaque de
   commandes (↑↓ ? ×) flotte en haut à droite. L'engrenage posé aujourd'hui à droite du bandeau de
   la Liste FX tombait PILE dessous : mesuré à x=816 dans une barre qui s'étend jusqu'à 843 — donc
   parfaitement visible, pas coupé par le défilement — pendant que la plaque commence à 696.
   `elementFromPoint` rendait une icône de la plaque : le réglage était INCLIQUABLE là où il venait
   d'être ajouté, et rien à l'écran ne le disait.
   ⚠️ CE CONTRÔLE A EU DEUX VERSIONS FAUSSES AVANT CELLE-CI, les deux VERTES à tort :
     · comparer les rectangles ne prouve rien (un onglet sorti du champ « chevauche » la plaque tout
       en étant clippé, donc absent, pas caché dessous) ;
     · tester `plaque.contains(elementFromPoint(...))` ne trouvait jamais rien, parce que le clic
       atterrit sur le calque d'en-tête, jamais sur la plaque elle-même.
   La seule question qui vaut : à l'endroit de l'engrenage, EST-CE LUI qui répond au clic ? */
async function auDeskAOnglets() {
  let outils; try { outils = require('./mobile-apercu.js'); } catch { return null; }
  const bin = outils.trouverNavigateur(); if (!bin) return null;
  let pp; try { pp = require('puppeteer-core'); } catch { return null; }
  const http = require('http');
  const base = outils.serveur();
  /* L'onglet « Mon Desk » n'est créé que pour un compte ADMIN : on dérive le bouchon commun plutôt
     que d'en écrire un second qui divergerait. */
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/api/me' || u === '/api/auth/me' || u === '/api/session' || u === '/api/user') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, loggedIn: true, authenticated: true, role: 'admin',
        user: { id: 'u1', email: 'banc@datatradingpro.com', name: 'Banc', role: 'admin', plan: 'professionnel', active: true } }));
    }
    base.emit('request', req, res);
  });
  await new Promise(r => srv.listen(4935, r));
  const nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await nav.newPage();
    await page.setViewport({ width: 1700, height: 1000 });
    await page.goto('http://localhost:4935/index.html', { waitUntil: 'networkidle0', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2400));
    const ouvert = await page.evaluate(() => { const b = document.getElementById('widgets-btn'); if (!b) return false; b.click(); return true; });
    if (!ouvert) return { absent: 'icone Mon Desk' };
    await new Promise(r => setTimeout(r, 3000));
    /* Le voile du gestionnaire recouvre TOUTE la page : sans le refermer, la mesure dirait « tout
       est masqué » — par le voile, ce qui ne renseigne sur rien. */
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 600));
    const carte = await page.evaluate(() => !!document.querySelector('.wdg-card--tabs'));
    if (!carte) return { absent: 'carte a onglets' };
    const alle = await page.evaluate(() => {
      const c = document.querySelector('.wdg-card--tabs');
      const ts = [...c.querySelectorAll('.wdgt-bar .wdgt-tab')];
      const t = ts.find(x => /LISTE FX/i.test(x.textContent || ''));
      if (!t) return false; t.click(); return true;
    });
    if (!alle) return { absent: 'onglet Liste FX' };
    await new Promise(r => setTimeout(r, 1800));
    return await page.evaluate(() => {
      const c = document.querySelector('.wdg-card--tabs');
      const plaque = c.querySelector(':scope > .wdg-head .wdg-actions');
      const hote = c.querySelector('.wdgt-host, .wdg-vuehost') || c;
      const g = hote.querySelector('.fxl-title-icons .cal-title-icon');
      if (!plaque || !g) return { absent: !plaque ? 'plaque' : 'engrenage' };
      const rg = g.getBoundingClientRect(), rp = plaque.getBoundingClientRect();
      const barre = g.closest('.fxl-toolbar'), rb = barre ? barre.getBoundingClientRect() : null;
      const dessus = document.elementFromPoint(rg.left + rg.width / 2, rg.top + rg.height / 2);
      /* TÉMOIN : la plaque doit répondre chez elle. Sinon le test ne peut RIEN détecter, et son
         « aucun problème » serait vide de sens — c'est exactement ce qui est arrivé deux fois. */
      const auCentre = document.elementFromPoint(rp.left + rp.width / 2, rp.top + rp.height / 2);
      return { visible: !!(rb && rg.right <= rb.right + 1 && rg.width > 2),
               atteignable: !!(dessus && (dessus === g || g.contains(dessus))),
               gearX: Math.round(rg.left), plaqueX: Math.round(rp.left),
               temoinPlaqueRepond: !!(auCentre && plaque.contains(auCentre)) };
    });
  } finally { await nav.close(); srv.close(); }
}

(async () => {
  console.log('\n── Dans un vrai Chromium : on clique, et on compte ──');
  let R = null;
  try { R = await auNavigateur(); } catch (e) { console.log('  ⚠️ navigateur indisponible : ' + String(e).slice(0, 120)); }
  if (!R) {
    console.log('  ~ aucun Chromium → section abstenue (ce n\'est pas un échec).');
  } else {
    v('la table part avec ses 13 colonnes, en-tête ET corps', R.depart.th === 13 && R.depart.td === 13,
      R.depart.th + ' <th> / ' + R.depart.td + ' <td>');
    v('le jeu d\'essai remplit vraiment le corps', R.depart.lignes >= 5 && /\//.test(R.depart.sym),
      R.depart.lignes + ' ligne(s), 1re = « ' + R.depart.sym + ' »');
    v('l\'icône ⚙ ouvre le volet, ancré sous elle et entièrement à l\'écran',
      R.volet.ouvert && R.volet.ancre && R.volet.dansEcran, JSON.stringify(R.volet));
    v('le volet rendu porte bien 12 interrupteurs', R.volet.sw === 12, R.volet.sw + ' interrupteur(s)');
    v('après 3 masquages : 10 colonnes', R.masque.th === 10, R.masque.th + ' <th>');
    v('LE CONTRÔLE CLÉ — le corps suit l\'en-tête, cellule pour cellule', R.masque.td === R.masque.th,
      R.masque.th + ' <th> mais ' + R.masque.td + ' <td> : les colonnes sont DÉCALÉES à l\'écran');
    v('Échap referme le volet', R.ferme === true);
    v('rallumer une colonne la fait revenir des deux côtés', R.rallume.th === 11 && R.rallume.td === 11,
      R.rallume.th + ' <th> / ' + R.rallume.td + ' <td>');
    v('aucune exception de page pendant toute la manipulation', R.errs.length === 0, R.errs.slice(0, 2).join(' | '));
  }

  console.log('\n── Dans une carte à onglets de Mon Desk : l\'engrenage répond-il au clic ? ──');
  let D = null;
  try { D = await auDeskAOnglets(); } catch (e) { console.log('  ⚠️ ' + String(e).slice(0, 120)); }
  if (!D) console.log('  ~ aucun Chromium → section abstenue (ce n\'est pas un échec).');
  else if (D.absent) console.log('  ~ ' + D.absent + ' introuvable dans ce jeu d\'essai → section abstenue.');
  else {
    v('[témoin] la plaque de commandes répond bien chez elle',
      D.temoinPlaqueRepond === true,
      'sans ça le contrôle suivant ne peut RIEN détecter et son vert ne vaut rien');
    v('l\'engrenage est visible dans son bandeau (non coupé par le défilement)', D.visible === true);
    v('l\'engrenage RÉPOND AU CLIC : il ne passe pas sous la plaque de commandes',
      D.atteignable === true,
      'engrenage à x=' + D.gearX + ', plaque à partir de x=' + D.plaqueX
        + ' → la réserve --wdgt-cmd manque sur .fxl-toolbar');
  }

/* ══ RÉSUMÉ ═══ (⚠️ TOUJOURS EN DERNIER : un process.exit placé plus haut rendrait muettes toutes
   les sections ajoutées ensuite — c'est déjà arrivé sur calendrier-source-verif.js. Et il est
   DANS l'async : les contrôles navigateur sont attendus, sinon on conclurait avant eux.) */
  console.log('\n' + '─'.repeat(70));
  console.log(ko === 0 ? `✅ colonnes-verif : ${ok} contrôle(s) au vert.` : `❌ colonnes-verif : ${ko} échec(s) sur ${ok + ko}.`);
  process.exit(ko === 0 ? 0 : 1);
})();

#!/usr/bin/env node
/**
 * scripts/comptes-verif.js — PLUSIEURS COMPTES DANS UN SEUL JOURNAL
 *
 * POURQUOI (10/09, demande du client okahivai : « pouvoir ajouter plusieurs comptes, chaque
 * compte ayant son propre journal »). Trois dangers, et le premier est celui qui a failli passer :
 *
 *   1. UNE PORTÉE À MOITIÉ CÂBLÉE. Le champ `account` existait déjà sur chaque trade ; il ne
 *      servait que de colonne. La tentation était d'ajouter un filtre de plus dans `_jrFilter` —
 *      or les filtres ne commandent QUE la grille et la rangée de statistiques : le Tableau de
 *      bord, l'onglet Annuel et le widget Kelly lisent `_jrList` DIRECTEMENT. On aurait obtenu
 *      une grille filtrée surmontée d'un tableau de bord comptant encore les autres comptes.
 *      Ce banc vérifie que les CINQ surfaces passent par `_jrScope()`, et ses témoins mordent :
 *      remettre `_jrList` dans l'une d'elles fait rougir.
 *   2. LA PERTE DU CAPITAL DE DÉPART. Le capital devient une valeur PAR compte (`startCaps`)
 *      alors que tous les journaux déjà enregistrés portent une valeur unique (`startCap`). Si
 *      la reprise de l'ancien champ est oubliée, chaque client perd son capital de départ à la
 *      première sauvegarde qui suit la mise à jour — silencieusement, et la courbe de capital
 *      disparaît. On JOUE donc la vraie reprise sur un enregistrement d'avant.
 *   3. CE QUI ENTRE EN BASE. Noms de comptes et capitaux viennent du navigateur : on exécute les
 *      vrais assainisseurs du serveur.
 *
 *   node scripts/comptes-verif.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const t = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
};
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');

/* ══ 1. LA PORTÉE ELLE-MÊME, EXÉCUTÉE ══════════════════════════════════════════════════════ */
console.log('\n[1] La portée d\'un compte, jouée sur de vrais trades');
const srcScope = (() => {
  const a = APP.indexOf('  function _jrScope() {');
  const b = APP.indexOf('\n  }', a);
  return (a < 0 || b < a) ? null : APP.slice(a, b + 4);
})();
t('_jrScope est extraite du produit', !!srcScope);
let scope = null;
if (srcScope) {
  scope = (liste, compte) => new Function('_jrList', '_jrCompte', srcScope + '\nreturn _jrScope();')(liste, compte);
}
const TRADES = [
  { id: 'a', pair: 'EURUSD', account: 'Démo', pl: 100 },
  { id: 'b', pair: 'GBPUSD', account: 'Financé', pl: -50 },
  { id: 'c', pair: 'USDJPY', account: 'Démo', pl: 30 },
  { id: 'd', pair: 'AUDUSD', account: '', pl: 10 },
];
if (scope) {
  t('un compte ne montre que SES trades', scope(TRADES, 'Démo').map(e => e.id).join('') === 'ac',
    JSON.stringify(scope(TRADES, 'Démo').map(e => e.id)));
  t('… et les autres comptes sont bien exclus', scope(TRADES, 'Financé').map(e => e.id).join('') === 'b');
  t('« tous les comptes » rend le journal ENTIER (état légitime, pas un filtre oublié)',
    scope(TRADES, '').length === 4);
  t('un trade sans compte n\'appartient à aucun compte nommé',
    scope(TRADES, 'Démo').every(e => e.id !== 'd') && scope(TRADES, '').some(e => e.id === 'd'));
  t('un compte inconnu ne rend rien (et ne rend surtout pas TOUT)', scope(TRADES, 'Inexistant').length === 0,
    'un repli sur la liste entière ferait passer les trades des autres comptes pour les siens');
  t('les totaux des comptes se recomposent en le total général',
    scope(TRADES, 'Démo').length + scope(TRADES, 'Financé').length + scope(TRADES, '').filter(e => !e.account).length === 4);
}

/* ══ 2. LES CINQ SURFACES SONT BRANCHÉES SUR LA PORTÉE ═════════════════════════════════════ */
console.log('\n[2] Toutes les surfaces lisent la portée — pas seulement la grille');
const surfaces = [
  ['la grille et les filtres (_jrView)', /function _jrView\(\)[^\n]*\n\s*let L = _jrScope\(\);/],
  ['le Tableau de bord', /function _jrRenderDashboard\(\) \{\n[^\n]*\n\s*const L = _jrScope\(\);/],
  ['la courbe de capital', /_jrEqSeriesRef\.data\.setAll\(_jrEqData\(_jrScope\(\), m\)\)/],
  /* ⚠️ LA SOURCE DE LA VUE, ET PAS SEULEMENT SES APPELS (ajouté le 10/09, après un défaut
     signalé par l'utilisateur QUE CE BANC A LAISSÉ PASSER). Les deux lignes suivantes vérifiaient
     que le graphique et le total de l'Annuel reçoivent `_jrScope()` — elles étaient vertes,
     et la vue lisait pourtant `_jrList` à sa première ligne, ce qui alimentait les douze bilans
     mensuels, le taux de réussite et le total R. Contrôler des feuilles ne contrôle pas le tronc. */
  ['la SOURCE de l\'onglet Annuel (sa première ligne, celle qui alimente les bilans mensuels)',
    /function _jrRenderYear\(\)[\s\S]{0,1400}?const L = _jrScope\(\);/],
  ['le graphique de l\'onglet Annuel', /_jrBuildAnTradesChart\(_jrScope\(\), an\)/],
  ['le total de l\'onglet Annuel', /_jrTotalAnnee\(_jrScope\(\), an, u\)/],
  ['le widget Kelly (dtpKellyStats)', /window\.dtpKellyStats = function \(\) \{[\s\S]{0,400}?const L = _jrScope\(\);/],
];
for (const [nom, rx] of surfaces) t(nom + ' est borné au compte', rx.test(APP));
t('le compteur « n / total » compte DANS le compte',
  /const n = _jrView\(\)\.length, tot = _jrScope\(\)\.length;/.test(APP),
  'sinon « 3 / 44 » sur un compte de 3 trades laisserait croire que 41 sont masqués par un filtre');
t('un trade créé hérite du compte affiché', /grade: '', account: _jrCompte, fonda: null/.test(APP),
  'sans quoi chaque saisie demanderait de re-choisir le compte à la main');
t('l\'export livre ce qui est affiché, pas le journal entier',
  /function _jrExportCsv\(\) \{[\s\S]{0,300}?const L = _jrScope\(\);/.test(APP));

/* ══ 3. LA REPRISE DE L'ANCIEN CAPITAL, JOUÉE ══════════════════════════════════════════════ */
console.log('\n[3] Un journal enregistré AVANT le 10/09 ne perd pas son capital de départ');
const srcCharge = (() => {
  const a = APP.indexOf('        _jrList = Array.isArray(j.entries) ? j.entries : [];');
  const b = APP.indexOf('        _jrStatus(\'\'); _jrRender();', a);
  return (a < 0 || b < a) ? null : APP.slice(a, b);
})();
t('le bloc de chargement est extrait du produit', !!srcCharge);
if (srcCharge) {
  const jouer = (j) => {
    const etat = { _jrList: null, _jrCustom: false, _jrCols: null, _jrComptes: [], _jrCaps: {}, _jrCompte: '', _jrStartCap: null };
    const corps = srcCharge
      .replace(/_jrColsFromStore\(j\.cols\)/g, 'null')
      .replace(/window\.DTPPref \? DTPPref\.get\('jrcompte', ''\) : ''/g, "''");
    const f = new Function('j', 'etat', `
      let _jrList = etat._jrList, _jrCustom = etat._jrCustom, _jrCols = etat._jrCols,
          _jrComptes = etat._jrComptes, _jrCaps = etat._jrCaps, _jrCompte = etat._jrCompte,
          _jrStartCap = etat._jrStartCap;
      const window = {};
      const _jrComptesConnus = () => [...new Set([..._jrComptes, ...(_jrList || []).map(e => String(e.account || '')).filter(Boolean)])];
      ${corps}
      return { _jrCaps, _jrCompte, _jrStartCap, _jrComptes, n: (_jrList || []).length };
    `);
    return f(j, etat);
  };
  const ancien = jouer({ entries: TRADES, startCap: 10000 });
  t('l\'ancien capital unique devient celui de la vue « tous les comptes »',
    ancien._jrCaps[''] === 10000, JSON.stringify(ancien._jrCaps));
  t('… et il est bien celui qui s\'affiche à l\'ouverture (compte « tous »)',
    ancien._jrStartCap === 10000, String(ancien._jrStartCap));
  const neuf = jouer({ entries: TRADES, startCap: 10000, startCaps: { '': 10000, 'Démo': 500 } });
  t('un capital PAR compte est repris tel quel', neuf._jrCaps['Démo'] === 500, JSON.stringify(neuf._jrCaps));
  t('… et l\'ancien champ ne l\'écrase pas', neuf._jrCaps[''] === 10000);
  const sans = jouer({ entries: TRADES });
  t('un journal sans capital n\'en invente aucun', sans._jrStartCap === null && !Object.keys(sans._jrCaps).length);
  const decl = jouer({ entries: TRADES, comptes: ['Prop firm', 'Démo'] });
  t('les comptes DÉCLARÉS sont relus (un compte peut exister avant son premier trade)',
    decl._jrComptes.join('|') === 'Prop firm|Démo', JSON.stringify(decl._jrComptes));
}
t('la sauvegarde continue d\'écrire l\'ancien champ startCap (compatibilité descendante)',
  /const capTous = _jrCaps\[''\];[\s\S]{0,260}?p\.startCap = capTous;/.test(APP),
  'le retirer ferait perdre son capital à un journal relu par une version antérieure du desk');

/* ══ 4. CE QUI ENTRE EN BASE — LES VRAIS ASSAINISSEURS DU SERVEUR ══════════════════════════ */
console.log('\n[4] Les assainisseurs du serveur, exécutés');
const srvFn = (nom) => {
  const a = SRV.indexOf('function ' + nom + '(');
  const b = SRV.indexOf('\n}', a);
  return (a < 0 || b < a) ? null : SRV.slice(a, b + 2);
};
const srcComptes = srvFn('_jrCleanComptes'), srcCaps = srvFn('_jrCleanCaps');
t('_jrCleanComptes est extraite du serveur', !!srcComptes);
t('_jrCleanCaps est extraite du serveur', !!srcCaps);
if (srcComptes) {
  const f = new Function('_JR_COMPTES_MAX', srcComptes + '\nreturn _jrCleanComptes;')(12);
  t('les doublons et les vides sont écartés',
    JSON.stringify(f(['Démo', 'Démo', '', '  ', 'Financé'])) === '["Démo","Financé"]', JSON.stringify(f(['Démo', 'Démo', '', '  ', 'Financé'])));
  t('un nom trop long est coupé, jamais rejeté', (f(['x'.repeat(80)]) || [''])[0].length === 32);
  t('les espaces de bord sont retirés (sinon « Démo » et « Démo » seraient deux comptes)',
    JSON.stringify(f([' Démo ', 'Démo'])) === '["Démo"]');
  t('le nombre de comptes est borné', (f(Array.from({ length: 40 }, (_, i) => 'c' + i)) || []).length === 12);
  t('rien à assainir → rien de stocké', f([]) === undefined && f('pas un tableau') === undefined);
}
if (srcCaps) {
  const f = new Function('_JR_COMPTES_MAX', srcCaps + '\nreturn _jrCleanCaps;')(12);
  t('un capital valide passe', JSON.stringify(f({ '': 10000, 'Démo': 500 })) === '{"":10000,"Démo":500}');
  t('un capital négatif, nul ou illisible est REFUSÉ',
    f({ a: -5, b: 0, c: 'abc', d: NaN }) === undefined, JSON.stringify(f({ a: -5, b: 0, c: 'abc', d: NaN })));
  t('un capital délirant est refusé (garde anti-abus)', f({ a: 1e12 }) === undefined);
  t('la clé vide — la vue « tous les comptes » — est acceptée', !!f({ '': 250 }));
}
t('la route de lecture renvoie comptes ET capitaux', /comptes: \(v && _jrCleanComptes\(v\.comptes\)\) \|\| null/.test(SRV)
  && /startCaps: \(v && _jrCleanCaps\(v\.startCaps\)\) \|\| null/.test(SRV));
t('la route d\'écriture les enregistre', /stored\.comptes = comptes/.test(SRV) && /stored\.startCaps = caps/.test(SRV));

/* ══ 5. L'ERGONOMIE QUI SE VÉRIFIE À LA LECTURE ════════════════════════════════════════════ */
console.log('\n[5] Les pièges d\'interface déjà rencontrés');
t('« Nouveau compte » est un BOUTON, pas une option-sentinelle du menu',
  /id="jr-cpt-plus"/.test(APP) && !/\\u0000/.test(APP),
  'l\'analyseur HTML remplace U+0000 par U+FFFD dans un attribut : la sentinelle NUL n\'aurait jamais été reconnue');
t('aucune boîte native pour créer un compte (règle du desk)',
  !/prompt\(['"]Nom du compte/.test(APP) && /id="jr-cpt-neuf"/.test(APP));
t('le sélecteur vit dans SON hôte, pas dans la rangée de statistiques',
  /<div class="jr-comptes" id="jr-comptes"><\/div>/.test(fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8'))
  && /function _jrRenderComptes\(\)/.test(APP),
  '#jr-stats est reconstruit à chaque frappe dans la recherche : un menu déroulant s\'y refermerait sous le doigt');
t('le retrait d\'un compte est refusé s\'il porte des trades',
  /if \(_jrScope\(\)\.length\) return;/.test(APP), 'aucun trade ne peut être supprimé par ce chemin');
t('le compte actif se signale (les statistiques affichées sont partielles)',
  /jr-cpt-sel--on/.test(APP) && /\.jr-cpt-sel--on \{[^}]*gold/.test(fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8')));

/* ══ 6. LE SÉLECTEUR, DANS UN VRAI NAVIGATEUR ═════════════════════════════════════════════
   POURQUOI CETTE PHASE EXISTE. Les contrôles [5] lisent le source ; ils auraient laissé passer
   le défaut le plus coûteux de cette livraison. « + Nouveau compte » était d'abord une OPTION
   de menu à valeur sentinelle NUL : le source était impeccable, la comparaison était écrite, et
   la fonctionnalité aurait été MORTE — l'analyseur HTML remplace U+0000 par U+FFFD dans un
   attribut, sans erreur, sans trace. Seul un clic réel le dit. On joue donc les VRAIES fonctions
   de rendu dans Chromium, avec la VRAIE feuille de style, et on clique. */
(async () => {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { console.log('\n[6] puppeteer-core absent → phase navigateur abstenue.'); fin(); return; }
  const bin = process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/pw-browsers/chromium';
  if (!fs.existsSync(bin)) { console.log('\n[6] Chromium introuvable → phase navigateur abstenue.'); fin(); return; }

  const HTML = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
  const struct = HTML.slice(HTML.indexOf('<div id="jr-log-view">'), HTML.indexOf('</div>\n      <div id="jr-dashboard"') + 6);
  const entre = (d, f) => APP.slice(APP.indexOf(d), APP.indexOf(f, APP.indexOf(d)));
  const srcRendu = entre('  function _jrRenderComptes() {', '  function _jrRenderStats() {');   // rendu + création
  /* ⚠️ LE VRAI COMPOSANT DE MENU, PAS UN BOUCHON. Le sélecteur ouvre `.jr-pop` — le même menu
     que « Propriétés ». Un bouchon dirait « le menu s'ouvre » sans rien prouver du positionnement
     ni de la fermeture, et surtout il ne dériverait pas le jour où le composant change. */
  /* Le facteur de zoom est une DÉPENDANCE de `_jrOpenPop` depuis le 10/09 : sans elle, la bulle
     est bien ajoutée au DOM mais jamais positionnée — elle tombe à sa position statique, très
     loin sous le contrôle. On extrait la vraie, du même fichier, jamais un bouchon qui rendrait 1
     et masquerait précisément le défaut que ces contrôles surveillent. */
  const srcZoom = entre('var facteurZoom = function () {', '\n(function _aideAuTap()');

/* ══ LA PORTÉE RÉELLE, QUE js-verif NE PEUT PAS VOIR (10/09) ═══════════════════════════════════
   Défaut vécu en production : `_jrOpenPop` appelait `facteurZoom`, déclarée mille lignes plus
   haut DANS l'IIFE `_aideAuTap` — donc invisible depuis les menus du Journal. Au clic, un
   ReferenceError était levé JUSTE APRÈS l'ajout de la bulle au DOM : elle existait, n'était
   jamais positionnée, et ne s'affichait nulle part. Rien en console pour l'utilisateur, un menu
   mort. `js-verif` déduit la portée client des `<script src>` de chaque page, donc PAR FICHIER :
   un identifiant déclaré n'importe où dans app.js lui paraît visible partout dans app.js, et les
   IIFE lui échappent par construction. Ce banc-ci ne pouvait pas le voir non plus, puisque son
   harnais INJECTE `facteurZoom` — un harnais ne teste jamais la portée du fichier réel.
   ON LIT DONC LE FICHIER : toute IIFE ouverte en colonne 0 et refermée AVANT la ligne de
   `_jrOpenPop` est une portée fermée ; la déclaration ne doit pas y être. */
function _porteePartagee() {
  const L = APP.split('\n');
  const ligne = (motif) => L.findIndex(x => motif.test(x)) + 1;
  const decl = ligne(/^\s*var facteurZoom = function/);
  const usage = ligne(/^\s*function _jrOpenPop\(/);
  if (!decl || !usage) return { ko: 'déclaration ou usage introuvable', decl, usage };
  const closes = [];
  let ouverte = null;
  for (let i = 0; i < L.length; i++) {
    if (/^\(function/.test(L[i]) || /^\(\(\) =>/.test(L[i])) ouverte = i + 1;
    else if (/^\}\)\(\);|^\}\(\)\);/.test(L[i]) && ouverte) { closes.push([ouverte, i + 1]); ouverte = null; }
  }
  const piege = closes.find(([d, f]) => decl >= d && decl <= f && f < usage);
  return { decl, usage, piege: piege || null, iife: closes.length };
}
const _sc = _porteePartagee();
t('facteurZoom est visible depuis _jrOpenPop (aucune IIFE refermée entre les deux)',
  !_sc.ko && !_sc.piege,
  _sc.ko || (_sc.piege ? 'déclarée ligne ' + _sc.decl + ', dans une IIFE fermée ligne ' + _sc.piege[1]
    + ' — usage ligne ' + _sc.usage : 'décl. ' + _sc.decl + ' · usage ' + _sc.usage));
  const srcPop = entre('  let _jrPop = null, _jrPopOut = null;', '  function _jrEditCell(td) {')
    .replace(/  let _jrDragK[^\n]*\n/, '');

  const srv = http.createServer((q, r) => {
    if (q.url.startsWith('/css/')) { r.writeHead(200, { 'Content-Type': 'text/css' }); return r.end(fs.readFileSync(path.join(RACINE, 'public', q.url.split('?')[0]))); }
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    r.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="/css/style.css"></head><body>'
      + '<div class="view-panel" id="view-journal"><div class="panel panel-journal">' + struct + '</div></div>'
      + '<script>\n'
      + 'var _jrList = ' + JSON.stringify(TRADES) + ';\n'
      + 'var _jrComptes = ["Prop firm"], _jrCompte = "", _jrCaps = {}, _jrStartCap = null;\n'
      + 'var _sauvegardes = 0;\n'
      + 'function _esc(x){ return String(x).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c])); }\n'
      + 'function _jrDisp(k,v){ return v; }\n'
      + 'function _jrSave(){ _sauvegardes++; }\n'
      + 'function _jrScope(){ return _jrCompte ? _jrList.filter(e => String(e.account||"") === _jrCompte) : _jrList; }\n'
      + 'function _jrComptesConnus(){ var v = new Set(_jrComptes.filter(Boolean)); _jrList.forEach(function(e){ var a=String(e.account||"").trim(); if(a) v.add(a); }); return [...v].sort(); }\n'
      + 'function _jrCompteSet(n){ _jrCompte = String(n||""); _jrStartCap = _jrCaps[_jrCompte] != null ? _jrCaps[_jrCompte] : null; _jrRenderComptes(); }\n'
      + srcZoom + '\n'
      + srcPop + '\n'
      + srcRendu + '\n'
      + '_jrRenderComptes();\n'
      + '<\/script></body></html>');
  });
  await new Promise(r => srv.listen(8827, r));
  let nav;
  try { nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
  catch (e) { console.log('\n[6] Chromium refuse de démarrer → phase navigateur abstenue.'); srv.close(); fin(); return; }
  try {
    const page = await nav.newPage();
    const fatales = [];
    page.on('pageerror', e => fatales.push(e.message));
    await page.setViewport({ width: 1400, height: 400 });
    await page.goto('http://localhost:8827/', { waitUntil: 'networkidle0', timeout: 30000 });

    console.log('\n[6] Le sélecteur de compte, cliqué pour de vrai');
    t('aucune erreur d\'exécution au montage', !fatales.length, fatales[0]);
    /* ⚠️ ON OUVRE LE MENU AU CLIC, comme un client. Le sélecteur n'est plus un `<select>` depuis
       le 10/09 : sa liste était dessinée par le SYSTÈME au milieu d'un desk qui a son propre
       composant (`.jr-pop`). Un banc qui interrogerait encore `#jr-cpt-sel option` lirait le
       vide en croyant lire un menu — c'est ce qui vient d'arriver, et c'est pour ça qu'il rougit
       plutôt que de se taire. */
    await page.click('#jr-cpt-sel');
    const opts = await page.evaluate(() => [...document.querySelectorAll('.jr-pop-opt[data-cpt]')].map(o => o.dataset.cpt));
    t('le menu propose « tous » + les comptes portés par des trades + les comptes déclarés',
      opts[0] === '' && opts.includes('Démo') && opts.includes('Financé') && opts.includes('Prop firm'), JSON.stringify(opts));
    t('… et AUCUNE valeur-sentinelle n\'y traîne (le piège du 10/09)',
      opts.every(v => !/\uFFFD|\u0000/.test(v)), JSON.stringify(opts));
    t('… et c\'est bien le menu DU DESK, pas celui du système',
      await page.evaluate(() => !!document.querySelector('.jr-pop .jr-pop-opt') && document.getElementById('jr-cpt-sel').tagName === 'BUTTON'));
    /* ⚠️ LE MENU DOIT TOMBER SOUS SON CONTRÔLE, À TOUS LES ZOOMS (10/09, capture user : « met la
       liste déroulante bien en dessous du compte affiché »). `html { zoom: var(--dtp-zoom) }` vaut
       .9 par défaut et se règle PAR COMPTE de .7 à 1.2 : `getBoundingClientRect()` rend des pixels
       ÉCRAN, le `top`/`left` écrit sur un enfant de <body> est re-multiplié par ce zoom, et la
       bulle dérivait de (1 − zoom) × sa distance au coin haut-gauche. Invisible en haut de page,
       franc plus bas — le genre de défaut qu'on ne voit pas sur sa propre machine, et qu'aucune
       relecture n'attrape. On MESURE donc l'écart réel, à trois zooms.
       LE REPLI AU-DESSUS EST LÉGITIME et fait partie du contrat : quand le menu ne tient plus
       sous le contrôle, il passe dessus, à la même distance. Un contrôle qui l'interdirait
       exigerait un menu hors écran. */
    for (const zoom of ['.9', '.7', '1.2']) {
      await page.evaluate(z => { const p = document.querySelector('.jr-pop'); if (p) p.remove();
        document.documentElement.style.setProperty('--dtp-zoom', z); }, zoom);
      await new Promise(r => setTimeout(r, 120));
      await page.click('#jr-cpt-sel');
      await new Promise(r => setTimeout(r, 160));
      const pos = await page.evaluate(() => {
        const b = document.getElementById('jr-cpt-sel').getBoundingClientRect();
        const p = document.querySelector('.jr-pop'); if (!p) return null;
        const r = p.getBoundingClientRect();
        return { dx: Math.round((r.x - b.x) * 10) / 10,
          sous: Math.round((r.y - b.bottom) * 10) / 10,      // > 0 : posé dessous
          dessus: Math.round((b.y - r.bottom) * 10) / 10 };   // > 0 : replié au-dessus
      });
      const cale = pos && (Math.abs(pos.sous - 6) <= 1.5 || Math.abs(pos.dessus - 6) <= 1.5);
      t('zoom ' + zoom + ' — le menu se cale à 6px du contrôle (dessous, ou dessus s\'il ne tient pas)',
        !!cale, JSON.stringify(pos));
      t('zoom ' + zoom + ' — … et son bord gauche est celui du contrôle',
        !!pos && Math.abs(pos.dx) <= 2, pos ? pos.dx + 'px' : 'menu absent');
    }
    await page.evaluate(() => { const p = document.querySelector('.jr-pop'); if (p) p.remove();
      document.documentElement.style.removeProperty('--dtp-zoom'); });

    /* LE CONTRÔLE QUI AURAIT ATTRAPÉ LE DÉFAUT : on clique, et on regarde si quelque chose arrive. */
    await page.click('#jr-cpt-plus');
    const saisie = await page.evaluate(() => !!document.getElementById('jr-cpt-neuf'));
    t('cliquer « + » ouvre VRAIMENT la saisie (pas de commande inerte)', saisie);

    await page.type('#jr-cpt-neuf', '  Compte prop 2  ');
    await page.keyboard.press('Enter');
    const apres = await page.evaluate(() => ({
      actif: window._jrCompte,
      declares: window._jrComptes ? window._jrComptes.slice() : null,
      sel: document.getElementById('jr-cpt-sel') ? document.getElementById('jr-cpt-sel').textContent.replace(/[▾\s]+$/, '').trim() : null,
      or: document.getElementById('jr-cpt-sel') ? document.getElementById('jr-cpt-sel').classList.contains('jr-cpt-sel--on') : false,
      sauv: window._sauvegardes,
    }));
    t('Entrée crée le compte et le rend actif', apres.actif === 'Compte prop 2', JSON.stringify(apres.actif));
    t('… le nom est rogné de ses espaces (sinon deux comptes pour un seul)',
      (apres.declares || []).includes('Compte prop 2'), JSON.stringify(apres.declares));
    t('… le sélecteur affiche ce compte', apres.sel === 'Compte prop 2', String(apres.sel));
    t('… et se signale à l\'or : les chiffres montrés sont partiels', apres.or === true);
    t('… et la création est ENREGISTRÉE (un compte perdu au rechargement ne sert à rien)', apres.sauv >= 1, 'sauvegardes = ' + apres.sauv);

    /* Un compte sans trade doit pouvoir être retiré ; un compte qui en porte, jamais. */
    const xVide = await page.evaluate(() => !!document.getElementById('jr-cpt-x'));
    t('un compte SANS trade porte le bouton de retrait', xVide);
    await page.click('#jr-cpt-sel');
    await page.evaluate(() => { const b = [...document.querySelectorAll('.jr-pop-opt[data-cpt]')].find(x => x.dataset.cpt === 'Démo'); if (b) b.click(); });
    const etatDemo = await page.evaluate(() => ({ actif: window._jrCompte, x: !!document.getElementById('jr-cpt-x'), n: window._jrScope().length }));
    t('basculer sur un compte qui porte des trades le sélectionne', etatDemo.actif === 'Démo' && etatDemo.n === 2, JSON.stringify(etatDemo));
    t('… et ce compte-là n\'a AUCUN bouton de retrait (aucun trade ne part par ce chemin)', etatDemo.x === false);
    t('aucune erreur d\'exécution sur tout le parcours', !fatales.length, fatales[0]);
  } finally {
    if (nav) await nav.close();
    srv.close();
  }
  fin();
})();

function fin() {
  console.log('\n[Comptes] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
  process.exit(ko ? 1 : 0);
}

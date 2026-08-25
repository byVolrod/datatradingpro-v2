#!/usr/bin/env node
/**
 * scripts/js-verif.js — IDENTIFIANTS FANTÔMES DANS LE JS LIVRÉ.
 *
 * POURQUOI (25/08). J'ai supprimé une variable locale (`isHighImpactData`) du constructeur de ligne
 * du fil d'actualité en oubliant qu'elle servait encore soixante lignes plus bas. `node -c` n'y voit
 * rien : la syntaxe est parfaite, l'erreur n'existe qu'à L'EXÉCUTION. Résultat en production : une
 * ReferenceError levée à CHAQUE ligne du fil, donc un FIL D'ACTUALITÉ ENTIÈREMENT VIDE, et rien pour
 * le signaler avant la capture d'écran d'un client.
 *
 * CE QUE FAIT LE CONTRÔLE. Il analyse chaque fichier livré au navigateur, relève tous les
 * identifiants LUS et tous les identifiants DÉCLARÉS (n'importe où : var, let, const, fonction,
 * classe, paramètre, déstructuration, catch), et signale ceux qui sont lus alors qu'ils ne sont
 * déclarés NULLE PART ni connus comme globale.
 *
 * CE QU'IL NE FAIT PAS, ET C'EST VOULU. Il ne fait pas d'analyse de portées : un identifiant déclaré
 * dans une fonction A et lu dans une fonction B lui échappe. Un analyseur de portées à moitié juste
 * produirait des faux positifs, et un contrôle qui crie au loup finit désactivé. Celui-ci ne se
 * trompe jamais — et il attrape la faute qui l'a fait naître : une déclaration retirée dont il reste
 * un usage. Les fautes de frappe aussi.
 *
 *   node scripts/js-verif.js            → contrôle
 *   node scripts/js-verif.js --install  → pose le hook pre-commit
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const RACINE = path.join(__dirname, '..');
// Les fichiers de public/js partagent la portée globale du navigateur : on les analyse ENSEMBLE,
// sinon une fonction définie dans l'un et appelée dans l'autre passerait pour un fantôme.
/* LA PORTÉE CLIENT SE DÉDUIT DES PAGES, ELLE N'EST PAS CODÉE EN DUR. Première version : une liste
   de trois fichiers écrite à la main — elle en oubliait cinq (widgets.js, home.js, sessionmap.js…),
   et `DTPWidgets` passait donc pour un fantôme. Un contrôle qui se trompe finit désactivé. On lit
   donc les <script src> de chaque page : un fichier ajouté demain est couvert sans rien toucher.
   Chaque PAGE forme sa propre portée globale (index.html et admin.html ne chargent pas la même
   chose) ; un fichier chargé par plusieurs pages n'est fautif que s'il l'est dans toutes. */
const PAGES = ['public/index.html', 'public/admin.html', 'public/login.html', 'public/week-ahead.html'];
const SERVEUR = ['server.js', 'walabels.js', 'mailer.js', 'whop.js', 'ai.js', 'auth.js', 'emailWidget.js', 'campaignPreflight.js'];
const VENDOR_RX = /vendor\/|\.min\.js$/;   // bibliothèques tierces : elles fournissent des noms, on ne les juge pas

/* Globales admises. Volontairement LARGE : le but est d'attraper une déclaration disparue, pas de
   discuter la surface du navigateur. Un nom légitime qui manquerait ici s'ajoute en une ligne. */
const GLOBALES = new Set(`
globalThis window document navigator location history screen console alert confirm prompt
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
requestIdleCallback cancelIdleCallback queueMicrotask structuredClone reportError
fetch Request Response Headers FormData URL URLSearchParams Blob File FileReader AbortController
localStorage sessionStorage indexedDB caches crypto performance matchMedia getComputedStyle
Image Audio Option Event CustomEvent MouseEvent KeyboardEvent TouchEvent PointerEvent WheelEvent
Node NodeFilter TreeWalker Range Selection XPathResult Text Comment ShadowRoot customElements
Element HTMLElement HTMLCanvasElement HTMLInputElement HTMLImageElement HTMLFormElement
HTMLSelectElement HTMLTextAreaElement HTMLAnchorElement HTMLVideoElement SVGElement DocumentFragment
CanvasRenderingContext2D Path2D OffscreenCanvas ImageData ImageBitmap MediaQueryList
DragEvent InputEvent FocusEvent ClipboardEvent SubmitEvent PopStateEvent MessageEvent CloseEvent
ProgressEvent AnimationEvent TransitionEvent StorageEvent VisualViewport
NodeList HTMLCollection DOMParser XMLSerializer XMLHttpRequest WebSocket EventSource Worker
IntersectionObserver ResizeObserver MutationObserver PerformanceObserver
Object Array String Number Boolean Symbol BigInt Function Date RegExp Error TypeError RangeError
SyntaxError ReferenceError EvalError URIError AggregateError Promise Proxy Reflect JSON Math
Map Set WeakMap WeakSet WeakRef FinalizationRegistry Intl
ArrayBuffer SharedArrayBuffer DataView Atomics
Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array
Float32Array Float64Array BigInt64Array BigUint64Array
parseInt parseFloat isNaN isFinite encodeURI encodeURIComponent decodeURI decodeURIComponent
escape unescape eval undefined NaN Infinity btoa atob
require module exports process Buffer __dirname __filename global setImmediate clearImmediate
TextEncoder TextDecoder URLPattern AbortSignal ReadableStream WritableStream TransformStream
Notification SpeechSynthesis SpeechSynthesisUtterance speechSynthesis CSS
DecompressionStream CompressionStream ClipboardItem Clipboard IntlSegmenter
am5 am5xy am5themes_Animated am5themes_Dark am5stock am5percent am5radar am5map am5geodata_worldLow
TradingView Chart pdfjsLib
`.trim().split(/\s+/));

// ── Relevé des identifiants ─────────────────────────────────────────────────────────────────────
function motif(n, dec) {                       // déstructuration, défauts, rest…
  if (!n) return;
  if (n.type === 'Identifier') { dec.add(n.name); return; }
  if (n.type === 'ObjectPattern') { for (const p of n.properties) motif(p.type === 'RestElement' ? p.argument : p.value, dec); return; }
  if (n.type === 'ArrayPattern') { for (const e of n.elements) motif(e, dec); return; }
  if (n.type === 'AssignmentPattern') { motif(n.left, dec); return; }
  if (n.type === 'RestElement') { motif(n.argument, dec); return; }
  if (n.type === 'MemberExpression') return;   // `[a.b] = x` : ce n'est pas une déclaration
}
function analyser(src, fichier) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
  const declares = new Set(), exclus = new Set(), lectures = [];
  walk.full(ast, node => {
    switch (node.type) {
      case 'VariableDeclarator': motif(node.id, declares); break;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        if (node.id) { declares.add(node.id.name); exclus.add(node.id); }
        for (const p of node.params) motif(p, declares);
        break;
      case 'ClassDeclaration': case 'ClassExpression':
        if (node.id) { declares.add(node.id.name); exclus.add(node.id); }
        break;
      case 'CatchClause': if (node.param) motif(node.param, declares); break;
      // Ce qui n'est PAS une lecture de variable :
      case 'MemberExpression': if (!node.computed) exclus.add(node.property); break;
      case 'Property': if (!node.computed && !node.shorthand) exclus.add(node.key); break;
      case 'MethodDefinition': case 'PropertyDefinition': if (!node.computed) exclus.add(node.key); break;
      case 'UnaryExpression': if (node.operator === 'typeof' && node.argument.type === 'Identifier') exclus.add(node.argument); break;
      case 'LabeledStatement': exclus.add(node.label); break;
      case 'BreakStatement': case 'ContinueStatement': if (node.label) exclus.add(node.label); break;
    }
  });
  // Les identifiants de déclaration ne sont pas des lectures.
  walk.full(ast, node => {
    if (node.type === 'VariableDeclarator') { const d = new Set(); motif(node.id, d); marquer(node.id, exclus); }
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') for (const p of node.params) marquer(p, exclus);
    if (node.type === 'CatchClause' && node.param) marquer(node.param, exclus);
  });
  walk.full(ast, node => {
    if (node.type !== 'Identifier' || exclus.has(node)) return;
    lectures.push({ nom: node.name, ligne: node.loc.start.line, fichier });
  });
  return { declares, lectures };
}
function marquer(n, exclus) {                  // marque les identifiants d'un motif comme non-lectures
  if (!n) return;
  if (n.type === 'Identifier') { exclus.add(n); return; }
  if (n.type === 'ObjectPattern') { for (const p of n.properties) marquer(p.type === 'RestElement' ? p.argument : p.value, exclus); return; }
  if (n.type === 'ArrayPattern') { for (const e of n.elements) marquer(e, exclus); return; }
  if (n.type === 'AssignmentPattern') { marquer(n.left, exclus); return; }
  if (n.type === 'RestElement') { marquer(n.argument, exclus); return; }
}

// ── Contrôle d'un groupe de fichiers partageant une portée globale ──────────────────────────────
function portee(fichiers, inlines) {
  const declares = new Set(), lectures = [];
  for (const f of fichiers) {
    const abs = path.join(RACINE, f);
    if (!fs.existsSync(abs)) continue;
    let r;
    try { r = analyser(fs.readFileSync(abs, 'utf8'), f); }
    catch (e) { console.log(`  ✗ ${f} : analyse impossible — ${e.message}`); return null; }
    r.declares.forEach(d => declares.add(d));
    if (!VENDOR_RX.test(f)) lectures.push(...r.lectures);        // on ne juge pas le code tiers
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) declares.add(m[1]);
  }
  for (const { code, f } of inlines || []) {
    try { analyser(code, f).declares.forEach(d => declares.add(d)); } catch {}
    for (const m of code.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) declares.add(m[1]);
  }
  return { declares, lectures };
}
function scriptsDeLaPage(page) {
  const abs = path.join(RACINE, page);
  if (!fs.existsSync(abs)) return null;
  const html = fs.readFileSync(abs, 'utf8');
  const fichiers = [], inlines = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[1]);
    if (src) { const u = src[1].split('?')[0]; if (u.startsWith('/js/')) fichiers.push('public' + u); }
    else if (m[2].trim()) inlines.push({ code: m[2], f: page });
  }
  // Les attributs onclick="…" appellent des fonctions globales : ils LISENT, ils ne déclarent pas.
  return { fichiers, inlines };
}
function controlerClient() {
  const parFichier = new Map();     // fichier → nb de portées où il est fautif / nb de portées
  const details = new Map();
  let pages = 0;
  for (const page of PAGES) {
    const p = scriptsDeLaPage(page);
    if (!p || !p.fichiers.length) continue;
    pages++;
    const sc = portee(p.fichiers, p.inlines);
    if (!sc) return [{ nom: '(parse)', fichier: page, ligne: 0 }];
    for (const f of p.fichiers) { const c = parFichier.get(f) || { vues: 0, fautes: new Map() }; c.vues++; parFichier.set(f, c); }
    for (const l of sc.lectures) {
      if (sc.declares.has(l.nom) || GLOBALES.has(l.nom)) continue;
      const c = parFichier.get(l.fichier); if (!c) continue;
      const k = l.nom + ':' + l.ligne;
      c.fautes.set(k, (c.fautes.get(k) || 0) + 1);
      details.set(l.fichier + '|' + k, l);
    }
  }
  const fantomes = [];
  for (const [f, c] of parFichier) {
    for (const [k, n] of c.fautes) if (n === c.vues) fantomes.push(details.get(f + '|' + k));   // fautif dans TOUTES ses pages
  }
  fantomes.sort((a, b) => a.fichier.localeCompare(b.fichier) || a.ligne - b.ligne);
  console.log(`\n── JS navigateur : ${pages} page(s), ${parFichier.size} fichier(s) ──`);
  if (!fantomes.length) console.log('  ✓ aucun identifiant fantôme');
  else fantomes.forEach(f => console.log(`  ✗ ${f.fichier}:${f.ligne}  « ${f.nom} » lu mais déclaré nulle part`));
  return fantomes;
}
function controlerServeur() {
  const fantomes = [];
  for (const f of SERVEUR) {
    const sc = portee([f], []);
    if (!sc) { fantomes.push({ nom: '(parse)', fichier: f, ligne: 0 }); continue; }
    for (const l of sc.lectures) if (!sc.declares.has(l.nom) && !GLOBALES.has(l.nom)) fantomes.push(l);
  }
  console.log(`\n── JS serveur : ${SERVEUR.length} fichier(s) ──`);
  if (!fantomes.length) console.log('  ✓ aucun identifiant fantôme');
  else fantomes.forEach(f => console.log(`  ✗ ${f.fichier}:${f.ligne}  « ${f.nom} » lu mais déclaré nulle part`));
  return fantomes;
}

// ── Hook pre-commit ─────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--install')) {
  const hook = path.join(RACINE, '.git', 'hooks', 'pre-commit');
  let cur = fs.existsSync(hook) ? fs.readFileSync(hook, 'utf8') : '#!/bin/sh\n';
  /* `exec` REMPLACE le shell : tout ce qui suit ne s'exécute jamais. Le hook existant lançait le
     garde-fou « Nouveautés DTP » ainsi — y ajouter une ligne l'aurait laissée morte, et j'aurais cru
     le contrôle en place. On le neutralise avant d'ajouter le nôtre. */
  cur = cur.replace(/^\s*exec\s+(node\s)/m, '$1');
  const ligne = 'node "$(git rev-parse --show-toplevel)/scripts/js-verif.js" || exit 1';
  if (!cur.includes('js-verif.js')) cur = cur.replace(/\s*$/, '\n') + ligne + '\n';
  // Chaque contrôle doit pouvoir refuser le commit : sans `|| exit 1`, un échec passe inaperçu.
  cur = cur.replace(/^(node .*dtp-updates-verif\.js)\s*$/m, '$1 || exit 1');
  fs.writeFileSync(hook, cur, { mode: 0o755 });
  try { fs.chmodSync(hook, 0o755); } catch {}
  console.log('[JS] hook pre-commit posé.');
  process.exit(0);
}

const ko = [...controlerClient(), ...controlerServeur()];
if (ko.length) {
  console.log(`\n✗ ${ko.length} identifiant(s) fantôme(s) — ce code lèvera une ReferenceError À L'EXÉCUTION.\n`);
  process.exit(1);
}
console.log('\n✓ aucun identifiant fantôme.\n');

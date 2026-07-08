/**
 * Génère les icônes de l'app (build/icon.png + icon.ico + icon.icns) À PARTIR DU VRAI FAVICON DU SITE
 * (public/favicon.svg — carré doré en dégradé + biseau + wordmark « DT » NOIR).
 *
 * ⚠️ IDENTITÉ GARANTIE AVEC LE SITE : on rend public/favicon.svg dans CHROME (puppeteer-core), le MÊME
 * moteur que l'onglet du navigateur. librsvg (le rasteriseur de sharp) IGNORE `dominant-baseline` → le
 * « DT » flottait / n'était pas centré comme sur le site (bug signalé 08/07). En passant par Chrome,
 * l'icône de l'app est PIXEL-IDENTIQUE au favicon du site. public/favicon.svg reste la source unique :
 * toute refonte du favicon web se propage ici automatiquement → relancer `npm run icons` + `build:win`/`build:mac`.
 *
 * Repli (si Chrome introuvable) : sharp rasterise un SVG à baseline corrigée (y=690) — moins fidèle mais
 * fonctionnel. 100 % offline dans les deux cas. png-to-ico assemble l'ICO ; l'ICNS est écrit à la main.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');                 // desktop/node_modules
const pngToIco = require('png-to-ico');          // desktop/node_modules

const FAVICON = path.join(__dirname, '..', 'public', 'favicon.svg');

// Résolution de l'exécutable Chrome (mêmes candidats que emailWidget.js / le scraper).
function _resolveChrome() {
  const c = [
    process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_EXEC,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe' : null,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return c.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

// MASTER 1024×1024 rendu par Chrome (fidèle au navigateur). Renvoie un Buffer PNG, ou null si pas de Chrome.
async function _renderMasterChrome() {
  const exe = _resolveChrome();
  if (!exe) return null;
  let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { return null; }   // résolu depuis <repo>/node_modules
  const svg = fs.readFileSync(FAVICON, 'utf8');
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  try {
    const pg = await browser.newPage();
    await pg.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:1024px;height:1024px;background:transparent}svg{width:1024px;height:1024px;display:block}</style></head><body>${svg}</body></html>`;
    await pg.setContent(html, { waitUntil: 'networkidle0' });
    const el = await pg.$('svg');
    const buf = await el.screenshot({ omitBackground: true });   // coins transparents conservés
    console.log('  ✓ master rendu par Chrome :', exe);
    return buf;
  } finally { await browser.close(); }
}

// Repli sans Chrome : SVG inline à baseline EXPLICITE (librsvg ignore dominant-baseline).
async function _renderMasterSharp() {
  const SVG = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
    `<defs>` +
    `<linearGradient id="dg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="0.5" stop-color="#f3c344"/><stop offset="1" stop-color="#e0a81e"/></linearGradient>` +
    `<linearGradient id="bev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.32"/></linearGradient>` +
    `</defs>` +
    `<rect width="1024" height="1024" rx="208" fill="url(#dg)"/>` +
    `<rect x="20" y="20" width="984" height="984" rx="190" fill="none" stroke="url(#bev)" stroke-width="40"/>` +
    `<text x="510" y="690" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="496" letter-spacing="-16" fill="#000000">DT</text>` +
    `</svg>`
  );
  console.log('  ⚠ Chrome introuvable → repli sharp/librsvg (baseline corrigée).');
  return sharp(SVG, { density: 300 }).resize(1024, 1024).png().toBuffer();
}

// ICNS minimal : 'icns' + taille totale, puis chunks [type(4) + len(4) + données PNG]
function buildIcns(pngBySize) {
  const TYPES = { 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };
  const chunks = [];
  for (const [size, type] of Object.entries(TYPES)) {
    const png = pngBySize[size];
    if (!png) continue;
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(8 + png.length, 4);
    chunks.push(Buffer.concat([head, png]));
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

(async () => {
  const out = path.join(__dirname, 'build');
  fs.mkdirSync(out, { recursive: true });

  // 1) MASTER browser-fidèle (Chrome), sinon repli
  const master = (await _renderMasterChrome().catch(e => { console.warn('  Chrome render KO:', e.message); return null; }))
    || (await _renderMasterSharp());

  // Toutes les tailles dérivent du MASTER (resize sharp) → cohérence parfaite avec le favicon du site.
  const png = async s => sharp(master).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

  // PNG de référence (fenêtre / Linux / taskbar)
  fs.writeFileSync(path.join(out, 'icon.png'), await png(512));

  // ICO Windows (multi-tailles)
  const icoBufs = [];
  for (const s of [16, 24, 32, 48, 64, 128, 256]) icoBufs.push(await png(s));
  fs.writeFileSync(path.join(out, 'icon.ico'), await pngToIco(icoBufs));

  // ICNS macOS
  const icnsPngs = {};
  for (const s of [128, 256, 512, 1024]) icnsPngs[s] = await png(s);
  fs.writeFileSync(path.join(out, 'icon.icns'), buildIcns(icnsPngs));

  console.log('Icônes générées → build/icon.png, icon.ico, icon.icns (source : public/favicon.svg)');
})().catch(e => { console.error(e); process.exit(1); });

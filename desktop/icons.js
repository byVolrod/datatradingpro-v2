/**
 * Génère les icônes de l'app (build/icon.png + icon.ico + icon.icns) depuis le logo DTP.
 * ⚠️ Le SVG ci-dessous DOIT rester le MIROIR EXACT de public/favicon.svg (design actuel :
 * carré DORÉ en dégradé + biseau + wordmark « DT » NOIR). L'ancien design (carré noir + « DTP »
 * blanc + barre orange PMT) a été abandonné — ne pas le réintroduire. Après toute refonte du
 * favicon web : reporter le nouveau tracé ICI puis relancer `npm run icons` + `build:win`/`build:mac`.
 * 100 % offline : sharp rasterise le SVG, png-to-ico assemble l'ICO, et l'ICNS est écrit à la
 * main (format Apple simple : en-tête 'icns' + chunks PNG typés ic08/ic09/ic10).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

// Miroir 1024×1024 de public/favicon.svg (originellement viewBox 64 → ×16). Dégradé or #ffe08a→
// #e0a81e, biseau blanc→noir, « DT » noir Arial 900. Dégradés en objectBoundingBox (invariants d'échelle).
const SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
  `<defs>` +
  `<linearGradient id="dg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="0.5" stop-color="#f3c344"/><stop offset="1" stop-color="#e0a81e"/></linearGradient>` +
  `<linearGradient id="bev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.32"/></linearGradient>` +
  `</defs>` +
  `<rect width="1024" height="1024" rx="208" fill="url(#dg)"/>` +
  `<rect x="20" y="20" width="984" height="984" rx="190" fill="none" stroke="url(#bev)" stroke-width="40"/>` +
  `<text x="510" y="512" dominant-baseline="central" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="496" letter-spacing="-16" fill="#000000">DT</text>` +
  `</svg>`
);

// ICNS minimal : 'icns' + taille totale, puis chunks [type(4) + len(4) + données PNG]
// Types Apple acceptant directement du PNG : ic07=128, ic08=256, ic09=512, ic10=1024.
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

  const png = async s => sharp(SVG, { density: 300 }).resize(s, s).png().toBuffer();

  // PNG de référence (fenêtre/Linux/taskbar)
  fs.writeFileSync(path.join(out, 'icon.png'), await png(512));

  // ICO Windows (multi-tailles)
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoBufs = [];
  for (const s of icoSizes) icoBufs.push(await png(s));
  fs.writeFileSync(path.join(out, 'icon.ico'), await pngToIco(icoBufs));

  // ICNS macOS
  const icnsPngs = {};
  for (const s of [128, 256, 512, 1024]) icnsPngs[s] = await png(s);
  fs.writeFileSync(path.join(out, 'icon.icns'), buildIcns(icnsPngs));

  console.log('Icônes générées → build/icon.png, icon.ico, icon.icns');
})().catch(e => { console.error(e); process.exit(1); });

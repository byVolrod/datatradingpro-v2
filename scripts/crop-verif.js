#!/usr/bin/env node
/**
 * scripts/crop-verif.js — LE RECADRAGE DE LA PHOTO DU SUPPORT.
 *
 * POURQUOI. Cette photo s'affiche chez TOUS les clients. Le recadreur promet une chose : « ce qui
 * est dans le cercle est ce qui sera enregistré ». Si le calcul de fenêtre dérive d'un facteur
 * d'échelle, personne ne le voit en relisant le code — on voit un visage décalé en production.
 * On l'éprouve donc sur une image dont on connaît les couleurs par moitié : on cadre la moitié
 * verte, et on relit la couleur au centre du fichier enregistré. Si la fenêtre ment, elle est rouge.
 *
 *   node scripts/crop-verif.js      (s'abstient sans navigateur, comme desk-verif)
 */
/* Contrôle du recadreur admin : la fenêtre ronde et le fichier enregistré doivent désigner
   EXACTEMENT la même zone de l'image. On extrait le vrai code d'admin.js et on l'exécute dans
   Chromium sur une image de test dont on connaît les couleurs par quadrant. */
const fs = require('fs'), path = require('path');
const RACINE = '/home/user/datatradingpro-v2';
const SRC = fs.readFileSync(path.join(RACINE, 'public/js/admin.js'), 'utf8');
let ko = 0, ok = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const deb = SRC.indexOf('var _crop = null;');
if (deb < 0) { console.log('  ✗ bloc de recadrage introuvable'); process.exit(1); }
const CODE = SRC.slice(deb);   // jusqu'à la fin : adCropValider vient APRÈS adSupAvChange

(async () => {
  let puppeteer; try { puppeteer = require('puppeteer-core'); } catch { console.log('  · puppeteer absent → abstention.'); process.exit(0); }
  const bases = ['/opt/pw-browsers'];
  const c = ['/usr/bin/chromium'];
  for (const b of bases) { try { for (const d of fs.readdirSync(b)) c.push(path.join(b, d, 'chrome-linux/chrome')); } catch {} }
  const bin = c.find(x => x && fs.existsSync(x));
  if (!bin) { console.log('  · aucun Chromium → abstention.'); process.exit(0); }
  const nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await nav.newPage();
  await page.setContent('<div id="ad-crop" hidden><div id="ad-crop-stage" style="width:240px;height:240px;position:relative;overflow:hidden"><img id="ad-crop-img"></div><input id="ad-crop-zoom" type="range" min="100" max="400" value="100"><span id="ad-crop-mini"></span></div>');
  const r = await page.evaluate(async (code) => {
    window.showToast = function () {};
    // Image d'essai 400×200 : moitié gauche ROUGE, moitié droite VERTE.
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 200;
    const x = cv.getContext('2d');
    x.fillStyle = '#ff0000'; x.fillRect(0, 0, 200, 200);
    x.fillStyle = '#00ff00'; x.fillRect(200, 0, 200, 200);
    const src = cv.toDataURL('image/png');
    let envoye = null;
    window._adSupAvRender = function () {};
    window._adSupAvEnvoi = function (u) { envoye = u; return Promise.resolve({ ok: true }); };
    (0, eval)(code);   // eval INDIRECT → les fonctions atterrissent dans la portée globale
    await new Promise(res => { const i = new Image(); i.onload = res; i.src = src; });
    window._cropOuvrir(src);
    await new Promise(r2 => setTimeout(r2, 120));
    const e = document.getElementById('ad-crop-img');
    const etat0 = { k: window._crop.k, kMin: window._crop.kMin, x: window._crop.x, y: window._crop.y, w: e.style.width, h: e.style.height };
    // L'image (400×200) dans une scène de 240 : cover → k = 240/200 = 1.2, largeur rendue 480.
    // Bornes : x ∈ [-240, 0]. On pousse volontairement hors bornes pour vérifier le bridage.
    window._crop.x = 999; window._crop.y = 999; window._cropRendre();
    const borne = { x: window._crop.x, y: window._crop.y };
    // On cadre la moitié DROITE (verte) : x = -240 → fenêtre = pixels source 200..400.
    window._crop.x = -240; window._crop.y = 0; window._cropRendre();
    window.adCropValider();
    await new Promise(r2 => setTimeout(r2, 250));
    // Relit la couleur au centre du fichier enregistré.
    const couleur = await new Promise(res => {
      const i = new Image();
      i.onload = () => { const c2 = document.createElement('canvas'); c2.width = c2.height = i.width; const g = c2.getContext('2d'); g.drawImage(i, 0, 0); const p = g.getImageData(i.width >> 1, i.height >> 1, 1, 1).data; res([p[0], p[1], p[2]]); };
      i.onerror = () => res(null);
      i.src = envoye;
    });
    return { etat0, borne, couleur, taille: envoye ? envoye.length : 0, jpeg: /^data:image\/jpeg;base64,/.test(envoye || '') };
  }, CODE);

  console.log('\n── Recadrage de la photo du support (Chromium) ──');
  v('l\'échelle « cover » est calculée sur le petit côté', Math.abs(r.etat0.kMin - 1.2) < 0.001, String(r.etat0.kMin));
  v('l\'image rendue couvre la scène', r.etat0.w === '480px' && r.etat0.h === '240px', r.etat0.w + ' × ' + r.etat0.h);
  v('l\'amorce est centrée horizontalement', Math.abs(r.etat0.x - (-120)) < 0.5, String(r.etat0.x));
  v('un déplacement hors bornes est bridé', r.borne.x === 0 && r.borne.y === 0, JSON.stringify(r.borne));
  v('le fichier enregistré est un JPEG', r.jpeg);
  v('il contient EXACTEMENT la zone cadrée (moitié verte)', r.couleur && r.couleur[1] > 200 && r.couleur[0] < 60, JSON.stringify(r.couleur));
  v('il reste sous la limite du serveur', r.taille > 0 && r.taille < 180000, r.taille + ' octets');
  await nav.close();
  console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
  process.exit(ko ? 1 : 0);
})();

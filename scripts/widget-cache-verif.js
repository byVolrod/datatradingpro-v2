#!/usr/bin/env node
/* ═══ UN CHANGEMENT DE DESSIN DOIT ATTEINDRE LES COURRIELS ════════════════════════════════════════
   02/09, signalé DEUX FOIS par l'utilisateur. Le 01/09, la pastille de période active du widget
   « Force des Devises » est passée de l'aplat d'or plein à la pastille teintée. Le code servi a
   changé le jour même ; l'image envoyée dans les courriels, non.
   CAUSE RACINE : la clé de cache des images décrit ce qu'on DEMANDE — type, période, devise,
   paramètres — et jamais comment on le DESSINE. Une image déjà rendue restait donc parfaitement
   valable après un changement de rendu. Et ce n'est pas une affaire de dix minutes : le cache
   mémoire expire vite, mais le « dernier bon » vit sur le disque, dans un volume monté qui SURVIT
   aux déploiements, et il est servi tant qu'il n'a pas atteint `_ageMax` — jusqu'à trois jours.
   Un correctif visuel pouvait mettre trois jours à atteindre un client, sans que rien ne le signale.
   `WIDGET_VER` fait désormais partie de la clé, mémoire et disque. Reste le vrai risque : OUBLIER
   de le bumper. Ce banc est le cliquet — il prend l'empreinte des gabarits de rendu et refuse de
   passer si elle bouge sans que le numéro bouge.

     node scripts/widget-cache-verif.js            # contrôle
     node scripts/widget-cache-verif.js --scelle   # après un bump : réenregistre l'empreinte

   ⚠️ L'EMPREINTE PORTE SUR LE DESSIN, PAS SUR LE FICHIER. On isole les routes
   `/internal/email-widget/*` de server.js (le gabarit HTML/CSS que Chromium photographie) et les
   dimensions déclarées dans `SPECS`. Empreinter server.js entier ferait rougir ce banc à chaque
   virgule ajoutée ailleurs, et un cliquet qui crie tout le temps finit par être contourné. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..');
const SCEAU = path.join(__dirname, '.widget-cache-sceau.json');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 500) : '')); } };

console.log('\n── Un changement de dessin atteint-il les courriels ? ──');

const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const EW = fs.readFileSync(path.join(RACINE, 'emailWidget.js'), 'utf8');

/* 1. LA VERSION EST DANS LES DEUX CLÉS. Une seule des deux suffirait à laisser passer une image
      périmée : la mémoire sert les envois rapprochés, le disque sert après un redémarrage. */
const mVer = /const WIDGET_VER = (\d+);/.exec(EW);
v('`WIDGET_VER` est déclarée dans emailWidget.js', !!mVer);
const VER = mVer ? mVer[1] : null;
v('… elle entre dans la clé du cache MÉMOIRE',
  (EW.match(/const key = type \+ ':v' \+ WIDGET_VER \+ ':'/g) || []).length === 2,
  (EW.match(/const key = type \+[^\n;]*/g) || []).join(' | '));
v('… et dans la clé du « dernier bon » sur DISQUE (celle qui survit aux déploiements)',
  /function _wk\(type, period\) \{ return \(String\(type\) \+ '_v' \+ WIDGET_VER/.test(EW),
  (EW.match(/function _wk\([^\n]*/) || [''])[0]);

/* 2. LE CLIQUET. Empreinte des gabarits de rendu + des dimensions. */
function gabarits() {
  const out = [];
  const rx = /app\.get\('\/internal\/email-widget\/([a-z-]+)'/g;
  let m;
  const debuts = [];
  while ((m = rx.exec(SRV))) debuts.push({ nom: m[1], i: m.index });
  for (let k = 0; k < debuts.length; k++) {
    const fin = k + 1 < debuts.length ? debuts[k + 1].i : Math.min(SRV.length, debuts[k].i + 20000);
    /* On ne garde que ce qui DESSINE : le HTML servi et son CSS. Les commentaires sont retirés —
       documenter un choix ne change pas un pixel, et devoir bumper pour une note découragerait
       d'écrire la note. */
    const corps = SRV.slice(debuts[k].i, fin)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    out.push(debuts[k].nom + ' ' + corps.replace(/\s+/g, ' ').trim());
  }
  return out;
}
const G = gabarits();
v('les gabarits de rendu sont retrouvés dans server.js', G.length >= 8, G.length + ' route(s)');
const mSpecs = /const SPECS = \{[\s\S]*?\n\};/.exec(EW);
v('… et les dimensions déclarées dans SPECS', !!mSpecs);
const empreinte = crypto.createHash('sha256')
  .update(G.join('') + '' + (mSpecs ? mSpecs[0].replace(/\s+/g, ' ') : ''))
  .digest('hex').slice(0, 16);

if (process.argv.includes('--scelle')) {
  fs.writeFileSync(SCEAU, JSON.stringify({ ver: VER, empreinte }, null, 2) + '\n');
  console.log('\n✓ Sceau enregistré : WIDGET_VER=' + VER + ', empreinte ' + empreinte + '\n');
  process.exit(0);
}

let sceau = null;
try { sceau = JSON.parse(fs.readFileSync(SCEAU, 'utf8')); } catch (e) {}
v('le sceau existe (sinon : `node scripts/widget-cache-verif.js --scelle`)', !!sceau);
if (sceau) {
  const memeDessin = sceau.empreinte === empreinte;
  const memeVer = String(sceau.ver) === String(VER);
  /* LA SEULE COMBINAISON INTERDITE : le dessin a changé et le numéro n'a pas bougé. C'est
     exactement le cas vécu — et il ne se voit nulle part ailleurs, puisque le code servi, lui,
     est juste. */
  v('un changement de dessin s\'accompagne d\'un bump de `WIDGET_VER`',
    memeDessin || !memeVer,
    'le gabarit des widgets a changé (empreinte ' + sceau.empreinte + ' -> ' + empreinte + ') mais WIDGET_VER vaut toujours ' + VER
    + '.\n        Les courriels continueraient de servir l\'ancienne image pendant jusqu\'à 3 jours.'
    + '\n        Corriger : incrémenter WIDGET_VER dans emailWidget.js, puis `node scripts/widget-cache-verif.js --scelle`.');
  /* Et le sceau doit suivre : bumper sans resceller laisserait le prochain changement passer. */
  v('… et le sceau est à jour (bump enregistré)', memeDessin === memeVer,
    'WIDGET_VER a été bumpée mais le sceau n\'a pas été réenregistré : `node scripts/widget-cache-verif.js --scelle`.');
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert') + '\n');
process.exit(ko ? 1 : 0);

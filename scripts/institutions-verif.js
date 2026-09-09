#!/usr/bin/env node
/**
 * scripts/institutions-verif.js — UN RAPPORT D'INSTITUTION S'AFFICHE-T-IL, ET SANS SA SOURCE ?
 *
 * POURQUOI (09/09, signalement utilisateur : « le PDF rapport affiche page blanche de Goldman
 * Sachs, vérifie pourquoi et corrige pour tous les rapports Goldman, et vérifie que tous les
 * rapports institutions arrivent bien et s'affichent correctement sans afficher leur source »).
 *
 * LA CAUSE ÉTAIT UN COMMENTAIRE QUI MENTAIT. Au-dessus de `PDF_RENDER_HOSTS`, un pavé affirmait en
 * majuscules que `goldmansachs.com` avait été RETIRÉ de la liste parce que ses pages sont gatées
 * (corps vide au rendu). L'hôte y figurait pourtant, en dernière position. C'est la règle du dépôt :
 * un commentaire périmé ment avec l'autorité du code — et il avait convaincu, puisque personne n'a
 * plus regardé la liste.
 *
 * ET UN SECOND CORRECTIF, JUSTE EN LUI-MÊME, A RENDU LA PANNE MUETTE. Un repli « média écran » avait
 * été ajouté pour les feuilles d'impression capricieuses : il fait RÉUSSIR `page.pdf()` là où elle
 * échouait. Sur une page gatée, le rendu ne tombe donc plus en erreur — il produit un PDF valide,
 * mis en cache, contenant une page BLANCHE. Le bandeau de repli n'apparaissait plus.
 *
 *   node scripts/institutions-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}
const S = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');

function listeHotes(nom) {
  const m = S.match(new RegExp('const ' + nom + ' = /\\(\\^\\|\\\\\\.\\)\\(([^)]+)\\)\\$/i;'));
  return m ? m[1].split('|').map(x => x.replace(/\\/g, '')) : null;
}
const RENDER = listeHotes('PDF_RENDER_HOSTS');
const PROXY = listeHotes('PDF_PROXY_HOSTS');

console.log('\n[1] Le code dit ce que son commentaire annonce');
t('les deux listes d\'hôtes sont lues', !!RENDER && !!PROXY,
  'RENDER=' + (RENDER && RENDER.length) + ' PROXY=' + (PROXY && PROXY.length));
/* LE CONTRÔLE DU JOUR : le commentaire promet que Goldman ne passe PAS par le rendu navigateur.
   Tant qu'il est écrit, la liste doit lui donner raison. */
t('goldmansachs.com n\'est PAS dans les hôtes de rendu', !!RENDER && !RENDER.includes('goldmansachs.com'),
  'le commentaire au-dessus de la liste affirme le contraire de ce que la liste contient');
/* TÉMOIN INVERSE : leurs VRAIS PDF doivent rester servis. Retirer Goldman du rendu ne doit pas
   revenir à le retirer du produit — c'est précisément ce que le commentaire distingue. */
t('TÉMOIN — mais ses PDF natifs restent servis', !!PROXY && PROXY.includes('goldmansachs.com') && PROXY.includes('gspublishing.com'),
  'les rapports Goldman en .pdf ne s\'ouvriraient plus du tout');
t('TÉMOIN — gspublishing reste, lui, rendu si besoin', !!RENDER && RENDER.includes('gspublishing.com'));
/* La promesse écrite doit rester vérifiable : si quelqu'un réécrit le commentaire, ce contrôle
   perd son sens. On exige donc que la phrase existe, pour que le banc et le texte disent la même
   chose — c'est le couple qui protège, pas l'un des deux. */
t('la raison est toujours écrite au-dessus de la liste', /goldmansachs\.com RETIRÉ du rendu Puppeteer/.test(S));

console.log('\n[2] Un rendu au corps vide n\'est jamais servi');
{
  const iGarde = S.indexOf("if (_texte < 400) {");
  const iPdf = S.indexOf('out = await page.pdf(_pdfOpts);');
  t('la garde de page vide existe', iGarde > 0, 'un PDF blanc serait produit, mis en cache et re-servi');
  /* L'ORDRE EST LA MOITIÉ DE LA CORRECTION. Placée après l'impression, la même garde ne servirait
     à rien : le PDF blanc serait déjà fabriqué, et le repli « média écran » l'aurait déjà sauvé. */
  t('elle s\'exécute AVANT l\'impression', iGarde > 0 && iPdf > 0 && iGarde < iPdf,
    'garde à ' + iGarde + ', impression à ' + iPdf);
  t('elle mesure le TEXTE rendu, pas la taille du PDF', /document\.body\.innerText/.test(S.slice(iGarde - 900, iGarde)),
    'un PDF blanc pèse plusieurs kilo-octets : sa taille ne prouve rien');
  t('le cache des rendus a été invalidé', /_RENDER_VER = 'r10'/.test(S),
    'sans bump, les pages blanches déjà en cache continueraient d\'être servies');
}

console.log('\n[3] Aucun rapport ne montre sa source');
{
  const a = S.indexOf('function _stripLiens(html)');
  const b = S.indexOf('\n}', S.indexOf('_ADRESSE_NUE', a));
  const src = a > 0 ? S.slice(S.indexOf('const _ADRESSE_NUE'), b + 2) : '';
  let strip = null;
  try { strip = new Function(src + '; return _stripLiens;')(); } catch (e) {}
  t('_stripLiens est extraite et exécutable', typeof strip === 'function');
  if (strip) {
    t('un lien dont le texte EST l\'adresse disparaît',
      !/goldmansachs/.test(strip('<p>Voir <a href="https://x">https://www.goldmansachs.com/insights</a></p>')));
    t('une adresse nue disparaît',
      !/kbc\.be/.test(strip('<p>Plus d\'informations sur www.kbc.be aujourd\'hui.</p>')));
    /* TÉMOIN INVERSE : on retire l'ADRESSE, jamais la PHRASE. Un nettoyage qui emporterait le texte
       du lien mutilerait le rapport — et c'est invisible, puisque la page reste bien formée. */
    t('TÉMOIN — le texte d\'un lien rédigé est CONSERVÉ',
      /rapport trimestriel/.test(strip('<p>Lire le <a href="https://x.com/a">rapport trimestriel</a> complet.</p>')));
    t('TÉMOIN — un texte sans lien n\'est pas touché',
      strip('<p>La BCE a maintenu ses taux.</p>') === '<p>La BCE a maintenu ses taux.</p>');
  }
}

console.log('\n[Institutions] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

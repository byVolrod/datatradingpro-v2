#!/usr/bin/env node
/**
 * scripts/hebdo-verif.js — LE RÉCAP HEBDO PARLE-T-IL À DES ÉLÉMENTS QUI EXISTENT ?
 *
 * POURQUOI (09/09, retour utilisateur : « corrige ceci dans le récap hebdo », capture d'une image
 * cassée). Le défaut trouvé n'était pas l'image : c'était un GRAPHIQUE MORT derrière elle.
 *
 *   · Le rapport posait une <img> vers `/api/email-widget/strength.png`. Cette route rend le widget
 *     dans un Chromium côté serveur et, en cas d'échec, renvoie VOLONTAIREMENT un pixel transparent
 *     plutôt qu'une erreur — la bonne réponse pour un client de messagerie, un trou muet dans le desk.
 *   · Et le desk savait déjà tracer cette courbe. `_wrBuildCsAll` est appelée à chaque ouverture du
 *     rapport ; sa première ligne cherche `#wr-cs-all`, un identifiant qui n'existait NULLE PART dans
 *     le produit. Elle sortait donc silencieusement, à chaque fois, depuis sa ligne 1.
 *
 * UNE FONCTION APPELÉE QUI NE TROUVE PAS SON ÉLÉMENT NE LÈVE RIEN, N'ÉCRIT RIEN, NE LAISSE AUCUNE
 * TRACE. `node -c` la trouve parfaite, `js-verif` aussi (tous ses identifiants sont déclarés), et
 * même ses propres replis d'erreur sont inatteignables. C'est ce trou-là que ce banc ferme, et pas
 * seulement pour le cas d'aujourd'hui : il vérifie que CHAQUE identifiant cherché par la famille
 * `_wr*` est bien produit quelque part.
 *
 *   node scripts/hebdo-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8');
const MAILER = fs.readFileSync(path.join(RACINE, 'mailer.js'), 'utf8');

console.log('\n[1] La courbe du récap est tracée par le desk, pas photographiée par le serveur');
t('le rapport crée l\'hôte de la vue d\'ensemble', /id="wr-cs-all"/.test(APP),
  '#wr-cs-all n\'est créé nulle part : _wrBuildCsAll sortira à sa première ligne');
t('_wrBuildCsAll cherche bien cet hôte', /getElementById\('wr-cs-all'\)/.test(APP));
/* ⚠️ ON CHERCHE UNE BALISE, PAS UNE CHAÎNE. La première écriture testait `email-widget/strength.png`
   n'importe où dans le fichier — et rougissait sur les COMMENTAIRES qui racontent précisément
   pourquoi cette image a été retirée. Un banc qui interdit d'expliquer sa propre correction pousse
   à effacer l'explication : c'est le contraire du but. */
t('le desk ne demande plus la photo du widget force',
  !/<img[^>]*email-widget\/strength\.png/.test(APP),
  'une <img> vers le rendu serveur subsiste dans le desk');
t('le récap QUOTIDIEN trace lui aussi sa courbe', /id="fxdr-cs-all"/.test(APP) && /getElementById\('fxdr-cs-all'\)/.test(APP),
  'le rapport jumeau garde l\'image morte');
/* TÉMOIN INVERSE : le PNG n'est pas supprimé du produit, il reste la seule solution pour un E-MAIL,
   où aucun script ne tourne. Un banc qui interdirait le PNG partout casserait le mail hebdomadaire. */
t('TÉMOIN — le mail, lui, utilise TOUJOURS le rendu serveur', /_widgetImg\('strength'/.test(MAILER),
  'le mail a perdu son image : aucun script ne tourne dans un client de messagerie');
t('l\'hôte a une hauteur en CSS',
  /\.wr-cs-all\s*\{[^}]*height\s*:/.test(fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8')),
  'sans hauteur, amCharts trace dans une boîte de 0 pixel : invisible, et sans erreur');

/* ══ LA RÈGLE GÉNÉRALE — celle qui vaut pour la PROCHAINE fois ══════════════════════════════════
   Tout identifiant cherché par la famille `_wr*` (le récap hebdo) doit être produit quelque part :
   dans le corps du rapport, dans index.html, ou posé par le code. Sinon la fonction qui le lit est
   morte, et morte en silence.                                                                     */
console.log('\n[2] Chaque identifiant cherché par le récap est produit quelque part');
{
  // On isole la famille `_wr*` : de la première fonction `_wr` à la fin du fichier suffit largement,
  // mais on préfère collecter les appels DANS le corps de chaque fonction dont le nom commence par _wr.
  const fonctions = [];
  const rx = /function\s+(_wr[A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = rx.exec(APP))) {
    const debut = m.index;
    // fin = prochaine déclaration de fonction de premier niveau, ou 6000 caractères
    const suivant = APP.indexOf('\nfunction ', debut + 1);
    fonctions.push({ nom: m[1], corps: APP.slice(debut, suivant > debut ? suivant : debut + 6000) });
  }
  t('la famille _wr* est trouvée dans app.js', fonctions.length >= 3, fonctions.length + ' fonction(s)');

  const manquants = [];
  for (const f of fonctions) {
    const ids = [...f.corps.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'\s*\)/g)].map(x => x[1]);
    for (const id of ids) {
      // Produit par le corps du rapport, par la page, ou posé dynamiquement (el.id = '…').
      const cree = new RegExp('id="' + id + '"').test(APP)
        || new RegExp('id="' + id + '"').test(INDEX)
        || new RegExp("\\.id\\s*=\\s*'" + id + "'").test(APP)
        || new RegExp("id:\\s*'" + id + "'").test(APP);
      if (!cree) manquants.push(f.nom + ' → #' + id);
    }
  }
  t('aucun identifiant cherché n\'est introuvable dans le produit', manquants.length === 0,
    manquants.join(' · '));
}

console.log('\n[Hebdo] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

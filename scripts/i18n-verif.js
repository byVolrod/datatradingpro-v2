#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   i18n-verif — détecteur de clés ORPHELINES du dictionnaire FR→EN (dette #28, 10/08/2026).

   POURQUOI : le moteur i18n (public/js/i18n.js) traduit le texte VISIBLE en cherchant la chaîne
   FRANÇAISE EXACTE dans le dictionnaire (public/js/i18n-dicts.js). Conséquence structurelle :
   quand un wording FR change dans le code, sa clé ne matche plus RIEN — la traduction EN meurt
   EN SILENCE (l'interface anglaise ré-affiche du français, personne ne le voit venir).

   CE QUE FAIT L'OUTIL : il cherche chaque clé du dictionnaire, littéralement, dans le code qui
   produit du texte visible (HTML + JS client + server.js pour les libellés injectés). Une clé
   introuvable = candidate orpheline → à re-synchroniser (ou à supprimer si le texte a disparu).

   LIMITE ASSUMÉE : une chaîne CONSTRUITE au runtime (concaténation, template avec variable) est
   introuvable littéralement sans être orpheline → l'outil CLASSE, il ne casse rien (pas un gate
   bloquant, un rapport de revue). Normalisation apostrophes/espaces pour limiter les faux positifs.

   USAGE : node scripts/i18n-verif.js            → rapport (80 premières orphelines)
           node scripts/i18n-verif.js --all      → liste complète
   RÈGLE DE TRAVAIL : à lancer après toute passe de renommage de wording FR (cf. CLAUDE.md).
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');

// ── 1. Charger le dictionnaire (fichier = `window.DTP_I18N = {...};`, contenu JSON pur) ──
const dictSrc = fs.readFileSync(path.join(RACINE, 'public/js/i18n-dicts.js'), 'utf8');
const m = dictSrc.match(/window\.DTP_I18N\s*=\s*(\{[\s\S]*\});?\s*$/);
if (!m) { console.error('Impossible d\'extraire window.DTP_I18N de i18n-dicts.js'); process.exit(2); }
let DICTS;
try { DICTS = JSON.parse(m[1]); } catch (e) { console.error('Dictionnaire non-JSON :', e.message); process.exit(2); }
const EN = DICTS.en || {};
const cles = Object.keys(EN);

// ── 2. Corpus = tout ce qui produit du texte visible côté desk ──
const fichiers = [];
for (const f of fs.readdirSync(path.join(RACINE, 'public'))) if (f.endsWith('.html')) fichiers.push('public/' + f);
for (const f of fs.readdirSync(path.join(RACINE, 'public/js'))) {
  if (!f.endsWith('.js') || f === 'i18n-dicts.js' || f === 'i18n-en.js' || f === 'i18n.js') continue;
  fichiers.push('public/js/' + f);
}
fichiers.push('server.js');   // certains libellés visibles (rapports, notifications) naissent côté serveur
// Apostrophes droites/typographiques et espaces insécables interchangeables dans le code réel :
// on normalise DES DEUX CÔTÉS avant de comparer (sinon faux orphelins par simple typographie).
const norm = s => String(s).replace(/[’']/g, "'").replace(/[  ]/g, ' ').replace(/\s+/g, ' ');
const corpus = norm(fichiers.map(f => { try { return fs.readFileSync(path.join(RACINE, f), 'utf8'); } catch { return ''; } }).join('\n'));

// ── 3. Chaque clé doit exister littéralement quelque part ──
const orphelines = [];
for (const k of cles) {
  const nk = norm(k).trim();
  if (nk.length < 3) continue;                       // clés minuscules (« IA ») : trop ambiguës, ignorées
  if (!corpus.includes(nk)) orphelines.push(k);
}
// HTML-escape : le code écrit souvent `&eacute;`/`&amp;` là où la clé porte le caractère réel →
// deuxième passe tolérante : une clé n'est retenue orpheline que si sa version SANS accents est
// AUSSI introuvable (attrape les clés mortes tout en tolérant l'encodage HTML des vivantes).
const desaccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const corpusPlat = desaccent(corpus);
const mortes = orphelines.filter(k => !corpusPlat.includes(desaccent(norm(k).trim())));

// ── 4. Rapport ──
const montre = process.argv.includes('--all') ? mortes.length : Math.min(80, mortes.length);
console.log('Dictionnaire FR→EN : ' + cles.length + ' clés');
console.log('Trouvées littéralement dans le code : ' + (cles.length - orphelines.length));
console.log('Introuvables (candidates orphelines) : ' + mortes.length
  + (orphelines.length !== mortes.length ? '  (+' + (orphelines.length - mortes.length) + ' tolérées via encodage HTML)' : ''));
if (mortes.length) {
  console.log('\n⚠️  À vérifier — soit le wording FR a changé (re-synchroniser la clé), soit le texte');
  console.log('    a disparu (supprimer l\'entrée), soit la chaîne est construite au runtime (ignorer) :');
  mortes.slice(0, montre).forEach(k => console.log('  · ' + JSON.stringify(k)));
  if (mortes.length > montre) console.log('  … et ' + (mortes.length - montre) + ' autres (relancer avec --all)');
}

/* ══ CLIQUET : LE NOMBRE D'ORPHELINES NE PEUT PLUS AUGMENTER (28/08) ═══════════════════════════
   AUDIT DU JOUR : ce banc était le SEUL des 36 à n'être lancé par personne — ni `npm run check`,
   ni le hook. CLAUDE.md demandait de le passer « après tout renommage de wording FR » : une
   discipline manuelle, et le résultat se mesure — 21 clés orphelines accumulées, dont SIX
   traductions réellement mortes (un anglophone lisait du français). Parmi elles le titre
   « Fil d'actualité », affiché en haut du panneau des actualités.
   POURQUOI UN CLIQUET ET PAS UN ZÉRO. Une partie des orphelines restantes sont des faux positifs
   assumés : des chaînes construites à l'exécution (« Hebdomadaire », « Cassure ») que ce banc ne
   peut pas voir. Exiger zéro obligerait à les blanchir une à une, et un banc qu'on blanchit est un
   banc qu'on finit par ignorer. On fige donc le nombre CONNU : la dette d'hier ne bloque rien, une
   dette de PLUS fait rougir. C'est le seul réglage qui rend ce contrôle exécutable aujourd'hui tout
   en le rendant utile demain.
   ⚠️ EN BAISSER LA VALEUR EST UNE BONNE NOUVELLE : quand une orpheline est traitée, descendre ce
   plafond d'autant, sinon le cliquet ne cliquette plus. */
const PLAFOND_ORPHELINES = 17;   // (09/09 : « ↑ Importer (Notion / CSV) » vivait dans le dictionnaire et était comptée orpheline parce que le code écrivait la flèche en ENTITÉ NUMÉRIQUE (`&#8593;`) là où la clé porte le caractère — la tolérance du banc ne couvre que les accents. Les quatre entités des boutons du Journal sont passées au caractère réel : la traduction est retrouvée, le cliquet descend. — 30/08 : le renommage « Biais / Scénario »→« Biais » a re-keyé la clé « : » et retiré la clé nue — qui était trouvée par sous-chaîne, donc PAS orpheline : le compte reste 18)
if (mortes.length > PLAFOND_ORPHELINES) {
  console.log('\n✗ ' + mortes.length + ' orphelines pour un plafond de ' + PLAFOND_ORPHELINES + '.');
  console.log('  Une traduction vient de mourir : un wording FR a changé sans que sa clé suive.');
  console.log('  Re-cléer l\'entrée dans public/js/i18n-dicts.js (les trois langues), puis baisser');
  console.log('  PLAFOND_ORPHELINES d\'autant dans ce fichier.');
  process.exit(1);
}
if (mortes.length < PLAFOND_ORPHELINES) {
  console.log('\n✓ ' + mortes.length + ' orphelines, sous le plafond de ' + PLAFOND_ORPHELINES
    + ' — pensez à descendre PLAFOND_ORPHELINES à ' + mortes.length + '.');
} else {
  console.log('\n✓ ' + mortes.length + ' orphelines connues, aucune de plus.');
}
process.exit(0);

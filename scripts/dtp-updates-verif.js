#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   dtp-updates-verif — GARDE-FOU DES « NOUVEAUTÉS DTP »

   POURQUOI. La règle du projet est claire : toute évolution VISIBLE PAR LES CLIENTS doit être
   annoncée dans DTP_UPDATES (server.js), DANS LE MÊME COMMIT, pour que l'onglet DTP du panneau
   ALERTES tienne les utilisateurs au courant. Elle a quand même été oubliée plusieurs fois le
   11/08 : quatre changements bien visibles (noms du calendrier, « À surveiller », lecture des
   rapports, widget COT) sont partis sans un mot. Une règle qu'on peut oublier n'est pas une règle,
   c'est une intention — d'où ce vérificateur.

   CE QU'IL FAIT. Il regarde les fichiers du commit en préparation (index git) : si l'un d'eux est
   VISIBLE PAR LES CLIENTS et que le tableau DTP_UPDATES n'a pas bougé, il refuse le commit et dit
   quoi écrire. Rien d'autre — il ne juge pas le contenu de l'annonce.

   COMMENT S'EN SERVIR.
     node scripts/dtp-updates-verif.js            → vérifie l'index (usage du hook pre-commit)
     node scripts/dtp-updates-verif.js --last     → vérifie le DERNIER commit (contrôle après coup)
     node scripts/dtp-updates-verif.js --install  → installe le hook pre-commit sur cette machine
   Contournement volontaire (refonte interne, correctif invisible) : `git commit --no-verify`.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sh = c => execSync(c, { cwd: ROOT, encoding: 'utf8' }).trim();

// ── Ce qui compte comme « visible par les clients » ────────────────────────────────────────────
// Le desk (JS/CSS/HTML servis au navigateur) et les gabarits d'e-mail. server.js est le cas
// particulier : il contient AUSSI DTP_UPDATES, donc on ne le déclare visible que si son diff
// touche autre chose que ce tableau (voir plus bas).
const VISIBLE_RX = /^(public\/js\/.+\.js|public\/css\/.+\.css|public\/.+\.html|mailer\.js)$/;
const IGNORE_RX  = /^public\/js\/i18n-dicts\.js$/;   // dictionnaire de traduction : jamais une nouveauté à soi seul

function fichiers(mode) {
  const cmd = mode === 'last' ? 'git diff --name-only HEAD~1 HEAD' : 'git diff --cached --name-only';
  try { return sh(cmd).split('\n').map(s => s.trim()).filter(Boolean); } catch { return []; }
}
function diffDe(fichier, mode) {
  const cmd = mode === 'last' ? `git diff HEAD~1 HEAD -- "${fichier}"` : `git diff --cached -- "${fichier}"`;
  try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; }
}
// Le diff de server.js contient-il une NOUVELLE entrée DTP_UPDATES ? (ligne ajoutée « id: 'dtpu-… »)
const aNouvelleAnnonce = d => /^\+.*id:\s*'dtpu-/m.test(d);

/* ══ LE FRANÇAIS DE L'ANNONCE (26/08, demande utilisateur : « corrige ça dans les notifs c pas
   professionnel du tout », puis « pr pas que ça se reproduise ») ══════════════════════════════
   Le fil des Nouveautés est ce que les clients LISENT ; c'est la seule page du produit écrite à la
   première personne. 212 des 355 entrées y étaient sans un seul accent — « la journee precedente
   n a jamais ete affichee » — et deux des trois entrées encore dans la fenêtre de 7 jours étaient
   dans ce cas. Ce n'est pas un détail de style : un texte sans accents ni apostrophes lu par un
   client donne l'impression d'un produit bâclé, et il l'a dit ainsi.
   POURQUOI ÇA ARRIVE, ET POURQUOI UN CONTRÔLE EST LE SEUL REMÈDE : la chaîne est délimitée par une
   apostrophe droite, donc écrire « d'adresse » casse le fichier. La parade prise sur le moment a
   été de retirer l'apostrophe (« d adresse ») puis, de fil en aiguille, les accents. La bonne
   parade est l'apostrophe TYPOGRAPHIQUE ’ (U+2019), qui ne ferme aucune chaîne, se compose
   normalement et est de surcroît la forme correcte en français.
   TROIS CONTRÔLES, chacun choisi pour ne JAMAIS se déclencher sur du français correct :
     1. la densité d'accents (un texte français d'annonce en porte largement plus d'un pour 80
        caractères — le seuil est donc très bas et ne peut être franchi que par un texte
        volontairement dépouillé) ;
     2. les apostrophes escamotées : « d », « l », « n », « c », « qu » isolés entre deux espaces
        n'existent dans aucune phrase française ;
     3. une liste de graphies qui ne sont JAMAIS des mots français sans accent. Les mots qui
        existent dans les deux formes (marche, cote, tache, mode…) en sont volontairement absents :
        un contrôle qui accuse à tort finit par être contourné, et ne protège plus rien. */
const ACCENTS_RX = /[àâäçéèêëîïôöùûüÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ]/g;
const ELISION_RX = /(^|\s)(d|l|n|c|j|qu|s)\s(?=[a-zàâäéèêëîïôöùûüA-Z])/g;
const SANS_ACCENT = ['deja', 'apres', 'etait', 'etaient', 'etre', 'ete', 'tres', 'meme', 'memes',
  'derniere', 'dernieres', 'premiere', 'premieres', 'journee', 'journees', 'annee', 'annees',
  'systeme', 'systemes', 'probleme', 'problemes', 'fenetre', 'fenetres', 'donnees', 'ecran',
  'ecrans', 'element', 'elements', 'telephone', 'telephones', 'evenement', 'evenements',
  'reglage', 'reglages', 'reference', 'references', 'verification', 'generation', 'creation',
  'operation', 'operations', 'necessaire', 'interet', 'numero', 'precedent', 'precedente',
  'recap', 'recaps', 'resume', 'resumes', 'seance', 'seances', 'geopolitique', 'reussi',
  'affichee', 'affiches', 'creee', 'cree', 'ameliore', 'amelioree', 'detail', 'details'];

// Le texte QUE LE CLIENT LIT dans les lignes ajoutées : ce qui suit `title:` et `desc:`, rien d'autre.
function texteAnnonce(diff) {
  return diff.split('\n')
    .filter(l => /^\+.*id:\s*'dtpu-/.test(l))
    .map(l => (l.match(/(?:title|desc):\s*'((?:[^'\\]|\\.)*)'/g) || []).join(' '))
    .join(' ')
    .replace(/^(?:title|desc):\s*'|'$/g, '');
}
function defautsDeLangue(diff) {
  const t = texteAnnonce(diff);
  if (t.length < 40) return [];                    // pas d'annonce lisible dans le diff → rien à dire
  const d = [];
  const accents = (t.match(ACCENTS_RX) || []).length;
  if (accents < Math.max(5, Math.floor(t.length / 80))) {
    d.push(`accents : ${accents} pour ${t.length} caractères — le texte est écrit sans accents.`);
  }
  const elis = [...t.matchAll(ELISION_RX)].map(m => m[2]).slice(0, 4);
  if (elis.length) d.push(`apostrophes escamotées : « ${elis.join(' », « ')} » isolés — écrire d’, l’, qu’ (apostrophe ’, U+2019).`);
  const mots = SANS_ACCENT.filter(m => new RegExp('\\b' + m + '\\b', 'i').test(t)).slice(0, 6);
  if (mots.length) d.push(`mots sans accent : ${mots.join(', ')}.`);
  return d;
}
// … et touche-t-il à autre chose que ce tableau ? (au moins une ligne ajoutée/retirée hors « dtpu- »)
const toucheAutreChose = d => d.split('\n').some(l => /^[+-][^+-]/.test(l) && !/id:\s*'dtpu-/.test(l));

function main() {
  const mode = process.argv.includes('--last') ? 'last' : 'index';
  const list = fichiers(mode);
  if (!list.length) process.exit(0);

  const dServer = list.includes('server.js') ? diffDe('server.js', mode) : '';
  const annonce = aNouvelleAnnonce(dServer);

  const visibles = list.filter(f => VISIBLE_RX.test(f) && !IGNORE_RX.test(f));
  if (list.includes('server.js') && toucheAutreChose(dServer)) visibles.push('server.js');

  if (!visibles.length) process.exit(0);          // rien de visible → rien à annoncer
  if (annonce) {
    // Présente, oui — mais lisible ? Une annonce est un texte de produit, pas une ligne de log.
    const maux = defautsDeLangue(dServer);
    if (!maux.length) {
      console.log('[Nouveautés DTP] ✓ une annonce accompagne ce commit.');
      process.exit(0);
    }
    console.error('\n╭─ NOUVEAUTÉS DTP — L\'ANNONCE N\'EST PAS EN FRANÇAIS CORRECT ────────────────────');
    maux.forEach(m => console.error('│ · ' + m));
    console.error('│');
    console.error('│ Ce texte s\'affiche tel quel dans l\'onglet DTP des ALERTES, chez les clients.');
    console.error('│ L\'apostrophe DROITE fermerait la chaîne : utiliser l\'apostrophe ’ (U+2019),');
    console.error('│ qui ne casse rien et qui est la forme correcte en français.');
    console.error('╰─────────────────────────────────────────────────────────────────────────────\n');
    process.exit(1);
  }

  const j = new Date();
  const stamp = `${j.getFullYear()}${String(j.getMonth() + 1).padStart(2, '0')}${String(j.getDate()).padStart(2, '0')}`;
  console.error('\n╭─ NOUVEAUTÉS DTP — ANNONCE MANQUANTE ────────────────────────────────────────');
  console.error('│ Ce commit touche des fichiers VUS PAR LES CLIENTS :');
  visibles.slice(0, 8).forEach(f => console.error('│   · ' + f));
  if (visibles.length > 8) console.error(`│   … et ${visibles.length - 8} autre(s)`);
  console.error('│');
  console.error('│ Or DTP_UPDATES (server.js) ne contient aucune entrée nouvelle : les utilisateurs');
  console.error('│ ne verront pas passer le changement dans l\'onglet DTP des ALERTES.');
  console.error('│');
  console.error('│ Ajoute une ligne EN TÊTE du tableau DTP_UPDATES, ton annonce produit, sans jargon :');
  console.error(`│   { id: 'dtpu-${stamp}-mon-sujet', ts: Date.UTC(${j.getFullYear()}, ${j.getMonth()}, ${j.getDate()}, 12, 0),`);
  console.error('│     title: \'…\', desc: \'…\' },');
  console.error('│');
  console.error('│ Changement réellement invisible (refonte interne, correctif de panne) ?');
  console.error('│   git commit --no-verify');
  console.error('╰─────────────────────────────────────────────────────────────────────────────\n');
  process.exit(1);
}

function installer() {
  const dir = path.join(ROOT, '.git', 'hooks');
  if (!fs.existsSync(dir)) { console.error('Aucun dossier .git/hooks — dépôt git introuvable.'); process.exit(1); }
  const f = path.join(dir, 'pre-commit');
  const sc = '#!/bin/sh\n# Garde-fou « Nouveautés DTP » (scripts/dtp-updates-verif.js).\nexec node scripts/dtp-updates-verif.js\n';
  fs.writeFileSync(f, sc, { mode: 0o755 });
  try { fs.chmodSync(f, 0o755); } catch {}
  console.log('Hook pre-commit installé : ' + f);
  console.log('Il refusera désormais un commit visible par les clients sans entrée DTP_UPDATES.');
}

/* ── CONTRE-ÉPREUVE (--autotest, appelée par `npm run check`) ──────────────────────────────────
   Un garde-fou qu'on n'a pas vu refuser quelque chose n'est pas un garde-fou : c'est une ligne de
   code qu'on croit protectrice. On lui présente donc les DEUX cas, à chaque passage du contrôle :
   une entrée réelle écrite sans accents (elle doit être refusée) et une entrée en français correct
   (elle doit passer). Le jour où la table de détection dérive, ce contrôle-ci le dit. */
function autotest() {
  let ko = 0;
  const v = (nom, cond, detail) => { if (cond) console.log('  ✓ ' + nom); else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
  console.log('\n── Nouveautés DTP : le garde-fou de langue sait-il encore refuser ? ──');
  const mauvaise = "+  { id: 'dtpu-20260101-essai', ts: 0, title: 'Le Recap Hebdo retrouve sa partie Macro et les memes titres', "
    + "desc: 'LA MACRO REVIENT A SA PLACE. Elle avait ete retiree du rendu en aout au motif qu elle repetait les blocs "
    + "devises. Le motif etait vrai pour certains themes et faux pour le reste : la semaine macro d ensemble ne se "
    + "reconstitue pas en lisant huit blocs devises l un apres l autre. Les rapports deja archives en profitent aussi.' },";
  const bonne = "+  { id: 'dtpu-20260101-essai', ts: 0, title: 'Le Récap Hebdo retrouve sa partie Macro, et les trois récaps portent les mêmes titres', "
    + "desc: 'LA MACRO REVIENT À SA PLACE, entre la géopolitique et les devises. Elle avait été retirée du rendu en août "
    + "au motif qu’elle répétait les blocs devises. Le motif était vrai pour certains thèmes et faux pour le reste : la "
    + "semaine macro d’ensemble ne se reconstitue pas en lisant huit blocs devises l’un après l’autre.' },";
  const dMauvais = defautsDeLangue(mauvaise);
  const dBon = defautsDeLangue(bonne);
  v('une annonce sans accents est REFUSÉE', dMauvais.length > 0);
  v('… et le refus dit pourquoi (accents, apostrophes, mots)', dMauvais.length >= 3, dMauvais.join(' | '));
  v('une annonce en français correct PASSE', dBon.length === 0, dBon.join(' | '));
  // Un texte trop court (pas d'annonce dans le diff) ne doit jamais déclencher le refus.
  v('un diff sans annonce ne déclenche rien', defautsDeLangue('+  const X = 1;').length === 0);
  console.log(ko ? '\n✗ ' + ko + ' ÉCHEC(S)\n' : '\n✓ le garde-fou de langue tient.\n');
  process.exit(ko ? 1 : 0);
}

if (process.argv.includes('--install')) installer();
else if (process.argv.includes('--autotest')) autotest();
else main();

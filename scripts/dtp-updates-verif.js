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

/* ── CONTRESENS « à » / « a » ────────────────────────────────────────────────────────────────────
   ⚠️ POSÉ LE 27/08 APRÈS DÉGÂT AVÉRÉ, et il vise une faute d'une autre nature que les précédentes.
   Les contrôles ci-dessus traquent des accents MANQUANTS — une négligence, qui se lit quand même.
   Celui-ci traque un accent DE TROP au seul endroit où il retourne le sens : « a » est le verbe
   avoir, « à » est une préposition. Confondre les deux ne rend pas la phrase moins soignée, il la
   rend fausse — « le desk à de quoi comparer », « si l'envoi à bien été accepté ».
   L'AUTEUR DU DÉGÂT ÉTAIT NOTRE PROPRE OUTIL : `scripts/dtp-updates-accents.js` retombait sur « à »
   faute de preuve du contraire, et ne reconnaissait comme sujet qu'une liste fermée de pronoms —
   donc jamais un sujet nom, jamais la négation. Trente et un contresens sont partis chez les
   clients avant qu'on les voie. L'outil a été inversé (il n'accentue plus que sur preuve) ; ce
   contrôle-ci est la ceinture : même si un outil ou une main recommence, le commit est refusé.
   DEUX FORMES, toutes deux mécaniques — aucune heuristique, donc aucune accusation à tort :
     · « n’à » n'existe dans AUCUNE phrase française. C'est toujours « n’a ».
     · « à » suivi d'un participe passé est un passé composé : l'auxiliaire, donc « a ». */
const CONTRESENS = [
  /* ⚠️ PAS DE `\b` APRÈS « à ». `\b` se pose entre un caractère de mot et un autre qui n'en est
     pas — or « à » N'EST PAS un caractère de mot pour le moteur JS. « n’à pas » n'aurait donc
     jamais déclenché : la règle serait restée muette, exactement comme le défaut qu'elle traque.
     Écrit d'abord ainsi, et pris sur le fait par le contrôle inverse ci-dessous.
     ⚠️ ET LES DEUX APOSTROPHES, pas seulement la typographique. Le tableau porte les deux : les
     entrées récentes emploient « ’ » (U+2019), les anciennes l'apostrophe droite échappée dans le
     littéral JS (« n\'à »). La première passe de réparation ne connaissait que « ’ » et a laissé
     TROIS contresens en place — trouvés en relisant le corpus à l'œil, pas par le contrôle, ce qui
     est exactement ce qu'un contrôle est censé éviter.
     ⚠️ ET LA BARRE D'ÉCHAPPEMENT COMPTE. La passe corpus lit server.js EN SOURCE, pas des chaînes
     évaluées : une apostrophe droite y est écrite avec sa barre d'échappement devant, donc entre le
     « n » et l'apostrophe il y a un CARACTÈRE de plus. La règle élargie aux deux apostrophes ratait
     encore le cas — et la mutation l'a dit tout de suite, ce qui est précisément pourquoi on mute
     avant de croire un contrôle sur parole. */
  [/n\\?[’']à(?![a-zA-ZÀ-ÿ])/g, '« n’à » — c’est le verbe avoir : écrire « n’a »'],
  [/(^|[\s’']|\\')à (?:été|eu|pu|dû|fait|dit|mis|pris|su|vu|voulu|fallu|permis|perdu|connu|tenu|rendu|reçu|disparu|paru|vécu|lu|fini|choisi|servi|offert|ouvert|couvert|écrit|montré|trouvé|corrigé|changé|ajouté|retiré|donné|laissé|gagné|cessé|suffi|manqué|bougé|duré|touché|évité|posé|livré|repris|remis|déjà|bien|aussi|enfin|donc|toujours)\b/g,
   '« à » suivi d’un participe ou d’un adverbe — c’est l’auxiliaire avoir : écrire « a »'],
];

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
  for (const [rx, dit] of CONTRESENS) {
    const h = [...t.matchAll(rx)].map(m => m[0].trim()).slice(0, 4);
    if (h.length) d.push(`CONTRESENS : ${dit} — vu : « ${h.join(' », « ')} ».`);
  }
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

  /* ── LE CONTRESENS « à » / « a », DANS LES DEUX SENS ────────────────────────────────────────── */
  const cMauvais = defautsDeLangue("+  { id: 'dtpu-20260101-essai', ts: 0, title: 'Essai', "
    + "desc: 'Le desk n’à pas de quoi comparer, et la seconde porte à donc sa garantie. La recherche à montré "
    + "pourquoi : si l’envoi à bien été accepté, le message à aussi été raccourci de moitié depuis la journée "
    + "précédente, et le récap hebdo n’à jamais eu son liseré doré devant chaque titre de rubrique.' },");
  v('« n’à » est REFUSÉ', cMauvais.some(x => /n’à/.test(x)), cMauvais.join(' | '));
  v('« à » + participe est REFUSÉ', cMauvais.some(x => /participe/.test(x)), cMauvais.join(' | '));
  /* ⚠️ ET SURTOUT L'INVERSE : la MÊME phrase, écrite juste, doit passer. Sans ce contrôle, une règle
     qui refuserait tout « à » du corpus passerait le test ci-dessus et bloquerait chaque commit. */
  const cBon = defautsDeLangue("+  { id: 'dtpu-20260101-essai', ts: 0, title: 'Essai', "
    + "desc: 'Le desk n’a pas de quoi comparer, et la seconde porte a donc sa garantie. La recherche a montré "
    + "pourquoi : si l’envoi a bien été accepté, le message a aussi été raccourci de moitié depuis la journée "
    + "précédente, et le récap hebdo n’a jamais eu son liseré doré devant chaque titre de rubrique.' },");
  v('… la même phrase écrite juste PASSE', cBon.length === 0, cBon.join(' | '));
  /* ⚠️ LES DEUX ÉCRITURES DE L'APOSTROPHE, et la barre d'échappement avec. Les entrées récentes
     emploient « ’ » (U+2019) ; les anciennes portent l'apostrophe droite, qui dans un littéral JS
     s'écrit précédée d'une barre. Trois contresens sont restés en place parce que la première règle
     ne connaissait que « ’ », et il a fallu relire le corpus à l'œil pour les voir — ce qu'un
     contrôle est justement censé éviter. Les deux formes sont donc éprouvées ici, pour toujours. */
  const cEchap = defautsDeLangue("+  { id: 'dtpu-20260101-essai', ts: 0, title: 'Essai', "
    + "desc: 'Le change au comptant n\\'à pas de volume centralisé, et le thème sombre n\\'à pas bouge "
    + "d\\'un pixel depuis la livraison précédente du mois dernier, ce qui se voit sur chaque écran.' },");
  v('« n’à » écrit avec l’apostrophe droite échappée est REFUSÉ aussi',
    cEchap.some(x => /n’à/.test(x)), cEchap.join(' | '));
  const cEchapBon = defautsDeLangue("+  { id: 'dtpu-20260101-essai', ts: 0, title: 'Essai', "
    + "desc: 'Le change au comptant n\\'a pas de volume centralisé, et le thème sombre n\\'a pas bougé "
    + "d\\'un pixel depuis la livraison précédente du mois dernier, ce qui se voit sur chaque écran.' },");
  v('… et la même phrase écrite juste PASSE', cEchapBon.length === 0, cEchapBon.join(' | '));

  /* Les vraies prépositions du corpus ne doivent pas être prises pour des auxiliaires. */
  const cPrep = defautsDeLangue("+  { id: 'dtpu-20260101-essai', ts: 0, title: 'Essai', "
    + "desc: 'À partir de cette livraison, le panneau à onglets se déplie à l’écran de la même façon à Paris "
    + "qu’à Londres, et la colonne passe à droite à l’ouverture comme à la fermeture de la séance du jour.' },");
  v('… et une vraie préposition n’est pas accusée', cPrep.length === 0, cPrep.join(' | '));

  /* ── LE CORPUS LIVRÉ, EN ENTIER ─────────────────────────────────────────────────────────────────
     Le hook ne voit que le diff : il protège l'avenir, pas le passé. Or l'outil d'accents réécrit
     server.js EN ENTIER à chaque passage — c'est ainsi qu'il a abîmé trente et une annonces déjà
     livrées, sans qu'aucune ligne du diff ne soit « nouvelle ». On relit donc tout le tableau. */
  const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const iD = SRV.indexOf('const DTP_UPDATES = [');
  const corpus = iD < 0 ? '' : SRV.slice(iD, SRV.indexOf('\n];', iD));
  v('le tableau DTP_UPDATES est lisible', corpus.length > 1000);
  const fautes = [];
  for (const [rx, dit] of CONTRESENS) {
    for (const m of corpus.matchAll(rx)) {
      const ctx = corpus.slice(Math.max(0, m.index - 45), m.index + 45).replace(/\s+/g, ' ');
      fautes.push(dit.split(' —')[0] + ' → …' + ctx + '…');
    }
  }
  v('aucun contresens « à »/« a » dans les ' + (corpus.match(/id: 'dtpu-/g) || []).length + ' annonces livrées',
    fautes.length === 0, fautes.slice(0, 6).join('\n      → '));
  console.log(ko ? '\n✗ ' + ko + ' ÉCHEC(S)\n' : '\n✓ le garde-fou de langue tient.\n');
  process.exit(ko ? 1 : 0);
}

if (process.argv.includes('--install')) installer();
else if (process.argv.includes('--autotest')) autotest();
else main();

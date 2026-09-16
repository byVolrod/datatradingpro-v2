#!/usr/bin/env node
/**
 * scripts/volume-verif.js — UN CACHE QUI DOIT SURVIVRE À UN DÉPLOIEMENT VIT DANS UN VOLUME MONTÉ
 *
 * POURQUOI (10/09). Le cache du positionnement des particuliers s'écrivait à la RACINE du
 * conteneur — `/app/cache_myfxbook.json` — avec ce commentaire : « disk cache (survives server
 * restart) ». Vrai d'un redémarrage. FAUX du seul cas qui compte : un DÉPLOIEMENT.
 * `docker-compose.yml` ne monte que `/app/.chrome_profile_*` et `/app/data` ; tout le reste
 * appartient à la couche d'image, que `docker compose build` détruit et reconstruit. Après CHAQUE
 * mise à jour du desk, le widget repartait donc sans cache et devait ouvrir un navigateur à froid
 * sur la source — d'où le « chargement infini » signalé par l'utilisateur.
 *
 * ⚠️ CE DÉFAUT NE SE VOIT NI EN LISANT LE CODE (le chemin est correct, l'écriture réussit), NI EN
 * DÉVELOPPEMENT (le fichier persiste, il n'y a pas de build). Il ne se voit qu'en CROISANT le code
 * et le fichier de composition. C'est ce que fait ce banc : il lit les volumes RÉELLEMENT montés,
 * puis vérifie que chaque cache déclaré comme durable tombe dedans.
 *
 *   node scripts/volume-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const t = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
};

/* ── 1. Les points de montage RÉELS, lus dans docker-compose.yml ────────────────────────────── */
const COMPOSE = fs.readFileSync(path.join(RACINE, 'docker-compose.yml'), 'utf8');
const montes = [...COMPOSE.matchAll(/^\s*-\s*\.\/[^:\s]+:(\/app\/[^\s]+)/gm)].map(m => m[1]);

console.log('\n[1] Les volumes montés sont lus dans le fichier de composition');
t('au moins un volume est monté sous /app', montes.length > 0, montes.join(' · '));
t('… dont /app/data (le volume de données de l\'application)', montes.includes('/app/data'), montes.join(' · '));

/* Un chemin est durable s'il est SOUS un point de montage. */
const durable = (abs) => montes.some(m => abs === m || abs.startsWith(m + '/'));

/* ── 2. Chaque cache annoncé comme durable tombe dans un volume ─────────────────────────────── */
console.log('\n[2] Les caches qui promettent de survivre tombent dans un volume monté');

/* On résout les chemins comme le ferait Node à l'exécution DANS le conteneur : la racine du
   projet est /app. On lit donc le vrai code, on en extrait l'expression path.join, et on la
   déroule — pas une liste de chemins recopiée à la main, qui dériverait le jour où l'un bouge. */
/* ⚠️ BALAYAGE AUTOMATIQUE — LA LISTE TENUE À LA MAIN EST CE QUI A LAISSÉ PASSER LES AUTRES
   (16/09). Ce banc est né le 10/09 du cache DMX détruit à chaque déploiement, et il n'a surveillé
   QUE lui : une seule entrée, écrite à la main. Mesuré six jours plus tard, cinq autres caches JSON
   vivaient encore à la racine du conteneur, dont `cache_ff.json` et `cache_ff_raw.json` — le REPLI
   du calendrier économique, donc vidé à chaque livraison, donc absent le jour où la source tombe
   juste après un déploiement. Le correctif avait traité UN cas et déclaré la classe close.
   On ne liste donc plus : on BALAIE. Tout fichier `.json` que le code écrit sous /app hors volume
   est refusé, quel que soit le scraper qui l'écrit, y compris ceux qui n'existent pas encore. */
const CIBLES = (() => {
  const out = [];
  const dossiers = ['scrapers', '.'];
  for (const d of dossiers) {
    let fichiers = [];
    try {
      fichiers = fs.readdirSync(path.join(RACINE, d))
        .filter(f => f.endsWith('.js'))
        .map(f => (d === '.' ? f : d + '/' + f));
    } catch {}
    for (const f of fichiers) {
      let src = '';
      try { src = fs.readFileSync(path.join(RACINE, f), 'utf8'); } catch { continue; }
      /* On ne retient que les constantes RÉELLEMENT écrites sur disque : une constante lue seule
         (le chemin d'AVANT une migration, par exemple) n'a pas à être durable — elle est là pour
         récupérer l'ancien fichier une dernière fois. */
      /* ⚠️ DEUX FORMES, ET LA SECONDE A FAILLI RENDRE CE BANC AVEUGLE (16/09). En migrant les
         caches vers le volume, leur déclaration est devenue
         `const X = _migrerCache(path.join(neuf), path.join(ancien))`. Le balayage, qui ne
         connaissait que `const X = path.join(`, a cessé de les voir : il est repassé au vert en
         ne vérifiant plus RIEN, à l'instant même où il aurait dû confirmer la réparation. C'est le
         faux vert dans sa forme la plus traîtresse — celle qui suit le correctif. Les deux formes
         sont donc reconnues, et un contrôle de DÉNOMBREMENT plus bas refuse que le balayage
         retombe à une poignée de fichiers. */
      for (const m of src.matchAll(/const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:_migrerCache\(\s*)?path\.join\(/g)) {
        const nom = m[1];
        if (out.some(c => c.fichier === f && c.nom === nom)) continue;
        const ecrit = new RegExp('writeFileSync\\(\\s*' + nom + '\\b').test(src)
          || new RegExp('createWriteStream\\(\\s*' + nom + '\\b').test(src);
        if (!ecrit) continue;
        out.push({ fichier: f, nom, quoi: f + ' · ' + nom });
      }
      /* Les chemins fabriqués par une FONCTION (`getCacheFile(type)`) échappent à la recherche
         ci-dessus : c'est exactement la forme qu'avait `scrapers/cot.js`, et c'est pour ça qu'il
         est passé entre les mailles pendant six jours. On les attrape par leur `path.join` inline. */
      for (const m of src.matchAll(/return\s+path\.join\(([^;]+)\);/g)) {
        const segs = m[1];
        if (!/\.json|\`/.test(segs)) continue;
        if (!/__dirname/.test(segs)) continue;
        out.push({ fichier: f, inline: segs, quoi: f + ' · chemin fabriqué' });
      }
    }
  }
  return out;
})();

/* Déroule un `path.join(...)` écrit inline, en remplaçant un gabarit (\`cache_cot_\${type}.json\`)
   par un nom d'exemple : ce qu'on vérifie est le DOSSIER, pas le nom du fichier. */
function resoudreInline(segs, dossierFichier) {
  const parts = segs.split(',').map(x => x.trim());
  let base = null; const suite = [];
  for (const seg of parts) {
    if (seg === '__dirname') { base = '/app/' + dossierFichier; continue; }
    if (/^'[^']*'$/.test(seg)) { suite.push(seg.slice(1, -1)); continue; }
    if (/^`[^`]*`$/.test(seg)) { suite.push(seg.slice(1, -1).replace(/\$\{[^}]*\}/g, 'x')); continue; }
    return null;
  }
  if (!base) return null;
  return path.posix.normalize([base].concat(suite).join('/'));
}

/* Résolution d'un `path.join(...)` écrit dans le source, en suivant les variables
   intermédiaires : `CACHE_FILE = path.join(CACHE_DIR, 'x.json')` avec
   `CACHE_DIR = path.join(__dirname, '..', 'data')` doit rendre /app/data/x.json, pas
   /app/scrapers/x.json. La première écriture de ce banc s'est trompée exactement là — elle prenait
   `CACHE_DIR` pour un segment de chemin littéral — et accusait un code correct. */
function resoudre(src, nom, dossierFichier, profondeur) {
  if (profondeur > 4) return null;
  const m = new RegExp('const\\s+' + nom + '\\s*=\\s*(?:_migrerCache\\(\\s*)?path\\.join\\(([^;]+)\\);').exec(src);
  if (!m) return null;
  /* Avec le wrapper, la capture contient les DEUX chemins : « a, b, 'x.json'), path.join(c, …)) ».
     On ne garde que le premier, c'est lui qui sera écrit ; le second est l'ancien, relu une fois. */
  const segs = m[1].split('),')[0].split(',').map(x => x.trim()).filter(Boolean);
  let base = null; const suite = [];
  for (const seg of segs) {
    if (seg === '__dirname') { base = '/app/' + dossierFichier; continue; }
    if (/^'[^']*'$/.test(seg)) { suite.push(seg.slice(1, -1)); continue; }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg)) {          // une variable → on la résout à son tour
      const sous = resoudre(src, seg, dossierFichier, profondeur + 1);
      if (!sous) return null;
      base = sous; continue;
    }
    return null;                                          // expression non reconnue : on préfère ne rien affirmer
  }
  if (!base) return null;
  return path.posix.normalize([base].concat(suite).join('/'));
}

/* On RÉSOUT d'abord, on compte ensuite, on vérifie enfin : sans cet ordre, un balayage devenu
   aveugle passerait le cliquet avant que quiconque ne s'en aperçoive. */
const CIBLES_JSON = [];
for (const c of CIBLES) {
  const src = fs.readFileSync(path.join(RACINE, c.fichier), 'utf8');
  const abs = c.inline
    ? resoudreInline(c.inline, path.dirname(c.fichier))
    : resoudre(src, c.nom, path.dirname(c.fichier), 0);
  if (!abs) continue;                         // expression non reconnue : on préfère ne rien affirmer
  if (!/\.json$/.test(abs)) continue;         // seuls les caches de données nous intéressent ici
  CIBLES_JSON.push({ quoi: c.quoi, abs });
}

/* CLIQUET DE COUVERTURE. Le 16/09, en migrant neuf caches vers le volume, la forme de leur
   déclaration a changé — et le balayage, qui ne connaissait que l'ancienne, est passé de NEUF
   caches vérifiés à UN, en devenant VERT. Sans une ligne du banc modifiée. C'est le faux vert dans
   sa forme la plus traîtresse : celle qui suit immédiatement le correctif et le certifie.
   On fige donc le nombre connu. Le BAISSER quand un cache disparaît vraiment, jamais pour faire
   taire le banc. */
const COUVERTURE_MINI = 9;
t('le balayage voit toujours au moins ' + COUVERTURE_MINI + ' caches (cliquet de couverture)',
  CIBLES_JSON.length >= COUVERTURE_MINI,
  CIBLES_JSON.length + ' vu(s) : ' + CIBLES_JSON.map(c => c.abs).join(' · '));

for (const c of CIBLES_JSON) {
  t(c.quoi + ' : dans un volume monté', durable(c.abs),
    c.abs + '  (montés : ' + montes.join(', ') + ')');
}

/* ── 2 bis. BALAYAGE TEXTUEL — indépendant de la FORME de la déclaration ──────────────────────── */
/* ⚠️ LE BALAYAGE PAR CONSTANTE A UN ANGLE MORT, ET IL A DÉJÀ MORDU. `scrapers/cot.js` fabrique le
   chemin de son cache DANS UNE FONCTION (`getCacheFile(type)`) : aucune constante de haut niveau à
   reconnaître, donc invisible au balayage ci-dessus pendant six jours — pendant lesquels le repli du
   positionnement était vidé à chaque livraison. Ce contrôle-ci ne regarde plus la forme mais le
   FAIT : une adresse de fichier .json construite à la racine du conteneur. Il attrape n'importe
   quelle écriture, présente ou future, quelle que soit la manière dont elle est écrite.
   SEULE EXCEPTION, et elle est explicite : la ligne qui désigne l'ANCIEN emplacement d'un cache
   migré — elle est relue une fois puis jamais réécrite, et elle porte le mot « ancien ». */
console.log('\n[2 bis] Aucune adresse de cache .json ne pointe vers la racine du conteneur');
{
  const fautifs = [];
  const balayer = (rel) => {
    let src = ''; try { src = fs.readFileSync(path.join(RACINE, rel), 'utf8'); } catch { return; }
    src.split('\n').forEach((ligne, i) => {
      if (!/path\.join\(\s*__dirname\s*,\s*'\.\.'\s*,/.test(ligne) && !/path\.join\(\s*__dirname\s*,\s*[`']/.test(ligne)) return;
      if (!/\.json/.test(ligne)) return;
      if (/ancien|ANCIEN|legacy/.test(ligne)) return;           // l'ancien emplacement, relu une fois
      if (/_DOSSIER_DONNEES|'data'/.test(ligne)) return;        // déjà dans le volume
      fautifs.push(rel + ':' + (i + 1) + '  ' + ligne.trim().slice(0, 110));
    });
  };
  for (const d of ['scrapers', '.']) {
    let fichiers = [];
    try { fichiers = fs.readdirSync(path.join(RACINE, d)).filter(f => f.endsWith('.js')).map(f => (d === '.' ? f : d + '/' + f)); } catch {}
    fichiers.forEach(balayer);
  }
  t('aucun cache .json n\'est écrit à la racine du conteneur', fautifs.length === 0, fautifs.join('\n      → '));

  /* ── TÉMOIN ── le balayage doit savoir reconnaître la faute qu'on lui glisse. */
  const faute = "const X = path.join(__dirname, '..', 'cache_essai.json');";
  const voitLaFaute = /path\.join\(\s*__dirname\s*,\s*'\.\.'\s*,/.test(faute) && /\.json/.test(faute)
    && !/ancien|ANCIEN|legacy/.test(faute) && !/_DOSSIER_DONNEES|'data'/.test(faute);
  t('(témoin) une adresse fautive glissée dans le balayage est bien vue', voitLaFaute);
  const exempt = "const ancien = path.join(__dirname, '..', 'cache_essai.json');";
  t('(témoin) … et la ligne de l\'ancien emplacement, elle, reste tolérée',
    /ancien|ANCIEN|legacy/.test(exempt));
}

/* ── 3. TÉMOINS — le banc doit refuser un chemin hors volume, et accepter un chemin dedans ──── */
console.log('\n[3] Les témoins : le banc sait-il encore refuser ?');
t('un chemin à la racine du conteneur est REFUSÉ', !durable('/app/cache_essai.json'), '/app/cache_essai.json');
t('… un chemin dans /app/data est ACCEPTÉ', durable('/app/data/cache_essai.json'));
t('… et /app/datazone ne passe PAS pour /app/data (préfixe trompeur)', !durable('/app/datazone/x.json'));

console.log('\n[Volumes] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

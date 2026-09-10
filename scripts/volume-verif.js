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
const CIBLES = [
  { fichier: 'scrapers/myfxbook.js', nom: 'CACHE_FILE', quoi: 'positionnement des particuliers (DMX)' },
];

/* Résolution d'un `path.join(...)` écrit dans le source, en suivant les variables
   intermédiaires : `CACHE_FILE = path.join(CACHE_DIR, 'x.json')` avec
   `CACHE_DIR = path.join(__dirname, '..', 'data')` doit rendre /app/data/x.json, pas
   /app/scrapers/x.json. La première écriture de ce banc s'est trompée exactement là — elle prenait
   `CACHE_DIR` pour un segment de chemin littéral — et accusait un code correct. */
function resoudre(src, nom, dossierFichier, profondeur) {
  if (profondeur > 4) return null;
  const m = new RegExp('const\\s+' + nom + '\\s*=\\s*path\\.join\\(([^;]+)\\);').exec(src);
  if (!m) return null;
  const segs = m[1].split(',').map(x => x.trim());
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

for (const c of CIBLES) {
  const src = fs.readFileSync(path.join(RACINE, c.fichier), 'utf8');
  const abs = resoudre(src, c.nom, path.dirname(c.fichier), 0);
  if (!abs) { t(c.quoi + ' : le chemin du cache est lisible', false, c.nom + ' non résolu dans ' + c.fichier); continue; }
  t(c.quoi + ' : le cache est dans un volume monté', durable(abs),
    abs + '  (montés : ' + montes.join(', ') + ')');
}

/* ── 3. TÉMOINS — le banc doit refuser un chemin hors volume, et accepter un chemin dedans ──── */
console.log('\n[3] Les témoins : le banc sait-il encore refuser ?');
t('un chemin à la racine du conteneur est REFUSÉ', !durable('/app/cache_essai.json'), '/app/cache_essai.json');
t('… un chemin dans /app/data est ACCEPTÉ', durable('/app/data/cache_essai.json'));
t('… et /app/datazone ne passe PAS pour /app/data (préfixe trompeur)', !durable('/app/datazone/x.json'));

console.log('\n[Volumes] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

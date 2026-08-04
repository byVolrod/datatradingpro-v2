/* ══════════════════════════════════════════════════════════════════════════════════════════════
   PAQUET WINDOWS SANS PRIVILÈGE ÉLEVÉ (04/08)

   Pourquoi ce script existe : `electron-builder` télécharge un cache de signature qui contient des
   liens symboliques macOS. Les créer exige le mode développeur Windows ou une session
   administrateur ; sans eux l'extraction échoue et le build s'arrête AVANT de produire quoi que ce
   soit. Constaté sur ce poste depuis le 27 juin (cache jonché d'extractions avortées).

   Un paquet Electron n'est pourtant qu'un assemblage : le runtime d'Electron, l'exécutable renommé,
   et les fichiers de l'app dans resources/app. C'est exactement ce que fait ce script — sans
   installeur ni signature, donc sans aucun privilège.

   Ce qu'il NE fait PAS : ni installeur NSIS, ni mise à jour automatique (latest.yml). Il sert à
   OBTENIR UNE APP QUI TOURNE pour vérifier un correctif. La chaîne officielle reste
   `npm run build:win`, une fois le mode développeur activé.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PKG    = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'));
const SRC    = path.join(RACINE, 'node_modules', 'electron', 'dist');
const OUT    = path.join(RACINE, 'dist', 'DataTradingPro-win32-x64');
const EXE    = path.join(OUT, 'DataTradingPro.exe');
const RCEDIT = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign', 'rcedit-x64.exe');

if (!fs.existsSync(SRC)) { console.error('Runtime Electron introuvable :', SRC); process.exit(1); }

// 1 · Copie du runtime
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });
console.log('1/5  runtime Electron copié');

// 2 · L'exécutable prend le nom du produit (c'est lui qui s'affiche dans la barre des tâches)
fs.renameSync(path.join(OUT, 'electron.exe'), EXE);
console.log('2/5  exécutable renommé → DataTradingPro.exe');

// 3 · Fichiers de l'app dans resources/app (l'emplacement qu'Electron charge par défaut)
const APP = path.join(OUT, 'resources', 'app');
fs.mkdirSync(path.join(APP, 'build'), { recursive: true });
for (const f of PKG.build.files) {
  const de = path.join(RACINE, f), vers = path.join(APP, f);
  if (!fs.existsSync(de)) { console.warn('    (absent, ignoré) ' + f); continue; }
  fs.mkdirSync(path.dirname(vers), { recursive: true });
  fs.copyFileSync(de, vers);
}
// package.json minimal : Electron y lit `main`, et le nom/version alimentent app.getVersion()
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({
  name: PKG.name, productName: PKG.productName, version: PKG.version, main: PKG.main,
}, null, 2) + '\n');
// electron-updater est require() dans un try/catch par main.js : absent, la mise à jour se désactive
// en silence. On l'embarque quand même pour rester au plus près du paquet officiel.
const MAJ = path.join(RACINE, 'node_modules', 'electron-updater');
if (fs.existsSync(MAJ)) {
  fs.cpSync(MAJ, path.join(APP, 'node_modules', 'electron-updater'), { recursive: true });
  for (const dep of ['builder-util-runtime', 'js-yaml', 'lodash.escaperegexp', 'lodash.isequal',
                     'semver', 'tiny-typed-emitter', 'lazy-val', 'fs-extra', 'graceful-fs',
                     'jsonfile', 'universalify', 'sax', 'debug', 'ms', 'argparse']) {
    const d = path.join(RACINE, 'node_modules', dep);
    if (fs.existsSync(d)) fs.cpSync(d, path.join(APP, 'node_modules', dep), { recursive: true });
  }
}
console.log('3/5  fichiers de l\'app installés dans resources/app');

// 4 · Icône + métadonnées gravées dans l'exe (rcedit, extrait du cache electron-builder : c'est le
//     MÊME outil que celui qu'utilise la chaîne officielle, sans le reste du paquet de signature)
const ICO = path.join(RACINE, 'build', 'icon.ico');
if (fs.existsSync(RCEDIT) && fs.existsSync(ICO)) {
  execFileSync(RCEDIT, [EXE,
    '--set-icon', ICO,
    '--set-version-string', 'ProductName', PKG.productName,
    '--set-version-string', 'FileDescription', PKG.description,
    '--set-version-string', 'CompanyName', PKG.author,
    '--set-file-version', PKG.version,
    '--set-product-version', PKG.version,
  ], { stdio: 'inherit' });
  console.log('4/5  icône et métadonnées gravées dans l\'exe');
} else {
  console.warn('4/5  rcedit ou icon.ico introuvable → l\'exe garde l\'icône Electron par défaut');
}

// 5 · Contrôle : l'app doit être complète et démarrable
const attendus = ['DataTradingPro.exe', 'resources/app/main.js', 'resources/app/package.json',
                  'resources/app/build/icon.ico', 'resources/app/build/icon.png'];
const manquants = attendus.filter(f => !fs.existsSync(path.join(OUT, f)));
const taille = Math.round(fs.statSync(EXE).size / 1048576);
console.log('5/5  contrôle : ' + (manquants.length ? ('MANQUE ' + manquants.join(', ')) : 'complet')
  + ' — exe ' + taille + ' Mo');
console.log('\nPaquet : ' + OUT);
process.exit(manquants.length ? 1 : 0);

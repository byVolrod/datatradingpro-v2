// Aligne les <lastmod> de landing/sitemap-pages.xml sur la DATE RÉELLE du dernier commit de chaque
// fichier. Les dates étaient figées au 21-24 juin alors que les 24 pages ont été réécrites depuis :
// un lastmod qui ment dans les deux sens coûte du crawl (trop vieux = Google ne repasse pas ; trop
// neuf = il repasse pour rien et finit par ignorer le signal).
//
// ⚠️ LA SOURCE EST `git log`, JAMAIS `fs.statSync().mtime` : le déploiement passe par un clone puis un
// rebuild, donc tous les mtime valent la date du clone — on écrirait 25 dates fausses d'un coup.
//
// Usage : node scripts/landing-sitemap-dates.js [--dry]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const SITEMAP = path.join(RACINE, 'landing', 'sitemap-pages.xml');
const DRY = process.argv.includes('--dry');

// URL publique -> fichier sur disque. La forme canonique du site est `.html` (alignée sur les
// canonicals et le nginx), sauf les deux répertoires qui servent leur index.
function fichierPour(url) {
  let p = url.replace(/^https?:\/\/datatradingpro\.com/, '');
  if (p === '' || p === '/') p = '/index.html';
  else if (p.endsWith('/')) p += 'index.html';
  return path.join(RACINE, 'landing', p.replace(/^\//, ''));
}

function dateCommit(fichier) {
  try {
    const rel = path.relative(RACINE, fichier).split(path.sep).join('/');
    const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], { cwd: RACINE, encoding: 'utf8' }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch { return null; }
}

let xml = fs.readFileSync(SITEMAP, 'utf8');
let change = 0, absents = [], inchanges = 0;

xml = xml.replace(/<url>([\s\S]*?)<\/url>/g, (bloc) => {
  const url = (bloc.match(/<loc>([^<]+)<\/loc>/) || [])[1];
  if (!url) return bloc;
  const f = fichierPour(url);
  if (!fs.existsSync(f)) { absents.push(url); return bloc; }
  const d = dateCommit(f);
  if (!d) return bloc;
  const actuel = (bloc.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
  if (actuel === d) { inchanges++; return bloc; }
  change++;
  return actuel
    ? bloc.replace(/<lastmod>[^<]+<\/lastmod>/, `<lastmod>${d}</lastmod>`)
    : bloc.replace('</url>', `<lastmod>${d}</lastmod></url>`);
});

if (absents.length) console.warn('⚠️  URLs sans fichier correspondant :', absents.join(', '));
if (!DRY) fs.writeFileSync(SITEMAP, xml);
console.log(`${change} date(s) corrigée(s), ${inchanges} déjà juste(s)${DRY ? ' [simulation]' : ''}`);

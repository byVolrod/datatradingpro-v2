#!/usr/bin/env node
/* ═══ LA VITRINE : IDENTITÉ, DISCRÉTION, ET CE QUE LA LOI EXIGE ════════════════════════════════
   Le site public a vingt-sept pages qui se ressemblent sans être identiques : c'est exactement la
   situation où une correction se pose sur une page et s'oublie sur vingt-six.

   ⚠️ LEÇON PAYÉE LE 27/08, INSCRITE ICI. `doc.css` OUVRE sur un `@import` vers Google Fonts. Dans
   un environnement qui bloque le réseau externe, la feuille ne finit jamais de se charger et
   AUCUNE de ses règles ne s'applique — les mesures sortent alors toutes fausses, y compris celles
   prises « avant » la modification qu'on croit valider. Le contrôle a d'abord accusé un CSS
   parfaitement correct. On répond donc une feuille VIDE à la place de Google Fonts : le reste de
   doc.css s'applique normalement, et la mesure redevient vraie. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const RACINE = path.join(__dirname, '..');
const LAND = path.join(RACINE, 'landing');
const DOCS = fs.existsSync(path.join(LAND, 'documentation'))
  ? fs.readdirSync(path.join(LAND, 'documentation')).filter(f => f.endsWith('.html')) : [];
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const lireDoc = f => fs.readFileSync(path.join(LAND, 'documentation', f), 'utf8');

console.log('\n── 1. Une seule marque, sur les vingt-sept pages ──');
v('la vitrine a bien ses pages de documentation', DOCS.length >= 20, DOCS.length + ' page(s)');
const sansMarque = DOCS.filter(f => !/<span class="doc-mk" aria-hidden="true">DTP<\/span>/.test(lireDoc(f)));
v('chaque page de documentation porte la marque', !sansMarque.length, sansMarque.join(', '));
/* Le mot-symbole reste à côté du carré : une marque seule ne dit pas le nom du produit. */
const sansMot = DOCS.filter(f => !/<span>Data<b>TradingPro<\/b><\/span>/.test(lireDoc(f)));
v('… et le nom du produit à côté', !sansMot.length, sansMot.join(', '));
/* ⚠️ LE CARRÉ EST DESSINÉ, PAS CHARGÉ : une image demanderait une requête, un poids, et un
   re-rendu à chaque changement de teinte. La règle doit donc exister. */
const CSS = fs.readFileSync(path.join(LAND, 'documentation', 'doc.css'), 'utf8');
v('la marque est dessinée en CSS', /\.doc-mk\{/.test(CSS));
v('… en or, sur fond dégradé', /\.doc-mk\{[\s\S]*?background:linear-gradient/.test(CSS));
v('… et elle ne s\'écrase jamais (flex-shrink)', /\.doc-mk\{[\s\S]*?flex-shrink:0/.test(CSS));
v('l\'en-tête aligne marque et nom', /\.doc-logo\{[^}]*display:flex/.test(CSS) && /\.doc-logo\{[^}]*align-items:center/.test(CSS));
/* L'ACCUEIL PORTE LA MÊME : c'est lui la référence, et il dit DTP depuis toujours. */
const IDX = fs.readFileSync(path.join(LAND, 'index.html'), 'utf8');
v('l\'accueil porte la même marque, aux mêmes lettres', /<span class="mk">DTP<\/span>/.test(IDX));

console.log('\n── 2. Ce qui ne doit plus se lire ──');
/* ⚠️ LES URL DE PAIEMENT NE COMPTENT PAS, ET NE DOIVENT PAS COMPTER. Le handle Whop apparaît dans
   l'adresse d'abonnement : la retirer casserait le tunnel, et elle s'affiche de toute façon dans
   la barre du navigateur au premier clic. Ce contrôle vise le NOM ÉCRIT EN TOUTES LETTRES dans le
   texte des pages, ce qui est la demande — pas les liens, qu'on ne touche pas. */
const sansUrls = t => String(t).replace(/https?:\/\/[^\s"'<>]+/g, '');
const fautifs = [];
for (const f of DOCS) { if (/JustOneTrader/i.test(sansUrls(lireDoc(f)))) fautifs.push(f); }
if (/JustOneTrader/i.test(sansUrls(IDX))) fautifs.push('index.html');
v('le nom JustOneTrader ne figure dans AUCUN texte', !fautifs.length, fautifs.join(', '));
/* Et le contre-essai : les liens de paiement, eux, sont TOUJOURS là. Sans lui, tout supprimer en
   bloc — tunnel d'abonnement compris — passerait pour un correctif. */
v('… mais les liens d\'abonnement sont intacts', /whop\.com\/[^"']*jot-dtp/.test(IDX) || DOCS.some(f => /whop\.com\/[^"']*jot-dtp/.test(lireDoc(f))));
/* Le fournisseur de base de données n'a rien à faire sur une page publique : aucun texte ne l'exige. */
const ML = lireDoc('mentions-legales.html');
v('les mentions légales ne nomment pas la base de données', !/Supabase/i.test(ML));
v('… et ne portent plus de champ « à compléter »', !/à compléter/i.test(ML) && !/ml-a-remplir/.test(ML));

console.log('\n── 3. Ce que la loi impose, et qui doit RESTER ──');
/* ⚠️ CE BLOC EXISTE POUR EMPÊCHER UN EXCÈS DE ZÈLE. La discrétion demandée porte sur ce qui n'est
   pas obligatoire. Le RGPD (art. 13) impose de déclarer les destinataires des données : retirer
   Whop ou Supabase de la politique de confidentialité ne serait pas de la discrétion, ce serait un
   défaut de conformité — et personne ne s'en apercevrait avant un contrôle. */
const PC = lireDoc('politique-confidentialite.html');
v('la politique de confidentialité déclare le prestataire de paiement', /Whop/.test(PC));
v('… et l\'hébergeur de la base de données', /Supabase/i.test(PC));
v('les conditions générales nomment le prestataire de paiement', /Whop/.test(lireDoc('conditions-generales.html')));

console.log('\n── 4. Rendu réel, dans un navigateur ──');
(async () => {
  let pp = null;
  try { pp = require('puppeteer-core'); } catch { try { pp = require(path.join(RACINE, 'node_modules', 'puppeteer-core')); } catch {} }
  let bin = null;
  try { bin = require(path.join(RACINE, 'scripts', 'mobile-apercu.js')).trouverNavigateur(); } catch {}
  if (!pp || !bin) {
    console.log('  · aucun Chromium → phase navigateur abstenue (pas un échec)');
  } else {
    const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp' };
    const srv = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
      const f = path.join(LAND, u);
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
    });
    await new Promise(r => srv.listen(4847, r));
    const nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      const page = await nav.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      await page.setRequestInterception(true);
      // Voir l'avertissement en tête de fichier : sans ce bouchon, doc.css ne s'applique jamais ici.
      page.on('request', q => { if (/fonts\.(googleapis|gstatic)\.com/.test(q.url())) q.respond({ status: 200, contentType: 'text/css', body: '' }); else q.continue(); });
      const erreurs = [];
      page.on('pageerror', e => erreurs.push(e.message));
      await page.goto('http://localhost:4847/documentation/mentions-legales.html', { waitUntil: 'networkidle2', timeout: 30000 });
      const m = await page.evaluate(() => {
        const a = document.querySelector('.doc-logo'), mk = a && a.querySelector('.doc-mk');
        const b = a && a.getBoundingClientRect(), mb = mk && mk.getBoundingClientRect();
        const cs = mk && getComputedStyle(mk);
        return {
          feuille: [...document.styleSheets].some(s => { try { return /doc\.css/.test(s.href || '') && s.cssRules.length > 20; } catch { return false; } }),
          flex: a ? getComputedStyle(a).display : '', lettres: mk ? mk.textContent : '',
          taille: mb ? [+mb.width.toFixed(1), +mb.height.toFixed(1)] : null,
          peint: cs ? cs.backgroundImage !== 'none' : false,
          ecart: (b && mb) ? +Math.abs((b.top + b.height / 2) - (mb.top + mb.height / 2)).toFixed(2) : null,
          entete: +document.querySelector('.doc-top').getBoundingClientRect().height.toFixed(1),
        };
      });
      /* LE CONTRÔLE QUI GARDE TOUS LES AUTRES : si la feuille ne s'applique pas, ce qui suit ne
         mesure que des valeurs par défaut du navigateur, et le vert ne veut plus rien dire. */
      v('doc.css s\'applique vraiment (sinon tout le reste est faux)', m.feuille, 'la feuille n\'a pas chargé — voir l\'avertissement en tête de fichier');
      v('l\'en-tête dispose marque et nom en ligne', m.flex === 'flex', m.flex);
      v('la marque est PEINTE, pas seulement déclarée', m.peint);
      v('… elle porte les bonnes lettres', m.lettres === 'DTP', m.lettres);
      v('… et un carré, pas un rectangle', m.taille && m.taille[0] === m.taille[1], JSON.stringify(m.taille));
      v('… verticalement centrée sur le nom', m.ecart !== null && m.ecart < 1, 'écart ' + m.ecart + ' px');
      v('l\'en-tête garde une hauteur de vraie barre', m.entete >= 48, m.entete + ' px');
      v('aucune erreur d\'exécution sur la page', !erreurs.length, erreurs.slice(0, 2).join(' | '));
    } finally { await nav.close(); srv.close(); }
  }
  console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
  process.exit(ko ? 1 : 0);
})();

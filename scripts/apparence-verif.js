#!/usr/bin/env node
/**
 * scripts/apparence-verif.js — LE PANNEAU APPARENCE, OUVERT, DANS LES DEUX THÈMES
 * ------------------------------------------------------------------------------------------------
 * POURQUOI (27/08, demande utilisateur sur capture : « enlève histoire des bougies et restructure
 * bien, et émojis sombre et claire »). Trois choses se jouent dans ce panneau, et aucune ne se voit
 * en lisant le code :
 *
 *   1. UN RÉGLAGE MORT. « Couleur des bougies » n'était branché sur RIEN — aucune ligne du desk ne
 *      lisait `pd-candle-color`. Un `grep` le dit, mais rien n'EMPÊCHE d'en reposer un demain : les
 *      graphiques sont peints par TradingView et amCharts, qui ont leur propre palette.
 *   2. DES ÉMOJIS QUI NE DISENT PAS LEUR THÈME. « 🔥 Mode Sombre » : une flamme n'est ni sombre ni
 *      claire, et à côté d'un soleil elle se lisait comme un troisième réglage.
 *   3. UN PANNEAU QUI NE SE VOIT QUE DANS UN SEUL THÈME. Les commandes portaient un fond écrit en
 *      dur (#1a1a1a) : sur le papier crème du mode clair, trois pastilles noires — dont le bouton
 *      « Mode Clair » lui-même, entouré de deux chips sombres. Personne ne l'avait vu parce que
 *      personne n'avait ouvert ce panneau en mode clair. Ce banc l'ouvre, à chaque passage.
 *
 * ⚠️ LE CONTRÔLE DE THÈME SE FAIT SUR DES PIXELS, PAS SUR DES DÉCLARATIONS. Chercher « #1a1a1a »
 * dans la feuille aurait été vert le jour où la même valeur revient sous un autre nom, ou faux le
 * jour où elle est légitime ailleurs. On compare donc la LUMINANCE peinte de chaque commande à
 * celle du panneau qui la porte : une commande sombre sur un panneau clair se voit, quel que soit
 * le chemin par lequel la couleur est arrivée.
 *
 ⚠️ QUATRE DE CES CONTRÔLES SONT NÉS FAUX, et seule l'épreuve par la casse l'a montré :
 *   · le rythme de la grille mesurait les CELLULES, qui s'étirent à la hauteur de leur rangée : la
 *     marge fautive était absorbée dedans et l'écart valait le `gap` dans tous les cas ;
 *   · puis il a mesuré les `<select>`, tous en `display:none` depuis qu'un menu maison les remplace
 *     — des rectangles à zéro, comparés à zéro, verts pour toujours ;
 *   · puis il comparait deux distances qui ne sont pas comparables : entre deux champs superposés
 *     il y a le LIBELLÉ de la rangée du dessous, jamais entre deux colonnes ;
 *   · et le contrôle de thème lisait le fond du panneau, qui est TRANSPARENT : luminance 0, donc
 *     « rien n'est plus sombre que le panneau », donc vert quoi qu'il arrive.
 * Chacun a ensuite été remis au rouge en reposant le défaut : fond en dur, gouttière triplée,
 * flamme réintroduite, filet du premier sous-titre restauré, sélecteur mort recollé.
 * Au passage, cette épreuve a montré qu'une des « corrections » n'en était pas une : annuler la
 * marge du `<select>` natif ne changeait rien, il n'est jamais affiché. La règle a été retirée.
 *
 *   node scripts/apparence-verif.js      (s'abstient sans Chromium)
 */
const fs = require('fs');
const path = require('path');
const { serveur, trouverNavigateur } = require('./mobile-apercu.js');

const RACINE = path.join(__dirname, '..');
const PORT = 4818;

let ko = 0;
const v = (t, c, d) => { if (c) console.log('  ✓ ' + t); else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

// Luminance perçue d'un « rgb(r, g, b) » — suffit à dire « clair » ou « sombre ».
function lum(css) {
  const m = String(css).match(/(\d+(?:\.\d+)?)/g);
  if (!m || m.length < 3) return null;
  const [r, g, b] = m.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

(async () => {
  console.log('\n── Panneau Apparence : ce qui a été retiré, et ce qui l\'a remplacé ──');

  /* ── PHASE 1 : LA SOURCE. Ce qui doit avoir disparu doit avoir disparu PARTOUT — sinon on laisse
     derrière soi des styles qui ressusciteront au premier copier-coller. ─────────────────────── */
  /* ⚠️ ON CHERCHE DANS LE MARKUP, PAS DANS LES COMMENTAIRES. Le commentaire qui explique POURQUOI
     le réglage a été retiré cite forcément son identifiant : sans ce nettoyage, le contrôle
     accusait la note laissée à la place du bouton. Un contrôle qui interdit d'expliquer une
     suppression finit par faire supprimer l'explication. */
  const html = fs.readFileSync(path.join(RACINE, 'public/index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const css = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  v('le sélecteur de couleur de bougies a quitté la page', html.indexOf('pd-candle-color') < 0);
  v('… et ses styles ont quitté la feuille', !/\.pd-candle-(?:select-wrap|preview)\s*[,{]/.test(css));
  v('… et plus aucune option de bougie ne traîne', html.indexOf('Vert / 🔴 Rouge') < 0);

  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Apparence] aucun Chromium → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Apparence] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }

  const srv = serveur();
  await new Promise((r) => srv.listen(PORT, r));
  let nav;
  try {
    nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    for (const theme of ['dark', 'light']) {
      const page = await nav.newPage();
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('dtp_theme', t); } catch (e) {} }, theme);
      await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => typeof pdOpen === 'function', { timeout: 20000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2200));

      /* ⚠️ OUVRIR PUIS MESURER, EN DEUX TEMPS — ET C'EST CE DÉTAIL QUI A RÉVÉLÉ QUE LE CONTRÔLE DE
         RYTHME NE CONTRÔLAIT RIEN. L'accordéon s'ouvre par une transition : mesuré dans la foulée du
         clic, TOUT vaut zéro, y compris l'écart qu'on prétend vérifier. Le contrôle comparait donc
         0 à 0 et restait vert en remettant le défaut — pris en flagrant délit en le cassant exprès.
         On laisse l'ouverture se terminer avant de sortir la règle. */
      await page.evaluate(() => {
        pdOpen();
        const trig = [...document.querySelectorAll('.pd-section-trigger')].find((b) => /Apparence/.test(b.textContent));
        if (trig) pdAccordion(trig);
      });
      await new Promise((r) => setTimeout(r, 900));

      const m = await page.evaluate(() => {
        const trig = [...document.querySelectorAll('.pd-section-trigger')].find((b) => /Apparence/.test(b.textContent));
        const inner = trig && trig.parentElement.querySelector('.pd-section-inner');
        const sous = [...(inner ? inner.querySelectorAll('.pd-subhead') : [])];
        const btns = [...document.querySelectorAll('.pd-theme-btn')];
        const grille = inner && inner.querySelector('.pd-grid-2');
        const champs = grille ? [...grille.querySelectorAll('.pd-field')] : [];
        const r = (e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
        /* Rythme de la grille : écart entre les deux RANGÉES vs écart entre les deux COLONNES.
           ⚠️ ON MESURE LES CHAMPS EUX-MÊMES, PAS LEURS CELLULES. Première version : elle prenait les
           `.pd-field`, qui sont des éléments de grille et s'ÉTIRENT à la hauteur de leur rangée
           (`align-items: stretch` par défaut). La marge fautive était donc absorbée à l'intérieur de
           la cellule, l'écart mesuré valait le `row-gap` dans les deux cas, et le contrôle restait
           vert même en remettant le défaut — éprouvé, et pris en flagrant délit. Les `select`, eux,
           ne s'étirent pas : entre eux, l'écart est celui qu'on voit. */
        /* ⚠️ ET ON MESURE LE CONTRÔLE QUE L'ŒIL VOIT. Tous les `<select>` du desk sont remplacés au
           chargement par un menu maison (`.dtpsel`) et le `<select>` natif passe en `display:none`
           — ses rectangles valent donc zéro. Deuxième version du même piège : mesurer un élément
           qui n'est plus à l'écran, c'est mesurer zéro et appeler ça un succès. */
        const sels = grille ? [...grille.querySelectorAll('.dtpsel, .pd-select')]
          .filter((e) => getComputedStyle(e).display !== 'none') : [];
        /* ⚠️ L'ÉCART ENTRE DEUX RANGÉES SE MESURE JUSQU'AU LIBELLÉ SUIVANT, PAS JUSQU'AU CHAMP.
           Entre le champ de la rangée 1 et celui de la rangée 2 il y a le LIBELLÉ de la rangée 2 :
           comparer cette distance à l'écart entre colonnes revenait à comparer « une gouttière »
           à « une gouttière plus un texte » — le contrôle échouait quoi qu'on fasse. La gouttière
           seule, c'est du bas du champ au haut du libellé d'en dessous. */
        /* ⚠️ LE FOND D'UN ÉLÉMENT TRANSPARENT N'EST PAS « NOIR », C'EST CELUI DE SON PARENT. La
           première version lisait `backgroundColor` sur le panneau, qui est transparent : elle
           obtenait « rgba(0,0,0,0) », en tirait une luminance de 0, et comparait tout le reste à un
           panneau prétendument noir — plus aucune commande ne pouvait être « plus sombre que lui ».
           Le contrôle restait vert en remettant le fond en dur, ce qui est exactement le défaut
           qu'il prétend surveiller. On remonte donc jusqu'au premier fond réellement peint. */
        const fond = (e) => {
          for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
            const c = getComputedStyle(n).backgroundColor;
            const a = (String(c).match(/[\d.]+/g) || [])[3];
            if (c && c !== 'transparent' && a !== '0') return c;
          }
          return getComputedStyle(document.body).backgroundColor;
        };
        const libelles = grille ? [...grille.querySelectorAll('.pd-label')] : [];
        let ecartRangees = null, ecartColonnes = null;
        if (sels.length === 4 && libelles.length === 4) {
          ecartRangees = +(r(libelles[2]).t - r(sels[0]).b).toFixed(1);
          ecartColonnes = +(r(sels[1]).l - r(sels[0]).r).toFixed(1);
        }
        return {
          sousTitres: sous.map((e) => e.textContent.trim()),
          filetPremier: sous[0] ? getComputedStyle(sous[0]).borderTopWidth : null,
          filetSecond: sous[1] ? getComputedStyle(sous[1]).borderTopWidth : null,
          boutons: btns.map((e) => e.textContent.trim()),
          ecartRangees, ecartColonnes,
          fondPanneau: inner ? fond(inner) : null,
          fondCommandes: [...btns, ...document.querySelectorAll('.pd-zoom-btn, .pd-zoom-reset, .pd-grid-2 .dtpsel-btn')]
            .map((e) => ({ q: (e.id || e.className).toString().slice(0, 24), f: fond(e) })),
          mort: !!document.getElementById('pd-candle-color'),
        };
      });

      console.log('\n  ── thème ' + theme + ' ──');
      v('le réglage mort n\'est pas revenu à l\'écran', m.mort === false);
      v('le panneau est structuré en deux blocs nommés',
        m.sousTitres.length === 2 && /lisibilité/i.test(m.sousTitres[0]) && /formats/i.test(m.sousTitres[1]),
        JSON.stringify(m.sousTitres));
      v('un filet sépare les deux blocs', parseFloat(m.filetSecond) >= 1, String(m.filetSecond));
      v('… et le premier n\'en porte pas (il doublerait celui de la section)',
        parseFloat(m.filetPremier) === 0, String(m.filetPremier));
      /* L'ÉMOJI DOIT DIRE LE THÈME. On ne vérifie pas « il y a un émoji » — il y en avait un avant,
         et c'était une flamme. On vérifie que c'est CELUI-LÀ, et que la flamme a bien disparu. */
      const [clair, sombre, systeme] = m.boutons;
      v('« Mode Clair » porte un soleil', /☀/.test(clair || ''), clair);
      v('« Mode Sombre » porte une lune', /🌙/.test(sombre || ''), sombre);
      v('… et plus la flamme, qui ne disait rien du thème', !/🔥/.test(m.boutons.join(' ')), m.boutons.join(' '));
      v('« Système » porte un écran', /🖥/.test(systeme || ''), systeme);
      /* RYTHME : les rangées ne doivent pas être deux fois plus espacées que les colonnes. Le seuil
         est large (1,8×) : on cherche le défaut de rythme, pas le pixel près. */
      v('la grille des formats a un rythme vertical régulier',
        m.ecartRangees !== null && m.ecartRangees < m.ecartColonnes * 1.5,
        'rangées ' + m.ecartRangees + ' px · colonnes ' + m.ecartColonnes + ' px');

      if (theme === 'light') {
        const lp = lum(m.fondPanneau);
        const sombres = m.fondCommandes.filter((c) => { const l = lum(c.f); return l !== null && lp !== null && l < lp - 0.25; });
        v('en mode clair, aucune commande ne reste sur un fond sombre',
          sombres.length === 0,
          sombres.map((c) => c.q + ' → ' + c.f).join(' | ') + ' (panneau ' + m.fondPanneau + ')');
      }
      await page.close();
    }
  } finally {
    if (nav) await nav.close();
    srv.close();
  }

  console.log(ko ? '\n✗ ' + ko + ' ÉCHEC(S)\n' : '\n✓ LE PANNEAU APPARENCE TIENT DANS LES DEUX THÈMES\n');
  process.exit(ko ? 1 : 0);
})();

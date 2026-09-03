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

console.log('\n── 3 bis. La vitrine annonce tout le terminal ──');
/* ⚠️ SEPT MODULES ANNONCÉS, DIX ONGLETS DANS LE PRODUIT (27/08). Le Calendrier, la Liste FX, la
   Semaine à Venir, les Taux et les Banques n'étaient nommés NULLE PART sur l'accueil — ni le
   Journal de Trading, ni la Calculatrice de position. Un visiteur ne pouvait pas savoir que la
   moitié du produit existe. Ce contrôle lit les onglets DANS LE DESK et exige que chacun soit
   nommé sur la vitrine : le jour où un onglet s'ajoute, c'est ici qu'on l'apprend. */
const DESK = fs.readFileSync(path.join(RACINE, 'public', 'index.html'), 'utf8');
/* ⚠️ LES ONGLETS PROPRES AU TÉLÉPHONE SONT EXCLUS. « MARCHÉS » porte `nav-item--mobile-only` : sur
   ordinateur ses panneaux vivent dans la colonne de droite, et cet onglet n'existe que pour les
   regrouper sur un petit écran. C'est de la navigation, pas un module — l'annoncer sur la vitrine
   promettrait une fonctionnalité qui n'en est pas une. Le contrôle l'a signalé comme « absent » et
   il avait raison de le voir ; c'est la LISTE qui devait être corrigée, pas la vitrine. */
const ONGLETS = [...DESK.matchAll(/<a[^>]*class="([^"]*)"[^>]*data-view="([a-z-]+)">\s*›?\s*([^<]+)</g)]
  .filter(m => !/mobile-only/.test(m[1]))
  .map(m => ({ vue: m[2], nom: m[3].trim() }));
v('les onglets du desk sont lisibles', ONGLETS.length >= 8, ONGLETS.length + ' onglet(s)');
/* Le nom de l'onglet est en capitales dans le desk ; la vitrine l'écrit normalement. On compare
   donc sans casse ni accents, et sur le mot le plus distinctif — « CALENDRIER » → « calendrier ». */
const _norm = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/* ⚠️ ON NE CHERCHE PAS DANS TOUTE LA PAGE, et la mutation l'a montré : renommer la carte « Semaine
   à Venir » en autre chose laissait le contrôle VERT, parce que le mot « semaine » survit ailleurs
   dans 180 Ko de HTML (« chaque semaine » sur la carte Radar de Biais). Un contrôle qui accepte
   n'importe quelle occurrence ne mesure pas la couverture, il mesure le vocabulaire. On se limite
   donc aux DEUX sections qui présentent les modules. */
const SECTIONS = [/<section class="blk" id="modules-cles"[\s\S]*?<\/section>/, /<section class="blk" id="modules-suite"[\s\S]*?<\/section>/]
  .map(rx => (rx.exec(IDX) || [''])[0]).join('\n');
v('les deux sections de modules sont lisibles', SECTIONS.length > 2000, SECTIONS.length + ' caractères');
/* ⚠️ ET ON NE REGARDE QUE LES TITRES DE MODULES, pas leur prose. Deuxième resserrement, deuxième
   mutation : renommer la carte « Semaine à Venir » laissait encore le contrôle vert, parce que
   « chaque semaine » figure dans la phrase de la carte Radar de Biais, à quelques lignes de là. Un
   module est annoncé quand il porte un TITRE, pas quand son nom traîne dans une phrase voisine. */
const TITRES = [...SECTIONS.matchAll(/<h3[^>]*>(?:<a[^>]*>)?([^<]{3,60})/g)].map(m => m[1].trim());
v('les titres de modules sont lisibles', TITRES.length >= 12, TITRES.length + ' titre(s)');
const idxN = _norm(TITRES.join(' | '));
/* ⚠️ ET ON COMPARE SUR LE RADICAL, PAS SUR LE MOT ENTIER. L'onglet « INSTITUTIONS » est présenté
   sous le titre « Recherche institutionnELLE » : chercher « institutions » n'y trouvait rien et
   accusait un module pourtant bien annoncé. Sept lettres suffisent à distinguer ces onglets entre
   eux (« calendr », « institu », « semaine »), et laissent passer les variations de forme. */
const _radical = m => m.slice(0, 7);
const absents = ONGLETS.filter(o => {
  const mot = _norm(o.nom).split(/\s+/).filter(w => w.length > 3)[0];
  return mot && idxN.indexOf(_radical(mot)) < 0;
}).map(o => o.nom);
v('chaque onglet du desk est nommé sur l\'accueil', !absents.length, 'absents : ' + absents.join(', '));
v('la section « le reste du terminal » existe', /id="modules-suite"/.test(IDX));
v('… avec ses cartes', (IDX.match(/class="mcard"/g) || []).length >= 6, (IDX.match(/class="mcard"/g) || []).length + ' carte(s)');
/* Le Journal et la Calculatrice sont des OUTILS, pas des onglets : ils échappent au relevé
   ci-dessus et méritent donc leur contrôle nommé. */
v('… le Journal de Trading y figure', /Journal de Trading/.test(IDX));
v('… et la Calculatrice de position', /Calculatrice de position/.test(IDX));

console.log('\n── 3 ter. Aucune traduction morte ──');
/* ⚠️ LE PIÈGE DU PROJET, ÉCRIT DANS CLAUDE.MD : le dictionnaire EN est clé par la CHAÎNE FRANÇAISE
   EXACTE. Une phrase publiée sans son entrée reste en français au milieu d'une page anglaise, et
   RIEN ne le signale. Mesuré à la pose de la section : sur ses huit titres, seul « Calendrier
   économique » ressortait traduit — il existait déjà — et les sept autres restaient en français. */
const I18N = fs.readFileSync(path.join(LAND, 'i18n.js'), 'utf8');
const dico = new Set([...I18N.matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*"/gm)].map(m => m[1]));
v('le dictionnaire EN est lisible', dico.size > 50, dico.size + ' entrée(s)');
/* On prend les textes de la section neuve — titres et phrases — et on exige leur traduction. */
const secN = (/<section class="blk" id="modules-suite"[\s\S]*?<\/section>/.exec(IDX) || [''])[0];
const textes = [...secN.matchAll(/<(?:h2 class="sec-t"|p class="sec-s"|h3|p)[^>]*>([^<]{4,200})</g)]
  .map(m => m[1].trim()).filter(t => !/^\s*$/.test(t));
v('la section porte bien des textes à traduire', textes.length >= 8, textes.length);
const orphelins = textes.filter(t => !dico.has(t));
v('chaque texte de la section a sa traduction EN', !orphelins.length, orphelins.slice(0, 3).join(' | '));

/* ══ 3 quater. LES MAQUETTES DE WIDGETS SUIVENT LE PRODUIT ═════════════════════════════════════
   POURQUOI CETTE SECTION EXISTE (02/09, constat utilisateur : « met à jour le site vitrine sur les
   widgets affichés, ils ne sont pas à jour »). Les cartes de l'accueil REDESSINENT le desk en HTML
   statique (classes .dk-*). C'est fidèle et c'est coûteux : chaque refonte du desk les périme une
   par une, en silence — aucun banc ne les reliait à quoi que ce soit. Trois dérives réelles avaient
   ainsi survécu des semaines : une pastille de Force des Devises à DEUX pavés (forme supprimée du
   produit le jour même), une matrice de Radar de Biais que l'onglet ne dessine plus du tout, et un
   pilier « Positionnement Hedge Funds » que le serveur ne calcule plus.
   LA MÉTHODE : on ne compare pas la maquette à une copie de règles écrite ici — on la compare à la
   SOURCE. Les piliers viennent de server.js, le vocabulaire des puces de app.js, les couleurs de
   charts.js. Le jour où le produit change, c'est la vitrine qui rougit. */
console.log('\n── 3 quinquies. Les CHIFFRES annoncés au Hero sont ceux du produit ──');
{
  /* ⚠️ POURQUOI CES CONTRÔLES EXISTENT (03/09). Le Hero portait CINQ ÉTOILES purement décoratives —
     aucun avis, aucun témoignage, aucune note nulle part sur ce site : vérifié. Cinq étoiles dorées
     à côté d'une phrase se lisent comme une NOTE, pas comme un ornement ; c'était de la preuve
     sociale inexistante, et le signal « SaaS générique » que la refonte cherche à fuir.
     Elles laissent place à trois faits comptés dans le produit. Mais un chiffre écrit en dur sur la
     vitrine dérive du produit exactement comme une liste recopiée dérive de sa source — c'est LA
     faute que ce dépôt répète le plus. On les compare donc au vrai desk à chaque livraison : le jour
     où un onglet ou un widget est ajouté, la vitrine ment, et ce banc le dit. */
  const IDXDESK = fs.readFileSync(path.join(RACINE, 'public', 'index.html'), 'utf8');
  const WJS = fs.readFileSync(path.join(RACINE, 'public', 'js', 'widgets.js'), 'utf8');

  v('les étoiles décoratives ne sont pas revenues', !/★/.test(IDX),
    'une note que personne n\'a donnée coûte plus en crédibilité qu\'elle ne rapporte');

  const onglets = (IDXDESK.match(/class="nav-item(?![^"]*mobile-only)/g) || []).length;
  const annonceOnglets = parseInt(((/<span><b>(\d+)<\/b> onglets<\/span>/.exec(IDX)) || [0, 0])[1], 10);
  v('le nombre d\'onglets annoncé est celui du desk',
    onglets > 0 && annonceOnglets === onglets,
    'vitrine : ' + annonceOnglets + '  ·  desk : ' + onglets + ' (hors onglet réservé au mobile)');

  const widgets = (WJS.match(/^\s+id: '[a-z0-9-]+', name: '/gm) || []).length;
  const annonceWidgets = parseInt(((/<span><b>(\d+)<\/b> blocs à composer<\/span>/.exec(IDX)) || [0, 0])[1], 10);
  v('le nombre de blocs annoncé est celui de la bibliothèque',
    widgets > 0 && annonceWidgets === widgets,
    'vitrine : ' + annonceWidgets + '  ·  bibliothèque : ' + widgets);

  /* La MOITIÉ QUI COMPTE AUTANT : ne pas se contenter d'annoncer moins que la réalité pour être
     tranquille. Sous-vendre un produit qu'on peut compter est aussi une forme d'imprécision. */
  v('[témoin] les deux chiffres sont bien LUS, pas devinés', annonceOnglets > 0 && annonceWidgets > 0);
}

console.log('\n── 3 quater. Les maquettes de widgets suivent le produit ──');
{
  const SERVEUR = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
  const APP = fs.readFileSync(path.join(RACINE, 'public', 'js', 'app.js'), 'utf8');
  const CHARTS = fs.readFileSync(path.join(RACINE, 'public', 'js', 'charts.js'), 'utf8');

  /* ── Force des Devises ────────────────────────────────────────────────────────────────────── */
  const cs2 = (/<div class="dk-cs2">[\s\S]*?\n<\/div>/.exec(IDX) || [''])[0];
  v('la maquette Force des Devises est repérable', cs2.length > 500, cs2.length + ' caractère(s)');
  /* LA DÉRIVE DU JOUR : le produit ne rend plus JAMAIS deux pavés accolés (code + valeur). Une
     pastille est un pavé unique — soit le code, soit la valeur quand le réglage est coché. */
  const pavesParPastille = [...cs2.matchAll(/<span class="dk-cs2-b"[\s\S]*?<\/span>\s*<\/span>/g)];
  v('chaque pastille ne porte qu\'UN pavé', !/dk-cs2-b"[^>]*>(?:(?!<\/span>).)*<b[^>]*>[A-Z]{3}<\/b>\s*<i/.test(cs2),
    'la forme « code + valeur accolés » a été retirée du produit');
  v('la pastille est une pastille, pas un rectangle vif (rayon 3px comme .cs-badge-ccy)',
    /\.dk-cs2-p\{[^}]*border-radius:3px/.test(IDX));
  /* Les huit teintes sont celles du produit, pas une copie qui dérive. */
  const csCol = {};
  const mCol = /const CS_COLORS\s*=\s*\{([\s\S]*?)\}/.exec(CHARTS);
  if (mCol) [...mCol[1].matchAll(/([A-Z]{3})\s*:\s*0x([0-9a-fA-F]{6})/g)].forEach(m => { csCol[m[1]] = '#' + m[2].toLowerCase(); });
  v('CS_COLORS est lisible dans charts.js', Object.keys(csCol).length === 8, Object.keys(csCol).join(' '));
  const manquantes = Object.entries(csCol).filter(([c, h]) => !new RegExp('background:' + h + ';color:[^"]*">' + c + '<').test(cs2));
  v('les huit pastilles portent EXACTEMENT la teinte de leur courbe',
    !manquantes.length, manquantes.map(x => x[0] + ' ≠ ' + x[1]).join(', '));
  /* La légende du widget existe dans le produit : la maquette doit la montrer. */
  /* ⚠️ CLASSE EXACTE, PAS UNE SOUS-CHAÎNE. Écrit d'abord en /dk-cs2-leg/, ce contrôle restait VERT
     quand on renommait la classe en « dk-cs2-leg-off » — le motif se retrouvait dans le nouveau nom.
     Un contrôle-témoin l'a montré ; sans lui il aurait dormi jusqu'au jour où il aurait compté. */
  v('la maquette porte la légende des huit devises',
    /class="dk-cs2-leg"/.test(cs2) && (cs2.match(/<i style="background:#/g) || []).length >= 8,
    'légende absente : la couleur d\'une courbe ne dit plus quelle devise elle porte');
  /* LE POINT DE LA DEMANDE DU 01-02/09 : l'étiquette est reliée au bout de sa courbe. */
  v('les étiquettes écartées portent leur filet de rappel', /dk-cs2-lnk/.test(cs2),
    'aucun filet : les pastilles flottent sans lien avec leur courbe');
  /* TÉMOIN NÉGATIF : l'ancienne rédaction devait, elle, faire rougir le contrôle des deux pavés. */
  const avantCs = '<span class="dk-cs2-b" style="top:10%"><b style="background:#ff5cae">NZD</b><i style="background:#ffaed6">+0.18</i></span>';
  v('[témoin] la maquette d\'avant serait bien refusée',
    /dk-cs2-b"[^>]*>(?:(?!<\/span>).)*<b[^>]*>[A-Z]{3}<\/b>\s*<i/.test(avantCs));

  /* ── Radar de Biais : les piliers viennent du SERVEUR ──────────────────────────────────────── */
  const bias = (/<div class="dk-bias-wrap">[\s\S]*?\n<\/div>/.exec(IDX) || [''])[0];
  v('la maquette Radar de Biais est repérable', bias.length > 500, bias.length + ' caractère(s)');
  /* Les rangées RÉELLEMENT servies par /api/smart-bias, lues dans server.js. */
  const mRows = /\/\/ Ordre : Fundamental[\s\S]*?const rows = \[([\s\S]*?)\n  \];/.exec(SERVEUR);
  const clesServeur = mRows ? [...mRows[1].matchAll(/key:\s*'([a-zA-Z]+)'/g)].map(m => m[1]) : [];
  v('les piliers servis par le serveur sont lisibles', clesServeur.length >= 3, clesServeur.join(', '));
  /* Leur libellé FRANÇAIS, lu dans app.js — jamais recopié ici. */
  const mFr = /const _rowFr = \{([^}]*)\}/.exec(APP);
  const rowFr = {};
  if (mFr) [...mFr[1].matchAll(/(\w+):\s*'([^']+)'/g)].forEach(m => { rowFr[m[1]] = m[2]; });
  v('les libellés français des piliers sont lisibles', Object.keys(rowFr).length >= 4, Object.keys(rowFr).length + ' libellé(s)');
  const attendus = clesServeur.map(k => rowFr[k]).filter(Boolean);
  const absentsBias = attendus.filter(l => !bias.includes(l));
  v('la synthèse annonce TOUS les piliers que le serveur calcule',
    !absentsBias.length, 'absent(s) de la vitrine : ' + absentsBias.join(', '));
  /* L'AUTRE MOITIÉ, CELLE QUI A MORDU : un pilier RETIRÉ du produit ne doit plus être annoncé. */
  const retires = Object.entries(rowFr).filter(([k]) => !clesServeur.includes(k)).map(([, l]) => l);
  const fantomes = retires.filter(l => bias.includes(l));
  v('… et AUCUN pilier que le serveur ne calcule plus',
    !fantomes.length, 'encore annoncé(s) alors que retiré(s) : ' + fantomes.join(', '));
  /* Le vocabulaire des puces vient de MT_LBL : une maquette qui invente ses mots ment sur le produit. */
  const mLbl = /const MT_LBL = \{([\s\S]*?)\n\};/.exec(APP);
  const motsProduit = new Set(mLbl ? [...mLbl[1].matchAll(/:\s*'((?:[^'\\]|\\.)+)'/g)].map(m => m[1].replace(/\\'/g, "'")) : []);
  const mBias = /const MT_BIAS_LBL = \{([^}]*)\}/.exec(APP);
  if (mBias) [...mBias[1].matchAll(/:\s*'([^']+)'/g)].forEach(m => motsProduit.add(m[1]));
  v('le vocabulaire du produit est lisible', motsProduit.size >= 10, motsProduit.size + ' terme(s)');
  const puces = [...bias.matchAll(/class="dk-bias-p[^"]*">([^<]+)</g)].map(m => m[1].trim());
  v('la maquette porte bien des puces', puces.length >= 8, puces.length + ' puce(s)');
  const inventes = [...new Set(puces)].filter(t => !motsProduit.has(t));
  v('chaque puce emploie un mot que le desk emploie vraiment',
    !inventes.length, 'introuvable(s) dans MT_LBL / MT_BIAS_LBL : ' + inventes.join(', '));
  /* Le desk range ses devises dans un ordre FIXE : la vitrine le suit. */
  const mOrdre = /const _MT_ORDRE = \[([^\]]*)\]/.exec(APP);
  const ordre = mOrdre ? [...mOrdre[1].matchAll(/'([A-Z]{3})'/g)].map(m => m[1]) : [];
  const ordreVitrine = [...bias.matchAll(/<b>([A-Z]{3})<\/b>/g)].map(m => m[1]);
  v('l\'ordre des devises est celui du desk (ordre de liquidité)',
    ordre.length === 8 && ordreVitrine.length >= 3
    && ordreVitrine.every((c, i) => ordre.indexOf(c) > (i ? ordre.indexOf(ordreVitrine[i - 1]) : -1)),
    'vitrine : ' + ordreVitrine.join(' ') + ' · desk : ' + ordre.join(' '));

  /* ── Fil d'actualités : le repli statique rend ce que rend la version live ─────────────────── */
  const fil = (/<div class="dk-news-feed">[\s\S]*?\n<\/div>/.exec(IDX) || [''])[0];
  const lignes = [...fil.matchAll(/<div class="dk-news-meta">([\s\S]*?)<\/div>/g)]
    .map(m => (m[1].match(/dk-news-tag/g) || []).length);
  v('le repli du fil porte bien des lignes', lignes.length >= 4, lignes.length + ' ligne(s)');
  v('aucune ligne ne porte plus de deux étiquettes (le rendu live en pose deux au plus)',
    lignes.every(n => n <= 2), 'étiquettes par ligne : ' + lignes.join(' '));
}

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

      /* ⚠️ LE PIED SE MESURE SUR L'ACCUEIL, PAS SUR UNE PAGE DE DOCUMENTATION. Le premier jet de ces
         contrôles tournait sur `mentions-legales.html`, chargée juste au-dessus : les pages de doc
         n'ont pas ce pied, `.foot-grid` y valait null, et le contrôle sortait rouge sur un pied
         parfaitement correct. Le banc a signalé mon erreur de mesure, pas un défaut du site. */
      await page.goto('http://localhost:4847/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });

      /* ── LE PIED DE PAGE : 35 LIENS SUR 5 COLONNES, RAMENÉS À 14 SUR 4 (27/08) ────────────────
         ⚠️ LE PIÈGE ÉTAIT DANS LA GRILLE, PAS DANS LES LIENS. En les retirant sans reprendre
         `grid-template-columns`, les deux colonnes devenues vides gardaient leur part de largeur :
         le pied restait aussi étalé qu'avant, moitié en blanc. On MESURE donc la grille peinte, et
         on exige qu'aucun bloc ne soit vide — un contrôle qui compterait les liens serait passé au
         vert sur un pied toujours aussi large. */
      const pied = await page.evaluate(() => {
        const f = document.querySelector('footer .foot-grid');
        if (!f) return null;
        const cs = getComputedStyle(f);
        return {
          colonnes: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
          blocs: f.children.length,
          vides: [...f.children].filter(c => !c.textContent.trim()).length,
          liens: document.querySelectorAll('footer a').length,
          largeur: +f.getBoundingClientRect().width.toFixed(0),
          risque: !!document.querySelector('footer .risk'),
        };
      });
      v('le pied de page est lisible', !!pied);
      if (pied) {
        v('… il tient sur quatre colonnes, pas cinq', pied.colonnes === 4, pied.colonnes + ' colonne(s)');
        v('… autant de blocs que de colonnes (aucune colonne fantôme)', pied.blocs === pied.colonnes && pied.vides === 0,
          pied.blocs + ' bloc(s), ' + pied.vides + ' vide(s)');
        v('… et une quinzaine de liens, plus trente-cinq', pied.liens <= 16 && pied.liens >= 10, pied.liens + ' lien(s)');
        v('… sa largeur est bornée', pied.largeur <= 1040, pied.largeur + ' px');
        /* L'AVERTISSEMENT DE RISQUE NE SE COUPE PAS. Il n'est pas décoratif : un service qui publie
           de l'analyse de marché doit dire qu'il ne conseille pas. « Réduire » ne le vise jamais. */
        v('… l\'avertissement de risque est toujours là', pied.risque);
      }
      /* Et les quatre pages légales restent atteignables DEPUIS L'ACCUEIL : les enfouir dans la
         documentation aurait été une façon discrète de les faire disparaître. */
      for (const [nom, href] of [['avertissement de risque', 'avertissement-risque'], ['conditions générales', 'conditions-generales'],
                                 ['confidentialité', 'politique-confidentialite'], ['mentions légales', 'mentions-legales']]) {
        v('… le lien « ' + nom + ' » subsiste', new RegExp('documentation/' + href + '\\.html').test(IDX));
      }
    } finally { await nav.close(); srv.close(); }
  }
  console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
  process.exit(ko ? 1 : 0);
})();

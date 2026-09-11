#!/usr/bin/env node
/**
 * scripts/onglets-verif.js — DÉPLACER UN ONGLET SANS RIEN DÉSALIGNER.
 *
 * POURQUOI. Un panneau à onglets tient sur SIX structures indexées POSITIONNELLEMENT, sans aucune
 * clé stable : `tabs` (les widgets), `tabLabels` (les noms), `tabIcons` (les icônes), `tabGrid`
 * (les dispositions composites), les clés de `tabCfg` (« 3 », « 3-1 » : les réglages) et `_tabAct`
 * (l'onglet affiché). Déplacer un onglet en n'en réindexant que cinq ne casse RIEN de visible tout
 * de suite : le nom, l'icône ou les réglages glissent simplement sur l'onglet voisin. On s'en rend
 * compte trois jours plus tard, sans savoir quel geste l'a produit.
 *
 * Le même piège a déjà mordu : `removeTab` réindexait `tabs`, `tabLabels`, `tabGrid` et `tabCfg`
 * mais PAS `tabIcons` — retirer un onglet décalait donc l'icône de tous les suivants, en silence.
 * Le défaut est corrigé, et rejoué ici pour qu'il ne revienne pas.
 *
 * On extrait le VRAI `_reordonnerOnglets` de public/js/widgets.js — pas une copie — pour que le
 * contrôle suive le code plutôt qu'une transcription qui dériverait.
 *
 *   node scripts/onglets-verif.js
 */
const fs = require('fs');
const http = require('http');
const PORT_DESK = 4794;   // phase 9 : le vrai desk servi en local
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
let ko = 0, ok = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const DEB = SRC.indexOf('  function _reordonnerOnglets(it, from, to) {');
if (DEB < 0) { console.log('\n  ✗ _reordonnerOnglets introuvable dans widgets.js\n'); process.exit(1); }
const FIN = SRC.indexOf('\n  }\n', DEB);
const bouger = new Function(SRC.slice(DEB, FIN + 4) + '\nreturn _reordonnerOnglets;')();

// Un panneau complet : sept onglets, chacun avec son nom, son icône, une disposition composite en
// 3e position, et des réglages posés sur trois onglets dont une CASE d'onglet composite.
const panneau = () => ({
  tabs:      ['risque', 'force', 'grille', 'cot', 'dmx', 'saison', 'monde'],
  tabLabels: ['RISQUE', 'FORCE', 'BAROMÈTRE', 'COT', 'DMX', 'SAISONNALITÉ', 'MONDE'],
  tabIcons:  ['jauge', 'balance', 'grille', 'cot', 'dmx', 'calendrier', 'globe'],
  tabGrid:   ['', '', '2x2|a,b,c,d', '', '', '', ''],
  tabCfg:    { '0': { p: 'risque' }, '2-1': { p: 'case' }, '6': { p: 'monde' } },
  _tabAct: 2,
});
// Ce que porte l'onglet à la position j — les six structures lues ensemble.
const contenu = (it, j) => JSON.stringify([it.tabs[j], it.tabLabels[j], it.tabIcons[j], it.tabGrid[j],
  it.tabCfg[String(j)] || null, it.tabCfg[j + '-1'] || null]);

/* ══ LA PALETTE D'ICÔNES D'ONGLET ════════════════════════════════════════════════════════════════
   02/09, demande utilisateur : « améliore les icônes, augmente légèrement leur visibilité, on voit
   pas très bien l'icône, et mets-en plus, cohérent avec le desk et en fonction des widgets ».
   ⚠️ LA VISIBILITÉ ÉTAIT UNE QUESTION DE TAILLE, PAS DE CONTRASTE — et c'est mesuré, pas supposé :
   l'encre au repos (#9a9aa4) sur le fond de la palette (#16171b) donne un rapport de 6,42:1, très
   au-dessus du seuil de 3:1 attendu d'une icône. Le défaut venait des 13 px : un trait de 1,7 px
   sur un dessin de 13 px ne laisse pas assez de matière pour reconnaître une forme. On corrige donc
   ce qui était en cause (15 px, trait 1,8) au lieu d'éclaircir une couleur qui allait bien.
   ⚠️ CE QUI CASSE VRAIMENT UNE PALETTE : un slug listé dans l'ORDRE sans icône en face. Le bouton
   se rend alors VIDE et cliquable — il pose une icône invisible sur l'onglet, et personne ne
   comprend pourquoi. Le contrôle croise donc les deux listes dans les deux sens. */
console.log('\n── 0. La palette d\'icônes d\'onglet ──');
{
  const d = SRC.indexOf('var _TAB_ICONS = {'), f = SRC.indexOf('};', d) + 2;
  const o1 = SRC.indexOf('var _TAB_ICON_ORDER'), o2 = SRC.indexOf('];', o1) + 2;
  v('le catalogue d\'icônes est extractible de widgets.js', d >= 0 && f > d && o1 > 0 && o2 > o1);
  let ICONS = null, ORDER = null;
  try {
    ICONS = eval('(' + SRC.slice(d + 'var _TAB_ICONS = '.length, f - 1) + ')');
    ORDER = eval('(' + SRC.slice(o1 + 'var _TAB_ICON_ORDER = '.length, o2 - 1) + ')');
  } catch (e) { v('… et il s\'évalue', false, e.message); }
  if (ICONS && ORDER) {
    v('… et il s\'évalue', true);
    const sansIcone = ORDER.filter(x => !ICONS[x]);
    v('chaque entrée de la palette a bien son icône (sinon : bouton vide et onglet muet)',
      sansIcone.length === 0, JSON.stringify(sansIcone));
    const horsPalette = Object.keys(ICONS).filter(x => !ORDER.includes(x));
    v('… et aucune icône n\'est définie sans être proposée', horsPalette.length === 0, JSON.stringify(horsPalette));
    const doublons = ORDER.filter((x, i) => ORDER.indexOf(x) !== i);
    v('… ni proposée deux fois', doublons.length === 0, JSON.stringify(doublons));
    /* Le choix s'est ÉTOFFÉ : la demande portait aussi sur le nombre, pour couvrir les familles de
       widgets du desk (baromètre, COT, saisonnalité, squawk, notes, recherche…). */
    v('la palette couvre au moins 30 icônes', ORDER.length >= 30, ORDER.length + ' icône(s)');
    /* Les familles nommées dans la demande doivent exister, sinon « plus de choix » ne veut rien
       dire : ce sont ces widgets-là qui n'avaient pas d'icône à leur ressembler. */
    ['egaliseur', 'donut', 'balance', 'sablier', 'cycle', 'onde', 'chat', 'note', 'loupe', 'carte']
      .forEach(sl => v('… dont « ' + sl +' »', !!ICONS[sl]));
    /* LA TAILLE, sur le dessin lui-même : c'est elle qui était en cause. */
    const petites = Object.entries(ICONS).filter(([, svg]) => /width="13"|width=.13./.test(svg)).map(([k]) => k);
    v('plus aucune icône ne reste dessinée en 13 px', petites.length === 0, JSON.stringify(petites));
    const bonnes = Object.values(ICONS).filter(svg => /width="15" height="15"/.test(svg)).length;
    v('… elles sont toutes en 15 px', bonnes === Object.keys(ICONS).length, bonnes + '/' + Object.keys(ICONS).length);
  }
}

console.log('\n── 1. Tout ce que porte un onglet le suit ──');
{
  const av = panneau(), avant = av.tabs.map((_, j) => contenu(av, j));
  const ap = panneau();
  v('un déplacement valide est accepté', bouger(ap, 0, 2) === true);
  v('l\'ordre des onglets est le bon', ap.tabs.join(',') === 'force,grille,risque,cot,dmx,saison,monde', ap.tabs.join(','));
  v('le nom suit son onglet', contenu(ap, 2) === avant[0], contenu(ap, 2) + ' ≠ ' + avant[0]);
  v('l\'icône aussi', ap.tabIcons.join(',') === 'balance,grille,jauge,cot,dmx,calendrier,globe', ap.tabIcons.join(','));
  v('la disposition composite aussi', ap.tabGrid[1] === '2x2|a,b,c,d' && ap.tabGrid[2] === '', ap.tabGrid.join('|'));
  v('les réglages de l\'onglet aussi', JSON.stringify(ap.tabCfg['2']) === '{"p":"risque"}', JSON.stringify(ap.tabCfg));
  v('les réglages d\'une CASE d\'onglet composite aussi', JSON.stringify(ap.tabCfg['1-1']) === '{"p":"case"}', JSON.stringify(ap.tabCfg));
  v('aucun onglet n\'a perdu son contenu', ap.tabs.map((_, j) => contenu(ap, j)).sort().join('§') === avant.slice().sort().join('§'));
  v('rien n\'est dupliqué ni perdu', new Set(ap.tabs).size === new Set(av.tabs).size && ap.tabs.length === 7);
}

console.log('\n── 2. L\'onglet AFFICHÉ suit son contenu, jamais sa position ──');
{
  const a = panneau(); bouger(a, 0, 2);
  v('l\'onglet regardé était le 3e, il est maintenant le 2e', a._tabAct === 1, String(a._tabAct));
  const b = panneau(); bouger(b, 2, 5);
  v('déplacer l\'onglet regardé le suit', b._tabAct === 5 && b.tabs[5] === 'grille', b._tabAct + '/' + b.tabs[5]);
  const c = panneau(); bouger(c, 5, 6);
  v('un déplacement qui ne le concerne pas ne le bouge pas', c._tabAct === 2 && c.tabs[2] === 'grille');
}

console.log('\n── 3. Un déplacement impossible ne touche à rien ──');
{
  const base = JSON.stringify(panneau());
  [['sur place', 3, 3], ['avant le premier', 0, -1], ['après le dernier', 6, 7],
   ['depuis un index inexistant', 9, 0], ['depuis un index négatif', -1, 2]].forEach(([nom, f, t]) => {
    const it = panneau();
    const r = bouger(it, f, t);
    v(`« ${nom} » est refusé`, r === false, 'a rendu ' + r);
    v(`« ${nom} » laisse le panneau intact`, JSON.stringify(it) === base);
  });
  v('un objet sans onglets est refusé', bouger({}, 0, 1) === false);
  v('un objet nul est refusé', bouger(null, 0, 1) === false);
}

console.log('\n── 4. Les tableaux incomplets ne corrompent rien ──');
/* `tabLabels` / `tabIcons` / `tabGrid` sont plus COURTS que `tabs` dès qu'on ajoute un onglet :
   l'ajout n'écrit que `tabs`, tout le reste se lit ailleurs en `arr[j] || ''`. Réindexer sans
   combler les trous poserait des `undefined` — un nom d'onglet affiché « undefined » se voit. */
{
  const it = { tabs: ['a', 'b', 'c'], tabLabels: ['A'], tabIcons: [], _tabAct: 0 };
  v('le déplacement passe', bouger(it, 0, 2) === true);
  v('les trous sont comblés, pas propagés', it.tabLabels.join(',') === ',,A' && it.tabLabels.length === 3, JSON.stringify(it.tabLabels));
  v('aucun undefined dans les noms', it.tabLabels.every(x => typeof x === 'string'), JSON.stringify(it.tabLabels));
  v('aucun undefined dans les icônes', it.tabIcons.every(x => typeof x === 'string') && it.tabIcons.length === 3, JSON.stringify(it.tabIcons));
  v('les onglets, eux, sont intacts', it.tabs.join(',') === 'b,c,a', it.tabs.join(','));
  const sansCfg = { tabs: ['a', 'b'] };
  v('un panneau minimal ne casse pas', bouger(sansCfg, 0, 1) === true && sansCfg.tabs.join(',') === 'b,a');
}

console.log('\n── 5. Les réglages inconnus sont conservés, pas jetés ──');
{
  const it = panneau(); it.tabCfg['zz'] = { garde: 1 };
  bouger(it, 1, 4);
  v('une clé hors format survit au déplacement', JSON.stringify(it.tabCfg['zz']) === '{"garde":1}', JSON.stringify(it.tabCfg));
}

console.log('\n── 6. Le geste est branché des DEUX côtés ──');
/* « que ça se mette à jour dans le panneau à onglet quand on déplace » : le volet de réglages ET la
   barre d'onglets de la carte. Sans le second, deux vérités s'affichent en même temps. */
v('une poignée est posée sur chaque ligne', /class="wdg-set-tabgrip" data-j="/.test(SRC));
v('elle est absente quand il n\'y a qu\'un onglet', /var _grip = tl\.length > 1/.test(SRC));
v('les flèches ↑ ↓ déplacent au clavier', /event\.key===\\'ArrowUp\\'\|\|event\.key===\\'ArrowDown\\'/.test(SRC));
v('le volet est re-rendu', /moveTab: function[\s\S]{0,700}?_syncPanel\(i\);/.test(SRC));
v('LA CARTE aussi (la barre d\'onglets suit)', /moveTab: function[\s\S]{0,700}?API\.refresh\(i\);/.test(SRC));
v('le focus reste sur la poignée déplacée', /moveTab: function[\s\S]{0,1200}?wdg-set-tabgrip\[data-j="/.test(SRC));
v('le déplacement est câblé sur le VOLET, pas sur la liste', /function _wireTabsDnD\(pop, i\) \{\s*_glisserPourReordonner\(pop, /.test(SRC));
// Le drapeau vit désormais dans la mécanique commune, qui sert AUSSI le gestionnaire de desks : un
// écouteur empilé par re-rendu déplacerait l'onglet deux fois d'un seul geste.
v('câblé une seule fois par hôte', /if \(!hote \|\| hote\._reordWired\) return; hote\._reordWired = true;/.test(SRC));
/* Les trois pièces sans lesquelles le doigt ne fonctionne pas — chacune a coûté une panne :
   la capture (le doigt quitte la poignée dès le premier pixel), le seuil (un appui n'est pas un
   glissement), et la lecture de ce qu'il y a SOUS le doigt (avec la capture, `e.target` reste la
   poignée, quelle que soit la ligne visée). */
v('le geste est capturé sur la poignée', /g\.setPointerCapture\(e\.pointerId\)/.test(SRC));
v('un seuil distingue l\'appui du glissement', /Math\.abs\(e\.clientY - y0\) < 4/.test(SRC));
v('la ligne visée est lue sous le pointeur', /document\.elementFromPoint\(x, y\)/.test(SRC));
v('re-câblé à chaque ouverture (la carte est reconstruite)', /if \(willOpen && kind === 's' && target\) _wireTabsDnD\(target, idx\);/.test(SRC));
v('le décalage d\'un cran est corrigé au dépôt', /if \(from < cible\) cible--;/.test(SRC));
v('les repères de dépôt reprennent ceux du gestionnaire de desks', /\.wdg-set-tabrow\.wdg-drop-before/.test(fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8')));

console.log('\n── 6bis. L\'ONGLET PORTE LE NOM DU WIDGET, PAS SON SIGLE ──');
/* 03/09, capture : un onglet « MONDE » au-dessus d'un panneau intitulé « SESSIONS DE MARCHÉ ». Le
   libellé par défaut retombait sur `w.tag` — un code court fait pour les VIGNETTES de disposition —
   avant `w.name`.
   CE QUI REND LE DÉFAUT SÉRIEUX N'EST PAS LA DIVERGENCE, C'EST LA COLLISION : plusieurs widgets
   PARTAGENT un tag. Cinq portent « VOLATILITÉ », trois « FX », deux « TAUX ». Deux onglets voisins
   pouvaient donc s'appeler pareil — un onglet qui ne dit pas ce qu'il ouvre n'est plus un onglet.
   On mesure les deux : le libellé suit le nom, et deux widgets à tag commun se distinguent. */
{
  const nom = id => { const k = SRC.indexOf("id: '" + id + "'"); if (k < 0) return null;
    const m = /name: (?:'([^']+)'|"([^"]+)")/.exec(SRC.slice(k, k + 400)); return m ? (m[1] || m[2]) : null; };
  const tag = id => { const k = SRC.indexOf("id: '" + id + "'"); if (k < 0) return null;
    const m = /tag: '([^']*)'/.exec(SRC.slice(k, k + 200)); return m ? m[1] : ''; };
  v('le catalogue porte bien des sigles qui diffèrent du nom (sinon ce contrôle serait vide)',
    tag('sessions') === 'MONDE' && nom('sessions') === 'Sessions de marché',
    'tag=' + tag('sessions') + ' nom=' + nom('sessions'));
  /* Le repli est lu dans la SOURCE : c'est un défaut de choix de champ, pas de calcul — il n'y a
     pas de fonction à extraire, seulement une expression, et c'est elle qu'on éprouve. */
  const replis = SRC.match(/\.tag \|\| \w+\.name/g) || [];
  v('aucun libellé d\'onglet ne retombe plus sur le sigle', replis.length === 0,
    replis.length + ' repli(s) « tag || name » subsistant(s)');
  const parNom = ['var defLbl = estGrille', 'var lbl = labels[i] ||', 'var def0 = w0 ?', 'var def = w2 ?'];
  v('les QUATRE points qui nomment un onglet lisent le nom du widget',
    parNom.every(m => { const k = SRC.indexOf(m); return k > 0 && /\bw\d?\.name\b/.test(SRC.slice(k, k + 160)); }),
    parNom.filter(m => { const k = SRC.indexOf(m); return !(k > 0 && /\bw\d?\.name\b/.test(SRC.slice(k, k + 160))); }).join(' | '));
  /* La collision, sur des widgets réels du catalogue. */
  const memesTag = ['vol-horaire', 'amplitude-seance', 'stats-volatilite'];
  v('trois widgets au tag « VOLATILITÉ » portent bien trois NOMS distincts',
    new Set(memesTag.map(nom)).size === 3 && new Set(memesTag.map(tag)).size === 1,
    memesTag.map(i => tag(i) + '→' + nom(i)).join(' | '));
  /* Le sigle garde sa place là où il a un sens : la vignette de disposition, trop petite pour un nom. */
  v('… mais le sigle reste employé par la vignette de disposition',
    /_ABBR\[it && it\.w\] \|\| \(def && def\.tag\)/.test(SRC));
}

console.log('\n── 7. Le défaut voisin, corrigé au passage ──');
/* `removeTab` réindexait tabs, tabLabels, tabGrid et tabCfg — mais PAS tabIcons. Retirer le 2e
   onglet décalait donc l'icône de tous les suivants d'un cran, sans erreur ni trace. */
v('retirer un onglet retire AUSSI son icône', /if \(Array\.isArray\(it\.tabIcons\)\) it\.tabIcons\.splice\(j, 1\);/.test(SRC));
v('l\'annulation restaure les icônes', /if \(snap\.tabIcons\) itRef\.tabIcons = snap\.tabIcons\.slice\(\); else delete itRef\.tabIcons;/.test(SRC));
v('le snapshot les emporte', /tabIcons: it\.tabIcons \|\| null,/.test(SRC));

/* ── PHASE NAVIGATEUR : LE GESTE, AU DOIGT ET À LA SOURIS ───────────────────────────────────────
   Tout ce qui précède prouve le CALCUL. Rien n'y prouve que le geste arrive jusqu'à lui.

   ⚠️ ET LA VERSION PRÉCÉDENTE DE CETTE PHASE NE LE PROUVAIT PAS NON PLUS. Elle ouvrait bien un vrai
   Chromium, mais elle FABRIQUAIT les événements : `new DragEvent('dragstart', …)` puis
   `dispatchEvent`. Un événement fabriqué arrive toujours — que le navigateur l'émette ou non. Elle
   validait donc le câblage tout en restant aveugle à la seule chose qui comptait : sur un écran
   TACTILE, un doigt posé sur un élément `draggable` ne produit JAMAIS `dragstart`, et le
   réordonnancement des onglets était mort sur téléphone. Mesuré : zéro déplacement au doigt, un à
   la souris, pour exactement le même geste.

   Cette phase conduit donc de VRAIES entrées — `page.touchscreen` d'un côté, `page.mouse` de
   l'autre — sur le VRAI câblage extrait de widgets.js. Ce qu'elle mesure ne peut plus être vrai
   « en théorie » : si le doigt ne déplace rien, elle le dit.
   Sans navigateur disponible, elle s'abstient — elle ne rend jamais un poste inutilisable. */
// Repéré par son NOM, pas par sa signature : ajouter un paramètre à la mécanique commune ne doit
// pas faire échouer le contrôle qui l'éprouve (arrivé le 29/08 avec l'option d'appui long).
const D2 = SRC.indexOf('  function _glisserPourReordonner(');
const D3 = SRC.indexOf('  function _wireTabsDnD(pop, i) {');
const bloc = (d) => { const f = SRC.indexOf('\n  }\n', d); return SRC.slice(d, f + 4); };
const CABLAGE = (D2 < 0 || D3 < 0) ? '' : bloc(D2) + '\n' + bloc(D3);
const LIGNES = /return '<div class="wdg-set-row wdg-set-tabrow" data-j="' \+ j \+ '">/.test(SRC);

(async () => {
  console.log('\n── 8. Le geste, dans un vrai Chromium : au doigt ET à la souris ──');
  v('la ligne d\'onglet porte son index', LIGNES);
  v('la mécanique de déplacement est extractible', !!CABLAGE, 'fonctions introuvables dans widgets.js');

  /* ══ LE BORD PRÉCÉDENT DEPUIS UNE BUTÉE FRACTIONNAIRE (30/08, attrapé par la garde de
     déploiement sur Chrome 151) : sous le zoom 90 % du desk, les Chrome récents rendent un
     scrollLeft FRACTIONNAIRE (531,11 à la butée) quand scrollWidth/clientWidth restent entiers
     (max = 530). L'ancienne recherche « < cur − 1 » trouvait le bord clampé à 530 — un fantôme à
     0,11 px — et la molette ne revenait PLUS JAMAIS en arrière. Épinglé ici sur la VRAIE fonction
     extraite, avec les chiffres exacts du diagnostic : le contrôle vaut sur tout navigateur, même
     celui qui ne fractionne pas. */
  {
    const dB = SRC.indexOf('var _bordSuivant = function (sens) {');
    const fB = SRC.indexOf('\n          };', dB);
    v('le calcul du bord visé est extractible', dB > 0 && fB > dB);
    if (dB > 0 && fB > dB) {
      const faireBar = (sl) => ({
        scrollWidth: 794, clientWidth: 264, scrollLeft: sl,
        querySelectorAll: () => [4, 71, 169, 244, 351, 445, 501, 626, 684, 766].map(x => ({ offsetLeft: x })),
      });
      const F = new Function('bar', 'getComputedStyle',
        SRC.slice(dB, fB + 13) + '\nreturn _bordSuivant;');
      const gcs = () => ({ paddingLeft: '4px' });
      const arriere = F(faireBar(531.1111450195312), gcs)(-1);
      v('depuis la butée FRACTIONNAIRE, la molette vise le vrai onglet précédent',
        arriere === 501, 'visé : ' + arriere + ' (le fantôme clampé vaut 530, le vrai bord 501)');
      const arriereEntier = F(faireBar(530), gcs)(-1);
      v('… et depuis la butée entière, le même (aucune régression des Chrome plus vieux)',
        arriereEntier === 501, 'visé : ' + arriereEntier);
      const avant = F(faireBar(4.44444465637207), gcs)(1);
      v('… et l\'aller depuis un début fractionnaire avance d\'un onglet, pas de zéro',
        avant === 71, 'visé : ' + avant);
    }
  }
  /* ⚠️ LA POIGNÉE NE DOIT PLUS ÊTRE `draggable`. Le glisser-déposer natif n'existe pas au doigt, et
     sur les autres appareils il VOLE le geste au pointeur : dès qu'un drag natif démarre, Chrome
     cesse d'émettre `pointermove`. Les deux mécanismes ne peuvent pas cohabiter sur le même objet. */
  v('la poignée d\'onglet n\'est plus en glisser natif', !/class="wdg-set-tabgrip" draggable="true"/.test(SRC),
    'un `draggable` sur la poignée vole le geste au pointeur');
  /* LE SÉLECTEUR DU CODE DOIT NOMMER LA CLASSE QUE LE RENDU ÉMET. Défaut trouvé le 29/08 : le
     gestionnaire de desks cherchait `.wdg-mgr-row` quand le rendu produit `.wdg-mgr-card` — la
     classe avait été renommée sans que le glisser suive, et cette liste ne se réordonnait plus DU
     TOUT, ni au doigt ni à la souris. Invisible à la lecture : deux noms plausibles, dans deux
     fichiers. On vérifie donc que les deux listes se réordonnent sur une classe RÉELLEMENT rendue. */
  [['.wdg-set-tabrow', 'wdg-set-row wdg-set-tabrow', 'des onglets'],
   ['.wdg-mgr-card', 'wdg-mgr-card', 'des desks']].forEach(([sel, rendu, quoi]) => {
    const cite = SRC.indexOf("'" + sel + "'") >= 0;
    const emis = SRC.indexOf('class="' + rendu) >= 0 || SRC.indexOf("class=\"" + rendu) >= 0;
    v('le déplacement ' + quoi + ' vise une classe réellement rendue', cite && emis,
      'cité: ' + cite + ' · rendu: ' + emis);
  });

  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { console.log('  · puppeteer-core absent → phase navigateur abstenue.'); return fin(); }
  const bin = (() => {
    const bases = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
    const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    for (const b of bases) {
      try { for (const d of fs.readdirSync(b)) for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, rel)); } catch {}
    }
    return c.find(x => x && fs.existsSync(x)) || null;
  })();
  if (!bin) { console.log('  · aucun Chromium trouvé → phase navigateur abstenue.'); return fin(); }
  if (!CABLAGE) return fin();

  let nav;
  try {
    nav = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    /* Le volet, tel que `_setPanelHtml` le rend : des lignes .wdg-set-tabrow[data-j] avec leur
       poignée. Les hauteurs sont posées ici pour que les cibles soient calculables. */
    const poser = async (tactile) => {
      const page = await nav.newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: tactile, hasTouch: tactile, deviceScaleFactor: tactile ? 3 : 1 });
      await page.setContent('<style>body{margin:0}.wdg-set-tabrow{height:44px;display:flex;align-items:center}'
        + '.wdg-set-tabgrip{width:32px;height:32px;touch-action:none}</style><div id="pop"></div>');
      await page.evaluate((cablage, n) => {
        window.__appels = [];
        const pop = document.getElementById('pop');
        let h = '';
        for (let j = 0; j < n; j++) {
          h += '<div class="wdg-set-row wdg-set-tabrow" data-j="' + j + '">'
            + '<button type="button" class="wdg-set-tabgrip" data-j="' + j + '">x</button>'
            + '<input value="onglet ' + j + '"></div>';
        }
        pop.innerHTML = h;
        const API = { moveTab: (i, from, to) => window.__appels.push([i, from, to]) };
        eval(cablage + '; _wireTabsDnD(pop, 7);');
      }, CABLAGE, 7);
      return page;
    };
    // Cible : le centre de la poignée de la ligne `de`, et un point dans la ligne `vers`
    // (moitié haute ou basse, ce qui décide du côté du dépôt).
    const cibles = (page, de, vers, bas) => page.evaluate((de, vers, bas) => {
      const L = document.querySelectorAll('.wdg-set-tabrow');
      const g = L[de].querySelector('.wdg-set-tabgrip').getBoundingClientRect();
      const c = L[vers].getBoundingClientRect();
      return { gx: g.x + g.width / 2, gy: g.y + g.height / 2, cy: c.y + c.height * (bas ? 0.8 : 0.2) };
    }, de, vers, bas);
    /* ⚠️ AU DOIGT, ON MAINTIENT AVANT DE GLISSER — et ce n'est pas une commodité de test, c'est le
       geste réel. Les poignées forment une colonne quasi continue sur le bord gauche du volet
       (37 px de large sur 77 % de la hauteur de la liste) : sans appui long, un pouce qui descend ce
       bord pour FAIRE DÉFILER réordonnait un onglet à la place. Le glissement immédiat reste celui
       de la souris, où l'on ne pose pas le curseur sur une poignée par hasard. */
    const glisser = async (page, tactile, b, pas, tenir) => {
      const N = pas == null ? 14 : pas;
      if (tactile) {
        await page.touchscreen.touchStart(b.gx, b.gy);
        if (tenir !== 0) await new Promise(r => setTimeout(r, tenir == null ? 700 : tenir));
        for (let k = 1; k <= N; k++) await page.touchscreen.touchMove(b.gx, b.gy + (b.cy - b.gy) * k / N);
        await page.touchscreen.touchEnd();
      } else {
        await page.mouse.move(b.gx, b.gy); await page.mouse.down();
        for (let k = 1; k <= N; k++) await page.mouse.move(b.gx, b.gy + (b.cy - b.gy) * k / N);
        await page.mouse.up();
      }
      await new Promise(r => setTimeout(r, 120));
    };
    const lire = (page) => page.evaluate(() => ({
      appels: window.__appels.slice(),
      restes: document.querySelectorAll('.wdg-drop-before,.wdg-drop-after,.wdg-reord-src').length,
    }));

    for (const tactile of [true, false]) {
      const quoi = tactile ? 'au doigt' : 'à la souris';
      console.log('  · ' + (tactile ? 'écran tactile 390×844' : 'souris'));
      const page = await poser(tactile);

      // LE GESTE DE LA DEMANDE : remonter le DERNIER onglet (« MONDE ») vers le haut de la liste.
      await glisser(page, tactile, await cibles(page, 6, 1, false));
      let r = await lire(page);
      v('remonter le dernier onglet vers le haut, ' + quoi, JSON.stringify(r.appels) === '[[7,6,1]]', JSON.stringify(r.appels));
      v('aucun repère ne reste affiché après le dépôt, ' + quoi, r.restes === 0, String(r.restes));

      // Vers le BAS, et sur la moitié basse d'une ligne → il se place APRÈS elle.
      await page.evaluate(() => { window.__appels.length = 0; });
      await glisser(page, tactile, await cibles(page, 0, 3, true));
      r = await lire(page);
      v('descendre un onglet sous la 4e ligne, ' + quoi, JSON.stringify(r.appels) === '[[7,0,3]]', JSON.stringify(r.appels));

      /* UN APPUI N'EST PAS UN GLISSEMENT. Sans seuil, poser le doigt sur la poignée déplacerait
         l'onglet au moindre tremblement — et le simple appui doit rester disponible : c'est lui qui
         donne le focus à la poignée, donc les flèches ↑ ↓ au clavier. */
      await page.evaluate(() => { window.__appels.length = 0; });
      const b0 = await cibles(page, 4, 4, false);
      await glisser(page, tactile, { gx: b0.gx, gy: b0.gy, cy: b0.gy + 2 }, 2);
      r = await lire(page);
      v('un simple appui ne déplace rien, ' + quoi, r.appels.length === 0, JSON.stringify(r.appels));

      /* LE GESTE QUI CASSAIT TOUT : descendre le pouce sur la colonne des poignées pour faire
         DÉFILER la liste. Sans appui long, il réordonnait. Il ne doit plus rien déplacer. */
      if (tactile) {
        await page.evaluate(() => { window.__appels.length = 0; });
        await glisser(page, true, await cibles(page, 3, 0, false), 14, 0);
        r = await lire(page);
        v('un glissement franc sur une poignée ne déplace rien (c\'est un défilement)', r.appels.length === 0, JSON.stringify(r.appels));
      }

      /* LE BALAYAGE HORIZONTAL PENDANT LA FENÊTRE D'APPUI (31/08, capture user : « la bande
         d'onglets glisse sous le doigt », onglets chevauchés). L'annulation de l'appui long ne
         surveillait que la VERTICALE : balayer la barre d'onglets en X — le geste normal pour
         parcourir une rangée qui défile horizontalement — gardait clientY constant, le minuteur de
         450 ms arrivait au bout et la CARTE partait en déplacement sous le doigt, défilement gelé
         par le touchmove non passif. On échantillonne PENDANT le geste (à la fin, le relâcher
         nettoie tout et un contrôle après coup serait vert même cassé) : rien ne doit s'armer. */
      if (tactile) {
        await page.evaluate(() => { window.__appels.length = 0; });
        const bx = await cibles(page, 3, 3, false);
        await page.touchscreen.touchStart(bx.gx, bx.gy);
        let armeEnX = false;
        for (let k = 1; k <= 7; k++) {
          await page.touchscreen.touchMove(bx.gx + k * 12, bx.gy);
          await new Promise(r2 => setTimeout(r2, 90));
          if (await page.evaluate(() => !!document.querySelector('.wdg-reord-src'))) armeEnX = true;
        }
        await page.touchscreen.touchEnd();
        r = await lire(page);
        v('un balayage HORIZONTAL pendant la fenêtre d\'appui n\'arme jamais le déplacement',
          !armeEnX && r.appels.length === 0, 'armé: ' + armeEnX + ' · appels: ' + JSON.stringify(r.appels));
        v('… et ne laisse aucun repère affiché après le relâcher', r.restes === 0, String(r.restes));
      }

      /* LÂCHER AU-DESSUS DE LA LISTE VEUT DIRE « EN PREMIER ». Le volet laisse 128 px sans aucune
         ligne au-dessus de la première : un doigt qui remonte le dernier onglet « tout en haut » y
         arrive naturellement, et on abandonnait sans rien dire. */
      await page.evaluate(() => { window.__appels.length = 0; });
      const bh = await page.evaluate(() => {
        const L = document.querySelectorAll('.wdg-set-tabrow');
        const g = L[6].querySelector('.wdg-set-tabgrip').getBoundingClientRect();
        const p = L[0].getBoundingClientRect();
        return { gx: g.x + g.width / 2, gy: g.y + g.height / 2, cy: Math.max(2, p.y - 30) };
      });
      await glisser(page, tactile, bh);
      r = await lire(page);
      v('lâcher au-dessus de la liste place l\'onglet en premier, ' + quoi, JSON.stringify(r.appels) === '[[7,6,0]]', JSON.stringify(r.appels));

      // Un glissement qui ne part PAS d'une poignée ne doit rien déclencher.
      await page.evaluate(() => { window.__appels.length = 0; });
      const bi = await page.evaluate(() => {
        const L = document.querySelectorAll('.wdg-set-tabrow');
        const i = L[1].querySelector('input').getBoundingClientRect();
        const c = L[5].getBoundingClientRect();
        return { gx: i.x + i.width / 2, gy: i.y + i.height / 2, cy: c.y + c.height / 2 };
      });
      await glisser(page, tactile, bi);
      r = await lire(page);
      v('glisser hors d\'une poignée ne déplace rien, ' + quoi, r.appels.length === 0, JSON.stringify(r.appels));
      await page.close();
    }
  } catch (e) {
    v('la phase navigateur s\'exécute', false, e.message);
  } finally { if (nav) try { await nav.close(); } catch {} }

  /* ══ 9. LA RANGÉE D'ONGLETS SE PARCOURT VRAIMENT (29/08, capture user : « fixe le panneau à
        onglet ») ═══════════════════════════════════════════════════════════════════════════════
     ⚠️ ON MONTE LE VRAI DESK, PAS UNE MAQUETTE. Les trois défauts ne vivaient NI dans le balisage
     NI dans une règle isolée, mais dans leur rencontre : une plaque de commandes de 144 px posée
     en surimpression, une réserve de 96 px écrite en dur dans la feuille, et un desk affiché à 90 %
     de zoom qui fait diverger pixels CSS et pixels d'écran. Une maquette aurait été verte.
     Mesuré sur le modèle par DÉFAUT — celui que tout le monde reçoit : neuf onglets demandent
     925 px, la carte en offre 434 sur un écran de 1600. Avant correction : six onglets hors champ,
     deux sous les boutons (invisibles ET incliquables), aucun moyen de les atteindre à la souris. */
  console.log('\n── 9. La rangée d\'onglets se parcourt vraiment (vrai desk) ──');
  const PUB = path.join(__dirname, '..', 'public');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };
  const UTIL = { loggedIn: true, authenticated: true, email: 'banc@dtp.fr', plan: 'pro' };
  let srv = null, nav2 = null;
  try {
    srv = http.createServer((rq, rs) => {
      const u = rq.url.split('?')[0];
      if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify({ items: [], total: 0, ok: true, user: UTIL, ...UTIL })); }
      const f = path.join(PUB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
      if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('404'); }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rs);
    });
    await new Promise(r => srv.listen(PORT_DESK, r));
    nav2 = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav2.newPage();
    await page.setViewport({ width: 1600, height: 950 });
    await page.goto('http://localhost:' + PORT_DESK + '/index.html', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    await page.evaluate(() => {
      const vw = document.getElementById('view-widgets'); if (vw) vw.classList.remove('hidden');
      document.querySelectorAll('.view-panel').forEach(p => { if (p.id !== 'view-widgets') p.classList.add('hidden'); });
      window.DTPWidgets.open();
    });
    await page.waitForFunction(() => !!document.querySelector('#view-widgets .wdg-card--tabs .wdgt-tab'), { timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));

    /* Ce que le navigateur sait et que la lecture ignore : la partie VISIBLE d'un onglet. Hors de
       la piste défilante il est rogné par `overflow`, mais son rect, lui, dit toujours sa taille
       entière — juger sur le rect nu ferait crier le banc sur des onglets parfaitement cachés.
       (Mon premier jet faisait exactement cette erreur.) */
    const etat = () => page.evaluate(() => {
      const carte = document.querySelector('#view-widgets .wdg-card--tabs');
      const bar = carte.querySelector('.wdgt-bar');
      const act = carte.querySelector(':scope > .wdg-head .wdg-actions');
      const br = bar.getBoundingClientRect(), ar = act.getBoundingClientRect();
      const tabs = [...bar.querySelectorAll('.wdgt-tab')];
      const visible = t => { const r = t.getBoundingClientRect(); return { g: Math.max(r.left, br.left), d: Math.min(r.right, br.right), r }; };
      return {
        reserve: parseFloat(getComputedStyle(carte).getPropertyValue('--wdgt-cmd')) || 0,
        plaqueCss: act.offsetWidth,
        barFinit: br.right, plaqueDebute: ar.left,
        sl: bar.scrollLeft, max: bar.scrollWidth - bar.clientWidth,
        classes: bar.className,
        sousCmd: tabs.filter(t => { const v = visible(t); return v.d > v.g + 0.5 && v.g < ar.right - 0.5 && v.d > ar.left + 0.5; }).map(t => t.textContent.trim()),
        coupesG: tabs.filter(t => { const r = t.getBoundingClientRect(); return r.left < br.left - 1.5 && r.right > br.left + 1.5; }).map(t => t.textContent.trim()),
        dernier: (() => { const t = tabs[tabs.length - 1], r = t.getBoundingClientRect(); return { nom: t.textContent.trim(), entier: r.left >= br.left - 1 && r.right <= br.right + 1 }; })(),
      };
    });
    /* ⚠️ CHAQUE CRAN ATTEND QUE LE DÉFILEMENT SE POSE, PAS 60 MS FIXES (30/08, première exécution
       sur un runner GitHub : le retour de 30 crans laissait scrollLeft à 531 — sur une machine à
       2 vCPU, l'animation `smooth` n'a pas fini quand le cran suivant part, et les crans partent
       dans le vide. Vert ici, rouge là-bas : le banc mesurait la vitesse de la machine, pas le
       desk). On modélise le vrai geste : un cran, la vue se pose, le cran suivant. « Posé » =
       scrollLeft inchangé sur 3 relevés de 50 ms, avec un garde-fou de 5 s par cran. */
    const roue = (n) => page.evaluate(async (k) => {
      const bar = document.querySelector('#view-widgets .wdg-card--tabs .wdgt-bar');
      const pose = async () => {
        let prev = -1, calme = 0;
        for (let g = 0; g < 100 && calme < 3; g++) {
          await new Promise(r => setTimeout(r, 50));
          const sl = bar.scrollLeft;
          if (Math.abs(sl - prev) < 0.5) calme++; else calme = 0;
          prev = sl;
        }
      };
      for (let i = 0; i < Math.abs(k); i++) {
        bar.dispatchEvent(new WheelEvent('wheel', { deltaY: k > 0 ? 120 : -120, bubbles: true, cancelable: true }));
        await pose();
      }
    }, n);

    let e = await etat();
    /* (1) LA RÉSERVE EST MESURÉE, ET DANS LES BONNES UNITÉS. Le desk tourne à 90 % de zoom : une
       réserve lue au `getBoundingClientRect()` sortait 10 % trop courte, et deux onglets restaient
       sous la plaque. Le contrôle compare donc à la largeur CSS de la plaque, pas à son rect. */
    v('la réserve des commandes est publiée en --wdgt-cmd', e.reserve > 0, 'variable absente : la feuille retombe sur son repli');
    v('… et elle couvre au moins la plaque RÉELLE', e.reserve >= e.plaqueCss,
      'réserve ' + e.reserve + ' px pour une plaque de ' + e.plaqueCss + ' px (CSS)');
    v('… si bien que la piste s\'arrête AVANT les commandes', e.barFinit <= e.plaqueDebute + 1,
      'la barre finit à x=' + Math.round(e.barFinit) + ', la plaque commence à x=' + Math.round(e.plaqueDebute));
    /* (2) AUCUN ONGLET SOUS LES BOUTONS — le défaut de la capture, celui qui rend un onglet
       incliquable tout en le laissant deviner. */
    v('aucun onglet visible ne passe sous les commandes', e.sousCmd.length === 0, e.sousCmd.join(', '));
    /* (3) LE FONDU DIT OÙ L'ON EN EST. Au repos on est au début, et il reste de la rangée à droite. */
    v('au repos, la rangée se dit AU DÉBUT', /wdgt-au-debut/.test(e.classes), e.classes);
    v('… et pas encore au bout (neuf onglets ne tiennent pas)', !/wdgt-au-bout/.test(e.classes) && e.max > 0,
      'classes ' + e.classes + ' · reste ' + e.max + ' px');

    /* (4) LA MOLETTE PARCOURT, D'UN ONGLET À LA FOIS. Sans elle, un utilisateur à la souris
       n'atteint PAS les onglets 4 à 9 : la barre n'a pas de glissière, et glisser dessus déplace
       la carte. Et chaque arrêt tombe sur un bord d'onglet — la capture montrait « TUTIONS ». */
    const bords = await page.evaluate(() => {
      const bar = document.querySelector('#view-widgets .wdg-card--tabs .wdgt-bar');
      const padL = parseFloat(getComputedStyle(bar).paddingLeft) || 0;
      return [...bar.querySelectorAll('.wdgt-tab')].map(t => (t.offsetLeft <= padL + 1 ? 0 : t.offsetLeft));
    });
    await roue(1);
    e = await etat();
    v('un cran de molette fait avancer la rangée', e.sl > 6, 'scrollLeft ' + Math.round(e.sl));
    v('… en s\'arrêtant sur un onglet entier', e.coupesG.length === 0, 'coupé en plein mot : ' + e.coupesG.join(', '));
    /* ⚠️ UN CRAN = UN ONGLET, ET C'EST CE CONTRÔLE-LÀ QUI DISTINGUE VRAIMENT. Éprouvé à la
       mutation : remplacer la visée d'un bord par un `scrollLeft += deltaY` laissait le banc VERT,
       parce que le `scroll-snap` de la feuille rattrapait la position — les deux mécanismes se
       recouvrent sur « pas de mot coupé ». Ils divergent sur l'AMPLEUR : une molette rapide fait
       alors sauter quatre onglets d'un coup, et `proximity` reste un conseil que le navigateur suit
       s'il veut. La visée explicite, elle, avance d'un onglet, sur tous les navigateurs. */
    v('… et d\'UN SEUL onglet, pas de quatre', Math.abs(e.sl - bords[1]) <= 2,
      'scrollLeft ' + Math.round(e.sl) + ' pour un bord attendu à ' + bords[1] + ' (bords : ' + bords.join(', ') + ')');
    v('… et le fondu de gauche s\'allume', !/wdgt-au-debut/.test(e.classes), e.classes);
    await roue(20);
    e = await etat();
    v('la molette atteint la fin de la rangée', e.sl >= e.max - 2, Math.round(e.sl) + '/' + e.max);
    v('… le DERNIER onglet est alors entièrement lisible', e.dernier.entier, e.dernier.nom);
    v('… et le fondu de droite s\'éteint', /wdgt-au-bout/.test(e.classes), e.classes);
    await roue(-30);
    e = await etat();
    /* DIAGNOSTIC D'ENVIRONNEMENT (30/08) : sur le runner GitHub, le retour molette laisse
       scrollLeft EXACTEMENT à sa butée, de façon déterministe, alors qu'il revient à 0 partout
       ailleurs. Quand le retour échoue, on fait dire au navigateur fautif CE QU'IL VOIT :
       version, géométrie, bords calculés par le vrai _bordSuivant, et deux sondes — un cran
       arrière isolé (le gestionnaire est-il seulement entré ?) et une écriture directe de
       scrollLeft (l'écriture est-elle obéie ?). Des lignes « · », pas des contrôles. */
    if (e.sl > 6) {
      const diag = await page.evaluate(async () => {
        const bar = document.querySelector('#view-widgets .wdg-card--tabs .wdgt-bar');
        const d = { ua: navigator.userAgent.match(/Chrom\S+/g), sw: bar.scrollWidth, cw: bar.clientWidth,
                    sl0: bar.scrollLeft, snap: getComputedStyle(bar).scrollSnapType,
                    beh: getComputedStyle(bar).scrollBehavior,
                    bords: [...bar.querySelectorAll('.wdgt-tab, .wdgt-add')].map(t => t.offsetLeft) };
        const ev = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
        bar.dispatchEvent(ev);
        d.prevented = ev.defaultPrevented;                     // le gestionnaire a couru et a pris le geste
        await new Promise(r => setTimeout(r, 400));
        d.slApresCran = bar.scrollLeft;
        bar.scrollLeft = 0;                                    // l'écriture directe est-elle obéie ?
        await new Promise(r => setTimeout(r, 400));
        d.slApresEcriture = bar.scrollLeft;
        return d;
      });
      console.log('  · diagnostic : ' + JSON.stringify(diag));
    }
    v('la molette revient au début', e.sl <= 6 && /wdgt-au-debut/.test(e.classes), 'scrollLeft ' + Math.round(e.sl) + ' · ' + e.classes);
    v('… sans onglet coupé au retour', e.coupesG.length === 0, e.coupesG.join(', '));

    /* ══ 9 bis. SUR UNE CARTE ÉTROITE, LE DERNIER ONGLET RESTAIT ILLISIBLE POUR TOUJOURS ═══════
       11/09, demande user : « je peux pas décaler vers la droite après l'onglet banques ».
       Tout ce qui précède est vert, et le défaut existe quand même — parce que tout ce qui
       précède mesure une carte LARGE (écran de 1600, une ou deux colonnes). Mesuré à 900px, où
       la grille donne QUATRE colonnes : carte de 247px, plaque de commandes de 160, réserve
       publiée 170. Il reste 75px de piste pour neuf onglets, et BANQUES, le dernier, en fait 86.
       L'onglet est plus large que la fenêtre censée le montrer : au bout du parcours, scrollLeft
       est à sa butée et il n'est visible qu'à 41px sur 77. AUCUN geste ne peut finir de le
       révéler, et le balayage tactile fonctionne parfaitement (mesuré aussi) : ce n'était pas un
       défaut de défilement.
       ⚠️ LE PETIT ÉCRAN N'EST PAS LE CAS DIFFICILE. À 390px la grille passe à UNE colonne, la
       carte fait 429px et tout va bien. C'est à 900px que ça casse. Un banc qui n'éprouve que le
       téléphone et le grand écran rate exactement la bande où vit le défaut, et c'est ce qui
       s'est passé pendant onze jours. */
    console.log('\n── 9 bis. La rangée reste lisible sur une carte ÉTROITE ──');
    const etroit = async (deuxLignes) => page.evaluate(async (avec) => {
      const c = document.querySelector('#view-widgets .wdg-card--tabs');
      const bar = c.querySelector('.wdgt-bar');
      /* Le TÉMOIN retire la classe : la piste redevient un ruban, et le dernier onglet doit
         redevenir illisible. Sans ce retrait, le banc ne prouverait pas que c'est bien elle qui
         répare. */
      c.classList.toggle('wdg-card--tabs-2lignes', avec);
      bar.scrollLeft = 99999;
      await new Promise(r => setTimeout(r, 700));
      const tabs = [...bar.querySelectorAll('.wdgt-tab')];
      const d = tabs[tabs.length - 1];
      const rb = bar.getBoundingClientRect(), rd = d.getBoundingClientRect();
      let large = 0; tabs.forEach(t => { if (t.offsetWidth > large) large = t.offsetWidth; });
      return { piste: bar.offsetWidth, plusLarge: large, carte: c.offsetWidth,
               dernier: d.textContent.trim(),
               vu: +(Math.min(rd.right, rb.right) - Math.max(rd.left, rb.left)).toFixed(1),
               large: +rd.width.toFixed(1) };
    }, deuxLignes);

    await page.setViewport({ width: 900, height: 950 });
    await new Promise(r => setTimeout(r, 1400));
    const posee = await page.evaluate(() => document.querySelector('#view-widgets .wdg-card--tabs').classList.contains('wdg-card--tabs-2lignes'));
    const E = await etroit(true);
    v('sur une carte étroite, l\'en-tête passe de lui-même sur deux lignes', posee,
      'carte de ' + (E && E.carte) + 'px, classe absente : la piste garde son ruban');
    v('… la piste peut alors montrer n\'importe quel onglet en entier', E.piste >= E.plusLarge,
      'piste de ' + E.piste + 'px pour un onglet le plus large de ' + E.plusLarge + 'px');
    v('… et le DERNIER onglet se lit en entier au bout du parcours', E.vu >= E.large - 1,
      '« ' + E.dernier + ' » visible sur ' + E.vu + 'px de ' + E.large);
    /* TÉMOIN : sans la seconde ligne, le défaut doit revenir. S'il ne revient pas, les trois
       contrôles ci-dessus sont verts pour une raison étrangère et ne prouvent rien. */
    const T = await etroit(false);
    v('témoin : sans la seconde ligne, le dernier onglet redevient illisible', T.vu < T.large - 1,
      'piste de ' + T.piste + 'px, « ' + T.dernier + ' » visible sur ' + T.vu + 'px de ' + T.large
      + ' : le défaut ne se reproduit pas, le contrôle ne prouve rien');
    await page.evaluate(() => document.querySelector('#view-widgets .wdg-card--tabs').classList.add('wdg-card--tabs-2lignes'));

    await page.close();
  } catch (e) {
    v('la phase « vrai desk » s\'exécute', false, e.message);
  } finally {
    if (nav2) try { await nav2.close(); } catch {}
    if (srv) try { srv.close(); } catch {}
  }

  /* ══ 10. UN WIDGET MONTÉ DANS UN ONGLET VOIT-IL SA VRAIE HAUTEUR ? ═══════════════════════════
     Dix-neuf widgets du desk portent `container-type: size` et règlent ce qu'ils affichent sur la
     hauteur qu'on leur donne : sous un certain seuil, le pied, la ligne de verdict ou la ligne
     « Ensuite » s'effacent — c'est voulu dans une carte écrasée, ce ne l'est pas dans une carte
     haute. L'Horloge mondiale fait de même avec son conteneur `dtphorloge`.
     LE DÉFAUT, mesuré (02/09, capture user « on ne voit pas l'information du compteur à rebours,
     des onglets du panneau ») : monté dans un ONGLET, le même widget voyait 0 px là où sa boîte
     mesurait 369. En enfant flex `flex: 1 1 auto`, sa hauteur dépend de son contenu, donc elle
     n'est plus définie pour la requête, qui retombe à zéro et déclenche EN PERMANENCE toutes les
     règles `max-height`. Aucune erreur, aucun débordement : l'information disparaissait en
     silence, et aucun banc ne pouvait le voir puisque tous mesuraient des BOÎTES.
     ON NE MESURE DONC PAS LA BOÎTE : on demande à la requête elle-même ce qu'elle voit, en
     posant une échelle de règles `@container (min-height: N)` qui écrivent N dans une propriété
     lisible. C'est le seul relevé qui distingue les deux situations — elles ont exactement la
     même géométrie. */
  console.log('\n── 10. Un widget monté dans un onglet voit sa vraie hauteur ──');
  let srv3 = null, nav3 = null;
  try {
    /* ⚠️ `actV: 2` EST INDISPENSABLE DEPUIS LE 04/09, ET SON ABSENCE MESURAIT AUTRE CHOSE. Ce jeu
       d'essai décrit un compte DÉJÀ MIGRÉ — c'est bien le cas qu'on veut éprouver. Sans `actV`,
       `ensureDefaultLayout` déclenche sa migration one-shot du 03/08 (« met vue d'ensemble par
       défaut ») et force `active` sur « Vue générale » : le banc mesurait alors le layout PAR
       DÉFAUT, pas le sien, et ne trouvait aucun Compte à rebours.
       Il passait quand même, mais pour une mauvaise raison : `open()` réécrivait ensuite `active`
       avec le layout ★, ce qui ramenait par accident le bon décor. Cette réécriture est le défaut
       corrigé le 04/09 (le modèle de l'utilisateur changeait en naviguant) ; en la retirant, on a
       découvert que ce banc s'appuyait dessus. Le jeu d'essai dit maintenant ce qu'il veut dire. */
    const CFG = { cfg: { active: 't', gap: 'tight', gapV: 2, deskV: 99, actV: 2, tipSeen: 1, layouts: [{ id: 't', name: 'Banc', fav: true, items: [
      /* Le MÊME widget des deux côtés : à gauche dans un onglet, à droite dans une carte
         ordinaire. Sans ce témoin, une sonde cassée rendrait 0 partout et le banc crierait au
         défaut là où il n'y en a pas. */
      { w: 'onglets', gw: 6, gh: 14, tabs: ['evenement-rebours', 'horloge'] },
      { w: 'evenement-rebours', gw: 6, gh: 14 },
    ] }] } };
    /* ⚠️ ON REPREND LE BOUCHON COMMUN (`mobile-apercu.js`) ET NON UN FOURRE-TOUT `{items:[]}`.
       Sans données, le Compte à rebours ne CONSTRUIT PAS son `.wdg-rb` : il pose une ligne de
       repli. La sonde ne trouvait alors aucun conteneur et le banc criait « absent » — vert ou
       rouge pour une raison qui n'a rien à voir avec ce qu'il mesure. */
    const bouchon = require('./mobile-apercu.js').serveur();
    srv3 = http.createServer((rq, rs) => {
      const u = rq.url.split('?')[0];
      if (u === '/api/widgets') { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify(CFG)); }
      bouchon.emit('request', rq, rs);
    });
    await new Promise(r => srv3.listen(PORT_DESK + 1, r));
    nav3 = await puppeteer.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const p3 = await nav3.newPage();
    /* ⚠️ AU FORMAT TÉLÉPHONE, ET C'EST LA CONDITION DU DÉFAUT — vérifié dans les deux sens.
       Sur un grand écran la carte tient sa hauteur des rangées de la grille : la chaîne est
       définie de bout en bout et la requête voit juste, montage flex ou non. Sur téléphone la
       carte n'a plus qu'un PLANCHER et une hauteur automatique : la chaîne devient indéfinie, et
       c'est là que le montage en colonne flex fait retomber la requête à zéro. Un banc écrit au
       format bureau restait vert des deux côtés — il ne prouvait rien. */
    await p3.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p3.goto('http://localhost:' + (PORT_DESK + 1) + '/index.html', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    await p3.evaluate(() => {
      const vw = document.getElementById('view-widgets'); if (vw) vw.classList.remove('hidden');
      document.querySelectorAll('.view-panel').forEach(x => { if (x.id !== 'view-widgets') x.classList.add('hidden'); });
      window.DTPWidgets.open();
    });
    await p3.waitForFunction(() => !!document.querySelector('#view-widgets .wdg-card--tabs .wdgt-tab'), { timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));
    // L'échelle de sondes : une règle tous les 10 px, écrite dans `outline-offset` (propriété
    // héritée par personne, lue telle quelle, et sans effet visuel sans `outline`).
    await p3.evaluate(() => {
      const st = document.createElement('style'); let css = '';
      for (let h = 0; h <= 1200; h += 10) {
        css += '@container dtpw (min-height: ' + h + 'px){ .dtp-sonde-w{ outline-offset: ' + h + 'px; } }\n';
        css += '@container dtphorloge (min-height: ' + h + 'px){ .dtp-sonde-h{ outline-offset: ' + h + 'px; } }\n';
      }
      st.textContent = css; document.head.appendChild(st);
    });
    const sonder = (sel, cls) => p3.evaluate((sel, cls) => {
      const out = [];
      document.querySelectorAll(sel).forEach(c => {
        const s = document.createElement('span'); s.className = cls; c.appendChild(s);
        const vue = parseFloat(getComputedStyle(s).outlineOffset) || 0;
        s.remove();
        out.push({ onglet: !!c.closest('.wdg-card--tabs'), boite: Math.round(c.getBoundingClientRect().height), vue });
      });
      return out;
    }, sel, cls);
    const onglet = async (re) => p3.evaluate(re => {
      const c = document.querySelector('#view-widgets .wdg-card--tabs');
      const t = [...c.querySelectorAll('.wdgt-bar .wdgt-tab')].find(x => new RegExp(re, 'i').test(x.textContent || ''));
      if (t) t.click(); return !!t;
    }, re);

    const decor = await p3.evaluate(() => ({
      cartes: [...document.querySelectorAll('#view-widgets .wdg-card')].map(c => (c.querySelector('.wdg-title') || {}).textContent || '?'),
      onglets: [...document.querySelectorAll('#view-widgets .wdg-card--tabs .wdgt-tab')].map(t => (t.textContent || '').trim()),
    }));
    console.log('  · décor : cartes [' + decor.cartes.join(' | ') + '] · onglets [' + decor.onglets.join(' | ') + ']');
    const dire = x => x ? (x.boite + ' px de boîte, ' + x.vue + ' px vus par la requête') : 'absent';
    /* Marge de 25 % : la requête interroge la boîte du CONTENU du conteneur, `getBoundingClientRect`
       rend sa boîte de BORDURE, et l'échelle de sondes procède par crans de 10 px. Ce qu'on veut
       distinguer n'est pas un écart de quelques pixels — c'est un ZÉRO en face de plusieurs
       centaines. */
    const juste = x => !!x && x.vue > 0 && x.vue >= x.boite * 0.75 && x.vue <= x.boite * 1.25;

    await onglet('rebours'); await new Promise(r => setTimeout(r, 1800));
    const rbs = await sonder('.wdg-rb', 'dtp-sonde-w');
    const dansOnglet = rbs.find(x => x.onglet), ordinaire = rbs.find(x => !x.onglet);
    console.log('  · Compte à rebours — onglet : ' + dire(dansOnglet) + ' · carte ordinaire : ' + dire(ordinaire));
    v('le TÉMOIN est sain : dans une carte ordinaire, la requête voit la hauteur réelle',
      juste(ordinaire),
      'témoin : ' + dire(ordinaire) + ' — si celui-ci échoue, la sonde est cassée et les contrôles suivants ne prouvent rien');
    v('… et dans un ONGLET la requête voit la même hauteur, pas zéro',
      juste(dansOnglet),
      'onglet : ' + dire(dansOnglet) + ' — à 0, toutes les règles `max-height` se déclenchent et le widget perd son pied, sa ligne de verdict et sa ligne « Ensuite »');

    await onglet('horloge'); await new Promise(r => setTimeout(r, 1800));
    const hor = (await sonder('.wdg-clockwrap', 'dtp-sonde-h')).find(x => x.onglet);
    console.log('  · Horloge mondiale — onglet : ' + dire(hor));
    /* L'Horloge, elle, tenait DÉJÀ dans les deux montages — vérifié en remettant la colonne flex :
       elle reste juste. On la garde en veille et non comme discriminant : elle porte le second
       conteneur nommé du desk, et rien ne garantit qu'un remaniement du montage l'épargnera. */
    v('l\'Horloge mondiale aussi (son conteneur `dtphorloge` suit la même règle)',
      juste(hor), 'onglet : ' + dire(hor));
    await p3.close();
  } catch (e) {
    v('la phase « hauteur vue par la requête » s\'exécute', false, e.message);
  } finally {
    if (nav3) try { await nav3.close(); } catch {}
    if (srv3) try { srv3.close(); } catch {}
  }
  fin();
})();

function fin() {
  console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
  process.exit(ko ? 1 : 0);
}

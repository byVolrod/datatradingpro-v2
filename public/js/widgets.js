/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   MON DESK — système de widgets composable (DataTradingPro)
   ═══════════════════════════════════════════════════════════════════════════════════════════════
   L'utilisateur choisit ses widgets, les arrange, et retrouve son agencement sur tous ses appareils
   (persistance PAR COMPTE : KV serveur `wdg:<userId>`, endpoints GET/POST /api/widgets).

   ⚠️ FICHIER ISOLÉ (même parti pris que sessionmap.js) : app.js fait 10 000+ lignes et une erreur
   au niveau racine y tue TOUT le fichier (incident déjà vécu sur ce projet). Ici tout est encapsulé
   et gardé → le desk existant ne peut pas tomber à cause de ce module.

   ÉTAPE 1 (livrée derrière le FLAG ADMIN, pour validation en prod réelle sans impact client) :
   catalogue + grille + bibliothèque + persistance. Glisser-déposer libre = étape 2.

   IDENTITÉ : 100 % DTP (or #e3b23a, Fraunces, libellés FR originaux).

   ── API DU DESK RÉELLEMENT UTILISÉES (vérifiées, pas supposées) ──
   · window.activateView          charts.js:2574  (routage ; navbar #topbar-nav = listener DÉLÉGUÉ
                                                   charts.js:2576 → un onglet ajouté après coup marche)
   · buildIsolatedStrength(id,…)  charts.js:931   (async, AUTONOME : fetch ses propres données)
   · buildRiskHistoryChart(id,d)  charts.js:1353  (rend un contrôleur ; données à fournir)
   · disposeRoot(id)              charts.js:54    (cherche le root amCharts PAR ID → id unique requis)
   · CAL_FLAG / calImpDots        charts.js:2922 / 2936
   · window.getNewsMaster()       app.js:475      (GETTER — allItems est réassigné par le WS)
   · window.buildNewsItem(item)   app.js:476      (rendu .news-item officiel, handlers inclus)

   ── PIÈGES TRAITÉS ──
   · amCharts sort en 0×0 si le conteneur est caché → montage APRÈS affichage (requestAnimationFrame).
   · ids amCharts uniques obligatoires (disposeRoot cherche par id) → un id généré par instance.
   · aucun widget du desk n'expose de destroy() → ici chaque mount() rend sa fonction de nettoyage,
     appelée au retrait ET en quittant l'onglet (sinon : roots orphelins + timers à vie = fuite).
   · window._pdIsAdmin est ASYNCHRONE (posé dans le .then() de /api/auth/me) → on l'attend.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STATE = { cfg: null, mounted: [], saveT: null, booted: false };
  var HOST_ID = 'wdg-grid';
  /* Icones d onglet : slug -> chemin SVG. Jeu volontairement RESTREINT et coherent (trait fin,
     concepts du desk). Le serveur ne stocke que le slug ; le rendu se fait ici. */
  var _TAB_ICONS = {
    graphique:  '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 19V5\"/><path d=\"M4 15l4-4 3 3 5-6 3 3\"/></svg>',
    bougies:    '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M7 4v3M7 15v5M17 4v6M17 18v2\"/><rect x=\"5\" y=\"7\" width=\"4\" height=\"8\" rx=\"1\"/><rect x=\"15\" y=\"10\" width=\"4\" height=\"8\" rx=\"1\"/></svg>',
    calendrier: '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 9h18M8 3v4M16 3v4\"/></svg>',
    horloge:    '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"M12 8v4l3 2\"/></svg>',
    etoile:     '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 4l2.3 4.9 5.2.6-3.9 3.6 1 5.1L12 16.9 7.4 18.8l1-5.1L4.5 10l5.2-.6z\"/></svg>',
    liste:      '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01\"/></svg>',
    filtre:     '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 5h16l-6 7v6l-4 2v-8z\"/></svg>',
    dollar:     '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3v18M8 7.5a3 3 0 0 1 3-2.5h2a2.5 2.5 0 0 1 0 5h-2a2.5 2.5 0 0 0 0 5h2a3 3 0 0 0 3-2.5\"/></svg>',
    pourcent:   '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M19 5L5 19\"/><circle cx=\"7.5\" cy=\"7.5\" r=\"2.5\"/><circle cx=\"16.5\" cy=\"16.5\" r=\"2.5\"/></svg>',
    globe:      '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"M4 12h16M12 4c2.5 2.5 2.5 13 0 16M12 4c-2.5 2.5-2.5 13 0 16\"/></svg>',
    banque:     '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 10h16M4 10l8-5 8 5M6 10v7M10 10v7M14 10v7M18 10v7M4 20h16\"/></svg>',
    cloche:     '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6\"/><path d=\"M10 20a2 2 0 0 0 4 0\"/></svg>',
    eclair:     '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M13 3L5 13h6l-1 8 8-11h-6z\"/></svg>',
    cible:      '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/><circle cx=\"12\" cy=\"12\" r=\"0.6\" fill=\"currentColor\"/></svg>',
    jauge:      '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 15a8 8 0 0 1 16 0\"/><path d=\"M12 15l4-4\"/></svg>',
    drapeau:    '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 21V4M5 4h11l-1.5 4L16 12H5\"/></svg>',
    livre:      '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 4h10a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2z\"/><path d=\"M5 18a2 2 0 0 1 2-2h10\"/></svg>',
    tendance:   '<svg viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 17l6-6 4 4 8-8\"/><path d=\"M17 7h4v4\"/></svg>',
  };
  var _TAB_ICON_ORDER = ['graphique','bougies','tendance','pourcent','dollar','jauge','cible','filtre','liste','calendrier','horloge','cloche','globe','drapeau','banque','livre','etoile','eclair'];
  function _tabIconSvg(slug) { return (slug && _TAB_ICONS[slug]) ? _TAB_ICONS[slug] : ''; }
  var _reopen = null;                     // idx dont le panneau RÉGLAGES doit rester ouvert après un renderGrid
  var _LMAX = 12;                         // = _WDG_MAX_LAYOUTS côté serveur (plafond de templates)
  var _IMAX = 24;                         // = _WDG_MAX_ITEMS côté serveur : au-delà, le serveur TRONQUE
                                          // en silence → on refuse l'ajout ici plutôt que de perdre le widget au rechargement.
  var GRID_COLS = 12, ROW_PX = 26;        // vraie grille : 12 colonnes fluides + unité de ligne 26px (snap)
  var _BIAS_SINKS = [];                   // widgets Radar de Biais montés → repeints par le push serveur (DTPWidgets.onBias)
  var _fullscreenIdx = null;              // widget en plein écran (null = aucun)
  var _mountToken = 0;                    // jeton anti-course : seul le rAF du DERNIER renderGrid monte
  function _clamp(v, a, b) { v = v | 0; return v < a ? a : (v > b ? b : v); }
  // Normalise un item vers le NOUVEAU modèle { gw:1-12 colonnes, gh:lignes } et MIGRE l'ancien { h:px, col:1|2 }
  // (col 2 = pleine largeur → gw 12 ; sinon gw 6 ; hauteur px → lignes). Idempotent.
  function _normItem(it) {
    if (!it) return it;
    if (it.gw == null) it.gw = (it.col === 2 ? 12 : 6);
    if (it.gh == null) it.gh = _clamp(Math.round((it.h || 300) / ROW_PX) + 1, 5, 40);
    it.gw = _clamp(it.gw, 1, GRID_COLS); it.gh = _clamp(it.gh, 3, 60);
    return it;
  }
  /* ══ RÉGLAGES PAR WIDGET — CONTRAT DÉCLARATIF ══════════════════════════════════════════════
     Une entrée du catalogue déclare ses réglages : opts: [{ k, lbl, type, def, choix, min, max }]
       · type 'choix'   → choix: [[valeur, libellé], …]   (pastilles cliquables)
       · type 'bascule' → oui/non
       · type 'nombre'  → incrémenteur borné min..max
     Le panneau de réglages est GÉNÉRÉ à partir de ça : aucune interface à écrire widget par widget,
     et la persistance suit toute seule (le serveur ne valide QUE la forme de `it.cfg`, cf. _wdgClean).

     RÈGLE : dans son mount(), un widget lit sa valeur par opt(it, w, 'clé') — JAMAIS it.cfg en direct.
     Raison : le panneau à onglets monte ses sous-widgets par w.mount(body), donc SANS item ; opt()
     renvoie alors le défaut au lieu de planter. (Conséquence assumée : un widget placé dans un onglet
     utilise ses valeurs par défaut — les réglages vivent sur la carte, pas sur l'onglet.) */
  function optDef(w, k) {
    var l = (w && w.opts) || [];
    for (var i = 0; i < l.length; i++) if (l[i].k === k) return l[i];
    return null;
  }
  function opt(it, w, k) {
    var d = optDef(w, k); if (!d) return undefined;
    var v = it && it.cfg ? it.cfg[k] : undefined;
    if (v === undefined || v === null) return d.def;
    if (d.type === 'texte') return String(v);            // valeur libre (ex. sections décochées)
    if (d.type === 'bascule') return !!v;
    if (d.type === 'nombre') { v = parseInt(v, 10); return isFinite(v) ? _clamp(v, d.min, d.max) : d.def; }
    // 'multi' : sélection multiple, stockée en chaîne « a|b|c » (le serveur ne valide QUE la forme
    // de it.cfg — il n'accepte pas de tableau). On rend un TABLEAU, filtré des codes qui ne sont
    // plus au catalogue, et on retombe sur le défaut si tout a été décoché (une carte vide ne rend
    // service à personne : mieux vaut la sélection d'origine).
    if (d.type === 'multi') {
      var gardes = String(v).split('|').filter(function (x) {
        return x && d.choix.some(function (c) { return c[0] === x; });
      });
      return gardes.length ? gardes : d.def;
    }
    // 'choix' : une valeur devenue invalide (option retirée du catalogue) retombe sur le défaut
    for (var i = 0; i < d.choix.length; i++) if (d.choix[i][0] === v) return v;
    return d.def;
  }
  // SECTIONS DU FIL : rubriques en cases à cocher persistées. Rendue pour la CARTE fil-news ET
  // pour un fil-news affiché EN ONGLET (le setter change de cible). ⚠️ AU NIVEAU MODULE (et non
  // dans _setPanelHtml) : une expression de fonction locale appelée avant sa ligne d'affectation
  // avait provoqué un ÉCRAN NOIR le 04/08 — ici, une DÉCLARATION hissée, utilisable partout.
  function _blocSectionsFor(item, w2, tab, idx, cell) {
    if (!w2 || w2.id !== 'fil-news') return '';
    var cats = (typeof INTERNAL_CATS !== 'undefined' && Array.isArray(INTERNAL_CATS))
      ? INTERNAL_CATS.filter(function (c) { return c !== 'Bonds'; }) : [];
    if (!cats.length) return '';
    var offSet = {};
    String(opt(item, w2, 'off') || '').split('|').forEach(function (c) { if (c) offSet[c] = 1; });
    var fn = tab ? 'toggleNewsSectionTab' : 'toggleNewsSection';
    return '<div class="wdg-set-sep"></div><div class="wdg-set-tabs-t">Sections affichées</div>'
      + '<div class="wdg-set-secs">' + cats.map(function (c) {
          var lib = (typeof catFr === 'function') ? catFr(c) : c;
          return '<button class="wdg-set-sec' + (offSet[c] ? '' : ' on') + '"'
            + ' onclick="DTPWidgets.' + fn + '(' + idx + ',\'' + esc(c).replace(/'/g, '&#39;') + '\'' + _argC(cell) + ')">'
            + '<span>' + esc(lib) + '</span><i>✓</i></button>';
        }).join('') + '</div>';
  }
  // Panneau de réglages généré depuis le contrat. Vide si le widget ne déclare rien.
  // Contenu du panneau de réglages d'une carte (titre, description, taille, réglages déclarés).
  // Extrait pour pouvoir le RE-RENDRE seul après un changement, sans reconstruire la grille.
  function _setPanelHtml(idx, w, it) {
    var verrou = !!it.locked;
    // Actions descendues du bandeau (demande user : « trop de boutons »). Libellées, car on ne s'en
    // sert pas tous les jours — une icône seule aurait juste déplacé le problème de lisibilité.
    var actions = '<div class="wdg-set-sep"></div><div class="wdg-set-acts">'
      + '<button class="wdg-set-act" onclick="DTPWidgets.refresh(' + idx + ')">' + ICO.refresh + ' Actualiser</button>'
      // « Remplacer » DESCEND ici (04/08, demande user « le moins de boutons possible dans le
      // bandeau — 2 en moyenne ») : le bandeau ne garde que Réglages + Fermer.
      + '<button class="wdg-set-act" onclick="DTPWidgets.replaceStart(' + idx + ')">' + ICO.swap + ' Remplacer</button>'
      + '<button class="wdg-set-act" onclick="DTPWidgets.duplicate(' + idx + ')">' + ICO.dup + ' Dupliquer</button>'
      + '<button class="wdg-set-act" onclick="DTPWidgets.fullscreen(' + idx + ')">' + ICO.expand + ' Plein écran</button>'
      + '<button class="wdg-set-act' + (verrou ? ' on' : '') + '" onclick="DTPWidgets.toggleLock(' + idx + ')">'
      +   (verrou ? ICO.lock : ICO.unlock) + (verrou ? ' Déverrouiller' : ' Verrouiller') + '</button>'
      // Panneau à onglets : vider l'onglet affiché vit ici aussi (le « − » quitte le bandeau).
      + (w.id === 'onglets'
          ? '<button class="wdg-set-act" onclick="DTPWidgets.removeActiveTab(' + idx + ')">− Retirer le widget de l\'onglet affiché</button>'
          : '')
      + '</div>';
    // PANNEAU À ONGLETS : la gestion des onglets vit ICI, dans les Réglages (demande user 02/08
    // « ça doit se supprimer directement depuis le bouton paramètre ») — renommer chaque onglet
    // (champ inline, Entrée/blur valide, vide = nom d'origine) et le retirer (×). La croix au survol
    // de l'onglet lui-même a été SUPPRIMÉE : un clic de trop détruisait un onglet par accident.
    var onglets = '';
    if (w.id === 'onglets') {
      var tl = Array.isArray(it.tabs) ? it.tabs : [];
      var lb = Array.isArray(it.tabLabels) ? it.tabLabels : [];
      var ic = Array.isArray(it.tabIcons) ? it.tabIcons : [];   // icone par onglet (slug)
      onglets = '<div class="wdg-set-sep"></div><div class="wdg-set-tabs-t">Onglets · renommer ou retirer</div>'
        + tl.map(function (id2, j) {
            // Onglet VIDE (sentinel 'vide') : il apparaît AUSSI ici — renommable, retirable.
            var estVide = (id2 === 'vide');
            // Onglet COMPOSITE (sentinel 'grille') : il apparaît ici comme les autres. Sans ce test
            // il aurait DISPARU du volet — donc plus moyen de le renommer ni de le retirer.
            var estGrille = _estGrille(it, j);
            var w2 = byId(id2); if (!w2 && !estVide && !estGrille) return '';
            var nCell = estGrille ? _tabCells(it, j).filter(function (x) { return x !== 'vide'; }).length : 0;
            var nomW = estGrille ? ('Onglet composite · ' + nCell + ' widget' + (nCell > 1 ? 's' : ''))
              : (estVide ? 'Onglet vide : aucun widget' : w2.name);
/* ⚠️ L'ONGLET PORTE LE NOM DU WIDGET, PAS SON SIGLE (03/09, capture : un onglet « MONDE » au-dessus
   d'un panneau intitulé « SESSIONS DE MARCHÉ »). Le libellé par défaut retombait sur `w.tag` — un
   code court de vignette — avant `w.name`. Mesuré sur le catalogue : 27 widgets sur 41 ont un tag
   qui diffère de leur nom, et plusieurs le PARTAGENT (cinq widgets étiquetés « VOLATILITÉ », trois
   « FX », deux « TAUX »). Deux onglets voisins pouvaient donc porter le même libellé, ce qui retire
   à l'onglet sa seule fonction : dire ce qu'il ouvre. Le sigle garde sa place là où il a un sens —
   la vignette de disposition (_thumbLbl) et la fiche d'aide. */
            var defLbl = estGrille ? 'GRILLE' : (estVide ? 'Vide' : w2.name);
            var _cur = _tabIconSvg(ic[j]);
            /* SELECTEUR D ICONE (21/08). <details> natif : le resume est l icone courante, le contenu
               la grille de choix. Aucun etat JS a gerer, aucune fuite, ferme au clic exterieur par le
               navigateur. Chaque choix appelle setTabIcon ; « aucune » retire l icone. */
            var _grid = '<button type="button" class="wdg-tabic-b wdg-tabic-none" title="Aucune icone" onclick="DTPWidgets.setTabIcon(' + idx + ',' + j + ',\'\')">–</button>'
              + _TAB_ICON_ORDER.map(function (sl) {
                  return '<button type="button" class="wdg-tabic-b' + (ic[j] === sl ? ' on' : '') + '" title="' + sl + '" onclick="DTPWidgets.setTabIcon(' + idx + ',' + j + ',\'' + sl + '\')">' + _tabIconSvg(sl) + '</button>';
                }).join('');
            var _picker = '<details class="wdg-tabic"><summary class="wdg-tabic-cur" title="Icone de l onglet">' + (_cur || '<span class="wdg-tabic-ph">+</span>') + '</summary>'
              + '<div class="wdg-tabic-grid">' + _grid + '</div></details>';
            /* POIGNÉE DE DÉPLACEMENT — même idiome ⠿ que le gestionnaire de desks (_wireMgr) :
               glisser-déposer, et ↑ ↓ au clavier quand la poignée a le focus (une liste de sept
               onglets se réordonne plus vite à la flèche qu'à la souris). Une seule ligne → aucune
               poignée : il n'y a rien à déplacer. */
            var _grip = tl.length > 1
              // Pas de `draggable` : le glisser-déposer natif n'existe pas au doigt ET il vole le
              // geste au pointeur sur les autres appareils. Tout passe par `_glisserPourReordonner`.
              ? '<button type="button" class="wdg-set-tabgrip" data-j="' + j + '"'
                + ' title="Glisser pour déplacer · ↑ ↓ au clavier" aria-label="Déplacer l\'onglet"'
                + ' onkeydown="if(event.key===\'ArrowUp\'||event.key===\'ArrowDown\'){event.preventDefault();event.stopPropagation();DTPWidgets.moveTab(' + idx + ',' + j + ',' + j + '+(event.key===\'ArrowUp\'?-1:1));}">\u283f</button>'
              : '';
            return '<div class="wdg-set-row wdg-set-tabrow" data-j="' + j + '">'
              + _grip
              + _picker
              + '<div class="wdg-set-tabcol">'
              +   '<input class="wdg-set-tabin" maxlength="18" value="' + esc(lb[j] || defLbl) + '"'
              +   ' autocomplete="off" name="dtp-nom-onglet" data-lpignore="true" data-1p-ignore data-bwignore data-protonpass-ignore="true" data-form-type="other"'
              +   ' placeholder="' + esc(defLbl) + '" title="' + esc(nomW) + '"'
              +   ' onchange="DTPWidgets.renameTab(' + idx + ',' + j + ', this.value)"'
              // Échap = ANNULER (miroir de l'éditeur inline .wdgt-edit) : valeur d'origine restaurée
              // AVANT le blur → aucun change n'est émis ; stopPropagation → le listener document
              // (Échap ferme les volets) ne claque pas le panneau au nez de l'utilisateur.
              +   ' onkeydown="if(event.key===\'Enter\')this.blur();else if(event.key===\'Escape\'){event.stopPropagation();this.value=this.defaultValue;this.blur();}">'
              // (Nom du widget sous le champ RETIRÉ 04/08 : le bandeau de titre dans le widget et
              //  l'infobulle du × le donnent déjà — la liste respire.)
              + '</div>'
              // PLANCHER 1 ONGLET (demande user 03/08 « on ne doit pas pouvoir supprimer tous les
              // onglets ») : sur la dernière ligne restante, pas de × — un panneau à onglets vide
              // n'a aucun sens (et retirer le WIDGET entier se fait depuis l'en-tête de la carte).
              + (tl.length > 1
                  ? '<button class="wdg-set-tabdel" title="' + (estGrille ? 'Retirer cet onglet et sa disposition' : (estVide ? 'Retirer cet onglet vide' : 'Retirer l\'onglet et son widget « ' + esc(w2.name) + ' »')) + '" onclick="DTPWidgets.removeTab(' + idx + ',' + j + ')">×</button>'
                  : '<span class="wdg-set-tabone" title="Un panneau garde au moins un onglet">min. 1</span>')
              + '</div>';
          }).join('')
        + '<button class="wdg-set-act" onclick="DTPWidgets.addTab(' + idx + ')">+ Ajouter un onglet</button>';
    }
    // Pas-à-pas Largeur/Hauteur RETIRÉS (demande user 03/08 « enlève ceci de tous les widgets ») :
    // depuis le modèle « déplacer une frontière », la taille se règle au bord droit et au coin —
    // deux chiffres dans un panneau faisaient doublon et invitaient à casser le pavage.
    // RÉGLAGES DU SOUS-WIDGET AFFICHÉ (04/08, demande user « chaque widget doit pouvoir avoir ses
    // propres réglages ») : dans un panneau à onglets, l'en-tête appartient au PANNEAU — les
    // options du widget de l'onglet n'étaient joignables nulle part. Elles s'ouvrent ici, en tête
    // du panneau, clairement rattachées à l'onglet courant.
    var sectionsBloc = _blocSectionsFor(it, w, false, idx);
    // (Les réglages du widget DANS un onglet ne sont plus ici : le panneau à onglets a SES
    //  réglages — gestion des onglets — et le sous-widget a LES SIENS, ouverts par son propre
    //  engrenage posé à droite de sa barre de titre. Demande user 04/08.)
    // EN-TÊTE FIXE + CROIX (04/08, « je ne peux pas fermer ») : avec une longue liste de sections,
    // le tiroir remplit l'écran et il n'y avait plus de « à côté » où cliquer. La croix reste
    // visible en haut pendant le défilement ; rien à « enregistrer » (chaque clic est persisté),
    // ce que le pied de panneau dit explicitement.
    return _popHead(esc(w.name))
      + '<div class="wdg-pop-d">' + esc(w.desc) + '</div>'
      + _optsHtml(idx, w, it)
      + sectionsBloc
      + onglets
      + actions
      + '<div class="wdg-pop-foot">Modifications enregistrées automatiquement</div>';
  }
  // En-tête commun des panneaux de réglages : titre + croix de fermeture, collé en haut au scroll.
  function _popHead(titre) {
    return '<div class="wdg-pop-head"><span class="wdg-pop-t">' + titre + '</span>'
      + '<button class="wdg-pop-x" title="Fermer les réglages" onclick="DTPWidgets.closePops()">×</button></div>';
  }
  // Panneau de réglages du SOUS-WIDGET affiché dans un panneau à onglets : ses options + ses
  // sections (fil), écrites dans it.tabCfg[index] — indépendant des réglages du panneau.
  function _subPanelHtml(idx, c) {
    var l = activeLayout(); if (!l || !l.items[idx]) return '';
    var it = l.items[idx];
    if (it.w !== 'onglets' || !Array.isArray(it.tabs) || !it.tabs.length) return '';
    var j = Math.min(it._tabAct | 0, it.tabs.length - 1);
    var tw = byId(_tabWid(it, j, c)); if (!tw) return '';
    var ti = _tabItem(it, j, c);
    // Dans un onglet composite, le titre dit DE QUELLE CASE on règle les options : quatre panneaux
    // identiques intitulés « Fil d'actualité » seraient indistinguables.
    var titre = esc(tw.name) + (c == null ? '' : ' · case ' + (c + 1));
    return _popHead(titre)
      + '<div class="wdg-pop-d">' + esc(tw.desc || '') + '</div>'
      + _optsHtml(idx, tw, ti, 'setTabOpt', c)
      + _blocSectionsFor(ti, tw, true, idx, c)
      + '<div class="wdg-pop-foot">Modifications enregistrées automatiquement</div>';
  }
  // Rafraîchit le panneau d'une carte SANS toucher au reste (garde son état ouvert/fermé).
  function _syncPanel(i) {
    var l = activeLayout(); if (!l || !l.items[i]) return;
    var pop = document.getElementById(HOST_ID + '-s' + i), w = byId(l.items[i].w);
    if (pop && w) { pop.innerHTML = _setPanelHtml(i, w, l.items[i]); _wireTabsDnD(pop, i); }
  }
  /* ══ RÉORDONNER UNE LISTE AU POINTEUR — LA SOURIS ET LE DOIGT (29/08) ═══════════════════════════
     Demande utilisateur, capture a l'appui : « Je n'arrive pas a deplacer l'onglet monde vers le
     haut sur mobile ».

     La liste se reordonnait par GLISSER-DEPOSER HTML5 (draggable="true" + dragstart/dragover/drop).
     Ce mecanisme N'EXISTE PAS AU TOUCHER : sur iOS comme sur Android, un doigt pose sur un element
     draggable ne produit JAMAIS dragstart. Le geste n'atteignait donc jamais le code de
     reordonnancement, qui etait par ailleurs juste. Mesure au doigt dans un Chromium tactile :
     zero deplacement, contre un a la souris pour le meme geste.

     ⚠️ ET LE CONTROLE NE POUVAIT PAS LE VOIR. `scripts/onglets-verif.js` ouvrait bien un vrai
     navigateur, mais il FABRIQUAIT les evenements (`new DragEvent('dragstart')` + `dispatchEvent`).
     Un evenement fabrique arrive toujours, que le navigateur l'emette ou non au doigt : le controle
     prouvait le cablage, jamais le geste. Il conduit desormais un VRAI doigt.

     Les evenements POINTEUR couvrent les deux entrees d'un seul jeu d'ecouteurs — c'est deja
     l'idiome du desk pour le zoom vertical des graphiques (`_attachYAxisDragZoom`, charts.js). Trois
     details font toute la difference, et chacun a sa raison :
       · `touch-action: none` sur la poignee (deja pose en CSS) : sans lui, le navigateur prend le
         geste pour un defilement et cesse d'emettre `pointermove` des le premier pixel ;
       · `setPointerCapture` : le doigt qui sort de la poignee — ce qui arrive au premier pixel,
         puisqu'on la quitte pour viser une autre ligne — garde le geste ;
       · un seuil de 4 px avant d'activer : un simple appui reste un appui (il donne le focus a la
         poignee, d'ou les fleches ↑ ↓ au clavier), il ne devient un glissement qu'en bougeant.
     On ne cherche PAS la ligne visee dans `e.target` : avec la capture, la cible reste la poignee.
     C'est `elementFromPoint` qui dit ce qu'il y a sous le doigt. */
  function _glisserPourReordonner(hote, selPoignee, selLigne, attr, deplacer, opts) {
    if (!hote || hote._reordWired) return; hote._reordWired = true;
    opts = opts || {};
    /* ARMEMENT PAR APPUI LONG (option). Sur une POIGNÉE dédiée, partir au 4e pixel est le bon
       comportement : on ne pose pas le doigt sur un ⠿ par hasard. Sur une zone qui sert AUSSI à
       autre chose — l'en-tête d'une carte, qu'on touche pour faire défiler le desk — partir au
       mouvement rendrait le défilement impossible. On attend donc que le doigt insiste. */
    /* ⚠️ L'APPUI LONG NE VAUT QUE POUR LE DOIGT. À la souris, on ne pose pas le curseur sur une
       poignée par hasard : y imposer une demi-seconde d'attente serait une régression pure — et
       c'était bien une régression, le glisser natif partait immédiatement. `pointerType` tranche
       geste par geste : le même code sert les deux entrées sans les confondre. */
    var HOLD = opts.appuiLong | 0;
    var from = null, src = null, actif = false, y0 = 0, minuteur = null, exclus = opts.exclus || null;
    var attente = 0;                                              // délai retenu POUR CE GESTE (0 = immédiat)
    var clear = function () {
      var l2 = hote.querySelectorAll('.wdg-drop-before,.wdg-drop-after,.wdg-reord-src');
      for (var z = 0; z < l2.length; z++) l2[z].classList.remove('wdg-drop-before', 'wdg-drop-after', 'wdg-reord-src');
    };
    /* ⚠️ LÂCHER AU-DESSUS DE LA LISTE VEUT DIRE « EN PREMIER » (29/08, mesuré au doigt sur le desk
       réel). Le volet de réglages laisse 128 px sans aucune ligne au-dessus de la première — le
       titre, la barre d'en-tête. Un doigt qui remonte le dernier onglet « tout en haut » y arrive
       naturellement, et `elementFromPoint` n'y trouve rien : on abandonnait sans rien dire. Le
       geste avait l'air d'échouer alors qu'il avait été compris.
       On borne donc aux extrêmes plutôt que de renoncer — mais SEULEMENT sur demande (`bornes`) et
       SEULEMENT verticalement, hors de la liste : dans une grille de cartes à deux dimensions,
       « la première » ne veut rien dire, et la gouttière entre deux cartes n'est pas un « dehors ».
       Le renoncement, lui, ne disparaît pas : il passe sur Échap, câblé plus bas. */
    var ligneSous = function (x, y) {
      var el = document.elementFromPoint(x, y);
      var l = (el && el.closest) ? el.closest(selLigne) : null;
      if (l || !opts.bornes) return l;
      var toutes = hote.querySelectorAll(selLigne);
      if (!toutes.length) return null;
      var r1 = toutes[0].getBoundingClientRect(), rN = toutes[toutes.length - 1].getBoundingClientRect();
      if (x < Math.min(r1.left, rN.left) - 24 || x > Math.max(r1.right, rN.right) + 24) return null;   // à côté, pas au-dessus
      if (y < r1.top) return toutes[0];
      if (y > rN.bottom) return toutes[toutes.length - 1];
      return null;                                                // entre deux lignes : rien à forcer
    };
    var desarmer = function () { if (minuteur) { clearTimeout(minuteur); minuteur = null; } };
    hote.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button > 0) return;                 // clic droit / molette : pas un déplacement
      var g = e.target.closest && e.target.closest(selPoignee);
      if (g && exclus && e.target.closest(exclus)) g = null;        // un bouton DANS la zone de prise garde son geste
      var l = g && g.closest(selLigne);
      if (l && opts.refuse && opts.refuse(l)) l = null;             // carte verrouillée, ligne unique…
      if (!l) return;
      from = +l.getAttribute(attr); src = l; actif = false; y0 = e.clientY;
      // La capture est posée sur la POIGNÉE : les `pointermove` suivants lui sont livrés, et
      // remontent donc jusqu'à cet hôte délégué même quand le doigt a quitté la ligne d'origine.
      try { g.setPointerCapture(e.pointerId); } catch (_) {}
      attente = (HOLD && e.pointerType !== 'mouse') ? HOLD : 0;
      if (attente) {
        desarmer();
        minuteur = setTimeout(function () {
          minuteur = null;
          if (from == null) return;
          actif = true;
          if (src) src.classList.add('wdg-reord-src');
        }, attente);
      }
    });
    hote.addEventListener('pointermove', function (e) {
      if (from == null) return;
      if (!actif) {
        // Armement par appui long : bouger AVANT la fin du délai annule — c'est un défilement.
        if (attente) { if (Math.abs(e.clientY - y0) > 10) { desarmer(); from = null; src = null; } return; }
        if (Math.abs(e.clientY - y0) < 4) return;                   // encore un appui, pas un glissement
        actif = true;
        if (src) src.classList.add('wdg-reord-src');                // on voit CE QU'ON déplace — indispensable au doigt
      }
      e.preventDefault();
      var row = ligneSous(e.clientX, e.clientY);
      clear();
      if (src) src.classList.add('wdg-reord-src');
      if (!row || +row.getAttribute(attr) === from) return;
      var r = row.getBoundingClientRect();
      row.classList.add((e.clientY - r.top) > r.height / 2 ? 'wdg-drop-after' : 'wdg-drop-before');
    });
    var fin = function (e) {
      desarmer();
      if (from == null) return;
      if (actif) {
        var row = ligneSous(e.clientX, e.clientY);
        if (row) {
          var to = +row.getAttribute(attr), r = row.getBoundingClientRect();
          // Au-dessus de la liste → AVANT la première ; en dessous → APRÈS la dernière. Entre les
          // deux, c'est la moitié de la ligne visée qui décide, comme toujours.
          var cible = (e.clientY < r.top) ? to
                    : (e.clientY > r.bottom) ? to + 1
                    : ((e.clientY - r.top) > r.height / 2 ? to + 1 : to);
          // Retirer la ligne avant de la réinsérer décale d'un cran tout ce qui la suivait.
          if (from < cible) cible--;
          if (cible !== from && cible >= 0) deplacer(from, cible);
        }
      }
      from = null; src = null; actif = false; clear();
    };
    /* ÉCHAP ANNULE. Relâcher hors de la liste ÉTAIT le seul moyen de renoncer à un déplacement
       commencé ; en bornant aux extrêmes, on le supprime. On le remet là où il se trouve toujours. */
    var annuler = function (ev) {
      if (from == null || (ev && ev.key !== 'Escape')) return;
      desarmer(); from = null; src = null; actif = false; clear();
      if (ev) ev.stopPropagation();
    };
    document.addEventListener('keydown', annuler);
    hote.addEventListener('pointerup', fin);
    hote.addEventListener('pointercancel', function () { desarmer(); from = null; src = null; actif = false; clear(); });
    /* ⚠️ AU DOIGT, `preventDefault()` SUR `pointermove` NE RETIENT RIEN. Les événements de pointeur
       issus du tactile sont émis APRÈS que le geste a été attribué au défilement : les annuler là
       n'annule plus rien. Seul un `touchmove` NON PASSIF peut encore le refuser — et on ne le refuse
       QUE pendant un déplacement armé, sinon le desk ne défilerait plus du tout. C'est ce couple qui
       permet à une zone de servir aux deux : on fait défiler en glissant, on déplace en insistant. */
    if (HOLD) hote.addEventListener('touchmove', function (e) { if (actif) e.preventDefault(); }, { passive: false });
    // Un glissement HTML5 qui partirait malgré tout (image, texte sélectionné) volerait le geste au
    // pointeur : Chrome cesse d'émettre `pointermove` dès qu'un drag natif démarre.
    hote.addEventListener('dragstart', function (e) {
      if (from != null && e.preventDefault) e.preventDefault();
    });
  }

  /* Réordonner les ONGLETS. Délégation sur le VOLET, pas sur la liste : le volet survit aux
     re-rendus (innerHTML), la liste non — un écouteur posé sur la liste serait perdu au premier
     déplacement, et le deuxième glissement ne ferait plus rien. D'où aussi le drapeau, qui évite
     d'empiler un écouteur par re-rendu. */
  /* `appuiLong` AU DOIGT, et ce n'est pas du confort. Les poignées forment une colonne quasi
     continue sur le bord GAUCHE du volet — mesurée à 37 px de large sur 77 % de la hauteur de la
     liste, avec 12 px libres entre deux. Un pouce qui descend ce bord pour FAIRE DÉFILER ne peut
     pas la manquer : mesuré, un glissement de 160 px depuis une poignée ne défilait pas d'un pixel
     et RÉORDONNAIT un onglet. Le geste le plus banal cassait la liste.
     `bornes` : lâcher au-dessus de la liste place en premier, au lieu d'abandonner en silence. */
  function _wireTabsDnD(pop, i) {
    _glisserPourReordonner(pop, '.wdg-set-tabgrip', '.wdg-set-tabrow', 'data-j', function (from, to) {
      API.moveTab(i, from, to);
    }, { appuiLong: 450, bornes: true });
  }
  // `setter` (04/08) : « setOpt » par défaut (réglages de la CARTE) — « setTabOpt » pour les
  // réglages du SOUS-WIDGET affiché dans un panneau à onglets, qui a désormais les siens.
  function _optsHtml(idx, w, it, setter, cell) {
    var l = (w && w.opts) || []; if (!l.length) return '';
    var S = setter || 'setOpt', B = (S === 'setTabOpt') ? 'bumpTabOpt' : 'bumpOpt';
    var AC = _argC(cell);   // « ,2 » quand on règle une CASE d'onglet composite, '' sinon
    l = l.filter(function (o) { return !o.cache; });      // réglages rendus par un bloc dédié (ex. sections du fil)
    if (!l.length) return '';
    return '<div class="wdg-set-sep"></div>' + l.map(function (o) {
      var cur = opt(it, w, o.k), ctl;
      if (o.type === 'bascule') {
        ctl = '<button class="wdg-set-sw' + (cur ? ' on' : '') + '" role="switch" aria-checked="' + (!!cur) + '"'
          + ' onclick="DTPWidgets.' + S + '(' + idx + ',\'' + o.k + '\',' + (!cur) + AC + ')"><i></i></button>';
      } else if (o.type === 'nombre') {
        ctl = '<span class="wdg-stepper"><button class="wdg-step" onclick="DTPWidgets.' + B + '(' + idx + ',\'' + o.k + '\',-1' + AC + ')" aria-label="moins">−</button>'
          + '<span class="wdg-step-val">' + esc(String(cur)) + '</span>'
          + '<button class="wdg-step" onclick="DTPWidgets.' + B + '(' + idx + ',\'' + o.k + '\',1' + AC + ')" aria-label="plus">+</button></span>';
      } else if (o.type === 'multi') {
        // Liste à cocher — même grammaire que les sections du fil (.wdg-set-sec). Elle occupe sa
        // PROPRE ligne, pleine largeur : 27 villes en pastilles à droite d'un libellé seraient
        // illisibles. On affiche aussi le compte, sinon on ne sait pas ce qu'on a coché plus bas.
        var sel = {}; (cur || []).forEach(function (x) { sel[x] = 1; });
        return '<div class="wdg-set-sep"></div>'
          + '<div class="wdg-set-tabs-t">' + esc(o.lbl) + ' <b>' + (cur || []).length + '/' + o.choix.length + '</b></div>'
          + '<div class="wdg-set-secs">' + o.choix.map(function (c) {
              return '<button class="wdg-set-sec' + (sel[c[0]] ? ' on' : '') + '"'
                + ' onclick="DTPWidgets.toggleMulti(' + idx + ',\'' + o.k + '\',\'' + esc(String(c[0])) + '\',\'' + S + '\'' + AC + ')">'
                + '<span>' + esc(c[1]) + '</span><i>✓</i></button>';
            }).join('') + '</div>';
      } else {
        // Longue liste (la paire du DMX en a 39) : DEUX COLONNES (18/08, demande user), sinon le
        // panneau se scrolle sans fin. Les listes courtes gardent la rangee en pastilles.
        /* ══ UNE LISTE LONGUE SE CHERCHE, ELLE NE SE PARCOURT PAS (01/09, référence fournie) ══════
           La référence ouvre son panneau de réglages sur un champ « Search symbol… ». Chez nous, le
           sélecteur de paire du graphique compte QUARANTE-DEUX entrées : deux colonnes de pastilles
           qu'il faut balayer à l'œil pour trouver « CAD/CHF ». Un champ de recherche règle cela en
           une frappe, et il ne coûte rien aux listes courtes — il n'apparaît qu'au-delà de quatorze
           entrées, seuil au-dessus duquel le balayage cesse d'être immédiat.
           Le filtre est posé sur le CONTENEUR et non sur une variable : le panneau est reconstruit
           en chaîne à chaque ouverture, un état gardé ailleurs serait perdu au premier re-rendu. */
        var _rech = (o.choix.length > 14)
          ? '<input class="wdg-set-rech" type="search" spellcheck="false" placeholder="Rechercher…"'
            + ' aria-label="Rechercher dans ' + esc(o.lbl) + '" oninput="DTPWidgets.filtrerChoix(this)">'
          : '';
        ctl = '<span class="wdg-set-chipbox">' + _rech
          + '<span class="wdg-set-chips' + (o.choix.length > 10 ? ' wdg-set-chips--long' : '') + '">' + o.choix.map(function (c) {
              return '<button class="wdg-set-chip' + (c[0] === cur ? ' on' : '') + '"'
                + ' onclick="DTPWidgets.' + S + '(' + idx + ',\'' + o.k + '\',\'' + esc(String(c[0])) + '\'' + AC + ')">' + esc(c[1]) + '</button>';
            }).join('') + '</span>'
          + (_rech ? '<span class="wdg-set-vide" hidden>Aucune entrée ne correspond.</span>' : '')
          + '</span>';
      }
      return '<div class="wdg-set-row"><span class="wdg-set-lbl">' + esc(o.lbl) + '</span>' + ctl + '</div>';
    }).join('');
  }
  /* ══ LE TITRE D'UNE CARTE DIT SUR QUOI ELLE PORTE (01/09, référence fournie) ═══════════════════
     La référence écrit « Technical Charts | [EUR/AUD] », « Economic Event Calendar | [14/06/2026 -
     20/06/2026 | Vertical] » : le nom du panneau, puis SON CONTEXTE entre crochets. Chez nous
     l'en-tête ne disait que « GRAPHIQUE ». Sur un desk qui accepte le MÊME widget plusieurs fois —
     deux graphiques, deux tables de probabilités, deux horloges — deux cartes voisines portaient
     donc exactement le même titre, et il fallait ouvrir les réglages de chacune pour savoir
     laquelle montrait quoi. C'est le seul motif de ce badge : distinguer deux cartes du même nom.
     On ne prend que les réglages de type « choix » et au plus DEUX : ce sont eux qui identifient
     (la paire, l'unité de temps, la banque, l'affichage). Une bascule oui/non ou un nombre de
     lignes ne dit pas de quoi parle la carte, et allongerait un en-tête qui doit rester court. */
  function _ctxHead(w, it) {
    var l = (w && w.opts) || [], out = [];
    for (var i = 0; i < l.length && out.length < 2; i++) {
      var o = l[i];
      if (!o || o.type !== 'choix' || o.cache || !o.choix || !o.choix.length) continue;
      var cur = opt(it, w, o.k);
      for (var j = 0; j < o.choix.length; j++) {
        if (String(o.choix[j][0]) === String(cur)) { if (o.choix[j][1]) out.push(String(o.choix[j][1])); break; }
      }
    }
    var t = out.join(' · ');
    return t.length > 34 ? t.slice(0, 33) + '…' : t;
  }

  // Config PROPRE à un onglet (index) d'un panneau à onglets — stockée dans it.tabCfg (whitelistée
  // serveur). Renvoie un pseudo-item {w, cfg} : le sous-widget lit ses réglages par opt() comme
  // n'importe quelle carte, sans savoir qu'il vit dans un onglet.
  // `c` (06/08) = index de CELLULE quand l'onglet est COMPOSITE (plusieurs widgets côte à côte).
  // Omis → comportement d'origine, strictement inchangé : l'onglet porte un seul widget et sa config
  // vit sous la clé numérique. Fourni → l'id vient de la disposition et la config sous « j-c ».
  function _tabItem(it, j, c) {
    var id = (c == null ? ((Array.isArray(it.tabs) ? it.tabs[j] : null) || '') : (_tabCells(it, j)[c] || ''));
    var cfg = (it.tabCfg && it.tabCfg[c == null ? j : (j + '-' + c)]) || undefined;
    /* ⚠️ `save` — LE CHAÎNON QUI MANQUAIT (12/08, bug user « la sauvegarde des paramètres des
       widgets ne fonctionne toujours pas », vérifié sur son compte : `uipref` contenait bien
       `rtab` mais JAMAIS `stfl`/`stfr`).
       Un sous-widget d'onglet LISAIT correctement sa config (c'est tout l'objet de ce pseudo-item),
       mais pour l'ÉCRIRE il appelait `API.setOptQuiet(_hostIdx(host), …)` — or `_hostIdx` lit un
       index dans l'id de l'hôte, et l'hôte d'un onglet est un `<div class="wdgt-mount">` SANS id.
       `_hostIdx` renvoyait donc `null` et l'écriture était purement et simplement sautée : le
       réglage tenait le temps de la session et disparaissait au rechargement. Le fichier
       documentait même la conséquence comme « assumée » (l.65) — elle ne l'est plus.
       Le pseudo-item porte maintenant SON écrivain : le widget appelle `it.save(clé, valeur)` sans
       savoir s'il vit dans une carte ou dans un onglet, et c'est ici qu'on sait où écrire. */
    var idx = _itemIdx(it);
    return {
      w: id, cfg: cfg,
      save: function (k, v) { try { if (idx != null) API.setTabOpt(idx, k, v, c); } catch (e) {} },
    };
  }
  // Index d'une carte dans la disposition active — nécessaire pour écrire depuis un sous-widget,
  // qui ne connaît que son objet et pas sa position.
  function _itemIdx(it) {
    try { var l = activeLayout(); if (!l || !Array.isArray(l.items)) return null;
      var i = l.items.indexOf(it); return i >= 0 ? i : null; } catch (e) { return null; }
  }

  /* ── ONGLETS COMPOSITES (06/08, demande user « quand j'ajoute un nouvel onglet je dois pouvoir
     choisir la disposition ») ────────────────────────────────────────────────────────────────────
     Un onglet peut porter 2 à 4 widgets au lieu d'un seul. Le modèle NE change pas de forme :
     `it.tabs` reste un tableau de CHAÎNES, l'onglet composite y est le sentinel 'grille' (frère de
     'vide'), et la disposition vit dans `it.tabGrid`, tableau parallèle aligné positionnellement —
     même contrat que `it.tabLabels`, donc même whitelist serveur, sans toucher au filtre existant.
       "2c:calendrier-jour|vue-taux"  →  2 colonnes, 2 widgets
       ''  ou absent                  →  onglet simple, exactement comme avant.
     Mettre des OBJETS dans `tabs` aurait été bien plus risqué : le sanitizer les jette, et comme
     tabLabels ET tabCfg y sont conditionnés, un panneau aurait perdu onglets + noms + réglages. */
  var SUBDISPOS = [
    { code: '1',  name: '1 widget plein', n: 1, cells: [{ gw: 12, gh: 14 }] },
    { code: '2c', name: '2 colonnes',     n: 2, cells: _rep(2, 6, 14) },
    { code: '2l', name: '2 lignes',       n: 2, cells: _rep(2, 12, 7) },
    { code: '3c', name: '3 colonnes',     n: 3, cells: _rep(3, 4, 14) },
    { code: '4',  name: '4 cases',        n: 4, cells: _rep(4, 6, 7) },
  ];
  function _dispoByCode(code) { for (var i = 0; i < SUBDISPOS.length; i++) if (SUBDISPOS[i].code === code) return SUBDISPOS[i]; return null; }
  // Codec, dans les deux sens. Le charset est le MÊME que celui du serveur ([a-z0-9|:-]) : ce qu'on
  // écrit ici revient tel quel du KV, sans surprise silencieuse.
  function _gridStr(code, ids) { return String(code) + ':' + (ids || []).map(function (x) { return String(x || 'vide'); }).join('|'); }
  function _gridParse(s) {
    var m = /^([a-z0-9]{1,3}):(.*)$/.exec(String(s || ''));
    if (!m) return null;
    var d = _dispoByCode(m[1]); if (!d) return null;
    var ids = m[2].split('|').slice(0, d.n);
    while (ids.length < d.n) ids.push('vide');            // disposition tronquée en KV → cellules vides, jamais de trou
    return { code: d.code, dispo: d, ids: ids };
  }
  // Id du widget visé : celui de l'onglet (c omis) ou celui d'une cellule. Point de résolution UNIQUE
  // — toutes les API passent par là plutôt que de relire it.tabs[j] à la main.
  function _tabWid(it, j, c) { return (c == null ? ((Array.isArray(it.tabs) ? it.tabs[j] : '') || '') : (_tabCells(it, j)[c] || '')); }
  // Cellule dont le panneau de réglages du sous-widget est ouvert, par index de carte. Volatile :
  // c'est un état d'écran, il n'a rien à faire dans le layout persisté.
  var _ssCell = {};
  // Argument de cellule pour les onclick GÉNÉRÉS. Rend '' pour un onglet simple : les appels
  // existants gardent EXACTEMENT leur signature d'avant, aucune régression possible sur ce chemin.
  function _argC(c) { return (c == null ? '' : ',' + (c | 0)); }
  function _gridOf(it, j) { return (Array.isArray(it.tabGrid) && it.tabGrid[j]) || ''; }
  /* DÉPLACER UN ONGLET (26/08, demande user « met un truc pour déplacer les onglets »).
     ⚠️ SIX STRUCTURES SONT INDEXÉES POSITIONNELLEMENT, sans clé stable : `tabs`, `tabLabels`,
     `tabIcons`, `tabGrid`, les clés de `tabCfg` (« 3 » ou « 3-1 ») et `_tabAct`. En déplacer une
     sans les autres fait glisser le NOM, l'ICÔNE, la DISPOSITION ou les RÉGLAGES sur l'onglet
     voisin — le même piège que `removeTab` a déjà eu à corriger une fois.
     On ne bricole donc pas index par index : on construit LA permutation une seule fois et on
     réindexe tout avec elle. Une structure oubliée se voit alors immédiatement, ici, au lieu de se
     manifester trois onglets plus loin chez le client. */
  function _reordonnerOnglets(it, from, to) {
    if (!it || !Array.isArray(it.tabs)) return false;
    var n = it.tabs.length;
    from = from | 0; to = Math.max(0, Math.min(n - 1, to | 0));
    if (from < 0 || from >= n || from === to) return false;
    var ordre = []; for (var q = 0; q < n; q++) ordre.push(q);
    ordre.splice(to, 0, ordre.splice(from, 1)[0]);          // ordre[nouveau] = ancien
    var vers = {};                                          // ancien → nouveau
    ordre.forEach(function (o, nv) { vers[o] = nv; });
    var reidx = function (arr, def) {
      var out = []; for (var z = 0; z < n; z++) { var v = arr[ordre[z]]; out.push(v === undefined ? def : v); }
      return out;
    };
    it.tabs = reidx(it.tabs, 'vide');
    if (Array.isArray(it.tabLabels)) it.tabLabels = reidx(it.tabLabels, '');
    if (Array.isArray(it.tabIcons))  it.tabIcons  = reidx(it.tabIcons, '');
    if (Array.isArray(it.tabGrid))   it.tabGrid   = reidx(it.tabGrid, '');
    if (it.tabCfg) {
      var tc = {};
      Object.keys(it.tabCfg).forEach(function (k) {
        var m = /^(\d{1,2})(-\d{1,2})?$/.exec(k);
        if (!m) { tc[k] = it.tabCfg[k]; return; }            // clé inconnue : conservée telle quelle
        var o = parseInt(m[1], 10);
        if (!(o in vers)) return;
        tc[vers[o] + (m[2] || '')] = it.tabCfg[k];
      });
      it.tabCfg = tc;
    }
    // L'ONGLET AFFICHÉ SUIT SON CONTENU. Garder l'index brut ferait sauter l'affichage sur le
    // voisin à chaque déplacement : on regarde un onglet, pas une position.
    var act = it._tabAct | 0;
    if (act in vers) it._tabAct = vers[act];
    return true;
  }
  function _estGrille(it, j) { return (Array.isArray(it.tabs) && it.tabs[j] === 'grille') && !!_gridParse(_gridOf(it, j)); }
  function _tabCells(it, j) { var g = _gridParse(_gridOf(it, j)); return g ? g.ids : []; }
  // Écrit disposition ET sentinel DANS LE MÊME save : jamais l'un sans l'autre, sinon un onglet
  // 'grille' sans disposition s'afficherait vide chez le prochain client à le lire.
  function _setGrid(it, j, code, ids) {
    if (!Array.isArray(it.tabGrid)) it.tabGrid = [];
    while (it.tabGrid.length < it.tabs.length) it.tabGrid.push('');
    it.tabGrid[j] = _gridStr(code, ids);
    it.tabs[j] = 'grille';
  }
  function _clearGrid(it, j) {
    it.tabs[j] = 'vide';
    if (Array.isArray(it.tabGrid)) it.tabGrid[j] = '';
  }
  /* ── MENU MAISON des <select> de widgets : le popup NATIF se place mal sous le zoom d'affichage
     (coordonnées non compensées par Chromium) et la charte DTP proscrit les composants natifs. On
     intercepte l'ouverture et on affiche une liste ancrée DANS LA CARTE — même espace de
     coordonnées que le contrôle, donc zoom-sûr par construction. La sélection ré-émet un vrai
     `change` : les écouteurs existants ne bougent pas.
     ══ 02/09, RÉFÉRENCE FOURNIE (« Price Chart Settings ») ═══════════════════════════════════════
     Le sélecteur de paire du GRAPHIQUE y est ajouté (`select.wdg-cdl-sym`), et le menu gagne ce que
     montre la référence : un champ de recherche, des puces de classe d'actif, et un DRAPEAU par
     paire. Ce sélecteur compte quarante-deux entrées — Forex, indices, matières premières — dans
     une liste déroulante d'un seul tenant : trouver CAD/CHF s'y faisait à l'œil, ligne par ligne.
     ⚠️ Le champ de recherche du panneau de réglages (`filtrerChoix`, 01/09) ne pouvait PAS servir
     ici : la paire du graphique est déclarée `cache: true`, elle n'est donc pas rendue par le
     panneau mais par la barre du widget. Deux surfaces distinctes, deux mises en œuvre — c'est le
     défaut relevé à l'audit du 02/09. */
  var _DDM_SEL = 'select.dmx-sort-select, select.wdg-cdl-sym';
  /* Classe d'actif déduite du LIBELLÉ, pas d'une table à tenir à jour : une paire de devises
     s'écrit « XXX/YYY », le reste est nommé. Une table serait en retard du jour où l'on ajoute un
     symbole — le même piège que la liste de mots-clés du classeur de news (31/08). */
  function _ddmClasse(v) {
    if (/^[A-Z]{3}\/[A-Z]{3}$/.test(v)) return 'fx';
    if (/gold|silver|oil|or\b|argent|p[ée]trole|brent|wti|copper|cuivre|gaz/i.test(v)) return 'mp';
    return 'idx';
  }
  var _DDM_CLS = { fx: 'Forex', idx: 'Indices', mp: 'Matières premières' };
  /* Pliage des accents et de la casse : « zurich » doit trouver « Zürich », sinon le champ punit
     exactement la frappe rapide qu'il promet. */
  function _ddmPlie(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function _ddmFiltre(menu) {
    var q = _ddmPlie((menu.querySelector('.wdg-ddm-rech') || {}).value || '').trim();
    var cl = menu.getAttribute('data-cl') || '';
    var n = 0;
    menu.querySelectorAll('.wdg-ddm-it').forEach(function (b) {
      var ok = (!cl || b.getAttribute('data-cl') === cl)
        && (!q || b.getAttribute('data-q').indexOf(q) >= 0);
      b.hidden = !ok; if (ok) n++;
    });
    var vide = menu.querySelector('.wdg-ddm-vide');
    if (vide) vide.hidden = !!n;
  }
  document.addEventListener('mousedown', function (e) {
    var dejaOuvert = document.querySelector('.wdg-ddm');
    var sel = e.target.closest && e.target.closest(_DDM_SEL);
    if (!sel) { if (dejaOuvert && !(e.target.closest && e.target.closest('.wdg-ddm'))) dejaOuvert.remove(); return; }
    e.preventDefault();
    if (dejaOuvert) { dejaOuvert.remove(); return; }
    var carte = sel.closest('.wdg-card') || sel.closest('.home-zone') || sel.parentNode;
    if (!carte) return;
    var menu = document.createElement('div');
    menu.className = 'wdg-ddm';
    var opts = Array.prototype.slice.call(sel.options);
    var drap = (typeof CAL_FLAG === 'function') ? CAL_FLAG : function () { return ''; };
    var classes = {};
    opts.forEach(function (o) { classes[_ddmClasse(o.value)] = 1; });
    // Le champ et les puces n'apparaissent qu'où ils servent : au-dessus de quatorze entrées pour
    // la recherche, et seulement si la liste couvre PLUSIEURS classes pour les puces. Trois options
    // de tri sous un champ de recherche seraient du bruit.
    var _long = opts.length > 14;
    var _cls = Object.keys(classes);
    var tete = '';
    if (_long) {
      tete += '<input class="wdg-ddm-rech" type="search" spellcheck="false" placeholder="Rechercher…" aria-label="Rechercher dans la liste">';
      if (_cls.length > 1) {
        tete += '<div class="wdg-ddm-cls"><button type="button" class="wdg-ddm-cl on" data-cl="">Tout</button>'
          + ['fx', 'idx', 'mp'].filter(function (c) { return classes[c]; }).map(function (c) {
              return '<button type="button" class="wdg-ddm-cl" data-cl="' + c + '">' + _DDM_CLS[c] + '</button>';
            }).join('') + '</div>';
      }
      tete = '<div class="wdg-ddm-head">' + tete + '</div>';
    }
    menu.innerHTML = tete + opts.map(function (o) {
      var v = String(o.value), cl = _ddmClasse(v), fl = '';
      if (cl === 'fx') { var d = v.split('/'); fl = drap(d[0]) + drap(d[1]); }
      return '<button type="button" class="wdg-ddm-it' + (o.selected ? ' on' : '') + '" data-v="' + esc(v) + '"'
        + ' data-cl="' + cl + '" data-q="' + esc(_ddmPlie(v + ' ' + o.textContent)) + '">'
        + '<span class="wdg-ddm-lbl">' + (fl ? '<span class="wdg-ddm-fl">' + fl + '</span>' : '')
        + esc(o.textContent) + '</span>' + (o.selected ? '<span class="wdg-ddm-ck">✓</span>' : '') + '</button>';
    }).join('') + (_long ? '<div class="wdg-ddm-vide" hidden>Aucune entrée ne correspond.</div>' : '');
    if (getComputedStyle(carte).position === 'static') carte.style.position = 'relative';
    // Coordonnées locales : différence de rects VISUELS ÷ zoom (les offsets absolus sont re-multipliés
    // par le zoom au rendu — même piège que le menu des recherches récentes).
    var z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dtp-zoom')) || 1;
    var rs = sel.getBoundingClientRect(), rc = carte.getBoundingClientRect();
    menu.style.top = Math.round((rs.bottom - rc.top) / z + 4) + 'px';
    menu.style.right = Math.round(Math.max(4, (rc.right - rs.right) / z)) + 'px';
    carte.appendChild(menu);
    var champ = menu.querySelector('.wdg-ddm-rech');
    // Focus SYNCHRONE : le mousedown d'ouverture a déjà été annulé (preventDefault), le navigateur
    // ne posera donc pas le focus lui-même. Différé d'un tick, il l'était aussi pour le lecteur —
    // qui voyait un champ de recherche et devait cliquer dedans pour s'en servir.
    if (champ) { try { champ.focus(); } catch (e2) {} }
    menu.addEventListener('mousedown', function (ev) {
      // ⚠️ Le preventDefault n'est PAS global. Posé sur tout le menu, il empêchait le champ de
      // recherche de prendre le focus : on tapait dans le vide. Il ne sert qu'à garder le focus
      // lors d'un clic sur une ENTRÉE ou une PUCE.
      if (ev.target.closest('.wdg-ddm-rech')) { ev.stopPropagation(); return; }
      ev.preventDefault(); ev.stopPropagation();
      var cl = ev.target.closest('.wdg-ddm-cl');
      if (cl) {
        menu.setAttribute('data-cl', cl.getAttribute('data-cl'));
        menu.querySelectorAll('.wdg-ddm-cl').forEach(function (b) { b.classList.toggle('on', b === cl); });
        _ddmFiltre(menu);
        if (champ) { try { champ.focus(); } catch (e3) {} }
        return;
      }
      var it = ev.target.closest('.wdg-ddm-it'); if (!it) return;
      sel.value = it.getAttribute('data-v');
      try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
      menu.remove();
    });
    menu.addEventListener('input', function (ev) {
      if (ev.target.closest('.wdg-ddm-rech')) _ddmFiltre(menu);
    });
    menu.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); menu.remove(); return; }
      // Entrée = prendre la PREMIÈRE entrée encore visible : après trois lettres il n'en reste
      // souvent qu'une, et il serait absurde d'exiger un clic pour la choisir.
      if (ev.key === 'Enter') {
        ev.preventDefault();
        var prem = menu.querySelector('.wdg-ddm-it:not([hidden])'); if (!prem) return;
        sel.value = prem.getAttribute('data-v');
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e4) {}
        menu.remove();
      }
    });
  }, true);
  window.addEventListener('scroll', function () { var m = document.querySelector('.wdg-ddm'); if (m) m.remove(); }, true);

  var _resetArm = null;              // remise à zéro : 1er clic arme, 2e clic exécute (retombe seul)
  var _swapBack = null;                      // dernier remplacement, pour l'annulation
  var _delConfirm = null;                 // id du layout en attente de confirmation de suppression (inline, pas de dialog natif)
  var _peek = null;
  var _newNom = '';                       // nom saisi a l'étape 1 (l'input n'existe plus quand l'étape 2 crée)
  var _icoTab = 'ico';                    // onglet du choix d'icône : 'ico' | 'emo' | 'flag' (volatil)
  var _icoQ = '';                         // recherche dans le choix d'icône (volatile)                       // id du layout dont la miniature est dépliée (accordéon, volatil : un rechargement le referme)
  // Icônes d'en-tête — dessins DTP ORIGINAUX (organisation façon desk pro : info + réglages regroupés) :
  // info = « i » cerclé ; réglages = curseurs d'ajustement.
  var ICO = {
    info: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.7" r="0.7" fill="currentColor" stroke="none"/></svg>',
    // RÉGLAGES = trois curseurs HORIZONTAUX. Les pastilles sont OUVERTES : elles étaient remplies de
    // #0d0e11 en dur (la couleur du fond sombre) et devenaient deux taches noires en thème clair.
    gear: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h4M12 7h8M4 12h10M18 12h2M4 17h6M14 17h6"/><circle cx="10" cy="7" r="1.9"/><circle cx="16" cy="12" r="1.9"/><circle cx="12" cy="17" r="1.9"/></svg>',
    // Point d'interrogation cerclé, au gabarit des autres icônes d'en-tête (13 px, trait 1.7).
    aide: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.6"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/></svg>',
    // ── ICONES D ONGLET (21/08, demande user) : jeu FIXE, choisi dans la config du panneau a onglets
    //    et affiche a cote du nom. Slugs stables (persistes) ; trait fin, style epure, aligne DTP. ──
    _dummy_before_grip: 0,
    grip: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-.5 3"/><path d="M20 5v5h-5"/></svg>',
    // REMPLACER = flèches d'échange VERTICALES. Horizontales, elles se confondaient avec les curseurs
    // des réglages (deux traits couchés côte à côte). L'orientation opposée les sépare d'un coup d'œil.
    swap: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20V5l-3 3M16 4v15l3-3"/></svg>',
    dup: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5H6.5a2 2 0 0 0-2 2v9" stroke-linecap="round"/></svg>',
    expand: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  // Échappe AUSSI les guillemets : le module injecte des valeurs dans des attributs double-quotés
  // (value="…", title="…") → sans ça, un nom de layout importé piégé (`" onfocus=…`) s'exécuterait (revue 23/07).
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // Choix de paires du widget Saisonnalité, dérivés de la SOURCE (_SEASON_PAIRS, charts.js — chargé
  // avant nous) et classés par ordre alphabétique du libellé affiché (AUD/CAD, AUD/CHF, …).
  // Le repli en dur ne sert que si charts.js n'a pas pu s'exécuter.
  // Places du widget Horloge, dérivées du CATALOGUE de app.js (chargé avant nous). Le repli en dur
  // ne sert que si charts/app n'a pas pu s'exécuter — il garde les 5 places d'origine du desk.
  function _villesChoix() {
    if (typeof CLOCK_CATALOG !== 'undefined' && Array.isArray(CLOCK_CATALOG) && CLOCK_CATALOG.length) {
      return CLOCK_CATALOG.map(function (c) { return [c.code, c.city]; });
    }
    return [['LON', 'Londres'], ['NY', 'New York'], ['TKY', 'Tokyo'], ['DXB', 'Dubaï'], ['PAR', 'Paris']];
  }
  function _seasonChoix() {
    var f = (typeof _seasonFmtPair === 'function') ? _seasonFmtPair
      : function (c) { return (c && c.length === 6) ? c.slice(0, 3) + '/' + c.slice(3) : c; };
    var L = (typeof _SEASON_PAIRS !== 'undefined' && Array.isArray(_SEASON_PAIRS) && _SEASON_PAIRS.length)
      ? _SEASON_PAIRS.slice()
      : ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURJPY', 'GBPJPY'];
    L.sort(function (a, b) { return f(a).localeCompare(f(b), 'fr', { numeric: true, sensitivity: 'base' }); });
    return [['', 'Compte']].concat(L.map(function (p) { return [p, f(p)]; }));
  }

  /* ═══ VERDICTS DÉTERMINISTES — FAMILLE SAISONNALITÉ & POSITIONNEMENT (23/08) ══════════════════
     Helpers PURS (aucun DOM) : testables au banc, partagés entre cartes. La courbe et la table
     de saisonnalité lisent la MÊME réponse /api/seasonality — deux copies du verdict auraient
     divergé à la première retouche (c'était déjà le cas des mois : la courbe écrivait « Fevr. »
     sans accent pendant que la table laissait l'anglais « Jan » de la source). */
  // Mois TRADUITS à l'affichage (règle du desk : les valeurs logiques restent, l'affichage est FR).
  var _MOIS_FR = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
  var _MOIS_PLEIN = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  // Signe TOUJOURS écrit : comparer « 0,62 % » à « 0,84 % » sans signe fait relire deux fois.
  function _pctFR(v) { return (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + '%'; }
  /* « d'EUR/USD » mais « de GBP/JPY » — et « de USD » : l'usage FR du COT écrit « de USD »,
     jamais « d'USD », donc U reste hors élision (seule graphie qui couvre paires ET devises). */
  function _dElision(nom) { return (/^[AEIO]/.test(nom) ? 'd\'' : 'de ') + nom; }

  /* Verdict saisonnier du MOIS COURANT — partagé par « Rendement moyen par mois » et la table
     « Saisonnalité ». ⚠️ PIÈGE central (contre-lecture) : pour le mois courant, la colonne de
     l'année en cours est PARTIELLE (le serveur garde le dernier cours vu, pas une fin de mois)
     et le `avg` servi l'INCLUT. La compter dans le rang, la moyenne ou les hausses/baisses
     ferait juger un mois inachevé : on l'EXCLUT de tous les agrégats et on la montre À PART
     (« Août en cours : … »). Retour { txt, sous, etat } en HTML sûr (tout le dynamique passe
     par esc), ou null quand la donnée ne permet pas de conclure — silence honnête, jamais une
     phrase inventée. Les mots directionnels sont des CONSTATS (biais historique), pas des
     conseils : « baissier » qualifie l'historique, on n'écrit jamais « vendez ». */
  function _saisonVerdict(rows, years, symbol) {
    if (!rows || rows.length !== 12) return null;
    var m = new Date().getMonth();
    var iNow = (years || []).indexOf(new Date().getFullYear());
    var tous = (rows[m] && rows[m].vals) || [];
    // Années CLOSES du mois courant : la colonne de l'année en cours est écartée (partielle).
    var clos = [];
    tous.forEach(function (v, i) { if (typeof v === 'number' && isFinite(v) && i !== iNow) clos.push(v); });
    var partiel = (iNow >= 0 && typeof tous[iNow] === 'number' && isFinite(tous[iNow])) ? tous[iNow] : null;
    if (!clos.length) return null;                       // un partiel seul ne fait pas un historique

    var moy = clos.reduce(function (a, b) { return a + b; }, 0) / clos.length;
    var nB = clos.filter(function (v) { return v < 0; }).length;
    var nH = clos.length - nB;
    var nomMois = _MOIS_PLEIN[m], sym = String(symbol || '');
    // Le partiel du mois en cours : la SEULE valeur de la carte qui bouge en journée — montrée
    // en comparatif (face à la moyenne HISTORIQUE, recalculée hors partiel), jamais comptée.
    var pPart = partiel != null
      ? '<span class="est-present">' + esc(nomMois + ' en cours') + '</span> : ' + esc(_pctFR(partiel))
        + ' vs moy. hist. ' + esc(_pctFR(moy)) + '.'
      : '';

    // Moins de 3 années closes : un « biais » sur 1-2 observations serait du bruit présenté en
    // conclusion (même prudence que les dénominateurs minimaux de la vague volatilité).
    if (clos.length < 3) {
      var sN = clos.length > 1 ? 's' : '';
      return { etat: 'partage',
        txt: '<span class="est-present">' + esc(nomMois) + '</span> : ' + clos.length + ' année' + sN
          + ' close' + sN + ' observée' + sN + ' seulement sur ' + esc(sym) + ' : pas de biais saisonnier lisible.',
        sous: pPart };
    }

    /* Biais affirmé SEULEMENT si la moyenne et la majorité des années vont dans le MÊME sens
       (>= 60 % des années closes). Une moyenne positive portée par une seule année exceptionnelle
       contre trois baisses n'est pas un biais : c'est un cas partagé, et on le dit. */
    var majB = moy < 0 && nB / clos.length >= 0.6;
    var majH = moy > 0 && nH / clos.length >= 0.6;
    if (!majB && !majH) {
      return { etat: 'partage',
        txt: '<span class="est-present">' + esc(nomMois) + '</span> : historique partagé sur ' + esc(sym)
          + ' (' + nH + ' hausse' + (nH > 1 ? 's' : '') + ' / ' + nB + ' baisse' + (nB > 1 ? 's' : '')
          + ', moy. ' + esc(_pctFR(moy)) + ') : pas de biais saisonnier net.',
        sous: pPart };
    }

    /* Rang du mois parmi les moyennes de référence : celles des 11 AUTRES mois telles que servies
       (aucune ne porte de partiel — seuls les mois passés de l'année courante y figurent, clos),
       la nôtre RECALCULÉE hors partiel. Rang 1 = « le pire/meilleur mois », sinon « le Ne ». */
    var rang = 1;
    rows.forEach(function (r, i) {
      if (i === m || !r || typeof r.avg !== 'number' || !isFinite(r.avg)) return;
      if (majB ? r.avg < moy : r.avg > moy) rang++;
    });
    var ordinal = rang === 1 ? 'le' : 'le ' + rang + 'e';
    return {
      etat: majB ? 'baissier' : 'haussier',
      txt: '<span class="est-present">' + esc(nomMois) + '</span> est historiquement ' + ordinal + ' '
        + (majB ? 'pire' : 'meilleur') + ' mois ' + esc(_dElision(sym)) + ' : '
        + (majB ? nB : nH) + ' années sur ' + clos.length + ' en '
        + (majB ? '<span class="est-bas">baisse</span>' : '<span class="est-haut">hausse</span>')
        + ' (moy. ' + esc(_pctFR(moy)) + ').',
      sous: 'Biais saisonnier ' + (majB ? '<span class="est-bas">baissier</span>' : '<span class="est-haut">haussier</span>')
        + ' : signal de contexte, pas de timing.' + (pPart ? ' ' + pPart : ''),
    };
  }

  /* Lecture CONTRARIENNE du sentiment retail (« Particuliers par paire »). Seuils fixes :
     >= 75 % d'un côté = lecture marquée, >= 60 % = « plutôt », entre 40 et 60 = partagés.
     La couleur s'INVERSE volontairement : foule acheteuse (vert) = lecture baissière (rouge) —
     c'est tout l'intérêt du sentiment retail, et c'est un constat de positionnement, jamais un
     conseil (« lecture contrarienne » se dit, « vendez » jamais). lng/court arrivent déjà gardés
     (== null → NaN en amont) : NaN ne franchit aucun seuil, le verdict se tait. */
  function _dmxVerdict(lng, court, nomPaire, uniteLbl) {
    if (!isFinite(lng) || !isFinite(court)) return null;
    var ou = ' (' + esc(uniteLbl) + ') : lecture contrarienne ';
    if (lng >= 60) {
      return { etat: 'baissier',
        txt: Math.round(lng) + ' % des particuliers sont <span class="est-haut">acheteurs</span> '
          + esc(_dElision(nomPaire)) + ou
          + (lng >= 75 ? '<span class="est-bas">baissière</span> marquée.' : 'plutôt <span class="est-bas">baissière</span>.'),
        sous: lng >= 75 ? 'La foule très chargée d\'un côté nourrit les mouvements inverses.' : '' };
    }
    if (lng <= 40) {
      return { etat: 'haussier',
        txt: Math.round(court) + ' % des particuliers sont <span class="est-bas">vendeurs</span> '
          + esc(_dElision(nomPaire)) + ou
          + (lng <= 25 ? '<span class="est-haut">haussière</span> marquée.' : 'plutôt <span class="est-haut">haussière</span>.'),
        sous: lng <= 25 ? 'La foule très chargée d\'un côté nourrit les mouvements inverses.' : '' };
    }
    return { etat: 'partage',
      txt: 'Particuliers partagés sur ' + esc(nomPaire) + ' (' + Math.round(lng) + ' % / ' + Math.round(court)
        + ' %) : pas de lecture contrarienne.',
      sous: '' };
  }

  /* Verdict COT (« COT par devise ») : intensité par la part longue recalculée (pS/pL), sens par
     le net. « très majoritairement » >= 75 ou <= 25 · « nettement » >= 60 ou <= 40 · équilibre à
     moins de 3 points de 50 · « légèrement » sinon. netTxt et dateRapport arrivent FORMATÉS
     (enK et la date vivent dans la carte) ; `derived` = ligne USD, agrégat maison : la mention
     vit DANS la phrase (contre-lecture : la note sous le donut ne suffit pas quand le verdict
     au-dessus se lit comme un chiffre du rapport officiel). Pas de tendance multi-semaines :
     /api/cot ne sert qu'UNE semaine par devise, le front n'invente rien. */
  function _cotVerdict(nomFonds, dev, pL, net, netTxt, dateRapport, derived) {
    if (!isFinite(pL) || !isFinite(net)) return null;
    var pLr = Math.round(pL);
    var agr = derived ? ' (agrégat calculé : la CFTC ne publie pas de contrat dollar)' : '';
    var dRap = dateRapport ? ' (rapport du ' + esc(dateRapport) + ')' : '';
    if (Math.abs(pL - 50) < 3) {
      return { etat: 'equilibre',
        txt: 'Les ' + esc(nomFonds) + ' sont <span class="est-neutre">à l\'équilibre</span> sur ' + esc(dev) + agr
          + ' (' + pLr + ' % long, net ' + esc(netTxt) + ')' + dRap + ' : pas de conviction affichée.',
        sous: '' };
    }
    var sensH = net > 0;
    var intens = (pL >= 75 || pL <= 25) ? 'très majoritairement' : (pL >= 60 || pL <= 40) ? 'nettement' : 'légèrement';
    return {
      etat: sensH ? 'acheteur' : 'vendeur',
      txt: 'Les ' + esc(nomFonds) + ' sont ' + intens + ' <span class="' + (sensH ? 'est-haut' : 'est-bas') + '">'
        + (sensH ? 'acheteurs' : 'vendeurs') + ' nets</span> ' + esc(_dElision(dev)) + agr + ' : '
        + pLr + ' % long, net ' + esc(netTxt) + ' contrats' + dRap + '.',
      // Positionnement étiré = constat de saturation, pas une invitation à prendre l'inverse.
      sous: intens === 'très majoritairement' ? 'Positionnement étiré : le carburant pour prolonger le mouvement se raréfie.' : '',
    };
  }
  /* ═══ fin verdicts saisonnalité & positionnement ═══ */

  /* ═══ VERDICTS DÉTERMINISTES — FAMILLE CALENDRIER & SÉRIES (23/08) ════════════════════════════
     Même doctrine que les familles précédentes : helpers PURS (aucun DOM), testables au banc,
     partagés entre le compte à rebours et l'historique d'indicateur. Les valeurs du calendrier
     sont des CHAÎNES formatées ('3.2%', '122K', '-8.0M') : chaque comparaison chiffrée passe par
     le couple lecture (_nombreVal) + garde d'unité (_uniteVal) — Number(null) vaut 0 et
     parseFloat mélangerait des K à des M, deux pièges déjà mordus ailleurs dans le desk. */
  // Suffixe d'unité d'une valeur macro formatée : '122K' → 'K', '3.2%' → '%', '-8.0' → ''.
  function _uniteVal(v) { var m = String(v == null ? '' : v).trim().match(/([KMBT%])\s*$/i); return m ? m[1].toUpperCase() : ''; }
  // Valeur numérique SANS son suffixe. Jamais de conversion d'échelle entre suffixes : l'égalité
  // des unités se vérifie AVANT toute soustraction ou comparaison inter-valeurs.
  function _nombreVal(v) {
    var t = String(v == null ? '' : v).replace(/[^0-9.,+-]/g, '').replace(',', '.');
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }
  // Décimales d'une chaîne formatée ('3.25%' → 2) : l'écart réel-prévision se rend à la précision
  // la plus fine des deux chaînes, jamais avec la traîne binaire d'un flottant (0.20000000000018).
  function _decimalesVal(v) { var m = String(v == null ? '' : v).replace(',', '.').match(/\.(\d+)/); return m ? m[1].length : 0; }
  // Abréviations FR des pays de la zone euro (mêmes libellés que le détail du Radar de Biais —
  // les deux copies d'app.js vivent dans des closures inaccessibles d'ici).
  var _CTRY_ABR = { DE: 'All.', FR: 'Fr.', ES: 'Esp.', IT: 'It.' };

  /* Identité d'un événement du calendrier : titre BRUT + devise + PAYS + même minute. Le titre
     affiché peut avoir été renommé côté serveur (_tvTitle porte alors le brut) : on compare
     toujours le brut. Le PAYS est OBLIGATOIRE dans l'identité (contre-lecture) : la clé serveur
     (_calHistKey) l'intègre précisément parce que « EUR|unemployment rate » fusionnait les
     chômages allemand, espagnol, italien et zone euro — matcher sans lui peut accrocher le réel
     d'un AUTRE pays publié à la même minute. */
  function _rbMemeEvenement(a, b) {
    if (!a || !b) return false;
    return (a._tvTitle || a.title || '') === (b._tvTitle || b.title || '')
      && a.currency === b.currency
      && String(a.ctry || '') === String(b.ctry || '')
      && Math.abs((a.timestamp || 0) - (b.timestamp || 0)) < 60000;
  }

  /* Ligne d'ATTENTE du compte à rebours : le consensus situé face à la publication précédente.
     Licite seulement à unités identiques et valeurs lisibles — sinon chaîne vide (silence
     honnête, jamais de phrase inventée). Le sens est un CONSTAT sur le consensus, pas un
     jugement bon/mauvais : aucune couleur sémantique ici (un chômage « attendu en hausse »
     n'est pas un vert). Retour : texte HTML sûr, '' s'il n'y a rien à dire. */
  function _rbAttente(ev) {
    if (!ev) return '';
    var f = String(ev.forecast == null ? '' : ev.forecast).trim();
    var p = String(ev.previous == null ? '' : ev.previous).trim();
    if (!f || !p) return '';
    var fN = _nombreVal(f), pN = _nombreVal(p);
    if (fN == null || pN == null || _uniteVal(f) !== _uniteVal(p)) return '';
    var sens = fN > pN ? 'consensus en hausse' : fN < pN ? 'consensus en baisse' : 'consensus stable';
    return 'Attendu ' + esc(f) + ' après ' + esc(p) + ' : ' + sens + '.';
  }

  /* Verdict de PUBLICATION du compte à rebours : réel contre attendu, purement factuel.
     - La COULEUR vient de deviationClass (helper global du calendrier : la polarité chômage y est
       déjà inversée) ; les MOTS (« au-dessus / sous le consensus ») viennent de la comparaison
       numérique brute. Un chômage au-dessus du consensus rend donc « au-dessus » EN ROUGE :
       deux informations, deux sources, aucune contradiction.
     - L'ÉCART chiffré exige l'ÉGALITÉ des suffixes (contre-lecture : deviationClass compare des
       parseFloat nus et mélangerait des K à des M). Suffixes différents : la couleur reste, mais
       ni delta ni phrase de sens — les mots n'affirment que le mesuré ; et un « conforme » issu
       d'une égalité inter-unités (3K = 3M pour parseFloat) retombe en neutre sans couleur.
     Retour { txt, cls } (cls '' = pas de prévision comparable), ou null sans réel. */
  function _rbVerdict(ev) {
    if (!ev || ev.actual == null || String(ev.actual).trim() === '') return null;
    var a = String(ev.actual).trim(), f = String(ev.forecast == null ? '' : ev.forecast).trim();
    var aN = _nombreVal(a), fN = f ? _nombreVal(f) : null;
    var cls = '';
    try { cls = (typeof deviationClass === 'function') ? (deviationClass(ev.actual, ev.forecast, ev.title) || '') : ''; } catch (e) { cls = ''; }
    if (!f || aN == null || fN == null || !cls) {
      // Pas de prévision comparable : on publie le chiffre, on ne juge pas — même règle que la
      // cellule du calendrier, qui laisse le réel sans couleur dans ce cas.
      return { txt: 'Publié : ' + esc(a), cls: '' };
    }
    if (_uniteVal(a) !== _uniteVal(f)) {
      return { txt: 'Réel ' + esc(a) + ' vs ' + esc(f) + ' attendu.', cls: cls === 'cv-neu' ? '' : cls };
    }
    if (cls === 'cv-neu') return { txt: 'Réel ' + esc(a) + ', conforme au consensus.', cls: 'cv-neu' };
    var dec = Math.max(_decimalesVal(a), _decimalesVal(f));
    var u = _uniteVal(f);
    var delta = aN - fN;
    // « pt » pour des pourcentages (un écart de % s'exprime en points, jamais en « % de % ») ;
    // un suffixe K/M/B/T se recopie tel quel ; signe toujours écrit, virgule décimale FR.
    var deltaTxt = (delta > 0 ? '+' : '') + delta.toFixed(dec).replace('.', ',') + (u === '%' ? ' pt' : u);
    return {
      txt: 'Réel ' + esc(a) + ' vs ' + esc(f) + ' attendu : '
        + (aN > fN ? 'au-dessus du consensus' : 'sous le consensus') + ' (' + deltaTxt + ').',
      cls: cls,
    };
  }

  /* Verdict de l'« Historique d'un indicateur » : [tendance] · [extrême de la fenêtre] ·
     [surprise de la dernière publication]. Chaque segment a sa garde et se TAIT quand la donnée
     ne le permet pas — jamais de phrase approximative :
     - tendance : variations consécutives de même signe en FIN de série ; un trou (valeur non
       numérique) INTERROMPT le comptage — on ne saute jamais par-dessus une inconnue ;
     - extrême : dernier point face à toutes les valeurs numériques, >= 4 points exigés (« plus
       haut des 3 publications » serait du bruit) et une fenêtre qui bouge réellement (max > min) ;
     - surprise : réel vs prévision de la DERNIÈRE publication (champ forecast des événements
       synthétiques _h, déjà servi par le calendrier), mêmes gardes d'unité que le rebours.
     `seulSurprise` : en mode liste (unités mélangées dans la série), tendance et extrême seraient
     des comparaisons inter-unités — seule la surprise, interne à UNE publication, reste licite.
     Retour { txt } (HTML sûr) ou null quand aucun segment ne peut s'affirmer. */
  function _siVerdict(serie, titre, seulSurprise) {
    if (!serie || serie.length < 2) return null;
    var vals = serie.map(function (p) { return _nombreVal(p.actual); });
    var n = vals.length, segs = [];

    if (!seulSurprise) {
      // ── Tendance. difs[0] = dernière variation, difs[1] = celle d'avant, etc.
      var difs = [];
      for (var i = n - 1; i >= 1; i--) {
        if (typeof vals[i] !== 'number' || typeof vals[i - 1] !== 'number') break;
        difs.push(vals[i] - vals[i - 1]);
      }
      if (difs.length) {
        var d0 = difs[0], k = 1;
        while (k < difs.length && ((d0 > 0 && difs[k] > 0) || (d0 < 0 && difs[k] < 0) || (d0 === 0 && difs[k] === 0))) k++;
        if (d0 === 0) segs.push('stable sur ' + (k + 1) + ' publications');
        else if (k >= 2) segs.push(k + ' ' + (d0 > 0 ? 'hausses' : 'baisses') + ' consécutives');
        else {
          // Variation isolée : si elle CASSE une série d'au moins 2 dans l'autre sens, on le dit.
          var m = 1;
          while (m < difs.length && ((d0 > 0 && difs[m] < 0) || (d0 < 0 && difs[m] > 0))) m++;
          m -= 1;
          if (m >= 2) segs.push(d0 > 0 ? 'première hausse après ' + m + ' baisses' : 'premier repli après ' + m + ' hausses');
          else segs.push(d0 > 0 ? 'en hausse sur la publication précédente' : 'en baisse sur la publication précédente');
        }
      }

      // ── Extrême de la fenêtre.
      var nums = vals.filter(function (v) { return typeof v === 'number'; });
      var vDer = vals[n - 1];
      if (typeof vDer === 'number' && nums.length >= 4) {
        var mx = Math.max.apply(null, nums), mn = Math.min.apply(null, nums);
        if (mx > mn) {
          var ext = vDer >= mx ? 'plus haut' : vDer <= mn ? 'plus bas' : null;
          if (ext) {
            // « depuis mars » : mois de la PREMIÈRE valeur numérique comparée (pas serie[0]
            // aveuglément — une valeur illisible ne participe pas à la comparaison).
            var dep = '';
            for (var j = 0; j < n; j++) {
              if (typeof vals[j] !== 'number') continue;
              try { dep = ' (depuis ' + _MOIS_PLEIN[new Date(serie[j].timestamp).getMonth()].toLowerCase() + ')'; } catch (e) {}
              break;
            }
            segs.push(ext + ' des ' + nums.length + ' publications' + dep);
          }
        }
      }
    }

    // ── Surprise de la dernière publication.
    var der = serie[n - 1];
    var aB = String(der.actual == null ? '' : der.actual).trim();
    var fB = String(der.forecast == null ? '' : der.forecast).trim();
    if (aB && fB && _uniteVal(aB) === _uniteVal(fB)) {
      var aN = _nombreVal(aB), fN = _nombreVal(fB);
      if (aN != null && fN != null) {
        var cls = '';
        try { cls = (typeof deviationClass === 'function') ? (deviationClass(aB, fB, titre) || '') : ''; } catch (e) { cls = ''; }
        if (cls === 'cv-neu') segs.push('réel ' + esc(aB) + ', <span class="cv-neu">conforme au consensus</span>');
        else if (cls) {
          segs.push('réel ' + esc(aB) + ' vs ' + esc(fB) + ' attendu : <span class="' + cls + '">'
            + (aN > fN ? 'au-dessus du consensus' : 'sous le consensus') + '</span>');
        }
      }
    }

    if (!segs.length) return null;
    var txt = segs.join(' · ');
    return { txt: txt.charAt(0).toUpperCase() + txt.slice(1) };
  }
  /* ═══ fin verdicts calendrier & séries ═══ */

  /* ═══ CALCULS DÉTERMINISTES — CORRÉLATIONS, HEURES, SURPRISES, SEMAINE (23/08) ═══════════════
     Quatrième famille de helpers PURS (aucun DOM), testables au banc, même doctrine que les
     trois familles au-dessus : chaque garde a sa raison écrite, et le silence chiffré vaut
     toujours mieux qu'un chiffre approximatif. */

  /* Rendements quotidiens ln(c/c_prev) d'une série D1, indexés par JOUR UTC (clé ISO du jour de
     la bougie d'ARRIVÉE). L'appariement inter-paires se fera par ces clés : deux tableaux Yahoo
     peuvent différer d'une séance (trou de cotation), et un appariement par INDEX décalerait
     toute la corrélation en silence (même piège que l'écart 10a-3m de la courbe des taux).
     _couplesValides écarte les couples séparés d'un trou > 4 jours : un rendement calculé
     par-dessus trois semaines de vide fausserait la matrice sans que rien ne le signale. */
  function _cxRendements(c) {
    var out = {};
    if (!c || c.length < 2) return out;
    _couplesValides(c, 'D1').couples.forEach(function (p) {
      // Un cours nul ou négatif ne se log-transforme pas : le couple est simplement ignoré.
      if (!(p[0].c > 0) || !(p[1].c > 0)) return;
      out[new Date(p[1].t).toISOString().slice(0, 10)] = Math.log(p[1].c / p[0].c);
    });
    return out;
  }

  /* Corrélation de Pearson de deux tableaux alignés. null quand elle n'existe pas : moins de
     2 points, longueurs différentes, ou variance nulle (série constante : division par zéro). */
  function _cxPearson(xs, ys) {
    var n = xs.length;
    if (n < 2 || n !== ys.length) return null;
    var sx = 0, sy = 0, i;
    for (i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    var mx = sx / n, my = sy / n, cov = 0, vx = 0, vy = 0;
    for (i = 0; i < n; i++) {
      var dx = xs[i] - mx, dy = ys[i] - my;
      cov += dx * dy; vx += dx * dx; vy += dy * dy;
    }
    if (!(vx > 0) || !(vy > 0)) return null;
    return cov / Math.sqrt(vx * vy);
  }

  /* r d'un COUPLE de paires : jours communs aux deux dictionnaires de rendements, les 30
     derniers (chaque couple a SA fenêtre : deux paires n'ont pas les mêmes trous). Sous 20
     séances communes, silence chiffré : un r sur 12 points se raconte plus qu'il ne se mesure. */
  var _CX_FEN = 30, _CX_MIN = 20;
  function _cxCouple(mA, mB) {
    var jours = Object.keys(mA).filter(function (j) { return j in mB; }).sort();
    if (jours.length > _CX_FEN) jours = jours.slice(-_CX_FEN);
    if (jours.length < _CX_MIN) return null;
    var r = _cxPearson(jours.map(function (j) { return mA[j]; }), jours.map(function (j) { return mB[j]; }));
    return r == null ? null : { r: r, n: jours.length };
  }

  /* Libellé de session d'une heure de PARIS — table FIXE, jamais déduite des données : le
     verdict de « Volatilité par heure » nomme un créneau, pas une mesure. Les bornes suivent
     l'usage du desk (ouvertures de places à l'heure de Paris, été comme hiver à une heure près). */
  function _vhSession(h) {
    h = ((Math.floor(h) % 24) + 24) % 24;
    if (h >= 22 || h < 6) return 'nuit calme';
    if (h < 7) return 'avant l\'Europe';
    if (h < 10) return 'ouverture Europe';
    if (h < 14) return 'séance européenne';
    if (h < 17) return 'ouverture US';
    return 'après-midi US';
  }

  /* Pic et creux d'un tableau de 24 moyennes horaires (des trous null sont admis : une heure
     jamais cotée n'a pas de moyenne). Gardes : au moins 12 heures documentées (un « pic » sur
     un quart de journée serait du bruit) et une moyenne générale strictement positive. Les
     ratios rapportent chaque extrême à la moyenne des heures documentées : le « 2,1× » du
     verdict. */
  function _vhPicCreux(moy) {
    var tot = 0, n = 0;
    moy.forEach(function (v) { if (typeof v === 'number' && isFinite(v)) { tot += v; n++; } });
    if (n < 12) return null;
    var g = tot / n;
    if (!(g > 0)) return null;
    var pic = -1, creux = -1;
    moy.forEach(function (v, i) {
      if (typeof v !== 'number' || !isFinite(v)) return;
      if (pic < 0 || v > moy[pic]) pic = i;
      if (creux < 0 || v < moy[creux]) creux = i;
    });
    return { pic: pic, creux: creux, moyG: g, rPic: moy[pic] / g, rCreux: moy[creux] / g };
  }

  /* Badge d'une publication pour « Écart au consensus » : mêmes règles que _rbVerdict (le
     rebours), rendues compactes. Le MOT (« au-dessus / en dessous ») vient de la comparaison
     numérique brute, la COULEUR de deviationClass (polarité chômage déjà inversée là-bas) : un
     chômage au-dessus du consensus rend « au-dessus » EN ROUGE, deux informations, deux sources.
     Suffixes différents (3K contre 3M : parseFloat les croirait égaux) : pas de badge du tout.
     `rel` = écart RELATIF au consensus (|delta| / |consensus|), seule grandeur comparable entre
     indicateurs d'unités différentes — c'est elle qui classe « la plus grosse surprise » ; null
     quand le consensus vaut zéro (rien à rapporter). */
  function _ecBadge(ev) {
    if (!ev) return null;
    var a = String(ev.actual == null ? '' : ev.actual).trim();
    var f = String(ev.forecast == null ? '' : ev.forecast).trim();
    if (!a || !f) return null;
    var aN = _nombreVal(a), fN = _nombreVal(f);
    if (aN == null || fN == null || _uniteVal(a) !== _uniteVal(f)) return null;
    var cls = '';
    try { cls = (typeof deviationClass === 'function') ? (deviationClass(a, f, ev.title) || '') : ''; } catch (e) { cls = ''; }
    if (!cls) return null;
    if (cls === 'cv-neu') return { mot: 'conforme', cls: 'cv-neu', sens: 0, delta: '', rel: 0 };
    var dec = Math.max(_decimalesVal(a), _decimalesVal(f));
    var u = _uniteVal(f);
    var delta = aN - fN;
    return {
      mot: aN > fN ? 'au-dessus' : 'en dessous',
      cls: cls,
      sens: aN > fN ? 1 : -1,
      delta: (delta > 0 ? '+' : '') + delta.toFixed(dec).replace('.', ',') + (u === '%' ? ' pt' : u),
      rel: fN !== 0 ? Math.abs(delta / fN) : null,
    };
  }

  // Lundi 00h00 UTC de la semaine d'un instant : même arithmétique que _memeSemaineUTC.
  function _psLundiUTC(ref) {
    var d = new Date(ref == null ? Date.now() : ref);
    var j = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - j);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  /* Variation d'une paire DEPUIS LE LUNDI 00h UTC de la semaine courante : open de la première
     bougie de la semaine → close de la dernière (qui peut être la bougie vive du jour : la
     variation va bien « jusqu'à maintenant »). État 'ouverture' : la seule bougie de la semaine
     est celle d'AUJOURD'HUI, encore ouverte — publier ce chiffre en « performance de la
     semaine » maquillerait une variation de séance en variation hebdo, la carte préfère le
     dire. Le week-end, le lundi calculé est celui de la semaine qui vient de se CLORE : le
     classement reste juste, figé. */
  function _psVarSemaine(c, ref) {
    var lundi = _psLundiUTC(ref);
    var sem = (c || []).filter(function (b) { return b && b.t >= lundi; });
    if (!sem.length) return { pct: null, etat: 'vide' };
    var closes = sem.filter(function (b) { return !_memeJourUTC(b.t, ref); });
    if (!closes.length && _memeJourUTC(sem[0].t, ref)) return { pct: null, etat: 'ouverture' };
    var deb = sem[0].o, fin = sem[sem.length - 1].c;
    if (!(deb > 0) || !isFinite(fin)) return { pct: null, etat: 'vide' };
    return { pct: (fin - deb) / deb * 100, etat: 'ok' };
  }

  /* Classement des 8 devises depuis les 7 paires contre USD. Le sens de cotation s'inverse pour
     les paires en USD/xxx : USD/JPY qui monte, c'est le yen qui BAISSE. L'agrégat USD (le dollar
     n'a pas de paire propre) = moyenne inversée des 7, et il n'est calculé que COMPLET : sur 5
     paires disponibles au lieu de 7, la « moyenne » changerait de définition selon les pannes du
     moment — mieux vaut une ligne absente qu'un agrégat à géométrie variable. */
  var _PS_PAIRES = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD'];
  function _psPerfs(vars) {
    var out = [], usd = [], complet = true;
    _PS_PAIRES.forEach(function (p) {
      var v = vars[p];
      var baseUSD = p.slice(0, 3) === 'USD';
      if (v == null || !isFinite(v)) { complet = false; return; }
      out.push({ dev: baseUSD ? p.slice(4) : p.slice(0, 3), pct: baseUSD ? -v : v, calc: false });
      usd.push(baseUSD ? v : -v);
    });
    if (complet && usd.length === 7) {
      out.push({ dev: 'USD', pct: usd.reduce(function (a, b) { return a + b; }, 0) / 7, calc: true });
    }
    out.sort(function (a, b) { return b.pct - a.pct; });
    return out;
  }
  /* ═══ HORS FOREX : INDICES ET MATIÈRES PREMIÈRES (27/08) ═══════════════════════════════════════
     RETOUR CLIENT, verbatim : « Rajoute les indices et plus de marché avant, que le forex c'est
     frustrant de ouf ». Vérifié avant d'écrire une ligne, et il avait raison au pied de la lettre :
     les QUINZE widgets des rubriques Marchés et Devises sont forex — Carte de chaleur FX, Taux
     croisés, Corrélations des 7 majors, Performance hebdo des 8 devises… Le desk balaie
     l'intégralité du change et rien d'autre.
     ⚠️ ET LA DONNÉE EXISTAIT DÉJÀ. Le serveur sert de vraies bougies pour sept instruments hors
     forex (`_CHART_SYM`), par la MÊME route que les paires — c'est ce qui alimente le sélecteur du
     widget Graphique depuis le 18/08. Il ne manquait donc aucune source : il manquait un endroit
     où les lire ensemble.
     ⚠️ LES NOMS CI-DESSOUS SONT DES CLÉS, PAS DES LIBELLÉS. Ils doivent correspondre au caractère
     près à `_CHART_SYM` dans server.js : une clé inconnue ne lève pas d'erreur, la route rend
     `{ candles: [] }` et la ligne disparaît EN SILENCE. Un banc (scripts/actifs-verif.js) relit la
     vraie table du serveur et refuse le moindre écart. Le libellé français, lui, vit dans `lib`. */
  var _XA_INSTR = [
    { grp: 'Indices',           nom: 'DAX',      lib: 'DAX 40',      lieu: 'Francfort' },
    { grp: 'Indices',           nom: 'S&P 500',  lib: 'S&P 500',     lieu: 'New York' },
    { grp: 'Indices',           nom: 'FTSE',     lib: 'FTSE 100',    lieu: 'Londres' },
    { grp: 'Indices',           nom: 'CAC 40',   lib: 'CAC 40',      lieu: 'Paris' },
    { grp: 'Matières premières', nom: 'Gold',    lib: 'Or',          lieu: 'COMEX' },
    { grp: 'Matières premières', nom: 'Silver',  lib: 'Argent',      lieu: 'COMEX' },
    { grp: 'Matières premières', nom: 'Oil WTI', lib: 'Pétrole WTI', lieu: 'NYMEX' },
  ];
  /* LA DERNIÈRE SÉANCE COTÉE, et pas « aujourd'hui » — la nuance est la raison d'être de cette
     fonction. Ces places n'ouvrent pas aux mêmes heures : quand le S&P cote, Francfort et Paris
     sont fermés depuis des heures ; le week-end, aucune ne cote. Comparer chaque instrument à SA
     clôture précédente donne donc toujours une variation vraie — la séance en cours quand elle est
     ouverte, la dernière close sinon. Prendre « la bougie d'aujourd'hui » aurait rendu une ligne
     vide sur la moitié de la carte selon l'heure à laquelle on la regarde. */
  function _xaSeance(c) {
    var s = (c || []).filter(function (b) { return b && isFinite(b.c) && b.c > 0; });
    if (s.length < 2) return null;
    var fin = s[s.length - 1], avant = s[s.length - 2];
    /* ⚠️ PAS DE SECONDE GARDE « avant.c > 0 » ICI. Elle y était, et le banc a montré qu'elle est
       INATTEIGNABLE : le filtre ci-dessus exige déjà `b.c > 0`, donc `avant` ne peut pas valoir
       zéro à ce point. Une garde qui ne peut jamais se déclencher n'est pas une ceinture, c'est du
       bruit qui fait croire à une protection — et le contrôle qui la « vérifiait » passait au vert
       grâce au filtre, pas grâce à elle. La division est protégée en AMONT, une seule fois. */
    return { pct: (fin.c - avant.c) / avant.c * 100, close: fin.c, t: fin.t };
  }

  /* ═══ fin calculs corrélations, heures, surprises, semaine ═══ */

  function uid() { return 'w' + Math.random().toString(36).slice(2, 9); }
  // ── ÉTATS UNIFORMES DES WIDGETS (28/07) : chargement · vide · erreur ────────────────────────────
  // Une seule grammaire pour les ~30 points de repli du catalogue : icône discrète, message court,
  // et pour l'ERREUR un bouton « Réessayer » qui relance CE widget (l'index se lit sur l'id du
  // conteneur « <host>-b<idx> » → aucun appel à modifier dans les widgets existants).
  var _ICO_ERR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>';
  var _ICO_EMPTY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8.5 4.5v15"/></svg>';
  function _hostIdx(host) { var m = String((host && host.id) || '').match(/-b(\d+)$/); return m ? +m[1] : null; }
  /* ÉCRITURE D'UN RÉGLAGE, D'OÙ QUE VIENNE LE WIDGET (12/08). Une carte porte son index dans l'id
     de son hôte ; un sous-widget d'onglet, lui, est monté dans un <div class="wdgt-mount"> SANS id —
     _hostIdx y renvoyait null et l'écriture était simplement SAUTÉE, en silence. Le réglage tenait
     la session et disparaissait au rechargement : c'est la cause du « la sauvegarde ne fonctionne
     pas » signalé sur Force des Devises, vérifiée sur le compte (uipref contenait rtab mais jamais
     stfl/stfr). Le pseudo-item d'onglet porte maintenant son propre save (cf. _tabItem) : on
     l'utilise en priorité, la carte garde son chemin d'origine. */
  function _ecrisOpt(host, it, k, v) {
    if (it && typeof it.save === 'function') { it.save(k, v); return true; }
    var i = _hostIdx(host);
    if (i != null) { API.setOptQuiet(i, k, v); return true; }
    return false;
  }
  // Bandeau « Annuler » (7 s) — volatil par design : aucune persistance, il disparaît au reload.
  var _undoT = null;
  function _undoOffer(msg, undoFn) {
    var old = document.getElementById('wdg-undo'); if (old) old.remove();
    clearTimeout(_undoT);
    var el = document.createElement('div');
    el.id = 'wdg-undo'; el.className = 'wdg-undo';
    el.innerHTML = '<span class="wdg-undo-t">' + esc(msg) + '</span><button class="wdg-undo-b">Annuler</button>';
    el.querySelector('.wdg-undo-b').addEventListener('click', function () {
      clearTimeout(_undoT); el.remove();
      try { undoFn(); } catch (e) {}
    });
    document.body.appendChild(el);
    _undoT = setTimeout(function () { if (el.parentNode) el.remove(); }, 7000);
  }

  /* ── FRISE DES HORAIRES DE PLACES (17/08/2026) ────────────────────────────────────────────────
     Second affichage du widget « Sessions de marché », au choix dans ses réglages. Là où la carte
     montre OÙ les places sont ouvertes, la frise montre QUAND : une piste de 24 h par place, à
     L'HEURE DU LECTEUR, avec le repère de l'instant présent. C'est la lecture utile dans une carte
     basse, où la carte du monde devient minuscule.

     Tout est calculé des fuseaux : aucun réseau, aucune bibliothèque. Les blocs sont convertis du
     fuseau de la place vers celui du lecteur, et une séance qui enjambe minuit chez lui est coupée
     en deux segments plutôt que d'être repliée n'importe où.

     Couleurs : le vert et le rouge de la charte restent RÉSERVÉS à l'état ouvert/fermé (badge et
     pastille). Les blocs de séance prennent donc des teintes distinctes et sourdes, dont l'or DTP
     pour Londres, afin que la couleur du bloc ne soit jamais lue comme un signal de marché. */
  var _FRISE_PLACES = [
    { nom: 'Sydney',   tz: 'Australia/Sydney',   ouv: 9, fer: 17, ton: '#3b6ea5' },
    { nom: 'Tokyo',    tz: 'Asia/Tokyo',         ouv: 9, fer: 15, ton: '#8c4a5e' },
    { nom: 'Londres',  tz: 'Europe/London',      ouv: 8, fer: 17, ton: '#b8860b' },
    { nom: 'New York', tz: 'America/New_York',   ouv: 9, fer: 17, ton: '#4a7c59' },
  ];

  /** Décalage en heures entre le fuseau d'une place et celui du lecteur (positif = place en avance). */
  function _friseDecalage(tz, now) {
    try {
      var loc = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      var ici = new Date(now.toLocaleString('en-US'));
      return Math.round((loc - ici) / 60000) / 60;
    } catch (e) { return 0; }
  }

  /** État d'une place : ouverte ? et dans combien de temps le prochain basculement. */
  function _friseEtat(p, now) {
    try {
      var loc = new Date(now.toLocaleString('en-US', { timeZone: p.tz }));
      var h = loc.getHours() + loc.getMinutes() / 60, j = loc.getDay();
      if (j >= 1 && j <= 5 && h >= p.ouv && h < p.fer) return { ouvert: true, mins: Math.max(1, Math.round((p.fer - h) * 60)) };
      for (var d = 0; d < 8; d++) {
        var c = new Date(loc); c.setDate(loc.getDate() + d); c.setHours(p.ouv, 0, 0, 0);
        if (c > loc && c.getDay() >= 1 && c.getDay() <= 5) return { ouvert: false, mins: Math.max(1, Math.round((c - loc) / 60000)) };
      }
      return { ouvert: false, mins: 0 };
    } catch (e) { return { ouvert: false, mins: 0 }; }
  }

  /* « 09:30 » : heure de frise a l heure du lecteur, minutes comprises (un fuseau a la demi-heure
     décalerait les plages de trente minutes, l arrondi mentirait). */
  function _friseHF(h) {
    h = ((h % 24) + 24) % 24;
    var H = Math.floor(h), M = Math.round((h - H) * 60);
    if (M === 60) { H = (H + 1) % 24; M = 0; }
    return (H < 10 ? '0' : '') + H + ':' + (M < 10 ? '0' : '') + M;
  }
  function _friseDuree(m) {
    var h = Math.floor(m / 60), mm = m % 60;
    if (h <= 0) return mm + ' min';
    if (h >= 24) return Math.floor(h / 24) + ' j ' + (h % 24) + ' h';
    return h + ' h' + (mm ? ' ' + (mm < 10 ? '0' + mm : mm) : '');
  }

  /** Segments [début, fin] en heures LECTEUR, une séance qui enjambe minuit étant coupée en deux. */
  function _friseSegments(p, now) {
    var dec = _friseDecalage(p.tz, now);
    var a = ((p.ouv - dec) % 24 + 24) % 24;
    var b = ((p.fer - dec) % 24 + 24) % 24;
    return (b > a) ? [[a, b]] : [[a, 24], [0, b]];
  }

  function _friseHeure(now, tz) {
    try { return now.toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  /** Monte la frise dans `host` et rend sa fonction de nettoyage. */
  function _monterFriseSeances(host) {
    // AXE GRADUÉ TOUTES LES TROIS HEURES (référence fournie) : cinq repères ne suffisaient pas à
    // situer une barre à l'œil — entre « 6h » et « 12h » il fallait estimer. Neuf repères donnent
    // la lecture directe.
    var _axe = [0, 3, 6, 9, 12, 15, 18, 21, 24].map(function (h) { return '<span>' + h + 'h</span>'; }).join('');
    host.innerHTML = '<div class="wdg-frise">'
      + '<div class="wdg-frise-head"><span class="live-dot live-dot--small wdg-frise-dot"></span>'
      + '<span class="chart-header-sub wdg-frise-sub"></span></div>'
      + '<div class="wdg-frise-axe">' + _axe + '</div>'
      + '<div class="wdg-frise-corps"></div>'
      + '<div class="wdg-frise-note">Les plages qui se chevauchent sont les heures de plus forte liquidité. Les horaires suivent l\'heure d\'été de chaque place.</div>'
      + '</div>';
    var corps = host.querySelector('.wdg-frise-corps');
    var sub = host.querySelector('.wdg-frise-sub');
    var pastille = host.querySelector('.wdg-frise-dot');

    function dessiner() {
      var now = new Date();
      var maintenant = (now.getHours() + now.getMinutes() / 60) / 24 * 100;
      var ouvertes = [], suivante = null, html = '';
      _FRISE_PLACES.forEach(function (p) {
        var e = _friseEtat(p, now);
        if (e.ouvert) ouvertes.push(p.nom);
        else if (!suivante || e.mins < suivante.mins) suivante = { nom: p.nom, mins: e.mins };
        // L'horaire s'écrit DANS la barre (référence fournie) : à côté, l'œil devait faire
        // l'aller-retour entre un texte à droite et un bloc à gauche pour savoir ce qu'il regardait.
        // Il n'est écrit que dans le segment le PLUS LARGE : une séance coupée par minuit produit
        // deux segments, et répéter l'horaire dans chacun le dédoublerait.
        var _dec = _friseDecalage(p.tz, now);
        var _plage = _friseHF(p.ouv - _dec) + ' - ' + _friseHF(p.fer - _dec);
        var _segs = _friseSegments(p, now);
        var _large = 0;
        _segs.forEach(function (sg, k) { if ((sg[1] - sg[0]) > (_segs[_large][1] - _segs[_large][0])) _large = k; });
        var blocs = _segs.map(function (sg, k) {
          var w = (sg[1] - sg[0]) / 24 * 100;
          // Sous ~14 % de la piste, l'horaire ne tient pas : on le laisse alors à l'en-tête.
          var texte = (k === _large && w >= 14) ? '<b>' + _plage + '</b>' : '';
          return '<span class="wdg-frise-bloc' + (e.ouvert ? ' est-ouvert' : '') + '" style="left:' + (sg[0] / 24 * 100)
            + '%;width:' + w + '%;--frise-ton:' + p.ton + '">' + texte + '</span>';
        }).join('');
        var _horaireDansBarre = _segs.some(function (sg, k) { return k === _large && ((sg[1] - sg[0]) / 24 * 100) >= 14; });
        html += '<div class="wdg-frise-ligne' + (e.ouvert ? ' est-ouvert' : '') + '">'
          + '<div class="wdg-frise-tete">'
          + '<span class="wdg-frise-place"><i></i>' + p.nom + '</span>'
          + '<span class="wdg-frise-reste">' + (e.ouvert ? 'ferme dans ' + _friseDuree(e.mins)
              : (e.mins ? 'ouvre dans ' + _friseDuree(e.mins) : '')) + '</span>'
          // L'horaire ne reste en en-tête que si la barre était trop étroite pour le porter :
          // sinon il serait écrit deux fois sur la même ligne.
          + (_horaireDansBarre ? '' : '<span class="wdg-frise-heures">' + _plage + '</span>')
          + '<span class="wdg-frise-badge">' + (e.ouvert ? 'OUVERT' : 'FERMÉ') + '</span>'
          + '</div>'
          + '<div class="wdg-frise-piste">' + blocs + '</div>'
          + '</div>';
      });
      // UNE SEULE ligne « maintenant », qui TRAVERSE les quatre places au lieu d'un trait par
      // piste : c'est ce qui permet de lire d'un coup quelles séances se chevauchent à cet
      // instant. Son étiquette porte l'heure du lecteur, sans quoi il faudrait la déduire de l'axe.
      var _hNow = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      html += '<span class="wdg-frise-now" style="left:' + maintenant + '%"></span>'
        + '<span class="wdg-frise-nowlbl" style="left:' + maintenant + '%">' + _hNow + '</span>';
      corps.innerHTML = html;
      if (sub) {
        // État porté par une CLASSE et plus par un style inline : l'inline gagnait sur toute règle
        // CSS, le thème clair ne pouvait donc jamais ré-encrer ce texte (audit thème du 18/08).
        // Les couleurs vivent dans style.css (.wdg-frise-sub), aux valeurs sombres d'origine.
        if (ouvertes.length) { sub.textContent = ouvertes.join(' · ') + (ouvertes.length > 1 ? ' ouvertes' : ' ouverte'); sub.classList.add('est-ouvert'); }
        else if (suivante) { sub.textContent = 'Fermé · ' + suivante.nom + ' ouvre dans ' + _friseDuree(suivante.mins); sub.classList.remove('est-ouvert'); }
      }
      if (pastille) pastille.style.background = ouvertes.length ? '#00e676' : '#ff3d00';
    }

    dessiner();
    var iv = setInterval(dessiner, 30000);

    /* PALIERS DE TAILLE (18/08, capture user : carte rétrécie → la 4e séance passait sous le bord,
       avec une barre de défilement). Les règles compactes existaient, mais en @media (max-height),
       qui interroge la FENÊTRE : une carte basse dans une grande fenêtre ne les déclenchait jamais.
       On mesure donc la carte ELLE-MÊME et on pose un palier. Quatre séances doivent tenir sans
       défilement : on resserre l'interligne, on affine la piste, on réduit la typo, et en dernier
       recours on retire l'axe des heures — plutôt une frise lue d'un coup d'œil qu'une frise
       complète et tronquée. */
    var cadre = host.querySelector('.wdg-frise');
    function palier() {
      if (!cadre || !cadre.isConnected) return;
      var h = cadre.clientHeight, w = cadre.clientWidth;
      cadre.classList.toggle('est-moyen', h > 0 && h <= 320);
      cadre.classList.toggle('est-compact', h > 0 && h <= 250);
      cadre.classList.toggle('est-minus', h > 0 && h <= 190);
      cadre.classList.toggle('est-mini', h > 0 && h <= 155);
      cadre.classList.toggle('est-etroit', w > 0 && w <= 460);
    }
    palier();
    var ro = null;
    if (window.ResizeObserver && cadre) { ro = new ResizeObserver(palier); ro.observe(cadre); }

    return function () {
      try { clearInterval(iv); } catch (e) {}
      try { if (ro) ro.disconnect(); } catch (e) {}
    };
  }

  /* Catalogue de paires du réglage « Paire ». Les 72 symboles servis par /api/community-outlook,
     filtrés par la MÊME règle que le desk (_dmxAllowed) : deux devises majeures, ou un métal coté
     contre une majeure. Les exotiques (EURTRY, USDRUB, NOKSEK…) restent hors catalogue, comme dans
     la liste « Aperçu DMX », pour que les deux widgets parlent du même univers. */
  /* ── DONUT PARTAGÉ (18/08) : anneau animé + étiquettes en taille d'écran ─────────────────────
     Factorisé du widget « DMX par paire » quand le « COT par devise » est arrivé : deux widgets, un
     seul donut. Les corps sont ceux éprouvés du DMX (jour entre segments, pousse à la frame
     suivante, étiquettes bornées et JAMAIS posées sur l'anneau). Les TEXTES d'étiquettes sont des
     paramètres : le DMX affiche des pourcentages (sa source n'a pas de volumes), le COT affiche les
     volumes réels de la CFTC. */
        /* SVG carré, arcs seuls : les étiquettes ne vivent PLUS dans le viewBox. Dedans, elles
     grandissaient avec l'anneau (unités du viewBox : ~36 px sur une grande carte) et
     débordaient du cadre (« Acheteurs » coupé au bord, capture user du 18/08). Elles sont
     posées en HTML, en taille d'écran, par poserEtiquettes() sur la même géométrie. */
  /* ── TRACEURS PARTAGÉS (19/08) : courbe et histogramme ────────────────────────────────────────
     Factorisés AVANT d'écrire les widgets qui en ont besoin (obligataire, séries macro, courbe
     saisonnière, cotation unique, distribution des variations) : sans cela, cinq widgets auraient
     produit cinq façons différentes de dessiner la même chose, comme c'était parti pour le donut
     avant qu'on ne le factorise.

     Technique : viewBox fixe + preserveAspectRatio="none" pour que le tracé ÉPOUSE la carte quelle
     que soit sa taille, et vector-effect="non-scaling-stroke" pour que le trait garde son épaisseur
     réelle malgré l'étirement (sans lui, une carte large donne un trait horizontal épais et un trait
     vertical filiforme). Aucune étiquette dans le SVG : elles seraient déformées par le même
     étirement. Les libellés se posent en HTML, en taille d'écran, comme pour le donut.

     Les deux traceurs rendent aussi min/max, pour que l'appelant puisse écrire ses libellés sans
     recalculer l'échelle — et surtout sans risquer une échelle différente de celle du tracé. */
  var _TR_W = 300, _TR_H = 100;

  // Échelle commune : bornes des valeurs + 4 % de marge, jamais un intervalle nul (série plate).
  function _trEchelle(vals, zeroInclus) {
    var v = vals.filter(function (x) { return typeof x === 'number' && isFinite(x); });
    if (!v.length) return null;
    var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v);
    if (zeroInclus) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
    if (mx - mn < 1e-9) { var d = Math.abs(mx) > 1e-9 ? Math.abs(mx) * 0.1 : 1; mn -= d; mx += d; }
    var ampl = mx - mn;
    var typique = Math.max(Math.abs(mx), Math.abs(mn));
    // Marge = 4 % de l ecart, MAIS au moins 60 % de cet ecart quand il est minuscule devant les
    // valeurs elles-memes : les barres restent alors substantielles tout en restant comparables.
    var marge = Math.max(ampl * 0.04, (typique > 0 && ampl < typique * 0.15) ? ampl * 0.6 : 0);
    return { min: mn - marge, max: mx + marge, brutMin: Math.min.apply(null, v), brutMax: Math.max.apply(null, v) };
  }

  /* Courbe. vals = tableau de nombres (les trous `null` coupent le tracé au lieu de le faire
     plonger à zéro : une donnée manquante n'est pas une valeur nulle). */
  function _courbeSvg(vals, o) {
    o = o || {};
    var e = _trEchelle(vals, !!o.zero);
    if (!e) return '';
    var n = vals.length;
    if (n < 2) return '';
    var X = function (i) { return i / (n - 1) * _TR_W; };
    var Y = function (v) { return _TR_H - (v - e.min) / (e.max - e.min) * _TR_H; };

    // Segments continus : chaque suite de valeurs valides devient un tracé distinct.
    var segs = [], cur = [];
    vals.forEach(function (v, i) {
      if (typeof v === 'number' && isFinite(v)) cur.push(X(i).toFixed(2) + ',' + Y(v).toFixed(2));
      else { if (cur.length > 1) segs.push(cur); cur = []; }
    });
    if (cur.length > 1) segs.push(cur);
    if (!segs.length) return '';

    var couleur = o.couleur || 'var(--orange, #e3b23a)';
    var h = '<svg viewBox="0 0 ' + _TR_W + ' ' + _TR_H + '" class="wdg-tr-svg" preserveAspectRatio="none">';
    // Ligne de zéro : seulement si zéro est DANS l'échelle, sinon elle mentirait sur sa position.
    if (o.zero && e.min < 0 && e.max > 0) {
      h += '<line x1="0" y1="' + Y(0).toFixed(2) + '" x2="' + _TR_W + '" y2="' + Y(0).toFixed(2) + '"'
        + ' stroke="var(--hud-line)" stroke-width="1" vector-effect="non-scaling-stroke"></line>';
    }
    if (o.aire) {
      segs.forEach(function (sg) {
        var x0 = sg[0].split(',')[0], x1 = sg[sg.length - 1].split(',')[0];
        h += '<polygon class="wdg-tr-aire" points="' + x0 + ',' + _TR_H + ' ' + sg.join(' ') + ' ' + x1 + ',' + _TR_H + '"'
          + ' fill="' + couleur + '" opacity=".12"></polygon>';
      });
    }
    segs.forEach(function (sg) {
      h += '<polyline class="wdg-tr-ligne" points="' + sg.join(' ') + '" fill="none" stroke="' + couleur + '"'
        + ' stroke-width="' + (o.epaisseur || 1.6) + '" stroke-linejoin="round" stroke-linecap="round"'
        + ' vector-effect="non-scaling-stroke"></polyline>';
    });
    /* o.point : index du PRÉSENT à marquer d'un point or (mois courant de la courbe saisonnière).
       Garde `!= null` : l'index 0 est valide. Seulement si la valeur existe : marquer un trou
       poserait le point sur du vide. Le viewBox étant étiré (preserveAspectRatio none), le point
       rend en légère ellipse — assumé pour un repère de 2,5 unités, comme la barre de zéro. */
    if (o.point != null && typeof vals[o.point] === 'number' && isFinite(vals[o.point])) {
      h += '<circle cx="' + X(o.point).toFixed(2) + '" cy="' + Y(vals[o.point]).toFixed(2) + '" r="2.5"'
        + ' fill="var(--orange, #e3b23a)"></circle>';
    }
    h += '</svg>';
    return h;
  }

  /* Histogramme. Barres colorées par signe si o.signe (vert au-dessus de zéro, rouge en dessous),
     sinon d'une seule couleur. Utilisé par la distribution des variations et les amplitudes. */
  function _barresSvg(vals, o) {
    o = o || {};
    // Le zero n est force que si on le DEMANDE : sur une serie de valeurs proches, l imposer
    // ecrase toute difference et rend les barres indistinguables (constate sur trois taux a 6,8 %).
    var e = _trEchelle(vals, o.zero !== false);
    if (!e || !vals.length) return '';
    var n = vals.length, pas = _TR_W / n;
    // Largeur PLAFONNEE : trois barres ne doivent pas devenir trois paves pleine largeur.
    var large = Math.min(pas * 0.78, o.largeurMax || 1e9);
    var jour = Math.max((pas - large) / 2, Math.min(pas * 0.11, 1.2));
    var Y = function (v) { return _TR_H - (v - e.min) / (e.max - e.min) * _TR_H; };
    var dansEchelle = e.min <= 0 && e.max >= 0;
    var y0 = dansEchelle ? Y(0) : _TR_H;
    var h = '<svg viewBox="0 0 ' + _TR_W + ' ' + _TR_H + '" class="wdg-tr-svg" preserveAspectRatio="none">';
    if (e.min < 0 && e.max > 0) {
      h += '<line x1="0" y1="' + y0.toFixed(2) + '" x2="' + _TR_W + '" y2="' + y0.toFixed(2) + '"'
        + ' stroke="var(--hud-line)" stroke-width="1" vector-effect="non-scaling-stroke"></line>';
    }
    vals.forEach(function (v, i) {
      if (typeof v !== 'number' || !isFinite(v)) return;
      var y = Y(v), haut = Math.min(y, y0), bas = Math.max(y, y0);
      // Une barre de hauteur nulle serait invisible : on lui laisse un filet de 0,6.
      var ht = Math.max(bas - haut, 0.6);
      var col = (o.couleurs && o.couleurs[i]) || (o.signe ? (v >= 0 ? '#00e676' : '#ff3d00') : (o.couleur || 'var(--orange, #e3b23a)'));
      /* o.marque : index du PRÉSENT (mois courant) — liseré or autour de la barre, fill
         sémantique CONSERVÉ (l'or dit « c'est maintenant », le vert/rouge continue de dire le
         signe). Garde `!= null` : l'index 0 (janvier) est valide. */
      var marque = o.marque != null && i === o.marque;
      h += '<rect class="wdg-tr-barre" x="' + (i * pas + jour).toFixed(2) + '" y="' + haut.toFixed(2) + '"'
        + ' width="' + Math.max(pas - 2 * jour, 0.4).toFixed(2) + '" height="' + ht.toFixed(2) + '"'
        + ' fill="' + col + '" opacity="' + (o.opacite || 0.85) + '"'
        + (marque ? ' stroke="var(--orange, #e3b23a)" stroke-width="1" vector-effect="non-scaling-stroke"' : '')
        + '></rect>';
    });
    h += '</svg>';
    return h;
  }

  function _donutSvg(courtPct, longPct) {
    var cx = 80, cy = 80, r = 54, ep = 26, c = 2 * Math.PI * r;
    var pC = Math.max(0, Math.min(100, courtPct)), pL = Math.max(0, Math.min(100, longPct));
    var aC = pC / 100 * c, aL = pL / 100 * c;
    // Jour sombre entre les segments, comme la reference : 1,5 unite retiree de chaque cote
    // de chaque frontiere (le fond noir affleure). Un segment quasi nul garde une longueur
    // >= 0 : jamais de dasharray negatif.
    var G = 1.5;
    var dC = Math.max(0, aC - 2 * G), dL = Math.max(0, aL - 2 * G);
    return '<svg viewBox="0 0 160 160" class="wdg-dmx1-svg" preserveAspectRatio="xMidYMid meet">'
      + '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--hud-line)" stroke-width="' + ep + '"></circle>'
      + '<circle class="wdg-dmx1-arc" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#ff3d00" stroke-width="' + ep + '"'
      + ' stroke-dasharray="0 ' + c + '" stroke-dashoffset="' + (-G) + '" data-fin="' + dC + ' ' + (c - dC) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"></circle>'
      + '<circle class="wdg-dmx1-arc" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#00e676" stroke-width="' + ep + '"'
      + ' stroke-dasharray="0 ' + c + '" stroke-dashoffset="' + (-G) + '" data-fin="' + dL + ' ' + (c - dL) + '" data-dec="' + (-(aC + G)) + '"'
      + ' transform="rotate(-90 ' + cx + ' ' + cy + ')"></circle>'
      + '</svg>';
  }

        /* Étiquettes en HTML, taille d'écran fixe, sur la géométrie de l'anneau : angle médian du
     segment, rayon = bord externe + 8 px d'écran. Bornées dans la zone (une étiquette qui
     sortirait du cadre est ramenée au bord), masquées si le segment est < 3 % ou si la zone
     est trop petite pour les porter (< 150 px de côté utile). Repositionnées par le
     ResizeObserver du widget : la carte est redimensionnable. */
  function _donutEtiquettes(zone, pC, pL, texteC, texteL) {
    zone.querySelectorAll('.wdg-dmx1-lab, .wdg-dmx1-fil').forEach(function (n) { n.remove(); });
    var bw = zone.clientWidth, bh = zone.clientHeight;
    // Le SVG est PLAFONNE a 340 px par le CSS (fidele a la reference, ou le donut garde une
    // taille contenue au centre de la carte) : la geometrie des etiquettes suit le meme plafond (390).
    var cote = Math.min(bw, bh, 390);
    if (cote < 150) return;
    var cx = bw / 2, cy = bh / 2;
    var rBord = (cote / 2) * ((54 + 13) / 80);      // bord externe de l'anneau (viewBox 160, demi 80)
    [[0, pC, texteC], [pC, pL, texteL]]
      .forEach(function (seg) {
        if (seg[1] < 3) return;
        var ang = ((seg[0] + seg[1] / 2) / 100 * 360 - 90) * Math.PI / 180;
        // Trait de rappel incline, comme la reference : 13 px le long de l'angle median.
        var fil = document.createElement('span');
        fil.className = 'wdg-dmx1-fil';
        fil.style.left = (cx + Math.cos(ang) * (rBord + 9)) + 'px';
        fil.style.top = (cy + Math.sin(ang) * (rBord + 9)) + 'px';
        fil.style.transform = 'translate(-50%, -50%) rotate(' + Math.round(ang * 180 / Math.PI) + 'deg)';
        zone.appendChild(fil);
        var x = cx + Math.cos(ang) * (rBord + 17), y = cy + Math.sin(ang) * (rBord + 17);
        var el = document.createElement('span');
        el.className = 'wdg-dmx1-lab';
        el.textContent = seg[2];
        zone.appendChild(el);
        var w = el.offsetWidth, h = el.offsetHeight;
        var gauche = Math.cos(ang) < 0;
        var L2 = gauche ? x - w - 2 : x + 2;
        // Bornage : jamais hors de la zone.
        L2 = Math.max(2, Math.min(bw - w - 2, L2));
        var T2 = Math.max(2, Math.min(bh - h - 2, y - h / 2));
        /* GARANTIE DE NON-CHEVAUCHEMENT (18/08, demande user) : si le bornage a repousse
           l etiquette vers l anneau, elle finirait DESSUS. On mesure la distance du point du
           rectangle le plus proche du centre : sous le bord externe + 3 px, l etiquette est
           MASQUEE (et son fil avec) plutot que posee sur le donut : le pied de carte porte
           deja les memes pourcentages, une etiquette qui chevauche n informe plus, elle salit. */
        var px2 = Math.max(L2, Math.min(cx, L2 + w)), py2 = Math.max(T2, Math.min(cy, T2 + h));
        if (Math.hypot(px2 - cx, py2 - cy) < rBord + 3) { el.remove(); fil.remove(); return; }
        el.style.left = L2 + 'px';
        el.style.top = T2 + 'px';
      });
  }

  var _DMX_PAIRES = [
    // Les 39 symboles que la source publie ET que la règle du desk retient. Générer les
    // combinaisons ferait apparaître des paires inexistantes (JPY/USD, USD/EUR…) dans le réglage.
    'EURUSD', 'EURGBP', 'EURJPY', 'EURCHF', 'EURCAD', 'EURAUD', 'EURNZD',
    'GBPUSD', 'GBPJPY', 'GBPCHF', 'GBPCAD', 'GBPAUD', 'GBPNZD',
    'USDJPY', 'USDCHF', 'USDCAD',
    'AUDUSD', 'AUDJPY', 'AUDCHF', 'AUDCAD', 'AUDNZD',
    'NZDUSD', 'NZDJPY', 'NZDCHF', 'NZDCAD',
    'CADJPY', 'CADCHF', 'CHFJPY',
    'XAUUSD', 'XAUEUR', 'XAUGBP', 'XAUJPY', 'XAUCHF', 'XAUAUD',
    'XAGUSD', 'XAGEUR', 'XAGAUD', 'XPTUSD', 'XPDUSD',
  ];
  var _DMX_METAL_NOM = { XAU: 'Or', XAG: 'Argent', XPT: 'Platine', XPD: 'Palladium' };
  /* Les 28 croisements des huit majeures, au format « EUR/USD » : celui qu attend /api/bank-ohlc
     (sa regex exige la barre oblique). Ne PAS confondre avec _dmxPairesChoix, qui rend le format
     colle « EURUSD » de /api/community-outlook — servir l un a la place de l autre ne renvoie
     rien du tout, en silence. */
  /* ── BRIQUES PARTAGEES DES WIDGETS D AMPLITUDE (19/08) ─────────────────────────────────────
     Factorisees des le deuxieme widget qui en avait besoin : amplitude quotidienne et points
     hauts/bas font exactement les memes trois choses (taille du pip, datation d une bougie,
     appel a /api/bank-ohlc) et divergeraient a la premiere retouche si chacun avait sa copie. */

  /* Taille du pip. AUCUN champ de la source ne la donne : c est une CONVENTION de place, alignee
     sur celle deja en production dans le journal de trading (app.js), inaccessible d ici car
     enfermee dans une closure. A annoncer sur la carte comme une convention de calcul, jamais
     comme une donnee recue. Les instruments non-FX se comptent en POINTS, pas en pips. */
  // Drapeau d'une devise : même source que le reste du desk. Images et non émojis (Windows ne
  // fournit aucun glyphe de drapeau de pays).
  var _DEV_ISO = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', CAD: 'ca', AUD: 'au', NZD: 'nz' };
  function _drapeauDev(code) {
    var iso = _DEV_ISO[code];
    return iso ? '<img class="wdg-td-fl" src="https://flagcdn.com/w20/' + iso + '.png" width="15" height="11" alt="" loading="lazy">' : '';
  }
  function _pipTaille(sym) {
    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(String(sym || ''))) return null;   // non-FX : points
    return /JPY/.test(sym) ? 0.01 : 0.0001;
  }
  /* Deux bougies consecutives dans le TABLEAU ne sont pas forcement consecutives dans le TEMPS :
     une serie peut avoir des trous (jour ferie, incident de collecte, changement de cotation).
     Calculer une variation par-dessus un trou de trois semaines produit un chiffre aberrant qui
     se fond dans la distribution sans que personne ne le voie. On borne donc l ecart admissible.
     Le week-end fait deja un trou LEGITIME de trois jours en journalier : la borne est a quatre.
     Les couples rejetes sont COMPTES, et affiches des qu ils comptent : sinon l echantillon
     annonce serait plus grand que l echantillon reel. */
  /* Heure locale EXACTE d une place, pour un instant donne. On n utilise PAS _friseDecalage ici :
     cette fonction mesure l ecart entre la place et LE LECTEUR, pas entre la place et UTC. S en
     servir pour dater une bougie donnerait un decoupage faux pour tout utilisateur hors du fuseau
     du developpeur, et faux deux fois par an pour les autres (les changements d heure ne tombent
     pas le meme jour a Londres, New York et Tokyo).
     Intl formate l instant DANS le fuseau demande : le passage a l heure d ete est donc traite
     pour la date de CHAQUE bougie, pas pour aujourd hui. */
  var _fmtH = {};
  function _heureLocale(tz, ms) {
    try {
      if (!_fmtH[tz]) _fmtH[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
      var p = _fmtH[tz].formatToParts(new Date(ms));
      var h = 0, mn = 0;
      p.forEach(function (x) { if (x.type === 'hour') h = parseInt(x.value, 10); if (x.type === 'minute') mn = parseInt(x.value, 10); });
      return (h % 24) + mn / 60;
    } catch (e) { return null; }
  }

  /* L unite de temps SERVIE est-elle celle qu on a demandee ? La route accepte un parametre `tf`
     et retombe sur le journalier quand elle ne le reconnait pas : sans ce controle, un widget qui
     croit decouper des bougies horaires decouperait en realite des journees entieres, et publierait
     des amplitudes de seance parfaitement fausses. On mesure l ecart MEDIAN entre deux
     horodatages, la mediane resistant aux trous de week-end. */
  function _pasMedian(c) {
    if (!c || c.length < 5) return null;
    var e = [];
    for (var i = 1; i < c.length; i++) e.push(c[i].t - c[i - 1].t);
    e.sort(function (a, b) { return a - b; });
    return e[Math.floor(e.length / 2)];
  }

  var _ECART_MAX = { D1: 4 * 86400000, W1: 10 * 86400000, H4: 5 * 3600000, H1: 90 * 60000, M15: 25 * 60000 };
  function _couplesValides(c, tf) {
    var max = _ECART_MAX[tf] || _ECART_MAX.D1;
    var ok = [], rejetes = 0;
    for (var i = 1; i < c.length; i++) {
      if (c[i].t - c[i - 1].t <= max) ok.push([c[i - 1], c[i]]);
      else rejetes++;
    }
    return { couples: ok, rejetes: rejetes };
  }

  function _uniteAmpl(sym) { return _pipTaille(sym) ? 'pips' : 'points'; }

  /* État d'une séance rapportée à sa MOYENNE (ratio en %). Amplitude quotidienne et Amplitude par
     séance partagent ces bornes : deux jeux de seuils auraient divergé à la première retouche.
     <60 calme · 60-110 norme · 110-150 nourrie · >150 extrême. Le MOT rendu appartient à chaque
     carte (les phrases diffèrent), l'état non. Jamais de conseil directionnel : l'état dit ce qui
     est PARCOURU, pas où aller. */
  function _ampEtat(ratio) {
    if (!isFinite(ratio)) return null;
    if (ratio < 60) return 'calme';
    if (ratio <= 110) return 'norme';
    if (ratio <= 150) return 'nourrie';
    return 'extreme';
  }

  /* Une bougie est-elle CLOSE ? On ne le deduit JAMAIS de sa position dans le tableau : la
     derniere ligne peut tres bien etre celle de vendredi un dimanche. On compare la date UTC de
     la bougie a celle du jour (et, en hebdomadaire, la semaine). Le libelle en depend : ecrire
     « seance en cours » sur une bougie close serait faux. */
  function _memeJourUTC(t, ref) {
    var a = new Date(t), b = new Date(ref == null ? Date.now() : ref);
    return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
  }
  function _memeSemaineUTC(t, ref) {
    var a = new Date(t), b = new Date(ref == null ? Date.now() : ref);
    var lundi = function (d) { var x = new Date(d); var j = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - j); x.setUTCHours(0, 0, 0, 0); return x.getTime(); };
    return lundi(a) === lundi(b);
  }
  function _dateBougie(t) {
    try { return new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' }); }
    catch (e) { return ''; }
  }

  /* ═══ GRAMMAIRE COMMUNE DE VIE DES WIDGETS (23/08, refonte « statique / on comprend pas ») ═════
     UNE implémentation partagée par les 15 cartes — jamais un helper par widget.
     - _vie(ts) : âge relatif court (« à l'instant », « il y a 4 min »…).
     - _vieSpan(ts) : LE span d'horodatage canonique (classe .wdg-vie, data-ts) ; un SEUL minuteur
       global de 30 s retimbre tous les [data-ts] montés — zéro minuteur par carte, rien à nettoyer.
     - _bougiesMaj(cle) : l'heure de la dernière lecture du cache OHLC partagé (source du ts des
       cartes à bougies ; les réponses qui portent updatedAt/updatedTs l'utilisent directement).
     - _majFlash(el) : LA transition de mise à jour — pose .est-maj sans transition (état initial
       peint), la retire au double requestAnimationFrame ; le RETOUR fait le fondu via la
       transition CSS de la base. Aucune keyframe, jamais de répétition (règle dure du projet :
       pas d'animation clignotante sur un indicateur live). */
  function _vie(ts) {
    var d = Date.now() - (+ts || 0);
    if (!(d >= 0) || !ts) return '';
    if (d < 60e3) return 'à l\'instant';
    if (d < 3600e3) return 'il y a ' + Math.round(d / 60e3) + ' min';
    if (d < 48 * 3600e3) return 'il y a ' + Math.round(d / 3600e3) + ' h';
    return 'il y a ' + Math.round(d / 86400e3) + ' j';
  }
  function _vieSpan(ts) {
    return ts ? '<span class="wdg-vie" data-ts="' + (+ts) + '">' + _vie(ts) + '</span>' : '';
  }
  function _bougiesMaj(cle) { var e = _ohlcCache[cle]; return e && e.t ? e.t : 0; }
  function _majFlash(el) {
    if (!el) return;
    try {
      el.classList.add('est-maj');
      requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.remove('est-maj'); }); });
    } catch (e) {}
  }
  // Retimbrage global : UN minuteur pour toutes les cartes (30 s), ne touche que les spans montés.
  setInterval(function () {
    try {
      document.querySelectorAll('.wdg-vie[data-ts]').forEach(function (s) {
        var t = +s.getAttribute('data-ts'); if (t) s.textContent = _vie(t);
      });
    } catch (e) {}
  }, 30000);

  /* Cache PARTAGE par toutes les cartes (le parametre `cache` reste accepte pour ne rien casser,
     mais n est plus la source de verite). Duree de vie courte : la donnee journaliere ne bouge pas
     souvent, mais une carte ne doit pas rester figee sur une lecture d il y a une heure. */
  var _ohlcCache = Object.create(null);     // cle -> { t: horodatage, c: bougies }
  var _ohlcVol = Object.create(null);       // cle -> promesse EN VOL (deduplication)
  var _OHLC_TTL = 5 * 60 * 1000;

  function _bougiesUn(url) {
    var minute = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('delai')); }, 12000); });
    return Promise.race([
      fetch(url).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }),
      minute,
    ]).then(function (d) {
      // Horodatage filtre EN TETE : une bougie sans date ne peut ni etre datee ni etre exclue.
      var c = ((d && d.candles) || []).filter(function (b) {
        return b && Number.isFinite(b.t) && b.t > 0 && isFinite(b.o) && isFinite(b.h) && isFinite(b.l) && isFinite(b.c);
      });
      /* Un tableau VIDE n est pas un succes : la route rend { candles: [] } quand la source a
         echoue (symbole refuse, Yahoo muet). Le traiter comme une reponse valide graverait l echec
         dans le cache pour cinq minutes. */
      if (!c.length) throw new Error('aucune bougie');
      return c;
    });
  }

  /* Bougies de /api/bank-ohlc.
     ⚠️ LE BUG SIGNALE LE 19/08 (« Bougies indisponibles » sur une carte, definitivement) venait
     d ici. Les journaux de PRODUCTION montrent des echecs PASSAGERS de la source
     (« [YF] session attempt failed ... timeout of 5000ms », « crumb indisponible »), et les widgets
     n avaient NI reessai NI rafraichissement : un incident de quelques secondes restait affiche
     jusqu au remontage de la carte. Trois corrections :
     - cache PARTAGE entre toutes les cartes (et non par carte) : huit cartes qui demandent la meme
       paire ne produisent plus qu UNE requete ;
     - deduplication des requetes EN VOL : deux cartes simultanees attendent la MEME promesse ;
     - UN reessai apres 1,5 s, suffisant pour absorber un incident passager sans aggraver la charge
       quand la source est vraiment tombee. */
  function _bougies(sym, tf, cache) {
    var cle = sym + '|' + tf;
    var hit = _ohlcCache[cle];
    if (hit && Date.now() - hit.t < _OHLC_TTL) return Promise.resolve(hit.c);
    if (_ohlcVol[cle]) return _ohlcVol[cle];

    var estFX = /^[A-Z]{3}\/[A-Z]{3}$/.test(String(sym || ''));
    var url = '/api/bank-ohlc?' + (estFX ? 'pair=' : 'sym=') + encodeURIComponent(sym) + '&tf=' + encodeURIComponent(tf);

    var p = _bougiesUn(url).catch(function () {
      return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return _bougiesUn(url); });
    }).then(function (c) {
      _ohlcCache[cle] = { t: Date.now(), c: c };
      if (cache) cache[cle] = c;              // compatibilite avec les appelants existants
      delete _ohlcVol[cle];
      return c;
    }).catch(function (e) {
      delete _ohlcVol[cle];                   // l echec ne se met PAS en cache : la tentative suivante repart propre
      throw e;
    });
    _ohlcVol[cle] = p;
    return p;
  }

  /* Rafraichissement d une carte a bougies. Sans lui, un echec passager restait AFFICHE jusqu au
     remontage : c est exactement le defaut signale. Ici la carte se repare toute seule au tour
     suivant, et suit la donnee quand elle bouge. On saute le tour quand l onglet est cache :
     inutile de solliciter la source pour une carte que personne ne regarde. */
  function _rafraichirBougies(host, dessiner, ms) {
    var iv = setInterval(function () {
      if (!host || !host.isConnected || document.hidden) return;
      try { dessiner(); } catch (e) {}
    }, ms || 5 * 60 * 1000);
    return function () { try { clearInterval(iv); } catch (e) {} };
  }

  function _fxChoix() {
    var M = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'], out = [], vus = {};
    M.forEach(function (b) { M.forEach(function (q) {
      if (b === q) return;
      var k = b + '/' + q;
      // Un seul sens par croisement : EUR/USD OU USD/EUR, jamais les deux.
      if (!vus[q + '/' + b]) { vus[k] = 1; out.push([k, k]); }
    }); });
    return out;
  }

  function _dmxPairesChoix() {
    return _DMX_PAIRES.map(function (p) {
      var b = p.slice(0, 3), q = p.slice(3);
      var nom = b + '/' + q + (_DMX_METAL_NOM[b] ? ' · ' + _DMX_METAL_NOM[b] : '');
      return [p, nom];
    });
  }

  function fallback(host, msg) {
    if (!host) return;
    var i = _hostIdx(host);
    host.innerHTML = '<div class="wdg-state wdg-state--err">' + _ICO_ERR
      + '<div class="wdg-state-t">' + esc(msg) + '</div>'
      + (i != null ? '<button class="wdg-state-btn" onclick="DTPWidgets.refresh(' + i + ')">Réessayer</button>' : '')
      + '</div>';
  }
  // ÉTAT VIDE : pas une erreur — une action à proposer (le « + » de la bibliothèque, un onglet à créer…).
  function emptyState(host, msg, btnLabel, btnCall) {
    if (!host) return;
    host.innerHTML = '<div class="wdg-state">' + _ICO_EMPTY
      + '<div class="wdg-state-t">' + esc(msg) + '</div>'
      + (btnLabel ? '<button class="wdg-state-btn" onclick="' + btnCall + '">' + esc(btnLabel) + '</button>' : '')
      + '</div>';
  }
  // CHARGEMENT : squelette pulsé (barres) — remplace le texte « Chargement… », qui donnait une
  // impression de page figée. On calibre le nombre de barres sur la hauteur disponible.
  function skel(host, lines) {
    if (!host) return;
    var n = lines || Math.max(3, Math.min(8, Math.round((host.clientHeight || 160) / 34)));
    var b = ''; for (var i = 0; i < n; i++) b += '<span class="wdg-skel-l" style="width:' + (62 + ((i * 37) % 34)) + '%"></span>';
    host.innerHTML = '<div class="wdg-skel" aria-busy="true">' + b + '</div>';
  }

  /* ── COLONNES DU JOURNAL = MIROIR EXACT DU DESK (24/07, demande user « toutes tes colonnes perso »).
     Réplique fidèle de _jrColsFromStore/_jrCell/_jrChip d'app.js (closure inaccessible) → le widget rend
     les MÊMES colonnes que le vrai journal (perso importées ou 21 par défaut), avec les MÊMES cellules
     (chips/rings/progress/badges via les classes GLOBALES jr-chip, jr-cv, jr-ring, jr-prog, jr-pos). */
  var _WJR_DIR_DISP = { BUY: 'Long', SELL: 'Short' };
  var _WJR_COLDEF = [
    { k: 'pair', label: 'Paires', type: 'title', w: 94 }, { k: 'ts', label: 'Date', type: 'date', w: 120 },
    { k: 'result', label: 'Résultat', type: 'select', w: 86 }, { k: 'day', label: 'Jour', type: 'day', w: 100 },
    { k: 'session', label: 'Session', type: 'select', w: 92 }, { k: 'dir', label: 'Direction', type: 'select', w: 92, disp: _WJR_DIR_DISP },
    { k: 'fonda', label: 'Force Fonda', type: 'progress', w: 128, max: 100 }, { k: 'conf', label: 'Confluence', type: 'multi', w: 172 },
    { k: 'tf', label: 'Unité de Temps', type: 'multi', w: 128 }, { k: 'setup', label: 'Setup', type: 'multi', w: 172 },
    { k: 'entryT', label: 'Entrée', type: 'multi', w: 144 }, { k: 'sl', label: 'SL', type: 'multi', w: 124 },
    { k: 'grade', label: 'Note', type: 'ring', w: 74, max: 5 }, { k: 'rr', label: 'Objectif RR', type: 'num', w: 88 },
    { k: 'risk', label: 'Risque %', type: 'num', w: 80, suffix: '%' }, { k: 'r', label: 'R PNL', type: 'num', w: 80, signed: true },
    { k: 'pnlPct', label: '% PNL', type: 'num', w: 82, suffix: '%', signed: true }, { k: 'pl', label: '$PNL', type: 'money', w: 106, signed: true },
    { k: 'equity', label: '$ Capital', type: 'money', w: 124 }, { k: 'err', label: 'ERREUR', type: 'multi', w: 132 },
    { k: 'account', label: 'Compte', type: 'select', w: 124 },
  ];
  var _WJR_BUILTIN = {}; _WJR_COLDEF.forEach(function (c) { _WJR_BUILTIN[c.k] = c; });
  var _WJR_CELLTYPES = ['title', 'date', 'day', 'select', 'multi', 'num', 'money', 'progress', 'ring', 'text'];
  var _WJR_CHIPS = [
    { bg: 'rgba(127,179,255,.15)', fg: '#a8ccff', bd: 'rgba(127,179,255,.32)' }, { bg: 'rgba(255,196,120,.15)', fg: '#ffd093', bd: 'rgba(255,196,120,.32)' },
    { bg: 'rgba(120,230,170,.14)', fg: '#8ef0bd', bd: 'rgba(120,230,170,.30)' }, { bg: 'rgba(255,140,180,.15)', fg: '#ffa6c6', bd: 'rgba(255,140,180,.32)' },
    { bg: 'rgba(186,140,255,.15)', fg: '#ccaaff', bd: 'rgba(186,140,255,.32)' }, { bg: 'rgba(255,168,120,.15)', fg: '#ffba93', bd: 'rgba(255,168,120,.32)' },
    { bg: 'rgba(120,224,224,.14)', fg: '#8fe6e6', bd: 'rgba(120,224,224,.30)' }, { bg: 'rgba(206,220,130,.14)', fg: '#dde88f', bd: 'rgba(206,220,130,.30)' },
    { bg: 'rgba(165,170,190,.14)', fg: '#c2c6d6', bd: 'rgba(165,170,190,.30)' },
  ];
  var _WJR_SEMCOL = {
    result: { profit: '#00e676', tp: '#00cc99', be: '#ffb300', sl: '#ff8f00', loss: '#ff3d00' },
    dir: { buy: '#00e676', long: '#00e676', sell: '#ff3d00', short: '#ff3d00' },
    session: { london: '#7fb3ff', 'new york': '#ffb27f', us: '#ffb27f', asia: '#c5a3ff', sydney: '#8fe6e6' },
  };
  var _WJR_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var _WJR_DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  function _wjrHash(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function _wjrHexChip(hex) { var n = hex.replace('#', ''), r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16), lt = function (c) { return Math.round(c + (255 - c) * 0.58); }; return { bg: 'rgba(' + r + ',' + g + ',' + b + ',.19)', fg: 'rgb(' + lt(r) + ',' + lt(g) + ',' + lt(b) + ')', bd: 'rgba(' + r + ',' + g + ',' + b + ',.42)' }; }
  function _wjrChip(colKey, value) { var sem = _WJR_SEMCOL[colKey] && _WJR_SEMCOL[colKey][String(value).toLowerCase()]; return sem ? _wjrHexChip(sem) : _WJR_CHIPS[_wjrHash(colKey + '|' + value) % _WJR_CHIPS.length]; }
  function _wjrChipHtml(text, c) { return '<span class="jr-chip" style="background:' + c.bg + ';color:' + c.fg + ';border-color:' + c.bd + '">' + esc(text) + '</span>'; }
  function _wjrFmtDateFr(ts) { try { var d = new Date(ts); return d.getDate() + ' ' + _WJR_MONTHS[d.getMonth()] + ' ' + d.getFullYear(); } catch (e) { return '-'; } }
  function _wjrDayEn(ts) { try { return _WJR_DAYS[new Date(ts).getDay()]; } catch (e) { return ''; } }
  function _wjrFmtNum(v, signed) { if (v == null || v === '') return ''; var n = Number(v); if (!isFinite(n)) return esc(String(v)); var s = (Math.round(n * 100) / 100).toString().replace('.', ','); return (signed && n > 0 ? '+' : '') + s; }
  function _wjrRingHtml(val, max) { var f = Math.max(0, Math.min(1, val / (max || 5))), R = 8.5, C = 2 * Math.PI * R, c = f >= 0.8 ? '#00e676' : f >= 0.5 ? '#ffb300' : '#e3b23a'; return '<span class="jr-ring"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="' + R + '" fill="none" stroke="#26262c" stroke-width="2.6"/><circle cx="12" cy="12" r="' + R + '" fill="none" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="' + (f * C).toFixed(2) + ' ' + C.toFixed(2) + '" transform="rotate(-90 12 12)"/></svg><b>' + _wjrFmtNum(val) + '</b></span>'; }
  function _wjrGet(e, col) { return col.builtin ? e[col.k] : (e.props && e.props[col.k]); }
  function _wjrColsFromStore(stored) {
    if (!Array.isArray(stored) || !stored.length) return _WJR_COLDEF.map(function (c) { return Object.assign({}, c, { builtin: true, hidden: false }); });
    var seen = {}, cols = [];
    stored.forEach(function (s) {
      var k = String((s && s.k) || '').slice(0, 32); if (!k || seen[k]) return; seen[k] = 1;
      if (s.builtin !== false && _WJR_BUILTIN[k]) cols.push(Object.assign({}, _WJR_BUILTIN[k], { builtin: true, label: String(s.label || _WJR_BUILTIN[k].label).slice(0, 40), hidden: !!s.hidden }));
      else { var type = _WJR_CELLTYPES.indexOf(s.type) >= 0 ? s.type : 'text'; cols.push({ k: k, label: String(s.label || k).slice(0, 40), type: type, builtin: false, hidden: !!s.hidden, w: Math.max(70, Math.min(280, (+s.w) || 130)) }); }
    });
    if (!cols.some(function (c) { return c.k === 'pair'; })) cols.unshift(Object.assign({}, _WJR_BUILTIN.pair, { builtin: true, hidden: false }));
    return cols;
  }
  function _wjrCell(e, col) {
    var v = _wjrGet(e, col);
    switch (col.type) {
      case 'title': return '<span class="jr-cv-title">' + (e.pair ? esc(e.pair) : '<i class="jr-ph">-</i>') + '</span>'
        + '<button class="jrd-open" data-open="' + esc(e.id || '') + '" title="Ouvrir / modifier ce trade"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5l-5.5 5.5M6.5 13.5h-4v-4M2.5 13.5l5.5-5.5"/></svg><span>OUVRIR</span></button>';
      case 'text': return (v == null || v === '') ? '<i class="jr-ph">-</i>' : '<span class="jr-cv-text">' + esc(v) + '</span>';
      case 'date': { var ts = col.builtin ? e.ts : v; return ts ? '<span class="jr-cv-date">' + _wjrFmtDateFr(ts) + '</span>' : '<i class="jr-ph">-</i>'; }
      case 'day': { var d = e.ts ? _wjrDayEn(e.ts) : ''; return d ? _wjrChipHtml(d, _WJR_CHIPS[8]) : '<i class="jr-ph">-</i>'; }
      case 'select': { if (v == null || v === '') return '<i class="jr-ph">-</i>'; return _wjrChipHtml((col.disp && col.disp[v]) || v, _wjrChip(col.k, v)); }
      case 'multi': { var arr = Array.isArray(v) ? v : (v ? [v] : []); return arr.length ? arr.map(function (x) { return _wjrChipHtml(x, _wjrChip(col.k, x)); }).join('') : '<i class="jr-ph">-</i>'; }
      case 'num': { if (v == null || v === '') return '<i class="jr-ph">-</i>'; var n = Number(v), cls = col.signed ? (n > 0 ? 'jr-pos' : n < 0 ? 'jr-neg' : '') : ''; return '<span class="jr-cv-num ' + cls + '">' + _wjrFmtNum(v, col.signed) + (col.suffix || '') + '</span>'; }
      case 'money': { if (v == null || v === '') return '<i class="jr-ph">-</i>'; var n2 = Number(v), cls2 = col.signed ? (n2 > 0 ? 'jr-pos' : n2 < 0 ? 'jr-neg' : '') : ''; return '<span class="jr-cv-num ' + cls2 + '">' + (col.signed && n2 > 0 ? '+' : '') + n2.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' $</span>'; }
      case 'progress': { if (v == null || v === '') return '<i class="jr-ph">-</i>'; var pct = Math.max(0, Math.min(100, Number(v) / (col.max || 100) * 100)), bc = pct >= 87.5 ? '#00e676' : pct >= 62.5 ? '#ffb300' : '#e3b23a'; return '<div class="jr-prog"><div class="jr-prog-t"><i style="width:' + pct + '%;background:' + bc + '"></i></div><span class="jr-prog-l">' + _wjrFmtNum(v) + '%</span></div>'; }
      case 'ring': return (v == null || v === '') ? '<i class="jr-ph">-</i>' : _wjrRingHtml(Number(v), col.max || 5);
    }
    return '';
  }

  /* ── CATALOGUE ─────────────────────────────────────────────────────────────────────────────────
     mount(host) reçoit un conteneur VIDE et VISIBLE ; il renvoie sa fonction de nettoyage.
     RÈGLE : un widget ne doit JAMAIS écrire un id DOM en dur — il peut vivre en 2 exemplaires. */
  var CATALOG = [
    {
      id: 'graphique', name: 'Graphique', tag: 'CHART', cat: 'Marchés', h: 340,
      desc: 'Le graphique TradingView complet : dessin, indicateurs, toutes les unités.',
      aide: "<p>Un graphique en chandeliers classique : chaque bougie résume une période (ouverture, clôture, extrêmes), la paire se choisit dans la barre de la carte, l'unité de temps dans la barre native du graphique. Les outils de dessin permettent de poser niveaux et lignes de tendance directement sur les cours, et deux cartes peuvent coexister sur des paires différentes.</p><p>Dans une décision, le graphique est le juge de paix du <em>moment</em> : les autres widgets disent le contexte (biais, calendrier, positionnement), lui seul montre où le prix se trouve par rapport aux niveaux où ce contexte peut s'exprimer.</p>",
      src: "Cotations en continu du moteur de graphiques embarqué, sur un fournisseur unique pour toutes les cartes (des CFD : quelques points d'écart avec le comptant sont normaux) ; s'il ne répond pas, le moteur DTP prend le relais avec de vraies bougies.",
      watch: "La réaction du prix aux niveaux travaillés (extrêmes de séance, zones de clôture) et le comportement des bougies autour des heures de publication du calendrier.",
      // Le desk avait ses bougies dans l'onglet MARCHÉS uniquement : impossible de garder un graphique
      // sous les yeux à côté du fil ou du calendrier. Ce widget réutilise le VRAI constructeur du desk
      // (buildStockChart) — mêmes bougies, même thème, même EMA — avec deux réglages qui lui sont
      // PROPRES : sa paire et son unité de temps. Deux exemplaires peuvent coexister sur des paires
      // différentes (le constructeur a été paramétré par conteneur pour ça).
      // `cache: true` sur les deux réglages : ils sont rendus par la barre du widget (sélecteur +
      // boutons d'unité de temps), pas par le panneau de réglages — 40 paires en pastilles y seraient
      // illisibles. Ils restent déclarés ici pour que opt()/la persistance KV fonctionnent.
      opts: [
        { k: 'paire', lbl: 'Paire', type: 'choix', def: 'EUR/USD', cache: true,
          /* TOUTES les paires forex (18/08, demande user : le sélecteur n'offrait que les majeures
             de FX_PAIRS). Le moteur TradingView accepte n'importe quel croisement FX ; les 28
             croisements des 8 majeures passent devant, puis les indices et matières premières du
             desk. Le moteur DTP de repli ne connaît que les paires historiques : sur un croisement
             qu'il ignore il affiche « Graphique indisponible », il n'invente rien. */
          choix: (function () {
            var FX28 = ['EUR/USD', 'EUR/GBP', 'EUR/JPY', 'EUR/CHF', 'EUR/CAD', 'EUR/AUD', 'EUR/NZD',
              'GBP/USD', 'GBP/JPY', 'GBP/CHF', 'GBP/CAD', 'GBP/AUD', 'GBP/NZD',
              'USD/JPY', 'USD/CHF', 'USD/CAD',
              'AUD/USD', 'AUD/JPY', 'AUD/CHF', 'AUD/CAD', 'AUD/NZD',
              'NZD/USD', 'NZD/JPY', 'NZD/CHF', 'NZD/CAD',
              'CAD/JPY', 'CAD/CHF', 'CHF/JPY'];
            try {
              var vus = {}, out = [];
              FX28.forEach(function (n) { vus[n] = 1; out.push([n, n]); });
              [].concat(
                (typeof FX_PAIRS !== 'undefined' ? FX_PAIRS : []),
                (typeof INDICES !== 'undefined' ? INDICES : []),
                (typeof COMMODITIES !== 'undefined' ? COMMODITIES : [])
              ).forEach(function (p) { if (p && p.name && !vus[p.name]) { vus[p.name] = 1; out.push([p.name, p.name]); } });
              return out;
            } catch (e) { return FX28.map(function (n) { return [n, n]; }); }
          })() },
        { k: 'ut', lbl: 'Unité de temps', type: 'choix', def: 'H4', cache: true,
          choix: [['M15', '15 minutes'], ['H1', '1 heure'], ['H4', '4 heures'], ['D1', '1 jour'], ['W1', '1 semaine']] },
      ],
      /* MOTEUR TRADINGVIEW (18/08, décision user après question posée : « Widget TradingView
         embarqué », sa capture montrant les outils de dessin et la barre d'unités natifs).
         CSP vérifiée AVANT d'écrire une ligne : script-src et frame-src autorisent https:, donc le
         script s3.tradingview.com et son iframe passent sans toucher à la sécurité de la page.
         Le moteur DTP (bougies réelles amCharts) N'EST PAS supprimé : il devient le repli
         AUTOMATIQUE quand l'embed ne charge pas (app de bureau hors ligne, réseau d'entreprise qui
         bloque, panne TradingView). Un chien de garde bascule si aucune iframe n'est née en 8 s. */
      mount: function (host, it) {
        var W = this;
        var TF = [['M15', 'M15'], ['H1', 'H1'], ['H4', 'H4'], ['D1', 'D1'], ['W1', 'W1']];
        var paires = (W.opts[0].choix || []).map(function (c) { return c[0]; });
        var sym = opt(it, W, 'paire'); if (paires.indexOf(sym) < 0) sym = paires[0] || 'EUR/USD';
        var ut  = opt(it, W, 'ut');    if (!TF.some(function (t) { return t[0] === ut; })) ut = 'H4';

        // Nom du desk -> symbole TradingView. Les paires FX se derivent (EUR/USD -> FX:EURUSD) ;
        // indices et matieres premieres sont nommes, leur symbole TV ne se devine pas.
        // ⚠️ UN SEUL BROKER PARTOUT : FXCM (prefixe « FX: »), demande utilisateur. On melangeait
        // quatre fournisseurs — XETR, SP, TVC, EURONEXT, OANDA — donc quatre cotations, quatre
        // series d ecarts et quatre calendriers d ouverture dans la meme bibliotheque de widgets.
        // Verifie aupres de la recherche de symboles TradingView : FXCM expose bien GER30, SPX500,
        // UK100, FRA40, XAUUSD, XAGUSD et USOIL. Ce sont des CFD, donc quelques points d ecart avec
        // l indice comptant : c est le prix a payer pour lire toutes les cartes dans la meme unite.
        var _TVSYM = { 'DAX': 'FX:GER30', 'S&P 500': 'FX:SPX500', 'FTSE': 'FX:UK100', 'CAC 40': 'FX:FRA40',
          'Gold': 'FX:XAUUSD', 'Silver': 'FX:XAGUSD', 'Oil WTI': 'FX:USOIL' };
        function tvSym(n) {
          if (_TVSYM[n]) return _TVSYM[n];
          if (n && n.indexOf('/') > 0) return 'FX:' + n.split('/').join('');
          return 'FX:EURUSD';
        }
        var _TVI = { M15: '15', H1: '60', H4: '240', D1: 'D', W1: 'W' };
        var _nettoie = null, _tvTimer = null, _replie = false;

        // ── MOTEUR DTP (repli) : l'ancien widget, conservé tel quel. ──
        function monterDtp() {
        if (typeof buildStockChart !== 'function') { fallback(host, 'Graphique indisponible.'); return null; }
        var id = HOST_ID + '-cdl-' + uid();
        host.innerHTML = '<div class="wdg-cdl">'
          + '<div class="wdg-cdl-bar">'
          +   '<select class="wdg-cdl-sym" aria-label="Choisir la paire">'
          +     paires.map(function (p) { return '<option value="' + esc(p) + '"' + (p === sym ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('')
          +   '</select>'
          +   '<span class="wdg-cdl-tf">'
          +     TF.map(function (t) { return '<button class="stf-btn wdg-cdl-b' + (t[0] === ut ? ' stf-btn--active' : '') + '" data-ut="' + t[0] + '">' + t[1] + '</button>'; }).join('')
          +   '</span>'
          + '</div>'
          + '<div id="' + id + '" class="wdg-cdl-chart"></div></div>';
        function dessine() {
          try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {}
          // buildStockChart est ASYNCHRONE depuis le 15/08 (il va chercher de vraies bougies) : un
          // try/catch synchrone ne verrait plus rien passer. On attrape donc aussi le rejet.
          try {
            var _p = buildStockChart(sym, id, ut);
            if (_p && typeof _p.catch === 'function') _p.catch(function () { fallback(host, 'Graphique indisponible.'); });
          } catch (e) { fallback(host, 'Graphique indisponible.'); }
        }
        var sel = host.querySelector('.wdg-cdl-sym');
        if (sel) sel.addEventListener('change', function () {
          sym = sel.value;
          _ecrisOpt(host, it, 'paire', sym);   // mémorisé sans reconstruire la carte
          dessine();
        });
        host.querySelectorAll('.wdg-cdl-b').forEach(function (b) {
          b.addEventListener('click', function () {
            ut = b.dataset.ut;
            _ecrisOpt(host, it, 'ut', ut);
            host.querySelectorAll('.wdg-cdl-b').forEach(function (x) { x.classList.toggle('stf-btn--active', x === b); });
            dessine();
          });
        });
        // Le conteneur doit avoir une taille avant qu'amCharts ne mesure : on dessine à la frame suivante.
        requestAnimationFrame(dessine);
        return function () { try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {} };
        }

        // ── MOTEUR TRADINGVIEW ──
        function replisDtp() {
          if (_replie || !host.isConnected) return;
          _replie = true;
          clearTimeout(_tvTimer);
          console.warn('[Widget Graphique] TradingView injoignable, repli sur le moteur DTP');
          _nettoie = monterDtp() || null;
        }
        function monterTv() {
          // Notre sélecteur de paire reste LA surface de persistance (le réglage est mémorisé par
          // compte) : allow_symbol_change est donc coupé côté TradingView, une seule autorité.
          // L'unité de temps, elle, se change dans la barre native de TradingView : notre réglage
          // ne fixe que l'unité d'OUVERTURE.
          host.innerHTML = '<div class="wdg-tv">'
            + '<div class="wdg-cdl-bar"><select class="wdg-cdl-sym" aria-label="Choisir la paire">'
            + paires.map(function (p) { return '<option value="' + esc(p) + '"' + (p === sym ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('')
            + '</select></div>'
            + '<div class="wdg-tv-box"><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div></div>'
            + '</div>';
          var boite = host.querySelector('.tradingview-widget-container');
          var sc = document.createElement('script');
          sc.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
          sc.async = true;
          sc.text = JSON.stringify({
            autosize: true, symbol: tvSym(sym), interval: _TVI[ut] || '240',
            timezone: 'Europe/Paris', style: '1', locale: 'fr',
            // Thème lu sur html[data-theme] (source de vérité) : body.theme-light n'est plus posé
            // par personne, l'embed restait sombre sur desk clair (audit du 18/08).
            theme: (document.documentElement.getAttribute('data-theme') === 'light') ? 'light' : 'dark',
            allow_symbol_change: false, save_image: false,
            support_host: 'https://www.tradingview.com',
          });
          sc.onerror = replisDtp;
          boite.appendChild(sc);
          var sel = host.querySelector('.wdg-cdl-sym');
          if (sel) sel.addEventListener('change', function () {
            sym = sel.value;
            _ecrisOpt(host, it, 'paire', sym);
            monterTv();                        // l'embed ne sait pas changer de symbole a chaud : on le remonte
          });
          clearTimeout(_tvTimer);
          _tvTimer = setTimeout(function () {
            if (host.isConnected && !host.querySelector('iframe')) replisDtp();
          }, 8000);
          _nettoie = function () { clearTimeout(_tvTimer); };
        }
        monterTv();
        return function () { clearTimeout(_tvTimer); if (_nettoie) { try { _nettoie(); } catch (e) {} } };
      },
    },
    {
      id: 'force-devises', name: 'Force des Devises', tag: 'FORCE', cat: 'Devises', h: 300,
      desc: 'Qui mène, qui décroche : un panneau, la période de ton choix.',
      aide: "<p>Chaque courbe est une devise, mesurée contre l'ensemble des autres sur la période choisie. Ce qui compte n'est pas le niveau absolu d'une courbe mais leur <strong>ordre relatif</strong> : la devise la plus haute est celle que le marché a le plus recherchée, la plus basse celle qu'il a le plus vendue.</p><p>Le zéro sépare simplement ce qui s'apprécie de ce qui se déprécie sur la fenêtre. Un écartement croissant entre deux courbes signale une tendance qui se construit sur la paire correspondante ; un resserrement, une tendance qui s'épuise.</p>",
      src: "La force des huit majeures est calculée en continu côté serveur à partir de leurs croisements ; la carte se redessine toutes les 60 secondes tant qu'elle est visible, une cadence adaptée à une courbe qui se lit sur des heures.",
      watch: "L'écartement croissant entre deux courbes, qui désigne la paire où une tendance se construit, et les croisements de courbes : c'est la hiérarchie des devises qui tourne.",
      // UN SEUL panneau (demande user 01/08). Le double TD | TW venait de l'onglet › FORCE du desk,
      // qui a la largeur pour ça ; dans une carte de tableau de bord il donnait deux demi-graphes
      // illisibles. La barre de périodes reprend celle du desk (mêmes libellés, mêmes classes
      // `.stf-btn`) et le choix est PERSISTÉ : le widget est sa propre source de réglage.
      opts: [
        { k: 'periodes', lbl: 'Période', type: 'choix', def: 'today',
          choix: [['today', 'TD · séance'], ['week', 'TW · semaine'], ['8h', '8 heures'], ['1d', '1 jour'], ['7d', '7 jours'], ['1m', '1 mois']] },
        { k: 'focus', lbl: 'Devise', type: 'choix', def: '',
          choix: [['', 'Toutes'], ['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['JPY', 'JPY'], ['CHF', 'CHF'], ['CAD', 'CAD'], ['AUD', 'AUD'], ['NZD', 'NZD']] },
        // Étiquettes de bout de courbe : avec ou sans le code de la devise. Sans lui, la valeur
        // reprend la couleur PLEINE de la courbe — c'est alors elle seule qui désigne la devise, la
        // légende du haut restant la table de correspondance. La gouttière se resserre d'autant,
        // ce qui rend de la largeur au tracé.
        { k: 'valeurs', lbl: 'Valeur sur les étiquettes', type: 'bascule', def: false },
      ],
      mount: function (host, it) {
        var W = this;
        if (typeof buildIsolatedStrength !== 'function') { fallback(host, 'Force des Devises indisponible.'); return null; }
        var TF = [['today', 'TD'], ['week', 'TW'], ['8h', '8H'], ['1d', '1D'], ['7d', '7D'], ['1m', '1M']];
        // Anciennes valeurs ('auto'/'both') : elles désignaient le double panneau, qui n'existe plus.
        // On retombe sur la séance — le réglage enregistré ne casse pas le widget.
        var per = opt(it, W, 'periodes'); if (!TF.some(function (t) { return t[0] === per; })) per = 'today';
        var foc = opt(it, W, 'focus') || null;
        var id = HOST_ID + '-fx-' + uid();
        // NOM DU WIDGET dans la barre de périodes (04/08 : « il manque le nom du widget ») — comme
        // l'onglet › FORCE du desk qui porte « Force des Devises » à gauche de ses périodes. Il ne
        // s'affiche que si la barre RESTE dans le corps (panneau à onglets) : quand elle monte dans
        // l'en-tête de la carte, le titre y est déjà — le doublon serait laid (cf. CSS --head).
        host.innerHTML = '<div class="wdg-fx-solo">'
          + '<div class="wdg-fx-tfbar"><span class="wdg-fx-lbl">' + esc(W.name) + '</span>'
          + TF.map(function (t) {
              return '<button class="stf-btn wdg-fx-tf' + (t[0] === per ? ' stf-btn--active' : '') + '" data-per="' + t[0] + '">' + t[1] + '</button>';
            }).join('') + '</div>'
          + '<div id="' + id + '" class="wdg-fx-chart"></div></div>';
        function dessine(p) {
          try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {}
          try { buildIsolatedStrength(id, foc, p, { avecValeur: !!opt(it, W, 'valeurs') }); }
          catch (e) { fallback(host, 'Force des Devises indisponible.'); }
        }
        // La barre rejoint l'EN-TÊTE du widget (titre à gauche, périodes à droite) comme sur le desk.
        var _carte = host.closest ? host.closest('.wdg-card') : null;
        // PANNEAU À ONGLETS : son en-tête est un CALQUE flottant (position absolute, pointer-events
        // none) posé PAR-DESSUS la barre d'onglets. Y déplacer la barre de périodes l'imprimait sans
        // fond sur les libellés MONDE/RISQUE/FORCE… et ses boutons étaient morts (le pointer-events
        // n'est rétabli que sur grip et actions). Mesuré par l'audit : à 375px la barre recouvrait
        // 4 onglets. Dans ce cas, la barre reste dans le corps du widget.
        if (_carte && _carte.classList.contains('wdg-card--tabs')) _carte = null;
        var _tete = _carte ? _carte.querySelector('.wdg-head') : null;
        // ACCUEIL (03/08, demande user « même panneau que le desk officiel ») : les panneaux de
        // l'accueil portent désormais un en-tête façon desk (.home-panel-head) → la barre de
        // périodes y monte aussi, au lieu de rester sur sa propre rangée dans le corps.
        if (!_tete && host.closest) {
          var _zone = host.closest('.home-zone');
          _tete = _zone ? _zone.querySelector('.home-panel-head') : null;
        }
        var _barre = host.querySelector('.wdg-fx-tfbar');
        if (_tete && _barre) {
          _barre.classList.add('wdg-fx-tfbar--head');
          var _act = _tete.querySelector('.wdg-actions');
          if (_act) _tete.insertBefore(_barre, _act); else _tete.appendChild(_barre);
        }
        dessine(per);
        host.querySelectorAll('.wdg-fx-tf').forEach(function (btn) {
          btn.addEventListener('click', function () {
            host.querySelectorAll('.wdg-fx-tf').forEach(function (b) { b.classList.remove('stf-btn--active'); });
            btn.classList.add('stf-btn--active');
            dessine(btn.dataset.per);
            _ecrisOpt(host, it, 'periodes', btn.dataset.per);
          });
        });
        /* ⚠️ CETTE CARTE NE SE METTAIT JAMAIS À JOUR (mesuré le 21/08). Elle affichait la force des
           devises figée à l'instant de son affichage, jusqu'au rechargement de la page : sur un
           terminal, une donnée juste mais immobile se lit comme une donnée fausse.
           On redessine la MÊME période, sans remonter la carte : un remontage détruirait et
           reconstruirait le graphique, ce qui ferait clignoter l'écran à chaque tour.
           60 s : la force des devises se recalcule en continu côté serveur, mais elle se lit sur
           des heures. Inutile de payer un aller-retour toutes les vingt secondes pour une courbe
           dont la forme ne change pas à cette échelle.
           On saute le tour si la carte est masquée ou hors écran : rafraîchir ce que personne ne
           regarde a déjà coûté un incident de trafic à ce projet. */
        var _ivFx = setInterval(function () {
          if (!host || !host.isConnected) { clearInterval(_ivFx); return; }
          if (document.hidden) return;
          var b = host.getBoundingClientRect();
          if (b.width < 2 || b.bottom < -200 || b.top > (window.innerHeight || 0) + 200) return;
          var actif = host.querySelector('.wdg-fx-tf.stf-btn--active');
          try { dessine(actif ? actif.dataset.per : per); } catch (e) {}
        }, 60 * 1000);
        return function () {
          try { clearInterval(_ivFx); } catch (e) {}
          try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {}
        };
      },
    },
    {
      id: 'barometre', name: 'Baromètre des Devises', tag: 'BAROMÈTRE', cat: 'Devises', h: 300,
      desc: 'La force des 8 majeures en égaliseur bidirectionnel (le vrai baromètre du desk).',
      aide: "<p>Un égaliseur bidirectionnel : chaque devise s'écarte de l'axe central vers le haut si elle se renforce, vers le bas si elle faiblit. La trame éteinte reste visible, de sorte qu'une devise sans mouvement se distingue d'une devise sans donnée.</p><p>La lecture est comparative et instantanée : ce sont les <strong>extrémités opposées</strong> qui désignent les paires où le mouvement est le plus net, la plus forte contre la plus faible.</p>",
      src: "La même force que l'onglet BAROMÈTRE du desk, relue toutes les 15 secondes tant que la carte est visible ; l'échelle est relative, la devise la plus étirée servant d'étalon aux autres.",
      watch: "Une devise qui s'étire nettement plus que les autres, et le moment où deux extrémités opposées se creusent en même temps : la paire correspondante porte le mouvement le plus franc de l'instant.",
      // Réutilise buildMeterChart du desk (HTML pur, classes .meter-*). Son timer interne s'auto-termine
      // hors de l'onglet METER (garde #rtab-meter) → snapshot rafraîchi à chaque réouverture, zéro fuite.
      mount: function (host) {
        var id = HOST_ID + '-mt-' + uid();
        // Enveloppe .wdg-metre = CONTENEUR de requête : les compactions (drapeaux, badges) suivent la
        // largeur RÉELLE de la carte, pas celle de l'écran — une carte étroite existe sur tout écran.
        host.innerHTML = '<div class="wdg-metre"><div id="' + id + '" style="height:100%;"></div></div>';
        if (typeof buildMeterChart !== 'function') { fallback(host, 'Baromètre indisponible.'); return null; }
        try { buildMeterChart(id); } catch (e) { fallback(host, 'Baromètre indisponible.'); }
        return null;
      },
    },
    // (« Classement des Devises » RETIRÉ du catalogue le 23/07, demande user — les configs qui le
    //  contiennent encore sont ignorées proprement par renderGrid : byId() → null → carte sautée.)
    {
      id: 'risque-historique', name: 'Historique du risque',
      maj: 5 * 60 * 1000, cat: 'Risque', h: 260,   // serie agregee, et surtout auto-reparation si le premier chargement echoue
      desc: "L'appétit pour le risque des dernières semaines.",
      aide: "<p>La même mesure d'appétit pour le risque que la jauge de sentiment, mais déroulée dans le temps : chaque point est la valeur d'une journée, au-dessus de zéro le risque est recherché, en dessous il est fui. La fenêtre se règle de 30 jours à un an.</p><p>L'historique donne le contexte que l'instantané ne peut pas donner : un risque-on de trois jours après un mois de risque-off n'a pas le même poids qu'un régime installé. C'est la <strong>durée</strong> d'un régime, plus que son niveau du jour, qui conditionne les corrélations.</p>",
      src: "Série quotidienne calculée par le desk avec la même mesure que la jauge de sentiment ; la carte la relit toutes les 5 minutes, un rythme qui sert surtout à se réparer : la série n'ajoute qu'un point par jour.",
      watch: "Les traversées du zéro et la durée des régimes : un régime bref se retourne souvent, un régime installé pilote les corrélations entre devises cycliques, refuges et indices.",
      // Le serveur accepte déjà 7 à 366 jours (/api/risk-history) : la fenêtre était figée à 60 côté widget.
      opts: [{ k: 'jours', lbl: 'Fenêtre', type: 'choix', def: '60',
        choix: [['30', '30 j'], ['60', '60 j'], ['90', '90 j'], ['180', '6 mois'], ['365', '1 an']] }],
      mount: function (host, it) {
        var W = this;
        var id = HOST_ID + '-rh-' + uid();
        host.innerHTML = '<div id="' + id + '" style="width:100%;height:100%;"></div>';
        if (typeof buildRiskHistoryChart !== 'function') { fallback(host, 'Historique indisponible.'); return null; }
        fetch('/api/risk-history?days=' + encodeURIComponent(opt(it, W, 'jours'))).then(function (r) { return r.json(); }).then(function (d) {
          if (!document.getElementById(id)) return;                        // widget retiré pendant le fetch
          try { buildRiskHistoryChart(id, d); } catch (e) { fallback(host, 'Historique indisponible.'); }
        }).catch(function () { fallback(host, 'Historique indisponible.'); });
        return function () { try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {} };
      },
    },
    {
      id: 'calendrier-jour', name: 'Calendrier économique',
      maj: 60 * 1000, cat: 'Macro', h: 300,   // les valeurs reelles se remplissent au fil des publications : c'est la ou l'immobilite se voit le plus
      desc: 'Les prochaines publications, heure de Paris.',
      aide: "<p>Les publications du jour avec leur importance, la valeur attendue et, une fois publiée, la valeur réelle. La colonne à surveiller n'est pas le chiffre mais son <strong>écart au consensus</strong> : c'est la surprise qui déplace un marché, pas le niveau.</p><p>Les points d'impact indiquent la capacité historique de la publication à faire bouger les prix. Un événement à trois points sans surprise fait souvent moins qu'un événement à deux points très au-dessus des attentes.</p>",
      src: "Le calendrier économique du desk, relu toutes les 60 secondes : les valeurs réelles se remplissent au fil des publications, heure de Paris.",
      watch: "L'écart entre le réel et la prévision à l'instant où la colonne se remplit, surtout sur les événements à fort impact, et les créneaux qui empilent plusieurs publications à la même heure : leurs effets peuvent se contrarier.",
      // MÊME DOM ET MÊME HABILLAGE que le desk (renderCalTable, charts.js) : classes `cal-table`/`cth-*`,
      // séparateurs de jour, états de ligne, helpers globaux (calFormatTime, CAL_FLAG, calImpDots,
      // calActualCell). ⚠️ PAS identique pour autant : la POSE diffère (le widget est toujours en
      // table-layout fixed + largeurs en % par bandes de conteneur, le desk en layout auto), et le
      // masquage Haut/Bas est une option DE CARTE (col_high/col_low) NON synchronisée avec le réglage
      // DTPPref de l'onglet. Lecture seule (le déroulé inline reste dans l'onglet dédié).
      // FENÊTRE = LA SEMAINE (04/08, demande user) : lundi → vendredi, la date de la semaine en
      // étiquette, navigation d'une semaine à l'autre. Les anciens réglages « Lignes » (cap qui
      // aurait tronqué une semaine chargée en silence) et « Passé » (la semaine définit désormais
      // la fenêtre) n'ont plus d'objet : ils sont retirés, leurs valeurs stockées deviennent inertes.
      opts: [
        { k: 'impact', lbl: 'Impact', type: 'choix', def: 'all',
          choix: [['all', 'Tous'], ['med', 'Moyen +'], ['high', 'Fort']] },
        // Unité de fenêtre, MÉMORISÉE par carte mais absente du panneau de réglages (`cache: true`,
        // même mécanique que la clé `off` du fil d'actualité) : le choix vit sur les boutons
        // Jour / Semaine / Mois de la barre, à côté des flèches — c'est de la navigation, pas un
        // réglage. L'afficher aussi dans les réglages ferait le doublon déjà refusé ailleurs.
        { k: 'periode', lbl: 'Fenêtre', type: 'choix', def: 'semaine',
          choix: [['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois']] },
        // COLONNES HIGH / LOW MASQUABLES (15/08, demande user). Ce sont les bornes de la fourchette
        // de consensus : utiles à qui les lit, du bruit pour qui suit seulement Réel / Prévision /
        // Précédent. Elles restent AFFICHÉES par défaut (def: true) — un réglage neuf ne doit jamais
        // changer ce que l'utilisateur voyait la veille. Le libellé reprend le mot exact de l'en-tête
        // de colonne, pour qu'on sache tout de suite laquelle on éteint.
        { k: 'col_high', lbl: 'Colonne Haut', type: 'bascule', def: true },
        { k: 'col_low', lbl: 'Colonne Bas', type: 'bascule', def: true },
      ],
      mount: function (host, it) {
        var W = this;
        host.innerHTML = '<div class="wdg-cal-wrap custom-scrollbar"><div class="wdg-skel"><span class="wdg-skel-l" style="width:78%"></span><span class="wdg-skel-l" style="width:64%"></span><span class="wdg-skel-l" style="width:82%"></span><span class="wdg-skel-l" style="width:58%"></span></div></div>';
        // BARRE D'OUTILS DU DESK (demande user 02/08 « le widget calendrier doit ressembler à ça ») :
        // filtres d'impact + recherche d'événements + pastille DIRECT, avec les classes EXACTES de
        // l'onglet Calendrier (.cal-filter-row/.cal-imp-btn/.cal-search-wrap/.cal-live-badge) — le
        // widget devient un vrai panneau du desk et non une table nue. Les deux commandes filtrent en
        // direct, sans re-télécharger : le calendrier complet reste en mémoire.
        var _tous = [], _imp = ({ all: 'ALL', med: 'Medium', high: 'High' })[opt(it, W, 'impact')] || 'ALL', _q = '';
        // SEMAINE AFFICHÉE : 0 = semaine courante, -1 = précédente… `_back` = profondeur de données
        // déjà téléchargée (0 = live ≈ 3 semaines de passé ; 1-3 = mois d'archive via ?back=N).
        // FENÊTRE À TROIS UNITÉS (04/08, demande user) : Jour · Semaine · Mois. `_dec` est le décalage
        // EN UNITÉS (0 = période courante, -1 = précédente…). L'unité est mémorisée par carte via
        // l'option cachée `periode` : elle survit au remontage sans encombrer le panneau de réglages.
        var _unite = opt(it, W, 'periode') || 'semaine';
        // `_ancre` : la vue s'est-elle déjà positionnée sur l'événement en cours pour la période
        // affichée ? Relâché à chaque changement de période, jamais pendant une recherche.
        var _dec = 0, _back = 0, _busy = false, _ancre = false;
        // Recul maximal par unité — l'API d'archive plafonne à 3 mois, on ne propose pas au-delà.
        var _LIM = { jour: -90, semaine: -12, mois: -3 };
        var _UNITES = [['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois']];
        var _MOISFR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
        var _MOISLG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
        var _JOURSFR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
        var _debut = function (dec) {                        // 00:00 du début de la période décalée
          var d = new Date(); d.setHours(0, 0, 0, 0);
          if (_unite === 'jour') { d.setDate(d.getDate() + dec); return d; }
          // ⚠️ setDate(1) AVANT setMonth : sans ça, un 31 mars + 1 mois donne le 1er mai (débordement).
          if (_unite === 'mois') { d.setDate(1); d.setMonth(d.getMonth() + dec); return d; }
          d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + dec * 7);   // lundi de la semaine visée
          return d;
        };
        var _bornes = function () {
          var a = _debut(_dec), b = new Date(a);
          if (_unite === 'mois') { b.setMonth(a.getMonth() + 1); b.setDate(0); }   // dernier jour du mois
          else if (_unite === 'semaine') b.setDate(a.getDate() + 4);               // vendredi (pas de week-end)
          b.setHours(23, 59, 59, 999);
          return [a.getTime(), b.getTime()];
        };
        var _lib = function () {
          var a = _debut(_dec);
          if (_unite === 'jour') return _JOURSFR[a.getDay()] + ' ' + a.getDate() + ' ' + _MOISFR[a.getMonth()];
          if (_unite === 'mois') return _MOISLG[a.getMonth()] + ' ' + a.getFullYear();
          var b = new Date(a); b.setDate(a.getDate() + 4);   // « 3 – 7 août » · « 28 juil. – 1 août »
          return a.getMonth() === b.getMonth()
            ? a.getDate() + ' – ' + b.getDate() + ' ' + _MOISFR[b.getMonth()]
            : a.getDate() + ' ' + _MOISFR[a.getMonth()] + ' – ' + b.getDate() + ' ' + _MOISFR[b.getMonth()];
        };
        // Profondeur d'archive nécessaire pour couvrir la période visée (l'API plafonne à 3 mois).
        var _besoin = function (dec) {
          var j = Math.ceil((Date.now() - _debut(dec).getTime()) / 86400000);
          return j <= 18 ? 0 : Math.min(3, Math.ceil((j - 18) / 30) || 1);
        };
        var _BTNS = [['ALL', 'Tous', ''], ['High', 'Élevé', ' cal-imp-btn--high'], ['Medium', 'Moyen', ' cal-imp-btn--med'], ['Low', 'Faible', ' cal-imp-btn--low']];
        var barre = function () {
          return '<div class="cal-filter-row wdg-cal-bar">'
            + '<div class="cal-impact-filter">'
            +   _BTNS.map(function (b) {
                  return '<button type="button" class="cal-imp-btn' + b[2] + (_imp === b[0] ? ' cal-imp-btn--active' : '') + '" data-imp="' + b[0] + '">' + b[1] + '</button>';
                }).join('')
            + '</div>'
            + '<div class="cal-search-wrap"><span class="cal-search-icon">⌕</span>'
            +   '<input type="text" class="cal-search-input wdg-cal-q" placeholder="Rechercher des événements…" value="' + esc(_q) + '"></div>'
            // NAVIGATION PAR SEMAINE (04/08, demande user) : la fenêtre est la semaine lundi→vendredi
            // et sa DATE est affichée ; ‹ recule d'une semaine (jusqu'à ~3 mois, limite de l'API),
            // › avance (la semaine prochaine est déjà couverte par le flux live).
            // (05/08, demande user « mets ceci dans le bouton réglages pour gagner de la place ») :
            // les boutons Jour / Semaine / Mois quittent la barre — la fenêtre se choisit dans
            // l'engrenage, comme la catégorie COT, l'unité DMX et la paire Saisonnalité. Seules les
            // flèches et l'étiquette de période restent, car elles servent à chaque consultation.
            + '<span class="wdg-cal-nav">'
            +   '<button type="button" class="cal-range-arrow wdg-cal-prev" title="Période précédente"' + (_dec <= _LIM[_unite] || _busy ? ' disabled' : '') + '>‹</button>'
            +   '<span class="wdg-cal-per' + (_dec === 0 ? ' is-now' : '') + '">' + _lib() + '</span>'
            +   '<button type="button" class="cal-range-arrow wdg-cal-next" title="Période suivante"' + (_dec >= 1 || _busy ? ' disabled' : '') + '>›</button>'
            + '</span>'
            + '</div>';
        };
        var dessine = function () {
          if (!host.isConnected) return;
          var now = Date.now();
          var q = _q.trim().toLowerCase();
          var impOk = function (e) {
            if (_imp === 'ALL') return true;
            return String(e.impact || '').toLowerCase() === _imp.toLowerCase();
          };
          // FENÊTRE = LA SEMAINE affichée (lundi → vendredi). Plus de cap de lignes : tronquer une
          // semaine chargée sans le dire serait pire que de faire défiler.
          var bo = _bornes();
          var evs = _tous.filter(function (e) {
            var t = e && e.timestamp || 0;
            return t >= bo[0] && t <= bo[1] && impOk(e)
              && (!q || String(e.title || '').toLowerCase().indexOf(q) !== -1 || String(e.currency || '').toLowerCase().indexOf(q) !== -1);
          });
          if (!evs.length) {
            host.innerHTML = '<div class="wdg-cal-panel">' + barre() + '<div class="wdg-cal-wrap"><div class="wdg-empty">'
              + (_busy ? 'Chargement…' : 'Aucun événement sur cette semaine.') + '</div></div></div>';
            return cabler();
          }
          var nextIdx = evs.findIndex(function (e) { return (e.timestamp || 0) >= now; });
          // Colonnes High / Low : masquables depuis les Réglages de la carte. Lues À CHAQUE RENDU
          // (et non une fois au montage) pour que la bascule se voie immédiatement, sans rouvrir
          // le widget. `opt()` renvoie le défaut `true` tant que rien n'a été touché.
          var _vHigh = opt(it, W, 'col_high') !== false;
          var _vLow = opt(it, W, 'col_low') !== false;
          var fmtTime = (typeof calFormatTime === 'function') ? calFormatTime : function () { return ''; };
          var flag = (typeof CAL_FLAG === 'function') ? CAL_FLAG : function () { return ''; };
          var dots = (typeof calImpDots === 'function') ? calImpDots : function () { return ''; };
          var actCell = (typeof calActualCell === 'function') ? calActualCell : function () { return ''; };
          var vspan = function (raw, cls) { return raw && raw !== '' ? '<span class="' + cls + '">' + esc(raw) + '</span>' : '<span class="cv-empty">-</span>'; };
          var tbody = '', lastDay = '';
          evs.forEach(function (ev, i) {
            var dayKey = ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('en-GB') : '';
            if (dayKey && dayKey !== lastDay) {
              var d = new Date(ev.timestamp);
              var wd = d.toLocaleDateString('fr-FR', { weekday: 'long' });
              var ds = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
              // ⚠️ colspan DYNAMIQUE : il valait 10 en dur. Avec une colonne masquée, la ligne de
              // séparation de jour aurait débordé d'une case et décalé la bordure du tableau.
              tbody += '<tr class="cal-day-sep"><td colspan="' + (8 + (_vHigh ? 1 : 0) + (_vLow ? 1 : 0)) + '">' + esc(wd) + ', ' + ds + '</td></tr>';
              lastDay = dayKey;
            }
            var imp = (ev.impact || '').toLowerCase();
            var cls = 'cal-row';
            if (i === nextIdx) cls += ' cal-row--next';
            if ((ev.timestamp || 0) < now) cls += ' cal-row--past';
            if (imp === 'high') cls += ' cal-row--high'; else if (imp === 'medium') cls += ' cal-row--med';
            // CHEVRON + CHIP « CLÉ » + LIGNE CLIQUABLE : c'est ce qui manquait pour que la table soit
            // celle du desk. Sans le chevron la colonne HEURE ne commence pas au même endroit, sans la
            // classe cliquable la ligne ne réagit pas au survol, et le repère « Clé » (discours de tête
            // de banque centrale) disparaissait — trois écarts visibles, mesurés au banc de rendu.
            var keyChip = (typeof _CAL_CB_RX !== 'undefined' && typeof _CAL_CB_KEY_RX !== 'undefined'
              && _CAL_CB_RX.test(ev.title || '') && _CAL_CB_KEY_RX.test(ev.title || ''))
              ? ' <span class="cal-key-chip">Clé</span>' : '';
            // Chevron sans espace apres le span (comme le desk) : il est positionne en absolu par le
            // CSS, un espace residuel decalerait les chiffres de l'heure de ~3,5 px.
            tbody += '<tr class="' + cls + ' cal-row--click" data-idx="' + i + '">'
              + '<td class="cth-time"><span class="cal-chv">›</span>' + (esc(fmtTime(ev.timestamp)) || esc(ev.time) || '-') + '</td>'
              + '<td class="cth-flag">' + flag(ev.currency) + '</td>'
              + '<td class="cth-curr">' + esc(ev.currency || '') + '</td>'
              + '<td class="cth-imp">' + dots(ev.impact) + '</td>'
              + '<td class="cth-event">' + esc(ev.title || '') + keyChip + '</td>'
              // `data-lbl` : en mise en page MOBILE la ligne devient une CARTE et l'en-tête de
              // colonne disparaît — chaque valeur porte donc son propre libellé, affiché par CSS.
              // Sur écran large l'attribut est inerte (aucune règle ne le lit).
              // cth-val--* : masquage et intitules abreges par CLASSE (plus par nth-child) : une
              // colonne retiree par le reglage ne peut plus faire lire une donnee sous le mauvais
              // en-tete (le bug « Bas sous PRÉV » mesure au banc le 17/08).
              + '<td class="cth-val cth-val--reel" data-lbl="Réel">' + actCell(ev.actual, ev.forecast, ev.low, ev.title) + '</td>'
              + (_vHigh ? '<td class="cth-val cth-val--haut" data-lbl="Haut">' + vspan(ev.high, 'cv-forecast') + '</td>' : '')
              + '<td class="cth-val cth-val--prev" data-lbl="Prév.">' + vspan(ev.forecast, 'cv-forecast') + '</td>'
              + (_vLow ? '<td class="cth-val cth-val--bas" data-lbl="Bas">' + vspan(ev.low, 'cv-prev') + '</td>' : '')
              + '<td class="cth-val cth-val--prec" data-lbl="Préc.">' + vspan(ev.previous, 'cv-prev') + '</td></tr>';
          });
          host.innerHTML = '<div class="wdg-cal-panel">' + barre()
            + '<div class="wdg-cal-wrap custom-scrollbar"><table class="cal-table">'
            + '<thead><tr><th class="cth-time">Heure</th><th class="cth-flag">Pays</th><th class="cth-curr">Dev.</th>'
            + '<th class="cth-imp">IMPACT</th><th class="cth-event">ÉVÉNEMENT</th><th class="cth-val cth-val--reel">RÉEL</th>'
            + (_vHigh ? '<th class="cth-val cth-val--haut">HAUT</th>' : '') + '<th class="cth-val cth-val--prev">PRÉVISION</th>'
            + (_vLow ? '<th class="cth-val cth-val--bas">BAS</th>' : '')
            + '<th class="cth-val cth-val--prec">PRÉCÉDENT</th></tr></thead><tbody>' + tbody + '</tbody></table></div></div>';
          // DÉROULÉ INLINE : on réutilise CELUI DU DESK (toggleCalDetailRow, charts.js) — il ne dépend
          // que de la ligne et de l'événement, donc il fonctionne tel quel dans le widget. Un chevron
          // qui ne déroule rien serait un faux repère : la ligne s'ouvre ici comme dans l'onglet.
          if (typeof toggleCalDetailRow === 'function') {
            host.querySelectorAll('tr.cal-row--click').forEach(function (tr) {
              tr.addEventListener('click', function () {
                var e2 = evs[parseInt(tr.getAttribute('data-idx'), 10)];
                if (e2) toggleCalDetailRow(tr, e2);
              });
            });
          }
          // ── ARRIVÉE SUR L'ÉVÉNEMENT EN COURS (05/08, demande user : « comme dans l'ancien
          //    calendrier ») ────────────────────────────────────────────────────────────────────
          // La ligne du prochain événement était déjà repérée (.cal-row--next) mais rien ne
          // l'amenait à l'écran : sur une semaine chargée, on ouvrait le widget en haut de lundi.
          // ⚠️ UNE SEULE FOIS PAR PÉRIODE : `dessine()` est rappelé à chaque frappe dans la
          // recherche et à chaque changement de filtre — repositionner à chaque rendu arracherait
          // le défilement sous le doigt de l'utilisateur.
          // ⚠️ On règle scrollTop du CONTENEUR au lieu d'appeler scrollIntoView : ce dernier fait
          // aussi défiler la PAGE, donc le desk entier bougerait autour du widget.
          if (!_ancre) {
            var _wrap = host.querySelector('.wdg-cal-wrap');
            var _ligne = _wrap && _wrap.querySelector('tr.cal-row--next');
            if (_wrap && _ligne) {
              _ancre = true;
              // Un tiers de hauteur au-dessus : l'événement en cours est visible AVEC son contexte
              // (ce qui vient de tomber juste avant), au lieu d'être collé en haut du cadre.
              _wrap.scrollTop = Math.max(0, _ligne.offsetTop - Math.round(_wrap.clientHeight / 3));
            }
          }
          cabler();
        };
        // Recâblé à chaque rendu : le HTML de la barre est réécrit avec la table (un seul innerHTML,
        // donc un seul reflow). La saisie garde le focus et le curseur — sinon on ne pourrait pas
        // taper deux lettres de suite dans la recherche.
        var cabler = function () {
          // ⚠️ SÉLECTEUR RESTREINT AU CONTENEUR D'IMPACT. Les boutons Jour/Semaine/Mois réutilisent
          // la classe .cal-imp-btn pour l'apparence : avec l'ancien sélecteur, ils recevaient AUSSI
          // ce gestionnaire, qui leur lisait un data-imp inexistant. `_imp` passait à null, puis
          // impOk() appelait _imp.toLowerCase() → exception, et plus aucun bouton ne répondait.
          host.querySelectorAll('.cal-impact-filter .cal-imp-btn').forEach(function (b) {
            b.addEventListener('click', function () { _imp = b.getAttribute('data-imp'); dessine(); });
          });
          var q = host.querySelector('.wdg-cal-q');
          if (q) {
            q.addEventListener('input', function () {
              var pos = q.selectionStart;
              _q = q.value;
              dessine();
              var q2 = host.querySelector('.wdg-cal-q');
              if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} }
            });
          }
          var pv = host.querySelector('.wdg-cal-prev'), nx = host.querySelector('.wdg-cal-next');
          if (pv) pv.addEventListener('click', function () { versPeriode(_dec - 1); });
          if (nx) nx.addEventListener('click', function () { versPeriode(_dec + 1); });
          host.querySelectorAll('.wdg-cal-u').forEach(function (b) {
            b.addEventListener('click', function () {
              var u = b.getAttribute('data-unite');
              if (_busy || u === _unite) return;
              _unite = u; _dec = 0;                            // on repart TOUJOURS sur la période courante
              _ecrisOpt(host, it, 'periode', u);   // mémorisé sans reconstruire la carte, carte OU onglet
              // Le mois demande plus d'archive que la semaine : on télécharge si besoin.
              var besoin = _besoin(0);
              if (besoin > _back) { _busy = true; dessine(); charge(besoin); return; }
              dessine();
            });
          });
        };
        // CHANGEMENT DE SEMAINE : si la semaine visée sort de ce qui est déjà téléchargé, on va
        // chercher la profondeur d'archive nécessaire (?back=N mois, API de l'onglet Calendrier) ;
        // sinon on se contente de re-filtrer en mémoire — instantané.
        var versPeriode = function (n) {
          if (_busy) return;
          n = Math.max(_LIM[_unite], Math.min(1, n | 0));
          if (n === _dec) return;
          _dec = n;
          _ancre = false;        // nouvelle période → on se repositionne sur son événement courant
          var besoin = _besoin(n);
          if (besoin <= _back) { dessine(); return; }        // déjà couvert par les données en main
          _busy = true; dessine();
          charge(besoin);
        };
        var charge = function (n) {
          fetch(n > 0 ? ('/api/calendar-events?back=' + n) : '/api/calendar-events')
            .then(function (r) { return r.json(); }).then(function (j) {
              if (!host.isConnected) return;
              _back = n; _busy = false;
              _tous = ((j && j.items) || []).filter(Boolean)
                .sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
              dessine();
            }).catch(function () { _busy = false; dessine(); });
        };
        charge(0);                                           // semaine courante (le flux live la couvre)
        return null;
      },
    },
    {
      id: 'radar-biais', name: 'Radar de Biais', cat: 'Macro', h: 320,
      desc: 'Le biais net de chaque devise, du plus haussier au plus baissier.',
      aide: "<p>Le biais de chaque devise est une <strong>confluence</strong>, pas un indicateur : politique monétaire, inflation, croissance et emploi sont pondérés puis combinés. Une devise n'est haussière que si plusieurs piliers vont dans le même sens.</p><p>Le tableau est donc à lire par colonnes autant que par lignes : deux devises au même biais peuvent le devoir à des raisons opposées, et c'est cette différence qui fait la qualité d'une paire.</p>",
      src: "Le moteur Smart Bias du desk, avec exactement les mêmes données que l'onglet BIAIS : la mise à jour est poussée en direct par le serveur, avec un filet de relecture toutes les 60 secondes.",
      watch: "Un pilier qui change de camp sur une devise (le biais suivra souvent), et deux devises aux biais opposés : c'est ce contraste qui désigne les paires les plus nettes.",
      // IDENTIQUE AU DESK : réutilise le VRAI builder de l'onglet BIAIS (_sbRenderMacroTable, global app.js) +
      // la même donnée (/api/smart-bias : currencies + macroTable) → tableau Radar de Biais RIGOUREUSEMENT identique
      // (mêmes colonnes Devise/Politique monétaire/Inflation/Croissance/Emploi/Driver/Biais, mêmes tags sémantiques).
      // Plus AUCUNE version simplifiée maison (règle établie). Aucun état partagé, aucun root amCharts → cleanup null.
      // TEMPS RÉEL (demande user 26/07) : le widget suit la même matrice que l'onglet BIAIS — il consomme le
      // push serveur `smartbias_update` (via DTPWidgets.onBias, app.js) et garde un filet de 60 s. Il ne re-rend
      // que si la donnée a VRAIMENT changé (dataAt) : pas de clignotement, pas de scroll perdu.
      mount: function (host) {
        skel(host);
        var lastAt = 0;
        function paint(d) {
          if (!host.isConnected) return;
          var cur = d && d.currencies;
          if (!cur || !cur.length || typeof _sbRenderMacroTable !== 'function') return fallback(host, 'Biais indisponible.');
          var at = Number(d.dataAt || d.generatedAt || 0);
          if (at && at === lastAt && host.querySelector('.macro-wrap')) return;   // rien de neuf → on ne touche à rien
          lastAt = at;
          // Source de vérité serveur (macroTable) ; repli dérivé des piliers si cache ancien — EXACTEMENT comme le desk.
          var macro = (d.macroTable && Object.keys(d.macroTable).length) ? d.macroTable
                    : (typeof _sbMacroFromRows === 'function' ? _sbMacroFromRows(d) : {});
          // Clic sur une devise = le VRAI détail macro de CETTE devise, en OVERLAY dans Mon Desk (demande user
          // 26/07 : « ça ne doit pas me rediriger vers l'onglet biais »). On retire le onclick baké du desk.
          var tbl = _sbRenderMacroTable(cur, macro).replace(/ onclick="_sbOpenDetail\([^"]*\)"/g, '');
          host.innerHTML = '<div class="wdg-biaswrap macro-wrap custom-scrollbar">' + tbl + '</div>';
          var wrap = host.querySelector('.macro-wrap');
          if (wrap) wrap.addEventListener('click', function (e) {
            var row = e.target.closest('.mt-row'); if (!row) return;
            _wdgBiasDetail(row.getAttribute('data-cur'), d);
          });
        }
        function reload() {
          if (!host.isConnected) return;
          fetch('/api/smart-bias').then(function (r) { return r.json(); }).then(paint)
            .catch(function () { if (!host.querySelector('.macro-wrap')) fallback(host, 'Biais indisponible.'); });
        }
        reload();
        var iv = setInterval(reload, 60000);
        _BIAS_SINKS.push(paint);                                   // push serveur → repeint sans attendre le filet
        return function () { clearInterval(iv); var i = _BIAS_SINKS.indexOf(paint); if (i >= 0) _BIAS_SINKS.splice(i, 1); };
      },
    },
    {
      /* DIFFÉRENTIEL DE TAUX (20/08, demande user : le bandeau de l'onglet Biais devient un widget).
         ⚠️ NE PAS CONFONDRE avec « Taux directeurs » juste en dessous : celui-là répond « que va
         faire la banque à sa prochaine réunion » (scénario + probabilités) ; celui-ci répond « quelle
         devise le PORTAGE favorise aujourd'hui », en comparant chaque taux à la moyenne des SEPT
         AUTRES (exclusion-de-soi). Même source /api/rates : les deux cartes ne peuvent pas se
         contredire. C'est la grandeur que le Radar de Biais consomme déjà dans son pilier monétaire. */
      id: 'taux-diff', name: 'Différentiel de taux', tag: 'TAUX', cat: 'Macro', h: 300,
      desc: 'Quelle devise le portage favorise : chaque taux directeur comparé à la moyenne des sept autres.',
      aide: "<p>Le taux de chaque banque centrale est comparé à la <strong>moyenne des sept autres</strong>, elle-même calculée en excluant la devise concernée : sans cette exclusion, une devise se comparerait en partie à elle-même et l'écart serait mécaniquement atténué.</p><p>Au-delà de ±0,75 point, l'effet de portage est jugé significatif et compté dans le Radar de Biais. En dessous, l'écart existe mais ne discrimine pas assez pour peser sur une décision.</p>",
      src: "Les mêmes taux directeurs que l'onglet TAUX du desk, relus toutes les 5 minutes ; la donnée source évolue à l'échelle de la décision de banque centrale, pas du tick.",
      watch: "Les écarts qui franchissent la barre des ±0,75 point, dans un sens ou dans l'autre : c'est le seuil à partir duquel le portage entre dans le Radar de Biais.",
      opts: [
        { k: 'tri', lbl: 'Classement', type: 'choix', def: 'ecart',
          choix: [['ecart', 'Par écart'], ['taux', 'Par taux'], ['nom', 'Par devise']] },
      ],
      mount: function (host, it) {
        var W = this, vivant = true;
        skel(host, 8);
        function dessiner() {
          fetch('/api/rates').then(function (r) {
            if (!r.ok) throw new Error('http');
            return r.json();
          }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            var banks = ((d && d.banks) || []).filter(function (b) { return b && b.code && typeof b.rate === 'number'; });
            if (banks.length < 4) { fallback(host, 'Taux indisponibles.'); return; }
            var moyDe = function (code) {
              var a = banks.filter(function (x) { return x.code !== code; });
              return a.reduce(function (s, x) { return s + x.rate; }, 0) / (a.length || 1);
            };
            var lignes = banks.map(function (b) {
              var e = b.rate - moyDe(b.code);
              return { code: b.code, rate: b.rate, ecart: e };
            });
            var tri = opt(it, W, 'tri') || 'ecart';
            lignes.sort(function (a, b) {
              if (tri === 'nom') return a.code.localeCompare(b.code);
              if (tri === 'taux') return b.rate - a.rate;
              return b.ecart - a.ecart;
            });
            // Échelle commune aux deux sens : les barres sont comparables entre elles.
            var maxAbs = Math.max.apply(null, lignes.map(function (l) { return Math.abs(l.ecart); })) || 1;
            var html = '<div class="wdg-td">'
              + '<div class="wdg-td-tete"><span>Écart au taux moyen des 7 autres banques</span></div>';
            lignes.forEach(function (l) {
              // Seuil ±0,75 pt : celui SOUS LEQUEL le modèle de biais ne compte aucun effet de
              // portage. Le libellé dit donc exactement ce que le calcul fait.
              var cls = l.ecart >= 0.75 ? 'est-pour' : l.ecart <= -0.75 ? 'est-contre' : 'est-neutre';
              var lbl = l.ecart >= 0.75 ? 'Favorable' : l.ecart <= -0.75 ? 'Défavorable' : 'Neutre';
              var larg = Math.max(2, Math.abs(l.ecart) / maxAbs * 50);   // 50 % = une demi-piste
              var sens = l.ecart >= 0 ? 'right' : 'left';
              html += '<div class="wdg-td-l ' + cls + '">'
                + '<span class="wdg-td-dev">' + _drapeauDev(l.code) + '<b>' + esc(l.code) + '</b></span>'
                + '<span class="wdg-td-taux">' + l.rate.toFixed(2).replace('.', ',') + ' %</span>'
                + '<span class="wdg-td-piste"><i style="' + sens + ':50%;width:' + larg.toFixed(1) + '%"></i></span>'
                + '<span class="wdg-td-ecart">' + (l.ecart >= 0 ? '+' : '') + l.ecart.toFixed(2).replace('.', ',') + '</span>'
                + '<span class="wdg-td-lbl">' + lbl + '</span>'
                + '</div>';
            });
            html += '<div class="wdg-td-pied">Le portage joue POUR une devise dont le taux dépasse la moyenne des autres, CONTRE dans le cas inverse. Au-delà de ±0,75 point, l\'effet est compté dans le Radar de Biais.</div></div>';
            host.innerHTML = html;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Taux indisponibles.'); });
        }
        dessiner();
        var iv = setInterval(dessiner, 5 * 60 * 1000);   // la source bouge à l'heure, pas à la seconde
        return function () { vivant = false; clearInterval(iv); };
      },
    },
    {
      id: 'taux-cb', name: 'Taux directeurs',
      maj: 5 * 60 * 1000, cat: 'Macro', h: 320,   // la source des probabilites bouge a l'heure, pas a la seconde
      desc: 'Où en sont les banques centrales : taux actuel + prochaine décision anticipée.',
      aide: "<p>Le taux directeur en vigueur pour chaque banque, avec ce que le marché price pour la prochaine réunion. La probabilité affichée ne dit pas ce qui va arriver : elle dit ce qui est <strong>déjà dans les prix</strong>.</p><p>C'est cette distinction qui rend la donnée exploitable. Une hausse annoncée et pricée à 90% ne fera pas bouger la devise ; c'est l'écart entre la décision et ce qui était attendu qui la déplace.</p>",
      src: "Taux en vigueur et pricing de marché des prochaines réunions, agrégés par le desk et relus toutes les 5 minutes ; la donnée source bouge à l'heure, pas à la seconde.",
      watch: "Une probabilité qui se déplace nettement après un chiffre ou une prise de parole : le repricing d'une réunion est souvent le vrai moteur de la devise, bien avant la réunion elle-même.",
      // AUTONOME : lit /api/rates (probabilités marché). Rend une carte par banque : taux actuel, scénario de base
      // (Maintien/Hausse/Baisse) de la prochaine réunion + probabilité + date. HTML pur, cleanup null.
      // Réglage UTILE (04/08) : filtrer sur UNE banque — le trader suit souvent une seule courbe
      // de politique monétaire, et la carte devient lisible même étroite.
      opts: [{ k: 'banque', lbl: 'Banque', type: 'choix', def: 'all',
        /* LES BANQUES SONT NOMMÉES EN ENTIER (01/09, liste de référence fournie). Le sélecteur ne
           portait que des sigles — « BoE », « SNB », « RBNZ » — qui supposent de les connaître déjà,
           et « SNB » était même resté en anglais dans un desk qui parle français. Les noms complets
           existent depuis toujours côté serveur (`CB[].full`) : on les reprend, sigle entre
           parenthèses pour qui lit vite. Aucune donnée nouvelle. */
        choix: [['all', 'Toutes']].concat([['USD', 'Réserve fédérale (Fed)'], ['EUR', 'Banque centrale européenne (BCE)'], ['GBP', 'Banque d\'Angleterre (BoE)'], ['JPY', 'Banque du Japon (BoJ)'], ['CHF', 'Banque nationale suisse (BNS)'], ['CAD', 'Banque du Canada (BoC)'], ['AUD', 'Banque de réserve d\'Australie (RBA)'], ['NZD', 'Banque de réserve de Nouvelle-Zélande (RBNZ)']]) }],
      mount: function (host, it) {
        var W = this;
        skel(host);
        var MV = { Hike: { c: 'up', t: 'Hausse' }, Cut: { c: 'down', t: 'Baisse' }, Hold: { c: 'flat', t: 'Maintien' } };
        var flag = (typeof CAL_FLAG === 'function') ? CAL_FLAG : function () { return ''; };
        var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
        var fmtD = function (iso) { try { var p = String(iso).split('-'); return parseInt(p[2], 10) + ' ' + MOIS[parseInt(p[1], 10) - 1]; } catch (e) { return esc(iso); } };
        fetch('/api/rates').then(function (r) { return r.json(); }).then(function (d) {
          if (!host.isConnected) return;
          var banks = (d && d.banks) || [];
          var _veut = opt(it, W, 'banque') || 'all';
          if (_veut !== 'all') banks = banks.filter(function (b) { return b && b.code === _veut; });
          if (!banks.length) return fallback(host, 'Taux indisponibles.');
          var rows = banks.map(function (b) {
            var sc = b.scenario || {};
            // Scénario de base = celui de plus forte probabilité pour la PROCHAINE réunion.
            var cands = [['Hold', sc.hold], ['Hike', sc.hike], ['Cut', sc.cut]].filter(function (x) { return x[1] != null; });
            cands.sort(function (a, b2) { return (b2[1] || 0) - (a[1] || 0); });
            var base = cands[0] ? cands[0][0] : (b.move || 'Hold');
            var prob = cands[0] ? Math.round(cands[0][1]) : null;
            var mv = MV[base] || MV.Hold;
            // « auj. » et non « aujourd'hui » : sur téléphone la piste Réunion fait ~69px, le mot
            // entier (~104px) débordait de sa colonne et se superposait au badge de scénario.
            var when = b.next ? fmtD(b.next) + (b.nextDays != null ? ' · ' + (b.nextDays <= 0 ? 'auj.' : b.nextDays + ' j') : '') : '';
            return '<div class="wdg-taux-row">'
              + '<span class="wdg-taux-bank">' + flag(b.code) + '<b>' + esc(b.bank || b.code) + '</b></span>'
              + '<span class="wdg-taux-rate">' + (b.rate != null ? esc(String(b.rate).replace('.', ',')) + '%' : '-') + '</span>'
              + '<span class="wdg-taux-move wdg-taux-' + mv.c + '">' + mv.t + (prob != null ? ' ' + prob + '%' : '') + '</span>'
              + '<span class="wdg-taux-when">' + when + '</span></div>';
          }).join('');
          host.innerHTML = '<div class="wdg-taux custom-scrollbar">'
            + '<div class="wdg-taux-head"><span>Banque</span><span>Taux</span><span>Prochaine décision</span><span class="r">Réunion</span></div>'
            + rows + '</div>';
        }).catch(function () { fallback(host, 'Taux indisponibles.'); });
        return null;
      },
    },
    /* (« Table des probabilités » RETIRÉE du catalogue le 04/09, demande user — même traitement que
    //  « Classement des Devises » le 23/07 : les dispositions déjà enregistrées qui la contiennent
    //  sont ignorées proprement par renderGrid (byId() → null → carte sautée). On ne touche PAS aux
    //  configurations des clients : réécrire leurs dispositions pour retirer une carte serait une
    //  écriture de masse sur des données qu'ils n'ont pas demandé à modifier, et irréversible. */
    {
      /* COURBE DES TAUX US (23/08). La route /api/us-yields sert les 4 échéances du Trésor
         (3 mois, 5 ans, 10 ans, 30 ans) cotées en % DIRECT, plus 90 jours de clôtures par
         échéance. Le widget dessine la COURBE (forme du moment) et la série de l'ÉCART
         10 ans - 3 mois (l'inversion se lit dans le temps, pas sur un point). Le verdict est
         DÉTERMINISTE sur cet écart : seuils ±0,25 pt, pente 90 j au seuil 0,10 pt. Jamais un
         conseil directionnel : la carte dit le régime de la courbe, pas où aller. */
      id: 'courbe-taux-us', name: 'Courbe des taux US', tag: 'TAUX US', cat: 'Macro', h: 300,
      desc: 'La courbe des rendements du Trésor US (3 mois à 30 ans) et l\'écart 10 ans - 3 mois sur 90 jours.',
      aide: "<p>La courbe relie les rendements du Trésor américain du 3 mois au 30 ans. Sa <strong>forme</strong> résume ce que le marché obligataire pense du cycle : pentue quand le long terme rapporte plus que le court (régime normal), plate quand l'écart se referme, inversée quand le court rapporte davantage que le long.</p><p>L'écart <strong>10 ans - 3 mois</strong> est la mesure la plus suivie : son passage durable sous zéro a historiquement précédé les récessions américaines, avec plusieurs trimestres d'avance et sans jamais donner de date. C'est un baromètre de régime, pas un signal d'entrée.</p>",
      src: "Rendements du Trésor US lus sur les indices de rendement cotés en séance américaine, cache serveur de 10 minutes ; la donnée bouge aux heures de cotation US, pas la nuit ni le week-end.",
      watch: "Les franchissements de seuil de l'écart 10 ans - 3 mois (au-delà de +0,25 pt, autour de zéro, sous -0,25 pt) et sa pente sur 90 jours : une inversion qui se résorbe change la lecture autant que l'inversion elle-même.",
      mount: function (host) {
        var vivant = true;
        /* Mémoire du verdict : le fondu de MAJ (grammaire commune) ne se joue que sur un VRAI
           changement d'état ou d'écart, jamais au premier rendu ni sur un re-fetch identique. */
        var prevCle = null;
        skel(host, 5);

        function fmtPct(v) { return v.toFixed(2).replace('.', ',') + '%'; }
        function fmtPt(v) { return (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ','); }

        function rendre(d) {
          var s = (d && d.series) || {};
          // ok:false ou séries pivot absentes : la route ne sert pas de squelette, nous non plus.
          if (!d || !d.ok || !s.m3 || !s.y10 || s.m3.last == null || s.y10.last == null) {
            fallback(host, 'Rendements indisponibles.'); return;
          }
          /* Échéances dans l'ordre de la courbe. Seuls m3 et y10 conditionnent le ok côté
             serveur : une échéance intermédiaire muette est simplement ABSENTE, la courbe
             relie ce qui existe au lieu d'inventer un point. */
          var pts = [];
          [['m3', '3 mois'], ['y5', '5 ans'], ['y10', '10 ans'], ['y30', '30 ans']].forEach(function (e) {
            var sr = s[e[0]];
            if (sr && typeof sr.last === 'number' && isFinite(sr.last)) pts.push({ lbl: sr.lbl || e[1], v: sr.last });
          });
          if (pts.length < 2) { fallback(host, 'Rendements indisponibles.'); return; }

          /* Géométrie en POURCENTAGES de la zone, partagée entre le SVG (viewBox 0-100 étiré,
             doctrine des traceurs partagés) et les étiquettes HTML posées par-dessus en taille
             d'écran : un texte DANS un viewBox étiré se déformerait. X garde 6 % de marge pour
             que les points de bord respirent ; Y descend de 24 à 88 % : la bande du haut est
             réservée aux valeurs affichées au-dessus de chaque point. */
          var vs2 = pts.map(function (p) { return p.v; });
          var mn = Math.min.apply(null, vs2), mx = Math.max.apply(null, vs2);
          if (mx - mn < 0.05) { mn -= 0.1; mx += 0.1; }   // courbe quasi plate : échelle minimale, jamais de division par ~0
          var X = function (i) { return 6 + i / (pts.length - 1) * 88; };
          var Y = function (v) { return 24 + (mx - v) / (mx - mn) * 64; };
          var pStr = pts.map(function (p, i) { return X(i).toFixed(2) + ',' + Y(p.v).toFixed(2); }).join(' ');
          var svg = '<svg viewBox="0 0 100 100" class="wdg-tr-svg" preserveAspectRatio="none">'
            + '<polygon points="' + X(0).toFixed(2) + ',92 ' + pStr + ' ' + X(pts.length - 1).toFixed(2) + ',92"'
            + ' fill="var(--orange, #e3b23a)" opacity=".08"></polygon>'
            + '<polyline points="' + pStr + '" fill="none" stroke="var(--orange, #e3b23a)" stroke-width="1.6"'
            + ' stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>'
            + pts.map(function (p, i) {
              // Points en légère ellipse une fois étirés, assumé pour un repère de 2 unités,
              // même précédent que o.point de _courbeSvg.
              return '<circle cx="' + X(i).toFixed(2) + '" cy="' + Y(p.v).toFixed(2) + '" r="2" fill="var(--orange, #e3b23a)"></circle>';
            }).join('')
            + '</svg>';
          // Étiquettes de bord CALÉES vers l'intérieur (translate 0 / -100 %) : jamais coupées.
          var tx = function (i) { return i === 0 ? '0' : (i === pts.length - 1 ? '-100%' : '-50%'); };
          var labs = pts.map(function (p, i) {
            return '<span class="wdg-ct-lab" style="left:' + X(i).toFixed(1) + '%;top:' + Y(p.v).toFixed(1) + '%;'
              + 'transform:translate(' + tx(i) + ',calc(-100% - 3px))">' + fmtPct(p.v) + '</span>';
          }).join('');
          var axe = pts.map(function (p, i) {
            return '<span style="left:' + X(i).toFixed(1) + '%;transform:translateX(' + tx(i) + ')">' + esc(p.lbl) + '</span>';
          }).join('');

          /* Série 90 j de l'écart 10 ans - 3 mois : les deux historiques sont APPARIÉS par jour
             UTC : les tableaux Yahoo peuvent différer d'une séance (trou de cotation) et un
             appariement par INDEX décalerait tout le calcul en silence. */
          var m3J = {};
          (s.m3.hist || []).forEach(function (p) {
            if (p && p.t != null && typeof p.v === 'number' && isFinite(p.v)) m3J[new Date(p.t).toISOString().slice(0, 10)] = p.v;
          });
          var ecarts = [];
          (s.y10.hist || []).forEach(function (p) {
            if (!p || p.t == null || typeof p.v !== 'number' || !isFinite(p.v)) return;
            var m = m3J[new Date(p.t).toISOString().slice(0, 10)];
            if (m != null) ecarts.push(+(p.v - m).toFixed(3));
          });
          var ecart = +(s.y10.last - s.m3.last).toFixed(3);

          /* Verdict DÉTERMINISTE (seuils ±0,25 pt sur l'écart, pente 90 j au seuil 0,10 pt).
             La lecture d'école est FACTUELLE : l'inversion a précédé les récessions US, elle ne
             date rien et ne conseille rien. */
          var etat, vtxt, cls;
          if (ecart > 0.25) { etat = 'pentue'; cls = 'est-haut'; vtxt = '<span class="est-haut">Courbe normalement pentue</span>'; }
          else if (ecart >= -0.25) { etat = 'plate'; cls = 'est-neutre'; vtxt = '<span class="est-neutre">Courbe plate</span>'; }
          else { etat = 'inversee'; cls = 'est-bas'; vtxt = '<span class="est-bas">Courbe INVERSÉE</span>'; }
          var pente = '';
          if (ecarts.length >= 2) {
            var dlt = ecarts[ecarts.length - 1] - ecarts[0];
            pente = dlt >= 0.10 ? 'se repentifie sur 90 jours (' + fmtPt(dlt) + ' pt)'
              : dlt <= -0.10 ? 's\'aplatit sur 90 jours (' + fmtPt(dlt) + ' pt)'
              : 'stable sur 90 jours (' + fmtPt(dlt) + ' pt)';
          }
          var vsous = 'Écart 10 ans - 3 mois : ' + fmtPt(ecart) + ' pt' + (pente ? ', ' + pente : '') + '. '
            + (etat === 'inversee'
              ? 'Ce régime a historiquement précédé les récessions US, avec de longs délais et sans date.'
              : 'Lecture d\'école : une inversion durable (écart négatif) a historiquement précédé les récessions US.');

          // Fraîcheur HONNÊTE : l'horodatage vient de la RÉPONSE (cache serveur 10 min), jamais
          // de la lecture. Garde == null : un updatedAt absent ne devient pas « 1970 ».
          var ts = d.updatedAt != null ? +d.updatedAt : 0;

          host.innerHTML = '<div class="wdg-ct">'
            + '<div class="wdg-ct-tete"><span>Trésor US : 3 mois à 30 ans</span>'
            + '<span class="wdg-ct-e ' + cls + '">10a-3m ' + fmtPt(ecart) + ' pt</span></div>'
            + '<div class="wdg-ct-zone">' + svg + labs + '</div>'
            + '<div class="wdg-ct-ech">' + axe + '</div>'
            + (ecarts.length >= 2
              ? '<div class="wdg-ct-sec"><div class="wdg-ct-sect"><span>Écart 10 ans - 3 mois, 90 jours</span></div>'
                + '<div class="wdg-ct-spark">' + _courbeSvg(ecarts, { zero: true, aire: true }) + '</div></div>' : '')
            + '<div class="wdg-verdict" data-etat="' + etat + '"><b class="wdg-verdict-txt wdg-maj-txt">' + vtxt + '</b>'
            + '<span class="wdg-verdict-sous">' + esc(vsous) + '</span></div>'
            + '<div class="wdg-ct-pied">Rendements cotés en séance US, cache serveur 10 min. ' + _vieSpan(ts) + '</div>'
            + '</div>';

          // Fondu de MAJ : uniquement quand l'état ou l'écart arrondi change réellement.
          var cle = etat + '|' + ecart.toFixed(2);
          if (prevCle != null && cle !== prevCle) _majFlash(host.querySelector('.wdg-verdict-txt'));
          prevCle = cle;
        }

        function dessiner() {
          fetch('/api/us-yields').then(function (r) {
            if (!r.ok) throw new Error('http');
            return r.json();
          }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            rendre(d);
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Rendements indisponibles.'); });
        }
        dessiner();
        // Aligné sur le cache serveur (10 min), et l'intervalle SE RÉPARE tout seul : après un
        // échec (fallback affiché), le tour suivant retente. On saute le tour onglet caché.
        var iv = setInterval(function () { if (!document.hidden) dessiner(); }, 10 * 60 * 1000);
        return function () { vivant = false; try { clearInterval(iv); } catch (e) {} };
      },
    },
    {
      /* PROCHAINE RÉUNION BC (23/08). Même source /api/rates que « Taux directeurs » et
         « Différentiel de taux » : les trois cartes ne peuvent pas se contredire. Celle-ci répond
         « QUAND tombe la prochaine décision, et qu'est-ce qui est déjà dans les prix » : les huit
         banques triées par réunion la plus proche, compte à rebours vivant, scénario dominant.
         ⚠️ Pas de champ `maj` : le chrono 1 s vit DANS le mount : un remontage périodique
         recréerait le chrono et ferait cligner la liste ; le re-fetch 5 min est interne. */
      id: 'reunion-bc', name: 'Prochaine réunion BC', tag: 'RÉUNIONS', cat: 'Macro', h: 300,
      desc: 'Les huit banques centrales classées par réunion la plus proche : compte à rebours et scénario pricé.',
      aide: "<p>Chaque banque centrale est classée par la date de sa <strong>prochaine réunion</strong>, avec un compte à rebours jusqu'au jour J et le scénario que le marché price le plus (maintien, hausse ou baisse, avec sa probabilité). La ligne du haut, marquée en or, est la prochaine décision toutes banques confondues.</p><p>La probabilité dit ce qui est <strong>déjà dans les prix</strong> : une décision conforme au scénario dominant fait peu bouger la devise, c'est la surprise qui la déplace. Un pricing partagé (aucune issue au-dessus de 60%) signale une réunion à vrai risque de mouvement.</p>",
      src: "Les mêmes taux et probabilités de marché que l'onglet TAUX du desk, relus toutes les 5 minutes ; la source donne le jour de chaque réunion, pas l'heure de la décision : le compte à rebours vise le jour J.",
      watch: "Les réunions à pricing partagé et les probabilités qui se déplacent dans les derniers jours : le repricing d'avant réunion fait souvent bouger la devise davantage que la décision elle-même.",
      // Réglage UTILE (même motif que « Taux directeurs ») : suivre UNE banque : la carte devient
      // un compte à rebours dédié à la seule courbe de politique monétaire qu'on trade.
      opts: [{ k: 'banque', lbl: 'Banque', type: 'choix', def: 'all',
        /* LES BANQUES SONT NOMMÉES EN ENTIER (01/09, liste de référence fournie). Le sélecteur ne
           portait que des sigles — « BoE », « SNB », « RBNZ » — qui supposent de les connaître déjà,
           et « SNB » était même resté en anglais dans un desk qui parle français. Les noms complets
           existent depuis toujours côté serveur (`CB[].full`) : on les reprend, sigle entre
           parenthèses pour qui lit vite. Aucune donnée nouvelle. */
        choix: [['all', 'Toutes']].concat([['USD', 'Réserve fédérale (Fed)'], ['EUR', 'Banque centrale européenne (BCE)'], ['GBP', 'Banque d\'Angleterre (BoE)'], ['JPY', 'Banque du Japon (BoJ)'], ['CHF', 'Banque nationale suisse (BNS)'], ['CAD', 'Banque du Canada (BoC)'], ['AUD', 'Banque de réserve d\'Australie (RBA)'], ['NZD', 'Banque de réserve de Nouvelle-Zélande (RBNZ)']]) }],
      mount: function (host, it) {
        var W = this, vivant = true;
        /* Mémoire du verdict : le fondu ne se joue que sur un VRAI changement (banque de tête,
           scénario, probabilité, date), jamais parce que le rebours a avancé d'une seconde. */
        var prevCle = null;
        skel(host, 8);
        var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
        function fmtD(iso) { try { var p = String(iso).split('-'); return parseInt(p[2], 10) + ' ' + MOIS[parseInt(p[1], 10) - 1]; } catch (e) { return esc(iso); } }
        /* Cible du rebours = MINUIT UTC du jour de réunion : la source donne le jour, jamais
           l'heure de la décision : le pied de carte le dit, on ne fabrique pas une précision qui
           n'existe pas. Garde isFinite : un `next` absent ou illisible rend null, pas NaN. */
        function cibleMs(b) { var t = Date.parse(String((b && b.next) || '') + 'T00:00:00Z'); return isFinite(t) ? t : null; }
        function rebours(t) {
          var d = t - Date.now();
          if (d <= 0) return 'aujourd\'hui';
          if (d < 24 * 3600e3) {
            var h = Math.floor(d / 3600e3), m = Math.floor(d % 3600e3 / 60e3), sec = Math.floor(d % 60e3 / 1e3);
            return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
          }
          var j = Math.floor(d / 86400e3), h2 = Math.floor(d % 86400e3 / 3600e3);
          return j + ' j ' + h2 + ' h';
        }
        // Variante du VERDICT : « dans 3 j 14 h » ou « aujourd'hui » : le mot « dans » vit DANS le
        // span retimbré, sinon le passage au jour J écrirait « dans aujourd'hui ».
        function reboursV(t) { return t - Date.now() <= 0 ? 'aujourd\'hui' : 'dans ' + rebours(t); }
        function scnDom(b) {
          var sc = (b && b.scenario) || {};
          var cands = [['hold', sc.hold], ['hike', sc.hike], ['cut', sc.cut]].filter(function (x) { return x[1] != null && isFinite(x[1]); });
          if (!cands.length) return null;
          cands.sort(function (a, b2) { return (b2[1] || 0) - (a[1] || 0); });
          return { type: cands[0][0], pct: Math.round(cands[0][1]) };
        }
        // Accords écrits une fois : « maintien pricé à » mais « hausse pricée à » (féminin).
        var SCN = {
          hold: { t: 'Maintien', vp: 'maintien pricé à', cls: 'est-neutre' },
          hike: { t: 'Hausse', vp: 'hausse pricée à', cls: 'est-haut' },
          cut: { t: 'Baisse', vp: 'baisse pricée à', cls: 'est-bas' },
        };

        function dessiner() {
          fetch('/api/rates').then(function (r) {
            if (!r.ok) throw new Error('http');
            return r.json();
          }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            var banks = ((d && d.banks) || []).filter(function (b) { return b && b.code; });
            var veut = opt(it, W, 'banque') || 'all';
            if (veut !== 'all') banks = banks.filter(function (b) { return b.code === veut; });
            if (!banks.length) { fallback(host, 'Réunions indisponibles.'); return; }
            var lignes = banks.map(function (b) { return { b: b, t: cibleMs(b), scn: scnDom(b) }; });
            /* Réunion la plus PROCHE d'abord ; une banque sans date connue descend en bas mais ne
               disparaît pas : une ligne honnête « date inconnue » vaut mieux qu'une absence muette. */
            lignes.sort(function (a, b2) { return (a.t == null ? Infinity : a.t) - (b2.t == null ? Infinity : b2.t); });
            var iPrem = -1;
            lignes.forEach(function (l, i) { if (iPrem < 0 && l.t != null) iPrem = i; });

            var html = '<div class="wdg-rbc"><div class="wdg-rbc-liste custom-scrollbar">'
              + '<div class="wdg-rbc-head"><span>Banque</span><span>Réunion</span><span class="r">Rebours</span><span class="r">Scénario pricé</span></div>';
            lignes.forEach(function (l, i) {
              var b = l.b;
              // Pricing PARTAGÉ : le dominant sous 60 % : la réunion est une vraie inconnue.
              var partage = l.scn != null && l.scn.pct < 60;
              var scnH = l.scn
                ? '<span class="wdg-rbc-scn ' + SCN[l.scn.type].cls + (partage ? ' est-partage' : '') + '"'
                  + (partage ? ' title="Pricing partagé : aucune issue ne dépasse 60%"' : '') + '>'
                  + SCN[l.scn.type].t + ' ' + l.scn.pct + ' %</span>'
                : '<span class="wdg-rbc-scn">-</span>';
              html += '<div class="wdg-rbc-l' + (i === iPrem ? ' est-present' : '') + '">'
                + '<span class="wdg-rbc-bq">' + _drapeauDev(b.code) + '<b>' + esc(b.bank || b.code) + '</b></span>'
                + '<span class="wdg-rbc-date">' + (b.next ? fmtD(b.next) : 'date inconnue') + '</span>'
                + (l.t != null ? '<span class="wdg-rbc-cpt" data-cible="' + l.t + '">' + rebours(l.t) + '</span>'
                  : '<span class="wdg-rbc-cpt">-</span>')
                + scnH + '</div>';
            });
            html += '</div>';

            // ── Verdict : la prochaine décision toutes banques confondues, puis la suivante et
            //    les issues OUVERTES (pricing partagé). Factuel : rien ne dit quoi trader.
            var vbH, vsT, etatV, cle;
            var prem = iPrem >= 0 ? lignes[iPrem] : null;
            if (prem) {
              var pb = prem.b, ps = prem.scn;
              etatV = ps ? ps.type : 'inconnu';
              vbH = 'Prochaine décision : <span class="est-present">' + esc(pb.bank || pb.code) + '</span> '
                + '<span class="wdg-rbc-vcpt" data-cible="' + prem.t + '">' + reboursV(prem.t) + '</span>'
                + (ps ? ' : <span class="' + SCN[ps.type].cls + '">' + SCN[ps.type].vp + ' ' + ps.pct + ' %</span>' : '');
              var suiv = null;
              for (var k = iPrem + 1; k < lignes.length; k++) if (lignes[k].t != null) { suiv = lignes[k]; break; }
              var parts = lignes.filter(function (l) { return l.scn != null && l.scn.pct < 60; })
                .map(function (l) { return (l.b.bank || l.b.code) + ' (' + l.scn.pct + ' %)'; });
              vsT = (suiv ? 'Ensuite : ' + (suiv.b.bank || suiv.b.code) + ' le ' + fmtD(suiv.b.next) + '. ' : '')
                + (parts.length ? 'Issue ouverte (dominant sous 60%) : ' + parts.join(', ') + '.'
                  : 'Aucune issue ouverte : chaque scénario dominant dépasse 60%.');
              cle = pb.code + '|' + (ps ? ps.type + ps.pct : '') + '|' + (pb.next || '');
            } else {
              etatV = 'inconnu';
              vbH = 'Aucune date de réunion connue';
              vsT = 'La source n\'annonce de date pour aucune banque affichée.';
              cle = 'aucune';
            }
            var ts = d && d.asOf != null ? +d.asOf : 0;
            html += '<div class="wdg-verdict" data-etat="' + etatV + '"><b class="wdg-verdict-txt wdg-maj-txt">' + vbH + '</b>'
              + '<span class="wdg-verdict-sous">' + esc(vsT) + '</span></div>'
              + '<div class="wdg-rbc-pied">Le rebours vise le JOUR de la réunion : la source donne la date, pas l\'heure de la décision. Probabilités de marché relues toutes les 5 min. ' + _vieSpan(ts) + '</div>'
              + '</div>';
            host.innerHTML = html;
            if (prevCle != null && cle !== prevCle) _majFlash(host.querySelector('.wdg-verdict-txt'));
            prevCle = cle;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Réunions indisponibles.'); });
        }

        /* Chrono 1 s : réécrit les rebours EN PLACE, jamais un re-rendu complet à la seconde (la
           liste ne doit pas cligner, et le scroll ne doit pas se perdre). Garde document.hidden :
           un onglet caché n'anime rien ; au retour, le premier tour recale tout d'un coup. */
        var ivT = setInterval(function () {
          if (document.hidden || !host.isConnected) return;
          var ns = host.querySelectorAll('[data-cible]');
          for (var i = 0; i < ns.length; i++) {
            var t = +ns[i].getAttribute('data-cible');
            if (!t) continue;
            ns[i].textContent = ns[i].classList.contains('wdg-rbc-vcpt') ? reboursV(t) : rebours(t);
          }
        }, 1000);
        dessiner();
        // Aligné sur le rythme de la source (comme « Taux directeurs ») ; l'intervalle se répare
        // tout seul après un échec : le tour suivant retente.
        var iv = setInterval(function () { if (!document.hidden) dessiner(); }, 5 * 60 * 1000);
        return function () {
          vivant = false;
          try { clearInterval(iv); } catch (e) {}
          try { clearInterval(ivT); } catch (e) {}
        };
      },
    },
    {
      /* CORRÉLATIONS ENTRE PAIRES (23/08). Les 7 majors contre USD en JOURNALIER : rendements
         ln(c/c_prev) appariés par jour UTC (helpers _cx*, testés au banc), Pearson sur les 30
         dernières séances COMMUNES de chaque couple. Matrice TRIANGULAIRE : la moitié haute ne
         ferait que répéter la moitié basse. La corrélation porte sur les PAIRES telles qu'elles
         cotent (USD/JPY monte quand le yen baisse) : c'est la lecture utile pour le RECOUVREMENT
         de positions, et c'est ce que dit le verdict — un constat d'exposition, jamais un
         conseil. Les 7 fetchs passent par le cache OHLC partagé (TTL 5 min) : les cartes qui
         suivent déjà ces paires ne coûtent aucune requête de plus. */
      id: 'correlations', name: 'Corrélations', tag: 'CORRÉLATIONS', cat: 'Marchés', h: 320,
      desc: 'La corrélation sur 30 séances entre les 7 paires majeures, en matrice triangulaire.',
      aide: "<p>Chaque cellule mesure à quel point deux paires évoluent ensemble sur leurs 30 dernières séances communes : vert quand elles montent et baissent de concert, rouge quand l'une monte quand l'autre baisse, d'autant plus soutenu que le lien est fort (r × 100 dans la cellule). La corrélation porte sur les paires telles qu'elles cotent : USD/JPY qui monte, c'est le dollar qui monte face au yen.</p><p>La lecture de décision est le <strong>recouvrement d'exposition</strong> : deux positions dans le même sens sur un couple très corrélé font une seule exposition, pas deux ; sur un couple très anti-corrélé, elles se compensent en partie. Une corrélation dit ce qui s'est mesuré, jamais ce qui va durer.</p>",
      src: "Clôtures quotidiennes réelles des 7 paires contre dollar, relues toutes les 5 minutes ; rendements logarithmiques appariés par jour UTC, 30 dernières séances communes par couple et 20 minimum : en dessous, la cellule se tait.",
      watch: "Les couples au-delà de ±0,80 : c'est là que deux positions « différentes » n'en font qu'une ; et le changement de camp d'un couple habituellement corrélé, souvent la trace d'une histoire locale (banque centrale, chiffre national) qui casse le régime commun.",
      mount: function (host) {
        var vivant = true, cache = {};
        var prevCle = null;   // fondu de MAJ : seulement quand les couples de tête changent réellement
        skel(host, 6);
        var PAIRES = _PS_PAIRES;   // les 7 majors contre USD, même liste que « Performance de la semaine »
        function fmtR(r) { return (r > 0 ? '+' : '') + r.toFixed(2).replace('.', ','); }

        function dessiner() {
          Promise.all(PAIRES.map(function (p) {
            // Une paire muette ne fait pas tomber la matrice : sa ligne rend « n/d », le reste vit.
            return _bougies(p, 'D1', cache).catch(function () { return null; });
          })).then(function (res) {
            if (!vivant || !host.isConnected) return;
            var rend = {}, nDispo = 0;
            PAIRES.forEach(function (p, i) {
              if (res[i] && res[i].length >= 2) { rend[p] = _cxRendements(res[i]); nDispo++; }
            });
            if (nDispo < 2) { fallback(host, 'Bougies indisponibles.'); return; }

            // r par couple (clé 'colonne|ligne', colonne < ligne) + extrêmes pour le verdict.
            var R = {}, plus = null, moins = null;
            for (var i = 1; i < PAIRES.length; i++) {
              for (var j = 0; j < i; j++) {
                var cple = (rend[PAIRES[j]] && rend[PAIRES[i]]) ? _cxCouple(rend[PAIRES[j]], rend[PAIRES[i]]) : null;
                R[j + '|' + i] = cple;
                if (!cple) continue;
                if (!plus || cple.r > plus.r) plus = { a: PAIRES[j], b: PAIRES[i], r: cple.r, n: cple.n };
                if (!moins || cple.r < moins.r) moins = { a: PAIRES[j], b: PAIRES[i], r: cple.r, n: cple.n };
              }
            }

            /* Matrice triangulaire. En-têtes SANS barre oblique (sept colonnes ne laissent pas la
               place), l'infobulle porte le nom complet. Les cellules au-dessus de la diagonale
               sont des vides de grille : les rendre « miroir » doublerait le bruit sans informer. */
            var h = '<div class="wdg-cx"><div class="wdg-cx-grille" style="grid-template-columns:auto repeat(' + (PAIRES.length - 1) + ',1fr)">';
            h += '<span class="wdg-cx-coin"></span>';
            var k;
            for (k = 0; k < PAIRES.length - 1; k++) {
              h += '<span class="wdg-cx-et" title="' + esc(PAIRES[k]) + '">' + esc(PAIRES[k].replace('/', '')) + '</span>';
            }
            for (var li = 1; li < PAIRES.length; li++) {
              h += '<span class="wdg-cx-lg" title="' + esc(PAIRES[li]) + '">' + esc(PAIRES[li].replace('/', '')) + '</span>';
              for (var co = 0; co < PAIRES.length - 1; co++) {
                if (co >= li) { h += '<span class="wdg-cx-vide"></span>'; continue; }
                var cel = R[co + '|' + li];
                if (!cel) {
                  // Moins de 20 séances communes (ou paire muette) : silence chiffré, dit tel quel.
                  h += '<span class="wdg-cx-c est-nd" title="' + esc(PAIRES[co] + ' vs ' + PAIRES[li]) + ' : moins de ' + _CX_MIN + ' séances communes">n/d</span>';
                  continue;
                }
                var av = Math.min(Math.abs(cel.r), 1);
                // Fond vert/rouge par SIGNE, alpha par FORCE (mêmes rampes que la carte de
                // chaleur) ; le texte reste un token de thème, lisible sur ces fonds translucides.
                var fond = cel.r >= 0 ? 'rgba(0,230,118,' + (0.08 + av * 0.5).toFixed(2) + ')' : 'rgba(255,61,0,' + (0.08 + av * 0.5).toFixed(2) + ')';
                var force = av > 0.8 ? ' est-fort' : av >= 0.5 ? ' est-modere' : ' est-faible';
                h += '<span class="wdg-cx-c' + force + '" style="background:' + fond + '"'
                  + ' title="' + esc(PAIRES[co] + ' vs ' + PAIRES[li] + ' : r ' + fmtR(cel.r) + ' sur ' + cel.n + ' séances communes') + '">'
                  + (cel.r > 0 ? '+' : cel.r < 0 ? '-' : '') + Math.round(Math.abs(cel.r) * 100) + '</span>';
              }
            }
            h += '</div>';

            /* ── VERDICT : le couple le plus corrélé et le plus anti-corrélé. Nommés seulement
               au-delà de ±0,50 : présenter un r de +0,3 comme « le couple le plus corrélé »
               fabriquerait un lien qui n'existe pas. Constat d'exposition, jamais un conseil. */
            var vb = '', vs = '', etat = 'faible', cle = 'rien';
            if (plus) {
              if (plus.r >= 0.5) {
                etat = plus.r > 0.8 ? 'fort' : 'modere';
                vb = '<span class="est-haut">' + esc(plus.a) + ' et ' + esc(plus.b) + '</span> évoluent ensemble (r '
                  + fmtR(plus.r) + ' sur ' + plus.n + ' séances)';
                vs = 'Deux positions dans le même sens y font une seule exposition.';
              } else {
                vb = 'Aucun couple nettement corrélé (max r ' + fmtR(plus.r) + ')';
                vs = 'Les 7 majors vivent chacune leur vie sur la fenêtre mesurée.';
              }
              if (moins && moins.r <= -0.5) {
                vs += ' À l\'opposé : ' + moins.a + ' et ' + moins.b + ' (r ' + fmtR(moins.r) + '), deux positions de même sens s\'y compensent en partie.';
              }
              cle = plus.a + plus.b + plus.r.toFixed(2) + '|' + (moins ? moins.a + moins.b + moins.r.toFixed(2) : '');
            }

            var ts = 0;
            PAIRES.forEach(function (p) { var t = _bougiesMaj(p + '|D1'); if (t > ts) ts = t; });
            if (vb) {
              h += '<div class="wdg-verdict" data-etat="' + etat + '"><b class="wdg-verdict-txt wdg-maj-txt">' + vb + '</b>'
                + (vs ? '<span class="wdg-verdict-sous">' + esc(vs) + '</span>' : '') + '</div>';
            }
            h += '<div class="wdg-cx-pied">Rendements quotidiens (ln), 30 dernières séances communes par couple, 20 minimum. Cellules : r × 100. ' + _vieSpan(ts) + '</div></div>';
            host.innerHTML = h;
            if (prevCle != null && cle !== prevCle) _majFlash(host.querySelector('.wdg-verdict-txt'));
            prevCle = cle;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Bougies indisponibles.'); });
        }
        dessiner();
        var stop = _rafraichirBougies(host, dessiner);   // 5 min : le TTL du cache OHLC partagé
        return function () { vivant = false; stop(); };
      },
    },
    {
      /* VOLATILITÉ PAR HEURE (23/08). ~3 mois de bougies HORAIRES d'une paire : amplitude
         (haut-bas) moyenne PAR HEURE UTC, affichée à l'heure de PARIS. Les seaux sont agrégés en
         UTC (stables quel que soit le fuseau du lecteur) puis replacés au décalage Paris MESURÉ
         PAR INTL pour maintenant : jamais un +1/+2 codé en dur, c'est le fuseau qui sait quand
         l'heure change — autour d'une bascule été/hiver, les créneaux historiques glissent d'une
         heure au plus, et c'est dit en pied plutôt que caché. L'heure COURANTE est marquée or
         PAR INDEX (option `marque` de _barresSvg, même mécanique que la saisonnalité). Mêmes
         gardes d'unité que « Amplitude par séance » : la route retombe sur le journalier quand
         elle ne reconnaît pas le tf demandé, et sans contrôle la carte publierait des « heures »
         calculées sur des journées entières. */
      id: 'vol-horaire', name: 'Volatilité par heure', tag: 'VOLATILITÉ', cat: 'Marchés', h: 300,
      desc: 'À quelles heures la paire bouge vraiment : amplitude moyenne des 24 heures, heure de Paris.',
      aide: "<p>Pour la paire choisie, l'amplitude moyenne (haut moins bas, en pips) de chaque heure de la journée sur environ trois mois de bougies horaires, affichée à l'heure de Paris ; la barre or est l'heure en cours. Le verdict nomme le pic et le creux avec leur créneau (ouverture Europe, ouverture US, nuit calme…).</p><p>La volatilité ne se répartit pas au hasard : elle se concentre aux <strong>ouvertures de places</strong> et sur le recouvrement Londres-New York. Savoir si l'heure actuelle est un pic ou un creux type change la lecture d'un mouvement : le même chemin parcouru à 4h du matin et à 15h30 ne raconte pas la même chose.</p>",
      src: "Bougies horaires réelles (~3 mois), relues toutes les 5 minutes ; moyennes par heure UTC replacées au décalage Paris du moment, mesuré par le fuseau lui-même : autour d'un changement d'heure, les créneaux historiques glissent d'une heure au plus.",
      watch: "Une séance qui s'anime dans un creux type (nuit, avant l'Europe) : ce n'est pas une heure qui bouge d'habitude, donc quelque chose la fait bouger ; et l'entrée dans le pic 14h-17h, où se jouent la plupart des cassures de la journée.",
      opts: [{ k: 'paire', lbl: 'Paire', type: 'choix', def: 'EUR/USD', choix: _fxChoix() }],
      mount: function (host, it) {
        var W = this, vivant = true, cache = {};
        var prevCle = null;
        skel(host, 5);
        function dessiner() {
          var sym = opt(it, W, 'paire') || 'EUR/USD';
          var pip = _pipTaille(sym);
          if (!pip) { fallback(host, 'Réservé aux paires de devises.'); return; }
          _bougies(sym, 'H1', cache).then(function (c) {
            if (!vivant || !host.isConnected) return;
            // Sous 200 bougies, une moyenne par heure reposerait sur une poignée de séances : silence.
            if (c.length < 200) { fallback(host, 'Historique horaire insuffisant.'); return; }
            var pas = _pasMedian(c);
            if (!pas || pas < 30 * 60000 || pas > 2 * 3600000) {
              fallback(host, 'La source n\'a pas servi de bougies horaires pour cette paire.');
              return;
            }
            /* Agrégat par heure UTC. L'heure EN COURS est exclue : une bougie encore ouverte
               sous-estime son amplitude (règle de la famille : l'inachevé ne rentre pas dans la
               moyenne à laquelle on le compare). */
            var hVive = Math.floor(Date.now() / 3600e3) * 3600e3;
            var somme = [], nb = [], k;
            for (k = 0; k < 24; k++) { somme.push(0); nb.push(0); }
            var jours = {};
            c.forEach(function (b) {
              if (b.t >= hVive) return;
              var amp = (b.h - b.l) / pip;
              if (!(amp >= 0)) return;
              var hU = new Date(b.t).getUTCHours();
              somme[hU] += amp; nb[hU]++;
              jours[new Date(b.t).toISOString().slice(0, 10)] = 1;
            });
            /* Décalage Paris-UTC de MAINTENANT via _heureLocale (Intl). L'heure rendue est une
               fraction : on la tronque, le décalage Paris-UTC est toujours un entier d'heures. */
            var hPar = _heureLocale('Europe/Paris', Date.now());
            var hNow = hPar == null ? null : Math.floor(hPar);
            var decal = hNow == null ? 0 : ((hNow - new Date().getUTCHours()) % 24 + 24) % 24;
            // moy[heure de Paris] : chaque seau UTC replacé sous son étiquette parisienne.
            var moy = [];
            for (k = 0; k < 24; k++) {
              var hU2 = ((k - decal) % 24 + 24) % 24;
              moy.push(nb[hU2] ? somme[hU2] / nb[hU2] : null);
            }
            var pc = _vhPicCreux(moy);
            if (!pc) { fallback(host, 'Trop peu d\'heures documentées pour cette paire.'); return; }

            // Barres or : pleines pour l'heure en cours, adoucies ailleurs — le liseré `marque`
            // dit « c'est maintenant », la hauteur dit le reste. Jamais de vert/rouge ici : une
            // amplitude n'a pas de sens directionnel.
            var coul = [];
            for (k = 0; k < 24; k++) coul.push(hNow != null && k === hNow ? 'var(--orange, #e3b23a)' : 'rgba(227, 178, 58, .38)');
            var fois = function (x) { return x.toFixed(1).replace('.', ',') + '×'; };
            var hTxt = function (x) { return x + 'h-' + ((x + 1) % 24) + 'h'; };

            /* ── VERDICT : pic et creux calculés (_vhPicCreux), créneau nommé par la table FIXE
               _vhSession, situation de l'heure actuelle. Factuel : rien ne dit quoi trader. */
            var vb = 'Pic de volatilité : <span class="est-present">' + hTxt(pc.pic) + '</span> (' + _vhSession(pc.pic) + '), '
              + fois(pc.rPic) + ' la moyenne des 24 h';
            var rNow = (hNow != null && typeof moy[hNow] === 'number' && isFinite(moy[hNow])) ? moy[hNow] / pc.moyG : null;
            var vs = 'Creux : ' + hTxt(pc.creux) + ' (' + _vhSession(pc.creux) + '), ' + fois(pc.rCreux) + '.'
              + (rNow != null
                ? ' L\'heure actuelle (' + hNow + 'h, ' + _vhSession(hNow) + ') est à ' + fois(rNow) + '.'
                : (hNow != null ? ' L\'heure actuelle (' + hNow + 'h) n\'a pas d\'historique coté.' : ''));
            var etat = rNow == null ? 'ordinaire' : rNow >= 1.5 ? 'pic' : rNow <= 0.5 ? 'creux' : 'ordinaire';

            // Axe : une étiquette toutes les 4 heures, posée au centre de sa barre (pourcentage).
            var axe = '';
            for (k = 0; k < 24; k += 4) {
              axe += '<span style="left:' + ((k + 0.5) / 24 * 100).toFixed(1) + '%">' + k + 'h</span>';
            }

            var ts = _bougiesMaj(sym + '|H1');
            host.innerHTML = '<div class="wdg-vh">'
              + '<div class="wdg-vh-tete"><span>' + esc(sym) + ' : amplitude par heure</span>'
              + '<span>' + Object.keys(jours).length + ' jours cotés</span></div>'
              + '<div class="wdg-vh-zone">' + _barresSvg(moy, { signe: false, couleurs: coul, marque: hNow == null ? null : hNow }) + '</div>'
              + '<div class="wdg-vh-ech">' + axe + '</div>'
              + '<div class="wdg-verdict" data-etat="' + etat + '"><b class="wdg-verdict-txt wdg-maj-txt">' + vb + '</b>'
              + '<span class="wdg-verdict-sous">' + esc(vs) + '</span></div>'
              + '<div class="wdg-vh-pied">Amplitude moyenne haut-bas par heure (pips), heure de Paris, barre or = heure en cours. '
              + _vieSpan(ts) + '</div></div>';

            // Fondu de MAJ : pic, creux, heure courante ou son ratio ont réellement bougé.
            var cle = sym + '|' + pc.pic + '|' + pc.creux + '|' + hNow + '|' + (rNow == null ? '' : rNow.toFixed(1));
            if (prevCle != null && cle !== prevCle) _majFlash(host.querySelector('.wdg-verdict-txt'));
            prevCle = cle;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Bougies indisponibles.'); });
        }
        dessiner();
        var stop = _rafraichirBougies(host, dessiner);
        return function () { vivant = false; stop(); };
      },
    },
    {
      /* ÉCART AU CONSENSUS (23/08). Les 10 dernières publications à FORT impact qui portent un
         réel ET un consensus, de la plus récente à la plus ancienne, chacune avec son badge
         au-dessus / en dessous / conforme (_ecBadge : le MOT vient du chiffre, la COULEUR de
         deviationClass, polarité chômage inversée là-bas — un chômage au-dessus rend donc
         « au-dessus » en rouge, deux informations, deux sources). Le bilan du bas compte la
         DIRECTION brute des surprises : « surprennent à la hausse » est un constat de chiffres,
         pas un jugement favorable, les compteurs restent donc SANS couleur. La « plus forte
         surprise » est classée à l'écart RELATIF (|delta| / |consensus|), seule grandeur
         comparable entre des indicateurs en %, en K et en M. */
      id: 'ecart-consensus', name: 'Écart au consensus', tag: 'SURPRISES', cat: 'Macro', h: 320,
      desc: 'Les 10 dernières publications fortes : réel contre consensus, et de quel côté elles surprennent.',
      aide: "<p>Les dix dernières publications à fort impact qui portent un réel et un consensus, de la plus récente à la plus ancienne : le badge dit si le chiffre est sorti au-dessus, en dessous ou conforme, et de combien. La couleur suit le sens favorable à la devise : pour un chômage, « au-dessus » s'affiche en rouge.</p><p>Ce qui déplace un marché n'est pas le niveau d'un chiffre mais sa <strong>surprise</strong>, et la ligne du bas dit de quel côté les données surprennent ces derniers jours : une série de surprises du même côté nourrit les anticipations de taux bien plus qu'une publication isolée.</p>",
      src: "Le calendrier économique du desk, publications passées à fort impact, relu toutes les 5 minutes ; réel et consensus ne sont comparés qu'à unités identiques, jamais des K contre des M.",
      watch: "Un enchaînement de surprises du même côté sur une même devise, et les écarts relatifs les plus forts : ce sont eux qui déplacent les anticipations de taux, bien avant les réunions.",
      // Réglage UTILE (même motif que le compte à rebours) : suivre les surprises d'UNE devise.
      opts: [{ k: 'devise', lbl: 'Devise', type: 'choix', def: 'all',
        choix: [['all', 'Toutes'], ['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['JPY', 'JPY'],
          ['AUD', 'AUD'], ['NZD', 'NZD'], ['CAD', 'CAD'], ['CHF', 'CHF'], ['CNY', 'CNY']] }],
      mount: function (host, it) {
        var W = this, vivant = true;
        var prevCle = null, dernierFetch = 0;
        skel(host, 6);
        var flag = (typeof CAL_FLAG === 'function') ? CAL_FLAG : function () { return ''; };
        function charger() {
          fetch('/api/calendar-events').then(function (r) {
            if (!r.ok) throw new Error('http');
            return r.json();
          }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            dernierFetch = Date.now();
            var dev = opt(it, W, 'devise') || 'all';
            var maintenant = Date.now();
            // PASSÉ seulement, fort impact, réel ET consensus présents : la carte parle de
            // surprises constatées, jamais d'événements à venir (le rebours s'en charge).
            var rows = ((d && d.items) || []).filter(function (e) {
              if (!e || !e.timestamp || e.timestamp > maintenant) return false;
              if (e.impact !== 'High') return false;
              if (dev !== 'all' && e.currency !== dev) return false;
              return !!(e.actual && String(e.actual).trim() && e.forecast && String(e.forecast).trim());
            }).sort(function (a, b) { return b.timestamp - a.timestamp; }).slice(0, 10);
            if (!rows.length) { fallback(host, 'Aucune publication forte avec réel et consensus.'); return; }

            var nDessus = 0, nDessous = 0, nConf = 0, plusForte = null;
            var h = '<div class="wdg-ec"><div class="wdg-ec-liste custom-scrollbar">'
              + '<div class="wdg-ec-head"><span>Publication</span><span class="r">Réel / attendu</span><span class="r">Écart</span></div>';
            rows.forEach(function (e) {
              var b = _ecBadge(e);
              if (b) {
                if (b.sens > 0) nDessus++; else if (b.sens < 0) nDessous++; else nConf++;
                if (b.rel != null && b.sens !== 0 && (!plusForte || b.rel > plusForte.rel)) plusForte = { e: e, rel: b.rel };
              }
              var quand = '';
              try { quand = new Date(e.timestamp).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }); } catch (er) {}
              h += '<div class="wdg-ec-l" title="' + esc((e.title || '') + (quand ? ' · ' + quand : '') + ' · réel ' + e.actual + ', attendu ' + e.forecast) + '">'
                + '<span class="wdg-ec-t">' + flag(e.currency) + '<b>' + esc(e.title || '') + '</b><i>' + esc(quand) + '</i></span>'
                + '<span class="wdg-ec-v"><b>' + esc(String(e.actual)) + '</b> / ' + esc(String(e.forecast)) + '</span>'
                + (b
                  ? '<span class="wdg-ec-b ' + b.cls + '">' + b.mot + (b.delta ? ' ' + b.delta : '') + '</span>'
                  // Unités différentes ou valeur illisible : pas de badge inventé, un « n/c » honnête.
                  : '<span class="wdg-ec-b est-nc" title="Valeurs non comparables (unités différentes ou illisibles)">n/c</span>')
                + '</div>';
            });
            h += '</div>';

            /* ── VERDICT : bilan directionnel des N + la plus forte surprise, en écart relatif. */
            var nJuges = nDessus + nDessous + nConf;
            var vb = '', vs = '', etat = 'partage';
            if (nJuges) {
              etat = nDessus > nDessous ? 'hausse' : nDessous > nDessus ? 'baisse' : 'partage';
              vb = nDessus + ' au-dessus, ' + nDessous + ' en dessous' + (nConf ? ', ' + nConf + ' conforme' + (nConf > 1 ? 's' : '') : '')
                + ' : les publications ' + (etat === 'hausse' ? 'surprennent plutôt à la hausse'
                  : etat === 'baisse' ? 'surprennent plutôt à la baisse' : 'ne penchent d\'aucun côté');
              if (plusForte) {
                vs = 'La plus forte, en écart relatif au consensus : ' + (plusForte.e.title || '')
                  + ' (réel ' + plusForte.e.actual + ' vs ' + plusForte.e.forecast + ' attendu).';
              }
              if (rows.length < 10) vs += (vs ? ' ' : '') + 'Bilan sur les ' + rows.length + ' publications disponibles.';
            }
            if (vb) {
              h += '<div class="wdg-verdict" data-etat="' + etat + '"><b class="wdg-verdict-txt wdg-maj-txt">' + esc(vb) + '</b>'
                + (vs ? '<span class="wdg-verdict-sous">' + esc(vs) + '</span>' : '') + '</div>';
            }
            h += '<div class="wdg-ec-pied">Fort impact, passé seulement. La couleur suit le sens FAVORABLE (chômage inversé), le mot suit le chiffre. ' + _vieSpan(dernierFetch) + '</div></div>';
            host.innerHTML = h;
            var cle = rows.map(function (e) { return e.timestamp + '|' + e.actual; }).join(';');
            if (prevCle != null && cle !== prevCle) _majFlash(host.querySelector('.wdg-verdict-txt'));
            prevCle = cle;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Calendrier indisponible.'); });
        }
        charger();
        // 5 min, garde de visibilité : le calendrier serveur est lui-même en cache de quelques minutes.
        var iv = setInterval(function () { if (!document.hidden && host.isConnected) charger(); }, 5 * 60 * 1000);
        return function () { vivant = false; try { clearInterval(iv); } catch (e) {} };
      },
    },
    {
      /* INDICES & MATIÈRES PREMIÈRES (27/08). La première carte du desk qui ne parle PAS de change
         — retour client : « rajoute les indices et plus de marché, que le forex c'est frustrant ».
         Sept instruments servis par la même route que les paires (`/api/bank-ohlc?sym=…`), donc
         aucune source nouvelle et aucun coût nouveau : ils alimentent déjà le widget Graphique.
         DEUX HORIZONS, ET C'EST VOULU : la dernière SÉANCE cotée (le mouvement du moment) et la
         semaine depuis lundi (le flux). Une seule des deux se lit mal — une séance isolée est du
         bruit, une semaine seule rate le retournement du jour.
         La barre bidirectionnelle reprend EXACTEMENT la grammaire de Performance hebdo et du
         différentiel de taux : axe au centre, vert à droite, rouge à gauche. Le desk n'a qu'une
         façon de dessiner une variation ; en inventer une seconde pour cette carte obligerait le
         lecteur à réapprendre à lire. */
      id: 'indices-matieres', name: 'Indices & Matières', tag: 'HORS FX', cat: 'Marchés', h: 300,
      desc: 'Les indices et les matières premières du desk : dernière séance et semaine, côte à côte.',
      aide: "<p>Sept marchés hors change : quatre indices actions (DAX 40, S&amp;P 500, FTSE 100, CAC 40) et trois matières premières (Or, Argent, Pétrole WTI). Pour chacun, la variation de sa <strong>dernière séance cotée</strong> et celle de la <strong>semaine depuis lundi 00h UTC</strong>. Barre verte vers la droite : le marché monte ; rouge vers la gauche : il baisse.</p><p>Ces places n'ouvrent pas aux mêmes heures. Quand New York cote, Francfort et Paris sont fermés depuis des heures, et le week-end aucune ne cote : chaque ligne se compare donc à SA propre clôture précédente, jamais à une heure d'horloge commune. Une place fermée garde la variation de sa dernière séance, ce qui reste l'information juste.</p><p>La lecture croisée est ce qui manque au change seul : un dollar qui monte pendant que l'or monte AUSSI ne raconte pas la même histoire qu'un dollar qui monte pendant que l'or baisse. Le premier sent la fuite vers la qualité, le second le simple différentiel de taux.</p>",
      src: "Bougies quotidiennes réelles, servies par la même route que les paires de devises et relues toutes les 5 minutes. La variation de séance compare la dernière clôture à la précédente ; la variation hebdomadaire court du lundi 00h UTC, avec le même calcul que Performance hebdo.",
      watch: "La divergence entre les deux colonnes : un marché rouge sur la séance mais vert sur la semaine corrige, il ne retourne pas. Et l'or face aux indices — quand ils vont dans le même sens, c'est la liquidité qui parle ; quand ils s'opposent, c'est le risque.",
      mount: function (host) {
        var vivant = true, cache = {};
        skel(host, 9);
        function fmtP(v) { return (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + '%'; }
        function cls(v) { return v > 0 ? 'est-haut' : v < 0 ? 'est-bas' : ''; }
        function dessiner() {
          Promise.all(_XA_INSTR.map(function (x) {
            return _bougies(x.nom, 'D1', cache).catch(function () { return null; });
          })).then(function (res) {
            if (!vivant || !host.isConnected) return;
            var lignes = [];
            _XA_INSTR.forEach(function (x, i) {
              var s = res[i] ? _xaSeance(res[i]) : null;
              if (!s) return;                              // instrument muet : ligne absente, pas inventée
              var sem = res[i] ? _psVarSemaine(res[i]) : null;
              lignes.push({ x: x, pct: s.pct, close: s.close, t: s.t,
                sem: (sem && sem.etat === 'ok') ? sem.pct : null });
            });
            if (!lignes.length) { fallback(host, 'Bougies indisponibles.'); return; }

            /* L'ÉCHELLE DES BARRES EST COMMUNE À TOUTE LA CARTE, et c'est ce qui la rend lisible :
               une barre par ligne normalisée sur elle-même donnerait sept barres pleines et
               n'apprendrait rien. Le pétrole bouge structurellement plus qu'un indice — c'est
               précisément ce que la carte doit MONTRER. */
            var max = 0;
            lignes.forEach(function (r) { if (Math.abs(r.pct) > max) max = Math.abs(r.pct); });
            if (!(max > 0)) max = 1;

            var h = '<div class="wdg-xa"><div class="wdg-xa-liste">';
            var grpVu = null;
            lignes.forEach(function (r) {
              if (r.x.grp !== grpVu) {
                grpVu = r.x.grp;
                h += '<div class="wdg-xa-grp">' + esc(grpVu) + '</div>';
              }
              var w = Math.min(50, Math.abs(r.pct) / max * 50);
              h += '<div class="wdg-xa-l" title="' + esc(r.x.lib + ' · ' + r.x.lieu) + '">'
                + '<span class="wdg-xa-n"><b>' + esc(r.x.lib) + '</b></span>'
                + '<span class="wdg-xa-piste"><u class="' + (r.pct >= 0 ? 'est-haut' : 'est-bas') + '"'
                + ' style="' + (r.pct >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w.toFixed(1) + '%"></u></span>'
                + '<span class="wdg-xa-v ' + cls(r.pct) + '">' + fmtP(r.pct) + '</span>'
                + '<span class="wdg-xa-s ' + cls(r.sem) + '">' + (r.sem == null ? '—' : fmtP(r.sem)) + '</span>'
                + '</div>';
            });
            h += '</div>';

            /* VERDICT : la tête et la queue de la SÉANCE, peintes par leur signe RÉEL — si tout
               baisse, la « meneuse » n'est pas verte (même règle que la carte de chaleur). */
            var tri = lignes.slice().sort(function (a, b) { return b.pct - a.pct; });
            var t0 = tri[0], q0 = tri[tri.length - 1];
            var vb = '<span class="' + cls(t0.pct) + '">' + esc(t0.x.lib) + '</span> mène la séance (' + fmtP(t0.pct) + ')'
              + (tri.length > 1 ? ' · <span class="' + cls(q0.pct) + '">' + esc(q0.x.lib) + '</span> ferme la marche (' + fmtP(q0.pct) + ')' : '');
            var vs = 'Écart tête-queue : ' + Math.abs(t0.pct - q0.pct).toFixed(2).replace('.', ',') + ' point.'
              + (lignes.length < _XA_INSTR.length
                ? ' ' + lignes.length + ' marchés sur ' + _XA_INSTR.length + ' : les autres n\'ont pas répondu.' : '');
            var ts = 0;
            _XA_INSTR.forEach(function (x) { var t = _bougiesMaj(x.nom + '|D1'); if (t > ts) ts = t; });
            h += '<div class="wdg-verdict" data-etat="live"><b class="wdg-verdict-txt wdg-maj-txt">' + vb + '</b>'
              + '<span class="wdg-verdict-sous">' + esc(vs) + '</span></div>'
              + '<div class="wdg-xa-pied">Séance : dernière clôture cotée face à la précédente — ces places '
              + 'n\'ouvrent pas aux mêmes heures. Semaine : depuis lundi 00h UTC. ' + _vieSpan(ts) + '</div></div>';
            host.innerHTML = h;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Bougies indisponibles.'); });
        }
        dessiner();
        var stop = _rafraichirBougies(host, dessiner);
        return function () { vivant = false; try { stop(); } catch (e) {} };
      },
    },
    {
      /* PERFORMANCE DE LA SEMAINE (23/08). Les 8 devises classées par leur variation DEPUIS LE
         LUNDI 00h UTC de la semaine courante, calculée des bougies quotidiennes des 7 paires
         contre dollar (helpers _ps*, testés au banc). USD n'a pas de paire propre : son agrégat
         = moyenne inversée des 7, calculé seulement COMPLET, et marqué « calc. » SUR sa ligne
         (la mention vit sur la carte, pas seulement dans une infobulle — même règle que le
         verdict COT). Lundi sans bougie close : la carte dit « semaine à peine ouverte » plutôt
         que de maquiller la séance du jour en chiffre hebdo. Week-end : classement figé,
         étiqueté « semaine close ». */
      id: 'perf-semaine', name: 'Performance hebdo', tag: 'HEBDO', cat: 'Devises', h: 300,
      desc: 'Qui gagne la semaine : les 8 devises classées par leur variation depuis lundi.',
      aide: "<p>Les huit devises majeures classées par leur variation depuis le lundi 00h UTC, calculée des sept paires contre dollar ; le dollar n'a pas de paire propre, sa ligne « calc. » est la moyenne inversée des sept. Barre verte vers la droite : la devise gagne sa semaine ; rouge vers la gauche : elle la perd.</p><p>La lecture hebdomadaire lisse le bruit des séances : une devise en tête sur un vrai écart raconte un <strong>flux</strong> (taux, macro, risque), pas un sursaut d'une heure. L'écart tête-queue de la ligne du bas dit si la semaine discrimine vraiment ou si tout se tient dans un mouchoir.</p>",
      src: "Bougies quotidiennes réelles des 7 paires contre dollar, relues toutes les 5 minutes ; la variation court du lundi 00h UTC au dernier cours connu, et l'agrégat USD n'est calculé que lorsque les 7 paires répondent.",
      watch: "Le creusement de l'écart tête-queue en cours de semaine, et une devise qui change de moitié de classement après un chiffre ou une banque centrale : la rotation se voit ici avant de se voir sur une paire isolée.",
      mount: function (host) {
        var vivant = true, cache = {};
        var prevCle = null;
        skel(host, 8);
        function fmtP(v) { return (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + '%'; }
        function dessiner() {
          Promise.all(_PS_PAIRES.map(function (p) {
            return _bougies(p, 'D1', cache).catch(function () { return null; });
          })).then(function (res) {
            if (!vivant || !host.isConnected) return;
            var vars = {}, ouvertures = 0, vivantes = 0;
            _PS_PAIRES.forEach(function (p, i) {
              if (!res[i]) return;
              var v = _psVarSemaine(res[i]);
              vivantes++;
              if (v.etat === 'ouverture') ouvertures++;
              vars[p] = v.etat === 'ok' ? v.pct : null;
            });
            if (!vivantes) { fallback(host, 'Bougies indisponibles.'); return; }
            /* Lundi à peine entamé : chaque paire vivante n'a que sa bougie du jour, encore
               ouverte. État calme et dit, pas une erreur : le classement arrive tout seul. */
            if (ouvertures && ouvertures === vivantes) {
              emptyState(host, 'Semaine à peine ouverte : aucune bougie close depuis lundi 00h UTC. Le classement arrive avec la première clôture.');
              prevCle = null;
              return;
            }
            var perfs = _psPerfs(vars);
            if (perfs.length < 2) { fallback(host, 'Bougies indisponibles.'); return; }
            var jU = new Date().getUTCDay();
            var enWE = jU === 0 || jU === 6;
            var max = 0;
            perfs.forEach(function (r) { if (Math.abs(r.pct) > max) max = Math.abs(r.pct); });
            if (!(max > 0)) max = 1;   // toutes à zéro : barres nulles plutôt qu'une division par zéro

            var h = '<div class="wdg-ps"><div class="wdg-ps-liste">';
            perfs.forEach(function (r) {
              // Piste bidirectionnelle à axe central : la barre part du zéro, vert à droite,
              // rouge à gauche — même grammaire que le différentiel de taux.
              var w = Math.min(50, Math.abs(r.pct) / max * 50);
              h += '<div class="wdg-ps-l' + (r.calc ? ' est-calc' : '') + '"'
                + (r.calc ? ' title="USD : agrégat calculé, moyenne inversée des 7 paires contre dollar"' : '') + '>'
                + '<span class="wdg-ps-d">' + _drapeauDev(r.dev) + '<b>' + esc(r.dev) + '</b>' + (r.calc ? '<i>calc.</i>' : '') + '</span>'
                + '<span class="wdg-ps-piste"><u class="' + (r.pct >= 0 ? 'est-haut' : 'est-bas') + '"'
                + ' style="' + (r.pct >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w.toFixed(1) + '%"></u></span>'
                + '<span class="wdg-ps-v ' + (r.pct > 0 ? 'est-haut' : r.pct < 0 ? 'est-bas' : '') + '">' + fmtP(r.pct) + '</span>'
                + '</div>';
            });
            h += '</div>';

            /* ── VERDICT : tête et queue, couleur par SIGNE réel (si tout baisse, la « meneuse »
               n'est pas peinte en vert — règle de la carte de chaleur), écart tête-queue en sous. */
            var tete = perfs[0], queue = perfs[perfs.length - 1];
            var vT = tete.pct, vQ = queue.pct;
            var vb = (enWE ? 'Semaine close : ' : '')
              + '<span' + (vT > 0 ? ' class="est-haut"' : vT < 0 ? ' class="est-bas"' : '') + '>' + esc(tete.dev) + '</span>'
              + ' mène la semaine (' + fmtP(vT) + ') · '
              + '<span' + (vQ < 0 ? ' class="est-bas"' : vQ > 0 ? ' class="est-haut"' : '') + '>' + esc(queue.dev) + '</span>'
              + ' ferme la marche (' + fmtP(vQ) + ')';
            var vs = 'Écart tête-queue : ' + (vT - vQ).toFixed(2).replace('.', ',') + ' point' + (vT - vQ >= 2 ? 's' : '') + '.'
              + ((tete.calc || queue.calc) ? ' USD est un agrégat calculé (moyenne inversée des 7 paires).' : '')
              + (perfs.length < 8 ? ' ' + perfs.length + ' devises sur 8 : une partie des paires n\'a pas répondu.' : '');
            var ts = 0;
            _PS_PAIRES.forEach(function (p) { var t = _bougiesMaj(p + '|D1'); if (t > ts) ts = t; });
            h += '<div class="wdg-verdict" data-etat="' + (enWE ? 'close' : 'live') + '"><b class="wdg-verdict-txt wdg-maj-txt">' + vb + '</b>'
              + '<span class="wdg-verdict-sous">' + esc(vs) + '</span></div>'
              + '<div class="wdg-ps-pied">Variation depuis lundi 00h UTC, bougies quotidiennes' + (enWE ? ', classement figé jusqu\'à la réouverture' : '') + '. ' + _vieSpan(ts) + '</div></div>';
            host.innerHTML = h;
            var cle = perfs.map(function (r) { return r.dev + ':' + r.pct.toFixed(2); }).join(';');
            if (prevCle != null && cle !== prevCle) _majFlash(host.querySelector('.wdg-verdict-txt'));
            prevCle = cle;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Bougies indisponibles.'); });
        }
        dessiner();
        var stop = _rafraichirBougies(host, dessiner);
        return function () { vivant = false; stop(); };
      },
    },
    {
      /* h 460 (25/08, capture user « on ne voit pas toutes les informations ») : la carte déclare ses
         propres minima CSS — jauge .wdg-riskwrap 280px + bande .rsh-chart 170px = 450px incompressibles —
         mais naissait à 300px : chaque nouvel emplacement ouvrait avec un tiers du contenu sous le pli.
         Le corps défile (mesuré au banc : scrollHeight 458 pour 171 visibles), rien n’était perdu,
         mais un widget qui défile dès sa pose est un widget mal dimensionné. */
      id: 'risque-jauge', name: 'Sentiment de Risque', tag: 'RISQUE', cat: 'Risque', h: 460,
      desc: "L'appétit / l'aversion du marché en direct (risk-on / risk-off).",
      // IDENTIQUE AU DESK (23/07) : réplique instance-scopée de buildRiskGauge (charts.js) — mêmes classes
      // (.risk-ticker / .risk-gauge-stage / .risk-readout), même arc am5radar (dégradé 7 stops), même
      // triangle ClockHand teinté _riskArcColor, mêmes helpers globaux (_riskBandInner, GAUGE_LABEL_FR).
      // Root amCharts PAR INSTANCE (le singleton _riskGaugeRoot reste au desk) + suit le snapshot partagé
      // dtp-risk (source unique app.js) → toujours la même valeur que la jauge de l'onglet RISQUE.
      // Réglage UTILE (04/08) : dans une carte basse, la bande d'historique écrase l'arc — on peut
      // ne garder que la jauge.
      /* ⚠️ BUG RÉPARÉ (23/08, trouvé à l'inventaire des fiches) : ce champ `aide` vivait À
         L'INTÉRIEUR de l'objet d'option `histo` — le volet « ? » lit `w.aide`, jamais `opt.aide`,
         donc cette fiche, écrite depuis le 21/08, ne s'était JAMAIS affichée. */
      aide: "<p>Une mesure d'appétit pour le risque agrégée à partir de plusieurs marchés. En <strong>risque-on</strong>, les devises cycliques et les actions sont recherchées ; en <strong>risque-off</strong>, ce sont les valeurs refuges.</p><p>Cet indicateur sert de toile de fond : il n'indique pas quoi acheter, il indique quel régime domine, et donc quelles corrélations sont actives à ce moment-là.</p>",
      src: "Le même instantané de risque que l'onglet RISQUE du desk (une seule source pour tout le produit), poussé en direct à la carte ; la bande d'historique relit ses 60 jours à l'affichage.",
      watch: "Les bascules de régime plus que le niveau : un passage risque-on / risque-off réaligne en quelques heures les corrélations entre devises cycliques, valeurs refuges et indices.",
      opts: [{ k: 'histo', lbl: 'Historique', type: 'bascule', def: true }],
      mount: function (host, it) {
        var W = this;
        if (!(window.am5 && window.am5radar) || typeof _riskArcColor !== 'function' || typeof _riskBandInner !== 'function' || typeof GAUGE_LABEL_FR === 'undefined') { fallback(host, 'Jauge indisponible.'); return null; }
        // COMME L'ONGLET RISQUE DU DESK (demande user 03/08 « il manque l'historique en bas ») :
        // la jauge PLUS la bande d'historique quotidien (#risk-history-chart, classes .rsh-chart du
        // desk, builder buildRiskHistoryChart) — la jauge seule laissait un vide sous l'arc.
        var avecHist = opt(it, W, 'histo') !== false;
        var hid = HOST_ID + '-rj-h-' + uid();
        host.innerHTML = '<div class="wdg-riskpanel"><div class="risk-widget-container wdg-riskwrap"></div>'
          + (avecHist ? '<div class="amchart-container rsh-chart wdg-riskhist"><div id="' + hid + '" style="width:100%;height:100%"></div></div>' : '')
          + '</div>';
        var wrap = host.querySelector('.wdg-riskwrap');
        if (typeof buildRiskHistoryChart === 'function') {
          fetch('/api/risk-history?days=60').then(function (r) { return r.json(); }).then(function (d) {
            if (!document.getElementById(hid)) return;                       // widget retiré pendant le fetch
            try { buildRiskHistoryChart(hid, d); } catch (e) {}
          }).catch(function () {});
        } else { var hh = host.querySelector('.wdg-riskhist'); if (hh) hh.remove(); }
        var root = null, handDI = null, hand = null, built = false;
        function render(data) {
          if (!host.isConnected || !data || data.error) return;
          try {
            var frLabel = GAUGE_LABEL_FR[data.label] || data.label;
            var isOn = /risk-on/i.test(data.label), isOff = /risk-off/i.test(data.label);
            var cls = isOn ? 'risk-on' : isOff ? 'risk-off' : 'neutral';
            var gaugeVal = Math.max(-100, Math.min(100, +((typeof data.pct === 'number' ? data.pct : (data.score || 0) * 50)).toFixed(1)));
            if (!built) {
              built = true;
              wrap.innerHTML = '<div class="risk-ticker ' + cls + '">' + _riskBandInner(data) + '</div>'
                + '<div class="risk-gauge-stage"><div class="wdg-riskgauge"></div>'
                + '<div class="risk-readout"><div class="risk-readout-badge ' + cls + '"></div></div></div>';
              wrap.querySelector('.risk-readout-badge').textContent = frLabel;
              root = _dtpAncreGraphe(am5.Root.new(wrap.querySelector('.wdg-riskgauge')));
              root.setThemes(typeof applyTerminalTheme === 'function' ? [am5themes_Animated.new(root), applyTerminalTheme(root)] : [am5themes_Animated.new(root)]);
              if (root._logo) root._logo.set('forceHidden', true);
              var chart = root.container.children.push(am5radar.RadarChart.new(root, {
                panX: false, panY: false, startAngle: -180, endAngle: 0,
                radius: am5.percent(86), innerRadius: am5.percent(78),
                paddingTop: 12, paddingBottom: 26, paddingLeft: 28, paddingRight: 28,
              }));
              var axisRenderer = am5radar.AxisRendererCircular.new(root, { strokeOpacity: 0 });
              axisRenderer.labels.template.setAll({ visible: false });
              axisRenderer.ticks.template.setAll({ visible: false });
              axisRenderer.grid.template.setAll({ visible: false });
              var axis = chart.xAxes.push(am5xy.ValueAxis.new(root, { min: -100, max: 100, strictMinMax: true, renderer: axisRenderer }));
              var arc = axis.createAxisRange(axis.makeDataItem({ value: -100, endValue: 100 }));
              arc.get('axisFill').setAll({
                visible: true, fillOpacity: 1, strokeOpacity: 0, fill: am5.color(0xddb23a),
                fillGradient: am5.LinearGradient.new(root, { rotation: 0, stops: [
                  { color: am5.color(0xc63430) }, { color: am5.color(0xdb5a2c) }, { color: am5.color(0xe88a28) },
                  { color: am5.color(0xddb23a) }, { color: am5.color(0xa9c64a) }, { color: am5.color(0x5cb060) }, { color: am5.color(0x2a9e60) },
                ] }),
              });
              if (arc.get('grid')) arc.get('grid').setAll({ visible: false });
              if (arc.get('tick')) arc.get('tick').setAll({ visible: false });
              if (arc.get('label')) arc.get('label').setAll({ visible: false });
              handDI = axis.makeDataItem({ value: 0 });
              hand = am5radar.ClockHand.new(root, { pinRadius: 0, radius: am5.percent(64), innerRadius: am5.percent(43), bottomWidth: 26, topWidth: 0 });
              hand.pin.setAll({ forceHidden: true });
              hand.hand.setAll({ fill: am5.color(_riskArcColor(gaugeVal)), fillOpacity: 0.95, strokeOpacity: 0 });
              handDI.set('bullet', am5xy.AxisBullet.new(root, { sprite: hand }));
              axis.createAxisRange(handDI);
              if (handDI.get('grid')) handDI.get('grid').setAll({ visible: false });
              handDI.animate({ key: 'value', to: gaugeVal, duration: 1000, easing: am5.ease.out(am5.ease.cubic) });
            } else {
              if (handDI) handDI.animate({ key: 'value', to: gaugeVal, duration: 800, easing: am5.ease.out(am5.ease.cubic) });
              if (hand) hand.hand.set('fill', am5.color(_riskArcColor(gaugeVal)));
              var badgeUp = wrap.querySelector('.risk-readout-badge');
              if (badgeUp) { badgeUp.textContent = frLabel; badgeUp.className = 'risk-readout-badge ' + cls; }
              var tickUp = wrap.querySelector('.risk-ticker');
              if (tickUp) { tickUp.className = 'risk-ticker ' + cls; tickUp.innerHTML = _riskBandInner(data); }
            }
            // Badge + bande d'état teintés par la couleur d'arc COURANTE (même logique que le desk)
            var arcHex = '#' + _riskArcColor(gaugeVal).toString(16).padStart(6, '0');
            var badge = wrap.querySelector('.risk-readout-badge');
            if (badge) { badge.style.color = arcHex; badge.style.borderColor = arcHex; }
            var ticker = wrap.querySelector('.risk-ticker');
            if (ticker) {
              ticker.style.color = 'color-mix(in oklab, ' + arcHex + ' 52%, #c7cacc)';
              ticker.style.background = 'color-mix(in oklab, ' + arcHex + ' 13%, #0c0e13)';
              ticker.style.borderColor = 'color-mix(in oklab, ' + arcHex + ' 30%, transparent)';
              var dt = ticker.querySelector('.risk-ticker-dot'); if (dt) dt.style.background = arcHex;
              var st = ticker.querySelector('strong'); if (st) st.style.color = arcHex;
            }
          } catch (e) { if (!built) fallback(host, 'Jauge indisponible.'); }
        }
        function onRisk(e) { render(e && e.detail); }
        window.addEventListener('dtp-risk', onRisk);
        if (window._dtpRisk) render(window._dtpRisk);
        else fetch('/api/risk-sentiment').then(function (r) { return r.json(); }).then(function (d) { if (!d || d.error) return fallback(host, 'Sentiment indisponible.'); window._dtpRisk = window._dtpRisk || d; render(window._dtpRisk); }).catch(function () { fallback(host, 'Sentiment indisponible.'); });
        return function () {
          window.removeEventListener('dtp-risk', onRisk);
          try { if (root) root.dispose(); } catch (e) {}
          try { if (typeof disposeRoot === 'function') disposeRoot(hid); } catch (e) {}   // la bande d'historique a son propre root
        };
      },
    },
    {
      id: 'cot-inst', name: 'Positionnement COT',
      maj: 30 * 60 * 1000, tag: 'COT', cat: 'Risque', h: 340,   // le COT est hebdomadaire : ce rythme sert a se reparer, pas a rafraichir
      desc: 'Le positionnement net des institutionnels (CFTC), par devise.',
      aide: "<p>Le positionnement déclaré des grands intervenants sur les contrats à terme, publié chaque semaine avec plusieurs jours de décalage. C'est une photographie du <strong>passé récent</strong>, jamais un signal d'entrée.</p><p>Sa valeur est dans les extrêmes et dans les inflexions : un positionnement très étiré d'un côté signale une asymétrie, un retournement de tendance dans les positions signale souvent un changement de régime avant les prix.</p>",
      src: "Le rapport hebdomadaire officiel de la CFTC, arrêté le mardi et publié en fin de semaine ; la relecture de fond toutes les 30 minutes sert à se réparer, pas à rafraîchir : rien ne bouge en intrajournalier.",
      watch: "Les positionnements très étirés d'un côté (beaucoup d'intervenants à déboucler en même temps) et les retournements d'une semaine à l'autre : les inflexions dans les positions précèdent souvent celles des prix.",
      // IDENTIQUE AU DESK (23/07) : réutilise buildCOTChart(gridId, type) de charts.js (rendu rétrocompatible)
      // → mêmes cartes donut SVG .cot-cell, mêmes 5 catégories CFTC. Zéro root amCharts.
      // 04/08 : la barre de catégories inline est RETIRÉE (doublon du réglage « Catégorie » ci-dessous,
      // comme pour DMX) → toute la hauteur va aux cartes. La grille porte .cot-grid--fit : _cotFit()
      // la pave en rectangle plein (plus d'orpheline seule ni de zone morte à droite) et se recalcule
      // au redimensionnement du bloc.
      opts: [{ k: 'cat', lbl: 'Catégorie', type: 'choix', def: 'lev_money',
        choix: [['noncomm', 'Non-comm.'], ['dealer', 'Teneur'], ['asset_mgr', 'Gérant'], ['lev_money', 'Levier'], ['other_rept', 'Autre']] }],
      mount: function (host, it) {
        var W = this;
        if (typeof buildCOTChart !== 'function') { fallback(host, 'COT indisponible.'); return null; }
        var cat0 = opt(it, W, 'cat');
        var gid = HOST_ID + '-cotg-' + uid();
        host.innerHTML = '<div class="wdg-cotwrap">'
          + '<div id="' + gid + '" class="cot-grid cot-grid--fit custom-scrollbar"></div></div>';
        try { buildCOTChart(gid, cat0); } catch (e) { fallback(host, 'COT indisponible.'); return null; }
        var g = host.querySelector('.cot-grid'), ro = null;   // (byId() ici = lookup CATALOGUE, pas le DOM)
        if (window.ResizeObserver && g && typeof _cotFit === 'function') {
          ro = new ResizeObserver(function () { try { _cotFit(g); } catch (e) {} });
          ro.observe(g);
        }
        return function () { try { if (ro) ro.disconnect(); } catch (e) {} };
      },
    },
    /* ═══ NOUVEAUX WIDGETS (19/08) — bibliotheque elargie, ADMIN d abord ═══════════════════════
       Chacun est passe par une specification puis une CONTRE-VERIFICATION adversariale : un second
       agent a relu le code source ligne a ligne pour tenter de REFUTER chaque champ affirme. Les
       quatre ci-dessous sont ceux dont la spec a tenu sans reserve. Deux candidats ont ete ECARTES
       a ce stade parce que la donnee n existe pas : le graphe obligataire (/api/market-snapshot ne
       garde que « meta », la serie temporelle Yahoo est jetee) et l historique COT (scrapers/cot.js
       ne conserve qu une ligne par contrat). Mieux vaut deux widgets en moins qu un widget qui ment.
       « staff: true » = actif pour les comptes admin/support, carte « Bientot » pour les autres.
       OUVERTS A TOUS le 20/08 (fin du rodage) : le drapeau est retire des 14 entrees, le mecanisme reste. */

    {
      id: 'notes', name: 'Notes', tag: 'OUTILS', cat: 'Outils', h: 260,
      desc: 'Un bloc-notes qui reste, d\'un appareil à l\'autre.',
      aide: "<p>Un bloc-notes enregistré côté serveur : le texte suit votre compte, d'un appareil à l'autre, et chaque carte Notes porte son propre document. L'enregistrement se fait tout seul à la pause de frappe ; l'état en pied de carte (« modifié… », « enregistré à… ») fait foi.</p><p>Son usage de desk est la <strong>discipline écrite</strong> : plan de séance, règles de risque, niveaux à surveiller. Le réglage « Lecture seule » protège une check-list d'une frappe accidentelle, et la péremption signale un plan qui date.</p>",
      src: "Aucune donnée de marché : votre texte, enregistré sur votre compte à chaque pause de frappe ; l'heure affichée est celle confirmée par le serveur, jamais une promesse.",
      watch: "La pastille d'ancienneté quand la péremption est réglée : un plan de semaine périmé ne doit pas se lire comme le plan du jour.",
      /* Le texte NE VIT PAS dans les réglages : leurs valeurs sont plafonnées à 32 caractères.
         Il vit dans un magasin dédié (/api/widget-notes), et le réglage ne porte qu un
         IDENTIFIANT de document. Ce réglage est `cache: true` : il n a rien à faire dans le
         panneau, il n est pas un choix de l utilisateur.
         ⚠️ L identifiant est REGENERE a la duplication et a l import (voir API.duplicate) :
         sans cela deux cartes partageraient la meme note et s ecraseraient l une l autre. */
      opts: [
        /* `doc` reste CACHE, et c est le seul cas legitime : ce n est pas un choix de
           l utilisateur mais l identifiant interne du document. Les trois suivants sont de vrais
           reglages, et sans eux la carte n avait aucun panneau. */
        { k: 'doc', lbl: 'Document', type: 'texte', def: '', cache: true },
        /* Une check-list de regles de risque ne doit pas pouvoir etre detruite par une frappe
           accidentelle sur une carte survolee. */
        { k: 'verrou', lbl: 'Lecture seule', type: 'bascule', def: false },
        /* Seule l HEURE etait affichee : une note touchee il y a trois jours annoncait
           « enregistré à 09:14 », vrai et pourtant trompeur. */
        { k: 'horodatage', lbl: 'Horodatage', type: 'choix', def: 'heure',
          choix: [['heure', 'Heure'], ['date', 'Date et heure'], ['off', 'Masqué']] },
        /* Un plan de semaine perime ne doit pas se confondre avec le plan du jour. 0 = jamais. */
        { k: 'peremption', lbl: 'Signaler au-delà de (jours)', type: 'nombre', def: 0, min: 0, max: 90 },
      ],
      mount: function (host, it) {
        var W = this, vivant = true, tMaj = null, dernier = '';
        var doc = opt(it, W, 'doc') || '';
        if (!/^[a-z0-9]{4,24}$/.test(doc)) {
          // Premiere ouverture, ou copie repartie sans document : on en fabrique un.
          doc = 'n' + Math.random().toString(36).slice(2, 12);
          _ecrisOpt(host, it, 'doc', doc);
        }
        host.innerHTML = '<div class="wdg-nt">'
          + '<textarea class="wdg-nt-txt" spellcheck="false" placeholder="Vos notes…"></textarea>'
          + '<div class="wdg-nt-pied"><span class="wdg-nt-etat"></span><span class="wdg-nt-car"></span></div>'
          + '</div>';
        var ta = host.querySelector('.wdg-nt-txt');
        var etat = host.querySelector('.wdg-nt-etat');
        var car = host.querySelector('.wdg-nt-car');
        var MAX = 4000;

        function compteur() { car.textContent = ta.value.length + ' / ' + MAX; }

        /* Horodatage. Seule l HEURE etait affichee : une note touchee il y a trois jours
           annoncait « enregistré à 09:14 », ce qui se lit comme ce matin. Vrai, et pourtant
           trompeur. Le mode « date et heure » leve l ambiguite ; « masqué » libere la ligne de
           pied sur une carte basse. */
        function quand(ms) {
          var mode = opt(it, W, 'horodatage') || 'heure';
          if (mode === 'off' || !ms) return '';
          try {
            var d = new Date(ms);
            return (mode === 'date')
              ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
              : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          } catch (e) { return ''; }
        }

        /* Peremption : au-dela de N jours sans modification, une pastille discrete. Un plan de
           semaine perime ne doit pas se confondre avec le plan du jour, ce qui est precisement
           le risque d un bloc-notes qui persiste. 0 = jamais. */
        function vieillesse(ms) {
          var n = opt(it, W, 'peremption') || 0;
          if (!n || !ms) return '';
          var j = Math.floor((Date.now() - ms) / 86400000);
          return j >= n ? ('<span class="wdg-nt-vieux">' + j + ' j</span>') : '';
        }

        /* Lecture seule : une check-list de regles de risque ne doit pas pouvoir etre detruite
           par une frappe accidentelle sur une carte survolee. */
        function verrouiller() {
          var v = opt(it, W, 'verrou') === true;
          ta.readOnly = v;
          host.querySelector('.wdg-nt').classList.toggle('est-verrou', v);
          if (v) { etat.textContent = 'verrouillé'; etat.className = 'wdg-nt-etat'; }
          return v;
        }

        function enregistrer() {
          // Verrouillee, la carte n ECRIT PAS : le reglage ne serait sinon qu un decor.
          if (!vivant || ta.readOnly || ta.value === dernier) return;
          var texte = ta.value;
          fetch('/api/widget-notes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ doc: doc, t: texte }),
          }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            if (!d || !d.ok) { etat.textContent = 'non enregistré'; etat.className = 'wdg-nt-etat est-ko'; return; }
            dernier = texte;
            // L heure vient du SERVEUR et n est affichee qu APRES sa reponse : annoncer
            // « enregistré » avant confirmation serait un mensonge en cas de panne.
            var h = quand(d.maj);
            etat.textContent = h ? ('enregistré à ' + h) : 'enregistré';
            etat.className = 'wdg-nt-etat';
            car.innerHTML = vieillesse(d.maj) + ta.value.length + ' / ' + MAX;
          }).catch(function () {
            if (vivant && host.isConnected) { etat.textContent = 'non enregistré'; etat.className = 'wdg-nt-etat est-ko'; }
          });
        }

        ta.addEventListener('input', function () {
          if (ta.readOnly) return;
          if (ta.value.length > MAX) ta.value = ta.value.slice(0, MAX);
          compteur();
          etat.textContent = 'modifié…'; etat.className = 'wdg-nt-etat est-att';
          clearTimeout(tMaj); tMaj = setTimeout(enregistrer, 700);
        });
        // Fermeture d onglet : dernier enregistrement, sans attendre le debounce.
        var auDepart = function () { clearTimeout(tMaj); enregistrer(); };
        window.addEventListener('pagehide', auDepart);

        fetch('/api/widget-notes').then(function (r) { return r.json(); }).then(function (d) {
          if (!vivant || !host.isConnected) return;
          var n = (d && d.docs && d.docs[doc]) || null;
          ta.value = n ? String(n.t || '') : '';
          dernier = ta.value;
          compteur();
          if (n && n.maj) {
            var h0 = quand(n.maj);
            if (h0) etat.textContent = 'enregistré à ' + h0;
            car.innerHTML = vieillesse(n.maj) + ta.value.length + ' / ' + MAX;
          }
          verrouiller();
        }).catch(function () {
          if (vivant && host.isConnected) { etat.textContent = 'lecture impossible'; etat.className = 'wdg-nt-etat est-ko'; }
        });

        return function () {
          vivant = false;
          try { clearTimeout(tMaj); } catch (e) {}
          try { window.removeEventListener('pagehide', auDepart); } catch (e) {}
        };
      },
    },

    {
      id: 'ticklist', name: 'Liste de suivi', tag: 'FX', cat: 'Marchés', h: 176,
      desc: 'Les paires que vous suivez, leur cours et leur variation du jour.',
      aide: "<p>Vos paires, leur dernier cours et leur variation depuis la clôture précédente ; la mini-courbe résume la tendance sur environ six semaines de clôtures quotidiennes, pas de l'intraday. La ligne du bas dit qui mène parmi vos paires et qualifie l'activité de l'ensemble.</p><p>Ni biais ni sentiment ici, volontairement : cours et variation sont les deux seules colonnes <strong>univoques</strong> de la source. La carte sert de poste de garde : elle dit laquelle de vos paires mérite d'être ouverte en grand, pas ce qu'il faut en penser.</p>",
      src: "Cotations servies par le desk et relues toutes les 150 secondes, au rythme où le serveur les recalcule ; seules les lignes qui ont réellement bougé sont mises en évidence.",
      watch: "Une variation qui se détache nettement des autres, et le passage de « rien ne bouge encore » à « séance animée » sur la ligne du bas : c'est souvent l'heure où le calendrier parle.",
      /* ⚠️ CE QUE CE WIDGET N AFFICHE PAS, ET POURQUOI. /api/fxlist sert bien des colonnes `bias`
         et `dmx`, mais elles ont des REPLIS SILENCIEUX : `dmx` retombe sur un ratio de jours
         haussiers calcule chez nous quand la source de positionnement ne repond pas, et `bias`
         sur un simple momentum a un mois. Les marqueurs qui permettraient de distinguer la vraie
         valeur du repli sont SUPPRIMES avant l envoi. Afficher une colonne « Biais » montrerait
         donc parfois du momentum en le faisant passer pour le Radar de Biais. On s en tient au
         cours et a la variation, qui sont univoques.
         ⚠️ La cle `ticks` a ete ajoutee a _WDG_LISTES cote serveur DANS LE MEME COMMIT : sans
         cela la liste serait coupee a 32 caracteres au premier enregistrement. */
      opts: [
        { k: 'ticks', lbl: 'Paires suivies', type: 'multi',
          def: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'], choix: _fxChoix() },
        { k: 'tri', lbl: 'Classement', type: 'choix', def: 'liste',
          choix: [['liste', 'Mon ordre'], ['var', 'Par variation'], ['sym', 'Par symbole']] },
      ],
      mount: function (host, it) {
        var W = this, vivant = true;
        skel(host, 5);
        /* Mémoire du DIFF (refonte 23/08 « la carte semble figée ») : le re-rendu total toutes
           les 150 s rendait la ligne qui venait de bouger indiscernable. On ne reconstruit plus
           qu'au changement de STRUCTURE (paires, tri, présence du verdict ou d'une mini-courbe) ;
           au tick, on réécrit cours et variation DANS les nœuds existants et on fond (_majFlash)
           les seules lignes qui ont réellement changé. Le tri « par variation » réordonne presque
           à chaque tick : le diff RÉINSÈRE les nœuds existants dans le nouvel ordre (appendChild
           déplace sans recréer) — sans cela le fondu ne survivrait pas au reclassement. */
        var prevStruct = null, prevVals = null, prevVerd = null;

        /* Mini-courbe par ligne. ⚠️ sparkLast n'est PAS de l'intraday : côté serveur, la série
           vient du JOURNALIER (yfFetch '1d') et sparkLast = les 30 dernières CLÔTURES quotidiennes
           rééchantillonnées à 24 points, soit ~6 semaines. Le pied l'étiquette « tendance
           ~6 semaines » — l'étiqueter « séance » serait un mensonge (mesuré en contre-lecture). */
        function sparkPts(p) {
          var a = Array.isArray(p.sparkLast) ? p.sparkLast.map(Number).filter(isFinite) : [];
          if (a.length < 2) return '';
          var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a);
          return a.map(function (v, i) {
            var x = i / (a.length - 1) * 48;
            var y = mx > mn ? 13 - (v - mn) / (mx - mn) * 12 : 7;
            return x.toFixed(1) + ',' + y.toFixed(1);
          }).join(' ');
        }

        function dessiner() {
          var choisies = opt(it, W, 'ticks') || [];
          if (!choisies.length) { emptyState(host, 'Aucune paire suivie.'); return; }
          fetch('/api/fxlist').then(function (r) {
            if (!r.ok) throw new Error('http');
            return r.json();
          }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            if (!d || !Array.isArray(d.pairs)) { fallback(host, 'Cotations indisponibles.'); prevStruct = null; return; }
            var par = {};
            d.pairs.forEach(function (p) { if (p && p.symbol) par[p.symbol] = p; });
            var lignes = choisies.map(function (sym) { return par[sym] || { symbol: sym, absent: true }; });
            var tri = opt(it, W, 'tri');
            if (tri === 'sym') lignes.sort(function (a, b) { return a.symbol.localeCompare(b.symbol); });
            else if (tri === 'var') lignes.sort(function (a, b) { return (Number(b.changePct) || 0) - (Number(a.changePct) || 0); });

            /* ── Une seule passe de calcul, servie aux DEUX chemins (reconstruction et diff).
               ⚠️ La source rend NULL pour une variation inconnue, et Number(null) vaut 0 : sans
               la garde `== null`, une paire sans clôture précédente s'afficherait « +0,00 % »
               et entrerait dans le verdict comme un zéro CONNU (piège attrapé au banc). */
            var rows = lignes.map(function (p) {
              var v = p.changePct == null ? NaN : Number(p.changePct);
              var last = p.last == null ? NaN : Number(p.last);
              var pts = p.absent ? '' : sparkPts(p);
              // Le survol situe la séance dans la tendance : ret1M est déjà servi, rien à payer.
              var titre = [];
              if (isFinite(v)) titre.push((v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + ' % séance');
              var r1 = p.ret1M == null ? NaN : Number(p.ret1M);
              if (isFinite(r1)) titre.push((r1 > 0 ? '+' : '') + r1.toFixed(1).replace('.', ',') + ' % sur 1 mois');
              return { p: p, pts: pts, titre: titre.join(' · '),
                cls: isFinite(v) ? (v > 0 ? 'est-haut' : v < 0 ? 'est-bas' : '') : '',
                // Une paire absente de la reponse n est pas une paire a zero : on l affiche vide.
                prix: isFinite(last) ? last.toFixed(/JPY/.test(p.symbol) ? 3 : 5) : '--',
                vTxt: isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + '%' : '--',
                sig: (isFinite(last) ? last : '') + '|' + (isFinite(v) ? v : '') };
            });

            /* ── VERDICT : qui mène parmi VOS paires, et le niveau d'activité de l'ensemble.
               Seuils sur la moyenne des |variations| : <0,15 % rien ne bouge encore ·
               0,15-0,40 % activité ordinaire · >0,40 % séance animée. Factuel, jamais un avis
               directionnel. Toutes absentes → pas de verdict (silence honnête, même règle que
               les lignes vides). */
            var connues = lignes.filter(function (p) { return !p.absent && p.changePct != null && isFinite(Number(p.changePct)); });
            var vHtml = '', vSous = '';
            if (connues.length) {
              var top = connues[0], somme = 0;
              connues.forEach(function (p) {
                var x = Math.abs(Number(p.changePct)); somme += x;
                if (x > Math.abs(Number(top.changePct))) top = p;
              });
              var moyAbs = somme / connues.length;
              var quali = moyAbs < 0.15 ? 'rien ne bouge encore' : moyAbs <= 0.40 ? 'activité ordinaire' : 'séance animée';
              var tv = Number(top.changePct);
              vHtml = '<span' + (tv > 0 ? ' class="est-haut"' : tv < 0 ? ' class="est-bas"' : '') + '>' + esc(top.symbol) + '</span>'
                + ' mène : ' + (tv > 0 ? '+' : '') + tv.toFixed(2).replace('.', ',') + ' % · ' + quali;
              if (connues.length > 1) vSous = 'Vos ' + connues.length + ' paires bougent de ' + moyAbs.toFixed(2).replace('.', ',') + ' % en moyenne.';
            }

            // /api/fxlist sert updatedAt en ISO (pas en ms) : Date.parse, repli sur l'heure du fetch.
            var ts = Date.parse(d.updatedAt || '') || Date.now();
            // Marqueurs de structure en ordre STABLE (celui du réglage) : sous tri « par
            // variation », l'ordre d'affichage change à chaque tick et ne doit pas casser le diff.
            var parSym = {};
            rows.forEach(function (r) { parSym[r.p.symbol] = r; });
            var struct = tri + '|' + choisies.join(',') + '|' + (vHtml ? 1 : 0) + (vSous ? 1 : 0) + '|'
              + choisies.map(function (sym) { var r = parSym[sym]; return !r || r.p.absent ? 'a' : (r.pts ? 's' : 'p'); }).join('');

            var corps = host.querySelector('.wdg-tl .wdg-tl-corps');
            if (corps && prevStruct === struct) {
              /* ── DIFF : réinsertion dans le nouvel ordre puis retouche en place. */
              rows.forEach(function (r) {
                var el = corps.querySelector('.wdg-tl-l[data-sym="' + r.p.symbol + '"]');
                if (!el) return;
                corps.appendChild(el);            // déplace sans recréer : le fondu survit au tri
                el.classList.toggle('est-haut', r.cls === 'est-haut');
                el.classList.toggle('est-bas', r.cls === 'est-bas');
                if (r.titre) el.setAttribute('title', r.titre); else el.removeAttribute('title');
                var eP = el.querySelector('.wdg-tl-p'); if (eP) eP.textContent = r.prix;
                var eV = el.querySelector('.wdg-tl-v'); if (eV) eV.textContent = r.vTxt;
                if (r.pts) {
                  var pl = el.querySelector('.wdg-tl-spark polyline');
                  if (pl) pl.setAttribute('points', r.pts);
                }
                if (prevVals && prevVals[r.p.symbol] !== r.sig) _majFlash(el);
              });
              var vt = host.querySelector('.wdg-tl .wdg-verdict-txt');
              if (vt && vHtml && vHtml !== prevVerd) { vt.innerHTML = vHtml; _majFlash(vt); }
              var vsE = host.querySelector('.wdg-tl .wdg-verdict-sous');
              if (vsE) vsE.textContent = vSous;
              var sp = host.querySelector('.wdg-tl .wdg-vie');
              if (sp) { sp.setAttribute('data-ts', ts); sp.textContent = _vie(ts); }
            } else {
              var h = '<div class="wdg-tl"><div class="wdg-tl-corps">';
              rows.forEach(function (r) {
                h += '<div class="wdg-tl-l wdg-maj-surf' + (r.cls ? ' ' + r.cls : '') + '" data-sym="' + esc(r.p.symbol) + '"'
                  + (r.titre ? ' title="' + esc(r.titre) + '"' : '') + '>'
                  + '<span class="wdg-tl-s">' + esc(r.p.symbol) + '</span>'
                  + (r.pts ? '<svg class="wdg-tl-spark" viewBox="0 0 48 14" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + r.pts + '" fill="none" stroke="currentColor" stroke-width="1"/></svg>' : '')
                  + '<span class="wdg-tl-p">' + r.prix + '</span>'
                  + '<span class="wdg-tl-v">' + r.vTxt + '</span>'
                  + '</div>';
              });
              h += '</div>';
              if (vHtml) {
                h += '<div class="wdg-verdict"><b class="wdg-verdict-txt wdg-maj-txt">' + vHtml + '</b>'
                  + (vSous ? '<span class="wdg-verdict-sous">' + esc(vSous) + '</span>' : '') + '</div>';
              }
              h += '<div class="wdg-tl-pied">Variation depuis la clôture précédente &middot; mini-courbe : tendance ~6 semaines '
                + _vieSpan(ts) + '</div></div>';
              host.innerHTML = h;
            }
            prevStruct = struct; prevVerd = vHtml;
            prevVals = {};
            rows.forEach(function (r) { prevVals[r.p.symbol] = r.sig; });
          }).catch(function () { if (vivant && host.isConnected) { fallback(host, 'Cotations indisponibles.'); prevStruct = null; } });
        }
        dessiner();
        var iv = setInterval(function () { if (!document.hidden) dessiner(); }, 150000);
        return function () { vivant = false; try { clearInterval(iv); } catch (e) {} };
      },
    },
    {
      id: 'amplitude-seance', name: 'Amplitude par séance', tag: 'VOLATILITÉ', cat: 'Marchés', h: 224,
      desc: 'Combien la paire parcourt pendant Tokyo, Londres et New York, en moyenne.',
      aide: "<p>Pour la paire choisie, le chemin moyen parcouru pendant chaque grande séance (Tokyo, Londres, New York), en pips ou en pourcentage du cours ; la surcouche du jour se superpose à la moyenne, sur la même échelle. Les séances se chevauchent : la somme des trois ne fait pas la journée.</p><p>La lecture de décision est le <strong>ratio du jour</strong> : une séance qui a déjà consommé son amplitude type offre moins de carburant à une cassure tardive, une séance très en dessous de sa norme laisse de la marge. La ligne du bas dit qui est en séance et où elle en est.</p>",
      src: "Bougies horaires réelles, relues toutes les 5 minutes ; les heures d'ouverture sont locales à chaque place, changements d'heure compris, et la séance en cours n'entre jamais dans la moyenne.",
      watch: "Le pourcentage de la moyenne déjà parcouru par la séance ouverte ; tout est fermé : l'heure de la prochaine ouverture, car les amplitudes se concentrent aux ouvertures et sur le recouvrement Londres-New York.",
      /* ⚠️ TROIS PRECAUTIONS, toutes exigees par la contre-verification.
         1. On VERIFIE que la route a bien servi des bougies horaires : elle retombe sur le
            journalier quand elle ne reconnait pas l unite demandee, et le widget publierait alors
            des amplitudes de seance calculees sur des journees entieres.
         2. L heure locale de chaque place est lue POUR LA DATE DE LA BOUGIE, jamais pour
            aujourd hui : les changements d heure ne tombent pas le meme jour à Londres, New York
            et Tokyo.
         3. Fenetre en intervalle SEMI-OUVERT [ouverture, fermeture) : l heure de fermeture
            appartient a la seance suivante, pas aux deux.
         Les seances se CHEVAUCHENT (Londres et New York partagent l apres-midi) : chaque ligne
         est donc mesuree independamment, et la somme des trois ne fait pas la journee. C est dit
         sur la carte. Reserve aux paires FX : sur un indice, la notion de seance mondiale n a
         pas le meme sens. */
      opts: [
        { k: 'paire', lbl: 'Paire', type: 'choix', def: 'EUR/USD', choix: _fxChoix() },
        /* L unite change la QUESTION posee : 60 pips sur EUR/USD et 60 pips sur USD/JPY ne pesent
           pas la meme chose, 0,55 % et 0,41 % oui. Le pourcentage rend les places comparables
           d une paire a l autre. */
        { k: 'unite', lbl: 'Unité', type: 'choix', def: 'pips',
          choix: [['pips', 'Pips'], ['pct', '% du cours']] },
      ],
      mount: function (host, it) {
        var W = this, vivant = true, cache = {};
        skel(host, 4);
        // Les trois places qui font le volume. Sydney est ecarte : sa seance chevauche le
        // changement de jour, ce qui demanderait une regle d attribution de jour a expliquer
        // pour un apport marginal.
        var PLACES = [
          { nom: 'Tokyo', tz: 'Asia/Tokyo', ouv: 9, fer: 15 },
          { nom: 'Londres', tz: 'Europe/London', ouv: 8, fer: 17 },
          { nom: 'New York', tz: 'America/New_York', ouv: 9, fer: 17 },
        ];
        // Mémoire des chiffres du JOUR : fondu de MAJ seulement sur un vrai changement, à paire
        // constante — jamais au premier rendu.
        var prevSymAS = null, prevSigAS = null;

        /* Jour + heure locaux d'une place, MAINTENANT, via Intl (même mécanique que _heureLocale :
           le fuseau traite lui-même les changements d'heure). L'heure seule ne suffit pas pour
           deux questions : une place n'ouvre PAS le samedi, quelle que soit l'heure affichée, et
           « prochaine ouverture » doit compter en jour local DE LA PLACE. */
        var _fmtJH = {};
        function jourHeure(tz, ms) {
          try {
            if (!_fmtJH[tz]) _fmtJH[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
            var JOURS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            var j = null, hh = 0, mn = 0;
            _fmtJH[tz].formatToParts(new Date(ms)).forEach(function (x) {
              if (x.type === 'weekday') j = JOURS[x.value];
              if (x.type === 'hour') hh = parseInt(x.value, 10);
              if (x.type === 'minute') mn = parseInt(x.value, 10);
            });
            return j == null ? null : { j: j, h: (hh % 24) + mn / 60 };
          } catch (e) { return null; }
        }
        /* Heures d'attente avant la PROCHAINE ouverture d'une place fermée. Compte en heures
           locales de la place et SAUTE samedi/dimanche : vendredi 22 h, Tokyo n'ouvre pas « dans
           11 h » mais lundi (trou relevé par la contre-lecture). Un changement d'heure DANS la
           fenêtre d'attente décale d'une heure au plus : accepté, l'affichage est indicatif. */
        function attenteOuverture(p) {
          var jh = jourHeure(p.tz, Date.now());
          if (!jh) return null;
          if (jh.j >= 1 && jh.j <= 5 && jh.h < p.ouv) return p.ouv - jh.h;
          var att = 24 - jh.h + p.ouv, j = (jh.j + 1) % 7;
          while (j === 0 || j === 6) { att += 24; j = (j + 1) % 7; }
          return att;
        }

        function dessiner() {
          var sym = opt(it, W, 'paire') || 'EUR/USD';
          var pip = _pipTaille(sym);
          if (!pip) { fallback(host, 'Réservé aux paires de devises.'); return; }
          // En pourcentage, l amplitude est rapportee au cours : 60 pips sur EUR/USD et 60 pips
          // sur USD/JPY ne pesent pas la meme chose, 0,55 % et 0,41 % oui.
          var enPct = opt(it, W, 'unite') === 'pct';
          _bougies(sym, 'H1', cache).then(function (c) {
            if (!vivant || !host.isConnected) return;
            if (c.length < 50) { fallback(host, 'Historique insuffisant.'); return; }
            // Controle d unite AVANT tout calcul : une tolerance large (30 min a 2 h) absorbe
            // les trous de marche sans laisser passer du journalier.
            var pas = _pasMedian(c);
            if (!pas || pas < 30 * 60000 || pas > 2 * 3600000) {
              fallback(host, 'La source n\'a pas servi de bougies horaires pour cette paire.');
              return;
            }
            var lignes = PLACES.map(function (p) {
              var amp = [], jours = {};
              /* Parcours d'AUJOURD'HUI (date UTC) dans la même fenêtre horaire : le présent de la
                 ligne. La séance du jour est EXCLUE de la moyenne, règle de toute la famille :
                 une période inachevée ne rentre pas dans l'historique auquel on la compare. */
              var aujH = -Infinity, aujL = Infinity;
              c.forEach(function (b) {
                var hl = _heureLocale(p.tz, b.t);
                if (hl == null) return;
                // Intervalle SEMI-OUVERT : l heure de fermeture n appartient pas a la seance.
                if (hl < p.ouv || hl >= p.fer) return;
                if (_memeJourUTC(b.t)) {
                  if (b.h > aujH) aujH = b.h;
                  if (b.l < aujL) aujL = b.l;
                  return;
                }
                // Regroupement par journee de la place, pour mesurer l amplitude de la SEANCE
                // entiere et non celle d une bougie isolee.
                var cle = new Date(b.t).toISOString().slice(0, 10) + '|' + Math.floor(hl / 24);
                var g = jours[cle] || (jours[cle] = { h: -Infinity, l: Infinity });
                if (b.h > g.h) g.h = b.h;
                if (b.l < g.l) g.l = b.l;
              });
              Object.keys(jours).forEach(function (k) {
                var g = jours[k];
                if (isFinite(g.h) && isFinite(g.l) && g.h > g.l) {
                  amp.push(enPct ? (g.h - g.l) / g.l * 100 : (g.h - g.l) / pip);
                }
              });
              var moy = amp.length ? amp.reduce(function (a, b) { return a + b; }, 0) / amp.length : null;
              var auj = (isFinite(aujH) && isFinite(aujL) && aujH > aujL)
                ? (enPct ? (aujH - aujL) / aujL * 100 : (aujH - aujL) / pip) : null;
              /* État de la place MAINTENANT, en jour + heure locaux DE LA PLACE. Une place fermée
                 qui n'a pas encore ouvert ne rend jamais « 0 pips, 0 % » : elle dit pourquoi elle
                 se tait (garde de la contre-lecture). */
              var jh = jourHeure(p.tz, Date.now());
              var ouvrable = !!(jh && jh.j >= 1 && jh.j <= 5);
              return { nom: p.nom, moy: moy, n: amp.length, ouv: p.ouv, fer: p.fer, tz: p.tz,
                auj: auj, place: p, weekEnd: !!(jh && !ouvrable),
                pasEncore: !!(jh && ouvrable && jh.h < p.ouv),
                ouverte: !!(jh && ouvrable && jh.h >= p.ouv && jh.h < p.fer) };
            });
            var max = Math.max.apply(null, lignes.map(function (l) { return l.moy || 0; })) || 1;
            var fmtA = function (v) { return enPct ? v.toFixed(2).replace('.', ',') + '%' : v.toFixed(0) + ' pips'; };
            var h = '<div class="wdg-as"><div class="wdg-as-tete"><span class="wdg-as-sym">' + esc(sym) + '</span></div>';
            lignes.forEach(function (l, iP) {
              var w = l.moy ? Math.max(3, l.moy / max * 100) : 0;
              var ratio = (l.auj != null && l.moy) ? l.auj / l.moy * 100 : null;
              // Surcouche du jour sur la MÊME échelle que la moyenne : comparaison à l'œil.
              var wAuj = l.auj != null ? Math.min(100, Math.max(1, l.auj / max * 100)) : null;
              var nTxt;
              if (ratio != null) nTxt = fmtA(l.auj) + ' aujourd\'hui &middot; ' + Math.round(ratio) + ' % de la moyenne &middot; ' + l.n + ' séance' + (l.n > 1 ? 's' : '');
              else if (l.weekEnd) nTxt = 'Fermée le week-end &middot; ' + l.n + ' séance' + (l.n > 1 ? 's' : '');
              else if (l.pasEncore) nTxt = 'Pas encore ouverte aujourd\'hui &middot; ' + l.n + ' séance' + (l.n > 1 ? 's' : '');
              else nTxt = l.n + ' séance' + (l.n > 1 ? 's' : '');
              // Badge strictement STATIQUE (règle dure : jamais d'animation clignotante sur du live).
              h += '<div class="wdg-as-l' + (l.ouverte ? ' est-live' : '') + '" data-place="' + iP + '">'
                + '<div class="wdg-as-t"><span>' + esc(l.nom) + '</span>'
                + (l.ouverte ? '<em class="wdg-as-badge">EN SÉANCE</em>' : '')
                + '<i>' + l.ouv + 'h-' + l.fer + 'h locale</i>'
                + '<b>' + (l.moy != null ? fmtA(l.moy) : '--') + '</b></div>'
                + '<div class="wdg-as-piste"><span style="width:' + w.toFixed(1) + '%"></span>'
                + (wAuj != null ? '<u class="wdg-as-auj" style="width:' + wAuj.toFixed(1) + '%"></u>' : '')
                + '</div>'
                + '<div class="wdg-as-n' + (l.ouverte ? ' wdg-maj-txt' : '') + '">' + nTxt + '</div></div>';
            });

            /* ── VERDICT : qui est en séance MAINTENANT, et où elle en est. En chevauchement
               (Londres + New York), le détail porte sur la place ouverte la plus récente (l'ordre
               de PLACES est chronologique). Rien d'ouvert : on dit QUAND ça rouvre. */
            var ouvertes = lignes.filter(function (l) { return l.ouverte; });
            var ETAT_TXT = { calme: 'séance calme pour l\'instant', norme: 'rythme normal', nourrie: 'séance déjà nourrie', extreme: 'séance exceptionnelle' };
            var vb = '', vs = '';
            if (ouvertes.length === 1) {
              var u = ouvertes[0];
              var r1 = (u.auj != null && u.moy) ? u.auj / u.moy * 100 : null;
              if (r1 != null) {
                vb = u.nom + ' en séance : ' + fmtA(u.auj) + ' parcourus, ' + Math.round(r1) + ' % de sa moyenne';
                var t1 = ETAT_TXT[_ampEtat(r1)] || '';
                vs = t1 ? t1.charAt(0).toUpperCase() + t1.slice(1) + '.' : '';
              } else {
                vb = u.nom + ' en séance';
                vs = 'Ouverture récente : première bougie horaire en attente.';
              }
            } else if (ouvertes.length > 1) {
              vb = ouvertes.map(function (l) { return l.nom; }).join(' + ') + ' en séance';
              var ld = ouvertes[ouvertes.length - 1];
              var r2 = (ld.auj != null && ld.moy) ? ld.auj / ld.moy * 100 : null;
              vs = r2 != null
                ? ld.nom + ' : ' + fmtA(ld.auj) + ', ' + Math.round(r2) + ' % de sa moyenne : ' + (ETAT_TXT[_ampEtat(r2)] || '') + '.'
                : ld.nom + ' : première bougie horaire en attente.';
            } else {
              vb = 'Aucune place en séance';
              var proch = null;
              lignes.forEach(function (l) {
                var att = attenteOuverture(l.place);
                if (att != null && (proch == null || att < proch.att)) proch = { l: l, att: att };
              });
              if (proch) {
                var hE = Math.floor(proch.att), mnE = Math.round((proch.att - hE) * 60);
                if (mnE === 60) { hE += 1; mnE = 0; }
                var dTxt = hE >= 24
                  ? Math.floor(hE / 24) + ' j ' + (hE % 24) + ' h'
                  : hE + ' h' + (mnE > 0 ? ' ' + (mnE < 10 ? '0' : '') + mnE : '');
                vs = 'Prochaine ouverture : ' + proch.l.nom + ', ' + proch.l.ouv + ' h locales (dans ' + dTxt + ').';
              }
            }
            h += '<div class="wdg-verdict" data-etat="' + (ouvertes.length ? 'live' : 'ferme') + '">'
              + '<b class="wdg-verdict-txt wdg-maj-txt">' + esc(vb) + '</b>'
              + (vs ? '<span class="wdg-verdict-sous">' + esc(vs) + '</span>' : '')
              + '</div>';

            h += '<div class="wdg-as-pied">Les séances se chevauchent : la somme des trois ne fait pas la journée. '
              + 'Heures locales de chaque place, changement d\'heure compris. '
              + _vieSpan(_bougiesMaj(sym + '|H1')) + '</div></div>';
            host.innerHTML = h;

            // Fondu de MAJ : un chiffre du jour a bougé, ou une place a ouvert/fermé (paire constante).
            var sig = lignes.map(function (l) { return (l.ouverte ? 1 : 0) + ':' + (l.auj == null ? '' : l.auj.toFixed(4)); }).join(';');
            if (prevSymAS === sym && prevSigAS != null && sig !== prevSigAS) {
              _majFlash(host.querySelector('.wdg-verdict-txt'));
              host.querySelectorAll('.wdg-as-l.est-live .wdg-as-n').forEach(function (el) { _majFlash(el); });
            }
            prevSymAS = sym; prevSigAS = sig;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Bougies indisponibles.'); });
        }
        dessiner();
        var stop = _rafraichirBougies(host, dessiner);
        return function () { vivant = false; stop(); };
      },
    },
    {
      id: 'distribution-variations', name: 'Variations quotidiennes', tag: 'VOLATILITÉ', cat: 'Marchés', h: 320,
      desc: 'La forme réelle des séances : combien de journées à +0,3%, combien à -1%.',
      aide: "<p>L'histogramme des variations quotidiennes, de clôture à clôture : chaque barre compte les séances tombées dans sa classe, rouge sous zéro, vert au-dessus. Le repère or situe la séance en cours dans cette forme, et la ligne du bas la traduit en percentile.</p><p>C'est un <strong>étalon de normalité</strong> : savoir que l'essentiel des séances fait moins de ±0,5% change la lecture d'un mouvement de 0,8%. Un objectif posé dans la queue de distribution exige une séance rare ; un stop posé au cœur de la distribution sera touché par le bruit ordinaire.</p>",
      src: "Bougies quotidiennes réelles, relues toutes les 5 minutes ; la séance en cours est exclue du calcul (elle n'a pas de clôture) et les trous de série sont écartés puis comptés sur la carte.",
      watch: "Le percentile du jour : au-delà de P90 ou sous P10, l'essentiel du mouvement type est déjà fait ; l'asymétrie de la forme dit aussi de quel côté la paire a l'habitude d'exagérer.",
      /* ⚠️ La derniere bougie est TOUJOURS retiree, sans test de date : la journee en cours n a
         pas de cloture, donc pas de variation. Regle deterministe, identique pour tout le monde,
         et ecrite sur la carte.
         ⚠️ Les couples separes par un trou de temps sont ecartes (voir _couplesValides) et le
         nombre d ecarts rejetes est affiche a cote de l echantillon. */
      opts: [
        { k: 'paire', lbl: 'Paire', type: 'choix', def: 'EUR/USD', choix: _fxChoix() },
        { k: 'pas', lbl: 'Largeur des classes', type: 'choix', def: '0.25',
          choix: [['0.1', '0,1%'], ['0.25', '0,25%'], ['0.5', '0,5%']] },
      ],
      mount: function (host, it) {
        var W = this, vivant = true, cache = {};
        /* Mémoire de rendu : signature de la STRUCTURE (paire, pas, échantillon, classes) pour ne
           réécrire que le présent quand rien d'autre n'a bougé — le repère du jour GLISSE alors
           via sa transition CSS au lieu de réapparaître — et dernière variation du jour pour ne
           jouer le fondu de MAJ que sur un vrai changement. */
        var prevSig = null, prevV = null;
        skel(host, 5);
        function dessiner() {
          var sym = opt(it, W, 'paire') || 'EUR/USD';
          var pas = parseFloat(opt(it, W, 'pas')) || 0.25;
          _bougies(sym, 'D1', cache).then(function (c) {
            if (!vivant || !host.isConnected) return;
            if (c.length < 30) { fallback(host, 'Historique insuffisant.'); return; }
            // Journee en cours retiree sans condition : elle n a pas de cloture.
            var closes = c.slice(0, -1);
            var v = _couplesValides(closes, 'D1');
            var vars = v.couples.map(function (p) { return (p[1].c / p[0].c - 1) * 100; })
              .filter(function (x) { return isFinite(x); });
            var n = vars.length;
            if (n < 30) { fallback(host, 'Historique insuffisant (n = ' + n + ').'); return; }
            // Classes symetriques autour de zero, bornees a +/- 5 pas.
            var K = 10;
            var classes = [], etiq = [];
            for (var i = -K; i < K; i++) {
              var bas = i * pas, haut = (i + 1) * pas;
              // Intervalle SEMI-OUVERT [bas, haut) : une valeur ne peut pas tomber dans deux classes.
              classes.push(vars.filter(function (x) {
                if (i === -K) return x < haut;
                if (i === K - 1) return x >= bas;
                return x >= bas && x < haut;
              }).length);
              etiq.push(bas);
            }
            var moy = vars.reduce(function (a, b) { return a + b; }, 0) / n;
            var hausse = vars.filter(function (x) { return x > 0; }).length;

            /* ── LE PRÉSENT : où tombe AUJOURD'HUI dans la forme affichée — la seule utilité
               temps réel de la carte. GARDE DE DATE (contre-lecture) : la dernière ligne n'est
               « aujourd'hui » QUE si sa date UTC le dit ; tout le week-end c'est la bougie de
               VENDREDI, donc « Dernière séance close ». La variation exige aussi un écart de
               dates plausible avec la clôture précédente (même borne que _couplesValides :
               samedi, vendredi-vs-jeudi passe cette borne, d'où la garde de date en plus). */
            var derniere = c[c.length - 1], avant = c.length > 1 ? c[c.length - 2] : null;
            var enCours = _memeJourUTC(derniere.t);
            var vRef = null;
            if (avant && derniere.t - avant.t <= _ECART_MAX.D1 && isFinite(derniere.c) && isFinite(avant.c) && avant.c > 0) {
              var vv = (derniere.c / avant.c - 1) * 100;
              if (isFinite(vv)) vRef = vv;
            }
            var etat = '', vbH = '', vsT = '', lxPct = null;
            if (vRef != null) {
              var pctl = Math.round(vars.filter(function (x) { return x <= vRef; }).length / n * 100);
              // Bandes par percentile de la variation SIGNÉE : le milieu est ordinaire, les
              // flancs sont animés, les extrémités sont la queue de distribution.
              if (pctl >= 90 || pctl <= 10) { etat = 'queue'; vsT = 'Queue de distribution : l\'essentiel du mouvement type est déjà fait.'; }
              else if (pctl >= 75 || pctl <= 25) { etat = 'anime'; vsT = 'Séance plus mouvementée que d\'ordinaire.'; }
              else { etat = 'ordinaire'; vsT = 'Au cœur de la distribution : séance ordinaire' + (enCours ? ' à ce stade' : '') + '.'; }
              var vTxt = '<span class="' + (vRef >= 0 ? 'est-haut' : 'est-bas') + '">' + (vRef >= 0 ? '+' : '') + vRef.toFixed(2).replace('.', ',') + ' %</span>';
              var prefixe = enCours ? 'Aujourd\'hui : ' : 'Dernière séance close : ';
              if (etat === 'ordinaire') vbH = prefixe + vTxt + ' (P' + pctl + ')';
              else if (pctl >= 50) vbH = prefixe + vTxt + ', au-dessus de ' + pctl + ' % des séances';
              else vbH = prefixe + vTxt + ', plus bas que ' + (100 - pctl) + ' % des séances';
              if (enCours) {
                /* Repère 2 px or SUR l'histogramme, sans recolorer une classe entière (ce serait
                   mentir sur l'historique). Position bornée aux limites du tracé : une séance
                   hors bornes se colle au bord. Réservé au jour EN COURS : pointer une séance
                   close de vendredi comme du présent serait le mensonge corrigé plus haut. */
                var lo = etiq[0], hi = etiq[etiq.length - 1] + pas;
                lxPct = (Math.max(lo, Math.min(hi, vRef)) - lo) / (2 * K * pas) * 100;
              }
            }
            var ts = _bougiesMaj(sym + '|D1');

            /* Diff minimal : à STRUCTURE identique (même paire, même pas, même échantillon), on
               ne réécrit que le présent — repère, verdict, horodatage. Toute autre différence
               (nouvelle séance close, changement de réglage) rebâtit la carte entière. */
            var sig = sym + '|' + pas + '|' + n + '|' + classes.join(',') + '|' + (enCours ? 1 : 0) + '|' + (vRef == null ? 0 : 1);
            if (sig === prevSig && host.querySelector('.wdg-di')) {
              var repEl = host.querySelector('.wdg-di-auj');
              if (repEl && lxPct != null) repEl.style.left = lxPct.toFixed(1) + '%';
              var vd = host.querySelector('.wdg-di .wdg-verdict');
              if (vd) {
                vd.setAttribute('data-etat', etat);
                var vt = vd.querySelector('.wdg-verdict-txt');
                if (vt) vt.innerHTML = vbH;
                var vsE = vd.querySelector('.wdg-verdict-sous');
                if (vsE) vsE.textContent = vsT;
                if (vt && prevV != null && vRef != null && Math.abs(vRef - prevV) > 1e-9) _majFlash(vt);
              }
              var vieEl = host.querySelector('.wdg-di-pied .wdg-vie');
              if (vieEl && ts) { vieEl.setAttribute('data-ts', String(+ts)); vieEl.textContent = _vie(ts); }
              prevV = vRef;
              return;
            }

            host.innerHTML = '<div class="wdg-di">'
              + '<div class="wdg-di-tete"><span class="wdg-di-sym">' + esc(sym) + '</span>'
              + '<span class="wdg-di-n">n = ' + n + '</span></div>'
              // Une classe sous zero est une seance de BAISSE, au-dessus une seance de HAUSSE :
              // la couleur ne fait que dire ce que l abscisse dit deja, elle n invente rien.
              + '<div class="wdg-di-zone">' + _barresSvg(classes, {
                couleurs: etiq.map(function (b0) { return b0 < 0 ? '#ff3d00' : '#00e676'; }),
              })
              + (lxPct != null ? '<i class="wdg-di-auj" style="left:' + lxPct.toFixed(1) + '%"></i>' : '')
              + '</div>'
              + '<div class="wdg-di-axe"><span>' + (etiq[0]).toFixed(1).replace('.', ',') + ' %</span>'
              + '<span>0</span><span>+' + (etiq[etiq.length - 1] + pas).toFixed(1).replace('.', ',') + ' %</span></div>'
              + (vbH ? '<div class="wdg-verdict" data-etat="' + etat + '">'
                  + '<b class="wdg-verdict-txt wdg-maj-txt">' + vbH + '</b>'
                  + '<span class="wdg-verdict-sous">' + esc(vsT) + '</span></div>' : '')
              + '<div class="wdg-di-stats">'
              + '<span><i>Séances en hausse</i><b>' + (hausse / n * 100).toFixed(0) + ' %</b></span>'
              + '<span><i>Variation moyenne</i><b>' + (moy >= 0 ? '+' : '') + moy.toFixed(2).replace('.', ',') + ' %</b></span>'
              + '</div>'
              + '<div class="wdg-di-pied">Séance en cours exclue, elle n\'a pas de clôture. '
              + (v.rejetes > 0 ? v.rejetes + ' écart' + (v.rejetes > 1 ? 's' : '') + ' de dates écarté' + (v.rejetes > 1 ? 's' : '') + ' (trou dans la série). ' : '')
              + 'Classes de ' + String(pas).replace('.', ',') + ' %, bornes incluses à gauche. '
              + _vieSpan(ts) + '</div></div>';
            prevSig = sig; prevV = vRef;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Bougies indisponibles.'); });
        }
        dessiner();
        var stop = _rafraichirBougies(host, dessiner);
        return function () { vivant = false; stop(); };
      },
    },

    {
      id: 'stats-volatilite', name: 'Mesures de volatilité', tag: 'VOLATILITÉ', cat: 'Marchés', h: 210,
      desc: 'L\'écart-type des variations, en séance et en semaine, avec l\'amplitude vraie moyenne.',
      aide: "<p>Deux colonnes, séance et semaine : l'écart-type des variations et l'<strong>amplitude vraie</strong> moyenne, c'est-à-dire le plus grand écart entre le haut, le bas et la clôture précédente, qui inclut les trous d'ouverture. La ligne de régime compare les 20 dernières séances à l'ensemble de l'échantillon.</p><p>Ces chiffres calibrent stop et objectif : un stop plus serré que l'amplitude vraie d'une séance ordinaire sera touché par le bruit. Le régime dit si les moyennes affichées décrivent le marché actuel, ou si elles le sous-estiment.</p>",
      src: "Bougies quotidiennes et hebdomadaires réelles, relues toutes les 5 minutes ; chaque colonne a son repli (si une série manque, l'autre reste affichée) et la période en cours est exclue des moyennes.",
      watch: "La ligne de régime : « volatilité élevée » signifie que les moyennes affichées sous-estiment le présent, et que les distances habituelles de stop et d'objectif demandent d'être revues.",
      /* ⚠️ REPLI PAR COLONNE : si l hebdomadaire ne repond pas, la colonne journaliere reste
         affichee. Une carte entierement muette parce qu UNE des deux series manque serait une
         perte d information gratuite.
         ⚠️ La tuile en pips est reservee aux paires FX : sur un indice ou l or, le pip n a pas de
         sens et la valeur serait un nombre sans unite. */
      opts: [
        { k: 'paire', lbl: 'Paire', type: 'choix', def: 'EUR/USD', choix: _fxChoix() },
        /* Moyenne ou mediane : sur une paire FX la moyenne est tiree vers le haut par trois
           journees de chiffres majeurs. La mediane dit la seance ORDINAIRE. Les deux se calculent
           sur les memes valeurs : aucune donnee supplementaire n est requise. */
        { k: 'mesure', lbl: 'Amplitude retenue', type: 'choix', def: 'moy',
          choix: [['moy', 'Moyenne'], ['med', 'Médiane']] },
      ],
      mount: function (host, it) {
        var W = this, vivant = true, cache = {};
        // Mémoire des lignes du PRÉSENT : fondu de MAJ seulement sur un vrai changement, à paire
        // constante — jamais au premier rendu.
        var prevSymVo = null, prevSigVo = null;
        skel(host, 4);

        // Ecart-type des variations en %, et amplitude vraie moyenne, sur les couples PLAUSIBLES.
        function stats(c, tf, sym, mesure) {
          if (!c || c.length < 12) return null;
          var closes = c.slice(0, -1);            // periode en cours exclue : pas de cloture
          var v = _couplesValides(closes, tf);
          if (v.couples.length < 10) return null;
          var r = v.couples.map(function (p) { return (p[1].c / p[0].c - 1) * 100; }).filter(isFinite);
          var moy = r.reduce(function (a, b) { return a + b; }, 0) / r.length;
          var ec = Math.sqrt(r.reduce(function (a, b) { return a + (b - moy) * (b - moy); }, 0) / r.length);
          // Amplitude vraie : le plus grand des trois ecarts, qui inclut les trous d ouverture.
          var tr = v.couples.map(function (p) {
            return Math.max(p[1].h - p[1].l, Math.abs(p[1].h - p[0].c), Math.abs(p[1].l - p[0].c));
          }).filter(isFinite);
          // Moyenne OU mediane, au choix : sur une paire FX la moyenne est tiree vers le haut par
          // trois journees de chiffres majeurs, la mediane dit la seance ordinaire.
          var trTri = tr.slice().sort(function (a, b) { return a - b; });
          var trMoy = (mesure === 'med')
            ? trTri[Math.floor(trTri.length / 2)]
            : tr.reduce(function (a, b) { return a + b; }, 0) / tr.length;
          var pip = _pipTaille(sym);
          // r est rendu AUSSI : le régime (écart-type des 20 dernières séances vs l'échantillon)
          // se calcule dessus sans refaire la série.
          return { n: r.length, ec: ec, tr: trMoy, trPips: pip ? trMoy / pip : null, rejetes: v.rejetes, r: r };
        }

        function colonne(titre, st, mes, presL) {
          if (!st) return '<div class="wdg-vo-col"><div class="wdg-vo-t">' + esc(titre) + '</div>'
            + '<div class="wdg-vo-abs">indisponible</div></div>';
          return '<div class="wdg-vo-col"><div class="wdg-vo-t">' + esc(titre) + '</div>'
            + '<div class="wdg-vo-l"><i>Écart-type</i><b>' + st.ec.toFixed(2).replace('.', ',') + ' %</b></div>'
            + '<div class="wdg-vo-l"><i>Amplitude vraie' + (mes === 'med' ? ' (médiane)' : '') + '</i><b>'
            + (st.trPips != null ? st.trPips.toFixed(0) + ' pips' : st.tr.toFixed(2)) + '</b></div>'
            + (presL || '')
            + '<div class="wdg-vo-n">' + st.n + ' périodes'
            + (st.rejetes > 0 ? ' &middot; ' + st.rejetes + ' écart' + (st.rejetes > 1 ? 's' : '') + ' écarté' + (st.rejetes > 1 ? 's' : '') : '')
            + '</div></div>';
        }

        function dessiner() {
          var sym = opt(it, W, 'paire') || 'EUR/USD';
          // Repli PAR COLONNE : chaque promesse se rabat sur null, jamais sur un rejet global.
          Promise.all([
            _bougies(sym, 'D1', cache).catch(function () { return null; }),
            _bougies(sym, 'W1', cache).catch(function () { return null; }),
          ]).then(function (r) {
            if (!vivant || !host.isConnected) return;
            var mesure = opt(it, W, 'mesure') || 'moy';
            var j = r[0] ? stats(r[0], 'D1', sym, mesure) : null;
            var sem = r[1] ? stats(r[1], 'W1', sym, mesure) : null;
            if (!j && !sem) { fallback(host, 'Bougies indisponibles.'); return; }

            /* ── Ligne du PRÉSENT par colonne : l'amplitude vraie de la période en cours (MÊME
               formule que l'historique), à comparer d'un regard aux moyennes affichées. Période
               « en cours » identifiée par sa date UTC : un dimanche, la dernière ligne est celle
               de vendredi et s'étiquette « close », jamais « en cours » (règle de la famille). */
            function presente(cc, tf, st, lblCours, lblClose) {
              if (!cc || cc.length < 2 || !st || !(st.tr > 0)) return '';
              var d = cc[cc.length - 1], p = cc[cc.length - 2];
              var enCours = tf === 'W1' ? _memeSemaineUTC(d.t) : _memeJourUTC(d.t);
              // Trou de dates trop grand : la clôture précédente ne veut rien dire, on retombe
              // sur le simple haut-bas de la période.
              var okPrev = isFinite(p.c) && (d.t - p.t) <= (_ECART_MAX[tf] || _ECART_MAX.D1);
              var tr = okPrev ? Math.max(d.h - d.l, Math.abs(d.h - p.c), Math.abs(d.l - p.c)) : (d.h - d.l);
              if (!isFinite(tr) || tr <= 0) return '';
              var pip = _pipTaille(sym);
              var val = pip ? (tr / pip).toFixed(0) + ' pips' : tr.toFixed(2);
              return '<div class="wdg-vo-l est-auj"><i>' + (enCours ? lblCours : lblClose) + '</i>'
                + '<b class="wdg-maj-txt">' + val + ' &middot; ' + Math.round(tr / st.tr * 100) + ' %</b></div>';
            }
            var presJ = r[0] ? presente(r[0], 'D1', j, 'Séance en cours', 'Dernière séance close') : '';
            var presS = r[1] ? presente(r[1], 'W1', sem, 'Semaine en cours', 'Dernière semaine close') : '';

            /* ── RÉGIME : l'écart-type des 20 dernières séances rapporté à celui de tout
               l'échantillon journalier — le point de référence présent qui manquait : il dit si
               les moyennes affichées décrivent le marché ACTUEL. Moins de 20 couples : on se
               TAIT (un « -28 % » calculé sur 12 points serait du bruit présenté en verdict,
               garde de la contre-lecture). Si l'hebdo manque, le régime tient sur la seule
               colonne journalière : le repli PAR COLONNE reste entier. Or DTP pour « élevée » :
               la volatilité n'est pas directionnelle, jamais de vert/rouge ici (charte). */
            var verdict = '';
            if (j && j.r && j.r.length >= 20 && j.ec > 0) {
              var d20 = j.r.slice(-20);
              var m20 = d20.reduce(function (a, b) { return a + b; }, 0) / d20.length;
              var ec20 = Math.sqrt(d20.reduce(function (a, b) { return a + (b - m20) * (b - m20); }, 0) / d20.length);
              var ratio = ec20 / j.ec * 100;
              var etat = ratio < 80 ? 'retrait' : (ratio <= 120 ? 'norme' : 'eleve');
              var reg = { retrait: 'Volatilité en retrait', norme: 'Volatilité dans sa norme', eleve: 'Volatilité élevée' }[etat];
              var delta = Math.round(Math.abs(ratio - 100));
              var sous = etat === 'norme'
                ? 'Les 20 dernières séances bougent comme l\'habitude (' + Math.round(ratio) + ' %) : les moyennes affichées décrivent bien le marché actuel.'
                : etat === 'retrait'
                  ? 'Les 20 dernières séances bougent ' + delta + ' % de moins que l\'habitude.'
                  : 'Les 20 dernières séances bougent ' + delta + ' % de plus que l\'habitude : les moyennes affichées sous-estiment le présent.';
              verdict = '<div class="wdg-verdict" data-etat="' + etat + '">'
                + '<b class="wdg-verdict-txt' + (etat === 'eleve' ? ' est-present' : '') + '">' + reg + '</b>'
                + '<span class="wdg-verdict-sous">' + sous + '</span></div>';
            }

            // Horodatage : la lecture la plus ANCIENNE des deux séries (afficher la plus fraîche
            // prétendrait que tout est à jour alors qu'une des colonnes ne l'est pas).
            var t1 = _bougiesMaj(sym + '|D1'), t2 = _bougiesMaj(sym + '|W1');
            var ts = t1 && t2 ? Math.min(t1, t2) : (t1 || t2);

            host.innerHTML = '<div class="wdg-vo">'
              + '<div class="wdg-vo-tete"><span class="wdg-vo-sym">' + esc(sym) + '</span></div>'
              + verdict
              + '<div class="wdg-vo-cols">' + colonne('Séance', j, mesure, presJ) + colonne('Semaine', sem, mesure, presS) + '</div>'
              + '<div class="wdg-vo-pied">Période en cours exclue. L\'amplitude vraie retient le plus grand écart entre le haut, le bas et la clôture précédente. '
              + _vieSpan(ts) + '</div></div>';

            // Fondu de MAJ sur les lignes du présent quand leur chiffre a bougé (paire constante).
            var sigV = presJ + '§' + presS;
            if (prevSymVo === sym && prevSigVo != null && sigV !== prevSigVo) {
              host.querySelectorAll('.wdg-vo-l.est-auj b').forEach(function (el) { _majFlash(el); });
            }
            prevSymVo = sym; prevSigVo = sigV;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Bougies indisponibles.'); });
        }
        dessiner();
        var stop = _rafraichirBougies(host, dessiner);
        return function () { vivant = false; stop(); };
      },
    },
    {
      id: 'heatmap-seance', name: 'Carte de chaleur FX', tag: 'FX', cat: 'Marchés', h: 268,
      desc: 'Les 28 croisements majeurs colorés par leur variation du jour, du plus vert au plus rouge.',
      aide: "<p>Les 28 croisements des huit majeures, chacun coloré par sa variation de séance : plus la teinte est saturée, plus le mouvement est marqué ; une case éteinte signale une donnée absente, jamais une variation nulle. La ligne du bas nomme la meneuse, la lanterne et le compte hausses/baisses.</p><p>La grille se lit par <strong>devise</strong> autant que par case : une devise forte teinte ses sept croisements dans le même sens. C'est le moyen le plus rapide de voir si un mouvement est propre à une paire ou porté par une devise entière, ce qui change la qualité du signal.</p>",
      src: "Variations de séance servies par le desk et relues toutes les 150 secondes ; seules les cases qui ont réellement bougé sont mises en évidence.",
      watch: "Une devise qui gagne ou perd la quasi-totalité de ses croisements (la sous-ligne le chiffre), et le passage d'une séance atone à une séance animée.",
      /* ⚠️ PERIMETRE VOLONTAIREMENT ETROIT. La contre-verification a montre qu une heatmap
         multi-periodes (1 mois, 3 mois, 12 mois) ferait DOUBLON avec la Liste FX, qui sert deja
         ces colonnes. On garde la seule chose que la Liste FX ne rend PAS en chaleur : la
         variation de SEANCE. Une tuile par croisement, triable, plutot qu un groupement par
         devise de base qui donnerait sept lignes inegales (7, 6, 5, 4, 3, 2, 1). */
      opts: [
        { k: 'tri', lbl: 'Classement', type: 'choix', def: 'var',
          choix: [['var', 'Par variation'], ['alpha', 'Alphabétique']] },
        /* Les tuiles portaient deux lignes en dur, ce qui les ecrase des que la carte descend
           sous quelques colonnes de grille. On laisse choisir ce qu elles portent. */
        { k: 'tuile', lbl: 'Contenu des tuiles', type: 'choix', def: 'complet',
          choix: [['complet', 'Symbole et variation'], ['sym', 'Symbole seul'], ['var', 'Variation seule']] },
      ],
      mount: function (host, it) {
        var W = this, vivant = true;
        skel(host, 6);
        /* Mémoire du DIFF (23/08) : le re-rendu total toutes les 150 s rendait invisible la tuile
           qui venait de bouger. ⚠️ Le tri par DÉFAUT est « par variation » : l'ORDRE change
           presque à chaque tick — un diff « seulement si rien n'a bougé » serait mort-né
           (contre-lecture). Le diff RÉINSÈRE donc les nœuds existants dans le nouvel ordre
           (appendChild déplace sans recréer) avant de retoucher leur contenu : le fondu de MAJ
           survit au reclassement. Changement d'option → reconstruction, comme avant. */
        var prevStruct = null, prevVals = null, prevVerd = null;
        function dessiner() {
          fetch('/api/fxlist').then(function (r) {
            if (!r.ok) throw new Error('http');
            return r.json();
          }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            // Garde explicite : une reponse sans tableau `pairs` n est pas une reponse vide, c est
            // une panne. On le dit au lieu d afficher une grille vide.
            if (!d || !Array.isArray(d.pairs) || !d.pairs.length) { fallback(host, 'Variations indisponibles.'); prevStruct = null; return; }
            var t = d.pairs.slice().filter(function (p) { return p && p.symbol; });
            var triOpt = opt(it, W, 'tri');
            if (triOpt === 'alpha') t.sort(function (a, b) { return a.symbol.localeCompare(b.symbol); });
            else t.sort(function (a, b) { return (Number(b.changePct) || 0) - (Number(a.changePct) || 0); });
            var tuile = opt(it, W, 'tuile') || 'complet';

            /* ── VERDICT déterministe, sur les seules variations FINIES (la source rend null
               quand la clôture précédente manque : jamais comptées, ni dans les extrêmes ni dans
               les dénominateurs « 6/7 » — contre-lecture). Ligne 1 : meneuse + lanterne + compte
               hausses/baisses. Ligne 2 : lecture DEVISE de la même donnée. Sous 0,15 % d'ampli-
               tude max, séance atone : nommer une meneuse à +0,08 % serait du bruit. */
            var fmtV = function (v) { return (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + '%'; };
            // ⚠️ Number(null) vaut 0 : sans la garde `!= null`, une variation ABSENTE entrerait
            // dans le verdict comme un zéro connu (piège attrapé au banc).
            var finies = t.filter(function (p) { return p.changePct != null && isFinite(Number(p.changePct)); });
            var vHtml = '', vSous = '', teteSym = null, queueSym = null;
            if (finies.length) {
              var tete = finies[0], queue = finies[0], mobile = finies[0], nbH = 0, nbB = 0;
              finies.forEach(function (p) {
                var v = Number(p.changePct);
                if (v > 0) nbH++; else if (v < 0) nbB++;
                if (v > Number(tete.changePct)) tete = p;
                if (v < Number(queue.changePct)) queue = p;
                if (Math.abs(v) > Math.abs(Number(mobile.changePct))) mobile = p;
              });
              if (Math.abs(Number(mobile.changePct)) < 0.15) {
                vHtml = 'Séance atone : la plus mobile est <span class="est-present">' + esc(mobile.symbol) + '</span> ('
                  + fmtV(Number(mobile.changePct)) + ')';
                vSous = 'Aucun croisement ne dépasse 0,15% de variation.';
              } else {
                teteSym = tete.symbol; queueSym = queue.symbol;
                // Couleur par SIGNE réel : si tout baisse, la « meneuse » n'est pas peinte en vert.
                var vT = Number(tete.changePct), vQ = Number(queue.changePct);
                vHtml = '<span' + (vT > 0 ? ' class="est-haut"' : vT < 0 ? ' class="est-bas"' : '') + '>' + esc(tete.symbol) + '</span>'
                  + ' mène (' + fmtV(vT) + ') · '
                  + '<span' + (vQ < 0 ? ' class="est-bas"' : vQ > 0 ? ' class="est-haut"' : '') + '>' + esc(queue.symbol) + '</span>'
                  + ' ferme la marche (' + fmtV(vQ) + ') · '
                  + nbH + ' hausse' + (nbH > 1 ? 's' : '') + ' / ' + nbB + ' baisse' + (nbB > 1 ? 's' : '');
                /* Lecture devise : une devise « gagne » un croisement quand elle est la base d'une
                   hausse ou la contrepartie d'une baisse. Dénominateur = croisements FINIS de la
                   devise, jamais « 7 » en dur. */
                var st = {};
                finies.forEach(function (p) {
                  if (!p.base || !p.quote) return;
                  var v = Number(p.changePct);
                  st[p.base] = st[p.base] || { f: 0, w: 0, t: 0 };
                  st[p.quote] = st[p.quote] || { f: 0, w: 0, t: 0 };
                  st[p.base].t++; st[p.quote].t++;
                  if (v > 0) { st[p.base].f++; st[p.quote].w++; }
                  else if (v < 0) { st[p.base].w++; st[p.quote].f++; }
                });
                var forte = null, faible = null;
                Object.keys(st).forEach(function (dv) {
                  var s = st[dv]; if (!s.t) return;
                  if (!forte || s.f / s.t > forte.s.f / forte.s.t) forte = { dev: dv, s: s };
                  if (!faible || s.w / s.t > faible.s.w / faible.s.t) faible = { dev: dv, s: s };
                });
                if (forte && faible && forte.dev !== faible.dev && forte.s.f > 0 && faible.s.w > 0) {
                  vSous = forte.dev + ' se renforce sur ' + forte.s.f + '/' + forte.s.t + ' croisements · '
                    + faible.dev + ' faiblit sur ' + faible.s.w + '/' + faible.s.t + '.';
                }
              }
            }

            /* ── Une seule passe de calcul des tuiles, pour les deux chemins. */
            var rows = t.map(function (p) {
              // Une variation nulle n est pas la meme chose qu une variation ABSENTE : la source
              // peut rendre null (cloture precedente inconnue). On l affiche en case eteinte —
              // et comme Number(null) vaut 0, la garde `== null` est ce qui rend la case éteinte
              // réellement atteignable (le banc a montré qu'elle ne l'était pas sans elle).
              var v = p.changePct == null ? NaN : Number(p.changePct);
              var connu = isFinite(v);
              var a = connu ? Math.min(Math.abs(v) / 0.8, 1) : 0;
              // Le survol situe la séance dans la tendance : ret1M déjà servi, zéro appel de plus.
              var titre = [];
              if (connu) titre.push(fmtV(v) + ' séance');
              var r1 = p.ret1M == null ? NaN : Number(p.ret1M);
              if (isFinite(r1)) titre.push((r1 > 0 ? '+' : '') + r1.toFixed(1).replace('.', ',') + ' % sur 1 mois');
              return { p: p, connu: connu, titre: titre.join(' · '),
                fond: !connu ? 'transparent' : (v >= 0 ? 'rgba(0,230,118,' + (0.10 + a * 0.55).toFixed(2) + ')' : 'rgba(255,61,0,' + (0.10 + a * 0.55).toFixed(2) + ')'),
                vTxt: connu ? fmtV(v) : '--',
                sig: connu ? String(v) : '' };
            });

            // /api/fxlist sert updatedAt en ISO (pas en ms) : Date.parse, repli sur l'heure du fetch.
            var ts = Date.parse(d.updatedAt || '') || Date.now();
            // Identité de structure : options + ENSEMBLE des symboles (ordre stable : trié), pas
            // l'ordre d'affichage — c'est justement lui qui bouge à chaque tick.
            var struct = triOpt + '|' + tuile + '|' + (vHtml ? 1 : 0) + (vSous ? 1 : 0) + '|'
              + t.map(function (p) { return p.symbol; }).sort().join(',');

            var grille = host.querySelector('.wdg-hm .wdg-hm-grille');
            if (grille && prevStruct === struct) {
              /* ── DIFF : réinsertion dans le nouvel ordre puis retouche en place. */
              rows.forEach(function (r) {
                var el = grille.querySelector('.wdg-hm-t[data-sym="' + r.p.symbol + '"]');
                if (!el) return;
                grille.appendChild(el);           // déplace sans recréer : le fondu survit au tri
                el.style.background = r.fond;
                el.classList.toggle('est-inconnu', !r.connu);
                el.classList.toggle('est-tete', r.p.symbol === teteSym);
                el.classList.toggle('est-queue', r.p.symbol === queueSym);
                if (r.titre) el.setAttribute('title', r.titre); else el.removeAttribute('title');
                var eV = el.querySelector('.wdg-hm-v'); if (eV) eV.textContent = r.vTxt;
                if (prevVals && prevVals[r.p.symbol] !== r.sig) _majFlash(el);
              });
              var vt = host.querySelector('.wdg-hm .wdg-verdict-txt');
              if (vt && vHtml && vHtml !== prevVerd) { vt.innerHTML = vHtml; _majFlash(vt); }
              var vsE = host.querySelector('.wdg-hm .wdg-verdict-sous');
              if (vsE) vsE.textContent = vSous;
              var sp = host.querySelector('.wdg-hm .wdg-vie');
              if (sp) { sp.setAttribute('data-ts', ts); sp.textContent = _vie(ts); }
            } else {
              var h = '<div class="wdg-hm"><div class="wdg-hm-grille' + (tuile !== 'complet' ? ' est-court' : '') + '">';
              rows.forEach(function (r) {
                h += '<div class="wdg-hm-t wdg-maj-surf' + (r.connu ? '' : ' est-inconnu')
                  + (r.p.symbol === teteSym ? ' est-tete' : '') + (r.p.symbol === queueSym ? ' est-queue' : '')
                  + '" data-sym="' + esc(r.p.symbol) + '" style="background:' + r.fond + '"'
                  + (r.titre ? ' title="' + esc(r.titre) + '"' : '') + '>'
                  + (tuile !== 'var' ? '<span class="wdg-hm-s">' + esc(r.p.symbol) + '</span>' : '')
                  + (tuile !== 'sym' ? '<span class="wdg-hm-v">' + r.vTxt + '</span>' : '')
                  + '</div>';
              });
              h += '</div>';
              if (vHtml) {
                h += '<div class="wdg-verdict"><b class="wdg-verdict-txt wdg-maj-txt">' + vHtml + '</b>'
                  + (vSous ? '<span class="wdg-verdict-sous">' + esc(vSous) + '</span>' : '') + '</div>';
              }
              h += '<div class="wdg-hm-pied">Variation depuis la clôture précédente ' + _vieSpan(ts) + '</div></div>';
              host.innerHTML = h;
            }
            prevStruct = struct; prevVerd = vHtml;
            prevVals = {};
            rows.forEach(function (r) { prevVals[r.p.symbol] = r.sig; });
          }).catch(function () { if (vivant && host.isConnected) { fallback(host, 'Variations indisponibles.'); prevStruct = null; } });
        }
        dessiner();
        // 150 s : le pas du tick serveur. Plus court ne relirait que le meme cache.
        var iv = setInterval(function () { if (!document.hidden) dessiner(); }, 150000);
        return function () { vivant = false; try { clearInterval(iv); } catch (e) {} };
      },
    },

    {
      id: 'amplitude-jour', name: 'Amplitude quotidienne', tag: 'VOLATILITÉ', cat: 'Marchés', h: 300,
      desc: 'De combien la paire bouge en une séance, en moyenne, sur les dernières semaines.',
      aide: "<p>L'amplitude moyenne d'une séance (haut moins bas) sur la fenêtre choisie, avec la médiane et la position du jour : la ligne du bas donne le parcours d'aujourd'hui en pourcentage de la moyenne et en percentile, la jauge le montre face au repère « moyenne ». Sur le graphe, la barre or est la séance en cours.</p><p>C'est l'étalon du <strong>combien</strong> : viser 80 pips sur une paire qui en parcourt 55 par séance ordinaire suppose une séance au-dessus de sa norme. Une séance déjà nourrie a consommé son amplitude type ; les cassures tardives y ont moins de carburant.</p>",
      src: "Bougies quotidiennes réelles, relues toutes les 5 minutes ; la séance en cours est exclue de la moyenne, les séances plates écartées et comptées, et le pip est une convention de place, pas une donnée reçue.",
      watch: "Le ratio du jour sur la ligne du bas : sous la norme, la séance a encore de la marge ; au-delà d'une fois et demie la moyenne, elle est exceptionnelle et l'extension supplémentaire devient rare.",
      /* ⚠️ LA BOUGIE DU JOUR N EST PAS « LA DERNIERE LIGNE ». On compare sa date UTC a celle du
         jour : un dimanche, la derniere ligne est celle de vendredi, donc CLOSE, et elle doit
         entrer dans la moyenne. Deduire « seance en cours » de la position dans le tableau est
         l erreur classique de ce widget.
         ⚠️ Le nombre de seances ECARTEES (bougie plate, donnee douteuse) est affiche des qu il
         compte : sans cela, « moyenne sur 60 jours » porterait en silence sur moins. */
      opts: [
        { k: 'paire', lbl: 'Paire', type: 'choix', def: 'EUR/USD', choix: _fxChoix() },
        { k: 'jours', lbl: 'Séances retenues', type: 'nombre', def: 60, min: 20, max: 250 },
      ],
      mount: function (host, it) {
        var W = this, vivant = true, cache = {};
        /* Mémoire du chiffre du JOUR : le fondu de MAJ ne se joue que si la valeur a réellement
           bougé, jamais au premier rendu ni au changement de paire (faux signal sinon). */
        var prevSym = null, prevAuj = null;
        skel(host, 5);
        function dessiner() {
          var sym = opt(it, W, 'paire') || 'EUR/USD';
          var n = opt(it, W, 'jours') || 60;
          _bougies(sym, 'D1', cache).then(function (c) {
            if (!vivant || !host.isConnected) return;
            if (!c.length) { fallback(host, 'Bougies indisponibles.'); return; }
            var derniere = c[c.length - 1];
            var enCours = _memeJourUTC(derniere.t);
            var closes = enCours ? c.slice(0, -1) : c;
            var fenetre = closes.slice(-n);
            var brut = fenetre.length;
            // Bougie plate : haut egal au bas. Garde defensive, mais on COMPTE les ecartees.
            var util = fenetre.filter(function (b) { return b.h > b.l; });
            var ecartees = brut - util.length;
            if (util.length < 10) { fallback(host, 'Historique insuffisant (n = ' + util.length + ' séances).'); return; }
            var pip = _pipTaille(sym), unite = _uniteAmpl(sym);
            var ampl = util.map(function (b) { return pip ? (b.h - b.l) / pip : (b.h - b.l); });
            var moy = ampl.reduce(function (a, b) { return a + b; }, 0) / ampl.length;
            var tri = ampl.slice().sort(function (a, b) { return a - b; });
            var med = tri[Math.floor(tri.length / 2)];
            var dec = pip ? 0 : 2;

            /* ── LE PRÉSENT. La moyenne ne bouge pas de la journée : ce qui rend la carte vivante
               est la bougie du JOUR, déjà servie par la route et suivie par le tick de 5 min. En
               cours : amplitude d'aujourd'hui vs moyenne + percentile sur les séances closes.
               Week-end / férié : la dernière séance CLOSE, étiquetée par sa date — jamais
               « aujourd'hui » sur une bougie de vendredi (piège documenté en tête de widget). */
            var refAmp = pip ? (derniere.h - derniere.l) / pip : (derniere.h - derniere.l);
            var ratio = (moy > 0 && isFinite(refAmp) && refAmp >= 0) ? refAmp / moy * 100 : null;
            var etat = ratio == null ? null : _ampEtat(ratio);
            var verdict = '';
            if (etat) {
              var vb, vs;
              if (enCours) {
                var pctl = Math.round(tri.filter(function (v) { return v <= refAmp; }).length / tri.length * 100);
                vb = 'Aujourd\'hui : ' + refAmp.toFixed(dec) + ' ' + unite + ', ' + Math.round(ratio) + ' % de la moyenne (P' + pctl + ')';
                vs = {
                  calme: 'Séance encore calme : marge habituelle restante ~' + Math.max(0, moy - refAmp).toFixed(dec) + ' ' + unite + '.',
                  norme: 'Séance dans la norme de la paire.',
                  nourrie: 'Séance déjà nourrie : l\'amplitude type est consommée, les cassures tardives ont moins de carburant.',
                  extreme: 'Séance exceptionnelle : plus d\'une fois et demie l\'amplitude type.',
                }[etat];
              } else {
                var quand = _dateBougie(derniere.t);
                quand = quand ? quand.charAt(0).toUpperCase() + quand.slice(1) : 'Dernière séance';
                vb = quand + ' : ' + refAmp.toFixed(dec) + ' ' + unite + ', ' + Math.round(ratio) + ' % de la moyenne';
                vs = 'Séance close ' + { calme: 'sous sa norme', norme: 'dans la norme', nourrie: 'au-dessus de sa norme', extreme: 'très au-dessus de sa norme' }[etat] + '.';
              }
              /* Jauge : piste 0-140 % de la moyenne, repère « moyenne » à 100/140 = 71,4 % de la
                 largeur. Convention UNIQUE (la contre-lecture a relevé la contradiction
                 piste 0-140 / repère à 100 %) : on VOIT le dépassement au lieu de plafonner la
                 piste à la moyenne. */
              var jw = Math.min(ratio, 140) / 140 * 100;
              verdict = '<div class="wdg-verdict" data-etat="' + etat + '">'
                + '<b class="wdg-verdict-txt wdg-maj-txt">' + esc(vb) + '</b>'
                + '<span class="wdg-verdict-sous">' + esc(vs) + '</span>'
                + '<div class="wdg-jauge"><span style="width:' + jw.toFixed(1) + '%"></span><i style="left:71.4%" title="moyenne"></i></div>'
                + '</div>';
            }

            /* Le graphe marque AUJOURD'HUI : la bougie du jour est poussée en fin de série, en or,
               les séances closes gardant leur vert/rouge par signe de l'écart à la moyenne. */
            var serieG = ampl.slice(-40).map(function (v) { return v - moy; });
            var coulG = serieG.map(function (v) { return v >= 0 ? '#00e676' : '#ff3d00'; });
            if (enCours && ratio != null) { serieG.push(refAmp - moy); coulG.push('#e3b23a'); }

            host.innerHTML = '<div class="wdg-am">'
              + '<div class="wdg-am-tete"><span class="wdg-am-sym">' + esc(sym) + '</span>'
              + '<span class="wdg-am-n">' + util.length + ' séances</span></div>'
              + '<div class="wdg-am-gros"><b>' + moy.toFixed(dec) + '</b><span>' + unite + ' en moyenne par séance</span></div>'
              + '<div class="wdg-am-med">Médiane ' + med.toFixed(dec) + ' ' + unite + '</div>'
              + verdict
              + '<div class="wdg-am-zone">' + _barresSvg(serieG, { signe: true, zero: true, couleurs: coulG }) + '</div>'
              + '<div class="wdg-am-pied">'
              + (enCours ? 'Séance du jour exclue, elle n\'est pas terminée. ' : 'Dernière séance retenue : ' + esc(_dateBougie(derniere.t)) + ', close. ')
              + (ecartees > 0 ? ecartees + ' séance' + (ecartees > 1 ? 's' : '') + ' écartée' + (ecartees > 1 ? 's' : '') + ' (amplitude nulle). ' : '')
              + (pip ? 'Le pip suit la convention de place, il n\'est pas fourni par la source.' : 'Amplitude en points de cotation.')
              + ' ' + _vieSpan(_bougiesMaj(sym + '|D1'))
              + '</div></div>';

            // Fondu de MAJ : seulement quand le chiffre du JOUR a réellement bougé, à paire constante.
            if (prevSym === sym && enCours && prevAuj != null && Math.abs(refAmp - prevAuj) > 1e-9) {
              _majFlash(host.querySelector('.wdg-verdict-txt'));
            }
            prevSym = sym; prevAuj = enCours ? refAmp : null;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Bougies indisponibles.'); });
        }
        dessiner();
        var stop = _rafraichirBougies(host, dessiner);
        return function () { vivant = false; stop(); };
      },
    },

    {
      id: 'hauts-bas', name: 'Points hauts et bas', tag: 'NIVEAUX', cat: 'Marchés', h: 148,
      desc: 'Les extrêmes de la séance et de la semaine, et où se situe le cours entre les deux.',
      aide: "<p>Les extrêmes de la séance et de la semaine, l'étendue entre les deux, et un curseur qui situe le dernier cours entre le bas et le haut de chaque période. Près d'un extrême (seuil réglable), la borne concernée et le curseur s'allument.</p><p>Ces bornes sont les niveaux les plus regardés du marché : un cours collé à son extrême est soit en train de le franchir, soit en train d'y être rejeté ; c'est le seul moment où cette carte doit sauter aux yeux. La position dans la fourchette dit aussi qui a eu la main depuis l'ouverture.</p>",
      src: "Bougies quotidiennes et hebdomadaires réelles, relues toutes les 5 minutes ; « en cours » se calcule sur la date réelle de la bougie, et une semaine à peine ouverte affiche la précédente en l'annonçant.",
      watch: "Le curseur qui entre dans la zone d'alerte : la traversée d'un extrême de semaine, ou le rejet depuis cette zone, sont les deux lectures qui comptent.",
      /* ⚠️ « En cours » se CALCULE, il ne se suppose pas : on compare la date UTC de la derniere
         bougie au jour courant, et la semaine ISO en hebdomadaire. Un dimanche, la derniere ligne
         est celle de vendredi : ecrire « séance en cours » serait faux.
         ⚠️ Periode a peine ouverte : une reglette de position n a aucun sens sur une bougie de
         quelques minutes. On bascule alors sur la periode PRECEDENTE et on le dit. */
      opts: [
        { k: 'paire', lbl: 'Paire', type: 'choix', def: 'EUR/USD', choix: _fxChoix() },
        /* Alerte de bord : quand le cours se traite dans les X % hauts ou bas de la periode, la
           borne concernee et le curseur s allument. Un cours colle a son extreme est le seul
           moment ou cette carte doit sauter aux yeux. */
        { k: 'bord', lbl: 'Alerte pres d\'un extrême (%)', type: 'nombre', def: 10, min: 1, max: 25 },
      ],
      mount: function (host, it) {
        var W = this, vivant = true, cache = {};
        skel(host, 4);

        function bloc(titre, b, etat, sym, bord) {
          var pip = _pipTaille(sym), unite = _uniteAmpl(sym);
          var etendue = pip ? (b.h - b.l) / pip : (b.h - b.l);
          var pos = (b.h > b.l) ? (b.c - b.l) / (b.h - b.l) * 100 : 50;
          /* Un cours colle a son extreme est le seul moment ou cette carte doit sauter aux yeux.
             Au-dela du seuil, la borne concernee et le curseur s allument. */
          var pres = (pos >= 100 - bord) ? 'haut' : (pos <= bord) ? 'bas' : '';
          var dec = /JPY/.test(sym) ? 3 : (pip ? 5 : 2);
          return '<div class="wdg-hb-bloc">'
            + '<div class="wdg-hb-t"><span>' + esc(titre) + '</span><i>' + esc(etat) + '</i></div>'
            + '<div class="wdg-hb-vals"><span class="wdg-hb-bas">' + b.l.toFixed(dec) + '</span>'
            + '<span class="wdg-hb-amp">' + etendue.toFixed(pip ? 0 : 2) + ' ' + unite + '</span>'
            + '<span class="wdg-hb-haut">' + b.h.toFixed(dec) + '</span></div>'
            + '<div class="wdg-hb-piste' + (pres ? ' est-pres-' + pres : '') + '"><span class="wdg-hb-cur" style="left:' + Math.max(0, Math.min(100, pos)).toFixed(1) + '%"></span></div>'
            + '</div>';
        }

        function dessiner() {
          var sym = opt(it, W, 'paire') || 'EUR/USD';
          Promise.all([_bougies(sym, 'D1', cache), _bougies(sym, 'W1', cache)]).then(function (r) {
            if (!vivant || !host.isConnected) return;
            var j = r[0], sem = r[1];
            if (!j.length && !sem.length) { fallback(host, 'Bougies indisponibles.'); return; }
            var bord = opt(it, W, 'bord') || 10;
            var h = '<div class="wdg-hb">';
            if (j.length) {
              var dj = j[j.length - 1];
              var jourEnCours = _memeJourUTC(dj.t);
              h += bloc('Séance', dj, jourEnCours ? 'en cours' : _dateBougie(dj.t) + ', close', sym, bord);
            }
            if (sem.length) {
              var ds = sem[sem.length - 1];
              var semEnCours = _memeSemaineUTC(ds.t);
              // Semaine a peine ouverte : la reglette porterait sur quelques minutes. On montre
              // la semaine PRECEDENTE, complete, et on l annonce.
              var ageMs = Date.now() - ds.t;
              var tropJeune = semEnCours && ageMs < 0.1 * 7 * 86400000 && sem.length > 1;
              var cible = tropJeune ? sem[sem.length - 2] : ds;
              var etat = tropJeune ? 'semaine précédente, la nouvelle vient de s\'ouvrir'
                : (semEnCours ? 'en cours' : 'dernière semaine close');
              h += bloc('Semaine', cible, etat, sym, bord);
            }
            h += '<div class="wdg-hb-pied">Le curseur situe le dernier cours entre le bas et le haut de la période.</div></div>';
            host.innerHTML = h;
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Bougies indisponibles.'); });
        }
        dessiner();
        var stop = _rafraichirBougies(host, dessiner);
        return function () { vivant = false; stop(); };
      },
    },
    {
      id: 'evenement-rebours', name: 'Compte à rebours', tag: 'CALENDRIER', cat: 'Macro', h: 186,
      desc: 'Le prochain chiffre macro attendu, isolé, avec le temps qui reste, puis le réel contre le consensus.',
      aide: "<p>La prochaine publication macro, isolée : compte à rebours à la seconde, importance, prévision et précédent, puis, à l'heure dite, le chiffre réel confronté à la prévision ; la carte reste 20 minutes sur l'événement publié pour montrer ce verdict. Un « (révisé) » signale que le précédent a été corrigé au passage.</p><p>C'est la <strong>surprise</strong> qui déplace un marché, pas le niveau : la carte existe pour la minute où le réel tombe. Plusieurs publications à la même heure sont signalées (« +N autres ») : leurs effets peuvent se contrarier, ce qui rend la première réaction moins fiable.</p>",
      src: "Le calendrier économique du desk, relu toutes les 60 secondes (le décompte, lui, vit à la seconde) ; l'heure vient de l'horodatage universel de l'événement, jamais d'un fuseau figé.",
      watch: "L'écart entre le réel et la prévision à l'instant de la publication, et une révision du précédent : elle change parfois la lecture autant que le chiffre du jour.",
      /* Une carte a UNE seule information : c est ce qui la separe du widget Calendrier, qui est
         une table. Le decompte ne se calcule QUE depuis timestamp (ms epoch UTC) : le champ `time`
         de la source est fige a l heure de Paris et mentirait a un lecteur d un autre fuseau.
         ⚠️ CORRECTIF EXIGE PAR LA CONTRE-VERIFICATION : on passe null en 3e argument de
         calActualCell. Ce parametre est la borne basse, et elle declenche un eclair « sorti sous
         l estimation basse ». Or low/high ne sont PAS un consensus d analystes : c est une
         estimation IA, ou un calcul maison (prevision ± 0,7 x |prevision - precedent|). Afficher
         cet eclair reviendrait a inventer une fourchette. Le desk fait deja ce choix ailleurs.
         ⚠️ FENETRE DE PUBLICATION (refonte 23/08) : a l heure H, la carte ne saute PLUS a
         l evenement suivant — elle RESTE 20 minutes sur l evenement publie et va CHERCHER son
         reel dans la reponse (avant, `ev` capture futur n etait jamais rafraichi : la branche du
         reel etait morte, le moment le plus utile du widget passait a la trappe). Identite de
         correspondance : _rbMemeEvenement, titre brut + devise + PAYS + minute. */
      opts: [
        { k: 'devise', lbl: 'Devise', type: 'choix', def: 'all',
          // Les 9 devises REELLEMENT servies par la source. Aucune n est inventee.
          choix: [['all', 'Toutes'], ['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['JPY', 'JPY'],
            ['AUD', 'AUD'], ['NZD', 'NZD'], ['CAD', 'CAD'], ['CHF', 'CHF'], ['CNY', 'CNY']] },
        { k: 'impact', lbl: 'Impact', type: 'choix', def: 'all',
          choix: [['all', 'Tous'], ['High', 'Fort seulement']] },
        { k: 'chiffres', lbl: 'Afficher prévision et précédent', type: 'bascule', def: true },
      ],
      mount: function (host, it) {
        var W = this, vivant = true, ev = null, autres = 0, suivant = null;
        /* 20 min : assez pour lire le chiffre et son eventuelle revision, assez court pour que la
           carte redevienne un compte a rebours avant la publication suivante d une meme matinee. */
        var HOLD = 20 * 60 * 1000;
        var dernierFetch = 0;        // heure du dernier fetch reussi : la reponse n a pas d updatedAt
        var evPrevInitial = null;    // « Précédent » memorise a la selection → detecte la revision
        var evRevise = false;
        var chronoCle = null;        // dernier etat rendu du chrono : tic() n ecrit que ce qui change
        var eTete, eChr, eTit, eVerdW, eVerd, ePied, eSuiv;

        function deuxCh(n) { return (n < 10 ? '0' : '') + n; }
        function enFenetre() { return !!ev && Date.now() >= ev.timestamp && Date.now() < ev.timestamp + HOLD; }

        /* Le squelette se (re)construit aussi APRES un fallback : avant, une seule erreur laissait
           la carte en erreur POUR TOUJOURS — les rendus suivants ecrivaient dans des references
           DOM detachees, en silence. */
        function batir() {
          host.innerHTML = '<div class="wdg-rb">'
            + '<div class="wdg-rb-tete"></div>'
            + '<div class="wdg-rb-chrono wdg-maj-txt">--</div>'
            + '<div class="wdg-rb-titre wdg-maj-txt"></div>'
            + '<div class="wdg-verdict" style="display:none"><b class="wdg-verdict-txt wdg-maj-txt"></b></div>'
            + '<div class="wdg-rb-pied"></div>'
            + '<div class="wdg-rb-suivant" style="display:none"></div></div>';
          eTete = host.querySelector('.wdg-rb-tete');
          eChr = host.querySelector('.wdg-rb-chrono');
          eTit = host.querySelector('.wdg-rb-titre');
          eVerdW = host.querySelector('.wdg-verdict');
          eVerd = host.querySelector('.wdg-verdict-txt');
          ePied = host.querySelector('.wdg-rb-pied');
          eSuiv = host.querySelector('.wdg-rb-suivant');
          chronoCle = null;
        }
        batir();

        function choisir(items) {
          var dev = opt(it, W, 'devise'), imp = opt(it, W, 'impact');
          var maintenant = Date.now();
          var futurs = (items || []).filter(function (e) {
            if (!e || !e.timestamp || e.timestamp <= maintenant) return false;
            if (dev && dev !== 'all' && e.currency !== dev) return false;
            if (imp === 'High' && e.impact !== 'High') return false;
            return true;
          });
          if (!futurs.length) { suivant = null; return null; }
          // Depart d egalite EXPLICITE : a la meme seconde, le Fort passe devant le Moyen.
          futurs.sort(function (a, b) {
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            var ra = a.impact === 'High' ? 0 : 1, rb = b.impact === 'High' ? 0 : 1;
            return ra - rb;
          });
          var premier = futurs[0];
          // Combien d autres publications tombent a la MEME heure : information reelle, tiree du
          // meme tableau, utile au trader (une seconde ou trois chiffres sortent ensemble).
          autres = futurs.filter(function (e) { return e.timestamp === premier.timestamp; }).length - 1;
          /* « Ensuite » : le premier evenement STRICTEMENT apres l heure du courant — ceux de la
             meme seconde sont deja comptes dans « +N autres » (les repeter en « Ensuite »
             annoncerait comme suivant ce qui tombe en meme temps). */
          suivant = null;
          for (var i = 0; i < futurs.length; i++) {
            if (futurs[i].timestamp > premier.timestamp) { suivant = futurs[i]; break; }
          }
          return premier;
        }

        function rendreTete() {
          if (!ev || !eTete || !eTete.isConnected) return;
          var h = '';
          try { h += CAL_FLAG(ev.currency); } catch (e) {}
          h += '<span class="wdg-rb-dev">' + esc(ev.currency || '') + '</span>';
          try { h += '<span class="wdg-rb-imp">' + calImpDots(ev.impact) + '</span>'; } catch (e) {}
          var hh = '';
          try { hh = calFormatTime(ev.timestamp); } catch (e) {}
          // L heure passe or une fois atteinte (present marque), le tic entretient la classe.
          h += '<span class="wdg-rb-h' + (Date.now() >= ev.timestamp ? ' est-publie' : '') + '">' + esc(hh) + '</span>';
          // Heure du FETCH (grammaire commune) : le chrono prouve que la carte tourne, pas que la
          // donnee est fraiche — c est ce span qui le dit.
          h += _vieSpan(dernierFetch);
          eTete.innerHTML = h;
          eTit.innerHTML = '<span class="wdg-rb-nom">' + esc(ev.title || '') + '</span>'
            + (autres > 0 ? '<span class="wdg-rb-autres">+' + autres + ' autre' + (autres > 1 ? 's' : '') + ' publication' + (autres > 1 ? 's' : '') + ' à cette heure</span>' : '');
          var s = '';
          if (suivant) {
            var quand = '';
            try {
              var dn = new Date(suivant.timestamp), mnt = new Date();
              var memeJour = dn.getFullYear() === mnt.getFullYear() && dn.getMonth() === mnt.getMonth() && dn.getDate() === mnt.getDate();
              // Un suivant un autre jour porte sa date : « 14:30 » nu aurait promis aujourd hui.
              quand = (memeJour ? '' : dn.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ') + calFormatTime(suivant.timestamp);
            } catch (e) {}
            s = 'Ensuite : ' + (suivant.currency || '') + ' · ' + (suivant.title || '') + (quand ? ' · ' + quand : '');
          }
          if (eSuiv) { eSuiv.textContent = s; eSuiv.style.display = s ? '' : 'none'; }
        }

        function rendrePied() {
          if (!ePied || !ePied.isConnected || !ev) return;
          if (opt(it, W, 'chiffres') === false) { ePied.innerHTML = ''; return; }
          /* « (révisé) » : la source a change la valeur precedente au moment de la publication —
             information reelle tiree du meme payload, on la NOMME au lieu de la glisser. */
          var h = '<span><i>Prévision</i><b>' + esc(ev.forecast || '-') + '</b></span>'
            + '<span><i>Précédent' + (evRevise ? ' (révisé)' : '') + '</i><b>' + esc(ev.previous || '-') + '</b></span>';
          if (ev.actual && Date.now() >= ev.timestamp) {
            var v = _rbVerdict(ev);
            h += '<span><i>Réel</i><b' + (v && v.cls ? ' class="' + v.cls + '"' : '') + '>' + esc(String(ev.actual)) + '</b></span>';
          }
          ePied.innerHTML = h;
        }

        function majVerdict(fondu) {
          if (!eVerd || !eVerd.isConnected || !ev) return;
          var html = '', cls = '';
          if (Date.now() >= ev.timestamp && ev.actual) {
            var v = _rbVerdict(ev);
            if (v) { html = v.txt; cls = v.cls; }
          } else if (opt(it, W, 'chiffres') !== false) {
            /* La ligne d attente reprend prevision et precedent : elle suit donc la bascule
               « Afficher prévision et précédent ». Le verdict de PUBLICATION, lui, s affiche
               toujours : c est LE moment pour lequel la carte existe. */
            html = _rbAttente(ev);
          }
          eVerd.className = 'wdg-verdict-txt wdg-maj-txt' + (cls ? ' ' + cls : '');
          eVerd.innerHTML = html;
          if (eVerdW) eVerdW.style.display = html ? '' : 'none';
          if (fondu && html) _majFlash(eVerd);
        }

        function tic() {
          if (!ev || !host.isConnected || !eChr || !eChr.isConnected) return;
          var reste = ev.timestamp - Date.now();
          var eH = eTete ? eTete.querySelector('.wdg-rb-h') : null;
          if (reste > 0) {
            var sec = Math.floor(reste / 1000);
            var j = Math.floor(sec / 86400); sec -= j * 86400;
            var hr = Math.floor(sec / 3600); sec -= hr * 3600;
            var mn = Math.floor(sec / 60); sec -= mn * 60;
            var t = (j > 0 ? j + ' j ' : '') + deuxCh(hr) + ':' + deuxCh(mn) + ':' + deuxCh(sec);
            if (t !== chronoCle) { eChr.textContent = t; chronoCle = t; }
            eChr.classList.remove('est-publie');
            if (eH) eH.classList.remove('est-publie');
            return;
          }
          // APRES L HEURE : on ne remet pas un compte a rebours a zero, et AUCUNE promesse de
          // delai : le chiffre arrive quand la source le publie, pas avant.
          eChr.classList.add('est-publie');
          if (eH) eH.classList.add('est-publie');
          var cle = 'p|' + String(ev.actual || '');
          if (cle === chronoCle) return;
          chronoCle = cle;
          if (ev.actual) {
            try {
              // 3e argument a null : pas de borne basse, donc pas d eclair sur une fourchette
              // qui n existe pas. C est LE correctif historique de ce widget, conserve.
              eChr.innerHTML = calActualCell(ev.actual, ev.forecast, null, ev.title);
            } catch (e) { eChr.textContent = ev.actual; }
          } else {
            eChr.textContent = 'Publié, chiffre non encore diffusé';
          }
          /* L instant de la bascule (heure atteinte, puis arrivee du reel) : fondu UNE FOIS de la
             grammaire commune — la contre-lecture a remplace le keyframe « est-nouveau » de la
             spec par ce mecanisme partage. Jamais de boucle, jamais de clignotement. */
          _majFlash(eChr);
          rendrePied();
          majVerdict(true);
        }

        function charger() {
          fetch('/api/calendar-events').then(function (r) {
            if (!r.ok) throw new Error('http');
            return r.json();
          }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            dernierFetch = Date.now();
            var items = (d && d.items) || [];
            if (!host.querySelector('.wdg-rb')) batir();   // reprise apres fallback
            if (enFenetre()) {
              /* FENETRE DE PUBLICATION : on RESTE sur l evenement et on va CHERCHER son reel dans
                 la reponse. Identite stricte _rbMemeEvenement (titre brut + devise + PAYS +
                 minute) : sans le pays, on peut accrocher l actual d un AUTRE pays a la meme
                 minute (chomages de la zone euro). Le fallback ne s applique JAMAIS ici :
                 remplacer la carte pendant qu un chiffre vient de tomber effacerait le seul
                 moment pour lequel elle existe. */
              var pub = null;
              for (var i = 0; i < items.length; i++) {
                if (items[i] && items[i].actual && _rbMemeEvenement(items[i], ev)) { pub = items[i]; break; }
              }
              if (pub) {
                if (evPrevInitial != null && pub.previous && String(pub.previous) !== String(evPrevInitial)) evRevise = true;
                var avait = String(ev.actual || '');
                ev = Object.assign({}, ev, {
                  actual: pub.actual || ev.actual || '',
                  forecast: pub.forecast || ev.forecast || '',
                  previous: pub.previous || ev.previous || '',
                });
                if (String(ev.actual || '') !== avait) chronoCle = null;   // le tic re-rend le reel (et fond)
              }
              rendreTete(); rendrePied(); tic();
              return;
            }
            var avant = ev;
            var prochain = choisir(items);
            if (!prochain) {
              ev = null; chronoCle = null;
              fallback(host, 'Aucun événement programmé sur les dix prochains jours.');
              return;
            }
            var change = !avant || !_rbMemeEvenement(prochain, avant);
            ev = prochain;
            if (change) {
              evPrevInitial = ev.previous == null ? '' : String(ev.previous);
              evRevise = false; chronoCle = null;
            }
            rendreTete(); rendrePied(); majVerdict(false); tic();
            // Passage a l evenement suivant : fondu une-fois sur le chrono et le titre.
            if (change && avant) { _majFlash(eChr); _majFlash(eTit); }
          }).catch(function () {
            /* Une erreur reseau n efface NI un compte a rebours encore exact NI un chiffre qui
               vient d etre publie : le fallback n intervient que si la carte n a rien a montrer. */
            if (vivant && host.isConnected && !ev) fallback(host, 'Calendrier indisponible.');
          });
        }

        charger();
        // Deux minuteurs distincts : la seconde pour l affichage, la minute pour la donnee (le
        // serveur cache 4 min, sonder plus vite ne relirait que le meme cache).
        var ivT = setInterval(tic, 1000);
        var ivD = setInterval(charger, 60000);
        return function () { vivant = false; try { clearInterval(ivT); clearInterval(ivD); } catch (e) {} };
      },
    },

    {
      id: 'serie-indicateur', name: 'Série d\'un indicateur',
      tag: 'MACRO', cat: 'Macro', h: 300,
      desc: 'Les dernières publications d\'un indicateur, en barres, avec la surprise contre la prévision.',
      aide: "<p>Les dernières publications d'un même indicateur, en barres : vert quand la valeur monte sur la précédente, rouge quand elle baisse, le liseré or marquant la plus récente. La ligne du bas résume la dynamique, et le pied annonce la prochaine publication avec sa prévision.</p><p>Une publication isolée se lit mal : deux ou trois points dans le même sens font une <strong>dynamique</strong>, et c'est elle que les banques centrales disent suivre. Attention au sens : une hausse n'est pas une bonne nouvelle en soi (chômage, inflation), le vert ne dit que la direction.</p>",
      src: "Historique reconstruit depuis le calendrier économique du desk (titre et pays servent de clé), relu toutes les 5 minutes ; si l'unité change d'une publication à l'autre, la carte liste les valeurs plutôt que de dessiner un graphe faux.",
      watch: "L'enchaînement de plusieurs publications dans le même sens, et l'écart de la dernière au consensus : c'est la combinaison des deux qui pèse sur les anticipations de taux.",
      /* ⚠️ LA SOURCE N EST PAS CELLE QU ON CROIT. /api/event-history existe, mais il compare les
         titres BRUTS alors que /api/calendar-events sert des titres RENOMMES : la reponse revient
         vide EN SILENCE pour tout indicateur renomme (le desk lui-meme a ce defaut). On construit
         donc la serie depuis /api/calendar-events, qui republie l historique par titre (champ _h
         redeploye en evenements synthetiques) AVEC le pays — ce que l autre route ne permet pas.
         ⚠️ GARDE D UNITE : les valeurs sont des CHAINES deja formatees ('3.2%', '122K', '-8.0M').
         Si deux suffixes differents cohabitent dans une serie, on ne dessine PAS de barres : une
         barre qui compare des K a des % est un graphique faux. On liste alors les valeurs.
         ⚠️ PLUS DE CHAMP `maj` (refonte 23/08) : _majAuto REMONTAIT toute la carte toutes les
         5 minutes — squelette rejoue, <select> detruit, focus perdu : l impression d un widget
         casse. La cadence vit desormais ICI (setInterval interne nettoye au demontage, qui
         conserve aussi le reessai d un premier chargement en echec — la raison d etre de
         _majAuto), et le rendu est IDEMPOTENT : rien de neuf, rien de touche. */
      opts: [
        { k: 'devise', lbl: 'Devise', type: 'choix', def: 'USD',
          choix: [['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['JPY', 'JPY'],
            ['AUD', 'AUD'], ['NZD', 'NZD'], ['CAD', 'CAD'], ['CHF', 'CHF'], ['CNY', 'CNY']] },
        { k: 'indic', lbl: 'Indicateur', type: 'texte', def: '', cache: true },
        /* Sur une carte etroite, une serie hebdomadaire rend treize etiquettes illisibles.
           Plafond a 12 : c est ce que la source sait reellement fournir. Promettre 24 barres
           serait un reglage qui ne se remplit jamais. */
        { k: 'points', lbl: 'Publications affichées', type: 'nombre', def: 8, min: 3, max: 12 },
      ],
      mount: function (host, it) {
        var W = this, vivant = true;
        var dernierFetch = 0;
        var prevSig = null;   // signature du dernier rendu : null = rien de fiable a l ecran
        skel(host, 5);

        function rendre(serie, titre, suivant) {
          var unites = {};
          serie.forEach(function (p) { unites[_uniteVal(p.actual)] = 1; });
          var melange = Object.keys(unites).length > 1;
          var vals = serie.map(function (p) { return _nombreVal(p.actual); });
          var dates = serie.map(function (p) {
            try { return new Date(p.timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }); } catch (e) { return ''; }
          });
          var etendue = '';
          try {
            etendue = serie.length + ' publication' + (serie.length > 1 ? 's' : '') + ' \u00b7 '
              + new Date(serie[0].timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
              + ' \u2192 ' + new Date(serie[serie.length - 1].timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
          } catch (e) {}

          var corps;
          if (melange) {
            // Unites melangees : on RENONCE au graphe et on montre les chiffres. Un chiffre juste
            // vaut mieux qu une barre fausse.
            corps = '<div class="wdg-si-liste">' + serie.map(function (p, i) {
              return '<div class="wdg-si-l"><span>' + esc(dates[i]) + '</span><b>' + esc(p.actual || '-') + '</b></div>';
            }).join('') + '</div><div class="wdg-si-note">L\'unité change d\'une publication à l\'autre : les valeurs sont listées telles que la source les donne, sans graphe.</div>';
          } else {
            // Le vert/rouge dit le SENS par rapport a la publication precedente, rien d autre :
            // une hausse n est pas une bonne nouvelle en soi (chomage, inflation). C est dit en pied.
            var sens = vals.map(function (v, i) {
              if (i === 0 || typeof vals[i - 1] !== 'number') return 'var(--orange, #e3b23a)';
              if (v > vals[i - 1]) return '#00e676';
              if (v < vals[i - 1]) return '#ff3d00';
              return 'var(--orange, #e3b23a)';
            });
            /* Le PRESENT est marque PAR INDEX via l option `marque` de _barresSvg (vague 3) : le
               lisere or suit la DERNIERE PUBLICATION meme quand des valeurs non finies trouent la
               serie — un selecteur CSS rect:last-of-type aurait marque la derniere barre
               DESSINEE, pas la derniere publication (contre-lecture). Si la derniere valeur ne se
               lit pas, le helper ne dessine rien a cet index : pas de lisere menteur. */
            corps = '<div class="wdg-si-zone wdg-maj-txt">' + _barresSvg(vals, { signe: false, zero: false, largeurMax: 46, couleurs: sens, marque: vals.length - 1 }) + '</div>'
              + '<div class="wdg-si-axe">' + dates.map(function (dd, i) {
                return '<span><i>' + esc(serie[i].actual || '') + '</i><em>' + esc(dd) + '</em></span>';
              }).join('') + '</div>';
          }

          /* Verdict (grammaire commune, EN BAS avant le pied). En mode liste, tendance et extreme
             compareraient des K a des % : seule la surprise — interne a UNE publication — reste. */
          var v = _siVerdict(serie, titre, melange);

          // La prochaine publication du MEME indicateur : la carte regarde aussi devant.
          var nextTxt = '';
          if (suivant && suivant.timestamp) {
            try {
              var dn = new Date(suivant.timestamp);
              nextTxt = '<span class="wdg-si-next">prochaine : '
                + esc(dn.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }))
                + ' ' + esc(dn.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
                + (suivant.forecast ? ', prév. ' + esc(String(suivant.forecast)) : '') + '</span>';
            } catch (e) {}
          }

          host.innerHTML = '<div class="wdg-si">'
            + '<div class="wdg-si-tete"><span class="wdg-si-titre">' + esc(titre) + '</span></div>'
            + corps
            + (v ? '<div class="wdg-verdict"><b class="wdg-verdict-txt wdg-maj-txt">' + v.txt + '</b></div>' : '')
            + '<div class="wdg-si-pied">' + esc(etendue)
            + (melange ? '' : ' · vert = en hausse sur la publication précédente, rouge = en baisse')
            + (nextTxt ? ' · ' + nextTxt : '')
            + ' ' + _vieSpan(dernierFetch)
            + '</div></div>';
        }

        function charger() {
          var dev = opt(it, W, 'devise') || 'USD';
          var choisi = opt(it, W, 'indic') || '';
          fetch('/api/calendar-events').then(function (r) {
            if (!r.ok) throw new Error('http');
            return r.json();
          }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            dernierFetch = Date.now();
            var items = (d && d.items) || [];
            var maintenant = Date.now();
            /* Cle d identite : titre BRUT + PAYS — meme regle que la cle serveur (_calHistKey) et
               que le compte a rebours. « EUR|unemployment rate » fusionnait les chomages
               allemand, espagnol, italien et zone euro en UNE serie aux valeurs incomparables
               (3,4 % allemand contre 12 % espagnol : des « variations » qui n existent pas).
               Le pays en SUFFIXE OPTIONNEL : les choix memorises avant cette cle (sans pays)
               restent valides pour tous les indicateurs sans pays. */
            function cleDe(e) { var c = String((e && e.ctry) || ''); return ((e && (e._tvTitle || e.title)) || '') + (c ? '||' + c : ''); }
            // Publications PASSEES de la devise, qui portent un chiffre.
            var passes = items.filter(function (e) {
              return e && e.currency === dev && e.actual && String(e.actual).trim() && e.timestamp && e.timestamp <= maintenant;
            });
            if (!passes.length) { prevSig = null; fallback(host, 'Aucune publication chiffrée pour ' + dev + '.'); return; }
            // Regroupement par cle (titre brut + pays) : le libelle affiche peut avoir ete
            // renomme, deux cles differentes pouvant porter le meme libelle.
            var parTitre = {};
            passes.forEach(function (e) {
              var k = cleDe(e);
              (parTitre[k] = parTitre[k] || { titre: e.title || e._tvTitle || '', ctry: String(e.ctry || ''), pts: [] }).pts.push(e);
            });
            var titres = Object.keys(parTitre).sort(function (a, b) {
              var la = Math.max.apply(null, parTitre[a].pts.map(function (x) { return x.timestamp; }));
              var lb = Math.max.apply(null, parTitre[b].pts.map(function (x) { return x.timestamp; }));
              return lb - la;
            });
            var brut = (choisi && parTitre[choisi]) ? choisi : titres[0];
            var g = parTitre[brut];
            var serie = g.pts.slice().sort(function (a, b) { return a.timestamp - b.timestamp; });
            if (serie.length < 2) { prevSig = null; fallback(host, 'Une seule publication connue : pas de série à tracer.'); return; }
            // Sur une carte etroite, treize etiquettes s ecrasent : on garde les N plus RECENTES.
            var nPts = opt(it, W, 'points') || 8;
            if (serie.length > nPts) serie = serie.slice(-nPts);
            // Prochaine publication du MEME indicateur (meme cle) : premier item futur du payload.
            var suivant = null;
            items.forEach(function (e) {
              if (!e || e.currency !== dev || !e.timestamp || e.timestamp <= maintenant) return;
              if (cleDe(e) !== brut) return;
              if (!suivant || e.timestamp < suivant.timestamp) suivant = e;
            });

            /* IDEMPOTENCE : rien de neuf → on ne touche pas au DOM (c est ce qui preserve le
               <select> et son focus entre deux cycles) ; seul l horodatage est retimbre a l heure
               de CE fetch — la fraicheur affichee est celle de la lecture, pas du dernier rendu. */
            var sig = brut + '::' + serie.map(function (p) { return p.timestamp + '|' + p.actual; }).join(';')
              + '::' + (suivant ? (suivant.timestamp + '|' + (suivant.forecast || '')) : '');
            if (sig === prevSig && host.querySelector('.wdg-si')) {
              var vie = host.querySelector('.wdg-si .wdg-vie');
              if (vie) { vie.setAttribute('data-ts', String(dernierFetch)); vie.textContent = _vie(dernierFetch); }
              return;
            }
            var etaitRendu = prevSig != null && !!host.querySelector('.wdg-si');
            prevSig = sig;
            rendre(serie, g.titre, suivant);
            // Selecteur DANS la carte : la liste depend des donnees, elle ne peut pas vivre dans
            // les opts statiques du catalogue. Libelles homonymes (meme indicateur publie par
            // plusieurs pays de la zone euro) desambiguises par l abreviation FR du pays.
            var tete = host.querySelector('.wdg-si-tete');
            if (tete) {
              var nbParLibelle = {};
              titres.forEach(function (t) { var lb = parTitre[t].titre; nbParLibelle[lb] = (nbParLibelle[lb] || 0) + 1; });
              var sel = document.createElement('select');
              sel.className = 'wdg-si-sel';
              titres.slice(0, 40).forEach(function (t) {
                var o = document.createElement('option');
                var g2 = parTitre[t];
                o.value = t;
                o.textContent = g2.titre + (nbParLibelle[g2.titre] > 1 && g2.ctry ? ' (' + (_CTRY_ABR[g2.ctry] || g2.ctry) + ')' : '');
                if (t === brut) o.selected = true;
                sel.appendChild(o);
              });
              // Signature reelle : _ecrisOpt(host, it, cle, valeur) — memorise le choix sans
              // reconstruire la carte, comme le fait deja le widget Graphique pour sa paire.
              sel.addEventListener('change', function () { _ecrisOpt(host, it, 'indic', sel.value); charger(); });
              tete.appendChild(sel);
            }
            /* Nouveau point (ou revision) sur une carte deja rendue : fondu une-fois de la
               grammaire commune — jamais de squelette rejoue, jamais de clignotement. */
            if (etaitRendu) {
              _majFlash(host.querySelector('.wdg-si-zone'));
              _majFlash(host.querySelector('.wdg-verdict-txt'));
            }
          }).catch(function () { if (vivant && host.isConnected) { prevSig = null; fallback(host, 'Historique indisponible.'); } });
        }

        charger();
        /* Cadence 5 min EN INTERNE (une publication peut tomber pendant que la carte est
           ouverte), avec la garde de visibilite de _majAuto qu elle remplace : onglet cache =
           pas d appel. Nettoyee au demontage — condition posee par la contre-lecture. */
        var iv = setInterval(function () { if (!document.hidden && host.isConnected) charger(); }, 5 * 60 * 1000);
        return function () { vivant = false; try { clearInterval(iv); } catch (e) {} };
      },
    },
    {
      id: 'bandeau-ticker', name: 'Bandeau de cotations', tag: 'COTATIONS', cat: 'Marchés', h: 64,
      desc: 'Les dix repères du desk en bande fine défilante.',
      aide: "<p>Dix repères transverses (FX, indices, or, pétrole, taux 10 ans, bitcoin) en bande défilante : vert en hausse, rouge en baisse, et la pastille fixe nomme la plus forte variation du moment. Le 10 ans américain s'exprime en points d'écart, pas en pourcentage.</p><p>Ce bandeau sert de <strong>vérification croisée</strong> : un mouvement FX cohérent avec les indices, l'or et les taux est un mouvement de régime ; un mouvement isolé est une histoire locale. C'est ce recoupement, plus que chaque chiffre, qui fait l'intérêt de la bande.</p>",
      src: "Dix actifs à liste fixe servis par le desk et relus toutes les 60 secondes, au pas du cache serveur ; cours et variations sont réécrits sans jamais faire sauter le défilement.",
      watch: "La pastille de tête quand elle change de titulaire, et les moments où actions, or et taux bougent ensemble : c'est la signature d'une bascule risque-on / risque-off.",
      /* Source : /api/ticker, liste FIGEE de 10 actifs cote serveur. On n offre donc AUCUN champ
         « ajouter un actif » : la source ne saurait pas le chercher.
         ⚠️ PIEGE MESURE : items[].chg est un POURCENTAGE, SAUF si items[].yield est vrai (le 10 ans
         US), ou c est un ecart en POINTS. Afficher « % » sur le 10 ans serait un chiffre faux. */
      opts: [
        { k: 'actifs', lbl: 'Actifs', type: 'multi',
          def: ['EUR/USD', 'USD/JPY', 'GBP/USD', 'XAU/USD', 'S&P 500', 'NASDAQ', 'DXY', 'WTI', 'BTC/USD', 'US 10Y'],
          choix: [['EUR/USD', 'EUR/USD'], ['USD/JPY', 'USD/JPY'], ['GBP/USD', 'GBP/USD'], ['XAU/USD', 'XAU/USD'],
            ['S&P 500', 'S&P 500'], ['NASDAQ', 'NASDAQ'], ['DXY', 'DXY'], ['WTI', 'WTI'], ['BTC/USD', 'BTC/USD'], ['US 10Y', 'US 10Y']] },
        { k: 'vitesse', lbl: 'Vitesse', type: 'choix', def: 'normal',
          choix: [['lent', 'Lente'], ['normal', 'Normale'], ['rapide', 'Rapide']] },
        { k: 'var', lbl: 'Afficher la variation', type: 'bascule', def: true },
        /* Symetrique de la bascule ci-dessus. Decoche, chaque segment se reduit a l etiquette et
           a la variation : sur une carte etroite, deux fois plus d actifs par tour. */
        { k: 'cours', lbl: 'Afficher le cours', type: 'bascule', def: true },
      ],
      mount: function (host, it) {
        var W = this, vivant = true;
        var PX = { lent: 35, normal: 55, rapide: 85 };
        /* Mémoire du DIFF (23/08, fin du SAUT de bande) : reconstruire la piste toutes les 60 s
           PUIS recalculer --wdg-tick-dur repositionnait l'animation CSS en cours — le seul widget
           animé du lot se recomposait brutalement chaque minute. À sélection et réglages
           constants, on ne touche plus NI à la piste NI à la durée : cours et variation sont
           réécrits DANS les segments (les DEUX copies de la boucle), l'animation ne repart
           jamais. La dérive de largeur quand le NOMBRE de chiffres d'un cours change est réelle
           mais marginale (tabular-nums) : on l'assume, c'est le prix du défilement continu. */
        var prevStruct = null, prevVals = null, prevTete = null;

        // ⚠️ Number(null) vaut 0 : sans les gardes `== null`, un cours ou une variation ABSENTS
        // s'afficheraient « 0 » et entreraient dans la pastille comme des zéros connus (banc).
        function prixTxt(x) {
          var pv = x.price == null ? NaN : Number(x.price);
          return isFinite(pv) ? pv.toFixed(Number(x.dec) || 0) : '--';
        }
        function chgTxt(x) {
          var y = !!x.yield;
          var v = x.chg == null ? NaN : Number(x.chg);
          return (v > 0 ? '+' : '') + (isFinite(v) ? v.toFixed(2).replace('.', ',') : '--') + (y ? ' pt' : '%');
        }
        function seg(x, avecVar, avecCours) {
          var v = x.chg == null ? NaN : Number(x.chg);
          var cls = v > 0 ? ' est-haut' : v < 0 ? ' est-bas' : '';
          return '<span class="wdg-tick-seg wdg-maj-surf' + cls + '" data-label="' + esc(x.label) + '">'
            + '<b>' + esc(x.label) + '</b>'
            + (avecCours ? '<i>' + prixTxt(x) + '</i>' : '')
            + (avecVar ? '<u>' + chgTxt(x) + '</u>' : '') + '</span>';
        }

        function dessiner() {
          fetch('/api/ticker').then(function (r) { return r.json(); }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            var choisis = opt(it, W, 'actifs') || [];
            var items = (d && d.items || []).filter(function (x) {
              return x && x.label && (!choisis.length || choisis.indexOf(x.label) >= 0);
            });
            // Le serveur rend { items: [] } en cas de panne : une bande vide qui tourne serait pire
            // qu un message honnete.
            if (!items.length) { fallback(host, 'Cotations indisponibles.'); prevStruct = null; return; }
            var avecVar = opt(it, W, 'var') !== false;
            var avecCours = opt(it, W, 'cours') !== false;
            var vit = opt(it, W, 'vitesse') || 'normal';
            // /api/ticker sert updatedAt en MILLISECONDES (vérifié serveur) — enfin exploité.
            var ts = (typeof d.updatedAt === 'number' ? d.updatedAt : Date.parse(d.updatedAt || '')) || Date.now();

            /* ── PASTILLE MENEUSE : plus forte |variation| parmi les actifs COMPARABLES. Le
               10 ans US est en POINTS, pas en % (piège documenté en tête de widget) : il est
               exclu de la comparaison dès qu'il n'est pas seul — et une sélection 100 %
               rendement n'a pas de pastille (comparer est impossible, silence honnête). */
            var top = null;
            items.forEach(function (x) {
              if (x.yield) return;
              var v = x.chg == null ? NaN : Number(x.chg);
              if (!isFinite(v)) return;
              if (!top || Math.abs(v) > Math.abs(Number(top.chg))) top = x;
            });

            var struct = items.map(function (x) { return x.label; }).join('\u0001')
              + '|' + (avecVar ? 1 : 0) + (avecCours ? 1 : 0) + '|' + vit + '|' + (top ? 1 : 0);

            var racine = host.querySelector('.wdg-tick');
            var piste = racine ? racine.querySelector('.wdg-tick-piste') : null;
            if (racine && piste && prevStruct === struct) {
              /* ── DIFF : réécriture en place, l'animation ne bouge pas d'un pixel. */
              items.forEach(function (x) {
                var v = x.chg == null ? NaN : Number(x.chg);
                var sig = String(x.price) + '|' + String(x.chg);
                piste.querySelectorAll('.wdg-tick-seg[data-label="' + x.label + '"]').forEach(function (el) {
                  el.classList.toggle('est-haut', v > 0);
                  el.classList.toggle('est-bas', v < 0);
                  var eI = el.querySelector('i'); if (eI) eI.textContent = prixTxt(x);
                  var eU = el.querySelector('u'); if (eU) eU.textContent = chgTxt(x);
                  if (prevVals && prevVals[x.label] !== sig) _majFlash(el);
                });
              });
              if (top) {
                var tete = racine.querySelector('.wdg-tick-tete');
                if (tete) {
                  var vT = Number(top.chg);
                  tete.classList.toggle('est-haut', vT > 0);
                  tete.classList.toggle('est-bas', vT < 0);
                  var fl = tete.querySelector('.wdg-tick-fl'); if (fl) fl.textContent = vT > 0 ? '▲' : vT < 0 ? '▼' : '·';
                  var eB = tete.querySelector('b'); if (eB) eB.textContent = top.label;
                  var eU2 = tete.querySelector('u'); if (eU2) eU2.textContent = chgTxt(top);
                  var sp = tete.querySelector('.wdg-vie');
                  if (sp) { sp.setAttribute('data-ts', ts); sp.textContent = _vie(ts); }
                  var tSig = top.label + '|' + top.chg;
                  if (prevTete != null && prevTete !== tSig) _majFlash(eU2 || tete);
                  prevTete = tSig;
                }
              }
            } else {
              /* ── RECONSTRUCTION (premier rendu, retour de panne, sélection/réglage changé) :
                 seul chemin qui recalcule la durée — donc le seul où l'animation repart. */
              var un = items.map(function (x) { return seg(x, avecVar, avecCours); }).join('');
              var teteH = '';
              if (top) {
                var v3 = Number(top.chg);
                teteH = '<div class="wdg-tick-tete' + (v3 > 0 ? ' est-haut' : v3 < 0 ? ' est-bas' : '')
                  + '" title="Plus forte variation du bandeau">'
                  + '<i class="wdg-tick-fl">' + (v3 > 0 ? '▲' : v3 < 0 ? '▼' : '·') + '</i>'
                  + '<b>' + esc(top.label) + '</b>'
                  + '<u class="wdg-maj-txt">' + chgTxt(top) + '</u>'
                  + _vieSpan(ts) + '</div>';
              }
              // Contenu DOUBLE : la boucle se referme sans couture visible. La fenêtre .wdg-tick-fen
              // isole le défilement de la pastille fixe.
              host.innerHTML = '<div class="wdg-tick">' + teteH
                + '<div class="wdg-tick-fen"><div class="wdg-tick-piste">' + un + un + '</div></div></div>';
              piste = host.querySelector('.wdg-tick-piste');
              // Vitesse CONSTANTE en px/s : la duree suit la largeur reelle du contenu.
              requestAnimationFrame(function () {
                if (!piste || !piste.isConnected) return;
                var w = piste.scrollWidth / 2;
                var v = PX[vit] || PX.normal;
                if (w > 0) piste.style.setProperty('--wdg-tick-dur', Math.max(6, w / v).toFixed(1) + 's');
              });
              prevTete = top ? top.label + '|' + top.chg : null;
            }
            prevStruct = struct;
            prevVals = {};
            items.forEach(function (x) { prevVals[x.label] = String(x.price) + '|' + String(x.chg); });
          }).catch(function () { if (vivant && host.isConnected) { fallback(host, 'Cotations indisponibles.'); prevStruct = null; } });
        }

        dessiner();
        // Cache serveur de 60 s : sonder plus vite ne relirait que le meme cache.
        var iv = setInterval(dessiner, 60000);
        return function () { vivant = false; try { clearInterval(iv); } catch (e) {} };
      },
    },

    {
      id: 'matrice-croisee', name: 'Taux croisés', tag: 'FX', cat: 'Marchés', h: 340,
      desc: 'La grille des huit majeures : chaque croisement, son cours et sa variation du jour.',
      aide: "<p>La grille 8×8 des majeures : chaque case porte le cours et la variation de séance du croisement devise en ligne contre devise en colonne. La moitié non cotée est reconstruite par inversion exacte et signalée d'un point ; la ligne du bas nomme la devise qui mène et celle qui ferme la marche, en moyenne sur leurs sept croisements.</p><p>La lecture utile est <strong>transversale</strong> : balayer la ligne d'une devise dit si sa force est générale ou locale. Une devise en tête sur six ou sept croisements porte un mouvement de fond ; une case isolée raconte l'histoire d'une seule paire.</p>",
      src: "Cotations servies par le desk et relues toutes les 150 secondes ; les cases à point sont un calcul exact du croisement coté, jamais une cotation reçue.",
      watch: "Les soulignés meneuse/lanterne sur les en-têtes : quand ils changent de devise en cours de séance, la hiérarchie du marché est en train de tourner.",
      /* Source : /api/fxlist, qui cote 28 paires — soit UNE seule moitie des 56 cases hors diagonale
         (USD/JPY est cote, JPY/USD ne l est pas). L autre moitie est INVERSEE cote client, et cette
         inversion est SIGNALEE a l ecran : ce n est pas une cotation recue.
         ⚠️ La variation inverse n est PAS -r : c est -r / (1 + r/100). L oppose simple est faux.
         ⚠️ Jamais ?force=1 sur un minuteur : cela remet le TTL a zero et relance 28 requetes Yahoo. */
      opts: [
        { k: 'contenu', lbl: 'Cellule', type: 'choix', def: 'prix-var',
          choix: [['prix-var', 'Cours et variation'], ['prix', 'Cours seul'], ['var', 'Variation seule']] },
        { k: 'coul', lbl: 'Colorer selon la variation', type: 'bascule', def: true },
        { k: 'inverse', lbl: 'Remplir la moitié inversée', type: 'bascule', def: true },
        /* Sur 64 cases, lire « tout ce qui touche le dollar » demande de balayer une ligne ET une
           colonne. Ce reglage les eclaire et estompe le reste. */
        { k: 'focus', lbl: 'Devise mise en avant', type: 'choix', def: 'aucune',
          choix: [['aucune', 'Aucune'], ['USD', 'USD'], ['EUR', 'EUR'], ['JPY', 'JPY'], ['GBP', 'GBP'],
            ['AUD', 'AUD'], ['CHF', 'CHF'], ['CAD', 'CAD'], ['NZD', 'NZD']] },
      ],
      mount: function (host, it) {
        var W = this, vivant = true;
        var DEV = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CHF', 'CAD', 'NZD'];
        skel(host, 8);
        /* Mémoire du DIFF (23/08) : le re-rendu des 64 cellules d'un bloc rendait invisible la
           cellule qui venait de bouger. Le diff ne s'applique QUE si la structure est identique
           (options, palier étroit, présence/type de chaque case) — c'est ce qui borne le risque
           relevé en contre-lecture ; toute autre situation reconstruit, comme avant. */
        var prevStruct = null, prevVals = null, prevVerd = null;

        function fmt(v, q) {
          // isFinite GLOBAL coerce null en 0 : la garde `== null` évite un toFixed sur null.
          if (v == null || !isFinite(v)) return '--';
          // Nombre de decimales : /api/fxlist ne sert PAS de champ « dec » (contrairement a /api/ticker).
          // C est donc une convention d affichage, pas une donnee : 3 decimales en JPY, 5 ailleurs.
          return v.toFixed(q === 'JPY' ? 3 : 5);
        }

        function dessiner() {
          fetch('/api/fxlist').then(function (r) { return r.json(); }).then(function (d) {
            if (!vivant || !host.isConnected) return;
            var paires = (d && d.pairs) || [];
            if (!paires.length) { fallback(host, 'Cotations indisponibles.'); prevStruct = null; return; }
            var par = {};
            paires.forEach(function (p) { if (p && p.base && p.quote) par[p.base + p.quote] = p; });

            // Largeur connue AVANT de composer les cellules : elle decide du nombre de decimales.
            var etroit = host.clientWidth > 0 && host.clientWidth <= 470;
            var contenu = opt(it, W, 'contenu') || 'prix-var';
            var coul = opt(it, W, 'coul') !== false;
            var inv = opt(it, W, 'inverse') !== false;
            // La devise mise en avant eclaire SA ligne et SA colonne, et estompe le reste : sur
            // 64 cases, « tout ce qui touche le dollar » se lit alors d un seul regard.
            var focus = opt(it, W, 'focus') || 'aucune';

            /* ── PASSE DONNÉES : les 64 cases calculées AVANT de choisir entre reconstruction et
               diff — une seule vérité pour les deux chemins. L'inversion est calculée MÊME quand
               la bascule « moitié inversée » est décochée : la bascule gouverne l'AFFICHAGE, pas
               le verdict devise, qui a besoin des 7 croisements de chaque devise. */
            /* ⚠️ chg vit en NaN (jamais null) quand il est inconnu : Number(null) vaut 0 et
               isFinite GLOBAL coerce null en 0 — une case vide compterait alors comme un zéro
               CONNU dans la moyenne devise (piège attrapé au banc). NaN, lui, échoue proprement
               à tous les tests isFinite. */
            var cells = [];
            DEV.forEach(function (b) {
              DEV.forEach(function (q) {
                if (b === q) { cells.push({ b: b, q: q, diag: true }); return; }
                var p = par[b + q], prix = null, chg = NaN, inverse = false;
                if (p) {
                  prix = p.last == null ? null : Number(p.last);
                  chg = p.changePct == null ? NaN : Number(p.changePct);
                }
                else if (par[q + b]) {
                  var o = par[q + b];
                  var l = o.last == null ? NaN : Number(o.last);
                  var c = o.changePct == null ? NaN : Number(o.changePct);
                  if (isFinite(l) && l !== 0) { prix = 1 / l; inverse = true; }
                  // Inversion EXACTE de la variation : 1/(1+r) - 1, et non -r.
                  if (isFinite(c) && (1 + c / 100) !== 0) { chg = -c / (1 + c / 100); inverse = true; }
                }
                // Case inversée non affichée (bascule décochée) : rendue vide, donnée gardée.
                var cache = inverse && !inv;
                cells.push({ b: b, q: q, prix: prix, chg: chg, inverse: inverse,
                  vide: cache || (prix == null && !isFinite(chg)) });
              });
            });

            /* ── VERDICT devise, déterministe : moyenne des variations des 7 croisements de
               chaque devise pris DANS LE SENS D/Q (coté direct ou inversé par la formule exacte
               ci-dessus). Les changePct non finis sont ignorés, et une devise n'est nommée
               meneuse/lanterne qu'avec >= 5 croisements finis sur 7 — en dessous, le chiffre
               serait du bruit présenté en conclusion (règle de la contre-lecture). Sous ±0,10 %
               de moyenne max : séance étale. Jamais un conseil, un constat de séance. */
            var moyD = [];
            DEV.forEach(function (D) {
              var s = 0, n = 0;
              cells.forEach(function (c) {
                if (c.diag || c.b !== D) return;
                if (isFinite(c.chg)) { s += c.chg; n++; }
              });
              if (n >= 5) moyD.push({ dev: D, moy: s / n, n: n });
            });
            var fmtM = function (v) { return (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + '%'; };
            var vHtml = '', vSous = '', teteDev = null, queueDev = null;
            if (moyD.length >= 2) {
              var forte = moyD[0], faible = moyD[0], mob = moyD[0];
              moyD.forEach(function (m) {
                if (m.moy > forte.moy) forte = m;
                if (m.moy < faible.moy) faible = m;
                if (Math.abs(m.moy) > Math.abs(mob.moy)) mob = m;
              });
              if (Math.abs(mob.moy) < 0.10) {
                vHtml = 'Séance étale : <span class="est-present">' + mob.dev + '</span> la plus mobile à ' + fmtM(mob.moy) + ' en moy.';
                vSous = 'Aucune devise ne s\'écarte de ±0,10% en moyenne sur ses croisements.';
              } else if (forte.dev !== faible.dev) {
                teteDev = forte.dev; queueDev = faible.dev;
                vHtml = '<span' + (forte.moy > 0 ? ' class="est-haut"' : forte.moy < 0 ? ' class="est-bas"' : '') + '>' + forte.dev + '</span>'
                  + ' mène la séance (' + fmtM(forte.moy) + ' en moy. sur ses ' + forte.n + ' croisements) · '
                  + '<span' + (faible.moy < 0 ? ' class="est-bas"' : faible.moy > 0 ? ' class="est-haut"' : '') + '>' + faible.dev + '</span>'
                  + ' ferme la marche (' + fmtM(faible.moy) + ')';
                vSous = 'Moyenne des variations de séance de ses croisements, moitié inversée comprise.';
              }
            }

            var celluleV = function (c) {
              return isFinite(c.chg)
                ? (c.chg > 0 ? '+' : '') + c.chg.toFixed(etroit ? 1 : 2).replace('.', ',') + '<i class="wdg-mx-u"> %</i>'
                : '--';
            };
            // /api/fxlist sert updatedAt en ISO (pas en ms) : Date.parse, repli sur l'heure du fetch.
            var ts = Date.parse(d.updatedAt || '') || Date.now();
            var struct = contenu + '|' + (coul ? 1 : 0) + (inv ? 1 : 0) + '|' + focus + '|' + (etroit ? 1 : 0)
              + '|' + (vHtml ? 1 : 0) + (vSous ? 1 : 0) + '|'
              + cells.map(function (c) {
                  return c.diag ? 'd' : c.vide ? 'v'
                    : (isFinite(c.chg) ? 'c' : 'x') + (c.prix != null ? 'p' : '') + (c.inverse ? 'i' : '');
                }).join('');

            var racine = host.querySelector('.wdg-mx');
            if (racine && prevStruct === struct) {
              /* ── DIFF à structure constante : cours et variation réécrits en place, classes
                 sémantiques rejouées, fondu sur les seules cases qui ont bougé. */
              cells.forEach(function (c) {
                if (c.diag || c.vide) return;
                var el = racine.querySelector('td[data-cle="' + c.b + c.q + '"]');
                if (!el) return;
                if (coul) {
                  el.classList.toggle('est-haut', isFinite(c.chg) && c.chg > 0);
                  el.classList.toggle('est-bas', isFinite(c.chg) && c.chg < 0);
                }
                var eP = el.querySelector('.wdg-mx-p'); if (eP) eP.textContent = fmt(c.prix, c.q);
                var eV = el.querySelector('.wdg-mx-v'); if (eV) eV.innerHTML = celluleV(c);
                var sig = c.prix + '|' + c.chg;
                if (prevVals && prevVals[c.b + c.q] !== sig) _majFlash(el);
              });
              // Soulignés meneuse/lanterne rejoués sur les en-têtes (ligne ET colonne).
              racine.querySelectorAll('th[data-dev]').forEach(function (th) {
                var dv = th.getAttribute('data-dev');
                th.classList.toggle('est-tete', dv === teteDev);
                th.classList.toggle('est-queue', dv === queueDev);
              });
              var vt = racine.querySelector('.wdg-verdict-txt');
              if (vt && vHtml && vHtml !== prevVerd) { vt.innerHTML = vHtml; _majFlash(vt); }
              var vsE = racine.querySelector('.wdg-verdict-sous');
              if (vsE) vsE.textContent = vSous;
              var sp = racine.querySelector('.wdg-vie');
              if (sp) { sp.setAttribute('data-ts', ts); sp.textContent = _vie(ts); }
            } else {
              var thCls = function (dv) {
                return dv === teteDev ? ' class="est-tete"' : dv === queueDev ? ' class="est-queue"' : '';
              };
              var h = '<div class="wdg-mx"><table class="wdg-mx-t"><thead><tr><th></th>';
              DEV.forEach(function (q) { h += '<th data-dev="' + q + '"' + thCls(q) + '>' + q + '</th>'; });
              h += '</tr></thead><tbody>';
              DEV.forEach(function (b) {
                h += '<tr><th data-dev="' + b + '"' + thCls(b) + '>' + b + '</th>';
                cells.forEach(function (c) {
                  if (c.b !== b) return;
                  if (c.diag) { h += '<td class="wdg-mx-diag"></td>'; return; }
                  if (c.vide) { h += '<td class="wdg-mx-vide">--</td>'; return; }
                  var cls = coul && isFinite(c.chg) ? (c.chg > 0 ? ' est-haut' : c.chg < 0 ? ' est-bas' : '') : '';
                  var vedette = focus !== 'aucune' && (c.b === focus || c.q === focus);
                  var terne = focus !== 'aucune' && !vedette;
                  h += '<td class="wdg-mx-c wdg-maj-surf' + cls + (c.inverse ? ' est-inv' : '') + (terne ? ' est-terne' : '') + (vedette ? ' est-vedette' : '')
                    + '" data-cle="' + c.b + c.q + '">';
                  if (contenu !== 'var') h += '<span class="wdg-mx-p">' + fmt(c.prix, c.q) + '</span>';
                  if (contenu !== 'prix') h += '<span class="wdg-mx-v">' + celluleV(c) + '</span>';
                  h += '</td>';
                });
                h += '</tr>';
              });
              h += '</tbody></table>';
              if (vHtml) {
                h += '<div class="wdg-verdict"><b class="wdg-verdict-txt wdg-maj-txt">' + vHtml + '</b>'
                  + (vSous ? '<span class="wdg-verdict-sous">' + esc(vSous) + '</span>' : '') + '</div>';
              }
              h += '<div class="wdg-mx-pied">';
              var leg = [];
              if (etroit) leg.push('Variations en %');
              if (inv) leg.push('les cases à point sont l\'inverse exact du croisement coté');
              if (leg.length) h += '<span class="wdg-mx-leg">' + leg.join(' &middot; ') + '.</span>';
              h += '<span class="wdg-mx-maj">' + _vieSpan(ts) + '</span>';
              h += '</div></div>';
              host.innerHTML = h;
              palier();
            }
            prevStruct = struct; prevVerd = vHtml;
            prevVals = {};
            cells.forEach(function (c) { if (!c.diag && !c.vide) prevVals[c.b + c.q] = c.prix + '|' + c.chg; });
          }).catch(function () { if (vivant && host.isConnected) { fallback(host, 'Cotations indisponibles.'); prevStruct = null; } });
        }

        dessiner();
        /* PALIER DE LARGEUR (mesure au banc : 9 colonnes de cours a 5 decimales debordent sous
           ~460 px). On ne rogne pas la grille et on ne cree pas de defilement horizontal parasite :
           sur carte etroite la matrice garde ses 64 croisements mais ne montre que la VARIATION,
           l information qui se lit d un balayage. Le cours reste accessible en elargissant. */
        var cadre = null;
        function palier() {
          cadre = host.querySelector('.wdg-mx');
          if (cadre) cadre.classList.toggle('est-etroit', host.clientWidth > 0 && host.clientWidth <= 470);
        }
        var _ro = null;
        if (window.ResizeObserver) { _ro = new ResizeObserver(palier); _ro.observe(host); }
        // Aligne sur le tick serveur de 150 s. On saute le tour quand l onglet est cache : inutile de
        // solliciter la route pour une carte que personne ne regarde.
        var iv = setInterval(function () { if (!document.hidden) dessiner(); }, 150000);
        return function () { vivant = false; try { clearInterval(iv); } catch (e) {} try { if (_ro) _ro.disconnect(); } catch (e) {} };
      },
    },

    {
      id: 'saison-courbe', name: 'Rendement mensuel',
      maj: 30 * 60 * 1000, tag: 'SAISONNALITÉ', cat: 'Macro', h: 300,   // donnee historique : le rythme sert a se reparer
      desc: 'Le rendement moyen de chaque mois civil sur cinq ans, en barres ou en cumul.',
      aide: "<p>Le rendement moyen de chaque mois civil sur cinq ans, en barres ou en courbe cumulée sur l'année ; le mois en cours est marqué en or et compté comme partiel. La régularité, en option, dit combien d'années observées ont fini chaque mois en hausse.</p><p>La saisonnalité est un <strong>vent de fond</strong>, pas un signal : cinq observations font une tendance fragile, et un mois « moyen à +0,8% » obtenu par une seule année exceptionnelle ne vaut pas quatre années sur cinq. Elle sert à pondérer une idée, jamais à la créer.</p>",
      src: "Rendements mensuels calculés sur cinq ans de clôtures réelles, cachés 6 heures côté serveur ; l'horodatage affiché est celui de la donnée servie, pas de la lecture.",
      watch: "Les mois dont la moyenne et la régularité vont dans le même sens, et l'entrée dans l'un d'eux : c'est là que le vent de fond mérite d'être pesé face au calendrier réel.",
      /* Complement du widget « Saisonnalite » (table de chiffres) : celui-ci DESSINE la meme donnee.
         ⚠️ DEUX PIEGES QUE L ON AFFICHE AU LIEU DE LES CACHER :
         1) Le MOIS EN COURS est partiel — le serveur garde le dernier cours vu, donc pour ce mois-ci
            c est le cours du jour. Sa barre est hachuree et le pied le dit.
         2) « avg » ne porte pas toujours sur 5 ans : pour les mois a venir, l annee courante est vide,
            la moyenne tombe a 4 observations. On COMPTE les valeurs reelles et on l ecrit. */
      opts: [
        { k: 'symbole', lbl: 'Symbole', type: 'choix', def: '', choix: _seasonChoix() },
        { k: 'mode', lbl: 'Affichage', type: 'choix', def: 'mensuel',
          choix: [['mensuel', 'Par mois'], ['cumule', 'Cumulé sur l\'année']] },
        /* Un mois a +0,8 % de moyenne obtenu par UNE annee exceptionnelle ne vaut pas un mois a
           +0,8 % obtenu quatre fois sur cinq. La regularite le dit, et elle se compte sur les
           annees reellement observees. */
        { k: 'regularite', lbl: 'Afficher la régularité', type: 'bascule', def: false },
      ],
      mount: function (host, it) {
        var W = this, vivant = true, cur = null;
        /* Mémoire du verdict : le fondu de MAJ (grammaire commune) ne se joue que sur un VRAI
           changement de texte, jamais au premier rendu. */
        var prevVerd = null;
        skel(host, 6);

        function rendre(d) {
          var rows = (d && d.rows) || [], ans = (d && d.years) || [];
          if (rows.length !== 12) { fallback(host, 'Saisonnalité indisponible.'); return; }
          var moisCourant = new Date().getMonth();
          var mode = opt(it, W, 'mode') || 'mensuel';
          var regul = opt(it, W, 'regularite') === true;

          var vals, cumul = 0;
          if (mode === 'cumule') {
            // Cumul construit depuis avg : une transformation d une donnee reelle. Un mois sans
            // moyenne n AJOUTE RIEN (il ne vaut pas zero) : la courbe reste plate, elle ne plonge pas.
            vals = rows.map(function (r) {
              if (typeof r.avg === 'number' && isFinite(r.avg)) cumul += r.avg;
              return cumul;
            });
          } else {
            vals = rows.map(function (r) { return (typeof r.avg === 'number' && isFinite(r.avg)) ? r.avg : null; });
          }

          /* Le PRÉSENT est marqué DANS le tracé (doctrine DTP) : liseré or sur la barre du mois
             courant, point or sur la courbe cumulée — l'étiquette d'axe seule ne suffisait pas
             (elle marquait le mois sans distinguer sa valeur). */
          var svg = mode === 'cumule'
            ? _courbeSvg(vals, { zero: true, aire: true, point: moisCourant })
            : _barresSvg(vals, { signe: true, marque: moisCourant });

          /* Verdict PARTAGÉ avec la table Saisonnalité (même helper, même exclusion du mois
             partiel — le `avg` servi inclut l'année en cours, _saisonVerdict la retire). */
          var v = _saisonVerdict(rows, ans, (d && d.symbol) || '');

          // Nombre d observations REELLES du mois courant : compte des valeurs non nulles.
          var nObs = (rows[moisCourant] && rows[moisCourant].vals || []).filter(function (v2) { return typeof v2 === 'number'; }).length;
          var periode = (ans.length ? ans[0] + '-' + ans[ans.length - 1] : '5 ans');
          /* Fraîcheur HONNÊTE : le ts vient de la RÉPONSE (cache serveur 6 h, voire repli
             persistant après panne Yahoo) — « il y a 5 h » dit l'âge du servi, jamais un faux
             temps réel. Retimbré par le minuteur global de la grammaire commune. */
          var ts = Date.parse((d && d.updatedAt) || '') || 0;

          host.innerHTML = '<div class="wdg-sais">'
            + '<div class="wdg-sais-tete"><span class="wdg-sais-sym">' + esc((d && d.symbol) || '') + '</span>'
            + '<span class="wdg-sais-mode">' + (mode === 'cumule' ? 'Cumulé' : 'Par mois') + '</span></div>'
            + (v ? '<div class="wdg-verdict" data-etat="' + v.etat + '">'
                + '<b class="wdg-verdict-txt wdg-maj-txt">' + v.txt + '</b>'
                + (v.sous ? '<span class="wdg-verdict-sous">' + v.sous + '</span>' : '') + '</div>' : '')
            + '<div class="wdg-sais-zone">' + svg + '</div>'
            + '<div class="wdg-sais-axe">' + _MOIS_FR.map(function (m, i) {
              /* Regularite : le nombre d annees POSITIVES sur les annees reellement observees.
                 Un mois a +0,8 % obtenu par une seule annee exceptionnelle ne vaut pas un mois a
                 +0,8 % obtenu quatre fois sur cinq — et le denominateur varie d un mois a l autre,
                 les mois a venir n ayant pas encore l annee courante. */
              var reg = '';
              if (regul) {
                var vs = (rows[i] && rows[i].vals || []).filter(function (v) { return typeof v === 'number'; });
                if (vs.length) reg = '<em>' + vs.filter(function (v) { return v > 0; }).length + '/' + vs.length + '</em>';
              }
              return '<span' + (i === moisCourant ? ' class="est-courant"' : '') + '>' + m + reg + '</span>';
            }).join('') + '</div>'
            + '<div class="wdg-sais-pied">Moyenne mensuelle sur ' + esc(periode)
            + ' &middot; rendement de fin de mois à fin de mois. Le mois en cours est partiel ('
            + nObs + ' année' + (nObs > 1 ? 's' : '') + ' observée' + (nObs > 1 ? 's' : '') + '). '
            + _vieSpan(ts) + '</div>'
            + '</div>';

          // Fondu de MAJ (grammaire commune) : uniquement quand le verdict change réellement.
          if (prevVerd != null && v && v.txt !== prevVerd) _majFlash(host.querySelector('.wdg-verdict-txt'));
          prevVerd = v ? v.txt : null;
        }

        function dessiner() {
          var sym = opt(it, W, 'symbole') || '';
          var url = sym ? ('/api/seasonality?symbol=' + encodeURIComponent(sym)) : '/api/seasonality';
          cur = sym;
          fetch(url).then(function (r) { return r.json(); }).then(function (d) {
            // Reponse perimee : le reglage a change pendant le vol.
            if (!vivant || !host.isConnected || cur !== sym) return;
            rendre(d);
          }).catch(function () { if (vivant && host.isConnected) fallback(host, 'Saisonnalité indisponible.'); });
        }

        dessiner();
        /* Le serveur cache 6 h et le socle REMONTE la carte toutes les 30 min (champ `maj` du
           catalogue) : aucun minuteur ici — le retimbrage de l'horodatage est porté par le
           minuteur GLOBAL de la grammaire commune, rien à nettoyer. L'ancien ResizeObserver au
           callback VIDE promettait un recalage inexistant (code mort relevé par la
           contre-lecture) : retiré, le SVG est étiré par le CSS et l'axe HTML suit tout seul. */
        return function () { vivant = false; };
      },
    },

    {
      id: 'frequence-amplitude', name: 'Atteinte d\'un seuil', tag: 'VOLATILITÉ', cat: 'Marchés', h: 320,   // renommage 23/08 (le nom doit dire ce qu'on voit) — l'ancre du lot initial avait raté l'apostrophe échappée, attrapé par l'agent mails
      desc: 'La part des séances où la paire a parcouru au moins X pips.',
      aide: "<p>Pour un seuil en pips, la part des séances passées qui l'ont atteint : la courbe descend palier par palier, le trait fin marque votre seuil, le trait or le parcours d'aujourd'hui. La ligne du bas donne, parmi les séances arrivées là où on en est, la part qui a fini au-delà du seuil.</p><p>C'est une <strong>fréquence observée</strong>, jamais une probabilité de toucher un objectif : la bougie quotidienne ne dit pas dans quel ordre le haut et le bas ont été touchés. Un objectif que la paire n'atteint qu'une séance sur cinq demande d'être justifié par autre chose que l'habitude.</p>",
      src: "Bougies quotidiennes réelles, relues toutes les 5 minutes ; la journée en cours est exclue de l'échantillon, l'amplitude est brute (aucun coût de transaction) et le pip est une convention de place.",
      watch: "La fréquence conditionnelle de la ligne du bas à mesure que la séance avance : c'est elle qui dit si le seuil visé reste ordinaire ou devient une demande de séance rare.",
      /* Le mot « probabilite » est ECARTE volontairement : ce que la source permet de calculer est
         une FREQUENCE HISTORIQUE OBSERVEE, pas une prevision.
         ⚠️ CE QUI EST INFAISABLE ICI, et qu on ne promettra donc jamais : « toucher +30 avant -30 ».
         Une bougie D1 donne h et l, jamais l ORDRE dans lequel ils ont ete touches. Le M15 le
         permettrait mais ne remonte qu a un mois : trop court pour une statistique.
         ⚠️ La taille du pip n est dans AUCUN champ de la source : c est une convention, redeclaree
         ici (le depot l a deja dans app.js mais enfermee dans une closure inaccessible). */
      opts: [
        { k: 'paire', lbl: 'Paire', type: 'choix', def: 'EUR/USD', choix: _fxChoix() },
        { k: 'mesure', lbl: 'Mesure', type: 'choix', def: 'ampl',
          choix: [['ampl', 'Amplitude haut-bas'], ['exc', 'Excursion depuis l\'ouverture']] },
        { k: 'seuil', lbl: 'Seuil (pips)', type: 'nombre', def: 50, min: 10, max: 300 },
        /* Second repere : le trader lit son objectif ET son invalidation dans la meme carte.
           0 = un seul seuil. */
        { k: 'cible', lbl: 'Second seuil (pips)', type: 'nombre', def: 0, min: 0, max: 300 },
      ],
      mount: function (host, it) {
        var W = this, vivant = true, cur = null, cache = {};
        /* Mémoire du parcours du JOUR : le fondu de MAJ ne se joue qu'à réglages constants et sur
           un vrai changement de valeur, jamais au premier rendu. */
        var prevCleF = null, prevAujM = null;
        skel(host, 6);

        // La convention de pip vit desormais au niveau module (_pipTaille) : trois widgets s en
        // servent, et deux copies auraient diverge a la premiere retouche.
        function pip(paire) { return _pipTaille(paire) || 0.0001; }

        function dessiner() {
          var paire = opt(it, W, 'paire') || 'EUR/USD';
          var mesure = opt(it, W, 'mesure') || 'ampl';
          var seuil = opt(it, W, 'seuil') || 50;
          cur = paire;
          /* ⚠️ Ce widget etait le SEUL des six a garder son propre fetch : sans controle de r.ok,
             sans delai maximal et surtout SANS REESSAI. C est precisement lui que l utilisateur a
             vu bloque sur « Bougies indisponibles » le 19/08, alors que les cinq autres widgets
             affichaient la meme paire sans probleme. Il passe par la brique partagee. */
          _bougies(paire, 'D1', cache)
            .then(function (c) {
              if (!vivant || !host.isConnected || cur !== paire) return;
              /* La bougie du JOUR est exclue de l'échantillon (haut/bas pas encore figés) mais
                 EXTRAITE d'abord : c'est elle qui porte le présent de la carte. Détection en date
                 UTC des DEUX côtés : l'ancien filtre coupait à minuit LOCAL pendant que le reste
                 de la famille raisonne en jour UTC — deux règles pour la même question
                 (incohérence relevée par la contre-lecture). */
              var dernC = c[c.length - 1];
              var bAuj = (dernC && _memeJourUTC(dernC.t) && isFinite(dernC.h) && isFinite(dernC.l) && isFinite(dernC.o)) ? dernC : null;
              var bougies = c.filter(function (b) { return b && !_memeJourUTC(b.t) && isFinite(b.h) && isFinite(b.l) && isFinite(b.o); });
              if (bougies.length < 200) { fallback(host, 'Historique insuffisant (n = ' + bougies.length + ' séances).'); return; }

              var P = pip(paire);
              var mesures = bougies.map(function (b) {
                return mesure === 'exc' ? Math.max(b.h - b.o, b.o - b.l) / P : (b.h - b.l) / P;
              }).filter(function (v) { return isFinite(v) && v >= 0; });
              var n = mesures.length;

              // Escalier decroissant : pour chaque palier de 10 pips, la PART des seances qui l atteignent.
              var paliers = [], parts = [];
              for (var x = 10; x <= 300; x += 10) {
                var part = mesures.filter(function (v) { return v >= x; }).length / n * 100;
                paliers.push(x); parts.push(part);
                /* On s arrete des que le palier devient anecdotique : au-dela, la courbe rase le zero
                   et occupe les quatre cinquiemes de la carte pour ne rien montrer. On garde
                   toujours les paliers demandes par les deux reglages de seuil. */
                if (part < 1 && x > seuil && (!opt(it, W, 'cible') || x > opt(it, W, 'cible'))) break;
              }
              var atteint = mesures.filter(function (v) { return v >= seuil; }).length;
              var pct = atteint / n * 100;
              /* Second repere : l objectif ET l invalidation dans la meme carte. 0 = un seul.
                 On affiche toujours numerateur et denominateur : un pourcentage seul ne dit pas
                 sur combien de seances il porte. */
              var cible = opt(it, W, 'cible') || 0;
              var atteint2 = cible > 0 ? mesures.filter(function (v) { return v >= cible; }).length : 0;
              var pct2 = cible > 0 ? atteint2 / n * 100 : null;

              /* ── LE PRÉSENT : où en est la séance face au seuil visé. Fréquence CONDITIONNELLE
                 (courbe de survie) : parmi les séances closes arrivées AU MOINS là où on en est,
                 la part qui a fini au-delà du seuil. L'amplitude ne fait que croître dans la
                 journée : le conditionnement est exact — mais SEULEMENT tant que aujM < seuil.
                 Au-delà, l'ensemble « >= seuil » CONTIENT « >= aujM » et le quotient dépasserait
                 100 % (cas relevé par la contre-lecture) : on bascule sur la fréquence simple.
                 Jour record : dénominateur nul, on le DIT au lieu de diviser. Moins de 20 séances
                 comparables : le pourcentage serait du bruit, on se tait. Le second seuil
                 (réglage « cible ») reste hors verdict : silence assumé. */
              var aujM = bAuj ? (mesure === 'exc' ? Math.max(bAuj.h - bAuj.o, bAuj.o - bAuj.l) : (bAuj.h - bAuj.l)) / P : null;
              if (aujM != null && !(isFinite(aujM) && aujM >= 0)) aujM = null;
              var vEtat = '', vb = '', vs = '';
              if (aujM != null) {
                if (aujM >= seuil) {
                  vEtat = 'atteint';
                  vb = 'Seuil de ' + seuil + ' pips atteint (' + Math.round(aujM) + ' parcourus)';
                  vs = pct.toFixed(0) + ' % des séances y parviennent.';
                } else {
                  vEtat = 'encours';
                  vb = 'Aujourd\'hui : ' + Math.round(aujM) + ' pips sur ' + seuil + ' visés (' + Math.round(aujM / seuil * 100) + ' %)';
                  var denom = mesures.filter(function (v) { return v >= aujM; }).length;
                  if (denom === 0) vs = 'Amplitude record : aucune séance close de l\'échantillon n\'est arrivée aussi loin.';
                  else if (denom < 20) vs = 'Seulement ' + denom + ' séances closes arrivées aussi loin : trop peu pour une fréquence fiable.';
                  else vs = 'Parmi les ' + denom + ' séances arrivées à ' + Math.round(aujM) + ' pips, ' + Math.round(atteint / denom * 100) + ' % ont franchi les ' + seuil + '.';
                }
              } else if (mesures.length) {
                // Week-end / férié : la dernière ligne est une séance CLOSE, on l'étiquette ainsi.
                vEtat = 'clos';
                var dernM = mesures[mesures.length - 1];
                vb = 'Dernière séance close : ' + Math.round(dernM) + ' pips, seuil ' + (dernM >= seuil ? 'franchi' : 'non atteint');
                vs = pct.toFixed(0) + ' % des séances ' + (dernM >= seuil ? 'y parviennent' : 'l\'atteignent') + '.';
              }

              /* Repères posés en HTML PAR-DESSUS la courbe (les helpers SVG partagés restent
                 intacts) : trait fin = seuil visé, trait or = où en est aujourd'hui. Échelle =
                 bornes RÉELLES du tracé, position bornée 0-100 (un jour record sort de l'axe,
                 il se colle au bord droit). */
              var rep = '';
              var p0 = paliers[0], pFin = paliers[paliers.length - 1];
              if (pFin > p0) {
                var lx = function (v) { return Math.max(0, Math.min(100, (v - p0) / (pFin - p0) * 100)).toFixed(1); };
                rep = '<i class="wdg-freq-rep" style="left:' + lx(seuil) + '%"></i>'
                  + (aujM != null ? '<i class="wdg-freq-rep est-auj" style="left:' + lx(aujM) + '%"></i>' : '');
              }

              host.innerHTML = '<div class="wdg-freq">'
                + '<div class="wdg-freq-tete"><span class="wdg-freq-paire">' + esc(paire) + '</span>'
                + '<span class="wdg-freq-mes">' + (mesure === 'exc' ? 'Excursion depuis l\'ouverture' : 'Amplitude haut-bas') + '</span></div>'
                + '<div class="wdg-freq-gros"><b>' + pct.toFixed(0) + ' %</b>'
                + '<span>des séances ont parcouru au moins ' + seuil + ' pips</span></div>'
                // Numerateur ET denominateur : un pourcentage seul ne dit pas sur quoi il porte.
                + '<div class="wdg-freq-n">' + atteint + ' séances sur ' + n
                + (pct2 != null ? '<span class="wdg-freq-c">' + cible + ' pips : ' + pct2.toFixed(0) + ' % (' + atteint2 + ')</span>' : '')
                + '</div>'
                + (vb ? '<div class="wdg-verdict" data-etat="' + vEtat + '">'
                    + '<b class="wdg-verdict-txt wdg-maj-txt">' + esc(vb) + '</b>'
                    + '<span class="wdg-verdict-sous">' + esc(vs) + '</span>'
                    // Jauge du parcours vers le seuil : repère « seuil » au bout de la piste.
                    + (vEtat !== 'clos' ? '<div class="wdg-jauge"><span style="width:' + Math.min(100, aujM / seuil * 100).toFixed(1) + '%"></span><i style="left:100%" title="seuil"></i></div>' : '')
                    + '</div>' : '')
                + '<div class="wdg-freq-zone">' + _courbeSvg(parts, { aire: true }) + rep + '</div>'
                // L axe porte les bornes REELLES du trace, pas une graduation jamais atteinte.
                + '<div class="wdg-freq-axe"><span>' + paliers[0] + '</span>'
                + '<span>' + paliers[Math.floor(paliers.length / 2)] + '</span>'
                + '<span>' + paliers[paliers.length - 1] + ' pips</span></div>'
                + '<div class="wdg-freq-pied">Fréquence observée sur les séances servies par la source, hors journée en cours. '
                + 'Amplitude brute : elle ne tient compte d\'aucun coût de transaction. '
                + _vieSpan(_bougiesMaj(paire + '|D1')) + '</div>'
                + '</div>';

              // Fondu de MAJ : réglages constants + valeur du jour réellement différente.
              var cleV = paire + '|' + mesure + '|' + seuil;
              if (prevCleF === cleV && prevAujM != null && aujM != null && Math.abs(aujM - prevAujM) > 1e-9) {
                _majFlash(host.querySelector('.wdg-verdict-txt'));
              }
              prevCleF = cleV; prevAujM = aujM;
            })
            .catch(function (e) {
              /* Distinguer la panne de DONNEE de la faute de CODE. Un « void iSeuil » laisse par
                 une refonte de reglages a fait afficher « Bougies indisponibles » pendant que la
                 source rendait 518 bougies : le message accusait la donnee d une ReferenceError.
                 On journalise desormais, et le message reste honnete dans les deux cas. */
              if (e && e.name === 'ReferenceError') console.error('[wdg frequence-amplitude]', e.message);
              if (vivant && host.isConnected) fallback(host, 'Bougies indisponibles.');
            });
        }

        dessiner();
        var stop = _rafraichirBougies(host, dessiner);
        return function () { vivant = false; stop(); };
      },
    },

    {
      id: 'dmx-paire', name: 'Particuliers par paire', tag: 'DMX', cat: 'Risque', h: 300,
      desc: 'Le partage long/short de la foule sur UNE paire, en anneau.',
      aide: "<p>Le partage acheteurs/vendeurs des particuliers sur une paire, en anneau : la source ne publie que des pourcentages, l'anneau ne montre donc rien d'autre. La ligne du haut lit le déséquilibre et son intensité pour l'unité de temps choisie.</p><p>Le sentiment des particuliers se lit à <strong>contre-courant</strong> : une foule très majoritairement acheteuse signale surtout où se massent ses stops, pas où va le prix. C'est aux extrêmes (70/30 et au-delà) que cette lecture a historiquement le plus de valeur.</p>",
      src: "Positionnement agrégé des particuliers, en pourcentages seuls (la source ne publie aucun volume), relu toutes les 60 secondes ; l'horodatage affiché est celui de la donnée servie.",
      watch: "Les déséquilibres extrêmes et leurs bascules : une foule qui change brutalement de camp pendant que le prix ne bouge pas est une information en soi.",
      /* Complément du widget « Aperçu DMX », qui liste toutes les paires : celui-ci en isole UNE et
         la donne à lire d'un coup d'œil. Même source (/api/community-outlook), même cache serveur.

         ⚠️ La source ne publie QUE des pourcentages : `symbol`, `longPct`, `shortPct`, `trend`.
         Aucun volume, aucun nombre de lots. L'anneau porte donc les pourcentages réels et rien
         d'autre : afficher des volumes supposerait de les inventer. */
      opts: [
        // cache retire (18/08, demande user) : ce widget n a PAS de barre interne, cache: true
        // masquait la paire du panneau de reglages, seul endroit ou la choisir.
        { k: 'paire', lbl: 'Paire', type: 'choix', def: 'EURUSD', choix: _dmxPairesChoix() },
        { k: 'tf', lbl: 'Unité', type: 'choix', def: 'H1', choix: [['D1', '1D'], ['H4', '4H'], ['H1', '1H']] },
      ],
      mount: function (host, it) {
        var W = this;
        // 23/08 : verdict contrarien inséré ENTRE la légende et l'anneau (spec de la refonte) +
        // horodatage updatedTs dans la légende — la carte à anneau n'a pas de pied de texte.
        host.innerHTML = '<div class="wdg-dmx1">'
          + '<div class="wdg-dmx1-leg">'
          + '<span><i style="background:#ff3d00"></i>Vendeurs</span>'
          + '<span><i style="background:#00e676"></i>Acheteurs</span>'
          + '<span class="wdg-dmx1-paire"></span><span class="wdg-dmx1-vie"></span></div>'
          + '<div class="wdg-verdict" style="display:none"><b class="wdg-verdict-txt wdg-maj-txt"></b><span class="wdg-verdict-sous"></span></div>'
          + '<div class="wdg-dmx1-anneau"></div>'
          + '<div class="wdg-dmx1-pied">'
          + '<div class="wdg-dmx1-col"><span class="wdg-dmx1-lbl">Positions vendeuses</span><b class="wdg-dmx1-short wdg-maj-txt">--</b></div>'
          + '<div class="wdg-dmx1-col"><span class="wdg-dmx1-lbl">Positions acheteuses</span><b class="wdg-dmx1-long wdg-maj-txt">--</b></div>'
          + '</div></div>';
        var zone = host.querySelector('.wdg-dmx1-anneau');
        var elS = host.querySelector('.wdg-dmx1-short'), elL = host.querySelector('.wdg-dmx1-long');
        var elP = host.querySelector('.wdg-dmx1-paire');
        var elVerd = host.querySelector('.wdg-verdict'), elVie = host.querySelector('.wdg-dmx1-vie');
        var vivant = true, _dern = '', _pcts = null;
        // La carte est redimensionnable : les etiquettes suivent la geometrie reelle de la zone.
        var _ro = null;
        try {
          _ro = new ResizeObserver(function () { if (_pcts && zone.isConnected) _donutEtiquettes(zone, _pcts[0], _pcts[1], 'Vendeurs · ' + Math.round(_pcts[0]) + '%', 'Acheteurs · ' + Math.round(_pcts[1]) + '%'); });
          _ro.observe(zone);
        } catch (e) {}

        function joli(sym) { return (sym && sym.length === 6) ? sym.slice(0, 3) + '/' + sym.slice(3) : (sym || ''); }

        /* Anneau en SVG pur : deux arcs poses sur le meme cercle par stroke-dasharray. Pas de
           bibliotheque, donc rien a charger et rien a detruire au demontage. */
        /* Gabarit de la référence (18/08, capture user) : centre VIDE, anneau plein (26), et les
           étiquettes posées SUR les segments avec un trait de rappel, à l'angle médian de chaque
           arc. La source ne publiant AUCUN volume (seulement des pourcentages), les étiquettes
           portent les pourcentages réels : afficher des lots supposerait de les inventer.
           Les arcs sont écrits À ZÉRO (dasharray '0 c') avec leur cible en data-* : dessiner()
           les pousse à la frame suivante et la transition CSS fait « se charger » l'anneau. Le
           vert part collé au rouge (dashoffset 0 -> -aC) : il grandit en le suivant, l'ensemble
           balaie le cadran comme un chargement. */




        function dessiner() {
          var paire = opt(it, W, 'paire') || 'EURUSD';
          if (elP) elP.textContent = joli(paire);
          fetch('/api/community-outlook?period=' + encodeURIComponent(opt(it, W, 'tf')))
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!vivant || !host.isConnected) return;
              /* Fraîcheur : updatedTs (ms) est servi par la route et n'était JAMAIS lu. Retimbré
                 à CHAQUE tic — c'est la preuve visible que le tic de 60 s vit, même quand
                 l'anneau, à juste titre, ne se re-rend pas (garde anti-clignotement plus bas). */
              if (elVie) elVie.innerHTML = _vieSpan(d && d.updatedTs != null ? +d.updatedTs : 0);
              var row = (d && d.symbols || []).find(function (x) { return x && x.symbol === paire; });
              if (!row) {
                fallback(zone, 'Pas de donnée DMX pour ' + joli(paire) + '.'); elS.textContent = '--'; elL.textContent = '--';
                /* Le fallback ne remplace QUE l'anneau : le verdict inséré AU-DESSUS survivrait,
                   périmé, sur une paire sans donnée (trou relevé par la contre-lecture). Vidé. */
                if (elVerd) { elVerd.style.display = 'none'; elVerd.querySelector('.wdg-verdict-txt').textContent = ''; }
                return;
              }
              var court = Number(row.shortPct) || 0, lng = Number(row.longPct) || 0;
              // Re-rendu SEULEMENT si la donnée change : le tic de 60 s ne doit pas rejouer
              // l'animation sur des valeurs identiques (l'anneau « clignoterait » sans information).
              var cle = paire + '|' + court + '|' + lng;
              // Vraie MAJ = une clé différente APRÈS un premier rendu : le fondu de la grammaire
              // commune ne se joue jamais sur le rendu initial.
              var nouveau = _dern !== '' && cle !== _dern;
              if (cle !== _dern || !zone.querySelector('svg')) {
                _dern = cle;
                zone.innerHTML = _donutSvg(court, lng);
                // La pousse : cible posée à la frame SUIVANTE, pour que la transition CSS parte
                // bien de « 0 » peint (poser la cible dans le même tour de boucle sauterait
                // l'animation, le navigateur ne peignant que l'état final).
                _pcts = [court, lng];
                var svg = zone.querySelector('svg');
                requestAnimationFrame(function () { requestAnimationFrame(function () {
                  if (!svg || !svg.isConnected) return;
                  svg.querySelectorAll('.wdg-dmx1-arc').forEach(function (a2) {
                    a2.style.strokeDasharray = a2.getAttribute('data-fin');
                    if (a2.hasAttribute('data-dec')) a2.style.strokeDashoffset = a2.getAttribute('data-dec');
                  });
                  svg.classList.add('est-charge');
                  _donutEtiquettes(zone, court, lng, 'Vendeurs · ' + Math.round(court) + '%', 'Acheteurs · ' + Math.round(lng) + '%');
                  zone.classList.add('est-charge');
                }); });
              }
              elS.textContent = court + '%';
              elL.textContent = lng + '%';

              /* ── VERDICT contrarien (tout l'intérêt du sentiment retail, jamais dit jusqu'ici).
                 Garde `== null` AVANT Number : la source peut rendre null et Number(null) vaut 0
                 — « 0 % acheteurs » fabriquerait un « haussière marquée » sur une donnée ABSENTE
                 (le piège exact qui a mordu la vague 2). L'unité s'affiche par son LIBELLÉ
                 d'option (« 1H »), jamais la valeur logique (« H1 ») — règle du desk, dérivée du
                 réglage lui-même pour ne pas diverger de la liste. */
              var lngV = row.longPct == null ? NaN : Number(row.longPct);
              var courtV = row.shortPct == null ? NaN : Number(row.shortPct);
              var tfVal = opt(it, W, 'tf') || 'H1', tfLbl = tfVal;
              (W.opts || []).forEach(function (o2) {
                if (o2.k !== 'tf') return;
                (o2.choix || []).forEach(function (ch) { if (ch[0] === tfVal) tfLbl = ch[1]; });
              });
              var v = _dmxVerdict(lngV, courtV, joli(paire), tfLbl);
              if (v && elVerd) {
                elVerd.style.display = '';
                elVerd.setAttribute('data-etat', v.etat);
                elVerd.querySelector('.wdg-verdict-txt').innerHTML = v.txt;
                elVerd.querySelector('.wdg-verdict-sous').textContent = v.sous;
              } else if (elVerd) elVerd.style.display = 'none';
              // Fondu de MAJ (grammaire commune) sur une VRAIE nouvelle donnée uniquement.
              if (nouveau) {
                _majFlash(elS); _majFlash(elL);
                if (elVerd) _majFlash(elVerd.querySelector('.wdg-verdict-txt'));
              }
            })
            .catch(function () { if (vivant && host.isConnected) fallback(zone, 'DMX indisponible.'); });
        }

        dessiner();
        var iv = setInterval(dessiner, 60000);
        // Le socle attend une FONCTION de nettoyage (typeof un === 'function') : rendre un objet
        // laisserait l intervalle tourner apres le demontage de la carte.
        return function () { vivant = false; try { clearInterval(iv); } catch (e) {} try { if (_ro) _ro.disconnect(); } catch (e) {} };
      },
    },
    {
      id: 'cot-devise', name: 'COT par devise', tag: 'COT', cat: 'Risque', h: 320,
      desc: 'Le positionnement CFTC d\'UNE devise : long/short en volumes réels, et la position nette.',
      aide: "<p>Le positionnement CFTC d'une devise pour une catégorie de fonds : long et short en contrats réels, la position nette, et la date du rapport (arrêté le mardi, publié le vendredi). La ligne du haut lit le donut ; la mention « agrégat calculé » signale l'USD, sur lequel la CFTC ne publie aucun contrat direct.</p><p>Les fonds à levier sont la catégorie spéculative que suivent les desks FX : leur position nette dit de quel côté penche l'argent institutionnel. La donnée est <strong>hebdomadaire et décalée</strong> de plusieurs jours : un contexte de fond, jamais un signal d'entrée.</p>",
      src: "Le rapport hebdomadaire officiel de la CFTC, daté de son mardi d'arrêté ; la fraîcheur affichée est l'âge du rapport, jamais l'heure de service, et la carte se resynchronise toutes les 30 minutes.",
      watch: "Les positions nettes extrêmes (beaucoup d'intervenants à déboucler du même côté) et les inflexions d'un rapport à l'autre, qui précèdent souvent celles des prix.",
      /* Le donut de référence, INTÉGRALEMENT reproductible ici : contrairement au DMX (pourcentages
         seuls), la source COT porte les positions ABSOLUES (longPos/shortPos en contrats, net,
         sentiment, date du rapport CFTC). Même design et mêmes garde-fous que « DMX par paire »
         (donut partagé _donutSvg/_donutEtiquettes), avec le pied à TROIS colonnes de la référence :
         short, long, position nette. */
      opts: [
        { k: 'devise', lbl: 'Devise', type: 'choix', def: 'EUR',
          choix: [['EUR', 'EUR'], ['GBP', 'GBP'], ['JPY', 'JPY'], ['CHF', 'CHF'], ['CAD', 'CAD'], ['AUD', 'AUD'], ['NZD', 'NZD'], ['USD', 'USD']] },
        /* Catégories du rapport TFF de la CFTC, servies par /api/cot?type=. Défaut Leveraged Funds
           (demande user : c'est la catégorie que suivent les desks FX, les fonds à levier étant le
           « smart money » spéculatif). Les noms de catégories sont ceux du rapport officiel : les
           traduire les rendrait introuvables pour qui connaît le COT. */
        { k: 'fonds', lbl: 'Type de fonds', type: 'choix', def: 'lev_money',
          choix: [['lev_money', 'Leveraged Funds'], ['asset_mgr', 'Asset Managers'], ['dealer', 'Dealers'],
            ['noncomm', 'Non-commerciaux'], ['other_rept', 'Autres reportables']] },
      ],
      mount: function (host, it) {
        var W = this;
        // 23/08 : verdict inséré ENTRE la légende et l'anneau (même gabarit que DMX par paire) —
        // l'embryon de verdict (sentiment coloré en 3e colonne) reste, le verdict le CHAPEAUTE.
        host.innerHTML = '<div class="wdg-dmx1">'
          + '<div class="wdg-dmx1-leg">'
          + '<span><i style="background:#ff3d00"></i>Short</span>'
          + '<span><i style="background:#00e676"></i>Long</span>'
          + '<span class="wdg-dmx1-paire"></span></div>'
          + '<div class="wdg-verdict" style="display:none"><b class="wdg-verdict-txt wdg-maj-txt"></b><span class="wdg-verdict-sous"></span></div>'
          + '<div class="wdg-dmx1-anneau"></div>'
          + '<div class="wdg-dmx1-pied">'
          + '<div class="wdg-dmx1-col"><span class="wdg-dmx1-lbl">Positions short</span><b class="wdg-dmx1-short wdg-maj-txt">--</b><span class="wdg-dmx1-sous cot-sh">&nbsp;</span></div>'
          + '<div class="wdg-dmx1-col"><span class="wdg-dmx1-lbl">Positions long</span><b class="wdg-dmx1-long wdg-maj-txt">--</b><span class="wdg-dmx1-sous cot-lg">&nbsp;</span></div>'
          + '<div class="wdg-dmx1-col"><span class="wdg-dmx1-lbl">Position nette</span><b class="cot-net wdg-maj-txt">--</b><span class="wdg-dmx1-sous cot-nk">&nbsp;</span></div>'
          + '</div></div>';
        var zone = host.querySelector('.wdg-dmx1-anneau');
        var elS = host.querySelector('.wdg-dmx1-short'), elL = host.querySelector('.wdg-dmx1-long');
        var elP = host.querySelector('.wdg-dmx1-paire'), elN = host.querySelector('.cot-net');
        var elVerd = host.querySelector('.wdg-verdict');
        var sSh = host.querySelector('.cot-sh'), sLg = host.querySelector('.cot-lg'), sNk = host.querySelector('.cot-nk');
        var vivant = true, _dern = '', _etiq = null;
        // Libelles officiels CFTC, pour l en-tete de carte. Meme table que le reglage.
        var NOMFONDS = { lev_money: 'Leveraged Funds', asset_mgr: 'Asset Managers', dealer: 'Dealers',
          noncomm: 'Non-commerciaux', other_rept: 'Autres reportables' };
        // La CFTC ne publie AUCUN contrat sur le dollar : la ligne USD servie par /api/cot est un
        // AGREGAT calcule en inversant les 7 autres devises (drapeau `derived`). On l annonce, sinon
        // le trader lirait 502K comme un chiffre du rapport officiel.
        var elNote = document.createElement('div');
        elNote.className = 'wdg-cot-note';
        host.querySelector('.wdg-dmx1').appendChild(elNote);

        // 181390 -> « 181,4K » ; les volumes CFTC se lisent en milliers, comme la référence.
        function enK(n) {
          var v = Number(n) || 0;
          return (Math.abs(v) >= 1000)
            ? (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + 'K'
            : String(Math.round(v));
        }

        function dessiner() {
          var dev = opt(it, W, 'devise') || 'EUR';
          var fonds = opt(it, W, 'fonds') || 'lev_money';
          fetch('/api/cot?type=' + encodeURIComponent(fonds))
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!vivant || !host.isConnected) return;
              var row = (d && d.currencies || []).find(function (x) { return x && x.key === dev; });
              if (!row) {
                fallback(zone, 'Pas de donnée COT pour ' + dev + '.');
                // Même trou que DMX (contre-lecture) : le fallback ne remplace que l'anneau, un
                // verdict périmé survivrait au-dessus. Vidé.
                if (elVerd) { elVerd.style.display = 'none'; elVerd.querySelector('.wdg-verdict-txt').textContent = ''; }
                return;
              }
              var tot = (Number(row.longPos) || 0) + (Number(row.shortPos) || 0);
              // Pourcentages recalculés des POSITIONS (la source arrondit les siens à l'entier).
              var pS = tot ? (Number(row.shortPos) || 0) / tot * 100 : 0;
              var pL = tot ? (Number(row.longPos) || 0) / tot * 100 : 0;
              // Date du rapport, formatée UNE fois : l'en-tête et le verdict la partagent.
              var drTxt = '';
              try { drTxt = row.reportDate ? new Date(row.reportDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : ''; } catch (e) {}
              if (elP) {
                /* La preuve de vie d'une donnée HEBDOMADAIRE est l'âge de son RAPPORT (mardi
                   CFTC, publié le vendredi : voir cette ancienneté est une information de
                   trading) — JAMAIS l'heure de service, qui ferait passer un rapport de 4 jours
                   pour du frais (règle de la grammaire commune : ts = reportDate, échelle en
                   jours). Le span .wdg-vie est retimbré par le minuteur global. */
                var tsRap = row.reportDate ? Date.parse(row.reportDate) : NaN;
                elP.innerHTML = esc(dev + ' · ' + (NOMFONDS[fonds] || fonds) + (drTxt ? ' · rapport du ' + drTxt : ''))
                  + (isFinite(tsRap) ? ' (' + _vieSpan(tsRap) + ')' : '');
              }
              // Le type de fonds entre dans la cle : changer de categorie doit re-animer l anneau.
              var cle = dev + '|' + fonds + '|' + row.longPos + '|' + row.shortPos;
              // Vraie MAJ (nouveau rapport ou changement de réglage) après un premier rendu :
              // seul cas où le fondu de la grammaire commune se joue.
              var nouveau = _dern !== '' && cle !== _dern;
              _etiq = [pS, pL, 'Short · ' + enK(row.shortPos), 'Long · ' + enK(row.longPos)];
              if (cle !== _dern || !zone.querySelector('svg')) {
                _dern = cle;
                zone.innerHTML = _donutSvg(pS, pL);
                var svg = zone.querySelector('svg');
                requestAnimationFrame(function () { requestAnimationFrame(function () {
                  if (!svg || !svg.isConnected) return;
                  svg.querySelectorAll('.wdg-dmx1-arc').forEach(function (a2) {
                    a2.style.strokeDasharray = a2.getAttribute('data-fin');
                    if (a2.hasAttribute('data-dec')) a2.style.strokeDashoffset = a2.getAttribute('data-dec');
                  });
                  svg.classList.add('est-charge');
                  _donutEtiquettes(zone, pS, pL, _etiq[2], _etiq[3]);
                  zone.classList.add('est-charge');
                }); });
              }
              elS.textContent = enK(row.shortPos);
              elL.textContent = enK(row.longPos);
              sSh.textContent = pS.toFixed(1).replace('.', ',') + '%';
              sLg.textContent = pL.toFixed(1).replace('.', ',') + '%';
              // Position nette : le verdict de la référence (sentiment coloré + net en contrats).
              // Le serveur renvoie Bullish/Bearish/Neutral (valeurs logiques) : on traduit a
              // l AFFICHAGE, comme partout dans le desk. Aucun texte produit en anglais.
              var sent = String(row.sentiment || '');
              elN.textContent = /bull/i.test(sent) ? 'Haussier' : /bear/i.test(sent) ? 'Baissier' : (sent ? 'Neutre' : '--');
              elN.style.color = /bull/i.test(sent) ? '#00e676' : /bear/i.test(sent) ? '#ff3d00' : '#ffb300';
              var net = Number(row.net) || 0;
              sNk.textContent = (net > 0 ? '+' : '') + enK(net);
              elNote.textContent = row.derived
                ? 'Agrégat calculé : la CFTC ne publie pas de contrat sur le dollar.'
                : '';
              elNote.style.display = row.derived ? '' : 'none';

              /* ── VERDICT : la phrase qui LIT le donut (l'embryon en 3e colonne restait noyé).
                 Gardes `== null` avant Number (Number(null) vaut 0 : un net ABSENT deviendrait
                 « à l'équilibre ») + tot > 0 (sans positions, pS/pL valent 0 et mentiraient).
                 Le verdict s'appuie UNIQUEMENT sur la semaine servie : /api/cot n'expose pas la
                 précédente (scrapers/cot.js ne garde que la ligne la plus récente par devise),
                 donc AUCUNE tendance multi-semaines n'est affirmée — netPrev resterait une
                 évolution SERVEUR, hors de ce lot, dont ce front ne dépend jamais. */
              var lpV = row.longPos == null ? NaN : Number(row.longPos);
              var spV = row.shortPos == null ? NaN : Number(row.shortPos);
              var netV = row.net == null ? NaN : Number(row.net);
              var v = (isFinite(lpV) && isFinite(spV) && isFinite(netV) && tot > 0)
                ? _cotVerdict(NOMFONDS[fonds] || fonds, dev, pL, netV, (netV > 0 ? '+' : '') + enK(netV), drTxt, !!row.derived)
                : null;
              if (v && elVerd) {
                elVerd.style.display = '';
                elVerd.setAttribute('data-etat', v.etat);
                elVerd.querySelector('.wdg-verdict-txt').innerHTML = v.txt;
                elVerd.querySelector('.wdg-verdict-sous').textContent = v.sous;
              } else if (elVerd) elVerd.style.display = 'none';
              /* Fondu de MAJ (grammaire commune) sur le verdict et les <b> du pied — uniquement
                 sur une vraie nouvelle donnée. Le COT ne bouge pas en intrajournalier : simuler
                 du vivant entre deux rapports serait mentir, on ne fond qu'au changement réel. */
              if (nouveau) {
                _majFlash(elS); _majFlash(elL); _majFlash(elN);
                if (elVerd) _majFlash(elVerd.querySelector('.wdg-verdict-txt'));
              }
            })
            .catch(function () { if (vivant && host.isConnected) fallback(zone, 'COT indisponible.'); });
        }

        var _ro = null;
        try {
          _ro = new ResizeObserver(function () { if (_etiq && zone.isConnected) _donutEtiquettes(zone, _etiq[0], _etiq[1], _etiq[2], _etiq[3]); });
          _ro.observe(zone);
        } catch (e) {}
        dessiner();
        // Le COT est un rapport HEBDOMADAIRE (CFTC du mardi) : un rafraîchissement de fond toutes
        // les 30 min suffit largement, il n'y a rien d'intrajournalier à suivre.
        var iv = setInterval(dessiner, 1800000);
        return function () { vivant = false; try { clearInterval(iv); } catch (e) {} try { if (_ro) _ro.disconnect(); } catch (e) {} };
      },
    },
    {
      id: 'dmx-retail', name: 'Sentiment particuliers', tag: 'DMX', cat: 'Risque', h: 340,
      desc: 'Le positionnement long/short de la foule (contrarian), par paire.',
      aide: "<p>Le positionnement long/short des particuliers sur toutes les paires servies, en barres, avec le choix de l'unité de temps et du tri. Chaque barre partage 100% entre acheteurs et vendeurs : il n'y a ni volume ni direction du prix là-dedans, seulement la foule.</p><p>La lecture est <strong>contrarienne et comparative</strong> : les paires les plus déséquilibrées sont celles où la foule est la plus exposée à un débouclage forcé. Trier par pourcentage long ou short fait remonter ces extrêmes d'un geste.</p>",
      src: "Positionnement agrégé des particuliers, en pourcentages seuls, relu toutes les 60 secondes.",
      watch: "Les paires au-delà de 65-70% dans un camp, et celles dont le déséquilibre grandit pendant que le prix va dans l'autre sens : la foule y moyenne à contre-tendance.",
      // IDENTIQUE AU DESK (23/07) : réutilise buildDMXChart(force, {wrapId, period, sort}) de charts.js
      // → mêmes barres .dmx2-row, même en-tête (boutons TF 1D/4H/1H + tri) et même légende Long/Short.
      // Le widget gère SON intervalle 60 s (le _dmxTimer du desk reste gaté sur #rtab-dmx) → cleanup.
      opts: [
        { k: 'tf', lbl: 'Unité', type: 'choix', def: 'H1', choix: [['D1', '1D'], ['H4', '4H'], ['H1', '1H']] },
        { k: 'tri', lbl: 'Tri', type: 'choix', def: 'az', choix: [['az', 'Paire (A-Z)'], ['za', 'Paire (Z-A)'], ['long_asc', 'Long % (croissant)'], ['long', 'Long % (décroissant)'], ['short_asc', 'Short % (croissant)'], ['short', 'Short % (décroissant)']] },
      ],
      mount: function (host, it) {
        var W = this;
        if (typeof buildDMXChart !== 'function') { fallback(host, 'DMX indisponible.'); return null; }
        var tf0 = opt(it, W, 'tf'), tri0 = opt(it, W, 'tri');
        var wid = HOST_ID + '-dmxw-' + uid();
        // BARRE INTERNE RETIRÉE (04/08, « enlève ceci vu qu'ils y sont dans les réglages ») : les
        // boutons d'unité (1D/4H/1H) et le tri doublonnaient les réglages du widget. Ne reste que
        // la légende Long/Short — une information, pas une commande — et le graphe gagne la place.
        host.innerHTML = '<div class="wdg-dmxwrap">'
          + '<div class="dmx-legend-bar"><span class="dmx-legend-dot dmx-legend-long-dot"></span><span class="dmx-legend-text">Long</span><span class="dmx-legend-dot dmx-legend-short-dot"></span><span class="dmx-legend-text">Short</span></div>'
          + '<div id="' + wid + '" class="dmx-table-wrap custom-scrollbar"></div></div>';
        function refresh(force) {
          try { buildDMXChart(!!force, { wrapId: wid, period: opt(it, W, 'tf'), sort: opt(it, W, 'tri') }); } catch (e) {}
        }
        refresh(false);
        var iv = setInterval(function () { if (!host.isConnected) { clearInterval(iv); return; } refresh(false); }, 60000);
        return function () { clearInterval(iv); };
      },
    },
    {
      id: 'saison', name: 'Saisonnalité',
      maj: 30 * 60 * 1000, tag: 'SAISONNALITÉ', cat: 'Macro', h: 300,   // donnee historique : le rythme sert a se reparer
      desc: "La table de performance mensuelle par année (rendements × 5 ans).",
      aide: "<p>La table mensuelle brute : cinq années de rendements par mois civil, la colonne Moy. en synthèse, la ligne du mois courant marquée ; la cellule mois courant × année courante est partielle. La ligne du haut résume ce que la saisonnalité dit du mois en cours.</p><p>La table complète la moyenne : elle montre la <strong>dispersion</strong> derrière chaque chiffre. Un mois dont les cinq années se contredisent n'a pas de saisonnalité exploitable, quelle que soit sa moyenne ; c'est cette vérification que la moyenne seule ne permet pas.</p>",
      src: "Rendements mensuels calculés sur cinq ans de clôtures réelles, cachés 6 heures côté serveur ; la paire suit le compte, ou s'épingle par carte dans les réglages.",
      watch: "La cohérence d'une ligne : des cellules du même signe sur les cinq années font un mois exploitable, une ligne bigarrée n'en fait pas.",
      // IDENTIQUE AU DESK (23/07) : même table heatmap .season-table (cellules rendues par le MÊME
      // _seasonCell global de charts.js — vert/rouge ∝ |valeur|, flèches, colonne Moy.), même badge
      // [PAIRE] ; paire du COMPTE (/api/season-pair, GET au montage + POST au changement, comme le desk).
      // « Paire » ÉPINGLE la carte. Défaut 'Compte' = comportement d'origine (la paire suit le compte et
      // la changer ici l'écrit pour tout le monde). Épinglée, la carte devient AUTONOME : changer sa paire
      // n'écrit plus côté compte — sans quoi deux cartes Saisonnalité côte à côte s'écrasent l'une l'autre.
      // 04/08 : la liste ne contenait que 9 paires écrites en dur alors que la source (_SEASON_PAIRS,
      // charts.js) en sert 28 — et elle n'était pas triée. On la dérive de la source, classée A→Z.
      opts: [{ k: 'paire', lbl: 'Paire', type: 'choix', def: '', choix: _seasonChoix() }],
      mount: function (host, it) {
        var W = this, pin = opt(it, W, 'paire');
        if (typeof _seasonCell !== 'function') { fallback(host, 'Saisonnalité indisponible.'); return null; }
        var fmt = (typeof _seasonFmtPair === 'function') ? _seasonFmtPair : function (c) { return c; };
        // 04/08 : le sélecteur de paire inline est RETIRÉ (doublon du réglage « Paire » — même cas que
        // COT et DMX) ; le badge suffit à dire quelle paire est affichée ; le choix vit dans l'engrenage.
        // 23/08 : les trois blocs `.wdg-sea-sel` qui SURVIVAIENT à ce retrait (querySelector sans
        // correspondance, recalage d'option et listener change inatteignables) sont SUPPRIMÉS —
        // code mort confirmé par la contre-lecture. La carte gagne le verdict saisonnier PARTAGÉ
        // avec la courbe, la ligne du mois courant et l'horodatage de la réponse.
        /* VERDICT RETIRÉ de la table (23/08, demande user « enlève ceci de saisonnalité ») : sur
           CE widget la table dit déjà tout, le verdict faisait doublon. Il reste sur « Rendement
           moyen par mois », où il est la lecture principale. */
        host.innerHTML = '<div class="wdg-seawrap">'
          + '<div class="dmx-header-bar"><span class="season-pair-badge wdg-sea-badge">[EUR/USD]</span><span style="flex:1"></span><span class="wdg-sea-vie"></span></div>'
          + '<div class="season-table-wrap custom-scrollbar wdg-sea-tbl wdg-maj-txt"><div class="wdg-skel"><span class="wdg-skel-l" style="width:72%"></span><span class="wdg-skel-l" style="width:88%"></span><span class="wdg-skel-l" style="width:60%"></span></div></div>';
        var badge = host.querySelector('.wdg-sea-badge'), tblWrap = host.querySelector('.wdg-sea-tbl');
        var elVie = host.querySelector('.wdg-sea-vie');
        var cur = null;
        function load(p) {
          cur = p;
          if (badge) badge.textContent = '[' + fmt(p) + ']';
          fetch('/api/seasonality?symbol=' + encodeURIComponent(p)).then(function (r) { return r.json(); }).then(function (data) {
            if (!host.isConnected || p !== cur) return;                    // réponse périmée (changement de paire)
            if (!data || !Array.isArray(data.rows) || !data.rows.length) return fallback(tblWrap, 'Aucune donnée');
            if (badge && data.symbol) badge.textContent = '[' + data.symbol + ']';
            var yrs = data.years || [];
            var moisCourant = new Date().getMonth();
            var head = '<tr><th class="season-th season-th--m"></th>' + yrs.map(function (y) { return '<th class="season-th">\'' + String(y).slice(2) + '</th>'; }).join('') + '<th class="season-th season-th--avg">Moy.</th></tr>';
            var body = data.rows.map(function (row, i) {
              /* Mois TRADUITS à l'affichage : la source sert Jan..Dec (valeurs logiques, règle du
                 desk) et les 12 lignes sont dans l'ordre civil — l'index suffit, `row.month`
                 reste le repli si la table module venait à manquer. La ligne du mois COURANT est
                 marquée (présent en or, doctrine DTP). */
              return '<tr' + (i === moisCourant ? ' class="est-courant"' : '') + '><td class="season-month">' + esc(_MOIS_FR[i] || row.month) + '</td>' + (row.vals || []).map(function (v) { return _seasonCell(v, false); }).join('') + _seasonCell(row.avg, true) + '</tr>';
            }).join('');
            var deja = !!tblWrap.querySelector('.season-table');
            tblWrap.innerHTML = '<table class="season-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
            /* La cellule mois courant × année courante est PARTIELLE (le serveur garde le cours
               du jour, pas une fin de mois). _seasonCell (helper global charts.js) ne pose aucune
               classe : le liseré vit en CSS via nth-last-child(2) — l'année courante est TOUJOURS
               la dernière colonne avant Moy. (years = N-4..N) — ici on ne pose que le title. */
            var cNow = tblWrap.querySelector('tr.est-courant td:nth-last-child(2)');
            if (cNow) cNow.title = 'Mois en cours (partiel)';
            // Changement de paire : fondu de MAJ (grammaire commune) au lieu du flash sec du
            // remplacement — jamais au premier rendu (le squelette n'est pas un « avant »).
            if (deja) _majFlash(tblWrap);
            // (Verdict retiré le 23/08, demande user : la table dit déjà tout — voir le squelette.)
            /* Fraîcheur HONNÊTE : ts de la RÉPONSE (cache 6 h serveur, repli persistant possible),
               retimbré par le minuteur global — jamais l'heure du fetch, qui mentirait. */
            if (elVie) elVie.innerHTML = _vieSpan(Date.parse((data && data.updatedAt) || '') || 0);
          }).catch(function () { if (host.isConnected && p === cur) fallback(tblWrap, 'Saisonnalité indisponible.'); });
        }
        if (pin) load(pin);
        else fetch('/api/season-pair').then(function (r) { return r.json(); }).then(function (d) {
          load((d && d.pair) ? d.pair : 'EURUSD');
        }).catch(function () { load('EURUSD'); });
        return null;
      },
    },
    {
      id: 'sessions', name: 'Sessions de marché', tag: 'MONDE', cat: 'Macro', h: 340,
      desc: 'La carte du monde des 4 grandes sessions FX, en direct.',
      aide: "<p>Les séances asiatique, européenne et américaine, avec leurs chevauchements. Le volume et la volatilité ne sont pas répartis uniformément dans la journée : ils se concentrent aux ouvertures et sur le recouvrement Londres-New York.</p><p>Le même signal n'a donc pas la même portée selon l'heure. Une cassure en séance asiatique tient moins souvent qu'une cassure à l'ouverture européenne, faute de participants pour la porter.</p>",
      src: "Carte calculée en local : horaires officiels des places et terminateur jour/nuit, remis à jour toutes les 30 secondes ; aucune donnée de marché n'y transite.",
      watch: "Les fenêtres de recouvrement, surtout Londres-New York : c'est là que se concentrent volume et volatilité ; une cassure hors de ces fenêtres a moins de participants pour la porter.",
      // IDENTIQUE AU DESK (23/07) : réplique instance-scopée de la VRAIE carte Leaflet de l'onglet MONDE
      // (sessionmap.js) — continents GeoJSON on-brand (geodata amCharts partagé), terminateur jour/nuit,
      // badges villes .lf-city (classes globales → rendu identique), halos de session, résumé d'en-tête.
      // Instance Leaflet DÉDIÉE (window._dtpLfMap reste au desk) + timers locaux → cleanup complet.
      opts: [
        // Deux affichages au choix (demande user 17/08) : la carte du monde, ou la frise des horaires
        // d'ouverture, plus lisible dans une carte basse. « Ombre nuit » ne concerne que la carte.
        { k: 'vue', lbl: 'Affichage', type: 'choix', def: 'carte',
          choix: [['carte', 'Carte du monde'], ['frise', 'Horaires des places']] },
        { k: 'nuit', lbl: 'Ombre nuit', type: 'bascule', def: true },
      ],
      mount: function (host, it) {
        var W = this;
        // La frise se calcule uniquement des fuseaux : elle n'a besoin ni de Leaflet ni du réseau,
        // donc son montage passe AVANT le garde « carte indisponible ».
        if (opt(it, W, 'vue') === 'frise') return _monterFriseSeances(host);
        if (typeof L === 'undefined') { fallback(host, 'Carte indisponible.'); return null; }
        // PASTILLE D'ÉTAT, comme sur le desk (04/08, demande user « met comme celui d'origine ») :
        // l'en-tête de la carte des sessions du desk fait précéder ce texte d'une .live-dot qui vire
        // au ROUGE marché fermé et au VERT marché ouvert. Le widget n'avait que le texte gris, qui
        // ne dit pas l'état — d'où la différence perçue.
        host.innerHTML = '<div class="wdg-mapwrap"><div class="wdg-map-head">'
          + '<span class="live-dot live-dot--small wdg-map-dot"></span>'
          + '<span class="chart-header-sub wdg-map-sub"></span></div><div class="wdg-lfmap"></div></div>';
        var el = host.querySelector('.wdg-lfmap'), sub = host.querySelector('.wdg-map-sub');
        var CITIES = [
          { name: 'Sydney', tz: 'Australia/Sydney', lon: 151.2, lat: -33.9, open: 9, close: 17 },
          { name: 'Tokyo', tz: 'Asia/Tokyo', lon: 139.7, lat: 35.7, open: 9, close: 15 },
          { name: 'Londres', tz: 'Europe/London', lon: -0.12, lat: 51.5, open: 8, close: 17 },
          { name: 'New York', tz: 'America/New_York', lon: -74.0, lat: 40.7, open: 9, close: 17 },
        ];
        function cityState(c, now) {
          var local = new Date(now.toLocaleString('en-US', { timeZone: c.tz }));
          var h = local.getHours() + local.getMinutes() / 60, dow = local.getDay();
          if (dow >= 1 && dow <= 5 && h >= c.open && h < c.close) return { open: true, soon: false, mins: Math.max(1, Math.round((c.close - h) * 60)) };
          for (var dd = 0; dd < 8; dd++) { var cand = new Date(local); cand.setDate(local.getDate() + dd); cand.setHours(c.open, 0, 0, 0); if (cand > local && cand.getDay() >= 1 && cand.getDay() <= 5) { var m = Math.max(1, Math.round((cand - local) / 60000)); return { open: false, soon: m <= 45, mins: m }; } }
          return { open: false, soon: false, mins: 0 };
        }
        function frDur(m) { var h = Math.floor(m / 60), mm = m % 60; if (h <= 0) return mm + ' min'; if (h >= 24) return Math.floor(h / 24) + ' j ' + (h % 24) + ' h'; return h + ' h' + (mm ? ' ' + (mm < 10 ? '0' + mm : mm) : ''); }
        function cityHtml(c, now, st) {
          var t = now.toLocaleTimeString('fr-FR', { timeZone: c.tz, hour: '2-digit', minute: '2-digit' });
          var cls = st.open ? 'lf-open' : (st.soon ? 'lf-closed lf-soon' : 'lf-closed');
          // Villes de l'EST (Tokyo, Sydney) : le badge ~140px est centré sur son point ; près du bord
          // droit, sa moitié droite était rognée par l'overflow de la carte (34px pour Sydney à 493px
          // de large, mesuré par l'audit). Classe dédiée → ancrage à droite dans le CSS du widget.
          if (c.lon > 100) cls += ' lf-city--w';
          return '<div class="lf-city ' + cls + '"><div class="lf-row"><span class="lf-dot"></span><b>' + t + '</b><span class="lf-name">' + c.name + '</span></div><div class="lf-sub">' + (st.open ? 'ferme dans ' + frDur(st.mins) : 'ouvre dans ' + frDur(st.mins)) + '</div></div>';
        }
        function mkIcon(c, now, st) { return L.divIcon({ className: 'lf-city-wrap', html: cityHtml(c, now, st), iconSize: [0, 0], iconAnchor: [0, 0] }); }
        // Même clip antiméridien que sessionmap.js (retire les anneaux qui croisent ±180° → pas de « smear »)
        function clipDateline(geo) {
          function crosses(ring) { var e = false, w = false; for (var i = 0; i < ring.length; i++) { if (ring[i][0] > 150) e = true; else if (ring[i][0] < -150) w = true; } return e && w; }
          var feats = [];
          (geo.features || []).forEach(function (f) {
            if (!f.geometry) return;
            var g = f.geometry, coords;
            if (g.type === 'Polygon') coords = g.coordinates.filter(function (r) { return !crosses(r); });
            else if (g.type === 'MultiPolygon') coords = g.coordinates.map(function (poly) { return poly.filter(function (r) { return !crosses(r); }); }).filter(function (poly) { return poly.length; });
            else { feats.push(f); return; }
            if (coords.length) feats.push({ type: f.type || 'Feature', properties: f.properties, geometry: { type: g.type, coordinates: coords } });
          });
          return { type: geo.type || 'FeatureCollection', features: feats };
        }
        el.style.background = 'radial-gradient(125% 105% at 55% 32%, #16181f 0%, #0b0c10 52%, #07080a 100%)';
        // minZoom 0, PAS 1 : le fitBounds monde demande ~498px de carte pour atteindre le zoom 1.
        // En dessous (carte demi-largeur de tablette : 365px, téléphone : 349px), Leaflet clampait à 1
        // et ne montrait plus que ±123° de longitude — Tokyo (139,65 E) et Sydney (151,2 E) sortaient
        // du cadre, définitivement puisque dragging est coupé. zoomSnap 0 rend le zoom fractionnaire
        // (~0,48) atteignable et les 4 sessions restent visibles à toutes les largeurs.
        var map = L.map(el, {
          center: [18, 6], zoom: 1.4, minZoom: 0, maxZoom: 7, zoomSnap: 0,
          zoomControl: false, attributionControl: false,
          worldCopyJump: false, maxBounds: [[-74, -180], [84, 180]], maxBoundsViscosity: 1.0,
          dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false,
        });
        var hasVector = false;
        try {
          if (typeof am5geodata_worldLow !== 'undefined' && am5geodata_worldLow && am5geodata_worldLow.features) {
            var gj = L.geoJSON(clipDateline(am5geodata_worldLow), { interactive: false, style: { fillColor: '#237a42', fillOpacity: 1, color: '#164d2b', weight: 0.5, opacity: 0.7 } });
            if (gj.getLayers().length > 5) { gj.addTo(map); hasVector = true; }
          }
        } catch (e) {}
        if (!hasVector) { try { L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map); } catch (e) {} }
        var nightIv = null;
        if (typeof L.terminator === 'function' && opt(it, W, 'nuit')) {
          try {
            var term = L.terminator({ fillColor: '#070b14', fillOpacity: 0.5, color: '#070b14', weight: 0, interactive: false, className: 'lf-terminator' });
            term.addTo(map);
            nightIv = setInterval(function () { try { term.setTime(new Date()); } catch (e) {} }, 60000);
          } catch (e) {}
        }
        CITIES.forEach(function (c) {
          c._halo = L.circle([c.lat, c.lon], { radius: 2200000, stroke: false, fillColor: '#00e676', fillOpacity: 0, interactive: false }).addTo(map);
          c._lfm = L.marker([c.lat, c.lon], { icon: mkIcon(c, new Date(), cityState(c, new Date())), interactive: false, keyboard: false }).addTo(map);
        });
        function refreshSessions(now) {
          var openNames = [], nextUp = null;
          CITIES.forEach(function (c) {
            var st = cityState(c, now);
            if (c._lfm) c._lfm.setIcon(mkIcon(c, now, st));
            if (c._halo) { try { c._halo.setStyle({ fillOpacity: st.open ? 0.09 : 0 }); } catch (e) {} }
            if (st.open) openNames.push(c.name);
            else if (!nextUp || st.mins < nextUp.mins) nextUp = { name: c.name, mins: st.mins };
          });
          if (sub) {
            if (openNames.length) { sub.textContent = openNames.join(' · ') + (openNames.length > 1 ? ' ouvertes' : ' ouverte'); sub.style.color = '#00e676'; }
            else if (nextUp) { sub.textContent = 'Fermé · ' + nextUp.name + ' ouvre dans ' + frDur(nextUp.mins); sub.style.color = '#8a8f98'; }
          }
          // Pastille d'état, EXACTEMENT comme l'en-tête du desk : vert marché ouvert, rouge fermé
          // (charte #00e676 / #ff3d00). Le texte seul, en gris, ne disait pas l'état.
          var pastille = host.querySelector('.wdg-map-dot');
          if (pastille) pastille.style.background = openNames.length ? '#00e676' : '#ff3d00';
        }
        refreshSessions(new Date());
        var clockIv = setInterval(function () { refreshSessions(new Date()); }, 30000);
        // Gardes anti-vue-aberrante (mêmes que sessionmap.js, bug app desktop 23/07) : jamais de fit ni de
        // mémorisation sur un conteneur pas encore posé (0×0 → zoom clampé « tout vert »), et une vue
        // au-delà de zoom ~3.5 est invalide (le monde entier tient toujours en dessous) → re-fit.
        var savedView = null, ZMAX = 3.5;
        function fit() {
          try {
            if (!el.isConnected) return;
            if (el.offsetWidth < 80 || el.offsetHeight < 80) { setTimeout(fit, 700); return; }
            map.invalidateSize();
            map.fitBounds([[-56, -168], [74, 178]], { animate: false, padding: [3, 3] });
            var z = map.getZoom();
            if (z <= ZMAX) savedView = { center: map.getCenter(), zoom: z };
          } catch (e) {}
        }
        setTimeout(fit, 250);
        setTimeout(fit, 900);
        // Le widget est REDIMENSIONNABLE (coin) → recale la taille SANS refit (vue figée, comme _dtpLfRefit)
        var ro = null;
        try {
          ro = new ResizeObserver(function () {
            try {
              map.invalidateSize();
              if (savedView && savedView.zoom <= ZMAX) map.setView(savedView.center, savedView.zoom, { animate: false });
              else fit();
            } catch (e) {}
          });
          ro.observe(el);
        } catch (e) {}
        return function () {
          clearInterval(clockIv);
          if (nightIv) clearInterval(nightIv);
          try { if (ro) ro.disconnect(); } catch (e) {}
          try { map.remove(); } catch (e) {}
        };
      },
    },
    {
      id: 'horloge', name: 'Horloge mondiale', cat: 'Macro', h: 210,
      desc: 'Les grandes places à l’heure, statut d’ouverture + météo : choisis les tiennes.',
      aide: "<p>L'heure des grandes places financières, pour situer une publication ou une prise de parole dans la journée de marché sans conversion mentale.</p><p>Utile surtout pour les décalages saisonniers : les changements d'heure ne tombent pas aux mêmes dates des deux côtés de l'Atlantique, et une réunion peut se décaler d'une heure pendant quelques semaines chaque année.</p>",
      src: "Heure calculée en local pour chaque place (fuseaux officiels, changements d'heure compris), remise à jour chaque seconde ; la météo affichée est relue périodiquement en tâche de fond.",
      watch: "Le statut ouvert/fermé de vos places à l'approche d'une publication : la même annonce n'a pas la même profondeur de marché selon les places éveillées à cette heure-là.",
      // PLACES CHOISIES PAR CARTE (04/08, demande user « on doit pouvoir modifier les horloges et
      // ajouter plein d'autres pays ») : 27 centres financiers au catalogue, classés d'ouest en est.
      // Le desk garde ses 5 places par défaut ; seule la carte de Mon Desk est configurable.
      opts: [{ k: 'villes', lbl: 'Places affichées', type: 'multi',
        def: ['LON', 'NY', 'TKY', 'DXB', 'PAR'], choix: _villesChoix() }],
      // IDENTIQUE AU DESK : réutilise le VRAI renderClocks() (app.js) — mêmes .clock-item (heure live, GMT,
      // ouvert/fermé, icône jour/nuit, météo temps réel du _weatherCache alimenté par le loop global
      // startClocks()). renderClocks(barEl) accepte désormais une cible optionnelle → on lui passe la barre
      // du widget + un tick 1 s local ; le desk garde son propre #clocks-bar intact. Layout flex-wrap
      // (.wdg-clocks-bar) → remplit n'importe quelle largeur de carte, cellules identiques. Cleanup = clear tick.
      mount: function (host, it) {
        var W = this;
        if (typeof renderClocks !== 'function') { fallback(host, 'Horloge indisponible.'); return null; }
        host.innerHTML = '<div class="wdg-clockwrap custom-scrollbar"><div class="clocks-bar wdg-clocks-bar"></div></div>';
        var bar = host.querySelector('.wdg-clocks-bar');
        // Places choisies dans les réglages → objets du catalogue. On filtre les codes inconnus
        // (une ville retirée du catalogue ne doit pas produire un trou) ; liste vide → renderClocks
        // retombe de lui-même sur les 5 places du desk.
        var codes = opt(it, W, 'villes') || [];
        var liste = codes
          .map(function (k) { return (typeof _CLOCK_BY_CODE !== 'undefined') ? _CLOCK_BY_CODE[k] : null; })
          .filter(Boolean);
        function tick() { if (!host.isConnected) return; try { renderClocks(bar, liste); } catch (e) {} }
        tick();
        // Météo : le loop global (startClocks) alimente _weatherCache en continu ; on la (re)demande si vide/périmée.
        try {
          if (typeof refreshWeather === 'function' && (typeof _weatherLastFetch === 'undefined' || Date.now() - _weatherLastFetch > 5 * 60 * 1000)) refreshWeather();
        } catch (e) {}
        var iv = setInterval(tick, 1000);
        return function () { clearInterval(iv); };
      },
    },
    {
      id: 'fil-news', name: "Fil d'actualité", cat: 'News', h: 320,
      desc: 'Les dernières news du desk, en direct.',
      aide: "<p>Le fil du desk, à l'identique : mêmes lignes, séparateurs de jour, recherche plein texte, et les propos d'un même intervenant repliés en une carte. Les sections se choisissent dans les réglages ; « Charger plus » révèle d'abord ce qui est déjà en mémoire, puis remonte l'historique du serveur.</p><p>Le fil se lit à <strong>deux vitesses</strong> : les lignes rouges (breaking, forte importance) demandent une lecture immédiate, le reste sert de contexte. Une news qui recoupe le calendrier ou un biais déjà en place vaut plus que la même news isolée.</p>",
      src: "Le flux d'actualités temps réel du desk (pastille « en direct ») : les nouvelles arrivent en continu par la même connexion que l'onglet ACTUS, la carte se resynchronise au fil de l'eau.",
      watch: "Les lignes en rouge et les grappes de propos de banquiers centraux : une audition entière se replie en une carte dont le nombre de citations dit l'intensité.",
      // `off` = sections DÉCOCHÉES, jointes par « | » (réglage caché du panneau : il est rendu par
      // une liste dédiée, pas par une pastille de choix).
      // Le pas-à-pas « Actus » a été RETIRÉ (04/08, « ça sert à rien ») : depuis le bouton
      // « Charger plus », la profondeur du fil se règle au geste, pas dans un panneau.
      opts: [
        { k: 'off', lbl: 'Sections', type: 'texte', def: '', cache: true },
      ],
      // LE PANNEAU DU DESK À L'IDENTIQUE (demande user 02/08, capture à l'appui) : barre d'outils
      // « Sections d'actualités » + recherche + compteur (classes exactes .panel-toolbar/.toolbar-select/
      // .toolbar-search/.item-count), menu de sections en cases à cocher (.section-dropdown), pastille
      // verte « en direct » déplacée dans l'en-tête de la carte, séparateurs de jour (.date-header via
      // formatDate du desk) et lignes buildNewsItem — plus une simple liste nue.
      mount: function (host, it) {
        var W = this;
        var sig = '', q = '';
        var plus = 0, chargeEnCours = false;                // items révélés en plus du réglage (bouton « Charger plus »)
        var remplissages = 0;                               // passes d'auto-complétion pour remplir la hauteur (cf. plus bas)
        // SECTIONS DÉCOCHÉES = un RÉGLAGE persisté (04/08, demande user : « enlève le bouton
        // sections, mets réglages pour choisir les sections ») — plus de menu volant dans la barre.
        var off = {};
        String(opt(it, W, 'off') || '').split('|').forEach(function (c) { if (c) off[c] = 1; });
        // BARRE ÉPURÉE : la RECHERCHE occupe toute la largeur ; le compteur et la légende des
        // marqueurs descendent EN BAS (référence user), là où on les lit sans gêner la lecture.
        host.innerHTML = '<div class="wdg-news-panel">'
          + '<div class="panel-toolbar wdg-nw-tb">'
          +   '<div class="toolbar-search wdg-nw-search"><span class="search-icon"><svg width="15" height="15" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="currentColor" opacity=".2"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20.5 20.5 16.5 16.5"/></svg></span>'
          +     '<input type="text" class="wdg-nw-q" placeholder="Rechercher une actualité…"></div>'
          + '</div>'
          // (Légende Breaking/Analyse/Priorité + compteur RETIRÉS 04/08 : les couleurs des lignes
          //  parlent d'elles-mêmes, la bande mangeait de la hauteur pour rien.)
          + '<div class="news-list wdg-news custom-scrollbar"><div class="wdg-skel"><span class="wdg-skel-l" style="width:78%"></span><span class="wdg-skel-l" style="width:64%"></span><span class="wdg-skel-l" style="width:82%"></span></div></div>'
          + '</div>';
        var liste = host.querySelector('.news-list');
        var count = null;
        // Pastille verte « Flux en direct » dans l'en-tête de la carte — comme le desk la porte dans son
        // panel-header. Pas dans le panneau à onglets : son en-tête est un calque pointer-events:none.
        var carte = host.closest ? host.closest('.wdg-card') : null;
        if (carte && !carte.classList.contains('wdg-card--tabs')) {
          var tete = carte.querySelector('.wdg-head');
          if (tete && !tete.querySelector('.live-dot')) {
            var dot = document.createElement('span');
            dot.className = 'live-dot'; dot.title = 'Flux en direct';
            var act = tete.querySelector('.wdg-actions');
            if (act) tete.insertBefore(dot, act); else tete.appendChild(dot);
          }
        }
        // (La liste des sections est construite dans le panneau de RÉGLAGES — mêmes catégories
        //  internes du desk (INTERNAL_CATS/catFr), « Bonds » toujours banni du produit.)
        var render = function (force) {
          if (!host.isConnected) return;
          var items = (typeof window.getNewsMaster === 'function') ? (window.getNewsMaster() || []) : [];
          // TRI DESC OBLIGATOIRE (bug user 04/08 : « le fil affiche le 22/07 et ne bouge pas ») :
          // allItems du desk = historique EN TÊTE + nouveautés AJOUTÉES EN QUEUE (le desk trie au
          // rendu, pas au stockage) → slice(0,nb) sur le brut donnait les 14 plus VIEUX items, et
          // les fraîches (position ~2000) n'entraient jamais dans la fenêtre. Copie triée récent→ancien.
          items = items.slice().sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
          var ql = q.trim().toLowerCase();
          var tout = items.filter(function (i) {
            if (!i) return false;
            if (i.category && off[i.category]) return false;
            return !ql || String(i.headline || '').toLowerCase().indexOf(ql) !== -1;
          });
          var cap = 25 + plus;                               // fenêtre de départ ; « Charger plus » l'étend
          var rows = tout.slice(0, cap);
          // GRAPPES DE PROPOS (13/08, « ça spam trop ») : le desk replie les citations d une même
          // personne en UNE carte (renderNews) ; ce widget rendait chaque propos en ligne pleine —
          // une audition de la Fed noyait le widget sous 10 lignes quasi identiques. Même fonction
          // que le desk, appliquée APRÈS la fenêtre et AVANT la signature de rendu.
          if (typeof window.groupSpeakerQuotes === 'function') { try { rows = window.groupSpeakerQuotes(rows); } catch (e) {} }
          if (count) count.textContent = rows.length + ' items';   // (compteur retiré — garde inoffensive)
          if (!rows.length) {
            liste.innerHTML = '<div class="empty-state" style="padding:40px 20px;text-align:center;color:var(--text4);font-size:11px;">' + (ql || Object.keys(off).length ? 'Aucun élément ne correspond.' : 'Fil en cours de chargement…') + '</div>';
            sig = ''; return;
          }
          var s = rows.map(function (i) { return i.id; }).join('|') + '§' + ql + '§' + Object.keys(off).join(',') + '§' + chargeEnCours;
          if (!force && s === sig) return;                                  // rien de neuf → pas de re-render
          sig = s;
          var _scroll = liste.scrollTop;                                    // « Charger plus » : on ne remonte pas l'utilisateur en haut
          // Séparateurs de JOUR, comme renderNews : groupes par date (formatDate du desk, heure de Paris).
          var fmtJour = (typeof formatDate === 'function') ? formatDate : function (ts) { return new Date(ts).toLocaleDateString('fr-FR'); };
          liste.innerHTML = '';
          var dernier = '';
          rows.forEach(function (i) {
            try {
              var j = i.timestamp ? fmtJour(i.timestamp) : '';
              if (j && j !== dernier) {
                var h = document.createElement('div');
                h.className = 'date-header'; h.textContent = j;
                liste.appendChild(h); dernier = j;
              }
              if (typeof window.buildNewsItem === 'function') liste.appendChild(window.buildNewsItem(i));
              else { var d2 = document.createElement('div'); d2.className = 'wdg-news-row'; d2.textContent = i.headline || ''; liste.appendChild(d2); }
            } catch (e) {}
          });
          // HISTORIQUE (04/08 : « je ne peux pas remonter l'historique comme le desk ») : même
          // mécanisme que l'onglet ACTUS — on RÉVÈLE d'abord ce qui est déjà en mémoire, puis on
          // demande les plus anciens au serveur via le loadMore() du desk (il alimente allItems,
          // que ce widget relit). Le bouton disparaît quand il n'y a plus rien à remonter.
          var reste = tout.length > rows.length;
          var srv = (typeof serverTotal === 'number' && typeof allItems !== 'undefined')
            ? (allItems.length < serverTotal) : true;
          if (reste || srv) {
            var b = document.createElement('button');
            b.className = 'load-more-btn';
            b.textContent = chargeEnCours ? 'Chargement…' : 'Charger plus';
            b.disabled = chargeEnCours;
            b.onclick = function (ev) {
              ev.stopPropagation();
              if (chargeEnCours) return;
              if (tout.length > rows.length) { plus += 25; render(true); return; }   // déjà en mémoire
              if (typeof loadMore !== 'function') return;
              chargeEnCours = true; render(true);
              Promise.resolve(loadMore()).catch(function () {}).then(function () {
                chargeEnCours = false; plus += 25; render(true);
              });
            };
            liste.appendChild(b);
          }
          // ── LE BLOC VIDE SOUS « CHARGER PLUS » (15/08, signalé par l'utilisateur) ──────────────
          // La fenêtre se compte en ITEMS BRUTS (25) mais se consomme en LIGNES AFFICHÉES : les
          // propos d'un même intervenant sont repliés en UNE carte depuis le 13/08, si bien qu'une
          // audition de banquier central vaut « +11 propos » sur une seule ligne. Vingt-cinq items
          // ne produisaient plus qu'une quinzaine de lignes, qui ne remplissaient pas le cadre : le
          // widget affichait un grand vide sous le bouton ALORS QU'IL RESTAIT des éléments à
          // montrer. On complète donc la fenêtre jusqu'à remplir la hauteur disponible.
          // Bornes : uniquement des items DÉJÀ en mémoire (aucune requête réseau ici), et au plus
          // quelques passes, pour ne pas boucler si le repliement absorbe tout ce qu'on ajoute.
          if (!chargeEnCours && tout.length > cap && liste.clientHeight > 0
              && liste.scrollHeight <= liste.clientHeight && remplissages < 6) {
            remplissages++; plus += 25; render(true); return;
          }
          remplissages = 0;
          liste.scrollTop = _scroll;
        };
        // (le menu volant « Sections d'actualités » a été RETIRÉ 04/08 : le choix vit dans les
        //  Réglages du widget, persisté — cf. _setPanelHtml + API.toggleNewsSection.)
        host.querySelector('.wdg-nw-q').addEventListener('input', function (e) { q = e.target.value; render(true); });
        render();
        var t = setInterval(render, 20000);                                 // le WS réassigne allItems → on resuit
        return function () { clearInterval(t); };
      },
    },
    {
      id: 'calculatrice', name: 'Calculatrice', cat: 'Outils', h: 280,
      desc: 'Taille de lot depuis capital, risque % et stop (pips).',
      aide: "<p>La taille de position qui respecte le risque défini, à partir du capital, du pourcentage risqué et de la distance au stop. Le résultat se recalcule à chaque frappe : il n'y a rien à valider.</p><p>Le calcul part du <strong>risque</strong>, jamais de la taille souhaitée. C'est ce qui rend deux trades comparables entre eux, quelle que soit la paire et quelle que soit la volatilité du moment.</p>",
      src: "Aucune donnée externe : un calcul local (capital × risque % ÷ stop × valeur du pip), refait à chaque frappe ; seules les valeurs de départ sont mémorisées dans les réglages.",
      watch: "La sensibilité de la taille à la distance de stop : si un élargissement raisonnable du stop rend la position dérisoire, c'est le trade qui est mal calibré, pas la calculatrice.",
      // AUTONOME (aucune dépendance au desk). Le CALCUL reste volatil (charte DTP : pas de localStorage) ;
      // seules les valeurs de DÉPART sont des réglages de carte — le compte d'un trader ne change pas tous les jours.
      opts: [
        { k: 'capital', lbl: 'Capital', type: 'nombre', def: 10000, min: 1000, max: 99000, pas: 1000 },
        { k: 'risque', lbl: 'Risque %', type: 'nombre', def: 1, min: 1, max: 10, pas: 1 },
        { k: 'pip', lbl: 'Valeur pip', type: 'nombre', def: 10, min: 1, max: 100, pas: 1 },
      ],
      mount: function (host, it) {
        var W = this;
        var f = function (lbl, val, suf) {
          return '<label class="wdg-calc-row"><span class="wdg-calc-lbl">' + lbl + '</span>'
            + '<span class="wdg-calc-in"><input type="number" inputmode="decimal" value="' + val + '" step="any" min="0">'
            + (suf ? '<em>' + suf + '</em>' : '') + '</span></label>';
        };
        host.innerHTML = '<div class="wdg-calc">'
          + f('Capital', opt(it, W, 'capital'), '$') + f('Risque', opt(it, W, 'risque'), '%')
          + f('Stop-loss', 20, 'pips') + f('Valeur du pip (1 lot)', opt(it, W, 'pip'), '$')
          + '<div class="wdg-calc-out"><div class="wdg-calc-o"><span>Risque</span><b class="wdg-calc-risk">-</b></div>'
          + '<div class="wdg-calc-o wdg-calc-o--main"><span>Taille de position</span><b class="wdg-calc-lots">-</b></div></div>'
          + '<div class="wdg-calc-note">Position = (capital × risque %) ÷ (stop × valeur du pip).</div>'
          + '</div>';
        var ins = host.querySelectorAll('input');
        var compute = function () {
          var cap = parseFloat(ins[0].value) || 0, rk = parseFloat(ins[1].value) || 0,
              sl = parseFloat(ins[2].value) || 0, pv = parseFloat(ins[3].value) || 0;
          var risk = cap * rk / 100;
          var lots = (sl > 0 && pv > 0) ? risk / (sl * pv) : 0;
          var rEl = host.querySelector('.wdg-calc-risk'), lEl = host.querySelector('.wdg-calc-lots');
          if (rEl) rEl.textContent = risk > 0 ? risk.toFixed(2) + ' $' : '-';
          if (lEl) lEl.textContent = lots > 0 ? lots.toFixed(2) + ' lot' + (lots >= 2 ? 's' : '') : '-';
        };
        ins.forEach(function (i) { i.addEventListener('input', compute); });
        compute();
        return null;
      },
    },
    {
      id: 'journal-mini', name: 'Journal de trading', cat: 'Outils', h: 300,
      desc: 'Ton journal de trading complet, dans Mon Desk.',
      aide: "<p>Vos trades consignés, avec le taux de réussite et la courbe de performance qui se construisent d'eux-mêmes. Les statistiques ne valent que ce que vaut la saisie : un journal partiel donne des chiffres flatteurs.</p><p>La lecture utile n'est pas le résultat mais la <strong>régularité</strong> : dispersion des gains et des pertes, respect du risque annoncé, écart entre le plan et l'exécution.</p>",
      src: "Vos propres trades, enregistrés sur votre compte : cette carte est le vrai Journal du desk, déplacé dans la grille, avec les mêmes colonnes, les mêmes statistiques et le même enregistrement.",
      watch: "La dérive entre le risque annoncé et le risque exécuté, et les séries de pertes rapprochées : ce sont les deux signaux qu'un journal révèle avant le compte.",
      // LE WIDGET = LE VRAI JOURNAL, À L'IDENTIQUE (24/07, demande user « tout pareil au moindre détail ») :
      // au lieu de RÉIMPLÉMENTER le journal (toujours un détail qui diverge), on RELOCALISE le VRAI panneau
      // #view-journal .panel-journal DANS le host du widget et on appelle window.loadJournalView(). C'est
      // DONC le journal réel — barre d'outils (Nouveau/Importer/Propriétés/Exporter), filtres, éditeur de
      // cellules, courbe dans le Tableau de bord, tout marche. Au démontage : on le REMET à sa place dans
      // #view-journal (marqueur de position) → la page Journal complète refonctionne. 1 seule instance à la
      // fois (2e widget Journal → message). Repli = ancienne implémentation autonome ci-dessous.
      mount: function (host) {
        if (typeof window.loadJournalView === 'function') {
          var vj = document.getElementById('view-journal');
          var jp = vj && vj.querySelector('.panel-journal');
          if (jp && jp.__wdgHosted) { fallback(host, 'Le Journal est déjà affiché dans un autre widget de ce desk.'); return null; }
          if (jp) {
            jp.__wdgHosted = true;
            var ph = document.createComment('wdg-jr-slot');
            jp.parentNode.insertBefore(ph, jp);              // mémorise la position d'origine dans #view-journal
            host.classList.add('wdg-jr-host');
            host.innerHTML = '';
            host.appendChild(jp);
            try { window.loadJournalView(); } catch (e) {}
            return function () {                              // RESTORE : le panneau retourne dans #view-journal
              try {
                jp.__wdgHosted = false;
                host.classList.remove('wdg-jr-host');
                if (ph.parentNode) ph.parentNode.replaceChild(jp, ph);
                else if (vj) vj.appendChild(jp);
              } catch (e) {}
            };
          }
        }
        // ── REPLI (loadJournalView / #view-journal indisponible) : ancienne implémentation autonome ──
        var chartId = HOST_ID + '-jreq-' + uid();
        function build(j) {
          if (!host.isConnected) return;
          var entries = (j && j.entries) || [];
          if (!entries.length) {
            host.innerHTML = '<div class="wdg-jr-empty"><div>Aucun trade enregistré.</div>'
              + '<button class="wdg-btn" type="button">Ouvrir le Journal ›</button></div>';
            var b0 = host.querySelector('button');
            if (b0) b0.addEventListener('click', function () { if (typeof activateView === 'function') activateView('journal'); });
            return;
          }
          var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
          var fmtD = function (ts) { try { var d = new Date(ts); if (!isFinite(d.getTime())) return ''; return d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2); } catch (e) { return ''; } };
          var num = function (v) { if (v == null || v === '') return null; var n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };
          var prop = function (e, rx) {                                    // repli journal importé : cherche dans e.props
            var p = e && e.props; if (!p) return null;
            for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k) && rx.test(k)) return p[k];
            return null;
          };
          var fld = function (e, k, rx) { var v = e ? e[k] : null; return (v != null && v !== '') ? v : prop(e, rx); };
          var fmtMoney = function (n) { return (n > 0 ? '+' : '') + n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' $'; };
          // P&L affiché : $ (pl) en priorité, sinon R, sinon % — même hiérarchie que les stats du desk.
          var pnlOf = function (e) {
            var v = num(e.pl); if (v != null) return { n: v, txt: fmtMoney(v) };
            v = num(e.r); if (v != null) return { n: v, txt: (v > 0 ? '+' : '') + String(Math.round(v * 100) / 100).replace('.', ',') + ' R' };
            v = num(e.pnlPct); if (v != null) return { n: v, txt: (v > 0 ? '+' : '') + String(Math.round(v * 100) / 100).replace('.', ',') + '%' };
            v = num(prop(e, /pnl|p&l|profit|gain|\$/i)); if (v != null) return { n: v, txt: fmtMoney(v) };
            return null;
          };
          var sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
          // Résultat UNIFIÉ (-1/0/1) façon desk (_jrOutcome) : R → $PNL → libellé Résultat.
          var outcome = function (e) {
            var r = num(e.r); if (r != null) return r > 0 ? 1 : r < 0 ? -1 : 0;
            var pl = num(e.pl); if (pl != null) return pl > 0 ? 1 : pl < 0 ? -1 : 0;
            var res = String(fld(e, 'result', /r[ée]sultat|result|issue|outcome/i) || '');
            if (/tp|profit|win|gagn/i.test(res)) return 1;
            if (/\bsl\b|loss|perte|perd/i.test(res)) return -1;
            if (/\bbe\b|break/i.test(res)) return 0;
            return null;
          };
          // ── STATISTIQUES PRO (en mémoire, miroir du Tableau de bord du desk) ──
          var rs = entries.map(function (e) { return num(e.r); }).filter(function (v) { return v != null; });
          var winsR = rs.filter(function (v) { return v > 0; }), lossR = rs.filter(function (v) { return v < 0; });
          var totR = sum(rs);
          var pls = entries.map(function (e) { return num(e.pl); }).filter(function (v) { return v != null; });
          var totD = sum(pls), cum = totD, cumOk = pls.length === entries.length && pls.length > 0;
          var outs = entries.map(outcome).filter(function (v) { return v != null; });
          var oW = outs.filter(function (v) { return v > 0; }).length, oL = outs.filter(function (v) { return v < 0; }).length;
          var wr = (oW + oL) ? Math.round(oW / (oW + oL) * 100) : null;
          var avgW = winsR.length ? sum(winsR) / winsR.length : 0, avgL = lossR.length ? sum(lossR) / lossR.length : 0;
          var gD = sum(pls.filter(function (v) { return v > 0; })), lD = Math.abs(sum(pls.filter(function (v) { return v < 0; })));
          var gR = sum(winsR), lR = Math.abs(sum(lossR));
          var pf = lD > 0 ? gD / lD : (lR > 0 ? gR / lR : null);
          var expR = (rs.length && (oW + oL)) ? (oW / (oW + oL)) * avgW + (oL / (oW + oL)) * avgL : null;
          var chronAll = entries.slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
          var ddInD = pls.length > 0, _cum = 0, _peak = 0, maxDD = 0;
          chronAll.forEach(function (e) { var v = ddInD ? (num(e.pl) || 0) : (num(e.r) || 0); _cum += v; if (_cum > _peak) _peak = _cum; var dd = _peak - _cum; if (dd > maxDD) maxDD = dd; });
          var _stk = 0, worst = 0;
          chronAll.forEach(function (e) { var o = outcome(e); if (o == null) return; if (o < 0) { _stk++; if (_stk > worst) worst = _stk; } else if (o > 0) _stk = 0; });
          var longN = entries.filter(function (e) { return !/sell|short|vente/i.test(String(fld(e, 'dir', /^(sens|dir(ection)?|side|type)$/i) || '')); }).length;
          var shortN = entries.length - longN;
          var rrs = entries.map(function (e) { return num(e.rr); }).filter(function (v) { return v != null && v > 0; });
          var rrAvg = rrs.length ? sum(rrs) / rrs.length : null;
          var RES = ['Profit', 'TP', 'BE', 'SL', 'Loss'], RESCOL = { Profit: '#00e676', TP: '#00cc99', BE: '#ffb300', SL: '#ff8f00', Loss: '#ff3d00' };
          var resMap = {}; RES.forEach(function (k) { resMap[k] = 0; });
          entries.forEach(function (e) {
            var res = String(fld(e, 'result', /r[ée]sultat|result|issue|outcome/i) || ''), k = null;
            if (/^tp\b|take.?profit/i.test(res)) k = 'TP'; else if (/^be\b|break.?even/i.test(res)) k = 'BE';
            else if (/^sl\b|stop.?loss/i.test(res)) k = 'SL'; else if (/loss|perte|perd/i.test(res)) k = 'Loss';
            else if (/profit|win|gagn/i.test(res)) k = 'Profit';
            if (!k) { var pp = pnlOf(e); if (pp) k = pp.n > 0 ? 'Profit' : pp.n < 0 ? 'Loss' : 'BE'; }
            if (k) resMap[k]++;
          });
          var fmtR = function (v) { return (v > 0 ? '+' : '') + (Math.round(v * 100) / 100).toString().replace('.', ','); };
          var fmtK = function (v) { var a = Math.abs(v); if (a >= 1000) return (v > 0 ? '+' : '') + (Math.round(v / 100) / 10).toString().replace('.', ',') + ' k$'; return (v > 0 ? '+' : '') + Math.round(v) + ' $'; };

          // ── COURBE : bascule %/$PNL/R/$Capital (comme le desk) ──
          var startCap = num(j && j.startCap);
          var haveField = function (getter) { return entries.some(function (e) { return getter(e) != null; }); };
          var hasPl = haveField(function (e) { return num(e.pl); }), hasRc = haveField(function (e) { return num(e.r); }), hasPct = haveField(function (e) { return num(e.pnlPct); });
          var hasCap = startCap != null && startCap > 0 && hasPl;
          var eqMode = hasCap ? 'cap' : hasPl ? 'pl' : hasRc ? 'r' : hasPct ? 'pct' : null;
          var EQ_LBL = { cap: '$ Capital', pl: '$ PNL', r: 'R cumulé', pct: '% cumulé' };
          function eqDataFor(mode) {
            var valOf = mode === 'r' ? function (e) { return num(e.r); } : mode === 'pct' ? function (e) { return num(e.pnlPct); } : function (e) { return num(e.pl); };
            var unit = mode === 'pct' ? '%' : mode === 'r' ? ' R' : ' $';
            var chron = entries.filter(function (e) { return valOf(e) != null && e.ts; }).sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
            var run = (mode === 'cap') ? startCap : 0;
            var fmtV = function (v) { return (mode === 'cap' ? '' : (v > 0 ? '+' : '')) + (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + unit; };
            var out = [];
            for (var ci = 0; ci < chron.length; ci++) { var pv = run; run += (valOf(chron[ci]) || 0); out.push({ t: chron[ci].ts, v: Math.round(run * 100) / 100, vLbl: fmtV(run), dLbl: fmtD(chron[ci].ts), varLbl: 'Variation : ' + fmtV(run - pv) }); }
            return out;
          }
          var eqData = eqMode ? eqDataFor(eqMode) : [];
          var hasCurve = eqData.length >= 2;

          // TABLEAU IDENTIQUE AU VRAI JOURNAL (24/07, demande user « toutes tes colonnes perso ») : mêmes
          // colonnes que le desk (perso du compte via j.cols, sinon les 21 par défaut), mêmes cellules
          // (chips/rings/progress/badges réutilisant les classes globales .jr-*). Scroll horizontal comme le
          // desk. Cap 100 (anti-OOM), plus récent en haut. MODIFIER = bouton « OUVRIR » IDENTIQUE au vrai
          // journal (`.jrd-open` dans la cellule Paire, révélé au survol — demande user) ; « Ouvrir le Journal »
          // ouvre la page complète pour l'édition fine par colonne.
          var visCols = _wjrColsFromStore(j && j.cols).filter(function (c) { return !c.hidden; });
          var sortedE = entries.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 100);
          var jrThead = '<tr>' + visCols.map(function (c) { return '<th class="wdg-jrt-th" style="min-width:' + (c.w || 110) + 'px">' + esc(c.label) + '</th>'; }).join('') + '</tr>';
          var jrTbody = sortedE.map(function (e) {
            return '<tr class="wdg-jrt-row" data-id="' + esc(e.id || '') + '" title="Ouvrir dans le Journal">'
              + visCols.map(function (c) { return '<td class="wdg-jrt-c jr-c--' + c.type + '">' + _wjrCell(e, c) + '</td>'; }).join('')
              + '</tr>';
          }).join('');
          var jrTable = '<div class="wdg-jrt-scroll custom-scrollbar"><table class="wdg-jrt"><thead>' + jrThead + '</thead><tbody>' + jrTbody + '</tbody></table></div>';
          var modeBtns = [['pct', hasPct], ['pl', hasPl], ['r', hasRc], ['cap', hasCap]].filter(function (x) { return x[1]; })
            .map(function (x) { return '<button data-m="' + x[0] + '"' + (x[0] === eqMode ? ' class="on"' : '') + '>' + EQ_LBL[x[0]] + '</button>'; }).join('');
          var lastV = hasCurve ? eqData[eqData.length - 1] : null;
          var qaForm = '<form class="wdg-jr-qa" hidden>'
            + '<input class="wdg-jr-qa-pair" placeholder="Paire (EUR/USD)" maxlength="16" autocomplete="off">'
            + '<select class="wdg-jr-qa-dir"><option value="BUY">Achat</option><option value="SELL">Vente</option></select>'
            + '<input class="wdg-jr-qa-pl" type="number" step="any" placeholder="P&L $" inputmode="decimal">'
            + '<select class="wdg-jr-qa-res"><option value="">Résultat…</option><option>Profit</option><option>TP</option><option>BE</option><option>SL</option><option>Loss</option></select>'
            + '<button type="submit" class="wdg-jr-qa-save">Ajouter</button>'
            + '<button type="button" class="wdg-jr-qa-del" title="Supprimer ce trade" hidden>Suppr.</button>'
            + '<button type="button" class="wdg-jr-qa-cancel" title="Annuler">✕</button></form>';
          var tradesView = '<div class="wdg-jr-tools"><button class="wdg-jr-add" type="button">+ Nouveau trade</button>'
            + '<button class="wdg-jr-open" type="button">Ouvrir le Journal ↗</button></div>' + qaForm
            + '<div class="wdg-jr-stats"><span><b>' + entries.length + '</b> trade' + (entries.length > 1 ? 's' : '') + '</span>'
            + (wr != null ? '<span>Réussite <b class="' + (wr >= 50 ? 'up' : 'down') + '">' + wr + '%</b></span>' : '')
            + (cumOk ? '<span>P&amp;L <b class="' + (cum > 0 ? 'up' : cum < 0 ? 'down' : '') + '">' + esc(fmtMoney(cum)) + '</b></span>' : '') + '</div>'
            + (hasCurve ? '<div class="wdg-jr-chartwrap"><div class="wdg-jr-chartlbl"><b class="wdg-jr-eqval">' + esc(lastV.vLbl) + '</b>'
                + (modeBtns ? '<span class="wdg-jr-eqtog">' + modeBtns + '</span>' : '') + '</div><div class="wdg-jr-chart" id="' + chartId + '"></div></div>' : '')
            + jrTable;

          // ── VUE TABLEAU DE BORD (anneaux KPI + donut + métriques clés, comme le desk) ──
          function ring(txt, col, label, sub) {
            return '<div class="wdg-jrk"><span class="wdg-jrk-circ" style="border-color:' + col + ';color:' + col + '">' + esc(txt) + '</span>'
              + '<span class="wdg-jrk-lbl">' + esc(label) + '</span>' + (sub ? '<span class="wdg-jrk-sub">' + esc(sub) + '</span>' : '') + '</div>';
          }
          var totRes = RES.reduce(function (a, k) { return a + resMap[k]; }, 0), acc = 0, stops = [];
          RES.forEach(function (k) { if (!resMap[k]) return; var f = resMap[k] / totRes; stops.push(RESCOL[k] + ' ' + (acc * 360).toFixed(1) + 'deg ' + ((acc + f) * 360).toFixed(1) + 'deg'); acc += f; });
          var donut = totRes ? '<div class="wdg-jrd-donutwrap"><div class="wdg-jrd-donut" style="background:conic-gradient(' + stops.join(',') + ')"><span class="wdg-jrd-hole"><b>' + entries.length + '</b><em>trades</em></span></div>'
            + '<div class="wdg-jrd-legend">' + RES.filter(function (k) { return resMap[k]; }).map(function (k) { return '<span><i style="background:' + RESCOL[k] + '"></i>' + k + ' <b>' + resMap[k] + '</b></span>'; }).join('') + '</div></div>' : '';
          var dashView = '<div class="wdg-jrd custom-scrollbar">'
            + '<div class="wdg-jrd-sec">Performance pilote</div>'
            + '<div class="wdg-jrk-row">'
              + (rs.length ? ring(fmtR(totR), totR >= 0 ? '#00e676' : '#ff3d00', 'Total R') : '')
              + (pls.length ? ring(fmtK(totD), totD >= 0 ? '#00e676' : '#ff3d00', 'Total $') : '')
              + ring(String(entries.length), '#e3b23a', 'Trades')
              + (wr != null ? ring(wr + '%', wr >= 50 ? '#00e676' : '#ff3d00', 'Taux de réussite', oW + ' G / ' + oL + ' P') : '')
            + '</div>'
            + (donut ? '<div class="wdg-jrd-sec">Répartition des résultats</div>' + donut : '')
            + '<div class="wdg-jrd-sec">Performance clé</div>'
            + '<div class="wdg-jrk-row">'
              + (winsR.length ? ring(fmtR(avgW), '#00e676', 'R moy. gagnant') : '')
              + (lossR.length ? ring(fmtR(avgL), '#ff3d00', 'R moy. perdant') : '')
              + ring(longN + ' / ' + shortN, '#3b82f6', 'Long / Short')
              + (rrAvg != null ? ring((Math.round(rrAvg * 100) / 100).toString().replace('.', ','), '#a78bfa', 'RR cible moyen') : '')
              + (pf != null ? ring((Math.round(pf * 100) / 100).toString().replace('.', ','), '#00e676', 'Profit factor', 'gains / pertes') : '')
              + (expR != null ? ring(fmtR(expR), '#00cc99', 'Espérance / trade', 'en R') : '')
              + (maxDD > 0 ? ring(ddInD ? fmtK(-maxDD) : fmtR(-maxDD), '#ff8f00', 'Max drawdown') : '')
              + (worst > 0 ? ring(String(worst), '#ff3d00', 'Série perdante max') : '')
            + '</div></div>';

          host.innerHTML = '<div class="wdg-jr">'
            + '<div class="wdg-jrtab"><button class="on" data-v="trades">Trades</button><button data-v="dash">Tableau de bord</button></div>'
            + '<div class="wdg-jr-view" data-view="trades">' + tradesView + '</div>'
            + '<div class="wdg-jr-view" data-view="dash" hidden>' + dashView + '</div></div>';

          host.querySelectorAll('.wdg-jrtab button').forEach(function (b) {
            b.addEventListener('click', function () {
              host.querySelectorAll('.wdg-jrtab button').forEach(function (x) { x.classList.toggle('on', x === b); });
              host.querySelectorAll('.wdg-jr-view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== b.getAttribute('data-v'); });
            });
          });
          host.querySelectorAll('.wdg-jr-eqtog button').forEach(function (b) {
            b.addEventListener('click', function () {
              var m = b.getAttribute('data-m'), data = eqDataFor(m);
              host.querySelectorAll('.wdg-jr-eqtog button').forEach(function (x) { x.classList.toggle('on', x === b); });
              var ve = host.querySelector('.wdg-jr-eqval'); if (ve && data.length) ve.textContent = data[data.length - 1].vLbl;
              if (data.length >= 2) _wdgJrEquityChart(chartId, data);
            });
          });
          if (hasCurve) requestAnimationFrame(function () { _wdgJrEquityChart(chartId, eqData); });

          // ── ACTIONS (demande user 23/07 : ajouter / MODIFIER SUR PLACE / ouvrir la page) ──
          var openDesk = function () { if (typeof activateView === 'function') activateView('journal'); };
          var ob = host.querySelector('.wdg-jr-open'); if (ob) ob.addEventListener('click', openDesk);
          var qa = host.querySelector('.wdg-jr-qa'), addBtn = host.querySelector('.wdg-jr-add');
          var saveBtn = qa && qa.querySelector('.wdg-jr-qa-save');
          var delBtn  = qa && qa.querySelector('.wdg-jr-qa-del');
          var editId = null;   // null = mode AJOUT ; sinon id du trade en cours d'édition
          // POST commun : préserve custom/cols/startCap du compte ; en cas d'échec, restaure le bouton.
          function postEntries(next, busyLbl) {
            var payload = { entries: next, custom: !!(j && j.custom) };
            if (j && j.cols) payload.cols = j.cols;
            var sc = num(j && j.startCap); if (sc != null && sc > 0) payload.startCap = sc;
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = busyLbl || '…'; }
            if (delBtn) delBtn.disabled = true;
            return fetch('/api/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
              .then(function (r) { return r.json(); }).then(function () { reload(); })
              .catch(function () { if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = editId ? 'Enregistrer' : 'Ajouter'; } if (delBtn) delBtn.disabled = false; });
          }
          function resetForm() {
            editId = null;
            if (!qa) return;
            qa.hidden = true; qa.reset();
            if (saveBtn) saveBtn.textContent = 'Ajouter';
            if (delBtn) delBtn.hidden = true;
          }
          // MODIFIER : clic sur le bouton « OUVRIR » d'une ligne (identique au vrai journal) → le formulaire
          // (le même que « + Nouveau trade ») s'ouvre PRÉ-REMPLI, le bouton devient « Enregistrer » et
          // « Suppr. » apparaît. stopPropagation : OUVRIR ne déclenche pas l'ouverture de la page (clic
          // ailleurs sur la ligne = ouvrir la page complète, conservé).
          host.querySelectorAll('.wdg-jrt-row').forEach(function (row) {
            row.addEventListener('click', function () { openDesk(); });
            var pen = row.querySelector('.jrd-open');
            if (pen && qa) pen.addEventListener('click', function (ev) {
              ev.stopPropagation();
              var id = row.getAttribute('data-id');
              var e = (j.entries || []).filter(function (x) { return String(x.id || '') === id; })[0];
              if (!e) return;
              editId = id;
              qa.querySelector('.wdg-jr-qa-pair').value = fld(e, 'pair', /paire|pair|symbol|instrument|actif/i) || '';
              var dv = String(fld(e, 'dir', /^(sens|dir(ection)?|side|type)$/i) || '');
              qa.querySelector('.wdg-jr-qa-dir').value = /sell|short|vente/i.test(dv) ? 'SELL' : 'BUY';
              var plv = num(e.pl); qa.querySelector('.wdg-jr-qa-pl').value = plv != null ? plv : '';
              var rv = String(fld(e, 'result', /r[ée]sultat|result|issue|outcome/i) || '');
              var rsel = qa.querySelector('.wdg-jr-qa-res');
              rsel.value = Array.prototype.some.call(rsel.options, function (o) { return o.value === rv; }) ? rv : '';
              if (saveBtn) saveBtn.textContent = 'Enregistrer';
              if (delBtn) { delBtn.hidden = false; delBtn.disabled = false; }
              qa.hidden = false;
              try { qa.scrollIntoView({ block: 'nearest' }); } catch (e2) {}
              var pi = qa.querySelector('.wdg-jr-qa-pair'); if (pi) pi.focus();
            });
          });
          if (addBtn && qa) {
            // + Nouveau trade : bascule le formulaire en mode AJOUT (annule un éventuel mode édition).
            addBtn.addEventListener('click', function () {
              var wasEdit = !!editId; resetForm();
              if (wasEdit || qa.hidden) { qa.hidden = false; var pi = qa.querySelector('.wdg-jr-qa-pair'); if (pi) pi.focus(); }
              else qa.hidden = true;
            });
            var cancel = qa.querySelector('.wdg-jr-qa-cancel'); if (cancel) cancel.addEventListener('click', resetForm);
            // SUPPRIMER (mode édition) : retire le trade par id → POST → reload.
            if (delBtn) delBtn.addEventListener('click', function () {
              if (!editId) return;
              var next = (j.entries || []).filter(function (x) { return String(x.id || '') !== editId; });
              postEntries(next, '…');
            });
            qa.addEventListener('submit', function (ev) {
              ev.preventDefault();
              var pairV = (qa.querySelector('.wdg-jr-qa-pair').value || '').trim().toUpperCase();
              var dirV = qa.querySelector('.wdg-jr-qa-dir').value;
              var plV = num(qa.querySelector('.wdg-jr-qa-pl').value);
              var resV = qa.querySelector('.wdg-jr-qa-res').value;
              if (editId) {
                // ÉDITION SUR PLACE : met à jour les champs natifs du trade, préserve tout le reste
                // (id, ts, r, pnlPct, rr, note, props d'un import) → le desk garde ses données fines.
                var next = (j.entries || []).map(function (x) {
                  if (String(x.id || '') !== editId) return x;
                  var u = {}; for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) u[k] = x[k];
                  u.pair = pairV.slice(0, 16); u.dir = dirV; u.pl = plV; u.result = resV;
                  return u;
                });
                postEntries(next, 'Enregistrer');
                return;
              }
              if (!pairV && plV == null && !resV) { qa.hidden = true; return; }   // rien saisi → on referme
              var e = { id: 'w' + (typeof Date !== 'undefined' ? Date.now().toString(36) : uid()) + Math.random().toString(36).slice(2, 5),
                ts: Date.now(), pair: pairV.slice(0, 16), dir: dirV, pl: plV, result: resV,
                r: null, pnlPct: null, rr: null, note: '', props: {} };
              postEntries((j.entries || []).concat([e]), 'Ajouter');
            });
          }
        }
        function reload() { skel(host); fetch('/api/journal').then(function (r) { return r.json(); }).then(build).catch(function () { fallback(host, 'Journal indisponible.'); }); }
        reload();
        return function () { try { if (typeof disposeRoot === 'function') disposeRoot(chartId); } catch (e) {} };
      },
    },
  ].concat((function () {
    /* ── WIDGETS « VUE DU DESK » (demande user 03/08 « ajoute ces widgets de ces onglets ») ──────────
       Ces vues sont des SINGLETONS (DOM à ids fixes, état de module) : les recopier divergerait vite.
       Le widget ADOPTE donc le VRAI panneau du desk — il le déplace dans sa carte (fidélité 100 % par
       construction : c'est littéralement la même vue) et le REND À SA PLACE au démontage, marquée par
       un commentaire. Une seule carte à la fois par vue — la deuxième affiche un message clair.
       Le chargement passe par window._dtpVueLoaders (charts.js) : les chargeurs sont locaux à son IIFE. */
    /* ── FICHES D'AIDE DES VUES ADOPTÉES (23/08) ──────────────────────────────────────────────
       UN SEUL endroit : le générateur compose la fiche complète (lecture propre à la vue + la
       mécanique d'adoption, commune aux sept) — sept copies collées sur les sept entrées auraient
       divergé à la première retouche, exactement comme les vues elles-mêmes. */
    var _VUE_AIDE_COMMUN = "<p>Cette carte n'est pas une copie : c'est le <strong>vrai panneau du desk</strong>, déplacé dans la carte et rendu à sa place au retrait. Mêmes données, mêmes réglages, même comportement ; une seule carte à la fois peut afficher cette vue.</p>";
    var _VUE_FICHES = {
      fxlist: {
        lire: "<p>La Liste FX du desk : chaque paire avec son cours, sa variation et ses colonnes de signaux, qui reprennent le Radar de Biais (Fondamental) et les publications des grandes banques (Recherche). La lecture de décision est la <strong>convergence</strong> : une paire dont les colonnes pointent dans le même sens vaut plus qu'un signal isolé.</p>",
        src: "Les mêmes flux que l'onglet LISTE FX : cotations relues toutes les 150 secondes, signaux issus du Radar de Biais et des publications des banques.",
        watch: "Un signal qui change de camp d'une séance à l'autre, et les paires où Fondamental et Recherche se rejoignent.",
      },
      institution: {
        lire: "<p>Le moteur de recherche des publications des grandes banques : chaque rapport porte son établissement, sa date réelle de parution et ses tags. La lecture utile est le <strong>recoupement</strong> : une vue partagée par plusieurs banques pèse plus qu'une note isolée, et une banque qui change d'avis est une information en soi.</p>",
        src: "Publications réelles des grandes banques, collectées en continu par le desk et datées de leur vraie date de parution.",
        watch: "Plusieurs banques qui convergent sur la même paire en peu de temps, et les changements d'avis d'un établissement sur sa propre position.",
      },
      analyst: {
        lire: "<p>Les rapports du desk : récaps de séance structurés par thème (titres en or), Éclairages desk avec badges ACHAT / VENTE / NEUTRE par actif, et le catalogue de recherche. Un récap se lit comme un compte rendu de séance : le bloc d'introduction donne le fil, les sections détaillent marché par marché.</p>",
        src: "Rapports et récaps produits par le desk à chaque séance, préparés à l'avance et servis depuis le cache : l'ouverture est instantanée.",
        watch: "Les badges des Éclairages desk quand ils changent d'une séance à l'autre, et les thèmes qui reviennent d'un récap au suivant : la persistance d'un sujet dit son poids.",
      },
      bias: {
        lire: "<p>L'onglet BIAIS complet : la matrice haute densité des devises et de leurs piliers, puis, au clic sur une devise, le panneau de synthèse (indicateurs à gauche, narratif et événements de la semaine à droite). La matrice se lit par <strong>contraste</strong> : deux devises aux biais opposés désignent les paires les plus nettes.</p>",
        src: "Le moteur Smart Bias du desk : confluence de quatre piliers pondérés, recalculée en continu ; le narratif de synthèse est régénéré chaque semaine.",
        watch: "Les cellules qui changent de régime d'une lecture à l'autre, et les devises dont les piliers se contredisent : leur biais est fragile.",
      },
      weekahead: {
        lire: "<p>La Semaine à Venir du desk : le profil de risque jour par jour et l'agenda éditorialisé des temps forts. Le profil est un score <strong>relatif</strong> : il compare les journées de la semaine entre elles pour dire où se concentrera l'attention, pas pour prédire l'ampleur des mouvements.</p>",
        src: "Construit à partir du calendrier économique de la semaine : chaque journée est notée d'après l'importance de ses publications.",
        watch: "Les pics de la courbe de risque et les journées qui empilent plusieurs publications fortes : ce sont elles qui règlent le tempo de la semaine.",
      },
      taux: {
        lire: "<p>L'onglet TAUX : une carte par banque centrale, avec le taux en vigueur, le scénario pricé pour la prochaine réunion et sa probabilité. La probabilité ne prédit pas la décision : elle dit ce qui est <strong>déjà dans les prix</strong>, et c'est l'écart à cette attente qui fera bouger la devise.</p>",
        src: "Pricing de marché des prochaines décisions, agrégé par le desk et rafraîchi toutes les quelques minutes ; la donnée source évolue à l'échelle de l'heure.",
        watch: "Une probabilité qui se déplace nettement après un chiffre ou un discours : le repricing d'une réunion est souvent le vrai moteur de la devise.",
      },
      bank: {
        lire: "<p>L'onglet BANQUES : les positions publiées par les grandes banques (paire, sens, entrée, objectif, stop), leurs transactions, et le graphique qui replace ces niveaux sur les cours. La lecture s'attache au <strong>flux</strong> : ouvertures, renforcements et clôtures disent où l'argent institutionnel se déplace.</p>",
        src: "Positions et transactions publiées par les grandes banques, tenues à jour par le desk ; le graphique trace entrée, objectif et stop sur de vraies bougies.",
        watch: "Les positions nouvelles et les clôtures, et plusieurs banques qui s'alignent sur la même paire : l'accumulation d'un même côté est l'information.",
      },
    };
    function _vueDesk(id, nom, tag, cat, viewId, cle, desc, extra) {
      var fiche = _VUE_FICHES[cle];
      var W = {
        id: id, name: nom, tag: tag, cat: cat, h: 340, desc: desc,
        // Fiche du volet « ? » : lecture propre à la vue + mécanique commune d'adoption.
        aide: fiche ? fiche.lire + _VUE_AIDE_COMMUN : undefined,
        src: fiche ? fiche.src : undefined,
        watch: fiche ? fiche.watch : undefined,
        opts: (extra && extra.opts) || undefined,
        mount: function (host, it) {
          var panel = document.getElementById(viewId);
          if (!panel) { fallback(host, 'Vue indisponible.'); return null; }
          if (panel.closest('.wdg-card, .wdgt-host, .wdg-vuehost')) { fallback(host, 'Cette vue est déjà affichée dans une autre carte.'); return null; }
          var marque = document.createComment('vue-' + id);
          panel.parentNode.insertBefore(marque, panel);
          var etaitCache = panel.classList.contains('hidden');
          panel.classList.remove('hidden');
          host.classList.add('wdg-vuehost');
          host.appendChild(panel);
          var stop = null, stopFiltre = null;
          try { var l = window._dtpVueLoaders && window._dtpVueLoaders[cle]; if (l) stop = l(); } catch (e) {}
          // L'adoption est EXCLUSIVE (une carte à la fois) : un filtre d'affichage posé ici et retiré
          // au démontage ne peut pas fuir vers l'onglet du desk.
          try { if (extra && extra.filtre) stopFiltre = extra.filtre(host, it, W); } catch (e) {}
          return function () {
            try { if (typeof stopFiltre === 'function') stopFiltre(); } catch (e) {}
            try { if (typeof stop === 'function') stop(); } catch (e) {}
            host.classList.remove('wdg-vuehost');
            try {
              if (etaitCache) panel.classList.add('hidden');
              marque.parentNode.insertBefore(panel, marque); marque.remove();
            } catch (e) {}
          };
        },
      };
      return W;
    }
    // ── ONGLET TAUX : réglage « Banque » (demande user 03/08) — une seule banque en pleine carte, ou
    //    toutes. Le filtre agit sur data-bank (posé par _rtcCard) et se RÉAPPLIQUE à chaque re-rendu du
    //    desk (loadTauxView réécrit la grille ~30 s) via un MutationObserver ; tout est retiré au
    //    démontage, la vue rentre au desk intacte.
    // SEMAINE À VENIR : la vue du desk embarque DEUX panneaux compagnons à droite (fil d'actualité
    // en direct + calendrier). Dans un widget on veut « juste le widget Semaine à Venir » (demande
    // user 04/08) → colonne de droite et son splitter masqués par défaut, ré-activables au réglage.
    var _waExtra = {
      opts: [{ k: 'compagnons', lbl: 'Panneaux', type: 'choix', def: 'non',
        choix: [['non', 'Semaine seule'], ['oui', 'Avec fil + calendrier']] }],
      filtre: function (host, it, W) {
        var wa3 = host.querySelector('#wa3');
        if (!wa3) return null;
        var applique = function () {
          wa3.classList.toggle('wa3--solo', (opt(it, W, 'compagnons') || 'non') === 'non');
        };
        applique();
        var mo = new MutationObserver(applique);
        mo.observe(host, { childList: true, subtree: true });
        return function () { mo.disconnect(); wa3.classList.remove('wa3--solo'); };
      },
    };
    // BANQUES : position du graphique (04/08, demande user « on doit pouvoir dans réglage mettre le
    // graphique en bas ou à côté ») — côté à côté sur une carte large, EMPILÉ dès qu'elle est
    // étroite (le graphe à 360 px minimum écrasait alors la table des transactions).
    var _bankExtra = {
      opts: [{ k: 'graphe', lbl: 'Graphique', type: 'choix', def: 'bas',
        choix: [['bas', 'En dessous'], ['cote', 'À côté']] }],
      filtre: function (host, it, W) {
        var lay = host.querySelector('.bank-layout');
        if (!lay) return null;
        var applique = function () {
          lay.classList.toggle('bank-layout--stack', (opt(it, W, 'graphe') || 'bas') === 'bas');
        };
        applique();
        var mo = new MutationObserver(applique);
        mo.observe(host, { childList: true, subtree: true });
        return function () { mo.disconnect(); lay.classList.remove('bank-layout--stack'); };
      },
    };
    var _tauxExtra = {
      // ⚠️ Les valeurs sont les DEVISES : data-bank porte b.code, qui est la devise de la banque
      // (USD/EUR/…) — avec des codes FED/ECB, aucune carte ne matchait et la carte restait vide
      // (constaté user à la première utilisation).
      // DÉFAUT = UNE SEULE BANQUE, la Fed (04/08, capture user : les 8 banques dans une carte
      // donnaient des colonnes de 60 px, illisibles). « Toutes » reste disponible dans les Réglages.
      opts: [{ k: 'banque', lbl: 'Banque', type: 'choix', def: 'USD',
        choix: [['USD', 'Fed'], ['EUR', 'BCE'], ['GBP', 'BoE'], ['JPY', 'BoJ'], ['CHF', 'SNB'], ['CAD', 'BoC'], ['AUD', 'RBA'], ['NZD', 'RBNZ'], ['all', 'Toutes']] }],
      filtre: function (host, it, W) {
        var grille = host.querySelector('#taux-grid');
        if (!grille) return null;
        var applique = function () {
          var veut = opt(it, W, 'banque') || 'all';
          grille.classList.toggle('rtc-solo', veut !== 'all');
          for (var i = 0; i < grille.children.length; i++) {
            var c = grille.children[i];
            if (!c.classList || !c.classList.contains('rtc')) continue;
            c.style.display = (veut === 'all' || c.getAttribute('data-bank') === veut) ? '' : 'none';
          }
        };
        applique();
        var mo = new MutationObserver(applique);
        mo.observe(grille, { childList: true });
        return function () {
          mo.disconnect();
          grille.classList.remove('rtc-solo');
          for (var i = 0; i < grille.children.length; i++) if (grille.children[i].style) grille.children[i].style.display = '';
        };
      },
    };
    return [
      _vueDesk('vue-fxlist', 'Liste FX', 'LISTE FX', 'Devises', 'view-fxlist', 'fxlist', "L'onglet LISTE FX du desk, à l'identique (signaux, prix, MAJ live)."),
      _vueDesk('vue-institution', 'Institutions', 'INSTITUTIONS', 'News', 'view-institution', 'institution', "L'onglet INSTITUTIONS du desk : la recherche des grandes banques."),
      _vueDesk('vue-analyst', 'Analystes', 'ANALYSTES', 'News', 'view-analyst', 'analyst', "L'onglet ANALYSTES du desk : rapports, récaps de séance, Éclairages desk."),
      _vueDesk('vue-bias', 'Onglet Biais', 'BIAIS', 'Macro', 'view-bias', 'bias', "L'onglet BIAIS complet du desk : matrice Smart Bias + synthèse."),
      _vueDesk('vue-weekahead', 'Semaine à Venir', 'SEMAINE', 'Macro', 'view-weekahead', 'weekahead', "L'onglet SEMAINE À VENIR du desk : profil de risque + agenda éditorialisé.", _waExtra),
      _vueDesk('vue-taux', 'Onglet Taux', 'TAUX', 'Macro', 'view-taux', 'taux', "L'onglet TAUX du desk : cartes par banque, pricing des décisions, temps réel.", _tauxExtra),
      _vueDesk('vue-bank', 'Banques', 'BANQUES', 'Risque', 'view-bank', 'bank', "L'onglet BANQUES du desk : positions des grandes banques + graphique.", _bankExtra),
    ];
  })()).concat([
    {
      id: 'onglets', name: 'Panneau à onglets', cat: 'Outils', h: 360,
      desc: 'Plusieurs widgets dans une seule carte, avec sa propre barre d\'onglets : comme la barre › MONDE › FORCE du desk.',
      aide: "<p>Une carte conteneur : chaque onglet héberge un widget du catalogue, ou une petite grille de plusieurs, avec la barre d'onglets du desk. Le « + » ajoute un onglet ; le renommage et le retrait vivent dans les réglages de la carte, rien ne se détruit d'un clic de trop.</p><p>Son intérêt est la <strong>densité</strong> : regrouper les cartes d'une même famille (volatilité, positionnement, macro) dans une seule emprise d'écran et basculer de l'une à l'autre sans réagencer la grille. L'onglet actif n'est pas mémorisé : chaque session repart du premier.</p>",
      src: "Aucune donnée en propre : chaque onglet embarque un widget du catalogue, qui garde sa propre source et sa propre cadence de rafraîchissement.",
      watch: "Rien ici en propre : l'information vit dans les widgets embarqués, dont les lignes de verdict restent visibles dans leurs onglets.",
      // CONTENEUR (demande user 26/07 « créer des onglets dans un layout ») : it.tabs = ids catalogue (persisté,
      // whitelist serveur). Barre = grammaire nav du desk (chevron/capitales/soulignement or). « + » ouvre la
      // bibliothèque en mode remplissage d'onglet (_pickTab). Onglet actif volatil.
      // PLUS DE ✕ AU SURVOL (demande user 02/08) : un clic de trop détruisait un onglet par accident —
      // le retrait et le renommage vivent dans les RÉGLAGES de la carte (_setPanelHtml, renameTab/removeTab).
      mount: function (host, it) {
        it = it || {};
        // 'vide' = ONGLET SANS WIDGET (03/08, demande user « juste le widget, pas l'onglet ») :
        // l'onglet garde son nom et propose « + Choisir un widget » dans son corps. Le sentinel
        // passe la whitelist serveur (_WDG_ID_RX = format kebab-case, pas d'appartenance catalogue).
        // ⚠️ PROJECTION QUI PRÉSERVE LES INDEX (06/08). C'était un `.filter()` : toute entrée
        // inconnue disparaissait de cette copie, alors que `it._tabAct` et TOUTES les API
        // (setTabOpt, removeActiveTab, _subPanelHtml, toggleMulti…) indexent le tableau PERSISTÉ.
        // Dès qu'une entrée était filtrée les deux numérotations divergeaient et on réglait ou on
        // vidait UN AUTRE ONGLET que celui affiché. Le bug existait déjà (widget retiré du
        // catalogue) ; avec le sentinel 'grille' il serait devenu systématique. On ne retire plus
        // rien : une entrée inconnue reste EN PLACE et se signale dans son corps.
        var tabs = (Array.isArray(it.tabs) ? it.tabs : []).map(String);
        var labels = Array.isArray(it.tabLabels) ? it.tabLabels.slice() : [];   // libellés personnalisés (double-clic → renommage), alignés sur tabs
        var icons  = Array.isArray(it.tabIcons)  ? it.tabIcons.slice()  : [];   // icone perso par onglet (slug -> SVG via _tabIconSvg), meme alignement
        var actIdx = Math.min((it._tabAct | 0), Math.max(0, tabs.length - 1));
        // TABLEAU, pas scalaire : un onglet composite monte plusieurs widgets, et un seul cleanup
        // mémorisé laisserait N-1 roots amCharts, cartes Leaflet et timers orphelins à CHAQUE
        // changement d'onglet — la fuite décrite en tête de ce fichier.
        var subCleans = [];
        function _libereSous() { subCleans.splice(0).forEach(function (f) { try { f(); } catch (e) {} }); }
        var bar = document.createElement('div'); bar.className = 'wdgt-bar';
        // Plus de `draggable` : le glisser natif n'existe pas au doigt et il vole le geste au
        // pointeur ailleurs. La saisie depuis l'espace vide de la barre passe par _wireGrid.
        // Retire TOUT engrenage de sous-widget encore présent (dans la carte ou dans une vue
        // adoptée qui vit temporairement ici) — évite l'empilement ET évite qu'un engrenage
        // reparte avec la vue quand elle regagne le desk.
        var _purgeSousGear = function () {
          try {
            var portee = host.closest ? (host.closest('.wdg-card') || host) : host;
            portee.querySelectorAll('.wdg-subgear').forEach(function (el) { el.remove(); });
          } catch (e) {}
        };
        var body = document.createElement('div'); body.className = 'wdgt-body';
        host.innerHTML = ''; host.classList.add('wdgt-host');
        host.appendChild(bar); host.appendChild(body);
        function mountSub() {
          _libereSous();
          // ⚠️ L'engrenage du sous-widget peut avoir été posé dans un conteneur qui SURVIT au
          // remontage (l'en-tête d'une vue adoptée, la barre d'un widget qui ne se reconstruit
          // pas) → sans ce balayage il s'empilait à chaque remontage (2, 3 engrenages, constaté
          // user). On nettoie AVANT de reconstruire, y compris hors de `body` (vue adoptée).
          _purgeSousGear();
          body.innerHTML = '';
          if (!tabs.length) { body.innerHTML = '<div class="wdg-empty">Ajoute un onglet avec le « + » ci-dessus.</div>'; return; }
          // ONGLET COMPOSITE : le corps porte une petite grille, chaque cellule se monte comme un
          // onglet simple. On purge les engrenages UNE fois avant la boucle et UNE fois après —
          // jamais dedans : _purgeSousGear balaie la CARTE ENTIÈRE et effacerait les commandes des
          // cellules déjà montées.
          if (_estGrille(it, actIdx)) {
            var g = _gridParse(_gridOf(it, actIdx));
            var gr = document.createElement('div');
            gr.className = 'wdgt-grid'; gr.setAttribute('data-d', g.code);
            body.appendChild(gr);
            g.ids.forEach(function (cid, c) {
              var cell = document.createElement('div');
              cell.className = 'wdgt-cell';
              gr.appendChild(cell);
              var wc = cid !== 'vide' && byId(cid);
              if (!wc) {
                // Cellule vide : MÊME grammaire que l'onglet vide et que les emplacements de la
                // grille du desk — cadre pointillé or, toute la zone cliquable.
                cell.innerHTML = '<div class="wdgt-vide" role="button" tabindex="0" title="Choisir un widget pour cette case">'
                  + '<span class="wdgt-fill">+<span>Choisir un widget</span></span></div>';
                var bv = cell.querySelector('.wdgt-vide');
                if (bv) {
                  bv.addEventListener('click', function () { _pickCellFor(it, actIdx, c); });
                  bv.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); _pickCellFor(it, actIdx, c); } });
                }
                return;
              }
              _monteCellule(cell, wc, actIdx, c);
            });
            _purgeSousGear();
            g.ids.forEach(function (cid, c) {
              var wc = cid !== 'vide' && byId(cid);
              if (wc) _poseCommandes(gr.children[c], wc, c);
            });
            return;
          }
          var w = tabs[actIdx] !== 'vide' && tabs[actIdx] !== 'grille' && tabs[actIdx] && byId(tabs[actIdx]);
          if (!w) {
            // ONGLET VIDE → SÉLECTEUR DE DISPOSITION (06/08). Avant, on partait directement choisir
            // UN widget ; désormais on choisit d'abord la forme de l'onglet. « 1 widget plein »
            // reprend exactement le parcours d'avant, donc rien n'est perdu pour qui va au plus court.
            // Un onglet 'grille' dont la disposition a disparu retombe ici : il se re-choisit, il ne
            // se perd pas.
            body.innerHTML = '<div class="wdgt-dispo">'
              + '<div class="wdgt-dispo-t">Disposition de cet onglet</div>'
              + '<div class="wdg-dispo-row">'
              + SUBDISPOS.map(function (d) {
                  return '<button class="wdg-dispo-card" data-code="' + d.code + '" title="' + esc(d.name) + '">'
                    + _thumb(d.cells) + '<span class="wdg-dispo-name">' + esc(d.name) + '</span></button>';
                }).join('')
              + '</div></div>';
            body.querySelectorAll('.wdg-dispo-card').forEach(function (b) {
              b.addEventListener('click', function () {
                var code = b.getAttribute('data-code');
                if (code === '1') { _pickTabFor(it, actIdx); return; }     // parcours historique, inchangé
                API.setTabDispo(_hostIdx(host), actIdx, code);
              });
            });
            return;
          }
          // NOM DU WIDGET SÉLECTIONNÉ (demande user 04/08) : dans une carte à onglets, l'en-tête
          // est un calque et son titre est masqué — le widget n'était nommé nulle part (l'onglet ne
          // porte que son TAG court : FORCE, MONDE…).
          // ⚠️ DEUX PIÈGES, corrigés ici :
          //  (1) DÉCISION PAR IDENTITÉ, pas par état du DOM : sonder le DOM juste après mount()
          //      rate les widgets qui peuplent leur corps en ASYNCHRONE. Les vues ADOPTÉES (vue-*)
          //      portent déjà leur en-tête de panneau, et Force pose son nom dans sa barre — eux
          //      seuls se passent du bandeau ; tous les autres l'ont, toujours.
          //  (2) BANDEAU HORS DU CONTENEUR DU WIDGET : plusieurs widgets réécrivent `innerHTML`
          //      après chargement (constaté user : le titre du CALENDRIER disparaissait au clic
          //      sur son onglet). Le widget reçoit donc un hôte DÉDIÉ, le bandeau vit à côté.
          _monteCellule(body, w, actIdx, null);
          // ⚠️ BALAYAGE APRÈS MONTAGE, pas seulement avant (cause mesurée des 3 engrenages empilés) :
          // une VUE ADOPTÉE n'entre dans la carte que pendant w.mount(), donc elle arrive APRÈS le
          // purge d'entrée, en RAPPORTANT l'engrenage de son passage précédent. On rebalaie ici,
          // une fois tout le monde en place, juste avant de reposer des commandes neuves.
          _purgeSousGear();
          _poseCommandes(body, w, null);
        }
        // Monte UN widget dans un conteneur — le corps de l'onglet, ou une cellule quand l'onglet est
        // composite. `c` = index de cellule (null pour un onglet simple) : il route la config et,
        // plus loin, les commandes.
        function _monteCellule(hote0, w, j, c) {
          // NOM DU WIDGET (demande user 04/08) : dans une carte à onglets, l'en-tête est un calque et
          // son titre est masqué — le widget n'était nommé nulle part (l'onglet ne porte que son TAG
          // court : FORCE, MONDE…).
          // ⚠️ DEUX PIÈGES, conservés tels quels :
          //  (1) DÉCISION PAR IDENTITÉ, pas par état du DOM : sonder le DOM juste après mount() rate
          //      les widgets qui peuplent leur corps en ASYNCHRONE. Les vues ADOPTÉES (vue-*) portent
          //      déjà leur en-tête, et Force pose son nom dans sa barre — eux seuls se passent du
          //      bandeau ; tous les autres l'ont, toujours.
          //  (2) BANDEAU HORS DU CONTENEUR DU WIDGET : plusieurs widgets réécrivent `innerHTML` après
          //      chargement (constaté user : le titre du CALENDRIER disparaissait au clic sur son
          //      onglet). Le widget reçoit donc un hôte DÉDIÉ, le bandeau vit à côté.
          var aSonTitre = (String(w.id).indexOf('vue-') === 0) || w.id === 'force-devises';
          if (!aSonTitre) {
            var sn = document.createElement('div');
            sn.className = 'wdgt-subname'; sn.textContent = w.name;
            hote0.appendChild(sn);
          }
          var hote = document.createElement('div');
          hote.className = 'wdgt-mount';
          hote0.appendChild(hote);
          // Le sous-widget reçoit SA config (it.tabCfg[j] ou [j-c]) : il lit ses réglages par opt()
          // exactement comme une carte, sans savoir qu'il vit dans un onglet ni dans une cellule.
          try { var un = w.mount(hote, _tabItem(it, j, c)); if (typeof un === 'function') subCleans.push(un); }
          catch (e) { fallback(hote, 'Widget indisponible.'); }
        }
        // ENGRENAGE ET CROIX PROPRES AU SOUS-WIDGET (04/08, demande user : « le réglage du widget doit
        // être À DROITE et non dans le widget qui contient les onglets ») : le panneau garde SES
        // réglages (gestion des onglets) ; le widget a LES SIENS, à droite de SA barre de titre.
        // La recherche de barre est confinée à `hote0` : sans ça, la première barre de la carte
        // servirait de cible pour TOUTES les cellules et les commandes s'empileraient sur la première.
        function _poseCommandes(hote0, w, c) {
          try {
            var _pi2 = _hostIdx(host);
            if (_pi2 == null || !hote0) return;
            var mnt = hote0.querySelector('.wdgt-mount') || hote0;
            // Groupe de commandes : réglages (seulement s'il en a) + RETRAIT (toujours). La croix
            // manquait sur les widgets sans réglages — Force des Devises notamment (constat user).
            var acts = document.createElement('span');
            acts.className = 'wdg-subgear wdgt-subacts';           // .wdg-subgear = cible du balayage
            /* ORDRE CANONIQUE DU CLUSTER (22/08, capture user : deux panneaux affichaient deux
               ordres differents — « pour tous les widgets met pareil ») : Réglages → Remplacer →
               Aide → Fermer, IDENTIQUE a l'en-tete de carte (l.~5180). D'abord ce qui MODIFIE le
               widget, puis l'aide, et la fermeture toujours a l'extreme droite. L'aide reste
               presente partout ; elle vise le widget par son IDENTITÉ, un sous-widget n'ayant pas
               d'index dans la disposition. */
            if (w.opts && w.opts.length) {
              var g = document.createElement('button');
              g.className = 'wdg-ico'; g.title = 'Réglages'; g.innerHTML = ICO.gear;
              g.addEventListener('click', function (ev) { ev.stopPropagation(); API.toggleSubSettings(_pi2, c); });
              acts.appendChild(g);
            }
            // REMPLACER (21/08, demande user) : le bouton existait sur l'en-tête d'une carte mais
            // PAS ici, alors qu'un panneau à onglets est justement l'endroit où l'on change le plus
            // souvent de widget. Il ouvre la bibliothèque en visant CET onglet — ou CETTE case d'un
            // onglet composite — exactement comme le parcours historique par le « + ».
            var r = document.createElement('button');
            r.className = 'wdg-ico'; r.title = 'Remplacer';
            r.innerHTML = ICO.swap;
            r.addEventListener('click', function (ev) {
              ev.stopPropagation();
              if (c == null) _pickTabFor(it, actIdx); else _pickCellFor(it, actIdx, c);
            });
            acts.appendChild(r);
            // AIDE (21/08) : presente sur TOUS les widgets — un panneau a onglets empile des
            // widgets sous des etiquettes courtes (FORCE, MONDE) qui ne disent rien de ce qu'ils
            // font, c'est la qu'on en a le plus besoin. Avant-derniere, juste avant la croix.
            var _a = document.createElement('button');
            _a.className = 'wdg-ico wdg-ico--aide';
            _a.title = 'Aide';
            _a.innerHTML = ICO.aide;
            _a.addEventListener('click', function (ev) { ev.stopPropagation(); API.aideDe(w.id); });
            acts.appendChild(_a);
            var x = document.createElement('button');
            x.className = 'wdg-ico';
            x.title = 'Retirer';
            x.innerHTML = ICO.close;
            x.addEventListener('click', function (ev) { ev.stopPropagation(); API.removeActiveTab(_pi2, c); });
            acts.appendChild(x);
            var cible = hote0.querySelector('.wdgt-subname')
              || mnt.querySelector('.panel-header .panel-header-controls')
              || mnt.querySelector('.wdg-fx-tfbar')
              || mnt.querySelector('.panel-toolbar');
            if (cible) { cible.classList.add('wdgt-hasgear'); cible.appendChild(acts); }
            else { acts.classList.add('wdg-subgear--flot'); mnt.appendChild(acts); }
          } catch (e) {}
        }
        function renderTabs() {
          // Libellé = TAG court du desk quand il existe (› MONDE › RISQUE › FORCE…, demande user 26/07
          // « exactement comme le desk ») ; le nom complet reste dans le title (infobulle).
          bar.innerHTML = tabs.map(function (id, i) {
            var estG = _estGrille(it, i);
            var w = !estG && id !== 'vide' && id !== 'grille' && byId(id);
            // Un onglet composite n'a pas UN widget : son libellé par défaut dit ce qu'il est.
            var lbl = labels[i] || (w ? w.name : (estG ? 'GRILLE' : 'Vide'));
            var ttl = w ? (w.name + ' : double-clic pour renommer')
              : (estG ? ('Onglet composite · ' + _tabCells(it, i).filter(function (x) { return x !== 'vide'; }).length + ' widget(s) : double-clic pour renommer')
                      : 'Onglet vide : choisis sa disposition dans le corps');
            var _ic = _tabIconSvg(icons[i]);
            return '<button class="wdgt-tab' + (i === actIdx ? ' on' : '') + (w || estG ? '' : ' wdgt-tab--vide') + '" data-i="' + i + '" title="' + esc(ttl) + '">'
              + '<span class="wdgt-chv">›</span>' + (_ic ? '<span class="wdgt-tico">' + _ic + '</span>' : '') + '<span class="wdgt-nm">' + esc(lbl) + '</span></button>';
          }).join('') + '<button class="wdgt-add" title="Ajouter un onglet">+</button>';
          // La rangée vient de changer de longueur : le fondu doit le savoir, sinon il annonce une
          // suite qui n'existe plus (ou se tait alors qu'il en reste).
          if (typeof bar._dtpBords === 'function') requestAnimationFrame(bar._dtpBords);
        }
        // RENOMMAGE INLINE (demande user 28/07, réparé 03/08) : le libellé devient un champ —
        // Entrée/blur valide, Échap annule, vide = retour au nom d'origine. Persisté (it.tabLabels).
        function ouvreRenommage(i) {
          var t = bar.querySelector('.wdgt-tab[data-i="' + i + '"]'); if (!t) return;
          var estG0 = _estGrille(it, i);
          var w0 = !estG0 && tabs[i] !== 'vide' && tabs[i] !== 'grille' && byId(tabs[i]);
          if (!w0 && tabs[i] !== 'vide' && !estG0) return;
          // Un onglet vide se renomme aussi, et un onglet composite encore plus : c'est le seul moyen
          // de nommer un regroupement (« Macro », « Séance US »…).
          var def0 = w0 ? w0.name : (estG0 ? 'GRILLE' : 'Vide');
          var nm = t.querySelector('.wdgt-nm'); if (!nm) return;
          var inp = document.createElement('input');
          inp.className = 'wdgt-edit'; inp.maxLength = 18; inp.value = labels[i] || def0;
          nm.replaceWith(inp); inp.focus(); inp.select();
          var done = false;
          function commit(ok) {
            if (done) return; done = true;
            if (ok) {
              var v = inp.value.trim().slice(0, 18);
              if (v && v !== def0) labels[i] = v; else labels[i] = '';
              it.tabLabels = labels.slice(); save();
              // Le volet Réglages liste aussi les onglets : s'il est ouvert, il garderait l'ancien
              // nom jusqu'au prochain rendu — on le resynchronise avec le renommage inline.
              var _pi = _hostIdx(host); if (_pi != null) _syncPanel(_pi);
            }
            renderTabs();
          }
          inp.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') commit(true); else if (ev.key === 'Escape') commit(false); });
          inp.addEventListener('blur', function () { commit(true); });
        }
        // DOUBLE-CLIC DÉTECTÉ À LA MAIN (03/08, « quand on double-clique sur le nom on doit pouvoir
        // renommer ») : le dblclick NATIF ne se formait jamais — le premier clic re-rendait la barre
        // (renderTabs) et détachait le nœud avant le second clic. On mesure donc nous-mêmes : deux
        // clics < 400 ms sur le MÊME onglet = renommage, quel que soit le re-rendu entre les deux.
        var _tapI = -1, _tapT = 0;
        bar.addEventListener('click', function (e) {
          if (e.target.closest('.wdgt-edit')) return;   // clic dans le champ de renommage → ne pas changer d'onglet
          // « + » : l'ONGLET D'ABORD, le widget ENSUITE (04/08, demande user) — on crée un onglet
          // VIDE et on l'active ; son corps porte l'invitation « + Choisir un widget » (même
          // grammaire que les emplacements de la grille). Plus de bibliothèque en plein écran
          // avant même de voir l'onglet.
          if (e.target.closest('.wdgt-add')) {
            var tt = Array.isArray(it.tabs) ? it.tabs : (it.tabs = []);
            if (tt.length >= 12) { _undoOffer('Ce panneau est plein (12 onglets).'); return; }
            tt.push('vide'); it._tabAct = tt.length - 1;
            save();
            // `tabs` est une COPIE filtrée : on la tient à jour pour pouvoir re-rendre en local
            // quand la carte n'est pas dans la grille (montage via mountInto → pas d'index).
            tabs.push('vide'); actIdx = tabs.length - 1;
            var _pi = _hostIdx(host);
            if (_pi != null) API.refresh(_pi); else { renderTabs(); mountSub(); }
            return;
          }
          var t = e.target.closest('.wdgt-tab'); if (!t) return;
          var ni = +t.getAttribute('data-i');
          var now = Date.now();
          if (ni === _tapI && now - _tapT < 400) { _tapT = 0; ouvreRenommage(ni); return; }
          _tapI = ni; _tapT = now;
          if (ni === actIdx) return;                     // déjà actif → no-op (rien à re-rendre)
          actIdx = ni; it._tabAct = actIdx;
          renderTabs(); mountSub();
          // Le panneau de réglages montre « Onglet affiché · <nom> » : s'il est ouvert, il doit
          // suivre le changement d'onglet, sinon on croit que le widget n'a pas de réglages.
          var _pi = _hostIdx(host); if (_pi != null) _syncPanel(_pi);
        });
        renderTabs(); mountSub();

        /* ══ UNE BARRE D'ONGLETS QU'ON PEUT RÉELLEMENT PARCOURIR (29/08, capture user) ═══════════
           Mesuré sur le modèle par DÉFAUT du desk, celui que tout le monde reçoit : neuf onglets
           demandent 925 px, la carte en offre 434 sur un écran de 1600. Six onglets hors champ,
           deux à trois cachés SOUS la plaque des commandes — et rien pour le dire : la barre a
           `scrollbar-width: none`, glisser dessus DÉPLACE LA CARTE (c'est la zone de saisie), et
           une molette ordinaire ne défile que verticalement. Un utilisateur à la souris ne pouvait
           tout simplement PAS atteindre les onglets 4 à 9.
           Trois manques, trois réponses, toutes fondées sur ce qui existe déjà dans le desk :
             1. LA PLACE DES COMMANDES EST MESURÉE, PAS DEVINÉE. La feuille en réservait 96 px ; la
                plaque en fait 144 (quatre icônes). D'où des onglets sous les boutons, invisibles et
                surtout INCLIQUABLES. On lit la largeur réelle et on la publie en `--wdgt-cmd` :
                une cinquième icône un jour, et la réserve suit toute seule.
             2. LA MOLETTE FAIT DÉFILER LA BARRE, comme dans toute barre d'onglets. On ne prend le
                geste que si la barre a vraiment de quoi défiler, et on laisse passer un geste
                horizontal (pavé tactile) qui fonctionne déjà.
             3. LE FONDU DE FIN DE RANGÉE, la grammaire de la navbar du desk (`nav-au-bout`),
                reprise ici aux DEUX bords : à droite il annonce la suite, à gauche il dit qu'on a
                laissé des onglets derrière soi. */
        var _cmdObs = null;
        (function _barreParcourable() {
          var carte = host.closest ? host.closest('.wdg-card') : null;
          // 1) La réserve des commandes, mesurée sur la plaque elle-même.
          var mesureCmd = function () {
            if (!carte) return;
            var tete = carte.querySelector(':scope > .wdg-head');
            var act = tete && tete.querySelector('.wdg-actions');
            if (!act || !tete) return;
            /* ⚠️ EN PIXELS CSS, PAS EN PIXELS D'ÉCRAN. Le desk s'affiche à 90 % de zoom par défaut :
               `getBoundingClientRect()` rend des pixels ÉCRAN (déjà multipliés par 0,9), que `calc()`
               relirait comme des pixels CSS — la réserve sortait 10 % trop courte et deux onglets
               restaient sous la plaque. Mon premier jet faisait exactement cette erreur, et la
               mesure au navigateur l'a montrée. `offsetWidth`/`offsetLeft` sont, eux, dans l'espace
               CSS de l'élément : les mêmes unités que la feuille.
               On mesure du bord DROIT de l'en-tête jusqu'au bord GAUCHE de la plaque : la marge que
               l'en-tête garde à droite est ainsi comptée, sans avoir à la connaître.
               `opacity: 0` au repos ne change pas la mise en page : tout ceci se lit même quand la
               plaque est invisible. */
            var w = tete.offsetWidth - act.offsetLeft;
            if (w > 0 && w < tete.offsetWidth) carte.style.setProperty('--wdgt-cmd', (w + 6) + 'px');
          };
          mesureCmd();
          requestAnimationFrame(mesureCmd);     // la plaque peut être posée juste après nous
          try {
            if (carte && typeof ResizeObserver === 'function') {
              var act0 = carte.querySelector(':scope > .wdg-head .wdg-actions');
              if (act0) { _cmdObs = new ResizeObserver(mesureCmd); _cmdObs.observe(act0); }
            }
          } catch (e) {}

          /* 2) La molette parcourt la rangée, D'UN ONGLET À LA FOIS.
             ⚠️ PAS `scrollLeft += deltaY`, et la mesure l'a prouvé : un décalage libre laisse la
             rangée s'arrêter n'importe où, et la capture du client montrait justement « TUTIONS »
             pour « INSTITUTIONS ». Le `scroll-snap` de la feuille rattrape un geste de pavé
             tactile, mais pas un défilement posé par programme. On vise donc explicitement le bord
             d'onglet suivant : la rangée s'arrête toujours sur un mot entier.
             ⚠️ `offsetLeft`, PAS `getBoundingClientRect()`. Le desk est à 90 % de zoom : les rects
             sont en pixels ÉCRAN, `scrollLeft` en pixels CSS. Les mélanger décale d'un dixième à
             chaque cran — l'erreur que je venais de faire sur la réserve des commandes. */
          var _bordSuivant = function (sens) {
            var padL = parseFloat(getComputedStyle(bar).paddingLeft) || 0;
            var max = bar.scrollWidth - bar.clientWidth, cur = bar.scrollLeft;
            /* ⚠️ ON NE RETRANCHE PAS LE PADDING, et c'est la mesure qui l'a tranché : `offsetLeft`
               et `scrollLeft` partent du MÊME bord. Le retrancher décalait chaque arrêt de 4 px et
               laissait une lichette de l'onglet précédent visible à gauche — 3,8 px mesurés, soit
               exactement le défaut qu'on venait corriger, en plus petit. Seul le premier onglet
               fait exception : son bord vaut le padding, on vise 0 pour coller au début. */
            var bords = [];
            bar.querySelectorAll('.wdgt-tab, .wdgt-add').forEach(function (t) {
              var x = t.offsetLeft;
              bords.push(x <= padL + 1 ? 0 : Math.max(0, Math.min(max, x)));
            });
            bords.sort(function (a, b) { return a - b; });
            if (sens > 0) {
              for (var i = 0; i < bords.length; i++) if (bords[i] > cur + 1) return bords[i];
              return max;
            }
            for (var j = bords.length - 1; j >= 0; j--) if (bords[j] < cur - 1) return bords[j];
            return 0;
          };
          bar.addEventListener('wheel', function (e) {
            var reste = bar.scrollWidth - bar.clientWidth;
            if (reste <= 1) return;                                  // rien à parcourir : on rend le geste à la page
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;     // geste déjà horizontal : il marche, on n'y touche pas
            e.preventDefault();
            bar.scrollLeft = _bordSuivant(e.deltaY > 0 ? 1 : -1);
          }, { passive: false });

          // 3) Le fondu aux deux bords — même règle que la navbar du desk.
          var bords = function () {
            var reste = bar.scrollWidth - bar.clientWidth;
            /* Le seuil vaut le padding de la barre, pas 2 px : au tout début, la rangée se cale
               sur le premier onglet et laisse ses 4 px de retrait derrière elle. Un fondu allumé
               pour quatre pixels annoncerait une suite qui n'existe pas. */
            bar.classList.toggle('wdgt-au-debut', bar.scrollLeft <= 6);
            bar.classList.toggle('wdgt-au-bout', reste <= 2 || bar.scrollLeft >= reste - 2);
          };
          bar.addEventListener('scroll', bords, { passive: true });
          bords(); requestAnimationFrame(bords);
          bar._dtpBords = bords;                // renderTabs() le rappelle : la rangée a changé de longueur
        })();

        return function () {
          _purgeSousGear();                     // l'engrenage ne repart pas avec une vue adoptée
          _libereSous();                        // TOUS les sous-widgets, pas seulement le dernier monté
          try { if (_cmdObs) _cmdObs.disconnect(); } catch (e) {}
        };
      },
    },
  ]);

  // Courbe de capital du widget Journal (miroir de _jrBuildEquityChart du desk) : aire dégradée OR, axes discrets,
  // tooltip riche FR (date · valeur · variation). amCharts globaux ; root disposé par le cleanup du widget.
  function _wdgJrEquityChart(id, data) {
    var el = document.getElementById(id);
    if (!el || typeof am5 === 'undefined' || typeof am5xy === 'undefined') return;
    try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {}
    var root = _dtpAncreGraphe(am5.Root.new(id));
    try { root.setThemes([typeof am5themes_Animated !== 'undefined' ? am5themes_Animated.new(root) : null].filter(Boolean)); } catch (e) {}
    if (root._logo) root._logo.set('forceHidden', true);
    var chart = root.container.children.push(am5xy.XYChart.new(root, { panX: false, panY: false, wheelX: 'none', wheelY: 'none', paddingLeft: 0, paddingRight: 2, paddingTop: 6, paddingBottom: 2 }));
    var xr = am5xy.AxisRendererX.new(root, { minGridDistance: 62 });
    xr.grid.template.setAll({ stroke: am5.color(0x2b2b31), strokeOpacity: 0.16, strokeDasharray: [2, 4] });
    xr.labels.template.setAll({ fill: am5.color(0x6b7280), fontSize: 9 });
    var xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, { baseInterval: { timeUnit: 'day', count: 1 }, renderer: xr, extraMin: 0, extraMax: 0 }));
    xAxis.set('dateFormats', { day: 'dd MMM', week: 'dd MMM', month: 'MMM yy' });
    xAxis.set('periodChangeDateFormats', { day: 'dd MMM', month: 'MMM yy' });
    var yr = am5xy.AxisRendererY.new(root, { opposite: true, minWidth: 44 });
    yr.grid.template.setAll({ stroke: am5.color(0x2b2b31), strokeOpacity: 0.16, strokeDasharray: [2, 4] });
    yr.labels.template.setAll({ fill: am5.color(0x94a3b8), fontSize: 8.5 });
    yr.labels.template.adapters.add('text', function (t) { return t == null ? t : String(t).replace('.', ','); });
    var yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { renderer: yr, maxDeviation: 0.12 }));
    var z = yAxis.createAxisRange(yAxis.makeDataItem({ value: 0 }));
    z.get('grid').setAll({ stroke: am5.color(0xffffff), strokeOpacity: 0.28, strokeWidth: 1 });
    if (z.get('label')) z.get('label').set('visible', false);
    var tip = am5.Tooltip.new(root, { getFillFromSprite: false, autoTextColor: false, labelText: '[#8a8a92 fontSize:9.5px]{dLbl}[/]\n[bold #e3b23a fontSize:13px]{vLbl}[/]\n[#9aa0aa fontSize:9.5px]{varLbl}[/]' });
    tip.get('background').setAll({ fill: am5.color(0x141417), stroke: am5.color(0x33333a), strokeWidth: 1, fillOpacity: 0.98, cornerRadius: 6 });
    if (tip.label) tip.label.setAll({ fill: am5.color(0xe6e6ea), paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8 });
    var series = chart.series.push(am5xy.LineSeries.new(root, { xAxis: xAxis, yAxis: yAxis, valueXField: 't', valueYField: 'v', stroke: am5.color(0xe3b23a), fill: am5.color(0xe3b23a), tooltip: tip }));
    series.strokes.template.setAll({ strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' });
    series.fills.template.setAll({ visible: true, fillGradient: am5.LinearGradient.new(root, { rotation: 90, stops: [{ color: am5.color(0xe3b23a), opacity: 0.40 }, { color: am5.color(0xcfa233), opacity: 0.10 }, { color: am5.color(0xe3b23a), opacity: 0 }] }) });
    series.data.setAll(data);
    var cursor = chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none', xAxis: xAxis, yAxis: yAxis, snapToSeries: [series] }));
    cursor.lineX.setAll({ stroke: am5.color(0xe3b23a), strokeOpacity: 0.5, strokeWidth: 1, strokeDasharray: [2, 3] });
    cursor.lineY.set('visible', false);
    series.appear(600); chart.appear(600, 60);
  }

  function byId(id) { for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i]; return null; }

  /* ── PRESET proposé au premier lancement ──
     DESK_V = version de la COMPOSITION du layout par défaut. À BUMPER dès qu'on change les items de
     « Vue générale » : sans ça, les comptes qui ont déjà un cfg enregistré gardent l'ANCIENNE composition
     pour toujours (ensureDefaultLayout ne recomposait pas un layout existant) — c'est ce qui a privé le
     desk de sa barre d'onglets après l'ajout du widget « Panneau à onglets » (constaté user 26/07). */
  var DESK_V = 5;   // v5 (03/08) : nav COMPLÈTE à gauche (9 onglets, vues du desk adoptées). v3 : horloge 4 rangées (~16 %), onglets 22
  // COMPOSITION DU DESK, ÉCRITE UNE SEULE FOIS. Le layout par défaut « Vue générale » ET le modèle prêt
  // de la bibliothèque la lisent tous les deux ici : c'est ce qui garantit que le modèle est une
  // reproduction IDENTIQUE du desk de base (demande user), et non une copie qui divergerait au premier
  // changement. Copie fraîche à chaque appel — sinon les deux partageraient les mêmes objets et
  // redimensionner l'un modifierait l'autre.
  function _itemsDeskDefaut() {
    // PROPORTIONS DU DESK RÉEL, mesurées sur capture (demande user 02/08 « les mêmes dimensions que la
    // base, tout à l'identique ») : gauche pleine hauteur (50 %), à droite l'horloge occupe ~16 %
    // de la hauteur (143 px sur 895) et le panneau à onglets tout le reste. Sur 26 rangées : 4 et 22.
    // v5 (03/08, demande user « ajoute ces widgets de ces onglets et met à jour le template comme
    // l'original ») : la GAUCHE reprend LA BARRE DE NAVIGATION COMPLÈTE du desk — les 9 onglets, dans
    // l'ordre. ACTUS et CALENDRIER = leurs widgets-panneaux (déjà identiques au desk) ; les 7 autres =
    // widgets « vue du desk » (adoption du vrai panneau, fidélité 100 % par construction).
    return [
      { w: 'onglets', gw: 6, gh: 26,
        tabs: ['fil-news', 'calendrier-jour', 'vue-fxlist', 'vue-institution', 'vue-analyst', 'vue-bias', 'vue-weekahead', 'vue-taux', 'vue-bank'],
        tabLabels: ['ACTUS', 'CALENDRIER', 'LISTE FX', 'INSTITUTIONS', 'ANALYSTES', 'BIAIS', 'SEMAINE À VENIR', 'TAUX', 'BANQUES'] },
      /* 5 rangées et non 4 (02/09, capture user : « on voit même pas toutes les informations de
         l'horloge mondiale »). Une cellule d'horloge porte cinq lignes — date, heure, fuseau+ville,
         pays+météo, jour/nuit+vent. Sur 4 rangées de grille, la carte tombait juste sous ce qu'il
         faut : le contenu passait en mode compact et la météo cédait, sur le modèle par DÉFAUT,
         c'est-à-dire pour tout le monde. Une rangée de plus, prise sur le panneau à onglets qui en
         a vingt-deux, et l'horloge s'affiche entière sans rien compacter. Le total reste 26. */
      { w: 'horloge', gw: 6, gh: 5 },
      { w: 'onglets', gw: 6, gh: 21, tabs: ['sessions', 'risque-jauge', 'force-devises', 'barometre', 'cot-inst', 'dmx-retail', 'saison'] },
    ];
  }
  function defaultCfg() {
    return {
      active: 'mon-desk',
      gap: 'tight',                                    // densité : 'tight' = COLLÉS (défaut, demande user 26/07) / 'loose' = espacés
      gapV: 2,                                         // version de la préférence densité (migration one-shot loose→tight)
      deskV: DESK_V,                                   // version de la COMPOSITION du layout par défaut (migration one-shot)
      tipSeen: 0,                                      // astuce gestes (bord droit / coin / ⠿) pas encore fermée
      // Le nom du layout ne doit PAS reprendre celui du panneau : l'en-tête affichait
      // « Mon Desk · Mon Desk · BÊTA » (constaté au banc d'essai).
      // DÉFAUT = LE DESK CLASSIQUE COMPLET (demande user 26/07 « il manque les onglets ») : fil d'actualité à
      // gauche ; à droite l'horloge + le PANNEAU À ONGLETS reprenant les 7 onglets du desk
      // (MONDE · RISQUE · FORCE · BAROMÈTRE · COT · DMX · SAISONNALITÉ).
      layouts: [{ id: 'mon-desk', name: 'Vue générale', fav: true, items: _itemsDeskDefaut() }],
    };
  }

  /* ── PERSISTANCE PAR COMPTE ── */
  // « Vue générale » = LE MODÈLE PAR DÉFAUT, NON SUPPRIMABLE (dernière consigne user 26/07 : « le modèle qu'on
  // a ici c'est un par défaut non supprimable ») : toujours présent, cadenas au gestionnaire. Le « partir de 0 »
  // passe par « + Créer un layout » → « Libre » (desk vide guidé).
  var PROTECTED_ID = 'mon-desk';
  function ensureDefaultLayout(c) {
    if (!c || !Array.isArray(c.layouts)) return c;
    if (!c.layouts.some(function (l) { return l && l.id === PROTECTED_ID; })) {
      c.layouts.unshift(JSON.parse(JSON.stringify(defaultCfg().layouts[0])));
      c.layouts[0].fav = false;                       // ne vole jamais l'étoile d'un template choisi par le user
    }
    if (c.gap !== 'tight' && c.gap !== 'loose') c.gap = 'tight';   // migration : cfg antérieurs sans densité → COLLÉS (défaut)
    // ONE-SHOT (gapV 2) : le tout premier déploiement avait écrit 'loose' partout sans choix utilisateur →
    // on bascule ces comptes sur le nouveau défaut 'tight' UNE fois ; ensuite le choix de l'utilisateur fait foi.
    if (c.gapV !== 2) { if (c.gap === 'loose') c.gap = 'tight'; c.gapV = 2; }
    // MIGRATION ONE-SHOT de la COMPOSITION du layout par défaut : « Vue générale » doit refléter le desk
    // classique (fil d'actualité + horloge + barre d'onglets). Un compte créé avant l'ajout du panneau à
    // onglets gardait sa vieille composition, donc PAS de barre de nav (demande user 26/07 « ajoute la nav
    // barre ici comme dans le desk de base »). On ne recompose QUE le layout protégé et UNE seule fois —
    // les layouts personnels et les modifications ultérieures de celui-ci ne sont plus jamais touchés.
    if (c.deskV !== DESK_V) {
      var _ref = defaultCfg().layouts[0];
      for (var _i = 0; _i < c.layouts.length; _i++) {
        var _l = c.layouts[_i];
        if (_l && _l.id === PROTECTED_ID) { _l.items = JSON.parse(JSON.stringify(_ref.items)); break; }
      }
      c.deskV = DESK_V;
      c.__migrated = 1;      // → load() SAUVEGARDE : sans ça deskV ne serait jamais persisté et la
                             //   recomposition se rejouerait à CHAQUE ouverture, écrasant les réglages.
    }
    // ONE-SHOT (demande user 03/08 « met vue d'ensemble par défaut ») : la Vue générale devient
    // l'onglet ACTIF, une seule fois — ensuite le choix de l'utilisateur fait foi. Le marqueur actV
    // est repris par le sanitizer serveur (sinon il serait détruit au save et la migration
    // écraserait le desk actif à chaque chargement).
    if (c.actV !== 2) {
      if (c.layouts.some(function (l) { return l && l.id === PROTECTED_ID; })) c.active = PROTECTED_ID;
      c.actV = 2; c.__migrated = 1;
    }
    if (c.tipSeen !== 1) c.tipSeen = 0;                            // migration : astuce gestes
    c.layouts.forEach(function (l) { if (l) l.hidden = !!l.hidden; });          // migration : état masqué (fermé)
    if (c.layouts.length && c.layouts.every(function (l) { return l.hidden; })) c.layouts[0].hidden = false;   // jamais 0 onglet visible
    return c;
  }
  function load() {
    return fetch('/api/widgets').then(function (r) { return r.json(); }).then(function (j) {
      STATE.cfg = ensureDefaultLayout((j && j.cfg && j.cfg.layouts && j.cfg.layouts.length) ? j.cfg : defaultCfg());
      STATE.loaded = true;                 // la config VIENT du serveur (même vide : un compte neuf n'a rien) → écriture autorisée
      if (STATE.cfg.__migrated) { delete STATE.cfg.__migrated; save(); }   // fige la migration (voir ensureDefaultLayout)
    }).catch(function () {
      // ÉCHEC DE LECTURE (500/502/coupure) : on affiche un desk de secours, mais on N'ÉCRIT PLUS.
      // Sans ce verrou, la première interaction sauvegardait ce défaut PAR-DESSUS les vrais layouts
      // du compte : l'utilisateur perdait tout son travail à cause d'un simple hoquet réseau.
      STATE.cfg = defaultCfg();
      STATE.loaded = false;
      _readOnlyWarn();
    });
  }
  var _roShown = false;
  function _readOnlyWarn() {
    if (_roShown) return; _roShown = true;
    var b = document.createElement('div');
    b.className = 'wdg-undo wdg-undo--warn';
    b.innerHTML = '<span>Desk non chargé : modifications non enregistrées. Recharge la page.</span>'
      + '<button class="wdg-undo-b" onclick="location.reload()">Recharger</button>';
    document.body.appendChild(b);
  }
  function save() {                        // débouncé ; le serveur re-sanitise de toute façon
    if (!STATE.loaded) return _readOnlyWarn();     // config de secours : l'écrire écraserait les vrais layouts
    // Horodatage de la disposition MODIFIÉE — affiché sur sa carte d'accueil. On ne tamponne que
    // l'active : toucher un widget ne doit pas rajeunir les autres desks.
    try { var _la = activeLayout(); if (_la) _la.maj = Date.now(); } catch (e) {}
    clearTimeout(STATE.saveT);
    STATE.saveT = setTimeout(_flush, 700);
  }
  // Écriture réelle. Extraite du débounce pour pouvoir la FORCER au départ de la page : sans ça, une
  // modification suivie d'un Ctrl+F5 dans la seconde était perdue (le minuteur de 700 ms mourait avec la page).
  function _flush() {
    if (!STATE.loaded || !STATE.cfg) return;
    clearTimeout(STATE.saveT); STATE.saveT = null;
    fetch('/api/widgets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(STATE.cfg), keepalive: true,
    }).catch(function () {});
  }
  // pagehide couvre la fermeture d'onglet et la navigation ; visibilitychange couvre le passage en arrière-plan
  // (seul événement fiable sur iOS). keepalive laisse la requête partir même si la page disparaît.
  window.addEventListener('pagehide', function () { if (STATE.saveT) _flush(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && STATE.saveT) _flush(); });
  function activeLayout() {
    var c = STATE.cfg; if (!c) return null;
    for (var i = 0; i < c.layouts.length; i++) if (c.layouts[i].id === c.active) return c.layouts[i];
    return c.layouts[0] || null;
  }

  /* ── GRILLE ── */
  function unmountAll() {
    STATE.mounted.forEach(function (fn) { try { if (typeof fn === 'function') fn(); } catch (e) {} });
    STATE.mounted = [];
  }

  /* ── AGENCEMENT SMART : glisser-déposer (réordonner) + poignée de redimensionnement (hauteur) ──
     Tout en DÉLÉGATION sur l'hôte #wdg-grid (qui persiste entre les renderGrid) → câblé UNE fois.
     Le drag part de la POIGNÉE (⠿) du header pour ne jamais gêner le contenu du widget ; le resize
     part de la poignée basse. On persiste (save) et on re-rend pour remonter proprement les charts. */
  function _reorderBefore(from, before) {
    var l = activeLayout(); if (!l) return;
    from = from | 0; before = before | 0;
    if (from < 0 || from >= l.items.length) return;
    var it = l.items.splice(from, 1)[0];
    if (from < before) before--;                                  // le retrait a décalé les indices suivants
    before = Math.max(0, Math.min(l.items.length, before));
    l.items.splice(before, 0, it);
    save(); renderGrid();
  }
  function _wireGrid(host) {
    if (!host || host._wdgWired) return; host._wdgWired = true;
    var rz = null;
    /* ══ DÉPLACER UNE CARTE — AU DOIGT AUSSI (29/08) ═══════════════════════════════════════════════
       DÉPLACEMENT SANS POIGNÉE (04/08, demande user « ça doit se faire sans avoir besoin de
       l'icône ») : on saisit l'EN-TÊTE de la carte — sa zone neutre, pas les boutons, pas les
       onglets, qui gardent leurs propres gestes. Ou, pour un panneau à onglets dont l'en-tête est un
       calque non cliquable, l'espace vide de sa barre d'onglets.

       Ça reposait sur le glisser-déposer HTML5, qui n'existe pas au toucher. Mesuré : doigt posé sur
       l'en-tête puis glissé de 260 px → pointerdown, pointermove, pointercancel, AUCUN dragstart,
       aucun déplacement, et la page a défilé de 136 px à la place.
       ⚠️ ET C'EST SOUS 560 px QUE ÇA COMPTE LE PLUS : la grille y passe à UNE colonne, donc l'ordre
       des cartes EST toute la disposition. Il n'existait aucun repli — le panneau de réglages offre
       Actualiser / Remplacer / Dupliquer / Plein écran / Verrouiller, ni « monter » ni « descendre »,
       et la poignée ⠿ a été retirée le 04/08. Sur téléphone, on ne pouvait donc pas réarranger son
       desk du tout.

       APPUI LONG, et pas un glissement immédiat : l'en-tête est aussi ce qu'on touche pour faire
       défiler le desk. On attend 450 ms d'insistance, et pendant le déplacement seulement, un
       `touchmove` non passif refuse le défilement. Le reste du temps, le desk défile normalement. */
    _glisserPourReordonner(host, '.wdg-head, .wdgt-bar', '.wdg-card', 'data-idx', _reorderBefore, {
      appuiLong: 450,
      exclus: '.wdg-ico, .wdgt-tab, .wdgt-add, button, input',
      refuse: function (card) { return card.classList.contains('wdg-card--locked'); },
    });
    /* ══ LA POIGNÉE NE MANGE PLUS LA BARRE DE DÉFILEMENT (31/08) ═══════════════════════════════
       « Quand je glisse mon curseur sur le truc pour scroller j'ai du mal à bien le choper, mon
       curseur est sur l'élargissement du bloc. » Mesuré : la poignée de bord droit occupe les 9 px
       les plus à droite de la carte, et la barre de défilement de son corps occupe les 8 px les plus
       à droite du même bord. Elles se recouvrent presque exactement, et la poignée gagne — elle a un
       z-index et se pose PAR-DESSUS. On visait la barre, on attrapait « Élargir ».
       ⚠️ ET ON NE PEUT PAS SORTIR LA POIGNÉE DE LA CARTE : `.wdg-card` est en `overflow: hidden`,
       tout ce qui déborde est rogné — donc inatteignable. Vérifié avant d'essayer.
       On la décale donc VERS L'INTÉRIEUR, mais seulement quand il y a une barre à protéger : une
       carte qui ne défile pas garde sa poignée au bord, là où la main la cherche. L'état se mesure
       au moment où le pointeur entre dans la carte — c'est le seul instant qui compte, et il est
       toujours à jour, contrairement à une classe posée au rendu qu'un contenu chargé plus tard
       rendrait fausse. */
    /* ⚠️ REPRISE 04/09, capture user : « mon curseur est sur le truc du scroller et ça affiche pas le
       scroller mais le truc pour élargir le bloc ». Le correctif du 31/08 était bon dans son
       principe et FAUX dans sa mesure : il ne regardait QUE `.wdg-body`. Or le desk empile une
       douzaine de conteneurs défilants À L'INTÉRIEUR du corps — .wdg-cal-wrap, .wdg-jr-list,
       .wdg-biaswrap, .wdg-taux, .dmx-table-wrap… Dans un panneau à onglets, ce n'est jamais le corps
       qui défile, c'est le contenu de l'onglet. La condition tombait donc à faux, la classe n'était
       pas posée, et la poignée reprenait toute la bande de la barre. Le défaut n'avait pas disparu :
       il s'était réduit aux widgets simples, ceux sur lesquels on l'avait éprouvé.
       DEUX CORRECTIONS. On cherche le débordement PARTOUT dans le corps, pas seulement sur lui. Et
       on exige que la barre PRENNE DE LA PLACE (`offsetWidth > clientWidth`) : un contenu qui
       déborde sans barre visible n'a rien à protéger, et décaler la poignée pour lui l'éloignerait
       du bord sans raison — c'est cette précision-là qui manquait.
       Le balayage est borné dans le temps : `pointerover` remonte à chaque élément survolé, et
       relire la géométrie de tout un widget à chaque pixel serait ruineux. On recalcule au
       changement de carte, ou après un quart de seconde — assez pour suivre un changement d'onglet,
       assez peu pour ne rien coûter. */
    var _bCarte = null, _bAt = 0;
    /* ⚠️ ET SURTOUT PAS DE TEST « LA BARRE PREND-ELLE DES PIXELS ? ». Écrit d'abord avec
       `offsetWidth > clientWidth` — la façon classique de savoir si une barre occupe de la place —
       le correctif s'est révélé MUET au banc : dans le Chromium mesuré, la barre est en
       SURIMPRESSION et les deux largeurs sont égales alors que l'élément défile pour de bon. La
       condition aurait donc désactivé tout le correctif sur ces navigateurs, sans que rien ne le
       signale, exactement comme le défaut qu'on répare. Un raffinement qui dépend d'un détail de
       rendu variable n'est pas une précision, c'est une loterie.
       Ce qui reste vrai partout : l'élément défile, et son bord droit est sous la poignée. Décaler
       la poignée quand la barre est en surimpression ne coûte rien — elle est invisible tant qu'on
       ne survole pas la carte. */
    function _barreAuBord(el, bord) {
      if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
      var r = el.getBoundingClientRect();
      return r.width > 20 && (bord - r.right) <= 12;            // son bord droit est bien sous la poignée
    }
    function _carteDefile(card) {
      var body = card.querySelector('.wdg-body');
      if (!body) return false;
      var bord = card.getBoundingClientRect().right;
      if (_barreAuBord(body, bord)) return true;
      var els = body.querySelectorAll('*');
      for (var i = 0; i < els.length; i++) if (_barreAuBord(els[i], bord)) return true;
      return false;
    }
    host.addEventListener('pointerover', function (e) {
      var card = e.target && e.target.closest && e.target.closest('.wdg-card');
      if (!card) return;
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      if (card === _bCarte && (now - _bAt) < 250) return;
      _bCarte = card; _bAt = now;
      card.classList.toggle('wdg-card--barre', _carteDefile(card));
    });
    // — Redimensionnement LIBRE : poignée de COIN (largeur+hauteur) OU poignée de BORD DROIT (largeur seule),
    //   avec SNAP sur la grille et aperçu live. Le GAP est lu DYNAMIQUEMENT (getComputedStyle) car la densité
    //   « collés/espacés » le fait varier — un gap codé en dur ferait dériver le snap.
    host.addEventListener('pointerdown', function (e) {
      var h = e.target.closest && e.target.closest('.wdg-resize, .wdg-resize-e'); var card = h && h.closest('.wdg-card');
      if (!card) return; e.preventDefault();
      var l = activeLayout(); var idx = +card.getAttribute('data-idx'); var it = l && l.items[idx];
      if (!it || it.locked) return; _normItem(it);
      var cs = getComputedStyle(host);
      var gapC = parseFloat(cs.columnGap), gapR = parseFloat(cs.rowGap);
      if (!isFinite(gapC)) gapC = 10; if (!isFinite(gapR)) gapR = 10;
      // Hauteur de ligne MESUREE sur la carte elle-meme : depuis que les lignes s'etirent pour remplir
      // l'ecran (grid-auto-rows: minmax(0,1fr)), elle n'est plus egale a ROW_PX — un pas fige a 26px
      // ferait grandir le widget beaucoup trop vite. Repli sur ROW_PX si la mesure est aberrante.
      /* ⚠️ LA CARTE SE MESURE DANS LE MÊME ESPACE QUE LE GESTE (29/08). `offsetWidth` et
         `offsetHeight` rendent des pixels CSS NON ZOOMÉS, alors que `e.clientX` / `e.clientY`
         arrivent en pixels d'ÉCRAN. Or le desk applique un zoom de page de 90 % : la carte mesurait
         429 par `offsetWidth` pour 386 à l'écran — rapport 0,900, exactement le zoom. Le pas de la
         grille était donc surestimé de 11 %, et le bord de la carte suivait le curseur — ou le
         doigt — avec ce retard-là : on tirait de dix colonnes pour en gagner neuf.
         `getBoundingClientRect()` mesure à l'écran, comme les événements. Les gouttières, lues en
         `getComputedStyle`, sont elles aussi en pixels déclarés : elles passent par le même facteur. */
      var _zoom = (card.offsetWidth > 0) ? (card.getBoundingClientRect().width / card.offsetWidth) : 1;
      if (!isFinite(_zoom) || _zoom <= 0.2) _zoom = 1;
      gapC *= _zoom; gapR *= _zoom;
      var rowUnit = (card.getBoundingClientRect().height + gapR) / Math.max(1, it.gh);
      if (!isFinite(rowUnit) || rowUnit < 4) rowUnit = (ROW_PX + gapR) * _zoom;
      // ON PART DE CE QUI EST AFFICHE, pas de ce qui est enregistre. Une carte etiree par le moteur
      // d'extension n'a pas la meme largeur a l'ecran que dans la disposition : repartir de la valeur
      // enregistree la faisait sauter des le premier pixel, et divisait la largeur reelle par le
      // mauvais nombre de colonnes — le curseur et le bord de la carte n'avancaient plus ensemble.
      var geo = _geomGrille(l.items), disp = geo.gw, pos = geo.pos;
      var d0 = disp[idx] || it.gw, p0 = pos[idx];
      // LA DISPOSITION EST FIXE (demande user 02/08 « la disposition des blocs doit être fixe ») :
      // redimensionner = DEPLACER UNE FRONTIERE entre voisins, jamais repousser le reste du desk.
      // Sans compensation, la grille en flux dense REPACKE tout : agrandir le barometre reduisait le
      // fil d'actualite et envoyait le panneau MONDE sous le fil. Ce que la carte prend, ses voisins
      // GEOMETRIQUES le cedent — a droite pour la largeur, EN DESSOUS pour la hauteur — donc la somme
      // par rangee/colonne ne change pas et aucune autre carte ne bouge.
      // VOISINES DE DROITE : commencent la ou cette carte finit ET partagent ses rangees.
      var band = [];
      if (p0) {
        for (var b = 0; b < l.items.length; b++) {
          var pb = pos[b]; if (b === idx || !pb) continue;
          if (pb.c !== p0.c + d0) continue;
          if (pb.r >= p0.r + p0.h || pb.r + pb.h <= p0.r) continue;      // rangees disjointes
          if (l.items[b].locked) { band = []; break; }                   // une voisine verrouillee fige le bord
          band.push(b);
        }
      }
      var cede = GRID_COLS;
      band.forEach(function (b) { cede = Math.min(cede, disp[b] - 1); });   // chaque voisine garde 1 colonne
      // VOISINES DU DESSOUS (coin seulement) : commencent PILE sous cette carte ET partagent ses
      // colonnes (largeurs AFFICHEES — ce que l'ecran montre). Leur haut descend, leur bas ne bouge
      // pas : les cartes encore en dessous restent parfaitement en place.
      var bandeBas = [];
      var estCoin = !h.classList.contains('wdg-resize-e');
      if (estCoin && p0) {
        for (var b2 = 0; b2 < l.items.length; b2++) {
          var pb2 = pos[b2]; if (b2 === idx || !pb2) continue;
          if (pb2.r !== p0.r + p0.h) continue;
          if (pb2.c >= p0.c + p0.w || pb2.c + pb2.w <= p0.c) continue;   // colonnes disjointes
          if (l.items[b2].locked) { bandeBas = []; break; }
          bandeBas.push(b2);
        }
      }
      var cedeBas = 999;
      bandeBas.forEach(function (b) { cedeBas = Math.min(cedeBas, l.items[b].gh - 3); });   // chaque voisine du bas garde 3 rangees
      var noeuds = [];
      for (var n = 0; n < l.items.length; n++) noeuds[n] = host.querySelector('.wdg-card[data-idx="' + n + '"]');
      rz = { it: it, idx: idx, card: card, x0: e.clientX, y0: e.clientY,
             gh0: it.gh, delta: 0, deltaR: 0, base: disp.slice(), lgs: disp.slice(),
             baseGh: l.items.map(function (x) { return Math.max(1, (x.gh | 0) || 12); }),
             mode: (estCoin ? 'se' : 'e'),                                 // 'e' = bord droit → LARGEUR seule
             band: band, moins: d0 - 1, plus: band.length ? cede : Math.max(0, GRID_COLS - (p0 ? p0.c + d0 : d0)),
             // Sans voisine dessous, la hauteur est FIGEE DANS LES DEUX SENS : la carte du bas va
             // jusqu'au bord du desk. La retrecir creusait un trou en bas de sa colonne — le total de
             // rangees changeait et le flux dense REPACKAIT le desk (constate user : remonter le bloc
             // du bas de la colonne gauche deplacait le 3e bloc de droite). Cette frontiere-la se
             // regle depuis la carte du DESSUS, qui a bien une voisine a qui ceder.
             bandeBas: bandeBas, moinsBas: bandeBas.length ? (it.gh - 3) : 0, plusBas: bandeBas.length ? Math.max(0, cedeBas) : 0,
             d0: d0, noeuds: noeuds, gapR: gapR, rowUnit: rowUnit, colUnit: (card.getBoundingClientRect().width + gapC) / Math.max(1, d0) };
      card.classList.add('wdg-resizing');
      try { host.setPointerCapture(e.pointerId); } catch (_) {}
    });
    host.addEventListener('pointermove', function (e) {
      if (!rz) return;
      var l = activeLayout(); if (!l) return;
      rz.delta = _clamp(Math.round((e.clientX - rz.x0) / rz.colUnit), -rz.moins, rz.plus);
      // HAUTEUR = FRONTIERE avec la bande du dessous : ce que la carte prend, elles le cedent — leur
      // bas ne bouge pas, et le total de rangees non plus, donc RIEN d'autre ne bouge a l'ecran.
      if (rz.mode !== 'e') rz.deltaR = _clamp(Math.round((e.clientY - rz.y0) / rz.rowUnit), -rz.moinsBas, rz.plusBas);
      // On rejoue LE MOTEUR sur la geometrie visee, puis on applique le resultat a TOUTES les cartes.
      // L'apercu est alors exactement ce que le rendu produira au relachement — aucun saut, ni au
      // depart ni a l'arrivee — et plus aucune carte ne reste avec une largeur calculee pour l'ancienne
      // geometrie (c'est ce qui rouvrait un trou noir a droite pendant le glissement).
      var prov = l.items.map(function (x, i) { return { gw: rz.base[i], gh: rz.baseGh[i] }; });
      prov[rz.idx].gw = rz.d0 + rz.delta;
      rz.band.forEach(function (b) { prov[b].gw = Math.max(1, rz.base[b] - rz.delta); });
      prov[rz.idx].gh = rz.baseGh[rz.idx] + rz.deltaR;
      rz.bandeBas.forEach(function (b) { prov[b].gh = Math.max(3, rz.baseGh[b] - rz.deltaR); });
      rz.ghs = prov.map(function (p) { return p.gh; });
      rz.lgs = _largeursAffichees({ items: prov });
      for (var i = 0; i < prov.length; i++) {
        var c = rz.noeuds[i]; if (!c) continue;
        c.style.setProperty('--gw', rz.lgs[i]); c.style.setProperty('--gh', prov[i].gh);
      }
    });
    var endResize = function (e) {
      if (!rz) return;
      var l = activeLayout();
      var changed = (rz.delta !== 0 || rz.deltaR !== 0);
      if (changed && l) {
        // On enregistre les largeurs AFFICHEES : elles pavent deja la grille, donc les relire ne les
        // etire pas davantage (le moteur n'etend que vers des cellules LIBRES), et la disposition
        // enregistree devient exactement ce que l'ecran montre — plus d'ecart entre les deux.
        for (var i = 0; i < l.items.length; i++) {
          if (rz.lgs[i]) l.items[i].gw = rz.lgs[i];
          if (rz.ghs && rz.ghs[i]) l.items[i].gh = rz.ghs[i];
        }
        save();
      }
      rz.card.classList.remove('wdg-resizing');
      try { host.releasePointerCapture(e.pointerId); } catch (_) {}
      rz = null;
      if (changed) renderGrid();                                                    // remonte les charts a la bonne taille
    };
    host.addEventListener('pointerup', endResize);
    host.addEventListener('pointercancel', endResize);
  }

  function renderGrid() {
    var host = document.getElementById(HOST_ID); if (!host) return;
    _wireGrid(host);
    unmountAll();
    host.classList.toggle('wdg-gap-tight', (STATE.cfg && STATE.cfg.gap) === 'tight');   // densité : collés/espacés
    _syncDensity();
    var lay = activeLayout();
    if (!lay || !lay.items.length) {
      // ÉCRAN GUIDÉ (desk vide) : 3 chemins clairs pour composer — disposition, bibliothèque, ou modèle en 1 clic.
      host.innerHTML = '<div class="wdg-blank">'
        + '<div class="wdg-blank-t">Compose ton desk</div>'
        + '<div class="wdg-blank-s">Pars d\'une disposition, choisis un modèle prêt, ou ajoute tes widgets un à un.</div>'
        + '<div class="wdg-blank-actions">'
        +   '<button class="wdg-btn wdg-btn--gold" onclick="DTPWidgets.pickDispo()">Choisir une disposition</button>'
        +   '<button class="wdg-btn" onclick="DTPWidgets.openLib()">Parcourir la bibliothèque</button>'
        + '</div>'
        + '<div class="wdg-blank-sec">' + (PRESETS.length > 1 ? 'Modèles prêts' : 'Modèle prêt') + '</div>'
        + '<div class="wdg-blank-tpls">'
        +   PRESETS.map(function (p, i) {
              var names = p.items.map(function (it) { var w = byId(it.w); return w ? w.name : ''; }).filter(Boolean).join(' · ');
              return '<button class="wdg-tpl-card" onclick="DTPWidgets.applyPreset(' + i + ')" title="' + esc(names) + '">'
                + _thumb(p.items, { labels: true })
                + '<span class="wdg-tpl-name">' + esc(p.name) + '</span>'
                + '<span class="wdg-tpl-n">' + p.items.length + ' widgets</span>'
                + '<span class="wdg-tpl-list">' + esc(names) + '</span></button>';
            }).join('')
        + '</div></div>';
      return;
    }
    // BANDEAU D'ASTUCE RETIRÉ (demande user 26/07 « enlève cette bande ») : il mangeait une bande de
    // hauteur en permanence en haut du desk. Les gestes restent découvrables par les poignées elles-mêmes
    // (bord droit, coin, ⠿) et par leurs infobulles. On nettoie un bandeau resté en place d'un rendu passé.
    var tipHost = document.getElementById('wdg-tipbar');
    if (tipHost) tipHost.remove();
    var _lgs = _largeursAffichees(lay);
    host.innerHTML = lay.items.map(function (it, idx) {
      // EMPLACEMENT VIDE (création guidée par disposition) : carte pointillée « + Choisir un widget ».
      // Le choix dans la bibliothèque REMPLACE l'emplacement en gardant sa géométrie (gw/gh de la disposition).
      if (it.w === 'slot') {
        _normItem(it);
        return '<section class="wdg-card wdg-card--slot" data-idx="' + idx + '" style="--gw:' + (_lgs[idx] || it.gw) + ';--gh:' + it.gh + ';">'
          + '<button class="wdg-slot-x" title="Retirer l\'emplacement" onclick="DTPWidgets.remove(' + idx + ')">×</button>'
          + '<button class="wdg-slot-add" onclick="DTPWidgets.pickFor(' + idx + ')">+<span>Choisir un widget</span></button>'
          + '<div class="wdg-resize" title="Redimensionner"></div>'
          + '<div class="wdg-resize-e" title="Élargir"></div></section>';
      }
      var w = byId(it.w);
      if (!w) return '';                                                     // widget retiré du catalogue → ignoré
      _normItem(it);
      var locked = !!it.locked;
      // Carte = cellule de grille (span colonnes/lignes via --gw/--gh). Header TERMINAL : déplacer · actualiser ·
      // réglages · dupliquer · plein écran · verrouiller · retirer. Icônes discrètes, hover doré.
      return '<section class="wdg-card' + (locked ? ' wdg-card--locked' : '') + (w.id === 'onglets' ? ' wdg-card--tabs' : '') + '" data-idx="' + idx + '" style="--gw:' + (_lgs[idx] || it.gw) + ';--gh:' + it.gh + ';">'
        // `draggable` retiré : tout le déplacement passe par le pointeur (cf. _wireGrid). Le
        // verrouillage est refusé à la source, dans `refuse`, plutôt que par l'attribut.
        + '<header class="wdg-head" title="' + (locked ? 'Carte verrouillée' : 'Maintenir pour déplacer') + '">'
        // (poignée ⠿ RETIRÉE 04/08 : l'en-tête entier est la zone de saisie — cf. _wireGrid)
        +   '<span class="wdg-title" title="' + esc(w.name) + '">' + esc(w.name) + '</span>'
        +   (function (c) { return c ? '<span class="wdg-ctx" title="' + esc(c) + '">' + esc(c) + '</span>' : ''; })(_ctxHead(w, it))
        // BANDEAU (21/08, demande user) : Réglages · REMPLACER · Fermer. « Remplacer » remonte des
        // réglages vers l'en-tête : changer le widget d'un emplacement est le geste le plus courant
        // de la personnalisation, il ne devait pas coûter deux clics et l'ouverture d'un panneau.
        // Dupliquer, Plein écran et Verrouiller restent dans les Réglages, où ils sont LIBELLÉS.
        +   '<span class="wdg-actions">'
        // ORDRE INTUITIF DU CLUSTER (22/08, demande user « ordonne mieux les boutons ») :
        // d'abord les commandes qui MODIFIENT le widget (Réglages, puis Remplacer) — regroupées
        // parce qu'elles répondent à la même intention « ajuster cet emplacement » ; ensuite l'AIDE
        // (informative, occasionnelle) ; enfin la FERMETURE, action terminale toujours à l'extrême
        // droite. L'aide reste présente sur TOUS les widgets sans exception, elle passe simplement
        // d'un « d'abord » peu naturel à sa place logique, juste avant la croix.
        // ENGRENAGE SEULEMENT S'IL SERT (04/08) : un widget sans réglage déclaré n'affiche pas un
        // bouton qui ouvrirait un panneau vide (rapports Institutions/Analystes, Baromètre…).
        +     (((w.opts && w.opts.length) || w.id === 'onglets')
                ? '<button class="wdg-ico" title="Réglages" onclick="DTPWidgets.toggleSettings(' + idx + ')">' + ICO.gear + '</button>'
                : '')
        +     '<button class="wdg-ico" title="Remplacer" onclick="DTPWidgets.replaceStart(' + idx + ')">' + ICO.swap + '</button>'
        +     '<button class="wdg-ico wdg-ico--aide" title="Aide" onclick="DTPWidgets.aide(' + idx + ')">' + ICO.aide + '</button>'
        +     '<button class="wdg-ico wdg-ico--x" title="' + (w.id === 'onglets' ? 'Retirer le panneau' : 'Retirer') + '" onclick="DTPWidgets.remove(' + idx + ')">' + ICO.close + '</button>'
        +   '</span>'
        + '</header>'
        + '<div class="wdg-pop wdg-settings" id="' + HOST_ID + '-s' + idx + '" hidden>'
        +   _setPanelHtml(idx, w, it)
        + '</div>'
        // Panneau DISTINCT pour le widget affiché dans un onglet (son engrenage vit dans SA barre).
        + (w.id === 'onglets' ? '<div class="wdg-pop wdg-settings" id="' + HOST_ID + '-ss' + idx + '" hidden></div>' : '')
        + '<div class="wdg-body" id="' + HOST_ID + '-b' + idx + '"></div>'
        + '<div class="wdg-resize" title="Redimensionner"></div>'
        + '<div class="wdg-resize-e" title="Élargir"></div></section>';
    }).join('')
    // BLOC FANTÔME INTELLIGENT (28/07) : il COMBLE EXACTEMENT le trou de la disposition — largeur
    // restante de la dernière rangée × hauteur de cette rangée (simulation du placement 12 col).
    // Rangée complète → bandeau discret pleine largeur. Contenu centré. Clic → bibliothèque.
    // Plus de bloc fantôme : les rangées sont pleines par construction (cf. _spansAffiches), il n'y
    // a donc plus de trou à décorer. L'ajout d'un widget reste accessible par la bibliothèque.
    ;
    // Plein écran : la carte ciblée recouvre la zone de travail (overlay), la grille est figée derrière.
    if (_fullscreenIdx != null) {
      var fsCard = host.querySelector('.wdg-card[data-idx="' + _fullscreenIdx + '"]');
      if (fsCard) { host.classList.add('wdg-fs-mode'); fsCard.classList.add('wdg-fs'); } else _fullscreenIdx = null;
    }
    if (_fullscreenIdx == null) host.classList.remove('wdg-fs-mode');
    // Rouvre le panneau réglages du widget qu'on vient d'ajuster (sinon il se referme à chaque clic).
    if (_reopen != null) { var sp = document.getElementById(HOST_ID + '-s' + _reopen); if (sp) sp.hidden = false; _reopen = null; }
    // MONTAGE APRÈS insertion et affichage : amCharts mesure 0×0 dans un conteneur caché.
    // JETON anti-course (23/07) : deux renderGrid rapprochés = deux rAF en file ; sans jeton, le rAF
    // PÉRIMÉ montait une 2e fois dans les nouveaux conteneurs (root amCharts / carte orphelins).
    var tok = ++_mountToken;
    requestAnimationFrame(function () {
      if (tok !== _mountToken) return;                       // un renderGrid plus récent a repris la main
      lay.items.forEach(function (it, idx) {
        var w = byId(it.w), body = document.getElementById(HOST_ID + '-b' + idx);
        if (!w || !body || body._wdgClean) return;            // _wdgClean : déjà monté par refresh() entre-temps
        try {
          var un = w.mount(body, it);                        // it = config d'item (Panneau à onglets lit it.tabs)
          var maj = _majAuto(w, body, it, un);                // widget déclarant `maj` → remontage périodique
          if (typeof maj === 'function') { STATE.mounted.push(maj); body._wdgClean = maj; }
          else if (typeof un === 'function') { STATE.mounted.push(un); body._wdgClean = un; }
        }
        catch (e) { fallback(body, 'Widget indisponible.'); }
      });
    });
  }
/* ═══ MISE A JOUR PERIODIQUE D'UNE CARTE (21/08) ═══════════════════════════════════════════════
   Mesure faite AVANT d'ecrire : 22 widgets sur 34 se mettaient deja a jour, par leur propre
   minuteur, par le helper de bougies ou par un evenement du desk. Douze ne le faisaient jamais.
   Trois n'en ont pas besoin (Notes, Calculatrice, Panneau a onglets : leur contenu vient de vous).
   Deux delegent a un moteur du desk. Restaient SEPT cartes qui, une fois affichees, ne changeaient
   plus jusqu'au rechargement de la page.

   ⚠️ LE VRAI ENJEU N'EST PAS LA FRAICHEUR, C'EST L'AUTO-REPARATION. Sur des donnees lentes
   (saisonnalite, COT hebdomadaire) une carte figee ne ment pas beaucoup. Mais si le PREMIER
   chargement echoue, faute d'une source momentanement muette, la carte reste en erreur POUR
   TOUJOURS. C'est exactement le defaut signale le 19/08 sur les cartes a bougies (« Bougies
   indisponibles » de facon definitive), corrige la par un reessai et un rafraichissement.

   ⚠️ IMPLEMENTATION CENTRALE, PAS SEPT RETOUCHES. Chaque widget declare `maj` en millisecondes ;
   le montage s'occupe du reste. Sept modifications eparpillees dans sept mille lignes auraient
   diverge a la premiere evolution, et rien n'aurait signale l'oubli du huitieme widget.

   ⚠️ ON NE REMONTE PAS UNE CARTE INVISIBLE : onglet en arriere-plan, carte hors ecran, element
   retire du document. Rafraichir ce que personne ne regarde depense du reseau et du quota sans
   rien apporter, et c'est precisement ce qui a coute un incident d'egress a ce projet. */
  function _majAuto(w, body, it, un) {
    var ms = w && w.maj;
    if (!ms || typeof w.mount !== 'function') return null;
    var mort = false, courant = un;
    var iv = setInterval(function () {
      if (mort || !body || !body.isConnected || document.hidden) return;
      try {
        var b = body.getBoundingClientRect();
        if (b.width < 2 || b.bottom < -200 || b.top > (window.innerHeight || 0) + 200) return;
      } catch (e) {}
      try { if (typeof courant === 'function') courant(); } catch (e) {}
      courant = null;
      try { courant = w.mount(body, it); } catch (e) { /* la carte garde son dernier etat */ }
    }, ms);
    return function () {
      mort = true;
      try { clearInterval(iv); } catch (e) {}
      try { if (typeof courant === 'function') courant(); } catch (e) {}
    };
  }

  function layoutById(id) {
    var c = STATE.cfg; if (!c) return null;
    for (var i = 0; i < c.layouts.length; i++) if (c.layouts[i].id === id) return c.layouts[i];
    return null;
  }
  // ── ICÔNES DE DISPOSITION (17/08) ─────────────────────────────────────────────────────────────
  // Choisies à la création d'une disposition, elles la rendent reconnaissable sans lire son nom :
  // dans la barre d'onglets (noms tronqués à 190 px) comme sur les cartes du gestionnaire.
  // Dessins DTP ORIGINAUX, MÊME FACTURE que les icônes de widgets (table WICO plus bas) : viewBox 24,
  // tracé au trait, `stroke="currentColor"`, aucun remplissage. Donc l'icône prend la couleur de son
  // contexte (blanche dans l'onglet actif, grise au repos, or au survol) sans une seule règle de plus.
  //
  // ⚠️ L'IDENTIFIANT EST LE CONTRAT AVEC LE SERVEUR : le sanitizer de server.js ne reprend `ico` que
  // s'il vaut /^[a-z0-9-]{1,20}$/. Un id avec accent, majuscule, espace ou plus long serait JETÉ EN
  // SILENCE au premier enregistrement : l'icône choisie disparaîtrait au rechargement sans qu'aucune
  // erreur n'apparaisse nulle part. Les accents vivent donc dans `nom` (libellé affiché), jamais
  // dans `id`. Le test `scripts/` associé rejoue cette expression sur tout le catalogue.
  var _LAYICO_RX = /^[a-z0-9-]{1,20}$/;
  var _LAYSVG = 'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  var LAYICOS = [
    { id: 'graphe',   nom: 'Graphique',  svg: '<svg ' + _LAYSVG + '><path d="M4 4v16h16"/><path d="M8 17v-5M12.5 17V8M17 17v-7"/></svg>' },
    { id: 'courbe',   nom: 'Courbe',     svg: '<svg ' + _LAYSVG + '><path d="M4 17l4.5-5.5 3.5 3L20 6"/><circle cx="8.5" cy="11.5" r="1.15"/><circle cx="12" cy="14.5" r="1.15"/><circle cx="20" cy="6" r="1.15"/></svg>' },
    { id: 'grille',   nom: 'Grille',     svg: '<svg ' + _LAYSVG + '><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>' },
    { id: 'colonnes', nom: 'Colonnes',   svg: '<svg ' + _LAYSVG + '><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M9.2 5v14M14.8 5v14"/></svg>' },
    { id: 'boussole', nom: 'Boussole',   svg: '<svg ' + _LAYSVG + '><circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z"/></svg>' },
    { id: 'cible',    nom: 'Réticule',   svg: '<svg ' + _LAYSVG + '><circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>' },
    { id: 'eclair',   nom: 'Éclair',     svg: '<svg ' + _LAYSVG + '><path d="M13.5 3L6 13.5h5L10.5 21 18 10.5h-5z"/></svg>' },
    { id: 'horloge',  nom: 'Horloge',    svg: '<svg ' + _LAYSVG + '><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></svg>' },
    { id: 'balance',  nom: 'Balance',    svg: '<svg ' + _LAYSVG + '><path d="M12 4.5v15M7 19.5h10M5 8.5h14"/><path d="M5 8.5l-2.5 5h5zM19 8.5l-2.5 5h5z"/></svg>' },
    { id: 'bouclier', nom: 'Bouclier',   svg: '<svg ' + _LAYSVG + '><path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6.1z"/></svg>' },
    { id: 'etoile',   nom: 'Étoile',     svg: '<svg ' + _LAYSVG + '><path d="M12 3.6l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.8l5.9-.9z"/></svg>' },
    { id: 'couches',  nom: 'Couches',    svg: '<svg ' + _LAYSVG + '><path d="M12 3.5l8.5 4.3L12 12.1 3.5 7.8z"/><path d="M3.5 12.2L12 16.5l8.5-4.3M3.5 16.4L12 20.7l8.5-4.3"/></svg>' },
    { id: 'livre',    nom: 'Carnet',     svg: '<svg ' + _LAYSVG + '><path d="M4 5h5.5A2.5 2.5 0 0 1 12 7.5V19a2.5 2.5 0 0 0-2.5-2H4z"/><path d="M20 5h-5.5A2.5 2.5 0 0 0 12 7.5V19a2.5 2.5 0 0 1 2.5-2H20z"/></svg>' },
    { id: 'ampoule',  nom: 'Idée',       svg: '<svg ' + _LAYSVG + '><path d="M9.2 17.5h5.6M10 20.5h4"/><path d="M12 3.5a5.5 5.5 0 0 0-3.2 9.9c.6.5 1 1.2 1 2v.1h4.4v-.1c0-.8.4-1.5 1-2A5.5 5.5 0 0 0 12 3.5z"/></svg>' },
    { id: 'epingle',  nom: 'Épingle',    svg: '<svg ' + _LAYSVG + '><path d="M12 14.5V21"/><path d="M8 4.5h8l-1 4.2 2.6 2.6a1 1 0 0 1-.7 1.7H7.1a1 1 0 0 1-.7-1.7L9 8.7z"/></svg>' },
    { id: 'terminal', nom: 'Terminal',   svg: '<svg ' + _LAYSVG + '><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 10l2.5 2-2.5 2M12.5 14.5h4"/></svg>' },
    { id: 'fusee',    nom: 'Lancement',  svg: '<svg ' + _LAYSVG + '><path d="M12 3.5c2.7 2.3 4.2 5.5 4.2 9l-2 3.5H9.8l-2-3.5c0-3.5 1.5-6.7 4.2-9z"/><circle cx="12" cy="9.8" r="1.7"/><path d="M9.8 16l-2.3 1.5 1 3 2.2-1.6M14.2 16l2.3 1.5-1 3-2.2-1.6"/></svg>' },
    { id: 'drapeau',  nom: 'Repère',     svg: '<svg ' + _LAYSVG + '><path d="M6 21V4"/><path d="M6 5h11.5l-2.2 3.6 2.2 3.6H6z"/></svg>' },
  ];
  // Catalogue exposé (DTPWidgets.layoutIcons) : une COPIE, pour qu'un appelant ne puisse pas altérer
  // la table de référence dont dépend l'affichage de toutes les dispositions déjà enregistrées.
  function layoutIcons() { return LAYICOS.map(function (ic) { return { id: ic.id, nom: ic.nom, svg: ic.svg }; }); }
  // ⚠️ TABLE SANS PROTOTYPE (Object.create(null)). Avec un objet ordinaire, `_LAYICO['constructor']`
  // renvoie la fonction Object au lieu de `undefined` : or « constructor » PASSE l'expression du
  // sanitizer (11 lettres minuscules), donc une config portant `ico: 'constructor'` traversait le
  // serveur, ressortait « trouvée » ici, et la barre d'onglets affichait le mot `undefined` en clair
  // (mesuré au banc). Les autres membres hérités portent une majuscule et tombaient déjà.
  var _LAYICO = Object.create(null);
  LAYICOS.forEach(function (ic) { _LAYICO[ic.id] = ic; });
  // Rendu d'une icône de disposition. Renvoie une chaîne VIDE quand la disposition n'en a pas (toutes
  // celles créées avant aujourd'hui) ou quand l'identifiant n'est plus au catalogue : AUCUN élément
  // n'est alors écrit, donc aucune gouttière flex ne s'ouvre et rien ne se décale par rapport à avant.
  /* ⚠️ ENCODAGE DES IDENTIFIANTS D'ICÔNE. Le sanitizer serveur n'accepte que /^[a-z0-9-]{1,20}$/
     (server.js, _wdgClean) : un identifiant hors de ce jeu est SILENCIEUSEMENT effacé au premier
     enregistrement. D'où le choix de 'f-us' pour un drapeau et de 'e-1f680' pour un émoji (point de
     code en hexadécimal, plusieurs points de code séparés par des tirets). Aucune modification
     serveur n'est donc nécessaire, et rien ne se perd au rechargement. */
  function _emoDeId(id) {
    var p = String(id).slice(2).split('-').filter(Boolean);
    try {
      var cps = p.map(function (h) { return parseInt(h, 16); });
      if (!cps.length || cps.some(function (c) { return !isFinite(c) || c <= 0 || c > 0x10ffff; })) return '';
      return String.fromCodePoint.apply(String, cps);
    } catch (e) { return ''; }
  }
  function _idDeEmo(ch) {
    return 'e-' + Array.from(ch).map(function (c) { return c.codePointAt(0).toString(16); }).join('-');
  }
  function _layIco(id, cls) {
    var t = String(id || '');
    if (/^e-[0-9a-f-]+$/.test(t)) {
      var ch = _emoDeId(t);
      return ch ? '<span class="' + (cls || 'wdg-lay-ico') + ' wdg-lay-ico--emo" aria-hidden="true">' + ch + '</span>' : '';
    }
    /* Drapeau = IMAGE, jamais l'émoji drapeau : Windows ne fournit aucun glyphe pour les drapeaux
       de pays, on y verrait deux lettres dans un carré. Même source que le reste du desk. */
    if (/^f-[a-z]{2}$/.test(t)) {
      return '<span class="' + (cls || 'wdg-lay-ico') + '" aria-hidden="true">'
        + '<img class="wdg-lay-flag" src="https://flagcdn.com/w40/' + t.slice(2) + '.png" width="16" alt="" loading="lazy"></span>';
    }
    var ic = id && _LAYICO[t];
    if (!ic) return '';
    return '<span class="' + (cls || 'wdg-lay-ico') + '" aria-hidden="true">' + ic.svg + '</span>';
  }
  /* Émojis : liste courte et VOLONTAIREMENT sobre, chacun avec des mots-clés français pour la
     recherche (sans eux, un champ de recherche sur des pictogrammes ne sert à rien). */
  var LAYEMO = [
    ['\u{1F680}', 'fusée départ lancement'], ['\u{1F4C8}', 'hausse graphique montée'],
    ['\u{1F4C9}', 'baisse graphique chute'], ['\u{1F4CA}', 'barres statistiques données'],
    ['\u{1F3AF}', 'cible objectif'], ['\u{1F525}', 'feu chaud actif'],
    ['\u{26A1}', 'éclair rapide volatilité'], ['\u{1F4A1}', 'idée ampoule'],
    ['\u{1F510}', 'sécurité verrou'], ['\u{1F553}', 'horloge heure séance'],
    ['\u{1F4C5}', 'calendrier agenda'], ['\u{1F5DE}', 'journal actualité news'],
    ['\u{1F3E6}', 'banque centrale'], ['\u{1F4B1}', 'change devises forex'],
    ['\u{1F30D}', 'monde global macro'], ['\u{1F50D}', 'recherche analyse loupe'],
    ['\u{1F4DD}', 'notes carnet'], ['\u{2B50}', 'étoile favori'],
    ['\u{1F9ED}', 'boussole direction biais'], ['\u{1F6A6}', 'feux signal alerte'],
    ['\u{1F9EA}', 'test essai laboratoire'], ['\u{1F4BC}', 'travail portefeuille'],
    ['\u{1F31E}', 'matin ouverture'], ['\u{1F319}', 'nuit clôture asie'],
  ];
  /* Drapeaux : les places qui comptent pour un desk FX, dans l'ordre des huit majeures. */
  var LAYFLAG = [
    ['us', 'états-unis usd dollar'], ['eu', 'europe eur euro'], ['jp', 'japon jpy yen'],
    ['gb', 'royaume-uni gbp livre'], ['au', 'australie aud'], ['ch', 'suisse chf franc'],
    ['ca', 'canada cad'], ['nz', 'nouvelle-zélande nzd'], ['cn', 'chine cny yuan'],
    ['de', 'allemagne'], ['fr', 'france'], ['br', 'brésil'],
  ];
  // BARRE DES LAYOUTS = SEULEMENT quand PLUSIEURS sont affichés (logique user 04/08) :
  //  · UN SEUL layout affiché (l'œil 📂/👁 du gestionnaire pose `hidden` sur les autres) → AUCUN
  //    nom dans la barre — on est DANS le layout, la barre ne garde que « Personnaliser ».
  //  · PLUSIEURS layouts affichés → la barre d'onglets apparaît avec leurs noms pour basculer
  //    (clic = ouvrir, double-clic = renommer). Le choix/création vit dans Personnaliser › Layouts.
  function renderBar() {
    var el = document.getElementById('wdg-layouts'); var c = STATE.cfg;
    if (!el) return;
    // BANDE MASQUÉE QUAND ELLE EST VIDE (demande user 04/08 « masque cette bande noire pour gagner
    // de l'espace ») : depuis le retrait du bouton Personnaliser, la barre ne porte plus rien tant
    // qu'un seul layout est affiché → on la retire du flux, le desk gagne sa hauteur.
    var bar = el.closest ? el.closest('.wdg-bar') : null;
    var vide = function (v) { if (bar) bar.classList.toggle('wdg-bar--vide', !!v); };
    if (!c || !c.layouts.length) { el.innerHTML = ''; vide(true); return; }
    var vis = c.layouts.filter(function (l) { return !l.hidden; });
    if (vis.length <= 1) { el.innerHTML = ''; vide(true); return; }
    vide(false);
    el.innerHTML = vis.map(function (l) {
      // classes de la NAV DU DESK : l'apparence vient d'elle, pas d'une copie de ses valeurs
      return '<span class="nav-item wdg-lay' + (l.id === c.active ? ' nav-item--active on' : '') + '" data-lay="' + l.id + '" title="' + esc(l.name) + ' · renommer : double-clic"'
        + ' role="button" tabindex="0"'
        + ' onclick="DTPWidgets.switchLayout(\'' + l.id + '\')" ondblclick="DTPWidgets.editTab(\'' + l.id + '\')">'
        // L'icône choisie REMPLACE le chevron (18/08, demande user : « la flèche est l'icône par
        // défaut du système »). Deux signes côte à côte se concurrençaient ; il n'y en a plus qu'un :
        // l'icône de la disposition si elle existe, le chevron de la nav sinon.
        + (l.ico && _layIco(l.ico) ? _layIco(l.ico) : '<span class="wdg-lay-chv">›</span>')
        + (l.fav ? '<span class="wdg-lay-star">★</span>' : '')
        + '<span class="wdg-lay-name">' + esc(l.name) + '</span>'
        // ✕ = FERMER l'onglet, PAS supprimer le layout (demande user 04/08) : il retourne dans
        // Personnaliser › Layouts, prêt à être rouvert. Quand il n'en reste qu'UN, la barre entière
        // se masque (cf. plus haut) → l'espace est rendu au desk.
        + '<button class="wdg-lay-x" title="Fermer \'onglet"'
        +   ' onclick="event.stopPropagation();DTPWidgets.toggleHide(\'' + l.id + '\')">×</button>'
        + '</span>';
    }).join('')
      // « + » = NOUVEL ONGLET (demande user 04/08) : ouvre la fenêtre des LAYOUTS sur le choix de
      // disposition (newLayout → _mgrMode='dispo'), comme le « + » d'un panneau à onglets.
      + (c.layouts.length < _LMAX
          ? '<button class="nav-item wdg-lay wdg-lay-add" title="Nouvel onglet : choisir une disposition" onclick="DTPWidgets.newLayout()">+</button>'
          : '');
  }
  // Synchronise le contrôle de densité (barre statique, jamais re-rendue) avec l'état persisté.
  function _syncDensity() {
    var g = (STATE.cfg && STATE.cfg.gap) === 'tight' ? 'tight' : 'loose';
    document.querySelectorAll('#wdg-density .wdg-dens-b').forEach(function (b) {
      b.classList.toggle('wdg-btn--on', b.getAttribute('data-g') === g);
    });
  }
  // Renommage INLINE d'un onglet (double-clic) : le nom devient un champ, Entrée/blur valide, Échap annule.
  function editTab(id) {
    var l = layoutById(id); if (!l) return;
    var btn = document.querySelector('.wdg-lay[data-lay="' + id + '"]'); if (!btn) return;
    var span = btn.querySelector('.wdg-lay-name'); if (!span) return;
    var input = document.createElement('input');
    input.className = 'wdg-lay-edit';
    input.value = l.name; input.maxLength = 40; input.spellcheck = false;
    span.replaceWith(input);
    input.focus(); input.select();
    var done = false;
    var commit = function (keep) {
      if (done) return; done = true;
      if (keep) API.renameLayout(id, input.value);
      renderBar();
    };
    input.addEventListener('blur', function () { commit(true); });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      else if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });   // ne pas re-déclencher switchLayout
  }
  // Gestionnaire de layouts (overlay) : favori · renommer (inline) · ouvrir · supprimer (confirmation inline).
  // 2 écrans : la LISTE (tes layouts, rien d'autre — les modèles prêts vivent dans la bibliothèque pour ne pas
  // brouiller la création) et le CHOIX DE DISPOSITION (création guidée, mini-schémas façon « Select Layout »).
  var _mgrMode = null;                       // null = liste · 'dispo' = choix de disposition · 'nom' = nom + icône
  var _dispoTarget = 'new';                  // 'new' = créer un layout · 'current' = remplir le desk VIDE actif (écran guidé)
  var _newDispo = null;                      // index DISPOS retenu à l'écran précédent, en attente de création
  var _newIco = '';                          // identifiant d'icône retenu à l'écran « nom + icône » ('' = aucune)
  function renderManager() {
    var box = document.getElementById('wdg-mgr-list'); var c = STATE.cfg;
    // Les sous-écrans (choix de disposition, nom + icône) portent LEURS propres actions : laisser
    // le pied du volet affiché montrait deux boutons « Créer » à l'écran en même temps.
    var _vol = document.getElementById('wdg-mgr');
    if (_vol) {
      _vol.classList.toggle('mgr-sub', _mgrMode === 'dispo' || _mgrMode === 'nom');
      // L'en-tête du volet PORTE l'étape (capture : « Create New Layout » en titre) : le titre et le
      // sous-titre changent avec l'écran, la croix ferme toujours tout.
      var _t = _vol.querySelector('.wdg-lib-title'), _st = _vol.querySelector('.wdg-lib-sous');
      if (_t) _t.textContent = _mgrMode === 'nom' ? 'Créer un layout' : _mgrMode === 'dispo' ? 'Choisir une disposition' : 'Layouts';
      // Sous-titre sur la LISTE seulement : les captures des sous-écrans n'en portent pas.
      if (_st) {
        _st.textContent = _mgrMode ? '' : 'Vos dispositions : réordonnez, renommez, choisissez celle qui s\'ouvre.';
        _st.style.display = _mgrMode ? 'none' : '';
      }
    }
    if (!box || !c) return;
    if (_mgrMode === 'dispo') {
      // Rangées GROUPÉES par nombre de panneaux, le chiffre à gauche. Depuis la reprise du 20/08
      // (ordre des captures : nom d'abord), la disposition est la DERNIÈRE étape : la choisir CRÉE le
      // layout, dans les deux parcours. Le nom vient de _newNom, stocké à l'étape précédente.
      var _suite = 'createLayout';
      var _dCard = function (d, i) {
        return '<button class="wdg-dispo-card" onclick="DTPWidgets.' + _suite + '(' + i + ')" title="' + esc(d.name) + '">'
          + (d.items.length ? _thumb(d.items) : '<span class="wdg-thumb wdg-thumb--free">∞</span>')
          + '<span class="wdg-dispo-name">' + esc(d.name) + '</span></button>';
      };
      box.innerHTML = '<div class="wdg-dispo-head">'
        + '<button class="wdg-btn" onclick="DTPWidgets.backFromDispo()">‹ Retour</button></div>'
        + DISPO_ORDER.map(function (n) {
            var cards = DISPOS.map(function (d, i) { return d.n === n ? _dCard(d, i) : ''; }).join('');
            if (!cards) return '';
            return '<div class="wdg-dispo-row"><span class="wdg-dispo-num">' + n + '</span><div class="wdg-dispo-cards">' + cards + '</div></div>';
          }).join('')
        + '';
      return;
    }
    // ÉCRAN « NOM + ICÔNE » (17/08) : dernière étape avant la création. Il vit DANS le gestionnaire,
    // comme le choix de disposition : le projet n'ouvre jamais de dialogue natif (prompt/confirm).
    if (_mgrMode === 'nom') {
      var _icoBtn = function (id, nom, dedans, extra) {
        var on = (id === _newIco);
        return '<button type="button" class="wdg-ico-pick' + (extra || '') + (on ? ' on' : '') + '" data-ico="' + id + '"'
          + ' title="' + esc(nom) + '" aria-label="' + esc(nom) + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
          + ' onclick="DTPWidgets.setNewIco(\'' + id + '\')">' + dedans + '</button>';
      };
      // L'écran suit la capture : nom, icône (3 familles), actions. L'aperçu de disposition a
      // disparu AVEC SA RAISON D'ÊTRE : la disposition se choisit désormais APRÈS, il n'y a plus
      // rien à rappeler ici. Le titre de l'étape vit dans l'en-tête du volet (voir plus bas).
      box.innerHTML = '<div class="wdg-nom">'
        +   '<div class="wdg-nom-champs">'
        +     '<label class="wdg-nom-lbl" for="wdg-newname">Nom du layout</label>'
        // maxlength = 40, EXACTEMENT la coupe du sanitizer serveur : ce qu'on peut taper est ce qui
        // sera gardé, sinon la fin du nom disparaîtrait au rechargement sans explication.
        +     '<input id="wdg-newname" class="wdg-lib-search" type="text" maxlength="40" spellcheck="false"'
        +       ' autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore data-protonpass-ignore="true"'
        +       ' placeholder="Nom du layout…" value="' + esc(_newNom) + '">'
        +     '<div class="wdg-nom-lbl" id="wdg-ico-lbl">Icône du layout</div>'
        +     '<div class="wdg-ico-tabs" role="tablist">'
        +       ['ico', 'emo', 'flag'].map(function (t, i) {
                 var lbl = ['Icônes', 'Émojis', 'Drapeaux'][i];
                 return '<button type="button" role="tab" class="wdg-ico-tab' + (_icoTab === t ? ' on' : '') + '"'
                   + ' aria-selected="' + (_icoTab === t ? 'true' : 'false') + '"'
                   + ' onclick="DTPWidgets.setIcoTab(\'' + t + '\')">' + lbl + '</button>';
               }).join('')
        +     '</div>'
        +     '<div class="wdg-ico-panel">'
        +     '<input id="wdg-ico-q" class="wdg-lib-search wdg-ico-q" type="text" spellcheck="false"'
        +       ' autocomplete="off" placeholder="Rechercher une icône…" value="' + esc(_icoQ) + '"'
        +       ' oninput="DTPWidgets.filterIco(this.value)">'
        +     '<div class="wdg-ico-grid" role="group" aria-labelledby="wdg-ico-lbl">'
        +       (function () {
                 // La recherche porte sur les MOTS-CLÉS, pas sur le dessin : sans eux un champ de
                 // recherche sur des pictogrammes ne filtrerait rien.
                 var q = _icoQ.trim().toLowerCase();
                 var garde = function (mots) { return !q || String(mots).toLowerCase().indexOf(q) !== -1; };
                 var vide = (!q && _icoTab === 'ico') ? _icoBtn('', 'Sans icône', 'Aucune', ' wdg-ico-pick--none') : '';
                 var corps = '';
                 if (_icoTab === 'ico') {
                   corps = LAYICOS.filter(function (ic) { return garde(ic.nom + ' ' + ic.id); })
                     .map(function (ic) { return _icoBtn(ic.id, ic.nom, ic.svg, ''); }).join('');
                 } else if (_icoTab === 'emo') {
                   corps = LAYEMO.filter(function (e) { return garde(e[1]); })
                     .map(function (e) { return _icoBtn(_idDeEmo(e[0]), e[1], '<span class="wdg-ico-emo">' + e[0] + '</span>', ''); }).join('');
                 } else {
                   corps = LAYFLAG.filter(function (f) { return garde(f[1]); })
                     .map(function (f) { return _icoBtn('f-' + f[0], f[1], '<img class="wdg-ico-flag" src="https://flagcdn.com/w40/' + f[0] + '.png" width="20" alt="" loading="lazy">', ''); }).join('');
                 }
                 return (vide + corps) || '<div class="wdg-ico-vide">Aucune icône ne correspond à « ' + esc(_icoQ) + ' ».</div>';
               })()
        +     '</div>'
        +     '</div>'
        +   '</div>'
        + '</div>'
        + '<div class="wdg-nom-actions">'
        +   '<button class="wdg-lib-bbtn wdg-lib-bbtn--fort" onclick="DTPWidgets.nameDone()">Créer le layout</button>'
        +   '<button class="wdg-lib-bbtn" onclick="DTPWidgets.backManager()">Annuler</button>'
        + '</div>'
        // ⚠️ CE QUI EST PROMIS ICI DOIT EXISTER. Le double-clic sur une carte du gestionnaire ouvre
        // editCardName, qui ne touche QUE le nom : il n'y a aujourd'hui aucun chemin pour changer
        // l'icône après coup. Annoncer « nom et icône se changent ensuite » était donc faux, et
        // envoyait l'utilisateur chercher un réglage inexistant. On dit ce que le code fait vraiment.
        + '';
      // CLAVIER, même grammaire que le renommage inline (editCardName) : le champ prend le focus,
      // Entrée valide, Échap annule. `stopPropagation` est indispensable : l'écoute Échap globale du
      // desk fermerait TOUT le gestionnaire au lieu de reculer d'un seul écran.
      var inp = document.getElementById('wdg-newname');
      if (inp) {
        inp.addEventListener('keydown', function (e) {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); API.nameDone(); }
          else if (e.key === 'Escape') { e.preventDefault(); API.backManager(); }
        });
        try { inp.focus(); } catch (_) {}
      }
      return;
    }
    // SÉLECTION EN GRILLE DE CARTES (refonte 04/08, demande user « il faut que ce soit intuitif
    // pour sélectionner le layout ») : la VIGNETTE devient le sujet (on reconnaît son desk à sa
    // forme), un CLIC N'IMPORTE OÙ sur la carte l'ouvre. Les actions secondaires (défaut ★,
    // afficher dans la barre, supprimer) sont des pastilles en coin, elles n'avalent pas le clic
    // (stopPropagation). Le nom se renomme au DOUBLE-CLIC, comme les onglets.
    box.innerHTML = '<div class="wdg-mgr-grid">' + c.layouts.map(function (l, li) {
      var active = l.id === c.active;
      var stop = 'event.stopPropagation();';
      var del = (l.id === PROTECTED_ID)
        ? '<span class="wdg-mgr-lock" title="Modèle par défaut : non supprimable">' + ICO.lock + '</span>'
        : (l.id === _delConfirm)
          ? '<button class="wdg-mgr-del confirm" onclick="' + stop + 'DTPWidgets.deleteLayout(\'' + l.id + '\')">Supprimer ?</button>'
          : '<button class="wdg-mgr-del" title="Supprimer ce layout" onclick="' + stop + 'DTPWidgets.askDelete(\'' + l.id + '\')">'
            + '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6.5 7l1 12a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12"/><path d="M10 11v6M14 11v6"/></svg></button>';
      return '<div class="wdg-mgr-card' + (active ? ' on' : '') + (l.hidden ? ' is-hidden' : '') + (l.id === _peek ? ' peek' : '') + '" data-i="' + li + '"'
        + ' role="button" tabindex="0" title="' + esc(l.name) + ' · ouvrir"'
        + ' onclick="DTPWidgets.switchLayout(\'' + l.id + '\')"'
        + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();DTPWidgets.switchLayout(\'' + l.id + '\');}">'
        + '<span class="wdg-mgr-grip" title="Glisser pour réordonner">' + ICO.grip + '</span>'
        + '<button class="wdg-mgr-chev" title="Aperçu de la disposition" aria-expanded="' + (l.id === _peek ? 'true' : 'false') + '"'
        +   ' onclick="' + stop + 'DTPWidgets.peekLayout(\'' + l.id + '\')">'
        +   '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
        + '</button>'
        + (active ? '<span class="wdg-mgr-badge">Actif</span>' : (l.hidden ? '<span class="wdg-mgr-badge wdg-mgr-badge--off">Fermé</span>' : ''))
        + '<span class="wdg-mgr-acts">'
        // ÉTOILE MUETTE → PASTILLE LISIBLE (06/08). Un ★ seul dans une rangée de trois icônes
        // n'apprend rien : il fallait survoler pour découvrir ce qu'il faisait. La pastille est à la
        // fois l'INDICATEUR (on voit d'un coup d'œil quel layout s'ouvrira) et la COMMANDE.
        // QUATRE BOUTONS-ICÔNES, comme la capture : étoile (par défaut), crayon (renommer), dossier
        // (afficher/retirer de la barre), corbeille (supprimer). L'étoile redevient icône seule : la
        // pastille avec mot du 06/08 cède devant la reprise à l'identique demandée le 20/08 ; le
        // sens reste écrit en toutes lettres dans la ligne d'aide sous la liste.
        +   '<button class="wdg-mgr-def' + (l.fav ? ' on' : '') + '"'
        +     ' title="' + (l.fav
                  ? 'C\'est le layout qui s\'ouvre à l\'arrivée sur Mon Desk. Cliquer pour ne plus l\'imposer (retour au dernier utilisé).'
                  : 'Faire de « ' + esc(l.name) + ' » le layout qui s\'ouvre à l\'arrivée sur Mon Desk.') + '"'
        +     ' onclick="' + stop + 'DTPWidgets.toggleFav(\'' + l.id + '\')">'
        +     '<i>' + (l.fav ? '★' : '☆') + '</i>'
        +   '</button>'
        // Le crayon appelle le MÊME renommage inline que le double-clic : un chemin visible de plus
        // vers une fonction qui existait déjà, pas une seconde implémentation.
        +   '<button class="wdg-mgr-pen" title="Renommer" onclick="' + stop + 'DTPWidgets.editCardName(\'' + l.id + '\', this.closest(\'.wdg-mgr-card\').querySelector(\'.wdg-mgr-nom\'))">'
        +     '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M17 3.5l3.5 3.5L8 19.5 4 20l.5-4z"/></svg>'
        +   '</button>'
        +   '<button class="wdg-mgr-eye' + (l.hidden ? '' : ' on') + '" title="' + (l.hidden ? 'Afficher dans la barre (rouvrir)' : 'Retirer de la barre (fermer)') + '" onclick="' + stop + 'DTPWidgets.toggleHide(\'' + l.id + '\')">'
        +     '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h6.5A1.5 1.5 0 0 1 19 9v1.5"/><path d="M4.8 10.5h15.4l-2 7a1.5 1.5 0 0 1-1.4 1H6.1a1.5 1.5 0 0 1-1.4-1.1z"/></svg>'
        +   '</button>'
        +   del
        + '</span>'
        // Renommage au DOUBLE-CLIC (le simple clic ouvre le layout) — champ masqué jusque-là.
        + '<span class="wdg-mgr-foot">'
        // L'icône est SŒUR du nom, pas son enfant : editCardName REMPLACE le nœud `.wdg-mgr-nom` par
        // un champ de saisie ; imbriquée dedans, l'icône disparaîtrait pendant le renommage.
        +   _layIco(l.ico, 'wdg-mgr-ico')
        +   '<span class="wdg-mgr-nom" ondblclick="' + stop + 'DTPWidgets.editCardName(\'' + l.id + '\', this)">' + esc(l.name) + '</span>'
        +   '<span class="wdg-mgr-count">' + l.items.length + ' widget' + (l.items.length > 1 ? 's' : '') + '</span>'
        + '</span>'
        + '<span class="wdg-mgr-face">' + _thumb(l.items, { labels: true }) + '</span>'
        + '</div>';
    }).join('')
      + '</div>'
      + (c.layouts.length >= _LMAX ? '<div class="wdg-mgr-full">Plafond de ' + _LMAX + ' layouts atteint.</div>' : '')
      // Les MODÈLES PRÊTS ne vivent plus ici (ils brouillaient la création) : ils restent dans la bibliothèque.
      // Textes d'aide RETIRÉS (20/08, « enlève le texte inutile ») : le sens de l'étoile vit dans son
      // infobulle, les modèles prêts dans la bibliothèque, l'export/import de l'ensemble dans le pied
      // du volet. exportLayout/importLayout (unitaires) restent dans l'API mais sans bouton : assumé.
      + '';
  }
  // Petit mot de statut (export/import…) — même bandeau que « Annuler », SANS bouton : volatil, 5 s.
  function _wdgNote(msg) {
    var old = document.querySelector('.wdg-undo'); if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'wdg-undo';
    el.innerHTML = '<span class="wdg-undo-t">' + esc(msg) + '</span>';
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 5000);
  }
  // Icônes de widget (dessins DTP originaux) — par id, repli sur l'icône de sa catégorie.
  var WICO = {
    'notes': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5h14v15H5z"/><path d="M8.5 9h7M8.5 13h7M8.5 17h4"/></svg>',
    'ticklist': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h9M4 12h9M4 17.5h9"/><path d="m16 6 2 2 4-4M16 17l2 2 4-4"/></svg>',
    'amplitude-seance': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h11M4 12h16M4 18h7"/></svg>',
    'distribution-variations': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M5.5 20v-3M9 20v-8M12 20v-12M15 20v-8M18.5 20v-3"/></svg>',
    'stats-volatilite': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5v14M21 5v14" opacity=".4"/><path d="M6 12c1.5-4 3-4 4.5 0s3 6 4.5 0 2.5-3 3 0"/></svg>',
    'heatmap-seance': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1" fill="currentColor" opacity=".35" stroke="none"/><rect x="3.5" y="13.5" width="7" height="7" rx="1" fill="currentColor" opacity=".55" stroke="none"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/></svg>',
    'amplitude-jour': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 19h16"/><path d="M12 8v8"/><path d="M9.5 10.5 12 8l2.5 2.5M9.5 13.5 12 16l2.5-2.5"/></svg>',
    'hauts-bas': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 18h16"/><path d="M12 6v12" opacity=".45"/><circle cx="12" cy="13" r="2.2" fill="currentColor" stroke="none"/></svg>',
    'bandeau-ticker': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h5M11 8h4M18 8h3M3 16h3M9 16h6M18 16h3"/><path d="M2 12h20" opacity=".35"/></svg>',
    'matrice-croisee': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 9h17M3.5 14.5h17M9 3.5v17M14.5 3.5v17"/></svg>',
    'saison-courbe': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="M6 12V7M9.5 12v3.5M13 12V6M16.5 12v4M20 12V9"/></svg>',
    'frequence-amplitude': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h4v4h4v4h4v4h5"/><path d="M3 20h18" opacity=".4"/></svg>',
    'evenement-rebours': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2"/><path d="M9.5 2.5h5"/></svg>',
    'serie-indicateur': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M6 20v-5M10.5 20v-9M15 20v-6M19.5 20v-11"/></svg>',
    'horloge': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></svg>',
    'graphique': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 4v3M8 17v3M16 4v3M16 17v3"/><rect x="6" y="7" width="4" height="10" rx="1"/><rect x="14" y="7" width="4" height="10" rx="1" fill="currentColor" stroke="none" opacity=".55"/></svg>',
    'force-devises': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 6-8"/><path d="M18 6h3v3"/></svg>',
    'barometre': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 12v-5M9 12v-8M13 12v-3M17 12v-7M5 12v4M9 12v2M13 12v6M17 12v3"/><path d="M3 12h18" opacity=".45"/></svg>',
    'classement-devises': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 6h10M4 12h14M4 18h7"/><circle cx="20" cy="6" r="1.4" fill="currentColor" stroke="none"/></svg>',
    'risque-historique': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16c2-1 3-6 5-6s3 8 5 8 3-11 5-11 2 4 3 4"/></svg>',
    'calendrier-jour': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8 3.5v3M16 3.5v3"/></svg>',
    'radar-biais': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" opacity=".4"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
    'taux-diff': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v18"/><path d="M12 6h6"/><path d="M12 11H6"/><path d="M12 16h4"/></svg>',
    'taux-cb': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M6 20V9l6-4 6 4v11"/><path d="M9 20v-5h6v5"/></svg>',
    'courbe-taux-us': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17c4-1 6-2.5 8-5s4-4.5 8-6"/><circle cx="4" cy="17" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="20" cy="6" r="1.2" fill="currentColor" stroke="none"/></svg>',
    'reunion-bc': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="13" height="13" rx="2"/><path d="M3.5 9.5h13M7 3.5v3M13 3.5v3"/><circle cx="17.5" cy="16.5" r="4"/><path d="M17.5 14.8v1.9l1.3 1"/></svg>',
    'correlations': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="7.5" r="3.2"/><circle cx="16.5" cy="16.5" r="3.2"/><path d="M10 10l4 4"/><path d="M16.5 4.5v3M15 6h3M6 15.5h3" opacity=".5"/></svg>',
    'vol-horaire': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M5.5 20v-4M9 20v-9M12.5 20v-6M16 20v-3"/><circle cx="18.5" cy="7" r="3.4"/><path d="M18.5 5.6V7l1.1.8"/></svg>',
    'ecart-consensus': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4" opacity=".5"/><circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/></svg>',
    'perf-semaine': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v16"/><path d="M5 7h13M5 12h9M5 17h5"/><circle cx="20.5" cy="7" r="1.2" fill="currentColor" stroke="none"/></svg>',
    'risque-jauge': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l4-4"/><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none"/></svg>',
    'cot-devise':  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 12h7M13 12h7" opacity=".5"/><rect x="4" y="8" width="7" height="3.2" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="12.8" width="7" height="3.2" rx="1" fill="currentColor" stroke="none" opacity=".55"/></svg>',
    'cot-inst': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 12h7M13 12h7" opacity=".5"/><rect x="4" y="8" width="7" height="3.2" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="12.8" width="7" height="3.2" rx="1" fill="currentColor" stroke="none" opacity=".55"/></svg>',
    'dmx-paire':  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M13.5 20c.3-2.3 1.8-3.6 3.5-3.6S20 17.7 20.5 20"/></svg>',
    'dmx-retail': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M13.5 20c.3-2.3 1.8-3.6 3.5-3.6S20 17.7 20.5 20"/></svg>',
    'saison': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 12h18" opacity=".45"/><path d="M5 12V8M9 12v-4M9 12v3M13 12v-6M17 12V9M17 12v4M21 12v-2"/></svg>',
    'sessions': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>',
    'fil-news': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 6h14M5 10.5h14M5 15h9"/><circle cx="18.5" cy="17.5" r="2" /></svg>',
    'calculatrice': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 7.5h7"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/></svg>',
    'journal-mini': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z"/><path d="M6 3.5v17M9.5 8h5.5M9.5 12h5.5"/></svg>',
    'onglets': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3.5" y="6.5" width="17" height="14" rx="2"/><path d="M3.5 11h17M8 6.5V4M13 6.5V4M18 6.5V4"/></svg>',
    // Vues du desk (adoption des onglets de la nav) — dessins DTP distincts de leurs cousins compacts.
    'vue-fxlist': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 6h9M4 12h9M4 18h9"/><path d="M17 8l3-3 3 3" transform="translate(-3 1)"/><path d="M17 15l3 3 3-3" transform="translate(-3 1)"/></svg>',
    'vue-institution': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h9l3 3v14H6z"/><path d="M15 3.5v3h3"/><circle cx="11" cy="13" r="3.2"/><path d="M7.8 13h6.4M11 9.8c1.6 2 1.6 4.4 0 6.4M11 9.8c-1.6 2-1.6 4.4 0 6.4"/></svg>',
    'vue-analyst': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5H5z"/><path d="M8 8h6M8 12h6M8 16h3.5"/><path d="M15.5 20.5l5-5 1.5 1.5-5 5H15.5z" fill="currentColor" stroke="none" opacity=".8"/></svg>',
    'vue-bias': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity=".55"/><rect x="4" y="13" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity=".3"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    'vue-weekahead': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M8 3.5v3M16 3.5v3"/><path d="M7 15c1.5-1 2-4 3.5-4s2 5 3.5 5 2-6 3-6"/></svg>',
    'vue-taux': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M18.5 5.5l-13 13"/><circle cx="7.5" cy="7.5" r="2.6"/><circle cx="16.5" cy="16.5" r="2.6"/></svg>',
    'vue-bank': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l8-5 8 5"/><path d="M6 9v8M10 9v8M14 9v8M18 9v8"/><path d="M4 20.5h16"/><path d="M14 13l3-3 3 3" opacity=".0"/></svg>',
  };
  // APERÇUS visuels de widget (vignettes de la bibliothèque, façon terminal pro) — dessins DTP originaux,
  // chaque vignette évoque le RENDU réel du widget (courbes, barres, matrice…). viewBox commun 120×56.
  var _PV = 'viewBox="0 0 120 56" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"';
  var WPREV = {
    'taux-diff': '<svg ' + _PV + '><line x1="60" y1="8" x2="60" y2="48" stroke="#3a3f4b"/>' + (function () { var v = [22, 14, 6, -8, -18], h = ''; for (var i = 0; i < 5; i++) { var y = 11 + i * 8, w = Math.abs(v[i]) * 1.6; h += '<rect x="' + (v[i] >= 0 ? 60 : 60 - w) + '" y="' + y + '" width="' + w + '" height="5" rx="1" fill="' + (v[i] >= 0 ? '#00e676' : '#ff3d00') + '" opacity=".8"/>'; } return h; })() + '</svg>',
    'courbe-taux-us': '<svg ' + _PV + '>'
      + '<line x1="8" y1="46" x2="112" y2="46" stroke="#23232a"/>'
      + '<polyline points="14,38 45,29 78,20 106,13" fill="none" stroke="#e3b23a" stroke-width="1.6"/>'
      + '<circle cx="14" cy="38" r="2" fill="#e3b23a"/><circle cx="45" cy="29" r="2" fill="#e3b23a"/>'
      + '<circle cx="78" cy="20" r="2" fill="#e3b23a"/><circle cx="106" cy="13" r="2" fill="#e3b23a"/>'
      + '<text x="10" y="55" font-size="6" fill="#6b7280">3 mois</text>'
      + '<text x="94" y="55" font-size="6" fill="#6b7280">30 ans</text>'
      + '</svg>',
    'reunion-bc': '<svg ' + _PV + '>'
      + (function () { var L = [['#e3b23a', '#ffb300', 30], ['#3a3d44', '#00e676', 24], ['#3a3d44', '#ff3d00', 20]], h = '';
      for (var i = 0; i < 3; i++) { var y = 8 + i * 15;
        h += '<rect x="8" y="' + y + '" width="2" height="9" fill="' + L[i][0] + '"' + (i ? ' opacity="0"' : '') + '/>'
          + '<circle cx="18" cy="' + (y + 4.5) + '" r="4" fill="#7d94b5" opacity=".55"/>'
          + '<rect x="27" y="' + (y + 2) + '" width="24" height="5" rx="2" fill="#9aa1ac" opacity=".6"/>'
          + '<rect x="60" y="' + (y + 2) + '" width="18" height="5" rx="2" fill="#6b7280" opacity=".8"/>'
          + '<rect x="86" y="' + (y + 2) + '" width="' + L[i][2] + '" height="5" rx="2" fill="' + L[i][1] + '" opacity=".75"/>'; }
      return h; })()
      + '</svg>',
    'correlations': '<svg ' + _PV + '>'
      // Triangle inférieur d'une matrice 5×5 : cellules vertes/rouges d'intensité variable.
      + (function () { var v = [[.9], [.6, -.8], [.3, .5, -.4], [-.7, .2, .8, -.3]], h = '';
      for (var li = 0; li < 4; li++) { for (var co = 0; co <= li; co++) { var r = v[li][co], a = Math.abs(r);
        h += '<rect x="' + (26 + co * 20) + '" y="' + (6 + li * 12) + '" width="18" height="10" rx="1.5"'
          + ' fill="' + (r >= 0 ? '#00e676' : '#ff3d00') + '" opacity="' + (0.15 + a * 0.55).toFixed(2) + '"/>'; }
        h += '<rect x="8" y="' + (9 + li * 12) + '" width="14" height="4" rx="1.5" fill="#6b7280" opacity=".7"/>'; }
      return h; })()
      + '</svg>',
    'vol-horaire': '<svg ' + _PV + '>'
      + '<line x1="6" y1="46" x2="114" y2="46" stroke="#23232a"/>'
      // Le profil type d'une journée FX : creux la nuit, bosse Europe, pic à l'ouverture US.
      + (function () { var v = [5, 4, 4, 5, 6, 8, 12, 18, 22, 19, 16, 14, 15, 24, 32, 34, 28, 20, 14, 10, 8, 6, 5, 5], h = '';
      for (var i = 0; i < 24; i++) {
        h += '<rect x="' + (7 + i * 4.5) + '" y="' + (46 - v[i]) + '" width="3.4" height="' + v[i] + '"'
          + (i === 15 ? ' fill="#e3b23a"' : ' fill="#e3b23a" opacity=".38"') + '/>'; }
      return h; })()
      + '<text x="7" y="54" font-size="6" fill="#6b7280">0h</text>'
      + '<text x="100" y="54" font-size="6" fill="#6b7280">23h</text>'
      + '</svg>',
    'ecart-consensus': '<svg ' + _PV + '>'
      + (function () { var L = [['#00e676', 26], ['#ff3d00', 20], ['#00e676', 24], ['#ffb300', 16]], h = '';
      for (var i = 0; i < 4; i++) { var y = 7 + i * 12;
        h += '<circle cx="12" cy="' + (y + 3) + '" r="3.4" fill="#7d94b5" opacity=".55"/>'
          + '<rect x="20" y="' + y + '" width="38" height="5" rx="2" fill="#9aa1ac" opacity=".6"/>'
          + '<rect x="64" y="' + y + '" width="16" height="5" rx="2" fill="#6b7280" opacity=".8"/>'
          + '<rect x="86" y="' + y + '" width="' + L[i][1] + '" height="5" rx="2" fill="' + L[i][0] + '" opacity=".75"/>'; }
      return h; })()
      + '</svg>',
    'perf-semaine': '<svg ' + _PV + '>'
      + '<line x1="60" y1="4" x2="60" y2="52" stroke="#3a3f4b"/>'
      + (function () { var v = [24, 16, 8, -6, -14, -22], h = '';
      for (var i = 0; i < 6; i++) { var y = 6 + i * 8, w = Math.abs(v[i]) * 1.5;
        h += '<rect x="8" y="' + (y + .5) + '" width="12" height="4" rx="1.5" fill="#6b7280" opacity=".7"/>'
          + '<rect x="' + (v[i] >= 0 ? 60 : 60 - w) + '" y="' + y + '" width="' + w + '" height="5" rx="1"'
          + ' fill="' + (v[i] >= 0 ? '#00e676' : '#ff3d00') + '" opacity=".8"/>'; }
      return h; })()
      + '</svg>',

    'notes': '<svg ' + _PV + '>'
      + '<rect x="8" y="6" width="104" height="36" rx="3" fill="#0d0d10" stroke="#23232a"/>'
      + '<rect x="14" y="12" width="78" height="3.5" rx="1.5" fill="#9aa1ac" opacity=".7"/>'
      + '<rect x="14" y="20" width="90" height="3.5" rx="1.5" fill="#6b7280" opacity=".55"/>'
      + '<rect x="14" y="28" width="56" height="3.5" rx="1.5" fill="#6b7280" opacity=".55"/>'
      + '<rect x="72" y="27" width="1.6" height="6" fill="#e3b23a"/>'
      + '<circle cx="14" cy="49" r="2.4" fill="#22c55e"/>'
      + '<rect x="21" y="47.5" width="32" height="3" rx="1.5" fill="#3a3d44"/>'
      + '<rect x="88" y="47.5" width="24" height="3" rx="1.5" fill="#2b2b31"/>'
      + '</svg>',
    'ticklist': '<svg ' + _PV + '>'
      + (function () { var v = [.6, -.3, .9, -.7], h = '';
      for (var i = 0; i < 4; i++) { var y = 7 + i * 12;
      h += '<rect x="8" y="' + y + '" width="30" height="4" rx="1.5" fill="#6b7280" opacity=".8"/>'
        + '<rect x="48" y="' + y + '" width="28" height="4" rx="1.5" fill="#9aa1ac" opacity=".55"/>'
        + '<rect x="86" y="' + y + '" width="' + (14 + Math.abs(v[i]) * 12) + '" height="4" rx="1.5" fill="' + (v[i] >= 0 ? '#00e676' : '#ff3d00') + '" opacity=".8"/>'; }
      return h; })()
      + '</svg>',
    'amplitude-seance': '<svg ' + _PV + '>'
      + (function () { var L = [['Tokyo', 34, '#8c4a5e'], ['Londres', 92, '#b8860b'], ['New York', 68, '#4a7c59']], h = '';
      for (var i = 0; i < 3; i++) { var y = 9 + i * 15;
        h += '<text x="8" y="' + (y + 6) + '" font-size="7" fill="#9aa1ac">' + L[i][0] + '</text>'
          + '<rect x="42" y="' + y + '" width="66" height="7" rx="2" fill="#23232a"/>'
          + '<rect x="42" y="' + y + '" width="' + (66 * L[i][1] / 100) + '" height="7" rx="2" fill="' + L[i][2] + '"/>'; }
      return h; })()
      + '</svg>',
    'distribution-variations': '<svg ' + _PV + '>' + '<line x1="6" y1="46" x2="114" y2="46" stroke="#23232a"/>' + (function () { var v = [2, 4, 8, 14, 22, 31, 36, 30, 21, 13, 7, 3], h = ''; for (var i = 0; i < 12; i++) h += '<rect x="' + (8 + i * 9) + '" y="' + (46 - v[i]) + '" width="7" height="' + v[i] + '"' + ' fill="' + (i < 6 ? '#ff3d00' : '#00e676') + '" opacity=".55"/>'; return h; })() + '<line x1="62" y1="6" x2="62" y2="50" stroke="#e3b23a" stroke-dasharray="2 3" opacity=".6"/>' + '</svg>',
    'stats-volatilite': '<svg ' + _PV + '>'
      + '<line x1="60" y1="6" x2="60" y2="50" stroke="#23232a"/>'
      + '<text x="10" y="12" font-size="7" fill="#6b7280">SÉANCE</text>'
      + '<text x="68" y="12" font-size="7" fill="#6b7280">SEMAINE</text>'
      + '<rect x="10" y="18" width="30" height="8" rx="2" fill="#3b82f6" opacity=".6"/>'
      + '<rect x="10" y="32" width="42" height="8" rx="2" fill="#22c55e" opacity=".6"/>'
      + '<rect x="68" y="18" width="40" height="8" rx="2" fill="#3b82f6" opacity=".6"/>'
      + '<rect x="68" y="32" width="28" height="8" rx="2" fill="#22c55e" opacity=".6"/>'
      + '<text x="10" y="49" font-size="6.5" fill="#5b5d66">écart-type · amplitude vraie</text>'
      + '</svg>',
    'heatmap-seance': '<svg ' + _PV + '>' + (function () { var h = '', v = [.9,.5,.2,-.3,-.8,.6,.1,-.5,.7,-.2,.4,-.9,.3,-.6,.8,-.1,.5,-.4,.2,-.7,.6,-.3,.9,.1]; for (var i = 0; i < 24; i++) { var x = 5 + (i % 8) * 14, y = 6 + Math.floor(i / 8) * 15, a = Math.min(Math.abs(v[i]), 1); h += '<rect x="' + x + '" y="' + y + '" width="12" height="13" rx="1.5" fill="' + (v[i] >= 0 ? '#00e676' : '#ff3d00') + '" opacity="' + (0.12 + a * 0.6).toFixed(2) + '"/>'; } return h; })() + '</svg>',
    'amplitude-jour': '<svg ' + _PV + '>'
      + '<line x1="6" y1="46" x2="114" y2="46" stroke="#23232a"/>'
      + (function () { var v = [22, 30, 17, 34, 25, 12, 28, 20, 33, 16, 26, 23], moy = 24, h = '';
      for (var i = 0; i < 12; i++) h += '<rect x="' + (8 + i * 9) + '" y="' + (46 - v[i]) + '" width="6" height="' + v[i] + '"'
        + ' fill="' + (v[i] >= moy ? '#22c55e' : '#ef4444') + '" opacity=".5"/>';
      return h; })()
      + '<line x1="6" y1="22" x2="114" y2="22" stroke="#e3b23a" stroke-dasharray="3 3"/>'
      + '<text x="110" y="18" text-anchor="end" font-size="7" fill="#e3b23a">moy.</text>'
      + '</svg>',
    'hauts-bas': '<svg ' + _PV + '>' + '<line x1="14" y1="12" x2="106" y2="12" stroke="#00e676" stroke-width="1.6"/>' + '<line x1="14" y1="44" x2="106" y2="44" stroke="#ff3d00" stroke-width="1.6"/>' + '<rect x="14" y="26" width="92" height="4" rx="2" fill="#23232a"/>' + '<rect x="14" y="26" width="58" height="4" rx="2" fill="#e3b23a" opacity=".55"/>' + '<circle cx="72" cy="28" r="4" fill="#e3b23a"/>' + '</svg>',
    'bandeau-ticker': '<svg ' + _PV + '>'
      + '<rect x="4" y="16" width="112" height="24" rx="3" fill="#141418" stroke="#23232a"/>'
      + (function () { var A = [[8, 20, '#22c55e'], [34, 22, '#ef4444'], [60, 17, '#22c55e'], [84, 19, '#3b82f6']], h = '';
      for (var i = 0; i < 4; i++) { var x = A[i][0];
        h += '<rect x="' + x + '" y="21" width="' + A[i][1] + '" height="3.5" rx="1.5" fill="#9aa1ac" opacity=".75"/>'
          + '<rect x="' + x + '" y="27" width="' + (A[i][1] - 6) + '" height="3.5" rx="1.5" fill="#6b7280"/>'
          + '<rect x="' + x + '" y="33" width="' + (A[i][1] - 10) + '" height="3" rx="1.5" fill="' + A[i][2] + '"/>'; }
      return h; })()
      + '<path d="M110 24 L114 28 L110 32" fill="none" stroke="#3a3d44" stroke-width="1.4"/>'
      + '</svg>',
    'matrice-croisee': '<svg ' + _PV + '>' + (function () { var h = '', C = ['#22c55e', '#ff3d00', '#3a3d44', '#22c55e', '#3a3d44', '#ff3d00']; for (var r = 0; r < 4; r++) for (var c = 0; c < 6; c++) { var mort = (r === c); h += '<rect x="' + (14 + c * 17) + '" y="' + (8 + r * 11) + '" width="16" height="10"' + ' fill="' + (mort ? '#1c1c20' : C[(r + c) % 6]) + '" opacity="' + (mort ? '1' : '.5') + '"/>'; } for (var i = 0; i < 4; i++) h += '<rect x="4" y="' + (10 + i * 11) + '" width="8" height="6" rx="1" fill="#6b7280"/>'; for (var j = 0; j < 6; j++) h += '<rect x="' + (16 + j * 17) + '" y="2" width="12" height="4" rx="1" fill="#6b7280"/>'; return h; })() + '</svg>',
    'saison-courbe': '<svg ' + _PV + '>' + '<line x1="6" y1="30" x2="114" y2="30" stroke="#3a3d44"/>' + (function () { var v = [8, -5, 12, 6, -9, 3, 14, -4, 7, -11, 5, 10], h = ''; for (var i = 0; i < 12; i++) { var y = v[i] >= 0 ? 30 - v[i] * 1.6 : 30, ht = Math.abs(v[i]) * 1.6; h += '<rect x="' + (7 + i * 9) + '" y="' + y + '" width="6" height="' + ht + '"' + ' fill="' + (v[i] >= 0 ? '#00e676' : '#ff3d00') + '" opacity=".85"/>'; } return h; })() + '<rect x="61" y="6" width="6" height="44" fill="#e3b23a" opacity=".14"/>' + '</svg>',
    'frequence-amplitude': '<svg ' + _PV + '>'
      + '<line x1="6" y1="46" x2="114" y2="46" stroke="#23232a"/>'
      + (function () { var v = [40, 34, 27, 21, 15, 10, 6], h = '';
      for (var i = 0; i < 7; i++) h += '<rect x="' + (9 + i * 15) + '" y="' + (46 - v[i]) + '" width="11" height="' + v[i] + '"'
        + ' fill="' + (i < 2 ? '#22c55e' : i < 5 ? '#ffb300' : '#ef4444') + '" opacity=".45"/>';
      return h; })()
      + '<polyline fill="none" stroke="#e3b23a" stroke-width="1.6" points="14,6 29,12 44,19 59,25 74,31 89,36 104,40"/>'
      + '<circle cx="59" cy="25" r="2.8" fill="#e3b23a"/>'
      + '</svg>',
    'evenement-rebours': '<svg ' + _PV + '>'
      + '<circle cx="13" cy="12" r="4.5" fill="#3b82f6" opacity=".7"/>'
      + '<rect x="22" y="9.5" width="18" height="5" rx="1.5" fill="#9aa1ac" opacity=".7"/>'
      + '<circle cx="46" cy="12" r="1.8" fill="#ef4444"/><circle cx="52" cy="12" r="1.8" fill="#ef4444"/><circle cx="58" cy="12" r="1.8" fill="#ef4444"/>'
      + (function () { var h = '';
      for (var i = 0; i < 3; i++) { var x = 20 + i * 26;
        h += '<rect x="' + x + '" y="21" width="20" height="14" rx="2" fill="#e3b23a" opacity=".85"/>';
        if (i < 2) h += '<circle cx="' + (x + 23) + '" cy="25" r="1.3" fill="#6b7280"/><circle cx="' + (x + 23) + '" cy="31" r="1.3" fill="#6b7280"/>'; }
      return h; })()
      + '<rect x="20" y="42" width="34" height="4" rx="1.5" fill="#3a3d44"/>'
      + '<rect x="60" y="42" width="26" height="4" rx="1.5" fill="#22c55e" opacity=".55"/>'
      + '</svg>',
    'serie-indicateur': '<svg ' + _PV + '>' + '<line x1="6" y1="44" x2="114" y2="44" stroke="#23232a"/>' + (function () { var v = [14, 20, 17, 26, 23, 32], h = ''; for (var i = 0; i < 6; i++) { var c = i === 0 ? '#e3b23a' : (v[i] > v[i - 1] ? '#00e676' : '#ff3d00'); h += '<rect x="' + (10 + i * 17) + '" y="' + (44 - v[i]) + '" width="12" height="' + v[i] + '" fill="' + c + '" opacity=".75"/>'; } return h; })() + '<rect x="10" y="48" width="96" height="3" rx="1" fill="#3a3d44" opacity=".6"/>' + '</svg>',
    // Aperçu du Graphique (13/08) : il MANQUAIT — la carte retombait sur l icône de 17 px, perdue
    // dans une vignette de 120×56, d où l impression de carte vide. Série choisie à la main pour
    // raconter une vraie forme de marché (impulsion, repli, reprise) plutôt que du bruit, avec la
    // ligne de dernier prix en or, comme sur le vrai graphique.
    'graphique': '<svg ' + _PV + '><line x1="6" y1="50" x2="114" y2="50" stroke="#23232a"/><line x1="6" y1="29" x2="114" y2="29" stroke="#1c1c20" stroke-dasharray="2 3"/><line x1="10.5" y1="35.3" x2="10.5" y2="50" stroke="#22c55e" stroke-width="1"/><rect x="8" y="39.5" width="5" height="8.4" fill="#22c55e"/><line x1="18.9" y1="37.4" x2="18.9" y2="47.9" stroke="#ef4444" stroke-width="1"/><rect x="16.4" y="39.5" width="5" height="4.2" fill="#ef4444"/><line x1="27.3" y1="31.1" x2="27.3" y2="45.8" stroke="#22c55e" stroke-width="1"/><rect x="24.8" y="33.2" width="5" height="10.5" fill="#22c55e"/><line x1="35.7" y1="20.6" x2="35.7" y2="35.3" stroke="#22c55e" stroke-width="1"/><rect x="33.2" y="24.8" width="5" height="8.4" fill="#22c55e"/><line x1="44.1" y1="22.7" x2="44.1" y2="33.2" stroke="#ef4444" stroke-width="1"/><rect x="41.6" y="24.8" width="5" height="4.2" fill="#ef4444"/><line x1="52.5" y1="16.4" x2="52.5" y2="31.1" stroke="#22c55e" stroke-width="1"/><rect x="50" y="18.5" width="5" height="10.5" fill="#22c55e"/><line x1="60.9" y1="14.3" x2="60.9" y2="24.8" stroke="#ef4444" stroke-width="1"/><rect x="58.4" y="18.5" width="5" height="4.2" fill="#ef4444"/><line x1="69.3" y1="20.6" x2="69.3" y2="37.4" stroke="#ef4444" stroke-width="1"/><rect x="66.8" y="22.7" width="5" height="10.5" fill="#ef4444"/><line x1="77.7" y1="31.1" x2="77.7" y2="45.8" stroke="#ef4444" stroke-width="1"/><rect x="75.2" y="33.2" width="5" height="8.4" fill="#ef4444"/><line x1="86.1" y1="33.2" x2="86.1" y2="43.7" stroke="#22c55e" stroke-width="1"/><rect x="83.6" y="37.4" width="5" height="4.2" fill="#22c55e"/><line x1="94.5" y1="24.8" x2="94.5" y2="39.5" stroke="#22c55e" stroke-width="1"/><rect x="92" y="26.9" width="5" height="10.5" fill="#22c55e"/><line x1="102.9" y1="14.3" x2="102.9" y2="29" stroke="#22c55e" stroke-width="1"/><rect x="100.4" y="18.5" width="5" height="8.4" fill="#22c55e"/><line x1="111.3" y1="8" x2="111.3" y2="20.6" stroke="#22c55e" stroke-width="1"/><rect x="108.8" y="12.2" width="5" height="6.3" fill="#22c55e"/><line x1="6" y1="12.2" x2="114" y2="12.2" stroke="#e3b23a" stroke-width=".8" stroke-dasharray="3 2" opacity=".9"/></svg>',
    'force-devises': '<svg ' + _PV + '><line x1="6" y1="28" x2="114" y2="28" stroke="#23232a" stroke-dasharray="2 3"/><polyline fill="none" stroke="#e3b23a" stroke-width="1.4" points="6,34 22,30 36,36 52,26 68,30 84,20 100,24 114,14"/><polyline fill="none" stroke="#22c55e" stroke-width="1.4" points="6,24 22,28 36,22 52,30 68,24 84,28 100,32 114,36"/><polyline fill="none" stroke="#3b82f6" stroke-width="1.4" points="6,30 22,34 36,28 52,36 68,40 84,36 100,42 114,44"/><circle cx="114" cy="14" r="2" fill="#e3b23a"/><circle cx="114" cy="36" r="2" fill="#22c55e"/><circle cx="114" cy="44" r="2" fill="#3b82f6"/></svg>',
    'barometre': '<svg ' + _PV + '><line x1="6" y1="28" x2="114" y2="28" stroke="#3a3d44"/><rect x="10" y="12" width="7" height="16" fill="#22c55e"/><rect x="23" y="18" width="7" height="10" fill="#22c55e"/><rect x="36" y="8" width="7" height="20" fill="#22c55e"/><rect x="49" y="22" width="7" height="6" fill="#22c55e"/><rect x="62" y="28" width="7" height="9" fill="#ef4444"/><rect x="75" y="28" width="7" height="16" fill="#ef4444"/><rect x="88" y="28" width="7" height="6" fill="#ef4444"/><rect x="101" y="28" width="7" height="19" fill="#ef4444"/></svg>',
    'risque-historique': '<svg ' + _PV + '><line x1="6" y1="28" x2="114" y2="28" stroke="#ff9800" stroke-width="1.2"/><rect x="8" y="18" width="5" height="10" fill="#22c55e"/><rect x="16" y="22" width="5" height="6" fill="#22c55e"/><rect x="24" y="14" width="5" height="14" fill="#22c55e"/><rect x="32" y="28" width="5" height="7" fill="#ef4444"/><rect x="40" y="28" width="5" height="12" fill="#ef4444"/><rect x="48" y="28" width="5" height="17" fill="#ef4444"/><rect x="56" y="28" width="5" height="8" fill="#ef4444"/><rect x="64" y="16" width="5" height="12" fill="#22c55e"/><rect x="72" y="12" width="5" height="16" fill="#22c55e"/><rect x="80" y="20" width="5" height="8" fill="#22c55e"/><rect x="88" y="28" width="5" height="6" fill="#ef4444"/><rect x="96" y="18" width="5" height="10" fill="#22c55e"/><rect x="104" y="14" width="5" height="14" fill="#22c55e"/></svg>',
    'calendrier-jour': '<svg ' + _PV + '><g font-family="monospace" font-size="6" fill="#5b5d66"><text x="8" y="13">08:30</text><text x="8" y="26">10:00</text><text x="8" y="39">14:30</text><text x="8" y="52">16:00</text></g><rect x="34" y="7" width="52" height="6" rx="2" fill="#2b2b31"/><rect x="34" y="20" width="64" height="6" rx="2" fill="#2b2b31"/><rect x="34" y="33" width="44" height="6" rx="2" fill="#2b2b31"/><rect x="34" y="46" width="58" height="6" rx="2" fill="#2b2b31"/><circle cx="108" cy="10" r="3" fill="#ef4444"/><circle cx="108" cy="23" r="3" fill="#ffb300"/><circle cx="108" cy="36" r="3" fill="#5b5d66"/><circle cx="108" cy="49" r="3" fill="#ef4444"/></svg>',
    'radar-biais': '<svg ' + _PV + '><g font-family="monospace" font-size="6.5" fill="#9aa1ac"><text x="7" y="14">USD</text><text x="7" y="28">EUR</text><text x="7" y="42">GBP</text><text x="7" y="55">JPY</text></g><g rx="2"><rect x="30" y="7" width="24" height="9" rx="2" fill="#047857"/><rect x="58" y="7" width="24" height="9" rx="2" fill="#059669"/><rect x="86" y="7" width="26" height="9" rx="2" fill="#047857"/><rect x="30" y="21" width="24" height="9" rx="2" fill="#6b7280"/><rect x="58" y="21" width="24" height="9" rx="2" fill="#059669"/><rect x="86" y="21" width="26" height="9" rx="2" fill="#6b7280"/><rect x="30" y="35" width="24" height="9" rx="2" fill="#059669"/><rect x="58" y="35" width="24" height="9" rx="2" fill="#6b7280"/><rect x="86" y="35" width="26" height="9" rx="2" fill="#059669"/><rect x="30" y="49" width="24" height="6" rx="2" fill="#dc2626"/><rect x="58" y="49" width="24" height="6" rx="2" fill="#991b1b"/><rect x="86" y="49" width="26" height="6" rx="2" fill="#dc2626"/></g></svg>',
    'taux-cb': '<svg ' + _PV + '><g font-family="monospace" font-size="6.5" fill="#9aa1ac"><text x="7" y="15">FED</text><text x="7" y="31">BCE</text><text x="7" y="47">BOE</text></g><rect x="30" y="8" width="56" height="8" rx="2" fill="#2b2b31"/><rect x="30" y="24" width="42" height="8" rx="2" fill="#2b2b31"/><rect x="30" y="40" width="48" height="8" rx="2" fill="#2b2b31"/><g font-family="monospace" font-size="7" fill="#e3b23a"><text x="92" y="15">4.50</text><text x="92" y="31">2.15</text><text x="92" y="47">4.00</text></g></svg>',
    'risque-jauge': '<svg ' + _PV + '><path d="M 24 48 A 36 36 0 0 1 60 12" fill="none" stroke="#ef4444" stroke-width="5" stroke-linecap="round"/><path d="M 60 12 A 36 36 0 0 1 96 48" fill="none" stroke="#22c55e" stroke-width="5" stroke-linecap="round"/><line x1="60" y1="48" x2="78" y2="24" stroke="#e6e8ec" stroke-width="2"/><circle cx="60" cy="48" r="3.5" fill="#e6e8ec"/></svg>',
    'cot-inst': '<svg ' + _PV + '><line x1="60" y1="4" x2="60" y2="52" stroke="#3a3d44"/><rect x="60" y="7" width="34" height="7" fill="#22c55e"/><rect x="34" y="18" width="26" height="7" fill="#ef4444"/><rect x="60" y="29" width="20" height="7" fill="#22c55e"/><rect x="18" y="40" width="42" height="7" fill="#ef4444"/></svg>',
    'cot-devise': '<svg ' + _PV + '><circle cx="60" cy="32" r="17" fill="none" stroke="#00e676" stroke-width="8" stroke-dasharray="78 29" transform="rotate(-90 60 32)"/><circle cx="60" cy="32" r="17" fill="none" stroke="#ff3d00" stroke-width="8" stroke-dasharray="29 78" stroke-dashoffset="-78" transform="rotate(-90 60 32)"/></svg>',
    'dmx-paire': '<svg ' + _PV + '><circle cx="60" cy="32" r="17" fill="none" stroke="#ff3d00" stroke-width="8" stroke-dasharray="72 35" transform="rotate(-90 60 32)"/><circle cx="60" cy="32" r="17" fill="none" stroke="#00e676" stroke-width="8" stroke-dasharray="35 72" stroke-dashoffset="-72" transform="rotate(-90 60 32)"/></svg>',
    'dmx-retail': '<svg ' + _PV + '><g font-family="monospace" font-size="6" fill="#9aa1ac"><text x="6" y="13">EURUSD</text><text x="6" y="27">GBPJPY</text><text x="6" y="41">AUDUSD</text><text x="6" y="55">USDCAD</text></g><rect x="40" y="7" width="22" height="8" fill="#22c55e"/><rect x="62" y="7" width="52" height="8" fill="#ef4444"/><rect x="40" y="21" width="44" height="8" fill="#22c55e"/><rect x="84" y="21" width="30" height="8" fill="#ef4444"/><rect x="40" y="35" width="14" height="8" fill="#22c55e"/><rect x="54" y="35" width="60" height="8" fill="#ef4444"/><rect x="40" y="49" width="52" height="6" fill="#22c55e"/><rect x="92" y="49" width="22" height="6" fill="#ef4444"/></svg>',
    'saison': '<svg ' + _PV + '>' + (function () { var cells = '', G = '#14532d', g = '#22c55e', R = '#7f1d1d', r = '#ef4444', D = '#26262c'; var M = [[g, G, D, r, g, G, g, D], [R, g, G, g, D, r, G, g], [g, D, r, G, g, g, R, D]]; for (var yy = 0; yy < 3; yy++) for (var xx = 0; xx < 8; xx++) cells += '<rect x="' + (7 + xx * 14) + '" y="' + (7 + yy * 15) + '" width="12" height="13" rx="2" fill="' + M[yy][xx] + '"/>'; return cells; })() + '</svg>',
    'sessions': '<svg ' + _PV + '><g font-family="monospace" font-size="6" fill="#9aa1ac"><text x="6" y="13">SYD</text><text x="6" y="26">TOK</text><text x="6" y="39">LON</text><text x="6" y="52">NY</text></g><rect x="24" y="7" width="34" height="7" rx="3" fill="#3a3d44"/><rect x="34" y="20" width="36" height="7" rx="3" fill="#3a3d44"/><rect x="56" y="33" width="38" height="7" rx="3" fill="#e3b23a"/><rect x="76" y="46" width="38" height="7" rx="3" fill="#e3b23a" opacity=".65"/></svg>',
    'horloge': '<svg ' + _PV + '><g stroke="#5b5d66" fill="none"><circle cx="26" cy="28" r="13"/><circle cx="60" cy="28" r="13"/><circle cx="94" cy="28" r="13"/></g><g stroke="#e3b23a" stroke-width="1.6" stroke-linecap="round"><path d="M26 28V19M26 28l6 4"/><path d="M60 28v-9M60 28h8"/><path d="M94 28v-9M94 28l-6 6"/></g></svg>',
    'fil-news': '<svg ' + _PV + '><rect x="8" y="8" width="76" height="5" rx="2" fill="#3a3d44"/><rect x="8" y="17" width="26" height="6" rx="3" fill="#2b2b31"/><rect x="38" y="17" width="20" height="6" rx="3" fill="#2b2b31"/><rect x="8" y="31" width="88" height="5" rx="2" fill="#3a3d44"/><rect x="8" y="40" width="22" height="6" rx="3" fill="#7f1d1d"/><rect x="34" y="40" width="24" height="6" rx="3" fill="#2b2b31"/><circle cx="106" cy="10" r="3" fill="#e3b23a"/></svg>',
    'calculatrice': '<svg ' + _PV + '><rect x="34" y="5" width="52" height="10" rx="2" fill="#0f0f12" stroke="#2b2b31"/><text x="80" y="13" text-anchor="end" font-family="monospace" font-size="7" fill="#e3b23a">0.42</text>' + (function () { var k = ''; for (var yy = 0; yy < 3; yy++) for (var xx = 0; xx < 4; xx++) k += '<rect x="' + (34 + xx * 14) + '" y="' + (19 + yy * 11) + '" width="10" height="8" rx="2" fill="' + (xx === 3 ? '#3d3320' : '#26262c') + '"/>'; return k; })() + '</svg>',
    'journal-mini': '<svg ' + _PV + '><g fill="#3a3d44"><rect x="8" y="8" width="42" height="5" rx="2"/><rect x="8" y="21" width="36" height="5" rx="2"/><rect x="8" y="34" width="46" height="5" rx="2"/><rect x="8" y="47" width="32" height="5" rx="2"/></g><g font-family="monospace" font-size="6"><rect x="86" y="6" width="26" height="8" rx="3" fill="#14351f"/><text x="99" y="12.5" text-anchor="middle" fill="#22c55e">+1.8R</text><rect x="86" y="19" width="26" height="8" rx="3" fill="#3a1416"/><text x="99" y="25.5" text-anchor="middle" fill="#ef4444">-1.0R</text><rect x="86" y="32" width="26" height="8" rx="3" fill="#14351f"/><text x="99" y="38.5" text-anchor="middle" fill="#22c55e">+2.4R</text><rect x="86" y="45" width="26" height="8" rx="3" fill="#14351f"/><text x="99" y="51.5" text-anchor="middle" fill="#22c55e">+0.6R</text></g></svg>',
    'onglets': '<svg ' + _PV + '><rect x="6" y="6" width="108" height="12" rx="2" fill="#141416"/><g font-family="monospace" font-size="7"><text x="12" y="14.5" fill="#ffffff">› FORCE</text><text x="48" y="14.5" fill="#6b7280">› RISQUE</text><text x="86" y="14.5" fill="#6b7280">› COT</text></g><rect x="12" y="16" width="27" height="1.5" fill="#e3b23a"/><rect x="6" y="22" width="108" height="28" rx="2" fill="#101013"/><polyline fill="none" stroke="#e3b23a" stroke-width="1.3" points="12,44 28,38 44,42 60,30 76,36 92,26 108,30"/></svg>',
    // ── Vues du desk (adoption) : chaque vignette évoque le rendu réel de L'ONGLET. ──
    'vue-fxlist': '<svg ' + _PV + '><g font-family="monospace" font-size="6" fill="#9aa1ac"><text x="7" y="14">EURUSD</text><text x="7" y="30">GBPJPY</text><text x="7" y="46">XAUUSD</text></g><g font-family="monospace" font-size="6" fill="#e6e8ec"><text x="46" y="14">1.0842</text><text x="46" y="30">188.24</text><text x="46" y="46">2412.5</text></g><g font-family="monospace" font-size="5.6"><rect x="80" y="7" width="32" height="9" rx="3" fill="#14351f"/><text x="96" y="13.6" text-anchor="middle" fill="#22c55e">ACHAT</text><rect x="80" y="23" width="32" height="9" rx="3" fill="#3a1416"/><text x="96" y="29.6" text-anchor="middle" fill="#ef4444">VENTE</text><rect x="80" y="39" width="32" height="9" rx="3" fill="#2b2b31"/><text x="96" y="45.6" text-anchor="middle" fill="#9aa1ac">NEUTRE</text></g></svg>',
    'vue-institution': '<svg ' + _PV + '><g stroke="#3b82f6" fill="none"><circle cx="14" cy="12" r="5"/><circle cx="14" cy="30" r="5"/><circle cx="14" cy="48" r="5"/></g><g fill="#3a3d44"><rect x="26" y="8" width="56" height="5" rx="2"/><rect x="26" y="26" width="64" height="5" rx="2"/><rect x="26" y="44" width="48" height="5" rx="2"/></g><g fill="#26262c"><rect x="26" y="15" width="20" height="4" rx="2"/><rect x="26" y="33" width="26" height="4" rx="2"/><rect x="26" y="51" width="18" height="4" rx="2"/></g><g font-family="monospace" font-size="5.6"><rect x="96" y="7" width="16" height="8" rx="3" fill="#3d3320"/><text x="104" y="13" text-anchor="middle" fill="#e3b23a">PT</text><rect x="96" y="25" width="16" height="8" rx="3" fill="#3d3320"/><text x="104" y="31" text-anchor="middle" fill="#e3b23a">PT</text></g></svg>',
    'vue-analyst': '<svg ' + _PV + '><rect x="7" y="7" width="50" height="42" rx="2" fill="#101013" stroke="#2b2b31"/><rect x="12" y="12" width="26" height="4" rx="2" fill="#e3b23a" opacity=".85"/><g fill="#3a3d44"><rect x="12" y="21" width="40" height="3.5" rx="1.5"/><rect x="12" y="28" width="34" height="3.5" rx="1.5"/><rect x="12" y="35" width="38" height="3.5" rx="1.5"/><rect x="12" y="42" width="24" height="3.5" rx="1.5"/></g><rect x="63" y="7" width="50" height="42" rx="2" fill="#101013" stroke="#2b2b31"/><rect x="68" y="12" width="22" height="4" rx="2" fill="#e3b23a" opacity=".85"/><g font-family="monospace" font-size="5.4"><rect x="68" y="21" width="28" height="8" rx="3" fill="#14351f"/><text x="82" y="27" text-anchor="middle" fill="#22c55e">ACHAT</text><rect x="68" y="33" width="28" height="8" rx="3" fill="#3a1416"/><text x="82" y="39" text-anchor="middle" fill="#ef4444">VENTE</text></g></svg>',
    'vue-bias': '<svg ' + _PV + '><g font-family="monospace" font-size="6" fill="#9aa1ac"><text x="7" y="13">USD</text><text x="7" y="25">EUR</text></g><g><rect x="26" y="6" width="20" height="8" rx="2" fill="#047857"/><rect x="50" y="6" width="20" height="8" rx="2" fill="#6b7280"/><rect x="74" y="6" width="20" height="8" rx="2" fill="#059669"/><rect x="98" y="6" width="14" height="8" rx="2" fill="#dc2626"/><rect x="26" y="18" width="20" height="8" rx="2" fill="#059669"/><rect x="50" y="18" width="20" height="8" rx="2" fill="#dc2626"/><rect x="74" y="18" width="20" height="8" rx="2" fill="#6b7280"/><rect x="98" y="18" width="14" height="8" rx="2" fill="#047857"/></g><rect x="7" y="32" width="105" height="18" rx="2" fill="#101013" stroke="#2b2b31"/><rect x="12" y="37" width="30" height="3.5" rx="1.5" fill="#e3b23a" opacity=".8"/><rect x="12" y="43" width="88" height="3" rx="1.5" fill="#3a3d44"/></svg>',
    'vue-weekahead': '<svg ' + _PV + '><polyline fill="none" stroke="#e3b23a" stroke-width="1.4" points="10,20 30,14 50,18 70,16 90,8 110,18"/><g fill="#e3b23a"><circle cx="10" cy="20" r="2"/><circle cx="30" cy="14" r="2"/><circle cx="50" cy="18" r="2"/><circle cx="70" cy="16" r="2"/><circle cx="90" cy="8" r="2.6"/><circle cx="110" cy="18" r="2"/></g><g font-family="monospace" font-size="5.4" fill="#6b7280"><text x="7" y="30">LUN</text><text x="27" y="30">MAR</text><text x="47" y="30">MER</text><text x="67" y="30">JEU</text><text x="87" y="30">VEN</text></g><rect x="7" y="35" width="105" height="7" rx="2" fill="#2b2b31"/><rect x="7" y="46" width="82" height="7" rx="2" fill="#2b2b31"/><rect x="94" y="46" width="18" height="7" rx="2" fill="#3a1416"/></svg>',
    'vue-taux': '<svg ' + _PV + '><g><rect x="7" y="7" width="50" height="20" rx="2" fill="#101013" stroke="#2b2b31"/><text x="12" y="16" font-family="monospace" font-size="6" fill="#9aa1ac">FED</text><text x="52" y="16" text-anchor="end" font-family="monospace" font-size="7" fill="#e3b23a">3.63</text><rect x="12" y="20" width="40" height="3" rx="1.5" fill="#26262c"/><rect x="12" y="20" width="28" height="3" rx="1.5" fill="#e3b23a" opacity=".8"/></g><g><rect x="63" y="7" width="50" height="20" rx="2" fill="#101013" stroke="#2b2b31"/><text x="68" y="16" font-family="monospace" font-size="6" fill="#9aa1ac">BCE</text><text x="108" y="16" text-anchor="end" font-family="monospace" font-size="7" fill="#e3b23a">2.25</text><rect x="68" y="20" width="40" height="3" rx="1.5" fill="#26262c"/><rect x="68" y="20" width="33" height="3" rx="1.5" fill="#22c55e" opacity=".8"/></g><g><rect x="7" y="31" width="50" height="20" rx="2" fill="#101013" stroke="#2b2b31"/><text x="12" y="40" font-family="monospace" font-size="6" fill="#9aa1ac">BOE</text><text x="52" y="40" text-anchor="end" font-family="monospace" font-size="7" fill="#e3b23a">3.75</text><rect x="12" y="44" width="40" height="3" rx="1.5" fill="#26262c"/><rect x="12" y="44" width="27" height="3" rx="1.5" fill="#26a269" opacity=".8"/></g><g><rect x="63" y="31" width="50" height="20" rx="2" fill="#101013" stroke="#2b2b31"/><text x="68" y="40" font-family="monospace" font-size="6" fill="#9aa1ac">BOJ</text><text x="108" y="40" text-anchor="end" font-family="monospace" font-size="7" fill="#e3b23a">1.00</text><rect x="68" y="44" width="40" height="3" rx="1.5" fill="#26262c"/><rect x="68" y="44" width="26" height="3" rx="1.5" fill="#e3b23a" opacity=".8"/></g></svg>',
    'vue-bank': '<svg ' + _PV + '><g font-family="monospace" font-size="6" fill="#9aa1ac"><text x="7" y="14">GS</text><text x="7" y="30">ING</text><text x="7" y="46">NOM</text></g><g fill="#3a3d44"><rect x="24" y="9" width="30" height="5" rx="2"/><rect x="24" y="25" width="24" height="5" rx="2"/><rect x="24" y="41" width="28" height="5" rx="2"/></g><rect x="62" y="7" width="51" height="42" rx="2" fill="#101013" stroke="#2b2b31"/><polyline fill="none" stroke="#e6e8ec" stroke-width="1.2" points="66,40 74,34 82,38 90,26 98,30 108,20"/><line x1="66" y1="18" x2="110" y2="18" stroke="#22c55e" stroke-dasharray="3 2"/><line x1="66" y1="44" x2="110" y2="44" stroke="#ef4444" stroke-dasharray="3 2"/></svg>',
  };
  var _libQ = '';                            // filtre de recherche de la bibliothèque (volatil)
  var _libFam = '';                          // puce de catégorie active ('' = Tous · 'Analyse de marché' · 'Fonctions' · '_tpl' = modèles)
  var _pickIdx = null;                       // emplacement ('slot') en cours de remplissage depuis la bibliothèque
  var _pickTab = null;                       // index d'item « Panneau à onglets » en cours d'ajout d'onglet
  var _pickTabAt = null;                     // position d'un ONGLET VIDE à remplir (sinon null = ajout en fin)
  var _pickCell = null;                      // { j, c } : CELLULE d'un onglet composite à remplir (06/08)
  var _pickSwap = null;                      // index de la carte à REMPLACER (la bibliothèque sert alors de sélecteur)
  // Les cinq cibles sont EXCLUSIVES : une seule vaut à la fois. Elles étaient remises à zéro de façon
  // incohérente (openLib 2 sur 4, closeLib 3 sur 4, replaceStart 4 sur 4) → une cible fantôme pouvait
  // survivre d'une ouverture de bibliothèque à l'autre et le clic suivant tombait au mauvais endroit.
  // Un seul point d'oubli, appelé partout.
  function _oublieCibles() { _pickIdx = null; _pickTab = null; _pickTabAt = null; _pickCell = null; _pickSwap = null; }
  /* ── DÉPLOIEMENT PAR PALIERS (18/08, décision user pour l'élargissement de la bibliothèque) ──
     Un widget marqué `staff: true` dans le catalogue est ACTIF pour les comptes admin/support et
     affiché « Bientôt » pour les autres : la carte se voit (les clients savent ce qui arrive, comme
     un fil d'annonces), mais ne s'ajoute pas. C'est un PALIER DE PRODUIT, pas une barrière de
     sécurité : les données de ces widgets viennent d'endpoints déjà gardés par la session côté
     serveur. Le rôle vit dans window._pdUser (posé au chargement du desk). */
  function _estStaff() {
    try { var u = window._pdUser; return !!(u && (u.role === 'admin' || u.role === 'support')); }
    catch (e) { return false; }
  }
  function _wBientot(w) { return !!(w && w.staff) && !_estStaff(); }

  var _justAdded = null;                     // id du widget qu'on vient d'ajouter (flash « ✓ Ajouté » sur sa carte)
  // « + » d'un Panneau à onglets → la bibliothèque choisit le SOUS-widget (ajouté comme onglet, pas
  // comme carte). `at` (03/08) : position d'un onglet VIDE → le choix REMPLIT cet onglet-là.
  function _pickTabFor(it, at) {
    var l = activeLayout(); if (!l) return;
    var idx = l.items.indexOf(it); if (idx < 0) return;
    API.openLib(); _pickTab = idx; _pickTabAt = (at == null ? null : at);
  }
  // Idem pour une CELLULE d'onglet composite (06/08). ⚠️ openLib() D'ABORD, cibles ENSUITE :
  // openLib remet toutes les cibles à null, l'ordre inverse effacerait celle qu'on vient de poser.
  function _pickCellFor(it, j, c) {
    var l = activeLayout(); if (!l) return;
    var idx = l.items.indexOf(it); if (idx < 0) return;      // par RÉFÉRENCE : la carte a pu être déplacée
    API.openLib(); _pickTab = idx; _pickCell = { j: j, c: c };
  }
  function renderLib() {
    var box = document.getElementById('wdg-lib-grid'); if (!box) return;
    var lay = activeLayout(), used = {};
    (lay ? lay.items : []).forEach(function (i) { used[i.w] = (used[i.w] || 0) + 1; });
    var q = _libQ.toLowerCase();
    var match = function (w) { return !q || (w.name + ' ' + w.desc + ' ' + w.cat).toLowerCase().indexOf(q) !== -1; };
    // BIBLIOTHÈQUE PAR FAMILLES (23/07) : deux rails, parce qu'un trader ne cherche pas un widget
    // par son nom mais par ce qu'il vient y faire. « Fonctions » = panneaux de données et outils
    // qu'on consulte ; « Analyse de marché » = panneaux qui portent une lecture du marché.
    // FAM_OF mappe chaque widget à sa famille.
    var FAM_OF = {
      'graphique': 'Analyse de marché',
      'force-devises': 'Analyse de marché', 'barometre': 'Analyse de marché', 'risque-historique': 'Analyse de marché', 'radar-biais': 'Analyse de marché',
      'risque-jauge': 'Analyse de marché', 'cot-inst': 'Analyse de marché', 'dmx-retail': 'Analyse de marché', 'dmx-paire': 'Analyse de marché', 'cot-devise': 'Analyse de marché', 'saison': 'Analyse de marché', 'sessions': 'Analyse de marché',
      'courbe-taux-us': 'Analyse de marché', 'reunion-bc': 'Analyse de marché',
      'correlations': 'Analyse de marché', 'vol-horaire': 'Analyse de marché',
      'ecart-consensus': 'Analyse de marché', 'perf-semaine': 'Analyse de marché',
      'calendrier-jour': 'Fonctions', 'taux-cb': 'Fonctions', 'fil-news': 'Fonctions', 'journal-mini': 'Fonctions', 'calculatrice': 'Fonctions',
      'horloge': 'Fonctions', 'onglets': 'Fonctions',
      // Vues du desk (adoption) : troisième famille dédiée — ce sont les onglets de la nav, pas des outils.
      'vue-fxlist': 'Vues du desk', 'vue-institution': 'Vues du desk', 'vue-analyst': 'Vues du desk',
      'vue-bias': 'Vues du desk', 'vue-weekahead': 'Vues du desk', 'vue-taux': 'Vues du desk', 'vue-bank': 'Vues du desk',
    };
    var FAMS = ['Analyse de marché', 'Fonctions', 'Vues du desk'];   // ordre d'affichage des familles
    // GALERIE DE MODÈLES en TÊTE de la bibliothèque (demande user 23/07 : « on doit pouvoir choisir le template
    // en cliquant sur l'icône bibliothèque ») : chaque modèle = VIGNETTE d'agencement + NOM CENTRÉ DESSOUS —
    // jamais de nom à droite. Un clic crée un nouveau desk pré-composé (usePreset).
    var atMax = STATE.cfg && STATE.cfg.layouts.length >= _LMAX;
    var pmatch = function (p) { return !q || p.name.toLowerCase().indexOf(q) !== -1; };
    var tplCards = PRESETS.map(function (p, i) {
      if (!pmatch(p)) return '';
      var names = p.items.map(function (it) { var w = byId(it.w); return w ? w.name : ''; }).filter(Boolean).join(' · ');
      return '<button class="wdg-tpl-card" onclick="DTPWidgets.usePreset(' + i + ')"'
        + (atMax ? ' disabled title="Plafond de layouts atteint"' : ' title="' + esc(names) + '"') + '>'
        + _thumb(p.items, { labels: true })
        + '<span class="wdg-tpl-name">' + esc(p.name) + '</span>'
        + '<span class="wdg-tpl-n">' + p.items.length + ' widgets</span>'
        + '<span class="wdg-tpl-list">' + esc(names) + '</span></button>';
    }).join('');
    var tplHtml = (PRESETS.some(pmatch) && (_libFam === '' || _libFam === '_tpl'))
      ? '<div class="wdg-lib-sec">' + (PRESETS.length > 1 ? 'Modèles prêts' : 'Modèle prêt') + '</div><div class="wdg-tpl-row">' + tplCards + '</div>' : '';

    // ⚠️ La clé DOIT être le nom de famille tel qu'il figure dans FAMS ci-dessus : ce dictionnaire est
    // lu en FAM_SUB[fam]. La clé était 'Analytics' alors que la famille s'appelle 'Analyse de marché'
    // → la PLUS GROSSE rubrique (11 widgets sur 25) était la seule sans sous-titre, en silence.
    var FAM_SUB = { 'Analyse de marché': 'Ce que dit le marché', Fonctions: 'Données & outils', 'Vues du desk': 'Les onglets de la nav, en carte' };
    // FAVORIS (10/08, phase 2) : étoile en coin de carte → épingle le widget ; section « Favoris »
    // TOUJOURS en tête (accès en un geste aux widgets qu'on ajoute souvent). Persistés par compte
    // (cfg.wfavs, mêmes save/KV que le reste). L'étoile est un <span role=button> : un <button> dans
    // le <button> carte serait du HTML invalide.
    var favIds = (STATE.cfg && Array.isArray(STATE.cfg.wfavs)) ? STATE.cfg.wfavs : [];
    var favSet = {}; favIds.forEach(function (x) { favSet[x] = 1; });
    var _card = function (w) {
      // Carte façon terminal pro : APERÇU visuel du widget (vignette dessinée) au-dessus, nom + description dessous.
      // L'infobulle porte AUSSI la description : depuis que la carte coupe le texte à deux lignes
      // pleines (grille de hauteur régulière), c'est le seul endroit où lire une description longue
      // sans ajouter le widget. Les descriptions vont de 38 à 112 caractères, une poignée dépasse.
      if (_wBientot(w)) {
        // Carte « Bientôt » : visible (le client voit ce qui arrive) mais inerte : ni ajout, ni
        // favori. aria-disabled plutôt que disabled : l'infobulle (description) doit rester lisible.
        return '<button class="wdg-lib-card wdg-lib-card--prev wdg-lib-card--soon" aria-disabled="true" title="' + esc(w.desc) + '">'
          + '<span class="wdg-lib-prev">' + (WPREV[w.id] || WICO[w.id] || '') + '</span>'
          + '<span class="wdg-lib-main"><span class="wdg-lib-name">' + esc(w.name) + '</span>'
          + '<span class="wdg-lib-desc">' + esc(w.desc) + '</span></span>'
          + '<span class="wdg-lib-soon">Bientôt</span>'
          + '</button>';
      }
      return '<button class="wdg-lib-card wdg-lib-card--prev' + (w.id === _justAdded ? ' wdg-lib-card--added' : '') + '" onclick="DTPWidgets.add(\'' + w.id + '\')" title="Ajouter « ' + esc(w.name) + ' » · ' + esc(w.desc) + '">'
        + '<span class="wdg-lib-fav' + (favSet[w.id] ? ' on' : '') + '" role="button" tabindex="0"'
        +   ' title="' + (favSet[w.id] ? 'Retirer des favoris' : 'Épingler en favori') + '"'
        +   ' onclick="event.stopPropagation();DTPWidgets.toggleWfav(\'' + w.id + '\')"'
        +   ' onkeydown="if(event.key===\'Enter\'){event.stopPropagation();DTPWidgets.toggleWfav(\'' + w.id + '\');}">' + (favSet[w.id] ? '★' : '☆') + '</span>'
        + '<span class="wdg-lib-prev">' + (WPREV[w.id] || WICO[w.id] || '') + '</span>'
        + '<span class="wdg-lib-main"><span class="wdg-lib-name">' + esc(w.name) + '</span>'
        + '<span class="wdg-lib-desc">' + esc(w.desc) + '</span></span>'
        + (used[w.id] ? '<span class="wdg-lib-used">' + used[w.id] + '×</span>' : '<span class="wdg-lib-plus">+</span>')
        + '</button>';
    };
    var favList = favIds.map(byId).filter(function (w) { return w && match(w); });
    var favHtml = (favList.length && _libFam !== '_tpl')
      ? '<div class="wdg-lib-sec">Favoris <i class="wdg-lib-star">★</i><span class="wdg-lib-cnt">(' + favList.length + ')</span>'
        + '<span class="wdg-lib-sub">Vos widgets épinglés</span></div><div class="wdg-lib-row">' + favList.map(_card).join('') + '</div>'
      : '';
    var fam0 = function (w) { return FAM_OF[w.id] || 'Fonctions'; };
    var html = (_libFam === '_tpl' ? [] : FAMS).map(function (fam) {
      if (_libFam && _libFam !== fam) return '';                              // puce de catégorie active → une seule famille
      var list = CATALOG.filter(function (w) { return (FAM_OF[w.id] || 'Fonctions') === fam && match(w); });
      if (!list.length) return '';
      var cards = list.map(_card).join('');
      return '<div class="wdg-lib-sec">' + esc(fam) + '<span class="wdg-lib-cnt">(' + list.length + ')</span>'
        + '<span class="wdg-lib-sub">' + esc(FAM_SUB[fam] || '') + '</span></div><div class="wdg-lib-row">' + cards + '</div>';
    }).join('');
    // COMPTEUR TOTAL en tête de liste (disposition demandée) : on compte ce qui est REELLEMENT
    // affiche, filtre de recherche et puce de categorie compris, sinon le nombre contredit l ecran.
    var nTot = CATALOG.filter(function (w) {
      return match(w) && (!_libFam || _libFam === '_tpl' || (FAM_OF[w.id] || 'Fonctions') === fam0(w));
    }).length;
    var totHtml = (_libFam === '_tpl' || !html) ? '' :
      '<div class="wdg-lib-tot">Tous les widgets <span>(' + nTot + ')</span></div>';
    box.innerHTML = (totHtml + tplHtml + favHtml + html) || '<div class="wdg-empty">Rien ne correspond à « ' + esc(_libQ) + ' ».</div>';
  }

  /* ── MODÈLE PRÊT : UN SEUL, et c'est le DESK DE BASE À L'IDENTIQUE (demande user 02/08). Il lit la même
     composition que le layout par défaut (_itemsDeskDefaut) — fil d'actualité à gauche, horloge mondiale
     puis panneau à onglets à droite : le modèle ne peut donc pas s'écarter du desk. Un clic → un nouveau
     layout pré-composé, modifiable ensuite. ── */
  var PRESETS = [
    { name: 'Vue générale', items: _itemsDeskDefaut() },
  ];
  /* ── DISPOSITIONS (création guidée) : squelettes d'EMPLACEMENTS vides, façon « Select Layout » d'un terminal
     pro — GAMME COMPLÈTE groupée par nombre de panneaux (le chiffre à gauche de chaque rangée). Chaque
     emplacement devient une carte « + Choisir un widget » (id spécial 'slot'). ── */
  function _rep(n, gw, gh) { var a = []; for (var i = 0; i < n; i++) a.push({ gw: gw, gh: gh }); return a; }
  var DISPO_ORDER = ['∞', 1, 2, 3, 4, 5, 6, 8, 9, 12];
  var DISPOS = [
    { n: '∞', name: 'Libre',                rows: 0,  items: [] },
    { n: 1,  name: '1 panneau',             rows: 14, items: [{ gw: 12, gh: 14 }] },
    { n: 2,  name: '2 colonnes',            rows: 14, items: _rep(2, 6, 14) },
    { n: 2,  name: '2 lignes',              rows: 18, items: _rep(2, 12, 9) },
    { n: 2,  name: 'Principal + latéral',   rows: 14, items: [{ gw: 8, gh: 14 }, { gw: 4, gh: 14 }] },
    { n: 3,  name: '3 colonnes',            rows: 14, items: _rep(3, 4, 14) },
    { n: 3,  name: 'Principal + colonne',   rows: 14, items: [{ gw: 8, gh: 14 }, { gw: 4, gh: 7 }, { gw: 4, gh: 7 }] },
    { n: 3,  name: 'Colonne + principal',   rows: 14, items: [{ gw: 4, gh: 7 }, { gw: 8, gh: 14 }, { gw: 4, gh: 7 }] },
    { n: 3,  name: '1 + 2',                 rows: 18, items: [{ gw: 12, gh: 9 }].concat(_rep(2, 6, 9)) },
    { n: 3,  name: '2 + 1',                 rows: 18, items: _rep(2, 6, 9).concat([{ gw: 12, gh: 9 }]) },
    { n: 4,  name: '2 × 2',                 rows: 18, items: _rep(4, 6, 9) },
    { n: 4,  name: '4 colonnes',            rows: 14, items: _rep(4, 3, 14) },
    { n: 4,  name: '1 + 3',                 rows: 18, items: [{ gw: 12, gh: 9 }].concat(_rep(3, 4, 9)) },
    { n: 4,  name: '3 + 1',                 rows: 18, items: _rep(3, 4, 9).concat([{ gw: 12, gh: 9 }]) },
    { n: 4,  name: 'Principal + 3',         rows: 21, items: [{ gw: 8, gh: 21 }].concat(_rep(3, 4, 7)) },
    { n: 5,  name: '1 + 4',                 rows: 18, items: [{ gw: 12, gh: 9 }].concat(_rep(4, 3, 9)) },
    { n: 5,  name: '2 + 3',                 rows: 18, items: _rep(2, 6, 9).concat(_rep(3, 4, 9)) },
    { n: 6,  name: '3 × 2',                 rows: 18, items: _rep(6, 4, 9) },
    { n: 6,  name: '2 × 3',                 rows: 24, items: _rep(6, 6, 8) },
    { n: 7,  name: '1 + 6',                 rows: 18, items: [{ gw: 12, gh: 6 }].concat(_rep(6, 4, 6)) },
    { n: 7,  name: '3 + 4',                 rows: 18, items: _rep(3, 4, 9).concat(_rep(4, 3, 9)) },
    { n: 8,  name: '4 × 2',                 rows: 18, items: _rep(8, 3, 9) },
    { n: 9,  name: '3 × 3',                 rows: 24, items: _rep(9, 4, 8) },
    { n: 12, name: '4 × 3',                 rows: 24, items: _rep(12, 3, 8) },
    { n: 12, name: '6 × 2',                 rows: 24, items: _rep(12, 2, 12) },
    { n: 16, name: '4 × 4',                 rows: 24, items: _rep(16, 3, 6) },
    { n: 24, name: '6 × 4',                 rows: 24, items: _rep(24, 2, 6) },
    { n: 28, name: '4 × 7',                 rows: 21, items: _rep(28, 3, 3) },
    { n: 32, name: '4 × 8',                 rows: 24, items: _rep(32, 3, 3) },
  ];
  // Miniature d'un agencement : la grille 12 colonnes en réduction (aperçu visuel, gestionnaire + modèles).
  // MINIATURE D'UN LAYOUT — dérivée des VRAIS items (pas une capture d'écran) : même moteur de flux que la
  // grille 12 colonnes, chaque bloc teinté par la FAMILLE du widget + micro-libellé quand la place le permet.
  // Choix assumé face au screenshot serveur : instantané, hors-ligne, et JAMAIS périmé (la vignette ne peut
  // pas mentir sur le contenu du desk puisqu'elle est recalculée depuis lui).
  /* ⚠️ PALETTE TONALE ALIGNEE DTP (21/08, demande user : « pas tres beau avec le vert, aligne a
     DTP »). L ancienne posait du bleu, du vert et du violet SATURES a cote de l or : sur une carte
     de modele, l apercu ressemblait a un jouet, pas a un plan de terminal. On garde une teinte par
     famille pour qu elles restent distinguables, mais toutes DESATUREES et harmonisees autour de
     l or signature. Les blocs sont rendus a ~26 % d opacite : ces teintes y restent lisibles sans
     jamais crier. */
  var _CAT_COL = {
    'Devises': '#e3b23a', 'Macro': '#7d94b5', 'Risque': '#cf6a5a',
    'News': '#c2a25e', 'Outils': '#6f9f8c', 'Autre': '#7e8590',
  };
  // Abréviations ÉCRITES (jamais une troncature au milieu d'un mot : « BAROMÈ » ne veut rien dire).
  var _ABBR = {
    'force-devises': 'FORCE', 'barometre': 'BARO', 'risque-historique': 'HISTO',
    'calendrier-jour': 'AGENDA', 'radar-biais': 'BIAIS', 'taux-cb': 'TAUX',
    'risque-jauge': 'RISQUE', 'cot-inst': 'COT', 'dmx-retail': 'DMX', 'dmx-paire': 'DMX', 'cot-devise': 'COT',
    'saison': 'SAISON', 'sessions': 'MONDE', 'horloge': 'HEURE',
    'calculatrice': 'CALC', 'journal-mini': 'JOURNAL', 'onglets': 'ONGLETS',
    'fil-news': 'ACTUS',
    'vue-fxlist': 'FX', 'vue-institution': 'INST', 'vue-analyst': 'ANALYSTES',
    'vue-bias': 'BIAIS', 'vue-weekahead': 'SEMAINE', 'vue-taux': 'TAUX', 'vue-bank': 'BANQUES',
  };
  function _thumbLbl(def, it) {
    // Repli pour un widget ajouté plus tard sans entrée dans _ABBR : le PREMIER MOT de son nom —
    // un mot entier, jamais un morceau de mot.
    var full = _ABBR[it && it.w] || (def && def.tag)
      || (def ? String(def.name).replace(/[^A-Za-zÀ-ÿ ]/g, ' ').trim().split(/\s+/)[0].toUpperCase() : '');
    if (!full) return '';
    // La vignette fait ~6.5 px par colonne pour ~3.3 px par caractère → ≈ 2 caractères par colonne.
    var place = Math.floor((it.gw || 0) * 2);
    if (full.length <= place) return full;
    var court = full.slice(0, 3);                 // repli : code court, lisible tel quel (FOR, BAR, AGE…)
    return court.length <= place ? court : '';    // sinon rien — un libellé illisible vaut moins que la couleur seule
  }
  // Bloc fantôme : comble EXACTEMENT le trou de la dernière rangée (simulation du placement 12 colonnes).
// Largeurs d AFFICHAGE, calculees en DEUX DIMENSIONS. On place les cartes comme le fait la grille,
// puis chacune s etend vers la droite tant que les cellules a sa droite, sur ses propres rangees,
// sont libres. Une carte qui a un voisin ne bouge pas ; une carte qui a du vide le comble.
// La valeur ENREGISTREE n est jamais modifiee — l etirement se cumulerait a chaque rendu.
// PLACEMENT 2D PARTAGE. Le rendu et le redimensionnement doivent voir la MEME grille — sinon la
// carte qu on tire saute a une largeur que personne n affiche. On place les cartes comme le fait la
// grille (premier emplacement libre), puis chacune s etend vers la droite tant que les cellules a sa
// droite, sur SES PROPRES rangees, sont libres. Renvoie les largeurs d affichage ET les positions.
function _geomGrille(items) {
  items = items || [];
  var W = 12, G = [], pos = [];
  var gws = items.map(function (it) { return Math.min(W, Math.max(1, (it.gw | 0) || 6)); });
  var ghs = items.map(function (it) { return Math.max(1, (it.gh | 0) || 12); });
  function libre(r, c, h, w) {
    if (c + w > W) return false;
    for (var y = r; y < r + h; y++) { var L = G[y]; if (!L) continue; for (var x = c; x < c + w; x++) if (L[x]) return false; }
    return true;
  }
  function poser(r, c, h, w) {
    for (var y = r; y < r + h; y++) { if (!G[y]) { G[y] = []; for (var k = 0; k < W; k++) G[y][k] = 0; } for (var x = c; x < c + w; x++) G[y][x] = 1; }
  }
  for (var i = 0; i < items.length; i++) {
    var mis = false;
    for (var r = 0; !mis && r < 400; r++) {
      for (var c = 0; c + gws[i] <= W; c++) {
        if (libre(r, c, ghs[i], gws[i])) { poser(r, c, ghs[i], gws[i]); pos[i] = { r: r, c: c, h: ghs[i], w: gws[i] }; mis = true; break; }
      }
    }
    if (!mis) pos[i] = { r: 0, c: 0, h: ghs[i], w: gws[i] };
  }
  for (var j = 0; j < items.length; j++) {
    var p = pos[j]; if (!p) continue;
    var droite = p.c + gws[j];
    while (droite < W && libre(p.r, droite, ghs[j], 1)) { poser(p.r, droite, ghs[j], 1); gws[j]++; droite++; }
    p.w = gws[j];
  }
  return { gw: gws, pos: pos };
}
// Largeurs d AFFICHAGE. La valeur ENREGISTREE n est jamais modifiee au rendu — l etirement se
// cumulerait a chaque passage et la largeur choisie serait perdue.
function _largeursAffichees(lay) { return _geomGrille((lay && lay.items) || []).gw; }
// Largeurs d'AFFICHAGE : on simule le placement en 12 colonnes et, pour chaque rangée incomplète,
// on donne les colonnes restantes à sa DERNIÈRE carte. Résultat : aucune rangée à trou, donc plus
// aucun espace vide à combler. Renvoie un tableau indexé comme lay.items.
// La largeur ENREGISTRÉE n'est jamais modifiée — sinon l'étirement se cumulerait à chaque rendu et
// la largeur choisie par l'utilisateur serait perdue.
function _spansAffiches(lay) {
  var items = (lay && lay.items) || [];
  var out = items.map(function (it) { return Math.min(12, Math.max(1, (it.gw | 0) || 6)); });
  var debut = 0, c = 0;
  for (var i = 0; i < out.length; i++) {
    if (c + out[i] > 12) {                       // la carte passe à la rangée suivante
      if (c < 12 && i > debut) out[i - 1] += (12 - c);   // la dernière de la rangée close s'étire
      debut = i; c = 0;
    }
    c += out[i];
  }
  if (c < 12 && out.length) out[out.length - 1] += (12 - c);   // dernière rangée
  return out;
}
  function _ghostHtml(lay) {
    var c = 0, rowH = 0;
    (lay && lay.items || []).forEach(function (it) {
      var gw = Math.min(12, Math.max(1, (it.gw | 0) || 6)), gh = Math.max(3, (it.gh | 0) || 12);
      if (c + gw > 12) { c = 0; rowH = 0; }
      c += gw; if (gh > rowH) rowH = gh;
    });
    var gR = c > 0 && c < 12 ? (12 - c) : 12;                  // trou réel, sinon pleine largeur
    // 6 rangees ici donnaient une BANDE NOIRE en bas de disposition : les rangees sont en 1fr, six
    // d'entre elles avalent une grosse part de la hauteur, et le fantome est transparent (pointille
    // seul) — donc invisible autrement que comme un vide. 2 rangees = le bandeau discret annonce.
    var gH = c > 0 && c < 12 ? (rowH || 12) : 2;               // même hauteur que la rangée, sinon bandeau discret
    return '<button class="wdg-ghost" style="grid-column: span ' + gR + '; grid-row: span ' + gH + ';" onclick="DTPWidgets.openLib()" title="Ajouter un widget ici">'
      + '<span class="wdg-ghost-plus">+</span><span class="wdg-ghost-lbl">Ajouter un widget</span></button>';
  }
  // REDIMENSIONNEMENT CIBLÉ : on écrit la variable CSS de LA carte — la grille reflue toute seule.
  // Avant, chaque clic sur ± reconstruisait le desk entier : tous les graphes étaient démontés puis
  // remontés (coûteux, et visible en scintillement) et la grille remontait en haut de page.
  function _resizeItem(i, champ, delta, min, max) {
    var l = activeLayout(); if (!l || !l.items[i]) return;
    var it = _normItem(l.items[i]);
    var v = _clamp(it[champ] + delta, min, max);
    if (v === it[champ]) return;                                     // déjà à la borne : rien à faire
    it[champ] = v;
    var host = document.getElementById(HOST_ID);
    var card = host && host.querySelector('.wdg-card[data-idx="' + i + '"]');
    if (!card) { _reopen = i; save(); renderGrid(); return; }         // carte absente (cas limite) → repli sûr
    card.style.setProperty('--' + champ, v);
    _syncPanel(i);                                                   // les valeurs affichées suivent
    _syncGhost();                                                    // le trou de la dernière rangée a changé
    // Les graphes doivent se remesurer : amCharts a son propre capteur, mais Leaflet (carte des
    // sessions) ne réagit qu'à un resize de fenêtre. On le provoque à la frame suivante, une fois
    // la nouvelle géométrie appliquée.
    requestAnimationFrame(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
    save();
  }
  // Remplace le fantôme en place après un redimensionnement (le trou a changé de forme).
  function _syncGhost() {
    var host = document.getElementById(HOST_ID); if (!host) return;
    var old = host.querySelector('.wdg-ghost'); if (!old) return;
    var tmp = document.createElement('div'); tmp.innerHTML = _ghostHtml(activeLayout());
    if (tmp.firstChild) old.replaceWith(tmp.firstChild);
  }
  function _thumb(items, opts) {
    opts = opts || {};
    // POSITIONS EXACTES, ZÉRO ARRONDI (demande user 02/08 « ça doit être aligné à chaque fois ») :
    // toutes les tentatives à base de rangées entières (arrondi par bloc, puis unité PGCD) finissaient
    // par désaligner une colonne dès que les hauteurs ne tombaient pas juste — le PGCD lui-même
    // retombait sur l'arrondi par bloc quand les hauteurs étaient premières entre elles. On rejoue
    // donc le PLACEMENT 2D RÉEL (_geomGrille — le même moteur que la grille et le redimensionnement)
    // et chaque bloc est dessiné en POURCENTAGES de la boîte : la vignette est un plan fidèle du
    // desk, aligné par construction, largeurs étirées comprises.
    var its = (items || []).slice(0, 12).map(function (x) { return _normItem(JSON.parse(JSON.stringify(x))); });
    var g = _geomGrille(its);
    var H = g.pos.reduce(function (a, p) { return Math.max(a, p.r + p.h); }, 1);
    var blocks = its.map(function (it, i) {
      var p = g.pos[i]; if (!p) return '';
      var def = byId(it.w);
      var col = _CAT_COL[(def && def.cat) || 'Autre'] || _CAT_COL['Autre'];
      var lbl = opts.labels && p.w >= 3 ? _thumbLbl(def, it) : '';
      // ICÔNE OFFICIELLE DU WIDGET (12/08, « un truc pro classe épuré ») : les trames CSS testées
      // juste avant se répétaient sur les grands panneaux et faisaient sales. L'icône du catalogue
      // (WICO — celle de la bibliothèque et des en-têtes) est déjà la signature visuelle de chaque
      // widget : centrée, discrète, elle identifie le panneau sans rien mimer. Seulement si le bloc
      // a la place (au moins 3 colonnes et ~1/5 de la hauteur du plan).
      var ico = (opts.labels && p.w >= 3 && (p.h / H) >= 0.2 && typeof WICO !== 'undefined' && WICO[it.w]) ? WICO[it.w] : '';
      return '<i style="left:' + (p.c / 12 * 100).toFixed(3) + '%;top:' + (p.r / H * 100).toFixed(3)
        + '%;width:' + (p.w / 12 * 100).toFixed(3) + '%;height:' + (p.h / H * 100).toFixed(3)
        + '%;--tc:' + col + '"' + (def ? ' title="' + esc(def.name) + '"' : '') + '>'
        + (lbl ? '<b>' + esc(lbl) + '</b>' : '') + (ico ? '<span class="wdg-plan-ico">' + ico + '</span>' : '') + '</i>';
    }).join('');
    // L'enveloppe interne (.wdg-plan-in) porte les blocs : un enfant en position absolue se place par
    // rapport à la BOÎTE DE PADDING du parent — le padding du cadre serait ignoré sans elle.
    return '<span class="wdg-thumb wdg-thumb--plan' + (opts.labels ? ' wdg-thumb--lbl' : '') + '"'
      + (opts.labels ? '' : ' aria-hidden="true"') + '><span class="wdg-plan-in">' + blocks + '</span></span>';
  }

  // Bascule un panneau overlay (info 'i' / réglages 's') d'une carte ; ferme tous les autres.
  function _togglePop(idx, kind) {
    var host = document.getElementById(HOST_ID); if (!host) return;
    var target = document.getElementById(HOST_ID + '-' + kind + idx);
    var willOpen = target && target.hidden;
    host.querySelectorAll('.wdg-pop').forEach(function (p) { p.hidden = true; });   // un seul ouvert à la fois
    if (target) target.hidden = !willOpen;
    /* `renderGrid` reconstruit le HTML des cartes : le volet de réglages est un ÉLÉMENT NEUF à
       chaque rendu, jamais celui qu'on avait câblé. On câble donc à l'ouverture — le drapeau posé
       sur l'élément rend l'appel gratuit quand c'est le même. */
    if (willOpen && kind === 's' && target) _wireTabsDnD(target, idx);
  }
  function _closePops() {
    var host = document.getElementById(HOST_ID); if (!host) return;
    host.querySelectorAll('.wdg-pop').forEach(function (p) { p.hidden = true; });
  }
  // FERMETURE NATURELLE des panneaux (info / réglages) : clic ailleurs ou Échap. Sans ça il fallait
  // recliquer l'engrenage — le panneau restait ouvert par-dessus le desk en changeant de carte.
  // Écouteurs posés UNE SEULE FOIS sur le document (renderGrid recrée le HTML des cartes à chaque
  // rendu : les attacher aux cartes les empilerait à chaque save).
  (function () {
    document.addEventListener('mousedown', function (e) {
      if (e.target.closest && (e.target.closest('.wdg-pop') || e.target.closest('.wdg-ico'))) return;  // dans le panneau, ou sur le bouton qui l'ouvre
      _closePops();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') _closePops(); });
  })();

  /* ── ACTIONS (exposées : les onclick du HTML généré les appellent) ── */
  var API = {
    /* CLIC SUR LE LOGO — POINT DE DÉCISION UNIQUE (06/08, constat user : « quand je clique sur le
       logo ça m'emmène sur le classique »).
       Il y avait DEUX gestionnaires concurrents : un écouteur posé ici sur `.logo-text`, qui
       n'agissait que si un layout ★ existait, et surtout l'`onclick` en dur de index.html, qui
       appelait `activateView('news')` — donc l'ancien desk. Le second gagnait dans tous les cas :
       posé sur le PARENT, il s'exécutait après le premier par propagation.
       Désormais la décision vit ICI, à un seul endroit : le logo ramène à l'écran d'accueil du
       compte. Pour qui dispose de Mon Desk, c'est sa disposition par défaut ; pour les autres, le
       desk classique, inchangé. Le jour où Mon Desk s'ouvre à tous, c'est cette seule condition
       qui change. */
    logoAccueil: function () {
      var monDesk = !!window._pdMonDesk;   // admin OU drapeau « mondesk » leve (server.js, KV feat:v1)
      if (monDesk && typeof activateView === 'function') { activateView('widgets'); return; }
      if (typeof activateView === 'function') activateView('news');
    },
    // Miniature d'un layout — exposée pour que l'ACCUEIL (home.js) rende la même vignette que le
    // gestionnaire : un seul moteur, donc zéro divergence visuelle entre les deux écrans.
    // ⚠️ L'ÉCHEC NE DOIT PLUS ÊTRE MUET (12/08). Ce `catch` renvoyait '' sans un mot : quand la
    // vignette ne se construisait pas, l'accueil affichait une carte vide et RIEN nulle part ne
    // disait pourquoi. Le défaut est resté invisible plusieurs jours, et a coûté deux corrections à
    // l'aveugle. On renvoie toujours '' — l'appelant a son propre repli — mais on le DIT.
    thumb: function (items, opts) {
      try { return _thumb(items, opts); }
      catch (e) {
        try { console.error('[Widgets] miniature non construite :', e && e.message, '| items :', JSON.stringify(items || []).slice(0, 300)); } catch (e2) {}
        return '';
      }
    },
    // Liste des widgets montables (id + nom + famille) — pour qu'un autre écran propose un choix
    // sans dupliquer le catalogue.
    catalogue: function () { return CATALOG.map(function (w) { return { id: w.id, nom: w.name, tag: w.tag || '', cat: w.cat }; }); },
    // MONTER UN VRAI WIDGET DU DESK dans n'importe quel conteneur (l'espace d'accueil s'en sert).
    // C'est EXACTEMENT le widget du desk — même code, mêmes données, mêmes états de chargement et
    // d'erreur : aucune ré-implémentation à maintenir en parallèle. Renvoie la fonction de nettoyage
    // (timers, roots amCharts, carte Leaflet) — l'appelant DOIT l'exécuter en fermant son écran,
    // sinon les minuteurs du widget survivent à la page qui l'affichait.
    mountInto: function (id, host, cfg) {
      var w = byId(id); if (!w || !host) return null;
      var it = { w: id, gw: 12, gh: 12 };
      if (cfg && typeof cfg === 'object') it.cfg = cfg;      // réglages du contrat déclaratif
      try {
        var un = w.mount(host, it);
        return typeof un === 'function' ? un : null;
      } catch (e) { try { fallback(host, w.name + ' indisponible.'); } catch (_) {} return null; }
    },
    open: function () {                                   // appelé par activateView('widgets')
      document.body.classList.add('wdg-mode');            // masque la nav principale (Mon Desk = espace autonome)
      // TEMPLATE PAR DÉFAUT (demande user 23/07) : à l'ARRIVÉE sur Mon Desk (icône/logo, chargement), on ouvre
      // le layout marqué ★ (par défaut) — pas le dernier utilisé. Sans ★ : dernier actif (comportement d'avant).
      var _applyDefault = function () {
        var c = STATE.cfg; if (!c) return;
        var fav = (c.layouts || []).find(function (l) { return l && l.fav; });
        if (fav) { c.active = fav.id; fav.hidden = false; }   // le ★ par défaut est toujours ré-affiché à l'arrivée
      };
      if (!STATE.booted) { STATE.booted = true; load().then(function () { _applyDefault(); renderBar(); renderGrid(); }); }
      else { _applyDefault(); renderBar(); renderGrid(); }
    },
    close: function () { document.body.classList.remove('wdg-mode'); unmountAll(); },   // restaure la nav + libère roots/timers
    // (05/08) Mon Desk est l ecran d arrivee et le desk classique est masque : plus AUCUNE
    // sortie ne doit exister. Conserve en no-op : un appelant oublie ne doit pas planter,
    // mais il ne doit pas non plus ejecter l utilisateur hors de son desk.
    exit: function () {},
    // RETRAIT ANNULABLE (28/07) : on garde l'item ET sa position, et on propose « Annuler » 7 s.
    // Un retrait accidentel ne coûte plus la reconstruction manuelle du widget (taille, onglets,
    // réglages compris — c'est l'objet complet qui revient à sa place).
    remove: function (i) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var snap = JSON.parse(JSON.stringify(l.items[i]));
      // DEUX NIVEAUX. Retirer un WIDGET rend son EMPLACEMENT à la disposition (même géométrie) :
      // sur une disposition choisie, le bloc doit rester et proposer « + Choisir un widget », pas
      // laisser un vide noir. Retirer un EMPLACEMENT le supprime vraiment — c'est le seul moyen de
      // réduire une disposition, et c'est ce qu'annonce son bouton « Retirer l'emplacement ».
      var etaitSlot = (snap.w === 'slot');
      if (etaitSlot) l.items.splice(i, 1);
      else l.items[i] = { w: 'slot', gw: snap.gw, gh: snap.gh, cfg: {} };
      save(); renderGrid();
      var nom = etaitSlot ? 'Emplacement retiré' : (byId(snap.w) ? (byId(snap.w).name + ' retiré') : 'Widget retiré');
      _undoOffer(nom, function () {
        var cur = activeLayout(); if (!cur) return;
        if (etaitSlot) cur.items.splice(Math.min(i, cur.items.length), 0, snap);   // remis À SA PLACE
        else cur.items[i] = snap;                                                  // le widget revient dans son bloc
        save(); renderGrid();
      });
    },
    move: function (i, d) {
      var l = activeLayout(); if (!l) return;
      var j = i + d; if (j < 0 || j >= l.items.length) return;
      var t = l.items[i]; l.items[i] = l.items[j]; l.items[j] = t;
      _reopen = j; save(); renderGrid();                 // garde les réglages ouverts sur le widget déplacé
    },
    // RÉGLAGES DÉCLARATIFS — écrit la valeur puis re-rend (le widget se re-monte et lit sa nouvelle
    // valeur par opt()). _reopen garde le panneau de réglages ouvert : on enchaîne plusieurs réglages
    // sans avoir à le rouvrir à chaque clic.
    setOpt: function (i, k, v) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i], w = byId(it.w), d = optDef(w, k); if (!d) return;
      if (!it.cfg) it.cfg = {};
      if (d.type === 'nombre') v = _clamp(parseInt(v, 10) || d.def, d.min, d.max);
      if (v === d.def) delete it.cfg[k];              // valeur par défaut → on ne stocke rien (config minimale)
      else it.cfg[k] = v;
      if (!Object.keys(it.cfg).length) delete it.cfg;
      // RENDU CIBLÉ : seul le widget réglé se re-monte, et seul son panneau se re-rend. Avant, un clic
      // sur une pastille reconstruisait tout le desk — les autres graphes scintillaient pour rien et
      // la grille remontait en haut de page.
      save(); _syncPanel(i); API.refresh(i);
    },
    // Variante SILENCIEUSE : enregistre la valeur SANS re-rendre. Pour les contrôles internes d'un widget
    // (barre de catégories COT, boutons d'unité DMX…) qui ont déjà mis leur propre affichage à jour :
    // sans ça, le choix fait DANS le widget était perdu au premier re-rendu et contredisait la pastille
    // du panneau de réglages. Le réglage devient la source unique, quel que soit l'endroit où on le change.
    // Coche/décoche une valeur d'un réglage 'multi'. La liste est stockée en chaîne « a|b|c » : le
    // serveur ne valide que la FORME de it.cfg et n'accepte pas de tableau (cf. _wdgClean).
    // `setter` permet de viser la carte ('setOpt') ou l'onglet affiché ('setTabOpt') — c'est le
    // panneau de réglages qui le transmet, comme pour les sections du fil.
    /* Filtre les pastilles d'une liste longue (champ « Rechercher… » posé par _optsHtml au-delà de
       quatorze entrées). L'état vit dans le DOM et nulle part ailleurs : le panneau de réglages est
       reconstruit en chaîne à chaque ouverture, une variable de module serait remise à zéro au
       premier re-rendu. La comparaison est SANS ACCENTS ni casse — « zurich » doit trouver
       « Zürich », sinon le champ punit exactement la frappe rapide qu'il vient promettre. */
    filtrerChoix: function (input) {
      function _plat(t) {
        return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      }
      var q = _plat(input.value).trim();
      var boite = input.parentNode; if (!boite) return;
      var n = 0;
      Array.prototype.forEach.call(boite.querySelectorAll('.wdg-set-chip'), function (b) {
        var ok = !q || _plat(b.textContent).indexOf(q) >= 0;
        b.hidden = !ok;
        if (ok) n++;
      });
      var vide = boite.querySelector('.wdg-set-vide');
      if (vide) vide.hidden = !!n;
    },
    toggleMulti: function (i, k, val, setter, c) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i];
      var vise = (setter === 'setTabOpt');
      var jm = Math.min(it._tabAct | 0, Math.max(0, ((it.tabs || []).length - 1)));
      var w = vise ? byId(_tabWid(it, jm, c)) : byId(it.w);
      var d = optDef(w, k); if (!d || d.type !== 'multi') return;
      var item = vise ? _tabItem(it, jm, c) : it;
      var cur = opt(item, w, k) || [];
      var apres = cur.indexOf(val) >= 0 ? cur.filter(function (x) { return x !== val; }) : cur.concat([val]);
      // On refuse de tout décocher : une carte vide n'apprend rien et l'utilisateur se retrouverait
      // sans moyen évident de revenir en arrière. Le dernier élément coché reste.
      if (!apres.length) return;
      // On garde l'ordre du CATALOGUE, pas l'ordre des clics : les horloges doivent rester
      // rangées d'ouest en est quoi qu'il arrive.
      var rang = {}; d.choix.forEach(function (c, n) { rang[c[0]] = n; });
      apres.sort(function (a, b) { return rang[a] - rang[b]; });
      API[setter === 'setTabOpt' ? 'setTabOpt' : 'setOpt'](i, k, apres.join('|'), c);
    },
    setOptQuiet: function (i, k, v) {
      var l = activeLayout(); if (!l || l.items[i] == null) return;
      var it = l.items[i], w = byId(it.w), d = optDef(w, k); if (!d) return;
      if (!it.cfg) it.cfg = {};
      if (v === d.def) delete it.cfg[k]; else it.cfg[k] = v;
      if (!Object.keys(it.cfg).length) delete it.cfg;
      save();
    },
    bumpOpt: function (i, k, d) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i], w = byId(it.w), def = optDef(w, k); if (!def) return;
      API.setOpt(i, k, _clamp((parseInt(opt(it, w, k), 10) || def.def) + d * (def.pas || 1), def.min, def.max));
    },
    // La grille CSS reflue toute seule quand --gw/--gh changent : inutile de reconstruire le desk.
    // Avant, chaque clic sur ± démontait/remontait TOUS les graphes et renvoyait la grille en haut de page.
    setGw: function (i, d) { _resizeItem(i, 'gw', d, 1, GRID_COLS); },
    setGh: function (i, d) { _resizeItem(i, 'gh', d * 2, 3, 60); },
    duplicate: function (i) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      if (l.items.length >= _IMAX) return _undoOffer('Ce desk est plein (' + _IMAX + ' widgets).');
      var copy = JSON.parse(JSON.stringify(l.items[i])); copy.locked = false;
      /* Le reglage `doc` designe un DOCUMENT, pas une preference : le recopier ferait pointer les
         deux cartes sur la meme note, et celle ou l on tape en dernier ecraserait l autre en
         silence. La copie repart donc sans document, et s en fabrique un au montage.
         (Defaut signale par la contre-verification du 19/08, corrige avant d ecrire le widget.) */
      if (copy.cfg && copy.cfg.doc) delete copy.cfg.doc;
      l.items.splice(i + 1, 0, copy); save(); renderGrid();
    },
    toggleLock: function (i) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      l.items[i].locked = !l.items[i].locked; save(); renderGrid();
    },
    // ── GESTION DES ONGLETS depuis les Réglages de la carte (demande user 02/08 : plus de croix au
    //    survol — renommage et retrait vivent dans le panneau paramètres). Patron setOpt : muter
    //    l'item → save → _syncPanel (le volet reste ouvert, sa liste se met à jour) → refresh (le
    //    corps remonte avec la nouvelle barre d'onglets).
    setTabIcon: function (i, j, slug) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (!Array.isArray(it.tabs) || j >= it.tabs.length) return;
      // Slug d une liste FIXE, ou chaine vide (retrait). Rien d autre n est accepte.
      var sl = (slug && _TAB_ICONS[slug]) ? slug : '';
      var arr = Array.isArray(it.tabIcons) ? it.tabIcons.slice() : [];
      while (arr.length < it.tabs.length) arr.push('');
      if ((arr[j] || '') === sl) return;                 // no-op : pas de re-rendu inutile
      arr[j] = sl;
      it.tabIcons = arr;
      save(); API.refresh(i);
      setTimeout(function () { _syncPanel(i); }, 0);     // re-rend le volet apres le clic (cf. renameTab)
    },
    renameTab: function (i, j, v) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (!Array.isArray(it.tabs) || !it.tabs[j]) return;
      var w2 = byId(it.tabs[j]);
      var lb = Array.isArray(it.tabLabels) ? it.tabLabels.slice() : [];
      var v2 = String(v || '').trim().slice(0, 18);
      // Nom par défaut : tag du widget — « Vide » pour un onglet sans widget, « GRILLE » pour un
      // onglet composite. Sans ce dernier cas, saisir « GRILLE » serait pris pour un nom personnalisé.
      var def = w2 ? w2.name : (_estGrille(it, j) ? 'GRILLE' : 'Vide');
      var suiv = (v2 && v2 !== def) ? v2 : '';   // vide ou nom d'origine → pas de libellé perso
      // SANS CHANGEMENT → ON NE RE-REND RIEN. Cliquer le × d'une ligne dont le champ a le focus
      // déclenche blur → change → re-rendu du volet : le bouton visé serait remplacé sous la souris
      // et le clic avalé — il faudrait cliquer deux fois. Le no-op laisse le DOM en place.
      if (suiv === (lb[j] || '')) return;
      lb[j] = suiv;
      it.tabLabels = lb;
      save(); API.refresh(i);
      // Volet re-rendu APRÈS le cycle de clic en cours (revue adversariale) : cliquer × pendant que le
      // champ a le focus déclenche blur → change → ce code ; remplacer innerHTML immédiatement
      // détacherait le bouton visé avant le mouseup et le clic ne partirait jamais — l'onglet serait
      // renommé mais PAS retiré. Le timer 0 laisse le click se dispatcher d'abord ; un renommage ne
      // décale aucun index, les onclick bakés restent donc valides pendant ce battement.
      setTimeout(function () { _syncPanel(i); }, 0);
    },
    /* DÉPLACER UN ONGLET — appelé par la poignée (glisser-déposer ET flèches ↑ ↓).
       « que ça se mette à jour dans le panneau à onglet quand on déplace » : les DEUX surfaces sont
       rafraîchies — le volet de réglages (_syncPanel) ET la barre d'onglets de la carte
       (API.refresh). Sans le second, la liste se réordonnait dans les réglages et la carte gardait
       son ancien ordre jusqu'au prochain rendu : deux vérités à l'écran en même temps. */
    moveTab: function (i, from, to) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i];
      if (!_reordonnerOnglets(it, from, to)) return;        // hors bornes ou sur place : rien, et surtout aucun re-rendu
      var nv = Math.max(0, Math.min(it.tabs.length - 1, to | 0));
      save(); _syncPanel(i); API.refresh(i);
      /* LE FOCUS SUIT LA POIGNÉE. Le volet est reconstruit par innerHTML : sans cette ligne, la
         poignée que l'utilisateur tenait au clavier disparaît avec l'ancien DOM et la flèche
         suivante ne va nulle part — il faudrait re-cliquer entre chaque cran. */
      var pop = document.getElementById(HOST_ID + '-s' + i);
      var g = pop && pop.querySelector('.wdg-set-tabgrip[data-j="' + nv + '"]');
      if (g) try { g.focus({ preventScroll: true }); } catch (_) { g.focus(); }
    },
    removeTab: function (i, j) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (!Array.isArray(it.tabs) || j >= it.tabs.length) return;
      // PLANCHER 1 ONGLET (demande user 03/08) : garde serveur du geste — même si un vieux volet
      // affiche encore un ×, le dernier onglet d'un panneau ne part jamais.
      if (it.tabs.length <= 1) { _syncPanel(i); return; }
      var w2 = byId(it.tabs[j]);
      // SNAPSHOT PROFOND DES QUATRE CHAMPS. `it.tabs.slice()` seul ne suffisait plus : l'annulation
      // rendait l'onglet mais pas sa disposition ni ses réglages.
      var snap = JSON.parse(JSON.stringify({
        tabs: it.tabs, tabLabels: it.tabLabels || null, tabIcons: it.tabIcons || null,
        tabGrid: it.tabGrid || null, tabCfg: it.tabCfg || null,
      }));
      it.tabs.splice(j, 1);
      if (Array.isArray(it.tabLabels)) it.tabLabels.splice(j, 1);
      /* ⚠️ `tabIcons` MANQUAIT (relevé le 26/08 en écrivant le déplacement d'onglets, qui a obligé à
         recenser toutes les structures positionnelles). Retirer le 2e onglet décalait donc l'icône
         de tous les suivants d'un cran, en silence : chaque onglet héritait de l'icône de son
         voisin. Ni le snapshot d'annulation ni le splice ne le voyaient. */
      if (Array.isArray(it.tabIcons)) it.tabIcons.splice(j, 1);
      // ⚠️ tabGrid ET tabCfg sont indexés POSITIONNELLEMENT, sans clé stable : un splice non
      // synchronisé fait glisser la disposition et les réglages sur l'onglet VOISIN. Le décalage de
      // tabCfg existait déjà avant les onglets composites — il est corrigé ici, une fois.
      if (Array.isArray(it.tabGrid)) it.tabGrid.splice(j, 1);
      if (it.tabCfg) {
        var tc2 = {};
        Object.keys(it.tabCfg).forEach(function (k) {
          var m = /^(\d{1,2})(-\d{1,2})?$/.exec(k); if (!m) return;
          var n = parseInt(m[1], 10);
          if (n === j) return;                                   // les réglages de l'onglet retiré partent avec lui
          tc2[(n > j ? n - 1 : n) + (m[2] || '')] = it.tabCfg[k];
        });
        if (Object.keys(tc2).length) it.tabCfg = tc2; else delete it.tabCfg;
      }
      if ((it._tabAct | 0) >= it.tabs.length) it._tabAct = Math.max(0, it.tabs.length - 1);
      save(); _syncPanel(i); API.refresh(i);
      // Filet : le retrait est réversible. ANNULATION PAR RÉFÉRENCE, pas par index (revue
      // adversariale) : pendant les 7 s du bandeau, la carte peut être déplacée (les index glissent)
      // ou le desk changé — écrire à items[i] grefferait le snapshot sur la carte qui occupe
      // DÉSORMAIS cet index, voire sur un autre desk. L'objet, lui, est muté en place : il survit aux
      // déplacements. Disparu (carte retirée → convertie en slot, autre objet) → on abandonne.
      var itRef = it;
      _undoOffer((w2 ? w2.name : 'Onglet') + ' retiré du panneau', function () {
        if (!itRef || itRef.w !== 'onglets') return;
        var present = ((STATE.cfg && STATE.cfg.layouts) || []).some(function (ly) {
          return ly && ly.items && ly.items.indexOf(itRef) >= 0;
        });
        if (!present) return;
        itRef.tabs = snap.tabs.slice();
        if (snap.tabLabels) itRef.tabLabels = snap.tabLabels.slice(); else delete itRef.tabLabels;
        if (snap.tabIcons) itRef.tabIcons = snap.tabIcons.slice(); else delete itRef.tabIcons;
        if (snap.tabGrid) itRef.tabGrid = snap.tabGrid.slice(); else delete itRef.tabGrid;
        if (snap.tabCfg) itRef.tabCfg = JSON.parse(JSON.stringify(snap.tabCfg)); else delete itRef.tabCfg;
        save();
        var cur = activeLayout(); var idx = cur && cur.items ? cur.items.indexOf(itRef) : -1;
        if (idx >= 0) { _syncPanel(idx); API.refresh(idx); }   // visible seulement si la carte est sur le desk actif
      });
    },
    addTab: function (i) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      _pickTabFor(l.items[i]);
    },
    // Bascule d'une SECTION du fil d'actualité (réglage persisté `off` = rubriques décochées).
    toggleNewsSection: function (i, cat) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i], w = byId(it.w); if (!w || w.id !== 'fil-news') return;
      var cur = String(opt(it, w, 'off') || '').split('|').filter(Boolean);
      var k = cur.indexOf(cat);
      if (k >= 0) cur.splice(k, 1); else cur.push(cat);
      API.setOpt(i, 'off', cur.join('|'));
    },
    // Même bascule, mais pour un fil-news affiché DANS UN ONGLET (écrit dans it.tabCfg[index]).
    toggleNewsSectionTab: function (i, cat, c) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (it.w !== 'onglets' || !Array.isArray(it.tabs) || !it.tabs.length) return;
      var j = Math.min(it._tabAct | 0, it.tabs.length - 1);
      var w = byId(_tabWid(it, j, c)); if (!w || w.id !== 'fil-news') return;
      var cur = String(opt(_tabItem(it, j, c), w, 'off') || '').split('|').filter(Boolean);
      var k = cur.indexOf(cat);
      if (k >= 0) cur.splice(k, 1); else cur.push(cat);
      API.setTabOpt(i, 'off', cur.join('|'), c);
    },
    // RÉGLAGES PROPRES À L'ONGLET AFFICHÉ (04/08) — miroir de setOpt/bumpOpt, mais la valeur est
    // écrite dans it.tabCfg[index] (whitelisté serveur) au lieu du cfg de la carte.
    // `c` (06/08) = index de CELLULE quand l'onglet est composite. La config va alors sous la clé
    // « <onglet>-<cellule> » (acceptée par le sanitizer depuis la même livraison) au lieu de « <onglet> ».
    setTabOpt: function (i, k, v, c) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (it.w !== 'onglets' || !Array.isArray(it.tabs) || !it.tabs.length) return;
      var j = Math.min(it._tabAct | 0, it.tabs.length - 1);
      var w = byId(_tabWid(it, j, c)), d = optDef(w, k); if (!d) return;
      var kc = (c == null ? String(j) : (j + '-' + c));
      if (!it.tabCfg) it.tabCfg = {};
      var cfg = it.tabCfg[kc] || (it.tabCfg[kc] = {});
      if (d.type === 'nombre') v = _clamp(parseInt(v, 10) || d.def, d.min, d.max);
      if (v === d.def) delete cfg[k]; else cfg[k] = v;
      if (!Object.keys(cfg).length) delete it.tabCfg[kc];
      if (it.tabCfg && !Object.keys(it.tabCfg).length) delete it.tabCfg;
      save(); _syncPanel(i); API.refresh(i);
      // Le panneau du sous-widget reste OUVERT et se met à jour (on enchaîne plusieurs réglages
      // sans le rouvrir) — API.refresh ne touche que le corps de la carte, pas les panneaux.
      var sp = document.getElementById(HOST_ID + '-ss' + i);
      if (sp && !sp.hidden) sp.innerHTML = _subPanelHtml(i, _ssCell[i]);
    },
    bumpTabOpt: function (i, k, d, c) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (it.w !== 'onglets' || !Array.isArray(it.tabs) || !it.tabs.length) return;
      var j = Math.min(it._tabAct | 0, it.tabs.length - 1);
      var w = byId(_tabWid(it, j, c)), def = optDef(w, k); if (!def || def.type !== 'nombre') return;
      var cur = opt(_tabItem(it, j, c), w, k);
      API.setTabOpt(i, k, _clamp((cur | 0) + (d | 0) * (def.pas || 1), def.min, def.max), c);
    },
    // « − » de l'en-tête du panneau à onglets (03/08, précision user « juste le widget, pas
    // l'onglet ») : VIDE l'onglet affiché — le widget s'en va, l'onglet reste (nom conservé) et
    // son corps propose « + Choisir un widget ». L'onglet entier, lui, se retire depuis les
    // Réglages (×). Index actif lu au clic (volatile it._tabAct) ; annulable 7 s.
    removeActiveTab: function (i, c) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (it.w !== 'onglets' || !Array.isArray(it.tabs) || !it.tabs.length) return;
      var j = Math.min(it._tabAct | 0, it.tabs.length - 1);
      var itRef = it;                                        // annulation PAR RÉFÉRENCE : l'objet survit aux déplacements
      // CAS COMPOSITE : la croix d'une case vide LA CASE, pas l'onglet entier. L'onglet ne
      // redevient « vide » (et ne perd sa disposition) que lorsqu'il ne reste plus rien dedans —
      // sinon un clic sur la dernière croix effacerait un agencement de 4 widgets d'un coup.
      if (c != null && _estGrille(it, j)) {
        var g = _gridParse(_gridOf(it, j)); if (!g) return;
        var prevC = g.ids[c];
        if (!prevC || prevC === 'vide') return;
        var wc = byId(prevC);
        var avant = _gridOf(it, j), avantVide = false;
        g.ids[c] = 'vide';
        if (g.ids.every(function (x) { return x === 'vide'; })) { _clearGrid(it, j); avantVide = true; }
        else it.tabGrid[j] = _gridStr(g.code, g.ids);
        save(); _syncPanel(i); API.refresh(i);
        _undoOffer((wc ? wc.name : 'Widget') + ' retiré : la case reste', function () {
          if (!itRef || itRef.w !== 'onglets' || !Array.isArray(itRef.tabs)) return;
          if (!Array.isArray(itRef.tabGrid)) itRef.tabGrid = [];
          itRef.tabGrid[j] = avant; if (avantVide) itRef.tabs[j] = 'grille';
          save();
          var cur0 = activeLayout(); var i0 = cur0 && cur0.items ? cur0.items.indexOf(itRef) : -1;
          if (i0 >= 0) { _syncPanel(i0); API.refresh(i0); }
        });
        return;
      }
      var prev = it.tabs[j];
      if (prev === 'vide') return;                           // déjà vide → rien à retirer
      // Un onglet composite entier : on mémorise AUSSI sa disposition, sinon l'annulation
      // rendrait l'onglet mais pas son agencement.
      var prevG = _gridOf(it, j);
      var w2 = (prev === 'grille') ? null : byId(prev);
      _clearGrid(it, j);
      save(); _syncPanel(i); API.refresh(i);
      _undoOffer((w2 ? w2.name : (prev === 'grille' ? 'Disposition' : 'Widget')) + ' retiré : l\'onglet reste', function () {
        if (!itRef || itRef.w !== 'onglets' || !Array.isArray(itRef.tabs)) return;
        if (itRef.tabs[j] === 'vide') {
          itRef.tabs[j] = prev;
          if (prevG) { if (!Array.isArray(itRef.tabGrid)) itRef.tabGrid = []; itRef.tabGrid[j] = prevG; }
        }
        save();
        var cur = activeLayout(); var idx = cur && cur.items ? cur.items.indexOf(itRef) : -1;
        if (idx >= 0) { _syncPanel(idx); API.refresh(idx); }
      });
    },
    // Applique une DISPOSITION à l'onglet affiché (06/08). Sentinel et disposition écrits dans le
    // MÊME save : jamais l'un sans l'autre, sinon un onglet 'grille' sans disposition s'afficherait
    // vide chez le prochain client à le lire.
    setTabDispo: function (i, j, code) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (it.w !== 'onglets' || !Array.isArray(it.tabs)) return;
      var d = _dispoByCode(code); if (!d || j == null || j < 0 || j >= it.tabs.length) return;
      var ids = []; for (var k = 0; k < d.n; k++) ids.push('vide');
      _setGrid(it, j, d.code, ids);
      it._tabAct = j;
      save(); _syncPanel(i); API.refresh(i);
    },
    refresh: function (i) {                                  // re-monte CE widget seul (rafraîchit sa donnée)
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var w = byId(l.items[i].w), body = document.getElementById(HOST_ID + '-b' + i); if (!w || !body) return;
      var card = body.closest('.wdg-card'); if (card) { card.classList.remove('wdg-refresh'); void card.offsetWidth; card.classList.add('wdg-refresh'); }
      // Exécute d'ABORD le cleanup de l'ancien montage (root amCharts / carte Leaflet / timers / listeners)
      // — sans ça, chaque « Actualiser » orphelinait l'instance précédente jusqu'au prochain renderGrid.
      if (body._wdgClean) { try { body._wdgClean(); } catch (e) {} STATE.mounted = STATE.mounted.filter(function (f) { return f !== body._wdgClean; }); body._wdgClean = null; }
      body.innerHTML = ''; try { var un = w.mount(body, l.items[i]); if (typeof un === 'function') { STATE.mounted.push(un); body._wdgClean = un; } } catch (e) {}
    },
    fullscreen: function (i) { _fullscreenIdx = (_fullscreenIdx === i ? null : i); renderGrid(); },
    // REMPLACER : la carte garde sa PLACE et sa TAILLE, seul son contenu change. Les réglages et les
    // onglets de l'ancien widget sont abandonnés — ils appartiennent à un autre contrat.
    replaceStart: function (i) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      if (l.items[i].locked) return _undoOffer('Carte verrouillée : déverrouille-la pour la remplacer.');
      _closePops(); API.openLib(); _pickSwap = i;   // openLib oublie TOUTES les cibles → on pose la nôtre après
    },
    toggleInfo: function (i) { _togglePop(i, 'i'); },
    toggleSettings: function (i) { _togglePop(i, 's'); },
    closePops: function () { _closePops(); },              // croix des panneaux de réglages
    // Réglages du widget DANS l'onglet : panneau propre, rempli à l'ouverture (l'onglet actif peut
    // avoir changé depuis le dernier rendu de la carte).
    toggleSubSettings: function (i, c) {
      var pop = document.getElementById(HOST_ID + '-ss' + i); if (!pop) return;
      // Onglet composite : re-cliquer sur l'engrenage d'une AUTRE case ne doit pas fermer le
      // panneau, mais basculer dessus — sinon il faudrait deux clics pour passer d'une case à l'autre.
      var ouvert = !pop.hidden && _ssCell[i] === (c == null ? null : c);
      _closePops();
      if (ouvert) { _ssCell[i] = undefined; return; }        // re-clic sur la MÊME case = fermeture
      _ssCell[i] = (c == null ? null : c);
      pop.innerHTML = _subPanelHtml(i, _ssCell[i]);
      pop.hidden = false;
    },
    add: function (wid) {
      var l = activeLayout(), w = byId(wid); if (!l || !w) return;
      // Ceinture si appel direct (la carte est inerte et n offre jamais ce clic) : refus SILENCIEUX,
      // « note » n existe pas a cette portee (variable locale d importCfg, verifie le 18/08).
      if (_wBientot(w)) return;
      if (_pickSwap != null && l.items[_pickSwap]) {
        var old = l.items[_pickSwap], ancien = byId(old.w);
        if (wid !== old.w) {
          l.items[_pickSwap] = { w: wid, gw: old.gw, gh: old.gh };     // place et taille conservées
          save(); renderGrid();
          _undoOffer((ancien ? ancien.name : 'Widget') + ' remplacé par ' + w.name, function () {
            var cur = activeLayout(); if (cur && cur.items[_swapBack.i]) { cur.items[_swapBack.i] = _swapBack.it; save(); renderGrid(); }
          });
          _swapBack = { i: _pickSwap, it: old };
        }
        _pickSwap = null; API.closeLib();
        return;
      }
      // CELLULE d'un onglet composite — testée AVANT les branches d'onglet : sans ça, le clic
      // retomberait sur « ajouter un onglet en fin » (la comparaison `tabs[at] === 'vide'` est fausse
      // pour un onglet 'grille') et créerait un onglet parasite au lieu de remplir la case visée.
      if (_pickCell && _pickTab != null && l.items[_pickTab] && l.items[_pickTab].w === 'onglets' && wid !== 'onglets') {
        var pc = l.items[_pickTab], jc = _pickCell.j, cc = _pickCell.c;
        var gc = _gridParse(_gridOf(pc, jc));
        if (gc && cc >= 0 && cc < gc.ids.length) {
          gc.ids[cc] = wid;
          pc.tabGrid[jc] = _gridStr(gc.code, gc.ids);
          pc._tabAct = jc;
          save(); API.closeLib(); renderGrid();
        }
        _pickCell = null;
        return;
      }
      if (_pickTab != null && l.items[_pickTab] && l.items[_pickTab].w === 'onglets') {
        // Ajout d'un ONGLET dans un Panneau à onglets (jamais un panneau dans lui-même).
        if (wid !== 'onglets') {
          var pt = l.items[_pickTab];
          /* ⚠️ BUG CORRIGÉ (23/08, constat user : « Remplacer a AJOUTÉ un onglet ») : la condition
             exigeait un onglet 'vide' — sur un onglet OCCUPÉ (le cas nominal du bouton Remplacer),
             elle échouait et on retombait dans l'ajout en fin. Un onglet ciblé se REMPLACE, vide
             ou occupé ; seul un onglet composite ('grille') passe encore par l'ajout : l'écraser
             en silence détruirait plusieurs widgets d'un coup. */
          if (_pickTabAt != null && Array.isArray(pt.tabs) && pt.tabs[_pickTabAt] != null && pt.tabs[_pickTabAt] !== 'grille') {
            pt.tabs[_pickTabAt] = wid;
            pt._tabAct = _pickTabAt;
          } else {
            // Cap 12 = celui du serveur (_wdgClean) — l'ancien 8 JETAIT EN SILENCE le nouvel onglet
            // dès que le panneau en avait 8 (la Vue générale en a 9 : « + » semblait mort).
            if ((pt.tabs || []).length >= 12) { _undoOffer('Ce panneau est plein (12 onglets).'); _pickTabAt = null; return; }
            pt.tabs = (pt.tabs || []).concat([wid]);
            pt._tabAct = pt.tabs.length - 1;                  // le nouvel onglet devient l'actif
          }
          _pickTabAt = null;
          save(); API.closeLib(); renderGrid();
        }
        return;
      }
      if (_pickIdx != null && l.items[_pickIdx] && l.items[_pickIdx].w === 'slot') {
        // Remplit l'EMPLACEMENT ciblé : le widget hérite de la géométrie du slot (celle de la disposition choisie).
        // Ici on FERME (retour au desk : on voit le widget prendre sa place, puis on clique l'emplacement suivant).
        var s = l.items[_pickIdx];
        l.items[_pickIdx] = { w: wid, gw: s.gw, gh: s.gh };
        save(); API.closeLib(); renderGrid();
        return;
      }
      // AJOUT MULTIPLE (parcours guidé) : la bibliothèque RESTE OUVERTE → on compose plusieurs widgets d'affilée.
      // Le compteur « N× » de la carte se met à jour ; le desk se re-rend derrière le voile. Fermer = croix/voile.
      if (l.items.length >= _IMAX) { _undoOffer('Ce desk est plein (' + _IMAX + ' widgets). Crée un autre desk pour continuer.'); return; }
      l.items.push({ w: wid, gw: 6, gh: _clamp(Math.round((w.h || 300) / ROW_PX) + 1, 5, 40) });
      save(); renderGrid();
      // FEEDBACK : le nouveau widget flashe + on scrolle jusqu'à lui (visible derrière le voile de la modale).
      var host = document.getElementById(HOST_ID);
      requestAnimationFrame(function () {
        var card = host && host.querySelector('.wdg-card[data-idx="' + (l.items.length - 1) + '"]');
        if (card) { card.classList.add('wdg-refresh'); try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {} }
      });
      _justAdded = wid;                                                       // la carte cliquée affiche « ✓ Ajouté »
      var g = document.getElementById('wdg-lib-grid'); var st = g ? g.scrollTop : 0;
      renderLib();
      if (g) g.scrollTop = st;                                                // ne pas perdre la position de lecture
      setTimeout(function () {
        _justAdded = null;
        var el = g && g.querySelector('.wdg-lib-card--added'); if (el) el.classList.remove('wdg-lib-card--added');
      }, 950);
    },
    pickFor: function (i) { API.openLib(); _pickIdx = i; },   // (après openLib, qui remet _pickIdx à null)
    openLib: function () {
      _closePops();                                   // un panneau de carte ne doit pas flotter au-dessus de la modale
      var d = document.getElementById('wdg-lib'); if (!d) return;
      d.classList.add('open'); _libQ = ''; _oublieCibles();
      var s = document.getElementById('wdg-lib-search'); if (s) { s.value = ''; setTimeout(function () { s.focus(); }, 60); }
      API.filterFam('');                                        // repart sur « Tous » (chips + rendu)
    },
    closeLib: function () {
      var d = document.getElementById('wdg-lib'); if (d) d.classList.remove('open'); _oublieCibles(); },
    filterLib: function (q) { _libQ = String(q || '').trim(); renderLib(); },
    filterFam: function (f) {                                   // puces de catégories (Tous · Analyse · Données · Modèles)
      _libFam = String(f || '');
      document.querySelectorAll('#wdg-lib-chips .wdg-chip').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-fam') === _libFam);
      });
      renderLib();
    },

    // ── MODÈLES PRÊTS : crée un NOUVEAU layout depuis le preset (jamais d'écrasement) et l'ouvre. ──
    usePreset: function (i) {
      var c = STATE.cfg, p = PRESETS[i]; if (!c || !p || c.layouts.length >= _LMAX) return;
      var id = 'lay-' + uid();
      c.layouts.push({ id: id, name: p.name, fav: false, items: JSON.parse(JSON.stringify(p.items)) });
      c.active = id; save(); API.closeManager(); API.closeLib(); renderBar(); renderGrid();   // depuis la biblio OU le gestionnaire → fermer les deux
    },

    // ── EXPORT / IMPORT de la configuration (fichier JSON : sauvegarde personnelle / passage de compte) ──
    exportCfg: function () {
      var c = STATE.cfg; if (!c) return;
      var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
      var name = 'mon-desk-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
      var blob = new Blob([JSON.stringify({ dtpWidgets: 1, cfg: c }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    },
    importCfg: function (input) {                       // AJOUTE les layouts du fichier (rien d'écrasé, plafond respecté)
      var f = input && input.files && input.files[0]; if (!f) return;
      var slot = document.getElementById('wdg-mgr-bak');
      var note = function (msg) { if (slot) { var n = document.createElement('div'); n.className = 'wdg-mgr-note'; n.textContent = msg; slot.parentNode.insertBefore(n, slot); setTimeout(function () { n.remove(); }, 6000); } };
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var j = JSON.parse(String(rd.result || ''));
          var lays = (j && j.cfg && j.cfg.layouts) || (j && j.layouts) || null;
          if (!Array.isArray(lays) || !lays.length) { note('Fichier non reconnu (export Mon Desk attendu).'); return; }
          var c = STATE.cfg, added = 0;
          lays.forEach(function (l) {
            if (!l || !Array.isArray(l.items) || c.layouts.length >= _LMAX) return;
            var items = l.items.filter(function (it) { return it && (it.w === 'slot' || byId(it.w)); }).map(function (it) {
              // MÊME PIÈGE QUE LE SANITIZER SERVEUR : tout champ non recopié ici est perdu à l'import.
              // Il manquait tabs / tabLabels / cfg → réimporter son propre export rendait les panneaux
              // à onglets vides et remettait tous les réglages par défaut.
              var o = _normItem({ w: it.w, gw: it.gw, gh: it.gh, h: it.h, col: it.col, locked: !!it.locked });
              if (Array.isArray(it.tabs)) {
                // BUG CORRIGÉ 06/08 : ce chemin était resté au CAP 8 alors que le serveur et les deux
                // chemins d'ajout sont à 12 — réimporter son propre export de « Vue générale »
                // (9 onglets) perdait TAUX et BANQUES. Et le filtre `byId(t)` jetait les SENTINELS :
                // les onglets vides disparaissaient, les composites aussi.
                var tabs = it.tabs.filter(function (t) {
                  return typeof t === 'string' && (t === 'vide' || t === 'grille' || byId(t));
                }).slice(0, 12);
                if (tabs.length) {
                  o.tabs = tabs;
                  if (Array.isArray(it.tabLabels)) {
                    var tl = it.tabLabels.slice(0, tabs.length).map(function (s) { return typeof s === 'string' ? s.replace(/[<>]/g, '').trim().slice(0, 18) : ''; });
                    if (tl.some(Boolean)) o.tabLabels = tl;
                  }
                  // Dispositions et réglages par onglet/case : sans cette reprise, un export/import
                  // raserait tout l'agencement interne des panneaux.
                  if (Array.isArray(it.tabGrid)) {
                    var tg = it.tabGrid.slice(0, tabs.length).map(function (s) { return typeof s === 'string' ? s.replace(/[^a-z0-9|:-]/g, '').slice(0, 240) : ''; });
                    if (tg.some(Boolean)) o.tabGrid = tg;
                  }
                  if (it.tabCfg && typeof it.tabCfg === 'object' && !Array.isArray(it.tabCfg)) {
                    var tc = {};
                    Object.keys(it.tabCfg).forEach(function (k) {
                      if (!/^\d{1,2}(-\d{1,2})?$/.test(k) || parseInt(k, 10) >= tabs.length) return;
                      var s2 = it.tabCfg[k];
                      if (s2 && typeof s2 === 'object' && !Array.isArray(s2)) tc[k] = s2;
                    });
                    if (Object.keys(tc).length) o.tabCfg = tc;
                  }
                }
              }
              if (it.cfg && typeof it.cfg === 'object' && !Array.isArray(it.cfg)) {
                var cfg = {}, w0 = byId(it.w);
                Object.keys(it.cfg).slice(0, 12).forEach(function (k) {
                  if (!/^[a-z0-9_]{1,24}$/.test(k) || !optDef(w0, k)) return;   // clé inconnue du contrat → ignorée
                  // MEME RAISON QU A LA DUPLICATION : un document appartient au compte qui l a
                  // ecrit. L importer ferait pointer la carte importee sur la note de quelqu un
                  // d autre, ou sur une note deja ouverte ailleurs.
                  if (k === 'doc') return;
                  var v = it.cfg[k];
                  if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') cfg[k] = v;
                });
                if (Object.keys(cfg).length) o.cfg = cfg;
              }
              return o;
            });
            var neuf = { id: 'lay-' + uid(), name: String(l.name || '').replace(/[<>"']/g, '').trim().slice(0, 40) || 'Importé', fav: false, items: items };
            // MÊME PIÈGE, UN NIVEAU AU-DESSUS : `ico` non recopié ici, et réimporter sa propre
            // sauvegarde complète effaçait l'icône de TOUTES les dispositions. Revalidé (fichier
            // extérieur) contre le catalogue, pas seulement contre la forme acceptée par le serveur.
            if (typeof l.ico === 'string' && _LAYICO_RX.test(l.ico) && _LAYICO[l.ico]) neuf.ico = l.ico;
            c.layouts.push(neuf);
            added++;
          });
          if (added) { save(); renderBar(); renderManager(); note(added + ' layout' + (added > 1 ? 's' : '') + ' importé' + (added > 1 ? 's' : '') + ' ✓'); }
          else note('Rien à importer (plafond atteint ou widgets inconnus).');
        } catch (e) { note('Fichier illisible (JSON attendu).'); }
        input.value = '';
      };
      rd.readAsText(f);
    },

    // ── LAYOUTS (templates) ──
    // Masquer / ré-ouvrir un layout : masqué = son onglet DISPARAÎT de la barre (le layout reste au gestionnaire).
    // Jamais 0 onglet visible ; masquer l'ACTIF bascule sur le premier visible.
    toggleHide: function (id) {
      var c = STATE.cfg, l = layoutById(id); if (!c || !l) return;
      _delConfirm = null;
      if (!l.hidden) {
        if (c.layouts.filter(function (x) { return !x.hidden; }).length <= 1) return;   // dernier visible → refus
        l.hidden = true;
        if (c.active === id) { var nxt = c.layouts.find(function (x) { return !x.hidden; }); if (nxt) c.active = nxt.id; }
      } else l.hidden = false;
      save(); renderBar(); renderManager(); renderGrid();
    },
    switchLayout: function (id) {
      var c = STATE.cfg; if (!c || !layoutById(id)) return;
      var lsw = layoutById(id); if (lsw && lsw.hidden) lsw.hidden = false;   // « Ouvrir » un layout fermé = le ré-afficher
      _delConfirm = null; c.active = id; save(); renderBar(); renderManager(); renderGrid();
      // Parcours guidé (demande user) : layout choisi → s'il y a DE QUOI COMPOSER (vide ou emplacements),
      // on ATTERRIT sur › Widgets ; s'il est déjà composé, on montre directement le desk choisi.
      var mgrOpen = (function () { var d = document.getElementById('wdg-mgr'); return d && d.classList.contains('open'); })();
      API.closeManager();
      if (mgrOpen) {
        var l = layoutById(id);
        var composable = l && (!l.items.length || l.items.some(function (it) { return it && it.w === 'slot'; }));
        if (composable && l.items.length) API.openLib();   // desk à emplacements → biblio prête à remplir (le desk VIDE a déjà son écran guidé)
      }
    },
    // Création GUIDÉE : « + » ouvre le CHOIX DE DISPOSITION (mini-schémas) ; createLayout(i) crée le layout
    // avec les emplacements du squelette DISPOS[i] (ou vide pour « Libre »).
    // ORDRE DES ETAPES (20/08, captures) : nom + icône D'ABORD, disposition ENSUITE. L'ancien ordre
    // (disposition puis nom) faisait nommer un agencement qu'on venait à peine de voir ; le nouveau
    // suit le parcours demandé : on crée l'identité du layout, puis on choisit sa grille.
    newLayout: function () {
      var c = STATE.cfg; if (!c || c.layouts.length >= _LMAX) return;
      _dispoTarget = 'new'; _mgrMode = 'nom';
      _newNom = ''; _newIco = ''; _newDispo = null; _icoTab = 'ico'; _icoQ = '';
      API.openManager();
    },
    pickDispo: function () {                            // écran guidé (desk vide) : la disposition remplit CE desk
      _dispoTarget = 'current'; _mgrMode = 'dispo';
      API.openManager();
    },
    backManager: function () { _mgrMode = null; renderManager(); },
    // ÉTAPE 2 du parcours de création : la disposition est RETENUE, pas encore créée, on passe à
    // l'écran « nom + icône ». L'icône repart à vide à chaque création : ne rien préselectionner évite
    // qu'un choix précédent se colle en douce sur une disposition qu'on croyait neutre.
    nameLayout: function (di) {
      var c = STATE.cfg; if (!c || c.layouts.length >= _LMAX) return;
      _newDispo = (di == null) ? null : (di | 0);
      _newIco = '';
      _mgrMode = 'nom';
      renderManager();
    },
    // Annuler = revenir au CHOIX DE DISPOSITION (pas fermer le gestionnaire) : on recule d'un écran,
    // le parcours reste rattrapable sans avoir à tout rouvrir.
    // Étape 1 validée : le nom est STOCKÉ (l'input disparaît avec l'écran), puis choix de la grille.
    nameDone: function () {
      _newNom = String((document.getElementById('wdg-newname') || {}).value || '').replace(/[<>]/g, '').trim().slice(0, 40);
      _mgrMode = 'dispo'; renderManager();
    },
    // Retour depuis le choix de disposition : vers l'étape nom si on crée, vers la liste sinon
    // (le desk vide guidé n'a pas d'étape nom : son layout a déjà les siens).
    backFromDispo: function () { _mgrMode = (_dispoTarget === 'current') ? null : 'nom'; renderManager(); },
    backDispo: function () { _mgrMode = 'dispo'; renderManager(); },
    setNewIco: function (id) {
      var v = String(id == null ? '' : id);
      // Un identifiant hors format serait REJETÉ par le sanitizer serveur : l'icône s'afficherait ici
      // puis disparaîtrait au rechargement, sans le moindre message. On refuse en amont plutôt que de
      // promettre un choix qui ne survivra pas à l'enregistrement.
      if (v && !_LAYICO_RX.test(v)) return;
      _newIco = v;
      // MISE À JOUR EN PLACE, JAMAIS DE RE-RENDU : renderManager() réécrirait tout le panneau et
      // effacerait le nom déjà tapé (le champ est reconstruit vide). On ne touche donc qu'aux classes
      // et à l'état ARIA des pastilles.
      var box = document.getElementById('wdg-mgr-list'); if (!box) return;
      box.querySelectorAll('.wdg-ico-pick').forEach(function (b) {
        var on = (b.getAttribute('data-ico') || '') === _newIco;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    },
    layoutIcons: layoutIcons,        // catalogue d'icônes de disposition (lecture seule, copie défensive)
    // Renommage INLINE d'une carte de layout (double-clic sur son nom) : le libellé devient un
    // champ, Entrée/blur valide, Échap annule — même grammaire que les onglets.
    editCardName: function (id, span) {
      var l = layoutById(id); if (!l || !span || span._edit) return;
      span._edit = 1;
      var inp = document.createElement('input');
      inp.className = 'wdg-mgr-nomedit'; inp.maxLength = 40; inp.value = l.name;
      inp.setAttribute('spellcheck', 'false'); inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('data-lpignore', 'true'); inp.setAttribute('data-1p-ignore', '');
      inp.setAttribute('data-bwignore', ''); inp.setAttribute('data-protonpass-ignore', 'true');
      span.replaceWith(inp); inp.focus(); inp.select();
      var fait = false;
      var fin = function (ok) {
        if (fait) return; fait = true;
        if (ok) { API.renameLayout(id, inp.value); renderBar(); }
        renderManager();
      };
      inp.addEventListener('click', function (e) { e.stopPropagation(); });
      inp.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false);
      });
      inp.addEventListener('blur', function () { fin(true); });
    },
    createLayout: function (di) {
      var c = STATE.cfg; if (!c) return;
      _delConfirm = null; _mgrMode = null;
      var dispo = (di == null) ? null : DISPOS[di | 0];
      var slots = (dispo && dispo.items.length)
        ? dispo.items.map(function (s) { return { w: 'slot', gw: s.gw, gh: s.gh }; })
        : [];
      // PLEINE PAGE (demande user 26/07 « ça doit prendre tout l'espace ») : les hauteurs de conception (rows)
      // sont MISES À L'ÉCHELLE de la hauteur réelle de la grille → la disposition remplit le viewport, zéro
      // vide en bas. On n'agrandit que (jamais de rétrécissement sous la conception sur petit écran).
      if (slots.length && dispo.rows) {
        try {
          var host = document.getElementById(HOST_ID);
          var cs = host ? getComputedStyle(host) : null;
          var gapR = cs ? (parseFloat(cs.rowGap) || 10) : 10;
          var padV = cs ? ((parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)) : 24;
          var availRows = host && host.clientHeight ? Math.floor((host.clientHeight - padV + gapR) / (ROW_PX + gapR)) : 0;
          if (availRows > dispo.rows) {
            // Arrondir CHAQUE hauteur separement casse les proportions : sur « Principal + colonne »
            // (14 · 7 · 7) avec 21 rangees disponibles, le principal donnait round(14 x 1,5) = 21 et
            // les deux blocs de droite round(7 x 1,5) = 11 chacun, soit 22. Une rangee d ecart, et la
            // colonne de gauche s arretait avant la droite.
            // On met a l echelle l UNITE (PGCD des hauteurs) une seule fois : chaque hauteur etant un
            // multiple entier de cette unite, les rapports sont conserves exactement.
            var _pg = slots.reduce(function (a2, s) { var x = a2, y = s.gh; while (y) { var t = y; y = x % y; x = t; } return x; }, 0) || 1;
            var k = availRows / dispo.rows;
            var _u = Math.max(1, Math.round(_pg * k));
            slots.forEach(function (s) { s.gh = _clamp((s.gh / _pg) * _u, 3, 60); });
          }
        } catch (e) {}
      }
      if (_dispoTarget === 'current') {                 // remplir le desk VIDE actif (pas de nouveau layout)
        _dispoTarget = 'new'; _newDispo = null; _newIco = '';
        var l = activeLayout();
        if (!l || l.items.length) { API.closeManager(); return; }
        l.items = slots;
        save(); API.closeManager(); renderGrid();
        return;
      }
      if (c.layouts.length >= _LMAX) return;
      // Nom saisi à l'écran « nom + icône » (parcours ordonné : disposition → nom/icône → widgets).
      // Même nettoyage que le serveur (chevrons retirés, coupe à 40) ; VIDE = repli sur un nom par
      // défaut, jamais de blocage : personne ne doit rester coincé sur un champ pour avancer.
      // Le nom vient de l'étape 1 (stocké par nameDone) : l'input n'est plus à l'écran ici. On
      // retente l'input par prudence (parcours guidé, anciens chemins), le stock prime.
      var nm = (_newNom || String((document.getElementById('wdg-newname') || {}).value || '')).replace(/[<>]/g, '').trim().slice(0, 40);
      _newNom = '';
      var id = 'lay-' + uid();
      var nouveau = { id: id, name: nm || 'Nouveau layout', fav: false, items: slots };
      // `ico` reste ABSENT quand aucune icône n'est choisie : le champ est optionnel des deux côtés
      // (sanitizer serveur comme rendu), et une disposition sans icône est un cas normal, pas un trou.
      if (_newIco) nouveau.ico = _newIco;
      c.layouts.push(nouveau);
      _newDispo = null; _newIco = '';
      // (L'ancien saut automatique en renommage inline quand le nom était vide a disparu avec
      // l'arrivée de l'écran de nommage : le champ a été proposé, le laisser vide est un CHOIX.)
      c.active = id; save(); API.closeManager(); renderBar(); renderGrid();
    },
    applyPreset: function (i) {                         // écran guidé : composer un modèle prêt DANS ce desk vide
      var l = activeLayout(), p = PRESETS[i]; if (!l || !p || l.items.length) return;
      l.items = JSON.parse(JSON.stringify(p.items));
      save(); renderGrid();
    },
    renameLayout: function (id, name) {
      var l = layoutById(id); if (!l) return;
      l.name = String(name || '').replace(/[<>]/g, '').trim().slice(0, 40) || 'Sans nom';   // même règle que le serveur
      save(); renderBar(); renderManager();
    },
    // FAVORIS de la BIBLIOTHÈQUE (10/08, phase 2) — à ne pas confondre avec toggleFav (layout par défaut).
    toggleWfav: function (wid) {
      if (!STATE.cfg) return;
      var f = Array.isArray(STATE.cfg.wfavs) ? STATE.cfg.wfavs : (STATE.cfg.wfavs = []);
      var i = f.indexOf(wid);
      if (i >= 0) f.splice(i, 1); else { if (f.length >= 30) f.pop(); f.unshift(wid); }
      save(); renderLib();
    },
    // EXPORT du layout ACTIF en .json (10/08, phase 2) : {v, name, items} — items déjà au modèle
    // persisté (le sanitizer serveur revalidera tout à l'import chez le destinataire).
    exportLayout: function () {
      var l = activeLayout(); if (!l) { _wdgNote('Aucun layout actif à exporter.'); return; }
      // `ico` VOYAGE AVEC LE FICHIER (17/08) : le même piège que tabs/tabLabels/cfg, un cran plus haut.
      // Tout champ absent d'ici est perdu à l'aller ; tout champ absent de l'import est perdu au retour.
      // Sans les deux, réimporter son propre export rendait la disposition anonyme dans la barre.
      var data = { v: 1, app: 'datatradingpro', name: l.name, ico: l.ico || undefined, items: l.items };
      var slug = String(l.name || 'layout').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'layout';
      var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      var a = document.createElement('a');
      a.href = url; a.download = 'dtp-layout-' + slug + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      _wdgNote('Layout « ' + l.name + ' » exporté (.json).');
    },
    // IMPORT d'un .json exporté ci-dessus : nouveau layout (jamais d'écrasement), widgets inconnus
    // écartés, géométrie normalisée par _normItem, re-sanitisé serveur au save. Plafond respecté.
    importLayout: function () {
      var c = STATE.cfg; if (!c) return;
      if (c.layouts.length >= _LMAX) { _wdgNote('Plafond de ' + _LMAX + ' layouts atteint : supprime un layout avant d\'importer.'); return; }
      var inp = document.getElementById('wdg-import-file');
      if (!inp) {
        inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,application/json'; inp.id = 'wdg-import-file';
        inp.style.display = 'none';
        document.body.appendChild(inp);
        inp.addEventListener('change', function () {
          var f = inp.files && inp.files[0]; inp.value = '';
          if (!f) return;
          var rd = new FileReader();
          rd.onload = function () {
            var d = null;
            try { d = JSON.parse(String(rd.result || '')); } catch (e) {}
            if (!d || !Array.isArray(d.items)) { _wdgNote('Fichier illisible : ce n\'est pas un export de layout DTP.'); return; }
            var items = d.items.filter(function (it) { return it && typeof it.w === 'string' && byId(it.w); }).slice(0, 40).map(_normItem);
            if (!items.length) { _wdgNote('Aucun widget reconnu dans ce fichier (catalogue différent ?).'); return; }
            var ecartes = d.items.length - items.length;
            var nom = (String(d.name || 'Importé').replace(/[<>]/g, '').trim().slice(0, 34) || 'Importé');
            var l = { id: uid(), name: nom, items: items };
            // Le fichier vient de l'extérieur : on revalide l'identifiant d'icône au lieu de le
            // recopier. Un id hors catalogue ne casserait rien à l'écran (_layIco n'écrit rien) mais
            // survivrait au sanitizer serveur et resterait une donnée morte dans la config.
            if (typeof d.ico === 'string' && _LAYICO_RX.test(d.ico) && _LAYICO[d.ico]) l.ico = d.ico;
            c.layouts.push(l); c.active = l.id;
            save(); renderBar(); renderManager(); renderGrid();
            _wdgNote('Layout « ' + nom + ' » importé (' + items.length + ' widget' + (items.length > 1 ? 's' : '') + (ecartes > 0 ? ', ' + ecartes + ' inconnu' + (ecartes > 1 ? 's' : '') + ' écarté' + (ecartes > 1 ? 's' : '') : '') + ').');
          };
          rd.readAsText(f);
        });
      }
      inp.click();
    },
    toggleFav: function (id) {
      // ★ = TEMPLATE PAR DÉFAUT (exclusif, demande user 23/07) : une seule étoile — la poser sur un layout la
      // retire des autres ; re-cliquer la retire (→ retour au comportement « dernier utilisé »).
      var l = layoutById(id); if (!l) return;
      _delConfirm = null;
      var was = !!l.fav;
      (STATE.cfg.layouts || []).forEach(function (x) { x.fav = false; });
      l.fav = !was;
      save(); renderBar(); renderManager();
    },
    // Chevron de rangée : déplie la miniature d'agencement. ACCORDÉON (un seul ouvert) — plusieurs
    // rangées dépliées repoussaient les suivantes hors de l'écran, ce qui est précisément le défaut
    // que la mise en rangées corrige.
    // Onglet et recherche du choix d'icône. Le champ garde le focus et le curseur : re-rendre tout
    // l'écran à chaque frappe le lui ferait perdre, et la saisie deviendrait impossible.
    setIcoTab: function (t) { _icoTab = String(t || 'ico'); _icoQ = ''; renderManager(); },
    filterIco: function (v) {
      _icoQ = String(v || '');
      var ch = document.getElementById('wdg-ico-q');
      var pos = ch ? ch.selectionStart : null;
      renderManager();
      var ne = document.getElementById('wdg-ico-q');
      if (ne) { ne.focus(); if (pos != null) { try { ne.setSelectionRange(pos, pos); } catch (e) {} } }
    },
    peekLayout: function (id) { _peek = (_peek === id) ? null : id; renderManager(); },
    askDelete: function (id) { if (id === PROTECTED_ID) return; _delConfirm = id; renderManager(); },   // 1er clic : confirmation inline (jamais pour le modèle par défaut)
    deleteLayout: function (id) {
      var c = STATE.cfg; if (!c) return;
      _delConfirm = null;
      if (id === PROTECTED_ID) return;                                     // modèle par défaut = NON supprimable
      c.layouts = c.layouts.filter(function (l) { return l.id !== id; });
      if (!c.layouts.length) {                                             // filet (ne devrait pas arriver : le défaut reste)
        c.layouts.push({ id: 'lay-' + uid(), name: 'Mon desk', fav: false, items: [] });
      }
      if (c.active === id || !layoutById(c.active)) c.active = c.layouts[0].id;
      save(); renderBar(); renderManager(); renderGrid();
    },
    openManager: function () {
      _closePops();
      var d = document.getElementById('wdg-mgr'); if (!d) return;
      _wireMgr();                                                  // réordonner par ⠿ (câblé une fois)
      _delConfirm = null; d.classList.add('open'); renderManager();
      /* L'ESPACEMENT SE RÈGLE ICI DEPUIS LE 09/09 : il a suivi le panneau, son état actif aussi.
         Sans cet appel, les deux boutons s'ouvriraient sans qu'AUCUN ne soit allumé — le réglage
         serait en place et paraîtrait non réglé. */
      _syncDensity();
      // SAUVEGARDE PAR COMPTE (demande user « récupérable si un souci s'impose ») : affiche la date du
      // snapshot serveur + bouton Restaurer (réversible : la config courante devient la sauvegarde).
      var slot = document.getElementById('wdg-mgr-bak');
      // ⚠️ CIBLAGE PAR ID, pas par classe : `.wdg-mgr-foot` sert AUSSI au pied de chaque carte de
      // layout, et les cartes viennent AVANT le pied du gestionnaire dans le document — le
      // querySelector attrapait donc le pied de la PREMIÈRE CARTE et la barre « Sauvegarde auto /
      // Restaurer » s'affichait par-dessus la miniature du premier layout (constaté user 06/08).
      if (!slot) { slot = document.createElement('div'); slot.id = 'wdg-mgr-bak'; slot.className = 'wdg-mgr-bak'; var foot = document.getElementById('wdg-mgr-footbar'); if (foot) foot.insertBefore(slot, foot.firstChild); }
      slot.innerHTML = '';
      fetch('/api/widgets/backup').then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !slot.isConnected) return;
        // TROIS VERSIONS (12/08) : une par jour, la plus récente en tête. Un seul bouton ne suffisait
        // pas — après un bug passé inaperçu quelques heures, l'unique sauvegarde portait déjà l'état
        // cassé. Chaque jalon a son bouton daté, et « Restaurer » reste réversible.
        var vs = (j.versions && j.versions.length) ? j.versions : (j.at ? [{ i: 0, at: j.at }] : []);
        if (!vs.length) return;
        var fmt = function (t) { return new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
        // Ancienneté RELATIVE en tête de rangée (« il y a 2 j ») : c'est elle qu'on lit pour choisir
        // où revenir, la date exacte reste à côté. Rangées pleine largeur avec l'action ÉCRITE
        // (« Restaurer ») : trois pastilles grises identiques n'annonçaient leur effet qu'au survol.
        var age = function (t) {
          var m = Math.max(0, Math.round((Date.now() - t) / 60000));
          if (m < 60) return 'il y a ' + m + ' min';
          var h = Math.round(m / 60);
          if (h < 48) return 'il y a ' + h + ' h';
          return 'il y a ' + Math.round(h / 24) + ' j';
        };
        slot.innerHTML = '<div class="wdg-bak-tete">'
          + '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.3"/><path d="M3 4.5V9h4.5"/><path d="M12 7.5V12l3 2"/></svg>'
          + '<span>Sauvegardes automatiques</span></div>'
          + vs.map(function (v, k) {
              // UNE SEULE rangée visible (20/08, demande user « gagne en espace ») : la plus récente,
              // qui l'est par construction (le badge devenait redondant). Les anciennes restent à UN
              // CLIC (bak-vieux + dépliage) : la leçon du 12/08 est qu'une sauvegarde unique SANS
              // recours avait déjà porté un état cassé sans s'en douter.
              return '<button class="wdg-bak-l' + (k > 0 ? ' bak-vieux' : '') + '" onclick="DTPWidgets.restoreBackup(' + v.i + ')"'
                + ' title="Revenir à cette sauvegarde">'
                + '<span class="wdg-bak-age">' + esc(age(v.at)) + '</span>'
                + '<span class="wdg-bak-date">' + esc(fmt(v.at)) + (v.panneaux ? ' · ' + v.panneaux + ' dispo.' : '') + '</span>'
                + '<span class="wdg-bak-go">Restaurer</span></button>';
            }).join('')
          + (vs.length > 1 ? '<button type="button" class="wdg-bak-plus" onclick="DTPWidgets.bakToggle(this)" data-n="' + (vs.length - 1) + '">› ' + (vs.length - 1) + ' plus ancienne(s)</button>' : '');
      }).catch(function () {});
    },
    // Dépliage des sauvegardes anciennes (une seule visible par défaut, demande user 20/08).
    bakToggle: function (btn) {
      var b = btn && btn.closest('.wdg-mgr-bak'); if (!b) return;
      var ouvert = b.classList.toggle('ouvert');
      btn.textContent = ouvert ? 'Masquer les anciennes' : ('› ' + (btn.getAttribute('data-n') || '') + ' plus ancienne(s)');
    },
    restoreBackup: function (i) {
      fetch('/api/widgets/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ i: (typeof i === 'number' ? i : 0) }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok || !j.cfg) return;
        STATE.cfg = j.cfg;
        renderBar(); renderManager(); renderGrid();
        API.openManager();   // rafraîchit la date de sauvegarde (désormais = l'ancien état courant, ré-échangeable)
      }).catch(function () {});
    },
    // Fermer remet le parcours de création à zéro : rouvrir le gestionnaire doit repartir de la LISTE,
    // pas rejouer une étape à moitié remplie (disposition retenue, icône choisie) d'une session passée.
    closeManager: function () { var d = document.getElementById('wdg-mgr'); if (d) d.classList.remove('open'); _mgrMode = null; _dispoTarget = 'new'; _newDispo = null; _newIco = ''; },
    editTab: editTab,                                     // double-clic sur un onglet → renommage inline

    // Densité de la grille : 'loose' = espacés (défaut) / 'tight' = collés. Persistée dans le cfg KV (par compte).
    setGap: function (m) {
      var c = STATE.cfg; if (!c) return;
      c.gap = (m === 'tight' ? 'tight' : 'loose');
      save(); renderGrid();
      /* ⚠️ ET ON RAFRAÎCHIT LE BOUTON. `setGap` re-rendait la grille sans toucher à son propre
         contrôle : le panneau restant ouvert, on cliquait « Collés », le desk se resserrait, et
         « Espacés » restait allumé. Invisible tant que le réglage vivait dans la bibliothèque, qui
         se rouvrait sur `_syncDensity()` ; visible dès qu'on reste devant. */
      _syncDensity();
    },
    dismissTip: function () {                           // astuce gestes : fermée une fois pour toutes (par compte)
      var c = STATE.cfg; if (!c) return;
      c.tipSeen = 1; save(); renderGrid();
    },

    // REMISE À ZÉRO — confirmation inline en DEUX temps (charte : pas de dialog natif). Supprimer UN
    // layout demandait déjà confirmation ; ce bouton, voisin d'« Exporter » et « Importer » et de même
    // style, détruisait TOUT au premier clic. Le libellé annonce ce qui sera perdu, et l'armement
    // retombe seul au bout de 6 s pour ne pas laisser un bouton piégé.
    reset: function () {
      var btn = document.querySelector('button[onclick*="DTPWidgets.reset()"]');
      var raz = function () {
        if (btn) { btn.textContent = 'Réinitialiser tout'; btn.classList.remove('wdg-btn--danger'); }
        _resetArm = null;
      };
      if (!_resetArm) {
        var n = (STATE.cfg && STATE.cfg.layouts || []).length;
        if (btn) {
          btn.textContent = 'Confirmer ? ' + n + ' desk' + (n > 1 ? 's' : '') + ' perdu' + (n > 1 ? 's' : '');
          btn.classList.add('wdg-btn--danger');
        }
        _resetArm = setTimeout(raz, 6000);
        return;
      }
      clearTimeout(_resetArm); raz();
      _delConfirm = null; STATE.cfg = defaultCfg(); save(); renderBar(); renderManager(); renderGrid();
    },

    // TEMPS RÉEL du Radar de Biais : appelé par le handler WebSocket du desk (app.js) à chaque
    // `smartbias_update`. Repeint les widgets « Radar de Biais » montés, sans requête réseau.
    onBias: function (bias) {
      if (!bias || !bias.currencies || !_BIAS_SINKS.length) return;
      _BIAS_SINKS.slice().forEach(function (fn) { try { fn(bias); } catch (e) {} });
    },
  };
  /* ═══ VOLET D'AIDE DES WIDGETS (21/08, demande user) ═════════════════════════════════════════
     Un volet à droite qui explique à quoi sert le widget, dans le registre du desk : ce qu'il
     montre, comment le lire, à quoi il sert dans une décision.

     ⚠️ IL REPREND LA GRAMMAIRE DES VOLETS DU DESK, il n'en invente pas une autre : calé SOUS la
     topbar (jamais top:0, sinon il recouvre la barre et bloque ses icônes), rideau flouté derrière,
     un seul volet ouvert à la fois via `_closeOtherPanels`. Trois volets qui s'ouvriraient
     différemment donneraient trois produits dans le même écran.

     ⚠️ LE CONTENU EST CONSTRUIT À PARTIR DE CE QUE LE WIDGET DÉCLARE DÉJÀ : son nom, sa catégorie,
     sa description courte, et ses réglages. Un widget qui gagne une option voit donc son aide se
     mettre à jour toute seule. Le champ `aide` permet d'ajouter une lecture plus approfondie là où
     elle apporte quelque chose ; sans lui, le volet reste juste et utile, jamais vide.

     ENRICHI LE 23/08 (demande user : le volet était trop maigre, deux sections et une page à
     moitié vide) : deux champs facultatifs de plus, rendus dans le même registre h4 + p —
     - `src` (« D'où vient la donnée ») : une phrase honnête sur la source et la cadence de
       rafraîchissement, écrite d'après ce que le mount() fait RÉELLEMENT, jamais une promesse ;
     - `watch` (« Ce qu'il faut surveiller ») : les signaux qu'un trader y guette, factuels,
       JAMAIS un conseil directionnel.
     Les deux sections s'omettent quand le champ manque : la règle « jamais vide, jamais gonflé »
     reste la même que pour `aide`. */
  function _aideFermer() {
    var d = document.getElementById('wdg-aide'), o = document.getElementById('wdg-aide-ov');
    if (d) d.classList.remove('open');
    if (o) o.classList.remove('open');
  }
  function _aideOuvrir(ref) {
    var w = null;
    if (ref && typeof ref === 'object' && ref.id) {
      w = ref;                                    // widget passé directement (sous-widget d'un onglet)
    } else {
      var lay = activeLayout();                   // MÊME source que le rendu : la disposition active
      var it = lay && lay.items && lay.items[ref];
      w = it && CATALOG.filter(function (x) { return x.id === it.w; })[0];
    }
    if (!w) return;
    try { if (typeof _closeOtherPanels === 'function') _closeOtherPanels('wdgaide'); } catch (e) {}

    var ov = document.getElementById('wdg-aide-ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'wdg-aide-ov'; ov.className = 'wdg-aide-ov';
      ov.onclick = _aideFermer;
      document.body.appendChild(ov);
    }
    var d = document.getElementById('wdg-aide');
    if (!d) {
      d = document.createElement('aside');
      d.id = 'wdg-aide'; d.className = 'wdg-aide';
      document.body.appendChild(d);
    }

    var reglages = (w.opts || []).map(function (o2) {
      var choix = (o2.choix || []).map(function (c) { return esc(c[1]); }).join(' · ');
      return '<li><b>' + esc(o2.lbl || o2.k) + '</b>' + (choix ? ' : ' + choix : '') + '</li>';
    }).join('');

    d.innerHTML =
      '<header class="wdg-aide-head">'
      + '<div><span class="wdg-aide-cat">' + esc(w.cat || '') + (w.tag ? ' · ' + esc(w.tag) : '') + '</span>'
      + '<h3 class="wdg-aide-nom">' + esc(w.name) + '</h3></div>'
      + '<button class="wdg-aide-x" title="Fermer" aria-label="Fermer">' + ICO.close + '</button>'
      + '</header>'
      + '<div class="wdg-aide-corps">'
      +   '<section><h4>Ce que montre ce widget</h4><p>' + esc(w.desc || '') + '</p></section>'
      +   (w.aide ? '<section><h4>Comment le lire</h4>' + w.aide + '</section>' : '')
      // `src` et `watch` sont du HTML de confiance du CATALOGUE (comme `aide`) : balises p/strong/em
      // uniquement, écrites ici même — jamais une donnée externe.
      +   (w.src ? '<section><h4>D\'où vient la donnée</h4><p>' + w.src + '</p></section>' : '')
      +   (w.watch ? '<section><h4>Ce qu\'il faut surveiller</h4><p>' + w.watch + '</p></section>' : '')
      +   (reglages ? '<section><h4>Réglages disponibles</h4><ul class="wdg-aide-ul">' + reglages + '</ul></section>'
                    : '<section><h4>Réglages disponibles</h4><p class="wdg-aide-vide">Ce widget n\'a aucun réglage : il affiche la même chose pour tout le monde.</p></section>')
      + '</div>';
    var x = d.querySelector('.wdg-aide-x'); if (x) x.onclick = _aideFermer;

    requestAnimationFrame(function () { ov.classList.add('open'); d.classList.add('open'); });
  }
  API.aide = _aideOuvrir;
  /* Ouvre l'aide d'un widget par son IDENTIFIANT. Les sous-widgets d'un panneau à onglets ne
     figurent pas dans la disposition : ils n'ont pas d'index, seulement une identité. */
  API.aideDe = function (id) {
    var w = CATALOG.filter(function (x) { return x.id === id; })[0];
    if (w) _aideOuvrir(w);
  };
  // Échap ferme, comme partout ailleurs dans le desk.
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') _aideFermer(); });

  window.DTPWidgets = API;
  // Crochets de BANC (non documentés, sans effet en production) : ils donnent accès à l'état et au
  // rendu pour pouvoir vérifier au navigateur, sur le vrai desk, ce qu'un test unitaire ne prouve
  // pas — que la grille d'un onglet composite tient réellement dans sa carte.
  API._banc = function () { return STATE; };
  API._render = function () { renderGrid(); };
  API._save = function () { save(); };

  // ── DÉTAIL MACRO d'une devise (widget Radar de Biais) : le VRAI panneau du desk (_sbOpenDetail mode widget),
  //    rendu dans un overlay Mon Desk (mêmes classes .wdg-lib → backdrop flouté + boîte, identité desk). ──
  function _wdgBiasDetail(curr, data) {
    if (!curr || typeof _sbOpenDetail !== 'function') return;
    var ov = document.getElementById('wdg-mdet');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'wdg-mdet'; ov.className = 'wdg-lib';
      ov.innerHTML = '<div class="wdg-lib-backdrop"></div><div class="wdg-lib-box wdg-mdet-box custom-scrollbar"></div>';
      var vw = document.getElementById('view-widgets'); (vw || document.body).appendChild(ov);
      ov.querySelector('.wdg-lib-backdrop').addEventListener('click', _wdgBiasDetailClose);
    }
    var box = ov.querySelector('.wdg-mdet-box');
    try { _sbOpenDetail(curr, { wrap: box, data: data }); } catch (e) { return; }
    var x = box.querySelector('.mdet-close');
    if (x) { x.removeAttribute('onclick'); x.onclick = _wdgBiasDetailClose; }   // la croix ferme l'OVERLAY (pas le détail du desk)
    ov.classList.add('open');
  }
  function _wdgBiasDetailClose() {
    var ov = document.getElementById('wdg-mdet'); if (ov) ov.classList.remove('open');
    document.querySelectorAll('#view-widgets .mt-row--active').forEach(function (r) { r.classList.remove('mt-row--active'); });
  }

  // ÉCHAP = fermer ce qui est ouvert (détail devise → bibliothèque → gestionnaire [dispo → retour liste] → plein écran).
  // Uniquement en mode Mon Desk ; les inputs (renommage inline) stoppent déjà la propagation.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !document.body.classList.contains('wdg-mode')) return;
    var md = document.getElementById('wdg-mdet');
    if (md && md.classList.contains('open')) { _wdgBiasDetailClose(); return; }
    var lib = document.getElementById('wdg-lib'), mgr = document.getElementById('wdg-mgr');
    if (lib && lib.classList.contains('open')) { API.closeLib(); return; }
    // Échap RECULE D'UN ÉCRAN dans le parcours de création (nom + icône → dispositions → liste), il ne
    // referme le gestionnaire qu'une fois revenu à la liste. Fermer d'un coup depuis l'écran de nommage
    // ferait perdre la disposition déjà choisie pour une frappe destinée à corriger un nom.
    if (mgr && mgr.classList.contains('open')) {
      if (_mgrMode === 'nom') API.backDispo();
      else if (_mgrMode === 'dispo') API.backManager();
      else API.closeManager();
      return;
    }
    if (_fullscreenIdx != null) API.fullscreen(_fullscreenIdx);
  });

  // RÉORDONNER SES LAYOUTS au glisser-déposer (poignée ⠿ des lignes du gestionnaire, façon terminal pro).
  // Délégation sur #wdg-mgr-list (statique) → câblé UNE fois ; l'ordre des onglets de la barre suit.
  /* ⚠️ CETTE LISTE NE SE RÉORDONNAIT PLUS DU TOUT — NI AU DOIGT, NI À LA SOURIS (trouvé le 29/08 en
     auditant le tactile). Le code cherchait `.wdg-mgr-row` ; le rendu produit `.wdg-mgr-card`
     (widgets.js l.8229). La classe a été renommée un jour et les trois `closest` du glisser sont
     restés sur l'ancien nom : `closest('.wdg-mgr-row')` rendait toujours `null`, donc `dragstart`
     sortait immédiatement et rien ne bougeait jamais. Aucun contrôle ne couvrait cette liste, et le
     défaut est invisible à la lecture — deux sélecteurs plausibles, dans deux fichiers différents.
     `.wdg-mgr-row` ne subsiste plus que dans la feuille de style, où il habille encore autre chose.
     La mécanique est celle des onglets : un seul jeu d'écouteurs pour la souris ET le doigt. */
  function _wireMgr() {
    var list = document.getElementById('wdg-mgr-list');
    _glisserPourReordonner(list, '.wdg-mgr-grip', '.wdg-mgr-card', 'data-i', function (from, cible) {
      var c = STATE.cfg;
      var moved = c.layouts.splice(from, 1)[0];
      cible = Math.max(0, Math.min(c.layouts.length, cible));
      c.layouts.splice(cible, 0, moved);
      save(); renderBar(); renderManager();
    }, { appuiLong: 450, bornes: true });   // même colonne de poignées, même piège au pouce
  }

  /* ── AMORÇAGE ──────────────────────────────────────────────────────────────────────────────────
     L'ICÔNE n'est créée QUE pour l'admin : tant que le système n'est pas validé, aucun client ne la
     voit. Le desk reste STRICTEMENT inchangé pour tous les autres comptes.
     Entrée = une icône TOPBAR (même convention que Journal / Calculatrice), placée à LEUR GAUCHE. */
  function boot() {
    if (document.getElementById('widgets-btn')) return;                      // déjà posée
    var journal = document.getElementById('journal-btn');
    var center = journal && journal.parentNode;                              // .topbar-center
    if (!center) return;
    var icon = document.createElement('div');
    icon.id = 'widgets-btn';
    icon.className = 'topbar-icon topbar-icon--desk';                        // hérite du style topbar (dont --active or)
    icon.title = 'Mon Desk : mes widgets';
    icon.setAttribute('role', 'button');
    // Icône « tableau de bord / template » (panneaux composables) — dessin DTP original.
    // Marges internes ALIGNÉES sur Journal/Calc (glyphe x=4→20 dans le viewBox 24, comme eux) → écart
    // OPTIQUE égal entre les 3 icônes de la topbar (demande user 23/07 ; avant : x=3→21, glyphe plus large).
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24">'
      + '<rect x="4" y="4" width="7" height="7" rx="1.5" fill="currentColor" opacity=".2"/>'
      + '<rect x="4" y="4" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<rect x="13" y="4" width="7" height="4.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<rect x="13" y="10.5" width="7" height="9.5" rx="1.5" fill="currentColor" opacity=".2"/>'
      + '<rect x="13" y="10.5" width="7" height="9.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<rect x="4" y="13" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    // Badge « NOUVEAU » : pastille or coin haut-droit, pulse subtil ×3 puis statique. Affiché pendant les
    // 20 PREMIÈRES CONNEXIONS au desk de chaque compte (demande user 23/07) : le GET /api/widgets-new-seen
    // incrémente le compteur serveur à chaque chargement et répond seen=true au-delà de 20. Le clic ne
    // masque le badge que pour la SESSION en cours (aucun POST) — il revient tant que la fenêtre court.
    var badge = document.createElement('span');
    badge.className = 'topbar-new-badge wdg-new-badge';
    badge.textContent = 'NOUVEAU';
    badge.style.display = 'none';
    icon.appendChild(badge);
    fetch('/api/widgets-new-seen').then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.seen === false) { badge.style.display = ''; badge.classList.add('pulse'); }
    }).catch(function () {});
    // CYCLE (04/08, ANNULE le 28/07 — dernière consigne user : « ceci [Personnaliser] doit
    // s'afficher quand on clique sur l'icône widget, le bouton Personnaliser tu peux l'enlever ») :
    //  · hors Mon Desk → entrer ET ouvrir le panneau Personnaliser (choix du layout d'abord) ;
    //  · dans Mon Desk, panneau fermé → ouvrir le panneau ;
    //  · dans Mon Desk, panneau ouvert → le fermer et SORTIR (retour au fil — l'icône reste le
    //    seul aller-retour puisque la nav principale est masquée en mode Mon Desk).
    icon.addEventListener('click', function () {
      badge.style.display = 'none';                           // confort visuel : masqué pour cette session
      if (typeof activateView !== 'function') return;
      var dansDesk = document.body.classList.contains('wdg-mode');
      var mgr = document.getElementById('wdg-mgr');
      var panneauOuvert = mgr && mgr.classList.contains('open');
      // 05/08 : le clic ne FAIT PLUS SORTIR de Mon Desk — il en est l'écran d'arrivée et le desk
      // classique est masqué. L'icône devient un simple aller-retour vers le panneau Personnaliser.
      if (!dansDesk) { activateView('widgets'); API.openManager(); return; }
      if (!panneauOuvert) { API.openManager(); return; }
      API.closeManager();
    });
    center.insertBefore(icon, journal);                                      // à GAUCHE de Journal / Calculatrice
    // PRÉCHARGE la config (léger) → hasDefault() connu sans ouvrir Mon Desk (sert au clic sur le LOGO).
    if (!STATE.cfg) load().catch(function () {});
    // (L'écouteur posé ici sur `.logo-text` a été RETIRÉ le 06/08. Il n'agissait que si un layout ★
    //  existait, et l'`onclick` du parent — qui renvoyait au desk classique — s'exécutait de toute
    //  façon après lui par propagation : le logo ramenait donc toujours sur l'ancien desk. La
    //  décision vit désormais dans `API.logoAccueil`, appelée par l'`onclick` de index.html.)
    // Rechargement ADMIN sur Mon Desk : le boot restore de charts.js l'a neutralisé par sécurité
    // (dtp_active_view='widgets' → 'news', car _pdIsAdmin n'y était pas encore résolu). ICI, boot() ne
    // tourne QUE pour un admin (poll _pdIsAdmin) → on peut rouvrir. La garde d'activateView
    // (view==='widgets' && !_pdIsAdmin) laisse passer puisque _pdIsAdmin est désormais vrai.
    // ── MON DESK = ÉCRAN D'ARRIVÉE (05/08, décision user) ────────────────────────────────────────
    // Le desk classique n'est plus la vue de départ : on entre DIRECTEMENT dans le layout par
    // défaut. Portée volontairement limitée à l'ADMIN — boot() ne tourne que pour lui (poll
    // _pdIsAdmin), donc la garde anti-exposition posée dans charts.js reste entière pour les
    // clients, qui gardent le desk classique inchangé.
    // ⚠️ ISSUE DE SECOURS : `?desk=classique` dans l'URL saute l'ouverture. Sans bouton ni mention
    // dans l'interface — donc conforme au « masqué complètement » demandé — mais indispensable :
    // sans elle, un widget qui planterait au montage enfermerait l'admin hors de son propre desk.
    // ── DESK CLASSIQUE = ARCHIVÉ (05/08, décision user « archive-le ») ───────────────────────────
    // Il n'est plus une vue du produit côté ADMIN : aucun bouton, aucun menu, aucun chemin
    // d'arrivée n'y mène. Il n'est pas supprimé pour autant — `?desk=classique` reste le seul
    // moyen d'y entrer, et c'est délibéré : un widget qui planterait au montage enfermerait sinon
    // l'admin hors de son propre desk, sans autre issue qu'un déploiement.
    // À retenir pour la suite : ce code est CONSERVÉ, pas MAINTENU. Il sert encore aux clients
    // (portée limitée à l'admin, cf. la garde de charts.js) — c'est ce qui le garde vivant, pas
    // l'usage admin. Le jour où les clients basculeront aussi, il pourra vraiment partir.
    try {
      var secours = /(?:\?|&)desk=classique(?:&|$)/.test(location.search);
      if (!secours && typeof activateView === 'function') activateView('widgets');
    } catch (e) {}
  }
  // Le flag arrive dans le .then() de /api/auth/me → on sonde jusqu'à ~10 s, puis on renonce (aucun onglet).
  var tries = 0;
  var iv = setInterval(function () {
    if (window._pdMonDesk) { clearInterval(iv); boot(); }
    else if (++tries > 20) clearInterval(iv);
  }, 500);
})();

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
    if (d.type === 'bascule') return !!v;
    if (d.type === 'nombre') { v = parseInt(v, 10); return isFinite(v) ? _clamp(v, d.min, d.max) : d.def; }
    // 'choix' : une valeur devenue invalide (option retirée du catalogue) retombe sur le défaut
    for (var i = 0; i < d.choix.length; i++) if (d.choix[i][0] === v) return v;
    return d.def;
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
      onglets = '<div class="wdg-set-sep"></div><div class="wdg-set-tabs-t">Onglets · renommer ou retirer</div>'
        + tl.map(function (id2, j) {
            // Onglet VIDE (sentinel 'vide') : il apparaît AUSSI ici — renommable, retirable.
            var estVide = (id2 === 'vide');
            var w2 = byId(id2); if (!w2 && !estVide) return '';
            var nomW = estVide ? 'Onglet vide — aucun widget' : w2.name;
            var defLbl = estVide ? 'Vide' : (w2.tag || w2.name);
            return '<div class="wdg-set-row wdg-set-tabrow">'
              + '<div class="wdg-set-tabcol">'
              +   '<input class="wdg-set-tabin" maxlength="18" value="' + esc(lb[j] || defLbl) + '"'
              +   ' autocomplete="off" name="dtp-nom-onglet" data-lpignore="true" data-1p-ignore data-bwignore data-protonpass-ignore="true" data-form-type="other"'
              +   ' placeholder="' + esc(defLbl) + '" title="' + esc(nomW) + '"'
              +   ' onchange="DTPWidgets.renameTab(' + idx + ',' + j + ', this.value)"'
              // Échap = ANNULER (miroir de l'éditeur inline .wdgt-edit) : valeur d'origine restaurée
              // AVANT le blur → aucun change n'est émis ; stopPropagation → le listener document
              // (Échap ferme les volets) ne claque pas le panneau au nez de l'utilisateur.
              +   ' onkeydown="if(event.key===\'Enter\')this.blur();else if(event.key===\'Escape\'){event.stopPropagation();this.value=this.defaultValue;this.blur();}">'
              // Le NOM DU WIDGET sous le libellé (demande user 03/08) : on voit CE QUE le × emporte.
              +   '<span class="wdg-set-tabnom">' + esc(nomW) + '</span>'
              + '</div>'
              // PLANCHER 1 ONGLET (demande user 03/08 « on ne doit pas pouvoir supprimer tous les
              // onglets ») : sur la dernière ligne restante, pas de × — un panneau à onglets vide
              // n'a aucun sens (et retirer le WIDGET entier se fait depuis l'en-tête de la carte).
              + (tl.length > 1
                  ? '<button class="wdg-set-tabdel" title="' + (estVide ? 'Retirer cet onglet vide' : 'Retirer l\'onglet et son widget « ' + esc(w2.name) + ' »') + '" onclick="DTPWidgets.removeTab(' + idx + ',' + j + ')">×</button>'
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
    var sousReglages = '';
    if (w.id === 'onglets') {
      var _tj = Math.min(it._tabAct | 0, Math.max(0, (it.tabs || []).length - 1));
      var _tw = byId((it.tabs || [])[_tj]);
      if (_tw && _tw.opts && _tw.opts.length) {
        sousReglages = '<div class="wdg-set-sep"></div>'
          + '<div class="wdg-set-tabs-t">Onglet affiché · ' + esc(_tw.name) + '</div>'
          + _optsHtml(idx, _tw, _tabItem(it, _tj), 'setTabOpt');
      }
    }
    return '<div class="wdg-pop-t">' + esc(w.name) + '</div><div class="wdg-pop-d">' + esc(w.desc) + '</div>'
      + _optsHtml(idx, w, it)
      + sousReglages
      + onglets
      + actions;
  }
  // Rafraîchit le panneau d'une carte SANS toucher au reste (garde son état ouvert/fermé).
  function _syncPanel(i) {
    var l = activeLayout(); if (!l || !l.items[i]) return;
    var pop = document.getElementById(HOST_ID + '-s' + i), w = byId(l.items[i].w);
    if (pop && w) pop.innerHTML = _setPanelHtml(i, w, l.items[i]);
  }
  // `setter` (04/08) : « setOpt » par défaut (réglages de la CARTE) — « setTabOpt » pour les
  // réglages du SOUS-WIDGET affiché dans un panneau à onglets, qui a désormais les siens.
  function _optsHtml(idx, w, it, setter) {
    var l = (w && w.opts) || []; if (!l.length) return '';
    var S = setter || 'setOpt', B = (S === 'setTabOpt') ? 'bumpTabOpt' : 'bumpOpt';
    return '<div class="wdg-set-sep"></div>' + l.map(function (o) {
      var cur = opt(it, w, o.k), ctl;
      if (o.type === 'bascule') {
        ctl = '<button class="wdg-set-sw' + (cur ? ' on' : '') + '" role="switch" aria-checked="' + (!!cur) + '"'
          + ' onclick="DTPWidgets.' + S + '(' + idx + ',\'' + o.k + '\',' + (!cur) + ')"><i></i></button>';
      } else if (o.type === 'nombre') {
        ctl = '<span class="wdg-stepper"><button class="wdg-step" onclick="DTPWidgets.' + B + '(' + idx + ',\'' + o.k + '\',-1)" aria-label="moins">−</button>'
          + '<span class="wdg-step-val">' + esc(String(cur)) + '</span>'
          + '<button class="wdg-step" onclick="DTPWidgets.' + B + '(' + idx + ',\'' + o.k + '\',1)" aria-label="plus">+</button></span>';
      } else {
        ctl = '<span class="wdg-set-chips">' + o.choix.map(function (c) {
          return '<button class="wdg-set-chip' + (c[0] === cur ? ' on' : '') + '"'
            + ' onclick="DTPWidgets.' + S + '(' + idx + ',\'' + o.k + '\',\'' + esc(String(c[0])) + '\')">' + esc(c[1]) + '</button>';
        }).join('') + '</span>';
      }
      return '<div class="wdg-set-row"><span class="wdg-set-lbl">' + esc(o.lbl) + '</span>' + ctl + '</div>';
    }).join('');
  }
  // Config PROPRE à un onglet (index) d'un panneau à onglets — stockée dans it.tabCfg (whitelistée
  // serveur). Renvoie un pseudo-item {w, cfg} : le sous-widget lit ses réglages par opt() comme
  // n'importe quelle carte, sans savoir qu'il vit dans un onglet.
  function _tabItem(it, j) {
    var id = (Array.isArray(it.tabs) ? it.tabs[j] : null) || '';
    var cfg = (it.tabCfg && it.tabCfg[j]) || undefined;
    return { w: id, cfg: cfg };
  }
  /* ── MENU MAISON des <select> de widgets (.dmx-sort-select — tri DMX, paire Saisonnalité) : le
     popup NATIF se place mal sous le zoom d'affichage (coordonnées non compensées par Chromium) et
     la charte DTP proscrit les composants natifs. On intercepte l'ouverture et on affiche une liste
     ancrée DANS LA CARTE — même espace de coordonnées que le contrôle, donc zoom-sûr par
     construction. La sélection ré-émet un vrai `change` : les écouteurs existants ne bougent pas. */
  document.addEventListener('mousedown', function (e) {
    var dejaOuvert = document.querySelector('.wdg-ddm');
    var sel = e.target.closest && e.target.closest('select.dmx-sort-select');
    if (!sel) { if (dejaOuvert && !(e.target.closest && e.target.closest('.wdg-ddm'))) dejaOuvert.remove(); return; }
    e.preventDefault();
    if (dejaOuvert) { dejaOuvert.remove(); return; }
    var carte = sel.closest('.wdg-card') || sel.closest('.home-zone') || sel.parentNode;
    if (!carte) return;
    var menu = document.createElement('div');
    menu.className = 'wdg-ddm';
    menu.innerHTML = Array.prototype.map.call(sel.options, function (o) {
      return '<button type="button" class="wdg-ddm-it' + (o.selected ? ' on' : '') + '" data-v="' + esc(o.value) + '">'
        + '<span>' + esc(o.textContent) + '</span>' + (o.selected ? '<span class="wdg-ddm-ck">✓</span>' : '') + '</button>';
    }).join('');
    if (getComputedStyle(carte).position === 'static') carte.style.position = 'relative';
    // Coordonnées locales : différence de rects VISUELS ÷ zoom (les offsets absolus sont re-multipliés
    // par le zoom au rendu — même piège que le menu des recherches récentes).
    var z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dtp-zoom')) || 1;
    var rs = sel.getBoundingClientRect(), rc = carte.getBoundingClientRect();
    menu.style.top = Math.round((rs.bottom - rc.top) / z + 4) + 'px';
    menu.style.right = Math.round(Math.max(4, (rc.right - rs.right) / z)) + 'px';
    carte.appendChild(menu);
    menu.addEventListener('mousedown', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var it = ev.target.closest('.wdg-ddm-it'); if (!it) return;
      sel.value = it.getAttribute('data-v');
      try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
      menu.remove();
    });
  }, true);
  window.addEventListener('scroll', function () { var m = document.querySelector('.wdg-ddm'); if (m) m.remove(); }, true);

  var _resetArm = null;              // remise à zéro : 1er clic arme, 2e clic exécute (retombe seul)
  var _swapBack = null;                      // dernier remplacement, pour l'annulation
  var _delConfirm = null;                 // id du layout en attente de confirmation de suppression (inline, pas de dialog natif)
  // Icônes d'en-tête — dessins DTP ORIGINAUX (organisation façon desk pro : info + réglages regroupés) :
  // info = « i » cerclé ; réglages = curseurs d'ajustement.
  var ICO = {
    info: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.7" r="0.7" fill="currentColor" stroke="none"/></svg>',
    // RÉGLAGES = trois curseurs HORIZONTAUX. Les pastilles sont OUVERTES : elles étaient remplies de
    // #0d0e11 en dur (la couleur du fond sombre) et devenaient deux taches noires en thème clair.
    gear: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h4M12 7h8M4 12h10M18 12h2M4 17h6M14 17h6"/><circle cx="10" cy="7" r="1.9"/><circle cx="16" cy="12" r="1.9"/><circle cx="12" cy="17" r="1.9"/></svg>',
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
  function uid() { return 'w' + Math.random().toString(36).slice(2, 9); }
  // ── ÉTATS UNIFORMES DES WIDGETS (28/07) : chargement · vide · erreur ────────────────────────────
  // Une seule grammaire pour les ~30 points de repli du catalogue : icône discrète, message court,
  // et pour l'ERREUR un bouton « Réessayer » qui relance CE widget (l'index se lit sur l'id du
  // conteneur « <host>-b<idx> » → aucun appel à modifier dans les widgets existants).
  var _ICO_ERR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>';
  var _ICO_EMPTY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8.5 4.5v15"/></svg>';
  function _hostIdx(host) { var m = String((host && host.id) || '').match(/-b(\d+)$/); return m ? +m[1] : null; }
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
    { k: 'risk', label: 'Risque %', type: 'num', w: 80, suffix: ' %' }, { k: 'r', label: 'R PNL', type: 'num', w: 80, signed: true },
    { k: 'pnlPct', label: '% PNL', type: 'num', w: 82, suffix: ' %', signed: true }, { k: 'pl', label: '$PNL', type: 'money', w: 106, signed: true },
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
  function _wjrFmtDateFr(ts) { try { var d = new Date(ts); return d.getDate() + ' ' + _WJR_MONTHS[d.getMonth()] + ' ' + d.getFullYear(); } catch (e) { return '—'; } }
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
      case 'title': return '<span class="jr-cv-title">' + (e.pair ? esc(e.pair) : '<i class="jr-ph">—</i>') + '</span>'
        + '<button class="jrd-open" data-open="' + esc(e.id || '') + '" title="Ouvrir / modifier ce trade"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5l-5.5 5.5M6.5 13.5h-4v-4M2.5 13.5l5.5-5.5"/></svg><span>OUVRIR</span></button>';
      case 'text': return (v == null || v === '') ? '<i class="jr-ph">—</i>' : '<span class="jr-cv-text">' + esc(v) + '</span>';
      case 'date': { var ts = col.builtin ? e.ts : v; return ts ? '<span class="jr-cv-date">' + _wjrFmtDateFr(ts) + '</span>' : '<i class="jr-ph">—</i>'; }
      case 'day': { var d = e.ts ? _wjrDayEn(e.ts) : ''; return d ? _wjrChipHtml(d, _WJR_CHIPS[8]) : '<i class="jr-ph">—</i>'; }
      case 'select': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; return _wjrChipHtml((col.disp && col.disp[v]) || v, _wjrChip(col.k, v)); }
      case 'multi': { var arr = Array.isArray(v) ? v : (v ? [v] : []); return arr.length ? arr.map(function (x) { return _wjrChipHtml(x, _wjrChip(col.k, x)); }).join('') : '<i class="jr-ph">—</i>'; }
      case 'num': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; var n = Number(v), cls = col.signed ? (n > 0 ? 'jr-pos' : n < 0 ? 'jr-neg' : '') : ''; return '<span class="jr-cv-num ' + cls + '">' + _wjrFmtNum(v, col.signed) + (col.suffix || '') + '</span>'; }
      case 'money': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; var n2 = Number(v), cls2 = col.signed ? (n2 > 0 ? 'jr-pos' : n2 < 0 ? 'jr-neg' : '') : ''; return '<span class="jr-cv-num ' + cls2 + '">' + (col.signed && n2 > 0 ? '+' : '') + n2.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' $</span>'; }
      case 'progress': { if (v == null || v === '') return '<i class="jr-ph">—</i>'; var pct = Math.max(0, Math.min(100, Number(v) / (col.max || 100) * 100)), bc = pct >= 87.5 ? '#00e676' : pct >= 62.5 ? '#ffb300' : '#e3b23a'; return '<div class="jr-prog"><div class="jr-prog-t"><i style="width:' + pct + '%;background:' + bc + '"></i></div><span class="jr-prog-l">' + _wjrFmtNum(v) + ' %</span></div>'; }
      case 'ring': return (v == null || v === '') ? '<i class="jr-ph">—</i>' : _wjrRingHtml(Number(v), col.max || 5);
    }
    return '';
  }

  /* ── CATALOGUE ─────────────────────────────────────────────────────────────────────────────────
     mount(host) reçoit un conteneur VIDE et VISIBLE ; il renvoie sa fonction de nettoyage.
     RÈGLE : un widget ne doit JAMAIS écrire un id DOM en dur — il peut vivre en 2 exemplaires. */
  var CATALOG = [
    {
      id: 'force-devises', name: 'Force des Devises', tag: 'FORCE', cat: 'Devises', h: 300,
      desc: 'Qui mène, qui décroche — un panneau, la période de ton choix.',
      // UN SEUL panneau (demande user 01/08). Le double TD | TW venait de l'onglet › FORCE du desk,
      // qui a la largeur pour ça ; dans une carte de tableau de bord il donnait deux demi-graphes
      // illisibles. La barre de périodes reprend celle du desk (mêmes libellés, mêmes classes
      // `.stf-btn`) et le choix est PERSISTÉ : le widget est sa propre source de réglage.
      opts: [
        { k: 'periodes', lbl: 'Période', type: 'choix', def: 'today',
          choix: [['today', 'TD · séance'], ['week', 'TW · semaine'], ['8h', '8 heures'], ['1d', '1 jour'], ['7d', '7 jours'], ['1m', '1 mois']] },
        { k: 'focus', lbl: 'Devise', type: 'choix', def: '',
          choix: [['', 'Toutes'], ['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['JPY', 'JPY'], ['CHF', 'CHF'], ['CAD', 'CAD'], ['AUD', 'AUD'], ['NZD', 'NZD']] },
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
          try { buildIsolatedStrength(id, foc, p); } catch (e) { fallback(host, 'Force des Devises indisponible.'); }
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
            var _i = _hostIdx(host); if (_i != null) API.setOptQuiet(_i, 'periodes', btn.dataset.per);
          });
        });
        return function () { try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {} };
      },
    },
    {
      id: 'barometre', name: 'Baromètre des Devises', tag: 'BAROMÈTRE', cat: 'Devises', h: 300,
      desc: 'La force des 8 majeures en égaliseur bidirectionnel (le vrai baromètre du desk).',
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
      id: 'risque-historique', name: 'Historique du Sentiment', cat: 'Risque', h: 260,
      desc: "L'appétit pour le risque des dernières semaines.",
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
      id: 'calendrier-jour', name: 'Calendrier économique', cat: 'Macro', h: 300,
      desc: 'Les prochaines publications, heure de Paris.',
      // IDENTIQUE AU DESK : on reproduit la table du calendrier du desk (renderCalTable, charts.js:2995)
      // — mêmes classes `cal-table`/`cth-*`, séparateurs de jour, 10 colonnes, états de ligne — et on
      // appelle SES helpers globaux (calFormatTime, CAL_FLAG, calImpDots, calActualCell). Le widget
      // hérite ainsi du style exact du desk. Lecture seule (le déroulé inline reste dans l'onglet dédié).
      opts: [
        { k: 'impact', lbl: 'Impact', type: 'choix', def: 'all',
          choix: [['all', 'Tous'], ['med', 'Moyen +'], ['high', 'Fort']] },
        { k: 'lignes', lbl: 'Lignes', type: 'nombre', def: 40, min: 5, max: 80, pas: 5 },
        { k: 'passe', lbl: 'Passé', type: 'choix', def: '2',
          choix: [['0', 'Aucun'], ['2', '2 h'], ['6', '6 h'], ['12', '12 h'], ['24', '24 h']] },
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
            + '<span class="cal-live-badge"><span class="cal-live-dot"></span>DIRECT</span>'
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
          var evs = _tous
            .filter(function (e) { return impOk(e) && (!q || String(e.title || '').toLowerCase().indexOf(q) !== -1 || String(e.currency || '').toLowerCase().indexOf(q) !== -1); })
            .slice(0, opt(it, W, 'lignes'));
          if (!evs.length) {
            host.innerHTML = '<div class="wdg-cal-panel">' + barre() + '<div class="wdg-cal-wrap"><div class="wdg-empty">Aucun événement ne correspond.</div></div></div>';
            return cabler();
          }
          var nextIdx = evs.findIndex(function (e) { return (e.timestamp || 0) >= now; });
          var fmtTime = (typeof calFormatTime === 'function') ? calFormatTime : function () { return ''; };
          var flag = (typeof CAL_FLAG === 'function') ? CAL_FLAG : function () { return ''; };
          var dots = (typeof calImpDots === 'function') ? calImpDots : function () { return ''; };
          var actCell = (typeof calActualCell === 'function') ? calActualCell : function () { return ''; };
          var vspan = function (raw, cls) { return raw && raw !== '' ? '<span class="' + cls + '">' + esc(raw) + '</span>' : '<span class="cv-empty">—</span>'; };
          var tbody = '', lastDay = '';
          evs.forEach(function (ev, i) {
            var dayKey = ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('en-GB') : '';
            if (dayKey && dayKey !== lastDay) {
              var d = new Date(ev.timestamp);
              var wd = d.toLocaleDateString('fr-FR', { weekday: 'long' });
              var ds = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
              tbody += '<tr class="cal-day-sep"><td colspan="10">' + esc(wd) + ', ' + ds + '</td></tr>';
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
            tbody += '<tr class="' + cls + ' cal-row--click" data-idx="' + i + '">'
              + '<td class="cth-time"><span class="cal-chv">›</span> ' + (esc(fmtTime(ev.timestamp)) || esc(ev.time) || '—') + '</td>'
              + '<td class="cth-flag">' + flag(ev.currency) + '</td>'
              + '<td class="cth-curr">' + esc(ev.currency || '') + '</td>'
              + '<td class="cth-imp">' + dots(ev.impact) + '</td>'
              + '<td class="cth-event">' + esc(ev.title || '') + keyChip + '</td>'
              + '<td class="cth-val">' + actCell(ev.actual, ev.forecast, ev.low, ev.title) + '</td>'
              + '<td class="cth-val">' + vspan(ev.high, 'cv-forecast') + '</td>'
              + '<td class="cth-val">' + vspan(ev.forecast, 'cv-forecast') + '</td>'
              + '<td class="cth-val">' + vspan(ev.low, 'cv-prev') + '</td>'
              + '<td class="cth-val">' + vspan(ev.previous, 'cv-prev') + '</td></tr>';
          });
          host.innerHTML = '<div class="wdg-cal-panel">' + barre()
            + '<div class="wdg-cal-wrap custom-scrollbar"><table class="cal-table">'
            + '<thead><tr><th class="cth-time">Heure</th><th class="cth-flag">CNTRY</th><th class="cth-curr">CURR.</th>'
            + '<th class="cth-imp">IMPACT</th><th class="cth-event">ÉVÉNEMENT</th><th class="cth-val">RÉEL</th>'
            + '<th class="cth-val">HIGH</th><th class="cth-val">PRÉVISION</th><th class="cth-val">LOW</th>'
            + '<th class="cth-val">PRÉCÉDENT</th></tr></thead><tbody>' + tbody + '</tbody></table></div></div>';
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
          cabler();
        };
        // Recâblé à chaque rendu : le HTML de la barre est réécrit avec la table (un seul innerHTML,
        // donc un seul reflow). La saisie garde le focus et le curseur — sinon on ne pourrait pas
        // taper deux lettres de suite dans la recherche.
        var cabler = function () {
          host.querySelectorAll('.wdg-cal-bar .cal-imp-btn').forEach(function (b) {
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
        };
        fetch('/api/calendar-events').then(function (r) { return r.json(); }).then(function (j) {
          if (!host.isConnected) return;
          var now = Date.now(), gardePasse = parseInt(opt(it, W, 'passe'), 10) || 0;
          _tous = ((j && j.items) || [])
            .filter(function (e) { return e && (e.timestamp || 0) > now - gardePasse * 3600e3; })
            .sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
          if (!_tous.length) return fallback(host, 'Aucun événement à venir.');
          dessine();
        }).catch(function () { fallback(host, 'Calendrier indisponible.'); });
        return null;
      },
    },
    {
      id: 'radar-biais', name: 'Radar de Biais', cat: 'Macro', h: 320,
      desc: 'Le biais net de chaque devise, du plus haussier au plus baissier.',
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
      id: 'taux-cb', name: 'Taux directeurs', cat: 'Macro', h: 320,
      desc: 'Où en sont les banques centrales : taux actuel + prochaine décision anticipée.',
      // AUTONOME : lit /api/rates (probabilités marché). Rend une carte par banque : taux actuel, scénario de base
      // (Maintien/Hausse/Baisse) de la prochaine réunion + probabilité + date. HTML pur, cleanup null.
      mount: function (host) {
        skel(host);
        var MV = { Hike: { c: 'up', t: 'Hausse' }, Cut: { c: 'down', t: 'Baisse' }, Hold: { c: 'flat', t: 'Maintien' } };
        var flag = (typeof CAL_FLAG === 'function') ? CAL_FLAG : function () { return ''; };
        var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
        var fmtD = function (iso) { try { var p = String(iso).split('-'); return parseInt(p[2], 10) + ' ' + MOIS[parseInt(p[1], 10) - 1]; } catch (e) { return esc(iso); } };
        fetch('/api/rates').then(function (r) { return r.json(); }).then(function (d) {
          if (!host.isConnected) return;
          var banks = (d && d.banks) || [];
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
              + '<span class="wdg-taux-rate">' + (b.rate != null ? esc(String(b.rate).replace('.', ',')) + ' %' : '—') + '</span>'
              + '<span class="wdg-taux-move wdg-taux-' + mv.c + '">' + mv.t + (prob != null ? ' ' + prob + ' %' : '') + '</span>'
              + '<span class="wdg-taux-when">' + when + '</span></div>';
          }).join('');
          host.innerHTML = '<div class="wdg-taux custom-scrollbar">'
            + '<div class="wdg-taux-head"><span>Banque</span><span>Taux</span><span>Prochaine décision</span><span class="r">Réunion</span></div>'
            + rows + '</div>';
        }).catch(function () { fallback(host, 'Taux indisponibles.'); });
        return null;
      },
    },
    {
      id: 'risque-jauge', name: 'Sentiment de Risque', tag: 'RISQUE', cat: 'Risque', h: 300,
      desc: "L'appétit / l'aversion du marché en direct (risk-on / risk-off).",
      // IDENTIQUE AU DESK (23/07) : réplique instance-scopée de buildRiskGauge (charts.js) — mêmes classes
      // (.risk-ticker / .risk-gauge-stage / .risk-readout), même arc am5radar (dégradé 7 stops), même
      // triangle ClockHand teinté _riskArcColor, mêmes helpers globaux (_riskBandInner, GAUGE_LABEL_FR).
      // Root amCharts PAR INSTANCE (le singleton _riskGaugeRoot reste au desk) + suit le snapshot partagé
      // dtp-risk (source unique app.js) → toujours la même valeur que la jauge de l'onglet RISQUE.
      mount: function (host) {
        if (!(window.am5 && window.am5radar) || typeof _riskArcColor !== 'function' || typeof _riskBandInner !== 'function' || typeof GAUGE_LABEL_FR === 'undefined') { fallback(host, 'Jauge indisponible.'); return null; }
        // COMME L'ONGLET RISQUE DU DESK (demande user 03/08 « il manque l'historique en bas ») :
        // la jauge PLUS la bande d'historique quotidien (#risk-history-chart, classes .rsh-chart du
        // desk, builder buildRiskHistoryChart) — la jauge seule laissait un vide sous l'arc.
        var hid = HOST_ID + '-rj-h-' + uid();
        host.innerHTML = '<div class="wdg-riskpanel"><div class="risk-widget-container wdg-riskwrap"></div>'
          + '<div class="amchart-container rsh-chart wdg-riskhist"><div id="' + hid + '" style="width:100%;height:100%"></div></div></div>';
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
              root = am5.Root.new(wrap.querySelector('.wdg-riskgauge'));
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
      id: 'cot-inst', name: 'Positionnement COT', tag: 'COT', cat: 'Risque', h: 340,
      desc: 'Le positionnement net des institutionnels (CFTC), par devise.',
      // IDENTIQUE AU DESK (23/07) : réutilise buildCOTChart(gridId, type) de charts.js (rendu rétrocompatible)
      // → mêmes cartes donut SVG .cot-cell, mêmes 5 catégories CFTC (barre .cot-type-bar reproduite, handlers
      // SCOPÉS au widget — ceux du desk sont scopés #rtab-cot). Zéro root amCharts → cleanup null.
      opts: [{ k: 'cat', lbl: 'Catégorie', type: 'choix', def: 'lev_money',
        choix: [['noncomm', 'Non-comm.'], ['dealer', 'Teneur'], ['asset_mgr', 'Gérant'], ['lev_money', 'Levier'], ['other_rept', 'Autre']] }],
      mount: function (host, it) {
        var W = this;
        if (typeof buildCOTChart !== 'function') { fallback(host, 'COT indisponible.'); return null; }
        var cat0 = opt(it, W, 'cat');
        var gid = HOST_ID + '-cotg-' + uid();
        var TYPES = [['noncomm', 'Non-comm.'], ['dealer', 'Teneur'], ['asset_mgr', 'Gérant'], ['lev_money', 'Effet de levier'], ['other_rept', 'Autre']];
        host.innerHTML = '<div class="wdg-cotwrap">'
          + '<div class="cot-type-bar">' + TYPES.map(function (t) {
              return '<button class="cot-type-btn' + (t[0] === cat0 ? ' cot-type-btn--active' : '') + '" data-cot-type="' + t[0] + '">' + t[1] + '</button>';
            }).join('') + '</div>'
          + '<div id="' + gid + '" class="cot-grid custom-scrollbar"></div></div>';
        try { buildCOTChart(gid, cat0); } catch (e) { fallback(host, 'COT indisponible.'); return null; }
        host.querySelectorAll('.cot-type-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            host.querySelectorAll('.cot-type-btn').forEach(function (b) { b.classList.remove('cot-type-btn--active'); });
            btn.classList.add('cot-type-btn--active');
            try { buildCOTChart(gid, btn.dataset.cotType); } catch (e) {}
            var _i = _hostIdx(host); if (_i != null) API.setOptQuiet(_i, 'cat', btn.dataset.cotType);   // le widget devient sa propre source de réglage
          });
        });
        return null;
      },
    },
    {
      id: 'dmx-retail', name: 'Aperçu DMX', tag: 'DMX', cat: 'Risque', h: 340,
      desc: 'Le positionnement long/short de la foule (contrarian), par paire.',
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
        host.innerHTML = '<div class="wdg-dmxwrap">'
          + '<div class="dmx-header-bar">'
          + '<div class="dmx-tf-group">' + [['D1', '1D'], ['H4', '4H'], ['H1', '1H']].map(function (t) {
              return '<button class="dmx-tf-btn' + (t[0] === tf0 ? ' dmx-tf-btn--active' : '') + '" data-tf="' + t[0] + '">' + t[1] + '</button>';
            }).join('') + '</div>'
          + '<span style="flex:1"></span>'
          + '<select class="dmx-sort-select" title="Ordre de tri">' + [['az', 'Paire A→Z'], ['za', 'Paire Z→A'], ['long_asc', 'Long % ↑'], ['long', 'Long % ↓'], ['short_asc', 'Short % ↑'], ['short', 'Short % ↓']].map(function (o) {
              return '<option value="' + o[0] + '"' + (o[0] === tri0 ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('') + '</select>'
          + '</div>'
          + '<div class="dmx-legend-bar"><span class="dmx-legend-dot dmx-legend-long-dot"></span><span class="dmx-legend-text">Long</span><span class="dmx-legend-dot dmx-legend-short-dot"></span><span class="dmx-legend-text">Short</span></div>'
          + '<div id="' + wid + '" class="dmx-table-wrap custom-scrollbar"></div></div>';
        function optsNow() {
          var tf = host.querySelector('.dmx-tf-btn--active');
          var sel = host.querySelector('.dmx-sort-select');
          return { wrapId: wid, period: tf ? tf.dataset.tf : tf0, sort: sel ? sel.value : tri0 };
        }
        function refresh(force) { try { buildDMXChart(!!force, optsNow()); } catch (e) {} }
        refresh(false);
        host.querySelectorAll('.dmx-tf-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            host.querySelectorAll('.dmx-tf-btn').forEach(function (b) { b.classList.remove('dmx-tf-btn--active'); });
            btn.classList.add('dmx-tf-btn--active');
            refresh(true);
            var _i = _hostIdx(host); if (_i != null) API.setOptQuiet(_i, 'tf', btn.dataset.tf);
          });
        });
        var sel = host.querySelector('.dmx-sort-select');
        if (sel) sel.addEventListener('change', function () {
          refresh(false);
          var _i = _hostIdx(host); if (_i != null) API.setOptQuiet(_i, 'tri', sel.value);
        });
        var iv = setInterval(function () { if (!host.isConnected) { clearInterval(iv); return; } refresh(false); }, 60000);
        return function () { clearInterval(iv); };
      },
    },
    {
      id: 'saison', name: 'Saisonnalité', tag: 'SAISONNALITÉ', cat: 'Macro', h: 300,
      desc: "La table de performance mensuelle par année (rendements × 5 ans).",
      // IDENTIQUE AU DESK (23/07) : même table heatmap .season-table (cellules rendues par le MÊME
      // _seasonCell global de charts.js — vert/rouge ∝ |valeur|, flèches, colonne Moy.), même badge
      // [PAIRE] ; paire du COMPTE (/api/season-pair, GET au montage + POST au changement, comme le desk).
      // « Paire » ÉPINGLE la carte. Défaut 'Compte' = comportement d'origine (la paire suit le compte et
      // la changer ici l'écrit pour tout le monde). Épinglée, la carte devient AUTONOME : changer sa paire
      // n'écrit plus côté compte — sans quoi deux cartes Saisonnalité côte à côte s'écrasent l'une l'autre.
      opts: [{ k: 'paire', lbl: 'Paire', type: 'choix', def: '',
        choix: [['', 'Compte'], ['EURUSD', 'EUR/USD'], ['GBPUSD', 'GBP/USD'], ['USDJPY', 'USD/JPY'], ['AUDUSD', 'AUD/USD'], ['USDCAD', 'USD/CAD'], ['USDCHF', 'USD/CHF'], ['NZDUSD', 'NZD/USD'], ['EURJPY', 'EUR/JPY'], ['GBPJPY', 'GBP/JPY']] }],
      mount: function (host, it) {
        var W = this, pin = opt(it, W, 'paire');
        if (typeof _seasonCell !== 'function') { fallback(host, 'Saisonnalité indisponible.'); return null; }
        var fmt = (typeof _seasonFmtPair === 'function') ? _seasonFmtPair : function (c) { return c; };
        var pairs = (typeof _SEASON_PAIRS !== 'undefined') ? _SEASON_PAIRS.slice() : ['EURUSD'];
        host.innerHTML = '<div class="wdg-seawrap">'
          + '<div class="dmx-header-bar"><span class="season-pair-badge wdg-sea-badge">[EUR/USD]</span><span style="flex:1"></span>'
          + '<select class="dmx-sort-select wdg-sea-sel">' + pairs.sort(function (a, b) { return fmt(a).localeCompare(fmt(b), 'fr', { numeric: true, sensitivity: 'base' }); }).map(function (p) { return '<option value="' + esc(p) + '">' + esc(fmt(p)) + '</option>'; }).join('') + '</select></div>'
          + '<div class="season-table-wrap custom-scrollbar wdg-sea-tbl"><div class="wdg-skel"><span class="wdg-skel-l" style="width:72%"></span><span class="wdg-skel-l" style="width:88%"></span><span class="wdg-skel-l" style="width:60%"></span></div></div>';
        var sel = host.querySelector('.wdg-sea-sel'), badge = host.querySelector('.wdg-sea-badge'), tblWrap = host.querySelector('.wdg-sea-tbl');
        var cur = null;
        function load(p) {
          cur = p;
          if (sel && !sel.querySelector('option[value="' + p.replace(/"/g, '') + '"]')) {   // paire du compte hors liste FX (catalogue Stocks/Indices…)
            var op = document.createElement('option'); op.value = p; op.textContent = fmt(p); sel.insertBefore(op, sel.firstChild);
          }
          if (sel) sel.value = p;
          if (badge) badge.textContent = '[' + fmt(p) + ']';
          fetch('/api/seasonality?symbol=' + encodeURIComponent(p)).then(function (r) { return r.json(); }).then(function (data) {
            if (!host.isConnected || p !== cur) return;                    // réponse périmée (changement de paire)
            if (!data || !Array.isArray(data.rows) || !data.rows.length) return fallback(tblWrap, 'Aucune donnée');
            if (badge && data.symbol) badge.textContent = '[' + data.symbol + ']';
            var yrs = data.years || [];
            var head = '<tr><th class="season-th season-th--m"></th>' + yrs.map(function (y) { return '<th class="season-th">\'' + String(y).slice(2) + '</th>'; }).join('') + '<th class="season-th season-th--avg">Moy.</th></tr>';
            var body = data.rows.map(function (row) {
              return '<tr><td class="season-month">' + esc(row.month) + '</td>' + (row.vals || []).map(function (v) { return _seasonCell(v, false); }).join('') + _seasonCell(row.avg, true) + '</tr>';
            }).join('');
            tblWrap.innerHTML = '<table class="season-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
          }).catch(function () { if (host.isConnected && p === cur) fallback(tblWrap, 'Saisonnalité indisponible.'); });
        }
        if (pin) load(pin);
        else fetch('/api/season-pair').then(function (r) { return r.json(); }).then(function (d) {
          load((d && d.pair) ? d.pair : 'EURUSD');
        }).catch(function () { load('EURUSD'); });
        if (sel) sel.addEventListener('change', function () {
          var p = sel.value;
          if (pin) {                                    // carte épinglée : le choix reste DANS la carte
            var i = _hostIdx(host);
            if (i != null) return API.setOpt(i, 'paire', p);
            return load(p);
          }
          try { fetch('/api/season-pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pair: p }) }); } catch (e) {}
          load(p);
        });
        return null;
      },
    },
    {
      id: 'sessions', name: 'Sessions de marché', tag: 'MONDE', cat: 'Macro', h: 340,
      desc: 'La carte du monde des 4 grandes sessions FX, en direct.',
      // IDENTIQUE AU DESK (23/07) : réplique instance-scopée de la VRAIE carte Leaflet de l'onglet MONDE
      // (sessionmap.js) — continents GeoJSON on-brand (geodata amCharts partagé), terminateur jour/nuit,
      // badges villes .lf-city (classes globales → rendu identique), halos de session, résumé d'en-tête.
      // Instance Leaflet DÉDIÉE (window._dtpLfMap reste au desk) + timers locaux → cleanup complet.
      opts: [{ k: 'nuit', lbl: 'Ombre nuit', type: 'bascule', def: true }],
      mount: function (host, it) {
        var W = this;
        if (typeof L === 'undefined') { fallback(host, 'Carte indisponible.'); return null; }
        host.innerHTML = '<div class="wdg-mapwrap"><div class="chart-header-sub wdg-map-sub"></div><div class="wdg-lfmap"></div></div>';
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
      desc: 'Les 5 grandes places (Londres, New York, Tokyo, Dubaï, Paris) à l’heure, statut d’ouverture + météo.',
      // IDENTIQUE AU DESK : réutilise le VRAI renderClocks() (app.js) — mêmes .clock-item (heure live, GMT,
      // ouvert/fermé, icône jour/nuit, météo temps réel du _weatherCache alimenté par le loop global
      // startClocks()). renderClocks(barEl) accepte désormais une cible optionnelle → on lui passe la barre
      // du widget + un tick 1 s local ; le desk garde son propre #clocks-bar intact. Layout flex-wrap
      // (.wdg-clocks-bar) → remplit n'importe quelle largeur de carte, cellules identiques. Cleanup = clear tick.
      mount: function (host) {
        if (typeof renderClocks !== 'function') { fallback(host, 'Horloge indisponible.'); return null; }
        host.innerHTML = '<div class="wdg-clockwrap custom-scrollbar"><div class="clocks-bar wdg-clocks-bar"></div></div>';
        var bar = host.querySelector('.wdg-clocks-bar');
        function tick() { if (!host.isConnected) return; try { renderClocks(bar); } catch (e) {} }
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
      opts: [{ k: 'nb', lbl: 'Actus', type: 'nombre', def: 15, min: 5, max: 40, pas: 5 }],
      // LE PANNEAU DU DESK À L'IDENTIQUE (demande user 02/08, capture à l'appui) : barre d'outils
      // « Sections d'actualités » + recherche + compteur (classes exactes .panel-toolbar/.toolbar-select/
      // .toolbar-search/.item-count), menu de sections en cases à cocher (.section-dropdown), pastille
      // verte « en direct » déplacée dans l'en-tête de la carte, séparateurs de jour (.date-header via
      // formatDate du desk) et lignes buildNewsItem — plus une simple liste nue.
      mount: function (host, it) {
        var W = this;
        var sig = '', q = '', off = {};                     // off = sections décochées (tout coché par défaut)
        var plus = 0, chargeEnCours = false;                // items révélés en plus du réglage (bouton « Charger plus »)
        host.innerHTML = '<div class="wdg-news-panel">'
          + '<div class="panel-toolbar">'
          +   '<div class="toolbar-select wdg-nw-secbtn"><span>Sections d\'actualités</span><span class="select-arrow">▾</span></div>'
          +   '<div class="toolbar-search"><span class="search-icon"><svg width="15" height="15" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="currentColor" opacity=".2"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20.5 20.5 16.5 16.5"/></svg></span>'
          +     '<input type="text" class="wdg-nw-q" placeholder="Rechercher des événements..."></div>'
          +   '<div class="toolbar-right"><span class="item-count wdg-nw-count">— items</span></div>'
          + '</div>'
          + '<div class="section-dropdown hidden wdg-nw-drop"><div class="dropdown-header">Filtrer les sections</div><div class="dropdown-grid wdg-nw-grid"></div></div>'
          + '<div class="news-list wdg-news custom-scrollbar"><div class="wdg-skel"><span class="wdg-skel-l" style="width:78%"></span><span class="wdg-skel-l" style="width:64%"></span><span class="wdg-skel-l" style="width:82%"></span></div></div>'
          + '</div>';
        var liste = host.querySelector('.news-list'), grid = host.querySelector('.wdg-nw-grid');
        var drop = host.querySelector('.wdg-nw-drop'), count = host.querySelector('.wdg-nw-count');
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
        // Sections = les CATÉGORIES INTERNES du desk (INTERNAL_CATS + libellés catFr), pas une liste
        // maison : le menu du widget est ainsi mot pour mot celui de l'onglet ACTUS. Repli sur les
        // catégories observées dans le flux si les globales manquent.
        var sections = function (items) {
          var l = (typeof INTERNAL_CATS !== 'undefined' && Array.isArray(INTERNAL_CATS)) ? INTERNAL_CATS.slice()
            : (function () { var vu = {}; items.forEach(function (i) { if (i && i.category) vu[i.category] = 1; }); return Object.keys(vu).sort(); })();
          // « Bonds/Obligations » est BANNI du produit (demande user 27/07, réaffirmée 03/08) — la
          // liste des sections ne doit pas le réintroduire.
          return l.filter(function (c) { return c !== 'Bonds'; });
        };
        var libSec = function (c) { return (typeof catFr === 'function') ? catFr(c) : c; };
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
          var cap = (opt(it, W, 'nb') | 0) + plus;
          var rows = tout.slice(0, cap);
          count.textContent = rows.length + ' items';
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
          liste.scrollTop = _scroll;
        };
        // Menu de sections : le MARKUP EXACT du desk (.dropdown-item.active + .dropdown-check ✓,
        // bascule au clic), tout coché par défaut — le comportement de l'onglet ACTUS.
        var renderGridSec = function () {
          var items = (typeof window.getNewsMaster === 'function') ? (window.getNewsMaster() || []) : [];
          grid.innerHTML = sections(items).map(function (c) {
            return '<div class="dropdown-item' + (off[c] ? '' : ' active') + '" data-sec="' + esc(c) + '">'
              + '<span class="dropdown-item-label">' + esc(libSec(c)) + '</span><span class="dropdown-check">✓</span></div>';
          }).join('') || '<div class="dropdown-item" style="opacity:.6">Aucune section</div>';
        };
        host.querySelector('.wdg-nw-secbtn').addEventListener('click', function () {
          if (drop.classList.contains('hidden')) renderGridSec();
          drop.classList.toggle('hidden');
        });
        grid.addEventListener('click', function (e) {
          var el = e.target.closest('.dropdown-item[data-sec]'); if (!el) return;
          var c = el.getAttribute('data-sec');
          if (off[c]) delete off[c]; else off[c] = 1;
          el.classList.toggle('active', !off[c]);
          render(true);
        });
        host.querySelector('.wdg-nw-q').addEventListener('input', function (e) { q = e.target.value; render(true); });
        render();
        var t = setInterval(render, 20000);                                 // le WS réassigne allItems → on resuit
        return function () { clearInterval(t); };
      },
    },
    {
      id: 'calculatrice', name: 'Calculatrice de position', cat: 'Outils', h: 280,
      desc: 'Taille de lot depuis capital, risque % et stop (pips).',
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
          + '<div class="wdg-calc-out"><div class="wdg-calc-o"><span>Risque</span><b class="wdg-calc-risk">—</b></div>'
          + '<div class="wdg-calc-o wdg-calc-o--main"><span>Taille de position</span><b class="wdg-calc-lots">—</b></div></div>'
          + '<div class="wdg-calc-note">Position = (capital × risque %) ÷ (stop × valeur du pip).</div>'
          + '</div>';
        var ins = host.querySelectorAll('input');
        var compute = function () {
          var cap = parseFloat(ins[0].value) || 0, rk = parseFloat(ins[1].value) || 0,
              sl = parseFloat(ins[2].value) || 0, pv = parseFloat(ins[3].value) || 0;
          var risk = cap * rk / 100;
          var lots = (sl > 0 && pv > 0) ? risk / (sl * pv) : 0;
          var rEl = host.querySelector('.wdg-calc-risk'), lEl = host.querySelector('.wdg-calc-lots');
          if (rEl) rEl.textContent = risk > 0 ? risk.toFixed(2) + ' $' : '—';
          if (lEl) lEl.textContent = lots > 0 ? lots.toFixed(2) + ' lot' + (lots >= 2 ? 's' : '') : '—';
        };
        ins.forEach(function (i) { i.addEventListener('input', compute); });
        compute();
        return null;
      },
    },
    {
      id: 'journal-mini', name: 'Journal de trading', cat: 'Outils', h: 300,
      desc: 'Ton journal de trading complet, dans Mon Desk.',
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
            v = num(e.pnlPct); if (v != null) return { n: v, txt: (v > 0 ? '+' : '') + String(Math.round(v * 100) / 100).replace('.', ',') + ' %' };
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
            var unit = mode === 'pct' ? ' %' : mode === 'r' ? ' R' : ' $';
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
            + (wr != null ? '<span>Réussite <b class="' + (wr >= 50 ? 'up' : 'down') + '">' + wr + ' %</b></span>' : '')
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
              + (wr != null ? ring(wr + ' %', wr >= 50 ? '#00e676' : '#ff3d00', 'Taux de réussite', oW + ' G / ' + oL + ' P') : '')
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
    function _vueDesk(id, nom, tag, cat, viewId, cle, desc, extra) {
      var W = {
        id: id, name: nom, tag: tag, cat: cat, h: 340, desc: desc,
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
      _vueDesk('vue-analyst', 'Analystes', 'ANALYSTES', 'News', 'view-analyst', 'analyst', "L'onglet ANALYSTES du desk : rapports, récaps de séance, Éclairages IA."),
      _vueDesk('vue-bias', 'Onglet Biais', 'BIAIS', 'Macro', 'view-bias', 'bias', "L'onglet BIAIS complet du desk : matrice Smart Bias + synthèse."),
      _vueDesk('vue-weekahead', 'Semaine à Venir', 'SEMAINE', 'Macro', 'view-weekahead', 'weekahead', "L'onglet SEMAINE À VENIR du desk : profil de risque + agenda éditorialisé."),
      _vueDesk('vue-taux', 'Onglet Taux', 'TAUX', 'Macro', 'view-taux', 'taux', "L'onglet TAUX du desk : cartes par banque, pricing des décisions, temps réel.", _tauxExtra),
      _vueDesk('vue-bank', 'Banques', 'BANQUES', 'Risque', 'view-bank', 'bank', "L'onglet BANQUES du desk : positions des grandes banques + graphique.", _bankExtra),
    ];
  })()).concat([
    {
      id: 'onglets', name: 'Panneau à onglets', cat: 'Outils', h: 360,
      desc: 'Plusieurs widgets dans une seule carte, avec sa propre barre d\'onglets — comme la barre › MONDE › FORCE du desk.',
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
        var tabs = (Array.isArray(it.tabs) ? it.tabs : []).filter(function (id) { return id === 'vide' || byId(id); });
        var labels = Array.isArray(it.tabLabels) ? it.tabLabels.slice() : [];   // libellés personnalisés (double-clic → renommage), alignés sur tabs
        var actIdx = Math.min((it._tabAct | 0), Math.max(0, tabs.length - 1));
        var subClean = null;
        var bar = document.createElement('div'); bar.className = 'wdgt-bar';
        bar.setAttribute('draggable', 'true');   // saisie de la carte depuis l'espace vide de la barre (cf. _wireGrid)
        var body = document.createElement('div'); body.className = 'wdgt-body';
        host.innerHTML = ''; host.classList.add('wdgt-host');
        host.appendChild(bar); host.appendChild(body);
        function mountSub() {
          if (subClean) { try { subClean(); } catch (e) {} subClean = null; }
          body.innerHTML = '';
          if (!tabs.length) { body.innerHTML = '<div class="wdg-empty">Ajoute un onglet avec le « + » ci-dessus.</div>'; return; }
          var w = tabs[actIdx] !== 'vide' && tabs[actIdx] && byId(tabs[actIdx]);
          if (!w) {
            // ONGLET VIDE : MÊME grammaire que les emplacements de la grille (cadre pointillé or,
            // + fin, libellé discret) et TOUTE la zone est cliquable — un geste, un sens.
            body.innerHTML = '<div class="wdgt-vide" role="button" tabindex="0" title="Choisir un widget pour cet onglet">'
              + '<span class="wdgt-fill">+<span>Choisir un widget</span></span></div>';
            var b0 = body.querySelector('.wdgt-vide');
            if (b0) {
              b0.addEventListener('click', function () { _pickTabFor(it, actIdx); });
              b0.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); _pickTabFor(it, actIdx); } });
            }
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
          var aSonTitre = (String(w.id).indexOf('vue-') === 0) || w.id === 'force-devises';
          if (!aSonTitre) {
            var sn = document.createElement('div');
            sn.className = 'wdgt-subname'; sn.textContent = w.name;
            body.appendChild(sn);
          }
          var hote = document.createElement('div');
          hote.className = 'wdgt-mount';
          body.appendChild(hote);
          // Le sous-widget reçoit SA config (it.tabCfg[index]) : il lit ses réglages par opt()
          // exactement comme une carte, sans savoir qu'il vit dans un onglet.
          try { var un = w.mount(hote, _tabItem(it, actIdx)); if (typeof un === 'function') subClean = un; }
          catch (e) { fallback(hote, 'Widget indisponible.'); }
        }
        function renderTabs() {
          // Libellé = TAG court du desk quand il existe (› MONDE › RISQUE › FORCE…, demande user 26/07
          // « exactement comme le desk ») ; le nom complet reste dans le title (infobulle).
          bar.innerHTML = tabs.map(function (id, i) {
            var w = id !== 'vide' && byId(id);
            var lbl = labels[i] || (w ? (w.tag || w.name) : 'Vide');
            var ttl = w ? (w.name + ' — double-clic pour renommer') : 'Onglet vide — choisis un widget dans le corps';
            return '<button class="wdgt-tab' + (i === actIdx ? ' on' : '') + (w ? '' : ' wdgt-tab--vide') + '" data-i="' + i + '" title="' + esc(ttl) + '">'
              + '<span class="wdgt-chv">›</span><span class="wdgt-nm">' + esc(lbl) + '</span></button>';
          }).join('') + '<button class="wdgt-add" title="Ajouter un onglet — il s\'ouvre vide, tu choisis son widget ensuite">+</button>';
        }
        // RENOMMAGE INLINE (demande user 28/07, réparé 03/08) : le libellé devient un champ —
        // Entrée/blur valide, Échap annule, vide = retour au nom d'origine. Persisté (it.tabLabels).
        function ouvreRenommage(i) {
          var t = bar.querySelector('.wdgt-tab[data-i="' + i + '"]'); if (!t) return;
          var w0 = tabs[i] !== 'vide' && byId(tabs[i]);
          if (!w0 && tabs[i] !== 'vide') return;
          var def0 = w0 ? (w0.tag || w0.name) : 'Vide';       // un onglet vide se renomme aussi
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
        });
        renderTabs(); mountSub();
        return function () { if (subClean) { try { subClean(); } catch (e) {} subClean = null; } };
      },
    },
  ]);

  // Courbe de capital du widget Journal (miroir de _jrBuildEquityChart du desk) : aire dégradée OR, axes discrets,
  // tooltip riche FR (date · valeur · variation). amCharts globaux ; root disposé par le cleanup du widget.
  function _wdgJrEquityChart(id, data) {
    var el = document.getElementById(id);
    if (!el || typeof am5 === 'undefined' || typeof am5xy === 'undefined') return;
    try { if (typeof disposeRoot === 'function') disposeRoot(id); } catch (e) {}
    var root = am5.Root.new(id);
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
      { w: 'horloge', gw: 6, gh: 4 },
      { w: 'onglets', gw: 6, gh: 22, tabs: ['sessions', 'risque-jauge', 'force-devises', 'barometre', 'cot-inst', 'dmx-retail', 'saison'] },
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
    b.innerHTML = '<span>Desk non chargé — modifications non enregistrées. Recharge la page.</span>'
      + '<button class="wdg-undo-b" onclick="location.reload()">Recharger</button>';
    document.body.appendChild(b);
  }
  function save() {                        // débouncé ; le serveur re-sanitise de toute façon
    if (!STATE.loaded) return _readOnlyWarn();     // config de secours : l'écrire écraserait les vrais layouts
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
    var dragIdx = null, rz = null;
    var clearHints = function () { host.querySelectorAll('.wdg-drop-before,.wdg-drop-after').forEach(function (c) { c.classList.remove('wdg-drop-before', 'wdg-drop-after'); }); };
    // — Glisser-déposer (réordonner) —
    host.addEventListener('dragstart', function (e) {
      // DÉPLACEMENT SANS POIGNÉE (04/08, demande user « ça doit se faire sans avoir besoin de
      // l'icône ») : on saisit l'EN-TÊTE de la carte (sa zone neutre — pas les boutons, pas les
      // onglets, qui gardent leurs propres gestes). La poignée ⠿ est supprimée : un pointeur
      // « grab » sur l'en-tête suffit à l'annoncer.
      // Zones de saisie : l'en-tête de la carte OU, pour un panneau à onglets (dont l'en-tête est
      // un calque non cliquable), l'espace vide de sa barre d'onglets.
      var tete = e.target.closest && e.target.closest('.wdg-head, .wdgt-bar');
      var card = tete && !e.target.closest('.wdg-ico, .wdgt-tab, .wdgt-add, button, input')
        ? tete.closest('.wdg-card') : null;
      if (card && card.classList.contains('wdg-card--locked')) card = null;        // carte verrouillée → pas de déplacement
      if (!card) { if (e.preventDefault) e.preventDefault(); return; }
      dragIdx = +card.getAttribute('data-idx');
      card.classList.add('wdg-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragIdx)); e.dataTransfer.setDragImage(card, 24, 18); } catch (_) {}
    });
    host.addEventListener('dragover', function (e) {
      if (dragIdx == null) return; e.preventDefault();
      var card = e.target.closest && e.target.closest('.wdg-card'); clearHints();
      if (!card || +card.getAttribute('data-idx') === dragIdx) return;
      var r = card.getBoundingClientRect();
      card.classList.add((e.clientY - r.top) > r.height / 2 ? 'wdg-drop-after' : 'wdg-drop-before');
    });
    host.addEventListener('drop', function (e) {
      if (dragIdx == null) return; e.preventDefault();
      var card = e.target.closest && e.target.closest('.wdg-card');
      if (card) {
        var to = +card.getAttribute('data-idx'), r = card.getBoundingClientRect();
        _reorderBefore(dragIdx, (e.clientY - r.top) > r.height / 2 ? to + 1 : to);
      }
      dragIdx = null; clearHints();
    });
    host.addEventListener('dragend', function () { dragIdx = null; clearHints(); host.querySelectorAll('.wdg-dragging').forEach(function (c) { c.classList.remove('wdg-dragging'); }); });
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
      var rowUnit = (card.offsetHeight + gapR) / Math.max(1, it.gh);
      if (!isFinite(rowUnit) || rowUnit < 4) rowUnit = ROW_PX + gapR;
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
             d0: d0, noeuds: noeuds, gapR: gapR, rowUnit: rowUnit, colUnit: (card.offsetWidth + gapC) / Math.max(1, d0) };
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
          + '<div class="wdg-resize" title="Glisser (coin) pour redimensionner"></div>'
          + '<div class="wdg-resize-e" title="Glisser pour élargir"></div></section>';
      }
      var w = byId(it.w);
      if (!w) return '';                                                     // widget retiré du catalogue → ignoré
      _normItem(it);
      var locked = !!it.locked;
      // Carte = cellule de grille (span colonnes/lignes via --gw/--gh). Header TERMINAL : déplacer · actualiser ·
      // réglages · dupliquer · plein écran · verrouiller · retirer. Icônes discrètes, hover doré.
      return '<section class="wdg-card' + (locked ? ' wdg-card--locked' : '') + (w.id === 'onglets' ? ' wdg-card--tabs' : '') + '" data-idx="' + idx + '" style="--gw:' + (_lgs[idx] || it.gw) + ';--gh:' + it.gh + ';">'
        + '<header class="wdg-head" draggable="' + (locked ? 'false' : 'true') + '" title="Glisser pour déplacer ce widget">'
        // (poignée ⠿ RETIRÉE 04/08 : l'en-tête entier est la zone de saisie — cf. _wireGrid)
        +   '<span class="wdg-title" title="' + esc(w.name) + '">' + esc(w.name) + '</span>'
        // BANDEAU À DEUX BOUTONS (04/08, demande user « le moins possible — 2 en moyenne ») :
        // Réglages + Fermer. Remplacer, Dupliquer, Plein écran, Verrouiller et « vider l'onglet »
        // vivent tous dans le panneau Réglages, où ils sont LIBELLÉS (donc plus clairs qu'une icône).
        +   '<span class="wdg-actions">'
        +     '<button class="wdg-ico" title="Réglages du widget" onclick="DTPWidgets.toggleSettings(' + idx + ')">' + ICO.gear + '</button>'
        +     '<button class="wdg-ico wdg-ico--x" title="' + (w.id === 'onglets' ? 'Retirer tout le panneau' : 'Retirer ce widget') + '" onclick="DTPWidgets.remove(' + idx + ')">' + ICO.close + '</button>'
        +   '</span>'
        + '</header>'
        + '<div class="wdg-pop wdg-settings" id="' + HOST_ID + '-s' + idx + '" hidden>'
        +   _setPanelHtml(idx, w, it)
        + '</div>'
        + '<div class="wdg-body" id="' + HOST_ID + '-b' + idx + '"></div>'
        + '<div class="wdg-resize" title="Glisser (coin) pour redimensionner"></div>'
        + '<div class="wdg-resize-e" title="Glisser pour élargir"></div></section>';
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
        try { var un = w.mount(body, it); if (typeof un === 'function') { STATE.mounted.push(un); body._wdgClean = un; } }   // it = config d'item (Panneau à onglets lit it.tabs)
        catch (e) { fallback(body, 'Widget indisponible.'); }
      });
    });
  }
  function layoutById(id) {
    var c = STATE.cfg; if (!c) return null;
    for (var i = 0; i < c.layouts.length; i++) if (c.layouts[i].id === id) return c.layouts[i];
    return null;
  }
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
      return '<span class="nav-item wdg-lay' + (l.id === c.active ? ' nav-item--active on' : '') + '" data-lay="' + l.id + '" title="' + esc(l.name) + ' — double-clic pour renommer"'
        + ' role="button" tabindex="0"'
        + ' onclick="DTPWidgets.switchLayout(\'' + l.id + '\')" ondblclick="DTPWidgets.editTab(\'' + l.id + '\')">'
        + '<span class="wdg-lay-chv">›</span>'
        + (l.fav ? '<span class="wdg-lay-star">★</span>' : '')
        + '<span class="wdg-lay-name">' + esc(l.name) + '</span>'
        // ✕ = FERMER l'onglet, PAS supprimer le layout (demande user 04/08) : il retourne dans
        // Personnaliser › Layouts, prêt à être rouvert. Quand il n'en reste qu'UN, la barre entière
        // se masque (cf. plus haut) → l'espace est rendu au desk.
        + '<button class="wdg-lay-x" title="Fermer cet onglet (le layout reste dans Personnaliser)"'
        +   ' onclick="event.stopPropagation();DTPWidgets.toggleHide(\'' + l.id + '\')">×</button>'
        + '</span>';
    }).join('')
      // « + » = NOUVEL ONGLET (demande user 04/08) : ouvre la fenêtre des LAYOUTS sur le choix de
      // disposition (newLayout → _mgrMode='dispo'), comme le « + » d'un panneau à onglets.
      + (c.layouts.length < _LMAX
          ? '<button class="nav-item wdg-lay wdg-lay-add" title="Nouvel onglet — choisir une disposition" onclick="DTPWidgets.newLayout()">+</button>'
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
  var _mgrMode = null;                       // null = liste · 'dispo' = choix de disposition
  var _dispoTarget = 'new';                  // 'new' = créer un layout · 'current' = remplir le desk VIDE actif (écran guidé)
  function renderManager() {
    var box = document.getElementById('wdg-mgr-list'); var c = STATE.cfg;
    if (!box || !c) return;
    if (_mgrMode === 'dispo') {
      // Rangées GROUPÉES par nombre de panneaux, le chiffre à gauche (façon « Select Layout » d'un terminal pro).
      var _dCard = function (d, i) {
        return '<button class="wdg-dispo-card" onclick="DTPWidgets.createLayout(' + i + ')" title="' + esc(d.name) + '">'
          + (d.items.length ? _thumb(d.items) : '<span class="wdg-thumb wdg-thumb--free">∞</span>')
          + '<span class="wdg-dispo-name">' + esc(d.name) + '</span></button>';
      };
      box.innerHTML = '<div class="wdg-dispo-head">'
        + '<button class="wdg-btn" onclick="DTPWidgets.backManager()">‹ Retour</button>'
        + '<span class="wdg-dispo-t">Choisis une disposition</span></div>'
        + '<div class="wdg-dispo-namerow"><input id="wdg-newname" class="wdg-lib-search" maxlength="40" spellcheck="false" autocomplete="off" placeholder="Nom du layout (optionnel — modifiable ensuite)"></div>'
        + DISPO_ORDER.map(function (n) {
            var cards = DISPOS.map(function (d, i) { return d.n === n ? _dCard(d, i) : ''; }).join('');
            if (!cards) return '';
            return '<div class="wdg-dispo-row"><span class="wdg-dispo-num">' + n + '</span><div class="wdg-dispo-cards">' + cards + '</div></div>';
          }).join('')
        + '<div class="wdg-dispo-hint">Chaque emplacement affichera « + Choisir un widget » — remplis-le depuis la bibliothèque. « Libre » = partir d\'une page vide.</div>';
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
        ? '<span class="wdg-mgr-lock" title="Modèle par défaut — non supprimable">' + ICO.lock + '</span>'
        : (l.id === _delConfirm)
          ? '<button class="wdg-mgr-del confirm" onclick="' + stop + 'DTPWidgets.deleteLayout(\'' + l.id + '\')">Supprimer ?</button>'
          : '<button class="wdg-mgr-del" title="Supprimer ce layout" onclick="' + stop + 'DTPWidgets.askDelete(\'' + l.id + '\')">×</button>';
      return '<div class="wdg-mgr-card' + (active ? ' on' : '') + (l.hidden ? ' is-hidden' : '') + '" data-i="' + li + '"'
        + ' role="button" tabindex="0" title="' + esc(l.name) + ' — cliquer pour ouvrir · double-clic sur le nom pour renommer"'
        + ' onclick="DTPWidgets.switchLayout(\'' + l.id + '\')"'
        + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();DTPWidgets.switchLayout(\'' + l.id + '\');}">'
        + '<span class="wdg-mgr-face">' + _thumb(l.items, { labels: true }) + '</span>'
        + (active ? '<span class="wdg-mgr-badge">Actif</span>' : '')
        + '<span class="wdg-mgr-acts">'
        +   '<button class="wdg-mgr-star' + (l.fav ? ' on' : '') + '" title="Layout par défaut (s\'ouvre à l\'arrivée sur Mon Desk)" onclick="' + stop + 'DTPWidgets.toggleFav(\'' + l.id + '\')">★</button>'
        +   '<button class="wdg-mgr-eye' + (l.hidden ? '' : ' on') + '" title="' + (l.hidden ? 'Afficher aussi dans la barre (plusieurs layouts côte à côte)' : 'Ne plus afficher dans la barre') + '" onclick="' + stop + 'DTPWidgets.toggleHide(\'' + l.id + '\')">'
        +     (l.hidden
                ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z"/></svg>'
                : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h6.5A1.5 1.5 0 0 1 19 9v1.5"/><path d="M4.8 10.5h15.4l-2 7a1.5 1.5 0 0 1-1.4 1H6.1a1.5 1.5 0 0 1-1.4-1.1z"/></svg>')
        +   '</button>'
        +   del
        + '</span>'
        // Renommage au DOUBLE-CLIC (le simple clic ouvre le layout) — champ masqué jusque-là.
        + '<span class="wdg-mgr-foot">'
        +   '<span class="wdg-mgr-nom" ondblclick="' + stop + 'DTPWidgets.editCardName(\'' + l.id + '\', this)">' + esc(l.name) + '</span>'
        +   '<span class="wdg-mgr-count">' + l.items.length + ' widget' + (l.items.length > 1 ? 's' : '') + '</span>'
        + '</span></div>';
    }).join('')
      + (c.layouts.length < _LMAX
          ? '<button class="wdg-mgr-card wdg-mgr-card--new" onclick="DTPWidgets.newLayout()"><span class="wdg-mgr-plus">+</span><span>Créer un layout</span></button>'
          : '')
      + '</div>'
      + (c.layouts.length >= _LMAX ? '<div class="wdg-mgr-full">Plafond de ' + _LMAX + ' layouts atteint.</div>' : '')
      // Les MODÈLES PRÊTS ne vivent plus ici (ils brouillaient la création) : ils restent dans la bibliothèque.
      + '<div class="wdg-mgr-tplhint">Envie d\'un desk pré-composé ? Les modèles prêts sont dans la <button class="wdg-mgr-tpllink" onclick="DTPWidgets.closeManager();DTPWidgets.openLib()">bibliothèque de widgets</button>.</div>';
  }
  // Icônes de widget (dessins DTP originaux) — par id, repli sur l'icône de sa catégorie.
  var WICO = {
    'force-devises': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 6-8"/><path d="M18 6h3v3"/></svg>',
    'barometre': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 12v-5M9 12v-8M13 12v-3M17 12v-7M5 12v4M9 12v2M13 12v6M17 12v3"/><path d="M3 12h18" opacity=".45"/></svg>',
    'classement-devises': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 6h10M4 12h14M4 18h7"/><circle cx="20" cy="6" r="1.4" fill="currentColor" stroke="none"/></svg>',
    'risque-historique': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16c2-1 3-6 5-6s3 8 5 8 3-11 5-11 2 4 3 4"/></svg>',
    'calendrier-jour': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8 3.5v3M16 3.5v3"/></svg>',
    'radar-biais': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" opacity=".4"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
    'taux-cb': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M6 20V9l6-4 6 4v11"/><path d="M9 20v-5h6v5"/></svg>',
    'risque-jauge': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l4-4"/><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none"/></svg>',
    'cot-inst': '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 12h7M13 12h7" opacity=".5"/><rect x="4" y="8" width="7" height="3.2" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="12.8" width="7" height="3.2" rx="1" fill="currentColor" stroke="none" opacity=".55"/></svg>',
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
    'force-devises': '<svg ' + _PV + '><line x1="6" y1="28" x2="114" y2="28" stroke="#23232a" stroke-dasharray="2 3"/><polyline fill="none" stroke="#e3b23a" stroke-width="1.4" points="6,34 22,30 36,36 52,26 68,30 84,20 100,24 114,14"/><polyline fill="none" stroke="#22c55e" stroke-width="1.4" points="6,24 22,28 36,22 52,30 68,24 84,28 100,32 114,36"/><polyline fill="none" stroke="#3b82f6" stroke-width="1.4" points="6,30 22,34 36,28 52,36 68,40 84,36 100,42 114,44"/><circle cx="114" cy="14" r="2" fill="#e3b23a"/><circle cx="114" cy="36" r="2" fill="#22c55e"/><circle cx="114" cy="44" r="2" fill="#3b82f6"/></svg>',
    'barometre': '<svg ' + _PV + '><line x1="6" y1="28" x2="114" y2="28" stroke="#3a3d44"/><rect x="10" y="12" width="7" height="16" fill="#22c55e"/><rect x="23" y="18" width="7" height="10" fill="#22c55e"/><rect x="36" y="8" width="7" height="20" fill="#22c55e"/><rect x="49" y="22" width="7" height="6" fill="#22c55e"/><rect x="62" y="28" width="7" height="9" fill="#ef4444"/><rect x="75" y="28" width="7" height="16" fill="#ef4444"/><rect x="88" y="28" width="7" height="6" fill="#ef4444"/><rect x="101" y="28" width="7" height="19" fill="#ef4444"/></svg>',
    'risque-historique': '<svg ' + _PV + '><line x1="6" y1="28" x2="114" y2="28" stroke="#ff9800" stroke-width="1.2"/><rect x="8" y="18" width="5" height="10" fill="#22c55e"/><rect x="16" y="22" width="5" height="6" fill="#22c55e"/><rect x="24" y="14" width="5" height="14" fill="#22c55e"/><rect x="32" y="28" width="5" height="7" fill="#ef4444"/><rect x="40" y="28" width="5" height="12" fill="#ef4444"/><rect x="48" y="28" width="5" height="17" fill="#ef4444"/><rect x="56" y="28" width="5" height="8" fill="#ef4444"/><rect x="64" y="16" width="5" height="12" fill="#22c55e"/><rect x="72" y="12" width="5" height="16" fill="#22c55e"/><rect x="80" y="20" width="5" height="8" fill="#22c55e"/><rect x="88" y="28" width="5" height="6" fill="#ef4444"/><rect x="96" y="18" width="5" height="10" fill="#22c55e"/><rect x="104" y="14" width="5" height="14" fill="#22c55e"/></svg>',
    'calendrier-jour': '<svg ' + _PV + '><g font-family="monospace" font-size="6" fill="#5b5d66"><text x="8" y="13">08:30</text><text x="8" y="26">10:00</text><text x="8" y="39">14:30</text><text x="8" y="52">16:00</text></g><rect x="34" y="7" width="52" height="6" rx="2" fill="#2b2b31"/><rect x="34" y="20" width="64" height="6" rx="2" fill="#2b2b31"/><rect x="34" y="33" width="44" height="6" rx="2" fill="#2b2b31"/><rect x="34" y="46" width="58" height="6" rx="2" fill="#2b2b31"/><circle cx="108" cy="10" r="3" fill="#ef4444"/><circle cx="108" cy="23" r="3" fill="#ffb300"/><circle cx="108" cy="36" r="3" fill="#5b5d66"/><circle cx="108" cy="49" r="3" fill="#ef4444"/></svg>',
    'radar-biais': '<svg ' + _PV + '><g font-family="monospace" font-size="6.5" fill="#9aa1ac"><text x="7" y="14">USD</text><text x="7" y="28">EUR</text><text x="7" y="42">GBP</text><text x="7" y="55">JPY</text></g><g rx="2"><rect x="30" y="7" width="24" height="9" rx="2" fill="#047857"/><rect x="58" y="7" width="24" height="9" rx="2" fill="#059669"/><rect x="86" y="7" width="26" height="9" rx="2" fill="#047857"/><rect x="30" y="21" width="24" height="9" rx="2" fill="#6b7280"/><rect x="58" y="21" width="24" height="9" rx="2" fill="#059669"/><rect x="86" y="21" width="26" height="9" rx="2" fill="#6b7280"/><rect x="30" y="35" width="24" height="9" rx="2" fill="#059669"/><rect x="58" y="35" width="24" height="9" rx="2" fill="#6b7280"/><rect x="86" y="35" width="26" height="9" rx="2" fill="#059669"/><rect x="30" y="49" width="24" height="6" rx="2" fill="#dc2626"/><rect x="58" y="49" width="24" height="6" rx="2" fill="#991b1b"/><rect x="86" y="49" width="26" height="6" rx="2" fill="#dc2626"/></g></svg>',
    'taux-cb': '<svg ' + _PV + '><g font-family="monospace" font-size="6.5" fill="#9aa1ac"><text x="7" y="15">FED</text><text x="7" y="31">BCE</text><text x="7" y="47">BOE</text></g><rect x="30" y="8" width="56" height="8" rx="2" fill="#2b2b31"/><rect x="30" y="24" width="42" height="8" rx="2" fill="#2b2b31"/><rect x="30" y="40" width="48" height="8" rx="2" fill="#2b2b31"/><g font-family="monospace" font-size="7" fill="#e3b23a"><text x="92" y="15">4.50</text><text x="92" y="31">2.15</text><text x="92" y="47">4.00</text></g></svg>',
    'risque-jauge': '<svg ' + _PV + '><path d="M 24 48 A 36 36 0 0 1 60 12" fill="none" stroke="#ef4444" stroke-width="5" stroke-linecap="round"/><path d="M 60 12 A 36 36 0 0 1 96 48" fill="none" stroke="#22c55e" stroke-width="5" stroke-linecap="round"/><line x1="60" y1="48" x2="78" y2="24" stroke="#e6e8ec" stroke-width="2"/><circle cx="60" cy="48" r="3.5" fill="#e6e8ec"/></svg>',
    'cot-inst': '<svg ' + _PV + '><line x1="60" y1="4" x2="60" y2="52" stroke="#3a3d44"/><rect x="60" y="7" width="34" height="7" fill="#22c55e"/><rect x="34" y="18" width="26" height="7" fill="#ef4444"/><rect x="60" y="29" width="20" height="7" fill="#22c55e"/><rect x="18" y="40" width="42" height="7" fill="#ef4444"/></svg>',
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
  var _pickSwap = null;                      // index de la carte à REMPLACER (la bibliothèque sert alors de sélecteur)
  var _justAdded = null;                     // id du widget qu'on vient d'ajouter (flash « ✓ Ajouté » sur sa carte)
  // « + » d'un Panneau à onglets → la bibliothèque choisit le SOUS-widget (ajouté comme onglet, pas
  // comme carte). `at` (03/08) : position d'un onglet VIDE → le choix REMPLIT cet onglet-là.
  function _pickTabFor(it, at) {
    var l = activeLayout(); if (!l) return;
    var idx = l.items.indexOf(it); if (idx < 0) return;
    API.openLib(); _pickTab = idx; _pickTabAt = (at == null ? null : at);
  }
  function renderLib() {
    var box = document.getElementById('wdg-lib-grid'); if (!box) return;
    var lay = activeLayout(), used = {};
    (lay ? lay.items : []).forEach(function (i) { used[i.w] = (used[i.w] || 0) + 1; });
    var q = _libQ.toLowerCase();
    var match = function (w) { return !q || (w.name + ' ' + w.desc + ' ' + w.cat).toLowerCase().indexOf(q) !== -1; };
    // BIBLIOTHÈQUE PAR FAMILLES (demande user 23/07 : reprendre l'ORGANISATION du terminal PMT — 2 rails :
    // « Fonctions » = panneaux de données/outils qu'on consulte ; « Analytics » = panneaux d'analyse de marché.
    // Identité 100% DTP, aucune reprise visuelle PMT). FAM_OF mappe chaque widget à sa famille.
    var FAM_OF = {
      'force-devises': 'Analyse de marché', 'barometre': 'Analyse de marché', 'risque-historique': 'Analyse de marché', 'radar-biais': 'Analyse de marché',
      'risque-jauge': 'Analyse de marché', 'cot-inst': 'Analyse de marché', 'dmx-retail': 'Analyse de marché', 'saison': 'Analyse de marché', 'sessions': 'Analyse de marché',
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

    var FAM_SUB = { Analytics: 'Analyse de marché', Fonctions: 'Données & outils', 'Vues du desk': 'Les onglets de la nav, en carte' };
    var html = (_libFam === '_tpl' ? [] : FAMS).map(function (fam) {
      if (_libFam && _libFam !== fam) return '';                              // puce de catégorie active → une seule famille
      var list = CATALOG.filter(function (w) { return (FAM_OF[w.id] || 'Fonctions') === fam && match(w); });
      if (!list.length) return '';
      var cards = list.map(function (w) {
        // Carte façon terminal pro : APERÇU visuel du widget (vignette dessinée) au-dessus, nom + description dessous.
        return '<button class="wdg-lib-card wdg-lib-card--prev' + (w.id === _justAdded ? ' wdg-lib-card--added' : '') + '" onclick="DTPWidgets.add(\'' + w.id + '\')" title="Ajouter « ' + esc(w.name) + ' »">'
          + '<span class="wdg-lib-prev">' + (WPREV[w.id] || WICO[w.id] || '') + '</span>'
          + '<span class="wdg-lib-main"><span class="wdg-lib-name">' + esc(w.name) + '</span>'
          + '<span class="wdg-lib-desc">' + esc(w.desc) + '</span></span>'
          + (used[w.id] ? '<span class="wdg-lib-used">' + used[w.id] + '×</span>' : '<span class="wdg-lib-plus">+</span>')
          + '</button>';
      }).join('');
      return '<div class="wdg-lib-sec">' + esc(fam) + '<span class="wdg-lib-cnt">(' + list.length + ')</span>'
        + '<span class="wdg-lib-sub">' + esc(FAM_SUB[fam] || '') + '</span></div><div class="wdg-lib-row">' + cards + '</div>';
    }).join('');
    box.innerHTML = (tplHtml + html) || '<div class="wdg-empty">Rien ne correspond à « ' + esc(_libQ) + ' ».</div>';
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
  var _CAT_COL = {
    'Devises': '#e3b23a', 'Macro': '#4a9eda', 'Risque': '#e0574a',
    'News': '#8b7ad8', 'Outils': '#3fae86', 'Autre': '#7e8590',
  };
  // Abréviations ÉCRITES (jamais une troncature au milieu d'un mot : « BAROMÈ » ne veut rien dire).
  var _ABBR = {
    'force-devises': 'FORCE', 'barometre': 'BARO', 'risque-historique': 'HISTO',
    'calendrier-jour': 'AGENDA', 'radar-biais': 'BIAIS', 'taux-cb': 'TAUX',
    'risque-jauge': 'RISQUE', 'cot-inst': 'COT', 'dmx-retail': 'DMX',
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
      return '<i style="left:' + (p.c / 12 * 100).toFixed(3) + '%;top:' + (p.r / H * 100).toFixed(3)
        + '%;width:' + (p.w / 12 * 100).toFixed(3) + '%;height:' + (p.h / H * 100).toFixed(3)
        + '%;--tc:' + col + '"' + (def ? ' title="' + esc(def.name) + '"' : '') + '>'
        + (lbl ? '<b>' + esc(lbl) + '</b>' : '') + '</i>';
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
    // Miniature d'un layout — exposée pour que l'ACCUEIL (home.js) rende la même vignette que le
    // gestionnaire : un seul moteur, donc zéro divergence visuelle entre les deux écrans.
    thumb: function (items, opts) { try { return _thumb(items, opts); } catch (e) { return ''; } },
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
    exit: function () { if (typeof activateView === 'function') activateView('news'); }, // « ‹ Retour au desk » (la nav est masquée en mode Mon Desk)
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
    renameTab: function (i, j, v) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (!Array.isArray(it.tabs) || !it.tabs[j]) return;
      var w2 = byId(it.tabs[j]);
      var lb = Array.isArray(it.tabLabels) ? it.tabLabels.slice() : [];
      var v2 = String(v || '').trim().slice(0, 18);
      // Nom par défaut : tag du widget — ou « Vide » pour un onglet sans widget (renommable aussi).
      var def = w2 ? (w2.tag || w2.name) : 'Vide';
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
    removeTab: function (i, j) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (!Array.isArray(it.tabs) || j >= it.tabs.length) return;
      // PLANCHER 1 ONGLET (demande user 03/08) : garde serveur du geste — même si un vieux volet
      // affiche encore un ×, le dernier onglet d'un panneau ne part jamais.
      if (it.tabs.length <= 1) { _syncPanel(i); return; }
      var w2 = byId(it.tabs[j]);
      var snapTabs = it.tabs.slice(), snapLb = Array.isArray(it.tabLabels) ? it.tabLabels.slice() : [];
      it.tabs.splice(j, 1);
      if (Array.isArray(it.tabLabels)) it.tabLabels.splice(j, 1);
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
        itRef.tabs = snapTabs.slice(); itRef.tabLabels = snapLb.slice();
        save();
        var cur = activeLayout(); var idx = cur && cur.items ? cur.items.indexOf(itRef) : -1;
        if (idx >= 0) { _syncPanel(idx); API.refresh(idx); }   // visible seulement si la carte est sur le desk actif
      });
    },
    addTab: function (i) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      _pickTabFor(l.items[i]);
    },
    // RÉGLAGES PROPRES À L'ONGLET AFFICHÉ (04/08) — miroir de setOpt/bumpOpt, mais la valeur est
    // écrite dans it.tabCfg[index] (whitelisté serveur) au lieu du cfg de la carte.
    setTabOpt: function (i, k, v) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (it.w !== 'onglets' || !Array.isArray(it.tabs) || !it.tabs.length) return;
      var j = Math.min(it._tabAct | 0, it.tabs.length - 1);
      var w = byId(it.tabs[j]), d = optDef(w, k); if (!d) return;
      if (!it.tabCfg) it.tabCfg = {};
      var cfg = it.tabCfg[j] || (it.tabCfg[j] = {});
      if (d.type === 'nombre') v = _clamp(parseInt(v, 10) || d.def, d.min, d.max);
      if (v === d.def) delete cfg[k]; else cfg[k] = v;
      if (!Object.keys(cfg).length) delete it.tabCfg[j];
      if (it.tabCfg && !Object.keys(it.tabCfg).length) delete it.tabCfg;
      save(); _syncPanel(i); API.refresh(i);
    },
    bumpTabOpt: function (i, k, d) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (it.w !== 'onglets' || !Array.isArray(it.tabs) || !it.tabs.length) return;
      var j = Math.min(it._tabAct | 0, it.tabs.length - 1);
      var w = byId(it.tabs[j]), def = optDef(w, k); if (!def || def.type !== 'nombre') return;
      var cur = opt(_tabItem(it, j), w, k);
      API.setTabOpt(i, k, _clamp((cur | 0) + (d | 0) * (def.pas || 1), def.min, def.max));
    },
    // « − » de l'en-tête du panneau à onglets (03/08, précision user « juste le widget, pas
    // l'onglet ») : VIDE l'onglet affiché — le widget s'en va, l'onglet reste (nom conservé) et
    // son corps propose « + Choisir un widget ». L'onglet entier, lui, se retire depuis les
    // Réglages (×). Index actif lu au clic (volatile it._tabAct) ; annulable 7 s.
    removeActiveTab: function (i) {
      var l = activeLayout(); if (!l || !l.items[i]) return;
      var it = l.items[i]; if (it.w !== 'onglets' || !Array.isArray(it.tabs) || !it.tabs.length) return;
      var j = Math.min(it._tabAct | 0, it.tabs.length - 1);
      var prev = it.tabs[j];
      if (prev === 'vide') return;                           // déjà vide → rien à retirer
      var w2 = byId(prev);
      it.tabs[j] = 'vide';
      save(); _syncPanel(i); API.refresh(i);
      // Annulation PAR RÉFÉRENCE (même règle que removeTab) : l'objet survit aux déplacements.
      var itRef = it;
      _undoOffer((w2 ? w2.name : 'Widget') + ' retiré — l\'onglet reste', function () {
        if (!itRef || itRef.w !== 'onglets' || !Array.isArray(itRef.tabs)) return;
        if (itRef.tabs[j] === 'vide') itRef.tabs[j] = prev;
        save();
        var cur = activeLayout(); var idx = cur && cur.items ? cur.items.indexOf(itRef) : -1;
        if (idx >= 0) { _syncPanel(idx); API.refresh(idx); }
      });
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
      _closePops(); _pickIdx = null; _pickTab = null; _pickTabAt = null; _pickSwap = i;
      API.openLib();
    },
    toggleInfo: function (i) { _togglePop(i, 'i'); },
    toggleSettings: function (i) { _togglePop(i, 's'); },
    add: function (wid) {
      var l = activeLayout(), w = byId(wid); if (!l || !w) return;
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
      if (_pickTab != null && l.items[_pickTab] && l.items[_pickTab].w === 'onglets') {
        // Ajout d'un ONGLET dans un Panneau à onglets (jamais un panneau dans lui-même).
        if (wid !== 'onglets') {
          var pt = l.items[_pickTab];
          if (_pickTabAt != null && Array.isArray(pt.tabs) && pt.tabs[_pickTabAt] === 'vide') {
            // REMPLISSAGE d'un onglet vide (03/08) : le widget prend SA place, nom conservé.
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
      d.classList.add('open'); _libQ = ''; _pickIdx = null; _pickTab = null;
      var s = document.getElementById('wdg-lib-search'); if (s) { s.value = ''; setTimeout(function () { s.focus(); }, 60); }
      _syncDensity();                                           // le réglage d'espacement vit ICI (barre épurée)
      API.filterFam('');                                        // repart sur « Tous » (chips + rendu)
    },
    closeLib: function () {
      _pickSwap = null; var d = document.getElementById('wdg-lib'); if (d) d.classList.remove('open'); _pickIdx = null; _pickTab = null; },
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
                var tabs = it.tabs.filter(function (t) { return typeof t === 'string' && byId(t); }).slice(0, 8);
                if (tabs.length) {
                  o.tabs = tabs;
                  if (Array.isArray(it.tabLabels)) {
                    var tl = it.tabLabels.slice(0, tabs.length).map(function (s) { return typeof s === 'string' ? s.replace(/[<>]/g, '').trim().slice(0, 18) : ''; });
                    if (tl.some(Boolean)) o.tabLabels = tl;
                  }
                }
              }
              if (it.cfg && typeof it.cfg === 'object' && !Array.isArray(it.cfg)) {
                var cfg = {}, w0 = byId(it.w);
                Object.keys(it.cfg).slice(0, 12).forEach(function (k) {
                  if (!/^[a-z0-9_]{1,24}$/.test(k) || !optDef(w0, k)) return;   // clé inconnue du contrat → ignorée
                  var v = it.cfg[k];
                  if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') cfg[k] = v;
                });
                if (Object.keys(cfg).length) o.cfg = cfg;
              }
              return o;
            });
            c.layouts.push({ id: 'lay-' + uid(), name: String(l.name || '').replace(/[<>"']/g, '').trim().slice(0, 40) || 'Importé', fav: false, items: items });
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
    newLayout: function () {
      var c = STATE.cfg; if (!c || c.layouts.length >= _LMAX) return;
      _dispoTarget = 'new'; _mgrMode = 'dispo';
      API.openManager();
    },
    pickDispo: function () {                            // écran guidé (desk vide) : la disposition remplit CE desk
      _dispoTarget = 'current'; _mgrMode = 'dispo';
      API.openManager();
    },
    backManager: function () { _mgrMode = null; renderManager(); },
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
        _dispoTarget = 'new';
        var l = activeLayout();
        if (!l || l.items.length) { API.closeManager(); return; }
        l.items = slots;
        save(); API.closeManager(); renderGrid();
        return;
      }
      if (c.layouts.length >= _LMAX) return;
      // Nom saisi à l'étape de création (parcours ordonné : nom → disposition → widgets) ; sinon édition inline.
      var nm = String((document.getElementById('wdg-newname') || {}).value || '').replace(/[<>]/g, '').trim().slice(0, 40);
      var id = 'lay-' + uid();
      c.layouts.push({ id: id, name: nm || 'Nouveau layout', fav: false, items: slots });
      c.active = id; save(); API.closeManager(); renderBar(); renderGrid();
      if (!nm) setTimeout(function () { editTab(id); }, 60);   // pas de nom fourni → l'onglet passe en édition
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
      // SAUVEGARDE PAR COMPTE (demande user « récupérable si un souci s'impose ») : affiche la date du
      // snapshot serveur + bouton Restaurer (réversible : la config courante devient la sauvegarde).
      var slot = document.getElementById('wdg-mgr-bak');
      if (!slot) { slot = document.createElement('div'); slot.id = 'wdg-mgr-bak'; slot.className = 'wdg-mgr-bak'; var foot = d.querySelector('.wdg-mgr-foot'); if (foot) foot.insertBefore(slot, foot.firstChild); }
      slot.innerHTML = '';
      fetch('/api/widgets/backup').then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.at || !slot.isConnected) return;
        var dt = new Date(j.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        slot.innerHTML = '<span class="wdg-mgr-bak-lbl">Sauvegarde auto du ' + esc(dt) + '</span>'
          + '<button class="wdg-btn" onclick="DTPWidgets.restoreBackup()" title="Revenir à cette sauvegarde (réversible : l\'état actuel devient la sauvegarde)">Restaurer</button>';
      }).catch(function () {});
    },
    restoreBackup: function () {
      fetch('/api/widgets/restore', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok || !j.cfg) return;
        STATE.cfg = j.cfg;
        renderBar(); renderManager(); renderGrid();
        API.openManager();   // rafraîchit la date de sauvegarde (désormais = l'ancien état courant, ré-échangeable)
      }).catch(function () {});
    },
    closeManager: function () { var d = document.getElementById('wdg-mgr'); if (d) d.classList.remove('open'); _mgrMode = null; _dispoTarget = 'new'; },
    editTab: editTab,                                     // double-clic sur un onglet → renommage inline

    // Densité de la grille : 'loose' = espacés (défaut) / 'tight' = collés. Persistée dans le cfg KV (par compte).
    setGap: function (m) {
      var c = STATE.cfg; if (!c) return;
      c.gap = (m === 'tight' ? 'tight' : 'loose');
      save(); renderGrid();
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
  window.DTPWidgets = API;

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
    if (mgr && mgr.classList.contains('open')) { if (_mgrMode === 'dispo') API.backManager(); else API.closeManager(); return; }
    if (_fullscreenIdx != null) API.fullscreen(_fullscreenIdx);
  });

  // RÉORDONNER SES LAYOUTS au glisser-déposer (poignée ⠿ des lignes du gestionnaire, façon terminal pro).
  // Délégation sur #wdg-mgr-list (statique) → câblé UNE fois ; l'ordre des onglets de la barre suit.
  function _wireMgr() {
    var list = document.getElementById('wdg-mgr-list');
    if (!list || list._wdgWired) return; list._wdgWired = true;
    var from = null;
    var clear = function () { list.querySelectorAll('.wdg-drop-before,.wdg-drop-after').forEach(function (r) { r.classList.remove('wdg-drop-before', 'wdg-drop-after'); }); };
    list.addEventListener('dragstart', function (e) {
      var grip = e.target.closest && e.target.closest('.wdg-mgr-grip');
      var row = grip && grip.closest('.wdg-mgr-row');
      if (!row) { if (e.preventDefault) e.preventDefault(); return; }
      from = +row.getAttribute('data-i');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(from)); } catch (_) {}
    });
    list.addEventListener('dragover', function (e) {
      if (from == null) return; e.preventDefault();
      var row = e.target.closest && e.target.closest('.wdg-mgr-row'); clear();
      if (!row || +row.getAttribute('data-i') === from) return;
      var r = row.getBoundingClientRect();
      row.classList.add((e.clientY - r.top) > r.height / 2 ? 'wdg-drop-after' : 'wdg-drop-before');
    });
    list.addEventListener('drop', function (e) {
      if (from == null) return; e.preventDefault();
      var row = e.target.closest && e.target.closest('.wdg-mgr-row');
      if (row) {
        var to = +row.getAttribute('data-i'), r = row.getBoundingClientRect();
        var before = (e.clientY - r.top) > r.height / 2 ? to + 1 : to;
        var c = STATE.cfg;
        var moved = c.layouts.splice(from, 1)[0];
        if (from < before) before--;
        before = Math.max(0, Math.min(c.layouts.length, before));
        c.layouts.splice(before, 0, moved);
        save(); renderBar(); renderManager();
      }
      from = null; clear();
    });
    list.addEventListener('dragend', function () { from = null; clear(); });
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
    icon.title = 'Mon Desk — mes widgets';
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
      if (!dansDesk) { activateView('widgets'); API.openManager(); return; }
      if (!panneauOuvert) { API.openManager(); return; }
      API.closeManager(); activateView('news');
    });
    center.insertBefore(icon, journal);                                      // à GAUCHE de Journal / Calculatrice
    // PRÉCHARGE la config (léger) → hasDefault() connu sans ouvrir Mon Desk (sert au clic sur le LOGO).
    if (!STATE.cfg) load().catch(function () {});
    // LOGO → TEMPLATE PAR DÉFAUT (demande user 23/07) : si un layout ★ existe, cliquer le logo
    // DataTradingPro atterrit sur Mon Desk (open() y applique le ★). Sans ★ : le logo reste inerte.
    var logo = document.querySelector('.logo-text');
    if (logo && !logo._wdgWired) {
      logo._wdgWired = true;
      logo.style.cursor = 'pointer';
      logo.addEventListener('click', function () {
        var hasFav = !!(STATE.cfg && (STATE.cfg.layouts || []).some(function (l) { return l && l.fav; }));
        if (hasFav && typeof activateView === 'function') activateView('widgets');
      });
    }
    // Rechargement ADMIN sur Mon Desk : le boot restore de charts.js l'a neutralisé par sécurité
    // (dtp_active_view='widgets' → 'news', car _pdIsAdmin n'y était pas encore résolu). ICI, boot() ne
    // tourne QUE pour un admin (poll _pdIsAdmin) → on peut rouvrir. La garde d'activateView
    // (view==='widgets' && !_pdIsAdmin) laisse passer puisque _pdIsAdmin est désormais vrai.
    try {
      if (localStorage.getItem('dtp_active_view') === 'widgets' && typeof activateView === 'function') activateView('widgets');
    } catch (e) {}
  }
  // Le flag arrive dans le .then() de /api/auth/me → on sonde jusqu'à ~10 s, puis on renonce (aucun onglet).
  var tries = 0;
  var iv = setInterval(function () {
    if (window._pdIsAdmin) { clearInterval(iv); boot(); }
    else if (++tries > 20) clearInterval(iv);
  }, 500);
})();

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   DTP — ESPACE D'ACCUEIL (« workstation ») · v1 RÉSERVÉE AU COMPTE ADMIN (volrod.dev@gmail.com)
   le temps de finaliser l'idée (demande user 28/07, inspiré des workstations de terminaux premium,
   identité 100 % DTP). À la connexion : salutation, ses desks en cartes (ouvrir/créer), accès
   rapide aux vues, et l'agenda éco du jour. Overlay au-dessus du desk : AUCUNE modification du
   routeur de vues (activateView) → zéro risque de régression pour les autres comptes.
   Affiché une fois par session (sessionStorage, volatil par design).
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var GATE_EMAIL = 'volrod.dev@gmail.com';           // v1 : admin uniquement — élargir ici le jour venu
  var FLAG = 'dtp_home_seen';                       // suffixé par l'ancre de connexion (cf. plus bas)
  var _flagCle = FLAG;                              // clé effective, connue une fois l'auth lue

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function salut() {
    var h = 0; try { h = parseInt(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date()), 10) || 0; } catch (e) {}
    return h < 6 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  }
  function dateFr() {
    try { return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()); } catch (e) { return ''; }
  }

  // Fonctions de nettoyage des widgets montés ici (minuteurs, roots amCharts, carte Leaflet).
  // Sans elles, fermer l'accueil laisserait tourner des widgets invisibles pour toute la session.
  var _menage = [];
  function close() {
    try { sessionStorage.setItem(_flagCle, '1'); } catch (e) {}
    _menage.splice(0).forEach(function (f) { try { f(); } catch (e) {} });
    var el = document.getElementById('dtp-home'); if (el) el.remove();
  }
  // Ouvre un desk précis depuis une carte (Mon Desk + layout choisi), ou une vue du desk classique.
  function openDesk(id) { close(); try { window.DTPWidgets && DTPWidgets.open(); if (id) setTimeout(function () { DTPWidgets.switchLayout(id); }, 60); } catch (e) {} }
  function openView(v) { close(); try { if (typeof activateView === 'function') activateView(v); } catch (e) {} }
  function createDesk() { close(); try { DTPWidgets.open(); setTimeout(function () { DTPWidgets.openManager(); }, 120); } catch (e) {} }

  // CARTES VISUELLES (03/08 « met comme ceci ») : le PLAN du desk (moteur 2D des vignettes) devient
  // le VISAGE de la carte, le nom en Fraunces par-dessus, méta discrète en bas — on reconnaît son
  // desk à sa forme, comme la référence. « + Nouveau desk » remonte dans l'en-tête du bloc.
  function layoutCards(cfg) {
    var lays = (cfg && cfg.layouts || []).filter(function (l) { return l && !l.hidden; }).slice(0, 8);
    return lays.map(function (l, i) {
      var n = (l.items || []).length;
      var mini = '';
      try { mini = (window.DTPWidgets && DTPWidgets.thumb) ? DTPWidgets.thumb(l.items, { labels: true }) : ''; } catch (e) {}
      return '<button class="home-card home-card--visu" style="--i:' + i + '" onclick="DTPHome.openDesk(\'' + esc(l.id) + '\')">'
        + (mini ? '<span class="home-card-face">' + mini + '</span>' : '')
        + '<span class="home-card-fav">' + (l.fav ? '★' : '') + '</span>'
        + '<span class="home-card-nom">' + esc(l.name || 'Desk') + '</span>'
        + '<span class="home-card-meta">' + n + ' widget' + (n > 1 ? 's' : '') + '</span>'
        + '</button>';
    }).join('');
  }
  function nbDesks(cfg) { return (cfg && cfg.layouts || []).filter(function (l) { return l && !l.hidden; }).length; }

  // (La table VUES a été retirée avec « Accès rapide » : la nav du desk est à un clic, et deux de
  //  ses identifiants étaient morts — le desk attend « analyst » et « bank », pas « analystes »
  //  et « banques ».)

  /* ── ÉTAT DE SÉANCE ────────────────────────────────────────────────────────────────────────────
     MÊME table et MÊME règle que la carte des sessions du desk (app.js, renderSessionMap) : heures
     LOCALES de chaque place, week-end fermé. Dupliquer la règle ferait dire deux choses différentes
     au même produit — si elle bouge là-bas, elle doit bouger ici. */
  var SESSIONS = [
    { n: 'Sydney', o: 9, c: 17, tz: 'Australia/Sydney' },
    { n: 'Tokyo', o: 9, c: 15, tz: 'Asia/Tokyo' },
    { n: 'Londres', o: 8, c: 17, tz: 'Europe/London' },
    { n: 'New York', o: 9, c: 17, tz: 'America/New_York' },
  ];
  function _localHeure(tz) {
    var d = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    return { h: d.getHours() + d.getMinutes() / 60, jour: d.getDay() };
  }
  function _duree(h) {                                  // heures décimales → « 3 h 20 » / « 45 min »
    var m = Math.max(0, Math.round(h * 60));
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  }
  function sessionsHtml() {
    return SESSIONS.map(function (s) {
      var l = _localHeure(s.tz);
      var weekend = l.jour === 0 || l.jour === 6;
      var ouverte = !weekend && l.h >= s.o && l.h < s.c;
      var reste = ouverte ? _duree(s.c - l.h) : (weekend ? null : _duree((l.h < s.o ? s.o - l.h : 24 - l.h + s.o)));
      // JAUGE DE SÉANCE (place ouverte) : part de séance déjà écoulée — un filet de 2 px sous la
      // place, alimenté par le même rafraîchissement 30 s. L'état devient une donnée, pas une légende.
      var pct = ouverte ? Math.max(2, Math.min(100, Math.round(((l.h - s.o) / (s.c - s.o)) * 100))) : 0;
      return '<div class="home-sess' + (ouverte ? ' is-open' : '') + '">'
        + '<span class="home-sess-dot"></span>'
        + '<span class="home-sess-main">'
        +   '<span class="home-sess-lig"><span class="home-sess-n">' + s.n + '</span>'
        +   '<span class="home-sess-t">' + (weekend ? 'week-end' : (ouverte ? 'ferme dans ' : 'ouvre dans ') + '<b class="home-sess-cd">' + reste + '</b>') + '</span></span>'
        +   (ouverte ? '<span class="home-sess-j"><i style="width:' + pct + '%"></i></span>' : '')
        + '</span></div>';
    }).join('');
  }

  /* ── PANNEAUX = LES VRAIS WIDGETS DU DESK ─────────────────────────────────────────────────────
     Montés par DTPWidgets.mountInto : même code, mêmes données, mêmes états de chargement et
     d'erreur que sur le desk. Aucune ré-implémentation à maintenir en parallèle — c'est ce qui
     évite qu'un écran d'accueil finisse par dire autre chose que le desk.
     `cfg` = réglages du contrat déclaratif, choisis pour un écran de PRISE DE POSTE : on veut
     l'essentiel en un coup d'œil, pas l'exhaustivité (le desk est là pour ça). */
  var PANNEAUX = [
    // TITRES = LES NOMS EXACTS DES WIDGETS DU DESK (demande user 03/08 « n'invente pas des titres —
    // ça casse la cohérence ») : mêmes libellés que le catalogue, rien d'inventé, pas de pastille.
    // STRUCTURE calquée sur la référence du user (03/08 « reproduit la même chose, en mieux, identité
    // DTP ») : rangée 1 → héros · Mes desks · CARTE DES SESSIONS (haut droite) ; rangée 2 → Fil ·
    // Force · CALENDRIER (bas droite, sous la carte — la colonne de droite = monde puis agenda).
    { id: 'sessions', titre: 'Sessions de marché', col: 4 },
    { id: 'fil-news', titre: "Fil d'actualité", vue: 'news', col: 4, cfg: { nb: 14 } },
    { id: 'force-devises', titre: 'Force des Devises', vue: 'fxlist', col: 4, cfg: { periodes: 'today' } },
    { id: 'calendrier-jour', titre: 'Calendrier économique', vue: 'calendar', col: 4,
      cfg: { impact: 'high', lignes: 12, passe: '2' } },        // fort impact seulement, un peu de passé pour le contexte
  ];
  // PANNEAU FAÇON DESK : le titre vit DANS le bloc — la barre d'en-tête des panneaux du desk,
  // filet or fuyant, « Ouvrir › » à droite. Rien d'autre : épuré, cohérent.
  function panneau(p) {
    return '<section class="home-zone" style="--c:' + (p.col || 4) + '">'
      + '<div class="home-panel-head">'
      +   '<span class="home-panel-t">' + esc(p.titre) + '</span>'
      +   '<span class="home-panel-fill"></span>'
      +   (p.vue ? '<button class="home-zone-go" onclick="DTPHome.openView(\'' + p.vue + '\')">Ouvrir ›</button>' : '')
      + '</div>'
      + '<div class="home-zone-body" id="home-w-' + p.id + '"></div>'
      + '</section>';
  }

  /* ── TICKER DES DEVISES (nouveauté premium, discret) : les paires de la FX List avec prix et
     variation, en bande fine défilante — mêmes données que l'onglet LISTE FX (/api/fxlist), prix
     rafraîchis au même rythme que le tick du desk (150 s). Contenu doublé pour une boucle sans
     couture ; pause au survol. ── */
  function _tkFmt(px) { return px == null ? '—' : Number(px).toFixed(px >= 40 ? 2 : 4); }
  // Micro-drapeaux RONDS de la paire (base sur quote, chevauchés) — mêmes visuels que le desk
  // (flagcdn + la table _CURR_ISO du calendrier). Sans iso connue : pas d'image, jamais de casse.
  function _tkFlags(b, q) {
    var iso = (typeof _CURR_ISO !== 'undefined') ? _CURR_ISO : {};
    var ib = iso[b], iq = iso[q];
    if (!ib || !iq) return '';
    return '<span class="home-tk-fl"><img src="https://flagcdn.com/w40/' + ib + '.png" alt="" loading="lazy">'
      + '<img src="https://flagcdn.com/w40/' + iq + '.png" alt="" loading="lazy"></span>';
  }
  function tickerItems(pairs) {
    return (pairs || []).filter(function (p) { return p && p.base && p.quote && p.last != null; }).map(function (p) {
      var chg = (typeof p.changePct === 'number') ? p.changePct : null;
      var dir = chg == null ? '' : (chg >= 0 ? ' up' : ' down');
      var chgTxt = chg == null ? '' : ((chg >= 0 ? '+' : '') + chg.toFixed(2) + '%');
      // Le SEGMENT ENTIER porte la teinte directionnelle (voile vert/rouge) — lecture immédiate.
      return '<span class="home-tk' + dir + '">' + _tkFlags(p.base, p.quote)
        + '<b>' + esc(p.base + '/' + p.quote) + '</b>'
        + '<span class="home-tk-px">' + _tkFmt(p.last) + '</span>'
        + (chgTxt ? '<span class="home-tk-chg' + dir + '">' + chgTxt + '</span>' : '') + '</span>';
    }).join('');
  }
  function chargerTicker() {
    var host = document.getElementById('home-ticker-in'); if (!host) return;
    // RÉESSAI TANT QUE LA BANDE N'EST PAS AFFICHÉE (constaté user, deux fois) : premier appel sur
    // cache froid, 503 transitoire, redéploiement… — on retente toutes les 12 s jusqu'à l'affichage,
    // le minuteur meurt avec l'écran. Une fois la bande en place, seul le tick 150 s la rafraîchit.
    var replanifie = function () {
      if (!document.getElementById('home-ticker-in')) return;
      if (host.parentNode.classList.contains('is-on')) return;
      var t = setTimeout(chargerTicker, 12000);
      _menage.push(function () { clearTimeout(t); });
    };
    fetch('/api/fxlist').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      if (!document.getElementById('home-ticker-in')) return;
      var items = tickerItems(d && d.pairs);
      if (!items) return replanifie();
      host.innerHTML = items + items;                    // doublé → la boucle repart sans couture à -50 %
      host.parentNode.classList.add('is-on');
    }).catch(replanifie);
  }

  function build(user, cfg) {
    var prenom = esc((user.name || '').split(' ')[0] || 'trader');
    var el = document.createElement('div');
    el.id = 'dtp-home'; el.className = 'home-overlay';
    el.innerHTML = ''
      + '<div class="home-inner">'
        // TICKER EN BANDEAU DE TERMINAL (03/08 « améliore cette partie ») : pleine largeur, collé sous
        // la topbar, AVANT la rangée héros — c'est la première ligne de l'écran, comme sur un poste.
  +   '<div class="home-ticker" id="home-ticker"><div class="home-ticker-in" id="home-ticker-in"></div></div>'
        // TOUT EN BLOCS (demande user « organise pareil sous forme de bloc ») : le héros lui-même est
        // un bloc de la grille — accueil + sessions + « Accéder au desk » — à côté de « Mes desks »
        // et du Calendrier économique. Rangée 2 : Fil + Radar. Rangée 3 : Force pleine largeur.
  +   '<div class="home-grid">'
  +     '<section class="home-zone home-zone--hero" style="--c:3">'
  +       '<div class="home-zone-body home-hero-body">'
  +         '<div class="home-eyebrow">Espace de travail</div>'
  +         '<div class="home-title">' + salut() + ', <span class="home-name">' + prenom + '</span></div>'
  +         '<div class="home-sub"><span class="home-sub-date">' + esc(dateFr()) + '</span><span class="home-sub-dot">·</span>ton desk est prêt.</div>'
        // (bandeau de sessions retiré du héros : la CARTE DES SESSIONS en haut à droite porte
        //  désormais l'état des places, comme la référence — pas deux fois la même information)
  +         '<button class="home-skip" onclick="DTPHome.close()" title="Passer">Accéder au desk →</button>'
  +       '</div>'
  +     '</section>'
  +     '<section class="home-zone home-zone--desks" style="--c:5">'
  +       '<div class="home-panel-head"><span class="home-panel-t">Mes desks</span>'
  +         '<button class="home-desks-new" onclick="DTPHome.createDesk()">+ Nouveau desk</button>'
  +         '<span class="home-panel-fill"></span>'
  +         '<span class="home-desks-count">' + nbDesks(cfg) + ' au total</span></div>'
  +       '<div class="home-zone-body home-zone-body--cards"><div class="home-cards">' + layoutCards(cfg) + '</div></div>'
  +     '</section>'
  +     PANNEAUX.map(panneau).join('')
  +   '</div>'
  + '</div>';
    document.body.appendChild(el);

    // Ticker : premier chargement + prix au rythme du tick desk (150 s), minuteur tué avec l'écran.
    chargerTicker();
    var tkIv = setInterval(chargerTicker, 150000);
    _menage.push(function () { clearInterval(tkIv); });

    // Les sessions avancent : on les rafraîchit tant que l'écran est là (le minuteur meurt avec lui).
    var iv = setInterval(function () {
      var st = document.getElementById('home-strip');
      if (!st) { clearInterval(iv); return; }
      st.innerHTML = sessionsHtml();
    }, 30000);
    _menage.push(function () { clearInterval(iv); });

    // MONTAGE DES VRAIS WIDGETS.
    // Deux conditions, apprises à la mesure : (1) DTPWidgets doit exister — widgets.js est un script
    // DIFFÉRÉ, il peut s'exécuter APRÈS cet écran (construit dès la réponse de deux fetch souvent en
    // cache) ; une simple garde `window.DTPWidgets && …` sautait alors le montage EN SILENCE, d'où
    // quatre cadres vides. (2) Le conteneur doit être MIS EN PAGE : amCharts et Leaflet mesurent 0×0
    // dans un cadre pas encore posé et rendraient une carte blanche — d'où les deux frames d'attente.
    var _monte = false;
    // MONTAGE ÉTALÉ. Ces quatre panneaux sont lourds (carte Leaflet, graphes amCharts, table du
    // calendrier) : les monter dans la MÊME tâche, par-dessus le démarrage du desk, sature le fil
    // principal — et un fil bloqué fige tout, y compris le voile d'initialisation. Un widget toutes
    // les 120 ms rend la main entre chaque : le navigateur peut peindre et répondre.
    function monterTout() {
      if (_monte) return; _monte = true;
      PANNEAUX.forEach(function (p, i) {
        var t = setTimeout(function () {
          var host = document.getElementById('home-w-' + p.id); if (!host) return;
          try { var un = DTPWidgets.mountInto(p.id, host, p.cfg); if (un) _menage.push(un); } catch (e) {}
        }, i * 120);
        _menage.push(function () { clearTimeout(t); });   // fermeture avant la fin : rien ne se monte après
      });
    }
    (function attendre(essais) {
      if (!window.DTPWidgets || !DTPWidgets.mountInto) {
        if (essais > 60) return;                                  // ~6 s : le module ne viendra plus
        return setTimeout(function () { attendre(essais + 1); }, 100);
      }
      // On ne monte RIEN tant que le voile d'initialisation est là. Le desk doit d'abord finir de
      // démarrer et de peindre : lui superposer quatre widgets lourds prolongeait le voile, et un
      // fil principal saturé fige jusqu'à l'animation du spinner (c'est ce qu'on voyait).
      if (document.getElementById('boot-loader') && essais < 100) {
        return setTimeout(function () { attendre(essais + 1); }, 100);
      }
      // On PRÉFÈRE deux frames (le cadre est alors mis en page, amCharts et Leaflet se mesurent
      // correctement), mais on ne s'y FIE PAS : requestAnimationFrame ne se déclenche JAMAIS dans un
      // onglet en arrière-plan. Sans ce repli, ouvrir le desk dans un onglet non actif laissait les
      // quatre panneaux vides jusqu'à ce qu'on y revienne — défaut trouvé à la mesure, pas supposé.
      requestAnimationFrame(function () { requestAnimationFrame(monterTout); });
      setTimeout(monterTout, 300);
    })(0);
  }

  window.DTPHome = { close: close, openDesk: openDesk, openView: openView, createDesk: createDesk };

  // Démarrage : à CHAQUE CONNEXION (et non une fois par session de navigateur — dans un onglet
  // laissé ouvert, sessionStorage survit à une déconnexion/reconnexion, et l'accueil ne revenait
  // jamais). La clé du marqueur porte l'ancre de connexion renvoyée par /api/auth/me : nouvelle
  // connexion → nouvelle clé → l'accueil s'affiche. Rechargement de page → même clé → « Accéder au
  // desk » reste respecté.
  fetch('/api/auth/me').then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.loggedIn || !d.user) return;
    _flagCle = FLAG + ':' + (d.loginAt || 0);
    try { if (sessionStorage.getItem(_flagCle)) return; } catch (e) {}
    // Ménage : on ne garde que le marqueur de la connexion courante (sinon la liste enfle).
    try {
      for (var i = sessionStorage.length - 1; i >= 0; i--) {
        var k = sessionStorage.key(i);
        if (k && k.indexOf(FLAG) === 0 && k !== _flagCle) sessionStorage.removeItem(k);
      }
    } catch (e) {}
    if (String(d.user.email || '').toLowerCase() !== GATE_EMAIL) return;   // v1 : admin seulement
    fetch('/api/widgets').then(function (r) { return r.json(); }).then(function (j) {
      build(d.user, (j && j.cfg) || { layouts: [] });
    }).catch(function () { build(d.user, { layouts: [] }); });
  }).catch(function () {});
})();

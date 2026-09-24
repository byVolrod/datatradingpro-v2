/* ═══ DTP V2 · L'APP MOBILE (comptes admin, interrupteur « Aperçu V2 ») ═══════════════════════════
   Demande user (24/09) : « je veux une app mobile, vraiment, pas une web app — mais en version web
   d'abord, avant de basculer vers la création de l'app ». Donc : l'ERGONOMIE d'une app native
   (en-tête d'écran, barre d'onglets en bas, feuille « Plus », transitions), posée AU-DESSUS du desk
   existant, qui reste intact dessous. Chaque onglet ouvre une vue EXISTANTE par `activateView` :
   aucune donnée, aucun chargeur, aucune vue n'est recréée. Structure inspirée des captures de
   référence (5 onglets, en-tête titre + « en direct », IA · alertes · compte en haut à droite),
   habillage 100% DTP (or, Fraunces, français).
   ⚠️ LE DESK DESSOUS NE DOIT RIEN SAVOIR DE CE FICHIER. Tout passe par des fonctions déjà publiques
   (activateView, npToggle, pdToggle, le bouton #ai-btn) et par une classe sur <html> (`dtp-app`)
   que seule la feuille css/v2/app.css lit. Retirer ce fichier = le desk exact d'avant.
   Actif seulement en largeur de téléphone ; au-delà (rotation, fenêtre élargie) il s'efface. */
(function () {
  'use strict';
  if (window._dtpV2App) return;
  window._dtpV2App = true;

  var MQ = window.matchMedia('(max-width: 820px)');
  var H = document.documentElement;

  // ── Les écrans : les 4 premiers sont des onglets, le reste vit dans la feuille « Plus » ──
  var ONGLETS = [
    { v: 'news',     t: 'Fil',        titre: 'Fil d’actualité', ico: 'M4 5h16M4 10h16M4 15h10M4 20h7' },
    { v: 'calendar', t: 'Calendrier', titre: 'Calendrier',           ico: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M9 3v4M15 3v4' },
    { v: 'markets',  t: 'Marchés',    titre: 'Marchés',              ico: 'M4 19V11M9 19V5M14 19v-6M19 19V8' },
    { v: 'analyst',  t: 'Analyses',   titre: 'Analyses',             ico: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6' },
  ];
  var PLUS = [
    { v: 'institution', t: 'Banques',          ico: 'M3 10l9-6 9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18' },
    { v: 'taux',        t: 'Taux',             ico: 'M5 19L19 5M7 7h.01M17 17h.01' },
    { v: 'bias',        t: 'Radar de Biais',   ico: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l7-7' },
    { v: 'weekahead',   t: 'Semaine à venir',  ico: 'M5 5h14v14H5zM5 9h14M9 13h2M13 13h2M9 16h2' },
    { v: 'fxlist',      t: 'Liste FX',         ico: 'M4 6h16M4 12h16M4 18h16M8 3v18' },
    { v: 'bank',        t: 'Positions banques', ico: 'M4 18l5-6 4 3 7-9M20 6v5M20 6h-5' },
    { v: 'journal',     t: 'Journal',          ico: 'M6 3h11a2 2 0 0 1 2 2v16l-4-2-4 2-4-2-3 2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6' },
    { v: 'calculator',  t: 'Calculatrice',     ico: 'M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01' },
    { v: 'widgets',     t: 'Mon Desk',         ico: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z' },
  ];
  var TITRES = {};
  ONGLETS.forEach(function (o) { TITRES[o.v] = o.titre; });
  PLUS.forEach(function (o) { TITRES[o.v] = o.t; });
  TITRES.symbol = 'Paire'; TITRES.widgets = 'Mon Desk';

  var svg = function (d, w) {
    return '<svg viewBox="0 0 24 24" width="' + (w || 22) + '" height="' + (w || 22) + '" fill="none" stroke="currentColor" '
      + 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  };
  var existe = function (v) { return v === 'markets' || !!document.getElementById('view-' + v); };
  var vibre = function () { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {} };

  // ── Construction (une seule fois) ──
  var tete, barre, feuille, voile, courant = '';
  function construire() {
    if (tete) return;
    tete = document.createElement('header');
    tete.className = 'v2a-tete';
    tete.innerHTML = '<div class="v2a-titre-bloc"><h1 class="v2a-titre" id="v2a-titre">Fil d’actualité</h1>'
      + '<span class="v2a-direct"><i></i>En direct</span></div>'
      + '<div class="v2a-actions">'
      + '<button type="button" class="v2a-bt v2a-ia" id="v2a-ia" aria-label="Copilote IA"><span class="v2a-ia-txt">IA</span></button>'
      + '<button type="button" class="v2a-bt" id="v2a-alertes" aria-label="Alertes">' + svg('M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15zM10 21h4', 20) + '<b class="v2a-point" id="v2a-point"></b></button>'
      + '<button type="button" class="v2a-bt v2a-compte" id="v2a-compte" aria-label="Mon compte"></button>'
      + '</div>';
    document.body.insertBefore(tete, document.body.firstChild);

    barre = document.createElement('nav');
    barre.className = 'v2a-barre';
    barre.setAttribute('aria-label', 'Navigation');
    barre.innerHTML = ONGLETS.filter(function (o) { return existe(o.v); }).map(function (o) {
      return '<button type="button" class="v2a-onglet" data-v2v="' + o.v + '">' + svg(o.ico) + '<span>' + o.t + '</span></button>';
    }).join('') + '<button type="button" class="v2a-onglet" data-v2v="plus">' + svg('M5 12h.01M12 12h.01M19 12h.01', 22) + '<span>Plus</span></button>';
    document.body.appendChild(barre);

    voile = document.createElement('div');
    voile.className = 'v2a-voile';
    feuille = document.createElement('div');
    feuille.className = 'v2a-feuille';
    feuille.setAttribute('role', 'dialog');
    feuille.setAttribute('aria-label', 'Plus');
    feuille.innerHTML = '<div class="v2a-poignee"></div><div class="v2a-feuille-titre">Tous les outils</div><div class="v2a-grille">'
      + PLUS.filter(function (o) { return existe(o.v); }).map(function (o) {
        return '<button type="button" class="v2a-tuile" data-v2v="' + o.v + '">' + svg(o.ico, 24) + '<span>' + o.t + '</span></button>';
      }).join('') + '</div>';
    document.body.appendChild(voile);
    document.body.appendChild(feuille);

    // ── Événements ──
    barre.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v2v]'); if (!b) return;
      vibre();
      if (b.dataset.v2v === 'plus') { ouvrirPlus(!feuille.classList.contains('v2a-ouverte')); return; }
      ouvrirPlus(false);
      aller(b.dataset.v2v);
    });
    feuille.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v2v]'); if (!b) return;
      if (b.dataset.v2v === 'widgets') window._v2aDeskDemande = true;
      vibre(); ouvrirPlus(false); aller(b.dataset.v2v);
    });
    voile.addEventListener('click', function () { ouvrirPlus(false); });
    // Glisser la feuille vers le bas la referme (geste natif attendu).
    var y0 = null;
    feuille.addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    feuille.addEventListener('touchmove', function (e) {
      if (y0 == null) return; var d = e.touches[0].clientY - y0;
      if (d > 0) feuille.style.transform = 'translateY(' + d + 'px)';
    }, { passive: true });
    feuille.addEventListener('touchend', function (e) {
      if (y0 == null) return; var d = (e.changedTouches[0].clientY - y0); y0 = null;
      feuille.style.transform = '';
      if (d > 70) ouvrirPlus(false);
    });
    document.getElementById('v2a-ia').addEventListener('click', function () { vibre(); var b = document.getElementById('ai-btn'); if (b) b.click(); });
    document.getElementById('v2a-alertes').addEventListener('click', function () { vibre(); if (typeof window.npToggle === 'function') window.npToggle(); });
    document.getElementById('v2a-compte').addEventListener('click', function () { vibre(); if (typeof window.pdToggle === 'function') window.pdToggle(); });

    // Le point d'alerte et l'avatar SUIVENT ceux du desk (même source, aucun second calcul).
    var badge = document.getElementById('notif-badge');
    var point = document.getElementById('v2a-point');
    var syncPoint = function () { if (badge && point) point.classList.toggle('v2a-on', badge.style.display !== 'none'); };
    if (badge) new MutationObserver(syncPoint).observe(badge, { attributes: true, attributeFilter: ['style', 'class'] });
    syncPoint();
    var av = document.getElementById('topbar-avatar');
    var cpt = document.getElementById('v2a-compte');
    var syncAv = function () { if (av && cpt) cpt.innerHTML = av.innerHTML; };
    if (av) new MutationObserver(syncAv).observe(av, { childList: true, subtree: true, attributes: true, characterData: true });
    syncAv();
  }

  function ouvrirPlus(on) {
    if (!feuille) return;
    feuille.classList.toggle('v2a-ouverte', !!on);
    voile.classList.toggle('v2a-ouverte', !!on);
    var bp = barre.querySelector('[data-v2v="plus"]');
    if (bp) bp.classList.toggle('v2a-actif', !!on || (courant && !ONGLETS.some(function (o) { return o.v === courant; })));
  }

  function marquer(v) {
    courant = v;
    var t = document.getElementById('v2a-titre');
    if (t) t.textContent = TITRES[v] || 'DataTradingPro';
    if (!barre) return;
    var dansOnglets = ONGLETS.some(function (o) { return o.v === v; });
    barre.querySelectorAll('.v2a-onglet').forEach(function (b) {
      b.classList.toggle('v2a-actif', b.dataset.v2v === v || (b.dataset.v2v === 'plus' && !dansOnglets));
    });
  }

  function aller(v) {
    if (v === 'markets') { ecranMarches(true); marquer('markets'); return; }
    if (typeof window.activateView !== 'function') return;
    window.activateView(v);
    // Transition d'écran : courte, et seulement sur ce qui vient d'apparaître.
    var p = v === 'markets' ? document.getElementById('panel-right') : document.getElementById('view-' + v);
    if (p) { p.classList.remove('v2a-entre'); void p.offsetWidth; p.classList.add('v2a-entre'); }
    marquer(v);
  }

  // Toute navigation faite AILLEURS (ouverture d'une paire, lien d'une alerte…) resynchronise la barre.
  var origine = window.activateView;
  if (typeof origine === 'function' && !origine._v2) {
    var enveloppe = function (v, o) {
      /* Mon Desk se rouvre tout seul au démarrage d'un admin (widgets.js, mesuré au banc ~1,2 s après
         le chargement) : c'est une composition de GRAND écran. Dans l'app, seule la tuile « Mon Desk »
         de la feuille « Plus » l'ouvre ; toute autre ouverture automatique retombe sur le Fil. */
      if (v === 'widgets' && H.classList.contains('dtp-app') && !window._v2aDeskDemande) {
        arguments[0] = v = 'news';
      }
      window._v2aDeskDemande = false;
      try { ecranMarches(false); } catch (e) {}
      var r = origine.apply(this, arguments); try { marquer(v); } catch (e) {} return r;
    };
    enveloppe._v2 = true;
    window.activateView = enveloppe;
  }

  /* ══ ÉCRAN « MARCHÉS » : RÉGIME DE RISQUE + FORCE DES DEVISES (structure des captures de référence) ══
     Deux blocs, lisibles d'un coup d'œil sur un téléphone, et RIEN d'inventé :
       · le régime de risque vient de /api/risk-sentiment (la même source que la jauge du desk) ; le
         décompte « facteurs risk-on / risk-off » compte les actifs de CETTE réponse dont la variation
         va dans le sens du risque (variation × sens de l'actif) ;
       · la force des devises vient de /api/currency-strength, à l'échelle de la courbe du desk
         (même formule que `computeScale` de charts.js, vérifiée au banc) : le chiffre affiché ici
         est celui de la pastille du desk.
     Chaque bloc dit sa source et son heure de mise à jour (traçabilité, priorité de la V2). Le
     « Voir le détail » ouvre la colonne Marchés du desk, intacte. */
  var LIB_RISQUE = { 'STRONG RISK-ON': 'Risk-on marqué', 'RISK-ON': 'Risk-on', 'WEAK RISK-ON': 'Risk-on léger', 'NEUTRAL': 'Neutre',
    'WEAK RISK-OFF': 'Risk-off léger', 'RISK-OFF': 'Risk-off', 'STRONG RISK-OFF': 'Risk-off marqué' };
  var NOMS = { USD: 'Dollar américain', EUR: 'Euro', JPY: 'Yen japonais', GBP: 'Livre sterling', AUD: 'Dollar australien',
    CHF: 'Franc suisse', CAD: 'Dollar canadien', NZD: 'Dollar néo-zélandais' };
  var PAYS = { USD: 'us', EUR: 'eu', JPY: 'jp', GBP: 'gb', AUD: 'au', CHF: 'ch', CAD: 'ca', NZD: 'nz' };
  var UT = [['today', 'TD'], ['week', 'TW'], ['8h', '8H'], ['1d', '1D'], ['7d', '7D'], ['1m', '1M']];
  var ecran = null, periode = 'today', minuterie = null;
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var heure = function (iso) { try { return new Date(iso || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  // Même échelle que la courbe du desk : charts.js › computeScale (banc v2-verif : résultats identiques).
  function echelle(d) {
    var BASE = 100, abs = [];
    (d.currencies || []).forEach(function (c) { (d.series[c] || []).forEach(function (x) { if (x.v != null) abs.push(Math.abs(x.v)); }); });
    abs.sort(function (a, b) { return a - b; });
    var ref = abs.length > 10 ? abs[Math.floor(abs.length * 0.99)] : (abs[abs.length - 1] || 0.01);
    var refMax = ref * BASE, CAP = 70;
    return refMax > CAP ? (BASE * CAP / refMax) : BASE;
  }
  window._v2aEchelle = echelle;

  function ecranMarches(on) {
    if (!on) { if (ecran) ecran.classList.remove('v2a-visible'); if (minuterie) { clearInterval(minuterie); minuterie = null; } return; }
    if (!ecran) {
      ecran = document.createElement('section');
      ecran.className = 'v2a-ecran';
      ecran.setAttribute('aria-label', 'Marchés');
      ecran.innerHTML = '<div class="v2a-carte" id="v2a-risque"><div class="v2a-carte-titre">Régime de risque</div><div class="v2a-attente">Chargement…</div></div>'
        + '<div class="v2a-carte"><div class="v2a-carte-tete"><div class="v2a-carte-titre">Force des devises</div>'
        + '<div class="v2a-ut">' + UT.map(function (u) { return '<button type="button" data-ut="' + u[0] + '"' + (u[0] === periode ? ' class="v2a-ut-on"' : '') + '>' + u[1] + '</button>'; }).join('') + '</div></div>'
        + '<div id="v2a-force"><div class="v2a-attente">Chargement…</div></div></div>'
        + '<button type="button" class="v2a-lien" id="v2a-detail">Voir le détail : horloges, COT, DMX, saisonnalité ›</button>';
      document.body.appendChild(ecran);
      ecran.querySelector('.v2a-ut').addEventListener('click', function (e) {
        var b = e.target.closest('[data-ut]'); if (!b) return;
        vibre(); periode = b.dataset.ut;
        ecran.querySelectorAll('.v2a-ut button').forEach(function (x) { x.classList.toggle('v2a-ut-on', x === b); });
        chargerForce();
      });
      document.getElementById('v2a-detail').addEventListener('click', function () { vibre(); window.activateView('markets'); });
    }
    ecran.classList.add('v2a-visible');
    ecran.classList.remove('v2a-entre'); void ecran.offsetWidth; ecran.classList.add('v2a-entre');
    chargerRisque(); chargerForce();
    if (!minuterie) minuterie = setInterval(function () { if (document.visibilityState === 'visible') { chargerRisque(); chargerForce(); } }, 60000);
  }

  function chargerRisque() {
    fetch('/api/risk-sentiment').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var el = document.getElementById('v2a-risque'); if (!el) return;
      if (!d || !d.label) { el.innerHTML = '<div class="v2a-carte-titre">Régime de risque</div><div class="v2a-attente">Donnée momentanément indisponible.</div>'; return; }
      var on = 0, off = 0;
      (d.assets || []).forEach(function (a) { var s = (+a.chg || 0) * (+a.dir || 0); if (s > 0) on++; else if (s < 0) off++; });
      var ton = /RISK-ON/.test(d.label) ? 'on' : (/RISK-OFF/.test(d.label) ? 'off' : 'neutre');
      var pct = Math.max(-100, Math.min(100, +d.pct || 0));
      el.innerHTML = '<div class="v2a-carte-titre">Régime de risque</div>'
        + '<div class="v2a-risque-ligne"><span class="v2a-risque-lib v2a-' + ton + '">' + esc(LIB_RISQUE[d.label] || d.label) + '</span>'
        + '<span class="v2a-risque-pct">' + (pct > 0 ? '+' : '') + pct.toFixed(1).replace('.', ',') + '%</span></div>'
        + '<div class="v2a-jauge"><i style="left:' + (50 + pct / 2) + '%"></i></div>'
        + '<div class="v2a-risque-cpt"><b class="v2a-on">' + on + '</b> facteurs risk-on · <b class="v2a-off">' + off + '</b> risk-off</div>'
        + (d.description ? '<p class="v2a-risque-txt">' + esc(d.description) + '</p>' : '')
        + '<div class="v2a-source">' + (d.assets || []).length + ' actifs suivis · cotations Yahoo Finance · ' + heure(d.updatedAt) + '</div>';
    }).catch(function () {});
  }

  function chargerForce() {
    var p = periode;
    fetch('/api/currency-strength?period=' + encodeURIComponent(p)).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var el = document.getElementById('v2a-force'); if (!el || p !== periode) return;
      if (!d || !d.series) { el.innerHTML = '<div class="v2a-attente">Donnée momentanément indisponible.</div>'; return; }
      var k = echelle(d);
      var lignes = (d.currencies || []).map(function (c) {
        var s = d.series[c] || [], der = null;
        for (var i = s.length - 1; i >= 0; i--) if (s[i] && s[i].v != null) { der = s[i].v; break; }
        return { c: c, v: der == null ? null : der * k };
      }).filter(function (x) { return x.v != null; }).sort(function (a, b) { return b.v - a.v; });
      var max = Math.max.apply(null, lignes.map(function (x) { return Math.abs(x.v); }).concat([1]));
      el.innerHTML = lignes.map(function (x) {
        var larg = Math.min(50, Math.abs(x.v) / max * 50);
        var sens = x.v >= 0 ? 'pos' : 'neg';
        return '<div class="v2a-force-ligne">'
          + '<img src="https://flagcdn.com/w40/' + PAYS[x.c] + '.png" alt="" loading="lazy">'
          + '<div class="v2a-force-nom"><b>' + x.c + '</b><span>' + (NOMS[x.c] || '') + '</span></div>'
          + '<div class="v2a-force-barre"><i class="v2a-' + sens + '" style="width:' + larg.toFixed(1) + '%;' + (sens === 'pos' ? 'left:50%' : 'right:50%') + '"></i></div>'
          + '<div class="v2a-force-val v2a-' + sens + '">' + (x.v > 0 ? '+' : '') + x.v.toFixed(2).replace('.', ',') + '</div></div>';
      }).join('') + '<div class="v2a-source">Même calcul que la courbe du desk · ' + heure(d.updatedAt) + '</div>';
    }).catch(function () {});
  }

  function vueCourante() {
    if (ecran && ecran.classList.contains('v2a-visible')) return 'markets';
    var ml = document.getElementById('main-layout');
    if (ml && ml.classList.contains('show-right-mobile')) return 'markets';
    var p = document.querySelector('.view-panel:not(.hidden)');
    return p ? p.id.replace(/^view-/, '') : 'news';
  }

  function appliquer() {
    if (MQ.matches) {
      var premiere = !tete;
      construire();
      H.classList.add('dtp-app');
      // Mon Desk est une composition de GRAND écran : l'app s'ouvre sur le Fil (il reste dans « Plus »).
      if (premiere && vueCourante() === 'widgets') aller('news'); else marquer(vueCourante());
      // Les hauteurs du desk dépendent de variables que la feuille V2 vient de changer : on laisse
      // les graphiques se recaler (même mécanique que la rotation d'un téléphone).
      setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }, 60);
    } else {
      H.classList.remove('dtp-app');
      ouvrirPlus(false);
      ecranMarches(false);
      setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }, 60);
    }
  }
  if (MQ.addEventListener) MQ.addEventListener('change', appliquer); else if (MQ.addListener) MQ.addListener(appliquer);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appliquer); else appliquer();
})();

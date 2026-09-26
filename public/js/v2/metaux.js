/* ═══ DTP V3 · WIDGETS DES MÉTAUX (comptes admin, « Aperçu V3 ») ═══════════════════════════════════
   Multi-actifs, étape 5 (26/09), après les indices : un widget propre aux métaux, rangé sous
   « Métaux » par le filtre de marché de la bibliothèque.
   · Ratios des métaux : Or / Argent, Cuivre / Or et Or / Platine, chacun avec son niveau, sa
     variation sur un mois, son rang dans l'année, sa courbe d'un an (survol : date et valeur) et une
     lecture en clair. Ce sont les rapports que les traders de métaux regardent AVANT les prix : ils
     disent si le marché est prudent (or cher face à l'argent), s'il croit à la croissance (cuivre
     qui gagne sur l'or), et quel métal est bon marché face à l'autre.
   Données : /api/v2/ratios-metaux (admin), relue toutes les 10 minutes tant que la carte est
   visible ; chaque attente a sa sortie (message d'indisponibilité, nouvel essai automatique). */
(function () {
  'use strict';
  if (window._v3Metaux) return;
  window._v3Metaux = true;

  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var nf = function (v, d) { return v == null ? '·' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var signe = function (v, d) { return v == null ? '·' : (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), d) + '%'; };

  // Ce que dit chaque ratio, en clair. Seuils : haut ou bas de la fourchette annuelle (rang), ou
  // mouvement franc sur un mois (±2%) pour le cuivre / or, qui se lit en tendance.
  function lecture(r) {
    if (r.k === 'or-argent') return r.rang >= 80 ? 'Haut de sa fourchette annuelle : l’argent est bon marché face à l’or, le marché reste prudent.'
      : r.rang <= 20 ? 'Bas de sa fourchette annuelle : l’argent mène, porté par l’industrie et la spéculation.'
        : 'Milieu de sa fourchette annuelle : ni prudence marquée, ni emballement sur l’argent.';
    if (r.k === 'cuivre-or') return r.m1 == null ? '' : r.m1 > 2 ? 'Le cuivre gagne sur l’or depuis un mois : le marché anticipe plus de croissance.'
      : r.m1 < -2 ? 'L’or gagne sur le cuivre depuis un mois : prudence sur la croissance.'
        : 'Stable sur un mois : pas de signal net sur la croissance.';
    if (r.k === 'or-platine') return r.rang >= 80 ? 'Haut de sa fourchette annuelle : le platine est bon marché face à l’or.'
      : r.rang <= 20 ? 'Bas de sa fourchette annuelle : le platine se renchérit face à l’or.'
        : 'Milieu de sa fourchette annuelle : pas d’écart marqué entre les deux métaux.';
    return '';
  }

  var CSS = ''
    + 'html.dtp-v2 .v3r{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--v3-carte, #0a0a0c);color:var(--v3-texte, #d6d6dc);font:500 11.5px/1.3 "Inter Tight",system-ui,sans-serif;font-variant-numeric:tabular-nums;container-type:inline-size}'
    + 'html.dtp-v2 .v3r-corps{flex:1;min-height:0;overflow-y:auto}'
    + 'html.dtp-v2 .v3r-l{display:grid;grid-template-columns:minmax(96px,1fr) auto minmax(120px,1.6fr);grid-template-areas:"n v c" "lec lec lec";column-gap:14px;row-gap:6px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--v3-ligne, #141417)}'
    + 'html.dtp-v2 .v3r-n{grid-area:n;min-width:0}html.dtp-v2 .v3r-n b{display:block;font:600 13px/1.2 "Inter Tight",system-ui,sans-serif;color:var(--v3-titre, #f2f2f4)}'
    + 'html.dtp-v2 .v3r-n span{font-size:10.5px;color:var(--v3-pale, #6f6f78)}'
    + 'html.dtp-v2 .v3r-v{grid-area:v;text-align:right}html.dtp-v2 .v3r-v strong{display:block;font:700 18px/1 ui-monospace,Menlo,monospace;color:var(--v3-titre, #f2f2f4)}'
    + 'html.dtp-v2 .v3r-v em{font:600 11px/1.4 ui-monospace,Menlo,monospace;font-style:normal;color:var(--v3-texte, #c9c9d1)}html.dtp-v2 .v3r-v small{display:block;font-size:10px;color:var(--v3-pale, #6f6f78)}'
    + 'html.dtp-v2 .v3r-c{grid-area:c;display:flex;flex-direction:column;gap:5px;min-width:0}'
    + 'html.dtp-v2 .v3r-sp{position:relative;height:40px;cursor:crosshair}html.dtp-v2 .v3r-sp svg{position:absolute;left:0;top:0}'
    + 'html.dtp-v2 .v3r-cur{position:absolute;top:0;bottom:0;width:1px;background:rgba(236,236,240,.35);pointer-events:none}'
    + 'html.dtp-v2 .v3r-bul{position:absolute;top:-4px;padding:3px 6px;border-radius:4px;background:#16161a;border:1px solid #24242a;font:500 10.5px/1 "Inter Tight",system-ui,sans-serif;color:#a6a6b0;white-space:nowrap;pointer-events:none;transform:translateY(-100%)}html.dtp-v2 .v3r-bul b{color:#f2f2f4;font-family:ui-monospace,Menlo,monospace}'
    + 'html.dtp-v2 .v3r-rg{display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--v3-doux, #8e8e98)}html.dtp-v2 .v3r-rg div{position:relative;flex:1;height:4px;border-radius:2px;background:var(--v3-trait, #1c1c21)}'
    + 'html.dtp-v2 .v3r-rg i{position:absolute;top:-3px;width:2px;height:10px;border-radius:1px;background:#e3b23a;transform:translateX(-1px)}'
    + 'html.dtp-v2 .v3r-lec{grid-area:lec;margin:0;font-size:11.5px;line-height:1.45;color:var(--v3-doux, #a6a6b0)}'
    + 'html.dtp-v2 .v3r-pied{padding:5px 10px;border-top:1px solid var(--v3-ligne, #16161a);font-size:10.5px;color:var(--v3-pale, #6f6f78)}'
    + 'html.dtp-v2 .v3r-vide{padding:26px 12px;text-align:center;color:var(--v3-pale, #6f6f78);font-size:12px}'
    + '@container (max-width:400px){html.dtp-v2 .v3r-l{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"n v" "c c" "lec lec"}}';
  function styles() { if (document.getElementById('v3r-styles')) return; var s = document.createElement('style'); s.id = 'v3r-styles'; s.textContent = CSS; document.head.appendChild(s); }

  // Courbe d'un an à la taille RÉELLE de son cadre (aucun étirement).
  function courbe(serie, W, H) {
    if (!serie || serie.length < 2) return '';
    W = Math.max(80, Math.round(W)); H = Math.max(24, Math.round(H));
    var vs = serie.map(function (p) { return p[1]; }), mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs), et = (mx - mn) || 1;
    var pts = serie.map(function (p, i) { return (i / (serie.length - 1) * W).toFixed(1) + ',' + (3 + (1 - (p[1] - mn) / et) * (H - 6)).toFixed(1); }).join(' ');
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="#e3b23a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }

  // Le mois écoulé s'affiche en NEUTRE (flèche, pas vert ou rouge) : un ratio qui monte n'est ni un
  // achat ni une vente — un Or / Argent en hausse dit la prudence, pas une bonne nouvelle.
  function monter(host) {
    styles();
    var vivant = true, data = null, ro = null;
    host.innerHTML = '<div class="v3r"><div class="v3r-corps"><div class="v3r-vide">Lecture des ratios des métaux…</div></div><div class="v3r-pied"></div></div>';
    var corps = host.querySelector('.v3r-corps'), pied = host.querySelector('.v3r-pied');
    function tracer() {
      if (!data) return;
      corps.querySelectorAll('.v3r-sp').forEach(function (sp) {
        var r = data.ratios[+sp.getAttribute('data-i')]; if (!r) return;
        var fixe = sp.querySelector('.v3r-cur'), bul = sp.querySelector('.v3r-bul');
        sp.innerHTML = courbe(r.serie, sp.clientWidth, sp.clientHeight);
        sp.appendChild(fixe); sp.appendChild(bul);
      });
    }
    function rendre() {
      if (!data || !data.ratios || !data.ratios.length) { corps.innerHTML = '<div class="v3r-vide">Ratios indisponibles pour le moment : nouvel essai automatique.</div>'; return; }
      corps.innerHTML = data.ratios.map(function (r, i) {
        return '<div class="v3r-l"><div class="v3r-n"><b>' + esc(r.nom) + '</b><span>' + (r.note ? esc(r.note) + ' · ' : '') + 'un an : ' + nf(r.bas, r.dec) + ' – ' + nf(r.haut, r.dec) + '</span></div>'
          + '<div class="v3r-v"><strong>' + nf(r.dernier, r.dec) + '</strong><em>' + (r.m1 > 0 ? '▲ ' : r.m1 < 0 ? '▼ ' : '') + signe(r.m1, 1) + '</em><small>sur un mois</small></div>'
          + '<div class="v3r-c"><div class="v3r-sp" data-i="' + i + '"><i class="v3r-cur" hidden></i><span class="v3r-bul" hidden></span></div>'
          + '<div class="v3r-rg"><span>rang ' + r.rang + '%</span><div><i style="left:' + r.rang + '%"></i></div><span>sur un an</span></div></div>'
          + '<p class="v3r-lec">' + esc(lecture(r)) + '</p></div>';
      }).join('');
      tracer();
      var h = new Date(data.at);
      pied.textContent = 'Contrats à terme (COMEX, NYMEX), clôtures quotidiennes · relu à ' + (h.getHours() < 10 ? '0' : '') + h.getHours() + ':' + (h.getMinutes() < 10 ? '0' : '') + h.getMinutes();
    }
    // Survol d'une courbe : la date et la valeur sous le curseur.
    corps.addEventListener('mousemove', function (ev) {
      var sp = ev.target.closest('.v3r-sp'); if (!sp || !data) return;
      var r = data.ratios[+sp.getAttribute('data-i')]; if (!r || !r.serie || r.serie.length < 2) return;
      var b = sp.getBoundingClientRect(), x = ev.clientX - b.left, i = Math.max(0, Math.min(r.serie.length - 1, Math.round(x / b.width * (r.serie.length - 1))));
      var cur = sp.querySelector('.v3r-cur'), bul = sp.querySelector('.v3r-bul'), px = i / (r.serie.length - 1) * b.width;
      cur.hidden = false; bul.hidden = false; cur.style.left = px + 'px';
      bul.innerHTML = '<b>' + nf(r.serie[i][1], r.dec) + '</b> ' + esc(new Date(r.serie[i][0] + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
      bul.style.left = Math.max(0, Math.min(b.width - bul.offsetWidth, px - bul.offsetWidth / 2)) + 'px';
    });
    corps.addEventListener('mouseleave', function () { corps.querySelectorAll('.v3r-cur,.v3r-bul').forEach(function (x) { x.hidden = true; }); }, true);
    corps.addEventListener('mouseout', function (ev) { var sp = ev.target.closest && ev.target.closest('.v3r-sp'); if (sp && !sp.contains(ev.relatedTarget)) sp.querySelectorAll('.v3r-cur,.v3r-bul').forEach(function (x) { x.hidden = true; }); });
    function charger() {
      if (!vivant || document.visibilityState === 'hidden') return;
      (window.dtpFetchBorne ? window.dtpFetchBorne('/api/v2/ratios-metaux', { credentials: 'same-origin' }, 25000) : fetch('/api/v2/ratios-metaux', { credentials: 'same-origin' }))
        .then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (d) { if (!vivant) return; if (d && d.ratios) data = d; rendre(); });
    }
    charger();
    var t = setInterval(charger, 10 * 60000);
    try { ro = new ResizeObserver(function () { tracer(); }); ro.observe(corps); } catch (e) {}
    return function () { vivant = false; clearInterval(t); if (ro) ro.disconnect(); };
  }
  window._v3Metaux = { lecture: lecture };

  function declarer() {
    if (!window.DTPWidgets || typeof DTPWidgets.enregistrer !== 'function') return false;
    DTPWidgets.enregistrer({
      id: 'v3-ratios', name: 'Ratios des métaux', court: 'Ratios', tag: 'MÉTAUX', cat: 'Marché', h: 360,
      desc: 'Or / Argent, Cuivre / Or, Or / Platine : niveau, mois écoulé, rang dans l’année et lecture.',
      aide: '<p>Trois rapports que les traders de métaux regardent avant les prix. <b>Or / Argent</b> : combien d’onces d’argent valent une once d’or ; un ratio haut dit un marché prudent, un ratio bas un argent qui mène. <b>Cuivre / Or</b> : le baromètre de la croissance, puisque le cuivre suit l’industrie et l’or la prudence. <b>Or / Platine</b> : l’écart entre la valeur refuge et le métal industriel.</p><p>Chaque ligne donne le niveau, la variation sur un mois, le rang du niveau actuel dans les douze derniers mois (100% : au plus haut de l’année) et la courbe d’un an ; le survol affiche la date et la valeur.</p>',
      src: 'Contrats à terme COMEX et NYMEX (or, argent, cuivre, platine), clôtures quotidiennes sur un an alignées sur les séances communes ; ratios et rangs calculés par DTP.',
      watch: 'Un Or / Argent qui sort de sa fourchette annuelle, et un Cuivre / Or qui décroche alors que les taux montent : le marché doute de la croissance.',
      apercu: '<svg viewBox="0 0 120 56" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g font-family="sans-serif" font-size="5.5" fill="#f2f2f4"><text x="4" y="11">Or / Argent</text><text x="4" y="29">Cuivre / Or</text><text x="4" y="47">Or / Platine</text></g>'
        + '<g font-family="monospace" font-size="6.5" font-weight="700" fill="#f2f2f4" text-anchor="end"><text x="62" y="12">84,2</text><text x="62" y="30">1,74</text><text x="62" y="48">2,71</text></g>'
        + '<g fill="none" stroke="#e3b23a" stroke-width="1.1"><path d="M68 12 L76 9 L84 11 L92 7 L100 8 L108 5 L116 6"/><path d="M68 26 L76 28 L84 27 L92 30 L100 29 L108 32 L116 31"/><path d="M68 46 L76 44 L84 45 L92 43 L100 44 L108 42 L116 43"/></g>'
        + '<g fill="#1c1c21"><rect x="68" y="15" width="48" height="1.5" rx=".7"/><rect x="68" y="34" width="48" height="1.5" rx=".7"/><rect x="68" y="51" width="48" height="1.5" rx=".7"/></g>'
        + '<g fill="#e3b23a"><rect x="109" y="13.5" width="1" height="4.5"/><rect x="80" y="32.5" width="1" height="4.5"/><rect x="95" y="49.5" width="1" height="4.5"/></g></svg>',
      opts: [],
      mount: function (host) { return monter(host); },
    });
    return true;
  }
  if (!declarer()) { var n = 0; (function r() { if (declarer() || ++n > 100) return; setTimeout(r, 100); })(); }
})();

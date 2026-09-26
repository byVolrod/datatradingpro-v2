/* ═══ DTP V3 · MULTI-ACTIFS (comptes admin, « Aperçu V3 ») ═══════════════════════════════════════════
   Demande user (24/09) : « prendre en compte les métaux, la crypto… pour les traders qui sont sur
   ces marchés ». Une grille de cotations dense, façon terminal : or, argent, platine, palladium,
   cuivre ; WTI, Brent, gaz ; S&P, Nasdaq, Dow, DAX, CAC, FTSE, Nikkei, Hang Seng ; Bitcoin,
   Ethereum, Solana, XRP ; courbe des taux US, dollar index et VIX.
   Chaque ligne : dernier prix, variation du jour (en points de base pour un rendement), courbe de la
   séance et position du prix dans son range du jour. Données : /api/v2/multi-actifs (admin), relue
   toutes les 90 s tant que la carte est visible. Un instrument muet s'affiche « indisponible » au
   lieu de disparaître : une ligne qui s'évapore passe pour un marché fermé. */
(function () {
  'use strict';
  if (window._v3Multi) return;
  window._v3Multi = true;

  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var nf = function (v, d) { return v == null ? '·' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var CSS = ''
    + 'html.dtp-v2 .v3m{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--v3-carte, #0a0a0c);font-family:"Inter Tight",system-ui,sans-serif}'
    + 'html.dtp-v2 .v3m-bar{display:flex;gap:4px;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--v3-ligne, #16161a);background:var(--v3-carte, #0c0c0e)}'
    + 'html.dtp-v2 .v3m-ch{border:1px solid var(--v3-bord, #24242a);background:transparent;color:var(--v3-doux, #8e8e98);font:500 11.5px/1 "Inter Tight",system-ui,sans-serif;padding:5px 9px;border-radius:4px;cursor:pointer}'
    + 'html.dtp-v2 .v3m-ch:hover{color:var(--v3-titre, #ececf0)}html.dtp-v2 .v3m-ch.on{color:var(--v3-or-texte, #e3b23a);border-color:rgba(227,178,58,.55);background:rgba(227,178,58,.08)}'
    + 'html.dtp-v2 .v3m-liste{flex:1;min-height:0;overflow-y:auto}'
    + 'html.dtp-v2 .v3m-cl{position:sticky;top:0;z-index:1;padding:5px 10px;background:var(--v3-tete, #0e0e11);border-bottom:1px solid var(--v3-ligne, #16161a);font:600 11.5px/1.2 "Inter Tight",system-ui,sans-serif;color:var(--v3-doux, #7c7c86)}'
    + 'html.dtp-v2 .v3m-l{display:grid;grid-template-columns:minmax(92px,1.3fr) 92px minmax(70px,1fr) 70px minmax(64px,.9fr);align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid var(--v3-tete, #121215);transition:background .12s}'
    + 'html.dtp-v2 .v3m-l:hover{background:rgba(227,178,58,.04)}'
    + 'html.dtp-v2 .v3m-n{min-width:0}html.dtp-v2 .v3m-n b{display:block;font:600 12.5px/1.2 "Inter Tight",system-ui,sans-serif;color:var(--v3-titre, #f0f0f3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'html.dtp-v2 .v3m-n span{font:500 10.5px/1.2 ui-monospace,Menlo,monospace;color:var(--v3-pale, #6f6f78)}'
    + 'html.dtp-v2 .v3m-sp{width:92px;height:24px;display:block}'
    + 'html.dtp-v2 .v3m-p{text-align:right;font:600 12.5px/1 ui-monospace,Menlo,monospace;color:var(--v3-titre, #ececf0);font-variant-numeric:tabular-nums}'
    + 'html.dtp-v2 .v3m-c{text-align:right;font:600 12px/1 ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}'
    + 'html.dtp-v2 .v3m-up{color:#00e676}html.dtp-v2 .v3m-dn{color:#ff3d00}html.dtp-v2 .v3m-eq{color:var(--v3-doux, #8e8e98)}'
    + 'html.dtp-v2 .v3m-rg{position:relative;height:4px;border-radius:2px;background:var(--v3-trait, #1c1c21)}'
    + 'html.dtp-v2 .v3m-rg i{position:absolute;top:-3px;width:2px;height:10px;border-radius:1px;background:#e3b23a;transform:translateX(-1px)}'
    + 'html.dtp-v2 .v3m-ko{grid-column:2/-1;color:var(--v3-pale, #6f6f78);font-size:11.5px}'
    + 'html.dtp-v2 .v3m-pied{padding:5px 10px;border-top:1px solid var(--v3-ligne, #16161a);font-size:10.5px;color:var(--v3-pale, #6f6f78);background:var(--v3-carte, #0c0c0e)}'
    + 'html.dtp-v2 .v3m-vide{padding:24px;text-align:center;color:var(--v3-pale, #6f6f78);font-size:12px}'
    + '@container (max-width:520px){html.dtp-v2 .v3m-l{grid-template-columns:minmax(80px,1fr) 70px 64px}html.dtp-v2 .v3m-sp,html.dtp-v2 .v3m-rg{display:none}}';
  function styles() { if (document.getElementById('v3m-styles')) return; var s = document.createElement('style'); s.id = 'v3m-styles'; s.textContent = CSS; document.head.appendChild(s); }

  function courbe(pts, sens) {
    if (!pts || pts.length < 2) return '<svg class="v3m-sp"></svg>';
    var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), W = 92, H = 24, d = '';
    var sy = mx > mn ? (H - 4) / (mx - mn) : 0;
    pts.forEach(function (v, i) { d += (i ? 'L' : 'M') + (i * (W - 2) / (pts.length - 1) + 1).toFixed(1) + ',' + (H - 2 - (v - mn) * sy).toFixed(1); });
    var c = sens > 0 ? '#00e676' : sens < 0 ? '#ff3d00' : '#8e8e98';
    return '<svg class="v3m-sp" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>';
  }
  function ligne(x) {
    if (!x.ok) return '<div class="v3m-l"><div class="v3m-n"><b>' + esc(x.nom) + '</b><span>' + esc(x.code) + '</span></div><div class="v3m-ko">indisponible pour le moment</div></div>';
    var s = x.chg > 0 ? 1 : x.chg < 0 ? -1 : 0, cls = s > 0 ? 'v3m-up' : s < 0 ? 'v3m-dn' : 'v3m-eq';
    var chg = x.rendement ? (x.chg > 0 ? '+' : '') + nf(x.chg, 1) + ' pb' : (x.chg > 0 ? '+' : '') + nf(x.chg, 2) + '%';
    var pos = (x.haut != null && x.bas != null && x.haut > x.bas) ? Math.max(0, Math.min(100, (x.prix - x.bas) / (x.haut - x.bas) * 100)) : 50;
    return '<div class="v3m-l" title="' + esc(x.nom + ' · clôture précédente ' + nf(x.prec, x.dec)) + '">'
      + '<div class="v3m-n"><b>' + esc(x.nom) + '</b><span>' + esc(x.code) + '</span></div>'
      + courbe(x.spark, s)
      + '<div class="v3m-p">' + nf(x.prix, x.dec) + (x.rendement ? '%' : '') + '</div>'
      + '<div class="v3m-c ' + cls + '">' + chg + '</div>'
      + '<div class="v3m-rg" title="Range du jour : ' + esc(nf(x.bas, x.dec) + ' – ' + nf(x.haut, x.dec)) + '"><i style="left:' + pos.toFixed(1) + '%"></i></div>'
      + '</div>';
  }

  function monter(host) {
    styles();
    var etat = { cl: 'tout', data: null, vivant: true };
    host.innerHTML = '<div class="v3m" style="container-type:inline-size"><div class="v3m-bar"></div><div class="v3m-liste"><div class="v3m-vide">Lecture des marchés…</div></div><div class="v3m-pied"></div></div>';
    var bar = host.querySelector('.v3m-bar'), liste = host.querySelector('.v3m-liste'), pied = host.querySelector('.v3m-pied');
    function rendre() {
      var d = etat.data;
      if (!d || !d.classes) return;
      bar.innerHTML = [['tout', 'Tout']].concat(d.classes.map(function (c) { return [c.k, c.n]; }))
        .map(function (c) { return '<button type="button" class="v3m-ch' + (c[0] === etat.cl ? ' on' : '') + '" data-k="' + c[0] + '">' + esc(c[1]) + '</button>'; }).join('');
      liste.innerHTML = d.classes.filter(function (c) { return etat.cl === 'tout' || c.k === etat.cl; })
        .map(function (c) { return '<div class="v3m-cl">' + esc(c.n) + '</div>' + c.items.map(ligne).join(''); }).join('');
      var h = new Date(d.at);
      pied.textContent = 'Cotations différées selon les places · relu à ' + (h.getHours() < 10 ? '0' : '') + h.getHours() + ':' + (h.getMinutes() < 10 ? '0' : '') + h.getMinutes() + ' · rendements en points de base';
    }
    bar.addEventListener('click', function (e) { var b = e.target.closest('[data-k]'); if (!b) return; etat.cl = b.dataset.k; rendre(); });
    function lire() {
      if (!etat.vivant || document.visibilityState === 'hidden') return;
      fetch('/api/v2/multi-actifs', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!etat.vivant) return;
        if (d && d.classes) { etat.data = d; rendre(); }
        else if (!etat.data) liste.innerHTML = '<div class="v3m-vide">Cotations indisponibles pour le moment : nouvel essai automatique.</div>';
      }).catch(function () { if (etat.vivant && !etat.data) liste.innerHTML = '<div class="v3m-vide">Cotations indisponibles pour le moment : nouvel essai automatique.</div>'; });
    }
    lire();
    var t = setInterval(lire, 90000);
    return function () { etat.vivant = false; clearInterval(t); };
  }
  window._v3MultiMonter = monter;

  function declarer() {
    if (!window.DTPWidgets || typeof DTPWidgets.enregistrer !== 'function') return false;
    DTPWidgets.enregistrer({
      id: 'v3-multi', name: 'Multi-actifs', court: 'Actifs', tag: 'MARCHÉS', cat: 'Marché', h: 420,
      desc: 'Métaux, énergie, indices, crypto, taux et volatilité : prix, variation, courbe et range du jour.',
      aide: '<p>Une grille de cotations pour les traders qui ne sont pas que sur le forex : or, argent, platine, palladium et cuivre ; pétrole et gaz ; grands indices ; Bitcoin, Ethereum, Solana et XRP ; courbe des taux américaine, dollar index et VIX.</p><p>Chaque ligne donne le dernier prix, la variation depuis la clôture précédente (en points de base pour un rendement), la courbe de la séance et la position du prix dans son range du jour : un repère collé au plus haut dit un marché qui termine fort.</p>',
      src: 'Contrats à terme pour les matières premières, indices au comptant, paires crypto en dollar, relus toutes les 90 secondes, différées selon les places.',
      watch: 'Or et dollar qui montent ensemble (aversion au risque), cuivre contre or (croissance), et le VIX quand il dépasse 20.',
      // Vignette de la bibliothèque (120×56) : ce que la carte montre vraiment.
      apercu: '<svg viewBox="0 0 120 56" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g font-family="monospace" font-size="6" fill="#9aa1ac"><text x="6" y="12">XAU</text><text x="6" y="25">WTI</text><text x="6" y="38">BTC</text><text x="6" y="51">VIX</text></g>'
        + '<g fill="none" stroke-width="1.3" stroke-linejoin="round"><path d="M26 11 L32 9 L38 10 L44 7 L50 6" stroke="#00e676"/><path d="M26 20 L32 22 L38 21 L44 24 L50 25" stroke="#ff3d00"/><path d="M26 36 L32 34 L38 35 L44 32 L50 31" stroke="#00e676"/><path d="M26 47 L32 49 L38 46 L44 49 L50 50" stroke="#ff3d00"/></g>'
        + '<g font-family="monospace" font-size="6" text-anchor="end"><text x="82" y="12" fill="#e6e8ec">2 355</text><text x="82" y="25" fill="#e6e8ec">71,40</text><text x="82" y="38" fill="#e6e8ec">84 320</text><text x="82" y="51" fill="#e6e8ec">16,2</text>'
        + '<text x="104" y="12" fill="#00e676">+0,8%</text><text x="104" y="25" fill="#ff3d00">-1,2%</text><text x="104" y="38" fill="#00e676">+2,1%</text><text x="104" y="51" fill="#ff3d00">-3,4%</text></g>'
        + '<g fill="#1c1c21"><rect x="106" y="9" width="10" height="2" rx="1"/><rect x="106" y="22" width="10" height="2" rx="1"/><rect x="106" y="35" width="10" height="2" rx="1"/><rect x="106" y="48" width="10" height="2" rx="1"/></g>'
        + '<g fill="#e3b23a"><rect x="114" y="8" width="1.2" height="4"/><rect x="107" y="21" width="1.2" height="4"/><rect x="113" y="34" width="1.2" height="4"/><rect x="108" y="47" width="1.2" height="4"/></g></svg>',
      opts: [],
      mount: function (host) { return monter(host); },
    });
    return true;
  }
  if (!declarer()) { var n = 0; (function r() { if (declarer() || ++n > 100) return; setTimeout(r, 100); })(); }
})();

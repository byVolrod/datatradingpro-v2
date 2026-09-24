/* ═══ DTP V3 · VUE PAIRE EN GRILLE DE PANNEAUX (UX n° 3, comptes admin derrière « Aperçu V2 ») ════════
   Les captures de référence montrent chaque sous-onglet de la vue paire comme une GRILLE de panneaux
   complémentaires ; le desk n'en montrait qu'un. Ce module GARDE le panneau existant (premier de la
   grille, rendu intact) et l'entoure de trois panneaux alimentés par des données RÉELLES :
     · COT base / cotée : historique de la position nette (1 / 3 / 5 ans), base contre cotée, tableau
       détaillé des derniers rapports (CFTC, API publique officielle) ;
     · Saisonnalité : carte de chaleur mois × années, année type sur 5 / 10 / 15 ans, statistiques du
       mois en cours (clôtures mensuelles Yahoo Finance sur 15 ans).
   Chaque panneau nomme sa source et sa date. Une donnée absente laisse un panneau qui le DIT, jamais
   une courbe inventée. Le desk client n'est pas touché : ce fichier n'est servi qu'aux admins. */
(function () {
  'use strict';
  if (window._v2aPaire) return;
  window._v2aPaire = true;

  var M = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  var cacheCot = {}, cacheSais = {};
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function nf(n) { return (n == null || !isFinite(n)) ? '-' : Math.round(n).toLocaleString('fr-FR'); }
  function pct(n, d) { return (n == null || !isFinite(n)) ? '-' : (n > 0 ? '+' : '') + n.toFixed(d == null ? 2 : d).replace('.', ',') + '%'; }
  function paire() { var t = ((document.getElementById('sym-bar-pair') || {}).textContent || '').replace(/[\[\]\s]/g, ''); return /^[A-Z]{3}\/[A-Z]{3}$/.test(t) ? t : null; }
  function panneau(titre, ctx, corps, source) {
    return '<section class="v2a-pp"><header class="v2a-pp-h"><span class="v2a-pp-t">' + esc(titre) + '</span>' + (ctx ? '<span class="v2a-pp-c">[' + esc(ctx) + ']</span>' : '') + '</header>'
      + '<div class="v2a-pp-b">' + corps + '</div>' + (source ? '<footer class="v2a-pp-s">' + source + '</footer>' : '') + '</section>';
  }
  function getJson(u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }

  /* ── COT ─────────────────────────────────────────────────────────────────────────────────────── */
  function histoCot(ccy) {
    if (cacheCot[ccy]) return Promise.resolve(cacheCot[ccy]);
    return getJson('/api/v2/cot-historique?ccy=' + ccy + '&semaines=260').then(function (d) { if (d && d.rows) cacheCot[ccy] = d; return d; });
  }
  function svgNet(rows, semaines) {
    var r = rows.slice(-semaines); if (r.length < 2) return '<p class="v2a-pp-vide">Historique insuffisant.</p>';
    var W = 520, H = 190, P = 26, mx = Math.max.apply(null, r.map(function (x) { return Math.abs(x.net); })) || 1;
    var y0 = H / 2, bw = (W - 2 * P) / r.length;
    var barres = r.map(function (x, i) {
      var h = Math.abs(x.net) / mx * (H / 2 - P), y = x.net >= 0 ? y0 - h : y0;
      return '<rect x="' + (P + i * bw).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" fill="' + (x.net >= 0 ? '#00e676' : '#ff3d00') + '" opacity=".85"><title>' + esc(x.date) + ' · net ' + nf(x.net) + '</title></rect>';
    }).join('');
    var ans = [], vu = {};
    // Une année entamée en bord de fenêtre (vue 1A) poserait son libellé sur celui de la suivante :
    // on n'en garde un que s'il reste la place de l'écrire, et c'est le plus récent qui gagne.
    var poses = [];
    r.forEach(function (x, i) { var a = x.date.slice(0, 4); if (!vu[a]) { vu[a] = 1; poses.push({ a: a, x: P + i * bw }); } });
    poses.forEach(function (l, k) { var suiv = poses[k + 1]; if (suiv && suiv.x - l.x < 34) return; ans.push('<text x="' + l.x.toFixed(1) + '" y="' + (H - 6) + '" class="v2a-pp-ax">' + l.a + '</text>'); });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="v2a-pp-svg" preserveAspectRatio="none"><line x1="' + P + '" y1="' + y0 + '" x2="' + (W - P) + '" y2="' + y0 + '" stroke="#2a2a30"/>' + barres + ans.join('') + '</svg>'
      + '<div class="v2a-pp-leg"><span>Max ' + nf(mx) + ' contrats</span><span>Dernier : <b class="' + (r[r.length - 1].net >= 0 ? 'v2a-g' : 'v2a-r') + '">' + nf(r[r.length - 1].net) + '</b></span></div>';
  }
  function enrichirCot(host, ccy, autre, role, p) {
    var existant = host.innerHTML;
    host.innerHTML = '<div class="v2a-pgrid">'
      + '<section class="v2a-pp v2a-pp--orig">' + existant + '</section>'
      + panneau('Historique de la position nette', ccy, '<div class="v2a-chips" data-cot-chips><button type="button" data-w="52">1A</button><button type="button" data-w="156">3A</button><button type="button" class="v2a-on" data-w="260">5A</button></div><div data-cot-histo><p class="v2a-pp-vide">Lecture de l’historique CFTC…</p></div>',
        'CFTC · Commitments of Traders, non-commerciaux (spéculateurs), hebdomadaire')
      + panneau('Base contre cotée', p, '<div data-cot-duo><p class="v2a-pp-vide">Lecture…</p></div>', 'Même rapport CFTC, même semaine pour les deux devises')
      + panneau('Tableau détaillé', ccy, '<div data-cot-table><p class="v2a-pp-vide">Lecture…</p></div>', 'Variation = écart de position nette avec le rapport précédent')
      + '</div>';
    Promise.all([histoCot(ccy), histoCot(autre)]).then(function (res) {
      var a = res[0], b = res[1];
      var zoneH = host.querySelector('[data-cot-histo]'), zoneD = host.querySelector('[data-cot-duo]'), zoneT = host.querySelector('[data-cot-table]');
      if (!a || !a.rows || !a.rows.length) { [zoneH, zoneD, zoneT].forEach(function (z) { if (z) z.innerHTML = '<p class="v2a-pp-vide">Historique CFTC indisponible pour ' + esc(ccy) + '.</p>'; }); return; }
      var dessine = function (w) { zoneH.innerHTML = svgNet(a.rows, w); };
      dessine(260);
      host.querySelectorAll('[data-cot-chips] button').forEach(function (bt) {
        bt.addEventListener('click', function () { host.querySelectorAll('[data-cot-chips] button').forEach(function (x) { x.classList.remove('v2a-on'); }); bt.classList.add('v2a-on'); dessine(+bt.dataset.w); });
      });
      var der = function (d) { return d && d.rows && d.rows.length ? d.rows[d.rows.length - 1] : null; };
      var la = der(a), lb = der(b);
      var ligne = function (c, x) {
        if (!x) return '<div class="v2a-duo-l"><b>' + esc(c) + '</b><span class="v2a-pp-vide">indisponible</span></div>';
        var t = x.long + x.short, lp = t ? Math.round(x.long / t * 100) : 0;
        return '<div class="v2a-duo-l"><b>' + esc(c) + '</b><div class="v2a-duo-bar"><i class="v2a-duo-long" style="width:' + lp + '%"></i><i class="v2a-duo-short" style="width:' + (100 - lp) + '%"></i></div>'
          + '<span>' + lp + '% long · net <b class="' + (x.net >= 0 ? 'v2a-g' : 'v2a-r') + '">' + nf(x.net) + '</b></span></div>';
      };
      var lecture = '';
      if (la && lb) {
        var sa = la.net >= 0, sb = lb.net >= 0;
        lecture = '<p class="v2a-duo-lect">' + (sa === sb ? 'Les spéculateurs sont ' + (sa ? 'acheteurs' : 'vendeurs') + ' des DEUX devises : le positionnement ne tranche pas nettement la paire.'
          : 'Positionnement opposé : acheteurs de ' + esc(sa ? ccy : autre) + ', vendeurs de ' + esc(sa ? autre : ccy) + '. Lecture de positionnement, pas une consigne.') + '</p>';
      }
      zoneD.innerHTML = ligne(ccy, la) + ligne(autre, lb) + lecture + (la ? '<div class="v2a-pp-date">Rapport du ' + esc(la.date.split('-').reverse().join('/')) + '</div>' : '');
      var rows = a.rows.slice(-9);
      var tr = [];
      for (var i = rows.length - 1; i >= 1; i--) {
        var x = rows[i], prev = rows[i - 1], t = x.long + x.short, dn = x.net - prev.net;
        tr.push('<tr><td>' + esc(x.date.split('-').reverse().join('/')) + '</td><td>' + nf(x.long) + '</td><td>' + nf(x.short) + '</td><td class="' + (x.net >= 0 ? 'v2a-g' : 'v2a-r') + '">' + nf(x.net) + '</td><td class="' + (dn >= 0 ? 'v2a-g' : 'v2a-r') + '">' + (dn >= 0 ? '+' : '') + nf(dn) + '</td><td>' + (t ? Math.round(x.long / t * 100) : '-') + '%</td></tr>');
      }
      zoneT.innerHTML = '<table class="v2a-pp-tab"><thead><tr><th>Rapport</th><th>Longs</th><th>Shorts</th><th>Net</th><th>Variation</th><th>% long</th></tr></thead><tbody>' + tr.join('') + '</tbody></table>';
    });
  }

  /* ── SAISONNALITÉ ─────────────────────────────────────────────────────────────────────────────── */
  function couleurCase(v, mx) {
    if (v == null) return 'transparent';
    var a = Math.min(1, Math.abs(v) / (mx || 1)) * 0.85 + 0.08;
    return v >= 0 ? 'rgba(0,230,118,' + a.toFixed(2) + ')' : 'rgba(255,61,0,' + a.toFixed(2) + ')';
  }
  // Encre lisible sur chaque case : claire sur un fond pâle (petit rendement), sombre sur un fond plein.
  function encreCase(v, mx) { return v != null && Math.abs(v) / (mx || 1) > 0.5 ? '#0c0c0e' : '#e8e8ec'; }
  function svgCourbes(c) {
    var series = [['a5', '5 ans', '#e3b23a'], ['a10', '10 ans', '#8ab4f8'], ['a15', '15 ans', '#b0b0b8']].filter(function (s) { return c[s[0]]; });
    if (!series.length) return '<p class="v2a-pp-vide">Historique trop court pour une année type.</p>';
    var tous = [0]; series.forEach(function (s) { tous = tous.concat(c[s[0]]); });
    var mn = Math.min.apply(null, tous), mx = Math.max.apply(null, tous), rg = (mx - mn) || 1;
    var W = 520, H = 190, P = 28, sx = (W - 2 * P) / 11;
    var y = function (v) { return (H - P - (v - mn) / rg * (H - 2 * P)).toFixed(1); };
    var lignes = series.map(function (s) {
      return '<polyline fill="none" stroke="' + s[2] + '" stroke-width="2" points="' + c[s[0]].map(function (v, i) { return (P + i * sx).toFixed(1) + ',' + y(v); }).join(' ') + '"/>';
    }).join('');
    var axes = M.map(function (m, i) { return '<text x="' + (P + i * sx).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="v2a-pp-ax">' + m + '</text>'; }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="v2a-pp-svg"><line x1="' + P + '" y1="' + y(0) + '" x2="' + (W - P) + '" y2="' + y(0) + '" stroke="#2a2a30"/>' + lignes + axes + '</svg>'
      + '<div class="v2a-pp-leg">' + series.map(function (s) { return '<span><i style="background:' + s[2] + '"></i>' + s[1] + ' · ' + pct(c[s[0]][11]) + ' sur l’année</span>'; }).join('') + '</div>';
  }
  function enrichirSaison(host, p) {
    var existant = host.innerHTML;
    host.innerHTML = '<div class="v2a-pgrid">'
      + '<section class="v2a-pp v2a-pp--orig">' + existant + '</section>'
      + panneau('Carte de chaleur mois × années', p, '<div data-s-heat><p class="v2a-pp-vide">Lecture des clôtures mensuelles…</p></div>', 'Rendement de chaque mois, clôture à clôture · Yahoo Finance')
      + panneau('Année type : 5, 10 et 15 ans', p, '<div data-s-courbes><p class="v2a-pp-vide">Lecture…</p></div>', 'Trajectoire cumulée moyenne des années complètes · statistique du passé, pas une prévision')
      + panneau('Le mois en cours', p, '<div data-s-mois><p class="v2a-pp-vide">Lecture…</p></div>', 'Années complètes uniquement')
      + '</div>';
    var cle = p.replace('/', '');
    var go = function (d) {
      var zH = host.querySelector('[data-s-heat]'), zC = host.querySelector('[data-s-courbes]'), zM = host.querySelector('[data-s-mois]');
      if (!d || !d.table || !Object.keys(d.table).length) { [zH, zC, zM].forEach(function (z) { if (z) z.innerHTML = '<p class="v2a-pp-vide">Clôtures mensuelles indisponibles pour ' + esc(p) + '.</p>'; }); return; }
      var ans = Object.keys(d.table).sort().reverse(), mx = 0;
      ans.forEach(function (a) { d.table[a].forEach(function (v) { if (v != null) mx = Math.max(mx, Math.abs(v)); }); });
      zH.innerHTML = '<div class="v2a-heat-wrap"><table class="v2a-heat"><thead><tr><th></th>' + M.map(function (m, i) { return '<th' + (i === d.moisCourant ? ' class="v2a-cur"' : '') + '>' + m + '</th>'; }).join('') + '</tr></thead><tbody>'
        + ans.map(function (a) { return '<tr><th>' + a + '</th>' + d.table[a].map(function (v) { return '<td style="background:' + couleurCase(v, mx) + ';color:' + encreCase(v, mx) + '" title="' + (v == null ? '' : pct(v)) + '">' + (v == null ? '' : v.toFixed(1).replace('.', ',')) + '</td>'; }).join('') + '</tr>'; }).join('')
        + '</tbody></table></div>';
      zC.innerHTML = svgCourbes(d.courbes || {});
      var s = d.stat;
      zM.innerHTML = s ? '<div class="v2a-mois-t">' + M[d.moisCourant] + ' : <b class="' + (s.hausse * 2 >= s.annees ? 'v2a-g' : 'v2a-r') + '">' + s.hausse + ' année' + (s.hausse > 1 ? 's' : '') + ' en hausse sur ' + s.annees + '</b></div>'
        + '<div class="v2a-kpis"><div><span>Moyenne</span><b>' + pct(s.moyenne) + '</b></div><div><span>Médiane</span><b>' + pct(s.mediane) + '</b></div><div><span>Meilleur</span><b class="v2a-g">' + pct(s.meilleur) + '</b></div><div><span>Pire</span><b class="v2a-r">' + pct(s.pire) + '</b></div></div>'
        : '<p class="v2a-pp-vide">Pas assez d’années complètes.</p>';
    };
    if (cacheSais[cle]) { go(cacheSais[cle]); return; }
    getJson('/api/v2/saisonnalite?pair=' + cle).then(function (d) { if (d && d.table) cacheSais[cle] = d; go(d); });
  }

  /* ── Branchement : dès qu'un sous-onglet a fini SON rendu, on l'entoure de sa grille ─────────── */
  function verifier() {
    var p = paire(); if (!p) return;
    var c1 = p.slice(0, 3), c2 = p.slice(4);
    var cb = document.getElementById('sym-sub-cotbase'), cq = document.getElementById('sym-sub-cotquote'), se = document.getElementById('sym-sub-seasonality');
    // Critère : le rendu d'origine est là et la grille n'y est pas (un nouveau rendu du desk la retire).
    var libre = function (h, sel) { return h && h.querySelector(sel) && !h.querySelector('.v2a-pgrid'); };
    if (libre(cb, '.sym-cot')) enrichirCot(cb, c1, c2, 'base', p);
    if (libre(cq, '.sym-cot')) enrichirCot(cq, c2, c1, 'quote', p);
    if (libre(se, '.sym-seas')) enrichirSaison(se, p);
  }
  var cont = document.getElementById('sym-content');
  if (cont && window.MutationObserver) new MutationObserver(function () { setTimeout(verifier, 0); }).observe(cont, { childList: true, subtree: true });
  window._v2aPaireVerifier = verifier;
})();

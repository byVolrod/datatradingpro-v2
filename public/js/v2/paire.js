/* ═══ DTP V3 · VUE PAIRE EN GRILLE DE PANNEAUX (comptes admin, derrière « Aperçu V2 ») ════════════════
   Captures de référence (24/09) : chaque sous-onglet de la vue paire est un ÉCRAN de terminal, des
   panneaux collés sur toute la hauteur, des graphiques pleine taille avec leurs axes, leurs étiquettes
   de valeur à droite, un réticule au survol, et des tableaux complets. Retour user : « ça fait image
   fixe avec un vieux design » → tout ce qui est tracé ici l'est AU PIXEL (ResizeObserver, jamais un
   SVG étiré), s'anime à l'entrée, et répond à la souris.
   Trois sous-onglets : COT (base, cotée), Saisonnalité, Particuliers. Le rendu d'origine du desk reste
   dans le DOM, masqué : c'est lui qui déclenche la grille (un nouveau rendu du desk la retire, on la
   repose), et couper « Aperçu V2 » le rend tel quel.
   Données : UNIQUEMENT des sources réelles (CFTC, Yahoo Finance, Myfxbook relevé par DTP). Aucune
   valeur n'est fabriquée pour remplir un graphique ; une donnée absente s'écrit « indisponible ». */
(function () {
  'use strict';
  if (window._v2aPaire) return;
  window._v2aPaire = true;

  var M = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  var VERT = '#00e676', ROUGE = '#ff3d00', OR = '#e3b23a';
  var DRAP = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', CAD: 'ca', AUD: 'au', NZD: 'nz' };

  /* ── Outils ───────────────────────────────────────────────────────────────────────────────────── */
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fr(n, d) { return (n == null || !isFinite(n)) ? '-' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function sgn(n, d) { return (n == null || !isFinite(n)) ? '-' : (n > 0 ? '+' : '') + fr(n, d); }
  function pct(n, d) { return (n == null || !isFinite(n)) ? '-' : sgn(n, d == null ? 2 : d) + '%'; }
  function kilo(n) { if (n == null || !isFinite(n)) return '-'; var a = Math.abs(n); return a >= 1e6 ? fr(n / 1e6, 1) + 'M' : a >= 1e3 ? fr(n / 1e3, 1) + 'K' : fr(n); }
  function dateFr(t) { var d = new Date(t); return ('0' + d.getUTCDate()).slice(-2) + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + d.getUTCFullYear(); }
  function drapeau(c) { return DRAP[c] ? '<img class="v2a-drap" src="https://flagcdn.com/w40/' + DRAP[c] + '.png" alt="">' : ''; }
  function drapeaux(p) { return '<span class="v2a-drap2">' + drapeau(p.slice(0, 3)) + drapeau(p.slice(4)) + '</span>'; }
  function paire() { var t = ((document.getElementById('sym-bar-pair') || {}).textContent || '').replace(/[\[\]\s]/g, ''); return /^[A-Z]{3}\/[A-Z]{3}$/.test(t) ? t : null; }
  function getJson(u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  var ico = {
    dl: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    aide: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 17h.01"/></svg>',
    hausse: '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 12l4-4 3 3 5-6M10 5h4v4"/></svg>',
    baisse: '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 4l4 4 3-3 5 6M10 11h4V7"/></svg>'
  };
  // Export CSV des données RÉELLEMENT affichées par le panneau (pas d'une copie recalculée).
  function exporter(nom, lignes) {
    if (!lignes || !lignes.length) return;
    var csv = lignes.map(function (l) { return l.map(function (v) { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';'); }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = nom + '.csv'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function panneau(cle, titre, ctx, outils, aide, zone) {
    return '<section class="v2a-pp" data-p="' + cle + '"><header class="v2a-pp-h"><span class="v2a-pp-t">' + esc(titre)
      + (ctx ? '<i class="v2a-pp-sep"></i><span class="v2a-pp-ctx">' + ctx + '</span>' : '') + '</span>'
      + '<span class="v2a-pp-outils">' + (outils || '') + '<button type="button" class="v2a-pp-ic" data-export="' + cle + '" title="Exporter en CSV">' + ico.dl + '</button>'
      + '<span class="v2a-pp-ic v2a-pp-aide" tabindex="0">' + ico.aide + '<span class="v2a-pp-bulle">' + aide + '</span></span></span></header>'
      + '<div class="v2a-pp-c" data-z="' + cle + '">' + (zone || '<div class="v2a-pp-charge"><i></i><i></i><i></i></div>') + '</div></section>';
  }
  function puces(nom, liste, actif) {
    return '<span class="v2a-chips" data-chips="' + nom + '">' + liste.map(function (x) {
      return '<button type="button" data-v="' + x[0] + '"' + (String(x[0]) === String(actif) ? ' class="v2a-on"' : '') + '>' + x[1] + '</button>';
    }).join('') + '</span>';
  }
  function vide(msg) { return '<p class="v2a-pp-vide">' + esc(msg) + '</p>'; }

  /* ── Bibliothèque de graphiques : tracé au pixel, axes, réticule, animations ─────────────────────── */
  var K = {};
  // Graduations « rondes » entre deux bornes.
  K.ticks = function (a, b, n) {
    if (a === b) { a -= 1; b += 1; }
    var pas = Math.pow(10, Math.floor(Math.log10((b - a) / n))), err = (b - a) / n / pas;
    pas *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var out = [], v = Math.ceil(a / pas) * pas;
    for (; v <= b + pas * 1e-9; v += pas) out.push(+v.toFixed(10));
    return out;
  };
  // Redessine au pixel à chaque changement de taille (rotation, splitter, fenêtre).
  K.monter = function (el, dessiner) {
    var dernier = '';
    var go = function () {
      var w = Math.floor(el.clientWidth), h = Math.floor(el.clientHeight);
      if (w < 40 || h < 40) return;
      var cle = w + 'x' + h; if (cle === dernier) return; dernier = cle;
      dessiner(w, h);
    };
    if (el._ro) el._ro.disconnect();   // un panneau rechargé ne garde qu'UN observateur (sinon l'ancien tracé revient)
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { requestAnimationFrame(go); }); ro.observe(el); el._ro = ro; }
    requestAnimationFrame(go);
  };
  // Infobulle HTML commune, placée dans le cadre du graphique.
  K.bulle = function (el) {
    var b = el.querySelector('.v2a-tip');
    if (!b) { b = document.createElement('div'); b.className = 'v2a-tip'; el.appendChild(b); }
    return {
      montrer: function (x, y, html) {
        b.innerHTML = html; b.classList.add('v2a-on');
        var W = el.clientWidth, bw = b.offsetWidth, bh = b.offsetHeight;
        b.style.left = Math.max(4, Math.min(W - bw - 4, x + 14 > W - bw - 4 ? x - bw - 14 : x + 14)) + 'px';
        b.style.top = Math.max(4, Math.min(el.clientHeight - bh - 4, y - bh / 2)) + 'px';
      },
      cacher: function () { b.classList.remove('v2a-on'); }
    };
  };
  // Étiquettes de valeur à droite, écartées pour ne jamais se chevaucher.
  K.etiquettes = function (items, x, hMin, hMax) {
    items.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 15) items[i].y = items[i - 1].y + 15;
    var deb = items.length ? items[items.length - 1].y - hMax : 0;
    if (deb > 0) for (var j = items.length - 1; j >= 0; j--) { items[j].y -= deb; if (j && items[j].y - items[j - 1].y >= 15) break; }
    return items.map(function (it) {
      var y = Math.max(hMin, it.y);
      return '<g class="v2a-tag"><rect x="' + x + '" y="' + (y - 7.5) + '" width="' + (it.w || 52) + '" height="15" rx="2" fill="' + it.c + '"/>'
        + '<text x="' + (x + 4) + '" y="' + (y + 3.8) + '" fill="' + (it.encre || '#0c0c0e') + '">' + esc(it.t) + '</text></g>';
    }).join('');
  };

  // Barres verticales autour de zéro (historique COT). pts : [{t, v, info}]
  K.barres = function (el, pts, o) {
    o = o || {};
    if (!el.querySelector('.v2a-trace')) el.innerHTML = '';   // retire l'animation de chargement
    var tip = K.bulle(el);
    K.monter(el, function (W, H) {
      var PG = 8, PD = 62, PH = 12, PB = 24, w = W - PG - PD, h = H - PH - PB;
      var vals = pts.map(function (p) { return p.v; }), mn = Math.min(0, Math.min.apply(null, vals)), mx = Math.max(0, Math.max.apply(null, vals));
      var tk = K.ticks(mn, mx, Math.max(3, Math.round(h / 42))); mn = Math.min(mn, tk[0]); mx = Math.max(mx, tk[tk.length - 1]);
      var y = function (v) { return PH + (mx - v) / (mx - mn || 1) * h; }, bw = w / pts.length, y0 = y(0);
      var s = '<svg class="v2a-svg" width="' + W + '" height="' + H + '">';
      tk.forEach(function (v) { s += '<line class="v2a-grille" x1="' + PG + '" x2="' + (PG + w) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="v2a-ax" x="' + (PG + w + 8) + '" y="' + (y(v) + 3.5) + '">' + (o.fmtY || fr)(v) + '</text>'; });
      s += '<line class="v2a-zero" x1="' + PG + '" x2="' + (PG + w) + '" y1="' + y0 + '" y2="' + y0 + '"/>';
      var vu = {}, derX = -99;
      pts.forEach(function (p, i) {
        var d = new Date(p.t), cle = o.graduation === 'mois' ? d.getUTCFullYear() + '-' + d.getUTCMonth() : d.getUTCFullYear(), x = PG + i * bw;
        if (!vu[cle] && x - derX > 46) { vu[cle] = 1; derX = x; s += '<text class="v2a-ax" x="' + x + '" y="' + (H - 6) + '">' + (o.graduation === 'mois' ? M[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2) : d.getUTCFullYear()) + '</text>'; }
      });
      var retard = Math.min(10, 500 / pts.length);
      s += '<g class="v2a-barres">' + pts.map(function (p, i) {
        var yy = y(Math.max(0, p.v)), hh = Math.max(1, Math.abs(y(p.v) - y0));
        return '<rect data-i="' + i + '" x="' + (PG + i * bw + bw * 0.12).toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + Math.max(1, bw * 0.76).toFixed(1) + '" height="' + hh.toFixed(1)
          + '" fill="' + (p.v >= 0 ? VERT : ROUGE) + '" style="transform-origin:0 ' + y0.toFixed(1) + 'px;animation-delay:' + (i * retard).toFixed(0) + 'ms"/>';
      }).join('') + '</g>';
      var der = pts[pts.length - 1];
      s += K.etiquettes([{ y: y(der.v), t: (o.fmtY || fr)(der.v), c: der.v >= 0 ? VERT : ROUGE }], PG + w + 4, PH, PH + h);
      s += '<line class="v2a-reti" x1="0" x2="0" y1="' + PH + '" y2="' + (PH + h) + '"/><rect class="v2a-cible" x="' + PG + '" y="0" width="' + w + '" height="' + H + '"/></svg>';
      el.querySelector('.v2a-trace') ? (el.querySelector('.v2a-trace').innerHTML = s) : el.insertAdjacentHTML('afterbegin', '<div class="v2a-trace">' + s + '</div>');
      var svg = el.querySelector('svg'), reti = svg.querySelector('.v2a-reti'), prec = null;
      svg.querySelector('.v2a-cible').addEventListener('mousemove', function (e) {
        var r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(pts.length - 1, Math.floor((e.clientX - r.left - PG) / bw)));
        var cx = PG + i * bw + bw / 2; reti.setAttribute('x1', cx); reti.setAttribute('x2', cx); reti.classList.add('v2a-on');
        if (prec) prec.classList.remove('v2a-sel'); prec = svg.querySelector('rect[data-i="' + i + '"]'); if (prec) prec.classList.add('v2a-sel');
        tip.montrer(cx, e.clientY - r.top, o.tip ? o.tip(pts[i]) : dateFr(pts[i].t) + '<br><b>' + fr(pts[i].v) + '</b>');
      });
      svg.querySelector('.v2a-cible').addEventListener('mouseleave', function () { reti.classList.remove('v2a-on'); tip.cacher(); if (prec) prec.classList.remove('v2a-sel'); });
    });
  };

  // Barres empilées à 100% (particuliers : long en bas, short en haut). pts : [{t, long}]
  K.barres100 = function (el, pts, o) {
    o = o || {};
    if (!el.querySelector('.v2a-trace')) el.innerHTML = '';   // retire l'animation de chargement
    var tip = K.bulle(el);
    K.monter(el, function (W, H) {
      var PG = 40, PD = 10, PH = 10, PB = 24, w = W - PG - PD, h = H - PH - PB, bw = w / pts.length, y = function (p) { return PH + (100 - p) / 100 * h; };
      var s = '<svg class="v2a-svg" width="' + W + '" height="' + H + '">';
      [0, 25, 50, 75, 100].forEach(function (v) { s += '<line class="v2a-grille" x1="' + PG + '" x2="' + (PG + w) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="v2a-ax" x="4" y="' + (y(v) + 3.5) + '">' + v + '%</text>'; });
      var derX = -99;
      s += '<g class="v2a-barres">' + pts.map(function (p, i) {
        var x = PG + i * bw + bw * 0.1, bwi = Math.max(1, bw * 0.8), yl = y(p.long);
        if (x - derX > 70) { derX = x; s += '<text class="v2a-ax" x="' + x.toFixed(1) + '" y="' + (H - 6) + '">' + (o.fmtX ? o.fmtX(p.t) : dateFr(p.t)) + '</text>'; }
        return '<g data-i="' + i + '" style="transform-origin:0 ' + (PH + h) + 'px;animation-delay:' + Math.min(400, i * 12) + 'ms"><rect x="' + x.toFixed(1) + '" y="' + PH + '" width="' + bwi.toFixed(1) + '" height="' + (yl - PH).toFixed(1) + '" fill="' + ROUGE + '"/>'
          + '<rect x="' + x.toFixed(1) + '" y="' + yl.toFixed(1) + '" width="' + bwi.toFixed(1) + '" height="' + (PH + h - yl).toFixed(1) + '" fill="' + VERT + '"/></g>';
      }).join('') + '</g>';
      s += '<line x1="' + PG + '" x2="' + (PG + w) + '" y1="' + y(50) + '" y2="' + y(50) + '" stroke="' + OR + '" stroke-width="1"/>';
      s += '<rect class="v2a-cible" x="' + PG + '" y="0" width="' + w + '" height="' + H + '"/></svg>';
      el.querySelector('.v2a-trace') ? (el.querySelector('.v2a-trace').innerHTML = s) : el.insertAdjacentHTML('afterbegin', '<div class="v2a-trace">' + s + '</div>');
      var svg = el.querySelector('svg'), prec = null;
      svg.querySelector('.v2a-cible').addEventListener('mousemove', function (e) {
        var r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(pts.length - 1, Math.floor((e.clientX - r.left - PG) / bw)));
        if (prec) prec.classList.remove('v2a-sel'); prec = svg.querySelector('g[data-i="' + i + '"]'); if (prec) prec.classList.add('v2a-sel');
        var p = pts[i];
        tip.montrer(PG + i * bw + bw / 2, e.clientY - r.top, (o.fmtTip ? o.fmtTip(p.t) : dateFr(p.t)) + '<br><i style="background:' + VERT + '"></i>Longs : <b>' + fr(p.long, 1) + '%</b><br><i style="background:' + ROUGE + '"></i>Shorts : <b>' + fr(100 - p.long, 1) + '%</b>');
      });
      svg.querySelector('.v2a-cible').addEventListener('mouseleave', function () { tip.cacher(); if (prec) prec.classList.remove('v2a-sel'); });
    });
  };

  // Courbes (saisonnalité, projection). series : [{nom, c, pts:[{x,y}], tirets, epais}], bandes : [{haut, bas, c, op}]
  K.lignes = function (el, series, o) {
    o = o || {};
    if (!el.querySelector('.v2a-trace')) el.innerHTML = '';   // retire l'animation de chargement
    var tip = K.bulle(el), caches = {};
    function tracer(W, H) {
      var PG = 8, PD = o.largeurTags || 70, PH = 12, PB = 24, w = W - PG - PD, h = H - PH - PB;
      var vis = series.filter(function (s) { return !caches[s.nom]; });
      var xs = [], ys = [];
      vis.forEach(function (s) { s.pts.forEach(function (p) { xs.push(p.x); ys.push(p.y); }); });
      (o.bandes || []).forEach(function (b) { b.haut.forEach(function (p) { xs.push(p.x); ys.push(p.y); }); b.bas.forEach(function (p) { ys.push(p.y); }); });
      if (!xs.length) return;
      var x0 = o.xMin != null ? o.xMin : Math.min.apply(null, xs), x1 = o.xMax != null ? o.xMax : Math.max.apply(null, xs);
      var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), marge = (y1 - y0) * 0.06 || 1; y0 -= marge; y1 += marge;
      var tk = K.ticks(y0, y1, Math.max(3, Math.round(h / 44)));
      var X = function (v) { return PG + (v - x0) / (x1 - x0 || 1) * w; }, Y = function (v) { return PH + (y1 - v) / (y1 - y0 || 1) * h; };
      var s = '<svg class="v2a-svg" width="' + W + '" height="' + H + '">';
      tk.forEach(function (v) { if (Y(v) < PH - 1 || Y(v) > PH + h + 1) return; s += '<line class="v2a-grille" x1="' + PG + '" x2="' + (PG + w) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="v2a-ax" x="' + (PG + w + 8) + '" y="' + (Y(v) + 3.5) + '">' + (o.fmtY || fr)(v) + '</text>'; });
      if (o.zero && y0 < 0 && y1 > 0) s += '<line class="v2a-zero" x1="' + PG + '" x2="' + (PG + w) + '" y1="' + Y(0) + '" y2="' + Y(0) + '"/>';
      (o.graduationsX || []).forEach(function (g) { var gx = X(g.x); if (gx < PG || gx > PG + w) return; s += '<text class="v2a-ax" x="' + gx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(g.t) + '</text>'; });
      (o.bandes || []).forEach(function (b) {
        var d = b.haut.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join('')
          + b.bas.slice().reverse().map(function (p) { return 'L' + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join('') + 'Z';
        s += '<path class="v2a-bande" d="' + d + '" fill="' + b.c + '" fill-opacity="' + (b.op || 0.12) + '"/>';
      });
      if (o.vline != null) s += '<line class="v2a-auj" x1="' + X(o.vline) + '" x2="' + X(o.vline) + '" y1="' + PH + '" y2="' + (PH + h) + '"/>';
      var tags = [];
      vis.forEach(function (sr, k) {
        if (!sr.pts.length) return;
        var d = sr.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join('');
        s += '<path class="v2a-ligne" pathLength="1" d="' + d + '" stroke="' + sr.c + '" stroke-width="' + (sr.epais || 1.6) + '"' + (sr.tirets ? ' stroke-dasharray="4 4" style="animation:none;stroke-dashoffset:0"' : ' style="animation-delay:' + k * 120 + 'ms"') + '/>';
        if (sr.tag !== false) { var l = sr.pts[sr.pts.length - 1]; tags.push({ y: Y(l.y), t: (sr.tagTexte ? sr.tagTexte + ' ' : '') + (o.fmtTag || o.fmtY || fr)(l.y), c: sr.c, w: PD - 8 }); }
      });
      s += K.etiquettes(tags, PG + w + 4, PH, PH + h);
      s += '<line class="v2a-reti" x1="0" x2="0" y1="' + PH + '" y2="' + (PH + h) + '"/><g class="v2a-points"></g><rect class="v2a-cible" x="' + PG + '" y="0" width="' + w + '" height="' + H + '"/></svg>';
      var zone = el.querySelector('.v2a-trace');
      if (zone) zone.innerHTML = s; else el.insertAdjacentHTML('afterbegin', '<div class="v2a-trace">' + s + '</div>');
      var svg = el.querySelector('svg'), reti = svg.querySelector('.v2a-reti'), pg = svg.querySelector('.v2a-points');
      svg.querySelector('.v2a-cible').addEventListener('mousemove', function (e) {
        var r = svg.getBoundingClientRect(), xv = x0 + (e.clientX - r.left - PG) / w * (x1 - x0);
        var lignes = [], pts = '';
        vis.forEach(function (sr) {
          var best = null; sr.pts.forEach(function (p) { if (!best || Math.abs(p.x - xv) < Math.abs(best.x - xv)) best = p; });
          if (!best || Math.abs(best.x - xv) > (x1 - x0) / 40) return;
          pts += '<circle cx="' + X(best.x) + '" cy="' + Y(best.y) + '" r="3.5" fill="' + sr.c + '" stroke="#0c0c0e" stroke-width="1.5"/>';
          lignes.push('<i style="background:' + sr.c + '"></i>' + esc(sr.nom) + ' : <b>' + (o.fmtTip || o.fmtY || fr)(best.y) + '</b>');
        });
        var cx = e.clientX - r.left; reti.setAttribute('x1', cx); reti.setAttribute('x2', cx); reti.classList.add('v2a-on'); pg.innerHTML = pts;
        if (lignes.length) tip.montrer(cx, e.clientY - r.top, (o.fmtX ? '<span class="v2a-tip-t">' + o.fmtX(xv) + '</span>' : '') + lignes.join('<br>')); else tip.cacher();
      });
      svg.querySelector('.v2a-cible').addEventListener('mouseleave', function () { reti.classList.remove('v2a-on'); pg.innerHTML = ''; tip.cacher(); });
    }
    // Légende cliquable : masquer / réafficher une série (et l'échelle se recale).
    if (o.legende) {
      var leg = document.createElement('div'); leg.className = 'v2a-leg';
      leg.innerHTML = series.filter(function (s) { return s.legende !== false; }).map(function (s) { return '<button type="button" data-n="' + esc(s.nom) + '"><i style="background:' + s.c + '"></i>' + esc(s.nom) + '</button>'; }).join('');
      o.legende.appendChild(leg);
      leg.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        caches[b.dataset.n] = !caches[b.dataset.n]; b.classList.toggle('v2a-off', !!caches[b.dataset.n]);
        tracer(el.clientWidth, el.clientHeight);
      });
    }
    K.monter(el, tracer);
  };

  // Anneau long / short avec étiquettes et trois chiffres clés.
  K.anneau = function (el, long, short, o) {
    o = o || {};
    var tot = long + short || 1, pl = long / tot;
    K.monter(el, function (W, H) {
      var hk = 74, R = Math.max(40, Math.min(W / 2 - 90, (H - hk) / 2 - 24)), cx = W / 2, cy = (H - hk) / 2, ep = Math.max(12, R * 0.2), C = 2 * Math.PI * R;
      var angS = -Math.PI / 2 + (1 - pl) * Math.PI, angL = -Math.PI / 2 + (1 - pl) * 2 * Math.PI + pl * Math.PI;   // milieux des arcs
      var lab = function (a, txt, c) {
        var x1 = cx + Math.cos(a) * (R + ep / 2 + 2), y1 = cy + Math.sin(a) * (R + ep / 2 + 2), x2 = cx + Math.cos(a) * (R + ep / 2 + 18), y2 = cy + Math.sin(a) * (R + ep / 2 + 18);
        var droite = Math.cos(a) >= 0;
        return '<path d="M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + 'h' + (droite ? 10 : -10) + '" stroke="' + c + '" fill="none" stroke-width="1"/>'
          + '<text class="v2a-an-lab" x="' + (x2 + (droite ? 14 : -14)) + '" y="' + (y2 + 4) + '" text-anchor="' + (droite ? 'start' : 'end') + '">' + esc(txt) + '</text>';
      };
      var s = '<svg class="v2a-svg" width="' + W + '" height="' + (H - hk) + '">'
        + '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="#1a1a1f" stroke-width="' + ep + '"/>'
        + '<g transform="rotate(-90 ' + cx + ' ' + cy + ')">'
        + '<circle class="v2a-arc" cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="' + ROUGE + '" stroke-width="' + ep + '" stroke-dasharray="' + (C * (1 - pl)).toFixed(1) + ' ' + C.toFixed(1) + '" style="--c:' + C.toFixed(1) + '"/>'
        + '<circle class="v2a-arc" cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="' + VERT + '" stroke-width="' + ep + '" stroke-dasharray="' + (C * pl).toFixed(1) + ' ' + C.toFixed(1) + '" stroke-dashoffset="' + (-C * (1 - pl)).toFixed(1) + '" style="--c:' + C.toFixed(1) + ';animation-delay:.15s"/></g>'
        + '<text class="v2a-an-c" x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle">' + fr(pl * 100, 1) + '%</text><text class="v2a-an-s" x="' + cx + '" y="' + (cy + 15) + '" text-anchor="middle">longs</text>'
        + lab(angS, 'Short ' + (o.fmt || kilo)(short), ROUGE) + lab(angL, 'Long ' + (o.fmt || kilo)(long), VERT) + '</svg>';
      var net = long - short;
      var kpi = '<div class="v2a-kpis"><div><span>Positions short</span><b class="v2a-r">' + (o.fmt || kilo)(short) + '</b><small>' + fr((1 - pl) * 100, 1) + '%</small></div>'
        + '<div><span>Positions long</span><b class="v2a-g">' + (o.fmt || kilo)(long) + '</b><small>' + fr(pl * 100, 1) + '%</small></div>'
        + (o.net === false ? '' : '<div><span>Position nette</span><b class="' + (net >= 0 ? 'v2a-g' : 'v2a-r') + '">' + (net >= 0 ? 'Haussière' : 'Baissière') + '</b><small>' + sgn(net / (o.div || 1), o.div ? 1 : 0) + (o.div ? 'K' : '') + '</small></div>') + '</div>';
      el.innerHTML = '<div class="v2a-leg v2a-leg-fixe"><span><i style="background:' + ROUGE + '"></i>Short</span><span><i style="background:' + VERT + '"></i>Long</span></div>' + s + kpi;
    });
  };

  /* ── Mise en page : la grille occupe toute la hauteur visible sous les sous-onglets ─────────────── */
  function hauteur(g) {
    if (window.matchMedia('(max-width: 820px)').matches) { g.style.height = ''; return; }
    var top = g.getBoundingClientRect().top;
    g.style.height = Math.max(640, window.innerHeight - top - 10) + 'px';
  }
  window.addEventListener('resize', function () { document.querySelectorAll('.v2a-pgrid').forEach(hauteur); });
  function poserGrille(host, cls, html) {
    var orig = host.innerHTML;
    host.innerHTML = '<div class="v2a-pp-orig" hidden>' + orig + '</div><div class="v2a-pgrid ' + cls + '">' + html + '</div>';
    var g = host.querySelector('.v2a-pgrid');
    requestAnimationFrame(function () { hauteur(g); });
    return g;
  }
  function brancherExport(g, fournisseurs) {
    g.addEventListener('click', function (e) {
      var b = e.target.closest('[data-export]'); if (!b) return;
      var f = fournisseurs[b.dataset.export]; if (f) { var r = f(); if (r) exporter(r[0], r[1]); }
    });
  }

  /* ══ COT ═══════════════════════════════════════════════════════════════════════════════════════ */
  var cacheCot = {};
  function histoCot(ccy, type) {
    var k = ccy + '|' + type;
    if (cacheCot[k]) return Promise.resolve(cacheCot[k]);
    return getJson('/api/v2/cot-historique?ccy=' + ccy + '&type=' + type + '&semaines=780').then(function (d) { if (d && d.rows) cacheCot[k] = d; return d; });
  }
  var PERIODES_COT = [[52, '1A'], [156, '3A'], [260, '5A'], [520, '10A'], [780, '15A']];
  function enrichirCot(host, ccy, p) {
    var etat = { type: 'noncomm', sem: 260, mode: 'net' };
    var outils = '<select class="v2a-sel" data-cat><option value="noncomm">Non-commerciaux</option><option value="lev_money">Fonds à levier</option><option value="asset_mgr">Gestionnaires d’actifs</option><option value="dealer">Intermédiaires</option><option value="other_rept">Autres déclarants</option></select>';
    var ctx = drapeau(ccy) + '[' + ccy + ']';
    var g = poserGrille(host, 'v2a-g-cot',
      panneau('pos', 'Positionnement COT', ctx, outils, 'Dernier rapport CFTC (publié le vendredi, positions du mardi). Longs, shorts et position nette de la catégorie choisie.')
      + panneau('hist', 'Historique COT', '<span data-titre-hist>Position nette</span> <i class="v2a-pp-sep"></i> <span data-cat-nom>Non-commerciaux</span>',
        puces('mode', [['net', 'Net'], ['pct', 'Net % OI']], 'net') + puces('sem', PERIODES_COT, 260),
        'Position nette hebdomadaire (longs moins shorts). « Net % OI » : la même, rapportée à l’intérêt ouvert total du contrat. Source : CFTC.')
      + panneau('tab', 'Tableau COT', ctx, '', 'Chaque ligne est un rapport CFTC. Variations : écart avec le rapport précédent. % OI : part de l’intérêt ouvert total. Traders : nombre de déclarants.'));
    var z = function (k) { return g.querySelector('[data-z="' + k + '"]'); };
    var donnees = null;
    var fourn = {
      pos: function () { var r = donnees && donnees.rows; if (!r || !r.length) return null; var l = r[r.length - 1]; return ['COT_' + ccy + '_positionnement', [['Rapport', 'Longs', 'Shorts', 'Net'], [l.date, l.long, l.short, l.net]]]; },
      hist: function () { var r = donnees && donnees.rows; if (!r) return null; return ['COT_' + ccy + '_historique', [['Rapport', 'Longs', 'Shorts', 'Net', 'Intérêt ouvert']].concat(r.map(function (x) { return [x.date, x.long, x.short, x.net, x.oi]; }))]; },
      tab: function () { var r = donnees && donnees.rows; if (!r) return null; return ['COT_' + ccy + '_tableau', [['Rapport', 'Intérêt ouvert', 'Longs', 'Shorts', 'Spreads', 'Net', 'Traders longs', 'Traders shorts', 'Traders total']].concat(r.slice().reverse().map(function (x) { return [x.date, x.oi, x.long, x.short, x.spread, x.net, x.tl, x.ts, x.tt]; }))]; }
    };
    brancherExport(g, fourn);
    function dessinerHist() {
      var r = donnees.rows.slice(-etat.sem), avecOi = r.every(function (x) { return x.oi > 0; });
      if (etat.mode === 'pct' && !avecOi) etat.mode = 'net';
      g.querySelector('[data-chips="mode"] [data-v="pct"]').disabled = !avecOi;
      g.querySelectorAll('[data-chips="mode"] button').forEach(function (b) { b.classList.toggle('v2a-on', b.dataset.v === etat.mode); });
      g.querySelector('[data-titre-hist]').textContent = etat.mode === 'pct' ? 'Net % de l’intérêt ouvert' : 'Position nette';
      var el = z('hist'); el.innerHTML = '';
      K.barres(el, r.map(function (x) { return { t: Date.parse(x.date), v: etat.mode === 'pct' ? x.net / x.oi * 100 : x.net, x: x }; }), {
        fmtY: etat.mode === 'pct' ? function (v) { return fr(v, 1) + '%'; } : kilo,
        graduation: etat.sem <= 52 ? 'mois' : 'an',
        tip: function (pt) { var x = pt.x; return '<span class="v2a-tip-t">Rapport du ' + x.date.split('-').reverse().join('/') + '</span><i style="background:' + VERT + '"></i>Longs : <b>' + fr(x.long) + '</b><br><i style="background:' + ROUGE + '"></i>Shorts : <b>' + fr(x.short) + '</b><br>Net : <b class="' + (x.net >= 0 ? 'v2a-g' : 'v2a-r') + '">' + sgn(x.net) + '</b>' + (x.oi ? '<br>Net % OI : <b>' + fr(x.net / x.oi * 100, 1) + '%</b>' : ''); }
      });
    }
    function dessinerTout() {
      var r = donnees.rows;
      if (!r.length) { ['pos', 'hist', 'tab'].forEach(function (k) { z(k).innerHTML = vide('Aucun rapport CFTC pour ' + ccy + ' dans cette catégorie.'); }); return; }
      var l = r[r.length - 1];
      z('pos').innerHTML = '';
      K.anneau(z('pos'), l.long, l.short, { div: 1000 });
      dessinerHist();
      // Tableau complet : colonnes présentes seulement si la CFTC les a fournies.
      var a = r.some(function (x) { return x.oi != null; }), sp = r.some(function (x) { return x.spread != null; }), tr = r.some(function (x) { return x.tl != null; });
      var lignes = r.slice(-60).reverse();
      var d = function (x, prev, k) { return prev && x[k] != null && prev[k] != null ? x[k] - prev[k] : null; };
      var cv = function (v) { return '<td class="' + (v == null ? '' : v >= 0 ? 'v2a-g' : 'v2a-r') + '">' + (v == null ? '-' : sgn(v)) + '</td>'; };
      var html = '<div class="v2a-tab-wrap"><table class="v2a-tab"><thead><tr><th rowspan="2">Rapport</th>' + (a ? '<th rowspan="2">Intérêt ouvert</th>' : '')
        + '<th colspan="' + (sp ? 7 : 5) + '">Positions</th>' + (a ? '<th colspan="' + (sp ? 4 : 3) + '">% de l’intérêt ouvert</th>' : '') + (tr ? '<th colspan="5">Nombre de traders</th>' : '') + '</tr><tr>'
        + '<th>Longs</th><th>Var.</th><th>Shorts</th><th>Var.</th>' + (sp ? '<th>Spreads</th><th>Var.</th>' : '') + '<th>Net</th>'
        + (a ? '<th>Longs</th><th>Shorts</th>' + (sp ? '<th>Spreads</th>' : '') + '<th>Net</th>' : '')
        + (tr ? '<th>Longs</th><th>Shorts</th><th>Spreads</th><th>Total</th><th>Net</th>' : '') + '</tr></thead><tbody>';
      lignes.forEach(function (x, i) {
        var prev = lignes[i + 1], oi = x.oi, pc = function (v) { return oi ? fr(v / oi * 100, 1) + '%' : '-'; };
        html += '<tr style="animation-delay:' + Math.min(i * 18, 360) + 'ms"><td>' + x.date.split('-').reverse().join('/') + '</td>' + (a ? '<td>' + fr(oi) + '</td>' : '')
          + '<td>' + fr(x.long) + '</td>' + cv(d(x, prev, 'long')) + '<td>' + fr(x.short) + '</td>' + cv(d(x, prev, 'short'))
          + (sp ? '<td>' + fr(x.spread) + '</td>' + cv(d(x, prev, 'spread')) : '')
          + '<td class="v2a-net ' + (x.net >= 0 ? 'v2a-net-g' : 'v2a-net-r') + '">' + sgn(x.net) + '</td>'
          + (a ? '<td>' + pc(x.long) + '</td><td>' + pc(x.short) + '</td>' + (sp ? '<td>' + pc(x.spread) + '</td>' : '') + '<td class="v2a-net ' + (x.net >= 0 ? 'v2a-net-g' : 'v2a-net-r') + '">' + pc(x.net) + '</td>' : '')
          + (tr ? '<td>' + fr(x.tl) + '</td><td>' + fr(x.ts) + '</td><td>' + fr(x.tsp) + '</td><td>' + fr(x.tt) + '</td><td class="v2a-net ' + ((x.tl - x.ts) >= 0 ? 'v2a-net-g' : 'v2a-net-r') + '">' + (x.tl != null ? sgn(x.tl - x.ts) : '-') + '</td>' : '')
          + '</tr>';
      });
      z('tab').innerHTML = html + '</tbody></table></div><div class="v2a-pp-pied">' + esc(donnees.source || 'CFTC') + ' · ' + esc(donnees.categorie || '') + ' · ' + r.length + ' rapports</div>';
    }
    function charger() {
      ['pos', 'hist', 'tab'].forEach(function (k) { z(k).innerHTML = '<div class="v2a-pp-charge"><i></i><i></i><i></i></div>'; });
      histoCot(ccy, etat.type).then(function (d) {
        if (!g.isConnected) return;
        if (!d || !d.rows) { ['pos', 'hist', 'tab'].forEach(function (k) { z(k).innerHTML = vide('Rapports CFTC indisponibles pour le moment.'); }); return; }
        donnees = d;
        g.querySelectorAll('[data-cat-nom]').forEach(function (s) { s.textContent = d.categorie || ''; });
        dessinerTout();
      });
    }
    g.querySelector('[data-cat]').addEventListener('change', function (e) { etat.type = e.target.value; charger(); });
    g.addEventListener('click', function (e) {
      var b = e.target.closest('[data-chips] button'); if (!b || b.disabled || !donnees) return;
      var n = b.parentNode.dataset.chips;
      if (n === 'sem') etat.sem = +b.dataset.v; else etat.mode = b.dataset.v;
      b.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('v2a-on', x === b); });
      dessinerHist();
    });
    charger();
  }

  /* ══ SAISONNALITÉ ══════════════════════════════════════════════════════════════════════════════ */
  var cacheSais = {};
  function couleurCase(v, mx) {
    if (v == null) return 'transparent';
    var a = Math.min(1, Math.abs(v) / (mx || 1));
    return v >= 0 ? 'rgba(0,200,100,' + (0.14 + a * 0.8).toFixed(2) + ')' : 'rgba(255,61,0,' + (0.14 + a * 0.8).toFixed(2) + ')';
  }
  function enrichirSaison(host, p) {
    var cle = p.replace('/', ''), ctx = drapeaux(p) + '[' + p + ']', nAns = 5;
    var g = poserGrille(host, 'v2a-g-sais',
      panneau('proj', 'Projection saisonnière', ctx, '', 'Ce qui s’est produit, les 15 années précédentes, sur les 54 jours qui suivent cette même date du calendrier, appliqué au dernier cours. Bandes : 68% et 95% des cas observés. Une statistique du passé, pas une prévision.')
      + panneau('projtab', 'Tableau de projection', ctx, '', 'Pour chaque horizon : part des années où la paire a monté, puis les niveaux atteints au 84e centile (haut), à la médiane et au 16e centile (bas).')
      + panneau('heat', 'Performance mois par mois', ctx, puces('ans', [[5, '5 ans'], [10, '10 ans'], [15, '15 ans']], 5), 'Rendement de chaque mois, clôture à clôture (Yahoo Finance). « Moy. » : moyenne des années affichées.')
      + panneau('courbes', 'Année type', ctx, '<span data-leg-courbes></span>', 'Trajectoire cumulée moyenne d’une année civile, jour par jour, sur 5, 10 et 15 ans, et l’année en cours. Trait vertical : aujourd’hui.'));
    var z = function (k) { return g.querySelector('[data-z="' + k + '"]'); };
    var D = null;
    brancherExport(g, {
      proj: function () { var pr = D && D.projection; return pr && ['Projection_' + cle, [['Jour', 'Date', 'Médiane', 'Bas 68%', 'Haut 68%', 'Bas 95%', 'Haut 95%']].concat(pr.bandes.map(function (b) { return [b.h, dateFr(b.t), b.p50, b.p16, b.p84, b.p025, b.p975]; }))]; },
      projtab: function () { var pr = D && D.projection; return pr && ['Projection_tableau_' + cle, [['Horizon', 'Date', 'Probabilité de hausse', 'Haut', 'Médiane', 'Bas']].concat(pr.tableau.map(function (x) { return [x.h + ' j', dateFr(x.t), x.proba, x.haut, x.base, x.bas]; }))]; },
      heat: function () { if (!D) return null; var ans = Object.keys(D.table).sort(); return ['Saisonnalite_' + cle, [['Année'].concat(M)].concat(ans.map(function (a) { return [a].concat(D.table[a]); }))]; },
      courbes: function () { var j = D && D.journalier; return j && ['Annee_type_' + cle, [['Jour', '5 ans', '10 ans', '15 ans', 'Année en cours']].concat(Array.from({ length: 365 }, function (_, i) { return [i + 1, j.a5 && j.a5[i], j.a10 && j.a10[i], j.a15 && j.a15[i], j.cetteAnnee && j.cetteAnnee[i]]; }))]; }
    });
    var dec = function (v) { return v >= 20 ? 3 : 5; };
    function dessinerHeat() {
      var tous = Object.keys(D.table).map(Number).sort(function (a, b) { return a - b; }), ans = tous.slice(-nAns - 1);
      var passes = ans.filter(function (a) { return a < new Date().getUTCFullYear(); }).slice(-nAns);
      var moy = M.map(function (_, m) { var v = passes.map(function (a) { return D.table[a][m]; }).filter(function (x) { return x != null; }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null; });
      var mx = 0; ans.forEach(function (a) { D.table[a].forEach(function (v) { if (v != null) mx = Math.max(mx, Math.abs(v)); }); });
      var cel = function (v, extra) {
        return '<td class="' + (extra || '') + '" style="background:' + couleurCase(v, mx) + '">' + (v == null ? '' : '<span>' + (v >= 0 ? ico.hausse : ico.baisse) + fr(v, 2) + '%</span>') + '</td>';
      };
      z('heat').innerHTML = '<div class="v2a-tab-wrap"><table class="v2a-heat"><thead><tr><th></th>' + ans.map(function (a) { return '<th>’' + String(a).slice(2) + '</th>'; }).join('') + '<th>Moy.</th></tr></thead><tbody>'
        + M.map(function (m, i) { return '<tr class="' + (i === D.moisCourant ? 'v2a-cur' : '') + '" style="animation-delay:' + i * 30 + 'ms"><th>' + m + '</th>' + ans.map(function (a) { return cel(D.table[a][i]); }).join('') + cel(moy[i], 'v2a-moy') + '</tr>'; }).join('')
        + '</tbody></table></div>';
    }
    function dessinerTout() {
      // Projection
      var pr = D.projection;
      if (pr) {
        var X = function (t) { return t; };
        var hist = pr.prix.map(function (x) { return { x: x.t, y: x.c }; });
        var dep = { x: pr.depuis.t, y: pr.depuis.c }, b = pr.bandes;
        var f = function (k) { return [dep].concat(b.map(function (x) { return { x: x.t, y: x[k] }; })); };
        var gx = [], dd = new Date(hist[0].x);
        for (var t = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth() + 1, 1); t < b[b.length - 1].t; t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) gx.push({ x: t, t: M[new Date(t).getUTCMonth()] + ' ' + String(new Date(t).getUTCFullYear()).slice(2) });
        K.lignes(z('proj'), [
          { nom: 'Cours', c: '#d8d8de', pts: hist, epais: 1.4, tagTexte: '' },
          { nom: 'Haut 95%', c: 'rgba(0,230,118,.55)', pts: f('p975'), tirets: true, tagTexte: '95%', legende: false },
          { nom: 'Haut 68%', c: VERT, pts: f('p84'), tirets: true, tagTexte: '68%', legende: false },
          { nom: 'Médiane', c: OR, pts: f('p50'), epais: 2, tagTexte: 'Méd.' },
          { nom: 'Bas 68%', c: ROUGE, pts: f('p16'), tirets: true, tagTexte: '68%', legende: false },
          { nom: 'Bas 95%', c: 'rgba(255,61,0,.55)', pts: f('p025'), tirets: true, tagTexte: '95%', legende: false }
        ], {
          vline: pr.depuis.t, graduationsX: gx, largeurTags: 96,
          bandes: [{ haut: f('p975'), bas: f('p025'), c: OR, op: 0.06 }, { haut: f('p84'), bas: f('p16'), c: OR, op: 0.1 }],
          fmtY: function (v) { return fr(v, dec(v)); }, fmtX: function (x) { return dateFr(X(x)); }
        });
        z('projtab').innerHTML = '<div class="v2a-tab-wrap"><table class="v2a-tab v2a-tab-proj"><thead><tr><th>Horizon</th><th>Probabilité de hausse</th><th>Haut</th><th>Médiane</th><th>Bas</th></tr></thead><tbody>'
          + pr.tableau.map(function (x, i) {
            return '<tr style="animation-delay:' + i * 40 + 'ms"><td>' + x.h + ' jours <small>(' + dateFr(x.t) + ')</small></td><td class="' + (x.proba >= 50 ? 'v2a-g' : 'v2a-r') + '"><span class="v2a-pjauge"><i style="width:' + x.proba + '%"></i></span>' + fr(x.proba, 1) + '%</td>'
              + '<td class="v2a-g">' + fr(x.haut, dec(x.haut)) + '</td><td class="' + (x.base >= pr.depuis.c ? 'v2a-g' : 'v2a-r') + '">' + fr(x.base, dec(x.base)) + '</td><td class="v2a-r">' + fr(x.bas, dec(x.bas)) + '</td></tr>';
          }).join('') + '</tbody></table></div><div class="v2a-pp-pied">Dernier cours ' + fr(pr.depuis.c, dec(pr.depuis.c)) + ' (' + dateFr(pr.depuis.t) + ') · ' + (pr.tableau[0] ? pr.tableau[0].annees : '') + ' années observées · statistique du passé, pas une prévision</div>';
      } else { z('proj').innerHTML = vide('Historique trop court pour une projection.'); z('projtab').innerHTML = vide('Historique trop court pour une projection.'); }
      dessinerHeat();
      // Année type, au jour près
      var j = D.journalier || {}, an = new Date().getUTCFullYear(), jourX = function (i) { return Date.UTC(an, 0, 1) + i * 864e5; };
      var ser = [['a5', '5 ans', OR], ['a10', '10 ans', '#8ab4f8'], ['a15', '15 ans', '#c792ea']].filter(function (s) { return j[s[0]]; }).map(function (s) {
        return { nom: s[1], c: s[2], pts: j[s[0]].map(function (v, i) { return { x: jourX(i), y: v }; }) };
      });
      if (j.cetteAnnee && j.cetteAnnee.length) ser.push({ nom: String(an), c: '#f2f2f5', epais: 1.2, pts: j.cetteAnnee.map(function (v, i) { return { x: jourX(i), y: v }; }) });
      if (ser.length) {
        var leg = g.querySelector('[data-leg-courbes]'); leg.innerHTML = '';
        K.lignes(z('courbes'), ser, {
          zero: true, vline: jourX(j.jourCourant || 0), xMin: jourX(0), xMax: jourX(364), legende: leg,
          graduationsX: M.map(function (m, i) { return { x: Date.UTC(an, i, 15), t: m }; }),
          fmtY: function (v) { return fr(v, 2) + '%'; }, fmtTag: function (v) { return sgn(v, 2) + '%'; }, fmtX: function (x) { var d = new Date(x); return d.getUTCDate() + ' ' + M[d.getUTCMonth()]; }
        });
      } else z('courbes').innerHTML = vide('Historique trop court pour une année type.');
    }
    g.addEventListener('click', function (e) {
      var b = e.target.closest('[data-chips="ans"] button'); if (!b || !D) return;
      nAns = +b.dataset.v; b.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('v2a-on', x === b); });
      dessinerHeat();
    });
    var go = function (d) {
      if (!g.isConnected) return;
      if (!d || !d.table) { ['proj', 'projtab', 'heat', 'courbes'].forEach(function (k) { z(k).innerHTML = vide('Clôtures indisponibles pour ' + p + ' pour le moment.'); }); return; }
      D = d; dessinerTout();
    };
    if (cacheSais[cle]) go(cacheSais[cle]);
    else getJson('/api/v2/saisonnalite?pair=' + cle).then(function (d) { if (d && d.table) cacheSais[cle] = d; go(d); });
  }

  /* ══ PARTICULIERS (DMX) ════════════════════════════════════════════════════════════════════════ */
  function enrichirParticuliers(host, p) {
    var cle = p.replace('/', ''), ctx = drapeaux(p) + '[' + p + ']', pas = 'd';
    var g = poserGrille(host, 'v2a-g-dmx',
      panneau('dmxh', 'Historique des particuliers', ctx, puces('pas', [['h', '1H'], ['d', '1J']], 'd'), 'Part des positions longues et courtes des comptes particuliers (Myfxbook). Myfxbook ne publie que l’instant présent : DTP relève lui-même un point par heure (7 jours) et par jour (120 jours).')
      + panneau('dmxa', 'Positionnement', ctx, '', 'Nombre de positions ouvertes par les particuliers, à la dernière lecture Myfxbook.')
      + panneau('dmxs', 'Statistiques', ctx, '', 'Positions, prix moyens d’entrée et volumes des particuliers. Lecture contrarienne : une foule très majoritairement d’un côté est un signal de positionnement, pas une consigne.'));
    var z = function (k) { return g.querySelector('[data-z="' + k + '"]'); };
    var row = null, histo = null;
    brancherExport(g, {
      dmxh: function () { return histo && histo.points && ['Particuliers_' + cle, [['Date', 'Longs %', 'Shorts %']].concat(histo.points.map(function (x) { return [new Date(x.t).toISOString(), x.long, x.short]; }))]; },
      dmxa: function () { return row && ['Particuliers_' + cle + '_positions', [['Longs', 'Shorts'], [row.longPositions, row.shortPositions]]]; },
      dmxs: function () { return row && ['Particuliers_' + cle + '_stats', [['Champ', 'Valeur']].concat(Object.keys(row).map(function (k) { return [k, row[k]]; }))]; }
    });
    function dessinerHisto() {
      var el = z('dmxh'); el.innerHTML = '<div class="v2a-pp-charge"><i></i><i></i><i></i></div>';
      getJson('/api/v2/particuliers-historique?pair=' + cle + '&pas=' + pas).then(function (d) {
        if (!g.isConnected) return;
        histo = d; el.innerHTML = '';
        var pts = (d && d.points) || [];
        if (pts.length < 2) { el.innerHTML = vide('Historique en cours de constitution' + (d && d.depuis ? ' (relevé par DTP depuis le ' + dateFr(d.depuis) + ')' : '') + ' : il se remplit à chaque lecture Myfxbook.'); return; }
        K.barres100(el, pts, pas === 'h'
          ? { fmtX: function (t) { var x = new Date(t); return x.getUTCDate() + '/' + (x.getUTCMonth() + 1) + ' ' + x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }, fmtTip: function (t) { return new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } }
          : {});
      });
    }
    g.addEventListener('click', function (e) {
      var b = e.target.closest('[data-chips="pas"] button'); if (!b) return;
      pas = b.dataset.v; b.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('v2a-on', x === b); });
      dessinerHisto();
    });
    dessinerHisto();
    getJson('/api/community-outlook?period=H1').then(function (d) {
      if (!g.isConnected) return;
      row = d && d.symbols && d.symbols.filter(function (s) { return s.symbol === cle; })[0];
      if (!row) { z('dmxa').innerHTML = vide(d && d.pending ? 'Lecture Myfxbook en cours…' : 'Paire non couverte par Myfxbook.'); z('dmxs').innerHTML = vide('Indisponible.'); return; }
      z('dmxa').innerHTML = '';
      var lp = row.longPositions, sp = row.shortPositions;
      if (lp != null && sp != null) K.anneau(z('dmxa'), lp, sp, { net: false, fmt: kilo });
      else K.anneau(z('dmxa'), row.longPct, row.shortPct, { net: false, fmt: function (v) { return fr(v, 1) + '%'; } });
      var d5 = function (v) { return v == null ? '-' : fr(v, v >= 20 ? 3 : 5); };
      var lignes = [
        ['Positions longues', fr(lp), 'v2a-g'], ['Positions courtes', fr(sp), 'v2a-r'], ['Total des positions', fr(lp != null && sp != null ? lp + sp : null), ''],
        ['Prix moyen des longs', d5(row.avgLongPrice), 'v2a-g'], ['Prix moyen des shorts', d5(row.avgShortPrice), 'v2a-r'],
        ['Volume long', row.longVolume != null ? fr(row.longVolume, 2) + ' lots' : '-', 'v2a-g'], ['Volume short', row.shortVolume != null ? fr(row.shortVolume, 2) + ' lots' : '-', 'v2a-r'],
        ['Lots par position longue', lp ? fr(row.longVolume / lp, 2) : '-', 'v2a-g'], ['Lots par position courte', sp ? fr(row.shortVolume / sp, 2) : '-', 'v2a-r']
      ];
      if (row.last != null) lignes.push(['Cours actuel', d5(row.last), '']);
      var foule = row.longPct >= 60 ? 'La foule est nettement acheteuse (' + fr(row.longPct, 0) + '% de longs) : lecture contrarienne baissière.' : row.shortPct >= 60 ? 'La foule est nettement vendeuse (' + fr(row.shortPct, 0) + '% de shorts) : lecture contrarienne haussière.' : 'Positionnement équilibré : pas de lecture contrarienne nette.';
      z('dmxs').innerHTML = '<table class="v2a-stats">' + lignes.map(function (l, i) { return '<tr style="animation-delay:' + i * 35 + 'ms"><th>' + l[0] + '</th><td class="' + l[2] + '">' + l[1] + '</td></tr>'; }).join('') + '</table>'
        + '<div class="v2a-pp-pied">' + foule + (d.updatedAt ? ' · Myfxbook, lu le ' + new Date(d.updatedAt).toLocaleString('fr-FR') : '') + '</div>';
    });
  }

  /* ── Détection : le rendu d'origine est posé, la grille ne l'est pas ─────────────────────────────── */
  function verifier() {
    var p = paire(); if (!p) return;
    var c1 = p.slice(0, 3), c2 = p.slice(4);
    var libre = function (id, sel) { var h = document.getElementById(id); return h && h.querySelector(sel) && !h.querySelector('.v2a-pgrid') ? h : null; };
    var h;
    if ((h = libre('sym-sub-cotbase', '.sym-cot'))) enrichirCot(h, c1, p);
    if ((h = libre('sym-sub-cotquote', '.sym-cot'))) enrichirCot(h, c2, p);
    if ((h = libre('sym-sub-seasonality', '.sym-seas'))) enrichirSaison(h, p);
    if ((h = libre('sym-sub-retail', '.sym-rt'))) enrichirParticuliers(h, p);
    document.querySelectorAll('.v2a-pgrid').forEach(function (g) { if (g.offsetParent) hauteur(g); });
  }
  function demarrer() {
    var cont = document.getElementById('sym-content');
    if (cont && window.MutationObserver) new MutationObserver(function () { setTimeout(verifier, 0); }).observe(cont, { childList: true, subtree: true });
    verifier();
    // Un sous-onglet affiché après coup : sa grille prend alors la hauteur visible.
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.sym-subtab')) setTimeout(verifier, 60); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
  window._v2aPaireVerifier = verifier;
  window._v2aGraph = K;   // réutilisé par l'app mobile V2
})();

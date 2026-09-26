/* ═══ DTP V3 · WIDGETS DE MARCHÉ EN DIRECT (comptes admin, « Aperçu V3 ») ══════════════════════════
   Demande user (25/09, captures) : « ces widgets ont l'air comme sur la V2 ; je veux un truc en temps
   réel, dynamique, compréhensible, comme les images de PMT — là on dirait un truc figé, avec du texte ».
   Quatre widgets du desk reçoivent ici leur version V3 : Hauts / bas, Courbe des taux US, Volatilité
   par heure, Variations quotidiennes. Même grammaire que les captures de référence :
     · de VRAIS graphiques : axe gradué, quadrillage discret, repère au survol avec sa valeur ;
     · les valeurs vivantes en PASTILLES calées au bord droit (prix, plus haut, plus bas…) ;
     · un en-tête de chiffres clés en puces, et presque plus de phrases ;
     · le direct : le prix est relu chaque minute (bougies 15 min), une puce « EN DIRECT » le dit.
   ⚠️ LES DONNÉES SONT CELLES DES WIDGETS DU DESK, rien d'inventé : bougies réelles de /api/bank-ohlc
   (15 min, heure, jour, semaine) et rendements de /api/us-yields. Seule la présentation change.
   ⚠️ BORNÉ : widgets.js n'appelle ce montage que sous html.dtp-v2 (admin + interrupteur). Désactivé,
   l'admin retrouve le widget des clients, à l'identique. */
(function () {
  'use strict';
  if (window._v3Widgets) return;
  window._v3Widgets = true;

  var NS = 'http://www.w3.org/2000/svg';
  var OR = '#e3b23a', VERT = '#00e676', ROUGE = '#ff3d00', GRILLE = '#17171c', TXT = '#6f6f78';
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fr = function (v, d) { return (v == null || !isFinite(v)) ? '–' : v.toFixed(d).replace('.', ','); };
  var signe = function (v, d) { return (v > 0 ? '+' : '') + fr(v, d); };
  var pipDe = function (sym) { return /JPY/.test(sym) ? 0.01 : /^(XAU|XAG)/.test(sym) ? 0.1 : 0.0001; };
  var decDe = function (sym) { return /JPY/.test(sym) ? 3 : 5; };

  /* ── Styles (bornés à html.dtp-v2) ─────────────────────────────────────────────────────────── */
  var CSS = ''
    + 'html.dtp-v2 .v3w{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--v3-carte, #0a0a0c);color:var(--v3-texte, #d6d6dc);font:500 11.5px/1.3 "Inter Tight",system-ui,sans-serif;font-variant-numeric:tabular-nums}'
    + 'html.dtp-v2 .v3w-tete{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid var(--v3-ligne, #15151a)}'
    + 'html.dtp-v2 .v3w-nom{font:600 12.5px/1 "Inter Tight",system-ui,sans-serif;color:var(--v3-titre, #f2f2f4);margin-right:2px}'
    + 'html.dtp-v2 .v3w-prix{font:600 15px/1 "Inter Tight",system-ui,sans-serif;color:#f6f6f8}'
    + 'html.dtp-v2 .v3w-puce{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border:1px solid var(--v3-bord, #22222a);border-radius:3px;background:var(--v3-tete, #0f0f12);color:#a1a1aa;font-size:11px;white-space:nowrap}'
    + 'html.dtp-v2 .v3w-puce b{color:var(--v3-titre, #f0f0f3);font-weight:600}'
    + 'html.dtp-v2 .v3w-puce.v3w-h b,html.dtp-v2 .v3w-h{color:' + VERT + '!important}'
    + 'html.dtp-v2 .v3w-puce.v3w-b b,html.dtp-v2 .v3w-b{color:' + ROUGE + '!important}'
    + 'html.dtp-v2 .v3w-live{margin-left:auto;display:inline-flex;align-items:center;gap:5px;color:var(--v3-doux, #8e8e98);font-size:10.5px;letter-spacing:.04em}'
    + 'html.dtp-v2 .v3w-live i{width:6px;height:6px;border-radius:50%;background:' + VERT + ';box-shadow:0 0 0 0 rgba(0,230,118,.6);animation:v3wPouls 2s ease-out infinite}'
    + 'html.dtp-v2 .v3w-live.v3w-ferme i{background:#6f6f78;animation:none}'
    + '@keyframes v3wPouls{0%{box-shadow:0 0 0 0 rgba(0,230,118,.55)}100%{box-shadow:0 0 0 7px rgba(0,230,118,0)}}'
    + 'html.dtp-v2 .v3w-corps{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}'
    + 'html.dtp-v2 .v3w-zone{position:relative;flex:1;min-height:60px}'
    + 'html.dtp-v2 .v3w-zone svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}'
    + 'html.dtp-v2 .v3w-ax{font:500 10px "Inter Tight",system-ui,sans-serif;fill:' + TXT + '}'
    + 'html.dtp-v2 .v3w-pil text{font:600 10px "Inter Tight",system-ui,sans-serif}'
    + 'html.dtp-v2 .v3w-bulle{position:absolute;z-index:5;pointer-events:none;min-width:110px;padding:6px 8px;background:var(--v3-tete, #111114);border:1px solid var(--v3-bord, #2a2a31);border-radius:4px;box-shadow:0 12px 26px -12px rgba(0,0,0,.85);font-size:11px;line-height:1.45;color:var(--v3-texte, #d6d6dc);opacity:0;transition:opacity .1s;white-space:nowrap}'
    + 'html.dtp-v2 .v3w-bulle b{color:var(--v3-titre, #f4f4f6)}'
    + 'html.dtp-v2 .v3w-lignes{display:flex;flex-direction:column;gap:9px;padding:9px 10px 6px}'
    + 'html.dtp-v2 .v3w-rg{display:grid;grid-template-columns:62px 78px 1fr 78px 118px;align-items:center;gap:8px}'
    + 'html.dtp-v2 .v3w-rg>span:first-child{color:var(--v3-doux, #8e8e98);font-weight:600}'
    + 'html.dtp-v2 .v3w-rg .v3w-l{color:' + ROUGE + ';text-align:right}html.dtp-v2 .v3w-rg .v3w-hh{color:' + VERT + '}'
    + 'html.dtp-v2 .v3w-rg em{font-style:normal;color:var(--v3-doux, #8e8e98);text-align:right;font-size:10.5px;white-space:nowrap}'
    + 'html.dtp-v2 .v3w-piste{position:relative;height:6px;border-radius:3px;background:linear-gradient(90deg,rgba(255,61,0,.55),#2a2a30 50%,rgba(0,230,118,.55))}'
    + 'html.dtp-v2 .v3w-cur{position:absolute;top:50%;transform:translate(-50%,-50%);padding:1px 5px;border-radius:3px;background:' + OR + ';color:#0a0a0c;font:700 10px/1.3 "Inter Tight",system-ui,sans-serif;transition:left .6s cubic-bezier(.2,.8,.2,1);white-space:nowrap}'
    + 'html.dtp-v2 .v3w-sep{height:1px;background:var(--v3-ligne, #15151a);margin:2px 0}'
    + 'html.dtp-v2 .v3w-leg{display:flex;gap:10px;flex-wrap:wrap;padding:0 10px 6px;font-size:10.5px;color:var(--v3-doux, #8e8e98)}'
    + 'html.dtp-v2 .v3w-leg i{display:inline-block;width:10px;height:2px;margin-right:5px;vertical-align:middle;border-radius:1px}'
    + 'html.dtp-v2 .v3w-duo{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:1px;background:var(--v3-ligne, #15151a)}'
    + 'html.dtp-v2 .v3w-duo>div{position:relative;background:var(--v3-carte, #0a0a0c);display:flex;flex-direction:column;min-height:0}'
    + 'html.dtp-v2 .v3w-st{padding:6px 10px 0;font:600 10.5px/1 "Inter Tight",system-ui,sans-serif;color:var(--v3-doux, #7c7c86)}'
    + 'html.dtp-v2 .v3w-vide{margin:auto;color:var(--v3-pale, #6f6f78);font-size:12px}'
    + '@media (max-width:560px){html.dtp-v2 .v3w-duo{grid-template-columns:1fr;grid-auto-rows:minmax(0,1fr)}html.dtp-v2 .v3w-rg{grid-template-columns:52px 64px 1fr 64px}html.dtp-v2 .v3w-rg em{display:none}}'
    + 'html.dtp-v2 .v3w-maj-h{animation:v3wMajH 1.2s ease-out}html.dtp-v2 .v3w-maj-b{animation:v3wMajB 1.2s ease-out}'
    + '@keyframes v3wMajH{0%{color:' + VERT + ';text-shadow:0 0 10px rgba(0,230,118,.55)}100%{text-shadow:none}}'
    + '@keyframes v3wMajB{0%{color:' + ROUGE + ';text-shadow:0 0 10px rgba(255,61,0,.55)}100%{text-shadow:none}}'
    + '@media (prefers-reduced-motion:reduce){html.dtp-v2 .v3w-live i{animation:none}html.dtp-v2 .v3w-cur{transition:none}html.dtp-v2 .v3w-maj-h,html.dtp-v2 .v3w-maj-b{animation:none}}';
  function styles() { if (document.getElementById('v3w-css')) return; var s = document.createElement('style'); s.id = 'v3w-css'; s.textContent = CSS; document.head.appendChild(s); }

  /* ── Outils de dessin ───────────────────────────────────────────────────────────────────────── */
  function el(nom, a, parent) { var n = document.createElementNS(NS, nom); for (var k in a) n.setAttribute(k, a[k]); if (parent) parent.appendChild(n); return n; }
  // Graduations « rondes » (1, 2, 2,5, 5 × 10^k) : un axe lisible, jamais 1,13714 / 1,13846.
  function graduations(min, max, n) {
    if (!(max > min)) { max = min + 1; }
    var brut = (max - min) / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(brut))), f = brut / p;
    var pas = (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * p;
    var out = [], a = Math.ceil(min / pas) * pas;
    for (var v = a; v <= max + pas * 1e-9; v += pas) out.push(+v.toFixed(10));
    return { t: out, pas: pas };
  }
  function decPas(pas) { return Math.max(0, Math.min(6, -Math.floor(Math.log10(pas) + 1e-9))); }
  // Pastille calée au bord droit (le cœur visuel des captures de référence).
  function pastille(g, x, y, texte, fond, encre) {
    var w = texte.length * 5.9 + 10, gp = el('g', { class: 'v3w-pil' }, g);
    el('rect', { x: x, y: y - 8, width: w, height: 16, rx: 2, fill: fond }, gp);
    var t = el('text', { x: x + 5, y: y + 3.5, fill: encre || '#0a0a0c' }, gp); t.textContent = texte;
    return w;
  }
  // Écarte verticalement des pastilles qui se chevauchent (même règle que la Force des Devises).
  function ecarter(liste, h) {
    liste.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < liste.length; i++) if (liste[i].y - liste[i - 1].y < 17) liste[i].y = liste[i - 1].y + 17;
    for (var j = liste.length - 1; j >= 0; j--) { var bas = h - 9 - (liste.length - 1 - j) * 17; if (liste[j].y > bas) liste[j].y = bas; }
    return liste;
  }
  function taille(z) { return { w: Math.max(120, z.clientWidth || 300), h: Math.max(60, z.clientHeight || 160) }; }
  function bulle(z) { var b = z.querySelector('.v3w-bulle'); if (!b) { b = document.createElement('div'); b.className = 'v3w-bulle'; z.appendChild(b); } return b; }
  function montrerBulle(z, b, x, y, html) {
    b.innerHTML = html; b.style.opacity = 1;
    var W = z.clientWidth, bw = b.offsetWidth || 130;
    b.style.left = Math.max(4, Math.min(W - bw - 4, x + 12)) + 'px'; b.style.top = Math.max(2, y - 10) + 'px';
  }
  /* HEURE DE PARIS, en nombre. ⚠️ Pas `+format()` en fr-FR : ce format écrit « 14 h », et `+"14 h"`
     vaut NaN — tout l'histogramme horaire tombait dans une seule case. On lit la PART « hour ». */
  var _fmtH = null;
  var heureParis = function (t) {
    try {
      _fmtH = _fmtH || new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' });
      var p = _fmtH.formatToParts(new Date(t)).filter(function (x) { return x.type === 'hour'; })[0];
      var h = p ? parseInt(p.value, 10) % 24 : NaN;
      return isFinite(h) ? h : new Date(t).getHours();
    } catch (e) { return new Date(t).getHours(); }
  };
  var hmParis = function (t) { try { return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(t)); } catch (e) { return ''; } };
  var jourCourt = function (t) { try { return new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }); } catch (e) { return ''; } };
  var enDirect = function (tMaj) { var j = new Date().getUTCDay(), h = new Date().getUTCHours(); var ferme = j === 6 || (j === 0 && h < 21) || (j === 5 && h >= 21); return '<span class="v3w-live' + (ferme ? ' v3w-ferme' : '') + '" title="' + (tMaj ? 'Relu à ' + hmParis(tMaj) : '') + '"><i></i>' + (ferme ? 'MARCHÉ FERMÉ' : 'EN DIRECT') + '</span>'; };

  // Bougies EN DIRECT : 15 min relues chaque minute (le cache des cartes, lui, garde 5 min).
  var direct = Object.create(null);
  function bougiesDirect(sym, tf, ttl) {
    var cle = sym + '|' + tf, e = direct[cle];
    if (e && e.c && Date.now() - e.t < (ttl || 55000)) return Promise.resolve(e.c);
    if (e && e.p) return e.p;
    var url = '/api/bank-ohlc?' + (/^[A-Z]{3}\/[A-Z]{3}$/.test(sym) ? 'pair=' : 'sym=') + encodeURIComponent(sym) + '&tf=' + tf;
    var p = fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var c = ((d && d.candles) || []).filter(function (b) { return b && isFinite(b.t) && isFinite(b.h) && isFinite(b.l) && isFinite(b.c); });
      if (!c.length) throw new Error('vide');
      direct[cle] = { t: Date.now(), c: c }; return c;
    }).catch(function (x) { if (direct[cle]) direct[cle].p = null; if (e && e.c) return e.c; throw x; });
    direct[cle] = { t: e ? e.t : 0, c: e ? e.c : null, p: p };
    return p;
  }
  /* UNE CARTE VIVANTE. `charger(redim)` dessine et rend une promesse ; elle échoue quand la donnée
     manque. Deux cas, volontairement différents :
       · rien n'a encore été dessiné → on rend la main au widget d'ORIGINE (repli), une fois ;
       · un dessin existe déjà → on le GARDE, et le tour suivant réessaie. Un trou réseau d'une
         minute ne doit pas faire basculer une carte vivante vers l'ancienne présentation.
     Le redessin suit la taille de la carte (ResizeObserver) et s'arrête quand elle est démontée. */
  function carte(host, repli, ms, charger) {
    var vivant = true, rendu = false, ro = null, t = null, iv = null;
    function tour(redim) {
      if (!vivant || !host.isConnected || (document.hidden && rendu)) return;
      Promise.resolve().then(function () { return charger(!!redim); }).then(function () { rendu = true; }).catch(function (e) {
        if (!vivant || !host.isConnected || rendu) return;
        arreter(); try { console.warn('[V3] repli sur le widget d’origine :', e && e.message); } catch (_) {}
        repli();
      });
    }
    function arreter() { vivant = false; clearInterval(iv); clearTimeout(t); if (ro) ro.disconnect(); }
    tour();
    iv = setInterval(tour, ms || 60000);
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { clearTimeout(t); t = setTimeout(function () { if (rendu) tour(true); }, 140); }); ro.observe(host); }
    return arreter;
  }
  // Le chiffre qui change CLIGNOTE dans le sens du mouvement (vert à la hausse, rouge à la baisse).
  function clignoter(host, sel, avant, apres) {
    if (avant == null || apres == null || avant === apres) return;
    var e = host.querySelector(sel); if (!e) return;
    e.classList.add(apres > avant ? 'v3w-maj-h' : 'v3w-maj-b');
  }

  /* ══ 1. HAUTS / BAS : les niveaux du jour, de la semaine, du mois, et le prix qui vit dedans ══════ */
  function hautsBas(host, it, orig, O) {
    var W = this, sym = O.opt(it, W, 'paire') || 'EUR/USD', pip = pipDe(sym), dec = decDe(sym), dernier = null;
    styles(); O.skel(host, 4);
    function dessiner() {
      return Promise.all([bougiesDirect(sym, 'M15'), O.bougies(sym, 'D1'), O.bougies(sym, 'W1')]).then(function (r) {
        if (!host.isConnected) return;
        var m15 = r[0], d1 = r[1], w1 = r[2];
        var prix = m15[m15.length - 1].c, jour = d1[d1.length - 1], sem = w1[w1.length - 1];
        // Le mois se RECALCULE depuis les bougies du jour : aucune bougie mensuelle n'est servie.
        var now = new Date(), moisD = d1.filter(function (b) { var d = new Date(b.t); return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth(); });
        var mois = moisD.length ? { h: Math.max.apply(null, moisD.map(function (b) { return b.h; })), l: Math.min.apply(null, moisD.map(function (b) { return b.l; })) } : null;
        var veille = d1.length > 1 ? d1[d1.length - 2].c : null, varJ = veille ? (prix - veille) / veille * 100 : null;
        var niveaux = [['Jour', { h: Math.max(jour.h, prix), l: Math.min(jour.l, prix) }], ['Semaine', { h: Math.max(sem.h, prix), l: Math.min(sem.l, prix) }]];
        if (mois) niveaux.push(['Mois', { h: Math.max(mois.h, prix), l: Math.min(mois.l, prix) }]);
        var h = '<div class="v3w"><div class="v3w-tete"><span class="v3w-nom">' + esc(sym) + '</span><span class="v3w-prix">' + fr(prix, dec) + '</span>'
          + (varJ != null ? '<span class="v3w-puce ' + (varJ >= 0 ? 'v3w-h' : 'v3w-b') + '"><b>' + signe(varJ, 2) + '%</b></span>' : '')
          + enDirect(Date.now()) + '</div><div class="v3w-corps"><div class="v3w-lignes">';
        niveaux.forEach(function (n) {
          var b = n[1], amp = (b.h - b.l) / pip, pos = b.h > b.l ? (prix - b.l) / (b.h - b.l) * 100 : 50;
          h += '<div class="v3w-rg"><span>' + n[0] + '</span><span class="v3w-l">' + fr(b.l, dec) + '</span>'
            + '<div class="v3w-piste"><span class="v3w-cur" style="left:' + Math.max(0, Math.min(100, pos)).toFixed(1) + '%">' + Math.round(pos) + '%</span></div>'
            + '<span class="v3w-hh">' + fr(b.h, dec) + '</span><em>' + Math.round(amp) + ' pips · ↑' + Math.round((b.h - prix) / pip) + ' ↓' + Math.round((prix - b.l) / pip) + '</em></div>';
        });
        h += '</div><div class="v3w-sep"></div><div class="v3w-zone"></div></div></div>';
        host.innerHTML = h;
        tracer(host.querySelector('.v3w-zone'), m15, prix, niveaux);
        clignoter(host, '.v3w-prix', dernier, prix);
        dernier = prix;
      });
    }
    // Le prix des dernières 24 h, avec les plus hauts / plus bas en lignes et en pastilles.
    function tracer(z, m15, prix, niveaux) {
      var T = taille(z), svg = el('svg', { viewBox: '0 0 ' + T.w + ' ' + T.h }, z);
      var serie = m15.filter(function (b) { return b.t >= m15[m15.length - 1].t - 24 * 3600e3; });
      if (serie.length < 4) return;
      var jr = niveaux[0][1], sm = niveaux[1][1];
      var lo = Math.min(jr.l, Math.min.apply(null, serie.map(function (b) { return b.l; }))), hi = Math.max(jr.h, Math.max.apply(null, serie.map(function (b) { return b.h; })));
      var marge = (hi - lo) * 0.12 || pip * 5; lo -= marge; hi += marge;
      var G = { g: 8, d: 78, h: 8, b: 18 }, lw = T.w - G.g - G.d, lh = T.h - G.h - G.b;
      var X = function (i) { return G.g + i / (serie.length - 1) * lw; }, Y = function (v) { return G.h + (hi - v) / (hi - lo) * lh; };
      var gr = graduations(lo, hi, Math.max(2, Math.floor(lh / 34))), dp = Math.max(decPas(gr.pas), 2);
      var pil = ecarter([{ y: Y(prix), t: fr(prix, dec), f: OR }, { y: Y(jr.h), t: 'H ' + fr(jr.h, dec), f: '#0c7a45', e: '#eafff3' }, { y: Y(jr.l), t: 'B ' + fr(jr.l, dec), f: '#a3290a', e: '#fff1ec' }].filter(function (p) { return p.y >= G.h - 2 && p.y <= G.h + lh + 2; }), T.h);
      // Une graduation qui tomberait SOUS une pastille est tue : deux chiffres superposés ne se lisent pas.
      gr.t.forEach(function (v) { var y = Y(v); el('line', { x1: G.g, x2: G.g + lw, y1: y, y2: y, stroke: GRILLE }, svg); if (pil.some(function (p) { return Math.abs(p.y - y) < 12; })) return; var t = el('text', { class: 'v3w-ax', x: G.g + lw + 4, y: y + 3.5 }, svg); t.textContent = fr(v, dp); });
      // Heures pleines sur l'axe du bas.
      serie.forEach(function (b, i) { var hP = heureParis(b.t), m = new Date(b.t).getUTCMinutes(); if (m === 0 && hP % 4 === 0) { var t = el('text', { class: 'v3w-ax', x: X(i), y: T.h - 4, 'text-anchor': 'middle' }, svg); t.textContent = hP + 'h'; } });
      [[jr.h, VERT, ''], [jr.l, ROUGE, ''], [sm.h, VERT, '4 3'], [sm.l, ROUGE, '4 3']].forEach(function (l) { if (l[0] >= lo && l[0] <= hi) el('line', { x1: G.g, x2: G.g + lw, y1: Y(l[0]), y2: Y(l[0]), stroke: l[1], 'stroke-opacity': .55, 'stroke-dasharray': l[2] }, svg); });
      var d = ''; serie.forEach(function (b, i) { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(b.c).toFixed(1); });
      el('path', { d: d + 'L' + X(serie.length - 1) + ',' + (G.h + lh) + 'L' + G.g + ',' + (G.h + lh) + 'Z', fill: 'rgba(227,178,58,.07)' }, svg);
      el('path', { d: d, fill: 'none', stroke: OR, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, svg);
      el('circle', { cx: X(serie.length - 1), cy: Y(prix), r: 3, fill: OR }, svg);
      pil.forEach(function (p) { pastille(svg, G.g + lw + 2, p.y, p.t, p.f, p.e); });
      // Repère au survol : heure et prix.
      var b = bulle(z), ligne = el('line', { y1: G.h, y2: G.h + lh, stroke: '#3a3a42', 'stroke-dasharray': '3 3', opacity: 0 }, svg);
      z.onmousemove = function (e) { var r = z.getBoundingClientRect(), x = e.clientX - r.left, i = Math.round((x - G.g) / lw * (serie.length - 1)); if (i < 0 || i >= serie.length) return; ligne.setAttribute('x1', X(i)); ligne.setAttribute('x2', X(i)); ligne.setAttribute('opacity', 1); montrerBulle(z, b, x, e.clientY - r.top, '<b>' + hmParis(serie[i].t) + '</b> · ' + fr(serie[i].c, dec)); };
      z.onmouseleave = function () { b.style.opacity = 0; ligne.setAttribute('opacity', 0); };
    }
    return carte(host, orig, 60000, dessiner);
  }

  /* ══ 2. COURBE DES TAUX US : la courbe du jour contre celle d'il y a un mois, et 90 jours d'historique ═ */
  var TENEURS = [['m3', '3 mois', '#8b93a7'], ['y5', '5 ans', '#4aa3ff'], ['y10', '10 ans', OR], ['y30', '30 ans', '#c77dff']];
  function tauxUS(host, it, orig, O) {
    var W = this, dernier = null;
    styles(); O.skel(host, 5);
    var donnees = null;
    function dessiner(seulTrace) {
      var p = seulTrace && donnees ? Promise.resolve(donnees) : fetch('/api/us-yields', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; });
      return p.then(function (d) {
        if (!host.isConnected) return;
        var s = d && d.series || {};
        if (!d || !d.ok || !s.m3 || !s.y10 || !s.y10.hist || !s.m3.hist) throw new Error('courbe incomplète');
        donnees = d;
        var ecart = s.y10.last - s.m3.last, h1 = s.y10.hist, ecart30 = null;
        if (s.m3.hist.length > 22 && h1.length > 22) ecart30 = ecart - (h1[h1.length - 22].v - s.m3.hist[s.m3.hist.length - 22].v);
        var forme = ecart > 0.25 ? ['Pentue', 'v3w-h'] : ecart < -0.25 ? ['Inversée', 'v3w-b'] : ['Plate', ''];
        host.innerHTML = '<div class="v3w"><div class="v3w-tete"><span class="v3w-nom">Trésor US</span>'
          + '<span class="v3w-puce">10 ans <b class="v3w-dix">' + fr(s.y10.last, 2) + '%</b></span>'
          + '<span class="v3w-puce ' + (ecart >= 0 ? 'v3w-h' : 'v3w-b') + '">10A-3M <b>' + signe(ecart, 2) + '</b></span>'
          + '<span class="v3w-puce ' + forme[1] + '"><b>' + forme[0] + '</b></span>'
          + (ecart30 != null ? '<span class="v3w-puce">1 mois <b>' + signe(ecart30, 2) + ' pt</b></span>' : '')
          + enDirect(Date.now()) + '</div>'
          + '<div class="v3w-duo"><div><div class="v3w-st">Courbe · aujourd’hui et il y a un mois</div><div class="v3w-zone" data-z="c"></div></div>'
          + '<div><div class="v3w-st">Rendements · 90 jours</div><div class="v3w-zone" data-z="h"></div>'
          + '<div class="v3w-leg">' + TENEURS.filter(function (t) { return s[t[0]]; }).map(function (t) { return '<span><i style="background:' + t[2] + '"></i>' + t[1] + '</span>'; }).join('') + '</div></div></div></div>';
        courbe(host.querySelector('[data-z=c]'), s);
        historique(host.querySelector('[data-z=h]'), s);
        clignoter(host, '.v3w-dix', dernier, s.y10.last);
        dernier = s.y10.last;
      });
    }
    function courbe(z, s) {
      var T = taille(z), svg = el('svg', { viewBox: '0 0 ' + T.w + ' ' + T.h }, z);
      var pts = TENEURS.filter(function (t) { return s[t[0]]; }), avant = pts.map(function (t) { var hh = s[t[0]].hist; return hh.length > 22 ? hh[hh.length - 22].v : null; });
      var vals = pts.map(function (t) { return s[t[0]].last; }).concat(avant.filter(function (v) { return v != null; }));
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), m = (hi - lo) * 0.18 || 0.1; lo -= m; hi += m;
      var G = { g: 36, d: 14, h: 12, b: 20 }, lw = T.w - G.g - G.d, lh = T.h - G.h - G.b;
      var X = function (i) { return G.g + (pts.length > 1 ? i / (pts.length - 1) : .5) * lw; }, Y = function (v) { return G.h + (hi - v) / (hi - lo) * lh; };
      var gr = graduations(lo, hi, Math.max(2, Math.floor(lh / 30)));
      gr.t.forEach(function (v) { el('line', { x1: G.g, x2: G.g + lw, y1: Y(v), y2: Y(v), stroke: GRILLE }, svg); var t = el('text', { class: 'v3w-ax', x: G.g - 5, y: Y(v) + 3.5, 'text-anchor': 'end' }, svg); t.textContent = fr(v, 2) + '%'; });
      pts.forEach(function (t, i) { var tx = el('text', { class: 'v3w-ax', x: X(i), y: T.h - 5, 'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle' }, svg); tx.textContent = t[1]; });
      var dA = '', dN = '';
      pts.forEach(function (t, i) { if (avant[i] != null) dA += (dA ? 'L' : 'M') + X(i) + ',' + Y(avant[i]); dN += (i ? 'L' : 'M') + X(i) + ',' + Y(s[t[0]].last); });
      if (dA) el('path', { d: dA, fill: 'none', stroke: '#5a5a64', 'stroke-width': 1.3, 'stroke-dasharray': '4 3' }, svg);
      el('path', { d: dN, fill: 'none', stroke: OR, 'stroke-width': 2 }, svg);
      pts.forEach(function (t, i) {
        var v = s[t[0]].last, dv = avant[i] != null ? (v - avant[i]) * 100 : null;
        el('circle', { cx: X(i), cy: Y(v), r: 3.2, fill: OR, stroke: '#0a0a0c', 'stroke-width': 1.5 }, svg);
        /* L'étiquette se pose du côté LIBRE de la courbe : au-dessus d'un sommet, sous un creux,
           et en travers d'une pente, du côté où le segment ne passe pas. */
        var pv = i > 0 ? s[pts[i - 1][0]].last : null, nx = i < pts.length - 1 ? s[pts[i + 1][0]].last : null;
        var sous = false, anc = 'middle', dx = 0;
        if (pv == null) { anc = 'start'; sous = nx > v; dx = 4; }
        else if (nx == null) { anc = 'end'; sous = pv > v; dx = -4; }
        else if (pv < v && nx < v) { anc = 'middle'; }
        else if (pv > v && nx > v) { sous = true; }
        else if (nx > v) { anc = 'end'; dx = -7; }                  // pente montante : à gauche, au-dessus
        else { anc = 'start'; dx = 7; }                               // pente descendante : à droite, au-dessus
        var lb = el('text', { class: 'v3w-ax', x: X(i) + dx, y: Y(v) + (sous ? 15 : -8), 'text-anchor': anc, style: 'fill:#ececf0;font-weight:600' }, svg);
        lb.textContent = fr(v, 2) + '%' + (dv != null ? ' ' : '');
        if (dv != null) { var ts = el('tspan', { style: 'fill:' + (dv >= 0 ? VERT : ROUGE) }, lb); ts.textContent = signe(dv, 0) + ' pb'; }
      });
    }
    function historique(z, s) {
      var T = taille(z), svg = el('svg', { viewBox: '0 0 ' + T.w + ' ' + T.h }, z);
      var ser = TENEURS.filter(function (t) { return s[t[0]] && s[t[0]].hist.length > 1; });
      var ref = s.y10.hist, n = ref.length, tous = [];
      ser.forEach(function (t) { s[t[0]].hist.forEach(function (p) { tous.push(p.v); }); });
      var lo = Math.min.apply(null, tous), hi = Math.max.apply(null, tous), m = (hi - lo) * 0.08 || 0.1; lo -= m; hi += m;
      var G = { g: 6, d: 58, h: 8, b: 18 }, lw = T.w - G.g - G.d, lh = T.h - G.h - G.b;
      var t0 = ref[0].t, t1 = ref[n - 1].t, X = function (t) { return G.g + (t - t0) / Math.max(1, t1 - t0) * lw; }, Y = function (v) { return G.h + (hi - v) / (hi - lo) * lh; };
      var gr = graduations(lo, hi, Math.max(2, Math.floor(lh / 30)));
      gr.t.forEach(function (v) { el('line', { x1: G.g, x2: G.g + lw, y1: Y(v), y2: Y(v), stroke: GRILLE }, svg); });
      for (var k = 0; k < n; k += Math.max(1, Math.round(n / 4))) { var tx = el('text', { class: 'v3w-ax', x: X(ref[k].t), y: T.h - 4, 'text-anchor': k === 0 ? 'start' : 'middle' }, svg); tx.textContent = jourCourt(ref[k].t); }
      var pil = [];
      ser.forEach(function (t) {
        var hh = s[t[0]].hist, d = '';
        hh.forEach(function (p, i) { d += (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1); });
        el('path', { d: d, fill: 'none', stroke: t[2], 'stroke-width': t[0] === 'y10' ? 1.8 : 1.3, 'stroke-linejoin': 'round' }, svg);
        pil.push({ y: Y(hh[hh.length - 1].v), t: fr(hh[hh.length - 1].v, 2) + '%', f: t[2] });
      });
      ecarter(pil, T.h).forEach(function (p) { pastille(svg, G.g + lw + 3, p.y, p.t, p.f); });
      var b = bulle(z), ligne = el('line', { y1: G.h, y2: G.h + lh, stroke: '#3a3a42', 'stroke-dasharray': '3 3', opacity: 0 }, svg);
      z.onmousemove = function (e) {
        var r = z.getBoundingClientRect(), x = e.clientX - r.left, t = t0 + (x - G.g) / lw * (t1 - t0), i = 0;
        for (var q = 0; q < n; q++) if (Math.abs(ref[q].t - t) < Math.abs(ref[i].t - t)) i = q;
        ligne.setAttribute('x1', X(ref[i].t)); ligne.setAttribute('x2', X(ref[i].t)); ligne.setAttribute('opacity', 1);
        montrerBulle(z, b, x, e.clientY - r.top, '<b>' + jourCourt(ref[i].t) + '</b><br>' + ser.map(function (tt) { var hh = s[tt[0]].hist, j = 0; for (var q2 = 0; q2 < hh.length; q2++) if (Math.abs(hh[q2].t - ref[i].t) < Math.abs(hh[j].t - ref[i].t)) j = q2; return '<span style="color:' + tt[2] + '">●</span> ' + tt[1] + ' ' + fr(hh[j].v, 2) + '%'; }).join('<br>'));
      };
      z.onmouseleave = function () { b.style.opacity = 0; ligne.setAttribute('opacity', 0); };
    }
    return carte(host, orig, 120000, dessiner);
  }

  /* ══ 3. VOLATILITÉ PAR HEURE : la journée type, et l'heure en cours qui se remplit en direct ═══════ */
  var SESSIONS = [['Asie', 1, 9, '#4aa3ff'], ['Londres', 9, 17, OR], ['New York', 14, 22, VERT]];
  function volHoraire(host, it, orig, O) {
    var W = this, sym = O.opt(it, W, 'paire') || 'EUR/USD', pip = pipDe(sym), dernier = null;
    styles(); O.skel(host, 5);
    var moy = null;
    function dessiner() {
      return Promise.all([O.bougies(sym, 'H1'), bougiesDirect(sym, 'M15')]).then(function (r) {
        if (!host.isConnected) return;
        var h1 = r[0], m15 = r[1];
        if (h1.length < 200) throw new Error('historique horaire trop court');
        // Moyenne par heure de PARIS, bougie par bougie (juste de part et d'autre d'un changement
        // d'heure) ; la dernière bougie, encore ouverte, n'entre pas dans la moyenne.
        var som = new Array(24).fill(0), nb = new Array(24).fill(0);
        h1.slice(0, -1).forEach(function (b) { var hP = heureParis(b.t), a = (b.h - b.l) / pip; if (a > 0 && a < 1000) { som[hP] += a; nb[hP]++; } });
        moy = som.map(function (v, i) { return nb[i] ? v / nb[i] : 0; });
        var jourMoy = moy.reduce(function (a, b) { return a + b; }, 0) / 24;
        var hNow = heureParis(Date.now()), debut = Date.now() - (new Date().getUTCMinutes() * 60e3 + new Date().getUTCSeconds() * 1e3);
        var enCours = m15.filter(function (b) { return b.t >= debut - 1000; }), ampNow = enCours.length ? (Math.max.apply(null, enCours.map(function (b) { return b.h; })) - Math.min.apply(null, enCours.map(function (b) { return b.l; }))) / pip : 0;
        var pic = 0; moy.forEach(function (v, i) { if (v > moy[pic]) pic = i; });
        var ratio = moy[hNow] ? ampNow / moy[hNow] : null;
        host.innerHTML = '<div class="v3w"><div class="v3w-tete"><span class="v3w-nom">' + esc(sym) + '</span>'
          + '<span class="v3w-puce">Pic <b>' + pic + 'h-' + ((pic + 1) % 24) + 'h</b> · ' + fr(moy[pic], 1) + ' p</span>'
          + '<span class="v3w-puce">Moy. horaire <b>' + fr(jourMoy, 1) + ' p</b></span>'
          + '<span class="v3w-puce ' + (ratio != null && ratio >= 1 ? 'v3w-h' : '') + '">' + hNow + 'h en cours <b class="v3w-now">' + fr(ampNow, 1) + ' p</b>' + (ratio != null ? ' · ' + Math.round(ratio * 100) + '% de sa moyenne' : '') + '</span>'
          + enDirect(Date.now()) + '</div><div class="v3w-corps"><div class="v3w-zone"></div>'
          + '<div class="v3w-leg">' + SESSIONS.map(function (s) { return '<span><i style="background:' + s[3] + '"></i>' + s[0] + '</span>'; }).join('') + '<span><i style="background:#f4f4f6"></i>Heure en cours, en direct</span></div></div></div>';
        tracer(host.querySelector('.v3w-zone'), moy, jourMoy, hNow, ampNow, nb);
        clignoter(host, '.v3w-now', dernier, ampNow);
        dernier = ampNow;
      });
    }
    function tracer(z, moy, jourMoy, hNow, ampNow, nb) {
      var T = taille(z), svg = el('svg', { viewBox: '0 0 ' + T.w + ' ' + T.h }, z);
      var max = Math.max(Math.max.apply(null, moy), ampNow) * 1.12 || 1;
      var G = { g: 30, d: 54, h: 10, b: 30 }, lw = T.w - G.g - G.d, lh = T.h - G.h - G.b, bw = lw / 24;
      var Y = function (v) { return G.h + (1 - v / max) * lh; };
      graduations(0, max, Math.max(2, Math.floor(lh / 30))).t.forEach(function (v) { el('line', { x1: G.g, x2: G.g + lw, y1: Y(v), y2: Y(v), stroke: GRILLE }, svg); var t = el('text', { class: 'v3w-ax', x: G.g - 5, y: Y(v) + 3.5, 'text-anchor': 'end' }, svg); t.textContent = fr(v, 0); });
      moy.forEach(function (v, i) {
        var x = G.g + i * bw + bw * 0.14, w = bw * 0.72, cur = i === hNow, k = Math.min(1, v / max);
        el('rect', { x: x, y: Y(v), width: w, height: Math.max(0, G.h + lh - Y(v)), rx: 1.5, fill: cur ? OR : 'rgba(227,178,58,' + (0.22 + 0.45 * k).toFixed(2) + ')' }, svg);
        if (i % 3 === 0) { var t = el('text', { class: 'v3w-ax', x: G.g + i * bw + bw / 2, y: G.h + lh + 12, 'text-anchor': 'middle' }, svg); t.textContent = i + 'h'; }
      });
      // L'heure en cours se remplit EN DIRECT : son amplitude réalisée, par-dessus sa moyenne.
      var xc = G.g + hNow * bw + bw * 0.14, wc = bw * 0.72;
      el('rect', { x: xc - 1, y: Y(ampNow), width: wc + 2, height: Math.max(1.5, G.h + lh - Y(ampNow)), rx: 1.5, fill: 'none', stroke: '#f4f4f6', 'stroke-width': 1.4 }, svg);
      // Bandes des sessions sous l'axe.
      SESSIONS.forEach(function (s, k) { el('rect', { x: G.g + s[1] * bw, y: G.h + lh + 16 + k * 3.2, width: (s[2] - s[1]) * bw, height: 2.2, rx: 1, fill: s[3], opacity: .8 }, svg); });
      el('line', { x1: G.g, x2: G.g + lw, y1: Y(jourMoy), y2: Y(jourMoy), stroke: '#8e8e98', 'stroke-dasharray': '4 3' }, svg);
      ecarter([{ y: Y(jourMoy), t: 'moy ' + fr(jourMoy, 1), f: '#3a3a42', e: '#f0f0f3' }, { y: Y(ampNow), t: hNow + 'h ' + fr(ampNow, 1), f: '#f4f4f6' }], T.h).forEach(function (p) { pastille(svg, G.g + lw + 3, p.y, p.t, p.f, p.e); });
      var b = bulle(z);
      z.onmousemove = function (e) { var r = z.getBoundingClientRect(), x = e.clientX - r.left, i = Math.floor((x - G.g) / bw); if (i < 0 || i > 23) { b.style.opacity = 0; return; } montrerBulle(z, b, x, e.clientY - r.top, '<b>' + i + 'h-' + ((i + 1) % 24) + 'h</b> · ' + fr(moy[i], 1) + ' pips<br>×' + fr(moy[i] / (jourMoy || 1), 1) + ' la moyenne · ' + nb[i] + ' séances'); };
      z.onmouseleave = function () { b.style.opacity = 0; };
    }
    return carte(host, orig, 60000, dessiner);
  }

  /* ══ 4. VARIATIONS QUOTIDIENNES : la forme des séances, et la séance du jour qui s'y déplace ═══════ */
  function variations(host, it, orig, O) {
    var W = this, sym = O.opt(it, W, 'paire') || 'EUR/USD', pas = +(O.opt(it, W, 'pas') || 0.25), dernier = null;
    if (!(pas > 0)) pas = 0.25;
    styles(); O.skel(host, 5);
    function dessiner() {
      return Promise.all([O.bougies(sym, 'D1'), bougiesDirect(sym, 'M15')]).then(function (r) {
        if (!host.isConnected) return;
        var d1 = r[0], m15 = r[1];
        // La dernière bougie (séance en cours) n'a pas de clôture : elle est exclue de la forme.
        var var_ = [];
        for (var i = 1; i < d1.length - 1; i++) { var ecartJ = (d1[i].t - d1[i - 1].t) / 864e5; if (ecartJ > 0 && ecartJ <= 4) var_.push((d1[i].c - d1[i - 1].c) / d1[i - 1].c * 100); }
        if (var_.length < 60) throw new Error('moins de 60 séances');
        var prix = m15[m15.length - 1].c, veille = d1[d1.length - 2].c, auj = (prix - veille) / veille * 100;
        var n = var_.length, moyV = var_.reduce(function (a, b) { return a + b; }, 0) / n, sd = Math.sqrt(var_.reduce(function (a, b) { return a + (b - moyV) * (b - moyV); }, 0) / n);
        var hausse = var_.filter(function (v) { return v > 0; }).length / n * 100, rang = var_.filter(function (v) { return v <= auj; }).length / n * 100;
        host.innerHTML = '<div class="v3w"><div class="v3w-tete"><span class="v3w-nom">' + esc(sym) + '</span>'
          + '<span class="v3w-puce ' + (auj >= 0 ? 'v3w-h' : 'v3w-b') + '">Aujourd’hui <b class="v3w-auj">' + signe(auj, 2) + '%</b> · P' + Math.round(rang) + '</span>'
          + '<span class="v3w-puce">Hausse <b>' + Math.round(hausse) + '%</b></span>'
          + '<span class="v3w-puce">Écart-type <b>' + fr(sd, 2) + '%</b></span>'
          + '<span class="v3w-puce">Séances <b>' + n + '</b></span>'
          + enDirect(Date.now()) + '</div><div class="v3w-corps"><div class="v3w-zone"></div></div></div>';
        tracer(host.querySelector('.v3w-zone'), var_, auj, moyV, sd, rang);
        clignoter(host, '.v3w-auj', dernier, auj);
        dernier = auj;
      });
    }
    function tracer(z, var_, auj, moyV, sd, rang) {
      var T = taille(z), svg = el('svg', { viewBox: '0 0 ' + T.w + ' ' + T.h }, z);
      var borne = Math.max(pas * 4, Math.ceil(Math.max(Math.abs(auj), sd * 3) / pas) * pas), nC = Math.round(2 * borne / pas), cls = new Array(nC).fill(0);
      var_.forEach(function (v) { var k = Math.floor((Math.max(-borne, Math.min(borne - 1e-9, v)) + borne) / pas); cls[k]++; });
      var pic = var_.length * pas / ((sd || 1) * Math.sqrt(2 * Math.PI));        // sommet de la loi normale
      var max = Math.max(Math.max.apply(null, cls), pic) * 1.1 || 1;
      var G = { g: 30, d: 12, h: 12, b: 20 }, lw = T.w - G.g - G.d, lh = T.h - G.h - G.b, cw = lw / nC;
      var X = function (v) { return G.g + (v + borne) / (2 * borne) * lw; }, Y = function (c) { return G.h + (1 - c / max) * lh; };
      graduations(0, max, Math.max(2, Math.floor(lh / 30))).t.forEach(function (v) { el('line', { x1: G.g, x2: G.g + lw, y1: Y(v), y2: Y(v), stroke: GRILLE }, svg); var t = el('text', { class: 'v3w-ax', x: G.g - 5, y: Y(v) + 3.5, 'text-anchor': 'end' }, svg); t.textContent = Math.round(v); });
      cls.forEach(function (c, k) { var bas = -borne + k * pas, milieu = bas + pas / 2; el('rect', { x: G.g + k * cw + cw * 0.08, y: Y(c), width: cw * 0.84, height: Math.max(0, G.h + lh - Y(c)), rx: 1.2, fill: milieu < 0 ? 'rgba(255,61,0,.78)' : 'rgba(0,230,118,.72)' }, svg); });
      // La loi normale de même moyenne et même écart-type, en filet : la forme « attendue ».
      var d = '';
      for (var q = 0; q <= 120; q++) { var v = -borne + q / 120 * 2 * borne, dens = Math.exp(-0.5 * Math.pow((v - moyV) / (sd || 1), 2)) / ((sd || 1) * Math.sqrt(2 * Math.PI)); d += (q ? 'L' : 'M') + X(v).toFixed(1) + ',' + Y(dens * var_.length * pas).toFixed(1); }
      el('path', { d: d, fill: 'none', stroke: '#d6d6dc', 'stroke-width': 1, 'stroke-opacity': .45, 'stroke-dasharray': '3 3' }, svg);
      graduations(-borne, borne, Math.max(3, Math.floor(lw / 70))).t.forEach(function (v) { var t = el('text', { class: 'v3w-ax', x: X(v), y: T.h - 5, 'text-anchor': 'middle' }, svg); t.textContent = (v > 0 ? '+' : '') + fr(v, v % 1 ? (Math.abs(v * 10) % 1 ? 2 : 1) : 0) + '%'; });
      el('line', { x1: X(0), x2: X(0), y1: G.h, y2: G.h + lh, stroke: '#3a3a42' }, svg);
      // La séance du jour, EN DIRECT : un trait d'or qui glisse, et sa pastille.
      var xa = X(Math.max(-borne, Math.min(borne, auj)));
      el('line', { x1: xa, x2: xa, y1: G.h, y2: G.h + lh, stroke: OR, 'stroke-width': 1.6 }, svg);
      var lib = signe(auj, 2) + '% · P' + Math.round(rang), wl = lib.length * 5.9 + 10;
      pastille(svg, Math.max(G.g, Math.min(G.g + lw - wl, xa - wl / 2)), G.h + 6, lib, OR);
      var b = bulle(z);
      z.onmousemove = function (e) { var r = z.getBoundingClientRect(), x = e.clientX - r.left, k = Math.floor((x - G.g) / cw); if (k < 0 || k >= nC) { b.style.opacity = 0; return; } var bas = -borne + k * pas; montrerBulle(z, b, x, e.clientY - r.top, '<b>' + signe(bas, 2) + '% à ' + signe(bas + pas, 2) + '%</b><br>' + cls[k] + ' séances · ' + fr(cls[k] / var_.length * 100, 1) + '%'); };
      z.onmouseleave = function () { b.style.opacity = 0; };
    }
    return carte(host, orig, 60000, dessiner);
  }

  /* ══ 5. HORAIRES DES MARCHÉS : les quatre places sur 24 h, ce qui est ouvert, et quand ça se croise ═══
     Référence user (image 4, « Exchange Market Hours », « en mieux ») : une piste par place, barre de
     séance, pastille OUVERT / FERMÉ, trait « maintenant » qui traverse tout. Ce qu'on y ajoute :
       · les CHEVAUCHEMENTS dessinés (pic de liquidité), au lieu d'une phrase qui le dit ;
       · la séance ouverte se REMPLIT : la part écoulée est pleine, le reste en transparence ;
       · l'heure locale de chaque place, et le compte à rebours sous la pastille ;
       · au survol : l'horaire chez vous ET sur place.
     ⚠️ Mêmes calculs que la frise des clients (outils.frise) : aucun horaire recopié ici. */
  var TONS = { Sydney: '#4a86c8', Tokyo: '#b8566f', Londres: '#e3b23a', 'New York': '#3fae6e' };
  var CSS_H = ''
    + 'html.dtp-v2 .v3h{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--v3-carte, #0a0a0c);color:var(--v3-texte, #d6d6dc);font:500 11.5px/1.3 "Inter Tight",system-ui,sans-serif;font-variant-numeric:tabular-nums;padding:0 10px 8px}'
    + 'html.dtp-v2 .v3h-tete{display:flex;align-items:center;gap:8px;min-height:30px;border-bottom:1px solid var(--v3-ligne, #15151a);margin:0 -10px;padding:0 10px}'
    + 'html.dtp-v2 .v3h-etat{color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}html.dtp-v2 .v3h-etat b{color:#00e676;font-weight:600}'
    + 'html.dtp-v2 .v3h-grille{position:relative;flex:1;min-height:0;display:grid;grid-template-columns:112px minmax(0,1fr) 108px;grid-template-rows:20px repeat(4,minmax(26px,1fr)) 18px;column-gap:10px}'
    + 'html.dtp-v2 .v3h-axe{grid-column:2;grid-row:1;position:relative}'
    + 'html.dtp-v2 .v3h-axe span{position:absolute;bottom:3px;transform:translateX(-50%);font-size:10px;color:var(--v3-pale, #6f6f78)}'
    + 'html.dtp-v2 .v3h-axe span:first-child{transform:none}html.dtp-v2 .v3h-axe span:last-child{transform:translateX(-100%)}'
    + 'html.dtp-v2 .v3h-nom{grid-column:1;display:flex;flex-direction:column;justify-content:center;min-width:0}'
    + 'html.dtp-v2 .v3h-nom b{display:flex;align-items:center;gap:6px;color:var(--v3-doux, #8e8e98);font-weight:600;font-size:12px}'
    + 'html.dtp-v2 .v3h-nom b i{width:6px;height:6px;border-radius:50%;background:#3a3a42;flex:none}'
    + 'html.dtp-v2 .v3h-nom em{font-style:normal;color:#5c5c66;font-size:10.5px;padding-left:12px}'
    + 'html.dtp-v2 .v3h-ouvert .v3h-nom b{color:var(--v3-titre, #f2f2f4)}html.dtp-v2 .v3h-ouvert .v3h-nom b i{background:var(--ton);box-shadow:0 0 0 3px color-mix(in srgb,var(--ton) 25%,transparent)}'
    + 'html.dtp-v2 .v3h-piste{grid-column:2;position:relative;margin:5px 0;border-radius:4px;background:var(--v3-tete, #0f0f12);box-shadow:inset 0 0 0 1px #17171c}'
    + 'html.dtp-v2 .v3h-bloc{position:absolute;top:0;bottom:0;border-radius:4px;background:color-mix(in srgb,var(--ton) 30%,var(--v3-tete, #0f0f12));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ton) 55%,transparent);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:default}'
    + 'html.dtp-v2 .v3h-bloc b{position:relative;z-index:1;font-weight:600;font-size:11px;color:color-mix(in srgb,var(--ton) 35%,var(--v3-titre, #f4f4f6));white-space:nowrap;padding:0 6px}'
    + 'html.dtp-v2 .v3h-ouvert .v3h-bloc{background:color-mix(in srgb,var(--ton) 34%,var(--v3-tete, #0f0f12));box-shadow:inset 0 0 0 1px var(--ton),0 0 14px -4px var(--ton)}'
    + 'html.dtp-v2 .v3h-ouvert .v3h-bloc b{color:#fff}'
    + 'html.dtp-v2 .v3h-fait{position:absolute;top:0;bottom:0;background:var(--ton);opacity:.72;border-radius:4px 0 0 4px}'
    + 'html.dtp-v2 .v3h-ouvert .v3h-bloc b{text-shadow:0 1px 2px rgba(0,0,0,.55)}'
    + 'html.dtp-v2 .v3h-cote{grid-column:3;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:2px;min-width:0}'
    + 'html.dtp-v2 .v3h-pil{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:3px;font:700 10px/1 "Inter Tight",system-ui,sans-serif;letter-spacing:.05em;border:1px solid rgba(255,61,0,.55);color:#ff6a3d;background:rgba(255,61,0,.07)}'
    + 'html.dtp-v2 .v3h-ouvert .v3h-pil{border-color:rgba(0,230,118,.6);color:#00e676;background:rgba(0,230,118,.08)}'
    + 'html.dtp-v2 .v3h-bientot .v3h-pil{border-color:rgba(227,178,58,.6);color:var(--v3-or-texte, #e3b23a);background:rgba(227,178,58,.08)}'
    + 'html.dtp-v2 .v3h-cote em{font-style:normal;font-size:10.5px;color:var(--v3-pale, #6f6f78);white-space:nowrap}'
    + 'html.dtp-v2 .v3h-calque{grid-column:2;grid-row:1/-1;position:relative;pointer-events:none}'
    + 'html.dtp-v2 .v3h-croise{position:absolute;top:20px;bottom:18px;background:repeating-linear-gradient(135deg,rgba(227,178,58,.07) 0 6px,rgba(227,178,58,.02) 6px 12px);border-left:1px dashed rgba(227,178,58,.25);border-right:1px dashed rgba(227,178,58,.25)}'
    + 'html.dtp-v2 .v3h-croise span{position:absolute;bottom:-17px;left:50%;transform:translateX(-50%);font-size:9.5px;color:#9a8455;white-space:nowrap}'
    + 'html.dtp-v2 .v3h-now{position:absolute;top:16px;bottom:16px;border-left:1.5px dashed #e3b23a;transition:left .8s ease}'
    + 'html.dtp-v2 .v3h-now::before{content:"";position:absolute;top:-4px;left:-5px;border:4px solid transparent;border-top:5px solid #e3b23a}'
    + 'html.dtp-v2 .v3h-nowlbl{position:absolute;bottom:0;transform:translateX(-50%);padding:1px 6px;border-radius:3px;background:#e3b23a;color:#0a0a0c;font:700 10px/1.4 "Inter Tight",system-ui,sans-serif;white-space:nowrap;transition:left .8s ease;z-index:2}'
    + 'html.dtp-v2 .v3h-nowlbl small{font-weight:600;opacity:.7;margin-left:4px;font-size:9px;letter-spacing:.05em}'
    + 'html.dtp-v2 .v3h-bulle{position:absolute;z-index:5;pointer-events:none;padding:6px 8px;background:var(--v3-tete, #111114);border:1px solid var(--v3-bord, #2a2a31);border-radius:4px;box-shadow:0 12px 26px -12px rgba(0,0,0,.85);font-size:11px;line-height:1.45;opacity:0;transition:opacity .1s;white-space:nowrap}'
    + 'html.dtp-v2 .v3h-bulle b{color:var(--v3-titre, #f4f4f6)}'
    + 'html.dtp-v2 .v3h.est-bas .v3h-nom em,html.dtp-v2 .v3h.est-bas .v3h-cote em{display:none}'
    + 'html.dtp-v2 .v3h.est-etroit .v3h-grille{grid-template-columns:70px minmax(0,1fr) 70px;column-gap:6px}'
    + 'html.dtp-v2 .v3h.est-etroit .v3h-nom b{font-size:11px;white-space:nowrap}'
    + 'html.dtp-v2 .v3h.est-etroit .v3h-nom em span,html.dtp-v2 .v3h.est-etroit .v3h-cote em{display:none}'
    + 'html.dtp-v2 .v3h.est-etroit .v3h-pil{padding:0 5px;font-size:9px;letter-spacing:.03em}'
    + 'html.dtp-v2 .v3h-bloc .v3h-c,html.dtp-v2 .v3h.est-etroit .v3h-bloc .v3h-l{display:none}html.dtp-v2 .v3h.est-etroit .v3h-bloc .v3h-c{display:inline}'
    + 'html.dtp-v2 .v3h.est-etroit .v3h-bloc b{font-size:10px;padding:0 3px}'
    + 'html.dtp-v2 .v3h.est-etroit .v3h-axe .v3h-imp{display:none}'
    + '@media (prefers-reduced-motion:reduce){html.dtp-v2 .v3h-now,html.dtp-v2 .v3h-nowlbl{transition:none}}';
  function stylesH() { if (document.getElementById('v3h-css')) return; var st = document.createElement('style'); st.id = 'v3h-css'; st.textContent = CSS_H; document.head.appendChild(st); }

  function horaires(host, it, orig, O) {
    var W = this;
    // La carte du monde reste celle des clients : seule la frise change de présentation.
    if (O.opt(it, W, 'vue') !== 'frise' || !O.frise) { orig.call(W, host, it); return null; }
    styles(); stylesH();
    var F = O.frise, pct = function (h) { return (h / 24 * 100).toFixed(3) + '%'; };
    // « 23h » quand l'heure est ronde, « 23h30 » sinon : la version courte des cartes étroites.
    var court = function (x) { var t = F.hf(x).split(':'); return (+t[0]) + 'h' + (t[1] !== '00' ? t[1] : ''); };
    host.innerHTML = '<div class="v3h"><div class="v3h-tete"><span class="v3h-etat"></span>' + enDirect() + '</div>'
      + '<div class="v3h-grille"></div><div class="v3h-bulle"></div></div>';
    var cadre = host.querySelector('.v3h'), grille = host.querySelector('.v3h-grille'), etat = host.querySelector('.v3h-etat'), bul = host.querySelector('.v3h-bulle');
    var infos = [];
    // Les plages où au moins deux places sont ouvertes, au quart d'heure, avec leurs noms.
    function croisements(now) {
      var cases = [];
      for (var q = 0; q < 96; q++) {
        var h = q / 4 + 0.125, qui = [];
        F.places.forEach(function (p) { F.segments(p, now).forEach(function (sg) { if (h >= sg[0] && h < sg[1]) qui.push(p.nom); }); });
        cases.push(qui);
      }
      var out = [], cur = null;
      cases.forEach(function (qui, q) {
        var cle = qui.length >= 2 ? qui.join(' × ') : '';
        if (cle && cur && cur.cle === cle) cur.b = (q + 1) / 4;
        else { if (cur) out.push(cur); cur = cle ? { cle: cle, a: q / 4, b: (q + 1) / 4 } : null; }
      });
      if (cur) out.push(cur);
      return out;
    }
    function dessiner() {
      if (!host.isConnected) return;
      var now = new Date(), nowH = now.getHours() + now.getMinutes() / 60;
      var ouvertes = [], suivante = null, h = '';
      palier();
      var etroit = cadre.classList.contains('est-etroit'), pxH = Math.max(1, (grille.clientWidth || 400) - (etroit ? 152 : 240)) / 24;
      h += '<div class="v3h-axe">' + [0, 3, 6, 9, 12, 15, 18, 21, 24].map(function (x) { return '<span' + (x % 6 ? ' class="v3h-imp"' : '') + ' style="left:' + pct(x) + '">' + x + 'h</span>'; }).join('') + '</div>';
      infos = [];
      F.places.forEach(function (p, i) {
        var e = F.etat(p, now), dec = F.decalage(p.tz, now), segs = F.segments(p, now), ton = TONS[p.nom] || p.ton;
        var plage = F.hf(p.ouv - dec) + ' – ' + F.hf(p.fer - dec), bientot = !e.ouvert && e.mins > 0 && e.mins <= 45;
        if (e.ouvert) ouvertes.push(p.nom); else if (!suivante || e.mins < suivante.mins) suivante = { nom: p.nom, mins: e.mins };
        var local = ''; try { local = now.toLocaleTimeString('fr-FR', { timeZone: p.tz, hour: '2-digit', minute: '2-digit' }); } catch (x) {}
        infos.push({ nom: p.nom, plage: plage, surPlace: F.hf(p.ouv) + ' – ' + F.hf(p.fer), e: e, local: local });
        // Part ÉCOULÉE de la séance ouverte, en heures lecteur (elle peut enjamber minuit).
        var fait = [];
        if (e.ouvert) {
          var ecoule = (p.fer - p.ouv) - e.mins / 60, debut = ((nowH - ecoule) % 24 + 24) % 24;
          fait = debut <= nowH ? [[debut, nowH]] : [[debut, 24], [0, nowH]];
        }
        var large = 0; segs.forEach(function (sg, k) { if (sg[1] - sg[0] > segs[large][1] - segs[large][0]) large = k; });
        var classe = e.ouvert ? ' v3h-ouvert' : bientot ? ' v3h-bientot' : '';
        var row = 'grid-row:' + (i + 2);
        h += '<div class="v3h-nom' + classe + '" style="' + row + ';--ton:' + ton + '"><b><i></i>' + esc(p.nom) + '</b><em>' + local + '<span> sur place</span></em></div>';
        h += '<div class="v3h-piste' + classe + '" style="' + row + ';--ton:' + ton + '">' + segs.map(function (sg, k) {
          var w = sg[1] - sg[0], dedans = fait.map(function (f) { var a = Math.max(f[0], sg[0]), b = Math.min(f[1], sg[1]); return b > a ? '<span class="v3h-fait" style="left:' + ((a - sg[0]) / w * 100).toFixed(2) + '%;width:' + ((b - a) / w * 100).toFixed(2) + '%"></span>' : ''; }).join('');
          // L'horaire n'est écrit que s'il TIENT dans la barre (largeur réelle de la piste mesurée).
          var tient = k === large && w * pxH >= (etroit ? 44 : 84);
          return '<span class="v3h-bloc" data-i="' + i + '" style="left:' + pct(sg[0]) + ';width:' + pct(w) + '">' + dedans
            + (tient ? '<b><span class="v3h-l">' + plage + '</span><span class="v3h-c">' + court(p.ouv - dec) + '–' + court(p.fer - dec) + '</span></b>' : '') + '</span>';
        }).join('') + '</div>';
        h += '<div class="v3h-cote' + classe + '" style="' + row + '"><span class="v3h-pil">' + (e.ouvert ? 'OUVERT' : bientot ? 'BIENTÔT' : 'FERMÉ') + '</span>'
          + (e.mins ? '<em>' + (e.ouvert ? 'ferme dans ' : 'ouvre dans ') + F.duree(e.mins) + '</em>' : '') + '</div>';
      });
      // Calque : chevauchements, puis le trait « maintenant » qui traverse les quatre places.
      h += '<div class="v3h-calque">' + croisements(now).map(function (c) {
        var w = c.b - c.a, court = c.cle.replace('Londres × New York', 'Londres × NY');
        // L'étiquette se tait quand le repère « maintenant » passe dessous : deux pastilles
        // superposées ne se lisent pas, et la bande dorée du chevauchement suffit à le dire.
        var libre = w >= 2.5 && (nowH < c.a - 1.6 || nowH > c.b + 1.6);
        return '<span class="v3h-croise" style="left:' + pct(c.a) + ';width:' + pct(w) + '" title="' + esc(c.cle) + ' : ' + F.hf(c.a) + ' – ' + F.hf(c.b) + '">' + (libre ? '<span>' + esc(court) + '</span>' : '') + '</span>';
      }).join('')
        + '<span class="v3h-now" style="left:' + pct(nowH) + '"></span>'
        + '<span class="v3h-nowlbl" style="left:' + pct(nowH) + '">' + F.hf(nowH) + '<small>MAINTENANT</small></span></div>';
      grille.innerHTML = h;
      // Plusieurs places ouvertes : leurs noms suffisent (25/09, « supprime "ouvertes · pic de liquidité" »).
      etat.innerHTML = ouvertes.length ? '<b>' + ouvertes.map(esc).join(' · ') + '</b>'
        + (ouvertes.length > 1 ? '' : ' ouverte' + (suivante ? ' · ' + esc(suivante.nom) + ' dans ' + F.duree(suivante.mins) : ''))
        : (suivante ? 'Tout est fermé · ' + esc(suivante.nom) + ' ouvre dans ' + F.duree(suivante.mins) : 'Tout est fermé');
      var live = cadre.querySelector('.v3w-live'); if (live) live.outerHTML = enDirect();
      palier();
    }
    function palier() { var hh = cadre.clientHeight, ww = cadre.clientWidth; cadre.classList.toggle('est-bas', hh > 0 && hh < 230); cadre.classList.toggle('est-etroit', ww > 0 && ww < 470); }
    grille.onmousemove = function (ev) {
      var b = ev.target.closest && ev.target.closest('.v3h-bloc'); if (!b) { bul.style.opacity = 0; return; }
      var x = infos[+b.dataset.i]; if (!x) return;
      var r = cadre.getBoundingClientRect();
      bul.innerHTML = '<b>' + esc(x.nom) + '</b> · ' + x.plage + ' chez vous<br>' + x.surPlace + ' sur place (' + x.local + ')<br>' + (x.e.ouvert ? 'ferme dans ' : 'ouvre dans ') + F.duree(x.e.mins);
      bul.style.opacity = 1;
      var bw = bul.offsetWidth || 180;
      bul.style.left = Math.max(4, Math.min(r.width - bw - 4, ev.clientX - r.left + 12)) + 'px'; bul.style.top = Math.max(2, ev.clientY - r.top + 12) + 'px';
    };
    grille.onmouseleave = function () { bul.style.opacity = 0; };
    // Le desk du lecteur écrit les heures ; si le lecteur change de fuseau ou de jour, on suit.
    dessiner();
    var iv = setInterval(dessiner, 30000), ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(palier); ro.observe(cadre); }
    return function () { clearInterval(iv); if (ro) ro.disconnect(); };
  }


  /* ══ 6. SENTIMENT DE RISQUE (25/09, « le design ne reflète pas la V3 », capture) ═════════════════════
     Même source que la jauge du desk (instantané partagé `dtp-risk`, sinon /api/risk-sentiment), et
     l'historique 60 jours du desk (/api/risk-history). Présentation V3 : une jauge tracée en SVG (pas
     de moteur de graphique à charger), l'aiguille qui glisse jusqu'au score, le régime en toutes
     lettres, puis les MOTEURS : chaque actif suivi, sa variation, et le sens où il pousse (vers le
     risk-on ou le risk-off). En bas, la trace des 60 dernières séances, zéro marqué. */
  var RISQUE_FR = { 'STRONG RISK-ON': 'Fort appétit', 'RISK-ON': 'Appétit', 'WEAK RISK-ON': 'Léger appétit', 'NEUTRAL': 'Neutre', 'WEAK RISK-OFF': 'Légère aversion', 'RISK-OFF': 'Aversion', 'STRONG RISK-OFF': 'Forte aversion' };
  var teinteRisque = function (p) { return p >= 15 ? VERT : p <= -15 ? ROUGE : OR; };
  function stylesR() {
    if (document.getElementById('v3r-css')) return;
    var st = document.createElement('style'); st.id = 'v3r-css';
    st.textContent = ''
      + 'html.dtp-v2 .v3r-duo{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1px;background:var(--v3-ligne, #15151a)}'
      + 'html.dtp-v2 .v3r-duo>div{position:relative;background:var(--v3-carte, #0a0a0c);display:flex;flex-direction:column;min-height:0}'
      + 'html.dtp-v2 .v3r-jauge{flex:1;min-height:90px;position:relative}'
      + 'html.dtp-v2 .v3r-jauge svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}'
      + 'html.dtp-v2 .v3r-aig{transition:transform 1s cubic-bezier(.2,.8,.2,1);transform-box:view-box}'
      + 'html.dtp-v2 .v3r-score{font:700 22px/1 "Inter Tight",system-ui,sans-serif;fill:var(--v3-titre, #f2f2f4)}'
      + 'html.dtp-v2 .v3r-regime{font:600 11px/1 "Inter Tight",system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase}'
      + 'html.dtp-v2 .v3r-mot{display:grid;grid-template-columns:minmax(64px,1fr) 60px minmax(60px,1.2fr);align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid var(--v3-ligne, #141417)}'
      + 'html.dtp-v2 .v3r-mot b{font-weight:600;color:var(--v3-titre, #ececf0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + 'html.dtp-v2 .v3r-mot span{text-align:right;font-variant-numeric:tabular-nums}'
      + 'html.dtp-v2 .v3r-barre{position:relative;height:6px;border-radius:3px;background:var(--v3-tete, #121215)}'
      + 'html.dtp-v2 .v3r-barre::before{content:"";position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--v3-bord, #2a2a31)}'
      + 'html.dtp-v2 .v3r-barre i{position:absolute;top:0;bottom:0;border-radius:3px;transition:width .6s cubic-bezier(.2,.8,.2,1)}'
      + 'html.dtp-v2 .v3r-liste{flex:1;min-height:0;overflow-y:auto}'
      + 'html.dtp-v2 .v3r-histo{height:74px;flex:0 0 74px;position:relative;border-top:1px solid var(--v3-ligne, #15151a)}'
      + 'html.dtp-v2 .v3r-histo svg{position:absolute;inset:0;width:100%;height:100%}'
      + '@container (max-width:520px){html.dtp-v2 .v3r-duo{grid-template-columns:1fr;grid-auto-rows:minmax(0,1fr)}}'
      + '@media (prefers-reduced-motion:reduce){html.dtp-v2 .v3r-aig,html.dtp-v2 .v3r-barre i{transition:none}}';
    document.head.appendChild(st);
  }
  function risque(host, it, orig, O) {
    styles(); stylesR(); O.skel(host, 4);
    var dernier = null, histo = null;
    function lireHisto() {
      if (histo) return Promise.resolve(histo);
      return fetch('/api/risk-history?days=60', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { histo = (d && Array.isArray(d.series)) ? d.series.filter(function (e) { return e && typeof e.pct === 'number'; }) : []; return histo; })
        .catch(function () { histo = []; return histo; });
    }
    // Relu à chaque tour (la minute) ; l'instantané partagé du desk sert de repli si la lecture échoue.
    function lireRisque() {
      return fetch('/api/risk-sentiment', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
        .then(function (d) { if (!d || d.error || !d.label) throw new Error('sentiment indisponible'); return d; })
        .catch(function (e) { if (window._dtpRisk && window._dtpRisk.label) return window._dtpRisk; throw e; });
    }
    function jauge(z, pct) {
      var t = taille(z), W = t.w, H = t.h;
      var r = Math.max(30, Math.min(W / 2 - 18, H - 30)), cx = W / 2, cy = Math.min(H - 16, r + 18);
      var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
      var defs = el('defs', {}, svg), g = el('linearGradient', { id: 'v3r-grad', x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
      [[0, ROUGE], [.35, '#e88a28'], [.5, OR], [.65, '#a9c64a'], [1, VERT]].forEach(function (s) { el('stop', { offset: s[0], 'stop-color': s[1] }, g); });
      var pt = function (v, rr) { var a = Math.PI * (1 - (v + 100) / 200); return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)]; };
      var a0 = pt(-100, r), a1 = pt(100, r);
      el('path', { d: 'M' + a0[0] + ',' + a0[1] + ' A' + r + ',' + r + ' 0 0 1 ' + a1[0] + ',' + a1[1], fill: 'none', stroke: 'url(#v3r-grad)', 'stroke-width': Math.max(6, r * .13), 'stroke-linecap': 'round', opacity: .9 }, svg);
      [-100, -50, 0, 50, 100].forEach(function (v) {
        var p1 = pt(v, r + Math.max(6, r * .13) / 2 + 3), p2 = pt(v, r + Math.max(6, r * .13) / 2 + 8);
        el('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: TXT, 'stroke-width': 1 }, svg);
      });
      // L'aiguille est dessinée à zéro puis TOURNÉE : la transition CSS la fait glisser jusqu'au score.
      var ai = el('g', { class: 'v3r-aig', style: 'transform-origin:' + cx + 'px ' + cy + 'px;transform:rotate(0deg)' }, svg);
      el('path', { d: 'M' + (cx - 4) + ',' + cy + ' L' + cx + ',' + (cy - r * .78) + ' L' + (cx + 4) + ',' + cy + ' Z', fill: teinteRisque(pct) }, ai);
      el('circle', { cx: cx, cy: cy, r: 5, fill: 'var(--v3-carte, #0a0a0c)', stroke: teinteRisque(pct), 'stroke-width': 2 }, svg);
      var sc = el('text', { x: cx, y: cy - r * .34, 'text-anchor': 'middle', class: 'v3r-score' }, svg); sc.textContent = signe(pct, 1);
      z.innerHTML = ''; z.appendChild(svg);
      requestAnimationFrame(function () { ai.style.transform = 'rotate(' + (pct / 100 * 90) + 'deg)'; });
    }
    function tracerHisto(z, serie) {
      if (!z || !serie || serie.length < 2) { if (z) z.innerHTML = '<div class="v3w-vide">Historique indisponible.</div>'; return; }
      var t = taille(z), W = t.w, H = t.h, pad = 8;
      var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
      var x = function (i) { return pad + i * (W - 2 * pad) / (serie.length - 1); }, y = function (v) { return H / 2 - v / 100 * (H / 2 - 6); };
      el('line', { x1: pad, x2: W - pad, y1: y(0), y2: y(0), stroke: GRILLE, 'stroke-width': 1 }, svg);
      var d = serie.map(function (e, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(e.pct).toFixed(1); }).join('');
      el('path', { d: d + 'L' + x(serie.length - 1) + ',' + y(0) + 'L' + x(0) + ',' + y(0) + 'Z', fill: OR, opacity: .08 }, svg);
      el('path', { d: d, fill: 'none', stroke: OR, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }, svg);
      var dz = serie[serie.length - 1];
      el('circle', { cx: x(serie.length - 1), cy: y(dz.pct), r: 3, fill: teinteRisque(dz.pct) }, svg);
      var lb = el('text', { x: pad, y: 11, class: 'v3w-ax' }, svg); lb.textContent = '60 séances';
      z.innerHTML = ''; z.appendChild(svg);
    }
    function dessinerAvec(d) { return Promise.all([Promise.resolve(d), lireHisto()]).then(rendre).catch(function () {}); }
    function dessiner(redim) { return Promise.all([lireRisque(), lireHisto()]).then(function (r) { return rendre(r, redim); }); }
    function rendre(r, redim) {
        if (!host.isConnected) return;
        var d = r[0], serie = r[1];
        var pct = Math.max(-100, Math.min(100, typeof d.pct === 'number' ? d.pct : (d.score || 0) * 50));
        var teinte = teinteRisque(pct), on = 0, off = 0;
        var mots = (Array.isArray(d.assets) ? d.assets : []).filter(function (a) { return a && typeof a.chg === 'number'; })
          .map(function (a) { var s = a.chg * (+a.dir || 0); if (s > 0) on++; else if (s < 0) off++; return { nom: a.label, chg: a.chg, s: s }; })
          .sort(function (a, b) { return Math.abs(b.s) - Math.abs(a.s); });
        var maxS = mots.reduce(function (m, a) { return Math.max(m, Math.abs(a.s)); }, 0.01);
        if (!redim || !host.querySelector('.v3r-duo')) {
          host.innerHTML = '<div class="v3w" style="container-type:inline-size"><div class="v3w-tete"><span class="v3w-nom">Sentiment de risque</span>'
            + '<span class="v3w-puce v3r-reg" style="color:' + teinte + ';border-color:' + teinte + '55"><b style="color:' + teinte + '">' + esc(RISQUE_FR[d.label] || d.label) + '</b></span>'
            + '<span class="v3w-puce">Score <b class="v3r-sc">' + signe(pct, 1) + '</b></span>'
            + '<span class="v3w-puce v3w-h">Risk-on <b>' + on + '</b></span><span class="v3w-puce v3w-b">Risk-off <b>' + off + '</b></span>'
            + enDirect(Date.now()) + '</div>'
            + '<div class="v3w-corps"><div class="v3r-duo"><div><div class="v3w-st">Jauge</div><div class="v3r-jauge"></div></div>'
            + '<div><div class="v3w-st">Moteurs du jour</div><div class="v3r-liste">' + (mots.length ? mots.map(function (a) {
              var w = Math.round(Math.abs(a.s) / maxS * 50), c = a.s > 0 ? VERT : a.s < 0 ? ROUGE : TXT;
              return '<div class="v3r-mot" title="' + esc(a.nom) + ' : ' + (a.s > 0 ? 'pousse vers le risk-on' : a.s < 0 ? 'pousse vers le risk-off' : 'neutre') + '"><b>' + esc(a.nom) + '</b>'
                + '<span style="color:' + (a.chg >= 0 ? VERT : ROUGE) + '">' + signe(a.chg, 2) + '%</span>'
                + '<div class="v3r-barre"><i style="background:' + c + ';' + (a.s >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w + '%"></i></div></div>';
            }).join('') : '<div class="v3w-vide">Aucun moteur relu pour le moment.</div>') + '</div></div></div>'
            + '<div class="v3r-histo"></div></div></div>';
        }
        jauge(host.querySelector('.v3r-jauge'), pct);
        tracerHisto(host.querySelector('.v3r-histo'), serie);
        clignoter(host, '.v3r-sc', dernier, pct);
        dernier = pct;
    }
    var stop = carte(host, orig, 60000, dessiner);
    // Le desk pousse chaque nouvel instantané : on redessine tout de suite, sans attendre la minute.
    function onRisk(e) { if (e && e.detail && e.detail.label && host.isConnected) dessinerAvec(e.detail); }
    window.addEventListener('dtp-risk', onRisk);
    return function () { window.removeEventListener('dtp-risk', onRisk); stop(); };
  }


  /* ── Branchement : widgets.js appelle ces montages sous html.dtp-v2 seulement ──────────────────── */
  var MONTAGES = { 'hauts-bas': hautsBas, 'courbe-taux-us': tauxUS, 'vol-horaire': volHoraire, 'distribution-variations': variations, 'sessions': horaires, 'risque-jauge': risque };
  window._v3WidgetsMontages = MONTAGES;             // pour les bancs
  function brancher() {
    if (!window.DTPWidgets || typeof DTPWidgets.v3Montage !== 'function') return false;
    Object.keys(MONTAGES).forEach(function (id) { DTPWidgets.v3Montage(id, MONTAGES[id]); });
    return true;
  }
  if (!brancher()) { var n = 0; (function r() { if (brancher() || ++n > 100) return; setTimeout(r, 100); })(); }
})();

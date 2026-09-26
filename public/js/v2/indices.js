/* ═══ DTP V3 · WIDGETS DES INDICES (comptes admin, « Aperçu V3 ») ═══════════════════════════════════
   Multi-actifs, étape 5 (26/09) : des widgets PROPRES à une classe, en commençant par les indices.
   Deux cartes pour la bibliothèque de Mon Desk, rangées sous « Indices » par le filtre de marché :
   · Indices mondiaux : les grandes places par région (Amériques, Europe, Asie), chacune avec sa
     variation du jour en teinte, son état de séance (ouverte, ou dans combien de temps elle ouvre)
     et, en tête, la largeur du mouvement (combien montent, combien baissent). Un clic ouvre la
     fiche de l'indice.
   · Régime de volatilité : le VIX et sa courbe à terme (9 jours, 1, 3 et 6 mois). Une courbe qui
     monte avec l'échéance est la norme (marché calme) ; INVERSÉE, elle dit que le stress est
     immédiat. Le niveau du VIX se lit aussi face à sa propre année (rang sur 12 mois).
   Données : /api/v2/multi-actifs (déjà servie) et /api/v2/vix-structure (admin), relues tant que la
   carte est visible. Chaque attente a sa sortie : message d'indisponibilité, nouvel essai auto. */
(function () {
  'use strict';
  if (window._v3Indices) return;
  window._v3Indices = true;

  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var nf = function (v, d) { return v == null ? '·' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var signe = function (v, d) { return v == null ? '·' : (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), d) + '%'; };

  /* ── Les places : fuseau, séance (heures LOCALES), pause de midi, et le code de la fiche ────── */
  var PLACES = {
    '^GSPC': { r: 'am', code: 'US500', tz: 'America/New_York', o: 570, f: 960 },
    '^NDX': { r: 'am', code: 'US100', tz: 'America/New_York', o: 570, f: 960 },
    '^DJI': { r: 'am', code: 'US30', tz: 'America/New_York', o: 570, f: 960 },
    '^GDAXI': { r: 'eu', code: 'DE40', tz: 'Europe/Berlin', o: 540, f: 1050 },
    '^FCHI': { r: 'eu', code: 'FR40', tz: 'Europe/Paris', o: 540, f: 1050 },
    '^FTSE': { r: 'eu', code: 'UK100', tz: 'Europe/London', o: 480, f: 990 },
    '^STOXX50E': { r: 'eu', code: 'EU50', tz: 'Europe/Berlin', o: 540, f: 1050 },
    '^N225': { r: 'as', code: 'JP225', tz: 'Asia/Tokyo', o: 540, f: 930, p: [690, 750] },
    '^HSI': { r: 'as', code: 'HK50', tz: 'Asia/Hong_Kong', o: 570, f: 960, p: [720, 780] },
  };
  var REGIONS = [['am', 'Amériques'], ['eu', 'Europe'], ['as', 'Asie']];
  var JOURS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  // Jour de semaine et minute LOCALE de la place (Intl : les changements d'heure sont gérés).
  function local(tz, t) {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
      var g = function (k) { return (p.filter(function (x) { return x.type === k; })[0] || {}).value; };
      return { j: JOURS[g('weekday')], m: (+g('hour') % 24) * 60 + +g('minute') };
    } catch (e) { return null; }
  }
  // Ouverte ? Sinon, dans combien de minutes ? (Les jours fériés ne sont pas connus ici : un
  // indice qui ne bouge pas un jour ouvré se lit d'abord à sa variation nulle.)
  function etatPlace(P, t) {
    var L = local(P.tz, t); if (!L) return null;
    var ouvre = L.j >= 1 && L.j <= 5;
    if (ouvre && L.m >= P.o && L.m < P.f && !(P.p && L.m >= P.p[0] && L.m < P.p[1])) return { ouvert: true, mins: P.f - L.m };
    if (ouvre && P.p && L.m >= P.p[0] && L.m < P.p[1]) return { ouvert: false, pause: true, mins: P.p[1] - L.m };
    if (ouvre && L.m < P.o) return { ouvert: false, mins: P.o - L.m };
    // Prochain jour ouvré.
    var n = 1, j = (L.j + 1) % 7; while (j === 0 || j === 6) { n++; j = (j + 1) % 7; }
    return { ouvert: false, mins: (n - 1) * 1440 + (1440 - L.m) + P.o };
  }
  function duree(m) { if (m < 60) return m + ' min'; var h = Math.floor(m / 60), r = m % 60; if (h >= 24) { var jr = Math.floor(h / 24); return jr + ' j ' + (h % 24) + ' h'; } return h + ' h' + (r ? ' ' + (r < 10 ? '0' : '') + r : ''); }
  // Teinte d'une tuile : vert ou rouge selon le sens, intensité selon l'ampleur (plein à ±2%).
  function teinte(chg) {
    var a = Math.min(1, Math.abs(chg) / 2), f = (0.1 + a * 0.42).toFixed(2);
    if (Math.abs(chg) < 0.05) return 'rgba(142,142,152,.10)';
    return chg > 0 ? 'rgba(0,230,118,' + f + ')' : 'rgba(255,61,0,' + f + ')';
  }

  var CSS = ''
    + 'html.dtp-v2 .v3i{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--v3-carte, #0a0a0c);color:var(--v3-texte, #d6d6dc);font:500 11.5px/1.3 "Inter Tight",system-ui,sans-serif;font-variant-numeric:tabular-nums;container-type:inline-size}'
    + 'html.dtp-v2 .v3i-tete{display:flex;align-items:center;gap:10px;padding:7px 10px;border-bottom:1px solid var(--v3-ligne, #16161a)}'
    + 'html.dtp-v2 .v3i-large{display:flex;align-items:center;gap:8px;flex:1;min-width:0}html.dtp-v2 .v3i-large b{font:600 12px/1 "Inter Tight",system-ui,sans-serif;color:var(--v3-titre, #ececf0);white-space:nowrap}'
    + 'html.dtp-v2 .v3i-jauge{flex:1;max-width:160px;height:5px;border-radius:3px;overflow:hidden;display:flex;background:var(--v3-trait, #1c1c21)}html.dtp-v2 .v3i-jauge i{display:block;height:100%}'
    + 'html.dtp-v2 .v3i-corps{flex:1;min-height:0;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:9px}'
    + 'html.dtp-v2 .v3i-reg h6{margin:0 0 5px;font:600 10.5px/1 "Inter Tight",system-ui,sans-serif;color:var(--v3-doux, #8e8e98);text-transform:uppercase;letter-spacing:.06em}'
    + 'html.dtp-v2 .v3i-tuiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:5px}'
    + 'html.dtp-v2 .v3i-t{position:relative;border:1px solid var(--v3-bord, #1f1f25);border-radius:6px;padding:8px 9px 7px;cursor:pointer;display:flex;flex-direction:column;gap:5px;transition:border-color .15s,transform .15s}'
    + 'html.dtp-v2 .v3i-t:hover{border-color:rgba(227,178,58,.6);transform:translateY(-1px)}'
    + 'html.dtp-v2 .v3i-t-h{display:flex;align-items:center;gap:6px}html.dtp-v2 .v3i-t-h b{font:600 12px/1.1 "Inter Tight",system-ui,sans-serif;color:var(--v3-titre, #f2f2f4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'html.dtp-v2 .v3i-pt{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:#4a4a52}html.dtp-v2 .v3i-t.ouvert .v3i-pt{background:#00e676;box-shadow:0 0 0 0 rgba(0,230,118,.5);animation:v3iPouls 2s infinite}'
    + '@keyframes v3iPouls{0%{box-shadow:0 0 0 0 rgba(0,230,118,.45)}70%{box-shadow:0 0 0 5px rgba(0,230,118,0)}100%{box-shadow:0 0 0 0 rgba(0,230,118,0)}}'
    + 'html.dtp-v2 .v3i-t-v{display:flex;align-items:baseline;justify-content:space-between;gap:6px}html.dtp-v2 .v3i-t-v span{font:500 11.5px/1 ui-monospace,Menlo,monospace;color:var(--v3-doux, #a6a6b0)}'
    + 'html.dtp-v2 .v3i-t-v strong{font:700 14px/1 ui-monospace,Menlo,monospace;color:var(--v3-titre, #f2f2f4)}'
    + 'html.dtp-v2 .v3i-t em{font-style:normal;font-size:10.5px;color:var(--v3-doux, #8e8e98)}html.dtp-v2 .v3i-t.ouvert em{color:#7fe3ae}'
    + 'html.dtp-v2 .v3i-t.ko{cursor:default;opacity:.6}'
    + 'html.dtp-v2 .v3i-pied{padding:5px 10px;border-top:1px solid var(--v3-ligne, #16161a);font-size:10.5px;color:var(--v3-pale, #6f6f78)}'
    + 'html.dtp-v2 .v3i-vide{padding:26px 12px;text-align:center;color:var(--v3-pale, #6f6f78);font-size:12px}'
    // Régime de volatilité.
    + 'html.dtp-v2 .v3x-haut{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:center;padding:10px 12px 6px}'
    + 'html.dtp-v2 .v3x-niv{display:flex;flex-direction:column;gap:4px}html.dtp-v2 .v3x-niv strong{font:700 28px/1 ui-monospace,Menlo,monospace;color:var(--v3-titre, #f2f2f4)}'
    + 'html.dtp-v2 .v3x-niv span{font:600 12px/1 ui-monospace,Menlo,monospace}'
    + 'html.dtp-v2 .v3x-pil{display:inline-flex;align-self:flex-start;align-items:center;gap:5px;padding:4px 8px;border-radius:10px;font:700 10.5px/1 "Inter Tight",system-ui,sans-serif;text-transform:uppercase;letter-spacing:.05em}'
    + 'html.dtp-v2 .v3x-lec{margin:0;font-size:12px;line-height:1.45;color:var(--v3-texte, #c9c9d1)}'
    + 'html.dtp-v2 .v3x-courbe{position:relative;flex:1;min-height:120px;margin:4px 12px 0}html.dtp-v2 .v3x-courbe svg{position:absolute;left:0;top:0;overflow:visible}'
    + 'html.dtp-v2 .v3x-bas{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:8px 12px 10px}'
    + 'html.dtp-v2 .v3x-b h6{margin:0 0 5px;font:600 10.5px/1 "Inter Tight",system-ui,sans-serif;color:var(--v3-doux, #8e8e98);text-transform:uppercase;letter-spacing:.06em}'
    + 'html.dtp-v2 .v3x-b b{font:600 13px/1.2 ui-monospace,Menlo,monospace;color:var(--v3-titre, #ececf0)}html.dtp-v2 .v3x-b p{margin:3px 0 0;font-size:11px;color:var(--v3-doux, #8e8e98)}'
    + 'html.dtp-v2 .v3x-rang{margin-top:6px;height:4px;border-radius:2px;background:var(--v3-trait, #1c1c21);overflow:hidden}html.dtp-v2 .v3x-rang i{display:block;height:100%;border-radius:2px;background:#e3b23a}'
    + '@container (max-width:420px){html.dtp-v2 .v3x-haut{grid-template-columns:1fr}html.dtp-v2 .v3i-tuiles{grid-template-columns:repeat(2,minmax(0,1fr))}}';
  function styles() { if (document.getElementById('v3i-styles')) return; var s = document.createElement('style'); s.id = 'v3i-styles'; s.textContent = CSS; document.head.appendChild(s); }
  var lire = function (url) { return (window.dtpFetchBorne ? window.dtpFetchBorne(url, { credentials: 'same-origin' }, 20000) : fetch(url, { credentials: 'same-origin' })).then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; }); };
  var ouvrirFiche = function (code) { if (code && window.DTPRechercheActifs && typeof DTPRechercheActifs.ouvrir === 'function') DTPRechercheActifs.ouvrir(code); };

  /* ── 1. INDICES MONDIAUX ──────────────────────────────────────────────────────────────────── */
  function montrerIndices(host) {
    styles();
    var vivant = true, data = null;
    host.innerHTML = '<div class="v3i"><div class="v3i-tete"><div class="v3i-large"></div></div><div class="v3i-corps"><div class="v3i-vide">Lecture des indices…</div></div><div class="v3i-pied"></div></div>';
    var corps = host.querySelector('.v3i-corps'), large = host.querySelector('.v3i-large'), pied = host.querySelector('.v3i-pied');
    function rendre() {
      var c = data && data.classes && data.classes.filter(function (k) { return k.k === 'indices'; })[0];
      var items = c ? c.items.filter(function (x) { return PLACES[x.sym]; }) : [];
      if (!items.length) { corps.innerHTML = '<div class="v3i-vide">Indices indisponibles pour le moment : nouvel essai automatique.</div>'; return; }
      var t = Date.now(), ok = items.filter(function (x) { return x.ok; });
      var up = ok.filter(function (x) { return x.chg > 0; }).length, dn = ok.filter(function (x) { return x.chg < 0; }).length;
      var fort = ok.slice().sort(function (a, b) { return b.chg - a.chg; });
      large.innerHTML = ok.length ? '<b>' + up + ' en hausse · ' + dn + ' en baisse</b><div class="v3i-jauge" title="Largeur du mouvement"><i style="width:' + (up / ok.length * 100).toFixed(1) + '%;background:#00e676"></i><i style="width:' + ((ok.length - up - dn) / ok.length * 100).toFixed(1) + '%;background:#6b7280"></i><i style="width:' + (dn / ok.length * 100).toFixed(1) + '%;background:#ff3d00"></i></div>' : '';
      corps.innerHTML = REGIONS.map(function (R) {
        var l = items.filter(function (x) { return PLACES[x.sym].r === R[0]; });
        if (!l.length) return '';
        return '<section class="v3i-reg"><h6>' + R[1] + '</h6><div class="v3i-tuiles">' + l.map(function (x) {
          var P = PLACES[x.sym], e = etatPlace(P, t);
          if (!x.ok) return '<div class="v3i-t ko"><div class="v3i-t-h"><span class="v3i-pt"></span><b>' + esc(x.nom) + '</b></div><em>indisponible pour le moment</em></div>';
          // Court, pour tenir sur une ligne dans une carte étroite : le point dit déjà ouvert ou fermé.
          var etat = !e ? '' : e.ouvert ? 'Ferme dans ' + duree(e.mins) : e.pause ? 'Pause de midi · ' + duree(e.mins) : 'Ouvre dans ' + duree(e.mins);
          return '<div class="v3i-t' + (e && e.ouvert ? ' ouvert' : '') + '" data-code="' + P.code + '" style="background:' + teinte(x.chg) + '" title="' + esc(x.nom + ' · clôture précédente ' + nf(x.prec, x.dec)) + '">'
            + '<div class="v3i-t-h"><span class="v3i-pt"></span><b>' + esc(x.nom) + '</b></div>'
            + '<div class="v3i-t-v"><span>' + nf(x.prix, x.dec) + '</span><strong>' + signe(x.chg, 2) + '</strong></div><em>' + etat + '</em></div>';
        }).join('') + '</div></section>';
      }).join('');
      var h = new Date(data.at);
      pied.textContent = (fort.length ? 'En tête : ' + fort[0].nom + ' ' + signe(fort[0].chg, 2) + ' · en queue : ' + fort[fort.length - 1].nom + ' ' + signe(fort[fort.length - 1].chg, 2) + ' · ' : '')
        + 'relu à ' + (h.getHours() < 10 ? '0' : '') + h.getHours() + ':' + (h.getMinutes() < 10 ? '0' : '') + h.getMinutes();
    }
    corps.addEventListener('click', function (e) { var t = e.target.closest('.v3i-t[data-code]'); if (t) ouvrirFiche(t.getAttribute('data-code')); });
    function charger() {
      if (!vivant || document.visibilityState === 'hidden') return;
      lire('/api/v2/multi-actifs').then(function (d) { if (!vivant) return; if (d && d.classes) data = d; rendre(); });
    }
    charger();
    // Les états de séance bougent à la minute, les cours toutes les 90 s.
    var t1 = setInterval(charger, 90000), t2 = setInterval(function () { if (data) rendre(); }, 60000);
    return function () { vivant = false; clearInterval(t1); clearInterval(t2); };
  }

  /* ── 2. RÉGIME DE VOLATILITÉ ──────────────────────────────────────────────────────────────── */
  // Le niveau du VIX, en quatre régimes (couleurs de la charte : calme vert, stress rouge).
  function regime(v) {
    if (v < 15) return { mot: 'Calme', c: '#00e676' };
    if (v < 20) return { mot: 'Normal', c: '#ffb300' };
    if (v < 30) return { mot: 'Tension', c: '#ff7a3d' };
    return { mot: 'Stress', c: '#ff3d00' };
  }
  function lecture(d) {
    var r = regime(d.vix.prix), s = d.pente;
    var pente = s == null ? '' : s > 1.02 ? 'La courbe est INVERSÉE : le marché paie plus cher la protection immédiate que celle à trois mois, signe d\'un stress présent.'
      : s > 0.95 ? 'La courbe est presque plate : la nervosité de court terme rejoint celle de moyen terme.'
        : 'La courbe monte avec l\'échéance, sa forme normale : pas de stress immédiat dans les prix.';
    return 'VIX ' + r.mot.toLowerCase() + ' (' + nf(d.vix.prix, 1) + '). ' + pente;
  }
  // Dessinée à la taille RÉELLE du cadre (pas d'étirement : les chiffres restent nets et droits).
  function courbeTerme(pts, W, H) {
    W = Math.max(200, Math.round(W || 320)); H = Math.max(100, Math.round(H || 120));
    var vs = pts.map(function (p) { return p.v; });
    var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs), et = Math.max(1, mx - mn);
    mn -= et * 0.25; mx += et * 0.25;
    var X = function (i) { return 18 + i * (W - 36) / (pts.length - 1); }, Y = function (v) { return 14 + (1 - (v - mn) / (mx - mn)) * (H - 40); };
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.v).toFixed(1); }).join('');
    var inv = pts.length > 1 && pts[0].v > pts[pts.length - 1].v, c = inv ? '#ff3d00' : '#e3b23a';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Courbe à terme du VIX">'
      + '<line x1="0" x2="' + W + '" y1="' + (H - 22) + '" y2="' + (H - 22) + '" stroke="#1c1c21"/>'
      + '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>'
      + pts.map(function (p, i) {
        return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="4" fill="#0a0a0c" stroke="' + c + '" stroke-width="2" vector-effect="non-scaling-stroke"/>'
          + '<text x="' + X(i).toFixed(1) + '" y="' + (Y(p.v) - 9).toFixed(1) + '" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="11" font-weight="600" fill="#ececf0">' + nf(p.v, 1) + '</text>'
          + '<text x="' + X(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-family="Inter Tight,system-ui,sans-serif" font-size="10.5" fill="#8e8e98">' + esc(p.lbl) + '</text>';
      }).join('') + '</svg>';
  }
  function montrerVix(host) {
    styles();
    var vivant = true;
    host.innerHTML = '<div class="v3i"><div class="v3i-corps" style="padding:0;gap:0"><div class="v3i-vide">Lecture de la volatilité…</div></div><div class="v3i-pied"></div></div>';
    var corps = host.querySelector('.v3i-corps'), pied = host.querySelector('.v3i-pied'), dernier = null, ro = null;
    function tracer() {
      var c = corps.querySelector('.v3x-courbe'); if (!c || !dernier) return;
      var pts = dernier.terme.filter(function (p) { return p.v != null; });
      if (pts.length >= 2) c.innerHTML = courbeTerme(pts, c.clientWidth, c.clientHeight);
    }
    function rendre(d) {
      dernier = d && d.vix ? d : dernier;
      if (!d || !d.vix) { corps.innerHTML = '<div class="v3i-vide">Volatilité indisponible pour le moment : nouvel essai automatique.</div>'; return; }
      var r = regime(d.vix.prix), pts = d.terme.filter(function (p) { return p.v != null; });
      corps.innerHTML = '<div class="v3x-haut"><div class="v3x-niv"><strong>' + nf(d.vix.prix, 2) + '</strong><span class="' + (d.vix.chg > 0 ? 'v3m-dn' : d.vix.chg < 0 ? 'v3m-up' : '') + '" style="color:' + (d.vix.chg > 0 ? '#ff3d00' : d.vix.chg < 0 ? '#00e676' : '#8e8e98') + '">' + signe(d.vix.chg, 2) + '</span>'
        + '<em class="v3x-pil" style="color:' + r.c + ';background:' + r.c + '1f">' + r.mot + '</em></div><p class="v3x-lec">' + esc(lecture(d)) + '</p></div>'
        + (pts.length >= 2 ? '<div class="v3x-courbe"></div>' : '')
        + '<div class="v3x-bas"><div class="v3x-b"><h6>Face à son année</h6><b>' + (d.rang == null ? '·' : 'rang ' + d.rang + '%') + '</b><div class="v3x-rang"><i style="width:' + (d.rang || 0) + '%"></i></div>'
        + '<p>' + (d.an ? 'Sur 12 mois : de ' + nf(d.an.bas, 1) + ' à ' + nf(d.an.haut, 1) + ', moyenne ' + nf(d.an.moy, 1) : '') + '</p></div>'
        + '<div class="v3x-b"><h6>VIX / VIX 3 mois</h6><b>' + (d.pente == null ? '·' : nf(d.pente, 2)) + '</b><p>' + (d.pente == null ? '' : d.pente > 1 ? 'au-dessus de 1 : courbe inversée' : 'sous 1 : courbe normale') + '</p></div></div>';
      var h = new Date(d.at);
      tracer();
      pied.textContent = 'Indices de volatilité (VIX 9 jours, VIX, 3 et 6 mois) · relu à ' + (h.getHours() < 10 ? '0' : '') + h.getHours() + ':' + (h.getMinutes() < 10 ? '0' : '') + h.getMinutes();
    }
    function charger() {
      if (!vivant || document.visibilityState === 'hidden') return;
      lire('/api/v2/vix-structure').then(function (d) { if (vivant) rendre(d); });
    }
    charger();
    var t = setInterval(charger, 5 * 60000);
    // La carte change de taille (glisser, colonne repliée) : la courbe se redessine à la nouvelle mesure.
    try { ro = new ResizeObserver(function () { tracer(); }); ro.observe(corps); } catch (e) {}
    return function () { vivant = false; clearInterval(t); if (ro) ro.disconnect(); };
  }
  window._v3Indices = { etatPlace: etatPlace, regime: regime, PLACES: PLACES };

  function declarer() {
    if (!window.DTPWidgets || typeof DTPWidgets.enregistrer !== 'function') return false;
    DTPWidgets.enregistrer({
      id: 'v3-indices', name: 'Indices mondiaux', court: 'Indices', tag: 'INDICES', cat: 'Marché', h: 380,
      desc: 'Les grandes places par région : variation du jour, séance ouverte ou fermée, largeur du mouvement.',
      aide: '<p>Les grands indices mondiaux rangés par région : Amériques, Europe, Asie. Chaque tuile se teinte selon la variation du jour, plus franchement quand le mouvement est fort, et dit où en est la place : ouverte (point vert qui pulse) et dans combien de temps elle ferme, en pause de midi, ou dans combien de temps elle ouvre.</p><p>En tête, la largeur du mouvement : combien d\'indices montent et combien baissent. Un mouvement large, tous dans le même sens, est plus solide qu\'une hausse portée par une seule place. Un clic sur une tuile ouvre la fiche de l\'indice.</p>',
      src: 'Indices au comptant, relus toutes les 90 secondes, différées selon les places. Horaires de séance des places, hors jours fériés.',
      watch: 'Une Asie qui baisse franchement avant l\'ouverture européenne, et un écart qui se creuse entre le Nasdaq et le Dow Jones (technologie contre valeurs industrielles).',
      apercu: '<svg viewBox="0 0 120 56" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g font-family="sans-serif" font-size="5" fill="#8e8e98"><text x="4" y="8">AMÉRIQUES</text><text x="4" y="30">EUROPE</text></g>'
        + '<rect x="4" y="11" width="36" height="14" rx="2" fill="rgba(0,230,118,.35)"/><rect x="42" y="11" width="36" height="14" rx="2" fill="rgba(0,230,118,.5)"/><rect x="80" y="11" width="36" height="14" rx="2" fill="rgba(0,230,118,.18)"/>'
        + '<rect x="4" y="33" width="27" height="14" rx="2" fill="rgba(255,61,0,.3)"/><rect x="33" y="33" width="27" height="14" rx="2" fill="rgba(255,61,0,.45)"/><rect x="62" y="33" width="27" height="14" rx="2" fill="rgba(0,230,118,.14)"/><rect x="91" y="33" width="25" height="14" rx="2" fill="rgba(255,61,0,.18)"/>'
        + '<g font-family="monospace" font-size="5.5" fill="#f2f2f4"><text x="7" y="21">+0,4%</text><text x="45" y="21">+0,7%</text><text x="83" y="21">+0,1%</text><text x="7" y="43">-0,4%</text><text x="36" y="43">-0,6%</text><text x="65" y="43">+0,1%</text><text x="94" y="43">-0,2%</text></g>'
        + '<g fill="#00e676"><circle cx="37" cy="14" r="1.2"/><circle cx="75" cy="14" r="1.2"/><circle cx="113" cy="14" r="1.2"/></g></svg>',
      opts: [],
      mount: function (host) { return montrerIndices(host); },
    });
    DTPWidgets.enregistrer({
      id: 'v3-vix', name: 'Régime de volatilité', court: 'VIX', tag: 'VOLATILITÉ', cat: 'Marché', h: 360,
      desc: 'Le VIX, son régime et sa courbe à terme : normale ou inversée, face à son année.',
      aide: '<p>Le VIX mesure la volatilité que le marché des options attend sur le S&amp;P 500 pour les 30 prochains jours. La carte le range en quatre régimes : calme (sous 15), normal (15 à 20), tension (20 à 30) et stress (au-delà).</p><p>La courbe relie le VIX à 9 jours, à 1 mois, à 3 mois et à 6 mois. Elle monte normalement avec l\'échéance. Quand elle s\'INVERSE (le court terme au-dessus du long), le stress est immédiat : c\'est souvent le moment des baisses rapides. Le rang dit où se situe le VIX dans sa fourchette des 12 derniers mois.</p>',
      src: 'Indices de volatilité (VIX9D, VIX, VIX3M, VIX6M), relus toutes les 5 minutes ; rang calculé par DTP sur un an de clôtures.',
      watch: 'Le rapport VIX / VIX 3 mois qui passe au-dessus de 1, et un VIX qui franchit 20 à la hausse.',
      apercu: '<svg viewBox="0 0 120 56" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><text x="6" y="18" font-family="monospace" font-size="12" font-weight="700" fill="#f2f2f4">16,4</text>'
        + '<rect x="6" y="23" width="26" height="7" rx="3.5" fill="rgba(255,179,0,.15)"/><text x="19" y="28.5" text-anchor="middle" font-family="sans-serif" font-size="4.5" font-weight="700" fill="#ffb300">NORMAL</text>'
        + '<path d="M46 40 L66 33 L88 27 L112 24" fill="none" stroke="#e3b23a" stroke-width="1.6"/><g fill="#0a0a0c" stroke="#e3b23a" stroke-width="1.2"><circle cx="46" cy="40" r="2"/><circle cx="66" cy="33" r="2"/><circle cx="88" cy="27" r="2"/><circle cx="112" cy="24" r="2"/></g>'
        + '<g font-family="sans-serif" font-size="4.5" fill="#8e8e98" text-anchor="middle"><text x="46" y="51">9 j</text><text x="66" y="51">1 m</text><text x="88" y="51">3 m</text><text x="112" y="51">6 m</text></g></svg>',
      opts: [],
      mount: function (host) { return montrerVix(host); },
    });
    return true;
  }
  if (!declarer()) { var n = 0; (function r() { if (declarer() || ++n > 100) return; setTimeout(r, 100); })(); }
})();

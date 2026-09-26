/* ═══ DTP V3 · FINITION DE LA BIBLIOTHÈQUE, LOT 1 (comptes admin, « Aperçu V3 ») ═══════════════════
   Feuille de route V3, point 3 (26/09) : « même passe (identité, lisibilité, direct) sur les autres
   widgets de la bibliothèque qui n'ont pas encore la finition V3 ». Lot 1, les plus consultés :
   · Baromètre des Devises et Radar de Biais : leur DESSIN est fixé par la charte (égaliseur
     bidirectionnel ; matrice aux couleurs sémantiques). On ne le redessine PAS : on l'habille d'un
     en-tête de chiffres clés (la plus forte, la plus faible, la paire la plus nette), de l'état du
     direct, et d'un éclat quand la tête du classement change.
   · Positionnement COT : les donuts deviennent des barres « acheteurs / vendeurs » rangées de la
     devise la plus achetée à la plus vendue, avec les positions étirées signalées.
   · Carte de chaleur FX : les 28 tuiles deviennent une vraie MATRICE 8 × 8 (chaque devise face à
     chacune des autres), lignes et colonnes rangées de la plus forte à la plus faible.
   ⚠️ MÊMES DONNÉES ET MÊMES RÉGLAGES que les widgets des clients (DTPWidgets.v3Montage) : hors
   html.dtp-v2, ou si un montage lève une exception, c'est le widget d'origine qui s'affiche. */
(function () {
  'use strict';
  if (window._v3Finition) return;
  window._v3Finition = true;

  var VERT = '#00e676', ROUGE = '#ff3d00';
  var ORDRE = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];   // cotation usuelle d'une paire
  var ISO = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', CAD: 'ca', AUD: 'au', NZD: 'nz' };
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fr = function (v, d) { return (v == null || !isFinite(v)) ? '–' : (v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace('.', ','); };
  var sg = function (v, d) { return (v > 0 ? '+' : '') + fr(v, d); };
  var drap = function (c) { return ISO[c] ? '<img class="v3f-dr" src="https://flagcdn.com/w40/' + ISO[c] + '.png" alt="" loading="lazy">' : ''; };
  // La paire de deux devises, dans son sens de cotation habituel (EUR/USD, jamais USD/EUR).
  var paire = function (a, b) { return ORDRE.indexOf(a) <= ORDRE.indexOf(b) ? a + '/' + b : b + '/' + a; };
  var heure = function (t) { try { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  var ferme = function () { var j = new Date().getUTCDay(), h = new Date().getUTCHours(); return j === 6 || (j === 0 && h < 21) || (j === 5 && h >= 21); };
  var direct = function (t) { var f = ferme(); return '<span class="v3f-live' + (f ? ' ferme' : '') + '" title="' + (t ? 'Relu à ' + heure(t) : '') + '"><i></i>' + (f ? 'MARCHÉ FERMÉ' : 'EN DIRECT') + '</span>'; };
  var lire = function (url) { return (window.dtpFetchBorne ? window.dtpFetchBorne(url, { credentials: 'same-origin' }, 20000) : fetch(url, { credentials: 'same-origin' })).then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; }); };

  var CSS = ''
    + 'html.dtp-v2 .v3f{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--v3-carte, #0a0a0c);color:var(--v3-texte, #d6d6dc);font:500 11.5px/1.3 "Inter Tight",system-ui,sans-serif;font-variant-numeric:tabular-nums;container-type:inline-size}'
    + 'html.dtp-v2 .v3f-tete{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;border-bottom:1px solid var(--v3-ligne, #15151a);min-height:33px}'
    + 'html.dtp-v2 .v3f-puce{display:inline-flex;align-items:center;gap:5px;height:21px;padding:0 7px;border:1px solid var(--v3-bord, #22222a);border-radius:3px;background:var(--v3-tete, #0f0f12);color:#a1a1aa;font-size:11px;white-space:nowrap}'
    + 'html.dtp-v2 .v3f-puce b{color:var(--v3-titre, #f0f0f3);font-weight:600}html.dtp-v2 .v3f-puce .h{color:' + VERT + '}html.dtp-v2 .v3f-puce .b{color:' + ROUGE + '}'
    + 'html.dtp-v2 .v3f-puce.or{border-color:rgba(227,178,58,.45);color:#e3b23a}html.dtp-v2 .v3f-puce.or b{color:#e3b23a}'
    + 'html.dtp-v2 .v3f-dr{width:14px;height:14px;border-radius:50%;object-fit:cover;flex:0 0 auto}'
    + 'html.dtp-v2 .v3f-live{margin-left:auto;display:inline-flex;align-items:center;gap:5px;color:var(--v3-doux, #8e8e98);font-size:10.5px;letter-spacing:.04em}'
    + 'html.dtp-v2 .v3f-live i{width:6px;height:6px;border-radius:50%;background:' + VERT + ';animation:v3fPouls 2s ease-out infinite}html.dtp-v2 .v3f-live.ferme i{background:#6f6f78;animation:none}'
    + 'html.dtp-v2 .v3f-maj{margin-left:auto;color:var(--v3-pale, #6f6f78);font-size:10.5px;white-space:nowrap}'
    + '@keyframes v3fPouls{0%{box-shadow:0 0 0 0 rgba(0,230,118,.55)}100%{box-shadow:0 0 0 7px rgba(0,230,118,0)}}'
    + 'html.dtp-v2 .v3f-eclat{animation:v3fEclat 1.4s ease-out}@keyframes v3fEclat{0%{box-shadow:0 0 0 1px rgba(227,178,58,.9),0 0 14px rgba(227,178,58,.45)}100%{box-shadow:none}}'
    + 'html.dtp-v2 .v3f-corps{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}html.dtp-v2 .v3f-in{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}html.dtp-v2 .v3f-in>*{flex:1;min-height:0}'
    + 'html.dtp-v2 .v3f-vide{margin:auto;padding:20px;text-align:center;color:var(--v3-pale, #6f6f78);font-size:12px}'
    // COT : barres acheteurs / vendeurs.
    + 'html.dtp-v2 .v3f-cot{overflow-y:auto;padding:4px 10px 8px}'
    + 'html.dtp-v2 .v3f-cl{display:grid;grid-template-columns:62px minmax(80px,1fr) 66px 118px;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--v3-ligne, #121215)}'
    + 'html.dtp-v2 .v3f-cl .dev{display:flex;align-items:center;gap:6px;font-weight:700;color:var(--v3-titre, #f2f2f4)}'
    + 'html.dtp-v2 .v3f-bar{position:relative;display:flex;height:14px;border-radius:3px;overflow:hidden;background:#16161a}'
    + 'html.dtp-v2 .v3f-bar i{display:block;height:100%;transition:width .6s cubic-bezier(.2,.8,.2,1)}html.dtp-v2 .v3f-bar i.l{background:rgba(0,230,118,.78)}html.dtp-v2 .v3f-bar i.s{background:rgba(255,61,0,.78)}'
    + 'html.dtp-v2 .v3f-bar em{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:#0a0a0c}'
    + 'html.dtp-v2 .v3f-bar b{position:absolute;top:0;bottom:0;display:flex;align-items:center;font:700 10px/1 "Inter Tight",system-ui,sans-serif;color:#0a0a0c}html.dtp-v2 .v3f-bar b.l{left:5px}html.dtp-v2 .v3f-bar b.s{right:5px}'
    + 'html.dtp-v2 .v3f-net{text-align:right;font:600 11.5px/1 ui-monospace,Menlo,monospace;color:var(--v3-texte, #c9c9d1)}'
    + 'html.dtp-v2 .v3f-ver{justify-self:end;font:700 9.5px/1 "Inter Tight",system-ui,sans-serif;text-transform:uppercase;letter-spacing:.04em;padding:3px 6px;border-radius:3px}'
    + 'html.dtp-v2 .v3f-ver.bull{color:' + VERT + ';background:rgba(0,230,118,.12)}html.dtp-v2 .v3f-ver.bear{color:' + ROUGE + ';background:rgba(255,61,0,.12)}html.dtp-v2 .v3f-ver.flat,html.dtp-v2 .v3f-ver.na{color:#a1a1aa;background:rgba(142,142,152,.12)}'
    + 'html.dtp-v2 .v3f-etire{margin-left:4px;font:700 8.5px/1 "Inter Tight",system-ui,sans-serif;color:#ffb300;border:1px solid rgba(255,179,0,.5);border-radius:3px;padding:2px 3px}'
    // Matrice de chaleur.
    + 'html.dtp-v2 .v3f-mat{overflow:auto;padding:6px 8px 8px}html.dtp-v2 .v3f-mat table{width:100%;height:100%;border-collapse:separate;border-spacing:2px;table-layout:fixed}'
    + 'html.dtp-v2 .v3f-mat th{font:700 10.5px/1 "Inter Tight",system-ui,sans-serif;color:var(--v3-doux, #8e8e98);padding:3px 0;text-align:center}html.dtp-v2 .v3f-mat th.r{text-align:left;padding-left:2px;width:52px}'
    + 'html.dtp-v2 .v3f-mat th .v3f-dr{width:12px;height:12px;vertical-align:-2px;margin-right:4px}'
    + 'html.dtp-v2 .v3f-mat td{border-radius:3px;text-align:center;font:600 10.5px/1 ui-monospace,Menlo,monospace;color:#f2f2f4;min-height:22px;height:22px;cursor:pointer;transition:outline-color .15s}'
    + 'html.dtp-v2 .v3f-mat td:hover{outline:1px solid rgba(227,178,58,.8);outline-offset:-1px}html.dtp-v2 .v3f-mat td.diag{background:#111114;color:#4a4a52;cursor:default}html.dtp-v2 .v3f-mat td.na{background:#0f0f12;color:#4a4a52;cursor:default}'
    + 'html.dtp-v2 .v3f-mat td.tot{font-weight:700;background:transparent!important;cursor:default}'
    + 'html.dtp-v2 .v3f-mat td.maj{animation:v3fEclat 1.4s ease-out}'
    + '@container (max-width:430px){html.dtp-v2 .v3f-mat td{font-size:9px}html.dtp-v2 .v3f-mat th.r{width:40px}html.dtp-v2 .v3f-mat th .v3f-dr{display:none}html.dtp-v2 .v3f-cl{grid-template-columns:54px minmax(60px,1fr) 112px}html.dtp-v2 .v3f-net{display:none}}'
    + '@media (prefers-reduced-motion:reduce){html.dtp-v2 .v3f-live i,html.dtp-v2 .v3f-eclat,html.dtp-v2 .v3f-mat td.maj{animation:none}}';
  function styles() { if (document.getElementById('v3f-css')) return; var s = document.createElement('style'); s.id = 'v3f-css'; s.textContent = CSS; document.head.appendChild(s); }
  // Cadre commun : un en-tête V3, puis le corps (où le widget d'origine se monte quand la charte le fixe).
  function cadre(host) {
    styles();
    host.innerHTML = '<div class="v3f"><div class="v3f-tete"></div><div class="v3f-corps"><div class="v3f-in"></div></div></div>';
    return { tete: host.querySelector('.v3f-tete'), corps: host.querySelector('.v3f-in') };
  }
  function eclat(n) { if (!n) return; n.classList.remove('v3f-eclat'); void n.offsetWidth; n.classList.add('v3f-eclat'); }

  /* ── 1. BAROMÈTRE DES DEVISES : l'égaliseur de la charte, avec ses chiffres clés ─────────────── */
  // Les valeurs du baromètre (même source et même repli que buildMeterChart : séance, puis semaine).
  function forces(d) {
    var v = {}; if (!d || !d.currencies || !d.series) return null;
    d.currencies.forEach(function (c) { var p = (d.series[c] || []).filter(function (x) { return x.v != null; }); if (p.length) v[c] = { v: +p[p.length - 1].v, h: p.length > 12 ? +p[p.length - 13].v : null }; });
    return Object.keys(v).length >= 2 ? v : null;
  }
  function teteBarometre(v) {
    var l = Object.keys(v).sort(function (a, b) { return v[b].v - v[a].v; }), fo = l[0], fa = l[l.length - 1];
    return '<span class="v3f-puce" data-k="fort">Plus forte ' + drap(fo) + '<b>' + fo + '</b><b class="h">' + sg(v[fo].v, 2) + '</b></span>'
      + '<span class="v3f-puce" data-k="faible">Plus faible ' + drap(fa) + '<b>' + fa + '</b><b class="b">' + sg(v[fa].v, 2) + '</b></span>'
      + '<span class="v3f-puce or" title="La paire au mouvement le plus franc">Paire la plus nette <b>' + paire(fo, fa) + '</b></span>';
  }
  function barometre(host, it, repli) {
    var W = this, c = cadre(host), vivant = true, tetePrec = '';
    var un = null; try { un = W._v3Orig.call(W, c.corps, it); } catch (e) { repli(); return null; }
    function charger() {
      if (!vivant || !host.isConnected || document.visibilityState === 'hidden') return;
      lire('/api/currency-strength?period=today').then(function (d) { return forces(d) ? d : lire('/api/currency-strength?period=week'); }).then(function (d) {
        if (!vivant) return;
        var v = forces(d);
        if (!v) { c.tete.innerHTML = '<span class="v3f-maj">Force indisponible pour le moment : nouvel essai automatique.</span>'; return; }
        var h = teteBarometre(v), neuf = h.replace(/[+−-]?\d+,\d+/g, '') !== tetePrec.replace(/[+−-]?\d+,\d+/g, '');
        c.tete.innerHTML = h + direct(Date.now());
        // La tête du classement a changé de devise : un éclat le dit, sans rien à lire.
        if (tetePrec && neuf) { eclat(c.tete.querySelector('[data-k="fort"]')); eclat(c.tete.querySelector('[data-k="faible"]')); }
        tetePrec = h;
      });
    }
    charger();
    var t = setInterval(charger, 15000);
    return function () { vivant = false; clearInterval(t); try { if (typeof un === 'function') un(); } catch (e) {} };
  }

  /* ── 2. RADAR DE BIAIS : la matrice de la charte, avec la lecture du jour en tête ──────────── */
  var ECH = { 'Very Bullish': 2, Bullish: 1, Neutral: 0, Bearish: -1, 'Very Bearish': -2 };
  var MOT = { 'Very Bullish': 'Très haussier', Bullish: 'Haussier', Neutral: 'Neutre', Bearish: 'Baissier', 'Very Bearish': 'Très baissier' };
  function teteBiais(d) {
    var co = (d && d.conclusion) || {}, l = Object.keys(co).filter(function (c) { return ECH[co[c]] != null; });
    if (l.length < 2) return '';
    l.sort(function (a, b) { return ECH[co[b]] - ECH[co[a]] || ORDRE.indexOf(a) - ORDRE.indexOf(b); });
    var hau = l.filter(function (c) { return ECH[co[c]] > 0; }).length, bai = l.filter(function (c) { return ECH[co[c]] < 0; }).length;
    var fo = l[0], fa = l[l.length - 1], net = ECH[co[fo]] > 0 && ECH[co[fa]] < 0;
    var t = Number(d.generatedAt || d.dataAt || 0);
    return '<span class="v3f-puce"><b class="h">' + hau + '</b> haussière' + (hau > 1 ? 's' : '') + ' · <b class="b">' + bai + '</b> baissière' + (bai > 1 ? 's' : '') + '</span>'
      + '<span class="v3f-puce">' + drap(fo) + '<b>' + fo + '</b><b class="h">' + esc(MOT[co[fo]]) + '</b></span>'
      + '<span class="v3f-puce">' + drap(fa) + '<b>' + fa + '</b><b class="b">' + esc(MOT[co[fa]]) + '</b></span>'
      + (net ? '<span class="v3f-puce or" title="Plus haussière contre plus baissière">Paire la plus nette <b>' + paire(fo, fa) + '</b></span>' : '')
      + (t ? '<span class="v3f-maj">mis à jour le ' + esc(new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })) + ' à ' + heure(t) + '</span>' : '');
  }
  function radar(host, it, repli) {
    var W = this, c = cadre(host), vivant = true, prec = '';
    var un = null; try { un = W._v3Orig.call(W, c.corps, it); } catch (e) { repli(); return null; }
    function charger() {
      if (!vivant || !host.isConnected || document.visibilityState === 'hidden') return;
      lire('/api/smart-bias').then(function (d) {
        if (!vivant) return;
        var h = teteBiais(d);
        c.tete.innerHTML = h || '<span class="v3f-maj">Biais indisponible pour le moment : nouvel essai automatique.</span>';
        if (prec && h && h !== prec) eclat(c.tete);
        prec = h;
      });
    }
    charger();
    var t = setInterval(charger, 60000);
    return function () { vivant = false; clearInterval(t); try { if (typeof un === 'function') un(); } catch (e) {} };
  }

  /* ── 3. POSITIONNEMENT COT : acheteurs contre vendeurs, de la plus achetée à la plus vendue ──── */
  var CAT = { noncomm: 'Non-commerciaux', dealer: 'Teneurs de marché', asset_mgr: 'Gérants d’actifs', lev_money: 'Fonds à effet de levier', other_rept: 'Autres déclarants' };
  var kilo = function (v) { return Math.abs(v) >= 1000 ? fr(v / 1000, 1) + ' k' : fr(v, 0); };
  // Même règle que le widget d'origine : moins de 4 points d'écart = neutre, pas d'avis inventé.
  function etatCot(x) {
    var ok = isFinite(x.longPos) && isFinite(x.shortPos) && (x.longPos + x.shortPos) > 0;
    if (!ok) return 'na';
    return Math.abs((x.shortPct || 0) - (x.longPct || 0)) < 4 ? 'flat' : x.longPos > x.shortPos ? 'bull' : 'bear';
  }
  function rendreCot(d, cat) {
    var l = ((d && d.currencies) || []).filter(function (x) { return x && x.key; });
    if (!l.length) return null;
    l.sort(function (a, b) { var ea = etatCot(a) === 'na' ? -999 : a.longPct, eb = etatCot(b) === 'na' ? -999 : b.longPct; return eb - ea; });
    var V = { bull: 'Acheteur', bear: 'Vendeur', flat: 'Neutre', na: 'N.D.' };
    var ok = l.filter(function (x) { return etatCot(x) !== 'na'; });
    var tete = '<span class="v3f-puce or">' + esc(CAT[cat] || 'COT') + '</span>'
      + (ok.length ? '<span class="v3f-puce">Plus achetée ' + drap(ok[0].key) + '<b>' + ok[0].key + '</b><b class="h">' + ok[0].longPct + '%</b></span>'
        + '<span class="v3f-puce">Plus vendue ' + drap(ok[ok.length - 1].key) + '<b>' + ok[ok.length - 1].key + '</b><b class="b">' + ok[ok.length - 1].shortPct + '%</b></span>' : '')
      + '<span class="v3f-maj">rapport hebdomadaire</span>';
    var corps = '<div class="v3f-cot">' + l.map(function (x) {
      var e = etatCot(x);
      if (e === 'na') return '<div class="v3f-cl"><span class="dev">' + drap(x.key) + x.key + '</span><span class="v3f-vide" style="margin:0;padding:0;text-align:left">pas de rapport publié</span><span></span><span class="v3f-ver na">' + V.na + '</span></div>';
      var etire = x.longPct >= 75 || x.shortPct >= 75;
      return '<div class="v3f-cl" title="' + esc(x.key + ' · ' + x.longPct + '% acheteurs, ' + x.shortPct + '% vendeurs · ' + Math.round(x.longPos).toLocaleString('fr-FR') + ' contrats à l’achat, ' + Math.round(x.shortPos).toLocaleString('fr-FR') + ' à la vente') + '">'
        + '<span class="dev">' + drap(x.key) + x.key + '</span>'
        + '<span class="v3f-bar"><i class="l" style="width:' + x.longPct + '%"></i><i class="s" style="width:' + x.shortPct + '%"></i><em></em>'
        + (x.longPct >= 18 ? '<b class="l">' + x.longPct + '%</b>' : '') + (x.shortPct >= 18 ? '<b class="s">' + x.shortPct + '%</b>' : '') + '</span>'
        + '<span class="v3f-net" title="Position nette">' + (x.longPos >= x.shortPos ? '+' : '−') + kilo(Math.abs(x.longPos - x.shortPos)) + '</span>'
        + '<span class="v3f-ver ' + e + '">' + V[e] + (etire ? '<span class="v3f-etire" title="Positionnement extrême (75% et plus)">ÉTIRÉ</span>' : '') + '</span></div>';
    }).join('') + '</div>';
    return { tete: tete, corps: corps };
  }
  /* ⚠️ 26/09, capture utilisateur : « c'est quoi ça, j'aime pas ; refais comme l'ancien mais améliore les
     finitions, de même pour le COT ». La version du 25/09 remplaçait les cartes à anneau du widget
     client par des barres horizontales. On rend donc le CORPS au widget client (ses cartes par devise :
     en-tête drapeau + verdict, anneau acheteurs / vendeurs, longs · net · courts), et la V3 garde ce
     qu'elle ajoutait d'utile : l'en-tête à puces (catégorie, devise la plus achetée, la plus vendue).
     Les finitions de ces cartes (trait, anneau, typographie) vivent dans desk.css, sous html.dtp-v2. */
  function cot(host, it, repli, O) {
    var W = this, c = cadre(host), vivant = true, cat = O.opt(it, W, 'cat') || 'lev_money';
    host.classList.add('v3f-cot-anneaux');
    var un = null; try { un = W._v3Orig.call(W, c.corps, it); } catch (e) { repli(); return null; }
    function charger() {
      if (!vivant || !host.isConnected) return;
      lire('/api/cot?type=' + encodeURIComponent(cat)).then(function (d) {
        if (!vivant) return;
        var r = rendreCot(d, cat);
        c.tete.innerHTML = r ? r.tete : '<span class="v3f-maj">Positionnement indisponible pour le moment : nouvel essai automatique.</span>';
      });
    }
    charger();
    var t = setInterval(charger, 30 * 60000);   // hebdomadaire : ce rythme sert à se réparer
    return function () { vivant = false; clearInterval(t); try { if (typeof un === 'function') un(); } catch (e) {} };
  }

  /* ── 4. CARTE DE CHALEUR FX : la matrice 8 × 8 ──────────────────────────────────────────────── */
  // Variation de A face à B : la paire telle qu'elle cote, ou son inverse (au premier ordre, −x).
  function matrice(pairs) {
    var m = {};
    (pairs || []).forEach(function (p) {
      if (!p || !p.base || !p.quote || p.changePct == null || !isFinite(Number(p.changePct))) return;
      var v = Number(p.changePct);
      (m[p.base] = m[p.base] || {})[p.quote] = v;
      (m[p.quote] = m[p.quote] || {})[p.base] = -v;
    });
    var devs = ORDRE.filter(function (c) { return m[c]; });
    var score = {};
    devs.forEach(function (a) { var v = devs.filter(function (b) { return b !== a && m[a][b] != null; }).map(function (b) { return m[a][b]; }); score[a] = v.length ? v.reduce(function (x, y) { return x + y; }, 0) / v.length : 0; });
    return { m: m, devs: devs, score: score };
  }
  function teinte(v, max) {
    if (v == null) return '';
    var a = Math.min(1, Math.abs(v) / max);
    if (Math.abs(v) < 0.02) return 'rgba(142,142,152,.14)';
    return v > 0 ? 'rgba(0,230,118,' + (0.12 + a * 0.62).toFixed(2) + ')' : 'rgba(255,61,0,' + (0.12 + a * 0.62).toFixed(2) + ')';
  }
  function rendreMatrice(d, tri) {
    var M = matrice(d && d.pairs);
    if (M.devs.length < 3) return null;
    var devs = M.devs.slice();
    if (tri !== 'alpha') devs.sort(function (a, b) { return M.score[b] - M.score[a]; });
    var tous = []; devs.forEach(function (a) { devs.forEach(function (b) { if (a !== b && M.m[a][b] != null) tous.push(Math.abs(M.m[a][b])); }); });
    var max = Math.max(0.3, Math.max.apply(null, tous.concat([0])));
    var h = '<div class="v3f-mat"><table><thead><tr><th class="r"></th>' + devs.map(function (b) { return '<th>' + b + '</th>'; }).join('') + '<th title="Moyenne face aux 7 autres">Moy.</th></tr></thead><tbody>';
    devs.forEach(function (a) {
      h += '<tr><th class="r">' + drap(a) + a + '</th>';
      devs.forEach(function (b) {
        if (a === b) { h += '<td class="diag">' + a + '</td>'; return; }
        var v = M.m[a][b];
        if (v == null) { h += '<td class="na">·</td>'; return; }
        h += '<td data-p="' + paire(a, b) + '" data-k="' + a + b + '" data-v="' + v.toFixed(3) + '" style="background:' + teinte(v, max) + '" title="' + esc(a + ' face à ' + b + ' : ' + sg(v, 2) + '% sur la séance (' + paire(a, b) + ')') + '">' + sg(v, 2) + '</td>';
      });
      var s = M.score[a];
      h += '<td class="tot" style="color:' + (s > 0 ? VERT : s < 0 ? ROUGE : '#a1a1aa') + '">' + sg(s, 2) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    var fo = devs.slice().sort(function (a, b) { return M.score[b] - M.score[a]; });
    var tete = '<span class="v3f-puce">Plus forte ' + drap(fo[0]) + '<b>' + fo[0] + '</b><b class="h">' + sg(M.score[fo[0]], 2) + '%</b></span>'
      + '<span class="v3f-puce">Plus faible ' + drap(fo[fo.length - 1]) + '<b>' + fo[fo.length - 1] + '</b><b class="b">' + sg(M.score[fo[fo.length - 1]], 2) + '%</b></span>'
      + '<span class="v3f-puce or">Paire la plus nette <b>' + paire(fo[0], fo[fo.length - 1]) + '</b></span>';
    return { tete: tete, corps: h };
  }
  function chaleur(host, it, repli, O) {
    var W = this, c = cadre(host), vivant = true, avant = {};
    c.corps.innerHTML = '<div class="v3f-vide">Lecture des variations…</div>';
    c.corps.addEventListener('click', function (e) {
      var td = e.target.closest('td[data-p]');
      if (td && typeof window.openSymbol === 'function') window.openSymbol(td.getAttribute('data-p').replace('/', ''));
    });
    function charger() {
      if (!vivant || !host.isConnected || document.visibilityState === 'hidden') return;
      lire('/api/fxlist').then(function (d) {
        if (!vivant) return;
        var r = rendreMatrice(d, O.opt(it, W, 'tri'));
        if (!r) { if (!c.corps.querySelector('table')) c.corps.innerHTML = '<div class="v3f-vide">Variations indisponibles pour le moment : nouvel essai automatique.</div>'; return; }
        c.tete.innerHTML = r.tete + direct(Date.now()); c.corps.innerHTML = r.corps;
        // Seules les cases qui ont réellement bougé depuis la dernière lecture s'éclairent.
        c.corps.querySelectorAll('td[data-k]').forEach(function (td) { var k = td.getAttribute('data-k'), v = td.getAttribute('data-v'); if (avant[k] != null && avant[k] !== v) td.classList.add('maj'); avant[k] = v; });
      });
    }
    charger();
    var t = setInterval(charger, 150000);
    return function () { vivant = false; clearInterval(t); };
  }

  var MONTAGES = { barometre: barometre, 'radar-biais': radar, 'cot-inst': cot, 'heatmap-seance': chaleur };
  window._v3Finition = { MONTAGES: MONTAGES, paire: paire, forces: forces, teteBarometre: teteBarometre, teteBiais: teteBiais, rendreCot: rendreCot, etatCot: etatCot, matrice: matrice, rendreMatrice: rendreMatrice };
  function brancher() {
    if (!window.DTPWidgets || typeof DTPWidgets.v3Montage !== 'function') return false;
    Object.keys(MONTAGES).forEach(function (id) { DTPWidgets.v3Montage(id, MONTAGES[id]); });
    return true;
  }
  if (!brancher()) { var n = 0; (function r() { if (brancher() || ++n > 100) return; setTimeout(r, 100); })(); }
})();

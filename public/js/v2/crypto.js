/* ═══ DTP V3 · WIDGETS CRYPTO ET ACTIONS (comptes admin, « Aperçu V3 ») ════════════════════════════
   Multi-actifs, étape 5 (26/09), après les indices et les métaux : un widget par classe restante,
   rangé sous « Crypto » ou « Actions » par le filtre de marché de la bibliothèque.
   · Marché crypto : sept cryptos en dollar (24 h, 7 jours, 30 jours, volatilité 30 jours), le
     rapport ETH / BTC (appétit pour les autres cryptos que le Bitcoin) et le lien du Bitcoin avec
     le Nasdaq sur 60 séances (la crypto se traite-t-elle comme de la technologie ?).
   · Géants de la cote : les sept grandes valeurs américaines (séance, mois, depuis janvier) face
     au S&P 500, avec la moyenne du panier : mènent-elles le marché, ou le freinent-elles ?
   Un clic sur une ligne ouvre la fiche de l'actif. Données : /api/v2/crypto-tableau et
   /api/v2/grandes-valeurs (admin), relues toutes les 10 minutes tant que la carte est visible ;
   chaque attente a sa sortie (message d'indisponibilité, nouvel essai automatique). */
(function () {
  'use strict';
  if (window._v3CryptoActions) return;
  window._v3CryptoActions = true;

  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var nf = function (v, d) { return v == null ? '·' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var signe = function (v, d) { return v == null ? '·' : (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), d == null ? 2 : d) + '%'; };
  var decDe = function (v) { var x = Math.abs(v); return x >= 1000 ? 0 : x >= 10 ? 2 : x >= 1 ? 3 : 4; };
  // Variation de prix : vert ou rouge (charte), fond léger proportionné à l'ampleur.
  var cellule = function (v, plein, cls) {
    cls = cls ? cls + ' ' : '';
    if (v == null) return '<td class="' + cls + 'v3k-eq">·</td>';
    var a = Math.min(1, Math.abs(v) / plein), f = (0.06 + a * 0.26).toFixed(2);
    return '<td class="' + cls + (v > 0 ? 'v3k-up' : v < 0 ? 'v3k-dn' : 'v3k-eq') + '" style="background:' + (v > 0 ? 'rgba(0,230,118,' + f + ')' : v < 0 ? 'rgba(255,61,0,' + f + ')' : 'transparent') + '">' + signe(v) + '</td>';
  };

  // Ce que disent les deux repères du marché crypto, en clair.
  function lectureEthBtc(r) {
    if (!r || r.m1 == null) return '';
    return r.m1 > 3 ? 'L’Ethereum gagne sur le Bitcoin depuis un mois : l’appétit s’étend aux autres cryptos.'
      : r.m1 < -3 ? 'Le Bitcoin gagne sur l’Ethereum depuis un mois : le marché se replie sur la valeur la plus solide.'
        : 'Stable sur un mois : pas de rotation nette entre Bitcoin et le reste du marché.';
  }
  function lectureNdx(l) {
    if (!l) return '';
    var c = l.c60;
    return c >= 0.5 ? 'Lien fort avec le Nasdaq : le Bitcoin se traite comme une valeur technologique, les chiffres américains le font bouger.'
      : c >= 0.25 ? 'Lien net avec le Nasdaq : l’appétit pour le risque pèse sur le Bitcoin.'
        : c > -0.25 ? 'Peu de lien avec le Nasdaq : le Bitcoin suit sa propre dynamique.'
          : 'Le Bitcoin évolue à l’inverse du Nasdaq ces dernières semaines.';
  }
  function lectureGeants(d) {
    var p = d.panier, s = d.sp && d.sp.ok ? d.sp : null;
    if (!p || p.m1 == null || !s || s.m1 == null) return '';
    var e = p.m1 - s.m1;
    return e > 1 ? 'Sur un mois, les sept géants font mieux que le S&P 500 : ils mènent la hausse.'
      : e < -1 ? 'Sur un mois, les sept géants font moins bien que le S&P 500 : le marché avance sans eux.'
        : 'Sur un mois, les sept géants avancent au rythme du S&P 500.';
  }

  var CSS = ''
    + 'html.dtp-v2 .v3k{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--v3-carte, #0a0a0c);color:var(--v3-texte, #d6d6dc);font:500 11.5px/1.3 "Inter Tight",system-ui,sans-serif;font-variant-numeric:tabular-nums;container-type:inline-size}'
    + 'html.dtp-v2 .v3k-reperes{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--v3-ligne, #16161a)}'
    + 'html.dtp-v2 .v3k-rep{padding:8px 12px;display:flex;flex-direction:column;gap:3px;min-width:0}html.dtp-v2 .v3k-rep+.v3k-rep{border-left:1px solid var(--v3-ligne, #16161a)}'
    + 'html.dtp-v2 .v3k-rep h6{margin:0;font:600 10.5px/1 "Inter Tight",system-ui,sans-serif;color:var(--v3-doux, #8e8e98);text-transform:uppercase;letter-spacing:.06em}'
    + 'html.dtp-v2 .v3k-rep b{font:700 15px/1.1 ui-monospace,Menlo,monospace;color:var(--v3-titre, #f2f2f4)}html.dtp-v2 .v3k-rep b small{font:600 11px/1 ui-monospace,Menlo,monospace;color:var(--v3-texte, #c9c9d1);margin-left:6px}'
    + 'html.dtp-v2 .v3k-rep p{margin:0;font-size:11px;line-height:1.4;color:var(--v3-doux, #a6a6b0)}'
    + 'html.dtp-v2 .v3k-corps{flex:1;min-height:0;overflow:auto}'
    + 'html.dtp-v2 .v3k table{width:100%;border-collapse:collapse}html.dtp-v2 .v3k th{position:sticky;top:0;background:var(--v3-tete, #0e0e11);font:600 10.5px/1 "Inter Tight",system-ui,sans-serif;color:var(--v3-doux, #8e8e98);text-align:right;padding:7px 8px;border-bottom:1px solid var(--v3-ligne, #16161a);white-space:nowrap}'
    + 'html.dtp-v2 .v3k th:first-child,html.dtp-v2 .v3k td:first-child{text-align:left}'
    + 'html.dtp-v2 .v3k td{padding:7px 8px;border-bottom:1px solid var(--v3-ligne, #121215);text-align:right;font:600 12px/1 ui-monospace,Menlo,monospace;white-space:nowrap}'
    + 'html.dtp-v2 .v3k tr[data-code]{cursor:pointer}html.dtp-v2 .v3k tr[data-code]:hover td{box-shadow:inset 0 1px 0 rgba(227,178,58,.25),inset 0 -1px 0 rgba(227,178,58,.25)}'
    + 'html.dtp-v2 .v3k td.n b{font:600 12.5px/1.2 "Inter Tight",system-ui,sans-serif;color:var(--v3-titre, #f2f2f4)}html.dtp-v2 .v3k td.p{color:var(--v3-texte, #c9c9d1);font-weight:500}'
    + 'html.dtp-v2 .v3k-up{color:#00e676}html.dtp-v2 .v3k-dn{color:#ff3d00}html.dtp-v2 .v3k-eq{color:var(--v3-doux, #8e8e98)}'
    + 'html.dtp-v2 .v3k tr.ref td{border-top:1px solid var(--v3-bord, #24242a);color:var(--v3-texte, #c9c9d1)}html.dtp-v2 .v3k tr.ref td.n b{color:#e3b23a}'
    + 'html.dtp-v2 .v3k-lec{margin:0;padding:8px 12px;border-top:1px solid var(--v3-ligne, #16161a);font-size:11.5px;line-height:1.45;color:var(--v3-texte, #c9c9d1)}'
    + 'html.dtp-v2 .v3k-pied{padding:5px 10px;border-top:1px solid var(--v3-ligne, #16161a);font-size:10.5px;color:var(--v3-pale, #6f6f78)}'
    + 'html.dtp-v2 .v3k-vide{padding:26px 12px;text-align:center;color:var(--v3-pale, #6f6f78);font-size:12px}'
    + '@container (max-width:430px){html.dtp-v2 .v3k .col-large{display:none}html.dtp-v2 .v3k-reperes{grid-template-columns:1fr}html.dtp-v2 .v3k-rep+.v3k-rep{border-left:0;border-top:1px solid var(--v3-ligne, #16161a)}}';
  function styles() { if (document.getElementById('v3k-styles')) return; var s = document.createElement('style'); s.id = 'v3k-styles'; s.textContent = CSS; document.head.appendChild(s); }
  var heure = function (t) { var h = new Date(t); return (h.getHours() < 10 ? '0' : '') + h.getHours() + ':' + (h.getMinutes() < 10 ? '0' : '') + h.getMinutes(); };
  var ouvrirFiche = function (code) { if (code && window.DTPRechercheActifs && typeof DTPRechercheActifs.ouvrir === 'function') DTPRechercheActifs.ouvrir(code); };

  // Monteur commun : une route, un rendu, relu toutes les 10 min, clic → fiche.
  function monteur(url, attente, rendu) {
    return function (host) {
      styles();
      var vivant = true;
      host.innerHTML = '<div class="v3k"><div class="v3k-vide">' + esc(attente) + '</div></div>';
      var racine = host.querySelector('.v3k');
      racine.addEventListener('click', function (e) { var tr = e.target.closest('tr[data-code]'); if (tr) ouvrirFiche(tr.getAttribute('data-code')); });
      function charger() {
        if (!vivant || document.visibilityState === 'hidden') return;
        (window.dtpFetchBorne ? window.dtpFetchBorne(url, { credentials: 'same-origin' }, 25000) : fetch(url, { credentials: 'same-origin' }))
          .then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; })
          .then(function (d) {
            if (!vivant) return;
            if (d && d.lignes) racine.innerHTML = rendu(d);
            else if (!racine.querySelector('table')) racine.innerHTML = '<div class="v3k-vide">Cotations indisponibles pour le moment : nouvel essai automatique.</div>';
          });
      }
      charger();
      var t = setInterval(charger, 10 * 60000);
      return function () { vivant = false; clearInterval(t); };
    };
  }

  function rendreCrypto(d) {
    var e = d.ethBtc, l = d.lienNdx;
    return '<div class="v3k-reperes">'
      + '<div class="v3k-rep"><h6>ETH / BTC</h6><b>' + (e ? nf(e.dernier, 4) + '<small>' + (e.m1 > 0 ? '▲ ' : e.m1 < 0 ? '▼ ' : '') + signe(e.m1, 1) + ' sur un mois</small>' : '·') + '</b><p>' + esc(lectureEthBtc(e)) + '</p></div>'
      + '<div class="v3k-rep"><h6>Bitcoin et Nasdaq</h6><b>' + (l ? (l.c60 > 0 ? '+' : l.c60 < 0 ? '−' : '') + nf(Math.abs(l.c60), 2) + '<small>corrélation, 60 séances</small>' : '·') + '</b><p>' + esc(lectureNdx(l)) + '</p></div></div>'
      + '<div class="v3k-corps"><table><thead><tr><th>Crypto</th><th>Cours</th><th>24 h</th><th>7 jours</th><th class="col-large">30 jours</th><th class="col-large">Vol. 30 j</th></tr></thead><tbody>'
      + d.lignes.map(function (x) {
        if (!x.ok) return '<tr><td class="n"><b>' + esc(x.nom) + '</b></td><td colspan="5" class="v3k-eq">indisponible pour le moment</td></tr>';
        return '<tr data-code="' + esc(x.code) + '"><td class="n"><b>' + esc(x.nom) + '</b></td><td class="p">' + nf(x.dernier, decDe(x.dernier)) + '</td>'
          + cellule(x.j1, 6) + cellule(x.s1, 15) + cellule(x.m1, 30, 'col-large')
          + '<td class="p col-large">' + (x.vol30 == null ? '·' : nf(x.vol30, 0) + '%') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      + '<div class="v3k-pied">Clôtures quotidiennes en dollar (00:00 UTC), volatilité annualisée · relu à ' + heure(d.at) + '</div>';
  }
  function rendreGeants(d) {
    var lec = lectureGeants(d), sp = d.sp && d.sp.ok ? d.sp : null, p = d.panier || {};
    return '<div class="v3k-corps"><table><thead><tr><th>Valeur</th><th>Cours</th><th>Séance</th><th>1 mois</th><th class="col-large">Depuis janvier</th></tr></thead><tbody>'
      + d.lignes.map(function (x) {
        if (!x.ok) return '<tr><td class="n"><b>' + esc(x.nom) + '</b></td><td colspan="4" class="v3k-eq">indisponible pour le moment</td></tr>';
        return '<tr data-code="' + esc(x.code) + '"><td class="n"><b>' + esc(x.nom) + '</b></td><td class="p">' + nf(x.dernier, 2) + '</td>'
          + cellule(x.j1, 4) + cellule(x.m1, 15) + cellule(x.ytd, 40, 'col-large') + '</tr>';
      }).join('')
      + '<tr class="ref"><td class="n"><b>Moyenne des sept</b></td><td class="p">·</td>' + cellule(p.j1, 4) + cellule(p.m1, 15) + cellule(p.ytd, 40, 'col-large') + '</tr>'
      + (sp ? '<tr class="ref" data-code="US500"><td class="n"><b>S&amp;P 500</b></td><td class="p">' + nf(sp.dernier, 1) + '</td>' + cellule(sp.j1, 4) + cellule(sp.m1, 15) + cellule(sp.ytd, 40, 'col-large') + '</tr>' : '')
      + '</tbody></table></div>' + (lec ? '<p class="v3k-lec">' + esc(lec) + '</p>' : '')
      + '<div class="v3k-pied">Dernière séance de Wall Street · moyenne simple des sept (sans pondération) · relu à ' + heure(d.at) + '</div>';
  }
  window._v3CryptoActions = { lectureEthBtc: lectureEthBtc, lectureNdx: lectureNdx, lectureGeants: lectureGeants, rendreCrypto: rendreCrypto, rendreGeants: rendreGeants };

  function declarer() {
    if (!window.DTPWidgets || typeof DTPWidgets.enregistrer !== 'function') return false;
    DTPWidgets.enregistrer({
      id: 'v3-crypto', name: 'Marché crypto', court: 'Crypto', tag: 'CRYPTO', cat: 'Marché', h: 380,
      desc: 'Sept cryptos sur 24 h, 7 et 30 jours, ETH / BTC et le lien du Bitcoin avec le Nasdaq.',
      aide: '<p>Sept cryptos en dollar : Bitcoin, Ethereum, Solana, XRP, BNB, Cardano et Dogecoin, avec leur variation sur 24 heures, 7 jours et 30 jours, et leur volatilité sur 30 jours (annualisée). Un clic ouvre la fiche de la crypto.</p><p>En tête, deux repères. <b>ETH / BTC</b> : quand l’Ethereum gagne sur le Bitcoin, l’appétit s’étend aux autres cryptos ; quand il recule, le marché se replie sur la valeur la plus solide. <b>Bitcoin et Nasdaq</b> : la corrélation de leurs variations quotidiennes sur 60 séances communes ; forte, elle dit que le Bitcoin se traite comme une valeur technologique, et que les chiffres américains le font bouger.</p>',
      src: 'Paires en dollar, clôtures quotidiennes à 00:00 UTC ; Nasdaq 100 aux clôtures de Wall Street ; calculs DTP.',
      watch: 'Un ETH / BTC qui repart à la hausse après une longue baisse, et un lien avec le Nasdaq qui se renforce avant une publication américaine forte.',
      apercu: '<svg viewBox="0 0 120 56" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g font-family="sans-serif" font-size="5" fill="#8e8e98"><text x="4" y="8">ETH / BTC</text><text x="62" y="8">BITCOIN ET NASDAQ</text></g>'
        + '<g font-family="monospace" font-size="7" font-weight="700" fill="#f2f2f4"><text x="4" y="17">0,0385</text><text x="62" y="17">+0,52</text></g><line x1="0" x2="120" y1="21" y2="21" stroke="#1c1c21"/>'
        + '<g font-family="sans-serif" font-size="5.5" fill="#f2f2f4"><text x="4" y="30">Bitcoin</text><text x="4" y="40">Ethereum</text><text x="4" y="50">Solana</text></g>'
        + '<rect x="66" y="25" width="24" height="7" fill="rgba(0,230,118,.22)"/><rect x="92" y="25" width="24" height="7" fill="rgba(0,230,118,.3)"/><rect x="66" y="35" width="24" height="7" fill="rgba(255,61,0,.2)"/><rect x="92" y="35" width="24" height="7" fill="rgba(0,230,118,.14)"/><rect x="66" y="45" width="24" height="7" fill="rgba(0,230,118,.35)"/><rect x="92" y="45" width="24" height="7" fill="rgba(255,61,0,.28)"/>'
        + '<g font-family="monospace" font-size="5" text-anchor="end"><text x="88" y="30.5" fill="#00e676">+1,8%</text><text x="114" y="30.5" fill="#00e676">+4,2%</text><text x="88" y="40.5" fill="#ff3d00">-0,9%</text><text x="114" y="40.5" fill="#00e676">+1,1%</text><text x="88" y="50.5" fill="#00e676">+3,4%</text><text x="114" y="50.5" fill="#ff3d00">-5,0%</text></g></svg>',
      opts: [],
      mount: monteur('/api/v2/crypto-tableau', 'Lecture du marché crypto…', rendreCrypto),
    });
    DTPWidgets.enregistrer({
      id: 'v3-geants', name: 'Géants de la cote', court: 'Géants', tag: 'ACTIONS', cat: 'Marché', h: 360,
      desc: 'Les sept grandes valeurs américaines face au S&P 500 : séance, mois, depuis janvier.',
      aide: '<p>Apple, Microsoft, Nvidia, Amazon, Alphabet, Meta et Tesla pèsent à elles seules une part considérable du S&amp;P 500 : leur mouvement suffit souvent à faire monter ou baisser l’indice. La carte donne pour chacune la variation de la dernière séance, du mois et depuis janvier, puis la moyenne simple des sept et le S&amp;P 500.</p><p>Quand la moyenne des sept fait nettement mieux que l’indice, ce sont elles qui mènent ; quand elle fait moins bien, le marché avance sans elles. Un clic sur une ligne ouvre la fiche de la valeur.</p>',
      src: 'Actions au comptant (Nasdaq, NYSE), clôtures quotidiennes ; moyenne simple des sept, sans pondération par la capitalisation ; calculs DTP.',
      watch: 'Un écart qui se creuse entre la moyenne des sept et le S&P 500, et une séance où Nvidia décroche seule avant des résultats.',
      apercu: '<svg viewBox="0 0 120 56" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g font-family="sans-serif" font-size="5.5" fill="#f2f2f4"><text x="4" y="10">Apple</text><text x="4" y="20">Nvidia</text><text x="4" y="30">Microsoft</text><text x="4" y="40">Tesla</text></g>'
        + '<g font-family="sans-serif" font-size="5.5" fill="#e3b23a"><text x="4" y="51">S&amp;P 500</text></g><line x1="0" x2="120" y1="44" y2="44" stroke="#24242a"/>'
        + '<rect x="66" y="5" width="24" height="7" fill="rgba(0,230,118,.2)"/><rect x="66" y="15" width="24" height="7" fill="rgba(0,230,118,.38)"/><rect x="66" y="25" width="24" height="7" fill="rgba(255,61,0,.16)"/><rect x="66" y="35" width="24" height="7" fill="rgba(255,61,0,.34)"/><rect x="66" y="46" width="24" height="7" fill="rgba(0,230,118,.12)"/>'
        + '<rect x="92" y="5" width="24" height="7" fill="rgba(0,230,118,.14)"/><rect x="92" y="15" width="24" height="7" fill="rgba(0,230,118,.3)"/><rect x="92" y="25" width="24" height="7" fill="rgba(0,230,118,.1)"/><rect x="92" y="35" width="24" height="7" fill="rgba(255,61,0,.24)"/><rect x="92" y="46" width="24" height="7" fill="rgba(0,230,118,.1)"/>'
        + '<g font-family="monospace" font-size="5" text-anchor="end"><text x="88" y="10.5" fill="#00e676">+0,8%</text><text x="88" y="20.5" fill="#00e676">+2,4%</text><text x="88" y="30.5" fill="#ff3d00">-0,5%</text><text x="88" y="40.5" fill="#ff3d00">-2,1%</text><text x="88" y="51.5" fill="#00e676">+0,4%</text></g></svg>',
      opts: [],
      mount: monteur('/api/v2/grandes-valeurs', 'Lecture des grandes valeurs…', rendreGeants),
    });
    return true;
  }
  if (!declarer()) { var n = 0; (function r() { if (declarer() || ++n > 100) return; setTimeout(r, 100); })(); }
})();

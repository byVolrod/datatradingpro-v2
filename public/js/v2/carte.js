/* ═══ DTP V3 · CARTE DU MONDE (comptes admin, « Aperçu V3 ») ═════════════════════════════════════════
   Feuille de route V3, phase 5 : « Carte du monde intelligente » — la chaîne
   ÉVÉNEMENT → ZONE → FLUX (énergie, commerce) → ACTIFS → DEVISES, lisible d'un regard.

   Quatre couches, chacune tirée de données RÉELLES du desk ou de faits relus, jamais inventés :
     · Actualité : chaque dépêche du fil (les 6, 24 ou 72 dernières heures) rattachée au pays qu'elle
       NOMME. Le pays prend une teinte d'or proportionnelle au nombre de dépêches ; une dépêche de la
       dernière heure fait battre un point. Rattachement par mots-clés relus (nom, capitale, banque
       centrale, dirigeant) : une dépêche qui ne nomme aucun pays n'est placée nulle part.
     · Banques centrales : les huit du desk, taux et prochaine réunion lus sur /api/rates.
     · Points de passage : détroits et canaux par où passent l'énergie et le commerce. Un passage
       NOMMÉ par une dépêche récente passe au rouge.
     · Ressources : les grands pays producteurs d'une matière (pétrole, gaz, or, argent, cuivre, blé,
       minerai de fer, lithium). Liste qualitative, sans chiffre : on ne publie pas un classement
       qu'on ne peut pas sourcer à la ligne.
   Un clic sur un pays ouvre sa fiche : devise, banque centrale, actifs exposés avec leur variation du
   jour (/api/market-snapshot), dépêches récentes, et la chaîne d'impact de la plus récente.

   ⚠️ LE FOND DE CARTE N'EST PAS DANS LE DÉPÔT : c'est `am5geodata_worldLow`, déjà chargé par
   index.html pour les cartes amCharts du desk (licence amCharts, CDN officiel). La carte le dessine
   elle-même en SVG (projection Natural Earth) : aucune racine amCharts de plus, et un rendu qui
   suit la charte V3 au pixel. Tant que le fond n'est pas arrivé, la carte l'attend (10 s au plus)
   puis le dit, au lieu de tourner à vide. */
(function () {
  'use strict';
  if (window._v3Carte) return;
  window._v3Carte = true;

  /* ── Données relues ────────────────────────────────────────────────────────────────────────────── */
  // Pays suivis : nom affiché, devise, point d'ancrage [lat, lon], mots qui les nomment (anglais et
  // français, le fil mêlant les deux), actifs exposés.
  var PAYS = {
    US: { n: 'États-Unis', dev: 'USD', p: [38.9, -77.0], m: ['united states', 'u\\.s\\.', 'american', 'washington', 'white house', 'fed', 'fomc', 'powell', 'trump', 'treasury', 'wall street', 'états-unis', 'américain'], M: ['US', 'USA'], a: ['S&P 500', 'Nasdaq', 'US 10 ans', 'DXY'] },
    CA: { n: 'Canada', dev: 'CAD', p: [45.4, -75.7], m: ['canada', 'canadian', 'ottawa', 'bank of canada', 'boc', 'macklem', 'carney', 'canadien'], a: ['USD/CAD', 'WTI'] },
    MX: { n: 'Mexique', dev: 'MXN', p: [19.4, -99.1], m: ['mexico', 'mexican', 'banxico', 'sheinbaum', 'mexique'], a: ['USD/MXN', 'Argent'] },
    BR: { n: 'Brésil', dev: 'BRL', p: [-15.8, -47.9], m: ['brazil', 'brazilian', 'lula', 'brésil'], a: ['USD/BRL', 'Minerai de fer'] },
    AR: { n: 'Argentine', dev: 'ARS', p: [-34.6, -58.4], m: ['argentina', 'argentine', 'milei'], a: ['Blé', 'Lithium'] },
    CL: { n: 'Chili', dev: 'CLP', p: [-33.4, -70.6], m: ['chile', 'chilean', 'chili'], a: ['Cuivre', 'Lithium'] },
    PE: { n: 'Pérou', dev: 'PEN', p: [-12.0, -77.0], m: ['peru', 'peruvian', 'pérou'], a: ['Cuivre', 'Argent'] },
    VE: { n: 'Venezuela', dev: 'VES', p: [10.5, -66.9], m: ['venezuela', 'venezuelan', 'maduro', 'caracas'], a: ['WTI'] },
    GB: { n: 'Royaume-Uni', dev: 'GBP', p: [51.5, -0.1], m: ['united kingdom', 'britain', 'british', 'london', 'bank of england', 'boe', 'bailey', 'reeves', 'starmer', 'royaume-uni', 'britannique', 'gilt'], M: ['UK'], a: ['GBP/USD', 'FTSE 100'] },
    DE: { n: 'Allemagne', dev: 'EUR', p: [52.5, 13.4], m: ['germany', 'german', 'berlin', 'bundesbank', 'bund', 'merz', 'allemagne', 'allemand'], a: ['EUR/USD', 'DAX', 'Bund'] },
    FR: { n: 'France', dev: 'EUR', p: [48.9, 2.35], m: ['france', 'french', 'paris', 'macron', 'élysée', 'français'], a: ['EUR/USD', 'CAC 40'] },
    IT: { n: 'Italie', dev: 'EUR', p: [41.9, 12.5], m: ['italy', 'italian', 'rome', 'meloni', 'btp', 'italie'], a: ['EUR/USD', 'BTP'] },
    ES: { n: 'Espagne', dev: 'EUR', p: [40.4, -3.7], m: ['spain', 'spanish', 'madrid', 'espagne'], a: ['EUR/USD'] },
    NL: { n: 'Pays-Bas', dev: 'EUR', p: [52.4, 4.9], m: ['netherlands', 'dutch', 'amsterdam', 'ttf', 'pays-bas'], a: ['Gaz TTF', 'EUR/USD'] },
    CH: { n: 'Suisse', dev: 'CHF', p: [46.9, 7.4], m: ['switzerland', 'swiss', 'snb', 'schlegel', 'suisse'], a: ['USD/CHF', 'Or'] },
    NO: { n: 'Norvège', dev: 'NOK', p: [59.9, 10.8], m: ['norway', 'norwegian', 'norges', 'equinor', 'norvège'], a: ['EUR/NOK', 'Brent', 'Gaz'] },
    SE: { n: 'Suède', dev: 'SEK', p: [59.3, 18.1], m: ['sweden', 'swedish', 'riksbank', 'suède'], a: ['EUR/SEK'] },
    PL: { n: 'Pologne', dev: 'PLN', p: [52.2, 21.0], m: ['poland', 'polish', 'warsaw', 'pologne'], a: ['EUR/PLN'] },
    UA: { n: 'Ukraine', dev: 'UAH', p: [50.45, 30.5], m: ['ukraine', 'ukrainian', 'kyiv', 'kiev', 'zelensky'], a: ['Blé', 'EUR/USD', 'Or'] },
    RU: { n: 'Russie', dev: 'RUB', p: [55.75, 37.6], m: ['russia', 'russian', 'kremlin', 'putin', 'moscow', 'russie', 'poutine'], a: ['Brent', 'Gaz', 'Blé', 'Or'] },
    TR: { n: 'Turquie', dev: 'TRY', p: [39.9, 32.85], m: ['turkey', 'turkish', 'türkiye', 'erdogan', 'ankara', 'turquie'], a: ['USD/TRY'] },
    IL: { n: 'Israël', dev: 'ILS', p: [31.8, 35.2], m: ['israel', 'israeli', 'netanyahu', 'idf', 'tel aviv', 'israël'], a: ['Or', 'Brent'] },
    PS: { n: 'Palestine', dev: 'ILS', p: [31.5, 34.45], m: ['gaza', 'hamas', 'west bank', 'palestinian', 'palestine', 'cisjordanie'], a: ['Or', 'Brent'] },
    LB: { n: 'Liban', dev: 'LBP', p: [33.9, 35.5], m: ['lebanon', 'lebanese', 'hezbollah', 'beirut', 'liban'], a: ['Brent'] },
    SY: { n: 'Syrie', dev: 'SYP', p: [33.5, 36.3], m: ['syria', 'syrian', 'damascus', 'syrie'], a: ['Brent'] },
    IQ: { n: 'Irak', dev: 'IQD', p: [33.3, 44.4], m: ['iraq', 'iraqi', 'baghdad', 'irak'], a: ['Brent', 'WTI'] },
    IR: { n: 'Iran', dev: 'IRR', p: [35.7, 51.4], m: ['iran', 'iranian', 'tehran', 'khamenei', 'téhéran'], a: ['Brent', 'WTI', 'Or'] },
    SA: { n: 'Arabie saoudite', dev: 'SAR', p: [24.7, 46.7], m: ['saudi', 'riyadh', 'aramco', 'saoudien', 'arabie'], M: ['KSA'], a: ['Brent', 'WTI'] },
    AE: { n: 'Émirats arabes unis', dev: 'AED', p: [24.45, 54.4], m: ['emirates', 'dubai', 'abu dhabi', 'émirats'], M: ['UAE'], a: ['Brent'] },
    QA: { n: 'Qatar', dev: 'QAR', p: [25.3, 51.5], m: ['qatar', 'qatari', 'doha'], a: ['Gaz'] },
    KW: { n: 'Koweït', dev: 'KWD', p: [29.4, 48.0], m: ['kuwait', 'koweït'], a: ['Brent'] },
    YE: { n: 'Yémen', dev: 'YER', p: [15.35, 44.2], m: ['yemen', 'houthi', 'sanaa', 'yémen'], a: ['Brent'] },
    EG: { n: 'Égypte', dev: 'EGP', p: [30.05, 31.25], m: ['egypt', 'egyptian', 'cairo', 'égypte'], a: ['Brent', 'Blé'] },
    LY: { n: 'Libye', dev: 'LYD', p: [32.9, 13.2], m: ['libya', 'libyan', 'tripoli', 'libye'], a: ['Brent'] },
    NG: { n: 'Nigeria', dev: 'NGN', p: [9.05, 7.5], m: ['nigeria', 'nigerian', 'abuja'], a: ['Brent'] },
    ZA: { n: 'Afrique du Sud', dev: 'ZAR', p: [-25.75, 28.2], m: ['south africa', 'sarb', 'pretoria', 'johannesburg', 'afrique du sud'], a: ['USD/ZAR', 'Or', 'Platine'] },
    CD: { n: 'RD Congo', dev: 'CDF', p: [-4.3, 15.3], m: ['congo', 'kinshasa', 'drc'], a: ['Cuivre', 'Cobalt'] },
    GH: { n: 'Ghana', dev: 'GHS', p: [5.6, -0.2], m: ['ghana', 'ghanaian', 'accra'], a: ['Or', 'Cacao'] },
    IN: { n: 'Inde', dev: 'INR', p: [28.6, 77.2], m: ['india', 'indian', 'modi', 'reserve bank of india', 'rbi', 'new delhi', 'mumbai', 'inde'], a: ['USD/INR', 'Or'] },
    PK: { n: 'Pakistan', dev: 'PKR', p: [33.7, 73.05], m: ['pakistan', 'pakistani', 'islamabad'], a: ['Or'] },
    CN: { n: 'Chine', dev: 'CNY', p: [39.9, 116.4], m: ['china', 'chinese', 'beijing', 'pboc', 'xi jinping', 'yuan', 'renminbi', 'shanghai', 'chine', 'chinois'], a: ['USD/CNH', 'AUD/USD', 'Cuivre', 'Minerai de fer'] },
    HK: { n: 'Hong Kong', dev: 'HKD', p: [22.3, 114.2], m: ['hong kong', 'hang seng'], a: ['Hang Seng', 'USD/CNH'] },
    TW: { n: 'Taïwan', dev: 'TWD', p: [25.05, 121.55], m: ['taiwan', 'taiwanese', 'taipei', 'tsmc', 'taïwan'], a: ['Nasdaq', 'USD/JPY'] },
    KR: { n: 'Corée du Sud', dev: 'KRW', p: [37.55, 127.0], m: ['south korea', 'korean', 'seoul', 'bank of korea', 'samsung', 'corée du sud'], a: ['USD/KRW', 'Nasdaq'] },
    KP: { n: 'Corée du Nord', dev: 'KPW', p: [39.0, 125.75], m: ['north korea', 'pyongyang', 'kim jong', 'corée du nord'], a: ['Or', 'USD/JPY'] },
    JP: { n: 'Japon', dev: 'JPY', p: [35.7, 139.7], m: ['japan', 'japanese', 'tokyo', 'boj', 'bank of japan', 'ueda', 'takaichi', 'nikkei', 'japon', 'japonais'], a: ['USD/JPY', 'Nikkei', 'JGB'] },
    SG: { n: 'Singapour', dev: 'SGD', p: [1.3, 103.8], m: ['singapore', 'singapour'], a: ['USD/SGD'] },
    ID: { n: 'Indonésie', dev: 'IDR', p: [-6.2, 106.85], m: ['indonesia', 'indonesian', 'jakarta', 'indonésie'], a: ['Nickel', 'Charbon'] },
    AU: { n: 'Australie', dev: 'AUD', p: [-35.3, 149.1], m: ['australia', 'australian', 'rba', 'bullock', 'sydney', 'canberra', 'australie'], a: ['AUD/USD', 'Minerai de fer', 'Or'] },
    NZ: { n: 'Nouvelle-Zélande', dev: 'NZD', p: [-41.3, 174.8], m: ['new zealand', 'rbnz', 'wellington', 'nouvelle-zélande', 'kiwi'], a: ['NZD/USD'] },
    KZ: { n: 'Kazakhstan', dev: 'KZT', p: [51.15, 71.45], m: ['kazakhstan'], a: ['Brent', 'Uranium'] },
    VN: { n: 'Viêt Nam', dev: 'VND', p: [21.0, 105.85], m: ['vietnam', 'vietnamese', 'hanoi', 'viêt nam'], a: [] },
    GR: { n: 'Grèce', dev: 'EUR', p: [37.95, 23.7], m: ['greece', 'greek', 'athens', 'grèce'], a: ['EUR/USD'] },
    HU: { n: 'Hongrie', dev: 'HUF', p: [47.5, 19.05], m: ['hungary', 'hungarian', 'orban', 'budapest', 'hongrie'], a: ['EUR/HUF'] },
  };
  // La zone euro : une dépêche de la BCE ou « eurozone » éclaire ses grands membres.
  var ZONE_EURO = { m: ['ecb', 'eurozone', 'euro area', 'euro zone', 'lagarde', 'bce', 'zone euro'], pays: ['DE', 'FR', 'IT', 'ES', 'NL', 'GR'] };

  // Banques centrales du desk (même liste que l'onglet Taux) : code devise → pays et siège.
  var BC = [
    { dev: 'USD', nom: 'Fed', pays: 'US', p: [38.9, -77.0] },
    { dev: 'EUR', nom: 'BCE', pays: 'DE', p: [50.1, 8.7] },
    { dev: 'GBP', nom: 'BoE', pays: 'GB', p: [51.5, -0.1] },
    { dev: 'JPY', nom: 'BoJ', pays: 'JP', p: [35.7, 139.7] },
    { dev: 'CHF', nom: 'BNS', pays: 'CH', p: [46.9, 7.4] },
    { dev: 'CAD', nom: 'BoC', pays: 'CA', p: [45.4, -75.7] },
    { dev: 'AUD', nom: 'RBA', pays: 'AU', p: [-33.9, 151.2] },
    { dev: 'NZD', nom: 'RBNZ', pays: 'NZ', p: [-41.3, 174.8] },
  ];

  // Points de passage : ce qui y transite, et ce qui bouge quand il se ferme (relu, qualitatif).
  var PASSAGES = [
    { id: 'hormuz', n: 'Détroit d’Ormuz', p: [26.6, 56.4], m: ['hormuz', 'ormuz'], flux: 'Pétrole et GNL du Golfe (Arabie saoudite, Irak, Émirats, Koweït, Qatar, Iran)', actifs: ['Brent', 'WTI', 'Gaz', 'USD/JPY', 'Or'] },
    { id: 'bab', n: 'Bab el-Mandeb / mer Rouge', p: [12.6, 43.4], m: ['bab el-mandeb', 'bab al-mandab', 'red sea', 'mer rouge', 'houthi'], flux: 'Route Asie–Europe par Suez : conteneurs, pétrole et GNL', actifs: ['Brent', 'Fret maritime', 'EUR/USD'] },
    { id: 'suez', n: 'Canal de Suez', p: [30.4, 32.35], m: ['suez'], flux: 'Environ un dixième du commerce maritime mondial, route Asie–Europe', actifs: ['Brent', 'Fret maritime'] },
    { id: 'malacca', n: 'Détroit de Malacca', p: [2.5, 101.4], m: ['malacca', 'malacca strait'], flux: 'Pétrole et GNL vers la Chine, le Japon et la Corée', actifs: ['Brent', 'USD/CNH', 'USD/JPY'] },
    { id: 'panama', n: 'Canal de Panama', p: [9.1, -79.7], m: ['panama canal', 'canal de panama'], flux: 'Céréales et GNL américains vers l’Asie', actifs: ['Blé', 'Gaz', 'Fret maritime'] },
    { id: 'bosphore', n: 'Bosphore', p: [41.1, 29.05], m: ['bosphorus', 'bosporus', 'bosphore', 'black sea', 'mer noire'], flux: 'Blé et pétrole de la mer Noire (Russie, Ukraine, Kazakhstan)', actifs: ['Blé', 'Brent'] },
    { id: 'taiwan', n: 'Détroit de Taïwan', p: [24.4, 119.6], m: ['taiwan strait', 'détroit de taïwan'], flux: 'Semi-conducteurs et commerce de l’Asie de l’Est', actifs: ['Nasdaq', 'USD/JPY', 'Or'] },
    { id: 'gibraltar', n: 'Gibraltar', p: [35.95, -5.6], m: ['gibraltar'], flux: 'Entrée de la Méditerranée, route Atlantique–Suez', actifs: ['Brent'] },
  ];

  // Ressources : grands producteurs (qualitatif) et ce que la matière entraîne.
  var RESSOURCES = {
    petrole: { n: 'Pétrole', c: '#ffb300', pays: ['US', 'SA', 'RU', 'CA', 'IQ', 'CN', 'AE', 'BR', 'IR', 'KW', 'NO', 'KZ', 'NG', 'LY', 'MX', 'VE'], actifs: ['Brent', 'WTI'], devises: 'CAD et NOK (exportateurs), JPY et INR (importateurs)' },
    gaz: { n: 'Gaz / GNL', c: '#38bdf8', pays: ['US', 'RU', 'IR', 'CN', 'CA', 'QA', 'AU', 'NO', 'SA', 'DZ'], actifs: ['Gaz TTF', 'Gaz Henry Hub'], devises: 'EUR (importateur), NOK (exportateur)' },
    or: { n: 'Or', c: '#e3b23a', pays: ['CN', 'AU', 'RU', 'CA', 'US', 'GH', 'PE', 'MX', 'ZA', 'KZ', 'ID'], actifs: ['XAU/USD'], devises: 'AUD et ZAR (producteurs), CHF et JPY (refuges)' },
    argent: { n: 'Argent', c: '#cbd5e1', pays: ['MX', 'CN', 'PE', 'CL', 'PL', 'AU', 'RU', 'US'], actifs: ['XAG/USD'], devises: 'MXN et PEN (producteurs)' },
    cuivre: { n: 'Cuivre', c: '#f97316', pays: ['CL', 'PE', 'CD', 'CN', 'US', 'RU', 'ID', 'AU', 'ZM', 'MX'], actifs: ['Cuivre (HG)'], devises: 'CLP et PEN (producteurs), AUD (lié à la Chine)' },
    ble: { n: 'Blé', c: '#d9b26f', pays: ['CN', 'IN', 'RU', 'US', 'FR', 'CA', 'UA', 'AU', 'AR', 'DE', 'PK', 'TR'], actifs: ['Blé (ZW)'], devises: 'RUB et UAH (exportateurs), EGP (importateur)' },
    fer: { n: 'Minerai de fer', c: '#b45309', pays: ['AU', 'BR', 'CN', 'IN', 'RU', 'ZA', 'CA'], actifs: ['Minerai de fer'], devises: 'AUD et BRL (exportateurs), CNY (acheteur)' },
    lithium: { n: 'Lithium', c: '#a78bfa', pays: ['AU', 'CL', 'CN', 'AR', 'BR', 'ZW'], actifs: ['Lithium'], devises: 'AUD et CLP (producteurs)' },
    crypto: { n: 'Crypto (places et régulateurs)', c: '#8b5cf6', pays: ['US', 'SG', 'AE', 'HK', 'JP', 'KR', 'GB', 'CH'], actifs: ['BTC/USD', 'ETH/USD'], devises: 'USD (liquidité, régulation SEC)' },
  };

  // Familles de dépêches (légende nommée : l'identité n'est jamais portée par la seule couleur).
  var FAMILLES = [
    { k: 'geo', n: 'Géopolitique', c: '#ff3d00', r: /\b(wars?|attacks?|strikes?|struck|missiles?|troops|sanctions?|ceasefire|military|nuclear|drones?|invasion|conflict|hostages?|tensions?|drills|blockade|close the strait|guerre|frappes?|attaques?|militaire|nucléaire|cessez-le-feu)\b/i },
    { k: 'energie', n: 'Énergie', c: '#ffb300', r: /\b(oil|crude|brent|wti|opec\+?|gas|lng|pipeline|refiner(y|ies)|pétrole|gaz|brut)\b/i },
    { k: 'bc', n: 'Banques centrales', c: '#e3b23a', r: /\b(rate (hike|cut|decision)|hikes?|cuts? rates?|holds? rates|keeps? rates|bank of (japan|england|canada|korea)|central bank|fomc|fed|ecb|boe|boj|snb|rba|rbnz|boc|pboc|banque centrale|taux directeur|bce)\b/i },
    { k: 'donnees', n: 'Données', c: '#38bdf8', r: /\b(cpi|ppi|gdp|pmi|payrolls?|nfp|inflation|unemployment|jobless|retail sales|pib|chômage|emploi)\b/i },
    { k: 'metaux', n: 'Métaux', c: '#cbd5e1', r: /\b(gold|silver|copper|platinum|palladium|lithium|iron ore|nickel|bullion|cuivre|lingot)\b/i },
    { k: 'crypto', n: 'Crypto', c: '#a78bfa', r: /\b(bitcoin|btc|crypto|ethereum|eth|stablecoins?|solana|blockchain)\b/i },
  ];
  var FAM_AUTRE = { k: 'autre', n: 'Autres', c: '#6b7280' };

  /* ── Outils ─────────────────────────────────────────────────────────────────────────────────── */
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var RAD = Math.PI / 180;
  // Natural Earth I (Šavrič et al.) : lisible pour un planisphère, sans l'étirement polaire de Mercator.
  function proj(lon, lat) {
    var l = lon * RAD, p = lat * RAD, p2 = p * p, p4 = p2 * p2;
    var x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
    var y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
    return [x * 180 + 540, 280 - y * 180];         // repère SVG : 1080 × 560 environ
  }
  var W = 1080, H = 560;
  var geoChemins = null;       // [{ id, nom, d }] — calculé une fois pour toutes les cartes
  function chemins() {
    if (geoChemins) return geoChemins;
    var g = typeof am5geodata_worldLow !== 'undefined' ? am5geodata_worldLow : null;
    if (!g || !g.features) return null;
    geoChemins = [];
    g.features.forEach(function (f) {
      var id = (f.properties && f.properties.id) || f.id;
      if (id === 'AQ' || !f.geometry) return;
      var polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
      var d = '';
      polys.forEach(function (poly) {
        poly.forEach(function (anneau) {
          var prec = null;
          anneau.forEach(function (pt, i) {
            var q = proj(pt[0], pt[1]);
            // Un anneau qui franchit l'antiméridien (Russie, Fidji) tracerait une barre à travers la
            // carte : on relève le crayon au saut.
            var saut = prec && Math.abs(q[0] - prec[0]) > W / 2;
            d += (i === 0 || saut ? 'M' : 'L') + q[0].toFixed(1) + ',' + q[1].toFixed(1);
            prec = q;
          });
          d += 'Z';
        });
      });
      geoChemins.push({ id: id, nom: (f.properties && f.properties.name) || id, d: d });
    });
    return geoChemins;
  }

  // Expressions de rattachement, compilées une fois. Les sigles (US, UK, UAE) sont sensibles à la
  // casse : « us » en minuscules est un pronom.
  /* ⚠️ PAS DE `\b` : en JavaScript, `\b` ne connaît que [A-Za-z0-9_], donc « états-unis » ou
     « Élysée » ne seraient JAMAIS reconnus (la frontière avant « é » n'existe pas). Les bornes sont
     écrites en classes Unicode, drapeau `u`. */
  function mots(liste, drapeaux) { return new RegExp('(?:^|[^\\p{L}\\p{N}])(?:' + liste.join('|') + ')(?=$|[^\\p{L}\\p{N}])', drapeaux + 'u'); }
  var RX = {};
  Object.keys(PAYS).forEach(function (iso) {
    var P = PAYS[iso];
    RX[iso] = { i: mots(P.m, 'i'), s: P.M ? mots(P.M, '') : null };
  });
  var RX_EURO = mots(ZONE_EURO.m, 'i');
  PASSAGES.forEach(function (p) { p.rx = mots(p.m, 'i'); });
  function paysDe(txt) {
    var out = [];
    Object.keys(RX).forEach(function (iso) { if (RX[iso].i.test(txt) || (RX[iso].s && RX[iso].s.test(txt))) out.push(iso); });
    if (RX_EURO.test(txt)) ZONE_EURO.pays.forEach(function (iso) { if (out.indexOf(iso) < 0) out.push(iso); });
    return out;
  }
  function familleDe(txt, cat) {
    var c = String(cat || '');
    // La catégorie posée par la SOURCE prime sur les mots du titre : « Oil jumps as Iran tensions
    // rise » est une dépêche Énergie, même si « tensions » est un mot de la géopolitique.
    if (/^(Fed|ECB|BoJ|BoE|BoC|RBA|SNB|RBNZ|FOMC)$/.test(c)) return FAMILLES[2];
    if (/Data$/.test(c)) return FAMILLES[3];
    if (/Energy|Énergie/i.test(c)) return FAMILLES[1];
    if (/Geopolit|Géopolit/i.test(c)) return FAMILLES[0];
    if (/Crypto/i.test(c)) return FAMILLES[5];
    for (var i = 0; i < FAMILLES.length; i++) if (FAMILLES[i].r.test(txt)) return FAMILLES[i];
    return FAM_AUTRE;
  }
  function depeches(heures) {
    var src = typeof allItems !== 'undefined' && Array.isArray(allItems) ? allItems : [];
    var borne = Date.now() - heures * 3600e3, out = [];
    for (var i = 0; i < src.length && out.length < 1500; i++) {
      var it = src[i];
      if (!it || !it.headline || !(+it.timestamp >= borne) || it.source === 'DTP' || it._briefing) continue;
      var txt = it.headline + ' ' + (it._titreFr || '');
      var pays = paysDe(txt);
      var passages = PASSAGES.filter(function (p) { return p.rx.test(txt); }).map(function (p) { return p.id; });
      if (!pays.length && !passages.length) continue;
      out.push({ it: it, pays: pays, passages: passages, fam: familleDe(txt, it.category), ts: +it.timestamp });
    }
    return out;
  }
  var hm = function (ts) { var d = new Date(ts); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); };
  var drap = function (iso) { return '<img class="v3c-fl" src="https://flagcdn.com/w40/' + String(iso).toLowerCase() + '.png" alt="" loading="lazy">'; };

  // Données de marché partagées entre toutes les cartes (une lecture par minute au plus).
  var marche = { at: 0, taux: null, snap: null, enVol: null };
  function lireMarche() {
    if (marche.enVol) return marche.enVol;
    if (Date.now() - marche.at < 60000 && (marche.taux || marche.snap)) return Promise.resolve(marche);
    var j = function (u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    marche.enVol = Promise.all([j('/api/rates'), j('/api/market-snapshot')]).then(function (x) {
      marche.taux = x[0] || marche.taux; marche.snap = x[1] || marche.snap; marche.at = Date.now(); marche.enVol = null; return marche;
    });
    return marche.enVol;
  }
  // Variation du jour d'un actif, lue dans l'instantané de marché (libellés de /api/market-snapshot).
  var ALIAS = { 'S&P 500': 'S&P 500', 'Nasdaq': 'Nasdaq Comp.', 'DXY': 'DXY', 'EUR/USD': 'EUR/USD', 'USD/JPY': 'USD/JPY', 'GBP/USD': 'GBP/USD', 'Brent': 'Brent', 'WTI': 'WTI', 'Or': 'Spot Gold', 'XAU/USD': 'Spot Gold', 'Cuivre': 'Copper', 'Cuivre (HG)': 'Copper', 'BTC/USD': 'Bitcoin', 'ETH/USD': 'Ethereum', 'US 10 ans': 'US 10yr Yield' };
  function variation(actif) {
    var lib = ALIAS[actif]; if (!lib || !marche.snap || !marche.snap.groups) return null;
    for (var g = 0; g < marche.snap.groups.length; g++) {
      var its = marche.snap.groups[g].items || [];
      for (var i = 0; i < its.length; i++) if (its[i].label === lib && its[i].pct != null) return +its[i].pct;
    }
    return null;
  }
  function tauxDe(dev) {
    var b = marche.taux && Array.isArray(marche.taux.banks) ? marche.taux.banks : [];
    for (var i = 0; i < b.length; i++) if (b[i].code === dev) return b[i];
    return null;
  }

  /* ── Styles (bornés à html.dtp-v2 : sans l'aperçu V3, rien ne s'applique) ───────────────────── */
  var CSS = ''
    + 'html.dtp-v2 .v3c{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:#08080a;font-family:"Inter Tight",system-ui,sans-serif;color:#d6d6dc}'
    + 'html.dtp-v2 .v3c-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid #16161a;background:#0c0c0e}'
    + 'html.dtp-v2 .v3c-ch{border:1px solid #24242a;background:transparent;color:#8e8e98;font:500 11.5px/1 "Inter Tight",system-ui,sans-serif;padding:5px 9px;border-radius:4px;cursor:pointer;transition:color .15s,border-color .15s,background .15s}'
    + 'html.dtp-v2 .v3c-ch:hover{color:#ececf0;border-color:#34343c}'
    + 'html.dtp-v2 .v3c-ch.on{color:#e3b23a;border-color:rgba(227,178,58,.55);background:rgba(227,178,58,.08)}'
    + 'html.dtp-v2 .v3c-sep{width:1px;height:18px;background:#22222a;margin:0 2px}'
    + 'html.dtp-v2 .v3c-sel{background:#0e0e11;border:1px solid #24242a;color:#d6d6dc;font:500 11.5px "Inter Tight",system-ui,sans-serif;border-radius:4px;padding:4px 6px}'
    + 'html.dtp-v2 .v3c-corps{flex:1;min-height:0;display:flex}'
    + 'html.dtp-v2 .v3c-vue{position:relative;flex:1;min-width:0;overflow:hidden;cursor:grab;background:radial-gradient(120% 100% at 50% 40%,#0d0f14,#08080a 70%)}'
    + 'html.dtp-v2 .v3c-vue.v3c-glisse{cursor:grabbing}'
    + 'html.dtp-v2 .v3c-svg{position:absolute;inset:0;width:100%;height:100%;display:block}'
    + 'html.dtp-v2 .v3c-pays{fill:#15161b;stroke:#26272e;stroke-width:.5;vector-effect:non-scaling-stroke;transition:fill .25s}'
    + 'html.dtp-v2 .v3c-pays:hover{fill:#23252d;cursor:pointer}'
    + 'html.dtp-v2 .v3c-pays.v3c-sel-p{stroke:#e3b23a;stroke-width:1.4}'
    + 'html.dtp-v2 .v3c-grat{fill:none;stroke:#14151a;stroke-width:.5;vector-effect:non-scaling-stroke}'
    + 'html.dtp-v2 .v3c-pt{pointer-events:none}'
    + 'html.dtp-v2 .v3c-puls{transform-box:fill-box;transform-origin:center;animation:v3cPuls 1.8s ease-out infinite}'
    + '@keyframes v3cPuls{from{transform:scale(1);opacity:.75}to{transform:scale(3.2);opacity:0}}'
    + 'html.dtp-v2 .v3c-lib{font:600 9.5px "Inter Tight",system-ui,sans-serif;fill:#ececf0;paint-order:stroke;stroke:#08080a;stroke-width:3px;stroke-linejoin:round;pointer-events:none}'
    + 'html.dtp-v2 .v3c-zoom{position:absolute;right:8px;bottom:8px;display:flex;flex-direction:column;gap:1px;background:#16161a;border:1px solid #22222a;border-radius:4px;overflow:hidden}'
    + 'html.dtp-v2 .v3c-zoom button{width:26px;height:24px;border:0;background:#0e0e11;color:#a1a1aa;font:600 14px/1 system-ui;cursor:pointer}'
    + 'html.dtp-v2 .v3c-zoom button:hover{color:#e3b23a}'
    + 'html.dtp-v2 .v3c-leg{position:absolute;left:8px;bottom:8px;display:flex;flex-wrap:wrap;gap:4px 10px;max-width:70%;padding:6px 8px;background:rgba(10,10,12,.82);border:1px solid #1c1c21;border-radius:4px;font-size:11px;color:#a1a1aa;backdrop-filter:blur(6px)}'
    + 'html.dtp-v2 .v3c-leg i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:0}'
    + 'html.dtp-v2 .v3c-leg b{color:#ececf0;font-weight:600;margin-left:3px}'
    + 'html.dtp-v2 .v3c-bulle{position:absolute;pointer-events:none;z-index:4;min-width:140px;max-width:260px;padding:7px 9px;background:#101013;border:1px solid #2a2a31;border-radius:4px;box-shadow:0 14px 30px -12px rgba(0,0,0,.8);font-size:11.5px;line-height:1.4;color:#d6d6dc;opacity:0;transition:opacity .12s}'
    + 'html.dtp-v2 .v3c-bulle b{color:#f4f4f6}'
    + 'html.dtp-v2 .v3c-fiche{width:300px;flex:0 0 300px;border-left:1px solid #16161a;background:#0b0b0d;overflow-y:auto;display:none}'
    + 'html.dtp-v2 .v3c.v3c-ouverte .v3c-fiche{display:block;animation:v3cFiche .25s cubic-bezier(.2,.8,.2,1)}'
    + '@keyframes v3cFiche{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}'
    + 'html.dtp-v2 .v3c-fh{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #16161a}'
    + 'html.dtp-v2 .v3c-fh h4{flex:1;margin:0;font:600 14px/1.2 "Inter Tight",system-ui,sans-serif;color:#f4f4f6}'
    + 'html.dtp-v2 .v3c-fh button{border:0;background:none;color:#6f6f78;font-size:17px;cursor:pointer}'
    + 'html.dtp-v2 .v3c-fl{width:18px;height:18px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 1px #26262c}'
    + 'html.dtp-v2 .v3c-sec{padding:10px 12px;border-bottom:1px solid #141417}'
    + 'html.dtp-v2 .v3c-sec h5{margin:0 0 7px;font:600 11.5px/1 "Inter Tight",system-ui,sans-serif;color:#7c7c86}'
    + 'html.dtp-v2 .v3c-kv{display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:3px 0;color:#b9b9c2}'
    + 'html.dtp-v2 .v3c-kv b{color:#f0f0f3;font-weight:600;font-variant-numeric:tabular-nums}'
    + 'html.dtp-v2 .v3c-up{color:#00e676!important}html.dtp-v2 .v3c-dn{color:#ff3d00!important}'
    + 'html.dtp-v2 .v3c-chaine{display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:11px}'
    + 'html.dtp-v2 .v3c-chaine span{padding:3px 6px;border:1px solid #24242a;border-radius:3px;background:#101013;color:#d6d6dc}'
    + 'html.dtp-v2 .v3c-chaine em{font-style:normal;color:#e3b23a}'
    + 'html.dtp-v2 .v3c-dep{display:flex;gap:8px;padding:6px 0;border-top:1px solid #141417;font-size:12px;line-height:1.4;color:#c9ccd4}'
    + 'html.dtp-v2 .v3c-dep:first-of-type{border-top:0}'
    + 'html.dtp-v2 .v3c-dep time{flex:0 0 36px;color:#6f6f78;font-variant-numeric:tabular-nums}'
    + 'html.dtp-v2 .v3c-dep i{flex:0 0 6px;height:6px;border-radius:50%;margin-top:6px}'
    + 'html.dtp-v2 .v3c-vide{color:#6f6f78;font-size:12px}'
    + 'html.dtp-v2 .v3c-attente{position:absolute;inset:0;display:grid;place-items:center;color:#6f6f78;font-size:12px}'
    + '@media (max-width:720px){html.dtp-v2 .v3c-corps{flex-direction:column}html.dtp-v2 .v3c-fiche{width:auto;flex:0 0 46%;border-left:0;border-top:1px solid #16161a}}'
    + '@media (prefers-reduced-motion:reduce){html.dtp-v2 .v3c-puls{animation:none}}';
  function poserStyles() {
    if (document.getElementById('v3c-styles')) return;
    var s = document.createElement('style'); s.id = 'v3c-styles'; s.textContent = CSS; document.head.appendChild(s);
  }

  /* ── Rendu d'une carte ──────────────────────────────────────────────────────────────────────── */
  var NS = 'http://www.w3.org/2000/svg';
  function monter(host, reglages) {
    poserStyles();
    var etat = { couche: reglages.couche || 'actu', heures: +reglages.heures || 24, ress: reglages.ress || 'petrole', choix: null, vb: [0, 0, W, H], vivant: true };
    host.innerHTML = '<div class="v3c">'
      + '<div class="v3c-bar">'
      + '<button type="button" class="v3c-ch" data-c="actu">Actualité</button>'
      + '<button type="button" class="v3c-ch" data-c="bc">Banques centrales</button>'
      + '<button type="button" class="v3c-ch" data-c="passages">Points de passage</button>'
      + '<button type="button" class="v3c-ch" data-c="ress">Ressources</button>'
      + '<select class="v3c-sel" data-r="1" aria-label="Ressource">' + Object.keys(RESSOURCES).map(function (k) { return '<option value="' + k + '">' + esc(RESSOURCES[k].n) + '</option>'; }).join('') + '</select>'
      + '<span class="v3c-sep"></span>'
      + '<button type="button" class="v3c-ch" data-h="6">6 h</button><button type="button" class="v3c-ch" data-h="24">24 h</button><button type="button" class="v3c-ch" data-h="72">72 h</button>'
      + '</div>'
      + '<div class="v3c-corps"><div class="v3c-vue"><div class="v3c-attente">Chargement du fond de carte…</div></div><aside class="v3c-fiche"></aside></div>'
      + '</div>';
    var racine = host.querySelector('.v3c'), vue = host.querySelector('.v3c-vue'), fiche = host.querySelector('.v3c-fiche');
    var sel = host.querySelector('[data-r]'); sel.value = etat.ress;
    var svg, gPays, gPts, bulle, legende, cheminsPays = {};

    function barre() {
      host.querySelectorAll('.v3c-ch[data-c]').forEach(function (b) { b.classList.toggle('on', b.dataset.c === etat.couche); });
      host.querySelectorAll('.v3c-ch[data-h]').forEach(function (b) { b.classList.toggle('on', +b.dataset.h === etat.heures); b.style.display = etat.couche === 'actu' || etat.couche === 'passages' ? '' : 'none'; });
      sel.style.display = etat.couche === 'ress' ? '' : 'none';
    }
    host.querySelector('.v3c-bar').addEventListener('click', function (e) {
      var b = e.target.closest('.v3c-ch'); if (!b) return;
      if (b.dataset.c) etat.couche = b.dataset.c;
      if (b.dataset.h) etat.heures = +b.dataset.h;
      if (reglages.save) reglages.save({ couche: etat.couche, heures: etat.heures, ress: etat.ress });
      barre(); peindre();
    });
    sel.addEventListener('change', function () { etat.ress = sel.value; if (reglages.save) reglages.save({ couche: etat.couche, heures: etat.heures, ress: etat.ress }); peindre(); });

    function el(nom, attrs, parent) { var n = document.createElementNS(NS, nom); for (var k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; }
    function construire() {
      var cs = chemins(); if (!cs) return false;
      vue.innerHTML = '';
      svg = el('svg', { class: 'v3c-svg', viewBox: etat.vb.join(' '), preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Carte du monde' }, vue);
      // Graticule tous les 30° : un repère discret, pas un décor.
      var grat = '';
      for (var lat = -60; lat <= 60; lat += 30) { for (var lo = -180; lo <= 180; lo += 5) { var q = proj(lo, lat); grat += (lo === -180 ? 'M' : 'L') + q[0].toFixed(1) + ',' + q[1].toFixed(1); } }
      for (var lon = -150; lon <= 150; lon += 30) { for (var la = -85; la <= 85; la += 5) { var r = proj(lon, la); grat += (la === -85 ? 'M' : 'L') + r[0].toFixed(1) + ',' + r[1].toFixed(1); } }
      el('path', { class: 'v3c-grat', d: grat }, svg);
      gPays = el('g', {}, svg);
      cs.forEach(function (c) { var p = el('path', { class: 'v3c-pays', d: c.d, 'data-id': c.id }, gPays); cheminsPays[c.id] = p; });
      gPts = el('g', {}, svg);
      bulle = document.createElement('div'); bulle.className = 'v3c-bulle'; vue.appendChild(bulle);
      legende = document.createElement('div'); legende.className = 'v3c-leg'; vue.appendChild(legende);
      var z = document.createElement('div'); z.className = 'v3c-zoom';
      z.innerHTML = '<button type="button" data-z="in" title="Zoomer">+</button><button type="button" data-z="out" title="Dézoomer">−</button><button type="button" data-z="0" title="Vue d’ensemble">⟲</button>';
      vue.appendChild(z);
      z.addEventListener('click', function (e) { var b = e.target.closest('[data-z]'); if (!b) return; if (b.dataset.z === '0') { etat.vb = [0, 0, W, H]; appliquerVb(); } else zoomer(b.dataset.z === 'in' ? 0.7 : 1.4, etat.vb[0] + etat.vb[2] / 2, etat.vb[1] + etat.vb[3] / 2); });
      brancherGestes();
      return true;
    }
    function appliquerVb() { if (svg) svg.setAttribute('viewBox', etat.vb.map(function (v) { return v.toFixed(1); }).join(' ')); }
    function zoomer(f, cx, cy) {
      var nw = Math.max(W / 8, Math.min(W, etat.vb[2] * f)), nh = nw * H / W;
      etat.vb = [cx - (cx - etat.vb[0]) * nw / etat.vb[2], cy - (cy - etat.vb[1]) * nh / etat.vb[3], nw, nh];
      borner(); appliquerVb();
    }
    function borner() { etat.vb[0] = Math.max(0, Math.min(W - etat.vb[2], etat.vb[0])); etat.vb[1] = Math.max(0, Math.min(H - etat.vb[3], etat.vb[1])); }
    function pointSvg(ev) { var r = svg.getBoundingClientRect(), s = Math.min(r.width / etat.vb[2], r.height / etat.vb[3]); var ox = (r.width - etat.vb[2] * s) / 2, oy = (r.height - etat.vb[3] * s) / 2; return [etat.vb[0] + (ev.clientX - r.left - ox) / s, etat.vb[1] + (ev.clientY - r.top - oy) / s, s]; }
    function brancherGestes() {
      vue.addEventListener('wheel', function (e) { if (!e.ctrlKey && !e.metaKey && !e.altKey && Math.abs(e.deltaY) < 4) return; e.preventDefault(); var p = pointSvg(e); zoomer(e.deltaY > 0 ? 1.15 : 0.87, p[0], p[1]); }, { passive: false });
      var glisse = null;
      vue.addEventListener('pointerdown', function (e) { if (e.target.closest('.v3c-zoom,.v3c-leg')) return; glisse = { x: e.clientX, y: e.clientY, vb: etat.vb.slice(), bouge: false }; });
      window.addEventListener('pointermove', function (e) {
        if (!glisse || !svg) return;
        var dx = e.clientX - glisse.x, dy = e.clientY - glisse.y;
        if (!glisse.bouge && Math.abs(dx) + Math.abs(dy) < 4) return;
        glisse.bouge = true; vue.classList.add('v3c-glisse');
        var s = pointSvg(e)[2];
        etat.vb[0] = glisse.vb[0] - dx / s; etat.vb[1] = glisse.vb[1] - dy / s; borner(); appliquerVb();
      });
      window.addEventListener('pointerup', function (e) {
        if (!glisse) return;
        var etaitGlisse = glisse.bouge; glisse = null; vue.classList.remove('v3c-glisse');
        if (etaitGlisse) return;
        var p = e.target && e.target.closest && e.target.closest('.v3c-pays');
        if (p && vue.contains(p)) ouvrir(p.getAttribute('data-id'));
      });
      vue.addEventListener('mousemove', function (e) {
        var p = e.target.closest && e.target.closest('.v3c-pays');
        if (!p) { bulle.style.opacity = 0; return; }
        var id = p.getAttribute('data-id'), info = infos[id];
        var nom = (PAYS[id] && PAYS[id].n) || (geoChemins.filter(function (c) { return c.id === id; })[0] || {}).nom || id;
        bulle.innerHTML = '<b>' + esc(nom) + '</b>' + (info ? '<br>' + esc(info) : '');
        var r = vue.getBoundingClientRect();
        var x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
        if (x + 240 > r.width) x = e.clientX - r.left - 250;
        bulle.style.left = x + 'px'; bulle.style.top = y + 'px'; bulle.style.opacity = 1;
      });
      vue.addEventListener('mouseleave', function () { bulle.style.opacity = 0; });
    }

    var infos = {}, dernieres = [];
    function point(lat, lon, rayon, couleur, pulse, titre) {
      var q = proj(lon, lat), g = el('g', { class: 'v3c-pt' }, gPts);
      if (pulse) el('circle', { class: 'v3c-puls', cx: q[0], cy: q[1], r: rayon, fill: couleur }, g);
      el('circle', { cx: q[0], cy: q[1], r: rayon, fill: couleur, stroke: '#08080a', 'stroke-width': 1.2 }, g);
      if (titre) { var t = el('text', { class: 'v3c-lib', x: q[0] + rayon + 3, y: q[1] + 3 }, g); t.textContent = titre; }
      return g;
    }
    function losange(lat, lon, taille, couleur, titre) {
      var q = proj(lon, lat), g = el('g', { class: 'v3c-pt' }, gPts), s = taille;
      el('path', { d: 'M' + q[0] + ',' + (q[1] - s) + 'L' + (q[0] + s) + ',' + q[1] + 'L' + q[0] + ',' + (q[1] + s) + 'L' + (q[0] - s) + ',' + q[1] + 'Z', fill: couleur, stroke: '#08080a', 'stroke-width': 1.2 }, g);
      if (titre) { var t = el('text', { class: 'v3c-lib', x: q[0] + s + 3, y: q[1] + 3 }, g); t.textContent = titre; }
    }
    function teinte(n, max) {
      if (!n) return '';
      var k = Math.min(1, Math.log(1 + n) / Math.log(1 + Math.max(max, 1)));
      // Rampe séquentielle d'une seule teinte (or) : anthracite → or, lisible sur fond noir.
      var a = [0x1c, 0x1a, 0x14], b = [0xe3, 0xb2, 0x3a];
      var m = 0.18 + 0.82 * k;
      return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * m); }).join(',') + ')';
    }

    function peindre() {
      if (!svg && !construire()) return;
      barre();
      gPts.innerHTML = ''; infos = {};
      Object.keys(cheminsPays).forEach(function (id) { cheminsPays[id].style.fill = ''; cheminsPays[id].classList.toggle('v3c-sel-p', id === etat.choix); });
      dernieres = depeches(etat.heures);
      var parPays = {}, parPass = {}, familles = {};
      dernieres.forEach(function (d) {
        d.pays.forEach(function (iso) { (parPays[iso] = parPays[iso] || []).push(d); });
        d.passages.forEach(function (id) { (parPass[id] = parPass[id] || []).push(d); });
      });
      var leg = '';
      if (etat.couche === 'actu') {
        var max = 0; Object.keys(parPays).forEach(function (k) { max = Math.max(max, parPays[k].length); });
        Object.keys(parPays).forEach(function (iso) {
          var n = parPays[iso].length, p = cheminsPays[iso];
          if (p) p.style.fill = teinte(n, max);
          infos[iso] = n + ' dépêche' + (n > 1 ? 's' : '') + ' sur ' + etat.heures + ' h';
          var d0 = parPays[iso][0], P = PAYS[iso];
          if (P) point(P.p[0], P.p[1], 2.6 + Math.min(4, Math.log2(1 + n)), d0.fam.c, Date.now() - d0.ts < 3600e3, n >= Math.max(3, max * 0.35) ? P.n : '');
        });
        dernieres.forEach(function (d) { familles[d.fam.k] = familles[d.fam.k] || { f: d.fam, n: 0 }; familles[d.fam.k].n++; });
        leg = FAMILLES.concat([FAM_AUTRE]).filter(function (f) { return familles[f.k]; }).map(function (f) { return '<span><i style="background:' + f.c + '"></i>' + esc(f.n) + '<b>' + familles[f.k].n + '</b></span>'; }).join('')
          || '<span>Aucune dépêche rattachée à un pays sur ' + etat.heures + ' h</span>';
        leg += '<span style="color:#6f6f78">· teinte = nombre de dépêches · point battant = moins d’une heure</span>';
      } else if (etat.couche === 'bc') {
        BC.forEach(function (b) {
          var t = tauxDe(b.dev), st = t && (t.stance || t.move) || '';
          var c = /hike|hausse|up/i.test(st) ? '#00e676' : /cut|baisse|down/i.test(st) ? '#ff3d00' : '#e3b23a';
          losange(b.p[0], b.p[1], 5.5, c, b.nom + (t && t.rate != null ? ' ' + String(t.rate).replace('.', ',') + '%' : ''));
          if (cheminsPays[b.pays]) cheminsPays[b.pays].style.fill = '#1f1d17';
          infos[b.pays] = b.nom + (t && t.rate != null ? ' · taux ' + String(t.rate).replace('.', ',') + '%' : '') + (t && t.next ? ' · prochaine réunion ' + t.next : '');
        });
        if (ZONE_EURO.pays.forEach) ZONE_EURO.pays.forEach(function (iso) { if (cheminsPays[iso]) cheminsPays[iso].style.fill = '#1f1d17'; });
        leg = '<span><i style="background:#00e676"></i>Prochain mouvement : hausse</span><span><i style="background:#e3b23a"></i>Maintien</span><span><i style="background:#ff3d00"></i>Baisse</span>';
        if (!marche.taux) leg += '<span style="color:#6f6f78">· taux en cours de lecture</span>';
      } else if (etat.couche === 'passages') {
        PASSAGES.forEach(function (p) {
          var n = (parPass[p.id] || []).length;
          point(p.p[0], p.p[1], n ? 5 : 3.6, n ? '#ff3d00' : '#3a3d45', !!n, p.n + (n ? ' · ' + n : ''));
        });
        leg = '<span><i style="background:#ff3d00"></i>Nommé par l’actualité (' + etat.heures + ' h)</span><span><i style="background:#3a3d45"></i>Calme</span>';
      } else {
        var R = RESSOURCES[etat.ress];
        R.pays.forEach(function (iso, i) {
          if (cheminsPays[iso]) cheminsPays[iso].style.fill = R.c;
          if (cheminsPays[iso]) cheminsPays[iso].style.fillOpacity = '';
          infos[iso] = 'Grand producteur : ' + R.n.toLowerCase();
          var P = PAYS[iso]; if (P && i < 6) point(P.p[0], P.p[1], 3, R.c, false, P.n);
        });
        leg = '<span><i style="background:' + R.c + '"></i>' + esc(R.n) + ' : grands producteurs</span><span style="color:#6f6f78">· liste qualitative, sans classement chiffré</span>';
      }
      legende.innerHTML = leg;
      if (etat.choix) remplirFiche(etat.choix);
    }

    function chaine(d) {
      var P = PAYS[d.pays[0]] || {}, pass = d.passages.length ? PASSAGES.filter(function (p) { return p.id === d.passages[0]; })[0] : null;
      var flux = pass ? pass.flux : d.fam.k === 'energie' ? 'Énergie (offre de pétrole ou de gaz)' : d.fam.k === 'metaux' ? 'Métaux' : d.fam.k === 'bc' ? 'Politique monétaire' : d.fam.k === 'donnees' ? 'Croissance et inflation' : d.fam.k === 'crypto' ? 'Liquidité crypto' : d.fam.k === 'geo' ? 'Risque géopolitique (aversion au risque)' : 'Sentiment de marché';
      var actifs = (pass ? pass.actifs : P.a || []).slice(0, 3).join(', ') || 'à préciser';
      var dev = P.dev || '';
      if (d.fam.k === 'geo' && dev.indexOf('JPY') < 0) dev = (dev ? dev + ', ' : '') + 'JPY et CHF (refuges)';
      return '<div class="v3c-chaine"><span>' + esc(d.fam.n) + '</span><em>→</em><span>' + esc(pass ? pass.n : P.n || '?') + '</span><em>→</em><span>' + esc(flux) + '</span><em>→</em><span>' + esc(actifs) + '</span>' + (dev ? '<em>→</em><span>' + esc(dev) + '</span>' : '') + '</div>';
    }
    function remplirFiche(iso) {
      var P = PAYS[iso], nom = P ? P.n : ((geoChemins || []).filter(function (c) { return c.id === iso; })[0] || {}).nom || iso;
      var deps = dernieres.filter(function (d) { return d.pays.indexOf(iso) >= 0; }).slice(0, 12);
      var h = '<div class="v3c-fh">' + drap(iso) + '<h4>' + esc(nom) + '</h4><button type="button" class="v3c-x" aria-label="Fermer">×</button></div>';
      h += '<div class="v3c-sec"><h5>Repères</h5>' + (P ? '<div class="v3c-kv">Devise<b>' + esc(P.dev) + '</b></div>' : '<div class="v3c-vide">Pays hors de la liste suivie par le desk.</div>');
      var bc = BC.filter(function (b) { return b.pays === iso || (b.dev === 'EUR' && P && P.dev === 'EUR'); })[0], t = bc && tauxDe(bc.dev);
      if (bc) h += '<div class="v3c-kv">Banque centrale<b>' + esc(bc.nom) + '</b></div>' + (t && t.rate != null ? '<div class="v3c-kv">Taux directeur<b>' + String(t.rate).replace('.', ',') + '%</b></div>' : '') + (t && t.next ? '<div class="v3c-kv">Prochaine réunion<b>' + esc(t.next) + '</b></div>' : '');
      var ress = Object.keys(RESSOURCES).filter(function (k) { return RESSOURCES[k].pays.indexOf(iso) >= 0; }).map(function (k) { return RESSOURCES[k].n; });
      if (ress.length) h += '<div class="v3c-kv">Grand producteur<b style="text-align:right">' + esc(ress.join(', ')) + '</b></div>';
      h += '</div>';
      if (P && P.a && P.a.length) {
        h += '<div class="v3c-sec"><h5>Actifs exposés</h5>' + P.a.map(function (a) {
          var v = variation(a);
          return '<div class="v3c-kv">' + esc(a) + (v == null ? '<b style="color:#6f6f78">·</b>' : '<b class="' + (v >= 0 ? 'v3c-up' : 'v3c-dn') + '">' + (v >= 0 ? '+' : '') + v.toFixed(2).replace('.', ',') + '%</b>') + '</div>';
        }).join('') + '</div>';
      }
      if (deps.length) h += '<div class="v3c-sec"><h5>Chaîne d’impact de la dernière dépêche</h5>' + chaine(deps[0]) + '</div>';
      h += '<div class="v3c-sec"><h5>Dépêches · ' + etat.heures + ' h</h5>' + (deps.length ? deps.map(function (d) {
        return '<div class="v3c-dep"><time>' + hm(d.ts) + '</time><i style="background:' + d.fam.c + '" title="' + esc(d.fam.n) + '"></i><span>' + esc(d.it._titreFr || d.it.headline) + '</span></div>';
      }).join('') : '<div class="v3c-vide">Aucune dépêche ne nomme ce pays sur la période.</div>') + '</div>';
      fiche.innerHTML = h;
      fiche.querySelector('.v3c-x').addEventListener('click', function () { etat.choix = null; racine.classList.remove('v3c-ouverte'); peindre(); });
    }
    function ouvrir(iso) {
      etat.choix = iso; racine.classList.add('v3c-ouverte');
      Object.keys(cheminsPays).forEach(function (id) { cheminsPays[id].classList.toggle('v3c-sel-p', id === iso); });
      remplirFiche(iso);
      lireMarche().then(function () { if (etat.vivant && etat.choix === iso) remplirFiche(iso); });
    }

    // Le fond de carte peut arriver après ce script (CDN) : on l'attend 10 s, puis on le dit.
    var essais = 0;
    (function attendre() {
      if (!etat.vivant) return;
      if (chemins()) { construire(); peindre(); lireMarche().then(function () { if (etat.vivant) peindre(); }); return; }
      if (++essais > 50) { vue.innerHTML = '<div class="v3c-attente">Fond de carte indisponible pour le moment.</div>'; return; }
      setTimeout(attendre, 200);
    })();
    var minuteur = setInterval(function () { if (etat.vivant && svg && document.visibilityState === 'visible') peindre(); }, 30000);
    return function () { etat.vivant = false; clearInterval(minuteur); };
  }

  window._v3CarteMonter = monter;       // pour les bancs et l'app mobile

  /* ── Déclaration du widget (catalogue de Mon Desk, admin + aperçu V3 seulement) ─────────────── */
  function declarer() {
    if (!window.DTPWidgets || typeof DTPWidgets.enregistrer !== 'function') return false;
    DTPWidgets.enregistrer({
      id: 'v3-carte', name: 'Carte du monde', court: 'Carte', tag: 'MONDE', cat: 'Macro', h: 440,
      desc: 'Où l’actualité frappe, ce qui transite par là, et ce que ça fait bouger : pays, banques centrales, détroits, matières.',
      aide: '<p>La carte rattache chaque dépêche du fil au pays qu’elle nomme : plus la teinte est dorée, plus le pays fait l’actualité ; un point qui bat signale une dépêche de moins d’une heure. Un clic sur un pays ouvre sa fiche : devise, banque centrale, actifs exposés avec leur variation du jour, dépêches, et la chaîne d’impact de la plus récente.</p><p>Les couches <strong>Banques centrales</strong>, <strong>Points de passage</strong> et <strong>Ressources</strong> montrent ce qui relie une zone aux marchés : un détroit nommé par l’actualité passe au rouge, et une matière (pétrole, gaz, or, argent, cuivre, blé, minerai de fer, lithium, crypto) éclaire ses grands producteurs.</p>',
      src: 'Fil d’actualité du desk (rattachement par mots-clés relus), /api/rates pour les banques centrales, /api/market-snapshot pour les variations du jour. Producteurs et points de passage : liste qualitative relue, sans classement chiffré.',
      watch: 'Un pays qui s’allume hors de ses habitudes, et un détroit qui passe au rouge : c’est souvent là que l’énergie, les refuges (or, JPY, CHF) et les devises des producteurs se mettent à bouger.',
      opts: [],
      mount: function (host, it) {
        var cfg = (it && it.cfg) || {};
        return monter(host, { couche: cfg.v3cCouche, heures: cfg.v3cHeures, ress: cfg.v3cRess });
      },
    });
    return true;
  }
  if (!declarer()) { var n = 0; (function r() { if (declarer() || ++n > 100) return; setTimeout(r, 100); })(); }
})();

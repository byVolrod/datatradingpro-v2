/**
 * seance.js — RÉCAP DE SÉANCE FABRIQUÉ PAR LE DESK.
 *
 * POURQUOI (26/08, décision utilisateur). Les récaps de séance étaient montés à partir des TITRES du
 * fil, rangés par catégorie : une liste, pas un récit. L'alternative envisagée était de reprendre les
 * wraps d'un fournisseur tiers ; l'utilisateur a tranché autrement, et il a raison — le desk possède
 * de la matière que ce fournisseur n'a pas : le calendrier avec réel/attendu, le Radar de Biais, le
 * pricing des banques centrales, la force des devises, les notes institutionnelles, et la
 * performance mesurée des actifs sur la fenêtre de la séance.
 *
 * Un récap DTP peut donc écrire une CHAÎNE DE FAITS MESURÉS là où un rédacteur écrit de la prose :
 *   « CPI allemand 2,3 % contre 2,1 % attendu (+0,2 pt) · EUR/USD +0,4 % sur la séance ·
 *     le biais EUR passe à Légèrement haussier · Goldman s'y attendait hier ».
 *
 * Ce module ne contient QUE du calcul et de la mise en forme — aucun accès réseau, aucun état. Il est
 * donc éprouvé en entier par scripts/seance-verif.js, y compris sur les cas tordus (pas de consensus,
 * valeurs en K/M/B, pourcentages, chômage où « plus haut » est une mauvaise nouvelle).
 */
'use strict';

/* FENÊTRES DE SÉANCE, en heures de PARIS. Ce sont les heures de la séance elle-même — à ne pas
   confondre avec _SEANCE_SUIVANTE (server.js), qui décrit la séance À VENIR pour « À surveiller ». */
const FENETRES = {
  'Asia Session Recap':   { nom: 'Asie',      debut: 0,  fin: 9,  dev: ['JPY', 'AUD', 'NZD', 'CNY'] },
  'London Session Recap': { nom: 'Londres',   debut: 8,  fin: 18, dev: ['EUR', 'GBP', 'CHF'] },
  'US Session Recap':     { nom: 'New York',  debut: 14, fin: 23, dev: ['USD', 'CAD'] },
};

/* ACTIFS SUIVIS PAR SÉANCE. On ne montre pas les mêmes marchés selon l'heure : un récap d'Asie qui
   parlerait du S&P 500 raconterait une séance qui n'a pas encore eu lieu. Les symboles sont ceux que
   le desk interroge déjà ailleurs (SNAP_GROUPS / MOVE_ASSETS), plus les indices régionaux. */
const ACTIFS = {
  'Asia Session Recap': [
    { sym: 'USDJPY=X', label: 'USD/JPY' }, { sym: 'AUDUSD=X', label: 'AUD/USD' },
    { sym: '^N225', label: 'Nikkei 225' }, { sym: '^HSI', label: 'Hang Seng' },
    { sym: 'DX-Y.NYB', label: 'DXY' }, { sym: 'GC=F', label: 'Or' },
  ],
  'London Session Recap': [
    { sym: 'EURUSD=X', label: 'EUR/USD' }, { sym: 'GBPUSD=X', label: 'GBP/USD' },
    { sym: '^GDAXI', label: 'DAX' }, { sym: '^FTSE', label: 'FTSE 100' },
    { sym: 'DX-Y.NYB', label: 'DXY' }, { sym: 'BZ=F', label: 'Brent' },
  ],
  'US Session Recap': [
    { sym: '^GSPC', label: 'S&P 500' }, { sym: '^IXIC', label: 'Nasdaq' },
    { sym: 'EURUSD=X', label: 'EUR/USD' }, { sym: 'DX-Y.NYB', label: 'DXY' },
    { sym: '^TNX', label: '10 ans US', bp: true }, { sym: 'GC=F', label: 'Or' },
  ],
};

/* FAMILLES — LES MÊMES QUE LE RÉCAP QUOTIDIEN (26/08, retour utilisateur : « dans macro je vois pas
   les news sorties dans leur catégorie comme quotidien »). Le Quotidien range ses chiffres par
   famille — Inflation, Croissance économique, Emploi, Politique monétaire, Commerce — et le récap de
   séance sortait une liste plate. Deux rapports qui se lisent à la suite le même jour doivent ranger
   pareil, sinon le lecteur se réoriente à chaque fois.
   ⚠️ LES NOMS ET L'ORDRE SONT CEUX DE `_ORDRE_FAM` (public/js/app.js, mailer.js) et doivent le
   rester. La table est dupliquée et c'est STRUCTUREL, pas un oubli : le Quotidien classe des puces
   françaises rédigées par l'IA, côté navigateur et côté mail ; ici on classe des intitulés de
   calendrier, en anglais, côté serveur. Le projet n'a pas d'étape de build, un module Node ne peut
   donc pas être partagé avec app.js. Ce qui compte pour le lecteur — les noms et l'ordre — est
   identique ; si on renomme une famille, il faut la renommer aux TROIS endroits. */
const ORDRE_FAM = ['Inflation', 'Croissance économique', 'Emploi', 'Politique monétaire', 'Commerce', 'Autres'];
const FAM_RX = [
  /* UN BANQUIER CENTRAL QUI PARLE RELÈVE DE LA POLITIQUE MONÉTAIRE, MÊME S'IL PARLE D'INFLATION
     (26/08, capture du Récap Quotidien à l'appui : « Fed (Collins) : la désinflation est l'issue la
     plus probable » y figure sous POLITIQUE MONÉTAIRE). Dans le Quotidien c'est le champ `cb` qui
     l'y place ; un récap de séance n'a pas ce champ, seulement du texte — d'où cette règle, testée
     EN PREMIER. Elle est ANCRÉE en début de ligne ET exige un marqueur de prise de parole
     (« (Nom) : » ou « : »), sinon « BOJ Core CPI y/y », qui est un chiffre d'INFLATION, basculerait
     ici. Une inflation qui CITE une banque en conséquence (« … → pression sur la BCE ») reste de
     l'inflation : la banque n'y est pas le sujet. */
  ['Politique monétaire', /^\s*\*{0,2}(?:fed|fomc|bce|ecb|boj|boe|boc|rba|rbnz|snb|bns|pboc|riksbank|norges bank|banque centrale|central bank|us treasury|tr[ée]sor(?: am[ée]ricain)?)\*{0,2}\s*(?:\([^)]{0,60}\))?\s*:/i],
  ['Inflation', /prix a la consommation|prix à la consommation|indice des prix|d[ée]sinflation|ench[ée]rit|\bcpi\b|\bppi\b|\bpce\b|\bhicp\b|\bipch\b|\brpi\b|inflation|consumer price|producer price|price index|import prices|export prices|wholesale price|trimmed mean|deflator/i],
  ['Emploi', /cr[ée]ations? d.emplois?|demandes d.allocation|inscriptions au ch[oô]mage|march[ée] du travail|\bnfp\b|non[-\s]?farm|payroll|unemployment|jobless|initial claims|continuing claims|\badp\b|\bjolts\b|job openings|employment|hourly earnings|wage|labou?r force|participation rate|job cuts|ch[oô]mage|emploi|salaire|claimant count|claimant|effectifs|licenciements/i],
  ['Croissance économique', /indice d.activit[ée]|activity index|\bcfnai\b|activit[ée] [ée]conomique|indice manufacturier|indice des directeurs d.achat|ventes au d[ée]tail|production industrielle|commandes (?:de biens|industrielles|d.usine)|confiance des (?:consommateurs|m[ée]nages|entreprises)|activit[ée] manufacturi[èe]re|activit[ée] des services|mises en chantier|permis de construire|croissance [ée]conomique|\bgdp\b|gross domestic|\bpib\b|growth rate|retail sales|retail trade|\bism\b|\bpmi\b|industrial production|manufacturing production|factory orders|industrial orders|(?:machine tool|machinery|core machinery) orders|durable goods|capacity utilization|business confidence|consumer confidence|consumer sentiment|consumer climate|\btankan\b|\bifo\b|\bzew\b|\bsentix\b|\bgfk\b|investor confidence|economic sentiment|business climate|business survey|climat des affaires|leading index|leading indicator|indicateur avanc[ée]|housing starts|building permits|home sales|house price|\bhpi\b|prix des logements|construction (?:output|spending|\bpmi\b)|(?:business|retail|wholesale) inventories|stocks des (?:entreprises|grossistes)|personal (?:spending|income)|consumer spending|d[ée]penses des m[ée]nages|revenus? des m[ée]nages|consumer credit|cr[ée]dit [àa] la consommation|tertiary industry|vehicle sales|car registrations|immatriculations|(?:philly|philadelphia|dallas|richmond|kansas city|\bkc\b|empire state|new york|\bny\b) fed (?:manufacturing|services|business|composite|index)|empire state manufacturing|richmond (?:manufacturing|services)/i],
  ['Politique monétaire', /d[ée]cision de taux|taux directeur|politique mon[ée]taire|r[ée]union de politique|rate decision|interest rate decision|\bfomc\b|rate statement|monetary policy|cash rate|\bocr\b|bank rate|official rate|refi rate|deposit rate|policy rate|federal funds|official bank rate|refinancing rate|overnight rate|loan prime rate|press conference|conf[ée]rence de presse|economic projections|meeting minutes|minutes de la|comptes rendus?|\bfed\b|\bfomc\b|\bbce\b|\becb\b|\bboj\b|\bboe\b|\bboc\b|\brba\b|\brbnz\b|\bsnb\b|\bbns\b|\bpboc\b|banque centrale|central bank|taux inchang|maintien du taux|hausse de(?:s)? taux|baisse de(?:s)? taux|resserrement|assouplissement|hawkish|dovish|quantitative|money supply|masse mon[ée]taire|private loans|pr[êe]ts au secteur priv[ée]|bank lending|cr[ée]dit bancaire/i],
  ['Commerce', /guerre commerciale|trade war|tarifs?\b|droits? de douane|surtaxes?|r[ée]torsion|quotas?|embargo commercial|balance commerciale|exportations|importations|d[ée]ficit commercial|trade balance|balance of trade|current account|exports|imports|balance commerciale/i],
];
/* TABLE REPRISE VERBATIM du Récap Quotidien (`_FAM_JOUR`, public/js/app.js) : c'est la seule façon
   de garantir qu'un même chiffre tombe dans la même famille dans les deux rapports. Elle est
   BILINGUE parce que les deux entrées le sont — un intitulé de calendrier arrive en anglais
   (« Retail Sales MoM »), une puce de récap est rédigée en français (« les ventes au détail
   américaines progressent de 0,6 % »).
   L'ordre de la table est un ordre de TEST (la première règle qui répond gagne), pas l'ordre
   d'affichage : celui-ci suit ORDRE_FAM. */
function famille(titre) {
  const t = String(titre || '');
  const m = FAM_RX.find(([, rx]) => rx.test(t));
  return m ? m[0] : 'Autres';
}
/* L'ORDRE DES FAMILLES DANS LA RUBRIQUE MACRO — CELUI DU RÉCAP QUOTIDIEN, QUI EST CELUI DU RADAR
   DE BIAIS (`_SECTIONS_NEWS`, public/js/app.js). Ce n'est pas ORDRE_FAM : le Quotidien range ses
   CHIFFRES du jour dans l'ordre Inflation → Croissance → Emploi → Politique monétaire, mais sa
   rubrique MACRO suit les quatre rubriques du Radar, politique monétaire en tête — la décision
   d'abord, son écho macro ensuite. Le récap de séance a la même rubrique : il suit le même ordre.
   CE QUI N'ENTRE DANS AUCUNE DES QUATRE (Commerce, Autres) SE REND EN PREMIER ET SANS TITRE. C'est
   une leçon déjà payée dans le Quotidien : rendues APRÈS un groupe intitulé, ces lignes se lisent
   comme la suite de ce groupe — le user avait vu « l'or à 4 650 $ » annoncé sous « Banques
   centrales ». Placées en tête, elles se lisent comme le corps de la rubrique. */
const ORDRE_FAM_MACRO = ['Politique monétaire', 'Inflation', 'Croissance économique', 'Emploi'];
/* CHAQUE FAMILLE PRÉSENTE PORTE SON TITRE, MÊME SEULE (26/08, retour utilisateur captures à
   l'appui : « il manque la classification comme la 2è image »). La rubrique sortait en liste plate
   dès que toutes ses lignes tombaient dans la même famille — trois indicateurs de croissance, et
   plus un seul intitulé. Le Récap Quotidien, lui, titre toujours : « intituler un groupe unique
   n'apprend rien » était mon arbitrage, pas le sien, et il rendait la classification invisible
   précisément les jours où la séance était homogène. */
function parFamilleMacro(entrees) {
  const par = new Map();
  for (const e of (entrees || [])) {
    if (!e || !e.ligne) continue;
    const f = famille(e.titre);
    if (!par.has(f)) par.set(f, []);
    par.get(f).push(e.ligne);
  }
  const sansTitre = [];
  for (const [f, l] of par) if (ORDRE_FAM_MACRO.indexOf(f) < 0) sansTitre.push(...l);
  return { sansTitre, groupes: ORDRE_FAM_MACRO.filter(f => (par.get(f) || []).length).map(f => ({ famille: f, lignes: par.get(f) })) };
}

// Range des lignes déjà rédigées par famille, dans l'ordre d'affichage. Une famille vide ne sort pas.
function parFamille(entrees) {
  const par = new Map();
  for (const e of (entrees || [])) {
    if (!e || !e.ligne) continue;
    const f = famille(e.titre);
    if (!par.has(f)) par.set(f, []);
    par.get(f).push(e.ligne);
  }
  return ORDRE_FAM.filter(f => (par.get(f) || []).length).map(f => ({ famille: f, lignes: par.get(f) }));
}

// ── Nombres du calendrier ───────────────────────────────────────────────────────────────────────
/* Le calendrier rend des chaînes formatées : « 2.3% », « 104K », « -8.0M », « 3.2B », « 53.9 ».
   Pour mesurer un écart il faut les ramener à un nombre COMPARABLE — et ne comparer que ce qui est
   comparable : un « 104K » face à un « 75K » se soustrait, un « 2.3% » face à « 75K » n'a aucun sens
   et ne produit donc aucun écart. */
const _MULT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
function nombre(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const m = /^(-?)\s*([\d.,]+)\s*([KMBT])?\s*(%)?$/i.exec(s.replace(/\s/g, ''));
  if (!m) return null;
  const n = parseFloat(m[2].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = m[3] ? _MULT[m[3].toUpperCase()] : 1;
  return { valeur: (m[1] === '-' ? -1 : 1) * n * mult, pct: !!m[4], echelle: m[3] ? m[3].toUpperCase() : '' };
}
/* INDICATEURS INVERSÉS : pour le chômage, les inscriptions au chômage ou les stocks de pétrole,
   « au-dessus des attentes » est une MAUVAISE nouvelle. Sans cette liste, un chômage en hausse
   serait annoncé comme une surprise favorable — l'erreur classique d'un récap automatique. */
const INVERSES = /unemployment|jobless|claimant|claims|inventories|stocks? change|deficit/i;

/* ÉCART AU CONSENSUS. Rend de quoi écrire une phrase, jamais une interprétation de marché : on dit
   ce que le chiffre est et de combien il s'écarte, pas ce que le marché « devrait » en faire. */
function ecart(ev) {
  const a = nombre(ev && ev.actual), f = nombre(ev && ev.forecast);
  if (!a) return null;
  if (!f || a.pct !== f.pct || a.echelle !== f.echelle) return { actual: String(ev.actual).trim(), sansConsensus: true };
  const d = a.valeur - f.valeur;
  const inverse = INVERSES.test(String((ev && ev.title) || ''));
  const seuil = Math.max(Math.abs(f.valeur) * 0.005, 1e-9);       // en deçà, on parle de « conforme »
  const sens = Math.abs(d) <= seuil ? 'conforme' : ((d > 0) !== inverse ? 'au-dessus' : 'en dessous');
  return {
    actual: String(ev.actual).trim(), forecast: String(ev.forecast).trim(),
    previous: ev && ev.previous ? String(ev.previous).trim() : '',
    delta: d, sens, inverse, sansConsensus: false,
  };
}
// Écart affichable : on garde l'unité du chiffre, jamais un nombre nu sorti de nulle part.
function ecartTexte(e) {
  if (!e || e.sansConsensus || e.sens === 'conforme') return '';
  const a = nombre(e.actual), f = nombre(e.forecast);
  if (!a || !f) return '';
  const d = a.valeur - f.valeur;
  const abs = Math.abs(d);
  const signe = d > 0 ? '+' : '−';
  if (a.echelle) return `${signe}${_court(abs / (_MULT[a.echelle] || 1))}${a.echelle}`;
  if (a.pct) return `${signe}${_court(abs)} pt`;
  return `${signe}${_court(abs)}`;
}
function _court(n) {
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.abs(n) >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
  return String(r).replace('.', ',');
}
/* UN RENDEMENT NE SE MESURE PAS EN POURCENTAGE. Dire « le 10 ans US +2,1 % » quand il passe de
   4,10 à 4,19 est faux dans le vocabulaire du marché : on dit « +9 points de base ». Les actifs
   marqués `bp` sont donc rendus en points de base, à partir de la variation ABSOLUE. */
function bps(delta) {
  if (delta == null || !Number.isFinite(delta)) return '';
  const b = Math.round(delta * 100);
  if (b === 0) return 'inchangé';
  return (b > 0 ? '+' : '−') + Math.abs(b) + ' pb';
}
// Pourcentage de séance, à une décimale, signe explicite. Le zéro n'est ni positif ni négatif.
function pct(p) {
  if (p == null || !Number.isFinite(p)) return '';
  const r = Math.round(p * 100) / 100;
  if (Math.abs(r) < 0.005) return 'stable';
  return (r > 0 ? '+' : '−') + String(Math.abs(r).toFixed(2)).replace('.', ',') + ' %';
}

/* CORRESPONDANCE SÉANCE ↔ RAPPORT. Les wraps portent la région (« Asia-Pacific », « European »,
   « Americas »), nos fenêtres portent le nom du rapport. Une seule table, pour ne pas avoir à
   deviner de part et d'autre. */
const TYPE_PAR_SESSION = { 'Asia-Pacific': 'Asia Session Recap', 'European': 'London Session Recap', 'Americas': 'US Session Recap' };

/* DÉJÀ DIT ? — LE VERROU CONTRE LE DOUBLON.
   On verse dans Macro les publications du calendrier de la séance, mais le texte du wrap en cite
   déjà une partie : « Ifo Business Climate Allemagne août : 88,8 (vs 87,2 att.) ». Ajouter notre
   ligne par-dessus donnerait le même chiffre deux fois, ce qui est pire que de l'omettre — un
   rapport qui se répète perd la confiance qu'il vient de gagner en étant précis.
   Deux signaux, du plus fort au plus faible :
     · LA VALEUR PUBLIÉE. Si « 88,8 » (ou « 88.8 ») figure déjà dans une puce, c'est la même
       publication. C'est le signal décisif : deux indicateurs différents partagent rarement leur
       chiffre au dixième près dans la même séance.
     · LES MOTS DISTINCTIFS du nom. « Ifo », « ZEW », « Tankan », « JOLTS » suffisent seuls ; les
       mots communs (« index », « rate », « change », « prelim ») ne comptent pas. À défaut d'un
       mot distinctif, il en faut DEUX en commun — sinon « Retail Sales » et « Home Sales » se
       confondraient sur le seul mot « sales ».
   En cas de doute on considère que c'est déjà dit : mieux vaut une publication manquante qu'une
   publication en double. */
const _MOTS_COMMUNS = new Set(['index','rate','rates','change','prelim','final','flash','adv','est','estimate','core','monthly','annual','yoy','mom','qoq','y','m','q','the','and','of','de','du','des','la','le','les','sa','indicator','data','report']);
const _DISTINCTIFS = /\b(ifo|zew|tankan|jolts|nahb|gfk|sentix|redbook|nfp|adp|ism|pce|hicp|cpi|ppi|pib|gdp|pmi|dxy|jgb|opec)\b/i;
/* LE CALENDRIER EST EN ANGLAIS, LES PUCES SONT EN FRANÇAIS. « French Consumer Confidence » et
   « Confiance des consommateurs France » désignent la même publication sans partager un seul mot :
   une comparaison monolingue les prenait pour deux choses différentes et servait le chiffre en
   double. On ramène donc les deux langues à un vocabulaire commun avant de comparer. La table ne
   couvre que les indicateurs et les pays qui reviennent — un terme absent ne casse rien, il rend
   seulement la détection plus prudente, ce qui est le bon côté pour se tromper. */
const _FR_EN = [
  [/confiance des (?:consommateurs|m[ée]nages)/g, 'consumer confidence'],
  [/confiance des (?:entreprises|chefs d.entreprise|patrons)/g, 'business confidence'],
  [/moral des (?:m[ée]nages|consommateurs)/g, 'consumer confidence'],
  [/ventes au d[ée]tail/g, 'retail sales'],
  [/prix [àa] la consommation|indice des prix/g, 'cpi'],
  [/prix (?:[àa] la )?production/g, 'ppi'],
  [/production industrielle/g, 'industrial production'],
  [/balance commerciale/g, 'trade balance'],
  [/taux de ch[oô]mage|ch[oô]mage/g, 'unemployment'],
  [/inscriptions? au ch[oô]mage|demandes d.allocation/g, 'jobless claims'],
  [/cr[ée]ations? d.emplois?/g, 'employment change'],
  [/march[ée] du travail/g, 'labour'],
  [/mises en chantier/g, 'housing starts'],
  [/permis de construire/g, 'building permits'],
  [/commandes de biens durables/g, 'durable goods'],
  [/d[ée]penses des m[ée]nages/g, 'personal spending'],
  [/taux directeur|d[ée]cision de taux/g, 'policy rate'],
  [/salaires?|r[ée]mun[ée]rations?/g, 'earnings'],
  [/\bpib\b/g, 'gdp'],
  [/\ballemagne\b|\ballemand\w*/g, 'german'],
  [/\bfrance\b|\bfran[cç]ais\w*/g, 'french'],
  [/\bespagne\b|\bespagnol\w*/g, 'spanish'],
  [/\bitalie\b|\bitalien\w*/g, 'italian'],
  [/\broyaume[- ]uni\b|\bbritannique\w*/g, 'british'],
  [/\b[ée]tats[- ]unis\b|\bam[ée]ricain\w*/g, 'us'],
  [/\bjapon\b|\bjaponais\w*/g, 'japan'],
  [/\bzone euro\b/g, 'euro'],
];
function _normalise(t) {
  let s = String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [rx, en] of _FR_EN) s = s.replace(rx, ' ' + en + ' ');
  return s;
}
function _motsUtiles(t) {
  return _normalise(t).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !_MOTS_COMMUNS.has(w));
}
/* LE PAYS TRANCHE, ET IL TRANCHE AVANT TOUT LE RESTE. « US Consumer Confidence » et « Confiance
   des consommateurs en France » partagent DEUX mots utiles (« consumer », « confidence ») : la
   comparaison lexicale seule les confondait et faisait disparaître la publication américaine du
   Macro — exactement le trou que cette section vient boucher. Deux publications qui portent des
   pays DIFFÉRENTS ne sont jamais la même, quels que soient les mots partagés. Le pays se lit
   d'abord dans l'intitulé (« German », « French »…), à défaut dans la devise du calendrier —
   ForexFactory nomme « CB Consumer Confidence » sans dire « US », la devise le dit pour lui.
   Une puce SANS pays reste comparable à tout : la plupart des puces n'en nomment pas. */
const _PAYS_RX = /\b(german(?:y)?|french|france|spanish|spain|italian|italy|british|britain|uk|usa|us|american|japan(?:ese)?|chin(?:a|ese)|canad(?:a|ian)|austral(?:ia|ian)|swiss|switzerland|euro(?:zone)?)\b/g;
const _PAYS_CANON = {
  german: 'de', germany: 'de', french: 'fr', france: 'fr', spanish: 'es', spain: 'es',
  italian: 'it', italy: 'it', british: 'gb', britain: 'gb', uk: 'gb',
  us: 'us', usa: 'us', american: 'us', japan: 'jp', japanese: 'jp',
  china: 'cn', chinese: 'cn', canada: 'ca', canadian: 'ca', australia: 'au', australian: 'au',
  swiss: 'ch', switzerland: 'ch', euro: 'ez', eurozone: 'ez',
};
/* La devise ne vaut le pays que si elle n'en désigne qu'un. L'EUR en désigne CINQ : un « Ifo
   Business Climate » sans « German » dans son intitulé reste une publication allemande, et une puce
   qui parle de l'Allemagne doit pouvoir la couvrir. On rend donc pour l'EUR l'ensemble de la zone —
   la prudence va ici dans le bon sens : l'ambiguïté vient de ce que le titre ne dit pas le pays. */
const _PAYS_DEV = { USD: ['us'], EUR: ['ez', 'de', 'fr', 'es', 'it'], GBP: ['gb'], JPY: ['jp'], CHF: ['ch'], CAD: ['ca'], AUD: ['au'], NZD: ['nz'], CNY: ['cn'] };
function _paysDe(t) {
  const out = new Set();
  for (const m of _normalise(t).match(_PAYS_RX) || []) { const c = _PAYS_CANON[m]; if (c) out.add(c); }
  return out;
}
function _nombresDe(t) {
  return (String(t || '').match(/-?\d+[.,]?\d*/g) || []).map(x => x.replace(',', '.'));
}
function dejaDit(ev, puces) {
  let lignes = (puces || []).map(p => String(p || ''));
  if (!lignes.length) return false;
  const nom = String((ev && ev.title) || '');
  // Le pays d'abord : on ne compare plus qu'aux puces qui PEUVENT parler du même pays.
  const paysEv = _paysDe(nom);
  if (!paysEv.size) for (const c of _PAYS_DEV[String((ev && ev.currency) || '').toUpperCase()] || []) paysEv.add(c);
  if (paysEv.size) {
    lignes = lignes.filter(l => {
      const p = _paysDe(l);
      if (!p.size) return true;
      for (const c of p) if (paysEv.has(c)) return true;
      return false;
    });
    if (!lignes.length) return false;
  }
  const val = String((ev && ev.actual) || '').trim();
  if (val) {
    const n = _nombresDe(val)[0];
    // Un chiffre trop court (« 2 », « 86 ») se retrouve par hasard : on n'y voit un signal qu'à
    // partir de trois caractères significatifs, ou s'il porte une décimale.
    if (n && (n.length >= 4 || n.indexOf('.') > 0)) {
      const cherche = [n, n.replace('.', ',')];
      if (lignes.some(l => cherche.some(c => l.includes(c)))) return true;
    }
  }
  const dist = (nom.match(_DISTINCTIFS) || [])[0];
  if (dist && lignes.some(l => new RegExp('\\b' + dist + '\\b', 'i').test(l))) return true;
  const mots = _motsUtiles(nom);
  if (mots.length < 2) return false;
  return lignes.some(l => { const ml = _motsUtiles(l); return mots.filter(w => ml.includes(w)).length >= 2; });
}

// ── Fenêtre d'une séance ────────────────────────────────────────────────────────────────────────
/* Le jour civil se lit À PARIS, jamais en UTC : une séance asiatique qui commence à 00h00 Paris est
   déjà la veille à Londres, et un décalage d'un jour vide la fenêtre en silence. */
function jourParis(ts) { return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }); }
function offsetParis(ts) {
  const d = new Date(ts);
  return new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Paris' })) - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
}
/* `now` DONNE LE JOUR de la séance, `finRef` PLAFONNE sa fin. Les deux se confondent pour la séance
   en cours (on ne raconte pas l'avenir), mais pas pour un récap DÉJÀ PUBLIÉ : sa fenêtre est celle
   de SON jour, close en entier, même relue le lendemain. */
function bornes(reportType, now, finRef) {
  const F = FENETRES[reportType];
  if (!F) return null;
  const [Y, M, D] = jourParis(now).split('-').map(Number);
  const off = offsetParis(now);
  return {
    debutTs: Date.UTC(Y, M - 1, D, F.debut, 0, 0) - off,
    finTs: Math.min(finRef == null ? now : finRef, Date.UTC(Y, M - 1, D, F.fin, 0, 0) - off),
    nom: F.nom, dev: F.dev,
  };
}
/* La fenêtre d'un récap de séance PUBLIÉ : celle de sa séance, le jour de sa publication. La fin
   reste plafonnée à maintenant — un récap du jour ne peut pas annoncer des chiffres pas encore
   tombés. Rend null si l'article n'est pas un récap de séance (« Global », ouverture, hebdo…). */
/* QUELLE SÉANCE RACONTE CE RÉCAP ? Le champ `session` est renseigné à l'ingestion en cherchant
   « americas » / « europe » / « asia-pacific » DANS LE TITRE de la dépêche — et retombe sur
   « Global » quand le titre ne les nomme pas. Un récap de séance étiqueté « Global » n'a alors
   aucune fenêtre horaire, donc aucune publication du calendrier : c'est précisément ce qui fait
   qu'un récap reçoit la complétion et le suivant non, sans rien qui les distingue à l'écran.
   On relit donc l'intitulé affiché et l'URL quand le champ ne dit rien — mêmes motifs et même ordre
   que `_arlWrapSessionPrefix` (server.js), qui nomme déjà « Récap Séance Asie-Pacifique » à partir
   des mêmes chaînes : les deux doivent voir la même séance, sinon le titre annonce une séance et le
   contenu en chiffre une autre. */
function sessionDe(item) {
  const direct = TYPE_PAR_SESSION[String((item && item.session) || '')];
  if (direct) return direct;
  const s = `${(item && item.session) || ''} ${(item && item.headline) || ''} ${(item && item.title) || ''} ${(item && item.url) || ''}`;
  if (/asia|pacific|asie/i.test(s)) return 'Asia Session Recap';
  if (/europe|london|londres/i.test(s)) return 'London Session Recap';
  if (/americ|new york|north america|\bus\b|wall/i.test(s)) return 'US Session Recap';
  return null;
}
function bornesPourWrap(item, now) {
  const type = sessionDe(item);
  const ts = (item && item.timestamp) || 0;
  if (!type || !ts) return null;
  return bornes(type, ts, now == null ? Date.now() : now);
}
/* LES PUBLICATIONS DE LA FENÊTRE : tombées dedans, sur les devises de la séance, et RÉSULTAT CONNU.
   Sans `actual` il n'y a rien à raconter — c'est un rendez-vous à venir, pas un fait de séance.
   Les fortes d'abord, puis l'ordre chronologique : on lit un récap par ordre d'importance. */
function filtreFenetre(items, b) {
  if (!b || b.finTs <= b.debutTs) return [];
  return (items || []).filter(e => {
    const ts = (e && e.timestamp) || 0;
    if (ts < b.debutTs || ts > b.finTs) return false;
    if (b.dev.indexOf(String((e && e.currency) || '').toUpperCase()) < 0) return false;
    return !!(e && e.actual && String(e.actual).trim());
  });
}
function trierMacro(evs) {
  const fort = e => /high/i.test((e && e.impact) || '') ? 1 : 0;
  return (evs || []).slice().sort((x, y) => (fort(y) - fort(x)) || ((x.timestamp || 0) - (y.timestamp || 0)));
}

// ── Lignes du rapport ───────────────────────────────────────────────────────────────────────────
/* PHOTO DE SÉANCE : une seule ligne, les actifs qui ont réellement bougé en tête. Un actif sans
   donnée est OMIS, jamais rendu avec un tiret : une ligne vide dans un récap chiffré fait douter de
   toutes les autres. */
/* UN RENDEMENT NE SE CLASSE PAS AVEC LES AUTRES. Trier tout le monde sur la variation en
   pourcentage mettait le dix ans US en tête avec « +2,10 % » (4,10 → 4,19) devant un Nasdaq à
   −0,94 % : neuf points de base ne sont pas un plus gros mouvement qu'un pour cent d'indice, les
   deux grandeurs ne se comparent tout simplement pas. Les taux sont donc rendus À PART, en fin de
   ligne, comme contexte — et ils ne concourent pas au « plus fort mouvement ». */
function _estTaux(p) { return !!(p && p.bp); }
function lignePerf(perfs, mini) {
  const seuil = mini == null ? 0.05 : mini;
  const util = (perfs || []).filter(p => p && Number.isFinite(p.pct));
  if (!util.length) return '';
  const marches = util.filter(p => !_estTaux(p)).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const taux = util.filter(_estTaux);
  const bouge = marches.filter(p => Math.abs(p.pct) >= seuil);
  const gardes = (bouge.length ? bouge : marches).slice(0, 5).concat(taux);
  return gardes.map(p => `${p.label} ${_estTaux(p) && Number.isFinite(p.delta) ? bps(p.delta) : pct(p.pct)}`).join(' · ');
}
/* LIGNE MACRO : l'heure, la devise, l'intitulé, le réel, l'attendu, l'écart. Rien d'autre —
   l'interprétation appartient à la rubrique d'analyse, pas au constat. */
function ligneMacro(ev, heure) {
  const e = ecart(ev);
  if (!e) return '';
  const nom = String((ev && ev.title) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const tete = `${heure ? heure + ' ' : ''}${ev.currency || ''} · ${nom}`.trim();
  if (e.sansConsensus) return `${tete} : ${e.actual}${e.previous ? ` (préc. ${e.previous})` : ''}`;
  if (e.sens === 'conforme') return `${tete} : ${e.actual}, conforme aux attentes${e.previous ? ` (préc. ${e.previous})` : ''}`;
  const et = ecartTexte(e);
  return `${tete} : ${e.actual} contre ${e.forecast} attendu${et ? ` (${et})` : ''}${e.previous ? `, préc. ${e.previous}` : ''}`;
}

/* LA MÊME LIGNE, AU STYLE DE LA NOTE DE DESK : devise et indicateur en gras Markdown, comme les
   puces que l'IA écrit juste à côté. Une ligne au style différent se repère au premier coup d'œil
   et donne l'impression d'un morceau rapporté d'ailleurs ; ici tout sort du même desk. */
function ligneMacroMd(ev, heure) {
  const l = ligneMacro(ev, heure);
  if (!l) return '';
  const dev = String((ev && ev.currency) || '');
  const nom = String((ev && ev.title) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  let s = l;
  if (dev) s = s.replace(dev + ' \u00b7 ', '**' + dev + '** \u00b7 ');
  if (nom) s = s.replace(nom + ' :', '**' + nom + '** :');
  return s;
}

/* SYNTHÈSE DE SÉANCE : une phrase de tête, déduite des chiffres. Elle ne qualifie que ce qui est
   mesuré — combien de publications, combien ont surpris, et le mouvement le plus marqué. */
function synthese(nomSeance, perfs, macros) {
  // Le « plus fort mouvement » se cherche parmi les marchés comparables entre eux : un taux, mesuré
  // en points de base, n'entre pas dans ce classement (voir lignePerf).
  const util = (perfs || []).filter(p => p && Number.isFinite(p.pct) && !_estTaux(p));
  const fort = util.slice().sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
  const surprises = (macros || []).map(m => ecart(m)).filter(e => e && !e.sansConsensus && e.sens !== 'conforme');
  const bouts = [];
  if (macros && macros.length) {
    bouts.push(`${macros.length} publication${macros.length > 1 ? 's' : ''} sur la séance${surprises.length ? `, dont ${surprises.length} hors consensus` : ', toutes conformes aux attentes'}`);
  }
  if (fort && Math.abs(fort.pct) >= 0.05) bouts.push(`plus fort mouvement : ${fort.label} ${pct(fort.pct)}`);
  if (!bouts.length) return `Séance ${nomSeance} sans publication majeure ni mouvement notable.`;
  return `Séance ${nomSeance} : ` + bouts.join(' · ') + '.';
}

module.exports = { FENETRES, ACTIFS, TYPE_PAR_SESSION, dejaDit, sessionDe, ORDRE_FAM_MACRO, parFamilleMacro, jourParis, offsetParis, bornes, bornesPourWrap, filtreFenetre, trierMacro, ORDRE_FAM, famille, parFamille, nombre, ecart, ecartTexte, pct, bps, lignePerf, ligneMacro, ligneMacroMd, synthese, INVERSES };

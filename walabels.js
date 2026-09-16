/**
 * walabels.js — TITRES, GLOSES ET DESCRIPTIONS DES CARTES « SEMAINE À VENIR »
 *
 * POURQUOI CE MODULE EXISTE (25/08, signalement mentor via l'utilisateur).
 * La carte du vendredi 28 août annonçait « NFP américain + CPI zone euro » alors que la journée ne
 * portait ni l'un ni l'autre : au calendrier il y avait Jackson Hole, une « Non Farm Payrolls Annual
 * Revision Prel » (une CORRECTION de chiffres déjà publiés, pas le rapport mensuel) et une confiance
 * des ménages japonaise. Deux causes racines, toutes deux dans le mapping de thèmes :
 *   1. la regex NFP ne distinguait pas le RAPPORT MENSUEL de sa RÉVISION ANNUELLE ;
 *   2. tout ce qui est classé EUR par le calendrier était étiqueté « zone euro », alors que l'IPC
 *      flash de fin de mois est PUBLIÉ PAR PAYS (France, Espagne, Allemagne) — le pays d'origine est
 *      pourtant transporté jusqu'ici (champ `ctry`), il n'était simplement pas lu.
 * Le module est SÉPARÉ et PUR pour être testable (test/walabels.test.js) : le scénario du 28 août y
 * est rejoué à l'identique, donc la régression ne peut pas revenir en silence.
 *
 * INVARIANT TENU ICI : un titre de jour ne peut nommer QUE des événements présents dans le tableau
 * qu'on lui passe — celui-là même qui est affiché sous la carte. `titreJour` et `descriptionJour`
 * lisent la MÊME liste, il n'existe aucun autre chemin.
 *
 * Les INTITULÉS d'événements ne sont jamais traduits (règle produit, comme dans l'onglet Calendrier) :
 * on leur ADJOINT une glose en français clair (« l'inflation que la Fed regarde en priorité »), c'est
 * elle qui rend la description compréhensible sans connaître le jargon.
 */
'use strict';

// ── Pays → adjectif [masculin sing., féminin sing., féminin plur., masculin plur.].
//    « zone euro » est invariable, d'où les quatre formes identiques.
const ADJ_PAYS = {
  US: ['américain', 'américaine', 'américaines', 'américains'],
  GB: ['britannique', 'britannique', 'britanniques', 'britanniques'],
  JP: ['japonais', 'japonaise', 'japonaises', 'japonais'],
  AU: ['australien', 'australienne', 'australiennes', 'australiens'],
  NZ: ['néo-zélandais', 'néo-zélandaise', 'néo-zélandaises', 'néo-zélandais'],
  CA: ['canadien', 'canadienne', 'canadiennes', 'canadiens'],
  CH: ['suisse', 'suisse', 'suisses', 'suisses'],
  CN: ['chinois', 'chinoise', 'chinoises', 'chinois'],
  EU: ['zone euro', 'zone euro', 'zone euro', 'zone euro'],
  DE: ['allemand', 'allemande', 'allemandes', 'allemands'],
  FR: ['français', 'française', 'françaises', 'français'],
  IT: ['italien', 'italienne', 'italiennes', 'italiens'],
  ES: ['espagnol', 'espagnole', 'espagnoles', 'espagnols'],
  NL: ['néerlandais', 'néerlandaise', 'néerlandaises', 'néerlandais'],
  PT: ['portugais', 'portugaise', 'portugaises', 'portugais'],
  GR: ['grec', 'grecque', 'grecques', 'grecs'],
  IE: ['irlandais', 'irlandaise', 'irlandaises', 'irlandais'],
  BE: ['belge', 'belge', 'belges', 'belges'],
  AT: ['autrichien', 'autrichienne', 'autrichiennes', 'autrichiens'],
  FI: ['finlandais', 'finlandaise', 'finlandaises', 'finlandais'],
};
/* ForexFactory préfixe déjà le pays dans ses intitulés européens (« German Prelim CPI m/m »,
   « Spanish Flash CPI y/y ») : y accoler « (Allemagne) » ferait doublon. On ne complète que si
   l'intitulé ne dit pas déjà de qui il parle. */
const PAYS_DEJA_DIT = {
  DE: /\bgerman/i, FR: /\bfrench/i, ES: /\bspanish/i, IT: /\bitalian/i, NL: /\bdutch|netherlands/i,
  PT: /\bportuguese/i, GR: /\bgreek/i, IE: /\birish/i, BE: /\bbelgian/i, AT: /\baustrian/i,
  FI: /\bfinnish/i, EU: /\beuro(?:pean|zone)?\b/i,
};
const CCY2PAYS = { USD: 'US', EUR: 'EU', GBP: 'GB', JPY: 'JP', AUD: 'AU', NZD: 'NZ', CAD: 'CA', CHF: 'CH', CNY: 'CN', CNH: 'CN' };
/* Nom COURT du pays, pour les bandeaux où l'adjectif est trop long (« inflation France » plutôt que
   « CPI français »). Même principe que ADJ_PAYS : le pays d'origine prime sur la devise. */
const PAYS_COURT = {
  US: 'US', GB: 'UK', JP: 'Japon', AU: 'Australie', NZ: 'NZ', CA: 'Canada', CH: 'Suisse', CN: 'Chine',
  EU: 'zone euro', DE: 'Allemagne', FR: 'France', IT: 'Italie', ES: 'Espagne', NL: 'Pays-Bas',
  PT: 'Portugal', GR: 'Grèce', IE: 'Irlande', BE: 'Belgique', AT: 'Autriche', FI: 'Finlande',
};
const BANQUE = { USD: 'Fed', EUR: 'BCE', GBP: 'BoE', JPY: 'BoJ', AUD: 'RBA', NZD: 'RBNZ', CAD: 'BoC', CHF: 'BNS', CNY: 'PBoC', CNH: 'PBoC' };
/* LE COMITÉ QUI DÉCIDE, quand son sigle est d'usage courant chez les traders. Seul le FOMC l'est
   vraiment : on dit « le FOMC », jamais « le Conseil des gouverneurs » pour la BCE ni « le MPC »
   hors du Royaume-Uni. Une table qui inventerait un sigle par banque serait plus régulière et moins
   juste : elle apprendrait au lecteur des noms que personne n'emploie. Les autres banques prennent
   donc « <Banque> taux », qui dit l'événement sans prétendre à un jargon qui n'existe pas. */
const COMITE = { USD: 'FOMC' };

/* RÉVISIONS ET SECONDES ESTIMATIONS. Une « Annual Revision », un « Benchmark », une « 2nd Est » ne
   sont PAS la publication d'origine : ils corrigent un chiffre que le marché a déjà digéré. Les
   confondre, c'est annoncer un rendez-vous majeur qui n'a pas lieu — l'erreur du 28 août. */
const REVISION_RX = /\brevisions?\b|\brevised\b|\bbenchmark\b/i;
const SECONDE_EST_RX = /\b(?:2nd|3rd|second|third)\s+est(?:imate)?\b|\bfinal\b|\bfinal\s+reading\b/i;

// Le pays d'ORIGINE prime sur la devise : l'IPC flash de fin de mois est français ou espagnol, pas « zone euro ».
function paysDe(e) {
  const c = String((e && (e.ctry || e.country)) || '').toUpperCase();
  if (c && ADJ_PAYS[c]) return c;
  return CCY2PAYS[String((e && e.currency) || '').toUpperCase()] || '';
}
function paysCourt(e) { return PAYS_COURT[paysDe(e)] || ''; }
function adjectif(e, genre) {
  const a = ADJ_PAYS[paysDe(e)];
  return a ? ' ' + a[genre] : '';
}

/* GLOSES — l'explication en français simple d'un intitulé de calendrier. C'est ce qui rend la carte
   lisible par quelqu'un qui découvre la macro (demande utilisateur 25/08 : « + parlant et plus simple
   à comprendre »). Ordre = du plus SPÉCIFIQUE au plus général : la première qui répond gagne. */
const GLOSES = [
  [/jackson hole/i, "le rendez-vous annuel des banquiers centraux, là où se dessine le cap des taux"],
  [/symposium|sintra|central bank forum/i, "le grand forum où les banquiers centraux exposent leur cap"],
  [/meeting minutes|monetary policy meeting accounts/i, "le compte rendu du dernier comité : le détail du débat derrière la décision"],
  [/press conference|conf[ée]rence de presse/i, "la conférence de presse qui suit la décision : c'est le ton qui fait bouger le marché"],
  [/economic projections|dot plot|staff projections/i, "les projections chiffrées du comité : c'est là qu'on lit le rythme de baisses de taux qu'il envisage"],
  [/\bg7\b|\bg20\b|\bsummit\b|sommet/i, "un sommet de chefs d'État : commerce, sanctions et énergie s'y décident"],
  [/\bopec\b|\bopep\b|\bjmmc\b/i, "l'OPEP fixe les quotas de production : c'est le prix du baril qui s'y joue"],
  [/bank holiday/i, "marché fermé : les volumes sont réduits, et de petits ordres suffisent à exagérer les mouvements"],
  [/monetary policy (?:report|statement|summary)/i, "le rapport dans lequel {banque} expose sa feuille de route"],
  /* ⚠️ « {banque} » EST REMPLACÉ PAR LE VRAI NOM À LA RÉSOLUTION (16/09). Trois jours de suite, trois
     banques différentes, et la carte disait « la banque centrale » à chaque fois : le lecteur ne
     pouvait pas distinguer le mercredi de la Fed du jeudi de la BoE sans ouvrir. Nommer la banque
     coûte trois caractères et supprime l'ambiguïté. La substitution se fait dans `_placeBanque`,
     qui retombe sur « la banque centrale » quand la devise est inconnue : on ne devine jamais. */
  [/rate decision|interest rate decision|rate statement|cash rate|\bocr\b|bank rate|refinancing rate|deposit facility|federal funds rate|policy rate|overnight rate|loan prime rate|fomc statement|monetary policy statement|rate announcement/i, "{banque} annonce son taux directeur"],
  [/non[-\s]?farm|nonfarm|\bnfp\b/i, "les créations d'emplois du mois aux États-Unis, le chiffre le plus suivi du dollar"],
  [/core pce/i, "l'inflation que la Fed regarde en priorité"],
  [/\bpce\b/i, "la mesure d'inflation privilégiée par la Fed"],
  [/personal spending|consumer spending/i, "ce que les ménages dépensent"],
  [/personal income/i, "ce que gagnent les ménages avant de le dépenser"],
  [/durable goods|factory orders/i, "les commandes de machines et d'équipements : le thermomètre de l'investissement des entreprises"],
  [/retail sales/i, "ce que les ménages dépensent en magasin"],
  [/(?:core\s+)?(?:inflation rate|cpi|hicp|consumer price)/i, "la hausse des prix payés par les ménages"],
  [/\bppi\b|producer price/i, "les prix payés par les entreprises : l'inflation de demain"],
  [/\bgdp\b|gross domestic/i, "la richesse produite par le pays sur la période"],
  [/unemployment rate/i, "la part de la population active qui cherche un emploi"],
  [/job openings|\bjolts\b/i, "les postes vacants : quand les entreprises recrutent moins, la pression sur les salaires retombe"],
  [/claimant count/i, "le nombre de personnes qui demandent une allocation chômage sur le mois"],
  [/jobless claims|initial claims|continuing claims|unemployment claims/i, "les nouvelles inscriptions au chômage de la semaine"],
  [/employment change|payrolls|\bjobs\b/i, "le nombre d'emplois créés ou détruits sur la période"],
  [/hourly earnings|average earnings|wage growth|labou?r cost/i, "la hausse des salaires, qui nourrit l'inflation de demain"],
  [/\bism\b/i, "l'enquête de référence auprès des entreprises américaines : au-dessus de 50, l'activité progresse"],
  [/\bpmi\b|purchasing managers/i, "le baromètre des directeurs d'achat : au-dessus de 50, l'activité progresse"],
  [/consumer confidence|consumer sentiment|consumer climate|gfk/i, "le moral des ménages, qui annonce leurs dépenses des prochains mois"],
  [/business climate|\bifo\b|business confidence|\bzew\b|tankan/i, "le moral des chefs d'entreprise"],
  [/trade balance|balance of trade/i, "l'écart entre ce que le pays vend et ce qu'il achète à l'étranger"],
  [/current account/i, "le solde de tous les échanges du pays avec le reste du monde"],
  [/building permits|housing starts|home sales|house price/i, "l'immobilier, le secteur le plus sensible au niveau des taux"],
  [/industrial production|manufacturing production/i, "ce que produisent réellement les usines"],
  [/crude oil inventories|\bopec\b|\bopep\b/i, "l'offre de pétrole, qui se répercute ensuite sur l'inflation"],
  [/empire state|philly fed|richmond fed|dallas fed|kansas city fed/i, "une enquête régionale auprès des industriels : elle sort avant l'indice national et l'annonce"],
  [/natural gas storage/i, "les stocks de gaz : ils commandent la facture énergétique, donc une part de l'inflation"],
  [/budget balance|federal budget/i, "l'écart entre ce que l'État encaisse et ce qu'il dépense : un déficit qui se creuse pèse sur les taux longs"],
  [/consumer credit/i, "ce que les ménages empruntent : un crédit qui s'emballe soutient la consommation, un crédit qui cale l'annonce en berne"],
  [/bond auction|note auction|bill auction|\bgilt\b|\bbund\b|jgb auction/i, "l'État emprunte : la demande à cette vente dit à quel taux le marché accepte de le financer"],
  [/housing market index|\bnahb\b/i, "le moral des constructeurs de maisons, très sensible au niveau des taux"],
  [/household spending/i, "ce que les ménages dépensent réellement, mois après mois"],
  [/retail inventories|business inventories/i, "les stocks des entreprises, un signal avancé sur la production à venir"],
  [/treasury secretary|secr[ée]taire au tr[ée]sor/i, "le patron du Trésor américain : il parle dette, émissions et sanctions"],
  [/national activity index|chicago fed/i, "un indice large de l'activité américaine, agrégé sur des dizaines de séries"],
  [/\bspeech\b|\bspeaks\b|testimony|humphrey[-\s]?hawkins/i, "un discours de banquier central : c'est le ton employé qui compte"],
];
/* LES DEUX NOMS D'UN MÊME ÉVÉNEMENT. Le calendrier du desk affiche le nom ForexFactory (c'est notre
   référence), mais il conserve le nom d'origine du fournisseur dans `_tvTitle`. Les deux portent de
   l'information : ForexFactory dit « Fed Chair Powell Speaks » là où l'autre dit « Fed Chair Powell
   Speech at Jackson Hole » — sans lire les deux, on perd « Jackson Hole », que l'utilisateur a
   explicitement demandé de voir. La RECONNAISSANCE lit donc les deux ; l'AFFICHAGE, lui, ne montre
   que le nom ForexFactory. */
function titresDe(e) {
  const a = String((e && e.title) || '').trim();
  const b = String((e && e._tvTitle) || '').trim();
  return (b && b.toLowerCase() !== a.toLowerCase()) ? a + ' · ' + b : a;
}
/* Entre les deux noms, on garde la glose la PLUS SPÉCIFIQUE (GLOSES est ordonné du plus précis au
   plus général) : « Fed Chair Powell Speaks » donne « un discours de banquier central », son nom
   d'origine donne « le rendez-vous annuel des banquiers centraux » — c'est celle-là qui informe. */
/* Le marqueur « {banque} » des gloses devient le nom réel (Fed, BCE, BoE…). Sans devise connue on
   retombe sur « la banque centrale » : on écrit ce qu'on sait, jamais ce qu'on suppose. Et l'article
   suit le nom — « la Fed », « la BCE », mais « la BoE » aussi : toutes ces institutions sont des
   banques, le féminin vaut partout ici, ce qui évite une table d'articles pour rien. */
function _placeBanque(txt, e) {
  const s = String(txt == null ? '' : txt);
  if (s.indexOf('{banque}') < 0) return s;
  const b = BANQUE[String((e && e.currency) || '').toUpperCase()];
  return s.split('{banque}').join(b ? 'la ' + b : 'la banque centrale');
}
function gloseEv(e) {
  const a = _gloseRang(e && e.title), b = _gloseRang(e && e._tvTitle);
  const out = (a[0] && b[0]) ? (a[1] <= b[1] ? a[0] : b[0]) : (a[0] || b[0] || '');
  return _placeBanque(out, e);
}
function _gloseRang(titre) {
  const t = String(titre || '');
  if (!t) return ['', 1e9];
  if (REVISION_RX.test(t)) {
    return [/non[-\s]?farm|nonfarm|\bnfp\b/i.test(t)
      ? "une correction annuelle des créations d'emplois DÉJÀ publiées, pas le rapport mensuel"
      : "une correction de chiffres déjà publiés", -1];
  }
  for (let i = 0; i < GLOSES.length; i++) if (GLOSES[i][0].test(t)) return [GLOSES[i][1], i];
  return ['', 1e9];
}
function gloseFr(titre) {
  const t = String(titre || '');
  if (!t) return '';
  if (REVISION_RX.test(t)) {
    // La glose DIT que c'est une correction : c'est exactement l'information qui manquait le 28 août.
    if (/non[-\s]?farm|nonfarm|\bnfp\b/i.test(t)) return "une correction annuelle des créations d'emplois DÉJÀ publiées, pas le rapport mensuel";
    return "une correction de chiffres déjà publiés";
  }
  /* ⚠️ CETTE VARIANTE NE REÇOIT QUE LE TITRE, donc pas la devise : elle ne peut pas nommer la
     banque. Rendre le marqueur tel quel afficherait « {banque} annonce son taux » à l'écran, et
     personne ne le verrait avant un client. On retombe donc sur la formule générique. */
  for (const [rx, g] of GLOSES) if (rx.test(t)) return _placeBanque(g, null);
  return '';
}

/* BARÈME DE POIDS ÉDITORIAL (déplacé de server.js le 25/08 pour être testable). `poidsMajeur` rend
   le poids du PREMIER motif qui répond : le plus lourd d'abord. Un poids ≥ 5 vaut « point d'orgue »
   — il remonte l'événement en tête de journée ET pèse comme une décision de taux dans le profil de
   risque de la semaine. C'est précisément ce que ne doit PAS obtenir une révision : « Non Farm
   Payrolls Annual Revision » corrige des créations d'emplois déjà publiées, elle pesait pourtant 5
   comme le rapport mensuel. Elle vaut 1 : listée, jamais traitée comme le rendez-vous du jour. */
const MAJEURS = [
  [/\bnon[-\s]?farm\s+payrolls?\b|\bnonfarm\s+payrolls?\b|\bnon[-\s]?farm\s+employment\s+change\b|\bnfp\b/i, 5],   // NFP — LE rendez-vous mensuel du dollar (1er vendredi)
  [/jackson hole|symposium|sintra|central bank forum/i, 5],                              // le discours qui redéfinit la trajectoire d'une banque
  [/\bpowell\b|(?:fed\s+)?chair\s+speech|testimony|humphrey[-\s]?hawkins/i, 4],        // le président de la Fed, où qu'il parle
  [/\blagarde\b|\bueda\b|\bbailey\b|\bmacklem\b|\bbullock\b|\bschlegel\b/i, 3],   // les sept autres gouverneurs
  [/meeting minutes|monetary policy (?:report|statement|summary)|press conference/i, 3], // le débat DERRIÈRE la décision
  [/treasury secretary|secr[ée]taire au tr[ée]sor/i, 3],                                  // le Trésor US parle taux, dette et sanctions
  [/\bopec\b|\bopep\b|\bg7\b|\bg20\b/i, 3],                                          // ce qui fait bouger le pétrole et le risque
];
function poidsMajeur(e) {
  const t = String((e && e.title) || '');
  let r = 0;
  for (const [rx, p] of MAJEURS) if (rx.test(t)) { r = p; break; }
  if (r && REVISION_RX.test(t)) return 1;
  return r;
}

/* SIGLES DE CALENDRIER — CE QUI S'AFFICHE DANS LE TITRE D'UNE CARTE (25/08, demande utilisateur :
   « mets les termes du calendrier, là on comprend pas “moral” etc., faut que ce soit simple et
   court, genre CPI USD, PPI USD »). Un titre de journée doit se lire d'un coup d'œil et se retrouver
   dans le calendrier : ce sont donc les SIGLES du calendrier, pas des libellés thématiques français.
   « Moral des entreprises allemandes » devient « Ifo », « Inflation PCE américaine » devient
   « Core PCE USD ».
   Le français n'a pas disparu, il a changé de place : le titre SITUE (terme du calendrier), la
   description EXPLIQUE (glose en français clair). C'était le vrai probleme — les deux disaient la
   même chose avec des mots différents, et le titre était le mauvais endroit pour expliquer.
   Le code de devise est accolé, sauf quand le sigle porte déjà son identité (une banque centrale,
   un nom propre, une enquête propre à un pays : « Fed », « Powell », « Ifo », « ISM Manufacturing »).
   Ordre = du plus SPÉCIFIQUE au plus général, la première règle qui répond gagne. */
const SIGLES = [
  [/jackson hole/i, 'Jackson Hole', true],
  [/symposium|sintra|central bank forum/i, 'Symposium', true],
  [/core pce/i, 'Core PCE'],
  [/\bpce\b/i, 'PCE'],
  [/core (?:cpi|inflation rate|consumer price|hicp)/i, 'Core CPI'],
  [/\bcpi\b|inflation rate|\bhicp\b|consumer price/i, 'CPI'],
  [/core ppi/i, 'Core PPI'],
  [/\bppi\b|producer price/i, 'PPI'],
  [/\bgdp\b|gross domestic/i, 'GDP'],
  [/\badp\b/i, 'ADP', true],
  [/non[-\s]?farm|nonfarm|\bnfp\b/i, 'NFP', true],
  [/unemployment claims|jobless claims|initial claims|continuing claims/i, 'Jobless Claims'],
  [/claimant count/i, 'Claimant Count'],
  [/unemployment (?:rate|change)/i, 'Unemployment'],
  [/employment change/i, 'Employment'],
  [/job openings|\bjolts\b/i, 'JOLTS', true],
  [/hourly earnings|average earnings|wage|labou?r cost/i, 'Wages'],
  [/core retail sales/i, 'Core Retail Sales'],
  [/retail sales/i, 'Retail Sales'],
  [/personal spending|consumer spending/i, 'Personal Spending'],
  [/household spending/i, 'Household Spending'],
  [/durable goods|factory orders/i, 'Durable Goods'],
  [/ism manufacturing/i, 'ISM Manufacturing', true],
  [/ism (?:services|non[-\s]?manufacturing)/i, 'ISM Services', true],
  [/manufacturing pmi/i, 'PMI Manufacturing'],
  [/services pmi/i, 'PMI Services'],
  [/composite pmi|\bpmi\b|purchasing managers/i, 'PMI'],
  [/\bifo\b/i, 'Ifo', true],
  [/\bzew\b/i, 'ZEW', true],
  [/tankan/i, 'Tankan', true],
  [/consumer sentiment|\buom\b|michigan/i, 'UoM Sentiment', true],
  [/consumer confidence|consumer climate|\bgfk\b/i, 'Consumer Confidence'],
  [/business confidence|business climate/i, 'Business Climate'],
  [/trade balance|balance of trade/i, 'Trade Balance'],
  [/current account/i, 'Current Account'],
  [/building permits/i, 'Building Permits'],
  [/housing starts/i, 'Housing Starts'],
  [/home sales/i, 'Home Sales'],
  [/housing market index|\bnahb\b/i, 'NAHB', true],
  [/house price|mortgage/i, 'Housing'],
  [/industrial production|manufacturing production/i, 'Industrial Production'],
  [/crude oil inventories/i, 'Crude Oil', true],
  [/natural gas storage/i, 'Natural Gas', true],
  [/\bopec\b|\bopep\b|\bjmmc\b/i, 'OPEC', true],
  [/\bg20\b/i, 'G20', true],
  [/\bg7\b/i, 'G7', true],
  [/treasury secretary|secr[ée]taire au tr[ée]sor/i, 'Treasury', true],
  [/national activity index|chicago fed/i, 'Chicago Fed', true],
  [/empire state/i, 'Empire State', true],
  [/philly fed/i, 'Philly Fed', true],
  [/richmond fed|dallas fed|kansas city fed/i, 'Fed Survey', true],
  [/consumer credit/i, 'Consumer Credit'],
  [/budget balance|federal budget/i, 'Budget Balance'],
  [/bond auction|note auction|bill auction|\bgilt\b|\bbund\b|jgb auction/i, 'Auction'],
  [/bank holiday/i, 'Jour férié'],
];
/* Code accolé au sigle : la DEVISE en général, mais le PAYS pour une publication nationale de la
   zone euro — « CPI FR » et « CPI DE » sont plus courts ET plus precis que « CPI EUR », qui laisse
   croire à l'agrégat de la zone (c'est l'erreur d'origine du 28 août, en version compacte). */
function codeEv(e) {
  const ccy = String((e && e.currency) || '').toUpperCase();
  const pays = paysDe(e);
  if (ccy === 'EUR' && pays && pays !== 'EU') return pays;
  return ccy;
}
/* Sigle affichable d'un événement. Une RÉVISION porte sa mention : c'est le défaut d'origine
   (« Non Farm Payrolls Annual Revision » annoncée comme le rapport mensuel) sous sa forme courte. */
function sigleEv(e) {
  const t = titresDe(e);
  if (!t) return '';
  const c = String((e && e.currency) || '').toUpperCase();
  const rev = REVISION_RX.test(t);
  const code = codeEv(e);
  let sigle = null, propre = false;
  /* LE LIEU AVANT LA PERSONNE. « Fed Chair Powell Speech at Jackson Hole » rendait « Powell » parce
     que le nom propre était testé en premier : or ce qui compte ce jour-là, c'est le symposium, pas
     l'orateur — c'est aussi ce que dit le thème. Le lieu passe donc devant. */
  if (/jackson hole/i.test(t)) { sigle = 'Jackson Hole'; propre = true; }
  else if (/symposium|sintra|central bank forum/i.test(t)) { sigle = 'Symposium'; propre = true; }
  // Banques centrales : le nom de la banque porte déjà le pays et se lit plus vite que « Federal Funds Rate ».
  const b = BANQUE[c];
  if (!sigle && b) {
    /* ⚠️ LE TITRE DIT CE QUI SE PASSE, PAS SEULEMENT QUI (16/09, capture utilisateur : « aujourd'hui
       on a le FOMC mais c'est indiqué Fed uniquement »). Une carte qui titre « Fed » un jour de
       décision, « Fed » un jour de discours et « Fed » un jour de minutes ne distingue rien : le
       lecteur doit ouvrir pour savoir ce qui l'attend. Un jour de décision porte donc le nom que le
       marché emploie réellement — FOMC pour la Fed — et, pour les banques dont le comité n'a pas de
       sigle courant, le mot qui dit l'événement : « BoE taux », « BoJ taux ».
       ⚠️ LA RÈGLE v29 N'EST PAS DÉFAITE, elle est servie : elle veut un titre qui SITUE en un coup
       d'œil et se retrouve dans le calendrier. « FOMC » se retrouve mieux que « Fed », qui désigne
       l'institution et non la réunion. On ajoute de la précision, on ne revient pas au français
       thématique que l'utilisateur avait refusé le 25/08. */
    const comite = COMITE[c] || null;                       // FOMC pour l'USD ; null ailleurs
    if (/rate decision|interest rate decision|rate statement|cash rate|\bocr\b|bank rate|refinancing rate|deposit facility|federal funds rate|policy rate|overnight rate|loan prime rate|fomc statement|monetary policy statement|rate announcement/i.test(t)) { sigle = comite || (b + ' taux'); propre = true; }
    else if (/meeting minutes|monetary policy meeting accounts/i.test(t)) { sigle = (comite || b) + ' Minutes'; propre = true; }
    else if (/press conference|conf[ée]rence de presse/i.test(t)) { sigle = (comite || b) + ' Conf.'; propre = true; }
    else if (/economic projections|dot plot|staff projections/i.test(t)) { sigle = (comite || b) + ' Projections'; propre = true; }
  }
  if (!sigle && /\bpowell\b/i.test(t)) { sigle = 'Powell'; propre = true; }
  if (!sigle && /\blagarde\b/i.test(t)) { sigle = 'Lagarde'; propre = true; }
  if (!sigle && /\bueda\b/i.test(t)) { sigle = 'Ueda'; propre = true; }
  if (!sigle && /\bbailey\b/i.test(t)) { sigle = 'Bailey'; propre = true; }
  if (!sigle && /\bmacklem\b/i.test(t)) { sigle = 'Macklem'; propre = true; }
  if (!sigle && /\bbullock\b/i.test(t)) { sigle = 'Bullock'; propre = true; }
  if (!sigle && /\bschlegel\b/i.test(t)) { sigle = 'Schlegel'; propre = true; }
  if (!sigle) for (const [rx, sg, seul] of SIGLES) if (rx.test(t)) { sigle = sg; propre = !!seul; break; }
  // Aucun sigle connu : l'intitulé du calendrier lui-même, nettoyé de sa ferraille de période.
  if (!sigle) { sigle = _titreCourt(String((e && e.title) || ''), 26); propre = false; }
  const out = (propre || !code) ? sigle : `${sigle} ${code}`;
  return rev ? `${out} (rév.)` : out;
}

/* VOCABULAIRE FERMÉ DE FAMILLES (25/08, demande utilisateur : « renomme les titres avec l'IA pour les
   raccourcir »). Les règles ci-dessous couvrent les 88 intitulés courants du calendrier, mais un
   fournisseur en publie des centaines : le jour où l'un d'eux n'est reconnu par aucune règle, la
   carte retombe sur son intitulé anglais. C'est là, et SEULEMENT là, que l'IA intervient — et pas
   pour ÉCRIRE un titre : pour CHOISIR une famille dans cette liste. Elle ne rend qu'une clé.
   Le libellé français, l'adjectif de pays et son accord sont ensuite construits ICI, par du code.
   Une IA qui ne peut rendre qu'une clé d'une liste fermée ne peut pas inventer un rendez-vous —
   c'est la seule forme sous laquelle elle a sa place dans ces cartes, après la v20 où elle annonçait
   des décisions de taux qui n'existaient pas. Clé inconnue ou absente → repli déterministe. */
const FAMILLES = {
  politique_monetaire: { lbl: 'Politique monétaire', g: 1, rang: 7,   quoi: 'décision de taux, communiqué, minutes ou rapport de politique monétaire' },
  discours:            { lbl: 'Discours',            g: 0, rang: 5,   quoi: 'intervention publique d\'un responsable (banque centrale, Trésor, ministre)' },
  sommet:              { lbl: 'Sommet',              g: 0, rang: 5,   quoi: 'sommet, réunion internationale, OPEP, G7, G20' },
  inflation:           { lbl: 'Inflation',           g: 1, rang: 7,   quoi: 'prix à la consommation, prix à la production, déflateurs' },
  croissance:          { lbl: 'Croissance',          g: 1, rang: 6,   quoi: 'PIB et agrégats de croissance' },
  emploi:              { lbl: 'Emploi',              g: 0, rang: 3,   quoi: 'chômage, créations de postes, inscriptions, postes vacants' },
  salaires:            { lbl: 'Salaires',            g: 3, rang: 3,   quoi: 'rémunérations, coût du travail' },
  consommation:        { lbl: 'Consommation',        g: 1, rang: 3.4, quoi: 'ventes au détail, dépenses des ménages' },
  activite:            { lbl: 'Activité',            g: 1, rang: 2.2, quoi: 'enquêtes PMI, ISM, indices d\'activité composites' },
  industrie:           { lbl: 'Production industrielle', g: 1, rang: 2.6, quoi: 'production des usines, commandes industrielles, stocks' },
  immobilier:          { lbl: 'Immobilier',          g: 0, rang: 1.9, quoi: 'logement, permis, mises en chantier, prêts immobiliers' },
  commerce:            { lbl: 'Commerce extérieur',  g: 0, rang: 2,   quoi: 'balance commerciale, exportations, importations, compte courant' },
  confiance:           { lbl: 'Confiance',           g: 1, rang: 1.8, quoi: 'moral des ménages ou des entreprises' },
  credit:              { lbl: 'Crédit',              g: 0, rang: 1.5, quoi: 'crédit, masse monétaire, prêts bancaires' },
  budget:              { lbl: 'Solde budgétaire',    g: 0, rang: 1.5, quoi: 'finances publiques, déficit, dette' },
  energie:             { lbl: 'Énergie',             g: 1, rang: 1.7, quoi: 'stocks de pétrole ou de gaz, production énergétique' },
  adjudication:        { lbl: 'Adjudication obligataire', g: 1, rang: 1.2, quoi: 'émission de dette souveraine, adjudication' },
  ferie:               { lbl: 'Jour férié',          g: 0, rang: 0.5, quoi: 'jour férié, marché fermé' },
};
const FAMILLES_CLES = Object.keys(FAMILLES);
/* LE VERROU. Toute réponse de l'IA passe par ici : ce qui n'est pas EXACTEMENT une clé de la liste
   est rejeté, sans repêchage ni correction approximative. C'est cette fonction, et elle seule, qui
   rend l'invention impossible — elle est donc éprouvée directement par le contrôle. */
function familleValide(v) {
  return (typeof v === 'string' && Object.prototype.hasOwnProperty.call(FAMILLES, v)) ? v : null;
}
// Libellé d'une famille pour un événement donné : le pays et l'accord sont posés par le code.
function themeDeFamille(e, cle) {
  const f = FAMILLES[cle];
  if (!f) return null;
  return { lbl: f.lbl + adjectif(e, f.g), rang: f.rang, src: e };
}

/* THÈMES DE JOUR. `rang` = poids éditorial ; il décide du titre ET de l'événement mis en avant dans
   la description. Un thème porte TOUJOURS `src`, l'événement du calendrier dont il est issu — c'est
   ce lien qui garantit qu'aucun titre ne peut nommer un rendez-vous absent de la carte. */
function themeJour(e) {
  const raw = titresDe(e);
  if (!raw) return null;
  const t = ' ' + raw.toLowerCase() + ' ';
  const c = String((e && e.currency) || '').toUpperCase();
  const rev = REVISION_RX.test(raw);
  const est2 = SECONDE_EST_RX.test(raw);
  const adj = g => adjectif(e, g);
  /* Une révision garde le thème de l'indicateur (c'est bien du PIB), mais le libellé le DIT : sans
     cette mention, la carte titrait « PIB américain » pendant que sa glose expliquait qu'il s'agit
     d'une correction de chiffres déjà publiés — la contradiction que l'on vient de corriger. */
  const out = (lbl, rang) => ({ lbl: rev ? lbl + ' (révision)' : lbl, rang: rev ? 1 : (est2 ? Math.max(1.5, rang - 3) : rang), src: e });

  if (/jackson hole/.test(t)) return out('Jackson Hole', 9.5);
  if (/symposium|sintra|central bank forum/.test(t)) return out('Symposium des banquiers centraux', 9.4);
  if (/rate decision|interest rate decision|rate statement|cash rate|\bocr\b|bank rate|refinancing rate|deposit facility|federal funds rate|policy rate|overnight rate|loan prime rate|fomc statement|monetary policy statement|rate announcement/.test(t)) {
    const b = BANQUE[c]; return b ? out('Décision de la ' + b, 9) : null;
  }
  if (/press conference|conf[ée]rence de presse/.test(t)) { const b = BANQUE[c]; return b ? out('Conférence de presse de la ' + b, 6.6) : null; }
  if (/economic projections|dot plot|staff projections/.test(t)) { const b = BANQUE[c]; return b ? out('Projections de la ' + b, 6.4) : null; }
  if (/meeting minutes|monetary policy meeting accounts/.test(t)) { const b = BANQUE[c]; return b ? out('Minutes de la ' + b, 6.5) : null; }
  if (/\bopec\b|\bopep\b|\bjmmc\b/.test(t)) return out('Réunion de l\'OPEP', 5.2);
  if (/\bg20\b/.test(t)) return out('Sommet du G20', 5.1);
  if (/\bg7\b/.test(t)) return out('Sommet du G7', 5.1);
  if (/treasury secretary|secr[ée]taire au tr[ée]sor/.test(t)) return out('Discours du Trésor américain', 5);
  if (/\bpowell\b|(?:fed\s+)?chair\s+speech/.test(t)) return out('Discours de Powell', 8.2);
  if (/\blagarde\b/.test(t)) return out('Discours de Lagarde', 6.8);
  if (/\bueda\b|\bbailey\b|\bmacklem\b|\bbullock\b|\bschlegel\b/.test(t)) { const b = BANQUE[c]; return out('Discours du gouverneur' + (b ? ' de la ' + b : ''), 6.6); }
  // NFP : le rapport MENSUEL uniquement, et seulement pour le dollar. Sa révision annuelle tombe en rang 1.
  if (/non[-\s]?farm|nonfarm|\bnfp\b/.test(t)) {
    if (rev) return { lbl: 'Révision annuelle du NFP', rang: 1, src: e };
    if (c === 'USD') return out('NFP américain', 8);
    return out('Emploi' + adj(0), 3);
  }
  if (/core pce|\bpce\b/.test(t)) return out('Inflation PCE' + adj(1), 7.5);
  if (/inflation rate|\bcpi\b|\bhicp\b|consumer price/.test(t)) return out('CPI' + adj(0), 7);
  if (/\bgdp\b|gross domestic/.test(t)) return out('PIB' + adj(0), 6);
  if (/\bppi\b|producer price/.test(t)) return out('PPI' + adj(0), 5);
  if (/retail sales/.test(t)) return out('Ventes au détail' + adj(2), 4);
  if (/durable goods|factory orders/.test(t)) return out('Commandes de biens durables' + adj(2), 3.6);
  if (/personal spending|consumer spending|household spending/.test(t)) return out('Dépenses des ménages' + adj(3), 3.5);
  if (/industrial production|manufacturing production/.test(t)) return out('Production industrielle' + adj(1), 2.6);
  if (/unemployment|jobless|employment change|labou?r market|\bjobs\b|hourly earnings|average earnings|unemployment claims|job openings|\bjolts\b|claimant count/.test(t)) return out('Emploi' + adj(0), 3);
  if (/trade balance|balance of trade/.test(t)) return out('Balance commerciale' + adj(1), 2);
  if (/\bpmi\b|purchasing managers|\bism\b/.test(t)) return out('PMI' + adj(0), 2);
  if (/business climate|\bifo\b|business confidence|\bzew\b|tankan/.test(t)) return out('Moral des entreprises' + adj(2), 2);
  if (/building permits|housing starts|home sales|house price|mortgage|housing market index|\bnahb\b/.test(t)) return out('Immobilier' + adj(0), 1.9);
  if (/crude oil inventories/.test(t)) return out('Stocks de pétrole' + adj(3), 1.7);
  if (/national activity index|chicago fed/.test(t)) return out('Indice d\'activité' + adj(0), 1.6);
  if (/empire state|philly fed|richmond fed|dallas fed|kansas city fed/.test(t)) return out('Enquête manufacturière' + adj(1), 2.1);
  if (/budget balance|federal budget/.test(t)) return out('Solde budgétaire' + adj(0), 1.5);
  if (/consumer credit/.test(t)) return out('Crédit à la consommation' + adj(0), 1.5);
  if (/natural gas storage/.test(t)) return out('Stocks de gaz' + adj(3), 1.4);
  if (/bond auction|note auction|bill auction|\bgilt\b|\bbund\b|jgb auction/.test(t)) return out('Adjudication obligataire' + adj(1), 1.2);
  if (/bank holiday/.test(t)) return out('Jour férié' + adj(0), 0.5);
  if (/consumer confidence|consumer sentiment|consumer climate/.test(t)) return out('Confiance des ménages' + adj(3), 1.8);
  // DERNIER RECOURS : la famille posée sur l'événement par l'appelant (classement IA à vocabulaire
  // fermé, voir FAMILLES). Elle n'est consultée qu'ici, après TOUTES les règles déterministes.
  if (e && e._fam) { const th = themeDeFamille(e, e._fam); if (th) return rev ? { lbl: th.lbl + ' (révision)', rang: 1, src: e } : th; }
  return null;
}

/* Thèmes DISTINCTS d'une journée, du plus lourd au plus léger. Le tableau reçu est celui qui sera
   AFFICHÉ sous la carte : c'est la seule source, donc le titre ne peut rien inventer. */
function themesDuJour(events) {
  const ths = [];
  for (const e of (events || [])) {
    const th = themeJour(e);
    if (!th) continue;
    if (ths.some(x => x.lbl === th.lbl)) continue;
    ths.push(th);
  }
  /* L'IMPACT DU CALENDRIER PASSE AVANT L'IMPORTANCE INTRINSÈQUE. `rang` dit ce que vaut un type
     d'indicateur en général ; l'impact dit ce que vaut CETTE publication-là. Depuis que les moyens
     ne sont plus masqués, un IPC national moyen pouvait coiffer le rendez-vous fort de la journée. */
  const _fort = e => /high/i.test(String((e && e.impact) || '')) ? 1 : 0;
  ths.sort((a, b) => (_fort(b.src) - _fort(a.src)) || (b.rang - a.rang));
  // Le jour du NFP, « Emploi américain » est redondant (le NFP EST l'emploi US) → on l'absorbe.
  if (ths.some(x => x.lbl === 'NFP américain')) {
    const i = ths.findIndex(x => x.lbl === 'Emploi américain');
    if (i >= 0) ths.splice(i, 1);
  }
  // GARDE-FOU EXPLICITE : un thème dont l'événement source n'est pas dans la liste affichée est jeté.
  // Tenu par construction aujourd'hui ; le jour où quelqu'un passera une liste plus large, il tiendra encore.
  return ths.filter(x => (events || []).indexOf(x.src) >= 0);
}

const _cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
function heureParis(e) {
  const ts = e && (e.timestamp || e.ts);
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');
}
/* Nom AFFICHÉ d'un événement : devise + intitulé VO (jamais traduit), parenthèses de source retirées.
   Le PAYS est ajouté quand la devise ne suffit pas à identifier l'émetteur : la France et l'Espagne
   publient le même « Inflation Rate YoY Prel » le même matin, tous deux classés EUR — la carte
   affichait deux lignes rigoureusement identiques. L'agrégat de la zone (EU) reste sans mention. */
function nomEv(e) {
  const base = ((((e && e.currency) ? e.currency + ' ' : '') + String((e && e.title) || '').replace(/\s*\([^)]*\)\s*/g, ' ')).replace(/\s+/g, ' ').trim());
  return _avecPays(base, e);
}
function _avecPays(texte, e) {
  const pays = paysDe(e);
  if (!texte || !pays || pays === 'EU') return texte;
  if (String((e && e.currency) || '').toUpperCase() !== 'EUR') return texte;
  const deja = PAYS_DEJA_DIT[pays];
  if (deja && deja.test(String((e && e.title) || ''))) return texte;   // « German Prelim CPI » se suffit
  const court = PAYS_COURT[pays];
  return court ? `${texte} (${court})` : texte;
}
function intituleAffiche(e) {
  return _avecPays(String((e && e.title) || '').replace(/\s+/g, ' ').trim(), e);
}
function chiffresEv(e) {
  if (!e) return '';
  if (e.forecast) return ` (prév. ${e.forecast}${e.previous ? `, préc. ${e.previous}` : ''})`;
  return e.previous ? ` (préc. ${e.previous})` : '';
}

/* TITRE DU JOUR. Un rendez-vous de rang ≥ 8 (décision de taux, Jackson Hole, NFP, Powell) EST
   l'histoire du jour : il tient le titre SEUL — coller un second thème derrière ne fait que diluer.
   En dessous, deux thèmes au plus, joints par « + ». Repli : les intitulés bruts, comme avant. */
/* RENDEZ-VOUS QUI S'ÉTALENT (25/08, capture user : jeudi et vendredi sortaient « Jackson Hole » avec
   la MÊME description, mot pour mot). Un symposium dure trois jours, une réunion du G20 deux : la
   carte doit dire OÙ on en est, et ne pas resservir le même argument. `suite` est calculé par
   l'appelant, qui seul voit toute la semaine — voir la double passe dans generateWeekAhead.
   `fin` n'est vrai que si l'appelant a PU CONSTATER la fin (l'événement s'arrête avant le dernier
   jour de la fenêtre) : sans cette preuve on numérote, on n'annonce pas une dernière journée. */
const _ORDINAL = { 2: 'Deuxième', 3: 'Troisième', 4: 'Quatrième', 5: 'Cinquième' };
const _NOMBRE = { 2: 'deux', 3: 'trois', 4: 'quatre', 5: 'cinq' };
function _suiteMarque(suite) {
  if (!suite || suite.jour < 2) return '';
  return suite.fin ? 'dernier jour' : 'jour ' + suite.jour;
}
/* Le libellé en tête, la journée derrière : « Sommet du G20, dernière journée ». La tournure inverse
   («  Dernière journée de … ») exige un article qui dépend du libellé — du sommet, de la réunion,
   rien devant « Jackson Hole » — et sortait donc faux une fois sur deux. */
function _suiteTexte(suite) {
  if (!suite || suite.jour < 2) return '';
  const j = suite.fin ? 'dernière journée' : (_ORDINAL[suite.jour] ? _ORDINAL[suite.jour].toLowerCase() + ' journée' : 'journée ' + suite.jour);
  return `${suite.lbl}, ${j}`;
}
function _suiteEnjeu(suite) {
  if (!suite || suite.jour < 2) return '';
  return suite.fin
    ? `c'est le bilan de ces ${_NOMBRE[suite.total] || suite.total} jours que le marché retiendra.`
    : `le cadrage s'est dit la veille, ce sont les interventions du jour qui peuvent encore corriger la trajectoire annoncée.`;
}
const _PERIODE_RX = /\s*\b(?:m\/m|y\/y|q\/q|mom|yoy|qoq|s\.a\.?|prel(?:im)?|flash|final|adv|2nd\s+est|3rd\s+est|indicator)\b\s*/gi;
function _titreCourt(t, max) {
  let s = String(t || '').replace(_PERIODE_RX, ' ').replace(/\s+/g, ' ').trim();
  const n = max || 34;
  if (s.length <= n) return s;
  const coupe = s.slice(0, n).lastIndexOf(' ');
  return (coupe > 12 ? s.slice(0, coupe) : s.slice(0, n)).trim();
}
/* ══ QUELS ÉVÉNEMENTS PEUVENT RÉELLEMENT S'ÉTALER SUR PLUSIEURS JOURS (16/09) ═══════════════

   SIGNALEMENT : « pourquoi il y a 2 fois FOMC ? ». La carte du mercredi titrait « FOMC » et celle du
   jeudi « BoE taux + FOMC (dernier jour) ». Or le FOMC décide le mercredi à 20h00 : il n'y a pas de
   « dernier jour » le lendemain. Le défaut préexistait au renommage FOMC, sous une forme plus discrète
   (« BoE + Fed (dernier jour) ») : il est devenu criant une fois la réunion nommée, ce qui est
   exactement ce qu'un bon titre doit faire.

   LA CAUSE EST STRUCTURELLE, et c'est pourquoi on ne la corrige pas au cas par cas. Le repérage des
   rendez-vous qui s'étalent cherche le même couple (devise, intitulé) sur deux jours CONSÉCUTIFS.
   La règle est bonne pour un symposium ou un G20, qui reviennent à l'identique plusieurs jours de
   suite. Elle est FAUSSE PAR NATURE pour une décision de taux ou une publication : ces événements
   ont lieu UNE FOIS, à un instant précis. Si leur intitulé apparaît deux jours de suite au
   calendrier, ce n'est pas une continuité — c'est un doublon du flux, un horaire provisoire, ou une
   ligne de rappel. Les traiter comme une suite fabrique un rendez-vous qui n'existe pas, ce que la
   v24 avait déjà interdit au TITRE et que la détection de suite rouvrait par une autre porte.

   ON INVERSE DONC LA CHARGE DE LA PREUVE : rien ne s'étale, SAUF ce qui est reconnu comme pouvant
   durer. La liste est courte et ferme, et se lit d'un coup d'œil. Une liste fermee vaut mieux qu'une
   heuristique : un symposium inconnu perdra sa numérotation (il gardera son titre et sa glose, rien
   n'est caché), là où une heuristique trop large ferait réapparaître un « dernier jour » inventé sur
   une décision de taux — et c'est cette erreur-là qui coûte, pas l'autre. */
/* ⚠️ NI « meetings » NU, NI « conference » NU. Mesuré en jouant la liste : « FOMC Meetings », que
   certains fournisseurs écrivent ainsi, passait pour étalable alors que c'est LA réunion qui décide
   — le cas même qu'on vient de fermer. Et « conference » aurait un jour attrapé « FOMC Press
   Conference », qui dure une heure. Une réunion ne s'étale donc que si elle le DIT (« Day 1 »,
   « Day 2 ») ou si elle est nommée par un format qui dure par nature (symposium, forum, sommet,
   OPEP, audition semestrielle). Les vrais rendez-vous multi-jours portent tous l'un de ces mots ;
   « meetings » tout seul n'en distingue aucun. */
const ETALABLE_RX = /jackson hole|symposium|sintra|forum|summit|sommet|\bg7\b|\bg20\b|\bopec\b|\bopep\b|\bjmmc\b|\bday\s*[123]\b|jour\s*[123]\b|congress|testimony|hearing|semi[- ]?annual|humphrey/i;
/* UNE DÉCISION DE TAUX, reconnue par son intitulé. Extrait en fonction nommée (16/09) parce que
   DEUX règles en dépendent désormais : l'inéligibilité à une suite, et le dédoublonnage de la semaine.
   Deux copies de cette expression auraient dérivé : c'est exactement ce qui a coûté cher ici le
   25/08, quand le renommage de la décision de taux vivait à deux endroits. */
const DECISION_RX = /rate decision|interest rate decision|rate statement|cash rate|\bocr\b|bank rate|refinancing rate|deposit facility|federal funds rate|policy rate|overnight rate|loan prime rate|fomc statement|monetary policy statement|rate announcement/i;
function estDecisionTaux(e) { const t = titresDe(e); return !!t && DECISION_RX.test(t); }
function peutSEtaler(e) {
  const t = titresDe(e);
  if (!t) return false;
  /* ⚠️ UNE DÉCISION DE TAUX N'EST JAMAIS ÉTALABLE, même si son intitulé contient par accident un mot
     de la liste ci-dessus (« FOMC Meetings » chez certains fournisseurs). Le veto passe donc EN
     PREMIER : sans lui, la liste ferme aurait laissé rentrer précisément le cas signalé. */
  if (DECISION_RX.test(t)) return false;
  return ETALABLE_RX.test(t);
}

// Libellé court d'un événement, quand aucun thème ne le reconnaît (repli de la détection de suite).
function libelleCourt(e) { return _titreCourt(intituleAffiche(e), 40); }
function titreJour(events, dowFr, opts) {
  const evs = (events || []).filter(Boolean);
  if (!evs.length) return `Séance calme ${dowFr || ''}`.trim();
  const suite = opts && opts.suite;
  const ths = themesDuJour(evs);
  /* ORDRE DE PRIORITÉ : les événements porteurs d'un thème d'abord (déjà triés impact puis
     importance par themesDuJour), le reste ensuite. Le RENDU, lui, est le sigle du calendrier. */
  const ordre = ths.map(t => t.src).concat(evs.filter(e => !ths.some(t => t.src === e)));
  const vus = new Set();
  const sigles = [];
  for (const e of ordre) { const sg = sigleEv(e); if (sg && !vus.has(sg)) { vus.add(sg); sigles.push({ sg, e }); } }
  if (!sigles.length) return `Séance calme ${dowFr || ''}`.trim();
  if (suite && suite.jour >= 2) {
    const marque = _suiteMarque(suite);
    const autre = sigles.find(x => x.sg !== suite.sigle);
    return autre ? `${autre.sg} + ${suite.sigle} (${marque})` : `${suite.sigle} · ${marque}`;
  }
  /* PLUSIEURS TÊTES D'AFFICHE (30/08, capture user : le mercredi portait la décision de la BoC ET
     celle de la RBNZ, le titre ne disait que « BoC » — la RBNZ était dans la liste de la carte mais
     invisible du titre et de la description). La règle « un rang ≥ 8 tient le titre seul » avait été
     écrite pour qu'un sigle MINEUR ne dilue pas l'histoire du jour, jamais pour taire une seconde
     décision de taux : les rendez-vous de rang ≥ 8 tiennent désormais le titre ENSEMBLE, dans
     l'ordre où la journée les sert (ths est trié impact puis rang, à égalité l'ordre du jour). */
  const majeurs = ths.filter(t => t.rang >= 8);
  if (majeurs.length >= 2) {
    const sgM = [], vusM = new Set();
    for (const t of majeurs.slice(0, 3)) { const s = sigleEv(t.src); if (s && !vusM.has(s)) { vusM.add(s); sgM.push(s); } }
    if (sgM.length >= 2) return sgM.join(' + ');
  }
  // Un rendez-vous de rang ≥ 8 (décision de taux, Jackson Hole, NFP, Powell) SEUL de son rang tient
  // le titre seul : c'est l'histoire du jour, un second sigle mineur ne fait que la diluer.
  const seul = ths.length && ths[0].rang >= 8 && sigles[0].e === ths[0].src;
  return (seul ? sigles.slice(0, 1) : sigles.slice(0, 2)).map(x => x.sg).join(' + ');
}
// Le titre a-t-il dû retomber sur les intitulés bruts ? C'est le SEUL cas où l'on sollicite l'IA.
/* Le titre a-t-il dû retomber sur un intitulé brut du calendrier ? C'est le SEUL cas où l'on
   sollicite l'IA — et depuis que le titre affiche des SIGLES, « en repli » ne veut plus dire
   « sans thème » mais « sans sigle connu » : un intitulé rare sort alors tel quel. */
function titreEstRepli(events, opts) {
  const evs = (events || []).filter(Boolean);
  if (!evs.length) return false;
  const suite = opts && opts.suite;
  if (suite) return false;
  return !evs.some(e => { const t = titresDe(e); return SIGLES.some(([rx]) => rx.test(t)) || !!themeJour(e); });
}

/* ENJEU — « et alors ? », en français de tous les jours. Il est calé sur l'événement RÉELLEMENT mis
   en avant (le `src` du thème de tête), plus sur un thème pioché ailleurs dans la journée : c'est ce
   décalage qui faisait parler du PIB sous une liste d'inflation et de dépenses des ménages. */
function enjeuFr(theme, dev) {
  const l = (theme && theme.lbl) || '';
  const d = dev || 'la devise';
  if (/^Jackson Hole|^Symposium/.test(l)) return `C'est le rendez-vous où les banques centrales annoncent la couleur pour les mois qui viennent : une phrase sur le rythme des baisses de taux suffit à faire bouger ${d} et les marchés actions.`;
  /* ⚠️ TROIS JOURS DE SUITE, LE MÊME PARAGRAPHE MOT POUR MOT (16/09, capture utilisateur). Une
     semaine à trois décisions de taux — Fed mercredi, BoE jeudi, BoJ vendredi — servait la même
     phrase trois fois : le lecteur apprend à la sauter dès le deuxième jour, et il a raison. Et
     elle était lourde : une négation, deux subordonnées, trente-deux mots avant le verbe utile.
     Réécrite en phrases courtes, à la voix active, et NOMMÉE : la banque apparaît dans le texte,
     donc les trois jours se lisent différemment sans qu'on ait à inventer trois explications. */
  if (/^Décision de la /.test(l)) {
    /* ⚠️ ON GARDE L'ARTICLE. Retirer « Décision de la » en entier rendait « Si Fed laisse entendre »,
       qui n'est pas du français. On ne coupe donc qu'à « Décision de » : « la Fed », « la BoE »
       arrivent avec leur déterminant. Faute introduite et vue à la relecture de la SORTIE, pas du
       code : les deux lignes étaient justes séparément. */
    const bq = l.replace(/^Décision de\s+/, '').trim() || 'la banque centrale';
    return `Le taux annoncé est déjà connu du marché : ce n'est pas lui qui fait bouger les cours. Ce qui compte, c'est la suite. Si ${bq} laisse entendre qu'elle n'a pas fini, ${d} monte ; si elle ouvre la porte à une baisse, ${d} recule.`;
  }
  if (/^Conférence de presse de la /.test(l)) return `La décision est déjà connue à ce moment-là : c'est la conférence qui la commente, et c'est souvent elle qui fait bouger ${d}, pas le taux lui-même.`;
  if (/^Projections de la /.test(l)) return `Les projections chiffrent ce que le comité envisage pour les mois à venir : un seul cran déplacé, et le marché révise toute sa trajectoire de taux.`;
  if (/^Réunion de l'OPEP/.test(l)) return `L'OPEP décide combien de barils arrivent sur le marché : le prix du pétrole qui en sort se retrouve dans l'inflation quelques semaines plus tard.`;
  if (/^Sommet du G/.test(l)) return `Un sommet ne publie pas de chiffre, mais ce qui s'y décide — droits de douane, sanctions, énergie — se lit ensuite sur les devises pendant des semaines.`;
  if (/^Enquête manufacturière/.test(l)) return `Ces enquêtes régionales sortent avant l'indice national : elles donnent le sens du vent quelques jours à l'avance.`;
  if (/^Solde budgétaire/.test(l)) return `Un déficit qui se creuse oblige l'État à emprunter davantage : les taux longs montent, et la devise en subit le contrecoup.`;
  if (/^Crédit à la consommation/.test(l)) return `Le crédit dit si les ménages peuvent encore dépenser : quand il se contracte, la consommation cale quelques mois plus tard.`;
  if (/^Stocks de gaz/.test(l)) return `Des stocks bas en entrée d'hiver font grimper la facture énergétique, et l'inflation avec.`;
  if (/^Adjudication obligataire/.test(l)) return `Une vente mal couverte signale que le marché exige plus cher pour financer l'État : les taux montent, ${d} suit.`;
  if (/^Jour férié/.test(l)) return `Marché fermé sur cette place : les volumes se réduisent, et de petits ordres suffisent à exagérer les mouvements.`;
  if (/^Minutes de la /.test(l)) return `Les minutes racontent le débat qui a eu lieu autour de la table : un comité plus divisé, ou plus ferme, qu'on ne le croyait, et le marché révise sa trajectoire de taux.`;
  if (/^Discours du Trésor/.test(l)) return `Ce n'est pas la Fed : ses annonces passent d'abord par le marché obligataire, et un calendrier d'emprunts plus lourd que prévu fait monter les rendements avant de tirer ${d}.`;
  if (/^Indice d'activité/.test(l)) return `Cet indice agrège des dizaines de séries en un seul chiffre : au-dessus de zéro l'économie tourne au-dessus de sa tendance, en dessous elle ralentit.`;
  if (/^Discours/.test(l)) return `Un discours de banquier central se lit au ton : plus ferme sur l'inflation, ${d} monte ; plus conciliant, elle recule.`;
  if (/^NFP/.test(l)) return `C'est le juge de paix mensuel du dollar : plus d'emplois créés que prévu et le marché repousse les baisses de taux, ce qui fait monter ${d} ; moins, et c'est l'inverse.`;
  if (/^Révision annuelle du NFP/.test(l)) return `Attention à ne pas le confondre avec le rapport mensuel : cette révision corrige des créations d'emplois déjà connues. Elle compte surtout si la correction est massive.`;
  if (/^Inflation PCE|^CPI/.test(l)) return `Des prix qui montent plus vite que prévu obligent la banque centrale à garder ses taux élevés plus longtemps, ce qui soutient ${d} ; s'ils ralentissent, la porte d'une baisse de taux se rouvre.`;
  if (/^PPI/.test(l)) return `Ce que payent les usines aujourd'hui finit dans le panier du consommateur quelques mois plus tard : c'est un signal AVANCÉ sur l'inflation.`;
  if (/^PIB/.test(l)) return `Le PIB donne la température de l'économie : s'il déçoit nettement, le marché commence à parler de baisses de taux et ${d} en pâtit.`;
  if (/^Ventes au détail/.test(l)) return `La consommation fait tourner l'économie : ce chiffre dit si les ménages suivent encore, ou si la demande commence à caler.`;
  if (/^Emploi/.test(l)) return `Le marché du travail commande les salaires et donc l'inflation : tant qu'il tient, la banque centrale peut se permettre d'attendre.`;
  if (/^PMI/.test(l)) return `Les PMI voient le retournement AVANT les chiffres officiels : la barre des 50 sépare la croissance de la contraction.`;
  if (/^Balance commerciale/.test(l)) return `Un pays qui exporte plus qu'il n'importe voit sa devise achetée pour régler les factures : la balance pèse mécaniquement sur ${d}.`;
  if (/^Commandes de biens durables/.test(l)) return `Ces commandes disent si les entreprises investissent encore : c'est un engagement sur plusieurs mois, donc l'un des meilleurs signaux avancés sur l'activité.`;
  if (/^Dépenses des ménages/.test(l)) return `La consommation fait tourner l'économie : si les ménages freinent, la croissance suit, et la banque centrale doit envisager de baisser ses taux.`;
  if (/^Production industrielle/.test(l)) return `C'est ce que les usines produisent réellement, sans effet d'enquête ni de sondage : la mesure la plus directe de l'activité.`;
  if (/^Moral des entreprises/.test(l)) return `Le moral des patrons précède leurs décisions d'embauche et d'investissement : il annonce l'activité de la fin d'année.`;
  if (/^Immobilier/.test(l)) return `L'immobilier est le premier secteur à réagir au niveau des taux : c'est là que se voit, avant partout ailleurs, l'effet de la politique monétaire.`;
  if (/^Stocks de pétrole/.test(l)) return `Les stocks disent si l'offre suit la demande : le prix du baril qui en découle finit dans l'inflation quelques semaines plus tard.`;
  if (/^Confiance des ménages/.test(l)) return `Le moral des ménages annonce leurs dépenses : quand il se dégrade, la consommation suit quelques mois plus tard.`;
  return '';
}

/* DESCRIPTION DE LA CARTE — trois phrases, dans cet ordre : (1) le rendez-vous du jour, avec son
   heure, sa glose et ses chiffres ; (2) ce que ça change, en clair ; (3) le reste du programme.
   L'ordre n'est pas cosmétique : le mail du dimanche ne reprend que les 3 premières phrases, donc
   le « pourquoi » doit passer AVANT la liste, sinon il saute. */
function descriptionJour(events, dowFr, opts) {
  const evs = (events || []).filter(Boolean);
  const dow = dowFr || '';
  if (!evs.length) return `Séance sans rendez-vous au calendrier : le ton viendra du flux d'actualité et des banques centrales.`;
  const ths = themesDuJour(evs);
  const suite = opts && opts.suite;
  const enSuite = !!(suite && suite.jour >= 2);
  // Sur une journée de suite, on mène avec ce qui est NEUF : sans cela la carte du lendemain
  // reproduisait la veille à la virgule près.
  const neuf = enSuite ? ths.find(x => x.lbl !== suite.lbl) : null;
  const tete = neuf || ths[0];
  const lead = (tete && tete.src) || evs[0];
  const devs = [...new Set(evs.map(e => e.currency).filter(Boolean))];
  const dev = (opts && opts.devise) || (lead && lead.currency) || devs[0] || 'le marché';
  const phrases = [];

  /* JOURNÉE À PLUSIEURS TÊTES D'AFFICHE (30/08, demande user : « il manque la RBNZ » sur un
     mercredi BoC + RBNZ, et « lorsqu'il y a plusieurs news importantes … simplifier et raccourcir »).
     Dès que deux rendez-vous de rang ≥ 8 partagent la journée, la description change de forme :
     UNE clause courte par tête d'affiche, à l'heure de Paris et dans l'ordre du jour, puis UN seul
     enjeu (celui de la première), puis le reste du programme en noms nus, sans glose. Le pavé de
     trois phrases sur un seul événement, qui taisait l'autre décision, ne s'applique plus ici. */
  const majeurs = enSuite ? [] : ths.filter(t => t.rang >= 8).slice(0, 3);
  if (majeurs.length >= 2) {
    const ordonnes = majeurs.slice().sort((a, b) => ((a.src && a.src.timestamp) || 0) - ((b.src && b.src.timestamp) || 0));
    phrases.push(`${_cap(dow) || 'Au programme'} : ` + ordonnes.map(t => {
      const hh = heureParis(t.src);
      return `${hh ? hh + ', ' : ''}${t.lbl}${chiffresEv(t.src)}`;
    }).join(' ; ') + '.');
    const enj = enjeuFr(ordonnes[0], (ordonnes[0].src && ordonnes[0].src.currency) || dev);
    if (enj) phrases.push(enj);
    const reste = evs.filter(e => !majeurs.some(t => t.src === e)).slice(0, 3);
    if (reste.length) phrases.push('Également au programme : ' + reste.map(e => nomEv(e)).join(' ; ') + '.');
    return phrases.join(' ');
  }

  const h = heureParis(lead), g = gloseEv(lead);
  if (enSuite && !neuf) {
    // La journée n'a que le rendez-vous en cours : on l'annonce par son rang, sans le renommer.
    phrases.push(`${_suiteTexte(suite)}${h ? `, à ${h}` : ''}${chiffresEv(lead)}.`);
    { const q = _suiteEnjeu(suite); phrases.push(q.charAt(0).toUpperCase() + q.slice(1)); }
  } else {
    phrases.push(`${_cap(dow) || 'Au programme'}${h ? `, ${h}` : ''} : ${nomEv(lead)}${g ? `, ${g}` : ''}${chiffresEv(lead)}.`);
    const enj = enjeuFr(tete, dev);
    if (enj) phrases.push(enj);
    if (enSuite) phrases.push(`${_suiteTexte(suite)} : ${_suiteEnjeu(suite)}`);
  }

  const _srcSuite = enSuite ? (ths.find(x => x.lbl === suite.lbl) || {}).src : null;
  const autres = evs.filter(e => e !== lead && e !== _srcSuite).slice(0, 3);
  if (autres.length) {
    phrases.push(`Également au programme : ` + autres.map(e => {
      const gg = gloseEv(e);
      return `${nomEv(e)}${gg ? `, ${gg}` : ''}`;
    }).join(' ; ') + '.');
  } else if (phrases.length < 2) {
    // Un symposium, un sommet ou une adjudication n'ont PAS de consensus : leur promettre un « écart
    // avec la prévision » était une phrase creuse posée sur une journée sans le moindre chiffre.
    phrases.push(evs.some(e => e.forecast)
      ? `Tout écart avec la prévision se verra immédiatement sur ${devs.slice(0, 3).join(', ') || 'le FX'}.`
      : `Aucun consensus chiffré sur ces rendez-vous : c'est leur contenu, et le ton employé, qui feront la réaction.`);
  }
  return phrases.join(' ');
}

// Jour CIVIL À PARIS d'un horodatage (YYYY-MM-DD). Un chiffre japonais publié à 01h30 à Paris est
// un événement du LENDEMAIN en UTC : sans cette conversion il se rangeait la veille — et un lundi
// matin asiatique tombait carrément un dimanche UTC, donc hors de la semaine ouvrée affichée.
function jourParis(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

module.exports = {
  GLOSES, SIGLES, sigleEv, codeEv, peutSEtaler, ETALABLE_RX, estDecisionTaux, DECISION_RX, FAMILLES, FAMILLES_CLES, familleValide, themeDeFamille, titreEstRepli, ADJ_PAYS, PAYS_COURT, CCY2PAYS, BANQUE, REVISION_RX, SECONDE_EST_RX,
  paysDe, paysCourt, adjectif, gloseFr, MAJEURS, poidsMajeur, themeJour, themesDuJour,
  titresDe, gloseEv, heureParis, nomEv, intituleAffiche, libelleCourt, chiffresEv, titreJour, enjeuFr, descriptionJour, jourParis,
};

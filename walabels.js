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
const CCY2PAYS = { USD: 'US', EUR: 'EU', GBP: 'GB', JPY: 'JP', AUD: 'AU', NZD: 'NZ', CAD: 'CA', CHF: 'CH', CNY: 'CN', CNH: 'CN' };
/* Nom COURT du pays, pour les bandeaux où l'adjectif est trop long (« inflation France » plutôt que
   « CPI français »). Même principe que ADJ_PAYS : le pays d'origine prime sur la devise. */
const PAYS_COURT = {
  US: 'US', GB: 'UK', JP: 'Japon', AU: 'Australie', NZ: 'NZ', CA: 'Canada', CH: 'Suisse', CN: 'Chine',
  EU: 'zone euro', DE: 'Allemagne', FR: 'France', IT: 'Italie', ES: 'Espagne', NL: 'Pays-Bas',
  PT: 'Portugal', GR: 'Grèce', IE: 'Irlande', BE: 'Belgique', AT: 'Autriche', FI: 'Finlande',
};
const BANQUE = { USD: 'Fed', EUR: 'BCE', GBP: 'BoE', JPY: 'BoJ', AUD: 'RBA', NZD: 'RBNZ', CAD: 'BoC', CHF: 'BNS', CNY: 'PBoC', CNH: 'PBoC' };

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
  [/monetary policy (?:report|statement|summary)/i, "le rapport dans lequel la banque centrale expose sa feuille de route"],
  [/rate decision|interest rate decision|rate statement|cash rate|\bocr\b|bank rate|refinancing rate|deposit facility/i, "la banque centrale annonce son taux directeur"],
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
  [/jobless claims|initial claims|continuing claims/i, "les nouvelles inscriptions au chômage de la semaine"],
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
  [/retail inventories|business inventories/i, "les stocks des entreprises, un signal avancé sur la production à venir"],
  [/\bspeech\b|\bspeaks\b|testimony|humphrey[-\s]?hawkins/i, "un discours de banquier central : c'est le ton employé qui compte"],
];
function gloseFr(titre) {
  const t = String(titre || '');
  if (!t) return '';
  if (REVISION_RX.test(t)) {
    // La glose DIT que c'est une correction : c'est exactement l'information qui manquait le 28 août.
    if (/non[-\s]?farm|nonfarm|\bnfp\b/i.test(t)) return "une correction annuelle des créations d'emplois DÉJÀ publiées, pas le rapport mensuel";
    return "une correction de chiffres déjà publiés";
  }
  for (const [rx, g] of GLOSES) if (rx.test(t)) return g;
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

/* THÈMES DE JOUR. `rang` = poids éditorial ; il décide du titre ET de l'événement mis en avant dans
   la description. Un thème porte TOUJOURS `src`, l'événement du calendrier dont il est issu — c'est
   ce lien qui garantit qu'aucun titre ne peut nommer un rendez-vous absent de la carte. */
function themeJour(e) {
  const raw = String((e && e.title) || '');
  if (!raw) return null;
  const t = ' ' + raw.toLowerCase() + ' ';
  const c = String((e && e.currency) || '').toUpperCase();
  const rev = REVISION_RX.test(raw);
  const est2 = SECONDE_EST_RX.test(raw);
  const adj = g => adjectif(e, g);
  const out = (lbl, rang) => ({ lbl, rang: rev ? 1 : (est2 ? Math.max(1.5, rang - 3) : rang), src: e });

  if (/jackson hole/.test(t)) return out('Jackson Hole', 9.5);
  if (/symposium|sintra|central bank forum/.test(t)) return out('Symposium des banquiers centraux', 9.4);
  if (/rate decision|interest rate decision|rate statement|cash rate|\bocr\b|bank rate|refinancing rate|deposit facility/.test(t)) {
    const b = BANQUE[c]; return b ? out('Décision de la ' + b, 9) : null;
  }
  if (/meeting minutes|monetary policy meeting accounts/.test(t)) { const b = BANQUE[c]; return b ? out('Minutes de la ' + b, 6.5) : null; }
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
  if (/personal spending|consumer spending/.test(t)) return out('Dépenses des ménages' + adj(3), 3.5);
  if (/industrial production|manufacturing production/.test(t)) return out('Production industrielle' + adj(1), 2.6);
  if (/unemployment|jobless|employment change|labou?r market|\bjobs\b|hourly earnings|average earnings/.test(t)) return out('Emploi' + adj(0), 3);
  if (/trade balance|balance of trade/.test(t)) return out('Balance commerciale' + adj(1), 2);
  if (/\bpmi\b|purchasing managers|\bism\b/.test(t)) return out('PMI' + adj(0), 2);
  if (/business climate|\bifo\b|business confidence|\bzew\b|tankan/.test(t)) return out('Moral des entreprises' + adj(2), 2);
  if (/building permits|housing starts|home sales|house price|mortgage/.test(t)) return out('Immobilier' + adj(0), 1.9);
  if (/crude oil inventories/.test(t)) return out('Stocks de pétrole' + adj(3), 1.7);
  if (/consumer confidence|consumer sentiment|consumer climate/.test(t)) return out('Confiance des ménages' + adj(3), 1.8);
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
  ths.sort((a, b) => b.rang - a.rang);
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
  const pays = paysDe(e);
  if (base && pays && pays !== 'EU' && String((e && e.currency) || '').toUpperCase() === 'EUR') {
    const court = PAYS_COURT[pays];
    if (court) return `${base} (${court})`;
  }
  return base;
}
function intituleAffiche(e) {
  const t = String((e && e.title) || '').replace(/\s+/g, ' ').trim();
  const pays = paysDe(e);
  if (t && pays && pays !== 'EU' && String((e && e.currency) || '').toUpperCase() === 'EUR') {
    const court = PAYS_COURT[pays];
    if (court) return `${t} (${court})`;
  }
  return t;
}
function chiffresEv(e) {
  if (!e) return '';
  if (e.forecast) return ` (prév. ${e.forecast}${e.previous ? `, préc. ${e.previous}` : ''})`;
  return e.previous ? ` (préc. ${e.previous})` : '';
}

/* TITRE DU JOUR. Un rendez-vous de rang ≥ 8 (décision de taux, Jackson Hole, NFP, Powell) EST
   l'histoire du jour : il tient le titre SEUL — coller un second thème derrière ne fait que diluer.
   En dessous, deux thèmes au plus, joints par « + ». Repli : les intitulés bruts, comme avant. */
function titreJour(events, dowFr) {
  const ths = themesDuJour(events);
  if (ths.length) {
    const gardes = ths[0].rang >= 8 ? [ths[0]] : ths.slice(0, 2);
    return gardes.map(x => x.lbl).join(' + ');
  }
  const bruts = (events || []).slice(0, 3).map(nomEv).filter(Boolean);
  return bruts.length ? bruts.join(' · ') : `Séance calme ${dowFr || ''}`.trim();
}

/* ENJEU — « et alors ? », en français de tous les jours. Il est calé sur l'événement RÉELLEMENT mis
   en avant (le `src` du thème de tête), plus sur un thème pioché ailleurs dans la journée : c'est ce
   décalage qui faisait parler du PIB sous une liste d'inflation et de dépenses des ménages. */
function enjeuFr(theme, dev) {
  const l = (theme && theme.lbl) || '';
  const d = dev || 'la devise';
  if (/^Jackson Hole|^Symposium/.test(l)) return `C'est le rendez-vous où les banques centrales annoncent la couleur pour les mois qui viennent : une phrase sur le rythme des baisses de taux suffit à faire bouger ${d} et les marchés actions.`;
  if (/^Décision de la /.test(l)) return `L'essentiel n'est pas le taux annoncé, qui est déjà anticipé, mais le communiqué : s'il laisse entendre que d'autres mouvements suivront, ${d} réagit tout de suite.`;
  if (/^Minutes de la /.test(l)) return `Les minutes racontent le débat qui a eu lieu autour de la table : un comité plus divisé, ou plus ferme, qu'on ne le croyait, et le marché révise sa trajectoire de taux.`;
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
  const lead = (ths[0] && ths[0].src) || evs[0];
  const devs = [...new Set(evs.map(e => e.currency).filter(Boolean))];
  const dev = (opts && opts.devise) || (lead && lead.currency) || devs[0] || 'le marché';
  const phrases = [];

  const h = heureParis(lead), g = gloseFr(lead.title);
  phrases.push(`${_cap(dow) || 'Au programme'}${h ? `, ${h}` : ''} : ${nomEv(lead)}${g ? `, ${g}` : ''}${chiffresEv(lead)}.`);

  const enj = enjeuFr(ths[0], dev);
  if (enj) phrases.push(enj);

  const autres = evs.filter(e => e !== lead).slice(0, 3);
  if (autres.length) {
    phrases.push(`Également au programme : ` + autres.map(e => {
      const gg = gloseFr(e.title);
      return `${nomEv(e)}${gg ? `, ${gg}` : ''}`;
    }).join(' ; ') + '.');
  } else if (!enj) {
    phrases.push(`Tout écart avec la prévision se verra immédiatement sur ${devs.slice(0, 3).join(', ') || 'le FX'}.`);
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
  ADJ_PAYS, PAYS_COURT, CCY2PAYS, BANQUE, REVISION_RX, SECONDE_EST_RX,
  paysDe, paysCourt, adjectif, gloseFr, MAJEURS, poidsMajeur, themeJour, themesDuJour,
  heureParis, nomEv, intituleAffiche, chiffresEv, titreJour, enjeuFr, descriptionJour, jourParis,
};

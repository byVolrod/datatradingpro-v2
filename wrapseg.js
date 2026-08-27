'use strict';
/**
 * wrapseg.js — LE RAPPORT DE SÉANCE, MIS EN PAGE.
 *
 * C'est CE rendu que l'utilisateur lit dans le lecteur de rapports d'analystes : le récap de séance
 * segmenté en rubriques (Géopolitique · Macro · Analyse de séance · À surveiller). L'IA fournit les
 * sections ; TOUT le reste — l'ordre, le classement par famille, la complétion par notre calendrier,
 * l'anti-doublon, le HTML — est fait ICI, de façon déterministe.
 *
 * Séparé de server.js pour une seule raison : ce module est PUR, donc éprouvable ligne à ligne
 * (scripts/seance-verif.js). Un rapport faux se voit désormais en test, plus en production.
 */
const _SEA = require('./seance');
const _WA  = require('./walabels');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const estMacro = sec => /^macro$/i.test(String((sec && sec.section) || '').trim());

/* L'HEURE DE PARIS, celle du desk. Un chiffre daté de son heure UTC dans un rapport français fait
   douter de toutes les autres heures de la page. */
function heureParis(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h');
}

/* « enlève le terme source met directement » (26/08, capture : « Sources BCE : les décideurs sont
   prêts à augmenter les taux en septembre → … »). Un desk NOMME sa source, il ne l'annonce pas :
   « **BCE** : … » dit la même chose en deux mots de moins, et c'est le style de toutes les autres
   puces. La règle est DÉTERMINISTE — la consigne est aussi dans le prompt, mais on ne compte pas
   sur la mémoire du modèle pour une règle de style : on corrige à la sortie.
   ELLE N'AGIT QUE SUR UN VRAI « Sources X : … » : il faut le deux-points, et ce qui le précède doit
   ressembler à un NOM D'INSTITUTION (majuscule initiale, trois mots au plus). Sans cette preuve,
   « Sources d'énergie renouvelables en hausse » perdrait son sujet, et « Source proche de la BCE :
   … » perdrait la BCE — le mot y porte l'information, il n'est pas un tic de rédaction. */
const _SRC_GRAS = /^\s*\*\*\s*[Ss]ources?\s*\*\*\s*/;              // « **Sources** … »
const _SRC_NU   = /^\s*[Ss]ources?\s*/;                            // « Sources … »
// Un nom d'institution : un mot capitalisé, puis jusqu'à trois mots capitalisés OU de liaison
// (« Banque de France », « Bank of England »). Le premier mot DOIT porter la majuscule — c'est ce
// qui distingue « Sources BCE : … » de « Source proche de la BCE : … », où le mot porte l'info.
const _SRC_INST = /^(\*{0,2}[A-ZÀ-Þ][\wÀ-ÿ&.'’-]*(?:\s+(?:[A-ZÀ-Þ][\wÀ-ÿ&.'’-]*|de|du|des|la|le|les|of|and|et|d['’])){0,3}\*{0,2})?\s*[:：]\s+/;
/* ══ AUCUNE SOURCE DANS LE CORPS D'UNE PUCE (03/09, capture : « BoJ : la Banque du Japon devrait
   relever son taux à 1,25 % en septembre · Sondage Reuters → renforcement du yen ») ═══════════════
   Demande : « dans les récaps de l'onglet analystes ne met pas les sources d'où ça provient ». Même
   intention que le 30/08 sur les rapports d'institution — le lecteur paie une lecture, pas un
   annuaire de dépêches, et une attribution au milieu d'une phrase lui apprend seulement où aller
   lire ailleurs.
   La règle du 26/08 (`sansSource`) ne voyait que le « Sources X : … » EN TÊTE de puce. Celle-ci
   agit dans le CORPS, et seulement sur une vraie ATTRIBUTION : il faut un séparateur (« · », tiret,
   parenthèse) ou un mot d'attribution (selon, d'après, sondage…) devant le nom du média.
   ⚠️ UN MÉDIA SUJET DE LA PHRASE N'EST JAMAIS RETIRÉ. « Reuters rapporte que… » perdrait son sujet
   et la phrase deviendrait bancale : on ne retire que ce qui est grammaticalement détachable. C'est
   la même prudence que pour « Source proche de la BCE », où le mot porte l'information. */
const _MEDIAS = '(?:Reuters|RTRS|Bloomberg|BBG|Nikkei(?: Asia)?|Kyodo|Jiji|Yonhap|MNI|Dow Jones|WSJ|Wall Street Journal|FT|Financial Times|CNBC|BBC|AFP|AP|Xinhua|TASS|Interfax|Politico|Axios|Semafor|Handelsblatt|Econostream|LSEG|S&P Global|MarketWatch|Investing\\.com|FXStreet|Forex ?Live|SCMP|Caixin|Global Times|Anadolu|Sky News|The Telegraph|Telegraph|The Guardian|Guardian|Barron\'?s|Il Sole(?: 24 Ore)?|Expansi[óo]n|Cinco D[íi]as)';
const _ATTRIB = '(?:sondage|enqu[êe]te|[ée]tude|rapport|source|sources|selon|d[\'’]apr[èe]s|via)';
function sansMedia(t) {
  let s = String(t == null ? '' : t);
  // 1) Segment détaché par un séparateur : « … · Sondage Reuters → … », « … — Reuters, … ».
  s = s.replace(new RegExp('\\s*[·|•]\\s*(?:' + _ATTRIB + '\\s+)?' + _MEDIAS + '\\b\\.?', 'gi'), '');
  s = s.replace(new RegExp('\\s*[–—]\\s*(?:' + _ATTRIB + '\\s+)?' + _MEDIAS + '\\b\\.?(?=\\s*(?:[→·|•]|$))', 'gi'), '');
  // 2) Entre parenthèses : « … (Reuters) », « … (selon Bloomberg) ».
  s = s.replace(new RegExp('\\s*\\(\\s*(?:' + _ATTRIB + '\\s+)?' + _MEDIAS + '\\s*\\)', 'gi'), '');
  // 3) Attribution en toutes lettres : « …, selon Reuters », « d\'après Bloomberg ».
  s = s.replace(new RegExp('[,;]?\\s*\\b(?:selon|d[\'’]apr[èe]s)\\s+' + _MEDIAS + '\\b[,;]?', 'gi'), '');
  // Recollage : deux séparateurs devenus voisins, un séparateur en fin, un espace avant la ponctuation.
  return s.replace(/\s*([·|•])\s*\1/g, ' $1 ')
    .replace(/\s*[·|•–—]\s*(?=(?:→|$))/g, ' ')
    .replace(/\s*[·|•]\s*$/, '')
    /* ⚠️ SEULS LE POINT ET LA VIRGULE PERDENT L'ESPACE QUI LES PRÉCÈDE. En français, le deux-points,
       le point-virgule, le point d'exclamation et celui d'interrogation en PRENNENT un : recoller
       « BoJ : » en « BoJ: » sur toutes les puces du rapport aurait été une faute de typographie
       introduite par un correctif de source. */
    .replace(/\s+([.,])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sansSource(t) {
  const s = sansMedia(t);
  const tete = _SRC_GRAS.exec(s) || _SRC_NU.exec(s);
  if (!tete) return s;
  const reste = s.slice(tete[0].length);
  const m = _SRC_INST.exec(reste);
  if (!m) return s;                             // pas un « Sources X : … » → on ne touche à rien
  const r = reste.slice(m[0].length);
  if (!r) return s;                             // rien derrière : mieux vaut la puce telle quelle
  if (m[1]) return m[1] + ' : ' + r;            // l'institution reste, et devient le sujet de la puce
  return /^[a-zà-ÿ]/.test(r) ? r.charAt(0).toUpperCase() + r.slice(1) : r;
}

/* CE QUE NOTRE CALENDRIER AJOUTE À LA RUBRIQUE MACRO (26/08 : « check les news sorties durant la
   session, classe les dans leur catégories de la partie macro »). L'IA ne peut restituer que ce que
   l'article contenait ; notre calendrier, lui, sait ce qui est RÉELLEMENT tombé pendant la fenêtre
   de la séance. On ajoute ce qui manque — chiffré, au format du desk. Rien n'est inventé : chaque
   ligne vient d'une publication du calendrier AVEC son résultat. Ce qui est déjà raconté par l'IA
   n'est jamais répété (_SEA.dejaDit). */
/* ══ L'INTITULÉ VIENT DU CALENDRIER, LA LECTURE VIENT DU MODÈLE (27/08) ═══════════════════════════
   Demande du propriétaire, capture à l'appui : « au lieu de mettre "Dépenses des ménages
   australiens", mets le nom de la news direct, genre RBA Bulletin ». C'est la règle que le projet a
   déjà tranchée pour Semaine à Venir (v29) : un intitulé thématique français explique au mauvais
   endroit — « Moral des entreprises allemandes » ne se retrouve dans aucun calendrier, alors qu'Ifo
   se reconnaît tout de suite. Le titre doit SITUER et se retrouver dans le calendrier ; la glose,
   elle, a sa place dans la phrase.

   CE QUI CHANGE ICI. Jusqu'ici, quand le modèle avait déjà parlé d'une publication, NOTRE ligne
   était abandonnée au profit de la sienne. On fait l'inverse, et pour une raison plus forte que le
   vocabulaire : notre ligne est TIRÉE DU CALENDRIER — intitulé exact, heure exacte, réel, attendu,
   précédent — quand la sienne est une reformulation, qui peut se tromper de nom, de chiffre ou de
   banque centrale. Les faits viennent donc de nous, et du modèle on ne garde que ce qu'il apporte
   vraiment : la CONSÉQUENCE, ce qui suit la flèche.

   ⚠️ ET LA CONSÉQUENCE GREFFÉE REPASSE PAR LE VERROU DE COHÉRENCE. Sans quoi on prendrait une ligne
   irréprochable et on lui recollerait « → pricing de la réunion RBA » sur un chiffre américain :
   la faute du 27/08, réintroduite par sa propre correction. Si la greffe ne tient pas, on garde les
   faits, seuls — mieux vaut une ligne sans lecture qu'une lecture fausse. */
/* ⚠️ ET L'ARBITRAGE NE VAUT QUE SUR LES CHIFFRES (27/08, régression MESURÉE le jour même). Le
   raisonnement ci-dessus est juste pour une PUBLICATION : le calendrier redit mieux les nombres que
   le modèle. Il est DESTRUCTEUR pour un DISCOURS, un BULLETIN ou un CONGRÈS — c'est-à-dire pour
   exactement ce que le correctif de la veille venait de faire entrer dans la fenêtre. Dans une puce
   sur un discours, TOUT le contenu est EN AMONT de la flèche :

       entrée  « **BoJ (Himino)** : la sortie de la politique accommodante sera graduelle,
                 pas de hausse avant décembre → **JPY** ferme »
       sortie  « 03h00 **JPY** · **BoJ Himino Speech** → **JPY** ferme »

   Tout ce que Himino a DIT était effacé, et il ne restait qu'une grille de programme : le récap
   portait ses rendez-vous et avait perdu ce qu'il en disait. La règle se dit donc en une phrase :
   LE CALENDRIER POSSÈDE TOUJOURS L'IDENTITÉ — nom exact, heure exacte —, il ne possède les FAITS
   que lorsqu'il en a. Quand il n'a pas de chiffre, les faits sont dans le corps de la puce, et
   c'est le corps qu'on greffe, pas seulement l'aval de la flèche. */
const _APRES_FLECHE = (t) => { const i = String(t || '').indexOf('→'); return i < 0 ? '' : String(t).slice(i + 1).trim(); };
/* Le corps de la puce : son intitulé en gras retiré, et le séparateur qui le suivait avec lui. On
   ne retire QUE le gras de tête — « **BoJ (Himino)** : la sortie… » donne « la sortie… », tandis
   qu'une puce sans gras de tête est rendue telle quelle. */
const _APRES_TITRE = (t) => String(t || '').replace(/^\s*\*\*[^*]{1,60}\*\*\s*[:·—–-]?\s*/, '').trim();
/* Le calendrier a-t-il de quoi parler, ou seulement de quoi nommer ? `ligneMacroMd` ne rend des
   colonnes de valeurs que s'il y a un chiffre ; on interroge donc l'événement, pas la ligne. */
const _PORTE_UN_CHIFFRE = (e) => !!String((e && e.actual) || '').trim() || !!String((e && e.previous) || '').trim();
function completerMacro(items, macroCal) {
  const brutes = (items || []).map(i => sansSource(i));
  const entrees = brutes.map(i => ({ titre: i, ligne: i }));
  let ajouts = 0, reformules = 0;
  for (const e of (macroCal || [])) {
    const titre = _WA.intituleAffiche(e);
    const ligne = _SEA.ligneMacroMd({ currency: e.currency, ctry: e.ctry, title: titre, actual: e.actual, forecast: e.forecast, previous: e.previous, impact: e.impact }, heureParis(e.timestamp));
    if (!ligne) continue;
    // Le modèle en a-t-il déjà parlé ? Alors c'est SA ligne qu'on remplace, à SA place.
    const k = brutes.findIndex(t => _SEA.dejaDit(e, [t]));
    if (k >= 0) {
      /* CHIFFRÉ : le calendrier redit les faits mieux que le modèle, on ne garde que la lecture.
         NON CHIFFRÉ : le calendrier n'a que le nom et l'heure, la matière est dans le corps. */
      const chiffre = _PORTE_UN_CHIFFRE(e);
      const suite = chiffre ? _APRES_FLECHE(brutes[k]) : _APRES_TITRE(brutes[k]);
      const compose = !suite ? ligne : ligne + (chiffre ? ' → ' : ' : ') + suite;
      entrees[k] = { titre, ligne: pricingIncoherent(compose) ? ligne : compose, _cal: true };
      reformules++;
      continue;
    }
    entrees.push({ titre, ligne, _cal: true });
    ajouts++;
  }
  return { entrees, ajouts, reformules };
}

/* LA RUBRIQUE MACRO EXISTE DÈS QUE LE CALENDRIER A DES CHIFFRES. Si l'article ne parlait d'aucune
   donnée, l'IA n'a pas produit de rubrique Macro — et la séance la plus chargée en publications
   serait justement celle qui n'en montrerait aucune. On la crée alors à sa place canonique : après
   Géopolitique, sinon après le LEAD, jamais en fin de rapport. */
function poserMacro(arr, macroCal) {
  const out = (arr || []).slice();
  if (!(macroCal || []).length || out.some(estMacro)) return out;
  // Géopolitique D'ABORD : `findIndex` sur une alternative rendait le LEAD, toujours en tête, et
  // plaçait la Macro AVANT la Géopolitique — l'ordre des rubriques du Récap Quotidien est fixe.
  // Le repli couvre les DEUX noms de la rubrique d'ouverture : « Synthèse » aujourd'hui, « LEAD »
  // dans les rapports déjà en cache. Sans le second, une Macro créée de toutes pièces se serait
  // glissée AVANT la synthèse sur ces rapports-là.
  const ou = t => out.findIndex(x => x && t.test(String(x.section || '').trim()));
  let i = ou(/^g[ée]opolitique$/i);
  if (i < 0) i = ou(/^(?:synth[èe]se|lead)$/i);
  out.splice(i < 0 ? out.length : i + 1, 0, { section: 'Macro', items: [] });
  return out;
}

/* « À SURVEILLER » PORTE LE CALENDRIER DE LA SÉANCE SUIVANTE (26/08 : « met le calendrier des
   prochaines news de la prochaine session »). L'IA n'y met que ce que l'article laissait deviner —
   « la réaction continue du marché aux rumeurs », « les prochaines déclarations de la Fed » : du
   prospectif sans heure ni chiffre, donc inactionnable. Le calendrier, lui, sait ce qui tombe et
   quand. Ses lignes viennent EN TÊTE de la rubrique : une échéance datée passe avant un fil ouvert.
   La rubrique est CRÉÉE si elle manque, et en DERNIER — c'est sa place canonique, le rapport doit
   se terminer dessus. */
const estSurv = sec => /^[àa] surveiller$/i.test(String((sec && sec.section) || '').trim());
function poserSurveiller(arr, surv) {
  const out = (arr || []).slice();
  if (!surv || !(surv.lignes || []).length || out.some(estSurv)) return out;
  out.push({ section: 'À surveiller', items: [] });
  return out;
}
function completerSurveiller(items, surv) {
  const lignes = (surv && surv.lignes) || [];
  if (!lignes.length) return (items || []).map(String);
  // Un intitulé de séance en tête : le lecteur sait de QUELLE fenêtre on parle sans avoir à deviner.
  const tete = surv.nom ? [`**Séance de ${surv.nom}** — le calendrier :`] : [];
  return tete.concat(lignes.map(String), (items || []).map(String));
}
/* CE QUI N'EST PAS DANS LE TABLEAU S'APPELLE « AUTRES », ET RIEN N'Y EST DIT DEUX FOIS (30/08,
   capture à l'appui : « corrige ça c'est collé au calendrier, vérifie s'ils ne sont pas dans le
   calendrier en dessous, et si c'est pas [le cas] alors mets Autres et tu les classes dedans »).
   Sous le tableau, trois puces arrivaient NUES — résultats Nvidia, indicateur PCE de la Fed,
   discours de Warsh — collées à la dernière ligne du calendrier, sans intitulé et sans respiration.
   Deux défauts en un, et le second est le vrai : un lecteur ne sait pas si ces lignes commentent le
   tableau ou parlent d'autre chose. C'est la même règle que la Macro et l'Analyse de séance, qui la
   respectent déjà : AUCUNE PUCE SANS SON INTITULÉ.
   Et avant de les intituler, on les DÉDOUBLONNE. Une puce qui redit un rendez-vous déjà listé
   au-dessus n'est pas un « autre » sujet, c'est une répétition — c'est même le défaut que la
   rubrique du Récap Quotidien a déjà connu (les puces narratives y paraphrasaient le tableau, elles
   ont été retirées le 24/08). On réutilise `_SEA.dejaDit`, écrit pour exactement cette question et
   déjà éprouvé : le pays tranche d'abord, puis un sigle distinctif (PCE, CPI, ISM…), puis deux mots
   utiles en commun — le calendrier étant en anglais et les puces en français, la comparaison passe
   par un vocabulaire commun.
   ⚠️ CE QUI RESTE PEUT ÊTRE VIDE, et c'est un bon résultat : si tout ce que la rédaction a relevé
   figure déjà au calendrier, la rubrique s'arrête sur le tableau. Mieux vaut pas d'« Autres » qu'un
   « Autres » qui répète la ligne du dessus. */
/* ══ « À SURVEILLER » NE PEUT PLUS AFFIRMER N'IMPORTE QUOI (27/08) ═══════════════════════════════
   Signalement client, capture à l'appui : « y a un petit bug sur le CPI US, il kiffe s'incruster
   partout ». Sous le calendrier d'une séance de LONDRES — trois publications de la zone euro —
   figurait la puce :

       « **CPI** US demain → catalyseur du pricing de la réunion **RBA** »

   Un chiffre d'inflation AMÉRICAIN ne price pas une réunion de la banque centrale AUSTRALIENNE.
   La puce est fausse par construction, et elle revenait d'un récap à l'autre.

   DEUX CAUSES, ET IL FAUT LES DEUX POUR QUE ÇA S'ARRÊTE.
   1. LE PROMPT SE FAISAIT RECOPIER. Son squelette JSON de réponse portait, en exemple, la puce
      « **CPI** US demain → catalyseur du pricing de la réunion Fed ». Quand une séance ne donne
      rien de prospectif, un modèle recopie ce qu'il a sous les yeux — en substituant parfois la
      banque croisée dans la séance, d'où le RBA. Traité côté serveur : l'exemple ne porte plus de
      faits, seulement une forme entre chevrons.
   2. RIEN NE RELISAIT LA SORTIE. L'anti-doublon posé le 30/08 ne compare qu'au tableau ; aucun CPI
      américain ne figurant au calendrier de Londres, la puce n'était pas un doublon — et passait.

   CE QUE FAIT LE VERROU, ET CE QU'IL SE REFUSE À FAIRE. Il écarte une puce qui affirme qu'un sujet
   d'une devise price la réunion d'une banque centrale d'une AUTRE devise. Il ne la RÉPARE pas en
   corrigeant le nom de la banque, et c'est délibéré : quand la puce est une recopie d'exemple,
   l'événement lui-même est inventé — lui remettre la bonne banque rendrait crédible une échéance
   qui n'existe pas. Ici, le module ne reçoit que le calendrier de la séance SUIVANTE
   (`surv.evs`) : il ne peut pas vérifier « demain ». On écarte donc ce qu'on sait faux plutôt que
   d'affirmer ce qu'on ne peut pas vérifier. Le prix est assumé : on perd parfois la mention d'une
   échéance réelle, et on ne publie jamais une causalité fausse — dans un produit payé pour sa
   fiabilité, ce sens-là est le bon.

   ⚠️ TROIS GARDES CONTRE LE FAUX POSITIF, car supprimer une puce légitime est un défaut, pas une
   précaution — la note du 30/08 tient explicitement à ce que Jackson Hole et les résultats Nvidia
   RESTENT :
     · on n'agit que sur une puce qui porte une FLÈCHE, seule à séparer le sujet de son affirmation ;
     · l'affirmation doit nommer une RÉUNION / un PRICING / une DÉCISION — pas n'importe quelle
       mention de banque centrale (« la **Fed** reste attentive » n'affirme aucun lien de causalité) ;
     · le SUJET doit porter lui-même une devise. « Discours de Warsh à Jackson Hole → catalyseur du
       pricing de la réunion **Fed** » n'en nomme aucune : le verrou ne se prononce pas, la puce
       reste. C'est exactement la puce voisine de la capture, et elle est juste. */
const _BANQUES_CCY = [
  [/\bfed\b|\bfomc\b|r[ée]serve f[ée]d[ée]rale/i, 'USD'],
  [/\bbce\b|\becb\b|banque centrale europ[ée]enne/i, 'EUR'],
  [/\bboe\b|bank of england|banque d['’]angleterre/i, 'GBP'],
  [/\bboj\b|bank of japan|banque du japon/i, 'JPY'],
  [/\bboc\b|bank of canada|banque du canada/i, 'CAD'],
  [/\brba\b|reserve bank of australia|banque de r[ée]serve d['’]australie/i, 'AUD'],
  [/\brbnz\b|reserve bank of new zealand|banque de r[ée]serve de nouvelle-z[ée]lande/i, 'NZD'],
  [/\bbns\b|\bsnb\b|banque nationale suisse/i, 'CHF'],
  [/\bpboc\b|banque populaire de chine/i, 'CNY'],
];
/* Le SUJET d'une puce, ramené à une devise. Volontairement resserré : un motif trop large ferait
   écarter des puces justes, ce qui coûte plus cher que d'en laisser passer une fausse de temps en
   temps. Les sigles d'indicateurs propres à un pays (NFP, ISM, PCE, Ifo, ZEW, Tankan) valent
   identité — ils ne sont publiés nulle part ailleurs. */
const _SUJETS_CCY = [
  /* ⚠️ LE PLURIEL MASCULIN DES ADJECTIFS EN -IEN NE DOUBLE PAS LE N. « canadienne?s? » reconnaît
     « canadienne » et « canadiennes », jamais « canadiens » — et c'est la forme la plus courante
     dans une puce (« chiffres canadiens »). Le défaut a été pris au banc, pas en relecture :
     « Chiffres canadiens → décision de la **RBNZ** » passait à travers le verrou. D'où
     « (?:ne)?s? » pour toute cette famille : canadien, australien, européen, italien. */
  [/\bUSD\b|\bUS\b|am[ée]ricaine?s?\b|[ée]tats-unis|\bNFP\b|\bISM\b|\bPCE\b|\bJOLTS\b/i, 'USD'],
  [/\bEUR\b|zone euro|europ[ée]en(?:ne)?s?\b|allemande?s?\b|fran[çc]aise?s?\b|espagnole?s?\b|italien(?:ne)?s?\b|\bIfo\b|\bZEW\b/i, 'EUR'],
  [/\bGBP\b|britanniques?\b|royaume-uni|\bUK\b/i, 'GBP'],
  [/\bJPY\b|japonaise?s?\b|\bTankan\b/i, 'JPY'],
  [/\bCAD\b|canadien(?:ne)?s?\b/i, 'CAD'],
  [/\bAUD\b|australien(?:ne)?s?\b/i, 'AUD'],
  [/\bNZD\b|n[ée]o-z[ée]landaise?s?\b/i, 'NZD'],
  [/\bCHF\b|suisses?\b/i, 'CHF'],
  [/\bCNY\b|chinoise?s?\b/i, 'CNY'],
];
/* ⚠️ LA v26 N'A TENU QUE SUR LA PHRASE EXACTE DE LA CAPTURE (27/08, seconde passe). Le prédicat
   exigeait littéralement « réunion | pricing | décision | meeting » ET la flèche typographique. Le
   propos absurde survit à toutes ses reformulations, et huit d'entre elles ont été MESURÉES en
   production simulée — publiées, toutes :
       « **CPI** US demain → **RBA** en ligne de mire »
       « … → pèse sur la trajectoire de taux de la **RBA** »
       « … → oriente les attentes de baisse de la **RBA** »
       « … → le comité de politique monétaire de la **RBA** en tiendra compte »
       « … → le marché revoit ses paris sur la **RBA** »
       « **NFP** US demain → la **BoJ** doit trancher son taux directeur »
       « … -> catalyseur du pricing de la réunion **RBA** »        (flèche ASCII)
       « **CPI** US demain, catalyseur du pricing de la réunion de la **RBA**. »   (sans flèche)
   Un verrou qui ne connaît qu'une tournure n'est pas un verrou, c'est un filtre anti-doublon.
   On raisonne donc sur ce que la phrase AFFIRME, et non sur les mots qu'elle emploie. */
const _ATTRIBUTION_RX  = /catalyseur|d[ée]termin|conditionne|dicte|scelle|arbitre|pricing|repricing|paris\s+(?:sur|de|du)|attentes?\s+(?:de|d['’])|trajectoire\s+de\s+taux|en\s+ligne\s+de\s+mire|taux\s+directeur|d[ée]cision\s+de\s+taux|politique\s+mon[ée]taire/i;
/* La mention nue d'une réunion vaut affirmation… SAUF quand elle n'est qu'une concomitance. « la
   **RBA** sous pression AVANT sa réunion » situe dans le temps, elle n'affirme aucune causalité :
   c'était un faux positif mesuré de la v26, et supprimer une lecture juste est un défaut. */
const _REUNION_RX      = /r[ée]union|d[ée]cision|meeting|comit[ée]/i;
const _CONCOMITANCE_RX = /\b(?:avant|[àa]\s+l['’]approche|en\s+amont|d['’]ici|veille\s+de|en\s+attendant)\b/i;
const _FLECHE_RX       = /→|⇒|➔|->|=>/;

/* La césure entre le SUJET et ce qu'on en AFFIRME. La flèche d'abord — c'est le style de la
   maison ; à défaut, le mot d'attribution lui-même fait la coupure, car « **CPI** US demain,
   catalyseur du pricing de la réunion **RBA** » dit exactement la même chose sans flèche. */
function _coupe(t) {
  const f = t.search(_FLECHE_RX);
  if (f >= 0) return [t.slice(0, f), t.slice(f + 1)];
  const a = t.search(_ATTRIBUTION_RX);
  if (a > 0) return [t.slice(0, a), t.slice(a)];
  return null;
}
function pricingIncoherent(txt) {
  const t = String(txt || '');
  const p = _coupe(t);
  if (!p) return false;
  const [avant, apres] = p;
  const bq = (_BANQUES_CCY.find(([rx]) => rx.test(apres)) || [])[1];
  if (!bq) return false;                       // aucune banque nommée → rien à contredire
  const affirme = _ATTRIBUTION_RX.test(apres) || (_REUNION_RX.test(apres) && !_CONCOMITANCE_RX.test(apres));
  if (!affirme) return false;
  /* GARDE CONTRE UN FAUX POSITIF MESURÉ : si l'AVAL porte son propre sujet, accordé à la banque, la
     puce se justifie toute seule. « **AUD** chute → le **CPI** US chaud repousse la décision de la
     **Fed** » est une lecture JUSTE — le sujet du lien est en aval, pas en amont ; ce qui est en
     amont n'est que le mouvement observé. La v26 l'écartait. */
  const suAval = (_SUJETS_CCY.find(([rx]) => rx.test(apres)) || [])[1];
  if (suAval && suAval === bq) return false;
  const su = (_SUJETS_CCY.find(([rx]) => rx.test(avant)) || [])[1];
  if (!su) return false;                       // sujet sans devise (Jackson Hole, Nvidia) → on ne juge pas
  return su !== bq;
}

/* Une puce ENTIÈREMENT entre chevrons est le gabarit du prompt recopié tel quel — jamais du texte
   rédigé. Le motif exige les chevrons aux DEUX bouts : « CPI <0,2% attendu » garde les siens. */
const _EST_GABARIT_RX = /^\s*<[^<>]*>\s*$/;
/* ⚠️ ET LES EMPLACEMENTS ATTEIGNAIENT LE LECTEUR AILLEURS QU'ICI. Le motif ci-dessus n'attrape
   qu'une puce ENTIÈREMENT entre chevrons, et il ne tournait que dans « À surveiller ». Mesuré : un
   squelette recopié rendait « <un paragraphe de 2 à 4 phrases : … > » dans la SYNTHÈSE — le
   paragraphe d'ouverture, encadré du liseré doré — et « **DXY** <mouvement → driver> » dans
   l'Analyse de séance.
   Un groupe entre chevrons d'au moins TROIS mots et SANS chiffre est un emplacement, jamais du
   texte rédigé. Les deux gardes comptent : « <0,2% attendu> » porte un chiffre et « <script> » n'a
   pas d'espace — ni l'un ni l'autre n'est touché, le contrôle d'échappement du banc reste vert. */
const _EMPLACEMENT_RX = /<[^<>\d]*\s[^<>\d]*\s[^<>\d]*>/;
const _PUCE_VIDE_RX   = /^[\s…._·•\-]*$/;      // l'emplacement laissé nu : « … »
const estGabarit = t => _EST_GABARIT_RX.test(t) || _EMPLACEMENT_RX.test(t) || _PUCE_VIDE_RX.test(t);

/* ⚠️ LE VERROU NE TOURNAIT QUE SUR UNE BRANCHE SUR DEUX, et c'est le trou le plus grave de la v26.
   Le rendu de « À surveiller » choisit : `tbl ? autresSurveiller(...) : completerSurveiller(...)`.
   Or `completerSurveiller` ne filtre RIEN — et il prend la main dès que le tableau n'a pas pu être
   construit : récap qui n'est pas du jour, week-end, calendrier pas encore chargé au démarrage.
   Sonde du 27/08 sur cette branche : la puce « **CPI** US demain → … réunion **RBA** » ET
   l'emplacement du prompt y étaient publiés tels quels. Le filtre de CONTENU sort donc de
   `autresSurveiller` pour être posé AVANT le choix de branche. */
function filtrerSurveiller(items) {
  return (items || []).map(sansSource).filter(t => t && !estGabarit(t) && !pricingIncoherent(t));
}

const _evPourDoublon = e => ({ title: (e && e.event) || '', currency: (e && e.ccy) || '', actual: '' });
function autresSurveiller(items, surv) {
  const evs = (surv && surv.evs) || [];
  const out = [];
  for (const brut of (items || [])) {
    const t = sansSource(brut);
    if (!t) continue;
    if (estGabarit(t)) continue;                                        // gabarit du prompt recopié
    if (pricingIncoherent(t)) continue;                                 // affirmation fausse par construction
    if (evs.some(e => _SEA.dejaDit(_evPourDoublon(e), [t]))) continue;  // déjà dans le tableau
    out.push(t);
  }
  return out;
}

/* LE VRAI TABLEAU DU CALENDRIER, PAS DES PHRASES (26/08 : « met une partie du calendrier éco du desk
   direct »). Le Récap Quotidien rend déjà ses échéances sous la forme du calendrier du desk —
   séparateurs de jours, heure, drapeau, points d'impact, cellules de valeurs, ligne cliquable vers
   le Décryptage. Le récap de séance servait les mêmes rendez-vous en texte.
   On ne construit PAS ce tableau ici : le HTML a besoin des briques du navigateur (drapeaux,
   points d'impact, cellule de réel colorée). On dépose donc les ÉVÉNEMENTS, et le lecteur appelle la
   même fabrique que le Quotidien. Une balise inerte porte les données : elle ne rend rien par
   elle-même, donc un lecteur qui ne la connaîtrait pas n'affiche simplement pas de tableau — jamais
   du JSON en clair. */
function calSurveiller(surv) {
  const evs = (surv && surv.evs) || [];
  if (!evs.length) return '';
  const json = JSON.stringify(evs).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
  return `<aside class="dtp-cal" data-evs='${json}'></aside>`;
}

/* LA SYNTHÈSE OUVRE LE RAPPORT (26/08 : « fais une synthèse de la session comme on a dans le récap
   quotidien »). Elle se pose EN PREMIER : le lecteur reçoit d'abord ce que la séance a fait, puis le
   récit. C'est l'ordre du Récap Quotidien, et celui des récaps déterministes du desk.

   LE RÉCIT D'ABORD, LES MESURES ENSUITE (28/08, capture du Récap Quotidien à l'appui : « il manque
   ce type de synthèse dans les récap session »). Ce que le user montrait n'était pas mon bloc
   chiffré — c'était le PARAGRAPHE NARRATIF du Quotidien : « Un accord de cessez-le-feu entre les
   États-Unis et l'Iran a fait chuter le pétrole et les rendements obligataires… ». Le récap de
   séance ouvrait, lui, sur « Séance de Londres : 7 publications, 3 hors consensus » — un décompte,
   pas une lecture. Les deux ont leur place, dans cet ordre : le paragraphe donne le sens, les deux
   lignes mesurées l'étayent. Le paragraphe vient du modèle (rubrique « Synthèse » du prompt), les
   lignes sont calculées.

   ⚠️ « LEAD » EST LA MÊME CHOSE SOUS UN AUTRE NOM, ET IL DEVIENT LA SYNTHÈSE. Le prompt réclamait
   jusqu'ici un « LEAD » rendu SANS titre : ses puces se collaient en tête du rapport, en texte nu,
   là où le Quotidien encadre les siennes d'un liseré doré. Le prompt demande désormais « Synthèse » ;
   la reprise du LEAD reste ici pour les rapports déjà en cache et pour un modèle qui retomberait sur
   l'ancien nom — dans les deux cas le lecteur voit le même encadré, jamais une entrée en matière nue. */
const _estSynth = x => x && /^(?:synth[èe]se|lead)$/i.test(String(x.section || '').trim());
function poserSynthese(arr, synth) {
  const out = (arr || []).slice();
  const mes = (synth || []).slice();
  const i = out.findIndex(_estSynth);
  if (i >= 0) { out[i] = { section: 'Synthèse', items: (out[i].items || []).concat(mes) }; return out; }
  if (!mes.length) return out;
  out.unshift({ section: 'Synthèse', items: mes });
  return out;
}

/* MACRO RANGÉE PAR FAMILLE, COMME LE RÉCAP QUOTIDIEN (26/08, retour utilisateur, capture à l'appui :
   « dans macro je vois pas les news sorties dans leur catégorie comme quotidien »). Le classement est
   DÉTERMINISTE et fait avec la MÊME table que le Quotidien (_SEA.famille) : on ne demande pas à l'IA
   de ranger, on range nous-mêmes ce qu'elle a écrit — elle ne peut donc ni inventer une famille ni
   en oublier une.
   AUCUNE LIGNE SANS CATÉGORIE, AUCUN GROUPE SANS INTITULÉ (26/08, deux retours successifs, captures
   à l'appui : « il manque la classification comme la 2è image », puis « ici il manque une
   catégorie »). Deux arbitrages à moi tombaient l'un après l'autre : « intituler un groupe unique
   n'apprend rien » effaçait la classification les jours homogènes ; et rendre ce qui sort des
   quatre rubriques du Radar sans titre — repris du Quotidien, où ces lignes voisinent toujours avec
   des groupes intitulés — laissait une puce nue quand elles étaient les SEULES de la rubrique.
   Toute famille présente porte donc son intitulé, même seule, y compris Commerce et Autres. */
function html(arr, macroCal, surv, synth) {
  const sections = poserSynthese(poserSurveiller(poserMacro(arr, macroCal), surv), synth);
  let out = '', ajouts = 0;
  for (const sec of sections) {
    if (!sec || !sec.section || !Array.isArray(sec.items)) continue;
    /* LES EMPLACEMENTS DU SQUELETTE TOMBENT ICI, POUR TOUTES LES RUBRIQUES — et eux seuls. Le
       verrou de cohérence, lui, RESTE confiné à « À surveiller » : l'étendre supprimerait les
       lectures croisées que le prompt EXIGE ailleurs (« le mouvement ET SON DRIVER »), et deux
       d'entre elles ont été mesurées comme faux positifs. Une rubrique vidée de ses emplacements
       s'efface, comme toute rubrique vide. */
    const items = (sec.items || []).map(sansSource).filter(t => t && !estGabarit(t));
    if (estMacro(sec)) {
      const r = completerMacro(items, macroCal);
      ajouts += r.ajouts;
      if (!r.entrees.length) continue;
      const groupes = _SEA.parFamilleMacro(r.entrees);
      out += `<strong>${esc(sec.section)}</strong>`;
      for (const g of groupes) out += `<em>${esc(g.famille)}</em><ul>${g.lignes.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
      continue;
    }
    if (estSurv(sec)) {
      /* Le TABLEAU d'abord — les échéances datées et chiffrées —, puis les fils ouverts que la
         rédaction a relevés : une échéance passe avant une attente vague. Les phrases du calendrier
         ne sont écrites QUE si le tableau n'a pas pu l'être (vieux lecteur, aucune donnée brute) :
         sinon le lecteur lirait deux fois les mêmes rendez-vous. */
      const tbl = calSurveiller(surv);
      // Avec le tableau : on écarte les puces qu'il dit déjà, et ce qui reste passe sous « Autres ».
      // Sans lui : rien à dédoublonner, et « Autres » n'aurait rien à distinguer — la rubrique reste
      // exactement celle d'avant.
      const gardees = filtrerSurveiller(items);   // idempotent : autresSurveiller le réapplique sans effet
      const l = tbl ? autresSurveiller(gardees, surv) : completerSurveiller(gardees, surv);
      if (!tbl && !l.length) continue;
      out += `<strong>${esc(sec.section)}</strong>`;
      if (tbl) out += `<em>Séance de ${esc((surv && surv.nom) || '')}</em>` + tbl;
      if (l.length) out += (tbl ? '<em>Autres</em>' : '') + `<ul>${l.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
      continue;
    }
    /* « ANALYSE DE SÉANCE » RANGÉE PAR CLASSE D'ACTIF (28/08 : « classe bien par catégories ici pour
       que ce soit propre »). La rubrique alignait DXY, NZD, CHF, le Canada, les matières premières,
       les obligations et les actions dans une seule liste : sept sujets sans rapport à la suite.
       Même mécanique que la Macro — Devises · Obligations · Matières premières · Actions · Crypto ·
       Commerce · Autres —, et même principe : c'est NOUS qui rangeons ce que le modèle a écrit.
       Une seule classe présente → aucun sous-titre : la rubrique EST déjà cette classe. C'est la
       différence avec la Macro, où l'intitulé porte l'information même seul (« Inflation » dit ce
       que le chiffre mesure) ; ici « Devises » au-dessus de trois lignes de devises ne dit rien. */
    if (/^analyse de s[ée]ance$/i.test(String(sec.section).trim()) && items.length) {
      const g = _SEA.parFamilleActif(items);
      out += `<strong>${esc(sec.section)}</strong>`;
      if (g.length > 1) for (const f of g) out += `<em>${esc(f.famille)}</em><ul>${f.lignes.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
      else out += `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
      continue;
    }
    if (!items.length) continue;   // une rubrique vide s'efface — Macro et « À surveiller » sont traitées ci-dessus
    // Le style vaut pour TOUTES les rubriques, pas seulement la Macro : le tic vient du modèle, pas
    // d'une section en particulier.
    out += `<strong>${esc(sec.section)}</strong><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
  }
  return { html: out, ajouts, sections: sections.length };
}

/* ─────────────────────── L'AUDIT DE COHÉRENCE ───────────────────────
   « check les autres récap de sessions aussi pr voir s'il n'y a pas d'incohérence et que les datas
   sont bonnes de leur séance » (27/08). Les verrous posés plus haut agissent AU RENDU : ils
   écartent la puce fautive et le lecteur n'en sait rien. L'audit fait l'inverse — il RELIT ce qui
   est effectivement servi et NOMME ce qui cloche, rubrique par rubrique, séance par séance.

   Il tourne dans le SENS INVERSE de la complétion. `completerMacro` part du calendrier et cherche
   dans le rapport ; l'audit part du RAPPORT et cherche dans le calendrier. C'est ce sens-là qui
   voit une fabrication : « **CPI** US demain → … réunion **RBA** » ne manquait à aucun rendez-vous
   du calendrier, il n'était RATTACHÉ à aucun — et l'anti-doublon, qui ne sait que comparer, ne
   pouvait pas le voir.

   ⚠️ PRÉCISION AVANT COUVERTURE. Un audit qui crie à tort est un audit qu'on cesse de lire, et le
   jour où il a raison personne ne l'ouvre. Chaque contrôle ci-dessous a donc une raison d'être
   DÉTERMINISTE, et deux d'entre eux sont volontairement bornés à la rubrique où ils ne peuvent pas
   se tromper :
     · le verrou de pricing reste dans « À surveiller » — ailleurs, la lecture croisée est EXIGÉE
       par le prompt (« le mouvement ET son driver »), et deux faux positifs y ont été mesurés ;
     · la devise hors séance ne vaut que pour la Macro — c'est la rubrique qui prétend porter les
       chiffres DE LA SÉANCE ; ailleurs, parler du dollar depuis Tokyo est le métier. */

const _JOUR_RELATIF_RX = /\b(?:demain|hier|apr[èe]s-demain|avant-hier|ce\s+soir|cette\s+nuit|la\s+semaine\s+prochaine|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+prochaine?\b|\b(?:demain|hier|apr[èe]s-demain|avant-hier|ce\s+soir|cette\s+nuit)\b/i;
const _CHIFFRE_RX      = /\d[\d\s.,]*\s*(?:%|pts?\b|bps\b|[KMB]\b|milliards?|millions?)/i;

/* La devise dont la puce PARLE — pas celle qu'elle mentionne en passant. On lit l'intitulé en gras
   s'il porte une devise, sinon l'amont de la flèche, JAMAIS le texte entier : une conséquence qui
   nomme l'euro ne fait pas d'une puce sur le yen une puce européenne. */
function deviseSujet(txt) {
  const t = String(txt || '');
  const gras = (/^\s*\*\*([^*]{1,60})\*\*/.exec(t) || [])[1] || '';
  if (gras) { const d = (_SUJETS_CCY.find(([rx]) => rx.test(gras)) || [])[1]; if (d) return d; }
  const p = _coupe(t);
  const amont = p ? p[0] : t;
  return (_SUJETS_CCY.find(([rx]) => rx.test(amont)) || [])[1] || '';
}

/* Une puce est ANCRÉE quand le calendrier de la séance porte le rendez-vous dont elle parle.
   `dejaDit` est l'anti-doublon déjà en service dans la complétion — le même juge des deux côtés,
   pour qu'une puce jugée « déjà dite » à l'écriture ne soit pas jugée « inventée » à la relecture. */
function ancree(puce, macroCal) {
  return (macroCal || []).some(e => _SEA.dejaDit(e, [puce]));
}

const _RUB = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const estRubMacro = r => /^macro/.test(_RUB(r));
const estRubSurv  = r => /surveiller/.test(_RUB(r));

/* rubriques : [{ rubrique, puces:[…] }] — la forme rendue, pas la forme brute : on relit CE QUI EST
   SERVI. ctx : { dev:[…devises de la séance], macroCal:[…rendez-vous de sa fenêtre] }. */
function auditer(rubriques, ctx) {
  const dev = ((ctx && ctx.dev) || []).map(d => String(d).toUpperCase());
  const cal = (ctx && ctx.macroCal) || [];
  const constats = [];
  const pose = (rubrique, puce, motif, gravite, detail) => constats.push({ rubrique, puce, motif, gravite, detail: detail || '' });

  for (const r of (rubriques || [])) {
    const rubrique = String((r && r.rubrique) || '');
    for (const brute of ((r && r.puces) || [])) {
      const puce = String(brute || '').trim();
      if (!puce) continue;

      /* 1. L'EMPLACEMENT DU SQUELETTE. Écarté au rendu depuis la v27 ; s'il ressort ici, c'est un
            rapport encore en cache sous une version antérieure — ou le filtre qui a régressé. */
      if (estGabarit(puce)) { pose(rubrique, puce, 'gabarit du prompt recopié', 'grave', 'écarté au rendu depuis la v27 — un rapport plus ancien est encore servi depuis le cache'); continue; }

      /* 2. LE PRICING CROISÉ, dans « À surveiller » et nulle part ailleurs (voir l'avertissement). */
      if (estRubSurv(rubrique) && pricingIncoherent(puce)) { pose(rubrique, puce, 'un sujet price la banque centrale d’une AUTRE devise', 'grave'); continue; }

      /* 3. L'ÉCHÉANCE RELATIVE. Le module ne reçoit que le calendrier de la séance suivante : il ne
            PEUT pas vérifier « demain ». Le prompt l'interdit donc mot pour mot — et c'est ce mot
            qui rendait la puce inventée crédible. */
      if (_JOUR_RELATIF_RX.test(puce)) pose(rubrique, puce, 'échéance relative invérifiable', 'grave', 'ni le rapport ni le module ne peuvent dater « demain » : le prompt l’interdit depuis la v27');

      if (!estRubMacro(rubrique)) continue;

      /* 4. LA DEVISE HORS SÉANCE. Le défaut signalé, dans sa forme la plus nette : la rubrique qui
            prétend porter les chiffres de la séance en porte un d'ailleurs. */
      const d = deviseSujet(puce);
      if (d && dev.length && dev.indexOf(d) < 0) { pose(rubrique, puce, `sujet en ${d}, hors des devises de la séance (${dev.join(', ')})`, 'grave'); continue; }

      /* 5. LE CHIFFRE SANS RENDEZ-VOUS. Plus faible : la rédaction relève légitimement ce que le
            calendrier ne liste pas (un sondage, une remarque de banquier central). Un CHIFFRE, lui,
            vient d'une publication — et une publication de la séance est au calendrier. */
      if (_CHIFFRE_RX.test(puce) && cal.length && !ancree(puce, cal)) pose(rubrique, puce, 'chiffre sans rendez-vous au calendrier de la séance', 'à vérifier', 'la rédaction relève parfois ce que le calendrier ne liste pas — à lire, pas à corriger d’office');
    }
  }
  return constats;
}

module.exports = { html, poserMacro, completerMacro, poserSurveiller, completerSurveiller, autresSurveiller, calSurveiller, poserSynthese, sansSource, sansMedia, heureParis, esc, pricingIncoherent, filtrerSurveiller, estGabarit, deviseSujet, ancree, auditer };

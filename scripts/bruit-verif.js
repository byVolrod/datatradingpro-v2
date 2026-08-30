#!/usr/bin/env node
/**
 * scripts/bruit-verif.js — CE QUE LE FIL NE DOIT PAS PORTER
 *
 * POURQUOI (28/08). Capture client sur une ligne du fil :
 *   « Je suis ravi d'annoncer qu'à partir du 2 septembre, Ben Moss deviendra assistant du président
 *     et secrétaire général de la Maison Blanche, remplaçant notre nouveau conseiller juridique… »
 * Verdict de l'utilisateur, juste sur les DEUX points : « on ne sait pas de qui elle est, et on n'a
 * quasi aucune valeur ou info ».
 *   · DE QUI ? Le texte est à la PREMIÈRE PERSONNE, sans aucune attribution. Le desk sait reframer
 *     un propos rapporté (« Trump: … ») parce qu'un préfixe désigne le locuteur ; ici il n'y en a
 *     pas, et on n'invente pas un nom.
 *   · QUELLE VALEUR ? Un secrétaire général de la Maison Blanche ne déplace aucune paire. Sur un
 *     desk FX, cette ligne prend la place d'une qui compte.
 *
 * ⚠️ CE QUE CE BANC PROTÈGE AVANT TOUT, C'EST L'INVERSE. Un filtre anti-bruit est dangereux par
 * nature : ce qu'il écarte à tort ne se voit JAMAIS — la ligne n'existe simplement pas, personne ne
 * la cherche. Une règle sur les nominations qui emporterait « Trump names X as Fed Chair » ferait
 * infiniment plus de dégâts que le bruit qu'elle supprime. La moitié des contrôles ci-dessous sert
 * donc à vérifier ce qui doit RESTER, pas ce qui doit partir.
 *
 *   node scripts/bruit-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ── La VRAIE règle, découpée dans server.js — jamais une copie : une copie resterait verte le jour
      où l'original change, ce qui est exactement l'inverse de ce qu'on veut. ───────────────────── */
const SRC = (() => {
  const d = SRV.indexOf('const _NOMINATION_RX');
  if (d < 0) return null;
  const f = SRV.indexOf('\n}\n', SRV.indexOf('function _estNominationSansPortee', d));
  return f < 0 ? null : SRV.slice(d, f + 3);
})();

console.log('\n── Une nomination d\'état-major n\'est pas une news de marché ──');
v('la règle est extractible de server.js', !!SRC);
v('… et elle est branchée dans isNoise', /_estNominationSansPortee\(h\)\s*\)\s*return true;/.test(SRV),
  'écrite mais jamais appelée : le fil porterait toujours ces lignes');

if (SRC) {
  // eslint-disable-next-line no-eval
  const F = eval('(function(){' + SRC + '\nreturn _estNominationSansPortee;})()');

  /* CE QUI DOIT PARTIR. Le premier cas est le titre EXACT de la capture, en version d'origine :
     `isNoise` travaille à l'ingestion, donc sur l'anglais, avant toute traduction. */
  const ecarter = [
    ['la capture, mot pour mot',
     'I am pleased to announce that effective September 2nd, Ben Moss will become Assistant to the President and Staff Secretary, replacing our new White House Counsel, Will Scharf.'],
    ['une porte-parole', 'I am thrilled to announce that Sarah will become White House Press Secretary'],
    ['un adjoint de cabinet', 'Karoline Leavitt has been named deputy chief of staff'],
    ['un directeur de la communication', 'He is being appointed as Communications Director at the White House'],
  ];
  ecarter.forEach(([lbl, h]) => v('écartée : ' + lbl, F(h) === true, h.slice(0, 80)));

  /* ⚠️ CE QUI DOIT RESTER — LA MOITIÉ QUI COMPTE. Ces nominations-là SONT des nouvelles de marché
     de premier ordre : une règle qui les emporte est bien pire que le bruit qu'elle enlève. */
  const garder = [
    ['présidence de la Fed', 'Trump names Kevin Hassett as Federal Reserve Chair'],
    ['secrétaire au Trésor', 'Bessent has been named Treasury Secretary'],
    ['gouverneur de banque centrale', 'Japan PM will become the first to appoint a new BoJ Governor next month'],
    ['présidence de la BCE', 'Lagarde will serve as ECB President until 2027'],
    ['ministre des Finances', 'Reeves has been named finance minister'],
    ['représentant au Commerce', 'Greer is appointed as Trade Representative'],
    ['une décision de taux', 'Fed cuts rates by 25 basis points'],
    ['une inflation qui reflue', 'ECB holds rates steady as inflation cools'],
    ['une annonce SANS poste d\'état-major', 'Trump says he is pleased to announce new tariffs on Chinese goods'],
    ['une géopolitique de premier rang', 'Oil surges after attack on Hormuz shipping lane'],
    ['un titre vide', ''],
  ];
  garder.forEach(([lbl, h]) => v('gardée : ' + lbl, F(h) === false, h.slice(0, 80)));

  /* LES DEUX CONDITIONS SONT CUMULATIVES, et c'est ce qui rend la règle étroite : une formulation
     de nomination seule ne suffit pas, un poste d'état-major seul non plus. */
  v('une formulation de nomination SEULE ne suffit pas',
    F('The report will become available on Monday') === false);
  v('… et un poste d\'état-major SEUL non plus',
    F('The chief of staff commented on the tariff package') === false);
  /* LA PRIORITÉ DU POSTE DE MARCHÉ EST ABSOLUE : même formulée comme une nomination d'état-major,
     une nomination à la Fed reste. C'est le garde-fou le plus important du lot. */
  v('un poste de marché l\'emporte TOUJOURS, même mêlé à un poste d\'état-major',
    F('I am pleased to announce that the chief of staff will become Federal Reserve Chair') === false,
    'un titre mixte doit rester : le doute profite à la ligne');
}


/* ══ L'ATTRIBUTION DE SOURCE COLLÉE EN FIN DE TITRE ═══════════════════════════════════════════════
   28/08, capture : « … plusieurs explosions dans la capitale syrienne - Tasnim News. » — demande :
   « enlève les sources des news ».
   ⚠️ CE QUI CLOCHAIT N'ÉTAIT PAS L'ABSENCE DE RÈGLE, MAIS SA FORME. Une liste de noms exacts
   existait, et « Tasnim » y figurait — mais le titre porte « Tasnim News », et le nom doit consommer
   TOUTE la fin de la ligne. Même trou pour « Mehr News Agency », « Kyodo News », « Anadolu
   Agency » : trois noms déjà listés, trois variantes qui passaient. Une liste sera toujours en
   retard d'un média.
   On reconnaît donc une attribution à sa FORME — tiret, mots en Capitales, mot de presse en dernier.
   ⚠️ ET LA MOITIÉ DES CONTRÔLES VÉRIFIE CE QUI DOIT RESTER INTACT : une règle qui mange la fin des
   titres est bien pire que quelques attributions oubliées, et son dégât se voit sur CHAQUE ligne. */
console.log('\n── L\'attribution de source en fin de titre ──');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const SRC_SRC = (() => {
  const d = APP.indexOf('const _NEWS_SRC_RE =');
  const f = APP.indexOf('function _sansSource(s)');
  return (d < 0 || f < 0) ? null : APP.slice(d, APP.indexOf('\n', f));
})();
v('les deux règles sont extractibles d\'app.js', !!SRC_SRC);
v('… et elles servent aux TITRES', /_mdStrip\(_sansSource\(s\)/.test(APP));
v('… comme aux PUCES', /stripSrc = t => _sansSource\(t\)/.test(APP));
if (SRC_SRC) {
  // eslint-disable-next-line no-eval
  const N = eval('(function(){' + SRC_SRC + '\nreturn _sansSource;})()');
  const nettoie = h => N(h) !== h;
  /* CE QUI DOIT PARTIR — la capture d'abord, puis les variantes qui échappaient à la liste. */
  [['la capture, mot pour mot', 'Des sources arabes ont signalé plusieurs explosions dans la capitale syrienne - Tasnim News.'],
   ['« News Agency » en suffixe', 'Israeli strikes reported near Damascus - Mehr News Agency'],
   ['« News » en suffixe', 'Oil prices climb on supply risk - Kyodo News'],
   ['un nom de la liste, seul', 'Fed cuts rates by 25bp - Reuters'],
   ['un quotidien à trois mots', 'Dollar firms into the close - The Wall Street Journal'],
  ].forEach(([lbl, h]) => v('retirée : ' + lbl, nettoie(h), N(h)));
  /* ⚠️ CE QUI DOIT RESTER — un titre amputé se voit sur chaque ligne du fil. */
  [['un tiret dans un nom propre', 'Trump-Xi call on trade deal expected next week'],
   ['un tiret de composition', 'US-China trade talks resume in Geneva'],
   ['un dernier mot qui n\'est pas de la presse', 'ECB Lagarde - Press Conference'],
   ['une suite de titre en Capitales', 'Oil surges - Brent tops $90 a barrel'],
   ['une suite en minuscules', 'Fed holds - markets rally on the news'],
   ['un titre vide', ''],
  ].forEach(([lbl, h]) => v('intact : ' + lbl, !nettoie(h), N(h)));
  /* La règle générique ne doit mordre QU'EN FIN DE LIGNE : une attribution au milieu d'un titre
     fait partie de la phrase. */
  v('une source au MILIEU du titre n\'est pas touchée',
    !nettoie('Reuters reports that the ECB will hold rates steady this week'));
  /* ⚠️ ET LE CAS QUI ÉPROUVE VRAIMENT L'ANCRE DE FIN DE LIGNE : un nom de média précédé d'un tiret
     mais SUIVI de texte. Sans l'ancre, la règle emporterait le nom EN PLEIN MILIEU de la phrase et
     recollerait les deux moitiés — « Explosions entendues said the strikes… ». Le contrôle
     précédent ne le voyait pas : sans tiret, l'ancre n'a rien à ancrer. */
  v('… même précédée d\'un tiret, si la phrase continue',
    !nettoie('Explosions heard near the airport - Tasnim News said the strikes hit an airbase'),
    N('Explosions heard near the airport - Tasnim News said the strikes hit an airbase'));
}

/* ══ LA STATISTIQUE D'UN PAYS QU'ON NE TRADE PAS ═══════════════════════════════════════════════
   29/08, capture : « Chile Unemployment rate above expectations (9.4%) in July » en Commentaire
   économique. Verdict utilisateur : « le Chili on ne trade pas ça ». Le desk couvre les devises de
   son calendrier ; une statistique chilienne, turque ou suédoise y prend la place d'une ligne qui
   compte.
   ⚠️ LA MOITIÉ QUI COMPTE, encore : la règle exige (1) un pays POSITIVEMENT identifié hors marché,
   ANCRÉ EN TÊTE, et (2) la FORME d'une publication chiffrée. La géopolitique de ces mêmes pays
   (guerre, sanctions, céréales) doit RESTER — l'écarter ferait plus de dégâts que le bruit. */
console.log('\n── La statistique d\'un pays hors marché ──');
const SRC_HM = (() => {
  const d = SRV.indexOf('const _PAYS_HORS_MARCHE_RX');
  const f = SRV.indexOf('\n}', SRV.indexOf('function _estDonneeHorsMarche'));
  return (d < 0 || f < 0) ? null : SRV.slice(d, f + 2);
})();
v('la règle est extractible de server.js', !!SRC_HM);
v('… et branchée dans isNoise', /if \(_estDonneeHorsMarche\(h\)\) return true;/.test(SRV));
if (SRC_HM) {
  // eslint-disable-next-line no-eval
  const H = eval('(function(){' + SRC_HM + '\nreturn _estDonneeHorsMarche;})()');
  [['la capture, mot pour mot', 'Chile Unemployment rate above expectations (9.4%) in July: Actual (9.5%)'],
   ['une inflation turque chiffrée', 'Turkey CPI rises to 62.1% in July'],
   ['une donnée suédoise à signature calendrier', 'Sweden GDP Actual 0.4% (Forecast 0.3%)'],
   ['une décision de taux russe', 'Russian central bank interest rate decision: cut to 16%'],
  ].forEach(([lbl, h]) => v('écartée : ' + lbl, H(h) === true, h.slice(0, 70)));
  [['la géopolitique du MÊME pays', 'Russia launches missile strike on Kyiv, oil jumps 2%'],
   ['les céréales ukrainiennes (exports absents des indicateurs, exprès)', 'Ukraine grain exports fell 12% after strikes on Odesa ports'],
   ['les réserves de change indiennes (pas un indicateur macro)', "India's forex reserves hit record $729 billion"],
   ['une donnée AMÉRICAINE', 'US Core PCE Price Index MoM Actual 0.2% (Forecast 0.2%)'],
   ['une donnée allemande (zone euro tradée)', 'German Prelim CPI m/m Actual 0.7%'],
   ['un pays hors marché cité en MILIEU de phrase', 'Inflation worries mount in Chile'],
   /* ⚠️ Ces deux-là ont été AJOUTÉS PAR LA MUTATION, pas par prudence : sans eux, retirer l'ancrage
      de tête ou l'exigence de forme chiffrée laissait le banc VERT. Le premier a la FORME (indicateur
      + %) mais le pays en milieu de phrase — seul l'ancrage le sauve. Le second a le PAYS en tête et
      l'indicateur mais AUCUN chiffre : un commentaire, pas une publication — seule la forme le sauve. */
   ['une hausse du cuivre qui CITE l\'inflation chilienne', 'Copper rallies as inflation in Chile hits 4.2%'],
   ['un commentaire chilien SANS chiffre', 'Chile unemployment outlook worsens, economists say'],
   ['la révision des payrolls US (sans pays en tête)', 'Prelim Benchmark Payrolls Revision Actual -79K (Forecast 183K, Previous -911K)'],
   ['un titre vide', ''],
  ].forEach(([lbl, h]) => v('gardée : ' + lbl, H(h) === false, h.slice(0, 70)));
}

/* ══ L'EXPLAINER PROMOTIONNEL D'ACTION PUBLIQUE ═══════════════════════════════════════════════
   30/08, capture : « COMMENT LA LIGNE DIRECTRICE 12345 DE LA CHINE RÉINVENTE LES SERVICES AUX
   CITOYENS » dans le fil, taguée Géopolitique. Verdict utilisateur : « ce type de news si elle
   n'apporte rien aucune valeur … faut pas laisser entrer ». La classe : un État raconte comment
   son programme améliore la vie civique — soft power rédactionnel, aucun actif, aucune décision.
   La règle exige LES DEUX — la FORME d'explainer promotionnel (« How … » ancré en tête, ou verbe
   de brochure) ET le SUJET civico-administratif — et isFinanciallyRelevant épargne toujours en
   dernier ressort.
   ⚠️ LA MOITIÉ QUI COMPTE : la géopolitique chinoise, les tarifs, et tout titre qui parle marché
   doivent RESTER — un explainer écarté à tort ne se voit jamais. */
console.log('\n── L\'explainer promotionnel d\'action publique ──');
const SRC_CC = (() => {
  const d = SRV.indexOf('const _FORME_EXPLAINER_RX');
  const f = SRV.indexOf('\n}', SRV.indexOf('function _estCommCivique'));
  return (d < 0 || f < 0) ? null : SRV.slice(d, f + 2);
})();
// La règle s'appuie sur isFinanciallyRelevant : on extrait AUSSI le vrai détecteur, pas une copie.
const SRC_FIN = (() => {
  const d = SRV.indexOf('const FINANCIAL_KEYWORDS');
  const f = SRV.indexOf('\n}', SRV.indexOf('function isFinanciallyRelevant'));
  return (d < 0 || f < 0) ? null : SRV.slice(d, f + 2);
})();
v('la règle est extractible de server.js (et son détecteur financier avec elle)', !!SRC_CC && !!SRC_FIN);
v('… branchée dans isNoise', /if \(_estCommCivique\(h\)\)\s+return true;/.test(SRV));
v('… et la purge au boot retire ceux déjà stockés', /_estCommCivique\(String\(i\.headline \|\| ''\)\)/.test(SRV),
  'le filtre d\'entrée seul laisserait la ligne de la capture dans le fil');
if (SRC_CC && SRC_FIN) {
  // eslint-disable-next-line no-eval
  const C = eval('(function(){' + SRC_FIN + '\n' + SRC_CC + '\nreturn _estCommCivique;})()');
  [['la capture, en version d\'origine (l\'ingestion travaille sur l\'anglais)',
    "How China's 12345 guideline reinvents citizen services"],
   ['la même, telle qu\'affichée en français (défensif)',
    'Comment la ligne directrice 12345 de la Chine réinvente les services aux citoyens'],
   ['une hotline municipale « transformée »', 'How the city hotline transforms public services for residents'],
   ['une vitrine de gouvernance', 'Smart cities initiative showcases rural revitalization and grassroots governance'],
  ].forEach(([lbl, h]) => v('écartée : ' + lbl, C(h) === true, h.slice(0, 80)));
  [['un explainer qui parle MARCHÉ (épargne financière)', "How the PBoC's digital governance reinvents public services in banking"],
   ['la géopolitique chinoise', 'China unveils new tariffs on EU goods in escalating trade war'],
   ['la forme SEULE ne suffit pas', 'How Beijing plans to respond to new US tariffs'],
   ['le sujet SEUL non plus', 'Government hotline flooded with complaints as public services strike spreads'],
   ['une réforme sociale à portée budgétaire', 'France pension reform to cut budget deficit by 0.5% of GDP'],
   ['un titre vide', ''],
  ].forEach(([lbl, h]) => v('gardée : ' + lbl, C(h) === false, h.slice(0, 80)));
}

/* ══ LA MÊME NEWS DEUX FOIS DANS LE FIL ═══════════════════════════════════════════════════════
   30/08, capture : « Conférence de presse du FOMC », « Communiqué sur les taux et prévisions
   économiques (SEP) » et « Rapport mensuel de l'AIE » chacun EN DOUBLE, à la même minute. La
   cause n'était pas la dédup elle-même mais son ANGLE MORT : deux copies de la même dépêche
   arrivées dans le MÊME lot étaient chacune comparée au fil déjà stocké : jamais aux entrantes
   acceptées avant elles, versées au fil seulement après la boucle. Les deux passaient.
   ⚠️ LA MOITIÉ QUI COMPTE : deux ÉVÉNEMENTS distincts de la même minute (conférence FOMC et
   rapport AIE) ne doivent JAMAIS fusionner, et une « FOMC Press Conference » qui revient six
   semaines plus tard est une nouvelle édition, pas une jumelle : la purge est bornée à 3 h. */
console.log('\n── La même news deux fois dans le fil ──');
const SRC_DD = (() => {
  const d = SRV.indexOf('function norm(s)');
  const f = SRV.indexOf('\n}', SRV.indexOf('function findDuplicate'));
  return (d < 0 || f < 0) ? null : SRV.slice(d, f + 2);
})();
v('la dédup est extractible de server.js', !!SRC_DD);
v('le lot se compare AUSSI à lui-même dans mergeItems',
  /const prev = findDuplicate\(item, allNews\) \|\| findDuplicate\(item, newItems\);/.test(SRV),
  'sans cela, deux copies du même lot entrent toutes les deux');
v('la purge au boot retire les jumelles déjà stockées, bornée à 3 h et hors briefings',
  /jumelle\(s\) retirée\(s\)/.test(SRV)
  && /const proches = \(parTitre\.get\(cle\) \|\| \[\]\)\.filter\(g => Math\.abs\(\(g\.timestamp \|\| 0\) - \(i\.timestamp \|\| 0\)\) <= 180 \* 60 \* 1000\);/.test(SRV)
  && /if \(!i \|\| i\._briefing \|\| i\.source === 'DTP' \|\| !i\.headline\) \{ garder\.push\(i\); continue; \}/.test(SRV));
if (SRC_DD) {
  // eslint-disable-next-line no-eval
  const F = eval('(function(){' + SRC_DD + '\nreturn findDuplicate;})()');
  const T = Date.now();
  const stored = [];   // le fil au moment du lot : vide, comme dans l'incident
  const accepted = [];
  const lot = [
    { headline: 'FOMC Press Conference', timestamp: T, source: 'FinancialJuice' },
    { headline: 'FOMC press conference', timestamp: T + 30000, source: 'ForexLive' },
    { headline: 'IEA Monthly Oil Market Report', timestamp: T, source: 'FinancialJuice' },
    { headline: 'IEA monthly oil market report', timestamp: T + 20000, source: 'ForexLive' },
  ];
  const entres = [];
  for (const it of lot) {
    const prev = F(it, stored) || F(it, accepted);   // la boucle corrigée de mergeItems, rejouée
    if (prev) continue;
    accepted.push(it); entres.push(it.headline);
  }
  v('rejeu du lot de la capture : chaque dépêche n\'entre qu\'UNE fois', entres.length === 2, JSON.stringify(entres));
  v('… la copie FOMC est retenue contre le LOT, pas contre le fil', !!F(lot[1], accepted) && !F(lot[1], stored));
  v('deux événements DISTINCTS de la même minute ne fusionnent jamais',
    !F({ headline: 'IEA Monthly Oil Market Report', timestamp: T }, [lot[0]]),
    'le rapport AIE n\'est pas la conférence FOMC');
  /* Reformulation RÉALISTE (préfixe « Breaking », mention « (SEP) » en fin) : le nettoyage de
     _normHl doit les ramener au même titre. Un titre COURT (« FOMC Press Conference » + un mot),
     lui, reste volontairement hors de portée : le garde-fou des 30 caractères protège les titres
     génériques, c'est un choix, pas un trou. */
  v('une reformulation proche à moins de 3 h est bien une jumelle',
    !!F({ headline: 'Breaking: FOMC Rate Statement and Summary of Economic Projections (SEP)', timestamp: T + 3600000 },
      [{ headline: 'FOMC Rate Statement and Summary of Economic Projections', timestamp: T }]));
  /* 2e capture (30/08, « c très important ») : la VARIANTE d'agenda du même événement : « FOMC
     Rate Statement » et « FOMC Rate Statement and Economic Projections (SEP) » à la même minute.
     Préfixe commun de 19 lettres : sous le garde-fou des 30, les deux entraient. La règle ajoutée
     exige ±10 min ET un préfixe d'au moins trois vrais mots : elle attrape la paire de la capture
     sans toucher aux titres courts génériques. */
  v('la variante d\'agenda du même événement est une jumelle (Rate Statement vs + SEP, même minute)',
    !!F({ headline: 'FOMC Rate Statement and Economic Projections (SEP)', timestamp: T },
      [{ headline: 'FOMC Rate Statement', timestamp: T }]));
  v('… mais un titre court générique n\'avale toujours pas son prolongement',
    !F({ headline: 'Oil rises above $90 a barrel on supply risk', timestamp: T },
      [{ headline: 'Oil rises', timestamp: T }]),
    'deux vrais mots seulement : le doute profite à la ligne');
  v('… et la même variante à 2 h d\'écart n\'est PAS happée par cette règle (agenda = quasi-simultané)',
    !F({ headline: 'FOMC Rate Statement and Economic Projections (SEP)', timestamp: T + 2 * 3600000 },
      [{ headline: 'FOMC Rate Statement', timestamp: T }]));
  v('la purge au boot a sa seconde passe (jumelles par préfixe, ±10 min, 3 vrais mots)',
    /SECONDE PASSE : les jumelles PAR PRÉFIXE/.test(SRV)
    && /const gagnant = _normHl\(i\.headline\)\.length > _normHl\(g\.headline\)\.length \? i : g;/.test(SRV));
}

/* ══ LE NFP SANS PAYS EN TÊTE EST QUAND MÊME UNE DONNÉE US, ET DU TIER-1 ══════════════════════
   29/08, capture : « Prelim Benchmark Payrolls Revision Actual -79K » sorti en Commentaire
   économique, sans rouge ni tags — le nom n'écrit pas « US », mais NFP, ISM, JOLTS n'existent
   qu'aux États-Unis : LE NOM EST LE PAYS. */
console.log('\n── L\'indicateur au nom américain sans préfixe pays ──');
/* Le motif doit exister ET mener à « US Data » : une mutation l'envoyant ailleurs laissait le banc
   vert tant qu'on ne vérifiait que sa présence. */
v('le motif « nom américain » est dans le classeur ET mène à « US Data »',
  SRV.includes("\\badp\\s+employment\\b)/, 'US Data'],"));
{
  const m = /const HIGH_IMPACT_RE = ([^\n]+);/.exec(SRV);
  v('HIGH_IMPACT_RE est extractible', !!m);
  if (m) {
    // eslint-disable-next-line no-eval
    const RE = eval(m[1]);
    v('la révision des payrolls est du tier-1 (rouge)', RE.test('Prelim Benchmark Payrolls Revision Actual -79K (Forecast 183K, Previous -911K)'));
    v('le NFP au PLURIEL matche enfin (frontière l|s : bug latent exposé le 29/08)',
      RE.test('US Nonfarm Payrolls Actual 210K') && RE.test('Non Farm Payrolls Actual 150K'),
      'le \\b final refusait « Payrolls » depuis toujours');
    v('… sans embarquer un simple commentaire d\'emploi', !RE.test('Analysts discuss the labor market outlook'));
  }
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

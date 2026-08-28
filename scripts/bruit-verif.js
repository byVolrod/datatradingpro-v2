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

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

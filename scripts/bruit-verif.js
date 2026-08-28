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

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

#!/usr/bin/env node
/**
 * source-verif.js — UN RAPPORT D'INSTITUTION NE RAMÈNE PAS À SA SOURCE.
 * ------------------------------------------------------------------------------------------------
 * 28/08, capture à l'appui : « enlève les sources des rapports institutions faut que personne
 * n'arrivent à les trouver typiquement ici tu vois fais un check de tous les rapports du mois et
 * enlève toutes traces et vérifie pour les futurs qui arriveront ». Au milieu du corps d'un rapport :
 * « Please click here to read the PDF version », le « here » en lien vers le PDF de la banque.
 *
 * `_stripSource` traitait les FORMULES connues, une par une. Utile, et ça reste — mais une liste de
 * formules ne couvre jamais la banque suivante, ni la prochaine refonte d'une page déjà listée, et
 * la demande porte justement sur les FUTURS. D'où une règle qui n'est pas une formule mais une
 * propriété : dans le corps d'un rapport d'institution, il ne reste AUCUNE adresse.
 *
 * On éprouve donc le vrai code — les deux fonctions sont extraites de server.js, jamais recopiées.
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');

let ok = 0, ko = 0;
const v = (titre, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + titre); }
  else { ko++; console.log('  ✗ ' + titre + (detail ? '\n      → ' + detail : '')); }
};

/* EXTRACTION DU VRAI CODE. Recopier les expressions rationnelles dans le test reviendrait à tester
   la copie : elle resterait verte le jour où celle de server.js changerait. On découpe donc le
   fichier aux frontières des fonctions et on les évalue telles quelles. */
const bloc = (debut, fin) => {
  const d = SRV.indexOf(debut);
  if (d < 0) throw new Error('introuvable dans server.js : ' + debut);
  const f = SRV.indexOf(fin, d);
  if (f < 0) throw new Error('fin introuvable pour : ' + debut);
  return SRV.slice(d, f + fin.length);
};
const src = [
  bloc('function _stripXmlNoise(h) {', "\n}"),
  bloc('const _ADRESSE_NUE =', "\n}"),
  bloc('function _stripSource(html) {', "\n}"),
].join('\n');
let _stripLiens, _stripSource;
try {
  const f = new Function(src + '\nreturn { _stripLiens, _stripSource };');
  ({ _stripLiens, _stripSource } = f());
} catch (e) {
  console.log('  ✗ extraction impossible : ' + e.message + '\n');
  process.exit(1);
}
const propre = h => _stripSource(_stripLiens(h));

console.log('\n── 1. Le cas de la capture ──');
const KBC = '<p>The KBC Economics team expects growth to slow.</p>'
  + '<p>Please click <a href="https://www.kbc.be/content/dam/kbccom/doc/economics/publications/PDF/ERA_2026_08.pdf">here</a> to read the PDF version.</p>';
const kbc = propre(KBC);
v('le rappel « click here to read the PDF version » disparaît', !/click|pdf version/i.test(kbc), kbc);
v('l\'adresse du PDF de la banque aussi', !/kbc\.be|\.pdf/i.test(kbc), kbc);
v('le rapport, lui, est intact', /The KBC Economics team expects growth to slow\./.test(kbc), kbc);
v('et il ne reste pas de paragraphe vide', !/<p>\s*<\/p>/.test(kbc), kbc);

console.log('\n── 2. La règle de fond : plus aucune adresse ──');
/* C'est ELLE qui couvre les futurs. Une formule inconnue peut passer ; une adresse, non — quelle
   que soit la banque, quelle que soit la refonte de sa page. */
v('un lien devient son texte, la phrase reste lisible',
  propre('<p>See the <a href="https://bank.com/x">December statement</a> for detail.</p>') === '<p>See the December statement for detail.</p>',
  propre('<p>See the <a href="https://bank.com/x">December statement</a> for detail.</p>'));
v('un lien dont le texte EST l\'adresse s\'efface entièrement',
  !/bank\.com/.test(propre('<p>Full note: <a href="https://bank.com/note">https://bank.com/note</a></p>')),
  propre('<p>Full note: <a href="https://bank.com/note">https://bank.com/note</a></p>'));
v('un nom de domaine en guise de libellé aussi',
  !/research\.natixis\.com/.test(propre('<p><a href="https://research.natixis.com">research.natixis.com</a></p>')),
  propre('<p><a href="https://research.natixis.com">research.natixis.com</a></p>'));
v('une adresse écrite en clair part', !/https?:/.test(propre('<p>Source: https://www.mufgresearch.com/fx/note</p>')),
  propre('<p>Source: https://www.mufgresearch.com/fx/note</p>'));
v('… « www. » sans protocole aussi', !/www\./.test(propre('<p>Voir www.socgen.com/research pour la suite.</p>')),
  propre('<p>Voir www.socgen.com/research pour la suite.</p>'));
v('un lien interne au document n\'est pas une porte de sortie',
  propre('<p>Voir <a href="#section-2">la section 2</a>.</p>') === '<p>Voir la section 2.</p>',
  propre('<p>Voir <a href="#section-2">la section 2</a>.</p>'));
/* ⚠️ CE QU'IL NE FAUT PAS CASSER. Le corps d'un rapport parle de sociétés, de devises et de prix :
   un point suivi de deux lettres n'est pas un domaine. */
v('« U.S. » survit', /U\.S\. GDP rose 2\.3%/.test(propre('<p>U.S. GDP rose 2.3% in Q2.</p>')), propre('<p>U.S. GDP rose 2.3% in Q2.</p>'));
v('une adresse e-mail n\'entraîne pas la phrase',
  /Contact/.test(propre('<p>Contact research at economics.desk@bank.com for detail.</p>')),
  propre('<p>Contact research at economics.desk@bank.com for detail.</p>'));
v('un tableau de chiffres est intact',
  propre('<table><tr><td>CPI</td><td>2.4%</td></tr></table>') === '<table><tr><td>CPI</td><td>2.4%</td></tr></table>');

console.log('\n── 3. Les formules connues restent traitées ──');
[['<p>This article was written by John Doe at investinglive.com</p>', /investinglive/i, 'l\'attribution InvestingLive'],
 ['<p>For other currencies, please download the PDF version attached at the top of this page.</p>', /download the pdf/i, 'le renvoi au PDF MUFG'],
 ['<p>The post Weekly Outlook appeared first on ActionForex.</p>', /appeared first on/i, 'le pied de page WordPress'],
 ['<p>Source: Bloomberg, KBC Economics</p>', /^.*Source:/i, 'la ligne « Source : »'],
].forEach(([entree, motif, quoi]) => v(quoi + ' est retiré', !motif.test(propre(entree)), propre(entree)));

console.log('\n── 4. Le câblage — une sortie oubliée annule tout le reste ──');
/* La route a NEUF sorties `res.json`, et DEUX ne passaient pas par `_stripSource` : le texte des
   PDF natifs et le repli sur la description RSS. C'est exactement le genre d'oubli qu'on ne voit
   jamais — d'où l'enveloppe de la sortie commune, qui vaut aussi pour les sorties à venir. */
v('le nettoyage est garanti sur la sortie commune',
  /if \(o && typeof o\.html === 'string' && o\.html\) o\.html = _stripSource\(_stripLiens\(o\.html\)\);/.test(SRV));
const iRoute = SRV.indexOf("app.get('/api/bank-research-content'");
v('… posée dès l\'entrée de la route', iRoute > 0 && SRV.indexOf('_stripSource(_stripLiens(', iRoute) - iRoute < 1200,
  'écart : ' + (SRV.indexOf('_stripSource(_stripLiens(', iRoute) - iRoute));
const route = SRV.slice(iRoute, iRoute + 30000);
v('… et la route a bien plusieurs sorties à couvrir', (route.match(/res\.json\(\{/g) || []).length >= 5,
  String((route.match(/res\.json\(\{/g) || []).length) + ' sortie(s)');
/* ⚠️ LES RÉCAPS INVESTINGLIVE GARDENT LEURS LIENS. Le lecteur en tire la liste des sources d'un
   rapport, qui est une fonction du produit ; la demande nomme « les rapports institutions », on
   n'élargit pas au-delà. */
const iWrap = SRV.indexOf("app.get('/api/wrap-content'");
v('les récaps InvestingLive ne sont PAS touchés',
  iWrap < 0 || !/_stripLiens/.test(SRV.slice(iWrap, iWrap + 6000)), 'un _stripLiens s\'est glissé dans la route des wraps');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
v('… et le lecteur y collecte toujours ses sources', /sources\.push\(\{ href, text \}\)/.test(APP));

console.log('');
if (ko) { console.log(`✗ ${ko} ÉCHEC(S) — ${ok} contrôle(s) OK, ${ko} KO\n`); process.exit(1); }
console.log(`✓ TOUT PASSE — ${ok} contrôle(s) OK\n`);

#!/usr/bin/env node
/**
 * pubdate-verif.js — UNE PUBLICATION SANS DATE EST UNE PUBLICATION QU'ON NE PEUT PAS LIRE.
 * ------------------------------------------------------------------------------------------------
 * 28/08, capture à l'appui : « ici on a pas de date corrige fixe et vérifie bien pr les futurs
 * rapports d'avoir la date ». Un rapport de l'onglet Institution s'affichait « n.d. ».
 *
 * Le desk préfère « n.d. » à une date inventée — c'est la bonne règle, et elle reste. Mais elle
 * n'excuse pas de n'avoir cherché que dans la liste et sur la page : l'adresse et le DOCUMENT
 * lui-même portent presque toujours la date, et personne ne les lisait.
 *
 * Ce contrôle éprouve les trois lecteurs ajoutés (adresse, en-tête du document, date visible non
 * ambiguë) sur des cas réels — ET leur câblage, parce qu'un lecteur qui marche mais que personne
 * n'appelle ne date aucun rapport. Il tourne sans réseau : les modules sont purs.
 */
const fs = require('fs');
const path = require('path');
const P = require('./../scrapers/pub-date');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (titre, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + titre); }
  else { ko++; console.log('  ✗ ' + titre + (detail ? '\n      → ' + detail : '')); }
};
const j = t => (t ? new Date(t).toISOString().slice(0, 10) : String(t));

console.log('\n── 1. La date écrite dans l\'adresse ──');
/* La piste la moins chère : une date placée dans une URL y est mise par l'éditeur, elle ne bouge
   plus, et la lire ne coûte aucune requête. */
[['https://exemple.com/2026/08/25/note-du-jour', '2026-08-25', '/AAAA/MM/JJ/'],
 ['https://exemple.com/insights/2026-08-25-weekly', '2026-08-25', 'AAAA-MM-JJ'],
 ['https://exemple.com/f/DEF_ENG_20260825.pdf', '2026-08-25', 'huit chiffres collés'],
 ['https://www.mufgresearch.com/macro/us-labor-update-may-8-2026/', '2026-05-08', 'mois-jour-année'],
 ['https://exemple.com/weekly-28-july-2026', '2026-07-28', 'jour-mois-année'],
 ['https://exemple.com/outlook-monthly-august-2026', '2026-08-01', 'mensuel nommé → le 1er'],
].forEach(([u, att, quoi]) => v(`${quoi} → ${att}`, j(P.dateURL(u)) === att, j(P.dateURL(u)) + ' pour ' + u));
/* ⚠️ CE QU'IL NE FAUT SURTOUT PAS ACCEPTER. Une année seule ne dit pas quel jour : rendre le
   1er janvier serait exactement la date inventée qu'on cherche à ne plus afficher. */
v('une année seule ne fait pas une date', P.dateURL('https://exemple.com/perspectives-2026') === null, j(P.dateURL('https://exemple.com/perspectives-2026')));
v('une adresse sans date ne rend rien', P.dateURL('https://www.hsbc.com/wealth/insights/market-and-economy/think-wealth') === null);
v('rien d\'antérieur à 2015', P.dateURL('https://exemple.com/2009/01/02/vieux') === null);
v('rien dans le futur', P.dateURL('https://exemple.com/2099/01/02/demain') === null);
v('un numéro de version n\'est pas une date', P.dateURL('https://exemple.com/doc-v2/1/2') === null, j(P.dateURL('https://exemple.com/doc-v2/1/2')));

console.log('\n── 2. La date imprimée en tête du document ──');
/* Quand ni la liste, ni les métadonnées, ni la page ne datent la publication, il reste le document.
   Le desk en extrait déjà le texte pour le lecteur : on la lit au passage, sans requête de plus. */
v('« 25 August 2026 » sous le titre', j(P.dateEnTete('Think Wealth\n\n25 August 2026\n\nMarkets rallied…')) === '2026-08-25');
v('« August 25, 2026 » aussi', j(P.dateEnTete('Weekly Outlook\nAugust 25, 2026\nLe marché…')) === '2026-08-25');
v('une étiquette ne gêne pas', j(P.dateEnTete('Note\nPublished: 25 August 2026\nx')) === '2026-08-25');
v('l\'ISO passe', j(P.dateEnTete('Weekly\n2026-08-25\nx')) === '2026-08-25');
v('le format européen aussi', j(P.dateEnTete('Weekly\n25/08/2026\nx')) === '2026-08-25');
console.log('  · en français — beaucoup de nos sources rédigent en français :');
v('« 25 août 2026 »', j(P.dateEnTete('Note de conjoncture\n25 août 2026\nx')) === '2026-08-25');
v('« Publié le : 25 août 2026 »', j(P.dateEnTete('Note\nPublié le : 25 août 2026\nx')) === '2026-08-25');
/* ⚠️ « juillet » et « juin » partagent leurs trois premières lettres, « mars » et « mai » aussi :
   un dictionnaire indexé sur trois lettres se trompe de mois une fois sur deux. */
v('« 17 juillet 2026 » n\'est pas juin', j(P.dateEnTete('Weekly\n17 juillet 2026\nx')) === '2026-07-17', j(P.dateEnTete('Weekly\n17 juillet 2026\nx')));
v('« 3 juin 2026 » n\'est pas juillet', j(P.dateEnTete('Weekly\n3 juin 2026\nx')) === '2026-06-03', j(P.dateEnTete('Weekly\n3 juin 2026\nx')));
v('« 1er mars 2026 » n\'est pas mai', j(P.dateEnTete('Weekly\n1er mars 2026\nx')) === '2026-03-01', j(P.dateEnTete('Weekly\n1er mars 2026\nx')));
v('« 4 mai 2026 » n\'est pas mars', j(P.dateEnTete('Weekly\n4 mai 2026\nx')) === '2026-05-04', j(P.dateEnTete('Weekly\n4 mai 2026\nx')));
/* ⚠️ LES DEUX FAUX AMIS QUI JUSTIFIENT TOUTES LES RESTRICTIONS. Une date CITÉE dans une phrase est
   une échéance, pas la date du document ; et une date isolée en plein corps est une date de réunion
   (« Prochaine réunion / 18 septembre 2026 »). On s'arrête donc à l'en-tête, et à la ligne entière. */
v('une date citée dans une phrase est ignorée', P.dateEnTete('Titre\nLe marché attend le 18 septembre 2026 pour la Fed.') === null);
v('une date en plein corps est hors de portée', P.dateEnTete('Titre\n' + Array(40).fill('bla').join('\n') + '\n25 August 2026') === null);
v('un texte sans date ne rend rien', P.dateEnTete('Think Wealth\nMarkets rallied today.') === null);

console.log('\n── 3. La date visible d\'une page inconnue ──');
/* `dateVisible` est réservée aux sources dont on a MESURÉ la page. Sur une source quelconque, le
   même relevé ramasse aussi les vignettes « publications liées », chacune datée : on ne saurait pas
   laquelle est l'article. La règle est binaire — toute la page d'accord, ou on s'abstient. */
const cheerio = require('cheerio');
const UNE  = '<html><body><h1>Note</h1><p>12 August 2026</p><p>Le texte de la note.</p></body></html>';
const DEUX = UNE.replace('</body>', '<aside><a>Autre note</a><span>5 August 2026</span></aside></body>');
v('une seule date sur la page → elle est retenue', j(P.dateVisibleUnique(UNE, cheerio)) === '2026-08-12', j(P.dateVisibleUnique(UNE, cheerio)));
v('deux dates → on s\'abstient', P.dateVisibleUnique(DEUX, cheerio) === null, j(P.dateVisibleUnique(DEUX, cheerio)));
v('la même date deux fois reste une seule date', j(P.dateVisibleUnique(UNE.replace('</body>', '<footer>12 August 2026</footer></body>'), cheerio)) === '2026-08-12');
v('aucune date → rien', P.dateVisibleUnique('<html><body><p>Rien ici.</p></body></html>', cheerio) === null);

console.log('\n── 4. Le câblage — un lecteur que personne n\'appelle ne date rien ──');
const PD = fs.readFileSync(path.join(RACINE, 'scrapers/pub-date.js'), 'utf8');
v('l\'adresse est tentée AVANT la requête', /if \(!STRATEGIES\[source\]\) \{ const tu = dateURL\(url\); if \(tu\) return tu; \}/.test(PD));
v('… et un PDF s\'en contente', /return dateURL\(url\);   \/\/ on ne télécharge pas un PDF entier/.test(PD));
v('la chaîne générique finit par la date visible non ambiguë, puis l\'adresse',
  /return t \|\| dateJsonLd\(html\) \|\| dateMeta\(html\) \|\| dateVisibleUnique\(html, cheerio\) \|\| dateURL\(url\);/.test(PD));
v('les trois lecteurs sont exportés', ['dateURL', 'dateEnTete', 'dateVisibleUnique'].every(f => typeof P[f] === 'function'));

const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
v('le serveur lit la date dans le document ouvert', /function _brDaterAuContenu\(url, html\) \{/.test(SRV));
v('… uniquement sur un rapport non daté', /if \(!it \|\| !it\.dateInconnue\) return;/.test(SRV));
v('… et il retire le marqueur une fois la date trouvée', /it\.timestamp = t;\n    delete it\.dateInconnue;/.test(SRV));
/* La mémoire durable est le point qui compte : sans elle, le prochain rafraîchissement remettrait
   `dateInconnue` et on relirait le même document chaque jour pour la même date. */
v('… la date part dans la mémoire durable des dates', /mem\[url\] = \{ d: t, a: Date\.now\(\), v: _BR_DATES_VER \};/.test(SRV));
v('… et c\'est bien elle qui fait foi au rafraîchissement', /if \(su && su\.d\) \{ it\.timestamp = su\.d; delete it\.dateInconnue; continue; \}/.test(SRV));
/* La route a HUIT sorties `res.json` : une date récupérée sur sept d'entre elles se perdrait sur la
   huitième. On compte les sorties, et on vérifie qu'elles passent toutes par le même point. */
const _rt = SRV.slice(SRV.indexOf("app.get('/api/bank-research-content'"), SRV.indexOf("app.get('/api/bank-research-content'") + 30000);
v('l\'accroche enveloppe l\'unique sortie commune', /const _jsonBrut = res\.json\.bind\(res\);\n  res\.json = \(o\) => \{ try \{ if \(o\) _brDaterAuContenu\(url, o\.html\); \} catch \(e\) \{\} return _jsonBrut\(o\); \};/.test(SRV));
v('… et la route a bien plusieurs sorties à couvrir', (_rt.match(/res\.json\(\{/g) || []).length >= 5, String((_rt.match(/res\.json\(\{/g) || []).length) + ' sortie(s)');

const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
v('« n.d. » ne s\'affiche que faute de date', /const dateStr = _nd \? 'n\.d\.' :/.test(APP));
v('… et il s\'explique au survol', /Date de publication non communiquée par la source\./.test(APP));

console.log('');
if (ko) { console.log(`✗ ${ko} ÉCHEC(S) — ${ok} contrôle(s) OK, ${ko} KO\n`); process.exit(1); }
console.log(`✓ TOUT PASSE — ${ok} contrôle(s) OK\n`);

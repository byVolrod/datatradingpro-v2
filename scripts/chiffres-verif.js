#!/usr/bin/env node
/**
 * scripts/chiffres-verif.js — « LES CHIFFRES QUI ONT MARQUÉ LA SEMAINE » : ORDRE ET COULEUR.
 * ------------------------------------------------------------------------------------------------
 * 12/09, deux demandes du client sur la MÊME liste du Récap Hebdo :
 *   · « classe par ordre chronologique des dates » — elle sortait mercredi 9, jeudi 10, lundi 7,
 *     mardi 8… parce qu'elle était triée par RANG DE FAMILLE, le chronologique n'arrivant qu'en
 *     départage, donc jamais entre familles différentes ;
 *   · « il manque les couleurs pour distinguer si c'est positif ou négatif ou neutre » — ces puces
 *     sont des CHAÎNES rendues par un moteur qui échappe le HTML, aucune couleur ne pouvait s'y
 *     glisser.
 *
 * ⚠️ CE BANC EXÉCUTE LA VRAIE FONCTION, extraite de server.js — pas une copie. Une copie aurait
 * divergé à la première retouche, et c'est exactement le genre de banc qui reste vert pendant que le
 * produit change. Les deux dépendances (`_calClassify`, `_RECAP_RANG`) sont fournies en doublure :
 * ce qu'on éprouve ici est le TRI et la FORME de sortie, pas la table de classement des indicateurs.
 *
 * ⚠️ ET LE PIÈGE QUE CE BANC SURVEILLE VRAIMENT : le tri par famille n'était PAS décoratif — c'est
 * lui qui décide quelles dix lignes survivent au plafond. Trier chronologiquement AVANT de couper
 * ferait entrer dix publications mineures d'un lundi chargé à la place d'un IPC du vendredi. Les
 * deux rôles doivent rester séparés, et un contrôle dédié le vérifie.
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };

const SRC = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const deb = SRC.indexOf('function _recapChiffresSemaine(cal) {');
if (deb < 0) { console.log('\n[chiffres-verif] _recapChiffresSemaine introuvable dans server.js\n'); process.exit(1); }
/* Bornes d'extraction : de la signature à la fonction suivante. Un banc qui annonce « le vrai code »
   doit dire OÙ il coupe — le 10/09 a coûté un déploiement sur une borne devenue fausse. */
const fin = SRC.indexOf('\nfunction _isMajorCal(', deb);
if (fin < 0) { console.log('\n[chiffres-verif] borne de fin introuvable (fonction _isMajorCal déplacée ?)\n'); process.exit(1); }
const CODE = SRC.slice(deb, fin);

/* Doublures : toute ligne est « classable », et trois familles de rangs distincts pour que le tri par
   famille ait de quoi s'exprimer — sinon le contrôle de sélection ne prouverait rien. */
const _RECAP_RANG = { Inflation: 0, Emploi: 1, Croissance: 2 };
const FAM = { CPI: 'Inflation', PPI: 'Inflation', NFP: 'Emploi', Chomage: 'Emploi', PIB: 'Croissance', Ventes: 'Croissance' };
const _calClassify = t => { const f = FAM[String(t || '').split(' ')[0]]; return f ? { family: f } : null; };
const fabrique = new Function('_calClassify', '_RECAP_RANG', CODE + '\nreturn _recapChiffresSemaine;');
const _recapChiffresSemaine = fabrique(_calClassify, _RECAP_RANG);

/* Jours VOLONTAIREMENT mélangés dans l'ordre de famille : c'est la configuration qui produisait la
   capture du client. Chaque devise est distincte, sinon la déduplication famille+devise en écarte. */
const cal = { past: [
  { dayLabel: 'Lundi 7 sept.',    events: [{ title: 'PIB q/q',   currency: 'CHF', actual: '0.3%', forecast: '0.2%' }] },
  { dayLabel: 'Mardi 8 sept.',    events: [{ title: 'NFP change', currency: 'USD', actual: '120K', forecast: '150K' }] },
  { dayLabel: 'Mercredi 9 sept.', events: [{ title: 'CPI y/y',    currency: 'CNY', actual: '0.8%', forecast: '0.8%' }] },
  { dayLabel: 'Jeudi 10 sept.',   events: [{ title: 'Ventes m/m', currency: 'GBP', actual: '0.4%', forecast: '0.1%' }] },
  { dayLabel: 'Vendredi 11 sept.',events: [{ title: 'PPI m/m',    currency: 'JPY', actual: '0.5%', forecast: '0.4%' }] },
] };

console.log('\n── L\'ordre est CHRONOLOGIQUE, pas celui des familles ──');
const r = _recapChiffresSemaine(cal);
v('la section est bien produite', !!r && Array.isArray(r.bullets), JSON.stringify(r && Object.keys(r || {})));
v('[exécuté] elle porte désormais les lignes STRUCTURÉES (rows)', !!(r && Array.isArray(r.rows) && r.rows.length),
  'sans rows, le client ne peut pas colorer : il ne reçoit qu\'une phrase déjà échappée');
if (r && r.rows) {
  const jours = r.rows.map(x => x.jour);
  const attendu = ['Lundi 7 sept.', 'Mardi 8 sept.', 'Mercredi 9 sept.', 'Jeudi 10 sept.', 'Vendredi 11 sept.'];
  v('[exécuté] les jours sortent du lundi au vendredi', JSON.stringify(jours) === JSON.stringify(attendu),
    'ordre obtenu : ' + jours.join(' | ') + '\n        attendu : ' + attendu.join(' | '));
  /* Les puces de texte doivent suivre le MÊME ordre : elles restent le repli des rapports archivés,
     et deux ordres différents dans un même rapport seraient pires que le défaut d'origine. */
  v('[exécuté] les puces de texte suivent le même ordre que les lignes structurées',
    r.bullets.every((b, i) => String(b).indexOf(r.rows[i].jour) >= 0),
    'puces : ' + r.bullets.map(b => String(b).slice(0, 18)).join(' | '));
  v('[exécuté] chaque ligne porte le réel ET l\'attendu (de quoi calculer la couleur)',
    r.rows.every(x => x.actual && x.forecast),
    JSON.stringify(r.rows.map(x => [x.actual, x.forecast])));
  v('[exécuté] la devise et l\'intitulé sont conservés', r.rows.every(x => x.ccy && x.titre),
    JSON.stringify(r.rows.map(x => x.ccy)));
}

console.log('\n── Le rang de famille SÉLECTIONNE encore : il n\'a pas été remplacé par la date ──');
/* Onze publications : un lundi chargé de six lignes de CROISSANCE (rang 2, le plus faible) face à
   cinq INFLATION réparties plus tard dans la semaine. Un tri chronologique AVANT la coupe ne
   garderait que le lundi ; la sélection doit encore faire passer les inflations. */
const charge = { past: [
  { dayLabel: 'Lundi 7 sept.', events: Array.from({ length: 6 }, (_, i) => ({ title: 'Ventes m/m', currency: 'C' + i, actual: '1%', forecast: '1%' })) },
  { dayLabel: 'Mardi 8 sept.', events: Array.from({ length: 5 }, (_, i) => ({ title: 'CPI y/y', currency: 'I' + i, actual: '2%', forecast: '2%' })) },
] };
const rc = _recapChiffresSemaine(charge);
const nbInfl = (rc && rc.rows || []).filter(x => /Mardi/.test(x.jour)).length;
v('[exécuté] les INFLATION du mardi ne sont pas évincées par le lundi chargé', nbInfl === 5,
  nbInfl + ' inflation(s) retenue(s) sur 5 — si 0, la date a remplacé le rang de famille au lieu de le compléter');
v('[exécuté] … et l\'ordre reste chronologique malgré tout',
  !!(rc && rc.rows && rc.rows.length && /Lundi/.test(rc.rows[0].jour) && /Mardi/.test(rc.rows[rc.rows.length - 1].jour)),
  rc && rc.rows ? rc.rows.map(x => x.jour).join(' | ') : '');

console.log('\n── Témoin : le tri chronologique retiré, la capture du client revient ──');
/* Mutation : on remet le tri d'origine (famille seule). Si les jours restent en ordre, c'est que le
   contrôle ci-dessus ne mesure pas ce correctif. */
const CODE_MUTE = CODE.replace(/const liste = retenues\.slice\(\)\.sort\(\(a, b\) => _dateDe\(a\) - _dateDe\(b\)\);/, 'const liste = retenues;');
v('le tri chronologique est bien dans le code (sinon le témoin ne mute rien)', CODE_MUTE !== CODE);
const mute = new Function('_calClassify', '_RECAP_RANG', CODE_MUTE + '\nreturn _recapChiffresSemaine;')(_calClassify, _RECAP_RANG);
const rm = mute(cal);
const joursMute = (rm && rm.rows || []).map(x => x.jour);
v('[exécuté] sans lui, les jours ressortent dans le désordre',
  JSON.stringify(joursMute) !== JSON.stringify(['Lundi 7 sept.', 'Mardi 8 sept.', 'Mercredi 9 sept.', 'Jeudi 10 sept.', 'Vendredi 11 sept.']),
  'ordre muté : ' + joursMute.join(' | '));

console.log('\n── Le client sait lire ces lignes, et retombe sur les puces sans elles ──');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
v('le rendu structuré est branché (Array.isArray(s.rows))', /Array\.isArray\(s\.rows\)\s*&&\s*s\.rows\.length/.test(APP));
v('il applique la règle de couleur PARTAGÉE du rapport (_dataCls)', /_dataCls\(r\.actual, r\.forecast/.test(APP));
v('et il garde le repli sur les puces pour les rapports archivés', /\(s\.bullets \|\| \[\]\)\.forEach/.test(APP));

console.log(ko ? `\n✗ ${ko} contrôle(s) en échec\n` : `\n✓ ${ok} contrôles au vert\n`);
process.exit(ko ? 1 : 0);

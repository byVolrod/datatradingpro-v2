#!/usr/bin/env node
/**
 * calendrier-verif.js — L'HORLOGE DU FLUX FOREXFACTORY.
 * ------------------------------------------------------------------------------------------------
 * Le 16/09, une capture client comparant notre calendrier à forexfactory.com montrait DEUX lignes
 * « CPI y/y » le même jour : la vraie à 08h00 (3,1 %) et une seconde à 12h00 portant 3,4 % — le
 * chiffre du RPI publié à la même heure. Ni le doublon ni le chiffre faux n'étaient la cause : les
 * deux découlent d'un SEUL défaut, l'horloge du flux lue comme de l'heure de New York alors qu'elle
 * est en UTC. Chaque rendez-vous atterrissait quatre heures trop tard (cinq l'hiver), donc :
 *   · il ne tombait plus dans la fenêtre de ±90 min où `_calFusionFF` reconnaît sa jumelle
 *     TradingView → il entrait comme un événement de PLUS, et l'archive rejouait la jumelle retirée ;
 *   · faute d'appariement, son résultat venait du rattrapage large de `_refreshTVActuals`, qui se
 *     contente d'UN mot-clé commun → il a pris celui du voisin ;
 *   · et l'heure affichée au client était fausse de quatre heures, ce qui suffit à lui faire rater
 *     la publication.
 *
 * CE BANC JOUE LA VRAIE FONCTION (`parseEventTime`, exportée par scrapers/forexfactory.js — pas une
 * copie, pas une tranche extraite) sur les HUIT publications mesurées dans l'archive servie en
 * production, réparties sur quatre devises et sur toute la journée. Son témoin remet l'offset
 * américain : il doit faire rougir, sinon le banc ne mesure rien.
 */
const path = require('path');
const { parseEventTime } = require(path.join(__dirname, '..', 'scrapers', 'forexfactory.js'));

let ok = 0, ko = 0;
const vert = m => { ok++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const rouge = (m, d) => { ko++; console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); };
const titre = t => console.log('\n── ' + t + ' ──');

/* LES HUIT PUBLICATIONS MESURÉES. `heure` est ce que le flux écrit ; `vraiUTC` est l'instant réel de
   la publication, celui que forexfactory.com affiche et que TradingView porte nativement. Toutes
   sont datées d'une journée d'HEURE D'ÉTÉ américaine : c'est la période où le défaut valait +4 h.  */
const MESURES = [
  { quoi: 'IPC britannique',            date: '09-16-2026', heure: '6:00am',  vraiUTC: '2026-09-16T06:00:00Z' },
  { quoi: 'IPC américain',              date: '09-11-2026', heure: '12:30pm', vraiUTC: '2026-09-11T12:30:00Z' },
  { quoi: 'ISM manufacturier',          date: '09-01-2026', heure: '2:00pm',  vraiUTC: '2026-09-01T14:00:00Z' },
  { quoi: 'décision BCE',               date: '09-10-2026', heure: '12:15pm', vraiUTC: '2026-09-10T12:15:00Z' },
  { quoi: 'conférence de presse BCE',   date: '09-10-2026', heure: '12:45pm', vraiUTC: '2026-09-10T12:45:00Z' },
  { quoi: 'IPC suisse',                 date: '09-03-2026', heure: '6:30am',  vraiUTC: '2026-09-03T06:30:00Z' },
  { quoi: 'décision RBNZ',              date: '09-02-2026', heure: '2:00am',  vraiUTC: '2026-09-02T02:00:00Z' },
  { quoi: 'PIB australien',             date: '09-02-2026', heure: '1:30am',  vraiUTC: '2026-09-02T01:30:00Z' },
];

function extraire(nom) {
  const i = SRV.indexOf('function ' + nom + '(');
  if (i < 0) return null;
  let prof = 0;
  for (let k = SRV.indexOf('{', i); k < SRV.length; k++) {
    if (SRV[k] === '{') prof++;
    else if (SRV[k] === '}') { prof--; if (prof === 0) return SRV.slice(i, k + 1); }
  }
  return null;
}
titre('Les huit publications mesurées tombent à la bonne seconde');
for (const m of MESURES) {
  const attendu = Date.parse(m.vraiUTC);
  const obtenu = parseEventTime(m.date, m.heure);
  const ecartMin = Math.round((obtenu - attendu) / 60000);
  if (obtenu === attendu) vert(`${m.quoi} : ${m.heure} → ${new Date(obtenu).toISOString()}`);
  else rouge(`${m.quoi} : ${ecartMin > 0 ? '+' : ''}${ecartMin} min d'écart`,
    `attendu ${new Date(attendu).toISOString()}, obtenu ${new Date(obtenu).toISOString()}`);
}

titre("L'hiver ne rouvre pas le décalage");
/* L'ancienne écriture basculait sur -05:00 hors heure d'été : le défaut devenait +5 h en janvier.
   Une horloge UTC ne connaît pas de saison — on l'éprouve des deux côtés du changement d'heure. */
for (const [quoi, date, heure, vraiUTC] of [
  ['plein hiver',              '01-14-2027', '1:30pm', '2027-01-14T13:30:00Z'],
  ['veille du passage à l\'été', '03-13-2027', '1:30pm', '2027-03-13T13:30:00Z'],
  ['lendemain du passage',      '03-15-2027', '1:30pm', '2027-03-15T13:30:00Z'],
  ['retour à l\'heure d\'hiver', '11-08-2026', '1:30pm', '2026-11-08T13:30:00Z'],
]) {
  const obtenu = parseEventTime(date, heure);
  if (obtenu === Date.parse(vraiUTC)) vert(`${quoi} (${date}) : aucun décalage saisonnier`);
  else rouge(`${quoi} (${date}) : ${Math.round((obtenu - Date.parse(vraiUTC)) / 60000)} min d'écart`);
}

titre('Les cas limites de l\'horloge de 12 h');
for (const [quoi, heure, hhmm] of [
  ['minuit',     '12:00am', '00:00'],
  ['midi',       '12:00pm', '12:00'],
  ['12h59 du matin', '12:59am', '00:59'],
  ['23h59',      '11:59pm', '23:59'],
]) {
  const obtenu = parseEventTime('09-16-2026', heure);
  const attendu = Date.parse('2026-09-16T' + hhmm + ':00Z');
  if (obtenu === attendu) vert(`${quoi} : ${heure} → ${hhmm} UTC`);
  else rouge(`${quoi} : ${heure} rendu ${new Date(obtenu).toISOString().slice(11, 16)} au lieu de ${hhmm}`);
}

titre('Une date illisible ne fabrique pas un horodatage');
/* Sans date exploitable la fonction rend `Date.now()` : c'est un repli assumé (mieux vaut une ligne
   à l'heure courante qu'une exception qui vide le calendrier), mais il ne doit pas devenir une date
   de 1970 ni une valeur hors du temps. */
for (const [quoi, d, h] of [['date vide', '', '6:00am'], ['date absurde', 'pas-une-date', '6:00am'], ['date nulle', null, null]]) {
  const t = parseEventTime(d, h);
  if (Number.isFinite(t) && Math.abs(t - Date.now()) < 5000) vert(`${quoi} : repli sur l'heure courante`);
  else rouge(`${quoi} : rend ${t} (${new Date(t).toISOString()})`);
}

titre('Témoin : remettre l\'offset américain doit faire rougir');
/* Sans témoin, un banc peut être vert parce qu'il ne mesure rien. On rejoue ici l'ANCIENNE écriture,
   telle qu'elle était avant le 16/09, et on exige qu'elle échoue sur les mêmes mesures. */
function parseEventTimeAvant(dateStr, timeStr) {
  const [mm, dd, yyyy] = String(dateStr || '').split('-').map(Number);
  let hh = 0, min = 0;
  const m = String(timeStr || '').match(/^(\d+):(\d+)\s*(am|pm)$/i);
  if (m) { hh = +m[1]; min = +m[2]; if (/pm/i.test(m[3]) && hh !== 12) hh += 12; if (/am/i.test(m[3]) && hh === 12) hh = 0; }
  const base = new Date(yyyy, mm - 1, dd);
  const edtStart = new Date(yyyy, 2, 8); while (edtStart.getDay() !== 0) edtStart.setDate(edtStart.getDate() + 1);
  const edtEnd = new Date(yyyy, 10, 1); while (edtEnd.getDay() !== 0) edtEnd.setDate(edtEnd.getDate() + 1);
  const offset = (base >= edtStart && base < edtEnd) ? '-04:00' : '-05:00';
  return new Date(`${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}:00${offset}`).getTime();
}
const mordus = MESURES.filter(m => parseEventTimeAvant(m.date, m.heure) !== Date.parse(m.vraiUTC));
if (mordus.length === MESURES.length) vert(`l'ancienne écriture rate les ${MESURES.length} mesures (décalage +4 h) : le banc mord bien`);
else rouge(`le témoin ne mord que sur ${mordus.length}/${MESURES.length} mesures — le banc ne prouve rien`);

const ecartTemoin = parseEventTimeAvant('09-16-2026', '6:00am') - Date.parse('2026-09-16T06:00:00Z');
if (ecartTemoin === 4 * 3600000) vert("et l'écart du témoin vaut exactement les +4 h mesurés en production");
else rouge(`l'écart du témoin vaut ${ecartTemoin / 3600000} h, pas les +4 h mesurés`);

titre('La fenêtre d\'appariement de _calFusionFF redevient atteignable');
/* Le doublon n'est pas une conséquence lointaine : il se calcule. `_FF_FENETRE_MS` vaut 90 min dans
   server.js — on relit la VRAIE valeur plutôt que de la recopier, sinon un jour où elle change le
   banc raconterait l'ancienne. Avec l'horloge corrigée l'écart est nul, donc très en deçà ; avec
   l'ancienne il valait 240 min, donc hors d'atteinte, et les deux lignes ne pouvaient pas fusionner. */
const fs = require('fs');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const mFen = SRV.match(/_FF_FENETRE_MS\s*=\s*(\d+)\s*\*\s*(\d+)/);
const fenetreMin = mFen ? (Number(mFen[1]) * Number(mFen[2])) / 60000 : null;
if (!fenetreMin) {
  rouge('_FF_FENETRE_MS introuvable dans server.js', 'le banc ne peut pas vérifier la fenêtre d\'appariement');
} else {
  const tvUTC = Date.parse('2026-09-16T06:00:00Z');            // la ligne TradingView de l'IPC britannique
  const ecartApres = Math.abs(parseEventTime('09-16-2026', '6:00am') - tvUTC) / 60000;
  const ecartAvant = Math.abs(parseEventTimeAvant('09-16-2026', '6:00am') - tvUTC) / 60000;
  if (ecartApres <= fenetreMin) vert(`la ligne FF tombe à ${ecartApres} min de sa jumelle TradingView (fenêtre ${fenetreMin} min)`);
  else rouge(`la ligne FF reste à ${ecartApres} min de sa jumelle, hors de la fenêtre de ${fenetreMin} min`);
  if (ecartAvant > fenetreMin) vert(`témoin : avant le correctif elle était à ${ecartAvant} min, donc hors fenêtre — d'où le doublon`);
  else rouge(`témoin muet : l'ancienne écriture tombait déjà dans la fenêtre (${ecartAvant} min)`);
}

titre("L'archive ne rejoue pas une publication déjà à l'écran sous un autre nom");
/* CEINTURE, pas réparation. L'horloge est corrigée, mais les entrées écrites AVANT le correctif
   restent dans l'archive persistée (mesuré le 16/09 : 36 lignes, jusqu'à six mois de survie). Sans
   cette seconde reconnaissance, le doublon du client resterait à l'écran jusqu'à leur expiration.
   On EXÉCUTE le vrai `_calHistMerge`, extrait de server.js. Le renommage lui est fourni en doublure
   volontairement minimale : ce qui est éprouvé ici, c'est la LOGIQUE DE FUSION qui vient de changer,
   pas la table de correspondance, qui a ses propres contrôles ailleurs. */
{
  const iM = SRV.indexOf('function _calHistMerge(');
  let src = null;
  if (iM >= 0) {
    let prof = 0;
    for (let k = SRV.indexOf('{', iM); k < SRV.length; k++) {
      if (SRV[k] === '{') prof++;
      else if (SRV[k] === '}') { prof--; if (prof === 0) { src = SRV.slice(iM, k + 1); break; } }
    }
  }
  if (!src) {
    rouge('`_calHistMerge` introuvable dans server.js', "ce contrôle n'éprouve plus rien, il faut le recâbler");
  } else {
    vert(`\`_calHistMerge\` extrait de server.js (${src.length} caractères)`);
    const RENOMME = { 'Inflation Rate YoY': 'CPI y/y', 'Core Inflation Rate YoY': 'Core CPI y/y' };
    const monter = (archive) => {
      const _calHist = new Map();
      const _calHistKey = e => e.currency + '|' + String(e.ctry || '') + '|' + String(e.title).toLowerCase().replace(/\s+/g, ' ').trim();
      for (const e of archive) _calHist.set(_calHistKey(e), { ...e, _k: _calHistKey(e) });
      const f = new Function('_calHist', '_calHistKey', '_ffDisplayTitle', '_CAL_SPEECH_RX',
        src + '\nreturn _calHistMerge;');
      return f(_calHist, _calHistKey, e => RENOMME[e.title] || e.title, /speaks|speech|testimony|press conf/i);
    };
    const hier = Date.now() - 6 * 3600000;
    // La situation exacte de la capture : la fenêtre porte la ligne du fournisseur qui NOMME
    // (« CPI y/y »), l'archive porte la même publication sous le nom du fournisseur qui CHIFFRE.
    const fenetre = [{ currency: 'GBP', ctry: '', title: 'CPI y/y', timestamp: hier, actual: '3.1%', forecast: '3.1%', previous: '2.9%' }];
    const archive = [{ currency: 'GBP', ctry: 'GB', title: 'Inflation Rate YoY', timestamp: hier - 4 * 3600000, actual: '3.1%', forecast: '3.1%', previous: '2.9%' }];
    const fusion = monter(archive)(fenetre);
    const cpi = fusion.filter(e => (RENOMME[e.title] || e.title) === 'CPI y/y' && e.currency === 'GBP');
    if (cpi.length === 1) vert("une seule ligne « CPI y/y » sort de la fusion, pas deux à quatre heures d'écart");
    else rouge(`${cpi.length} lignes « CPI y/y » sortent de la fusion`, cpi.map(e => `${e.title} @${new Date(e.timestamp).toISOString()}`).join(' · '));
    if (cpi.length && cpi[0].title === 'CPI y/y' && cpi[0].timestamp === hier) vert("et c'est la ligne de la fenêtre fraîche qui reste, pas celle de l'archive");
    else rouge("la ligne conservée n'est pas celle de la fenêtre fraîche");

    // TÉMOIN INVERSE — on ne doit pas avoir troqué un doublon contre un trou.
    const autreJour = monter([{ currency: 'GBP', ctry: 'GB', title: 'Inflation Rate YoY', timestamp: hier - 30 * 86400000, actual: '2.8%', forecast: '', previous: '' }])(fenetre);
    if (autreJour.length === 2) vert("la publication du mois dernier, elle, est bien rappelée par l'archive");
    else rouge(`l'archive ne rappelle plus la publication d'un autre jour (${autreJour.length} ligne(s))`, 'on aurait remplacé un doublon par un trou');

    const autreDevise = monter([{ currency: 'USD', ctry: 'US', title: 'Inflation Rate YoY', timestamp: hier, actual: '2.4%', forecast: '', previous: '' }])(fenetre);
    if (autreDevise.length === 2) vert("le même indicateur sur une AUTRE devise n'est pas confondu");
    else rouge("une autre devise a été prise pour un doublon");

    // Les prises de parole : plusieurs officiels parlent le même jour sous un libellé générique.
    const fenetreDisc = [{ currency: 'USD', ctry: 'US', title: 'FOMC Member Speaks', timestamp: hier, actual: '-', forecast: '', previous: '' }];
    const discours = monter([{ currency: 'USD', ctry: 'US', title: 'FOMC Member Speaks', timestamp: hier - 3 * 3600000, actual: '-', forecast: '', previous: '' }])(fenetreDisc);
    if (discours.length === 2) vert('deux prises de parole du même jour restent deux événements distincts');
    else rouge('une prise de parole a été avalée comme un doublon');

    // TÉMOIN DE MUTATION — sans la nouvelle reconnaissance, le doublon revient.
    const mute = src.replace(/&& !dejaVu\(e, e\.timestamp \|\| 0\)/, '');
    if (mute === src) {
      rouge("la mutation du témoin n'a rien changé au source", 'la garde a changé de forme : ce témoin ne prouve plus rien');
    } else {
      const _calHist = new Map();
      const kf = e => e.currency + '|' + String(e.ctry || '') + '|' + String(e.title).toLowerCase().replace(/\s+/g, ' ').trim();
      for (const e of archive) _calHist.set(kf(e), { ...e, _k: kf(e) });
      const sansGarde = new Function('_calHist', '_calHistKey', '_ffDisplayTitle', '_CAL_SPEECH_RX', mute + '\nreturn _calHistMerge;')(
        _calHist, kf, e => RENOMME[e.title] || e.title, /speaks|speech|testimony|press conf/i);
      const n = sansGarde(fenetre).filter(e => (RENOMME[e.title] || e.title) === 'CPI y/y').length;
      if (n === 2) vert('témoin : sans la garde, les deux « CPI y/y » reviennent bien');
      else rouge(`témoin muet : sans la garde on obtient ${n} ligne(s) au lieu de 2`);
    }
  }
}


titre('Deux CPI y/y à la même heure : un seul rendez-vous');
/* ⚠️ SECONDE CAPTURE USER (16/09) : « pourquoi on a 2 CPI y/y alors que sur forexfactory y'en a 1,
   et le bon c'est celui qui est sorti à 3.1 ». Le doublon du matin venait de l'horloge du flux,
   corrigée le même jour ; une fois les deux lignes ramenées à la MÊME heure, elles auraient dû
   fusionner ici. Elles ne l'ont pas fait : la clé portait le PAYS, la ligne ForexFactory arrive avec
   un pays VIDE et la ligne TradingView avec « GB ». Deux clés, deux lignes, le même rendez-vous. */
{
  const SRC_H = extraire('_calDropHomonyms');
  const SRC_C = extraire('_calPaysCompatible');
  if (!SRC_H || !SRC_C) {
    rouge('`_calDropHomonyms` / `_calPaysCompatible` introuvables', 'contrôle à recâbler');
  } else {
    vert('la déduplication des homonymes est extraite de server.js');
    const drop = new Function('_CAL_SPEECH_RX',
      SRC_C + '\n' + SRC_H + '\nreturn _calDropHomonyms;')(/speaks|speech|testimony|press conf/i);
    const T = 1789531200000;   // une heure quelconque, la même pour tous

    // LE CAS DE LA CAPTURE : la ligne qui SAIT son pays porte 3,1% ; celle qui l'ignore porte 3,4%.
    const capture = [
      { currency: 'GBP', ctry: '',   title: 'CPI y/y', timestamp: T, impact: 'High', actual: '3.4%', forecast: '3.1%' },
      { currency: 'GBP', ctry: 'GB', title: 'CPI y/y', timestamp: T, impact: 'High', actual: '3.1%', forecast: '3.1%' },
    ];
    const r = drop(capture);
    if (r.length === 1) vert('une seule ligne « CPI y/y » survit');
    else rouge(r.length + ' lignes survivent : le doublon de la capture est toujours là', JSON.stringify(r.map(x => x.actual)));
    if (r.length === 1 && r[0].actual === '3.1%') vert('… et c\'est bien celle à 3,1%, la ligne qui porte son pays');
    else if (r.length === 1) rouge('la mauvaise ligne a été gardée', r[0].actual);

    // CONTRE-EXEMPLE QUI COMPTE : deux PAYS connus et différents ne fusionnent JAMAIS.
    const euro = [
      { currency: 'EUR', ctry: 'ES', title: 'CPI y/y', timestamp: T, impact: 'High', actual: '2.1%' },
      { currency: 'EUR', ctry: 'IT', title: 'CPI y/y', timestamp: T, impact: 'High', actual: '1.7%' },
    ];
    if (drop(euro).length === 2) vert('l\'IPC espagnol et l\'italien de la même heure restent DEUX lignes (règle du 31/08 intacte)');
    else rouge('deux pays distincts ont été fusionnés : la correction du 31/08 est perdue');

    // Trois lignes : deux pays connus + une sans pays → elle rejoint le premier compatible, pas les deux.
    const trois = [
      { currency: 'EUR', ctry: 'ES', title: 'CPI y/y', timestamp: T, impact: 'High', actual: '2.1%' },
      { currency: 'EUR', ctry: 'IT', title: 'CPI y/y', timestamp: T, impact: 'High', actual: '1.7%' },
      { currency: 'EUR', ctry: '',   title: 'CPI y/y', timestamp: T, impact: 'Medium', actual: '' },
    ];
    if (drop(trois).length === 2) vert('une ligne sans pays rejoint UN groupe, elle n\'en efface pas deux');
    else rouge('la ligne sans pays a mal fusionné', String(drop(trois).length));

    // Les prises de parole restent intactes : plusieurs officiels parlent à la même heure.
    const disc = [
      { currency: 'USD', ctry: 'US', title: 'FOMC Member Speaks', timestamp: T, impact: 'Medium' },
      { currency: 'USD', ctry: '',   title: 'FOMC Member Speaks', timestamp: T, impact: 'Medium' },
    ];
    if (drop(disc).length === 2) vert('deux prises de parole à la même heure restent deux événements');
    else rouge('une prise de parole a été avalée');

    // TÉMOIN : on remet le pays dans la clé de regroupement, le doublon doit revenir.
    const mute = SRC_H.replace("const k = e.currency + '|' + e.timestamp", "const k = e.currency + '|' + (e.ctry || e.country || '') + '|' + e.timestamp");
    if (mute === SRC_H) {
      rouge('la mutation du témoin n\'a rien changé', 'la clé a changé de forme : ce témoin ne prouve plus rien');
    } else {
      const dropM = new Function('_CAL_SPEECH_RX', SRC_C + '\n' + mute + '\nreturn _calDropHomonyms;')(/speaks|speech/i);
      if (dropM(capture).length === 2) vert('(témoin) avec le pays dans la clé, les deux CPI reviennent bien');
      else rouge('(témoin) la mutation ne mord pas');
    }
  }
}

console.log(`\n${ko ? '\x1b[31m✗' : '\x1b[32m✓'} ${ok} contrôle${ok > 1 ? 's' : ''} au vert${ko ? `, \x1b[31m${ko} au rouge` : ''}\x1b[0m`);
process.exit(ko ? 1 : 0);

#!/usr/bin/env node
/**
 * scripts/plafond-verif.js — LE DESK APPREND CE QUE LA CHAÎNE GRATUITE ENCAISSE, IL NE LE DEVINE PAS
 *
 * POURQUOI (16/09).
 * Le Récap Quotidien est resté bloqué des jours sur son repli anglais. MESURÉ, en classant les
 * quinze appels IA du desk par taille : le sien demande ~19 400 jetons (12 400 de prompt + 7 000 de
 * sortie), quand le deuxième en demande 13 300 et le troisième 9 000. Les offres gratuites de la
 * cascade plafonnent PAR REQUÊTE bien en dessous. Un appel trop gros n'est pas lent : il est
 * REFUSÉ, à tous les coups, chez chaque fournisseur, toutes les quinze minutes, indéfiniment.
 *
 * ⚠️ ET UNE CONSTANTE EN DUR AURAIT REFAIT LE MUR. Les plafonds gratuits bougent sans prévenir.
 * Une valeur écrite dans le code serait fausse un jour, sans que rien ne le dise : exactement la
 * maladie du faux vert. Le desk apprend donc, par fournisseur, la plus grosse requête RÉELLEMENT
 * acceptée et la plus petite RÉELLEMENT refusée pour cause de taille, et sait dire d'avance ce que
 * la chaîne encaisse. Même principe que la demande horaire apprise, déjà affichée au panneau.
 *
 * CE BANC EXÉCUTE LE VRAI MODULE (`require('../ai')`), pas une copie. Une copie dériverait, et un
 * banc qui récite sa propre copie est vert par construction.
 *
 *   node scripts/plafond-verif.js
 */
const path = require('path');
const fs = require('fs');

process.env.OVH_SMTP_USER = process.env.OVH_SMTP_USER || 'verif';
const ai = require(path.join(__dirname, '..', 'ai.js'));
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ══ 1. RECONNAÎTRE UN REFUS DE TAILLE, ET LUI SEUL ═══════════════════════════════════════════
   ⚠️ LE PIÈGE CENTRAL : un 429 nu veut dire « minute chargée », pas « requête trop grosse ». Le
   confondre ferait RÉTRÉCIR le plafond appris à chaque pic de trafic, définitivement, jusqu'à ce
   que le desk n'envoie plus que des requêtes minuscules — une panne lente, silencieuse, et dont
   personne ne pourrait remonter la cause. C'est le contrôle le plus important du fichier. */
console.log('\n── Un refus de TAILLE, et rien d\'autre ──');
const CAS = [
  ['Groq 413, plafond par minute', { status: 413, message: 'Request too large for model llama-3.3-70b-versatile on tokens per minute (TPM): Limit 12000, Requested 19435' }, true],
  ['GitHub Models, contexte maximum', { status: 400, message: 'This model maximum context length is 8000 tokens' }, true],
  ['OpenRouter, prompt trop long', { status: 400, message: 'Prompt is too long: 21000 tokens > 16384' }, true],
  ['un 413 nu (le statut suffit)', { status: 413, message: 'Payload Too Large' }, true],
  ['429 NU : minute chargée, PAS un plafond', { status: 429, message: 'Rate limit exceeded, please retry in 12s' }, false],
  ['429 quota JOURNALIER : pas un plafond non plus', { status: 429, message: 'You exceeded your current quota, quotaId: GenerateRequestsPerDayPerProject' }, false],
  ['500 du fournisseur', { status: 500, message: 'Internal server error' }, false],
  ['panne réseau', { message: 'fetch failed' }, false],
  ['erreur nulle', null, false],
];
for (const [nom, e, att] of CAS) v(nom + ' → ' + (att ? 'compte' : 'ne compte pas'), ai.estRefusTaille(e) === att, 'rendu=' + ai.estRefusTaille(e));

/* ══ 2. LE BUDGET D'UN APPEL ══════════════════════════════════════════════════════════════════ */
console.log('\n── Le budget d\'un appel : prompt + sortie, parce que c\'est la SOMME qui est plafonnée ──');
v('un prompt vide ne coûte que sa sortie', ai.budgetAppel('', 2500) === 2500);
v('le prompt compte (français ~3,2 car./jeton)', ai.budgetAppel('x'.repeat(3200), 0) === 1000, String(ai.budgetAppel('x'.repeat(3200), 0)));
v('les deux s\'additionnent', ai.budgetAppel('x'.repeat(3200), 500) === 1500);
v('null/undefined ne cassent rien', ai.budgetAppel(null, null) === 0 && ai.budgetAppel(undefined, 100) === 100);

/* ══ 3. L'APPRENTISSAGE, ET SA CAPACITÉ À SE CORRIGER ═════════════════════════════════════════ */
console.log('\n── Apprendre, puis se corriger ──');
ai.setPlafonds({});
v('avant tout refus, aucun plafond : on ne s\'interdit rien', ai.plafondDe('groq') === null);
ai.notePlafondKo('groq', 19435);
const pl = ai.plafondDe('groq');
v('un refus à 19 435 pose un plafond SOUS cette valeur', pl !== null && pl < 19435, 'plafond=' + pl);
v('… et l\'appel du Récap complet serait désormais sauté', 19435 > pl);
v('… pendant que la passe courte (≈5 100) passe toujours', 5100 <= pl);
ai.notePlafondKo('groq', 25000);
v('un refus PLUS GROS ne remonte pas le plafond', ai.plafondDe('groq') === pl, 'plafond=' + ai.plafondDe('groq'));
ai.notePlafondKo('groq', 14000);
v('un refus PLUS PETIT le resserre', ai.plafondDe('groq') < pl);
/* ⚠️ SANS CETTE PROPRIÉTÉ, UN INCIDENT D'UN JOUR BRIMERAIT LE DESK POUR TOUJOURS. Si une requête
   plus grosse que le refus mémorisé passe ensuite, c'est que ce refus n'était pas un plafond. */
ai.notePlafondOk('groq', 30000);
v('une RÉUSSITE au-dessus du refus efface l\'apprentissage fautif', ai.plafondDe('groq') === null, 'plafond=' + ai.plafondDe('groq'));

/* ══ 4. CE QUE LA CHAÎNE ENCAISSE, DEMANDÉ AVANT D'APPELER ════════════════════════════════════ */
console.log('\n── budgetSur() : anticiper coûte zéro appel ──');
ai.setPlafonds({});
v('rien d\'appris → null (et surtout pas 0 : inconnu n\'est pas zéro)', ai.budgetSur() === null);
v('… donc la passe complète est bien TENTÉE dans ce cas', ai.budgetSur() == null);

/* ══ 5. LE BRANCHEMENT EST RÉEL ═══════════════════════════════════════════════════════════════
   Un apprentissage que la cascade n'interroge pas ne sert à rien : il serait vert au banc et
   inopérant en production. On vérifie donc les DEUX moitiés — la cascade saute, et le générateur
   du Récap interroge avant de fabriquer son appel. */
console.log('\n── Des deux côtés : la cascade s\'en sert, le Récap aussi ──');
const AI_SRC = fs.readFileSync(path.join(__dirname, '..', 'ai.js'), 'utf8');
v('la cascade calcule le budget de l\'appel', /const _bud = budgetAppel\(prompt, maxTokens\)/.test(AI_SRC));
const sautes = (AI_SRC.match(/_saute\('(\w+)'\)/g) || []).map(x => x.slice(8, -2));
v('les six fournisseurs de la cascade sont gardés', new Set(sautes).size === 6, 'gardés : ' + [...new Set(sautes)].join(', '));
const notesOk = (AI_SRC.match(/notePlafondOk\('/g) || []).length;
const notesKo = (AI_SRC.match(/notePlafondKo\('/g) || []).length;
v('chaque fournisseur apprend de ses réussites', notesOk >= 6, notesOk + ' point(s)');
v('… et de ses refus de taille', notesKo >= 6, notesKo + ' point(s)');
v('le Récap Quotidien interroge le plafond AVANT de tenter', /const _sur = ai\.budgetSur \? ai\.budgetSur\(\) : null;/.test(SRV));
// 23/09 : la pause (backoff) s'ajoute à la condition — elle saute la passe complète, jamais la courte (cf. ia-rythme-verif).
v('… et ne tente pas ce qu\'il sait refusé', /_tenterPlein = (?:!_fxrEnPause && )?!\(_budPlein && _sur != null && _budPlein > _sur\)/.test(SRV));
v('… mais tente quand RIEN n\'est appris (sinon il n\'apprendrait jamais)', /_sur != null/.test(SRV));
v('l\'apprentissage survit au déploiement (persisté en cache durable)', /aiCacheSet\('ai:plafonds'/.test(SRV) && /aiCacheGet\('ai:plafonds'\)/.test(SRV));
v('… et il est restauré AVANT la première génération', /_plafHydrate\(\)\.catch/.test(SRV));
v('ce qui est appris s\'affiche au moniteur IA', /plafonds: \(\(\) => \{ try \{ return \{ parFournisseur: ai\.plafonds\(\)/.test(SRV));

/* ── TÉMOIN ── Sans lui, le contrôle « un 429 nu ne compte pas » pourrait être vert en ne
   mesurant rien : on prouve que la distinction est bien ce qui décide. */
console.log('\n── Témoins ──');
ai.setPlafonds({});
ai.notePlafondKo('temoin', 9000);
v('(témoin) un refus enregistré pose bien un plafond', ai.plafondDe('temoin') !== null);
ai.setPlafonds({});
v('(témoin) setPlafonds({}) ne remet PAS à zéro un fournisseur absent', ai.plafondDe('jamais-vu') === null);
v('(témoin) une entrée restaurée est bien reprise', (() => { ai.setPlafonds({ temoin2: { okMax: 100, koMin: 8000 } }); return ai.plafondDe('temoin2') !== null && ai.plafondDe('temoin2') < 8000; })());

console.log(`\n${ko === 0 ? '✅' : '❌'} plafond-verif : ${ok} contrôle(s) vert(s), ${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);

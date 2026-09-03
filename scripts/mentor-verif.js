#!/usr/bin/env node
/**
 * scripts/mentor-verif.js — CE QUE LE RÉCAP DU MENTOR A ET QUE LE NÔTRE DOIT AVOIR
 *
 * POURQUOI CE BANC (03/09/2026). L'utilisateur envoie régulièrement le Récap Quotidien de son mentor
 * comme cible. Chaque comparaison a produit une version du prompt — nous en sommes à la 27e. Le
 * risque de cette mécanique est double, et les deux moitiés comptent autant :
 *
 *   · UN ÉCART COMBLÉ PEUT SE REPERDRE. Ces consignes vivent dans des chaînes de plusieurs milliers
 *     de caractères, sur une seule ligne. Une reformulation ultérieure peut en emporter une sans que
 *     personne ne le voie — et le rapport redevient silencieusement ce qu'il était trois versions
 *     plus tôt. Ce banc épingle les règles gagnées, une par une.
 *
 *   · TOUT CE QUE FAIT LE MENTOR N'EST PAS À COPIER. Sa puce « Discours Fed Waller, Hammack,
 *     Goolsbee » réunit trois intervenants sur une ligne. Chez nous c'est INTERDIT depuis le 30/08,
 *     sur une capture explicite de l'utilisateur (« pourquoi tu mixes ECB et BoJ »). Copier la cible
 *     sans lire l'historique aurait défait une décision prise. Ce banc garde donc AUSSI le veto.
 *
 *   node scripts/mentor-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* On isole les DEUX champs du prompt, pas le fichier entier : une règle doit vivre dans le champ
   qu'elle gouverne. Trouvée ailleurs, elle ne s'applique à rien — et le contrôle serait vert pour
   la mauvaise raison, ce qui est pire que rouge. */
function champ(cle) {
  const d = SERVER.indexOf('"' + cle + '": ["<');
  if (d < 0) return null;
  const f = SERVER.indexOf('>"]', d);
  return f < 0 ? null : SERVER.slice(d, f);
}
const CB = champ('cb'), MACRO = champ('macro'), FILS = champ('fils');

console.log('\n── 0. Les champs du prompt sont lisibles ──');
v('champ "cb" isolable', !!CB && CB.length > 500);
v('champ "macro" isolable', !!MACRO && MACRO.length > 500);
v('champ "fils" isolable', !!FILS && FILS.length > 300);

console.log('\n── 1. v27 — une décision de taux se lit en entier ──');
if (CB) {
  v('l\'AMPLEUR du geste est exigée en plus du niveau', /AMPLEUR DU GESTE/.test(CB) && /25 bps à 2,75%/.test(CB),
    'sans ampleur, « hausse à 2,75% » ne dit pas si le geste fut de 25 ou de 75 points');
  v('… et les deux sont exigés ENSEMBLE, pas au choix', /il faut les DEUX/.test(CB));
  v('la SÉRIE de décisions est demandée (« 2e hausse consécutive »)', /2e hausse consécutive/.test(CB));
  v('… mais interdite d\'invention', /N'INVENTE JAMAIS une série/.test(CB));
  v('l\'HORIZON que la banque se donne est une clause à garder', /fourchette cible mi-2027|HORIZON QUE LA BANQUE SE DONNE/.test(CB));
  v('le STATUT DE VOTE est une RÈGLE, plus seulement un exemple', /STATUT DE VOTE/.test(CB) && /non votant/.test(CB),
    'il figurait dans l\'exemple « BoE Ramsden (votant) » sans être exigé nulle part');
  v('l\'ÉCART DE LIGNE d\'un intervenant est demandé quand le corpus le montre', /s'écarte de sa ligne habituelle|ligne accommodante, s'en écarte/.test(CB));
  v('… et rien de tout cela ne s\'écrit sans preuve', /Sans preuve dans le corpus/.test(CB));
}

console.log('\n── 2. v27 — une publication majeure ne se résume pas à son chiffre de une ──');
if (MACRO) {
  v('la COMPOSANTE qui a fait le chiffre est demandée', /LA COMPOSANTE/.test(MACRO) && /activité export|composante prix/.test(MACRO));
  v('la SÉRIE ou le SUPERLATIF annoncé par la publication est demandé', /26e mois consécutif/.test(MACRO) && /plus forte expansion en 6 mois/.test(MACRO));
  v('… avec la raison, pas seulement la consigne', /dit la TENDANCE et non l'instant/.test(MACRO),
    'une consigne sans sa raison est la première qu\'on retire « pour simplifier »');
  v('la LECTURE DE L\'ÉMETTEUR doit lui être ATTRIBUÉE', /selon S&P Global/.test(MACRO) && /jamais le tien/.test(MACRO));
  v('le Beige Book donne l\'AMPLEUR mesurée, pas seulement le sens', /8 districts/.test(MACRO));
  v('… et l\'invention d\'un superlatif est nommée pour ce qu\'elle est', /mensonge qui a l'air d'une expertise/.test(MACRO));
  v('la redite du tableau « Chiffres du jour » est interdite', /n'écris donc PAS une puce qui redit ces trois nombres/.test(MACRO),
    'sans cette borne, la puce recopierait réel/attendu/précédent affichés juste en dessous');
}

console.log('\n── 3. LE VETO TIENT — on ne copie pas tout du mentor ──');
if (CB && MACRO) {
  /* Sa puce réunit trois intervenants Fed sur une ligne. Interdit ici depuis le 30/08. Ce contrôle
     existe parce que la tentation de recopier la cible est exactement ce qui défait une décision. */
  v('« UNE SEULE INSTITUTION PAR PUCE » tient toujours dans "cb"', /UNE SEULE INSTITUTION PAR PUCE — JAMAIS DEUX/.test(CB));
  v('… et la même loi tient dans "macro"', /UNE SEULE INSTITUTION PAR PUCE, JAMAIS DEUX/.test(MACRO));
  v('la qualité de l\'intervenant reste obligatoire', /QUALITÉ DE L'INTERVENANT OBLIGATOIRE/.test(CB));
  v('le mode du verbe (indicatif/conditionnel) reste exigé', /indicatif pour l'établi, conditionnel pour le rapporté/.test(CB));
}
if (FILS) {
  v('"fils" reste interdit de paraphraser le tableau du calendrier', /est INTERDITE et sera supprimée/.test(FILS),
    'c\'est la raison pour laquelle l\'ancien champ « watch » avait été retiré en v17');
}

console.log('\n── 4. La version est tamponnée, sinon rien n\'est régénéré ──');
{
  const m = /const FXR_VER = (\d+);/.exec(SERVER);
  v('FXR_VER lisible', !!m, String(m && m[1]));
  v('FXR_VER ≥ 27 (v27 = la comparaison du 03/09)', m && parseInt(m[1], 10) >= 27,
    'sans bump, les consignes changent et AUCUN rapport n\'est régénéré : le travail reste invisible');
  const hist = SERVER.slice(SERVER.indexOf('const FXR_VER'), SERVER.indexOf('const FXR_VER') + 4000);
  v('la comparaison v27 est DATÉE et tracée dans l\'historique', /v27 \(03\/09/.test(hist));
  v('… et le refus du regroupement PAR PAYS y est motivé, pas passé sous silence',
    /demande explicite du 25\/08|Revenir au pays serait defaire une decision prise/.test(hist),
    'le mentor range par pays ; nous rangeons par famille SUR DEMANDE. Un futur lecteur doit savoir que c\'est un choix, pas un oubli');
}

console.log('\n──────────────────────────────────────────────────────────────────────');
if (ko) { console.log(`❌ mentor-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
console.log(`✅ mentor-verif : ${ok} contrôle(s) au vert.`);

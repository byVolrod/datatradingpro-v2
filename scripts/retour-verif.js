#!/usr/bin/env node
/**
 * retour-verif.js — LE MOT DE RETOUR CHANGE-T-IL VRAIMENT À CHAQUE REPRISE ?
 * ------------------------------------------------------------------------------------------------
 * 02/09, demande utilisateur : « quand un user reprend un abonnement le message doit être différent
 * à chaque fois ». Une reprise ne produisait alors AUCUN message dans le chat — le client rouvrait
 * le desk sur son « Bienvenue » d'inscription, un texte qui lui explique ce qu'il sait déjà.
 *
 * CE QUE CE CONTRÔLE ÉPROUVE. Rien de visuel : une PROPRIÉTÉ de la rotation, et c'est justement le
 * genre de chose qu'on croit vraie sans l'avoir vérifiée. Un tirage AU HASARD aurait l'air correct
 * en relecture et redonnerait pourtant le même texte une reprise sur quatre. On vérifie donc que
 * quatre reprises consécutives donnent quatre textes DISTINCTS, que la rotation reprend au 5e sans
 * jamais tomber deux fois de suite sur le même, et qu'aucun de ces textes n'est le message de
 * bienvenue initial — sans quoi la demande ne serait pas remplie.
 *
 *   node scripts/retour-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

function decouper(entete, fin) {
  const d = SRV.indexOf(entete);
  if (d < 0) return null;
  const f = SRV.indexOf(fin, d + entete.length);
  return f < 0 ? null : SRV.slice(d, f + fin.length);
}

console.log('\n═══ RETOUR-VERIF — le mot de retour d\'un client qui se réabonne ═══');

const TAB = decouper('const RETOUR_CHAT = [', '\n];');
const FN  = decouper('function retourChat(n) {', '\n}');
const WEL = decouper('function welcomeChat() {', '\n}');
v('la table des mots de retour est extractible de server.js', !!TAB);
v('le sélecteur `retourChat` l\'est aussi', !!FN);
v('le message de bienvenue initial l\'est aussi', !!WEL);
if (!TAB || !FN || !WEL) { console.log('\n✗ ' + ko + ' KO\n'); process.exit(1); }

/* ⚠️ ON RÉCUPÈRE LES LIAISONS PAR LA VALEUR DE RETOUR DE L'EVAL. Un `const` déclaré dans un eval
   reste lié au bloc de CET eval : lu depuis l'extérieur, il lève « RETOUR_CHAT is not defined ».
   L'expression finale, elle, est évaluée DANS ce bloc et voit tout. */
// eslint-disable-next-line no-eval
const M = eval(TAB + '\n' + FN + '\n' + WEL + '\n({ RETOUR_CHAT: RETOUR_CHAT, retourChat: retourChat, welcomeChat: welcomeChat })');
const N = M.RETOUR_CHAT.length;
/* Noms LOCAUX distincts : un eval direct hisse ses déclarations de fonction dans la portée du
   module, et `const retourChat = …` entrait alors en collision avec la fonction extraite. */
const mot = M.retourChat, accueil = M.welcomeChat;

console.log('\n── 1. Une reprise, un texte — et jamais deux fois le même d\'affilée ──');
v('la table compte au moins quatre variantes', N >= 4, N + ' variante(s)');
const suite = [];
for (let i = 1; i <= N; i++) suite.push(mot(i));
v('les ' + N + ' premières reprises donnent ' + N + ' textes DISTINCTS', new Set(suite).size === N,
  new Set(suite).size + ' texte(s) distinct(s) sur ' + N);
/* La rotation reboucle — c'est voulu, on n'écrit pas cinquante variantes. Ce qui ne doit JAMAIS
   arriver, c'est deux reprises consécutives identiques. */
let colle = 0;
for (let i = 1; i <= N * 3; i++) if (mot(i) === mot(i + 1)) colle++;
v('deux reprises consécutives ne tombent jamais sur le même texte', colle === 0, colle + ' collision(s)');

console.log('\n── 2. Un retour n\'est pas une inscription ──');
/* Le fond de la demande : quelqu'un qui revient ne doit pas relire le message d'accueil. */
const bienvenue = accueil();
v('aucun mot de retour n\'est le message de bienvenue', !suite.includes(bienvenue));
v('… et aucun ne commence par « Bienvenue »', suite.every(t => !/^\s*Bienvenue/i.test(t)),
  suite.filter(t => /^\s*Bienvenue/i.test(t)).length + ' fautif(s)');
v('chacun signe bien du desk', suite.every(t => /L'équipe DataTradingPro\s*$/.test(t)));
v('chacun rappelle que le support répond ici', suite.every(t => /écris|demande|je suis là/i.test(t)),
  suite.filter(t => !/écris|demande|je suis là/i.test(t)).length + ' sans porte de sortie');

console.log('\n── 3. Les bornes ──');
/* Un compteur absent, nul ou négatif ne doit pas faire tomber l'envoi : au pire, on écrit le
   premier mot de retour. */
v('un compteur vide donne quand même un texte', typeof mot(undefined) === 'string' && mot(undefined).length > 20);
v('un compteur à 0 ou négatif retombe sur le premier', mot(0) === suite[0] && mot(-3) === suite[0]);

console.log('\n── 4. Il est bien BRANCHÉ sur les deux chemins de réactivation ──');
/* Une table de textes que personne n'appelle est un bug silencieux : le client ne reçoit rien et
   tout a l'air correct en relecture. */
/* ⚠️ On cherche les deux marqueurs sur la MÊME LIGNE plutôt qu'un motif à accolades : la branche
   contient déjà des `catch(() => {})`, et un `[^}]*` s'y arrête au premier `}` venu — le contrôle
   était rouge alors que l'appel était bien là. */
const _ligneWhop = SRV.split('\n').find(l => /wasInactive/.test(l) && /_sendRetourChat/.test(l));
v('le webhook Whop l\'envoie sur une réactivation',
  !!_ligneWhop && /_sendRetourChat\(existing\.id\)/.test(_ligneWhop),
  'appel introuvable dans la branche `wasInactive` de _whopRenewOrCreate');
v('le panneau admin l\'envoie aussi quand il réactive une fiche',
  /sendReactivated\([^)]*\);\s*_sendRetourChat\(u\.id\)/.test(SRV.replace(/\n/g, ' ')),
  'appel introuvable dans la route admin');

console.log('');
if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');

#!/usr/bin/env node
/**
 * scripts/bannis-verif.js — UN BANNI EST-IL SUSPENDU, ET UN PAYEUR ÉPARGNÉ ?
 *
 * POURQUOI (09/09, demande de l'utilisateur : « les membres bannis du Whop, je veux les ajouter
 * dans la liste des suspendus, avec leur mail, pour que la liste soit synchro et à jour »).
 *
 * C'EST LA SEULE BOUCLE DU PRODUIT QUI COUPE UN ACCÈS. Toutes les autres ÉTENDENT — « on ne coupe
 * pas un payeur sur un doute ». Le danger n'est donc pas de rater un banni (il reste banni côté
 * Whop, il ne perd rien à garder le desk une journée de plus) : c'est de suspendre quelqu'un qui ne
 * l'est pas. Ce dépôt garde la mémoire d'un accès révoqué à tort — un abonnement réglé par
 * virement, prolongé à la main, effacé par une lecture périmée : trois semaines perdues et un
 * client qui ne pouvait plus se connecter, sans qu'aucune trace ne le dise.
 *
 * LE PIÈGE PRÉCIS : sur la plateforme de paiement, un bannissement et une simple résiliation
 * ressortent souvent avec le MÊME statut d'adhésion (« canceled »). Déduire le bannissement de
 * l'invalidité suspendrait donc tout abonné arrivé au bout de sa période — y compris à l'instant
 * d'un renouvellement, où l'adhésion est brièvement invalide. On exige un signal EXPLICITE.
 *
 * Ce banc EXÉCUTE le vrai détecteur extrait de `whop.js`.
 *
 *   node scripts/bannis-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}
const W = fs.readFileSync(path.join(RACINE, 'whop.js'), 'utf8');
const S = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');

console.log('\n[1] Le détecteur de bannissement, extrait de whop.js');
const marqueur = (() => {
  const a = W.indexOf('function _whopBanMarqueur(m)');
  const b = W.indexOf('\n}', W.indexOf("return null;", W.indexOf('member.banned', a))) + 2;
  if (a < 0 || b < a) return null;
  try { return new Function(W.slice(a, b) + '; return _whopBanMarqueur;')(); } catch (e) { return null; }
})();
t('_whopBanMarqueur est extraite et exécutable', typeof marqueur === 'function');

if (marqueur) {
  console.log('\n[2] Ce qui EST un bannissement');
  t('un champ `banned` à vrai', marqueur({ banned: true }) === 'banned');
  t('un champ `is_banned` à vrai', marqueur({ is_banned: true }) === 'is_banned');
  t('un champ `member_banned` à vrai', marqueur({ member_banned: true }) === 'member_banned');
  t('le statut littéral « banned »', marqueur({ status: 'banned' }) === 'status=banned');
  t('… quelle que soit sa casse', marqueur({ status: 'BANNED' }) === 'status=banned');
  t('un `banned` imbriqué dans l\'utilisateur', marqueur({ user: { banned: true } }) === 'user.banned');
  t('un `banned` imbriqué dans le membre', marqueur({ member: { banned: true } }) === 'member.banned');

  console.log('\n[3] Ce qui n\'en est PAS — les contrôles qui protègent un payeur');
  /* CHACUN DE CES CAS A COUPÉ L'ACCÈS DE QUELQU'UN, dans un produit ou un autre. Ils ne sont pas
     théoriques : ce sont les états ordinaires d'un abonnement vivant. */
  t('un abonnement RÉSILIÉ n\'est pas un bannissement', marqueur({ status: 'canceled', valid: false }) === null,
    'un client en fin de période serait suspendu');
  t('un abonnement EXPIRÉ non plus', marqueur({ status: 'expired', valid: false }) === null);
  t('un paiement en retard non plus', marqueur({ status: 'past_due', valid: false }) === null);
  t('un statut « unresolved » non plus', marqueur({ status: 'unresolved' }) === null);
  t('une adhésion simplement invalide non plus', marqueur({ valid: false }) === null,
    'l\'invalidité est l\'état NORMAL d\'un renouvellement en cours');
  /* ⚠️ LA VÉRITÉ N'EST PAS « CE QUI EST VRAI EN JAVASCRIPT ». Une chaîne non vide, le nombre 1, un
     objet : tout cela est « truthy » et aucun ne dit qu'une personne est bannie. C'est exactement
     la faille qui a fait s'appeler un client « false » dans la messagerie du support, le même jour. */
  t('une valeur seulement « truthy » ne suffit pas', marqueur({ banned: 'non' }) === null && marqueur({ banned: 1 }) === null,
    JSON.stringify([marqueur({ banned: 'non' }), marqueur({ banned: 1 })]));
  t('un objet vide ne dit rien', marqueur({}) === null);
  t('une adhésion absente ne dit rien', marqueur(null) === null && marqueur(undefined) === null);
}

console.log('\n[4] La boucle qui suspend, et ses garde-fous');
{
  const a = S.indexOf('async function _whopBanSync()');
  const b = S.indexOf('setTimeout(() => { _whopBanSync()', a);
  const bloc = (a > 0 && b > a) ? S.slice(a, b) : '';
  t('la boucle existe', !!bloc);
  t('elle n\'agit que sur un signal EXPLICITE', /whop\.listBannedMemberships\(\)/.test(bloc),
    'elle ne doit jamais lire la simple validité');
  t('elle épargne les administrateurs', /u\.role === 'admin'/.test(bloc));
  t('elle ne retouche pas un compte déjà suspendu', /u\.active === false\) continue/.test(bloc),
    'sans quoi elle réécrirait la même ligne toutes les demi-heures');
  t('elle TRACE chaque suspension avec son marqueur', /compte SUSPENDU/.test(bloc) && /b\.marque/.test(bloc),
    'une révocation d\'accès sans trace est introuvable ensuite');
  /* TÉMOIN INVERSE : elle ne doit JAMAIS réactiver. Deux chemins pour la même chose finissent par
     se contredire, et la réactivation appartient déjà à la réconciliation ordinaire. */
  t('TÉMOIN — elle ne réactive jamais personne', !/active: true/.test(bloc),
    'la réactivation appartient à _whopReconcile, qui prolonge déjà');
  t('un diagnostic admin permet de vérifier en production',
    /app\.get\('\/api\/admin\/whop\/bannis'/.test(S),
    'le nom du champ de bannissement se CONSTATE, il ne se devine pas depuis le code');
}

console.log('\n[Bannis] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

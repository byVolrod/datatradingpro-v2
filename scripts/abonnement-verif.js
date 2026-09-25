#!/usr/bin/env node
/**
 * scripts/abonnement-verif.js — « ABONNÉ DEPUIS » EST LE DÉBUT DE L'ABONNEMENT EN COURS.
 * ------------------------------------------------------------------------------------------------
 * 25/09, demande user : « le membre peut être membre depuis X temps, prendre un abonnement,
 * l'arrêter, puis le reprendre : la date ne sera pas la même ». Le Compte affichait `created_at`,
 * la création du COMPTE. Ce banc rejoue le VRAI registre de `server.js` (tranche extraite, pas une
 * copie) : une reprise repart à zéro, un renouvellement ne touche à rien, une date absente se
 * comble ; puis il vérifie que les trois chemins d'écriture (Whop, réconciliation, panneau admin)
 * et l'affichage de l'app sont bien branchés. Témoin : sans la garde « si absent », un
 * renouvellement de routine réécrirait la date.
 */
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(R, 'public/js/v2/app-mobile.js'), 'utf8');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };

(async () => {
  console.log('\n── Le registre (tranche réelle de server.js) ──');
  const a = SRV.indexOf('let _aboDebuts = {}'), b = SRV.indexOf('\n', SRV.indexOf('const _aboEchu = '));
  v('la tranche du registre est extractible', a > 0 && b > a);
  const monter = src => {
    const kv = {};
    const auth = { aiCacheGet: async k => kv[k] || null, aiCacheSet: async (k, val) => { kv[k] = JSON.parse(JSON.stringify(val)); } };
    const M = new Function('auth', 'setTimeout', src.replace(/setTimeout\([^\n]+\n/, '') + '\nreturn { set: _aboDebutSet, echu: _aboEchu, get: () => _aboDebuts };')(auth, () => {});
    return { M, kv };
  };
  const { M, kv } = monter(SRV.slice(a, b));
  const J = 86400000, now = Date.now();
  const debut = now - 400 * J, reprise = now - 3 * J;
  await M.set('u1', debut);
  v('une première date est posée et persistée en base (clé abodebuts)', M.get().u1 === debut && kv.abodebuts && kv.abodebuts.u1 === debut);
  await M.set('u1', now - 100 * J, true);
  v('un renouvellement (« si absent ») ne réécrit pas la date d\'un abonnement qui continue', M.get().u1 === debut);
  await M.set('u1', reprise);
  v('une REPRISE repart de la nouvelle adhésion', M.get().u1 === reprise);
  await M.set('u2', now - 10 * J, true);
  v('une date absente se comble (comptes antérieurs)', M.get().u2 === now - 10 * J);
  await M.set('u3', now + 30 * J); await M.set('u4', NaN); await M.set('', now);
  v('une date future, illisible ou sans compte est refusée', !M.get().u3 && !M.get().u4 && !('' in M.get()));
  v('échu = suspendu ou échéance passée ; actif à échéance future ou illimité = en cours',
    M.echu({ active: false }) && M.echu({ active: true, expires_at: new Date(now - J).toISOString() })
    && !M.echu({ active: true, expires_at: new Date(now + J).toISOString() }) && !M.echu({ active: true, expires_at: null }));
  // Témoin : la garde « si absent » retirée, un renouvellement écrase la date — le contrôle ci-dessus doit mordre.
  const temoin = monter(SRV.slice(a, b).replace('if (siAbsent && _aboDebuts[k]) return false;', '')).M;
  await temoin.set('t', debut); await temoin.set('t', now - 100 * J, true);
  v('témoin : sans la garde, la date d\'un abonnement continu serait réécrite (le contrôle mord)', temoin.get().t !== debut);

  console.log('\n── Les trois chemins d\'écriture, et l\'affichage ──');
  const renew = (/async function _whopRenewOrCreate\(mem\) \{[\s\S]*?\n\}/.exec(SRV) || [''])[0];
  v('Whop : la reprise se lit AVANT la mise à jour du compte', renew.indexOf('const _repris = _aboEchu(existing)') > 0 && renew.indexOf('const _repris') < renew.indexOf('await auth.updateUser(existing.id, _majExist)'));
  v('Whop : reprise → adhésion qui paie (à défaut maintenant) ; renouvellement → seulement si absent',
    /if \(_repris\) await _aboDebutSet\(existing\.id, mem\.createdAt \|\| Date\.now\(\)\);\s*else if \(mem\.createdAt\) await _aboDebutSet\(existing\.id, mem\.createdAt, true\);/.test(renew));
  v('Whop : un compte créé reçoit sa date', /_aboDebutSet\(wu\.id, mem\.createdAt \|\| Date\.now\(\)\)/.test(renew));
  const recon = (/async function _whopReconcile\(\) \{[\s\S]*?\n\}/.exec(SRV) || [''])[0];
  v('réconciliation : comble la date des comptes antérieurs, sans réécrire', /if \(mem\.createdAt && !_aboDebuts\[String\(u\.id\)\]\) await _aboDebutSet\(u\.id, mem\.createdAt, true\)/.test(recon));
  const adm = (/app\.put\('\/api\/admin\/users\/:id'[\s\S]*?\n\}\);/.exec(SRV) || [''])[0];
  v('panneau admin : un compte échu qui redevient actif (virement) démarre un nouvel abonnement',
    /if \(before && _aboEchu\(before\)\) auth\.getUserById\(id\)\.then\(apres => \{ if \(apres && !_aboEchu\(apres\)\) return _aboDebutSet\(id, Date\.now\(\)\); \}\)/.test(adm));
  v('/api/auth/me expose aboDepuis', /aboDepuis: _aboDebuts\[String\(fresh\.id\)\] \|\| null/.test(SRV));
  v('l\'app affiche « Abonné depuis le » = début de l\'abonnement en cours (Profil et Abonnement)',
    (APP.match(/dateFr\(u\.aboDepuis \|\| u\.createdAt\)/g) || []).length >= 2 && !/kvp\('Membre depuis le', dateFr\(u\.createdAt\)\) \+ kvp\(ech/.test(APP));

  console.log(ko ? '\n✗ ' + ko + ' contrôle(s) en échec' : '\n✓ ' + ok + ' contrôles au vert');
  process.exit(ko ? 1 : 0);
})();

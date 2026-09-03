#!/usr/bin/env node
/**
 * scripts/durabilite-verif.js — CE QUI NE VIT QUE DANS UN FICHIER FINIT PAR DISPARAÎTRE
 *
 * POURQUOI (03/09/2026). En cherchant pourquoi des comptes écartés étaient revenus, j'ai comparé
 * TOUS les magasins d'auth.js. Deux seulement n'avaient AUCUNE contrepartie en base :
 *   · la LISTE NOIRE (`users_blacklist.json`) — un volume perdu, et il ne restait que les deux
 *     adresses du seed en dur : tout ce qui avait été ajouté depuis le panneau disparaissait, donc
 *     des comptes bannis pouvaient se recréer ;
 *   · les PIERRES TOMBALES (`users_deleted.json`) — un compte supprimé pouvait alors revenir.
 * Tout le reste était protégé : `users` a son miroir et sa convergence, `ai_cache`/`weekly_reports`/
 * `email_log` sont dual-écrits, `chat_messages` est réuni à la lecture. Rien ne signalait le trou,
 * puisque le fichier repartait VALIDE — simplement vide.
 *
 * S'y ajoute la table de CORRECTION D'ÉCHÉANCE, qui répare un abonnement payé effacé le 02/09 par
 * une lecture périmée. Sa sûreté tient à une seule propriété, et ce banc l'éprouve : elle ALLONGE,
 * elle ne raccourcit jamais — donc elle est idempotente et ne peut pas révoquer un accès.
 *
 *   node scripts/durabilite-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const AUTH = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

function extraire(src, depart) {
  const d = src.indexOf(depart);
  if (d < 0) return null;
  let par = 0, j = src.indexOf('(', d);
  for (; j < src.length; j++) { if (src[j] === '(') par++; else if (src[j] === ')') { par--; if (par === 0) break; } }
  let i = src.indexOf('{', j), prof = 0, ch = null;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1], n = src[i + 1];
    if (ch) { if (c === ch && p !== '\\') ch = null; continue; }
    if (c === '/' && n === '/') { const f = src.indexOf('\n', i); if (f < 0) return null; i = f; continue; }
    if (c === '/' && n === '*') { const f = src.indexOf('*/', i + 2); if (f < 0) return null; i = f + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { ch = c; continue; }
    if (c === '{') prof++;
    else if (c === '}') { prof--; if (prof === 0) return src.slice(d, i + 1); }
  }
  return null;
}

console.log('\n── 1. La liste noire et les pierres tombales écrivent AUSSI en base ──');
{
  const bl = extraire(AUTH, 'function _blacklistSave(');
  const tb = extraire(AUTH, 'function _tombstone(');
  v('_blacklistSave extractible', !!bl);
  v('_tombstone extractible', !!tb);
  v('un bannissement est écrit dans le fichier ET dans la base',
    bl && /writeFileSync/.test(bl) && /aiCacheSet\(_KV_BLACKLIST/.test(bl),
    'un fichier vit sur un disque ; ai_cache vit sur quatre bases et dans l\'archive nocturne');
  v('une pierre tombale aussi', tb && /writeFileSync/.test(tb) && /aiCacheSet\(_KV_TOMBES/.test(tb));
  v('les deux clés sont nommées une seule fois, en constantes',
    /const _KV_BLACKLIST = 'auth:blacklist'/.test(AUTH) && /const _KV_TOMBES\s+= 'auth:tombstones'/.test(AUTH),
    'une clé recopiée à trois endroits finit par diverger d\'un caractère, et la donnée est perdue en silence');
}

console.log('\n── 2. Au démarrage, la base rattrape le fichier ──');
{
  v('la reprise lit les deux clés au démarrage',
    /aiCacheGet\(_KV_BLACKLIST/.test(AUTH) && /aiCacheGet\(_KV_TOMBES/.test(AUTH));
  v('… et elle UNIT au lieu de remplacer (on ne perd jamais un bannissement)',
    /if \(em && !_blacklist\.has\(em\)\) \{ _blacklist\.add\(em\); neufs\+\+; \}/.test(AUTH));
  v('… le choix d\'unir est ASSUMÉ et motivé dans le code, pas subi',
    /On penche du côté qui protège/.test(AUTH),
    'sans sa raison écrite, cette règle sera « simplifiée » un jour par quelqu\'un qui la croira arbitraire');
  v('… et l\'état fusionné est REPOSÉ en base (sinon le rattrapage ne va que dans un sens)',
    /_durableSave\(\)/.test(AUTH));
  v('la récupération est TRACÉE (un rattrapage silencieux n\'apprend rien)',
    /récupérée\(s\) depuis la base/.test(AUTH));
}

console.log('\n── 3. La décision antérieure sur le seed n\'a pas été défaite ──');
{
  /* Le seed ne se réinjecte PAS quand le fichier existe : c'est délibéré (un retrait via l'admin
     doit persister). L'union porte sur la BASE, pas sur le seed — les deux règles coexistent. */
  v('le seed reste conditionné à l\'absence de fichier', /if \(!_blacklistLoaded\) \{ _BLACKLIST_SEED\.forEach/.test(AUTH),
    'toujours réinjecter le seed rendrait IMPOSSIBLE de lever le bannissement d\'une adresse seedée');
  v('… et la raison de cette exception est toujours écrite', /un retrait via l'admin PERSISTE/.test(AUTH));
}

console.log('\n── 4. La correction d\'échéance ALLONGE, et ne raccourcit jamais ──');
{
  const src = extraire(AUTH, 'function _reparerEcheances(');
  v('_reparerEcheances extractible', !!src);
  if (src) {
    /* On JOUE la fonction sur un miroir bouchonné : c'est la seule façon de prouver qu'elle est
       idempotente et qu'elle ne peut pas révoquer un accès. Une relecture ne le prouve pas. */
    const seed = /const _ECHEANCES_SEED = \[([\s\S]*?)\];/.exec(AUTH);
    v('la table de correction est lisible', !!seed);
    const journal = [];
    const faire = (miroirInit, seedSrc) => {
      const code =
        'const _usersMirror = new Map(Object.entries(' + JSON.stringify(miroirInit) + '));\n'
        + 'function _mirrorIndex() {}\nfunction _mirrorSaveFile() {}\nfunction _convSoon() {}\n'
        + (seedSrc || 'const _ECHEANCES_SEED = [' + seed[1] + '];') + '\n'
        + src + '\nreturn { n: _reparerEcheances(), m: _usersMirror };';
      return new Function('console', code)({ log: x => journal.push(x), warn: x => journal.push(x) });
    };
    const EM = 'anismessaoud05@gmail.com';

    const r1 = faire({ [EM]: { email: EM, expires_at: '2026-06-11T00:00:00.000Z' } });
    v('LE CAS RÉEL — l\'échéance de juin est portée au 30/09', r1.n === 1 && /2026-09-30/.test(r1.m.get(EM).expires_at),
      JSON.stringify(r1.m.get(EM)));

    const r2 = faire({ [EM]: { email: EM, expires_at: '2026-09-30T23:59:59.000Z' } });
    v('IDEMPOTENT — un second passage ne fait rien', r2.n === 0);

    const r3 = faire({ [EM]: { email: EM, expires_at: '2027-01-15T00:00:00.000Z' } });
    v('UNE ÉCHÉANCE PLUS LOINTAINE N\'EST JAMAIS RACCOURCIE', r3.n === 0 && /2027-01-15/.test(r3.m.get(EM).expires_at),
      'sans cette règle, la table révoquerait l\'accès qu\'elle est censée rendre — le défaut même qu\'elle répare');

    const r4 = faire({ [EM]: { email: EM, expires_at: null } });
    v('[témoin] une échéance absente est bien posée', r4.n === 1 && /2026-09-30/.test(r4.m.get(EM).expires_at));

    const r5 = faire({ 'autre@exemple.fr': { email: 'autre@exemple.fr', expires_at: '2026-06-01T00:00:00.000Z' } });
    v('[témoin] un compte HORS de la table n\'est pas touché', r5.n === 0 && r5.m.get('autre@exemple.fr').expires_at === '2026-06-01T00:00:00.000Z',
      'une correction qui déborde sur d\'autres comptes serait pire que le défaut');
    v('… et son absence du miroir est signalée, pas avalée', journal.some(x => /absent du miroir/.test(String(x))));

    v('la convergence est déclenchée quand une correction a eu lieu', /_convSoon\(/.test(src),
      'sans elle, la date corrigée resterait dans le miroir et n\'atteindrait jamais les quatre bases');
    v('la correction est appelée au démarrage, après le chargement du miroir',
      /if \(_usersMirror\.size\) \{ try \{ _reparerEcheances\(\)/.test(AUTH));
  }
}

console.log('\n──────────────────────────────────────────────────────────────────────');
if (ko) { console.log(`❌ durabilite-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
console.log(`✅ durabilite-verif : ${ok} contrôle(s) au vert.`);

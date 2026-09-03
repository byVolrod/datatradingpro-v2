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
    /* ⚠️ LE BAC ESPIONNE `updateUser` — c'est LUI que la réparation doit appeler (corrigé le 03/09).
       Elle posait d'abord la date à la main dans le miroir, en comptant sur la convergence pour la
       porter en base. La convergence ne propage QUE les comptes dont le miroir connaît l'empreinte,
       et l'empreinte n'y entre que par une CONNEXION — or un abonné expiré ne peut justement plus se
       connecter. La réparation ne pouvait donc pas atteindre ceux qu'elle vise, et la base est bien
       restée au 11/06 en production pendant que le code tournait. On vérifie maintenant l'APPEL. */
    const faire = (miroirInit, seedSrc) => {
      const majs = [];
      const code =
        'const _usersMirror = new Map(Object.entries(' + JSON.stringify(miroirInit) + '));\n'
        + 'function _mirrorIndex() {}\nfunction _mirrorSaveFile() {}\nfunction _convSoon() {}\n'
        + 'function updateUser(id, champs) { _maj.push({ id: id, champs: champs }); return Promise.resolve(); }\n'
        + (seedSrc || 'const _ECHEANCES_SEED = [' + seed[1] + '];') + '\n'
        + src + '\nreturn { n: _reparerEcheances(), m: _usersMirror };';
      const r = new Function('console', '_maj', code)({ log: x => journal.push(x), warn: x => journal.push(x) }, majs);
      r.majs = majs;
      return r;
    };
    const EM = 'anismessaoud05@gmail.com';

    const r1 = faire({ [EM]: { id: '9', email: EM, expires_at: '2026-06-11T00:00:00.000Z' } });
    v('LE CAS RÉEL — l\'échéance de juin déclenche une correction', r1.n === 1);
    v('… et elle passe par updateUser, le chemin du panneau admin',
      r1.majs.length === 1 && r1.majs[0].id === '9' && /2026-09-30/.test(r1.majs[0].champs.expiresAt),
      'appels observés : ' + JSON.stringify(r1.majs));

    /* ⚠️ « N'ÉCRIT RIEN » ÉTAIT LA MAUVAISE DÉFINITION DE L'IDEMPOTENCE, ET ELLE A COÛTÉ TROIS
       CYCLES (03/09). Ce contrôle exigeait qu'un second passage n'écrive PAS — donc que la
       réparation se fie à ce qu'elle voit au MIROIR. Or c'est la BASE qu'elle répare : le miroir
       ayant été mis à jour par une version antérieure, la réparation a conclu qu'il n'y avait rien
       à faire pendant que la base restait au 11/06, et s'est tue en le faisant.
       Ce qui doit être garanti n'est pas l'absence d'écriture, c'est l'absence de DÉRIVE : un second
       passage réécrit LA MÊME date, ce qui est sans effet en base et remet la valeur si elle en a
       été chassée. Le seul silence légitime est celui d'une échéance STRICTEMENT plus lointaine. */
    const r2 = faire({ [EM]: { id: '9', email: EM, expires_at: '2026-09-30T23:59:59.000Z' } });
    v('IDEMPOTENT — un second passage réécrit LA MÊME date, il ne dérive pas',
      r2.majs.length === 1 && r2.majs[0].champs.expiresAt === '2026-09-30T23:59:59.000Z',
      JSON.stringify(r2.majs));
    v('… et il ne peut pas raccourcir, puisque c\'est la même valeur', r2.majs.every(m => Date.parse(m.champs.expiresAt) >= Date.parse('2026-09-30T23:59:59.000Z')));

    const r3 = faire({ [EM]: { id: '9', email: EM, expires_at: '2027-01-15T00:00:00.000Z' } });
    v('UNE ÉCHÉANCE PLUS LOINTAINE N\'EST JAMAIS RACCOURCIE', r3.n === 0 && r3.majs.length === 0,
      'sans cette règle, la table révoquerait l\'accès qu\'elle est censée rendre — le défaut même qu\'elle répare');

    const r4 = faire({ [EM]: { id: '9', email: EM, expires_at: null } });
    v('[témoin] une échéance absente est bien posée', r4.n === 1 && r4.majs.length === 1);

    const r5 = faire({ 'autre@exemple.fr': { id: '7', email: 'autre@exemple.fr', expires_at: '2026-06-01T00:00:00.000Z' } });
    v('[témoin] un compte HORS de la table n\'est pas touché', r5.n === 0 && r5.majs.length === 0,
      'une correction qui déborde sur d\'autres comptes serait pire que le défaut');
    v('… et son absence du miroir est signalée, pas avalée', journal.some(x => /absent du miroir/.test(String(x))));

    v('la réparation n\'écrit PLUS le miroir à la main', !/row\.expires_at = /.test(src),
      'une écriture directe ne serait propagée que pour les comptes dont le miroir a l\'empreinte — jamais un expiré');
    /* ⚠️ CE CONTRÔLE ÉPINGLAIT LA FORME EXACTE DE L'APPEL, ET IL ÉTAIT VERT PENDANT QUE LE CODE
       ÉTAIT CASSÉ. Il vérifiait `if (_usersMirror.size) { try { _reparerEcheances()` — c'est-à-dire
       la présence de l'appel, jamais son MOMENT. Or l'appel était fait pendant l'évaluation du
       module, avant `const _ECHEANCES_SEED`, et ne faisait donc rien. Ce qui doit être garanti
       n'est pas que l'appel existe, c'est qu'il parte APRÈS le module. La section 5 le prouve en
       exécutant ; celui-ci fige la forme qui le rend possible. */
    v('l\'appel à la correction est DIFFÉRÉ, pas fait pendant l\'évaluation du module',
      /setTimeout\(\(\) => \{\n  if \(!_usersMirror\.size\) return;\n  try \{ _reparerEcheances\(\)/.test(AUTH),
      'un appel immédiat lirait _ECHEANCES_SEED avant son initialisation, et la correction ne ferait rien');
  }
}

console.log('\n── 5. LE CONTRÔLE QUI M\'A MANQUÉ — on CHARGE le module, on ne le relit pas ──');
{
  /* ⚠️ POURQUOI CE CONTRÔLE EXISTE, ET IL EST LE PLUS IMPORTANT DU FICHIER.
     Les quatre sections ci-dessus LISENT le source. Elles étaient toutes vertes pendant que la
     reprise, elle, ÉCHOUAIT À CHAQUE DÉMARRAGE : écrite en exécution immédiate, elle partait
     pendant l'évaluation du module, donc avant `const _aiMem` — et un `const` pas encore initialisé
     lève « Cannot access ... before initialization ». Les déclarations de FONCTION se hissent, les
     `const` NON. L'application démarrait sans broncher, le try/catch avalait l'erreur, et la
     durabilité ne s'installait jamais. Exactement le défaut que ce commit répare ailleurs.
     La MÊME faute dormait depuis toujours sur la reprise des réactions du chat, avec un `catch {}`
     muet qui n'en laissait aucune trace.
     Un banc qui lit du texte ne peut pas voir cela. Celui-ci charge auth.js pour de vrai, avec des
     variables d'environnement factices, et écoute ce que le démarrage écrit. */
  /* ⚠️ ON CAPTURE stdout ET stderr — PREMIER JET FAUX, ET FAUX DE LA MANIÈRE QUE CE FICHIER
     DÉNONCE. Écrit avec `execFileSync`, ce contrôle ne recevait que stdout ; or l'erreur de zone
     morte sort par `console.warn`, donc sur stderr. Le contrôle était donc VERT alors que le défaut
     était là — vert pour la mauvaise raison, ce qui est pire que rouge. Son propre contrôle négatif
     l'a montré : en remettant la faute dans auth.js, il ne bronchait pas. `spawnSync` rend les deux
     flux. */
  const { spawnSync } = require('child_process');
  const os = require('os');
  const r = spawnSync(process.execPath, ['-e',
    "require(process.argv[1]); setTimeout(() => process.exit(0), 3000);",
    path.join(__dirname, '..', 'auth.js')],
    { encoding: 'utf8', timeout: 30000,
      env: Object.assign({}, process.env, {
        SUPABASE_URL: 'https://exemple.supabase.co', SUPABASE_KEY: 'cle-factice',
        DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-dur-')),
      }) });
  const sortie = String(r.stdout || '') + String(r.stderr || '');
  v('auth.js se charge sans exception', /Supabase connecté/.test(sortie), sortie.slice(0, 200));
  v('AUCUNE zone morte au démarrage (« before initialization »)',
    !/before initialization/i.test(sortie),
    'une reprise qui part avant la fin de l\'évaluation du module ne s\'installe JAMAIS — et rien ne le dit');
  v('… ni sur la liste noire, ni sur les réactions du chat',
    !/reprise liste noire[^\n]*before initialization/i.test(sortie) && !/reprise des réactions[^\n]*before initialization/i.test(sortie));
  v('les deux reprises sont DIFFÉRÉES d\'un tour de boucle', (AUTH.match(/setTimeout\(\(\) => \{\n\(async \(\) => \{|setTimeout\(\(\) => \{\n  \(async \(\) => \{/g) || []).length >= 2,
    'sans ce report, elles repartiraient dans la zone morte au premier refactoring');
  v('… et le catch des réactions NOMME ce qu\'il avale (il était muet)', /\[Chat\] reprise des réactions/.test(AUTH),
    'un catch vide transforme une panne permanente en silence permanent');

  /* ⚠️ ET CE CONTRÔLE-CI EXISTE PARCE QUE LES QUATRE PREMIÈRES SECTIONS ONT LAISSÉ PASSER LA MÊME
     FAUTE UNE SECONDE FOIS, LE MÊME JOUR. La section 4 éprouve `_reparerEcheances` en l'EXTRAYANT et
     en lui injectant son seed : elle prouve que la fonction est juste, et c'est tout ce qu'elle
     prouve. Or l'appel était placé AVANT la déclaration `const _ECHEANCES_SEED` — la fonction se
     hisse, le `const` non — et la correction levait donc « Cannot access ... before initialization »
     à chaque démarrage, en silence. Le compte est resté au 11/06 en production alors que le code
     était en ligne et que 22 contrôles étaient verts.
     La leçon tient en une phrase : une fonction juste, appelée trop tôt, ne fait rien. On charge
     donc le module AVEC UN MIROIR NON VIDE — sans quoi `_reparerEcheances` n'est même pas appelée —
     et on exige la trace de son passage. */
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-mir-'));
  fs.writeFileSync(path.join(dossier, 'users_mirror.json'), JSON.stringify([{
    id: '9', email: 'anismessaoud05@gmail.com', name: 'Anis', role: 'client', plan: 'professionnel',
    active: true, password_hash: '$2b$10$temoinnnnnnnnnnnnnnnnn', expires_at: '2026-06-11T00:00:00.000Z',
  }]));
  const r2 = spawnSync(process.execPath, ['-e',
    "require(process.argv[1]); setTimeout(() => process.exit(0), 2500);",
    path.join(__dirname, '..', 'auth.js')],
    { encoding: 'utf8', timeout: 30000,
      env: Object.assign({}, process.env, {
        SUPABASE_URL: 'https://exemple.supabase.co', SUPABASE_KEY: 'cle-factice', DATA_DIR: dossier,
      }) });
  const s2 = String(r2.stdout || '') + String(r2.stderr || '');
  /* ⚠️ ON ATTEND LA TENTATIVE, PAS LA RÉUSSITE — et c'est délibéré. Contre une URL Supabase factice,
     l'écriture ne peut évidemment pas aboutir : exiger « APPLIQUÉE » rendrait ce contrôle rouge sur
     du code juste. Ce qu'il doit prouver, c'est que la correction est ATTEINTE au démarrage et
     qu'elle porte la bonne date — le reste (l'écriture elle-même) est éprouvé plus haut, en
     espionnant `updateUser`. */
  v('LE CONTRÔLE QUI MANQUAIT — la correction d\'échéance est ATTEINTE au démarrage',
    /correction d'échéance : [^\n]*→/.test(s2),
    'sortie du démarrage : ' + s2.split('\n').filter(l => /échéance/i.test(l)).join(' | ').slice(0, 200));
  v('… et elle ne bute sur AUCUNE zone morte', !/_ECHEANCES_SEED[^\n]*before initialization/.test(s2));
  v('… la date appliquée est bien celle de la table', /2026-09-30/.test(s2));
}

console.log('\n──────────────────────────────────────────────────────────────────────');
if (ko) { console.log(`❌ durabilite-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
console.log(`✅ durabilite-verif : ${ok} contrôle(s) au vert.`);

#!/usr/bin/env node
/**
 * scripts/miroir-verif.js — UNE LECTURE NE RÉVOQUE JAMAIS UN ACCÈS
 *
 * L'INCIDENT, reconstitué à partir de faits vérifiés, pas d'une hypothèse (03/09/2026).
 *   30/08 — un abonnement réglé par virement est prolongé À LA MAIN au 30/09 depuis le panneau
 *           admin. La base principale est EN PAUSE depuis le 14/06 : l'écriture part donc sur db2
 *           et sur le miroir. Correctement.
 *   02/09 — la principale revient, sa table `users` figée au 14/06 (29 comptes contre 51 au desk).
 *           Le panneau admin est ouvert ce jour-là. `getAllUsers` lit la PREMIÈRE base saine — la
 *           principale — et passe ses 29 lignes de juin à `_mirrorPutMany`. La fusion était
 *           `{ ...prev, ...row }` : la LECTURE écrase le miroir. Le 30/09 devient le 11/06.
 *           `_usersConverge` propage ensuite ce miroir corrompu vers les quatre bases.
 *   03/09 — le client reçoit « Abonnement expiré » et ne peut plus se connecter. Trois semaines
 *           après avoir payé. Rien, nulle part, ne signalait la révocation.
 *
 * La quarantaine de lecture ferme le chemin depuis le 02/09 au soir — quelques heures trop tard, et
 * elle ne couvre pas tout : un compte connu du miroir SANS son `password_hash` n'est jamais propagé
 * par la convergence (qui ne prend que les comptes complets), alors que la quarantaine du nœud, elle,
 * se lève. Sa ligne périmée survit donc en base. D'où cette seconde garde, indépendante.
 *
 * CE BANC ÉPROUVE LE VRAI `_mirrorPut` EXTRAIT D'auth.js — jamais une copie.
 *
 *   node scripts/miroir-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

function extraire(src, depart) {
  const d = src.indexOf(depart);
  if (d < 0) return null;
  let i = src.indexOf('{', d), prof = 0, ch = null;
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

console.log('\n── 0. Extraction du vrai code ──');
const SRC_PUT  = extraire(AUTH, 'function _mirrorPut(');
const SRC_MANY = extraire(AUTH, 'function _mirrorPutMany(');
v('_mirrorPut extractible', !!SRC_PUT);
v('_mirrorPutMany extractible', !!SRC_MANY);

function bac() {
  if (!(SRC_PUT && SRC_MANY)) return null;
  const journal = [];
  const src =
    'const _usersMirror = new Map();\n'
    + 'const _usersMirrorById = new Map();\n'
    + 'function _mirrorIndex(row) { if (!row || !row.email) return; _usersMirror.set(String(row.email).toLowerCase().trim(), row); if (row.id != null) _usersMirrorById.set(String(row.id), row); }\n'
    + 'function _mirrorSaveFile() {}\n'
    + SRC_PUT + '\n' + SRC_MANY + '\n'
    + 'return { _usersMirror, _mirrorPut, _mirrorPutMany };';
  const api = new Function('console', src)({ warn: m => journal.push(m), log() {}, error() {} });
  return Object.assign(api, { journal });
}

/* LES DEUX LIGNES DU 30/08 ET DU 14/06, telles qu'elles existaient réellement. */
const FRAIS  = { id: '9', email: 'client@exemple.fr', name: 'Anis', plan: 'professionnel', active: true, password_hash: '$2b$10$hash', expires_at: '2026-09-30T00:00:00Z' };
const PERIME = { id: '9', email: 'client@exemple.fr', name: 'Anis', plan: 'professionnel', active: true, expires_at: '2026-06-11T00:00:00Z' };   // projection admin : PAS de hash

console.log('\n── 1. LE CAS RÉEL — la lecture de juin n\'écrase plus le 30 septembre ──');
{
  const S = bac();
  if (S) {
    S._mirrorPut(FRAIS);
    S._mirrorPutMany([PERIME]);           // exactement ce que fait getAllUsers au retour de la base
    const m = S._usersMirror.get('client@exemple.fr');
    v('LE CONTRÔLE CLÉ — l\'échéance reste au 30/09, la lecture périmée est refusée',
      m && m.expires_at === '2026-09-30T00:00:00Z', 'miroir : ' + (m && m.expires_at));
    v('… et le refus est TRACÉ (sans trace, personne n\'apprend qu\'une base est en retard)',
      S.journal.some(x => /échéance/.test(x)), JSON.stringify(S.journal));
    v('… le hash du miroir survit à une projection qui n\'en porte pas',
      m && m.password_hash === '$2b$10$hash', m && m.password_hash);
    v('… et les autres champs de la lecture passent normalement', m && m.name === 'Anis');
  }
}

console.log('\n── 2. Ce que la garde NE doit PAS bloquer ──');
{
  const S = bac();
  if (S) {
    /* LA MOITIÉ QUI COMPTE AUTANT. Une garde qui fige tout empêcherait le miroir d'apprendre un
       VRAI renouvellement, et on ne le verrait jamais — elle ne rend rien, elle retient. */
    S._mirrorPut(PERIME);
    S._mirrorPut({ ...FRAIS, expires_at: '2027-01-15T00:00:00Z' });
    const m = S._usersMirror.get('client@exemple.fr');
    v('[témoin] une échéance PLUS LOINTAINE est bien apprise', m && m.expires_at === '2027-01-15T00:00:00Z', m && m.expires_at);

    const S2 = bac();
    S2._mirrorPut({ ...FRAIS, expires_at: null });        // miroir sans échéance (compte neuf)
    S2._mirrorPut(PERIME);
    const m2 = S2._usersMirror.get('client@exemple.fr');
    v('[témoin] un miroir SANS échéance apprend celle de la base', m2 && m2.expires_at === '2026-06-11T00:00:00Z', m2 && m2.expires_at);

    const S3 = bac();
    S3._mirrorPut(PERIME);                                 // premier contact : le miroir était vide
    const m3 = S3._usersMirror.get('client@exemple.fr');
    v('[témoin] un miroir VIDE se remplit normalement (reconstruction après perte du volume)',
      m3 && m3.expires_at === '2026-06-11T00:00:00Z');
  }
}

console.log('\n── 3. Une lecture ne DÉSACTIVE pas un compte non plus ──');
{
  const S = bac();
  if (S) {
    S._mirrorPut(FRAIS);
    S._mirrorPut({ ...PERIME, active: false, expires_at: '2026-09-30T00:00:00Z' });
    const m = S._usersMirror.get('client@exemple.fr');
    v('un compte actif au miroir n\'est pas désactivé par une base en retard', m && m.active === true, 'active : ' + (m && m.active));
    v('… et c\'est tracé aussi', S.journal.some(x => /désactivé/.test(x)));

    const S2 = bac();
    S2._mirrorPut({ ...FRAIS, active: false });
    S2._mirrorPut({ ...PERIME, active: true, expires_at: '2026-09-30T00:00:00Z' });
    const m2 = S2._usersMirror.get('client@exemple.fr');
    v('[témoin] une RÉACTIVATION passe, elle (la garde ne bloque que le retrait)', m2 && m2.active === true);
  }
}

console.log('\n── 4. La garde vit bien dans le chemin des LECTURES, pas des écritures ──');
{
  /* Si updateUser passait par _mirrorPut, la garde empêcherait un admin de RACCOURCIR volontairement
     un abonnement — un remboursement, une résiliation. Ce contrôle fige cette séparation. */
  v('updateUser met le miroir à jour SANS passer par _mirrorPut',
    /Object\.assign\(row, upd\); _mirrorIndex\(row\)/.test(AUTH),
    'si ce chemin change, la garde deviendrait un blocage pour l\'administrateur');
  const appels = (AUTH.match(/_mirrorPut\(/g) || []).length;
  v('_mirrorPut reste appelé par les chemins de lecture', appels >= 4, appels + ' appel(s)');
}

console.log('\n──────────────────────────────────────────────────────────────────────');
if (ko) { console.log(`❌ miroir-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
console.log(`✅ miroir-verif : ${ok} contrôle(s) au vert.`);

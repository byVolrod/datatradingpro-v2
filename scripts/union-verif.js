#!/usr/bin/env node
/**
 * scripts/union-verif.js — UNE BASE REVENUE NE MASQUE PLUS LA DONNÉE FRAÎCHE D'UNE AUTRE
 *
 * POURQUOI CE BANC EXISTE (03/09/2026). Capture utilisateur : la boîte de réception du support
 * n'affichait plus qu'une partie des conversations, et un modèle de journal de bord semblait perdu.
 * MESURÉ sur la base principale au lendemain de sa sortie de pause, pas déduit :
 *
 *   · `chat_messages` y porte 71 messages et 26 fils, le plus récent daté du 14/06 — le jour même
 *     de la mise en pause. Cette table n'est pas dual-écrite : chaque message vit sur UNE base.
 *     Avant le 14/06 tout allait sur la principale, après, tout est allé sur db2 : les deux bases
 *     détiennent deux MOITIÉS DISJOINTES du même journal. Or `_runMulti` s'arrêtait au premier nœud
 *     au résultat NON VIDE — la principale répondait « 26 fils de juin », db2 n'était JAMAIS
 *     interrogée. Rien n'était perdu ; tout était caché, ce qui du point de vue du client revient
 *     exactement au même.
 *
 *   · `ai_cache` y porte `journal:1` daté du 14/06. Cette table-ci EST dual-écrite, donc une clé
 *     réécrite depuis converge seule — mais un modèle qu'on ne modifie plus reste figé à juin, et
 *     le tour de rôle rendait tantôt juin, tantôt septembre. `created_at` était stocké depuis
 *     toujours ; personne ne le lisait.
 *
 * CE BANC ÉPROUVE LE VRAI CODE D'auth.js — jamais une copie : une copie ne vieillit pas avec le
 * produit, elle continue d'affirmer ce qui n'est plus vrai (faute déjà commise ici, cf. bases-verif).
 *
 *   node scripts/union-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* Extraction par comptage d'accolades, chaînes ET commentaires sautés (une apostrophe française en
   commentaire ouvrirait une fausse chaîne et avalerait la fonction — piège relevé le 02/09). */
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

console.log('\n── 0. Extraction du vrai code d\'auth.js ──');
const SRC_RUN   = extraire(AUTH, 'async function _runMulti(');
const SRC_UNION = extraire(AUTH, 'async function _lireUnion(');
const SRC_FRAIS = extraire(AUTH, 'async function _lireFraicheur(');
const SRC_DOWN  = extraire(AUTH, 'function _markDown(');
const SRC_APPLY = extraire(AUTH, 'function _applyOps(');
/* ⚠️ EXTRAITES, PAS RECOPIÉES. C'est la faute que ce dépôt répète le plus : écrite en dur, une de
   ces deux lignes rendrait le banc AVEUGLE au seul réglage qui décide de tout — la vider dans
   auth.js laisserait tous les contrôles au vert. Un contrôle négatif l'éprouve plus bas. */
const SRC_TU  = (/const _TABLES_UNION     = new Set\(\[[^\]]*\]\);/.exec(AUTH) || [null])[0];
const SRC_TF  = (/const _TABLES_FRAICHEUR = new Map\(\[[\s\S]*?\]\);/.exec(AUTH) || [null])[0];
const SRC_SENS = (/const _TABLES_SENSIBLES = new Set\(\[[^\]]*\]\);/.exec(AUTH) || [null])[0];
const _TEMOIN = extraire("function z() {\n  // l'apostrophe d'usage\n  return { a: 1 };\n}", 'function z(');
v('[témoin] une apostrophe en commentaire ne casse pas l\'extracteur', !!_TEMOIN && /return \{ a: 1 \};/.test(_TEMOIN));
v('_runMulti extractible', !!SRC_RUN);
v('_lireUnion extractible', !!SRC_UNION);
v('_lireFraicheur extractible', !!SRC_FRAIS);
v('la liste des tables RÉUNIES est lue dans auth.js, pas recopiée ici',
  !!SRC_TU && /'chat_messages'/.test(SRC_TU), 'lu : ' + SRC_TU);
v('la liste des tables à FRAÎCHEUR est lue dans auth.js, pas recopiée ici',
  !!SRC_TF && /'ai_cache'/.test(SRC_TF) && /'created_at'/.test(SRC_TF), 'lu : ' + SRC_TF);
v('aiCacheGet ramène BIEN la date à arbitrer (sinon il n\'y a rien à départager)',
  /select\('value, created_at'\)\.eq\('key', k\)/.test(AUTH),
  'sans created_at dans le select, _lireFraicheur ne peut rien comparer');

/* ── Bac à sable : le VRAI code, des doublures pour le reste ────────────────────────────────────
   Chaque « base » journalise ce qu'on lui demande → on peut affirmer QUI a été interrogé, pas
   seulement ce qui est revenu. C'est toute la différence : le défaut corrigé ici n'était pas une
   mauvaise réponse, c'était une base qu'on n'interrogeait JAMAIS. */
function bac(nodes, opts) {
  if (!(SRC_RUN && SRC_UNION && SRC_FRAIS && SRC_DOWN && SRC_APPLY && SRC_TU && SRC_TF && SRC_SENS)) return null;
  const journal = [];
  const mkClient = (nom, reponses) => ({
    from(table) {
      const chaine = { _t: table, _ops: [] };
      ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'limit', 'order', 'range', 'single', 'like', 'lt', 'or']
        .forEach(m => { chaine[m] = (...a) => { chaine._ops.push([m, a]); return chaine; }; });
      chaine.then = (res, rej) => {
        const kind = chaine._ops.some(([m]) => ['insert', 'update', 'upsert', 'delete'].includes(m)) ? 'write' : 'read';
        journal.push({ noeud: nom, table, kind, ops: chaine._ops.map(([m]) => m).join('.') });
        return Promise.resolve(reponses(table, kind, chaine._ops)).then(res, rej);
      };
      return chaine;
    },
  });
  const src =
    'const _dbNodes = [];\n'
    + 'const _MULTI_TABLES = new Set([\'ai_cache\', \'weekly_reports\', \'email_log\']);\n'
    + (opts && opts.tuVide ? 'const _TABLES_UNION = new Set([]);\n' : SRC_TU + '\n')
    + (opts && opts.tfVide ? 'const _TABLES_FRAICHEUR = new Map([]);\n' : SRC_TF + '\n')
    + SRC_SENS + '\n'
    + 'let _rr = ' + ((opts && opts.rr) || 0) + ';\n'
    + 'function _isEgressCapped() { return false; }\n'
    + 'function _supaDown(err) { return !!err && err.code !== \'PGRST116\'; }\n'
    + 'function _isSchemaErr() { return false; }\n'
    + 'function _egTripped() { return false; }\n'
    + 'function _egNote() {}\n'
    + 'function _resBytes() { return 0; }\n'
    + SRC_APPLY + '\n' + SRC_DOWN + '\n' + SRC_UNION + '\n' + SRC_FRAIS + '\n' + SRC_RUN + '\n'
    + 'return { _dbNodes, _runMulti };';
  const api = new Function('console', src)({ warn() {}, log() {}, error() {} });
  nodes.forEach(n => api._dbNodes.push({ name: n.nom, downUntil: 0, quarLect: false, client: mkClient(n.nom, n.reponses) }));
  return Object.assign(api, { journal, interroges: t => journal.filter(j => j.table === t).map(j => j.noeud) });
}

/* LE SCÉNARIO MESURÉ : la principale est figée au 14/06 (non vide !), db2 porte la suite. */
const JUIN      = () => ({ data: [{ id: 1, user_id: 'u1', sender: 'user', text: 'juin',      created_at: '2026-06-14T11:54:29Z' }], error: null });
const SEPTEMBRE = () => ({ data: [{ id: 7, user_id: 'u9', sender: 'user', text: 'septembre', created_at: '2026-09-02T18:00:00Z' }], error: null });

const T = [];
const test = (nom, fn) => T.push({ nom, fn });

test('1. chat_messages : les deux moitiés sont recollées', async () => {
  const S = bac([{ nom: 'primary', reponses: JUIN }, { nom: 'db2', reponses: SEPTEMBRE }]);
  if (!S) return;
  const r = await S._runMulti('chat_messages', [['select', ['*']]], 'read');
  const txt = (r.data || []).map(x => x.text).sort().join(',');
  v('LE CAS DE LA CAPTURE — la moitié de juin ET celle de septembre reviennent', txt === 'juin,septembre', 'rendu : ' + txt);
  v('… et db2 a RÉELLEMENT été interrogée (c\'est ça, le défaut : on ne l\'appelait jamais)',
    S.interroges('chat_messages').includes('db2'), 'interrogés : ' + S.interroges('chat_messages').join('+'));
});

test('2. [contrôle négatif] sans _TABLES_UNION, le défaut revient', async () => {
  const S = bac([{ nom: 'primary', reponses: JUIN }, { nom: 'db2', reponses: SEPTEMBRE }], { tuVide: true });
  if (!S) return;
  const r = await S._runMulti('chat_messages', [['select', ['*']]], 'read');
  v('[négatif] la liste vidée, seule la moitié de juin revient — le filet mord bien',
    (r.data || []).length === 1 && r.data[0].text === 'juin', JSON.stringify(r.data));
  v('[négatif] … et db2 n\'est PAS interrogée', !S.interroges('chat_messages').includes('db2'));
});

test('3. Le compteur de non-lus se SOMME au lieu de s\'élire', async () => {
  const S = bac([
    { nom: 'primary', reponses: () => ({ data: null, count: 2, error: null }) },
    { nom: 'db2',     reponses: () => ({ data: null, count: 5, error: null }) },
  ]);
  if (!S) return;
  const r = await S._runMulti('chat_messages', [['select', ['id', { count: 'exact', head: true }]]], 'read');
  v('2 non-lus ici + 5 là-bas font 7, pas 2', r.count === 7, 'compté : ' + r.count);
  v('… et aucune ligne n\'est inventée au passage', r.data === null, JSON.stringify(r.data));
});

test('4. Aucun dédoublonnage : trois non-lus du même client restent TROIS', async () => {
  /* LE PIÈGE ÉVITÉ. `chatThreads` lit `select(\'user_id\')` sur les non-lus : une ligne PAR message,
     toutes réduites au seul user_id, donc IDENTIQUES entre elles. Les fusionner « proprement »
     aurait ramené le badge de 3 à 1 — un dédoublonnage qui casse ce qu'il prétend nettoyer. */
  const trois = () => ({ data: [{ user_id: 'u1' }, { user_id: 'u1' }], error: null });
  const un    = () => ({ data: [{ user_id: 'u1' }], error: null });
  const S = bac([{ nom: 'primary', reponses: trois }, { nom: 'db2', reponses: un }]);
  if (!S) return;
  const r = await S._runMulti('chat_messages', [['select', ['user_id']]], 'read');
  v('deux lignes identiques + une font TROIS (le badge compte des messages, pas des clients)',
    (r.data || []).length === 3, 'rendu : ' + (r.data || []).length);
});

test('5. L\'ordre et la limite sont rejoués sur la réunion', async () => {
  /* Chaque base a trié SA moitié et l'a coupée à sa limite. Concaténer deux moitiés triées ne donne
     pas un tout trié : sans ce rejeu, la boîte de réception entrelacerait juin et septembre. */
  const A = () => ({ data: [{ t: '2026-06-01' }, { t: '2026-05-01' }], error: null });
  const B = () => ({ data: [{ t: '2026-09-02' }, { t: '2026-07-01' }], error: null });
  const S = bac([{ nom: 'primary', reponses: A }, { nom: 'db2', reponses: B }]);
  if (!S) return;
  const ops = [['select', ['*']], ['order', ['t', { ascending: false }]], ['limit', [3]]];
  const r = await S._runMulti('chat_messages', ops, 'read');
  v('le plus récent des QUATRE arrive en tête, toutes bases confondues',
    r.data && r.data[0].t === '2026-09-02', JSON.stringify(r.data));
  v('… et la limite de 3 est appliquée à la réunion, pas 3 PAR base',
    r.data && r.data.length === 3, 'rendu : ' + (r.data || []).length);
  v('… dans l\'ordre décroissant demandé',
    r.data && r.data.map(x => x.t).join('>') === '2026-09-02>2026-07-01>2026-06-01', JSON.stringify(r.data));
});

test('6. Une base muette ne fait pas échouer la lecture des autres', async () => {
  const S = bac([
    { nom: 'primary', reponses: () => ({ data: null, error: { message: 'paused', code: 'XX000' } }) },
    { nom: 'db2',     reponses: SEPTEMBRE },
  ]);
  if (!S) return;
  const r = await S._runMulti('chat_messages', [['select', ['*']]], 'read');
  v('une base tombée, l\'autre répond : on rend sa moitié, pas une panne',
    !r.error && (r.data || []).length === 1 && r.data[0].text === 'septembre', JSON.stringify(r));
  const S2 = bac([
    { nom: 'primary', reponses: () => ({ data: null, error: { message: 'paused', code: 'XX000' } }) },
    { nom: 'db2',     reponses: () => ({ data: null, error: { message: 'paused', code: 'XX000' } }) },
  ]);
  const r2 = await S2._runMulti('chat_messages', [['select', ['*']]], 'read');
  v('[témoin] TOUTES tombées → erreur, et pas un « aucun message » trompeur', !!r2.error, JSON.stringify(r2));
});

test('7. L\'écriture est DIFFUSÉE — sinon on ne répare qu\'une moitié', async () => {
  const S = bac([{ nom: 'primary', reponses: () => ({ data: [], error: null }) }, { nom: 'db2', reponses: () => ({ data: [], error: null }) }]);
  if (!S) return;
  await S._runMulti('chat_messages', [['update', [{ read: true }]], ['eq', ['user_id', 'u1']]], 'write');
  const w = S.journal.filter(j => j.kind === 'write').map(j => j.noeud).sort().join('+');
  v('« marquer comme lu » atteint les DEUX bases (le badge doit pouvoir retomber à zéro)',
    w === 'db2+primary', 'atteints : ' + w);
});

test('8. L\'INSERT, lui, ne se diffuse PAS', async () => {
  /* La moitié qui compte autant : diffuser l'insert créerait quatre exemplaires du même message,
     et la réunion les montrerait tous les quatre. Un garde-fou trop large casse ce qu'il protège. */
  const S = bac([{ nom: 'primary', reponses: () => ({ data: [{ id: 1 }], error: null }) }, { nom: 'db2', reponses: () => ({ data: [{ id: 1 }], error: null }) }]);
  if (!S) return;
  await S._runMulti('chat_messages', [['insert', [[{ text: 'coucou' }]]]], 'write');
  const w = S.journal.filter(j => j.kind === 'write').map(j => j.noeud);
  v('[témoin] un message envoyé n\'est écrit que sur UNE base', w.length === 1, 'atteints : ' + w.join('+'));
});

test('9. ai_cache : la ligne la PLUS RÉCENTE gagne, quel que soit le tour', async () => {
  const vieux = () => ({ data: [{ value: 'modèle de juin',      created_at: '2026-06-14T12:51:48Z' }], error: null });
  const neuf  = () => ({ data: [{ value: 'modèle de septembre', created_at: '2026-09-02T20:00:00Z' }], error: null });
  for (const rr of [0, 1]) {
    const S = bac([{ nom: 'primary', reponses: vieux }, { nom: 'db2', reponses: neuf }], { rr });
    if (!S) return;
    const r = await S._runMulti('ai_cache', [['select', ['value, created_at']], ['eq', ['key', 'journal:1']]], 'read');
    v(`LE MODÈLE JOT — septembre l'emporte sur juin (tour de rôle = ${rr})`,
      r.data && r.data[0].value === 'modèle de septembre', JSON.stringify(r.data));
  }
});

test('10. [contrôle négatif] sans _TABLES_FRAICHEUR, le tour de rôle décide encore', async () => {
  const vieux = () => ({ data: [{ value: 'modèle de juin', created_at: '2026-06-14T12:51:48Z' }], error: null });
  const neuf  = () => ({ data: [{ value: 'modèle de septembre', created_at: '2026-09-02T20:00:00Z' }], error: null });
  const S = bac([{ nom: 'primary', reponses: vieux }, { nom: 'db2', reponses: neuf }], { tfVide: true, rr: 0 });
  if (!S) return;
  const r = await S._runMulti('ai_cache', [['select', ['value, created_at']], ['eq', ['key', 'journal:1']]], 'read');
  v('[négatif] la carte vidée, c\'est juin qui ressort — le filet mord bien',
    r.data && r.data[0].value === 'modèle de juin', JSON.stringify(r.data));
});

test('11. Sans colonne de date, on retombe exactement sur l\'ancien comportement', async () => {
  /* La sonde `select(\'key\').limit(1)` ne ramène aucune date : il n'y a rien à arbitrer. Le repli
     doit être le PREMIER NON VIDE, à l'identique — un garde-fou qui rendrait « rien » ici couperait
     la détection de la table. */
  const S = bac([
    { nom: 'primary', reponses: () => ({ data: [{ key: 'k' }], error: null }) },
    { nom: 'db2',     reponses: () => ({ data: [{ key: 'k' }], error: null }) },
  ]);
  if (!S) return;
  const r = await S._runMulti('ai_cache', [['select', ['key']], ['limit', [1]]], 'read');
  v('la sonde de présence de table répond toujours', r.data && r.data.length === 1 && !r.error, JSON.stringify(r));
});

test('12. Les autres tables ne changent pas de comportement', async () => {
  const S = bac([{ nom: 'primary', reponses: JUIN }, { nom: 'db2', reponses: SEPTEMBRE }]);
  if (!S) return;
  const r = await S._runMulti('users', [['select', ['*']]], 'read');
  v('[témoin] `users` s\'arrête toujours au premier nœud non vide (sa garde à lui, c\'est la quarantaine)',
    (r.data || []).length === 1 && r.data[0].text === 'juin', JSON.stringify(r.data));
});

(async () => {
  for (const t of T) { console.log('\n── ' + t.nom + ' ──'); await t.fn(); }
  console.log('\n──────────────────────────────────────────────────────────────────────');
  if (ko) { console.log(`❌ union-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
  console.log(`✅ union-verif : ${ok} contrôle(s) au vert.`);
})();

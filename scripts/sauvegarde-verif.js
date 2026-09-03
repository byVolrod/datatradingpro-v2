#!/usr/bin/env node
/**
 * scripts/sauvegarde-verif.js — LA SAUVEGARDE SAUVEGARDE-T-ELLE VRAIMENT ?
 *
 * POURQUOI CE BANC (03/09/2026). En cherchant ce qui protégeait les données d'une nouvelle mise en
 * pause, j'ai trouvé DEUX défauts, et le premier est du même genre que celui du keep-alive d'août :
 * une tâche qui a l'air installée et qui ne fait rien.
 *
 *   1. `exporterTable(client, t)` lit `t.nom` — et on l'appelait avec `t.nom`. La table demandée à
 *      Supabase était donc littéralement « undefined ». Comme `users` est marquée obligatoire,
 *      l'export sortait en erreur, et `dtp-sauvegarde.sh` s'interrompt alors sans produire
 *      d'archive (« mieux vaut pas de sauvegarde qu'une sauvegarde sans les comptes »). Conséquence :
 *      AUCUNE archive n'a jamais été produite depuis la pose des minuteurs.
 *
 *   2. La liste des tables couvrait `users`, `email_log`, `weekly_reports` — mais NI les
 *      conversations du support, NI le magasin clé-valeur, qui porte les modèles de journal de bord
 *      des clients. Une archive qui ne les contient pas laisse croire que tout est sauvegardé alors
 *      que ce que les clients ont PRODUIT ne l'est pas.
 *
 * CE BANC NE LIT PAS LE CODE, IL LE JOUE : la vraie fonction est extraite et exécutée avec un
 * client espion qui note quel nom de table part réellement. Une relecture ne voit pas ce défaut —
 * les deux lignes sont justes séparément, c'est leur rencontre qui est fausse.
 *
 *   node scripts/sauvegarde-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const EXP = fs.readFileSync(path.join(RACINE, 'scripts/vps/dtp-export-bdd.js'), 'utf8');
const SH  = fs.readFileSync(path.join(RACINE, 'scripts/vps/dtp-sauvegarde.sh'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ⚠️ TOUT LE BANC VIT DANS CETTE FONCTION. Premier jet écrit avec un `return` au niveau du module
   pour enchaîner sur la suite après l'`await` : `return` hors fonction est une erreur de syntaxe,
   que `node -c` voit mais qu'on ne voit pas en relisant — js-verif l'a attrapée. */
async function principal() {
  console.log('\n── 1. LE CONTRÔLE CLÉ — quelle table part vraiment vers Supabase ? ──');
  const d = EXP.indexOf('async function exporterTable(');
  const f = EXP.indexOf('\n}', d) + 2;
  v('exporterTable extractible', d > 0 && f > d);
  /* On rejoue la VRAIE fonction avec le VRAI argument du site d'appel, extrait lui aussi. */
  const appel = /await exporterTable\(client, ([^)]+)\)/.exec(EXP);
  v('le site d\'appel est lisible', !!appel, appel && appel[1]);
  if (d > 0 && appel) {
    const fn = new Function('const PAGE = 1000;\n' + EXP.slice(d, f) + '\nreturn exporterTable;')();
    const vu = [];
    const espion = { from(nom) { vu.push(nom); return { select() { return { range: async () => ({ data: [], error: null }) }; } }; } };
    const t = { nom: 'users', obligatoire: true };
    // On reproduit l'expression du site d'appel telle qu'elle est écrite dans le fichier.
    const arg = new Function('t', 'return ' + appel[1] + ';')(t);
    await fn(espion, arg);
    v('la table demandée est « users », pas « undefined »', vu[0] === 'users',
      'reçu : ' + JSON.stringify(vu[0]) + ' — l\'export échouerait, et la sauvegarde entière avec lui');
  }
  suite();
}

function suite() {
  console.log('\n── 2. Les tables qui portent des données de CLIENT sont exportées ──');
  const bloc = /const TABLES = \[([\s\S]*?)\];/.exec(EXP);
  v('la liste des tables est lisible', !!bloc);
  if (bloc) {
    const noms = [...bloc[1].matchAll(/nom:\s*'([^']+)'/g)].map(m => m[1]);
    v('les tables sont LUES dans le fichier, pas recopiées ici', noms.length >= 3, noms.join(', '));
    [['users', 'les comptes et les abonnements'],
     ['chat_messages', 'les conversations du support'],
     ['ai_cache', 'les modèles de journal, la liste noire, les pierres tombales']]
      .forEach(([n, quoi]) => v(`« ${n} » est sauvegardée (${quoi})`, noms.includes(n),
        'une archive sans cette table laisse croire que tout est sauvegardé'));
    v('[témoin] les tables déjà couvertes le restent', noms.includes('email_log') && noms.includes('weekly_reports'));
    v('seule `users` est OBLIGATOIRE (une table vide ne doit pas bloquer l\'archive)',
      (bloc[1].match(/obligatoire:\s*true/g) || []).length === 1,
      'si chat_messages devenait obligatoire, une journée sans message empêcherait toute sauvegarde');
  }

  console.log('\n── 3. Une archive incomplète ne doit pas passer pour une archive ──');
  v('la sauvegarde s\'interrompt si l\'export échoue', /Aucune archive ne sera produite/.test(SH));
  v('… et elle vérifie la présence du dump des comptes dans l\'archive finale',
    /donnees\/dump\/users\.json/.test(SH));
  v('l\'export relit ce qu\'il vient d\'écrire (un fichier tronqué a l\'air d\'un export)',
    /relecture incoherente/.test(EXP));
  v('les fichiers locaux irremplaçables sont dans l\'archive',
    /users_blacklist\.json/.test(SH) && /users_deleted\.json/.test(SH) && /users_mirror\.json/.test(SH));

  console.log('\n── 4. La pagination ne tronque pas en silence ──');
  v('la lecture est paginée (Supabase plafonne à 1000 lignes)', /range\(debut, debut \+ PAGE - 1\)/.test(EXP));
  v('… et un volume aberrant lève une erreur au lieu de rogner', /garde-fou, export interrompu/.test(EXP));

  console.log('\n──────────────────────────────────────────────────────────────────────');
  if (ko) { console.log(`❌ sauvegarde-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
  console.log(`✅ sauvegarde-verif : ${ok} contrôle(s) au vert.`);
}

principal().catch(e => { console.error(e); process.exit(1); });

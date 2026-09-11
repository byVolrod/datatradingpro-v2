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


  /* ══════════════════════════════════════════════════════════════════════════════════════════
     LA LISTE DE L'ARCHIVE EST ÉCRITE À LA MAIN — DONC ELLE DÉRIVE (10/09)
     ────────────────────────────────────────────────────────────────────────────────────────
     `dtp-sauvegarde.sh` copie une liste EXPLICITE de fichiers de `data/app`, et c'est le bon
     choix : un `cp -a data/` embarquerait 1,8 Go de profils de navigateur. Mais une liste écrite
     à la main ne se met pas à jour toute seule. Rien, jusqu'ici, ne reliait ce qu'on SAUVEGARDE
     à ce que le serveur ÉCRIT : un nouveau fichier durable posé demain n'entrerait dans aucune
     archive, et personne ne l'apprendrait avant d'en avoir besoin. C'est exactement la forme des
     deux incidents déjà payés ici — la sauvegarde qui ne produisait rien, le keep-alive qui ne
     pinguait rien : une protection qui a l'air en place.
     ⚠️ CE CONTRÔLE NE RÉCLAME PAS QUE TOUT SOIT SAUVEGARDÉ. La plupart de ces fichiers sont des
     caches que l'IA régénère, et les embarquer gonflerait l'archive pour rien. Il réclame une
     DÉCISION : chaque fichier écrit sous DATA_DIR est soit dans l'archive, soit inscrit ci-dessous
     avec la raison de son exclusion. Un nom inconnu fait rougir — on choisit, on ne subit pas. */
  const SAUV = fs.readFileSync(path.join(RACINE, 'scripts/vps/dtp-sauvegarde.sh'), 'utf8');
  const _d = SAUV.indexOf('for f in cache_email_log.json');
  const ARCHIVES = new Set(_d < 0 ? [] : (SAUV.slice(_d, SAUV.indexOf('; do', _d)).match(/[\w.\-]+\.json/g) || []));
  v('la liste explicite de l’archive est lisible dans dtp-sauvegarde.sh', ARCHIVES.size >= 10,
    ARCHIVES.size + ' fichier(s) — si 0, la boucle `for f in …` a été renommée et ce contrôle ne voit plus rien');

  /* Exclusions ASSUMÉES, chacune avec sa raison. En ajouter une est un acte volontaire. */
  const REGENERABLES = {
    'cache_analyse.json': 'segmentation IA d’un rapport : régénérée à la demande',
    'cache_bank_extract.json': 'extraction IA d’un PDF de banque : régénérée à la demande',
    'cache_bias.json': 'narratif IA du Radar de Biais : régénéré chaque samedi',
    'cache_br_seg.json': 'segmentation IA d’un rapport institutionnel : régénérée',
    'cache_br_pdf.json': 'rendu PDF : refabriqué depuis la source',
    'cache_br_print.json': 'rendu imprimable : refabriqué depuis la source',
    'cache_infotitle.json': 'titres traduits : retraduits à l’affichage',
    'cache_insights.json': 'éclairages IA : régénérés',
    'cache_news_info.json': 'enrichissement IA du fil : régénéré',
    'cache_sw_seg.json': 'segmentation IA du récap de séance : régénérée',
    'cache_translate.json': 'traductions : retraduites',
    'cache_week_ahead.json': 'aperçu de la semaine : régénéré (WA_VER le force déjà)',
    'cache_ai_demand.json': 'compteur de sollicitation IA : se reconstruit seul',
    'cache_reaction.json': 'réactions : elles ont leur contrepartie en base (ai_cache `chat:reactions`), donc déjà dans le dump',
    'cache_lastseen.json': 'dernière visite par compte : se reconstruit à la visite suivante ; au pire le tri de la boîte de réception est approximatif quelques jours (users.last_login, lui, EST en base)',
    'disque_historique.json': 'historique de remplissage du disque : la sentinelle le réapprend en quelques heures',
    'disque_prudence.json': 'cran de prudence appris : réappris, et il ne fait que RENDRE PLUS PRUDENT (jamais moins)',
    /* ⚠️ NI DURABLE NI CACHE : ÉPHÉMÈRE, et c'est une troisième catégorie qu'il faut nommer plutôt
       que de la ranger de force dans l'une des deux. Ce fichier est un ORDRE déposé par le panneau
       admin à destination de la sentinelle de l'hôte (« libère de la place »), consommé à son
       prochain passage, au plus tard un quart d'heure après, et jeté au-delà d'une heure.
       L'archiver serait pire qu'inutile : on restaurerait un ordre périmé, qui déclencherait une
       purge des jours plus tard sans personne pour l'attendre. */
    'disque_demande.json': 'demande de libération déposée pour la sentinelle : consommée sous 15 min, périmée au-delà d’une heure. L’archiver rejouerait un ordre périmé à la restauration',
  };

  const SOURCES = ['server.js', 'auth.js', 'mailer.js', 'ai.js'];
  const ECRITS = new Set();
  for (const f of SOURCES) {
    let txt = ''; try { txt = fs.readFileSync(path.join(RACINE, f), 'utf8'); } catch { continue; }
    for (const m of txt.matchAll(/path\.join\(\s*(?:_CACHE_DIR|_DATA_DIR|DATA_DIR)\s*,\s*'([^']+\.json)'/g)) ECRITS.add(m[1]);
  }
  v('les fichiers durables écrits sous DATA_DIR sont repérables dans le code', ECRITS.size >= 20,
    ECRITS.size + ' trouvé(s) — trop peu : le motif `path.join(_CACHE_DIR, …)` a changé et ce contrôle ne voit plus rien');

  const inconnus = [...ECRITS].filter(f => !ARCHIVES.has(f) && !REGENERABLES[f]).sort();
  v('aucun fichier écrit sous DATA_DIR n’échappe à une DÉCISION (archive ou exclusion motivée)',
    inconnus.length === 0,
    inconnus.join(', ') + '\n      → DURABLE ? l’ajouter à la boucle `for f in …` de scripts/vps/dtp-sauvegarde.sh.'
    + '\n      → RÉGÉNÉRABLE ? l’inscrire dans REGENERABLES ici, AVEC sa raison. Ne pas laisser le choix implicite.');

  /* Symétrie : une exclusion qui ne correspond plus à aucun fichier écrit est une liste périmée,
     et une liste périmée ment avec l'autorité du code. */
  const fantomes = Object.keys(REGENERABLES).filter(f => !ECRITS.has(f)).sort();
  v('… et aucune exclusion ne survit à son fichier (liste non périmée)', fantomes.length === 0,
    'plus écrit nulle part : ' + fantomes.join(', ') + ' — retirer de REGENERABLES.');

  /* TÉMOIN : un fichier durable inventé DOIT être refusé, sinon le contrôle ne mord pas. */
  const faux = new Set([...ECRITS, 'cache_tout_neuf_et_durable.json']);
  const mordu = [...faux].filter(f => !ARCHIVES.has(f) && !REGENERABLES[f]);
  v('[témoin] un nouveau fichier durable serait bien signalé', mordu.length === 1 && mordu[0] === 'cache_tout_neuf_et_durable.json',
    'le contrôle ne mord pas : il laisserait passer un fichier hors de toute décision.');

  console.log('\n──────────────────────────────────────────────────────────────────────');
  if (ko) { console.log(`❌ sauvegarde-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
  console.log(`✅ sauvegarde-verif : ${ok} contrôle(s) au vert.`);
}

principal().catch(e => { console.error(e); process.exit(1); });

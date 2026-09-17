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

/* Extrait une fonction (async ou non) par comptage d'accolades — même méthode que les autres
   bancs du dépôt (journal-garde-verif.js, calendrier-verif.js). */
function extraireFn(nom) {
  const m = /(?:async\s+)?function\s+NOM\s*\(/.source.replace('NOM', nom);
  const rx = new RegExp(m);
  const i = EXP.search(rx);
  if (i < 0) return null;
  const debutAccolade = EXP.indexOf('{', i);
  let prof = 0;
  for (let k = debutAccolade; k < EXP.length; k++) {
    if (EXP[k] === '{') prof++;
    else if (EXP[k] === '}') { prof--; if (prof === 0) return EXP.slice(i, k + 1); }
  }
  return null;
}

/* ⚠️ TOUT LE BANC VIT DANS CETTE FONCTION. Premier jet écrit avec un `return` au niveau du module
   pour enchaîner sur la suite après l'`await` : `return` hors fonction est une erreur de syntaxe,
   que `node -c` voit mais qu'on ne voit pas en relisant — js-verif l'a attrapée. */
async function principal() {
  console.log('\n── 1. LE CONTRÔLE CLÉ — quelle table part vraiment vers Supabase ? ──');
  /* ⚠️ 17/09/2026 : le script est passé de `@supabase/supabase-js` à `fetch` nu (« zéro
     dépendance », même choix que supabase-keepalive.js — voir l'en-tête de dtp-export-bdd.js). Ce
     banc rejouait l'ancienne forme (`client.from(nom).select().range()`) ; il éprouve maintenant
     le VRAI appel HTTP, avec un faux `fetch` qui note quelle table part réellement dans l'URL —
     c'est encore plus proche de la production qu'avant : on ne fait plus confiance à une couche
     d'abstraction, on regarde ce qui part sur le réseau. */
  const srcGet = extraireFn('supaGet');
  const srcExp = extraireFn('exporterTable');
  v('`supaGet` extractible', !!srcGet);
  v('`exporterTable` extractible', !!srcExp);
  if (srcGet && srcExp) {
    const vu = [];
    const fauxFetch = async (url) => {
      const table = decodeURIComponent(new URL(url).pathname.split('/').pop());
      vu.push(table);
      return { ok: true, status: 200, json: async () => [] };
    };
    const fn = new Function('fetch', 'AbortController', 'PAGE', 'DELAI_MS',
      srcGet + '\n' + srcExp + '\nreturn exporterTable;')(fauxFetch, AbortController, 1000, 15000);
    const t = { nom: 'users', obligatoire: true };
    await fn('https://exemple.supabase.co', 'clefactice', t);
    v('la table demandée est « users », pas « undefined »', vu[0] === 'users',
      'reçu : ' + JSON.stringify(vu[0]) + ' — l\'export échouerait, et la sauvegarde entière avec lui');
  }
  await suite();
}

async function suite() {
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
  v('la lecture est paginée par en-tête `Range` (Supabase plafonne à 1000 lignes)', /Range:\s*debut \+ '-' \+ fin/.test(EXP));
  v('… et un volume aberrant lève une erreur au lieu de rogner', /garde-fou, export interrompu/.test(EXP));

  /* ⚠️ LA PAGINATION, REJOUÉE POUR DE VRAI (17/09) — pas seulement grep. Un faux `fetch` sert des
     pages de 1000, 1000 puis 234 lignes ; on vérifie que `exporterTable` fait bien PLUSIEURS
     appels (et pas un seul, tronqué), s'arrête à la dernière page partielle, et rend le bon total. */
  {
    const srcGet2 = extraireFn('supaGet');
    const srcExp2 = extraireFn('exporterTable');
    if (srcGet2 && srcExp2) {
      const TOTAL = 2234;
      let appels = 0;
      const fauxFetch = async (url, opts) => {
        appels++;
        const [debut, fin] = opts.headers.Range.split('-').map(Number);
        const tranche = Array.from({ length: Math.max(0, Math.min(fin, TOTAL - 1) - debut + 1) }, (_, i) => ({ id: debut + i }));
        return { ok: true, status: tranche.length === TOTAL - debut ? 200 : 206, json: async () => tranche };
      };
      const fn = new Function('fetch', 'AbortController', 'PAGE', 'DELAI_MS',
        srcGet2 + '\n' + srcExp2 + '\nreturn exporterTable;')(fauxFetch, AbortController, 1000, 15000);
      const lignes = await fn('https://exemple.supabase.co', 'clefactice', { nom: 'users' });
      v('2234 lignes (3 pages) reviennent TOUTES, sans troncature', lignes.length === TOTAL,
        'reçu ' + lignes.length + ' ligne(s) en ' + appels + ' appel(s)');
      v('… en effectuant PLUSIEURS appels (la pagination tourne vraiment)', appels === 3, appels + ' appel(s)');

      // TÉMOIN : sans l'incrément de page, un seul appel reviendrait, tronqué à 1000 lignes.
      const muteExp = srcExp2.replace(/debut \+= PAGE/, 'debut += 999999');
      if (muteExp === srcExp2) {
        v('(témoin) la mutation change bien le source', false, 'la boucle a changé de forme : ce témoin ne prouve plus rien');
      } else {
        const fnMute = new Function('fetch', 'AbortController', 'PAGE', 'DELAI_MS',
          srcGet2 + '\n' + muteExp + '\nreturn exporterTable;')(fauxFetch, AbortController, 1000, 15000);
        const lignesMute = await fnMute('https://exemple.supabase.co', 'clefactice', { nom: 'users' });
        v('(témoin) sans la pagination, l\'export tronque bien à 1000 lignes', lignesMute.length === 1000,
          'reçu ' + lignesMute.length + ' — si ce n\'est pas 1000, le témoin ne mord plus');
      }
    }
  }


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

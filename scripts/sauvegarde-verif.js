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
const MAILER = fs.readFileSync(path.join(RACINE, 'mailer.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* Extrait une fonction (async ou non) par comptage d'accolades — même méthode que les autres
   bancs du dépôt (journal-garde-verif.js, calendrier-verif.js). Généralisée le 17/09 pour
   pouvoir aussi extraire de mailer.js (§6, copie hors-site) sans dupliquer la mécanique. */
function extraireDe(texte, nom) {
  const m = /(?:async\s+)?function\s+NOM\s*\(/.source.replace('NOM', nom);
  const rx = new RegExp(m);
  const i = texte.search(rx);
  if (i < 0) return null;
  // ⚠️ LE CORPS COMMENCE APRÈS LA PARENTHÈSE FERMANTE, PAS AU PREMIER « { ». Une signature
  // déstructurée (`sendAdminAlert({ subject, html, to, attachments } = {})`) contient ses PROPRES
  // accolades avant même le corps : partir du tout premier « { » du fichier (comme le faisait ce
  // compteur avant le 17/09) prend la destructuration pour le début du corps, referme dès sa
  // propre accolade, et rend une fonction TRONQUÉE — invalide dès qu'on l'exécute. On compte donc
  // d'abord les parenthèses jusqu'à leur fermeture, puis les accolades APRÈS ce point.
  const debutParen = texte.indexOf('(', i);
  let profParen = 0, finParen = -1;
  for (let k = debutParen; k < texte.length; k++) {
    if (texte[k] === '(') profParen++;
    else if (texte[k] === ')') { profParen--; if (profParen === 0) { finParen = k; break; } }
  }
  if (finParen < 0) return null;
  const debutAccolade = texte.indexOf('{', finParen);
  let prof = 0;
  for (let k = debutAccolade; k < texte.length; k++) {
    if (texte[k] === '{') prof++;
    else if (texte[k] === '}') { prof--; if (prof === 0) return texte.slice(i, k + 1); }
  }
  return null;
}
function extraireFn(nom) { return extraireDe(EXP, nom); }

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

  console.log('\n── 5. Le dump de la base atterrit VRAIMENT dans donnees/dump/, pas à plat ──');
  /* ⚠️ 17/09/2026, TROUVÉ EN FAISANT TOURNER CETTE SAUVEGARDE POUR LA PREMIÈRE FOIS DEPUIS SA
     POSE — les deux bugs précédents du même jour (droit d'exécution, puis .env exécuté au lieu
     d'être lu) l'empêchaient d'atteindre ce point du script. `mkdir -p donnees` vivait APRÈS
     `cp -a "$REPO/data/app/dump" donnees/` : quand `donnees` n'existe pas encore, `cp -a` ne
     NICHE pas la source dedans, il la RENOMME. Le dump atterrissait donc à plat
     (`donnees/users.json`) au lieu de `donnees/dump/users.json` — exactement ce que la
     vérification finale de l'archive exige, et exactement ce qui la faisait SUPPRIMER à chaque
     passage. ON EXÉCUTE LE VRAI EXTRAIT du script, avec un faux `node` qui simule un export
     réussi, pour lire la vraie structure de fichiers produite — une relecture ne voit pas ce
     défaut, l'ordre des deux lignes est la seule chose qui compte. */
  {
    const iDebut = SH.indexOf('\nmkdir -p donnees\n');
    const iFin = SH.indexOf('\n# ── 2. LES DONNÉES IRREMPLAÇABLES', iDebut);
    const bloc = (iDebut >= 0 && iFin > iDebut) ? SH.slice(iDebut, iFin) : null;
    v('le bloc « créer donnees/ puis y copier le dump » est extractible', !!bloc,
      'les ancres ont changé de forme : ce contrôle ne voit plus rien');
    if (bloc) {
      const os = require('os');
      const jouer = (corpsBloc) => {
        const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-dump-'));
        const repo = path.join(bac, 'repo'); const bin = path.join(bac, 'bin'); const scene = path.join(bac, 'scene');
        fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(scene, { recursive: true });
        // Faux `node` : simule un export réussi en écrivant un users.json, comme le ferait le vrai.
        fs.writeFileSync(path.join(bin, 'node'),
          '#!/usr/bin/env bash\nmkdir -p data/app/dump\necho \'[]\' > data/app/dump/users.json\nexit 0\n', { mode: 0o755 });
        const script = `set -u\nexport PATH=${JSON.stringify(bin)}:$PATH\nREPO=${JSON.stringify(repo)}\nmsg() { :; }\ncd ${JSON.stringify(scene)}\n${corpsBloc}`;
        require('child_process').spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
        return scene;
      };
      const scene = jouer(bloc);
      const imbrique = fs.existsSync(path.join(scene, 'donnees', 'dump', 'users.json'));
      const aPlat = fs.existsSync(path.join(scene, 'donnees', 'users.json'));
      v('le dump est bien NICHÉ dans donnees/dump/users.json (ce que la vérification finale exige)',
        imbrique, 'introuvable — l\'archive produite serait supprimée par sa propre vérification');
      v('… et pas éparpillé à plat dans donnees/users.json', !aPlat,
        'trouvé à plat : c\'est exactement le défaut mesuré le 17/09');

      // TÉMOIN : remettre l'ordre d'origine (mkdir APRÈS la copie) doit reproduire le défaut.
      const mute = bloc.replace('mkdir -p donnees\n', '') + '\nmkdir -p donnees\n';
      if (mute === bloc) {
        v('(témoin) la mutation change bien le bloc', false, 'l\'ordre a changé de forme : ce témoin ne prouve plus rien');
      } else {
        const sceneMute = jouer(mute);
        const imbriqueMute = fs.existsSync(path.join(sceneMute, 'donnees', 'dump', 'users.json'));
        const aPlatMute = fs.existsSync(path.join(sceneMute, 'donnees', 'users.json'));
        v('(témoin) avec l\'ancien ordre, le défaut du 17/09 revient bien (dump à plat)',
          aPlatMute && !imbriqueMute,
          'imbriqué=' + imbriqueMute + ' à plat=' + aPlatMute + ' — si le témoin ne mord pas, il ne prouve plus rien');
      }
    }
  }

  console.log('\n── 6. LA COPIE HORS-SITE — l\'archive part-elle VRAIMENT ailleurs que le VPS ? (17/09) ──');
  /* ⚠️ POURQUOI CE BANC. Jusqu'ici la dernière ligne du script se contentait de LE DIRE
     (« RAPPEL : cette archive est SUR LA MEME MACHINE ») sans rien faire — exactement la forme
     du keep-alive d'août et de la sauvegarde de la nuit dernière : une protection qui a l'air en
     place. `_copie_hors_site` envoie maintenant l'archive en pièce jointe par le mailer déjà
     chargé dans le conteneur. ON EXÉCUTE LE VRAI EXTRAIT du script (pas une copie), avec une
     doublure `docker` qui capture ce qui part réellement sur l'entrée standard d'un `docker exec`
     — même mécanique que `_alerter_echec` dans env-verif.js. */
  {
    const iDebut = SH.indexOf('_copie_hors_site() {');
    const iFin = SH.indexOf('\n_copie_hors_site || msg', iDebut);
    const fnSrc = (iDebut >= 0 && iFin > iDebut) ? SH.slice(iDebut, iFin) : null;
    v('`_copie_hors_site` est extractible du script réel', !!fnSrc,
      'les ancres ont changé de forme : ce contrôle ne voit plus rien');

    if (fnSrc) {
      const os = require('os');
      const { spawnSync } = require('child_process');
      const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-horssite-'));

      // Doublure docker « présent » : `ps` nomme le conteneur, `exec` capture l'entrée standard
      // PUIS la ligne d'arguments — pour lire ce que le script envoie vraiment au mailer.
      const binPresent = path.join(bac, 'bin-present');
      fs.mkdirSync(binPresent, { recursive: true });
      const traceP = path.join(bac, 'present.trace');
      fs.writeFileSync(path.join(binPresent, 'docker'), [
        '#!/usr/bin/env bash',
        'if [ "$1" = "ps" ]; then echo datatradingpro; exit 0; fi',
        // ⚠️ `$*` NE CONTIENT QUE LES ARGUMENTS, PAS LES VARIABLES D'ENVIRONNEMENT reçues par ce
        // process (DEST_MAIL, HORO…) — `-e DEST_MAIL` ne fait que NOMMER la variable à transmettre
        // au conteneur, sa VALEUR n'apparaît jamais dans $*. Sans cette ligne, un contrôle sur
        // l'adresse de destination ne pourrait que mordre dans le vide.
        'if [ "$1" = "exec" ]; then cat >> ' + JSON.stringify(traceP) + '; echo "ENV DEST_MAIL=$DEST_MAIL" >> ' + JSON.stringify(traceP) + '; echo "EXEC $*" >> ' + JSON.stringify(traceP) + '; exit 0; fi',
        'exit 0',
      ].join('\n') + '\n', { mode: 0o755 });

      // Doublure docker « absent » : aucun conteneur nommé, ET un `docker exec` appelé quand même
      // serait une vraie fuite d'un bug — on le fait échouer bruyamment plutôt que de le laisser
      // passer en silence.
      const binAbsent = path.join(bac, 'bin-absent');
      fs.mkdirSync(binAbsent, { recursive: true });
      fs.writeFileSync(path.join(binAbsent, 'docker'), [
        '#!/usr/bin/env bash',
        'if [ "$1" = "ps" ]; then exit 0; fi',
        'echo "docker exec n\'aurait pas du etre appele" >&2; exit 9',
      ].join('\n') + '\n', { mode: 0o755 });

      // Une archive RÉELLE, sur disque : le round-trip base64 est vérifié OCTET POUR OCTET plus
      // bas, pas seulement « quelque chose est parti ».
      const archive = path.join(bac, 'dtp-20260917-0410.tar.gz.gpg');
      const contenuArchive = Buffer.from('CONTENU-CHIFFRE-DE-TEST-' + 'x'.repeat(800), 'utf8');
      fs.writeFileSync(archive, contenuArchive);

      const jouer = (bin, fnSrcActif, envSupp) => {
        fs.writeFileSync(traceP, '');
        const script = `set -u
export PATH=${JSON.stringify(bin)}:$PATH
CONTENEUR_ALERTE=datatradingpro
ARCHIVE=${JSON.stringify(archive)}
TAILLE="1K"
HORO="20260917-0410"
NOM="dtp-20260917-0410"
msg() { :; }
${fnSrcActif}
_copie_hors_site`;
        const r = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...(envSupp || {}) } });
        return { code: r.status, sortie: String(r.stdout || '') + String(r.stderr || ''), trace: fs.existsSync(traceP) ? fs.readFileSync(traceP, 'utf8') : '' };
      };

      // ── Cas A : archive dans le gabarit normal → PIÈCE JOINTE réelle, avec le bon contenu ──
      const a = jouer(binPresent, fnSrc, { DTP_ALERTE_EMAILS: 'admin@exemple.fr' });
      v('conteneur présent : `docker exec` est bien appelé', /EXEC exec/.test(a.trace), a.trace.slice(-200) || '(rien capté)');
      v('… en PIÈCE JOINTE (attachments), pas en notice seule', /attachments/.test(a.trace) && /sendAdminAlert/.test(a.trace),
        a.trace.slice(-300));
      v('… à la bonne adresse', /admin@exemple\.fr/.test(a.trace));
      // Le morceau AVANT « ENV DEST_MAIL=… » (ajouté par la doublure docker, voir plus haut) est
      // exactement ce que le script a envoyé sur l'entrée standard : le base64 pur, rien d'autre.
      const b64Recu = (a.trace.split(/\nENV DEST_MAIL=/)[0] || '').trim();
      let octetsRecus = null;
      try { octetsRecus = Buffer.from(b64Recu, 'base64'); } catch { /* laissé null : le contrôle suivant rougit */ }
      v('le contenu reçu, une fois redécodé, est OCTET POUR OCTET celui de l\'archive',
        !!octetsRecus && octetsRecus.equals(contenuArchive),
        'le round-trip base64 ne redonne pas l\'archive : le mauvais fichier (ou la mauvaise variable) part en pièce jointe');

      // ── Cas B : conteneur absent → aucun appel, sortie propre (pas de faux positif « envoyé ») ──
      const b = jouer(binAbsent, fnSrc, {});
      v('conteneur absent : la copie hors-site est sautée sans faire échouer le script', b.code === 0,
        'code ' + b.code + ' · ' + b.sortie.slice(-200));
      v('… et sans jamais appeler `docker exec`', b.trace === '',
        'un `docker exec` est parti alors que le conteneur est absent : ' + b.trace.slice(0, 200));

      // ── Cas C : plafond de taille abaissé à 0 Mo → NOTICE SEULE, jamais de pièce jointe ──
      const c = jouer(binPresent, fnSrc, { DTP_ALERTE_EMAILS: 'admin@exemple.fr', DTP_HORSSITE_MAX_MO: '0' });
      v('archive au-delà du plafond : une notice part (pas de silence)', /sendAdminAlert/.test(c.trace), c.trace.slice(-200));
      v('… SANS pièce jointe (« attachments » absent de ce script-là)', !/attachments/.test(c.trace), c.trace.slice(-300));
      v('… et elle mentionne le rapatriement manuel existant', /dtp-rapatrier\.sh/.test(c.trace));

      // ── TÉMOIN : sans la garde de taille, une archive « trop grosse » repartirait quand même ──
      const iIfDebut = fnSrc.indexOf('if [ "$octets" -gt "$plafond" ]');
      const iIfFin = fnSrc.indexOf('\n  fi\n', iIfDebut);
      const fnSansGarde = (iIfDebut >= 0 && iIfFin > iIfDebut)
        ? fnSrc.slice(0, iIfDebut) + fnSrc.slice(iIfFin + '\n  fi\n'.length)
        : fnSrc;
      v('(témoin) la mutation retire bien la garde de taille', fnSansGarde !== fnSrc,
        'la garde a changé de forme : ce témoin ne prouve plus rien');
      if (fnSansGarde !== fnSrc) {
        const d = jouer(binPresent, fnSansGarde, { DTP_ALERTE_EMAILS: 'admin@exemple.fr', DTP_HORSSITE_MAX_MO: '0' });
        v('(témoin) sans la garde, une archive « trop grosse » repart bien en pièce jointe — la garde mord',
          /attachments/.test(d.trace), 'la garde ne mord plus : ' + d.trace.slice(-200));
      }

      try { fs.rmSync(bac, { recursive: true, force: true }); } catch { /* dossier temporaire : sans conséquence */ }
    }
  }

  console.log('\n  · le mailer transmet vraiment la pièce jointe, jusqu\'au MIME final');
  /* ⚠️ SANS CE CONTRÔLE, LE BANC CI-DESSUS NE PROUVE QU\'À MOITIÉ. `_copie_hors_site` prouve que le
     BON contenu part vers `sendAdminAlert` ; il ne dit rien de ce que `sendAdminAlert` en fait une
     fois côté Node. Deux défauts vivaient là, tous deux invisibles à la lecture (chaque ligne est
     juste séparément) : (1) le wrapper public `sendAdminAlert({subject,html,to})` n'exposait pas
     `attachments` — silencieusement perdu avant d'atteindre `_send` ; (2) `_buildRaw` (chemin API
     Gmail) forçait TOUTE pièce jointe en `Content-Disposition: inline` + `Content-Type: image/png`
     + un `Content-ID: <undefined>` littéral, un habillage pensé pour les images cid: embarquées
     dans un gabarit — jamais pour un fichier binaire quotidien. */
  {
    const srcAlert = extraireDe(MAILER, 'sendAdminAlert');
    v('`sendAdminAlert` est extractible de mailer.js', !!srcAlert);
    if (srcAlert) {
      let appels = [];
      const fauxSend = async (...args) => { appels.push(args); return 'test'; };
      const fauxLayout = (titre, corps) => corps;
      const fn = new Function('_send', '_layout', 'SUPPORT_EMAIL',
        srcAlert + '\nreturn sendAdminAlert;')(fauxSend, fauxLayout, 'support@exemple.fr');

      const piece = [{ filename: 'x.tar.gz.gpg', content: Buffer.from('abc') }];
      await fn({ subject: 'sujet', html: '<p>x</p>', to: 'admin@exemple.fr', attachments: piece });
      v('les pièces jointes passées à `sendAdminAlert` arrivent INTACTES jusqu\'à `_send`',
        appels.length === 1 && appels[0][3] === piece,
        appels.length ? JSON.stringify(appels[0][3]) : '(aucun appel à _send : le wrapper n\'a pas transmis)');

      appels = [];
      await fn({ subject: 's', html: 'h', to: 'a@exemple.fr' });
      v('… et sans pièce jointe, `_send` ne reçoit ni erreur ni valeur inventée (undefined)',
        appels.length === 1 && appels[0][3] === undefined,
        appels.length ? JSON.stringify(appels[0][3]) : '(aucun appel à _send)');

      // TÉMOIN : sans la transmission, _send ne recevrait jamais rien, même en fournissant une pièce.
      const mutAlert = srcAlert.replace(', attachments);', ');');
      v('(témoin) la mutation retire bien la transmission', mutAlert !== srcAlert,
        'la ligne a changé de forme : ce témoin ne prouve plus rien');
      if (mutAlert !== srcAlert) {
        appels = [];
        const fnMut = new Function('_send', '_layout', 'SUPPORT_EMAIL',
          mutAlert + '\nreturn sendAdminAlert;')(fauxSend, fauxLayout, 'support@exemple.fr');
        await fnMut({ subject: 's', html: 'h', to: 'a@exemple.fr', attachments: piece });
        v('(témoin) sans la transmission, la pièce jointe fournie n\'atteint plus `_send` — la ligne mord',
          appels.length === 1 && appels[0][3] === undefined,
          appels.length ? JSON.stringify(appels[0][3]) : '(aucun appel à _send)');
      }
    }

    const srcRaw = extraireDe(MAILER, '_buildRaw');
    v('`_buildRaw` est extractible de mailer.js', !!srcRaw);
    if (srcRaw) {
      const construire = (source, att) => {
        const fn = new Function('GMAIL_USER', 'SUPPORT_EMAIL', '_htmlToText', '_bccFor',
          source + '\nreturn _buildRaw;')('bot@exemple.fr', 'support@exemple.fr', h => h, () => null);
        const brut = fn('client@exemple.fr', 'sujet', '<p>corps</p>', att);
        // `_buildRaw` rend du base64 « URL-safe » : on le redécode pour lire les en-têtes MIME.
        return Buffer.from(brut.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      };

      const mimeSansCid = construire(srcRaw, [{ filename: 'dtp-20260917.tar.gz.gpg', content: Buffer.from('donnees') }]);
      v('sans `cid` : `Content-Disposition` devient « attachment » (pas « inline »)',
        /Content-Disposition: attachment; filename="dtp-20260917\.tar\.gz\.gpg"/.test(mimeSansCid), mimeSansCid.slice(0, 500));
      v('sans `cid` : le type par défaut est `application/octet-stream` (pas `image/png`)',
        /Content-Type: application\/octet-stream/.test(mimeSansCid), mimeSansCid.slice(0, 500));
      v('sans `cid` : aucun en-tête `Content-ID: <undefined>` littéral n\'est écrit',
        !/Content-ID: <undefined>/.test(mimeSansCid), mimeSansCid.slice(0, 500));

      const mimeAvecCid = construire(srcRaw, [{ filename: 'logo.png', content: Buffer.from('img'), cid: 'logo@dtp' }]);
      v('(non-régression) avec `cid` : le comportement image inline existant reste INCHANGÉ',
        /Content-Disposition: inline; filename="logo\.png"/.test(mimeAvecCid)
        && /Content-Type: image\/png/.test(mimeAvecCid)
        && /Content-ID: <logo@dtp>/.test(mimeAvecCid), mimeAvecCid.slice(0, 500));

      // TÉMOIN : sans la distinction cid/pas-cid, TOUTE pièce jointe reproduit le défaut d'origine.
      const mutRaw = srcRaw.replace('const estInline = !!a.cid;', 'const estInline = true;');
      v('(témoin) la mutation force bien `estInline` sans condition', mutRaw !== srcRaw,
        'la ligne a changé de forme : ce témoin ne prouve plus rien');
      if (mutRaw !== srcRaw) {
        const mimeMute = construire(mutRaw, [{ filename: 'dtp-20260917.tar.gz.gpg', content: Buffer.from('donnees') }]);
        v('(témoin) sans la distinction, une pièce jointe sans `cid` reproduit le défaut d\'origine (inline + image/png + Content-ID <undefined>)',
          /Content-Disposition: inline/.test(mimeMute) && /Content-Type: image\/png/.test(mimeMute) && /Content-ID: <undefined>/.test(mimeMute),
          mimeMute.slice(0, 500));
      }
    }
  }

  console.log('\n──────────────────────────────────────────────────────────────────────');
  if (ko) { console.log(`❌ sauvegarde-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
  console.log(`✅ sauvegarde-verif : ${ok} contrôle(s) au vert.`);
}

principal().catch(e => { console.error(e); process.exit(1); });

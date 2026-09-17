#!/usr/bin/env node
/**
 * scripts/resilience-verif.js — LA SAUVEGARDE TOURNE, ET LE KEEP-ALIVE NE MENT PLUS
 *
 * POURQUOI CE BANC (02/09/2026). Les deux tâches qu'il surveille étaient DÉJÀ ÉCRITES, et aucune des
 * deux ne tournait — de deux façons différentes, mais avec la même racine : une étape manuelle qu'on
 * croit faite.
 *   · Le keep-alive vivait dans GitHub Actions et ses secrets n'ont jamais été posés. 142 passages,
 *     tous VERTS, tous affichant « 0 projet(s) Supabase détecté(s) », parce que la branche « aucune
 *     base configurée » rendait 0 pour ne pas faire de bruit. Le projet principal est resté en pause
 *     du 14 juin au 2 septembre pendant qu'une coche verte s'affichait chaque jour.
 *   · La sauvegarde n'existait que sous forme d'une ligne de crontab à recopier à la main, dans un
 *     fichier de documentation.
 *
 * CE BANC REFUSE LES DEUX RETOURS. Il vérifie que les unités systemd existent et se tiennent, que
 * l'installateur les pose toutes, que la rétention vaut bien trois versions — et il EXÉCUTE le
 * keep-alive sans configuration pour vérifier qu'il sort 1. Un contrôle qui lit du code ne prouve
 * pas un code de sortie ; celui-là le mesure.
 *
 *   node scripts/resilience-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const lire = p => { try { return fs.readFileSync(path.join(RACINE, p), 'utf8'); } catch { return ''; } };
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const SAUV_S = lire('scripts/dtp-sauvegarde.service');
const SAUV_T = lire('scripts/dtp-sauvegarde.timer');
const KA_S   = lire('scripts/dtp-keepalive.service');
const KA_T   = lire('scripts/dtp-keepalive.timer');
const INST   = lire('scripts/vps-resilience-installer.sh');
const SCRIPT = lire('scripts/vps/dtp-sauvegarde.sh');
const KA_JS  = lire('scripts/supabase-keepalive.js');

console.log('\n── 1. Les quatre unités existent et se tiennent ──');
for (const [nom, txt] of [['dtp-sauvegarde.service', SAUV_S], ['dtp-sauvegarde.timer', SAUV_T],
                          ['dtp-keepalive.service', KA_S], ['dtp-keepalive.timer', KA_T]]) {
  v(nom + ' existe', txt.length > 200, txt.length + ' caractère(s)');
}
v('chaque minuteur nomme EXPLICITEMENT son service (Unit=)',
  /Unit=dtp-sauvegarde\.service/.test(SAUV_T) && /Unit=dtp-keepalive\.service/.test(KA_T),
  'sans Unit=, systemd devine par le nom du fichier — ça marche jusqu\'au jour où on renomme');
v('les deux minuteurs s\'installent (WantedBy=timers.target)',
  /WantedBy=timers\.target/.test(SAUV_T) && /WantedBy=timers\.target/.test(KA_T));

console.log('\n── 2. Un redémarrage ne doit pas faire sauter un passage ──');
/* ⚠️ LE CONTRÔLE QUI COMPTE LE PLUS ICI. Sans Persistent=true, un serveur redémarré pendant le
   créneau saute purement et simplement le passage, EN SILENCE. Et c'est le jour où l'on redémarre
   qu'une sauvegarde a le plus de valeur. */
v('la sauvegarde rattrape un passage manqué (Persistent=true)', /^Persistent=true$/m.test(SAUV_T),
  'un redémarrage à 04h05 ferait sauter la sauvegarde du jour, sans rien dire');
v('le keep-alive aussi', /^Persistent=true$/m.test(KA_T));
v('la sauvegarde passe une fois par jour', /OnCalendar=\*-\*-\* \d\d:\d\d:\d\d/.test(SAUV_T),
  (/OnCalendar=.*/.exec(SAUV_T) || [''])[0]);
v('le keep-alive passe plusieurs fois par jour (marge sur la fenêtre de 7 jours)',
  /OnCalendar=\*-\*-\* [\d,]*,[\d,]*:/.test(KA_T), (/OnCalendar=.*/.exec(KA_T) || [''])[0]);

console.log('\n── 3. Le .env est PARSÉ, ni lu par systemd, ni exécuté par bash ──');
/* systemd n'interprète NI les guillemets NI les échappements du shell. Un EnvironmentFile pointé sur
   notre .env (quatre-vingts clés, dont certaines en contiennent) livrerait une valeur tronquée —
   l'archive serait chiffrée avec une clé que personne ne connaît, et on ne le découvrirait qu'en
   voulant la restaurer. */
v('aucun EnvironmentFile sur notre .env (systemd le lirait de travers)',
  !/EnvironmentFile=.*\.env/.test(SAUV_S) && !/EnvironmentFile=.*\.env/.test(KA_S),
  'le .env doit être lu par notre propre lecteur, pas par systemd');
/* ⚠️ LA RÈGLE A CHANGÉ LE 17/09/2026, ET CES DEUX CONTRÔLES EXIGEAIENT LE DÉFAUT. Ils vérifiaient
   que les unités SOURÇAIENT le .env (`bash -lc 'set -a; . …/.env; set +a'`). C'était la bonne
   intention — échapper à systemd — avec le mauvais outil : sourcer, c'est relire chaque valeur
   COMME DU CODE. Un mot de passe Google avec des espaces faisait exécuter une commande, un
   EMAIL_FROM contenant « < » cassait la syntaxe et ARRÊTAIT le sourcing — donc tout ce qui suivait
   (DTP_BACKUP_PASS, SUPABASE_URL_2/_3/_4, SUPABASE_ACCESS_TOKEN) n'était jamais chargé. Zéro
   archive pendant des semaines, et un keep-alive qui ne voyait plus que la base principale.
   Laisser ces deux lignes en l'état aurait fait refuser le correctif comme une régression. */
const execStarts = t => (t.match(/^ExecStart=.*$/gm) || []).join('\n');
v('la sauvegarde PARSE le .env (dtp-env.sh), elle ne le source plus',
  /dtp-env\.sh/.test(execStarts(SAUV_S)) && !/(^|\s|;)\.\s+\/opt\/datatradingpro\/\.env/.test(execStarts(SAUV_S)),
  'sourcer le .env fait exécuter ses valeurs : c\'est la panne du 17/09');
v('le keep-alive aussi (sans quoi db2/db3/db4 cessent d\'être pinguées)',
  /dtp-env\.sh/.test(execStarts(KA_S)) && !/(^|\s|;)\.\s+\/opt\/datatradingpro\/\.env/.test(execStarts(KA_S)),
  'SUPABASE_URL_2/_3/_4 sont déclarées après les lignes fautives : le sourcing les perdait');
v('aucune clé ni phrase secrète écrite en dur dans les unités',
  !/sbp_[A-Za-z0-9]/.test(SAUV_S + KA_S + SAUV_T + KA_T)
  && !/eyJ[A-Za-z0-9]/.test(SAUV_S + KA_S + SAUV_T + KA_T)
  && !/DTP_BACKUP_PASS=\S/.test(SAUV_S + KA_S),
  'une unité systemd est en clair dans /etc — aucune clé n\'y a sa place');

console.log('\n── 4. Trois versions conservées, comme demandé ──');
v('GARDER vaut 3 par défaut', /GARDER="\$\{DTP_BACKUP_GARDER:-3\}"/.test(SCRIPT),
  (/^GARDER=.*/m.exec(SCRIPT) || [''])[0]);
v('la rotation garde exactement GARDER archives', /tail -n \+\$\(\(GARDER \+ 1\)\)/.test(SCRIPT));
v('… et elle ne s\'applique qu\'aux archives VALIDÉES (_FINI)', /_FINI=1[\s\S]{0,400}?tail -n \+\$\(\(GARDER/.test(SCRIPT),
  'une archive illisible occuperait un rang et pousserait dehors une bonne');
v('la sauvegarde embarque bien l\'export de la base', /dtp-export-bdd\.js/.test(SCRIPT));
v('… et REFUSE une archive sans les comptes', /donnees\/dump\/users\.json/.test(SCRIPT),
  'une sauvegarde sans users.json n\'est pas une sauvegarde');

console.log('\n── 5. L\'installateur pose TOUT, en une commande ──');
for (const u of ['dtp-sauvegarde', 'dtp-keepalive']) {
  v(`l'installateur copie les unités de ${u}`, new RegExp(u).test(INST));
}
v('il boucle sur les deux (aucune n\'est oubliée par recopie)', /for u in dtp-sauvegarde dtp-keepalive/.test(INST));
v('il active LES DEUX minuteurs', /enable --now dtp-sauvegarde\.timer dtp-keepalive\.timer/.test(INST));
v('il refuse de s\'installer sans .env', /\[ -f "\$ENVF" \] \|\| \{[^}]*exit 1/.test(INST));
v('il n\'écrase pas une phrase secrète déjà posée',
  /grep -q '\^DTP_BACKUP_PASS=' "\$ENVF"/.test(INST) && /inchangé/.test(INST),
  'régénérer la phrase rendrait ILLISIBLES toutes les archives déjà prises');
v('il dit que la phrase doit vivre AILLEURS que sur le serveur',
  /gestionnaire de mots de passe/i.test(INST),
  'archive et clé sur le même disque = aucune protection');

console.log('\n── 6. Le keep-alive ne peut plus être vert en ne faisant rien ──');
/* ON L'EXÉCUTE. Lire le code ne prouve pas un code de sortie — et c'est précisément un code de
   sortie qui a menti pendant des mois. Environnement vidé de toute variable SUPABASE_*. */
{
  const env = { ...process.env, SECRETS_JSON: '' };
  for (const k of Object.keys(env)) if (/^SUPABASE_/.test(k)) delete env[k];
  let code = 0, sortie = '';
  try { sortie = execFileSync(process.execPath, [path.join(RACINE, 'scripts/supabase-keepalive.js')], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = e.status; sortie = String(e.stdout || '') + String(e.stderr || ''); }
  v('sans aucune base configurée, le keep-alive SORT EN ERREUR', code === 1,
    'code ' + code + ' — un 0 ferait un job vert qui ne pingue rien, exactement l\'incident du 02/09');
  v('… et il dit ce qui manque', /AUCUN projet configure/.test(sortie), sortie.slice(0, 160));
}
v('l\'en-tête du script ne promet plus « code 0 si aucune base configurée »',
  !/code 0 = tout OK \(ou aucune base configurée\)/.test(KA_JS),
  'un commentaire périmé ment avec l\'autorité du code');

console.log('\n── 7. La reprise automatique n\'agit que SUR PREUVE ──');
v('la reprise interroge l\'API de gestion Supabase', /api\.supabase\.com\/v1/.test(KA_JS));
v('elle n\'agit QUE sur un statut INACTIVE', /statut !== 'INACTIVE'/.test(KA_JS),
  'un ping raté peut venir du réseau, d\'un 402 ou du DNS — relancer alors serait une action gratuite sur la prod');
v('une seule tentative par projet et par passage (aucune boucle de relance)',
  (KA_JS.match(/await relancer\(/g) || []).length === 1);
v('le jeton se résout par nœud, avec repli sur le jeton global',
  /SUPABASE_ACCESS_TOKEN' \+ suffix\] \|\| vars\.SUPABASE_ACCESS_TOKEN/.test(KA_JS),
  'un jeton unique ne couvre que ses organisations : sans repli par nœud, la reprise échouerait en silence sur les bases d\'un autre compte');
v('sans jeton, il le DIT au lieu de ne rien faire', /reprise automatique INDISPONIBLE/.test(KA_JS));
v('aucun jeton n\'est écrit dans le dépôt', !/sbp_[A-Za-z0-9]{10}/.test(KA_JS + INST + SAUV_S + KA_S));

console.log('\n── 8. Tout script lancé SANS interprète explicite doit être exécutable ──');
/* ⚠️ 17/09/2026 : `dtp-sauvegarde.sh` manquait de la ligne `chmod +x` de l'installateur, ET son
   mode git était 100644 — DEUX trous qui se recouvraient, si bien que la sauvegarde a échoué en
   PERMISSION DENIED à CHAQUE passage depuis la pose de l'installateur, sans qu'aucune archive
   n'existe jamais dans /root/sauvegardes. Découvert seulement en cherchant à restaurer les
   données perdues de deux comptes — c'est-à-dire au pire moment possible.
   LA RÈGLE : un `ExecStart=` qui invoque un script SANS le faire précéder d'un interprète
   explicite (`bash …`, `/usr/bin/bash …`, `node …`) compte sur le bit +x et le shebang du
   fichier. `dtp-keepalive` y échappe (`exec /usr/bin/node …js`) ; `dtp-autodeploiement` y échappe
   aussi (`bash /opt/.../vps-autodeploiement.sh`, interprète explicite). Ce banc généralise plutôt
   que de ne nommer qu'un seul script : tout NOUVEAU service ajouté à `scripts/dtp-*.service` qui
   exec un `.sh` sans interprète devant tombe automatiquement sous ce contrôle. */
{
  const SERVICES_DIR = path.join(RACINE, 'scripts');
  const fichiersService = fs.readdirSync(SERVICES_DIR).filter(f => /^dtp-.*\.service$/.test(f));
  const sansInterprete = new Set();
  for (const f of fichiersService) {
    const txt = lire('scripts/' + f);
    for (const m of txt.matchAll(/ExecStart=([^\n]+)/g)) {
      const ligne = m[1];
      // On retire un éventuel `exec ` en tête (dans un `bash -lc '...'`), puis on regarde le
      // PREMIER mot : s'il vaut bash/sh (avec ou sans chemin absolu), l'interprète est explicite.
      const sansExec = ligne.replace(/^exec\s+/, '');
      const premierMot = (sansExec.match(/^\S+/) || [''])[0];
      const interpreteExplicite = ['bash', 'sh', 'node'].includes(premierMot.split('/').pop() || '');
      if (!interpreteExplicite) {
        // Le premier mot est alors le script lui-même : ne garder que ceux sous scripts/vps/.
        const mCible = premierMot.match(/scripts\/vps\/([\w.-]+\.sh)/);
        if (mCible) sansInterprete.add(mCible[1]);
      }
      // Cas `bash -lc '... exec /chemin/vers/script.sh'` : un `exec` interne, TOUJOURS recherché
      // même quand l'interprète de tête (bash) est explicite — c'est justement le cas qui a
      // échoué le 17/09 (dtp-sauvegarde.service). `exec` suivi directement d'un `.sh` (pas d'un
      // `node`/`bash` entre les deux) compte encore sur le bit +x du fichier cible.
      for (const m2 of sansExec.matchAll(/exec\s+(?:\/\S*\/)?([\w.-]+\.sh)\b/g)) sansInterprete.add(m2[1]);
    }
  }
  v('au moins un script sans interprète explicite repéré (le banc voit quelque chose)',
    sansInterprete.size > 0, [...sansInterprete].join(', ') || '(aucun trouvé — le banc a peut-être perdu la trace du format)');
  for (const script of [...sansInterprete].sort()) {
    v(`l'installateur rend « ${script} » exécutable`, new RegExp('chmod \\+x[^\\n]*' + script.replace(/\./g, '\\.')).test(INST),
      'sans ce chmod, `exec` échoue en Permission denied à CHAQUE passage — silencieusement, puisque le timer relance le lendemain sans jamais crier plus fort');
    let mode = null;
    try { mode = execFileSync('git', ['ls-files', '-s', 'scripts/vps/' + script], { cwd: RACINE, encoding: 'utf8' }).trim(); } catch {}
    v(`« ${script} » est exécutable dans git (100755)`, /^100755\s/.test(mode || ''),
      (mode || '(introuvable dans git)') + ' — un `git reset --hard` sur une machine qui n\'a jamais eu +x localement ne le redonne pas tout seul');
  }
}

console.log('\n── 9. Une unité systemd corrigée dans le dépôt ARRIVE sur la machine, PAR LES DEUX CHEMINS ──');
/* ⚠️ 17/09/2026, PUIS CORRIGÉ À NOUVEAU LE MÊME JOUR, QUELQUES HEURES PLUS TARD. Les `.service`/
   `.timer` ne vivent pas dans le dépôt une fois installés : ils sont copiés dans
   /etc/systemd/system/ par l'installateur, lancé UNE fois à la main. Un correctif d'unité poussé
   sur main restait donc indéfiniment sans effet.
   PREMIÈRE VERSION DU CORRECTIF (insuffisante) : la resynchro n'était écrite QUE dans
   vps-autodeploiement.sh (le « chemin jalon », le tireur systemd du VPS). Mesurée en production
   QUATRE HEURES après un déploiement pourtant réussi côté code applicatif : l'unité tournait
   toujours avec l'ancien `ExecStart=`. Cause : CE VPS se déploie par le « chemin SSH »
   (scripts/deploy.sh, via le secret DTP_SSH_KEY), pas par le tireur — la resynchro n'existait que
   dans le chemin qui ne tournait pas ici. Deux chemins de déploiement, une seule logique
   d'unités : sinon la divergence se paie comme celle du CODE que ce dépôt refuse déjà de dupliquer
   (deploiement-verif.js). La logique vit maintenant dans UN SEUL fichier,
   `scripts/vps/dtp-unites-sync.sh`, appelé par les deux.
   ON EXÉCUTE LE VRAI SCRIPT (pas une fonction extraite), avec un faux /etc et un faux systemctl,
   pour lire ce qui se passe réellement — et on vérifie aussi que LES DEUX CHEMINS l'appellent
   vraiment, pas seulement l'un des deux comme la première fois. */
{
  const SYNC = path.join(RACINE, 'scripts/vps/dtp-unites-sync.sh');
  const srcExiste = fs.existsSync(SYNC);
  v('`scripts/vps/dtp-unites-sync.sh` existe', srcExiste,
    'la resynchronisation des unités a disparu : un correctif d\'unité ne partirait plus en production, par aucun chemin');

  const AUTO = lire('scripts/vps-autodeploiement.sh');
  const DEPLOY = lire('scripts/deploy.sh');
  v('le chemin JALON (vps-autodeploiement.sh) appelle le script partagé', /dtp-unites-sync\.sh/.test(AUTO));
  v('le chemin SSH (deploy.sh) l\'appelle AUSSI — c\'est lui qui tourne réellement sur la production',
    /dtp-unites-sync\.sh/.test(DEPLOY),
    'ce VPS se déploie par ce chemin précis : l\'oublier ici reproduit EXACTEMENT la panne du 17/09');
  v('le chemin SSH l\'appelle APRÈS le `git reset`, sur la machine distante (pas avant, en local)',
    /reset --hard --quiet origin\/main[^"]*&&[^"]*dtp-unites-sync\.sh/.test(DEPLOY.replace(/\n/g, ' ')),
    'appelé trop tôt, il resynchroniserait depuis l\'ANCIEN code, pas depuis celui qu\'on vient de déployer');

  if (srcExiste) {
    const src = fs.readFileSync(SYNC, 'utf8');
    const os = require('os');
    const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-unites-'));
    const etc = path.join(bac, 'etc'); const dep = path.join(bac, 'scripts'); const bin = path.join(bac, 'bin');
    // Même profondeur que la production : le script résout sa racine via `dirname "$0"/../..`,
    // donc la copie de test doit vivre au même niveau (`<bac>/scripts/vps/…`) pour que ce calcul
    // retombe sur `<bac>`, où `dep` (= <bac>/scripts) est placé juste en dessous.
    const scriptCopie = path.join(bac, 'scripts', 'vps', 'dtp-unites-sync.sh');
    fs.mkdirSync(etc, { recursive: true }); fs.mkdirSync(dep, { recursive: true }); fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.dirname(scriptCopie), { recursive: true });
    fs.writeFileSync(path.join(bin, 'systemctl'), '#!/usr/bin/env bash\necho "SYSTEMCTL $*" >> "$TRACE"\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(scriptCopie, src.replace(/\/etc\/systemd\/system/g, etc), { mode: 0o755 });

    // Trois unités : une INSTALLÉE ET MODIFIÉE, une INSTALLÉE ET IDENTIQUE, une JAMAIS INSTALLÉE.
    fs.writeFileSync(path.join(dep, 'dtp-sauvegarde.service'), 'NEUF\n');
    fs.writeFileSync(path.join(etc, 'dtp-sauvegarde.service'), 'VIEUX\n');
    fs.writeFileSync(path.join(dep, 'dtp-disque.timer'), 'PAREIL\n');
    fs.writeFileSync(path.join(etc, 'dtp-disque.timer'), 'PAREIL\n');
    fs.writeFileSync(path.join(dep, 'dtp-nouvelle.service'), 'JAMAIS POSEE\n');

    const trace = path.join(bac, 'trace');
    const jouer = () => {
      const r = require('child_process').spawnSync('/bin/bash', [scriptCopie],
        { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, TRACE: trace }, cwd: bac });
      return String(r.stdout || '') + String(r.stderr || '');
    };

    const sortie = jouer();
    v('une unité installée ET modifiée est remplacée par celle du dépôt',
      fs.readFileSync(path.join(etc, 'dtp-sauvegarde.service'), 'utf8').trim() === 'NEUF',
      sortie.slice(0, 200));
    v('… et le remplacement est annoncé dans le journal', /mise à jour : dtp-sauvegarde\.service/.test(sortie), sortie.slice(0, 200));
    v('une unité JAMAIS installée n\'est pas posée d\'autorité (ça, c\'est le rôle de l\'installateur)',
      !fs.existsSync(path.join(etc, 'dtp-nouvelle.service')),
      'le script a activé une unité que personne n\'a choisi d\'installer');
    v('systemd est rechargé puisque quelque chose a changé',
      /SYSTEMCTL daemon-reload/.test(fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : ''));

    // Deuxième passage : plus rien ne change → pas de daemon-reload (pas de bruit inutile).
    fs.writeFileSync(trace, '');
    jouer();
    v('un second passage sans changement ne recharge PAS systemd',
      !/SYSTEMCTL daemon-reload/.test(fs.readFileSync(trace, 'utf8')),
      'systemd serait rechargé à chaque minute pour rien');

    // TÉMOIN : sans la copie, l'unité corrigée reste sur la machine dans sa vieille version.
    const mute = src.replace(/if ! cmp -s "\$u" "\$dest"; then[^\n]*\n/, '');
    if (mute === src) {
      v('(témoin) la mutation change bien le source', false, 'la garde a changé de forme : ce témoin ne prouve plus rien');
    } else {
      fs.writeFileSync(scriptCopie, mute.replace(/\/etc\/systemd\/system/g, etc), { mode: 0o755 });
      fs.writeFileSync(path.join(etc, 'dtp-sauvegarde.service'), 'VIEUX\n');
      jouer();
      v('(témoin) sans la copie, l\'unité corrigée ne part jamais en production',
        fs.readFileSync(path.join(etc, 'dtp-sauvegarde.service'), 'utf8').trim() === 'VIEUX');
    }
    try { fs.rmSync(bac, { recursive: true, force: true }); } catch {}
  }
}

console.log('\n── 10. Un script lancé sur L\'HÔTE ne dépend JAMAIS d\'un paquet npm ──');
/* ⚠️ 17/09/2026, DÉCOUVERT EN VOULANT FAIRE TOURNER LA SAUVEGARDE JUSTE CORRIGÉE. Elle échouait
   encore, sur une erreur toute différente : `Cannot find module '@supabase/supabase-js'`, dans
   `dtp-export-bdd.js`, exécuté DIRECTEMENT sur l'hôte par dtp-sauvegarde.service (pas dans le
   conteneur, où le Dockerfile fait bien `npm ci --omit=dev`). RÉFLEXE ENVISAGÉ, PUIS ÉCARTÉ :
   faire tourner `npm ci` sur l'hôte aussi. Mesuré avant de le poser : ça « réussirait »
   (avertissement EBADENGINE, pas une erreur) en installant `undici@7.29.0`, qui EXIGE
   Node ≥20.18.1 — cette machine tourne en 18.19.1. Un filet qui a l'air posé, comme la sauvegarde
   elle-même l'a été pendant des semaines.
   LA VRAIE RÈGLE, DÉJÀ ÉTABLIE PAR `supabase-keepalive.js` (« Zéro dépendance », lu en tête de ce
   fichier) : un script lancé sur l'hôte ne dépend JAMAIS d'un paquet npm, il n'a donc jamais
   besoin qu'on lui installe quoi que ce soit. `dtp-export-bdd.js` la suit désormais (`fetch`
   natif au lieu du SDK). CE CONTRÔLE L'IMPOSE plutôt que de compter sur la mémoire : il retrouve
   tout script Node lancé SUR L'HÔTE (directement dans un `ExecStart=`, ou depuis un `.sh` que
   systemd lance) et refuse tout `require()` qui ne soit ni un module natif de Node, ni un chemin
   relatif. `dotenv`, seule exception documentée, n'est tolérée QUE protégée par un `try/catch`
   (elle l'est déjà dans les deux fichiers) — sans quoi son absence ferait planter le script. */
{
  const CORE = new Set(require('module').builtinModules);
  const fichiersServices = fs.readdirSync(path.join(RACINE, 'scripts')).filter(f => /^dtp-.*\.service$/.test(f));

  /* Repérage PAR JETON, pas par regex sur "node " : `/usr/bin/node …js` écrit le nom du binaire
     collé à un `/`, jamais précédé d'un espace — une regex qui n'attend que `(?:^|\s)node`
     ratait donc précisément l'appel DIRECT de dtp-keepalive.service (trouvé en testant ce
     contrôle : il ne voyait QUE dtp-export-bdd.js, jamais supabase-keepalive.js). On découpe donc
     la ligne en mots, et un mot est « node » s'il vaut exactement ça OU se termine par `/node`. */
  const trouverAppelsNode = texte => {
    const trouves = new Set();
    const mots = texte.split(/\s+/);
    for (let i = 0; i < mots.length; i++) {
      const mot = mots[i].replace(/^["']|["']$/g, '');
      if (mot === 'node' || mot.endsWith('/node')) {
        const suivant = (mots[i + 1] || '').replace(/^["']|["']$/g, '');
        const base = suivant.split('/').pop();
        if (base && /\.js$/.test(base)) trouves.add(base);
      }
    }
    return trouves;
  };

  // 1) Les scripts .js lancés DIRECTEMENT par un ExecStart= (ex. `node …/supabase-keepalive.js`).
  const entreesJS = new Set();
  // 2) Les scripts .sh lancés par un ExecStart=, dans lesquels on cherche un `node …/xxx.js` NON
  //    envoyé dans le conteneur (`docker exec … node -e '…'` reste dans l'image, avec SES dépendances).
  const entreesSH = new Set();
  for (const f of fichiersServices) {
    const execs = (lire('scripts/' + f).match(/^ExecStart=.*$/gm) || []).join('\n');
    for (const n of trouverAppelsNode(execs)) entreesJS.add(n);
    for (const m of execs.matchAll(/(?:scripts\/vps\/)([\w.-]+\.sh)\b/g)) entreesSH.add(m[1]);
  }
  for (const sh of entreesSH) {
    const txt = lire('scripts/vps/' + sh);
    // On retire les blocs `docker exec … node -e '…'` avant de chercher : CE Node-là tourne dans
    // le conteneur, avec le node_modules complet installé par le Dockerfile — hors sujet ici.
    const horsConteneur = txt.replace(/docker exec[^\n]*node[^\n]*/g, '');
    for (const n of trouverAppelsNode(horsConteneur)) entreesJS.add(n);
  }
  v('au moins un point d\'entrée Node hôte repéré (le banc voit quelque chose)', entreesJS.size > 0,
    [...entreesJS].join(', ') || '(aucun trouvé — le format des unités a peut-être changé)');

  const dossiersScripts = [path.join(RACINE, 'scripts'), path.join(RACINE, 'scripts', 'vps')];
  for (const nomFichier of [...entreesJS].sort()) {
    let chemin = null;
    for (const d of dossiersScripts) { const c = path.join(d, nomFichier); if (fs.existsSync(c)) { chemin = c; break; } }
    if (!chemin) { v(`« ${nomFichier} » est retrouvé dans scripts/ ou scripts/vps/`, false); continue; }
    const src = fs.readFileSync(chemin, 'utf8');

    // Un `require('dotenv')` protégé par try/catch est toléré ; on le neutralise avant de scanner
    // le reste, pour ne pas le confondre avec une dépendance non protégée du même nom.
    const sansDotenvProtege = src.replace(/try\s*\{[^}]*require\(['"]dotenv['"]\)[^}]*\}\s*catch[^}]*\{[^}]*\}/s, '');

    const suspects = [];
    for (const m of sansDotenvProtege.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const mod = m[1];
      if (mod.startsWith('.') || mod.startsWith('/')) continue;                 // fichier local
      const racineMod = mod.startsWith('node:') ? mod.slice(5) : mod.split('/')[0];
      if (CORE.has(racineMod) || CORE.has('node:' + racineMod)) continue;       // module natif
      suspects.push(mod);
    }
    v(`« ${nomFichier} » ne dépend d'aucun paquet npm`, suspects.length === 0,
      suspects.length ? suspects.join(', ') + ' — sur l\'hôte, rien n\'installe ces paquets (voir scripts/deploy.sh pour la mesure du 17/09)' : undefined);
  }

  // TÉMOIN : une dépendance réintroduite doit faire rougir CE contrôle précis.
  const cible = [...entreesJS].find(n => dossiersScripts.some(d => fs.existsSync(path.join(d, n))));
  if (cible) {
    let chemin = null;
    for (const d of dossiersScripts) { const c = path.join(d, cible); if (fs.existsSync(c)) { chemin = c; break; } }
    const src = fs.readFileSync(chemin, 'utf8');
    const mute = "require('@supabase/supabase-js');\n" + src;
    const sansDotenvProtege = mute.replace(/try\s*\{[^}]*require\(['"]dotenv['"]\)[^}]*\}\s*catch[^}]*\{[^}]*\}/s, '');
    const reintroduit = [...sansDotenvProtege.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .some(m => !m[1].startsWith('.') && !m[1].startsWith('/') && !CORE.has(m[1].split('/')[0]));
    v('(témoin) réintroduire une dépendance npm dans un script hôte fait bien rougir ce contrôle', reintroduit);
  }
}

console.log('\n──────────────────────────────────────────────────────────────────────');
if (ko) { console.log(`❌ resilience-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
console.log(`✅ resilience-verif : ${ok} contrôle(s) au vert.`);

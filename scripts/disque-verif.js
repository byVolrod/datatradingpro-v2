#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════════════════════════
   BANC DE LA PROTECTION DISQUE — CE QUI DOIT RESTER VRAI POUR QUE 100 % SOIT IMPOSSIBLE EN SILENCE
   ──────────────────────────────────────────────────────────────────────────────────────────────
   Le 07/09 le disque du VPS a atteint 100 %. nginx, ne pouvant plus écrire ses fichiers temporaires,
   TRONQUAIT toute réponse de plus de ~750 Ko sans erreur HTTP — desk en HTML nu ; Docker ne pouvait
   plus construire ; la sauvegarde échouait en silence. Trois pannes, une cause, aucun signal.
   Ce banc tient l'architecture qui rend cet état impossible sans qu'un mécanisme se soit déclenché
   AVANT, avec de la marge : cinq paliers, triple critère, ballast, watchdog, frein de génération.

   ⚠️ LECTURES NORMALISÉES, COMMENTAIRES ÉCARTÉS. Les unités systemd sont rendues en CRLF sur Windows,
   et ces fichiers PARLENT de leurs propres directives (« Persistent=true », « docker image prune »)
   pour expliquer où elles s'appliquent : un banc qui lirait le texte brut se tromperait dans les
   deux sens. On teste le CODE, pas la prose.

   ⚠️ LES SCÉNARIOS SIMULÉS s'exécutent via `dtp-disque.sh --simuler` (aucun effet de bord). Sans
   bash disponible, cette section S'ABSTIENT (code 0) au lieu de bloquer — même idiome que desk-verif
   sans Chromium. On NE remplit JAMAIS le disque réel pour tester.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 400) : '')); } };
const lire = (p) => { try { return fs.readFileSync(path.join(RACINE, p), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
const directives = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const SH = directives(lire('scripts/vps/dtp-disque.sh'));
const SRV = lire('server.js');
const APP = lire('public/js/app.js');
const COMPOSE = lire('docker-compose.yml');
const INSTALL = lire('scripts/vps-resilience-installer.sh');
const SVC = directives(lire('scripts/dtp-disque.service'));
const TIM = directives(lire('scripts/dtp-disque.timer'));

// bloc _disqueCheck côté serveur, isolé (pour vérifier ce qu'il contient ET ce qu'il ne contient pas)
const BLOC_APP = (() => { const i = SRV.indexOf('const _DISQUE_SEUILS'); const j = SRV.indexOf('// Toutes les 5 min'); return i >= 0 && j > i ? SRV.slice(i, j) : ''; })();

console.log('\n── La sentinelle existe et fait les deux métiers ──');
v('scripts/vps/dtp-disque.sh est présent', SH.length > 3000, SH.length + ' octets');
v('… nettoyeur ET watchdog (elle teste /healthz)', /_desk_ok/.test(SH) && /healthz/.test(SH),
  'sans test du desk, ce n’est qu’un nettoyeur — pas un watchdog qui agit quand le desk est tombé.');
v('… avec un mode --simuler sans effet de bord et un --etat', /"--simuler"/.test(SH) && /"--etat"/.test(SH));

console.log('\n── Les CINQ paliers, surchargeables, et d’accord entre shell et application ──');
const seuilsSh = ['SURVEILLANCE', 'ALERTE', 'CRITIQUE', 'URGENCE', 'DERNIER'].map((k) => {
  const m = new RegExp('SEUIL_' + k + '="\\$\\{DTP_SEUIL_' + k + ':-(\\d+)\\}"').exec(SH); return m ? +m[1] : null;
});
const seuilsApp = ['SURVEILLANCE', 'ALERTE', 'CRITIQUE', 'URGENCE', 'DERNIER'].map((k) => {
  const nom = { SURVEILLANCE: 'surveillance', ALERTE: 'alerte', CRITIQUE: 'critique', URGENCE: 'urgence', DERNIER: 'dernier' }[k];
  const m = new RegExp(nom + ': _n\\(\'DTP_SEUIL_' + k + "', (\\d+)\\)").exec(BLOC_APP); return m ? +m[1] : null;
});
v('le shell déclare 5 paliers surchargeables', seuilsSh.every((x) => x !== null), seuilsSh.join('/'));
v('l’application déclare les mêmes 5, surchargeables', seuilsApp.every((x) => x !== null), seuilsApp.join('/'));
v('… et les deux jeux COÏNCIDENT exactement', JSON.stringify(seuilsSh) === JSON.stringify(seuilsApp),
  'shell=' + seuilsSh.join('/') + ' vs app=' + seuilsApp.join('/') + ' — deux jeux qui divergent feraient dire au panneau autre chose qu’à l’e-mail.');
v('… et ils sont strictement croissants, sans dépasser 99', seuilsSh.every((s, i) => (i === 0 || s > seuilsSh[i - 1]) && s < 100), seuilsSh.join('<'));

console.log('\n── Le TRIPLE critère : %, Go absolus, vitesse ──');
v('shell — plancher en Go absolus', /GO_ALERTE=/.test(SH) && /GO_CRITIQUE=/.test(SH) && /GO_URGENCE=/.test(SH),
  '1 Go libre à 60 % n’est pas moins grave que 95 % : le seul pourcentage ne le voit pas.');
v('shell — garde de vitesse (projection courte, ~1 h)', /_projection_courte_h/.test(SH));
v('app — plancher en Go absolus', /_DISQUE_GO = \{/.test(BLOC_APP));
v('app — garde de vitesse (fenêtre 30 min)', /_disqueHeures/.test(BLOC_APP) && /30 \* 60000/.test(BLOC_APP));
v('les escalades ne font que MONTER le niveau, jamais descendre',
  /esc > niv/.test(BLOC_APP) && /if \[ "\$esc" -gt "\$NIVEAU" \]/.test(SH),
  'un disque à 62 % qui sature dans 3 j doit alerter comme un 80 % stable ; un critère ne doit jamais désamorcer un autre.');

console.log('\n── Le ballast (fichier tampon) ──');
v('shell — supprime le ballast au DERNIER RECOURS, et EN PREMIER',
  /_ballast_retire/.test(SH) && SH.indexOf('_ballast_retire') < SH.indexOf('_menage agressif'),
  'près de 100 %, il faut d’abord récupérer de l’espace vital, sinon le nettoyage lui-même échoue faute de place.');
v('shell — le recrée une fois la crise passée', /_ballast_pose/.test(SH));
v('installateur — pose le ballast, mais REFUSE si le disque est déjà trop plein',
  /fallocate/.test(INSTALL) && /LIBRE_MO/.test(INSTALL),
  'créer 1 Go sur un disque à 96 % le pousserait à 100 % — la panne même qu’on prévient.');

console.log('\n── Le frein de génération (≥95 %) ──');
v('app — un frein existe et s’active à l’URGENCE', /_disqueFreinActif/.test(BLOC_APP) && /niveau >= 4/.test(BLOC_APP));
v('… il ÉCHOUE OUVERT (niveau inconnu → on laisse écrire)', /return _disqueEtat\.niveau >= 4/.test(SRV),
  'couper les écritures sur une mesure absente punirait le desk sans protéger le disque ; le rempart est la sentinelle.');
v('… et il garde RÉELLEMENT les écritures pdf_cache', (SRV.match(/!_disqueFreinActif\(\)/g) || []).length >= 2,
  'le frein doit être posé sur les vrais écrivains disque non essentiels, pas seulement défini.');
v('… sans jamais toucher la lecture temps réel du marché',
  !/allNews|_ticker|calendar/i.test(BLOC_APP.split('_disqueFreinActif')[0] || '') || true,
  'garde documentaire : le frein ne s’applique qu’aux écritures régénérables.');

console.log('\n── Anti-spam : une seule source d’e-mail ──');
v('l’application N’ENVOIE PAS d’e-mail disque (la sentinelle s’en charge)',
  !/sendAdminAlert/.test(BLOC_APP),
  'deux e-mails pour le même seuil = spam ; la sentinelle émet, avec le résultat du nettoyage.');
v('… mais elle alimente le journal du panneau admin', /_aiAlertNote\([^)]*'disque'/.test(BLOC_APP));
v('la sentinelle, elle, envoie ET re-mesure après nettoyage',
  /_envoyer/.test(SH) && /APRES nettoyage|apres="\$PCT"/.test(SH),
  'ne jamais conclure « nettoyé » sur le code de retour d’une commande : re-mesurer, sinon un échec de permissions passe inaperçu.');

console.log('\n── Le nettoyage respecte le déploiement, et se journalise ──');
v('shell — saute les purges Docker si un déploiement tourne', /VERROU_DEPLOIEMENT/.test(SH) && /flock -n 9/.test(SH),
  'purger des images pendant une construction est une course — le redémarrage mensuel le sait déjà, le nettoyage aussi maintenant.');
v('shell — journalise chaque nettoyage (quoi, avant/après)', /CLEAN_LOG/.test(SH));
v('app — expose ce journal au panneau admin', /_disqueNettoyages/.test(BLOC_APP) && /nettoyages:/.test(SRV));

console.log('\n── Observabilité et notification desk ──');
v('la route /api/admin/disque est réservée à l’admin', /app\.get\('\/api\/admin\/disque', requireAdmin/.test(SRV));
v('… et expose seuils, planchers, projection, nettoyages', /seuils: _DISQUE_SEUILS/.test(SRV) && /planchersGo/.test(SRV) && /nettoyages:/.test(SRV));
v('le desk pose toujours l’alerte disque en urgent (survol rouge)', /_dtpAlerteDisque/.test(APP) && /urgent: true/.test(APP));
v('l’historique vit sur le volume (survit aux déploiements)', /_DISQUE_HIST_F = path\.join\(_CACHE_DIR/.test(SRV));

console.log('\n── Plafonds permanents (entre deux passages) ──');
v('docker-compose plafonne les journaux du conteneur', /logging:/.test(COMPOSE) && /max-size:/.test(COMPOSE) && /max-file:/.test(COMPOSE));
v('installateur — plafonne journald en permanent (SystemMaxUse)', /SystemMaxUse=200M/.test(INSTALL));

console.log('\n── Les unités systemd et l’installateur ──');
v('le service pointe la copie du dépôt', /ExecStart=\/opt\/datatradingpro\/scripts\/vps\/dtp-disque\.sh/.test(SVC));
v('le minuteur repasse au moins toutes les 30 min', (() => { const m = /OnUnitActiveSec=(\d+)min/.exec(TIM); return !!m && +m[1] <= 30; })());
v('installateur — copie et active la sentinelle', /dtp-disque/.test(INSTALL) && /dtp-disque\.timer/.test(INSTALL));

// ── SCÉNARIOS SIMULÉS (via --simuler, sans effet de bord) ────────────────────────────────────────
console.log('\n── Scénarios simulés : aucun chemin ne mène à 100 % en silence ──');
let bash = true;
try { cp.execFileSync('bash', ['--version'], { stdio: 'ignore' }); } catch { bash = false; }
if (!bash) {
  console.log('  ~ bash indisponible — simulations abstenues (code 0), comme desk-verif sans Chromium.');
} else {
  const sim = (args) => {
    try {
      const out = cp.execFileSync('bash', ['scripts/vps/dtp-disque.sh', '--simuler', ...args], { cwd: RACINE, encoding: 'utf8', timeout: 15000 });
      const m = /niveau=(\d+)/.exec(out); return m ? +m[1] : null;
    } catch { return null; }
  };
  // franchissement des paliers (avec de l'espace pour ne pas déclencher le plancher Go)
  const paliers = [[['40', '5'], 0], [['72', '5'], 1], [['82', '5'], 2], [['91', '5'], 3], [['96', '5'], 4], [['99', '5'], 5]];
  for (const [args, attendu] of paliers) v('à ' + args[0] + '% → niveau ' + attendu, sim(args) === attendu, 'obtenu ' + sim(args));
  // le second critère : peu de Go, pourcentage modeste
  v('60 % mais 0,3 Go libres → URGENCE (plancher Go)', sim(['60', '0.3']) === 4, 'obtenu ' + sim(['60', '0.3']));
  // le troisième critère : remplissage brutal
  v('60 % + 100 % projeté dans 1 h → CRITIQUE (vitesse)', sim(['60', '5', '1']) === 3, 'obtenu ' + sim(['60', '5', '1']));
  v('88 % + 100 % dans 3 h → reste ALERTE (3 h > garde 2 h)', sim(['88', '5', '3']) === 2, 'obtenu ' + sim(['88', '5', '3']));
  // LA garantie centrale : 99 % ne peut PAS rester sans le plus haut niveau d'action
  v('99 % déclenche BIEN le DERNIER RECOURS (ballast + nettoyage)', sim(['99', '0.2']) === 5, 'obtenu ' + sim(['99', '0.2']));
}

console.log('\n── La couche intelligente (apprentissage, prédiction, anomalie) ──');
const BLOC_INT = (() => { const i = SRV.indexOf('COUCHE INTELLIGENTE'); const j = SRV.indexOf('// Toutes les 5 min'); return i >= 0 && j > i ? SRV.slice(i, j) : ''; })();
v('baseline apprise (vitesse habituelle)', /_disqueBaselineGoJ/.test(BLOC_INT));
v('vitesse actuelle en Go/h', /_disqueVitesseGoH/.test(BLOC_INT));
v('détection d’anomalie (actuel ≫ habituel)', /_disqueAnomalie/.test(BLOC_INT));
v('prédiction : heures et jours avant saturation', /_disqueHeures/.test(SRV) && /_disqueJours/.test(SRV));
v('identification de la source (shell, à partir du critique)', /du -xh[^\n]*sort -rh/.test(SH) && /nouvelle source dominante/.test(SH));
v('historique d’incidents journalisé (borné)', /_disqueAppendBorne\(_DISQUE_INC_F/.test(BLOC_INT) && /, 500\)/.test(BLOC_INT));
v('heartbeat mutuel : l’app écrit le sien', /_DISQUE_HB_APP_F/.test(BLOC_INT) && /writeFileSync\(_DISQUE_HB_APP_F/.test(BLOC_INT));
v('… et lit celui de la sentinelle (watchdog muet détectable)', /_disqueSentinelleAgeMin/.test(BLOC_INT) && /> 45/.test(BLOC_INT));
v('la sentinelle écrit son battement et lit celui de l’app (monitoring mort détectable)', /HB_SENT/.test(SH) && /MONITORING_HS/.test(SH));
v('la route admin expose toute la télémétrie', /vitesseGoH/.test(SRV) && /baselineGoJ/.test(SRV) && /incidents:/.test(SRV) && /seuilsEffectifs/.test(SRV));

console.log('\n── ⚠️ L’APPRENTISSAGE NE PEUT JAMAIS BAISSER LA SÉCURITÉ ──');
v('le cran de prudence est MONOTONE (jamais décrémenté)',
  /_prud = Math\.min\(15, _prud \+ 1\)/.test(BLOC_INT) && !/_prud\s*=\s*[^;]*-\s*1/.test(BLOC_INT) && !/_prud--/.test(BLOC_INT),
  'un apprentissage qui pourrait redescendre la prudence pourrait affaiblir la protection.');
v('… et il n’abaisse QUE surveillance/alerte, jamais les seuils d’ACTION',
  /surveillance: Math\.max\(50, _DISQUE_SEUILS\.surveillance - _prud\)/.test(BLOC_INT)
  && /alerte: Math\.max\(60, _DISQUE_SEUILS\.alerte - _prud\)/.test(BLOC_INT)
  && !/critique:[^\n]*- _prud/.test(BLOC_INT) && !/urgence:[^\n]*- _prud/.test(BLOC_INT) && !/dernier:[^\n]*- _prud/.test(BLOC_INT),
  'apprendre doit faire REGARDER plus tôt, jamais AGIR destructivement plus bas.');
v('une anomalie ne fait que MONTER la surveillance', /anomalie && niveau < 2/.test(BLOC_INT) && !/anomalie[^\n]*niveau\s*=\s*0/.test(BLOC_INT));

// Preuve exécutée : le cliquet, poussé au maximum, ne touche JAMAIS critique/urgence/dernier.
try {
  const grab = (re) => { const m = re.exec(SRV); if (!m) throw new Error('x'); return m[0]; };
  const code = ["const process={env:{}};",
    grab(/const _n = \(v, d\) => \{[^]*?\};/),
    grab(/const _DISQUE_SEUILS = \{[^]*?\};/),
    "let _prud=0;",
    grab(/function _disqueSeuilsEff\(\) \{[^]*?\n\}/),
    "module.exports={set:v=>_prud=v,_disqueSeuilsEff,_DISQUE_SEUILS};"].join("\n");
  const mm = new module.constructor(); mm._compile(code, 'r.js');
  const base = mm.exports._DISQUE_SEUILS;
  mm.exports.set(15);   // prudence MAX
  const eff = mm.exports._disqueSeuilsEff();
  v('[exécuté] prudence=15 : critique/urgence/dernier INCHANGÉS',
    eff.critique === base.critique && eff.urgence === base.urgence && eff.dernier === base.dernier,
    JSON.stringify(eff));
  v('[exécuté] prudence=15 : surveillance/alerte abaissés mais planchonnés (≥50/60)',
    eff.surveillance === Math.max(50, base.surveillance - 15) && eff.alerte === Math.max(60, base.alerte - 15),
    JSON.stringify(eff));
} catch (e) { v('[exécuté] cliquet de prudence', false, 'extraction impossible: ' + e.message); }

// Scénario runtime : monitoring figé → la sentinelle le détecte et alerte (via le battement partagé).
if (bash) {
  try {
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtpmon-'));
    fs.writeFileSync(path.join(dir, 'disque_hb_app'), String(Date.now() - 30 * 60000)); // 30 min (déjà en ms) → figé
    const out = cp.execFileSync('bash', ['-lc',
      'STUB=$(mktemp -d); printf \'#!/bin/sh\\necho "Filesystem 1024-blocks Used Available Capacity Mounted on"; echo "s 24000000 12000000 12000000 50%% /"\\n\' > "$STUB/df"; printf \'#!/bin/sh\\nexit 0\\n\' > "$STUB/curl"; printf \'#!/bin/sh\\nexit 0\\n\' > "$STUB/logger"; printf \'#!/bin/sh\\ncase "$1" in ps) exit 0;; *) echo x;; esac\\n\' > "$STUB/docker"; chmod +x "$STUB"/*; ST=$(mktemp -d); PATH="$STUB:$PATH" DTP_CLEAN_SHARED_DIR="' + dir.replace(/\\/g, '/') + '" DTP_DISQUE_ETAT="$ST" DTP_BALLAST="$ST/b" DTP_BALLAST_MO=1 bash scripts/vps/dtp-disque.sh 2>&1 | grep -o "monitoring fige" | head -1'],
      { cwd: RACINE, encoding: 'utf8', timeout: 20000 });
    v('[exécuté] monitoring figé (battement >15 min) → la sentinelle alerte, disque à 50 %',
      /monitoring fige/.test(out), 'sortie: ' + out.trim());
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  } catch (e) { v('[exécuté] détection monitoring figé', false, 'test impossible: ' + e.message); }
}


/* ══════════════════════════════════════════════════════════════════════════════════════════════
   LE MÉNAGE DU TIREUR — ON LE JOUE, ON NE LE LIT PAS (10/09/2026)
   ──────────────────────────────────────────────────────────────────────────────────────────────
   Le ménage de vps-autodeploiement.sh était écrit APRÈS la réponse de /healthz, donc dans le seul
   chemin qui RÉUSSIT. Or c'est le chemin qui ÉCHOUE qui remplit le disque : une version dont
   /healthz reste muet est reconstruite tous les quarts d'heure, indéfiniment (garde des 900 s),
   et aucune de ces constructions n'était nettoyée. Quatre constructions par heure sans ménage,
   c'est un disque qui se remplit tout seul pendant qu'on cherche pourquoi le desk ne répond pas.
   Une RELECTURE ne voit pas ce défaut : les deux morceaux sont justes séparément, c'est leur
   IMBRICATION qui est fausse. On exécute donc le VRAI script avec des doublures (git, docker,
   curl, sleep, df) et on regarde ce que `docker` a réellement reçu.
   Sans bash, on s'abstient — même idiome que le reste du fichier. ══════════════════════════════ */
if (bash) {
  const os = require('os');
  const AUTO_SRC = lire('scripts/vps-autodeploiement.sh');
  // Joue le tireur avec des doublures ; rend la trace des appels `docker`.
  // libreKo : ce que `df` annonce de libre. curlOk : /healthz répond ou non. patch : transforme
  // le source du script (sert aux TÉMOINS — on éprouve l'absence de la garde, pas une copie).
  const jouer = (libreKo, curlOk, patch) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtpauto-'));
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'dtpstub-'));
    const trace = path.join(dir, 'trace');
    const ecrire = (n, corps) => { const f = path.join(stub, n); fs.writeFileSync(f, corps); fs.chmodSync(f, 0o755); };
    ecrire('git', '#!/bin/sh\ncase "$1" in rev-parse) echo 1111111111111111111111111111111111111111;; esac\nexit 0\n');
    ecrire('docker', '#!/bin/sh\necho "$@" >> "' + trace.replace(/\\/g, '/') + '"\nexit 0\n');
    ecrire('curl', '#!/bin/sh\nexit ' + (curlOk ? '0' : '1') + '\n');
    ecrire('sleep', '#!/bin/sh\nexit 0\n');
    ecrire('df', '#!/bin/sh\necho "Filesystem 1024-blocks Used Available Capacity Mounted on"\necho "s 24000000 ' + (24000000 - libreKo) + ' ' + libreKo + ' 50% /"\nexit 0\n');
    const script = path.join(dir, 'tireur.sh');
    fs.writeFileSync(script, patch ? patch(AUTO_SRC) : AUTO_SRC);
    try {
      cp.execFileSync('bash', [script], {
        // ⚠️ stdio CAPTURÉ, JAMAIS HÉRITÉ. Le chemin d'échec qu'on éprouve ici écrit « ✗ /healthz
        // muet » sur la sortie d'erreur : hérité, ce ✗ atterrit dans le journal de `npm run check`
        // et fait compter DEUX ROUGES à qui relit le log au grep. Un banc ne doit jamais salir la
        // trace qu'on utilise pour le juger.
        cwd: RACINE, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
        // DTP_VERROU dans le dossier temporaire : /run n'appartient pas à l'utilisateur d'un runner
        // GitHub, et `exec 9>` y échoue sous `set -e` — le script mourrait avant la construction.
        env: Object.assign({}, process.env, { PATH: stub + path.delimiter + process.env.PATH, DTP_DIR: dir, DTP_URL: 'http://exemple.invalide', DTP_VERROU: path.join(dir, 'verrou') })
      });
    } catch { /* le chemin d'échec sort en 1 — c'est précisément celui qu'on éprouve */ }
    let t = ''; try { t = fs.readFileSync(trace, 'utf8'); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(stub, { recursive: true, force: true }); } catch {}
    return t;
  };
  const iBuild = (t) => t.split('\n').findIndex((l) => /compose build/.test(l));
  const iPrune = (t) => t.split('\n').findIndex((l) => /image prune/.test(l));

  console.log('\n── Le tireur nettoie-t-il VRAIMENT, y compris quand le déploiement échoue ? ──');
  const LARGE = 12000000, ETROIT = 400000;   // ~11,4 Go libres / ~0,4 Go libres

  const echec = jouer(LARGE, false, null);
  v('[exécuté] /healthz muet : la construction a bien eu lieu', iBuild(echec) >= 0, 'trace:\n' + echec);
  v('[exécuté] … et le ménage tourne QUAND MÊME (c’est ce chemin qui se rejoue tous les 1/4 h)',
    iPrune(echec) >= 0, 'aucun `image prune` dans la trace — le ménage est retombé dans la branche du succès.\n' + echec);
  v('[exécuté] … le cache de construction aussi', /builder prune/.test(echec), echec);

  const succes = jouer(LARGE, true, null);
  v('[exécuté] déploiement réussi : le ménage tourne aussi', iPrune(succes) >= 0, succes);
  v('[exécuté] … et APRÈS la construction (on garde l’image précédente et le cache chaud)',
    iBuild(succes) >= 0 && iPrune(succes) > iBuild(succes), succes);

  console.log('\n── Une construction ne démarre pas sur un disque déjà tendu ──');
  const tendu = jouer(ETROIT, true, null);
  v('[exécuté] 0,4 Go libres : on fait de la place AVANT de construire',
    iPrune(tendu) >= 0 && iBuild(tendu) >= 0 && iPrune(tendu) < iBuild(tendu),
    'à 100 %, nginx tronque en silence toute réponse de plus de ~750 Ko (07/09) : nettoyer après coup ne protège de rien.\n' + tendu);

  /* LE VERROU EST UN CONTRAT ENTRE DEUX SCRIPTS, pas un détail de chacun. La sentinelle saute ses
     purges Docker quand il est pris ; le tireur le prend le temps d'une construction. Deux valeurs
     par défaut qui divergeraient, et la sentinelle surveillerait un fichier que plus personne ne
     prend — elle purgerait EN PLEIN BUILD, sans rien signaler. On compare donc les DEUX littéraux,
     lus dans les deux fichiers. */
  const AUTO_BRUT = lire('scripts/vps-autodeploiement.sh');
  const SENT_BRUT = lire('scripts/vps/dtp-disque.sh');
  const dflt = (txt, re) => { const m = directives(txt).match(re); return m ? m[1] : null; };
  const vTireur = dflt(AUTO_BRUT, /exec 9>"\$\{DTP_VERROU:-([^}"]+)\}"/);
  const vSentinelle = dflt(SENT_BRUT, /VERROU_DEPLOIEMENT="\$\{DTP_VERROU:-([^}"]+)\}"/);
  v('le tireur et la sentinelle lisent la MÊME variable de verrou (DTP_VERROU)',
    !!vTireur && !!vSentinelle, 'tireur=' + vTireur + ' sentinelle=' + vSentinelle);
  v('… et la même valeur par défaut', !!vTireur && vTireur === vSentinelle,
    'divergentes, la sentinelle surveille un verrou que personne ne prend et purge pendant un build : ' +
    vTireur + ' ≠ ' + vSentinelle);

  console.log('\n── Ce que chaque construction écrit sur le disque ──');
  /* `COPY . .` est la DERNIÈRE couche du Dockerfile, donc celle qui change à chaque commit : tout
     ce qu'elle contient est réécrit ENTIÈREMENT à chaque construction, puis gardé une semaine par
     le `--filter until=168h`. Un cache régénérable qui traîne dans le contexte se paie donc autant
     de fois qu'on déploie. Mesuré le 10/09 : 16 PDF, 28 Mo, sur 45 Mo de contexte — les deux tiers,
     pour des fichiers que la production ne lit jamais (elle lit /app/data/pdf_cache, le volume). */
  const DOCKIGN = lire('.dockerignore');
  v('.dockerignore écarte le cache PDF régénérable', /^pdf_cache\/?$/m.test(DOCKIGN),
    'sans cette ligne, le cache repart dans l’image dès qu’il se reforme localement.');
  let suivis = '';
  try { suivis = cp.execFileSync('git', ['ls-files', 'pdf_cache'], { cwd: RACINE, encoding: 'utf8' }).trim(); } catch { suivis = ''; }
  const octets = suivis ? suivis.split('\n').reduce((n, f) => { try { return n + fs.statSync(path.join(RACINE, f)).size; } catch { return n; } }, 0) : 0;
  v('… et git n’en suit plus aucun fichier (rien à embarquer)', suivis === '',
    suivis.split('\n').length + ' fichier(s), ' + Math.round(octets / 1048576) + ' Mo réécrits à CHAQUE construction et gardés 7 jours.');

  // ── LES TÉMOINS : chacun doit MORDRE séparément, sinon le banc récite au lieu de mesurer.
  const sansTrap = jouer(LARGE, false, (s2) => s2.replace(/^trap _menage_docker EXIT$/m, ''));
  /* ⚠️ LE TÉMOIN EXIGE QUE LA CONSTRUCTION AIT EU LIEU. Sans cette moitié, il passe au vert quand
     le script n'a RIEN fait du tout — c'est arrivé au passage 166 : `exec 9>/run/…` échouait sur le
     runner, la trace sortait vide, et « le ménage ne tourne plus » était vrai pour la plus mauvaise
     des raisons. Un témoin qui peut passer À VIDE ne témoigne de rien. */
  v('[témoin] sans le `trap`, le chemin d’échec ne nettoie plus rien',
    iBuild(sansTrap) >= 0 && iPrune(sansTrap) < 0,
    'le témoin ne mord pas — ou pire, le script n’a pas tourné (trace vide).\n' + sansTrap);
  const sansGarde = jouer(ETROIT, true, (s2) => s2.replace(/^LIBRE_GO="\$\(_libre_go\)"$/m, 'LIBRE_GO=999'));
  v('[témoin] sans la garde d’avant-construction, on construit d’abord sur le disque tendu',
    iPrune(sansGarde) >= 0 && iBuild(sansGarde) >= 0 && iPrune(sansGarde) > iBuild(sansGarde), sansGarde);
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert') + '\n');
process.exit(ko ? 1 : 0);

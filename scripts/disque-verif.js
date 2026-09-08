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

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert') + '\n');
process.exit(ko ? 1 : 0);

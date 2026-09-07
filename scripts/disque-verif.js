#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════════════════════════
   BANC DE LA SENTINELLE DISQUE — CE QUI DOIT RESTER VRAI POUR QUE LA PANNE NE REVIENNE PAS
   ──────────────────────────────────────────────────────────────────────────────────────────────
   CE QUE CE BANC PROTÈGE (07/09/2026). Le disque du VPS a atteint 100 %. Aucune alerte, et aucun
   des symptômes ne parlait de disque :
     · nginx, ne pouvant plus écrire ses fichiers temporaires, TRONQUAIT toute réponse dépassant
       ~750 Ko — code 200, corps amputé, zéro erreur. Le navigateur jette alors la ressource
       entière : le desk arrivait en HTML nu. On a cherché du côté du login pendant des heures,
       parce que la page de connexion porte ses styles inline et survivait, seule, à la troncature.
     · Docker ne pouvait plus construire : le correctif ne pouvait pas se déployer.
     · La sauvegarde chiffrée échouait en silence depuis plusieurs jours.

   LA CAUSE ÉTAIT CONNUE ET DOCUMENTÉE, ET LE GARDE-FOU NE RETENAIT RIEN. `dtp-deploy.sh` portait
   depuis des mois le commentaire « sans ce ménage, c'est le disque plein qui finit par empêcher
   tout déploiement » — au-dessus d'un `docker image prune -f` qui, faute de `-a`, ne voyait aucune
   des images NOMMÉES qui s'entassaient, et ne touchait pas au cache de construction. Une commande
   qui tourne sans erreur et ne libère rien est pire qu'absente : elle fait croire le sujet traité.
   D'où ce banc : il vérifie que le ménage fait bien ce que son commentaire promet.

   ⚠️ TOUTES LES LECTURES NORMALISENT LES FINS DE LIGNE. Les unités systemd ne sont pas des .sh :
   git les rend en CRLF sur Windows. Un banc qui compare des chaînes brutes passerait en CI et
   échouerait chez le développeur — exactement le piège rencontré ce jour-là avec widget-cache-verif,
   où deux heures ont été perdues à chercher une régression qui n'existait pas.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 500) : '')); } };
const lire = (p) => { try { return fs.readFileSync(path.join(RACINE, p), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
/* Les DIRECTIVES seules, commentaires retirés. Sans cela, un banc qui cherche « Persistent=true »
   le trouve dans le commentaire qui explique pourquoi on ne l'emploie PAS — et déclare en échec un
   fichier exact. Pris sur le fait en écrivant ce banc : documenter un choix ne doit jamais le
   faire échouer, sinon la leçon suivante est d'arrêter de documenter. */
const directives = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const SENT = lire('scripts/vps/dtp-disque.sh');
const SERVICE = lire('scripts/dtp-disque.service');
const TIMER = lire('scripts/dtp-disque.timer');
const AUTO = lire('scripts/vps-autodeploiement.sh');
const DEPLOY = lire('scripts/vps/dtp-deploy.sh');
const COMPOSE = lire('docker-compose.yml');
const INSTALL = lire('scripts/vps-resilience-installer.sh');

console.log('\n── La sentinelle existe et mesure juste ──');
v('scripts/vps/dtp-disque.sh est présent', SENT.length > 2000, SENT.length + ' octets');

/* LES CINQ PALIERS SONT UNE DEMANDE EXPLICITE : ils doivent rester déclarés, nommés, et ordonnés.
   Un seuil d'action inférieur au seuil critique inverserait la logique en silence. */
const seuils = ['SEUIL_SURVEILLANCE', 'SEUIL_ALERTE', 'SEUIL_CRITIQUE', 'SEUIL_ACTION']
  .map((n) => { const m = new RegExp('^' + n + '=(\\d+)', 'm').exec(SENT); return m ? +m[1] : null; });
v('les quatre seuils sont déclarés en tête de fichier', seuils.every((s) => s !== null), seuils.join(' / '));
v('… et strictement croissants (surveillance < alerte < critique < action)',
  seuils.every((s, i) => i === 0 || (s !== null && seuils[i - 1] !== null && s > seuils[i - 1])),
  'valeurs lues : ' + seuils.join(' < ') + " — un ordre inversé ferait nettoyer avant d'alerter.");
v('… et aucun ne dépasse 99 (à 100 % il est déjà trop tard)', seuils.every((s) => s === null || s < 100), seuils.join('/'));

/* LE TÉMOIN DE LA RÉGRESSION RÉELLEMENT RENCONTRÉE. Les colonnes de `df -P` étaient lues depuis le
   DÉBUT ($5, $4, $2). Un nom de périphérique contenant un espace décale tout : au banc, le
   pourcentage est sorti à « 134271896% » et le disque à « 0.0 Go ». Depuis la fin, c'est stable. */
v('les colonnes de `df` sont lues depuis la FIN (insensible aux espaces dans le nom du périphérique)',
  /\$\(NF-1\)/.test(SENT) && /\$\(NF-2\)/.test(SENT) && /\$\(NF-4\)/.test(SENT),
  'lecture positionnelle depuis le début détectée : un périphérique nommé « C:/Program Files/Git »'
  + ' ou un montage réseau avec espace ferait lire un pourcentage inexistant.');
v('… et plus aucune lecture positionnelle $5/$4/$2 sur une ligne df',
  !/df -P[^\n]*\n?[^\n]*awk[^\n]*\$5/.test(SENT), 'forme fautive encore présente');

console.log('\n── Elle prévient AVANT, pas seulement au seuil ──');
v('une projection de saturation existe (régression sur l’historique)', /PREVISION_JOURS=\d+/.test(SENT) && /pente/.test(SENT));
v('… elle refuse de prédire sous 3 points de mesure', /if \(n < 3\) exit;/.test(SENT),
  'sans ce garde-fou, deux mesures suffiraient à annoncer une fausse échéance — et une alerte à laquelle on ne croit plus ne sert plus à rien.');
v('… et elle peut FAIRE MONTER le niveau, jamais le faire descendre',
  /NIVEAU" -lt 2 \]; then NIVEAU=2/.test(SENT),
  'la projection doit escalader un disque bas mais qui monte vite, sans jamais désamorcer un seuil déjà franchi.');

console.log('\n── Elle n’efface QUE du régénérable ──');
v('aucune purge de volumes (--volumes détruirait des données)', !/--volumes/.test(SENT),
  '`docker system prune --volumes` effacerait des données applicatives.');
v('aucun rm -rf dans la sentinelle', !/rm -rf/.test(SENT));
v('le ménage se limite aux images, au cache de construction et aux journaux',
  /docker image prune/.test(SENT) && /docker builder prune/.test(SENT) && /journalctl --vacuum-size/.test(SENT));
v('… et ne peut pas s’emballer (au plus une purge par heure)', /-lt 3600 \]/.test(SENT),
  "sans ce garde-fou, un disque saturé par autre chose relancerait la purge tous les quarts d'heure en masquant la vraie cause.");

console.log('\n── Le ménage des déploiements fait ce que son commentaire promet ──');
/* LE CŒUR DU BANC. C'est l'absence de `-a` qui a laissé 14,87 Go d'images s'accumuler, et l'absence
   totale de purge du cache qui a ajouté 3,42 Go. Les DEUX chemins de déploiement doivent purger :
   l'automatique (à chaque push) ne le faisait pas du tout — c'est lui qui tourne le plus souvent. */
/* ⚠️ ON TESTE LE CODE, PAS LES COMMENTAIRES, et ici c'est vital. Ces deux fichiers PARLENT
   longuement de `docker image prune` pour expliquer la panne : un banc qui lirait le fichier brut
   se déclarerait satisfait par la prose d'un fichier dont on aurait retiré la commande. Il
   validerait exactement la situation qu'il est censé interdire. */
for (const [nom, brut] of [['vps-autodeploiement.sh', AUTO], ['vps/dtp-deploy.sh', DEPLOY]]) {
  const src = directives(brut);
  v(nom + ' purge les images INUTILISÉES (-a, pas seulement les anonymes)',
    /docker image prune -a -f/.test(src),
    '`prune -f` sans `-a` ne retire que les images sans nom : node:20 et'
    + ' datatradingpro-datatradingpro:latest étaient nommées, donc invisibles pour elle.');
  v(nom + ' purge aussi le cache de construction', /docker builder prune -f/.test(src),
    'le cache de construction n’était purgé nulle part : 3,42 Go accumulés.');
  v(nom + ' garde une semaine d’images (retour arrière possible sans reconstruire)',
    /--filter until=168h/.test(src),
    'sans fenêtre de rétention, revenir à la version précédente imposerait ~10 min de reconstruction'
    + ' — le jour où il faut aller vite.');
}

console.log('\n── Les journaux du conteneur sont bornés ──');
v('docker-compose.yml plafonne la taille des journaux', /logging:/.test(COMPOSE) && /max-size:/.test(COMPOSE),
  'le pilote json-file par défaut n’a AUCUNE limite : une boucle d’erreur bavarde remplirait le disque en une nuit.');
v('… avec une rotation (max-file), sinon un seul fichier grossit sans fin', /max-file:/.test(COMPOSE));

console.log('\n── Les unités systemd sont cohérentes ──');
v('dtp-disque.service pointe la copie DU DÉPÔT (se met à jour au déploiement)',
  /ExecStart=\/opt\/datatradingpro\/scripts\/vps\/dtp-disque\.sh/.test(SERVICE),
  'une copie dans /usr/local/bin finirait par diverger de l’original.');
v('… et démarre après Docker (sinon diagnostic et e-mail muets)', /After=docker\.service/.test(SERVICE));
v('le minuteur repasse au moins toutes les 30 min',
  (() => { const m = /OnUnitActiveSec=(\d+)min/.exec(TIMER); return !!m && +m[1] <= 30; })(),
  'au-delà, un remplissage brutal aurait le temps de saturer entre deux passages.');
/* Persistent=true ne rattrape QUE les minuteurs OnCalendar. Le recopier ici depuis
   dtp-sauvegarde.timer donnerait l'illusion d'un rattrapage inexistant. C'est OnBootSec qui joue
   ce rôle sur un minuteur cadencé. */
v('… il rattrape au démarrage par OnBootSec, sans Persistent trompeur',
  /OnBootSec=/.test(directives(TIMER)) && !/Persistent=true/.test(directives(TIMER)),
  'Persistent=true est sans effet sur un minuteur OnUnitActiveSec : le poser ferait croire à un rattrapage qui n’existe pas.');

console.log('\n── L’installateur la pose vraiment ──');
v('vps-resilience-installer.sh copie l’unité dtp-disque', /dtp-sauvegarde dtp-keepalive dtp-disque/.test(INSTALL),
  'un fichier présent dans le dépôt mais jamais installé, c’est exactement la panne que cet installateur avait été écrit pour corriger.');
v('… et active son minuteur', /systemctl enable --now[^\n]*dtp-disque\.timer/.test(INSTALL));

console.log('\n── La mesure côté application (desk) ──');
/* DEUX MESURES POUR LA MÊME CHOSE, ET C'EST VOULU : la sentinelle systemd survit à un conteneur
   mort, celle-ci survit à un installateur jamais lancé — le défaut exact qui a laissé le keep-alive
   absent deux mois et demi. Elles ne meurent pas au même moment, donc elles ne font pas doublon.
   MAIS ELLES DOIVENT DIRE LA MÊME CHOSE. Deux jeux de seuils qui divergent, et le panneau admin
   contredira l'e-mail un jour de panne — le moment où l'on a le moins besoin d'hésiter. */
const SRV_JS = lire('server.js');
const APP = lire('public/js/app.js');
v('server.js mesure le disque et expose son état', /_DISQUE_SEUILS/.test(SRV_JS) && /\/api\/admin\/disque/.test(SRV_JS));
const sj = /_DISQUE_SEUILS = \{ surveillance: (\d+), alerte: (\d+), critique: (\d+), action: (\d+) \}/.exec(SRV_JS);
v('… avec EXACTEMENT les mêmes seuils que la sentinelle systemd',
  !!sj && seuils.every((s, i) => +sj[i + 1] === s),
  'shell = ' + seuils.join('/') + '  ·  server.js = ' + (sj ? sj.slice(1, 5).join('/') : 'illisible')
  + ' — deux jeux qui divergent feraient dire au panneau autre chose qu’à l’e-mail.');
v('… et la même règle de projection (7 jours, refus sous 3 points)',
  /_DISQUE_PREVISION_J = 7/.test(SRV_JS) && /pts\.length < 3/.test(SRV_JS));
v('… en lisant `df` depuis la FIN des colonnes, comme le shell',
  /l\.length - 2/.test(SRV_JS) && /l\.length - 3/.test(SRV_JS) && /l\.length - 5/.test(SRV_JS),
  'un nom de périphérique avec un espace décalerait un découpage fait depuis le début.');
/* L'HISTORIQUE DOIT SURVIVRE AUX DÉPLOIEMENTS. Gardé en mémoire, il repartirait vide à chaque mise
   en ligne : un desk redéployé deux fois par semaine n'aurait jamais trois points, donc ne
   prédirait JAMAIS rien. La surveillance aurait l'air de tourner sans pouvoir alerter tôt. */
v('… et son historique est écrit sur le volume, pas gardé en mémoire',
  /_DISQUE_HIST_F = path\.join\(_CACHE_DIR/.test(SRV_JS),
  'un historique en mémoire repart vide à chaque déploiement : la projection ne se déclencherait jamais.');
v('la route est réservée à l’admin', /app\.get\('\/api\/admin\/disque', requireAdmin/.test(SRV_JS),
  'un abonné qui lit « Disque à 92 % » perd confiance pour une information qui ne le concerne pas.');
v('l’alerte remonte dans le journal du panneau admin', /_aiAlertNote\([^)]*'disque'/.test(SRV_JS));

console.log('\n── La notification dans le desk ──');
v('app.js pose l’alerte disque', /_dtpAlerteDisque/.test(APP));
v('… en urgent (le survol rouge de .news-item--urgent)', /urgent: true/.test(APP));
v('… réservée au rôle admin côté client aussi', /u\.role !== 'admin'/.test(APP),
  'la garde serveur suffit à la sécurité, celle-ci évite un 403 par abonné à chaque ouverture.');
v('… et elle ATTEND que le compte soit connu au lieu de le supposer',
  /reste > 0/.test(APP),
  '`_pdUser` est posé par /api/auth/me, donc après un aller-retour réseau : le lire tout de suite'
  + ' donnerait null sur toute connexion lente, et l’alerte ne s’afficherait jamais en silence.');
v('le survol rouge existe toujours dans la feuille de style',
  /\.news-item--urgent:hover/.test(lire('public/css/style.css')),
  'l’alerte perdrait sa signalétique sans que rien ne le dise.');

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert') + '\n');
process.exit(ko ? 1 : 0);

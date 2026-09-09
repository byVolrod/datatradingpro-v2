#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════════════════════════
   BANC DU REDÉMARRAGE MENSUEL — CE QUI DOIT RESTER VRAI POUR QU'IL RESTE ACCEPTABLE
   ──────────────────────────────────────────────────────────────────────────────────────────────
   Un redémarrage automatique est une commodité tant qu'il est encadré, et un risque dès qu'il ne
   l'est plus. Ce banc tient les quatre conditions qui font la différence :
     1. il S'ABSTIENT quand redémarrer ferait des dégâts (déploiement, sauvegarde, desk déjà en panne) ;
     2. il VÉRIFIE le retour — programmer un redémarrage sans contrôler le retour, c'est programmer
        une panne un dimanche matin, découverte le lundi par un client ;
     3. il ne dit « réussi » QUE pour un redémarrage qu'il a lui-même provoqué. Un message faux use
        la confiance accordée à tous les autres ;
     4. il laisse partir son e-mail AVANT de couper.
   Retirer l'une des quatre ne casse rien de visible — jusqu'au jour où ça casse tout. D'où ce banc.

   ⚠️ LECTURES NORMALISÉES ET COMMENTAIRES ÉCARTÉS. Les unités systemd ne sont pas des .sh : git les
   rend en CRLF sur Windows. Et ce fichier PARLE de `Persistent=true` pour expliquer où il s'applique
   et où il ne s'applique pas : un banc qui lirait le texte brut trouverait la directive dans la
   prose et se tromperait dans les deux sens. Piège rencontré pour de vrai en écrivant le banc du
   disque, le même jour.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 400) : '')); } };
const lire = (p) => { try { return fs.readFileSync(path.join(RACINE, p), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
const directives = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const code = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const SH = lire('scripts/vps/dtp-redemarrage.sh');
const SH_CODE = code(SH);
const SVC = directives(lire('scripts/dtp-redemarrage.service'));
const TIM = directives(lire('scripts/dtp-redemarrage.timer'));
const CSVC = directives(lire('scripts/dtp-redemarrage-controle.service'));
const CTIM = directives(lire('scripts/dtp-redemarrage-controle.timer'));
const INSTALL = lire('scripts/vps-resilience-installer.sh');

console.log('\n── Le script existe et sait faire les deux moitiés ──');
v('scripts/vps/dtp-redemarrage.sh est présent', SH.length > 2000, SH.length + ' octets');
v('… il gère le passage mensuel ET le contrôle du retour',
  /--planifie/.test(SH_CODE) && /--verifier/.test(SH_CODE));
v('… et un mode --etat qui ne touche à rien', /"--etat"/.test(SH_CODE));

console.log('\n── Les abstentions : ce qui empêche un redémarrage nuisible ──');
v('il s’abstient si la machine est déjà fraîche (< 7 jours)',
  /MIN_JOURS=7/.test(SH_CODE) && /-lt "\$MIN_JOURS"/.test(SH_CODE),
  'redémarrer une machine démarrée hier ne sert à rien et coûte une coupure.');
v('… si une sauvegarde tourne', /is-active --quiet dtp-sauvegarde/.test(SH_CODE),
  'couper au milieu produirait une archive tronquée — inutilisable, et silencieuse sur son état.');
v('… si un déploiement tourne', /dtp-autodeploiement\.lock/.test(SH_CODE),
  'couper au milieu d’une construction d’image laisserait le déploiement à moitié fait.');
/* CELLE-CI EST LA PLUS CONTRE-INTUITIVE, ET LA PLUS UTILE. Redémarrer une machine DÉJÀ malade rend
   le retour illisible : on ne saurait plus dire si la panne préexistait ou si le redémarrage l'a
   causée. C'est exactement l'ambiguïté qui fait perdre des heures un jour d'incident. */
v('… et si le desk est DÉJÀ en panne — auquel cas il alerte au lieu de redémarrer',
  /MALADE=/.test(SH_CODE) && /ANNULE/.test(SH_CODE),
  'redémarrer une machine déjà malade rend le diagnostic illisible ; un humain doit regarder d’abord.');

console.log('\n── Le contrôle du retour ──');
v('le contrôle attend réellement que /healthz réponde',
  /ATTENTE_RETOUR=\d+/.test(SH_CODE) && /sante_ok/.test(SH_CODE));
v('… et écrit AUSSI quand le desk ne revient pas',
  /N'EST PAS revenu|N.EST PAS revenu/.test(SH_CODE),
  'un contrôle qui ne parle qu’en cas de succès ne surveille rien : c’est le silence qu’il faut interpréter, et personne ne le fait.');
/* SANS CETTE MARQUE, un redémarrage de l'hébergeur ou un `reboot` tapé à la main déclencherait un
   « redémarrage mensuel réussi ». Un message faux use la confiance accordée à tous les autres. */
v('… mais UNIQUEMENT pour un redémarrage que nous avons provoqué (marque)',
  /\[ -f "\$MARQUE" \] \|\| \{/.test(SH_CODE),
  'sans la marque, tout redémarrage déclencherait un « mensuel réussi » — un message faux.');
v('… la marque est consommée, jamais laissée derrière', /rm -f "\$MARQUE"/.test(SH_CODE));
v('… et une marque périmée est ignorée', /-gt 7200/.test(SH_CODE),
  'un démarrage sans rapport, deux jours plus tard, ne doit pas se faire passer pour le nôtre.');

console.log('\n── La coupure laisse partir son message ──');
v('l’e-mail d’annonce part AVANT le shutdown',
  SH_CODE.indexOf('envoyer "Redemarrage mensuel dans') < SH_CODE.indexOf('shutdown -r'),
  'annoncer après avoir coupé revient à ne pas annoncer.');
v('… et le shutdown est différé, pas immédiat', /shutdown -r \+\$\{DELAI_MIN\}/.test(SH_CODE),
  'une coupure immédiate tuerait le conteneur avant que le courriel ne sorte.');

console.log('\n── Les unités systemd ──');
v('le passage mensuel tombe le premier dimanche', /OnCalendar=Sun \*-\*-01\.\.07/.test(TIM),
  'marché forex fermé, et après la sauvegarde de 04h10.');
/* Persistent=true ne rattrape QUE les minuteurs à calendrier — donc il A un sens ici, et n'en a
   AUCUN sur le minuteur de démarrage. Les deux contrôles ci-dessous forment une paire : ils
   interdisent autant l'oubli que la copie mécanique d'une option d'un fichier à l'autre. */
v('… avec Persistent=true, qui a un sens sur un minuteur à calendrier', /Persistent=true/.test(TIM),
  'un serveur éteint ce dimanche-là sauterait le ménage pour un mois, sans bruit.');
v('le contrôle tourne au démarrage, sans Persistent trompeur',
  /OnBootSec=/.test(CTIM) && !/Persistent=true/.test(CTIM),
  'Persistent n’a aucun effet sur un minuteur de démarrage : le poser ferait croire à un rattrapage inexistant.');
v('les deux services pointent la copie du dépôt',
  /ExecStart=\/opt\/datatradingpro\/scripts\/vps\/dtp-redemarrage\.sh --planifie/.test(SVC)
  && /ExecStart=\/opt\/datatradingpro\/scripts\/vps\/dtp-redemarrage\.sh --verifier/.test(CSVC));
v('… et le contrôle démarre après Docker', /After=[^\n]*docker\.service/.test(CSVC),
  'sans Docker, il ne peut ni voir le conteneur ni envoyer son message.');

console.log('\n── L’installateur les pose ──');
v('vps-resilience-installer.sh copie les deux unités',
  /dtp-disque dtp-redemarrage dtp-redemarrage-controle/.test(INSTALL),
  'un fichier présent dans le dépôt mais jamais installé — la panne même que cet installateur répare.');
v('… active leurs minuteurs', /dtp-redemarrage\.timer/.test(INSTALL) && /dtp-redemarrage-controle\.timer/.test(INSTALL));
v('… et rend le script exécutable', /chmod \+x[^\n]*dtp-redemarrage\.sh/.test(INSTALL));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert') + '\n');
process.exit(ko ? 1 : 0);

# DataTradingPro — Cahier des charges (CLAUDE.md)

> ⚠️ **Identité visuelle 100 % propriétaire DataTradingPro**, calée sur la landing **datatradingpro.com** : **or** (`#e3b23a` vif / `#b8860b` sombre), titres **Fraunces** (serif) + **Inter Tight**, cartes à coins doux + bordures fines + hover doré. L'apparence (couleurs, typo, style) est **originale et unique** — aucune référence externe. Tous les widgets portent des **noms français originaux** : Éclairages IA, Radar de Biais, Baromètre / Force des Devises, Copilote Macro, Notes d'Analystes, Flash Marché, Alertes, Semaine à Venir… ; badges **ACHAT / VENTE / NEUTRE**.

## Stack & contraintes (NE PAS proposer autre chose)
- **Vanilla JS + CSS pur + Express** servi statiquement. **PAS de React/Tailwind/build.** L'utilisateur demande souvent « React + Tailwind » → toujours livrer **l'équivalent vanilla** (classes Tailwind traduites en CSS, SVG inline). Ne jamais introduire de framework.
- **amCharts 5** pour les graphiques (dark + **or**, plus d'orange).
- **VPS Linux `149.71.44.90`, Docker Compose** (service `datatradingpro`) — **plus Render** (le `render.yaml` du dépôt est un vestige). Contraintes qui RESTENT : **512 Mo RAM** et disque **éphémère** → anti-OOM/502 obligatoire (timeouts fetch, caps mémoire, verrous, **persistance Supabase `ai_cache`** pas disque). Ce qui NE s'applique plus : la mise en veille au bout de 15 min — un VPS ne s'endort pas. Source : `RESTORE.md` § 0.
- **Directs Bloomberg / Yahoo** : la carte encadre la diffusion officielle de la chaîne. Le serveur résout l'identifiant (`/api/direct/<clé>`) ; si YouTube refuse ses lectures (bandeau de consentement servi aux adresses de centre de données, limitation), poser `DTP_DIRECT_BLOOMBERG` / `DTP_DIRECT_YAHOO` = l'identifiant de CHAÎNE (`UC` + 22) dans le `.env` du VPS : permanent, prioritaire sur tout le reste, aucun redéploiement. Diagnostic administrateur : `GET /api/admin/direct/<clé>` (statut, adresse finale, bandeau détecté, ce qui a été extrait, lecture par lecture).
- **Gemini free-tier** (quota dur) + repli **Claude multi-clés** (`ai.generateText`). Tout l'IA doit **cacher** (clé = hash) et idéalement **préchauffer en tâche de fond** (jamais générer quand l'utilisateur ouvre).
- UI **100 % en français** — tous les libellés produit sont **traduits** (« Éclairages IA », « En ligne », onglets « Calendrier / Analystes / Biais / Banques », titres de rapports…). **Ne plus laisser de texte produit en anglais** (sauf valeurs logiques internes : `_reportType`, `BUY/SELL`, `data-view` → traduire uniquement à l'**affichage**).

## SÉCURITÉ (verbatim, ne jamais enfreindre)
- Une clé Anthropic « sk-ant-api03-o1yqU_… » a été COMPROMISE → à roter. **Ne jamais stocker/committer de clés.** Les clés vivent UNIQUEMENT dans le **`.env` du VPS** (`/opt/datatradingpro/.env`), jamais dans le dépôt. `.env*` est gitignored → **JAMAIS committer**.

## Workflow (chaque changement)
- **Commit + push à chaque fois**. Messages FR, finir par `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- ⚠️ **POUSSER SUR MAIN DÉPLOIE** (décision user du 29/08 : « retrouver le push = prod automatique comme sur Render » — oui explicite ; l'ancienne règle « pousser ne déploie pas » du 27/08 est LEVÉE, et toutes ses traces réécrites dans le même commit). Chaque `git push origin main` déclenche le workflow **« Déployer le desk »**, qui fait tourner **`npm run check` AVANT tout** : un push qui casse un banc est BLOQUÉ, pas déployé — c'est cette garde qui remplace l'ancienne retenue manuelle. **MÉCANISME (30/08, « la méthode à l'ancienne ») : le JALON `prod-ready`** — bancs verts → le workflow avance le tag `prod-ready` (GITHUB_TOKEN automatique, **aucun secret requis**) → le **tireur du VPS** (minuteur systemd posé UNE fois par `bash scripts/vps-autodeploiement-installer.sh` sur le VPS) tire ce tag chaque minute et rejoue reset → build → up → `/healthz`. Prod à jour ~2 min après le push, comme Render qui tirait le dépôt. **Option accélérateur** : si le secret `DTP_SSH_KEY` (+ variable `DTP_KNOWN_HOSTS`, `ssh-keyscan -t ed25519 149.71.44.90`) est posé un jour, les étapes SSH du workflow s'activent et poussent en direct ; sans lui elles se SAUTENT proprement (run VERT — plus jamais de rouge « clé manquante »). Si la clé est posée : la brider dans `authorized_keys` avec `command="…"`. Quand un correctif « ne marche pas » : vérifier le **run Actions du push** (vert ? jalon avancé ?), puis `journalctl -u dtp-autodeploiement.service -n 30` sur le VPS, puis **Ctrl+F5**.
  ```bash
  npm run deploy      # = scripts/deploy.sh — le chemin MANUEL depuis une machine qui a la clé, toujours valable
  ```
  Le script PRÉVIENT si des commits ne sont pas poussés (déployer enverrait alors la version de
  GitHub, pas la vôtre), affiche la version avant/après, et attend que `/healthz` réponde avant de
  conclure — sinon il sort le journal du conteneur. Commande brute équivalente :
  ```bash
  ssh -i ~/.ssh/dtp_deploy root@149.71.44.90 \
    'cd /opt/datatradingpro && git fetch origin main && git reset --hard origin/main \
     && docker compose build datatradingpro && docker compose up -d datatradingpro'
  ```
  Le bouton **Actions → « Déployer le desk » → Run workflow** reste disponible (relance à la main, depuis un téléphone). Ce n'est PAS une seconde implémentation : le workflow pose la clé du secret `DTP_SSH_KEY` et **appelle `scripts/deploy.sh`** par ses surcharges d'environnement — un banc (`scripts/deploiement-verif.js`, câblé dans `npm run check`) refuse qu'on y recopie la séquence distante, exige que les déclencheurs soient **exactement** `{ push sur main + workflow_dispatch }` (un `schedule` déploierait sans nouveau code ; un push sans filtre de branche ferait déployer les branches de session), et que la garde `npm run check` coure AVANT tout contact avec la clé. Le miroir `backup` ne peut pas déployer (garde `if:` sur le nom du dépôt).
  ⚠️ **POURQUOI RECONSTRUIRE ET PAS SEULEMENT RÉCUPÉRER** (vérifié, pas supposé) : `docker-compose.yml`
  ne monte QUE `./data/*` — aucun volume de code source — et le `Dockerfile` fait `COPY . .` au moment
  du build. Un `git pull` sur le disque du VPS ne change donc RIEN à ce qui tourne dans le conteneur.
- **BACKUP OBLIGATOIRE** : après CHAQUE `git push origin main`, faire AUSSI `git push backup main` (remote `backup` = `https://github.com/byVolrod/datatradingpro-v2-backup.git`, repo privé miroir). Le backup doit toujours rester à jour avec origin. (Si le remote `backup` manque sur une nouvelle machine : `git remote add backup https://github.com/byVolrod/datatradingpro-v2-backup.git`.)
- **Cache-busting** : `node scripts/bump-cache.js` — et **plus** un bump manuel de `public/index.html`. Le script aligne TOUTES les pages (`index`, `admin`, `login`, `week-ahead`) sur un jeton unique. Rappeler **Ctrl+F5**.
  ⚠️ Ne bumper que `index.html` a laissé le **panneau admin 8 jours en retard** (06/08) : `express.static` sert les JS/CSS en `maxAge: 30d`, donc tant que l'URL ne change pas le navigateur ne redemande rien. Le serveur livrait le fichier neuf, l'admin voyait l'ancien — et on cherchait le bug dans le code livré.
- Toujours `node -c` les fichiers JS + vérifier l'équilibre des accolades CSS avant commit.
- **`node scripts/js-verif.js` (identifiants fantômes) — OBLIGATOIRE avant tout commit touchant `public/js` ou le JS serveur.** `node -c` ne voit QUE la syntaxe : le 25/08, une variable locale supprimée du constructeur de ligne du fil (`isHighImpactData`) était encore lue soixante lignes plus bas — syntaxe parfaite, `ReferenceError` à chaque ligne, **fil d'actualité entièrement vide en production**, découvert par la capture d'un client. L'outil relève tout identifiant LU mais déclaré NULLE PART (portée client déduite des `<script src>` de chaque page + scripts en ligne du HTML ; portée serveur par fichier). Posé en hook : `node scripts/js-verif.js --install`.
  ⚠️ Le hook `pre-commit` lançait `exec node dtp-updates-verif.js` : `exec` REMPLACE le shell, toute ligne ajoutée derrière serait restée morte. `--install` le neutralise et met `|| exit 1` sur chaque contrôle.
- **`node scripts/desk-verif.js` — le desk OUVERT dans un vrai Chromium, API bouchonnée, et on compte les lignes du fil.** C'est le seul contrôle qui voit ce qu'aucun autre ne voit : une exception avalée dans la construction d'une ligne, une fonction disparue, un filtre qui mange tout. Le 25/08 l'incident sortait EXACTEMENT ainsi — en-tête de journée présent, bouton « Charger plus » présent, **zéro ligne**, et aucune erreur en console (la construction de ligne est enveloppée dans un try/catch). Sans navigateur disponible il s'abstient (code 0) au lieu de bloquer.
- **`node scripts/onglets-verif.js` — déplacer un onglet sans rien désaligner.** Un panneau à onglets tient sur SIX structures indexées POSITIONNELLEMENT, sans clé stable : `tabs`, `tabLabels`, `tabIcons`, `tabGrid`, les clés de `tabCfg` (« 3 », « 3-1 ») et `_tabAct`. En réindexer cinq sur six ne casse rien de visible : le nom, l'icône ou les réglages glissent sur l'onglet VOISIN, et on le découvre trois jours plus tard. Le piège avait déjà mordu — `removeTab` oubliait `tabIcons`. Le script extrait le VRAI `_reordonnerOnglets` de `widgets.js` (pas une copie) et éprouve la permutation, puis **glisse pour de vrai dans un Chromium** : sans `preventDefault` sur `dragover`, Chrome n'émet JAMAIS `drop` — panne classique du glisser-déposer HTML5, invisible en lecture de code.
- Tout ça d'un coup : **`npm run check`** (js-verif → desk-verif → weekahead-verif → seance-verif → onglets-verif → campagne).
- **Nouveautés DTP (obligatoire)** : à CHAQUE développement visible par les clients, ajouter une entrée `DTP_UPDATES` (server.js, id `dtpu-AAAAMMJJ-slug`, ton annonce produit sans jargon) **dans le même commit** → elle s'affiche dans l'onglet DTP du panneau ALERTES (fenêtre 7 j, seed silencieux). **Le user tient à ce fil : c'est ainsi que ses clients savent ce qui change et peuvent suivre.**
  ⚠️ **GARDE-FOU AUTOMATIQUE** (posé le 11/08 après 4 oublis dans la même journée) : `node scripts/dtp-updates-verif.js --install` installe un hook `pre-commit` qui REFUSE un commit touchant `public/js`, `public/css`, `public/*.html`, `mailer.js` ou `server.js` (hors tableau) sans nouvelle entrée `dtpu-`. Contrôle après coup : `node scripts/dtp-updates-verif.js --last`. Contournement assumé pour une refonte invisible : `git commit --no-verify`.
- ⚠️ **`scripts/dtp-updates-accents.js` N'ÉCRIT PLUS TOUT SEUL** (27/08). Il réécrivait `server.js` à chaque appel, en silence, et a introduit **trois classes de fautes dans des annonces déjà livrées aux clients** : 31 contresens « à » pour « a » (il retombait sur la préposition faute de preuve, et ne reconnaissait comme sujet qu'une liste fermée de PRONOMS — jamais un sujet nom : « le desk **à** de quoi comparer ») ; « n'a » → « n'**à** », qui n'existe dans aucune phrase française, par une garde qui cherchait « n’ » là où la capture rendait « n » ; et « s'avere » → « s'**avéré** » au lieu de « s'avère », par la garde des pronoms élidés, qui capturait « s’ » et comparait à « s » — **elle ne s'était donc jamais déclenchée**. Les trois sont corrigées, la règle « a → à » est inversée (on n'accentue plus que **sur preuve**), et l'outil est passé en **lecture seule** : sans `--ecrire`, il montre ligne par ligne ce qu'il changerait et ne touche à rien. **Toujours relire la sortie avant d'ajouter `--ecrire`.**
  Deux garde-fous permanents, dans `dtp-updates-verif.js` : le hook `pre-commit` refuse une nouvelle annonce portant « n'à » ou « à » + participe, et `npm run check` relit **les 379 annonces livrées** à chaque passage. Les deux règles couvrent les **deux écritures de l'apostrophe** — la typographique `’` et la droite échappée `\'` — parce que la première réparation n'a connu que la typographique et a laissé trois contresens en place.
- ⚠️ **TRADUCTION DES TITRES — LA RÈGLE A CHANGÉ LE 28/08, ET LES COMMENTAIRES MENTAIENT.** Un veto du 03/07 (« un titre de fil ne se traduit jamais ») était écrit **trois fois** dans `server.js`. Il a été **levé par l'utilisateur le 28/08** : le desk affiche désormais `_titreFr` (champ d'AFFICHAGE, `item.headline` n'est jamais muté). **Ce qui reste vrai** : les **pages publiques** (`/actu`) gardent le titre d'origine — c'est du contenu **indexé**, et cette décision-là n'a pas été prise. Les deux surfaces divergent volontairement.
  ⚠️ **AVANT DE TOUCHER À LA LANGUE DE QUOI QUE CE SOIT : `grep -n "veto" server.js public/js/*.js`.** J'ai livré la traduction des titres SANS le faire, contre un veto explicite. Et symétriquement, `charts.js` portait « propos jamais traduits — veto » alors que leur traduction était **demandée le 17/07** et câblée depuis : ce commentaire périmé a failli faire refuser une demande légitime. **Un commentaire périmé ment avec l'autorité du code.** Quand une règle change, corriger TOUTES ses traces dans le même commit — un banc (`propos-verif.js`) interdit désormais le retour de celui de `charts.js`.
- **i18n** : `node scripts/i18n-verif.js` — **désormais dans `npm run check`, avec un CLIQUET** (28/08). Il était le SEUL des 36 bancs que personne ne lançait : la consigne « à passer après tout renommage » était manuelle, et le résultat s'est mesuré — **21 clés orphelines accumulées, dont six traductions réellement mortes**, parmi lesquelles le titre « Fil d'actualité ». Les six sont re-clées (le produit était passé du tutoiement au vouvoiement sans suivre, et deux titres portaient l'apostrophe droite là où le dict avait la typographique — la recherche est EXACTE après trim, un caractère suffit à tuer une traduction). Le plafond `PLAFOND_ORPHELINES` fige le nombre connu : la dette d'hier ne bloque pas, une de plus fait rougir. **Le baisser quand on en traite une**, sinon le cliquet ne cliquette plus. — le dict EN (i18n-dicts.js) est clé par CHAÎNE FR EXACTE : un wording changé = traduction morte EN SILENCE. L'outil liste les clés orphelines ; re-keyer celles des renommages + ajouter les entrées des nouveaux textes statiques dans le même commit.

## Ce que la relecture de code ne voit pas (10/09) — quatre pièges mesurés le même jour

Quatre défauts livrés en production, tous avec un code **correct à la lecture**. Aucun n'était
trouvable en relisant ; tous l'étaient en mesurant. Ils reviendront sous d'autres formes.

- **UNE FONCTION APPELÉE HORS DE SA PORTÉE, et `js-verif` ne peut pas le voir.** `_jrOpenPop`
  appelait `facteurZoom`, déclarée mille lignes plus haut DANS l'IIFE `_aideAuTap`. Au clic :
  `ReferenceError` juste après `appendChild` — la bulle existait dans le DOM, jamais positionnée,
  invisible. Aucune erreur pour l'utilisateur, un menu simplement mort. `js-verif` déduit la
  portée CLIENT des `<script src>` de chaque page, donc **PAR FICHIER** : un identifiant déclaré
  n'importe où dans app.js lui paraît visible partout dans app.js. **Les IIFE lui échappent par
  construction** — ce n'est pas un défaut de l'outil, c'est sa portée. Avant d'appeler une fonction
  partagée depuis un autre endroit du fichier : vérifier qu'aucune IIFE ne se referme entre les
  deux. Contrôle dédié dans `comptes-verif`.
- **DÉPLACER UNE FONCTION PARTAGÉE, C'EST DEUX GESTES.** En remontant `facteurZoom` au premier
  niveau, elle est sortie de la tranche que `tactile-verif` **extrait** pour éprouver la bulle
  d'aide (`indexOf('(function _aideAuTap() {')`). Le banc a rougi sur du code sain, et a FAIT
  ÉCHOUER UN DÉPLOIEMENT. **Une borne d'extraction est un contrat** : un banc qui annonce « le vrai
  code, pas une copie » n'éprouve plus qu'un fragment amputé dès qu'une dépendance sort de sa
  tranche. Après tout déplacement : `grep -n "indexOf('.*<nom de la fonction déplacée>" scripts/`.
- **UN CACHE DURABLE VIT DANS UN VOLUME MONTÉ, PAS DANS L'IMAGE.** Le cache du DMX s'écrivait à
  `/app/cache_myfxbook.json`, sous le commentaire « survives server restart ». Vrai d'un
  redémarrage, **faux d'un déploiement** : `docker-compose.yml` ne monte que
  `/app/.chrome_profile_*` et `/app/data` ; le reste appartient à la couche d'image que
  `docker compose build` reconstruit. Après CHAQUE livraison, le widget repartait sans réserve et
  ouvrait un navigateur à froid — le « chargement infini » signalé, pendant des semaines. Ce défaut
  est invisible en lecture (le chemin est correct) ET en développement (rien ne se reconstruit) :
  il n'apparaît qu'en CROISANT le code et le fichier de composition. Banc : `volume-verif.js`.
- **UNE ANNONCE DATÉE DANS LE FUTUR SE REJOUE INDÉFINIMENT.** Les deux routes du fil DTP écrivent
  `Math.min(u.ts, Date.now())` — une ceinture contre les « il y a » négatifs. Conséquence non
  prévue : une date future est ramenée à MAINTENANT, donc l'annonce se présente comme neuve à
  chaque ouverture et ne sort jamais de la fenêtre de 7 jours. 78 entrées étaient dans ce cas,
  jusqu'à dix-huit jours d'avance ; le fil montrait en permanence des corrections d'il y a deux
  semaines. Redatées depuis git ; `dtp-updates-verif --autotest` refuse désormais la suivante.

⚠️ **ET DEUX ERREURS DE MÉTHODE DU MÊME JOUR, à ne pas refaire :**
1. `npm run check > log 2>&1; echo "code=$?"` rapporte le code de la DERNIÈRE commande, jamais
   celui de la suite. J'ai poussé deux fois sur une suite rouge en croyant lire un vert. **Lancer
   la suite comme commande UNIQUE**, et lire le code de sortie de la tâche.
2. Une hypothèse répétée finit par passer pour un fait. « Le DMX ne marche pas faute d'identifiants
   Myfxbook » a été énoncé pendant deux jours comme s'il était établi ; c'était faux, et la vraie
   cause était ailleurs. **Un symptôme borné deux fois de suite est le signal qu'on n'a pas atteint
   la cause.**

## Skills du dépôt (`.claude/skills/`) — pourquoi ceux-là, et pourquoi pas les autres

Trois skills sont posés DANS LE DÉPÔT, pas dans `~/.claude/`. **C'est le seul endroit durable** :
une session distante tourne dans un conteneur éphémère, tout ce qui est installé dans le dossier
personnel (`npx skills add -g`, `/plugin install`, `pip install`, `curl | bash`) disparaît avec lui.
Ce qui est commité, en revanche, se recharge à chaque session et vaut pour toutes les machines.

| skill | origine | ce qu'il apporte ici |
|---|---|---|
| `hunt` | tw93/Waza | diagnostiquer AVANT de corriger : reproduire, isoler, prouver la cause. C'est la méthode déjà écrite dans ce fichier, encodée. |
| `ui` | tw93/Waza | polissage visuel PILOTÉ PAR CAPTURE — le mode de travail le plus fréquent sur ce desk. |
| `tech-debt-audit` | ksimback/tech-debt-skill | audit de dette cité fichier par fichier, sur 86 000 lignes de JS/CSS servi. Un seul fichier, aucun script. Il porte `disable-model-invocation: true` : il ne part JAMAIS seul, on l'appelle par `/tech-debt-audit`. |
| `frontend-design` | anthropics/claude-code (officiel) | direction esthétique et typographie. COMPLÉMENTAIRE de `ui`, pas redondant : `ui` part d'une capture et corrige ce qu'elle montre, `frontend-design` traite le parti pris visuel. Un fichier, aucun script. |

### Les trois agents vivent AUSSI dans le dépôt (`.claude/agents/`)

Même raison que les skills : le dossier personnel d'une session distante est éphémère. `planner`,
`developer` et `analyst` y sont donc versionnés, dans leur version LONGUE (celle qui porte les
sections « Méthode »), et non celle, plus pauvre, d'une archive de configuration qui traînait.
`planner` et `analyst` reçoivent une restriction `tools:` — le premier en LECTURE SEULE
(`Read, Grep, Glob`), le second sans exécution (`Read, Write, Grep, Glob`).
⚠️ **CONSÉQUENCE À CONNAÎTRE** : `planner` ne peut plus lancer un banc pour éprouver une hypothèse.
C'est le prix d'un agent de conception qui ne peut rien casser par accident ; ce qui doit être
exécuté passe par `developer`, qui garde tous ses outils — il doit écrire ET lancer `npm run check`.

**CE QUI A ÉTÉ ÉCARTÉ, ET POURQUOI — ne pas le réinstaller sans relire ceci :**
- **Waza `check`** : son nom entre en collision avec `npm run check`, qui est LE garde-fou du dépôt.
  Deux « check » de sens différents dans le même projet, c'est une confusion garantie un jour de
  livraison. La revue est d'ailleurs déjà codifiée ici et tenue par une cinquantaine de bancs.
- **Waza `think`** : double l'agent `planner` déjà en place.
- **Waza `learn` / `read`** : couverts par WebFetch et l'agent `analyst`.
- **Waza `health` (14 scripts) et `write` (2 scripts)** : leur fond est tentant — `health` audite
  justement la dérive des instructions, un risque réel ici. Mais ils font entrer du code tiers
  EXÉCUTABLE dans un dépôt où **pousser sur main déploie**. Ça se décide, ça ne se glisse pas.
- **Understand Anything** : `/plugin` n'existe pas dans l'environnement distant, et son `install.sh`
  est un `curl | bash` global, donc éphémère ET non relu.
- **Claude SEO** : il vise l'audit de sites entiers avec un environnement Python et Chromium dédié ;
  la surface publique de DTP est une landing et `/actu`. Disproportionné.
- **Code Review Graph** : recouvre Understand Anything, et son enregistrement MCP est global.
- **shanraisshan/claude-code-best-practice** : base de LECTURE, rien à installer.
- **`commit-commands` (officiel)** : son `/commit` écrit un message générique. La convention d'ici
  est tout l'inverse — message en français, `Co-Authored-By`, entrée `DTP_UPDATES` dans le MÊME
  commit, `npm run check` avant, push sur `origin` ET `backup`. Un raccourci générique produirait
  des commits qui violent les règles de ce fichier.
- **`plugin-dev` (officiel)** : 58 fichiers pour ÉCRIRE des plugins. DTP n'en écrit pas.
- **`superpowers`** : introuvable dans le dépôt officiel des plugins (`anthropics/claude-code`),
  donc non vérifiable. On n'installe pas ce qu'on n'a pas pu lire.
- **`security-guidance` (officiel, non demandé)** : tentant vu l'historique de clé compromise, mais
  il pose des HOOKS Python qui interceptent les appels d'outils et parlent à une API de revue.
  À décider explicitement, jamais à glisser.

⚠️ **DEUX PARTICULARITÉS DES SKILLS WAZA, à connaître avant de s'en étonner :**
1. `hunt` et `ui` demandent de préfixer la première ligne de réponse d'un emoji ninja. Retirer cette
   ligne du `SKILL.md` si le ton ne convient pas — mais un `skills update` la ramènerait.
2. Leurs déclencheurs (`when_to_use`) sont majoritairement en chinois : sur un projet 100 % français
   ils se déclenchent mal. Les invoquer explicitement (`/hunt`, `/ui`) plutôt que d'attendre qu'ils
   partent seuls.

⚠️ **LES `.md` DU DÉPÔT SONT BALAYÉS PAR `pourcent-verif`** (règle « le pourcent se colle au
chiffre »). Un skill tiers contenant « 50 % » ferait rougir `npm run check` et **bloquerait un
déploiement**. Les trois posés ont été vérifiés ; refaire ce contrôle avant d'en ajouter un.

## Bases de données : quatre projets, une quarantaine, et deux minuteurs (02/09)

Les comptes vivent sur **quatre projets Supabase** (`primary` + `db2/db3/db4`, `auth.js`), plus un
**miroir local** (`data/app/users_mirror.json`, volume persistant) qui est le **superset à jour**.

⚠️ **UNE BASE REVENUE NE SERT AUCUNE LECTURE DE `users` AVANT D'ÊTRE RESYNCHRONISÉE.** Mesuré :
`primary` est resté en pause du 14/06 au 02/09 ; sa table portait **29 comptes** quand le desk en
avait **50**, dont 21 à échéance dépassée dans l'instantané de juin. Or `_runMulti` lit le premier
nœud au résultat NON VIDE, et `primary` est le premier de la liste : à son retour il aurait servi
des mots de passe et des échéances de juin — et `verifyLogin` aurait **recopié** cette ligne périmée
dans le miroir (`_mirrorPut`), détruisant la bonne. `_markDown` pose donc `node.quarLect` ; seule
`_usersConverge` la lève, après propagation réussie. Les **écritures** ne sont pas quarantainées :
c'est par elles que le rattrapage passe. Toutes en quarantaine → `NODESDOWN` → repli miroir, donc le
pire cas est l'état le plus sûr. Banc : `scripts/bases-verif.js` (dans `npm run check`).
Le panneau admin affiche « RESYNCHRO… » pendant ce temps, au lieu d'un « OK » trompeur.

⚠️ **LA QUARANTAINE NE COUVRAIT QUE `users` — DEUX AUTRES TABLES SAIGNAIENT PAR LE MÊME TROU (03/09).**
Mesuré sur la base principale au lendemain de sa sortie de pause :
- **`chat_messages`** y porte **71 messages, 26 fils, arrêtés au 14/06** — le jour de la pause. Cette
  table n'est **pas** dual-écrite (ids AUTO, divergents d'une base à l'autre) : chaque message vit sur
  UNE base. Avant le 14/06 tout allait sur la principale, après, tout sur db2 → **deux moitiés
  DISJOINTES**, dont aucune n'est le superset de l'autre. Or la lecture s'arrêtait au premier nœud au
  résultat **non vide** : la principale répondait « 26 fils de juin », **db2 n'était jamais
  interrogée**. La boîte de réception du support affichait juin. Rien n'était perdu ; tout était caché
  — du point de vue du client, c'est identique. → `_TABLES_UNION` : la lecture **réunit** les nœuds
  (`_lireUnion`), l'écriture est **diffusée** (sans quoi « marquer lu » ne réparerait qu'une moitié et
  le badge ne retomberait jamais à zéro ; `chatDeleteByUser` laissait carrément les messages d'un
  compte supprimé sur les autres bases). **L'INSERT ne se diffuse pas** — il créerait quatre
  exemplaires du même message.
  ⚠️ **NE PAS « DÉDOUBLONNER » LA RÉUNION.** `chatThreads` lit `select('user_id')` sur les non-lus :
  une ligne PAR message, toutes réduites au seul `user_id`, donc **identiques entre elles**. Les
  fusionner ramènerait un badge de 3 à 1. Et le doublon n'existe pas : aucun chemin n'écrit deux fois
  le même message. On ne se protège pas d'un risque absent au prix d'un compteur faux.
- **`ai_cache`** y porte **`journal:1` daté du 14/06** — le modèle JOT d'un client. Celle-ci EST
  dual-écrite, donc une clé **réécrite** depuis converge seule ; mais un modèle qu'on ne modifie plus
  reste figé à juin sur la base revenue, et le **tour de rôle** rendait tantôt juin tantôt septembre.
  Le même client voyait son modèle changer d'une visite à l'autre. `created_at` était stocké **depuis
  toujours** : personne ne le relisait. → `_TABLES_FRAICHEUR` : la ligne **la plus récente** gagne
  (`_lireFraicheur`), et `aiCacheGet` sélectionne `value, created_at` — sans la date, il n'y a rien à
  arbitrer. Repli explicite : une requête sans colonne de date (la sonde `select('key')`) retombe sur
  le premier non vide, à l'identique.

Banc : `scripts/union-verif.js` (26 contrôles, dans `npm run check`) — il rejoue **le scénario mesuré**
(base figée en juin face à base à jour) sur le VRAI `_runMulti` extrait d'`auth.js`, et ses deux
contrôles négatifs mordent **chacun séparément**. Vider `_TABLES_UNION` dans `auth.js` fait rougir 9
contrôles : le banc lit bien le fichier, il ne récite pas sa propre copie.

⚠️ **UNE LECTURE NE RÉVOQUE JAMAIS UN ACCÈS — L'INCIDENT QUI A COÛTÉ UN ABONNEMENT PAYÉ (03/09).**
Le 30/08, un abonnement réglé par virement est prolongé À LA MAIN au 30/09 depuis le panneau admin.
`primary` est alors EN PAUSE : l'écriture part sur db2 + le miroir, **correctement**. Le 02/09
`primary` revient, figée au 14/06. Le panneau admin est ouvert ce jour-là : `getAllUsers` lit la
**première base saine** — celle qui vient de revenir — et passe ses 29 lignes de juin à
`_mirrorPutMany`. La fusion était `{ ...prev, ...row }` : **la lecture écrase le miroir**. Le 30/09
devient le 11/06, puis `_usersConverge` propage ce miroir corrompu vers **les quatre bases**. Le
client se voit refuser la connexion trois semaines après avoir payé, sans qu'aucune trace ne le dise.
La quarantaine de lecture ferme ce chemin **depuis le 02/09 au soir — quelques heures trop tard**,
et elle ne couvre pas tout : un compte connu du miroir **sans son `password_hash`** n'est jamais
propagé par la convergence (`all` ne prend que les comptes complets) alors que la quarantaine du
nœud, elle, **se lève** — sa ligne périmée survit donc en base.
**LA RÈGLE, indépendante de la quarantaine** : `_mirrorPut` est le chemin des **LECTURES** ; les
écritures (`updateUser`, `setPassword`, `createUser`) touchent le miroir **directement**. Une lecture
qui **raccourcit** `expires_at` ou passe `active` à `false` est donc **par construction** une lecture
périmée. On laisse passer ce qui étend, on refuse ce qui retire, **et on le trace** (sans trace,
personne n'apprend qu'une base a pris du retard). Portée limitée **à dessein** à ces deux champs :
`plan` et `role` changent ce qu'on voit, pas si l'on entre.
⚠️ **CORRIGER UNE ÉCHÉANCE EN SQL DIRECT NE SERT À RIEN** : la convergence repousse le **miroir**
vers les bases, donc la valeur écrite à la main serait écrasée au passage suivant. Le seul chemin
efficace est le **panneau admin** (`updateUser` → nœud sain + miroir → convergence).
Banc : `scripts/miroir-verif.js` (14 contrôles, dans `npm run check`) — il rejoue le 30/09 contre le
11/06 sur le VRAI `_mirrorPut`, avec les témoins inverses (un vrai renouvellement doit passer, une
réactivation aussi, un miroir vide doit tout réapprendre). Neutraliser la garde dans `auth.js` fait
rougir 4 contrôles.

⚠️ **POURQUOI LA PAUSE EST ARRIVÉE, ET CE QUI L'EMPÊCHE DE REVENIR.** Le keep-alive vivait
UNIQUEMENT dans GitHub Actions, avec des secrets **jamais posés**, et sa branche « aucun projet
configuré » rendait **0**. Bilan : 142 passages verts, zéro ping, deux mois et demi de pause sous
une coche verte quotidienne. Corrigé en trois points :
1. le script **sort en erreur** quand il n'a rien à pinguer (`scripts/supabase-keepalive.js`) ;
   ⚠️ **ET LE JOB CI NE DÉMARRE PLUS SANS CLÉ (03/09)** — la correction ci-dessus était juste et
   **bruyante** : le job GitHub, dont les secrets n'ont jamais été posés, envoyait dès lors un
   courriel d'échec à CHAQUE passage, pour une situation connue et assumée (la vraie tâche tourne sur
   le VPS). Un signal d'alerte qu'on apprend à ignorer ne protège plus rien : c'est la même maladie
   que le faux vert, dans l'autre sens. Le job est donc **ignoré** tant qu'aucune clé n'est posée, ce
   qui ne notifie personne et ne prétend rien ; il se réarme tout seul le jour où un secret est posé.
   **Le SCRIPT, lui, garde son échec bruyant** : c'est sur le VPS qu'il doit hurler, puisque c'est là
   qu'il est censé marcher. On désarme le doublon, jamais la garde.
   ⚠️⚠️ **ET LA PREMIÈRE ÉCRITURE DE CETTE GARDE A EMPIRÉ LE MAL (04/09)** — elle mettait
   `secrets.SUPABASE_URL != ''` dans l'`if:` **du JOB**. Or GitHub **n'expose pas** le contexte
   `secrets` à cet endroit : il n'existe qu'au niveau des **étapes** et des **`env:`**. Un tel `if:`
   ne saute donc pas le job, il rend le **FICHIER INVALIDE** — et un fichier invalide ne se tait pas :
   GitHub crée un passage **ROUGE, sans le moindre job, à CHAQUE poussée sur main**. Mesuré sur les
   passages 157 à 161 : tous en échec, zéro job, `created_at` = `updated_at`, et le passage portant le
   **chemin** du fichier au lieu de son `name:` (la marque d'un fichier jamais lu). On voulait retirer
   un courriel d'échec quotidien, on en avait ajouté **un par poussée**. Forme correcte : le secret
   est lu dans un **`env:` de job** (`DTP_CLE_POSEE`), et ce sont les **ÉTAPES** qui portent le `if:`.
   Banc : `deploiement-verif.js` balaie **tous** les workflows et refuse un `if:` de job qui lit
   `secrets` (avec son témoin, et il mord : remettre la forme fautive le fait rougir).;
2. il tourne **depuis le VPS**, où les clés vivent déjà — plus de second endroit à tenir à jour ;
3. il **relance** un projet en pause via l'API de gestion, mais **uniquement** sur un statut
   `INACTIVE` (un ping raté peut venir du réseau, d'un 402 ou du DNS). Jeton `SUPABASE_ACCESS_TOKEN`,
   par nœud au besoin (`_2/_3/_4` : un jeton n'a de droits que sur ses organisations).

⚠️ **LA SAUVEGARDE NOCTURNE N'AVAIT JAMAIS PRODUIT UNE SEULE ARCHIVE (trouvé le 03/09).**
`exporterTable(client, t)` lit `t.nom` — et on l'appelait avec `t.nom`. La table demandée à Supabase
était donc littéralement `undefined` ; `users` étant `obligatoire: true`, l'export sortait en erreur,
et `dtp-sauvegarde.sh` s'interrompt alors sans produire d'archive. **Même forme d'échec que le
keep-alive** : une tâche qui a l'air installée et ne fait rien. Prouvé en JOUANT la vraie fonction
avec un client espion — une relecture ne voit pas ce défaut, les deux lignes sont justes séparément.
⚠️ **ET ELLE NE COUVRAIT PAS CE QUE LES CLIENTS PRODUISENT.** `TABLES` portait `users`, `email_log`,
`weekly_reports` — **ni `chat_messages` (les conversations du support), ni `ai_cache`** (les modèles
JOT `journal:<compte>`, les avatars, `symrecent:`, les réactions). C'est-à-dire exactement ce que
l'utilisateur a cru perdre. Les deux sont ajoutées. Tailles mesurées le 03/09 : `ai_cache` 1,4 Mo /
428 lignes, `chat_messages` 832 Ko — l'accumulation en mémoire reste sans risque à 512 Mo.
Banc : `scripts/sauvegarde-verif.js` (16 contrôles, dans `npm run check`).

⚠️ **DEUX MAGASINS NE VIVAIENT QUE DANS UN FICHIER : la liste noire et les pierres tombales.**
De tous les magasins d'`auth.js`, c'étaient les **seuls** sans contrepartie en base (`users` a son
miroir + convergence ; `ai_cache`/`weekly_reports`/`email_log` sont dual-écrits ; `chat_messages` est
réuni à la lecture). Volume perdu → il ne restait que les 2 adresses du seed en dur, donc **un banni
pouvait se recréer et un compte supprimé revenir**, sans aucun signal (le fichier repartait valide,
simplement vide). → Déposés dans `ai_cache` (`auth:blacklist`, `auth:tombstones`) : **quatre copies
au lieu d'une**, sans nouvelle infrastructure, et dans l'archive depuis que `ai_cache` y est exporté.
C'est le motif déjà employé pour `chat:reactions`. **En cas de désaccord fichier/base, on UNIT** —
donc on garde le bannissement : le coût de cette erreur est un message de support, celui de l'erreur
inverse est la raison d'être de la liste. Le **seed**, lui, ne se réinjecte toujours pas quand le
fichier existe (décision antérieure : un retrait via l'admin doit persister).

⚠️ **`_ECHEANCES_SEED` — LA RÉPARATION D'UN ABONNEMENT EFFACÉ, ET POURQUOI PAS DU SQL.** Corriger une
échéance directement en base **ne tient pas** : `_usersConverge` repousse le **miroir** vers les
bases, la valeur écrite à la main serait écrasée au passage suivant. La réparation passe donc par le
miroir. Sûreté : **on allonge, jamais on ne raccourcit** — donc idempotent, jamais en contradiction
avec une prolongation ultérieure faite au panneau, et **incapable de révoquer un accès**, qui est le
défaut même qu'elle répare. Ce n'est **pas** un mécanisme de gestion d'abonnements : le panneau reste
le seul endroit. Banc : `scripts/durabilite-verif.js` (32 contrôles), qui **exécute** la fonction ET **charge le
module** — un banc qui LIT le source ne voit ni une zone morte, ni un appel fait trop tôt.

⚠️ **« COMPLETS UNIQUEMENT » ÉCARTAIT DÉFINITIVEMENT LES COMPTES EXPIRÉS (03/09).** `_usersConverge`
ne propageait que les comptes dont le miroir connaît l'**empreinte** — règle juste (`password_hash`
est NOT NULL), assortie d'une promesse qui **ne pouvait pas être tenue** : « les autres seront
propagés dès qu'ils transitent (login/lecture) ». L'empreinte n'entre au miroir que par une
**CONNEXION** (la liste admin est une projection sans hash) — or un abonné **expiré** ne peut
justement plus se connecter. Son compte était donc exclu de toute convergence **pour toujours**.
→ La distinction qui débloque : **un INSERT a besoin du hash, un UPDATE non.** Les comptes sans
empreinte passent par une **mise à jour seule**, charge **sans `password_hash`** (ni effaçable ni
écrasable), **jamais** de création, orphelins **signalés**, et leur échec **ne retient pas** la levée
de quarantaine — sans quoi on rejouerait le défaut qu'on vient de fermer.

⚠️ **LA RÉPARATION D'ÉCHÉANCE VÉRIFIAIT SON PROPRE BROUILLON.** Son test d'idempotence lisait le
**miroir** pour décider s'il y avait à faire, alors que c'est la **base** qu'elle répare : une
première version ayant mis le miroir à jour, la suivante a conclu qu'il n'y avait rien à faire
pendant que la base restait en retard. **Une réparation qui vérifie son brouillon plutôt que sa cible
ne répare rien, et se tait en le faisant.** On écrit donc même quand le miroir est bon (même valeur =
sans effet) ; seul un `>` strict fait taire. Et l'idempotence, au banc, n'est **pas** « n'écrit
rien » — c'est **« ne dérive pas »**.

⚠️ **LA SYNCHRO WHOP NE FAIT QU'ALLONGER — ET C'EST ELLE QUI EXPLIQUE LE CAS ANIS.** `_whopReconcile`
tourne au boot + toutes les 10 min et **prolonge** un compte en retard sur Whop, jamais ne le
raccourcit (on ne coupe pas un payeur sur un doute). **Un abonnement Whop se répare donc tout seul ;
un abonnement réglé par VIREMENT n'a aucune source externe** — c'est pourquoi la prolongation d'Anis,
effacée le 02/09, est restée cassée. Son état s'affiche désormais dans le panneau admin à côté des
bases : il tournait depuis toujours sans qu'aucun écran ne le montre.

```bash
cd /opt/datatradingpro && bash scripts/vps-resilience-installer.sh   # UNE fois, pose les 2 minuteurs
```
Sauvegarde **04h10**, archive **chiffrée**, **3 versions** (`DTP_BACKUP_GARDER` pour surcharger) ;
keep-alive **toutes les 6 h**. Les deux en `Persistent=true` : un redémarrage ne fait pas sauter un
passage. La sauvegarde embarque l'export de la base et **refuse une archive sans `dump/users.json`**.
Banc : `scripts/resilience-verif.js` — il EXÉCUTE le keep-alive pour vérifier son code de sortie.
⚠️ La phrase secrète des archives doit **aussi** vivre hors du serveur : archive et clé sur le même
disque ne protègent de rien.

## Design : High-Density Fintech HUD
- Fond sombre **`#0c0c0e`** / `#0a0a0c`, dense (cockpit / salle de marché), mais **habillage landing** : **accents or**, titres **Fraunces** (serif) / **Inter Tight**, cartes à **coins doux** (`--radius` = `6px`) + bordures fines + **hover doré** sur les cartes. Garder la **densité HUD** dans l'habillage or propre à DTP.
- Lignes de séparation fines : `border-b` très sombre (≈ `neutral-900/60`, token `--hud-line`).
- **Pas de dialogs natifs** (confirm/prompt/alert) → confirmations/édition **inline**.
- **Volatilité** : historique de chat, position du splitter orange, etc. = **purement volatils**, reset au reload (**pas de localStorage**). **Exception validée par l'utilisateur** : l'historique « Recent Searches » de la recherche symbole (desk) **PERSISTE PAR COMPTE** → source de vérité = KV Supabase `symrecent:<userId>` (endpoints `GET/POST /api/sym-recent`), récupéré au chargement (suit la reconnexion, même sur un autre appareil) ; `localStorage` (clé `dtp_sym_recent`) = simple cache instantané. Ne PAS le re-rendre volatil.

## Tokens sémantiques — états de marché (charte immuable)
- **BUY / UPTREND / BULLISH** → vert émeraude vif `#00e676` (ou `#00cc99` turquoise selon contexte).
- **SELL / DOWNTREND / BEARISH** → rouge vif d'alerte `#ff3d00`.
- **NEUTRAL** → jaune-orange doré `#ffb300` (ou gris anthracite mat selon le composant).
- **Or signature : `#e3b23a` (vif) / `#b8860b` (sombre)**. Risk-off rouge : `#ef4444`. Risk-on vert : `#22c55e`.
- Currency Strength Meter : **couleurs de marque DTP** — vert `#00e676` / `rgba(0,230,118,…)`, rouge `#ff3d00` / `rgba(255,61,0,…)`. Garder l'**ergonomie** (égaliseur bidirectionnel) avec un **visuel propre à DTP**.

## Composants clés
- **Splitter or synchrone** : layout parent en **CSS Grid** `grid-template-columns: minmax(0,1fr) 1px var(--sidebar-w)` (le `1fr` recalcule à la même frame que la souris → zéro décalage). Barre orange isolée des scrollbars. `pointer-events:none` sur les enfants pendant le drag. Reset au reload.
- **Currency Strength Meter** : égaliseur segmenté bidirectionnel, axe central (zéro), vert vers le haut / rouge vers le bas. Trame éteinte toujours visible (jamais « vide »). (Under-glow ambre retiré : l'utilisateur n'en voulait pas.)
- **Macro AI Assistant** (volet droit) : avatar = **`/assets/images/macro-ai-spark.svg`** (visuel DTP, produit pour le desk ; le PNG téléchargé chez un tiers a été supprimé le 21/08). État **« L'IA écrit… »** (avatar + 3 points gris qui rebondissent) avant le texte. **Streaming typewriter** caractère par caractère (markdown tolérant aux `**` non fermés). Accordéon **`> N sources used`** orange + heure → **uniquement à la fin** du streaming. Input : icônes pièce jointe + textarea + envoi orange plein, **Entrée = envoi / Shift+Entrée = nouvelle ligne**. Backend `/api/ai/chat` (Gemini→Claude + contexte Smart Bias/news + cache). Volatil.
- **Analyst Report Viewer** : envoie le texte de `sessionwrap` au backend, attend un JSON **dynamique** : `aiInsights` = tableau d'objets `{ asset, signal, text }` (badges BUY vert / SELL rouge / NEUTRAL ambre, pas de badge si `signal` null) ; `sessionContent` = objet à **clés dynamiques** (titres détectés : `IRAN CONFLICT`, `EQUITIES`, `FX`…) parcouru en `.map()` → titres en **MAJUSCULES or `#e3b23a`**. Markdown léger : gras auto sur chiffres/%/tickers. **Préchauffé** (segmentation IA en cache) → ouverture instantanée.
- **Research Directory** (catalogue Analyst) : barre de recherche + 2 dropdowns, cartes feed (icône globe bleue, titre, bookmark, tags arrondis + `+N`, badge `PT` + date mono), pied « Showing N of N research papers ».
- **Smart Bias Tracker** (onglet BIAS — haute densité, architecture bidirectionnelle ; **ergonomie dense de salle de marché, apparence propre à DTP**) :
  - **Matrice supérieure (high-density grid)** : en-têtes de colonnes = **micro-drapeau circulaire** (`w-3.5 h-3.5 rounded-full object-cover`, vanilla : 14px rond) **à gauche** du code devise, alignés `flex items-center gap-1.5 justify-center`. Cellules **collées** (aucun gap/padding large), séparées par une **fine bordure 1px anthracite `#111113`** (`border-b border-r`). **Couleurs sémantiques** (fond + texte blanc) : Very Bullish `#047857` · Bullish `#059669` · Neutral `#6b7280` · Bearish `#dc2626` · Very Bearish `#991b1b` — **palette de marque DTP** (sémantique vert→rouge).
  - **Panneau inférieur rétractable & redimensionnable** : clic sur une cellule **ou** un en-tête devise (ex. GBP) → le layout se divise et fait apparaître le **Bias Summary Panel** sous la table. **Splitter vertical 1px** (`bg-neutral-900`, `cursor-col-resize`, `onMouseDown` → recalcul largeurs gauche/droite) entre le volet badges (gauche) et le texte IA (droite).
  - **Volet GAUCHE (accordéons)** : liste verticale d'indicateurs. **Fundamental Data** et **Bank Overview** = **accordéons cliquables** (micro-flèche rotative `>`/`v`). Ouverts → sous-indicateurs enfants (Fundamental : Economic Growth, Rising Prices, Consumer Confidence, Factory Activity, Service Activity, New Homes Started, Building Permits, Retail Sales · Bank Overview : Goldman Sachs, ING, Nomura…) **décalés `pl-6`**, texte estompé `text-zinc-500`. Chaque ligne finit par son **badge rectangulaire 64px** (`w-16`). Volet en **scroll interne** : `h-full max-h-[450px] overflow-y-auto custom-scrollbar`.
  - **Volet DROIT (narratif IA + calendrier)** : analyse textuelle IA (**générée auto chaque samedi minuit**, cachée) `.summary-content text-zinc-300 text-xs leading-relaxed`. En dessous : **Key Risk Events for the Week Ahead** = lignes jours `bg-[#121214]/40 border border-neutral-900/60 p-2 rounded flex justify-between text-xs` + badge d'impact **LOW / MED / HIGH** (réutilise les données calendrier / Week Ahead).
  - **Header du panneau (haut-droite)** : 2 dropdowns compacts = **sélecteur de devise active** (avec micro-drapeau) + **sélecteur d'historique de dates** au format `1-7/06/2026` (**format DTP**, ex. `1–7 juin 2026`).

## Volets latéraux (Drawer Navigation)
- Déclencheurs = icônes topbar haut-droite : **AI** (chat macro), **Onde** (Live Market Squawk), **Cloche** (Notifications), **Bulle** (Support « Mike »).
- **Les volets se calent SOUS la topbar** : `top: var(--topbar-h)` + `height: calc(100dvh - var(--topbar-h))`. **Jamais `top:0`** (sinon ils recouvrent la navbar et bloquent les icônes).
- **Un seul volet ouvert à la fois** (exclusion mutuelle) ; rouvrir/croix → fermé.
- **Rideau flouté** : un backdrop sous la topbar floute+assombrit le dashboard (`backdrop-filter: blur(6px)` + voile sombre) tandis que la topbar reste nette et cliquable.
- **Base commune** : `absolute right-0`, fond `#0c0c0e`, bordure gauche `#1c1c20`, header (titre + état à gauche, croix grise à droite), séparateurs de dates centrés (`lundi 20 avril 2026` au milieu d'une ligne fine), input identique au chat IA.

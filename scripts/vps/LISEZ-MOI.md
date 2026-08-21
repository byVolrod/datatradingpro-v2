# Déploiement du serveur : ce qu'il faut savoir avant d'y toucher

## Le dépôt est PRIVÉ depuis le 21/08/2026 — conséquence directe sur le déploiement

Tant que `datatradingpro-v2` était public, le serveur récupérait le code par **HTTPS anonyme**.
Cela masquait une incohérence : le script de déploiement était écrit pour SSH (il pose
`GIT_SSH_COMMAND` avec `/root/.ssh/dtp_deploy`) alors que l'URL du dépôt, elle, était en HTTPS.

Le jour où le dépôt est passé en privé, le serveur s'est arrêté net sur :

```
fatal: could not read Username for 'https://github.com'
```

**Le site continuait de tourner** — il servait simplement la dernière version construite — mais
plus aucune mise à jour ne pouvait l'atteindre. C'est le pire genre de panne : silencieuse.

**Règle : les remotes du serveur doivent rester en SSH.**

```bash
git remote set-url origin git@github.com:byVolrod/datatradingpro-v2.git
git remote set-url backup git@github.com:byVolrod/datatradingpro-v2-backup.git
```

La clé de déploiement `dtp-server-deploy` est enregistrée côté GitHub depuis le 05/06/2026 ; la
clé privée correspondante est `/root/.ssh/dtp_deploy`. Rien d'autre n'est à installer.

## Un historique RÉÉCRIT casse un `git fetch` ordinaire

Le 21/08, la réécriture des messages de commit a produit un historique non linéaire. Le script
faisait alors `git fetch origin main`, **sans le `+`**. Résultat : le serveur a refusé la mise à
jour et a répondu `fetch KO`, en restant bloqué sur l'ancienne version.

Le script force désormais la référence de suivi :

```bash
git fetch --force --prune origin '+refs/heads/main:refs/remotes/origin/main'
```

Le dépôt du serveur n'est qu'un **miroir de déploiement** : il n'a aucun travail propre à
protéger, il doit suivre le distant sans condition. Le `git reset --hard origin/main` qui suit
était déjà robuste, lui.

⚠️ Piège d'amorçage rencontré : le script durci ne pouvait pas s'installer lui-même, puisque
l'ancien échouait **avant** d'arriver à la recopie. Il a fallu débloquer à la main une fois. Si
cela se reproduit, la séquence est :

```bash
cd /opt/datatradingpro
export GIT_SSH_COMMAND="ssh -i /root/.ssh/dtp_deploy -o IdentitiesOnly=yes"
git fetch --force --prune origin '+refs/heads/*:refs/remotes/origin/*' '+refs/tags/*:refs/tags/*'
git reset --hard origin/main
cp -f scripts/vps/dtp-deploy.sh /usr/local/bin/dtp-deploy.sh && chmod +x /usr/local/bin/dtp-deploy.sh
/usr/local/bin/dtp-deploy.sh --force
```

## Un seul déployeur, et il se met à jour tout seul

Deux tâches planifiées déployaient autrefois en parallèle (toutes les 2 min et toutes les 5 min)
sur le **même conteneur**. Docker renomme l'ancien conteneur avant de le remplacer ; quand le
second processus le supprimait pendant ce temps, le remplacement échouait et le service restait
à terre. C'est l'origine des **502 Bad Gateway**. Les deux anciens scripts sont neutralisés
(`.desactive-20260821`), remplacés par un seul appel verrouillé par `flock`.

`/usr/local/bin/dtp-deploy.sh` se recopie depuis `scripts/vps/dtp-deploy.sh` dès qu'il en
diffère : **modifier la version du dépôt suffit**, il n'y a rien à installer à la main.

## Le disque

23 Go au total, ~84 % occupés au 21/08. Chaque build laisse une image intermédiaire, d'où le
`docker image prune -f` en fin de script. Sans lui, c'est le disque plein qui finit par empêcher
tout déploiement.

---

## Migrer vers un serveur neuf : une seule commande

```bash
DTP_BACKUP_PASS='votre-phrase' ./scripts/vps/dtp-migrer.sh <ip-du-nouveau-serveur>
```

Le script fait tout : sauvegarde fraîche sur l'ancien serveur, rapatriement, vérification de
l'archive **avant** de toucher la cible, installation des prérequis, code, secrets, données,
démarrage, puis attente de la santé **réelle**. Dix garde-fous : il refuse d'avancer plutôt que
de laisser une machine à moitié montée.

⚠️ **Il ne bascule JAMAIS le DNS.** C'est le seul geste vraiment irréversible de la migration :
le temps de propagation échappe à tout le monde. Le script vérifie la nouvelle machine **par son
IP**, en lui présentant le bon nom d'hôte via `curl --resolve`, puis s'arrête en affichant quoi
faire. Tant que le DNS n'est pas basculé, l'ancien serveur continue de servir : on peut tout
recommencer sans que personne ne s'en aperçoive.

## Sortir les sauvegardes de la machine

```bash
./scripts/vps/dtp-rapatrier.sh
```

⚠️ Une archive qui reste sur le serveur ne protège de **rien** : si la machine disparaît, l'archive
disparaît avec elle. Le script ne télécharge que ce qui manque et **vérifie la taille après
transfert** : un `scp` interrompu laisse un fichier tronqué, qui a l'air d'une sauvegarde et n'en
est pas. Le découvrir le jour de la panne serait le pire moment.

## Sauvegarde quotidienne automatique

Pour que la sauvegarde existe sans qu'on y pense, ajouter à la crontab du serveur :

```
0 4 * * * DTP_BACKUP_PASS='votre-phrase' /usr/local/bin/dtp-sauvegarde.sh >> /var/log/dtp-sauvegarde.log 2>&1
```

⚠️ **Sur la phrase secrète dans la crontab.** Elle protège l'archive *là où celle-ci va se
retrouver* : sur une autre machine, un disque externe, un espace de stockage. Elle ne protège pas
contre quelqu'un qui posséderait déjà le serveur — celui-ci contient de toute façon le `.env` en
clair, avec les quatre-vingts clés. La poser dans la crontab n'ajoute donc **aucune exposition
nouvelle**, et c'est le prix d'une sauvegarde qui se fait toute seule.

Ce qui compte, en revanche : la phrase doit **aussi** vivre dans votre gestionnaire de mots de
passe. Si elle n'existe que sur le serveur et que le serveur disparaît, les archives deviennent
illisibles — et l'on aura sauvegardé pour rien.

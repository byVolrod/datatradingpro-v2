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

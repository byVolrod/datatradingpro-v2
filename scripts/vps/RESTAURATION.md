# Reconstruire DataTradingPro sur un serveur neuf

Procédure complète, de la machine vide au site en ligne. Écrite pour être suivie **en pleine
panne**, quand on n'a ni le temps ni le calme de deviner.

---

## Ce qui existe, et où

| Élément | Où il vit | Reconstructible ? |
|---|---|---|
| **Le code** | GitHub `byVolrod/datatradingpro-v2` (+ miroir `-backup`) | oui, `git clone` |
| **Les ~80 clés** (`.env`) | **UNIQUEMENT sur le serveur** → dans l'archive | **NON** |
| **La base de données** | Supabase, répliquée db2/db3/db4 | hors serveur, rien à restaurer |
| **nginx + certificats** | serveur → dans l'archive | oui, mais des heures perdues |
| **Anti-doublon e-mails + désinscrits** | `data/app/cache_email_log.json` → archive | **NON** |
| **Historique du fil** | `data/app/news_history.json` → archive | non (le fil repartirait vide) |
| **Installeurs desktop** | `/opt/dtp-downloads` | oui, à reconstruire depuis les sources |
| **Caches IA, traductions, PDF, profils Chrome** | serveur | oui, se régénèrent |

⚠️ **La phrase secrète de l'archive n'est nulle part sur le serveur.** Elle doit vivre dans votre
gestionnaire de mots de passe. Sans elle, l'archive est un bloc inutile : c'est le prix du
chiffrement, et c'est voulu : elle contient toutes vos clés.

---

## Avant la panne : faire une sauvegarde et la SORTIR de la machine

```bash
# Sur le serveur : la phrase secrète n'est jamais ecrite sur le disque.
DTP_BACKUP_PASS='votre-phrase-secrete' /usr/local/bin/dtp-sauvegarde.sh
```

Puis, **depuis votre machine** (une sauvegarde restée sur le serveur ne protège de rien : si la
machine disparaît, elle disparaît avec) :

```bash
scp -i ~/.ssh/dtp_deploy -o IdentitiesOnly=yes \
    root@149.71.44.90:/root/sauvegardes/dtp-*.tar.gz.gpg \
    "C:/Users/muham/Documents/WEB/_sauvegarde-dtp/"
```

Le script **relit l'archive avant de la déclarer bonne**, et la supprime si elle ne se relit pas :
mieux vaut aucune sauvegarde qu'une sauvegarde en laquelle on croit à tort.

---

## Restaurer sur une machine neuve

### 1. Les bases du système

```bash
apt update && apt install -y git docker.io docker-compose-plugin nginx certbot python3-certbot-nginx gnupg
systemctl enable --now docker
```

### 2. Ouvrir l'archive

```bash
mkdir -p /root/restauration && cd /root/restauration
gpg --decrypt dtp-AAAAMMJJ-HHMM.tar.gz.gpg | tar -xzf -
cd dtp-AAAAMMJJ-HHMM
cat MANIFESTE.txt          # dit ce qu'il y a dedans ET ce qui n'y est pas
```

### 3. Le code

⚠️ **Le dépôt est PRIVÉ** : le clonage anonyme ne marche pas. Il faut la clé de déploiement, qui
est dans l'archive.

```bash
mkdir -p /root/.ssh && cp config/cle-deploiement /root/.ssh/dtp_deploy && chmod 600 /root/.ssh/dtp_deploy
export GIT_SSH_COMMAND="ssh -i /root/.ssh/dtp_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
# ⚠️ --depth 1 : le serveur est un MIROIR DE DEPLOIEMENT, il n’a aucun besoin de l’historique.
# Mesure : l’historique complet pese 1 070 Mo, le dernier etat 38 Mo. C’est 28 fois moins a
# telecharger, sur une machine qu’on remonte dans l’urgence.
git clone --depth 1 --branch main git@github.com:byVolrod/datatradingpro-v2.git /opt/datatradingpro
cd /opt/datatradingpro
```

Si la clé a été perdue avec l'ancienne machine : en générer une neuve (`ssh-keygen -t ed25519`) et
l'ajouter comme *deploy key* dans les réglages du dépôt sur GitHub.

### 4. Les secrets et la configuration

```bash
cp /root/restauration/dtp-*/config/env /opt/datatradingpro/.env && chmod 600 /opt/datatradingpro/.env
cp /root/restauration/dtp-*/config/docker-compose.yml /opt/datatradingpro/ 2>/dev/null
cp -a /root/restauration/dtp-*/config/nginx-sites-available/* /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/datatradingpro /etc/nginx/sites-enabled/
cp -a /root/restauration/dtp-*/config/letsencrypt/* /etc/letsencrypt/
nginx -t && systemctl reload nginx
```

### 5. Les données irremplaçables

```bash
mkdir -p /opt/datatradingpro/data/app
cp -a /root/restauration/dtp-*/donnees/* /opt/datatradingpro/data/app/
```

⚠️ **Ne pas sauter cette étape.** Sans `cache_email_log.json`, le serveur croit n'avoir jamais
rien envoyé : il réexpédie les campagnes **et** perd la liste des désinscrits.

### 6. Le déploiement automatique

```bash
cp /opt/datatradingpro/scripts/vps/dtp-deploy.sh /usr/local/bin/ && chmod +x /usr/local/bin/dtp-deploy.sh
cp /opt/datatradingpro/scripts/vps/dtp-sauvegarde.sh /usr/local/bin/ && chmod +x /usr/local/bin/dtp-sauvegarde.sh
crontab /root/restauration/dtp-*/config/crontab.txt
```

⚠️ Vérifier que les remotes sont bien en **SSH** : en HTTPS, un dépôt privé donne
`could not read Username`, et c'est une panne silencieuse (voir `LISEZ-MOI.md`) :

```bash
git -C /opt/datatradingpro remote set-url origin git@github.com:byVolrod/datatradingpro-v2.git
git -C /opt/datatradingpro remote set-url backup git@github.com:byVolrod/datatradingpro-v2-backup.git
```

### 7. Démarrer, puis VÉRIFIER

```bash
cd /opt/datatradingpro && docker compose up -d --build
for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' datatradingpro 2>/dev/null)
  [ "$s" = "healthy" ] && break; sleep 3
done
echo "sante : $s"
curl -s -o /dev/null -w 'desk local : %{http_code}\n' http://127.0.0.1:3000/healthz
```

Puis, **depuis l'extérieur** : c'est la seule vérification qui compte :

```bash
curl -s -o /dev/null -w 'connexion : %{http_code}\n' https://desk.datatradingpro.com/login
```

### 8. Le DNS

Si l'adresse IP a changé, faire pointer `datatradingpro.com` et `desk.datatradingpro.com` sur la
nouvelle. Tant que le DNS n'a pas propagé, tout le reste peut être parfait sans que personne ne
voie le site.

### 9. Les installeurs desktop

`/opt/dtp-downloads` n'est pas dans l'archive (~520 Mo reconstructibles). Sans lui, l'application
de bureau ne peut plus se mettre à jour. Reconstruire (`cd desktop && npm run build:win`) puis
déposer `DataTradingPro-Setup.exe`, son `.blockmap` et `latest.yml` : **le manifeste en dernier**,
voir la fiche mémoire de l'application desktop.

---

## Ce qui n'est PAS couvert, et qu'il faut savoir

- **Supabase.** Les données vivent là-bas. Si les projets Supabase disparaissent, cette procédure
  ne les ramène pas. La redondance db2/db3/db4 est votre filet de ce côté.
- **Whop.** Abonnements et paiements sont chez eux ; le desk s'y resynchronise au démarrage.
- **Les certificats** peuvent être régénérés par `certbot --nginx` si l'archive est trop ancienne.
- **Les mots de passe présents dans l'historique git** (FinancialJuice, Myfxbook) : à faire tourner,
  indépendamment de toute restauration.

---

## Combien de temps ça prend, honnêtement

Chiffres mesurés sur cette installation, pas une estimation de principe.

| Étape | Durée | Remarque |
|---|---|---|
| Provisionner la machine | 5-15 min | dépend de l’hébergeur, hors de cette procédure |
| Installer docker, nginx, certbot, gnupg | 2-5 min | |
| Déchiffrer l’archive | quelques secondes | 612 Ko |
| Cloner le dépôt | **quelques secondes** | 38 Mo en `--depth 1` (1 070 Mo sans) |
| Copier config + données | quelques secondes | |
| **Mettre l’image en place** | **2-5 min** *si l’ancien serveur vit* | `dtp-migrer.sh` la lui **transfère** telle quelle (`docker save` → `docker load`, de machine à machine) |
| ↳ *à défaut, la construire* | 8-20 min | ⚠️ **LE goulot** quand le transfert n’est pas possible : l’image installe Chromium et une vingtaine de bibliothèques système, sans aucun cache |
| Démarrage jusqu’à la santé réelle | 1-2 min | scrapers, session Yahoo, Puppeteer |
| DNS si l’IP change | minutes à heures | **hors de tout contrôle** |

**Total réaliste :**

- **10 à 20 minutes** quand l’ancien serveur répond encore : le cas d’une migration *choisie*.
  L’image n’est pas reconstruite, elle est reprise telle quelle.
- **20 à 45 minutes** quand l’ancien serveur est mort : le cas d’une migration *subie*.
  Il faut alors reconstruire, et c’est irréductible.

Dans les deux cas, hors provisionnement de la machine et hors DNS, qui ne dépendent de personne
ici. Ce n’est pas « quelques instants » : le dire serait promettre ce qu’on ne peut pas tenir un
jour de panne.

### Comment le transfert d’image est décidé

C’est automatique, mais **conditionné** : `dtp-migrer.sh` ne reprend l’image de l’ancien serveur
que si les trois conditions suivantes sont vraies, chacune vérifiée et non supposée.

1. **L’ancien serveur joint le nouveau en SSH.** Le transfert va de machine à machine. Le faire
   transiter par le poste d’administration lui ferait *téléverser* près d’un gigaoctet, et une
   liaison domestique téléverse bien plus lentement qu’elle ne reçoit.
2. **Les deux sont au même commit.** Le `Dockerfile` copie les sources *dans* l’image : une image
   plus ancienne ferait tourner du vieux code en donnant l’illusion d’avoir migré, et la
   prochaine mise à jour reconstruirait de toute façon.
3. **L’image existe bien** sur l’ancien serveur.

Si l’une manque, le script le dit et construit. Un raccourci qu’on ne peut pas vérifier n’en
est pas un.

### Pour descendre plus bas encore

Il resterait à publier l’image dans un registre (GitHub Container Registry, gratuit sur dépôt
privé) : la machine neuve la *tirerait* même si l’ancienne est morte, soit le seul cas que le
transfert direct ne couvre pas.

⚠️ Cela demande **un jeton d’accès en lecture** à créer côté GitHub, puis à déposer dans le
`.env`. C’est votre geste, pas le mien : je ne crée pas d’identifiants. Tant qu’il n’existe pas,
la migration *subie* passe par la construction, et c’est un compromis assumé : pas un oubli.

### ⚠️ Cette procédure n’a jamais été exécutée en entier

La **sauvegarde** est testée : archive produite, relue, contenu vérifié fichier par fichier.
La **restauration**, elle, est écrite et raisonnée mais n’a jamais tourné sur une machine
neuve. Tant qu’elle ne l’a pas été, c’est un plan solide, pas une garantie. La seule façon de
savoir est de la dérouler pour de vrai sur un serveur jetable.

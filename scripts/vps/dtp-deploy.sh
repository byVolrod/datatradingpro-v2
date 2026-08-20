#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  DÉPLOIEMENT DTP — un seul à la fois, et la coupure réduite au strict minimum.
#
#  POURQUOI CE SCRIPT EXISTE (incident du 21/08/2026, « 502 Bad Gateway ») :
#  DEUX tâches planifiées déployaient en parallèle — dtp-autodeploy.sh toutes les
#  2 min et auto-update.sh toutes les 5 min — sur le MÊME conteneur, plus les
#  déploiements manuels. Docker renomme l'ancien conteneur avant de le remplacer ;
#  quand un second processus le supprime pendant ce temps, le remplacement échoue :
#      Container datatradingpro Recreate
#      Error response from daemon: No such container: 1e788b37d2c0_datatradingpro
#  et le service reste À TERRE jusqu'au passage suivant. D'où le 502 côté client.
#
#  DEUX CORRECTIONS, ET ELLES SONT DISTINCTES :
#   1. UN VERROU (flock) : deux déploiements ne peuvent plus se chevaucher, quelle
#      que soit leur origine — cron, main, ou les deux.
#   2. CONSTRUIRE AVANT D'ARRÊTER : `docker compose build` est la partie longue
#      (~9 s de build + le téléchargement des couches). Elle se fait désormais
#      pendant que l'ancien conteneur SERT ENCORE. La coupure se limite au
#      redémarrage, au lieu de couvrir tout le build.
#
#  Le script est IDEMPOTENT : sans nouveau commit, il ne touche à rien.
# ═══════════════════════════════════════════════════════════════════════════════
set -o pipefail

REPO=/opt/datatradingpro
VERROU=/var/lock/dtp-deploy.lock
CONTENEUR=datatradingpro
horo() { date '+%F %T'; }

# ── 1. VERROU ────────────────────────────────────────────────────────────────
# -n : on n'attend PAS. Si un déploiement tourne déjà, ce passage n'a rien à faire :
# le déploiement en cours embarquera de toute façon le dernier commit.
exec 9>"$VERROU" || exit 0
if ! flock -n 9; then
  echo "$(horo) deploiement deja en cours -> on passe"
  exit 0
fi

cd "$REPO" || { echo "$(horo) depot introuvable"; exit 1; }
export GIT_SSH_COMMAND="ssh -i /root/.ssh/dtp_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

# ── 2. Y A-T-IL QUELQUE CHOSE À DÉPLOYER ? ───────────────────────────────────
git fetch origin main -q 2>/dev/null || { echo "$(horo) fetch KO"; exit 0; }
LOCAL=$(git rev-parse HEAD 2>/dev/null)
DISTANT=$(git rev-parse origin/main 2>/dev/null)
[ -z "$DISTANT" ] && exit 0
if [ "$LOCAL" = "$DISTANT" ]; then
  [ "$1" = "--force" ] || exit 0
  echo "$(horo) deja a jour (${LOCAL:0:7}) mais --force demande"
fi

echo "$(horo) MAJ ${DISTANT:0:7} detectee"
git reset --hard origin/main -q || { echo "$(horo) reset KO"; exit 1; }

# ── 3. CONSTRUIRE PENDANT QUE L'ANCIEN SERT ENCORE ───────────────────────────
# Un build qui échoue NE DOIT PAS arrêter le conteneur en place : on sort en
# laissant la version précédente en ligne. Mieux vaut une version d'hier qui
# tourne qu'une version d'aujourd'hui qui ne démarre pas.
if ! docker compose build 2>&1 | tail -3; then
  echo "$(horo) BUILD KO -> l ancienne version reste en ligne"
  exit 1
fi

# ── 4. BASCULE ───────────────────────────────────────────────────────────────
# --no-build : l'image est déjà prête, on ne refait pas le travail.
if ! docker compose up -d --no-build 2>&1 | tail -2; then
  echo "$(horo) bascule KO -> nettoyage et seconde tentative"
  docker rm -f "$CONTENEUR" >/dev/null 2>&1
  docker compose up -d --no-build 2>&1 | tail -2
fi

# ── 5. ATTENDRE LA SANTÉ RÉELLE, PAS LE SIMPLE DÉMARRAGE ─────────────────────
# « Started » ne veut pas dire « répond ». Le serveur met une trentaine de
# secondes à être prêt (Chromium, scrapers, session Yahoo). Sans cette attente,
# le journal annonce un succès alors que nginx rend encore du 502.
SANTE=inconnue
for _ in $(seq 1 90); do
  SANTE=$(docker inspect -f '{{.State.Health.Status}}' "$CONTENEUR" 2>/dev/null || echo absent)
  [ "$SANTE" = "healthy" ] && break
  sleep 2
done
echo "$(horo) deploye ${DISTANT:0:7} sante=$SANTE"

# ── 6. MÉNAGE ────────────────────────────────────────────────────────────────
# Le disque est à 84 % : chaque build laisse une image intermédiaire. Sans ce
# ménage, c'est le disque plein qui finit par empêcher tout déploiement.
docker image prune -f >/dev/null 2>&1

[ "$SANTE" = "healthy" ] || exit 1

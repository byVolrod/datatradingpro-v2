#!/usr/bin/env bash
# ═══ LE TIREUR DU VPS — « la méthode à l'ancienne » (30/08/2026) ═══════════════════════════════
#
#   Render déployait tout seul parce que c'est LUI qui tirait le dépôt à chaque push. Ce script
#   refait exactement ça sur le VPS : toutes les minutes (minuteur systemd), il regarde si le tag
#   `prod-ready` a bougé — le workflow GitHub ne l'avance QUE quand les 36 bancs sont verts — et,
#   si oui, rejoue la séquence de déploiement locale : reset → build → up → attente de /healthz.
#
#   Résultat : `git push origin main` → bancs verts → le desk en prod ~2 minutes plus tard.
#   AUCUNE clé nulle part : le VPS utilise son remote git existant (le même que `git fetch` de
#   deploy.sh), GitHub n'a besoin d'aucun secret.
#
#   POSÉ UNE FOIS par scripts/vps-autodeploiement-installer.sh (unités systemd). Le service
#   exécute la COPIE DU DÉPÔT (/opt/datatradingpro/scripts/…) : le tireur se met donc à jour
#   tout seul à chaque déploiement, comme le reste du code.
#
#   ⚠️ La séquence cœur (reset --hard → docker compose build → up -d) existe aussi dans
#   scripts/deploy.sh (le chemin SSH manuel). C'est VOULU — un chemin pousse, l'autre tire — et
#   un banc (deploiement-verif) vérifie que les commandes cœur des deux scripts restent
#   IDENTIQUES : elles ne peuvent pas diverger en silence.
#
set -euo pipefail

DOSSIER="${DTP_DIR:-/opt/datatradingpro}"
SERVICE="datatradingpro"
JALON="prod-ready"
URL="${DTP_URL:-https://desk.datatradingpro.com}"
# ./data est le volume persistant (docker-compose ne monte que lui) et vit HORS git : les deux
# marques survivent aux `reset --hard` et aux reconstructions.
MARQUE="$DOSSIER/data/.version-deployee"
ESSAI="$DOSSIER/data/.version-essayee"

cd "$DOSSIER"

# Réseau qui tousse → on réessaie au prochain tick, sans bruit. Le « + » du refspec est
# indispensable : `prod-ready` est un tag FORCÉ (il avance à chaque version validée), et un
# fetch sans force refuserait de le faire bouger — le tireur resterait aveugle pour toujours.
git fetch --quiet origin "+refs/tags/$JALON:refs/tags/$JALON" 2>/dev/null || exit 0

CIBLE="$(git rev-parse "refs/tags/$JALON^{commit}" 2>/dev/null || true)"
[ -n "$CIBLE" ] || exit 0                                # pas encore de jalon publié → rien à faire
[ "$CIBLE" = "$(cat "$MARQUE" 2>/dev/null || true)" ] && exit 0   # déjà en ligne → rien à faire

# Un déploiement qui ÉCHOUE (build cassé, /healthz muet) ne se réessaie pas en boucle chaque
# minute sur une machine à 512 Mo : au plus une tentative par quart d'heure et par version.
# Un NOUVEAU jalon, lui, réessaie tout de suite.
if [ -f "$ESSAI" ]; then
  D_VER="$(cut -d' ' -f1 "$ESSAI" 2>/dev/null || true)"
  D_QUAND="$(cut -d' ' -f2 "$ESSAI" 2>/dev/null || echo 0)"
  if [ "$D_VER" = "$CIBLE" ] && [ $(( $(date +%s) - D_QUAND )) -lt 900 ]; then exit 0; fi
fi

# Deux ticks ne se chevauchent jamais (un build de plusieurs minutes enjambe des ticks de 60 s).
exec 9>"/run/dtp-autodeploiement.lock"
flock -n 9 || exit 0

echo "[autodeploiement] jalon $JALON → ${CIBLE:0:7} : déploiement"
echo "$CIBLE $(date +%s)" > "$ESSAI"

git reset --hard --quiet "$CIBLE"
docker compose build "$SERVICE"
docker compose up -d "$SERVICE"

# Même attente que deploy.sh : le conteneur redémarre, on laisse au serveur le temps de répondre.
for i in $(seq 1 20); do
  if curl -fsS --max-time 5 "$URL/healthz" >/dev/null 2>&1; then
    echo "$CIBLE" > "$MARQUE"
    echo "[autodeploiement] ✓ ${CIBLE:0:7} en ligne ($URL)"
    exit 0
  fi
  sleep 3
done
echo "[autodeploiement] ✗ /healthz muet après 60 s (version ${CIBLE:0:7}) — nouvel essai dans 15 min ou au prochain jalon" >&2
docker compose logs --tail 30 "$SERVICE" >&2 || true
exit 1

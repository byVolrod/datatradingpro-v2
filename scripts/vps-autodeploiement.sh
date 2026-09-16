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

# ══════════════════════════════════════════════════════════════════════════════════════════════
#   LE MÉNAGE — ET POURQUOI IL NE VIT PLUS DANS LA BRANCHE DU SUCCÈS (10/09/2026)
#   ────────────────────────────────────────────────────────────────────────────────────────────
#   Il était écrit APRÈS la réponse de /healthz, donc À L'INTÉRIEUR du seul chemin qui réussit.
#   Or c'est le chemin qui ÉCHOUE qui remplit le disque : une version dont /healthz reste muet
#   est reconstruite TOUS LES QUARTS D'HEURE (garde des 900 s, plus haut), indéfiniment, et
#   chacune de ces constructions laissait derrière elle son image et son cache SANS QUE RIEN NE
#   LES RETIRE. Quatre constructions par heure qui ne nettoient jamais, c'est un disque qui se
#   remplit tout seul pendant qu'on cherche pourquoi le desk ne répond pas — c'est-à-dire au pire
#   moment. Le ménage est donc posé en `trap … EXIT` juste avant la construction : il tourne
#   quelle que soit l'issue, succès, échec de build, /healthz muet ou interruption.
#
#   ⚠️ POURQUOI `-a`, ALORS QUE deploy.sh se contentait de `prune -f`. Sans `-a`, seules les
#   images SANS NOM sont retirées. Or celles qui se sont accumulées ici étaient NOMMÉES et
#   inutilisées — `node:20`, `datatradingpro-datatradingpro:latest`, restes de configurations
#   précédentes. La commande tournait, ne signalait aucune erreur, et ne libérait rien.
#
#   ⚠️ POURQUOI `until=168h` ET PAS UNE PURGE TOTALE. Garder une semaine d'images permet de
#   revenir à la version précédente par un simple redémarrage de conteneur. Tout purger
#   obligerait à reconstruire depuis Git (~10 min) le jour où il faut revenir en arrière vite —
#   c'est-à-dire le pire jour pour attendre dix minutes. Une semaine borne la croissance sans
#   sacrifier le retour arrière.
#
#   L'image EN SERVICE n'est jamais concernée : un conteneur tourne dessus, Docker la protège.
#   Les montages liés data/* et les volumes ne sont pas touchés (aucun `--volumes` ici).
#   `|| true` : un ménage qui échoue ne doit JAMAIS faire échouer un déploiement réussi.
# ══════════════════════════════════════════════════════════════════════════════════════════════
_menage_docker() {
  # Les conteneurs arretes retiennent leur image : sans ce premier geste, `image prune` ne peut
  # pas la retirer et le menage rend moins de place qu'il n'en annonce. Ajoute le 16/09, en meme
  # temps que dans la sentinelle : les deux nettoient le meme disque, ils doivent nettoyer pareil.
  docker container prune -f >/dev/null 2>&1 || true
  docker image prune -a -f --filter until=168h >/dev/null 2>&1 || true
  docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
  echo "[autodeploiement] ménage : images et cache de plus de 7 jours retirés — $(df -P / | tail -1 | awk '{print $(NF-1)}') utilisé"
}

# Go libres sur la racine. Colonnes lues DEPUIS LA FIN, comme la sentinelle disque : un nom de
# périphérique contenant un espace décale tout découpage fait depuis le début.
_libre_go() { df -P / 2>/dev/null | tail -1 | awk '{printf "%.1f", $(NF-2)/1048576}'; }


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
# ⚠️ CHEMIN SURCHARGEABLE, ET CE N'EST PAS UN CONFORT. Écrit en dur, ce `exec 9>` rend le script
# INJOUABLE partout où /run n'appartient pas à l'utilisateur — un runner GitHub, par exemple. Avec
# `set -e`, la redirection échoue et le script MEURT ICI, avant la construction : un banc qui le
# joue croit alors mesurer un déploiement alors qu'il ne mesure rien du tout. C'est exactement ce
# qui est arrivé le 10/09 (passage 166 : la trace `docker` est sortie VIDE, et le témoin « le
# chemin d'échec ne nettoie plus rien » est passé au VERT pour cette raison — un faux vert de plus).
# La valeur par défaut reste celle de la production, la même que lit `dtp-disque.sh`.
exec 9>"${DTP_VERROU:-/run/dtp-autodeploiement.lock}"
flock -n 9 || exit 0

echo "[autodeploiement] jalon $JALON → ${CIBLE:0:7} : déploiement"
echo "$CIBLE $(date +%s)" > "$ESSAI"

git reset --hard --quiet "$CIBLE"
# ── NE PAS CONSTRUIRE SUR UN DISQUE DÉJÀ TENDU ─────────────────────────────────────────────────
# Le ménage d'après-coup ne protège de rien si la construction elle-même sature le disque : à
# 100 %, nginx tronque en silence toute réponse de plus de ~750 Ko et le desk arrive nu (07/09).
# On regarde donc AVANT, et on fait de la place d'abord quand il en reste peu. En régime normal
# cette branche ne se déclenche jamais — on garde l'image précédente et le cache chaud.
LIBRE_GO="$(_libre_go)"
if [ -n "$LIBRE_GO" ] && awk -v g="$LIBRE_GO" -v s="${DTP_DEPLOI_GO_MINI:-4.0}" 'BEGIN{exit !(g<s)}'; then
  echo "[autodeploiement] ${LIBRE_GO} Go libres seulement — ménage AVANT de construire"
  _menage_docker
fi

# Le ménage tourne QUELLE QUE SOIT L'ISSUE (voir l'encadré plus haut) : c'est le chemin d'échec,
# rejoué tous les quarts d'heure, qui remplissait le disque.
trap _menage_docker EXIT

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

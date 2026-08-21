#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════════════════════
#  RAPATRIER LES SAUVEGARDES — depuis la machine d'administration.
#
#  ⚠️ LA RAISON D'ETRE DE CE SCRIPT : une archive qui reste sur le serveur ne protege de RIEN.
#  Si la machine disparait, l'archive disparait avec elle. Tant qu'une copie n'existe pas
#  AILLEURS, il n'y a pas de sauvegarde — il y a un fichier.
#
#    ./dtp-rapatrier.sh
#
#  Ne telecharge que ce qui manque, verifie chaque archive apres transfert, et fait le menage.
# ═══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SERVEUR="${DTP_SERVEUR:-149.71.44.90}"
CLE="${DTP_SSH_KEY:-$HOME/.ssh/dtp_deploy}"
DEST="${DTP_SAUVEGARDES:-$HOME/Documents/WEB/_sauvegarde-dtp}"
GARDER=10
SSHOPT=(-i "$CLE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=25)

ok()   { echo "  v $*"; }
info() { echo "  · $*"; }
ko()   { echo "  X $*"; exit 1; }

[ -f "$CLE" ] || ko "clé SSH introuvable : $CLE"
mkdir -p "$DEST"

echo "══ Rapatriement des sauvegardes ══"
ssh "${SSHOPT[@]}" "root@$SERVEUR" true 2>/dev/null || ko "serveur injoignable ($SERVEUR)"

DISTANTES=$(ssh "${SSHOPT[@]}" "root@$SERVEUR" 'ls -1 /root/sauvegardes/dtp-*.tar.gz.gpg 2>/dev/null' || true)
[ -n "$DISTANTES" ] || ko "aucune sauvegarde sur le serveur — en produire une d'abord (dtp-sauvegarde.sh)"

NEUVES=0
while IFS= read -r d; do
  [ -n "$d" ] || continue
  n=$(basename "$d")
  if [ -f "$DEST/$n" ]; then info "$n : déjà présente"; continue; fi
  scp "${SSHOPT[@]}" "root@$SERVEUR:$d" "$DEST/" >/dev/null 2>&1 || { echo "  X $n : transfert échoué"; continue; }
  # ⚠️ ON VERIFIE LA TAILLE APRES TRANSFERT. Un scp interrompu laisse un fichier TRONQUE, qui a
  # l'air d'une sauvegarde et n'en est pas. Le decouvrir le jour de la panne serait le pire moment.
  TD=$(ssh "${SSHOPT[@]}" "root@$SERVEUR" "stat -c%s '$d'")
  TL=$(stat -c%s "$DEST/$n" 2>/dev/null || echo 0)
  if [ "$TD" != "$TL" ]; then rm -f "$DEST/$n"; echo "  X $n : taille incohérente ($TL vs $TD), fichier supprimé"; continue; fi
  ok "$n rapatriée ($(( TL / 1024 )) Ko, taille vérifiée)"
  NEUVES=$((NEUVES + 1))
done <<< "$DISTANTES"

echo ""
echo "  $NEUVES nouvelle(s) archive(s)   ·   $(ls -1 "$DEST"/dtp-*.tar.gz.gpg 2>/dev/null | wc -l) au total dans $DEST"

# Rotation locale : on garde les plus recentes.
ls -1t "$DEST"/dtp-*.tar.gz.gpg 2>/dev/null | tail -n +$((GARDER + 1)) | while read -r vieux; do
  rm -f "$vieux" && info "rotation : $(basename "$vieux") supprimée"
done

DERN=$(ls -1t "$DEST"/dtp-*.tar.gz.gpg 2>/dev/null | head -1)
if [ -n "$DERN" ]; then
  AGE=$(( ( $(date +%s) - $(stat -c %Y "$DERN") ) / 3600 ))
  echo ""
  echo "  Plus récente : $(basename "$DERN")  —  ${AGE} h"
  [ "$AGE" -le 48 ] || echo "  ⚠️  Elle a plus de 48 h. Tout ce qui a changé depuis serait perdu."
fi

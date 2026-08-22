#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Publie les installeurs desktop vers le VPS en UNE SEULE connexion SSH.
#
# POURQUOI (22/08) : publish-desktop.sh ouvre une connexion scp PAR FICHIER
# (jusqu'a 7) ; fail2ban du VPS lit ces connexions rapprochees comme une
# attaque et BANNIT l'IP — c'est arrive en pleine publication (Setup.exe passe,
# latest.yml jamais, download bloque). Ici : un seul tar streame dans un seul
# ssh → une connexion, zero fenetre d'incoherence longue.
#
# ORDRE DANS LE TAR = ORDRE D'EXTRACTION : les binaires d'abord, latest.yml EN
# DERNIER — un client auto-update qui lit latest.yml pendant la publication
# trouve toujours un Setup.exe deja complet.
#
# USAGE : bash scripts/publish-desktop-1cnx.sh
# Variables surchargeables : DTP_SSH_KEY, DTP_HOST.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SSH_KEY="${DTP_SSH_KEY:-$HOME/.ssh/dtp_deploy}"
HOST="${DTP_HOST:-root@149.71.44.90}"
REMOTE="/opt/dtp-downloads"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/desktop/dist"

[ -f "$SSH_KEY" ] || { echo "❌ Clé SSH introuvable : $SSH_KEY"; exit 1; }
[ -d "$DIST" ]    || { echo "❌ $DIST introuvable — build d'abord"; exit 1; }

# Fichiers publiables, DANS L'ORDRE : binaires d'abord, puis les manifestes (latest-mac.yml,
# et latest.yml EN DERNIER). Noms = ceux PUBLIÉS (le build sort mac-arm64/mac-x64 : les renommer
# dans dist/ avant, comme le fait publish-desktop.sh a l'upload).
ORDRE=(
  "DataTradingPro-Setup.exe"
  "DataTradingPro-Setup.exe.blockmap"
  "DataTradingPro-macOS.dmg"
  "DataTradingPro-macOS-Intel.dmg"
  "DataTradingPro-macOS.zip"
  "DataTradingPro-macOS-Intel.zip"
  "latest-mac.yml"
  "latest.yml"
)
FICHIERS=()
for f in "${ORDRE[@]}"; do
  [ -f "$DIST/$f" ] && FICHIERS+=("$f") || printf "  · %-34s (absent, ignoré)\n" "$f"
done
[ ${#FICHIERS[@]} -gt 0 ] || { echo "❌ Rien à publier dans $DIST"; exit 1; }

echo "→ ${#FICHIERS[@]} fichier(s), UNE connexion vers $HOST:$REMOTE"
for f in "${FICHIERS[@]}"; do printf "  ↑ %-34s %s\n" "$f" "$(du -h "$DIST/$f" | cut -f1)"; done

# Un seul ssh : tar local streame → tar distant. Puis controle de taille distant.
tar -C "$DIST" -cf - "${FICHIERS[@]}" | ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o ConnectTimeout=20 "$HOST" \
  "mkdir -p '$REMOTE' && tar -xf - -C '$REMOTE' && echo '── état distant ──' && ls -la '$REMOTE' | grep -E 'Setup|latest|dmg|mac' && echo '── version publiée ──' && head -1 '$REMOTE/latest.yml'"

echo "✓ Publication terminée."

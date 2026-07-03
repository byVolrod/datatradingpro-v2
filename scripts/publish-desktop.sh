#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Publie les installeurs de l'app desktop (build electron-builder) vers le VPS.
#
# nginx sert https://desk.datatradingpro.com/downloads/  →  /opt/dtp-downloads/  (hors conteneur,
# hors git) : un simple scp suffit, AUCUN rebuild Docker. Le flux latest.yml active l'auto-update
# des apps Windows 1.0.2+ (macOS : auto-update = signature Apple requise ; ici = telechargement manuel).
#
# USAGE :
#   cd desktop && npm install && npm run icons && npm run build:win   # (et/ou build:mac)
#   bash scripts/publish-desktop.sh
#
# Variables surchargeables : DTP_SSH_KEY, DTP_HOST (defauts = cle/serveur de deploiement).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SSH_KEY="${DTP_SSH_KEY:-$HOME/.ssh/dtp_deploy}"
HOST="${DTP_HOST:-root@149.71.44.90}"
REMOTE="/opt/dtp-downloads"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/desktop/dist"

SSHO=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no)

[ -f "$SSH_KEY" ] || { echo "❌ Clé SSH introuvable : $SSH_KEY (surcharge via DTP_SSH_KEY=…)"; exit 1; }
[ -d "$DIST" ]    || { echo "❌ $DIST introuvable — lance d'abord le build : cd desktop && npm run build:win"; exit 1; }

echo "→ Source : $DIST"
echo "→ Cible  : $HOST:$REMOTE"
echo

uploaded=0
# up <fichier-local> [nom-distant]   (renomme a l'upload si un 2e argument est donne)
up() {
  local src="$DIST/$1" name="${2:-$1}"
  if [ -f "$src" ]; then
    printf "  ↑ %-34s %s\n" "$name" "$(du -h "$src" | cut -f1)"
    scp "${SSHO[@]}" "$src" "$HOST:$REMOTE/$name"
    uploaded=$((uploaded + 1))
  else
    printf "  · %-34s (absent, ignoré)\n" "$1"
  fi
}

echo "── Windows (auto-update + téléchargement) ──"
up "DataTradingPro-Setup.exe"
up "DataTradingPro-Setup.exe.blockmap"
up "latest.yml"

echo "── macOS (téléchargement manuel — l'auto-update Mac nécessite une signature Apple) ──"
up "DataTradingPro-mac-arm64.zip" "DataTradingPro-macOS.zip"
up "DataTradingPro-mac-x64.zip"   "DataTradingPro-macOS-Intel.zip"

echo
if [ "$uploaded" -eq 0 ]; then
  echo "⚠️  Aucun artefact trouvé dans $DIST — as-tu lancé le build ?"; exit 1
fi

echo "── Vérification en production ──"
for f in DataTradingPro-Setup.exe latest.yml DataTradingPro-macOS.zip DataTradingPro-macOS-Intel.zip; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://desk.datatradingpro.com/downloads/$f" || echo "ERR")
  printf "  %-34s HTTP %s\n" "$f" "$code"
done

echo
echo "✓ Publié. Les apps Windows 1.0.2+ détecteront la mise à jour au prochain lancement"
echo "  (le flux latest.yml est en cache nginx ≤ 1 h → propagation en moins d'une heure)."

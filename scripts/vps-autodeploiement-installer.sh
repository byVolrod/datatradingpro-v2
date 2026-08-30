#!/usr/bin/env bash
# ═══ POSE LE TIREUR SUR LE VPS — À LANCER UNE SEULE FOIS ══════════════════════════════════════
#
#   Depuis la machine qui a la clé :
#     ssh -i ~/.ssh/dtp_deploy root@149.71.44.90 'cd /opt/datatradingpro \
#       && git fetch origin main && git reset --hard origin/main \
#       && bash scripts/vps-autodeploiement-installer.sh'
#
#   (ou directement dans un terminal du VPS : cd /opt/datatradingpro && bash scripts/vps-autodeploiement-installer.sh)
#
#   Après ça, plus JAMAIS besoin de clé ni de npm run deploy : chaque push sur main validé par
#   les bancs avance le jalon prod-ready, et le VPS le déploie tout seul dans la minute.
#   Idempotent : le relancer ne casse rien (il remet les unités et redémarre le minuteur).
#
set -euo pipefail

DOSSIER="${DTP_DIR:-/opt/datatradingpro}"
cd "$DOSSIER"

cp scripts/dtp-autodeploiement.service /etc/systemd/system/dtp-autodeploiement.service
cp scripts/dtp-autodeploiement.timer   /etc/systemd/system/dtp-autodeploiement.timer
systemctl daemon-reload
systemctl enable --now dtp-autodeploiement.timer

echo "✓ Tireur installé : le VPS tirera le jalon prod-ready toutes les minutes."
echo "  Premier passage immédiat :"
systemctl start dtp-autodeploiement.service || true
echo
echo "  Suivi : systemctl list-timers dtp-autodeploiement.timer"
echo "  Journal du dernier passage : journalctl -u dtp-autodeploiement.service -n 30 --no-pager"

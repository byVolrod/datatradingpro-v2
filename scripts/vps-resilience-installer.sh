#!/usr/bin/env bash
# ═══ POSE LA SAUVEGARDE QUOTIDIENNE ET LE KEEP-ALIVE SUR LE VPS — À LANCER UNE SEULE FOIS ═══════
#
#   Depuis la machine qui a la clé :
#     ssh -i ~/.ssh/dtp_deploy root@149.71.44.90 'cd /opt/datatradingpro \
#       && git fetch origin main && git reset --hard origin/main \
#       && bash scripts/vps-resilience-installer.sh'
#
#   (ou directement dans un terminal du VPS : cd /opt/datatradingpro && bash scripts/vps-resilience-installer.sh)
#
#   ⚠️ POURQUOI CET INSTALLATEUR EXISTE, ET CE QU'IL RÉPARE.
#   Les deux tâches qu'il pose étaient DÉJÀ écrites — et aucune des deux ne tournait.
#     · Le keep-alive vivait dans GitHub Actions, où ses secrets n'ont jamais été posés : 142
#       passages, tous verts, tous affichant « 0 projet(s) Supabase détecté(s) ». Le projet
#       principal est resté en pause du 14 juin au 2 septembre pendant que le tableau de bord
#       affichait une coche verte chaque jour.
#     · La sauvegarde n'existait que sous forme d'une ligne de crontab À RECOPIER À LA MAIN, dans
#       un fichier de documentation.
#   Les deux échecs ont la même forme : une étape manuelle qu'on croit faite. Une commande, donc.
#   Idempotent : le relancer ne casse rien.
#
set -euo pipefail

DOSSIER="${DTP_DIR:-/opt/datatradingpro}"
cd "$DOSSIER"

ENVF="$DOSSIER/.env"
[ -f "$ENVF" ] || { echo "✗ $ENVF introuvable — les deux tâches y lisent leurs clés. Abandon."; exit 1; }

# ── 1. LA PHRASE SECRÈTE DE LA SAUVEGARDE ──────────────────────────────────────────────────────
# Sans elle, dtp-sauvegarde.sh refuse de tourner (et il a raison : l'archive contient .env en clair).
# On la lit dans le .env ; si elle n'y est pas, on en fabrique une et on l'y écrit.
#
# ⚠️ ELLE DOIT AUSSI VIVRE AILLEURS QUE SUR CETTE MACHINE. L'archive chiffrée et la clé qui l'ouvre
# ne doivent pas partager le même disque : si le serveur disparaît, on garderait des archives
# illisibles, et l'on aurait sauvegardé pour rien. C'est pourquoi on l'affiche une fois, en clair.
if grep -q '^DTP_BACKUP_PASS=' "$ENVF"; then
  echo "✓ DTP_BACKUP_PASS déjà présent dans .env (inchangé)."
else
  NOUVELLE=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)
  printf '\n# Phrase secrète des archives de sauvegarde (posée par vps-resilience-installer.sh)\nDTP_BACKUP_PASS=%s\n' "$NOUVELLE" >> "$ENVF"
  echo
  echo "  ┌──────────────────────────────────────────────────────────────────────────────┐"
  echo "  │  PHRASE SECRÈTE DES SAUVEGARDES — NOTEZ-LA MAINTENANT, AILLEURS QUE SUR CE   │"
  echo "  │  SERVEUR (gestionnaire de mots de passe). Sans elle, AUCUNE archive ne       │"
  echo "  │  pourra être ouverte le jour où vous en aurez besoin.                        │"
  echo "  │                                                                              │"
  printf  "  │   %-74s │\n" "$NOUVELLE"
  echo "  └──────────────────────────────────────────────────────────────────────────────┘"
  echo
fi

# ── 2. LE JETON DE GESTION (reprise automatique d'un projet en pause) ──────────────────────────
# Facultatif, mais sans lui un projet mis en pause NE PEUT PAS être rallumé automatiquement : en
# pause, il refuse jusqu'au ping du keep-alive. C'est précisément ce qui l'a laissé éteint 2,5 mois.
if grep -q '^SUPABASE_ACCESS_TOKEN=' "$ENVF"; then
  echo "✓ SUPABASE_ACCESS_TOKEN présent → un projet mis en pause sera relancé tout seul."
else
  echo "⚠ SUPABASE_ACCESS_TOKEN absent du .env : le keep-alive préviendra qu'une base est tombée,"
  echo "  mais il ne pourra PAS la sortir de pause tout seul (l'API de gestion exige ce jeton)."
  echo "  À créer sur https://supabase.com/dashboard/account/tokens puis :"
  echo "      echo 'SUPABASE_ACCESS_TOKEN=sbp_...' >> $ENVF"
  echo "  Si db2/db3/db4 vivent sous d'autres comptes Supabase, ajouter aussi"
  echo "  SUPABASE_ACCESS_TOKEN_2 / _3 / _4 : un jeton n'a de droits que sur ses organisations."
fi

# ── 3. LES UNITÉS ──────────────────────────────────────────────────────────────────────────────
for u in dtp-sauvegarde dtp-keepalive; do
  cp "scripts/$u.service" "/etc/systemd/system/$u.service"
  cp "scripts/$u.timer"   "/etc/systemd/system/$u.timer"
done
systemctl daemon-reload
systemctl enable --now dtp-sauvegarde.timer dtp-keepalive.timer

echo
echo "✓ Sauvegarde quotidienne  : 04h10, archive chiffrée, 3 versions conservées."
echo "✓ Keep-alive Supabase     : toutes les 6 h, sur les 4 bases, avec reprise auto des projets en pause."
echo
echo "  Premier passage du keep-alive tout de suite (la sauvegarde, elle, attendra son créneau) :"
systemctl start dtp-keepalive.service || true
echo
echo "  Suivi     : systemctl list-timers 'dtp-*'"
echo "  Journaux  : journalctl -u dtp-keepalive.service -n 40 --no-pager"
echo "              journalctl -u dtp-sauvegarde.service -n 40 --no-pager"
echo
echo "  ⚠ RAPPEL : les archives restent SUR CETTE MACHINE. Les rapatriter ailleurs est une étape"
echo "    à part — une sauvegarde qui vit sur le disque qu'elle protège ne protège de rien."
echo "    Voir scripts/vps/RESTAURATION.md."

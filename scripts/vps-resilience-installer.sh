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
# ⚠️ dtp-disque REJOINT LA LISTE LE 07/09/2026, APRÈS UNE PANNE QUE PERSONNE N'A VUE VENIR.
# Le disque a atteint 100 %. nginx, ne pouvant plus écrire ses fichiers temporaires, s'est mis à
# TRONQUER toute réponse dépassant ~750 Ko sans émettre la moindre erreur HTTP : le desk arrivait
# en HTML nu. Docker ne pouvait plus construire, donc le correctif ne pouvait pas se déployer. Et
# la sauvegarde quotidienne échouait en silence depuis plusieurs jours — c'est-à-dire que le filet
# posé par CET installateur était déjà tombé, sans que rien ne le signale.
# La sentinelle surveille désormais ce que ces deux tâches supposaient acquis : de la place.
for u in dtp-sauvegarde dtp-keepalive dtp-disque dtp-redemarrage dtp-redemarrage-controle; do
  cp "scripts/$u.service" "/etc/systemd/system/$u.service"
  cp "scripts/$u.timer"   "/etc/systemd/system/$u.timer"
done
chmod +x scripts/vps/dtp-disque.sh scripts/vps/dtp-redemarrage.sh 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now dtp-sauvegarde.timer dtp-keepalive.timer dtp-disque.timer \
  dtp-redemarrage.timer dtp-redemarrage-controle.timer

# ── 4. LE FICHIER TAMPON (BALLAST) ───────────────────────────────────────────────────────────────
# ⚠️ IL DOIT EXISTER AVANT LA CRISE, PAS PENDANT. Près de 100 %, il n'y a plus la place de créer
# quoi que ce soit — c'est justement l'état où le nettoyage échoue faute d'espace. On pose donc dès
# maintenant un fichier inerte de 1 Go, sur le MÊME système de fichiers que `/`. À 98 %, la sentinelle
# le supprime en premier pour récupérer 1 Go instantané, puis le recrée une fois la crise passée.
BALLAST_DIR="/var/lib/dtp-disque"
BALLAST="$BALLAST_DIR/ballast.tampon"
BALLAST_MO="${DTP_BALLAST_MO:-1024}"
mkdir -p "$BALLAST_DIR"
if [ -f "$BALLAST" ]; then
  echo "✓ Ballast déjà en place ($(du -h "$BALLAST" 2>/dev/null | cut -f1))."
else
  # `fallocate` réserve l'espace sans écrire 1 Go de zéros (instantané) ; `dd` en repli si le système
  # de fichiers ne le supporte pas. On REFUSE de poser le ballast si le disque est déjà trop plein :
  # créer 1 Go sur un disque à 96 % le pousserait à 100 %, soit exactement la panne qu'on prévient.
  LIBRE_MO=$(df -Pm / | tail -1 | awk '{print $(NF-2)}')
  if [ "${LIBRE_MO:-0}" -gt $((BALLAST_MO + 1024)) ]; then
    fallocate -l "${BALLAST_MO}M" "$BALLAST" 2>/dev/null || dd if=/dev/zero of="$BALLAST" bs=1M count="$BALLAST_MO" 2>/dev/null
    echo "✓ Ballast posé : ${BALLAST_MO} Mo inertes ($BALLAST)."
  else
    echo "⚠ Ballast NON posé : trop peu d'espace libre (${LIBRE_MO} Mo). Libérez d'abord, puis relancez."
  fi
fi

# ── 5. PLAFOND PERMANENT DES JOURNAUX SYSTEMD ────────────────────────────────────────────────────
# La sentinelle vide journald quand ça chauffe ; ce plafond-ci l'empêche de gonfler ENTRE deux
# passages. `SystemMaxUse=200M` borne journald une fois pour toutes — sans lui, un service bavard
# remplirait /var/log/journal sans qu'aucun seuil disque n'ait encore parlé.
JCONF="/etc/systemd/journald.conf.d"
mkdir -p "$JCONF"
if ! grep -qs 'SystemMaxUse=200M' "$JCONF/dtp.conf" 2>/dev/null; then
  printf '[Journal]\nSystemMaxUse=200M\nRuntimeMaxUse=100M\n' > "$JCONF/dtp.conf"
  systemctl restart systemd-journald 2>/dev/null || true
  echo "✓ Journaux systemd plafonnés à 200 Mo (permanent)."
else
  echo "✓ Plafond des journaux systemd déjà posé."
fi

echo
echo "✓ Sauvegarde quotidienne  : 04h10, archive chiffrée, 3 versions conservées."
echo "✓ Keep-alive Supabase     : toutes les 6 h, sur les 4 bases, avec reprise auto des projets en pause."
echo "✓ Sentinelle disque       : toutes les 15 min — 5 paliers (70/80/90/95/98), triple critère"
echo "                            (%, Go libres, vitesse). Nettoie seule à 95 %, SUPPRIME LE BALLAST"
echo "                            à 98 % pour de l'espace vital, et sert de watchdog (desk HS + disque)."
echo "✓ Redémarrage mensuel     : 1er dimanche 05h30 (marché fermé, après la sauvegarde)."
echo "                            Il S'ABSTIENT si un déploiement ou une sauvegarde tourne, si la"
echo "                            machine a moins de 7 jours, ou si le desk est DÉJÀ en panne."
echo "                            Un second message confirme le retour du desk — ou son absence."
echo
echo "  Premier passage du keep-alive et de la sentinelle tout de suite (la sauvegarde attendra son créneau) :"
systemctl start dtp-keepalive.service || true
systemctl start dtp-disque.service || true
echo
echo "  État du disque, à la demande et sans rien modifier :"
echo "      bash scripts/vps/dtp-disque.sh --etat"
echo "  Vérifier que les e-mails d'alerte partent bien :"
echo "      bash scripts/vps/dtp-disque.sh --test"
echo
echo "  Suivi     : systemctl list-timers 'dtp-*'"
echo "  Journaux  : journalctl -u dtp-keepalive.service -n 40 --no-pager"
echo "              journalctl -u dtp-sauvegarde.service -n 40 --no-pager"
echo "              journalctl -u dtp-disque.service -n 40 --no-pager"
echo
echo "  ⚠ RAPPEL : les archives restent SUR CETTE MACHINE. Les rapatriter ailleurs est une étape"
echo "    à part — une sauvegarde qui vit sur le disque qu'elle protège ne protège de rien."
echo "    Voir scripts/vps/RESTAURATION.md."

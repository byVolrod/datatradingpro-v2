#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════════════════════
#  MIGRATION DTP VERS UN SERVEUR NEUF — une seule commande, verifiee a chaque etape.
#
#  Se lance depuis la machine d'administration, PAS depuis un serveur.
#
#    DTP_BACKUP_PASS='…' ./dtp-migrer.sh <ip-du-nouveau-serveur> [--avec-dns]
#
#  ⚠️ CE SCRIPT NE BASCULE PAS LE DNS. Il monte le nouveau serveur, le verifie de bout en bout,
#  et S'ARRETE LA en affichant comment basculer. C'est deliberé : la bascule DNS est le seul geste
#  vraiment irreversible de la migration (le temps de propagation echappe a tout le monde), et
#  elle doit rester une decision consciente. Tant qu'elle n'est pas faite, l'ancien serveur
#  continue de servir : on peut donc tout recommencer sans que personne ne s'en apercoive.
#
#  PRINCIPE : chaque etape VERIFIE son resultat avant de passer a la suivante. Un script de
#  migration qui enchaine sans controler ne migre pas, il deplace un probleme.
# ═══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail

CIBLE="${1:-}"
ANCIEN="${DTP_ANCIEN_SERVEUR:-149.71.44.90}"
CLE="${DTP_SSH_KEY:-$HOME/.ssh/dtp_deploy}"
DEPOT="git@github.com:byVolrod/datatradingpro-v2.git"
SSHOPT=(-i "$CLE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=25)

etape() { echo ""; echo "══ $* ══"; }
ok()    { echo "  v $*"; }
ko()    { echo "  X $*"; exit 1; }
info()  { echo "  · $*"; }

[ -n "$CIBLE" ] || ko "usage : DTP_BACKUP_PASS='…' $0 <ip-du-nouveau-serveur> [--avec-dns]"
# ⚠️ LA PHRASE SECRETE EST LUE PAR LE SCRIPT, JAMAIS TRANSMISE PAR QUI LANCE LA COMMANDE.
# C'est ce qui permet de dire simplement « migre vers telle machine » : l'operateur n'a pas
# a manipuler la phrase, ni a l'avoir sous les yeux, ni a la coller dans un terminal ou elle
# resterait dans l'historique du shell. Elle vit dans un fichier a 600, hors du depot.
PHRASE_FIC="${DTP_BACKUP_PASS_FILE:-$HOME/Documents/WEB/_sauvegarde-dtp/.phrase}"
if [ -z "${DTP_BACKUP_PASS:-}" ] && [ -f "$PHRASE_FIC" ]; then
  DTP_BACKUP_PASS=$(head -c 4096 "$PHRASE_FIC" | tr -d '
')
  export DTP_BACKUP_PASS
  info() { echo "  · $*"; }   # info() est defini plus bas, on l'avance pour ce message
  echo "  · phrase secrete lue depuis $PHRASE_FIC"
fi
[ -n "${DTP_BACKUP_PASS:-}" ] || ko "aucune phrase secrete : ni DTP_BACKUP_PASS, ni $PHRASE_FIC. L'archive est chiffree, on ne peut pas l'ouvrir sans."
[ -f "$CLE" ] || ko "cle SSH introuvable : $CLE"

sshc()  { ssh "${SSHOPT[@]}" "root@$1" "${@:2}"; }

# ── 0. LE NOUVEAU SERVEUR REPOND-IL ? ────────────────────────────────────────────────────────
etape "0. Accès au serveur cible ($CIBLE)"
sshc "$CIBLE" true 2>/dev/null || ko "pas d'accès SSH root sur $CIBLE (la clé $CLE est-elle autorisée ?)"
ok "accès SSH établi"
DISTRO=$(sshc "$CIBLE" 'grep -h ^PRETTY_NAME= /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d \"')
info "système : ${DISTRO:-inconnu}"
LIBRE=$(sshc "$CIBLE" "df -Pm / | awk 'NR==2 {print \$4}'")
[ "${LIBRE:-0}" -ge 6000 ] || ko "seulement ${LIBRE} Mo libres sur la cible : l'image Docker en demande ~4 Go. Refus."
ok "espace disque : ${LIBRE} Mo"

# ── 1. UNE SAUVEGARDE FRAICHE ────────────────────────────────────────────────────────────────
# On en fait une NEUVE si l'ancien serveur repond ; sinon on se rabat sur la plus recente qu'on a
# en local. Migrer avec une archive d'hier, c'est perdre une journee de desinscriptions.
etape "1. Obtenir une sauvegarde"
LOCALE_DIR="${DTP_SAUVEGARDES:-$HOME/Documents/WEB/_sauvegarde-dtp}"
mkdir -p "$LOCALE_DIR"
ARCHIVE=""
if sshc "$ANCIEN" true 2>/dev/null; then
  info "ancien serveur joignable : on produit une sauvegarde FRAICHE"
  printf '%s' "$DTP_BACKUP_PASS" | sshc "$ANCIEN" 'read -r P; DTP_BACKUP_PASS="$P" /usr/local/bin/dtp-sauvegarde.sh' 2>&1 | tail -2 | sed 's/^/    /'
  DIST=$(sshc "$ANCIEN" 'ls -t /root/sauvegardes/dtp-*.tar.gz.gpg 2>/dev/null | head -1')
  [ -n "$DIST" ] || ko "aucune archive produite sur l'ancien serveur"
  scp "${SSHOPT[@]}" "root@$ANCIEN:$DIST" "$LOCALE_DIR/" >/dev/null 2>&1 || ko "rapatriement de l'archive impossible"
  ARCHIVE="$LOCALE_DIR/$(basename "$DIST")"
  ok "archive fraîche rapatriée : $(basename "$ARCHIVE")"
else
  info "ancien serveur INJOIGNABLE : on utilise la sauvegarde locale la plus récente"
  ARCHIVE=$(ls -t "$LOCALE_DIR"/dtp-*.tar.gz.gpg 2>/dev/null | head -1)
  [ -n "$ARCHIVE" ] || ko "aucune sauvegarde locale dans $LOCALE_DIR — rien à restaurer."
  AGE=$(( ( $(date +%s) - $(stat -c %Y "$ARCHIVE") ) / 86400 ))
  ok "archive locale : $(basename "$ARCHIVE") (${AGE} jour(s))"
  [ "$AGE" -le 7 ] || info "ATTENTION : cette archive a ${AGE} jours. Tout ce qui a change depuis sera perdu."
fi

# ── 2. L'ARCHIVE S'OUVRE-T-ELLE VRAIMENT ? ───────────────────────────────────────────────────
# On le verifie ICI, avant de toucher a la cible : decouvrir qu'elle est illisible a mi-parcours
# laisserait un serveur a moitie monte.
etape "2. Vérifier l'archive AVANT de commencer"
LISTE=$(gpg --batch --quiet --decrypt --passphrase-fd 3 "$ARCHIVE" 3<<<"$DTP_BACKUP_PASS" 2>/dev/null | tar -tzf - 2>/dev/null)
[ -n "$LISTE" ] || ko "l'archive ne s'ouvre pas (phrase secrète erronée, ou fichier corrompu)"
for attendu in "config/env" "donnees/cache_email_log.json" "config/cle-deploiement"; do
  echo "$LISTE" | grep -q "$attendu" || ko "l'archive ne contient pas $attendu — elle est incomplète, on n'y va pas."
done
ok "archive lisible et complète ($(echo "$LISTE" | wc -l) entrées)"

# ── 3. PREREQUIS SYSTEME ─────────────────────────────────────────────────────────────────────
etape "3. Préparer le système cible"
sshc "$CIBLE" 'export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1
  apt-get install -y -qq git docker.io docker-compose-plugin nginx certbot python3-certbot-nginx gnupg curl >/dev/null 2>&1
  systemctl enable --now docker >/dev/null 2>&1
  docker --version && nginx -v 2>&1' 2>&1 | sed 's/^/    /'
sshc "$CIBLE" 'command -v docker >/dev/null && command -v nginx >/dev/null' || ko "docker ou nginx absent après installation"
ok "docker et nginx en place"

# ── 4. DEPOSER ET OUVRIR L'ARCHIVE ───────────────────────────────────────────────────────────
etape "4. Transférer et ouvrir l'archive"
sshc "$CIBLE" 'mkdir -p /root/restauration && rm -rf /root/restauration/*'
scp "${SSHOPT[@]}" "$ARCHIVE" "root@$CIBLE:/root/restauration/" >/dev/null 2>&1 || ko "transfert de l'archive impossible"
printf '%s' "$DTP_BACKUP_PASS" | sshc "$CIBLE" 'read -r P
  cd /root/restauration
  A=$(ls -t dtp-*.tar.gz.gpg | head -1)
  gpg --batch --quiet --decrypt --passphrase-fd 3 "$A" 3<<<"$P" 2>/dev/null | tar -xzf - || exit 1
  ls -d dtp-*/ | head -1' 2>&1 | sed 's/^/    /'
sshc "$CIBLE" 'test -f /root/restauration/dtp-*/config/env' || ko "l'archive ne s'est pas ouverte sur la cible"
ok "archive ouverte sur la cible"

# ── 5. LE CODE ───────────────────────────────────────────────────────────────────────────────
# --depth 1 : le serveur est un miroir de deploiement. 38 Mo au lieu de 1 070.
etape "5. Récupérer le code"
sshc "$CIBLE" "mkdir -p /root/.ssh && cp -f /root/restauration/dtp-*/config/cle-deploiement /root/.ssh/dtp_deploy && chmod 600 /root/.ssh/dtp_deploy
  export GIT_SSH_COMMAND='ssh -i /root/.ssh/dtp_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new'
  rm -rf /opt/datatradingpro
  git clone --depth 1 --branch main '$DEPOT' /opt/datatradingpro 2>&1 | tail -2" 2>&1 | sed 's/^/    /'
sshc "$CIBLE" 'test -f /opt/datatradingpro/server.js' || ko "le dépôt ne s'est pas cloné"
COMMIT=$(sshc "$CIBLE" 'cd /opt/datatradingpro && git rev-parse --short HEAD')
ok "code cloné au commit $COMMIT"

# ── 6. SECRETS, CONFIGURATION, DONNEES ───────────────────────────────────────────────────────
etape "6. Poser les secrets, la configuration et les données"
sshc "$CIBLE" 'R=$(ls -d /root/restauration/dtp-*/ | head -1)
  cp -f "$R/config/env" /opt/datatradingpro/.env && chmod 600 /opt/datatradingpro/.env
  [ -f "$R/config/docker-compose.yml" ] && cp -f "$R/config/docker-compose.yml" /opt/datatradingpro/
  cp -a "$R/config/nginx-sites-available/." /etc/nginx/sites-available/ 2>/dev/null
  ln -sf /etc/nginx/sites-available/datatradingpro /etc/nginx/sites-enabled/
  [ -d "$R/config/letsencrypt" ] && cp -a "$R/config/letsencrypt/." /etc/letsencrypt/ 2>/dev/null
  mkdir -p /opt/datatradingpro/data/app && cp -a "$R/donnees/." /opt/datatradingpro/data/app/ 2>/dev/null
  cp -f /opt/datatradingpro/scripts/vps/dtp-deploy.sh /usr/local/bin/ && chmod +x /usr/local/bin/dtp-deploy.sh
  cp -f /opt/datatradingpro/scripts/vps/dtp-sauvegarde.sh /usr/local/bin/ && chmod +x /usr/local/bin/dtp-sauvegarde.sh
  [ -f "$R/config/crontab.txt" ] && crontab "$R/config/crontab.txt"
  cd /opt/datatradingpro
  git remote set-url origin '"$DEPOT"' 2>/dev/null
  nginx -t 2>&1 | tail -2'
CLES=$(sshc "$CIBLE" 'grep -c "^[A-Z_]*=" /opt/datatradingpro/.env')
[ "${CLES:-0}" -gt 20 ] || ko ".env restauré avec seulement ${CLES} clés : c'est anormal."
ok "$CLES clés d'environnement en place"
sshc "$CIBLE" 'test -s /opt/datatradingpro/data/app/cache_email_log.json' \
  && ok "anti-doublon e-mails et désinscrits restaurés" \
  || ko "cache_email_log.json manquant : refus de démarrer, le serveur réexpédierait les campagnes."

# ── 7. DEMARRER ET ATTENDRE LA SANTE REELLE ──────────────────────────────────────────────────
etape "7. Construire et démarrer (l'étape longue : ~8 à 20 min)"
sshc "$CIBLE" 'cd /opt/datatradingpro && docker compose up -d --build 2>&1 | tail -4' 2>&1 | sed 's/^/    /'
info "attente de la santé réelle (pas du simple démarrage)…"
SANTE=inconnue
for _ in $(seq 1 120); do
  SANTE=$(sshc "$CIBLE" 'docker inspect -f "{{.State.Health.Status}}" datatradingpro 2>/dev/null' || echo absent)
  [ "$SANTE" = "healthy" ] && break
  sleep 5
done
[ "$SANTE" = "healthy" ] || ko "le conteneur n'est pas devenu sain (état : $SANTE). Le DNS n'a PAS été touché : l'ancien serveur sert toujours."
ok "conteneur sain"

# ── 8. VERIFIER PAR L'EXTERIEUR, SANS TOUCHER AU DNS ─────────────────────────────────────────
# On interroge la nouvelle machine PAR SON IP, en lui presentant le bon nom d'hote : c'est la
# seule facon de prouver qu'elle repondrait correctement, sans avoir a basculer quoi que ce soit.
etape "8. Vérifier la nouvelle machine (sans basculer le DNS)"
LOCAL=$(sshc "$CIBLE" 'curl -s -o /dev/null -w "%{http_code}" --max-time 15 http://127.0.0.1:3000/healthz')
[ "$LOCAL" = "200" ] && ok "santé applicative : HTTP $LOCAL" || ko "l'application ne répond pas en local (HTTP $LOCAL)"
VIA_NGINX=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 --resolve "desk.datatradingpro.com:443:$CIBLE" \
            --insecure "https://desk.datatradingpro.com/login" 2>/dev/null || echo '000')
[ "$VIA_NGINX" = "200" ] && ok "page de connexion servie par la nouvelle machine : HTTP $VIA_NGINX" \
                         || info "réponse via nginx : HTTP $VIA_NGINX (à vérifier avant de basculer)"

etape "MIGRATION PRÊTE — le DNS n'a PAS été touché"
echo "  L'ancien serveur continue de servir. Rien n'est visible côté client."
echo ""
echo "  Nouvelle machine : $CIBLE   (commit $COMMIT, conteneur sain)"
echo ""
echo "  Pour basculer, faire pointer ces enregistrements A sur $CIBLE :"
echo "      datatradingpro.com"
echo "      desk.datatradingpro.com"
echo "  Puis renouveler les certificats si besoin :  certbot --nginx"
echo ""
echo "  Pour revenir en arrière : refaire pointer le DNS sur $ANCIEN. Rien n'a été détruit."

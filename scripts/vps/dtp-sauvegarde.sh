#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════════════════════
#  SAUVEGARDE DTP — uniquement CE QUI NE SE RECONSTRUIT PAS.
#
#  Une sauvegarde qui copie tout est une sauvegarde qu'on ne fait jamais tourner : trop lourde,
#  trop lente, et elle remplit le disque (déjà à 84 %). Celle-ci ne prend que l'irremplaçable.
#
#  CE QUI EST DEDANS, et pourquoi :
#    .env                  → ~80 clés (Supabase, IA, Whop, mail…). N'existe NULLE PART ailleurs.
#                            C'est LE point unique de défaillance de toute l'installation.
#    nginx + certificats   → vhost, alias /downloads, Let's Encrypt. Reconstructibles, mais des
#                            heures de tâtonnement en pleine panne.
#    crontab               → le déployeur et la tâche hebdomadaire de la vitrine.
#    docker-compose.yml    → volumes et variables d'environnement du conteneur.
#    cache_email_log.json  → ⚠️ LE PLUS SENSIBLE APRÈS .env. C'est à la fois la garde
#                            « ce mail est déjà parti » ET la liste des DÉSINSCRITS. Le perdre,
#                            c'est réexpédier des campagnes entières et réabonner des gens qui
#                            avaient demandé à ne plus rien recevoir.
#    news_history.json     → l'historique du fil. Sans lui, le fil repart vide.
#    les états métier      → positions bancaires, historique de biais, compteurs de quota IA.
#
#  CE QUI EST VOLONTAIREMENT EXCLU, et pourquoi :
#    data/chrome_*         → 1,8 Go de cache de navigateur. Se reconstruit tout seul.
#    caches IA/traduction  → se régénèrent. Les sauvegarder coûterait plus que les reperdre.
#    pdf_cache/            → re-téléchargeable depuis les banques.
#    /opt/dtp-downloads    → les installeurs se reconstruisent depuis les sources.
#    la BASE DE DONNÉES    → elle vit chez Supabase, répliquée sur db2/db3/db4. Ce ne sont pas
#                            nos octets à sauvegarder ; ce qu'il faut protéger, ce sont les CLÉS
#                            qui y donnent accès, et elles sont dans .env.
#
#  ⚠️ CHIFFREMENT OBLIGATOIRE. L'archive contient .env en clair : sans chiffrement, la déposer
#  quelque part reviendrait à publier toutes les clés. La phrase secrète est lue dans la variable
#  DTP_BACKUP_PASS et n'est JAMAIS écrite sur le disque ni dans les journaux.
#
#  ⚠️ UNE SAUVEGARDE QUI RESTE SUR LA MÊME MACHINE NE PROTÈGE DE RIEN. Ce script produit le
#  fichier ; le RAPATRIER ailleurs est une étape à part, décrite dans RESTAURATION.md.
#
#  Usage :  DTP_BACKUP_PASS='…' /usr/local/bin/dtp-sauvegarde.sh
# ═══════════════════════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO=/opt/datatradingpro
DEST=/root/sauvegardes
HORO=$(date +%Y%m%d-%H%M)
NOM="dtp-$HORO"
TMP=$(mktemp -d)
GARDER=7          # nombre d'archives conservées sur la machine (le disque est étroit)

msg() { echo "$(date '+%F %T') $*"; }
nettoyer() { rm -rf "$TMP"; }
trap nettoyer EXIT

if [ -z "${DTP_BACKUP_PASS:-}" ]; then
  msg "ERREUR : DTP_BACKUP_PASS n'est pas defini. Refus de produire une archive EN CLAIR"
  msg "         contenant .env : ce serait publier toutes les cles."
  exit 1
fi

# ── Place disponible : on refuse de commencer plutôt que de remplir le disque ────────────────
LIBRE_MO=$(df -Pm / | awk 'NR==2 {print $4}')
if [ "$LIBRE_MO" -lt 800 ]; then
  msg "ERREUR : seulement ${LIBRE_MO} Mo libres. Une sauvegarde qui remplit le disque provoque"
  msg "         la panne qu'elle est censee prevenir. Faire de la place, puis relancer."
  exit 1
fi

mkdir -p "$DEST" "$TMP/$NOM"
cd "$TMP/$NOM" || exit 1

# ── 1. LES SECRETS ET LA CONFIGURATION ──────────────────────────────────────────────────────
mkdir -p config
cp -a "$REPO/.env"                config/env                     2>/dev/null || msg "ATTENTION : .env introuvable"
cp -a "$REPO/docker-compose.yml"  config/                        2>/dev/null || true
crontab -l                      > config/crontab.txt             2>/dev/null || true
cp -a /etc/nginx/sites-available config/nginx-sites-available    2>/dev/null || true
cp -a /etc/letsencrypt           config/letsencrypt              2>/dev/null || true
cp -a /root/.ssh/dtp_deploy      config/cle-deploiement          2>/dev/null || true
cp -a /usr/local/bin/dtp-deploy.sh config/                       2>/dev/null || true

# ── 2. LES DONNÉES IRREMPLAÇABLES ───────────────────────────────────────────────────────────
# Liste EXPLICITE : un « cp -a data/ » embarquerait 1,8 Go de cache de navigateur.
mkdir -p donnees
for f in cache_email_log.json news_history.json cache_bank_positions.json \
         cache_smart_bias_history.json cache_smart_bias.json cache_ai_usage.json \
         cache_session_wraps.json cache_bank_research.json cache_rates_state.json; do
  [ -f "$REPO/data/app/$f" ] && cp -a "$REPO/data/app/$f" donnees/ 2>/dev/null
done

# ── 3. UN MANIFESTE : ce qu'on a pris, et surtout CE QU'ON N'A PAS PRIS ──────────────────────
{
  echo "Sauvegarde DataTradingPro — $HORO"
  echo "commit deploye : $(cd "$REPO" && git rev-parse HEAD 2>/dev/null)"
  echo "machine        : $(hostname)  —  $(uname -sr)"
  echo ""
  echo "CONTENU :"
  find . -type f | sed 's|^\./|  |' | sort
  echo ""
  echo "VOLONTAIREMENT ABSENT (se reconstruit) :"
  echo "  - le CODE : il vit sur GitHub (origin + backup). Voir le commit ci-dessus."
  echo "  - data/chrome_* : ~1,8 Go de cache de navigateur."
  echo "  - les caches IA, traduction, PDF : regeneres a l'usage."
  echo "  - /opt/dtp-downloads : les installeurs se reconstruisent depuis les sources."
  echo "  - la BASE : elle vit chez Supabase (db2/db3/db4). Les CLES d'acces sont dans config/env."
} > MANIFESTE.txt

# ── 4. ARCHIVE CHIFFRÉE ─────────────────────────────────────────────────────────────────────
cd "$TMP" || exit 1
ARCHIVE="$DEST/$NOM.tar.gz.gpg"
if ! tar -czf - "$NOM" \
     | gpg --batch --yes --symmetric --cipher-algo AES256 \
           --passphrase-fd 3 -o "$ARCHIVE" 3<<<"$DTP_BACKUP_PASS"; then
  msg "ERREUR : la creation de l'archive a echoue"
  rm -f "$ARCHIVE"
  exit 1
fi
chmod 600 "$ARCHIVE"

# ── 5. VÉRIFICATION : une sauvegarde non verifiee n'en est pas une ───────────────────────────
if ! gpg --batch --yes --quiet --decrypt --passphrase-fd 3 "$ARCHIVE" 3<<<"$DTP_BACKUP_PASS" \
     2>/dev/null | tar -tzf - >/dev/null 2>&1; then
  msg "ERREUR : l'archive ne se relit pas. Elle est SUPPRIMEE — mieux vaut aucune sauvegarde"
  msg "         qu'une sauvegarde en laquelle on croit a tort."
  rm -f "$ARCHIVE"
  exit 1
fi

TAILLE=$(du -h "$ARCHIVE" | cut -f1)
msg "sauvegarde OK : $ARCHIVE ($TAILLE) — relue et verifiee"

# ── 6. ROTATION ─────────────────────────────────────────────────────────────────────────────
ls -1t "$DEST"/dtp-*.tar.gz.gpg 2>/dev/null | tail -n +$((GARDER + 1)) | while read -r vieux; do
  rm -f "$vieux" && msg "rotation : $vieux supprime"
done

msg "RAPPEL : cette archive est SUR LA MEME MACHINE. La rapatrier ailleurs (voir RESTAURATION.md)."

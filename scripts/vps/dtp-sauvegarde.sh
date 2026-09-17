#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════════════════════
#  SAUVEGARDE DTP : uniquement CE QUI NE SE RECONSTRUIT PAS.
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
# NOMBRE DE VERSIONS CONSERVÉES SUR LA MACHINE. Ramené de 7 à 3 (02/09, demande utilisateur :
# « conservation de versionning jusqu'à 3 »). Le disque est étroit — il était déjà à 84 % — et
# trois générations couvrent le cas qui compte : la sauvegarde d'hier, celle d'avant-hier au cas
# où celle d'hier aurait capturé un état déjà abîmé, et une troisième de marge.
# ⚠️ CONSÉQUENCE AU PREMIER PASSAGE : si la machine porte déjà sept archives, la rotation en
# supprimera quatre. C'est le comportement demandé, pas un effet de bord — mais il est définitif.
# Surchargeable sans toucher au script : DTP_BACKUP_GARDER=5 dtp-sauvegarde.sh
GARDER="${DTP_BACKUP_GARDER:-3}"

msg() { echo "$(date '+%F %T') $*"; }
# ⚠️ Le nettoyage retire AUSSI l'archive en cours d'ecriture. Une interruption (Ctrl-C, session SSH
# coupee, machine qui s'arrete) laissait sinon dans /root/sauvegardes un fichier tronque, portant un
# nom parfaitement normal, que la rotation compterait comme une sauvegarde et que la migration
# choisirait comme « la plus recente ». _FINI passe a 1 quand l'archive est verifiee.
_FINI=0

# ══ UNE SAUVEGARDE QUI ÉCHOUE DOIT CRIER ════════════════════════════════════════════════════════
# ⚠️ POSÉ LE 17/09/2026, APRÈS AVOIR TROUVÉ /root/sauvegardes VIDE DEPUIS LA POSE DES MINUTEURS.
# Ce script a passé des SEMAINES à échouer chaque nuit — d'abord en « Permission denied » (le bit
# +x manquait), puis faute de DTP_BACKUP_PASS (le .env ne se sourçait pas). À chaque fois il a
# proprement écrit sa raison... dans le journal systemd, que personne n'ouvre tant que rien ne
# semble cassé. Le minuteur, lui, repartait le lendemain, verdissant l'écran d'état.
# C'est la maladie décrite dans CLAUDE.md sous sa forme la plus coûteuse : un garde-fou qui a
# l'air posé. On ferme le trou par l'endroit qui compte : l'échec PART EN E-MAIL, comme le fait
# déjà la sentinelle du disque, via le mailer déjà chargé dans le conteneur.
CONTENEUR_ALERTE="${DTP_CONTENEUR:-datatradingpro}"
_alerter_echec() {
  local raison="$1"
  # ⚠️ UNE ADRESSE PAR DÉFAUT EST OBLIGATOIRE, ET C'EST LE CŒUR DU CORRECTIF. Une première écriture
  # de cette fonction ne faisait rien quand aucune variable n'était posée : elle aurait donc été
  # MUETTE sur la machine de production, où aucune de ces deux variables n'existe — c'est-à-dire
  # qu'elle reproduisait exactement le silence qu'elle est censée briser. On reprend donc le même
  # repli que la sentinelle du disque (`_dest` dans dtp-disque.sh), qui alerte déjà là-bas.
  local dest="${DTP_ALERTE_EMAILS:-${DISK_ALERT_EMAILS:-muhammedatay@outlook.fr}}"
  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTENEUR_ALERTE" || {
    msg "conteneur absent : impossible d'envoyer l'alerte d'echec"; return 0; }
  # Corps par l'entree standard : le passer en argument imposerait d'echapper du HTML dans du
  # shell dans un docker exec — une apostrophe suffirait a tout casser (lecon de dtp-disque.sh).
  printf '%s' "<p>La sauvegarde quotidienne DTP a <b>ECHOUE</b>.</p><p>Raison : $(printf '%s' "$raison" | sed 's/&/\&amp;/g; s/</\&lt;/g')</p><p>Archives presentes dans /root/sauvegardes : $(ls -1 "$DEST"/dtp-*.tar.gz.gpg 2>/dev/null | wc -l)</p><p>Diagnostic : <code>journalctl -u dtp-sauvegarde.service -n 40 --no-pager</code></p>" \
    | DEST_MAIL="$dest" docker exec -e DEST_MAIL -i "$CONTENEUR_ALERTE" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{require("/app/mailer").sendAdminAlert({subject:"DTP : la sauvegarde quotidienne a ECHOUE",html:s,to:process.env.DEST_MAIL}).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});});' 2>&1 \
    && msg "alerte d'echec envoyee a $dest" || msg "l'envoi de l'alerte d'echec a lui-meme echoue"
}

nettoyer() {
  local code=$?
  rm -rf "$TMP"
  if [ "$_FINI" != "1" ] && [ -n "${ARCHIVE:-}" ] && [ -f "${ARCHIVE:-}" ]; then
    rm -f "$ARCHIVE"
    msg "interrompu : l'archive incomplete a ete supprimee (une sauvegarde a moitie ecrite est un piege)"
  fi
  # On alerte sur TOUT echec, y compris ceux qui sortent avant la moindre ecriture (phrase secrete
  # absente, disque plein, export de la base en erreur) — ce sont EXACTEMENT ceux qui se sont tus.
  [ "$code" -ne 0 ] && _alerter_echec "code de sortie $code (voir le journal du service)"
  return 0
}
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

# ── 2 (avancee). LE DOSSIER D ACCUEIL, AVANT TOUTE COPIE DEDANS ─────────────────────────────
# ⚠️ POSE ICI, PAS PLUS BAS, ET C EST LE CORRECTIF QUI COMPTE (17/09/2026, trouve en faisant
# tourner cette sauvegarde pour la premiere fois depuis sa pose — les deux bugs precedents
# (droit d execution, puis .env execute au lieu d etre lu) l empechaient d atteindre CE point du
# script. `mkdir -p donnees` vivait plus bas, APRES la copie du dump : `cp -a SOURCE donnees/`
# quand `donnees` n existe pas encore ne NICHE pas SOURCE dedans, il RENOMME SOURCE en `donnees`.
# Le dump se retrouvait donc a plat (`donnees/users.json`) au lieu d etre range dans
# `donnees/dump/users.json` — exactement ce que la verification finale de cette archive exige,
# et exactement ce qui la faisait echouer, SUPPRIMER l archive, et alerter a chaque passage.
mkdir -p donnees

# ── 1 bis. LA BASE DE DONNEES ───────────────────────────────────────────────────────────────
# ⚠️ LE TROU LE PLUS GRAVE DE L AUDIT DU 21/08 : les comptes clients, leurs abonnements et les
# empreintes de leurs mots de passe n existaient QU A UN SEUL ENDROIT, chez Supabase. La
# redondance db2/db3/db4 protege d une PANNE, pas d une SUPPRESSION : trois copies d une ligne
# effacee, cela fait trois lignes effacees. On exporte donc la base AVANT de fabriquer l archive,
# pour qu elle parte dans le meme fichier chiffre.
#
# ⚠️ L EXPORT ECHOUE BRUYAMMENT si la table des comptes est illisible, et la sauvegarde s arrete.
# Produire une archive sans les comptes ferait croire que les clients sont sauvegardes alors
# qu ils ne le sont pas : c est pire que pas d archive du tout, parce qu on ne le decouvrirait
# que le jour de la panne.
msg "export de la base Supabase..."
if (cd "$REPO" && node scripts/vps/dtp-export-bdd.js 2>&1 | sed 's/^/    /'); then
  cp -a "$REPO/data/app/dump" donnees/ 2>/dev/null || true
else
  msg "ERREUR : l export de la base a echoue. Aucune archive ne sera produite : mieux vaut pas"
  msg "        de sauvegarde qu une sauvegarde a laquelle il manque les comptes clients."
  exit 1
fi

# ── 2. LES DONNÉES IRREMPLAÇABLES ───────────────────────────────────────────────────────────
# Liste EXPLICITE : un « cp -a data/ » embarquerait 1,8 Go de cache de navigateur.
# (le dossier existe deja, cree plus haut avant la copie du dump — voir l encadre ci-dessus)
# ⚠️ LES QUATRE FICHIERS DE COMPTES AJOUTES LE 21/08. Ils manquaient, et leur absence coutait cher :
#   users_blacklist.json  : la liste noire repart VIDE, donc des comptes ecartes peuvent se recreer ;
#   users_deleted.json    : les comptes supprimes ne sont plus reconnus comme tels et peuvent revenir ;
#   users_mirror.json     : le seul fichier portant des empreintes de mots de passe, qui permet de se
#                           connecter quand la base ne repond pas ;
#   users_pending.json    : les ecritures faites hors ligne, en attente de rejeu vers la base.
# L archive etant chiffree, les empreintes y sont protegees.
for f in cache_email_log.json news_history.json users_mirror.json users_deleted.json users_blacklist.json users_pending.json cache_bank_positions.json \
         cache_smart_bias_history.json cache_smart_bias.json cache_ai_usage.json \
         cache_session_wraps.json cache_bank_research.json cache_rates_state.json; do
  [ -f "$REPO/data/app/$f" ] && cp -a "$REPO/data/app/$f" donnees/ 2>/dev/null
done

# ── 3. UN MANIFESTE : ce qu'on a pris, et surtout CE QU'ON N'A PAS PRIS ──────────────────────
{
  echo "Sauvegarde DataTradingPro : $HORO"
  echo "commit deploye : $(cd "$REPO" && git rev-parse HEAD 2>/dev/null)"
  echo "machine        : $(hostname)  ·  $(uname -sr)"
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
# ⚠️ ON RELIT LE CONTENU, PAS SEULEMENT LA STRUCTURE. Un `tar -tzf` qui rend 0 prouve seulement
# que l'archive est un tar valide : une archive VIDE, ou une archive ou la copie du .env a echoue,
# passe ce test sans broncher et repart avec la mention « relue et verifiee ». On exige donc la
# presence nommee de ce dont une restauration ne peut PAS se passer.
_LISTE=$(gpg --batch --yes --quiet --decrypt --passphrase-fd 3 "$ARCHIVE" 3<<<"$DTP_BACKUP_PASS" 2>/dev/null | tar -tzf - 2>/dev/null)
if [ -z "$_LISTE" ]; then
  msg "ERREUR : l'archive ne se relit pas. Elle est SUPPRIMEE, mieux vaut aucune sauvegarde"
  msg "         qu'une sauvegarde en laquelle on croit a tort."
  rm -f "$ARCHIVE"
  exit 1
fi
for _att in "config/env" "donnees/cache_email_log.json" "config/cle-deploiement" "donnees/dump/users.json"; do
  if ! printf '%s\n' "$_LISTE" | grep -q "$_att"; then
    msg "ERREUR : l'archive ne contient pas $_att. Elle est SUPPRIMEE : une sauvegarde a laquelle"
    msg "         il manque les cles, les desinscrits ou la cle de deploiement ne restaure rien."
    rm -f "$ARCHIVE"
    exit 1
  fi
done

TAILLE=$(du -h "$ARCHIVE" | cut -f1)
msg "sauvegarde OK : $ARCHIVE ($TAILLE), relue, et contenu verifie ($(printf '%s\n' "$_LISTE" | wc -l) entrees)"

# ── 6. ROTATION ─────────────────────────────────────────────────────────────────────────────
_FINI=1   # l'archive est verifiee : le nettoyage ne doit plus la supprimer
# ⚠️ La rotation ne raisonne que sur les archives QU'ON VIENT DE VALIDER. Avant, elle comptait les
# FICHIERS : une archive illisible restee sur le disque occupait un rang et poussait dehors la
# derniere archive complete. On supprimait donc du bon pour garder du mauvais.
ls -1t "$DEST"/dtp-*.tar.gz.gpg 2>/dev/null | tail -n +$((GARDER + 1)) | while read -r vieux; do
  rm -f "$vieux" && msg "rotation : $vieux supprime"
done

# ── 7. COPIE HORS SITE (e-mail) ─────────────────────────────────────────────────────────────
# ⚠️ POSÉ LE 17/09/2026. Jusqu'ici cette ligne se contentait de LE DIRE (« RAPPEL : ... ») — sans
# rien faire. Une archive qui reste sur le serveur ne protège de rien : si la machine disparaît,
# l'archive disparaît avec elle. On l'envoie donc en PIÈCE JOINTE à l'admin, par le mailer déjà
# chargé dans le conteneur (le même canal, déjà éprouvé en production, que `_alerter_echec`
# ci-dessus) : aucun nouveau compte, aucune nouvelle clé, aucun stockage tiers à payer — la boîte
# mail EST le hors-site, et son quota (des Go) est sans commune mesure avec quelques Mo par nuit.
#
# ⚠️ ATTACHER UNE ARCHIVE DÉJÀ CHIFFRÉE NE RÉ-EXPOSE RIEN. Le fichier est déjà passé par le GPG
# symétrique de la section ── 4. AVANT d'arriver ici ; la phrase secrète (DTP_BACKUP_PASS) ne
# quitte JAMAIS le .env du VPS — elle n'entre dans aucune variable transmise au conteneur, ni dans
# le corps de l'e-mail. Sans elle, la pièce jointe est un bloc opaque.
#
# ⚠️ POURQUOI LE BASE64 PART PAR L'ENTRÉE STANDARD, JAMAIS EN ARGUMENT. Même leçon que
# `_alerter_echec` (voir plus haut) : un `docker exec ... node -e "$(cat …)"` mettrait plusieurs Mo
# de texte dans l'argv d'un process, contre une limite système (ARG_MAX) largement atteignable, et
# volerait dans le journal au premier `set -x`. Le flux est la seule voie sûre pour une charge de
# cette taille.
#
# ⚠️ GARDE DE TAILLE. Gmail/OVH refusent au-delà d'environ 25 Mo, et le passage en base64 gonfle
# le fichier d'un tiers avant l'envoi. Au-delà du plafond on n'attache plus — on PRÉVIENT
# seulement : l'archive locale reste valide, ce n'est pas une perte silencieuse, juste un rappel
# du chemin manuel existant (dtp-rapatrier.sh).
_copie_hors_site() {
  local dest="${DTP_ALERTE_EMAILS:-${DISK_ALERT_EMAILS:-muhammedatay@outlook.fr}}"
  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTENEUR_ALERTE" || {
    msg "copie hors-site : conteneur absent, sautee (l'archive locale reste valide)"; return 0; }

  # Taille en octets, forme portable (le VPS est du GNU, mais un banc peut rejouer ceci ailleurs) —
  # mémes deux lignes que dtp-rapatrier.sh/dtp-migrer.sh pour la même mesure.
  local octets; octets=$(stat -c%s "$ARCHIVE" 2>/dev/null || stat -f%z "$ARCHIVE" 2>/dev/null || echo 0)
  local plafond=$(( ${DTP_HORSSITE_MAX_MO:-18} * 1024 * 1024 ))

  if [ "$octets" -gt "$plafond" ] 2>/dev/null; then
    printf '%s' "<p>L'archive de cette nuit ($TAILLE) depasse la taille envoyable par e-mail.</p><p>Sauvegarde locale VALIDE : <code>$ARCHIVE</code> sur le VPS.</p><p>La rapatrier depuis une machine externe : <code>scripts/vps/dtp-rapatrier.sh</code>.</p>" \
      | DEST_MAIL="$dest" docker exec -e DEST_MAIL -i "$CONTENEUR_ALERTE" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{require("/app/mailer").sendAdminAlert({subject:"DTP : sauvegarde trop volumineuse pour un envoi par e-mail",html:s,to:process.env.DEST_MAIL}).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});});' 2>&1 \
      && msg "copie hors-site : archive trop lourde (> ${DTP_HORSSITE_MAX_MO:-18} Mo), notice envoyee a $dest sans piece jointe" \
      || msg "copie hors-site : archive trop lourde, ET meme la notice a echoue"
    return 0
  fi

  if base64 -w0 "$ARCHIVE" \
       | DEST_MAIL="$dest" HORO="$HORO" TAILLE="$TAILLE" NOM_FICHIER="$NOM.tar.gz.gpg" \
         docker exec -e DEST_MAIL -e HORO -e TAILLE -e NOM_FICHIER -i "$CONTENEUR_ALERTE" node -e '
    let b64 = "";
    process.stdin.on("data", d => b64 += d).on("end", () => {
      const html = "<p>Sauvegarde quotidienne chiffree du " + process.env.HORO + " (" + process.env.TAILLE + "), en piece jointe.</p>"
        + "<p>Phrase de dechiffrement : dans votre gestionnaire de mots de passe, jamais dans cet e-mail.</p>";
      require("/app/mailer").sendAdminAlert({
        subject: "DTP : sauvegarde hors-site (piece jointe)",
        html,
        to: process.env.DEST_MAIL,
        attachments: [{ filename: process.env.NOM_FICHIER, contentType: "application/octet-stream", content: Buffer.from(b64, "base64") }],
      }).then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
    });' 2>&1; then
    msg "copie hors-site : archive envoyee par e-mail a $dest ($TAILLE)"
  else
    printf '%s' "<p>La copie hors-site (piece jointe) a ECHOUE cette nuit.</p><p>Sauvegarde locale VALIDE : <code>$ARCHIVE</code> sur le VPS.</p>" \
      | DEST_MAIL="$dest" docker exec -e DEST_MAIL -i "$CONTENEUR_ALERTE" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{require("/app/mailer").sendAdminAlert({subject:"DTP : la copie hors-site a ECHOUE (archive locale OK)",html:s,to:process.env.DEST_MAIL}).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});});' 2>&1 \
      && msg "copie hors-site : envoi de la piece jointe echoue, notice envoyee a $dest" \
      || msg "copie hors-site : envoi de la piece jointe echoue, ET la notice a aussi echoue"
  fi
}
_copie_hors_site || msg "copie hors-site : erreur inattendue, ignoree (l'archive locale reste valide)"

#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#   REDÉMARRAGE MENSUEL ENCADRÉ — ET SURTOUT, VÉRIFIÉ AU RETOUR
#   ────────────────────────────────────────────────────────────────────────────────────────────
#   POURQUOI REDÉMARRER. Le serveur avait 90 jours d'affilée au 07/09/2026. Sur une machine à
#   512 Mo qui fait tourner Chromium en continu (Puppeteer : FinancialJuice, ForexFactory,
#   Myfxbook), la mémoire non rendue et les processus zombies s'accumulent — il y en avait 20 ce
#   jour-là. Un redémarrage mensuel remet le compteur à zéro et applique les correctifs de noyau
#   déjà installés, qui ne prennent effet qu'au démarrage.
#
#   ⚠️ MAIS UN REDÉMARRAGE EST LE MOMENT OÙ UNE MACHINE RÉVÈLE QU'ELLE NE SAIT PAS REVENIR.
#   Programmer un redémarrage sans vérifier le retour, c'est programmer une panne un dimanche
#   matin, découverte le lundi par un client. La moitié utile de ce fichier est donc la SECONDE :
#   `--verifier`, qui tourne au démarrage suivant, attend que le desk réponde, et écrit pour dire
#   comment ça s'est passé. Sans elle, on n'aurait posé qu'un risque de plus.
#
#   LE CRÉNEAU N'EST PAS ARBITRAIRE. Le desk suit le forex : le marché ferme le vendredi soir et
#   rouvre le dimanche vers 22 h UTC (Sydney). Le premier dimanche du mois à 05h30 tombe donc en
#   plein marché fermé, après la sauvegarde de 04h10, et avant que quiconque n'ouvre son desk.
#
#   LES GARDES, ET CE QUE CHACUNE ÉVITE :
#     · déploiement en cours  → on redémarrerait au milieu d'une construction d'image
#     · sauvegarde en cours   → l'archive serait tronquée, donc inutilisable, sans le dire
#     · démarré il y a < 7 j  → la machine est déjà fraîche, redémarrer ne sert à rien
#     · desk déjà en panne    → on skip ET on alerte. Ce n'est PAS de la timidité : redémarrer une
#       machine déjà malade rend le retour illisible, on ne saurait plus dire si la panne
#       préexistait ou si le redémarrage l'a causée. C'est exactement l'ambiguïté qui fait perdre
#       des heures. Un humain doit regarder d'abord.
#
#   ⚠️ CE QUE CE FICHIER NE PEUT PAS COUVRIR, ET QU'IL FAUT SAVOIR : si la machine ne revient
#   JAMAIS, personne n'enverra d'e-mail — le messager est à bord. Ce trou-là se bouche depuis
#   l'extérieur seulement (une sonde type UptimeRobot sur /healthz). Le dire ici plutôt que de
#   laisser croire que la surveillance est complète.
#
#   USAGE :  dtp-redemarrage.sh --planifie   → le passage mensuel (minuteur)
#            dtp-redemarrage.sh --verifier   → le contrôle au démarrage (minuteur OnBootSec)
#            dtp-redemarrage.sh --etat       → ce que ferait le passage, sans rien faire
# ══════════════════════════════════════════════════════════════════════════════════════════════

set -uo pipefail

CONTENEUR="${DTP_CONTENEUR:-datatradingpro}"
URL="${DTP_URL:-https://desk.datatradingpro.com}"
ETAT_DIR="${DTP_REDEM_ETAT:-/var/lib/dtp-redemarrage}"
MARQUE="$ETAT_DIR/redemarrage-prevu"
MIN_JOURS=7            # en dessous, la machine est déjà fraîche
DELAI_MIN=2            # minutes entre l'annonce et la coupure (laisse partir l'e-mail)
ATTENTE_RETOUR=300     # secondes accordées au desk pour répondre après le démarrage

mkdir -p "$ETAT_DIR" 2>/dev/null
MODE="${1:---planifie}"

uptime_jours() { awk '{printf "%d", $1/86400}' /proc/uptime 2>/dev/null || echo 0; }
sante_ok() { curl -fsS --max-time 10 "$URL/healthz" >/dev/null 2>&1; }

# Même canal que la sentinelle disque : le mailer DÉJÀ chargé dans le conteneur, dont les clés sont
# déjà posées. Un second canal serait un second à maintenir, et à découvrir cassé le jour utile.
# Le corps passe par l'entrée standard — le mettre en ligne de commande imposerait d'échapper du
# HTML dans du shell dans un docker exec, et une apostrophe française suffirait à tout casser.
envoyer() {
  local sujet="$1" corps="$2"
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTENEUR"; then
    logger -t dtp-redemarrage "e-mail impossible (conteneur absent) : $sujet" 2>/dev/null
    echo "[redemarrage] conteneur absent — e-mail non envoye : $sujet" >&2
    return 1
  fi
  printf '%s' "$corps" | docker exec -i "$CONTENEUR" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{require("/app/mailer").sendAdminAlert({subject:process.argv[1],html:s,to:process.env.DISK_ALERT_EMAILS||["muhammedatay@outlook.fr",process.env.ADMIN_EMAIL].filter(Boolean).join(", ")}).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});});' "$sujet" 2>&1
}

# ── LE CONTRÔLE DU RETOUR ─────────────────────────────────────────────────────────────────────
# ⚠️ IL NE S'EXPRIME QUE SI C'EST NOUS QUI AVONS REDÉMARRÉ (marque posée juste avant la coupure).
# Sans cette condition, un redémarrage de l'hébergeur ou un `reboot` tapé à la main déclencherait
# un « redémarrage mensuel réussi » — un message faux, et un message faux use la confiance qu'on
# accorde à tous les autres.
if [ "$MODE" = "--verifier" ]; then
  [ -f "$MARQUE" ] || { echo "[redemarrage] aucun redemarrage planifie a controler"; exit 0; }
  PREVU=$(cat "$MARQUE" 2>/dev/null || echo 0)
  case "$PREVU" in ''|*[!0-9]*) PREVU=0;; esac
  rm -f "$MARQUE" 2>/dev/null
  # Marque vieille de plus de 2 h : ce n'est pas le démarrage qui suit notre coupure.
  if [ $(( $(date +%s) - PREVU )) -gt 7200 ]; then
    echo "[redemarrage] marque perimee, ignoree"; exit 0
  fi
  DEBUT=$(date +%s)
  while [ $(( $(date +%s) - DEBUT )) -lt "$ATTENTE_RETOUR" ]; do
    if sante_ok; then
      DUREE=$(( $(date +%s) - DEBUT ))
      DISQUE=$(df -P / 2>/dev/null | tail -1 | awk '{print $(NF-1)}')
      envoyer "Redemarrage mensuel : le desk est revenu" \
        "<p>Le desk repond a nouveau, <b>${DUREE} s</b> apres le demarrage.</p><p>Disque : <b>${DISQUE}</b> utilise.</p><pre>$(docker ps --format '{{.Names}} {{.Status}}' 2>&1 | sed 's/&/\&amp;/g; s/</\&lt;/g')</pre>" >/dev/null
      logger -t dtp-redemarrage "retour OK en ${DUREE}s" 2>/dev/null
      echo "[redemarrage] retour OK en ${DUREE}s"; exit 0
    fi
    sleep 10
  done
  envoyer "REDEMARRAGE MENSUEL : le desk N'EST PAS revenu" \
    "<p>Le desk ne repond toujours pas <b>${ATTENTE_RETOUR} s</b> apres le demarrage. Intervention requise.</p><pre>$(docker compose -f /opt/datatradingpro/docker-compose.yml ps 2>&1 | sed 's/&/\&amp;/g; s/</\&lt;/g')</pre><pre>$(docker compose -f /opt/datatradingpro/docker-compose.yml logs --tail 40 2>&1 | tail -40 | sed 's/&/\&amp;/g; s/</\&lt;/g')</pre>" >/dev/null
  logger -t dtp-redemarrage "ECHEC : desk absent apres ${ATTENTE_RETOUR}s" 2>/dev/null
  echo "[redemarrage] ECHEC : desk absent apres ${ATTENTE_RETOUR}s" >&2
  exit 1
fi

# ── LE PASSAGE MENSUEL ────────────────────────────────────────────────────────────────────────
J=$(uptime_jours)
REFUS=""
if [ "$J" -lt "$MIN_JOURS" ]; then REFUS="demarre il y a $J jour(s), la machine est deja fraiche"; fi
if [ -z "$REFUS" ] && systemctl is-active --quiet dtp-sauvegarde.service 2>/dev/null; then REFUS="sauvegarde en cours"; fi
# Le verrou du tireur d'auto-deploiement : s'il est pris, une construction d'image tourne.
if [ -z "$REFUS" ] && [ -e /run/dtp-autodeploiement.lock ]; then
  if ! flock -n 9 9>/run/dtp-autodeploiement.lock 2>/dev/null; then REFUS="deploiement en cours"; fi
fi
MALADE=""
if [ -z "$REFUS" ] && ! sante_ok; then MALADE="oui"; REFUS="le desk ne repond deja pas"; fi

if [ "$MODE" = "--etat" ]; then
  echo "uptime=${J}j  sante=$( sante_ok && echo OK || echo KO )"
  [ -n "$REFUS" ] && echo "ne redemarrerait PAS : $REFUS" || echo "redemarrerait dans ${DELAI_MIN} min"
  exit 0
fi

if [ -n "$REFUS" ]; then
  logger -t dtp-redemarrage "passage mensuel ignore : $REFUS" 2>/dev/null
  echo "[redemarrage] ignore : $REFUS"
  # Un desk deja en panne le jour du menage n'est pas un non-evenement : on le dit.
  if [ -n "$MALADE" ]; then
    envoyer "Redemarrage mensuel ANNULE : le desk etait deja en panne" \
      "<p>Le redemarrage mensuel n'a pas eu lieu : <b>/healthz ne repondait pas</b> au moment prevu.</p><p>Redemarrer une machine deja malade rendrait le diagnostic illisible — on ne saurait plus si la panne preexistait. Un regard humain est necessaire.</p>" >/dev/null
  fi
  exit 0
fi

RAISON="menage mensuel (uptime ${J} j)"
[ -f /var/run/reboot-required ] && RAISON="$RAISON + correctifs de noyau en attente"
date +%s > "$MARQUE" 2>/dev/null
envoyer "Redemarrage mensuel dans ${DELAI_MIN} min" \
  "<p>Redemarrage programme du VPS : <b>${RAISON}</b>.</p><p>Le desk sera indisponible environ une minute. Un second message confirmera son retour — ou son absence.</p>" >/dev/null
logger -t dtp-redemarrage "redemarrage dans ${DELAI_MIN} min ($RAISON)" 2>/dev/null
echo "[redemarrage] $RAISON — coupure dans ${DELAI_MIN} min"
shutdown -r +${DELAI_MIN} "Redemarrage mensuel DTP" >/dev/null 2>&1
exit 0

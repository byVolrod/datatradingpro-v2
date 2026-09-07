#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#   SENTINELLE DISQUE — SURVEILLE, PRÉVIENT TÔT, ET AGIT AVANT LA SATURATION
#   ────────────────────────────────────────────────────────────────────────────────────────────
#   POURQUOI ELLE EXISTE. Le 07/09/2026 le disque du VPS a atteint 100 %. Personne n'a été
#   prévenu, et les conséquences n'ont RIEN dit de leur cause :
#     · nginx ne pouvait plus écrire ses fichiers temporaires : il coupait toute réponse dépassant
#       ~750 Ko en plein envoi, SANS erreur HTTP — code 200, corps amputé. Un navigateur qui reçoit
#       moins d'octets que le Content-Length annoncé jette la ressource ENTIÈRE : le desk arrivait
#       en HTML nu, sans style ni script. On a cherché la panne du côté de l'authentification
#       pendant des heures, parce qu'elle n'apparaissait qu'APRÈS le login — la page de connexion
#       porte ses styles en <style> inline et survivait, seule, à la troncature.
#     · Docker ne pouvait plus construire : le correctif poussé ce jour-là n'a jamais pu se
#       déployer. La panne empêchait sa propre réparation.
#     · La sauvegarde chiffrée quotidienne échouait en silence depuis plusieurs jours.
#   Trois pannes sans rapport apparent, une seule cause, et aucun signal nulle part. D'où ce fichier.
#
#   CE QU'ELLE FAIT, ET POURQUOI DANS CET ORDRE.
#     1. Elle MESURE le remplissage.
#     2. Elle PROJETTE : à partir de l'historique, elle estime dans combien de jours on touchera
#        100 %. C'est le cœur de l'affaire — un disque à 68 % qui gagne 4 points par jour est plus
#        urgent qu'un disque à 82 % stable depuis six mois. Un seuil, seul, ne dit jamais cela.
#     3. Elle ALERTE par paliers, sans répéter ce qui a déjà été dit.
#     4. À 95 %, elle NETTOIE d'elle-même. À ce stade, attendre un humain revient à accepter la panne.
#
#   ⚠️ CE QU'ELLE NE SUPPRIME JAMAIS, À AUCUN SEUIL :
#     · les montages liés data/* (anti-doublon des e-mails, profils Chromium, pdf_cache)
#     · l'image de l'application EN SERVICE (Docker la protège : un conteneur tourne dessus)
#     · le .env, les sauvegardes, la base
#   Elle ne touche QU'À trois choses : les images qu'aucun conteneur n'utilise, le cache de
#   construction, et les journaux systemd. Toutes se régénèrent seules ; leur perte ne coûte que
#   du temps de reconstruction, jamais une donnée.
#
#   USAGE :  dtp-disque.sh            → passage normal (celui du minuteur)
#            dtp-disque.sh --etat     → affiche l'état ; n'alerte pas, ne nettoie pas
#            dtp-disque.sh --test     → force un e-mail, pour vérifier que le canal fonctionne
# ══════════════════════════════════════════════════════════════════════════════════════════════

# Pas de `set -e` : une sentinelle qui meurt à la première commande capricieuse est PIRE qu'absente,
# parce qu'elle laisse croire qu'on est surveillé. Chaque étape gère son propre échec.
set -uo pipefail

POINT_MONTAGE="${DTP_DISQUE_POINT:-/}"
CONTENEUR="${DTP_CONTENEUR:-datatradingpro}"
ETAT_DIR="${DTP_DISQUE_ETAT:-/var/lib/dtp-disque}"
HISTORIQUE="$ETAT_DIR/historique"
ETAT="$ETAT_DIR/niveau"
DERNIER_MAIL="$ETAT_DIR/dernier-mail"
DERNIER_MENAGE="$ETAT_DIR/dernier-menage"

# Les cinq paliers demandés. Ils vivent ICI, nommés, en haut du fichier — pas dispersés dans le code.
SEUIL_SURVEILLANCE=70   # on note, on n'écrit à personne : à 70 % rien n'est encore anormal
SEUIL_ALERTE=80         # premier e-mail
SEUIL_CRITIQUE=90       # e-mail + diagnostic automatique des gros postes
SEUIL_ACTION=95         # nettoyage automatique
PREVISION_JOURS=7       # sous ce délai avant saturation, on alerte MÊME si le pourcentage est bas

mkdir -p "$ETAT_DIR" 2>/dev/null
MODE="${1:-}"

# ── 1. MESURE ─────────────────────────────────────────────────────────────────────────────────
# `df -P` fige le format POSIX. Sans lui, un point de montage au nom long passe à la ligne et
# décale toutes les colonnes : le script lirait un pourcentage qui n'existe pas.
#
# ⚠️ ON COMPTE LES COLONNES DEPUIS LA FIN, ET CE N'EST PAS UN CAPRICE. Un nom de périphérique
# CONTENANT UN ESPACE (certains montages réseau, et Git Bash sous Windows où il vaut
# « C:/Program Files/Git ») décale tout le découpage d'awk : lu depuis le début, le pourcentage
# devenait « 134271896% » et le disque « 0.0 Go ». Constaté au banc, avant mise en service.
# Depuis la fin, les colonnes sont stables : NF = point de montage, NF-1 = pourcentage,
# NF-2 = disponible, NF-4 = taille totale.
LIGNE=$(df -P "$POINT_MONTAGE" 2>/dev/null | tail -1)
PCT=$(echo "$LIGNE" | awk '{gsub(/%/,"",$(NF-1)); print $(NF-1)}')
LIBRE_KO=$(echo "$LIGNE" | awk '{print $(NF-2)}')
TOTAL_KO=$(echo "$LIGNE" | awk '{print $(NF-4)}')
case "$PCT" in ''|*[!0-9]*) echo "[disque] mesure illisible : $LIGNE" >&2; exit 1;; esac
LIBRE_GO=$(awk -v k="$LIBRE_KO" 'BEGIN{printf "%.1f", k/1048576}')
TOTAL_GO=$(awk -v k="$TOTAL_KO" 'BEGIN{printf "%.1f", k/1048576}')
MAINTENANT=$(date +%s)

# ── 2. HISTORIQUE ET PROJECTION ───────────────────────────────────────────────────────────────
# On garde 30 jours. Une régression des moindres carrés sur les 7 derniers donne la pente en points
# par jour, donc le délai avant 100 %. C'est ce chiffre qui permet d'agir AVANT, pas de constater APRÈS.
echo "$MAINTENANT $PCT" >> "$HISTORIQUE" 2>/dev/null
if [ -f "$HISTORIQUE" ]; then
  LIMITE=$((MAINTENANT - 30*86400))
  awk -v l="$LIMITE" '$1 >= l' "$HISTORIQUE" > "$HISTORIQUE.tmp" 2>/dev/null && mv "$HISTORIQUE.tmp" "$HISTORIQUE" 2>/dev/null
fi
# Renvoie "" si moins de 3 points, ou si le disque ne monte pas : REFUSER DE PRÉDIRE vaut toujours
# mieux que prédire n'importe quoi sur deux mesures. Une fausse échéance ferait perdre confiance
# dans l'alerte, et c'est la confiance qui fait qu'on la lit le jour où elle compte.
JOURS_RESTANTS=$(awk -v l=$((MAINTENANT - 7*86400)) -v now="$MAINTENANT" -v cur="$PCT" '
  $1 >= l { n++; x=($1-now)/86400; sx+=x; sy+=$2; sxx+=x*x; sxy+=x*$2 }
  END {
    if (n < 3) exit;
    d = n*sxx - sx*sx; if (d == 0) exit;
    pente = (n*sxy - sx*sy)/d;
    if (pente <= 0.05) exit;
    printf "%.1f", (100-cur)/pente;
  }' "$HISTORIQUE" 2>/dev/null)

# ── 3. NIVEAU ─────────────────────────────────────────────────────────────────────────────────
if   [ "$PCT" -ge "$SEUIL_ACTION" ];       then NIVEAU=4; NOM="ACTION PREVENTIVE"
elif [ "$PCT" -ge "$SEUIL_CRITIQUE" ];     then NIVEAU=3; NOM="CRITIQUE"
elif [ "$PCT" -ge "$SEUIL_ALERTE" ];       then NIVEAU=2; NOM="ALERTE"
elif [ "$PCT" -ge "$SEUIL_SURVEILLANCE" ]; then NIVEAU=1; NOM="surveillance"
else                                            NIVEAU=0; NOM="normal"
fi
# La projection peut FAIRE MONTER le niveau, jamais le faire baisser : un disque à 62 % qui sature
# dans trois jours mérite le même e-mail qu'un disque à 80 % stable. C'est tout l'intérêt du calcul.
MOTIF_PROJECTION=""
if [ -n "$JOURS_RESTANTS" ] && awk -v j="$JOURS_RESTANTS" -v s="$PREVISION_JOURS" 'BEGIN{exit !(j<=s)}'; then
  MOTIF_PROJECTION="saturation projetee dans ${JOURS_RESTANTS} jour(s) au rythme actuel"
  if [ "$NIVEAU" -lt 2 ]; then NIVEAU=2; NOM="ALERTE (projection)"; fi
fi

PRECEDENT=$(cat "$ETAT" 2>/dev/null || echo 0)
case "$PRECEDENT" in ''|*[!0-9]*) PRECEDENT=0;; esac
echo "$NIVEAU" > "$ETAT" 2>/dev/null

RESUME="$PCT% utilise - ${LIBRE_GO} Go libres sur ${TOTAL_GO} Go"
if [ -n "$MOTIF_PROJECTION" ]; then RESUME="$RESUME - $MOTIF_PROJECTION"; fi

if [ "$MODE" = "--etat" ]; then
  echo "niveau=$NIVEAU ($NOM)  $RESUME"
  if [ -n "$JOURS_RESTANTS" ]; then echo "projection : 100 % dans ${JOURS_RESTANTS} jour(s)"; fi
  exit 0
fi

# ── 4. DIAGNOSTIC (à partir du niveau critique) ───────────────────────────────────────────────
diagnostic() {
  echo "=== df -h ==="
  df -h "$POINT_MONTAGE" 2>&1
  echo
  echo "=== docker system df ==="
  docker system df 2>&1
  echo
  echo "=== plus gros dossiers ==="
  du -xh --max-depth=2 / 2>/dev/null | sort -rh | head -12
  echo
  echo "=== journaux systemd ==="
  journalctl --disk-usage 2>&1
}

# ── 5. NETTOYAGE PRÉVENTIF (niveau 4 uniquement) ──────────────────────────────────────────────
# Garde-fou : pas plus d'un ménage par heure. Sans lui, un disque saturé par AUTRE CHOSE que Docker
# relancerait la purge tous les quarts d'heure sans jamais rien gagner, en masquant la vraie cause.
menage() {
  local dernier
  dernier=$(cat "$DERNIER_MENAGE" 2>/dev/null || echo 0)
  case "$dernier" in ''|*[!0-9]*) dernier=0;; esac
  if [ $((MAINTENANT - dernier)) -lt 3600 ]; then
    echo "(menage deja effectue il y a moins d'une heure - on ne recommence pas)"
    return 0
  fi
  echo "$MAINTENANT" > "$DERNIER_MENAGE" 2>/dev/null
  echo "-> images sans conteneur :"
  docker image prune -a -f 2>&1 | tail -2
  echo "-> cache de construction :"
  docker builder prune -a -f 2>&1 | tail -2
  echo "-> journaux systemd :"
  journalctl --vacuum-size=200M 2>&1 | tail -2
}

# ── 6. ALERTE ─────────────────────────────────────────────────────────────────────────────────
# Le canal : le mailer de l'application, via le conteneur. C'est celui qui fonctionne déjà et dont
# les clés sont déjà posées — en ouvrir un second, c'est un second à maintenir et à oublier.
# Le corps passe par l'ENTRÉE STANDARD : le mettre dans la ligne de commande obligerait à échapper
# des guillemets dans du HTML dans du shell dans un docker exec. Quatre niveaux de citation, et une
# apostrophe française suffit à tout faire sauter.
envoyer() {
  local sujet="$1" corps="$2"
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTENEUR"; then
    echo "[disque] conteneur $CONTENEUR absent - alerte non envoyee par e-mail" >&2
    logger -t dtp-disque "ALERTE NON ENVOYEE (conteneur absent) : $sujet" 2>/dev/null
    return 1
  fi
  printf '%s' "$corps" | docker exec -i "$CONTENEUR" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{require("/app/mailer").sendAdminAlert({subject:process.argv[1],html:s}).then(r=>{console.log(r?"envoye ("+r+")":"non envoye");process.exit(0);}).catch(e=>{console.error("echec:",e.message);process.exit(1);});});' "$sujet" 2>&1
}

# Anti-répétition : on écrit quand le niveau MONTE, une fois par jour tant qu'on reste haut, et une
# fois quand tout est rentré dans l'ordre. Une alerte qui arrive tous les quarts d'heure finit dans
# une règle de tri — et c'est précisément le jour où elle comptait qu'on ne la lira pas.
DERNIER=$(cat "$DERNIER_MAIL" 2>/dev/null || echo 0)
case "$DERNIER" in ''|*[!0-9]*) DERNIER=0;; esac
DOIT_ECRIRE=0
if [ "$NIVEAU" -ge 2 ] && [ "$NIVEAU" -gt "$PRECEDENT" ]; then DOIT_ECRIRE=1; fi
if [ "$NIVEAU" -ge 2 ] && [ $((MAINTENANT - DERNIER)) -ge 86400 ]; then DOIT_ECRIRE=1; fi
if [ "$NIVEAU" -eq 0 ] && [ "$PRECEDENT" -ge 2 ]; then DOIT_ECRIRE=2; fi
if [ "$MODE" = "--test" ]; then DOIT_ECRIRE=1; fi

CORPS="<p><b>$RESUME</b></p>"
if [ -n "$JOURS_RESTANTS" ]; then
  CORPS="$CORPS<p>Au rythme des 7 derniers jours, saturation dans <b>${JOURS_RESTANTS} jour(s)</b>.</p>"
fi
if [ "$NIVEAU" -ge 3 ]; then
  CORPS="$CORPS<p>Diagnostic automatique :</p><pre>$(diagnostic | sed 's/&/\&amp;/g; s/</\&lt;/g')</pre>"
fi
if [ "$NIVEAU" -ge 4 ]; then
  SORTIE_MENAGE=$(menage)
  APRES=$(df -P "$POINT_MONTAGE" 2>/dev/null | tail -1 | awk '{gsub(/%/,"",$(NF-1)); print $(NF-1)}')
  CORPS="$CORPS<p><b>Nettoyage automatique declenche</b> (images sans conteneur, cache de construction, journaux). Aucune donnee, aucun volume touche.</p><pre>$(echo "$SORTIE_MENAGE" | sed 's/&/\&amp;/g; s/</\&lt;/g')</pre><p>Apres nettoyage : <b>${APRES}%</b> (avant : ${PCT}%).</p>"
  echo "[disque] menage execute : $PCT% -> ${APRES}%"
fi

if [ "$DOIT_ECRIRE" = "2" ]; then
  envoyer "Disque revenu a la normale ($PCT%)" "<p>Le disque du VPS est redescendu a <b>$PCT%</b> (${LIBRE_GO} Go libres). Plus aucune alerte en cours.</p>" >/dev/null
  echo "$MAINTENANT" > "$DERNIER_MAIL" 2>/dev/null
elif [ "$DOIT_ECRIRE" = "1" ]; then
  envoyer "[$NOM] Disque VPS a $PCT%" "$CORPS"
  echo "$MAINTENANT" > "$DERNIER_MAIL" 2>/dev/null
fi

logger -t dtp-disque "niveau=$NIVEAU ($NOM) $RESUME" 2>/dev/null
echo "[disque] $NOM - $RESUME"
exit 0

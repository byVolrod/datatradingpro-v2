#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#   SENTINELLE DISQUE — WATCHDOG OS INDÉPENDANT, PROTECTION MULTI-NIVEAUX, FAIL-SAFE
#   ────────────────────────────────────────────────────────────────────────────────────────────
#   Atteindre 100 % est traité ici comme une FAILLE CRITIQUE, pas comme un dépassement de seuil.
#   Toute la logique vise une seule garantie : on ne peut pas arriver à saturation sans qu'un
#   mécanisme se soit déclenché AVANT, avec de la marge pour agir.
#
#   POURQUOI ELLE VIT AU NIVEAU DE L'OS (bash + systemd), ET PAS SEULEMENT DANS LE DESK. Le 07/09
#   le disque a atteint 100 %. Dans cet état, nginx ne peut plus écrire ses fichiers temporaires et
#   TRONQUE toute réponse de plus de ~750 Ko sans erreur HTTP — le desk arrive sans style ni script.
#   Le moniteur applicatif (server.js) verrait le problème, mais il MEURT avec le desk : quand on a
#   le plus besoin de lui, il n'est plus là. Ce script-ci ne dépend ni de Node, ni du conteneur, ni
#   du réseau. C'est le filet qui reste tendu quand tout le reste est tombé.
#
#   CINQ PALIERS (surchargables par l'environnement — voir l'installateur) :
#     70  SURVEILLANCE  on note, personne n'est dérangé
#     80  ALERTE        e-mail
#     90  CRITIQUE      e-mail + diagnostic automatique
#     95  URGENCE       nettoyage sécurisé + re-mesure + e-mail (le frein applicatif s'active aussi)
#     98  DERNIER RECOURS  on SUPPRIME LE BALLAST d'abord (espace vital instantané), puis nettoyage
#                          agressif, re-mesure, e-mail critique. On ne laisse RIEN grossir.
#
#   ⚠️ TROIS CRITÈRES, PAS UN SEUL POURCENTAGE. Un disque à 95 % avec 1 Go libre pendant qu'une
#   génération peut produire plusieurs Go en minutes, ce n'est PAS protégé par le seul « 95 % ».
#   Le niveau est donc le MAXIMUM de trois lectures :
#     · le pourcentage (ci-dessus) ;
#     · un PLANCHER EN GO ABSOLUS (un petit disque et un gros ne « tolèrent » pas le même %) ;
#     · une GARDE DE VITESSE sur l'heure écoulée : une rafale qui projette 100 % à court terme
#       fait monter le niveau quel que soit le pourcentage courant.
#   Une escalade ne fait que MONTER le niveau, jamais le baisser : le pire des trois gagne.
#
#   ⚠️ LE FICHIER TAMPON (BALLAST), ET POURQUOI IL EST VITAL. Près de 100 %, il n'y a souvent plus
#   assez de place pour que le nettoyage lui-même s'exécute (« No space left on device » sur le
#   script de survie — le comble). Un fichier inerte de 1 Go est donc posé en permanence ; à 98 %,
#   la TOUTE PREMIÈRE action est de le supprimer, ce qui rend 1 Go instantanément et permet aux
#   commandes lourdes de tourner. Il est recréé dès qu'on repasse sous le seuil critique.
#
#   ⚠️ CE QU'ELLE NE SUPPRIME JAMAIS, À AUCUN NIVEAU : les montages liés data/* (anti-doublon des
#   e-mails, profils Chromium, pdf_cache utile), l'image EN SERVICE (Docker la protège), le .env,
#   les sauvegardes, la base. Elle ne touche QU'À du régénérable : images sans conteneur, cache de
#   construction, journaux systemd, et son propre ballast.
#
#   ⚠️ CE QU'ELLE NE PEUT PAS COUVRIR, écrit plutôt que sous-entendu : si la machine ne répond plus
#   DU TOUT, aucun message ne partira — le messager est à bord. Ce trou ne se bouche que depuis
#   l'extérieur (sonde type UptimeRobot sur /healthz). Voir scripts/vps/RESTAURATION.md.
#
#   USAGE :
#     dtp-disque.sh                     passage normal (minuteur systemd)
#     dtp-disque.sh --etat              mesure réelle, n'alerte pas, ne nettoie pas
#     dtp-disque.sh --test              force un e-mail (vérifie le canal)
#     dtp-disque.sh --simuler P [G] [V] décision pour P%, G Go libres, V %/h — SANS effet de bord
#                                       (sert au banc : éprouver chaque seuil sans remplir le disque)
# ══════════════════════════════════════════════════════════════════════════════════════════════

# Pas de `set -e` : une sentinelle qui meurt à la première commande capricieuse est PIRE qu'absente,
# elle laisse croire qu'on est surveillé. Chaque étape gère son propre échec.
set -uo pipefail

POINT_MONTAGE="${DTP_DISQUE_POINT:-/}"
CONTENEUR="${DTP_CONTENEUR:-datatradingpro}"
URL="${DTP_URL:-https://desk.datatradingpro.com}"
ETAT_DIR="${DTP_DISQUE_ETAT:-/var/lib/dtp-disque}"
HISTORIQUE="$ETAT_DIR/historique"
ETAT="$ETAT_DIR/niveau"
DERNIER_MAIL="$ETAT_DIR/dernier-mail"
DERNIER_MENAGE="$ETAT_DIR/dernier-menage"
CLEAN_LOG="$ETAT_DIR/nettoyages.log"
BALLAST="${DTP_BALLAST:-$ETAT_DIR/ballast.tampon}"
VERROU_DEPLOIEMENT="/run/dtp-autodeploiement.lock"

# ── LES CINQ PALIERS (%), surchargables ────────────────────────────────────────────────────────
SEUIL_SURVEILLANCE="${DTP_SEUIL_SURVEILLANCE:-70}"
SEUIL_ALERTE="${DTP_SEUIL_ALERTE:-80}"
SEUIL_CRITIQUE="${DTP_SEUIL_CRITIQUE:-90}"
SEUIL_URGENCE="${DTP_SEUIL_URGENCE:-95}"
SEUIL_DERNIER="${DTP_SEUIL_DERNIER:-98}"
# ── PLANCHERS EN GO LIBRES (le second critère) ──────────────────────────────────────────────────
GO_ALERTE="${DTP_GO_ALERTE:-2.0}"      # sous 2 Go libres → au moins ALERTE
GO_CRITIQUE="${DTP_GO_CRITIQUE:-1.0}"  # sous 1 Go libres → au moins CRITIQUE
GO_URGENCE="${DTP_GO_URGENCE:-0.5}"    # sous 0,5 Go libres → au moins URGENCE
# ── GARDE DE VITESSE (le troisième critère) ──────────────────────────────────────────────────────
PREVISION_JOURS="${DTP_PREVISION_JOURS:-7}"   # tendance longue : projette 100 % sous 7 j → ALERTE
BALLAST_MO="${DTP_BALLAST_MO:-1024}"          # taille du fichier tampon

mkdir -p "$ETAT_DIR" 2>/dev/null
MODE="${1:-}"

# ── MESURE ──────────────────────────────────────────────────────────────────────────────────────
# ⚠️ COLONNES LUES DEPUIS LA FIN : un nom de périphérique contenant un espace (montage réseau, ou
# Git Bash « C:/Program Files/Git ») décale tout découpage fait depuis le début — mesuré au banc,
# le pourcentage sortait à « 134271896% ». Depuis la fin, les positions sont stables.
_mesurer() {
  local ligne
  ligne=$(df -P "$POINT_MONTAGE" 2>/dev/null | tail -1)
  [ -z "$ligne" ] && return 1
  PCT=$(echo "$ligne" | awk '{gsub(/%/,"",$(NF-1)); print $(NF-1)}')
  local libreKo totalKo
  libreKo=$(echo "$ligne" | awk '{print $(NF-2)}')
  totalKo=$(echo "$ligne" | awk '{print $(NF-4)}')
  case "$PCT" in ''|*[!0-9]*) return 1;; esac
  LIBRE_GO=$(awk -v k="$libreKo" 'BEGIN{printf "%.1f", k/1048576}')
  TOTAL_GO=$(awk -v k="$totalKo" 'BEGIN{printf "%.1f", k/1048576}')
  return 0
}

# Vitesse sur l'heure écoulée → jours restants avant 100 %. Renvoie "" sous 2 points ou si ça ne
# monte pas. Sert la GARDE DE VITESSE (rafale) ; la tendance longue (7 j) réutilise la même idée
# sur 7 jours d'historique via _projection_jours.
_projection_courte_h() {
  local pct="$1" now; now=$(date +%s)
  awk -v l=$((now - 3600)) -v now="$now" -v cur="$pct" '
    $1 >= l { n++; x=($1-now)/3600; sx+=x; sy+=$2; sxx+=x*x; sxy+=x*$2 }
    END { if (n < 2) exit; d=n*sxx-sx*sx; if (d==0) exit;
          p=(n*sxy-sx*sy)/d; if (p<=0.1) exit; printf "%.1f", (100-cur)/p; }' "$HISTORIQUE" 2>/dev/null
}
_projection_jours() {
  local pct="$1" now; now=$(date +%s)
  awk -v l=$((now - 7*86400)) -v now="$now" -v cur="$pct" '
    $1 >= l { n++; x=($1-now)/86400; sx+=x; sy+=$2; sxx+=x*x; sxy+=x*$2 }
    END { if (n < 3) exit; d=n*sxx-sx*sx; if (d==0) exit;
          p=(n*sxy-sx*sy)/d; if (p<=0.05) exit; printf "%.1f", (100-cur)/p; }' "$HISTORIQUE" 2>/dev/null
}

# ── DÉCISION DE NIVEAU (fonction PURE : mêmes entrées → même sortie, aucun effet de bord) ─────────
# C'est le cœur testable. --simuler l'appelle avec des valeurs injectées ; le passage réel avec la
# mesure. Elle pose NIVEAU, NOM, et MOTIF (ce qui a fait monter au-delà du simple pourcentage).
_decider() {
  local pct="$1" go="$2" heures_courtes="$3" jours_longs="$4"
  NIVEAU=0; NOM="normal"; MOTIF=""
  # 1) le pourcentage
  if   [ "$pct" -ge "$SEUIL_DERNIER" ];      then NIVEAU=5; NOM="DERNIER RECOURS"
  elif [ "$pct" -ge "$SEUIL_URGENCE" ];      then NIVEAU=4; NOM="URGENCE"
  elif [ "$pct" -ge "$SEUIL_CRITIQUE" ];     then NIVEAU=3; NOM="CRITIQUE"
  elif [ "$pct" -ge "$SEUIL_ALERTE" ];       then NIVEAU=2; NOM="ALERTE"
  elif [ "$pct" -ge "$SEUIL_SURVEILLANCE" ]; then NIVEAU=1; NOM="surveillance"
  fi
  # 2) le plancher en Go absolus (peut monter le niveau)
  local esc=0
  if   awk -v g="$go" -v s="$GO_URGENCE" 'BEGIN{exit !(g<s)}'; then esc=4
  elif awk -v g="$go" -v s="$GO_CRITIQUE" 'BEGIN{exit !(g<s)}'; then esc=3
  elif awk -v g="$go" -v s="$GO_ALERTE" 'BEGIN{exit !(g<s)}'; then esc=2
  fi
  if [ "$esc" -gt "$NIVEAU" ]; then NIVEAU=$esc; NOM="$(_nom $esc)"; MOTIF="seulement ${go} Go libres"; fi
  # 3) la garde de vitesse — une rafale projetant 100 % à court terme
  if [ -n "$heures_courtes" ]; then
    local e2=0
    if   awk -v h="$heures_courtes" 'BEGIN{exit !(h<=0.5)}'; then e2=4
    elif awk -v h="$heures_courtes" 'BEGIN{exit !(h<=2)}';   then e2=3
    fi
    if [ "$e2" -gt "$NIVEAU" ]; then NIVEAU=$e2; NOM="$(_nom $e2)"; MOTIF="remplissage rapide : 100% projeté dans ${heures_courtes} h"; fi
  fi
  # tendance longue : early-warning à bas pourcentage
  if [ -n "$jours_longs" ] && awk -v j="$jours_longs" -v s="$PREVISION_JOURS" 'BEGIN{exit !(j<=s)}'; then
    if [ "$NIVEAU" -lt 2 ]; then NIVEAU=2; NOM="ALERTE (tendance)"; fi
    [ -z "$MOTIF" ] && MOTIF="saturation projetée dans ${jours_longs} j au rythme actuel"
  fi
}
_nom() { case "$1" in 5) echo "DERNIER RECOURS";; 4) echo "URGENCE";; 3) echo "CRITIQUE";; 2) echo "ALERTE";; 1) echo "surveillance";; *) echo "normal";; esac; }

# ── LE BALLAST ──────────────────────────────────────────────────────────────────────────────────
_ballast_pose()   { [ -f "$BALLAST" ] && return 0; fallocate -l "${BALLAST_MO}M" "$BALLAST" 2>/dev/null || dd if=/dev/zero of="$BALLAST" bs=1M count="$BALLAST_MO" 2>/dev/null; }
_ballast_retire() { [ -f "$BALLAST" ] || return 1; rm -f "$BALLAST" 2>/dev/null && return 0 || return 1; }

# ── SIMULATION (aucun effet de bord — pour le banc et le diagnostic) ─────────────────────────────
if [ "$MODE" = "--simuler" ]; then
  P="${2:-0}"; G="${3:-999}"; V="${4:-}"
  _decider "$P" "$G" "$V" ""
  echo "niveau=$NIVEAU nom=$NOM${MOTIF:+ motif=$MOTIF}"
  case "$NIVEAU" in
    5) echo "actions: SUPPRESSION BALLAST -> nettoyage agressif -> re-mesure -> e-mail critique";;
    4) echo "actions: nettoyage securise -> re-mesure -> e-mail (frein applicatif actif)";;
    3) echo "actions: e-mail + diagnostic";;
    2) echo "actions: e-mail";;
    1) echo "actions: note seule";;
    *) echo "actions: aucune";;
  esac
  exit 0
fi

# ── SANTÉ DU DESK (le volet watchdog) ────────────────────────────────────────────────────────────
_desk_ok() { curl -fsS --max-time 10 "$URL/healthz" >/dev/null 2>&1; }

# ── E-MAIL, via le mailer déjà chargé dans le conteneur ──────────────────────────────────────────
# Corps par l'entrée standard : le mettre en ligne de commande imposerait d'échapper du HTML dans du
# shell dans un docker exec — une apostrophe française suffirait à tout casser.
_dest() { echo "${DISK_ALERT_EMAILS:-muhammedatay@outlook.fr}"; }
_envoyer() {
  local sujet="$1" corps="$2"
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTENEUR"; then
    logger -t dtp-disque "e-mail impossible (conteneur absent) : $sujet" 2>/dev/null
    echo "[disque] conteneur absent — e-mail non envoye : $sujet" >&2; return 1
  fi
  printf '%s' "$corps" | DEST="$(_dest)" docker exec -e DEST -i "$CONTENEUR" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{require("/app/mailer").sendAdminAlert({subject:process.argv[1],html:s,to:process.env.DEST}).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});});' "$sujet" 2>&1
}

_echapper() { sed 's/&/\&amp;/g; s/</\&lt;/g'; }
_diagnostic() {
  echo "=== df -h ==="; df -h "$POINT_MONTAGE" 2>&1
  echo; echo "=== docker system df ==="; docker system df 2>&1
  echo; echo "=== plus gros dossiers ==="; du -xh --max-depth=2 / 2>/dev/null | sort -rh | head -12
  echo; echo "=== journaux systemd ==="; journalctl --disk-usage 2>&1
}

# ── NETTOYAGE SÉCURISÉ, VÉRIFIÉ, ET JOURNALISÉ ───────────────────────────────────────────────────
# ⚠️ NE JAMAIS conclure « nettoyé » parce que la commande a rendu 0 : elle peut échouer en silence
# (permissions). On RE-MESURE après, on journalise l'espace RÉELLEMENT récupéré, et on ré-alerte si
# le seuil critique tient toujours. C'est la différence entre agir et croire avoir agi.
# ⚠️ On respecte le VERROU DE DÉPLOIEMENT : purger des images pendant une construction est une course.
# Si le verrou est pris, on saute les purges Docker et on fait le reste (journaux, ballast).
# ⚠️ ON N'APPELLE PAS `_menage` DANS UN `$(…)`. Une substitution de commande s'exécute dans un
# SOUS-SHELL : `SORTIE_MENAGE_APRES` (la re-mesure) n'en remonterait JAMAIS, et la garde « reste à
# X % APRÈS nettoyage » — le cœur du « ne jamais croire un nettoyage sur parole » — ne se
# déclencherait pas. La fonction accumule donc son texte dans la variable globale MENAGE_TXT et
# tourne dans le shell courant. Bug attrapé en relecture, invisible à la simulation (qui ne nettoie pas).
_log_menage() { echo "$1"; MENAGE_TXT="${MENAGE_TXT}${1}
"; }
_menage() {
  local agressif="$1" avant apres deploiement=""
  avant="$PCT"; MENAGE_TXT=""
  if [ -e "$VERROU_DEPLOIEMENT" ] && ! flock -n 9 9>"$VERROU_DEPLOIEMENT" 2>/dev/null; then
    deploiement="oui"; _log_menage "-> deploiement en cours : purges Docker sautees (on ne coupe pas un build)"
  else
    _log_menage "-> images sans conteneur : $(docker image prune -a -f --filter until=168h 2>&1 | tail -1)"
    _log_menage "-> cache de construction : $(docker builder prune -f 2>&1 | tail -1)"
    if [ "$agressif" = "agressif" ]; then
      _log_menage "-> images sans conteneur (toutes) : $(docker image prune -a -f 2>&1 | tail -1)"
    fi
  fi
  _log_menage "-> journaux systemd : $(journalctl --vacuum-size="$([ "$agressif" = "agressif" ] && echo 100M || echo 200M)" 2>&1 | tail -1)"
  # ⚠️ RE-MESURER, ne jamais conclure « nettoyé » sur le code de retour d'une commande : un échec de
  # permissions passe 0 en silence. C'est la re-mesure qui dit si le problème est RÉELLEMENT résolu.
  _mesurer; apres="$PCT"
  _log_menage "-> disque : ${avant}% -> ${apres}%"
  local partage="${DTP_CLEAN_SHARED:-/opt/datatradingpro/data/app/disque_nettoyages.log}"
  local ligne="$(date +%s) niveau=$NIVEAU avant=${avant}% apres=${apres}% deploiement=${deploiement:-non}"
  echo "$ligne" >> "$CLEAN_LOG" 2>/dev/null
  tail -n 200 "$CLEAN_LOG" > "$CLEAN_LOG.tmp" 2>/dev/null && mv "$CLEAN_LOG.tmp" "$CLEAN_LOG" 2>/dev/null
  # Copie sur le volume PARTAGÉ avec le conteneur → visible dans le panneau admin (observabilité).
  [ -d "$(dirname "$partage")" ] && { echo "$ligne" >> "$partage" 2>/dev/null; tail -n 200 "$partage" > "$partage.tmp" 2>/dev/null && mv "$partage.tmp" "$partage" 2>/dev/null; }
  SORTIE_MENAGE_APRES="$apres"
}

# ══════════════════════════════════════════════════════════════════════════════════════════════
#   PASSAGE
# ══════════════════════════════════════════════════════════════════════════════════════════════
if ! _mesurer; then echo "[disque] mesure illisible" >&2; exit 1; fi
NOW=$(date +%s)
echo "$NOW $PCT" >> "$HISTORIQUE" 2>/dev/null
awk -v l=$((NOW - 30*86400)) '$1 >= l' "$HISTORIQUE" > "$HISTORIQUE.tmp" 2>/dev/null && mv "$HISTORIQUE.tmp" "$HISTORIQUE" 2>/dev/null

H_COURT=$(_projection_courte_h "$PCT")
J_LONG=$(_projection_jours "$PCT")
_decider "$PCT" "$LIBRE_GO" "$H_COURT" "$J_LONG"

PRECEDENT=$(cat "$ETAT" 2>/dev/null || echo 0); case "$PRECEDENT" in ''|*[!0-9]*) PRECEDENT=0;; esac
echo "$NIVEAU" > "$ETAT" 2>/dev/null

# Le desk est-il tombé ? watchdog : desk HS + disque déjà tendu = on agit sans attendre le seuil.
DESK_HS=""
if ! _desk_ok; then DESK_HS="oui"; if [ "$NIVEAU" -lt 3 ] && [ "$PCT" -ge "$SEUIL_CRITIQUE" ]; then NIVEAU=3; NOM="CRITIQUE (desk injoignable)"; fi; fi

RESUME="$PCT% utilise — ${LIBRE_GO} Go libres sur ${TOTAL_GO} Go${MOTIF:+ — $MOTIF}"

if [ "$MODE" = "--etat" ]; then
  echo "niveau=$NIVEAU ($NOM)  $RESUME"
  [ -n "$H_COURT" ] && echo "vitesse courte : 100% dans ${H_COURT} h"
  [ -n "$J_LONG" ] && echo "tendance longue : 100% dans ${J_LONG} j"
  echo "desk: $([ -n "$DESK_HS" ] && echo INJOIGNABLE || echo OK)   ballast: $([ -f "$BALLAST" ] && echo pose || echo absent)"
  exit 0
fi

# Ballast posé en régime normal (idempotent) — il doit exister AVANT qu'on en ait besoin.
[ "$NIVEAU" -lt 4 ] && _ballast_pose

SORTIE_MENAGE_APRES=""
BALLAST_LIBERE=""
MENAGE=""
MENAGE_TXT=""

# ── NIVEAU 5 : DERNIER RECOURS ───────────────────────────────────────────────────────────────────
if [ "$NIVEAU" -ge 5 ]; then
  echo "[disque] DERNIER RECOURS ($PCT%) — suppression du ballast en premier"
  if _ballast_retire; then BALLAST_LIBERE="oui"; _mesurer; echo "[disque] ballast supprime, disque a ${PCT}%"; fi
  _menage agressif; MENAGE="$MENAGE_TXT"   # appel DIRECT (pas de sous-shell) → SORTIE_MENAGE_APRES remonte
  # recrée le ballast SEULEMENT si le nettoyage a rendu le disque sous le seuil critique
  if [ -n "$SORTIE_MENAGE_APRES" ] && [ "${SORTIE_MENAGE_APRES:-100}" -lt "$SEUIL_CRITIQUE" ]; then _ballast_pose && echo "[disque] ballast recree"; fi
# ── NIVEAU 4 : URGENCE ───────────────────────────────────────────────────────────────────────────
elif [ "$NIVEAU" -ge 4 ]; then
  echo "[disque] URGENCE ($PCT%) — nettoyage securise"
  # garde-fou anti-emballement : au plus un ménage complet par heure
  DER=$(cat "$DERNIER_MENAGE" 2>/dev/null || echo 0); case "$DER" in ''|*[!0-9]*) DER=0;; esac
  if [ $((NOW - DER)) -ge 3600 ]; then echo "$NOW" > "$DERNIER_MENAGE" 2>/dev/null; _menage normal; MENAGE="$MENAGE_TXT"
  else MENAGE="(menage deja fait il y a moins d'une heure)"; fi
fi

# ── ALERTES (anti-spam : à la montée, puis 1×/jour tant qu'on reste haut, 1× au retour normal) ────
DER_MAIL=$(cat "$DERNIER_MAIL" 2>/dev/null || echo 0); case "$DER_MAIL" in ''|*[!0-9]*) DER_MAIL=0;; esac
DOIT=0
[ "$NIVEAU" -ge 2 ] && [ "$NIVEAU" -gt "$PRECEDENT" ] && DOIT=1
[ "$NIVEAU" -ge 2 ] && [ $((NOW - DER_MAIL)) -ge 86400 ] && DOIT=1
[ "$NIVEAU" -eq 0 ] && [ "$PRECEDENT" -ge 2 ] && DOIT=2
[ "$MODE" = "--test" ] && DOIT=1

if [ "$DOIT" = "2" ]; then
  _envoyer "Disque revenu a la normale ($PCT%)" "<p>Le disque du VPS est redescendu a <b>$PCT%</b> (${LIBRE_GO} Go libres). Plus aucune alerte en cours.</p>" >/dev/null
  echo "$NOW" > "$DERNIER_MAIL" 2>/dev/null
elif [ "$DOIT" = "1" ]; then
  CORPS="<p><b>$RESUME</b></p>"
  [ -n "$H_COURT" ] && CORPS="$CORPS<p>Vitesse actuelle : 100% projete dans <b>${H_COURT} h</b>.</p>"
  [ -n "$J_LONG" ] && CORPS="$CORPS<p>Tendance 7 jours : saturation dans <b>${J_LONG} j</b>.</p>"
  [ -n "$DESK_HS" ] && CORPS="$CORPS<p style='color:#b91c1c'><b>Le desk ne repond pas (/healthz).</b></p>"
  [ "$NIVEAU" -ge 3 ] && CORPS="$CORPS<p>Diagnostic :</p><pre>$(_diagnostic | _echapper)</pre>"
  if [ -n "${MENAGE:-}" ]; then
    CORPS="$CORPS<p><b>Nettoyage automatique</b>${BALLAST_LIBERE:+ (ballast de ${BALLAST_MO} Mo libere en premier)} :</p><pre>$(echo "$MENAGE" | _echapper)</pre>"
    [ -n "$SORTIE_MENAGE_APRES" ] && [ "${SORTIE_MENAGE_APRES:-100}" -ge "$SEUIL_URGENCE" ] && CORPS="$CORPS<p style='color:#b91c1c'><b>Le disque reste a ${SORTIE_MENAGE_APRES}% APRES nettoyage — intervention humaine requise.</b></p>"
  fi
  CORPS="$CORPS<p style='color:#6b7280;font-size:12px'>Rappel 07/09 : un disque plein fait tronquer par nginx toute reponse de plus de ~750 Ko, sans erreur HTTP — le desk arrive sans style ni script.</p>"
  _envoyer "[$NOM] Disque VPS a $PCT%" "$CORPS"
  echo "$NOW" > "$DERNIER_MAIL" 2>/dev/null
fi

logger -t dtp-disque "niveau=$NIVEAU ($NOM) $RESUME${DESK_HS:+ desk=HS}" 2>/dev/null
echo "[disque] $NOM — $RESUME"
exit 0

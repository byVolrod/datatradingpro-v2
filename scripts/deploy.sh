#!/usr/bin/env bash
# ═══ DÉPLOYER LE DESK SUR LE VPS ══════════════════════════════════════════════════════════════
#
#   POUSSER SUR GITHUB NE DÉPLOIE RIEN. Le code vit à DEUX endroits :
#     · GitHub          — le tiroir. `git push` s'arrête là. Vos clients ne voient rien changer.
#     · le VPS          — la machine qui sert vraiment le desk. Elle garde SA copie, figée au
#                         dernier déploiement, et continue de servir l'ancienne version.
#
#   ET IL FAUT RECONSTRUIRE, PAS SEULEMENT RÉCUPÉRER. Le serveur tourne dans un conteneur Docker,
#   et le code est COPIÉ DEDANS au moment de la construction (`COPY . .` du Dockerfile). Aucun
#   volume ne monte le code source (vérifié : docker-compose.yml ne monte que ./data/*). Faire un
#   `git pull` sur le disque du VPS ne change donc RIEN à ce qui tourne : c'est l'image qu'il faut
#   refaire. D'où `docker compose build` puis `up -d`.
#
#   USAGE :  npm run deploy      (ou : bash scripts/deploy.sh)
#   Il faut la clé SSH ~/.ssh/dtp_deploy sur la machine qui lance le script.
#
#   SANS LA CLÉ SOUS LA MAIN — depuis un téléphone, un autre poste, ou un agent qui n'a pas vos
#   secrets — le même déploiement se lance depuis l'onglet Actions de GitHub : workflow
#   « Déployer le desk » → bouton « Run workflow ». Ce workflow N'EST PAS une seconde
#   implémentation : il pose la clé du secret DTP_SSH_KEY dans un fichier et APPELLE CE SCRIPT,
#   par les surcharges DTP_KEY / DTP_HOST / DTP_DIR / DTP_URL ci-dessous. Ce qui change ici change
#   donc aux deux endroits, et un banc (scripts/deploiement-verif.js) refuse qu'on l'y recopie.
#   ⚠️ DEPUIS LE 29/08, CE WORKFLOW SE DÉCLENCHE AUSSI À CHAQUE PUSH SUR MAIN (décision user :
#   retour au « push = prod » de l'époque Render). Il fait tourner `npm run check` AVANT de
#   déployer : un push cassé est bloqué, pas livré. Le banc exige exactement { push sur main +
#   workflow_dispatch } — jamais de schedule. Ce script-ci reste le chemin manuel depuis une
#   machine qui détient la clé.
#
set -euo pipefail

HOTE="${DTP_HOST:-root@149.71.44.90}"
CLE="${DTP_KEY:-$HOME/.ssh/dtp_deploy}"
DOSSIER="${DTP_DIR:-/opt/datatradingpro}"
SERVICE="datatradingpro"
URL="${DTP_URL:-https://desk.datatradingpro.com}"

echo "── Déploiement du desk ──────────────────────────────────────────────"

[ -f "$CLE" ] || { echo "✗ Clé SSH introuvable : $CLE"; echo "  (surchargez avec DTP_KEY=/chemin/vers/la/cle)"; exit 1; }

# On PRÉVIENT si le local n'est pas poussé : déployer pousserait la version de GitHub, pas la vôtre,
# et on chercherait ensuite pourquoi le correctif « ne marche pas ».
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "⚠ Des modifications ne sont PAS commitées — elles ne partiront pas."
fi
if [ -n "$(git log --oneline @{u}.. 2>/dev/null || true)" ]; then
  echo "⚠ Des commits ne sont PAS poussés sur origin — ils ne partiront pas :"
  git log --oneline @{u}.. | sed 's/^/    /'
fi

AVANT="$(ssh -i "$CLE" -o StrictHostKeyChecking=accept-new "$HOTE" "cd $DOSSIER && git rev-parse --short HEAD" 2>/dev/null || echo '?')"
echo "  version en ligne avant : $AVANT"

ssh -i "$CLE" "$HOTE" "cd $DOSSIER \
  && git fetch --quiet origin main \
  && git reset --hard --quiet origin/main \
  && docker compose build $SERVICE \
  && docker compose up -d $SERVICE"

APRES="$(ssh -i "$CLE" "$HOTE" "cd $DOSSIER && git rev-parse --short HEAD")"
echo "  version en ligne après  : $APRES"
[ "$AVANT" = "$APRES" ] && echo "  (rien de neuf : le VPS était déjà à jour)"

# Le conteneur redémarre : on laisse au serveur le temps de répondre avant de conclure.
echo "── Vérification ─────────────────────────────────────────────────────"
for i in $(seq 1 20); do
  if curl -fsS --max-time 5 "$URL/healthz" >/dev/null 2>&1; then
    echo "✓ Le desk répond — $URL"
    echo
    echo "  Pensez à Ctrl+F5 (ou Cmd+Shift+R) : le navigateur garde les fichiers 30 jours."
    exit 0
  fi
  sleep 3
done
echo "✗ Le desk ne répond pas après 60 s. Journal :"
ssh -i "$CLE" "$HOTE" "cd $DOSSIER && docker compose logs --tail 40 $SERVICE"
exit 1

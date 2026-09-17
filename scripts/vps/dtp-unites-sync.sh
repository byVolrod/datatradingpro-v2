#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════════════════════
#  RESYNCHRONISE LES UNITÉS systemd DEPUIS LE DÉPÔT — appelé par LES DEUX chemins de déploiement.
#
#  ⚠️ POURQUOI CE FICHIER EXISTE À PART (17/09/2026, quelques heures après le correctif qu'il
#  répare). La resynchro avait d'abord été écrite UNIQUEMENT dans vps-autodeploiement.sh (le
#  « chemin jalon », le tireur systemd du VPS). Mesuré ensuite sur cette machine, quatre heures
#  après un déploiement pourtant réussi (le code applicatif était bien à jour, `git log` le
#  prouvait) : l'unité `dtp-sauvegarde.service` tournait TOUJOURS avec l'ancien `ExecStart=`.
#  Cause : ce VPS est déployé par le « chemin SSH » (`scripts/deploy.sh`, appelé par le workflow
#  GitHub via le secret DTP_SSH_KEY), qui fait `git reset --hard` + build + up EN SSH, sans jamais
#  passer par vps-autodeploiement.sh. La resynchro n'existait donc que dans le chemin qui ne
#  tournait pas ici. DEUX chemins de déploiement, une seule logique d'unités — sinon la divergence
#  se paie exactement comme celle du CODE que ce dépôt refuse déjà de dupliquer (deploiement-verif.js
#  interdit deux copies de la séquence de déploiement ; ce fichier applique la même règle aux
#  unités systemd).
#
#  CE QU'IL FAIT : copie chaque `scripts/dtp-*.service`/`.timer` DÉJÀ INSTALLÉ vers
#  /etc/systemd/system, s'il diffère, et recharge systemd UNE fois si quelque chose a changé.
#  Il ne pose JAMAIS une unité qu'on n'a pas installée : ça, c'est le rôle de
#  vps-resilience-installer.sh, lancé une fois à la main.
#
#  Usage :  bash /opt/datatradingpro/scripts/vps/dtp-unites-sync.sh
#  Rend 0 dans tous les cas (une resynchro qui échoue ne doit jamais faire échouer un déploiement
#  applicatif par ailleurs réussi) ; les messages disent ce qui a été fait.
# ═══════════════════════════════════════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/../.." || exit 0

change=0
for u in scripts/dtp-*.service scripts/dtp-*.timer; do
  [ -f "$u" ] || continue
  dest="/etc/systemd/system/$(basename "$u")"
  # On ne pose QUE des unités déjà installées : cette resynchro met à jour, elle n'active rien de
  # nouveau. Poser une unité que personne n'a choisi d'installer serait une décision, pas une
  # mise à jour — et elle appartient à l'installateur.
  [ -f "$dest" ] || continue
  if ! cmp -s "$u" "$dest"; then
    cp "$u" "$dest" && change=1 && echo "[unites-sync] mise à jour : $(basename "$u")"
  fi
done
if [ "$change" = "1" ]; then
  systemctl daemon-reload && echo "[unites-sync] systemd rechargé"
else
  echo "[unites-sync] rien à faire (unités déjà à jour)"
fi
exit 0

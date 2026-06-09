#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# access.sh — Débloque l'accès SSH de Claude + déploie le code déjà récupéré.
# À lancer EN ROOT depuis le dossier du projet, après un `git pull` :
#     bash access.sh
# (Ne contient AUCune saisie à taper : tout est dans le fichier → évite les
#  soucis de clavier de la console web.)
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1

echo "=== 1) Autorisation de la cle SSH de deploiement Claude ==="
mkdir -p /root/.ssh
K='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGJPwpUzCow3wQy1LqjRLBhwkxbIGkyvPZd7Jelhitfa claude-dtp-deploy'
if grep -qF "$K" /root/.ssh/authorized_keys 2>/dev/null; then
  echo "  cle deja presente: ok"
else
  echo "$K" >> /root/.ssh/authorized_keys
  echo "  cle ajoutee: ok"
fi
chmod 700 /root/.ssh 2>/dev/null
chmod 600 /root/.ssh/authorized_keys 2>/dev/null

echo "=== 2) Debannissement de mon IP (fail2ban) ==="
IP=195.5.247.184
if command -v fail2ban-client >/dev/null 2>&1; then
  JAILS=$(fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list:[[:space:]]*//p' | tr ',' ' ')
  for j in $JAILS; do
    fail2ban-client set "$j" unbanip "$IP" >/dev/null 2>&1 && echo "  unban dans le jail: $j"
  done
  echo "  fail2ban traite: ok"
else
  echo "  fail2ban absent — rien a debannir"
fi

echo "=== 3) Deploiement (le code a deja ete recupere par 'git pull') ==="
echo "    -> reconstruction de l'image + bascule (le site ne tombe pas, ~3s)"
docker compose up -d --build
echo ""
echo "=== ETAT DES CONTENEURS ==="
docker compose ps
echo ""
echo "=== TERMINE — dis a Claude 'c bon', il prend le relais par SSH. ==="

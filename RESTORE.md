# 🛟 DataTradingPro — Restauration complète sur un serveur Linux

Ce guide permet de **remonter l'intégralité du site** (terminal `desk.` + landing) sur **n'importe quel
serveur Linux neuf**, à l'identique et **pleinement fonctionnel** (news temps réel, prompts IA,
Smart Bias, TAUX, Week Ahead, abonnements, e-mails…).

## Ce qui est sauvegardé… et ce qui ne l'est pas

| Élément | Où | Restauré par |
|---|---|---|
| **Tout le code** (serveur, scrapers, IA) | dépôt git | `git clone` |
| **Tous les prompts IA** (Bias, Week Ahead, TAUX, briefings…) | en dur dans le code | `git clone` |
| **Front** (desk `public/`, landing `landing/`) | dépôt git | `git clone` |
| **Config de déploiement** (Dockerfile, docker-compose, render.yaml) | dépôt git | `git clone` |
| **Utilisateurs + cache IA durable** | base **Supabase** (table `ai_cache`) | réutiliser le même projet Supabase |
| **Clés / mots de passe** (`.env`) | **HORS dépôt** (jamais commité) | à re-fournir manuellement |
| Caches disque (`cache_*.json`, `news_history.json`) | éphémères | **régénérés automatiquement** au démarrage |

> 🔑 **Les secrets ne sont volontairement PAS dans le dépôt** (règle de sécurité). Gardez-les dans
> votre gestionnaire de mots de passe / le dashboard de l'hébergeur. Le reste se restaure tout seul.

Deux miroirs git existent (gardez-les synchronisés) :
- **origin** → `https://github.com/byVolrod/datatradingpro-v2.git`
- **backup** → `https://github.com/byVolrod/datatradingpro-v2-backup.git` (privé, miroir)

---

## Prérequis serveur

- Linux x86_64 (Debian/Ubuntu conseillé), ≥ 1 Go RAM (2 Go recommandé pour Chromium).
- **Docker + Docker Compose** (voie recommandée), OU **Node 22 LTS** + Chromium (voie native).
- Accès au **même projet Supabase** (ou un nouveau, cf. §3).

---

## Étape 1 — Récupérer le code

```bash
git clone https://github.com/byVolrod/datatradingpro-v2.git datatradingpro
cd datatradingpro
# (option) ajouter le miroir de backup pour pousser les deux :
git remote add backup https://github.com/byVolrod/datatradingpro-v2-backup.git
```

## Étape 2 — Restaurer les secrets (`.env`)

```bash
cp .env.example .env
nano .env        # remplir les valeurs
```

**Indispensables pour un site fonctionnel :**
- `SUPABASE_URL` + `SUPABASE_KEY` (service_role) → auth + cache IA durable.
- `GEMINI_API_KEY` → moteur IA principal (Bias, Week Ahead, TAUX, chat macro…).
- `SESSION_SECRET` → `openssl rand -hex 32`.
- `FJ_EMAIL` / `FJ_PASS` → flux news temps réel (FinancialJuice).

**Fortement recommandés :** `ANTHROPIC_API_KEY[2/3/4]` (repli IA), `MFB_EMAIL`/`MFB_PASS`
(sentiment retail), `WHOP_*` (abonnements), un fournisseur e-mail (`RESEND_API_KEY` ou
`MAILJET_*` ou `OVH_SMTP_*`). La liste complète et commentée est dans `.env.example`.

> Le site **démarre même sans les clés IA** (replis déterministes), mais les textes IA ne seront
> générés qu'une fois les clés présentes.

## Étape 3 — Supabase (données persistantes)

- **Cas idéal** : réutiliser le **même projet Supabase** → utilisateurs et cache IA déjà là, rien à faire.
- **Nouveau projet** : recréer la table de cache (le reste de l'auth utilise Supabase Auth) :

```sql
-- Cache IA durable (clé = hash, valeur = JSON). Survit aux redéploiements (disque éphémère).
create table if not exists ai_cache (
  key   text primary key,
  value jsonb,
  updated_at timestamptz default now()
);
```

> Si la table manque, le code bascule sur un **repli fichier** (`auth.js`) — le site fonctionne,
> mais le cache n'est plus durable entre redéploiements. Créez-la pour la persistance.

## Étape 4 — Lancer

### Voie A — Docker Compose (recommandée)

`docker-compose.yml` est prêt (Chromium inclus dans l'image, redémarrage auto, healthcheck) :

```bash
docker compose up -d --build
docker compose logs -f          # suivre le démarrage
```

Le serveur écoute sur `:3000` (`http://IP_DU_SERVEUR:3000`).

### Voie B — Node natif

```bash
# Chromium requis par Puppeteer (Debian/Ubuntu) :
sudo apt-get update && sudo apt-get install -y chromium
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
npm ci --omit=dev
node server.js
```

(En prod sans Docker, garder le process en vie via **systemd** ou **pm2**.)

## Étape 5 — Reverse proxy HTTPS (nginx)

Exemple minimal pour exposer le terminal derrière nginx + Let's Encrypt :

```nginx
server {
  server_name desk.datatradingpro.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;          # WebSocket (flux news live)
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo certbot --nginx -d desk.datatradingpro.com      # HTTPS auto
```

> La landing (`datatradingpro.com`) est servie par le même serveur Node (dossier `landing/`).

## Étape 6 — Mise à jour automatique (git pull)

Le serveur se met à jour seul depuis `main` toutes les ~5 min (cron). Exemple :

```bash
# crontab -e
*/5 * * * * cd /chemin/datatradingpro && git pull --ff-only origin main && docker compose up -d --build >> /var/log/dtp-update.log 2>&1
```

## Étape 7 — Vérifier

```bash
curl -fsS http://127.0.0.1:3000/healthz && echo OK   # doit répondre 200
docker compose logs --tail=80                          # scrapers + IA + WebSocket
```

Puis ouvrir le site : les **onglets News / Calendar / Bias / TAUX / Week Ahead** doivent se
remplir (les premières générations IA arrivent en tâche de fond, puis sont mises en cache).

---

## Notes d'exploitation

- **Disque éphémère OK** : tout ce qui doit survivre est en Supabase (`ai_cache`) ; les `cache_*.json`
  se régénèrent.
- **Anti-OOM** : pensé pour 512 Mo (timeouts fetch, caps mémoire, verrous). Sur petit serveur,
  `DISABLE_MYFXBOOK=1` allège.
- **Backup git** : après chaque `git push origin main`, faire aussi `git push backup main`.
- **Sécurité** : ne jamais committer `.env` / clés. Si une clé fuit → la révoquer et la remplacer
  dans `.env` (et le dashboard de l'hébergeur), pas dans le code.

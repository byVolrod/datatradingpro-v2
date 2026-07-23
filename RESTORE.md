# 🛟 DataTradingPro — Restauration complète (remonter le site « tel quel »)

Ce guide permet de **remonter l'intégralité du site** (terminal `desk.datatradingpro.com` + landing
`datatradingpro.com`) sur **n'importe quel serveur Linux neuf**, à l'identique et **pleinement
fonctionnel** : news temps réel, prompts IA, Smart Bias, TAUX, Week Ahead, abonnements Whop, e-mails,
Journal, Mon Desk, carte des sessions…

> 🔑 **Règle de sécurité (non négociable)** : les **clés / mots de passe ne sont JAMAIS dans le dépôt**
> (ni dans ce fichier). Le CODE, les PROMPTS et le FRONT se restaurent par un simple `git clone` ; seules
> les valeurs secrètes du `.env` sont à re-fournir. Voir §2 pour savoir **où elles vivent** et **comment
> les sauvegarder** en clair chez vous (jamais en git).

---

## 0. État figé de référence (au 2026-07-23)

Restaurer **exactement cet état** = cloner le dépôt à ce commit et fournir les mêmes secrets.

| Repère | Valeur |
|---|---|
| Dernier commit `main` | voir `git log -1` (miroir origin **et** backup à jour) |
| Terminal (desk) | `desk.datatradingpro.com` → serveur Node `:3000` derrière nginx |
| Landing | `datatradingpro.com` → servie par le **même** process Node (dossier `landing/`) |
| Hébergement actuel | **VPS Linux `149.71.44.90`**, Docker Compose (service `datatradingpro`) — plus Render |
| Versions moteur | `BIAS_VER='v40-histdate'` · `RECAP_VER=39` · `FXR_VER=9` · `GEW_VER=13` (server.js) |
| Cache-busters front | style.css/charts.js/sessionmap.js `bbg293` · widgets.js `bbg292` · app.js `bbg291` |
| Données persistantes | **Supabase** (auth + table `ai_cache` + KV divers) |
| Chaîne IA | Groq → Gemini → GitHub Models → OpenRouter → Cohere → xAI → Claude (repli) |

Deux miroirs git (à garder synchronisés — **`push origin` PUIS `push backup` à chaque fois**) :
- **origin** → `https://github.com/byVolrod/datatradingpro-v2.git`
- **backup** → `https://github.com/byVolrod/datatradingpro-v2-backup.git` (privé, miroir)

---

## 1. Ce qui est sauvegardé… et ce qui ne l'est pas

| Élément | Où | Restauré par |
|---|---|---|
| **Tout le code** (serveur, scrapers, IA, mailer) | dépôt git | `git clone` |
| **Tous les prompts IA** (Bias, Week Ahead, TAUX, récaps, briefings…) | en dur dans le code | `git clone` |
| **Front** (desk `public/`, landing `landing/`) | dépôt git | `git clone` |
| **Config déploiement** (Dockerfile, docker-compose.yml) | dépôt git | `git clone` |
| **Utilisateurs + cache IA durable + KV** (widgets, journal, notifs, bank…) | **Supabase** | réutiliser le même projet Supabase |
| **Clés / mots de passe** (`.env`) | **HORS dépôt** (gitignored) | à re-fournir manuellement (§2) |
| Caches disque (`cache_*.json`, `news_history.json`, `cache_smart_bias.json`…) | éphémères | **régénérés automatiquement** au démarrage |

---

## 2. Les secrets (`.env`) — où ils vivent + comment les sauvegarder

Le fichier **`.env.example`** (commité, valeurs **vides**) liste **TOUTES les variables**, commentées et
regroupées : cœur serveur, Supabase, IA (Gemini/Claude/GitHub), scrapers (FinancialJuice, Myfxbook),
Whop, e-mails (Resend/Mailjet/OVH/Gmail), newsletters KBC. C'est la **carte** des clés à fournir.

Les **valeurs réelles** vivent à DEUX endroits, jamais en git :
1. Le fichier **`.env` sur le VPS en production** (`/opt/datatradingpro/.env`) — la source vivante.
2. Votre **gestionnaire de mots de passe** (copie de secours).

**Pour sauvegarder les vraies clés maintenant (sans jamais les committer)** — les récupérer depuis le VPS
et les ranger dans votre gestionnaire de secrets :

```bash
# Copie le .env de prod vers votre poste (à mettre ENSUITE dans votre password manager, PAS en git) :
scp -i ~/.ssh/dtp_deploy root@149.71.44.90:/opt/datatradingpro/.env  ./dtp-secrets-$(date +%Y%m%d).env
```

**Indispensables** pour un site fonctionnel : `SUPABASE_URL` + `SUPABASE_KEY` (service_role),
`SESSION_SECRET` (`openssl rand -hex 32`), au moins une clé IA (`GROQ_API_KEY` / `GEMINI_API_KEY`),
`FJ_EMAIL`/`FJ_PASS` (flux news). **Recommandés** : `ANTHROPIC_API_KEY[2/3/4]`, `MFB_EMAIL`/`MFB_PASS`,
`WHOP_*`, un fournisseur e-mail (`OVH_SMTP_*` en prod actuelle). Détail complet : `.env.example`.

> Le site **démarre même sans clés IA** (replis déterministes) ; les textes IA n'apparaissent qu'une fois
> les clés présentes. ⚠ Si une clé fuit → la **révoquer** et la remplacer dans `.env` + le dashboard du
> fournisseur, **jamais** dans le code.

---

## 3. Restauration pas à pas (serveur Linux neuf)

### Prérequis
- Linux x86_64 (Debian/Ubuntu), ≥ 1 Go RAM (2 Go conseillé pour Chromium).
- **Docker + Docker Compose** (voie recommandée) OU Node 22 LTS + Chromium (voie native).
- Accès au **même projet Supabase** (idéal) ou un nouveau (cf. §4).

### Étape 1 — Récupérer le code
```bash
git clone https://github.com/byVolrod/datatradingpro-v2.git datatradingpro
cd datatradingpro
git remote add backup https://github.com/byVolrod/datatradingpro-v2-backup.git   # miroir
```

### Étape 2 — Restaurer les secrets
```bash
cp .env.example .env
nano .env         # coller les valeurs depuis votre password manager / l'ancien .env
```

### Étape 3 — Supabase
- **Idéal** : réutiliser le **même projet** → utilisateurs, cache IA et KV déjà présents, rien à faire.
- **Nouveau projet** : recréer la table de cache (le reste utilise Supabase Auth + KV auto) :
```sql
create table if not exists ai_cache (
  key   text primary key,
  value jsonb,
  updated_at timestamptz default now()
);
```
> Sans cette table, le code bascule sur un repli fichier (éphémère) : le site marche mais le cache IA
> n'est plus durable entre redéploiements. La créer pour la persistance.

### Étape 4 — Lancer (Docker, comme en prod)
```bash
docker compose up -d --build      # Chromium inclus, redémarrage auto, healthcheck
docker compose logs -f            # suivre le démarrage (scrapers + IA + WebSocket)
```
Le serveur écoute sur `:3000`.

*(Voie native, sans Docker :* `sudo apt-get install -y chromium` *puis*
`export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium && npm ci --omit=dev && node server.js`,
*maintenu en vie par systemd/pm2.)*

### Étape 5 — Reverse proxy HTTPS (nginx)
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
sudo certbot --nginx -d desk.datatradingpro.com     # HTTPS auto (idem apex pour la landing)
```

### Étape 6 — Vérifier
```bash
curl -fsS http://127.0.0.1:3000/healthz && echo OK           # 200 attendu
docker compose logs --tail=80
```
Onglets **News / Calendrier / Biais / TAUX / Week Ahead** doivent se remplir (les 1res générations IA
arrivent en tâche de fond puis sont cachées).

---

## 4. Déploiement d'une mise à jour (workflow actuel — VPS Docker)

Depuis le poste de dev, après `git push origin main && git push backup main` :

```bash
ssh -i ~/.ssh/dtp_deploy -o StrictHostKeyChecking=no root@149.71.44.90 \
  'cd /opt/datatradingpro && git fetch origin main && git reset --hard origin/main \
   && docker compose build datatradingpro && docker compose up -d datatradingpro'
```

Notes d'exploitation :
- **Toujours `git fetch` avant `reset --hard`** ; le VPS **rate-limite le SSH** après beaucoup de
  connexions rapprochées (le site reste en ligne — attendre / boucler avec `ConnectTimeout`).
- **Cache-busting** : bumper `?v=YYYYMMDDbbgNN` sur style.css/app.js/charts.js/widgets.js/sessionmap.js
  dans `public/index.html` à chaque changement front (puis Ctrl+F5 côté client).
- **Disque éphémère OK** : tout ce qui doit survivre est en Supabase ; les `cache_*.json` se régénèrent.
- **Anti-OOM** (512 Mo) : timeouts fetch, caps mémoire, verrous ; `DISABLE_MYFXBOOK=1` allège si besoin.
- **Régénération IA forcée** (depuis le conteneur, jeton interne) : `/api/briefing/<type>/generate?force=1`
  avec l'en-tête `x-dtp-internal: $DTP_INTERNAL_TOKEN` en loopback.

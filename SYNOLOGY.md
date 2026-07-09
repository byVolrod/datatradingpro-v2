# 🏠 Héberger DataTradingPro sur ton Synology NAS

> **C'est la meilleure option pour toi** : gratuit, allumé 24h/24, aucune mise
> en veille, stockage persistant, et tu gardes le contrôle total. Le NAS fait
> tourner le serveur Node + Chromium (Puppeteer) sans aucune limite de temps.

## ✅ Pré-requis

1. Un Synology **compatible Docker** (modèles « + » type DS220+, DS920+, DS723+…
   — voir https://www.synology.com/dsm/packages/ContainerManager).
2. **Container Manager** installé (Centre de paquets → rechercher
   *Container Manager* → Installer). Sur DSM 6 c'est l'ancien paquet *Docker*.

> ❓ Pas sûr que ton modèle supporte Docker ? Dis-moi sa référence (ex. *DS220+*)
> et je te confirme.

---

## Étape 1 — Copier le projet sur le NAS

Via **File Station**, crée un dossier, par ex :
`/docker/datatradingpro/`

Copie-y **tout le contenu du projet** (le dossier qui contient `server.js`,
`Dockerfile`, `docker-compose.yml`, etc.). Tu peux glisser-déposer depuis ton PC.

> ⚠️ N'envoie PAS le dossier `node_modules` ni les `.chrome_profile_*` — ils
> seront recréés. (`Dockerfile` les régénère proprement dans le conteneur.)

---

## Étape 2 — Créer le fichier `.env` sur le NAS

Dans `/docker/datatradingpro/`, crée un fichier nommé **`.env`** (via le
Text Editor de DSM, ou copie celui de ton PC) contenant :

```
NODE_ENV=production
PORT=3000
SESSION_SECRET=une-longue-chaine-aleatoire-de-ton-choix

SUPABASE_URL=https://<ton-projet>.supabase.co
SUPABASE_KEY=ta-cle-service-role-supabase

FJ_EMAIL=<ton-email-financialjuice>
FJ_PASS=<voir-gestionnaire-de-secrets>

MFB_EMAIL=<ton-email-myfxbook>
MFB_PASS=<voir-gestionnaire-de-secrets>

ANTHROPIC_API_KEY=ta-cle-claude-si-tu-en-as-une

ALLOWED_ORIGINS=
```

---

## Étape 3 — Lancer via Container Manager

1. Ouvre **Container Manager** → onglet **Projet** → **Créer**.
2. **Nom du projet** : `datatradingpro`
3. **Chemin** : sélectionne `/docker/datatradingpro/`
4. **Source** : « Utiliser un fichier docker-compose.yml existant » → il détecte
   le `docker-compose.yml` du dossier.
5. Clique **Suivant** → **Terminé**.

Container Manager **construit l'image** (installe Chromium — ~5 min la 1ère fois)
puis démarre le conteneur. Il redémarrera automatiquement à chaque reboot du NAS.

✅ Accès local : **http://IP-DE-TON-NAS:3000**
(ex. `http://192.168.1.50:3000`)

---

## Étape 4 — Rendre le site accessible à tes clients (depuis Internet)

Tes clients ne sont pas sur ton réseau local : il faut exposer le NAS proprement,
avec **HTTPS** (tout est gratuit et intégré à DSM).

### 4a. Nom de domaine gratuit (DDNS)
**Panneau de configuration → Accès externe → DDNS → Ajouter**
Choisis le fournisseur **Synology**, crée une adresse type
`tonsite.synology.me`. DSM gère l'IP automatiquement.

### 4b. Certificat HTTPS gratuit (Let's Encrypt)
**Panneau de configuration → Sécurité → Certificat → Ajouter →
Let's Encrypt** pour `tonsite.synology.me`.

### 4c. Reverse proxy (relie le domaine au conteneur)
**Panneau de configuration → Portail de connexion → Avancé → Proxy inversé →
Créer** :
- Source : `https://tonsite.synology.me` (port 443)
- Destination : `http://localhost:3000`
- Onglet **En-tête personnalisé** → bouton **Créer → WebSocket**
  *(indispensable : le flux news temps réel passe par WebSocket)*

### 4d. Ouvre le port 443 sur ta box Internet
Redirige le port **443** de ta box vers l'IP de ton NAS (redirection NAT/port
forwarding — section habituellement « NAT » ou « Serveurs virtuels »).

✅ Tes clients accèdent au terminal sur : **https://tonsite.synology.me**

---

## Mettre à jour le site plus tard

1. Remplace les fichiers modifiés dans `/docker/datatradingpro/` (File Station).
2. Container Manager → projet `datatradingpro` → **Construire** (rebuild) →
   **Action → Redémarrer**.

---

## 🔒 Conseils sécurité (clients)

- Active le **pare-feu** DSM (Sécurité → Pare-feu) et n'autorise que le 443.
- Active **2FA** sur ton compte admin DSM.
- Ne mappe **jamais** le port 5000/5001 (admin DSM) vers Internet.
- Change `SESSION_SECRET` pour une vraie chaîne aléatoire longue.

---

## NAS vs Render — lequel choisir ?

| Critère | Synology NAS | Render gratuit |
|---|---|---|
| Prix | Gratuit (tu as déjà le NAS) | Gratuit |
| Mise en veille | ❌ jamais | ⚠️ après 15 min |
| Performance | 💪 dépend du NAS | correcte |
| Mise en place | Moyenne (réseau/HTTPS) | Très simple |
| Dépend de ta connexion maison | Oui | Non |

👉 **Recommandation** : le **NAS** si ta connexion Internet maison est stable
(fibre). Sinon **Render** pour ne dépendre de rien. Les deux sont prêts —
fichiers `docker-compose.yml` (NAS) et `render.yaml` (Render) déjà créés.

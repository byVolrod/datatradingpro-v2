# 🚀 Déployer DataTradingPro gratuitement (Render.com)

> **Pourquoi pas Netlify / Vercel ?**
> Ce site est un **serveur Node permanent** : il fait tourner un navigateur
> (Puppeteer) pour scraper ForexFactory & Myfxbook, garde une **connexion
> WebSocket** ouverte vers FinancialJuice, et exécute des **tâches planifiées**
> 24h/24. Netlify/Vercel n'hébergent que du statique + fonctions courtes : le
> site y serait **non fonctionnel** (pas de news, pas de cotations, pas de
> briefings). **Render.com** fait tourner ce type de serveur, gratuitement, et
> se déploie de façon aussi simple que Netlify (connexion à GitHub).

---

## Étape 1 — Mettre le code sur GitHub (une seule fois)

Render déploie depuis un dépôt Git. Dans le dossier du projet :

```bash
git init
git add .
git commit -m "DataTradingPro - prêt pour déploiement"
```

Crée un dépôt **privé** sur https://github.com/new (nomme-le par ex.
`datatradingpro`), puis :

```bash
git remote add origin https://github.com/TON-COMPTE/datatradingpro.git
git branch -M main
git push -u origin main
```

> ✅ Le fichier `.gitignore` empêche déjà d'envoyer le `.env` (tes mots de
> passe restent privés).

---

## Étape 2 — Créer le service sur Render

1. Va sur https://render.com → inscris-toi (gratuit, avec ton compte GitHub).
2. Clique **New +** → **Blueprint**.
3. Sélectionne ton dépôt `datatradingpro`.
4. Render détecte automatiquement le fichier **`render.yaml`** → clique **Apply**.

Render construit l'image Docker (installe Chromium) et lance le serveur.
Le premier build prend ~3-5 min.

---

## Étape 3 — Renseigner les secrets (variables d'environnement)

Dans le dashboard du service → onglet **Environment**, ajoute les valeurs
(ce sont celles de ton fichier `.env` local) :

| Variable | Valeur |
|---|---|
| `SUPABASE_URL` | *(ton URL Supabase)* |
| `SUPABASE_KEY` | *(ta clé service_role Supabase)* |
| `SESSION_SECRET` | *une longue chaîne aléatoire de ton choix* |
| `FJ_EMAIL` | *(ton email FinancialJuice)* |
| `FJ_PASS` | *(voir gestionnaire de secrets)* |
| `MFB_EMAIL` | *(ton email Myfxbook)* |
| `MFB_PASS` | *(voir gestionnaire de secrets)* |
| `ANTHROPIC_API_KEY` | *(ta clé Claude — pour activer les briefings IA)* |
| `ALLOWED_ORIGINS` | `https://datatradingpro.onrender.com` *(ton URL Render)* |

Clique **Save** → Render redéploie automatiquement.

Ton site est en ligne sur : `https://datatradingpro.onrender.com`

---

## Étape 4 — Empêcher la mise en veille (important pour tes clients)

Sur le plan **gratuit**, Render endort le service après **15 min sans visite**
(réveil ≈ 50 s au prochain accès). Pour un terminal client, c'est gênant.

**Solution gratuite :** un service de ping qui visite ton site toutes les 10 min.

1. Va sur https://uptimerobot.com (gratuit).
2. Crée un monitor **HTTP(s)** vers : `https://datatradingpro.onrender.com/healthz`
3. Intervalle : **5 minutes**.

→ Le service reste éveillé en permanence (dans la limite des 750 h/mois
gratuites de Render, soit largement de quoi tenir 24h/24 sur un seul service).

---

## Mettre à jour le site plus tard

Modifie ton code, puis :

```bash
git add .
git commit -m "Mise à jour"
git push
```

Render redéploie **tout seul** à chaque push (comme Netlify). 🎉

---

## ⚠️ Limites du plan gratuit (à savoir pour tes clients)

- **Sessions de connexion** : stockées en mémoire → les utilisateurs sont
  déconnectés à chaque redéploiement/redémarrage. Acceptable au démarrage ;
  pour de la vraie production, on stockera les sessions dans Supabase (je peux
  le faire plus tard).
- **Fichiers de cache** (wraps, recherche bancaire) : disque éphémère sur le
  plan gratuit → régénérés automatiquement après un redémarrage. Pas de perte
  de données critiques (tout est re-scrapé).
- **Quand tu auras des revenus** : passer Render au plan payant (7 $/mois)
  supprime la mise en veille et ajoute un disque persistant. Aucun changement
  de code nécessaire.

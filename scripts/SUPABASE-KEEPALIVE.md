# Supabase keep-alive — anti-mise-en-pause

Empêche la **mise en pause automatique** des projets Supabase **free-tier** (Supabase suspend un
projet après ≈ **7 jours sans activité**). On envoie chaque jour une **requête légère** à *chaque*
projet → l'inactivité ne dépasse jamais 1 jour.

> ## ⚠️ CE QUI A ÉCHOUÉ, ET CE QUI L'A REMPLACÉ (02/09/2026)
>
> **Ce dispositif n'a jamais tourné.** Les secrets décrits plus bas n'ont pas été posés, et la
> branche « aucun projet configuré » du script rendait **0** pour ne pas faire de bruit. Résultat
> mesuré : **142 passages, tous verts**, tous affichant « 0 projet(s) Supabase détecté(s) » — que
> personne n'a lu, puisqu'un job vert ne se lit pas. Le projet principal est resté **en pause du
> 14 juin au 2 septembre**, soit deux mois et demi, avec une coche verte chaque jour.
>
> **Deux corrections.** (1) Le script **sort maintenant en erreur** quand il n'a rien à pinguer :
> une tâche qui ne peut pas faire son travail le dit. (2) Le keep-alive tourne **d'abord depuis le
> VPS**, où les quatre URL et les quatre clés vivent déjà dans le `.env` — rien à recopier, donc
> rien qui puisse diverger. Une commande :
>
> ```
> cd /opt/datatradingpro && bash scripts/vps-resilience-installer.sh
> ```
>
> Le job GitHub Actions **reste en place** comme ceinture-bretelles (utile si le VPS est arrêté),
> mais il ne peut plus être vert en ne faisant rien. Poser ses secrets reste donc utile ; tant
> qu'ils manquent, il rougira — et c'est l'effet recherché.
>
> **En prime, la reprise automatique.** Un projet en pause refuse *toute* requête, keep-alive
> compris : il ne peut pas se réveiller seul. Le script interroge désormais l'API de gestion
> Supabase et, **uniquement si elle répond `INACTIVE`**, demande la restauration. Cela demande
> `SUPABASE_ACCESS_TOKEN` (jeton personnel `sbp_…`), et au besoin `SUPABASE_ACCESS_TOKEN_2/_3/_4`
> si les bases secondaires vivent sous d'autres comptes — un jeton n'a de droits que sur ses
> propres organisations.

## Pourquoi GitHub Actions (et pas l'app)

| Option | Verdict |
|---|---|
| **GitHub Actions cron** ✅ | **Retenu.** Découplé de l'app : tourne même si Render **dort** (free-tier = veille après 15 min) ou si le VPS redémarre. Repo privé = **2000 min/mois gratuits**, ce job ≈ **15 min/mois**. Logs + alertes intégrés. |
| Interne au serveur (`setInterval`) | ❌ Dort avec l'app sur Render → ne pinge plus → projet mis en pause quand même. |
| Vercel Cron | ❌ On n'héberge pas sur Vercel. |
| Supabase Edge Function | ❌ Vit *dans* le projet à garder éveillé (œuf/poule) + planification moins simple. |

## Fonctionnement

- **`scripts/supabase-keepalive.js`** — Node ≥ 20, **zéro dépendance** (`fetch` natif). Pour chaque
  projet : `HEAD …/rest/v1/<table>?limit=1` → une vraie requête SQL côté Postgres (= « activité »
  comptée par Supabase) **sans corps de réponse** → **égress quasi nul** (important vu notre
  historique d'égress). Repli automatique sur la racine REST si la table n'existe pas sur une base.
- **`.github/workflows/supabase-keepalive.yml`** — cron **quotidien 07:23 UTC** + bouton manuel
  (*Run workflow*). Détecte **toutes** les bases via `toJSON(secrets)`.

## ⚙️ Mise en service (à faire UNE fois)

1. **Pousser** ces fichiers sur `main` (fait).
2. Sur GitHub → **Settings → Secrets and variables → Actions → New repository secret**, ajouter
   **exactement les mêmes valeurs que le `.env` du VPS** :

   | Secret | Obligatoire | Valeur |
   |---|---|---|
   | `SUPABASE_URL` | ✅ | URL du projet **principal** |
   | `SUPABASE_KEY` | ✅ | clé **service_role** du principal |
   | `SUPABASE_URL_2` … `SUPABASE_URL_5` | si la base existe | URL des projets secondaires (db2…db5) |
   | `SUPABASE_KEY_2` … `SUPABASE_KEY_5` | si la base existe | clé service_role correspondante |
   | `KEEPALIVE_WEBHOOK_URL` | optionnel | webhook **Discord/Slack** pour les alertes d'échec |

   > Variable optionnelle (Settings → Variables) : `SUPABASE_KEEPALIVE_TABLE` (défaut `ai_cache`)
   > si tu veux interroger une autre table commune à toutes les bases.

3. **Tester tout de suite** : onglet **Actions → Supabase keep-alive → Run workflow**. Vérifier le
   log : `✅ primary …`, `✅ db2 …`, `résumé : N/N OK`.

## ➕ Ajouter une nouvelle base Supabase

Rien à coder. Ajoute simplement les secrets **`SUPABASE_URL_6`** + **`SUPABASE_KEY_6`** (puis `_7`, …).
Le script les **détecte automatiquement** (`toJSON(secrets)` → tout `SUPABASE_URL[_n]` ayant sa clé).
Pense à ajouter la même base au `.env` du VPS si l'app doit l'utiliser (`auth.js` gère `_2…_5`).

## 🔔 Logs & alertes

- **Logs** : onglet **Actions** → chaque exécution (conservée 90 j) montre le détail par base
  (statut HTTP, latence) + le résumé.
- **Alerte e-mail** : si une base échoue, le workflow **échoue** (exit 1) → GitHub envoie un
  **e-mail d'échec** au propriétaire du dépôt (réglable dans GitHub → *Settings → Notifications*).
- **Alerte webhook** (optionnelle) : si `KEEPALIVE_WEBHOOK_URL` est défini, un message est posté sur
  **Discord/Slack** listant les bases en échec.

## ✅ Limites & bonnes pratiques (free-tier)

- **Fréquence** : 1×/jour (le seuil Supabase est 7 j → large marge, robuste à un run sauté).
- **Égress Supabase** : requêtes `HEAD` (≈ 0 octet de corps) → négligeable.
- **GitHub Actions** : ~15 min/mois sur 2000 gratuites.
- **Égalité avec l'app** : ne touche QUE l'API REST en lecture (aucune écriture, aucune donnée modifiée).

## 🧪 Tester en local

```bash
# charge le .env local (dotenv est déjà une dépendance du projet)
node -r dotenv/config scripts/supabase-keepalive.js
# ou, en passant les variables à la main :
SUPABASE_URL=https://xxx.supabase.co SUPABASE_KEY=ey... node scripts/supabase-keepalive.js
```

Sortie attendue : une ligne `✅` par base + `résumé : N/N OK`. Code de sortie 0 = succès, 1 = échec.

## 🛠️ Maintenance

- **Rotation de clé** : si tu changes une clé service_role, mets à jour le secret GitHub homonyme.
- **Base retirée** : supprime le secret `SUPABASE_URL_n` (ou `SUPABASE_KEY_n`) → la base disparaît du ping.
- **Changer l'heure/fréquence** : édite le `cron:` dans le workflow (syntaxe UTC).
- **Couper temporairement** : Actions → Supabase keep-alive → menu `…` → *Disable workflow*.

# Ingestion des newsletters marchés KBC (Sunrise + Weekly Overview)

Ajoute automatiquement les newsletters **KBC Sunrise** et **KBC Weekly Overview / Aperçu hebdomadaire**
(envoyées par `markets@newsletter.kbc.be`, **par e-mail uniquement**) à la source Institution **KBC**
de DTP — en lisant une boîte Gmail en **IMAP read-only**, **sans jamais ton mot de passe de compte**.

## Pourquoi un canal e-mail
Le hub public `kbc.com/economics` (déjà scrapé par DTP) ne contient PAS ces 2 newsletters : elles
n'arrivent que par e-mail. Il faut donc lire la boîte qui les reçoit.

## Pièces
| Fichier | Rôle |
|---|---|
| `scrapers/kbc-newsletter.js` | Lit l'INBOX en IMAP read-only, repère les mails de `markets@newsletter.kbc.be` dont le sujet matche *Sunrise* / *Weekly Overview* / *Aperçu hebdomadaire*, extrait le lien « version PDF », renvoie des items au format Institution. |
| `server.js` (`_fetchBankResearch`) | Une ligne gardée : `require('./scrapers/kbc-newsletter').fetchInto(merged)` — exécutée à chaque refresh Institution (boot + ~toutes les 20 min). **Dormant** sans config. |
| `package.json` | Dépendances `imapflow` + `mailparser` (déjà installées). |

## ⚙️ Mise en service (à faire UNE fois)

1. **Sur `volrod.dev@gmail.com`** : active la **validation en 2 étapes**, puis crée un
   **App Password** (Google Account → Security → 2-Step Verification → **App passwords**). Tu obtiens
   16 caractères. C'est **révocable** et **≠ ton mot de passe** (qu'il faut d'ailleurs changer, il a été
   exposé en chat).

2. **Sur le VPS**, ajoute au `.env` (jamais commité) :
   ```env
   KBC_MAIL_USER=volrod.dev@gmail.com
   KBC_MAIL_PASS=<le App Password 16 car.>
   # KBC_MAIL_LOOKBACK_DAYS=21   # optionnel
   ```
   puis redémarre le conteneur : `docker restart datatradingpro` (ou ton process).

3. **Vérifie les logs** : tu dois voir
   `[KBC-mail] N newsletter(s) KBC trouvée(s) …` puis `[KBC-mail] +N item(s) KBC ajouté(s)`.
   Les rapports apparaissent dans l'onglet **Institution → KBC** du desk.

## 🔎 Validation au 1er run réel (important)
Je n'ai pas pu tester de bout en bout (pas d'accès à la boîte). Deux points à vérifier sur le **1er
vrai e-mail** :
- **Extraction du lien PDF** : si les logs affichent `lien « version PDF » introuvable`, le HTML KBC
  diffère de l'attendu → on ajuste la regex `_extractPdfLink` dans `scrapers/kbc-newsletter.js`.
- **Affichage du PDF** : le lien « version PDF » est un redirect `t3.newsletter.kbc.be/r/…` → PDF.
  Si DTP ouvre l'original au lieu d'afficher le PDF inline, il faudra ajouter l'hôte du PDF final aux
  allowlists `PDF_PROXY_HOSTS` / `PDF_RENDER_HOSTS` de `server.js` (on aura l'hôte exact via le redirect).

## 🔒 Sécurité & confidentialité
- **Read-only** (`EXAMINE`) : aucun mail n'est marqué « lu », rien n'est modifié/supprimé.
- Seuls les mails **de `markets@newsletter.kbc.be`** sont lus (filtre `from` côté serveur IMAP).
- Le App Password vit uniquement dans le `.env` du VPS ; il est révocable à tout moment depuis ton
  compte Google (sans changer ton mot de passe).

## 🛠️ Maintenance
- **Changer de boîte / clé** : mets à jour `KBC_MAIL_USER` / `KBC_MAIL_PASS`.
- **Couper la fonctionnalité** : retire `KBC_MAIL_USER`/`KBC_MAIL_PASS` du `.env` → redevient dormant.
- **Ajouter d'autres newsletters KBC** : élargis `SUBJECT_RE` dans `scrapers/kbc-newsletter.js`.
- **Tester en local** : `KBC_MAIL_USER=… KBC_MAIL_PASS=… node -e "require('./scrapers/kbc-newsletter').getKbcMailReports().then(console.log)"`.

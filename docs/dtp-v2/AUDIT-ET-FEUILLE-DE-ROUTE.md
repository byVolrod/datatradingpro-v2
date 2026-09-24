# DTP V2 : audit de l'existant et feuille de route

> Rapport du 24/09/2026. **Aucune ligne de code n'a été modifiée pour le produire.**
> Principe directeur : DATA → CONTEXTE → RELATION → INTELLIGENCE → AIDE À LA DÉCISION.
> Règle absolue : la V2 se construit **au-dessus** de l'existant, jamais à sa place.

---

## 0. Le mécanisme « V2 réservée aux admins, réversible à tout moment »

C'est le préalable à toute ligne de V2. Il répond à la demande : « si je ne valide pas, on revient ».

- **Un interrupteur par compte admin** (`uipref` existant, clé `dtpV2`), affiché dans le menu du compte :
  « Aperçu V2 : activé / désactivé ». Désactivé = le desk exact des autres clients.
- **Code V2 dans des fichiers séparés** : `public/js/v2/*.js`, `public/css/v2.css`, `v2/*.js` côté serveur,
  monté par **une seule ligne** dans `server.js`. Aucune modification des fichiers existants au-delà de ce
  point de montage et d'un point d'accroche côté client.
- **Double garde** : routes `/api/v2/*` derrière `requireAdmin` (déjà en place, `server.js:645`) ; scripts V2
  chargés côté client **uniquement** si le compte est admin ET l'interrupteur actif.
- **Un banc dédié** (`v2-isolation-verif.js`, dans `npm run check`) : un compte client ne charge aucun
  fichier V2, aucune route V2 ne répond sans rôle admin, et le desk client est identique avec ou sans V2.
- **Trois niveaux de retour arrière** : interrupteur (instantané, par admin) → désactivation globale par
  variable d'environnement `DTP_V2=0` (sans redéploiement) → `git revert` du commit V2 (fichiers isolés,
  donc sans conflit avec le reste).

---

## A. Architecture actuelle (mesurée)

### Socle technique
| Élément | État mesuré |
|---|---|
| Serveur | Express monolithique : `server.js` **31 496 lignes**, **250 routes**, **68 minuteurs** de fond |
| Modules serveur | `ai.js` (Gemini → Claude multi-clés), `auth.js` (4 bases Supabase + miroir local), `mailer.js`, `whop.js`, `seance.js`, `walabels.js`, `wrapseg.js`, `scrapers/` |
| Client | Vanilla JS : `app.js` 16 984 l., `widgets.js` 11 908 l., `charts.js` 6 923 l., `admin.js` 3 746 l. ; `style.css` **23 252 lignes** |
| Graphiques | amCharts 5 (CDN) + TradingView (graphique de paire) + lightweight-charts (Banques) |
| Persistance | Supabase : `users`, `chat_messages`, `email_log`, `weekly_reports`, `ai_cache` (KV, **~55 familles de clés**) ; volume `data/` (miroir des comptes, profils Chromium, caches) |
| Hébergement | VPS 512 Mo, Docker Compose, disque éphémère hors `data/` |
| Déploiement | push `main` → `npm run check` (**116 bancs**) → jalon `prod-ready` → tireur systemd du VPS |
| Résilience | sauvegarde chiffrée nocturne (3 versions), keep-alive Supabase, moniteur disque à 5 paliers, quarantaine des bases revenues |

### Vues du desk
Fil d'actualité · Calendrier (+ fiches indicateur instantanées) · Taux · Radar de Biais · Semaine à venir ·
Banques (positions + graphique) · Analystes · Institutions (rapports de ~20 banques) · Liste FX · Journal
multi-comptes · Calculatrice · **Vue symbole** (aperçu, biais, BC, COT base/cotée, saisonnalité, particuliers) ·
**Mon Desk** (69 entrées au catalogue de widgets, panneaux à onglets, glisser-déposer).

### Sources de données
| Domaine | Source(s) |
|---|---|
| Actualité | investinglive (flux + Chromium), traduction IA pour l'affichage |
| Calendrier | ForexFactory (+ historique `calhist`, fiches `calendar-detail`) |
| Cotations | Yahoo Finance (API non officielle) |
| Taux / probabilités | rateprobability (Fed, BCE, BoE, BoJ, BoC, RBA), WatchTower (BNS, RBNZ + secours), CME ZQ, ASX IB, Eurex SARON / €STR datés, RBNZ B2, BoC Valet, BCE ; calendrier comme écrivain des décisions |
| Positionnement | COT CFTC, DMX particuliers (Myfxbook via Chromium) |
| Recherche | Goldman Sachs, BlackRock, ING, KBC, Nordea, SocGen, MUFG, CIBC, Westpac, UniCredit, Scotiabank, SEB, Wells Fargo, Lloyds, Natixis, HSBC, StanChart… |
| Vidéo | Bloomberg / Yahoo Finance (YouTube) |
| Relais | Firecrawl (budget 40/jour), passerelles publiques (allorigins, codetabs, corsproxy, jina) |

### IA
Gemini (quota gratuit) avec repli Claude multi-clés ; **tout est caché** (clé = empreinte) et **préchauffé en
fond** ; quota réparti selon l'usage réel des clients (fil d'actualité prioritaire). Produits : Radar de Biais
hebdomadaire, récaps quotidien/hebdo au style du mentor, analyses d'événements (`generateEventAnalysis`),
Copilote Macro (chat avec sources), traduction, segmentation des rapports, briefings (`london-prep`,
`us-briefing`, `eu-wrap`, `session-wraps`).

### Panneau admin
Tableau de bord (performances serveur, disque, schéma d'architecture, pipeline taux, bases), comptes,
support, campagnes, accès API, moniteur IA (par fournisseur, dernière erreur, usage réel), vitrine (clics).

---

## B. Ce qu'il faut conserver (ne pas toucher)

Chaque point ci-dessous est **tenu par un banc** : le modifier sans raison ferait rougir `npm run check`.

1. **La garde de déploiement** (`npm run check` avant tout, jalon `prod-ready`) : c'est elle qui rend la V2
   possible sans risque.
2. **La résilience des comptes** : 4 bases + miroir, quarantaine de lecture, « une lecture ne révoque jamais
   un accès », réparation d'échéance qui n'allonge que. Payée par un incident réel.
3. **Le pipeline des taux** et ses gardes (calendrier écrivain, arbitrage des valeurs, sources de marché
   par banque, recalage, fraîcheur par banque). C'est déjà une petite « couche de données fiables ».
4. **Le cache IA et le préchauffage** : c'est ce qui tient le quota gratuit.
5. **Le Radar de Biais** (8 piliers, version `BIAS_VER`), la Force des Devises, le calendrier et ses fiches,
   le fil et sa traduction : cœur de la valeur perçue.
6. **Le journal multi-comptes**, Mon Desk et ses réglages par compte.
7. **Le fil « Nouveautés DTP »** (`DTP_UPDATES`) : c'est le canal de confiance avec les clients.
8. **Les outils d'exploitation** : sauvegarde, moniteur disque, keep-alive, moniteur IA.

---

## C. Ce qui peut être amélioré, sans brutaliser l'existant

| Amélioration | Gain attendu | Comment, sans casser |
|---|---|---|
| **Provenance uniforme** : chaque donnée porte `{ valeur, source, à-jour-au, qualité }` | Traçabilité exigée par la V2, base de Data Health | Déjà amorcé (`rateSrc`, `srcAt`, `provider`, `panne` dans `/api/rates`). On l'étend **à côté** des payloads, jamais en changeant leur forme. |
| **Santé des données unifiée** | L'admin voit tout d'un coup d'œil | Les signaux existent mais sont éparpillés (pipeline taux, `_rpPanne`, `_fcEtat`, diag Directs, moniteur IA, disque). On les **agrège**, on ne les réécrit pas. |
| **Découpage progressif de `server.js`** | Lisibilité, risque de régression réduit | Uniquement pour le **nouveau** code (fichiers `v2/`). L'ancien reste où il est tant qu'il n'est pas touché. |
| **Mesure des performances côté client** | Détection d'anomalies | `perf-beacon.js` + `/api/perf/beacon` existent déjà : il manque la ligne de base et l'alerte. |
| **Liens entre modules** | Passer de modules isolés à un écosystème | La vue symbole relie déjà biais, BC, COT, saisonnalité, particuliers pour une paire : c'est le prototype du Market Brain. |
| **Directs vidéo** | Fin des faux « hors antenne » | Diagnostic admin existant ; cause à trancher (mur anti-robot ou extraction). |

---

## D. Nouvelles fonctionnalités proposées

Classées par **valeur pour le trader** puis par **risque technique**. Chacune répond à la question :
« aide-t-elle à comprendre le marché, à gagner du temps, ou à mieux décider ? »

| # | Fonction | Valeur trader | Risque | Réutilise |
|---|---|---|---|---|
| 1 | **Data Health** 🟢🟠🔴 par source | Indirecte mais vitale : ce qui est affiché est vrai | Faible | signaux existants |
| 2 | **Market Briefing 08:30** | Très forte : la journée comprise en 2 minutes | Faible à moyen (IA) | calendrier, taux, biais, force, risque, courbe US, fil, `london-prep` |
| 3 | **Contexte d'une donnée macro** (surprise → devise → BC → taux → actifs sensibles → réaction mesurée) | Très forte au moment de la publication | Moyen | `generateEventAnalysis`, écart au consensus, graphique de réaction, pricing par réunion |
| 4 | **Market Brain par actif** (EURUSD → macro EUR/USD, BCE/Fed, taux, COT, particuliers, corrélations, calendrier, actu, volatilité, saisonnalité) | Très forte : « pourquoi le marché est là » | Moyen | vue symbole + toutes les sources |
| 5 | **Graphe de relations** (Fed → USD → US10Y → or → EURUSD → risque) | Forte : relier au lieu d'empiler | Faible (relations écrites) à moyen (mesurées) | widget Corrélations, taux croisés, différentiel |
| 6 | **Performance et auto-diagnostic** (« le widget X est 3 fois plus lent que d'habitude ») | Indirecte | Faible (lecture seule, aucune correction automatique) | `perf-beacon`, moniteur serveur |
| 7 | **Cross-asset** : registre d'instruments (indices, matières, obligations, crypto, puis actions/futures) | Forte à terme | Moyen (fiabilité de Yahoo) | Indices & Matières, Rendements 10 ans, courbe US |
| 8 | **Carte du monde intelligente** | Forte pour la géopolitique et l'énergie | Moyen à élevé (sources d'événements) | amCharts (déjà chargé), fond de carte de l'horloge mondiale |
| 9 | **Terminal** : recherche globale, raccourcis clavier, « ouvrir dans son contexte », dispositions enregistrées | Forte au quotidien | Faible à moyen | recherche symbole, Mon Desk, préchargement |
| 10 | **Profil trader** (marchés suivis, favoris, horaires) qui ordonne l'information | Moyenne | Faible | `symrecent`, `uipref`, journal |
| 11 | **Order flow / footprint** | Forte pour une partie des traders | **Élevé : dépend d'un flux payant** | aucun (voir phase 6) |

---

## E. Architecture DTP V2 proposée

Contraintes qui décident de tout : **512 Mo de RAM**, un seul processus, disque éphémère, quota IA gratuit.
Donc **aucune nouvelle infrastructure lourde** (pas de file de messages, pas de base de graphe, pas de
second serveur) : des **modules en processus**, chargés à la demande, qui lisent les caches existants.

```
┌──────────────────────── COUCHE 4 · PRÉSENTATION ────────────────────────┐
│  Vues existantes (inchangées)   │   Vues V2 (admin, interrupteur)         │
│  Briefing · Market Brain · Relations · Carte · Data Health · Perf        │
└──────────────────────────────────┬───────────────────────────────────────┘
┌──────────────────── COUCHE 3 · MARKET BRAIN (v2/brain.js) ──────────────┐
│  Assembleur par actif : lit les couches 1-2, produit une fiche          │
│  structurée ; l'IA ne fait que RÉDIGER, chaque phrase cite ses données   │
└──────────────────────────────────┬───────────────────────────────────────┘
┌──────────────── COUCHE 2 · INTELLIGENCE (v2/relations, v2/contexte) ────┐
│  Graphe de relations (écrit + mesuré) · moteur de contexte d'événement   │
│  · briefing                                                              │
└──────────────────────────────────┬───────────────────────────────────────┘
┌──────────────── COUCHE 1 · MARKET DATA (v2/registre, v2/sante) ─────────┐
│  Registre d'instruments et de sources · enveloppe de provenance         │
│  { valeur, source, à-jour-au, qualité } · Data Health 🟢🟠🔴              │
│  → LIT les caches existants (_rpCache, _wtCache, calendrier, COT, DMX…) │
└──────────────────────────────────┬───────────────────────────────────────┘
┌──────────────────── COUCHE 0 · SOCLE EXISTANT (intouché) ───────────────┐
│  server.js, auth.js, ai.js, caches, minuteurs, bancs, déploiement        │
└──────────────────────────────────────────────────────────────────────────┘
```

**Règles de conception**
- La couche 1 **lit** l'existant, elle ne le remplace pas : un seul point de vérité par donnée.
- Une donnée sans source ou périmée est **affichée comme telle** (🟠/🔴), jamais masquée ni inventée.
- L'IA reçoit une **fiche de faits numérotés** et doit citer ses numéros ; une phrase sans citation est
  retirée à la relecture automatique. Pas de fait = pas de phrase.
- Tout ce qui est lourd (carte, graphe) est **chargé à la demande**, jamais au démarrage du desk.

---

## F. Feuille de route

Chaque phase suit **BUILD → TEST → VERIFY → PRESERVE** : livraison isolée, banc dédié, mesure de
performance, contrôle mobile, contrôle des données, retour arrière possible. Jamais de refonte globale.

### Phase 1 · Stabilité, performance, qualité des données
- **Déjà disponible** : pipeline taux avec fraîcheur par banque, moniteur IA, perf serveur/disque, `perf-beacon`, diag Directs, 116 bancs.
- **À développer** : interrupteur V2 (section 0) ; enveloppe de provenance ; **Data Health** qui agrège les signaux en 🟢🟠🔴 par source avec l'âge et la dernière erreur ; lignes de base de performance et alertes d'anomalie (lecture seule) ; correction des Directs.
- **Dépendances** : aucune.
- **Difficulté** : faible à moyenne.
- **Risques** : quasi nuls pour les clients (tout est admin et en lecture) ; attention au coût mémoire des mesures.
- **Impact utilisateur** : indirect mais fondamental (fiabilité).
- **Réutilisation** : très forte, surtout de l'agrégation.

### Phase 2 · Amélioration de l'intelligence existante
- **Déjà disponible** : analyses d'événements, écart au consensus, graphique de réaction, briefings de session, Radar de Biais, Copilote avec sources.
- **À développer** : **Market Briefing 08:30** (risque, drivers par devise, événements du jour, impact, cross-market, points d'attention) ; **contexte d'une donnée macro** en chaîne DATA → CONTEXTE → IMPACT ; réponses du Copilote avec la liste des données utilisées.
- **Dépendances** : phase 1 (provenance), sans quoi le briefing ne peut pas dire d'où vient chaque chiffre.
- **Difficulté** : moyenne.
- **Risques** : quota IA (on reste sur le préchauffage en fond, jamais à l'ouverture) ; hallucination (fiche de faits + citations obligatoires).
- **Impact utilisateur** : très fort.
- **Réutilisation** : forte.

### Phase 3 · Cross-asset et nouvelles données
- **Déjà disponible** : indices et matières, rendements 10 ans, courbe US, corrélations.
- **À développer** : registre d'instruments extensible (une classe d'actifs = une entrée, pas un module) ; obligations et taux élargis ; crypto (sources publiques gratuites) ; actions et futures en dernier.
- **Dépendances** : phase 1.
- **Difficulté** : moyenne.
- **Risques** : fiabilité de Yahoo (API non officielle) ; mémoire (limiter le nombre d'instruments rafraîchis en continu).
- **Impact utilisateur** : fort.
- **Réutilisation** : moyenne.

### Phase 4 · Market Brain
- **Déjà disponible** : la vue symbole est un Market Brain en germe (biais, BC, COT, saisonnalité, particuliers pour une paire).
- **À développer** : assembleur par actif ; **graphe de relations** (d'abord écrit à la main, relu, puis complété par les corrélations mesurées) ; clic sur un nœud = ses relations et leurs données ; synthèse « pourquoi le marché est là » et « ce qui invaliderait ce contexte ».
- **Dépendances** : phases 1 à 3.
- **Difficulté** : moyenne à élevée.
- **Risques** : fausse causalité (une corrélation n'est pas une cause : on l'écrit sur l'écran).
- **Impact utilisateur** : très fort, c'est le cœur de la différenciation.
- **Réutilisation** : forte.

### Phase 5 · Carte du monde interactive
- **Déjà disponible** : amCharts chargé, fond de carte de l'horloge mondiale, actualité catégorisée.
- **À développer** : couches **statiques et relues** d'abord (détroits, routes maritimes, grands ports, zones de production pétrole/gaz, banques centrales) ; puis événements rattachés depuis le fil (géolocalisation d'une dépêche) ; chaîne ÉVÉNEMENT → ZONE → COMMERCE/ÉNERGIE → ACTIFS → DEVISES → MARCHÉS.
- **Dépendances** : phase 4 (relations actifs ↔ zones).
- **Difficulté** : élevée.
- **Risques** : poids (chargement à la demande obligatoire) ; sources d'événements en temps réel (à choisir, certaines sont lourdes ou payantes).
- **Impact utilisateur** : fort pour la géopolitique et l'énergie.
- **Réutilisation** : moyenne.

### Phase 6 · Order flow / footprint
- **Déjà disponible** : rien, et c'est normal.
- **Faisabilité** : le **forex au comptant n'a pas de volume centralisé**. Le volume des brokers n'est qu'un nombre de ticks, et en tirer un footprint serait **fabriquer une donnée**, ce qui est exclu. Un vrai footprint exige les **futures** (CME : 6E, 6J, 6B… ou indices) en **tick par tick**, via un fournisseur **payant** avec licence d'exchange (coût à chiffrer auprès des fournisseurs, avant toute ligne de code). La **crypto** est faisable gratuitement (carnets et transactions publics des grandes plateformes) et peut servir de pilote technique.
- **Dépendances** : phase 3 ; **décision budgétaire**.
- **Difficulté** : élevée (flux temps réel, mémoire sur 512 Mo : probablement un service séparé).
- **Risques** : coût récurrent, charge serveur.
- **Impact utilisateur** : fort pour les traders intraday.
- **Réutilisation** : faible.

### Phase 7 · Écosystème professionnel complet
- **Déjà disponible** : Mon Desk (widgets, onglets, glisser-déposer, réglages par compte), recherche de symbole, préchargement des onglets, historique de recherche par compte.
- **À développer** : recherche globale (actifs, données, rapports, événements) ; raccourcis clavier ; « ouvrir dans son contexte » partout ; dispositions enregistrées et nommées ; profil trader qui ordonne l'information ; mode mobile repensé pour la lecture rapide.
- **Dépendances** : phases 1 à 4.
- **Difficulté** : moyenne, étalée.
- **Risques** : régression d'interface (d'où l'interrupteur et les bancs Chromium existants).
- **Impact utilisateur** : fort au quotidien.
- **Réutilisation** : forte.

---

## G. Ce qui est techniquement fragile (à surveiller, pas à réécrire)

1. **Monolithe** : `server.js` à 31 500 lignes et 68 minuteurs dans un seul processus de 512 Mo. Tout nouveau domaine va dans `v2/`.
2. **Chromium en production** (actualité, DMX) : pics mémoire ; déjà borné, à garder sous surveillance dans Data Health.
3. **Sources tierces sans contrat** : pages web des banques, ForexFactory, investinglive, Yahoo, YouTube. Une page qui change de forme casse une source en silence : c'est exactement ce que Data Health doit rendre visible.
4. **Passerelles publiques** (allorigins, corsproxy, jina) : utiles en secours, jamais dignes d'une source primaire.
5. **Quotas** : Gemini gratuit, Firecrawl 40/jour. Toute fonction V2 doit passer par le cache et le préchauffage.
6. **Directs** : faux « hors antenne » constaté le 24/09 (diagnostic admin demandé).
7. **Dettes suivies** : traductions anglaises orphelines, cadratins des anciennes annonces (cliquets en place).
8. **`style.css` à 23 000 lignes** : la V2 a sa propre feuille, préfixée, pour ne jamais entrer en conflit de spécificité.

---

## H. À valider avant de coder

1. L'**interrupteur admin** (section 0) comme mécanisme de validation et de retour arrière.
2. L'**ordre des phases** : je recommande de commencer par **Data Health** (phase 1) puis le **Market Briefing** (phase 2), qui réutilisent presque tout l'existant et apportent le plus vite.
3. Le **budget** éventuel pour un flux futures (phase 6) : sans lui, pas de footprint, et on ne le simulera pas.
4. Les **classes d'actifs prioritaires** pour la phase 3 (proposition : obligations et taux, puis indices, puis crypto).

---

## I. UX/UI V2 : ce que montrent les captures de référence, et comment le transposer

> Règle : on reprend **l'ergonomie** (organisation, densité, parcours), jamais l'habillage. DTP garde
> son identité : or `#e3b23a` / `#b8860b`, titres Fraunces et Inter Tight, coins doux, libellés en
> français, badges ACHAT / VENTE / NEUTRE. Là où la référence met de l'orange, DTP met de l'or.

### I.1 Les huit schémas d'ergonomie relevés

| # | Schéma observé | Ce que DTP a déjà | Ce que la V2 ajoute (admin d'abord) |
|---|---|---|---|
| 1 | **Barre d'espaces de travail** sous la barre du haut : dispositions nommées en onglets (« Taux », « COT », « Semaine à venir », « Actu temps réel »…), avec étoile de favori, fermeture, défilement horizontal ; les **paires ouvertes** y deviennent aussi des onglets avec leur drapeau | Mon Desk (une disposition), un seul onglet de symbole (`nav-symbol`) | Plusieurs dispositions **nommées et enregistrées par compte**, et plusieurs paires ouvertes en même temps. Les onglets actuels du desk restent accessibles tels quels. |
| 2 | **Barre du haut unifiée** : recherche de symbole au centre, **pastille de régime de marché** (« Neutre ») cliquable, puis icônes IA, direct, alertes, messages, compte | Recherche de symbole, volets IA / onde / cloche / support, jauge Sentiment de Risque | La pastille de régime (risk-on / neutre / risk-off) **dans la barre**, alimentée par le Sentiment de Risque existant, qui ouvre son explication. |
| 3 | **En-tête de panneau normalisé** : titre + contexte entre crochets (« [GBP/USD] », « [26/07 - 01/08] ») ; à droite, unités de temps en pastilles, **télécharger**, **aide (?)**, réglages, fermer | En-têtes harmonisés, réglages, unités de temps sur la Force des Devises | Le contexte entre crochets partout, et deux boutons sur chaque panneau : **exporter** (CSV / image, depuis les données réellement affichées) et **aide** (ce que montre le panneau, sa source, sa fraîcheur : c'est la traçabilité rendue visible). |
| 4 | **Vue paire à sous-onglets en bas d'écran** : Aperçu, Smart Bias, COT devise de base, COT devise cotée, Saisonnalité, Sentiment particuliers, Pricing banques centrales ; chaque sous-onglet est une **grille pleine page de 2×2 panneaux** | Exactement les mêmes sous-onglets (en haut), mais souvent un panneau par sous-onglet | Chaque sous-onglet devient une grille de panneaux complémentaires (voir I.2). Les sous-onglets restent en haut sur mobile, en bas sur grand écran. |
| 5 | **COT complet** : anneau long / short + position nette, historique en barres (1A, 3A, 5A, 10A, 15A, tout), **tableau détaillé** (intérêt ouvert, variations, % de l'intérêt ouvert, nombre de traders), catégorie de participants au choix | Positionnement COT, COT par devise | Page COT en 4 panneaux, **mêmes données CFTC** déjà collectées ; ajouter le tableau détaillé et le choix de catégorie. |
| 6 | **Saisonnalité** : projection avec bandes (68 et 95), tableau de projection (5 à 54 jours, probabilité, haut / médian / bas), tableau mois × années en carte de chaleur, courbes 5 / 10 / 15 ans | Saisonnalité, rendement mensuel | Carte de chaleur mois × années et courbes multi-horizons : pur calcul sur l'historique existant. Les **bandes de projection** seront libellées « projection statistique de l'historique, pas une prévision ». |
| 7 | **Sentiment particuliers** : barres 100% long / short jour par jour, anneau, tableau (positions, prix moyens long / short, volumes), liste de toutes les paires triée | Particuliers par paire, Statistiques DMX, Sentiment particuliers | Historique en barres empilées et tableau de statistiques, **depuis les données Myfxbook déjà relevées** ; afficher la date de dernière mise à jour. |
| 8 | **Grille de biais dense** avec sélecteur de semaine et **mode scanner** ; fil d'actualité avec colonne catégorie, étiquettes et dépêches importantes surlignées ; calendrier avec colonnes HAUT / PRÉVISION / BAS | Radar de Biais complet, fil catégorisé, calendrier Réel / Prévision / Précédent | Mode scanner du Radar (trier les devises par écart de biais). Colonnes HAUT / BAS du calendrier **seulement si une source fiable fournit la fourchette de consensus** : notre source actuelle ne la donne pas, on n'invente pas de colonne vide. |

### I.2 La vue paire V2, sous-onglet par sous-onglet (grille de panneaux)

| Sous-onglet | Panneaux proposés (tous alimentés par des données déjà présentes) |
|---|---|
| Aperçu | Graphique · Force des Devises focalisée · Calendrier des deux devises · Fil filtré (existant, conservé) |
| Biais | Radar des deux devises · piliers détaillés · narratif IA sourcé · événements clés de la semaine |
| COT base / cotée | Anneau · historique · tableau détaillé · écart net entre les deux devises |
| Saisonnalité | Carte de chaleur mois × années · courbes 5/10/15 ans · statistique du mois en cours · projection libellée comme telle |
| Particuliers | Barres 100% · anneau · statistiques · lecture contrarienne (écrite comme une lecture, pas une consigne) |
| Banques centrales | Cartes Taux des deux banques · trajectoires implicites superposées · différentiel de taux · prochaines réunions |

### I.3 Zones d'offre et de demande (vues sur une capture)
Faisables **sur les vraies bougies** déjà chargées (Yahoo) par un calcul déterministe et documenté (zones de
départ d'impulsion, testées ou non). À livrer avec la méthode affichée dans l'aide du panneau ; jamais de
zone dessinée à la main ou « à l'œil » par l'IA.

### I.4 Ordre de livraison UX proposé (admin, derrière l'interrupteur)
1. En-tête de panneau normalisé (contexte, exporter, aide avec source et fraîcheur) : faible risque, gain partout.
2. Pastille de régime de marché dans la barre du haut.
3. Vue paire en grilles de panneaux (sous-onglet par sous-onglet, un par livraison).
4. Barre d'espaces de travail : dispositions nommées et paires multiples.
5. Pages COT, Saisonnalité et Particuliers complètes ; mode scanner du Radar.

Chaque étape : banc Chromium (rendu, mobile 375 px, temps d'ouverture), comparaison avant / après sur le
desk client (identique), retour arrière par l'interrupteur.

### I.5 Captures complémentaires : dispositions « Actu », « Test », « Recherche »

| Schéma observé | Ce que DTP a déjà | Ce que la V2 ajoute |
|---|---|---|
| **Deux graphiques côte à côte** (une paire FX et l'or) avec barre d'outils de tracé, dans une même disposition, sous le fil d'actualité | Widget Graphique (TradingView), panneau à onglets | Dispositions prêtes à l'emploi « Actu + deux graphiques » ; le choix de l'actif par panneau est déjà un réglage. Rien à inventer, c'est de la composition. |
| **Onglets imbriqués en pied de panneau** (« Tab 1 », « Tab 2 ») | Panneau à onglets (réordonnables, banc `onglets-verif`) | Déjà là : harmoniser seulement la position (pied) sur grand écran. |
| **Scenario Desk** : pour chaque événement, scénario de renforcement / d'affaiblissement de la devise, avec seuils (« chômage à 4,3% ou moins ») et fourchette haut / prévision / bas | Widget Scenario Desk | Relier chaque scénario au **Market Brain** (phase 4) : taux concernés, pricing de la réunion suivante, réaction passée mesurée sur la même publication. |
| **Sentiment de risque** : jauge + une ligne d'explication sous le titre (« Neutre : appétit équilibré… ») | Jauge Sentiment de Risque + historique | La ligne d'explication, **construite à partir des composantes mesurées** de la jauge (pas un texte libre). C'est aussi la pastille de régime de la barre du haut (I.1 n° 2). |
| **Horaires des places** : bandes par séance sur une frise de 24 h, chevauchements visibles, heure d'été gérée | Widget Sessions de marché, Horloge mondiale | Frise unique 24 h avec chevauchements (liquidité maximale) et repère de l'heure actuelle. |
| **Points hauts et bas** annotés sur le graphique (flèches + prix), par unité de temps | Widget Points hauts et bas | Annotation directement sur les bougies réelles, avec l'unité de temps au choix. |
| **Liste de recherche** : filtres (fichiers, types, institutions), recherche plein texte, favori, date, logo de l'institution, compteur « N sur N » | Onglet Institutions / Analystes (catalogue, recherche, filtres, favoris, lecteur PDF) | Déjà très proche : ajouter le logo d'institution en colonne et le compteur ; garder notre lecteur « document ». |
| **Lecteur de rapport** : étiquettes thématiques cliquables (USD, BoJ, Brent…) + **cartes d'éclairages IA** au-dessus du document, masquables | Lecteur Institutions + Éclairages IA (`report-insights`) | Étiquettes thématiques **extraites du texte du rapport** et cliquables vers le Market Brain de l'actif ; chaque éclairage renvoie au passage du rapport dont il est tiré (traçabilité). |
| **Tableau libre (« moodboard »)** et **notes** à côté des rapports | Widget Notes (par compte) | Tableau libre : **faible valeur trader au regard de son coût** (outil de dessin complet). Proposé en dernier, ou remplacé par des notes épinglées à un rapport ou à un actif. |

**Lecture d'ensemble** : ces captures confirment que l'écart principal n'est pas dans les **modules** (DTP
les a presque tous) mais dans la **composition** (dispositions nommées, grilles de panneaux, en-têtes
normalisés) et dans les **liens** entre modules. C'est exactement ce que visent les phases 1, 4 et 7 :
la V2 est d'abord un travail d'assemblage de l'existant.

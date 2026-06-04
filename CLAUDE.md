# DataTradingPro — Cahier des charges (CLAUDE.md)

> Clone fidèle de **Prime Terminal (PMT)**. Quand l'utilisateur dit « comme PMT » / « comme sur l'image » → recopier PMT **à l'identique** (couleur, position, comportement). La référence ultime, c'est PMT.

## Stack & contraintes (NE PAS proposer autre chose)
- **Vanilla JS + CSS pur + Express** servi statiquement. **PAS de React/Tailwind/build.** L'utilisateur demande souvent « React + Tailwind » → toujours livrer **l'équivalent vanilla** (classes Tailwind traduites en CSS, SVG inline). Ne jamais introduire de framework.
- **amCharts 5** pour les graphiques (dark + orange).
- **Render free tier** : 512 Mo RAM, disque **éphémère**, veille ~15 min → anti-OOM/502 obligatoire (timeouts fetch, caps mémoire, verrous, **persistance Supabase `ai_cache`** pas disque).
- **Gemini free-tier** (quota dur) + repli **Claude multi-clés** (`ai.generateText`). Tout l'IA doit **cacher** (clé = hash) et idéalement **préchauffer en tâche de fond** (jamais générer quand l'utilisateur ouvre).
- UI **100 % en français** (les libellés produit PMT en anglais restent en anglais : « AI Insights », « Online », etc.).

## SÉCURITÉ (verbatim, ne jamais enfreindre)
- Une clé Anthropic « sk-ant-api03-o1yqU_… » a été COMPROMISE → à roter. **Ne jamais stocker/committer de clés.** Les clés vivent UNIQUEMENT dans les env vars Render. `.env.render` est gitignored → **JAMAIS committer**.

## Workflow (chaque changement)
- **Commit + push à chaque fois** (Render redéploie depuis `main`). Messages FR, finir par `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **BACKUP OBLIGATOIRE** : après CHAQUE `git push origin main`, faire AUSSI `git push backup main` (remote `backup` = `https://github.com/byVolrod/datatradingpro-v2-backup.git`, repo privé miroir). Le backup doit toujours rester à jour avec origin. (Si le remote `backup` manque sur une nouvelle machine : `git remote add backup https://github.com/byVolrod/datatradingpro-v2-backup.git`.)
- **Cache-busting** : bumper `?v=YYYYMMDDx` sur app.js/charts.js/style.css dans `public/index.html`. Rappeler **Ctrl+F5**.
- Toujours `node -c` les fichiers JS + vérifier l'équilibre des accolades CSS avant commit.

## Design : High-Density Fintech HUD
- Fond noir pur **`#0c0c0e`** / `#0a0a0c`, compact, **sans ombres portées**, angles carrés ou micro-arrondis (`3px`→`6px` max). Max de données par pixel (cockpit / salle de marché).
- Lignes de séparation fines : `border-b` très sombre (≈ `neutral-900/60`, token `--hud-line`).
- **Pas de dialogs natifs** (confirm/prompt/alert) → confirmations/édition **inline**.
- **Volatilité** : historique de chat, position du splitter orange, etc. = **purement volatils**, reset au reload (**pas de localStorage**).

## Tokens sémantiques — états de marché (charte immuable)
- **BUY / UPTREND / BULLISH** → vert émeraude vif `#00e676` (ou `#00cc99` turquoise selon contexte).
- **SELL / DOWNTREND / BEARISH** → rouge vif d'alerte `#ff3d00`.
- **NEUTRAL** → jaune-orange doré `#ffb300` (ou gris anthracite mat selon le composant).
- Orange signature terminal : **`#ff7a00`**. Risk-off rouge : `#ef4444`. Risk-on vert : `#22c55e`.
- Currency Strength Meter (DOM exact PMT) : vert `rgba(0,218,80,0.867)` / rouge `rgba(255,0,0,0.933)`, bordure même teinte `0.3`, `rounded-sm`, `shadow-inner`.

## Composants clés
- **Splitter orange synchrone** : layout parent en **CSS Grid** `grid-template-columns: minmax(0,1fr) 1px var(--sidebar-w)` (le `1fr` recalcule à la même frame que la souris → zéro décalage). Barre orange isolée des scrollbars. `pointer-events:none` sur les enfants pendant le drag. Reset au reload.
- **Currency Strength Meter** : égaliseur segmenté bidirectionnel, axe central (zéro), vert vers le haut / rouge vers le bas. Trame éteinte toujours visible (jamais « vide »). (Under-glow ambre retiré : l'utilisateur n'en voulait pas.)
- **Macro AI Assistant** (volet droit) : avatar = **`/assets/images/macro-ai-logo.png`** (logo officiel téléchargé en local). État **« L'IA écrit… »** (avatar + 3 points gris qui rebondissent) avant le texte. **Streaming typewriter** caractère par caractère (markdown tolérant aux `**` non fermés). Accordéon **`> N sources used`** orange + heure → **uniquement à la fin** du streaming. Input : icônes pièce jointe + textarea + envoi orange plein, **Entrée = envoi / Shift+Entrée = nouvelle ligne**. Backend `/api/ai/chat` (Gemini→Claude + contexte Smart Bias/news + cache). Volatil.
- **Analyst Report Viewer** : envoie le texte de `sessionwrap` au backend, attend un JSON **dynamique** : `aiInsights` = tableau d'objets `{ asset, signal, text }` (badges BUY vert / SELL rouge / NEUTRAL ambre, pas de badge si `signal` null) ; `sessionContent` = objet à **clés dynamiques** (titres détectés : `IRAN CONFLICT`, `EQUITIES`, `FX`…) parcouru en `.map()` → titres en **MAJUSCULES orange `#ff7a00`**. Markdown léger : gras auto sur chiffres/%/tickers. **Préchauffé** (segmentation IA en cache) → ouverture instantanée.
- **Research Directory** (catalogue Analyst) : barre de recherche + 2 dropdowns, cartes feed (icône globe bleue, titre, bookmark, tags arrondis + `+N`, badge `PT` + date mono), pied « Showing N of N research papers ».

## Volets latéraux (Drawer Navigation)
- Déclencheurs = icônes topbar haut-droite : **AI** (chat macro), **Onde** (Live Market Squawk), **Cloche** (Notifications), **Bulle** (Support « Mike »).
- **Les volets se calent SOUS la topbar** : `top: var(--topbar-h)` + `height: calc(100dvh - var(--topbar-h))`. **Jamais `top:0`** (sinon ils recouvrent la navbar et bloquent les icônes).
- **Un seul volet ouvert à la fois** (exclusion mutuelle) ; rouvrir/croix → fermé.
- **Rideau flouté** : un backdrop sous la topbar floute+assombrit le dashboard (`backdrop-filter: blur(6px)` + voile sombre) tandis que la topbar reste nette et cliquable.
- **Base commune** : `absolute right-0`, fond `#0c0c0e`, bordure gauche `#1c1c20`, header (titre + état à gauche, croix grise à droite), séparateurs de dates centrés (`lundi 20 avril 2026` au milieu d'une ligne fine), input identique au chat IA.

# DataTradingPro — app mobile

Coquille native (Expo / React Native) qui affiche le desk. **Le desk n'est pas réécrit.**

## Pourquoi une coquille et pas un portage

Le desk fait 56 000 lignes de JS et 21 000 de CSS, avec 934 appels DOM directs et 131 appels
amCharts. Rien de tout cela ne s'exécute en React Native : un portage serait un second produit,
à faire évoluer deux fois pour toujours.

**Conséquence heureuse :** chaque déploiement du desk est en ligne sur les deux apps
*instantanément* — pas d'OTA à déclencher, pas de revue de store, pas de version à faire adopter.
EAS Update ne sert plus qu'à `App.js`, qui bouge rarement.

**Conséquence à traiter :** la règle 4.2 d'Apple refuse une app qui n'est qu'un site emballé. Ce
qui la fait passer, ce sont les trois capacités natives présentes dans `App.js` — notifications
push, déverrouillage biométrique, mode hors-ligne. **Les retirer, c'est reprendre le refus.**
`scripts/mobile-app-verif.js` les épingle.

## Ce que le desk peut demander à la coquille

Trois ordres, par `postMessage`. Tout le reste est ignoré.

```js
// Demander l'autorisation de notifier, puis recevoir le jeton
window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'dtp:push' }));
window.addEventListener('dtp:pushtoken', e => console.log(e.detail));  // → à envoyer au serveur

// Activer / désactiver le verrou biométrique
window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'dtp:verrou', actif: true }));

// Ouvrir une URL hors de l'app (https uniquement)
window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'dtp:ouvrir', url: 'https://…' }));
```

Détecter la coquille depuis le desk : `!!window.ReactNativeWebView`.

## Construire et publier

Depuis `mobile/`, avec Node 20+ :

```bash
npm install
npx eas-cli login                 # ou : export EXPO_TOKEN=…  (jamais dans un fichier)
npx eas-cli build:configure       # crée le projet côté Expo, écrit extra.eas.projectId
npx eas-cli build --platform android --profile production
npx eas-cli build --platform ios  --profile production      # aucun Mac requis
```

**iOS sans Mac :** EAS compile sur ses propres machines macOS. Il faut un compte Apple Developer
(99 USD/an) ; EAS gère la signature.

**Android :** EAS génère et garde la clé de signature. `npx eas-cli credentials` affiche
l'empreinte SHA-256 — voir ci-dessous.

## L'étape qu'on rate toujours (Android)

L'app doit prouver qu'elle et le domaine appartiennent au même propriétaire, sinon Android ouvre
le desk **avec une barre d'adresse de navigateur**.

1. `npx eas-cli credentials` → relever l'empreinte SHA-256.
2. Sur le VPS, dans `/opt/datatradingpro/.env` : `ANDROID_CERT_SHA256=AB:CD:…` (32 octets, `:`).
3. Redéployer, puis vérifier `https://desk.datatradingpro.com/.well-known/assetlinks.json` :

```bash
ssh -i ~/.ssh/dtp_deploy root@149.71.44.90 \
  'cd /opt/datatradingpro && git fetch origin main && git reset --hard origin/main \
   && docker compose build datatradingpro && docker compose up -d datatradingpro'
```

⚠️ **Pousser sur GitHub ne déploie rien** : le VPS ne bouge que sur cette commande.

**Il en faut souvent DEUX.** Avec Play App Signing (activé par défaut), Google re-signe l'app avec
sa propre clé : l'empreinte qui compte est alors celle de *Play Console → Configuration → Intégrité
de l'application*, pas celle de votre clé d'importation. La variable accepte une liste séparée par
des virgules — en publier une de trop ne coûte rien, en oublier une fait échouer la vérification
sans le moindre message.

## Fichiers

| Fichier | Rôle |
|---|---|
| `App.js` | la coquille : WebView, push, biométrie, hors-ligne, filtre de navigation |
| `app.json` | identité Expo, identifiants de paquet, icônes, permissions |
| `eas.json` | profils de compilation et de soumission |
| `twa-manifest.json` | variante Android sans React Native (Bubblewrap), même identifiant de paquet |
| `icon-1024.png`, `icon-adaptive.png`, `splash.png` | générés depuis `public/favicon.svg`, jamais agrandis |

## Secrets

Aucun jeton, aucune clé dans ce dossier — règle du projet. `EXPO_TOKEN` vit dans l'environnement
de la machine ou de la CI, jamais dans un fichier versionné.

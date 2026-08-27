#!/usr/bin/env node
/* ═══ L'APP MOBILE : CE QUI LA FAIT ACCEPTER, ET CE QUI LA FERAIT REFUSER ══════════════════════
   L'app n'est pas une réécriture du desk : c'est une coquille native qui l'affiche. Ce choix est
   mesuré (56 000 lignes de JS et 21 000 de CSS, 934 appels DOM, 131 appels amCharts — rien de tout
   cela ne tourne en React Native), et il a une contrepartie : la RÈGLE 4.2 D'APPLE, qui refuse une
   app n'étant qu'un site emballé.

   ⚠️ CE QUI LA FAIT PASSER, CE SONT LES CAPACITÉS NATIVES — push, biométrie, hors-ligne. Les
   retirer « pour simplifier » remettrait le refus, et personne ne s'en apercevrait avant la revue.
   Ce banc existe pour que leur disparition rougisse ici plutôt que chez Apple. */
const fs = require('fs');
const path = require('path');
const M = path.join(__dirname, '..', 'mobile');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const lire = f => { try { return fs.readFileSync(path.join(M, f), 'utf8'); } catch { return ''; } };
const json = f => { try { return JSON.parse(lire(f)); } catch { return null; } };

console.log('\n── 1. Le projet est complet ──');
for (const f of ['App.js', 'index.js', 'app.json', 'eas.json', 'package.json', 'babel.config.js', 'icon-1024.png', 'icon-adaptive.png', 'splash.png']) {
  v(f + ' est là', fs.existsSync(path.join(M, f)));
}
const APP = lire('App.js'), CFG = json('app.json'), EAS = json('eas.json'), PKG = json('package.json');

console.log('\n── 2. Le JSX se parse (aucun outil de build ne le fera avant EAS) ──');
let parser = null;
try { parser = require('@babel/parser'); } catch { try { parser = require(path.join(__dirname, '..', 'node_modules', '@babel', 'parser')); } catch {} }
if (!parser) console.log('  · @babel/parser absent → contrôle abstenu (pas un échec)');
else for (const f of ['App.js', 'index.js']) {
  let e = null;
  try { parser.parse(lire(f), { sourceType: 'unambiguous', plugins: ['jsx'] }); } catch (err) { e = err.message; }
  v(f + ' se parse', !e, e);
}

console.log('\n── 3. Les trois capacités qui répondent à la règle 4.2 ──');
v('les notifications sont demandées', /Notifications\.requestPermissionsAsync/.test(APP));
v('… et le jeton part AU DESK, il n\'est pas gardé ici', /dtp:pushtoken/.test(APP) && /injectJavaScript/.test(APP));
v('… la permission n\'est PAS demandée à l\'ouverture', !/useEffect\(\s*\(\)\s*=>\s*\{\s*jetonPush/.test(APP),
  'la demander avant que l\'utilisateur ait rien vu la fait refuser');
v('le déverrouillage biométrique existe', /LocalAuthentication\.authenticateAsync/.test(APP));
v('… il vérifie que l\'appareil sait le faire', /hasHardwareAsync/.test(APP) && /isEnrolledAsync/.test(APP));
v('… et il se redemande au retour au premier plan', /AppState\.addEventListener/.test(APP));
v('… le réglage est gardé dans le trousseau, pas en clair', /SecureStore/.test(APP) && !/AsyncStorage/.test(APP));
v('le hors-ligne est traité', /NetInfo\.addEventListener/.test(APP));
v('… et il le DIT au lecteur', /Hors ligne/.test(APP));

console.log('\n── 4. La frontière de la coquille ──');
/* Une coquille qui exécute ce que la page lui demande n'est plus une frontière. */
v('les messages du desk sont filtrés par type', /m\.type === 'dtp:push'/.test(APP) && /m\.type === 'dtp:verrou'/.test(APP));
v('… et une URL poussée par la page doit être en https', /\/\^https:\\\/\\\/\/\.test\(m\.url\)/.test(APP) || /\^https:/.test(APP));
v('ce qui n\'est pas le desk s\'ouvre DEHORS', /Linking\.openURL/.test(APP) && /onShouldStartLoadWithRequest/.test(APP));
/* ⚠️ CE CONTRÔLE CHERCHAIT UNE CHAÎNE, et il était VIDE : pris à la mutation, remplacer la
   comparaison par un `startsWith` le laissait vert, puisque `new URL(u).hostname` survivait sur la
   ligne du dessus. On ÉPROUVE donc le vrai filtre, extrait d'App.js, contre une URL hostile —
   `https://desk.datatradingpro.com.attaquant.tld/` commence bien par le domaine du desk. C'est la
   frontière de la coquille : ce qui passe ici tourne AVEC la session du client. */
{
  const mF = /const filtrer = useCallback\(\(req\) => \{[\s\S]*?\n  \}, \[\]\);/.exec(APP);
  v('le filtre de navigation est extractible', !!mF);
  if (mF) {
    const ouverts = [];
    const corps = mF[0].replace('const filtrer = useCallback((req) => {', 'function filtrer(req) {').replace(/\n  \}, \[\]\);$/, '\n}');
    const F = new Function('DESK', 'Linking', corps + '\nreturn filtrer;')(
      'https://desk.datatradingpro.com', { openURL: (u) => { ouverts.push(u); return { catch: () => {} }; } });
    const dedans = (u) => F({ url: u });
    v('le desk lui-même reste dans la coquille', dedans('https://desk.datatradingpro.com/index.html') === true);
    v('… un sous-domaine du desk aussi', dedans('https://www.datatradingpro.com/') === true);
    v('UN DOMAINE QUI COMMENCE PAREIL EST REJETÉ',
      dedans('https://desk.datatradingpro.com.attaquant.tld/') === false,
      'un test « commence par » le laisserait entrer, avec la session du client');
    v('… un domaine qui CONTIENT le nôtre aussi', dedans('https://attaquant.tld/desk.datatradingpro.com/') === false);
    v('un paiement Whop part au navigateur', dedans('https://whop.com/jot-dtp/') === false && ouverts.some(u => /whop\.com/.test(u)));
    v('… et une URL illisible ne passe pas', dedans('pas-une-url') === false);
  }
}
v('la session survit (cookies + stockage)', /sharedCookiesEnabled/.test(APP) && /domStorageEnabled/.test(APP));
v('le bouton RETOUR d\'Android recule dans le desk', /hardwareBackPress/.test(APP) && /goBack\(\)/.test(APP));
v('l\'erreur de chargement propose un vrai réessai', /renderError/.test(APP) && /setEssai/.test(APP),
  'sans changer la clé, la WebView ne recharge pas');

console.log('\n── 5. L\'identité DTP, pas celle d\'un gabarit ──');
const OR = '#e3b23a', FOND = '#0c0c0e';
v('l\'or de la marque est la couleur d\'accent', APP.indexOf(OR) > 0 && CFG && CFG.expo.primaryColor === OR);
v('le fond est celui du desk', CFG && CFG.expo.backgroundColor === FOND && CFG.expo.splash.backgroundColor === FOND);
v('le thème sombre est déclaré', CFG && CFG.expo.userInterfaceStyle === 'dark');
v('aucune couleur invalide ne traîne', !/#[0-9a-f]*[g-z]/i.test(APP.replace(/https?:\/\/[^\s'"]+/g, '')),
  'une valeur comme « #3d3venue » se rend en transparent, en silence');

console.log('\n── 6. Les deux magasins ──');
v('l\'identifiant iOS est posé', CFG && CFG.expo.ios.bundleIdentifier === 'com.datatradingpro.app');
v('… et celui d\'Android est le MÊME', CFG && CFG.expo.android.package === CFG.expo.ios.bundleIdentifier);
/* Le même identifiant que la TWA : publier les deux sous des identifiants différents créerait deux
   apps concurrentes sur Play, et la seconde ne pourrait pas mettre à jour la première. */
const TWA = json('twa-manifest.json');
v('… et celui de la TWA aussi', TWA && TWA.packageId === CFG.expo.android.package, TWA ? TWA.packageId : '(twa-manifest absent)');
v('la déclaration de chiffrement iOS est faite', CFG && CFG.expo.ios.config.usesNonExemptEncryption === false,
  'sans elle, chaque envoi demande un questionnaire export');
v('l\'icône adaptative Android est fournie', CFG && !!CFG.expo.android.adaptiveIcon.foregroundImage);
v('la production Android sort un AAB, pas un APK', EAS && EAS.build.production.android.buildType === 'app-bundle',
  'Play refuse les APK pour une nouvelle app');
v('… et la piste de soumission est interne', EAS && EAS.submit.production.android.track === 'internal');

console.log('\n── 7. Les visuels ont la taille que les stores exigent ──');
const dim = (f) => { try { const b = fs.readFileSync(path.join(M, f)); return b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; } catch { return null; } };
const i1 = dim('icon-1024.png'), ia = dim('icon-adaptive.png'), sp = dim('splash.png');
v('l\'icône fait 1024×1024', i1 && i1[0] === 1024 && i1[1] === 1024, JSON.stringify(i1));
v('l\'icône adaptative aussi', ia && ia[0] === 1024 && ia[1] === 1024, JSON.stringify(ia));
v('l\'écran de lancement est carré et généreux', sp && sp[0] === sp[1] && sp[0] >= 1024, JSON.stringify(sp));

console.log('\n── 8. Aucun secret n\'entre dans le dépôt ──');
/* La règle du projet, posée après une clé Anthropic compromise : les clés vivent dans les variables
   d'environnement, jamais dans les fichiers. Un jeton Expo permet de publier chez les clients. */
const tout = ['App.js', 'app.json', 'eas.json', 'package.json', 'index.js', 'twa-manifest.json'].map(lire).join('\n');
v('aucun jeton Expo', !/\b[A-Za-z0-9_-]{20,}_[A-Za-z0-9_-]{20,}\b/.test(tout) || !/EXPO_TOKEN\s*[:=]\s*['"][^'"]+/.test(tout));
v('aucune clé en dur', !/(sk-ant-|sk_live|AIza[0-9A-Za-z_-]{35})/.test(tout));
v('l\'URL du desk vient de la configuration, pas d\'une constante enfouie',
  /Constants\.expoConfig\?\.extra\?\.deskUrl/.test(APP) && CFG && !!CFG.expo.extra.deskUrl);

console.log('\n── 9. La preuve de domaine Android (côté serveur) ──');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
v('la route assetlinks existe', /app\.get\('\/\.well-known\/assetlinks\.json'/.test(SRV));
v('… l\'empreinte vient d\'une variable d\'environnement', /process\.env\.ANDROID_CERT_SHA256/.test(SRV));
v('… PLUSIEURS empreintes sont acceptées', /\.split\(','\)/.test(SRV),
  'avec Play App Signing il en faut deux : la clé d\'import ET celle de Google');
v('… une empreinte malformée est refusée', /_TWA_SHA_RX/.test(SRV) && /\{31\}/.test(SRV));
v('… et sans empreinte on rend un tableau vide, pas une erreur', /Aucune empreinte publiée/.test(SRV));
v('… l\'identifiant de paquet est celui de l\'app', /ANDROID_PACKAGE_NAME \|\| 'com\.datatradingpro\.app'/.test(SRV));
v('/.well-known/ est servi sans session', SRV.indexOf("'/.well-known/'") > 0);

console.log('\n── 10. Ce qui ferait échouer une compilation EAS ──');
/* ⚠️ CES DEUX CONTRÔLES VALENT UNE COMPILATION RATÉE CHACUN. Une compilation EAS part en file
   d'attente, prend un quart d'heure et consomme des minutes du forfait : elle est le pire endroit
   où découvrir qu'un paquet manque ou qu'une version ne colle pas au SDK. Les deux défauts ont été
   trouvés ICI, en compilant pour de vrai — `expo-asset` absent (Metro refusait de démarrer), puis
   deux versions natives hors SDK que j'avais moi-même introduites en l'installant sans contrainte. */
const MP = json('package.json');
const nm = (f) => path.join(M, 'node_modules', f);

/* Les dépendances que le code IMPORTE doivent être DÉCLARÉES : un import qui résout par hasard
   depuis une dépendance transitive casse dès qu'elle change de version. */
const imports = [...APP.matchAll(/^import[^'"]*['"]([^'".][^'"]*)['"]/gm)].map(m => m[1])
  .map(x => x.startsWith('@') ? x.split('/').slice(0, 2).join('/') : x.split('/')[0]);
const manquants = [...new Set(imports)].filter(x => !(MP && MP.dependencies && MP.dependencies[x]));
v('tout ce qu\'App.js importe est déclaré en dépendance', !manquants.length, manquants.join(', '));
/* `expo-asset` n'est importé par personne : c'est la configuration Metro d'Expo qui l'exige, et son
   absence ne se voit qu'au démarrage du bundler. D'où un contrôle nommé. */
v('expo-asset est déclaré (Metro refuse de démarrer sans lui)', !!(MP && MP.dependencies && MP.dependencies['expo-asset']));

/* LES VERSIONS NATIVES doivent suivre le SDK : EAS compile du code natif, et un décalage y produit
   une erreur de compilation, pas un avertissement. La table de référence est celle d'Expo lui-même
   (`bundledNativeModules.json`), jamais une liste recopiée à la main qui se périmerait en silence. */
if (!fs.existsSync(nm('expo'))) {
  console.log('  · dépendances non installées → contrôle des versions abstenu (npm install dans mobile/)');
} else {
  let semver = null;
  try { semver = require(nm('semver')); } catch { try { semver = require('semver'); } catch {} }
  const tbl = (() => { try { return JSON.parse(fs.readFileSync(nm('expo/bundledNativeModules.json'), 'utf8')); } catch { return null; } })();
  v('la table des versions du SDK est lisible', !!tbl);
  if (tbl && semver) {
    /* ⚠️ DEUX VERSIONS, ET C'EST LA DÉCLARÉE QUI DÉCIDE. Le premier jet de ce contrôle ne lisait que
       la version INSTALLÉE dans node_modules — pris à la mutation : ramener react-native à 0.74.0
       dans package.json ne le faisait pas rougir, puisque node_modules gardait la bonne. Or EAS
       compile sur SES machines, où il lance `npm install` À PARTIR DE package.json : c'est la
       PLAGE DÉCLARÉE qui détermine ce qui sera bâti. On éprouve donc les deux — la plage déclarée
       doit tenir dans celle du SDK, et ce qui est installé ici doit s'y conformer aussi (sinon on
       met au point contre autre chose que ce qui sera compilé). */
    const ecartsDecl = [], ecartsInst = [];
    for (const [n, attendu] of Object.entries(tbl)) {
      const declare = MP.dependencies[n];
      if (!declare) continue;
      let tient = false;
      try { tient = semver.subset ? semver.subset(declare, attendu) : semver.intersects(declare, attendu); }
      catch { tient = true; }                      // plage exotique (lien local, git) → on ne juge pas
      if (!tient) ecartsDecl.push(n + ' déclaré ' + declare + ' ≠ ' + attendu);
      let inst = null;
      try { inst = JSON.parse(fs.readFileSync(nm(n + '/package.json'), 'utf8')).version; } catch { continue; }
      if (!semver.satisfies(inst, attendu)) ecartsInst.push(n + ' ' + inst + ' ≠ ' + attendu);
    }
    v('les versions DÉCLARÉES tiennent dans le SDK (c\'est ce qu\'EAS installera)', !ecartsDecl.length, ecartsDecl.join(' · '));
    v('… et les versions INSTALLÉES ici aussi', !ecartsInst.length, ecartsInst.join(' · '));
  }
}

console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
process.exit(ko ? 1 : 0);

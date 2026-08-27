#!/usr/bin/env node
/* ═══ LA CHAÎNE DE NOTIFICATIONS PUSH DE L'APP MOBILE ══════════════════════════════════════════
   09/09. La coquille native savait déjà demander l'autorisation de notifier et produire un jeton
   Expo — mais PERSONNE ne le ramassait : ni le desk, ni le serveur. Le jeton naissait et mourait
   dans la WebView. Aucune alerte ne pouvait donc arriver écran verrouillé, alors que c'est la
   raison d'être de l'app ET la capacité native sur laquelle repose son passage en revue Apple.

   ⚠️ CE BANC EXTRAIT LES VRAIES FONCTIONS de server.js et lit le VRAI App.js. Il n'en recopie
   aucune : une copie resterait verte le jour où l'original change.
   ⚠️ IL VÉRIFIE AUSSI CE QUI N'EST PAS DANS UN SEUL FICHIER — l'accord entre le canal Android
   déclaré par la coquille et celui que le serveur envoie. Un désaccord ne lève AUCUNE erreur :
   la notification part, arrive, et atterrit dans le canal par défaut, sans le son ni l'importance
   HIGH qu'on a pris soin de configurer. C'est exactement le genre de défaut qu'aucun des deux
   fichiers ne peut voir tout seul. */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const NAT = fs.readFileSync(path.join(RACINE, 'mobile/App.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 300) : '')); } };
const fn = (src, nom) => { const m = new RegExp('function ' + nom + '\\([\\s\\S]*?\\n\\}').exec(src); return m ? m[0] : null; };
const cst = (src, nom) => { const m = new RegExp('const ' + nom + ' = ([^;\\n]+);').exec(src); return m ? m[1] : null; };

console.log('\n── 1. Le jeton : ce qu\'on accepte de stocker ──');
const srcRx = cst(SRV, '_PUSH_RX_JETON');
v('_PUSH_RX_JETON est extractible', !!srcRx);
if (srcRx) {
  const rx = eval('(' + srcRx + ')');
  v('un vrai jeton Expo passe', rx.test('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'));
  v('… sous sa forme moderne aussi', rx.test('ExpoPushToken[AbC-123_x.y%z]'));
  /* Le jeton finit dans un JSON envoyé à un tiers ET dans une clé KV : tout ce qui n'est pas un
     jeton doit être refusé À L'ENTRÉE, pas assaini plus loin. */
  v('une chaîne quelconque est refusée', !rx.test('bonjour'));
  v('un préfixe approchant est refusé', !rx.test('ExpoToken[abc]') && !rx.test('PushToken[abc]'));
  v('une tentative d\'injection est refusée', !rx.test('ExponentPushToken[a"],{"to":"b'));
  v('un jeton non fermé est refusé', !rx.test('ExponentPushToken[abc'));
  v('le vide est refusé', !rx.test('') && !rx.test('ExponentPushToken[]'));
}

console.log('\n── 2. Le plafond horaire : on se tait plutôt que de vider une batterie ──');
const srcPlafond = fn(SRV, '_pushSousPlafond'), srcMax = cst(SRV, 'PUSH_MAX_HEURE');
v('_pushSousPlafond est extractible', !!srcPlafond && !!srcMax);
if (srcPlafond && srcMax) {
  const PUSH_MAX_HEURE = eval(srcMax);
  const _pushHoraire = new Map();
  const _pushSousPlafond = eval('(' + srcPlafond + ')');
  v('le plafond est un nombre raisonnable', PUSH_MAX_HEURE >= 1 && PUSH_MAX_HEURE <= 20, String(PUSH_MAX_HEURE));
  v('une première alerte passe', _pushSousPlafond('u1', 1) === 1);
  /* On demande PLUS que le plafond d'un coup : la fonction doit rendre la place RESTANTE, pas
     tout accepter ni tout refuser. C'est le jour de FOMC + NFP + CPI. */
  const reste = _pushSousPlafond('u2', PUSH_MAX_HEURE + 5);
  v('une rafale est écrêtée au plafond, pas rejetée', reste === PUSH_MAX_HEURE, String(reste));
  v('… et le compte est ensuite saturé', _pushSousPlafond('u2', 1) === 0);
  v('un AUTRE compte n\'est pas affecté', _pushSousPlafond('u3', 1) === 1);
  /* La fenêtre est GLISSANTE et purgée à la lecture : sans ça le compte reste saturé à vie. */
  _pushHoraire.set('u4', Array.from({ length: PUSH_MAX_HEURE }, () => Date.now() - 3700000));
  v('des envois vieux d\'une heure ne comptent plus', _pushSousPlafond('u4', 1) === 1);
  /* ⚠️ JAMAIS DE NÉGATIF. L'appelant teste `if (!place) continue` : un nombre négatif est TRUTHY,
     donc un compte au-delà du plafond franchirait le plafond. C'est ce que garde la sortie
     anticipée, qui a l'air redondante avec le `Math.min` et ne l'est pas. */
  _pushHoraire.set('u5', Array.from({ length: PUSH_MAX_HEURE + 3 }, () => Date.now()));
  const negatif = _pushSousPlafond('u5', 1);
  v('un compte au-delà du plafond rend 0, jamais un négatif', negatif === 0, String(negatif));
  v('… et la mémoire ne garde pas les périmés', (_pushHoraire.get('u4') || []).length === 1, JSON.stringify(_pushHoraire.get('u4')));
}

console.log('\n── 3. Le texte et la catégorie ──');
const srcTexte = fn(SRV, '_pushTexte'), srcClef = cst(SRV, '_pushClef');
v('_pushTexte est extractible', !!srcTexte);
if (srcTexte) {
  const _pushTexte = eval('(' + srcTexte + ')');
  const court = _pushTexte({ headline: 'US CPI 3.2% vs 3.1% expected' });
  v('le titre nomme le produit', court.title === 'DataTradingPro', court.title);
  v('le corps porte la dépêche', court.body === 'US CPI 3.2% vs 3.1% expected', court.body);
  /* iOS tronque une notification longue SANS prévenir : mieux vaut couper nous-mêmes et le dire
     par une ellipse que laisser le système couper au milieu d'un chiffre. */
  const long = _pushTexte({ headline: 'x'.repeat(400) });
  v('une dépêche trop longue est coupée', long.body.length <= 178, String(long.body.length));
  v('… et la coupe se voit', /…$/.test(long.body));
  v('les retours à la ligne sont aplatis', _pushTexte({ headline: 'a\n\n  b' }).body === 'a b');
  v('un item sans titre ne produit pas de corps fantôme', _pushTexte({}).body === '');
}
if (srcClef) {
  const _pushClef = eval('(' + srcClef + ')');
  /* ⚠️ ON NE RECOPIE PAS `_npKind` CÔTÉ SERVEUR : une copie de la taxonomie client aurait divergé.
     Le push ne peut porter QUE deux des cinq clés, et le contrôle l'épingle. */
  const clefs = new Set([{ headline: 'US CPI 3.2%' }, { headline: 'Trump parle de l\'Iran' }, {}].map(_pushClef));
  v('le push ne projette que sur « eco » et « news »', [...clefs].every(k => k === 'eco' || k === 'news'), [...clefs].join(','));
  v('une dépêche chiffrée est « eco »', _pushClef({ headline: 'US CPI 3.2%' }) === 'eco');
  v('une dépêche sans chiffre est « news »', _pushClef({ headline: 'Trump parle de l\'Iran' }) === 'news');
}

console.log('\n── 4. L\'envoi : ce qui part, et ce qui ne part jamais deux fois ──');
const srcEnvoi = fn(SRV, '_pushEnvoyer') || '';
v('_pushEnvoyer est extractible', !!srcEnvoi);
v('seul le tier-1 déclenche un push', /_highImpact === true/.test(srcEnvoi), srcEnvoi.slice(0, 200));
/* Le cycle de news REDIFFUSE un item quand il est enrichi (analyse, impact, traduction) : sans
   verrou, la même publication réveillerait le téléphone trois fois dans l'heure. */
v('un item n\'est poussé qu\'une fois', /_pushDejaVus\.has\(it\.id\)/.test(srcEnvoi) && /_pushDejaVus\.add\(it\.id\)/.test(srcEnvoi));
v('… et l\'ensemble des vus est borné', /_pushDejaVus\.size > \d+/.test(srcEnvoi));
v('le réglage du compte est respecté', /cfg\.enabled === false \|\| cfg\.push === false/.test(srcEnvoi));
v('… y compris les catégories coupées au panneau Filtre', /coupees\.has\(_pushClef\(it\)\)/.test(srcEnvoi));
v('un jeton mort est retiré du compte', /DeviceNotRegistered/.test(SRV) && /morts/.test(srcEnvoi));
/* ⚠️ ANTI-EGRESS, la leçon de l'audit de parrainage : balayer l'annuaire à chaque cycle de news
   est exactement ce qui coupe le service sur cet hébergement. */
v('l\'annuaire n\'est JAMAIS énuméré à l\'envoi', !/getAllUsers/.test(srcEnvoi), srcEnvoi);
v('… c\'est un index dédié qui est lu', /_pushIndex\(\)/.test(srcEnvoi) && /pushusers/.test(SRV));
v('un verrou de réentrance protège le cycle', /_pushBusy/.test(srcEnvoi));
v('l\'appel à Expo porte un délai de garde', /AbortController/.test(fn(SRV, '_pushExpo') || ''));
v('l\'envoi est branché sur le cycle de news', /_pushEnvoyer\(added\)\.catch/.test(SRV));
v('… hors du chemin de diffusion (il ne retarde pas le fil)', /broadcast\(\{ type: 'news_update', items: added[\s\S]{0,400}?_pushEnvoyer\(added\)\.catch/.test(SRV));
v('les deux routes d\'abonnement existent', /app\.post\('\/api\/push\/token'/.test(SRV) && /app\.post\('\/api\/push\/stop'/.test(SRV));
v('… et exigent une session', (SRV.match(/app\.post\('\/api\/push\/(?:token|stop)'[\s\S]{0,160}?req\.session\?\.userId/g) || []).length === 2);

console.log('\n── 5. Le desk et la coquille se parlent vraiment ──');
v('le desk détecte la coquille', /window\.ReactNativeWebView/.test(APP));
/* DANS L'APP, `Notification` N'EXISTE PAS : l'API Web Notifications n'est pas implémentée par les
   WebView. Sans branche dédiée, l'interrupteur « Push » ne faisait RIEN, sans le dire. */
v('l\'interrupteur Push passe par la coquille dans l\'app', /if \(_npCoquille\(\)\) \{ _npPushCoquilleDemander\(\); return; \}/.test(APP));
v('… et par l\'API Web au navigateur', /Notification\.requestPermission\(\)/.test(APP));
v('couper l\'interrupteur retire l\'appareil', /_npPushCoquilleStop/.test(APP) && /'\/api\/push\/stop'/.test(APP));
v('le jeton reçu est envoyé au serveur', /'\/api\/push\/token'/.test(APP));
v('… une seule fois tant qu\'il ne change pas', /t === _npJetonPose/.test(APP));
/* Un refus système est DÉFINITIF : on ne demande au démarrage que si le compte a déjà accepté. */
v('aucune fenêtre système au démarrage à froid', /if \(_npEnabled && _npPush && _npCoquille\(\)\) _npPushCoquilleDemander\(\)/.test(APP));
v('la coquille répond bien à l\'ordre « dtp:push »', /m\.type === 'dtp:push'/.test(NAT));
v('… et rend le jeton par l\'événement que le desk écoute',
  /dtp:pushtoken/.test(NAT) && /addEventListener\('dtp:pushtoken'/.test(APP));
/* ⚠️ LE CANAL ANDROID. Déclaré par la coquille, nommé par le serveur : un désaccord ne lève aucune
   erreur, la notification atterrit simplement dans le canal par défaut et perd son importance. */
const canalNat = (/setNotificationChannelAsync\('([^']+)'/.exec(NAT) || [])[1];
const canalSrv = (/channelId: '([^']+)'/.exec(SRV) || [])[1];
v('le canal Android du serveur est celui que la coquille crée', !!canalNat && canalNat === canalSrv,
  'coquille=' + canalNat + ' / serveur=' + canalSrv);
v('… et il est créé en importance HIGH', /AndroidImportance\.HIGH/.test(NAT));
v('le serveur envoie en priorité haute', /priority: 'high'/.test(SRV));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert'));
process.exit(ko ? 1 : 0);

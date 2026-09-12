#!/usr/bin/env node
/**
 * scripts/connexion-verif.js — LE BANDEAU « ERREUR DE CONNEXION » NE CRIE PLUS AU LOUP.
 * ------------------------------------------------------------------------------------------------
 * 11/09, capture user (mobile, 5G) : le bandeau rouge « Erreur de connexion » visible en bas de
 * l'écran. `connectWS()` l'affichait depuis `onerror`, pour N'IMPORTE QUELLE coupure — y compris
 * un simple blip WiFi/5G qui se répare tout seul en une fraction de seconde grâce au reconnect
 * immédiat déjà posé sur `visibilitychange` (retour au premier plan). Une coupure mobile ordinaire
 * n'est pas une panne ; c'est le lot commun du réseau cellulaire.
 * ⚠️ ET `onerror` NE COUVRAIT MÊME PAS TOUTES LES COUPURES : un redémarrage propre du serveur (donc
 * CHAQUE déploiement) ferme la socket via `onclose` sans forcément lever `onerror`, réservé aux
 * échecs réseau. Le bandeau restait donc muet sur la cause la plus fréquente (un déploiement) et
 * s'affolait sur la moins grave (un blip mobile) : l'inverse de ce qu'on veut montrer.
 * Le déclenchement est déplacé sur `onclose` (qui couvre les deux causes), après un délai court :
 * si la reconnexion aboutit avant l'échéance, personne ne voit jamais le message.
 *
 * ⚠️ ON EXÉCUTE LE VRAI `connectWS`, EXTRAIT de app.js, avec un faux WebSocket et une fausse
 * horloge qu'on avance à la main. Un banc qui relirait « onclose appelle showStatus » serait vert
 * même si le délai a disparu et que le bandeau s'affiche de nouveau instantanément.
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');

function extraireConnectWS(src) {
  const d = src.indexOf('function connectWS() {');
  if (d < 0) return null;
  // Compte les accolades pour trouver la vraie fin de la fonction (elle en contient plusieurs imbriquées).
  let i = src.indexOf('{', d), profondeur = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') profondeur++;
    else if (src[i] === '}') { profondeur--; if (profondeur === 0) return src.slice(d, i + 1); }
  }
  return null;
}
const SRC = extraireConnectWS(APP);
v('connectWS est extractible de app.js', !!SRC);

/* Fausse horloge PILOTÉE : setTimeout/clearTimeout n'attendent rien, on avance le temps à la main
   et on déclenche les échéances passées, dans l'ordre. */
function fabriqueScene(source) {
  const minuteries = [];
  let horloge = 0;
  const fauxSetTimeout = (fn, ms) => { const h = { fn, at: horloge + ms, vivant: true }; minuteries.push(h); return h; };
  const fauxClearTimeout = h => { if (h) h.vivant = false; };
  const avancer = ms => {
    horloge += ms;
    minuteries.filter(h => h.vivant && h.at <= horloge).sort((a, b) => a.at - b.at).forEach(h => { h.vivant = false; h.fn(); });
  };

  const appels = { showStatus: [] };
  const fauxShowStatus = (msg, type) => appels.showStatus.push({ msg, type });

  let derniereSocket = null;
  function FauxWebSocket() {
    derniereSocket = this;
    this.onopen = null; this.onerror = null; this.onclose = null; this.onmessage = null;
  }
  const fauxLocation = { protocol: 'https:', host: 'datatradingpro.com' };
  const fauxDoc = { hidden: false, addEventListener() {} };   // visibilitychange n'est pas le sujet ici

  const fabrique = new Function(
    'WebSocket', 'showStatus', 'setTimeout', 'clearTimeout', 'location', '_dtpAppareil', 'handleMessage', 'document', 'liveDot', 'reconnectTimer', '_wsAvisTimer',
    source + '\nreturn connectWS;'
  );
  const connectWS = fabrique(FauxWebSocket, fauxShowStatus, fauxSetTimeout, fauxClearTimeout, fauxLocation, () => 'test-appareil', () => {}, fauxDoc, null, null, null);
  return { connectWS, avancer, appels, socket: () => derniereSocket };
}

console.log('\n── Un blip qui se répare avant l\'échéance ne montre jamais le bandeau ──');
if (SRC) {
  const s1 = fabriqueScene(SRC);
  s1.connectWS();
  v('[exécuté] la socket est créée', !!s1.socket());
  s1.socket().onclose();               // coupure
  s1.avancer(500);                     // 0,5 s plus tard : toujours dans le délai de grâce
  v('[exécuté] rien ne s\'affiche encore à 0,5 s', s1.appels.showStatus.length === 0);
  s1.socket().onopen();                // reconnexion réussie AVANT l'échéance (le cas courant : blip, ou retour au premier plan)
  s1.avancer(3000);                    // le temps passe largement au-delà de l'ancien délai
  v('[exécuté] le bandeau d\'erreur ne s\'affiche JAMAIS pour un blip qui se répare',
    !s1.appels.showStatus.some(a => a.type === 'err'),
    'appels reçus : ' + JSON.stringify(s1.appels.showStatus));

  console.log('\n── Une coupure qui TIENT affiche bien le bandeau ──');
  const s2 = fabriqueScene(SRC);
  s2.connectWS();
  s2.socket().onclose();
  s2.avancer(2000);                    // au-delà de l'échéance, sans reconnexion
  v('[exécuté] le bandeau d\'erreur s\'affiche quand la coupure tient', s2.appels.showStatus.some(a => a.type === 'err'),
    'appels reçus : ' + JSON.stringify(s2.appels.showStatus));

  console.log('\n── Une fermeture SANS `onerror` (redémarrage serveur propre) est bien vue ──');
  const s3 = fabriqueScene(SRC);
  s3.connectWS();
  s3.socket().onclose();               // AUCUN onerror déclenché : simule un redémarrage serveur propre
  s3.avancer(2000);
  v('[exécuté] une fermeture propre (sans onerror) déclenche quand même le bandeau si elle tient',
    s3.appels.showStatus.some(a => a.type === 'err'),
    'un déploiement fermerait la socket sans avertir personne si seul onerror comptait');

  console.log('\n── Témoin : sans le délai (l\'ancien code), le blip afficherait le bandeau ──');
  /* Mutation : on retire le délai de grâce et on revient au déclenchement direct sur onclose,
     pour prouver que le scénario "blip qui se répare" ci-dessus mord vraiment. */
  const SRC_MUTE = SRC.replace(
    /if \(_wsAvisTimer\) clearTimeout\(_wsAvisTimer\);\s*\n\s*_wsAvisTimer = setTimeout\(\(\) => \{ _wsAvisTimer = null; showStatus\('Erreur de connexion', 'err'\); \}, 1500\);/,
    "showStatus('Erreur de connexion', 'err');"
  );
  v('la mutation a bien retiré le délai (sinon ce témoin ne prouve rien)', SRC_MUTE !== SRC);
  const s4 = fabriqueScene(SRC_MUTE);
  s4.connectWS();
  s4.socket().onclose();
  s4.socket().onopen();   // reconnexion immédiate, comme dans le premier scénario
  v('[exécuté] … et le bandeau d\'erreur s\'affiche À TORT dans l\'ancien code, même reconnecté aussitôt',
    s4.appels.showStatus.some(a => a.type === 'err'),
    'si ce témoin ne mord pas, le contrôle du blip plus haut ne prouve rien');
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

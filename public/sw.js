/* ════════════════════════════════════════════════════════════════════════════════════════════════
   SERVICE WORKER DTP — jalon 1 de l'application mobile (04/09)
   ------------------------------------------------------------------------------------------------
   Il n'y en avait AUCUN, et c'est lui qui commande trois choses d'un coup :

     1. L'INSTALLATION. Chrome sur Android ne propose « Ajouter à l'écran d'accueil » que si le site
        déclare un manifeste ET un service worker qui répond aux requêtes. Le manifeste existait
        depuis longtemps ; sans ce fichier, l'invitation ne s'est jamais affichée à un seul client.

     2. LES NOTIFICATIONS ANDROID. Chrome y REFUSE `new Notification(...)` et impose
        `ServiceWorkerRegistration.showNotification()`. Le desk vient d'être protégé pour que ce
        refus ne fige plus le fil ; ce fichier est ce qui rend la notification POSSIBLE au lieu de
        seulement inoffensive.

     3. LE RÉSEAU QUI TOMBE. Sur un téléphone c'est la règle, pas l'exception : métro, ascenseur,
        train. Sans lui, une coupure d'une seconde donne la page d'erreur du navigateur et le desk
        est perdu.

   ⚠️ TROIS RÈGLES QU'IL NE FAUT PAS ENFREINDRE, et chacune répare une façon connue de nuire.

     · AUCUNE RÉPONSE D'API N'EST MISE EN CACHE. Le desk est un terminal de marché : un prix, un
       calendrier ou un biais servis depuis un cache sont FAUX, et faux en silence — ce qui est pire
       que pas de donnée du tout, parce que rien ne le signale à l'écran. Le filet hors-ligne ne
       couvre que la COQUILLE (styles, scripts, icônes) ; les données, elles, viennent du réseau ou
       ne viennent pas.

     · LE HTML NE SORT DU CACHE QUE HORS LIGNE. Le desk est derrière une session : servir une page
       mémorisée à quelqu'un qui vient de se déconnecter, ou à un compte différent sur le même
       téléphone, montrerait la coquille d'une session qui n'est plus la sienne. On va donc TOUJOURS
       au réseau d'abord, et on ne se rabat sur le cache que lorsqu'il n'y a pas de réseau.

     · ON NE CACHE QUE CE QUI PORTE UN JETON DE VERSION. Les scripts et les styles du desk sont
       servis avec `?v=<jeton>` et un `max-age` de 30 jours : un même jeton désigne à jamais le même
       contenu, donc le cache ne peut pas devenir périmé. C'est le mécanisme de cache-busting du
       projet qui rend cette stratégie sûre — et c'est aussi pourquoi les anciennes versions sont
       balayées à l'activation : sans ça, chaque déploiement laisserait une copie morte sur le
       téléphone du client, indéfiniment.
   ════════════════════════════════════════════════════════════════════════════════════════════════ */

const VERSION = 'dtp-sw-20260902bbg1103';
const CACHE_COQUILLE = VERSION + '-coquille';

/* La coquille minimale : de quoi afficher QUELQUE CHOSE de DTP sans réseau. Volontairement courte —
   un service worker qui pré-charge tout le desk à la première visite consommerait le forfait mobile
   du client avant qu'il n'ait rien demandé. Le reste se met en cache au fil de la navigation. */
/* ⚠️ CES TROIS-LÀ N'ONT PAS DE JETON, et c'est assumé : ils sont pré-chargés à l'INSTALL, dans un
   cache nommé d'après VERSION, et l'activation balaie toutes les versions précédentes. Leur
   fraîcheur ne dépend donc pas d'un jeton d'URL mais du numéro de version du service worker —
   que `scripts/bump-cache.js` incrémente désormais en même temps que celui des pages. */
const PRECHARGE = ['/offline.html', '/favicon.png', '/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_COQUILLE)
      // `catch` par ressource : une seule 404 ferait échouer tout le install et le service worker
      // ne s'activerait JAMAIS — panne totale et silencieuse pour une icône manquante.
      .then((c) => Promise.all(PRECHARGE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n.indexOf('dtp-sw-') === 0 && n.indexOf(VERSION) !== 0)
        .map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/* Un actif versionné : styles, scripts, icônes. C'est le seul cas où mémoriser est sans risque.

   ⚠️ CORRECTIF 27/08 — LA RÈGLE ÉCRITE EN TÊTE DE CE FICHIER N'ÉTAIT PAS CELLE DU CODE, ET C'EST
   TOUT LE PROBLÈME. L'en-tête dit « ON NE CACHE QUE CE QUI PORTE UN JETON DE VERSION » ; le test,
   lui, ne regardait que l'EXTENSION du fichier. Deux mondes séparaient les deux :
     · les scripts et styles du desk portent bien `?v=<jeton>`, aligné par `scripts/bump-cache.js` —
       un nouveau jeton fait une nouvelle URL, donc un nouveau cache : aucun risque de péremption ;
     · mais les logos de banques (`/assets/images/banks/*.png|svg`, injectés par le JS), le favicon
       et les icônes d'application, eux, n'ont AUCUN jeton. Mis en cache par extension, ils y
       restaient POUR TOUJOURS : remplacer un logo sur le serveur n'atteignait plus jamais un
       client ayant ouvert le desk une fois, et aucun rechargement, même Ctrl+F5, n'y changeait
       quoi que ce soit — un service worker répond avant le réseau.
   La condition devient donc celle qui était annoncée : PAS DE JETON, PAS DE CACHE. Les actifs sans
   jeton repassent par le réseau, où `express.static` les sert déjà avec son propre `max-age` — le
   navigateur les garde, mais lui sait les revalider. */
function estActifVersionne(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.indexOf('/api/') === 0) return false;              // jamais de données
  if (!/\.(css|js|png|svg|woff2?|ico)$/i.test(url.pathname)) return false;
  return /(^|&)v=[^&]+/.test(url.search.replace(/^\?/, ''));         // le jeton, ou rien
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                                    // on ne touche à aucune écriture
  const url = new URL(req.url);

  // ── DONNÉES : jamais interceptées. Le navigateur fait son travail, le desk voit ses vraies erreurs.
  if (url.origin === self.location.origin && url.pathname.indexOf('/api/') === 0) return;

  // ── COQUILLE VERSIONNÉE : cache d'abord (le jeton garantit la fraîcheur), réseau sinon.
  if (estActifVersionne(url)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((rep) => {
        // On ne mémorise QUE des réponses complètes et valides : une 404 ou une réponse partielle
        // mise en cache se rejouerait à chaque ouverture, et le desk resterait cassé hors ligne
        // sans qu'aucun rechargement ne le répare.
        if (rep && rep.ok && rep.status === 200) {
          const copie = rep.clone();
          caches.open(CACHE_COQUILLE).then((c) => c.put(req, copie)).catch(() => {});
        }
        return rep;
      }))
    );
    return;
  }

  // ── PAGES : réseau d'abord, TOUJOURS. Le cache n'est qu'un filet de coupure (voir l'en-tête).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('/offline.html').then((p) => p || new Response(
        '<!doctype html><meta charset="utf-8"><title>Hors ligne</title>'
        + '<body style="margin:0;background:#0c0c0e;color:#e8eaed;font-family:system-ui;display:flex;'
        + 'align-items:center;justify-content:center;height:100vh">Connexion perdue.</body>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )))
    );
  }
});

/* NOTIFICATION CLIQUÉE : on ramène l'onglet DTP déjà ouvert au premier plan plutôt que d'en ouvrir
   un second. Sur mobile, deux instances du desk c'est deux flux temps réel et deux fois la batterie
   — et le client se retrouve avec un desk qui n'est pas celui qu'il lisait. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((liste) => {
      for (const c of liste) {
        if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow('/') : null;
    })
  );
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   PERF-BEACON — MESURE LA VRAIE LENTEUR DE NAVIGATION, CHEZ LES VRAIS UTILISATEURS (21/09)
   ──────────────────────────────────────────────────────────────────────────────────────────────
   POURQUOI CE FICHIER EXISTE. Un utilisateur a signalé une navigation lente entre les modules. Les
   mesures serveur étaient bonnes (~0,2 s, cache mémoire, aucun waterfall) : la lenteur ressentie
   vit CÔTÉ CLIENT — rendu de vues lourdes, appels dupliqués, tâches longues qui figent le thread.
   On ne peut pas l'optimiser sans la MESURER là où elle se produit : dans le navigateur du membre.

   CE QU'IL FAIT, ET CE QU'IL NE FAIT SURTOUT PAS :
     · Il OBSERVE, il n'interfère JAMAIS. Tout est passif, tout est en try/catch, il ne throw
       jamais et ne modifie aucun comportement du desk. Une instrumentation qui casse ce qu'elle
       mesure est pire qu'absente.
     · Il enveloppe `fetch` pour chronométrer chaque appel API, repérer les DOUBLONS (même chemin en
       moins de 2 s) et les lenteurs.
     · Il compte les TÂCHES LONGUES (>50 ms) via PerformanceObserver — ce qui fige la navigation.
     · Il attribue le coût d'une NAVIGATION au contrôle cliqué, mais seulement si ce clic a
       réellement déclenché du travail (fetches ou tâches longues) — sinon un simple clic anodin
       polluerait la mesure.
     · Il n'envoie qu'un RÉSUMÉ COMPACT et AGRÉGÉ au serveur, au plus une fois par minute et au
       masquage de l'onglet (sendBeacon). Aucune donnée personnelle, aucun contenu — que des noms de
       vues, des chemins d'API et des millisecondes.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__perfBeacon) return; window.__perfBeacon = true;
  var A = { views: {}, api: {}, longtasks: { n: 0, ms: 0 }, t0: Date.now() };
  var recentApi = {};   // chemin -> dernier appel (ms) pour la détection de doublon

  function bumpView(nom, ms) {
    if (!nom) nom = '(inconnu)';
    var v = A.views[nom] || (A.views[nom] = { n: 0, ms: 0, msMax: 0 });
    v.n++; v.ms += ms; if (ms > v.msMax) v.msMax = ms;
  }
  function bumpApi(path, ms, ok, dup) {
    var a = A.api[path] || (A.api[path] = { n: 0, ms: 0, msMax: 0, dup: 0, err: 0 });
    a.n++; a.ms += ms; if (ms > a.msMax) a.msMax = ms; if (dup) a.dup++; if (!ok) a.err++;
  }

  // ── fetch enveloppé : chronomètre + doublons. Ne change RIEN au résultat (même promesse). ──
  try {
    var _fetch = window.fetch;
    window.fetch = function (...args) {   // paramètre rest → pas d'objet implicite `arguments` (que js-verif ne reconnaît pas)
      var input = args[0];
      var url = ''; try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (e) {}
      var path = url; try { path = new URL(url, location.origin).pathname; } catch (e) {}
      var start = (performance && performance.now) ? performance.now() : Date.now();
      var dup = false;
      try { if (path.indexOf('/api/') === 0) { var last = recentApi[path]; if (last && (start - last) < 2000) dup = true; recentApi[path] = start; } } catch (e) {}
      var p = _fetch.apply(this, args);
      try {
        p.then(function (r) { try { bumpApi(path, ((performance.now ? performance.now() : Date.now()) - start), !!(r && r.ok), dup); } catch (e) {} },
               function () { try { bumpApi(path, ((performance.now ? performance.now() : Date.now()) - start), false, dup); } catch (e) {} });
      } catch (e) {}
      return p;
    };
  } catch (e) {}

  // ── tâches longues : ce qui fige réellement l'interface pendant une navigation. ──
  try {
    if (window.PerformanceObserver) {
      new PerformanceObserver(function (list) {
        try { list.getEntries().forEach(function (en) { A.longtasks.n++; A.longtasks.ms += Math.round(en.duration); }); } catch (e) {}
      }).observe({ entryTypes: ['longtask'] });
    }
  } catch (e) {}

  // ── navigation : on marque un clic, puis on mesure le temps jusqu'à ce que le thread se calme.
  //    On n'attribue le coût QUE si le clic a réellement provoqué du travail (fetch ou tâche longue).
  var pending = null;
  function libelle(el) {
    try {
      var n = el.closest('[data-view],[data-tab],.nav-item,.rail-item,button,a') || el;
      var t = (n.getAttribute && (n.getAttribute('data-view') || n.getAttribute('data-tab'))) || (n.textContent || '').trim();
      return (t || '').replace(/\s+/g, ' ').slice(0, 40);
    } catch (e) { return ''; }
  }
  document.addEventListener('click', function (e) {
    try {
      var nom = libelle(e.target); if (!nom) return;
      var start = performance.now ? performance.now() : Date.now();
      var apiAvant = 0; try { for (var k in A.api) apiAvant += A.api[k].n; } catch (er) {}
      var ltAvant = A.longtasks.n;
      if (pending) return;   // une navigation à la fois
      pending = true;
      // On attend que ça se calme : 250 ms sans nouvelle tâche longue, plafonné à 4 s.
      var dernierLt = ltAvant, stable = 0, t = setInterval(function () {
        try {
          var now = performance.now ? performance.now() : Date.now();
          if (A.longtasks.n !== dernierLt) { dernierLt = A.longtasks.n; stable = now; }
          if (!stable) stable = now;
          var apiApres = 0; for (var k in A.api) apiApres += A.api[k].n;
          var travail = (apiApres > apiAvant) || (A.longtasks.n > ltAvant);
          if ((now - stable) > 250 || (now - start) > 4000) {
            clearInterval(t); pending = null;
            if (travail) bumpView(nom, Math.round(now - start));   // vraie navigation/chargement
          }
        } catch (er) { clearInterval(t); pending = null; }
      }, 80);
    } catch (er) { pending = null; }
  }, true);

  // ── envoi : résumé compact, au plus 1×/min et au masquage de l'onglet. sendBeacon = non bloquant.
  function payload() {
    return JSON.stringify({ v: 1, ts: Date.now(), dureeMs: Date.now() - A.t0,
      views: A.views, api: A.api, longtasks: A.longtasks,
      ua: (navigator.userAgent || '').slice(0, 120), ecran: (screen && screen.width) ? (screen.width + 'x' + screen.height) : '' });
  }
  function envoyer() {
    try {
      var vide = !Object.keys(A.views).length && !Object.keys(A.api).length;
      if (vide) return;
      var body = payload();
      if (navigator.sendBeacon) navigator.sendBeacon('/api/perf/beacon', new Blob([body], { type: 'application/json' }));
      else _fetch('/api/perf/beacon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      A = { views: {}, api: {}, longtasks: { n: 0, ms: 0 }, t0: Date.now() };   // on repart à zéro après envoi
    } catch (e) {}
  }
  try { setInterval(envoyer, 60000); } catch (e) {}
  try { document.addEventListener('visibilitychange', function () { if (document.hidden) envoyer(); }); } catch (e) {}
})();

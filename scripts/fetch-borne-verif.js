#!/usr/bin/env node
/**
 * scripts/fetch-borne-verif.js — AUCUN LOADER NE TOURNE SANS PORTE DE SORTIE (11/09, suite).
 * ------------------------------------------------------------------------------------------------
 * Le même défaut, trouvé DEUX FOIS le même soir à deux endroits différents : une zone posée en
 * `dtpLoader(...)` (croissant orange), puis un `fetch()` SANS AbortController. Un serveur qui ne
 * répond jamais — exactement ce que produit une chaîne IA qui enchaîne les tentatives vers des
 * fournisseurs morts, ou une source de scraping lente — laisse la promesse pendante pour toujours :
 * ni `.then`, ni `.catch`, et le rond tourne à l'infini. Aucune erreur en console, rien à voir dans
 * le réseau : un défaut parfaitement muet, et c'est le second qu'on trouve le même soir (le premier
 * était Force des Devises, réparé et éprouvé dans resilience-ia-verif.js).
 *
 * La question de l'utilisateur, verbatim : « On peut corriger pour tout si oui comment ? ». Réponse
 * appliquée : UN helper partagé (`dtpFetchBorne`, à côté de `dtpLoader` dans app.js — le même point
 * d'entrée universel, déjà chargé par toutes les pages) qui donne à CHAQUE fetch le droit d'échouer
 * au bout d'un temps fini ; le helper `_dtpJSON` (charts.js, 9 appelants partagés) reçoit la même
 * borne PAR TENTATIVE. Ce banc vérifie le MÉCANISME (le vrai code, exécuté avec un fetch factice
 * qu'on contrôle) et fait le RECENSEMENT de tous les points d'entrée `dtpLoader(...)` du desk pour
 * qu'un futur ajout sans borne fasse rougir la suite au lieu de rester invisible jusqu'à la
 * prochaine capture d'écran.
 *
 * ⚠️ ON EXÉCUTE LE VRAI CODE, EXTRAIT DES FICHIERS — jamais une copie. Un banc qui relirait « il y a
 * bien un AbortController quelque part » serait vert sur un fichier où il n'est jamais câblé au
 * fetch réel.
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
const lire = f => fs.readFileSync(path.join(RACINE, f), 'utf8');

const APP = lire('public/js/app.js');
const CHARTS = lire('public/js/charts.js');

console.log('\n── 1. dtpFetchBorne (app.js) : extrait et exécuté avec un fetch factice ──');

/* Extraction du VRAI corps de la fonction, entre sa déclaration et l'ancre qui la suit toujours
   (posée par nous-mêmes juste après, cf. app.js) — pas une copie collée ici. */
function construireBorne(fauxFetch) {
  const d = APP.indexOf('function dtpFetchBorne(');
  const ancre = '\nwindow.dtpFetchBorne = dtpFetchBorne;';
  const f = APP.indexOf(ancre, d);
  if (d < 0 || f < 0) return null;
  const src = APP.slice(d, f);
  const minuteries = [];
  const FauxAbortController = function () {
    this.signal = { aborted: false };
    this.abort = () => { this.signal.aborted = true; };
  };
  const fauxSetTimeout = (fn, ms) => { const h = { fn, ms, vivante: true }; minuteries.push(h); return h; };
  const fauxClearTimeout = h => { if (h) h.vivante = false; };
  const fabrique = new Function('AbortController', 'setTimeout', 'clearTimeout', 'fetch', src + '\nreturn dtpFetchBorne;');
  const fn = fabrique(FauxAbortController, fauxSetTimeout, fauxClearTimeout, fauxFetch);
  return { fn, minuteries, declencher: () => minuteries.filter(h => h.vivante).forEach(h => h.fn()) };
}

v('dtpFetchBorne est extractible de app.js', !!construireBorne(() => Promise.resolve({})),
  'sans extraction, rien de ce qui suit ne teste le vrai code');

(async () => {
  // ── Cas 1 : succès rapide — le signal doit être transmis, la réponse doit traverser intacte ──
  let signalRecu = null;
  const b1 = construireBorne((url, opts) => { signalRecu = opts && opts.signal; return Promise.resolve({ ok: true, marque: 'reponse-normale' }); });
  if (b1) {
    const res = await b1.fn('/x', {}, 5000);
    v('[exécuté] un délai est programmé avec la valeur demandée (5000 ms)', b1.minuteries.length === 1 && b1.minuteries[0].ms === 5000);
    v('[exécuté] un signal AbortController accompagne le fetch', !!signalRecu && signalRecu.aborted === false,
      'sans signal, rien ne peut jamais abandonner la requête');
    v('[exécuté] la réponse normale traverse sans être altérée', res && res.marque === 'reponse-normale');
  }

  // ── Cas 2 : le serveur ne répond JAMAIS — à l'échéance, le signal doit s'abandonner ──
  let signal2 = null;
  const b2 = construireBorne((url, opts) => { signal2 = opts.signal; return new Promise(() => {}); });   // ne se résout JAMAIS
  if (b2) {
    b2.fn('/y', {});   // délai NON précisé
    v('[exécuté] délai par défaut = 12000 ms quand non précisé', b2.minuteries.length === 1 && b2.minuteries[0].ms === 12000);
    v('[exécuté] avant l\'échéance, le signal n\'est pas encore abandonné', signal2 && signal2.aborted === false);
    b2.declencher();
    v('[exécuté] À L\'ÉCHÉANCE, LE SIGNAL EST ABANDONNÉ', signal2 && signal2.aborted === true,
      'sans cet abandon, un fetch qui ne répond jamais ne rejette jamais — c\'est le défaut du 11/09, deux fois le même soir');
  }

  // ── Cas 3 : une réponse arrive AVANT l'échéance → la minuterie doit être désarmée (pas de fuite) ──
  const b3 = construireBorne(() => Promise.resolve({ ok: true }));
  if (b3) {
    await b3.fn('/z', {}, 9000);
    v('[exécuté] la minuterie est désarmée une fois la réponse arrivée', b3.minuteries[0].vivante === false,
      'une minuterie qui survit à la réponse est une fuite — anodine isolément, réelle à l\'échelle du desk');
  }

  console.log('\n── 2. _dtpJSON (charts.js, 9 appelants partagés) : la borne par tentative existe ──');
  /* Comportement de bout en bout (2 tentatives réelles, ~délai×2, rejet propre) déjà éprouvé en
     Chromium réel contre un serveur qui ne répond jamais (scratchpad/repro-caldet.js, 11/09) :
     ici on vérifie que le CÂBLAGE qui produit ce comportement est bien celui du fichier. */
  const dJ = CHARTS.indexOf('async function _dtpJSON(');
  v('_dtpJSON existe dans charts.js', dJ >= 0);
  const corpsDJ = dJ >= 0 ? CHARTS.slice(dJ, CHARTS.indexOf('\nif (typeof window', dJ)) : '';
  v('… crée un AbortController PAR TENTATIVE (dans la boucle, pas avant)',
    /for \(let i = 0; i < tries; i\+\+\) \{\s*\n\s*const ctrl = new AbortController\(\);/.test(corpsDJ),
    'un seul contrôleur partagé entre tentatives abandonnerait aussi les essais suivants après le premier délai');
  v('… le transmet au fetch via `signal`', /signal:\s*ctrl\.signal/.test(corpsDJ));
  v('… et désarme la minuterie dans un `finally` (pas seulement au succès)', /finally\s*\{\s*clearTimeout\(t\)/.test(corpsDJ),
    'sans finally, une réponse HTTP en erreur (catchée puis re-tentée) laisserait la minuterie courir');
  v('… avec une borne par défaut de 12000 ms, réglable par appelant', /delaiMs = opts\.delaiMs \|\| 12000/.test(corpsDJ));

  console.log('\n── 3. Recensement : tout point d\'entrée dtpLoader(...) a un fetch borné à proximité ──');
  /* Automatise le balayage fait à la main le 11/09 : pour chaque VRAI appel dtpLoader(...) (hors
     commentaires — un commentaire qui cite le motif ne doit pas se compter lui-même, piège déjà
     rencontré ce soir avec propos-verif), on cherche le fetch le plus proche dans les 80 lignes
     suivantes et on exige qu'il soit borné (dtpFetchBorne / _dtpJSON / _forceFetch / signal: direct). */
  function recenser(nomFichier, texte) {
    const lignes = texte.split('\n');
    const sites = [];
    lignes.forEach((l, i) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;   // commentaire : ne se compte pas lui-même
      if (/\bdtpLoader\(/.test(l) && !/^function dtpLoader\b/.test(t) && !/window\.dtpLoader = dtpLoader/.test(t)) sites.push(i);
    });
    let nonBornes = 0;
    for (const ln of sites) {
      let fetchLn = -1;
      for (let j = ln; j < Math.min(lignes.length, ln + 80); j++) {
        if (/\bfetch\(/.test(lignes[j]) || /_forceFetch\(|dtpFetchBorne\(|_dtpJSON\(/.test(lignes[j])) { fetchLn = j; break; }
      }
      if (fetchLn === -1) continue;   // pas de fetch associé (rendu synchrone, chart déjà en cache…) : hors périmètre de ce recensement
      const fenetre = lignes.slice(fetchLn, fetchLn + 3).join(' ');
      const borne = /signal\s*:|_forceFetch\(|dtpFetchBorne\(|_dtpJSON\(/.test(fenetre);
      if (!borne) { nonBornes++; console.log(`      ⚠ ${nomFichier}:${ln + 1} → fetch ${nomFichier}:${fetchLn + 1} sans borne : ${lignes[fetchLn].trim().slice(0, 90)}`); }
    }
    return { total: sites.length, nonBornes };
  }
  const rApp = recenser('app.js', APP);
  const rCharts = recenser('charts.js', CHARTS);
  v(`app.js : ${rApp.total} points dtpLoader(...) recensés, 0 fetch sans borne`, rApp.nonBornes === 0,
    rApp.nonBornes + ' site(s) encore muet(s) — cf. détail ci-dessus');
  v(`charts.js : ${rCharts.total} points dtpLoader(...) recensés, 0 fetch sans borne`, rCharts.nonBornes === 0,
    rCharts.nonBornes + ' site(s) encore muet(s) — cf. détail ci-dessus');

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();

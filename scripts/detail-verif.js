#!/usr/bin/env node
/**
 * scripts/detail-verif.js — LA FICHE D'UN ÉVÉNEMENT DU CALENDRIER ARRIVE, OU DIT QU'ELLE N'ARRIVERA PAS
 * ------------------------------------------------------------------------------------------------
 * 23/09, capture client : « BOC Gov Macklem Speaks » déroulé, et pour tout contenu « Les détails
 * arrivent : la source est lente à répondre. Nouvel essai dans 5 secondes… ». Demande : « faut que ce
 * soit un problème corrigé, pour le futur aussi ».
 *
 * Trois défauts, éprouvés ici sur le VRAI code extrait (jamais une copie) :
 *   1. aucune mémoire durable : chaque redémarrage renvoyait le premier clic ouvrir un navigateur ;
 *   2. deux demandes rapprochées ouvraient DEUX navigateurs pour la même page ;
 *   3. le déroulé cachait le décryptage DTP, déjà prêt, derrière l'attente de la fiche.
 *
 *   node scripts/detail-verif.js
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const CH = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const URL_FF = 'https://www.forexfactory.com/calendar/52-ca-boc-gov-macklem-speaks';
const FICHE = { specs: [{ label: 'Usual Effect', value: 'More hawkish than expected is good for currency' }], history: [] };

(async () => {
  console.log('\n── 1. Le serveur : mémoire durable, une seule récupération en vol, échec nommé ──');
  const d = SRV.indexOf('const _DETAIL_MAX = 6000;');
  const f = SRV.indexOf('// Diagnostic des Actuals du calendrier', d);
  const bloc = (d >= 0 && f > d) ? SRV.slice(d, f) : null;
  v('le bloc de la fiche est extractible de server.js', !!bloc);
  if (bloc) {
    const monter = (fetchImpl, base) => {
      let handler = null;
      const app = { get: (route, fn) => { if (route === '/api/calendar-detail') handler = fn; } };
      const auth = {
        aiCacheGet: async (k) => (base.has(k) ? base.get(k) : null),
        aiCacheSet: async (k, val) => { base.set(k, val); },
      };
      const api = new Function('app', 'auth', 'fetchEventDetail', 'require', bloc + '\nreturn { _detailRecuperer, _detailCle };')(app, auth, fetchImpl, require);
      const appel = (url) => new Promise((resolve) => {
        const res = { _h: {}, set(k, x) { this._h[k] = x; return this; }, json(o) { resolve(o); return this; } };
        handler({ query: { url } }, res);
      });
      return { api, appel };
    };

    // a. deux demandes rapprochées → UNE récupération
    let n = 0;
    const base = new Map();
    const lent = async () => { n++; await new Promise(r => setTimeout(r, 120)); return { ...FICHE }; };
    const { api, appel } = monter(lent, base);
    const [r1, r2] = await Promise.all([appel(URL_FF), appel(URL_FF)]);
    v('deux demandes simultanées n\'ouvrent qu\'UNE récupération', n === 1, n + ' récupération(s)');
    v('… et reçoivent toutes deux la fiche', !!(r1.specs.length && r2.specs.length), JSON.stringify([r1, r2]).slice(0, 160));

    // b. la fiche est rangée en base, et la suivante est servie SANS récupération
    const cle = api._detailCle(URL_FF);
    v('la fiche réussie est rangée en base (clé caldet:)', base.has(cle) && /^caldet:/.test(cle), [...base.keys()].join(','));
    const avant = n;
    const r3 = await appel(URL_FF);
    v('… et la demande suivante est servie depuis la base, sans rouvrir de navigateur', n === avant && r3.specs.length === 1, n + ' récupération(s)');

    // c. une fiche de plus de six heures est servie TOUT DE SUITE, et rafraîchie en fond
    base.set(cle, { ...FICHE, at: Date.now() - 7 * 3600e3 });
    const t0 = Date.now();
    const r4 = await appel(URL_FF);
    v('une fiche vieillie est servie immédiatement (pas d\'attente)', r4.specs.length === 1 && Date.now() - t0 < 80, (Date.now() - t0) + ' ms');
    await new Promise(r => setTimeout(r, 200));
    v('… et rafraîchie en fond', n === avant + 1 && (base.get(cle).at || 0) > Date.now() - 5000, n + ' récupération(s)');

    // d. une source injoignable : l'échec a un NOM
    const vide = monter(async () => null, new Map());
    const r5 = await vide.appel(URL_FF);
    v('une source injoignable rend « indisponible », pas une fiche vide muette', r5.indisponible === true && !r5.pending, JSON.stringify(r5));

    // e. une adresse hors forexfactory.com n'est jamais suivie
    let nHors = 0;
    const hors = monter(async () => { nHors++; return FICHE; }, new Map());
    await hors.appel('https://evil.example.com/calendar/x');
    v('une adresse hors forexfactory.com n\'est jamais ouverte', nHors === 0);

    // TÉMOIN : sans la mise en commun, deux demandes ouvrent bien deux récupérations
    const mut = bloc.replace('if (_detailEnVol.has(url)) return _detailEnVol.get(url);', '');
    v('(témoin) la mutation retire bien la mise en commun', mut !== bloc);
    if (mut !== bloc) {
      let m = 0;
      let handler = null;
      const app = { get: (r, fn) => { handler = fn; } };
      const auth = { aiCacheGet: async () => null, aiCacheSet: async () => {} };
      new Function('app', 'auth', 'fetchEventDetail', 'require', mut + '\nreturn 0;')(app, auth, async () => { m++; await new Promise(r => setTimeout(r, 80)); return { ...FICHE }; }, require);
      const appel = (url) => new Promise((resolve) => { handler({ query: { url } }, { set() { return this; }, json: resolve }); });
      await Promise.all([appel(URL_FF), appel(URL_FF)]);
      v('(témoin) sans elle, deux demandes ouvrent deux récupérations', m === 2, m + ' — si 1, le témoin ne mord plus');
    }
  }

  console.log('\n── 2. Le desk : le décryptage s\'affiche tout de suite, l\'attente a une fin ──');
  const i = CH.indexOf('async function toggleCalDetailRow');
  const corps = i >= 0 ? CH.slice(i, CH.indexOf('\n}\n', i)) : CH;
  v('plus aucun « Nouvel essai dans 5 secondes » figé', !/Nouvel essai dans 5 secondes/.test(CH));
  const posKb = corps.indexOf("bodyEl.innerHTML = kbHtml + _ffLigne");
  const posDemande = corps.indexOf('d = await demander();');
  v('le décryptage DTP est posé AVANT la demande de fiche (il ne l\'attend plus)', posKb > 0 && posDemande > posKb,
    'positions ' + posKb + ' / ' + posDemande);
  v('les relances sont BORNÉES (liste de pauses finie)', /const PAUSES = \[\d+, \d+\];/.test(corps) && /i < PAUSES\.length/.test(corps));
  v('la demande reste bornée dans le temps (dtpFetchBorne)', /dtpFetchBorne\('\/api\/calendar-detail/.test(corps));

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();

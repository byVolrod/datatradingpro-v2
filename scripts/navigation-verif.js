#!/usr/bin/env node
/**
 * scripts/navigation-verif.js — LES ONGLETS SONT PRÊTS AVANT LE CLIC (24/09)
 * ------------------------------------------------------------------------------------------------
 * Demande user : « rends la navigation agréable et fluide pour les utilisateurs du desk, concernant
 * les chargements ». MESURÉ : le retour sur un onglet déjà vu était immédiat, mais la PREMIÈRE
 * ouverture de chaque onglet attendait le réseau (squelette, puis contenu) — à chaque session.
 * Le desk précharge désormais les données des onglets pendant les temps morts, et au survol.
 *
 * On ouvre le VRAI desk dans Chromium, derrière un serveur qui ajoute 600 ms à chaque appel d'API
 * (un VPS à distance), et on chronomètre l'ouverture des onglets. Deux témoins qui mordent :
 *   · connexion en mode économie (préchargement coupé) → la même ouverture ATTEND le réseau ;
 *   · même mode, mais survol de l'onglet avant le clic → l'ouverture redevient immédiate.
 * Et le graphique de l'onglet Banques ne re-télécharge plus ses bougies à chaque ouverture.
 * Sans Chromium, le banc s'abstient (code 0).
 *
 *   node scripts/navigation-verif.js
 */
'use strict';
const path = require('path');
const http = require('http');
const { serveur, trouverNavigateur } = require('./mobile-apercu.js');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const LAT = 600, PORT = 4871;

// Pricing minimal mais complet pour une carte Taux (le serveur commun ne sert pas /api/rates).
const RATES = { asOf: Date.now(), banks: [
  { code: 'USD', cc: 'us', bank: 'Fed', full: 'Réserve fédérale', rate: 3.875, band: { lo: 3.75, hi: 4.0 }, next: '2026-10-28', nextDays: 34, last: '2026-09-16', lastDays: 8,
    move: 'HIKE', stance: 'HIKE', prob: 62, expBps: 15.5, scenario: { hold: 38, hike: 62, cut: 0 }, source: 'market',
    meetings: [{ date: '2026-10-28', days: 34, hold: 38, hike: 62, cut: 0, impliedBps: 15.5, baseCase: 'HIKE' }] },
  { code: 'EUR', cc: 'eu', bank: 'BCE', full: 'Banque centrale européenne', rate: 2.5, next: '2026-10-29', nextDays: 35, last: '2026-09-10', lastDays: 14,
    move: 'HIKE', stance: 'HIKE', prob: 59, expBps: 14.7, scenario: { hold: 41, hike: 59, cut: 0 }, source: 'maison',
    meetings: [{ date: '2026-10-29', days: 35, hold: 41, hike: 59, cut: 0, impliedBps: 14.7, baseCase: 'HIKE' }] },
] };

(async () => {
  const exe = trouverNavigateur();
  let pp = null; try { pp = require('puppeteer-core'); } catch (e) {}
  if (!exe || !pp) { console.log('\n[Navigation] Chromium indisponible → banc abstenu.\n'); process.exit(0); }
  const base = serveur();
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    const go = () => {
      if (u === '/api/rates') { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify(RATES)); }
      base.emit('request', rq, rs);
    };
    if (u.startsWith('/api/')) setTimeout(go, LAT); else go();
  });
  await new Promise(r => srv.listen(PORT, r));
  const nav = await pp.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  const ouvrir = async (saveData) => {
    const page = await nav.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    if (saveData) await page.evaluateOnNewDocument(() => { try { Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' } }); } catch (e) {} });
    await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    return page;
  };
  // Temps jusqu'à un contenu RÉEL dans la vue (pas de squelette, sélecteur de contenu présent).
  const chrono = async (page, vue, sel) => {
    const d = Date.now();
    await page.evaluate(v => window.activateView(v, false), vue);
    for (let i = 0; i < 60; i++) {
      const pret = await page.evaluate((v, s) => {
        const p = document.getElementById('view-' + v);
        if (!p) return false;
        const skel = [...p.querySelectorAll('[class*="skel"], .dtp-loader')].some(e => e.offsetParent);
        return !skel && [].concat(s).every(x => !!p.querySelector(x));   // plusieurs sélecteurs : TOUS présents (tableau ET graphique)
      }, vue, sel);
      if (pret) return Date.now() - d;
      await new Promise(r => setTimeout(r, 50));
    }
    return 9999;
  };
  const CAS = [['calendar', '#cal-table-wrap tr[data-id], #cal-table-wrap .cal-row'], ['taux', '#taux-grid .rtc:not(.rtc-skel)'], ['bank', ['#bank-tbody .bank-row:not(.bank-skel-row)', '#bank-chart canvas']]];   // la vue n'est prête qu'avec son graphique dessiné
  try {
    console.log('\n── 1. Après les temps morts, les onglets s\'ouvrent sans attendre le réseau ──');
    const page = await ouvrir(false);
    await new Promise(r => setTimeout(r, 11000));   // premier affichage du fil + 2,5 s + tournée de préchargement
    for (const [vue, sel] of CAS) {
      const t = await chrono(page, vue, sel);
      v(vue + ' : ouvert en ' + t + ' ms (latence réseau simulée : ' + LAT + ' ms par appel)', t < LAT / 2, t + ' ms');
    }
    await page.close();

    console.log('\n── 2. (témoin) préchargement coupé (mode économie) → l\'ouverture attend le réseau ──');
    const p2 = await ouvrir(true);
    await new Promise(r => setTimeout(r, 11000));
    const tCal = await chrono(p2, 'calendar', CAS[0][1]);
    v('(témoin) calendrier sans préchargement : au moins une latence réseau', tCal >= LAT, tCal + ' ms');

    console.log('\n── 3. Le survol d\'un onglet suffit à le préparer ──');
    // Toujours en mode économie (aucune tournée) : seul le survol peut précharger.
    await p2.evaluate(() => { const t = document.querySelector('[data-view="taux"]'); if (t) t.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); });
    await new Promise(r => setTimeout(r, LAT + 500));
    const tTaux = await chrono(p2, 'taux', CAS[1][1]);
    v('survol de « Taux », puis clic : ouvert en ' + tTaux + ' ms', tTaux < LAT / 2, tTaux + ' ms');
    // Banques : le graphique de la position ouverte garde ses bougies deux minutes. Rouvrir l'onglet
    // (ou revenir sur la même position) ne doit plus les re-télécharger.
    let nOhlc = 0;
    p2.on('request', r => { if (r.url().includes('/api/bank-ohlc')) nOhlc++; });
    await chrono(p2, 'bank', CAS[2][1]);
    const avant = nOhlc;
    await p2.evaluate(() => window.activateView('news', false));
    await new Promise(r => setTimeout(r, 300));
    await p2.evaluate(() => { const b = (window._bankPositions || []); if (typeof selectBankRow === 'function' && typeof _bankPositions !== 'undefined' && _bankPositions[0]) selectBankRow(_bankPositions[0].id); });
    await new Promise(r => setTimeout(r, LAT + 300));
    v('re-sélectionner la même position ne re-télécharge pas ses bougies (mémoire de 2 min)', nOhlc === avant, (nOhlc - avant) + ' requête(s) /api/bank-ohlc de plus');
    await p2.close();
  } catch (e) {
    v('le banc se termine', false, e.message);
  }
  await nav.close(); srv.close();
  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();

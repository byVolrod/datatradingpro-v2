#!/usr/bin/env node
/**
 * scripts/analystes-verif.js — L'ONGLET ANALYSTES ARRIVE COMPLET, EN UNE FOIS.
 * ------------------------------------------------------------------------------------------------
 * 26/09, capture utilisateur : « quand je suis arrivé sur l'onglet, il n'y avait pas encore les deux
 * récaps hebdo ; ils s'ajoutent deux secondes après, ce n'est pas très pro ». Trois causes mesurées :
 *   · les sources de l'onglet n'étaient demandées qu'à son OUVERTURE, et les hebdo viennent de la
 *     plus lente ;
 *   · le cache local des hebdo, trop lourd, était EFFACÉ au premier quota plein ;
 *   · un rendu différé posé avant l'ouverture peignait une liste partielle pendant l'attente
 *     (trouvé par ce banc : la correction « évidente » laissait passer ce cas).
 * On ouvre donc le vrai desk dans Chromium, avec des hebdo servis en 1,2 s, et on OBSERVE chaque
 * peinture de la liste : une seule, avec les hebdo. Témoin : hebdo à 4 s → la liste n'attend pas
 * indéfiniment (elle se peint sans eux, puis les reçoit).
 * Sans navigateur disponible, le banc s'abstient (code 0).
 *
 *   node scripts/analystes-verif.js
 */
const http = require('http');
const path = require('path');
const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
const fin = () => { console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n')); process.exit(ko ? 1 : 0); };

(async () => {
  const { serveur, trouverNavigateur } = require('./mobile-apercu.js');
  const exe = trouverNavigateur();
  let pp = null; try { pp = require(path.join(RACINE, 'node_modules/puppeteer-core')); } catch (e) {}
  if (!exe || !pp) { console.log('\n[Analystes] Chromium indisponible → banc abstenu.'); return fin(); }
  const base = serveur(), now = Date.now();
  const WR = [{ id: 'wk1', _reportType: 'Weekly Market Recap', title: 'Weekly Market Recap', headline: 'Récap Hebdo des Marchés : test', timestamp: now - 3600e3, _weekly: { weekEnding: new Date(now).toISOString().slice(0, 10) } },
    { id: 'gw1', _reportType: 'Global Economic Weekly', title: 'Global Economic Weekly', headline: 'Récap Éco des Marchés : test', timestamp: now - 3500e3, _weekly: { weekEnding: new Date(now).toISOString().slice(0, 10) } }];
  const SW = Array.from({ length: 8 }, (_, i) => ({ id: 'sw' + i, title: 'London Opening Preparation ' + i, headline: 'Récap Séance Londres ' + i, timestamp: now - (i + 5) * 3600e3, source: 'DTP' }));
  let delai = 1200;
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0], j = o => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
    if (u === '/api/weekly-reports') return setTimeout(() => j({ items: WR, generating: false }), delai);
    if (u === '/api/session-wraps') return j(SW);
    base.emit('request', rq, rs);
  });
  await new Promise(r => srv.listen(4880, r));
  const nav = await pp.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  // Ouvre le desk (cache local vide, comme un nouvel appareil), puis l'onglet 300 ms après.
  const mesurer = async (attente) => {
    const page = await nav.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto('http://localhost:4880/index.html', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 300));
    const vues = await page.evaluate(async (attente) => {
      const l = document.getElementById('arlib-list'), out = [], t0 = performance.now();
      const obs = new MutationObserver(() => {
        const rows = [...l.querySelectorAll('.arl-row:not(.arl-skel-row)')];
        if (rows.length) out.push({ t: (performance.now() - t0) | 0, n: rows.length, hebdo: rows.some(r => /Hebdo|Éco/.test(r.textContent)) });
      });
      obs.observe(l, { childList: true, subtree: true });
      window.activateView && window.activateView('analyst');
      await new Promise(r => setTimeout(r, attente));
      obs.disconnect();
      return out;
    }, attente);
    await page.close();
    return vues;
  };
  try {
    console.log('\n── Hebdo servis en 1,2 s, onglet ouvert aussitôt ──');
    const a = await mesurer(3500);
    v('la PREMIÈRE liste peinte contient déjà les récaps hebdo', a.length && a[0].hebdo, JSON.stringify(a));
    v('… aucune liste partielle entre-temps', a.length && a.every(x => x.hebdo), JSON.stringify(a));
    v('… et elle arrive vite (moins de 2,5 s après l\'ouverture)', a.length && a[0].t < 2500, JSON.stringify(a[0]));

    console.log('\n── Témoin : hebdo à 4 s, l\'attente reste bornée ──');
    delai = 4000;
    const b = await mesurer(5500);
    v('la liste se peint sans attendre la source lente (avant 2,5 s)', b.length && b[0].t < 2500, JSON.stringify(b));
    v('… puis les récaps hebdo la rejoignent quand ils arrivent', b.some(x => x.hebdo), JSON.stringify(b));
  } catch (e) { v('le banc se termine', false, e.message); }
  await nav.close(); srv.close();
  fin();
})();

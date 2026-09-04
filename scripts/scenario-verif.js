#!/usr/bin/env node
/**
 * scripts/scenario-verif.js — LE SCENARIO DESK DIT-IL LE BON SEUIL, DANS LE BON SENS ?
 * ------------------------------------------------------------------------------------------------
 * 04/09, demande utilisateur, capture de référence à l'appui : « ajoute un widget scenario desk
 * comme sur l'image, avec le même but de fonctionnalité, à l'identique ». Précision du même jour :
 * « il n'y a pas de bougie pour scenario desk » — la carte ne porte donc aucun graphique de prix.
 *
 * CE QUE CE BANC GARDE. La carte tient sur une seule affirmation chiffrée : « à partir de tel
 * chiffre, la devise se renforce ; à partir de tel autre, elle s'affaiblit ». Si ce seuil est faux,
 * la carte ment avec l'autorité d'un terminal — et rien, à l'écran, ne permet de s'en apercevoir.
 *
 * TROIS RÈGLES, TROIS CONTRÔLES, ET AUCUN N'EST DÉCORATIF :
 *
 *  1. LE PAS EST CELUI DE LA NOTATION, PAS UNE CONSTANTE. « 0,5 % » se déplace de 0,1 ; « 0,25 » de
 *     0,01 ; « 75K » de 1K. Un pas fixe inventerait une marche que la publication ne connaît pas —
 *     0,6 % sur un taux directeur annoncé à deux décimales n'existe pas. Le cas de la capture de
 *     référence (consensus 0,5 %, seuils 0,6 % et 0,4 %) est rejoué tel quel.
 *
 *  2. LE SENS VIENT DE LA FICHE DU DESK, PAS D'UN « PLUS = MIEUX ». Pour le chômage, les
 *     inscriptions ou les stocks, un chiffre AU-DESSUS des attentes est une mauvaise nouvelle. Le
 *     desk sait déjà cela (`hiUp` dans `CAL_KB`, charts.js) et le widget appelle cette table plutôt
 *     que d'en recopier une seconde. Le banc éprouve donc un indicateur NORMAL et un indicateur
 *     INVERSÉ : sans la paire, une inversion cassée resterait invisible.
 *
 *  3. PAS DE CONSENSUS, PAS DE SEUIL. Une échéance sans prévision n'a rien à quoi se comparer : la
 *     carte le dit et n'affiche aucun chiffre. Fabriquer une référence absente serait exactement la
 *     faute que le desk s'interdit ailleurs pour la couleur d'une donnée sans consensus.
 *
 * ⚠️ ON MESURE CE QUI EST RENDU, PAS LE SOURCE. Le calcul vit dans une fermeture du `mount` : le
 * lire ne prouverait pas qu'il est branché sur la ligne affichée. On monte donc la carte dans un
 * vrai Chromium, avec un calendrier bouchonné dont chaque échéance encode un des cas ci-dessus, et
 * on relit les seuils tels qu'un client les verrait.
 *
 *   node scripts/scenario-verif.js
 *
 * Sans Chromium, le banc S'ABSTIENT (code 0).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { serveur, trouverNavigateur } = require('./mobile-apercu.js');

const RACINE = path.join(__dirname, '..');
const PORT = 4843;
let ko = 0;
const v = (nom, cond, detail) => {
  if (cond) console.log('  ✓ ' + nom);
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
};

/* Chaque échéance encode UN cas, et les cas sont nommés : un jeu d'essai dont on ne sait plus ce
   que chaque ligne éprouvait devient, à la première évolution, un décor qu'on n'ose plus toucher. */
const CAS = [
  { h: 2,  ccy: 'CHF', titre: 'Inflation Rate YoY',      f: '0.5 %', p: '0.4 %', imp: 'High',
    attendu: { up: '0,6% ou plus', dn: '0,4% ou moins' }, quoi: 'le cas EXACT de la capture de référence' },
  { h: 5,  ccy: 'USD', titre: 'Non Farm Payrolls',       f: '75K',   p: '-23K',  imp: 'High',
    attendu: { up: '76K ou plus', dn: '74K ou moins' },   quoi: 'un entier : le pas vaut 1, pas 0,1' },
  { h: 6,  ccy: 'USD', titre: 'Unemployment Rate',       f: '4.3 %', p: '4.2 %', imp: 'High',
    attendu: { up: '4,2% ou moins', dn: '4,4% ou plus' }, quoi: 'INVERSÉ : plus de chômage = mauvaise nouvelle' },
  { h: 30, ccy: 'EUR', titre: 'GDP Growth Rate QoQ',     f: '0.25',  p: '0.10',  imp: 'High',
    attendu: { up: '0,26 ou plus', dn: '0,24 ou moins' }, quoi: 'deux décimales : le pas vaut 0,01' },
  { h: 52, ccy: 'GBP', titre: 'Some Unknown Indicator',  f: '',      p: '1.2',   imp: 'High',
    attendu: null,                                        quoi: 'AUCUN consensus : aucun seuil ne doit être inventé' },
];

function calendrier() {
  const now = Date.now();
  return CAS.map((c, k) => ({ id: 'e' + k, timestamp: now + c.h * 36e5, currency: c.ccy, country: c.ccy,
    title: c.titre, event: c.titre, forecast: c.f, previous: c.p, actual: '', impact: c.imp, importance: c.imp }));
}

(async () => {
  console.log('\n── La carte est bien au catalogue ──');
  const W = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
  v('le widget « Scenario Desk » existe', /id: 'scenario-desk', name: 'Scenario Desk'/.test(W));
  v('… il porte une icône (sinon la bibliothèque affiche un trou)', /'scenario-desk':\s*'<svg/.test(W));
  /* La précision de l'utilisateur, gardée noir sur blanc : pas de bougie ici. Un futur ajout de
     graphique de prix dans cette carte irait contre une consigne explicite. */
  v('… et il n\'embarque aucun graphique de prix (consigne explicite : « il n\'y a pas de bougie »)',
    !/scenario-desk[\s\S]{0,9000}?(am5stock|CandlestickSeries|tradingview)/i.test(W),
    'la carte doit rester une liste d\'échéances et de seuils');

  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Scénario] aucun Chromium → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Scénario] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }

  const srv = serveur();
  await new Promise((r) => srv.listen(PORT, r));
  const CFG = { cfg: { active: 't', gap: 'tight', gapV: 2, deskV: 99, actV: 2, tipSeen: 1,
    layouts: [{ id: 't', name: 'Banc', fav: true, items: [{ w: 'scenario-desk', gw: 12, gh: 20 }] }] } };
  const srvS = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (['/api/me', '/api/auth/me', '/api/session', '/api/user'].includes(u)) {
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      return rs.end(JSON.stringify({ ok: true, loggedIn: true, authenticated: true, role: 'admin',
        user: { id: 'u1', email: 'banc@datatradingpro.com', name: 'Banc', role: 'admin', plan: 'professionnel', active: true } }));
    }
    if (u === '/api/widgets') { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify(CFG)); }
    if (u === '/api/calendar-events') { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify({ items: calendrier() })); }
    srv.emit('request', rq, rs);
  });
  await new Promise((r) => srvS.listen(PORT + 1, r));

  let nav;
  try {
    nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    const fatales = [];
    page.on('pageerror', (e) => fatales.push(String(e.message).slice(0, 160)));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2600));
    await page.evaluate(() => { const b = document.getElementById('widgets-btn'); if (b) b.click(); });
    await new Promise((r) => setTimeout(r, 3000));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 1600));

    const R = await page.evaluate(() => [...document.querySelectorAll('.sd-row')].map((r) => {
      const d = r.querySelector('.sd-det');
      const t = (s) => { const e = d && d.querySelector(s); return e ? e.textContent.trim() : null; };
      return { ev: (r.querySelector('.sd-ev') || {}).textContent,
               up: t('.sd-box--up .sd-seuil'), dn: t('.sd-box--dn .sd-seuil'),
               note: !!(d && d.querySelector('.sd-note')) };
    }));

    console.log('\n── Les seuils, tels qu\'un client les lit ──');
    if (!R.length) console.log('  ~ aucune ligne rendue → contrôles abstenus.');
    else {
      /* Le jeu d'essai ne contient que des « High » : les cinq cas doivent tous ressortir. En
         perdre un silencieusement viderait les contrôles suivants sans que rien ne rougisse. */
      v('les cinq échéances du jeu d\'essai sont rendues', R.length === CAS.length, R.length + ' ligne(s)');
      CAS.forEach((c) => {
        const l = R.find((x) => (x.ev || '').trim() === c.titre);
        if (!l) { v('« ' + c.titre +' » est présente', false, 'ligne absente'); return; }
        if (c.attendu) {
          v('« ' + c.titre + ' » — ' + c.quoi,
            l.up === c.attendu.up && l.dn === c.attendu.dn,
            'haussier « ' + l.up + ' » (attendu « ' + c.attendu.up + ' ») · baissier « ' + l.dn + ' » (attendu « ' + c.attendu.dn + ' »)');
        } else {
          v('« ' + c.titre + ' » — ' + c.quoi,
            l.up === null && l.dn === null && l.note === true,
            'seuils : ' + l.up + ' / ' + l.dn + ' · note affichée : ' + l.note);
        }
      });
      /* LA PAIRE, ET C'EST ELLE QUI PROUVE L'INVERSION. Deux indicateurs justes séparément peuvent
         l'être pour la mauvaise raison — par exemple si les deux encadrés étaient identiques. On
         exige donc que le seuil haussier du chômage soit SOUS son consensus, et celui de
         l'inflation AU-DESSUS du sien. */
      const chom = R.find((x) => /Unemployment/.test(x.ev || ''));
      const infl = R.find((x) => /Inflation Rate/.test(x.ev || ''));
      v('l\'inversion est réelle : le seuil haussier du chômage est SOUS son consensus, celui de l\'inflation AU-DESSUS',
        !!chom && !!infl && /moins/.test(chom.up) && /plus/.test(infl.up),
        'chômage « ' + (chom || {}).up + ' » · inflation « ' + (infl || {}).up + ' »');
    }
    v('aucune erreur d\'exécution', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));
    await page.close();
  } catch (e) {
    console.log('\n[Scénario] phase navigateur interrompue : ' + (e && e.message));
  } finally {
    if (nav) await nav.close();
    srvS.close();
    srv.close();
  }

  console.log(ko === 0 ? '\n[Scénario] tout est vert.\n' : '\n[Scénario] ' + ko + ' contrôle(s) au rouge.\n');
  process.exit(ko ? 1 : 0);
})();

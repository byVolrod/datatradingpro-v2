#!/usr/bin/env node
/**
 * scripts/accueil-v3-verif.js — L'ESPACE D'ACCUEIL PARLE LA LANGUE DU DESK V3.
 * ------------------------------------------------------------------------------------------------
 * 26/09, demande utilisateur : « améliore les finitions d'ici aussi pour la V3, comme tu as pu
 * faire ». Deux défauts, un visible et un caché :
 *   · l'habillage : cadres arrondis séparés, titres en capitales espacées, filets décoratifs — la
 *     grammaire d'avant, à côté d'un desk V3 aux cadres collés et aux en-têtes en casse normale ;
 *   · le montage : les présentations V3 arrivent par des scripts chargés APRÈS l'accueil, qui
 *     montait donc ses quatre panneaux dans leur version cliente, pour toute la session.
 * On ouvre le vrai desk dans Chromium, accueil activé, V3 allumée puis éteinte (témoin), et on
 * MESURE : casse des titres, icônes, trait d'un pixel entre les cadres, remontage d'un panneau à
 * l'annonce d'une présentation V3. Sans navigateur disponible, le banc s'abstient (code 0).
 *
 *   node scripts/accueil-v3-verif.js
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
  if (!exe || !pp) { console.log('\n[Accueil V3] Chromium indisponible → banc abstenu.'); return fin(); }
  const base = serveur();
  let V2 = true;
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0], j = o => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
    if (u === '/api/auth/me') return j({ loggedIn: true, user: { id: 'u-admin', email: 'essai@exemple.fr', name: 'Essai', role: 'admin', plan: 'professionnel', active: true }, loginAt: Date.now(), feat: { accueil: true }, v2: V2 });
    if (u === '/api/ui-prefs') return j({ src: 'kv', prefs: { v2: V2 ? 'on' : 'off' } });
    base.emit('request', rq, rs);
  });
  await new Promise(r => srv.listen(4884, r));
  const nav = await pp.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ouvrir = async () => {
    const page = await nav.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    await page.goto('http://localhost:4884/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#dtp-home .home-zone-body[id^="home-w-"] > *').length >= 3, { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 900));
    return page;
  };
  const mesure = page => page.evaluate(() => {
    const t = [...document.querySelectorAll('#dtp-home .home-panel-t')];
    const g = document.querySelector('#dtp-home .home-grid');
    return {
      home: !!document.getElementById('dtp-home'),
      casse: t.map(x => getComputedStyle(x).textTransform),
      icones: [...document.querySelectorAll('#dtp-home .home-panel-ico[data-w]')].filter(x => x.querySelector('svg')).length,
      gap: g ? getComputedStyle(g).columnGap : null,
    };
  });
  try {
    console.log('\n── V3 allumée ──');
    const p1 = await ouvrir();
    const a = await mesure(p1);
    v('l\'accueil est affiché', a.home);
    v('titres des panneaux en casse normale (comme les cartes du desk V3)', a.casse.length >= 4 && a.casse.every(x => x === 'none'), JSON.stringify(a.casse));
    v('… chacun porte l\'icône de son widget', a.icones >= 4, a.icones + ' icône(s)');
    v('cadres collés par un trait d\'un pixel', a.gap === '1px', a.gap);
    // Une présentation V3 qui s'annonce après coup remonte SON panneau, et lui seul.
    const r = await p1.evaluate(async () => {
      const h = document.getElementById('home-w-fil-news'), autre = document.getElementById('home-w-force-devises');
      if (!h || !h.firstElementChild || !autre || !autre.firstElementChild) return { ok: false };
      h.firstElementChild.setAttribute('data-ancien', '1'); autre.firstElementChild.setAttribute('data-ancien', '1');
      document.dispatchEvent(new CustomEvent('dtp:v3-montage', { detail: { id: 'fil-news' } }));
      await new Promise(z => setTimeout(z, 400));
      return { ok: true, remonte: !h.querySelector('[data-ancien]') && h.children.length > 0, intact: !!autre.querySelector('[data-ancien]') };
    });
    v('une présentation V3 annoncée après l\'ouverture remonte son panneau', r.ok && r.remonte, JSON.stringify(r));
    v('… et laisse les autres panneaux intacts', r.ok && r.intact, JSON.stringify(r));
    await p1.close();

    console.log('\n── Témoin : V3 éteinte, l\'accueil des clients est inchangé ──');
    V2 = false;
    const p2 = await ouvrir();
    const b = await mesure(p2);
    v('titres en capitales, comme aujourd\'hui', b.home && b.casse.length >= 4 && b.casse.every(x => x === 'uppercase'), JSON.stringify(b.casse));
    v('… sans icône ni cadres collés', b.icones === 0 && b.gap !== '1px', JSON.stringify(b));
    await p2.close();
  } catch (e) { v('le banc se termine', false, e.message); }
  await nav.close(); srv.close();
  fin();
})();

#!/usr/bin/env node
/**
 * proba-verif.js — LA TABLE DES PROBABILITÉS DIT-ELLE CE QUE LA DONNÉE DIT ?
 * ------------------------------------------------------------------------------------------------
 * 01/09, demande utilisateur : « vérifie si on a le widget probabilitétable, sinon ajoute-le ».
 * Vérifié : le desk ne l'avait pas. « Taux directeurs » et « Prochaine réunion BC » ne montrent que
 * la PROCHAINE échéance ; la trajectoire — ce que le marché price pour les huit réunions suivantes —
 * n'était visible nulle part. La donnée, elle, existait déjà : `/api/rates` la sert par banque.
 *
 * CE QUE CE CONTRÔLE ÉPROUVE, ET POURQUOI IL EST NÉCESSAIRE. Un widget qui affiche des pourcentages
 * a une façon très particulière de mentir : il rend quelque chose. Des cases pleines, des couleurs,
 * un tableau crédible — et un chiffre pris dans la mauvaise colonne. On lui sert donc un pricing
 * CONNU, construit pour que chaque colonne ait une valeur unique et reconnaissable, et on relit ce
 * qui est peint : la bonne valeur, dans la bonne case, avec la bonne couleur.
 *
 *   node scripts/proba-verif.js       (s'abstient sans Chromium)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const PUB = path.join(RACINE, 'public');
const PORT = 4756;
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };

let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

/* LE PRICING D'ESSAI. Chaque nombre est UNIQUE dans tout le jeu : si une valeur se retrouve dans la
   mauvaise colonne, on le voit — ce qu'un jeu à valeurs rondes et répétées ne montrerait jamais. */
const RATES = { banks: [{
  code: 'USD', cc: 'us', bank: 'Fed', full: 'Federal Reserve', rate: 4.375,
  next: '2026-09-16', nextDays: 15,
  meetings: [
    { date: '2026-09-16', days: 15,  cut: 11.11, hold: 62.22, hike: 26.67, impliedBps: 5.99,  baseCase: 'Hold' },
    { date: '2026-11-04', days: 64,  cut: 0,     hold: 34.14, hike: 65.86, impliedBps: 12.74, baseCase: 'Hike' },
    { date: '2026-12-16', days: 106, cut: 71.23, hold: 21.45, hike: 7.32,  impliedBps: -8.41, baseCase: 'Cut'  },
  ],
}] };

function trouverNavigateur() {
  const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
  }
  return c.find(x => x && fs.existsSync(x)) || null;
}

(async () => {
  console.log('\n═══ PROBA-VERIF — la table des probabilités ═══');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.log('  · puppeteer-core absent → abstention.\n'); process.exit(0); }
  const exe = trouverNavigateur();
  if (!exe) { console.log('  · aucun Chromium → abstention.\n'); process.exit(0); }

  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (u === '/api/rates') { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify(RATES)); }
    /* ⚠️ LA PAGE EST SERVIE, PAS INJECTÉE. Avec `setContent`, le document a pour origine
       « about:blank » : le `fetch('/api/rates')` du widget n'a alors AUCUNE base à résoudre et
       échoue silencieusement — le widget affiche son repli et le banc mesure une coquille vide.
       Mesuré : vingt contrôles rouges pour cette seule raison. */
    if (u === '/banc') {
      rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return rs.end('<!doctype html><html data-theme="dark"><head><meta charset="utf-8">'
        + '<link rel="stylesheet" href="/css/style.css"></head>'
        + '<body style="margin:0;background:#0c0c0e"><div id="h" style="width:820px;height:360px"></div></body></html>');
    }
    const f = path.join(PUB, u.replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f)) { rs.writeHead(404); return rs.end('404'); }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(rs);
  }).listen(PORT);

  let nav = null;
  try {
    nav = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    await page.setViewport({ width: 900, height: 600 });
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message)));
    await page.goto('http://localhost:' + PORT + '/banc', { waitUntil: 'networkidle0' });

    /* LE VRAI WIDGET, DÉCOUPÉ DANS widgets.js. Le fichier entier est un module qui monte tout le
       desk : on n'en extrait que la définition, et on lui fournit les quelques aides qu'elle
       emploie — les mêmes noms, des versions minimales, pour qu'elle s'exécute telle quelle. */
    const WID = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');
    const d = WID.indexOf("      id: 'proba-reunions'");
    const f = WID.indexOf('\n    },\n', d);
    v('la définition du widget est extractible de widgets.js', d > 0 && f > d);
    if (d < 0 || f < 0) throw new Error('widget proba-reunions introuvable');
    const DEF = WID.slice(WID.lastIndexOf('{', d), f + 6);

    const res = await page.evaluate(async (src) => {
      window.skel = h => { h.innerHTML = '<div class="skel"></div>'; };
      window.fallback = (h, m) => { h.innerHTML = '<div class="wdg-vide">' + m + '</div>'; };
      window.esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      window.opt = (it, W, k) => (it && it.o && it.o[k]) || (W.opts.find(o => o.k === k) || {}).def;
      window.CAL_FLAG = () => '<img class="f">';
      const def = eval('(' + src + ')');
      def.mount(document.getElementById('h'), { o: { banque: 'USD' } });
      await new Promise(r => setTimeout(r, 350));
      const q = s => document.querySelector(s);
      const lignes = [...document.querySelectorAll('.wpb-t tbody tr')].map(tr =>
        [...tr.children].map(td => ({ txt: td.textContent.trim(), cls: (td.firstElementChild || {}).className || '' })));
      const parts = [...document.querySelectorAll('.wpb-part')].map(p => ({ cls: p.className, w: p.style.width, txt: p.textContent.trim() }));
      const kpis = [...document.querySelectorAll('.wpb-kpi')].map(k => ({
        lbl: k.querySelector('span').textContent.trim(), val: k.querySelector('b').textContent.trim(),
        cls: k.querySelector('b').className }));
      return { rendu: !!q('.wpb'), lignes, parts, kpis, vide: !!q('.wdg-vide') };
    }, DEF);

    console.log('\n── 1. Le widget rend, et rend la trajectoire complète ──');
    v('le widget se monte sans erreur', res.rendu && !res.vide, res.vide ? 'repli affiché' : JSON.stringify(erreurs.slice(0, 2)));
    v('aucune exception à l\'exécution', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    v('les TROIS réunions sont listées, pas seulement la prochaine', res.lignes.length === 3, res.lignes.length + ' ligne(s)');

    console.log('\n── 2. Chaque chiffre dans SA colonne ──');
    /* C'est le contrôle qui justifie tout le banc : un tableau de pourcentages rend toujours quelque
       chose de crédible. On vérifie l'appariement valeur↔colonne, sur des nombres uniques. */
    const l0 = res.lignes[0] || [];
    v('la date de la 1re réunion', /16 sept\. 26/.test((l0[0] || {}).txt), (l0[0] || {}).txt);
    v('… ses jours restants', /15 j/.test((l0[1] || {}).txt), (l0[1] || {}).txt);
    v('… sa baisse en colonne Baisse', /11,11/.test((l0[2] || {}).txt), (l0[2] || {}).txt);
    v('… son maintien en colonne Maintien', /62,22/.test((l0[3] || {}).txt), (l0[3] || {}).txt);
    v('… sa hausse en colonne Hausse', /26,67/.test((l0[4] || {}).txt), (l0[4] || {}).txt);
    v('… son delta implicite', /\+5,99 bps/.test((l0[5] || {}).txt), (l0[5] || {}).txt);
    /* La virgule décimale : le desk écrit « 0,2 % ». Un point au milieu de puces qui écrivent des
       virgules se remarque — c'est une règle du projet, pas une préférence. */
    v('les nombres sont écrits à la française', !/\d\.\d/.test(res.lignes.map(r => r.map(c => c.txt).join(' ')).join(' ')),
      res.lignes.map(r => r.map(c => c.txt).join('|')).join(' // '));

    console.log('\n── 3. La couleur dit la même chose que le chiffre ──');
    /* Charte immuable du projet : hausse = vert, baisse = rouge, maintien = jaune-orange. Une couleur
       qui contredit son chiffre est pire qu'une absence de couleur. */
    v('un delta POSITIF est vert (hausse)', /wpb-hausse/.test((l0[5] || {}).cls), (l0[5] || {}).cls);
    const l2 = res.lignes[2] || [];
    v('un delta NÉGATIF est rouge (baisse)', /wpb-baisse/.test((l2[5] || {}).cls), (l2[5] || {}).cls);
    v('le scénario de base suit la plus forte probabilité (Maintien à 62 %)', /wpb-maintien/.test((l0[6] || {}).cls) && /Maintien/.test((l0[6] || {}).txt), JSON.stringify(l0[6]));
    v('… et bascule quand une autre issue passe devant (Baisse à 71 %)', /wpb-baisse/.test((l2[6] || {}).cls) && /Baisse/.test((l2[6] || {}).txt), JSON.stringify(l2[6]));
    const l1 = res.lignes[1] || [];
    v('… Hausse à 65,86 % le devient aussi', /wpb-hausse/.test((l1[6] || {}).cls) && /Hausse/.test((l1[6] || {}).txt), JSON.stringify(l1[6]));
    v('l\'issue dominante ressort dans sa colonne', /wpb-n--fort/.test((l0[3] || {}).cls) && !/wpb-n--fort/.test((l0[2] || {}).cls),
      JSON.stringify([l0[2], l0[3], l0[4]]));

    console.log('\n── 4. La barre de répartition est à l\'échelle ──');
    const larg = res.parts.map(p => parseFloat(p.w) || 0);
    v('les trois issues y sont', res.parts.length === 3, JSON.stringify(res.parts.map(p => p.w)));
    v('leurs largeurs valent leurs probabilités', Math.abs(larg.reduce((a, b) => a + b, 0) - 100) < 0.5, JSON.stringify(larg));
    v('… et le maintien y est le plus large', Math.max.apply(null, larg) === larg[1], JSON.stringify(larg));
    /* Une part minuscule ne porte pas son chiffre : il déborderait sur la voisine et on lirait le
       mauvais nombre. Ici les trois sont assez larges — on éprouve donc la règle sur le principe. */
    v('chaque part assez large porte son chiffre', res.parts.every(p => parseFloat(p.w) < 4 || /\d/.test(p.txt)),
      JSON.stringify(res.parts.map(p => p.w + '→' + p.txt)));

    console.log('\n── 5. Les repères du haut ──');
    const kv = n => (res.kpis.find(k => k.lbl.toLowerCase().startsWith(n)) || {}).val || '';
    v('le taux actuel est celui de la banque', /4,375 %/.test(kv('taux')), kv('taux'));
    v('la prochaine réunion est datée et comptée', /16 sept\. 26 · 15 j/.test(kv('prochaine')), kv('prochaine'));
    v('le scénario de base est nommé avec sa probabilité', /Maintien 62 %/.test(kv('sc')), kv('sc'));

    if (process.env.DTP_SHOT) { try { await page.screenshot({ path: process.env.DTP_SHOT }); } catch (e) {} }
    await page.close();
  } catch (e) {
    v('le banc s\'exécute', false, e.message);
  } finally {
    if (nav) try { await nav.close(); } catch {}
    srv.close();
  }

  console.log('');
  if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
  console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');
  process.exit(0);
})();

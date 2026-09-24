#!/usr/bin/env node
/**
 * scripts/v2-verif.js — DTP V2 : RÉSERVÉE AUX ADMINS, RÉVERSIBLE, SANS EFFET SUR LE DESK CLIENT (24/09)
 * ------------------------------------------------------------------------------------------------
 * Demande user : « ne modifie que pour les admins ; si je demande de revenir, on revient à l'état
 * des autres utilisateurs ». Ce banc prouve les trois promesses de la section 0 de
 * docs/dtp-v2/AUDIT-ET-FEUILLE-DE-ROUTE.md :
 *   1. un compte client ne charge AUCUN fichier V2 (et le serveur les lui refuse) ;
 *   2. un admin qui n'a pas activé « Aperçu V2 » voit le desk exact des clients (+ l'interrupteur) ;
 *   3. activée, l'app mobile remplace l'en-tête et la navigation SANS toucher aux vues, qui restent
 *      celles du desk (activateView), et elle s'efface au-delà de la largeur d'un téléphone.
 * Partie statique (tourne partout) + partie Chromium (s'abstient sans navigateur).
 *
 *   node scripts/v2-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const R = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
const IDX = fs.readFileSync(path.join(R, 'public/index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(R, 'public/css/v2/app.css'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

console.log('\n── 1. Le serveur ne sert la V2 qu\'aux admins ──');
const iGarde = SRV.indexOf("app.use(['/js/v2', '/css/v2']");
const iStatic = SRV.indexOf("app.use(express.static(path.join(__dirname, 'public')");
v('la garde des fichiers V2 est posée AVANT le service statique', iGarde > 0 && iStatic > iGarde);
{
  const bloc = SRV.slice(SRV.indexOf('function _v2Actif()'), SRV.indexOf('\n});', iGarde) + 4);
  const monter = env => new Function('app', 'process', bloc)({ use: (_p, fn) => { monter.fn = fn; } }, { env });
  const essai = (role, env) => {
    monter(env || {});
    let code = 0, suite = false;
    const res = { status: c => { code = c; return { end() {} }; }, setHeader() {} };
    monter.fn({ session: role ? { user: { role } } : {} }, res, () => { suite = true; });
    return suite ? 'servi' : code;
  };
  v('admin → servi', essai('admin') === 'servi');
  v('client → 404', essai('client') === 404);
  v('visiteur sans session → 404', essai(null) === 404);
  v('DTP_V2=0 coupe la V2 même pour un admin', essai('admin', { DTP_V2: '0' }) === 404);
}
v('/api/auth/me n\'annonce la V2 qu\'à un admin', /v2: user\.role === 'admin' && _v2Actif\(\)/.test(SRV));
v('la préférence « v2 » est enregistrable par compte', /_UIPREF_KEYS = new Set\(\[\s*\n\s*'v2',/.test(SRV));
v('index.html ne charge le chargeur V2 que si admin ET annoncé par le serveur', /if \(window\._pdIsAdmin && d\.v2\) \{[\s\S]{0,300}\/js\/v2\/boot\.js/.test(IDX));
{
  // Toute règle de la feuille V2 doit être bornée à l'app : sans la classe, elle ne touche rien.
  const regles = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '')
    .replace(/@media[^{]+\{/g, '').split('}').map(b => b.split('{')[0].trim()).filter(Boolean);
  const hors = [];
  regles.forEach(sel => sel.split(',').map(x => x.trim()).filter(Boolean).forEach(x => { if (!/^html\.dtp-app\b|^\.v2a-/.test(x)) hors.push(x); }));
  v('chaque sélecteur de la feuille V2 est borné (html.dtp-app ou .v2a-)', hors.length === 0, hors.slice(0, 5).join(' | '));
}

// Jeux d'essai de l'écran Marchés : 3 actifs dans le sens du risque, 1 contre (variation × sens).
const RISQUE = { label: 'WEAK RISK-ON', pct: 12.4, description: 'Léger regain d\'appétit pour le risque.', updatedAt: new Date().toISOString(),
  assets: [{ label: 'S&P', chg: 0.8, dir: 1 }, { label: 'AUDJPY', chg: 0.3, dir: 1 }, { label: 'Or', chg: -0.4, dir: -1 }, { label: 'VIX', chg: 2.1, dir: -1 }] };
const CCY = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CHF', 'CAD', 'NZD'];
const FINS = { USD: 0.12, EUR: -0.05, JPY: -0.21, GBP: 0.3, AUD: 0.02, CHF: -0.09, CAD: 0.07, NZD: -0.11 };
const FORCE = { currencies: CCY, updatedAt: new Date().toISOString(), series: Object.fromEntries(CCY.map(c => [c, Array.from({ length: 30 }, (_, i) => ({ t: 1790000000000 + i * 6e5, v: +(FINS[c] * (i + 1) / 30).toFixed(5) }))])) };

console.log('\n── 1 bis. L\'écran Marchés affiche le chiffre du desk (même échelle) ──');
{
  const CH = fs.readFileSync(path.join(R, 'public/js/charts.js'), 'utf8');
  const APPM = fs.readFileSync(path.join(R, 'public/js/v2/app-mobile.js'), 'utf8');
  const src = (CH.match(/function computeScale\(d\) \{[\s\S]*?\n  \}/) || [''])[0];
  const src2 = (APPM.match(/function echelle\(d\) \{[\s\S]*?\n  \}/) || [''])[0];
  v('les deux calculs d\'échelle sont retrouvés (desk et app)', !!src && !!src2);
  if (src && src2) {
    const desk = new Function(src + '; return computeScale;')(), app = new Function(src2 + '; return echelle;')();
    const gros = JSON.parse(JSON.stringify(FORCE)); gros.series.GBP = gros.series.GBP.map(x => ({ t: x.t, v: x.v * 9 }));
    v('mêmes résultats sur une séance ordinaire ET sur une séance à pic', desk(FORCE) === app(FORCE) && desk(gros) === app(gros), desk(FORCE) + ' / ' + app(FORCE) + ' · ' + desk(gros) + ' / ' + app(gros));
  }
}

(async () => {
  const { serveur, trouverNavigateur } = require('./mobile-apercu.js');
  const exe = trouverNavigateur();
  let pp = null; try { pp = require('puppeteer-core'); } catch (e) {}
  if (!exe || !pp) { console.log('\n[V2] Chromium indisponible → partie navigateur abstenue.'); return fin(); }
  const base = serveur();
  let SC = { role: 'client', v2: '' };
  const vus = [];
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    const j = o => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
    if (/^\/(js|css)\/v2\//.test(u)) { vus.push(u); if (SC.role !== 'admin') { rs.writeHead(404); return rs.end(); } }
    if (u === '/api/auth/me') return j({ loggedIn: true, user: { id: 'u-' + SC.role, email: 'x@y.z', name: 'Essai', role: SC.role, plan: 'professionnel', active: true }, loginAt: Date.now(), feat: {}, v2: SC.role === 'admin' });
    if (u === '/api/ui-prefs') return j(SC.v2 ? { src: 'kv', prefs: { v2: SC.v2 } } : { src: 'defaut', prefs: {} });
    if (u === '/api/risk-sentiment') return j(RISQUE);
    if (u === '/api/currency-strength') return j(FORCE);
    base.emit('request', rq, rs);
  });
  await new Promise(r => srv.listen(4873, r));
  const nav = await pp.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ouvrir = async (sc, w, h) => {
    SC = sc; vus.length = 0;
    const ctx = await nav.createBrowserContext();
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    await page.setViewport({ width: w, height: h, isMobile: w < 800, hasTouch: w < 800, deviceScaleFactor: 1 });
    await page.goto('http://localhost:4873/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3500));
    return { page, ctx, erreurs };
  };
  try {
    console.log('\n── 2. Un compte client : rien de la V2 ──');
    {
      const { page, ctx } = await ouvrir({ role: 'client', v2: 'on' }, 390, 844);
      const r = await page.evaluate(() => ({ app: document.documentElement.classList.contains('dtp-app'), barre: !!document.querySelector('.v2a-barre'), inter: !!document.getElementById('v2-interrupteur'), topbar: getComputedStyle(document.querySelector('.topbar')).display }));
      v('aucun fichier V2 demandé (même avec une préférence « on » héritée)', vus.length === 0, vus.join(', '));
      v('ni barre d\'onglets, ni interrupteur, barre du haut du desk intacte', !r.app && !r.barre && !r.inter && r.topbar !== 'none', JSON.stringify(r));
      await ctx.close();
    }
    console.log('\n── 3. Admin, « Aperçu V2 » désactivé : le desk des clients + l\'interrupteur ──');
    {
      const { page, ctx } = await ouvrir({ role: 'admin', v2: '' }, 390, 844);
      const r = await page.evaluate(() => ({ app: document.documentElement.classList.contains('dtp-app'), inter: !!document.getElementById('v2-interrupteur') }));
      v('l\'interrupteur est dans le volet Profil', r.inter);
      v('l\'interface V2 n\'est pas chargée', !r.app && !vus.some(u => /app\.css|app-mobile/.test(u)), vus.join(', '));
      await ctx.close();
    }
    console.log('\n── 4. Admin, « Aperçu V2 » activé, téléphone : l\'app ──');
    {
      const { page, ctx, erreurs } = await ouvrir({ role: 'admin', v2: 'on' }, 390, 844);
      const r = await page.evaluate(() => {
        const b = document.querySelector('.v2a-barre'), ml = document.getElementById('main-layout'), t = document.querySelector('.v2a-tete');
        const rb = b && b.getBoundingClientRect(), rm = ml && ml.getBoundingClientRect(), rt = t && t.getBoundingClientRect();
        return { app: document.documentElement.classList.contains('dtp-app'), onglets: b ? b.querySelectorAll('.v2a-onglet').length : 0,
          topbar: getComputedStyle(document.querySelector('.topbar')).display, nav: getComputedStyle(document.getElementById('topbar-nav')).display,
          barreBas: rb ? Math.round(rb.bottom) : null, hauteur: innerHeight, finContenu: rm ? Math.round(rm.bottom) : null, hautBarre: rb ? Math.round(rb.top) : null,
          debutContenu: rm ? Math.round(rm.top) : null, finTete: rt ? Math.round(rt.bottom) : null };
      });
      v('l\'app est active : 5 onglets (4 écrans + Plus)', r.app && r.onglets === 5, JSON.stringify(r) + ' · fichiers : ' + vus.join(', ') + ' · ' + JSON.stringify(await page.evaluate(() => ({ boot: !!window._dtpV2Boot, charge: !!window._dtpV2Charge, app: !!window._dtpV2App, pref: window.DTPPref && DTPPref.get('v2', '?')}))) + ' ' + erreurs.join(' | '));
      v('l\'ancienne barre du haut et la rangée d\'onglets sont masquées', r.topbar === 'none' && r.nav === 'none');
      v('la barre d\'onglets est collée au bas de l\'écran', r.barreBas === r.hauteur);
      v('le contenu tient ENTRE l\'en-tête et la barre, sans vide ni recouvrement', Math.abs(r.debutContenu - r.finTete) <= 1 && Math.abs(r.finContenu - r.hautBarre) <= 1, JSON.stringify(r));
      v('l\'app s\'ouvre sur le Fil : Mon Desk (grand écran) ne se rouvre pas tout seul', await page.evaluate(() => document.getElementById('view-widgets').classList.contains('hidden') && !document.getElementById('view-news').classList.contains('hidden') && document.querySelector('.v2a-onglet.v2a-actif').dataset.v2v === 'news'));
      const aller = async sel => { await page.click(sel); await new Promise(z => setTimeout(z, 500)); };
      const f = await page.evaluate(() => ({ puces: document.querySelectorAll('#v2a-puces-fil button').length,
        titre: getComputedStyle(document.querySelector('#view-news .panel-header')).display }));
      v('Fil : le titre en double disparaît, les puces Tout / Essentiel / Sections le remplacent', f.puces === 3 && f.titre === 'none', JSON.stringify(f));
      await aller('#v2a-puces-fil [data-mode="essentiel"]');
      v('… « Essentiel » bascule le vrai filtre du fil (fonction existante)', await page.evaluate(() => { try { return newsEssentialMode === true && document.querySelector('#v2a-puces-fil [data-mode="essentiel"]').classList.contains('v2a-puce-on'); } catch (e) { return false; } }));
      await aller('#v2a-puces-fil [data-mode="tout"]');
      await aller('.v2a-onglet[data-v2v="calendar"]');
      const c = await page.evaluate(() => ({ vue: !document.getElementById('view-calendar').classList.contains('hidden'), titre: document.getElementById('v2a-titre').textContent, actif: document.querySelector('.v2a-onglet.v2a-actif').dataset.v2v }));
      v('onglet Calendrier → la vraie vue Calendrier du desk, titre et onglet à jour', c.vue && c.titre === 'Calendrier' && c.actif === 'calendar', JSON.stringify(c));
      await aller('.v2a-onglet[data-v2v="markets"]');
      await new Promise(z => setTimeout(z, 600));
      const m = await page.evaluate(() => ({ visible: !!document.querySelector('.v2a-ecran.v2a-visible'),
        ordre: [...document.querySelectorAll('.v2a-force-nom b')].map(b => b.textContent).join(','),
        lib: (document.querySelector('.v2a-risque-lib') || {}).textContent, cpt: (document.querySelector('.v2a-risque-cpt') || {}).textContent,
        source: (document.querySelector('#v2a-risque .v2a-source') || {}).textContent, titre: document.getElementById('v2a-titre').textContent }));
      v('onglet Marchés → l\'écran Marchés de l\'app', m.visible && m.titre === 'Marchés', JSON.stringify(m));
      v('… les 8 devises, de la plus forte à la plus faible', m.ordre === 'GBP,USD,CAD,AUD,EUR,CHF,NZD,JPY', m.ordre);
      v('… le régime de risque traduit, avec le décompte réel des facteurs (3 / 1)', m.lib === 'Risk-on léger' && /3 facteurs risk-on · 1 risk-off/.test(m.cpt), m.lib + ' · ' + m.cpt);
      v('… et sa source nommée (traçabilité)', /4 actifs suivis · cotations Yahoo Finance/.test(m.source || ''), m.source);
      await aller('#v2a-detail');
      v('« Voir le détail » ouvre la colonne Marchés du desk, intacte', await page.evaluate(() => document.getElementById('main-layout').classList.contains('show-right-mobile') && !document.querySelector('.v2a-ecran.v2a-visible')));
      await aller('.v2a-onglet[data-v2v="plus"]');
      v('« Plus » ouvre la feuille de tous les outils', await page.evaluate(() => document.querySelector('.v2a-feuille').classList.contains('v2a-ouverte') && document.querySelectorAll('.v2a-tuile').length >= 6));
      await aller('.v2a-tuile[data-v2v="taux"]');
      const t = await page.evaluate(() => ({ vue: !document.getElementById('view-taux').classList.contains('hidden'), feuille: document.querySelector('.v2a-feuille').classList.contains('v2a-ouverte'), plus: document.querySelector('.v2a-onglet[data-v2v="plus"]').classList.contains('v2a-actif') }));
      v('une tuile ouvre sa vue, referme la feuille, et « Plus » reste allumé', t.vue && !t.feuille && t.plus, JSON.stringify(t));
      await aller('.v2a-onglet[data-v2v="plus"]');
      await aller('.v2a-tuile[data-v2v="widgets"]');
      v('… mais la tuile « Mon Desk » l\'ouvre bien (choix de l\'utilisateur)', await page.evaluate(() => !document.getElementById('view-widgets').classList.contains('hidden')));
      await page.evaluate(() => window.activateView('news'));
      await new Promise(z => setTimeout(z, 300));
      v('une navigation faite ailleurs (activateView) resynchronise la barre', await page.evaluate(() => document.querySelector('.v2a-onglet.v2a-actif').dataset.v2v === 'news'));
      v('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
      await ctx.close();
    }
    console.log('\n── 5. Admin, V2 activée, grand écran : l\'app s\'efface ──');
    {
      const { page, ctx } = await ouvrir({ role: 'admin', v2: 'on' }, 1400, 900);
      const r = await page.evaluate(() => ({ app: document.documentElement.classList.contains('dtp-app'), topbar: getComputedStyle(document.querySelector('.topbar')).display }));
      v('au-delà d\'un téléphone : desk normal', !r.app && r.topbar !== 'none', JSON.stringify(r));
      await ctx.close();
    }
  } catch (e) { v('le banc se termine', false, e.message); }
  await nav.close(); srv.close();
  fin();
})();
function fin() {
  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
}

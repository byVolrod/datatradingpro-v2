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
  // L'habillage V3 du desk grand écran : chaque règle commence par html.dtp-v2 (sans la classe, rien).
  const DESK = fs.readFileSync(path.join(R, 'public/css/v2/desk.css'), 'utf8');
  const rd = DESK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '')
    .replace(/@media[^{]+\{/g, '').split('}').map(b => b.split('{')[0].trim()).filter(Boolean);
  const horsD = [];
  rd.forEach(sel => sel.split(',').map(x => x.trim()).filter(Boolean).forEach(x => { if (!/^html\.dtp-v2\b/.test(x)) horsD.push(x); }));
  v('chaque sélecteur de l\'habillage V3 du desk est borné (html.dtp-v2)', rd.length > 20 && horsD.length === 0, horsD.slice(0, 5).join(' | '));
  v('… et vit dans un @media grand écran (l\'app mobile garde sa propre feuille)', /^\s*@media \(min-width: 821px\) \{/m.test(DESK.replace(/\/\*[\s\S]*?\*\//g, '')));
  // L'habillage V3 du panneau admin : borné à html.dtp-v3-admin, posé par admin.html, et servi sous
  // /css/v2 (donc refusé à tout compte non admin par la même garde).
  const ADM = fs.readFileSync(path.join(R, 'public/css/v2/admin.css'), 'utf8');
  const ra = ADM.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '')
    .replace(/@media[^{]+\{/g, '').split('}').map(b => b.split('{')[0].trim()).filter(Boolean);
  const horsA = [];
  ra.forEach(sel => sel.split(',').map(x => x.trim()).filter(Boolean).forEach(x => { if (!/^html\.dtp-v3-admin\b/.test(x)) horsA.push(x); }));
  const HADM = fs.readFileSync(path.join(R, 'public/admin.html'), 'utf8');
  v('chaque sélecteur de l\'habillage V3 du panneau admin est borné (html.dtp-v3-admin)', ra.length > 15 && horsA.length === 0, horsA.slice(0, 5).join(' | '));
  v('… admin.html pose la classe et charge la feuille depuis /css/v2 (garde admin)', /<html[^>]*class="[^"]*dtp-v3-admin/.test(HADM) && /href="\/css\/v2\/admin\.css\?v=/.test(HADM));
}

// Jeux d'essai de l'écran Marchés : 3 actifs dans le sens du risque, 1 contre (variation × sens).
const RISQUE = { label: 'WEAK RISK-ON', pct: 12.4, description: 'Léger regain d\'appétit pour le risque.', updatedAt: new Date().toISOString(),
  assets: [{ label: 'S&P', chg: 0.8, dir: 1 }, { label: 'AUDJPY', chg: 0.3, dir: 1 }, { label: 'Or', chg: -0.4, dir: -1 }, { label: 'VIX', chg: 2.1, dir: -1 }] };
// Santé des données simulée : une source EN RETARD (rateprobability) et une INDISPONIBLE (COT).
const SANTE = { at: Date.now(), weekend: false, compte: { ok: 5, degrade: 1, panne: 1 }, sources: [
  { groupe: 'Flux', nom: 'Fil d’actualité', age: 120000, etat: 'ok', detail: '812 dépêches en mémoire' },
  { groupe: 'Flux', nom: 'Calendrier économique', age: 3600000, etat: 'ok', detail: '142 événements' },
  { groupe: 'Taux', nom: 'rateprobability (Fed, BCE, BoE, BoJ, BoC, RBA)', age: 40 * 3600000, etat: 'degrade', detail: 'à relire : JPY' },
  { groupe: 'Taux', nom: 'WatchTower (BNS, RBNZ, secours)', age: 7200000, etat: 'ok', detail: '7 banques lues' },
  { groupe: 'Taux', nom: 'CME FedWatch (Fed)', age: 3600000, etat: 'ok', detail: 'réunion 2026-10-28' },
  { groupe: 'Positionnement', nom: 'COT (CFTC, hebdomadaire)', age: null, etat: 'panne', detail: 'aucun rapport lu' },
  { groupe: 'Calculs', nom: 'Force des devises', age: 60000, etat: 'ok', detail: '' } ] };
// Briefing du matin tel que le serveur le sert APRÈS vérification (briefing.js) : faits + points cités.
const BRIEF = { v: 1, jour: '2026-09-24', aujourdhui: true, genereA: Date.now() - 600000, fournisseur: 'gemma', ecartes: 2, total: 9,
  motifs: { sansSource: 1, chiffre: 1, consigne: 0, vide: 0 }, titre: 'Un risk-on prudent avant le PCE américain',
  faits: [{ id: 'F1', txt: 'Régime de risque : Risk-on léger (score 23) · 3 facteurs risk-on, 1 risk-off', source: 'Sentiment de risque (cotations Yahoo Finance)', at: Date.now() - 900000 },
    { id: 'F2', txt: 'Devise la plus forte : GBP (+0,30) ; la plus faible : JPY (−0,21)', source: 'Force des devises (unité TD)', at: Date.now() - 800000 },
    { id: 'F3', txt: '14:30 · USD · Core PCE Price Index MoM (impact fort) · attendu 0.3% · précédent 0.2%', source: 'Calendrier économique', at: Date.now() - 3600000 }],
  synthese: [{ txt: 'Le marché ouvre en risk-on léger.', cites: ['F1'] }],
  sections: [{ titre: 'Devises à suivre', points: [{ txt: 'La livre domine à +0,30 quand le yen cède 0,21.', cites: ['F2'] }] },
    { titre: 'Agenda du jour', points: [{ txt: 'Le Core PCE de 14:30 est attendu à 0,3% après 0,2%.', cites: ['F3'] }] }] };
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

const MAINT = Date.now();
const NEWS = [
  { id: 'n1', headline: 'Fed\'s Waller: another hike is on the table', _titreFr: 'Waller (Fed) : une nouvelle hausse reste sur la table', category: 'Central Banks', timestamp: MAINT - 5 * 6e4, priority: 'high', description: 'Waller said inflation remains too high.' },
  { id: 'n2', headline: 'German Ifo business climate rises to 88.9', category: 'Economic Data', timestamp: MAINT - 12 * 6e4, priority: 'low' },
  { id: 'n3', headline: 'Oil extends gains as supply worries persist', category: 'Commodities', timestamp: MAINT - 40 * 6e4, priority: 'low' },
];
const WRAPS = [{ id: 'w1', source: 'DTP', title: 'London Opening Preparation : le dollar reprend la main', headline: 'London Opening Preparation : le dollar reprend la main', description: 'Le dollar se raffermit avant le PCE.', timestamp: MAINT - 3600e3, tags: ['USD', 'Fed', 'PCE'] }];
const BANQUES = [{ id: 'b1', title: 'FX Weekly : dollar rally masks lingering risks', institution: 'MUFG', timestamp: MAINT - 7200e3, tags: ['EUR/USD', 'USD/JPY'] }];

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
    if (u === '/api/admin/data-health') return SC.role === 'admin' ? j(SANTE) : (rs.writeHead(403), rs.end());
    if (u === '/api/v2/briefing') return SC.role === 'admin' ? j(BRIEF) : (rs.writeHead(403), rs.end());
    // Données des écrans natifs de l'app (V3) : fil, rapports du desk, rapports de banques.
    if (u === '/api/news') return j({ items: NEWS, total: NEWS.length });
    if (u === '/api/session-wraps') return j(WRAPS);
    if (u === '/api/bank-research') return j(BANQUES);
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
      v('… ni bouton Briefing', await page.evaluate(() => !document.querySelector('.v2a-bf-btn')));
      await page.evaluate(() => { try { DTPWidgets.aideDe('force-devises'); } catch (e) {} });
      await new Promise(z => setTimeout(z, 500));
      v('l\'aide d\'un widget reste celle des clients (aucune section V3, aucune pastille Sources)', await page.evaluate(() => !!document.getElementById('wdg-aide') && !document.querySelector('.v2a-src') && !document.querySelector('.v2a-src-pill')));
      await ctx.close();
    }
    console.log('\n── 3. Admin, « Aperçu V2 » désactivé : le desk des clients + l\'interrupteur ──');
    {
      const { page, ctx } = await ouvrir({ role: 'admin', v2: '' }, 390, 844);
      const r = await page.evaluate(() => ({ app: document.documentElement.classList.contains('dtp-app'), inter: !!document.getElementById('v2-interrupteur') }));
      v('l\'interrupteur est dans le volet Profil', r.inter);
      v('l\'interface V2 n\'est pas chargée', !r.app && !vus.some(u => /app\.css|app-mobile|tracabilite/.test(u)), vus.join(', '));
      await ctx.close();
    }
    console.log('\n── 4. Admin, « Aperçu V2 » activé, téléphone : l\'app (écrans natifs, référence Drive) ──');
    {
      const { page, ctx, erreurs } = await ouvrir({ role: 'admin', v2: 'on' }, 390, 844);
      const geo = () => page.evaluate(() => {
        const b = document.querySelector('.v2a-barre'), t = document.querySelector('.v2a-tete'), e = document.querySelector('.v2a-ecran.v2a-visible');
        const rb = b && b.getBoundingClientRect(), rt = t && t.getBoundingClientRect(), re = e && e.getBoundingClientRect();
        return { app: document.documentElement.classList.contains('dtp-app'), onglets: b ? [...b.querySelectorAll('.v2a-onglet')].map(x => x.dataset.v2v).join(',') : '',
          topbar: getComputedStyle(document.querySelector('.topbar')).display, nav: getComputedStyle(document.getElementById('topbar-nav')).display,
          barreBas: rb ? Math.round(rb.bottom) : null, hauteur: innerHeight, hautBarre: rb ? Math.round(rb.top) : null, finTete: rt ? Math.round(rt.bottom) : null,
          ecran: e ? e.dataset.ecran : null, debut: re ? Math.round(re.top) : null, fin: re ? Math.round(re.bottom) : null, titre: document.getElementById('v2a-titre').textContent };
      });
      const r = await geo();
      v('l\'app est active : 5 onglets, le Fil en premier (Fil, Calendrier, Marchés, Analystes, Banques)', r.app && r.onglets === 'fil,calendar,markets,analystes,banques', JSON.stringify(r) + ' · fichiers : ' + vus.join(', '));
      v('l\'ancienne barre du haut et la rangée d\'onglets sont masquées', r.topbar === 'none' && r.nav === 'none');
      v('la barre d\'onglets est collée au bas de l\'écran', r.barreBas === r.hauteur);
      v('l\'app s\'ouvre sur le Fil en direct, logé ENTRE l\'en-tête et la barre', r.ecran === 'fil' && r.titre === 'Fil en direct' && Math.abs(r.debut - r.finTete) <= 1 && Math.abs(r.fin - r.hautBarre) <= 1, JSON.stringify(r));
      v('… Mon Desk (grand écran) ne se rouvre pas tout seul', await page.evaluate(() => document.getElementById('view-widgets').classList.contains('hidden')));
      v('… zoom verrouillé comme une app (pincement et double-tap coupés)', await page.evaluate(() => /maximum-scale=1/.test(document.querySelector('meta[name=viewport]').content) && /user-scalable=no/.test(document.querySelector('meta[name=viewport]').content)));
      /* 25/09 : le Calendrier remplace Macro dans la barre ; le Briefing du matin passe en tête du Fil,
         et l'écran Macro reste ouvert depuis « Tous les outils » (Publications DTP). */
      await page.click('.v2a-onglet[data-v2v="calendar"]');
      await new Promise(z => setTimeout(z, 900));
      v('onglet Calendrier : la vue Calendrier du desk, onglet allumé, sans bouton Retour', await page.evaluate(() => !document.getElementById('view-calendar').classList.contains('hidden')
        && document.querySelector('.v2a-onglet.v2a-actif').dataset.v2v === 'calendar' && document.getElementById('v2a-retour').hidden && document.getElementById('v2a-titre').textContent === 'Calendrier'));
      await page.click('.v2a-onglet[data-v2v="fil"]');
      await new Promise(z => setTimeout(z, 900));
      v('la carte « Briefing du matin » en tête du Fil (V3)', await page.evaluate(() => { const c = document.getElementById('v2a-bf-carte'); return !!c && /Un risk-on prudent/.test(c.innerText) && c.parentElement.dataset.ecran === 'fil'; }));
      v('l\'écran Macro reste accessible depuis « Tous les outils »', await page.evaluate(() => !!document.querySelector('.v2a-feuille [data-v2v="macro"]')));
      const aller = async sel => { await page.click(sel); await new Promise(z => setTimeout(z, 500)); };
      // Captures sur demande (V2_CAPTURES=dossier) : pour juger l'app À L'ŒIL, pas seulement au banc.
      const capture = async nom => { if (process.env.V2_CAPTURES) await page.screenshot({ path: path.join(process.env.V2_CAPTURES, 'app-' + nom + '.png') }); };
      await capture('macro');
      // Le fil du desk arrive par WebSocket (absent du banc) : on lui livre les dépêches par SON
      // gestionnaire de messages, le chemin réel — l'écran Fil doit les montrer sans rien d'autre.
      await page.evaluate(items => { try { handleMessage({ type: 'initial', items, total: items.length }); } catch (e) {} }, NEWS);
      await aller('.v2a-onglet[data-v2v="fil"]');
      const f = await page.evaluate(() => ({ puces: document.querySelectorAll('#v2a-puces-fil button').length, lignes: document.querySelectorAll('#v2a-fil .v2a-news').length,
        desk: (() => { try { return getFilteredItems().length; } catch (e) { return -1; } })(), fr: [...document.querySelectorAll('#v2a-fil .v2a-news p')].some(p => /Waller \(Fed\) : une nouvelle hausse/.test(p.textContent)),
        imp: !!document.querySelector('#v2a-fil .v2a-news.v2a-imp'), titre: document.getElementById('v2a-titre').textContent,
        ids: (() => { try { return getFilteredItems().slice(0, 4).map(i => i.id + ':' + (i._titreFr ? 'fr' : '') + ':' + i.priority); } catch (e) { return String(e); } })() }));
      v('Fil : natif, les MÊMES dépêches que le fil du desk (getFilteredItems)', f.lignes > 0 && f.lignes === Math.min(60, f.desk) && f.titre === 'Fil en direct', JSON.stringify(f));
      const acc = await page.evaluate(() => { try {
        const it = getFilteredItems().slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 30);
        const dom = [...document.querySelectorAll('#v2a-fil .v2a-news')];
        return { n: it.length, titres: it.every((x, i) => dom[i] && dom[i].dataset.id === String(x.id) && dom[i].querySelector('p').textContent === _newsDisplayTitle(x)),
                 imp: it.every((x, i) => dom[i] && dom[i].classList.contains('v2a-imp') === !!_estNewsRouge(x)) };
      } catch (e) { return { err: String(e) }; } });
      v('… chaque ligne porte le titre AFFICHÉ par le desk (traduction comprise) et son importance, puces Tout / Essentiel / Importantes', acc.n > 0 && acc.titres && acc.imp && f.puces === 3, JSON.stringify(acc));
      await capture('fil');
      await aller('#v2a-puces-fil [data-mode="essentiel"]');
      v('… « Essentiel » bascule le vrai filtre du fil (fonction existante)', await page.evaluate(() => { try { return newsEssentialMode === true && document.querySelector('#v2a-puces-fil [data-mode="essentiel"]').classList.contains('v2a-puce-on'); } catch (e) { return false; } }));
      await aller('#v2a-puces-fil [data-mode="tout"]');
      await page.click('#v2a-fil .v2a-news[data-ouvrable]');
      await new Promise(z => setTimeout(z, 500));
      // Depuis le 25/09 la ligne reprend les tags et le panneau du desk : le corps déplié
      // (.v2a-news-corps) reçoit le contenu du panneau Info / Analyse / Impact marché du desk.
      // L'ancien corps (.v2a-news-desc) ne reste qu'en repli, quand le desk est indisponible.
      v('… « + » déplie le texte de la dépêche (le panneau du desk)', await page.evaluate(() => {
        const n = document.querySelector('#v2a-fil .v2a-news[data-ouvrable]');
        const c = n && (n.querySelector('.v2a-news-corps') || n.querySelector('.v2a-news-desc'));
        return !!(c && n.classList.contains('v2a-ouvert') && getComputedStyle(c).display !== 'none' && c.textContent.trim().length > 10);
      }));
      v('… tags du desk en français, jamais le tag brut du serveur', await page.evaluate(() => {
        const t = [...document.querySelectorAll('#v2a-fil .v2a-tags .tag')].map(x => x.textContent.trim());
        return t.length > 0 && !t.some(x => /^(Geopolitical|Oil|Energy|Data|Rates|Metals|Gold|Risk)$/.test(x));
      }));
      await aller('.v2a-onglet[data-v2v="markets"]');
      await new Promise(z => setTimeout(z, 600));
      const m = await page.evaluate(() => ({ visible: !!document.querySelector('.v2a-ecran[data-ecran="markets"].v2a-visible'),
        ordre: [...document.querySelectorAll('.v2a-force-nom b')].map(b => b.textContent).join(','),
        lib: (document.querySelector('.v2a-risque-lib') || {}).textContent, cpt: (document.querySelector('.v2a-risque-cpt') || {}).textContent,
        source: (document.querySelector('#v2a-risque .v2a-source') || {}).textContent, titre: document.getElementById('v2a-titre').textContent, outils: document.querySelectorAll('.v2a-outils .v2a-tuile').length }));
      v('onglet Marchés → sentiment de risque + force des devises + outils du desk', m.visible && m.titre === 'Marchés' && m.outils >= 6, JSON.stringify(m));
      v('… les 8 devises, de la plus forte à la plus faible', m.ordre === 'GBP,USD,CAD,AUD,EUR,CHF,NZD,JPY', m.ordre);
      v('… le régime de risque traduit, avec le décompte réel des facteurs (3 / 1)', m.lib === 'Risk-on léger' && /Risk-on : 3 · Risk-off : 1/.test(m.cpt), m.lib + ' · ' + m.cpt);
      v('… et sa source nommée (traçabilité)', /4 actifs suivis · cotations Yahoo Finance/.test(m.source || ''), m.source);
      await capture('marches');
      /* ÉCRAN DÉCALÉ AU DOIGT (25/09, capture : Marchés glissé de 110 px). Un conteneur en
         overflow-y:auto défile AUSSI en X : il suffisait d'un encart de 2 px de trop. */
      const mx = await page.evaluate(() => { const e = document.querySelector('.v2a-ecran[data-ecran="markets"].v2a-visible'); return e ? { sw: e.scrollWidth, cw: e.clientWidth, ox: getComputedStyle(e).overflowX } : null; });
      v('Marchés ne se décale pas latéralement (axe X verrouillé, rien ne dépasse)', mx && mx.ox === 'hidden' && mx.sw <= mx.cw + 1, JSON.stringify(mx));
      await aller('.v2a-outils .v2a-tuile[data-v2v="taux"]');
      const t = await page.evaluate(() => ({ vue: !document.getElementById('view-taux').classList.contains('hidden'), ecran: !!document.querySelector('.v2a-ecran.v2a-visible'), retour: !document.getElementById('v2a-retour').hidden, onglet: ((document.querySelector('.v2a-onglet.v2a-actif') || {}).dataset || {}).v2v }));
      v('un outil ouvre la VRAIE vue du desk, avec un bouton Retour, et Marchés reste allumé', t.vue && !t.ecran && t.retour && t.onglet === 'markets', JSON.stringify(t));
      await aller('#v2a-retour');
      v('… Retour ramène à l\'écran Marchés', await page.evaluate(() => !!document.querySelector('.v2a-ecran[data-ecran="markets"].v2a-visible') && document.getElementById('v2a-retour').hidden));
      await aller('#v2a-detail');
      v('« Colonne Marchés du desk » ouvre la colonne du desk, intacte', await page.evaluate(() => document.getElementById('main-layout').classList.contains('show-right-mobile') && !document.querySelector('.v2a-ecran.v2a-visible')));
      await aller('.v2a-onglet[data-v2v="analystes"]');
      await new Promise(z => setTimeout(z, 2800));
      const an = await page.evaluate(() => ({ titres: [...document.querySelectorAll('.v2a-rapport-t')].map(x => x.textContent).slice(0, 4), n: (() => { try { return getArlibItems().length; } catch (e) { return String(e); } })(), sw: (() => { try { return _sessionWraps.length; } catch (e) { return String(e); } })() }));
      v('onglet Analystes → la liste des rapports en cartes (même liste que l\'onglet du desk)', an.titres.some(x => /le dollar reprend la main/.test(x)), JSON.stringify(an));
      await capture('analystes');
      await aller('.v2a-onglet[data-v2v="banques"]');
      await new Promise(z => setTimeout(z, 2800));
      v('onglet Banques → les rapports de banques en cartes, banque et date', await page.evaluate(() => { const c = document.querySelector('.v2a-banque'); return !!c && /MUFG/.test(c.innerText) && /FX Weekly/.test(c.innerText); }));
      await capture('banques');
      await aller('#v2a-alertes');
      await new Promise(z => setTimeout(z, 400));
      await capture('alertes');
      const al = await page.evaluate(() => ({ ouverte: !!document.querySelector('.v2a-alertes.v2a-ouverte'), filtres: [...document.querySelectorAll('.v2a-seg button')].map(b => b.textContent).join(','), deskOuvert: document.getElementById('np-panel') && document.getElementById('np-panel').classList.contains('open') }));
      v('la cloche ouvre la feuille Alertes : Tout · Rapports · Actu · Calendrier, sans ouvrir le panneau du desk', al.ouverte && al.filtres === 'Tout,Rapports,Actu,Calendrier' && !al.deskOuvert, JSON.stringify(al));
      await aller('.v2a-alertes .v2a-x');
      await aller('#v2a-compte');
      const cp = await page.evaluate(() => ({ ecran: ((document.querySelector('.v2a-ecran.v2a-visible') || {}).dataset || {}).ecran, sortie: !!document.querySelector('.v2a-sortie'), mail: /x@y\.z/.test((document.querySelector('.v2a-profil') || {}).innerText || ''), retour: !document.getElementById('v2a-retour').hidden }));
      v('le bouton compte ouvre l\'écran Compte (profil, sections, déconnexion) avec Retour', cp.ecran === 'compte' && cp.sortie && cp.mail && cp.retour, JSON.stringify(cp));
      await capture('compte');
      const lg = await page.evaluate(() => { const c = document.querySelector('.v2a-langue-choix'); return c ? [...c.options].map(o => o.value + (o.selected ? '*' : '')).join(',') + '|' + document.querySelectorAll('.v2a-langue').length : ''; });
      v('Compte propose la langue en UNE ligne à liste déroulante (même réglage que le desk)', lg === 'fr*,en,de,es|1', lg);
      /* L'ACCUEIL DU DESK NE COUVRE JAMAIS L'APP (25/09, « rien ne s'affiche » dans Banques/Analystes) :
         body.home-mode masque toutes les vues du desk ; l'app doit le lever dès qu'il apparaît. */
      await page.evaluate(() => { document.body.classList.add('home-mode'); const d = document.createElement('div'); d.id = 'dtp-home'; document.body.appendChild(d); });
      await new Promise(z => setTimeout(z, 200));
      v('l\'accueil du desk est levé dans l\'app (sinon les vues du desk restent invisibles)', await page.evaluate(() => !document.body.classList.contains('home-mode') && !document.getElementById('dtp-home')));
      await page.evaluate(() => window.activateView('news'));
      await new Promise(z => setTimeout(z, 300));
      v('une navigation faite ailleurs (activateView) resynchronise la barre', await page.evaluate(() => (document.querySelector('.v2a-onglet.v2a-actif') || {}).dataset.v2v === 'fil'));
      v('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
      await ctx.close();
    }
    console.log('\n── 5. Admin, V2 activée, grand écran : l\'app s\'efface ──');
    {
      const { page, ctx } = await ouvrir({ role: 'admin', v2: 'on' }, 1400, 900);
      const r = await page.evaluate(() => ({ app: document.documentElement.classList.contains('dtp-app'), topbar: getComputedStyle(document.querySelector('.topbar')).display }));
      v('au-delà d\'un téléphone : desk normal', !r.app && r.topbar !== 'none', JSON.stringify(r));
      const hab = await page.evaluate(() => { const g = document.getElementById('wdg-grid'), t = document.querySelector('.wdg-title'), c = document.querySelector('.wdg-card');
        return { puce: !!document.querySelector('.topbar .v3-puce'), gap: g ? getComputedStyle(g).columnGap : null, casse: t ? getComputedStyle(t).textTransform : null, rang: c ? c.style.getPropertyValue('--v3i') : null }; });
      v('habillage V3 du desk : puce V3, cartes collées (1 px), titres en casse normale, apparition échelonnée', hab.puce && hab.gap === '1px' && hab.casse === 'none' && hab.rang !== '', JSON.stringify(hab));

      console.log('\n── 6. V3 · traçabilité en direct (admin, V2 activée) ──');
      const p = await page.evaluate(() => [...document.querySelectorAll('.v2a-src-pill')].map(b => ({ v: b.dataset.vue, c: getComputedStyle(b.querySelector('i')).backgroundColor })));
      v('une pastille « Sources » sur les 4 grandes vues (Fil, Taux, Biais, Semaine)', p.length === 4 && ['view-news', 'view-taux', 'view-bias', 'view-weekahead'].every(x => p.some(y => y.v === x)), JSON.stringify(p));
      const coul = x => (p.find(y => y.v === x) || {}).c;
      v('… couleur de la source la PLUS en retard : Fil vert, Taux orange (rateprobability en retard), Biais rouge (COT indisponible)',
        coul('view-news') === 'rgb(34, 197, 94)' && coul('view-taux') === 'rgb(255, 179, 0)' && coul('view-bias') === 'rgb(239, 68, 68)', JSON.stringify(p));
      await page.evaluate(() => { document.querySelector('#view-taux .v2a-src-pill').click(); });
      await new Promise(z => setTimeout(z, 400));
      const pop = await page.evaluate(() => { const x = document.getElementById('v2a-src-pop'); return x ? x.innerText : ''; });
      v('… un clic ouvre le détail : les sources RÉELLES de la vue, leur état et leur âge', /rateprobability/.test(pop) && /En retard · il y a 40 h/.test(pop) && /WatchTower/.test(pop) && !/COT/.test(pop), pop.replace(/\n/g, ' | '));
      await page.evaluate(() => { try { DTPWidgets.aideDe('force-devises'); } catch (e) {} });
      await new Promise(z => setTimeout(z, 600));
      const aide = await page.evaluate(() => { const x = document.querySelector('#wdg-aide .v2a-src'); return x ? x.innerText : ''; });
      v('l\'aide d\'un widget gagne « État de la source, en direct » (Force des devises : à jour)', /État de la source, en direct/i.test(aide) && /Force des devises/.test(aide) && /À jour · il y a 1 min/.test(aide), aide.replace(/\n/g, ' | '));
      await page.evaluate(() => { try { DTPWidgets.aideDe('horloge'); } catch (e) {} });
      await new Promise(z => setTimeout(z, 600));
      v('… et RIEN pour un widget dont la source n\'est pas suivie (jamais un vert de complaisance)', await page.evaluate(() => !document.querySelector('#wdg-aide .v2a-src')));

      console.log('\n── 7. V3 · briefing du matin sourcé (admin, V2 activée) ──');
      await page.evaluate(() => { const a = document.getElementById('wdg-aide-ov'); if (a) a.click(); if (window.activateView) activateView('news'); });
      await new Promise(z => setTimeout(z, 400));
      v('un bouton « Briefing » dans l\'en-tête du Fil', await page.evaluate(() => !!document.querySelector('#view-news .v2a-bf-btn')));
      await page.evaluate(() => document.querySelector('#view-news .v2a-bf-btn').click());
      await new Promise(z => setTimeout(z, 600));
      const bf = await page.evaluate(() => { const c = document.querySelector('.v2a-bf-corps'); return c ? { t: c.innerText, cites: c.querySelectorAll('.v2a-bf-cite').length, fiche: c.querySelectorAll('.v2a-bf-fiche li').length } : null; });
      v('la feuille s\'ouvre : titre, points, et une citation cliquable par source utilisée', bf && /Un risk-on prudent/.test(bf.t) && bf.cites === 3 && bf.fiche === 3, JSON.stringify(bf));
      v('… la sévérité du contrôle est affichée (points écartés)', bf && /2 points écartés à la vérification/.test(bf.t));
      await page.evaluate(() => document.querySelector('.v2a-bf-cite[data-f="F2"]').click());
      await new Promise(z => setTimeout(z, 300));
      const bu = await page.evaluate(() => { const b = document.getElementById('v2a-bf-bulle'); return b ? b.innerText : ''; });
      v('… un clic sur une citation montre le FAIT exact, sa source et son heure', /GBP \(\+0,30\)/.test(bu) && /Force des devises \(unité TD\)/.test(bu), bu.replace(/\n/g, ' | '));
      await page.keyboard.press('Escape');
      v('Échap referme la feuille', await page.evaluate(() => !document.getElementById('v2a-bf')));
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

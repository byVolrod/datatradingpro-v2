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
    .replace(/@(media|container)[^{]+\{/g, '').split('}').map(b => b.split('{')[0].trim()).filter(Boolean);
  const horsD = [];
  rd.forEach(sel => sel.split(',').map(x => x.trim()).filter(Boolean).forEach(x => { if (!/^html\.dtp-v2\b/.test(x)) horsD.push(x); }));
  v('chaque sélecteur de l\'habillage V3 du desk est borné (html.dtp-v2)', rd.length > 20 && horsD.length === 0, horsD.slice(0, 5).join(' | '));
  /* 25/09 (« fenêtre rétrécie sur PC, j'ai pas compris pourquoi c'est différent ») : l'habillage vit
     dans un @media « desk » — grand écran OU pointeur non tactile. Un PC étroit reste un desk ; seul
     un écran TACTILE de téléphone passe à l'app, qui garde sa propre feuille. Les trois endroits qui
     en décident doivent dire la même chose, sinon l'un habille ce que l'autre a déjà remplacé. */
  const DJS = fs.readFileSync(path.join(R, 'public/js/v2/desk.js'), 'utf8');
  const APPJ = fs.readFileSync(path.join(R, 'public/js/v2/app-mobile.js'), 'utf8');
  v('… et vit dans un @media « desk » : grand écran OU pointeur non tactile', /^\s*@media \(min-width: 821px\), not all and \(pointer: coarse\) \{/m.test(DESK.replace(/\/\*[\s\S]*?\*\//g, '')));
  v('… desk.js suit la même condition que la feuille', /matchMedia\('\(min-width: 821px\), not all and \(pointer: coarse\)'\)/.test(DJS));
  v('l\'app mobile ne s\'ouvre que sur un écran TACTILE étroit (jamais un PC à fenêtre étroite)', /var MQ = window\.matchMedia\('\(max-width: 820px\) and \(pointer: coarse\)'\);/.test(APPJ)
    && /innerWidth <= 820 && matchMedia\('\(pointer: coarse\)'\)\.matches/.test(fs.readFileSync(path.join(R, 'public/js/v2/boot.js'), 'utf8'))
    && /window\.innerWidth<=820&&matchMedia\('\(pointer: coarse\)'\)\.matches/.test(IDX));
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

/* LES CHIFFRES VIVENT (25/09) : un chiffre de widget qui change en place s'allume dans le SENS du
   mouvement. Le sens n'est juste que si le nombre est lu comme il s'affiche (« 1,2345 » ≠ 12345). */
{
  const DSK = fs.readFileSync(path.join(R, 'public/js/v2/desk.js'), 'utf8');
  const m = /  var nbDe = function \(t\) \{[\s\S]*?\n  \};/.exec(DSK);
  v('desk.js lit les chiffres qui bougent (nbDe extractible)', !!m);
  if (m) {
    const nbDe = new Function(m[0] + ' return nbDe;')();
    const cas = [['1,2345', 1.2345], ['1 234,5', 1234.5], ['1,234,567', 1234567], ['1.2345', 1.2345], ['-0,42%', -0.42], ['2 654,30', 2654.3]];
    const faux = cas.filter(c => nbDe(c[0]) !== c[1]);
    v('… « 1,2345 », « 1 234,5 », « 1,234,567 », « -0,42% » lus comme ils s’affichent', !faux.length, JSON.stringify(faux));
    v('… et le flash est branché sur la grille, borné au grand écran', /new MutationObserver\(vivre\)/.test(DSK) && /MQ_DESK\.matches/.test(DSK));
  }
}

/* WIDGETS DE MARCHÉ EN DIRECT (25/09, « on dirait un truc figé ; je veux du temps réel, comme PMT »).
   Hauts / bas, Taux US, Vol. horaire, Variations reçoivent une présentation V3 par le crochet
   `DTPWidgets.v3Montage`. Ce qu'on garde ici : le crochet ne peut rien changer pour un client, et
   l'heure de Paris est lue juste — la première version lisait « 14 h » en nombre (NaN) et
   rangeait toute la journée dans une seule case de l'histogramme horaire. */
{
  const WJS = fs.readFileSync(path.join(R, 'public/js/widgets.js'), 'utf8');
  const W3 = fs.readFileSync(path.join(R, 'public/js/v2/widgets-v3.js'), 'utf8');
  const BOOT = fs.readFileSync(path.join(R, 'public/js/v2/boot.js'), 'utf8');
  v('boot.js charge le module des widgets en direct', /\/js\/v2\/widgets-v3\.js/.test(BOOT));
  const h = (/v3Montage: function \(id, fn\) \{[\s\S]*?\n    \},/.exec(WJS) || [''])[0];
  v('widgets.js expose le crochet v3Montage', !!h);
  v('… hors html.dtp-v2, c\'est le montage d\'ORIGINE qui s\'exécute', /if \(!document\.documentElement\.classList\.contains\('dtp-v2'\)\) return orig\.call\(w, host, it\)/.test(h));
  v('… une exception au montage V3 retombe sur l\'origine', /catch \(e\) \{[^}]*\} repli\(\); \}/.test(h) || /\} repli\(\);/.test(h));
  v('… et le nettoyage rend AUSSI celui du repli (aucun minuteur orphelin)', /if \(unOrig\) unOrig\(\)/.test(h));
  const ids = ((/var MONTAGES = \{([^}]*)\}/.exec(W3) || [])[1] || '').match(/'([a-z-]+)'/g) || [];
  const absents = ids.map(x => x.replace(/'/g, '')).filter(id => !new RegExp("id: '" + id + "'").test(WJS));
  v('les widgets surchargés (dont les Horaires des marchés) existent au catalogue', ids.length >= 5 && /'?sessions'?/.test(ids.join(' ')) && !absents.length, ids.join(' ') + (absents.length ? ' · absents : ' + absents : ''));
  /* UNE ICÔNE PAR ONGLET, en V3 seulement : la barre des clients garde son chevron. */
  const ti = (/function _tabIconV3\(w, estGrille\) \{[\s\S]*?\n  \}/.exec(WJS) || [''])[0];
  v('onglets : icône par défaut réservée à html.dtp-v2, jamais enregistrée', /if \(!document\.documentElement\.classList\.contains\('dtp-v2'\)\) return '';/.test(ti) && !/tabIcons/.test(ti));
  /* NEURO-ONDES : 48 pistes, trois familles, et chaque fréquence dans la plage de sa famille. */
  const NE = fs.readFileSync(path.join(R, 'public/js/v2/neuro.js'), 'utf8');
  v('boot.js charge Neuro-ondes', /\/js\/v2\/neuro\.js/.test(BOOT));
  const fams = [...NE.matchAll(/\{ k: '(conc|crea|rel)', nom: '([^']+)', hz: \[([^\]]+)\][\s\S]*?noms: \[([\s\S]*?)\] \}/g)]
    .map(m => ({ k: m[1], hz: m[3].split(',').map(Number), noms: (m[4].match(/'[^']+'/g) || []) }));
  const plage = { conc: [13, 41], crea: [8, 12], rel: [4, 7] };
  v('Neuro-ondes : trois familles de seize pistes', fams.length === 3 && fams.every(f => f.noms.length === 16), fams.map(f => f.k + ':' + f.noms.length).join(' '));
  const tous = fams.reduce((a, f) => a.concat(f.noms), []);
  v('… 48 noms tous différents', new Set(tous).size === 48 && tous.length === 48);
  v('… chaque fréquence dans la plage de sa famille (bêta/gamma, alpha, thêta)', fams.every(f => f.hz.every(h => h >= plage[f.k][0] && h <= plage[f.k][1])), JSON.stringify(fams.map(f => [f.k, f.hz])));
  /* requestAnimationFrame passe un horodatage : appelée directement, la fonction de dessin le prenait
     pour « figer », et le visualiseur restait plat (trouvé au rendu le 25/09). */
  v('… le visualiseur passe par un relais sans argument', !/requestAnimationFrame\(dessinerOnde\)/.test(NE) && /function boucle\(\) \{ dessinerOnde\(false\); \}/.test(NE));
  const hp = /  var _fmtH = null;\n  var heureParis = function \(t\) \{[\s\S]*?\n  \};/.exec(W3);
  v('l\'heure de Paris est extractible', !!hp);
  if (hp) {
    const heureParis = new Function(hp[0] + ' return heureParis;')();
    const ete = heureParis(Date.UTC(2026, 8, 25, 12, 30)), hiver = heureParis(Date.UTC(2026, 11, 1, 12, 30)), minuit = heureParis(Date.UTC(2026, 8, 25, 22, 10));
    v('… 12 h 30 UTC = 14 h l\'été, 13 h l\'hiver, et 22 h 10 UTC = 0 h (jamais NaN, jamais 24)', ete === 14 && hiver === 13 && minuit === 0, ete + ' / ' + hiver + ' / ' + minuit);
  }
  v('… et plus jamais lue en nombre depuis le format français (« 14 h » → NaN)', !/\+new Intl\.DateTimeFormat\('fr-FR'/.test(W3));
}

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
  // Trois propos d'un même orateur (capture du 25/09 : le tag Info ne s'ouvrait pas dans l'app).
  { id: 'sp1', headline: "Fed's Schmid: Question is whether AI ecosystem becomes too big to fail", _titreFr: "Fed's Schmid: La question est de savoir si l'écosystème de l'IA devient trop grand pour échouer.", category: 'Fed', tags: ['US'], timestamp: MAINT - 50 * 6e4, priority: 'low' },
  { id: 'sp2', headline: "Fed's Schmid: Fed still hasn't solved inflation problem", category: 'Fed', tags: ['US'], timestamp: MAINT - 56 * 6e4, priority: 'low' },
  { id: 'sp3', headline: "Fed's Schmid: US debt looks extreme", category: 'Fed', tags: ['US'], timestamp: MAINT - 56 * 6e4 - 1000, priority: 'low' },
];
const WRAPS = [{ id: 'w1', source: 'DTP', title: 'London Opening Preparation : le dollar reprend la main', headline: 'London Opening Preparation : le dollar reprend la main', description: 'Le dollar se raffermit avant le PCE.', timestamp: MAINT - 3600e3, tags: ['USD', 'Fed', 'PCE'] }];
// Bougies et rendements de synthèse (marche déterministe), pour les widgets en direct (§ 8).
const BOUGIES = (tf) => {
  const pas = { M15: 9e5, H1: 36e5, D1: 864e5, W1: 6048e5 }[tf] || 864e5, n = { M15: 480, H1: 1500, D1: 400, W1: 120 }[tf] || 100;
  const vol = { M15: 0.0006, H1: 0.0012, D1: 0.016, W1: 0.03 }[tf] || 0.01;
  let x = 1.17, s = 7, out = []; const t0 = Math.floor(MAINT / pas) * pas - (n - 1) * pas;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let i = 0; i < n; i++) { const t = t0 + i * pas, o = x, c = x + rnd() * vol; out.push({ t, o, h: Math.max(o, c) + Math.abs(rnd()) * vol * .5, l: Math.min(o, c) - Math.abs(rnd()) * vol * .5, c }); x = c; }
  const dx = 1.1712 - out[out.length - 1].c; return out.map(b => ({ t: b.t, o: b.o + dx, h: b.h + dx, l: b.l + dx, c: b.c + dx }));
};
const TAUX = (() => { const s = {}; for (const [k, b] of [['m3', 4.05], ['y5', 3.72], ['y10', 4.12], ['y30', 4.71]]) { const h = []; let v = b; for (let i = 0; i < 90; i++) { v += Math.sin(i / 7) * 0.01; h.push({ t: MAINT - (89 - i) * 864e5, v: +v.toFixed(3) }); } s[k] = { lbl: k, last: h[89].v, hist: h }; } return { ok: true, series: s }; })();
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
    if (u === '/api/push-prefs' && rq.method === 'GET') return j({ ok: true, prefs: { cats: ['news', 'eco', 'risque', 'banques', 'analystes'], son: true, vibreur: true, fil: 'tout', recaps: 'tous', banques: [] },
      banquesDispo: ['Goldman Sachs', 'ING'], familles: [{ k: 'news', nom: 'Actualités majeures', desc: '' }, { k: 'eco', nom: 'Calendrier économique', desc: '' }, { k: 'risque', nom: 'Sentiment de risque', desc: '' }, { k: 'banques', nom: 'Rapports de banques', desc: '' }, { k: 'analystes', nom: 'Récaps et rapports d’analystes', desc: '' }] });
    if ((u === '/api/push-prefs' || u === '/api/auth/me/profile' || u === '/api/auth/me/password') && rq.method !== 'GET') {
      let corps = ''; rq.on('data', c => { corps += c; }); rq.on('end', () => { (global.__envois = global.__envois || []).push({ u, corps });
        j(u === '/api/auth/me/profile' ? { ok: true, name: (JSON.parse(corps || '{}').name || '') } : { ok: true }); }); return; }
    if (u === '/api/risk-sentiment') return j(RISQUE);
    if (u === '/api/currency-strength') return j(FORCE);
    if (u === '/api/admin/data-health') return SC.role === 'admin' ? j(SANTE) : (rs.writeHead(403), rs.end());
    if (u === '/api/v2/briefing') return SC.role === 'admin' ? j(BRIEF) : (rs.writeHead(403), rs.end());
    // Données des écrans natifs de l'app (V3) : fil, rapports du desk, rapports de banques.
    if (u === '/api/news') return j({ items: NEWS, total: NEWS.length });
    if (u === '/api/session-wraps') return j(WRAPS);
    if (u === '/api/bank-research') return j(BANQUES);
    if (u === '/api/bank-ohlc') { const tf = new URL('http://x' + rq.url).searchParams.get('tf'); return j({ candles: BOUGIES(tf) }); }
    if (u === '/api/us-yields') return j(TAUX);
    base.emit('request', rq, rs);
  });
  await new Promise(r => srv.listen(4873, r));
  const nav = await pp.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ouvrir = async (sc, w, h, tactile) => {
    if (tactile === undefined) tactile = w < 800;
    SC = sc; vus.length = 0;
    const ctx = await nav.createBrowserContext();
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    await page.setViewport({ width: w, height: h, isMobile: tactile, hasTouch: tactile, deviceScaleFactor: 1 });
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
        desk: (() => { try { return _groupSpeakerQuotes(getFilteredItems().slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))).length; } catch (e) { return -1; } })(), fr: [...document.querySelectorAll('#v2a-fil .v2a-news p')].some(p => /Waller \(Fed\) : une nouvelle hausse/.test(p.textContent)),
        imp: !!document.querySelector('#v2a-fil .v2a-news.v2a-imp'), titre: document.getElementById('v2a-titre').textContent,
        ids: (() => { try { return getFilteredItems().slice(0, 4).map(i => i.id + ':' + (i._titreFr ? 'fr' : '') + ':' + i.priority); } catch (e) { return String(e); } })() }));
      v('Fil : natif, les MÊMES dépêches que le fil du desk (getFilteredItems, propos regroupés comme au desk)', f.lignes > 0 && f.lignes === Math.min(60, f.desk) && f.titre === 'Fil en direct', JSON.stringify(f));
      const acc = await page.evaluate(() => { try {
        const it = _groupSpeakerQuotes(getFilteredItems().slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))).slice(0, 30);
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
      /* PROPOS D'UN ORATEUR (25/09, « je tape sur le tag Info, il s'affiche pas ») : regroupés sous une
         seule carte comme au desk, et leur tag Info OUVRE la liste des propos. */
      const sp = await page.evaluate(async () => {
        const c = document.querySelector('#v2a-fil .v2a-news[data-id="sp1"]');
        const r = { carte: !!c, seuls: !document.querySelector('#v2a-fil .v2a-news[data-id="sp2"]') && !document.querySelector('#v2a-fil .v2a-news[data-id="sp3"]') };
        const b = c && c.querySelector('[data-onglet="info"]');
        r.info = !!b;
        // Un contrôle précédent a pu déjà ouvrir cette carte : on part d'une carte FERMÉE, sans quoi
        // le toucher la refermerait et le contrôle mesurerait l'inverse de ce qu'il croit.
        if (b && c.classList.contains('v2a-ouvert')) { b.click(); await new Promise(z => setTimeout(z, 300)); }
        const b2 = document.querySelector('#v2a-fil .v2a-news[data-id="sp1"] [data-onglet="info"]');
        r.fermeAvant = !document.querySelector('#v2a-fil .v2a-news[data-id="sp1"]').classList.contains('v2a-ouvert');
        if (b2) { b2.click(); await new Promise(z => setTimeout(z, 700)); }
        // L'écran se redessine quand le desk bouge : on relit la carte COURANTE, pas celle d'avant le clic.
        const c2 = document.querySelector('#v2a-fil .v2a-news[data-id="sp1"]');
        const corps = c2 && c2.querySelector('.v2a-news-corps');
        r.ouvert = !!(c2 && c2.classList.contains('v2a-ouvert'));
        r.propos = corps ? corps.querySelectorAll('li').length : 0;
        r.visible = corps ? getComputedStyle(corps).display : null;
        return r;
      });
      v('… les propos d\'un même orateur forment UNE carte, comme au desk', sp.carte && sp.seuls, JSON.stringify(sp));
      v('… et leur tag Info s\'ouvre sur la liste des propos', sp.info && sp.fermeAvant && sp.ouvert && sp.propos === 3 && sp.visible !== 'none', JSON.stringify(sp));
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
      v('… sans la ligne « N actifs suivis · cotations Yahoo Finance » (retirée à la demande, 25/09)', !m.source, m.source);
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
      const cp = await page.evaluate(() => ({ ecran: ((document.querySelector('.v2a-ecran.v2a-visible') || {}).dataset || {}).ecran, sortie: !!document.querySelector('.v2a-sortie'),
        mailEnTete: /x@y\.z/.test((document.querySelector('.v2a-profil') || {}).innerText || ''), retour: !document.getElementById('v2a-retour').hidden,
        photo: !!document.querySelector('.v2a-profil [data-act="photo"] .v2a-profil-cam'), crayon: !!document.querySelector('.v2a-profil [data-act="nom"]'),
        rubriques: [...document.querySelectorAll('.v2a-ecran[data-ecran="compte"] .v2a-rubrique')].map(r => r.firstChild.textContent.trim()).join(',') }));
      v('le bouton compte ouvre l\'écran Compte (profil, sections, déconnexion) avec Retour', cp.ecran === 'compte' && cp.sortie && cp.retour, JSON.stringify(cp));
      // 25/09 : « toucher la photo pour la modifier (montrer que c'est modifiable), le nom modifiable, pas
      // l'e-mail sous le nom ; Profil en premier ; une catégorie à part pour e-mail, mot de passe, nom ».
      v('… la photo porte sa pastille « modifier », le nom son crayon, l\'e-mail a quitté l\'en-tête', cp.photo && cp.crayon && !cp.mailEnTete, JSON.stringify(cp));
      v('… « Profil » vient en premier, puis « Identifiants »', /^Profil,Identifiants/.test(cp.rubriques), cp.rubriques);
      const ed = await page.evaluate(async () => {
        const pause = ms => new Promise(r => setTimeout(r, ms)), ec = document.querySelector('.v2a-ecran[data-ecran="compte"]');
        ec.querySelector('[data-act="nom"]').click(); await pause(120);
        const ch = ec.querySelector('.v2a-profil-ed input'); if (!ch) return { champ: false };
        ch.value = 'Nouveau Nom'; ch.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await pause(400);
        return { champ: true, affiche: (ec.querySelector('.v2a-profil-nom b') || {}).textContent, envoi: (window.__envoisVus || null) };
      });
      const envNom = (global.__envois || []).find(x => x.u === '/api/auth/me/profile');
      v('le nom se modifie sur place et part au serveur', ed.champ && ed.affiche === 'Nouveau Nom' && envNom && /Nouveau Nom/.test(envNom.corps), JSON.stringify(ed) + ' · ' + JSON.stringify(envNom));
      await capture('compte');
      /* COMPTE EN PAGES (25/09, « quand je clique ça ne marche pas ») : chaque ligne du sommaire ouvre
         sa page, et Retour ramène au sommaire (pas à l'onglet d'avant). */
      const cpg = await page.evaluate(async () => {
        const pause = ms => new Promise(r => setTimeout(r, ms)), ec = document.querySelector('.v2a-ecran[data-ecran="compte"]'), out = {};
        for (const p of ['profil', 'nom', 'email', 'mdp', 'fuseau', 'abo', 'notifs', 'prefs', 'langue']) {
          const b = ec.querySelector('[data-act="page:' + p + '"]'); if (!b) { out[p] = 'absente'; continue; }
          b.click(); await pause(150);
          const t = document.getElementById('v2a-titre').textContent, n = ec.querySelectorAll('.v2a-ligne, .v2a-kv, .v2a-form').length;
          document.getElementById('v2a-retour').click(); await pause(150);
          out[p] = t + ':' + (n > 0) + ':' + (document.getElementById('v2a-titre').textContent === 'Compte' && !!ec.querySelector('[data-act="page:fuseau"]'));
        }
        return out;
      });
      v('le sommaire du Compte ouvre ses neuf pages, et Retour y ramène', JSON.stringify(cpg) === JSON.stringify({ profil: 'Profil:true:true', nom: 'Nom affiché:true:true', email: 'Adresse e-mail:true:true', mdp: 'Mot de passe:true:true', fuseau: 'Fuseau horaire:true:true', abo: 'Abonnement:true:true', notifs: 'Notifications:true:true', prefs: 'Préférences:true:true', langue: 'Langue:true:true' }), JSON.stringify(cpg));
      // Notifications : réglages fins sous les familles cochées, étiquette « Nouveau », choix envoyé au compte.
      const nf = await page.evaluate(async () => {
        const pause = ms => new Promise(r => setTimeout(r, ms)), ec = document.querySelector('.v2a-ecran[data-ecran="compte"]');
        ec.querySelector('[data-act="page:notifs"]').click(); await pause(500);
        const fins = [...ec.querySelectorAll('.v2a-seg-b')].map(b => b.textContent);
        const geo = [...ec.querySelectorAll('[data-act="ppfil"]')].find(b => b.dataset.v === 'geo'); if (geo) geo.click(); await pause(300);
        const on = (ec.querySelector('[data-act="ppfil"].on') || {}).dataset;
        const r = { fins, neuf: !!ec.querySelector('.v2a-neuf'), actif: on && on.v, tester: /test/i.test(ec.innerText) };
        document.getElementById('v2a-retour').click(); await pause(150);
        return r;
      });
      const envPP = (global.__envois || []).filter(x => x.u === '/api/push-prefs').pop();
      v('Notifications : type de dépêches, rythme des récaps, banques au choix, sous leur famille', ['Géopolitique', 'Quotidiens', 'Hebdo', 'Goldman Sachs', 'ING'].every(x => nf.fins.includes(x)), JSON.stringify(nf));
      v('… étiquette « Nouveau », plus de notification test', nf.neuf && !nf.tester, JSON.stringify(nf));
      v('… un toucher enregistre le choix sur le compte', nf.actif === 'geo' && envPP && /"fil":"geo"/.test(envPP.corps), envPP && envPP.corps);
      if (process.env.V2_CAPTURES) for (const pg of ['notifs', 'profil', 'mdp']) {
        await page.evaluate(p => document.querySelector('.v2a-ecran[data-ecran="compte"] [data-act="page:' + p + '"]').click(), pg);
        await new Promise(z => setTimeout(z, 350)); await capture('compte-' + pg);
        await page.evaluate(() => document.getElementById('v2a-retour').click()); await new Promise(z => setTimeout(z, 200));
      }
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
    console.log('\n── 4 bis. Admin, V2 activée, PC à fenêtre ÉTROITE (souris, 700 px) : le desk reste le desk ──');
    {
      const { page, ctx, erreurs } = await ouvrir({ role: 'admin', v2: 'on' }, 700, 900, false);
      try { await page.evaluate(() => { if (window.activateView) activateView('widgets'); }); } catch (e) {}
      await new Promise(z => setTimeout(z, 1500));
      const r = await page.evaluate(() => {
        const g = document.getElementById('wdg-grid'), cs = g && getComputedStyle(g);
        const barres = [...document.querySelectorAll('.wdg-card--tabs .wdgt-bar')];
        const t = document.querySelector('.topbar');
        return { app: document.documentElement.classList.contains('dtp-app'), grille: !!g && cs.display === 'grid', defile: cs && cs.overflowY,
          lignes: barres.map(b => { const tabs = [...b.querySelectorAll('.wdgt-tab')].map(x => Math.round(x.getBoundingClientRect().top)); return { n: new Set(tabs).size, retour: b.classList.contains('v3-retour') }; }),
          cachees: barres.map(b => b.scrollWidth > b.clientWidth + 1 && !b.classList.contains('v3-defile')).filter(Boolean).length,
          rognes: barres.map(b => { const c = b.closest('.wdg-card').getBoundingClientRect(); return [...b.querySelectorAll('.wdgt-tab')].filter(x => { const q = x.getBoundingClientRect(); return q.bottom > c.bottom + 1 || q.right > c.right + 1; }).length; }).reduce((a, n) => a + n, 0),
          rangee: [...document.querySelectorAll('#wdg-grid > .wdg-card')].map(c => getComputedStyle(c).gridRowStart),
          barreHaut: t ? Math.round(t.getBoundingClientRect().top) : null };
      });
      v('pas d\'app sur un PC étroit : Mon Desk reste affiché', !r.app && r.grille, JSON.stringify(r));
      v('… le modèle garde ses rangées (aucune carte réduite à sa hauteur de contenu), sans défilement de page', r.rangee.length > 0 && r.rangee.every(x => /span/.test(x)) && r.defile === 'hidden', JSON.stringify(r.rangee) + ' · ' + r.defile);
      v('… chaque barre d\'onglets tient sur UNE ligne, sauf quand elle passe les noms à la ligne, et sans onglet caché ni rogné', r.lignes.length > 0 && r.lignes.every(l => l.n === 1 || l.retour) && r.cachees === 0 && r.rognes === 0, JSON.stringify(r));
      // Réglage « Noms des onglets » : seul l'onglet ouvert garde son nom, les autres restent en icône.
      const nm = await page.evaluate(() => {
        const carte = document.querySelector('#wdg-grid > .wdg-card--tabs'); if (!carte || !window.DTPWidgets || !DTPWidgets.setTabNoms) return { absent: true };
        const idx = [...document.querySelectorAll('#wdg-grid > .wdg-card')].indexOf(carte);
        const noms = () => { const b = document.querySelectorAll('#wdg-grid > .wdg-card')[idx].querySelector('.wdgt-bar'); return [...b.querySelectorAll('.wdgt-tab')].map(t => { const l = t.querySelector('.wdgt-nm'); return { actif: t.classList.contains('on'), vu: !!l && l.getBoundingClientRect().width > 0 }; }); };
        const avant = noms(); DTPWidgets.setTabNoms(idx, 'actif');
        return new Promise(z => setTimeout(() => { const apres = noms(); DTPWidgets.setTabNoms(idx, 'tous'); z({ avant, apres }); }, 400));
      });
      v('… réglage « Noms des onglets » : seul l\'onglet ouvert garde son nom', !nm.absent && nm.apres.length > 1 && nm.apres.filter(t => t.vu).length === 1 && nm.apres.find(t => t.actif && t.vu) && nm.avant.filter(t => t.vu).length > 1, JSON.stringify(nm));
      v('… et la barre du haut reste collée en haut de page', r.barreHaut === 0, String(r.barreHaut));
      v('… aucune erreur de page', !erreurs.length, erreurs.slice(0, 2).join(' | '));
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
      const bf = await page.evaluate(() => { const c = document.querySelector('.v2a-bf-corps'); return c ? { t: c.innerText, cites: c.querySelectorAll('.v2a-bf-cite').length, fiche: c.querySelectorAll('.v2a-bf-fiche, details').length } : null; });
      v('la feuille s\'ouvre : titre et points', bf && /Un risk-on prudent/.test(bf.t), JSON.stringify(bf));
      // 25/09, « enlève les F[X] et la fiche de faits » : le texte seul, la vérification reste au serveur.
      v('… sans repère F1, F2… ni « Fiche de faits »', bf && bf.cites === 0 && bf.fiche === 0 && !/\bF\d+\b/.test(bf.t) && !/fiche de faits|faits sourcés|écarté/i.test(bf.t), JSON.stringify(bf));
      await page.keyboard.press('Escape');
      v('Échap referme la feuille', await page.evaluate(() => !document.getElementById('v2a-bf')));

      console.log('\n── 7 bis. V3 · recherche multi-actifs dans la barre du desk ──');
      // Capture du 25/09 : « sp » → « Aucune paire ». On tape comme un utilisateur, puis on ouvre la fiche.
      const tape = async q => page.evaluate(async q => {
        const i = document.getElementById('topbar-symbol-input'); if (!i) return null;
        i.focus(); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 150));
        const dd = document.getElementById('sym-dd');
        return { txt: dd.innerText, puces: [...dd.querySelectorAll('.sym-dd-puce')].map(b => b.textContent), actifs: [...dd.querySelectorAll('[data-actif]')].map(r => r.dataset.actif), paires: [...dd.querySelectorAll('[data-pair]')].map(r => r.dataset.pair) };
      }, q);
      await page.waitForFunction(() => !!window.DTPRechercheActifs, { timeout: 8000 }).catch(() => {});
      const r1 = await tape('sp');
      v('« sp » trouve le S&P 500, rangé en Indices, avec la barre de filtres', r1 && r1.actifs[0] === 'US500' && /Indices/.test(r1.txt) && r1.puces.join() === 'Tout,Forex,Indices,Actions,Métaux,Énergie,Crypto' && !/Aucune paire/.test(r1.txt), JSON.stringify(r1));
      const r2 = await tape('eurusd');
      v('… une paire de devises reste en tête, dans « Forex »', r2 && r2.paires[0] === 'EURUSD' && /Forex/.test(r2.txt), JSON.stringify(r2 && r2.paires));
      const r3 = await tape('xau');
      v('… l\'or se range en Métaux (et une seule fois)', r3 && r3.actifs.includes('XAUUSD') && !r3.paires.includes('XAUUSD'), JSON.stringify(r3));
      await tape('aapl');
      await page.evaluate(() => { const r = document.querySelector('#sym-dd [data-actif="AAPL"]'); if (r) r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
      await new Promise(z => setTimeout(z, 400));
      const fi = await page.evaluate(() => { const f = document.getElementById('v3a-fiche'); return f ? { titre: (f.querySelector('.v3a-fiche-t b') || {}).textContent, classe: (f.querySelector('.v3a-fiche-cl') || {}).textContent, graph: !!f.querySelector('#v3a-fiche-tv'), fil: !!f.querySelector('.v3a-fiche-fil') } : null; });
      v('un actif ouvre sa fiche : nom, classe, graphique, dépêches du fil', fi && fi.titre === 'Apple' && fi.classe === 'Actions' && fi.graph && fi.fil, JSON.stringify(fi));
      await page.keyboard.press('Escape');
      v('… et Échap la referme', await page.evaluate(() => !document.getElementById('v3a-fiche')));

      console.log('\n── 8. V3 · widgets de marché en direct (admin, V2 activée) ──');
      const w3 = await page.evaluate(async () => {
        const ids = ['hauts-bas', 'courbe-taux-us', 'vol-horaire', 'distribution-variations'], out = {}, hotes = [];
        const z = document.createElement('div'); z.style.cssText = 'position:fixed;left:0;top:0;width:1200px;z-index:99999;display:grid;grid-template-columns:1fr 1fr;gap:8px';
        document.body.appendChild(z);
        ids.forEach(id => { const h = document.createElement('div'); h.style.cssText = 'height:320px;position:relative;overflow:hidden'; z.appendChild(h); hotes.push([id, h, DTPWidgets.mountInto(id, h, { paire: 'EUR/USD' })]); });
        await new Promise(r => setTimeout(r, 2500));
        hotes.forEach(([id, h]) => { out[id] = { v3: !!h.querySelector('.v3w'), svg: h.querySelectorAll('svg').length, direct: !!h.querySelector('.v3w-live'), nan: /NaN|undefined/.test(h.textContent), deborde: h.scrollWidth > h.clientWidth + 1 }; });
        hotes.forEach(([, , un]) => { try { un && un(); } catch (e) {} }); z.remove();
        return out;
      });
      const tous = Object.values(w3);
      v('les 4 widgets prennent leur présentation V3 (vrais graphiques SVG)', tous.length === 4 && tous.every(x => x.v3 && x.svg >= 1), JSON.stringify(w3));
      v('… chacun dit s\'il est EN DIRECT', tous.every(x => x.direct));
      v('… aucun « NaN » ni « undefined » affiché, rien ne déborde', tous.every(x => !x.nan && !x.deborde), JSON.stringify(w3));
      const hs = await page.evaluate(async () => {
        const h = document.createElement('div'); h.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:320px;z-index:99999';
        document.body.appendChild(h);
        const un = DTPWidgets.mountInto('sessions', h, { vue: 'frise' });
        await new Promise(r => setTimeout(r, 300));
        const o = { v3: !!h.querySelector('.v3h'), pistes: h.querySelectorAll('.v3h-piste').length, pastilles: h.querySelectorAll('.v3h-pil').length, maintenant: !!h.querySelector('.v3h-now'), nan: /NaN|undefined/.test(h.textContent) };
        un && un(); h.remove();
        const n = document.createElement('div'); n.style.cssText = h.style.cssText; document.body.appendChild(n);
        const un2 = DTPWidgets.mountInto('v3-neuro', n);
        await new Promise(r => setTimeout(r, 200));
        o.neuro = n.querySelectorAll('.v3n-ligne').length; o.neuroCmd = n.querySelectorAll('.v3n-cmd button').length;
        un2 && un2(); n.remove();
        o.icones = document.querySelectorAll('.wdgt-tab .wdgt-tico--auto').length; o.chevrons = document.querySelectorAll('.wdgt-tab .wdgt-chv').length;
        return o;
      });
      v('Horaires des marchés : 4 places, pastilles d\'état, trait « maintenant »', hs.v3 && hs.pistes === 4 && hs.pastilles === 4 && hs.maintenant && !hs.nan, JSON.stringify(hs));
      v('Neuro-ondes : 48 pistes et les trois commandes', hs.neuro === 48 && hs.neuroCmd === 3, JSON.stringify(hs));
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

// scripts/campaign-selftest.js — HARNAIS DE TEST de la newsletter (production-grade).
// Simule TOUT le cycle de vie (bienvenue -> boucle hebdo -> variantes membre/non-membre) et INJECTE tous
// les scenarios d'echec (SMTP indispo, IA en panne/quota, donnees desk absentes, timeout, widget KO,
// template invalide, variable manquante, audience corrompue) via des mocks — AUCUN e-mail reel n'est envoye.
// Verifie que le pre-flight bloque/passe correctement + anti-doublon + reprise apres echec.
// Usage : node scripts/campaign-selftest.js  (exit 0 = tout vert, exit 1 = un test a echoue).
'use strict';
process.env.APP_URL = process.env.APP_URL || 'https://datatradingpro.com';
// Placeholders : evitent toute tentative de connexion reelle au chargement du mailer (rendu pur uniquement).
process.env.OVH_SMTP_USER = process.env.OVH_SMTP_USER || 'selftest';
process.env.OVH_SMTP_PASS = process.env.OVH_SMTP_PASS || 'selftest';

const PF = require('../campaignPreflight');
const M = require('../mailer');

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

// ── Fixtures ────────────────────────────────────────────────────────────────
const GOOD_HEALTH = { ovh: { configured: true }, gmailApi: { configured: false, verified: null }, gmail: { configured: false, verified: null } };
const DOWN_HEALTH = { ovh: { configured: false }, gmailApi: { configured: false, verified: false }, gmail: { configured: false, verified: false } };
const RCP = [{ email: 'a@b.com', name: 'A', segment: 'active' }, { email: 'c@d.com', name: 'C', segment: 'lead' }];
const _day = ts => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }).format(new Date(ts)).replace(/\./g, '');
function ev(offD, time, ccy, title, impact, f, p, family, indicator) { const ts = Date.now() + offD * 864e5; return { ts, time, dayLabel: _day(ts), ccy, title, impact, forecast: f, previous: p, family, indicator }; }
const CTX_DATA = (() => {
  const up = [ev(1, '14:30', 'USD', 'Core CPI m/m', 'High', '0.3%', '0.2%', 'Inflation', 'Core CPI'), ev(2, '20:00', 'USD', 'Fed Interest Rate Decision', 'High', '5.50%', '5.50%', 'Politique monetaire', 'Décision de taux')];
  return { generatedAt: Date.now(), upcoming: up, majors: up, featured: up.find(e => e.family === 'Politique monetaire') || up[0], theme: 'rates', themeLabel: 'Banques centrales',
    bias: [{ ccy: 'USD', label: 'Haussier', signal: 'BUY' }], cs: { ranked: ['USD', 'CHF', 'JPY'], strong: [{ ccy: 'USD' }], weak: [{ ccy: 'JPY' }] },
    risk: { pct: -20, label: 'Risk-off (aversion au risque)' }, daily: { summary: 'Le dollar domine avant la Fed.' }, weekly: null };
})();
const CTX_EMPTY = { generatedAt: Date.now(), upcoming: [], majors: [], theme: 'calm', themeLabel: '', bias: [], cs: null, risk: null, weekly: null, daily: null };
const WEEKLY = { summary: 'Semaine dominee par la Fed.', insights: ['Le dollar se raffermit.'], pairs: [{ pair: 'EUR/USD', bias: 'SELL', text: 'Pression baissiere.' }], centralBanks: [{ bank: 'Fed', stance: 'hawkish' }] };
const longUnsub = (extra) => '<div style="color:#c8ccd4">' + 'contenu '.repeat(90) + (extra || '') + ' <a href="https://datatradingpro.com/api/unsubscribe?e=x&t=y">Se desabonner</a></div>';

// ── [A] CYCLE DE VIE : rendu de chaque etape ─────────────────────────────────
section('[A] Cycle de vie — inscription → bienvenue → boucle hebdo');
const intro = M.buildCampaignIntro({ name: 'Muhammed', email: 'a@b.com', campaign: 'st' });
ok('Bienvenue : rend {subject,html}', !!(intro && intro.html && intro.subject));
ok('Bienvenue : desinscription presente', /unsub|d[eé]sabonn/i.test(intro.html || ''));
ok('Bienvenue : pixel de suivi present', /track\/open/.test(intro.html || ''));

const dc = M.buildCampaignDecryptage({ name: '', email: 'a@b.com', campaign: 'st', context: CTX_DATA, recentKeys: [], isMember: false });
ok('Decryptage : rend + conceptKey', !!(dc && dc.html && dc.conceptKey));
ok('Decryptage : concept lie au theme (taux)', dc.conceptKey === 'taux-mecanisme', 'concept=' + (dc && dc.conceptKey));
ok('Decryptage : aucune variable ${} non resolue', !/\$\{/.test(dc.html));
ok('Decryptage : aucun tiret cadratin', !/—/.test(dc.html));
ok('Decryptage : aucun undefined/NaN visible', !/>\s*(undefined|NaN)\s*</.test(dc.html));
const dcAlt = M.buildCampaignDecryptage({ name: '', email: 'a@b.com', campaign: 'st', context: CTX_DATA, recentKeys: ['taux-mecanisme'], isMember: false });
ok('Decryptage : anti-redondance (concept different)', dcAlt.conceptKey !== 'taux-mecanisme', 'alt=' + dcAlt.conceptKey);
const dcM = M.buildCampaignDecryptage({ name: '', email: 'a@b.com', campaign: 'st', context: CTX_DATA, recentKeys: [], isMember: true });
ok('Variante MEMBRE : CTA "Ouvrir mon Desk"', /Ouvrir mon Desk/.test(dcM.html));
ok('Variante NON-MEMBRE : CTA "Decouvrir le Desk"', /D[eé]couvrir le Desk/.test(dc.html));

const pm = M.buildCampaignPointMarche({ name: '', email: 'a@b.com', campaign: 'st', context: CTX_DATA, isMember: false });
ok('Point marche (avec donnees) : rend', !!(pm && pm.html));
ok('Point marche : aucune variable ${} non resolue', !!pm && !/\$\{/.test(pm.html));
const pmEmpty = M.buildCampaignPointMarche({ name: '', email: 'a@b.com', campaign: 'st', context: CTX_EMPTY, isMember: false });
ok('Point marche (SANS donnees) = null (regle: pas de donnees, pas de mail)', pmEmpty === null);
const wk = M.buildWeeklyDigest({ name: '', email: 'a@b.com', campaign: 'st', weekly: WEEKLY });
ok('Digest hebdo (avec donnees) : rend', !!(wk && wk.html));

// ── Courbe de force PAR devise (30/08, signalement user sur l'apercu : « il manque le widget
//    force de la devise pour USD etc. comme dans le recap hebdo du desk »). Le retrait du 24/08
//    promettait « chaque devise porte SA courbe » sans jamais la poser : la force avait disparu
//    du mail tout court. Controles : une image par devise QUI A DE LA MATIERE, a la position du
//    desk (apres le resume executif, avant les rubriques), et jamais d'image orpheline. ──
const WK_CCY = { title: 'Weekly Market Recap : test', weekEnding: '28.08.2026',
  currencies: {
    USD: { bias: 'Legerement haussier', thesis: 'Dollar ferme.', execSummary: 'Semaine haussiere pour le dollar.',
      growthPrints: [{ label: 'GDP QoQ', actual: '1.5%', forecast: '1.5%', previous: '2.1%', date: '26 aout' }], rubriquesVides: [] },
    NZD: { bias: 'Haussier', execSummary: 'Le kiwi profite du pricing de hausse.', rubriquesVides: ['croissance', 'emploi', 'inflation', 'banque'] },
    CHF: {},   // aucune matiere → pas de bloc, donc pas d'image
  } };
const wkC = M.buildWeeklyDigest({ name: '', email: 'a@b.com', campaign: 'st', weekly: WK_CCY });
/* ⚠️ ON COMPTE LES COURBES DE DEVISE, PAS TOUTES LES IMAGES DE FORCE (01/09). Le Hebdo porte
   desormais AUSSI une vue d'ensemble sous la Geopolitique (demande utilisateur : « met une partie
   force des devises sous geopolitique »), qui est une image de force SANS `ccy`. La compte parmi
   les courbes par devise faisait rougir un controle qui parle d'autre chose. On distingue donc les
   deux familles par ce qui les distingue vraiment : la presence du parametre `ccy`. */
const imgsTouteForce = (wkC && wkC.html.match(/api\/email-widget\/strength\.png[^"]*/g)) || [];
const imgsF = imgsTouteForce.filter(u => /[?&]ccy=/.test(u));
const imgsGlob = imgsTouteForce.filter(u => !/[?&]ccy=/.test(u));
ok('Hebdo : une courbe de force PAR devise avec matiere (USD + NZD = 2)', imgsF.length === 2, 'trouvees=' + imgsF.length);
/* LA VUE D'ENSEMBLE, sa place et sa periode. Elle complete le VIX au meme endroit et pour la meme
   raison : la semaine geopolitique vient d'etre racontee, le VIX dit la prime de risque qu'elle a
   produite, la force des devises dit QUI en a profite. Elle doit donc se lire entre la Geopolitique
   et le premier bloc devise, sur la SEMAINE (le Recap Quotidien, lui, sert la meme image en TD). */
ok('Hebdo : une vue d\'ensemble de la force sous la Geopolitique (une seule, sans ccy)',
  imgsGlob.length === 1, 'trouvees=' + imgsGlob.length);
ok('Hebdo : … reglee sur la SEMAINE, comme le rapport', imgsGlob.length === 1 && /period=week/.test(imgsGlob[0]), imgsGlob[0]);
/* On repere sa place par le VIX plutot que par le titre « Geopolitique » : ce titre ne s'ecrit que
   si le rapport porte de la matiere geopolitique, ce que cette piece n'a pas — le controle aurait
   compare a -1 et serait passe pour de mauvaises raisons. Le VIX, lui, est toujours rendu, et il
   marque exactement la frontiere voulue : geopolitique racontee, puis les deux lectures de marche,
   puis les devises. */
const iVix = wkC.html.indexOf('email-widget/vix.png');
ok('Hebdo : … posee juste APRES le VIX (donc sous la Geopolitique) et AVANT le premier bloc devise',
  imgsGlob.length === 1 && iVix > 0
  && iVix < wkC.html.indexOf(imgsGlob[0])
  && wkC.html.indexOf(imgsGlob[0]) < wkC.html.indexOf('period=week&ccy=USD'),
  'vix=' + iVix + ' force=' + wkC.html.indexOf(imgsGlob[0] || 'x') + ' usd=' + wkC.html.indexOf('period=week&ccy=USD'));
ok('Hebdo : chaque courbe est CELLE de sa devise (ccy distincts, periode semaine)',
  imgsF.some(u => /period=week&ccy=USD/.test(u)) && imgsF.some(u => /period=week&ccy=NZD/.test(u)));
ok('Hebdo : la courbe est a la position du desk (apres le resume executif, avant les rubriques)',
  wkC.html.indexOf('Semaine haussiere pour le dollar') < wkC.html.indexOf('period=week&ccy=USD')
  && wkC.html.indexOf('period=week&ccy=USD') < wkC.html.indexOf('GDP QoQ'));
ok('Hebdo : une devise sans matiere n\'a NI bloc NI image orpheline', !/ccy=CHF/.test(wkC.html) && !/>CHF</.test(wkC.html));
ok('Hebdo : l\'alt porte l\'information (messageries qui bloquent les images)', /Courbe de force du USD sur la semaine/.test(wkC.html));

// pre-flight sur un rendu valide
const pfGood = PF.preflight({ mailHealth: GOOD_HEALTH, recipients: RCP, sample: () => dc, needsData: false });
ok('Pre-flight sur rendu valide = OK', pfGood.ok && pfGood.level === 'ok', pfGood.summary);

// ── [B] SCENARIOS D'ECHEC : le pre-flight doit BLOQUER (critique) ou tolerer (warn) ──
section('[B] Scenarios d\'echec — le pre-flight protege l\'envoi');
ok('SMTP/fournisseur indisponible → BLOQUE', !PF.preflight({ mailHealth: DOWN_HEALTH, recipients: RCP, sample: () => intro }).ok);
ok('Audience corrompue (null) → BLOQUE', !PF.preflight({ mailHealth: GOOD_HEALTH, recipients: null, sample: () => intro }).ok);
ok('Audience vide → BLOQUE', !PF.preflight({ mailHealth: GOOD_HEALTH, recipients: [], sample: () => intro }).ok);
ok('Audience e-mail invalide → BLOQUE', !PF.preflight({ mailHealth: GOOD_HEALTH, recipients: [{ email: 'pas-un-email' }], sample: () => intro }).ok);
ok('Erreur de rendu HTML (exception) → BLOQUE', !PF.preflight({ mailHealth: GOOD_HEALTH, recipients: RCP, sample: () => { throw new Error('render boom'); } }).ok);
ok('Template invalide (HTML trop court) → BLOQUE', !PF.preflight({ mailHealth: GOOD_HEALTH, recipients: RCP, sample: { subject: 'x', html: '<p>court</p>' } }).ok);
ok('Variable de template non resolue ${} → BLOQUE', !PF.preflight({ mailHealth: GOOD_HEALTH, recipients: RCP, sample: { subject: 'ok ok', html: longUnsub('${name}') } }).ok);
ok('Variable manquante (undefined visible) → BLOQUE', !PF.preflight({ mailHealth: GOOD_HEALTH, recipients: RCP, sample: { subject: 'ok ok', html: longUnsub('<span>undefined</span>') } }).ok);
ok('Desinscription absente → BLOQUE', !PF.preflight({ mailHealth: GOOD_HEALTH, recipients: RCP, sample: { subject: 'ok ok', html: '<div>' + 'x'.repeat(500) + '</div>' } }).ok);
ok('Sujet vide → BLOQUE', !PF.preflight({ mailHealth: GOOD_HEALTH, recipients: RCP, sample: { subject: '', html: longUnsub() } }).ok);

const pfWidget = PF.preflight({ mailHealth: GOOD_HEALTH, recipients: RCP, sample: () => intro, needsWidget: true, widgetOk: false });
ok('Widget impossible a generer → WARN, envoi AUTORISE (repli image distante)', pfWidget.ok && pfWidget.level === 'warn');
const pfAI = PF.preflight({ mailHealth: GOOD_HEALTH, recipients: RCP, sample: () => intro, needsAI: true, aiBackoff: true });
ok('IA en panne/quota → WARN, envoi AUTORISE (repli cache/data)', pfAI.ok && pfAI.level === 'warn');
const pfData = PF.preflight({ mailHealth: GOOD_HEALTH, recipients: RCP, sample: pmEmpty, needsData: true, hasData: false });
ok('Donnees desk absentes → saut propre (aucun envoi fautif, pas d\'erreur)', pfData.ok);
ok('Doublon dans l\'audience → WARN non bloquant', PF.preflight({ mailHealth: GOOD_HEALTH, recipients: [{ email: 'a@b.com' }, { email: 'a@b.com' }], sample: () => intro }).ok);

// ── [C] TIMEOUT / envoi qui echoue — aucun double envoi, aucune perte, reprise propre ──
section('[C] Robustesse envoi — timeout, anti-doublon, reprise');
const sent = new Set();
async function attempt(email, week, providerUp, hang) {
  const k = 'drip:loop:' + week + ':' + email;
  if (sent.has(k)) return 'skip';                                  // marqueur durable = anti-doublon
  let prov = false;
  try {
    if (hang) { prov = await Promise.race([new Promise(r => setTimeout(() => r('OVH'), 5000)), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 50))]); }
    else if (!providerUp) throw new Error('SMTP down');
    else prov = 'OVH';
  } catch { prov = false; }
  if (prov) { sent.add(k); return 'sent'; }                        // marqueur ECRIT seulement si envoye
  return 'failed';
}
(async () => {
  ok('1er envoi = envoye + marque', (await attempt('a@b.com', '2026-W29', true)) === 'sent' && sent.has('drip:loop:2026-W29:a@b.com'));
  ok('2e envoi meme semaine = SAUTE (zero doublon)', (await attempt('a@b.com', '2026-W29', true)) === 'skip');
  ok('Semaine suivante = envoye', (await attempt('a@b.com', '2026-W30', true)) === 'sent');
  ok('Envoi qui echoue (SMTP) → PAS de marqueur (re-essayable, pas de perte)', (await attempt('z@z.com', '2026-W29', false)) === 'failed' && !sent.has('drip:loop:2026-W29:z@z.com'));
  ok('Timeout → echec propre, PAS de marqueur', (await attempt('t@t.com', '2026-W29', true, true)) === 'failed' && !sent.has('drip:loop:2026-W29:t@t.com'));
  ok('Reprise apres correction → envoye (aucun doublon)', (await attempt('z@z.com', '2026-W29', true)) === 'sent');

  // ── [D] FRAICHEUR DES MAILS — plus jamais la semaine du 17 aout dans un mail du 30 (incident user) ──
  // Le mail « Semaine a venir » du 30/08 annoncait la semaine du 31 dans son TEXTE et montrait les
  // cartes du 17 AOUT dans son IMAGE : le filet anti-image-cassee servait une « derniere bonne
  // image » SANS date de peremption pendant que les rendus frais echouaient en silence. On extrait
  // le VRAI code d'emailWidget.js et on rejoue l'incident, mutation comprise ; puis les gardes de
  // DONNEES (contexte semaine cible, Recap Hebdo borne) sont epinglees sur les sources.
  section('[D] Fraicheur des mails — images et donnees datees');
  const _fsD = require('fs'), _pathD = require('path');
  const EW = _fsD.readFileSync(_pathD.join(__dirname, '..', 'emailWidget.js'), 'utf8');
  const SRVD = _fsD.readFileSync(_pathD.join(__dirname, '..', 'server.js'), 'utf8');
  {
    const d1 = EW.indexOf('const _AGE_MAX ='), f1 = EW.indexOf('\n}', EW.indexOf('function _criePanne'));
    const d2 = EW.indexOf('async function renderWidgetPngSafe'), f2 = EW.indexOf('\n}', EW.indexOf('try { return await renderWidgetPng(type, opts); }', d2));
    const SRC = (d1 >= 0 && f1 > d1 && d2 >= 0 && f2 > d2) ? EW.slice(d1, f1 + 2) + '\n' + EW.slice(d2, f2 + 2) : null;
    ok('le filet borne est extractible d\'emailWidget.js', !!SRC && /renderWidgetPngSafe/.test(SRC || ''));
    if (SRC) {
      const PLACEHOLDER = Buffer.from('1x1');
      const fab = (src, lastGood, render) => new Function(
        'SPECS', '_FALLBACK_PNG', '_cache', '_lastGood', '_wk', 'TTL', 'renderWidgetPng', '_extraSain', 'console',
        src + '\nreturn renderWidgetPngSafe;'
      )({ 'week-ahead': {}, strength: {} }, PLACEHOLDER, new Map(), lastGood, (t, p) => (t + '_' + p).replace(/[^a-z0-9]+/gi, '_'), 600000, render, () => '', { error() {} });
      const VIEILLE = Buffer.from('CARTES-DU-17-AOUT');
      const FRAICHE = Buffer.from('CARTES-DU-31-AOUT');
      const lgAge = h => new Map([['week_ahead_week', { png: VIEILLE, ts: Date.now() - h * 3600e3 }]]);
      const KO = () => Promise.reject(new Error('chromium en panne'));
      ok('derniere bonne image FRAICHE (2 h) + rendu en panne → servie (la resilience reste)',
        (await fab(SRC, lgAge(2), KO)('week-ahead', {})).equals(VIEILLE));
      ok('image PERIMEE (48 h) + rendu en panne → PLACEHOLDER, jamais les cartes du 17 aout',
        (await fab(SRC, lgAge(48), KO)('week-ahead', {})).equals(PLACEHOLDER));
      ok('image perimee + rendu qui MARCHE → l\'image fraiche du jour',
        (await fab(SRC, lgAge(48), () => Promise.resolve(FRAICHE))('week-ahead', {})).equals(FRAICHE));
      const lgStr = h => new Map([['strength_week', { png: VIEILLE, ts: Date.now() - h * 3600e3 }]]);
      ok('un widget SANS dates (force) tolere 48 h... ', (await fab(SRC, lgStr(48), KO)('strength', {})).equals(VIEILLE));
      ok('... mais pas 96 h (plafond 3 jours)', (await fab(SRC, lgStr(96), KO)('strength', {})).equals(PLACEHOLDER));
      const mut = SRC.replace('Date.now() - lg.ts <= _ageMax(type)', 'true');
      ok('mutation « peremption retiree » detectee (le 17 aout repartirait)',
        mut !== SRC && (await fab(mut, lgAge(48), KO)('week-ahead', {})).equals(VIEILLE));
    }
    ok('la sauvegarde du « dernier bon » porte la CLE COMPLETE (ccy/extra : la courbe NZD n\'ecrase plus le generique)',
      /_saveLastGood\(_wk\(type, period \+ \(ccy \? '_' \+ ccy : ''\) \+ \(extra \? '_' \+ extra : ''\)\), png\)/.test(EW)
      && !/_saveLastGood\(_wk\(type, period\), png\)/.test(EW));
    ok('la panne de rendu se CRIE dans le journal (fini le catch muet)', /_criePanne/.test(EW) && /en ÉCHEC/.test(EW));
  }
  // ── Titres de rubrique SANS tiret (30/08, capture user « | GEOPOLITIQUE » : « enleve le trait
  //    a gauche de tous les templates, comme dans le desk »). La cellule-tiret 3px de _secRapport
  //    et le border-left de _secTitle ont disparu : titre or nu + filet, la grammaire du desk. ──
  ok('Hebdo : plus de cellule-tiret or devant les titres de rubrique',
    !/td width="3"/.test(wkC.html) && /text-transform:uppercase/.test(wkC.html));
  const wkOut = M.buildCampaignOutlook({ name: '', email: 'a@b.com', campaign: 'st',
    context: { upcoming: [{ title: 'CPI', impact: 'High' }], weekAhead: { week: '31-4 septembre',
      days: [{ dow: 'Monday', title: 'CPI DE', impact: 'HIGH', description: 'Au programme lundi.' }] } }, isMember: false });
  ok('Semaine a venir : les intertitres n\'ont plus de border-left',
    !!wkOut && !/padding-left:9px;border-left/.test(wkOut.html) && /text-transform:uppercase/.test(wkOut.html));

  ok('le contexte campagne n\'embarque la Semaine a venir QUE si elle couvre le lundi cible',
    /_weekAhead\.monday === _waLundiCible\(now\)/.test(SRVD) && /weekAhead: _waFrais/.test(SRVD)
    && /generateWeekAhead\(true\)\.catch/.test(SRVD));
  ok('le Recap Hebdo des mails est borne (~9 j) sur les DEUX branches (tampon + copie durable)',
    /function _weeklyRecent/.test(SRVD) && /w && _weeklyRecent\(w\)/.test(SRVD)
    && (SRVD.match(/_weeklyDurable && _weeklyRecent\(_weeklyDurable\)/g) || []).length === 2);
  ok('... et la copie durable porte sa date de memorisation (filet quand weekEnding manque)',
    /w\._memAt = Date\.now\(\)/.test(SRVD));

  // ── Bilan ──
  console.log('\n' + '='.repeat(52));
  console.log('RESULTAT : ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) { console.log('ECHECS :\n - ' + fails.join('\n - ')); console.log('❌ HARNAIS ROUGE — NE PAS DEPLOYER.'); process.exit(1); }
  console.log('✅ HARNAIS VERT — cycle de vie + tous les scenarios d\'echec passent.');
  process.exit(0);
})();

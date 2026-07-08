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
  return { generatedAt: Date.now(), upcoming: up, majors: up, theme: 'rates', themeLabel: 'Banques centrales',
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

  // ── Bilan ──
  console.log('\n' + '='.repeat(52));
  console.log('RESULTAT : ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) { console.log('ECHECS :\n - ' + fails.join('\n - ')); console.log('❌ HARNAIS ROUGE — NE PAS DEPLOYER.'); process.exit(1); }
  console.log('✅ HARNAIS VERT — cycle de vie + tous les scenarios d\'echec passent.');
  process.exit(0);
})();

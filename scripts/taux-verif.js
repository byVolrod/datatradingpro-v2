#!/usr/bin/env node
/**
 * scripts/taux-verif.js — LE PRICING DE TAUX NE MENT PLUS SUR SA SOURCE
 *
 * POURQUOI (28-29/08, INCIDENT CLIENT — le premier signalé par un abonné avec la donnée de marché
 * en main). La carte RBNZ affichait « Prochain mouvement : Hausse · Probabilité : 50,00% ·
 * Δ attendu : -3,00 bps · Taux actuel : 2,2500% » pendant que le marché réel priçait 93 % de
 * HAUSSE sur un taux de 2,50 %. QUATRE défauts empilés, chacun invisible seul :
 *   1. l'étiquette venait d'un moteur (stance du Radar) et la probabilité d'un autre (argmax du
 *      scénario) — la carte se contredisait ELLE-MÊME ;
 *   2. un biais estimé par IA sur 22 titres écrasait la ligne de config dont le commentaire dit
 *      « cette ligne EST la source de vérité », et inversait la direction ;
 *   3. le taux 2,25 % venait d'un ÉCHO : l'exemple de format du prompt _aiVerifyRates portait
 *      « "NZD":2.25 », le modèle l'a recopié, le garde-fou (±3 points !) l'a laissé passer ;
 *   4. rien à l'écran ne disait que NZD et CHF sortent du modèle maison — le client comparait
 *      notre estimation à un pricing OIS en croyant comparer deux pricings.
 *
 * ⚠️ LA MOITIÉ DES CONTRÔLES VÉRIFIE CE QUI DOIT RESTER : les six banques de marché inchangées,
 * l'IA toujours active là où elle est légitime, le repli maison toujours disponible.
 *
 *   node scripts/taux-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const CHARTS = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ══ 1. L'ANCRE HUMAINE NE SE FAIT PLUS ÉCRASER PAR L'IA ══════════════════════════════════════ */
console.log('\n── L\'ancre vérifiée à la main prime sur le biais IA ──');
/* Trois découpes CIBLÉES plutôt qu'une tranche large : entre CB et _cbResolved vivent le fichier
   d'état et ses `path`/`_CACHE_DIR`, inexécutables dans un bac à sable. */
const SRC_CB = (() => {
  const d1 = SRV.indexOf('const CB = [');
  const f1 = SRV.indexOf('\n];', d1);
  const d2 = SRV.indexOf('function _rateScenario(b, idx)');
  const f2 = SRV.indexOf('\n}', d2);
  const d3 = SRV.indexOf('const _ANCRE_MAX_J');
  const f3 = SRV.indexOf('\n}', SRV.indexOf('function _cbResolved(b)'));
  if (d1 < 0 || f1 < 0 || d2 < 0 || f2 < 0 || d3 < 0 || f3 < 0) return null;
  return SRV.slice(d1, f1 + 3) + '\n' + SRV.slice(d2, f2 + 2) + '\n' + SRV.slice(d3, f3 + 2);
})();
v('CB + _cbResolved sont extractibles de server.js', !!SRC_CB && /function _cbResolved/.test(SRC_CB || ''));
if (SRC_CB) {
  const bac = new Function('_aiRatesBias', SRC_CB + '\nreturn { CB, _cbResolved, _rateScenario };');
  /* LE SCÉNARIO EXACT DE L'INCIDENT : l'IA dit « hold 0,50 » sur une NZD ancrée « hike 0,60 ». */
  const S = bac({ NZD: { bias: 'hold', conv: 0.50 }, EUR: { bias: 'cut', conv: 0.55 } });
  const nz = S.CB.find(b => b.code === 'NZD'), ch = S.CB.find(b => b.code === 'CHF');
  v('NZD et CHF portent une ancre datée', !!(nz && nz.ancre) && !!(ch && ch.ancre),
    'sans ancre, la hiérarchie des sources n\'existe pas');
  v('l\'ancre NZD porte les valeurs vérifiées sur rbnz.govt.nz (2,50 · hike)',
    nz && nz.rate === 2.50 && nz.bias === 'hike', nz && (nz.rate + ' · ' + nz.bias));
  const rnz = S._cbResolved(nz);
  v('le biais IA ne renverse PLUS une banque ancrée', rnz.bias === 'hike' && rnz.conv === 0.60,
    'résolu : ' + rnz.bias + ' ' + rnz.conv + ' — l\'incident client, à l\'identique');
  /* … ET LA MOITIÉ QUI COMPTE : l'IA reste légitime sur une banque NON ancrée. */
  const eu = S.CB.find(b => b.code === 'EUR');
  const reu = S._cbResolved(eu);
  v('… mais s\'applique toujours à une banque non ancrée', reu.bias === 'cut' && reu.conv === 0.55,
    'résolu : ' + reu.bias + ' — l\'actualisation IA ne doit pas mourir, seulement respecter l\'ancre');
  /* La preuve arithmétique de l'incident, gardée comme régression : hold/0,50 fabrique EXACTEMENT
     la carte du client (50/19/31, Δ −3), hike/0,60 fabrique l'inverse (hausse dominante, Δ +13,2). */
  const scH = S._rateScenario({ bias: 'hold', conv: 0.50, step: 25 }, 0);
  const scK = S._rateScenario({ bias: 'hike', conv: 0.60, step: 25 }, 0);
  v('hold/0,50 reproduit la carte fautive (50/19/31, Δ −3)',
    Math.round(scH.hold * 100) === 50 && Math.round(scH.cut * 100) === 31 && +scH.impliedBps.toFixed(1) === -3,
    JSON.stringify(scH));
  v('hike/0,60 (l\'ancre) donne une hausse dominante, Δ +13,2',
    Math.round(scK.hike * 100) === 60 && +scK.impliedBps.toFixed(1) === 13.2, JSON.stringify(scK));
}

/* ══ 2. UN TAUX « VÉRIFIÉ PAR IA » DOIT ÊTRE CORROBORÉ PAR LE CALENDRIER ══════════════════════ */
console.log('\n── Le taux écrit par l\'IA doit coïncider avec une décision réelle ──');
const mC = /function _tauxCorrobore\(actuals, v\) \{[\s\S]*?\n\}/.exec(SRV);
v('_tauxCorrobore est extractible', !!mC);
if (mC) {
  const T = new Function(mC[0] + '\nreturn _tauxCorrobore;')();
  v('2,50 passe quand le calendrier porte la décision 2,50', T(new Set([2.5, 3.75]), 2.50) === true);
  v('2,25 est REJETÉ sans décision correspondante (l\'écho de l\'exemple du prompt)',
    T(new Set([2.5, 3.75]), 2.25) === false, 'c\'est le chiffre exact que le client a vu affiché');
  v('aucun actual → rien n\'est cru', T(new Set(), 2.5) === false && T(undefined, 2.5) === false);
  v('la tolérance reste au demi-centième (2,504 ≈ 2,50, pas 2,51)',
    T(new Set([2.504]), 2.50) === true && T(new Set([2.51]), 2.50) === false);
}
v('… et la corroboration est BRANCHÉE dans l\'acceptation des taux IA',
  /&& _tauxCorrobore\(calActuals\[b\.code\], v\)\) next\[b\.code\]/.test(SRV),
  'écrite mais jamais appelée : l\'écho reviendrait');
/* L'exemple du prompt ne doit plus porter un chiffre plausible : « "NZD":2.25 » est DEVENU un taux
   affiché chez un client. Le gabarit utilise des sentinelles 9.99/null, invraisemblables ET
   refusées par la corroboration. */
v('l\'exemple du prompt n\'a plus de valeur plausible à recopier',
  /"NZD":null\}.*9\.99 is a FORMAT placeholder/.test(SRV) && !/\{"USD":3\.75,"EUR":2\.0/.test(SRV));
v('le ré-ancrage v4 efface la dérive persistée (le 2,25 écrit par l\'IA)',
  /const RATES_VER = 'v4-/.test(SRV) && !/const RATES_VER = 'v3-/.test(SRV));

/* ══ 3. LA CARTE EST COHÉRENTE AVEC ELLE-MÊME, ET DIT SA SOURCE ═══════════════════════════════ */
console.log('\n── La carte : un seul couple mouvement/probabilité, et sa source écrite ──');
const SRC_CARD = (() => {
  const d = CHARTS.indexOf('const _RTC_EN =');
  const f = CHARTS.indexOf('\n  }\n', CHARTS.indexOf('function _rtcCard(b)'));
  return (d < 0 || f < 0) ? null : CHARTS.slice(d, f + 4);
})();
v('_rtcCard est extractible de charts.js', !!SRC_CARD);
if (SRC_CARD) {
  const card = new Function(SRC_CARD + '\nreturn _rtcCard;')();
  const lireMv = h => (h.match(/rtc-v (?:g|r|w)">([^<]+)/) || [])[1];
  const lireP  = h => (h.match(/rtc-prob">([^<]+)/) || [])[1];
  const lireSrc = h => (h.match(/rtc-src[^>]*>([^<]+)/) || [])[1];
  const base = { code: 'NZD', cc: 'nz', bank: 'RBNZ', rate: 2.25, next: '2026-09-02', expBps: -3 };
  /* LA CARTE DE L'INCIDENT, MOT POUR MOT : stance Hausse, scénario Maintien 50 / Baisse 31 / Hausse 19. */
  const incident = card({ ...base, stance: 'HIKE', prob: 50, source: 'maison',
    scenario: { hold: 50, hike: 19, cut: 31 },
    meetings: [{ date: '2026-09-02', days: 5, hold: 50, hike: 19, cut: 31, impliedBps: -3, baseCase: 'HOLD' }] });
  v('la probabilité affichée est CELLE du mouvement affiché (Hausse → 19 %, plus jamais 50)',
    lireMv(incident) === 'Hausse' && lireP(incident) === '19,00%',
    lireMv(incident) + ' · ' + lireP(incident) + ' — le 50,00% était la probabilité du MAINTIEN');
  v('… et la carte modélisée porte « estimation DTP »', lireSrc(incident) === 'estimation DTP', lireSrc(incident));
  /* Mouvement pricé à 0 % au prochain rendez-vous → repli sur le scénario central, jamais « X · 0,00% ». */
  const zero = card({ ...base, stance: 'HIKE', source: 'market',
    scenario: { hold: 69, hike: 0, cut: 31 },
    meetings: [{ date: '2026-09-02', days: 5, hold: 69, hike: 0, cut: 31, impliedBps: -7, baseCase: 'HOLD' }] });
  v('un mouvement pricé à 0 % bascule sur le scénario central', lireMv(zero) === 'Maintien' && lireP(zero) === '69,00%',
    lireMv(zero) + ' · ' + lireP(zero));
  v('… et une carte de marché porte « pricing marché »', lireSrc(zero) === 'pricing marché', lireSrc(zero));
  /* LA MOITIÉ QUI COMPTE : une banque de marché ordinaire, cohérente, s'affiche comme avant. */
  const fed = card({ code: 'USD', cc: 'us', bank: 'Fed', rate: 3.75, next: '2026-09-16', expBps: -9.5,
    stance: 'CUT', prob: 62, source: 'market', scenario: { hold: 38, hike: 0, cut: 62 },
    meetings: [{ date: '2026-09-16', days: 18, hold: 38, hike: 0, cut: 62, impliedBps: -9.5, baseCase: 'CUT' }] });
  v('une banque de marché cohérente garde son couple (Baisse · 62 %)',
    lireMv(fed) === 'Baisse' && lireP(fed) === '62,00%', lireMv(fed) + ' · ' + lireP(fed));
}

/* ══ 4. PLUS AUCUN TEXTE NE DIT « MARCHÉ » POUR UNE ESTIMATION ════════════════════════════════ */
console.log('\n── Les textes disent la vraie source ──');
{
  const d = SRV.indexOf('function _recapCcyPricingLine(ccy)');
  const f = SRV.indexOf('\n}', d);
  v('_recapCcyPricingLine est extractible', d >= 0 && f > d);
  if (d >= 0) {
    const F = new Function('_buildRatesPayload', SRV.slice(d, f + 2) + '\nreturn _recapCcyPricingLine;');
    const fabrique = b => F(() => ({ banks: [b] }));
    const maison = fabrique({ code: 'NZD', expBps: 13.2, next: '2026-09-02', nextDays: 4, source: 'maison' })('NZD');
    const marche = fabrique({ code: 'USD', expBps: -9.5, next: '2026-09-16', nextDays: 18, source: 'market' })('USD');
    v('une banque modélisée ne s\'écrit plus « le marché price »',
      /ESTIMATION DTP/.test(maison) && /le modèle DTP anticipe/.test(maison) && !/le marché price/.test(maison), maison);
    v('… et une banque de marché garde sa phrase d\'origine',
      /PRICING MARCHÉ/.test(marche) && /le marché price/.test(marche), marche);
    v('le retrait du préfixe couvre les DEUX têtes',
      /PRICING\(\?:\\s\+MARCHÉ\)\?/.test(SRV.replace(/\n/g, ' ')) || /\^PRICING\(\?\:\\s\+MARCHÉ\)\?/.test(SRV),
      'sinon la puce du desk garderait « PRICING (ESTIMATION… » en préfixe brut');
  }
}
{
  const d = SRV.indexOf('function _sbPricingLine(rb)');
  const f = SRV.indexOf('\n}', d);
  v('_sbPricingLine est extractible', d >= 0 && f > d);
  if (d >= 0) {
    const P = new Function(SRV.slice(d, f + 2) + '\nreturn _sbPricingLine;')();
    const est = P({ scenario: { hold: 50, hike: 19, cut: 31 }, expBps: -3, source: 'maison' });
    const mkt = P({ scenario: { hold: 38, cut: 62 }, expBps: -9.5, source: 'market' });
    v('la ligne du Radar dit « estimation DTP » quand c\'en est une', / · estimation DTP$/.test(est || ''), est);
    v('… et « pricing de marché » quand c\'en est un', / · pricing de marché$/.test(mkt || ''), mkt);
  }
}
/* Le repli maison n'est plus SILENCIEUX : il se journalise avec la raison du fournisseur. */
v('le repli maison se journalise (banque + raison)',
  /servi en ESTIMATION DTP \(pas de pricing marché : \$\{_rpPanne\[slug\]/.test(SRV));
v('… et _rpFetchBank distingue paywall, HTTP et réseau', /'paywall\/erreur fournisseur'/.test(SRV)
  && /_rpPanne\[slug\] = 'HTTP ' \+ r\.status/.test(SRV) && /_rpPanne\[slug\] = 'réseau\/timeout'/.test(SRV));
/* L'ancre vieillit BRUYAMMENT : sans rappel, une config « source de vérité » se périme en silence
   — c'est le défaut symétrique de celui qu'on corrige. */
v('une ancre de plus de 60 jours réclame sa re-vérification', /_ANCRE_MAX_J = 60/.test(SRV) && /re-vérifier bias\/taux/.test(SRV));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

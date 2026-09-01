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
  v('le biais IA ne renverse PLUS une banque ancrée', rnz.bias === 'hike' && rnz.conv === 0.93,
    'résolu : ' + rnz.bias + ' ' + rnz.conv + ' — l\'incident client, à l\'identique');
  /* … ET LA MOITIÉ QUI COMPTE : l'IA reste légitime sur une banque NON ancrée. */
  const eu = S.CB.find(b => b.code === 'EUR');
  const reu = S._cbResolved(eu);
  v('… mais s\'applique toujours à une banque non ancrée', reu.bias === 'cut' && reu.conv === 0.55,
    'résolu : ' + reu.bias + ' — l\'actualisation IA ne doit pas mourir, seulement respecter l\'ancre');
  /* La preuve arithmétique de l'incident, gardée comme régression : hold/0,50 fabrique EXACTEMENT
     la carte fautive du client (50/19/31, Δ −3). Et depuis la CALIBRATION du 30/08 (« pour chaque
     devise corrige »), l'ancre NZD porte le pricing RÉEL : hike/0,93 → 93 % de hausse (le marché
     dit 93,3 %), Δ +22,9 — plus un 60 % générique. */
  const scH = S._rateScenario({ bias: 'hold', conv: 0.50, step: 25 }, 0);
  const scK = S._rateScenario({ bias: 'hike', conv: 0.93, step: 25 }, 0);
  v('hold/0,50 reproduit la carte fautive (50/19/31, Δ −3)',
    Math.round(scH.hold * 100) === 50 && Math.round(scH.cut * 100) === 31 && +scH.impliedBps.toFixed(1) === -3,
    JSON.stringify(scH));
  v('hike/0,93 (l\'ancre calibrée) donne 93 % de hausse, Δ +22,9 — le pricing réel du 28/08',
    Math.round(scK.hike * 100) === 93 && +scK.impliedBps.toFixed(1) === 22.9, JSON.stringify(scK));
  /* ── CALIBRATION DEVISE PAR DEVISE (30/08, sonde des 8 banques + données client) ─────────────
     Les 8 taux étaient exacts ; les biais de JUIN étaient à contre-sens du marché sur 4 banques.
     On épingle la réalité vérifiée : si quelqu'un remet « penchant baisse » sans nouvelle preuve,
     ce banc rougit — et si le monde re-price un jour, c'est LUI qu'on mettra à jour, avec la
     nouvelle sonde en pièce jointe. */
  const scCH = S._rateScenario({ bias: 'hold', conv: 0.95, step: 25 }, 0);
  v('CHF calibré : Maintien 95 % (le « No Change 99,5 % » du marché, au plafond du modèle)',
    Math.round(scCH.hold * 100) === 95 && (S.CB.find(b => b.code === 'CHF') || {}).conv === 0.95, JSON.stringify(scCH));
  v('les biais suivent le pricing réel de la sonde du 30/08 (hausse Fed/BCE/BoJ/RBA, maintien penché hausse BoE/BoC)',
    ['USD', 'EUR', 'JPY', 'AUD'].every(c => (S.CB.find(b => b.code === c) || {}).bias === 'hike')
    && ['GBP', 'CAD'].every(c => { const b = S.CB.find(x => x.code === c) || {}; return b.bias === 'hold' && b.lean === 'hike'; }),
    'la config de juin disait « pause, penchant baisse » quand le marché price 58-90 % de hausse');
  v('plus aucun lean \'cut\' hérité de juin dans la config', !S.CB.some(b => b.lean === 'cut'));
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
v('le ré-ancrage v5 efface la dérive persistée (le 2,25 encore en prod avant le durcissement)',
  /const RATES_VER = 'v5-/.test(SRV) && !/const RATES_VER = 'v[34]-/.test(SRV),
  'sans bump de version, l\'état Supabase/disque garde le taux empoisonné : la correction resterait lettre morte');

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
  /* LE BADGE A CHANGÉ DE MOTS LE 01/09, PAS DE RÔLE. « estimation DTP » qualifiait le PRICING mais,
     seul en tête de carte, se lisait comme un verdict sur tout ce qu'elle affiche — taux directeur
     compris, alors que ce chiffre-là vient d'une décision publiée. Il dit maintenant ce qu'il
     qualifie. Ce qu'on éprouve reste l'exigence née de l'incident du 29/08, et elle est écrite
     comme une PROPRIÉTÉ, pas comme un libellé : une carte sans pricing de marché ne doit jamais
     pouvoir se lire comme un pricing de marché. */
  v('… et la carte modélisée dit que son pricing est modélisé, jamais « marché »',
    /modélis/i.test(lireSrc(incident) || '') && !/march/i.test(lireSrc(incident) || ''), lireSrc(incident));
  /* LE PIED DE CARTE CITE SA SOURCE (01/09, « donne des sources qu'on a ») — et distingue les deux :
     d'où vient le TAUX, d'où vient le PRICING. C'est cette séparation qui rend le badge lisible. */
  const lirePied = h => (h.match(/rtc-srcs">([\s\S]*?)<\/div>/) || [])[1] || '';
  const pieds = {
    calendrier: card({ ...base, rate: 2.50, stance: 'HIKE', source: 'maison', panne: 'abonnement Pro requis',
      scenario: { hold: 50, hike: 19, cut: 31 }, meetings: [{ date: '2026-09-02', days: 5, hold: 50, hike: 19, cut: 31, impliedBps: -3, baseCase: 'HOLD' }],
      rateSrc: { via: 'calendrier', libelle: 'Official Cash Rate', date: '2026-07-08' } }),
    ancre: card({ ...base, code: 'CHF', cc: 'ch', rate: 0, stance: 'HOLD', source: 'maison', panne: 'abonnement Pro requis',
      scenario: { hold: 95, hike: 3, cut: 2 }, meetings: [], rateSrc: { via: 'ancre', libelle: 'Banque nationale suisse', date: '2026-08-30' } }),
    marche: card({ ...base, code: 'USD', cc: 'us', rate: 3.75, stance: 'HIKE', source: 'market', srcAt: Date.now(),
      scenario: { hold: 42, hike: 58, cut: 0 }, meetings: [], rateSrc: { via: 'marche', date: '2026-09-01' } }),
    sansSrc: card({ ...base, code: 'GBP', cc: 'gb', rate: 3.75, stance: 'HOLD', source: 'market', srcAt: Date.now(),
      scenario: { hold: 80, hike: 20, cut: 0 }, meetings: [] }),
  };
  v('le pied cite la DÉCISION qui a écrit le taux, avec sa date',
    /Taux directeur/.test(pieds.calendrier) && /08\/07\/2026/.test(pieds.calendrier) && /Official Cash Rate/.test(pieds.calendrier), pieds.calendrier);
  v('… il dit « relevé à la main » quand aucune décision publiée ne porte ce chiffre',
    /relevé à la main/.test(pieds.ancre) && /30\/08\/2026/.test(pieds.ancre), pieds.ancre);
  v('… et il sépare toujours la source du TAUX de celle du PRICING',
    /Pricing : modèle DTP/.test(pieds.calendrier) && /Pricing : marché/.test(pieds.marche), pieds.marche);
  v('une carte modélisée n\'écrit JAMAIS « Pricing : marché » en pied', !/Pricing : marché/.test(pieds.ancre), pieds.ancre);
  v('sans provenance connue, le pied se TAIT au lieu d\'affirmer une source',
    !/décision du|relevé/.test(pieds.sansSrc) && /Taux directeur/.test(pieds.sansSrc), pieds.sansSrc);
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
  /* Sur le RENDU, pas sur la source : le commentaire qui explique le retrait cite forcément le
     libellé retiré. Un banc qui lit le code au lieu de sa sortie confond l'un avec l'autre. */
  v('le libellé « estimation DTP » a quitté la CARTE (il reste, à raison, dans les textes rédigés)',
    ![incident, zero, fed].some(h => /estimation DTP/i.test(h)), 'demande user du 01/09 : « enlève estimation DTP »');

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
    const maison = fabrique({ code: 'NZD', rate: 2.50, expBps: 13.2, next: '2026-09-02', nextDays: 4, source: 'maison' })('NZD');
    const marche = fabrique({ code: 'USD', rate: 3.63, expBps: -9.5, next: '2026-09-16', nextDays: 18, source: 'market' })('USD');
    v('une banque modélisée ne s\'écrit plus « le marché price »',
      /ESTIMATION DTP/.test(maison) && /le modèle DTP anticipe/.test(maison) && !/le marché price/.test(maison), maison);
    v('… et une banque de marché garde sa phrase d\'origine',
      /PRICING MARCHÉ/.test(marche) && /le marché price/.test(marche), marche);
    /* Le TAUX ACTUEL ouvre la ligne (30/08) : c'est LE chiffre qui était faux sur la carte RBNZ —
       la puce « Pricing » du rapport doit désormais l'ancrer, recalé sur la dernière décision. */
    v('la ligne Pricing du rapport porte le taux directeur recalé (2,50 NZD / 3,63 USD)',
      /taux directeur 2\.5% · /.test(maison) && /taux directeur 3\.63% · /.test(marche), maison);
    v('… et survit à un payload sans taux (aucun « undefined% » possible)',
      !/undefined/.test(fabrique({ code: 'NZD', expBps: 13.2, next: '2026-09-02', nextDays: 4, source: 'maison' })('NZD')));
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
/* ── LES GABARITS DE RAPPORTS BOIVENT À LA MÊME SOURCE (30/08 : « met à jour le template recap
   hebdo, point marché, semaine à venir ») : le bloc taux par banque porte la SOURCE, le Point
   Marché reçoit le bloc, et l'ancienne formule « scénario marché » (fausse pour NZD/CHF) a disparu.
   La Semaine à Venir a son propre banc (weekahead-verif, section 18). ── */
{
  const d = SRV.indexOf('function _recapCbRatesCtx()');
  const f = SRV.indexOf('\n}', d);
  v('_recapCbRatesCtx est extractible', d >= 0 && f > d);
  if (d >= 0) {
    const fab = s => new Function('_buildRatesPayload', s + '\nreturn _recapCbRatesCtx;');
    const PAYLOAD = { banks: [
      { code: 'USD', bank: 'Fed', rate: 3.63, move: 'CUT', next: '2026-09-16', nextDays: 18, source: 'market', expBps: -9.5, scenario: { hold: 42.4, hike: 0, cut: 57.6 } },
      { code: 'NZD', bank: 'RBNZ', rate: 2.50, move: 'HIKE', next: '2026-09-02', nextDays: 4, source: 'maison', expBps: 13.2, scenario: { hold: 40, hike: 60, cut: 0 } },
    ] };
    const SRC_CTX = SRV.slice(d, f + 2);
    const ctx = fab(SRC_CTX)(() => PAYLOAD)();
    const lUSD = ctx.split('\n').find(l => /^Fed/.test(l)) || '', lNZD = ctx.split('\n').find(l => /RBNZ/.test(l)) || '';
    v('chaque ligne de banque du contexte Hebdo porte sa SOURCE',
      / · source : pricing de marché$/.test(lUSD) && /source : estimation DTP \(pas de pricing de marché pour cette banque\)$/.test(lNZD),
      lNZD || '(ligne RBNZ introuvable)');
    v('la formule « scénario marché » (fausse une banque sur quatre) a disparu du contexte',
      !/scénario marché/.test(ctx) && /scénario maintien/.test(ctx), ctx.slice(0, 200));
    const mut = SRC_CTX.replace("b.source === 'market' ? 'pricing de marché' : 'estimation DTP (pas de pricing de marché pour cette banque)'", "'pricing de marché'");
    v('mutation « source effacée » détectée (l\'estimation RBNZ redeviendrait du marché)',
      mut !== SRC_CTX && /RBNZ[^\n]*source : pricing de marché/.test(fab(mut)(() => PAYLOAD)()));
  }
  v('le prompt CB du Hebdo impose de respecter l\'étiquette source (HONOR IT)',
    /Each bank line below ends with its « source » tag\. HONOR IT/.test(SRV) && /NEVER attribute the numbers to « le marché »/.test(SRV));
  v('le Point Marché reçoit le bloc TAUX DIRECTEURS & PRICING (même source que le Hebdo)',
    /=== TAUX DIRECTEURS & PRICING \(données desk par banque/.test(SRV) && /ratesLines = _recapCbRatesCtx\(\);/.test(SRV));
  v('… et sa règle « Banques centrales » interdit « le marché price » sur une estimation',
    /une ligne « estimation DTP » ne s'écrit JAMAIS « le marché price »/.test(SRV));
}
/* Le repli maison n'est plus SILENCIEUX : il se journalise avec la raison du fournisseur. */
v('le repli maison se journalise (banque + raison)',
  /servi en ESTIMATION DTP \(pas de pricing marché : \$\{_rpPanne\[slug\]/.test(SRV));
v('… et _rpFetchBank distingue paywall, HTTP et réseau', /'paywall\/erreur fournisseur'/.test(SRV)
  && /: 'HTTP ' \+ r\.status/.test(SRV) && /_rpPanne\[slug\] = 'réseau\/timeout'/.test(SRV));
/* La sonde du 30/08 a PROUVÉ le paywall : rbnz et snb répondent HTTP 401 « Pro subscription
   required » là où fed répond 200. Un 401 doit donc se nommer par sa vraie cause, pas « HTTP 401 »
   sec — c'est la réponse à donner au client qui demande pourquoi deux banques sont en estimation. */
v('un 401 se nomme « abonnement Pro requis » (la cause prouvée par la sonde)',
  /r\.status === 401 \? 'abonnement Pro requis chez le fournisseur \(HTTP 401\)'/.test(SRV));
v('les deux replis muets de _rpTransform sont nommés (taux introuvable, zéro réunion)',
  /'taux actuel introuvable dans la réponse \(clés inattendues\)'/.test(SRV)
  && /'aucune réunion à venir dans la réponse'/.test(SRV));
v('le jeton Pro (RATEPROB_TOKEN, .env du VPS uniquement) part sous les deux formes usuelles',
  /RP_HEADERS\['Authorization'\] = 'Bearer ' \+ process\.env\.RATEPROB_TOKEN/.test(SRV)
  && /RP_HEADERS\['X-API-Key'\] = process\.env\.RATEPROB_TOKEN/.test(SRV));
v('/api/rates dit la santé PAR banque : `panne` côté estimation, `srcAt` côté marché',
  /panne: _rpPanne\[slug\] \|\| 'jamais reçu',/.test(SRV) && /srcAt: _rpBankAt\[b\.code\] \|\| _rpCache\.at \|\| null,/.test(SRV));
v('… et le badge de la carte les affiche au survol (pourquoi / quand)',
  /b\.panne \? ' \(' \+ b\.panne \+ '\)'/.test(CHARTS) && /b\.srcAt \? ', dernière donnée reçue à '/.test(CHARTS));
/* L'ancre vieillit BRUYAMMENT : sans rappel, une config « source de vérité » se périme en silence
   — c'est le défaut symétrique de celui qu'on corrige. */
v('une ancre de plus de 60 jours réclame sa re-vérification', /_ANCRE_MAX_J = 60/.test(SRV) && /re-vérifier bias\/taux/.test(SRV));

/* ══ 5. LE CALENDRIER ÉCRIT LES TAUX — DÉTERMINISTE, ET LA CORROBORATION NE CROIT QUE LE DERNIER JOUR ══
   Deuxième incident du MÊME chiffre (30/08) : après le durcissement v4, le 2,25 % RBNZ tenait
   encore, parce que la corroboration acceptait TOUT actual de 160 jours — la décision de MAI
   (2,25) « prouvait » l'écho pendant que JUILLET disait 2,50. Ici on rejoue l'incident sur le
   VRAI code extrait de server.js, puis on MUTE le code pour vérifier que chaque garde-fou est
   bien celui qui tient la porte (un banc qui passe sur du code muté ne protège rien). */
console.log('\n── La dernière décision réelle écrit le taux, sans IA ──');
const SRC_CAL = (() => {
  const d = SRV.indexOf('const _CAL_TAUX_RX =');
  const f = SRV.indexOf('\nsetTimeout(() => { try { _calendrierEcritTaux(true); } catch {} }', d);
  return (d < 0 || f < 0) ? null : SRV.slice(d, f);
})();
v('la voie calendrier est extractible (_CAL_TAUX_RX → _calendrierEcritTaux)',
  !!SRC_CAL && /function _calendrierEcritTaux/.test(SRC_CAL || ''));
const SRC_APPLY = (() => {
  const d = SRV.indexOf('function _tauxCorrobore');
  const f = SRV.indexOf('\n}', SRV.indexOf('function _applyVerifiedRates'));
  return (d < 0 || f < 0) ? null : SRV.slice(d, f + 2);
})();
v('_tauxCorrobore + _applyVerifiedRates sont extractibles ensemble', !!SRC_APPLY && /_applyVerifiedRates/.test(SRC_APPLY || ''));
if (SRC_CAL && SRC_APPLY) {
  const MUET = { log() {}, warn() {} };
  const SBC = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
  /* LE CALENDRIER DE L'INCIDENT : mai 2,25 puis juillet 2,50 (RBNZ), un jour BCE à DEUX mesures
     (dépôt 2,25 / refi 2,40), une Fed simple, du bruit hors périmètre et hors sujet. */
  const T_JUIL = Date.UTC(2026, 6, 8, 2, 0), T_MAI = Date.UTC(2026, 4, 28, 2, 0);
  const CAL_FIX = () => ([
    { currency: 'NZD', title: 'RBNZ Interest Rate Decision', actual: '2.50%', timestamp: T_JUIL },
    { currency: 'NZD', title: 'RBNZ Rate Statement', actual: '2.50%', timestamp: T_JUIL },
    { currency: 'NZD', title: 'RBNZ Interest Rate Decision', actual: '2.25%', timestamp: T_MAI },
    { currency: 'NZD', title: 'GDT Price Index', actual: '1.2%', timestamp: Date.UTC(2026, 6, 9, 2, 0) },
    { currency: 'EUR', title: 'ECB Interest Rate Decision', actual: '2.40%', timestamp: Date.UTC(2026, 5, 11, 12, 15) },
    { currency: 'EUR', title: 'ECB Deposit Facility Rate', actual: '2.25%', timestamp: Date.UTC(2026, 5, 11, 12, 15) },
    { currency: 'USD', title: 'Fed Interest Rate Decision', actual: '3.75%', timestamp: Date.UTC(2026, 6, 29, 18, 0) },
    { currency: 'CLP', title: 'Interest Rate Decision', actual: '5.00%', timestamp: T_JUIL },
  ]);
  const CB_FIX = () => ([{ code: 'NZD', rate: 2.50 }, { code: 'EUR', rate: 2.25 }, { code: 'USD', rate: 3.75 }]);
  /* VRAIE ambiguïté : deux mesures distinctes le même jour, AUCUNE nommée « deposit ». Rien ne
     tranche → on ne doit rien écrire. C'est ce cas-là que garde l'abstention, pas la BCE. */
  const CAL_AMBIGU = () => ([
    { currency: 'EUR', title: 'ECB Main Refinancing Rate', actual: '2.40%', timestamp: Date.UTC(2026, 5, 11, 12, 15) },
    { currency: 'EUR', title: 'ECB Interest Rate Decision', actual: '2.65%', timestamp: Date.UTC(2026, 5, 11, 12, 15) },   // reconnu par _CAL_TAUX_RX, comme le refi : deux mesures légitimes et rien pour trancher
  ]);
  const MEET_FIX = { NZD: ['2026-07-08', '2026-09-02'], EUR: [], USD: [] };
  /* ⚠️ LE BANC ALIMENTAIT `allCalendar`, ET C'EST PRÉCISÉMENT CE QUI A LAISSÉ PASSER LA PANNE
     (trouvée le 01/09 sur la demande « faut les vraies taux pour toutes les banques »).
     `_calDecisionsTaux` filtrait bien `allCalendar` sur currency / title / actual — sauf qu'en
     PRODUCTION `allCalendar` reçoit les items du FIL ForexFactory, qui n'ont aucun de ces trois
     champs. Le banc, lui, lui donnait une liste de calendrier bien formée : il éprouvait la
     fonction sur des données que la production ne lui a jamais servies, et la voie déterministe
     posée le 30/08 n'a donc jamais écrit un seul taux sans que rien ne rougisse.
     On alimente désormais par les VRAIS canaux (l'instantané du calendrier fusionné, l'archive
     `_calHist`, le flux brut), et le contrôle `f.` ci-dessous rejoue la panne : la même fixture
     posée dans `allCalendar` SEUL, à la forme réelle du fil, ne doit rien produire. */
  const bac = (src, cal, etat, saves, canaux) => new Function(
    'allCalendar', 'SB_CURRENCIES', 'CB', '_ratesState', '_saveRatesState', 'CB_MEETINGS', 'console',
    '_calHist', '_tvCalCache', '_overlayActuals', 'getCalendarRaw',
    src + '\nreturn { _calDecisionsTaux, _actualsDerniereDecision, _calendrierEcritTaux };'
  )((canaux && canaux.allCalendar) || [], SBC, CB_FIX(), etat, () => { saves.n++; }, MEET_FIX, MUET,
    (canaux && canaux.hist) || new Map(),
    { ts: Date.now(), items: (canaux && canaux.hist) ? [] : cal },
    x => x,
    () => (canaux && canaux.brut) || []);
  /* a. La fenêtre de corroboration ne croit QUE le dernier jour de décision. */
  {
    const S = bac(SRC_CAL, CAL_FIX(), { banks: {} }, { n: 0 });
    const evts = S._calDecisionsTaux();
    v('le filtre décisions écarte devise hors périmètre et titre hors sujet',
      evts.length === 6 && !evts.some(e => e.currency === 'CLP' || /GDT/.test(e.title)));
    const a = S._actualsDerniereDecision(evts);
    v('NZD : la décision de MAI (2,25) ne corrobore PLUS — seul juillet (2,50) compte',
      a.NZD && a.NZD.size === 1 && a.NZD.has(2.5) && !a.NZD.has(2.25),
      'c\'est LE trou de v4 : tout actual de 160 j valait preuve');
    v('EUR : les DEUX mesures du même jour restent (dépôt 2,25 + refi 2,40)',
      a.EUR && a.EUR.size === 2 && a.EUR.has(2.25) && a.EUR.has(2.4));
  }
  /* f. LA PANNE DU 01/09, REJOUÉE — et les trois canaux qui la réparent.
     `_calDecisionsTaux` lisait `allCalendar`. En production, `allCalendar` reçoit les items du FIL
     ForexFactory : { id, timestamp, time, category, source, headline, description, tags, impact,
     priority }. Pas de `currency`, pas de `title`, pas d'`actual` — les trois champs sur lesquels
     le filtre s'appuie. Il rendait donc toujours une liste vide, et avec elle « la dernière décision
     réelle écrit le taux » n'écrivait jamais rien. Le contrôle ci-dessus ne le voyait pas : il
     servait à la fonction un calendrier bien formé, que la production ne lui donne pas.
     On éprouve donc les DEUX moitiés : la forme réelle du fil ne doit rien produire, et chacune des
     trois listes qui portent vraiment ces champs doit être lue. */
  {
    const FIL_FF = [{ id: 'ff-cal-1', timestamp: T_JUIL, time: '04:00', category: 'RBNZ', source: 'ForexFactory',
      headline: 'Official Cash Rate 2.50 ↑ vs. Exp. 2.25 (Prev. 2.25)', description: 'Actual: 2.50 | Expected: 2.25 | Previous: 2.25',
      tags: ['RBNZ', 'NZD', 'High'], impact: 'High', priority: 'high' }];
    const parCanal = c => bac(SRC_CAL, [], { banks: {} }, { n: 0 }, c)._calDecisionsTaux().length;
    v('la forme RÉELLE de `allCalendar` (items du fil) ne donne aucune décision — c\'était la panne',
      parCanal({ allCalendar: FIL_FF }) === 0);
    v('… mais l\'archive `_calHist` (≈ 6 mois, persistée) en donne',
      parCanal({ hist: new Map([['NZD||rbnz interest rate decision', { currency: 'NZD', title: 'RBNZ Interest Rate Decision', actual: '2.50%', timestamp: T_JUIL }]]) }) === 1);
    v('… le flux ForexFactory brut aussi', parCanal({ hist: new Map(), brut: CAL_FIX() }) > 0);
    v('… et l\'instantané du calendrier fusionné aussi (canal par défaut de ce banc)',
      bac(SRC_CAL, CAL_FIX(), { banks: {} }, { n: 0 })._calDecisionsTaux().length === 6);
  }
  /* b. L'incident, rejoué : l'état persisté porte le 2,25 empoisonné → le calendrier le répare. */
  {
    const etat = { banks: { NZD: { rate: 2.25, lastMeeting: '2026-07-08' }, EUR: { rate: 2.20, lastMeeting: null }, USD: { rate: 3.75, lastMeeting: null } } }, saves = { n: 0 };
    const S = bac(SRC_CAL, CAL_FIX(), etat, saves);
    const chg = S._calendrierEcritTaux(true);
    v('le 2,25 % persisté est réécrit 2,50 par la décision réelle de juillet (sans IA)',
      chg === true && etat.banks.NZD.rate === 2.5 && saves.n >= 1,
      'obtenu : ' + etat.banks.NZD.rate + ' — la réparation ne doit dépendre d\'aucun modèle');
    /* LA BCE PUBLIE DEUX MESURES LE MÊME JOUR (dépôt 2,25 + refi 2,40) et la carte EUR affiche la
       FACILITÉ DE DÉPÔT — le taux directeur que suit le marché depuis 2014, et celui que porte
       l'ancre de CB[]. S'abstenir, comme jusqu'au 01/09, revenait à ne JAMAIS recaler l'EUR : la
       seule banque des huit qui tombe systématiquement dans le cas d'abstention. On suit donc le
       dépôt quand il se nomme, et l'abstention reste entière dès que rien ne tranche (contrôle
       juste en dessous). */
    v('BCE : c\'est la facilité de DÉPÔT qui écrit le taux (2,25), pas le refi (2,40)',
      etat.banks.EUR.rate === 2.25, 'obtenu : ' + etat.banks.EUR.rate);
    v('USD déjà à jour → aucune écriture superflue', etat.banks.USD.rate === 3.75);
    {
      const e2 = { banks: { EUR: { rate: 2.20, lastMeeting: null } } };
      bac(SRC_CAL, CAL_AMBIGU(), e2, { n: 0 })._calendrierEcritTaux(true);
      v('deux mesures le même jour dont AUCUNE ne se nomme → on s\'abstient toujours',
        e2.banks.EUR.rate === 2.20, 'obtenu : ' + e2.banks.EUR.rate + ' — écrire au hasard vaudrait pire que ne rien faire');
    }
    const rejoue = S._calendrierEcritTaux(false);
    v('le throttle (~10 min) absorbe l\'appel suivant : /api/rates toutes les 30 s ne re-scanne pas', rejoue === false);
  }
  /* c. Un actual PÉRIMÉ ne défait pas une réunion plus récente (projection en attente d'actual). */
  {
    const etat = { banks: { NZD: { rate: 2.75, lastMeeting: '2026-09-02' } } };
    const S = bac(SRC_CAL, CAL_FIX(), etat, { n: 0 });
    S._calendrierEcritTaux(true);
    v('l\'actual de juillet ne ramène pas en arrière une réunion de septembre déjà intégrée',
      etat.banks.NZD.rate === 2.75, 'obtenu : ' + etat.banks.NZD.rate);
  }
  /* d. Une donnée aberrante du calendrier (fournisseur cassé) ne s'écrit pas. */
  {
    const cal = CAL_FIX().map(e => e.currency === 'USD' ? { ...e, actual: '13.75%' } : e);
    const etat = { banks: { USD: { rate: 3.75, lastMeeting: null } } };
    const S = bac(SRC_CAL, cal, etat, { n: 0 });
    S._calendrierEcritTaux(true);
    v('un actual à 10 points de l\'ancre est refusé (±3 pts)', etat.banks.USD.rate === 3.75);
  }
  /* e. Le cache IA se re-corrobore À L'APPLICATION : un poison persisté ne repasse plus au boot. */
  {
    const fab = (verified, actuals, etat) => new Function(
      '_aiVerifiedRates', 'CB', '_ratesState', 'CB_MEETINGS', '_saveRatesState', '_actualsDerniereDecision', 'console',
      SRC_APPLY + '\nreturn _applyVerifiedRates;'
    )(verified, CB_FIX(), etat, MEET_FIX, () => {}, () => actuals, MUET);
    const etat1 = { banks: { NZD: { rate: 2.50, lastMeeting: '2026-07-08' } } };
    fab({ NZD: { rate: 2.25, at: 1 } }, { NZD: new Set([2.5]) }, etat1)();
    v('le cache empoisonné (2,25) est REFUSÉ à l\'application : le calendrier dit 2,50',
      etat1.banks.NZD.rate === 2.5, 'obtenu : ' + etat1.banks.NZD.rate + ' — c\'est le chemin exact du retour du poison au démarrage');
    const etat2 = { banks: { NZD: { rate: 2.25, lastMeeting: null } } };
    fab({ NZD: { rate: 2.50, at: 1 } }, { NZD: new Set([2.5]) }, etat2)();
    v('… mais un cache CORROBORÉ s\'applique toujours (2,25 → 2,50)', etat2.banks.NZD.rate === 2.5);
    const etat3 = { banks: { NZD: { rate: 2.25, lastMeeting: null } } };
    fab({ NZD: { rate: 2.50, at: 1 } }, {}, etat3)();
    v('calendrier pas encore chargé → rien n\'est appliqué (le refus est le sens sûr)', etat3.banks.NZD.rate === 2.25);
  }
  /* f. MUTATIONS : on retire chaque garde-fou du code extrait et le contrôle correspondant doit
        BASCULER — sinon le banc « passe » pour de mauvaises raisons. */
  {
    const m1 = SRC_CAL.replace('if (jour !== jours[e.currency]) return;', '');
    v('mutation « fenêtre entière » détectée (sans la borne au dernier jour, mai revient)',
      m1 !== SRC_CAL && (() => {
        const a = bac(m1, CAL_FIX(), { banks: {} }, { n: 0 })._actualsDerniereDecision();
        return a.NZD && a.NZD.has(2.25);
      })());
    /* La mutation vise LA DÉCISION NOUVELLE : quelle mesure suit la carte EUR quand la BCE en publie
       deux le même jour. Sur une vraie ambiguïté (CAL_AMBIGU, deux valeurs et rien pour trancher)
       aucune mutation d'un seul mot ne peut faire écrire quoi que ce soit — l'abstention y est
       tenue par l'absence de candidat, pas par une comparaison. Ce qui se mute, et donc ce qu'il
       faut éprouver, c'est le NOM de la mesure retenue : viser l'autre ligne du même jour écrirait
       2,40 sur une carte qui affiche 2,25. */
    const m2 = SRC_CAL.replace('/deposit/i.test(e.title || \'\')', '/decision/i.test(e.title || \'\')');
    v('mutation « mauvaise mesure » détectée (l\'autre ligne du jour s\'écrirait à la place de la facilité de dépôt)',
      m2 !== SRC_CAL && (() => {
        const etat = { banks: { EUR: { rate: 2.20, lastMeeting: null } } };
        bac(m2, CAL_FIX(), etat, { n: 0 })._calendrierEcritTaux(true);
        return etat.banks.EUR.rate === 2.4;
      })());
    const m3 = SRC_CAL.replace(/\n\s*if \(st\.lastMeeting && Date\.parse\(jour[^\n]*return;\n/, '\n');
    v('mutation « retour arrière » détectée (l\'actual de juillet défait septembre)',
      m3 !== SRC_CAL && (() => {
        const etat = { banks: { NZD: { rate: 2.75, lastMeeting: '2026-09-02' } } };
        bac(m3, CAL_FIX(), etat, { n: 0 })._calendrierEcritTaux(true);
        return etat.banks.NZD.rate === 2.5;
      })());
    const m4 = SRC_APPLY.replace("\n        && _tauxCorrobore(actuals[b.code], v.rate)", '');
    v('mutation « application aveugle » détectée (le poison du cache repasserait au boot)',
      m4 !== SRC_APPLY && (() => {
        const etat = { banks: { NZD: { rate: 2.50, lastMeeting: null } } };
        new Function('_aiVerifiedRates', 'CB', '_ratesState', 'CB_MEETINGS', '_saveRatesState', '_actualsDerniereDecision', 'console',
          m4 + '\nreturn _applyVerifiedRates;')({ NZD: { rate: 2.25, at: 1 } }, CB_FIX(), etat, MEET_FIX, () => {}, () => ({ NZD: new Set([2.5]) }), MUET)();
        return etat.banks.NZD.rate === 2.25;
      })());
  }
}
/* La voie IA elle-même est passée sur les mêmes rails : un seul filtre de décisions, une seule
   fenêtre de corroboration — deux définitions divergeraient tôt ou tard. */
v('_aiVerifyRates corrobore via _actualsDerniereDecision (une seule définition de la preuve)',
  /const calActuals = _actualsDerniereDecision\(calEvts\);/.test(SRV)
  && /const calEvts = _calDecisionsTaux\(\)\.slice\(0, 45\);/.test(SRV));
v('_buildRatesPayload appelle la voie calendrier (recalage en continu, pas seulement au boot)',
  /try \{ _calendrierEcritTaux\(\); \} catch \{\}/.test(SRV));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

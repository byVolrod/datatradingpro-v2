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
  /* ⚠️ RE-VÉRIFIÉ le 17/09 : la réunion RBNZ du 02/09, pricée à 2,50 jusqu'ici, a EU LIEU — l'OCR est
     passé à 2,75 (rbnz.govt.nz, Bloomberg). L'ancre suit désormais la décision RÉELLE, pas le
     pricing d'AVANT la réunion ; la conviction repasse au générique (0,60) faute de pricing marché
     vérifié pour la PROCHAINE réunion (28/10, paywall). */
  v('l\'ancre NZD porte la décision confirmée sur rbnz.govt.nz (2,75 · hike, 02/09)',
    nz && nz.rate === 2.75 && nz.bias === 'hike', nz && (nz.rate + ' · ' + nz.bias));
  const rnz = S._cbResolved(nz);
  v('le biais IA ne renverse PLUS une banque ancrée', rnz.bias === 'hike' && rnz.conv === 0.60,
    'résolu : ' + rnz.bias + ' ' + rnz.conv + ' — l\'incident client, à l\'identique');
  /* … ET LA MOITIÉ QUI COMPTE : l'IA reste légitime sur une banque NON ancrée. */
  const eu = S.CB.find(b => b.code === 'EUR');
  const reu = S._cbResolved(eu);
  v('… mais s\'applique toujours à une banque non ancrée', reu.bias === 'cut' && reu.conv === 0.55,
    'résolu : ' + reu.bias + ' — l\'actualisation IA ne doit pas mourir, seulement respecter l\'ancre');
  /* La preuve arithmétique de l'incident, gardée comme régression : hold/0,50 fabrique EXACTEMENT
     la carte fautive du client (50/19/31, Δ −3). Le second cas (hike/0,93) n'est PLUS la conviction
     vivante de l'ancre NZD depuis le 17/09 (retombée à 0,60, voir plus haut) — gardé tel quel comme
     simple régression MATHÉMATIQUE de `_rateScenario` à haute conviction, découplée de la config. */
  const scH = S._rateScenario({ bias: 'hold', conv: 0.50, step: 25 }, 0);
  const scK = S._rateScenario({ bias: 'hike', conv: 0.93, step: 25 }, 0);
  v('hold/0,50 reproduit la carte fautive (50/19/31, Δ −3)',
    Math.round(scH.hold * 100) === 50 && Math.round(scH.cut * 100) === 31 && +scH.impliedBps.toFixed(1) === -3,
    JSON.stringify(scH));
  v('hike/0,93 (régression mathématique, plus l\'ancre vivante) donne 93 % de hausse, Δ +22,9',
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
  /* ⚠️ LE BADGE DE TÊTE (« pricing modélisé »/« pricing marché ») A ÉTÉ RETIRÉ LE 17/09, SUR DEMANDE
     EXPLICITE DE L'UTILISATEUR APRÈS AVOIR ÉTÉ PRÉVENU DE L'INCIDENT QU'IL FERMAIT (29/08 : un
     client a comparé l'estimation maison à un pricing OIS réel en croyant comparer deux pricings).
     Ce banc a longtemps exigé ce badge comme LE garde-fou non négociable ; il vérifie maintenant
     l'inverse — que la décision du 17/09 est bien appliquée PARTOUT sur la carte, sans laisser une
     trace à moitié retirée (un badge qui reviendrait sur une seule des deux branches serait pire
     que les deux présents : incohérent). La provenance, elle, N'A PAS disparu : elle reste servie
     telle quelle par /api/rates (`_origineTaux`) et citée en toutes lettres dans les rapports
     rédigés (Hebdo, Point Marché, Radar de Biais — couverts plus bas dans ce même fichier, section
     « Les textes disent la vraie source », INCHANGÉE par ce retrait). */
  v('la carte modélisée ne porte plus de badge de source du tout',
    !lireSrc(incident), 'trouvé : ' + JSON.stringify(lireSrc(incident)));
  v('… ni le mot « modélisé », ni le mot « marché », nulle part sur la carte',
    !/modélis/i.test(incident) && !/pricing march/i.test(incident), incident.slice(0, 200));
  /* ⚠️ LE PIED DE CARTE A ÉTÉ RETIRÉ LE 02/09 (demande utilisateur citant la phrase mot pour mot).
     Il citait les sources — utile — mais il déversait aussi du diagnostic interne sur la carte d'un
     client payant : « abonnement Pro requis chez le fournisseur (HTTP 401) ». Les cinq contrôles qui
     éprouvaient sa rédaction sont retirés avec lui : un banc qui exige un élément supprimé est un
     banc qui empêche de le supprimer. Cette garde-là reste vraie même sans le badge de tête. */
  v('le pied de carte a bien disparu du rendu (plus aucune carte ne l\'écrit)',
    !/rtc-srcs/.test(incident) && !/Taux directeur/.test(incident), (incident.match(/.{0,60}rtc-srcs.{0,40}/) || [''])[0]);
  v('… et le diagnostic interne ne peut plus atteindre le client (ni code HTTP, ni paywall)',
    !/HTTP 401|abonnement Pro/.test(incident), (incident.match(/.{0,50}(HTTP 401|abonnement Pro).{0,40}/) || [''])[0]);

  /* Mouvement pricé à 0 % au prochain rendez-vous → repli sur le scénario central, jamais « X · 0,00% ». */
  const zero = card({ ...base, stance: 'HIKE', source: 'market',
    scenario: { hold: 69, hike: 0, cut: 31 },
    meetings: [{ date: '2026-09-02', days: 5, hold: 69, hike: 0, cut: 31, impliedBps: -7, baseCase: 'HOLD' }] });
  v('un mouvement pricé à 0 % bascule sur le scénario central', lireMv(zero) === 'Maintien' && lireP(zero) === '69,00%',
    lireMv(zero) + ' · ' + lireP(zero));
  v('… et une carte de marché ne porte pas non plus de badge', !lireSrc(zero), lireSrc(zero));
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
  /panne: _rpPanne\[slug\] \|\| 'jamais reçu',/.test(SRV) && /let _rpAt = _rpBankAt\[b\.code\] \|\| _rpCache\.at \|\| 0;/.test(SRV) && /srcAt: _rpAt \|\| null,/.test(SRV));   // par banque ; WatchTower (24/09) y pose sa propre date
/* ⚠️ LE BADGE QUI AFFICHAIT `panne`/`srcAt` AU SURVOL A DISPARU AVEC LUI LE 17/09 (retrait demandé
   par l'utilisateur, cf. le pavé « LE BADGE DE TÊTE… » plus haut dans ce fichier). Les DEUX champs
   restent servis par /api/rates (contrôle ci-dessus) : seule leur AFFICHAGE sur la carte a disparu,
   pas la donnée elle-même — exactement le même principe que le pied de carte retiré le 02/09. */
v('… et le champ `b.panne`/`b.srcAt` a bien quitté charts.js avec le badge (rien de résiduel)',
  !/b\.panne \? ' \(' \+ b\.panne \+ '\)'/.test(CHARTS) && !/b\.srcAt \? ', dernière donnée reçue à '/.test(CHARTS));
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
    { currency: 'NZD', title: 'RBNZ Rate Statement', actual: '2.50%', forecast: '2.50%', previous: '2.25%', timestamp: T_JUIL },   // forme réelle (calhist:events) : un communiqué ne porte un chiffre qu'accompagné de sa prévision
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
  /* 23/09 : `_calDecisionsTaux` n'entend plus que des résultats COHÉRENTS avec leur ligne
     (`_calActualCoherent`) — on lui passe la VRAIE fonction, extraite de server.js. */
  const SRC_COH = (() => {
    const d = SRV.indexOf('const _CAL_SANS_CHIFFRE_RX');
    const f = SRV.indexOf('\n}', SRV.indexOf('function _calActualCoherent('));
    return (d < 0 || f < 0) ? null : SRV.slice(d, f + 2);
  })();
  v('_calActualCoherent est extractible (le filtre de cohérence des décisions)', !!SRC_COH);
  const COH = SRC_COH ? new Function(SRC_COH + '\nreturn _calActualCoherent;')() : (() => true);
  const bac = (src, cal, etat, saves, canaux) => new Function(
    'allCalendar', 'SB_CURRENCIES', 'CB', '_ratesState', '_saveRatesState', 'CB_MEETINGS', 'console',
    '_calHist', '_tvCalCache', '_overlayActuals', 'getCalendarRaw', '_calActualCoherent',
    src + '\nreturn { _calDecisionsTaux, _actualsDerniereDecision, _calendrierEcritTaux };'
  )((canaux && canaux.allCalendar) || [], SBC, CB_FIX(), etat, () => { saves.n++; }, MEET_FIX, MUET,
    (canaux && canaux.hist) || new Map(),
    { ts: Date.now(), items: (canaux && canaux.hist) ? [] : cal },
    x => x,
    () => (canaux && canaux.brut) || [], COH);
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
  /* g. L'INCIDENT DU 23/09, REJOUÉ : la hausse Fed du 16/09 (4 %) ne s'écrivait pas, parce qu'une
     dépêche avait déposé « 2.425 » sur « Federal Funds Rate » le même jour (valeurs relevées telles
     quelles dans calhist:events). Deux chiffres le même jour → abstention → carte figée à 3,75. */
  {
    const T_FOMC = Date.UTC(2026, 8, 16, 18, 0);
    const CAL_FOMC = () => ([
      { currency: 'USD', title: 'Fed Interest Rate Decision', actual: '4%', forecast: '4%', previous: '3.75%', timestamp: T_FOMC },
      { currency: 'USD', title: 'Federal Funds Rate', actual: '2.425', forecast: '4.00%', previous: '3.75%', timestamp: T_FOMC },
      { currency: 'USD', title: 'FOMC Statement', actual: '2.425', forecast: '', previous: '', timestamp: T_FOMC },
    ]);
    const etat1 = { banks: { USD: { rate: 3.75, lastMeeting: '2026-09-16' } } };
    new Function('allCalendar', 'SB_CURRENCIES', 'CB', '_ratesState', '_saveRatesState', 'CB_MEETINGS', 'console',
      '_calHist', '_tvCalCache', '_overlayActuals', 'getCalendarRaw', '_calActualCoherent', SRC_CAL + '\nreturn _calendrierEcritTaux;')(
      [], SBC, [{ code: 'USD', rate: 3.75 }], etat1, () => {}, { USD: ['2026-09-16'] }, MUET, new Map(), { ts: Date.now(), items: CAL_FOMC() }, x => x, () => [], COH)(true);
    v('Fed 16/09 : la hausse à 4 % s\'écrit malgré le « 2.425 » d\'une dépêche sur « Federal Funds Rate »',
      etat1.banks.USD.rate === 4, 'obtenu : ' + etat1.banks.USD.rate);
    /* 24/09 : l'ARBITRAGE (valeur plausible, intitulé canonique) est une seconde garde, indépendante du
       filtre de cohérence. Le témoin coupe donc LES DEUX pour rejouer l'incident — et un contrôle vérifie
       que l'arbitrage, seul, suffit déjà. */
    const SANS_ARB = SRC_CAL.replace("else if (plausibles.length === 1) n = plausibles[0];", '').replace("else if (canon.length === 1 && plausibles.includes(canon[0])) n = canon[0];", '');
    v('(témoin) la mutation retire bien l\'arbitrage', SANS_ARB !== SRC_CAL);
    const etat3 = { banks: { USD: { rate: 3.75, lastMeeting: '2026-09-16' } } };
    new Function('allCalendar', 'SB_CURRENCIES', 'CB', '_ratesState', '_saveRatesState', 'CB_MEETINGS', 'console',
      '_calHist', '_tvCalCache', '_overlayActuals', 'getCalendarRaw', '_calActualCoherent', SRC_CAL + '\nreturn _calendrierEcritTaux;')(
      [], SBC, [{ code: 'USD', rate: 3.75 }], etat3, () => {}, { USD: ['2026-09-16'] }, MUET, new Map(), { ts: Date.now(), items: CAL_FOMC() }, x => x, () => [], () => true)(true);
    v('sans le filtre de cohérence, l\'arbitrage seul écrit déjà la hausse (4 %)', etat3.banks.USD.rate === 4, 'obtenu : ' + etat3.banks.USD.rate);
    const etat2 = { banks: { USD: { rate: 3.75, lastMeeting: '2026-09-16' } } };
    new Function('allCalendar', 'SB_CURRENCIES', 'CB', '_ratesState', '_saveRatesState', 'CB_MEETINGS', 'console',
      '_calHist', '_tvCalCache', '_overlayActuals', 'getCalendarRaw', '_calActualCoherent', SANS_ARB + '\nreturn _calendrierEcritTaux;')(
      [], SBC, [{ code: 'USD', rate: 3.75 }], etat2, () => {}, { USD: ['2026-09-16'] }, MUET, new Map(), { ts: Date.now(), items: CAL_FOMC() }, x => x, () => [], () => true)(true);
    v('(témoin) sans le filtre de cohérence NI l\'arbitrage, la carte reste figée à 3,75 — l\'incident exact',
      etat2.banks.USD.rate === 3.75, 'obtenu : ' + etat2.banks.USD.rate + ' — si 4, le témoin ne mord plus');
    /* 24/09, l'incident BoJ tel que mesuré en base : « BoJ Interest Rate Decision » 1,25 % et, le même
       jour, « BOJ Policy Rate » à « 2% » (prévision « <1.25% »). Avant : abstention → 1,00 % figé. */
    const T_BOJ = Date.UTC(2026, 8, 18, 3, 0);
    const CAL_BOJ = () => ([
      { currency: 'JPY', title: 'BoJ Interest Rate Decision', actual: '1.25%', forecast: '1.25%', previous: '1%', timestamp: T_BOJ },
      { currency: 'JPY', title: 'BOJ Policy Rate', actual: '2%', forecast: '<1.25%', previous: '<1.00%', timestamp: T_BOJ },
    ]);
    const etatJ = { banks: { JPY: { rate: 1, lastMeeting: '2026-09-18' } } };
    new Function('allCalendar', 'SB_CURRENCIES', 'CB', '_ratesState', '_saveRatesState', 'CB_MEETINGS', 'console',
      '_calHist', '_tvCalCache', '_overlayActuals', 'getCalendarRaw', '_calActualCoherent', SRC_CAL + '\nreturn _calendrierEcritTaux;')(
      [], SBC, [{ code: 'JPY', rate: 1 }], etatJ, () => {}, { JPY: ['2026-09-18'] }, MUET, new Map(), { ts: Date.now(), items: CAL_BOJ() }, x => x, () => [], COH)(true);
    v('BoJ 18/09 : la hausse à 1,25 % s\'écrit malgré la ligne parasite à « 2% »', etatJ.banks.JPY.rate === 1.25, 'obtenu : ' + etatJ.banks.JPY.rate);
    const etatJ2 = { banks: { JPY: { rate: 1, lastMeeting: '2026-09-18' } } };
    new Function('allCalendar', 'SB_CURRENCIES', 'CB', '_ratesState', '_saveRatesState', 'CB_MEETINGS', 'console',
      '_calHist', '_tvCalCache', '_overlayActuals', 'getCalendarRaw', '_calActualCoherent', SANS_ARB + '\nreturn _calendrierEcritTaux;')(
      [], SBC, [{ code: 'JPY', rate: 1 }], etatJ2, () => {}, { JPY: ['2026-09-18'] }, MUET, new Map(), { ts: Date.now(), items: CAL_BOJ() }, x => x, () => [], COH)(true);
    v('(témoin) sans l\'arbitrage, la BoJ reste figée à 1,00 % — l\'incident du 18/09', etatJ2.banks.JPY.rate === 1, 'obtenu : ' + etatJ2.banks.JPY.rate);
    /* La source de marché recale l'état : Fed au MILIEU 3,875 → borne haute 4,00 ; une donnée aberrante ne passe pas. */
    {
      const dS = SRV.indexOf('function _rpSyncEtat('), fS = SRV.indexOf('\n}\n', dS) + 3;
      const SYNC = dS >= 0 ? SRV.slice(dS, fS) : '';
      v('_rpSyncEtat est extractible', !!SYNC);
      const etatS = { banks: { USD: { rate: 3.75 }, JPY: { rate: 1 }, GBP: { rate: 3.75 } } };
      const sync = new Function('_ratesState', 'console', SYNC + '\nreturn _rpSyncEtat;')(etatS, MUET);
      sync('USD', { rate: 3.875 }); sync('JPY', { rate: 1.25 }); sync('GBP', { rate: 9.9 });
      v('Fed : milieu 3,875 → borne haute 4,00 dans l\'état du desk', etatS.banks.USD.rate === 4, 'obtenu : ' + etatS.banks.USD.rate);
      v('BoJ : 1,25 recopié', etatS.banks.JPY.rate === 1.25);
      v('une valeur aberrante (écart > 1,5 pt) ne touche pas l\'état', etatS.banks.GBP.rate === 3.75);
    }
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   LA CARTE DIT QUELLE MESURE ELLE AFFICHE (10/09, question user : « le taux de la BCE c'est 2,65 »)
   ──────────────────────────────────────────────────────────────────────────────────────────────
   La BCE publie DEUX taux le même jour : la facilité de dépôt et le refinancement principal,
   séparés de 15 pb depuis la réforme du corridor de septembre 2024. La carte affiche
   délibérément la FACILITÉ DE DÉPÔT (décision du 01/09, écrite dans _calendrierEcritTaux) — c'est
   le taux directeur effectif que le marché price. Mais tant que l'intitulé disait « Taux actuel »
   tout court, un lecteur qui a le refi en tête voyait une erreur là où il n'y en avait pas.
   Le doute est revenu par la question de l'utilisateur : ces contrôles ferment la porte.
   ⚠️ LES DEUX MOITIÉS COMPTENT. Nommer la mesure ne sert à rien si le code cesse de choisir le
   dépôt : le libellé deviendrait alors un MENSONGE signé, pire que l'ambiguïté d'avant. On tient
   donc l'affichage ET la règle de sélection, ensemble. ════════════════════════════════════════ */
console.log('\n── La carte nomme la mesure exacte qu’elle affiche ──');
{
  const CH = fs.readFileSync(path.join(__dirname, '..', 'public/js/charts.js'), 'utf8');
  v('une table _RTC_MESURE existe (pas un cas particulier codé en dur)',
    /const _RTC_MESURE = \{/.test(CH) && !/b\.code === 'ECB' \?/.test(CH),
    'un `if (code === ECB)` se retrouverait seul face à la prochaine banque qui publie deux mesures');
  v('… la carte BCE annonce le TAUX DE DÉPÔT', /EUR: 'Taux de dépôt'/.test(CH));
  v('… la carte Fed annonce la FOURCHETTE', /USD: 'Fed funds \(fourchette\)'/.test(CH),
    'la Fed annonce une fourchette : un chiffre seul ne dit ni haut, ni bas, ni milieu');
  /* ⚠️ LA TABLE ÉTAIT MORTE (23/09) : clée « ECB »/« FED » quand chaque carte porte le code DEVISE
     servi par /api/rates. Les deux contrôles ci-dessus lisaient le TEXTE et passaient au vert. On
     compare donc les clés aux codes que CB[] sert réellement. */
  {
    const mT = /const _RTC_MESURE = \{([\s\S]*?)\n\};/.exec(CH);
    const cles = mT ? [...mT[1].matchAll(/^\s*([A-Z]{3}):/gm)].map(x => x[1]) : [];
    const codes = [...SRV.slice(SRV.indexOf('const CB = ['), SRV.indexOf('\n];', SRV.indexOf('const CB = ['))).matchAll(/code:'([A-Z]{3})'/g)].map(x => x[1]);
    v('… et chaque clé de _RTC_MESURE est un code réellement servi (sinon la table ne s\'affiche jamais)',
      cles.length >= 2 && codes.length >= 8 && cles.every(c => codes.includes(c)), 'clés ' + cles.join(',') + ' / codes ' + codes.join(','));
    v('… la carte écrit la fourchette quand le serveur la fournit', /b\.band \? num\(b\.band\.lo, 2\) \+ '–' \+ num\(b\.band\.hi, 2\)/.test(CH));
  }
  v('… et l’intitulé est bien branché sur la table, pas figé', /_RTC_MESURE\[b\.code\] \|\| 'Taux actuel'/.test(CH),
    'sans ce branchement la table existe et ne s’affiche nulle part');
  v('le haut de fourchette est bien ce que porte la config Fed', /3,75 = borne HAUTE/.test(SRV) || /borne HAUTE/.test(SRV),
    'si la config passait au bas ou au milieu, le libellé « (haut) » deviendrait faux');
  /* La règle de sélection, côté serveur : quand les deux mesures BCE tombent le même jour, c'est
     celle qui porte « deposit » qui est retenue. Le libellé de la carte en DÉPEND. */
  /* L'autre moitié du doute vient de ce qu'on lit AILLEURS : les sites grand public titrent le
     taux de la zone euro sur le REFINANCEMENT. Le survol doit nommer les deux, sinon la
     comparaison rouvre la question que le libellé vient de fermer. */
  v('… et le survol explique l’écart avec le refinancement principal',
    /_RTC_MESURE_AIDE/.test(CH) && /refinancement principal/.test(CH) && /15 points de base/.test(CH),
    'sans cette aide, comparer avec une source externe fait rouvrir la question');
  v('… l’aide est bien BRANCHÉE sur le libellé (title), pas seulement déclarée',
    /_RTC_MESURE_AIDE\[b\.code\] \? ' title="'/.test(CH),
    'une table d’aide que rien n’affiche est du texte mort');
  v('_calendrierEcritTaux tranche toujours sur « deposit » quand la BCE publie deux chiffres',
    /\/deposit\/i\.test\(e\.title/.test(SRV),
    'la sélection ne vise plus le dépôt : le libellé « Taux de dépôt » affirmerait alors quelque chose de faux.');
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   NE PAS JETER UNE DONNÉE QU'ON A REÇUE (11/09)
   ──────────────────────────────────────────────────────────────────────────────────────────────
   Deux banques sur huit tombent en estimation maison. `_rpPanne` enregistre la cause PAR BANQUE,
   et toutes ne se valent pas : un HTTP 401 est un paywall (rien à faire côté code), mais
   « clés inattendues » signifie que la réponse est arrivée COMPLÈTE et GRATUITE et qu'on l'a
   jetée faute de reconnaître un nom de champ. Vu du client les deux se ressemblent : même badge,
   même repli. C'est le genre d'échec qui se fait passer pour une fatalité.
   ⚠️ ÉLARGIR LA RECONNAISSANCE N'EST PAS RELÂCHER LA GARDE, et les deux témoins ci-dessous le
   tiennent : sans champ de taux, ou avec un champ non numérique, on rend NaN — donc le repli
   maison et son badge honnête. On n'invente JAMAIS un taux. ════════════════════════════════════ */
console.log('\n── Le pricing de marché ne se perd pas sur un nom de champ ──');
{
  const CH = fs.readFileSync(path.join(__dirname, '..', 'public/js/charts.js'), 'utf8');
  const d = SRV.indexOf('function _rpRate'); const f = SRV.indexOf('\n}', d) + 2;
  v('_rpRate est extractible de server.js', d >= 0 && f > d);
  if (d >= 0 && f > d) {
    const _rpRate = new Function(SRV.slice(d, f) + '\n return _rpRate;')();
    v('[exécuté] une clé explicite est lue (BCE : facilité de dépôt)',
      _rpRate({ ecb_deposit_facility: 2.5 }, 'ecb_deposit_facility') === 2.5);
    v('[exécuté] une clé INCONNUE mais parlante est reconnue (SNB)',
      _rpRate({ snb_leitzins_policy: 0.25 }) === 0.25,
      'sans ce filet, une réponse gratuite et complète part au repli maison pour un nom de champ');
    v('[exécuté] … y compris en vocabulaire français', _rpRate({ taux_directeur: 3.1 }) === 3.1);
    v('[exécuté] … et l’OCR néo-zélandais', _rpRate({ official_cash_rate: 2.5 }) === 2.5);
    v('[témoin] aucun champ de taux → NaN, donc repli maison',
      Number.isNaN(_rpRate({ label: 'x', updated: '2026' })),
      'le filet accepterait n’importe quoi : il inventerait un taux au lieu de se replier');
    v('[témoin] un champ non numérique → NaN aussi',
      Number.isNaN(_rpRate({ policy_rate: 'n/a' })),
      'une chaîne ne doit jamais passer pour un taux');
  }
  /* La cause exacte doit rester LISIBLE — désormais côté API/diagnostic, pas sur la carte elle-même
     (le badge qui l'affichait au survol a été retiré le 17/09, demande explicite utilisateur). Elle
     distingue toujours un paywall (insoluble) d'un défaut de notre côté (réparable) pour qui va la
     chercher dans /api/rates ou le panneau admin. */
  v('la raison de l’absence de pricing est servie par l’API (champ `panne`)',
    /panne: _rpPanne\[slug\]/.test(SRV),
    'sans la raison, impossible de distinguer un paywall d’un bug à nous');
  v('… et elle a bien quitté la carte avec le badge (rien de résiduel dans charts.js)',
    !/b\.panne \? ' \(' \+ b\.panne \+ '\)'/.test(CH));
}

/* ══ LA DERNIÈRE RÉUNION TENUE, POUR LES HUIT BANQUES (11/09, demande utilisateur) ═══════════════
   « On a les dates réu futures, ajoute aussi la dernière qui est passée, ce serait bien pour toutes
   les banques. » La carte ne montrait que la PROCHAINE réunion : on savait quand la question serait
   reposée, jamais quand elle avait été tranchée, alors que le taux affiché sort précisément de cette
   réunion-là.
   ⚠️ ON EXÉCUTE LA VRAIE FONCTION, EXTRAITE DE server.js. Un banc qui se contenterait de vérifier
   que la chaîne « last: » existe dans le fichier serait vert sur une fonction qui rend toujours
   null — c'est-à-dire sur un tiret à l'écran pour les huit banques. */
{
  console.log('\n── La dernière réunion tenue ──');
  const d = SRV.indexOf('function _derniereReunion');
  const f = SRV.indexOf('\n}', d) + 2;
  v('_derniereReunion est extractible de server.js', d >= 0 && f > d);
  const mD = SRV.match(/const CB_MEETINGS = \{[\s\S]*?\n\};/);
  v('le calendrier CB_MEETINGS est extractible', !!mD);
  if (d >= 0 && f > d && mD) {
    const _der = new Function(mD[0] + '\n' + SRV.slice(d, f) + '\nreturn _derniereReunion;')();
    const CODES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
    /* Un instant FIXE, choisi au milieu du calendrier : un banc calé sur `Date.now()` changerait de
       verdict avec le temps, et se mettrait à mentir sans qu'on touche au code. */
    const T = Date.parse('2026-09-11T12:00:00Z');
    const manquantes = CODES.filter(c => !_der(c, T).date);
    v('[exécuté] les HUIT banques ont une dernière réunion datée', manquantes.length === 0,
      'sans date : ' + manquantes.join(', ') + ' — la carte afficherait un tiret');
    /* ⚠️ ELLE EST BIEN PASSÉE, et c'est la moitié du contrôle : une fonction qui rendrait la
       PROCHAINE réunion passerait le contrôle ci-dessus sans rien réparer. */
    const futures = CODES.filter(c => { const r = _der(c, T); return r.date && Date.parse(r.date + 'T00:00:00Z') >= T; });
    v('[exécuté] … et chacune est bien ANTÉRIEURE à l\'instant mesuré', futures.length === 0,
      'dates futures rendues pour : ' + futures.join(', ') + ' : ce serait la prochaine, pas la dernière');
    /* ⚠️ ET C'EST LA PLUS RÉCENTE DES PASSÉES, pas n'importe laquelle. Sans ce contrôle, rendre la
       PREMIÈRE réunion du calendrier passerait les deux précédents. */
    const eur = _der('EUR', T);
    v('[exécuté] … et c\'est la PLUS RÉCENTE des réunions passées', eur.date === '2026-09-10',
      'BCE au 11/09 : attendu 2026-09-10, obtenu ' + eur.date);
    v('[exécuté] … avec son ancienneté en jours', eur.jours === 1, 'obtenu ' + eur.jours + ' jour(s)');
    /* [témoin] Un code inconnu ne doit pas inventer de date. */
    v('[témoin] une banque hors calendrier ne reçoit aucune date', _der('XXX', T).date === null,
      'une date inventée pour un code inconnu serait pire qu\'un tiret');
    /* [témoin] Avant la première réunion du calendrier, il n'y a rien à rendre. */
    v('[témoin] avant la première réunion connue, aucune date', _der('USD', Date.parse('2026-01-01T00:00:00Z')).date === null,
      'rendre une date antérieure au calendrier reviendrait à en fabriquer une');
  }
  /* Les deux chemins de rendu du serveur doivent porter le champ : celui du pricing de marché ET
     le repli maison. En équiper un seul laisserait la moitié des banques sans date. */
  v('les DEUX chemins du serveur portent la dernière réunion',
    (SRV.match(/last: _der\.date/g) || []).length === 2,
    'un seul chemin équipé : les banques servies par l\'autre afficheraient un tiret');
  /* ⚠️ `CH` EST DÉCLARÉ DANS UN BLOC PRÉCÉDENT, DONC INVISIBLE ICI — et `node -c` ne le voit pas :
     la grammaire est parfaite, l'erreur n'arrive qu'à l'exécution. C'est exactement le piège que ce
     dépôt a documenté le 10/09 (une fonction appelée hors de sa portée, syntaxe impeccable). On
     relit donc le fichier ici. */
  const CHARTS = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
  /* Et la carte doit l'AFFICHER : un champ servi que personne ne lit est du texte mort. */
  v('la carte affiche « Dernière réunion »', /Dernière réunion<\/span>/.test(CHARTS),
    'le champ est servi et aucune ligne ne le montre');
  v('… et « Date de réunion » devient explicite (« Prochaine réunion »)', /Prochaine réunion<\/span>/.test(CHARTS),
    'deux dates sur la même carte sans intitulé distinct se confondent');
  v('… en lisant b.last, pas une valeur recopiée', /b\.last \? fr\(b\.last\)/.test(CHARTS));
}

console.log('\n── Le pipeline de taux le dit quand il s\'arrête (17/09) ──');
/* ⚠️ POURQUOI. Mesuré en base primaire, le 17/09 : `rates:rateprob` figé au 9 septembre, huit
   jours de retard, alors que le cycle normal rafraîchit toutes les 90 s à 3 min. La fusion par
   banque (ci-dessus, section « ne se perd pas sur un nom de champ ») protège contre l'échec d'UNE
   banque isolée ; elle ne dit rien si le cycle ENTIER cesse de progresser. `_rpVerifierFraicheur`
   ferme ce trou en surveillant l'ÂGE du cache plutôt que le résultat d'un seul cycle. ON EXÉCUTE
   LA VRAIE FONCTION extraite de server.js — pas une copie — avec un faux mailer qui capture ce
   qu'il reçoit. */
{
  const iDebut = SRV.indexOf('let _rpAlerteEnvoyee = false;');
  const iFin = SRV.indexOf("\nsetInterval(() => { _refreshRateProb().then(_rpVerifierFraicheur)", iDebut);
  const bloc = (iDebut >= 0 && iFin > iDebut) ? SRV.slice(iDebut, iFin) : null;
  v('`_rpVerifierFraicheur` est extractible de server.js', !!bloc,
    'les ancres ont changé de forme : ce contrôle ne voit plus rien');

  if (bloc) {
    const monter = (source, rpCache, rpPanne) => {
      const appels = [];
      const fauxMailer = { sendAdminAlert: async (a) => { appels.push(a); return 'test'; } };
      const fn = new Function('mailer', 'console', '_rpCache', '_rpPanne',
        source + '\nreturn _rpVerifierFraicheur;')(fauxMailer, { warn() {} }, rpCache, rpPanne);
      return { fn, appels };
    };

    // ── Cas A : cache frais (2 min) → silence ──
    const cacheA = { at: Date.now() - 2 * 60 * 1000 };
    const { fn: fnA, appels: appelsA } = monter(bloc, cacheA, {});
    fnA();
    v('cache frais (2 min) : aucune alerte', appelsA.length === 0, appelsA.length + ' appel(s)');

    // ── Cas B : cache figé depuis 4 h → une alerte, avec la durée et les pannes connues ──
    // (seuil 3 h depuis le 23/09 : le cycle normal est passé à 30 min, 10 min en fenêtre de décision)
    const cacheB = { at: Date.now() - 4 * 3600 * 1000 };
    const { fn: fnB, appels: appelsB } = monter(bloc, cacheB, { snb: 'abonnement Pro requis chez le fournisseur (HTTP 401)' });
    fnB();
    v('cache figé depuis 4 h : une alerte part', appelsB.length === 1, appelsB.length + ' appel(s)');
    if (appelsB.length) {
      v('… le sujet donne la durée en heures', /ne se sont pas rafraîchis depuis 4 h/.test(appelsB[0].subject), appelsB[0].subject);
      v('… le corps liste les pannes connues par banque', /snb/.test(appelsB[0].html) && /abonnement Pro requis/.test(appelsB[0].html), appelsB[0].html);
    }
    fnB();   // rejoué immédiatement, toujours figé
    v('… un second passage, toujours figé, ne renvoie PAS une deuxième alerte pour le même épisode',
      appelsB.length === 1, appelsB.length + ' appel(s) — sans le garde-fou, un pipeline arrêté spammerait la boîte mail toutes les 90 s');

    // ── Cas C : le pipeline reprend → une alerte « RÉSOLU », une seule ──
    cacheB.at = Date.now();   // le cycle vient de réussir
    fnB();
    v('… et la reprise envoie une alerte « RÉSOLU », séparée', appelsB.length === 2, appelsB.length + ' appel(s)');
    if (appelsB.length === 2) v('… qui dit clairement que c\'est résolu', /RÉSOLU/.test(appelsB[1].subject), appelsB[1].subject);
    fnB();   // rejoué, toujours frais : pas de nouveau « RÉSOLU »
    v('… et rester frais ne redéclenche pas « RÉSOLU » en boucle', appelsB.length === 2, appelsB.length + ' appel(s)');

    // ── TÉMOIN : sans le garde-fou anti-répétition, un pipeline arrêté alerterait à CHAQUE tick ──
    const mut = bloc.replace('if (_rpAlerteEnvoyee) return;   // un seul e-mail par épisode, pas un rappel à chaque tick de 90 s tant que ça dure\n  ', '');
    v('(témoin) la mutation retire bien le garde-fou anti-répétition', mut !== bloc,
      'la ligne a changé de forme : ce témoin ne prouve plus rien');
    if (mut !== bloc) {
      const cacheMut = { at: Date.now() - 4 * 3600 * 1000 };
      const { fn: fnMut, appels: appelsMut } = monter(mut, cacheMut, {});
      fnMut(); fnMut(); fnMut();
      v('(témoin) sans le garde-fou, trois passages figés alertent bien trois fois',
        appelsMut.length === 3, appelsMut.length + ' appel(s) — si ce n\'est pas 3, le témoin ne mord plus');
    }
  }
}
/* Le point d'écoute réel : le refresh périodique appelle bien la vérification après CHAQUE tick,
   succès ou échec (un pipeline qui échoue à répétition est exactement le cas qu'on veut voir). */
v('la vérification de fraîcheur est branchée sur le tick périodique (90 s), succès ET échec',
  /_refreshRateProb\(\)\.then\(_rpVerifierFraicheur\)\.catch\(\(\) => \{ _rpVerifierFraicheur\(\); \}\)/.test(SRV),
  'sinon un cycle qui échoue en boucle (catch) ne serait jamais revérifié');
v('… et la persistance loggue désormais son échec au lieu de le taire',
  /aiCacheSet\('rates:rateprob', _rpCache\)\.catch\(e => console\.warn/.test(SRV),
  'un `.catch(() => {})` muet reproduirait exactement le silence mesuré le 17/09');

// ── LE PANEL ADMIN VOIT LA MÊME HORLOGE QUE L'ALERTE MAIL, SANS ATTENDRE SON SEUIL (17/09) ──────
{
  const iDebut2 = SRV.indexOf('function _tauxEtat() {');
  const iFin2 = SRV.indexOf('\n}', iDebut2) + 2;
  const src2 = (iDebut2 >= 0) ? SRV.slice(iDebut2, iFin2) : null;
  v('`_tauxEtat` est extractible de server.js', !!src2);
  if (src2) {
    const PARAMS = ['_rpCache', '_rpPanne', '_rpAlerteEnvoyee', '_RP_SEUIL_ALERTE_MS', '_aiRatesBiasAt', '_AIBIAS_SEUIL_ALERTE_MS', '_rpRelais', '_fcEtat', '_rbaWatch', '_sovCurve', '_snbWatch', '_ecbWatch', '_wtCache'];   // 24/09 : + la lecture BNS (futures SARON Eurex), + la courbe WatchTower
    const _fcStub = () => ({ pose: false, capJour: 40, jour: '', n: 0, okAt: null, errAt: null, err: '' });   // 23/09 : la télémétrie Firecrawl (dernier recours ASX) figure aussi dans _tauxEtat
    const monterEtat = (rpCache, rpPanne, alerteEnvoyee, biaisAt) => new Function(
      ...PARAMS, src2 + '\nreturn _tauxEtat;'
    )(rpCache, rpPanne, alerteEnvoyee, 20 * 60 * 1000, biaisAt || 0, 9 * 86400000, {}, _fcStub, null, {}, null, null, { at: 0, banks: {} });

    const frais = monterEtat({ at: Date.now() - 2 * 60 * 1000, banks: { fed: 1, ecb: 1 } }, {}, false)();
    v('cache frais : `perime` est faux', frais.perime === false, JSON.stringify(frais));
    v('… et le nombre de banques en cache est rendu', frais.banques === 2, JSON.stringify(frais));

    const fige = monterEtat({ at: Date.now() - 25 * 60 * 1000, banks: { fed: 1 } }, { chf: 'HTTP 401' }, true)();
    v('cache figé au-delà du seuil : `perime` est vrai', fige.perime === true, JSON.stringify(fige));
    v('… et l\'état de l\'alerte mail (déjà envoyée ou pas) voyage jusqu\'au panel',
      fige.alerteEnvoyee === true, JSON.stringify(fige));
    v('… et les pannes par banque voyagent aussi jusqu\'au panel', fige.pannes.chf === 'HTTP 401', JSON.stringify(fige));

    const jamais = monterEtat({ at: 0, banks: {} }, {}, false)();
    v('aucun cycle réussi depuis le démarrage : `at` reste à 0, pas de faux frais', jamais.at === 0 && jamais.perime === false, JSON.stringify(jamais));

    // ── LE BIAIS IA (rates:aibias) : un CYCLE HEBDO, un SEUIL DIFFÉRENT (17/09, trouvé figé 14 j) ──
    const biaisFrais = monterEtat({ at: Date.now(), banks: {} }, {}, false, Date.now() - 2 * 86400000)();
    v('biais IA rafraîchi il y a 2 j (< seuil hebdo) : `biaisPerime` est faux', biaisFrais.biaisPerime === false, JSON.stringify(biaisFrais));
    const biaisFige = monterEtat({ at: Date.now(), banks: {} }, {}, false, Date.now() - 14 * 86400000)();
    v('biais IA figé depuis 14 j (> seuil hebdo de 9 j) : `biaisPerime` est vrai', biaisFige.biaisPerime === true, JSON.stringify(biaisFige));
    v('… et son âge voyage jusqu\'au panel', biaisFige.biaisAgeMs >= 14 * 86400000 - 1000, JSON.stringify(biaisFige));
    const biaisJamais = monterEtat({ at: Date.now(), banks: {} }, {}, false, 0)();
    v('aucun cycle biais réussi depuis le démarrage : `biaisAt` reste à 0, pas de faux frais',
      biaisJamais.biaisAt === 0 && biaisJamais.biaisPerime === false, JSON.stringify(biaisJamais));

    // TÉMOIN : sans le seuil comparé à l'âge réel, un cache vieux de plusieurs heures se dirait frais.
    const mut2 = src2.replace('(Date.now() - at) >= _RP_SEUIL_ALERTE_MS', 'false');
    v('(témoin) la mutation retire bien la comparaison de fraîcheur', mut2 !== src2,
      'la ligne a changé de forme : ce témoin ne prouve plus rien');
    if (mut2 !== src2) {
      const figeMut = new Function(...PARAMS,
        mut2 + '\nreturn _tauxEtat;')({ at: Date.now() - 5 * 3600e3, banks: {} }, {}, false, 20 * 60 * 1000, 0, 9 * 86400000, {}, _fcStub, null, {}, null, null, { at: 0, banks: {} })();
      v('(témoin) sans la comparaison, un cache vieux de 5 h se dirait faussement frais',
        figeMut.perime === false, JSON.stringify(figeMut));
    }

    // TÉMOIN : sans le seuil du biais, un biais vieux de 14 j se dirait frais lui aussi.
    const mut3 = src2.replace('(Date.now() - biaisAt) >= _AIBIAS_SEUIL_ALERTE_MS', 'false');
    v('(témoin) la mutation retire bien la comparaison de fraîcheur du biais', mut3 !== src2,
      'la ligne a changé de forme : ce témoin ne prouve plus rien');
    if (mut3 !== src2) {
      const biaisMut = new Function(...PARAMS,
        mut3 + '\nreturn _tauxEtat;')({ at: Date.now(), banks: {} }, {}, false, 20 * 60 * 1000, Date.now() - 14 * 86400000, 9 * 86400000, {}, _fcStub, null, {}, null, null, { at: 0, banks: {} })();
      v('(témoin) sans la comparaison, un biais figé depuis 14 j se dirait faussement frais',
        biaisMut.biaisPerime === false, JSON.stringify(biaisMut));
    }
  }
  v('server.js expose `taux` dans le moniteur admin, protégé par try/catch (ne jette jamais)',
    /taux: \(\(\) => \{ try \{ return _tauxEtat\(\); \} catch \(e\) \{ return null; \} \}\)\(\)/.test(SRV));

  // `_aiRatesBiasAt` doit être posé sur les DEUX chemins de succès (cache-hit ET génération fraîche) —
  // sinon le panel resterait aveugle sur exactement le chemin qui a échoué en silence (mesuré 17/09 :
  // le cache-hit marchait, la génération fraîche du samedi échouait — ou l'inverse, sans horodatage
  // séparé des deux il est impossible de savoir LEQUEL).
  v('`_aiRatesBiasAt` est posé au chargement depuis le cache (cache-hit)',
    /_aiRatesBias = cached\.banks; _aiRatesBiasAt = cached\.at;/.test(SRV));
  v('`_aiRatesBiasAt` est posé après une génération IA fraîche (cache-miss)',
    /_aiRatesBias = clean; _aiRatesBiasAt = Date\.now\(\);/.test(SRV));
}

/* ══ LA FED À JOUR APRÈS SA HAUSSE DU 16/09 (23/09) ═══════════════════════════════════════════════
   Trois défauts cumulés, chacun éprouvé sur le VRAI code : (1) le fournisseur interrogé comme un
   robot hostile (8 banques toutes les 90 s à 3 min, 401 compris) — figé depuis le 09/09 ; (2) un
   instantané de marché jeté au bout de 12 h, alors que le fournisseur ne recalcule qu'une fois par
   jour ; (3) le modèle de repli qui affichait « 97 % » sur CHAQUE réunion future. */
console.log('\n── La Fed à jour après sa hausse du 16/09 ──');
{
  const extraireFn = nom => {
    const d = SRV.indexOf('function ' + nom + '(');
    if (d < 0) return null;
    let prof = 0;
    for (let k = SRV.indexOf('{', d); k < SRV.length; k++) {
      if (SRV[k] === '{') prof++;
      else if (SRV[k] === '}') { prof--; if (prof === 0) return SRV.slice(d, k + 1); }
    }
    return null;
  };
  // (1) rythme
  const mTTL = /const RP_TTL = ([0-9* ]+);/.exec(SRV);
  const ttl = mTTL ? Function('return ' + mTTL[1])() : 0;
  v('le fournisseur n\'est plus interrogé plus d\'une fois par 30 min en temps normal', ttl >= 30 * 60 * 1000, 'RP_TTL = ' + ttl + ' ms');
  const srcTTL = extraireFn('_rpEffectiveTTL');
  v('… ni plus d\'une fois par 10 min à l\'approche d\'une décision', !!srcTTL && /return 10 \* 60 \* 1000;/.test(srcTTL) && !/90 \* 1000/.test(srcTTL), srcTTL);
  v('… et les huit banques partent ÉCHELONNÉES, plus en rafale parallèle',
    /await new Promise\(r => setTimeout\(r, 1500\)\)/.test(SRV) && !/Promise\.allSettled\(codes\.map\(c => _rpFetchBank/.test(SRV));
  const srcRecul = extraireFn('_rpNoterEchec');
  v('une banque en échec recule (24 h sur un 401 payant, sinon 15 min doublés, plafond 6 h)', !!srcRecul);
  if (srcRecul) {
    const att = {};
    const noter = new Function('_rpAttente', srcRecul + '\nreturn _rpNoterEchec;')(att);
    const t0 = Date.now();
    noter('snb', 401);
    v('… 401 → 24 h', Math.abs(att.snb.reprise - t0 - 24 * 3600e3) < 5000, JSON.stringify(att.snb));
    noter('fed', 0); const r1 = att.fed.reprise - t0; noter('fed', 0); const r2 = att.fed.reprise - t0;
    for (let i = 0; i < 10; i++) noter('fed', 0);
    const r12 = att.fed.reprise - t0;
    v('… 15 min, puis 30 min, puis plafonné à 6 h', Math.abs(r1 - 15 * 60e3) < 5000 && Math.abs(r2 - 30 * 60e3) < 5000 && Math.abs(r12 - 6 * 3600e3) < 5000,
      [r1, r2, r12].map(x => Math.round(x / 60e3) + ' min').join(' / '));
  }
  v('_rpFetchBank respecte le recul avant d\'interroger', /if \(att && Date\.now\(\) < att\.reprise\) return null;/.test(SRV));
  // (2) instantané vieilli
  const srcInst = extraireFn('_rpInstantaneUtilisable');
  v('_rpInstantaneUtilisable est extractible', !!srcInst);
  if (srcInst) {
    const CBM = { USD: ['2026-09-16', '2026-10-28', '2026-12-09'] };
    const inst = new Function('CB_MEETINGS', srcInst + '\nreturn _rpInstantaneUtilisable;')(CBM);
    const rp = { rate: 3.875, meetings: [{ date: '2026-10-28', days: 30 }, { date: '2026-12-09', days: 72 }], next: '2026-10-28', nextDays: 30 };
    const now = Date.UTC(2026, 8, 25, 12, 0);
    const r1 = inst('USD', rp, Date.UTC(2026, 8, 23, 4, 0), now);
    v('un instantané de 2 jours, sans réunion depuis, reste du MARCHÉ', !!r1 && r1.rate === 3.875);
    v('… avec ses jours recalculés à l\'instant du service', !!r1 && r1.meetings[0].days === Math.round((Date.UTC(2026, 9, 28) - now) / 864e5), r1 && JSON.stringify(r1.meetings[0]));
    v('un instantané pris AVANT la réunion du 16/09 est périmé après elle (l\'incident)',
      inst('USD', rp, Date.UTC(2026, 8, 9, 15, 0), Date.UTC(2026, 8, 23, 4, 0)) === null);
    v('… y compris pris le MATIN même de la décision (tombée le soir)',
      inst('USD', rp, Date.UTC(2026, 8, 16, 9, 0), Date.UTC(2026, 8, 17, 9, 0)) === null);
    v('au-delà de 7 jours, même sans réunion, on retombe sur le repli', inst('USD', rp, Date.UTC(2026, 8, 17, 4, 0), Date.UTC(2026, 8, 25, 5, 0)) === null);
  }
  // bande Fed
  const srcB = extraireFn('_rpBande');
  if (srcB) {
    const bande = new Function(srcB + '\nreturn _rpBande;')();
    const b = bande({ 'current band': '3.75 - 4.00', midpoint: 3.875 });
    v('la fourchette Fed est lue telle que le fournisseur la publie (3,75-4,00)', !!b && b.lo === 3.75 && b.hi === 4, JSON.stringify(b));
    v('… et un champ absent ou aberrant ne fabrique rien', bande({}) === null && bande({ 'current band': '4.00 - 3.75' }) === null);
  } else v('_rpBande est extractible', false);
  v('en repli, la carte Fed sert le MILIEU de sa fourchette (une seule convention quelle que soit la source)',
    /rate: bandeFed \? \+\(\(bandeFed\.lo \+ bandeFed\.hi\) \/ 2\)\.toFixed\(3\) : st\.rate/.test(SRV));
  v('… et la prochaine réunion Fed reprend le pricing CME quand la courbe manque',
    /_fedWatch\.meeting === meetings\[0\]\.date/.test(SRV));
}
// (3) modèle de repli : probabilité PAR réunion
{
  const d2 = SRV.indexOf('function _rateScenario(b, idx)');
  const f2 = SRV.indexOf('\n}', d2);
  const sc = new Function(SRV.slice(d2, f2 + 2) + '\nreturn _rateScenario;')();
  const serie = [0, 1, 2, 3, 4, 5].map(i => Math.round(sc({ bias: 'hike', conv: 0.8, step: 25 }, i).hike * 100));
  v('en repli, la probabilité de hausse DÉCROÎT avec l\'horizon (plus de 97 % sur chaque réunion)',
    serie.every((x, i) => i === 0 || x <= serie[i - 1]) && serie[5] < 50 && !serie.slice(1).includes(97), serie.join(' / '));
  v('… et la prochaine réunion garde sa conviction calibrée (80 %)', serie[0] === 80, serie.join(' / '));
}

/* ══ HTTP 403 SUR LES HUIT BANQUES : LE RELAIS (23/09, capture « Pipeline taux » figé 329 h) ══════
   Le fournisseur refuse l'adresse du VPS. On rejoue sur le VRAI `_rpFetchBank` : direct 403, relais
   qui rend la réponse enveloppée du lecteur → la banque est servie, et le panneau le dit. */
console.log('\n── Accès direct refusé (403) : la donnée passe par une passerelle (cascade) ──');
(async () => {
  const d = SRV.indexOf('const _rpAttente = {};');
  const f = SRV.indexOf('// Biais DIRECTIONNEL', d);
  const bloc = (d >= 0 && f > d) ? SRV.slice(d, f) : null;
  v('le bloc de récupération (recul + cascade de passerelles) est extractible', !!bloc);
  if (!bloc) return;
  const JSON_FED = JSON.stringify({ today: { midpoint: 3.875, 'current band': '3.75 - 4.00', rows: [{ meeting_iso: '2027-10-28', prob_move_pct: 74.8, implied_rate_post_meeting: 4.062 }] } });
  const monter = (fetchImpl) => new Function('fetch', 'RP_HEADERS', '_rpPanne', 'AbortController', 'setTimeout', 'clearTimeout', 'process',
    bloc + '\nreturn { _rpFetchBank, _rpRelais, _rpPanne, _RP_RELAIS };')(fetchImpl, {}, {}, AbortController, setTimeout, clearTimeout, { env: {} });
  const rep = (status, body) => ({ ok: status === 200, status, text: async () => body });
  const direct = u => String(u).startsWith('https://rateprobability.com');
  // a. direct 403, PREMIÈRE passerelle 200 (JSON brut, non enveloppé)
  let appels = [];
  const A = monter(async (url) => { appels.push(url); return direct(url) ? rep(403, 'Forbidden') : rep(200, JSON_FED); });
  const j = await A._rpFetchBank('fed');
  v('403 en direct → la banque est servie par une passerelle', !!(j && j.today && j.today.rows.length === 1), JSON.stringify(j).slice(0, 120));
  v('… la passerelle n\'est appelée qu\'APRÈS l\'accès direct', appels.length >= 2 && direct(appels[0]) && !direct(appels[1]), appels.join(' | '));
  v('… et le panneau sait PAR QUELLE passerelle (via) et que le direct a échoué', !!(A._rpRelais.fed && A._rpRelais.fed.via && /403/.test(A._rpRelais.fed.direct)) && !A._rpPanne.fed, JSON.stringify(A._rpRelais));
  // b. cascade : la 1re passerelle tombe, la 2e prend le relais
  appels = [];
  const premiere = A._RP_RELAIS[0].nom;
  const D = monter(async (url) => { appels.push(url); if (direct(url)) return rep(403, 'x'); return url.includes(premiere === 'allorigins' ? 'allorigins' : premiere) ? rep(500, '') : rep(200, JSON_FED); });
  const jd = await D._rpFetchBank('boe');
  v('une passerelle en panne → on essaie la suivante (cascade)', !!(jd && jd.today) && D._rpRelais.boe && D._rpRelais.boe.via !== premiere, (D._rpRelais.boe || {}).via);
  // c. 401 payant : aucune passerelle
  appels = [];
  const B = monter(async (url) => { appels.push(url); return rep(401, '{"error":"Pro subscription required"}'); });
  await B._rpFetchBank('snb');
  v('un 401 (payant) ne part jamais au relais', appels.length === 1, appels.join(' | '));
  // d. témoin : TOUTES les passerelles échouent → rien d'inventé, panne nommée
  const C = monter(async (url) => direct(url) ? rep(403, '') : rep(500, ''));
  v('(témoin) toutes les passerelles en panne → aucune donnée inventée, panne nommée',
    (await C._rpFetchBank('ecb')) === null && /relais/.test(C._rpPanne.ecb || ''), JSON.stringify(C._rpPanne));
})().then(() => {
  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
});

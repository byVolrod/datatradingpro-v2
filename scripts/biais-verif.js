#!/usr/bin/env node
/**
 * scripts/biais-verif.js — LA CHAÎNE DU RADAR DE BIAIS, ÉPROUVÉE SUR LE VRAI CODE.
 *
 * Posé le 30/08 (audit demandé par le user : « vérifie les biais des devises de l'onglet biais
 * s'ils sont bien fiables par rapport aux datas »). Constat de l'audit : la chaîne était la SEULE
 * grosse mécanique du desk sans AUCUNE garde au déploiement — test_bias_calc.js (7 contrôles sur
 * lib/bias-calc) vivait hors de `npm run check`, et rien ne couvrait la surprise, le portage,
 * l'hystérésis, le score de cellules ni la conclusion relative. L'audit a d'ailleurs trouvé un
 * défaut réel (l'amnésie d'hystérésis au redéploiement, rejouée plus bas, section 4).
 *
 * MÉTHODE MAISON : le code est EXTRAIT de server.js (jamais recopié) et rejoué avec les chiffres
 * exacts des incidents et des valeurs épinglées dans les commentaires du code — si un commentaire
 * promet « GBP +1,45 pt → +0,148 », le banc le mesure.
 */
const fs = require('fs');
const path = require('path');
let ko = 0, ok = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const slice = (a, b, incl) => {
  const d = SRV.indexOf(a);
  const f = d >= 0 ? SRV.indexOf(b, d) : -1;
  if (d < 0 || f < 0) return null;
  return SRV.slice(d, f + (incl ? b.length : 0));
};
const CCYS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];

console.log('\n── 1. La conclusion pure (lib/bias-calc) entre enfin dans le check ──');
/* test_bias_calc.js existait mais n'était lancé par personne — même angle mort que i18n-verif
   avant son cliquet. Les mêmes garanties sont posées ICI, dans le banc que `npm run check` lance. */
const { concludeBias, SB_SCORE } = require('../lib/bias-calc');
v('majorité franchement haussière → Bullish', concludeBias(['Very Bullish', 'Bullish', 'Bullish', 'Neutral']) === 'Bullish');
v('tout neutre → Neutral', concludeBias(['Neutral', 'Neutral', 'Neutral']) === 'Neutral');
v('majorité franchement baissière → Bearish', concludeBias(['Very Bearish', 'Bearish', 'Bearish', 'Neutral']) === 'Bearish');
v('penchant net mais faible → Weak (bande Neutral ±0.25)', concludeBias(['Bullish', 'Neutral', 'Neutral']) === 'Weak Bullish');
v('signaux qui s\'annulent → Neutral', concludeBias(['Bullish', 'Bearish']) === 'Neutral');
v('valeurs manquantes ignorées', concludeBias(['Bullish', null, undefined, 'Bullish']) === 'Bullish');
v('la pondération pèse vraiment', concludeBias(['Bullish', 'Bearish'], [3, 1]) === 'Weak Bullish', concludeBias(['Bullish', 'Bearish'], [3, 1]));
v('l\'échelle couvre Uptrend/Downtrend/Range (lignes Trend)', SB_SCORE.Uptrend === 1 && SB_SCORE.Downtrend === -1 && SB_SCORE.Range === 0);

console.log('\n── 2. La surprise d\'une publication (actual vs forecast), formes réelles du calendrier ──');
const _fsSrc = slice('function _sbFundStanceServer', "'Neutral';   // beat", false);
v('_sbFundStanceServer est extractible', !!_fsSrc);
if (_fsSrc) {
  const FS = new Function(_fsSrc + "'Neutral';\n}\nreturn _sbFundStanceServer;")();
  v('un IPC au-dessus des attentes est haussier', FS('2.3%', '2.1%') === 'Bullish');
  v('en dessous, baissier', FS('1.9%', '2.1%') === 'Bearish');
  v('conforme → neutre (tolérance relative)', FS('2.1%', '2.1%') === 'Neutral');
  v('les NÉGATIFS comparent dans le bon sens (-0.6% vs -0.4% attendu = déception)', FS('-0.6%', '-0.4%') === 'Bearish');
  v('… et -0.2% vs -0.6% attendu = bonne surprise', FS('-0.2%', '-0.6%') === 'Bullish');
  v('les milliers (104K vs 75K) se comparent', FS('104K', '75K') === 'Bullish');
  v('sans actual OU sans forecast → null (ne dilue jamais l\'agrégat)', FS('', '2.1%') === null && FS('2.1%', '') === null);
  /* La source primaire (scrapers/tvcalendar.js) stringifie des NOMBRES JS (`String(Math.round(...))`) :
     le signe moins y est TOUJOURS le tiret ASCII que le parseur comprend. Ce pin fige cette chaîne :
     si la source se met un jour à relayer du texte brut (signe Unicode U+2212), le parseur inverserait
     les négatifs en silence — le banc exige donc que le formateur numérique reste en place. */
  const TVC = fs.readFileSync(path.join(__dirname, '..', 'scrapers', 'tvcalendar.js'), 'utf8');
  v('le calendrier TV stringifie des NOMBRES (signe ASCII garanti pour le parseur)',
    /String\(Math\.round\(val \* 1e6\) \/ 1e6\)/.test(TVC));
}

console.log('\n── 3. Le portage (différentiel de taux) : la courbe en S tient ses valeurs épinglées ──');
const _peSrc = slice('const _SB_PORT_SEUIL', 'sans angle aux raccords\n}', true);
v('_sbPortageEffet est extractible', !!_peSrc);
if (_peSrc) {
  const PE = new Function(_peSrc + '\nreturn _sbPortageEffet;')();
  const eff = rd => +(0.15 * PE(rd)).toFixed(3);
  v('GBP +1,45 pt → +0,148 (la valeur du commentaire v47, au millième)', eff(1.45) === 0.148, String(eff(1.45)));
  v('JPY −1,69 pt → −0,15 (saturation exacte au-delà de 1,5 pt)', eff(-1.69) === -0.15, String(eff(-1.69)));
  v('CHF −2,84 pt → −0,15 (jamais plus d\'un cran, si extrême soit l\'écart)', eff(-2.84) === -0.15);
  v('EUR −0,26 pt → 0 (zone morte sous 0,75 pt : le bruit de cycle ne pèse pas)', eff(-0.26) === 0 && eff(0.75) === 0);
  v('1,125 pt → exactement la DEMI-marche (le cran de pilier bascule là, pas avant)', +PE(1.125).toFixed(3) === 0.5);
  v('la courbe est impaire (symétrie hausse/baisse, pas deux poids deux mesures)', PE(1.2) === -PE(-1.2));
}

console.log('\n── 4. L\'hystérésis de stance : le défaut du redéploiement, rejoué puis fermé ──');
/* DÉFAUT TROUVÉ PAR L'AUDIT (30/08, sonde sur le pricing FedWatch réel du jour : hausse 57,6 %,
   baisse 0 %). La mémoire `_sbStanceLast` ne vivait qu'en RAM : un serveur en marche depuis des
   semaines affichait « Hausse » pour l'USD (le pricing avait dépassé 60 % par le passé, et
   l'hystérésis retient la direction tant qu'elle reste ≥ 45 %), un serveur fraîchement redéployé
   affichait « Maintien » (état neuf, 57,6 < 60). Même donnée, deux affichages — Radar ET onglet
   TAUX — et le score monétaire passait de +1 à +0,5. Le correctif : _sbSeedStanceLast recharge la
   mémoire depuis le snapshot persisté (macroTable[c].monetary.dir). */
/* Deux tranches : les constantes + l'état, PUIS la fonction — le seed du boot vit entre les deux
   et référence _smartBias, qui n'existe pas dans une extraction. */
const _hyCst = slice('const _SB_HYST_IN', "const _sbStanceLast = {};", true);
const _hyFn  = slice('function _sbHystDir', 'return dir;\n}', true);
const _hySrc = _hyCst && _hyFn ? _hyCst + '\n' + _hyFn : null;
v('_sbHystDir est extractible', !!_hySrc);
if (_hySrc) {
  const mk = () => new Function(_hySrc + '\nreturn { h: _sbHystDir, etat: _sbStanceLast };')();
  const H1 = mk();
  H1.h('USD', 65, 0);
  v('à 65 % de hausse, la direction passe « Up » (seuil d\'entrée 60 %)', H1.h('USD', 65, 0) === 'Up');
  v('retombée à 57,6 %, la direction TIENT (seuil de sortie 45 %)', H1.h('USD', 57.6, 0) === 'Up');
  const H2 = mk();
  v('(rejeu du défaut) état neuf, même 57,6 % → « Hold » : c\'était l\'écart au redéploiement', H2.h('USD', 57.6, 0) === 'Hold');
  const H3 = mk();
  H3.etat.USD = 'Up';   // ← ce que fait _sbSeedStanceLast au boot depuis le snapshot persisté
  v('(défaut fermé) mémoire ENSEMENCÉE du snapshot → 57,6 % rend « Up », comme avant l\'arrêt', H3.h('USD', 57.6, 0) === 'Up');
  v('sous 45 %, la direction lâche même avec mémoire', mk().etat.USD = 'Up', true);
  { const H4 = mk(); H4.etat.USD = 'Up'; v('… vérifié : 40 % de hausse → « Hold » malgré la mémoire « Up »', H4.h('USD', 40, 0) === 'Hold'); }
}
const _seedSrc = slice('function _sbSeedStanceLast', '\n}', true);
v('_sbSeedStanceLast existe (le correctif est en place)', !!_seedSrc);
if (_seedSrc) {
  const S = new Function('_sbStanceLast', _seedSrc + '\nreturn _sbSeedStanceLast;');
  const etat = { EUR: 'Down' };   // un code déjà calculé par la session : il ne doit PAS être écrasé
  S(etat)({ macroTable: { USD: { monetary: { dir: 'Up' } }, EUR: { monetary: { dir: 'Hold' } }, GBP: { monetary: { dir: 'Zorbl' } } } });
  v('le seed remplit les codes vierges depuis macroTable[c].monetary.dir', etat.USD === 'Up');
  v('… n\'écrase JAMAIS un état déjà calculé par la session courante', etat.EUR === 'Down');
  v('… et refuse une valeur hors vocabulaire (Up/Down/Hold)', !('GBP' in etat), JSON.stringify(etat));
  v('le seed est appelé au chargement DISQUE (après l\'init du const — TDZ sinon)',
    /_sbSeedStanceLast\(_smartBias\);\s+\/\/ le fichier disque est déjà chargé/.test(SRV));
  v('… et au chargement SUPABASE (conteneur reconstruit, sans fichier disque)',
    /\{ _smartBias = b; _sbSeedStanceLast\(b\); \}/.test(SRV));
}

console.log('\n── 5. Le score de cellules et la conclusion RELATIVE (v43/v46) ──');
const _toneL = slice('const _SB_TONE_SC =', '\n', false);
const _biasL = slice('const _SB_BIAS_SC =', '\n', false);
const _cellSrc = slice('const _SB_CELL_W', 'return out;\n}', true);
v('le bloc cellules/conclusion est extractible', !!(_toneL && _biasL && _cellSrc && _peSrc));
if (_toneL && _biasL && _cellSrc && _peSrc) {
  const C = new Function(_toneL + '\n' + _biasL
    + '\nconst SB_CURRENCIES = ' + JSON.stringify(CCYS) + ';'
    + '\nconst _sbSentimentRow = () => ({});'
    + '\n' + _peSrc + '\n' + _cellSrc
    + '\nreturn { cell: _sbCellScore, conc: _sbConcludeFromCells, moy: _sbMonMoyenne };')();
  const mkCell = (stance, infL, infT, g, e) => ({
    monetary: { stance }, inflation: { level: infL, trend: infT },
    growthCell: { level: g }, employmentCell: { level: e },
  });
  {
    const t = {}; for (const c of CCYS) t[c] = mkCell('Hawkish', 'High', 'Up', 'Strong', 'Strong');
    const out = C.conc(t, {}, {}, {});
    v('8 devises aux cellules IDENTIQUES → 8 × Neutral (un biais FX est RELATIF)',
      CCYS.every(c => out[c] === 'Neutral'), JSON.stringify(out));
  }
  {
    const t = {}; for (const c of CCYS) t[c] = mkCell('Neutral', 'Moderate', null, null, null);
    t.USD = mkCell('Hawkish', 'High', 'Up', 'Strong', 'Strong');
    t.JPY = mkCell('Dovish', 'Low', 'Down', 'Weak', 'Weak');
    const out = C.conc(t, {}, {}, {});
    v('USD dur + données chaudes ressort haussier, JPY mou + données froides baissier',
      /Bullish/.test(out.USD) && /Bearish/.test(out.JPY), out.USD + ' / ' + out.JPY);
    v('… et les six devises sans relief restent neutres', out.EUR === 'Neutral' && out.CAD === 'Neutral');
  }
  {
    const t = {}; for (const c of CCYS) t[c] = mkCell('Neutral', 'Moderate', null, null, null);
    const mm = C.moy(t, {}, CCYS);
    const chfSans = C.cell(t.CHF, null, null, 'CHF', null, mm);
    const chfAvec = C.cell(t.CHF, null, null, 'CHF', 'Very Bearish', mm);
    const usdSans = C.cell(t.USD, null, null, 'USD', null, mm);
    const usdAvec = C.cell(t.USD, null, null, 'USD', 'Very Bearish', mm);
    v('le régime de risque n\'entre que dans le score du CHF (v48, grille mentor)',
      chfAvec !== chfSans && usdAvec === usdSans, `CHF ${chfSans}→${chfAvec} · USD ${usdSans}→${usdAvec}`);
  }
  v('moins de 4 devises lisibles → pas de classement relatif (null, jamais un faux verdict)',
    C.conc({ USD: mkCell('Hawkish', 'High', 'Up', 'Strong', 'Strong') }, {}, {}, {}) === null);
  v('moins de 4 banques lues → la moyenne monétaire ne centre pas (0)',
    C.moy({ USD: { monetary: { stance: 'Hawkish' } } }, {}, ['USD']) === 0);
}

console.log('\n── 6. Le chômage est INVERSÉ aux trois étages (le piège classique du biais auto) ──');
/* Un chômage au-dessus des attentes est une MAUVAISE nouvelle pour la devise. La règle doit vivre
   partout où un chiffre d'emploi entre dans le modèle : le sous-indicateur du pilier, la stance
   TradingEconomics, et la tendance historique des cellules. */
v('le sous-indicateur « Emploi (chômage) » porte inv: true',
  /\{ label: 'Emploi \(chômage\)',\s+re: \/unemployment rate\|jobless\/i, inv: true \}/.test(SRV));
v('… et l\'inversion s\'applique à l\'agrégat calendrier (calNet = -calNet)',
  /if \(calNet != null && sub\.inv\) calNet = -calNet;/.test(SRV));
const TE = fs.readFileSync(path.join(__dirname, '..', 'scrapers', 'tradingeconomics.js'), 'utf8');
v('TradingEconomics oriente déjà son chômage (mode: \'inv\' — pas de double inversion possible)',
  /mode: 'inv'/.test(TE) && /mode === 'inv'/.test(TE));
const _sdSrc = slice('function _sbSeriesDir', 'return { dir, n: nTot };\n}', true);
v('_sbSeriesDir/_sbHistTrend sont extractibles', !!_sdSrc);
if (_sdSrc) {
  const T = new Function('_sbNum', _sdSrc + '\nreturn _sbHistTrend;')(vv => { const x = parseFloat(String(vv == null ? '' : vv).replace(/[^0-9.\-]/g, '')); return isNaN(x) ? null : x; });
  const serie = [4.6, 4.5, 4.4, 4.3, 4.2, 4.1].map((x, i) => ({ currency: 'USD', ctry: 'US', title: 'Unemployment Rate', actual: x + '%', timestamp: 100 - i }));
  v('un chômage qui MONTE rend une tendance emploi « down » (invert)',
    T(serie, 'USD', /unemployment/i, { invert: true }).dir === 'down',
    JSON.stringify(T(serie, 'USD', /unemployment/i, { invert: true })));
  v('… le même chômage sans invert dirait « up » : c\'est bien l\'inversion qui protège',
    T(serie, 'USD', /unemployment/i, {}).dir === 'up');
}

console.log('\n── 7. La fraîcheur et les gardes de publication ──');
v('le verdict découle des CELLULES du calendrier à 100 % (v46), le pilier n\'est qu\'un filet',
  /brut\[c\] = cell == null \? pil : cell;/.test(SRV));
v('la garde de cohérence est appelée AVANT publication et CORRIGE (jamais un simple log)',
  /const coherence = _sbGardeBiais\(macroTable, conclusion/.test(SRV));
v('une matrice périmée (>7 j / autre version / absente) se régénère toute seule',
  /function _sbBiasStale\(/.test(SRV) && /_sbBiasStale\(\)\) \{\s+.*rég[ée]n/.test(SRV.replace(/\n/g, ' ')) || /if \(_sbBiasStale\(\)\) \{/.test(SRV));
v('une publication du calendrier POUSSE le recalcul (pas d\'attente du tic horaire)',
  /_sbPokeCalendrier/.test(SRV) && /_sbNouvellePublication/.test(SRV));
v('le niveau d\'inflation n\'accepte que l\'IPC ANNUEL, comparé à la cible de SA banque',
  /_SB_CPI_TARGET = \{ USD: 2\.0, EUR: 2\.0, GBP: 2\.0, JPY: 2\.0, CHF: 1\.0, CAD: 2\.0, AUD: 2\.5, NZD: 2\.0 \}/.test(SRV)
  && /_SB_SUBANNUAL_RX/.test(SRV));
v('les corrections admin (overrides) expirent à chaque régénération complète',
  /_sbOverrides = \{\}; auth\.aiCacheSet\('sb:overrides', \{\}\)/.test(SRV));

console.log('');
if (ko) { console.log(`✗ ${ko} ÉCHEC(S) — ${ok} contrôle(s) OK, ${ko} KO`); process.exit(1); }
console.log(`✓ TOUT PASSE — ${ok} contrôle(s) OK, 0 KO`);

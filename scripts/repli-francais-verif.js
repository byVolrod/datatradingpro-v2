#!/usr/bin/env node
/**
 * scripts/repli-francais-verif.js — UN RAPPORT DE SECOURS NE PARLE JAMAIS ANGLAIS
 *
 * POURQUOI (16/09, TROISIÈME capture du même écran).
 * Le Récap Quotidien s'affichait en « Version provisoire » avec, sous une phrase d'attaque
 * française, de l'anglais brut : « Fil de la journée, séance après séance : PRIMER : Asia Session
 * Recap: Fed · Hormuz traffic declines after Middle East », puis « Moteurs clés du jour : Gold
 * declines below $4,300 as US yields climb ».
 *
 * LES DEUX PREMIÈRES PASSES ONT CHERCHÉ AU MAUVAIS ENDROIT. J'ai instrumenté la chaîne d'analyse,
 * puis appris ses plafonds : les deux corrections sont justes et servent, mais aucune ne pouvait
 * régler CELLE-CI. La cause est ici, dans le repli déterministe : il lisait `i.headline`, le titre
 * d'ORIGINE de la dépêche, alors que le desk TRADUIT ses titres depuis le 28/08 et range la
 * traduction dans `_titreFr` — le champ que le fil affiche, sans jamais muter `headline`. La
 * traduction était là, à côté, et personne ne la lisait. Aucune quantité de quota IA n'aurait
 * réparé un mauvais nom de champ.
 *
 * ⚠️ ET LA VRAIE DIFFICULTÉ N'EST PAS DE LIRE LE BON CHAMP, C'EST DE NE PAS RETOMBER SUR L'AUTRE.
 * Un repli « la traduction si elle existe, sinon l'original » ramènerait l'anglais dès qu'une
 * dépêche arrive avant son tour de traduction, c'est-à-dire précisément dans les rapports du soir,
 * c'est-à-dire précisément dans le cas signalé. Une dépêche sans traduction est donc ÉCARTÉE, et la
 * suivante prend sa place. C'est cette propriété-là que ce banc éprouve, et elle ne se lit pas dans
 * le code : elle se mesure en JOUANT le repli sur un corpus mixte et en cherchant, dans le rapport
 * produit, la moindre trace des dépêches non traduites.
 *
 * Le corpus d'épreuve est repris MOT POUR MOT de la capture : si le banc était vert sur ces
 * phrases-là, il serait vert sur n'importe quoi.
 *
 *   node scripts/repli-francais-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ══ MONTAGE : LE VRAI CODE, EXTRAIT DE server.js ═════════════════════════════════════════════
   Les quatre fonctions du repli sont extraites et exécutées. Les dépendances qui ne concernent pas
   la LANGUE (calendrier, markdown) sont doublées : elles ne produisent aucun texte de dépêche, donc
   elles ne peuvent ni masquer ni fabriquer le défaut cherché. */
const morceau = (nom, rx) => { const m = rx.exec(SRV); if (!m) throw new Error('introuvable dans server.js : ' + nom); return m[0]; };
let F = null, erreurMontage = '';
try {
  const src = [
    morceau('_fxrTitreFr', /function _fxrTitreFr\(i\) \{[\s\S]*?\n\}/),
    morceau('_fxrDescFr', /function _fxrDescFr\(i\) \{[^\n]*\}/),
    morceau('_fxrFrancais', /function _fxrFrancais\(items\) \{[^\n]*\}/),
    morceau('_fxrTxt', /function _fxrTxt\(s, n\) \{[^\n]*\}/),
    morceau('_fxrLean', /function _fxrLean\(e\) \{[\s\S]*?\n\}/),
    morceau('_fxrAutoTags', /function _fxrAutoTags\(items\) \{[\s\S]*?\n\}/),
    morceau('_fxrFallback', /function _fxrFallback\(\{ dayKey[\s\S]*?\n\}/),
    morceau('_dtpdFallback', /function _dtpdFallback\(\{ dayKey[\s\S]*?\n\}/),
  ].join('\n');
  const prelude = 'const FXR_VER=1, DTPD_VER=1;\n'
    + 'const _noDash=s=>String(s==null?"":s).replace(/—/g," : ");\n'
    + 'const _stripMd=s=>String(s==null?"":s).replace(/\\*\\*/g,"");\n'
    + 'const _fxrLookFromRows=()=>[];\nconst _buildEcoDataSection=()=>null;\n';
  F = new Function(prelude + src + '\nreturn { _fxrFallback, _dtpdFallback, _fxrTitreFr, _fxrFrancais, _fxrAutoTags };')();
} catch (e) { erreurMontage = e.message; }
v('les deux replis sont extractibles et exécutables', !!F, erreurMontage);

/* ══ LE CORPUS DE LA CAPTURE ══════════════════════════════════════════════════════════════════ */
const ANGLAIS = [
  'Gold declines below $4,300 as US yields climb',
  'Council of Economic Advisers Chairman Phelan: It would be a mistake for the Fed to hike rates',
  "Crude Oil rallies again as Saudi Arabia's route around Hormuz shuts",
  'PRIMER : Asia Session Recap: Fed',
  'Hormuz traffic declines after Middle East',
  'DTP Synthèse des Marchés : 15th September 2026',
];
const NEWS = [
  { headline: ANGLAIS[0], _titreFr: "L'or recule sous 4 300 $ alors que les rendements américains montent", description: 'Gold fell as yields climbed.', _descFr: "L'or a reculé sous l'effet de la hausse des rendements." },
  { headline: ANGLAIS[1] },                                    // PAS de traduction → doit être écartée
  { headline: ANGLAIS[2], _titreFr: "Le brut rebondit : l'Arabie saoudite ferme sa route de contournement d'Hormuz" },
  { headline: 'Fed holds rates steady', _titreFr: 'La Fed laisse ses taux inchangés' },
];
const WRAPS = [
  { headline: ANGLAIS[3] },                                    // PAS de traduction → écartée
  { headline: ANGLAIS[5], _titreFr: 'DTP Synthèse des Marchés : 15 septembre 2026' },
];
const ARGS = { dayKey: '2026-09-15', dateLabel: 'mardi 15 septembre 2026', newsItems: NEWS, dataRows: [], laRows: [], csLine: 'USD +0,08%, EUR +0,02%', wrapItems: WRAPS };

/* Cherche dans TOUT le rapport, sans supposer où : un champ ajouté demain est couvert d'office.
   Un contrôle qui n'inspecterait que `summary` serait vert le jour où l'anglais revient par
   `insights`, et c'est exactement ainsi qu'un défaut réapparaît sous un banc vert. */
const traces = (obj) => { const blob = JSON.stringify(obj); return ANGLAIS.filter(a => blob.includes(a)); };

if (F) {
  console.log('\n── Récap Quotidien : le repli joué sur le corpus de la capture ──');
  const r = F._fxrFallback(ARGS);
  const t = traces(r);
  v('AUCUNE phrase anglaise de la capture ne survit dans le rapport', t.length === 0, t.join(' | '));
  v('… et la dépêche NON TRADUITE est écartée, pas recopiée', !JSON.stringify(r).includes('Phelan'));
  v('… pendant que les dépêches traduites, elles, sont bien là',
    /L'or recule sous 4 300/.test(r.summary) && /Le brut rebondit/.test(JSON.stringify(r.insights)), r.summary);
  v('le titre du rapport est français', /L'or recule/.test(r.title), r.title);
  v('l\'intro ne garde que le récap de séance traduit',
    /15 septembre 2026/.test(r.intro) && !/PRIMER/.test(r.intro), r.intro);
  v('une description sans traduction ne se colle pas sous un titre français',
    (r.headlines || []).every(h => !/Gold fell as yields/.test(h.text || '')), JSON.stringify(r.headlines));

  /* LE CAS EXTRÊME, et il arrivera : un soir où RIEN n'est encore traduit. Le rapport doit alors
     se taire en français, pas se remplir en anglais. */
  console.log('\n── Le soir où rien n\'est encore traduit ──');
  const vide = F._fxrFallback(Object.assign({}, ARGS, { newsItems: NEWS.map(n => ({ headline: n.headline })), wrapItems: [{ headline: ANGLAIS[3] }] }));
  v('aucune trace anglaise même quand AUCUNE dépêche n\'est traduite', traces(vide).length === 0, traces(vide).join(' | '));
  v('… le rapport le dit en français au lieu de remplir', /calme/i.test(vide.summary || ''), vide.summary);
  v('… et son titre reste français', /Récap marché du/.test(vide.title), vide.title);

  console.log('\n── Point Marché : le jumeau, corrigé le même jour ──');
  const d = F._dtpdFallback({ dayKey: '2026-09-15', dateLabel: 'mardi 15 septembre 2026', newsItems: NEWS, dataRows: [] });
  v('AUCUNE phrase anglaise de la capture ne survit non plus', traces(d).length === 0, traces(d).join(' | '));
  v('… et son classement par rubrique FONCTIONNE toujours',
    (d.sections || []).some(s => s.title === 'BANQUES CENTRALES' && (s.items || []).length),
    'sections : ' + (d.sections || []).map(s => s.title).join(', '));
  /* ⚠️ CE CONTRÔLE-LÀ EST LE PLUS SUBTIL DU FICHIER. Les motifs de classement sont ANGLAIS
     (`fed|fomc|ecb|oil|gold`) parce que c'est la langue des dépêches. Classer sur la traduction
     ferait manquer « BCE » sous le motif `ecb` : la rubrique se viderait SANS ERREUR, et on le
     découvrirait des semaines plus tard sur une capture. On classe sur l'original, on affiche la
     traduction. Le témoin : une dépêche dont SEUL l'original porte le mot-clé doit être classée. */
  const dOrig = F._dtpdFallback({ dayKey: '2026-09-15', dateLabel: 'x', newsItems: [{ headline: 'ECB keeps rates on hold', _titreFr: 'La banque centrale garde ses taux' }], dataRows: [] });
  v('… en classant sur l\'ORIGINAL (« ECB » classe, même si la traduction dit « banque centrale »)',
    (dOrig.sections || []).some(s => s.title === 'BANQUES CENTRALES'),
    'sections : ' + (dOrig.sections || []).map(s => s.title).join(', '));

  /* ── TÉMOIN ── Sans lui, tout ce qui précède pourrait être vert en ne mesurant rien. On remet le
     défaut d'origine dans le VRAI source et on vérifie qu'il ressort. */
  console.log('\n── Témoin : on remet le défaut, il doit ressortir ──');
  const mutant = /function _fxrTitreFr\(i\) \{[\s\S]*?\n\}/.exec(SRV)[0]
    .replace('const t = i._titreFr || i._hlFr || \'\';', 'const t = i._titreFr || i._hlFr || i.headline || \'\';');
  v('(témoin) le repli « sinon l\'original » est bien injectable', /i\.headline/.test(mutant));
  const G = new Function('const FXR_VER=1;\nconst _noDash=s=>String(s);\nconst _stripMd=s=>String(s);\n'
    + 'const _fxrLookFromRows=()=>[];\n'
    + mutant + '\n'
    + /function _fxrDescFr\(i\) \{[^\n]*\}/.exec(SRV)[0] + '\n'
    + /function _fxrFrancais\(items\) \{[^\n]*\}/.exec(SRV)[0] + '\n'
    + /function _fxrTxt\(s, n\) \{[^\n]*\}/.exec(SRV)[0] + '\n'
    + /function _fxrLean\(e\) \{[\s\S]*?\n\}/.exec(SRV)[0] + '\n'
    + /function _fxrAutoTags\(items\) \{[\s\S]*?\n\}/.exec(SRV)[0] + '\n'
    + /function _fxrFallback\(\{ dayKey[\s\S]*?\n\}/.exec(SRV)[0]
    + '\nreturn _fxrFallback;')();
  const tMut = traces(G(ARGS));
  v('(témoin) avec lui, l\'anglais de la capture revient → le contrôle mord', tMut.length > 0, 'aucune trace : le contrôle ne prouve rien');
}

/* ══ LES TAGS DU RAPPORT ══════════════════════════════════════════════════════════════════════
   Même capture, autre défaut : la rangée de tags mêlait « geopolitics, oil prices, federal
   reserve » et « matières premières, chine ». Les seconds viennent du FIL, les premiers du
   RAPPORT — et la table de traduction du client n'était keylée que sur les tags du fil. Mesuré :
   13 des 14 libellés du rapport n'y figuraient pas. Le pire des deux mondes : assez de français
   pour qu'on ne soupçonne pas un défaut, assez d'anglais pour que ça se voie. */
console.log('\n── Les tags que le desk fabrique pour ses propres rapports ──');
if (F) {
  const tags = F._fxrAutoTags([{ headline: 'Gold and oil climb as the Fed holds, ECB steady, BoJ yen, treasury yields up, nasdaq equities, dollar dxy, china tariff, nvidia spacex, cpi inflation' }]);
  v('les tags sont produits', tags.length >= 10, JSON.stringify(tags));
  const ANGL = /^(Geopolitics|Oil Prices|Federal Reserve|Bank of Japan|Treasury Yields|Global Equities|Commodities|US Dollar|China|Trade)$/;
  const restes = tags.filter(t => ANGL.test(t));
  v('… et AUCUN n\'est resté en anglais à la source', restes.length === 0, restes.join(', '));
  /* ⚠️ LE PLAFOND DE 10 TAGS COUPE AVANT LA FIN : un corpus qui déclenche les quatorze motifs
     n'en rend que dix, et le contrôle échouait sur les DEUX derniers sans que le code soit en
     cause. On éprouve donc les noms propres sur leur propre corpus, court. */
  const propres = F._fxrAutoTags([{ headline: 'Nvidia earnings beat, SpaceX launch delayed' }]);
  v('… les noms propres, eux, ne sont pas traduits', propres.includes('Nvidia') && propres.includes('SpaceX'), JSON.stringify(propres));
}
/* ⚠️ ET LES RAPPORTS DÉJÀ STOCKÉS gardent leurs anciens libellés : personne ne va les réécrire.
   La table du client doit donc les couvrir, sinon la correction ne vaut que pour demain. */
const TBL = (() => { try { return new Function(/const NEWS_TAG_FR = \{[\s\S]*?\n\};/.exec(APP)[0] + '\nreturn NEWS_TAG_FR;')(); } catch { return null; } })();
v('la table de traduction du client est lisible', !!TBL);
if (TBL) {
  const manquants = ['Geopolitics', 'Oil Prices', 'Federal Reserve', 'Bank of Japan', 'Treasury Yields', 'Global Equities', 'Commodities', 'US Dollar', 'China', 'Trade'].filter(k => !TBL[k]);
  v('… et elle couvre les rapports DÉJÀ stockés, qui portent les anciens libellés', manquants.length === 0, 'sans traduction : ' + manquants.join(', '));
  v('(témoin) un libellé jamais employé n\'y est, lui, pas', !TBL['Temoin Inexistant']);
}

/* ══ ET LES RAPPORTS DÉJÀ STOCKÉS ? ═══════════════════════════════════════════
   Une correction qui ne vaut que pour demain laisse le client devant l'écran qu'il vient de
   signaler. Deux maillons, et il a fallu en débloquer un :
   · la boucle de guérison cible `v < FXR_VER` → le bump de version rattrape l'existant ;
   · MAIS la garde anti-rétrogradation refusait TOUT repli sur un jour passé, « sans amélioration ».
     C'était juste le 15/07, quand un repli ÉTAIT forcément anglais. Ça ne l'est plus, et laisser la
     garde en l'état aurait figé les rapports stockés en anglais POUR TOUJOURS, sous un banc vert. */
console.log('\n── Les rapports déjà stockés, pas seulement les prochains ──');
v('la version est bumpée (c\'est elle qui déclenche la guérison)', /const FXR_VER = 28;/.test(SRV));
v('un repli de la version courante peut remplacer un repli ANTÉRIEUR',
  /const _progres = !!\(_existing && !_existing\._fxr\._ai && \(_existing\._fxr\.v \|\| 0\) < FXR_VER\);/.test(SRV));
v('… et la garde compare la VERSION, pas la date (sinon la guérison tournerait en boucle)',
  /_existing\._fxr\.v \|\| 0\) < FXR_VER/.test(SRV));
v('⚠️ un repli ne remplace TOUJOURS PAS une version rédigée par l\'IA (le plancher monte, le plafond ne descend pas)',
  /_existing && \(_existing\._fxr\._ai \|\| \(dayKeyOverride && !_progres\)\)/.test(SRV));

/* ══ LES RÉCAPS DE SÉANCE (Asie/Londres/New York) — LE MÊME DÉFAUT, JAMAIS VU ICI (17/09) ══════════
   Capture client : « Récap Séance New York » sous des en-têtes français (GÉOPOLITIQUE, MACRO,
   ANALYSE DE SÉANCE) dont CHAQUE puce était en anglais brut — « US September Philly Fed business
   index +37.8 vs +30.5 expected », etc. Cause : `_topLines`, qui nourrit `_pushBullets`, utilisé par
   buildAsiaRecap/buildLondonRecap/buildUSRecap, lisait `headline` au lieu de `_titreFr`. Ces trois
   rapports ne passent PAS par une rédaction IA (contrairement au FX Daily Recap et au Point Marché
   couverts plus haut) : leurs puces sont un LISTING DIRECT des dépêches choisies, donc la langue de
   `headline` est directement la langue affichée — un bug plus direct encore que ses jumeaux. */
console.log('\n── Les récaps de séance (Asie/Londres/New York) — le même défaut, un autre repli ──');
{
  const srcTop = morceau('_topLines', /function _topLines\(items, n\) \{[^\n]*\}/);
  const srcPush = morceau('_pushBullets', /function _pushBullets\(bullets, heading, items, max\) \{[\s\S]*?\n\}/);
  v('`_topLines` est extractible', !!srcTop);
  v('`_pushBullets` est extractible', !!srcPush);
  if (srcTop && srcPush) {
    const srcFrTf = /function _fxrTitreFr\(i\) \{[\s\S]*?\n\}/.exec(SRV)[0];
    const srcFrFr = /function _fxrFrancais\(items\) \{[^\n]*\}/.exec(SRV)[0];
    const T = new Function(srcFrTf + '\n' + srcFrFr + '\n' + srcTop + '\n' + srcPush
      + '\nreturn { _topLines, _pushBullets };')();

    const items = [
      { headline: 'US September Philly Fed business index +37.8 vs +30.5 expected', _titreFr: "Indice Philly Fed de septembre aux États-Unis : +37,8 contre +30,5 attendu" },
      { headline: 'Former Atlanta President: inflation portion of the Fed mandate far more concerning' },   // PAS de traduction → écartée
      { headline: 'US 10-year yields down 9 bps to 4.93%', _titreFr: 'Le rendement américain à 10 ans recule de 9 pb à 4,93 %' },
    ];
    const lignes = T._topLines(items, 5);
    v('`_topLines` ne rend QUE des puces traduites', lignes.every(l => !/September|Fed mandate|10-year yields/.test(l)),
      JSON.stringify(lignes));
    v('… avec le bon contenu français', lignes.some(l => /Philly Fed/.test(l)) && lignes.some(l => /4,93 %/.test(l)), JSON.stringify(lignes));
    v('… et la dépêche SANS traduction est écartée plutôt que recopiée en anglais',
      !lignes.some(l => /Atlanta President|far more concerning/.test(l)));

    const bullets = [];
    T._pushBullets(bullets, 'Macro', items, 5);
    v('`_pushBullets` (utilisé par buildUSRecap/buildAsiaRecap/buildLondonRecap) hérite de la correction',
      bullets.length > 0 && !bullets.some(b => /September|Fed mandate/.test(b)), JSON.stringify(bullets));

    // TÉMOIN : remettre `headline` fait revenir l'anglais.
    const mutTop = srcTop.replace('_fxrFrancais(items).slice(0, n).map(_fxrTitreFr).filter(Boolean)', 'items.slice(0, n).map(i => i.headline).filter(Boolean)');
    v('(témoin) la mutation change bien `_topLines`', mutTop !== srcTop, 'la ligne a changé de forme : ce témoin ne prouve plus rien');
    if (mutTop !== srcTop) {
      const Tmut = new Function(srcFrTf + '\n' + srcFrFr + '\n' + mutTop + '\nreturn { _topLines };')();
      const lignesMut = Tmut._topLines(items, 5);
      v('(témoin) avec l\'ancien code, l\'anglais brut revient bien dans les puces',
        lignesMut.some(l => /September|Fed mandate/.test(l)), JSON.stringify(lignesMut));
    }
  }

  console.log('\n── « DTP Synthèse des Marchés » (European Market Wrap) — le repli déterministe, même défaut ──');
  const srcEuFb = morceau('_euWrapFallback', /function _euWrapFallback\(levels, s\) \{[\s\S]*?\n  return b;\n\}/);
  v('`_euWrapFallback` est extractible', !!srcEuFb);
  if (srcEuFb) {
    const srcFrTf = /function _fxrTitreFr\(i\) \{[\s\S]*?\n\}/.exec(SRV)[0];
    const srcFrFr = /function _fxrFrancais\(items\) \{[^\n]*\}/.exec(SRV)[0];
    const E = new Function(srcFrTf + '\n' + srcFrFr + '\n' + srcEuFb + '\nreturn _euWrapFallback;')();
    const geo = [
      { headline: 'Trump says he faces a big decision on whether to launch new attacks on Iran', _titreFr: 'Trump dit affronter une décision majeure sur de nouvelles frappes en Iran' },
      { headline: 'China privately asks Iran to help rein in Houthis after Saudi appeal' },   // PAS de traduction → écartée
    ];
    const r = E({ eq: [], fx: [], fixed: [], cmd: [] }, { euData: [], data: [], naData: [], geo, trade: [], cb: [] });
    v('la section GÉOPOLITIQUE du repli déterministe ne contient que du français',
      !JSON.stringify(r['GEOPOLITIQUE'] || []).match(/Trump says|China privately/),
      JSON.stringify(r['GEOPOLITIQUE']));
    v('… et garde la dépêche traduite', (r['GEOPOLITIQUE'] || []).some(l => /décision majeure/.test(l)), JSON.stringify(r['GEOPOLITIQUE']));
  }
}

/* ══ LE TAG « ANALYSE » D'UNE NEWS — UN QUATRIÈME REPLI, ENCORE UN AUTRE ANGLE (17/09) ═══════════
   Capture client : sur une news « BoJ » (onglet Asie), le tag Info affichait un résumé français
   mais le tag Analyse affichait un paragraphe entièrement anglais (« The Bank of Japan's (BoJ)
   monetary policy meeting will close a week packed with central bank decisions... »).
   CAUSE, différente des trois précédentes : `_newsAnalysePrompt` DEMANDE explicitement le français
   (« Rédige en FRANÇAIS » / « EN FRANÇAIS »), mais `_parseAnalyseBullets` acceptait n'importe quel
   texte renvoyé par le modèle sans jamais vérifier qu'il avait obéi. Un seul écart (fournisseur de
   secours sous budget serré, modèle qui ignore la consigne) suffisait à mettre l'anglais en cache
   DURABLEMENT (mémoire + Supabase) — servi pour toujours sur cette news, jamais retenté.
   Corrigé en réutilisant `_traductionFrValide` (déjà éprouvée par l'anti-poison de `_traduireLot`,
   §1 ci-dessus n'en a pas besoin car il travaille sur des champs déjà traduits) plutôt qu'un
   nouveau motif inventé pour l'occasion. */
console.log('\n── Le tag « Analyse » d\'une news — le même principe, une quatrième fois ──');
{
  const srcLooksFr = /const _looksFr = s => [^\n]*\n/.exec(SRV)[0];
  const srcNonFr = /const _RX_NON_FR = \/[^\n]*\n/.exec(SRV)[0];
  const srcValide = /const _traductionFrValide = [^\n]*\n/.exec(SRV)[0];
  const srcParse = morceau('_parseAnalyseBullets', /function _parseAnalyseBullets\(text\) \{[\s\S]*?\n\}/);
  v('`_traductionFrValide`/`_parseAnalyseBullets` sont extractibles', !!(srcLooksFr && srcNonFr && srcValide && srcParse));
  if (srcLooksFr && srcNonFr && srcValide && srcParse) {
    const P = new Function(srcLooksFr + srcNonFr + srcValide + '\n' + srcParse + '\nreturn { _parseAnalyseBullets };')();
    // Corpus MOT POUR MOT de la capture (paragraphe redécoupé en une puce, comme le ferait un
    // modèle qui répond par une seule ligne « • … » au lieu des 2-3 attendues).
    const sortieAnglaise = "• The Bank of Japan's (BoJ) monetary policy meeting will close a week packed with central bank decisions on Friday, with markets particularly interested in confirming expectations of a hawkish shift that has boosted a strong Japanese Yen (JPY) recovery in September.";
    v('une sortie entièrement anglaise est ÉCARTÉE (jamais affichée)', P._parseAnalyseBullets(sortieAnglaise).length === 0,
      JSON.stringify(P._parseAnalyseBullets(sortieAnglaise)));
    const sortieFrancaise = '• Le ton reste hawkish : la BoJ pourrait relever ses taux face à une inflation persistante.\n• Une hausse renforcerait le yen, déjà porté par les anticipations de resserrement.';
    const r2 = P._parseAnalyseBullets(sortieFrancaise);
    v('… mais une sortie française, elle, passe intacte', r2.length === 2 && /hawkish/.test(r2[0]), JSON.stringify(r2));
    const sortieMixte = '• Ceci est en français et doit rester.\n• This one is in English and must be dropped.';
    const r3 = P._parseAnalyseBullets(sortieMixte);
    v('une sortie MIXTE ne garde que la puce française (jamais l\'anglaise à côté)',
      r3.length === 1 && /français et doit rester/.test(r3[0]), JSON.stringify(r3));

    // TÉMOIN : sans le filtre, l'anglais de la capture ressort tel quel.
    const srcParseSansFiltre = srcParse.replace('.filter(_traductionFrValide)', '');
    v('(témoin) le retrait du filtre change bien le source', srcParseSansFiltre !== srcParse,
      'la ligne a changé de forme : ce témoin ne prouve plus rien');
    if (srcParseSansFiltre !== srcParse) {
      const Pmut = new Function(srcLooksFr + srcNonFr + srcValide + '\n' + srcParseSansFiltre + '\nreturn { _parseAnalyseBullets };')();
      const rMut = Pmut._parseAnalyseBullets(sortieAnglaise);
      v('(témoin) sans le filtre, l\'anglais de la capture client revient bien tel quel',
        rMut.length === 1 && /Bank of Japan/.test(rMut[0]), JSON.stringify(rMut));
    }
  }
}

/* ══ COPILOTE MACRO (25/09, capture : « L'Assistant IA Macro est momentanément saturé… » suivi de
   titres ANGLAIS). Deux défauts dans le même repli : il lisait `headline` (l'original) au lieu de
   `_titreFr`, et il s'affichait pour une réponse simplement COUPÉE par la limite de longueur, que la
   garde anti-troncature jetait en bloc. On rejoue les vraies fonctions. */
console.log('\n── Copilote Macro : réponse coupée gardée, repli en français, jamais « saturé » ──');
{
  const a = SRV.indexOf('function _aiChatCouper(t) {'), b = SRV.indexOf('function _aiChatPrompt(q, newsCtx) {');
  v('les fonctions du repli sont extractibles', a > 0 && b > a);
  const now = Date.now();
  const K = new Function('_looksFr', '_stripMd', '_smartBias', 'allCalendar', '_WA', SRV.slice(a, b) + '\nreturn { _aiChatCouper, _aiChatFallback };')(
    t => /\b(le|la|les|des|du|recule|après)\b/i.test(t), t => String(t), { conclusion: { USD: 'Bearish', EUR: 'Bullish' } },
    [{ timestamp: now + 3600e3, impact: 'High', currency: 'USD', title: 'Non-Farm Employment Change' }], { themeJour: () => ({ lbl: 'NFP américain' }) });
  const coupe = 'Le dollar recule. La Fed reste prudente et le marché attend le NFP de vendredi, qui décidera de la suite pour EUR/USD autour de 1,1650. Les rendements américains se détendent et soutiennent les devises à risque comme';
  v('une réponse coupée par la limite est gardée jusqu\'à sa dernière phrase', K._aiChatCouper(coupe) === coupe.slice(0, coupe.indexOf('1,1650.') + 7), K._aiChatCouper(coupe));
  v('… une réponse complète passe telle quelle', K._aiChatCouper('Réponse complète et assez longue pour passer la garde du premier coup.') === 'Réponse complète et assez longue pour passer la garde du premier coup.');
  v('… presque rien de phrasé : jetée (le repli prend le relais)', K._aiChatCouper('Court et coupé sans point') === '' && K._aiChatCouper(null) === '');
  v('… un nombre décimal n\'est pas une fin de phrase', K._aiChatCouper('Taux à 3.5% puis la Fed monte encore et encore sans jamais finir sa phrase proprement ni poser un point final') === '');
  const news = [{ headline: 'Dollar slides as Treasury yields fall', _titreFr: 'Le dollar recule avec la détente des rendements' }, { headline: 'Oil jumps on supply fears' }];
  const fb = K._aiChatFallback(news, 'Biais EURUSD ?');
  v('le repli ne dit JAMAIS « saturé »', !/satur/i.test(fb), fb);
  v('… il lit le titre FRANÇAIS affiché, jamais l\'original anglais', /Le dollar recule avec la détente/.test(fb) && !/Oil jumps|Dollar slides/.test(fb), fb);
  v('… il répond avec le Radar de Biais des devises nommées', /USD : biais baissier/.test(fb) && /EUR : biais haussier/.test(fb), fb);
  v('… et les prochains rendez-vous à fort impact, en français', /NFP américain/.test(fb), fb);
  v('toutes les voies du chat passent la question au repli', !/_aiChatFallback\(newsCtx\)/.test(SRV) && /_aiChatFallback\(newsCtx, q\)/.test(SRV));
  v('… et la réponse bufferisée n\'est plus jetée pour une coupure', /answer = _aiChatCouper\(answer\) \|\| null;/.test(SRV));
}

console.log(`\n${ko === 0 ? '✅' : '❌'} repli-francais-verif : ${ok} contrôle(s) vert(s), ${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);

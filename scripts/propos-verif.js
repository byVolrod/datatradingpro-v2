#!/usr/bin/env node
/* ═══ LE PANNEAU D'UNE PRISE DE PAROLE : LA NOTE EST PARTIE, LES PROPOS SONT EN FRANÇAIS ═══════
   09/09. Deux décisions de l'utilisateur sur la MÊME surface — le panneau qui s'ouvre sous le
   bouton Info quand un responsable prend la parole.

   1. LA NOTE DU DESK EST RETIRÉE (« ça je comprends pas, enlève »). Sous la liste des propos, le
      desk posait « Contexte DTP : … », fabriqué par un cycle IA de fond. Elle a d'abord été
      rhabillée, puis réécrite ; relue une fois de plus, elle part. Le banc vérifie qu'elle est
      RETIRÉE ET NON MASQUÉE : le rendu, le cycle, le prompt, les vetos, les compteurs et les clés
      de cache. Le précédent du dépôt est explicite — « déplacer ce dont personne ne veut, ce n'est
      pas le retirer » —, et une fabrication qui tourne pour un texte que personne n'affiche coûte
      du quota IA à chaque cycle sans que rien ne le signale.
   2. LES PROPOS SONT TRADUITS (« en plus la description n'est pas traduite »). Ils restaient en
      anglais alors que le mécanisme de traduction était bien branché : il PERDAIT LA COURSE. Le
      client masque les lignes puis, à 2,5 s, renonce, révèle l'anglais et le FIGE ; la traduction
      revenue à 4 s était reçue et jamais peinte. Elle est donc préparée EN FOND, avant l'ouverture.

   ⚠️ CE BANC EXTRAIT LES VRAIES FONCTIONS d'app.js et de server.js. Il n'en recopie aucune : une
   copie resterait verte le jour où l'original change. */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 400) : '')); } };
const extraire = (src, nom) => {
  const m = new RegExp('function ' + nom + '\\([\\s\\S]*?\\n\\}').exec(src);
  return m ? m[0] : null;
};

console.log('\n── 1. La note « Contexte DTP » est RETIRÉE, pas masquée ──');
/* Le rendu d'abord : c'est ce que l'utilisateur voit. */
v('plus aucun libellé « Contexte DTP » dans le code client', !/Contexte DTP/.test(APP), (APP.match(/.{0,60}Contexte DTP.{0,60}/) || [''])[0]);
v('… ni de traduction orpheline dans les dictionnaires',
  !/Contexte DTP/.test(fs.readFileSync(path.join(RACINE, 'public/js/i18n-dicts.js'), 'utf8')));
v('… ni de fabricant de bloc (_ctxProposHtml)', !/_ctxProposHtml/.test(APP));
v('… ni de lecteur de champ (_ctxProposDe / _proposCtx)', !/_ctxProposDe|_proposCtx/.test(APP));
v('… ni d\'habillage resté dans la feuille de style', !/iq-ctx|iq-note-lbl/.test(CSS));
/* Puis la FABRICATION : sans ça le quota IA continue de partir pour rien, en silence. */
v('le cycle de fond est supprimé du serveur', !/_enrichProposCtx\s*\(/.test(SRV), (SRV.match(/.{0,60}_enrichProposCtx\s*\(.{0,40}/) || [''])[0]);
v('… donc plus rien ne l\'appelle au planificateur', !/_enrichProposCtx\(\)\.catch/.test(SRV));
v('le prompt et ses vetos sont partis avec lui', !/_proposCtxPrompt|_PROPOS_VETO_RX|_proposParaphrase/.test(SRV));
v('… ainsi que ses clés de cache durables', !/proposfr[0-9]:/.test(SRV), (SRV.match(/proposfr[0-9]:/) || [''])[0]);
v('… et son compteur du moniteur admin', !/_proposStats\(\)/.test(SRV));
/* CE QUI DOIT SURVIVRE. Le drapeau `_propos` sert désormais à la pré-traduction : le retirer
   couperait la traduction en même temps que la note, sans que rien ne le dise. */
v('le drapeau _propos survit (il ouvre la pré-traduction)', /item\._propos = true/.test(SRV));
v('la liste des propos elle-même est intacte', /article-points">\$\{quotesHtml\}/.test(APP));
/* Les onze phrases d'indisponibilité partagent la classe `.iq-note` : elles ne partent pas. */
v('les phrases d\'indisponibilité (.iq-note) sont intactes',
  /\.iq-note\s*\{[^}]*font-style:\s*italic/.test(CSS) && /class="iq-note">Résumé indisponible/.test(APP));

console.log('\n── 2. Le français arrive AVANT que le panneau ne s\'ouvre ──');
const srcTxt = extraire(APP, '_txtPropos'), srcStrip = extraire(APP, 'stripSpeakerPrefix');
v('_txtPropos est extractible d\'app.js', !!srcTxt);
v('stripSpeakerPrefix est extractible d\'app.js', !!srcStrip);
if (srcTxt && srcStrip) {
  const stripSpeakerPrefix = eval('(' + srcStrip + ')');
  const _txtPropos = eval('(' + srcTxt + ')');
  const brut = { headline: 'Fed\'s Hammack: neutral rate seen higher than other Fed officials' };
  v('sans pré-traduction, on retombe sur la source ébarbée',
    _txtPropos(brut) === 'neutral rate seen higher than other Fed officials', _txtPropos(brut));
  v('la pré-traduction, quand elle existe, l\'emporte',
    _txtPropos({ ...brut, _hlFr: 'le taux neutre est jugé plus élevé' }) === 'le taux neutre est jugé plus élevé');
  /* ⚠️ LE PIÈGE : ré-ébarber le français. La regex de préfixe coupe au premier « : » ou « - », et
     une phrase française en contient couramment. Ce contrôle est le seul qui le voie. */
  const fr = 'l\'inflation reste élevée, mais - selon lui - les conditions sont restrictives';
  v('le français n\'est PAS ré-ébarbé (il serait tronqué)', _txtPropos({ ...brut, _hlFr: fr }) === fr, _txtPropos({ ...brut, _hlFr: fr }));
  v('… alors que la regex, elle, le tronquerait bel et bien', stripSpeakerPrefix(fr) !== fr, stripSpeakerPrefix(fr));
  v('une pré-traduction vide ne masque pas la source', _txtPropos({ ...brut, _hlFr: '   ' }) === 'neutral rate seen higher than other Fed officials');
  v('les DEUX branches de rendu passent par _txtPropos (grappe et orateur seul)',
    (APP.match(/const text = _txtPropos\(q\);/g) || []).length === 2);
}
/* Le serveur traduit le titre DÉJÀ ébarbé : les deux implémentations doivent tomber d'accord,
   sinon une ligne commencerait par « Hammack (Fed) déclare que… » et les autres non. */
const mJumeau = /const _proposSansPrefixe = ([^;]+);/.exec(SRV);
v('_proposSansPrefixe est extractible de server.js', !!mJumeau);
if (mJumeau && srcStrip) {
  const stripSpeakerPrefix = eval('(' + srcStrip + ')');
  const _proposSansPrefixe = eval('(' + mJumeau[1] + ')');
  const echantillon = [
    'Fed\'s Hammack: neutral rate seen higher than other Fed officials',
    'BoE\'s Mann — wage growth is moderating faster than expected',
    'Now is time to act given persistence of inflation.',
    'ECB Lagarde: we are data dependent',
    'Treasury has its own objectives, Fed operates independently for its own goals.',
    'Pakistan Foreign Ministry spokesperson: US unilateral sanctions on Iran violate international law',
  ];
  const desaccords = echantillon.filter(h => _proposSansPrefixe(h) !== stripSpeakerPrefix(h));
  v('client et serveur ébarbent EXACTEMENT pareil', desaccords.length === 0, desaccords.join(' || '));
}
v('un cycle de fond pré-traduit les propos', /async function _prechaufferProposFr\(/.test(SRV));
v('… et il est bien branché au planificateur', /_prechaufferProposFr\(\)\.catch/.test(SRV));
const srcCycle = extraire(SRV, '_prechaufferProposFr') || '';
v('… en priorité « background » (il cède avant les autres travaux)', /priority: 'background'/.test(srcCycle), srcCycle.slice(0, 200));
v('… sous un plafond journalier propre, désactivable sans redéploiement',
  /PROPOS_FR_MAX_JOUR <= 0/.test(srcCycle) && /process\.env\.PROPOS_FR_MAX_JOUR/.test(SRV));
/* ⚠️ CE CONTRÔLE ÉTAIT LEXICAL ET IL A ACCUSÉ UN CODE CORRECT (27/08). Il exigeait la présence
   littérale de `fr !== c.t` ; le jour où la garde a été réécrite en `if (!c || !fr || fr === c.t)
   return;` — la MÊME règle, en mieux — il est passé au rouge. Un banc qui punit une amélioration
   pousse à ne plus améliorer. Le comportement est désormais ÉPROUVÉ pour de vrai, plus bas, en
   faisant tourner le cycle avec une traduction qui échoue. */
v('… et ce qui est déjà français n\'est pas payé deux fois', /_looksFr\(t\)/.test(srcCycle));
v('… ni deux fois le même propos reposté', /vus\.has\(t\)/.test(srcCycle));
v('la garde de fraîcheur borne la dépense au récent', /6 \* 60 \* 60 \* 1000/.test(srcCycle));
v('la consommation est mesurée dans le moniteur admin', /proposFr: _proposFrStats\(\)/.test(SRV));
/* La traduction arrive APRÈS coup : la poser sous les yeux d'un lecteur serait le défaut du 24/08
   par ajout. Réserve pendant qu'un panneau est ouvert, promotion à la fermeture du dernier. */
v('elle est mise en réserve tant qu\'un panneau est ouvert', /_hlFrEnAttente = inc\._hlFr/.test(APP));
v('… et promue à la fermeture du dernier panneau', /_hlFr = it\._hlFrEnAttente/.test(APP));
v('… puis la carte est rebâtie sans attendre le tick du fil', /_rafraichirCartesPropos\(ids\)/.test(APP));


/* ═══ 3. LE TITRE DU FIL EST TRADUIT LUI AUSSI ══════════════════════════════════════════════════
   27/08, capture client : une dépêche géopolitique affichée EN ANGLAIS dans le fil — « Chinese
   executives may join Xi's US trip… ». Le mécanisme de pré-traduction existait bel et bien, et il
   traduisait déjà des titres… mais UNIQUEMENT ceux des propos (`if (!it._propos) continue`). Un
   titre de dépêche ordinaire n'était traduit NULLE PART : le cycle voisin ne prend que la
   DESCRIPTION. Le lecteur avait donc du français dès qu'il ouvrait une news, et de l'anglais tant
   qu'il ne l'ouvrait pas — c'est-à-dire dans le fil, qui est ce qu'on regarde le plus. */
console.log('\n── 3. Le titre du fil est traduit, pas seulement les propos ──');
const CYCLE = (function () {
  const d = SRV.indexOf('async function _prechaufferProposFr()');
  if (d < 0) return '';
  const f = SRV.indexOf('\n}\n', d);
  return f < 0 ? '' : SRV.slice(d, f + 3);
})();
v('le cycle de pré-traduction est extractible de server.js', !!CYCLE);
/* LE DÉFAUT, NOMMÉ : la garde qui écartait tout ce qui n'était pas un propos. */
v('il ne s\'arrête plus aux seuls propos', !/if \(!it \|\| !it\._propos/.test(CYCLE),
  'la garde « !it._propos » écarte encore les titres ordinaires');
v('… et il vise bien un champ de titre pour les autres', /_titreFr\s*=\s*fr/.test(CYCLE));
/* DEUX CHAMPS, PAS UN. `_hlFr` porte un propos ÉBARBÉ de son locuteur : le servir comme titre de
   fil ferait disparaître « BoE's Mann : » de la ligne. Les deux ne doivent jamais se croiser. */
v('les propos gardent leur champ à eux (_hlFr)', /_hlFr\s*=\s*fr/.test(CYCLE));
v('… et le cycle choisit l\'un OU l\'autre selon la nature de l\'item',
  /estPropos\s*\?[\s\S]{0,40}_hlFr|if \(c\.estPropos\)/.test(CYCLE));
/* ⚠️ L'ÉBARBAGE DE LOCUTEUR NE DOIT PAS TOUCHER UN TITRE ORDINAIRE. `_proposSansPrefixe` coupe
   tout ce qui précède le premier « : », « - » ou « — » dans les 55 premiers caractères : juste
   pour « BoE's Mann: … », désastreux pour « Trump-Xi call », qui deviendrait « Xi call ». */
v('l\'ébarbage de locuteur reste réservé aux propos',
  /estPropos \? _proposSansPrefixe/.test(CYCLE),
  'un titre ordinaire passerait par _proposSansPrefixe et perdrait son début');
{
  const m = /const _proposSansPrefixe = h => ([\s\S]*?);\n/.exec(SRV);
  v('… et le danger est réel, pas théorique', !!m);
  if (m) {
    // eslint-disable-next-line no-eval
    const F = eval('(h => ' + m[1] + ')');
    v('   « Trump-Xi call » perdrait bien son début', F('Trump-Xi call on trade deal') !== 'Trump-Xi call on trade deal',
      'obtenu : ' + F('Trump-Xi call on trade deal'));
    v('   tandis qu\'un propos y gagne', /inflation/.test(F("BoE's Mann: inflation still too high")));
  }
}
/* LES RAPPORTS DU DESK SONT ÉCRITS EN FRANÇAIS : les traduire serait payer pour abîmer. */
v('les rapports du desk sont écartés', /_briefing \|\| it\._marketWrap \|\| it\._eventAnalysis/.test(CYCLE));
/* IMPORTANTES D'ABORD : le budget est fini, et si la journée se coupe en route ce doivent être les
   dépêches qui comptent qui auront été traduites. */
v('les news importantes passent en premier', /_isImportantNews/.test(CYCLE));

/* ── LE CYCLE, EXÉCUTÉ POUR DE VRAI ─────────────────────────────────────────────────────────────
   ⚠️ Tout ce qui précède lit du texte ; ce qui suit fait TOURNER la vraie fonction, avec des
   bouchons à la place de ses dépendances. C'est la seule façon de savoir ce qu'elle POSE — et
   c'est ce qui manquait : le contrôle anti-poison, écrit en cherchant une ligne précise, a viré au
   rouge le jour où cette ligne a été réécrite en mieux. */
const jouerCycle = (news, traduire) => {
  const poses = [];
  const F = new Function('ctx', 'return (async function () {'
    + '  const { allNews, _aiDay, _isImportantNews, _proposSansPrefixe, _looksFr, _traduireLot,'
    + '          saveHistory, broadcast, PROPOS_FR_PAR_CYCLE, PROPOS_FR_MAX_JOUR } = ctx;'
    + '  let _proposFrJour = "", _proposFrCount = 0, _proposFrEssais = 0;'
    + CYCLE.replace('async function _prechaufferProposFr()', 'const f = async function ()') + ';'
    + '  await f(); return { _proposFrCount, _proposFrEssais };'
    + '})()');
  return F({
    allNews: news,
    _aiDay: () => '2026-08-27',
    _isImportantNews: (h, c, p) => p === 'high',
    _proposSansPrefixe: h => String(h || '').replace(/^[^:—-]{3,55}\s*[-:—]\s*/, '').trim() || String(h || ''),
    _looksFr: str => /[àâçéèêëîïôùûüœ]/.test(str) || /\b(le|la|les|des|une?|du|au|aux|est|sont|pour|avec|sur|dans|plus|selon|après|avant)\b/i.test(str),
    _traduireLot: async (textes) => ({ translations: textes.map(traduire) }),
    saveHistory: () => {}, broadcast: () => { poses.push(1); },
    PROPOS_FR_PAR_CYCLE: 12, PROPOS_FR_MAX_JOUR: 300,
  });
};
const nouv = (o) => Object.assign({ id: Math.random().toString(36).slice(2), timestamp: Date.now() }, o);

(async () => {
  /* 1. LE CAS DE LA CAPTURE : une géopolitique en anglais, sans propos. */
  const geo = nouv({ headline: "Chinese executives may join Xi's US trip, as trade truce extension 'almost certain'" });
  await jouerCycle([geo], t => 'Des dirigeants chinois pourraient accompagner Xi aux États-Unis');
  v('   le titre d\'une dépêche ordinaire est bien traduit',
    geo._titreFr === 'Des dirigeants chinois pourraient accompagner Xi aux États-Unis',
    '_titreFr = ' + JSON.stringify(geo._titreFr));
  v('   … et son champ à lui, pas celui des propos', !geo._hlFr);

  /* 2. UN PROPOS garde son champ, et son texte ébarbé. */
  const prop = nouv({ headline: "BoE's Mann: inflation still too high for comfort", _propos: true });
  await jouerCycle([prop], t => 'FR:' + t);
  v('   un propos remplit _hlFr, jamais _titreFr', !!prop._hlFr && !prop._titreFr,
    '_hlFr = ' + JSON.stringify(prop._hlFr) + ' / _titreFr = ' + JSON.stringify(prop._titreFr));
  v('   … et sur son texte ÉBARBÉ du locuteur', /^FR:inflation/.test(prop._hlFr || ''), prop._hlFr);

  /* 3. ANTI-POISON — le contrôle qui manquait vraiment. `_traduireLot` REND LA SOURCE quand il
     échoue sur une ligne : la poser figerait l'anglais et la ligne ne serait jamais retentée. */
  const rate = nouv({ headline: 'Oil surges on renewed supply fears in the Gulf' });
  await jouerCycle([rate], t => t);                       // la « traduction » est la source
  v('   une traduction ratée n\'est JAMAIS posée (anti-poison)', !rate._titreFr,
    '_titreFr = ' + JSON.stringify(rate._titreFr));

  /* 4. Ce qui est déjà français n'est pas payé deux fois. */
  const dejaFr = nouv({ headline: 'Le pétrole bondit sur des craintes sur l\'offre au Moyen-Orient' });
  await jouerCycle([dejaFr], () => 'NE DEVRAIT PAS ÊTRE APPELÉ');
  v('   un titre déjà français n\'est pas retraduit', !dejaFr._titreFr, dejaFr._titreFr);

  /* 5. Les rapports du desk sont ÉCRITS en français : les traduire serait payer pour abîmer. */
  const rapport = nouv({ headline: 'DTP Daily Recap: what moved the tape', _briefing: true });
  await jouerCycle([rapport], () => 'NE DEVRAIT PAS ÊTRE APPELÉ');
  v('   un rapport du desk est écarté', !rapport._titreFr, rapport._titreFr);

  /* 6. IMPORTANTES D'ABORD : le budget est fini. Avec un seul crédit, c'est la tier-1 qui passe. */
  const banale = nouv({ headline: 'Minor wire story about a regional utility firm' });
  const majeure = nouv({ headline: 'Fed cuts rates in emergency move as markets tumble', priority: 'high' });
  const F2 = jouerCycle;
  await (async () => {
    // On force le débit à 1 en ne fournissant qu'un crédit : le cycle prend la première de son ordre.
    const news = [banale, majeure];
    const F = new Function('ctx', 'return (async function () {'
      + '  const { allNews, _aiDay, _isImportantNews, _proposSansPrefixe, _looksFr, _traduireLot,'
      + '          saveHistory, broadcast, PROPOS_FR_PAR_CYCLE, PROPOS_FR_MAX_JOUR } = ctx;'
      + '  let _proposFrJour = "", _proposFrCount = 0, _proposFrEssais = 0;'
      + CYCLE.replace('async function _prechaufferProposFr()', 'const f = async function ()') + ';'
      + '  await f();'
      + '})()');
    await F({
      allNews: news, _aiDay: () => '2026-08-27',
      _isImportantNews: (h, c, p) => p === 'high',
      _proposSansPrefixe: h => String(h || ''),
      _looksFr: () => false,
      _traduireLot: async (textes) => ({ translations: textes.map(t => 'FR:' + t) }),
      saveHistory: () => {}, broadcast: () => {},
      PROPOS_FR_PAR_CYCLE: 1, PROPOS_FR_MAX_JOUR: 300,
    });
  })();
  v('   avec UN seul crédit, c\'est la news importante qui est traduite',
    !!majeure._titreFr && !banale._titreFr,
    'majeure = ' + JSON.stringify(majeure._titreFr) + ' / banale = ' + JSON.stringify(banale._titreFr));

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert'));
  process.exit(ko ? 1 : 0);
})();
const _FIN_ASYNC = true;

/* ── LE CLIENT : le titre affiché, et la mise en réserve ─────────────────────────────────────── */
const TITRE = extraire(APP, '_newsDisplayTitle');
v('le résolveur de titre est extractible d\'app.js', !!TITRE);
v('il préfère la traduction quand elle existe', !!TITRE && /_titreFr/.test(TITRE));
/* ⚠️ ET IL PASSE PAR `_dtpTitle` DANS LES DEUX CAS : la traduction recopie fidèlement le nom du
   média collé en fin de titre, donc elle a autant besoin d'ébarbage que l'original. */
v('… en l\'ébarbant comme l\'original', !!TITRE && /_dtpTitle\(fr \|\|/.test(TITRE));
if (TITRE) {
  // eslint-disable-next-line no-eval
  const F = eval('(function(){ const _dtpTitle = s => String(s||"").trim();'
    + ' const _INFO_QUOTE_FALLBACK = "x";' + TITRE + '\nreturn _newsDisplayTitle;})()');
  v('   un titre traduit s\'affiche en français',
    F({ headline: 'Oil surges on supply fears', _titreFr: 'Le pétrole bondit sur des craintes d\'approvisionnement' })
      === 'Le pétrole bondit sur des craintes d\'approvisionnement');
  /* PAS D'ATTENTE, PAS DE LIGNE VIDE : tant que la traduction n'est pas là, on sert la source. */
  v('   sans traduction, la source est servie telle quelle',
    F({ headline: 'Oil surges on supply fears' }) === 'Oil surges on supply fears');
  v('   une traduction vide ne vide pas la ligne',
    F({ headline: 'Oil surges', _titreFr: '   ' }) === 'Oil surges');
  /* Un propos garde son titre de fil : `_hlFr` (ébarbé) ne doit jamais s'y substituer. */
  v('   un propos garde son locuteur dans le fil',
    F({ headline: "BoE's Mann: inflation still too high", _hlFr: 'inflation toujours trop élevée' })
      === "BoE's Mann: inflation still too high");
}
/* MÊME DISCIPLINE QUE LES AUTRES TRADUCTIONS : rien ne bouge sous les yeux d'un lecteur. */
v('le titre traduit est mis en réserve tant qu\'un panneau est ouvert',
  /_titreFrEnAttente = inc\._titreFr/.test(APP));
v('… et promu à la fermeture du dernier panneau', /_titreFr = it\._titreFrEnAttente/.test(APP));


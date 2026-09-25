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
/* ⚠️ LE BILAN DOIT ATTENDRE LES CONTRÔLES ASYNCHRONES (01/09). Le corps de ce banc tourne dans une
   IIFE asynchrone qui se termine par `process.exit` ; le code posé APRÈS elle s'exécute d'abord,
   mais un contrôle qui rend une PROMESSE (la course de traduction, section 5) se résout, lui, après
   ce `process.exit` : ses assertions ne s'affichaient pas et ne comptaient pas. Un banc vert sur un
   défaut avéré, exactement ce qu'on cherche à empêcher. Toute vérification asynchrone se déclare
   donc ici, et le bilan l'attend. */
let _attenteAsync = null;
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
const srcMaj = extraire(APP, '_majPhrase');
v('_majPhrase est extractible d\'app.js', !!srcMaj);
if (srcTxt && srcStrip && srcMaj) {
  const stripSpeakerPrefix = eval('(' + srcStrip + ')');
  const _majPhrase = eval('(' + srcMaj + ')');
  /* `_txtPropos` appelle désormais `_majPhrase` : on la lui fournit, sinon l'évaluation lève. Ce
     couplage est VOULU et c'est le banc qui l'a révélé en cassant — la fonction de rendu des
     propos capitalise maintenant sa sortie. */
  const _txtPropos = eval('(' + srcTxt + ')');
  const brut = { headline: 'Fed\'s Hammack: neutral rate seen higher than other Fed officials' };
  v('sans pré-traduction, on retombe sur la source ébarbée',
    _txtPropos(brut) === 'Neutral rate seen higher than other Fed officials', _txtPropos(brut));
  v('la pré-traduction, quand elle existe, l\'emporte',
    _txtPropos({ ...brut, _hlFr: 'le taux neutre est jugé plus élevé' }) === 'Le taux neutre est jugé plus élevé');
  /* ⚠️ LE PIÈGE : ré-ébarber le français. La regex de préfixe coupe au premier « : » ou « - », et
     une phrase française en contient couramment. Ce contrôle est le seul qui le voie. */
  const fr = 'l\'inflation reste élevée, mais - selon lui - les conditions sont restrictives';
  v('le français n\'est PAS ré-ébarbé (il serait tronqué)',
    _txtPropos({ ...brut, _hlFr: fr }) === _majPhrase(fr), _txtPropos({ ...brut, _hlFr: fr }));
  v('… alors que la regex, elle, le tronquerait bel et bien', stripSpeakerPrefix(fr) !== fr, stripSpeakerPrefix(fr));
  v('une pré-traduction vide ne masque pas la source', _txtPropos({ ...brut, _hlFr: '   ' }) === 'Neutral rate seen higher than other Fed officials');

  /* ══ CHAQUE PROPOS COMMENCE PAR UNE MAJUSCULE (03/09, demande user sur capture) ═══════════════
     « Il manque les majuscules en début de chaque phrase pour rendre ça professionnel. » Les fils
     de dépêches écrivent tout en bas de casse ; empilées, dix lignes ainsi rendues font brouillon.
     Les cas ci-dessous sont les phrases EXACTES de la capture, pas des exemples reconstruits.
     ⚠️ ET LA MOITIÉ QUI COMPTE, juste en dessous : ce qui NE DOIT PAS bouger. Une ligne ouvrant sur
     un nom propre, un sigle, un chiffre ou un guillemet n'est pas « à corriger » — la toucher
     abîmerait un texte déjà juste. C'est ce contrôle-là qui empêchera un futur « capitalise tout »
     de passer. */
  const capitalise = t => _txtPropos({ _hlFr: t });
  [['les conditions du marché du travail devraient s\'améliorer à mesure que la reprise s\'accélère',
    'Les conditions du marché du travail devraient s\'améliorer à mesure que la reprise s\'accélère'],
   ['le comité a jugé approprié de relever le taux directeur à 2,75%',
    'Le comité a jugé approprié de relever le taux directeur à 2,75%'],
   ['la trajectoire future du taux directeur n\'est pas fixée',
    'La trajectoire future du taux directeur n\'est pas fixée'],
   ['« les risques restent orientés à la hausse », selon le comité',
    '« Les risques restent orientés à la hausse », selon le comité'],
  ].forEach(([av, ap]) => v('capitalisé : « ' + av.slice(0, 44) + '… »', capitalise(av) === ap, capitalise(av)));

  ['Hayley Gourley, Karen Silk et Anna Breman ont noté des risques à la hausse',
   'Paul Conway et Carl Hansen ont estimé que les risques étaient équilibrés',
   'RBNZ maintient son taux directeur',
   '2,75% : le nouveau niveau du taux directeur',
  ].forEach(t => v('intact : « ' + t.slice(0, 44) + '… »', capitalise(t) === t, capitalise(t)));
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
/* 18/09, capture user : le fil entièrement en anglais un soir chargé (« à chaque fois on tape le
   quota met un truc intelligent »). Les cinq tâches de fond du cycle news appellent TOUTES
   aiSmart('news', …) : même catégorie, même enveloppe de 60 % du budget Gemini journalier — donc
   un ORDRE D'APPEL implicite, la première tâche exécutée dans le tick voit le quota AVANT les
   suivantes. Les titres tournaient EN DERNIER, derrière quatre tâches de contenu qui ne s'affiche
   qu'AU CLIC (analyse, titre de citation, description, impact marché) : sur une journée chargée,
   elles épuisaient le budget avant que le titre — affiché D'EMBLÉE dans le fil — n'ait sa chance.
   Il doit désormais passer EN PREMIER. */
{
  const iTitres      = SRV.indexOf('_prechaufferProposFr().catch');
  const iAnalyses    = SRV.indexOf('_enrichAnalyses().catch');
  const iInfoTitles  = SRV.indexOf('_enrichInfoTitles().catch');
  const iDescription = SRV.indexOf('_enrichDescriptionsFr().catch');
  const iImpacts     = SRV.indexOf('_enrichImpacts().catch');
  const tousTrouves  = [iTitres, iAnalyses, iInfoTitles, iDescription, iImpacts].every(i => i > 0);
  v('… et appelée EN PREMIER parmi les tâches de fond du cycle news (le titre du fil, affiché d\'emblée, réclame le quota partagé avant tout ce qui n\'est vu qu\'au clic)',
    tousTrouves && iTitres < iAnalyses && iTitres < iInfoTitles && iTitres < iDescription && iTitres < iImpacts,
    'positions : titres=' + iTitres + ' analyses=' + iAnalyses + ' infoTitles=' + iInfoTitles + ' description=' + iDescription + ' impacts=' + iImpacts);
}
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
/* LE DÉFAUT, NOMMÉ : la garde qui écartait tout ce qui n'était pas un propos.
   ⚠️ ON REGARDE LA BOUCLE DE SÉLECTION, PAS LE FICHIER (02/09). La formulation précédente cherchait
   « !it._propos » N'IMPORTE OÙ dans le cycle : elle a rougi le jour où une SECONDE boucle est
   apparue — celle qui recolle leur ligne du fil aux propos déjà traduits, et qui ne concerne
   légitimement que les propos. Un contrôle trop large finit par interdire du code correct, et on
   l'assouplit alors dans la précipitation. On borne donc la lecture à la boucle qui CHOISIT ce qu'on
   envoie traduire, celle qui part de `_ordre`. */
const _SELECTION = CYCLE.slice(Math.max(0, CYCLE.indexOf('for (const it of _ordre)')));
v('il ne s\'arrête plus aux seuls propos', !!_SELECTION && !/if \(!it \|\| !it\._propos/.test(_SELECTION),
  'la garde « !it._propos » écarte encore les titres ordinaires');
v('… et il vise bien un champ de titre pour les autres', /_titreFr\s*=\s*fr/.test(CYCLE));
/* DEUX CHAMPS, PAS UN, ET C'EST TOUJOURS VRAI. `_hlFr` porte le propos ÉBARBÉ de son locuteur (le
   panneau le veut nu) ; `_titreFr` porte la ligne ENTIÈRE du fil. Ce qui a changé le 02/09, c'est
   qu'un propos remplit désormais LES DEUX — avant, il ne remplissait que `_hlFr` et sa ligne du fil
   n'était traduite nulle part. Le recollage du préfixe évite une seconde traduction. */
v('les propos gardent leur champ à eux (_hlFr)', /_hlFr\s*=\s*fr/.test(CYCLE));
v('… et leur ligne du fil est remplie SANS repayer une traduction',
  /c\.it\._titreFr = \(prefixe \+ fr\)\.trim\(\)/.test(CYCLE) && !/_traduireLot[\s\S]{0,200}_titreFr/.test(CYCLE),
  (CYCLE.match(/.{0,60}_titreFr = \(prefixe.{0,40}/) || [''])[0]);
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
/* LE CONTRÔLE DE SORTIE DU 01/09 FAIT PARTIE DU CYCLE, DONC DE CE BANC. Depuis qu'une traduction
   n'est posée que si elle est VRAIMENT française (`_traductionFrValide`, cf. langue-verif.js), le
   cycle appelle une fonction de plus. Elle est EXTRAITE de server.js, jamais recopiée : la doublure
   dirait « français » là où la production dit « non », et ce banc validerait un comportement que
   personne n'exécute. Ses seules dépendances sont `_RX_NON_FR` et `_looksFr`, déjà bouchonné. */
const CTRL_FR = ((SRV.match(/const _RX_NON_FR = [^\n]+/) || [''])[0] + '\n'
               + (SRV.match(/const _traductionFrValide = [^\n]+/) || [''])[0]);
v('le contrôle de sortie des traductions est extractible de server.js', /_traductionFrValide/.test(CTRL_FR));
const jouerCycle = (news, traduire) => {
  const poses = [];
  const F = new Function('ctx', 'return (async function () {'
    + '  const { allNews, _aiDay, _isImportantNews, _proposSansPrefixe, _looksFr, _traduireLot,'
    + '          saveHistory, broadcast, PROPOS_FR_PAR_CYCLE, PROPOS_FR_MAX_JOUR } = ctx;'
    + CTRL_FR + ';'
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
  /* La doublure de traduction RECOPIE le texte qu'on lui donne (c'est ainsi qu'on prouve l'ébarbage)
     mais doit rendre du FRANÇAIS, sinon le contrôle de sortie posé le 01/09 la refuse à bon droit :
     depuis les cinq lignes italiennes du fil, une traduction qui n'est pas française n'est plus
     enregistrée. D'où la queue française, qui ne gêne pas l'ancrage en tête. */
  const prop = nouv({ headline: "BoE's Mann: inflation still too high for comfort", _propos: true });
  await jouerCycle([prop], t => 'FR:' + t + ' selon la banque centrale');
  v('   un propos remplit _hlFr', !!prop._hlFr, '_hlFr = ' + JSON.stringify(prop._hlFr));
  v('   … sur son texte ÉBARBÉ du locuteur', /^FR:inflation/.test(prop._hlFr || ''), prop._hlFr);
  /* ⚠️ ET SA LIGNE DU FIL AUSSI (02/09, capture utilisateur : « US President Trump says US striking
     Iranian targets near Hormuz » en anglais dans le fil, avec ses « +4 propos »).
     CE BANC ENCODAIT LE DÉFAUT : il exigeait « un propos remplit _hlFr, JAMAIS _titreFr ». Or le fil
     n'affiche QUE `_titreFr` (`_newsDisplayTitle`, app.js). Une dépêche de propos n'était donc
     traduite que dans son PANNEAU, et sa ligne restait en anglais pour toujours — la boucle saute un
     propos dès que `_hlFr` est posé. Français au clic, anglais dans le fil : c'est-à-dire anglais là
     où on regarde le plus.
     La séparation des deux champs, elle, reste juste et le contrôle suivant la garde : `_hlFr` est le
     propos SANS son locuteur (le panneau le veut nu), `_titreFr` est la ligne ENTIÈRE. On ne paie pas
     deux traductions : on recolle le préfixe d'origine, qui est un nom propre et un séparateur. */
  v('   … ET sa ligne du fil est traduite elle aussi (_titreFr)', !!prop._titreFr,
    '_titreFr = ' + JSON.stringify(prop._titreFr));
  v('   … en gardant le locuteur, que le panneau retire mais que le fil doit montrer',
    /^BoE's Mann: FR:inflation/.test(prop._titreFr || ''), prop._titreFr);

  /* 2 bis. AUCUN PRÉFIXE À RECOLLER — le cas EXACT de la capture : « US President Trump says … » ne
     porte ni deux-points ni tiret, l'ébarbage ne retire donc rien et la ligne entière EST le propos.
     `_titreFr` doit alors valoir exactement `_hlFr`, sans préfixe fantôme ni espace en trop. */
  const prop2 = nouv({ headline: 'US President Trump says US striking Iranian targets near Hormuz', _propos: true });
  await jouerCycle([prop2], () => 'Trump dit que les États-Unis frappent des cibles iraniennes près d\'Ormuz');
  v('   un propos SANS préfixe : la ligne du fil vaut exactement la traduction',
    prop2._titreFr === prop2._hlFr && /^Trump dit/.test(prop2._titreFr || ''),
    '_titreFr = ' + JSON.stringify(prop2._titreFr) + ' / _hlFr = ' + JSON.stringify(prop2._hlFr));

  /* 2 ter. LE STOCK DÉJÀ TRADUIT SE RÉPARE SEUL, sans un seul appel d'IA. Les propos traduits AVANT
     ce correctif portent `_hlFr` et pas `_titreFr` : la boucle les saute (« déjà traduit »), donc
     leur ligne serait restée en anglais POUR TOUJOURS — y compris celle de la capture. */
  const vieux = nouv({ headline: "ECB's Lane: wage growth is decelerating", _propos: true, _hlFr: 'la croissance des salaires ralentit' });
  await jouerCycle([vieux], () => 'NE DEVRAIT PAS ÊTRE APPELÉ');
  v('   un propos déjà traduit récupère sa ligne du fil, sans repayer la traduction',
    vieux._titreFr === "ECB's Lane: la croissance des salaires ralentit",
    '_titreFr = ' + JSON.stringify(vieux._titreFr));

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
      + CTRL_FR + ';'
      + '  let _proposFrJour = "", _proposFrCount = 0, _proposFrEssais = 0;'
      + CYCLE.replace('async function _prechaufferProposFr()', 'const f = async function ()') + ';'
      + '  await f();'
      + '})()');
    await F({
      allNews: news, _aiDay: () => '2026-08-27',
      _isImportantNews: (h, c, p) => p === 'high',
      _proposSansPrefixe: h => String(h || ''),
      // Doublure RÉALISTE, plus un « toujours faux » : depuis le 01/09 `_looksFr` sert AUSSI en aval
      // (une traduction non française n'est plus posée), et une doublure constante répondrait alors
      // à une question qu'on ne lui pose pas. Les deux dépêches d'ici sont anglaises, la doublure le
      // dit ; la traduction rendue, elle, est française, sinon elle serait refusée à bon droit.
      _looksFr: str => /[àâçéèêëîïôùûüœ]/.test(str) || /\b(le|la|les|des|une?|du|au|aux|est|sont|pour|avec|sur|dans|plus|selon|après|avant)\b/i.test(str),
      _traduireLot: async (textes) => ({ translations: textes.map(t => 'FR:' + t + ' selon la source') }),
      saveHistory: () => {}, broadcast: () => {},
      PROPOS_FR_PAR_CYCLE: 1, PROPOS_FR_MAX_JOUR: 300,
    });
  })();
  v('   avec UN seul crédit, c\'est la news importante qui est traduite',
    !!majeure._titreFr && !banale._titreFr,
    'majeure = ' + JSON.stringify(majeure._titreFr) + ' / banale = ' + JSON.stringify(banale._titreFr));


  /* ═══ 4. LES PROPOS DE LA FICHE BANQUE CENTRALE ═══════════════════════════════════════════════
     27/08, capture : le panneau « BANQUE CENTRALE · BOJ » affichait ses DERNIERS PROPOS en anglais.
     Le mécanisme était pourtant câblé — et sur demande explicite du 17/07 : la fiche appelle
     `_dtpTranslateQuotes` pour traduire en place. Mais il PERD LA COURSE, exactement comme le
     panneau Info avant lui : les lignes sont masquées, le repli renonce à 2,5 s, révèle l'anglais
     ET LE FIGE (`trFige`) — la traduction qui revient ensuite est jetée en silence.
     La réponse est la même que pour le panneau Info : SERVIR CE QUI EST DÉJÀ PRÊT. Ces propos sont
     marqués `_propos` à l'ingestion, donc le cycle de fond leur a déjà posé `_hlFr`. La route les
     rendait sans. Elle les rend maintenant avec.
     ⚠️ ET LE PIÈGE QUI COMPTE : le ton (hawkish / dovish / neutre) se lit sur des regex ANGLAISES.
     Remplacer la déclaration par sa traduction rendrait le badge muet — le panneau perdrait sa
     lecture de posture pour gagner une lecture de propos. On analyse la VO, on affiche le FR. */
  console.log('\n── 4. Les propos de la fiche banque centrale ──');
  const CHARTS = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');
  const ROUTE = (function () {
    const d = SRV.indexOf("app.get('/api/cb-quotes'");
    if (d < 0) return '';
    const f = SRV.indexOf('\n});', d);
    return f < 0 ? '' : SRV.slice(d, f + 4);
  })();
  v('la route des propos est extractible de server.js', !!ROUTE);
  v('elle joint la traduction déjà préparée', /fr:\s*i\._hlFr/.test(ROUTE),
    'sans elle, la fiche doit traduire en direct — et perd la course contre son propre repli');
  v('… sans cesser de servir la VO', /h:\s*i\.headline/.test(ROUTE));

  /* LE PIÈGE DU TON, ÉPROUVÉ SUR LES VRAIES REGEX : une déclaration traduite ne doit JAMAIS
     atteindre l'analyseur, sinon le badge disparaît. */
  const _rx = (nom) => { const m = new RegExp('const ' + nom + ' = (/.*/[a-z]*);').exec(CHARTS); return m ? m[1] : null; };
  const rxDove = _rx('_CAL_DOVE_RX');
  v('les regex de ton sont extractibles de charts.js', !!rxDove);
  if (rxDove) {
    // eslint-disable-next-line no-eval
    const DOVE = eval(rxDove);
    const vo = 'BoJ may pace up rate hike if financial conditions are too accommodative';
    const fr = 'La BoJ pourrait accélérer la hausse des taux si les conditions financières sont trop accommodantes';
    v('   la VO déclenche bien la détection de ton', DOVE.test(vo));
    v('   … et sa traduction NE la déclenche PAS (le piège)', !DOVE.test(fr),
      'si ce contrôle passe au vert dans les deux sens, le piège n\'est pas démontré');
  }
  /* LA CONSÉQUENCE, DANS LE CODE : l'analyse reçoit `statement` (la VO), le rendu peint `fr`. */
  const DECOUPE = (CHARTS.match(/quotes = quotes\.map\(q => \{[^\n]*\n?[^\n]*\}\);/) || [''])[0]
    || (CHARTS.match(/quotes = quotes\.map\(q => \{.*?\}\);/s) || [''])[0];
  v('la découpe des propos est extractible', !!DECOUPE);
  v('… le ton est calculé sur la VO', /_calToneOf\(\[p\.statement\]\)/.test(DECOUPE),
    'le ton doit se lire sur la déclaration d\'origine, jamais sur sa traduction');
  v('… et la traduction est portée à côté, pas à la place', /fr: q\.fr/.test(DECOUPE));
  /* LE RENDU : le français d'abord, la VO en repli — jamais l'inverse, jamais rien.
     Le compte est un INVENTAIRE épinglé : un rendu de propos qui apparaît sans passer ici resterait
     en VO sans que rien ne rougisse. Trois sites depuis le 29/08 — le générique de la fiche, le
     bloc historique, et `_qRow` du mode « discours passé » (les propos APRÈS une prise de parole,
     demande user). Un quatrième devra se déclarer ici ET préférer la traduction. */
  const RENDUS = CHARTS.match(/cal-kb-quote">\$\{_calEsc\([^)]*\)\}/g) || [];
  v('les trois rendus de propos sont trouvés', RENDUS.length === 3, RENDUS.join(' | '));
  v('… et tous préfèrent la traduction', RENDUS.every(r => /q\.fr \|\|/.test(r)), RENDUS.join(' | '));

  /* ⚠️ LE COMMENTAIRE QUI M'A MENTI. `charts.js` portait encore « derniers propos (titres VO, jamais
     traduits — veto) » alors que la traduction était demandée et câblée depuis le 17/07. Un
     commentaire périmé ment avec l'autorité du code : il a failli faire refuser une demande
     légitime de l'utilisateur. Ce contrôle interdit qu'il revienne. */
  v('plus aucun « jamais traduit — veto » sur les propos de la fiche',
    !/propos \(titres VO, jamais traduits/.test(CHARTS),
    'le commentaire périmé est revenu — il contredit le comportement réel depuis le 17/07');

  console.log('\n── 8. « Important » ne rate pas les dépêches au PLURIEL ──');
  /* ⚠️ TROUVÉ EN CHERCHANT POURQUOI DEUX DÉPÊCHES TRÈS URGENTES RESTAIENT EN ANGLAIS (11/09, capture
     user : « North Korea launches multiple ballistic missiles », « Iran strikes… », non traduites
     alors que des titres bien moins pressants l'étaient). `_isImportantNews` trie la file de
     traduction de fond par importance (§7 déjà couvert : « les news importantes passent en
     premier ») — mais `\bmissile\b` et `\bstrike\b` exigent une frontière de mot PILE après le
     singulier : dans « missileS »/« strikeS », le « s » qui suit reste un caractère de mot, \b ne
     matche donc JAMAIS, et la ligne retombait « non importante ». Elle passait alors derrière tout
     le reste dans une file qui ne débite que 20 titres/minute. Un contrôle de mots-clés isolé
     serait vert sur une regex qui ne matche plus rien en pratique : on l'éprouve donc contre de
     VRAIES formes de titres, au pluriel ET au singulier. */
  const rxM = SRV.match(/const _IMPORTANT_RX = (\/.*\/i);/);
  v('_IMPORTANT_RX est extractible de server.js', !!rxM);
  if (rxM) {
    const RX = eval(rxM[1]);
    const cas = [
      ['North Korea launches multiple ballistic missiles: South Korea\'s JCS', true],
      ['North Korea launched a ballistic missile', true],
      ['Iran strikes Israeli targets near Hormuz', true],
      ['Fed signals rate cuts ahead', true],
      ['ECB rate decisions loom before the summer break', true],
      ['Traders watch for interest rates moves this week', true],
      ['Trade wars escalate between two nations', true],
      ['OPEC agrees to new production quotas', true],
      ['Random equity news about a company earnings call', false],
    ];
    let toutBon = true;
    for (const [texte, attendu] of cas) {
      const r = RX.test(texte);
      if (r !== attendu) { toutBon = false; console.log(`      ⚠ "${texte}" -> ${r} (attendu ${attendu})`); }
    }
    v('[exécuté] les formes au PLURIEL (missiles, strikes, cuts, decisions, rates, wars) comptent comme importantes', toutBon);
    /* Témoin : remettre les singuliers stricts (le vrai bug du 11/09) doit faire échouer le test
       précédent sur "missiles"/"strikes" — sinon ce contrôle ne prouve rien. */
    const RX_MUTEE = /\b(fed|fomc|powell|ecb|bce|lagarde|boe|bailey|boj|ueda|snb|boc|rba|rbnz|cpi|inflation|nfp|payrolls?|gdp|pib|rate (decision|cut|hike)|interest rate|emergency|intervention|war|missile|strike|ceasefire|sanctions?|default|bailout|opec)\b/i;
    v('[exécuté] mutation : revenir aux singuliers stricts fait bien RATER les deux dépêches de la capture',
      !RX_MUTEE.test(cas[0][0]) && !RX_MUTEE.test(cas[2][0]),
      'si la mutation matche encore, le contrôle ci-dessus ne mord pas');
  }

  if (_attenteAsync) { try { await _attenteAsync; } catch (e) { v('les contrôles asynchrones s\'exécutent', false, e.message); } }
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


/* ── LE REPLI DE TRADUCTION NE FIGE PLUS L'ANGLAIS ─────────────────────────────────────────────
   01/09, capture utilisateur : un panneau de propos dont la PREMIÈRE ligne était en français et
   les six suivantes en anglais (« I think that that Japan is taking right steps for the economy »),
   avec la consigne « faut pas que ça se reproduise à l'avenir, tout doit être bien traduit dans le
   fil d'actualités ».
   CAUSE RACINE, dans `_dtpTranslateQuotes` : le repli de 2,5 s révélait la source ET posait
   `trFige`. Or `applyCache` saute les lignes figées. Une réponse arrivée à 4 s — le cas ordinaire
   quand la cascade IA gratuite est lente — était donc reçue, mise en cache… et jamais peinte.
   L'anglais restait pour toute la session, sans le moindre signe d'erreur. La première ligne, elle,
   était en français parce qu'elle tenait sa traduction du SERVEUR (`_hlFr`), sans passer par ce
   chemin : d'où le mélange exact de la capture.
   On éprouve la mécanique sur le VRAI code, en la faisant tourner : un serveur lent qui répond
   APRÈS le délai de repli doit quand même repeindre la ligne. */
console.log('\n── 5. Une traduction en retard repeint quand même la ligne ──');
{
  const src = extraire(APP, '_dtpTranslateQuotes');
  v('`_dtpTranslateQuotes` est extractible d\'app.js', !!src);
  if (src) {
    /* Lecture du code : le repli de DÉLAI ne doit pas figer, la passe FINALE doit figer. Les deux
       assertions vont ensemble — figer partout, c'est le défaut ; ne figer nulle part laisserait un
       squelette repeindre indéfiniment. */
    v('le repli de délai révèle SANS figer', /setTimeout\(\(\) => _repli\(false\), _TR_ATTENTE_MS\)/.test(src), src.slice(0, 0) || 'repli de délai introuvable');
    v('… et la passe finale, elle, fige (plus rien n\'est en vol)', /_repli\(true\)/.test(src));
    v('… « figer » est bien devenu un choix, pas un effet de bord', /const _reveler = \(li, fige\) =>/.test(src) && /if \(fige\) li\.dataset\.trFige = '1'/.test(src));
    v('… et une ligne TRADUITE reste définitive', /_traduire = \(li, fr\) => \{ li\.textContent = fr; _reveler\(li, true\); \}/.test(src));

    /* ── ET ON LE FAIT TOURNER. La lecture de code ci-dessus dirait « vert » sur une mécanique qui
       ne marche pas ; ici on rejoue la course réelle : délai de repli à 20 ms, serveur qui répond à
       120 ms. Avant le correctif, la ligne restait à l'anglais. Doublures minimales : un `document`
       réduit à ce que la fonction touche, un `fetch` lent, et le cache client. */
    const noeud = (txt) => ({ _t: txt, dataset: {}, classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      get textContent() { return this._t; }, set textContent(v2) { this._t = v2; },
      setAttribute() {}, removeAttribute() {} });
    const lignes = [noeud('I think that Japan is taking the right steps for the economy.'),
      noeud('I expect everyone to come along with us on Iran.')];
    const conteneur = { querySelectorAll: () => lignes };
    const bacs = {
      _TR_ATTENTE_MS: 20,
      _trClient: new Map(),
      fetch: () => new Promise(r => setTimeout(() => r({
        json: () => Promise.resolve({ translations: lignes.map((l, i) => i === 0
          ? 'Je pense que le Japon prend les bonnes mesures pour son économie.'
          : "Je m'attends à ce que tout le monde nous suive sur l'Iran.") }),
      }), 120)),
    };
    /* ⚠️ `extraire` démarre au mot `function` : il laisse donc le `async` sur le carreau, et le
       corps extrait contient des `await`. On le remet, sinon `new Function` refuse le code. */
    const f = new Function('_TR_ATTENTE_MS', '_trClient', 'fetch', 'async ' + src + '\nreturn _dtpTranslateQuotes;')(bacs._TR_ATTENTE_MS, bacs._trClient, bacs.fetch);
    _attenteAsync = f(conteneur).then(() => {
      v('une réponse arrivée APRÈS le repli repeint quand même la ligne (le défaut de la capture)',
        lignes.every(l => /^Je /.test(l.textContent)), JSON.stringify(lignes.map(l => l.textContent)));
      v('… et plus aucune ligne ne reste en anglais', !lignes.some(l => /\b(the|that|everyone)\b/i.test(l.textContent)),
        JSON.stringify(lignes.map(l => l.textContent)));
    }).catch(e => { v('le scénario de course s\'exécute', false, e.message); });

    /* ── CE QUI PART À LA TRADUCTION (25/09, capture user « chargement trop lent ») ────────────────
       Une ligne française sans accent ni petit mot connu (« - Brent : ↓ : prime de risque ») passait
       pour de l'anglais : elle était MASQUÉE sous un squelette le temps d'un aller-retour IA, alors
       qu'il n'y avait rien à traduire. On rejoue le vrai code et on lit ce qu'il ENVOIE. */
    const envoyes = [];
    const lignes2 = [noeud('- Brent : ↓ : prime de risque'), noeud('- Or : ↓ : reflux refuge'),
      noeud('Iran de-escalation talks stall over sanctions relief')];
    const f2 = new Function('_TR_ATTENTE_MS', '_trClient', 'fetch', 'async ' + src + '\nreturn _dtpTranslateQuotes;')(20, new Map(),
      (url, init) => { try { envoyes.push(...JSON.parse(init.body).texts); } catch (e) {} return Promise.resolve({ json: () => Promise.resolve({ translations: [] }) }); });
    const p2 = f2({ querySelectorAll: () => lignes2 });
    const masquees2 = lignes2.filter(l => l.classList.contains('dtp-tr-wait')).map(l => l._t);
    v('une ligne française courte (« prime de risque ») n\'est ni masquée ni envoyée à la traduction', !masquees2.some(t => /Brent|Or :/.test(t)), JSON.stringify(masquees2));
    _attenteAsync = Promise.all([_attenteAsync, p2.then(() => {
      v('… seule la vraie phrase anglaise part (« de-escalation » ne passe pas pour du français)',
        envoyes.length === 1 && /de-escalation/.test(envoyes[0]), JSON.stringify(envoyes));
    })]);
  }
}

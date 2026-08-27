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
/* ANTI-POISON : `_traduireLot` renvoie la SOURCE quand il échoue. La poser figerait l'anglais pour
   toujours et la ligne ne serait jamais retentée — le défaut payé sur le cache en juillet. */
v('… sans jamais figer l\'anglais quand la traduction échoue', /fr !== c\.t/.test(srcCycle), srcCycle);
v('… et ce qui est déjà français n\'est pas payé deux fois', /_looksFr\(t\)/.test(srcCycle));
v('… ni deux fois le même propos reposté', /vus\.has\(t\)/.test(srcCycle));
v('la garde de fraîcheur borne la dépense au récent', /6 \* 60 \* 60 \* 1000/.test(srcCycle));
v('la consommation est mesurée dans le moniteur admin', /proposFr: _proposFrStats\(\)/.test(SRV));
/* La traduction arrive APRÈS coup : la poser sous les yeux d'un lecteur serait le défaut du 24/08
   par ajout. Réserve pendant qu'un panneau est ouvert, promotion à la fermeture du dernier. */
v('elle est mise en réserve tant qu\'un panneau est ouvert', /_hlFrEnAttente = inc\._hlFr/.test(APP));
v('… et promue à la fermeture du dernier panneau', /_hlFr = it\._hlFrEnAttente/.test(APP));
v('… puis la carte est rebâtie sans attendre le tick du fil', /_rafraichirCartesPropos\(ids\)/.test(APP));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert'));
process.exit(ko ? 1 : 0);

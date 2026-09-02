#!/usr/bin/env node
/* ═══ LE TAG ANALYSE : UNE CARTE, PAS UN DOSSIER ═══════════════════════════════════════════════
   27/08, référence fournie en capture : « le tag analyse doit ressembler à l'image 2 ». Le panneau
   déroulait le rapport entier — six intertitres, une quinzaine de puces — là où la référence tient
   en UNE carte : une pastille, le libellé, l'heure, et un paragraphe de prose.
   ⚠️ CETTE RÈGLE A FAILLI, PUIS ÉTÉ RÉAFFIRMÉE (01/09). Entre-temps, le panneau avait pris
   l'habitude de remettre le dossier en six rubriques DERRIÈRE la carte (« la synthèse d'abord, le
   dossier derrière ») : la carte seule redevenait donc, avec le temps, un simple en-tête d'un
   panneau qui redéroulait tout en dessous. Nouvelle capture, même verdict que le 27/08 : la carte
   EST le panneau, rien d'autre ne s'affiche sous ce bouton.

   ⚠️ CE BANC EXTRAIT LES VRAIES FONCTIONS d'app.js et de style.css. Il n'en recopie aucune : une
   copie resterait verte le jour où l'original change, et c'est précisément ce qu'on veut voir. */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(RACINE, 'public/css/style.css'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const extraire = (nom) => {
  const m = new RegExp('function ' + nom + '\\([\\s\\S]*?\\n\\}').exec(APP);
  return m ? m[0] : null;
};

/* ⚠️ LA FORME A CHANGÉ DEUX FOIS LE 01/09, ET CE BANC DÉCRIVAIT LA PREMIÈRE. Il exigeait la CARTE
   (cadre, fond, pastille or, libellé, heure) posée le 27/08 sur une référence fournie. Seconde
   capture du 01/09 : « enlève le fond gris et le bouton jaune, faut que ce soit comme sur la 2ème
   image ». Il ne reste que la prose, sur le fond du panneau. Le banc éprouve donc l'inverse de ce
   qu'il exigeait : plus de cadre, plus de pastille, plus d'en-tête — et surtout, que le TEXTE, lui,
   n'ait rien perdu au passage (paragraphes, gras, échappement, repli à vide). */
console.log('\n── 1. Le tag n\'ouvre que sur du texte ──');
const srcCarte = extraire('_anaSynthese'), srcProse = extraire('_anaProse');
v('_anaSynthese est extractible d\'app.js', !!srcCarte);
v('_anaProse est extractible d\'app.js', !!srcProse);
if (srcCarte && srcProse) {
  /* eval d'une DÉCLARATION `function` dans un scope qui porte déjà le nom → « already declared ».
     On les évalue en EXPRESSIONS, ce qui donne aussi les références sans les redéclarer. */
  const _anaSynthese = eval('(' + srcCarte + ')');
  const _anaProse = eval('(' + srcProse + ')');
  const LEAD = ['La **RBA** a maintenu ses taux à 4,35%, à l\'unanimité et très largement attendu.',
                'Ton un peu moins restrictif que la fois précédente : prévisions d\'inflation rognées.'];
  const h = _anaSynthese(_anaProse(LEAD));

  v('plus aucun cadre ni fond autour du texte', !/ana-carte/.test(h) && !/ana-detail/.test(h), h);
  v('… plus de pastille', !/<i><\/i>/.test(h), h);
  v('… plus d\'en-tête « Analyse » (le bouton cliqué porte déjà ce nom)', !/Analyse/.test(h), h);
  v('… ni d\'heure recopiée (la ligne du fil la porte déjà)', !/<span>à /.test(h), h);
  v('le corps est de la PROSE, pas des puces', /<p>/.test(h) && !/<li>/.test(h) && !/<ul/.test(h), h);
  v('… un paragraphe par ligne du desk', (h.match(/<p>/g) || []).length === 2, h);
  v('le gras du desk est conservé', /<strong>RBA<\/strong>/.test(h), h);
  v('… et le Markdown brut ne fuit pas', !/\*\*/.test(h), h);

  /* ⚠️ LE REPLI À VIDE EST UNE CONDITION, PAS UNE POLITESSE. Le rendu du tag s'écrit
     `carte || (…puces…)` : une chaîne vide fait basculer sur les puces d'un vieux rapport sans
     accroche. Rendre un conteneur vide ouvrirait un panneau vide. */
  v('sans corps, rien n\'est rendu (c\'est ce qui déclenche le repli sur les puces)',
    _anaSynthese('') === '' && _anaSynthese(null) === '', JSON.stringify(_anaSynthese('')));
  /* L'ÉCHAPPEMENT : le lead vient d'un modèle, il n'a aucun droit d'injecter du HTML. */
  /* ⚠️ LE PREMIER JET DE CE CONTRÔLE ÉTAIT FAUX : il exigeait « &lt;img », donc un ÉCHAPPEMENT. Or
     _anaProse RETIRE les balises avant d'échapper — plus sûr encore, mais le contrôle rougissait sur
     du code correct. La vraie propriété n'est pas « c'est échappé », c'est : AUCUNE balise étrangère
     ne survit, quelle que soit la route prise pour l'éliminer. On l'éprouve donc sur les deux
     formes, la balise complète (retirée) et la balise tronquée (échappée), qui ne suivent pas le
     même chemin dans le code. */
  const inj  = _anaProse(['<img src=x onerror=alert(1)> et **gras**']);
  const inj2 = _anaProse(['<img src=x et **gras**']);            // jamais refermée : le strip ne la voit pas
  const horsCarte = t => String(t).replace(/<\/?(?:p|strong)>/g, '');
  v('aucune balise étrangère ne survit à l\'accroche', !/[<>]/.test(horsCarte(inj)), inj);
  v('… ni sous une forme tronquée', !/<[a-z]/i.test(horsCarte(inj2)) && /&lt;img/.test(inj2), inj2);
  v('… et aucun gestionnaire d\'événement ne passe', !/onerror/i.test(inj), inj);
  v('… sans casser le gras légitime', /<strong>gras<\/strong>/.test(inj) && /<strong>gras<\/strong>/.test(inj2), inj + ' || ' + inj2);
}

console.log('\n── 2. Le panneau ne rend QUE la synthèse, plus aucun dossier derrière ──');
/* 01/09, capture utilisateur, cette fois dans l'autre sens que le 27/08 : « le tag analyse doit
   ressembler à cette structure… très simplement… et non comme sur la 2ème image » — la 2ème image
   étant justement la carte SUIVIE du dossier en six rubriques (« Le détail »). Ce que le 27/08 avait
   posé comme concession (le dossier reste, mais derrière) est retiré : le tag ne rend plus QUE la
   carte de synthèse. */
const pan = (/if \(tab === 'analysis'\) \{[\s\S]*?\n    \}/.exec(APP) || [''])[0];
v('le panneau Analyse est repérable', pan.length > 200);
/* ⚠️ LA CARTE PORTE LA SYNTHÈSE, PAS L'ACCROCHE. L'accroche (`d.lead`) est le texte du tag INFO
   depuis le 31/08, à la demande de l'utilisateur, et desk-verif l'éprouve dans un vrai navigateur :
   la reprendre ici remettrait le même paragraphe sur deux boutons. Deux textes distincts, un par
   surface — cette séparation-là ne change pas avec le retrait du dossier. */
v('la carte est alimentée par la synthèse du desk', /_anaProse\(item\._evaSynth \? \[item\._evaSynth\] : \[\]\)/.test(pan), pan.slice(0, 300));
v('… et JAMAIS par l\'accroche, qui appartient à Info', !/_anaProse\(d\.lead\)/.test(pan));
/* LE DOSSIER (Chiffres clés, Ce qui a surpris, Réaction de marché…) N'EST PLUS CONSTRUIT DU TOUT
   dans ce panneau : ni `_evaDecoupe`, ni la boucle qui range ses rubriques sous « Le détail ». */
v('`_evaDecoupe` n\'est plus appelé dans ce panneau (le dossier n\'est plus construit ici)', !/_evaDecoupe\(item\.description\)/.test(pan), pan);
v('aucun bloc « Le détail » ne peut plus être rendu (`ana-detail` absent du panneau)', !/ana-detail/.test(pan), pan);
/* ⚠️ CE CONTRÔLE ÉVALUE LA VRAIE EXPRESSION DE COMPOSITION plutôt que de lire le texte du fichier
   (leçon du 27/08 : une sous-chaîne peut survivre à une mutation qui inverse le sens). */
const mComp = /expandEl\.innerHTML = carte[\s\S]*?;\n/.exec(pan);
v('l\'expression de composition est extractible', !!mComp);
if (mComp) {
  const rendu = new Function('carte', '_anaTs', '_puces', '_nrxQuand', '_renderInfoBullets',
    'const expandEl = {};' + mComp[0] + 'return expandEl.innerHTML;'
  )('[[CARTE]]', 1, ['x'], () => '[[QUAND]]', () => '[[PUCES]]');
  v('avec une synthèse, la carte est rendue SEULE (rien d\'autre accolé)', rendu === '[[CARTE]]', rendu);
  /* SANS SYNTHÈSE (`carte` vide) : repli sur les puces déjà chargées, comme avant l'introduction
     de la synthèse — jamais un cadre vide, jamais le dossier en six rubriques. */
  const repli = new Function('carte', '_anaTs', '_puces', '_nrxQuand', '_renderInfoBullets',
    'const expandEl = {};' + mComp[0] + 'return expandEl.innerHTML;'
  )('', 1, ['x'], () => '[[QUAND]]', () => '[[PUCES]]');
  v('sans synthèse, repli sur les puces (`_puces`), pas sur un dossier', repli === '[[QUAND]][[PUCES]]', repli);
}
/* ET LES NEWS ORDINAIRES NE CHANGENT PAS : la carte est réservée aux analyses d'événement. */
v('une news ordinaire garde son rendu à puces', /expandEl\.innerHTML = _nrxQuand\('Analyse', _anaTs\) \+ _renderInfoBullets\(_puces\);/.test(pan));

console.log('\n── 3. Deux surfaces, deux textes ──');
/* Le lead RACONTE (Info), la synthèse JUGE (Analyse). Le serveur doit les produire séparément, et
   surtout ne PAS verser la synthèse dans `description` : _evaDecoupe rangerait dans le lead tout ce
   qui précède la première rubrique, et Info la redirait mot pour mot. */
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
v('le desk rédige une synthèse distincte du lead', /"synthese": "<2 à 4 phrases de LECTURE, distinctes du lead/.test(SRV));
v('… et la consigne dit ce qui les sépare', /Le lead RACONTE ce qui s'est passé ; la synthèse le JUGE/.test(SRV));
v('… avec l\'ordre de ne rien meubler', /renvoie une chaîne vide — une synthèse creuse est pire/.test(SRV));
v('elle est posée en champ structuré', /_evaSynth: synthese \|\| null,/.test(SRV));
/* LE CONTRÔLE QUI COMPTE : la synthèse ne doit PAS rejoindre les lignes de la description. */
const corpsEva = (/const lead = _stripMd[\s\S]*?const description = lines\.join/.exec(SRV) || [''])[0];
v('… et n\'entre JAMAIS dans la description', corpsEva.length > 100 && !/lines\.push\(\s*synthese/.test(corpsEva) && !/synthese/.test(corpsEva), corpsEva.slice(0, 120));
v('la version d\'analyse est bumpée', /const EVA_VER = 1[3-9];/.test(SRV), (/const EVA_VER = \d+/.exec(SRV) || [''])[0]);
const mHas = /const hasInfo   = [\s\S]*?;\n/.exec(APP);
v('hasInfo est extractible', !!mHas);
if (mHas) {
  const f = new Function('item', 'rawDesc', 'hasGrouped', '_proposCtx', 'autoSummary', 'isInfoQuote', 'isSpeaker', 'speakerQuotesAtRender',
    mHas[0].replace('const hasInfo   =', 'return ').replace(/;\n$/, ';'));
  const longue = 'x'.repeat(200);
  /* ⚠️ J'AVAIS SUPPRIMÉ LE TAG INFO SUR CES ANALYSES, et desk-verif l'a refusé — à juste titre :
     « Info porte l'accroche » est une demande de l'utilisateur du 31/08, éprouvée en navigateur.
     Le bon partage n'est pas de retirer une surface, c'est de donner à chacune SON texte. */
  v('une analyse d\'événement garde son tag Info', f({ _eventAnalysis: true }, longue, false, null, [], false, false, []) === true);
  v('… comme une news ordinaire', f({}, longue, false, null, [], false, false, []) === true);
  v('… et une news sans matière n\'en a toujours pas', f({}, '', false, null, [], false, false, []) === false);
  v('… une citation groupée le garde aussi', f({}, '', true, null, [], false, false, []) === true);
}

console.log('\n── 4. L\'habillage : il n\'y en a plus, et c\'est le sujet ──');
/* Le texte garde sa métrique (taille, interligne, encre) ; tout ce qui l'entourait est parti. */
v('la prose a sa règle', /\.ana-prose \{/.test(CSS));
v('… avec sa métrique de lecture (taille, interligne)',
  /\.ana-prose \{[^}]*font-size: 12\.5px[^}]*line-height: 1\.6/.test(CSS),
  (CSS.match(/\.ana-prose \{[^}]*\}/) || [''])[0]);
/* ⚠️ LA RÈGLE A CHANGÉ LE 02/09, ET CE CONTRÔLE DISAIT L'INVERSE. Il exigeait `--text2`, l'encre
   secondaire, parce que c'est ce que la prose portait à sa création. Demande utilisateur : « couleur
   texte tag analyse, même que pour les autres tags, avec leur description en blanc ».
   MESURÉ avant de trancher, dans un vrai navigateur, sur une ligne portant les trois lectures : les
   panneaux Info et Impact marché rendent leur texte en rgb(232,234,237) tandis que cette prose
   sortait en gris secondaire. Le même déplié changeait donc d'encre selon l'onglet ouvert, et
   l'Analyse était la seule à paraître éteinte.
   On exige désormais le TOKEN de texte principal, et pas une valeur en dur : `--text` suit le thème
   clair tout seul, ce qui a permis de retirer les deux surcharges `[data-theme="light"]` — elles
   figeaient un gris qui ne suivait rien. */
v('… et son encre est celle du texte PRINCIPAL, comme les autres panneaux',
  /\.ana-prose \{[^}]*color: var\(--text,/.test(CSS) && !/\.ana-prose \{[^}]*color: var\(--text2/.test(CSS),
  (CSS.match(/\.ana-prose \{[^}]*\}/) || [''])[0]);
v('… le gras se distingue par sa GRAISSE, plus par sa couleur (elle est commune, maintenant)',
  /\.ana-prose strong \{[^}]*font-weight: 600/.test(CSS));
v('… et plus aucune surcharge de thème clair ne fige un gris à part',
  !/html\[data-theme="light"\] \.ana-prose/.test(CSS),
  (CSS.match(/html\[data-theme="light"\] \.ana-prose[^}]*\}/) || [''])[0]);
/* ⚠️ CE QUI DOIT AVOIR DISPARU DE LA FEUILLE, pas seulement du rendu : un style sans appelant
   ressuscite au premier copier-coller, et le prochain lecteur y chercherait un sens.
   On regarde les RÈGLES, pas le fichier entier : le commentaire qui explique le retrait cite
   forcément les noms retirés — un contrôle qui l'interdirait ferait supprimer l'explication. */
const _REGLES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
v('plus aucune règle de carte (fond gris, cadre)', !/\.ana-carte[\s,{]/.test(_REGLES),
  (_REGLES.match(/.{0,40}\.ana-carte.{0,40}/) || [''])[0]);
v('… ni de pastille or en tête', !/\.ana-carte-t/.test(_REGLES));
v('… ni du dossier retiré plus tôt dans la journée', !/\.ana-detail/.test(_REGLES));
/* ⚠️ MÊME RÈGLE CHANGÉE, DEUXIÈME TRACE (02/09). Ce contrôle exigeait une surcharge explicite pour
   le thème clair. Elle n'a plus lieu d'être depuis que la prose emploie le TOKEN `--text`, qui
   change de valeur avec le thème : la surcharge figeait un gris et empêchait justement la prose de
   suivre. Ce qu'on vérifie maintenant, c'est le RÉSULTAT — que le thème clair soit servi — et non
   le moyen par lequel il l'est.
   Deux contrôles pour une même règle changée, à deux endroits du fichier : c'est exactement ce que
   le projet redoute quand une décision évolue, d'où la consigne de corriger TOUTES ses traces dans
   le même commit. */
v('le thème clair est servi par le token, sans surcharge dédiée',
  /\.ana-prose \{[^}]*color: var\(--text,/.test(CSS)
  && /html\[data-theme="light"\][^{]*\{[^}]*--text:/.test(CSS.replace(/\s+/g, ' ')),
  'la prose doit suivre `--text`, et ce token doit bien être redéfini en thème clair');

console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
process.exit(ko ? 1 : 0);

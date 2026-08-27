#!/usr/bin/env node
/* ═══ LE TAG ANALYSE : UNE CARTE, PAS UN DOSSIER ═══════════════════════════════════════════════
   27/08, référence fournie en capture : « le tag analyse doit ressembler à l'image 2 ». Le panneau
   déroulait le rapport entier — six intertitres, une quinzaine de puces — là où la référence tient
   en UNE carte : une pastille, le libellé, l'heure, et un paragraphe de prose.

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

console.log('\n── 1. La carte a la forme de la référence ──');
const srcCarte = extraire('_anaCarte'), srcProse = extraire('_anaProse');
v('_anaCarte est extractible d\'app.js', !!srcCarte);
v('_anaProse est extractible d\'app.js', !!srcProse);
if (srcCarte && srcProse) {
  /* eval d'une DÉCLARATION `function` dans un scope qui porte déjà le nom → « already declared ».
     On les évalue en EXPRESSIONS, ce qui donne aussi les références sans les redéclarer. */
  const _anaCarte = eval('(' + srcCarte + ')');
  const _anaProse = eval('(' + srcProse + ')');
  const LEAD = ['La **RBA** a maintenu ses taux à 4,35%, à l\'unanimité et très largement attendu.',
                'Ton un peu moins restrictif que la fois précédente : prévisions d\'inflation rognées.'];
  const h = _anaCarte('Analyse', Date.UTC(2026, 7, 27, 10, 56), _anaProse(LEAD));

  v('une pastille ouvre l\'en-tête', /<div class="ana-carte-t"><i><\/i>/.test(h), h);
  v('le libellé suit la pastille', /<i><\/i>Analyse/.test(h), h);
  v('l\'heure est là, et à part', /<span>à \d{2}:\d{2}<\/span>/.test(h), h);
  v('le corps est de la PROSE, pas des puces', /<p>/.test(h) && !/<li>/.test(h) && !/<ul/.test(h), h);
  v('… un paragraphe par ligne du desk', (h.match(/<p>/g) || []).length === 2, h);
  v('le gras du desk est conservé', /<strong>RBA<\/strong>/.test(h), h);
  v('… et le Markdown brut ne fuit pas', !/\*\*/.test(h), h);

  /* SANS ACCROCHE, PAS DE CARTE VIDE : un vieux rapport doit retomber sur son dossier, pas rendre
     un cadre avec une pastille et rien dedans. */
  v('sans corps, aucune carte n\'est rendue', _anaCarte('Analyse', Date.now(), '') === '', JSON.stringify(_anaCarte('Analyse', Date.now(), '')));
  v('sans horodatage, la carte tient quand même', /ana-carte-t/.test(_anaCarte('Analyse', 0, '<p>x</p>')) && !/<span>/.test(_anaCarte('Analyse', 0, '<p>x</p>')));
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

console.log('\n── 2. Le panneau ouvre sur la synthèse, le détail derrière ──');
const pan = (/if \(tab === 'analysis'\) \{[\s\S]*?\n    \}/.exec(APP) || [''])[0];
v('le panneau Analyse est repérable', pan.length > 200);
/* ⚠️ LA CARTE PORTE LA SYNTHÈSE, PAS L'ACCROCHE — et ce banc l'a exigé à l'envers dans son premier
   jet. L'accroche (`d.lead`) est le texte du tag INFO depuis le 31/08, à la demande de
   l'utilisateur, et desk-verif l'éprouve dans un vrai navigateur : la reprendre ici remettait le
   même paragraphe sur deux boutons. Deux textes distincts, un par surface. */
v('la carte est alimentée par la synthèse du desk', /_anaProse\(item\._evaSynth \? \[item\._evaSynth\] : \[\]\)/.test(pan), pan.slice(0, 300));
v('… et JAMAIS par l\'accroche, qui appartient à Info', !/_anaProse\(d\.lead\)/.test(pan));
/* ⚠️ CE CONTRÔLE LISAIT LE TEXTE DU FICHIER, et il était VIDE : pris à la mutation, remplacer
   `= carte` par `= !carte` — qui inverse l'ordre rendu — le laissait vert, puisque la sous-chaîne
   « carte + (dossier.length » survit dans « !carte + (dossier.length ». On ÉVALUE donc désormais
   la vraie expression de composition, et on regarde ce qui sort. */
const mComp = /expandEl\.innerHTML = carte[\s\S]*?;\n/.exec(pan);
v('l\'expression de composition est extractible', !!mComp);
if (mComp) {
  const rendu = new Function('carte', 'dossier', '_anaTs', '_puces', '_nrxQuand', '_renderInfoBullets',
    'const expandEl = {};' + mComp[0] + 'return expandEl.innerHTML;'
  )('[[CARTE]]', ['x'], 1, [], () => '[[QUAND]]', () => '[[PUCES]]');
  v('la carte est rendue', rendu.indexOf('[[CARTE]]') >= 0, rendu);
  v('le dossier suit la carte, pas l\'inverse',
    rendu.indexOf('[[CARTE]]') >= 0 && rendu.indexOf('ana-detail') > rendu.indexOf('[[CARTE]]'), rendu);
  /* ET SANS DOSSIER, la carte reste seule — pas d'intitulé « Le détail » suspendu dans le vide. */
  const seule = new Function('carte', 'dossier', '_anaTs', '_puces', '_nrxQuand', '_renderInfoBullets',
    'const expandEl = {};' + mComp[0] + 'return expandEl.innerHTML;'
  )('[[CARTE]]', [], 1, [], () => '[[QUAND]]', () => '[[PUCES]]');
  v('sans dossier, la carte reste seule', seule.indexOf('[[CARTE]]') >= 0 && seule.indexOf('ana-detail') < 0, seule);
}
v('… sous son propre intitulé', /ana-detail-t">Le détail</.test(pan));
/* LE REPLI : une analyse sans accroche garde le comportement d'avant, dossier compris. */
v('sans accroche, le dossier reprend sa place', /: _nrxQuand\('Analyse', _anaTs\) \+ _renderInfoBullets\(dossier\.length \? dossier : _puces\)/.test(pan), pan.slice(-400));
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

console.log('\n── 4. L\'habillage est celui de DTP ──');
v('la carte a sa règle', /\.ana-carte \{/.test(CSS));
v('… une bordure fine et des coins doux', /\.ana-carte \{[^}]*border: 1px solid[^}]*border-radius: var\(--radius/.test(CSS));
/* ⚠️ LA PASTILLE DE LA RÉFÉRENCE EST BLEUE. On reprend la FORME, jamais la couleur : l'identité
   visuelle du projet est l'or, et aucune teinte étrangère n'entre par une capture d'écran. */
v('la pastille est OR, pas bleue', /\.ana-carte-t \{[^}]*color: var\(--orange, #e3b23a\)/.test(CSS));
v('… et ronde', /\.ana-carte-t i \{[^}]*border-radius: 50%/.test(CSS));
v('… elle prend la couleur de l\'en-tête', /\.ana-carte-t i \{[^}]*background: currentColor/.test(CSS));
v('aucun bleu n\'est introduit par la carte', !/\.ana-carte[^{]*\{[^}]*#[0-9a-f]*(?:[0-9a-f]{2})(?:cc|dd|ee|ff)\b/i.test(CSS) && !/\.ana-carte[^{]*\{[^}]*(?:blue|#3b82f6|#2563eb|#60a5fa)/i.test(CSS));
v('l\'heure est repoussée à droite', /\.ana-carte-t span \{[^}]*margin-left: auto/.test(CSS));
v('le thème clair est traité', /html\[data-theme="light"\] \.ana-carte \{/.test(CSS));
v('… y compris la pastille', /html\[data-theme="light"\] \.ana-carte-t \{/.test(CSS));

console.log(`\n${ko === 0 ? '✓ TOUT PASSE' : '✗ ' + ko + ' ÉCHEC(S)'} — ${ok} contrôle(s) OK, ${ko} KO\n`);
process.exit(ko ? 1 : 0);

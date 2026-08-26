#!/usr/bin/env node
/**
 * source-verif.js — UN RAPPORT D'INSTITUTION NE RAMÈNE PAS À SA SOURCE.
 * ------------------------------------------------------------------------------------------------
 * 28/08, capture à l'appui : « enlève les sources des rapports institutions faut que personne
 * n'arrivent à les trouver typiquement ici tu vois fais un check de tous les rapports du mois et
 * enlève toutes traces et vérifie pour les futurs qui arriveront ». Au milieu du corps d'un rapport :
 * « Please click here to read the PDF version », le « here » en lien vers le PDF de la banque.
 *
 * `_stripSource` traitait les FORMULES connues, une par une. Utile, et ça reste — mais une liste de
 * formules ne couvre jamais la banque suivante, ni la prochaine refonte d'une page déjà listée, et
 * la demande porte justement sur les FUTURS. D'où une règle qui n'est pas une formule mais une
 * propriété : dans le corps d'un rapport d'institution, il ne reste AUCUNE adresse.
 *
 * On éprouve donc le vrai code — les deux fonctions sont extraites de server.js, jamais recopiées.
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');

let ok = 0, ko = 0;
const v = (titre, cond, detail) => {
  if (cond) { ok++; console.log('  ✓ ' + titre); }
  else { ko++; console.log('  ✗ ' + titre + (detail ? '\n      → ' + detail : '')); }
};

/* EXTRACTION DU VRAI CODE. Recopier les expressions rationnelles dans le test reviendrait à tester
   la copie : elle resterait verte le jour où celle de server.js changerait. On découpe donc le
   fichier aux frontières des fonctions et on les évalue telles quelles. */
const bloc = (debut, fin) => {
  const d = SRV.indexOf(debut);
  if (d < 0) throw new Error('introuvable dans server.js : ' + debut);
  const f = SRV.indexOf(fin, d);
  if (f < 0) throw new Error('fin introuvable pour : ' + debut);
  return SRV.slice(d, f + fin.length);
};
const src = [
  bloc('function _stripXmlNoise(h) {', "\n}"),
  bloc('const _ADRESSE_NUE =', "\n}"),
  bloc('function _stripSource(html) {', "\n}"),
].join('\n');
let _stripLiens, _stripSource;
try {
  const f = new Function(src + '\nreturn { _stripLiens, _stripSource };');
  ({ _stripLiens, _stripSource } = f());
} catch (e) {
  console.log('  ✗ extraction impossible : ' + e.message + '\n');
  process.exit(1);
}
const propre = h => _stripSource(_stripLiens(h));

console.log('\n── 1. Le cas de la capture ──');
const KBC = '<p>The KBC Economics team expects growth to slow.</p>'
  + '<p>Please click <a href="https://www.kbc.be/content/dam/kbccom/doc/economics/publications/PDF/ERA_2026_08.pdf">here</a> to read the PDF version.</p>';
const kbc = propre(KBC);
v('le rappel « click here to read the PDF version » disparaît', !/click|pdf version/i.test(kbc), kbc);
v('l\'adresse du PDF de la banque aussi', !/kbc\.be|\.pdf/i.test(kbc), kbc);
v('le rapport, lui, est intact', /The KBC Economics team expects growth to slow\./.test(kbc), kbc);
v('et il ne reste pas de paragraphe vide', !/<p>\s*<\/p>/.test(kbc), kbc);

console.log('\n── 2. La règle de fond : plus aucune adresse ──');
/* C'est ELLE qui couvre les futurs. Une formule inconnue peut passer ; une adresse, non — quelle
   que soit la banque, quelle que soit la refonte de sa page. */
v('un lien devient son texte, la phrase reste lisible',
  propre('<p>See the <a href="https://bank.com/x">December statement</a> for detail.</p>') === '<p>See the December statement for detail.</p>',
  propre('<p>See the <a href="https://bank.com/x">December statement</a> for detail.</p>'));
v('un lien dont le texte EST l\'adresse s\'efface entièrement',
  !/bank\.com/.test(propre('<p>Full note: <a href="https://bank.com/note">https://bank.com/note</a></p>')),
  propre('<p>Full note: <a href="https://bank.com/note">https://bank.com/note</a></p>'));
v('un nom de domaine en guise de libellé aussi',
  !/research\.natixis\.com/.test(propre('<p><a href="https://research.natixis.com">research.natixis.com</a></p>')),
  propre('<p><a href="https://research.natixis.com">research.natixis.com</a></p>'));
v('une adresse écrite en clair part', !/https?:/.test(propre('<p>Source: https://www.mufgresearch.com/fx/note</p>')),
  propre('<p>Source: https://www.mufgresearch.com/fx/note</p>'));
v('… « www. » sans protocole aussi', !/www\./.test(propre('<p>Voir www.socgen.com/research pour la suite.</p>')),
  propre('<p>Voir www.socgen.com/research pour la suite.</p>'));
v('un lien interne au document n\'est pas une porte de sortie',
  propre('<p>Voir <a href="#section-2">la section 2</a>.</p>') === '<p>Voir la section 2.</p>',
  propre('<p>Voir <a href="#section-2">la section 2</a>.</p>'));
/* ⚠️ CE QU'IL NE FAUT PAS CASSER. Le corps d'un rapport parle de sociétés, de devises et de prix :
   un point suivi de deux lettres n'est pas un domaine. */
v('« U.S. » survit', /U\.S\. GDP rose 2\.3%/.test(propre('<p>U.S. GDP rose 2.3% in Q2.</p>')), propre('<p>U.S. GDP rose 2.3% in Q2.</p>'));
v('une adresse e-mail n\'entraîne pas la phrase',
  /Contact/.test(propre('<p>Contact research at economics.desk@bank.com for detail.</p>')),
  propre('<p>Contact research at economics.desk@bank.com for detail.</p>'));
v('un tableau de chiffres est intact',
  propre('<table><tr><td>CPI</td><td>2.4%</td></tr></table>') === '<table><tr><td>CPI</td><td>2.4%</td></tr></table>');

console.log('\n── 3. Les formules connues restent traitées ──');
[['<p>This article was written by John Doe at investinglive.com</p>', /investinglive/i, 'l\'attribution InvestingLive'],
 ['<p>For other currencies, please download the PDF version attached at the top of this page.</p>', /download the pdf/i, 'le renvoi au PDF MUFG'],
 ['<p>The post Weekly Outlook appeared first on ActionForex.</p>', /appeared first on/i, 'le pied de page WordPress'],
 ['<p>Source: Bloomberg, KBC Economics</p>', /^.*Source:/i, 'la ligne « Source : »'],
].forEach(([entree, motif, quoi]) => v(quoi + ' est retiré', !motif.test(propre(entree)), propre(entree)));

console.log('\n── 4. Le câblage — une sortie oubliée annule tout le reste ──');
/* La route a NEUF sorties `res.json`, et DEUX ne passaient pas par `_stripSource` : le texte des
   PDF natifs et le repli sur la description RSS. C'est exactement le genre d'oubli qu'on ne voit
   jamais — d'où l'enveloppe de la sortie commune, qui vaut aussi pour les sorties à venir. */
v('le nettoyage est garanti sur la sortie commune',
  /if \(o && typeof o\.html === 'string' && o\.html\) o\.html = _stripSource\(_stripLiens\(o\.html\)\);/.test(SRV));
const iRoute = SRV.indexOf("app.get('/api/bank-research-content'");
v('… posée dès l\'entrée de la route', iRoute > 0 && SRV.indexOf('_stripSource(_stripLiens(', iRoute) - iRoute < 1200,
  'écart : ' + (SRV.indexOf('_stripSource(_stripLiens(', iRoute) - iRoute));
const route = SRV.slice(iRoute, iRoute + 30000);
v('… et la route a bien plusieurs sorties à couvrir', (route.match(/res\.json\(\{/g) || []).length >= 5,
  String((route.match(/res\.json\(\{/g) || []).length) + ' sortie(s)');
/* ⚠️ LES RÉCAPS INVESTINGLIVE GARDENT LEURS LIENS. Le lecteur en tire la liste des sources d'un
   rapport, qui est une fonction du produit ; la demande nomme « les rapports institutions », on
   n'élargit pas au-delà. */
const iWrap = SRV.indexOf("app.get('/api/wrap-content'");
v('les récaps InvestingLive ne sont PAS touchés',
  iWrap < 0 || !/_stripLiens/.test(SRV.slice(iWrap, iWrap + 6000)), 'un _stripLiens s\'est glissé dans la route des wraps');
const APP = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
v('… et le lecteur y collecte toujours ses sources', /sources\.push\(\{ href, text \}\)/.test(APP));

/* ══ 5. LE RAPPORT *RENDU EN PDF* — LA MOITIE DU PRODUIT QUE LE NETTOYAGE NE COUVRAIT PAS ═════════
   30/08, nouvelle capture : « Please click here to read the PDF version », le « here » en bleu
   souligne, en tete d'un KBC Sunrise. La phase 1 ci-dessus etait pourtant verte depuis le 28/08 —
   et elle avait raison : `_stripLiens` nettoie bien le champ `html`. Seulement le lecteur
   N'AFFICHE PAS ce champ des qu'un `pdfUrl`/`renderUrl` existe ; il embarque le PDF. Le controle
   mesurait la bonne fonction sur la mauvaise moitie du produit.
   On ouvre donc une page dans un VRAI Chromium, on y execute le VRAI bloc de nettoyage extrait de
   `_renderPdfInner`, et on relit le PDF PRODUIT. */
async function phaseRendu() {
  console.log('\n── 5. Le rapport rendu en PDF ne ramène pas non plus à sa source ──');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { console.log('  · puppeteer-core absent → phase abstenue.'); return; }
  const bases = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  const cand = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const b of bases) { try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) cand.push(path.join(b, d, r)); } catch {} }
  const exe = cand.find(x => x && fs.existsSync(x));
  if (!exe) { console.log('  · aucun Chromium → phase abstenue.'); return; }

  /* Le VRAI bloc, decoupe dans server.js. Le recopier ici reviendrait a eprouver la copie : elle
     resterait verte le jour ou celui de server.js changerait. */
  const dSc = SRV.indexOf('    await page.evaluate(() => { try {\n      const RENVOI =');
  if (dSc < 0) { v('le nettoyage du rendu est extractible de _renderPdfInner', false, 'bloc introuvable dans server.js'); return; }
  const fSc = SRV.indexOf('\n    } catch (e) {} }).catch(() => {});', dSc);
  v('le nettoyage du rendu est extractible de _renderPdfInner', fSc > dSc);
  if (fSc < 0) return;
  const CORPS = SRV.slice(SRV.indexOf('{ try {', dSc) + 7, fSc);   // l'interieur de la fonction passee a page.evaluate

  /* La maquette reprend la forme de la capture ET les pieges voisins : une adresse ecrite en clair
     en pied de page, un lien de navigation du site, un lien AU MILIEU d'une vraie phrase du rapport
     (qui doit garder sa phrase), et un paragraphe de corps qui contient le mot « download » sans
     rien avoir a se reprocher. */
  const MAQUETTE = '<html><head><style>a{color:#2b7bd4;text-decoration:underline}</style>'
    + '<style media="print">a[href]::after{content:" (" attr(href) ")"}</style></head><body>'
    + '<nav><a href="https://www.kbc.com/en/economics">Economics</a> <a href="https://www.kbc.com/login">Log on</a></nav>'
    + '<h1>KBC Sunrise</h1><p class="date">August 26, 2026</p>'
    + '<p id="renvoi">Please click <a href="https://www.kbc.be/content/dam/kbccom/doc/economics/ERA_2026_08.pdf">here</a> to read the PDF version</p>'
    + '<p id="corps">The KBC Economics team expects euro area growth to slow to 0.9% in 2027, with the ECB on hold until the summer.</p>'
    + '<p id="corps2">Bond issuance was heavy: the Treasury saw record download volumes for its prospectus, a sign of demand.</p>'
    + '<p id="phrase">As we argued in <a href="https://www.kbc.be/economics/note-42">our July note</a>, the labour market is the swing factor.</p>'
    + '<p id="pied">KBC Group NV · www.kbc.com · Havenlaan 2, 1080 Brussels</p>'
    + '<p id="desabo">To unsubscribe from KBC Sunrise, visit https://newsletter.kbc.be/unsubscribe</p>'
    + '</body></html>';

  let nav = null;
  try {
    nav = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    await page.setContent(MAQUETTE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(new Function(CORPS));                                        // ← le vrai nettoyage
    await page.addStyleTag({ content: 'a::after,a::before{content:""!important}' }); // ← et sa feuille jointe

    const apres = await page.evaluate(() => ({
      liens: document.querySelectorAll('a[href]').length,
      renvoi: !!document.getElementById('renvoi'),
      desabo: !!document.getElementById('desabo'),
      corps: (document.getElementById('corps') || {}).textContent || '',
      corps2: (document.getElementById('corps2') || {}).textContent || '',
      phrase: (document.getElementById('phrase') || {}).textContent || '',
      pied: (document.getElementById('pied') || {}).textContent || '',
      texte: (document.body.innerText || '').replace(/\s+/g, ' '),
    }));

    v('la phrase « click here to read the PDF version » a disparu', !apres.renvoi, apres.texte.slice(0, 160));
    v('… et la ligne de désabonnement avec son adresse aussi', !apres.desabo);
    v('plus un seul lien ne porte d\'adresse', apres.liens === 0, apres.liens + ' lien(s) restant(s)');
    v('l\'adresse écrite en clair du pied de page est retirée', !/kbc\.com/i.test(apres.pied), apres.pied);
    v('… et le reste du pied de page survit', /KBC Group NV/.test(apres.pied) && /Brussels/.test(apres.pied), apres.pied);
    v('le corps du rapport est intact', /growth to slow to 0\.9%/.test(apres.corps), apres.corps);
    v('… y compris un paragraphe qui dit « download » sans être un renvoi', /record download volumes/.test(apres.corps2), apres.corps2);
    v('une phrase du rapport qui portait un lien garde sa phrase', /as we argued in our July note/i.test(apres.phrase.replace(/\s+/g, ' ')), apres.phrase);
    v('aucune adresse ne subsiste dans tout le texte rendu', !/https?:\/\/|www\./i.test(apres.texte), apres.texte.slice(0, 200));

    /* LE FICHIER PRODUIT, PAS SEULEMENT LE DOM. C'est ce que le client reçoit.
       ⚠️ Mesuré : ce Chromium n'émet AUCUNE annotation de lien (`/URI`, `/Annots`) — même en
       `tagged`. La fuite était donc VISUELLE. On éprouve les deux : le fichier ne doit porter ni
       annotation, ni adresse en clair. */
    const buf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
    const bin = buf.toString('latin1');
    /* ⚠️ CES DEUX-LA SONT UNE VEILLE, PAS UNE PREUVE — et il faut le dire, sinon on croira demain
       qu'ils demontraient quelque chose : mesure a la mutation (nettoyage neutralise), ils restent
       VERTS. Ce Chromium n'ecrit ni annotation ni adresse dans le fichier, avec ou sans liens dans
       la page. Ils veillent sur le jour ou Chrome changerait d'avis. */
    v('[veille] le PDF produit ne porte aucune annotation de lien', !/\/URI|\/Annots/.test(bin));
    v('[veille] … ni aucune adresse en clair dans le fichier', !/kbc\.(?:be|com)/i.test(bin));
    await page.close();
  } catch (e) {
    v('la phase navigateur s\'exécute', false, e.message);
  } finally { if (nav) try { await nav.close(); } catch {} }

  /* Le rendu est mis en cache 30 JOURS sur disque. Sans changer la version, tout rapport deja
     ouvert garderait son lien : le correctif serait invisible la ou il est le plus attendu. */
  const mVer = SRV.match(/const _RENDER_VER = '(\w+)'/);
  v('la version du cache de rendu a été relevée', !!mVer && mVer[1] !== 'r8',
    'sans bump, les rapports déjà rendus gardent leurs liens 30 jours · version : ' + (mVer && mVer[1]));
}

/* ══ 6. LE DESK LUI-MEME NE PROPOSE PLUS DE SORTIE VERS LA SOURCE ════════════════════════════════
   Le plus direct des chemins n'etait pas une trace oubliee dans un rapport : c'etaient NOS boutons.
   « Lire l'original → » en pied de rapport, « Ouvrir le rapport original ↗ » en or plein sur les
   cartes de repli, et « Source : <domaine> » imprime en pied de CHAQUE page du PDF que nous
   fabriquons — celui-la survivait meme au desk, dans un fichier telecharge. */
function phaseLecteur() {
  console.log('\n── 6. Le lecteur Institution ne propose plus de sortie vers la source ──');
  const APPJS = fs.readFileSync(path.join(RACINE, 'public/js/app.js'), 'utf8');
  const d = APPJS.indexOf('async function _brEmbedPdf(item, endpointUrl) {');
  const f = APPJS.indexOf('\n// ═══', d);
  const LECTEUR = d < 0 ? '' : APPJS.slice(d, f > d ? f : d + 30000);
  v('le lecteur Institution est extractible d\'app.js', !!LECTEUR);
  v('plus aucun lien sortant dans le lecteur', !/target="_blank"/.test(LECTEUR),
    'un `target="_blank"` subsiste dans le lecteur de rapports');
  /* On juge le MARKUP, pas le vocabulaire : un commentaire qui raconte l'ancien bouton n'est pas
     un bouton. C'est la difference entre « le mot n'apparait plus » et « la sortie n'existe plus ». */
  v('plus aucun bouton de sortie sur les cartes de repli', !/br-ext-card-btn"\s+href=/.test(APPJS));
  v('plus aucun pied de page « Lire l\'original »', !/br-ext-link"/.test(APPJS) && !/br-doc-footer/.test(APPJS));
  v('le PDF fabriqué par le desk n\'imprime plus le domaine de la source',
    !/Source : ' \+ _brShortUrl/.test(APPJS) && !/_brShortUrl/.test(APPJS));
  /* ⚠️ Ces boutons SERVAIENT : c'etait la seule reprise quand la chaine d'affichage echoue. Les
     retirer sans rien mettre a la place laisserait un cul-de-sac. */
  v('… mais la carte de repli propose de réessayer l\'affichage', /br-ext-retry/.test(APPJS) && /reessayer/.test(APPJS),
    'sans reprise, un échec d\'affichage devient un cul-de-sac');
  v('… et les deux replis passent bien leur reprise', (APPJS.match(/_brShowExternalCard\(item, \(\) =>/g) || []).length === 2);
}

function fin() {
  console.log('');
  if (ko) { console.log(`✗ ${ko} ÉCHEC(S) — ${ok} contrôle(s) OK, ${ko} KO\n`); process.exit(1); }
  console.log(`✓ TOUT PASSE — ${ok} contrôle(s) OK\n`);
  process.exit(0);
}
phaseLecteur();
phaseRendu().then(fin, e => { v('la phase du rendu se termine', false, e.message); fin(); });

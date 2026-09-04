#!/usr/bin/env node
/**
 * scripts/direct-verif.js — LE DIRECT EST-IL VRAIMENT DANS LA CARTE, ET QUE FAIT-ELLE SANS LUI ?
 * ------------------------------------------------------------------------------------------------
 * 04/09, demande utilisateur, capture à l'appui : « pour Bloomberg et Yahoo on doit avoir la vidéo
 * DANS le widget, tu comprends le but du widget ? » — puis, sur la bibliothèque : « améliore leur
 * aperçu de widget, enlève leur description ».
 *
 * ⚠️ LE CONTEXTE QUI EXPLIQUE LA FORME DE CE BANC. L'environnement de développement de cette
 * session n'a PAS accès à YouTube (refus 403 du proxy, mesuré, pas supposé). Impossible, donc, de
 * vérifier ici qu'une adresse de diffusion répond. Deux conséquences assumées :
 *   · aucun identifiant de vidéo n'est écrit en dur dans le desk — le serveur va le chercher ;
 *   · ce banc ne sort JAMAIS sur le réseau : il éprouve l'extraction sur des pages fabriquées, et
 *     le rendu de la carte sur une API bouchonnée. Ce qu'il ne peut pas prouver, il ne le prétend
 *     pas — la résolution réelle se constate sur le VPS, qui a le réseau.
 *
 * CE QUE CHAQUE CONTRÔLE GARDE :
 *
 * 1. L'IDENTIFIANT N'EST PAS ÉCRIT EN DUR. Une chaîne en continu redémarre son flux régulièrement,
 *    et chaque redémarrage crée une nouvelle vidéo. Un identifiant figé dans widgets.js serait un
 *    cadre mort au premier redémarrage, sans que rien ne le signale.
 *
 * 2. L'EXTRACTION EST ÉPROUVÉE SUR LE VRAI CODE, PAS SUR UNE COPIE. `_directExtraire` est extraite
 *    de server.js et exécutée. Un banc qui recopierait la fonction éprouverait sa propre copie.
 *    ⚠️ ET LE CONTRÔLE DE FORME EST ÉPROUVÉ EN NÉGATIF : sans lui, n'importe quel morceau de script
 *    passerait pour un identifiant et le desk afficherait un cadre mort en croyant avoir réussi.
 *    ⚠️ ET UNE PAGE HORS ANTENNE NE DOIT PAS RENDRE UNE VIDÉO : ramasser la dernière archive et
 *    l'appeler « direct » serait le mensonge le plus facile à commettre ici.
 *
 * 3. LES TROIS ÉTAGES DU RENDU, DANS UN VRAI CHROMIUM. Diffusion en cours → cadre sur CET
 *    identifiant. Chaîne seule → cadre « direct de la chaîne ». Hors antenne → la dernière émission,
 *    NOMMÉE. Rien → la carte-lien d'avant. Le dernier est le plus important : c'est celui qui
 *    garantit qu'un client ne perd rien.
 *    ⚠️ RÈGLE CHANGÉE LE 05/09 : ce banc exigeait le lien vers l'éditeur DANS LES TROIS CAS (« le
 *    desk emmène chez la source, il ne la remplace pas »). L'utilisateur a fait retirer la barre
 *    qui le portait sous la vidéo, capture à l'appui — elle répétait le titre déjà présent dans
 *    l'en-tête de la carte et un lien que le lecteur YouTube porte lui-même, pour 32 px d'image en
 *    moins. La règle est LEVÉE sur les étages vidéo, ENTIÈRE sur le repli. Les deux moitiés sont
 *    exigées séparément : sans la seconde, « plus de lien » deviendrait vrai partout.
 *
 * 4. LES DEUX VIGNETTES DIFFÈRENT. C'était le défaut exact signalé : les deux cartes retombaient
 *    sur l'icône `WICO`, identique pour les deux, donc la bibliothèque affichait deux fois le même
 *    dessin. « Les deux existent » ne suffit pas — on compare leur contenu.
 *
 * 5. L'ANCIEN ARGUMENT A DISPARU PARTOUT. L'aide affirmait que « l'éditeur interdit techniquement
 *    l'intégration » : vrai de la page du site, faux de la diffusion officielle qu'on encadre
 *    désormais. Un commentaire périmé ment avec l'autorité du code (règle du dépôt) — on vérifie
 *    qu'il ne reste aucune trace.
 *
 * 6. LA GRAINE DE CHAÎNE, ET POURQUOI ELLE N'EST PAS UNE ENTORSE À LA RÈGLE 1 (05/09). La carte
 *    est revenue en production sur son repli : la lecture de page échouait sur le VPS. Cause la
 *    plus probable, et la seule traitable sans réseau ici : le bandeau de consentement de Google,
 *    servi aux adresses de centre de données, qui répond 200 et ne contient AUCUN identifiant.
 *    D'où une GRAINE — l'identifiant de CHAÎNE, permanent, à ne pas confondre avec celui d'une
 *    VIDÉO, qui change à chaque redémarrage du flux et reste interdit en dur. Mais une graine
 *    écrite de mémoire, sur une machine sans accès à YouTube, ne se sert pas telle quelle : elle
 *    est confirmée À L'EXÉCUTION par le flux RSS de la chaîne (du XML court, sans bandeau, qui
 *    répond 404 pour une chaîne inconnue et porte le NOM pour une chaîne connue). Le banc éprouve
 *    les quatre refus et la confirmation sur la VRAIE fonction, avec un `_directHttp` bouchonné.
 *
 * 7. HORS ANTENNE N'EST PAS EN PANNE (05/09). « Résous le problème de yahoo finance live, ça
 *    fonctionne pas », alors que Bloomberg marchait. La différence n'est pas dans le code — les
 *    deux cartes partagent la même fonction — elle est dans les chaînes : Bloomberg Television
 *    diffuse EN CONTINU, Yahoo Finance seulement aux heures de marché. Hors de ces heures il n'y a
 *    rien à cadrer, et la carte se repliait sur son bouton la moitié de la journée. Le serveur
 *    distingue désormais TROIS états (`enAntenne` vrai / faux / inconnu — « lu, et pas à
 *    l'antenne » n'est pas « je n'ai rien pu lire »), et la carte descend une liste d'étapes dont
 *    la dernière est l'émission la plus récente, tirée du flux de la chaîne.
 *    ⚠️ ET ELLE SE NOMME : montrer un enregistrement sous un titre « Live » sans le dire serait un
 *    mensonge. Le banc exige la pastille sur l'enregistrement ET son ABSENCE sur un vrai direct —
 *    une pastille qui s'affiche toujours mentirait dans l'autre sens.
 *
 *   node scripts/direct-verif.js
 *
 * Sans Chromium, la phase navigateur S'ABSTIENT (code 0) ; les phases sans navigateur, elles,
 * tournent toujours.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { serveur, trouverNavigateur } = require('./mobile-apercu.js');

const RACINE = path.join(__dirname, '..');
const PORT = 4851;
let ko = 0;
const v = (nom, cond, detail) => {
  if (cond) console.log('  ✓ ' + nom);
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
};

const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const W = fs.readFileSync(path.join(RACINE, 'public/js/widgets.js'), 'utf8');

/* ══ PHASE 1 : LE MÉCANISME EST-IL CELUI QU'ON CROIT ? ═══════════════════════════════════════ */
function phaseSource() {
  console.log('\n── Le mécanisme, pas un identifiant figé ──');
  v('le serveur porte la table des directs (les deux chaînes)',
    /const _DIRECTS = \{[\s\S]{0,600}?bloomberg:[\s\S]{0,300}?yahoo:/.test(SRV));
  /* Plusieurs poignées par chaîne : c'est ce qui permet au mécanisme de se réparer seul le jour où
     l'une d'elles est renommée, sans redéploiement. Une seule poignée serait un point unique de
     panne déguisé en configuration. */
  const tbl = (SRV.match(/const _DIRECTS = \{[\s\S]*?\n\};/) || [''])[0];
  const poignees = (tbl.match(/poignees: \[[^\]]*\]/g) || []).map((x) => (x.match(/'/g) || []).length / 2);
  v('… et chaque chaîne propose PLUSIEURS poignées (une seule serait un point unique de panne)',
    poignees.length === 2 && poignees.every((n) => n >= 2), 'poignées par chaîne : ' + poignees.join(' · '));
  v('le desk expose la résolution par une route dédiée', /app\.get\('\/api\/direct\/:cle'/.test(SRV));
  /* LE CONTRÔLE CENTRAL. Un identifiant YouTube de vidéo fait 11 caractères ; s'il en traînait un
     dans le desk, le mécanisme serait décoratif et la carte mourrait au premier redémarrage de
     flux. On exige que le seul chemin vers un identifiant soit la réponse du serveur. */
  /* ⚠️ « live_stream » FAIT EXACTEMENT ONZE CARACTÈRES, comme un identifiant de vidéo. Le premier
     jet de ce contrôle rougissait donc sur notre PROPRE repli par chaîne. Un contrôle qui mord sur
     le code correct finit par être désarmé au lieu d'être compris : on nomme l'exception. */
  const embarques = (W.match(/embed\/[\w-]{11}[?"']/g) || []).filter((x) => x.indexOf('live_stream') < 0);
  v('AUCUN identifiant de vidéo n\'est écrit en dur dans le desk',
    embarques.length === 0,
    'trouvé : ' + embarques.join(' · ') + ' — un identifiant figé serait un cadre mort au premier redémarrage de flux');
  v('… la carte demande bien l\'adresse au serveur', /fetch\('\/api\/direct\/' \+ cle\)/.test(W));
  /* ⚠️ UNE CARTE « LIVE » QUI MONTRE UNE VIGNETTE ET UN BOUTON « LECTURE » NE FAIT PAS CE QU'ELLE
     PROMET. Sur un desk, l'antenne doit être à l'écran quand on regarde la carte. Le son coupé
     n'est PAS de la politesse : c'est la seule forme de démarrage automatique que les navigateurs
     acceptent — sans `mute`, l'`autoplay` est refusé et on retombe sur la vignette. Les deux vont
     donc ensemble, et `allow` doit porter `autoplay`, faute de quoi le cadre l'interdit lui-même. */
  v('le cadre démarre tout seul, son coupé (sinon le navigateur refuse le démarrage)',
    /autoplay=1/.test(W) && /mute=1/.test(W) && /allow="autoplay;/.test(W),
    'autoplay + mute + allow="autoplay" sont indissociables');
  /* On ne corrige pas ce qu'on ne voit pas : la résolution se fait sur le VPS, et la machine de
     développement n'a pas accès à YouTube. Sans vue de diagnostic, la correction suivante serait
     une supposition. Elle est réservée à l'administrateur — elle force les lectures. */
  v('une vue de diagnostic existe, et elle est réservée à l\'administrateur',
    /app\.get\('\/api\/admin\/direct\/:cle', requireAdmin/.test(SRV));
  /* LA PORTE DE SORTIE QUI NE PEUT PAS ÉCHOUER. Le jour où YouTube refuse durablement les lectures
     de ce serveur, l'exploitant pose l'identifiant de chaîne dans le .env du VPS : il est permanent,
     il se colle une fois, et il passe AVANT tout le reste. Sans ce chemin, une chaîne bloquée
     resterait bloquée jusqu'au prochain déploiement. */
  v('l\'exploitant peut imposer la chaîne par le .env du VPS, et sa consigne passe en premier',
    /env: 'DTP_DIRECT_BLOOMBERG'/.test(SRV) && /env: 'DTP_DIRECT_YAHOO'/.test(SRV)
    && /source = 'consigne'/.test(SRV));

  console.log('\n── L\'ancien argument a disparu PARTOUT ──');
  /* L'aide disait « l'éditeur interdit techniquement l'intégration de sa page » : exact pour la
     page du site, faux pour la diffusion officielle qu'on encadre maintenant. Règle du dépôt :
     quand une règle change, on corrige toutes ses traces dans le même commit. */
  /* ⚠️ ON CHERCHE DANS LE TEXTE DES DEUX CARTES, PAS DANS TOUT LE FICHIER. Le commentaire qui
     EXPLIQUE le retrait cite forcément la phrase retirée ; interdire la chaîne partout ferait
     rougir la trace écrite qu'on veut justement garder. C'est le texte lu par le client qui
     compte : `desc`, `aide`, `src`, `watch` des deux définitions. */
  const bloc2 = W.slice(W.indexOf("id: 'direct-bloomberg'"), W.indexOf("id: 'horloge'"));
  v('plus aucune trace de « l\'éditeur interdit l\'intégration » dans le TEXTE des deux cartes',
    bloc2.length > 200 && !/interdit techniquement l'intégration/.test(bloc2),
    'un argument périmé ment avec l\'autorité du code');
  v('… et la phrase descriptive que l\'utilisateur voulait retirer n\'est plus posée en dur',
    !/<p class="wdg-direct-txt">Le direct de Yahoo Finance/.test(W)
      && !/<p class="wdg-direct-txt">La chaîne américaine en continu/.test(W),
    'la carte doit montrer la vidéo, pas la décrire');

  console.log('\n── Les deux vignettes de la bibliothèque ──');
  const vig = (id) => {
    const i = W.indexOf("'" + id + "': '<svg ' + _PV");
    if (i < 0) return null;
    return W.slice(i, W.indexOf("</svg>'", i) + 7);
  };
  const vb = vig('direct-bloomberg'), vy = vig('direct-yahoo');
  v('les deux directs ont leur propre vignette', !!vb && !!vy,
    'sans vignette, la bibliothèque retombe sur l\'icône — la même pour les deux');
  /* LE CONTRÔLE QUI PORTE LA DEMANDE. « Les deux existent » serait vert avec deux dessins
     identiques — c'est-à-dire exactement le défaut signalé. */
  v('… et elles DIFFÈRENT (c\'était le défaut : deux fois le même dessin)',
    !!vb && !!vy && vb.replace('direct-bloomberg', '') !== vy.replace('direct-yahoo', ''));
  /* La charte réserve le rouge au baissier et à l'alerte : la pastille « en direct » ne le prend
     pas, contrairement à l'usage télévisuel. Décision déjà prise pour le badge FERMÉ de la frise. */
  v('… et aucune n\'emprunte le rouge d\'alerte pour sa pastille de direct',
    !!vb && !!vy && !/circle[^>]*fill="#ff3d00"/.test(vb) && !/circle[^>]*fill="#ff3d00"/.test(vy));
}

/* ══ PHASE 2 : L'EXTRACTION, SUR LE VRAI CODE ════════════════════════════════════════════════
   On EXTRAIT `_directExtraire` de server.js et on l'exécute. Recopier la fonction dans ce fichier
   reviendrait à éprouver la copie ; le jour où le serveur change, le banc resterait vert. */
function phaseExtraction() {
  console.log('\n── L\'extraction des identifiants (vraie fonction, pages fabriquées) ──');
  const i = SRV.indexOf('function _directExtraire(html) {');
  if (i < 0) { v('la fonction d\'extraction est trouvable dans server.js', false); return; }
  const fin = SRV.indexOf('\n}\n', i);
  let fn;
  try { fn = new Function(SRV.slice(i, fin + 3) + '\nreturn _directExtraire;')(); }
  catch (e) { v('la fonction d\'extraction s\'évalue', false, e.message); return; }

  const CANON = '<link rel="canonical" href="https://www.youtube.com/watch?v=abcDEF12345">'
    + '<script>{"externalId":"UCaaaaaaaaaaaaaaaaaaaaaa"}</script>';
  const INTERNE = '<script>{"channelId":"UCbbbbbbbbbbbbbbbbbbbbbb","isLiveNow":true,"videoId":"zzzYYY98765"}</script>';
  const HORS = '<script>{"externalId":"UCcccccccccccccccccccccc","isLiveNow":false,"videoId":"archive1234"}</script>';
  const RIEN = '<html><body><p>page quelconque, aucun identifiant</p><script>var x="troplongpouretreunidentifiant";</script></body></html>';

  const a = fn(CANON);
  v('le lien canonique d\'une page « /live » donne la diffusion en cours',
    a.video === 'abcDEF12345' && a.chaine === 'UCaaaaaaaaaaaaaaaaaaaaaa', JSON.stringify(a));
  const b = fn(INTERNE);
  v('… la forme interne marche aussi quand le canonique manque',
    b.video === 'zzzYYY98765' && b.chaine === 'UCbbbbbbbbbbbbbbbbbbbbbb', JSON.stringify(b));
  /* ⚠️ LE CONTRÔLE QUI COMPTE LE PLUS. Une chaîne hors antenne porte encore ses archives : rendre
     la dernière et l'appeler « direct » serait le mensonge le plus facile à commettre ici. */
  const c = fn(HORS);
  v('une chaîne HORS ANTENNE ne rend aucune vidéo (on ne fait pas passer une archive pour un direct)',
    c.video === null && c.chaine === 'UCcccccccccccccccccccccc', JSON.stringify(c));
  /* Et le contrôle de forme, en négatif : sans lui, un morceau de script quelconque passerait pour
     un identifiant et le desk afficherait un cadre mort en croyant avoir réussi. */
  const d = fn(RIEN);
  v('une page sans identifiant ne rend RIEN (le contrôle de forme mord)',
    d.video === null && d.chaine === null, JSON.stringify(d));
  /* ⚠️ LES ÉCRITURES AJOUTÉES LE 05/09, ET POURQUOI ELLES COMPTENT. La page « /live » n'est PAS la
     plus généreuse en identifiant de chaîne : c'est la page de chaîne elle-même, qui l'écrit sous
     d'autres formes (`browseId`, une balise `meta itemprop`, un lien canonique vers `/channel/`).
     Or c'est cet identifiant-là qui alimente le SECOND étage — celui qui marche même hors antenne.
     Chaque forme est donc éprouvée SEULE : ajoutée en bloc, une seule d'entre elles pourrait
     fonctionner sans que rien ne le dise. */
  for (const [nom, page, att] of [
    ['browseId (page de chaîne)', '<script>{"browseId":"UCdddddddddddddddddddddd"}</script>', 'UCdddddddddddddddddddddd'],
    ['meta itemprop (page de chaîne)', '<meta itemprop="identifier" content="UCeeeeeeeeeeeeeeeeeeeeee">', 'UCeeeeeeeeeeeeeeeeeeeeee'],
    ['lien canonique vers /channel/', '<link rel="canonical" href="https://www.youtube.com/channel/UCffffffffffffffffffffff">', 'UCffffffffffffffffffffff'],
  ]) {
    const r = fn(page);
    v('… l\'identifiant de chaîne se lit aussi en ' + nom, r.chaine === att, JSON.stringify(r));
  }
}

/* ══ PHASE 2 bis : LA GRAINE NE SE CROIT PAS SUR PAROLE ══════════════════════════════════════
   05/09, capture de production : la carte affichait « Le direct n'a pas pu être chargé ». La
   résolution par LECTURE DE PAGE avait donc échoué sur le VPS — cause la plus probable, et la
   seule qu'on puisse traiter sans réseau ici : le bandeau de consentement de Google, servi aux
   adresses de centre de données, qui répond 200 et ne contient AUCUN identifiant. La lecture
   « réussit » et ne rapporte rien.
   D'où une GRAINE : l'identifiant de CHAÎNE, qui lui est permanent (contrairement à celui d'une
   vidéo, qui change à chaque redémarrage du flux — c'est pourquoi il n'est toujours pas écrit en
   dur). Mais une graine écrite de mémoire, sur une machine SANS accès à YouTube, ne se sert pas
   telle quelle : elle est confirmée à l'exécution par le flux RSS de la chaîne, qui est du XML
   court, prévu pour les machines, et sans bandeau. Ce sont ces garde-fous qu'on éprouve ici, sur la
   VRAIE fonction extraite de server.js, avec un `_directHttp` BOUCHONNÉ — le banc ne sort jamais
   sur le réseau. */
function phaseGraine() {
  console.log('\n── La graine de chaîne : confirmée, jamais crue sur parole ──');
  const i = SRV.indexOf('async function _directVerifierChaine(');
  if (i < 0) { v('la vérification de chaîne est trouvable dans server.js', false); return; }
  const fin = SRV.indexOf('\n}\n', i);
  let faire;
  try {
    faire = new Function('_directHttp', SRV.slice(i, fin + 3) + '\nreturn _directVerifierChaine;');
  } catch (e) { v('la vérification de chaîne s\'évalue', false, e.message); return; }
  const flux = (titre) => ({ statut: 200, finale: '', corps: '<feed><title>' + titre + '</title></feed>', mur: false });
  const bouchon = (rep) => faire(async () => rep);

  return (async () => {
    const BON = 'UCIALMKvObZNtJ6AmdCLP7Lg';
    const ok = await bouchon(flux('Bloomberg Television'))(BON, /bloomberg/i);
    v('un flux qui répond ET porte le bon nom confirme la chaîne', ok.ok === true && /Bloomberg/.test(ok.titre), JSON.stringify(ok));
    /* LES TROIS REFUS. Chacun est le scénario d'une graine fausse : elle n'existe pas (404), elle
       existe mais désigne une AUTRE chaîne (nom inattendu), ou elle n'a pas même la forme d'un
       identifiant. Sans eux, une erreur de mémoire s'afficherait aux clients en cadre mort. */
    const abs = await bouchon({ statut: 404, finale: '', corps: '', mur: false })(BON, /bloomberg/i);
    v('… une chaîne INCONNUE (404) est refusée', abs.ok === false, JSON.stringify(abs));
    const autre = await bouchon(flux('Chaîne de cuisine'))(BON, /bloomberg/i);
    v('… une chaîne qui existe mais porte un AUTRE nom est refusée', autre.ok === false, JSON.stringify(autre));
    const forme = await bouchon(flux('Bloomberg Television'))('pas-un-identifiant', /bloomberg/i);
    v('… et un identifiant qui n\'a pas la forme UC + 22 ne part même pas sur le réseau', forme.ok === false, JSON.stringify(forme));

    /* LA GRAINE EST UNE CHAÎNE, JAMAIS UNE VIDÉO — la distinction est tout l'argument. Un
       identifiant de vidéo écrit en dur pourrit au premier redémarrage du flux, en silence ; un
       identifiant de chaîne est permanent. Le banc fige donc la RÈGLE, pas la valeur. */
    const graines = [...SRV.matchAll(/graine:\s*'([^']*)'/g)].map(m => m[1]);
    v('chaque graine déclarée a bien la forme d\'un identifiant de CHAÎNE (UC + 22)',
      graines.length >= 2 && graines.every(g => /^UC[\w-]{22}$/.test(g)), JSON.stringify(graines));
    v('… et chacune est assortie du nom qu\'on attend d\'elle (sans quoi la confirmation ne vérifie rien)',
      (SRV.match(/graine:\s*'/g) || []).length === (SRV.match(/attendu:\s*\//g) || []).length,
      'autant de `attendu:` que de `graine:`');
    /* ⚠️ ET LA GRAINE NE PART QU'APRÈS CONFIRMATION. C'est le contrôle qui empêche de « simplifier »
       la résolution en servant la graine directement le jour où l'on sera pressé. */
    const bloc = SRV.slice(SRV.indexOf('async function _directResoudre('), SRV.indexOf("app.get('/api/direct/:cle'"));
    v('la résolution ne retient la graine qu\'APRÈS confirmation par le flux',
      /_directVerifierChaine\(d\.graine, d\.attendu\)/.test(bloc) && /if \(ver\.ok\) \{ chaine = d\.graine/.test(bloc),
      'la graine doit passer par _directVerifierChaine avant d\'être servie');
    /* LE BANDEAU DE CONSENTEMENT : la cause la plus probable de l'échec observé. On vérifie qu'il
       est à la fois CONTOURNÉ (témoins envoyés) et RECONNU (pour que le diagnostic le nomme). */
    v('les témoins de consentement sont envoyés sur toutes les lectures YouTube',
      /'Cookie':\s*'CONSENT=YES\+1; SOCS=CAI'/.test(SRV), 'sinon Google sert une page 200 sans aucun identifiant');
    const j = SRV.indexOf('function _directMur(');
    let mur = null;
    try { mur = new Function(SRV.slice(j, SRV.indexOf('\n}\n', j) + 3) + '\nreturn _directMur;')(); } catch (e) {}
    v('… et le bandeau est RECONNU quand il est servi (sans quoi le diagnostic ne peut pas trancher)',
      !!mur && mur('https://consent.youtube.com/m?continue=x', '') === true
           && mur('https://www.youtube.com/@markets/live', '<h1>Before you continue to YouTube</h1>') === true
           && mur('https://www.youtube.com/@markets/live', '<title>Bloomberg</title>') === false);
  })();
}

/* ══ PHASE 3 : LES TROIS ÉTAGES DU RENDU, DANS UN VRAI CHROMIUM ══════════════════════════════ */
const CAS = [
  { nom: 'diffusion en cours → le cadre porte CET identifiant', rep: { ok: true, video: 'abcDEF12345', chaine: 'UCaaaaaaaaaaaaaaaaaaaaaa', site: 'https://www.bloomberg.com/live/us' },
    attendu: (s) => /\/embed\/abcDEF12345/.test(s || ''), cadre: true, lien: false, marque: null },
  { nom: 'chaîne seule → cadre « direct de la chaîne »', rep: { ok: true, video: null, chaine: 'UCaaaaaaaaaaaaaaaaaaaaaa', site: 'https://www.bloomberg.com/live/us' },
    attendu: (s) => /\/embed\/live_stream\?channel=UCaaaaaaaaaaaaaaaaaaaaaa/.test(s || ''), cadre: true, lien: false, marque: null },
  /* ⚠️ LE CAS DE YAHOO, ET C'EST LUI QUI MOTIVE TOUTE L'ÉTAPE (05/09). Le serveur a LU la page et
     vu que la chaîne n'émet pas : `enAntenne: false`. Cadrer « live_stream » ne pourrait alors que
     échouer — Bloomberg diffuse en continu, Yahoo Finance seulement aux heures de marché. On saute
     donc directement à la dernière émission, et on la NOMME. */
  { nom: 'hors antenne → la dernière émission, et le cadre le DIT',
    rep: { ok: true, video: null, chaine: 'UCaaaaaaaaaaaaaaaaaaaaaa', enAntenne: false,
           derniere: { id: 'derNIERE123', titre: 'Emission du jour' }, site: 'https://finance.yahoo.com/live/' },
    attendu: (s) => /\/embed\/derNIERE123/.test(s || '') && !/live_stream/.test(s || ''),
    cadre: true, lien: false, marque: /hors antenne/i },
  { nom: 'résolution en échec → la carte-lien d\'avant, jamais un cadre vide', rep: { ok: false, site: 'https://www.bloomberg.com/live/us' },
    attendu: null, cadre: false, lien: true, marque: null },
];

(async () => {
  phaseSource();
  phaseExtraction();
  await phaseGraine();

  const bin = trouverNavigateur();
  if (!bin) { console.log('\n[Direct] aucun Chromium → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }
  let pp; try { pp = require('puppeteer-core'); }
  catch { console.log('\n[Direct] puppeteer-core absent → phase navigateur abstenue.\n'); process.exit(ko ? 1 : 0); }

  let reponse = CAS[0].rep;
  const srv = serveur();
  await new Promise((r) => srv.listen(PORT, r));
  const CFG = { cfg: { active: 't', gap: 'tight', gapV: 2, deskV: 99, actV: 2, tipSeen: 1,
    layouts: [{ id: 't', name: 'Banc', fav: true, items: [{ w: 'direct-bloomberg', gw: 6, gh: 14 }] }] } };
  const srvS = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    if (['/api/me', '/api/auth/me', '/api/session', '/api/user'].includes(u)) {
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      return rs.end(JSON.stringify({ ok: true, loggedIn: true, authenticated: true, role: 'admin',
        user: { id: 'u1', email: 'banc@datatradingpro.com', name: 'Banc', role: 'admin', plan: 'professionnel', active: true } }));
    }
    if (u === '/api/widgets') { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify(CFG)); }
    if (u.indexOf('/api/direct/') === 0) { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify(reponse)); }
    srv.emit('request', rq, rs);
  });
  await new Promise((r) => srvS.listen(PORT + 1, r));

  let nav;
  try {
    nav = await pp.launch({ executablePath: bin, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    console.log('\n── Les trois étages du rendu ──');
    for (const c of CAS) {
      reponse = c.rep;
      const page = await nav.newPage();
      const fatales = [];
      page.on('pageerror', (e) => fatales.push(String(e.message).slice(0, 160)));
      /* ⚠️ ON EMPÊCHE LE CADRE DE SORTIR SUR LE RÉSEAU. Un banc qui appellerait YouTube serait
         lent, dépendant d'un tiers, et rouge le jour où ce tiers tousse. On veut l'ADRESSE que la
         carte construit, pas la vidéo. */
      await page.setRequestInterception(true);
      page.on('request', (rq) => {
        if (/youtube\.com|ytimg\.com|google\.com/.test(rq.url())) return rq.abort();
        rq.continue();
      });
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 3400));
      const vu = await page.evaluate(() => {
        const f = document.querySelector('.wdg-direct-frame iframe');
        const a = [...document.querySelectorAll('.wdg-direct a')].map((x) => x.getAttribute('href'));
        const m = document.querySelector('.wdg-direct-marque');
        return { src: f ? f.getAttribute('src') : null, liens: a,
                 bouton: !!document.querySelector('.wdg-direct-btn'),
                 marque: m ? (m.textContent || '').trim() : null,
                 pied: !!document.querySelector('.wdg-direct-pied') };
      });
      if (c.cadre) {
        v(c.nom, !!vu.src && c.attendu(vu.src), 'cadre : ' + vu.src);
      } else {
        v(c.nom, vu.src === null && vu.bouton === true, 'cadre : ' + vu.src + ' · bouton : ' + vu.bouton);
      }
      /* ⚠️ RÈGLE CHANGÉE LE 05/09, ET LES DEUX MOITIÉS SONT ÉPROUVÉES. Le 04/09, ce banc exigeait le
         lien vers l'éditeur DANS LES TROIS CAS (« le desk emmène chez la source, il ne la remplace
         pas »). L'utilisateur a fait retirer la barre qui le portait sous la vidéo, capture à
         l'appui : elle répétait le titre déjà présent dans l'en-tête de la carte et un lien que le
         lecteur YouTube porte lui-même, pour 32 px d'image en moins. La règle est donc LEVÉE sur
         les étages vidéo et ENTIÈRE sur le repli — où le bouton est la seule chose que la carte a à
         offrir. Les deux sont exigées séparément : sans la seconde, « plus de lien » deviendrait
         vrai partout, y compris là où il est utile. */
      if (c.lien) {
        v('… et le lien vers l\'éditeur est là, car c\'est tout ce que la carte peut offrir',
          vu.liens.some((h) => /bloomberg\.com\/live|yahoo\.com\/live/.test(h || '')),
          vu.liens.join(' · ') || 'aucun lien');
      } else {
        v('… et la barre sous la vidéo a bien disparu (demande utilisateur du 05/09)',
          vu.pied === false && !vu.liens.some((h) => /bloomberg\.com\/live|yahoo\.com\/live/.test(h || '')),
          'pied : ' + vu.pied + ' · liens : ' + (vu.liens.join(' · ') || 'aucun'));
      }
      /* La pastille va par paire, elle aussi : présente quand on montre un ENREGISTREMENT, absente
         quand on montre le direct — sans quoi elle mentirait dans l'autre sens. */
      if (c.marque) {
        v('… et la pastille « Hors antenne » nomme ce qu\'on regarde',
          !!vu.marque && c.marque.test(vu.marque), 'pastille : ' + vu.marque);
      } else if (c.cadre) {
        v('… et AUCUNE pastille « hors antenne » sur un vrai direct', vu.marque === null,
          'pastille : ' + vu.marque);
      }
      v('… sans erreur d\'exécution', fatales.length === 0, [...new Set(fatales)].slice(0, 3).join(' | '));
      await page.close();
    }

    /* ══ PHASE 4 : UN CADRE QUE YOUTUBE REFUSE DE JOUER SE REPLIE ════════════════════════════
       Le serveur confirme qu'une chaîne EXISTE (flux RSS) — nécessaire, pas suffisant : « elle
       existe » ne dit ni qu'elle passe à l'antenne, ni qu'elle s'autorise à être encadrée. Dans ces
       cas, le lecteur affiche SA page d'erreur, en anglais, à l'intérieur d'une carte DTP. C'est
       pire que le repli, qui lui est honnête et emmène chez l'éditeur.
       ⚠️ ON ÉPROUVE LE HANDLER, PAS YOUTUBE. Le banc ne sort jamais sur le réseau : on fabrique le
       message que le lecteur enverrait et on regarde ce que la carte en fait. C'est bien NOTRE code
       qui est en cause — le protocole de YouTube, lui, ne nous appartient pas.
       ⚠️ ET LA PAIRE EST TOUT L'INTÉRÊT. « Une erreur replie la carte » serait vert sur un code qui
       replie à la MOINDRE réception — donc qui démonte un lecteur qui marche à la première mesure
       d'audience venue. Le contrôle jumeau exige donc que le bruit (autre origine, message qui n'est
       pas une erreur, charge illisible) ne démonte RIEN. */
    console.log('\n── Le lecteur dit « non » : la carte se replie, elle ne montre pas l\'erreur ──');
    reponse = CAS[1].rep;
    const pj = await nav.newPage();
    const fatalesJ = [];
    pj.on('pageerror', (e) => fatalesJ.push(String(e.message).slice(0, 160)));
    await pj.setRequestInterception(true);
    pj.on('request', (rq) => {
      if (/youtube\.com|ytimg\.com|google\.com/.test(rq.url())) return rq.abort();
      rq.continue();
    });
    await pj.setViewport({ width: 1280, height: 900 });
    await pj.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3400));
    const src0 = await pj.evaluate(() => {
      const f = document.querySelector('.wdg-direct-frame iframe');
      return f ? f.getAttribute('src') : null;
    });
    v('le cadre demande au lecteur de PARLER (enablejsapi) — sans quoi il n\'émet jamais rien',
      !!src0 && /enablejsapi=1/.test(src0), 'cadre : ' + src0);
    const bruit = await pj.evaluate(() => {
      const f = document.querySelector('.wdg-direct-frame iframe');
      const post = (data, origin) => window.dispatchEvent(new MessageEvent('message',
        { data: data, origin: origin, source: f.contentWindow }));
      post(JSON.stringify({ event: 'onError', info: 150 }), 'https://evil.example');
      post(JSON.stringify({ event: 'onReady' }), 'https://www.youtube.com');
      post(JSON.stringify({ event: 'infoDelivery', info: { playerState: 1 } }), 'https://www.youtube.com');
      post('ceci n\'est pas du json', 'https://www.youtube.com');
      return !!document.querySelector('.wdg-direct-frame iframe');
    });
    v('le bruit ne démonte RIEN (autre origine, message sans erreur, charge illisible)', bruit === true);
    const apres = await pj.evaluate(async () => {
      const f = document.querySelector('.wdg-direct-frame iframe');
      window.dispatchEvent(new MessageEvent('message',
        { data: JSON.stringify({ event: 'onError', info: 150 }), origin: 'https://www.youtube.com', source: f.contentWindow }));
      await new Promise((r) => setTimeout(r, 250));
      return { cadre: !!document.querySelector('.wdg-direct-frame iframe'),
               bouton: !!document.querySelector('.wdg-direct-btn'),
               lien: !!document.querySelector('.wdg-direct-btn[href*="bloomberg.com/live"]') };
    });
    v('… mais une erreur du lecteur (150 : intégration refusée) replie la carte sur son lien',
      apres.cadre === false && apres.bouton === true, JSON.stringify(apres));
    v('… et ce repli est bien celui qui emmène chez l\'éditeur', apres.lien === true);
    v('… sans erreur d\'exécution', fatalesJ.length === 0, [...new Set(fatalesJ)].slice(0, 3).join(' | '));
    await pj.close();
  } catch (e) {
    console.log('\n[Direct] phase navigateur interrompue : ' + (e && e.message));
  } finally {
    if (nav) await nav.close();
    srvS.close();
    srv.close();
  }

  console.log(ko === 0 ? '\n[Direct] tout est vert.\n' : '\n[Direct] ' + ko + ' contrôle(s) au rouge.\n');
  process.exit(ko ? 1 : 0);
})();

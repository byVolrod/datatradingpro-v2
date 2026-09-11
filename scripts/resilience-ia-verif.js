#!/usr/bin/env node
/**
 * scripts/resilience-ia-verif.js — LA CHAÎNE IA SE REMET-ELLE, ET PRÉVIENT-ELLE ?
 * ------------------------------------------------------------------------------------------------
 * 11/09. Deux captures de l'utilisateur, le même incident :
 *   · les titres du fil affichés EN ANGLAIS sur un desk annoncé 100% français ;
 *   · le moniteur IA : « BACKOFF GLOBAL : ACTIF · 56 échecs cumulés », Claude « crédit épuisé »,
 *     et dans le même écran Groq, GitHub et OpenRouter à 100/100 — donc DÉJÀ rétablis.
 *
 * TROIS DÉFAUTS, ET AUCUN N'ÉTAIT UNE ERREUR DE CODE : trois décisions justes prises trop loin.
 *
 * 1. LE BACKOFF PUNISSAIT LA REPRISE. `min(6 h, 10 min × 2^(fails-3))` avec 56 échecs donnait le
 *    plafond de SIX HEURES, compté depuis le dernier échec. Une avarie de quelques minutes gelait
 *    donc la génération de fond pour six heures, bien après le retour des fournisseurs. Le compteur
 *    d'échecs mesure la gravité PASSÉE, jamais l'état PRÉSENT : escalader jusqu'à 6 h, c'est punir
 *    le rétablissement. Remplacé par un circuit SEMI-OUVERT : on re-sonde, borné à 30 min.
 *
 * 2. LE MONITORING AFFIRMAIT « utilisateur non impacté ». Textuellement, dans le code. Le « filet »
 *    qu'il vérifie ne teste que deux choses : le fil est chargé, le cache répond. Il ne dit RIEN de
 *    la génération. Les deux voyants étaient au vert pendant que le client lisait de l'anglais.
 *
 * 3. LE FILET PAYANT DISPARAISSAIT EN SILENCE. Une clé Claude sans crédit est marquée « état
 *    connu » pour ne pas armer le backoff — c'est juste. Mais ça ne prévenait PERSONNE, et c'est
 *    précisément l'absence de dernier recours qui a transformé une avarie du gratuit en panne
 *    totale. Ne pas paniquer et ne rien dire sont deux décisions différentes.
 *
 * ⚠️ ON EXÉCUTE LE VRAI CODE, EXTRAIT DES FICHIERS. Un banc qui relirait « la chaîne 6*3600 a
 * disparu de ai.js » serait vert sur une fonction qui ne sonde jamais. Ici on avance une horloge
 * factice et on demande à la VRAIE fonction ce qu'elle décide.
 */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  ✓ ' + nom); } else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); } };
const lire = f => fs.readFileSync(path.join(RACINE, f), 'utf8');

const AI = lire('ai.js');
const SRV = lire('server.js');

/* ── Le vrai bloc de backoff, extrait et instancié avec une horloge qu'on pilote ───────────────
   `Date.now` est remplacé dans la PORTÉE du bloc extrait : la fonction testée est celle du
   fichier, à la ligne près, mais le temps lui est dicté. Sans ça, éprouver une sonde à 10 min
   demanderait d'attendre 10 minutes. */
function instancier() {
  const d = AI.indexOf('let _totalFails = 0');
  const f = AI.indexOf('function backoffDepuisMs()');
  const fin = AI.indexOf('\n', AI.indexOf('}', f));
  if (d < 0 || f < 0) return null;
  const src = AI.slice(d, fin);
  const horloge = { t: 1000000 };
  const fabrique = new Function('Date', src + '\nreturn { backoffActive, backoffDepuisMs, _noteTotalFail, _noteTotalOk, get fails() { return _totalFails; } };');
  const faux = { now: () => horloge.t };
  return { api: fabrique(faux), horloge };
}

console.log('\n── 1. Le backoff re-sonde au lieu de geler six heures ──');
const inst = instancier();
v('le bloc de backoff est extractible de ai.js', !!inst);
if (inst) {
  const { api, horloge } = inst;
  const MIN = 60000;
  /* On rejoue la capture : 56 échecs totaux consécutifs. */
  for (let i = 0; i < 56; i++) { api._noteTotalFail(); horloge.t += 1000; }
  v('[exécuté] 56 échecs consécutifs arment bien le backoff', api.backoffActive() === true,
    'sans armement, tout ce qui suit ne mesurerait rien');

  horloge.t += 29 * MIN;
  v('[exécuté] à 29 min, le backoff tient encore', api.backoffActive() === true, 'sonde ouverte trop tôt');
  horloge.t += 2 * MIN;   // 31 min
  v('[exécuté] à 31 min, la sonde s\'ouvre — au lieu d\'attendre 6 h',
    api.backoffActive() === false,
    'la chaîne reste gelée : c\'est le défaut du 11/09, six heures de titres en anglais après une avarie de quelques minutes');

  /* ⚠️ OBSERVER NE DOIT RIEN CONSOMMER — ET CE CONTRÔLE DOIT ÊTRE POSÉ *DANS* LA FENÊTRE OUVERTE.
     Première écriture : il interrogeait la fonction juste après les 56 échecs, c'est-à-dire quand
     la fenêtre était FERMÉE — il n'y avait alors rien à consommer, et le témoin est resté vert
     alors qu'on avait délibérément rendu la lecture consommatrice. Un témoin qui ne peut pas
     mordre ne prouve rien : il faut lire au moment où une sonde est effectivement disponible.
     L'enjeu est réel : `status()` et le panneau admin appellent cette fonction toutes les 30 s
     pour l'AFFICHER. Si la question consommait la sonde, le panneau affamerait les tâches de fond
     et causerait la panne qu'il décrit. */
  for (let i = 0; i < 200; i++) api.backoffActive();
  v('[exécuté] 200 lectures d\'affichage ne referment pas la sonde ouverte',
    api.backoffActive() === false,
    'la seule question a refermé la fenêtre : le panneau admin affamerait les tâches de fond');

  /* La sonde rate → la fenêtre se referme d'elle-même, sans jeton à gérer. */
  api._noteTotalFail();
  v('[exécuté] une sonde qui ÉCHOUE referme la fenêtre', api.backoffActive() === true,
    'sinon la chaîne morte serait sollicitée en continu');

  /* La sonde réussit → tout est levé immédiatement. */
  horloge.t += 31 * MIN;
  v('[exécuté] … puis se rouvre 30 min plus tard', api.backoffActive() === false);
  api._noteTotalOk();
  v('[exécuté] une sonde qui RÉUSSIT lève tout, sans attendre', api.backoffActive() === false && api.fails === 0,
    'compteur à ' + api.fails);

  /* ⚠️ BORNE HAUTE : c'est la valeur qui a coûté six heures. */
  for (let i = 0; i < 400; i++) { api._noteTotalFail(); horloge.t += 100; }
  horloge.t += 31 * MIN;
  v('[exécuté] même après 400 échecs, l\'attente reste bornée à 30 min',
    api.backoffActive() === false,
    'l\'escalade repart vers des heures : le compteur mesure le passé, pas l\'état présent');

  /* ── La durée de l'incident, mesurée depuis le PREMIER échec ─────────────────────────────── */
  console.log('\n── 2. La durée annoncée est celle de l\'incident ──');
  api._noteTotalOk();
  const t0 = horloge.t;
  api._noteTotalFail(); api._noteTotalFail(); api._noteTotalFail();
  horloge.t += 90 * MIN;
  api._noteTotalFail();                       // une tentative ratée de plus, 90 min après le début
  const vu = api.backoffDepuisMs();
  /* ⚠️ MESURÉE SUR LE DERNIER ÉCHEC, cette durée serait remise à zéro par chaque tentative ratée :
     elle n'aurait JAMAIS dépassé l'intervalle de sonde, et le seuil d'alerte des 30 min n'aurait
     jamais pu être franchi — quelle que soit la durée réelle de la panne. */
  v('[exécuté] après 90 min de panne, la durée rapportée est bien ~90 min',
    Math.abs(vu - (horloge.t - t0)) < 1000 && vu >= 90 * MIN,
    'rapporté : ' + Math.round(vu / 60000) + ' min — mesurée depuis le dernier échec, elle vaudrait 0 et l\'alerte ne partirait jamais');
  api._noteTotalOk();
  v('[exécuté] et elle retombe à zéro au rétablissement', api.backoffDepuisMs() === 0);
}

/* ── 3. Le filet payant : la vraie fonction, sur de vraies formes de status() ─────────────────── */
console.log('\n── 3. Le filet payant ne peut plus tomber en silence ──');
{
  const d = SRV.indexOf('function _filetPayantHS(st)');
  const f = SRV.indexOf('\n}', d) + 2;
  v('_filetPayantHS est extractible de server.js', d >= 0 && f > d);
  if (d >= 0 && f > d) {
    const fn = new Function(SRV.slice(d, f) + '\nreturn _filetPayantHS;')();
    /* La forme EXACTE de la capture : 4 clés, toutes gelées pour crédit épuisé. */
    const capture = { anthropicKeys: 4, claudeCooling: [1, 2, 3, 4].map(k => ({ key: k, reason: 'crédit épuisé', minLeft: 300 })) };
    const r = fn(capture);
    v('[exécuté] la situation du 11/09 est bien détectée', r.hs === true && r.motif === 'crédit épuisé',
      JSON.stringify(r));
    v('[exécuté] une clé morte (auth) l\'est aussi',
      fn({ anthropicKeys: 2, claudeCooling: [{ key: 1, reason: 'auth' }, { key: 2, reason: 'auth' }] }).hs === true);
    /* [témoin] IL RESTE UN FILET : une seule clé vivante suffit à ne pas alerter. */
    v('[témoin] trois clés sur quatre gelées → PAS d\'alerte',
      fn({ anthropicKeys: 4, claudeCooling: [1, 2, 3].map(k => ({ key: k, reason: 'crédit épuisé' })) }).hs === false,
      'on alerterait alors qu\'un filet reste : l\'e-mail deviendrait du bruit');
    /* [témoin] UNE SURCHARGE PASSAGÈRE N'EST PAS UN COMPTE À RECHARGER. Compter ces raisons-là
       ferait partir « rechargez votre compte » pour un 429 de trois minutes. */
    v('[témoin] quatre clés en cooldown 429/surcharge → PAS d\'alerte',
      fn({ anthropicKeys: 4, claudeCooling: [{ key: 1, reason: '429' }, { key: 2, reason: '429' }, { key: 3, reason: 'surcharge' }, { key: 4, reason: 'erreur' }] }).hs === false,
      'un e-mail « rechargez » pour une surcharge de trois minutes est exactement ce qui rend une alerte ignorable');
    v('[témoin] aucune clé configurée → PAS d\'alerte', fn({ anthropicKeys: 0, claudeCooling: [] }).hs === false,
      'alerter sur l\'absence d\'une option jamais activée serait du bruit permanent');
  }
}

/* ── 4. Les alertes sont BRANCHÉES, pas seulement écrites ─────────────────────────────────────── */
console.log('\n── 4. Les deux alertes partent vraiment ──');
{
  /* ⚠️ LA PHRASE FAUTIVE NE DOIT PAS REVENIR. C'est elle qui a couvert l'incident : le monitoring
     affirmait une chose qu'il n'avait aucun moyen de vérifier. */
  v('aucune note d\'alerte n\'affirme plus « utilisateur non impacté »',
    !/_aiAlertNote\([^)]*utilisateur non impact/i.test(SRV),
    'le filet vérifié (fil + cache) ne dit RIEN de la génération : cette affirmation a couvert une panne de plusieurs heures');
  v('une panne PROLONGÉE déclenche un e-mail', /_aiAlertDue\('backoff_long'/.test(SRV),
    'sans lui, une panne de six heures reste une simple note dans un journal que personne n\'ouvre');
  v('… et elle envoie vraiment (poussée dans la file de mails)',
    /_aiAlertDue\('backoff_long'[\s\S]{0,600}?out\.push\(/.test(SRV),
    'une alerte notée mais jamais poussée dans `out` ne part pas : elle décore le panneau');
  v('… avec un message « résolu » quand ça repart', /_aiAlertClear\('backoff_long'\)/.test(SRV));
  v('le filet payant tombé déclenche un e-mail', /_aiAlertDue\('claude_hs'/.test(SRV));
  v('… et il envoie vraiment', /_aiAlertDue\('claude_hs'[\s\S]{0,600}?out\.push\(/.test(SRV));
  v('… avec son message « résolu »', /_aiAlertClear\('claude_hs'\)/.test(SRV));
  /* ⚠️ HORS DE TOUTE BRANCHE : posé dans le `else` du critique, le filet payant ne serait vérifié
     QUE lorsque tout va bien par ailleurs — donc jamais pendant l'incident où il compte. */
  const dep = SRV.indexOf('const _filet = _filetPayantHS(st);');
  const ligne = SRV.slice(SRV.lastIndexOf('\n', dep) + 1, SRV.indexOf('\n', dep));
  v('… et la vérification tourne hors de toute branche', /^ {2}const _filet/.test(ligne),
    'indentation « ' + ligne.slice(0, 12) + '… » : enfermée dans une branche, elle ne serait jamais atteinte pendant l\'incident');
  /* Une avarie courte ne doit PAS réveiller : c'est ce qui use un signal jusqu'à le rendre inutile. */
  v('une avarie COURTE ne déclenche aucun e-mail', /_SEUIL_PROLONGEE_MS = 30 \* 60 \* 1000/.test(SRV),
    'sans seuil, chaque hoquet de deux minutes enverrait un mail, et on cesserait de les lire');
}

/* ── 5. CE QUE LA PANNE A RENDU VISIBLE CÔTÉ CLIENT ──────────────────────────────────────────────
   Deux symptômes signalés le même jour, tous deux DÉCLENCHÉS par la panne mais causés par des
   défauts qui l'attendaient : une courbe qui tourne sans fin, et un rapport de secours qui ne dit
   pas qu'il en est un. */
console.log('\n── 5. Aucun rond ne tourne sans porte de sortie ──');
{
  const APP = lire('public/js/app.js');
  /* ⚠️ LA SORTIE SILENCIEUSE EST LE DÉFAUT. `if (… typeof buildStrengthChart !== 'function') return;`
     quittait la fonction sans toucher au loader : pas de requête, donc pas de `.catch`, donc un
     rond qui tourne pour toujours. Aucune erreur en console : parfaitement muet. */
  /* ⚠️ ON NE COMPTE QUE LES LIGNES DE CODE. La formule fautive est citée dans le commentaire qui
     documente l'incident — c'est voulu, elle doit rester lisible. Compter les commentaires ferait
     rougir le banc sur sa propre explication, et la façon de le faire taire serait d'effacer la
     mémoire du défaut. */
  const sorties = APP.split('\n').filter(l => {
    const t = l.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || l.indexOf('`') >= 0) return false;
    return /typeof buildStrengthChart !== 'function'\) return;/.test(l);
  }).length;
  v('plus aucune sortie silencieuse sur le traceur absent', sorties === 0,
    sorties + ' sortie(s) `return` sans rien écrire : le loader resterait à tourner indéfiniment');
  v('le traceur est ATTENDU un temps borné, puis on écrit', /_FORCE_ATTENTE_MS/.test(APP) && /function _forceQuandPret/.test(APP),
    'charts.js est chargé séparément : sans attente, un rapport rendu trop tôt n\'aurait jamais sa courbe');
  /* ⚠️ ET LA REQUÊTE DOIT POUVOIR ÉCHOUER. Sans délai maximal, un point d'entrée lent — exactement
     ce que produit un serveur qui enchaîne les tentatives vers des fournisseurs morts — laisse la
     promesse pendante : ni `.then`, ni `.catch`, et le rond tourne. */
  v('la requête de la courbe a un délai maximal', /function _forceFetch/.test(APP) && /AbortController/.test(APP.slice(APP.indexOf('function _forceFetch'), APP.indexOf('function _forceFetch') + 400)),
    'une requête sans délai n\'échoue jamais : elle attend, et le rond avec elle');
  /* ⚠️ RÉGRESSION RÉELLE DU 11/09, APRÈS CE BANC DÉJÀ VERT : ce contrôle ne vérifiait que la
     PRÉSENCE de la chaîne dans app.js — il est resté vert alors que l'appel à _fxdrTracerForce()
     avait été posé par erreur dans _renderDTPDaily (qui n'a jamais de #fxdr-cs-all : appel mort)
     au lieu de _renderFXDailyRecap, qui ne l'appelait JAMAIS. Le rond du Récap Quotidien tournait
     à l'infini en prod, banc vert. On borne désormais la recherche au VRAI CORPS de
     _renderFXDailyRecap — entre sa déclaration et la PROCHAINE fonction top-level — et plus
     « quelque part dans le fichier ». */
  const _fxrDeb = APP.indexOf('function _renderFXDailyRecap(');
  v('_renderFXDailyRecap existe', _fxrDeb >= 0);
  const _fxrFin = _fxrDeb >= 0 ? APP.indexOf('\nfunction ', _fxrDeb + 10) : -1;
  const _fxrCorps = (_fxrDeb >= 0 && _fxrFin > _fxrDeb) ? APP.slice(_fxrDeb, _fxrFin) : '';
  v('… et SON PROPRE corps appelle _fxdrTracerForce() (pas un autre rapport)',
    /_fxdrTracerForce\(\);/.test(_fxrCorps),
    'la fonction existe et est appelée ailleurs dans le fichier : du code mort qui rassure — ' +
    'exactement ce qui a laissé le rond tourner en prod le 11/09 malgré un banc vert');
  /* Les trois hôtes de courbe doivent TOUS avoir leur message de repli. */
  for (const [nom, marque] of [['récap quotidien', '_fxdrTracerForce'], ['mini-courbe par devise', '_wrBuildCcyChart'], ['courbes paresseuses', '_wrLazyCharts']]) {
    const d = APP.indexOf('function ' + marque + '(');
    const corps = d >= 0 ? APP.slice(d, d + 1100) : '';
    v('… ' + nom + ' : un message remplace le rond en cas d\'échec', /_FORCE_MSG/.test(corps),
      'sortie sans message : le rond reste');
  }

  console.log('\n── 6. Un rapport de secours dit qu\'il en est un ──');
  /* ⚠️ LE REPLI N'EST PAS LE DÉFAUT — SON SILENCE L'ÉTAIT. Le repli déterministe recycle les
     dépêches brutes (anglaises) quand la rédaction IA ne répond pas ; il existe pour de bonnes
     raisons et se remplace tout seul en 15 min. Mais rien ne le distinguait à l'écran du vrai
     rapport : le client croyait lire le produit. */
  v('le drapeau de repli est LU côté client', /_fxr\._ai === false/.test(APP),
    'le serveur le pose depuis toujours et personne ne le lisait : l\'information existait, elle n\'atteignait aucun écran');
  v('… et il affiche un bandeau « version provisoire »', /fxdr-provisoire/.test(APP) && /Version provisoire/.test(APP));
  v('… qui annonce la reprise automatique', /se compl[eè]te automatiquement/i.test(APP),
    'dire « provisoire » sans dire que ça se répare seul inquiète sans informer');
  const CSS = lire('public/css/style.css');
  v('… et le bandeau est STYLÉ, pas seulement posé', /\.fxdr-provisoire\s*\{/.test(CSS),
    'une classe sans règle rend un bloc invisible : le bandeau existerait dans le DOM et pas à l\'écran');

  /* Le serveur, lui, doit continuer de retenter le jour COURANT — sinon le bandeau deviendrait un
     aveu permanent au lieu d'un état passager. */
  v('le serveur retente la génération du jour tant qu\'elle est un repli', /_fxrIsFallback/.test(SRV),
    'sans cette reprise, le rapport de secours resterait en place toute la journée');
}

console.log('\n── 7. Le panneau admin voit-il vraiment les tâches de fond, ou lit-il du vide ? ──');
/* ⚠️ TROUVÉ EN CHASSANT LA MÊME QUESTION QUE LE CLIENT (11/09, 3ᵉ signalement de la soirée :
   « pourquoi c'est en anglais ? »). Le panneau « Prévision & quota » du moniteur IA affichait déjà
   une ligne « Explications de propos », avec une logique de couleur soignée (gris si éteinte,
   rouge/orange/vert selon les tentatives) — mais elle lisait `d.providers.propos`, un champ qui
   n'existe NULLE PART dans la réponse serveur (le vrai champ s'appelle `proposFr`). La garde
   `if (!s …) return ''` avalait ce `undefined` sans un mot : la ligne n'a jamais dessiné un seul
   pixel, précisément la classe de défaut que ce bloc prétendait empêcher. Deux tâches voisines
   (pré-traduction des descriptions, Impact marché) portaient le même défaut : mesurées depuis des
   semaines, jamais montrées nulle part dans le panneau. On EXTRAIT le vrai bloc de admin.js et on
   l'exécute avec de fausses données — lire « `.proposFr` apparaît dans le fichier » serait vert sur
   un bloc qui lit encore `.propos` autre part. */
function _fondRowsBloc() {
  const deb = APP2.indexOf('const fondRows = (() => {');
  const fin = APP2.indexOf('})();', deb);
  if (deb < 0 || fin < 0) return null;
  return APP2.slice(deb, fin + 5);
}
const APP2 = lire('public/js/admin.js');
const bloc = _fondRowsBloc();
v('le bloc "fondRows" du panneau admin est extractible', !!bloc);
if (bloc) {
  const DONNEES = { providers: {
    proposFr: { jour: '2026-09-11', traduits: 5, tentes: 22, plafond: 900 },
    descFr:   { jour: '2026-09-11', traduites: 3, tentees: 8, plafond: 300 },
    impacts:  { jour: '2026-09-11', generes: 1, tentes: 2, plafond: 60 },
  } };
  const rejouer = (source, d) => new Function('d', source + '\nreturn fondRows;')(d);
  const out = rejouer(bloc, DONNEES);
  v('[exécuté] la traduction du fil (proposFr) s\'affiche avec ses vrais chiffres',
    out.includes('Traduction du fil') && out.includes('5<span') && out.includes('22 / 900'),
    'sortie : ' + out.slice(0, 200));
  v('[exécuté] la pré-traduction des descriptions (descFr) s\'affiche aussi', out.includes('Pré-traduction des descriptions'));
  v('[exécuté] l\'impact marché (impacts) s\'affiche aussi', out.includes('Impact marché'));
  v('[exécuté] sans aucune donnée, le bloc reste VIDE (pas de section fantôme)', rejouer(bloc, { providers: {} }) === '');
  /* Témoin : remettre le bug d'origine (le champ « propos » plutôt que « proposFr ») doit faire
     disparaître la ligne — sinon ce contrôle ne prouve rien. */
  const blocMute = bloc.replace("p.proposFr, 'traduits'", "p.propos, 'traduits'");
  v('[exécuté] mutation : revenir à `.propos` (le vrai bug du 11/09) fait DISPARAÎTRE la ligne',
    !rejouer(blocMute, DONNEES).includes('Traduction du fil'),
    'si cette ligne reste verte malgré la mutation, le contrôle ci-dessus ne mord pas');
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

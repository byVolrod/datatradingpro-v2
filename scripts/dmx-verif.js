#!/usr/bin/env node
/**
 * scripts/dmx-verif.js — LE POSITIONNEMENT PEUT-IL ENCORE « CHARGER À L'INFINI » ?
 *
 * POURQUOI (09/09, capture utilisateur : le widget DMX figé sur « Chargement des données DMX… »,
 * « pourquoi ça charge à l'infini ? Corrige moi ça pour tous les widgets »).
 *
 * LA CAUSE ÉTAIT ÉCRITE EN TOUTES LETTRES, ET PRISE POUR UNE QUALITÉ. Le commentaire de la route
 * disait : « instantané (cache) ; ne bloque qu'au tout premier chargement ». Or ce premier
 * chargement est celui d'un conteneur qui vient de redémarrer — donc APRÈS CHAQUE DÉPLOIEMENT — et
 * il pilote un navigateur pour se connecter à la source, avec des délais internes de 30 puis
 * 45 secondes. Le desk, lui, n'avait aucun garde-temps : il montrait son animation et attendait.
 * Une animation de chargement qui tourne sans fin n'est pas une attente, c'est une panne muette.
 *
 * Deux garde-fous, et ils sont complémentaires — c'est ce que ce banc vérifie :
 *   · le SERVEUR borne son attente et répond `pending: true` plutôt que de tenir la connexion ;
 *   · le DESK borne la sienne aussi, parce que le serveur ne peut rien contre un réseau qui ne
 *     répond plus, un relais qui garde la connexion ouverte, un ordinateur qui sort de veille.
 *
 *   node scripts/dmx-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}
const S = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const C = fs.readFileSync(path.join(RACINE, 'public/js/charts.js'), 'utf8');

console.log('\n[1] Le serveur ne tient plus la connexion ouverte');
{
  const i = S.indexOf("app.get('/api/community-outlook'");
  const bloc = i > 0 ? S.slice(i, i + 2200) : '';
  t('la route est trouvée', !!bloc);
  t('l\'attente est bornée par une course', /Promise\.race\(\[/.test(bloc),
    'un premier chargement froid tiendrait la connexion plus d\'une minute');
  t('elle répond `pending` au lieu d\'attendre', /pending: true/.test(bloc));
  /* LA RÉCUPÉRATION NE DOIT PAS ÊTRE ANNULÉE : c'est elle qui remplit le cache pour la fois
     suivante. Abandonner la course ET la recherche donnerait un widget qui ne se remplit jamais. */
  t('la récupération continue en arrière-plan', /refreshOutlookBg\(\);\s*\/\/ la récupération continue/.test(bloc),
    'sans elle, le cache ne se remplirait jamais et « pending » serait éternel');
  /* TÉMOIN : la réponse d'attente ne doit PAS être mise en cache par le navigateur, sinon le desk
     rejouerait « je cherche » même une fois les données arrivées. */
  t('TÉMOIN — la réponse d\'attente n\'est pas mise en cache', /no-store/.test(bloc));
}

console.log('\n[2] Le desk borne SA propre attente');
{
  const i = C.indexOf('var _abandon = (typeof AbortController');
  const bloc = i > 0 ? C.slice(i, i + 900) : '';
  t('un garde-temps est armé avant l\'appel', !!bloc && /setTimeout\(function \(\) \{ try \{ _abandon && _abandon\.abort/.test(bloc));
  t('il est passé à fetch', /fetch\(url, _abandon \? \{ signal: _abandon\.signal \}/.test(C));
  /* Il doit être DÉSARMÉ à la réponse, sinon il abandonnerait un appel déjà servi — et l'erreur
     tomberait sur un widget correctement rempli, quinze secondes après coup. */
  t('il est désarmé dès la réponse', (C.match(/clearTimeout\(_minuteur\)/g) || []).length >= 2,
    (C.match(/clearTimeout\(_minuteur\)/g) || []).length + ' désarmement(s)');
}

/* ══ PHASE 3 — LES TROIS ÉTATS, EXÉCUTÉS ════════════════════════════════════════════════════════
   « Je cherche », « la source n'a rien publié » et « erreur » sont trois situations différentes.
   Avant, les deux premières partageaient une phrase et AUCUNE ne redemandait : le widget restait
   sur son message pour toujours. On extrait la vraie cascade et on la fait tourner.               */
/* ══ PHASE 2 bis — LA GARDE DES IDENTIFIANTS, ET LA TABLE DES RAISONS ═══════════════════════════
   Le fichier du récupérateur promet, depuis le 21/08, en tête et en toutes lettres : « Sans eux, le
   scraper s'arrête proprement au lieu de tenter une connexion avec une valeur périmée. » Le code, lui,
   appelait l'interface de connexion avec DEUX CHAÎNES VIDES, deux fois, quinze secondes chacune —
   trente secondes perdues à chaque démarrage à froid, avant même d'essayer le navigateur. Encore un
   commentaire qui disait le contraire du code, et qui a donc empêché de chercher là.               */
console.log('\n[2 bis] La garde des identifiants, et la table des raisons');
{
  const M = fs.readFileSync(path.join(RACINE, 'scrapers/myfxbook.js'), 'utf8');
  const iF = M.indexOf('function identifiantsPresents()');
  const ligne = iF > 0 ? M.slice(iF, M.indexOf('\n', iF)) : '';
  let present = null;
  try { present = new Function(ligne + '; return identifiantsPresents;')(); } catch (e) {}
  t('identifiantsPresents est extraite', typeof present === 'function');
  if (present) {
    /* On l'exécute avec des variables contrôlées : c'est la seule façon de vérifier qu'une chaîne
       VIDE est bien traitée comme « absent » — le cas exact de production. */
    const jouer = (em, pw) => new Function('MFB_EMAIL', 'MFB_PASS', ligne + '; return identifiantsPresents();')(em, pw);
    t('deux chaînes vides = identifiants ABSENTS', jouer('', '') === false);
    t('une adresse sans mot de passe = absents', jouer('a@b.c', '') === false);
    t('TÉMOIN — des identifiants réels sont bien vus', jouer('a@b.c', 'x') === true);
  }
  const iD = M.indexOf('_diagRaz();');
  const bloc = iD > 0 ? M.slice(iD, iD + 1400) : '';
  t('le chemin API est SAUTÉ quand ils manquent', /if \(!identifiantsPresents\(\)\) \{/.test(bloc),
    'trente secondes de tentatives vides avant le navigateur, à chaque démarrage à froid');
  t('… et la raison est nommée', /identifiants-absents/.test(bloc));

  /* COUVERTURE : chaque raison que le récupérateur peut produire doit avoir une phrase française.
     Sans ce contrôle, ajouter une raison sans son message donnerait au client un « Positionnement
     indisponible » générique — c'est-à-dire le silence qu'on vient de supprimer, sous un autre nom. */
  /* ⚠️ ON RAMASSE AUSSI LES RAISONS POSÉES PAR UN TERNAIRE. Le premier motif exigeait une chaîne
     COLLÉE au signe égal — il ratait donc `_diag.raison = chrome ? 'navigateur-indisponible' :
     'navigateur-echec';`, c'est-à-dire précisément les deux raisons les plus techniques, celles
     dont la phrase française manquerait le plus. Le témoin ne mordait pas : retirer leur phrase
     laissait le contrôle vert, parce que la liste ne les avait jamais contenues. On lit donc
     l'INSTRUCTION entière et on en extrait chaque chaîne. */
  const raisons = [...M.matchAll(/_diag\.raison = ([^;]+);/g)]
    .flatMap(m => [...m[1].matchAll(/'([a-z-]+)'/g)].map(x => x[1]));
  /* ⚠️ ON BORNE LA LECTURE AU BLOC `_DMX_RAISONS`. La première écriture cherchait le motif dans
     TOUT `server.js` : d'autres objets du fichier portent des clés de la même forme, si bien que la
     couverture paraissait complète quoi qu'il arrive. Le témoin ne mordait pas — retirer une phrase
     laissait le contrôle vert. Un contrôle de couverture doit lire LA table, pas le fichier. */
  const iT = S.indexOf('const _DMX_RAISONS = {');
  const finT = S.indexOf('\n};', iT);
  const table = (iT > 0 && finT > iT) ? S.slice(iT, finT) : '';
  const traduites = [...table.matchAll(/'([a-z-]+)':\s+'/g)].map(m => m[1]);
  const orphelines = [...new Set(raisons)].filter(r => !traduites.includes(r));
  t('le récupérateur nomme ses raisons', raisons.length >= 3, raisons.join(', '));
  t('chaque raison a sa phrase en français', orphelines.length === 0, orphelines.join(', '));
  t('TÉMOIN — la table de traduction est bien lue', traduites.length >= 4, traduites.length + ' phrase(s)');
}

console.log('\n[3] Les trois états, exécutés');
{
  /* ⚠️ LA BORNE COMMENCE À `_raison`, PAS À `if (data.pending)`. La phrase affichée et la petite
     fonction qui la pose sont déclarées JUSTE AVANT la cascade : découper au niveau du premier
     `if` extrayait un fragment qui référence des variables restées dehors, et le banc plantait sur
     du code parfaitement valide. Un repère d'extraction se choisit sur la portée, pas sur la
     première ligne qui a l'air d'être le sujet. */
  const a = C.indexOf('      var _raison = data.raison');
  const b = C.indexOf('      _dmxLastUpdate = Date.now();', a);
  const src = (a > 0 && b > a) ? C.slice(a, b) : null;
  t('la cascade d\'états est extraite', !!src);
  if (src) {
    const jouer = (data) => {
      let html = '', relance = null;
      const wrap = { set innerHTML(v) { html = v; }, get innerHTML() { return html; } };
      const faux = new Function('wrap', 'data', 'opts', '_dmxAllowed', 'setTimeout', 'buildDMXChart',
        src + '\n return { fini: false };');
      faux(wrap, data, null, () => true, (fn, ms) => { relance = ms; }, () => {});
      return { html, relance };
    };
    const p = jouer({ pending: true });
    t('« je cherche » a sa propre phrase', /en cours de récupération/.test(p.html), JSON.stringify(p.html.slice(0, 80)));
    t('… et il redemande tout seul', p.relance === 10000, 'relance = ' + p.relance);

    const v = jouer({ symbols: [] });
    t('« rien publié » a une phrase DIFFÉRENTE', /Aucun positionnement publié/.test(v.html) && v.html !== p.html,
      JSON.stringify(v.html.slice(0, 80)));
    t('… et il redemande plus lentement', v.relance === 60000, 'relance = ' + v.relance);

    /* LA RAISON DU SERVEUR PREND LE PAS SUR LA PHRASE GÉNÉRIQUE. C'est tout l'intérêt : « en
       attente » ne se répare pas, « identifiants absents sur le serveur » se répare en une ligne. */
    const r = jouer({ symbols: [], raison: { cle: 'identifiants-absents', texte: 'Identifiants Myfxbook absents sur le serveur (MFB_EMAIL / MFB_PASS).' } });
    t('la raison donnée par le serveur est affichée', /Identifiants Myfxbook absents/.test(r.html),
      JSON.stringify(r.html.slice(0, 90)));
    const r2 = jouer({ pending: true, raison: { cle: 'navigateur-indisponible', texte: 'Navigateur de récupération indisponible sur le serveur.' } });
    t('… y compris pendant une attente', /Navigateur de récupération indisponible/.test(r2.html),
      JSON.stringify(r2.html.slice(0, 120)));

    /* TÉMOIN INVERSE : des données réelles ne doivent déclencher NI message NI relance — sinon le
       widget se rechargerait en boucle par-dessus un rendu correct. */
    const d = jouer({ symbols: [{ symbol: 'EURUSD', longPct: 60, shortPct: 40 }] });
    t('TÉMOIN — avec des données, aucun message ni relance', d.html === '' && d.relance === null,
      JSON.stringify([d.html.slice(0, 60), d.relance]));
  }
}

console.log('\n[DMX] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

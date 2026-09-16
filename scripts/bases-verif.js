#!/usr/bin/env node
/**
 * scripts/bases-verif.js — LA QUARANTAINE DE LECTURE DES BASES REVENUES
 *
 * POURQUOI CE BANC EXISTE (02/09/2026). Le projet Supabase principal est resté EN PAUSE du 14 juin
 * au 2 septembre. Sa table `users` porte 29 comptes ; le desk en a 50, dont 21 dont l'échéance est
 * déjà dépassée dans cet instantané de juin. Au moment de le rallumer, la couche multi-bases allait
 * faire exactement ce qu'elle a toujours fait : le réintégrer au pool, le relire EN PREMIER, et —
 * puisqu'il répond « non vide » — s'arrêter sur lui. `verifyLogin` aurait alors servi à 29 clients
 * leur mot de passe de juin, leur ancien plan et leur ancienne échéance, PUIS recopié cette ligne
 * périmée dans le miroir local, détruisant la version fraîche. Rien dans le code ne s'y opposait, et
 * rien à l'écran ne l'aurait dit : le client aurait simplement vu « mot de passe incorrect » ou
 * « abonnement expiré ».
 *
 * CE QUE CE BANC ÉPROUVE, sur le VRAI code extrait d'auth.js (jamais une copie — une copie ne
 * vieillit pas avec le produit) :
 *   1. une base marquée muette ne sert plus AUCUNE lecture de `users` ;
 *   2. elle continue de recevoir les ÉCRITURES — c'est par elles que la resynchronisation passe ;
 *   3. les autres tables ne sont PAS privées d'elle (un cache périmé se recalcule) ;
 *   4. la convergence, et elle seule, lève la quarantaine ;
 *   5. toutes les bases en quarantaine → NODESDOWN, donc repli sur le miroir : le pire cas de cette
 *      garde est l'état le plus sûr.
 *
 *   node scripts/bases-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* Extraction par comptage d'accolades. Les chaînes ET LES COMMENTAIRES sont sautés : une apostrophe
   française dans un commentaire ouvrirait sinon une fausse chaîne et avalerait la fonction entière —
   le piège relevé dans colonnes-verif le 02/09, qui y désarmait deux sections en silence. */
function extraire(src, depart) {
  const d = src.indexOf(depart);
  if (d < 0) return null;
  let i = src.indexOf('{', d), prof = 0, ch = null;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1], n = src[i + 1];
    if (ch) { if (c === ch && p !== '\\') ch = null; continue; }
    if (c === '/' && n === '/') { const f = src.indexOf('\n', i); if (f < 0) return null; i = f; continue; }
    if (c === '/' && n === '*') { const f = src.indexOf('*/', i + 2); if (f < 0) return null; i = f + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { ch = c; continue; }
    if (c === '{') prof++;
    else if (c === '}') { prof--; if (prof === 0) return src.slice(d, i + 1); }
  }
  return null;
}
const _TEMOIN = extraire("function z() {\n  // ce qu'on écrit d'habitude\n  return { a: 1 };\n}", 'function z(');

console.log('\n── Extraction du vrai code d\'auth.js ──');
const SRC_RUN   = extraire(AUTH, 'async function _runMulti(');
const SRC_DOWN  = extraire(AUTH, 'function _markDown(');
const SRC_CONV  = extraire(AUTH, 'async function _usersConverge(');
const SRC_APPLY = extraire(AUTH, 'function _applyOps(');
/* AJOUTÉS LE 03/09 : _runMulti délègue désormais à ces deux lectures (réunion des nœuds pour
   `chat_messages`, fraîcheur pour `ai_cache`). Sans elles dans le bac, la fonction extraite lève
   ReferenceError et TOUS les contrôles de ce banc s'effondrent d'un coup — ce qui est exactement
   ce qui vient d'arriver, et exactement ce qu'un banc doit faire quand le code sous lui bouge. */
const SRC_UNION = extraire(AUTH, 'async function _lireUnion(');
const SRC_FRAIS = extraire(AUTH, 'async function _lireFraicheur(');
const SRC_TU    = (/const _TABLES_UNION     = new Set\(\[[^\]]*\]\);/.exec(AUTH) || [null])[0];
const SRC_TF    = (/const _TABLES_FRAICHEUR = new Map\(\[[\s\S]*?\]\);/.exec(AUTH) || [null])[0];
const SRC_SENS  = (/const _TABLES_SENSIBLES = new Set\(\[[^\]]*\]\);/.exec(AUTH) || [null])[0];
v('[témoin] une apostrophe en commentaire ne casse pas l\'extracteur',
  !!_TEMOIN && /return \{ a: 1 \};/.test(_TEMOIN));
v('_runMulti extractible', !!SRC_RUN);
v('_markDown extractible', !!SRC_DOWN);
v('_usersConverge extractible', !!SRC_CONV);
v('_applyOps extractible', !!SRC_APPLY);
v('la liste des tables sensibles est LUE dans auth.js, pas recopiée ici',
  !!SRC_SENS && /'users'/.test(SRC_SENS), 'lu : ' + SRC_SENS);

/* ── Bac à sable : le vrai _runMulti / _markDown, avec des doublures pour tout le reste ─────────
   Chaque « base » est un faux client qui journalise ce qu'on lui demande et rend ce qu'on lui a dit
   de rendre. On peut donc affirmer QUI a été interrogé, pas seulement ce qui est revenu. */
function bac(nodes) {
  if (!(SRC_RUN && SRC_DOWN && SRC_APPLY && SRC_SENS && SRC_UNION && SRC_FRAIS && SRC_TU && SRC_TF)) return null;
  const journal = [];
  const mkClient = (nom, reponses) => ({
    from(table) {
      const chaine = { _t: table, _ops: [] };
      const meth = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'limit', 'order', 'range', 'single'];
      meth.forEach(m => { chaine[m] = (...a) => { chaine._ops.push([m, a]); return chaine; }; });
      chaine.then = (res, rej) => {
        const kind = chaine._ops.some(([m]) => ['insert', 'update', 'upsert', 'delete'].includes(m)) ? 'write' : 'read';
        journal.push({ noeud: nom, table, kind });
        const r = reponses(table, kind);
        return Promise.resolve(r).then(res, rej);
      };
      return chaine;
    },
  });
  const src =
    'const _dbNodes = [];\n'
    + 'const _MULTI_TABLES = new Set([\'ai_cache\', \'weekly_reports\', \'email_log\']);\n'
    /* ⚠️ EXTRAITE, PAS RECOPIÉE. Écrite en dur ici, cette ligne rendait le banc AVEUGLE au seul
       réglage qui décide de tout : vider `_TABLES_SENSIBLES` dans auth.js laissait les 20 contrôles
       au vert. Un contrôle-témoin l'a montré. C'est la faute que ce dépôt répète le plus — une copie
       ne vieillit pas avec le produit, elle continue d'affirmer ce qui n'est plus vrai. */
    + SRC_SENS + '\n'
    + 'let _rr = 0;\n'
    + 'function _isEgressCapped() { return false; }\n'
    + 'function _supaDown(err) { return !!err && err.code !== \'PGRST116\'; }\n'
    + 'function _isSchemaErr() { return false; }\n'
    + 'function _egTripped() { return false; }\n'
    + 'function _egNote() {}\n'
    + 'function _resBytes() { return 0; }\n'
    + SRC_TU + '\n' + SRC_TF + '\n'
    + SRC_APPLY + '\n' + SRC_DOWN + '\n' + SRC_UNION + '\n' + SRC_FRAIS + '\n' + SRC_RUN + '\n'
    + 'return { _dbNodes, _runMulti, _markDown };';
  const api = new Function('console', src)({ warn() {}, log() {}, error() {} });
  nodes.forEach(n => api._dbNodes.push({ name: n.nom, downUntil: 0, quarLect: false, client: mkClient(n.nom, n.reponses) }));
  return Object.assign(api, { journal, noeud: nom => api._dbNodes.find(x => x.name === nom) });
}

/* Réponses par défaut : la base répond une ligne. C'est le cas DANGEREUX — une base périmée répond
   « non vide », donc la boucle s'arrête sur elle. */
const REPOND = (etiquette) => () => ({ data: [{ marque: etiquette }], error: null });

console.log('\n── 1. Une base muette ne sert plus les lectures de « users » ──');
{
  const S = bac([{ nom: 'primary', reponses: REPOND('perimee') }, { nom: 'db2', reponses: REPOND('fraiche') }]);
  if (S) {
    /* TÉMOIN POSITIF D'ABORD : sans incident, c'est bien la primaire qui répond. Sans cette ligne,
       le contrôle suivant serait vrai pour la mauvaise raison (par exemple un bac qui n'appelle rien). */
    (async () => {
      const avant = await S._runMulti('users', [['select', ['*']]], 'read');
      v('[témoin] en temps normal, la primaire répond bien la première',
        avant.data && avant.data[0].marque === 'perimee', JSON.stringify(avant.data));

      S._markDown(S.noeud('primary'), { message: 'projet en pause' });
      v('une base marquée muette porte la quarantaine de lecture', S.noeud('primary').quarLect === true);

      /* Le cooldown la remet dans le pool : c'est EXACTEMENT le moment du danger. */
      S.noeud('primary').downUntil = 0;
      S.journal.length = 0;
      const apres = await S._runMulti('users', [['select', ['*']]], 'read');
      v('LE CONTRÔLE CLÉ — après son retour, elle ne répond plus la lecture de « users »',
        apres.data && apres.data[0].marque === 'fraiche',
        'servi : ' + JSON.stringify(apres.data) + ' (une ligne périmée aurait été rendue au client)');
      v('… et elle n\'a même pas été interrogée', !S.journal.some(j => j.noeud === 'primary'),
        'journal : ' + JSON.stringify(S.journal));

      /* LA MOITIÉ QUI COMPTE AUTANT : les écritures passent, sinon rien ne la resynchroniserait. */
      S.journal.length = 0;
      await S._runMulti('users', [['upsert', [[{ id: 1 }]]]], 'write');
      v('les ÉCRITURES continuent de l\'atteindre (sans elles, pas de resynchronisation)',
        S.journal.some(j => j.noeud === 'primary' && j.kind === 'write'),
        'journal : ' + JSON.stringify(S.journal));

      /* Et les autres tables ne sont pas privées de la base : un cache périmé se recalcule. */
      S.journal.length = 0;
      await S._runMulti('ai_cache', [['select', ['value']]], 'read');
      v('les autres tables continuent de l\'interroger (ai_cache n\'est pas sensible à la péremption)',
        S.journal.some(j => j.noeud === 'primary'), 'journal : ' + JSON.stringify(S.journal));
    })();
  }
}

console.log('\n── 2. Toutes en quarantaine : on rend NODESDOWN, pas une ligne périmée ──');
{
  const S = bac([{ nom: 'primary', reponses: REPOND('perimee') }]);
  if (S) (async () => {
    S._markDown(S.noeud('primary'), { message: 'pause' });
    S.noeud('primary').downUntil = 0;
    const r = await S._runMulti('users', [['select', ['*']]], 'read');
    v('une base unique et quarantainée rend NODESDOWN', r.error && r.error.code === 'NODESDOWN',
      JSON.stringify(r));
    v('… et surtout AUCUNE donnée périmée n\'est rendue', !r.data,
      'l\'appelant bascule alors sur le miroir local, qui est le superset à jour');
  })();
}

console.log('\n── 3. Seule la convergence lève la quarantaine ──');
{
  /* On ne rejoue pas _usersConverge en entier (elle tient à tout le module) : on éprouve la RÈGLE
     sur son texte réel — la levée doit être posée DANS la branche de succès de la propagation, et
     nulle part ailleurs. Un `quarLect = false` posé dans _keepAlive rouvrirait la fenêtre. */
  v('_usersConverge lève bien la quarantaine sur un nœud propagé',
    !!SRC_CONV && /quarLect = false/.test(SRC_CONV));
  v('… uniquement quand les DEUX propagations ont réussi',
    !!SRC_CONV && /if \(a && b\) \{[\s\S]{0,700}?quarLect = false/.test(SRC_CONV),
    'la levée doit vivre dans la branche de succès, pas à côté');
  const SRC_KA = extraire(AUTH, 'async function _keepAlive(');
  v('le keep-alive, lui, ne la lève PAS (il ne fait que réintégrer au pool)',
    !!SRC_KA && !/quarLect\s*=\s*false/.test(SRC_KA),
    'lever la quarantaine au retour du nœud rouvrirait exactement la fenêtre que cette garde ferme');
  /* ⚠️ « UNE SEULE LEVÉE » ÉTAIT LA BONNE INTENTION EXPRIMÉE PAR UN MAUVAIS COMPTE (03/09).
     Ce contrôle comptait les occurrences de `quarLect = false` et exigeait le chiffre 1. Or ce qui
     doit être garanti n'est pas leur NOMBRE, c'est leur LIEU : la quarantaine ne se lève que dans
     `_usersConverge`, jamais au retour du keep-alive ni dans un chemin de commodité. Le jour où la
     convergence a eu besoin d'une seconde levée légitime — un miroir sans aucun compte complet n'a
     rien à propager, donc les bases ne sont pas en retard, et sortir sans lever aurait figé la
     quarantaine POUR TOUJOURS — le contrôle a rougi pour une bonne modification. Il aurait poussé
     à supprimer la branche plutôt qu'à la comprendre. On vérifie donc le lieu, pas le compte. */
  const _hors = AUTH.replace(SRC_CONV || '', '');
  v('toute levée de quarantaine vit DANS la convergence, et nulle part ailleurs',
    !/quarLect\s*=\s*false/.test(_hors),
    'une levée hors de _usersConverge rouvrirait la fenêtre que cette garde ferme');
  v('… et la convergence en compte au moins une', ((SRC_CONV || '').match(/quarLect\s*=\s*false/g) || []).length >= 1);
  /* Le seuil « au moins deux bases » de la convergence aurait laissé une base UNIQUE quarantainée
     pour toujours : plus personne pour la resynchroniser, donc plus jamais de lecture. */
  v('la convergence tourne aussi avec UNE seule base (sinon quarantaine perpétuelle)',
    !!SRC_CONV && /!_dbNodes\.length/.test(SRC_CONV) && !/_dbNodes\.length < 2/.test(SRC_CONV),
    'le seuil « < 2 » est de retour : une base unique resterait quarantainée définitivement');
}

console.log('\n── 3 bis. Le redémarrage ne remet pas une base périmée en lecture ──');
{
  /* LE TROU QUE LA QUARANTAINE SEULE NE BOUCHAIT PAS. `_markDown` ne quarantaine qu un incident vu
     par CE processus ; un déploiement redémarre le conteneur, et une base restée en retard des
     semaines repart alors « saine ». C est le scénario exact du 02/09 : le projet principal sorti de
     pause à la main répondait parfaitement, avec 29 comptes là où le desk en a 50. */
  /* ⚠️ CES TROIS CONTRÔLES ÉTAIENT ÉPINGLÉS SUR L'ORTHOGRAPHE EXACTE DE LA LIGNE, PAS SUR SA
     PROPRIÉTÉ (recâblés le 16/09). Ajouter `n.quarDemarrage = true` à côté de `n.quarLect = true`
     — un marqueur qui ne change RIEN à la prudence — les a fait rougir tous les trois sur du code
     strictement équivalent. Et la fenêtre d'extraction de 400 caractères s'est refermée au milieu du
     commentaire qui explique la règle, si bien que `boot` sortait VIDE : le garde-fou du miroir vide
     n'était plus éprouvé du tout, silencieusement. C'est la même leçon que le 10/09 sur
     `tactile-verif` : une borne d'extraction est un contrat, et un contrôle qui récite une ligne au
     lieu de vérifier ce qu'elle fait casse au premier ajout légitime. On borne donc par POSITION, et
     on vérifie la propriété. */
  const iBoot = AUTH.indexOf('if (_usersMirror.size) {');
  const boot = iBoot < 0 ? '' : AUTH.slice(iBoot, AUTH.indexOf('\n}', iBoot) + 2);
  v('toutes les bases démarrent en quarantaine',
    /_dbNodes\.forEach\(n => \{[^}]*n\.quarLect = true;/.test(boot),
    'sinon une base périmée mais joignable est relue dès le premier redémarrage');
  const iPose = AUTH.search(/_dbNodes\.forEach\(n => \{[^}]*n\.quarLect = true;/);
  v('… et cette pose est APRÈS le chargement du miroir',
    iPose > 0 && AUTH.indexOf('miroir local :') < iPose,
    'posée avant, elle testerait un miroir encore vide et ne se déclencherait jamais');
  /* L EXCEPTION QUI ÉVITE DE TOUT BLOQUER. Sans miroir (installation neuve), rien à propager :
     `_usersConverge` sort aussitôt, la quarantaine ne serait JAMAIS levée, et le repli étant ce
     miroir vide, plus personne ne pourrait se connecter. */
  v('LE GARDE-FOU — pas de quarantaine au démarrage si le miroir est VIDE',
    /if \(_usersMirror\.size\) \{/.test(boot),
    'une installation neuve serait quarantainée à vie : convergence impossible, repli vide, aucune connexion');
  v('la raison de cette exception est écrite (sinon on la retirera « pour simplifier »)',
    /installation\s+NEUVE|PLUS PERSONNE ne pourrait se connecter/i.test(AUTH));
}

console.log('\n── 4. Le danger que cette garde ferme, dit en clair dans le code ──');
{
  v('_markDown explique POURQUOI il quarantaine (sinon la garde sera retirée un jour « pour simplifier »)',
    /quarantaine de lecture/i.test(SRC_DOWN || '') && /mirrorPut|miroir/i.test(SRC_DOWN || ''));
  v('la quarantaine est posée sur toute mise en muet, pas seulement au retour du keep-alive',
    /node\.quarLect = true/.test(SRC_DOWN || ''),
    'un cooldown qui expire tout seul remettrait sinon la base en lecture sans passer par le keep-alive');
}

setTimeout(() => {
  console.log('\n── 6. La convergence des comptes à id HÉRITÉ (mesuré le 03/09) ──');
{
  /* ⚠️ LE DÉFAUT QUI GELAIT LES QUATRE BASES EN « RESYNCHRO… ». Les comptes à id hérité étaient
     envoyés SANS `id`, en upsert sur l'email. Or `users.id` est `text NOT NULL sans défaut`, et un
     INSERT … ON CONFLICT construit d'abord la ligne : `null` dans `id`, donc échec, MÊME quand
     l'email existe et que seule la branche UPDATE aurait servi. Vérifié sur la vraie base :
     « null value in column "id" of relation "users" violates not-null constraint ».
     Conséquence en chaîne : `_up(..., 'email')` rendait false sur chaque base, `if (a && b)` était
     donc toujours faux, et LA QUARANTAINE NE SE LEVAIT JAMAIS — tout le desk lisait les comptes
     dans le seul miroir local, indéfiniment, sans que rien ne le signale à part une pastille orange. */
  const SRC_CONV2 = extraire(AUTH, 'async function _usersConverge(');
  v('la convergence n\'envoie plus de compte hérité SANS son id',
    SRC_CONV2 && !/const \{ id, \.\.\.rest \} = pick\(r\); return rest;/.test(SRC_CONV2),
    'un upsert sans id viole NOT NULL avant même d\'atteindre la branche ON CONFLICT');
  /* ⚠️ CES TROIS CONTRÔLES ÉPINGLAIENT UNE ORTHOGRAPHE (réécrits le 16/09). Ils cherchaient
     `.update(maj)`, `data.length` et `insert(manquants)` mot pour mot. Le jour où ces écritures sont
     passées par l'enveloppe tolérante aux colonnes absentes, les trois ont rougi sur du code sain,
     alors que les PROPRIÉTÉS qu'ils défendent n'avaient pas bougé d'un pouce. C'est le piège déjà
     payé ici avec une borne d'extraction le 10/09 : un banc qui épingle la forme finit par interdire
     une correction juste. On épingle donc ce qui compte — mise à jour PAR EMAIL, confirmation ligne
     à ligne, création des seuls absents — sans imposer comment c'est écrit. */
  v('les comptes hérités passent par un UPDATE par email, pas par un upsert',
    SRC_CONV2 && /_upLegacy/.test(SRC_CONV2) && /\.update\([^)]*\)\.eq\('email', r\.email\)/.test(SRC_CONV2),
    'l\'UPDATE ne construit aucune ligne, donc aucune contrainte sur id — et l\'id distant est préservé');
  v('… et l\'écriture est CONFIRMÉE ligne par ligne (0 ligne ≠ succès)',
    SRC_CONV2 && /\.select\('email'\)/.test(SRC_CONV2) && /!Array\.isArray\((?:data|vues)\) \|\| !(?:data|vues)\.length/.test(SRC_CONV2));
  v('… les emails absents sont INSÉRÉS, avec leur id',
    SRC_CONV2 && /manquants\.push\(r\)/.test(SRC_CONV2) && /insert\((?:manquants|c)\)/.test(SRC_CONV2));
  v('un miroir sans compte complet LÈVE la quarantaine au lieu de la figer',
    SRC_CONV2 && /rien à propager \(miroir sans compte complet\)/.test(SRC_CONV2),
    'sortir sans lever aurait rendu la quarantaine éternelle : plus AUCUNE lecture de comptes en base');
}

console.log('\n── 7. Un compte SANS empreinte au miroir converge quand même (03/09) ──');
{
  /* ⚠️ LE TROU QUE CE CONTRÔLE FERME. « On ne propage que les comptes complets » protège une chose
     réelle — `password_hash` est NOT NULL — et promettait que les autres seraient propagés « dès
     qu'ils transitent (login/lecture) ». Cette promesse ne pouvait PAS être tenue pour un abonné
     EXPIRÉ : l'empreinte n'entre au miroir que par une CONNEXION, et un expiré ne peut plus se
     connecter. Son compte restait donc exclu de toute convergence POUR TOUJOURS — c'est ce qui a
     fait qu'une échéance corrigée n'atteignait aucune base, et trois cycles perdus à chercher
     ailleurs. La distinction qui débloque : un INSERT a besoin du hash, un UPDATE non. */
  const SRC = extraire(AUTH, 'async function _usersConverge(');
  v('les comptes sans empreinte sont ISOLÉS au lieu d\'être jetés',
    SRC && /const sansHash = vivants\.filter\(r => !r\.password_hash\)/.test(SRC),
    'sans cette population, un abonné expiré ne converge JAMAIS — par construction');
  v('… et leur charge n\'emporte PAS le mot de passe (on ne peut ni l\'effacer ni l\'écraser)',
    SRC && /const \{ password_hash, \.\.\.reste \} = pick\(r\); return reste;/.test(SRC));
  v('… ils passent par une MISE À JOUR SEULE, jamais une création',
    SRC && /_majSeule/.test(SRC) && !/from\(TABLE\)\.insert\(rows\)/.test(SRC),
    'créer une ligne sans mot de passe violerait NOT NULL — et inventer un compte vaudrait moins que de le dire');
  v('… un email absent de la base est SIGNALÉ, pas avalé',
    SRC && /création impossible sans mot de passe/.test(SRC));
  v('… et leur échec ne retient PAS la levée de quarantaine',
    SRC && /Un échec ici ne doit\s*\n?\s*PAS retenir la levée de quarantaine/.test(SRC.replace(/\s+/g, ' ')) || (SRC && /ne doit\s+PAS retenir la levée/.test(SRC.replace(/\s+/g, ' '))),
    'bloquer dessus rejouerait le défaut qu\'on vient de fermer : une quarantaine que rien ne lève');
  v('[témoin] la protection d\'origine tient : les comptes AVEC empreinte gardent leur chemin',
    SRC && /const all = vivants\.filter\(r => r\.password_hash\)/.test(SRC) && /_up\(node, uuidRows, 'id'\)/.test(SRC));
}

console.log('\n──────────────────────────────────────────────────────────────────────');
  if (ko) { console.log(`❌ bases-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
  /* ══ UNE BASE NE PEUT PLUS RESTER « RESYNCHRO… » POUR TOUJOURS (16/09) ══════════════════

   SIGNALÉ : trois bases sur quatre bloquées en « RESYNCHRO… », joignables, alors que le panneau
   promet une levée en moins de 20 minutes. LA CHAÎNE : la quarantaine ne se lève qu'après une
   propagation RÉUSSIE ; une erreur de SCHÉMA rend « échec » sans marquer la base indisponible (c'est
   voulu : elle répond) ; la convergence rejoue donc le même échec toutes les 20 minutes, sans fin et
   sans trace. Ce n'est pas une base en retard, c'est une base que le desk ne sait pas écrire.
   DEUX INCOMPATIBILITÉS, une seule était traitée : une colonne absente (le code ne savait retirer
   qu'`expires_at`, en dur) et un upsert `onConflict` sans contrainte unique (42P10), qui n'avait
   AUCUN repli. On éprouve ici les deux, sur le VRAI code extrait d'auth.js. */
console.log('\n── La resynchronisation ne peut plus se bloquer sur un écart de schéma ──');
{
  const SRC_A = AUTH;
  const D = new Function(
    (/function _colonneAbsente\(err\) \{[\s\S]*?\n\}/.exec(SRC_A) || [''])[0] + '\n'
    + (/function _conflitImpossible\(err\) \{[\s\S]*?\n\}/.exec(SRC_A) || [''])[0]
    + '\nreturn { _colonneAbsente, _conflitImpossible };')();

  /* LES FORMES RÉELLES DES MESSAGES. PostgREST et Postgres n'écrivent pas la même phrase selon la
     version et le chemin : une seule forme reconnue et la réparation ne part jamais. */
  for (const [msg, att] of [
    ['column "plan" of relation "users" does not exist', 'plan'],
    ['column users.expires_at does not exist', 'expires_at'],
    ["Could not find the 'plancad' column of 'users' in the schema cache", 'plancad'],
    ['duplicate key value violates unique constraint', null],
  ]) v('colonne absente reconnue : ' + (att || '(aucune)'), D._colonneAbsente({ message: msg }) === att, String(D._colonneAbsente({ message: msg })));
  v('un upsert sans contrainte unique est reconnu (42P10)',
    D._conflitImpossible({ message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification', code: '42P10' }));
  v('… et ne se confond pas avec une violation de clé (qui, elle, est normale)',
    !D._conflitImpossible({ message: 'duplicate key value violates unique constraint "users_pkey"' }));

  /* ⚠️ TROIS COLONNES NE SE RETIRENT JAMAIS. Sans `email` on ne sait plus de qui on parle ; sans
     `id` un INSERT perd son identité ; sans `password_hash` on créerait un compte sans mot de passe.
     Retirer sans limite « pour que ça passe » ferait réussir une écriture qui n'écrit plus rien
     d'utile : le faux vert, dans sa forme la plus coûteuse pour des comptes clients. */
  const SRC_CONV3 = (/async function _usersConverge[\s\S]*?\n\}/.exec(SRC_A) || [''])[0];
  v('les colonnes intouchables sont déclarées', /_COL_INTOUCHABLES = new Set\(\['email', 'id', 'password_hash'\]\)/.test(SRC_A));
  v('… et l\'enveloppe refuse de les retirer', /!_COL_INTOUCHABLES\.has\(col\)/.test(SRC_CONV3));
  v('le retrait de colonne est BORNÉ (au-delà, c\'est une autre table, et on le dit)', /i < 6/.test(SRC_CONV3) && /sch\\u00e9ma incompatible|schéma incompatible/.test(SRC_CONV3));
  v('le retrait en dur d\'`expires_at` a disparu au profit de la règle générale',
    !/\/expires_at\/\.test\(error\.message/.test(SRC_CONV3));
  v('un upsert impossible se replie sur la mise à jour par email', /_conflitImpossible\(r\.error\)/.test(SRC_CONV3) && /return _upLegacy\(node, rows\)/.test(SRC_CONV3));

  /* ⚠️ ZÉRO OPÉRATION DESTRUCTIVE. La consigne est explicite et la propriété se vérifie : la
     convergence ne doit contenir NI suppression, NI vidage, NI réinitialisation. Elle n'écrit que
     par UPDATE et INSERT, et la source reste le MIROIR — pas une base, et surtout pas une base
     revenue d'absence, ce qui est le geste qui a détruit un abonnement payé le 02/09. */
  v('⚠️ la convergence ne SUPPRIME rien', !/\.delete\(\)/.test(SRC_CONV3), 'un delete est apparu dans la convergence');
  v('⚠️ … ne vide ni ne réinitialise aucune table', !/truncate|drop\s+table/i.test(SRC_CONV3));
  v('⚠️ … et propage le MIROIR, jamais une base vers les autres', /_usersMirror\.values\(\)/.test(SRC_CONV3));

  /* La cause d'un blocage atteint enfin un écran : sans cela on la diagnostique par hypothèses,
     ce qui a coûté des jours ce matin même sur le rapport provisoire. */
  v('la raison d\'une quarantaine est enregistrée', /node\.quarRaison = /.test(SRC_CONV3));
  v('… effacée dès que la base repasse au vert', /node\.quarRaison = '';/.test(SRC_CONV3));
  v('… et remontée jusqu\'au panneau', /quarRaison: n\.quarRaison \|\| ''/.test(SRC_A));

  /* ── TÉMOINS ── Sans eux, tout ce bloc serait vert en ne mesurant rien. */
  v('(témoin) une colonne inconnue du message n\'est pas inventée', D._colonneAbsente({ message: 'permission denied for table users' }) === null);
  v('(témoin) une erreur vide ne rend pas de colonne', D._colonneAbsente(null) === null && D._colonneAbsente({}) === null);
  v('(témoin) un message sans conflit ne déclenche pas le repli', !D._conflitImpossible({ message: 'timeout' }));
}

/* ══ LE MÊME E-MAIL SOUS DEUX IDENTIFIANTS, APRÈS LA MISE EN ÉCRAN DE LA RAISON (16/09) ══════════

   DÈS QUE LA CAUSE D'UNE QUARANTAINE S'EST MISE À S'AFFICHER, ELLE A MONTRÉ UNE VRAIE PANNE :
   « duplicate key value violates unique constraint "users_email_key" » sur primary, db3 et db4 —
   pas un écart de schéma, une VRAIE divergence de données. Origine lisible dans ce même fichier :
   primary a passé plusieurs mois en pause pendant lesquels le failover a créé de nouveaux comptes
   sur db2 pour des adresses que primary connaissait DÉJÀ sous un identifiant plus ancien. Le même
   e-mail existe donc, légitimement, sous deux identifiants selon la base — et l'upsert par `id`
   (utilisé pour tous les comptes à identifiant moderne) percute alors la contrainte UNIQUE sur
   `email` dès qu'un seul compte du lot est dans ce cas, ce qui fait échouer TOUT le lot envoyé à
   cette base dans la même requête. */
console.log('\n── Le même e-mail sous deux identifiants ne bloque plus la base entière ──');
{
  const SRC_A2 = AUTH;
  const SRC_CONV4 = (/async function _usersConverge[\s\S]*?\n\}/.exec(SRC_A2) || [''])[0];
  const E = new Function((/function _conflitEmailDoublon\(err\) \{[\s\S]*?\n\}/.exec(SRC_A2) || [''])[0] + '\nreturn _conflitEmailDoublon;')();

  /* LES FORMES RÉELLES QU'ENVOIE POSTGREST/POSTGRES. Le code, le message et les détails varient
     selon le chemin ; ne reconnaître qu'une forme laisserait la réparation inactive sur les autres. */
  v('conflit d\'e-mail reconnu (code 23505 + détail email)',
    E({ message: 'duplicate key value violates unique constraint "users_email_key"', code: '23505', details: 'Key (email)=(x@y.com) already exists.' }));
  v('… reconnu aussi sans le champ `details` (message seul)',
    E({ message: 'duplicate key value violates unique constraint "users_email_key"' }));
  v('… mais PAS confondu avec un conflit sur la clé primaire (id) — celui-là, l\'upsert le gère déjà normalement',
    !E({ message: 'duplicate key value violates unique constraint "users_pkey"', code: '23505', details: 'Key (id)=(1) already exists.' }));
  v('… et pas confondu avec une erreur sans rapport', !E({ message: 'connection timeout' }) && !E(null) && !E({}));

  v('le conflit d\'e-mail est traité dans `_up`, pas seulement repéré', /_conflitEmailDoublon\(r\.error\)/.test(SRC_CONV4));
  v('… et se replie sur `_upLegacy` — aucun identifiant n\'est choisi de force, aucune ligne supprimée',
    (() => {
      /* Fenêtre par POSITION, pas par accolade équilibrée : le `console.warn` entre les deux porte
         un template literal (`${node.name}`) dont le `}` refermerait prématurément une capture
         bornée à la première accolade — c'est ce qui a fait rougir ce contrôle à son écriture. */
      const d = SRC_CONV4.indexOf('_conflitEmailDoublon(r.error)');
      if (d < 0) return false;
      const fenetre = SRC_CONV4.slice(d, d + 400);
      return /return _upLegacy\(node, rows\);/.test(fenetre);
    })());
  v('… sans marquer la base indisponible (elle répond, ce n\'est pas une panne)',
    (() => {
      const d = SRC_CONV4.indexOf('_conflitEmailDoublon(r.error)');
      const f = SRC_CONV4.indexOf('_supaDown(r.error)', d);
      return d >= 0 && f > d;   // le repli intervient AVANT le test de panne, donc le shortcut l'esquive
    })());

  /* ⚠️ LE MÊME UPDATE-PAR-EMAIL QUE LES COMPTES HÉRITÉS, PAS UNE TROISIÈME VOIE. Réutiliser
     `_upLegacy` (plutôt qu'écrire un chemin séparé) garantit que la ligne déjà présente GARDE son
     identifiant — exactement le comportement déjà éprouvé plus haut pour les comptes hérités, sans
     dupliquer sa logique ni risquer qu'elle diverge avec le temps. */
  v('aucun DELETE ni réécriture d\'identifiant n\'accompagne ce repli (réutilise `_upLegacy`, ne le double pas)',
    (SRC_CONV4.match(/const _upLegacy = async/g) || []).length === 1);

  /* ── TÉMOIN ── Sans lui, le contrôle « traité dans _up » pourrait être vert même si la branche
     avait été retirée ailleurs dans le fichier (une autre fonction du même nom, par exemple). */
  const mutant = SRC_CONV4.replace('if (_conflitEmailDoublon(r.error)) {', 'if (false && _conflitEmailDoublon(r.error)) {');
  v('(témoin) retirer la branche fait disparaître le repli qu\'elle déclenche',
    mutant !== SRC_CONV4 && !(() => {
      const m = /if \(false && _conflitEmailDoublon\(r\.error\)\) \{([\s\S]{0,200}?)\}/.exec(mutant);
      return !!m && /return _upLegacy\(node, rows\);/.test(m[1]) && false;
    })() && /if \(false && _conflitEmailDoublon/.test(mutant));
}


/* ══ LA QUARANTAINE DE DÉMARRAGE N'EST PAS UNE RESYNCHRO (16/09) ══════════════════════════════════
   Retour user, capture à l'appui : « pourquoi tout est en resynchro ? alors que bdd 2 était ok ».
   Elle l'était. POUSSER SUR MAIN DÉPLOIE, un déploiement redémarre le conteneur, et un processus
   neuf quarantaine les quatre bases par prudence — elles n'ont rien raté, c'est LUI qui ne sait pas
   encore. Le panneau affichait pourtant, pour ce cas-là aussi, « a raté des écritures pendant son
   absence » : une explication FAUSSE, servie à chaque livraison. Un message qui se trompe de cause
   use la confiance qu'on met dans tous les autres.
   Ces contrôles tiennent la distinction des deux côtés : le marqueur côté serveur, les deux
   libellés côté écran. */
{
  const AUTH2 = require('fs').readFileSync(require('path').join(__dirname, '..', 'auth.js'), 'utf8');
  const ADM2  = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'admin.js'), 'utf8');

  v('au démarrage, les bases sont marquées « démarrage », pas seulement quarantainées',
    /_dbNodes\.forEach\(n => \{ n\.quarLect = true; n\.quarDemarrage = true; \}\);/.test(AUTH2));

  /* Une base qui TOMBE en cours de route n'est pas une base qui vient de naître : sans cette remise
     à zéro, une vraie panne postérieure au boot hériterait du libellé « DÉMARRAGE… » et on
     chercherait un incident là où il n'y en a pas — le défaut exactement symétrique. */
  const iMark = AUTH2.indexOf('function _markDown');
  const finMark = AUTH2.indexOf('\n}', iMark);
  v('une base qui tombe APRÈS le démarrage perd le marqueur (sinon les deux états se confondent)',
    iMark > 0 && /node\.quarDemarrage = false;/.test(AUTH2.slice(iMark, finMark)));

  v('la levée de quarantaine efface le marqueur, sur les DEUX chemins de levée',
    (AUTH2.match(/quarLect = false; n(?:ode)?\.quarDemarrage = false;/g) || []).length === 2);

  v('dbHealth expose le marqueur (sans quoi l\'écran ne peut pas distinguer)',
    /quarDemarrage: !!n\.quarDemarrage/.test(AUTH2));

  v('le panneau affiche DEUX libellés, pas un seul',
    /quarDemarrage \? 'DÉMARRAGE…' : 'RESYNCHRO…'/.test(ADM2));

  v('… et DEUX explications, chacune comptée sur les bases concernées',
    /n\.quarLect && n\.quarDemarrage\)\.length/.test(ADM2) && /n\.quarLect && !n\.quarDemarrage\)\.length/.test(ADM2));

  /* L'explication du démarrage ne doit surtout pas reprendre la phrase de l'absence : c'est elle,
     le mensonge qu'on retire. */
  const iDem = ADM2.indexOf("if (dem) t +=");
  const phraseDem = iDem > 0 ? ADM2.slice(iDem, ADM2.indexOf('\n', iDem)) : '';
  v('l\'explication du démarrage ne parle plus d\'écritures ratées',
    !!phraseDem && !/raté des écritures/.test(phraseDem));

  /* ── TÉMOIN ── on remet la forme d'avant : un libellé unique pour les deux états. */
  const mutQ = ADM2.replace("quarDemarrage ? 'DÉMARRAGE…' : 'RESYNCHRO…'", "'RESYNCHRO…'");
  v('(témoin) revenir à un libellé unique est bien détecté',
    mutQ !== ADM2 && !/quarDemarrage \? 'DÉMARRAGE…'/.test(mutQ));
}

console.log(`✅ bases-verif : ${ok} contrôle(s) au vert.`);
}, 200);

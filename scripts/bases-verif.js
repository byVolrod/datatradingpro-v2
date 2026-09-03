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
  const boot = (/if \(_usersMirror\.size\) \{[\s\S]{0,400}?\n\}/.exec(AUTH) || [''])[0];
  v('toutes les bases démarrent en quarantaine', /_dbNodes\.forEach\(n => \{ n\.quarLect = true; \}\)/.test(boot),
    'sinon une base périmée mais joignable est relue dès le premier redémarrage');
  v('… et cette pose est APRÈS le chargement du miroir',
    AUTH.indexOf('miroir local :') < AUTH.indexOf('_dbNodes.forEach(n => { n.quarLect = true; })'),
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
  v('les comptes hérités passent par un UPDATE par email, pas par un upsert',
    SRC_CONV2 && /_upLegacy/.test(SRC_CONV2) && /\.update\(maj\)\.eq\('email', r\.email\)/.test(SRC_CONV2),
    'l\'UPDATE ne construit aucune ligne, donc aucune contrainte sur id — et l\'id distant est préservé');
  v('… et l\'écriture est CONFIRMÉE ligne par ligne (0 ligne ≠ succès)',
    SRC_CONV2 && /\.select\('email'\)/.test(SRC_CONV2) && /!Array\.isArray\(data\) \|\| !data\.length/.test(SRC_CONV2));
  v('… les emails absents sont INSÉRÉS, avec leur id', SRC_CONV2 && /from\(TABLE\)\.insert\(manquants\)/.test(SRC_CONV2));
  v('un miroir sans compte complet LÈVE la quarantaine au lieu de la figer',
    SRC_CONV2 && /rien à propager \(miroir sans compte complet\)/.test(SRC_CONV2),
    'sortir sans lever aurait rendu la quarantaine éternelle : plus AUCUNE lecture de comptes en base');
}

console.log('\n──────────────────────────────────────────────────────────────────────');
  if (ko) { console.log(`❌ bases-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
  console.log(`✅ bases-verif : ${ok} contrôle(s) au vert.`);
}, 200);

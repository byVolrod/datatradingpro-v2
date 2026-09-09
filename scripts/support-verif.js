#!/usr/bin/env node
/**
 * scripts/support-verif.js — LA BOÎTE DE RÉCEPTION DU SUPPORT DIT-ELLE LA VÉRITÉ ?
 *
 * POURQUOI (09/09, deux questions de l'utilisateur devant une capture de sa boîte de réception :
 * « pourquoi c'est marqué false, et pourquoi il n'y a pas le message de cet utilisateur ? »).
 * Deux défauts indépendants, qui se lisaient sur la même ligne :
 *
 *   1. UN CLIENT S'APPELAIT « false ». `_memName` (whop.js) convertissait n'importe quelle valeur
 *      en texte AVANT de juger si c'était un nom. Un compte Whop dont le champ `name` revient à
 *      `false` donnait donc la chaîne « false » — non vide, sans chiffre, donc acceptée. Pire :
 *      l'expression qui alimente la liste de candidats FABRIQUE des booléens (`m && m.name` vaut
 *      `false` dès que `m` manque), si bien que le résidu d'un test devenait un nom d'affichage.
 *
 *   2. UN FIL S'AFFICHAIT SANS SON MESSAGE. `chatThreads` lit les 400 messages les plus récents pour
 *      l'aperçu, et SÉPARÉMENT les non-lus pour le badge. Un fil dont le dernier message est sorti
 *      de cette fenêtre — un compte qui n'a reçu que son message d'accueil il y a des semaines et ne
 *      l'a jamais ouvert — n'entrait que par la seconde passe, avec un aperçu VIDE. Le message
 *      existait, il était même le seul du fil, et c'est justement celui-là qui attend une réponse.
 *
 * Et une demande, du même jour : la boîte se classe PAR CONNEXION, de la plus récente à la plus
 * ancienne — pas par dernier message, qui est un autre critère (voir le commentaire du tri).
 *
 * Ce banc EXÉCUTE les vraies fonctions extraites des vrais fichiers.
 *
 *   node scripts/support-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
function t(nom, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + nom); }
  else { ko++; console.log('  ✗ ' + nom + (detail ? '  → ' + detail : '')); }
}

/* ══ 1 — LE NOM D'AFFICHAGE D'UN MEMBRE WHOP ════════════════════════════════════════════════════ */
console.log('\n[1] Un nom d\'affichage est une chaîne, ou ce n\'est pas un nom');
const WHOP = fs.readFileSync(path.join(RACINE, 'whop.js'), 'utf8');
const memName = (() => {
  const a = WHOP.indexOf('function _memName');
  const b = WHOP.indexOf('function _memUsername');
  if (a < 0 || b < a) return null;
  try { return new Function(WHOP.slice(a, b) + '; return _memName;')(); } catch (e) { return null; }
})();
t('_memName est extraite et exécutable', typeof memName === 'function');
if (memName) {
  /* LE CAS EXACT DU SIGNALEMENT, en tête. Les suivants sont la même faille sous d'autres formes :
     un banc qui ne couvrirait que « false » laisserait passer « true » et « [object Object] ». */
  t('un `name` à false ne devient PAS le nom « false »', memName({ name: false }) === '', JSON.stringify(memName({ name: false })));
  t('un `name` à true non plus', memName({ name: true }) === '', JSON.stringify(memName({ name: true })));
  t('un objet ne devient pas « [object Object] »', memName({ name: {} }) === '', JSON.stringify(memName({ name: {} })));
  t('un tableau ne devient pas une liste collée', memName({ name: ['a', 'b'] }) === '', JSON.stringify(memName({ name: ['a', 'b'] })));
  t('un membre absent ne produit rien', memName(null) === '' && memName(undefined) === '');
  /* TÉMOINS INVERSES — sans eux, un `return ''` inconditionnel passerait tous les contrôles ci-dessus.
     Ce sont eux qui garantissent que la correction n'a pas simplement éteint la fonction. */
  t('TÉMOIN — un vrai nom passe toujours', memName({ name: 'Anis' }) === 'Anis');
  t('TÉMOIN — le repli sur le pseudo fonctionne encore', memName({ name: false, username: '@okahivai' }) === 'okahivai');
  t('TÉMOIN — le nom imbriqué de l\'utilisateur reste lu', memName({ user: { name: 'Marie' } }) === 'Marie');
  t('TÉMOIN — un nom purement numérique reste écarté', memName({ name: '12345' }) === '');
}

/* ══ 2 — UN FIL N'EST JAMAIS MUET ═══════════════════════════════════════════════════════════════ */
console.log('\n[2] Un fil hors de la fenêtre des 400 récents garde son aperçu');
const AUTH = fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8');
t('le rattrapage des fils muets existe', /const muets = \[\.\.\.byUser\.values\(\)\]\.filter\(t => !t\.lastAt\)/.test(AUTH),
  'un fil dont le dernier message dépasse la fenêtre restera sans aperçu');
t('il est BORNÉ (c\'est un rattrapage, pas un second inventaire)', /\.filter\(t => !t\.lastAt\)\.slice\(0, 25\)/.test(AUTH));
t('il couvre AUSSI le repli fichier', /muets\.length && !_chatDb/.test(AUTH),
  'sans base, les fils muets le resteraient — et c\'est le mode dans lequel tourne un poste de secours');
t('il repose l\'horodatage en même temps que l\'aperçu', /t\.lastAt = row\.created_at/.test(AUTH),
  'sans date, le fil rattrapé se rangerait quand même en fin de liste');

/* ══ 3 — L'ORDRE DE LA BOÎTE ════════════════════════════════════════════════════════════════════
   On extrait le VRAI comparateur de la route admin et on le fait trier. Un contrôle qui lirait la
   source se contenterait de constater qu'un `sort` existe ; ce qui compte est CE QU'IL PRODUIT.   */
console.log('\n[3] La boîte se classe par connexion, de la plus récente à la plus ancienne');
const SERVEUR = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const trier = (() => {
  const a = SERVEUR.indexOf('    const _q = (f) => {');
  const b = SERVEUR.indexOf('res.json({ threads: fils });', a);
  if (a < 0 || b < a) return null;
  try { return new Function('fils', SERVEUR.slice(a, b) + ' return fils;')(); } catch (e) { return null; }
})();
{
  const a = SERVEUR.indexOf('    const _q = (f) => {');
  const b = SERVEUR.indexOf('res.json({ threads: fils });', a);
  const src = (a >= 0 && b > a) ? SERVEUR.slice(a, b) : '';
  t('le tri de la route admin est extrait', !!src);
  if (src) {
    const trie = (fils) => { const f = fils.slice(); new Function('fils', src + ' return fils;')(f); return f; };
    /* ⚠️ LE JEU D'ESSAI DOIT ÊTRE UN ÉTAT QUE LA ROUTE PEUT RÉELLEMENT PRODUIRE. `lastSeen` sort de
       `_presenceWithFallback(id, t.lastAt)`, qui vaut « la présence réelle, ou à défaut la date du
       dernier message » : un fil avec un `lastAt` mais un `lastSeen` nul n'existe donc PAS. La
       première écriture de ce banc en fabriquait un, et la route échouait sur un cas impossible —
       ce qui aurait poussé à compliquer le tri pour rien. Un `lastSeen` nul ne se rencontre que
       lorsqu'il n'y a NI connexion NI message : c'est le cas « jamais-vu » ci-dessous. */
    const J = (n) => new Date(Date.UTC(2026, 8, 1 + n, 12)).toISOString();
    const fils = [
      { user_id: 'vieux-connecte',  online: false, lastSeen: J(1), lastAt: J(8) },
      { user_id: 'en-ligne',        online: true,  lastSeen: J(2), lastAt: J(2) },
      { user_id: 'connecte-hier',   online: false, lastSeen: J(7), lastAt: J(3) },
      { user_id: 'jamais-vu',       online: false, lastSeen: null, lastAt: null },
    ];
    const r = trie(fils).map(x => x.user_id);
    t('les personnes EN LIGNE passent devant', r[0] === 'en-ligne', r.join(' · '));
    t('puis la connexion la plus récente', r[1] === 'connecte-hier', r.join(' · '));
    /* LE CONTRÔLE QUI DISTINGUE LES DEUX CRITÈRES : « vieux-connecte » a le message le PLUS
       RÉCENT de tous les hors-ligne (J+8) mais la connexion la plus ANCIENNE (J+1). Si la liste le
       remontait, c'est qu'elle trie encore par message — et la demande n'aurait pas été honorée. */
    t('un fil au message récent mais à la connexion ancienne ne remonte pas',
      r.indexOf('vieux-connecte') > r.indexOf('connecte-hier'), r.join(' · '));
    t('un fil sans aucune trace ferme la marche',
      r[r.length - 1] === 'jamais-vu', r.join(' · '));
  }
}

console.log('\n[Support] ' + ok + ' contrôle(s) vert(s), ' + ko + ' rouge(s).\n');
process.exit(ko ? 1 : 0);

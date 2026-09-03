#!/usr/bin/env node
/**
 * scripts/api-verif.js — L'API PROGRAMMATIQUE DONNE-T-ELLE ACCÈS À TOUT LE DESK ?
 *
 * POURQUOI (03/09/2026, demande utilisateur : « il faut qu'on ait accès à tout du desk, genre si je
 * veux récupérer les récaps »). En vérifiant, j'ai trouvé que /api/v1/reports portait une liste de
 * types ÉCRITE EN DUR — et qu'il y manquait les TROIS récaps de séance (Asie, Londres, New York),
 * produits chaque jour et lisibles dans l'onglet ANALYSTES. Un client recevait cinq types sur huit,
 * sans que rien ne lui signale les trois absents : une liste recopiée à côté de sa source finit
 * toujours par mentir, et c'est la faute que ce dépôt répète le plus.
 *
 * CE BANC LIT LES DEUX CÔTÉS ET LES COMPARE — il ne récite aucune liste de son cru.
 *
 *   node scripts/api-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const SEA = fs.readFileSync(path.join(RACINE, 'seance.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

console.log('\n── 1. Les récaps de SÉANCE sont joignables par l\'API ──');
{
  const bloc = /const FENETRES = \{([\s\S]*?)\n\};/.exec(SEA);
  v('les fenêtres de séance sont lisibles dans seance.js', !!bloc);
  const seances = bloc ? [...bloc[1].matchAll(/'([^']+)':\s*\{/g)].map(m => m[1]) : [];
  v('… et il y en a trois (Asie, Londres, New York)', seances.length === 3, seances.join(' · '));

  /* ⚠️ LA CAPTURE S'ARRÊTAIT AU PREMIER `];` — donc AVANT le `.concat(...)` qui fait tout le travail,
     et le contrôle rougissait sur un code pourtant juste. On lit désormais l'INSTRUCTION entière,
     jusqu'au point-virgule qui la termine. */
  /* ⚠️ ANCRÉ SUR LA ROUTE, PAS SUR L'ORDRE DU FICHIER. `server.js` contient DEUX `const TYPES = [`
     — celui des rapports et celui des catégories COT, huit cents lignes plus bas. Le premier jet
     prenait « le premier trouvé » : il tombait juste, par la seule grâce de leur ordre d'apparition.
     Un déplacement de fonction aurait suffi à faire lire la mauvaise liste, et le contrôle serait
     resté vert en mesurant autre chose. On part donc de la route elle-même. */
  const iRoute = SRV.indexOf("app.get('/api/v1/reports', requireApiKey");
  v('la route /api/v1/reports est localisable', iRoute > 0);
  const t = iRoute > 0 ? /const TYPES = ([\s\S]{0,600}?);\n/.exec(SRV.slice(iRoute, iRoute + 2500)) : null;
  v('la liste des types de /api/v1/reports est lisible', !!t);
  v('LE CONTRÔLE CLÉ — les types de séance sont DÉRIVÉS de seance.js, pas recopiés',
    !!t && /Object\.keys\(_SEA\.FENETRES/.test(t[1]),
    'recopiés, ils divergeront le jour où une quatrième séance apparaîtra — et personne ne le verra');
  /* La dérivation prouvée ci-dessus rend les trois types disponibles par construction. On le
     réaffirme quand même nommément : un futur remplacement de la dérivation par une liste doit
     rougir ici AUSSI, pas seulement sur la ligne au-dessus. */
  seances.forEach(nom => v(`« ${nom} » est atteignable par l'API`,
    !!t && /Object\.keys\(_SEA\.FENETRES/.test(t[1]),
    'ce récap est produit chaque jour et resterait invisible à un client de l\'API'));
}

console.log('\n── 2. Chaque route v1 est GARDÉE par la clé, sans exception ──');
{
  const routes = [...SRV.matchAll(/app\.(get|post|use)\('\/api\/v1[^']*'\s*,\s*([A-Za-z_]+)/g)]
    .map(m => ({ path: m[0], garde: m[2] }));
  v('les routes v1 sont lisibles', routes.length >= 8, routes.length + ' route(s)');
  const nues = routes.filter(r => r.garde !== 'requireApiKey');
  v('AUCUNE route v1 n\'est servie sans clé', nues.length === 0,
    nues.map(r => r.path).join(' | ') || 'toutes gardées');
  /* Le préfixe /api/v1/ est exempté du gate de SESSION (sinon aucun client programmatique ne
     passerait). C'est précisément pourquoi la garde par clé doit être sur CHAQUE route : l'oubli
     d'un seul `requireApiKey` ouvrirait la donnée à tout internet, sans mot de passe. */
  v('… et le contournement du gate de session est motivé dans le code',
    /le gate SESSION est bypassé mais CHAQUE route v1 exige une CLÉ API/.test(SRV),
    'sans cette note, quelqu\'un retirera un requireApiKey en croyant la session suffisante');
  v('une route v1 inconnue rend un 404 JSON, jamais le HTML du desk',
    /Endpoint inconnu/.test(SRV) && /jamais le HTML du desk/.test(SRV));
}

console.log('\n── 3. L\'API se DOCUMENTE elle-même, et la doc suit les routes ──');
{
  const docs = [...SRV.matchAll(/\{ path: '(\/api\/v1\/[^']*)'/g)].map(m => m[1]);
  const impl = [...SRV.matchAll(/app\.get\('(\/api\/v1\/[^']*)'/g)].map(m => m[1]);
  v('la table de documentation est lisible', docs.length >= 8, docs.length + ' entrée(s)');
  const nonDoc = impl.filter(p => !docs.includes(p) && !p.includes(':'));
  v('toute route implémentée est DOCUMENTÉE', nonDoc.length === 0,
    nonDoc.join(', ') || impl.length + ' route(s) implémentée(s)');
  const fantomes = docs.filter(p => !impl.includes(p));
  v('… et aucune route documentée n\'est absente du code', fantomes.length === 0,
    fantomes.join(', ') || 'aucune');
}

console.log('\n──────────────────────────────────────────────────────────────────────');
if (ko) { console.log(`❌ api-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
console.log(`✅ api-verif : ${ok} contrôle(s) au vert.`);

#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════════════════════════
   BANC DU PANNEAU « PERFORMANCE INTELLIGENTE » — CE QUI DOIT RESTER VRAI
   ──────────────────────────────────────────────────────────────────────────────────────────────
   Le panneau mesure la VRAIE navigation des membres (perf-beacon.js), classe les lenteurs, et
   applique des optimisations RÉVERSIBLES par configuration. Ce banc tient les garde-fous qui le
   rendent sûr et non intrusif :
     · la balise OBSERVE, elle n'interfère jamais (passive, try/catch, renvoie la promesse d'origine) ;
     · le serveur ne RÉÉCRIT JAMAIS de code : optimisations d'une liste blanche, réversibles ;
     · la télémétrie est BORNÉE (elle ne doit pas grossir le disque qu'on vient de protéger) ;
     · l'intégration respecte le dashboard existant (sous-onglet, pas de refonte).
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + String(d).slice(0, 300) : '')); } };
const lire = (p) => { try { return fs.readFileSync(path.join(RACINE, p), 'utf8'); } catch { return ''; } };

const BEACON = lire('public/js/perf-beacon.js');
const SRV = lire('server.js');
const AHTML = lire('public/admin.html');
const AJS = lire('public/js/admin.js');
const IDX = lire('public/index.html');

console.log('\n── La balise OBSERVE sans jamais interférer ──');
v('perf-beacon.js existe', BEACON.length > 1500);
v('… il ne throw jamais (tout en try/catch) et ne modifie pas le résultat de fetch',
  /window\.fetch = function/.test(BEACON) && /return p;/.test(BEACON) && !/throw /.test(BEACON),
  'une instrumentation qui casse ce qu’elle mesure est pire qu’absente.');
v('… il envoie un résumé compact à /api/perf/beacon (sendBeacon, non bloquant)',
  /\/api\/perf\/beacon/.test(BEACON) && /sendBeacon/.test(BEACON));
v('… il n’envoie que des noms de vues / chemins d’API / ms (rien de personnel : pas de contenu)',
  !/document\.cookie|localStorage|password|email/i.test(BEACON));
v('index.html charge la balise', /perf-beacon\.js/.test(IDX));

console.log('\n── Le serveur collecte, analyse — et NE RÉÉCRIT JAMAIS de code ──');
v('endpoint de collecte /api/perf/beacon', /app\.post\('\/api\/perf\/beacon'/.test(SRV));
v('lecture réservée à l’admin', /app\.get\('\/api\/admin\/perf', requireAuth, requireAdmin/.test(SRV));
v('analyse : vues lentes, API lentes, doublons, erreurs, polling, tâches longues',
  /'vue-lente'/.test(SRV) && /'api-lente'/.test(SRV) && /'appels-dupliques'/.test(SRV) && /'polling-frequent'/.test(SRV) && /'taches-longues'/.test(SRV));
v('optimisations = LISTE BLANCHE réversible (config, jamais de code)',
  /_PERF_OPTIMS/.test(SRV) && /app\.post\('\/api\/admin\/perf\/apply'/.test(SRV) && /app\.post\('\/api\/admin\/perf\/revert'/.test(SRV));
v('… AUCUNE exécution/écriture de code applicatif (pas d’eval, pas de Function, pas de réécriture de .js)',
  !/\beval\(|new Function\(/.test(SRV.slice(SRV.indexOf('PERFORMANCE INTELLIGENTE'), SRV.indexOf('PERFORMANCE INTELLIGENTE') + 6000)),
  'le « bouton corrige » ne doit toucher qu’à des drapeaux de config réversibles.');
v('… l’apply enregistre un instantané AVANT + un historique (rollback possible)',
  /_perfAvant/.test(SRV) && /_perfHistPush/.test(SRV));
v('l’optimisation cache-calendrier est réellement câblée dans la route',
  /_perfOpt\['cache-calendrier'\]/.test(SRV) && /Cache-Control', 'private, max-age=60'/.test(SRV));

console.log('\n── La télémétrie est BORNÉE (ne peut pas grossir le disque) ──');
v('bornes dures sur le nombre de clés (views/api)', /fold\(_perf\.views, b\.views, 80\)/.test(SRV) && /fold\(_perf\.api, b\.api, 120\)/.test(SRV));
v('historique borné', /_perfHist\.length > 200/.test(SRV));
v('persistance sur le volume (survit aux déploiements), écriture throttlée', /_PERF_F = path\.join\(_CACHE_DIR/.test(SRV) && /_perfMajTimer/.test(SRV));

console.log('\n── Intégration au dashboard existant (sans refonte) ──');
v('sous-onglet « Performance » ajouté à la barre aimt', /data-aimt="perf"/.test(AHTML));
v('panneau perf présent (data-aimt-p="perf")', /data-aimt-p="perf"/.test(AHTML));
v('admin.js charge le panneau à l’ouverture du sous-onglet', /nom === 'perf'.{0,40}loadPerf/.test(AJS));
v('… et expose les actions (appliquer / retour arrière / réinitialiser)',
  /window\.perfApply/.test(AJS) && /window\.perfRevert/.test(AJS) && /window\.perfReset/.test(AJS));
v('bouton « Analyser & Optimiser » présent', /Analyser &amp; Optimiser|perfAnalyser\(\)/.test(AHTML));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec' : '✓ ' + ok + ' contrôles au vert') + '\n');
process.exit(ko ? 1 : 0);

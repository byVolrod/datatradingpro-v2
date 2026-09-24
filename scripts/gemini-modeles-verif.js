#!/usr/bin/env node
/**
 * scripts/gemini-modeles-verif.js — UN MODÈLE GEMINI RETIRÉ NE PEUT PLUS ÉTEINDRE GEMINI (24/09)
 * ------------------------------------------------------------------------------------------------
 * INCIDENT (capture du Moniteur IA, 23/09) : « Gemini · score 0 · Clés 7 (28 gelées) · HTTP 404 modèle
 * introuvable ». Trois défauts empilés, chacun invisible seul :
 *   1. Google a RETIRÉ la famille 2.0 ; le 404 était traité par couple (modèle, clé) → le modèle mort
 *      retenté sur les 7 clés, 7 couples gelés 6 h, et ces couples gonflaient la « pression » qui
 *      ralentit toute l'IA de fond ;
 *   2. les noms de modèles se tenaient à la main : rien ne voyait qu'ils sortaient du catalogue ;
 *   3. le score de santé divisait des COUPLES gelés (28) par le nombre de CLÉS (7) → 100 − 240 = 0,
 *      affiché même quand des clés répondaient.
 *
 * On EXÉCUTE le vrai code extrait (jamais une copie), sur un catalogue réaliste, avec des témoins.
 *
 *   node scripts/gemini-modeles-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AI = fs.readFileSync(path.join(__dirname, '..', 'ai.js'), 'utf8');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

const BLOC = (() => { const d = AI.indexOf('const _gemModelDead = new Map();'); const f = AI.indexOf('async function _gemDecouvrir()'); return (d >= 0 && f > d) ? AI.slice(d, f) : null; })();
function monter(src, modeles) {
  const GM = modeles.slice(), LF = modeles.slice();
  const api = new Function('GEMINI_MODELS', 'GEMINI_MODELS_LITE_FIRST', 'console',
    src + '\nreturn { _gemAppliquerCatalogue, _gemLive, _gemModelIsDead, _gemMarkDead, _gemRangRemplacant, _gemAjoutes };')(GM, LF, { log() {}, warn() {} });
  return { api, GM, LF };
}
// Catalogue réaliste : la famille 2.0 absente, des aperçus et des modèles spécialisés à ne JAMAIS prendre.
const CATALOGUE = new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash', 'gemini-3-flash-lite',
  'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-image', 'gemini-flash-latest', 'gemini-flash-lite-latest']);

console.log('\n── 1. Le code est extractible et branché ──');
v('le bloc « modèles retirés / catalogue » est extractible d\'ai.js', !!BLOC);
v('la cascade n\'itère que sur les modèles VIVANTS', /const models = _gemLive\(maxTokens <= LITE_MAXTOK \? GEMINI_MODELS_LITE_FIRST : GEMINI_MODELS\)/.test(AI));
// 24/09 : le classement des échecs vit dans _gemEchec (partagé Gemini/Gemma) ; la boucle passe au
// modèle suivant (break) sur la classe 'modele'. Même comportement, vérifié aux deux bouts.
v('un 404 écarte le MODÈLE pour toutes les clés et passe au suivant (break)',
  /if \(st === 404\) \{ _gemMarkDead\(model, 'HTTP 404 \(modèle retiré par Google\)'\); return 'modele'; \}/.test(AI)
  && /const c = _gemEchec\(model, idx, e, prompt\);[\s\S]{0,400}if \(c === 'modele' \|\| c === 'requete'\) break;/.test(AI));
v('… et ne gèle plus de couple (modèle, clé) sur un 404', !/e\.status === 404 \|\| e\.status === 503/.test(AI));
v('la pression ne compte plus les modèles retirés comme une panne', (AI.match(/for \(const m of _gemLive\(GEMINI_MODELS\)\)/g) || []).length >= 2);
v('le catalogue officiel est relu au démarrage puis toutes les 6 h (minuteries non bloquantes)',
  /setTimeout\(\(\) => \{ _gemDecouvrir\(\)/.test(AI) && /setInterval\(\(\) => \{ _gemDecouvrir\(\)\.catch\(\(\) => \{\}\); \}, 6 \* 3600e3\)/.test(AI) && (AI.match(/\.unref\) t[12]\.unref\(\)/g) || []).length === 2);
v('un modèle qui refuse thinkingBudget:0 est rappelé sans ce réglage (plus d\'échec en boucle)', /_gemSansThinking\.add\(model\); return _gemini\(model, key, prompt, maxTokens\)/.test(AI));
v('la famille 2.0 retirée n\'est plus dans les modèles par défaut', !/GEMINI_MODEL \|\| '[^']*gemini-2\.0/.test(AI));
if (!BLOC) { console.log('\n✗ banc interrompu\n'); process.exit(1); }

console.log('\n── 2. Le catalogue écarte les modèles retirés (config réelle d\'hier, famille 2.0 incluse) ──');
{
  const { api, GM } = monter(BLOC, ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite']);
  v('la lecture du catalogue est acceptée', api._gemAppliquerCatalogue(CATALOGUE) === true);
  v('gemini-2.0-flash et -lite sont écartés', api._gemModelIsDead('gemini-2.0-flash') && api._gemModelIsDead('gemini-2.0-flash-lite'));
  v('… les 2.5 restent vivants', JSON.stringify(api._gemLive(GM)) === JSON.stringify(['gemini-2.5-flash', 'gemini-2.5-flash-lite']), JSON.stringify(api._gemLive(GM)));
  v('… et avec 2 vivants, rien n\'est ajouté (on ne touche pas une config qui marche)', GM.length === 4 && api._gemAjoutes.length === 0);
}

console.log('\n── 3. Tout est retiré → remplacement automatique par les Flash STABLES servis ──');
{
  const { api, GM, LF } = monter(BLOC, ['gemini-2.0-flash', 'gemini-2.0-flash-lite']);
  api._gemAppliquerCatalogue(CATALOGUE);
  const vivants = api._gemLive(GM);
  v('trois modèles vivants après remplacement', vivants.length === 3, JSON.stringify(vivants));
  v('le plus récent Flash stable passe en tête (gemini-3-flash)', vivants[0] === 'gemini-3-flash', JSON.stringify(vivants));
  v('jamais un aperçu, un pro, un tts ni un modèle image', !vivants.some(m => /preview|pro|tts|image/.test(m)), JSON.stringify(vivants));
  v('la liste « lite d\'abord » suit les ajouts', LF.includes('gemini-3-flash-lite') && LF.indexOf('gemini-3-flash-lite') < LF.indexOf('gemini-3-flash'), JSON.stringify(LF));
}

console.log('\n── 4. Un catalogue illisible ne détruit rien ; un modèle revenu est réintégré ──');
{
  const { api, GM } = monter(BLOC, ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  v('catalogue vide (lecture ratée) → refusé, aucun modèle écarté', api._gemAppliquerCatalogue(new Set()) === false && api._gemLive(GM).length === 2);
  api._gemMarkDead('gemini-2.5-flash', 'HTTP 404');
  v('un 404 écarte le modèle', !api._gemLive(GM).includes('gemini-2.5-flash'));
  api._gemAppliquerCatalogue(CATALOGUE);
  v('… et le catalogue suivant le réintègre s\'il est de nouveau servi', api._gemLive(GM).includes('gemini-2.5-flash'));
}

console.log('\n── 5. Témoin : sans la garde du catalogue vide, une lecture ratée éteindrait Gemini ──');
{
  const mut = BLOC.replace('if (!dispo || !dispo.size) return false;', 'if (!dispo) return false;');
  v('(témoin) la mutation retire bien la garde', mut !== BLOC);
  const { api, GM } = monter(mut, ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  api._gemAppliquerCatalogue(new Set());
  v('(témoin) sans elle, un catalogue vide écarte TOUS les modèles', api._gemLive(GM).length === 0, JSON.stringify(api._gemLive(GM)));
}

console.log('\n── 6. Par clé : « gelée » veut dire « aucun modèle vivant utilisable avec elle » ──');
{
  const d = AI.indexOf('let _gkDay = \'\', _gkStats = [];');
  const f = AI.indexOf('const _AI_STATS_ZERO');
  v('la télémétrie par clé est extractible', d >= 0 && f > d);
  if (d >= 0 && f > d) {
    const froid = new Set(['m1|1', 'm2|1']);   // la clé n°2 n'a plus aucun modèle utilisable
    const K = new Function('GEMINI_KEYS', 'GEMINI_MODELS', '_gemLive', '_gemIsCool', '_hBroken', AI.slice(d, f) + '\nreturn { _gkNote, _gkEtat };')(
      ['k1', 'k2', 'k3'], ['m1', 'm2'], l => l, (m, i) => froid.has(m + '|' + i), () => false);
    K._gkNote(0, 'ok'); K._gkNote(0, 'ok'); K._gkNote(1, 'e429', 429); K._gkNote(2, 'fail', 403);
    const e = K._gkEtat();
    v('trois clés suivies, chacune avec ses propres compteurs', e.length === 3 && e[0].ok === 2 && e[1].e429 === 1 && e[2].fail === 1, JSON.stringify(e));
    v('la clé n°2 (tous modèles en cooldown) est « gelée », les autres non', e[1].gelee === true && !e[0].gelee && !e[2].gelee);
    v('le dernier refus garde son code HTTP (403 = clé refusée)', e[2].lastStatus === 403);
  }
}

console.log('\n── 7. Le score de santé compte des CLÉS gelées, plus des couples ──');
{
  const d = SRV.indexOf('function _telHealthScore(');
  const f = SRV.indexOf('\n}', d) + 2;
  const H = new Function(SRV.slice(d, f) + '\nreturn _telHealthScore;')();
  v('le Moniteur passe les CLÉS gelées au score (geminiKeysFrozen)', /gemini: \{ keys: st\.geminiKeys \|\| 0, coolingKeys: st\.geminiKeysFrozen \|\| 0/.test(SRV));
  v('7 clés dont 1 gelée, qui répondent → score élevé', H(7, 1, 0, 40, 4) >= 80, String(H(7, 1, 0, 40, 4)));
  v('(témoin) l\'ancien calcul sur 28 couples donnait 0 alors que des clés répondaient', H(7, 28, 0, 40, 4) === 0);
  v('les seaux horaires persistent le détail par clé et Cloudflare', /b\.gemKeys\[i\] = \{ ok: 0, e429: 0, fail: 0 \}/.test(SRV) && /b\.cloudflare\.calls \+= dl\('cloudflare'\)/.test(SRV));
}

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);

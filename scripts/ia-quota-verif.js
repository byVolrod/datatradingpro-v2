#!/usr/bin/env node
/**
 * scripts/ia-quota-verif.js — LE FIL RESTE EN FRANÇAIS QUAND FLASH EST À SEC (24/09)
 * ------------------------------------------------------------------------------------------------
 * URGENCE user (capture du Moniteur IA) : « Gemini 0/100 · 6 clés sans modèle utilisable · 6 breaker
 * ouvert · dernière erreur HTTP 400 », GitHub/Cohere/Cloudflare « sans code », et le fil repassé en
 * anglais. Mesuré dans `aitel:*` : Flash plafonne à ~250 réponses/jour sur 7 clés, vidé vers midi UTC.
 *
 * On CHARGE le vrai ai.js (pas une copie) avec un réseau Google simulé, et on rejoue :
 *   1. un 400 de REQUÊTE ne gèle ni ne disjoncte aucune clé, et ne coûte qu'un appel par modèle ;
 *   2. un 400 de CLÉ (clé expirée) met cette clé seule de côté et passe à la suivante ;
 *   3. un modèle qui refuse en 400 des requêtes différentes sur 3 clés est écarté (alias cassé) ;
 *   4. les titres du fil (masse) partent sur Gemma d'abord, sans instruction système ;
 *   5. Flash épuisé (429 du jour) → une tâche ordinaire est servie par Gemma ;
 *   6. une requête trop lourde pour le débit de Gemma ne lui est jamais envoyée ;
 *   7. le choix du Gemma dans le catalogue (le plus récent, puis le plus grand, jamais < 12b) ;
 * avec des témoins : chaque garde, retirée, fait rougir son contrôle.
 *
 *   node scripts/ia-quota-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const AI_PATH = path.join(R, 'ai.js');
const AI_SRC = fs.readFileSync(AI_PATH, 'utf8');
const SRV = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

// Environnement isolé : trois clés Gemini, AUCUN autre fournisseur (on mesure Gemini/Gemma seuls).
for (const k of Object.keys(process.env)) if (/^(GEMINI_API_KEY|GOOGLE_API_KEY|GITHUB_TOKEN|OPENROUTER_API_KEY|GROQ_API_KEY|COHERE_API_KEY|XAI_API_KEY|ANTHROPIC_API_KEY|CLOUDFLARE_|GEMMA_MODEL|GEMINI_MODEL$|DTP_GEMMA)/.test(k)) delete process.env[k];
process.env.GEMINI_API_KEY = 'cle-A'; process.env.GEMINI_API_KEY2 = 'cle-B'; process.env.GEMINI_API_KEY3 = 'cle-C';
process.env.GEMINI_RPM = '100000';   // le lissage anti-rafale n'est pas l'objet de ce banc
process.env.GEMINI_MODEL = 'gemini-2.5-flash,gemini-2.5-flash-lite';

let journal = [];     // appels réseau reçus : { model, key, body }
let repondre = () => ({ status: 200, texte: 'ok' });
global.fetch = async (url, init) => {
  const u = String(url);
  const m = /models\/([^:]+):generateContent\?key=([^&]+)/.exec(u);
  if (!m) return { ok: false, status: 404, text: async () => '', json: async () => ({}), headers: { get: () => null } };
  const appel = { model: m[1], key: m[2], body: JSON.parse((init && init.body) || '{}') };
  journal.push(appel);
  const r = repondre(appel) || { status: 200, texte: 'ok' };
  if (r.reseau) throw new TypeError('fetch failed');   // coupure réseau : aucun code HTTP
  const corps = r.status === 200
    ? JSON.stringify({ candidates: [{ content: { parts: [{ text: r.texte }] } }] })
    : JSON.stringify({ error: { code: r.status, status: r.gStatus || 'INVALID_ARGUMENT', message: r.message || 'refus' } });
  return { ok: r.status === 200, status: r.status, text: async () => corps, json: async () => JSON.parse(corps), headers: { get: () => null } };
};
const origLog = console.log, origWarn = console.warn;
function charger(src) {
  delete require.cache[require.resolve(AI_PATH)];
  console.log = () => {}; console.warn = () => {};
  let mod;
  try {
    if (src) { const Module = require('module'); const m = new Module(AI_PATH, module); m.filename = AI_PATH; m.paths = Module._nodeModulePaths(R); m._compile(src, AI_PATH); mod = m.exports; }
    else mod = require(AI_PATH);
  } finally { console.log = origLog; console.warn = origWarn; }
  journal = [];
  return mod;
}
const muet = async f => { console.warn = () => {}; console.log = () => {}; try { return await f(); } catch (e) { return e; } finally { console.log = origLog; console.warn = origWarn; } };
const TITRES = 'Translate each numbered line into natural, professional FRENCH for a trading terminal.\n[[1]] Fed holds rates steady';

(async () => {
  console.log('\n── 1. Un 400 de REQUÊTE ne gèle aucune clé et ne coûte qu\'un appel par modèle ──');
  {
    const ai = charger();
    repondre = a => /gemma/.test(a.model) ? { status: 200, texte: 'Gemma OK' } : { status: 400, message: 'Invalid value at contents[0].parts[0].text' };
    await muet(() => ai.generateText('Une requête que Google refuse', 900, {}));
    const flash = journal.filter(a => !/gemma/.test(a.model));
    v('2 modèles Flash × 1 appel (et non 2 × 3 clés = 6)', flash.length === 2, flash.length + ' appels Flash');
    const st = ai.status();
    v('aucun disjoncteur ouvert, aucune clé gelée', st.intel.breakersOpen === 0 && st.geminiKeysFrozen === 0, JSON.stringify({ b: st.intel.breakersOpen, g: st.geminiKeysFrozen }));
    v('Flash reste disponible pour la requête suivante', ai.flashDispo() === true);
    for (let i = 0; i < 4; i++) await muet(() => ai.generateText('Une requête que Google refuse', 900, {}));
    v('même répétée 5 fois, la même requête refusée n\'ouvre aucun disjoncteur', ai.status().intel.breakersOpen === 0 && ai.flashDispo());
  }
  {
    // TÉMOIN : l'ancien comportement (le 400 retenté sur toutes les clés) doit faire rougir le compte d'appels.
    const mut = AI_SRC.replace("if (c === 'modele' || c === 'requete') break;\n        }\n      }\n    }\n  }", "}\n      }\n    }\n  }");
    v('(témoin) la mutation retire bien le passage au modèle suivant', mut !== AI_SRC);
    const ai = charger(mut);
    repondre = a => /gemma/.test(a.model) ? { status: 200, texte: 'Gemma OK' } : { status: 400, message: 'Invalid value at contents[0].parts[0].text' };
    await muet(() => ai.generateText('Une requête que Google refuse', 900, {}));
    v('(témoin) sans elle, la requête est retentée sur les 3 clés de chaque modèle', journal.filter(a => !/gemma/.test(a.model)).length === 6, journal.length + ' appels');
  }

  console.log('\n── 2. Un 400 de CLÉ (clé expirée) met CETTE clé de côté et passe à la suivante ──');
  {
    const ai = charger();
    // 1er passage : B et C injoignables (coupure réseau, sans gel), A répond « clé expirée » → A est forcément essayée.
    repondre = a => a.key === 'cle-A' ? { status: 400, message: 'API key expired. Please renew the API key.', gStatus: 'INVALID_ARGUMENT' } : { reseau: true };
    await muet(() => ai.generateText('Analyse brève', 900, {}));
    const avant = journal.filter(a => a.key === 'cle-A').length;
    // Ensuite B et C reviennent ; A reste expirée.
    repondre = a => a.key === 'cle-A' ? { status: 400, message: 'API key expired. Please renew the API key.', gStatus: 'INVALID_ARGUMENT' } : { status: 200, texte: 'Réponse de ' + a.key };
    const out = await muet(() => ai.generateText('Analyse brève bis', 900, {}));
    v('la génération réussit sur une autre clé', /Réponse de cle-[BC]/.test(String(out)), String(out && out.message || out));
    journal = [];
    for (let i = 0; i < 4; i++) await muet(() => ai.generateText('Analyse brève ' + i, 900, {}));
    v('la clé expirée n\'a coûté qu\'UN appel, puis n\'est plus sollicitée (tous modèles, Gemma compris)', avant === 1 && journal.every(a => a.key !== 'cle-A'), 'appels cle-A au 1er passage : ' + avant + ', ensuite : ' + journal.filter(a => a.key === 'cle-A').length);
    v('… et Flash reste disponible sur les autres clés', ai.flashDispo());
  }
  {
    const mut = AI_SRC.replace("if (c === 'cle') { _gemCleCool(idx, 6 * 3600e3); return 'cle'; }", "if (c === 'cle') { return 'cle'; }");
    v('(témoin) la mutation retire bien la mise de côté de la clé', mut !== AI_SRC);
    const ai = charger(mut);
    repondre = a => a.key === 'cle-A' ? { status: 400, message: 'API key expired. Please renew the API key.' } : { reseau: true };
    await muet(() => ai.generateText('Analyse brève', 900, {}));
    repondre = a => a.key === 'cle-A' ? { status: 400, message: 'API key expired. Please renew the API key.' } : { status: 200, texte: 'ok ' + a.key };
    journal = [];
    for (let i = 0; i < 6; i++) await muet(() => ai.generateText('Analyse brève ' + i, 900, {}));
    v('(témoin) sans elle, la clé expirée est encore appelée', journal.some(a => a.key === 'cle-A'), 'appels cle-A : ' + journal.filter(a => a.key === 'cle-A').length);
  }

  console.log('\n── 3. Un MODÈLE qui refuse tout (alias cassé) est écarté pour toutes les clés ──');
  {
    const ai = charger();
    repondre = a => a.model === 'gemini-2.5-flash' ? { status: 400, message: 'Request contains an invalid argument.' } : { status: 200, texte: 'lite ok' };
    for (let i = 0; i < 6; i++) await muet(() => ai.generateText('Requête différente n°' + i + ' '.repeat(i), 900, {}));
    const morts = ai.status().geminiModelsDead.map(d => d.m);
    v('gemini-2.5-flash écarté après des refus sur 3 clés et 2 requêtes différentes', morts.includes('gemini-2.5-flash'), JSON.stringify(ai.status().geminiModelsDead));
    v('… gemini-2.5-flash-lite, lui, reste vivant', !morts.includes('gemini-2.5-flash-lite'));
    journal = [];
    await muet(() => ai.generateText('Encore une', 900, {}));
    v('… et on ne l\'appelle plus du tout', journal.every(a => a.model !== 'gemini-2.5-flash'));
  }

  console.log('\n── 4. Les titres du fil (masse) partent sur GEMMA d\'abord ──');
  {
    const ai = charger();
    repondre = a => ({ status: 200, texte: /gemma/.test(a.model) ? '[[1]] La Fed maintient ses taux' : 'flash' });
    const meta = {};
    const out = await muet(() => ai.generateText(TITRES, 300, { masse: true, meta }));
    v('réponse de Gemma, aucun appel Flash', /La Fed maintient/.test(String(out)) && journal.length === 1 && /^gemma-/.test(journal[0].model), JSON.stringify(journal.map(a => a.model)));
    v('l\'appelant sait que Gemma a répondu (l\'enveloppe Flash n\'est pas débitée)', meta.fournisseur === 'gemma');
    const b = journal[0].body;
    v('Gemma reçoit le contexte commun EN TÊTE du message, sans instruction système ni réglage de réflexion',
      !b.systemInstruction && !(b.generationConfig || {}).thinkingConfig && /DataTradingPro/.test(b.contents[0].parts[0].text) && /Fed holds rates/.test(b.contents[0].parts[0].text));
    {
      const mut = AI_SRC.replace('if (opts.masse && GEMMA_ON && gemmaDispo(prompt, maxTokens)) {', 'if (false && opts.masse) {');
      v('(témoin) la mutation retire bien la voie de masse', mut !== AI_SRC);
      const ai2 = charger(mut);
      await muet(() => ai2.generateText(TITRES, 300, { masse: true, meta: {} }));
      v('(témoin) sans elle, les titres vident d\'abord le quota Flash', journal.length >= 1 && !/gemma/.test(journal[0].model), JSON.stringify(journal.map(a => a.model)));
    }
    journal = [];
    await muet(() => ai.generateText('Analyse lourde de rapport', 900, {}));
    v('une tâche ordinaire, elle, va d\'abord à Flash', journal.length >= 1 && !/gemma/.test(journal[0].model));
    v('le routeur du desk marque les traductions du fil comme tâches de masse (deux appels)',
      (SRV.match(/claudeOverBudget: false, masse: true \}\)/g) || []).length === 2);
  }

  console.log('\n── 5. Flash épuisé pour la journée → Gemma sert les tâches ordinaires ──');
  {
    const ai = charger();
    repondre = a => /gemma/.test(a.model) ? { status: 200, texte: 'servi par Gemma' }
      : { status: 429, gStatus: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"' };
    const out = await muet(() => ai.generateText('Petite analyse', 900, {}));
    v('la génération aboutit malgré Flash à sec', String(out) === 'servi par Gemma', String(out && out.message || out));
    journal = [];
    const out2 = await muet(() => ai.generateText('Autre analyse', 900, {}));
    v('ensuite, plus aucun appel Flash inutile avant le retour du quota', String(out2) === 'servi par Gemma' && journal.every(a => /gemma/.test(a.model)), JSON.stringify(journal.map(a => a.model)));
    v('flashDispo() dit « à sec » (les rapports lourds attendent le retour du quota)', ai.flashDispo() === false);
  }

  console.log('\n── 6. Une requête trop lourde pour le débit de Gemma ne lui est jamais envoyée ──');
  {
    const ai = charger();
    repondre = a => /gemma/.test(a.model) ? { status: 200, texte: 'gemma' } : { status: 429, message: 'quota "quotaId": "PerDay"' };
    await muet(() => ai.generateText('x'.repeat(60000), 8192, {}));
    v('prompt de ~20 000 jetons : aucun appel Gemma (il dépasserait 15 000 jetons/min)', journal.every(a => !/gemma/.test(a.model)), JSON.stringify(journal.map(a => a.model)));
    v('gemmaDispo le dit sans appel', ai.gemmaDispo('x'.repeat(60000), 8192) === false && ai.gemmaDispo('court', 300) === true);
  }

  console.log('\n── 6 bis. Aux heures de pointe, le fil garde sa part du débit de Gemma ──');
  {
    const ai = charger();
    repondre = a => /gemma/.test(a.model) ? { status: 200, texte: '[[1]] ok gemma' } : { status: 429, message: 'quota "quotaId": "PerDay"' };
    // Flash à sec : les tâches de fond retombent toutes sur Gemma jusqu'à leur plafond (60% du débit par clé).
    for (let i = 0; i < 40; i++) await muet(() => ai.generateText('Tâche de fond ' + i + ' ' + 'x'.repeat(1400), 900, {}));
    const fond = journal.filter(a => /gemma/.test(a.model)).length;
    journal = [];
    const out = await muet(() => ai.generateText(TITRES, 300, { masse: true, meta: {} }));
    v('le fond s\'arrête à sa part (quelques appels par clé, pas 40)', fond > 0 && fond < 40, fond + ' appels de fond sur Gemma');
    v('… et un titre du fil passe ENCORE sur Gemma juste après', /ok gemma/.test(String(out)) && journal.some(a => /gemma/.test(a.model)), String(out && out.message || out));
  }

  console.log('\n── 7. Le Gemma servi est choisi dans le catalogue ──');
  {
    const a = AI_SRC.indexOf('function _gemmaRang('), b = AI_SRC.indexOf('const _gemmaFen = new Map();');
    v('_gemmaRang / _gemmaChoisir sont extractibles', a > 0 && b > a);
    if (a > 0 && b > a) {
      const mk = force => new Function('GEMMA_ON', 'GEMMA_FORCE', '_gemMarkDead', '_gemModelDead',
        'let GEMMA_MODEL = GEMMA_FORCE || "gemma-3-27b-it";\n' + AI_SRC.slice(a, b) + '\nreturn { choisir: d => _gemmaChoisir(d) };')(true, force || '', () => {}, new Map());
      v('le plus récent puis le plus grand (jamais un modèle < 12b)', mk().choisir(new Set(['gemma-3-4b-it', 'gemma-3-12b-it', 'gemma-3-27b-it', 'gemma-4-9b-it', 'gemini-2.5-flash'])) === 'gemma-3-27b-it');
      v('une génération plus récente et assez grande est préférée', mk().choisir(new Set(['gemma-3-27b-it', 'gemma-4-31b-it'])) === 'gemma-4-31b-it');
      v('un nom forcé (GEMMA_MODEL) n\'est jamais remplacé', mk('gemma-3-12b-it').choisir(new Set(['gemma-3-27b-it', 'gemma-3-12b-it'])) === 'gemma-3-12b-it');
    }
  }

  console.log('\n── 8. Traduction de SECOURS hors IA (DeepL si clé, sinon MyMemory) ──');
  {
    const a = SRV.indexOf('const _looksFr = s =>'), b = SRV.indexOf('const TRANSLATE_CACHE_FILE');
    const c = SRV.indexOf('/* ══ TRADUCTION DE SECOURS HORS IA'), d = SRV.indexOf("/* ─── TRADUCTION D'UN LOT : IMPLEMENTATION UNIQUE");
    v('le secours et le contrôle de langue sont extractibles de server.js', a > 0 && b > a && c > 0 && d > c);
    if (a > 0 && b > a && c > 0 && d > c) {
      const monter = (env, rep) => {
        const appels = [];
        const f = async (url, init) => { appels.push(String(url)); const r = rep(String(url), init); return { ok: r.status === 200, status: r.status, json: async () => r.json }; };
        const api = new Function('fetch', 'process', SRV.slice(a, b) + '\n' + SRV.slice(c, d) + '\nreturn { _traductionSecours, _trSecoursComplete, _trSecoursLu, _trSecoursEtat };')(f, { env });
        return { api, appels };
      };
      const MM = fr => ({ status: 200, json: { responseStatus: 200, responseData: { translatedText: fr } } });
      {
        const { api, appels } = monter({}, u => /mymemory/.test(u) ? MM('La Fed maintient ses taux') : { status: 404 });
        const out = await api._traductionSecours(['Fed holds rates steady']);
        v('sans clé DeepL : MyMemory traduit, sans aucun appel DeepL', out[0] === 'La Fed maintient ses taux' && appels.every(x => !/deepl/.test(x)), JSON.stringify(out));
      }
      {
        const { api } = monter({}, () => MM('Fed holds rates steady'));
        v('une « traduction » identique à la source est refusée', (await api._traductionSecours(['Fed holds rates steady']))[0] === null);
        const { api: api2 } = monter({}, () => MM('La Fed mantiene i tassi, secondo gli analisti'));
        v('une réponse dans une autre langue (italien) est refusée', (await api2._traductionSecours(['Fed holds rates, analysts say']))[0] === null);
      }
      {
        const { api, appels } = monter({}, () => ({ status: 200, json: { responseStatus: 429, quotaFinished: true, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' } } }));
        await api._traductionSecours(['Line one here', 'Line two here', 'Line three here']);
        const n1 = appels.length;
        await api._traductionSecours(['Line four here']);
        v('quota MyMemory atteint : arrêt net, plus aucun appel jusqu\'au lendemain', n1 === 1 && appels.length === 1, appels.length + ' appels');
      }
      {
        const { api } = monter({ MYMEMORY_CHARS_JOUR: '30' }, () => MM('Une traduction française'));
        const out = await api._traductionSecours(['A first line of twenty', 'A second line of twenty']);
        v('le plafond de caractères du jour est tenu', out[0] && out[1] === null, JSON.stringify(out));
      }
      {
        const { api, appels } = monter({ DEEPL_API_KEY: 'k:fx' }, u => /deepl/.test(u) ? { status: 200, json: { translations: [{ text: 'La BCE relève ses taux' }] } } : MM('x'));
        const out = await api._traductionSecours(['ECB raises rates']);
        v('clé DeepL gratuite (:fx) : DeepL d\'abord (api-free), MyMemory non sollicité', out[0] === 'La BCE relève ses taux' && /api-free\.deepl\.com/.test(appels[0]) && !appels.some(x => /mymemory/.test(x)), JSON.stringify(appels));
      }
      {
        const { api } = monter({}, () => MM('Le pétrole grimpe après les stocks'));
        const texts = ['Oil climbs after inventories', 'Le dollar est déjà en français'], result = [null, null];
        await api._trSecoursComplete(texts, result, [0, 1]);
        v('_trSecoursComplete remplit la ligne anglaise et laisse la ligne déjà française', result[0] === 'Le pétrole grimpe après les stocks' && result[1] === null, JSON.stringify(result));
        v('… et la garde 6 h en mémoire (l\'IA revenue la remplacera)', api._trSecoursLu('Oil climbs after inventories') === 'Le pétrole grimpe après les stocks');
      }
    }
    v('le lot de traduction appelle le secours sur panne de cascade ET sur lot entièrement raté',
      (SRV.match(/await _trSecoursComplete\(texts, result, missIdx\)/g) || []).length === 3);
  }

  console.log('\n── 9. Branché côté desk ──');
  v('le catalogue choisit le Gemma HORS de _gemAppliquerCatalogue (sa tranche est éprouvée seule par gemini-modeles-verif)',
    /_gemmaChoisir\(dispo\); _gemCatalogue\.gemma/.test(AI_SRC) && !/function _gemAppliquerCatalogue[\s\S]{0,900}_gemmaChoisir/.test(AI_SRC.slice(0, AI_SRC.indexOf('async function _gemDecouvrir'))));
  v('une réponse de Gemma n\'est pas comptée dans l\'enveloppe Flash (aiSmart)', /if \(_meta\.fournisseur === 'gemma'\) _aiNoteGemma\(category\); else aiNote\(category\);/.test(SRV));
  v('la télémétrie horaire garde Gemma et le journal des erreurs', /b\.gemma\.calls \+= dl\('gemma'\)/.test(SRV) && /b\.err = j;/.test(SRV));
  v('DTP_GEMMA=0 coupe la voie (interrupteur)', /const GEMMA_ON = String\(process\.env\.DTP_GEMMA \|\| '1'\) !== '0';/.test(AI_SRC));

  console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
  process.exit(ko ? 1 : 0);
})();

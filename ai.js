/**
 * ai.js — Génération de texte IA
 * Priorité à Google Gemini (gratuit). Repli sur GitHub Models puis Anthropic Claude.
 * Plusieurs clés Gemini (GEMINI_API_KEY, _2.._30 + GOOGLE_API_KEY) ET plusieurs clés
 * Anthropic (ANTHROPIC_API_KEY, _2.._30) supportées : rotation round-robin + bascule
 * automatique sur la clé suivante en cas d'erreur (429 / quota / surcharge).
 * ⚠️ Le quota gratuit Gemini est PAR PROJET Google : des clés du même projet partagent
 * UN seul quota. La rotation ne multiplie les quotas que si 1 clé = 1 projet distinct.
 *
 * REDONDANCE/ROTATION (durcie) :
 *  - Cooldown PAR CLÉ sur les 3 providers (Gemini/GitHub/Claude), avec distinction
 *    erreur DÉFINITIVE (401/403/« credit balance » → gel long) vs transitoire (429/5xx).
 *  - 429 Gemini : cooldown ESCALADÉ (90 s → 6 min → 24 min → 2 h) + lecture du
 *    retryDelay renvoyé par Google → fini les tempêtes de re-sondage pendant un épuisement RPD.
 *  - SDK Anthropic : maxRetries=0 (la rotation de clés EST le retry) + timeout 30 s.
 *  - err.claudeTried : l'appelant sait que Claude a DÉJÀ été tenté (pas de double passe).
 *  - Backoff global : après N échecs TOTAUX consécutifs, backoffActive() signale aux
 *    boucles de fond (self-heal) de s'espacer au lieu de marteler des providers morts.
 *  - Lecture du champ usage (tokens in/out) des 3 providers → coût réel visible (status()).
 */
'use strict';

// Clés Gemini chargées DYNAMIQUEMENT : GEMINI_API_KEY puis _2, _3, … jusqu'à _30 (toute clé
// présente est prise automatiquement, SANS toucher au code) + GOOGLE_API_KEY.
const GEMINI_KEYS = (() => {
  const out = [];
  if (process.env.GEMINI_API_KEY) out.push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 30; i++) { const v = process.env['GEMINI_API_KEY' + i]; if (v) out.push(v); }   // _2.._30 auto-détectées
  if (process.env.GOOGLE_API_KEY) out.push(process.env.GOOGLE_API_KEY);
  return out.map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
})();
let _geminiCursor = 0;   // round-robin : clé de départ différente à chaque génération

// Cascade de modèles GRATUITS : chaque modèle a un quota gratuit SÉPARÉ → quand l'un renvoie 429
// (quota épuisé), on bascule sur le suivant ⇒ on cumule plusieurs quotas gratuits.
// Les '-lite' ont un quota gratuit bien plus élevé. Surchargeable via GEMINI_MODEL.
// 24/09 : la famille 2.0 est retirée du catalogue Google (404 mesurés) → défaut = familles servies, plus
// les alias « -latest » que Google fait pointer sur le Flash courant. Le catalogue lu au démarrage
// (_gemDecouvrir, ci-dessous) écarte de toute façon un modèle absent et complète si besoin.
const GEMINI_MODELS  = (process.env.GEMINI_MODEL || 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-flash-latest,gemini-flash-lite-latest')
  .split(',').map(s => s.trim()).filter(Boolean);
// Modèles « légers » : tâches courtes (titres, tags, extractions) routées d'abord sur les -lite
// (quota RPD ~4× supérieur) → préserve le quota rare de gemini-2.5-flash pour les gros JSON.
const GEMINI_MODELS_LITE_FIRST = [...GEMINI_MODELS].sort((a, b) => (a.includes('lite') ? 0 : 1) - (b.includes('lite') ? 0 : 1));
const LITE_MAXTOK = parseInt(process.env.GEMINI_LITE_MAXTOK, 10) || 400;   // ≤400 tokens demandés → cascade lite d'abord

// ── MODÈLES GEMINI RETIRÉS, ÉCARTÉS ET REMPLACÉS AUTOMATIQUEMENT (24/09) ─────────────────────────────
// INCIDENT (Moniteur IA, 23/09) : « Gemini · Clés 7 (28 gelées) · HTTP 404 modèle introuvable ». Google
// RETIRE ses modèles : un 404 est une propriété du MODÈLE, pas de la clé. Il était pourtant traité par
// couple (modèle, clé) : le modèle mort était retenté sur les 7 clés, chaque couple gelé 6 h, et ces
// couples gonflaient la « pression » qui ralentit ensuite TOUTE l'IA de fond — Gemini semblait éteint.
// Désormais : 1) un 404 écarte le MODÈLE pour toutes les clés d'un coup ; 2) au démarrage puis toutes les
// 6 h, on lit le CATALOGUE officiel (ListModels) : un modèle configuré absent est écarté, un modèle revenu
// réintégré, et s'il reste moins de 2 modèles vivants on complète avec les Flash STABLES réellement servis.
// Un modèle retiré ne peut plus éteindre Gemini, et aucun nom de modèle n'est plus à tenir à la main.
const _gemModelDead = new Map();   // modèle → { until, raison }
const _gemAjoutes = [];            // modèles ajoutés automatiquement depuis le catalogue
let _gemCatalogue = null;          // { at, n, ajoutes } — dernier catalogue lu
function _gemModelIsDead(m) { const d = _gemModelDead.get(m); return !!d && d.until > Date.now(); }
function _gemMarkDead(m, raison, ms) { _gemModelDead.set(m, { until: Date.now() + (ms || 12 * 3600e3), raison: String(raison || '').slice(0, 80) }); }
function _gemLive(list) { return list.filter(m => !_gemModelIsDead(m)); }
function _gemRecalcLite() { const s = [...GEMINI_MODELS].sort((a, b) => (a.includes('lite') ? 0 : 1) - (b.includes('lite') ? 0 : 1)); GEMINI_MODELS_LITE_FIRST.length = 0; GEMINI_MODELS_LITE_FIRST.push(...s); }
// Rang d'un remplaçant : versions numérotées STABLES d'abord (la plus récente en tête), puis les alias
// « -latest ». Jamais preview / exp / tts / image / audio : on ne met pas un modèle d'essai en production.
function _gemRangRemplacant(nom) {
  const m = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/.exec(nom);
  if (m) return 100 + parseFloat(m[1]) * 10 - (m[2] ? 1 : 0);
  if (/^gemini-flash(-lite)?-latest$/.test(nom)) return 50 - (/lite/.test(nom) ? 1 : 0);
  return -1;
}
// Pure (aucun I/O) → éprouvée au banc sur un vrai catalogue. `dispo` = noms servis avec generateContent.
function _gemAppliquerCatalogue(dispo) {
  if (!dispo || !dispo.size) return false;   // catalogue vide = lecture ratée → on ne touche à rien
  for (const m of GEMINI_MODELS) { if (dispo.has(m)) _gemModelDead.delete(m); else _gemMarkDead(m, 'absent du catalogue Google', 12 * 3600e3); }
  if (_gemLive(GEMINI_MODELS).length < 2) {
    const cands = [...dispo].filter(n => _gemRangRemplacant(n) >= 0 && !GEMINI_MODELS.includes(n)).sort((a, b) => _gemRangRemplacant(b) - _gemRangRemplacant(a));
    for (const n of cands) { if (_gemLive(GEMINI_MODELS).length >= 3) break; GEMINI_MODELS.push(n); _gemAjoutes.push(n); }
    _gemRecalcLite();
  }
  _gemCatalogue = { at: Date.now(), n: dispo.size, ajoutes: [..._gemAjoutes] };
  return true;
}
async function _gemDecouvrir() {
  if (!GEMINI_KEYS.length) return false;
  for (let i = 0; i < Math.min(3, GEMINI_KEYS.length); i++) {   // 3 clés au plus : une clé refusée ne doit pas aveugler la lecture
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=' + GEMINI_KEYS[i], { signal: ctrl.signal });
      if (!r.ok) continue;
      const j = await r.json();
      const dispo = new Set((j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name || '').replace(/^models\//, '')));
      if (_gemAppliquerCatalogue(dispo)) {
        // Le Gemma servi est choisi ICI, hors de _gemAppliquerCatalogue : cette fonction est éprouvée
        // seule au banc (gemini-modeles-verif extrait sa tranche) et ne doit dépendre de rien d'autre.
        _gemmaChoisir(dispo); _gemCatalogue.gemma = GEMMA_MODEL || null;
        console.log(`[AI] Catalogue Gemini : ${dispo.size} modèles servis · vivants : ${_gemLive(GEMINI_MODELS).join(', ') || 'aucun'}${_gemAjoutes.length ? ' · ajoutés : ' + _gemAjoutes.join(', ') : ''}`);
        return true;
      }
    } catch {} finally { clearTimeout(to); }
  }
  return false;
}
{ const t1 = setTimeout(() => { _gemDecouvrir().catch(() => {}); }, 5000); if (t1.unref) t1.unref();
  const t2 = setInterval(() => { _gemDecouvrir().catch(() => {}); }, 6 * 3600e3); if (t2.unref) t2.unref(); }

/* ══ GEMMA : LA CAPACITÉ DE MASSE DES MÊMES CLÉS (24/09, urgence « le fil repasse en anglais ») ═════
   MESURÉ dans la télémétrie (`aitel:*`, 23 et 24/09) : Gemini Flash plafonne à ~250-280 réponses PAR
   JOUR sur les 7 clés. Le palier gratuit n'est plus que de quelques dizaines de requêtes par modèle et
   par projet : il se remplit à 07 h UTC (minuit Pacifique), se vide entre 11 h et 13 h UTC, et le fil
   retombe en anglais tout le reste de la journée. Ajouter des clés ne change rien à cet ordre de
   grandeur. Les MÊMES clés ouvrent pourtant les modèles Gemma, dont le palier gratuit est d'un tout
   autre ordre (≈14 400 requêtes/jour, 30/min et 15 000 jetons/min par projet).
   → Les tâches de MASSE (titres du fil : courtes, nombreuses) partent sur Gemma EN PREMIER, et Gemma
   sert aussi de repli à toute tâche assez légère quand Flash est épuisé. Flash est ainsi gardé pour ce
   qui en a besoin (rapports, JSON longs), au lieu d'être brûlé sur des titres dès le matin.
   Deux différences d'API, gérées dans `_gemini` : pas d'instruction système (le contexte commun passe
   en tête du message) et pas de réglage de réflexion. Le modèle est choisi dans le catalogue officiel
   (le plus récent, puis le plus grand, ≥ 12 milliards de paramètres) ; GEMMA_MODEL le force, et
   DTP_GEMMA=0 coupe toute la voie. Débit : on tient le compte des jetons envoyés par clé sur la
   dernière minute, et on ne dépasse jamais 85% du plafond (GEMMA_TPM), 60% hors titres du fil. */
const _estGemma = m => /^gemma-/i.test(String(m || ''));
const GEMMA_ON = String(process.env.DTP_GEMMA || '1') !== '0';
const GEMMA_FORCE = (process.env.GEMMA_MODEL || '').trim();
let GEMMA_MODEL = GEMMA_ON ? (GEMMA_FORCE || 'gemma-3-27b-it') : '';
const GEMMA_TPM = parseInt(process.env.GEMMA_TPM, 10) || 15000;
function _gemmaRang(nom) {
  const m = /^gemma-(\d+(?:\.\d+)?)-(\d+)b-it$/.exec(String(nom || ''));
  if (!m || parseFloat(m[2]) < 12) return -1;
  return parseFloat(m[1]) * 1000 + parseFloat(m[2]);
}
// Pure (aucun I/O) → éprouvée au banc. Nom forcé : écarté s'il n'est pas servi, jamais remplacé.
/* ⚠️ LE PLUS RÉCENT N'EST PAS FORCÉMENT CELUI QUI RÉPOND (24/09, mesuré en production 3 h après la mise
   en service) : le catalogue a désigné `gemma-4-31b-it`, qui a renvoyé 177 « 500 INTERNAL » et 214
   délais dépassés pour UNE réponse par heure. Le fil est retombé sur Flash, épuisé. On garde donc la
   LISTE des candidats servis, et un modèle qui échoue en série (5xx ou délai, sans une réussite)
   est écarté 6 h : on BASCULE sur le suivant, sans intervention. */
let _gemmaCands = GEMMA_MODEL ? [GEMMA_MODEL] : [];
function _gemmaChoisir(dispo) {
  if (!GEMMA_ON || !dispo || !dispo.size) return GEMMA_MODEL;
  if (GEMMA_FORCE) { if (!dispo.has(GEMMA_FORCE)) _gemMarkDead(GEMMA_FORCE, 'absent du catalogue Google'); return GEMMA_MODEL; }
  const cands = [...dispo].filter(n => _gemmaRang(n) >= 0).sort((a, b) => _gemmaRang(b) - _gemmaRang(a));
  if (cands.length) { _gemmaCands = cands; GEMMA_MODEL = cands.find(m => !_gemModelIsDead(m)) || cands[0]; }
  else if (GEMMA_MODEL) _gemMarkDead(GEMMA_MODEL, 'aucun Gemma servi par le catalogue');
  return GEMMA_MODEL;
}
function _gemmaBasculer() {
  if (GEMMA_FORCE || !_gemModelIsDead(GEMMA_MODEL)) return GEMMA_MODEL;
  const suivant = _gemmaCands.find(m => !_gemModelIsDead(m));
  if (suivant && suivant !== GEMMA_MODEL) { console.warn('[AI] Gemma : ' + GEMMA_MODEL + ' écarté → bascule sur ' + suivant); GEMMA_MODEL = suivant; }
  return GEMMA_MODEL;
}
const _gemmaSerie = new Map();   // modèle → échecs consécutifs (5xx / délai), remis à 0 à la réussite
function _gemmaIssue(model, reussi) {
  if (reussi) { _gemmaSerie.set(model, 0); return; }
  const n = (_gemmaSerie.get(model) || 0) + 1;
  _gemmaSerie.set(model, n);
  // Seuil : un échec par clé (6 au plus). Toutes les clés en erreur serveur d'affilée, ce n'est plus un hoquet.
  if (n >= Math.min(6, Math.max(2, GEMINI_KEYS.length))) { _gemMarkDead(model, n + ' échecs de suite (erreur serveur ou délai) : bascule', 6 * 3600e3); _gemmaSerie.set(model, 0); _gemmaBasculer(); }
}
const _gemmaFen = new Map();   // idx → [[t, jetons], …] sur la dernière minute
/* RÉSERVE POUR LE FIL : les tâches de fond qui retombent sur Gemma (Flash épuisé) ne prennent que 60% du
   débit de chaque clé ; les titres du fil (masse) peuvent monter à 85%. Aux heures de pointe, c'est le fil
   que les clients regardent : il garde toujours de quoi être traduit, même quand tout le reste se replie. */
function _gemmaDebitOk(idx, jetons, masse) {
  const now = Date.now(), f = (_gemmaFen.get(idx) || []).filter(x => now - x[0] < 60000);
  _gemmaFen.set(idx, f);
  return f.reduce((a, x) => a + x[1], 0) + jetons <= GEMMA_TPM * (masse ? 0.85 : 0.60);
}
function _gemmaDebitNote(idx, jetons) { const f = _gemmaFen.get(idx) || []; f.push([Date.now(), jetons]); _gemmaFen.set(idx, f); }
function _gemmaJetons(prompt, maxTokens) { return Math.ceil((String(prompt || '').length + AI_SYSTEM.length + 400) / 3.2) + (maxTokens || 0); }
/* FLASH A-T-IL ENCORE DE QUOI RÉPONDRE ? (lecture pure, aucun appel). Un couple (modèle vivant, clé)
   hors attente et hors disjoncteur suffit. Sert aux rapports LOURDS (récap hebdo) : leur prompt dépasse
   le débit de Gemma, et les lancer quand Flash est à sec ne fait que vider les autres fournisseurs
   sur une rédaction vouée au repli. Ils attendent donc le retour du quota (minuit Pacifique). */
function flashDispo() {
  const n = GEMINI_KEYS.length; if (!n) return false;
  for (const m of _gemLive(GEMINI_MODELS)) for (let i = 0; i < n; i++) if (!_gemIsCool(m, i) && !_hBroken(m, i)) return true;
  return false;
}
// Utilisable pour CETTE requête ? (lecture pure : sert au routage ET au panneau)
function gemmaDispo(prompt, maxTokens) {
  _gemmaBasculer();
  if (!GEMMA_MODEL || !GEMINI_KEYS.length || _gemModelIsDead(GEMMA_MODEL)) return false;
  return prompt == null || _gemmaJetons(prompt, maxTokens) <= GEMMA_TPM * 0.8;
}

/* ══ LES 400 DE GEMINI NE SONT PLUS DES PANNES DE CLÉ (24/09) ══════════════════════════════════════
   CAPTURE du Moniteur IA : « Gemini 0/100 · 6 clés sans modèle utilisable · 6 breaker ouvert ·
   dernière erreur HTTP 400 », et par clé « 54 refus ». Un 400 ne dit RIEN du quota : c'est soit la
   REQUÊTE qui est refusée (contenu, paramètre), soit le MODÈLE qui ne sait pas faire ce qu'on lui
   demande, soit la CLÉ (invalide, expirée, région, facturation). L'ancien code le traitait comme un
   échec du couple (modèle, clé) : il retentait la même requête sur les 7 clés — 7 réponses
   identiques — puis ouvrait un disjoncteur de 5 min sur chaque couple au 4e refus. Une requête
   refusée par NATURE éteignait ainsi toutes les clés, et avec elles tout ce qui passait derrière.
   Désormais le corps de la réponse est lu et le 400 est rangé :
     · CLÉ → cette clé seule est mise de côté 6 h, pour tous ses modèles ; on passe à la clé suivante ;
     · MODÈLE → le modèle est écarté 6 h pour toutes les clés ; on passe au modèle suivant ;
     · REQUÊTE → rien n'est gelé ni disjoncté : on passe au modèle suivant, puis au fournisseur suivant.
   Filet statistique : un modèle qui refuse en 400 des requêtes DIFFÉRENTES sur 3 clés différentes en
   30 min sans une seule réussite est écarté comme un modèle cassé (un alias qui pointe ailleurs, un
   paramètre qu'il n'accepte plus) — sans avoir à connaître son message à l'avance. */
function _gem400Classe(corps) {
  const t = String(corps || '');
  if (/API_KEY_INVALID|API key (?:not valid|expired)|PERMISSION_DENIED|SERVICE_DISABLED|CONSUMER_SUSPENDED|billing|location is not supported|FAILED_PRECONDITION/i.test(t)) return 'cle';
  if (/is not supported|not supported (?:by|for) (?:this|the) model|does not support|unsupported model|is not found for API version|not enabled for (?:this )?model|Developer instruction is not enabled|only works in|not available for (?:this|the) model/i.test(t)) return 'modele';
  return 'requete';
}
const _gem400Req = new Map();   // modèle → [{ t, idx, h }] (fenêtre 30 min)
const _gemOkAt = new Map();     // modèle → dernière réussite
function _gemHash(p) { let h = 0; const s = String(p || ''); for (let i = 0; i < s.length; i += 7) h = (h * 31 + s.charCodeAt(i)) | 0; return h + ':' + s.length; }
function _gem400Note(model, idx, prompt, now) {
  now = now || Date.now();
  const l = (_gem400Req.get(model) || []).filter(x => now - x.t < 30 * 60e3);
  l.push({ t: now, idx, h: _gemHash(prompt) });
  _gem400Req.set(model, l);
  const cles = new Set(l.map(x => x.idx)).size, reqs = new Set(l.map(x => x.h)).size;
  const okRecent = now - (_gemOkAt.get(model) || 0) < 30 * 60e3;
  if (cles >= 3 && reqs >= 2 && !okRecent) { _gemMarkDead(model, 'HTTP 400 répétés sur ' + cles + ' clés', 6 * 3600e3); _gem400Req.delete(model); return true; }
  return false;
}
function _gemCleCool(idx, ms) {
  const fin = Date.now() + ms;
  for (const m of [...GEMINI_MODELS, GEMMA_MODEL].filter(Boolean)) _gemCooldown.set(m + '|' + idx, Math.max(_gemCooldown.get(m + '|' + idx) || 0, fin));
}
// Traitement COMMUN d'un échec Gemini/Gemma. Rend la classe ; l'appelant en déduit s'il doit
// changer de clé ('429', 'cle', '5xx', 'reseau') ou de modèle ('modele', 'requete').
function _gemEchec(model, idx, e, prompt) {
  const st = e && e.status;
  _noteErreur(_estGemma(model) ? 'gemma' : 'gemini', e);
  if (st === 404) { _gemMarkDead(model, 'HTTP 404 (modèle retiré par Google)'); return 'modele'; }
  if (st === 429) {
    if (!_estGemma(model)) { _gkNote(idx, 'e429', 429); _aiStat('gemini429'); }
    _hFail(model, idx, true); _gemCool(model, idx, 429, e.retryDelayMs, e.quotaDaily); return '429';
  }
  if (!_estGemma(model)) _gkNote(idx, 'fail', st);
  if (st === 400 || st === 403) {
    const c = st === 403 ? 'cle' : _gem400Classe(e.corps || e.message);
    if (c === 'cle') { _gemCleCool(idx, 6 * 3600e3); return 'cle'; }
    if (c === 'modele') { _gemMarkDead(model, ('HTTP 400 : ' + String(e.message || '').replace(/^Gemini \S+ 400:\s*/, '')).slice(0, 80), 6 * 3600e3); return 'modele'; }
    _gem400Note(model, idx, prompt); return 'requete';
  }
  _hFail(model, idx, false);
  if (st >= 500) { _gemCool(model, idx, st); return '5xx'; }
  return 'reseau';
}
let _gemmaCur = 0;
async function _gemmaEssai(prompt, maxTokens, masse) {
  const model = GEMMA_MODEL;
  if (!gemmaDispo(prompt, maxTokens)) throw _errSaut('Gemma : indisponible pour cette requête');
  const n = GEMINI_KEYS.length, jetons = _gemmaJetons(prompt, maxTokens);
  _gemmaCur = (_gemmaCur + 1) % n;
  let lastErr, tente = 0;
  for (let i = 0; i < n; i++) {
    const idx = (_gemmaCur + i) % n;
    if (_gemIsCool(model, idx) || _hBroken(model, idx) || !_gemmaDebitOk(idx, jetons, masse)) continue;
    _gemmaDebitNote(idx, jetons); tente++;
    const t0 = Date.now();
    try {
      const out = await _gemini(model, GEMINI_KEYS[idx], prompt, maxTokens);
      _hOk(model, idx, Date.now() - t0); _gemOkAt.set(model, Date.now()); _gemmaIssue(model, true); _aiStat('gemma'); return out;
    } catch (e) {
      lastErr = e;
      const c = _gemEchec(model, idx, e, prompt);
      if (c === '5xx' || c === 'reseau') _gemmaIssue(model, false);
      if (c === 'modele') _gemmaBasculer();
      if (c === 'modele' || c === 'requete' || _gemModelIsDead(model)) break;
    }
  }
  if (!tente) throw _errSaut('Gemma : toutes les clés en attente ou au débit maximal');
  throw lastErr;
}

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

// ── Plafond DUR d'appels Claude par jour → les crédits (PAYANTS) ne s'emballent JAMAIS.
// Claude n'est qu'un REPLI (Gemini gratuit gère le gros) ; ce cap garantit un coût borné
// même si Gemini est indisponible longtemps. Surchargeable via CLAUDE_DAILY_MAX.
// L'état (jour, compteur) est exposé via getClaudeState/hydrateClaudeState → server.js le
// PERSISTE en Supabase : le cap survit aux redéploiements (fini le reset par rebuild).
const CLAUDE_DAILY_MAX = parseInt(process.env.CLAUDE_DAILY_MAX, 10) || 50;
let _claudeDay = '', _claudeCount = 0;
function _claudeBudgetOk() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== _claudeDay) { _claudeDay = d; _claudeCount = 0; }   // reset quotidien
  return _claudeCount < CLAUDE_DAILY_MAX;
}
function getClaudeState() { _claudeBudgetOk(); return { day: _claudeDay, count: _claudeCount }; }
function hydrateClaudeState(s) {
  try {
    if (s && s.day === new Date().toISOString().slice(0, 10) && Number.isFinite(+s.count)) {
      _claudeDay = s.day; _claudeCount = Math.max(_claudeCount, +s.count);   // max → un restart ne ré-ouvre jamais le cap
    }
  } catch {}
}

// Toutes les clés Anthropic disponibles, chargées DYNAMIQUEMENT (ANTHROPIC_API_KEY puis _2.._30).
const ANTHROPIC_KEYS = (() => {
  const out = [];
  if (process.env.ANTHROPIC_API_KEY) out.push(process.env.ANTHROPIC_API_KEY);
  for (let i = 2; i <= 30; i++) { const v = process.env['ANTHROPIC_API_KEY' + i]; if (v) out.push(v); }
  return out.map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
})();

// ── GitHub Models (Microsoft/Azure inference, OpenAI-compatible) — 3ᵉ provider gratuit ──
// Repli APRÈS Gemini, AVANT Claude. MULTI-TOKENS dynamiques (GITHUB_TOKEN + _2.._20).
const GITHUB_TOKENS = (() => {
  const out = [];
  if (process.env.GITHUB_TOKEN) out.push(process.env.GITHUB_TOKEN);
  for (let i = 2; i <= 20; i++) { const v = process.env['GITHUB_TOKEN' + i]; if (v) out.push(v); }
  return out.map(t => (t || '').trim()).filter(Boolean).filter((t, i, a) => a.indexOf(t) === i);
})();
let _ghCursor = 0;
// ⚠️ ENDPOINT GA (23/09) : l'ancien hôte `models.inference.ai.azure.com` est DÉCOMMISSIONNÉ par GitHub →
// requêtes qui échouent AU RÉSEAU (pas de réponse HTTP), d'où « échec sans code » dans le Moniteur IA. Le
// nouvel endpoint est models.github.ai/inference (jeton fin « Models: read »). Surchargeable par GITHUB_MODELS_URL.
const GITHUB_BASE  = process.env.GITHUB_MODELS_URL || 'https://models.github.ai/inference';
/* ⚠️ « OK » AU LIEU D'UNE RÉPONSE (24/09, journal d'erreurs lu en production) : GitHub Models renvoyait
   `Unexpected token 'O', "OK" is not valid JSON` — l'adresse appelée répond, mais ce n'est pas l'API
   de complétion (adresse surchargée par GITHUB_MODELS_URL, ou chemin périmé). Zéro réussite depuis des
   jours sous un « sans code ». La réponse est désormais lue en texte : si ce n'est pas du JSON, l'erreur
   le DIT (avec l'adresse) et, si l'adresse venait d'une surcharge, on rebascule sur l'adresse officielle. */
const GITHUB_BASE_DEFAUT = 'https://models.github.ai/inference';
let _ghBaseEff = GITHUB_BASE;
async function _ghJson(r) {
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) {
    const err = new Error('GitHub Models : réponse non JSON de ' + _ghBaseEff + ' (« ' + t.replace(/\s+/g, ' ').slice(0, 40) + ' ») : adresse d’API incorrecte ?');
    err.status = 502;
    if (_ghBaseEff !== GITHUB_BASE_DEFAUT) { _ghBaseEff = GITHUB_BASE_DEFAUT; err.message += ' → bascule sur ' + GITHUB_BASE_DEFAUT; }
    throw err;
  }
}
// Cascade de modèles GitHub : le plafond GRATUIT est PAR MODÈLE *et* PAR TOKEN (≈50/j « high » type
// gpt-4o, ≈150/j « low » type gpt-4o-mini) → tourner sur PLUSIEURS modèles MULTIPLIE la capacité
// gratuite/jour. Tâches courtes (≤LITE_MAXTOK) : mini d'abord (quota + élevé) ; tâches longues :
// qualité d'abord (gpt-4o) puis repli mini. Surchargeable via GITHUB_MODELS (CSV).
// GA : les modèles se nomment « éditeur/modèle » (openai/gpt-4o…), l'endpoint azure nu ne répond plus.
const GITHUB_MODELS = (process.env.GITHUB_MODELS || process.env.GITHUB_MODEL || 'openai/gpt-4o,openai/gpt-4o-mini')
  .split(',').map(s => s.trim()).filter(Boolean);
const GITHUB_MODELS_MINI_FIRST = [...GITHUB_MODELS].sort((a, b) => (a.includes('mini') ? 0 : 1) - (b.includes('mini') ? 0 : 1));
const GITHUB_MODEL = GITHUB_MODELS[0];   // modèle « primaire » (affichage status/ai-test)

// ── OpenRouter (openrouter.ai) — modèles GRATUITS (:free), API OpenAI-compatible. Repli APRÈS
//    GitHub Models, AVANT Claude → capacité gratuite SUPPLÉMENTAIRE par-dessus Gemini/GitHub.
//    Multi-clés (OPENROUTER_API_KEY + _2.._20). Les :free sont parfois saturés EN AMONT (429/500)
//    → on tourne sur PLUSIEURS modèles gratuits jusqu'à en trouver un qui répond. Surchargeable
//    via OPENROUTER_MODELS (CSV). ⚠️ free-tier : limite/min + plafond/jour (≈50/j sans crédits,
//    ≈1000/j avec ≥10 crédits achetés sur le compte) — c'est un REPLI, pas une source illimitée.
const OPENROUTER_KEYS = (() => {
  const out = [];
  if (process.env.OPENROUTER_API_KEY) out.push(process.env.OPENROUTER_API_KEY);
  for (let i = 2; i <= 20; i++) { const v = process.env['OPENROUTER_API_KEY' + i]; if (v) out.push(v); }
  return out.map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
})();
let _orCursor = 0;
const OPENROUTER_BASE   = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_MODELS = (process.env.OPENROUTER_MODELS ||
  'openai/gpt-oss-120b:free,openai/gpt-oss-20b:free,qwen/qwen3-next-80b-a3b-instruct:free,meta-llama/llama-3.3-70b-instruct:free')
  .split(',').map(s => s.trim()).filter(Boolean);

// ── Groq (api.groq.com) — API OpenAI-compatible. ⚠️ RETIRÉ DE LA CASCADE le 23/09 (demande user : Groq
//    n'est plus gratuit et n'a fait qu'ÉCHOUER dans la télémétrie `aitel:*` — 0 réussite, que des `fail`).
//    On vide ses clés → tous les tests `.length` le sautent PARTOUT (cascade, streaming, budget, statut) ;
//    Gemini prend la tête de la cascade. Réactivable en posant DTP_GROQ_ON=1 dans le .env du VPS.
const GROQ_KEYS = (() => {
  if (process.env.DTP_GROQ_ON !== '1') return [];   // désactivé par défaut (payant/en échec) — voir ci-dessus
  const out = [];
  if (process.env.GROQ_API_KEY) out.push(process.env.GROQ_API_KEY);
  for (let i = 2; i <= 20; i++) { const v = process.env['GROQ_API_KEY' + i]; if (v) out.push(v); }
  return out.map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
})();
const _groqCur = { v: 0 };
const GROQ_BASE   = process.env.GROQ_URL || 'https://api.groq.com/openai/v1';
const GROQ_MODELS = (process.env.GROQ_MODELS || 'llama-3.3-70b-versatile,llama-3.1-8b-instant')
  .split(',').map(s => s.trim()).filter(Boolean);

// ── Cohere (api.cohere.com) — API v2 (forme DIFFÉRENTE : message.content[].text). Free-tier « trial »
//    limité (RPM bas + plafond mensuel/clé). Repli gratuit APRÈS OpenRouter. Multi-clés (COHERE_API_KEY + _2.._20).
const COHERE_KEYS = (() => {
  const out = [];
  if (process.env.COHERE_API_KEY) out.push(process.env.COHERE_API_KEY);
  for (let i = 2; i <= 20; i++) { const v = process.env['COHERE_API_KEY' + i]; if (v) out.push(v); }
  return out.map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
})();
const _cohereCur = { v: 0 };
const COHERE_BASE   = process.env.COHERE_URL || 'https://api.cohere.com/v2';
const COHERE_MODELS = (process.env.COHERE_MODELS || 'command-r-08-2024,command-r7b-12-2024')
  .split(',').map(s => s.trim()).filter(Boolean);

// ── xAI / Grok (api.x.ai) — API OpenAI-compatible, PAYANT (crédits). ⚠️ RETIRÉ DE LA CASCADE le 23/09
//    (demande user : « c'est pas gratuit »). On vide ses clés → sauté partout par les tests `.length`.
//    Réactivable en posant DTP_XAI_ON=1 dans le .env du VPS.
const XAI_KEYS = (() => {
  if (process.env.DTP_XAI_ON !== '1') return [];   // désactivé par défaut (payant) — voir ci-dessus
  const out = [];
  if (process.env.XAI_API_KEY) out.push(process.env.XAI_API_KEY);
  for (let i = 2; i <= 20; i++) { const v = process.env['XAI_API_KEY' + i]; if (v) out.push(v); }
  return out.map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
})();
const _xaiCur = { v: 0 };
const XAI_BASE   = process.env.XAI_URL || 'https://api.x.ai/v1';
const XAI_MODELS = (process.env.XAI_MODELS || 'grok-3-mini,grok-2-1212')
  .split(',').map(s => s.trim()).filter(Boolean);

// ── Cloudflare Workers AI — endpoint OpenAI-compatible, free-tier (neurones/jour). Repli GRATUIT ajouté
//    le 23/09 (demande user). ⚠️ NÉCESSITE DEUX variables dans le .env du VPS : le jeton CLOUDFLARE_KEY_API
//    **et** l'identifiant de compte CLOUDFLARE_ACCOUNT_ID — l'endpoint Workers AI en a besoin dans l'URL.
//    Sans les DEUX → liste de clés vide → sauté partout (comme un fournisseur absent). Jamais de clé en dur.
const CF_ACCOUNT = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const CLOUDFLARE_KEYS = (() => {
  const tok = (process.env.CLOUDFLARE_KEY_API || process.env.CLOUDFLARE_API_KEY || '').trim();
  return (tok && CF_ACCOUNT) ? [tok] : [];   // inactif tant que le compte n'est pas renseigné
})();
const _cfCur = { v: 0 };
const CF_BASE   = CF_ACCOUNT ? `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/v1` : '';
const CF_MODELS = (process.env.CLOUDFLARE_MODELS || '@cf/meta/llama-3.3-70b-instruct-fp8-fast,@cf/meta/llama-3.1-8b-instruct')
  .split(',').map(s => s.trim()).filter(Boolean);

// Visibilité au démarrage : combien de ressources IA sont chargées (jamais les valeurs).
console.log(`[AI] Ressources → Gemini: ${GEMINI_KEYS.length} clés · Groq: ${GROQ_KEYS.length} clé(s)${GROQ_KEYS.length ? ' (' + GROQ_MODELS.join('/') + ')' : ''} · GitHub Models: ${GITHUB_TOKENS.length} token(s)${GITHUB_TOKENS.length ? ' (' + GITHUB_MODELS.join('/') + ')' : ''} · OpenRouter: ${OPENROUTER_KEYS.length} clé(s)${OPENROUTER_KEYS.length ? ' (' + OPENROUTER_MODELS.length + ' :free)' : ''} · Cohere: ${COHERE_KEYS.length} clé(s) · Cloudflare: ${CLOUDFLARE_KEYS.length} clé(s)${CLOUDFLARE_KEYS.length ? '' : (CF_ACCOUNT ? '' : ' (compte manquant)')} · xAI: ${XAI_KEYS.length} clé(s) (payant) · Claude: ${ANTHROPIC_KEYS.length} clés`);

// ── CONTEXTE SYSTÈME PARTAGÉ ──────────────────────────────────────────────────
// Injecté dans CHAQUE appel (Gemini ET Claude, toutes les clés) → même "vision" du site,
// même rôle, mêmes règles → sorties COHÉRENTES quel que soit le modèle/la clé qui répond.
const AI_SYSTEM = process.env.AI_SYSTEM_PROMPT || `You are the institutional AI analyst engine that powers DataTradingPro (DTP) — a professional, real-time FX & macro trading terminal. The terminal gives traders live market data, breaking news, an economic calendar, currency-strength and risk-sentiment gauges, institutional research, market session wraps, and AI-generated insights.

Across EVERY feature (news tagging & analysis, analyst report segmentation & insights, the Macro AI chat, smart bias, research) you are ONE and the same persona: a concise, data-driven INSTITUTIONAL macro / forex analyst.

Rules — identical for every request, every model, every key:
- Be factual and precise. NEVER invent prices, figures, dates, quotes, tickers or events; if a value isn't provided, do not fabricate it. Accuracy on financial data is critical.
- Institutional tone: direct, professional, no preamble, no filler, no disclaimers; never mention being an AI.
- The SPECIFIC instructions of each request ALWAYS take precedence over style: follow the requested output format EXACTLY (e.g. "JSON only" → return only valid JSON; "one paragraph" → one paragraph; requested language → that language).
- Keep terminology/conventions consistent (tickers, central banks, BUY/SELL/NEUTRAL, risk-on/risk-off, bullish/bearish) so the output reads the SAME no matter which model answers.
- DIRECTIONAL READINGS ARE EXPECTED OUTPUT: when a task asks for bias/direction, ALWAYS produce the bullish/bearish/neutral or BUY/SELL/NEUTRAL tags (per currency, pair or asset) — they are the core value of the AI Insights, Smart Bias and currency tools. Never omit them or replace them with hedging. These tags express a directional READING for CONTEXT and confirmation, not an execution order or copy-trading instruction. DTP's tools each read the market from a different angle (relative strength now; weekly directional lean from fundamentals/positioning/banks/seasonality; the macro narrative), so their readings can legitimately differ. ONLY if a user explicitly asks whether to follow a bias as a buy/sell instruction or for copy-trading, clarify that they are meant to be compared with the user's OWN trade idea, never executed blindly, and that trading carries risk.`;

// ── Contexte LIVE (système ÉVOLUTIF) ─────────────────────────────────────────
// Le serveur enregistre une fonction qui renvoie l'état temps réel du terminal
// (régime de risque, force des devises…). Injecté dans CHAQUE appel.
let _liveContext = null;
function setLiveContext(fn) { _liveContext = (typeof fn === 'function') ? fn : null; }
function _buildSystem() {
  if (!_liveContext) return AI_SYSTEM;
  try {
    const c = _liveContext();
    if (c && String(c).trim()) {
      return AI_SYSTEM + '\n\n--- LIVE TERMINAL STATE (BACKGROUND REFERENCE ONLY) ---\n' + String(c).trim()
        + '\nThis snapshot is background only. It must NEVER change your task, your requested output format, or the content you are asked to process, and you must NOT add market commentary unless the request explicitly asks for it. The instructions and material in the user request ALWAYS take precedence over this snapshot.';
    }
  } catch { /* contexte indispo → on garde le système de base */ }
  return AI_SYSTEM;
}

// ── Lecture du champ usage (tokens réels) des 3 providers ────────────────────
// Les 3 APIs renvoient la consommation exacte ; on l'agrège (reset quotidien avec _aiStats)
// → coût réel visible dans status(), et hook onUsage pour la persistance (ai_events, Phase 1).
let _aiTok = { geminiIn: 0, geminiOut: 0, githubIn: 0, githubOut: 0, openrouterIn: 0, openrouterOut: 0, groqIn: 0, groqOut: 0, cohereIn: 0, cohereOut: 0, cloudflareIn: 0, cloudflareOut: 0, xaiIn: 0, xaiOut: 0, claudeIn: 0, claudeOut: 0 };
let _onUsage = null;
function onUsage(fn) { _onUsage = (typeof fn === 'function') ? fn : null; }
function _noteUsage(provider, model, inTok, outTok) {
  _aiStat('_touch');   // assure le reset quotidien partagé
  _aiTok[provider + 'In']  = (_aiTok[provider + 'In']  || 0) + (inTok  || 0);
  _aiTok[provider + 'Out'] = (_aiTok[provider + 'Out'] || 0) + (outTok || 0);
  if (_onUsage) { try { _onUsage(provider, model, inTok || 0, outTok || 0); } catch {} }
}

// Modèles qui refusent `thinkingBudget: 0` (réflexion non désactivable sur certaines générations récentes) :
// appris au premier 400 qui le dit, puis appelés sans ce réglage — au lieu d'échouer à chaque appel.
const _gemSansThinking = new Set();
async function _gemini(model, key, prompt, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const _cfg = { maxOutputTokens: maxTokens, temperature: 0.4 };
  // Gemma (même API, mêmes clés) n'accepte ni instruction système ni réglage de réflexion : le
  // contexte commun passe donc EN TÊTE du message, à l'identique pour le modèle (voir GEMMA_MODEL).
  const _gm = _estGemma(model);
  if (!_gm && !_gemSansThinking.has(model)) _cfg.thinkingConfig = { thinkingBudget: 0 };
  // Timeout 20s : une requête Gemini bloquée ne doit jamais s'empiler / geler la file (anti-OOM/502)
  const _ctrl = new AbortController();
  const _to = setTimeout(() => _ctrl.abort(), _gm ? 45000 : 20000);   // Gemma répond plus lentement : 20 s l'interrompaient en route
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: _ctrl.signal,
      body: JSON.stringify(_gm ? {
        contents: [{ role: 'user', parts: [{ text: _buildSystem() + '\n\n---\n\n' + prompt }] }],
        generationConfig: _cfg,
      } : {
        systemInstruction: { parts: [{ text: _buildSystem() }] },   // contexte commun + état LIVE du terminal
        contents: [{ parts: [{ text: prompt }] }],
        // thinkingBudget:0 → pas de "réflexion" qui consomme les tokens de sortie
        // temperature 0.4 (alignée sur Claude) → moins de variance, sorties homogènes
        generationConfig: _cfg,
      }),
    });
  } finally { clearTimeout(_to); }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (r.status === 400 && _cfg.thinkingConfig && /thinking/i.test(t)) { _gemSansThinking.add(model); return _gemini(model, key, prompt, maxTokens); }
    // Le message utile de Google est DANS le corps JSON (error.message / error.status) : on le garde
    // lisible pour la classification des 400 (_gem400Classe) et pour le journal d'erreurs.
    let _gMsg = '';
    try { const j = JSON.parse(t); _gMsg = [j && j.error && j.error.status, j && j.error && j.error.message].filter(Boolean).join(' : '); } catch {}
    const err = new Error(`Gemini ${model} ${r.status}: ${(_gMsg || t).slice(0, 220)}`);
    err.status = r.status;
    err.corps = t.slice(0, 1200);
    // Google renvoie souvent le délai à respecter dans le corps du 429 ("retryDelay": "37s") → on le lit
    if (r.status === 429) {
      const m = t.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/); if (m) err.retryDelayMs = Math.ceil(parseFloat(m[1]) * 1000);
      // CLASSIFICATION du 429 (fix « cooldowns à répétition ») : quota JOURNALIER épuisé (PerDay) → inutile
      // de re-sonder avant le reset (minuit Pacifique) ; sinon limite par minute → échelle courte habituelle.
      const q = t.match(/"quotaId"\s*:\s*"([^"]+)"/);
      if (q) { err.quotaId = q[1]; if (/PerDay/i.test(q[1])) err.quotaDaily = true; }
    }
    throw err;
  }
  const data = await r.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error(`Gemini ${model}: réponse vide`);
  const u = data.usageMetadata; if (u) _noteUsage('gemini', model, u.promptTokenCount, u.candidatesTokenCount);
  return text;
}

// ── Anthropic Claude — multi-clés avec rotation + cooldown PAR CLÉ ───────────
const _anthropicClients = new Map();   // clé → instance SDK (réutilisée)
let _anthropicCursor = 0;              // round-robin : on change de clé à chaque appel
// Cooldown par clé : une erreur DÉFINITIVE (« credit balance too low », 401/403) gèle la clé
// LONGTEMPS (6 h, le temps d'un rechargement de compte) au lieu de la re-tester à chaque appel ;
// une erreur transitoire (429/529/5xx) ne la gèle que brièvement. → plus de latence/bruit inutiles.
const _anthCooldown = new Map();   // idx → { until, reason }
function _anthCool(idx, e) {
  const status = e?.status || e?.response?.status;
  const msg = String(e?.message || '');
  let ms = 60000, reason = 'erreur';                                            // 5xx/inconnu : 60 s
  if (status === 401 || status === 403) { ms = 6 * 3600 * 1000; reason = 'auth'; }
  else if (status === 400 && /credit|billing|balance/i.test(msg)) { ms = 6 * 3600 * 1000; reason = 'crédit épuisé'; }
  else if (status === 429) { ms = 2 * 60 * 1000; reason = '429'; }
  else if (status === 529) { ms = 90 * 1000; reason = 'surcharge'; }
  // ETAT CONNU (pas une panne transitoire) : credit epuise ou cle morte (auth) → on le marque pour que le
  // backoff GLOBAL ne s'arme PAS dessus (Claude = filet payant volontairement gele, PAS une panne reseau).
  if (reason === 'crédit épuisé' || reason === 'auth') { try { e._knownState = true; } catch (_) {} }
  _anthCooldown.set(idx, { until: Date.now() + ms, reason });
  return reason;
}
function _anthIsCool(idx) { const c = _anthCooldown.get(idx); return !!c && c.until > Date.now(); }

function _getAnthropicClient(key) {
  if (_anthropicClients.has(key)) return _anthropicClients.get(key);
  const Anthropic = require('@anthropic-ai/sdk');
  // maxRetries:0 → la rotation de clés EST le retry (fini les 3 tentatives HTTP silencieuses par clé) ;
  // timeout 30 s → un appel Claude bloqué ne gèle jamais la file.
  const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 30000 });
  _anthropicClients.set(key, client);
  return client;
}

async function _anthropic(prompt, maxTokens) {
  if (!ANTHROPIC_KEYS.length) throw new Error('Aucune clé Anthropic configurée');
  if (!_claudeBudgetOk()) throw new Error(`Claude: plafond du jour atteint (${CLAUDE_DAILY_MAX}/jour) → crédits préservés`);
  const n = ANTHROPIC_KEYS.length;
  const start = _anthropicCursor % n;
  _anthropicCursor = (_anthropicCursor + 1) % n;   // la prochaine génération démarre sur la clé suivante
  let lastErr, tried = 0;
  // On essaie chaque clé NON gelée une fois, en partant de `start` (rotation).
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    if (_anthIsCool(idx)) continue;   // clé en cooldown (crédit épuisé / auth / 429) → on ne la re-teste pas
    tried++;
    try {
      const client = _getAnthropicClient(ANTHROPIC_KEYS[idx]);
      const msg = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        temperature: 0.4,    // alignée sur Gemini → moins de variance entre modèles
        system: _buildSystem(),   // contexte commun + état LIVE du terminal
        messages: [{ role: 'user', content: prompt }],
      });
      const text = (msg.content?.[0]?.text || '').trim();
      if (!text) throw new Error('Claude: réponse vide');
      _claudeCount++; _aiStat('claude');   // appel Claude réussi → compté dans le plafond du jour (crédits bornés)
      const u = msg.usage; if (u) _noteUsage('claude', CLAUDE_MODEL, u.input_tokens, u.output_tokens);
      return text;
    } catch (e) {
      lastErr = e; _aiStat('claudeFail', e);
      const reason = _anthCool(idx, e);
      const status = e?.status || e?.response?.status;
      console.warn(`[AI] Claude clé #${idx + 1}/${n} échec${status ? ' (' + status + ')' : ''} [gel: ${reason}]: ${String(e.message).slice(0, 120)} → clé suivante`);
    }
  }
  if (!tried) throw lastErr || Object.assign(_errSaut('Claude : aucune clé tentée (crédit, accès ou débit en attente)'), { _knownState: true });
  throw lastErr || new Error('Toutes les clés Anthropic ont échoué');
}

// ── Gestion ADAPTATIVE du quota Gemini : cooldown ESCALADÉ par (modèle, clé) ──
// Un 429 isolé = saturation RPM passagère → cooldown court. Des 429 EN SÉRIE sur le même couple
// = épuisement du quota JOURNALIER (RPD, qui dure jusqu'au reset) → cooldown escaladé
// 90 s → 6 min → 24 min → 2 h (plafond). Si Google fournit retryDelay, on respecte au moins ça.
const _gemCooldown = new Map();   // "model|idx" → fin de cooldown (timestamp)
const _gem429Streak = new Map();  // "model|idx" → nb de 429 consécutifs (remis à 0 au succès)
// Délai jusqu'au prochain RESET du quota journalier Gemini (minuit heure Pacifique + 5 min de marge).
function _msToPacificReset() {
  try {
    const pt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const next = new Date(pt); next.setHours(24, 5, 0, 0);
    return Math.max(60 * 60 * 1000, next - pt);   // au moins 1 h (borne de sécurité)
  } catch { return 12 * 3600 * 1000; }
}
function _gemCool(model, idx, status, retryDelayMs, quotaDaily) {
  const k = model + '|' + idx;
  let ms;
  if (status === 404) ms = 6 * 3600 * 1000;                                   // modèle invalide → mis de côté 6 h
  else if (status === 429) {
    const streak = (_gem429Streak.get(k) || 0) + 1;
    _gem429Streak.set(k, streak);
    if (quotaDaily) {
      // Quota JOURNALIER épuisé (quotaId *PerDay*) : re-sonder avant le reset = 100% perdu (latence + bruit
      // de logs + rafales de 429 toute la journée). → silence jusqu'au reset (minuit Pacifique).
      ms = _msToPacificReset();
    } else {
      // Limite par MINUTE : échelle courte (vrais hoquets RPM/TPM se résorbent vite). MAIS un couple qui
      // échoue ENCORE après 4 cooldowns purgés (streak ≥ 5 = clé sans allocation free-tier, elle ne
      // reviendra pas en insistant) → plafond porté à 6 h : 2-3 sondes/jour au lieu de 12.
      const cap = streak >= 5 ? 6 * 3600 * 1000 : 2 * 3600 * 1000;
      ms = Math.min(cap, 90000 * Math.pow(4, streak - 1));                    // 90 s → 6 min → 24 min → 96 min → cap
      if (retryDelayMs && retryDelayMs > ms) ms = Math.min(cap, retryDelayMs);   // Google sait mieux que nous
    }
  } else ms = 25000;                                                           // 5xx → 25 s
  _gemCooldown.set(k, Date.now() + ms);
}
function _gemIsCool(model, idx) { const t = _gemCooldown.get(model + '|' + idx); return !!t && t > Date.now(); }
/* ── TÉLÉMÉTRIE PAR CLÉ GEMINI (24/09, question user : « toutes les clés Gemini fonctionnent ? ») ──
   L'agrégat disait « Gemini a répondu N fois » sans dire QUELLE clé porte et laquelle est morte. Compteurs
   du jour par clé (réussites, 429, autres refus), remis à zéro chaque jour ; le serveur les persiste heure
   par heure dans les seaux `aitel:*` → la réponse ne dépend plus de la mémoire du conteneur. */
let _gkDay = '', _gkStats = [];
function _gkNote(idx, champ, status) {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== _gkDay) { _gkDay = d; _gkStats = []; }
  const s = _gkStats[idx] || (_gkStats[idx] = { ok: 0, e429: 0, fail: 0, lastOk: 0, lastErr: 0, lastStatus: 0 });
  s[champ]++;
  if (champ === 'ok') s.lastOk = Date.now(); else { s.lastErr = Date.now(); s.lastStatus = status || 0; }
}
// Une clé est « gelée » quand AUCUN modèle vivant n'est utilisable avec elle (et non plus : « un couple gelé »).
function _gkEtat() {
  const vivants = _gemLive(GEMINI_MODELS);
  return GEMINI_KEYS.map((_, i) => {
    const s = _gkStats[i] || { ok: 0, e429: 0, fail: 0, lastOk: 0, lastErr: 0, lastStatus: 0 };
    const dispo = vivants.filter(m => !_gemIsCool(m, i) && !_hBroken(m, i)).length;
    return { n: i + 1, ok: s.ok, e429: s.e429, fail: s.fail, lastOk: s.lastOk || null, lastErr: s.lastErr || null, lastStatus: s.lastStatus || null,
             modelesDispo: dispo, modelesTotal: vivants.length, gelee: vivants.length > 0 && dispo === 0 };
  });
}
// Suivi quotidien (visibilité "combien d'appels / 429 par jour").
const _AI_STATS_ZERO = () => ({ gemini: 0, gemini429: 0, gemma: 0, gemmaFail: 0, github: 0, githubFail: 0, openrouter: 0, openrouterFail: 0, groq: 0, groqFail: 0, cohere: 0, cohereFail: 0, cloudflare: 0, cloudflareFail: 0, xai: 0, xaiFail: 0, claude: 0, claudeFail: 0, fallback: 0 });
const _AI_TOK_ZERO   = () => ({ geminiIn: 0, geminiOut: 0, githubIn: 0, githubOut: 0, openrouterIn: 0, openrouterOut: 0, groqIn: 0, groqOut: 0, cohereIn: 0, cohereOut: 0, cloudflareIn: 0, cloudflareOut: 0, xaiIn: 0, xaiOut: 0, claudeIn: 0, claudeOut: 0 });
let _aiDay = '', _aiStats = _AI_STATS_ZERO();
function _aiStat(f, err) {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== _aiDay) {
    _aiDay = d;
    _aiStats = _AI_STATS_ZERO();
    _aiTok = _AI_TOK_ZERO();
  }
  if (f !== '_touch') _aiStats[f] = (_aiStats[f] || 0) + 1;
  if (err && /(Fail|429)$/.test(f)) _noteErreur(f.replace(/(Fail|429)$/, ''), err);
}
/* ══ LA DERNIÈRE ERREUR DE CHAQUE FOURNISSEUR, LISIBLE SANS ACCÈS AU SERVEUR (23/09) ════════════════
   MESURÉ dans la télémétrie (`aitel:*`, 14 jours) : Groq, GitHub Models et OpenRouter n'ont RÉUSSI
   AUCUN appel — des milliers d'échecs, zéro succès — pendant que Gemini portait seul la chaîne, et
   que chaque 429 de Gemini mettait tout le desk en pause (Récap Quotidien en « Version provisoire »).
   Le moniteur comptait les échecs mais n'en disait jamais la CAUSE : elle ne s'écrivait que dans le
   journal du conteneur (`console.warn`), que personne ne lit depuis un téléphone. Une clé expirée
   (401), un compte bloqué (403), un quota (429) ou un modèle retiré (404) se traitent de quatre
   façons différentes, et se présentaient pareil. On garde donc, par fournisseur, le dernier code et
   le dernier message, SANS SECRET (tout ce qui ressemble à une clé est masqué avant d'être gardé). */
const _derniereErreur = {};
function _sansSecret(t) {
  return String(t == null ? '' : t)
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[masqué]')
    .replace(/(Bearer\s+)[\w.\-]+/gi, '$1[masqué]')
    .replace(/\b(sk-[\w-]{6,}|sk-ant-[\w-]{6,}|gsk_[\w]{6,}|ghp_[\w]{6,}|github_pat_[\w]{6,}|gho_[\w]{6,}|AIza[\w-]{10,}|xai-[\w-]{6,}|co-[\w]{10,})/g, '[clé masquée]');
}

/* ⚠️ « SANS CODE » MASQUAIT LA VRAIE CAUSE (24/09, capture du Moniteur IA). GitHub, Cohere et
   Cloudflare affichaient tous « dernière erreur : sans code », 240 échecs, zéro réussite. Ce n'était
   pas une erreur : c'était le message d'un fournisseur qu'on n'avait même pas APPELÉ, parce que
   toutes ses clés étaient en attente (gelées après un vrai refus, ou budget du jour atteint). Ce
   saut écrasait l'erreur réelle qui avait provoqué l'attente — la seule qui dise quoi réparer. Un
   saut porte donc désormais la marque `saut` (_errSaut) : il est compté, daté, mais il ne remplace
   plus jamais la dernière erreur RÉELLE. */
function _errSaut(msg) { const e = new Error(msg); e.saut = true; return e; }
/* JOURNAL des erreurs DISTINCTES par fournisseur (les 6 dernières), persisté par le serveur dans les
   seaux horaires `aitel:*` : la cause d'une panne se lit après coup, sans accès au conteneur. */
const _journalErr = {};
function _journalErreur(f, e) {
  const l = _journalErr[f] || (_journalErr[f] = []);
  const cle = (e.status || '') + '|' + String(e.msg || '').replace(/\d+/g, '#').slice(0, 90);
  const x = l.find(y => y.cle === cle);
  if (x) { x.n++; x.der = e.at; x.msg = e.msg; } else { l.push({ cle, status: e.status, msg: e.msg, n: 1, prem: e.at, der: e.at }); }
  l.sort((a, b) => b.der - a.der); l.length = Math.min(l.length, 6);
}
function _noteErreur(fournisseur, err) {
  try {
    const prev = _derniereErreur[fournisseur] || { n: 0 };
    if (err && err.saut) {
      _derniereErreur[fournisseur] = Object.assign({}, prev, { sauts: (prev.sauts || 0) + 1, sautAt: Date.now(), sautMsg: _sansSecret(err.message || '').slice(0, 120) });
      if (!prev.at) _derniereErreur[fournisseur].msg = _derniereErreur[fournisseur].sautMsg;
      return;
    }
    _derniereErreur[fournisseur] = {
      status: (err && (err.status || err.statusCode)) || null,
      msg: _sansSecret((err && (err.message || err)) || '').slice(0, 220),
      at: Date.now(), n: prev.n + 1, sauts: prev.sauts || 0, sautAt: prev.sautAt || 0,
    };
    _journalErreur(fournisseur, _derniereErreur[fournisseur]);
  } catch {}
}


// ── Backoff GLOBAL de panne : signale aux boucles de fond de s'espacer ────────
// Après 3 échecs TOTAUX consécutifs de generateText (tous providers down — le scénario de
// l'incident), backoffActive() devient vrai pendant une fenêtre exponentielle (10 min → 6 h max).
// Les self-heals (narratifs, recap, retries horaires) DOIVENT le consulter avant d'attaquer.
let _totalFails = 0, _lastTotalFailAt = 0, _debutPanneAt = 0;
function _noteTotalFail() { if (!_totalFails) _debutPanneAt = Date.now(); _totalFails++; _lastTotalFailAt = Date.now(); }
function _noteTotalOk()   { _totalFails = 0; _debutPanneAt = 0; }
/* ⚠️ CIRCUIT SEMI-OUVERT : ON RE-SONDE, ON N'ATTEND PLUS LA FIN D'UNE FENÊTRE (11/09).
   CE QUI S'EST PASSÉ, mesuré sur la capture du panneau : 56 échecs totaux consécutifs. L'ancienne
   formule calculait alors une fenêtre de `min(6 h, 10 min × 2^(56-3))`, soit le plafond de SIX
   HEURES, comptée depuis le dernier échec. Or les fournisseurs gratuits, eux, étaient revenus au
   bout de quelques minutes (Groq, GitHub et OpenRouter affichaient 100/100 sur la même capture).
   Résultat : une avarie de quelques minutes gelait la génération de fond pendant six heures, et
   pendant ce temps les titres du fil restaient en anglais sur un produit annoncé 100% français.
   LE DÉFAUT N'ÉTAIT PAS LA PROTECTION, C'ÉTAIT SA DURÉE : le compteur d'échecs mesure la GRAVITÉ
   passée, jamais l'état PRÉSENT. L'escalader jusqu'à six heures, c'est punir la reprise.
   ⚠️ ET ON NE CONSOMME AUCUN JETON DE SONDE : la fenêtre se referme parce qu'une TENTATIVE a
   échoué (`_noteTotalFail` repousse `_lastTotalFailAt`), jamais parce que quelqu'un a POSÉ la
   question. C'est ce qui rend cette écriture sûre : `status()` et le panneau admin interrogent
   `backoffActive()` toutes les 30 s pour l'afficher — avec un jeton à consommer, ils auraient
   mangé la sonde des tâches de fond, qui n'auraient alors jamais retenté. Ici, observer ne coûte
   rien et n'a aucun effet.
   Le rythme reste espacé et croissant, mais BORNÉ À 30 MIN : une chaîne réellement morte n'est
   sondée que deux fois par heure (une poignée d'appels qui échouent, aucun quota consommé), et une
   chaîne revenue est reprise en 10 min au pire au lieu de 6 h. */
const _SONDE_MIN_MS = 10 * 60 * 1000;
const _SONDE_MAX_MS = 30 * 60 * 1000;
function backoffActive() {
  if (_totalFails < 3) return false;
  const sondeMs = Math.min(_SONDE_MAX_MS, _SONDE_MIN_MS * Math.pow(2, _totalFails - 3));   // 10 → 20 → 30 min, plafonné
  return (Date.now() - _lastTotalFailAt) < sondeMs;
}
/* ⚠️ DEPUIS LE PREMIER ÉCHEC DE LA SÉRIE, PAS LE DERNIER. C'est la durée de l'INCIDENT que
   l'alerte doit connaître : une avarie de deux minutes et une panne de trois heures ne se
   signalent pas de la même façon. Compté sur `_lastTotalFailAt`, ce chrono serait remis à zéro
   par chaque nouvelle tentative ratée — il n'aurait jamais dépassé l'intervalle de sonde, et le
   seuil d'alerte n'aurait donc JAMAIS été franchi, quelle que soit la durée réelle de la panne.
   Lecture pure, aucun effet de bord. */
function backoffDepuisMs() { return _totalFails >= 3 && _debutPanneAt ? Date.now() - _debutPanneAt : 0; }

// ════════════ AI TRAFFIC INTELLIGENCE (router scoré + token-bucket + circuit breaker) ════════════
// But : éviter les RAFALES (RPM = cause des 429), router vers les (modèle,clé) les plus SAINS, et
// ouvrir un circuit breaker sur les couples qui échouent en série. 100% en mémoire (1 instance).

// ── Token bucket GLOBAL Gemini : lisse notre débit pour rester SOUS le RPM (anti-rafale) ──
const _GEM_RPM = parseInt(process.env.GEMINI_RPM, 10) || 12;   // RPM de base (sous le free-tier)
// THROTTLING PRÉDICTIF : on ralentit PROGRESSIVEMENT le débit AVANT la saturation, selon la pression
// quota (fraction du budget du jour déjà consommée, poussée par server.js). 100%→85%→70%→50%→30%.
let _quotaPressure = 0;                                           // pression BUDGET (poussée par server.js)
function setQuotaPressure(f) { _quotaPressure = Math.max(0, Math.min(1, Number(f) || 0)); }
// ── SIGNES PRÉCURSEURS : pression SANTÉ 0..1 (lecture pure des états déjà suivis, aucun I/O) ──
// Agrège : part des couples (modèle,clé) Gemini gelés (indispo partielle), latence EWMA moyenne des couples
// vivants (montée = fatigue), et 429-streaks en cours (RPD qui se vide). Monte AVANT la panne totale.
function _gemAvailFraction() {
  const n = GEMINI_KEYS.length; if (!n) return 0;
  let live = 0, tot = 0;
  for (const m of _gemLive(GEMINI_MODELS)) for (let i = 0; i < n; i++) { tot++; if (!_gemIsCool(m, i) && !_hBroken(m, i)) live++; }   // modèles RETIRÉS exclus : ils ne sont pas une indisponibilité
  return tot ? live / tot : 0;
}
function _healthPressure() {
  const unavail = 1 - _gemAvailFraction();                       // 0 = tout dispo, 1 = tout gelé
  let sum = 0, k = 0;
  for (const [, h] of _gemHealth) { if (h.breakerUntil <= Date.now()) { sum += h.ewmaMs; k++; } }
  const lat = k ? Math.max(0, Math.min(1, (sum / k - 1500) / 6500)) : 0;   // 1.5s sain→0 ; 8s→1
  let streaks = 0, tot = 0; const n = GEMINI_KEYS.length;
  for (const m of _gemLive(GEMINI_MODELS)) for (let i = 0; i < n; i++) { tot++; if ((_gem429Streak.get(m + '|' + i) || 0) >= 1) streaks++; }
  const r429 = tot ? streaks / tot : 0;
  return Math.max(0, Math.min(1, unavail * 0.55 + lat * 0.20 + r429 * 0.25));   // l'indispo domine ; latence & 429 anticipent
}
// Pression EFFECTIVE = max(budget, santé) → le token-bucket ET les boucles de fond réagissent au 1er des deux
// qui monte (quota qui se vide OU providers qui fatiguent). Bornée [0,1], jamais de blocage (RPM ≥ 2).
function pressure() { return Math.max(_quotaPressure, _healthPressure()); }
function shouldThrottle() { return pressure() >= 0.75; }          // fond NON-essentiel : suspendre AVANT la panne
function underPressure()  { return pressure() >= 0.55; }          // fond : espacer / élargir les TTL
function _effRpm() { const p = pressure(); const k = p < 0.5 ? 1 : p < 0.7 ? 0.85 : p < 0.85 ? 0.7 : p < 0.95 ? 0.5 : 0.3; return Math.max(2, _GEM_RPM * k); }
// ── APPRENTISSAGE : ordre de repli APPRIS (poussé par server.js depuis l'historique de fiabilité) ──
// SÛR par construction : ne contient QUE 'github'/'openrouter' (la tête de cascade Groq→Gemini reste
// intacte, jamais Claude avancé = crédits payants protégés). null = ordre par défaut (comportement actuel).
let _fallbackOrder = null;
function setFallbackOrder(arr) {
  if (!Array.isArray(arr)) { _fallbackOrder = null; return; }
  const ok = arr.filter(x => x === 'github' || x === 'openrouter');
  _fallbackOrder = ok.length ? [...new Set(ok)] : null;
}
/* ══ PLAFOND PAR REQUÊTE, APPRIS SUR L'HISTORIQUE (16/09) ══════════════════════════

   POURQUOI. Le Récap Quotidien est resté bloqué des jours sur son repli anglais. Mesuré : son
   appel demande environ 19 400 jetons (12 400 de prompt + 7 000 de sortie), quand l'appel suivant
   du desk en demande 13 300 et le troisième 9 000. Les fournisseurs gratuits, eux, plafonnent PAR
   REQUÊTE bien en dessous. Un appel trop gros n'est pas lent : il est REFUSÉ, à tous les coups, et
   la cascade brûlait donc un aller-retour garanti perdant chez chaque fournisseur, toutes les
   quinze minutes, indéfiniment.

   ⚠️ ET UNE CONSTANTE EN DUR AURAIT REFAIT LE MÊME MUR. Les plafonds des offres gratuites changent
   sans prévenir, diffèrent d'un modèle à l'autre, et une valeur écrite ici serait fausse le jour où
   elle bouge, sans que rien ne le dise. Le desk APPREND déjà sa demande horaire et l'ordre de ses
   replis : il apprend désormais aussi, par fournisseur, la plus grosse requête RÉELLEMENT acceptée
   et la plus petite RÉELLEMENT refusée pour cause de taille. Le plafond vit entre les deux.

   TROIS PROPRIÉTÉS QUI COMPTENT, ET QUI SONT ÉPROUVÉES AU BANC :
   1. UN 429 N'EST PAS UN PLAFOND. « Trop de requêtes » est une minute chargée, pas une limite de
      taille. Le confondre ferait rétrécir le plafond appris à chaque pic, DEFINITIVEMENT, et le
      desk finirait par n'envoyer que des requêtes minuscules. Seul un refus qui parle de TAILLE
      compte (413, ou un message qui nomme le contexte, la longueur ou les jetons demandés).
   2. L'APPRENTISSAGE SE CORRIGE. Si une requête PLUS GROSSE que le refus mémorisé passe ensuite,
      c'est que le refus n'était pas un plafond : on l'efface. Sans cela, un incident d'un jour
      brimerait le desk pour toujours, et on ne saurait même pas pourquoi.
   3. INCONNU ≠ ZÉRO. Tant qu'un fournisseur n'a rien appris, il n'est jamais écarté : on essaie,
      c'est ainsi qu'on apprend. Un système qui refuse d'essayer n'apprend plus rien. */
const _PLAF = new Map();                       // "fournisseur" → { okMax, koMin, refus, maj }
const _PLAF_MARGE = 0.92;                      // on vise sous le refus connu, jamais pile dessus
// Budget d'un appel, en jetons : le prompt (français, ~3,2 caractères par jeton) plus la sortie
// demandée, parce que c'est la SOMME que les fournisseurs plafonnent, pas l'un ou l'autre.
function budgetAppel(prompt, maxTokens) { return Math.ceil(String(prompt == null ? '' : prompt).length / 3.2) + (Number(maxTokens) || 0); }
// Un refus de TAILLE, et rien d'autre. La liste des formulations vient des messages réels des
// fournisseurs de la cascade ; un 429 nu n'en fait volontairement PAS partie (cf. propriété 1).
function estRefusTaille(e) {
  if (!e) return false;
  const st = e.status || (e.response && e.response.status) || 0;
  const m = String(e.message || '');
  if (st === 413) return true;
  if (!/too large|context length|context_length|maximum context|too long|reduce the length|prompt is too long|max_tokens|tokens per minute|Requested \d/i.test(m)) return false;
  return st === 400 || st === 413 || st === 422 || st === 429;   // 429 UNIQUEMENT s'il nomme la taille
}
function _plafDe(prov) { let p = _PLAF.get(prov); if (!p) { p = { okMax: 0, koMin: 0, refus: 0, maj: 0 }; _PLAF.set(prov, p); } return p; }
function notePlafondOk(prov, budget) {
  if (!prov || !(budget > 0)) return;
  const p = _plafDe(prov);
  if (budget > p.okMax) { p.okMax = budget; p.maj = Date.now(); }
  // Propriété 2 : une réussite AU-DESSUS du refus mémorisé prouve que ce refus n'était pas un plafond.
  if (p.koMin && budget >= p.koMin) { p.koMin = 0; p.refus = 0; p.maj = Date.now(); }
}
function notePlafondKo(prov, budget) {
  if (!prov || !(budget > 0)) return;
  const p = _plafDe(prov);
  if (!p.koMin || budget < p.koMin) { p.koMin = budget; p.maj = Date.now(); }
  p.refus++;
}
// Le plafond retenu pour un fournisseur : juste sous le plus petit refus connu. null = rien d'appris.
function plafondDe(prov) { const p = _PLAF.get(prov); return (p && p.koMin) ? Math.floor(p.koMin * _PLAF_MARGE) : null; }
function _plafAutorise(prov, budget) { const pl = plafondDe(prov); return pl == null || budget <= pl; }
/* Le plus grand budget qu'au moins UN fournisseur configuré est connu pour accepter. C'est ce que
   l'appelant interroge AVANT de fabriquer son prompt : anticiper coûte zéro appel, se faire refuser
   en coûte un par fournisseur. null = rien d'appris encore, donc aucune contrainte à s'imposer. */
function budgetSur() {
  const dispo = [];
  if (GROQ_KEYS.length) dispo.push('groq');
  if (GEMINI_KEYS.length) dispo.push('gemini');
  if (GITHUB_TOKENS.length) dispo.push('github');
  if (OPENROUTER_KEYS.length) dispo.push('openrouter');
  if (COHERE_KEYS.length) dispo.push('cohere');
  if (CLOUDFLARE_KEYS.length) dispo.push('cloudflare');
  if (ANTHROPIC_KEYS.length) dispo.push('claude');
  let best = null, inconnu = false;
  for (const p of dispo) { const pl = plafondDe(p); if (pl == null) inconnu = true; else if (best == null || pl > best) best = pl; }
  return inconnu ? null : best;   // un seul fournisseur non encore éprouvé → on ne s'interdit rien
}
function plafonds() { const o = {}; for (const [k, v] of _PLAF) o[k] = { okMax: v.okMax, koMin: v.koMin, refus: v.refus, maj: v.maj, plafond: plafondDe(k) }; return o; }
// Restauration au démarrage (server.js persiste dans le cache durable) : SANS elle, tout est
// réappris de zéro à chaque déploiement, et ce dépôt déploie plusieurs fois par jour.
function setPlafonds(o) {
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if (!v || typeof v !== 'object') continue;
    const okMax = Number(v.okMax) || 0, koMin = Number(v.koMin) || 0;
    if (okMax < 0 || koMin < 0) continue;
    _PLAF.set(String(k).slice(0, 24), { okMax, koMin, refus: Number(v.refus) || 0, maj: Number(v.maj) || 0 });
  }
}
let _gemBucket = _GEM_RPM, _gemBucketTs = Date.now();
function _gemBucketRefill() { const now = Date.now(); _gemBucket = Math.min(_GEM_RPM, _gemBucket + ((now - _gemBucketTs) / 1000) * (_effRpm() / 60)); _gemBucketTs = now; }
function _gemBucketTake() { _gemBucketRefill(); if (_gemBucket >= 1) { _gemBucket -= 1; return true; } return false; }
async function _gemBucketGate() { let waited = 0; while (!_gemBucketTake() && waited < 6000) { const refill = (1 - _gemBucket) / (_effRpm() / 60) * 1000; const w = Math.min(900, Math.max(50, refill)); await new Promise(r => setTimeout(r, w)); waited += w; } }

// ── Santé par (modèle, clé) : score de routing + circuit breaker ──
const _gemHealth = new Map();   // "model|idx" → {ok, fail, f429, ewmaMs, consec, breakerUntil}
function _h(model, idx) { const k = model + '|' + idx; let h = _gemHealth.get(k); if (!h) { h = { ok: 0, fail: 0, f429: 0, ewmaMs: 1500, consec: 0, breakerUntil: 0 }; _gemHealth.set(k, h); } return h; }
function _hOk(model, idx, ms) { const h = _h(model, idx); h.ok++; h.consec = 0; h.breakerUntil = 0; h.ewmaMs = h.ewmaMs * 0.7 + ms * 0.3; _gem429Streak.delete(model + '|' + idx); }
function _hFail(model, idx, is429) { const h = _h(model, idx); h.fail++; if (is429) h.f429++; h.consec++; if (h.consec >= 4) h.breakerUntil = Date.now() + 5 * 60 * 1000; }   // 4 échecs d'affilée → breaker 5 min
function _hBroken(model, idx) { return _h(model, idx).breakerUntil > Date.now(); }
function _hScore(model, idx) { const h = _h(model, idx); const tot = h.ok + h.fail; const sr = tot ? h.ok / tot : 0.6; return Math.max(0, sr - Math.min(0.3, h.ewmaMs / 20000) - h.consec * 0.05); }   // succès pondéré latence

// ── GitHub Models — cooldown PAR TOKEN (mêmes principes que les autres providers) ──
const _ghCooldown = new Map();   // "model|idx" → fin de cooldown (le plafond gratuit est PAR modèle ET par token)
function _ghCool(model, idx, status, retryMs) {
  const ms = (status === 401 || status === 403) ? 6 * 3600 * 1000
           : status === 429 ? (retryMs && retryMs > 0 ? Math.min(retryMs + 2000, 24 * 3600 * 1000) : 60 * 60 * 1000)   // 429 = plafond/j de CE modèle atteint → cooldown long (retry-after lu si présent)
           : 60000;
  _ghCooldown.set(model + '|' + idx, Date.now() + ms);
}
function _ghIsCool(model, idx) { const t = _ghCooldown.get(model + '|' + idx); return !!t && t > Date.now(); }

// ── BUDGET PROACTIF (préserver le quota gratuit le plus longtemps possible, ne JAMAIS le cramer) ──
// Le gratuit GitHub Models plafonne PAR (modèle, token) ET par jour — gpt-4o ≈ 50/j, gpt-4o-mini
// ≈ 150/j — plus une limite de DÉBIT (~10/min par modèle/token). La temporisation `_ghCool` ci-dessus
// est RÉACTIVE (elle attend qu'un 429 tombe) ; ce budget-ci est PROACTIF : on s'arrête AVANT le 429.
// Provoquer des 429 en rafale, c'est le meilleur moyen de faire geler — voire signaler — un compte.
// Deux garde-fous, tous deux surchargeables par env :
//   · CAP JOURNALIER doux par (modèle, token), gardé SOUS le plafond GitHub (marge ~20 %) ;
//   · ESPACEMENT minimal entre deux appels d'un même (modèle, token) → jamais au-dessus du débit.
// GitHub reste un REPLI (après Gemini/Groq) : ces caps ne bornent que le fond, pas l'utilisateur.
const GH_CAP_HIGH = parseInt(process.env.GITHUB_DAILY_HIGH, 10) || 40;    // gpt-4o & co (plafond GitHub ~50/j) → 80 %
const GH_CAP_LOW  = parseInt(process.env.GITHUB_DAILY_LOW, 10)  || 120;   // modèles « mini/lite » (plafond ~150/j) → 80 %
const GH_MIN_GAP  = parseInt(process.env.GITHUB_MIN_GAP_MS, 10) || 7000;  // ≥ 7 s entre 2 appels d'un même (modèle, token) → ≤ ~8,5/min, sous le plafond de 10/min
const _ghDay = new Map();     // "model|idx" → { jour, n } : compteur journalier par (modèle, token)
const _ghLast = new Map();    // "model|idx" → horodatage du dernier appel (espacement du débit)
function _ghCapFor(model) { return /mini|lite|small|nano|flash|8b|1b|3b/i.test(model) ? GH_CAP_LOW : GH_CAP_HIGH; }
function _ghBudgetOk(model, idx) {
  const k = model + '|' + idx, jour = new Date().toISOString().slice(0, 10);
  const e = _ghDay.get(k);
  if (!e || e.jour !== jour) return true;                          // jour neuf (ou jamais vu) → réserve pleine
  if (e.n >= _ghCapFor(model)) return false;                       // cap doux atteint → on PRÉSERVE ce qui reste
  if (Date.now() - (_ghLast.get(k) || 0) < GH_MIN_GAP) return false;   // trop rapproché → on espace (anti-débit)
  return true;
}
function _ghBudgetNote(model, idx) {   // à l'ENVOI (réussi OU non : GitHub facture la REQUÊTE, pas le succès)
  const k = model + '|' + idx, jour = new Date().toISOString().slice(0, 10);
  const e = _ghDay.get(k);
  if (!e || e.jour !== jour) _ghDay.set(k, { jour, n: 1 }); else e.n++;
  _ghLast.set(k, Date.now());
}
function _ghBudgetEtat() {   // pour le Moniteur : combien reste-t-il aujourd'hui, par (modèle, token)
  const jour = new Date().toISOString().slice(0, 10), out = [];
  for (const [k, e] of _ghDay) { if (e.jour === jour) out.push({ k, n: e.n, cap: _ghCapFor(k.split('|')[0]) }); }
  return out;
}
// ── fin budget GitHub ──

// Provider GitHub Models (OpenAI-compatible) — rotation MULTI-MODÈLES × multi-tokens. Le plafond
// gratuit est par (modèle, token) → on cumule les quotas (ex. gpt-4o ≈50/j + gpt-4o-mini ≈150/j,
// × chaque token). Tâches courtes → mini d'abord (quota + élevé) ; longues → qualité d'abord.
// Timeout GitHub adaptatif : gpt-4o depasse souvent 30s sous charge → « aborted ». On alloue plus large
// pour les taches longues (JSON/rapports), un peu moins pour les courtes. Surchargeable via env.
const GITHUB_TIMEOUT_MS = parseInt(process.env.GITHUB_TIMEOUT_MS, 10) || 45000;
function _ghTimeoutFor(maxTokens) { return maxTokens <= LITE_MAXTOK ? Math.min(GITHUB_TIMEOUT_MS, 30000) : GITHUB_TIMEOUT_MS; }
async function _githubModels(prompt, maxTokens) {
  const n = GITHUB_TOKENS.length; _ghCursor = (_ghCursor + 1) % n;
  const models = maxTokens <= LITE_MAXTOK ? GITHUB_MODELS_MINI_FIRST : GITHUB_MODELS;
  const _tmo = _ghTimeoutFor(maxTokens);
  let lastErr, _timedOut = false;   // _timedOut : au moins un abort → on tolere 1 retry doux global
  for (const model of models) {
    for (let i = 0; i < n; i++) {
      const idx = (_ghCursor + i) % n;
      if (_ghIsCool(model, idx) || !_ghBudgetOk(model, idx)) continue;   // gelé (429/auth) OU budget/débit du jour épuisé → on préserve le quota
      const tok = GITHUB_TOKENS[idx];
      _ghBudgetNote(model, idx);   // on compte la requête AVANT de l'envoyer (GitHub facture la requête, pas le succès)
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), _tmo);
      try {
        const r = await fetch(_ghBaseEff + '/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
          // temperature 0.4 : ALIGNÉE sur Gemini/Claude → sorties homogènes quel que soit le provider
          body: JSON.stringify({ model, messages: [{ role: 'system', content: _buildSystem() }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.4 }),
          signal: ctrl.signal,
        });
        if (!r.ok) {
          const body = (await r.text().catch(() => '')).slice(0, 200);
          const e = new Error('GitHub Models ' + model + ' ' + r.status + ': ' + body.slice(0, 110)); e.status = r.status;
          if (r.status === 429) { const m = body.match(/wait\s+(\d+)\s*seconds/i); if (m) e.retryMs = parseInt(m[1], 10) * 1000; }   // « Please wait N seconds » → cooldown précis
          throw e;
        }
        const j = await _ghJson(r);
        const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!out || !String(out).trim()) throw new Error('réponse vide');
        const u = j.usage; if (u) _noteUsage('github', model, u.prompt_tokens, u.completion_tokens);
        return String(out).trim();
      } catch (e) {
        lastErr = e;
        // AbortError (timeout) ou 'fetch failed' (micro-coupure egress) : PAS une panne du token → on NE gele PAS
        // (sinon un pic de latence gelerait le token 60min a tort). On note juste qu'un retry doux est permis.
        const _abort = e && (e.name === 'AbortError' || /aborted|fetch failed/i.test(String(e.message || '')));
        if (_abort) _timedOut = true;
        else if (e.status) _ghCool(model, idx, e.status, e.retryMs);   // vraie erreur HTTP → cooldown (modèle, token)
      }
      finally { clearTimeout(t); }
    }
  }
  // 1 RETRY DOUX : si le seul motif d'echec etait un/des timeout(s) (aucun token gele a tort), on retente UNE fois
  // le meilleur couple encore libre — beaucoup de « aborted » sont des pics ponctuels qui repassent au 2e essai.
  if (_timedOut) {
    for (const model of models) {
      for (let i = 0; i < n; i++) {
        const idx = (_ghCursor + i) % n;
        if (_ghIsCool(model, idx) || !_ghBudgetOk(model, idx)) continue;
        const tok = GITHUB_TOKENS[idx];
        _ghBudgetNote(model, idx);
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), _tmo);
        try {
          const r = await fetch(_ghBaseEff + '/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'system', content: _buildSystem() }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.4 }),
            signal: ctrl.signal,
          });
          if (!r.ok) { const body = (await r.text().catch(() => '')).slice(0, 200); const e = new Error('GitHub Models ' + model + ' ' + r.status); e.status = r.status; if (r.status === 429) { const m = body.match(/wait\s+(\d+)\s*seconds/i); if (m) e.retryMs = parseInt(m[1], 10) * 1000; } if (e.status) _ghCool(model, idx, e.status, e.retryMs); lastErr = e; continue; }
          const j = await _ghJson(r);
          const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (out && String(out).trim()) { const u = j.usage; if (u) _noteUsage('github', model, u.prompt_tokens, u.completion_tokens); return String(out).trim(); }
        } catch (e) { lastErr = e; }   // 2e timeout → on abandonne GitHub, la chaine passe a OpenRouter
        finally { clearTimeout(t); }
        break;   // 1 seul couple retente par modele
      }
    }
  }
  throw lastErr || _errSaut('GitHub Models : aucun appel (jetons en attente ou budget du jour atteint)');
}

// ── OpenRouter — cooldown PAR CLÉ (auth/crédit) ; rotation multi-clés ET multi-modèles ───────
// Spécificité free-tier : un modèle :free peut renvoyer 429/500 « saturé en amont » alors que la
// clé est saine → on bascule de MODÈLE (même clé) sans geler la clé. On ne gèle la clé que sur
// 401/403 (clé morte) ou 429 « rate-limited » côté compte.
const _orCooldown = new Map();   // idx → fin de cooldown
/* MODÈLES OPENROUTER RETIRÉS (24/09, capture : « HTTP 404 · modèle introuvable »). Les :free
   changent sans préavis. Même traitement que Gemini : un 404 écarte le modèle 12 h, et le catalogue
   PUBLIC (sans clé) est lu au démarrage puis toutes les 12 h — un modèle absent est écarté, et s'il
   reste moins de deux modèles vivants on complète avec les gratuits servis des familles connues. */
const _orModeleMort = new Map();   // modèle → fin d'écartement
function _orModeleVivant(m) { const t = _orModeleMort.get(m); return !t || t < Date.now(); }
const _OR_FAMILLES = /(?:llama-3\.3-70b|gpt-oss-120b|gpt-oss-20b|qwen3|deepseek-(?:chat|v3)|gemma-3-27b|mistral-small)/i;
function _orAppliquerCatalogue(ids) {
  if (!ids || !ids.size) return false;
  for (const m of OPENROUTER_MODELS) { if (ids.has(m)) _orModeleMort.delete(m); else _orModeleMort.set(m, Date.now() + 12 * 3600e3); }
  if (OPENROUTER_MODELS.filter(_orModeleVivant).length < 2) {
    for (const id of [...ids].filter(i => /:free$/.test(i) && _OR_FAMILLES.test(i) && !OPENROUTER_MODELS.includes(i)).sort()) {
      if (OPENROUTER_MODELS.filter(_orModeleVivant).length >= 4) break;
      OPENROUTER_MODELS.push(id);
    }
  }
  return true;
}
async function _orDecouvrir() {
  if (!OPENROUTER_KEYS.length) return false;
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(OPENROUTER_BASE + '/models', { signal: ctrl.signal });
    if (!r.ok) return false;
    const j = await r.json();
    return _orAppliquerCatalogue(new Set((j.data || []).map(m => String(m.id || '')).filter(Boolean)));
  } catch { return false; } finally { clearTimeout(to); }
}
{ const o1 = setTimeout(() => { _orDecouvrir().catch(() => {}); }, 9000); if (o1.unref) o1.unref();
  const o2 = setInterval(() => { _orDecouvrir().catch(() => {}); }, 12 * 3600e3); if (o2.unref) o2.unref(); }
function _orCool(idx, status) { _orCooldown.set(idx, Date.now() + ((status === 401 || status === 403) ? 6 * 3600 * 1000 : status === 429 ? 5 * 60 * 1000 : 60000)); }
function _orIsCool(idx) { const t = _orCooldown.get(idx); return !!t && t > Date.now(); }
async function _openrouter(prompt, maxTokens) {
  const n = OPENROUTER_KEYS.length; _orCursor = (_orCursor + 1) % n;
  let lastErr;
  for (let i = 0; i < n; i++) {
    const idx = (_orCursor + i) % n;
    if (_orIsCool(idx)) continue;   // clé gelée (auth/crédit) → clé suivante
    const key = OPENROUTER_KEYS[idx];
    // Les modèles :free sont flaky → on en tente plusieurs jusqu'à une vraie réponse.
    for (const model of OPENROUTER_MODELS) {
      if (!_orModeleVivant(model)) continue;   // retiré (404 ou absent du catalogue) → plus un seul appel perdu dessus
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
      try {
        const r = await fetch(OPENROUTER_BASE + '/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'DataTradingPro' },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: _buildSystem() }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.4 }),
          signal: ctrl.signal,
        });
        if (!r.ok) { const e = new Error('OpenRouter ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 120)); e.status = r.status; throw e; }
        const j = await r.json();
        // OpenRouter peut emballer une erreur provider dans un HTTP 200 (free saturé) → on la traite comme transitoire.
        if (j && j.error) { const e = new Error('OpenRouter provider: ' + String(j.error.message || '').slice(0, 100)); e.status = (j.error.code === 429 || j.error.code === 503) ? j.error.code : 429; throw e; }
        const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!out || !String(out).trim()) throw new Error('réponse vide');
        const u = j.usage; if (u) _noteUsage('openrouter', model, u.prompt_tokens, u.completion_tokens);
        return String(out).trim();
      } catch (e) {
        lastErr = e;
        if (e.status === 401 || e.status === 403) { _orCool(idx, e.status); break; }   // clé morte → gèle la clé, modèles inutiles
        // 404 « No endpoints found matching your data policy » : ce n'est PAS le modèle, c'est un RÉGLAGE
        // du compte (Privacy → autoriser les modèles gratuits). Tous les :free répondraient pareil.
        if (e.status === 404 && /data policy|privacy|guardrail/i.test(String(e.message))) { e.message = 'OpenRouter 404 : réglage du compte à changer (Settings → Privacy → autoriser les modèles gratuits). ' + String(e.message).slice(0, 80); _orCool(idx, 403); break; }
        if (e.status === 404) _orModeleMort.set(model, Date.now() + 12 * 3600e3);   // modèle retiré → écarté 12 h
        // 429/5xx/timeout = CE modèle saturé → modèle suivant (même clé), sans geler la clé
      } finally { clearTimeout(t); }
    }
  }
  throw lastErr || _errSaut('OpenRouter : aucun appel (clés en attente ou modèles écartés)');
}

// ── Cooldown générique PAR CLÉ (Groq/Cohere/xAI) : auth/crédit = long (6 h), 429 = court, réseau = 1 min ──
function _mkCool() {
  const m = new Map();
  return {
    map: m,
    isCool: (idx) => { const t = m.get(idx); return !!t && t > Date.now(); },
    cool: (idx, status, retryMs) => m.set(idx, Date.now() + ((status === 401 || status === 403 || status === 402) ? 6 * 3600 * 1000 : status === 429 ? (retryMs && retryMs > 0 ? Math.min(retryMs + 1000, 3600 * 1000) : 60000) : 45000)),
    coolingNow: () => [...m.values()].filter(t => t > Date.now()).length,
  };
}
const _groqCool = _mkCool(), _cohereCool = _mkCool(), _xaiCool = _mkCool(), _cfCool = _mkCool();

// ── Appelleur OpenAI-compatible GÉNÉRIQUE (Groq + xAI) — rotation clés × modèles, cooldown par clé.
//    Même contrat que _openrouter : 401/403/402 gèle la clé (morte/sans crédit) ; 429 = clé rate-limited
//    (cooldown court, on lit Retry-After) ; 5xx/timeout = modèle suivant (même clé). stat = label télémétrie.
async function _oaiCompatible(cfg, prompt, maxTokens) {
  const { name, base, keys, models, cool, cur, stat } = cfg;
  const n = keys.length; if (!n) throw new Error(name + ': aucune clé');
  cur.v = (cur.v + 1) % n;
  let lastErr;
  for (let i = 0; i < n; i++) {
    const idx = (cur.v + i) % n;
    if (cool.isCool(idx)) continue;   // clé gelée (auth/crédit/429) → clé suivante
    const key = keys[idx];
    for (const model of models) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
      try {
        const r = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: _buildSystem() }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.4 }),
          signal: ctrl.signal,
        });
        if (!r.ok) {
          const body = (await r.text().catch(() => '')).slice(0, 200);
          const e = new Error(name + ' ' + model + ' ' + r.status + ': ' + body.slice(0, 100)); e.status = r.status;
          if (r.status === 429) { const ra = r.headers.get('retry-after'); if (ra && !isNaN(parseFloat(ra))) e.retryMs = parseFloat(ra) * 1000; }
          throw e;
        }
        const j = await r.json();
        const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!out || !String(out).trim()) throw new Error('réponse vide');
        const u = j.usage; if (u) _noteUsage(stat, model, u.prompt_tokens, u.completion_tokens);
        return String(out).trim();
      } catch (e) {
        lastErr = e;
        if (e.status === 401 || e.status === 403 || e.status === 402) { cool.cool(idx, e.status); break; }   // clé morte/sans crédit → clé suivante
        else if (e.status === 429) cool.cool(idx, 429, e.retryMs);   // rate-limited → cooldown court, modèle suivant
        // sinon (5xx/timeout/vide) → modèle suivant, même clé
      } finally { clearTimeout(t); }
    }
  }
  throw lastErr || _errSaut(name + ' : aucun appel (clés en attente)');
}
function _groq(prompt, maxTokens) { return _oaiCompatible({ name: 'Groq', base: GROQ_BASE, keys: GROQ_KEYS, models: GROQ_MODELS, cool: _groqCool, cur: _groqCur, stat: 'groq' }, prompt, maxTokens); }
function _xai(prompt, maxTokens)  { return _oaiCompatible({ name: 'xAI',  base: XAI_BASE,  keys: XAI_KEYS,  models: XAI_MODELS,  cool: _xaiCool,  cur: _xaiCur,  stat: 'xai'  }, prompt, maxTokens); }
function _cloudflare(prompt, maxTokens) { return _oaiCompatible({ name: 'Cloudflare', base: CF_BASE, keys: CLOUDFLARE_KEYS, models: CF_MODELS, cool: _cfCool, cur: _cfCur, stat: 'cloudflare' }, prompt, maxTokens); }

// ── Cohere v2 (api.cohere.com/v2/chat) — forme DIFFÉRENTE : réponse message.content[].text, usage.tokens.
async function _cohere(prompt, maxTokens) {
  const n = COHERE_KEYS.length; if (!n) throw new Error('Cohere: aucune clé');
  _cohereCur.v = (_cohereCur.v + 1) % n;
  let lastErr;
  for (let i = 0; i < n; i++) {
    const idx = (_cohereCur.v + i) % n;
    if (_cohereCool.isCool(idx)) continue;
    const key = COHERE_KEYS[idx];
    for (const model of COHERE_MODELS) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
      try {
        const r = await fetch(COHERE_BASE + '/chat', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: _buildSystem() }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.4 }),
          signal: ctrl.signal,
        });
        if (!r.ok) { const body = (await r.text().catch(() => '')).slice(0, 200); const e = new Error('Cohere ' + model + ' ' + r.status + ': ' + body.slice(0, 100)); e.status = r.status; throw e; }
        const j = await r.json();
        const arr = j && j.message && Array.isArray(j.message.content) ? j.message.content : [];
        const out = arr.filter(b => b && (b.type === 'text' || typeof b.text === 'string')).map(b => b.text || '').join('').trim();
        if (!out) throw new Error('réponse vide');
        const u = j.usage && j.usage.tokens; if (u) _noteUsage('cohere', model, u.input_tokens, u.output_tokens);
        return out;
      } catch (e) {
        lastErr = e;
        if (e.status === 401 || e.status === 403 || e.status === 402) { _cohereCool.cool(idx, e.status); break; }
        else if (e.status === 429 && /trial key|limited to \d+ api calls/i.test(String(e.message))) _cohereCool.map.set(idx, Date.now() + 24 * 3600e3);   // essai MENSUEL épuisé : inutile de réessayer chaque minute
        else if (e.status === 429) _cohereCool.cool(idx, 429);
      } finally { clearTimeout(t); }
    }
  }
  throw lastErr || _errSaut('Cohere : aucun appel (clés en attente)');
}

// ── Groq STREAMING (chat) — SSE OpenAI-compatible, ultra-rapide → tenté EN PREMIER dans generateTextStream.
async function _groqStream(prompt, maxTokens, onChunk) {
  const n = GROQ_KEYS.length; if (!n) throw new Error('Groq: aucune clé');
  _groqCur.v = (_groqCur.v + 1) % n;
  let lastErr;
  for (let i = 0; i < n; i++) {
    const idx = (_groqCur.v + i) % n;
    if (_groqCool.isCool(idx)) continue;
    const key = GROQ_KEYS[idx];
    for (const model of GROQ_MODELS) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
      let full = '';
      try {
        const r = await fetch(GROQ_BASE + '/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: _buildSystem() }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.4, stream: true }),
          signal: ctrl.signal,
        });
        if (!r.ok) { const e = new Error('Groq ' + r.status); e.status = r.status; throw e; }
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try { const j = JSON.parse(data); const d = j && j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (d) { full += d; try { onChunk(d); } catch {} } } catch {}
          }
        }
        if (full.trim()) { _aiStat('groq'); return full.trim(); }
      } catch (e) {
        lastErr = e;
        if (full.trim()) return full.trim();   // partiel déjà émis → on garde (anti-charabia)
        if (e.status === 401 || e.status === 403 || e.status === 402) { _groqCool.cool(idx, e.status); break; }
        else if (e.status === 429) _groqCool.cool(idx, 429);
      } finally { clearTimeout(t); }
    }
  }
  throw lastErr || new Error('Groq stream: échec');
}

// opts.noClaude : n'utilise JAMAIS Claude (même en repli in-cascade après échec Gemini+GitHub).
// → le fond / les flux « claudeOverBudget:false » ne dépensent PLUS de crédits payants, in-budget compris.
// ════════════════ STREAMING (token-par-token) pour le chat interactif ════════════════
// generateTextStream : émet le texte au fil de l'eau via onChunk(delta) ET renvoie le texte complet.
// Chaîne SIMPLE et SÛRE : Groq (SSE, le + rapide) → OpenRouter (:free) → Claude (SDK .stream(),
// seulement si utilisable + autorisé). Si AUCUN provider ne démarre → throw → l'appelant retombe sur la
// génération BUFFERISÉE (generateText/aiSmart, chaîne complète Groq→Gemini→GitHub→OpenRouter→Cohere→Claude).
// RÈGLE anti-charabia : dès qu'un (modèle,clé) a ÉMIS du texte via onChunk, on s'engage dessus —
// on ne réessaie un autre modèle/clé QUE si RIEN n'a encore été émis (sinon le client verrait 2 textes).
async function _openrouterStream(prompt, maxTokens, onChunk) {
  const n = OPENROUTER_KEYS.length; if (!n) throw new Error('OpenRouter: aucune clé');
  _orCursor = (_orCursor + 1) % n;
  let lastErr;
  for (let i = 0; i < n; i++) {
    const idx = (_orCursor + i) % n;
    if (_orIsCool(idx)) continue;
    const key = OPENROUTER_KEYS[idx];
    for (const model of OPENROUTER_MODELS) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
      let full = '';
      try {
        const r = await fetch(OPENROUTER_BASE + '/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'DataTradingPro' },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: _buildSystem() }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.4, stream: true }),
          signal: ctrl.signal,
        });
        if (!r.ok) { const e = new Error('OpenRouter ' + r.status); e.status = r.status; throw e; }
        const reader = r.body.getReader(); const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            // OpenRouter emballe parfois une erreur provider (free saturé) dans un HTTP 200 + ligne SSE → on
            // la fait remonter (tant que RIEN n'a été émis) pour basculer de modèle/clé avec la vraie raison.
            try { const j = JSON.parse(data); if (j && j.error && !full) { const e = new Error('OpenRouter provider: ' + String(j.error.message || '').slice(0, 100)); e.status = (j.error.code === 429 || j.error.code === 503) ? j.error.code : 429; throw e; } const d = j && j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (d) { full += d; try { onChunk(d); } catch {} } } catch (pe) { if (pe && pe.status) throw pe; }
          }
        }
        if (full.trim()) { _aiStat('openrouter'); return full.trim(); }
        // flux vide → on peut tenter le modèle suivant (rien émis)
      } catch (e) {
        lastErr = e;
        if (full.trim()) return full.trim();                       // partiel déjà émis → on garde, pas d'autre modèle
        if (e.status === 401 || e.status === 403) { _orCool(idx, e.status); break; }   // clé morte → clé suivante
        // sinon (open KO / vide) → modèle suivant
      } finally { clearTimeout(t); }
    }
  }
  throw lastErr || new Error('OpenRouter stream: échec');
}
async function _anthropicStream(prompt, maxTokens, onChunk) {
  if (!ANTHROPIC_KEYS.length || !_claudeBudgetOk()) throw new Error('Claude indisponible (plafond/keys)');
  const n = ANTHROPIC_KEYS.length; const start = _anthropicCursor % n; _anthropicCursor = (_anthropicCursor + 1) % n;
  let lastErr;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n; if (_anthIsCool(idx)) continue;
    let full = '';
    try {
      const client = _getAnthropicClient(ANTHROPIC_KEYS[idx]);
      const stream = client.messages.stream({ model: CLAUDE_MODEL, max_tokens: maxTokens, temperature: 0.4, system: _buildSystem(), messages: [{ role: 'user', content: prompt }] });
      stream.on('text', (txt) => { full += txt; try { onChunk(txt); } catch {} });
      const msg = await stream.finalMessage();
      // `full` = exactement le flux reçu par le client (jamais tronqué) ; repli = concat de TOUS les blocs texte.
      const text = (full || (msg.content || []).filter(b => b && b.type === 'text').map(b => b.text || '').join('') || '').trim();
      if (!text) throw new Error('Claude: flux vide');
      _claudeCount++; _aiStat('claude');
      const u = msg.usage; if (u) _noteUsage('claude', CLAUDE_MODEL, u.input_tokens, u.output_tokens);
      return text;
    } catch (e) { lastErr = e; _aiStat('claudeFail', e); _anthCool(idx, e); if (full.trim()) return full.trim(); }   // partiel émis → on garde
  }
  throw lastErr || new Error('Claude stream: échec');
}
async function generateTextStream(prompt, maxTokens = 380, opts = {}, onChunk = () => {}) {
  // Cadratin banni (voir sansCadratin plus bas). En streaming le texte affiché EST le texte
  // diffusé morceau par morceau : il faut donc nettoyer CHAQUE morceau, pas seulement le retour.
  // Règle volontairement SANS ancrage de ligne (^ $) : un morceau se termine à un endroit
  // arbitraire, une règle « fin de ligne » y supprimerait un séparateur encore valide.
  const _flux = d => (typeof d === 'string' && d.indexOf('—') >= 0)
    ? d.replace(/\s—\s/g, ' : ').replace(/—/g, '-')
    : d;
  const _emet = d => onChunk(_flux(d));
  if (GROQ_KEYS.length) {
    try { const out = await _groqStream(prompt, maxTokens, _emet); _noteTotalOk(); return typoDesk(out); }   // Groq = le + rapide → chat fluide
    catch (e) { console.warn('[AI stream] Groq: ' + String(e.message).slice(0, 90)); _aiStat('groqFail', e); }
  }
  if (OPENROUTER_KEYS.length) {
    try { const out = await _openrouterStream(prompt, maxTokens, _emet); _noteTotalOk(); return typoDesk(out); }
    catch (e) { console.warn('[AI stream] OpenRouter: ' + String(e.message).slice(0, 90)); _aiStat('openrouterFail', e); }
  }
  if (!opts.noClaude && claudeUsable()) {
    try { const out = await _anthropicStream(prompt, maxTokens, _emet); _noteTotalOk(); return typoDesk(out); }
    catch (e) { console.warn('[AI stream] Claude: ' + String(e.message).slice(0, 90)); }
  }
  throw new Error('streaming indisponible (repli bufferisé)');
}

/* ── TYPOGRAPHIE : LE CADRATIN EST BANNI DU DESK (veto utilisateur, 14/08/2026) ────────────────
   « enlève ce caractère et ne le met plus jamais "—" du desk ».

   POURQUOI ICI, ET PAS SEULEMENT DANS LES CHAÎNES STATIQUES : la quasi-totalité du texte lu par
   le client (récaps de séance, récap quotidien et hebdo, analyses d'événement, narratifs du
   Radar de Biais, décryptages, chat macro) est ÉCRITE PAR UN MODÈLE au moment de la génération.
   Les modèles emploient le cadratin massivement. Nettoyer les libellés en dur sans assainir la
   sortie IA aurait laissé revenir le caractère à chaque génération, indéfiniment.
   `generateText` est le point de passage COMMUN à tous les fournisseurs (Groq, Gemini, GitHub,
   OpenRouter, Cohere, xAI, Claude) : un seul filet couvre toute la chaîne.

   INNOCUITÉ VIS-À-VIS DU JSON : beaucoup d'appelants font un JSON.parse sur cette valeur. Le
   cadratin n'est JAMAIS de la syntaxe JSON, uniquement du contenu de chaîne, et aucun caractère
   de remplacement ci-dessous n'est structurant (ni guillemet, ni antislash, ni accolade). Le
   nettoyage peut donc précéder le parse sans risque.

   REMPLACEMENT SELON LE SENS, jamais mécanique : un « - » partout aurait produit du mauvais
   français. Les deux-points ne sont posés qu'UNE fois par ligne (« A : B : C » est illisible),
   la virgule prend le relais ensuite. */
/* ── LE POURCENT COLLE À SON NOMBRE, AU MÊME ENDROIT ET POUR LA MÊME RAISON ───────────────────
   « enlève l'espace entre le chiffre et le %, ça fait IA » — demande répétée, et le mot « IA » du
   client dit exactement d'où vient le défaut : la typographie française met une espace insécable
   avant le signe pourcent, les modèles l'appliquent scrupuleusement, et le desk hérite d'un texte
   qui SIGNALE la machine à chaque chiffre.
   ⚠️ POURQUOI ICI PLUTÔT QUE CHEZ CHAQUE APPELANT. Le serveur normalisait déjà la sortie d'aiSmart
   et des traductions : deux portes sur trois. Restaient le chat macro (streaming), les appels
   Claude directs et tout ce qui passe par generateText sans passer par aiSmart. `generateText` est
   le point commun à TOUS les fournisseurs — un seul filet vaut mieux que trois qu'on oublie.
   INNOCUITÉ VIS-À-VIS DU JSON, même raisonnement que pour le cadratin : le signe pourcent n'est
   jamais de la syntaxe JSON, et l'espace retirée est toujours à l'intérieur d'une chaîne. Aucun
   caractère structurant n'est touché, le nettoyage peut donc précéder le JSON.parse.
   Les trois espaces sont visées : normale, insécable, insécable fine — les modèles produisent les
   trois selon le fournisseur. */
function sansEspacePourcent(t) {
  return (typeof t === 'string') ? t.replace(/(\d)[\u00a0\u202f ]+%/g, '$1%') : t;
}

/* La typographie du desk en UN appel : c'est cette fonction que la chaîne applique, pour qu'une
   règle ajoutée demain n'ait pas à retrouver les cinq points de sortie un par un. */
function typoDesk(t) { return sansEspacePourcent(sansCadratin(t)); }

function sansCadratin(t) {
  if (typeof t !== 'string') return t;
  if (t.indexOf('—') < 0 && !/\\u2014/i.test(t)) return t;   // sortie courante : aucun coût
  return t.replace(/\\u2014/gi, '—')            // échappement littéral émis par certains modèles
    .split('\n').map(ligne => {
      let l = ligne
        .replace(/(\d)\s*—\s*(\d)/g, '$1-$2')      // plage chiffrée : 12—15 -> 12-15
        // Cadratin de PUCE en tête de ligne -> retiré. Exigence du COLLAGE À GAUCHE (aucune espace
        // avant) : sans elle, un fragment de concaténation comme ' — service dégradé' était pris
        // pour une puce, le séparateur sautait et les mots se collaient (« risque élevé service
        // dégradé »). Une espace devant signe une incise, pas une puce : elle suit la voie normale.
        .replace(/^—[ \t]*/, '')
        .replace(/[ \t]*—[ \t]*$/, '')             // cadratin orphelin en fin de ligne
        .replace(/([,;:])[ \t]*—[ \t]*/g, '$1 ');  // ponctuation déjà là -> pas de doublon
      // Deux-points UNE SEULE FOIS par segment de phrase, la virgule ensuite : « A : B : C » est
      // illisible. Le budget se calcule par SEGMENT (et non par ligne) car une réponse JSON tient
      // sur une seule ligne : un compteur par ligne aurait donné un deux-points au premier item
      // et une virgule à tous les autres, quel que soit leur contenu.
      // ⚠️ Balayage PROGRESSIF, et non String.replace : replace évalue toujours la chaîne
      // D'ORIGINE, donc le deux-points déjà posé restait invisible pour la décision suivante et
      // « A — B — C » ressortait « A : B : C », exactement ce qu'on cherche à éviter.
      const BORNES = ['. ', '! ', '? ', '"', '«', '»', ';', '\t'];
      const RX = /(?:[ \t]+—[ \t]*|[ \t]*—[ \t]+)/;
      let sortie = '', reste = l, garde = 0, m;
      while ((m = RX.exec(reste)) && garde++ < 60) {
        const deja = sortie + reste.slice(0, m.index);
        const seg = deja.slice(Math.max(-1, ...BORNES.map(b => deja.lastIndexOf(b))) + 1);
        sortie = deja + (/:\s/.test(seg) ? ', ' : ' : ');
        reste = reste.slice(m.index + m[0].length);
      }
      return (sortie + reste).replace(/—/g, '-');  // reste : cadratin COLLÉ à un mot -> trait d'union
    }).join('\n');
}

async function generateText(prompt, maxTokens = 1500, opts = {}) {
  try {
    const out = typoDesk(await _generateTextInner(prompt, maxTokens, opts));
    _noteTotalOk();
    return out;
  } catch (e) {
    // Le backoff GLOBAL ne doit s'armer que sur une panne TRANSITOIRE (reseau/5xx/429 en serie). Un etat
    // CONNU et attendu (Claude sans credit / cle auth morte = filet payant volontairement gele) ne doit PAS
    // pousser au backoff ni declencher l'alerte « panne totale » → sinon flood d'alertes non critiques.
    const known = e && (e._knownState || (e.claudeTried && /credit|billing|balance/i.test(String(e.message || ''))));
    if (!known) _noteTotalFail();
    throw e;
  }
}

async function _generateTextInner(prompt, maxTokens, opts = {}) {
  const claudeOff = !!opts.noClaude || !ANTHROPIC_KEYS.length;
  /* Le budget de CET appel, confronté au plafond APPRIS de chaque fournisseur. Un fournisseur dont
     on SAIT qu'il refusera est sauté : c'est un aller-retour réseau économisé et, surtout, une
     seconde gagnée pour celui qui peut répondre. Rien n'est sauté tant que rien n'est appris. */
  const _bud = budgetAppel(prompt, maxTokens);
  const _saute = (prov) => { if (_plafAutorise(prov, _bud)) return false; console.warn(`[AI] ${prov} saut\u00e9 : ${_bud} jetons demand\u00e9s > plafond appris ${plafondDe(prov)}`); return true; };
  // ── TÂCHES DE MASSE (opts.masse : titres du fil…) → GEMMA D'ABORD ────────────────────────────
  // Courtes et nombreuses : elles vidaient le quota de Flash avant midi. Gemma les absorbe ; Flash
  // n'est sollicité que si Gemma ne répond pas (et reste alors disponible pour tout le reste).
  if (opts.masse && GEMMA_ON && gemmaDispo(prompt, maxTokens)) {
    try { const out = await _gemmaEssai(prompt, maxTokens, true); if (opts.meta) opts.meta.fournisseur = 'gemma'; return out; }
    catch (e) { if (!e.saut) console.warn(`[AI] Gemma (masse) échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → cascade`); _aiStat('gemmaFail', e); }
  }
  // ── PRINCIPAL : Groq (gratuit, latence minimale) ─────────────────────────────
  // Tenté AVANT Gemini : capacité free la plus fiable du moment, et on évite le gate anti-rafale
  // Gemini (_gemBucketGate, jusqu'à 6 s d'attente) sur le chemin nominal. _groq gère en interne
  // multi-clés + multi-modèles + cooldowns (_groqCool) — un échec ici bascule sur Gemini.
  if (GROQ_KEYS.length && !_saute('groq')) {
    try { const out = await _groq(prompt, maxTokens); notePlafondOk('groq', _bud); _aiStat('groq'); return out; }
    catch (e) { if (estRefusTaille(e)) notePlafondKo('groq', _bud); console.warn(`[AI] Groq (principal) échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → Gemini`); _aiStat('groqFail', e); }
  }

  // ── Repli n°1 : Google Gemini (gratuit) — multi-clés + multi-modèles ─────────
  // Pour CHAQUE modèle, on essaie TOUTES les clés (rotation round-robin). Tâches COURTES
  // (≤ LITE_MAXTOK tokens demandés) → cascade -lite d'abord (quota RPD ~4× supérieur) ;
  // tâches longues → cascade qualité (flash d'abord). Quotas cumulés, bascule auto sur 429.
  // noGemini : l'enveloppe de budget qui pace le quota gratuit GEMINI est epuisee, mais les AUTRES
  // fournisseurs gratuits (GitHub Models, OpenRouter, Cohere) ont leur propre quota, intact. On saute
  // donc Gemini et on continue la cascade — au lieu d'abandonner toute la chaine gratuite.
  if (GEMINI_KEYS.length && !opts.noGemini && !_saute('gemini')) {
    let lastErr;
    const n = GEMINI_KEYS.length;
    _geminiCursor = (_geminiCursor + 1) % n;
    const models = _gemLive(maxTokens <= LITE_MAXTOK ? GEMINI_MODELS_LITE_FIRST : GEMINI_MODELS);   // modèles retirés écartés d'emblée
    // Anti-rafale : 1 jeton/appel → lisse le débit ENTRE les appels (la cause des 429). MAIS si AUCUN
    // couple (modèle,clé) n'est utilisable (tout en cooldown/breaker), on NE gate PAS (sinon on attend
    // 6 s pour rien) → failover immédiat vers GitHub/Claude pendant une panne Gemini.
    const _gemUsable = models.some(m => { for (let i = 0; i < n; i++) { const idx = (_geminiCursor + i) % n; if (!_gemIsCool(m, idx) && !_hBroken(m, idx)) return true; } return false; });
    if (_gemUsable) await _gemBucketGate();
    for (const model of models) {
      const cand = [];
      for (let i = 0; i < n; i++) { const idx = (_geminiCursor + i) % n; if (_gemIsCool(model, idx) || _hBroken(model, idx)) continue; cand.push(idx); }
      cand.sort((a, b) => _hScore(model, b) - _hScore(model, a));   // meilleure santé d'abord
      for (const idx of cand) {
        const t0 = Date.now();
        try { const out = await _gemini(model, GEMINI_KEYS[idx], prompt, maxTokens); notePlafondOk('gemini', _bud); _hOk(model, idx, Date.now() - t0); _gemOkAt.set(model, Date.now()); _aiStat('gemini'); _gkNote(idx, 'ok'); return out; }
        catch (e) {
          lastErr = e;
          if (estRefusTaille(e)) notePlafondKo('gemini', _bud);
          // Classement COMMUN (_gemEchec) : 404/modèle → modèle écarté pour toutes les clés ; 400 de
          // requête → ni gel ni disjoncteur, la même requête serait refusée par les 7 clés ; clé → cette
          // clé seule mise de côté ; 429/5xx/réseau → comme avant, par couple (modèle, clé).
          const c = _gemEchec(model, idx, e, prompt);
          console.warn(`[AI] Gemini ${model} clé #${idx + 1}/${n} échec${e.status ? ' (' + e.status + ')' : ''} [${c}]: ${String(e.message).slice(0, 110)} → ${c === 'modele' || c === 'requete' ? 'modèle suivant' : 'clé suivante'}`);
          if (c === 'modele' || c === 'requete') break;
        }
      }
    }
  }

  // ── Repli n°2 : GEMMA (mêmes clés, quota gratuit ~50× celui de Flash) ─────────────────────────
  // Tenté même quand l'enveloppe Gemini (noGemini) est vide : elle pace le quota de FLASH, pas celui de
  // Gemma. Une requête trop lourde pour son débit (15 000 jetons/min) le saute sans appel.
  if (!opts.masse && GEMMA_ON && gemmaDispo(prompt, maxTokens)) {
    try { const out = await _gemmaEssai(prompt, maxTokens); if (opts.meta) opts.meta.fournisseur = 'gemma'; return out; }
    catch (e) { if (!e.saut) console.warn(`[AI] Gemma échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suite`); _aiStat('gemmaFail', e); }
  }
  // Groq (principal) a déjà été tenté plus haut → il ne compte plus comme maillon restant ici.
  if (!GITHUB_TOKENS.length && !OPENROUTER_KEYS.length && !COHERE_KEYS.length && !CLOUDFLARE_KEYS.length && claudeOff) throw new Error('Gemini/Gemma indisponibles');

  // ── Repli gratuit AVANT Claude ──────────────────────────────────────────────
  // Ordre : github/openrouter (ordre APPRIS, borné) → Cohere (free trial) → xAI (PAYANT, gaté par
  // claudeOff = jamais en flux de fond). Groq n'apparaît plus ici : il est PRINCIPAL (tenté en tête).
  // Chaque provider garde SA fonction/logs/cooldown. L'apprentissage ne réordonne QUE github/openrouter.
  const _mid = (_fallbackOrder && _fallbackOrder.length) ? _fallbackOrder : ['github', 'openrouter'];
  const _order = [..._mid, 'cohere', 'cloudflare', 'xai'];   // Cloudflare Workers AI = repli GRATUIT (après Cohere, avant le payant)
  for (const prov of _order) {
    if (prov === 'github' && GITHUB_TOKENS.length && !_saute('github')) {
      try { const out = await _githubModels(prompt, maxTokens); notePlafondOk('github', _bud); _aiStat('github'); return out; }
      catch (e) { if (estRefusTaille(e)) notePlafondKo('github', _bud); console.warn(`[AI] GitHub Models échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suite`); _aiStat('githubFail', e); }
    } else if (prov === 'openrouter' && OPENROUTER_KEYS.length && !_saute('openrouter')) {
      try { const out = await _openrouter(prompt, maxTokens); notePlafondOk('openrouter', _bud); _aiStat('openrouter'); return out; }
      catch (e) { if (estRefusTaille(e)) notePlafondKo('openrouter', _bud); console.warn(`[AI] OpenRouter échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suite`); _aiStat('openrouterFail', e); }
    } else if (prov === 'cohere' && COHERE_KEYS.length && !_saute('cohere')) {
      try { const out = await _cohere(prompt, maxTokens); notePlafondOk('cohere', _bud); _aiStat('cohere'); return out; }
      catch (e) { if (estRefusTaille(e)) notePlafondKo('cohere', _bud); console.warn(`[AI] Cohere échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suite`); _aiStat('cohereFail', e); }
    } else if (prov === 'cloudflare' && CLOUDFLARE_KEYS.length && !_saute('cloudflare')) {
      try { const out = await _cloudflare(prompt, maxTokens); notePlafondOk('cloudflare', _bud); _aiStat('cloudflare'); return out; }
      catch (e) { if (estRefusTaille(e)) notePlafondKo('cloudflare', _bud); console.warn(`[AI] Cloudflare échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suite`); _aiStat('cloudflareFail', e); }
    } else if (prov === 'xai' && XAI_KEYS.length && !claudeOff && !_saute('xai')) {   // xAI = PAYANT → JAMAIS sur un flux de fond « noClaude » (protège le budget)
      try { const out = await _xai(prompt, maxTokens); notePlafondOk('xai', _bud); _aiStat('xai'); return out; }
      catch (e) { if (estRefusTaille(e)) notePlafondKo('xai', _bud); console.warn(`[AI] xAI échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)}${claudeOff ? '' : ' → Claude'}`); _aiStat('xaiFail', e); }
    }
  }

  // ── Option C : Anthropic Claude (multi-clés, rotation + cooldown par clé) ────
  // Sautée si opts.noClaude → un flux de fond / « claudeOverBudget:false » ne touche JAMAIS les
  // crédits payants, même quand Gemini+GitHub échouent en budget (l'appelant a son fallback local).
  if (!claudeOff) {
    _aiStat('fallback');
    try { const out = await _anthropic(prompt, maxTokens); notePlafondOk('claude', _bud); return out; }
    catch (e) { if (estRefusTaille(e)) notePlafondKo('claude', _bud); e.claudeTried = true; throw e; }   // l'appelant (aiSmart) sait : pas de 2e passe Claude
  }

  const _tentes = ['Groq', opts.noGemini ? null : 'Gemini', 'GitHub', 'OpenRouter', 'Cohere', opts.noClaude ? null : 'xAI', opts.noClaude ? null : 'Claude'].filter(Boolean).join('/');
  throw new Error('IA indisponible — ' + _tentes + ' tentes sans succes' + (opts.noGemini ? ' (Gemini hors budget, saute)' : '') + (opts.noClaude ? ' (payant desactive pour ce flux)' : ''));
}

// Génère via Claude UNIQUEMENT (ignore Gemini). Utile quand le budget Gemini soft
// est épuisé mais qu'on veut quand même produire un vrai résultat IA via Claude.
async function generateTextClaudeOnly(prompt, maxTokens = 1500) {
  return typoDesk(await _anthropic(prompt, maxTokens));   // mêmes règles typographiques que la voie commune
}

function hasAnthropic() { return ANTHROPIC_KEYS.length > 0; }
// Claude « utilisable » = au moins une clé NI gelée NI au-delà du cap → évite de router
// vers un mur (toutes clés en cooldown crédit/auth) et de payer la latence pour rien.
function claudeUsable() {
  if (!ANTHROPIC_KEYS.length || !_claudeBudgetOk()) return false;
  for (let i = 0; i < ANTHROPIC_KEYS.length; i++) if (!_anthIsCool(i)) return true;
  return false;
}

// Diagnostic (sans exposer les valeurs) : quelles ressources IA sont configurées.
function status() {
  return {
    primary: GROQ_KEYS.length ? 'groq' : 'gemini',   // tête de cascade réelle (miroir IA Monitor)
    geminiKeys: GEMINI_KEYS.length,
    geminiModels: GEMINI_MODELS,
    groq: { keys: GROQ_KEYS.length, models: GROQ_MODELS.length, coolingNow: _groqCool.coolingNow() },
    github: { tokens: GITHUB_TOKENS.length, model: GITHUB_MODEL, models: GITHUB_MODELS, coolingNow: [..._ghCooldown.values()].filter(t => t > Date.now()).length,
      budget: { capHaut: GH_CAP_HIGH, capBas: GH_CAP_LOW, gapMs: GH_MIN_GAP, jour: _ghBudgetEtat() } },
    openrouter: { keys: OPENROUTER_KEYS.length, models: OPENROUTER_MODELS.length, coolingNow: [..._orCooldown.values()].filter(t => t > Date.now()).length },
    cohere: { keys: COHERE_KEYS.length, models: COHERE_MODELS.length, coolingNow: _cohereCool.coolingNow() },
    cloudflare: { keys: CLOUDFLARE_KEYS.length, models: CF_MODELS.length, coolingNow: _cfCool.coolingNow(), account: !!CF_ACCOUNT },
    xai: { keys: XAI_KEYS.length, models: XAI_MODELS.length, coolingNow: _xaiCool.coolingNow(), paid: true },
    anthropicKeys: ANTHROPIC_KEYS.length,
    claudeModel: CLAUDE_MODEL,
    claudeDailyMax: CLAUDE_DAILY_MAX,
    claudeUsedToday: _claudeCount,
    claudeUsable: claudeUsable(),
    claudeCooling: [..._anthCooldown.entries()].filter(([, c]) => c.until > Date.now()).map(([idx, c]) => ({ key: idx + 1, reason: c.reason, minLeft: Math.ceil((c.until - Date.now()) / 60000) })),
    today: _aiDay,
    usageToday: _aiStats,                                                   // {gemini, gemini429, claude, fallback} → "le nombre par jour"
    tokensToday: _aiTok,                                                    // tokens RÉELS in/out par provider (lus du champ usage)
    backoff: { active: backoffActive(), totalFails: _totalFails },
    erreurs: JSON.parse(JSON.stringify(_derniereErreur)),                   // dernière erreur PAR fournisseur (code, message sans secret, date) — cf. _noteErreur          // panne totale en cours ? (les self-heals s'espacent)
    geminiCoolingNow: [..._gemCooldown.entries()].filter(([k, t]) => t > Date.now() && !_gemModelIsDead(k.split('|')[0])).length,   // couples (modèle vivant, clé) en cooldown
    geminiKeysDetail: _gkEtat(),                                                                     // par clé : réussites, 429, refus, modèles utilisables
    geminiKeysFrozen: _gkEtat().filter(k => k.gelee).length,                                         // CLÉS gelées (aucun modèle vivant utilisable), pas des couples
    geminiModelsLive: _gemLive(GEMINI_MODELS),
    geminiModelsDead: [..._gemModelDead.entries()].filter(([, d]) => d.until > Date.now()).map(([m, d]) => ({ m, raison: d.raison, until: d.until })),
    geminiCatalogue: _gemCatalogue,                                                                  // dernier catalogue Google lu (nb de modèles, ajouts automatiques)
    gemma: { on: GEMMA_ON, model: GEMMA_MODEL || null, dispo: gemmaDispo(null), tpm: GEMMA_TPM,             // voie de MASSE (mêmes clés, quota ~14 400/j)
      raison: GEMMA_MODEL && _gemModelIsDead(GEMMA_MODEL) ? (_gemModelDead.get(GEMMA_MODEL) || {}).raison : null },
    journalErreurs: JSON.parse(JSON.stringify(_journalErr)),                                         // erreurs DISTINCTES récentes par fournisseur (persistées dans aitel:*)
    openrouterModelesEcartes: [..._orModeleMort.entries()].filter(([, t]) => t > Date.now()).map(([m]) => m),
    // ── AI Traffic Intelligence ──
    intel: {
      rpmTarget: _GEM_RPM,
      rpmBucket: Math.round((() => { _gemBucketRefill(); return _gemBucket; })() * 10) / 10,   // jetons dispo (proche de RPM = pas de rafale)
      effRpm: Math.round(_effRpm() * 10) / 10, pressure: Math.round(_quotaPressure * 100) / 100,   // throttling prédictif (budget)
      healthPressure: Math.round(_healthPressure() * 100) / 100, effPressure: Math.round(pressure() * 100) / 100, throttle: shouldThrottle(),   // pression SANTÉ + effective (max des 2) + suspension fond → visible IA Monitor
      fallbackOrder: _fallbackOrder || null,   // ordre de repli appris (github/openrouter) — null = défaut
      breakersOpen: [..._gemHealth.values()].filter(h => h.breakerUntil > Date.now()).length,
      health: [..._gemHealth.entries()].map(([k, h]) => ({ k, ok: h.ok, fail: h.fail, f429: h.f429, ewmaMs: Math.round(h.ewmaMs), broken: h.breakerUntil > Date.now() }))
        .sort((a, b) => (b.ok + b.fail) - (a.ok + a.fail)).slice(0, 12),
    },
  };
}

module.exports = {
  generateText,
  generateTextStream,
  generateTextClaudeOnly,
  sansCadratin,     // exporté : sert aussi aux textes assemblés côté serveur (scrapers, agrégats)
  sansEspacePourcent,
  typoDesk,         // les deux règles d'un coup — à préférer pour tout texte français assemblé
  setQuotaPressure,
  pressure,
  shouldThrottle,
  underPressure,
  setFallbackOrder,
  budgetAppel, estRefusTaille, notePlafondOk, notePlafondKo, plafondDe, budgetSur, plafonds, setPlafonds,
  setLiveContext,
  gemmaDispo,
  flashDispo,
  hasAnthropic,
  claudeUsable,
  backoffActive,
  backoffDepuisMs,
  getClaudeState,
  hydrateClaudeState,
  onUsage,
  status,
  _anthropicKeyCount: () => ANTHROPIC_KEYS.length,
};

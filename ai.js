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
const GEMINI_MODELS  = (process.env.GEMINI_MODEL || 'gemini-2.5-flash,gemini-2.0-flash,gemini-2.5-flash-lite,gemini-2.0-flash-lite')
  .split(',').map(s => s.trim()).filter(Boolean);
// Modèles « légers » : tâches courtes (titres, tags, extractions) routées d'abord sur les -lite
// (quota RPD ~4× supérieur) → préserve le quota rare de gemini-2.5-flash pour les gros JSON.
const GEMINI_MODELS_LITE_FIRST = [...GEMINI_MODELS].sort((a, b) => (a.includes('lite') ? 0 : 1) - (b.includes('lite') ? 0 : 1));
const LITE_MAXTOK = parseInt(process.env.GEMINI_LITE_MAXTOK, 10) || 400;   // ≤400 tokens demandés → cascade lite d'abord

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
const GITHUB_BASE  = process.env.GITHUB_MODELS_URL || 'https://models.inference.ai.azure.com';
// Cascade de modèles GitHub : le plafond GRATUIT est PAR MODÈLE *et* PAR TOKEN (≈50/j « high » type
// gpt-4o, ≈150/j « low » type gpt-4o-mini) → tourner sur PLUSIEURS modèles MULTIPLIE la capacité
// gratuite/jour. Tâches courtes (≤LITE_MAXTOK) : mini d'abord (quota + élevé) ; tâches longues :
// qualité d'abord (gpt-4o) puis repli mini. Surchargeable via GITHUB_MODELS (CSV).
const GITHUB_MODELS = (process.env.GITHUB_MODELS || process.env.GITHUB_MODEL || 'gpt-4o,gpt-4o-mini')
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
  'openai/gpt-oss-120b:free,openai/gpt-oss-20b:free,qwen/qwen3-next-80b-a3b-instruct:free,meta-llama/llama-3.3-70b-instruct:free,nousresearch/hermes-3-llama-3.1-405b:free')
  .split(',').map(s => s.trim()).filter(Boolean);

// ── Groq (api.groq.com) — API OpenAI-compatible, free-tier TRÈS généreux + latence extrême (idéal chat).
//    Placé EN TÊTE du repli gratuit (avant GitHub/OpenRouter) → capacité gratuite majeure par-dessus Gemini.
//    Multi-clés (GROQ_API_KEY + _2.._20). Modèles surchargeables via GROQ_MODELS (CSV). Limites : RPM/RPD par clé.
const GROQ_KEYS = (() => {
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

// ── xAI / Grok (api.x.ai) — API OpenAI-compatible, mais PAYANT (crédits). Traité comme Claude : GATÉ par
//    claudeOff → JAMAIS utilisé sur un flux de fond « noClaude » (protège le budget), seulement en dernier
//    repli avant Claude sur les flux utilisateur. Modèle bon marché par défaut. Multi-clés (XAI_API_KEY + _2.._20).
const XAI_KEYS = (() => {
  const out = [];
  if (process.env.XAI_API_KEY) out.push(process.env.XAI_API_KEY);
  for (let i = 2; i <= 20; i++) { const v = process.env['XAI_API_KEY' + i]; if (v) out.push(v); }
  return out.map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
})();
const _xaiCur = { v: 0 };
const XAI_BASE   = process.env.XAI_URL || 'https://api.x.ai/v1';
const XAI_MODELS = (process.env.XAI_MODELS || 'grok-3-mini,grok-2-1212')
  .split(',').map(s => s.trim()).filter(Boolean);

// Visibilité au démarrage : combien de ressources IA sont chargées (jamais les valeurs).
console.log(`[AI] Ressources → Gemini: ${GEMINI_KEYS.length} clés · Groq: ${GROQ_KEYS.length} clé(s)${GROQ_KEYS.length ? ' (' + GROQ_MODELS.join('/') + ')' : ''} · GitHub Models: ${GITHUB_TOKENS.length} token(s)${GITHUB_TOKENS.length ? ' (' + GITHUB_MODELS.join('/') + ')' : ''} · OpenRouter: ${OPENROUTER_KEYS.length} clé(s)${OPENROUTER_KEYS.length ? ' (' + OPENROUTER_MODELS.length + ' :free)' : ''} · Cohere: ${COHERE_KEYS.length} clé(s) · xAI: ${XAI_KEYS.length} clé(s) (payant) · Claude: ${ANTHROPIC_KEYS.length} clés`);

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
let _aiTok = { geminiIn: 0, geminiOut: 0, githubIn: 0, githubOut: 0, openrouterIn: 0, openrouterOut: 0, groqIn: 0, groqOut: 0, cohereIn: 0, cohereOut: 0, xaiIn: 0, xaiOut: 0, claudeIn: 0, claudeOut: 0 };
let _onUsage = null;
function onUsage(fn) { _onUsage = (typeof fn === 'function') ? fn : null; }
function _noteUsage(provider, model, inTok, outTok) {
  _aiStat('_touch');   // assure le reset quotidien partagé
  _aiTok[provider + 'In']  = (_aiTok[provider + 'In']  || 0) + (inTok  || 0);
  _aiTok[provider + 'Out'] = (_aiTok[provider + 'Out'] || 0) + (outTok || 0);
  if (_onUsage) { try { _onUsage(provider, model, inTok || 0, outTok || 0); } catch {} }
}

async function _gemini(model, key, prompt, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  // Timeout 20s : une requête Gemini bloquée ne doit jamais s'empiler / geler la file (anti-OOM/502)
  const _ctrl = new AbortController();
  const _to = setTimeout(() => _ctrl.abort(), 20000);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: _ctrl.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: _buildSystem() }] },   // contexte commun + état LIVE du terminal
        contents: [{ parts: [{ text: prompt }] }],
        // thinkingBudget:0 → pas de "réflexion" qui consomme les tokens de sortie
        // temperature 0.4 (alignée sur Claude) → moins de variance, sorties homogènes
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
  } finally { clearTimeout(_to); }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const err = new Error(`Gemini ${model} ${r.status}: ${t.slice(0, 150)}`);
    err.status = r.status;
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
      lastErr = e; _aiStat('claudeFail');
      const reason = _anthCool(idx, e);
      const status = e?.status || e?.response?.status;
      console.warn(`[AI] Claude clé #${idx + 1}/${n} échec${status ? ' (' + status + ')' : ''} [gel: ${reason}]: ${String(e.message).slice(0, 120)} → clé suivante`);
    }
  }
  if (!tried) throw lastErr || new Error('Claude: toutes les clés sont en cooldown (crédit/auth/429) — aucune tentée');
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
// Suivi quotidien (visibilité "combien d'appels / 429 par jour").
const _AI_STATS_ZERO = () => ({ gemini: 0, gemini429: 0, github: 0, githubFail: 0, openrouter: 0, openrouterFail: 0, groq: 0, groqFail: 0, cohere: 0, cohereFail: 0, xai: 0, xaiFail: 0, claude: 0, claudeFail: 0, fallback: 0 });
const _AI_TOK_ZERO   = () => ({ geminiIn: 0, geminiOut: 0, githubIn: 0, githubOut: 0, openrouterIn: 0, openrouterOut: 0, groqIn: 0, groqOut: 0, cohereIn: 0, cohereOut: 0, xaiIn: 0, xaiOut: 0, claudeIn: 0, claudeOut: 0 });
let _aiDay = '', _aiStats = _AI_STATS_ZERO();
function _aiStat(f) {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== _aiDay) {
    _aiDay = d;
    _aiStats = _AI_STATS_ZERO();
    _aiTok = _AI_TOK_ZERO();
  }
  if (f !== '_touch') _aiStats[f] = (_aiStats[f] || 0) + 1;
}

// ── Backoff GLOBAL de panne : signale aux boucles de fond de s'espacer ────────
// Après 3 échecs TOTAUX consécutifs de generateText (tous providers down — le scénario de
// l'incident), backoffActive() devient vrai pendant une fenêtre exponentielle (10 min → 6 h max).
// Les self-heals (narratifs, recap, retries horaires) DOIVENT le consulter avant d'attaquer.
let _totalFails = 0, _lastTotalFailAt = 0;
function _noteTotalFail() { _totalFails++; _lastTotalFailAt = Date.now(); }
function _noteTotalOk()   { _totalFails = 0; }
function backoffActive() {
  if (_totalFails < 3) return false;
  const windowMs = Math.min(6 * 3600 * 1000, 10 * 60 * 1000 * Math.pow(2, _totalFails - 3));   // 10 min → 6 h
  if (Date.now() - _lastTotalFailAt >= windowMs) { _totalFails = Math.min(_totalFails, 3); return false; }   // fenêtre expirée → on DÉGONFLE : un échec isolé ne ré-armera que ~10 min (pas 6 h) — la reprise « flaky » n'est plus gelée
  return true;
}

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
  for (const m of GEMINI_MODELS) for (let i = 0; i < n; i++) { tot++; if (!_gemIsCool(m, i) && !_hBroken(m, i)) live++; }
  return tot ? live / tot : 0;
}
function _healthPressure() {
  const unavail = 1 - _gemAvailFraction();                       // 0 = tout dispo, 1 = tout gelé
  let sum = 0, k = 0;
  for (const [, h] of _gemHealth) { if (h.breakerUntil <= Date.now()) { sum += h.ewmaMs; k++; } }
  const lat = k ? Math.max(0, Math.min(1, (sum / k - 1500) / 6500)) : 0;   // 1.5s sain→0 ; 8s→1
  let streaks = 0, tot = 0; const n = GEMINI_KEYS.length;
  for (const m of GEMINI_MODELS) for (let i = 0; i < n; i++) { tot++; if ((_gem429Streak.get(m + '|' + i) || 0) >= 1) streaks++; }
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
// SÛR par construction : ne contient QUE 'github'/'openrouter' (jamais Gemini en 1er = capacité principale
// intacte, jamais Claude avancé = crédits payants protégés). null = ordre par défaut (comportement actuel).
let _fallbackOrder = null;
function setFallbackOrder(arr) {
  if (!Array.isArray(arr)) { _fallbackOrder = null; return; }
  const ok = arr.filter(x => x === 'github' || x === 'openrouter');
  _fallbackOrder = ok.length ? [...new Set(ok)] : null;
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
      if (_ghIsCool(model, idx)) continue;   // (modèle, token) gelé (plafond/j ou auth) → pas de re-test inutile
      const tok = GITHUB_TOKENS[idx];
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), _tmo);
      try {
        const r = await fetch(GITHUB_BASE + '/chat/completions', {
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
        const j = await r.json();
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
        if (_ghIsCool(model, idx)) continue;
        const tok = GITHUB_TOKENS[idx];
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), _tmo);
        try {
          const r = await fetch(GITHUB_BASE + '/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'system', content: _buildSystem() }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.4 }),
            signal: ctrl.signal,
          });
          if (!r.ok) { const body = (await r.text().catch(() => '')).slice(0, 200); const e = new Error('GitHub Models ' + model + ' ' + r.status); e.status = r.status; if (r.status === 429) { const m = body.match(/wait\s+(\d+)\s*seconds/i); if (m) e.retryMs = parseInt(m[1], 10) * 1000; } if (e.status) _ghCool(model, idx, e.status, e.retryMs); lastErr = e; continue; }
          const j = await r.json();
          const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (out && String(out).trim()) { const u = j.usage; if (u) _noteUsage('github', model, u.prompt_tokens, u.completion_tokens); return String(out).trim(); }
        } catch (e) { lastErr = e; }   // 2e timeout → on abandonne GitHub, la chaine passe a OpenRouter
        finally { clearTimeout(t); }
        break;   // 1 seul couple retente par modele
      }
    }
  }
  throw lastErr || new Error('GitHub Models: tous les (modèle, token) ont échoué (ou en cooldown)');
}

// ── OpenRouter — cooldown PAR CLÉ (auth/crédit) ; rotation multi-clés ET multi-modèles ───────
// Spécificité free-tier : un modèle :free peut renvoyer 429/500 « saturé en amont » alors que la
// clé est saine → on bascule de MODÈLE (même clé) sans geler la clé. On ne gèle la clé que sur
// 401/403 (clé morte) ou 429 « rate-limited » côté compte.
const _orCooldown = new Map();   // idx → fin de cooldown
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
        // 429/5xx/timeout = CE modèle saturé → modèle suivant (même clé), sans geler la clé
      } finally { clearTimeout(t); }
    }
  }
  throw lastErr || new Error('OpenRouter: toutes les clés/modèles ont échoué (ou en cooldown)');
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
const _groqCool = _mkCool(), _cohereCool = _mkCool(), _xaiCool = _mkCool();

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
  throw lastErr || new Error(name + ': toutes les clés/modèles ont échoué (ou en cooldown)');
}
function _groq(prompt, maxTokens) { return _oaiCompatible({ name: 'Groq', base: GROQ_BASE, keys: GROQ_KEYS, models: GROQ_MODELS, cool: _groqCool, cur: _groqCur, stat: 'groq' }, prompt, maxTokens); }
function _xai(prompt, maxTokens)  { return _oaiCompatible({ name: 'xAI',  base: XAI_BASE,  keys: XAI_KEYS,  models: XAI_MODELS,  cool: _xaiCool,  cur: _xaiCur,  stat: 'xai'  }, prompt, maxTokens); }

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
        else if (e.status === 429) _cohereCool.cool(idx, 429);
      } finally { clearTimeout(t); }
    }
  }
  throw lastErr || new Error('Cohere: toutes les clés/modèles ont échoué (ou en cooldown)');
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
// Chaîne SIMPLE et SÛRE : OpenRouter (:free, workhorse, SSE OpenAI-compatible) → Claude (SDK .stream(),
// seulement si utilisable + autorisé). Si AUCUN provider ne démarre → throw → l'appelant retombe sur la
// génération BUFFERISÉE (generateText/aiSmart, chaîne complète Gemini→GitHub→OpenRouter→Claude).
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
    } catch (e) { lastErr = e; _aiStat('claudeFail'); _anthCool(idx, e); if (full.trim()) return full.trim(); }   // partiel émis → on garde
  }
  throw lastErr || new Error('Claude stream: échec');
}
async function generateTextStream(prompt, maxTokens = 380, opts = {}, onChunk = () => {}) {
  if (GROQ_KEYS.length) {
    try { const out = await _groqStream(prompt, maxTokens, onChunk); _noteTotalOk(); return out; }   // Groq = le + rapide → chat fluide
    catch (e) { console.warn('[AI stream] Groq: ' + String(e.message).slice(0, 90)); _aiStat('groqFail'); }
  }
  if (OPENROUTER_KEYS.length) {
    try { const out = await _openrouterStream(prompt, maxTokens, onChunk); _noteTotalOk(); return out; }
    catch (e) { console.warn('[AI stream] OpenRouter: ' + String(e.message).slice(0, 90)); _aiStat('openrouterFail'); }
  }
  if (!opts.noClaude && claudeUsable()) {
    try { const out = await _anthropicStream(prompt, maxTokens, onChunk); _noteTotalOk(); return out; }
    catch (e) { console.warn('[AI stream] Claude: ' + String(e.message).slice(0, 90)); }
  }
  throw new Error('streaming indisponible (repli bufferisé)');
}

async function generateText(prompt, maxTokens = 1500, opts = {}) {
  try {
    const out = await _generateTextInner(prompt, maxTokens, opts);
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
  // ── Option A : Google Gemini (gratuit) — multi-clés + multi-modèles ──────────
  // Pour CHAQUE modèle, on essaie TOUTES les clés (rotation round-robin). Tâches COURTES
  // (≤ LITE_MAXTOK tokens demandés) → cascade -lite d'abord (quota RPD ~4× supérieur) ;
  // tâches longues → cascade qualité (flash d'abord). Quotas cumulés, bascule auto sur 429.
  if (GEMINI_KEYS.length) {
    let lastErr;
    const n = GEMINI_KEYS.length;
    _geminiCursor = (_geminiCursor + 1) % n;
    const models = maxTokens <= LITE_MAXTOK ? GEMINI_MODELS_LITE_FIRST : GEMINI_MODELS;
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
        try { const out = await _gemini(model, GEMINI_KEYS[idx], prompt, maxTokens); _hOk(model, idx, Date.now() - t0); _aiStat('gemini'); return out; }
        catch (e) {
          lastErr = e; const is429 = e.status === 429;
          _hFail(model, idx, is429);
          if (is429) { _gemCool(model, idx, 429, e.retryDelayMs, e.quotaDaily); _aiStat('gemini429'); }
          else if (e.status === 404 || e.status === 503 || e.status === 500) _gemCool(model, idx, e.status);
          console.warn(`[AI] Gemini ${model} clé #${idx + 1}/${n} échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suivant`);
        }
      }
    }
    if (!GROQ_KEYS.length && !GITHUB_TOKENS.length && !OPENROUTER_KEYS.length && !COHERE_KEYS.length && claudeOff) throw lastErr || new Error('Gemini indisponible');
  }

  // ── Repli gratuit AVANT Claude ──────────────────────────────────────────────
  // Ordre : Groq (free le + généreux/rapide) → github/openrouter (ordre APPRIS, borné) → Cohere (free trial)
  // → xAI (PAYANT, gaté par claudeOff = jamais en flux de fond). Chaque provider garde SA fonction/logs/cooldown.
  // L'apprentissage (server.js) ne réordonne QUE github/openrouter ; Groq/Cohere/xAI restent en slots fixes.
  const _mid = (_fallbackOrder && _fallbackOrder.length) ? _fallbackOrder : ['github', 'openrouter'];
  const _order = ['groq', ..._mid, 'cohere', 'xai'];
  for (const prov of _order) {
    if (prov === 'groq' && GROQ_KEYS.length) {
      try { const out = await _groq(prompt, maxTokens); _aiStat('groq'); return out; }
      catch (e) { console.warn(`[AI] Groq échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suite`); _aiStat('groqFail'); }
    } else if (prov === 'github' && GITHUB_TOKENS.length) {
      try { const out = await _githubModels(prompt, maxTokens); _aiStat('github'); return out; }
      catch (e) { console.warn(`[AI] GitHub Models échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suite`); _aiStat('githubFail'); }
    } else if (prov === 'openrouter' && OPENROUTER_KEYS.length) {
      try { const out = await _openrouter(prompt, maxTokens); _aiStat('openrouter'); return out; }
      catch (e) { console.warn(`[AI] OpenRouter échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suite`); _aiStat('openrouterFail'); }
    } else if (prov === 'cohere' && COHERE_KEYS.length) {
      try { const out = await _cohere(prompt, maxTokens); _aiStat('cohere'); return out; }
      catch (e) { console.warn(`[AI] Cohere échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suite`); _aiStat('cohereFail'); }
    } else if (prov === 'xai' && XAI_KEYS.length && !claudeOff) {   // xAI = PAYANT → JAMAIS sur un flux de fond « noClaude » (protège le budget)
      try { const out = await _xai(prompt, maxTokens); _aiStat('xai'); return out; }
      catch (e) { console.warn(`[AI] xAI échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)}${claudeOff ? '' : ' → Claude'}`); _aiStat('xaiFail'); }
    }
  }

  // ── Option C : Anthropic Claude (multi-clés, rotation + cooldown par clé) ────
  // Sautée si opts.noClaude → un flux de fond / « claudeOverBudget:false » ne touche JAMAIS les
  // crédits payants, même quand Gemini+GitHub échouent en budget (l'appelant a son fallback local).
  if (!claudeOff) {
    _aiStat('fallback');
    try { return await _anthropic(prompt, maxTokens); }
    catch (e) { e.claudeTried = true; throw e; }   // l'appelant (aiSmart) sait : pas de 2e passe Claude
  }

  throw new Error(opts.noClaude ? 'IA indisponible (Gemini/GitHub épuisés, Claude désactivé pour ce flux de fond)' : 'Aucune ressource IA configurée (GEMINI / GITHUB_TOKEN / ANTHROPIC)');
}

// Génère via Claude UNIQUEMENT (ignore Gemini). Utile quand le budget Gemini soft
// est épuisé mais qu'on veut quand même produire un vrai résultat IA via Claude.
async function generateTextClaudeOnly(prompt, maxTokens = 1500) {
  return _anthropic(prompt, maxTokens);
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
    geminiKeys: GEMINI_KEYS.length,
    geminiModels: GEMINI_MODELS,
    groq: { keys: GROQ_KEYS.length, models: GROQ_MODELS.length, coolingNow: _groqCool.coolingNow() },
    github: { tokens: GITHUB_TOKENS.length, model: GITHUB_MODEL, models: GITHUB_MODELS, coolingNow: [..._ghCooldown.values()].filter(t => t > Date.now()).length },
    openrouter: { keys: OPENROUTER_KEYS.length, models: OPENROUTER_MODELS.length, coolingNow: [..._orCooldown.values()].filter(t => t > Date.now()).length },
    cohere: { keys: COHERE_KEYS.length, models: COHERE_MODELS.length, coolingNow: _cohereCool.coolingNow() },
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
    backoff: { active: backoffActive(), totalFails: _totalFails },          // panne totale en cours ? (les self-heals s'espacent)
    geminiCoolingNow: [..._gemCooldown.entries()].filter(([, t]) => t > Date.now()).length,   // couples (modèle,clé) en cooldown 429
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
  setQuotaPressure,
  pressure,
  shouldThrottle,
  underPressure,
  setFallbackOrder,
  setLiveContext,
  hasAnthropic,
  claudeUsable,
  backoffActive,
  getClaudeState,
  hydrateClaudeState,
  onUsage,
  status,
  _anthropicKeyCount: () => ANTHROPIC_KEYS.length,
};

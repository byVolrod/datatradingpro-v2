/**
 * ai.js — Génération de texte IA
 * Priorité à Google Gemini (gratuit). Repli sur Anthropic Claude si configuré.
 * Plusieurs clés Gemini (GEMINI_API_KEY, _2.._5 + GOOGLE_API_KEY) ET plusieurs clés
 * Anthropic (ANTHROPIC_API_KEY, _2.._5) supportées : rotation round-robin + bascule
 * automatique sur la clé suivante en cas d'erreur (429 / quota / surcharge)
 * → on cumule les quotas des deux fournisseurs et on maximise la disponibilité.
 */
'use strict';

// Clés Gemini chargées DYNAMIQUEMENT : GEMINI_API_KEY puis _2, _3, … jusqu'à _30 (toute clé
// présente est prise automatiquement, SANS toucher au code) + GOOGLE_API_KEY. Rotation round-robin
// + bascule sur la clé suivante en cas de 429 → on CUMULE les quotas gratuits et on encaisse les pics.
const GEMINI_KEYS = (() => {
  const out = [];
  if (process.env.GEMINI_API_KEY) out.push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 30; i++) { const v = process.env['GEMINI_API_KEY' + i]; if (v) out.push(v); }   // _2.._30 auto-détectées
  if (process.env.GOOGLE_API_KEY) out.push(process.env.GOOGLE_API_KEY);
  return out.map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
})();
let _geminiCursor = 0;   // round-robin : clé de départ différente à chaque génération

// Cascade de modèles GRATUITS : chaque modèle a un quota gratuit SÉPARÉ → quand l'un renvoie 429
// (quota épuisé), on bascule sur le suivant ⇒ on cumule plusieurs quotas gratuits (~3× la capacité).
// On retire gemini-2.5-pro (payant → 429 systématique en gratuit). Surchargeable via GEMINI_MODEL.
// Modèles GRATUITS VALIDES (gemini-1.5-flash est DÉPRÉCIÉ → 404). Les '-lite' ont un quota gratuit
// bien plus élevé → plus de marge. Chaque modèle a un quota SÉPARÉ → on cumule (4 modèles × N clés).
const GEMINI_MODELS  = (process.env.GEMINI_MODEL || 'gemini-2.5-flash,gemini-2.0-flash,gemini-2.5-flash-lite,gemini-2.0-flash-lite')
  .split(',').map(s => s.trim()).filter(Boolean);

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

// ── Plafond DUR d'appels Claude par jour → les crédits (PAYANTS) ne s'emballent JAMAIS.
// Claude n'est qu'un REPLI (Gemini gratuit gère le gros) ; ce cap garantit un coût borné
// même si Gemini est indisponible longtemps. Surchargeable via CLAUDE_DAILY_MAX (Render).
const CLAUDE_DAILY_MAX = parseInt(process.env.CLAUDE_DAILY_MAX, 10) || 50;
let _claudeDay = '', _claudeCount = 0;
function _claudeBudgetOk() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== _claudeDay) { _claudeDay = d; _claudeCount = 0; }   // reset quotidien
  return _claudeCount < CLAUDE_DAILY_MAX;
}

// Toutes les clés Anthropic disponibles, chargées DYNAMIQUEMENT (ANTHROPIC_API_KEY puis _2.._30).
const ANTHROPIC_KEYS = (() => {
  const out = [];
  if (process.env.ANTHROPIC_API_KEY) out.push(process.env.ANTHROPIC_API_KEY);
  for (let i = 2; i <= 30; i++) { const v = process.env['ANTHROPIC_API_KEY' + i]; if (v) out.push(v); }
  return out.map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
})();

// ── GitHub Models (Microsoft/Azure inference, OpenAI-compatible) — 3ᵉ provider gratuit ──
// Repli APRÈS Gemini, AVANT Claude. Appelé en fetch (pas de SDK openai). MULTI-TOKENS dynamiques
// (GITHUB_TOKEN + _2.._20) → des tokens de COMPTES GitHub différents CUMULENT leur quota gratuit.
const GITHUB_TOKENS = (() => {
  const out = [];
  if (process.env.GITHUB_TOKEN) out.push(process.env.GITHUB_TOKEN);
  for (let i = 2; i <= 20; i++) { const v = process.env['GITHUB_TOKEN' + i]; if (v) out.push(v); }
  return out.map(t => (t || '').trim()).filter(Boolean).filter((t, i, a) => a.indexOf(t) === i);
})();
let _ghCursor = 0;
const GITHUB_MODEL = process.env.GITHUB_MODEL || 'gpt-4o';
const GITHUB_BASE  = process.env.GITHUB_MODELS_URL || 'https://models.inference.ai.azure.com';

// Visibilité au démarrage : combien de ressources IA sont chargées (jamais les valeurs).
console.log(`[AI] Ressources → Gemini: ${GEMINI_KEYS.length} clés · GitHub Models: ${GITHUB_TOKENS.length} token(s)${GITHUB_TOKENS.length ? ' (' + GITHUB_MODEL + ')' : ''} · Claude: ${ANTHROPIC_KEYS.length} clés`);

// ── CONTEXTE SYSTÈME PARTAGÉ ──────────────────────────────────────────────────
// Injecté dans CHAQUE appel (Gemini ET Claude, toutes les clés) → même "vision" du site,
// même rôle, mêmes règles → sorties COHÉRENTES quel que soit le modèle/la clé qui répond
// (fini les décalages Gemini ↔ Claude). N'écrase JAMAIS les consignes propres à chaque tâche.
const AI_SYSTEM = process.env.AI_SYSTEM_PROMPT || `You are the institutional AI analyst engine that powers DataTradingPro (DTP) — a professional, real-time FX & macro trading terminal modeled faithfully on Prime Terminal (PMT). The terminal gives traders live market data, breaking news, an economic calendar, currency-strength and risk-sentiment gauges, institutional research, market session wraps, and AI-generated insights.

Across EVERY feature (news tagging & analysis, analyst report segmentation & insights, the Macro AI chat, smart bias, research) you are ONE and the same persona: a concise, data-driven INSTITUTIONAL macro / forex analyst.

Rules — identical for every request, every model, every key:
- Be factual and precise. NEVER invent prices, figures, dates, quotes, tickers or events; if a value isn't provided, do not fabricate it. Accuracy on financial data is critical.
- Institutional tone: direct, professional, no preamble, no filler, no disclaimers; never mention being an AI.
- The SPECIFIC instructions of each request ALWAYS take precedence over style: follow the requested output format EXACTLY (e.g. "JSON only" → return only valid JSON; "one paragraph" → one paragraph; requested language → that language).
- Keep terminology/conventions consistent (tickers, central banks, BUY/SELL/NEUTRAL, risk-on/risk-off, bullish/bearish) so the output reads the SAME no matter which model answers.`;

// ── Contexte LIVE (système ÉVOLUTIF) ─────────────────────────────────────────
// Le serveur enregistre une fonction qui renvoie l'état temps réel du terminal
// (régime de risque, force des devises…). On l'injecte dans CHAQUE appel (Gemini ET
// Claude) → l'IA "voit" en permanence l'état à jour du marché et s'adapte en continu.
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
        systemInstruction: { parts: [{ text: _buildSystem() }] },   // contexte commun + état LIVE du terminal → cohérent & évolutif
        contents: [{ parts: [{ text: prompt }] }],
        // thinkingBudget:0 → pas de "réflexion" qui consomme les tokens de sortie (réponses fiables/rapides)
        // temperature 0.4 (alignée sur Claude) → moins de variance, sorties homogènes
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
  } finally { clearTimeout(_to); }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const err = new Error(`Gemini ${model} ${r.status}: ${t.slice(0, 150)}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error(`Gemini ${model}: réponse vide`);
  return text;
}

// ── Anthropic Claude — multi-clés avec rotation + bascule sur erreur ──────────
const _anthropicClients = new Map();   // clé → instance SDK (réutilisée)
let _anthropicCursor = 0;              // round-robin : on change de clé à chaque appel

function _getAnthropicClient(key) {
  if (_anthropicClients.has(key)) return _anthropicClients.get(key);
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key });
  _anthropicClients.set(key, client);
  return client;
}

async function _anthropic(prompt, maxTokens) {
  if (!ANTHROPIC_KEYS.length) throw new Error('Aucune clé Anthropic configurée');
  if (!_claudeBudgetOk()) throw new Error(`Claude: plafond du jour atteint (${CLAUDE_DAILY_MAX}/jour) → crédits préservés`);
  const n = ANTHROPIC_KEYS.length;
  const start = _anthropicCursor % n;
  _anthropicCursor = (_anthropicCursor + 1) % n;   // la prochaine génération démarre sur la clé suivante
  let lastErr;
  // On essaie chaque clé une fois, en partant de `start` (rotation), puis bascule si erreur.
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    try {
      const client = _getAnthropicClient(ANTHROPIC_KEYS[idx]);
      const msg = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        temperature: 0.4,    // alignée sur Gemini → moins de variance entre modèles
        system: _buildSystem(),   // contexte commun + état LIVE du terminal → cohérent & évolutif
        messages: [{ role: 'user', content: prompt }],
      });
      const text = (msg.content?.[0]?.text || '').trim();
      if (!text) throw new Error('Claude: réponse vide');
      _claudeCount++; _aiStat('claude');   // appel Claude réussi → compté dans le plafond du jour (crédits bornés)
      return text;
    } catch (e) {
      lastErr = e;
      const status = e?.status || e?.response?.status;
      console.warn(`[AI] Claude clé #${idx + 1}/${n} échec${status ? ' (' + status + ')' : ''}: ${String(e.message).slice(0, 120)} → clé suivante`);
      // 4xx d'authentification (clé invalide) : on tente quand même les autres clés.
      // 429/5xx : on bascule aussi. Donc dans tous les cas on passe à la clé suivante.
    }
  }
  throw lastErr || new Error('Toutes les clés Anthropic ont échoué');
}

// ── Gestion ADAPTATIVE du quota Gemini : cooldown par (modèle, clé) sur 429 + stats du jour ──
// Quand un couple (modèle, clé) renvoie 429 (quota/RPM saturé), on le met en cooldown : on ne le
// retente pas pendant un court délai → zéro appel gaspillé sur une clé saturée, charge répartie sur
// les autres. Auto-réparant : dès que le cooldown expire, la clé est ré-essayée automatiquement.
const _gemCooldown = new Map();   // "model|idx" → fin de cooldown (timestamp)
function _gemCool(model, idx, status) { _gemCooldown.set(model + '|' + idx, Date.now() + (status === 404 ? 6 * 3600 * 1000 : status === 429 ? 90000 : 25000)); }   // 404 (modèle invalide) = mis de côté 6h
function _gemIsCool(model, idx) { const t = _gemCooldown.get(model + '|' + idx); return !!t && t > Date.now(); }
// Suivi quotidien (visibilité "combien d'appels / 429 par jour" → pour anticiper le besoin de quota).
let _aiDay = '', _aiStats = { gemini: 0, gemini429: 0, github: 0, githubFail: 0, claude: 0, claudeFail: 0, fallback: 0 };
function _aiStat(f) {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== _aiDay) { _aiDay = d; _aiStats = { gemini: 0, gemini429: 0, github: 0, githubFail: 0, claude: 0, claudeFail: 0, fallback: 0 }; }
  _aiStats[f] = (_aiStats[f] || 0) + 1;
}

// ════════════ PHASE 1 — AI TRAFFIC INTELLIGENCE (router scoré + token-bucket + circuit breaker) ════════════
// But : éviter les RAFALES (RPM = cause des 429), router vers les (modèle,clé) les plus SAINS, et ouvrir un
// circuit breaker sur les couples qui échouent en série. 100% en mémoire (1 instance), provider-agnostic-ready.

// ── Token bucket GLOBAL Gemini : lisse notre débit pour rester SOUS le RPM (anti-rafale) ──
const _GEM_RPM = parseInt(process.env.GEMINI_RPM, 10) || 12;   // req/min visées (conservateur sous le free-tier)
let _gemBucket = _GEM_RPM, _gemBucketTs = Date.now();
function _gemBucketRefill() { const now = Date.now(); _gemBucket = Math.min(_GEM_RPM, _gemBucket + ((now - _gemBucketTs) / 1000) * (_GEM_RPM / 60)); _gemBucketTs = now; }
function _gemBucketTake() { _gemBucketRefill(); if (_gemBucket >= 1) { _gemBucket -= 1; return true; } return false; }
async function _gemBucketGate() { let waited = 0; while (!_gemBucketTake() && waited < 5000) { const refill = (1 - _gemBucket) / (_GEM_RPM / 60) * 1000; const w = Math.min(800, Math.max(50, refill)); await new Promise(r => setTimeout(r, w)); waited += w; } }

// ── Santé par (modèle, clé) : score de routing + circuit breaker ──
const _gemHealth = new Map();   // "model|idx" → {ok, fail, f429, ewmaMs, consec, breakerUntil}
function _h(model, idx) { const k = model + '|' + idx; let h = _gemHealth.get(k); if (!h) { h = { ok: 0, fail: 0, f429: 0, ewmaMs: 1500, consec: 0, breakerUntil: 0 }; _gemHealth.set(k, h); } return h; }
function _hOk(model, idx, ms) { const h = _h(model, idx); h.ok++; h.consec = 0; h.breakerUntil = 0; h.ewmaMs = h.ewmaMs * 0.7 + ms * 0.3; }
function _hFail(model, idx, is429) { const h = _h(model, idx); h.fail++; if (is429) h.f429++; h.consec++; if (h.consec >= 4) h.breakerUntil = Date.now() + 5 * 60 * 1000; }   // 4 échecs d'affilée → breaker 5 min
function _hBroken(model, idx) { return _h(model, idx).breakerUntil > Date.now(); }
function _hScore(model, idx) { const h = _h(model, idx); const tot = h.ok + h.fail; const sr = tot ? h.ok / tot : 0.6; return Math.max(0, sr - Math.min(0.3, h.ewmaMs / 20000) - h.consec * 0.05); }   // succès pondéré latence

// Provider GitHub Models (OpenAI-compatible) — fetch, contexte système partagé, rotation multi-comptes.
async function _githubModels(prompt, maxTokens) {
  const n = GITHUB_TOKENS.length; _ghCursor = (_ghCursor + 1) % n;
  let lastErr;
  for (let i = 0; i < n; i++) {
    const tok = GITHUB_TOKENS[(_ghCursor + i) % n];
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(GITHUB_BASE + '/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GITHUB_MODEL, messages: [{ role: 'system', content: AI_SYSTEM }, { role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.7 }),
        signal: ctrl.signal,
      });
      if (!r.ok) { const e = new Error('GitHub Models ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 120)); e.status = r.status; throw e; }
      const j = await r.json();
      const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!out || !String(out).trim()) throw new Error('réponse vide');
      return String(out).trim();
    } catch (e) { lastErr = e; }   // 429/échec d'un compte → on tente le token suivant (autre compte = autre quota)
    finally { clearTimeout(t); }
  }
  throw lastErr || new Error('GitHub Models: tous les tokens ont échoué');
}

async function generateText(prompt, maxTokens = 1500) {
  // ── Option A : Google Gemini (gratuit) — multi-clés + multi-modèles ──────────
  // Pour CHAQUE modèle, on essaie TOUTES les clés (rotation round-robin) : le meilleur
  // modèle (flash) est ainsi tenté sur l'ensemble des clés avant de passer au suivant
  // → quotas cumulés, bascule auto sur 429/quota épuisé.
  if (GEMINI_KEYS.length) {
    let lastErr;
    const n = GEMINI_KEYS.length;
    _geminiCursor = (_geminiCursor + 1) % n;
    await _gemBucketGate();   // anti-rafale : 1 jeton/appel → lisse le débit ENTRE les appels (la cause des 429)
    // Ordre des MODÈLES = cascade qualité (flash d'abord). Au sein d'un modèle, les clés sont ordonnées
    // par SANTÉ (succès récent + latence), cooldown/breaker filtrés.
    for (const model of GEMINI_MODELS) {
      const cand = [];
      for (let i = 0; i < n; i++) { const idx = (_geminiCursor + i) % n; if (_gemIsCool(model, idx) || _hBroken(model, idx)) continue; cand.push(idx); }
      cand.sort((a, b) => _hScore(model, b) - _hScore(model, a));   // meilleure santé d'abord
      for (const idx of cand) {
        const t0 = Date.now();
        try { const out = await _gemini(model, GEMINI_KEYS[idx], prompt, maxTokens); _hOk(model, idx, Date.now() - t0); _aiStat('gemini'); return out; }
        catch (e) {
          lastErr = e; const is429 = e.status === 429;
          _hFail(model, idx, is429);
          if (is429) { _gemCool(model, idx, 429); _aiStat('gemini429'); }
          else if (e.status === 404 || e.status === 503 || e.status === 500) _gemCool(model, idx, e.status);
          console.warn(`[AI] Gemini ${model} clé #${idx + 1}/${n} échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → suivant`);
        }
      }
    }
    if (!GITHUB_TOKENS.length && !ANTHROPIC_KEYS.length) throw lastErr || new Error('Gemini indisponible');
  }

  // ── Option B : GitHub Models (gpt-4o, quota gratuit Microsoft) — repli AVANT Claude ──
  if (GITHUB_TOKENS.length) {
    try { const out = await _githubModels(prompt, maxTokens); _aiStat('github'); return out; }
    catch (e) { console.warn(`[AI] GitHub Models échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 90)} → Claude`); _aiStat('githubFail'); }
  }

  // ── Option C : Anthropic Claude (multi-clés, rotation + bascule) ────────────
  if (ANTHROPIC_KEYS.length) { _aiStat('fallback'); return _anthropic(prompt, maxTokens); }

  throw new Error('Aucune ressource IA configurée (GEMINI / GITHUB_TOKEN / ANTHROPIC)');
}

// Génère via Claude UNIQUEMENT (ignore Gemini). Utile quand le budget Gemini soft
// est épuisé mais qu'on veut quand même produire un vrai résultat IA via Claude.
async function generateTextClaudeOnly(prompt, maxTokens = 1500) {
  return _anthropic(prompt, maxTokens);
}

function hasAnthropic() { return ANTHROPIC_KEYS.length > 0; }

// Diagnostic (sans exposer les valeurs) : quelles ressources IA sont configurées.
function status() {
  return {
    geminiKeys: GEMINI_KEYS.length,
    geminiModels: GEMINI_MODELS,
    github: { tokens: GITHUB_TOKENS.length, model: GITHUB_MODEL },
    anthropicKeys: ANTHROPIC_KEYS.length,
    claudeModel: CLAUDE_MODEL,
    claudeDailyMax: CLAUDE_DAILY_MAX,
    claudeUsedToday: _claudeCount,
    today: _aiDay,
    usageToday: _aiStats,                                                   // {gemini, gemini429, claude, fallback} → "le nombre par jour"
    geminiCoolingNow: [..._gemCooldown.entries()].filter(([, t]) => t > Date.now()).length,   // couples (modèle,clé) en cooldown 429
    // ── AI Traffic Intelligence (Phase 1) ──
    intel: {
      rpmTarget: _GEM_RPM,
      rpmBucket: Math.round((() => { _gemBucketRefill(); return _gemBucket; })() * 10) / 10,   // jetons dispo (proche de RPM = pas de rafale)
      breakersOpen: [..._gemHealth.values()].filter(h => h.breakerUntil > Date.now()).length,
      health: [..._gemHealth.entries()].map(([k, h]) => ({ k, ok: h.ok, fail: h.fail, f429: h.f429, ewmaMs: Math.round(h.ewmaMs), broken: h.breakerUntil > Date.now() }))
        .sort((a, b) => (b.ok + b.fail) - (a.ok + a.fail)).slice(0, 12),
    },
  };
}

module.exports = {
  generateText,
  generateTextClaudeOnly,
  setLiveContext,
  hasAnthropic,
  status,
  _anthropicKeyCount: () => ANTHROPIC_KEYS.length,
};

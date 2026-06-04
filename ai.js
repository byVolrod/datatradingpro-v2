/**
 * ai.js — Génération de texte IA
 * Priorité à Google Gemini (gratuit). Repli sur Anthropic Claude si configuré.
 * Plusieurs clés Gemini (GEMINI_API_KEY, _2.._5 + GOOGLE_API_KEY) ET plusieurs clés
 * Anthropic (ANTHROPIC_API_KEY, _2.._5) supportées : rotation round-robin + bascule
 * automatique sur la clé suivante en cas d'erreur (429 / quota / surcharge)
 * → on cumule les quotas des deux fournisseurs et on maximise la disponibilité.
 */
'use strict';

// Plusieurs clés Gemini supportées (GEMINI_API_KEY puis _2, _3, _4, _5 + GOOGLE_API_KEY) :
// rotation round-robin + bascule automatique sur la clé suivante en cas d'erreur
// (429 / quota épuisé) → on CUMULE les quotas gratuits et on encaisse les pics.
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3,
  process.env.GEMINI_API_KEY4,
  process.env.GEMINI_API_KEY5,
  process.env.GOOGLE_API_KEY,
].map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
let _geminiCursor = 0;   // round-robin : clé de départ différente à chaque génération

// Meilleur modèle réellement dispo sur le quota gratuit en 1er, repli ensuite.
// (gemini-2.5-pro nécessite un plan payant → 429 en gratuit ; 2.5-flash est excellent et gratuit)
const GEMINI_MODELS  = (process.env.GEMINI_MODEL || 'gemini-2.5-flash,gemini-2.5-pro')
  .split(',').map(s => s.trim()).filter(Boolean);

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

// Toutes les clés Anthropic disponibles (ANTHROPIC_API_KEY puis _2, _3, _4, _5).
// On déduplique et on retire les vides.
const ANTHROPIC_KEYS = [
  process.env.ANTHROPIC_API_KEY,
  process.env.ANTHROPIC_API_KEY2,
  process.env.ANTHROPIC_API_KEY3,
  process.env.ANTHROPIC_API_KEY4,
  process.env.ANTHROPIC_API_KEY5,
].map(k => (k || '').trim()).filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);

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
      return AI_SYSTEM + '\n\n--- LIVE TERMINAL STATE (real-time snapshot of THIS terminal — use it to stay accurate & relevant; never contradict it) ---\n' + String(c).trim();
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

async function generateText(prompt, maxTokens = 1500) {
  // ── Option A : Google Gemini (gratuit) — multi-clés + multi-modèles ──────────
  // Pour CHAQUE modèle, on essaie TOUTES les clés (rotation round-robin) : le meilleur
  // modèle (flash) est ainsi tenté sur l'ensemble des clés avant de passer au suivant
  // → quotas cumulés, bascule auto sur 429/quota épuisé.
  if (GEMINI_KEYS.length) {
    let lastErr;
    const n = GEMINI_KEYS.length;
    const start = _geminiCursor % n;
    _geminiCursor = (_geminiCursor + 1) % n;
    for (const model of GEMINI_MODELS) {
      for (let i = 0; i < n; i++) {
        const idx = (start + i) % n;
        try { return await _gemini(model, GEMINI_KEYS[idx], prompt, maxTokens); }
        catch (e) {
          lastErr = e;
          console.warn(`[AI] Gemini ${model} clé #${idx + 1}/${n} échec${e.status ? ' (' + e.status + ')' : ''}: ${String(e.message).slice(0, 110)} → suivant`);
        }
      }
    }
    if (!ANTHROPIC_KEYS.length) throw lastErr || new Error('Gemini indisponible');
  }

  // ── Option B : Anthropic Claude (multi-clés, rotation + bascule) ────────────
  if (ANTHROPIC_KEYS.length) return _anthropic(prompt, maxTokens);

  throw new Error('Aucune clé IA configurée (GEMINI_API_KEY ou ANTHROPIC_API_KEY…)');
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
    anthropicKeys: ANTHROPIC_KEYS.length,
    claudeModel: CLAUDE_MODEL,
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

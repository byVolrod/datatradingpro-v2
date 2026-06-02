/**
 * ai.js — Génération de texte IA
 * Priorité à Google Gemini (gratuit). Repli sur Anthropic Claude si configuré.
 * Plusieurs clés Anthropic supportées (ANTHROPIC_API_KEY, _2, _3, _4…) :
 * rotation round-robin + bascule automatique sur la clé suivante en cas d'erreur
 * (429 / quota / surcharge) → on cumule les quotas et on maximise la disponibilité.
 */
'use strict';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
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

async function _gemini(model, prompt, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // thinkingBudget:0 → pas de "réflexion" qui consomme les tokens de sortie (réponses fiables/rapides)
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
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
  // ── Option A : Google Gemini (gratuit) — essaie chaque modèle dans l'ordre ──
  if (GEMINI_API_KEY) {
    let lastErr;
    for (const model of GEMINI_MODELS) {
      try { return await _gemini(model, prompt, maxTokens); }
      catch (e) { lastErr = e; console.warn('[AI]', e.message, '→ modèle suivant'); }
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
    gemini: !!GEMINI_API_KEY,
    geminiModels: GEMINI_MODELS,
    anthropicKeys: ANTHROPIC_KEYS.length,
    claudeModel: CLAUDE_MODEL,
  };
}

module.exports = {
  generateText,
  generateTextClaudeOnly,
  hasAnthropic,
  status,
  _anthropicKeyCount: () => ANTHROPIC_KEYS.length,
};

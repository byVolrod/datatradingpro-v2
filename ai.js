/**
 * ai.js — Génération de texte IA
 * Priorité à Google Gemini (gratuit). Repli sur Anthropic Claude si configuré.
 */
'use strict';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
// Meilleur modèle réellement dispo sur le quota gratuit en 1er, repli ensuite.
// (gemini-2.5-pro nécessite un plan payant → 429 en gratuit ; 2.5-flash est excellent et gratuit)
const GEMINI_MODELS  = (process.env.GEMINI_MODEL || 'gemini-2.5-flash,gemini-2.5-pro')
  .split(',').map(s => s.trim()).filter(Boolean);

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

async function generateText(prompt, maxTokens = 1500) {
  // ── Option A : Google Gemini (gratuit) — essaie chaque modèle dans l'ordre ──
  if (GEMINI_API_KEY) {
    let lastErr;
    for (const model of GEMINI_MODELS) {
      try { return await _gemini(model, prompt, maxTokens); }
      catch (e) { lastErr = e; console.warn('[AI]', e.message, '→ modèle suivant'); }
    }
    if (!process.env.ANTHROPIC_API_KEY) throw lastErr || new Error('Gemini indisponible');
  }

  // ── Option B : Anthropic Claude (si clé présente) ──────────────────────────
  if (process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic();
    const msg = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return (msg.content[0]?.text || '').trim();
  }

  throw new Error('Aucune clé IA configurée (GEMINI_API_KEY ou ANTHROPIC_API_KEY)');
}

module.exports = { generateText };

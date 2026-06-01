/**
 * ai.js — Génération de texte IA
 * Priorité à Google Gemini (gratuit). Repli sur Anthropic Claude si configuré.
 */
'use strict';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function generateText(prompt, maxTokens = 1500) {
  // ── Option A : Google Gemini (gratuit) ─────────────────────────────────────
  if (GEMINI_API_KEY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.5 },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`Gemini ${r.status}: ${t.slice(0, 200)}`);
    }
    const data = await r.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!text) throw new Error('Gemini: réponse vide');
    return text;
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

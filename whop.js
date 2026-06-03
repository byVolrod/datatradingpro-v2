/**
 * whop.js — Intégration Whop (vérification des abonnements via l'API)
 * Sert à confirmer/renouveler un compte quand un paiement arrive (webhook).
 */
'use strict';

const WHOP_API_KEY = process.env.WHOP_API_KEY || '';
const DTP_PRODUCT  = process.env.WHOP_PRODUCT_ID || 'prod_murutybICilE9';   // « JOT - DTP 🏦 »
const BASE = 'https://api.whop.com/api/v2';

function _auth() { return { Authorization: `Bearer ${WHOP_API_KEY}`, 'Content-Type': 'application/json' }; }

// Normalise un membership Whop → { email, valid, expiresAt }
// Renvoie null si ce n'est PAS le produit DTP (on ignore les autres offres Whop).
function _normalize(m) {
  if (!m || !m.email) return null;
  if (m.product && m.product !== DTP_PRODUCT) return null;       // ← uniquement le produit DTP
  const endTs = m.renewal_period_end || m.expires_at || null;   // timestamps unix (secondes)
  return {
    email:     String(m.email).toLowerCase().trim(),
    valid:     m.valid === true || m.status === 'completed' || m.status === 'active',
    expiresAt: endTs ? new Date(endTs * 1000).toISOString() : null,
    plan:      m.plan || null,
    product:   m.product || null,
    status:    m.status || null,
  };
}

// Récupère un membership par son ID (mem_...) — source d'autorité
async function getMembership(id) {
  if (!WHOP_API_KEY || !id) return null;
  try {
    const r = await fetch(`${BASE}/memberships/${encodeURIComponent(id)}`, { headers: _auth() });
    if (!r.ok) return null;
    return _normalize(await r.json());
  } catch { return null; }
}

// Cherche le membership VALIDE le plus récent pour un email donné
async function getMembershipByEmail(email) {
  if (!WHOP_API_KEY || !email) return null;
  try {
    const r = await fetch(`${BASE}/memberships?valid=true&per=50&product_id=${DTP_PRODUCT}`, { headers: _auth() });
    if (!r.ok) return null;
    const j = await r.json();
    const target = String(email).toLowerCase().trim();
    const match = (j.data || []).find(m =>
      String(m.email || '').toLowerCase().trim() === target && m.product === DTP_PRODUCT);
    return match ? _normalize(match) : null;
  } catch { return null; }
}

// Statistiques RÉELLES Whop (abonnés actifs + MRR) pour le produit DTP — mises en cache 5 min
// (anti-charge / anti-502). Renvoie { active, mrr } ou null si Whop n'est pas configuré.
let _statsCache = { ts: 0, data: null };
async function getStats(priceMonthly) {
  if (!WHOP_API_KEY) return null;
  if (Date.now() - _statsCache.ts < 5 * 60 * 1000 && _statsCache.data) return _statsCache.data;
  try {
    let active = 0, mrr = 0, page = 1, totalPages = 1;
    do {
      const r = await fetch(`${BASE}/memberships?valid=true&per=50&page=${page}&product_id=${DTP_PRODUCT}`, { headers: _auth() });
      if (!r.ok) break;
      const j = await r.json();
      const data = Array.isArray(j) ? j : (j.data || []);
      for (const m of data) {
        if (m.product && m.product !== DTP_PRODUCT) continue;
        const ok = m.valid === true || m.status === 'active' || m.status === 'completed' || m.status === 'trialing';
        if (!ok) continue;
        active++;
        const price  = Number(m.renewal_price || m.price || (m.plan && m.plan.renewal_price) || 0);
        const period = String(m.billing_period || (m.plan && m.plan.billing_period) || 'monthly');
        if (price > 0) mrr += /year|annual/i.test(period) ? price / 12 : price;
        else mrr += priceMonthly || 0;   // pas de prix exposé → prix mensuel connu
      }
      const pg = j && j.pagination;
      totalPages = (pg && (pg.total_page || pg.total_pages)) || 1;
      page++;
    } while (page <= totalPages && page <= 6);   // cap 6 pages (300) — anti-RAM/temps
    const data = { active, mrr: +mrr.toFixed(2) };
    _statsCache = { ts: Date.now(), data };
    return data;
  } catch { return _statsCache.data; }
}

module.exports = { getMembership, getMembershipByEmail, getStats, configured: () => !!WHOP_API_KEY };

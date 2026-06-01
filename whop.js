/**
 * whop.js — Intégration Whop (vérification des abonnements via l'API)
 * Sert à confirmer/renouveler un compte quand un paiement arrive (webhook).
 */
'use strict';

const WHOP_API_KEY = process.env.WHOP_API_KEY || '';
const BASE = 'https://api.whop.com/api/v2';

function _auth() { return { Authorization: `Bearer ${WHOP_API_KEY}`, 'Content-Type': 'application/json' }; }

// Normalise un membership Whop → { email, valid, expiresAt }
function _normalize(m) {
  if (!m || !m.email) return null;
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
    const r = await fetch(`${BASE}/memberships?valid=true&per=50`, { headers: _auth() });
    if (!r.ok) return null;
    const j = await r.json();
    const target = String(email).toLowerCase().trim();
    const match = (j.data || []).find(m => String(m.email || '').toLowerCase().trim() === target);
    return match ? _normalize(match) : null;
  } catch { return null; }
}

module.exports = { getMembership, getMembershipByEmail, configured: () => !!WHOP_API_KEY };

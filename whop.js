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
    // Période de facturation RÉELLE (ms) → sert à déduire la cadence prise par le client (mensuel/annuel)
    periodStart: m.renewal_period_start ? m.renewal_period_start * 1000 : null,
    periodEnd:   m.renewal_period_end ? m.renewal_period_end * 1000 : null,
    plan:      m.plan || null,
    product:   m.product || null,
    status:    m.status || null,
    // username de l'AFFILIÉ qui a parrainé CETTE adhésion (lien ?a=<username>) — pour créditer le parrain
    affiliateUsername: m.affiliate_username || (m.affiliate && m.affiliate.username) || null,
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

// Cherche le membership VALIDE le plus récent pour un email donné.
// (Audit 28/07) PAGINÉ : la version 1-page (50) ratait tout abonné au-delà — or cette fonction
// sert désormais aussi de GARDE avant suspension (webhook) : un raté = suspension à tort.
async function getMembershipByEmail(email) {
  if (!WHOP_API_KEY || !email) return null;
  const target = String(email).toLowerCase().trim();
  let page = 1, totalPages = 1;
  try {
    do {
      const r = await fetch(`${BASE}/memberships?valid=true&per=50&page=${page}&product_id=${DTP_PRODUCT}`, { headers: _auth() });
      if (!r.ok) return null;
      const j = await r.json();
      const match = (Array.isArray(j) ? j : (j.data || [])).find(m =>
        String(m.email || '').toLowerCase().trim() === target && m.product === DTP_PRODUCT);
      if (match) return _normalize(match);
      const pg = j && j.pagination; totalPages = (pg && (pg.total_page || pg.total_pages)) || 1; page++;
    } while (page <= totalPages && page <= 20);
  if (totalPages > 20) console.warn('[Whop] pagination TRONQUÉE (cap 20 pages, ' + totalPages + ' annoncées) — jeu de données incomplet');
    return null;
  } catch { return null; }
}

// Lien d'affiliation d'un MEMBRE (par email) → { pageUrl, username }.
// pageUrl = affiliate_page_url CANONIQUE fourni par Whop (ex. https://whop.com/jot-dtp/?a=axelajt),
// vérifié en production. Replis : username direct, objet user imbriqué, id user_xxx via v5.
async function getAffiliateInfo(email) {
  if (!WHOP_API_KEY || !email) return null;
  const target = String(email).toLowerCase().trim();
  try {
    let m = null, page = 1, totalPages = 1;
    do {
      const r = await fetch(`${BASE}/memberships?valid=true&per=50&page=${page}&product_id=${DTP_PRODUCT}`, { headers: _auth() });
      if (!r.ok) break;
      const j = await r.json();
      m = (j.data || []).find(x => String(x.email || '').toLowerCase().trim() === target);
      if (m) break;
      const pg = j && j.pagination;
      totalPages = (pg && (pg.total_page || pg.total_pages)) || 1;
      page++;
    } while (page <= totalPages && page <= 6);
  if (totalPages > 6) console.warn('[Whop] pagination TRONQUÉE (cap 6 pages, ' + totalPages + ' annoncées) — jeu de données incomplet');
    if (!m) return null;
    const pageUrl = m.affiliate_page_url ? String(m.affiliate_page_url) : null;
    let username = (m.username && String(m.username)) ||
      (m.user && typeof m.user === 'object' && m.user.username && String(m.user.username)) || null;
    if (!username && pageUrl) { const mm = pageUrl.match(/[?&]a=([^&#]+)/); if (mm) username = decodeURIComponent(mm[1]); }
    if (!username) {
      const uid = typeof m.user === 'string' ? m.user : (m.user && m.user.id);
      if (uid && /^user_/.test(String(uid))) {
        for (const url of [`https://api.whop.com/api/v5/company/users/${uid}`, `https://api.whop.com/api/v5/app/users/${uid}`]) {
          try { const u = await fetch(url, { headers: _auth() }); if (u.ok) { const ju = await u.json(); if (ju && ju.username) { username = String(ju.username); break; } } } catch {}
        }
      }
    }
    return (pageUrl || username) ? { pageUrl, username } : null;
  } catch {}
  return null;
}
async function getAffiliateUsername(email) { const i = await getAffiliateInfo(email); return (i && i.username) || null; }

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
  if (totalPages > 6) console.warn('[Whop] pagination TRONQUÉE (cap 6 pages, ' + totalPages + ' annoncées) — jeu de données incomplet');
    const data = { active, mrr: +mrr.toFixed(2) };
    _statsCache = { ts: Date.now(), data };
    return data;
  } catch { return _statsCache.data; }
}

// Liste TOUS les memberships VALIDES du produit DTP (paginé, normalisés) → pour la réconciliation
// Whop→DTP (filet de sécurité si un webhook de renouvellement est raté/échoué).
async function listValidMemberships() {
  if (!WHOP_API_KEY) return [];
  const out = []; let page = 1, totalPages = 1;
  do {
    let r; try { r = await fetch(`${BASE}/memberships?valid=true&per=50&page=${page}&product_id=${DTP_PRODUCT}`, { headers: _auth() }); } catch { break; }
    if (!r.ok) break;
    const j = await r.json();
    const data = Array.isArray(j) ? j : (j.data || []);
    for (const m of data) {
      if (m.product && m.product !== DTP_PRODUCT) continue;
      const n = _normalize(m);
      if (n && n.email && n.valid) out.push(n);
    }
    const pg = j && j.pagination; totalPages = (pg && (pg.total_page || pg.total_pages)) || 1; page++;
  } while (page <= totalPages && page <= 10);   // cap 10 pages (500) — anti-RAM/temps
  if (totalPages > 10) console.warn('[Whop] pagination TRONQUÉE (cap 10 pages, ' + totalPages + ' annoncées) — jeu de données incomplet');
  return out;
}

// Liste TOUS les e-mails clients Whop pour l'AUDIENCE MARKETING : tous produits, tous statuts
// (completed/active/canceled/expired), dédupliqués par e-mail. Contrairement à listValidMemberships
// (abonnés DTP ACTIFS uniquement, pour la réconciliation), ici on veut TOUTE la base clients.
// SOURCES UNIONNÉES : /memberships (abonnements — inclut résiliés/expirés) ET /members (personnes
// rattachées à la société, y compris SANS abonnement actif → « même ceux sans memberships »). /members
// est aujourd'hui un sous-ensemble de /memberships, mais on l'unionne pour capter tout futur membre
// gratuit / contact sans ligne membership. Un CANCEL Whop N'EXCLUT PAS de la liste (churned = win-back) :
// seule la désinscription e-mail réelle (marqueur unsub:) exclut, côté envoi.
async function _pageEmailsInto(byEmail, subpath) {
  let page = 1, totalPages = 1;
  do {
    let r; try { r = await fetch(`${BASE}${subpath}?per=50&page=${page}`, { headers: _auth() }); } catch { break; }
    if (!r.ok) break;
    const j = await r.json();
    const data = Array.isArray(j) ? j : (j.data || []);
    for (const m of data) {
      const em = String((m.email || (m.user && m.user.email) || '')).toLowerCase().trim();
      if (!em) continue;
      const cur = byEmail.get(em) || { email: em, name: '', statuses: new Set() };
      cur.statuses.add(m.status || 'member');   // /members sans statut d'abonnement → 'member'
      if (!cur.name) { const nm = m.name || (m.user && (m.user.name || m.user.username)) || m.username || ''; if (nm) cur.name = String(nm).trim(); }
      byEmail.set(em, cur);
    }
    const pg = j && j.pagination; totalPages = (pg && (pg.total_page || pg.total_pages)) || 1; page++;
  } while (page <= totalPages && page <= 20);   // cap 20 pages (1000) — anti-RAM/temps
  if (totalPages > 20) console.warn('[Whop] pagination TRONQUÉE (cap 20 pages, ' + totalPages + ' annoncées) — jeu de données incomplet');
}
async function listAllMemberEmails() {
  if (!WHOP_API_KEY) return [];
  const byEmail = new Map();
  await _pageEmailsInto(byEmail, '/memberships');   // abonnements (tous statuts)
  await _pageEmailsInto(byEmail, '/members');       // personnes (incl. sans abonnement)
  return [...byEmail.values()].map(v => ({ email: v.email, name: v.name, statuses: [...v.statuses] }));
}

// TOUS les memberships DTP, TOUS statuts (canceled/expired inclus) — sert au balayage « accès
// fantômes » (_whopGhostSweep, server.js) : il faut voir les adhésions MORTES, ce que
// listValidMemberships (filtre valid=true) ne remonte jamais.
async function listAllMemberships() {
  if (!WHOP_API_KEY) return [];
  const out = []; let page = 1, totalPages = 1;
  do {
    let r; try { r = await fetch(`${BASE}/memberships?per=50&page=${page}&product_id=${DTP_PRODUCT}`, { headers: _auth() }); } catch { break; }
    if (!r.ok) break;
    const j = await r.json();
    const data = Array.isArray(j) ? j : (j.data || []);
    for (const m of data) {
      if (m.product && m.product !== DTP_PRODUCT) continue;
      const em = String(m.email || (m.user && m.user.email) || '').toLowerCase().trim();
      if (!em) continue;
      out.push({
        id: m.id, email: em, valid: m.valid === true, status: m.status || '',
        periodStart: m.renewal_period_start ? m.renewal_period_start * 1000 : null,
        periodEnd: (m.renewal_period_end || m.expires_at) ? (m.renewal_period_end || m.expires_at) * 1000 : null,
      });
    }
    const pg = j && j.pagination; totalPages = (pg && (pg.total_page || pg.total_pages)) || 1; page++;
  } while (page <= totalPages && page <= 20);
  if (totalPages > 20) console.warn('[Whop] pagination TRONQUÉE (cap 20 pages, ' + totalPages + ' annoncées) — jeu de données incomplet');
  return out;
}

// Tous les PAIEMENTS de la société — rapprochés ensuite par ID de membership (les objets payment ne
// portent pas l'e-mail de façon fiable). Seul le statut « paid » vaut PREUVE d'encaissement : un
// paiement « open » est un prélèvement émis mais jamais soldé (cas des renouvellements échoués).
async function listPayments() {
  if (!WHOP_API_KEY) return [];
  const out = []; let page = 1, totalPages = 1;
  do {
    let r; try { r = await fetch(`${BASE}/payments?per=50&page=${page}`, { headers: _auth() }); } catch { break; }
    if (!r.ok) break;
    const j = await r.json();
    const data = Array.isArray(j) ? j : (j.data || []);
    for (const p of data) {
      const memId = p.membership || p.membership_id || null;
      if (!memId) continue;
      // MONTANTS conservés (ils étaient jetés — d'où un tableau de bord qui ne pouvait qu'ESTIMER le
      // revenu depuis une grille de prix au lieu de lire l'argent réellement encaissé).
      // `final_amount` = ce qui a été débité ; `refunded_amount` s'en retranche pour obtenir le NET.
      // `paid_at` fait foi sur la date d'encaissement — `created_at` n'est que l'émission.
      out.push({
        membership: memId,
        status: String(p.status || ''),
        ts: p.created_at ? p.created_at * 1000 : 0,
        paidAt: p.paid_at ? p.paid_at * 1000 : (p.created_at ? p.created_at * 1000 : 0),
        montant: Number(p.final_amount != null ? p.final_amount : (p.total != null ? p.total : p.subtotal)) || 0,
        rembourse: Number(p.refunded_amount) || 0,
        devise: String(p.currency || '').toLowerCase(),
        plan: p.plan || null,
        user: p.user || null,
      });
    }
    const pg = j && j.pagination; totalPages = (pg && (pg.total_page || pg.total_pages)) || 1; page++;
  } while (page <= totalPages && page <= 60);   // cap 60 pages (3000) — anti-RAM/temps
  if (totalPages > 60) console.warn('[Whop] pagination TRONQUÉE (cap 60 pages, ' + totalPages + ' annoncées) — jeu de données incomplet');
  return out;
}

// AVIS/TÉMOIGNAGES des membres (endpoint /v2/reviews VÉRIFIÉ en prod le 27/07 : 23 avis).
// Sert le template « Témoignage » du panneau Campagne — on ne garde que les avis EXPLOITABLES :
// produit DTP, texte non vide. Tri : meilleurs d'abord (étoiles puis récence).
async function listReviews() {
  if (!WHOP_API_KEY) return [];
  const out = []; let page = 1, totalPages = 1;
  do {
    let r; try { r = await fetch(`${BASE}/reviews?per=50&page=${page}`, { headers: _auth() }); } catch { break; }
    if (!r.ok) break;
    const j = await r.json();
    const data = Array.isArray(j) ? j : (j.data || []);
    for (const v of data) {
      if (v.product && v.product !== DTP_PRODUCT) continue;
      const txt = String(v.description || '').trim();
      if (!txt) continue;
      out.push({ id: v.id, stars: Number(v.stars) || 0, title: v.title || '', description: txt,
        createdAt: v.created_at ? v.created_at * 1000 : 0 });
    }
    const pg = j && j.pagination; totalPages = (pg && (pg.total_page || pg.total_pages)) || 1; page++;
  } while (page <= totalPages && page <= 10);
  if (totalPages > 10) console.warn('[Whop] pagination TRONQUÉE (cap 10 pages, ' + totalPages + ' annoncées) — jeu de données incomplet');
  out.sort((a, b) => (b.stars - a.stars) || (b.createdAt - a.createdAt));
  return out;
}

// ─── REVENU RÉELLEMENT ENCAISSÉ ────────────────────────────────────────────────────────────────
// Le tableau de bord admin ESTIMAIT le revenu depuis une grille de prix et la durée d'accès de
// chaque compte. On lit désormais l'argent réel, chez Whop.
//   · seuls les paiements « paid » comptent — un « open » est un prélèvement émis, jamais soldé
//     (c'est le cas des renouvellements échoués : compté, il gonflerait le chiffre d'affaires) ;
//   · NET = final_amount − refunded_amount (un remboursement n'est pas un revenu) ;
//   · la date qui fait foi est paid_at (encaissement), pas created_at (émission).
// Résultat mis en cache 10 min : la pagination coûte quelques appels, et ces chiffres n'ont pas
// besoin d'être à la seconde.
let _revCache = { at: 0, data: null };
async function revenueStats(opts) {
  const force = !!(opts && opts.force);
  if (!force && _revCache.data && Date.now() - _revCache.at < 10 * 60 * 1000) return _revCache.data;
  if (!WHOP_API_KEY) return null;

  const pays = await listPayments();
  const payes = pays.filter(p => p.status === 'paid' && p.paidAt > 0);
  const net = p => Math.max(0, (p.montant || 0) - (p.rembourse || 0));

  const now = Date.now(), J = 86400000;
  const cle = ts => { const d = new Date(ts); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
  const moisCourant = cle(now);
  const moisPrec = cle(new Date(new Date().setUTCMonth(new Date().getUTCMonth() - 1)));

  // Série 12 mois (du plus ancien au plus récent), pour le graphe
  // ⚠️ Le jour est ramené au 1er AVANT de retrancher les mois. En partant du 29, « −5 mois » vise le
  // 29 février : date inexistante hors bissextile, que JS fait déborder sur le 1er mars — la série
  // affichait alors mars DEUX FOIS et perdait février.
  const serie = [];
  const base = new Date(); base.setUTCDate(1); base.setUTCHours(12, 0, 0, 0);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base.getTime()); d.setUTCMonth(base.getUTCMonth() - i);
    serie.push({ mois: cle(d.getTime()), total: 0, nb: 0 });
  }
  const idx = Object.fromEntries(serie.map((m, i) => [m.mois, i]));

  let total = 0, nb = 0, rembourse = 0, ceMois = 0, moisDernier = 0, j30 = 0, j30Prec = 0;
  const devises = new Set();
  for (const p of payes) {
    const v = net(p);
    total += v; nb++; rembourse += (p.rembourse || 0);
    if (p.devise) devises.add(p.devise);
    const k = cle(p.paidAt);
    if (k === moisCourant) ceMois += v;
    if (k === moisPrec) moisDernier += v;
    const age = now - p.paidAt;
    if (age <= 30 * J) j30 += v;
    else if (age <= 60 * J) j30Prec += v;
    if (idx[k] != null) { serie[idx[k]].total += v; serie[idx[k]].nb++; }
  }

  const arrondi = x => Math.round(x * 100) / 100;
  serie.forEach(m => { m.total = arrondi(m.total); });   // sinon 99.90999999999998 s affiche tel quel
  const data = {
    total: arrondi(total),                     // encaissé depuis le début (net de remboursements)
    nb,                                        // nombre de paiements soldés
    panier: nb ? arrondi(total / nb) : 0,      // panier moyen réel
    rembourse: arrondi(rembourse),
    ceMois: arrondi(ceMois),
    moisDernier: arrondi(moisDernier),
    j30: arrondi(j30),
    j30Prec: arrondi(j30Prec),
    // Variation 30 j vs les 30 j précédents — null si aucune base de comparaison (sinon on
    // afficherait « +∞ % » au premier mois, ce qui ne veut rien dire.)
    j30Var: j30Prec > 0 ? Math.round(((j30 - j30Prec) / j30Prec) * 1000) / 10 : null,
    serie,
    devise: devises.size === 1 ? [...devises][0] : (devises.size ? 'mixte' : 'eur'),
    at: Date.now(),
  };
  _revCache = { at: Date.now(), data };
  return data;
}

module.exports = { getMembership, getMembershipByEmail, getAffiliateInfo, getAffiliateUsername, getStats, listValidMemberships, listAllMemberEmails, listAllMemberships, listPayments, listReviews, revenueStats, configured: () => !!WHOP_API_KEY };

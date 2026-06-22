#!/usr/bin/env node
'use strict';
/**
 * Supabase keep-alive — empêche la mise en pause des projets free-tier (inactivité ≈ 7 jours).
 *
 * Envoie une requête TRÈS légère (HEAD `…/rest/v1/<table>?limit=1`) à CHAQUE projet Supabase
 * configuré → une vraie requête SQL côté Postgres (donc « activité » comptée par Supabase),
 * SANS corps de réponse (égress quasi nul — cf. notre historique d'égress).
 *
 * Zéro dépendance : `fetch`/`AbortController` natifs de Node ≥ 20.
 * Lancé par GitHub Actions (cron quotidien) ou à la main (`npm run keepalive`).
 *
 * ── Configuration (variables d'env, ou secrets GitHub via SECRETS_JSON = toJSON(secrets)) ──
 *   SUPABASE_URL / SUPABASE_KEY                       → projet PRINCIPAL
 *   SUPABASE_URL_2 / SUPABASE_KEY_2  … _N / _N        → projets SECONDAIRES (auto-détectés,
 *                                                       n'importe quel suffixe → calqué sur auth.js)
 *   SUPABASE_KEEPALIVE_TABLE  (optionnel, défaut « ai_cache »)
 *                                                     → table interrogée ; repli sur la racine REST
 *                                                       si la table est absente sur une base
 *   KEEPALIVE_WEBHOOK_URL     (optionnel)             → webhook Discord/Slack alerté en cas d'échec
 *
 * Sorties : code 0 = tout OK (ou aucune base configurée) ; code 1 = au moins un échec (→ alerte CI).
 */

const TIMEOUT_MS = 15000;

// Source des variables : process.env + (optionnel) SECRETS_JSON = toutes les secrets GitHub.
function buildVars() {
  const vars = { ...process.env };
  if (process.env.SECRETS_JSON) {
    try { Object.assign(vars, JSON.parse(process.env.SECRETS_JSON)); }
    catch (e) { console.warn('[keepalive] SECRETS_JSON illisible (ignoré) :', e.message); }
  }
  return vars;
}

// Détecte TOUS les projets : SUPABASE_URL (principal) + SUPABASE_URL_<suffixe> (secondaires).
function collectProjects(vars) {
  const out = [];
  for (const k of Object.keys(vars)) {
    const m = /^SUPABASE_URL(_[A-Za-z0-9]+)?$/.exec(k);
    if (!m) continue;
    const suffix = m[1] || '';
    const url = String(vars[k] || '').trim();
    const key = String(vars['SUPABASE_KEY' + suffix] || '').trim();
    if (!url || !key) continue;                       // base incomplète → ignorée
    out.push({
      name: suffix ? 'db' + suffix.slice(1) : 'primary',
      url: url.replace(/\/+$/, ''),
      key,
    });
  }
  out.sort((a, b) => (a.name === 'primary' ? -1 : b.name === 'primary' ? 1 : a.name.localeCompare(b.name)));
  return out;
}

function host(u) { try { return new URL(u).host; } catch { return String(u); } }

async function ping(project, table) {
  const headers = { apikey: project.key, Authorization: 'Bearer ' + project.key };
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // 1) HEAD sur la table (requête SQL réelle, AUCUN corps renvoyé → égress ~nul)
    let res = await fetch(`${project.url}/rest/v1/${encodeURIComponent(table)}?limit=1`,
      { method: 'HEAD', headers, signal: ctrl.signal });
    // table absente / non exposée sur cette base → repli sur la racine REST (compte aussi comme activité)
    if (res.status === 404 || res.status === 400) {
      res = await fetch(`${project.url}/rest/v1/`, { method: 'GET', headers, signal: ctrl.signal });
    }
    try { if (res.body) await res.arrayBuffer(); } catch (_) { /* HEAD / corps vide */ }
    clearTimeout(timer);
    return { ok: res.status >= 200 && res.status < 400, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, ms: Date.now() - t0, error: e.name === 'AbortError' ? `timeout>${TIMEOUT_MS}ms` : e.message };
  }
}

async function alert(webhook, failed) {
  if (!webhook || !failed.length) return;
  const lines = failed.map(f => `• ${f.name} (${host(f.url)}) → ${f.status || 'ERR'}${f.error ? ' ' + f.error : ''}`).join('\n');
  const msg = `🔴 Supabase keep-alive — ${failed.length} projet(s) en échec\n${lines}`;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msg, text: msg }), // content=Discord, text=Slack
    });
  } catch (e) { console.warn('[keepalive] webhook injoignable :', e.message); }
}

(async () => {
  // Filet anti-blocage : si une socket réseau traîne, on force la sortie à 12 s (unref → ne maintient
  // pas la boucle ; ne se déclenche que si le process est encore vivant). Évite un job CI suspendu.
  setTimeout(() => process.exit(process.exitCode || 0), 12000).unref();
  const vars = buildVars();
  const TABLE = (vars.SUPABASE_KEEPALIVE_TABLE || 'ai_cache').trim();
  const WEBHOOK = (vars.KEEPALIVE_WEBHOOK_URL || '').trim();
  const stamp = new Date().toISOString();

  const projects = collectProjects(vars);
  console.log(`[keepalive] ${stamp} — ${projects.length} projet(s) Supabase détecté(s)` +
    (projects.length ? ' : ' + projects.map(p => `${p.name}(${host(p.url)})`).join(', ') : ''));

  if (!projects.length) {
    console.warn('[keepalive] ⚠ Aucun projet configuré (SUPABASE_URL/KEY absents). ' +
      'Ajoute les secrets GitHub (voir scripts/SUPABASE-KEEPALIVE.md). Sortie 0 — pas d\'alerte.');
    return;
  }

  const results = [];
  for (const p of projects) {
    const r = await ping(p, TABLE);
    results.push({ ...p, ...r });
    console.log(`  ${r.ok ? '✅' : '❌'} ${p.name.padEnd(8)} ${host(p.url).padEnd(34)} status=${String(r.status).padEnd(3)} ${r.ms}ms${r.error ? ' · ' + r.error : ''}`);
  }

  const failed = results.filter(r => !r.ok);
  console.log(`[keepalive] résumé : ${results.length - failed.length}/${results.length} OK, ${failed.length} échec(s) (table « ${TABLE} »)`);

  if (failed.length) {
    await alert(WEBHOOK, failed.map(f => ({ name: f.name, url: f.url, status: f.status, error: f.error })));
    process.exitCode = 1;
  }
})();

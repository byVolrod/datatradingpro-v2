#!/usr/bin/env node
'use strict';
/**
 * Supabase keep-alive — empêche la mise en pause des projets free-tier (inactivité ≈ 7 jours).
 *
 * Envoie un WRITE léger (upsert d'1 ligne `ai_cache?on_conflict=key`, `Prefer: return=minimal`) à CHAQUE
 * projet → activité Postgres INCONTESTABLE. On écrit (INGRESS, non plafonné par l'egress) au lieu de LIRE :
 * un HEAD/READ est REJETÉ par un projet en 402 (egress) et ne compte PAS comme activité → pause quand même.
 * `return=minimal` → aucun corps renvoyé (égress nul — cf. notre historique d'égress).
 * NB : le VPS (toujours allumé) fait DÉJÀ ce keep-alive en interne (auth.js `_keepAlive`, /12 h) ; ce script
 * CI est une ceinture-bretelles redondante (utile si le VPS est arrêté).
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
 * Sorties : code 0 = tout OK ; code 1 = au moins un échec, ET AUSSI le cas « aucune base
 * configurée » — une tâche qui ne pingue rien est en panne, pas au repos (cf. l'incident du
 * 02/09/2026 : 142 passages verts sans un seul ping, projet en pause pendant deux mois et demi).
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
      /* JETON DE GESTION PROPRE A CETTE BASE, avec repli sur le jeton global. Les quatre projets ne
         vivent pas forcement sous le MEME compte Supabase : un jeton personnel n a de droits que sur
         les organisations auxquelles il appartient. Un jeton unique reveillerait donc le principal et
         echouerait en silence sur les autres — c est exactement le genre de demi-reparation qui se
         decouvre le jour ou l on en a besoin. SUPABASE_ACCESS_TOKEN_2 pour db2, etc. */
      jeton: String(vars['SUPABASE_ACCESS_TOKEN' + suffix] || vars.SUPABASE_ACCESS_TOKEN || '').trim(),
    });
  }
  out.sort((a, b) => (a.name === 'primary' ? -1 : b.name === 'primary' ? 1 : a.name.localeCompare(b.name)));
  return out;
}

function host(u) { try { return new URL(u).host; } catch { return String(u); } }

async function ping(project, table) {
  const stamp = new Date().toISOString();
  const headers = {
    apikey: project.key, Authorization: 'Bearer ' + project.key,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',   // upsert (par `key`) + AUCUN corps renvoyé → égress nul
  };
  const body = JSON.stringify({ key: 'keepalive:heartbeat', value: { ts: Date.now(), at: stamp, src: 'ci' }, created_at: stamp });
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // 1) WRITE réel sur la table (INGRESS, non plafonné par l'egress) = activité Postgres incontestable
    let res = await fetch(`${project.url}/rest/v1/${encodeURIComponent(table)}?on_conflict=key`,
      { method: 'POST', headers, body, signal: ctrl.signal });
    // table absente / non exposée sur cette base → repli GET racine REST (compte au moins comme requête)
    if (res.status === 404 || res.status === 400) {
      res = await fetch(`${project.url}/rest/v1/`, { method: 'GET', headers: { apikey: project.key, Authorization: 'Bearer ' + project.key }, signal: ctrl.signal });
    }
    try { if (res.body) await res.arrayBuffer(); } catch (_) { /* return=minimal → corps vide */ }
    clearTimeout(timer);
    return { ok: res.status >= 200 && res.status < 400, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, ms: Date.now() - t0, error: e.name === 'AbortError' ? `timeout>${TIMEOUT_MS}ms` : e.message };
  }
}

/* ══ REPRISE AUTOMATIQUE D UN PROJET MIS EN PAUSE ══════════════════════════════════════════════
   (02/09/2026, demande utilisateur : « quand elle se met en pause tu la relances automatiquement ».)

   POURQUOI CA NE PEUT PAS PASSER PAR LE PING. Un projet en pause REFUSE toute requete, y compris le
   write de ce keep-alive. Il ne peut donc pas se reveiller lui-meme : c est exactement pour cela que
   le projet principal est reste en pause du 14 juin au 2 septembre, en depit d un keep-alive cense
   tourner tous les jours. Seule l API de GESTION peut le rallumer, et elle parle un autre langage —
   un jeton personnel (sbp_...), pas la cle de service de la base.

   ⚠️ TROIS GARDE-FOUS, PARCE QU ON AGIT SUR DE LA PRODUCTION.
   1. ON NE RESTAURE QUE SUR PREUVE. Un ping qui echoue ne prouve RIEN : coupure reseau, DNS, 402
      d egress, table absente. On interroge l API de gestion et on n agit QUE si elle repond
      textuellement INACTIVE. Relancer un projet deja sain serait une action gratuite sur la prod.
   2. UNE SEULE TENTATIVE PAR PROJET ET PAR PASSAGE. La restauration prend « de quelques minutes a
      plusieurs heures » ; la relancer en boucle ne l accelere pas et peut la perturber.
   3. SANS JETON, ON LE DIT. Pas de reprise silencieuse impossible : le message nomme ce qui manque.

   Le jeton vit UNIQUEMENT dans le .env du VPS et dans les secrets GitHub, jamais dans le depot. */
const API_GESTION = 'https://api.supabase.com/v1';

/* La reference du projet est le premier segment de son hote : https://<ref>.supabase.co */
function refDe(url) { const m = /^https?:\/\/([a-z0-9]+)\.supabase\./i.exec(String(url || '')); return m ? m[1] : null; }

async function etatProjet(ref, jeton) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_GESTION}/projects/${encodeURIComponent(ref)}`,
      { headers: { Authorization: 'Bearer ' + jeton }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { err: 'HTTP ' + res.status };
    const j = await res.json().catch(() => null);
    return { statut: j && j.status ? String(j.status) : null };
  } catch (e) { clearTimeout(timer); return { err: e.name === 'AbortError' ? 'timeout' : e.message }; }
}

async function relancer(ref, jeton) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_GESTION}/projects/${encodeURIComponent(ref)}/restore`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + jeton, 'Content-Type': 'application/json' }, body: '{}', signal: ctrl.signal });
    clearTimeout(timer);
    return { ok: res.status >= 200 && res.status < 400, status: res.status };
  } catch (e) { clearTimeout(timer); return { ok: false, status: 0, err: e.name === 'AbortError' ? 'timeout' : e.message }; }
}

/* Rend la liste des projets REELLEMENT relances (pour le journal et l alerte). */
async function repriseAuto(echecs, jetonGlobal) {
  if (!echecs.length) return [];
  if (!echecs.some(p => p.jeton || jetonGlobal)) {
    console.warn('[keepalive] ⚠ reprise automatique INDISPONIBLE : SUPABASE_ACCESS_TOKEN absent. '
      + 'Un projet mis en pause ne pourra pas etre rallume tout seul (le ping, lui, est refuse par un '
      + 'projet en pause — c est ce qui l a laisse eteint deux mois et demi).');
    return [];
  }
  const relances = [];
  for (const p of echecs) {
    const ref = refDe(p.url);
    if (!ref) { console.warn(`  · ${p.name} : reference de projet illisible dans l URL → pas de reprise`); continue; }
    const jeton = p.jeton || jetonGlobal;
    if (!jeton) { console.warn(`  · ${p.name} : aucun jeton de gestion (SUPABASE_ACCESS_TOKEN${p.name === 'primary' ? '' : '_' + p.name.slice(2)}) → pas de reprise`); continue; }
    const e = await etatProjet(ref, jeton);
    if (e.err) { console.warn(`  · ${p.name} : etat introuvable (${e.err}) → aucune action`); continue; }
    if (e.statut !== 'INACTIVE') { console.log(`  · ${p.name} : statut ${e.statut} — ce n est PAS une pause, aucune action`); continue; }
    const r = await relancer(ref, jeton);
    if (r.ok) { relances.push(p.name); console.log(`  ♻️ ${p.name} etait EN PAUSE → restauration demandee (elle peut prendre plusieurs minutes)`); }
    else console.error(`  · ${p.name} EN PAUSE mais la restauration a echoue (HTTP ${r.status}${r.err ? ' ' + r.err : ''})`);
  }
  return relances;
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
    /* ⚠️ CETTE BRANCHE RENDAIT 0, ET C EST CE QUI A COUTE LE PLUS CHER DE TOUT LE PROJET (02/09/2026).
       « Sortie 0 — pas d alerte » partait d une bonne intention : ne pas faire rougir un depot ou la
       sauvegarde n est pas encore branchee. Le resultat s est mesure. Le job a tourne 142 fois, VERT
       a chaque passage, en affichant « 0 projet(s) Supabase detecte(s) » que personne n a jamais lu.
       Les secrets n avaient jamais ete poses. Pendant ce temps le projet principal est reste sans
       activite, Supabase l a mis en pause, et il y est reste du 14 juin au 2 septembre — deux mois et
       demi pendant lesquels le tableau de bord GitHub affichait une coche verte tous les jours.
       LA REGLE, DESORMAIS : une tache qui ne peut pas faire son travail le DIT. Un keep-alive sans
       projet configure n est pas un keep-alive au repos, c est un keep-alive en panne. Il sort 1 et,
       si un webhook est configure, il alerte — exactement comme un ping qui echoue. */
    console.error('[keepalive] ❌ AUCUN projet configure (SUPABASE_URL/KEY absents) : cette tache ne '
      + 'garde AUCUNE base eveillee. Poser les secrets GitHub (voir scripts/SUPABASE-KEEPALIVE.md). '
      + 'Sortie 1 — un job vert affirmerait le contraire.');
    await alert(WEBHOOK, [{ name: 'configuration', url: '(aucune)', status: 0, error: 'aucun secret SUPABASE_URL/KEY : le keep-alive ne pingue rien' }]);
    process.exitCode = 1;
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
    /* AVANT D ALERTER, ON ESSAIE DE REPARER. L alerte dit alors ce qui a ete fait, pas seulement ce
       qui est casse — et le passage reste ROUGE : une restauration demandee n est pas une base
       revenue, elle prend du temps, et le prochain passage le confirmera (ou pas). */
    const relances = await repriseAuto(failed, (vars.SUPABASE_ACCESS_TOKEN || '').trim());
    await alert(WEBHOOK, failed.map(f => ({
      name: f.name + (relances.includes(f.name) ? ' (restauration demandee)' : ''),
      url: f.url, status: f.status, error: f.error,
    })));
    process.exitCode = 1;
  }
})();

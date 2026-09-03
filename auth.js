/**
 * auth.js — Authentication & User Management
 * Backend: Supabase Postgres  |  Passwords: bcrypt
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;
const SALT_ROUNDS   = 12;
const TABLE         = 'users';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[Auth] ❌ SUPABASE_URL / SUPABASE_KEY manquants dans .env');
  process.exit(1);
}

// ════════════════ REDONDANCE MULTI-BASES (anti-blocage egress Supabase) ════════════════
// Plusieurs projets Supabase (principal + secondaires via env SUPABASE_URL_2/3/4 + KEY_2/3/4).
// Pour les tables KV DURABLES à clé (ai_cache, weekly_reports, email_log) — qui portent l'egress lourd :
//   • ÉCRITURE → TOUTES les bases saines (données identiques, clé fournie → cohérence triviale) ;
//   • LECTURE → ROUND-ROBIN sur les bases saines (l'egress se répartit → ~Nx de marge avant un cap)
//              + repli automatique sur la base suivante si l'une est restreinte/muette.
// Les tables SENSIBLES (users, chat_messages) restent sur la base PRINCIPALE uniquement (ids auto-générés
// → un dual-write donnerait des ids divergents) : leur redondance est déjà assurée par le miroir local +
// fichier (login/sessions survivent au blackout). Zéro risque côté auth.
function _mkClient(url, key) { return createClient(url, key, { auth: { persistSession: false } }); }
const _dbNodes = [];
function _addNode(name, url, key) { if (!url || !key) return; try { _dbNodes.push({ name, url, client: _mkClient(url, key), downUntil: 0, quarLect: false }); } catch (e) { console.error(`[Auth] base ${name} IGNORÉE (URL/clé invalide → ne crashe pas le boot) :`, e.message); } }
_addNode('primary', SUPABASE_URL, SUPABASE_KEY);
_addNode('db2', process.env.SUPABASE_URL_2, process.env.SUPABASE_KEY_2);
_addNode('db3', process.env.SUPABASE_URL_3, process.env.SUPABASE_KEY_3);
_addNode('db4', process.env.SUPABASE_URL_4, process.env.SUPABASE_KEY_4);
_addNode('db5', process.env.SUPABASE_URL_5, process.env.SUPABASE_KEY_5);   // 5e base : s'active dès que SUPABASE_URL_5 + SUPABASE_KEY_5 sont définis (env VPS, non committé)
console.log(`[Auth] ✅ Supabase : ${_dbNodes.length} base(s) [${_dbNodes.map(n => n.name).join(', ')}] — redondance ${_dbNodes.length > 1 ? 'ACTIVE' : 'inactive (1 seule base)'}`);

const _MULTI_TABLES = new Set(['ai_cache', 'weekly_reports', 'email_log']);   // KV à clé → dual-write + round-robin
const _WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);
// Quota egress MENSUEL Supabase atteint (« exceed_egress_quota » / projet restreint) = panne DURE (ne se
// répare pas en 10 min → seulement au rollover du mois ou upgrade du plan). On marque alors le nœud
// indisponible 2 h au lieu de 10 min → on cesse de le marteler et les lectures filent direct sur les bases
// saines (db2…db5). Une erreur transitoire (réseau/429) garde le cooldown court de 10 min.
function _isEgressCapped(err) {
  const m = ((err && (err.message || '')) + '').toLowerCase();
  return /exceed_egress_quota|egress quota|restricted due to|spend cap|violations/.test(m);
}
function _markDown(node, err) {
  const capped = _isEgressCapped(err);
  const cooldown = capped ? 2 * 60 * 60 * 1000 : 10 * 60 * 1000;
  if (node.downUntil <= Date.now()) console.warn(`[DB] ${node.name} indisponible ${capped ? '2 h (quota egress mensuel — bascule sur bases saines)' : '10 min (egress/réseau)'} :`, err && err.message);
  node.downUntil = Date.now() + cooldown;
  /* ⚠️ QUARANTAINE DE LECTURE — LE DÉFAUT LE PLUS COÛTEUX DE CETTE COUCHE (02/09/2026).
     Une base muette RATE les écritures qui tombent pendant son absence. À son retour, elle est
     réintégrée au pool et `_runMulti` la relit comme n'importe quelle autre : elle répond « non
     vide », donc la boucle S'ARRÊTE SUR ELLE — et `verifyLogin` fait pire encore, il RECOPIE cette
     ligne périmée dans le miroir local (`_mirrorPut`), détruisant la version fraîche.
     MESURÉ, PAS SUPPOSÉ : le projet Supabase principal est resté en pause du 14/06 au 02/09. Sa
     table `users` porte 29 comptes ; le desk en a 50, dont 21 avec une échéance déjà dépassée dans
     l'instantané de juin. Le laisser répondre aux lectures, c'était rendre à 29 clients leur mot de
     passe de juin, leur ancien plan et leur ancienne échéance — et bloquer hors du desk ceux qui
     avaient renouvelé depuis.
     LA RÈGLE : une base marquée muette ne sert plus aucune lecture de `users` tant que la
     convergence (miroir → base) n'a pas RÉUSSI sur elle. Les ÉCRITURES ne sont pas quarantainées :
     c'est par elles que la resynchronisation passe. Et si toutes les bases sont en quarantaine, la
     lecture rend NODESDOWN — cas déjà géré partout, qui bascule sur le miroir, c'est-à-dire sur le
     superset à jour. Le pire cas de cette garde est donc l'état le plus sûr. */
  node.quarLect = true;
}
function _applyOps(client, table, ops) { let qb = client.from(table); for (const [m, a] of ops) qb = qb[m](...a); return qb; }

// ════════════ GARDE-FOU EGRESS (anti-fuite DÉFINITIF — cf. incident des 18 To via le poll chat base64) ════════════
// On mesure approximativement les octets LUS depuis Supabase (= egress facturé/plafonné) sur des fenêtres
// glissantes. En usage normal tout est servi depuis la RAM (caches 5 min / 6 h) → egress quasi nul → jamais
// déclenché. Si un bug futur relit de gros volumes en boucle, le compteur dépasse un plafond TRÈS au-dessus de
// l'usage réel : on COUPE alors les LECTURES Supabase (les écritures passent — c'est de l'ingress) pendant un
// cooldown, et les appelants basculent sur leurs replis habituels (RAM périmée / miroir local / fichier),
// EXACTEMENT comme lors d'une panne. Garantie : aucune fuite ne peut plus jamais vider le quota gratuit
// (5 Go/mois) → plus de blackout possible, quoi qu'il arrive dans le code.
const _EG_CAP_1H  = 120 * 1024 * 1024;   // 120 Mo / heure  (un boot ≈ quelques Mo → impossible à atteindre normalement)
const _EG_CAP_24H = 150 * 1024 * 1024;   // 150 Mo / 24 h    (< 5 Go/mois, ~3× la marge de l'usage réel mesuré)
let _egBuckets = [];                      // [{ m: minuteEpoch, b: bytes }] sur 24 h glissantes
let _egTripUntil = 0, _egTripInfo = '';
function _resBytes(res) { try { return res && res.data != null ? JSON.stringify(res.data).length : 0; } catch { return 0; } }
function _egNote(bytes) {
  bytes = Number(bytes) || 0; if (bytes <= 0) return;
  const m = Math.floor(Date.now() / 60000), last = _egBuckets[_egBuckets.length - 1];
  if (last && last.m === m) last.b += bytes; else _egBuckets.push({ m, b: bytes });
  if (_egBuckets.length > 2000) { const cut = m - 1440; _egBuckets = _egBuckets.filter(x => x.m >= cut); }
}
function _egSum(min) { const from = Math.floor(Date.now() / 60000) - min; let s = 0; for (const x of _egBuckets) if (x.m >= from) s += x.b; return s; }
function _egTripped() {
  const now = Date.now();
  if (now < _egTripUntil) return true;
  const h1 = _egSum(60);
  if (h1 > _EG_CAP_1H)  { _egTripUntil = now + 15 * 60 * 1000; _egTripInfo = '1h≈' + Math.round(h1 / 1048576) + 'Mo'; console.error('[EGRESS] 🛑 garde-fou 1h (' + _egTripInfo + ') → lectures Supabase coupées 15 min (repli RAM/miroir).'); return true; }
  const d1 = _egSum(1440);
  if (d1 > _EG_CAP_24H) { _egTripUntil = now + 60 * 60 * 1000; _egTripInfo = '24h≈' + Math.round(d1 / 1048576) + 'Mo'; console.error('[EGRESS] 🛑 garde-fou 24h (' + _egTripInfo + ') → lectures Supabase coupées 60 min (repli RAM/miroir).'); return true; }
  return false;
}
function getEgressStats() { return { bytes1h: _egSum(60), bytes24h: _egSum(1440), cap1h: _EG_CAP_1H, cap24h: _EG_CAP_24H, tripped: Date.now() < _egTripUntil, trippedUntil: _egTripUntil || 0, info: _egTripInfo }; }
let _rr = 0;
/* Tables dont une ligne PÉRIMÉE cause un dommage visible par le client (cf. la quarantaine de
   lecture dans _markDown). `chat_messages` n'y est pas : un message manquant se rattrape, il ne
   ferme la porte à personne. */
const _TABLES_SENSIBLES = new Set(['users']);
/* ═══ UNE BASE REVENUE PEUT MASQUER LA DONNÉE FRAÎCHE D'UNE AUTRE (03/09/2026) ═══════════════════
   La quarantaine de lecture ci-dessus protège `users`. Elle ne protégeait RIEN d'autre — et deux
   autres tables souffraient du même défaut, par deux chemins différents. MESURÉ sur la base
   principale au lendemain de sa sortie de pause, pas déduit :

     · `chat_messages` : 71 messages, 26 fils, le plus récent daté du 14/06 — le jour même de la
       mise en pause. Cette table n'est pas dual-écrite (ses ids sont AUTO, donc divergents d'une
       base à l'autre) : un message part sur le PREMIER nœud sain. Tant que la principale répondait,
       tout y allait ; après le 14/06, tout est parti sur db2. Les deux bases détiennent donc deux
       MOITIÉS DISJOINTES du même journal, et aucune n'est le superset de l'autre. Or la lecture
       s'arrêtait au premier nœud au résultat NON VIDE : la principale répondait « 26 fils de juin »
       et db2 n'était JAMAIS interrogée. La boîte de réception du support affichait la liste de juin,
       et deux mois et demi de conversations paraissaient effacés. Rien n'était perdu ; tout était
       caché — ce qui, vu du client, ne fait aucune différence.
       → On RÉUNIT les nœuds au lieu d'en élire un (_lireUnion), et l'écriture est DIFFUSÉE.

     · `ai_cache` : `journal:1` — le modèle de journal de bord d'un client — daté du 14/06 sur la
       principale. Cette table-ci EST dual-écrite, donc une clé RÉÉCRITE depuis le retour converge
       d'elle-même. Mais une clé qu'on ne réécrit pas (un modèle qu'on ne modifie plus) reste figée
       à juin sur la base revenue, pendant que db2 porte la version de septembre — et la lecture,
       en tourniquet, rendait tantôt l'une tantôt l'autre. Un même client voyait son modèle changer
       d'une visite à l'autre. `created_at` était pourtant stocké depuis toujours : simplement,
       personne ne le lisait.
       → La ligne la PLUS RÉCENTE gagne (_TABLES_FRAICHEUR), au lieu de la première rencontrée. */
const _TABLES_UNION     = new Set(['chat_messages']);
const _TABLES_FRAICHEUR = new Map([['ai_cache', 'created_at']]);
/* ═══ LECTURE RÉUNIE — RECOLLER DEUX MOITIÉS DISJOINTES DU MÊME JOURNAL ══════════════════════════
   Pourquoi cette fonction existe : cf. le pavé de _TABLES_UNION. En deux mots — `chat_messages`
   n'est pas dual-écrit, chaque message vit sur UNE base, et la base principale revenue de pause
   masquait db2 en répondant « non vide » avec l'historique de juin.

   CE QU'ELLE NE FAIT PAS, ET POURQUOI. Elle ne dédoublonne pas. La tentation était forte, et elle
   aurait cassé le compteur de non-lus : `chatThreads` lit `select('user_id')` sur les messages non
   lus, une ligne PAR MESSAGE, toutes réduites au seul `user_id` — trois messages non lus du même
   client y sont trois lignes IDENTIQUES qu'il faut compter, pas fusionner. Et le doublon n'existe
   pas : aucun chemin n'écrit deux fois le même message (l'insert va sur un seul nœud, la migration
   du backlog aussi). On ne se protège donc pas d'un risque absent au prix d'un compteur faux.

   COÛT. Les lectures de chat sont servies par un cache RAM de 5 min alors que le volet sonde toutes
   les 4 s : on ne paie cette réunion qu'une fois par tranche de 5 min et par clé. C'est le prix de
   ne plus cacher l'historique du support. */
async function _lireUnion(table, ops, healthy) {
  const rep = await Promise.allSettled(healthy.map(n => _applyOps(n.client, table, ops)));
  const lignes = [];
  let vus = 0, errU = null, total = null, octets = 0;
  rep.forEach((s, i) => {
    const node = healthy[i];
    if (s.status !== 'fulfilled') { _markDown(node, s.reason); errU = errU || s.reason; return; }
    const res = s.value;
    if (res && res.error) {
      if (_supaDown(res.error)) { if (!_isSchemaErr(res.error)) _markDown(node, res.error); }
      errU = errU || res.error; return;
    }
    vus++;
    octets += _resBytes(res);
    // `{ count: 'exact', head: true }` : la base ne rend AUCUNE ligne, seulement un nombre. On le
    // SOMME — concaténer n'aurait aucun sens, et rendre celui d'un seul nœud sous-compterait
    // exactement de la moitié qu'on cherche à faire réapparaître.
    if (res && typeof res.count === 'number') total = (total || 0) + res.count;
    if (res && Array.isArray(res.data)) lignes.push(...res.data);
    else if (res && res.data) lignes.push(res.data);
  });
  // AUCUN nœud n'a répondu → erreur. Un seul suffit : on rend ce qu'on a, jamais une panne.
  if (!vus) return { data: null, error: errU || { message: 'read failed on all nodes' } };
  _egNote(octets);
  if (total != null && !lignes.length) return { data: null, count: total, error: null };
  // L'ordre et la limite ont été appliqués par CHAQUE base sur SA moitié : il faut les rejouer sur
  // la réunion, sinon 400 messages par nœud rendraient 800 lignes dans un ordre entrelacé.
  const oOrd = ops.find(([m]) => m === 'order');
  if (oOrd) {
    const col = oOrd[1][0], asc = !(oOrd[1][1] && oOrd[1][1].ascending === false);
    lignes.sort((a, b) => {
      const x = a && a[col], y = b && b[col];
      if (x === y) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : 1) * (asc ? 1 : -1);
    });
  }
  const oLim = ops.find(([m]) => m === 'limit');
  const out = oLim ? lignes.slice(0, oLim[1][0]) : lignes;
  return total != null ? { data: out, count: total, error: null } : { data: out, error: null };
}

/* ═══ LA LIGNE LA PLUS RÉCENTE GAGNE ═════════════════════════════════════════════════════════════
   Pour `ai_cache` (cf. _TABLES_FRAICHEUR). Le tourniquet rendait la première base au résultat non
   vide : une clé jamais réécrite depuis le retour d'une base restait figée à sa valeur d'alors, et
   le desk rendait tantôt la version de juin, tantôt celle de septembre, selon le tour. `created_at`
   était stocké depuis le début — il n'était simplement jamais relu.
   REPLI EXPLICITE : une requête qui ne SÉLECTIONNE pas la colonne de date (la sonde `select('key')`)
   ne peut pas être arbitrée ; on retombe alors sur la première réponse non vide, à l'identique. */
async function _lireFraicheur(table, ops, healthy, col) {
  const rep = await Promise.allSettled(healthy.map(n => _applyOps(n.client, table, ops)));
  let vus = 0, errF = null, octets = 0, meilleur = null, cle = null, vide = null;
  rep.forEach((s, i) => {
    const node = healthy[i];
    if (s.status !== 'fulfilled') { _markDown(node, s.reason); errF = errF || s.reason; return; }
    const res = s.value;
    if (res && res.error) {
      if (_supaDown(res.error)) { if (!_isSchemaErr(res.error)) _markDown(node, res.error); }
      errF = errF || res.error; return;
    }
    vus++;
    octets += _resBytes(res);
    const d = res && res.data;
    const rows = Array.isArray(d) ? d : (d ? [d] : []);
    if (!rows.length) { vide = vide || res; return; }
    const t = rows[0] && rows[0][col];
    if (t == null) { if (!meilleur && cle == null) { meilleur = res; } return; }   // pas de date lisible → premier non vide
    if (cle == null || String(t) > String(cle)) { cle = t; meilleur = res; }
  });
  if (!vus) return { data: null, error: errF || { message: 'read failed on all nodes' } };
  _egNote(octets);
  return meilleur || vide || { data: null, error: errF || { message: 'read failed on all nodes' } };
}

async function _runMulti(table, ops, kind) {
  const now = Date.now();
  // GARDE-FOU EGRESS : en LECTURE, si le plafond glissant est dépassé, on renvoie « toutes bases muettes »
  // (code NODESDOWN, déjà géré partout) → les appelants basculent sur RAM/miroir/fichier. Écritures épargnées.
  if (kind !== 'write' && _egTripped()) return { data: null, error: { message: 'egress guard (anti-fuite) actif', code: 'NODESDOWN' } };
  let healthy = _dbNodes.filter(n => n.downUntil <= now);
  if (!healthy.length) return { data: null, error: { message: 'all DB nodes down', code: 'NODESDOWN' } };
  /* QUARANTAINE DE LECTURE (cf. _markDown) : sur les tables où une ligne périmée FAIT DU MAL, on
     écarte les bases revenues tant que la convergence ne les a pas resynchronisées. Restreint à
     `users` À DESSEIN — c'est là qu'une valeur de la semaine dernière refuse une connexion, rend un
     ancien plan ou une échéance dépassée. Un `ai_cache` périmé se recalcule, un `weekly_reports`
     ancien porte une semaine close, un `email_log` en retard fait au pire taire un envoi : aucune
     de ces trois lectures ne mérite qu'on se prive d'une base. */
  if (kind !== 'write' && _TABLES_SENSIBLES.has(table)) {
    const frais = healthy.filter(n => !n.quarLect);
    if (frais.length) healthy = frais;
    else return { data: null, error: { message: 'toutes les bases sont en quarantaine de lecture (resynchronisation en cours)', code: 'NODESDOWN' } };
  }
  if (!_MULTI_TABLES.has(table)) {
    // users / chat_messages : ids AUTO → pas de dual-write (ids divergents entre bases). On bascule sur le
    // PREMIER nœud SAIN (primary si dispo, sinon db2/db3/db4) : quand la primaire est bloquée (egress), les
    // NOUVEAUX comptes/chat vont sur un secondaire sain. LECTURE = premier nœud sain au résultat NON vide.
    // L'appelant (verifyLogin/getUserById/getAllUsers) COMPLÈTE avec le MIROIR local (comptes existants
    // restés sur la primaire bloquée → les secondaires ne les ont pas).
    if (kind === 'write') {
      /* ÉCRITURE DIFFUSÉE sur les tables RÉUNIES (cf. _TABLES_UNION et _lireUnion). Dès lors que la
         LECTURE réunit les nœuds, l'écriture doit les atteindre TOUS, sinon elle ne corrige qu'une
         moitié de ce que l'on vient de rendre visible :
           · `chatMarkRead` porte sur (user_id + sender), pas sur un id → marquer « lu » sur le seul
             premier nœud sain laisserait l'autre moitié éternellement non lue, et le badge de
             non-lus ne retomberait JAMAIS à zéro maintenant qu'on la compte ;
           · `chatDeleteByUser` (suppression d'un compte) laissait purement et simplement les
             messages du compte supprimé sur les autres bases ;
           · `chatDelete`/`chatEdit` visent un id AUTO, propre à une base : sur celles qui ne
             détiennent pas la ligne, la clause ne matche RIEN — l'ordre y est donc inoffensif, et
             c'est ce qui rend la diffusion sûre.
         L'INSERT, lui, reste sur UN SEUL nœud : le diffuser créerait quatre exemplaires du message. */
      if (_TABLES_UNION.has(table) && !ops.some(([m]) => m === 'insert')) {
        const diff = await Promise.allSettled(healthy.map(n => _applyOps(n.client, table, ops)));
        let okW = null, errW = null;
        diff.forEach((s, i) => {
          const node = healthy[i];
          if (s.status !== 'fulfilled') { _markDown(node, s.reason); errW = errW || s.reason; return; }
          const r = s.value;
          // `.single()` sur un nœud qui ne détient pas la ligne rend « aucune ligne » : ce n'est pas
          // une panne, c'est la réponse normale d'une base qui n'a pas ce message. Ne PAS la pénaliser.
          if (r && r.error) { if (_supaDown(r.error) && !_isSchemaErr(r.error)) _markDown(node, r.error); errW = errW || r.error; return; }
          if (!okW) okW = r;
        });
        return okW || { data: null, error: errW || { message: 'write failed on all nodes' } };
      }
      let werr = null;
      for (const node of healthy) {
        try { const res = await _applyOps(node.client, table, ops); if (res && res.error) { if (_supaDown(res.error)) { if (!_isSchemaErr(res.error)) _markDown(node, res.error); werr = res.error; continue; } return res; } return res; }
        catch (e) { _markDown(node, e); werr = e; continue; }
      }
      return { data: null, error: werr || { message: 'write failed on all nodes' } };
    }
    if (_TABLES_UNION.has(table)) return _lireUnion(table, ops, healthy);
    let emptyS = null, errS = null;
    for (const node of healthy) {
      try {
        const res = await _applyOps(node.client, table, ops);
        if (res && res.error) { if (_supaDown(res.error)) { if (!_isSchemaErr(res.error)) _markDown(node, res.error); errS = res.error; continue; } return res; }
        const empty = !res || res.data == null || (Array.isArray(res.data) && res.data.length === 0);
        if (empty) { emptyS = res; continue; }
        _egNote(_resBytes(res)); return res;
      } catch (e) { _markDown(node, e); errS = e; continue; }
    }
    return emptyS || { data: null, error: errS || { message: 'read failed on all nodes' } };
  }
  if (kind === 'write') {
    const settled = await Promise.allSettled(healthy.map(n => _applyOps(n.client, table, ops)));
    let ok = null, err = null;
    settled.forEach((s, i) => {
      const node = healthy[i];
      if (s.status === 'fulfilled') { if (s.value && s.value.error) { if (_supaDown(s.value.error)) _markDown(node, s.value.error); err = err || s.value.error; } else if (!ok) ok = s.value; }
      else { _markDown(node, s.reason); err = err || s.reason; }
    });
    return ok || { data: null, error: err || { message: 'write failed on all nodes' } };
  }
  // LECTURE : round-robin sur les bases saines ; repli sur la suivante si l'une est DOWN, ET aussi si elle
  // renvoie un résultat VIDE — une base qui a manqué une écriture pendant son cooldown pourrait être périmée,
  // donc on ne conclut « vide » qu'après avoir interrogé TOUTES les bases saines. Évite : faux « non loggé »
  // (email_log → mail en double), recap fraîchement sauvé absent (weekly_reports), null masquant (ai_cache).
  /* LA FRAÎCHEUR PRIME SUR LE TOUR DE RÔLE (cf. _TABLES_FRAICHEUR) : sur un KV à clé, la bonne
     réponse n'est pas « la première base qui répond quelque chose », c'est « la dernière valeur
     écrite ». Le tourniquet, lui, rendait l'une ou l'autre selon le tour. */
  const colFr = _TABLES_FRAICHEUR.get(table);
  if (colFr && healthy.length > 1) return _lireFraicheur(table, ops, healthy, colFr);
  let order = healthy;
  if (healthy.length > 1) { const i = (_rr++) % healthy.length; order = healthy.slice(i).concat(healthy.slice(0, i)); }
  let lastEmpty = null, lastErr = null;
  for (const node of order) {
    try {
      const res = await _applyOps(node.client, table, ops);
      if (res && res.error) { if (_supaDown(res.error)) { if (!_isSchemaErr(res.error)) _markDown(node, res.error); lastErr = res.error; continue; } return res; }   // erreur autoritaire → on renvoie ; down → base suivante ; mismatch schéma → suivant sans pénaliser le nœud
      const empty = !res || res.data == null || (Array.isArray(res.data) && res.data.length === 0);
      if (empty) { lastEmpty = res; continue; }   // base potentiellement périmée → on tente les autres pour un résultat non vide
      _egNote(_resBytes(res)); return res;         // résultat NON vide → on renvoie (+ mesure egress)
    } catch (e) { _markDown(node, e); lastErr = e; continue; }
  }
  return lastEmpty || { data: null, error: lastErr || { message: 'read failed on all nodes' } };   // toutes vides → vide ; toutes down → erreur
}
// Façade compatible Supabase : supabase.from(table)…  (proxy enregistre la chaîne, _runMulti la rejoue sur les bases)
function _multiFrom(table) {
  const ops = []; let kind = null, _exec = null;
  const run = () => (_exec = _exec || _runMulti(table, ops, kind));   // exécute UNE seule fois même si la chaîne est await plusieurs fois (idempotence façon PostgrestBuilder)
  const make = () => new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then')    return (res, rej) => run().then(res, rej);
      if (prop === 'catch')   return (rej) => run().catch(rej);
      if (prop === 'finally') return (cb) => run().finally(cb);
      return (...args) => { if (kind === null) kind = _WRITE_OPS.has(prop) ? 'write' : 'read'; ops.push([prop, args]); return make(); };
    },
  });
  return make();
}
const supabase = { from: _multiFrom };

console.log('[Auth] ✅ Supabase connecté →', SUPABASE_URL);

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  MIROIR LOCAL DES COMPTES — repli si Supabase est indisponible (quota egress dépassé, panne réseau)
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Supabase free-tier DROPPE TOUTES les requêtes quand l'egress dépasse le quota (« Services restricted »)
// → sans repli, verifyLogin/getUserById échouent et PLUS PERSONNE ne peut se connecter (l'auth = lecture
// de la table users dans Supabase). On maintient donc un miroir local des comptes (password_hash inclus) :
//   • rafraîchi automatiquement à CHAQUE lecture Supabase réussie (login, /me, liste admin) ;
//   • utilisé en repli quand Supabase ne répond pas (login, session, reset, jobs de fond) ;
//   • stocké dans DATA_DIR (volume Docker ./data/app → survit aux rebuilds, le disque conteneur est éphémère) ;
//   • les écritures faites HORS-LIGNE (changement de MDP, maj abonnement) sont rejouées vers Supabase à son retour.
const _DATA_DIR = process.env.DATA_DIR || __dirname;
try { if (_DATA_DIR !== __dirname) fs.mkdirSync(_DATA_DIR, { recursive: true }); } catch {}
const USERS_MIRROR_FILE  = path.join(_DATA_DIR, 'users_mirror.json');
const USERS_PENDING_FILE = path.join(_DATA_DIR, 'users_pending.json');
const _usersMirror     = new Map();   // email(minuscule) -> ligne complète (avec password_hash)
const _usersMirrorById = new Map();   // id(string)       -> même ligne (référence partagée)
function _mirrorIndex(row) {
  if (!row || !row.email) return;
  _usersMirror.set(String(row.email).toLowerCase().trim(), row);
  if (row.id != null) _usersMirrorById.set(String(row.id), row);
}
function _mirrorSaveFile() {
  try { fs.writeFileSync(USERS_MIRROR_FILE, JSON.stringify([..._usersMirror.values()])); }
  catch (e) { console.warn('[Auth] miroir : sauvegarde échouée —', e.message); }
}
function _mirrorGet(email)  { return _usersMirror.get(String(email || '').toLowerCase().trim()) || null; }
function _mirrorGetById(id) { return _usersMirrorById.get(String(id)) || null; }
// CLÉ d'écriture Supabase pour un compte. L'id LOCAL hérité peut être un ENTIER ("6","29"…) qui n'est
// PAS un uuid → `.eq('id','6')` échoue « invalid input syntax for type uuid » et n'atteint jamais la base.
// L'EMAIL est la clé métier UNIQUE et stable (contrainte users_email_key), et c'est aussi celle que lit
// verifyLogin → on écrit par email pour les comptes à id non-uuid (sinon on garde l'id uuid, inchangé).
const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function _supaWhere(id, emailHint) {
  const sid = String(id == null ? '' : id);
  if (_UUID_RE.test(sid)) return { col: 'id', val: sid };                 // id uuid normal → inchangé
  const email = (emailHint || _mirrorGetById(id)?.email || '').toLowerCase().trim();
  return email ? { col: 'email', val: email } : { col: 'id', val: sid };  // id hérité → clé EMAIL (sinon dernier recours)
}
// Vue « publique » d'une ligne (sans le hash) — pour les chemins qui renvoient l'objet au front.
function _pubUser(r) { if (!r) return null; const { password_hash, ...rest } = r; return rest; }
// Rafraîchit une entrée depuis une lecture Supabase réussie. Fusionne pour ne JAMAIS perdre le
// password_hash quand la lecture est une projection sans hash (getUserById / getAllUsers).
/* ⚠️ UNE LECTURE NE RÉVOQUE JAMAIS UN ACCÈS — ELLE PEUT SEULEMENT L'ÉTENDRE (03/09/2026).
   CE QUI EST ARRIVÉ, reconstitué et non supposé. Le 30/08, un abonnement réglé par virement a été
   prolongé À LA MAIN au 30/09 depuis le panneau admin. La base principale était alors EN PAUSE :
   cette écriture est donc partie sur db2 et sur le miroir, correctement. Le 02/09 la principale est
   revenue, avec sa table `users` figée au 14/06. Le panneau admin a été ouvert ce jour-là :
   `getAllUsers` a lu la PREMIÈRE base saine — la principale, revenue et périmée — et a passé ses
   29 lignes de juin à `_mirrorPutMany`. Or la fusion était `{ ...prev, ...row }` : les champs de la
   LECTURE écrasent ceux du miroir. Le 30/09 a donc été remplacé par le 11/06. Puis `_usersConverge`
   a propagé ce miroir corrompu vers les quatre bases. Le client s'est vu refuser la connexion avec
   « Abonnement expiré », trois semaines après avoir payé.
   La quarantaine de lecture (cf. _markDown) ferme ce chemin depuis le 02/09 au soir — mais elle est
   arrivée quelques heures TROP TARD, et elle ne couvre pas tous les cas : un compte que le miroir
   connaît sans son `password_hash` n'est jamais propagé par la convergence (elle ne prend que les
   comptes complets), alors que la quarantaine du nœud, elle, se lève. Sa ligne périmée survit donc
   sur la base, et la prochaine lecture la repousserait dans le miroir.
   LA RÈGLE, indépendante de tout cela : `_mirrorPut` est le chemin des LECTURES. Les écritures
   (updateUser, setPassword, createUser) touchent le miroir directement, sans passer par ici. Une
   lecture qui RACCOURCIT un abonnement ou qui DÉSACTIVE un compte est donc, par construction, une
   lecture périmée : seule une action d'administration peut légitimement révoquer un accès, et elle
   n'emprunte pas ce chemin. On laisse passer ce qui étend, on refuse ce qui retire.
   Portée VOLONTAIREMENT limitée aux deux champs qui décident de l'ACCÈS. `plan` et `role` changent
   ce qu'on voit, pas si l'on entre : les figer ici empêcherait le miroir d'apprendre une correction
   faite ailleurs, sans rien protéger de comparable. */
function _mirrorPut(row) {
  if (!row || !row.email) return;
  const em = String(row.email).toLowerCase().trim();
  const prev = _usersMirror.get(em);
  if (prev) {
    row = (!row.password_hash && prev.password_hash) ? { ...prev, ...row, password_hash: prev.password_hash } : { ...prev, ...row };
    // Un miroir SANS échéance apprend celle de la base ; un miroir qui en a une ne la voit jamais reculer.
    const av = prev.expires_at ? Date.parse(prev.expires_at) : NaN;
    const ap = row.expires_at  ? Date.parse(row.expires_at)  : NaN;
    if (!Number.isNaN(av) && (Number.isNaN(ap) || ap < av)) {
      console.warn(`[Auth] lecture périmée ignorée pour ${em} : échéance ${row.expires_at || 'absente'} < ${prev.expires_at} au miroir (une base en retard ne révoque pas un abonnement).`);
      row.expires_at = prev.expires_at;
    }
    if (prev.active !== false && row.active === false) {
      console.warn(`[Auth] lecture périmée ignorée pour ${em} : compte désactivé par une base alors que le miroir le dit actif.`);
      row.active = prev.active;
    }
  }
  _mirrorIndex(row);
}
function _mirrorPutMany(rows) {   // bulk (liste admin) → une seule écriture fichier
  let changed = false;
  for (const r of (rows || [])) { if (r && r.email) { _mirrorPut(r); changed = true; } }
  if (changed) _mirrorSaveFile();
}
// « 0 ligne » (l'email n'existe vraiment pas, Supabase répond) vs toute autre erreur = Supabase muet → repli.
function _isNoRows(err) { return !!err && (err.code === 'PGRST116' || /0 rows|contain 0|no rows/i.test(err.message || '')); }
function _supaDown(err) { return !!err && !_isNoRows(err); }
// Erreur de SCHÉMA propre à un nœud (ex. secondaire dont users.id est en uuid alors que la requête passe un id
// texte/entier comme « 1 ») : le nœud n'est PAS en panne — il sert parfaitement ai_cache/weekly. On saute juste
// CE nœud pour CETTE requête, SANS le marquer indisponible 10 min (sinon on priverait le round-robin d'un
// secondaire sain → surcharge de la primaire). Le repli miroir (verifyLogin/getUserById) reste, lui, déclenché.
function _isSchemaErr(err) {
  const m = ((err && (err.message || '')) + ' ' + ((err && err.code) || '')).toLowerCase();
  return /invalid input syntax|type uuid|does not exist|undefined column|schema cache|cannot cast|out of range|22p02|42703|42p01/.test(m);
}
// Chargement initial du miroir (synchrone, au boot)
try {
  const _arr = JSON.parse(fs.readFileSync(USERS_MIRROR_FILE, 'utf8'));
  if (Array.isArray(_arr)) { _arr.forEach(_mirrorIndex); console.log(`[Auth] miroir local : ${_arr.length} compte(s) chargé(s) (repli si Supabase bloqué)`); }
} catch {}
/* ⚠️ QUARANTAINE AU DÉMARRAGE — LE TROU QUE LA QUARANTAINE SEULE NE BOUCHAIT PAS (02/09).
   `_markDown` ne peut quarantainer qu'un incident vu par CE processus. Or un déploiement redémarre
   le conteneur : une base restée en retard pendant des semaines repart alors « saine », sans avoir
   jamais été marquée muette ici — et elle est de nouveau la première interrogée. Le scénario n'a
   rien de théorique, c'est EXACTEMENT celui du 02/09 : le projet principal a été sorti de pause à la
   main, il répondait donc parfaitement, avec 29 comptes là où le desk en a 50.
   Aucun processus qui vient de naître ne peut savoir ce qu'une base a manqué pendant qu'il n'existait
   pas. On part donc du principe qu'elle a manqué quelque chose : toutes les bases démarrent
   quarantainées, et la première convergence (boot + 30 s) les libère l'une après l'autre.
   ⚠️ SAUF SI LE MIROIR EST VIDE, et cette exception n'est pas un détail : sur une installation
   NEUVE il n'y a rien à propager, `_usersConverge` sort immédiatement, la quarantaine ne serait donc
   jamais levée — et comme le repli est ce miroir vide, PLUS PERSONNE ne pourrait se connecter. Sans
   miroir, la base est la seule source de vérité : la quarantaine n'a aucun sens et ne se pose pas. */
if (_usersMirror.size) {
  _dbNodes.forEach(n => { n.quarLect = true; });
  console.log(`[Auth] démarrage : ${_dbNodes.length} base(s) en quarantaine de lecture jusqu'à la première convergence (le miroir, à jour, sert les comptes d'ici là)`);
}

/* ⚠️ DIFFÉRÉE D'UN TOUR DE BOUCLE — ET J'AI FAIT ICI, LE MÊME JOUR, LA FAUTE QUE JE VENAIS DE
   CORRIGER DIX LIGNES PLUS BAS. Premier jet : appel immédiat, avec le commentaire « elle est définie
   plus bas ; les déclarations de fonction se hissent, l'appel est donc valide ». La FONCTION se
   hisse, oui. Mais elle lit `_ECHEANCES_SEED`, qui est un `const` déclaré APRÈS — et les `const` ne
   se hissent pas. Résultat mesuré en chargeant le module avec un miroir non vide :
   « Cannot access '_ECHEANCES_SEED' before initialization ». Le try/catch l'écrivait en une ligne,
   l'application démarrait, et l'échéance n'était JAMAIS corrigée. Constaté sur la base : le compte
   est resté au 11/06 alors que le code était bien en ligne.
   Le raisonnement « la fonction se hisse donc l'appel est valide » est un piège précis : il est
   vrai de l'appel et faux de ce que la fonction LIT. `setTimeout(0)` place l'appel après
   l'évaluation complète du module, comme les deux reprises voisines. */
setTimeout(() => {
  if (!_usersMirror.size) return;
  try { _reparerEcheances(); } catch (e) { console.warn('[Auth] correction d\'échéance :', e && e.message); }
}, 0);

// ─── Pierres tombales : ids de comptes SUPPRIMÉS. Garantit qu'un compte effacé ne RÉAPPARAÎT jamais (ni dans la
//     liste, ni au login), même si la primaire — en blackout au moment du delete — le renvoie à son retour (le
//     delete non-multi a pu ne toucher qu'un secondaire). uuid uniques → un futur compte n'est jamais filtré à tort.
const USERS_DELETED_FILE = path.join(_DATA_DIR, 'users_deleted.json');
const _deletedIds = new Set();
try { const _d = JSON.parse(fs.readFileSync(USERS_DELETED_FILE, 'utf8')); if (Array.isArray(_d)) _d.forEach(x => _deletedIds.add(String(x))); } catch {}
function _isTombstoned(id) { return id != null && _deletedIds.has(String(id)); }
function _tombstone(id) {
  if (id == null) return;
  _deletedIds.add(String(id));
  try { fs.writeFileSync(USERS_DELETED_FILE, JSON.stringify([..._deletedIds])); } catch {}
  // Même raison que la liste noire : un compte supprimé qui « revient » est un défaut visible du client.
  try { if (typeof aiCacheSet === 'function') aiCacheSet(_KV_TOMBES, [..._deletedIds]); } catch {}
}

// ─── Liste noire : e-mails BANNIS « partout » (login refusé + création refusée + réactivation Whop ignorée).
//     Persiste en fichier (comme les pierres tombales) MAIS surtout SEEDÉE en dur → le blocage survit à un
//     rebuild Docker même si le disque du conteneur est éphémère. Insensible à la casse et aux espaces.
const USERS_BLACKLIST_FILE = path.join(_DATA_DIR, 'users_blacklist.json');
const _blacklist = new Set();
let _blacklistLoaded = false;
try { const _b = JSON.parse(fs.readFileSync(USERS_BLACKLIST_FILE, 'utf8')); if (Array.isArray(_b)) { _b.forEach(x => _blacklist.add(String(x).toLowerCase().trim())); _blacklistLoaded = true; } } catch {}
function _blacklistSave() {
  try { fs.writeFileSync(USERS_BLACKLIST_FILE, JSON.stringify([..._blacklist])); } catch {}
  // DURABLE : un fichier vit sur un disque, `ai_cache` vit sur quatre bases ET dans l'archive nocturne.
  try { if (typeof aiCacheSet === 'function') aiCacheSet(_KV_BLACKLIST, [..._blacklist]); } catch {}
}
function isEmailBlacklisted(email) { return !!email && _blacklist.has(String(email).toLowerCase().trim()); }
function blacklistEmail(email) { const em = String(email || '').toLowerCase().trim(); if (!em) return false; if (!_blacklist.has(em)) { _blacklist.add(em); _blacklistSave(); } return true; }
function unblacklistEmail(email) { const em = String(email || '').toLowerCase().trim(); const had = _blacklist.delete(em); if (had) _blacklistSave(); return had; }
function listBlacklist() { return [..._blacklist].sort(); }
// Seed en dur : garantit le blocage au TOUT PREMIER boot (fichier absent). Une fois le fichier créé, on
// RESPECTE son contenu → un retrait via l'admin PERSISTE (le seed ne réinjecte pas au boot suivant).
const _BLACKLIST_SEED = ['pmttraderoff@gmail.com', 'ghais.bouguerra2101@gmail.com'];
if (!_blacklistLoaded) { _BLACKLIST_SEED.forEach(e => { const em = String(e).toLowerCase().trim(); if (em) _blacklist.add(em); }); _blacklistSave(); }

/* ═══ CORRECTIONS D'ÉCHÉANCE — RÉPARER CE QU'UNE LECTURE PÉRIMÉE A EFFACÉ (03/09/2026) ══════════
   POURQUOI CECI EXISTE. Le 30/08, un abonnement réglé par virement a été prolongé à la main au
   30/09 depuis le panneau. La base principale était en pause : l'écriture est partie sur db2 et sur
   le miroir, correctement. Le 02/09 elle est revenue figée au 14/06, une lecture de la liste admin
   a repoussé ses lignes de juin dans le miroir, et la convergence a diffusé ce miroir corrompu vers
   les quatre bases. La prolongation payée a donc été effacée PARTOUT : aucune base, aucune archive
   (la première date du 03/09, postérieure) ne porte plus la bonne date. Elle n'existe plus que dans
   les relevés bancaires de l'exploitant.
   POURQUOI PAS UNE CORRECTION EN SQL. Parce qu'elle ne tiendrait pas : `_usersConverge` repousse le
   MIROIR vers les bases, donc une date écrite à la main directement en base serait écrasée au
   passage suivant. La réparation doit donc passer par le miroir, c'est-à-dire par ici.
   LA RÈGLE QUI REND CECI SÛR : ON N'ALLONGE, JAMAIS ON NE RACCOURCIT. Une entrée ne s'applique que
   si l'échéance connue est ANTÉRIEURE à la date visée. Conséquences, toutes voulues :
     · c'est IDEMPOTENT — le second démarrage ne fait rien, le centième non plus ;
     · si l'exploitant reprolonge ensuite au-delà depuis le panneau, cette table ne le contredit
       JAMAIS : elle se tait, parce que la date en place est déjà meilleure ;
     · et elle ne peut pas révoquer un accès, ce qui est exactement le défaut qu'elle répare.
   ⚠️ CE N'EST PAS UN MÉCANISME PERMANENT DE GESTION D'ABONNEMENTS. Le panneau admin reste le seul
   endroit où l'on gère un abonnement. Cette table répare un incident nommé, daté, et se vide quand
   la réparation est constatée. */
const _ECHEANCES_SEED = [
  { email: 'anismessaoud05@gmail.com', jusquA: '2026-09-30T23:59:59.000Z', motif: 'virement du 30/08 ; prolongation au 30/09 effacée le 02/09 par une lecture périmée' },
];
function _reparerEcheances() {
  let faites = 0;
  for (const e of _ECHEANCES_SEED) {
    const em = String(e && e.email || '').toLowerCase().trim();
    const cible = e && Date.parse(e.jusquA);
    if (!em || !Number.isFinite(cible)) continue;
    const row = _usersMirror.get(em);
    if (!row) { console.warn(`[Auth] correction d'échéance : ${em} absent du miroir — rien fait (le compte sera corrigé au prochain démarrage s'il revient).`); continue; }
    const actuelle = row.expires_at ? Date.parse(row.expires_at) : NaN;
    if (Number.isFinite(actuelle) && actuelle >= cible) continue;   // déjà au moins aussi loin → on se tait
    const iso = new Date(cible).toISOString();
    /* ⚠️ ON PASSE PAR `updateUser`, PAS PAR UNE ÉCRITURE DIRECTE DANS LE MIROIR (corrigé le 03/09,
       après avoir constaté que la base n'avait pas bougé alors que le code tournait).
       Premier jet : on posait la date sur l'objet du miroir et on laissait la convergence la porter
       aux quatre bases. Elle ne l'a jamais portée — parce que `_usersConverge` ne propage QUE les
       comptes dont le miroir connaît l'EMPREINTE (`all` filtre sur `password_hash`), et l'empreinte
       n'entre au miroir que si elle y a transité : par une connexion, jamais par la liste admin, qui
       est une projection sans hash. Un compte qui ne s'est pas connecté depuis la constitution du
       miroir n'a donc pas d'empreinte — et c'est EXACTEMENT le cas d'un abonné expiré, qui ne peut
       plus se connecter. La réparation ne pouvait donc pas atteindre ceux qu'elle vise.
       `updateUser` est le chemin que le panneau admin emprunte lui-même : il écrit en base, confirme
       que la ligne a bougé, reflète au miroir, met en file de rejeu si la base est muette, et
       déclenche la convergence. Aucune de ces cinq choses n'était acquise avant. */
    faites++;
    console.log(`[Auth] correction d'échéance : ${em} → ${iso} (${e.motif})…`);
    updateUser(row.id, { expiresAt: iso })
      .then(() => console.log(`[Auth] correction d'échéance APPLIQUÉE : ${em} → ${iso}`))
      .catch(err => console.warn(`[Auth] correction d'échéance ÉCHOUÉE pour ${em} :`, err && err.message));
  }
  return faites;
}

/* ═══ LA LISTE NOIRE ET LES PIERRES TOMBALES VIVAIENT DANS UN FICHIER, ET NULLE PART AILLEURS ═════
   MESURÉ le 03/09, en cherchant pourquoi des comptes écartés étaient revenus. De TOUS les magasins
   de ce fichier, ces deux-là étaient les seuls à n'avoir AUCUNE contrepartie en base : `users` a son
   miroir et sa convergence vers quatre bases, `ai_cache`/`weekly_reports`/`email_log` sont
   dual-écrits, `chat_messages` est réuni à la lecture. La liste noire, elle, tenait dans
   `data/app/users_blacklist.json` — un seul fichier, sur un seul disque. Le volume perdu ou remis à
   zéro, il ne restait que les DEUX adresses du seed en dur, et tout ce qui avait été ajouté depuis
   le panneau disparaissait : des comptes bannis pouvaient se recréer, des comptes supprimés
   revenir. Rien ne le signalait, puisque le fichier repartait valide — simplement vide.
   LA RÉPARATION UTILISE CE QUI EXISTE DÉJÀ : `ai_cache` est dual-écrit sur les quatre bases et
   relu à la fraîcheur. Y déposer ces deux ensembles, c'est en avoir QUATRE copies au lieu d'une,
   sans nouvelle infrastructure — et depuis le 03/09 la sauvegarde nocturne exporte `ai_cache`,
   donc ils entrent aussi dans l'archive chiffrée. C'est exactement le motif déjà employé pour les
   réactions du chat, qui avaient le même défaut et l'ont résolu ainsi.
   ⚠️ EN CAS DE DÉSACCORD ENTRE LE FICHIER ET LA BASE, ON UNIT — donc on GARDE le bannissement.
   Ce choix n'est pas neutre et il est assumé : une levée de bannissement faite hors ligne pourrait
   être annulée par une base qui porte encore l'ancien état. Le coût de cette erreur est UN message
   de support ; le coût de l'erreur inverse — un banni qui revient parce qu'un disque a été remis à
   zéro — est la raison même pour laquelle cette liste existe. On penche du côté qui protège.
   ⚠️ LE SEED, LUI, NE SE RÉINJECTE TOUJOURS PAS quand le fichier existe : c'est une décision
   antérieure, écrite juste au-dessus (un retrait via l'admin doit PERSISTER). L'union ci-dessous
   porte sur la base, pas sur le seed — les deux règles ne se contredisent pas. */
const _KV_BLACKLIST = 'auth:blacklist';
const _KV_TOMBES    = 'auth:tombstones';
const _KV_AN = 366 * 86400000;
function _durableSave() {
  try { aiCacheSet(_KV_BLACKLIST, [..._blacklist]); } catch {}
  try { aiCacheSet(_KV_TOMBES, [..._deletedIds]); } catch {}
}
/* ⚠️ DIFFÉRÉ D'UN TOUR DE BOUCLE, ET CE N'EST PAS UN DÉTAIL DE STYLE (03/09/2026).
   Écrite en exécution immédiate, cette reprise partait PENDANT l'évaluation du module — donc avant
   la ligne `const _aiMem = new Map()`, quelque douze cents lignes plus bas. `aiCacheGet` la touche,
   et un `const` pas encore initialisé lève « Cannot access '_aiMem' before initialization ». Les
   déclarations de FONCTION se hissent, les `const` NON : `aiCacheGet` était donc appelable, et
   inutilisable. Mon try/catch avalait l'erreur en une ligne de journal, l'application démarrait
   normalement, et la durabilité que ce bloc est censé apporter ne s'installait JAMAIS.
   C'est exactement le défaut que ce même commit répare ailleurs : un mécanisme qui a l'air posé et
   qui ne fait rien. Trouvé en CHARGEANT le module pour de vrai, pas en le relisant.
   `setTimeout(0)` suffit : le module est alors entièrement évalué. */
setTimeout(() => {
(async () => {
  try {
    const b = await aiCacheGet(_KV_BLACKLIST, _KV_AN);
    if (Array.isArray(b) && b.length) {
      let neufs = 0;
      b.forEach(x => { const em = String(x || '').toLowerCase().trim(); if (em && !_blacklist.has(em)) { _blacklist.add(em); neufs++; } });
      if (neufs) { _blacklistSave(); console.log(`[Auth] liste noire : ${neufs} adresse(s) récupérée(s) depuis la base (le fichier local était en retard).`); }
    }
    const t = await aiCacheGet(_KV_TOMBES, _KV_AN);
    if (Array.isArray(t) && t.length) {
      let neufs = 0;
      t.forEach(x => { const id = String(x || ''); if (id && !_deletedIds.has(id)) { _deletedIds.add(id); neufs++; } });
      if (neufs) { try { fs.writeFileSync(USERS_DELETED_FILE, JSON.stringify([..._deletedIds])); } catch {} console.log(`[Auth] pierres tombales : ${neufs} compte(s) supprimé(s) récupéré(s) depuis la base.`); }
    }
    // On repose l'état fusionné : la base rattrape ce que le fichier avait en plus, et inversement.
    _durableSave();
  } catch (e) { console.warn('[Auth] reprise liste noire / pierres tombales :', e && e.message); }
})();
}, 0);

// ─── File d'attente des écritures hors-ligne (rejouées vers Supabase dès son retour) ───
let _pendingWrites = [];   // [{ id, fields, ts, attempts }]
try { _pendingWrites = JSON.parse(fs.readFileSync(USERS_PENDING_FILE, 'utf8')) || []; } catch {}
function _pendingSave() { try { fs.writeFileSync(USERS_PENDING_FILE, JSON.stringify(_pendingWrites)); } catch {} }
function _pendingQueue(id, payload, op = 'update') {
  const k = String(id);
  const email = (_mirrorGetById(id)?.email || '').toLowerCase().trim() || null;   // clé stable pour le rejeu (id hérité ≠ uuid)
  const ex = _pendingWrites.find(p => String(p.id) === k);
  if (ex) {
    if (email && !ex.email) ex.email = email;
    if (op === 'upsert' || op === 'delete') { ex.op = op; ex.row = payload || undefined; delete ex.fields; }
    else if (ex.op === 'upsert' && ex.row) { Object.assign(ex.row, payload); }   // maj de champs sur une création encore en attente
    else { ex.op = 'update'; ex.fields = Object.assign(ex.fields || {}, payload); }
    ex.attempts = 0;
  } else {
    _pendingWrites.push(op === 'update' ? { id: k, email, op: 'update', fields: payload, ts: Date.now(), attempts: 0 } : { id: k, email, op, row: payload || undefined, ts: Date.now(), attempts: 0 });
  }
  _pendingSave();
}
let _pendingFlushing = false;
async function _pendingFlush() {
  if (_pendingFlushing || !_pendingWrites.length) return;
  _pendingFlushing = true;
  try {
    const still = [];
    for (const p of _pendingWrites) {
      try {
        const w = _supaWhere(p.id, p.email);                    // rejeu par EMAIL si l'id est hérité (entier ≠ uuid)
        let error, data;
        if (p.op === 'delete') {
          ({ error } = await supabase.from(TABLE).delete().eq(w.col, w.val));
        } else if (p.op === 'upsert' && p.row) {
          // upsert : id non-uuid (compte hérité) → on n'inscrit PAS l'id (colonne uuid) et on dédoublonne par email
          const byEmail = !_UUID_RE.test(String(p.row.id || ''));
          const row = byEmail ? (() => { const { id, ...r } = p.row; return r; })() : p.row;
          ({ error } = await supabase.from(TABLE).upsert([row], { onConflict: byEmail ? 'email' : 'id' }));
        } else {
          ({ data, error } = await supabase.from(TABLE).update(p.fields || {}).eq(w.col, w.val).select('id'));
        }
        if (!error) {
          // update qui ne touche AUCUNE ligne (mauvais nœud / primaire pas encore revenue) → on GARDE en attente
          if (p.op === 'update' && Array.isArray(data) && data.length === 0) {
            if ((p.attempts = (p.attempts || 0) + 1) < 200) still.push(p);
            continue;
          }
          continue;                                             // ✅ rejoué (insert/maj/suppression effective) → on retire de la file
        }
        if (_supaDown(error) && (p.attempts = (p.attempts || 0) + 1) < 200) still.push(p);   // toujours muet → on garde (cap anti-boucle)
        else console.warn('[Auth] écriture hors-ligne abandonnée id=' + p.id + ' :', error.message);   // vraie erreur SQL ou trop d'essais → drop
      } catch { p.attempts = (p.attempts || 0) + 1; if (p.attempts < 200) still.push(p); }    // réseau → on garde
    }
    if (still.length !== _pendingWrites.length) {
      console.log(`[Auth] écritures hors-ligne : ${_pendingWrites.length - still.length} rejouée(s) vers Supabase, ${still.length} en attente`);
      _pendingWrites = still; _pendingSave();
    }
  } finally { _pendingFlushing = false; }
}
setInterval(() => { _pendingFlush().catch(() => {}); }, 5 * 60 * 1000);   // re-tentative périodique (dès que Supabase revient)

// ─── CONVERGENCE des comptes entre TOUTES les bases saines ──────────────────────────────────────
// Le failover (cf. _runMulti) écrit un nouveau compte sur le 1er nœud SAIN : quand la primaire est en 402,
// les comptes vont sur db2 → db3/db4 et la primaire (au retour) ne les ont PAS (constaté : db2=6, db3/db4=0).
// On PROPAGE donc le MIROIR LOCAL (superset de TOUS les comptes, password_hash inclus) vers chaque base saine
// par UPSERT (clé id uuid ; email pour les comptes hérités à id entier). C'est de l'INGRESS (gratuit, NON
// compté dans l'égress) et le miroir est LOCAL → ZÉRO égress Supabase. Idempotent (sans .select() → aucune
// ligne renvoyée). Résultat : chaque base saine finit avec TOUS les comptes → failover robuste (n'importe
// quelle base sert n'importe quel login) + primaire recomplétée dès son retour.
let _convBusy = false, _convLast = 0, _convTimer = null;
async function _usersConverge(reason = '') {
  /* ⚠️ LE SEUIL « AU MOINS DEUX BASES » ÉTAIT JUSTE POUR SA RAISON D'ORIGINE, ET FAUX POUR CELLE-CI.
     Il visait la DIVERGENCE entre nœuds (le failover écrit sur le premier sain, les autres l'ignorent) :
     sans second nœud, rien à faire converger. Mais depuis la quarantaine de lecture, cette fonction a
     un SECOND rôle — c'est elle qui resynchronise une base revenue en retard, et c'est elle seule qui
     lève sa quarantaine. Avec une base unique, le seuil la laissait donc quarantainée POUR TOUJOURS :
     toutes les lectures de `users` seraient tombées sur le miroir, définitivement. Une base suffit. */
  if (_convBusy || !_dbNodes.length || !_usersMirror.size) return;
  const now = Date.now();
  const healthy = _dbNodes.filter(n => n.downUntil <= now);
  if (!healthy.length) return;
  _convBusy = true;
  try {
    // COMPLETS uniquement : on ne propage QUE les comptes dont le password_hash est connu (présent au miroir).
    // → jamais nuller un hash (NOT NULL en base) ni écraser un bon hash par un vide. Les comptes dont le hash
    //   vit encore sur la PRIMAIRE bloquée (jamais lus depuis le 402) seront propagés dès qu'ils transitent
    //   (login/lecture → le miroir gagne le hash) ou au retour de la primaire.
    const pick = r => ({ id: r.id, email: r.email, password_hash: r.password_hash, name: r.name || '', role: r.role || 'client', plan: r.plan || 'professionnel', active: r.active !== false, expires_at: r.expires_at || null });
    const all = [..._usersMirror.values()].filter(r => r && r.email && r.password_hash && !_isTombstoned(r.id));
    const uuidRows   = all.filter(r => _UUID_RE.test(String(r.id || ''))).map(pick);
    /* ⚠️ ON GARDE L'ID DES COMPTES HÉRITÉS, ET ON CHANGE LA MANIÈRE DE LES ÉCRIRE (03/09/2026).
       Ils étaient envoyés SANS `id`, en upsert sur l'email — pour ne pas réécrire l'id d'une ligne
       qui, sur une base secondaire, aurait été créée en uuid. L'intention était juste ; le moyen ne
       pouvait PAS marcher : `users.id` est `text NOT NULL SANS valeur par défaut`, et un
       `INSERT … ON CONFLICT` construit d'abord la ligne à insérer — donc `null` dans `id`, donc
       échec, MÊME quand l'email existe et que seule la branche UPDATE aurait servi.
       MESURÉ sur la base principale, par un essai qui s'annule lui-même :
         « null value in column "id" of relation "users" violates not-null constraint ».
       CE QUE CE SEUL DÉFAUT CASSAIT, ET ON NE LE VOYAIT PAS :
         · `_up(node, legacyRows, 'email')` rendait false sur CHAQUE base, à CHAQUE passage ;
         · donc `if (a && b)` était toujours faux, donc LA QUARANTAINE NE SE LEVAIT JAMAIS — les
           quatre bases restaient « RESYNCHRO… » indéfiniment et AUCUNE lecture de comptes n'allait
           en base : tout le desk tournait sur le seul miroir local ;
         · donc les 29 comptes à id hérité ne convergeaient jamais, et aucune correction d'échéance
           les concernant ne pouvait atteindre la moindre base.
       LA RÉPARATION, en deux temps, sans migration de schéma (on ne peut pas en poser sur quatre
       bases depuis ici, et une écriture qui exige une migration est une écriture fragile) :
         1. UPDATE par EMAIL — pas d'insertion, donc pas de contrainte sur `id`, et l'id existant
            n'est jamais réécrit : c'est exactement ce que l'intention d'origine voulait protéger ;
         2. les emails qu'aucune ligne ne portait sont INSÉRÉS, avec leur id du miroir. */
    const legacyRows = all.filter(r => !_UUID_RE.test(String(r.id || ''))).map(pick);
    if (!uuidRows.length && !legacyRows.length) {
      /* ⚠️ SORTIR ICI SANS LEVER LA QUARANTAINE L'AURAIT RENDUE ÉTERNELLE. Un miroir dont aucun
         compte ne porte d'empreinte (cas d'une reconstruction partielle) n'a rien à propager — mais
         cela ne veut pas dire que les bases sont en retard. On lève, et on le dit. */
      _dbNodes.forEach(n => { if (n.quarLect) { n.quarLect = false; console.log(`[Auth] ${n.name} : rien à propager (miroir sans compte complet) → quarantaine levée`); } });
      return;
    }
    const _up = async (node, rows, conflict) => {
      if (!rows.length) return true;
      let { error } = await node.client.from(TABLE).upsert(rows, { onConflict: conflict });
      if (error && /expires_at/.test(error.message || '')) { ({ error } = await node.client.from(TABLE).upsert(rows.map(({ expires_at, ...x }) => x), { onConflict: conflict })); }   // colonne absente sur ce nœud → sans expires_at
      if (error) { if (_supaDown(error) && !_isSchemaErr(error)) _markDown(node, error); return false; }
      return true;
    };
    /* Comptes à id hérité : UPDATE par email, puis INSERT de ceux qu'aucune ligne ne portait.
       L'update ne touche jamais `id` — la ligne distante garde le sien, uuid ou entier. `.select('email')`
       ne coûte presque rien et dit ce qui a réellement été touché : sans lui, une écriture partie sur
       zéro ligne passerait pour un succès, exactement le piège déjà corrigé sur changePassword. */
    const _upLegacy = async (node, rows) => {
      if (!rows.length) return true;
      const manquants = [];
      for (const r of rows) {
        const { id, ...maj } = r;
        let { data, error } = await node.client.from(TABLE).update(maj).eq('email', r.email).select('email');
        if (error && /expires_at/.test(error.message || '')) {
          const { expires_at, ...m2 } = maj;
          ({ data, error } = await node.client.from(TABLE).update(m2).eq('email', r.email).select('email'));
        }
        if (error) { if (_supaDown(error) && !_isSchemaErr(error)) _markDown(node, error); return false; }
        if (!Array.isArray(data) || !data.length) manquants.push(r);   // aucune ligne à cet email → à créer, avec son id
      }
      if (!manquants.length) return true;
      let { error } = await node.client.from(TABLE).insert(manquants);
      if (error && /expires_at/.test(error.message || '')) { ({ error } = await node.client.from(TABLE).insert(manquants.map(({ expires_at, ...x }) => x))); }
      if (error) { if (_supaDown(error) && !_isSchemaErr(error)) _markDown(node, error); return false; }
      return true;
    };
    let okNodes = 0, leves = 0;
    for (const node of healthy) {
      try {
        const a = await _up(node, uuidRows, 'id'); const b = await _upLegacy(node, legacyRows);
        if (a && b) {
          okNodes++;
          /* C'EST ICI, ET NULLE PART AILLEURS, QUE LA QUARANTAINE SE LÈVE. Le nœud vient de recevoir
             TOUS les comptes complets du miroir : sa table `users` n'est plus en retard, il peut
             donc reprendre les lectures. Lever la quarantaine ailleurs — au retour du keep-alive,
             par exemple — rouvrirait précisément la fenêtre que cette garde ferme. */
          if (node.quarLect) { node.quarLect = false; leves++; console.log(`[Auth] ${node.name} resynchronisée (${all.length} compte(s)) → quarantaine de lecture LEVÉE`); }
        }
      }
      catch (e) { _markDown(node, e); }
    }
    void leves;
    _convLast = now;
    if (okNodes) console.log(`[Auth] convergence users${reason ? ' (' + reason + ')' : ''} : ${all.length} compte(s) complet(s) → ${okNodes}/${healthy.length} base(s)`);
  } finally { _convBusy = false; }
}
// Déclenchement DÉBOUNCÉ après une écriture (coalesce les rafales) → un nouveau compte se propage en ~8 s.
function _convSoon(reason) { if (_convTimer) return; _convTimer = setTimeout(() => { _convTimer = null; _usersConverge(reason).catch(() => {}); }, 8000); }
setTimeout(() => _usersConverge('boot').catch(() => {}), 30 * 1000);                       // amorçage : recomplète db3/db4 (vides) + db2 au démarrage
setInterval(() => _usersConverge('périodique').catch(() => {}), 20 * 60 * 1000);           // toutes les 20 min : recomplète une base revenue (ex. primaire au rollover égress)

// ════════════ KEEP-ALIVE (anti-PAUSE free-tier : 7 j sans activité BASE → projet mis en pause) ════════════
// Supabase met en pause un projet free sans « activité base de données » durant 7 j. Or un READ HEAD rejeté
// par un projet en 402 NE COMPTE PAS (ni un appel servi par cache). On envoie donc un WRITE réel (upsert d'1
// ligne `ai_cache`) = activité Postgres INCONTESTABLE, et — étant de l'INGRESS — NON plafonné par l'egress.
// Tourne sur le VPS (toujours allumé) → indépendant des secrets GitHub Actions (qui, eux, faisaient un READ
// inopérant). DOUBLE RÔLE = sonde de RETOUR : un write qui repasse sur un nœud en cooldown (ex. primaire au
// rollover egress, ou un projet dé-pausé à la main) le réintègre AUSSITÔT + déclenche la convergence.
let _kaBusy = false, _kaLast = 0, _kaOk = 0;
async function _keepAlive(reason = '') {
  if (_kaBusy || !_dbNodes.length) return;
  _kaBusy = true;
  try {
    const stamp = new Date().toISOString();
    const row = [{ key: 'keepalive:heartbeat', value: { ts: Date.now(), at: stamp }, created_at: stamp }];   // 1 ligne, écrasée à chaque fois
    let ok = 0, revived = 0;
    for (const node of _dbNodes) {   // TOUS les nœuds (même en cooldown) → le keep-alive sert aussi de sonde de retour
      try {
        const { error } = await node.client.from('ai_cache').upsert(row, { onConflict: 'key' });   // INGRESS pur (aucun .select() → rien lu)
        if (!error) {
          ok++;
          if (node.downUntil > Date.now()) { node.downUntil = 0; revived++; console.log(`[Auth] keep-alive : ${node.name} REVENUE (write accepté) → réintégrée au pool`); }
        }
      } catch { /* nœud injoignable → ignoré (réessai au prochain cycle) */ }
    }
    _kaLast = Date.now(); _kaOk = ok;
    console.log(`[Auth] keep-alive${reason ? ' (' + reason + ')' : ''} : ${ok}/${_dbNodes.length} base(s) maintenue(s) ACTIVE(s) par WRITE${revived ? ` · ${revived} revenue(s)` : ''}`);
    if (revived) _convSoon('nœud revenu');   // une base revient (write OK) → on lui propage TOUS les comptes
  } finally { _kaBusy = false; }
}
function getKeepAliveStatus() { return { last: _kaLast, ok: _kaOk, nodes: _dbNodes.length }; }
setTimeout(() => _keepAlive('boot').catch(() => {}), 60 * 1000);                  // au boot (+60 s)
setInterval(() => _keepAlive('périodique').catch(() => {}), 12 * 60 * 60 * 1000); // toutes les 12 h (2 pings / fenêtre de 7 j = marge large même si un cycle échoue)

// ─── Seed admin (premier lancement) ──────────────────────────────────────────
async function seedAdmin() {
  const { data, error } = await supabase.from(TABLE).select('id').limit(1);

  if (error) {
    console.error('[Auth] Supabase unreachable:', error.message);
    return;
  }
  if (data && data.length > 0) return; // des utilisateurs existent déjà

  const defaultPass = 'Admin2024!';
  const hash = await bcrypt.hash(defaultPass, SALT_ROUNDS);

  const { error: err } = await supabase.from(TABLE).insert([{
    email:         'admin@datatradingpro.com',
    password_hash: hash,
    name:          'Admin',
    role:          'admin',
    plan:          'full',
    active:        true,
  }]);

  if (err) { console.error('[Auth] Seed admin échoué:', err.message); return; }

  console.log('\n' + '═'.repeat(54));
  console.log('[Auth] ✅ Compte admin créé :');
  console.log('[Auth]    Email    : admin@datatradingpro.com');
  console.log('[Auth]    Password : ' + defaultPass);
  console.log('[Auth] ⚠️  Changez le MDP depuis /admin');
  console.log('═'.repeat(54) + '\n');
}

// ─── Vérifier les credentials (login) ────────────────────────────────────────
// Staff = équipe interne (admin complet OU agent de support) → jamais suspendu/expiré, pas d'emails abonnement
const isStaff = r => r === 'admin' || r === 'support';

async function verifyLogin(email, password) {
  const em = (email || '').toLowerCase().trim();
  if (isEmailBlacklisted(em)) return null;   // liste noire → jamais de connexion (réponse générique, on ne révèle pas l'état)
  let data = null, down = false;
  try {
    const r = await supabase.from(TABLE).select('*').eq('email', em).single();
    if (r.error) { if (_supaDown(r.error)) down = true; }   // 402/réseau → repli ; 0 ligne → email inexistant
    else data = r.data;
  } catch { down = true; }

  if (data) {
    _mirrorPut(data); _mirrorSaveFile();                            // garde le miroir frais (hash courant inclus)
    if (_pendingWrites.length) _pendingFlush().catch(() => {});     // Supabase répond → on rejoue les écritures en attente
  } else {
    // Pas trouvé en base : soit Supabase muet (down), soit le compte EXISTE mais vit sur la primaire BLOQUÉE
    // (les secondaires ne l'ont pas → ils renvoient « 0 ligne »). Dans les deux cas → repli sur le miroir local.
    data = _mirrorGet(em);
    if (data) console.warn('[Auth] login via MIROIR local →', em);
  }
  if (!data) return null;
  if (_isTombstoned(data.id)) return null;   // compte supprimé → jamais de reconnexion (même si la primaire le renvoie au retour)
  void down;

  const ok = await bcrypt.compare(password, data.password_hash || '');
  if (!ok) return null;   // mauvais mdp → message générique (on ne révèle pas l'état du compte)

  // Compte suspendu (abonnement non actif) — distinct d'un mauvais mot de passe
  if (!isStaff(data.role) && !data.active) {
    return { suspended: true };
  }

  // Abonnement expiré ? (les admins ne sont jamais bloqués)
  // Délai de grâce de 24h après l'échéance : le client peut encore se connecter,
  // ce qui laisse le temps au renouvellement (Whop) d'être traité.
  const GRACE_MS = 24 * 60 * 60 * 1000;
  if (!isStaff(data.role) && data.expires_at &&
      new Date(data.expires_at).getTime() + GRACE_MS < Date.now()) {
    return { expired: true, expiresAt: data.expires_at };
  }

  // Mettre à jour last_login en background (best-effort, jamais bloquant si Supabase est muet)
  try { const lw = _supaWhere(data.id, data.email); supabase.from(TABLE).update({ last_login: new Date().toISOString() }).eq(lw.col, lw.val).then(() => {}, () => {}); } catch {}

  return { id: data.id, email: data.email, name: data.name, role: data.role, plan: data.plan, active: !!data.active, expiresAt: data.expires_at || null };
}

// ─── CRUD utilisateurs ────────────────────────────────────────────────────────
// Cache mémoire COURT (10 s) : getAllUsers est appelé par les jobs de fond (trial/reengagement/expiry)
// + l'inbox support → on évite de répéter un full-scan. Les écritures invalident via _bustUsersCache().
let _allUsersCache = { ts: 0, data: null };
function _bustUsersCache() { _allUsersCache = { ts: 0, data: null }; }
async function getAllUsers(opts = {}) {
  if (!opts.fresh && _allUsersCache.data && Date.now() - _allUsersCache.ts < 60000) return _allUsersCache.data;   // 60 s (cache invalidé à chaque écriture) → coupe le SELECT full-table du poll admin /4 s (anti-egress)
  try {
    let { data, error } = await supabase
      .from(TABLE)
      .select('id, email, name, role, plan, active, created_at, last_login, expires_at')
      .order('created_at', { ascending: false });

    // Tolérance : si la colonne expires_at n'a pas encore été ajoutée, on réessaie sans
    if (error && /expires_at/.test(error.message)) {
      ({ data, error } = await supabase
        .from(TABLE)
        .select('id, email, name, role, plan, active, created_at, last_login')
        .order('created_at', { ascending: false }));
    }
    if (error) throw new Error(error.message);
    _mirrorPutMany(data || []);                                    // rafraîchit le miroir (métadonnées) à chaque scan réussi
    if (_pendingWrites.length) _pendingFlush().catch(() => {});
    // UNION base + miroir : les comptes EXISTANTS vivent sur la primaire BLOQUÉE (absents des secondaires) →
    // la base ne renvoie que les NOUVEAUX comptes (créés sur db2…). On fusionne avec le miroir (existants),
    // dédup par id, la base primant sur le miroir (données fraîches). Quand la primaire revient, l'union est inoffensive.
    const _byId = new Map();
    for (const u of [..._usersMirror.values()].map(_pubUser)) if (u && u.id != null) _byId.set(String(u.id), u);
    for (const u of (data || [])) if (u && u.id != null) _byId.set(String(u.id), u);   // la base PRIME sur le miroir
    const merged = [..._byId.values()].filter(u => !_isTombstoned(u.id)).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    _allUsersCache = { ts: Date.now(), data: merged };
    return merged;
  } catch (e) {
    // Supabase muet (quota egress dépassé, panne) → repli sur le miroir local : forgot-password,
    // liste admin et jobs de fond continuent de tourner au lieu de jeter.
    const arr = [..._usersMirror.values()].map(_pubUser).filter(u => u && !_isTombstoned(u.id));
    if (arr.length) { _allUsersCache = { ts: Date.now(), data: arr }; console.warn('[Auth] getAllUsers via MIROIR local (Supabase indisponible) →', arr.length, 'compte(s)'); return arr; }
    throw e;
  }
}

async function getUserById(id) {
  if (_isTombstoned(id)) return null;   // compte supprimé → introuvable, même si la primaire le renvoie à son retour
  try {
    let { data, error } = await supabase
      .from(TABLE)
      .select('id, email, name, role, plan, active, created_at, expires_at')
      .eq('id', id)
      .single();
    // Tolérance si les colonnes created_at/expires_at n'existent pas encore
    if (error && /(expires_at|created_at)/.test(error.message || '')) {
      ({ data, error } = await supabase.from(TABLE).select('id, email, name, role, plan, active').eq('id', id).single());
    }
    if (data) { _mirrorPut(data); _mirrorSaveFile(); return data; }
    // Pas en base : Supabase muet OU compte existant resté sur la primaire bloquée (absent des secondaires) → miroir.
    const m = _pubUser(_mirrorGetById(id));
    if (m) return m;
    return null;                                                  // ni en base ni au miroir → compte réellement absent
  } catch {
    return _pubUser(_mirrorGetById(id));
  }
}

async function createUser({ email, password, name = '', role = 'client', plan = 'professionnel', expiresAt = null }) {
  if (!email || !password) throw new Error('Email et mot de passe requis');
  // GARDE-FOU anti « comptes bug » : un nom NON VIDE mais UNIQUEMENT numérique/symbolique (« 1 », « 20 »,
  // « 1-2 »…) = compte de test/script → REFUSÉ. (Le nom VIDE reste autorisé : la réconciliation Whop le crée vide.)
  const nm = String(name == null ? '' : name).trim();
  if (nm && /^[\d\s.\-_/\\]+$/.test(nm)) {
    throw new Error('Nom invalide : un nom ne peut pas être composé uniquement de chiffres ou de symboles.');
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const em = email.toLowerCase().trim();
  if (isEmailBlacklisted(em)) throw new Error('Cet email n\'est pas autorisé.');   // liste noire → aucune création (bloque aussi le provisioning Whop)
  if (_mirrorGet(em)) throw new Error('Cet email est déjà utilisé par un autre compte.');   // anti-doublon rapide (et seul rempart si la base principale est muette)
  const id = require('crypto').randomUUID();   // id généré côté serveur → cohérent miroir + rejeu vers la base
  const row = { id, email: em, password_hash: hash, name: nm, role, plan, active: true, expires_at: expiresAt || null };
  let { data, error } = await supabase.from(TABLE).insert([row]).select().single();

  // Tolérance : si la colonne expires_at n'existe pas encore, on crée sans (abonnement non enregistré)
  if (error && /expires_at/.test(error.message || '')) {
    const r2 = { ...row }; delete r2.expires_at;
    ({ data, error } = await supabase.from(TABLE).insert([r2]).select().single());
  }
  if (error) {
    if (/duplicate|already exists|users_email_key|unique/i.test(error.message || '')) {
      throw new Error('Cet email est déjà utilisé par un autre compte.');
    }
    // Base principale indisponible (blackout egress) → on crée dans le MIROIR + rejeu différé : le compte
    // fonctionne TOUT DE SUITE (login via miroir) et est inséré dans la base dès son retour. Fini « primary cooling down ».
    if (_supaDown(error)) {
      const full = { ...row, created_at: new Date().toISOString() };
      _mirrorPut(full); _mirrorSaveFile();
      _pendingQueue(id, full, 'upsert');
      console.warn('[Auth] createUser via MIROIR (base principale indisponible) → rejeu différé :', em);
      _bustUsersCache();
      _convSoon('compte créé (offline)');   // propage vers les bases SAINES (db2/3/4) même si la primaire est muette
      return _pubUser(_mirrorGet(em));
    }
    throw new Error(error.message);
  }
  if (data) { _mirrorPut(data); _mirrorSaveFile(); }   // nouveau compte → entre tout de suite dans le miroir (hash inclus)
  _bustUsersCache();
  _convSoon('compte créé');   // propage le nouveau compte vers TOUTES les bases saines (db3/db4 vides, primaire au retour)
  return data;
}

async function changePassword(id, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new Error('Mot de passe trop court (min 6 caractères)');
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const w = _supaWhere(id);
  let supaOk = false;
  // .select('id') = confirme qu'une ligne a VRAIMENT été modifiée. Sinon une écriture envoyée à un nœud
  // secondaire (primaire bloquée) « réussit » sur 0 ligne → on croirait à tort que c'est persisté, et le
  // MDP reviendrait à l'ancien au retour de la primaire. 0 ligne touchée ⇒ on met en file de rejeu.
  try { const { data, error } = await supabase.from(TABLE).update({ password_hash: hash }).eq(w.col, w.val).select('id'); if (!error && Array.isArray(data) && data.length) supaOk = true; }
  catch {}
  // Reflète TOUJOURS dans le miroir → la connexion avec le nouveau MDP marche immédiatement, même Supabase bloqué.
  const row = _mirrorGetById(id);
  if (row) { row.password_hash = hash; _mirrorIndex(row); _mirrorSaveFile(); }
  if (!supaOk) {
    _pendingQueue(id, { password_hash: hash });   // rejoué (par email) vers Supabase à son retour (sinon le MDP « reviendrait » à l'ancien)
    if (!row) throw new Error('Supabase indisponible et compte absent du miroir local');
  }
  _convSoon('mdp');   // propage le NOUVEAU hash vers toutes les bases saines (sinon une base garde l'ancien)
}

async function updateUser(id, fields = {}) {
  const upd = {};
  if ('name'   in fields) upd.name   = fields.name || '';
  if ('role'   in fields) upd.role   = fields.role || 'client';
  if ('plan'   in fields) upd.plan   = fields.plan || 'professionnel';
  if ('active' in fields) upd.active = fields.active === 1 || fields.active === true || fields.active === '1';
  if ('expiresAt' in fields) upd.expires_at = fields.expiresAt || null;
  if (Object.keys(upd).length === 0) return;
  const w = _supaWhere(id);
  let supaOk = false, lastErr = null;
  try {
    let { data, error } = await supabase.from(TABLE).update(upd).eq(w.col, w.val).select('id');
    // Tolérance : colonne expires_at absente → on réessaie sans
    if (error && /expires_at/.test(error.message || '')) {
      const upd2 = { ...upd }; delete upd2.expires_at;
      if (Object.keys(upd2).length) ({ data, error } = await supabase.from(TABLE).update(upd2).eq(w.col, w.val).select('id'));
      else { error = null; data = [1]; }   // plus rien à écrire → no-op assumé OK
    }
    if (error) lastErr = error;
    else if (Array.isArray(data) && data.length) supaOk = true;   // ligne RÉELLEMENT modifiée (≠ 0 ligne sur un nœud secondaire)
  } catch (e) { lastErr = e; }
  /* Reflète dans le miroir (les changements admin restent visibles même Supabase muet).
     ⚠️ CE N'EST PAS QU'UN CONFORT D'AFFICHAGE — C'EST LA SEULE COPIE QUI COMPTE. `_usersConverge`
     repousse le MIROIR vers les quatre bases : une modification d'administration qui n'atteint pas
     le miroir sera donc ANNULÉE au passage de convergence suivant, alors même qu'elle a réussi en
     base. Or la recherche se faisait par id SEUL, et sans filet : `_mirrorGetById` rend `null` dès
     que l'id affiché par le panneau ne correspond pas à celui du miroir — le cas exact que
     `_supaWhere` gère déjà pour l'ÉCRITURE en base (id hérité entier d'un côté, uuid de l'autre),
     et qu'on avait oublié ici. On retombe donc sur la clé métier — l'email — comme lui, et si rien
     ne répond on le DIT : une écriture admin qui ne trouve aucune ligne au miroir est une écriture
     qui sera défaite, et cela ne doit pas se découvrir trois semaines plus tard sur un compte payé. */
  let row = _mirrorGetById(id);
  if (!row && w.col === 'email') row = _mirrorGet(w.val);
  if (row) { Object.assign(row, upd); _mirrorIndex(row); _mirrorSaveFile(); }
  else console.warn(`[Auth] maj compte ${id} : AUCUNE ligne au miroir (ni par id, ni par email) — la convergence risque de défaire ce changement.`);
  _bustUsersCache();   // ← la liste admin reflète le changement IMMÉDIATEMENT (sinon cache 60 s → « ça n'a pas changé »)
  if (!supaOk) {
    if (lastErr && !_supaDown(lastErr)) throw new Error(lastErr.message || String(lastErr));   // vraie erreur SQL → remonter
    _pendingQueue(id, upd);                                                                     // muet OU 0 ligne (mauvais nœud) → rejeu différé (par email)
  }
  _convSoon('maj compte');   // propage la maj (plan/role/active/expire) vers toutes les bases saines
}

// Purge TOTALE des données rattachées à un compte supprimé (anti-orphelins : chat/bienvenue affichant
// l'UUID, journal + images de trades, avatar, préférences « vu », parrainage/affiliation Whop). Best-effort
// & idempotent — les helpers sont local-first (RAM + fichier + Supabase). Hoisting OK (chatDeleteByUser /
// aiCacheDel / aiCacheDelPrefix sont des déclarations de fonction, définies plus bas dans le fichier).
async function _purgeUserData(id) {
  const sid = String(id);
  try { await chatDeleteByUser(sid); } catch {}                                  // messages chat + bienvenue + réactions
  // Index inverse affiliation Whop (clé par username) → résolu via whopaffinfo AVANT de le purger
  try { const aff = await aiCacheGet('whopaffinfo:' + sid, 366 * 86400000); const u = aff && (aff.username || aff.user || aff.affiliate); if (u) await aiCacheDel('whopaff:' + String(u).toLowerCase().trim()); } catch {}
  const dels = ['journal:' + sid, 'avatar:' + sid, 'symrecent:' + sid, 'readreports:' + sid,
    'journalnewseen:' + sid, 'chatseen:' + sid, 'seasonpair:' + sid,
    'referral:' + sid, 'referredby:' + sid, 'refbonus:' + sid, 'whopaffinfo:' + sid];
  for (const k of dels) { try { await aiCacheDel(k); } catch {} }
  try { await aiCacheDelPrefix('jrimg:' + sid + ':'); } catch {}                 // images de trades (multi-clés)
  try { await aiCacheDelPrefix('aichatcap:' + sid + ':'); } catch {}            // quota chat IA par jour (multi-clés)
}

async function deleteUser(id) {
  const w = _supaWhere(id);                                          // clé (email si id hérité ≠ uuid) résolue AVANT de purger le miroir
  const email = (_mirrorGetById(id)?.email || '').toLowerCase().trim() || null;
  const { error } = await supabase.from(TABLE).delete().eq(w.col, w.val);
  // Purge le miroir + annule toute écriture en attente pour cet id : un compte supprimé ne doit JAMAIS
  // réapparaître ni se reconnecter via le repli (corrige aussi le trou « deleted user via miroir »).
  const row = _mirrorGetById(id);
  if (row) { _usersMirror.delete(String(row.email).toLowerCase().trim()); _usersMirrorById.delete(String(id)); _mirrorSaveFile(); }
  _tombstone(id);      // ← ne RÉAPPARAÎTRA jamais, même au retour de la primaire (delete en blackout = secondaire seul)
  _bustUsersCache();   // ← suppression visible IMMÉDIATEMENT dans la liste admin (plus de « il y est toujours »)
  _pendingWrites = _pendingWrites.filter(p => String(p.id) !== String(id));
  await _purgeUserData(id);   // ← retire TOUT le reste du compte (chat/bienvenue, journal, avatar, prefs, parrainage)
  if (error) {
    if (_supaDown(error)) { _pendingWrites.push({ id: String(id), email, op: 'delete', ts: Date.now(), attempts: 0 }); _pendingSave(); return; }   // base muette → suppression rejouée (par email) à son retour (miroir déjà purgé)
    _pendingSave();
    throw new Error(error.message);
  }
  _pendingSave();
}

// ═══════════════════ CHAT SUPPORT (persistant) ═══════════════════
// Table Supabase `chat_messages` ; fallback fichier local si la table n'existe pas encore.
// (fs/path requis en tête de fichier — réutilisés par le miroir des comptes.)
const CHAT_TABLE = 'chat_messages';
const CHAT_FILE  = path.join(__dirname, 'cache_chat.json');
let _chatDb = true;            // bascule sur fichier si la table manque
let _chatFile = [];
try { _chatFile = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')) || []; } catch {}
function _chatSaveFile() { try { fs.writeFileSync(CHAT_FILE, JSON.stringify(_chatFile)); } catch {} }

// Réactions emoji stockées À PART (indépendant du schéma chat_messages → marche toujours, sans
// migration). Forme : { "<msgId>": { "👍": ["userId", …], "❤️": […], "🔥": […] } }
const REACT_FILE = path.join(__dirname, 'cache_reactions.json');
let _reactStore = {};
try { _reactStore = JSON.parse(fs.readFileSync(REACT_FILE, 'utf8')) || {}; } catch {}
// Persistance DURABLE : le fichier disque est wipé à chaque rebuild conteneur (disque éphémère) →
// on recharge ET on sauve aussi dans Supabase KV (ai_cache) pour que les réactions survivent aux déploiements.
/* ⚠️ MÊME DÉFAUT QUE LA REPRISE DE LA LISTE NOIRE, ET IL ÉTAIT LÀ DEPUIS LE DÉBUT (vu le 03/09).
   Cette reprise partait pendant l'évaluation du module, donc avant `const _aiMem` (ligne ~1740) :
   elle levait « Cannot access '_aiMem' before initialization », et son `catch {}` — muet, celui-là —
   n'en laissait AUCUNE trace. Les réactions étaient bien ÉCRITES en base (`_reactSave` tourne plus
   tard, sur action) mais n'ont jamais été RELUES au démarrage : le commentaire « survit aux
   rebuilds » disait donc l'inverse de ce qui se passait. Différée d'un tour de boucle, elle
   fonctionne. Et le catch nomme désormais ce qu'il avale. */
setTimeout(() => {
  (async () => {
    try { const kv = await aiCacheGet('chat:reactions', 366 * 86400000); if (kv && typeof kv === 'object') _reactStore = Object.assign({}, kv, _reactStore); }
    catch (e) { console.warn('[Chat] reprise des réactions :', e && e.message); }
  })();
}, 0);
function _reactSave() {
  try { fs.writeFileSync(REACT_FILE, JSON.stringify(_reactStore)); } catch {}
  try { aiCacheSet('chat:reactions', _reactStore); } catch {}   // durable → survit aux rebuilds
}
function _chatTableMissing(err) { return err && /chat_messages|schema cache|does not exist|relation/i.test(err.message); }

// Auto-récupération : si on est en mode fichier (table absente au démarrage), on re-sonde
// périodiquement Supabase. Dès que la table existe, on repasse en BDD ET on y migre le
// backlog du fichier → AUCUN redéploiement nécessaire après avoir créé la table.
let _chatProbeTs = 0;
async function _chatEnsureDb() {
  if (_chatDb) return;
  const now = Date.now();
  if (now - _chatProbeTs < 30000) return;   // 1 sonde / 30s max
  _chatProbeTs = now;
  const { error } = await supabase.from(CHAT_TABLE).select('id').limit(1);
  if (error) return;                          // toujours absente → on reste en fichier
  _chatDb = true;
  if (_chatFile.length) {
    const backlog = _chatFile.map(({ user_id, sender, text, created_at, read }) =>
      ({ user_id: String(user_id), sender, text, created_at, read: !!read }));
    const { error: insErr } = await supabase.from(CHAT_TABLE).insert(backlog);
    if (!insErr) { _chatFile = []; _chatSaveFile(); console.log(`[Chat] table détectée → ${backlog.length} message(s) migré(s) du fichier vers la BDD`); }
    else { console.warn('[Chat] migration backlog échouée:', insErr.message); _chatDb = false; }
  } else {
    console.log('[Chat] table chat_messages détectée → persistance BDD activée');
  }
}

// ══ CACHE RAM CHAT — ANTI-EGRESS SUPABASE (correctif du mail de quota : 15,64 Go / 5,5 Go) ══════
// Le drawer support poll /api/chat toutes les 4 s, l'admin /conversations toutes les 10 s et
// /unread toutes les 8 s : chaque tick re-téléchargeait la conversation COMPLÈTE depuis Supabase
// (pièces jointes base64 jusqu'à 1,5 Mo incluses) → des Go de bande passante sortante par jour.
// Instance UNIQUE → la RAM fait foi : les lectures servent la mémoire, Supabase n'est relu
// qu'après une ÉCRITURE (insert/lu/édition/suppression) ou à l'expiration d'un TTL de sécurité.
const CHAT_MEM_TTL = 5 * 60 * 1000;
const _chatListMem   = new Map();   // userId -> { rows, ts }
let   _chatThreadsMem = null;       // { rows, ts }
const _chatUnreadMem = new Map();   // "userId|sender" -> { n, ts }
function _chatDirty(userId) {
  if (userId != null) _chatListMem.delete(String(userId)); else _chatListMem.clear();
  _chatThreadsMem = null;
  if (userId != null) { _chatUnreadMem.delete(String(userId) + '|user'); _chatUnreadMem.delete(String(userId) + '|support'); }
  else _chatUnreadMem.clear();
}

async function chatInsert({ user_id, sender, text }) {
  _chatDirty(user_id);
  await _chatEnsureDb();
  // Texte normal : 2000 car. ; pièce jointe (data URL base64) : jusqu'à ~1,5 Mo
  const raw = String(text);
  const safe = /^data:/.test(raw) ? raw.slice(0, 1500000) : raw.slice(0, 2000);
  const row = { user_id: String(user_id), sender, text: safe, created_at: new Date().toISOString(), read: false };
  if (_chatDb) {
    const { data, error } = await supabase.from(CHAT_TABLE).insert([row]).select().single();
    if (!error) return data;
    if (_chatTableMissing(error)) _chatDb = false; else throw new Error(error.message);
  }
  const m = { id: 'c' + Date.now() + '-' + Math.floor(Math.random() * 1e4), ...row };
  _chatFile.push(m);
  if (_chatFile.length > 5000) _chatFile = _chatFile.slice(-5000);   // cap mémoire/fichier (fallback)
  _chatSaveFile();
  return m;
}

async function chatList(userId) {
  const uid = String(userId);
  // RAM fraîche → ZÉRO egress (le poll 4 s du drawer ne touche plus Supabase)
  const mem = _chatListMem.get(uid);
  if (mem && (Date.now() - mem.ts) < CHAT_MEM_TTL) {
    mem.rows.forEach(m => { const r = _reactStore[String(m.id)]; if (r) m.reactions = r; });   // réactions à jour (RAM)
    return mem.rows;
  }
  await _chatEnsureDb();
  let rows = null;
  if (_chatDb) {
    const { data, error } = await supabase.from(CHAT_TABLE).select('*').eq('user_id', uid).order('created_at', { ascending: true });
    if (!error) rows = data || [];
    else if (_chatTableMissing(error)) _chatDb = false;
    else {
      // Erreur transitoire (réseau / blackout egress / garde-fou anti-fuite) : NE JAMAIS jeter — sinon 500 sur
      // le poll 4 s du drawer. Repli RAM périmé puis fichier, SANS re-cacher (la coupure est temporaire).
      const stale = _chatListMem.get(uid);
      if (stale) { stale.rows.forEach(m => { const r = _reactStore[String(m.id)]; if (r) m.reactions = r; }); return stale.rows; }
      rows = _chatFile.filter(m => m.user_id === uid).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      rows.forEach(m => { const r = _reactStore[String(m.id)]; if (r) m.reactions = r; });
      return rows;
    }
  }
  if (rows == null) rows = _chatFile.filter(m => m.user_id === uid).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  rows.forEach(m => { const r = _reactStore[String(m.id)]; if (r) m.reactions = r; });   // overlay réactions
  _chatListMem.set(uid, { rows, ts: Date.now() });
  return rows;
}

// Marque comme lus les messages reçus par `recipient` ('user' lit le support, 'support' lit l'user)
async function chatMarkRead(userId, recipientReadsFrom, opts) {
  // ANTI-EGRESS (cause de l'incident 15,6 Go puis 18 Go) : un GET /api/chat est POLLÉ toutes les 4 s
  // pendant que le drawer est ouvert et appelait chatMarkRead → _chatDirty → CACHE RAM INVALIDÉ → le
  // tick suivant refaisait un select('*') de toute la conversation (images base64 incluses) = la fuite.
  // Désormais : s'il n'y a AUCUN non-lu de cet expéditeur, on ne touche À RIEN (ni cache, ni UPDATE) →
  // le poll de lecture reste 100 % en RAM (0 egress). chatUnread est RAM-caché → ce contrôle ne coûte rien.
  // opts.force : ignore ce court-circuit — réservé aux ACTIONS PONCTUELLES (ex. le support RÉPOND →
  // il a forcément lu → on marque lu à coup sûr, sans dépendre d'un compteur RAM peut-être périmé).
  // Sûr côté egress car ces actions ne sont PAS pollées (contrairement au GET de lecture toutes les 4 s).
  if (!(opts && opts.force) && !(await chatUnread(userId, recipientReadsFrom))) return;
  _chatDirty(userId);
  await _chatEnsureDb();
  if (_chatDb) {
    const { error } = await supabase.from(CHAT_TABLE).update({ read: true }).eq('user_id', String(userId)).eq('sender', recipientReadsFrom).eq('read', false);
    if (!error) { _chatUnreadMem.set(String(userId) + '|' + recipientReadsFrom, { n: 0, ts: Date.now() }); return; }   // non-lu → 0 en RAM (les prochains polls retombent dans le court-circuit ci-dessus)
    if (_chatTableMissing(error)) _chatDb = false; else return;
  }
  _chatFile.forEach(m => { if (m.user_id === String(userId) && m.sender === recipientReadsFrom) m.read = true; });
  _chatSaveFile();
}

// Nombre de messages non lus envoyés par `fromSender` à l'utilisateur
async function chatUnread(userId, fromSender) {
  const memKey = String(userId) + '|' + fromSender;
  const mem = _chatUnreadMem.get(memKey);
  if (mem && (Date.now() - mem.ts) < CHAT_MEM_TTL) return mem.n;   // poll 8 s → RAM
  await _chatEnsureDb();
  let n = null;
  if (_chatDb) {
    const { count, error } = await supabase.from(CHAT_TABLE).select('id', { count: 'exact', head: true }).eq('user_id', String(userId)).eq('sender', fromSender).eq('read', false);
    if (!error) n = count || 0;
    else if (_chatTableMissing(error)) _chatDb = false;
    // Erreur TRANSITOIRE (blackout egress / réseau) : NE JAMAIS renvoyer 0 — ça masquerait le badge non-lu
    // (ex. message de bienvenue) tant que dure la coupure. Repli sur la dernière valeur RAM, sinon le compte
    // fichier — exactement comme chatList. (Aucun egress ajouté : RAM/fichier uniquement.)
    else return mem ? mem.n : _chatFile.filter(m => m.user_id === String(userId) && m.sender === fromSender && !m.read).length;
  }
  if (n == null) n = _chatFile.filter(m => m.user_id === String(userId) && m.sender === fromSender && !m.read).length;
  _chatUnreadMem.set(memKey, { n, ts: Date.now() });
  return n;
}

// Admin : liste des conversations (un thread par utilisateur ayant écrit)
// Aperçu court d'un message (JAMAIS le base64 d'une image collée → payload léger)
function _chatPreview(t) {
  const s = String(t || '');
  if (/^data:image\//.test(s)) return '📷 Image';
  if (/^data:/.test(s))        return '📎 Pièce jointe';
  return s.slice(0, 120);
}

// Liste des threads pour la boîte de réception support.
// ⚠️ CE COMMENTAIRE DÉCRIVAIT UNE ARCHITECTURE QUI N'EXISTE PAS (relevé le 03/09). Il annonçait
// « 1) méta SANS le champ text, 2) seulement les récents AVEC text ». La réalité est l'inverse :
// la requête (1) ramène bien `text` (aperçu), et c'est la (2), celle des non-lus, qui s'en passe.
// Un commentaire périmé ment avec l'autorité du code — celui-ci aurait fait chercher une économie
// déjà faite, et manquer celle qui reste.
// CE QUE FONT VRAIMENT LES DEUX REQUÊTES, en parallèle :
//   1) les 400 messages les plus récents AVEC `text` → aperçu + dernier horodatage par fil ;
//   2) les seuls non-lus côté client, `user_id` seul → compteur du badge, volume négligeable.
// ⚠️ COÛT À CONNAÎTRE DEPUIS LA RÉUNION DES NŒUDS (_lireUnion) : la requête (1) est désormais posée
// à CHAQUE base, et son poids est celui des pièces jointes qu'elle traverse — MESURÉ sur la base
// principale : 71 messages, dont 4 pièces jointes, 376 ko au total, la plus grosse à 157 ko. Le
// cache RAM de 5 min (contre un sondage admin à 10 s) ramène cela à 12 lectures par heure, et le
// garde-fou d'egress (_egTripped, 150 Mo/24 h) reste le filet en dernier ressort. Si ce poste
// devait grossir, l'économie qui RESTE à faire est de ne pas rapatrier le base64 d'une image pour
// n'en garder que « 📷 Image » — ce que fait _chatPreview juste après.
async function chatThreads() {
  // RAM fraîche → ZÉRO egress (le poll 10 s de l'admin ne touche plus Supabase)
  if (_chatThreadsMem && (Date.now() - _chatThreadsMem.ts) < CHAT_MEM_TTL) return _chatThreadsMem.rows;
  await _chatEnsureDb();
  // PERF : avant, on lisait TOUTE la table (sans limite) à chaque ouverture juste pour compter les
  // non-lus → lent quand l'historique grossit. Désormais : 2 requêtes LÉGÈRES en PARALLÈLE →
  //   (1) les 400 messages récents (aperçu + dernier horodatage par thread)
  //   (2) UNIQUEMENT les non-lus côté client (compteur badge) — petit volume.
  let recent = [], unread = [];
  if (_chatDb) {
    const [rRes, uRes] = await Promise.all([
      supabase.from(CHAT_TABLE).select('user_id, sender, text, created_at').order('created_at', { ascending: false }).limit(400),
      supabase.from(CHAT_TABLE).select('user_id').eq('sender', 'user').eq('read', false),
    ]);
    if (rRes.error) { if (_chatTableMissing(rRes.error)) _chatDb = false; }
    else { recent = rRes.data || []; unread = (uRes && uRes.data) || []; }
  }
  if (!_chatDb) {
    recent = [..._chatFile].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    unread = recent.filter(m => m.sender === 'user' && !m.read);
  }
  // Dernier message + horodatage par utilisateur (depuis les récents)
  const byUser = new Map();
  for (const m of recent) {
    if (!byUser.has(m.user_id)) byUser.set(m.user_id, { user_id: m.user_id, last: _chatPreview(m.text), lastAt: m.created_at, unread: 0 });
  }
  // Compteur de non-lus (ajoute aussi les threads dont le dernier message dépasse les 400 récents)
  for (const m of unread) {
    if (!byUser.has(m.user_id)) byUser.set(m.user_id, { user_id: m.user_id, last: '', lastAt: null, unread: 0 });
    byUser.get(m.user_id).unread++;
  }
  /* ⚠️ L'ORDRE N'ÉTAIT QU'UN EFFET DE BORD, ET IL MENTAIT SUR LES FILS ANCIENS (03/09/2026).
     Aucun tri n'existait : la liste sortait dans l'ordre d'INSERTION de `byUser`. Cet ordre suit la
     requête des 400 messages récents (décroissante), donc il PARAISSAIT juste — mais un fil dont le
     dernier message dépasse cette fenêtre n'entre que par la seconde passe, celle des non-lus, et
     se retrouvait donc collé EN FIN de liste quelle que soit sa date. Un client qui vous écrit
     aujourd'hui, après des mois de silence, tombait tout en bas.
     Depuis que la lecture RÉUNIT les quatre bases, s'en remettre à un ordre d'insertion n'a plus
     aucun sens : deux moitiés triées concaténées ne font pas un tout trié. On trie donc pour de
     bon, du plus récent au plus ancien, et les fils sans date connue ferment la marche plutôt que
     de s'intercaler n'importe où. */
  const out = [...byUser.values()].sort((a, b) => {
    const ta = a.lastAt ? Date.parse(a.lastAt) : NaN;
    const tb = b.lastAt ? Date.parse(b.lastAt) : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
  _chatThreadsMem = { rows: out, ts: Date.now() };
  return out;
}

// ── Suppression d'un message (admin) ──────────────────────────
async function chatDelete(id) {
  _chatDirty(null);   // userId inconnu ici → on invalide tout (rare : action admin)
  await _chatEnsureDb();
  if (_reactStore[String(id)]) { delete _reactStore[String(id)]; _reactSave(); }   // nettoie les réactions
  if (_chatDb) {
    const { error } = await supabase.from(CHAT_TABLE).delete().eq('id', id);
    if (!error) return true;
    if (_chatTableMissing(error)) _chatDb = false; else return false;
  }
  const before = _chatFile.length;
  _chatFile = _chatFile.filter(m => String(m.id) !== String(id));
  if (_chatFile.length !== before) { _chatSaveFile(); return true; }
  return false;
}

// ── Suppression de TOUS les messages d'un compte (à la suppression du compte) ──
// Purge BDD + fichier + réactions des messages concernés + caches RAM. Best-effort.
async function chatDeleteByUser(userId) {
  const uid = String(userId);
  const ids = new Set(_chatFile.filter(m => String(m.user_id) === uid).map(m => String(m.id)));
  await _chatEnsureDb();
  if (_chatDb) {
    try { const { data } = await supabase.from(CHAT_TABLE).select('id').eq('user_id', uid); (data || []).forEach(r => ids.add(String(r.id))); } catch {}
  }
  let reactChanged = false;
  ids.forEach(id => { if (_reactStore[id]) { delete _reactStore[id]; reactChanged = true; } });   // réactions des messages purgés
  if (reactChanged) _reactSave();
  if (_chatDb) { try { await supabase.from(CHAT_TABLE).delete().eq('user_id', uid); } catch {} }
  _chatFile = _chatFile.filter(m => String(m.user_id) !== uid);
  _chatSaveFile();
  _chatDirty(uid);   // invalide les caches RAM (liste/threads/unread)
}

// Nettoyage ONE-SHOT des messages de comptes DÉJÀ supprimés AVANT l'ajout de la purge complète
// (corrige le symptôme « UUID brut affiché » = message de bienvenue orphelin). Garde-fous : (1) flag KV
// → ne tourne qu'UNE fois ; (2) ensemble « valides » = union getAllUsers + miroir local, et on n'agit
// QUE s'il est sainement peuplé → ne JAMAIS supprimer le chat d'un vrai compte si la liste est incomplète.
async function chatPurgeOrphans() {
  try {
    if (await aiCacheGet('chatorphans:sweptv1', 366 * 86400000)) return;
    const valid = new Set();
    try { (await getAllUsers()).forEach(u => valid.add(String(u.id))); } catch {}
    for (const id of _usersMirrorById.keys()) valid.add(String(id));
    if (valid.size < 10) return;   // liste incomplète (Supabase muet ?) → on ne purge RIEN (sécurité)
    await _chatEnsureDb();
    const chatUids = new Set();
    if (_chatDb) { try { const { data } = await supabase.from(CHAT_TABLE).select('user_id'); (data || []).forEach(r => chatUids.add(String(r.user_id))); } catch {} }
    _chatFile.forEach(m => chatUids.add(String(m.user_id)));
    let purged = 0;
    for (const uid of chatUids) { if (uid && uid !== 'null' && uid !== 'undefined' && !valid.has(uid)) { await chatDeleteByUser(uid); purged++; } }
    await aiCacheSet('chatorphans:sweptv1', Date.now());
    if (purged) console.log(`[Chat] purge orphelins (one-shot) : ${purged} compte(s) supprime(s) nettoye(s)`);
  } catch (e) { console.warn('[Chat] purge orphelins:', e && e.message); }
}
const _orphanSweepT = setTimeout(() => { chatPurgeOrphans(); }, 15000);   // différé : laisse Supabase + miroir se charger
if (_orphanSweepT.unref) _orphanSweepT.unref();

// ── Édition du texte d'un message (admin) ──────────────────────
async function chatUpdate(id, text) {
  _chatDirty(null);   // userId inconnu ici → on invalide tout (rare : action admin)
  await _chatEnsureDb();
  const safe = String(text).slice(0, 2000);
  if (_chatDb) {
    const { data, error } = await supabase.from(CHAT_TABLE).update({ text: safe }).eq('id', id).select().single();
    if (!error) return data;
    if (_chatTableMissing(error)) _chatDb = false; else throw new Error(error.message);
  }
  const m = _chatFile.find(x => String(x.id) === String(id));
  if (m) { m.text = safe; _chatSaveFile(); }
  return m || null;
}

// ── Réactions emoji (👍 ❤️) — toggle par réacteur ───────────
const _CHAT_EMOJIS = ['👍', '❤️'];
function _toggleReaction(reactions, emoji, who) {
  const r = (reactions && typeof reactions === 'object') ? { ...reactions } : {};
  const arr = Array.isArray(r[emoji]) ? r[emoji].slice() : [];
  const i = arr.indexOf(who);
  if (i >= 0) arr.splice(i, 1); else arr.push(who);
  if (arr.length) r[emoji] = arr; else delete r[emoji];
  return r;
}
// UNE seule réaction par personne (façon Instagram) : on retire `who` de partout, puis on
// (re)pose son emoji — sauf s'il cliquait celui qu'il avait déjà (toggle off).
function _setSingleReaction(reactions, emoji, who) {
  const had = Array.isArray((reactions || {})[emoji]) && reactions[emoji].map(String).includes(String(who));
  const r = {};
  for (const [k, arr] of Object.entries(reactions || {})) {
    const filtered = (Array.isArray(arr) ? arr : []).map(String).filter(x => x !== String(who));
    if (filtered.length) r[k] = filtered;
  }
  if (!had) { (r[emoji] = r[emoji] || []).push(String(who)); }
  return r;
}
async function chatReact(id, emoji, who) {
  if (!_CHAT_EMOJIS.includes(emoji) || !who) return null;
  // Store dédié → marche que les messages soient en BDD ou en fichier, sans colonne `reactions`.
  const key = String(id);
  const next = _setSingleReaction(_reactStore[key] || {}, emoji, String(who));
  if (Object.keys(next).length) _reactStore[key] = next; else delete _reactStore[key];
  _reactSave();
  return _reactStore[key] || {};
}

// ── Santé des projets Supabase (panel admin) ─────────────────────────────────────────────────
// Ping LÉGER (HEAD sur ai_cache) de CHAQUE base configurée (principal + db2…db5) → statut
// OK / restreint (402 = quota/égress dépassé) / erreur, + latence. Caché 60 s (≈ mini keep-alive).
let _dbHealthCache = { at: 0, data: null };
let _dbHealthBusy = false;
async function _dbHealthProbe() {
  const _to = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
  const nodes = await Promise.all(_dbNodes.map(async (n) => {
    let host; try { host = new URL(n.url).host; } catch { host = n.url; }
    const t0 = Date.now();
    let status = 0, state = 'erreur', err = '';
    try {
      const r = await _to(n.client.from('ai_cache').select('*', { head: true }), 2500);   // 8s → 2.5s : un projet mort (NXDOMAIN) ne doit pas retenir le panel
      status = r.status || 0;
      if (status === 402) state = 'restreint';
      else if (status >= 200 && status < 300) state = 'ok';
      else if (status === 404 || status === 416) state = 'ok';     // projet vivant, table vide/absente
      else if (r.error) err = String(r.error.message || r.error).slice(0, 90);
    } catch (e) { err = (e && e.message ? e.message : String(e)).slice(0, 90); }
    /* `quarLect` REMONTE JUSQU AU PANNEAU ADMIN (02/09). Une base peut repondre « ok » a cette sonde
       tout en etant ecartee des lectures de `users` parce qu elle est en retard — c est meme l etat
       normal des premieres minutes apres son retour. Sans ce champ, le panneau afficherait « OK » et
       laisserait croire que tout est rentre dans l ordre alors que la resynchronisation court encore. */
    return { name: n.name, host, state, status, ms: Date.now() - t0, downUntil: n.downUntil > Date.now() ? n.downUntil : 0, quarLect: !!n.quarLect, err };
  }));
  const data = { count: nodes.length, okCount: nodes.filter(n => n.state === 'ok').length, nodes, keepalive: { last: _kaLast, ok: _kaOk } };
  _dbHealthCache = { at: Date.now(), data };
  return data;
}
async function dbHealth(maxAgeMs = 60000) {
  // STALE-WHILE-REVALIDATE (perf IA Monitor) : cache frais → direct ; cache périmé → on le sert
  // IMMÉDIATEMENT et on re-sonde en arrière-plan (single-flight) ; le panel n'attend plus les sondes.
  if (_dbHealthCache.data && Date.now() - _dbHealthCache.at < maxAgeMs) return _dbHealthCache.data;
  if (_dbHealthCache.data) {
    if (!_dbHealthBusy) { _dbHealthBusy = true; _dbHealthProbe().catch(() => {}).finally(() => { _dbHealthBusy = false; }); }
    return _dbHealthCache.data;
  }
  if (_dbHealthBusy) return { count: _dbNodes.length, okCount: 0, nodes: [], keepalive: { last: _kaLast, ok: _kaOk }, pending: true };
  _dbHealthBusy = true;
  try { return await _dbHealthProbe(); } finally { _dbHealthBusy = false; }
}
setTimeout(() => { dbHealth().catch(() => {}); }, 15000);   // préchauffe au boot → même la 1re ouverture du panel est instantanée

module.exports = {
  isStaff,
  seedAdmin,
  verifyLogin,
  getAllUsers,
  getUserById,
  createUser,
  isEmailBlacklisted,
  blacklistEmail,
  unblacklistEmail,
  listBlacklist,
  changePassword,
  updateUser,
  deleteUser,
  chatInsert,
  chatList,
  chatMarkRead,
  chatUnread,
  chatThreads,
  chatDelete,
  chatDeleteByUser,
  chatPurgeOrphans,
  chatUpdate,
  chatReact,
  weeklyReportSave,
  weeklyReportList,
  emailLogHas,
  emailLogHasMany,
  emailLogAdd,
  emailLogDel,
  estUnsubPermanent,
  emailLogAll,
  emailLogAllDurable,
  aiCacheGet,
  aiCacheSet,
  aiCacheDel,
  aiCacheDelPrefix,
  aiCachePrune,
  getEgressStats,
  dbHealth,
  getKeepAliveStatus,
  _keepAlive,   // exposé pour un déclenchement manuel (admin) si besoin
};

// ═══════════════════ PERSISTANCE RAPPORTS HEBDO (Weekly Recap) ═══════════════════
// But : un recap généré (coûteux en requêtes Gemini) est conservé durablement → après un
// redémarrage Render (disque éphémère), on le RECHARGE au lieu de le RÉGÉNÉRER.
// Même pattern que le chat : Supabase `weekly_reports` + fallback fichier + auto-récupération.
const WEEKLY_TABLE = 'weekly_reports';
const WEEKLY_FILE  = path.join(__dirname, 'cache_weekly.json');
let _weeklyDb = true;
let _weeklyFile = [];
try { _weeklyFile = JSON.parse(fs.readFileSync(WEEKLY_FILE, 'utf8')) || []; } catch {}
function _weeklySaveFile() { try { fs.writeFileSync(WEEKLY_FILE, JSON.stringify(_weeklyFile)); } catch {} }
function _weeklyTableMissing(err) { return err && /weekly_reports|schema cache|does not exist|relation/i.test(err.message); }

let _weeklyProbeTs = 0;
async function _weeklyEnsureDb() {
  if (_weeklyDb) return;
  const now = Date.now();
  if (now - _weeklyProbeTs < 30000) return;
  _weeklyProbeTs = now;
  const { error } = await supabase.from(WEEKLY_TABLE).select('week_key').limit(1);
  if (error) return;
  _weeklyDb = true;
  if (_weeklyFile.length) {
    const rows = _weeklyFile.map(r => ({ week_key: r.week_key, report: r.report, created_at: r.created_at }));
    const { error: insErr } = await supabase.from(WEEKLY_TABLE).upsert(rows, { onConflict: 'week_key' });
    if (!insErr) { _weeklyFile = []; _weeklySaveFile(); console.log(`[Weekly] table détectée → ${rows.length} rapport(s) migré(s) en BDD`); }
    else _weeklyDb = false;
  }
}

async function weeklyReportSave(weekKey, report) {
  await _weeklyEnsureDb();
  const row = { week_key: String(weekKey), report, created_at: new Date().toISOString() };
  if (_weeklyDb) {
    const { error } = await supabase.from(WEEKLY_TABLE).upsert([row], { onConflict: 'week_key' });
    if (!error) return;
    if (_weeklyTableMissing(error)) _weeklyDb = false; else throw new Error(error.message);
  }
  _weeklyFile = _weeklyFile.filter(r => r.week_key !== String(weekKey));
  _weeklyFile.push(row);
  if (_weeklyFile.length > 60) _weeklyFile = _weeklyFile.slice(-60);
  _weeklySaveFile();
}

// `complet` : chargement INTÉGRAL des 3 mois d'historique (demande user 05/08 « on doit conserver
// 3 mois de rapports »). Réservé au BOOT. Les rechargements périodiques gardent la petite fenêtre :
// une fois le serveur démarré, l'historique est déjà en mémoire et il n'y a que les rapports NOUVEAUX
// à récupérer — relire 170 lignes toutes les 30 s coûterait de l'egress pour rien, et l'egress est
// précisément ce qui a déjà mis ce projet à terre une fois.
async function weeklyReportList(complet = false) {
  const NB_HEBDO = complet ? 30 : 20;    // 13 semaines x 2 types (Weekly Recap + GEW), marge comprise
  const NB_QUOTI = complet ? 190 : 14;   // 3 mois PLEINS de quotidiens : ~65 jours ouvres x 2 types (FX Daily
                                         // + DTP Daily) = 130, plus une vraie marge (versions en double avant
                                         // _dedupRecaps, regen forcee un week-end) — 140 ne laissait que 10.
  await _weeklyEnsureDb();
  if (_weeklyDb) {
    // Les rapports HEBDO (Weekly Recap + GEW, clés "YYYY-Www" / "gew-...") étaient ÉVINCÉS de la fenêtre de reload
    // par les rapports QUOTIDIENS (fxr-/dtpd-, ~12/sem.) → « rapports du mois dernier manquants » (demande user).
    // On les récupère SÉPARÉMENT : ~10 semaines d'hebdo + ~2 semaines de quotidiens récents. ANTI-EGRESS : uniquement
    // la colonne `report` (jamais select('*')). ~34 lignes max, seulement au boot + reload throttlé 30 s.
    const [wk, dy] = await Promise.all([
      supabase.from(WEEKLY_TABLE).select('report').order('created_at', { ascending: false }).not('week_key', 'ilike', 'fxr-%').not('week_key', 'ilike', 'dtpd-%').limit(NB_HEBDO),
      supabase.from(WEEKLY_TABLE).select('report').order('created_at', { ascending: false }).or('week_key.ilike.fxr-%,week_key.ilike.dtpd-%').limit(NB_QUOTI),
    ]);
    const err = wk.error || dy.error;
    if (!err) return [...(wk.data || []), ...(dy.data || [])].map(r => r.report).filter(Boolean);
    if (_weeklyTableMissing(err)) _weeklyDb = false; else throw new Error(err.message);
  }
  return [..._weeklyFile].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, NB_HEBDO + NB_QUOTI).map(r => r.report).filter(Boolean);
}

// ═══════════════════ JOURNAL D'EMAILS (anti-doublon durable) ═══════════════════
// But : ne jamais renvoyer deux fois un email "campagne" (ex. incitation fin d'essai),
// même après un redémarrage Render. Même pattern que weekly : table `email_log`
// (key text PK + sent_at) + fallback fichier + auto-récupération.
const EMAILLOG_TABLE = 'email_log';
// Fichier de repli de l'anti-doublon : DOIT survivre aux redémarrages du conteneur Docker, sinon
// chaque restart ré-arme l'envoi (→ spam). En Docker, DATA_DIR pointe vers un volume persistant.
// (_DATA_DIR déjà déclaré en tête — partagé avec le miroir des comptes.)
const EMAILLOG_FILE  = path.join(_DATA_DIR, 'cache_email_log.json');
let _emailDb = true;
let _emailFile = {};   // { key: sent_at_iso }
try { _emailFile = JSON.parse(fs.readFileSync(EMAILLOG_FILE, 'utf8')) || {}; } catch {}
function _emailSaveFile() { try { fs.writeFileSync(EMAILLOG_FILE, JSON.stringify(_emailFile)); } catch {} }
function _emailTableMissing(err) { return err && /email_log|schema cache|does not exist|relation/i.test(err.message); }
let _emailProbeTs = 0;
async function _emailEnsureDb() {
  if (_emailDb) return;
  const now = Date.now();
  if (now - _emailProbeTs < 30000) return;
  _emailProbeTs = now;
  const { error } = await supabase.from(EMAILLOG_TABLE).select('key').limit(1);
  if (error) return;
  _emailDb = true;
  const keys = Object.keys(_emailFile);
  if (keys.length) {
    const rows = keys.map(k => ({ key: k, sent_at: _emailFile[k] }));
    const { error: insErr } = await supabase.from(EMAILLOG_TABLE).upsert(rows, { onConflict: 'key' });
    if (!insErr) { console.log(`[EmailLog] table détectée → ${rows.length} entrée(s) migrée(s) en BDD (fichier conservé comme backstop anti-spam)`); }
    else _emailDb = false;
  }
}
async function emailLogHas(key) {
  const k = String(key);
  // Backstop LOCAL en premier (fichier sur volume persistant) : si l'envoi est déjà loggé, on ne
  // renvoie JAMAIS le mail — même si Supabase est indisponible/hoquette. Anti-spam ultime.
  if (Object.prototype.hasOwnProperty.call(_emailFile, k)) return true;
  await _emailEnsureDb();
  if (_emailDb) {
    const { data, error } = await supabase.from(EMAILLOG_TABLE).select('key').eq('key', k).limit(1);
    if (!error) return !!(data && data.length);
    if (_emailTableMissing(error)) _emailDb = false;
    // Autre erreur Supabase : on NE lève PAS (sinon l'appelant pourrait re-tenter l'envoi). On
    // retourne "non loggé" ; l'emailLogAdd qui suit l'envoi écrira de toute façon le backstop local.
  }
  return false;
}
// Lecture GROUPÉE du journal d'envois, pour le MODE BLANC des diffusions de masse.
// ⚠️ DÉLIBÉRÉMENT DIFFÉRENTE d'emailLogHas : ici une erreur Supabase LÈVE au lieu de retourner
// false. emailLogHas absorbe l'erreur pour ne jamais bloquer un envoi unitaire (le backstop local
// rattrape) ; en MASSE, un false erroné ferait annoncer « à envoyer » des centaines de contacts
// déjà servis. Le mode blanc préfère répondre « mesure indisponible » que mentir.
async function emailLogHasMany(keys) {
  const uniq = [...new Set((keys || []).map(k => String(k)))];
  const out = {};
  const manquantes = [];
  for (const k of uniq) {
    if (Object.prototype.hasOwnProperty.call(_emailFile, k)) out[k] = true;
    else manquantes.push(k);
  }
  await _emailEnsureDb();
  if (!_emailDb) return out;   // table absente : le fichier local est la seule vérité disponible
  for (let i = 0; i < manquantes.length; i += 200) {
    const lot = manquantes.slice(i, i + 200);
    const { data, error } = await supabase.from(EMAILLOG_TABLE).select('key').in('key', lot);
    if (error) throw new Error('email_log inaccessible : ' + error.message);
    (data || []).forEach(r => { out[r.key] = true; });
  }
  return out;
}
async function emailLogAdd(key) {
  const k = String(key);
  const sent_at = new Date().toISOString();
  // 1) TOUJOURS écrire le backstop local EN PREMIER (fichier sur volume) → la clé est persistée
  //    même si Supabase échoue → garantit « 1 seul envoi », redémarrages/déploiements inclus.
  _emailFile[k] = sent_at; _emailSaveFile();
  // 2) Best-effort Supabase (durabilité multi-instances) — n'interrompt jamais, ne lève jamais.
  try {
    await _emailEnsureDb();
    if (_emailDb) {
      const { error } = await supabase.from(EMAILLOG_TABLE).upsert([{ key: k, sent_at }], { onConflict: 'key' });
      if (error && _emailTableMissing(error)) _emailDb = false;
    }
  } catch {}
}

// RETRAIT d'une clé du journal — VOLONTAIREMENT LIMITÉ AUX MARQUEURS « unsub: ».
// ⚠️ Ce journal n'est pas qu'une liste de désinscrits : c'est AUSSI la garde anti-doublon des
// envois (« ce mail a déjà été envoyé à cette adresse »). Supprimer une clé quelconque ferait
// donc RENVOYER un mail déjà parti. Le garde ci-dessous n'est pas une précaution de style : il
// est ce qui empêche qu'un bouton « réabonner » du panneau ne réexpédie une campagne entière.
async function emailLogDel(key) {
  const k = String(key);
  if (!k.startsWith('unsub:')) throw new Error('emailLogDel refuse une clé hors « unsub: » (garde anti-doublon)');
  delete _emailFile[k]; _emailSaveFile();
  try {
    await _emailEnsureDb();
    if (_emailDb) {
      const { error } = await supabase.from(EMAILLOG_TABLE).delete().eq('key', k);
      if (error && _emailTableMissing(error)) _emailDb = false;
    }
  } catch {}
}
/* CE CONTACT FAIT-IL PARTIE DU SEED D'ORIGINE ? (renseigne l'écran admin ; ne bloque plus rien)
   ⚠️ 04/09, demande user : « je dois pouvoir désinscrire et réinscrire moi-même ». Cette fonction
   servait à INTERDIRE le réabonnement, et elle avait raison de le faire tant que le seed se
   réappliquait à chaque démarrage : le panneau aurait annoncé un succès que le redémarrage suivant
   aurait démenti, sans un mot. C'est le SEED qu'on a corrigé (il ne s'applique plus qu'une fois,
   voir `_ensurePermanentUnsub`), pas l'écran : maintenant qu'un réabonnement TIENT, il n'y a plus
   aucune raison de le refuser. La fonction ne sert donc plus qu'à afficher d'où vient la
   désinscription. */
function estUnsubPermanent(email) {
  return _PERMANENT_UNSUB_SEED.includes(String(email || '').toLowerCase().trim());
}

/* ── JOURNAL COMPLET **DURABLE** (04/09) ──────────────────────────────────────────────────────────
   ⚠️ DÉFAUT TROUVÉ EN PRODUCTION, capture user à l'appui : le mode blanc d'une campagne listait
   trois « desabonne » que l'écran des désinscrits ne montrait pas. Les deux lisent pourtant le même
   journal — mais PAS AU MÊME ENDROIT.
   `_emailFile` est le backstop écrit sur DISQUE. Or le disque de Render est ÉPHÉMÈRE : à chaque
   redéploiement, et à chaque réveil après mise en veille, il repart VIDE. Il ne se remplit ensuite
   que des écritures nouvelles. La table Supabase, elle, garde tout — et `_emailEnsureDb` ne fait
   que pousser le fichier VERS elle, jamais l'inverse.
   Conséquence : `emailLogAll()` ne renvoie qu'un fragment, souvent vide le lendemain d'un déploiement.
   Le mode blanc, lui, passe par `emailLogHasMany`, qui interroge Supabase clé par clé — d'où l'écart.
   Cette lecture-ci va chercher la table entière, la fusionne avec le fichier, et DIT si elle a
   réussi. `complet: false` n'est pas un détail d'implémentation : un écran qui affiche « aucun
   désinscrit » alors que la mesure a échoué ferait conclure que toute la base reçoit les mails. */
let _emailAllCache = null, _emailAllAt = 0;
async function emailLogAllDurable(maxAgeMs) {
  const frais = Number.isFinite(maxAgeMs) ? maxAgeMs : 30000;
  if (_emailAllCache && Date.now() - _emailAllAt < frais) return _emailAllCache;
  const all = Object.assign({}, _emailFile);
  let complet = false, source = 'fichier';
  await _emailEnsureDb();
  if (_emailDb) {
    try {
      const PAS = 1000;
      for (let d = 0; ; d += PAS) {
        const { data, error } = await supabase.from(EMAILLOG_TABLE).select('key,sent_at').range(d, d + PAS - 1);
        if (error) throw new Error(error.message);
        for (const r of (data || [])) if (!Object.prototype.hasOwnProperty.call(all, r.key)) all[r.key] = r.sent_at;
        if (!data || data.length < PAS) break;
      }
      complet = true; source = 'supabase+fichier';
    } catch (e) {
      console.warn('[EmailLog] lecture complète impossible :', e.message);
    }
  }
  _emailAllCache = { all, complet, source, n: Object.keys(all).length };
  _emailAllAt = Date.now();
  return _emailAllCache;
}

// Journal COMPLET { clé → date d'envoi ISO } pour l'écran « Journal des envois » du panel admin.
// Le fichier local est le backstop écrit à CHAQUE envoi (avant Supabase) → il est complet par
// construction ; on retourne une COPIE (l'appelant ne doit pas pouvoir muter l'anti-doublon).
function emailLogAll() { return Object.assign({}, _emailFile); }

// ═══════════════════ OPT-OUT E-MAIL PERMANENTS (désinscrits durs) ═══════════════════
// Désinscrits que l'on ne doit JAMAIS re-contacter (contrainte utilisateur absolue). Même
// philosophie que _BLACKLIST_SEED (login) mais côté E-MAIL : on ne bannit PAS le login, on
// pose seulement le marqueur unsub: → jamais aucune campagne (audience + boucle d'envoi filtrent
// via emailLogHas). Seed VERSIONNÉ dans le code → s'auto-répare au boot même après perte totale
// d'infra (volume ET Supabase). Idempotent : ne réécrit pas si le marqueur existe déjà.
const _PERMANENT_UNSUB_SEED = ['darcos2012@gmail.com', 'robbyone31@gmail.com'];
/* LE SEED S'APPLIQUE UNE FOIS, PAS À CHAQUE DÉMARRAGE (04/09).
   Il se réappliquait sans condition toutes les vingt secondes après le boot. Conséquence, jamais
   écrite nulle part mais bien réelle : un réabonnement fait depuis le panneau tenait jusqu'au
   prochain redémarrage de Render — c'est-à-dire au plus quinze minutes d'inactivité — puis
   disparaissait en silence. L'admin voyait « ✓ réabonné », et le lendemain le contact était de
   nouveau désinscrit sans que rien ne l'explique.
   On pose donc un marqueur d'application PAR ADRESSE. Le seed garde son rôle d'origine — rétablir
   l'intention après une perte TOTALE d'infrastructure, volume et Supabase compris — mais il ne
   repasse plus par-dessus une décision prise après lui. Le marqueur vit dans le même journal
   durable que le reste, donc il survit exactement aussi bien que ce qu'il protège.
   ⚠️ `unsubseed:` n'est PAS un préfixe « unsub: » : emailLogDel refuse tout ce qui n'est pas
   « unsub: », donc ce marqueur ne peut pas être effacé par le bouton de réabonnement. C'est
   précisément ce qu'on veut — sinon le seed se réappliquerait au démarrage suivant. */
async function _ensurePermanentUnsub() {
  for (const e of _PERMANENT_UNSUB_SEED) {
    const em = String(e || '').toLowerCase().trim(); if (!em) continue;
    try {
      if (await emailLogHas('unsubseed:' + em)) continue;              // deja applique une fois
      await emailLogAdd('unsubseed:' + em);
      if (!(await emailLogHas('unsub:' + em))) { await emailLogAdd('unsub:' + em); console.log('[Unsub seed] appliqué (une seule fois) →', em); }
    } catch {}
  }
}
setTimeout(() => { _ensurePermanentUnsub().catch(() => {}); }, 20 * 1000);   // après amorçage Supabase

// ═══════════════════ CACHE IA DURABLE (anti-régénération / anti-doublon) ═══════════════════
// But : un résultat IA déjà calculé (AI Insights d'un rapport, etc.) est conservé en BDD →
// après un redémarrage Render (disque éphémère) on le RECHARGE au lieu de rappeler l'IA.
// Même pattern que weekly/email_log : table `ai_cache` (key PK + value jsonb) + fallback fichier.
const AICACHE_TABLE = 'ai_cache';
const AICACHE_FILE  = path.join(__dirname, 'cache_ai_store.json');
let _aiCacheDb = true;
let _aiCacheFile = {};   // { key: value } (repli disque)
try { _aiCacheFile = JSON.parse(fs.readFileSync(AICACHE_FILE, 'utf8')) || {}; } catch {}
let _aiCacheSaveTimer = null;
function _aiCacheSaveFile() {
  clearTimeout(_aiCacheSaveTimer);
  _aiCacheSaveTimer = setTimeout(() => { try { fs.writeFileSync(AICACHE_FILE, JSON.stringify(_aiCacheFile)); } catch {} }, 1500);
  if (_aiCacheSaveTimer.unref) _aiCacheSaveTimer.unref();
}

// ══ CACHE MÉMOIRE en amont de Supabase (ANTI-EGRESS / anti-quota) ══════════════════════════════
// L'app tourne en INSTANCE UNIQUE (1 conteneur Node) → la RAM fait autorité une fois chargée.
// On lit Supabase au PLUS une fois par clé, puis on sert la mémoire ; chaque aiCacheSet met aussi
// la RAM à jour → cohérence totale SANS relire la BDD. Effet : la bande passante de sortie
// (egress, ce qui déclenche le mail de quota Supabase) chute drastiquement car les boucles de
// fond (news, FX, session wraps…) qui tournent 24/7 ne retéléchargent plus les gros objets JSON.
const _aiMem = new Map();                       // key -> { v: value, ts: epoch_ms }
const AICACHE_MEM_TTL = 6 * 60 * 60 * 1000;     // refresh de sécurité (6 h) ; instance unique → quasi jamais atteint
const AICACHE_MEM_MAX = 4000;                   // garde-fou RAM (éviction des plus anciennes au-delà)
function _aiMemSet(k, v) {
  _aiMem.set(k, { v, ts: Date.now() });
  if (_aiMem.size > AICACHE_MEM_MAX) { let n = _aiMem.size - AICACHE_MEM_MAX + 200; for (const key of _aiMem.keys()) { if (n-- <= 0) break; _aiMem.delete(key); } }
}
// Circuit-breaker : si Supabase renvoie une erreur (quota / restriction « fair use » / réseau),
// on cesse de le solliciter pendant un cooldown → l'app sert RAM+fichier et NE CASSE JAMAIS.
let _aiCacheCooldownUntil = 0;
function _aiSupabaseDown() { return Date.now() < _aiCacheCooldownUntil || _egTripped(); }
function _aiTripBreaker(err) {
  if (!_aiSupabaseDown()) console.warn('[AICache] Supabase indisponible/quota → repli mémoire+fichier 10 min :', err && err.message);
  _aiCacheCooldownUntil = Date.now() + 10 * 60 * 1000;
}

function _aiCacheTableMissing(err) { return err && /ai_cache|schema cache|does not exist|relation/i.test(err.message); }
let _aiCacheProbeTs = 0;
async function _aiCacheEnsureDb() {
  if (_aiCacheDb) return;
  const now = Date.now();
  if (now - _aiCacheProbeTs < 30000) return;
  _aiCacheProbeTs = now;
  try { const { error } = await supabase.from(AICACHE_TABLE).select('key').limit(1); if (error) return; } catch { return; }
  _aiCacheDb = true;
  const keys = Object.keys(_aiCacheFile);
  if (keys.length) {
    const rows = keys.map(k => ({ key: k, value: _aiCacheFile[k], created_at: new Date().toISOString() }));   // touch cohérent avec aiCacheSet (sinon purge prématurée possible)
    const { error: insErr } = await supabase.from(AICACHE_TABLE).upsert(rows, { onConflict: 'key' });
    if (!insErr) { _aiCacheFile = {}; _aiCacheSaveFile(); console.log(`[AICache] table détectée → ${rows.length} entrée(s) migrée(s) en BDD`); }
    else _aiCacheDb = false;
  }
}
async function aiCacheGet(key, maxAge = AICACHE_MEM_TTL) {
  const k = String(key);
  // 1) RAM fraîche → ZÉRO egress (cas ultra-majoritaire).
  const m = _aiMem.get(k);
  if (m && (Date.now() - m.ts) < maxAge) return m.v;
  // 2) Supabase en cooldown (quota/restriction) → repli RAM périmée puis fichier, sans réseau.
  if (_aiSupabaseDown()) {
    if (m) return m.v;
    return Object.prototype.hasOwnProperty.call(_aiCacheFile, k) ? _aiCacheFile[k] : null;
  }
  // 3) Lecture BDD (au plus une fois par clé), puis on mémorise.
  await _aiCacheEnsureDb();
  if (_aiCacheDb) {
    try {
      // `created_at` est ramené POUR ÊTRE ARBITRÉ (_lireFraicheur) : sans lui, deux bases qui portent
      // deux versions de la même clé sont départagées par le hasard du tour de rôle.
      const { data, error } = await supabase.from(AICACHE_TABLE).select('value, created_at').eq('key', k).limit(1);
      if (!error) { const v = (data && data[0]) ? data[0].value : null; _aiMemSet(k, v); return v; }
      if (_aiCacheTableMissing(error)) _aiCacheDb = false; else { _aiTripBreaker(error); if (m) return m.v; }
    } catch (e) { _aiTripBreaker(e); if (m) return m.v; }
  }
  return Object.prototype.hasOwnProperty.call(_aiCacheFile, k) ? _aiCacheFile[k] : null;
}
async function aiCacheSet(key, value) {
  const k = String(key);
  _aiMemSet(k, value);   // RAM à jour AVANT le réseau → toutes les lectures suivantes = 0 egress
  if (_aiSupabaseDown()) { _aiCacheFile[k] = value; _aiCacheSaveFile(); return; }
  await _aiCacheEnsureDb();
  if (_aiCacheDb) {
    try {
      const { error } = await supabase.from(AICACHE_TABLE).upsert([{ key: k, value, created_at: new Date().toISOString() }], { onConflict: 'key' });
      if (!error) return;
      if (_aiCacheTableMissing(error)) _aiCacheDb = false; else { _aiTripBreaker(error); _aiCacheFile[k] = value; _aiCacheSaveFile(); return; }
    } catch (e) { _aiTripBreaker(e); _aiCacheFile[k] = value; _aiCacheSaveFile(); return; }
  }
  _aiCacheFile[k] = value;
  _aiCacheSaveFile();
}
// Suppression d'UNE clé KV exacte (RAM + fichier + Supabase). Best-effort.
async function aiCacheDel(key) {
  const k = String(key);
  _aiMem.delete(k);
  if (Object.prototype.hasOwnProperty.call(_aiCacheFile, k)) { delete _aiCacheFile[k]; _aiCacheSaveFile(); }
  if (_aiSupabaseDown()) return;
  await _aiCacheEnsureDb();
  if (_aiCacheDb) { try { await supabase.from(AICACHE_TABLE).delete().eq('key', k); } catch {} }
}
// Suppression de TOUTES les clés KV commençant par `prefix` (RAM + fichier + Supabase). Best-effort.
async function aiCacheDelPrefix(prefix) {
  const p = String(prefix);
  for (const k of [..._aiMem.keys()]) if (k.startsWith(p)) _aiMem.delete(k);
  let fileChanged = false;
  for (const k of Object.keys(_aiCacheFile)) if (k.startsWith(p)) { delete _aiCacheFile[k]; fileChanged = true; }
  if (fileChanged) _aiCacheSaveFile();
  if (_aiSupabaseDown()) return;
  await _aiCacheEnsureDb();
  if (_aiCacheDb) { try { await supabase.from(AICACHE_TABLE).delete().like('key', p + '%'); } catch {} }
}
// Purge des entrées plus vieilles que maxAgeMs (rétention "max 1 mois").
// ⚠️ FILTRÉE PAR PRÉFIXE : la table est devenue un KV générique — à côté des caches IA
// régénérables, elle stocke des données MÉTIER irremplaçables (referredby:/refbonus: = verrous
// parrainage écrits UNE fois, symrecent:, rates:state, aiusage:…). L'ancienne purge globale les
// effaçait après 31 j → on ne purge plus QUE les préfixes de cache IA explicitement listés.
const AICACHE_PRUNABLE = ['swseg:', 'brseg:', 'ins:', 'swt2:', 'ana:', 'tag:', 'aichat:', 'hist:'];
async function aiCachePrune(maxAgeMs) {
  await _aiCacheEnsureDb();
  if (!_aiCacheDb) return;   // mode fichier : pas d'horodatage par clé, fichier déjà petit/éphémère
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  try {
    const orFilter = AICACHE_PRUNABLE.map(p => `key.like.${p}%`).join(',');
    const { error } = await supabase.from(AICACHE_TABLE).delete().lt('created_at', cutoff).or(orFilter);
    if (!error) console.log('[AICache] purge (préfixes IA uniquement) des entrées > rétention effectuée');
  } catch {}
}

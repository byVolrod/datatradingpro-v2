/**
 * auth.js — Authentication & User Management
 * Backend: Supabase Postgres  |  Passwords: bcrypt
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;
const SALT_ROUNDS   = 12;
const TABLE         = 'users';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[Auth] ❌ SUPABASE_URL / SUPABASE_KEY manquants dans .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },   // server-side — pas de session Supabase côté client
});

console.log('[Auth] ✅ Supabase connecté →', SUPABASE_URL);

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
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('email', (email || '').toLowerCase().trim())
    .single();

  if (error || !data) return null;

  const ok = await bcrypt.compare(password, data.password_hash);
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

  // Mettre à jour last_login en background
  supabase.from(TABLE).update({ last_login: new Date().toISOString() }).eq('id', data.id).then(() => {});

  return { id: data.id, email: data.email, name: data.name, role: data.role, plan: data.plan, active: !!data.active, expiresAt: data.expires_at || null };
}

// ─── CRUD utilisateurs ────────────────────────────────────────────────────────
// Cache mémoire COURT (10 s) : getAllUsers est appelé par les jobs de fond (trial/reengagement/expiry)
// + l'inbox support → on évite de répéter un full-scan. Les écritures invalident via _bustUsersCache().
let _allUsersCache = { ts: 0, data: null };
function _bustUsersCache() { _allUsersCache = { ts: 0, data: null }; }
async function getAllUsers(opts = {}) {
  if (!opts.fresh && _allUsersCache.data && Date.now() - _allUsersCache.ts < 10000) return _allUsersCache.data;
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, email, name, role, plan, active, created_at, last_login, expires_at')
    .order('created_at', { ascending: false });

  // Tolérance : si la colonne expires_at n'a pas encore été ajoutée, on réessaie sans
  if (error && /expires_at/.test(error.message)) {
    const fallback = await supabase
      .from(TABLE)
      .select('id, email, name, role, plan, active, created_at, last_login')
      .order('created_at', { ascending: false });
    if (fallback.error) throw new Error(fallback.error.message);
    _allUsersCache = { ts: Date.now(), data: fallback.data || [] };
    return _allUsersCache.data;
  }
  if (error) throw new Error(error.message);
  _allUsersCache = { ts: Date.now(), data: data || [] };
  return _allUsersCache.data;
}

async function getUserById(id) {
  let { data, error } = await supabase
    .from(TABLE)
    .select('id, email, name, role, plan, active, created_at, expires_at')
    .eq('id', id)
    .single();
  // Tolérance si les colonnes created_at/expires_at n'existent pas encore
  if (error && /(expires_at|created_at)/.test(error.message || '')) {
    ({ data } = await supabase.from(TABLE).select('id, email, name, role, plan, active').eq('id', id).single());
  }
  return data || null;
}

async function createUser({ email, password, name = '', role = 'client', plan = 'professionnel', expiresAt = null }) {
  if (!email || !password) throw new Error('Email et mot de passe requis');
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  const row = { email: email.toLowerCase().trim(), password_hash: hash, name, role, plan, active: true, expires_at: expiresAt || null };
  let { data, error } = await supabase.from(TABLE).insert([row]).select().single();

  // Tolérance : si la colonne expires_at n'existe pas encore, on crée sans (abonnement non enregistré)
  if (error && /expires_at/.test(error.message)) {
    delete row.expires_at;
    ({ data, error } = await supabase.from(TABLE).insert([row]).select().single());
  }
  if (error) {
    if (/duplicate|already exists|users_email_key|unique/i.test(error.message)) {
      throw new Error('Cet email est déjà utilisé par un autre compte.');
    }
    throw new Error(error.message);
  }
  return data;
}

async function changePassword(id, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new Error('Mot de passe trop court (min 6 caractères)');
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const { error } = await supabase.from(TABLE).update({ password_hash: hash }).eq('id', id);
  if (error) throw new Error(error.message);
}

async function updateUser(id, fields = {}) {
  const upd = {};
  if ('name'   in fields) upd.name   = fields.name || '';
  if ('role'   in fields) upd.role   = fields.role || 'client';
  if ('plan'   in fields) upd.plan   = fields.plan || 'professionnel';
  if ('active' in fields) upd.active = fields.active === 1 || fields.active === true || fields.active === '1';
  if ('expiresAt' in fields) upd.expires_at = fields.expiresAt || null;
  if (Object.keys(upd).length === 0) return;
  let { error } = await supabase.from(TABLE).update(upd).eq('id', id);
  // Tolérance : colonne expires_at absente → on réessaie sans
  if (error && /expires_at/.test(error.message)) {
    delete upd.expires_at;
    if (Object.keys(upd).length === 0) return;
    ({ error } = await supabase.from(TABLE).update(upd).eq('id', id));
  }
  if (error) throw new Error(error.message);
}

async function deleteUser(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ═══════════════════ CHAT SUPPORT (persistant) ═══════════════════
// Table Supabase `chat_messages` ; fallback fichier local si la table n'existe pas encore.
const fs = require('fs');
const path = require('path');
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
function _reactSave() { try { fs.writeFileSync(REACT_FILE, JSON.stringify(_reactStore)); } catch {} }
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

async function chatInsert({ user_id, sender, text }) {
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
  await _chatEnsureDb();
  let rows = null;
  if (_chatDb) {
    const { data, error } = await supabase.from(CHAT_TABLE).select('*').eq('user_id', String(userId)).order('created_at', { ascending: true });
    if (!error) rows = data || [];
    else if (_chatTableMissing(error)) _chatDb = false; else throw new Error(error.message);
  }
  if (rows == null) rows = _chatFile.filter(m => m.user_id === String(userId)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  rows.forEach(m => { const r = _reactStore[String(m.id)]; if (r) m.reactions = r; });   // overlay réactions
  return rows;
}

// Marque comme lus les messages reçus par `recipient` ('user' lit le support, 'support' lit l'user)
async function chatMarkRead(userId, recipientReadsFrom) {
  await _chatEnsureDb();
  if (_chatDb) {
    const { error } = await supabase.from(CHAT_TABLE).update({ read: true }).eq('user_id', String(userId)).eq('sender', recipientReadsFrom).eq('read', false);
    if (!error) return;
    if (_chatTableMissing(error)) _chatDb = false; else return;
  }
  _chatFile.forEach(m => { if (m.user_id === String(userId) && m.sender === recipientReadsFrom) m.read = true; });
  _chatSaveFile();
}

// Nombre de messages non lus envoyés par `fromSender` à l'utilisateur
async function chatUnread(userId, fromSender) {
  await _chatEnsureDb();
  if (_chatDb) {
    const { count, error } = await supabase.from(CHAT_TABLE).select('id', { count: 'exact', head: true }).eq('user_id', String(userId)).eq('sender', fromSender).eq('read', false);
    if (!error) return count || 0;
    if (_chatTableMissing(error)) _chatDb = false; else return 0;
  }
  return _chatFile.filter(m => m.user_id === String(userId) && m.sender === fromSender && !m.read).length;
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
// OPTIMISÉ : on ne télécharge PLUS toute la table (avec les images base64) juste pour
// un aperçu + le compteur de non-lus.
//   1) méta SANS le champ `text` → dates + non-lus de TOUS les threads (rapide, léger)
//   2) seulement les messages RÉCENTS avec `text` → aperçu des conversations actives
async function chatThreads() {
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
  return [...byUser.values()];
}

// ── Suppression d'un message (admin) ──────────────────────────
async function chatDelete(id) {
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

// ── Édition du texte d'un message (admin) ──────────────────────
async function chatUpdate(id, text) {
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

module.exports = {
  isStaff,
  seedAdmin,
  verifyLogin,
  getAllUsers,
  getUserById,
  createUser,
  changePassword,
  updateUser,
  deleteUser,
  chatInsert,
  chatList,
  chatMarkRead,
  chatUnread,
  chatThreads,
  chatDelete,
  chatUpdate,
  chatReact,
  weeklyReportSave,
  weeklyReportList,
  emailLogHas,
  emailLogAdd,
  aiCacheGet,
  aiCacheSet,
  aiCachePrune,
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

async function weeklyReportList() {
  await _weeklyEnsureDb();
  if (_weeklyDb) {
    const { data, error } = await supabase.from(WEEKLY_TABLE).select('*').order('created_at', { ascending: false });
    if (!error) return (data || []).map(r => r.report).filter(Boolean);
    if (_weeklyTableMissing(error)) _weeklyDb = false; else throw new Error(error.message);
  }
  return [..._weeklyFile].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(r => r.report).filter(Boolean);
}

// ═══════════════════ JOURNAL D'EMAILS (anti-doublon durable) ═══════════════════
// But : ne jamais renvoyer deux fois un email "campagne" (ex. incitation fin d'essai),
// même après un redémarrage Render. Même pattern que weekly : table `email_log`
// (key text PK + sent_at) + fallback fichier + auto-récupération.
const EMAILLOG_TABLE = 'email_log';
// Fichier de repli de l'anti-doublon : DOIT survivre aux redémarrages du conteneur Docker, sinon
// chaque restart ré-arme l'envoi (→ spam). En Docker, DATA_DIR pointe vers un volume persistant.
const _DATA_DIR = process.env.DATA_DIR || __dirname;
try { if (_DATA_DIR !== __dirname) fs.mkdirSync(_DATA_DIR, { recursive: true }); } catch {}
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
function _aiSupabaseDown() { return Date.now() < _aiCacheCooldownUntil; }
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
    const rows = keys.map(k => ({ key: k, value: _aiCacheFile[k] }));
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
      const { data, error } = await supabase.from(AICACHE_TABLE).select('value').eq('key', k).limit(1);
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
// Purge des entrées plus vieilles que maxAgeMs (rétention "max 1 mois").
async function aiCachePrune(maxAgeMs) {
  await _aiCacheEnsureDb();
  if (!_aiCacheDb) return;   // mode fichier : pas d'horodatage par clé, fichier déjà petit/éphémère
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  try {
    const { error } = await supabase.from(AICACHE_TABLE).delete().lt('created_at', cutoff);
    if (!error) console.log('[AICache] purge des entrées > rétention effectuée');
  } catch {}
}

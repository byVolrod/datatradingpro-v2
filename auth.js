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
async function verifyLogin(email, password) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('email', (email || '').toLowerCase().trim())
    .eq('active', true)
    .single();

  if (error || !data) return null;

  const ok = await bcrypt.compare(password, data.password_hash);
  if (!ok) return null;

  // Abonnement expiré ? (les admins ne sont jamais bloqués)
  if (data.role !== 'admin' && data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return { expired: true, expiresAt: data.expires_at };
  }

  // Mettre à jour last_login en background
  supabase.from(TABLE).update({ last_login: new Date().toISOString() }).eq('id', data.id).then(() => {});

  return { id: data.id, email: data.email, name: data.name, role: data.role, plan: data.plan, active: !!data.active, expiresAt: data.expires_at || null };
}

// ─── CRUD utilisateurs ────────────────────────────────────────────────────────
async function getAllUsers() {
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
    return fallback.data || [];
  }
  if (error) throw new Error(error.message);
  return data || [];
}

async function getUserById(id) {
  const { data } = await supabase
    .from(TABLE)
    .select('id, email, name, role, plan, active')
    .eq('id', id)
    .single();
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
  if (error) throw new Error(error.message);
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

module.exports = {
  seedAdmin,
  verifyLogin,
  getAllUsers,
  getUserById,
  createUser,
  changePassword,
  updateUser,
  deleteUser,
};

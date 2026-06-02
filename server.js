require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const fs        = require('fs');
const axios     = require('axios');
const session   = require('cookie-session');   // session stockée côté navigateur → survit aux redémarrages
const helmet    = require('helmet');
const cors      = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { scrapeFinancialJuice, initFinancialJuice, setOnPushCallback, backfillHistoricalNews } = require('./scrapers/financialjuice');
const { scrapeForexFactory, getCalendarRaw } = require('./scrapers/forexfactory');
const { scrapeForexFactoryNews, getArticleContent, startFFNewsPoll } = require('./scrapers/forexfactory-news');
const { fetchAllRSS } = require('./scrapers/rss');   // ForexLive, FXStreet, WSJ, MarketWatch, Yahoo, Investing, Google News…
const { fetchCOTData } = require('./scrapers/cot');
const { fetchCommunityOutlook, clearOutlookCache } = require('./scrapers/myfxbook');
const auth = require('./auth');
const mailer = require('./mailer');   // emails (bienvenue, renouvellement, reset)
const ai = require('./ai');           // génération IA (Gemini gratuit, repli Claude)
const whop = require('./whop');       // vérification des abonnements Whop (auto-renouvellement)
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// ─── Global error handlers — évite les crashes silencieux ────────────────────
process.on('uncaughtException',  err  => console.error('[UNCAUGHT]',   err.stack || err.message));
process.on('unhandledRejection', (reason) => console.error('[UNHANDLED]', reason?.stack || reason));

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// En production (Railway, Render…) le serveur est derrière un reverse-proxy HTTPS
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// ─── Sécurité HTTP ────────────────────────────────────────────────────────────
// Helmet : headers de sécurité (XSS, clickjacking, MIME sniffing…)
// contentSecurityPolicy désactivé car le frontend charge des CDN (TradingView, etc.)
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS : n'autoriser que le domaine de production + localhost en dev
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Requêtes sans origin (curl, server-to-server) toujours autorisées
    if (!origin) return cb(null, true);
    if (process.env.NODE_ENV !== 'production') return cb(null, true); // dev : tout autorisé
    // Aucune liste configurée → pas de restriction (évite de se bloquer soi-même)
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
    if (ALLOWED_ORIGINS.some(o => origin === o || origin.endsWith(o))) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL = 60000;
const HISTORY_FILE = path.join(__dirname, 'news_history.json');
const HISTORY_TTL  = 7 * 24 * 60 * 60 * 1000; // 7 days
const SW_CACHE_FILE = path.join(__dirname, 'cache_session_wraps.json');
const SW_MAX_AGE    = 30 * 24 * 60 * 60 * 1000; // 30 days
const BR_CACHE_FILE = path.join(__dirname, 'cache_bank_research.json');
const BR_MAX_AGE    = 30 * 24 * 60 * 60 * 1000;

let allNews = [];
let allCalendar = [];   // FF calendar events served separately
let isFirstLoad = true;
let _saveTimer  = null;
let _mosaicImages     = [];
let _mosaicRefreshedAt = 0;
let _swCache      = [];
let _swFetchedAt  = 0;
let _brCache     = [];
let _brFetchedAt = 0;

function loadHistory() {
  try {
    const raw    = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    const cutoff = Date.now() - HISTORY_TTL;
    const items  = (raw.items || []).filter(i => i.timestamp > cutoff);
    console.log(`[History] Loaded ${items.length} items from disk (last 7 days)`);
    return items;
  } catch { return []; }
}

function saveHistory() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify({ savedAt: Date.now(), items: allNews }));
    } catch (e) { console.error('[History] Save error:', e.message); }
  }, 5000);
}

// Economic data agency detection — defined early so loadHistory remapping can use it
const ECON_AGENCIES_EARLY = [
  [/\bpmi\b|purchasing managers|markit/i,                              'S&P Global'],
  [/\bism\b/i,                                                          'ISM'],
  [/nfp|non.?farm payroll|initial claims|continuing claims|challenger|jobless claims/i, 'BLS'],
  [/payroll|unemployment rate|employment change|average hourly|workweek/i, 'BLS'],
  [/\bpce\b|personal income|personal spending|unit labor|labor cost/i, 'BEA'],
  [/consumer credit/i,                                                  'Federal Reserve'],
  [/\bifo\b/i,                                                          'IFO Institute'],
  [/\bzew\b/i,                                                          'ZEW'],
  [/eurozone.*cpi|cpi.*eurozone|eurozone.*gdp|gdp.*eurozone|eurozone.*retail|eurostat/i, 'Eurostat'],
  [/\buk\b.*cpi|cpi.*\buk\b|\buk\b.*gdp|gdp.*\buk\b|\brpi\b/i,       'ONS'],
  [/australia.*cpi|cpi.*australia|australia.*trade|aus.*gdp/i,         'ABS'],
  [/canada.*cpi|cpi.*canada|canadian.*employment|canadian.*unemployment/i, 'Statistics Canada'],
  [/japan.*cpi|japan.*gdp|japan.*pmi|tankan/i,                         'Statistics Japan'],
  [/china.*pmi|china.*cpi|china.*gdp|\bnbs\b/i,                        'NBS China'],
  [/swiss.*cpi|cpi.*swiss|swiss.*gdp|switzerland.*unemployment/i,      'Statistics CH'],
  [/turkish.*cpi|cpi.*turkish|turkey.*cpi/i,                           'TURKSTAT'],
  [/\bnfib\b/i,                                                         'NFIB'],
  [/house price|home price|existing home|pending home|housing starts/i,'NAR / Census'],
  [/consumer confidence|consumer sentiment/i,                           'Conference Board'],
];

function _detectEconAgencyEarly(text) {
  for (const [rx, agency] of ECON_AGENCIES_EARLY) {
    if (rx.test(text)) return agency;
  }
  return null;
}

allNews = loadHistory().map(item => {
  if (item.category === 'Economic Commentary' && item.source === 'FinancialJuice') {
    const agency = _detectEconAgencyEarly(item.headline);
    if (agency) return { ...item, source: agency };
  }
  return item;
});

// ─── Session ──────────────────────────────────────────────────────────────────
app.use(session({
  name:     'dtp_session',
  secret:   process.env.SESSION_SECRET || 'dtp-secret-key-change-me',
  httpOnly: true,
  sameSite: 'lax',
  secure:   process.env.NODE_ENV === 'production',  // HTTPS uniquement en prod
  maxAge:   30 * 24 * 60 * 60 * 1000,   // 30 jours — l'utilisateur reste connecté
}));

// ─── Auth middleware ──────────────────────────────────────────────────────────
// Public = static assets (CSS/JS), login page, auth endpoints
const _PUBLIC_PATHS    = new Set(['/login', '/login.html', '/favicon.ico', '/healthz']);
const _PUBLIC_PREFIXES = ['/css/', '/js/', '/api/auth/', '/api/whop/'];

function requireAuth(req, res, next) {
  const isPublic = _PUBLIC_PATHS.has(req.path) ||
    _PUBLIC_PREFIXES.some(p => req.path.startsWith(p));
  if (isPublic) return next();

  if (!req.session?.userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Non autorisé — veuillez vous connecter' });
    }
    return res.redirect('/login');
  }

  req.user = req.session.user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role !== 'admin') {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Accès refusé' });
    return res.redirect('/');
  }
  next();
}

// Staff (admin OU agent de support) — accès à la messagerie support, mais PAS à la gestion utilisateurs
function requireSupport(req, res, next) {
  const role = req.session?.user?.role;
  if (role !== 'admin' && role !== 'support') {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Accès refusé' });
    return res.redirect('/');
  }
  next();
}

app.use(requireAuth);
// extensions: ['html'] → /login sert login.html, /admin sert admin.html automatiquement
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use(express.json({ limit: '2mb' }));   // 2 Mo : autorise les pièces jointes chat (data URL base64)

// Health check (public) — pour le monitoring / keep-alive (Render, UptimeRobot…)
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

// Redirection /login → déjà connecté va au dashboard
app.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', requireAuth, requireAdmin, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── Auth routes ──────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.json({ error: 'Email et mot de passe requis' });
  try {
    const user = await auth.verifyLogin(email, password);
    if (!user) return res.json({ error: 'Email ou mot de passe incorrect' });
    const _renewUrl = process.env.WHOP_RENEW_URL || 'https://whop.com/joined/justonetrader/products/jot-dtp/';
    if (user.suspended) {
      return res.json({ error: 'Votre abonnement n\'est plus actif. Renouvelez pour retrouver l\'accès au terminal.', renewUrl: _renewUrl });
    }
    if (user.expired) {
      const d = new Date(user.expiresAt).toLocaleDateString('fr-FR');
      return res.json({ error: `Votre abonnement a expiré le ${d}. Renouvelez pour retrouver l'accès.`, renewUrl: _renewUrl });
    }
    req.session.userId = user.id;
    req.session.user   = user;
    res.json({ ok: true, role: user.role });
  } catch (e) {
    console.error('[Auth] login error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// Mot de passe oublié : génère un MDP temporaire et l'envoie par email.
// Réponse toujours { ok:true } (ne révèle pas si l'email existe).
app.post('/api/auth/forgot-password', (req, res) => {
  const email = (req.body?.email || '').toLowerCase().trim();
  res.json({ ok: true });   // réponse IMMÉDIATE (UX instantanée + anti-énumération)
  if (!email) return;
  // Le travail (lookup + hash bcrypt + update DB + email) se fait en arrière-plan, après la réponse.
  (async () => {
    try {
      const users = await auth.getAllUsers();
      const u = users.find(x => (x.email || '').toLowerCase() === email);
      if (u) {   // suffit que l'email existe en BDD (même si abonnement suspendu/expiré)
        const temp = require('crypto').randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) + 'A1';
        await auth.changePassword(u.id, temp);
        mailer.sendPasswordReset({ to: u.email, name: u.name, password: temp }).catch(() => {});
        console.log(`[Auth] Mot de passe réinitialisé (forgot) → ${u.email}`);
      }
    } catch (e) { console.error('[Auth] forgot-password error:', e.message); }
  })();
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session?.userId) return res.json({ loggedIn: false });
  try {
    // Toujours relire depuis la DB → les changements admin (active, plan…) sont immédiatement reflétés
    const fresh = await auth.getUserById(req.session.userId);
    if (!fresh) { req.session = null; return res.json({ loggedIn: false }); }
    const user = { id: fresh.id, email: fresh.email, name: fresh.name, role: fresh.role, plan: fresh.plan, active: !!fresh.active };
    req.session.user = user; // maintenir la session à jour
    res.json({ loggedIn: true, user });
  } catch {
    // Fallback si DB inaccessible : utiliser la session
    res.json({ loggedIn: true, user: req.session.user });
  }
});

// ─── Admin routes (admin only) — tous async pour Supabase ────────────────────
app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try { res.json(await auth.getAllUsers()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Calcule la date d'expiration à partir d'une durée choisie par l'admin
function computeExpiry({ duration, expiresAt, startDate }) {
  if (duration === 'unlimited') return null;                 // abonnement illimité
  if (duration === 'custom')    return expiresAt ? new Date(expiresAt).toISOString() : null;
  // Offres en SEMAINES (ex. essai gratuit) : "1week", "2week"…
  const wk = /^(\d+)\s*(?:week|weeks|sem|semaine|semaines)$/i.exec(duration);
  if (wk) {
    let d = startDate ? new Date(startDate) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    d.setDate(d.getDate() + parseInt(wk[1], 10) * 7);
    return d.toISOString();
  }
  const months = parseInt(duration, 10);
  if (!Number.isFinite(months) || months <= 0) return null;
  // Base = date de début choisie (ex. date de paiement Whop), sinon aujourd'hui
  let d = startDate ? new Date(startDate) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const body = { ...req.body, expiresAt: computeExpiry(req.body) };
    await auth.createUser(body);
    res.json({ ok: true });
    // Email de bienvenue : uniquement pour les CLIENTS (pas le staff admin/support)
    if (body.email && (body.role || 'client') === 'client') {
      mailer.sendWelcome({ to: body.email, name: body.name, password: body.password, expiresAt: body.expiresAt }).catch(() => {});
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const id = +req.params.id;
    const before = await auth.getUserById(id).catch(() => null);   // état AVANT modif
    const fields = { ...req.body };
    // Ne recalcule l'échéance que si l'admin a choisi une durée (sinon on garde l'actuelle)
    if (req.body.duration) fields.expiresAt = computeExpiry(req.body);
    await auth.updateUser(id, fields);
    res.json({ ok: true });

    // Emails selon le changement de statut (non bloquant)
    const activeReq = 'active' in req.body
      ? (req.body.active === 1 || req.body.active === true || req.body.active === '1')
      : null;
    if (activeReq === false) {
      // Suspendu → renouvellement échoué
      auth.getUserById(id)
        .then(u => { if (u?.email && u.role === 'client') mailer.sendRenewalFailed({ to: u.email, name: u.name }); })
        .catch(() => {});
    } else if (activeReq === true && before && !before.active) {
      // Réactivé (était suspendu) → email de réactivation
      auth.getUserById(id)
        .then(u => { if (u?.email && u.role === 'client') mailer.sendReactivated({ to: u.email, name: u.name, expiresAt: u.expires_at }); })
        .catch(() => {});
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try { await auth.deleteUser(+req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
  try {
    await auth.changePassword(+req.params.id, req.body.password);
    res.json({ ok: true });
    // Email de réinitialisation (non bloquant) avec le nouveau mot de passe
    auth.getUserById(+req.params.id)
      .then(u => { if (u?.email) mailer.sendPasswordReset({ to: u.email, name: u.name, password: req.body.password }); })
      .catch(() => {});
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── User self-service password change ────────────────────────────────────────
app.put('/api/auth/me/password', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non autorisé' });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Champs requis' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
  try {
    const user = await auth.verifyLogin(req.session.user.email, currentPassword);
    if (!user) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    await auth.changePassword(req.session.userId, newPassword);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Auth] password change error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── Whop : webhook d'auto-renouvellement / création de compte ───────────────
async function _whopRenewOrCreate(mem) {
  const users = await auth.getAllUsers();
  const existing = users.find(u => (u.email || '').toLowerCase() === mem.email);
  if (existing) {
    if (existing.role === 'admin') return;                 // on ne touche jamais aux admins
    const wasInactive = !existing.active;
    await auth.updateUser(existing.id, { active: true, expiresAt: mem.expiresAt });
    if (wasInactive) mailer.sendReactivated({ to: existing.email, name: existing.name, expiresAt: mem.expiresAt }).catch(() => {});
    else             mailer.sendRenewed({ to: existing.email, name: existing.name, expiresAt: mem.expiresAt }).catch(() => {});
    mailer.sendAdminRenewalNotice({ clientEmail: existing.email, clientName: existing.name, expiresAt: mem.expiresAt, isNew: false }).catch(() => {});
    console.log(`[Whop] Renouvelé: ${mem.email} → ${mem.expiresAt || 'illimité'}`);
  } else {
    const pwd = require('crypto').randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) + 'A1';
    await auth.createUser({ email: mem.email, password: pwd, name: '', role: 'client', plan: 'professionnel', expiresAt: mem.expiresAt });
    mailer.sendWelcome({ to: mem.email, name: '', password: pwd, expiresAt: mem.expiresAt }).catch(() => {});
    mailer.sendAdminRenewalNotice({ clientEmail: mem.email, clientName: '', expiresAt: mem.expiresAt, isNew: true }).catch(() => {});
    console.log(`[Whop] Compte créé: ${mem.email}`);
  }
}
async function _whopSuspend(email) {
  const users = await auth.getAllUsers();
  const u = users.find(x => (x.email || '').toLowerCase() === email);
  if (u && u.role !== 'admin' && u.active) {
    await auth.updateUser(u.id, { active: false });
    mailer.sendRenewalFailed({ to: u.email, name: u.name }).catch(() => {});
    console.log(`[Whop] Suspendu: ${email}`);
  }
}
app.post('/api/whop/webhook', async (req, res) => {
  res.json({ received: true });   // ACK immédiat (Whop n'attend pas)
  try {
    if (!whop.configured()) { console.warn('[Whop] WHOP_API_KEY absente'); return; }
    const body   = req.body || {};
    const action = String(body.action || body.event || body.type || '').toLowerCase();
    const data   = body.data || body;
    const memId  = data.id || data.membership_id || data.membership;
    let mem = null;
    if (typeof memId === 'string' && memId.startsWith('mem_')) mem = await whop.getMembership(memId);
    if (!mem && data.email) mem = await whop.getMembershipByEmail(data.email);
    if (!mem || !mem.email) { console.warn('[Whop] webhook sans membership exploitable:', action); return; }
    const invalidEvent = /invalid|cancel|expire|fail|refund|chargeback|terminat/.test(action);
    if (mem.valid && !invalidEvent) await _whopRenewOrCreate(mem);
    else                            await _whopSuspend(mem.email);
  } catch (e) { console.error('[Whop] webhook:', e.message); }
});

// Mise à jour du profil (nom) par l'utilisateur — persiste en BDD + session
app.put('/api/auth/me/profile', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non autorisé' });
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Le nom ne peut pas être vide' });
  try {
    await auth.updateUser(req.session.userId, { name });   // → BDD (et donc panel admin)
    req.session.user = { ...req.session.user, name };       // → session courante
    res.json({ ok: true, name });
  } catch (e) {
    console.error('[Auth] profile update error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════ CHAT SUPPORT ═══════════════════
// Côté utilisateur : sa conversation avec le support (persistée en BDD/fichier).
app.get('/api/chat', async (req, res) => {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ error: 'Non autorisé' });
  try {
    const messages = await auth.chatList(uid);
    await auth.chatMarkRead(uid, 'support');   // l'utilisateur a lu les réponses du support
    res.json({ messages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/chat', async (req, res) => {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ error: 'Non autorisé' });
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message vide' });
  try {
    const msg = await auth.chatInsert({ user_id: uid, sender: 'user', text });
    res.json({ ok: true, message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Badge : nombre de réponses du support non lues
app.get('/api/chat/unread', async (req, res) => {
  const uid = req.session?.userId;
  if (!uid) return res.json({ unread: 0 });
  try { res.json({ unread: await auth.chatUnread(uid, 'support') }); }
  catch { res.json({ unread: 0 }); }
});

// Côté admin : voir les conversations + répondre
app.get('/api/admin/chat', requireSupport, async (_req, res) => {
  try {
    const threads = await auth.chatThreads();
    const users = await auth.getAllUsers();
    const byId = new Map(users.map(u => [String(u.id), u]));
    res.json({ threads: threads.map(t => ({ ...t, name: byId.get(String(t.user_id))?.name || '', email: byId.get(String(t.user_id))?.email || '' })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/chat/:userId', requireSupport, async (req, res) => {
  try {
    const messages = await auth.chatList(req.params.userId);
    await auth.chatMarkRead(req.params.userId, 'user');   // l'admin a lu les messages de l'utilisateur
    res.json({ messages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/chat/:userId', requireSupport, async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message vide' });
  try {
    const msg = await auth.chatInsert({ user_id: req.params.userId, sender: 'support', text });
    res.json({ ok: true, message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/news',     (_req, res) => res.json({ items: allNews.slice(0, 200), total: allNews.length }));
app.get('/api/news/history', (req, res) => {
  const before = parseInt(req.query.before) || Date.now();
  const limit  = Math.min(parseInt(req.query.limit) || 100, 200);
  const items  = allNews
    .filter(i => i.timestamp < before)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
  res.json({ items, total: allNews.length });
});
app.get('/api/calendar', (_req, res) => res.json({ items: allCalendar }));
app.get('/api/calendar-events', (_req, res) => res.json({ items: getCalendarRaw() }));

// ── Mosaic background images ──────────────────────────────────────────────────
function _ytThumb(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}

async function _fetchOgImage(url) {
  try {
    const r = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      maxRedirects: 3,
      validateStatus: s => s < 400,
    });
    const html = r.data || '';
    const patterns = [
      /<meta\s[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta\s[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      /<meta\s[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta\s[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1] && m[1].startsWith('http')) return m[1];
    }
  } catch {}
  return null;
}

async function _refreshMosaicImages() {
  _mosaicRefreshedAt = Date.now();
  const SKIP = /forexfactory\.com\/news\//i;
  const candidates = allNews.slice(0, 60).filter(i => i.url && !SKIP.test(i.url));
  const images = [];
  for (const item of candidates) {
    if (images.length >= 24) break;
    const yt = _ytThumb(item.url);
    if (yt) { images.push(yt); continue; }
    const og = await _fetchOgImage(item.url);
    if (og) images.push(og);
  }
  if (images.length >= 4) _mosaicImages = images;
}

app.get('/api/mosaic-images', (_req, res) => {
  res.json(_mosaicImages);
  if (Date.now() - _mosaicRefreshedAt > 15 * 60 * 1000) _refreshMosaicImages().catch(() => {});
});

// ── InvestingLive Session Wraps ───────────────────────────────────────────────
// Load persisted wraps from file (called at startup)
function _swLoadFile() {
  try {
    const data = JSON.parse(fs.readFileSync(SW_CACHE_FILE, 'utf8'));
    if (Array.isArray(data)) {
      _swCache = data.filter(i => i.timestamp > Date.now() - SW_MAX_AGE);
      console.log(`[SessionWraps] Loaded ${_swCache.length} wraps from file`);
    }
  } catch {}
}

function _swParseRssItem($, el, filterByTitle) {
  const title   = $('title', el).first().text().trim();
  // Wraps InvestingLive : "European markets wrap: …", "North American markets wrap", "… session wrap"
  if (filterByTitle && !/(markets?|session)\s+wrap|wrap\s*:/i.test(title)) return null;
  const link    = $('link', el).contents().filter((_, n) => n.type === 'text').text().trim()
               || $('guid', el).text().trim();
  if (!link) return null;
  const pubDate = $('pubDate', el).text().trim();
  const ts      = new Date(pubDate).getTime();
  if (!ts) return null;

  // ── Extraire le HTML complet depuis le CDATA de <description> ────────────────
  // .html() retourne la balise avec son contenu brut y compris les CDATA markers
  const descRaw  = $('description', el).html() || '';
  // Extraire le contenu entre <![CDATA[ ... ]]>
  const cdataMatch = descRaw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const fullHtml   = cdataMatch ? cdataMatch[1].trim() : '';
  // Fallback : .text() si pas de CDATA (déjà décodé)
  const plainText  = fullHtml || $('description', el).text().trim();

  const author  = $('dc\\:creator', el).first().text().trim();
  let session = 'Global';
  if (/americas|north\s+american/i.test(title))    session = 'Americas';
  else if (/european?|europe/i.test(title))          session = 'European';
  else if (/asia[\s-]?pacific|asian/i.test(title))  session = 'Asia-Pacific';

  return {
    id:          'sw-' + Buffer.from(link).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(-16),
    title,
    url:         link,
    timestamp:   ts,
    session,
    // Aperçu court (pour la carte dans la liste)
    description: plainText.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0, 300),
    // HTML complet extrait du RSS — utilisé directement dans le reader
    content:     fullHtml.length > 100 ? fullHtml : null,
    author,
    _source:     'investinglive',
  };
}

async function _fetchSessionWraps(full = false) {
  _swFetchedAt = Date.now();
  const cutoff   = Date.now() - SW_MAX_AGE;
  const maxPages = 1;   // RSS ne pagine pas (répète la page 1) → l'historique vient de la page archive ci-dessous
  const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  // Try category feed first (only wraps), fall back to main feed (filter by title)
  const FEEDS = [
    { base: 'https://investinglive.com/SessionWraps/feed/', filter: false },
    { base: 'https://investinglive.com/feed/',               filter: true  },
  ];

  const merged = new Map(_swCache.map(i => [i.id, i]));

  for (const { base, filter } of FEEDS) {
    let feedOk = false;
    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = page === 1 ? base : `${base}?paged=${page}`;
        const r   = await axios.get(url, {
          timeout: 10000,
          headers: { 'User-Agent': UA },
          validateStatus: s => s < 500,
        });
        if (r.status === 404) break;         // feed doesn't exist → try next
        if (r.status !== 200) continue;
        feedOk = true;

        const $    = cheerio.load(r.data, { xmlMode: true });
        const items = $('item');
        let   tooOld = false;

        items.each((_, el) => {
          const item = _swParseRssItem($, el, filter);
          if (!item) return;                              // pas un wrap (filtré) → on ignore mais on continue
          if (item.timestamp < cutoff) { tooOld = true; return; }
          merged.set(item.id, item);
        });

        // On s'arrête seulement si on a dépassé l'ancienneté max, ou si la page est vraiment vide.
        // (Une page sans wrap mais avec des articles ne doit PAS stopper la pagination.)
        if (tooOld || items.length === 0) break;
      } catch { break; }
    }
    if (feedOk) break;                       // used this feed successfully
  }

  // ── Pass 2 : page archive HTML — historique complet (le RSS ne donne que les derniers) ──
  // Les articles wrap apparaissent en clair : /news/investinglive-<region>-...-wrap-...-YYYYMMDD/
  const archPages = full ? 4 : 2;
  for (let page = 1; page <= archPages; page++) {
    try {
      const url = page === 1
        ? 'https://investinglive.com/SessionWraps'
        : `https://investinglive.com/SessionWraps/page/${page}/`;
      const r = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': UA }, validateStatus: s => s < 500 });
      if (r.status !== 200) break;

      const re = /\/news\/(investinglive-[a-z0-9-]*wrap[a-z0-9-]*-(\d{8}))\//gi;
      const seen = new Set();
      let pageHad = false, anyRecent = false, m;
      while ((m = re.exec(r.data)) !== null) {
        const slug = m[1].toLowerCase(), ymd = m[2];
        if (seen.has(slug)) continue;
        seen.add(slug);
        pageHad = true;
        const ts = new Date(+ymd.slice(0,4), +ymd.slice(4,6) - 1, +ymd.slice(6,8), 12).getTime();
        if (!ts || ts < cutoff) continue;
        anyRecent = true;
        const link = `https://investinglive.com/news/${slug}/`;
        const id   = 'sw-' + Buffer.from(link).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(-16);
        if (merged.has(id)) continue;          // déjà présent via RSS (titre propre) → ne pas écraser
        let title = slug.replace(/^investinglive-/,'').replace(/-\d{8}$/,'').replace(/-/g,' ').trim();
        title = title.charAt(0).toUpperCase() + title.slice(1);
        let session = 'Global';
        if      (/americas|north.american/.test(slug)) session = 'Americas';
        else if (/europe/.test(slug))                  session = 'European';
        else if (/asia.pacific|asian/.test(slug))      session = 'Asia-Pacific';
        merged.set(id, { id, title, url: link, timestamp: ts, session, description: '', content: null, author: '', _source: 'investinglive' });
      }
      if (!pageHad || !anyRecent) break;       // plus d'articles, ou page entièrement hors-période
    } catch { break; }
  }

  const before = _swCache.length;
  _swCache = [...merged.values()]
    .filter(i => i.timestamp > cutoff)
    .sort((a, b) => b.timestamp - a.timestamp);

  try { fs.writeFileSync(SW_CACHE_FILE, JSON.stringify(_swCache)); } catch {}
  console.log(`[SessionWraps] ${_swCache.length} wraps (was ${before}) — ${full ? 'full 30d' : 'quick'} refresh`);
}

app.get('/api/session-wraps', (_req, res) => {
  res.json(_swCache);
  if (Date.now() - _swFetchedAt > 20 * 60 * 1000) _fetchSessionWraps(false).catch(() => {});
});

// ── Puppeteer browser partagé pour InvestingLive (SPA Vue/Nuxt) ─────────────
let _ilBrowser = null;

function _resolveChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.env.CHROME_EXEC)               return process.env.CHROME_EXEC;
  if (process.platform === 'win32')  return 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const { existsSync } = fs;
  const candidates = ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome-stable','/usr/bin/google-chrome'];
  return candidates.find(existsSync) || 'chromium';
}

// Ferme le navigateur InvestingLive après inactivité pour libérer la RAM (512 Mo)
let _ilIdleTimer = null;
function _ilArmIdleClose() {
  if (_ilIdleTimer) clearTimeout(_ilIdleTimer);
  _ilIdleTimer = setTimeout(async () => {
    if (_ilBrowser) { try { await _ilBrowser.close(); } catch {} _ilBrowser = null; console.log('[InvestingLive] navigateur fermé (inactif)'); }
  }, 90_000);
  if (_ilIdleTimer.unref) _ilIdleTimer.unref();
}

async function _getIlBrowser() {
  if (_ilIdleTimer) { clearTimeout(_ilIdleTimer); _ilIdleTimer = null; }
  if (_ilBrowser) { try { await _ilBrowser.pages(); return _ilBrowser; } catch { _ilBrowser = null; } }
  _ilBrowser = await puppeteer.launch({
    executablePath: _resolveChrome(),
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu',
           '--single-process','--no-zygote','--disable-extensions'],
  });
  _ilBrowser.on('disconnected', () => { _ilBrowser = null; });
  return _ilBrowser;
}

async function _scrapeILviaPuppeteer(url) {
  const browser = await _getIlBrowser();
  const page    = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });

    // Attendre que le contenu Vue/Nuxt soit rendu
    await page.waitForSelector(
      '.article__content-body, .article-body-normal, .article__body, .post-content, .entry-content',
      { timeout: 12_000 }
    ).catch(() => {});

    const html = await page.evaluate(() => {
      // Essayer les sélecteurs spécifiques à InvestingLive (Vue/Nuxt)
      const selectors = [
        '.article__content-body',
        '.article-body-normal',
        '.article__body',
        '[class*="article__content"]',
        '.post-content',
        '.entry-content',
        'article',
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && el.innerText.trim().length > 100) return el.innerHTML;
      }
      return '';
    });
    return html;
  } finally {
    await page.close().catch(() => {});
    _ilArmIdleClose();
  }
}

// Extraction RAPIDE du contenu InvestingLive via axios (JSON-LD articleBody) — sans navigateur
async function _fetchILContentHttp(url) {
  const r = await axios.get(url, {
    timeout: 12000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    validateStatus: s => s < 500,
  });
  if (r.status !== 200) return { html: '', points: [] };
  const $ = cheerio.load(r.data);
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 1) Contenu structuré en rubriques : "Notable headlines" + sous-titres en gras
  const $art = $('article').first();
  const seen = new Set();
  const headlines = [];
  $art.find('li').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.length < 15 || seen.has(t)) return;
    seen.add(t);
    headlines.push(t);
  });
  let out = '';
  if (headlines.length >= 2) {
    out += '<strong>Notable headlines</strong><ul>'
         + headlines.slice(0, 70).map(t => `<li>${esc(t)}</li>`).join('')
         + '</ul>';
  }
  // Paragraphes de synthèse : sous-titre en gras → rubrique orange + texte en puce
  $art.find('p').each((_, el) => {
    const $el  = $(el);
    const full = $el.text().replace(/\s+/g, ' ').trim();
    if (full.length < 20 || seen.has(full)) return;
    seen.add(full);
    const head = $el.find('strong, b').first().text().trim();
    if (head && head.length < 60 && full.startsWith(head)) {
      const rest = full.slice(head.length).replace(/^[\s:–-]+/, '').trim();
      out += `<strong>${esc(head.replace(/:\s*$/, ''))}</strong>`;
      if (rest.length > 10) out += `<ul><li>${esc(rest)}</li></ul>`;
    } else {
      out += `<ul><li>${esc(full)}</li></ul>`;
    }
  });
  if (out) return { html: out, points: headlines };

  // 2) Fallback : JSON-LD articleBody (bloc) si pas de structure exploitable
  let body = '';
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const j = JSON.parse($(s).contents().text());
      const arr = Array.isArray(j) ? j : (j['@graph'] ? j['@graph'] : [j]);
      arr.forEach(o => { if (o && typeof o.articleBody === 'string' && o.articleBody.length > body.length) body = o.articleBody; });
    } catch {}
  });
  if (body.length > 80) return { html: `<p>${esc(body)}</p>`, points: [] };
  return { html: '', points: [] };
}

// ── Persistance de cache IA sur disque (évite de rappeler Gemini après redémarrage) ──
function _loadJsonMap(file) {
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))); }
  catch { return new Map(); }
}
let _saveTimers = {};
function _saveJsonMap(file, map) {
  // écriture débattue (max 1 / 2s par fichier) pour ne pas marteler le disque
  clearTimeout(_saveTimers[file]);
  _saveTimers[file] = setTimeout(() => {
    try { fs.writeFileSync(file, JSON.stringify(Object.fromEntries(map))); } catch {}
  }, 2000);
  if (_saveTimers[file].unref) _saveTimers[file].unref();
}

// ── Budget Gemini MENSUEL auto-paçant : le quota doit tenir TOUT le mois ──────
//  On part d'une enveloppe mensuelle (GEMINI_MONTHLY_BUDGET) et on calcule chaque
//  jour un plafond = quota restant / jours restants dans le mois. Ainsi on ne
//  "crame" jamais tout en début/fin de journée : la conso s'étale sur le mois.
//  Répartition intra-journée :
//   • Semaine : 50% news IMPORTANTES + 50% rapports analyst ; bias/bank OFF.
//   • Week-end : news + analyst OFF ; bias + bank ON (dans la limite du plafond).
const GEMINI_MONTHLY_BUDGET = parseInt(process.env.GEMINI_MONTHLY_BUDGET, 10) || 1200;
const AI_USAGE_FILE = path.join(__dirname, 'cache_ai_usage.json');
let _aiUsage = { month: '', day: '', total: 0, dayCounts: {} };
try { _aiUsage = Object.assign(_aiUsage, JSON.parse(fs.readFileSync(AI_USAGE_FILE, 'utf8'))); } catch {}
function _aiParis()     { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' })); }
function _aiMonth()     { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }).slice(0, 7); }
function _aiDay()       { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }); }
function _aiIsWeekend() { const d = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Europe/Paris' }); return d === 'Sat' || d === 'Sun'; }
function _aiDaysLeftInMonth() { const p = _aiParis(); const last = new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate(); return Math.max(1, last - p.getDate() + 1); }
function _aiSave() { try { fs.writeFileSync(AI_USAGE_FILE, JSON.stringify(_aiUsage)); } catch {} }
function _aiReset() {
  const mo = _aiMonth(), d = _aiDay();
  if (_aiUsage.month !== mo) { _aiUsage = { month: mo, day: d, total: 0, dayCounts: {} }; _aiSave(); }
  else if (_aiUsage.day !== d) { _aiUsage.day = d; _aiUsage.dayCounts = {}; _aiSave(); }
}
function _aiDailyCap() {
  const remaining = Math.max(0, GEMINI_MONTHLY_BUDGET - (_aiUsage.total || 0));
  return Math.max(10, Math.floor(remaining / _aiDaysLeftInMonth()));   // jamais < 10/jour
}
function aiAllowed(category, opts = {}) {
  _aiReset();
  const cap      = _aiDailyCap();
  const dayTotal = Object.values(_aiUsage.dayCounts).reduce((a, b) => a + b, 0);
  const catUsed  = _aiUsage.dayCounts[category] || 0;
  if (dayTotal >= cap) return false;                                   // plafond du jour atteint
  if (_aiIsWeekend()) {
    if (category === 'news' || category === 'analyst') return false;   // WE : news + analyst OFF
    return true;                                                       // WE : bias / bank ON
  }
  if (category === 'bias' || category === 'bank') return false;        // semaine : réservés au WE
  const half = Math.floor(cap / 2);
  if (category === 'news')    return !!opts.important && catUsed < half;
  if (category === 'analyst') return catUsed < half;
  return false;
}
function aiNote(category) { _aiReset(); _aiUsage.dayCounts[category] = (_aiUsage.dayCounts[category] || 0) + 1; _aiUsage.total = (_aiUsage.total || 0) + 1; _aiSave(); }

// Cache des segmentations IA (url → HTML sectionné) — persistant
const SW_SEG_FILE = path.join(__dirname, 'cache_sw_seg.json');
const _swSegCache = _loadJsonMap(SW_SEG_FILE);

// Regroupe les titres d'un wrap en rubriques thématiques via Gemini
async function _segmentWrapAI(points) {
  const prompt = `Tu es analyste de marché. Voici des titres de news financières issus d'un récap de session de marché, en vrac.
Regroupe-les en rubriques thématiques claires. Rubriques autorisées (n'utilise que celles pertinentes) :
GEOPOLITICS, CENTRAL BANKS, ECONOMIC DATA, FX, COMMODITIES, EQUITIES, FIXED INCOME, CRYPTO, CHINA & ASIA, LOOKING AHEAD, OTHER.
Règles STRICTES :
- Garde chaque titre EXACTEMENT tel quel (ne reformule pas, ne traduis pas).
- Ignore les titres promotionnels ou hors-sujet (ex: "Is Palantir a Buy?", "...analysis today at investingLive.com").
- Ordonne les rubriques de la plus importante à la moins importante.
Réponds UNIQUEMENT en JSON valide : [{"section":"NOM_RUBRIQUE","items":["titre 1","titre 2"]}]
Titres :
${points.map(p => '- ' + p).join('\n')}`;
  const text = await ai.generateText(prompt, 2500);
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  const arr = JSON.parse(m[0]);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = '';
  for (const sec of arr) {
    if (!sec || !sec.section || !Array.isArray(sec.items) || !sec.items.length) continue;
    html += `<strong>${esc(sec.section)}</strong><ul>${sec.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
  }
  return html.length > 50 ? html : null;
}

// Nettoyage HTML commun (retire médias/scripts)
function _cleanWrapHtml(h) {
  return (h || '')
    .replace(/<img[^>]*>/gi, '').replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim();
}

// Extrait la liste de titres (points) d'un HTML de wrap pour la segmentation IA
function _extractWrapPoints(html) {
  try {
    const $ = cheerio.load(html);
    const pts = [];
    $('li, p').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t.length >= 12 && t.length <= 240) pts.push(t);
    });
    return [...new Set(pts)];   // dédupe en gardant l'ordre
  } catch { return null; }
}

app.get('/api/session-wrap-content', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.startsWith('https://investinglive.com/')) return res.json({ html: '' });

  const cached = _swCache.find(i => i.url === url);

  // ── 1. Rassemble les titres à segmenter + un HTML brut de secours ────────────
  let points  = null;
  let rawHtml = null;
  if (cached?.content && cached.content.length > 100) {
    rawHtml = _cleanWrapHtml(cached.content);
    points  = _extractWrapPoints(rawHtml);
  }
  if (!points || points.length < 3) {
    try {
      const data = await _fetchILContentHttp(url);
      if (data.points && data.points.length >= 3) points = data.points;
      if (!rawHtml && data.html && data.html.length > 100) rawHtml = data.html;
    } catch { /* on tentera Puppeteer plus bas */ }
  }

  // ── 1.5 Segmentation thématique IA (rubriques, style rapport DTP), persistée ──
  //  Budget Gemini : compte dans l'enveloppe "analyst" (semaine 50%, week-end OFF).
  if (points && points.length >= 3) {
    let seg = _swSegCache.get(url);
    if (seg === undefined && aiAllowed('analyst')) {
      try { aiNote('analyst'); seg = await _segmentWrapAI(points); }
      catch (e) { console.warn('[SW seg AI]', e.message); seg = null; }
      _swSegCache.set(url, seg || null);
      if (seg) _saveJsonMap(SW_SEG_FILE, _swSegCache);   // persiste les succès
    }
    if (seg) {
      if (cached) cached.content = seg;
      return res.json({ html: seg, source: 'ai' });
    }
  }

  // ── 1.6 Sinon, HTML brut (RSS/HTTP) ──────────────────────────────────────────
  if (rawHtml && rawHtml.length > 100) {
    if (cached) cached.content = rawHtml;
    return res.json({ html: rawHtml, source: 'raw' });
  }

  // ── 2. Puppeteer — render le SPA Vue/Nuxt côté client (fallback rare) ─────────
  try {
    console.log(`[IL] Scraping via Puppeteer: ${url}`);
    const rawHtml = await _scrapeILviaPuppeteer(url);
    if (rawHtml && rawHtml.length > 100) {
      const clean = rawHtml
        .replace(/<img[^>]*>/gi, '').replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, '')
        .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '').replace(/\s{3,}/g, '\n').trim();
      // Mettre en cache pour les prochains appels
      if (cached) cached.content = clean;
      console.log(`[IL] Content extracted: ${clean.length} chars`);
      return res.json({ html: clean, source: 'puppeteer' });
    }
    throw new Error('No content found via Puppeteer');
  } catch (e) {
    console.error('[IL] Puppeteer failed:', e.message);
  }

  // ── 3. Fallback : description RSS ────────────────────────────────────────────
  const desc = cached?.description || '';
  res.json({ html: desc ? `<p>${desc}</p>` : '', source: 'rss-desc', error: 'Puppeteer failed' });
});

// ── ING Think Bank Research ───────────────────────────────────────────────────
function _brLoadFile() {
  try {
    const data = JSON.parse(fs.readFileSync(BR_CACHE_FILE, 'utf8'));
    if (Array.isArray(data)) {
      _brCache = data.filter(i => i.timestamp > Date.now() - BR_MAX_AGE);
      console.log(`[BankResearch] Loaded ${_brCache.length} articles from file`);
    }
  } catch {}
}

// Sources de recherche institutionnelle / analystes (flux RSS publics, sans navigateur)
const BR_FEEDS = [
  { url: 'https://think.ing.com/rss/',          institution: 'ING',        source: 'ing-think',   paged: true  },
  { url: 'https://www.actionforex.com/feed/',   institution: 'ActionForex',source: 'actionforex', paged: false }, // agrège les notes de banques (UOB, Danske, OCBC…)
  { url: 'https://www.fxstreet.com/rss/analysis', institution: 'FXStreet', source: 'fxstreet',    paged: false },
];

// Parse un flux RSS de recherche → ajoute les items dans `merged`
function _parseResearchFeed(xml, feed, cutoff, merged) {
  const $ = cheerio.load(xml, { xmlMode: true });
  let any = false, old = false;
  $('item').each((_, el) => {
    const title = $('title', el).text().trim();
    const link  = $('link', el).contents().filter((_, n) => n.type === 'text').text().trim()
               || $('guid', el).text().trim();
    if (!title || !link) return;
    const rawDate = $('pubDate', el).text().trim() || $('dc\\:date', el).text().trim();
    const ts = new Date(rawDate).getTime() || 0;
    if (ts && ts < cutoff) { old = true; return; }
    const cats = [];
    $('category', el).each((_, c) => { const t = $(c).text().trim(); if (t) cats.push(t); });
    $('dc\\:subject', el).each((_, s) => { const t = $(s).text().trim(); if (t && !cats.includes(t)) cats.push(t); });
    const desc = $('description', el).text().replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,400);
    const id = 'br-' + Buffer.from(link).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(-16);
    merged.set(id, {
      id, title, url: link,
      timestamp:   ts || Date.now(),
      categories:  cats.slice(0, 8),
      description: desc,
      institution: feed.institution,
      _source:     feed.source,
    });
    any = true;
  });
  return { any, old };
}

async function _fetchBankResearch(full = false) {
  _brFetchedAt = Date.now();
  const cutoff   = Date.now() - BR_MAX_AGE;
  const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  const merged   = new Map(_brCache.map(i => [i.id, i]));

  for (const feed of BR_FEEDS) {
    const maxPages = (feed.paged && full) ? 20 : 1;
    for (let page = 1; page <= maxPages; page++) {
      try {
        const url = page === 1 ? feed.url : `${feed.url}?paged=${page}`;
        const r = await axios.get(url, {
          timeout: 12000,
          headers: { 'User-Agent': UA },
          validateStatus: s => s < 500,
        });
        if (r.status !== 200) break;
        const { any, old } = _parseResearchFeed(r.data, feed, cutoff, merged);
        if (old || !any) break;
      } catch { break; }
    }
  }

  const before = _brCache.length;
  _brCache = [...merged.values()]
    .filter(i => i.timestamp > cutoff)
    .sort((a, b) => b.timestamp - a.timestamp);

  try { fs.writeFileSync(BR_CACHE_FILE, JSON.stringify(_brCache)); } catch {}
  console.log(`[BankResearch] ${_brCache.length} articles (was ${before}) — ${full ? 'full 30d' : 'quick'} refresh`);
}

app.get('/api/bank-research', (_req, res) => {
  res.json(_brCache);
  if (Date.now() - _brFetchedAt > 20 * 60 * 1000) _fetchBankResearch(false).catch(() => {});
});

// Retire les lignes d'attribution de source de tout HTML de rapport (aucune source affichée)
function _stripSource(html) {
  return String(html || '')
    // paragraphes entiers d'attribution
    .replace(/<p[^>]*>\s*(?:this article was written by|written by\b)[\s\S]*?<\/p>/gi, '')
    .replace(/<p[^>]*>[^<]*\bat\s+(?:investinglive|forexlive|think\.ing|fxstreet|actionforex)\.com[^<]*<\/p>/gi, '')
    // phrase d'attribution complète (hors balises), jusqu'au domaine source
    .replace(/(?:this article was written by|written by)\b[^<]*?\b(?:investinglive|forexlive|think\.ing|fxstreet|actionforex)\.com\.?/gi, '')
    .replace(/\bat\s+(?:investinglive|forexlive|think\.ing|fxstreet|actionforex)\.com\.?/gi, '')
    .trim();
}

app.get('/api/bank-research-content', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.startsWith('https://think.ing.com/')) return res.json({ html: '' });
  try {
    const r = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      validateStatus: () => true,
    });
    const $ = cheerio.load(r.data);

    // Extract metadata
    const subtitle = $('meta[property="og:description"]').attr('content')
                  || $('meta[name="description"]').attr('content')
                  || $('h2').first().text().trim()
                  || '';
    const pubDate  = $('time').first().attr('datetime')
                  || $('time').first().text().trim()
                  || $('meta[property="article:published_time"]').attr('content')
                  || '';
    const section  = $('.article-type, .report-type, [class*="article-type"], [class*="section-label"]').first().text().trim()
                  || 'ING Think Research';

    // Extraire le pays/region tag (ING Think affiche ex: "FRANCE", "NETHERLANDS")
    const country = $('[class*="article-tag"], [class*="country"], [class*="region"], .tag-label')
                      .first().text().trim().toUpperCase()
                  || $('meta[property="article:tag"]').attr('content')?.toUpperCase()
                  || '';

    // Extraire le type d'article (Article, Analysis, Report…)
    const articleType = $('.article-type, [class*="article-type"], [class*="content-type"]').first().text().trim()
                      || $('meta[property="og:type"]').attr('content')
                      || 'Article';

    // Remove noise (garder les images et figures)
    $('script,style,nav,header,footer,.cookie-banner,[class*="social"],[class*="related"],[class*="subscribe"],[class*="newsletter"],[class*="sidebar"],[class*="widget"],#comments').remove();

    // Extract body HTML (avec images)
    const body = $('[class*="article-body"], [class*="article__body"], [class*="article-content"], [class*="post-content"], .content-body, article .content, .entry-content, .wysiwyg, .rich-text').first().html()
              || $('main article').first().html()
              || $('main').first().html()
              || '';

    // Corriger les URLs relatives des images → absolues
    const clean = body
      .replace(/src="\/([^"]*)"/g, 'src="https://think.ing.com/$1"')
      .replace(/srcset="\/([^"]*)"/g, 'srcset="https://think.ing.com/$1"')
      .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')   // SVG déco uniquement
      .replace(/\s{3,}/g, '\n')
      .trim();

    // Format date nicely
    let dateFormatted = '';
    if (pubDate) {
      try {
        dateFormatted = new Date(pubDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
      } catch { dateFormatted = pubDate; }
    }

    res.json({ html: _stripSource(clean), subtitle, date: dateFormatted, section, country, articleType });
  } catch (e) {
    res.json({ html: '', error: e.message });
  }
});

// Trusted financial news domains allowed for article content fetch
const ARTICLE_ALLOWED = /^https?:\/\/(www\.)?(forexfactory\.com|reuters\.com|bloomberg\.com|ft\.com|wsj\.com|cnbc\.com|marketwatch\.com|investing\.com|fxstreet\.com|financialjuice\.com|forexlive\.com|dailyfx\.com|tradingeconomics\.com|bbc\.co\.uk\/news|apnews\.com|axios\.com|thehill\.com|politico\.com)\//i;

app.get('/api/article', async (req, res) => {
  const { url, headline } = req.query;
  if (!url || !ARTICLE_ALLOWED.test(url)) return res.json({ points: [], label: 'Info' });
  try {
    const data = await getArticleContent(url, headline || '');
    res.json(data || { points: [], label: 'Info' });
  } catch { res.json({ points: [], label: 'Info' }); }
});
app.get('/api/cot', async (req, res) => {
  const type = ['noncomm','dealer','asset_mgr','lev_money','other_rept'].includes(req.query.type)
    ? req.query.type : 'noncomm';
  try {
    const data = await fetchCOTData(type);
    if (!data || data.length === 0) return res.status(503).json({ error: 'Data unavailable' });
    res.json({ currencies: data, type, updatedAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/community-outlook', async (req, res) => {
  const period = ['H1','H4','D1'].includes(req.query.period) ? req.query.period : 'H1';
  const force  = req.query.force === '1';
  if (force) clearOutlookCache();
  try {
    const data = await fetchCommunityOutlook(period);
    res.json({ symbols: data, period, updatedAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/status', (_req, res) => res.json({
  total: allNews.length,
  lastUpdate: new Date().toISOString(),
  clients: wss.clients.size,
}));

// ─── AI Insights : 4-6 résumés clés d'un rapport (cartes en haut du rapport) ──
const INSIGHTS_FILE = path.join(__dirname, 'cache_insights.json');
const _insightsCache = _loadJsonMap(INSIGHTS_FILE);   // persistant → pas de réappel Gemini à la réouverture
// Secours SANS IA : extrait des phrases clés du rapport → les cartes s'affichent toujours,
// même quand le quota Gemini est épuisé.
function _fallbackInsights(text) {
  let parts = String(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 28 && /[a-z]/.test(s));
  // Tronque proprement les phrases trop longues plutôt que de les exclure
  parts = parts.map(s => s.length > 200 ? s.slice(0, 190).replace(/\s+\S*$/, '') + '…' : s);
  return parts.slice(0, 6).map(s => ({ asset: '', bias: 'neutral', text: s }));
}
app.post('/api/report-insights', async (req, res) => {
  const { id, text } = req.body || {};
  const clean = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length < 60) return res.json({ insights: [] });
  const key = 'v2:' + (id || clean.slice(0, 100));   // v2 = format structuré {asset,bias,text}
  if (_insightsCache.has(key)) return res.json({ insights: _insightsCache.get(key) });
  // Budget Gemini : les insights de rapport comptent comme "analyst". Hors budget → secours extractif.
  if (!aiAllowed('analyst')) return res.json({ insights: _fallbackInsights(clean), fallback: true });
  try {
    aiNote('analyst');
    const prompt = `Tu es analyste de marché. À partir de ce rapport, dégage 4 à 6 "insights" clés, chacun centré sur UN actif/instrument.
Pour chaque insight renvoie un objet :
- "asset": l'instrument concerné (ex: "S&P 500", "Nasdaq 100", "Gold", "Brent Crude", "EUR/USD", "US Dollar", "US 10Y", "Bitcoin")
- "bias": "bullish" | "bearish" | "neutral" (direction/sentiment du marché pour cet actif)
- "text": UNE phrase concise (max 26 mots), en anglais, orientée trader (mécanisme + impact)
Réponds UNIQUEMENT en JSON : {"insights":[{"asset":"...","bias":"...","text":"..."}]}
Rapport :
${clean.slice(0, 4000)}`;
    const out = await ai.generateText(prompt, 900);
    const m = out.match(/\{[\s\S]*\}/);
    const insights = m
      ? (JSON.parse(m[0]).insights || [])
          .filter(o => o && typeof o.text === 'string' && o.text.length > 8)
          .map(o => ({ asset: String(o.asset || '').slice(0, 40), bias: String(o.bias || 'neutral').toLowerCase(), text: o.text }))
          .slice(0, 6)
      : [];
    if (insights.length) {
      _insightsCache.set(key, insights);
      _saveJsonMap(INSIGHTS_FILE, _insightsCache);   // persiste les succès sur disque
      return res.json({ insights });
    }
    res.json({ insights: _fallbackInsights(clean), fallback: true });   // Gemini vide → secours extractif
  } catch (e) {
    console.error('[Insights]', e.message);
    res.json({ insights: _fallbackInsights(clean), fallback: true });   // quota/erreur → secours extractif
  }
});

// ─── AI Analysis endpoint ─────────────────────────────────────────────────────
// Cache persistant (survit aux redémarrages Render) → on ne re-paie jamais Gemini pour la même news
const ANALYSE_CACHE_FILE = path.join(__dirname, 'cache_analyse.json');
const _analyseCache = _loadJsonMap(ANALYSE_CACHE_FILE);
app.post('/api/analyse', async (req, res) => {
  const { headline, category, description } = req.body || {};
  if (!headline) return res.status(400).json({ error: 'headline required' });

  const cacheKey = headline.substring(0, 100);
  if (_analyseCache.has(cacheKey)) return res.json(_analyseCache.get(cacheKey));

  // Secours sans IA (quota épuisé) : on extrait des puces du contenu → l'Analyse n'est jamais vide
  const _analyseFallback = () => _fallbackInsights(String(description || '') + ' ' + headline).map(o => o.text);

  // Budget Gemini : on traite l'analyse à la demande comme une news importante
  if (!aiAllowed('news', { important: true })) return res.json({ bullets: _analyseFallback(), fallback: true });

  try {
    aiNote('news');
    const ctx = description
      ? `\nContext: ${String(description).replace(/<[^>]*>/g, '').substring(0, 600)}`
      : '';
    const text = await ai.generateText(`You are a concise professional financial analyst. Analyse this news for a forex/macro trader.

Headline: ${headline}
Category: ${category}${ctx}

Write 2 to 3 SHORT bullets tailored to THIS specific news (not a template). Rules:
- Name only the instruments genuinely relevant here (e.g. EUR/USD, Brent, XAU/USD, US10Y) — skip if none.
- Explain the concrete causal mechanism for THIS story, not generic phrasing.
- Max 22 words per bullet. Vary the angle per news; do not reuse the same wording across news.
- NO bold, NO markdown, NO asterisks. Plain text only.
- Start each bullet with • . Reply ONLY with the bullets, no preamble.`, 320);
    const bullets = text.split('\n')
      .map(l => l.trim())
      .filter(l => /^[•\-\*]/.test(l))
      .map(l => l.replace(/^[•\-\*]\s*/, ''));

    const result = { bullets: bullets.length ? bullets : [text.trim().substring(0, 200)] };
    _analyseCache.set(cacheKey, result);
    if (_analyseCache.size > 2000) _analyseCache.delete(_analyseCache.keys().next().value);
    _saveJsonMap(ANALYSE_CACHE_FILE, _analyseCache);
    res.json(result);
  } catch (e) {
    console.error('[Analyse API]', e.message);
    res.json({ bullets: _analyseFallback(), fallback: true });   // quota/erreur → secours extractif
  }
});

// ─── Info "tag" : résumé Gemini clair & synthétique (style rapport PMT), cache persistant ──
const INFO_CACHE_FILE = path.join(__dirname, 'cache_news_info.json');
const _infoCache = _loadJsonMap(INFO_CACHE_FILE);
app.post('/api/news-info', async (req, res) => {
  const { id, headline, category, description } = req.body || {};
  const rawDesc = String(description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!headline || rawDesc.length < 30) return res.json({ bullets: [] });

  // Clé de cache : id de la news si fourni, sinon empreinte du titre
  const cacheKey = id || headline.substring(0, 120);
  if (_infoCache.has(cacheKey)) return res.json(_infoCache.get(cacheKey));

  // Budget Gemini : semaine = news IMPORTANTES uniquement (50%), week-end = OFF
  if (!aiAllowed('news', { important: !!req.body.important })) return res.json({ bullets: [] });

  try {
    aiNote('news');
    const text = await ai.generateText(`You are an editor for a professional financial news terminal (trading-desk style, like Newsquawk).
Summarise the information below into 2 to 3 SHORT bullets, tailored to THIS specific news (never a template).
STRICT rules:
- Keep the exact key figures (percentages, levels, dates) but stay concise.
- Capture what is ACTUALLY new/important in THIS story — vary the angle per news, do not reuse wording.
- One idea per bullet, max 24 words, neutral factual tone (no investment advice).
- NO bold, NO markdown, NO asterisks — plain text only.
- Same language as the source (usually English → answer in English).
- No preamble, no conclusion: reply ONLY with the bullets, each starting with •.

Headline: ${headline}
Category: ${category || '—'}
Content: ${rawDesc.substring(0, 900)}`, 400);

    const bullets = text.split('\n')
      .map(l => l.trim())
      .filter(l => /^[•\-\*]/.test(l))
      .map(l => l.replace(/^[•\-\*]\s*/, '').trim())
      .filter(Boolean);

    const result = { bullets };
    if (bullets.length) {
      _infoCache.set(cacheKey, result);
      if (_infoCache.size > 3000) _infoCache.delete(_infoCache.keys().next().value);
      _saveJsonMap(INFO_CACHE_FILE, _infoCache);
    }
    res.json(result);
  } catch (e) {
    console.error('[News-Info API]', e.message);
    res.json({ bullets: [] });   // l'UI retombe sur la description brute
  }
});

// ─── Réaction : explication Gemini du mouvement de marché (cache persistant) ───
const REACT_CACHE_FILE = path.join(__dirname, 'cache_reaction.json');
const _reactCache = _loadJsonMap(REACT_CACHE_FILE);
app.post('/api/reaction-explain', async (req, res) => {
  const { id, headline, moves } = req.body || {};
  if (!headline || !moves) return res.json({ text: '' });

  const cacheKey = id || headline.substring(0, 120);
  if (_reactCache.has(cacheKey)) return res.json(_reactCache.get(cacheKey));

  // Budget Gemini : la réaction concerne une news qui a bougé le marché → importante
  if (!aiAllowed('news', { important: true })) return res.json({ text: '' });

  try {
    aiNote('news');
    const text = await ai.generateText(`You are a markets reporter on a trading desk. In 1 to 2 short sentences (max 40 words total), explain the market reaction to the news below: link the price moves to the headline (the causal mechanism). Neutral tone, no advice. Same language as the headline (usually English). Reply with the sentence(s) only, no preamble.

Headline: ${headline}
Observed moves: ${String(moves).slice(0, 300)}`, 160);

    const clean = text.replace(/^[•\-\*\s]+/, '').trim();
    const result = { text: clean };
    if (clean) {
      _reactCache.set(cacheKey, result);
      if (_reactCache.size > 2000) _reactCache.delete(_reactCache.keys().next().value);
      _saveJsonMap(REACT_CACHE_FILE, _reactCache);
    }
    res.json(result);
  } catch (e) {
    console.error('[Reaction API]', e.message);
    res.json({ text: '' });
  }
});

// ─── Analyst Outlook endpoint ────────────────────────────────────────────────
const _outlookCache = new Map();

app.post('/api/analyst-outlook', async (req, res) => {
  const { pair, cb, headlines } = req.body || {};
  if (!pair) return res.status(400).json({ error: 'pair required' });

  const cacheKey = `${pair}:${(headlines || '').slice(0, 120)}`;
  if (_outlookCache.has(cacheKey)) return res.json(_outlookCache.get(cacheKey));

  try {
    const text = await ai.generateText(`You are a professional forex analyst. Provide a structured market outlook for ${pair} based on the following recent headlines.

Central banks: ${cb || 'N/A'}
Recent headlines (last 24h):
${headlines || 'None available'}

Respond with ONLY valid JSON in this exact format:
{
  "bias": "bullish|bearish|neutral",
  "confidence": 65,
  "summary": "One sentence overall bias summary (max 30 words)",
  "bullets": [
    "Bullet 1: specific driver with instrument impact",
    "Bullet 2: specific driver with instrument impact",
    "Bullet 3: specific driver with instrument impact"
  ],
  "levels": [
    {"type": "resistance", "price": "1.0950", "note": "50-day EMA / key pivot"},
    {"type": "support",    "price": "1.0820", "note": "200-day EMA"},
    {"type": "support",    "price": "1.0750", "note": "Monthly low"}
  ]
}
Be specific. Use actual levels where known. Max 3 levels. Output only valid JSON.`, 600);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');
    const result = JSON.parse(jsonMatch[0]);
    _outlookCache.set(cacheKey, result);
    if (_outlookCache.size > 200) _outlookCache.delete(_outlookCache.keys().next().value);
    res.json(result);
  } catch (e) {
    console.error('[Analyst Outlook]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── London Open Preparation Report ─────────────────────────────────────────

let _londonPrepCache = null;
let _londonPrepTs    = 0;
const LONDON_PREP_TTL = 30 * 60 * 1000; // 30 min cache

function buildTemplateLondonPrep(sections, allRecent) {
  const now     = new Date();
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const dateStr = now.toLocaleDateString('en-GB',  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const toItems = (arr, max = 5) => arr.slice(0, max).map(i => `${i.time} — ${i.headline}`);

  return {
    title: `London Open Preparation — ${dateStr}`,
    generatedAt: timeStr,
    newsCount: allRecent.length,
    sections: [
      { id:'geopolitical', title:'GEOPOLITICAL RISK', icon:'⚑',  items: toItems(sections.geopolitical) },
      { id:'centralbanks', title:'CENTRAL BANKS',     icon:'🏛', items: toItems(sections.centralBanks) },
      { id:'apac',         title:'APAC SESSION WRAP', icon:'🌏', items: toItems(sections.asian)        },
      { id:'fx',           title:'FX',                 icon:'💱', items: toItems(sections.fx)           },
      { id:'fixedincome',  title:'FIXED INCOME',       icon:'📊', items: toItems(sections.fixedIncome)  },
      { id:'commodities',  title:'COMMODITIES',        icon:'🛢', items: [...toItems(sections.energy,3), ...toItems(sections.metals,2)] },
      { id:'data',         title:'DATA RECAP',         icon:'📋', items: toItems(sections.data)         },
      { id:'notable',      title:'NOTABLE COMMENTS',   icon:'💬', items: toItems(sections.notable)      },
    ].filter(s => s.items.length > 0),
    keyRisks: [],
  };
}

async function generateLondonPrep(force = false) {
  if (!force && _londonPrepCache && Date.now() - _londonPrepTs < LONDON_PREP_TTL) return _londonPrepCache;

  const cutoff     = Date.now() - 14 * 60 * 60 * 1000; // last 14 hours
  const recentNews = allNews.filter(i => i.timestamp > cutoff);

  const CB_CATS = new Set(['Fed','ECB','BoJ','BoE','BoC','RBA','SNB','RBNZ']);
  const DATA_CATS = new Set(['Economic Commentary','EU Data','US Data','UK Data',
    'Swiss Data','Japanese Data','Canadian Data','Australian Data','Chinese Data']);

  const sections = {
    geopolitical: recentNews.filter(i => i.category === 'Geopolitical' ||
      /iran|russia|ukraine|israel|hamas|nato|north\s+korea|ceasefire|nuclear\s+deal/i.test(i.headline)),
    centralBanks: recentNews.filter(i => CB_CATS.has(i.category)),
    fx:           recentNews.filter(i => i.category === 'FX Flows' || i.category === 'Market Analysis'),
    fixedIncome:  recentNews.filter(i => i.category === 'Fixed Income'),
    energy:       recentNews.filter(i => i.category === 'Energy & Power'),
    metals:       recentNews.filter(i => i.category === 'Metals'),
    data:         recentNews.filter(i => DATA_CATS.has(i.category) && i.priority === 'high'),
    asian:        recentNews.filter(i => i.category === 'Asian News' ||
      /\b(?:japan|tokyo|nikkei|boj|china|pboc|shanghai|hong kong|singapore|asx|australia|rba|rbnz|new zealand)\b/i.test(i.headline)),
    trade:        recentNews.filter(i => i.category === 'Trade'),
    notable:      recentNews.filter(i => CB_CATS.has(i.category) && /says?|said|notes?|warns?|signals?|sees?\s/i.test(i.headline)),
  };

  const summarise = (items, max = 6) =>
    items.length ? items.slice(0, max).map(i => `[${i.time}] ${i.headline}`).join('\n') : 'Nothing significant';

  const dateStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
  });
  const timeStr = new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  });

  const prompt = `You are a professional market analyst writing a London Open preparation bulletin (style: Newsquawk/Rannforex). Today is ${dateStr}, ${timeStr} Paris.

OVERNIGHT HEADLINES (last 14h):
GEOPOLITICAL:\n${summarise(sections.geopolitical)}
CENTRAL BANKS:\n${summarise(sections.centralBanks)}
FX / MACRO:\n${summarise(sections.fx)}
FIXED INCOME:\n${summarise(sections.fixedIncome)}
ENERGY:\n${summarise(sections.energy)}
METALS:\n${summarise(sections.metals)}
DATA:\n${summarise(sections.data)}
ASIAN SESSION:\n${summarise(sections.asian)}
TRADE:\n${summarise(sections.trade)}

Write a structured London Open prep report. Return ONLY valid JSON:
{
  "title": "London Open Preparation — ${dateStr}",
  "generatedAt": "${timeStr} CET",
  "headline": "One-sentence overall market bias for London open",
  "sections": [
    {"id":"geopolitical","title":"GEOPOLITICAL RISK","icon":"⚑","content":"2-3 sentence summary","items":["bullet 1","bullet 2","bullet 3"]},
    {"id":"centralbanks","title":"CENTRAL BANKS","icon":"🏛","content":"2-3 sentence summary","items":["bullet 1","bullet 2","bullet 3"]},
    {"id":"apac","title":"APAC SESSION WRAP","icon":"🌏","content":"2-3 sentence summary","items":["bullet 1","bullet 2"]},
    {"id":"fx","title":"FX","icon":"💱","content":"2-3 sentence summary","items":["bullet 1","bullet 2","bullet 3"]},
    {"id":"fixedincome","title":"FIXED INCOME","icon":"📊","content":"1-2 sentence summary","items":["bullet 1","bullet 2"]},
    {"id":"commodities","title":"COMMODITIES","icon":"🛢","content":"2-3 sentence summary","items":["bullet 1","bullet 2","bullet 3"]},
    {"id":"data","title":"DATA RECAP","icon":"📋","content":"Summary of key data released","items":["bullet 1","bullet 2"]},
    {"id":"notable","title":"NOTABLE CB COMMENTS","icon":"💬","content":"Key central banker statements","items":["bullet 1","bullet 2"]}
  ],
  "keyRisks": ["risk 1","risk 2","risk 3"],
  "watchlist": [{"pair":"EUR/USD","bias":"bearish","reason":"ECB dovish"},{"pair":"USD/JPY","bias":"bullish","reason":"BoJ hold"}]
}
Be specific — name instruments (EUR/USD, DXY, XAU/USD, Brent, US10Y) and levels where known. Skip sections with no relevant news. Only output valid JSON.`;

  try {
    const text = await ai.generateText(prompt, 2500);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const report = JSON.parse(jsonMatch[0]);
    report.newsCount = recentNews.length;
    _londonPrepCache = report;
    _londonPrepTs    = Date.now();
    console.log('[LondonPrep] Report generated via AI');
    return report;
  } catch (e) {
    console.error('[LondonPrep] AI failed, using template:', e.message);
    const fallback = buildTemplateLondonPrep(sections, recentNews);
    _londonPrepCache = fallback;
    _londonPrepTs    = Date.now();
    return fallback;
  }
}

app.get('/api/london-prep', async (req, res) => {
  try {
    const force  = req.query.force === '1';
    const report = await generateLondonPrep(force);
    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Auto-generate London prep at 08:45 Paris time every day
(function scheduleLondonPrep() {
  function msToNext0845Paris() {
    const now = new Date();
    const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const target = new Date(paris);
    target.setHours(8, 45, 0, 0);
    if (paris >= target) target.setDate(target.getDate() + 1); // already past — schedule for tomorrow
    return target.getTime() - paris.getTime();
  }
  const delay = msToNext0845Paris();
  console.log(`[LondonPrep] Auto-generation scheduled in ${Math.round(delay / 60000)} min`);
  setTimeout(function run() {
    generateLondonPrep(true)
      .then(() => console.log('[LondonPrep] Auto-generated at 08:45 Paris'))
      .catch(e  => console.error('[LondonPrep] Auto-generation failed:', e.message));
    setInterval(() => {
      generateLondonPrep(true)
        .then(() => console.log('[LondonPrep] Auto-generated at 08:45 Paris'))
        .catch(e  => console.error('[LondonPrep] Auto-generation failed:', e.message));
    }, 24 * 60 * 60 * 1000); // every 24h
  }, delay);
})();

// ─── PMT Daily US Opening Briefing ──────────────────────────────────────────
// Auto-generated at 14:45 Paris (≈ 08:45 NY) and injected directly into the news feed

const _US_BRIEFING_ID_PREFIX = 'pmt-us-briefing-';

async function generateUSOpeningBriefing() {
  const dateStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
  });
  const shortDate = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
  });
  const timeStr = new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  });

  // Deduplicate: don't generate if already in feed for today
  const todayPrefix = _US_BRIEFING_ID_PREFIX + new Date().toISOString().slice(0, 10);
  if (allNews.some(i => (i.id || '').startsWith(todayPrefix))) {
    console.log('[USBriefing] Already generated today, skipping.');
    return;
  }

  const cutoff     = Date.now() - 8 * 60 * 60 * 1000; // last 8h (overnight + morning)
  const recentNews = allNews.filter(i => i.timestamp > cutoff);

  const CB_CATS   = new Set(['Fed','ECB','BoJ','BoE','BoC','RBA','SNB','RBNZ']);
  const DATA_CATS = new Set(['Economic Commentary','EU Data','US Data','UK Data',
    'Swiss Data','Japanese Data','Canadian Data','Australian Data','Chinese Data']);

  const summarise = (items, max = 5) =>
    items.length ? items.slice(0, max).map(i => `• ${i.headline}`).join('\n') : 'Nothing significant';

  const sections = {
    cb:   recentNews.filter(i => CB_CATS.has(i.category)),
    data: recentNews.filter(i => DATA_CATS.has(i.category) && i.priority === 'high'),
    geo:  recentNews.filter(i => i.category === 'Geopolitical'),
    fx:   recentNews.filter(i => i.category === 'FX Flows' || i.category === 'Market Analysis'),
    nrg:  recentNews.filter(i => i.category === 'Energy & Power' || i.category === 'Metals'),
    trade:recentNews.filter(i => i.category === 'Trade'),
  };

  const prompt = `You are a professional market analyst at a prime brokerage writing the daily US opening briefing (08:45 NY). Style: Newsquawk — concise, factual, actionable. Today: ${dateStr}.

OVERNIGHT / MORNING NEWS:
CENTRAL BANKS:\n${summarise(sections.cb)}
KEY DATA:\n${summarise(sections.data)}
GEOPOLITICAL:\n${summarise(sections.geo)}
FX / MACRO:\n${summarise(sections.fx)}
ENERGY / METALS:\n${summarise(sections.nrg)}
TRADE:\n${summarise(sections.trade)}

Write 6-10 crisp bullet points covering:
1. Overnight sentiment / risk tone
2. Key CB headlines and implications for USD, EUR, GBP, JPY
3. Notable data releases and market impact
4. Geopolitical risk drivers
5. Energy/commodity key levels
6. Key events/speakers to watch today

Rules: start each bullet with a dash (-). Be specific (name pairs, levels, bps). No fluff. Max 10 bullets. Plain text only, no markdown.`;

  try {
    const text    = (await ai.generateText(prompt, 900)).trim();
    const bullets = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('-')).join('\n');
    const description = bullets || text;

    const now  = Date.now();
    const item = {
      id:          todayPrefix + '-' + now,
      headline:    `PRIMER - PMT Daily US Opening News — ${shortDate}`,
      description,
      category:    'Market Analysis',
      source:      'PMT',
      time:        timeStr,
      timestamp:   now,
      priority:    'normal',
      tags:        ['US', 'Market Analysis'],
      _briefing:   true,
    };

    allNews = [item, ...allNews].slice(0, 2000);
    saveHistory();
    broadcast({ type: 'news_update', items: [{ ...item, _new: true }], total: allNews.length });
    console.log(`[USBriefing] Generated & pushed: "${item.headline}"`);
  } catch (e) {
    console.error('[USBriefing] AI failed:', e.message);
  }
}

// Auto-generate at 14:45 Paris time every day (= ~08:45 New York)
(function scheduleUSBriefing() {
  function msToNext1445Paris() {
    const now   = new Date();
    const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const target = new Date(paris);
    target.setHours(14, 45, 0, 0);
    if (paris >= target) target.setDate(target.getDate() + 1);
    return target.getTime() - paris.getTime();
  }
  const delay = msToNext1445Paris();
  console.log(`[USBriefing] Auto-generation scheduled in ${Math.round(delay / 60000)} min`);
  setTimeout(function run() {
    generateUSOpeningBriefing()
      .catch(e => console.error('[USBriefing] Auto-generation failed:', e.message));
    setInterval(() => {
      generateUSOpeningBriefing()
        .catch(e => console.error('[USBriefing] Auto-generation failed:', e.message));
    }, 24 * 60 * 60 * 1000);
  }, delay);
})();

// Manual trigger endpoint
app.get('/api/us-briefing/generate', async (req, res) => {
  try {
    await generateUSOpeningBriefing();
    res.json({ ok: true, message: 'US Opening briefing generated and pushed to feed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Generic PMT daily briefing generator ────────────────────────────────────

function generateDailyBriefing({ idPrefix, reportType, cutoffHours, force = false, buildFn, dateOffset = 0 }) {
  // dateOffset=0 → today, dateOffset=1 → yesterday
  const targetTs  = Date.now() - dateOffset * 24 * 60 * 60 * 1000;
  const targetDate = new Date(targetTs);
  const dateKey   = new Date(targetDate.toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
                      .toISOString().slice(0, 10);

  const todayPrefix = idPrefix + dateKey;
  if (!force && allNews.some(i => (i.id || '').startsWith(todayPrefix))) {
    console.log(`[PMT] ${reportType} already generated for ${dateKey}, skipping.`);
    return;
  }
  // Remove existing same-day briefings (replace on force, or clean stale)
  if (force) allNews = allNews.filter(i => !(i.id || '').startsWith(todayPrefix));

  const now     = Date.now();
  // Shift the window back by dateOffset days for past reports
  const windowEnd   = now - dateOffset * 24 * 60 * 60 * 1000;
  const cutoff      = windowEnd - cutoffHours * 60 * 60 * 1000;
  const recent      = allNews.filter(i => i.timestamp > cutoff && i.timestamp <= windowEnd && !i._briefing);
  const timeStr     = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const dateStr     = targetDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

  const CB_CATS   = new Set(['Fed','ECB','BoJ','BoE','BoC','RBA','SNB','RBNZ','PBOC']);
  const DATA_CATS = new Set(['Economic Commentary','EU Data','US Data','UK Data','Swiss Data','Japanese Data','Canadian Data','Australian Data','Chinese Data','New Zealand Data']);

  const s = {
    cb:    recent.filter(i => CB_CATS.has(i.category)),
    data:  recent.filter(i => DATA_CATS.has(i.category)),
    hdata: recent.filter(i => DATA_CATS.has(i.category) && (i.priority === 'high' || i.priority === 'urgent')),
    geo:   recent.filter(i => i.category === 'Geopolitical'),
    fx:    recent.filter(i => i.category === 'FX Flows' || i.category === 'Market Analysis'),
    nrg:   recent.filter(i => i.category === 'Energy & Power' || i.category === 'Metals'),
    trade: recent.filter(i => i.category === 'Trade'),
    asian: recent.filter(i => i.category === 'Asian News'),
    all:   recent,
  };

  const { subtitle, bullets, tags } = buildFn({ dateStr, timeStr, s, reportType });

  const description = bullets
    .filter(Boolean)
    .map(b => `- ${b.replace(/^[-•·]\s*/,'').trim()}`)
    .join('\n');

  const item = {
    id:          todayPrefix + '-' + now,
    headline:    `PRIMER — ${subtitle}`,
    description,
    category:    'Market Analysis',
    source:      'PMT',
    time:        timeStr,
    timestamp:   now,
    priority:    'normal',
    tags:        tags.length ? tags : [reportType],
    _briefing:   true,
    _reportType: reportType,
  };

  allNews = [item, ...allNews].slice(0, 2000);
  saveHistory();
  broadcast({ type: 'news_update', items: [{ ...item, _new: true }], total: allNews.length });
  console.log(`[PMT] "${item.headline}" → ${bullets.length} bullets (${recent.length} items)`);
  return item;
}

// ─── Template helpers ─────────────────────────────────────────────────────────

function _topLines(items, n) { return items.slice(0, n).map(i => i.headline).filter(Boolean); }

function _activeCBs(items) {
  const CBS = new Set(['Fed','ECB','BoJ','BoE','BoC','RBA','SNB','RBNZ','PBOC']);
  const seen = new Set();
  items.forEach(i => { if (CBS.has(i.category)) seen.add(i.category); });
  return [...seen];
}

function _briefingSubtitle(reportType, s, preferredCBs = null) {
  const chunks = [];

  // ── CB event: prioritise session-relevant central banks ──
  let cbList = s.cb;
  if (preferredCBs && preferredCBs.length && s.cb.length) {
    const pref = s.cb.filter(i => preferredCBs.includes(i.category));
    const rest = s.cb.filter(i => !preferredCBs.includes(i.category));
    cbList = pref.length ? [...pref, ...rest] : s.cb;
  }

  if (cbList.length) {
    const item = cbList[0];
    const h    = item.headline;
    const cb   = item.category;
    let nugget;
    if      (/\bcut(s|ting)?\b|\blower(ed|s)?\b|\breduced?\b/i.test(h))       nugget = `${cb} cuts`;
    else if (/\bhike(s|d)?\b|\braise(s|d)?\b|\bincreased?\b/i.test(h))        nugget = `${cb} hikes`;
    else if (/\bholds?\b|\bpause(s|d)?\b|\bunchanged\b|\bsteady\b/i.test(h))  nugget = `${cb} holds`;
    else if (/\bhawkish\b/i.test(h))                                            nugget = `${cb} hawkish`;
    else if (/\bdovish\b/i.test(h))                                             nugget = `${cb} dovish`;
    else if (cbList.length > 1) { const other = cbList.find(x => x.category !== cb); nugget = other ? `${cb} & ${other.category}` : cb; }
    else {
      const short = h.replace(new RegExp(`^${cb}'?s?\\s*[-:]?\\s*`, 'i'), '').substring(0, 36).replace(/\s\S+$/, '').trim();
      nugget = short ? `${cb}: ${short}` : cb;
    }
    if (nugget) chunks.push(nugget);
  }

  // ── High-impact data: extract value + beats/misses ──
  if (s.hdata.length) {
    const di = s.hdata[0];
    const h  = di.headline;
    // Strip "XX Data:" prefix (e.g. "EU Data: German CPI..." → "German CPI...")
    const stripped = h.replace(/^(?:EU|US|UK|Swiss|Japanese|Canadian|Australian|Chinese|New Zealand)\s+Data\s*:\s*/i, '').trim();
    // Extract data name: everything before the first data qualifier / number / month abbrev
    const nameM = stripped.match(/^([A-Za-z][A-Za-z\s''-]{3,29}?)(?=\s*(?:YoY|MoM|y\/y|m\/m|Prel|Flash|Final|Actual|Revised|H[12]\b|Q[1-4]\b|\d|vs?\.?|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\())/i);
    const catFallback = di.category.replace(/\s+Data$/, '').replace('Economic Commentary', 'Data').replace('New Zealand', 'NZ');
    const cat = nameM ? nameM[1].trim().replace(/\s+$/, '') : catFallback;
    const valMatch = h.match(/(\d[\d.,]+\s*%)/);
    const val = valMatch ? valMatch[1].trim() : '';
    let result = '';
    if      (/above|beat(s|en)?|better|stronger|upside/i.test(h))           result = 'beats';
    else if (/below|miss(es|ed)?|weaker|downside|soft|disappoint/i.test(h)) result = 'misses';
    if (val && result)     chunks.push(`${cat} ${val} ${result}`);
    else if (val)          chunks.push(`${cat} ${val}`);
    else if (result)       chunks.push(`${cat} ${result}`);
    else                   chunks.push(stripped.substring(0, 44).replace(/\s\S+$/, '').trim());
  }

  // ── Fallback: geo / trade / fx / top category ──
  if (!chunks.length) {
    if (s.geo.length) {
      chunks.push(s.geo[0].headline.substring(0, 52).replace(/\s\S+$/, '').trim());
    } else if (s.trade.length > 1) {
      chunks.push('Trade tensions');
    } else if (s.fx.length) {
      chunks.push(s.fx[0].headline.substring(0, 48).replace(/\s\S+$/, '').trim());
    } else if (s.all.length) {
      const counts = {};
      s.all.forEach(i => { if (i.category) counts[i.category] = (counts[i.category]||0)+1; });
      const top = Object.entries(counts).sort((a, b) => b[1]-a[1])[0];
      if (top) chunks.push(top[0]);
    }
  }

  return `${reportType}: ${chunks.slice(0, 2).join(' · ') || 'Markets Update'}`;
}

function _briefingTags(s, extra = []) {
  const out = new Set(extra);
  _activeCBs(s.cb).forEach(c => out.add(c));
  s.hdata.slice(0,3).forEach(i => out.add(i.category.replace(' Data','').replace('Economic Commentary','Macro')));
  if (s.geo.length)   out.add('Geopolitical');
  if (s.nrg.length)   out.add('Commodities');
  if (s.trade.length) out.add('Trade');
  if (s.fx.length)    out.add('FX');
  return [...out].slice(0, 8);
}

function _pushBullets(bullets, heading, items, max) {
  if (!items.length) return;
  const lines = _topLines(items, max);
  bullets.push(`${heading}: ${lines[0]}`);
  lines.slice(1).forEach(l => bullets.push(`  ↳ ${l}`));
}

// ─── Génération hebdomadaire (ID par semaine ISO) ────────────────────────────
function generateWeeklyBriefing({ idPrefix, reportType, force = false, buildFn }) {
  const now  = Date.now();
  const d    = new Date(now);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const wk   = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  const weekKey    = `${d.getFullYear()}-W${String(wk).padStart(2,'0')}`;
  const weekPrefix = idPrefix + weekKey;

  if (!force && allNews.some(i => (i.id || '').startsWith(weekPrefix))) {
    console.log(`[PMT] ${reportType} already generated for ${weekKey}, skipping.`); return;
  }
  if (force) allNews = allNews.filter(i => !(i.id || '').startsWith(weekPrefix));

  const cutoff  = now - 7 * 24 * 60 * 60 * 1000;
  const recent  = allNews.filter(i => i.timestamp > cutoff && !i._briefing);
  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Paris' });
  const dateStr = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric', timeZone:'Europe/Paris' });

  const CB_CATS   = new Set(['Fed','ECB','BoJ','BoE','BoC','RBA','SNB','RBNZ','PBOC']);
  const DATA_CATS = new Set(['Economic Commentary','EU Data','US Data','UK Data','Swiss Data','Japanese Data','Canadian Data','Australian Data','Chinese Data','New Zealand Data']);
  const s = {
    cb:    recent.filter(i => CB_CATS.has(i.category)),
    data:  recent.filter(i => DATA_CATS.has(i.category)),
    hdata: recent.filter(i => DATA_CATS.has(i.category) && (i.priority === 'high' || i.priority === 'urgent')),
    geo:   recent.filter(i => i.category === 'Geopolitical'),
    fx:    recent.filter(i => i.category === 'FX Flows' || i.category === 'Market Analysis'),
    nrg:   recent.filter(i => i.category === 'Energy & Power' || i.category === 'Metals'),
    trade: recent.filter(i => i.category === 'Trade'),
    asian: recent.filter(i => i.category === 'Asian News'),
    all:   recent,
  };

  const { subtitle, bullets, tags } = buildFn({ dateStr, timeStr, s, reportType });
  const description = bullets.filter(Boolean).map(b => `- ${b.replace(/^[-•·]\s*/,'').trim()}`).join('\n');
  const item = {
    id: weekPrefix + '-' + now, headline: `PRIMER — ${subtitle}`, description,
    category: 'Market Analysis', source: 'PMT', time: timeStr, timestamp: now,
    priority: 'normal', tags: tags.length ? tags : [reportType],
    _briefing: true, _reportType: reportType,
  };
  allNews = [item, ...allNews].slice(0, 2000);
  saveHistory();
  broadcast({ type: 'news_update', items: [{ ...item, _new: true }], total: allNews.length });
  console.log(`[PMT] "${item.headline}" → ${bullets.length} bullets (7d window)`);
  return item;
}

// ─── Report builders ──────────────────────────────────────────────────────────

function buildUSOpening({ dateStr, s, reportType }) {
  const bullets = [];
  bullets.push(`US Opening — ${s.all.length} events tracked · ${dateStr}`);
  _pushBullets(bullets, 'Fed & Central Banks', s.cb, 3);
  _pushBullets(bullets, 'US Data', s.hdata.length ? s.hdata : s.data, 3);
  _pushBullets(bullets, 'Geopolitical', s.geo, 2);
  _pushBullets(bullets, 'Trade', s.trade, 2);
  _pushBullets(bullets, 'Equity & FX Outlook', s.fx, 2);
  _pushBullets(bullets, 'Commodities', s.nrg, 2);
  return { subtitle: _briefingSubtitle(reportType, s, ['Fed','BoC']), bullets, tags: _briefingTags(s, ['US Opening','USD']) };
}

function buildAsiaOpening({ dateStr, s, reportType }) {
  const bullets = [];
  bullets.push(`Asia Opening — ${s.all.length} events in review · ${dateStr}`);
  _pushBullets(bullets, 'BoJ / RBA / PBOC Watch', s.cb, 3);
  _pushBullets(bullets, 'Asian Session Headlines', s.asian, 3);
  _pushBullets(bullets, 'Overnight Data', s.hdata.length ? s.hdata : s.data, 3);
  _pushBullets(bullets, 'Geopolitical', s.geo, 2);
  _pushBullets(bullets, 'Commodities', s.nrg, 2);
  _pushBullets(bullets, 'Trade', s.trade, 1);
  // Titre façon DTP (généré après la clôture NY, à l'ouverture Asie-Pacifique)
  const subtitle = `DTP Daily Asia-Pac Opening News - ${dateStr}`;
  return { subtitle, bullets, tags: _briefingTags(s, ['Asia Opening', 'JPY', 'AUD']) };
}

function buildLondonRecap({ dateStr, s, reportType }) {
  const bullets = [];
  bullets.push(`London Session Recap — ${s.all.length} items tracked · ${dateStr}`);
  _pushBullets(bullets, 'BoE / ECB Commentary', s.cb, 3);
  _pushBullets(bullets, 'European Data Outcomes', s.hdata.length ? s.hdata : s.data, 3);
  _pushBullets(bullets, 'Geopolitical', s.geo, 2);
  _pushBullets(bullets, 'EUR/GBP FX', s.fx, 2);
  _pushBullets(bullets, 'Commodities', s.nrg, 2);
  _pushBullets(bullets, 'Trade', s.trade, 1);
  return { subtitle: _briefingSubtitle(reportType, s, ['BoE','ECB','SNB']), bullets, tags: _briefingTags(s, ['London Recap','EUR','GBP']) };
}

function buildUSRecap({ dateStr, s, reportType }) {
  const bullets = [];
  bullets.push(`US Session Recap — ${s.all.length} items tracked · ${dateStr}`);
  _pushBullets(bullets, 'Fed Speakers & Policy', s.cb, 3);
  _pushBullets(bullets, 'Key US Data', s.hdata.length ? s.hdata : s.data, 3);
  _pushBullets(bullets, 'Geopolitical', s.geo, 2);
  _pushBullets(bullets, 'Equities & Risk Tone', s.fx, 2);
  _pushBullets(bullets, 'Energy & Metals', s.nrg, 2);
  _pushBullets(bullets, 'Trade', s.trade, 1);
  return { subtitle: _briefingSubtitle(reportType, s, ['Fed']), bullets, tags: _briefingTags(s, ['US Recap','S&P 500','USD']) };
}

function buildDailyReview({ dateStr, s, reportType }) {
  const bullets = [];
  bullets.push(`Daily Review — ${s.all.length} events · CB: ${s.cb.length} · Data: ${s.data.length} · Geo: ${s.geo.length} · ${dateStr}`);
  _pushBullets(bullets, 'Central Banks', s.cb, 4);
  _pushBullets(bullets, 'High-Impact Data', s.hdata.length ? s.hdata : s.data, 4);
  _pushBullets(bullets, 'Geopolitical', s.geo, 3);
  _pushBullets(bullets, 'Trade', s.trade, 2);
  _pushBullets(bullets, 'FX & Markets', s.fx, 2);
  _pushBullets(bullets, 'Commodities', s.nrg, 2);
  _pushBullets(bullets, 'Asian Markets', s.asian, 1);
  // Daily Review: pick the single most-active CB overall (no preference)
  return { subtitle: _briefingSubtitle(reportType, s), bullets, tags: _briefingTags(s, ['Daily Review','Macro','Multi-Asset']) };
}

// ─── 4 nouveaux builders ──────────────────────────────────────────────────────

// London Opening Preparation (07:45 Paris — avant l'ouverture de Londres)
function buildLondonOpening({ dateStr, s, reportType }) {
  const bullets = [];
  bullets.push(`London Opening — ${s.all.length} events reviewed · ${dateStr}`);
  _pushBullets(bullets, 'BoE / ECB Watch',       s.cb, 3);
  _pushBullets(bullets, 'Overnight Headlines',   [...s.asian, ...s.geo].slice(0,5), 3);
  _pushBullets(bullets, 'European Data Preview', s.hdata.length ? s.hdata : s.data, 3);
  _pushBullets(bullets, 'Geopolitical',          s.geo, 2);
  _pushBullets(bullets, 'EUR/GBP/CHF Setup',     s.fx, 2);
  _pushBullets(bullets, 'Oil & Gold',            s.nrg, 2);
  _pushBullets(bullets, 'Trade',                 s.trade, 1);
  return { subtitle: _briefingSubtitle(reportType, s, ['BoE','ECB','SNB']), bullets, tags: _briefingTags(s, ['London Opening','EUR','GBP']) };
}

// Daily Market Recap (22:00 Paris — après clôture US)
function buildDailyMarketRecap({ dateStr, s, reportType }) {
  const bullets = [];
  bullets.push(`Daily Market Recap — ${s.all.length} items · ${dateStr}`);
  _pushBullets(bullets, 'Global Market Sentiment', [...s.fx, ...s.nrg].slice(0,4), 2);
  _pushBullets(bullets, 'Central Banks & Policy',  s.cb, 4);
  _pushBullets(bullets, 'Key Macro Releases',      s.hdata.length >= 2 ? s.hdata : s.data, 4);
  _pushBullets(bullets, 'Geopolitical Events',     s.geo, 4);
  _pushBullets(bullets, 'FX Markets',              s.fx, 3);
  _pushBullets(bullets, 'Energy & Commodities',    s.nrg, 3);
  _pushBullets(bullets, 'Trade & Tariffs',         s.trade, 2);
  _pushBullets(bullets, 'Key Watch Next Session',  [...s.cb, ...s.hdata].slice(0,3), 2);
  return { subtitle: _briefingSubtitle(reportType, s, ['Fed','ECB','BoJ','BoE']), bullets, tags: _briefingTags(s, ['Daily Recap','USD','EUR','Gold','Oil']) };
}

// Global Economic Weekly (vendredi 18:00 Paris — revue macro hebdomadaire)
function buildGlobalEconomicWeekly({ dateStr, s, reportType }) {
  const bullets = [];
  bullets.push(`Global Economic Weekly — ${s.all.length} items · Week ending ${dateStr}`);
  _pushBullets(bullets, 'Central Bank Highlights', s.cb, 6);
  _pushBullets(bullets, 'Major Data Releases',     s.hdata.length >= 3 ? s.hdata : s.data, 6);
  _pushBullets(bullets, 'Geopolitical Developments', s.geo, 5);
  _pushBullets(bullets, 'Trade & Sanctions',       s.trade, 4);
  _pushBullets(bullets, 'FX & Risk Trends',        s.fx, 4);
  _pushBullets(bullets, 'Commodities',             s.nrg, 3);
  return { subtitle: _briefingSubtitle(reportType, s, ['Fed','ECB','BoJ','BoE','BoC','RBA']), bullets, tags: _briefingTags(s, ['Weekly','Global','Macro']) };
}

// Weekly Market Recap (vendredi 21:00 Paris — synthèse marchés hebdo)
function buildWeeklyMarketRecap({ dateStr, s, reportType }) {
  const bullets = [];
  bullets.push(`Weekly Market Recap — ${s.all.length} items · Week ending ${dateStr}`);
  _pushBullets(bullets, 'Key Market Drivers',     [...s.fx, ...s.nrg].slice(0,6), 3);
  _pushBullets(bullets, 'Central Bank Commentary', s.cb, 5);
  _pushBullets(bullets, 'Top Data Events',         s.hdata.length >= 2 ? s.hdata : s.data, 5);
  _pushBullets(bullets, 'Geopolitics & Policy',   [...s.geo, ...s.trade].slice(0,6), 4);
  _pushBullets(bullets, 'FX Moves',               s.fx, 4);
  _pushBullets(bullets, 'Commodities Performance', s.nrg, 3);
  _pushBullets(bullets, 'Looking Ahead',          [...s.cb, ...s.data].slice(0,4), 2);
  return { subtitle: _briefingSubtitle(reportType, s, ['Fed','ECB','BoJ']), bullets, tags: _briefingTags(s, ['Weekly Recap','FX','Markets']) };
}

// ─── Wrappers (async for schedule .catch() compatibility) ────────────────────
async function generateAsiaOpeningBriefing(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'pmt-asia-briefing-', reportType: 'Asia Opening Preparation', cutoffHours: 12, force, buildFn: buildAsiaOpening, dateOffset });
}
async function generateLondonRecap(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'pmt-london-recap-', reportType: 'London Session Recap', cutoffHours: 9, force, buildFn: buildLondonRecap, dateOffset });
}
async function generateUSRecap(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'pmt-us-recap-', reportType: 'US Session Recap', cutoffHours: 10, force, buildFn: buildUSRecap, dateOffset });
}
async function generateDailyEventReview(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'pmt-daily-review-', reportType: 'Daily Event Review', cutoffHours: 24, force, buildFn: buildDailyReview, dateOffset });
}
async function _generateUSOpeningNew(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'pmt-us-briefing-', reportType: 'US Opening Preparation', cutoffHours: 8, force, buildFn: buildUSOpening, dateOffset });
}
async function generateLondonOpeningBriefing(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'pmt-london-opening-', reportType: 'London Opening Preparation', cutoffHours: 10, force, buildFn: buildLondonOpening, dateOffset });
}
async function generateDailyMarketRecap(force = false, dateOffset = 0) {
  return generateDailyBriefing({ idPrefix: 'pmt-daily-recap-', reportType: 'Daily Market Recap', cutoffHours: 24, force, buildFn: buildDailyMarketRecap, dateOffset });
}
async function generateGlobalEconomicWeekly(force = false) {
  return generateWeeklyBriefing({ idPrefix: 'pmt-econ-weekly-', reportType: 'Global Economic Weekly', force, buildFn: buildGlobalEconomicWeekly });
}
async function generateWeeklyMarketRecap(force = false) {
  return generateWeeklyBriefing({ idPrefix: 'pmt-mkt-recap-', reportType: 'Weekly Market Recap', force, buildFn: buildWeeklyMarketRecap });
}

// ─── Schedule all briefings ───────────────────────────────────────────────────
(function scheduleAllBriefings() {
  // Rapports QUOTIDIENS (heure Paris)
  const daily = [
    { fn: () => generateAsiaOpeningBriefing(false),   h: 1,  m: 30, name: 'Asia Opening'         },
    { fn: () => generateLondonOpeningBriefing(false), h: 7,  m: 45, name: 'London Opening'        },
    { fn: () => _generateUSOpeningNew(false),          h: 14, m: 45, name: 'US Opening'            },
    { fn: () => generateLondonRecap(false),           h: 17, m: 30, name: 'London Recap'          }, // interne
    { fn: () => generateDailyMarketRecap(false),      h: 22, m: 0,  name: 'Daily Market Recap'    },
    { fn: () => generateDailyEventReview(false),      h: 23, m: 0,  name: 'Daily Event Review'    },
  ];
  // Rapports HEBDOMADAIRES (vendredi uniquement)
  const weekly = [
    { fn: () => generateGlobalEconomicWeekly(false),  h: 18, m: 0,  name: 'Global Economic Weekly' },
    { fn: () => generateWeeklyMarketRecap(false),     h: 21, m: 0,  name: 'Weekly Market Recap'    },
  ];

  function msToNextParis(h, m) {
    const now    = new Date();
    const paris  = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const target = new Date(paris);
    target.setHours(h, m, 0, 0);
    if (paris >= target) target.setDate(target.getDate() + 1);
    return target.getTime() - paris.getTime();
  }
  function msToNextFriday(h, m) {
    const now   = new Date();
    const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const target = new Date(paris);
    const daysToFri = (5 - paris.getDay() + 7) % 7 || 7;
    target.setDate(target.getDate() + daysToFri);
    target.setHours(h, m, 0, 0);
    // Si on est vendredi et l'heure n'est pas encore passée
    if (paris.getDay() === 5 && paris < target) {
      target.setDate(paris.getDate());
      target.setHours(h, m, 0, 0);
    }
    return target.getTime() - paris.getTime();
  }

  for (const { fn, h, m, name } of daily) {
    const delay = msToNextParis(h, m);
    console.log(`[PMT] ${name} scheduled in ${Math.round(delay / 60000)} min`);
    setTimeout(function run() {
      fn().catch(e => console.error(`[PMT] ${name} failed:`, e.message));
      setInterval(() => fn().catch(e => console.error(`[PMT] ${name} failed:`, e.message)), 24 * 60 * 60 * 1000);
    }, delay);
  }
  for (const { fn, h, m, name } of weekly) {
    const delay = msToNextFriday(h, m);
    console.log(`[PMT] ${name} (weekly/Friday) scheduled in ${Math.round(delay / 60000)} min`);
    setTimeout(function run() {
      fn().catch(e => console.error(`[PMT] ${name} failed:`, e.message));
      setInterval(() => fn().catch(e => console.error(`[PMT] ${name} failed:`, e.message)), 7 * 24 * 60 * 60 * 1000);
    }, delay);
  }

  // Au démarrage (ex: après un redéploiement) : on génère les rapports d'ouverture du jour
  // s'ils n'existent pas encore (dédup intégrée). Assemblage par règles → pas de quota Gemini.
  setTimeout(() => {
    daily.forEach(({ fn, name }) => fn().catch(e => console.error(`[PMT] startup ${name} failed:`, e.message)));

    // RATTRAPAGE HEBDO : si Render dormait/​a redémarré le vendredi soir ou le week-end,
    // les rapports hebdomadaires n'ont pas été générés. On les (re)génère ici — la dédup par
    // semaine ISO évite tout doublon. Garde-fou : uniquement vendredi soir (≥21h) ou samedi/dimanche,
    // pour ne PAS créer un recap prématuré en milieu de semaine.
    const parisNow  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const pDay = parisNow.getDay();        // 0=dim … 5=ven, 6=sam
    const pHour = parisNow.getHours();
    if (pDay === 6 || pDay === 0 || (pDay === 5 && pHour >= 21)) {
      weekly.forEach(({ fn, name }) => fn().catch(e => console.error(`[PMT] rattrapage hebdo ${name} échec:`, e.message)));
    }
  }, 25 * 1000);
})();

// ═══════════════════ ONGLET BIAS — biais directionnel hebdomadaire (Gemini) ═══════════════════
// Généré automatiquement chaque dimanche, mis en cache (persistant) → l'onglet l'affiche tel quel.
const BIAS_FILE = path.join(__dirname, 'cache_bias.json');
let _biasCache = null;
try { _biasCache = JSON.parse(fs.readFileSync(BIAS_FILE, 'utf8')); } catch {}

const BIAS_ASSETS = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'USD/CHF',
  'NZD/USD', 'XAU/USD (Gold)', 'WTI Crude Oil', 'S&P 500', 'US 10Y Yield', 'Bitcoin',
];

async function generateWeeklyBias(force = false) {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  if (!force && _biasCache && Date.now() - (_biasCache.generatedAt || 0) < WEEK) return _biasCache;

  const cutoff = Date.now() - WEEK;
  const recent = allNews.filter(i => i.timestamp > cutoff);
  const heads  = recent.slice(0, 140).map(i => `[${i.category || ''}] ${i.headline}`).join('\n');

  const prompt = `You are a senior macro strategist writing the WEEKLY directional bias for a professional trading desk. Today is Sunday.
Based on the past week's headlines below, assign a directional bias for the COMING week for each instrument.

For EACH instrument provide:
- "bias": exactly one of "bullish", "bearish", "neutral"
- "strength": exactly one of "strong", "moderate", "weak"
- "rationale": one concise sentence (max 24 words) naming the key driver (central banks, data, geopolitics, flows).

Instruments: ${BIAS_ASSETS.join(', ')}

Headlines (past 7 days):
${heads || 'No significant headlines this week.'}

Return ONLY valid JSON, no preamble:
{"week":"Week of <Month DD>","overview":"1-2 sentence overview of the week ahead","items":[{"asset":"EUR/USD","bias":"bullish","strength":"moderate","rationale":"..."}]}`;

  try {
    aiNote('bias');
    const text = await ai.generateText(prompt, 1800);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON in response');
    const data = JSON.parse(m[0]);
    if (!Array.isArray(data.items) || !data.items.length) throw new Error('No items');
    data.generatedAt = Date.now();
    _biasCache = data;
    try { fs.writeFileSync(BIAS_FILE, JSON.stringify(_biasCache)); } catch {}
    console.log(`[Bias] Weekly bias generated (${data.items.length} assets)`);
    try { broadcast({ type: 'bias_update', bias: _biasCache }); } catch {}
    return _biasCache;
  } catch (e) {
    console.error('[Bias]', e.message);
    return _biasCache;   // on conserve l'ancien biais en cas d'échec
  }
}

app.get('/api/bias', async (req, res) => {
  if (req.query.force === '1') { try { await generateWeeklyBias(true); } catch {} }
  else if (!_biasCache)        { try { await generateWeeklyBias(true); } catch {} }
  res.json(_biasCache || { items: [], overview: '', week: '' });
});

// ─── Smart Bias Tracker : matrice 8 devises × indicateurs (Gemini + Trend calculé) ───
const SMART_BIAS_FILE = path.join(__dirname, 'cache_smart_bias.json');
const SB_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF'];
// Matrice de départ (snapshot de la semaine de référence) → l'onglet est rempli dès le 1er affichage,
// puis la vraie génération Gemini l'écrase (dimanche / dès que le quota revient).
const _sbMk = a => Object.fromEntries(SB_CURRENCIES.map((c, i) => [c, a[i]]));
const SMART_BIAS_SEED = {
  generatedAt: 1748793600000,   // 2026-06-01 18:00 Paris
  currencies: SB_CURRENCIES,
  rows: [
    { key: 'fundamental',  label: 'Fundamental Data',        values: _sbMk(['Bullish', 'Bullish', 'Neutral', 'Neutral', 'Bullish', 'Bullish', 'Bearish', 'Neutral']) },
    { key: 'bankOverview', label: 'Bank Overview',           values: _sbMk(['Neutral', 'Neutral', 'Bearish', 'Neutral', 'Bullish', 'Bullish', 'Bearish', 'Neutral']) },
    { key: 'hedgeFund',    label: 'Hedge Fund Positioning',  values: _sbMk(['Very Bearish', 'Neutral', 'Bullish', 'Very Bearish', 'Very Bullish', 'Very Bearish', 'Very Bearish', 'Very Bearish']) },
    { key: 'retail',       label: 'Retail Positioning',      values: _sbMk(['Bullish', 'Bullish', 'Neutral', 'Bearish', 'Very Bullish', 'Bearish', 'Bearish', 'Very Bullish']) },
    { key: 'monetary',     label: 'Monetary Policy',         values: _sbMk(['Neutral', 'Neutral', 'Neutral', 'Neutral', 'Bullish', 'Bullish', 'Neutral', 'Neutral']) },
    { key: 'trend',        label: 'Trend',                   values: _sbMk(['Range', 'Uptrend', 'Uptrend', 'Downtrend', 'Uptrend', 'Uptrend', 'Downtrend', 'Downtrend']) },
    { key: 'seasonality',  label: 'Seasonality',             values: _sbMk(['Neutral', 'Bullish', 'Bearish', 'Bullish', 'Neutral', 'Bullish', 'Neutral', 'Bullish']) },
  ],
  conclusion: _sbMk(['Neutral', 'Neutral', 'Neutral', 'Bearish', 'Weak Bullish', 'Bullish', 'Weak Bearish', 'Weak Bearish']),
};
let _smartBias = null;
try { _smartBias = JSON.parse(fs.readFileSync(SMART_BIAS_FILE, 'utf8')); } catch {}
if (!_smartBias || !Array.isArray(_smartBias.rows) || !_smartBias.rows.length) _smartBias = SMART_BIAS_SEED;
const SB_GEM_ROWS = [
  { key: 'fundamental', label: 'Fundamental Data' },
  { key: 'bankOverview', label: 'Bank Overview' },
  { key: 'hedgeFund', label: 'Hedge Fund Positioning' },
  { key: 'retail', label: 'Retail Positioning' },
  { key: 'monetary', label: 'Monetary Policy' },
  { key: 'seasonality', label: 'Seasonality' },
];

// Trend RÉEL dérivé de la force des devises (pente sur la semaine)
async function _sbTrendRow() {
  const out = {};
  try {
    const cs = await computeCurrencyStrength('week');
    SB_CURRENCIES.forEach(c => {
      const s = cs?.series?.[c];
      if (!s || s.length < 2) { out[c] = 'Range'; return; }
      const d = s[s.length - 1].v - s[0].v;
      out[c] = d > 0.4 ? 'Uptrend' : d < -0.4 ? 'Downtrend' : 'Range';
    });
  } catch { SB_CURRENCIES.forEach(c => out[c] = 'Range'); }
  return out;
}

async function generateSmartBias(force = false) {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  if (!force && _smartBias && Date.now() - (_smartBias.generatedAt || 0) < WEEK) return _smartBias;

  const cutoff = Date.now() - WEEK;
  const heads  = allNews.filter(i => i.timestamp > cutoff).slice(0, 150).map(i => `[${i.category || ''}] ${i.headline}`).join('\n');
  const prompt = `You are a senior FX strategist building a "Smart Bias" matrix for the 8 major currencies: ${SB_CURRENCIES.join(', ')}.
For EACH currency, rate each indicator using EXACTLY one of: "Very Bullish", "Bullish", "Neutral", "Bearish", "Very Bearish".
Indicators:
- fundamental: macro/data momentum
- bankOverview: aggregate sell-side bank stance
- hedgeFund: CFTC/COT large-speculator positioning
- retail: retail crowd positioning (often contrarian)
- monetary: central-bank policy stance
- seasonality: typical seasonal tendency for early June
Use the past-week headlines + your macro knowledge. Be decisive (do NOT make everything Neutral).
Headlines:
${heads || 'n/a'}
Return ONLY valid JSON: {"rows":{"fundamental":{"USD":"Bullish","EUR":"...", ...all 8...},"bankOverview":{...},"hedgeFund":{...},"retail":{...},"monetary":{...},"seasonality":{...}}}`;

  let gem = {};
  try {
    aiNote('bias');
    const t = await ai.generateText(prompt, 2400);
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON');
    gem = JSON.parse(m[0]).rows || {};
  } catch (e) {
    console.error('[SmartBias]', e.message);
    return _smartBias;   // garde l'ancienne matrice (seed ou précédente)
  }
  // Gemini n'a rien renvoyé d'exploitable → on garde la matrice actuelle (pas d'écrasement vide)
  if (!Object.keys(gem).length) return _smartBias;

  const trend = await _sbTrendRow();
  // Conclusion = agrégat pondéré simple
  const score = { 'Very Bullish': 2, 'Bullish': 1, 'Neutral': 0, 'Bearish': -1, 'Very Bearish': -2, 'Uptrend': 1, 'Downtrend': -1, 'Range': 0 };
  const conclusion = {};
  SB_CURRENCIES.forEach(c => {
    let s = 0, n = 0;
    SB_GEM_ROWS.forEach(r => { const v = gem[r.key]?.[c]; if (v != null && score[v] != null) { s += score[v]; n++; } });
    s += score[trend[c]] || 0; n++;
    const avg = n ? s / n : 0;
    conclusion[c] = avg > 0.55 ? 'Bullish' : avg > 0.15 ? 'Weak Bullish' : avg < -0.55 ? 'Bearish' : avg < -0.15 ? 'Weak Bearish' : 'Neutral';
  });

  // Ordre d'affichage : Fundamental, Bank, HedgeFund, Retail, Monetary, Trend, Seasonality
  const rows = [];
  ['fundamental', 'bankOverview', 'hedgeFund', 'retail', 'monetary'].forEach(k => {
    const def = SB_GEM_ROWS.find(r => r.key === k);
    rows.push({ key: k, label: def.label, values: gem[k] || {} });
  });
  rows.push({ key: 'trend', label: 'Trend', values: trend });
  rows.push({ key: 'seasonality', label: 'Seasonality', values: gem.seasonality || {} });

  _smartBias = { generatedAt: Date.now(), currencies: SB_CURRENCIES, rows, conclusion };
  try { fs.writeFileSync(SMART_BIAS_FILE, JSON.stringify(_smartBias)); } catch {}
  console.log('[SmartBias] matrix generated');
  try { broadcast({ type: 'smartbias_update', bias: _smartBias }); } catch {}
  return _smartBias;
}

app.get('/api/smart-bias', async (req, res) => {
  if (req.query.force === '1') { try { await generateSmartBias(true); } catch {} }
  else if (!_smartBias)        { try { await generateSmartBias(true); } catch {} }
  res.json(_smartBias || { currencies: SB_CURRENCIES, rows: [], conclusion: {} });
});

// Planification : tous les dimanches à 18h00 (Paris) + génération au démarrage si vide
(function scheduleWeeklyBias() {
  function msToNextSunday(h, m) {
    const now    = new Date();
    const paris  = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const target = new Date(paris);
    const daysToSun = (7 - paris.getDay()) % 7;   // 0 = dimanche
    target.setDate(paris.getDate() + daysToSun);
    target.setHours(h, m, 0, 0);
    if (target <= paris) target.setDate(target.getDate() + 7);
    return target.getTime() - paris.getTime();
  }
  const delay = msToNextSunday(18, 0);
  console.log(`[Bias] Génération hebdo (dimanche 18h) dans ${Math.round(delay / 60000)} min`);
  const runAll = () => {
    generateSmartBias(true).catch(e => console.error('[SmartBias] failed:', e.message));
    generateWeeklyBias(true).catch(e => console.error('[Bias] failed:', e.message));
  };
  setTimeout(function run() {
    runAll();
    setInterval(runAll, 7 * 24 * 60 * 60 * 1000);
  }, delay);
  // Premier remplissage si le cache est vide (ex: tout premier déploiement)
  if (!_smartBias) setTimeout(() => generateSmartBias(true).catch(() => {}), 30 * 1000);
})();

// ═══════════════════ ONGLET BANK — positions de trading des banques ═══════════════════
// Seed (issu des captures PMT) + éditions admin + extraction Gemini des flux recherche.
// Le statut (Active / TP touché / SL touché) et le prix se mettent à jour en TEMPS RÉEL (Yahoo).
const BANK_FILE = path.join(__dirname, 'cache_bank_positions.json');
const BANK_SEED = [
  { id:'seed-1',  bank:'SEB Research',             orderType:'Sell Limit',       pair:'USD/JPY', date:'2026-05-27', entry:160.50, tp:155.00,  sl:162.50, source:'seed' },
  { id:'seed-2',  bank:'Refinitiv',                orderType:'Market Execution', pair:'USD/JPY', date:'2026-05-28', entry:159.25, tp:157.75,  sl:159.80, source:'seed' },
  { id:'seed-3',  bank:'Refinitiv',                orderType:'Market Execution', pair:'USD/CAD', date:'2026-05-25', entry:1.3820, tp:1.3630,  sl:1.3880, source:'seed' },
  { id:'seed-4',  bank:'Refinitiv',                orderType:'Market Execution', pair:'GBP/USD', date:'2026-05-27', entry:1.3445, tp:1.3645,  sl:1.3345, source:'seed' },
  { id:'seed-5',  bank:'MUFG Research',            orderType:'Market Execution', pair:'GBP/CHF', date:'2026-03-30', entry:1.0560, tp:1.0200,  sl:1.0800, source:'seed' },
  { id:'seed-6',  bank:'SEB Research',             orderType:'Buy Limit',        pair:'EUR/USD', date:'2026-05-19', entry:1.1500, tp:1.1900,  sl:1.1400, source:'seed' },
  { id:'seed-7',  bank:'Credit Agricole Research', orderType:'Market Execution', pair:'EUR/JPY', date:'2026-06-01', entry:185.75, tp:189.71,  sl:183.00, source:'seed' },
  { id:'seed-8',  bank:'Nomura Research',          orderType:'Market Execution', pair:'EUR/GBP', date:'2026-02-19', entry:0.8672, tp:0.8950,  sl:0.8550, source:'seed' },
  { id:'seed-9',  bank:'Danske Research',          orderType:'Market Execution', pair:'EUR/GBP', date:'2026-01-16', entry:0.8664, tp:0.9000,  sl:0.8490, source:'seed' },
  { id:'seed-10', bank:'Morgan Stanley Research',  orderType:'Market Execution', pair:'EUR/CHF', date:'2026-02-16', entry:0.9123, tp:0.8700,  sl:0.9400, source:'seed' },
  { id:'seed-11', bank:'Nomura Research',          orderType:'Market Execution', pair:'AUD/NZD', date:'2026-05-08', entry:1.2155, tp:1.1800,  sl:1.2300, source:'seed' },
  { id:'seed-12', bank:'Credit Agricole Research', orderType:'Market Execution', pair:'AUD/NZD', date:'2026-05-21', entry:1.2170, tp:1.1600,  sl:1.2470, source:'seed' },
];
let _bankPositions = null;
try { _bankPositions = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8')); } catch {}
if (!Array.isArray(_bankPositions) || !_bankPositions.length) _bankPositions = BANK_SEED.slice();
function _saveBank() { try { fs.writeFileSync(BANK_FILE, JSON.stringify(_bankPositions)); } catch {} }

const _bankSym = p => p.replace('/', '') + '=X';   // USD/JPY → USDJPY=X
let _bankPxCache = { ts: 0, px: {} };
async function _bankLivePrices() {
  if (Date.now() - _bankPxCache.ts < 60 * 1000) return _bankPxCache.px;
  try { await getYFSession(); } catch {}
  const pairs = [...new Set(_bankPositions.map(p => p.pair))];
  const px = {};
  await Promise.all(pairs.map(async pr => {
    try {
      const raw = await yfFetch(_bankSym(pr), '5m', '1d');
      const cl  = (raw?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(x => x != null);
      if (cl.length) px[pr] = cl[cl.length - 1];
    } catch {}
  }));
  _bankPxCache = { ts: Date.now(), px };
  return px;
}
// Détermine le sens (achat/vente) puis l'état selon le prix courant
function _bankStatus(pos, price) {
  const isBuy = /buy/i.test(pos.orderType) || (pos.tp > pos.entry);
  if (price == null) return { status: 'Active', dir: isBuy ? 'buy' : 'sell' };
  let status = 'Active';
  if (isBuy) { if (price >= pos.tp) status = 'TP touché'; else if (price <= pos.sl) status = 'SL touché'; }
  else       { if (price <= pos.tp) status = 'TP touché'; else if (price >= pos.sl) status = 'SL touché'; }
  return { status, dir: isBuy ? 'buy' : 'sell' };
}

app.get('/api/bank-positions', async (_req, res) => {
  let px = {};
  try { px = await _bankLivePrices(); } catch {}
  const positions = _bankPositions.map(p => {
    const price = px[p.pair] ?? null;
    const { status, dir } = _bankStatus(p, price);
    return { ...p, currentPrice: price, status, dir };
  });
  res.json({ positions, updatedAt: Date.now() });
});

// Bougies réelles d'une paire (pour le graphique de droite)
app.get('/api/bank-ohlc', async (req, res) => {
  const pair = String(req.query.pair || '').toUpperCase();
  if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) return res.json({ candles: [] });
  try {
    await getYFSession();
    const raw = await yfFetch(_bankSym(pair), '1d', '6mo');
    const r   = raw?.chart?.result?.[0];
    const ts  = r?.timestamp || [];
    const q   = r?.indicators?.quote?.[0] || {};
    const candles = ts.map((t, i) => ({
      t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i],
    })).filter(c => c.o != null && c.c != null);
    res.json({ candles });
  } catch (e) { res.json({ candles: [] }); }
});

// ─── Market Snapshot (tableau SNAPSHOT des rapports DTP) — prix réels Yahoo ───
const SNAP_GROUPS = [
  { title: 'STOCKS', items: [
    { sym: '^GSPC', label: 'S&P 500' }, { sym: '^IXIC', label: 'Nasdaq Comp.' },
    { sym: '^DJI',  label: 'DJIA' },    { sym: '^RUT',  label: 'Russell 2000' } ] },
  { title: 'FX', items: [
    { sym: 'DX-Y.NYB', label: 'DXY' }, { sym: 'EURUSD=X', label: 'EUR/USD' },
    { sym: 'USDJPY=X', label: 'USD/JPY' }, { sym: 'GBPUSD=X', label: 'GBP/USD' } ] },
  { title: 'BONDS', items: [
    { sym: '^TNX', label: 'US 10yr Yield' }, { sym: '^TYX', label: 'US 30yr Yield' } ] },
  { title: 'ENERGY & METALS', items: [
    { sym: 'CL=F', label: 'WTI' }, { sym: 'BZ=F', label: 'Brent' },
    { sym: 'GC=F', label: 'Spot Gold' }, { sym: 'HG=F', label: 'Copper' } ] },
  { title: 'CRYPTO', items: [
    { sym: 'BTC-USD', label: 'Bitcoin' }, { sym: 'ETH-USD', label: 'Ethereum' } ] },
];
let _snapCache = { ts: 0, data: null };
app.get('/api/market-snapshot', async (_req, res) => {
  if (_snapCache.data && Date.now() - _snapCache.ts < 60 * 1000) return res.json(_snapCache.data);
  try {
    await getYFSession();
    const all = SNAP_GROUPS.flatMap(g => g.items);
    const pct = {};
    await Promise.all(all.map(async a => {
      try {
        const raw  = await yfFetch(a.sym, '5m', '1d');
        const meta = raw?.chart?.result?.[0]?.meta;
        if (meta && meta.regularMarketPrice != null && meta.chartPreviousClose) {
          pct[a.sym] = (meta.regularMarketPrice / meta.chartPreviousClose - 1) * 100;
        }
      } catch {}
    }));
    const data = {
      updatedAt: Date.now(),
      groups: SNAP_GROUPS.map(g => ({
        title: g.title,
        rows: g.items.map(it => ({ label: it.label, pct: pct[it.sym] != null ? +pct[it.sym].toFixed(1) : null })),
      })),
    };
    _snapCache = { ts: Date.now(), data };
    res.json(data);
  } catch (e) { res.json({ groups: [], updatedAt: Date.now() }); }
});

// CRUD admin (ajout / édition / suppression de positions)
app.post('/api/bank-positions', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (b._delete) {
    _bankPositions = _bankPositions.filter(p => p.id !== b.id);
    _saveBank(); return res.json({ ok: true });
  }
  const clean = {
    bank: String(b.bank || '').slice(0, 60), orderType: String(b.orderType || 'Market Execution').slice(0, 30),
    pair: String(b.pair || '').toUpperCase().slice(0, 7), date: String(b.date || '').slice(0, 10),
    entry: +b.entry || 0, tp: +b.tp || 0, sl: +b.sl || 0, thesis: String(b.thesis || '').slice(0, 1200),
  };
  if (!clean.bank || !/^[A-Z]{3}\/[A-Z]{3}$/.test(clean.pair)) return res.status(400).json({ error: 'bank et pair (XXX/YYY) requis' });
  const existing = b.id && _bankPositions.find(p => p.id === b.id);
  if (existing) { Object.assign(existing, clean); }
  else { _bankPositions.unshift({ id: 'm-' + Date.now().toString(36), source: 'manual', ...clean }); }
  _saveBank();
  res.json({ ok: true });
});

// ─── Extraction Gemini des positions depuis les notes de banques (ActionForex…) ───
const BANK_EXTRACT_FILE = path.join(__dirname, 'cache_bank_extract.json');
const _bankExtracted = _loadJsonMap(BANK_EXTRACT_FILE);   // articleId → true (déjà traité)
async function _extractBankPositionsAI() {
  if (!ai || !_brCache) return;
  if (!aiAllowed('bank')) return;   // budget Gemini : extraction réservée au week-end
  const candidates = _brCache.filter(a => a._source === 'actionforex' && !_bankExtracted.has(a.id)).slice(0, 8);
  for (const art of candidates) {
    if (!aiAllowed('bank')) break;
    _bankExtracted.set(art.id, true);   // on marque traité quoi qu'il arrive (évite de reboucler)
    try {
      aiNote('bank');
      const txt = `${art.title}\n${(art.description || '').replace(/<[^>]*>/g, ' ')}`.slice(0, 900);
      const out = await ai.generateText(`From the bank FX research note below, extract any concrete trade setup. If there is NO clear setup with an entry, reply exactly "NONE".
Otherwise reply ONLY valid JSON: {"bank":"<bank name>","orderType":"Buy Limit|Sell Limit|Market Execution","pair":"EUR/USD","entry":1.234,"tp":1.250,"sl":1.220}

Note:
${txt}`, 300);
      if (/NONE/i.test(out.slice(0, 20))) continue;
      const m = out.match(/\{[\s\S]*\}/); if (!m) continue;
      const d = JSON.parse(m[0]);
      if (!d.pair || !/^[A-Z]{3}\/[A-Z]{3}$/.test(String(d.pair).toUpperCase()) || !d.entry) continue;
      _bankPositions.unshift({
        id: 'ai-' + art.id.slice(-10), source: 'ai',
        bank: String(d.bank || art.institution || 'Bank Research').slice(0, 60),
        orderType: ['Buy Limit', 'Sell Limit', 'Market Execution'].includes(d.orderType) ? d.orderType : 'Market Execution',
        pair: String(d.pair).toUpperCase(), date: new Date(art.timestamp || Date.now()).toISOString().slice(0, 10),
        entry: +d.entry, tp: +d.tp || 0, sl: +d.sl || 0,
      });
    } catch (e) { /* best-effort */ }
  }
  if (_bankPositions.length > 60) _bankPositions = _bankPositions.slice(0, 60);
  _saveBank();
  _saveJsonMap(BANK_EXTRACT_FILE, _bankExtracted);
}
// Extraction périodique (best-effort, dépend du quota Gemini)
setInterval(() => _extractBankPositionsAI().catch(() => {}), 60 * 60 * 1000);
setTimeout(() => _extractBankPositionsAI().catch(() => {}), 90 * 1000);

// Manual triggers — force=true bypasses today's dedup check
app.get('/api/briefing/:type/generate', async (req, res) => {
  const force = req.query.force === '1';
  const map = {
    'us-opening':        () => _generateUSOpeningNew(force),
    'asia-opening':      () => generateAsiaOpeningBriefing(force),
    'london-opening':    () => generateLondonOpeningBriefing(force),
    'london-recap':      () => generateLondonRecap(force),
    'us-recap':          () => generateUSRecap(force),
    'daily-recap':       () => generateDailyMarketRecap(force),
    'daily-review':      () => generateDailyEventReview(force),
    'weekly-economic':   () => generateGlobalEconomicWeekly(force),
    'weekly-recap':      () => generateWeeklyMarketRecap(force),
  };
  const fn = map[req.params.type];
  if (!fn) return res.status(404).json({ error: 'Valid types: us-opening, asia-opening, london-opening, london-recap, us-recap, daily-recap, daily-review, weekly-economic, weekly-recap' });
  try {
    await fn();
    res.json({ ok: true, type: req.params.type });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generate ALL briefings at once (today + optionally yesterday)
app.get('/api/briefings/generate-all', async (req, res) => {
  const force     = req.query.force === '1';
  const yesterday = req.query.yesterday === '1';
  res.json({ ok: true, message: `Generating all briefings${yesterday ? ' (today + yesterday)' : ''}…` });

  const todayFns = [
    { name: 'Asia Opening',       fn: () => generateAsiaOpeningBriefing(force, 0)  },
    { name: 'London Opening',     fn: () => generateLondonOpeningBriefing(force, 0) },
    { name: 'US Opening',         fn: () => _generateUSOpeningNew(force, 0)         },
    { name: 'Daily Market Recap', fn: () => generateDailyMarketRecap(force, 0)      },
    { name: 'Daily Event Review', fn: () => generateDailyEventReview(force, 0)      },
    { name: 'Global Econ Weekly', fn: () => generateGlobalEconomicWeekly(force)     },
    { name: 'Weekly Mkt Recap',   fn: () => generateWeeklyMarketRecap(force)        },
  ];
  const yesterdayFns = yesterday ? [
    { name: 'US Opening (yest)',    fn: () => _generateUSOpeningNew(force, 1)        },
    { name: 'Asia Opening (yest)',  fn: () => generateAsiaOpeningBriefing(force, 1)  },
    { name: 'London Recap (yest)',  fn: () => generateLondonRecap(force, 1)          },
    { name: 'US Recap (yest)',      fn: () => generateUSRecap(force, 1)              },
    { name: 'Daily Review (yest)',  fn: () => generateDailyEventReview(force, 1)     },
  ] : [];

  for (const { name, fn } of [...todayFns, ...yesterdayFns]) {
    try { await fn(); console.log(`[PMT] ${name} done`); }
    catch (e) { console.error(`[PMT] ${name} failed:`, e.message); }
    await new Promise(r => setTimeout(r, 1500));
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectEconAgency(text) { return _detectEconAgencyEarly(text); }

// Geo escalation patterns that override CB category detection
const _GEO_OVERRIDE_RX = /\b(?:iran|russia|ukraine|israel|hamas|hezbollah|north korea|taiwan strait)\b.*\b(?:attack|strike|airstrike|missile|troops|invad|bomb|weapon|nuclear|sanction|military|war|conflict|escalat|demand|warn|threat|reject|respond|fire|launch|target|block|seize)\b|\b(?:airstrike|ground offensive|drone strike|military escalat|ceasefire|hostage|evacuat)\b|^(?:iran|russia|ukraine|israel|hamas|china)\s*[:,–-]/i;

function detectCategory(text) {
  const t = (text || '').toLowerCase();

  // ── Geopolitical OVERRIDE: primary-actor geo statements beat CB categories ──
  if (_GEO_OVERRIDE_RX.test(text)) return 'Geopolitical';

  if (/\bfed\b|federal reserve|fomc|powell|jerome|yellen/.test(t)) return 'Fed';
  if (/\becb\b|lagarde|european central bank/.test(t)) return 'ECB';
  if (/\bboj\b|bank of japan|ueda|kuroda/.test(t)) return 'BoJ';
  if (/\bboe\b|bank of england|bailey|threadneedle/.test(t)) return 'BoE';
  if (/\bboc\b|bank of canada|macklem/.test(t)) return 'BoC';
  if (/\brba\b|reserve bank of australia|bullock/.test(t)) return 'RBA';
  if (/\bsnb\b|swiss national bank/.test(t)) return 'SNB';
  if (/\brbnz\b|reserve bank of new zealand/.test(t)) return 'RBNZ';
  if (/oil\b|crude|brent|wti|opec|adnoc|energy\b|gas price|natural gas|petroleum|hormuz/.test(t)) return 'Energy & Power';
  if (/\bgold\b|silver|copper|nickel|zinc|aluminum|iron ore|metal|platinum|palladium/.test(t)) return 'Metals';
  if (/bitcoin|crypto|ethereum|\bbtc\b|\beth\b|blockchain|defi|stablecoin/.test(t)) return 'Crypto';
  if (/war|conflict|geopolit|russia|ukraine|iran|israel|hamas|hezbollah|taiwan|nato|missile|troops|military|sanction/.test(t)) return 'Geopolitical';
  // FJ-style prefix "EU Data: Eurozone CPI..." — checked before generic catch-all
  if (/^eu\s+data\b/.test(t))                                            return 'EU Data';
  if (/^us\s+data\b/.test(t))                                            return 'US Data';
  if (/^uk\s+data\b/.test(t))                                            return 'UK Data';
  if (/^swiss\s+data\b/.test(t))                                         return 'Swiss Data';
  if (/^japa(?:n|nese)\s+data\b/.test(t))                               return 'Japanese Data';
  if (/^canad(?:a|ian)\s+data\b/.test(t))                               return 'Canadian Data';
  if (/^austral(?:ia|ian)\s+data\b/.test(t))                            return 'Australian Data';
  if (/^chin(?:a|ese)\s+data\b/.test(t))                                return 'Chinese Data';
  if (/^(?:german|french|italian|spanish)\s+data\b/.test(t))            return 'EU Data';
  // Regional data by content keywords (fallback for non-FJ sources)
  if (/\bgdp\b|inflation|\bcpi\b|\bppi\b|\bpmi\b|\bnfp\b|payroll|unemployment|retail sales|industrial prod/.test(t)) {
    if (/eurozone|euro.?area|eurostat/.test(t))                          return 'EU Data';
    if (/(?:swiss|switzerland).*(?:cpi|gdp|pmi)/.test(t))               return 'Swiss Data';
    if (/\buk\b.*(?:cpi|gdp|pmi)|brit(?:ain|ish).*(?:cpi|gdp)/.test(t)) return 'UK Data';
    if (/japan.*(?:cpi|gdp|pmi|tankan)|japanese.*(?:cpi|gdp)/.test(t))  return 'Japanese Data';
    if (/canad.*(?:cpi|gdp|pmi|employment)/.test(t))                    return 'Canadian Data';
    if (/austral.*(?:cpi|gdp|pmi|employment)/.test(t))                  return 'Australian Data';
    if (/\bchina\b.*(?:cpi|gdp|pmi)|chinese.*(?:cpi|gdp)/.test(t))     return 'Chinese Data';
  }
  if (/gdp|inflation|cpi|ppi|\bpmi\b|nfp|payroll|unemployment|retail sales|consumer price|producer price|trade balance/.test(t)) return 'Economic Commentary';
  if (/\busd\b|\beur\b|\bgbp\b|\bjpy\b|\bchf\b|\bausd\b|\bnzd\b|\bcad\b|forex|fx |exchange rate|currency pair|dollar|yen/.test(t)) return 'FX Flows';
  if (/nasdaq|s&p 500|s&p500|dow jones|dax|cac 40|ftse 100|nikkei|hang seng|equity|equities|stock market|ipo/.test(t)) return 'Market Analysis';
  if (/bond yield|treasury yield|gilt|bund|t-bill|fixed income|sovereign debt/.test(t)) return 'Fixed Income';
  if (/\btrade\b|tariff|export|import|wto|supply chain|trade war/.test(t)) return 'Trade';
  if (/\basia\b|japan|china|korea|singapore|hong kong|thailand|vietnam|india/.test(t)) return 'Asian News';
  if (/wheat|corn|soy|coffee|sugar|cocoa|agriculture|crop|cattle/.test(t)) return 'Ags & Softs';
  if (/prime minister|parliament|election|congress|senate|white house/.test(t)) return 'PMT Update';
  return 'Global News';
}

function extractTags(category, text) {
  const tags = [category];
  const t = (text || '').toLowerCase();
  if (/(united states|\bus\b|american|trump|washington)/.test(t)) tags.push('US');
  if (/(united kingdom|\buk\b|britain|british|london)/.test(t)) tags.push('UK');
  if (/(europe|european|\beu\b|brussels|eurozone)/.test(t)) tags.push('EU');
  const isDataRelease = /\b(cpi|ppi|pce|hicp|gdp|nfp|nonfarm payroll|unemployment rate|jobless claims|retail sales|industrial production|trade balance|consumer confidence|pmi|ifo|zew|durable goods|housing starts|payroll|consumer price|producer price|factory orders|ism|composite pmi|services pmi|manufacturing pmi|inflation rate|current account|import prices?|export prices?|housing)\b/.test(t);
  const isInflation   = isDataRelease && /\b(cpi|ppi|pce|hicp|consumer price|producer price|inflation rate|harmonized index)\b/.test(t);
  const hasResult     = /\b(actual|flash|prelim|final|yoy|mom|y\/y|m\/m|above|below|vs\.?\s*exp|forecast)\b/.test(t) || /\d[\d.,]+\s*%/.test(t);
  if (isDataRelease && hasResult) tags.push('Data');
  if (isInflation && hasResult)   tags.push('Inflation');
  if (/\b(rate decision|rate hike|rate cut|interest rate|rate increase|rate hold|rate pause|basis point|bps|monetary policy decision|policy rate|benchmark rate|repo rate|overnight rate)\b/.test(t) ||
      (isInflation && hasResult)) tags.push('Rates');
  return [...new Set(tags)].slice(0, 6);
}

function formatTime(dateStr) {
  try {
    return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  } catch {
    return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  }
}

// ─── Financial relevance filter ──────────────────────────────────────────────

const FINANCIAL_KEYWORDS = /\b(forex|fx|currency|currencies|exchange rate|central bank|monetary policy|interest rate|rate hike|rate cut|rate decision|rate hold|rate pause|inflation|deflation|stagflation|cpi|ppi|pce|core inflation|gdp|nfp|nonfarm payroll|non-farm|unemployment|jobless|employment change|retail sales|trade balance|current account|industrial production|manufacturing|consumer confidence|purchasing managers|pmi|ifo|zew|durable goods|housing starts|payrolls|fed|fomc|federal reserve|ecb|european central bank|boj|bank of japan|boe|bank of england|boc|bank of canada|rba|rbnz|snb|riksbank|pboc|jerome powell|lagarde|ueda|bailey|yield curve|bond yield|treasury yield|gilt|bund|spread|dollar index|dxy|eurusd|gbpusd|usdjpy|usdchf|audusd|nzdusd|usdcad|xauusd|gold price|silver price|crude oil|brent|wti|opec|oil supply|oil demand|risk off|risk on|safe haven|stock market|equity market|nasdaq|s&p 500|dow jones|nikkei|ftse|dax|cac 40|geopolit|sanction|tariff|trade war|trade deal|iran|russia|ukraine|israel|escalat|\bwar\b|conflict|middle east|energy crisis|gas price|natural gas|bitcoin|crypto)\b/i;

// Sub-national / regional statistics that are not market-moving
// Matches both "Saxony CPI MoM" and "German Saxony CPI YoY" and "Germany Saxony CPI"
const REGIONAL_NOISE = /\b(north\s+rhine(\s+westphalia)?|rhineland(\s*-?\s*palatinate)?|saxony[\s-]anhalt|lower\s+saxony|upper\s+saxony|mecklenburg(\s*-?\s*\w+)?|schleswig(\s*-?\s*holstein)?|thuringi|saxony|hesse|brandenbur|bavari|saarland|wuerttemberg|westphalia|bad(?:en)?(?:\s+wuerttemberg)?)\b.*\b(cpi|ppi|consumer\s+price|regional\s+inflation)\b/i;

// Editorial/research weekly reports that slip through curated sources
const EDITORIAL_NOISE = /\b(fx\s+weekly|fx\s+(?:and\s+\w+\s+)?(?:outlook|strategy|views?|note)|weekly\s+(note|outlook|report|review|strategy|forecast|briefing)|monthly\s+(outlook|report|review|strategy|letter)|quarterly\s+(outlook|report|review|strategy)|research\s+(note|report|brief)|morning\s+(brief|note|wrap)|end[\s-]of[\s-]day|eod\s+report|strategy\s+note|market\s+wrap|recap\s+report)\b/i;

function isFinanciallyRelevant(text) {
  return FINANCIAL_KEYWORDS.test(text || '');
}

// Data release stub — title only with no actual value or result
// e.g. "UK Manufacturing PMI Final", "Germany CPI Flash Estimate - May 2026"
const DATA_STUB_NAMES = /\b(?:pmi|purchasing managers'?|manufacturing|services|composite|cpi|consumer prices?|consumer price index|producer prices?|ppi|hicp|gdp|gross domestic product|nonfarm payrolls?|non.?farm payrolls?|payrolls?|unemployment|retail sales|industrial production|trade balance|current account|housing starts|durable goods|import prices?|export prices?|employment|jobless|job cuts?)\b/i;
const DATA_STUB_HAS_VALUE = /\d[\d.,]+|\b(?:rose|fell|grew|contracted|increased|decreased|climbed|dropped|expanded|shrank|gained|lost|jumped|plunged|stable|unchanged|flat|above|below|beats?|misses?|came in|actual|revised|shows?|remains?|rebounds?|recovers?|slows?|surges?|declines?|eases?|holds?|rises?|falls?|muted|robust|strong|weak|solid|soft|resilient|after\s+\+?\-?\d|vs\.?\s*\d|from\s+\d)\b/i;

function isDataStub(headline) {
  const h = headline || '';
  if (h.length > 78) return false;           // long headlines have context
  if (!DATA_STUB_NAMES.test(h)) return false; // not a data release name
  if (DATA_STUB_HAS_VALUE.test(h)) return false; // has an actual value/result
  return true;
}

// Tabloid / gossip sources embedded in headlines
const TABLOID_SOURCES = /\b(the sun|daily mail|daily mirror|the mirror|the times|the telegraph|sky news|page six|tmz|people magazine|daily star|the guardian reports|buzzfeed|huffpost|vice news|politico reports|axios reports|punchbowl)\b/i;

// Political/personal gossip patterns — not market-moving
const GLOBAL_GOSSIP = /\b(communications? between|will be published|leaked? (documents?|messages?|emails?|texts?)|personal (messages?|texts?|emails?|communications?)|sources (say|told|claim|suggest)|reportedly (said|told|wrote|texted|emailed)|rumoured?|alleged (affair|feud|dispute|row|fight)|PM candidate|potential (prime minister|pm|president) candidate|leadership (race|contest|bid|challenge)|resigns? (over|amid|after personal)|quits? (over|amid|after personal))\b/i;

// Sports, entertainment, lifestyle — never market-moving
const GLOBAL_LIFESTYLE = /\b(football|soccer|nfl|nba|nhl|mlb|premier league|champions league|world cup|olympics?|tennis|formula.?1\b|f1 race|grand prix.*winner|celebrity|actor|actress|singer|musician|film|movie|box office|award|grammy|oscar|bafta|royal family gossip|prince|princess|kardashian|taylor swift|beyonc|royal baby|died aged|passes away|funeral|wedding of|divorce of|married to|dating|romance)\b/i;

function isGlobalNewsNoise(headline) {
  const h = headline || '';
  if (TABLOID_SOURCES.test(h))  return true;
  if (GLOBAL_GOSSIP.test(h))    return true;
  if (GLOBAL_LIFESTYLE.test(h)) return true;
  return false;
}

// ── Bruit corporate : émissions de dette/billets d'entreprises privées ────────
// Langage de dépôt SEC US ("files/filed to sell") = émission corporate sans
// intérêt macro. On EXCLUT les émetteurs souverains/gouvernementaux (qui n'utilisent
// pas "files to sell" mais "to sell EUR Xbln in N-year notes").
// Exemples ciblés : "Whirlpool (WHR) files to sell notes",
//   "Consolidated Edison (ED) has filed to sell, 2-year... notes",
//   "Southern Co (SO) files to sell 5-year notes".
const CORPORATE_DEBT_NOISE = /\b(?:files?|filed|has\s+filed)\s+to\s+(?:sell|issue|offer|price)\b/i;
// Émetteur souverain/public reconnu → ne JAMAIS filtrer (impact taux)
const SOVEREIGN_ISSUER = /\b(treasury|sovereign|government|state of|federal|bund|gilt|jgb|oat|btp|debt agency|dmo|ministry of finance|central bank|municipal|eurozone|eib|esm)\b/i;

function isCorporateDebtNoise(headline) {
  const h = headline || '';
  if (SOVEREIGN_ISSUER.test(h)) return false;   // souverain → conservé
  // "files/filed to sell" = dépôt SEC corporate
  if (CORPORATE_DEBT_NOISE.test(h)) return true;
  // Ticker entre parenthèses + émission de dette = corporate
  if (/\([A-Z]{1,5}(?:\s+[A-Z]{1,3})?\)/.test(h) &&
      /\b(?:to\s+sell|to\s+issue|to\s+offer|prices?|priced)\b.*\b(?:notes?|bonds?|senior\s+notes?|floating\s+rate\s+notes?|debentures?)\b/i.test(h)) {
    return true;
  }
  return false;
}

function isNoise(headline) {
  const h = headline || '';
  // Social-media reposts and failed-scrape stubs — never market-moving
  if (/^\[No Title\]/i.test(h))  return true;   // "[No Title] - Post from..."
  if (/^RT @/i.test(h))          return true;   // "RT @realDonaldTrump..."
  if (/^@[A-Za-z]/i.test(h))    return true;   // bare @handle tweets
  if (isCorporateDebtNoise(h))   return true;   // émissions de dette corporate
  return REGIONAL_NOISE.test(h) || EDITORIAL_NOISE.test(h) || isDataStub(h);
}

// ─── High-impact economic data detector ──────────────────────────────────────
// Matches actual data releases (not commentary) for tier-1 macro events
const HIGH_IMPACT_RE = /\b(?:gdp\b.{0,60}(?:final|preliminary|flash|growth\s+rate|yoy|qoq|\bq[1-4]\b)|nonfarm\s+payroll|non.?farm\s+payroll|\bnfp\b|unemployment\s+rate\b|(?:core\s+)?cpi\b.{0,40}(?:final|preliminary|flash|actual|yoy|mom|m\/m|y\/y)|(?:core\s+)?pce\b.{0,40}(?:final|actual|yoy|mom)|consumer\s+price\s+index.{0,40}(?:final|actual|yoy|mom)|harmonized\s+index\s+of\s+consumer\s+prices|hicp\b.{0,30}(?:actual|yoy|mom)|inflation\s+rate\b.{0,60}(?:yoy|mom|y\/y|m\/m|prel|prelim|final|actual)|flash\s+(?:cpi|pmi|gdp)|pmi\s+(?:final|preliminary|flash).{0,30}actual|retail\s+sales\b.{0,30}(?:actual|yoy|mom|m\/m|\(apr|\(mar|\(feb|\(jan|\(may|\(jun)|import\s+prices?\b.{0,30}(?:actual|yoy|mom|above|below)|rate\s+decision\b|(?:fomc|ecb)\s+(?:rate|decision|statement|minutes))\b/i;

// ─── Commentary / opinion detector — demotes false positives ─────────────────
// Headlines that express support/approval/opinion of a policy rather than an action
const OPINION_DEMOTE_RE = /\b(\d{1,3}\s*%\s*(approves?|supports?|behind|backs?|endorses?|agrees?|sure|certain|confident)|(fully|completely|wholeheartedly|absolutely)\s+(approves?|supports?|backs?|endorses?|agrees?)|approves?\s+of\s+\w|endorses?\s+(the\s+)?(idea|proposal|plan|move|call|approach|decision)|supports?\s+(the\s+)?(idea|proposal|plan|move|call|approach|view|direction)|backs?\s+(the\s+)?(idea|proposal|plan|move|call)|(likes?|loves?|favou?rs?)\s+(the\s+)?(idea|plan|approach|move)|(is|are|was|were)\s+(fully|totally|100\s*%)\s+(behind|for|supportive\s+of|in\s+favor)|(open|amenable|receptive)\s+to\s+(idea|proposal|change))\b/i;

// CB category: only keep high if there's a concrete action/decision word
const CB_ACTION_RE = /\b(cuts?\s+rates?|hikes?\s+rates?|raises?\s+rates?|lowers?\s+rates?|rate\s+(decision|hike|cut|hold|change|increase|decrease|unchanged)|(fomc|ecb|boe|boj|boc|rba|rbnz|snb)\s+(rate|decision|statement|minutes|votes?|decides?|holds?|cuts?|hikes?)|emergency\s+(meeting|rate|cut|decision)|(rate|policy)\s+(left\s+)?unchanged|(holds?|keeps?|maintains?)\s+(rates?|policy)\s+(steady|unchanged|at)|pauses?\s+(hiking|cutting|tightening|easing)|pivots?\s+(to|toward)|rate\s+(at|to)\s+[\d.]+|basis\s+points?\s+(cut|hike|raise|increase|decrease))\b/i;

function upgradeItemPriority(item) {
  const h = item.headline || '';

  // ── Flag _highImpact : donnée macro tier-1 RÉELLE (avec valeur/actual) ──────
  // Sert au rendu pour colorer en rouge les données High Impact (ex: PMI, CPI, NFP…)
  // Détection robuste : regex tier-1 OU champ impact explicite du flux (FF calendar)
  const impactField  = String(item.impact || item.importance || '').toLowerCase();
  const hasHighImpactField = impactField === 'high' || impactField === 'critical' || impactField === '3';
  const isHighImpactData = HIGH_IMPACT_RE.test(h) || hasHighImpactField;

  // Never touch urgent/breaking — those are source-confirmed (déjà rouges)
  if (item.urgent) return isHighImpactData ? { ...item, _highImpact: true } : item;

  // ── Smart demote: opinion/support/approval statements → not high priority ──
  if (item.priority === 'high' && OPINION_DEMOTE_RE.test(h)) {
    return { ...item, priority: 'normal', _highImpact: isHighImpactData };
  }

  // ── CB categories: demote if no concrete action language ──────────────────
  const isCB = /^(Fed|ECB|BoJ|BoE|BoC|RBA|SNB|RBNZ)$/.test(item.category || '');
  if (item.priority === 'high' && isCB && !CB_ACTION_RE.test(h) && !HIGH_IMPACT_RE.test(h)) {
    return { ...item, priority: 'normal', _highImpact: isHighImpactData };
  }

  // ── Upgrade: actual tier-1 data releases ─────────────────────────────────
  if (isHighImpactData) {
    return { ...item, priority: 'high', _highImpact: true };
  }

  return item;
}

// Purge noise from history on every server start
allNews = allNews.filter(i => {
  if (i._briefing || i.source === 'PMT') return true;          // garder les rapports internes
  if (isNoise(i.headline)) return false;
  if (isGlobalNewsNoise(i.headline)) return false;
  // Global News générique sans pertinence financière → purge
  if (i.category === 'Global News' && !isFinanciallyRelevant(i.headline + ' ' + (i.description || ''))) return false;
  return true;
}).map(upgradeItemPriority);

// ─── Dedup ───────────────────────────────────────────────────────────────────

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 55); }
function isDuplicate(item, list) { const n = norm(item.headline); return list.some(e => norm(e.headline) === n); }

// ─── Broadcast ───────────────────────────────────────────────────────────────

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
}

// ─── Merge helpers ───────────────────────────────────────────────────────────

function mergeItems(incoming) {
  // Curated sources bypass the keyword filter — they're already financial news
  const relevant = incoming.filter(item => {
    // Internal briefings always pass through
    if (item._briefing || item.source === 'PMT') return true;

    const fullText = item.headline + ' ' + (item.description || '');

    // Always drop regional sub-national noise and editorial reports
    if (isNoise(item.headline)) return false;
    // Drop tabloid / gossip / sports / lifestyle — même venant d'une source curated
    if (isGlobalNewsNoise(item.headline)) return false;
    // Drop FJElite bank research stubs — "Bank: Title - FJElite" with no description
    if (/- FJElite$/i.test(item.headline) && !item.description?.trim() && /^[^:]{3,40}:\s+\S/.test(item.headline)) return false;

    // "Global News" générique : n'est gardé QUE s'il est fondamentalement pertinent
    // (filtre les news vagues sans impact marché, même chez FinancialJuice)
    if (item.category === 'Global News' && !isFinanciallyRelevant(fullText)) return false;

    const curated = ['FinancialJuice','S&P Global','ISM','BLS','BEA','IFO Institute','ZEW',
                     'Destatis','Eurostat','ONS','ABS','Statistics Canada','Statistics Japan',
                     'NBS China','Statistics CH','NFIB','NAR / Census','Conference Board','CBOE']
                    .includes(item.source) || item.id?.startsWith('ff-news');
    const needsCheck = !curated;
    return !needsCheck || isFinanciallyRelevant(fullText);
  });
  // Enrich tags and upgrade priority for all incoming items
  const newItems = relevant
    .map(item => item._briefing ? item : { ...item, tags: extractTags(item.category, item.headline) })
    .map(upgradeItemPriority)
    .filter(item => !isDuplicate(item, allNews));
  if (newItems.length === 0) return 0;

  // Spam cap: max 8 data items per batch across all data categories
  const DATA_CATS_CAP = new Set(['Economic Commentary', 'EU Data', 'US Data', 'UK Data',
    'Swiss Data', 'Japanese Data', 'Canadian Data', 'Australian Data', 'Chinese Data']);
  const recentData = allNews.filter(
    i => DATA_CATS_CAP.has(i.category) && Date.now() - i.timestamp < 2 * 60_000
  ).length;
  let dataAllowed = Math.max(0, 8 - recentData);
  const capped = newItems.filter(i => {
    if (!DATA_CATS_CAP.has(i.category)) return true;
    if (dataAllowed > 0) { dataAllowed--; return true; }
    return false;
  });
  if (capped.length === 0) return 0;
  const cutoff = Date.now() - HISTORY_TTL;
  allNews = [...capped, ...allNews]
    .filter(i => i.timestamp > cutoff)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 1000);   // cap mémoire (512 Mo) : 1000 items suffisent largement pour le terminal
  saveHistory();
  return capped.length;
}

// ─── Main refresh loop — ForexFactory + FinancialJuice ───────────────────────

async function refreshNews() {
  console.log(`\n[${new Date().toLocaleTimeString()}] Refreshing news sources...`);

  const [fjItems, ffCalItems, ffNewsItems, rssItems] = await Promise.allSettled([
    scrapeFinancialJuice(),
    scrapeForexFactory(),
    scrapeForexFactoryNews(),
    fetchAllRSS(),
  ]).then(rs => rs.map(r => r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []));

  // Calendar events go to their own store — NOT mixed into the news feed
  if (ffCalItems.length > 0) allCalendar = ffCalItems;

  // Also inject HIGH-impact past calendar events (with actual values) into the news feed
  const calReleased = ffCalItems.filter(i =>
    i.description && i.description.includes('Actual:') &&
    i.timestamp < Date.now() &&
    i.priority === 'high'
  );

  // News feed: FJ + FF-News + high-impact released calendar events + RSS multi-sources
  const count = mergeItems([...fjItems, ...ffNewsItems, ...calReleased, ...rssItems]);
  console.log(`  [FJ:${fjItems.length} FF-Cal:${ffCalItems.length}→cal FF-News:${ffNewsItems.length} RSS:${rssItems.length}] +${count} new (total: ${allNews.length})`);

  if (count > 0 || isFirstLoad) {
    if (isFirstLoad) {
      isFirstLoad = false;
      broadcast({ type: 'initial', items: allNews.slice(0, 200), total: allNews.length });
    } else {
      broadcast({ type: 'news_update', items: allNews.slice(0, count), total: allNews.length });
    }
  }
}

// ─── WebSocket ───────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  console.log(`[WS] Client connected (${wss.clients.size})`);
  ws.send(JSON.stringify({ type: 'initial', items: allNews.slice(0, 200), total: allNews.length }));
  // Envoyer aussi les session wraps et bank research au moment de la connexion
  if (_swCache.length > 0) ws.send(JSON.stringify({ type: 'sw_update', items: _swCache }));
  if (_brCache.length > 0) ws.send(JSON.stringify({ type: 'br_update', items: _brCache }));

  ws.on('error', err => console.error('[WS]', err.message));
  ws.on('close', () => console.log(`[WS] Disconnected (${wss.clients.size} left)`));
});

// ─── Start ───────────────────────────────────────────────────────────────────


refreshNews();
setInterval(refreshNews, REFRESH_INTERVAL);

// ── Session wraps InvestingLive — refresh toutes les 20 min, broadcast si nouveaux ──
setInterval(async () => {
  try {
    const before = _swCache.length;
    await _fetchSessionWraps(false);
    if (_swCache.length !== before) {
      broadcast({ type: 'sw_update', items: _swCache });
      console.log(`[SW] ${_swCache.length - before > 0 ? '+' : ''}${_swCache.length - before} wraps → broadcast`);
    }
  } catch (e) { console.error('[SW poll]', e.message); }
}, 20 * 60 * 1000);

// ── Bank Research ING Think — refresh toutes les 10 min, broadcast dès qu'un NOUVEL article apparaît ──
setInterval(async () => {
  try {
    const beforeIds = new Set(_brCache.map(i => i.id));
    await _fetchBankResearch(false);
    // On détecte les nouveaux par ID (et pas par simple comptage : un article peut expirer
    // pendant qu'un autre arrive → même total mais contenu différent).
    const added = _brCache.filter(i => !beforeIds.has(i.id)).length;
    if (added > 0 || _brCache.length !== beforeIds.size) {
      broadcast({ type: 'br_update', items: _brCache });
      console.log(`[BR] ${added} nouvel(s) article(s) → broadcast`);
    }
  } catch (e) { console.error('[BR poll]', e.message); }
}, 10 * 60 * 1000);

// FinancialJuice — persistent WS connection (non-blocking)
// Push callback: broadcast instantly when a FJ item arrives (< 1s latency)
setOnPushCallback(item => {
  const count = mergeItems([item]);
  if (count > 0) {
    broadcast({ type: 'news_update', items: [item], total: allNews.length });
    console.log(`[FJ LIVE →] ${item.headline.substring(0, 65)}`);
  }
});
initFinancialJuice().catch(err => console.error('[FJ init]', err.message));

// Myfxbook Community Outlook — fetch at startup + refresh every 5 min
let _lastMyfxHash = '';
async function refreshMyfxbook() {
  try {
    const data = await fetchCommunityOutlook('H1');
    if (!data?.length) return;
    const hash = data.map(s => `${s.symbol}:${s.shortPct}`).join(',');
    if (hash === _lastMyfxHash) return;
    _lastMyfxHash = hash;
    broadcast({ type: 'community_outlook_update' });
    console.log(`[Myfxbook] Updated — ${data.length} symbols, broadcasting`);
  } catch {}
}
// Myfxbook lance un Chromium dédié. Désactivable pour économiser la RAM
// (notamment si les identifiants Myfxbook ne sont pas valides) : DISABLE_MYFXBOOK=true
if (process.env.DISABLE_MYFXBOOK === 'true') {
  console.log('[Myfxbook] désactivé (DISABLE_MYFXBOOK=true) — économie mémoire');
} else {
  setTimeout(refreshMyfxbook, 2000);        // immediate startup fetch
  setInterval(refreshMyfxbook, 5 * 60 * 1000); // then every 5 min
}

// ── Rappel abonnements : prévient l'admin (datatradingpro.contact) des comptes
//    qui expirent bientôt ou viennent d'expirer, AVANT le blocage (grâce 48h) ──
async function _checkExpiringSubscriptions() {
  try {
    const users = await auth.getAllUsers();
    const now   = Date.now();
    const soon  = now + 2 * 24 * 60 * 60 * 1000;   // expire dans ≤ 2 jours
    const grace = now - 48 * 60 * 60 * 1000;        // expiré mais < 48h (encore en grâce)
    const clients = users
      .filter(u => u.role === 'client' && u.active && u.expires_at)
      .filter(u => { const t = new Date(u.expires_at).getTime(); return t <= soon && t >= grace; })
      .map(u => ({ name: u.name, email: u.email, expiresAt: u.expires_at }));
    if (clients.length) {
      await mailer.sendAdminExpiryReminder({ clients });
      console.log(`[ExpiryCheck] Rappel admin envoyé pour ${clients.length} abonnement(s)`);
    }
  } catch (e) { console.error('[ExpiryCheck]', e.message); }
}
// Rappel quotidien DÉSACTIVÉ : Whop gère le renouvellement automatiquement.
// L'admin est notifié uniquement quand un renouvellement/paiement DTP a lieu (webhook).
// (fonction _checkExpiringSubscriptions conservée mais non planifiée)
void _checkExpiringSubscriptions;

// COT — check for new weekly data every 6 h, broadcast on change
let _lastCotHash = '';
setInterval(async () => {
  try {
    const TYPES = ['noncomm','dealer','asset_mgr','lev_money','other_rept'];
    for (const type of TYPES) {
      const data = await fetchCOTData(type);
      if (!data?.length) continue;
      const hash = `${type}:${data[0]?.reportDate}`;
      if (hash !== _lastCotHash) {
        _lastCotHash = hash;
        broadcast({ type: 'cot_update' });
        console.log(`[COT] New report detected (${data[0]?.reportDate}) — broadcasting`);
        break;
      }
    }
  } catch {}
}, 6 * 60 * 60 * 1000);

// ForexFactory News — fast poll every 20s, broadcasts instantly on new items
startFFNewsPoll(freshItems => {
  const count = mergeItems(freshItems);
  if (count > 0) {
    broadcast({ type: 'news_update', items: freshItems.slice(0, count), total: allNews.length });
  }
});

// ── FinancialJuice — polling accéléré (toutes les 20s) ───────────────────────
// Quand WS est actif : scrapeFinancialJuice() vide juste le buffer en mémoire (≈0 overhead)
// Quand WS est down  : lance le HTTP fallback → latence max 20s au lieu de 60s
setInterval(async () => {
  try {
    const fjItems = await scrapeFinancialJuice();
    if (fjItems.length === 0) return;
    const count = mergeItems(fjItems);
    if (count > 0) {
      broadcast({ type: 'news_update', items: fjItems.slice(0, count), total: allNews.length });
      console.log(`[FJ fast-poll] +${count} news diffusées`);
    }
  } catch {}
}, 20_000);

// One-time 7-day historical backfill — runs 20 s after startup to let auth settle
setTimeout(async () => {
  try {
    const items = await backfillHistoricalNews(7);
    if (items.length === 0) return;
    const count = mergeItems(items);
    console.log(`[Backfill] +${count} historical items merged (total: ${allNews.length})`);
    if (count > 0) {
      broadcast({ type: 'initial', items: allNews.slice(0, 200), total: allNews.length });
    }
  } catch (e) {
    console.error('[Backfill] error:', e.message);
  }
}, 20_000);

// ─── Yahoo Finance session (crumb + cookie) ──────────────────────────────────
// Yahoo Finance v8 now requires a valid crumb for chart API calls.
// We fetch it once per hour and reuse across all YF requests.
let _yfSession = null;
let _yfSessionTs = 0;
const YF_SESSION_TTL = 50 * 60 * 1000; // 50 min

const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function getYFSession() {
  if (_yfSession && Date.now() - _yfSessionTs < YF_SESSION_TTL) return _yfSession;
  try {
    // Step 1: get cookie from finance.yahoo.com
    const r1 = await axios.get('https://finance.yahoo.com/', {
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 10000, validateStatus: () => true, maxRedirects: 5,
    });
    const rawCookies = r1.headers['set-cookie'] || [];
    const cookie = rawCookies.map(c => c.split(';')[0]).join('; ');

    // Step 2: get crumb
    const r2 = await axios.get('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YF_UA, 'Cookie': cookie },
      timeout: 8000, validateStatus: () => true,
    });
    if (r2.status === 200 && typeof r2.data === 'string' && r2.data.length > 0) {
      _yfSession = { cookie, crumb: r2.data };
      _yfSessionTs = Date.now();
      console.log('[YF] session crumb acquired');
      return _yfSession;
    }
  } catch (e) {
    console.warn('[YF] crumb fetch failed:', e.message);
  }
  // Fallback: no crumb — still works for some endpoints
  _yfSession = { cookie: '', crumb: '' };
  _yfSessionTs = Date.now();
  return _yfSession;
}

function yfUrl(sym, interval, range) {
  const base = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}&includePrePost=false`;
  return _yfSession?.crumb ? `${base}&crumb=${encodeURIComponent(_yfSession.crumb)}` : base;
}

function yfHeaders() {
  return {
    'User-Agent': YF_UA,
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com/',
    ...(_yfSession?.cookie ? { 'Cookie': _yfSession.cookie } : {}),
  };
}

// ─── Currency Strength ───────────────────────────────────────────────────────
// 28 pairs: each of the 8 currencies appears exactly 7 times
const CS_CURRENCIES = ['USD','EUR','JPY','GBP','AUD','CHF','CAD','NZD'];
const CS_PAIRS = [
  { sym:'EURUSD=X',b:'EUR',q:'USD'}, { sym:'GBPUSD=X',b:'GBP',q:'USD'},
  { sym:'USDJPY=X',b:'USD',q:'JPY'}, { sym:'USDCHF=X',b:'USD',q:'CHF'},
  { sym:'AUDUSD=X',b:'AUD',q:'USD'}, { sym:'NZDUSD=X',b:'NZD',q:'USD'},
  { sym:'USDCAD=X',b:'USD',q:'CAD'}, { sym:'EURGBP=X',b:'EUR',q:'GBP'},
  { sym:'EURJPY=X',b:'EUR',q:'JPY'}, { sym:'EURCHF=X',b:'EUR',q:'CHF'},
  { sym:'EURAUD=X',b:'EUR',q:'AUD'}, { sym:'EURCAD=X',b:'EUR',q:'CAD'},
  { sym:'EURNZD=X',b:'EUR',q:'NZD'}, { sym:'GBPJPY=X',b:'GBP',q:'JPY'},
  { sym:'GBPCHF=X',b:'GBP',q:'CHF'}, { sym:'GBPAUD=X',b:'GBP',q:'AUD'},
  { sym:'GBPCAD=X',b:'GBP',q:'CAD'}, { sym:'GBPNZD=X',b:'GBP',q:'NZD'},
  { sym:'AUDJPY=X',b:'AUD',q:'JPY'}, { sym:'NZDJPY=X',b:'NZD',q:'JPY'},
  { sym:'CADJPY=X',b:'CAD',q:'JPY'}, { sym:'CHFJPY=X',b:'CHF',q:'JPY'},
  { sym:'AUDNZD=X',b:'AUD',q:'NZD'}, { sym:'AUDCAD=X',b:'AUD',q:'CAD'},
  { sym:'AUDCHF=X',b:'AUD',q:'CHF'}, { sym:'NZDCAD=X',b:'NZD',q:'CAD'},
  { sym:'NZDCHF=X',b:'NZD',q:'CHF'}, { sym:'CADCHF=X',b:'CAD',q:'CHF'},
];
const _csCache = {};

// clip = max allowed % deviation from period open (filters bad Yahoo Finance ticks)
// cutoffToday: true = reference price anchored at midnight UTC (real FX trading day start)
const CS_PERIOD_CFG = {
  today: { interval: '5m',  range: '1d',  cutoffMs: null,          cutoffToday: true, clip:  5  },
  week:  { interval: '1h',  range: '5d',  cutoffMs: null,                             clip: 10  },
  '8h':  { interval: '5m',  range: '1d',  cutoffMs:  8 * 3600000,                    clip:  3  },
  '1d':  { interval: '30m', range: '5d',  cutoffMs: 24 * 3600000,                    clip:  5  },
  '5d':  { interval: '1h',  range: '5d',  cutoffMs: null,                             clip: 10  },
  '7d':  { interval: '1d',  range: '1mo', cutoffMs:  7 * 86400000,                   clip: 15  },
  '1m':  { interval: '1d',  range: '1mo', cutoffMs: null,                             clip: 20  },
};

// Retry-enabled Yahoo Finance fetcher — retries once (800 ms delay) before giving up
async function yfFetch(sym, interval, range) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const url = yfUrl(sym, interval, range);
      const r = await axios.get(url, { headers: yfHeaders(), timeout: 9000, validateStatus: () => true });
      if (r.status === 200) return r.data;
      if (attempt === 0) await new Promise(ok => setTimeout(ok, 800));
    } catch {
      if (attempt === 0) await new Promise(ok => setTimeout(ok, 800));
    }
  }
  return null;
}

async function computeCurrencyStrength(period) {
  const cfg = CS_PERIOD_CFG[period] || CS_PERIOD_CFG.today;
  const ttl = 2 * 60 * 1000;
  if (_csCache[period] && Date.now() - _csCache[period].ts < ttl) return _csCache[period].data;

  const { interval, range, cutoffMs, cutoffToday, clip } = cfg;

  // "today" anchors the reference at midnight UTC — the professional FX day start
  let cutoffSec = null;
  if (cutoffToday) {
    const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
    cutoffSec = Math.floor(midnight.getTime() / 1000);
  } else if (cutoffMs) {
    cutoffSec = Math.floor((Date.now() - cutoffMs) / 1000);
  }

  await getYFSession();

  const pairResults = await Promise.all(CS_PAIRS.map(async p => {
    try {
      const raw = await yfFetch(p.sym, interval, range);
      const res = raw?.chart?.result?.[0];
      if (!res) return null;
      let ts = [...(res.timestamp || [])];
      let cl = [...(res.indicators?.quote?.[0]?.close || [])];

      if (cutoffSec) {
        const zipped = ts.map((t, i) => [t, cl[i]]).filter(([t]) => t != null && t >= cutoffSec);
        ts = zipped.map(([t]) => t);
        cl = zipped.map(([, c]) => c);
      }

      if (ts.length < 2) return null;
      return { ...p, ts, cl };
    } catch { return null; }
  }));

  const pairData = pairResults.filter(Boolean);
  const failCount = CS_PAIRS.length - pairData.length;
  if (failCount > 0) console.warn(`[CS/${period}] ${failCount}/${CS_PAIRS.length} pairs failed to load`);
  if (pairData.length < 7) { console.error(`[CS/${period}] only ${pairData.length} pairs — aborting`); return null; }
  console.log(`[CS/${period}] ${pairData.length}/28 pairs loaded — cutoff=${cutoffSec ? new Date(cutoffSec*1000).toISOString() : 'none'} clip=±${clip}%`);

  // Round timestamps to candle interval — aligns all 28 pairs to the same bins
  // (Yahoo Finance returns slightly different timestamps per pair, e.g. 09:30:00 vs 09:30:07)
  const INTERVAL_SEC = { '5m': 300, '30m': 1800, '1h': 3600, '1d': 86400 };
  const binSec = INTERVAL_SEC[interval] || 300;

  const tsSet = new Set();
  pairData.forEach(p => p.ts.forEach(t => {
    if (t) tsSet.add(Math.round(t / binSec) * binSec);
  }));
  const allTs = [...tsSet].sort((a, b) => a - b);

  // Build pairMaps with binned timestamps (last value wins per bin)
  const pairMaps = pairData.map(p => {
    const m = new Map();
    p.ts.forEach((t, i) => {
      if (t && p.cl[i] != null) m.set(Math.round(t / binSec) * binSec, p.cl[i]);
    });
    return m;
  });

  // ── Reference-based strength (period open → now) ─────────────────────────
  // Each point = avg % change of the currency vs ALL its pairs since the first
  // candle of the period.  This is the professional standard: values are actual
  // percentage moves, no accumulation drift, no open-gap spikes.
  const MIN_PAIRS = 4;
  const series    = Object.fromEntries(CS_CURRENCIES.map(c => [c, []]));

  // Reference price for each pair = first valid close in the period window
  const refClose = pairData.map((_, i) => {
    for (const ts of allTs) {
      const c = pairMaps[i].get(ts);
      if (c != null) return c;
    }
    return null;
  });

  for (const t of allTs) {
    const scores = Object.fromEntries(CS_CURRENCIES.map(c => [c, 0]));
    const cnt    = Object.fromEntries(CS_CURRENCIES.map(c => [c, 0]));

    pairData.forEach((p, i) => {
      const close = pairMaps[i].get(t);
      const ref   = refClose[i];
      if (close == null || ref == null || ref === 0) return;
      const pct     = (close / ref - 1) * 100;
      const clipped = Math.max(-clip, Math.min(clip, pct));
      scores[p.b] += clipped; cnt[p.b]++;
      scores[p.q] -= clipped; cnt[p.q]++;
    });

    CS_CURRENCIES.forEach(c => {
      // Carry forward last value when not enough pairs report for this candle
      const prev = series[c].length > 0 ? series[c][series[c].length - 1].v : 0;
      const v    = cnt[c] >= MIN_PAIRS
        ? +(scores[c] / cnt[c]).toFixed(4)
        : prev;
      series[c].push({ t: t * 1000, v });
    });
  }

  const data = { currencies: CS_CURRENCIES, series, updatedAt: new Date().toISOString() };
  _csCache[period] = { ts: Date.now(), data };
  return data;
}

app.get('/api/currency-strength', async (req, res) => {
  const validPeriods = Object.keys(CS_PERIOD_CFG);
  const period = validPeriods.includes(req.query.period) ? req.query.period : 'today';
  if (req.query.force === '1') delete _csCache[period]; // manual cache-bust
  try {
    const data = await computeCurrencyStrength(period);
    if (!data) return res.status(503).json({ error: 'Data unavailable' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Risk Sentiment ───────────────────────────────────────────────────────────
//
// Each asset has:
//   dir  : +1 = risk-on when rising  |  -1 = risk-off when rising
//   norm : typical absolute daily % move — used to normalize contributions so
//          high-volatility assets (VIX ~4%) don't drown out low-vol ones (SPY ~0.9%)
//
const RISK_ASSETS = [
  { sym: 'SPY',      label: 'S&P 500',            dir:  1, norm: 0.9, wt: 1.5 },  // primary risk barometer
  { sym: '^VIX',     label: 'VIX (Volatilité)',    dir: -1, norm: 4.0, wt: 1.2 },  // high vol = fear
  { sym: 'GLD',      label: 'Or (Sécurité)',       dir: -1, norm: 0.7, wt: 0.9 },  // safe-haven buy = risk-off
  { sym: 'TLT',      label: 'Obligations US',      dir: -1, norm: 0.7, wt: 0.8 },  // bond rally = risk-off
  { sym: 'AUDUSD=X', label: 'AUD/USD (Risqué)',    dir:  1, norm: 0.4, wt: 1.0 },  // risk FX = risk-on
  { sym: 'QQQ',      label: 'Nasdaq (Tech/Risk)',  dir:  1, norm: 1.2, wt: 1.0 },  // tech = high-beta risk
];
let _riskData = null, _riskTs = 0;

async function fetchRiskSentiment() {
  if (_riskData && Date.now() - _riskTs < 3 * 60 * 1000) return _riskData;
  await getYFSession();

  const results = (await Promise.all(RISK_ASSETS.map(async a => {
    try {
      const url = yfUrl(a.sym, '1d', '5d');
      const r = await axios.get(url, { headers: yfHeaders(), timeout: 7000, validateStatus: () => true });
      if (r.status !== 200) return null;
      const res = r.data?.chart?.result?.[0];
      if (!res) return null;
      const cl = (res.indicators?.quote?.[0]?.close || []).filter(v => v != null);
      if (cl.length < 2) return null;
      const prev = cl[cl.length - 2], curr = cl[cl.length - 1];
      const chg = prev ? +((curr - prev) / prev * 100).toFixed(2) : 0;
      return { label: a.label, chg, dir: a.dir, norm: a.norm, wt: a.wt };
    } catch { return null; }
  }))).filter(Boolean);

  if (!results.length) return null;

  // Weighted, volatility-normalized score
  // Each asset's contribution = clip(chg / norm, -1, +1) * dir * weight
  // This prevents high-vol assets (VIX) from dominating low-vol ones (SPY/FX)
  const totalWt = results.reduce((s, r) => s + r.wt, 0);
  const score = results.reduce((s, r) => {
    const normalized = Math.max(-1, Math.min(1, r.chg / r.norm));
    return s + normalized * r.dir * r.wt;
  }, 0) / totalWt;

  const label = score > 0.55  ? 'STRONG RISK-ON'
    : score > 0.30  ? 'RISK-ON'
    : score > 0.07  ? 'WEAK RISK-ON'
    : score > -0.07 ? 'NEUTRAL'
    : score > -0.30 ? 'WEAK RISK-OFF'
    : score > -0.80 ? 'RISK-OFF'
    : 'STRONG RISK-OFF';

  const DESCS = {
    'STRONG RISK-ON':  'Fort appétit pour le risque sur l\'ensemble des marchés. Actions, devises risquées et actifs à haut rendement tous achetés. VIX bas.',
    'RISK-ON':         'Appétit pour le risque positif. Les actions et devises risquées sont demandées, les valeurs refuges sous légère pression.',
    'WEAK RISK-ON':    'Légère amélioration de l\'appétit au risque. Les flux retournent vers les actions et les devises risquées. Les valeurs refuges s\'affaiblissent, VIX en baisse.',
    'NEUTRAL':         'Le sentiment de marché est équilibré. Signaux mixtes sur les actifs risqués, pas de tendance directionnelle claire.',
    'WEAK RISK-OFF':   'Légère aversion au risque. Prudence ambiante — obligations et valeurs refuges trouvent un support modéré.',
    'RISK-OFF':        'Aversion au risque en hausse. Les capitaux se déplacent vers les valeurs refuges, les obligations et les devises défensives.',
    'STRONG RISK-OFF': 'Forte aversion au risque. Fuite significative vers la sécurité — obligations, or, JPY et CHF demandés.',
  };

  _riskData = { label, score: +score.toFixed(2), description: DESCS[label], assets: results, updatedAt: new Date().toISOString() };
  _riskTs = Date.now();
  return _riskData;
}

app.get('/api/risk-sentiment', async (req, res) => {
  try {
    const data = await fetchRiskSentiment();
    if (!data) return res.status(503).json({ error: 'Data unavailable' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Market Moves — real observed price reactions after a news event ──────────
// Thresholds = minimum ABSOLUTE move AND minimum % move required in the 15-min window.
// Both must be exceeded to qualify as a "real strong reaction".
// These are intentionally strict — routine volatility must NOT trigger a Réaction tag.
const MOVE_ASSETS = [
  { sym: 'BZ=F',      label: 'Brent crude',   unit: '$/bbl', decimals: 2, threshold: 0.70,   minPct: 0.80  },
  { sym: 'GC=F',      label: 'Or (XAU/USD)',  unit: '$/oz',  decimals: 1, threshold: 7.0,    minPct: 0.40  },
  { sym: 'DX-Y.NYB', label: 'DXY',            unit: 'pts',   decimals: 3, threshold: 0.25,   minPct: 0.22  },
  { sym: 'EURUSD=X', label: 'EUR/USD',         unit: '',      decimals: 5, threshold: 0.0020, minPct: 0.17  },
  { sym: 'QQQ',       label: 'Nasdaq (QQQ)',   unit: 'USD',   decimals: 2, threshold: 1.20,   minPct: 0.28  },
  { sym: 'SPY',       label: 'S&P 500 (SPY)',  unit: 'USD',   decimals: 2, threshold: 0.90,   minPct: 0.17  },
];
const _moveCache = new Map();

app.get('/api/market-moves', async (req, res) => {
  const since = parseInt(req.query.since);
  if (!since || isNaN(since)) return res.status(400).json({ error: 'since param required (Unix ms)' });

  // Yahoo Finance 1m data only goes back ~5 days reliably
  const AGE_LIMIT_MS = 5 * 24 * 60 * 60 * 1000;
  if (Date.now() - since > AGE_LIMIT_MS) return res.json({ moves: [], reason: 'too_old' });

  // Cache key = nearest minute
  const cacheKey = Math.floor(since / 60000).toString();
  if (_moveCache.has(cacheKey)) return res.json(_moveCache.get(cacheKey));

  await getYFSession();

  const sinceSec  = Math.floor(since / 1000);
  const windowSec = 15 * 60; // look at the 15 minutes following the event

  const moves = (await Promise.all(MOVE_ASSETS.map(async asset => {
    try {
      const url = yfUrl(asset.sym, '1m', '5d');
      const r = await axios.get(url, { headers: yfHeaders(), timeout: 10000, validateStatus: () => true });
      if (r.status !== 200) return null;
      const result = r.data?.chart?.result?.[0];
      if (!result) return null;

      const timestamps = result.timestamp || [];
      const closes     = result.indicators?.quote?.[0]?.close || [];

      // Find the first candle at or after sinceTime
      let refIdx = -1;
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] >= sinceSec && closes[i] != null) { refIdx = i; break; }
      }
      if (refIdx === -1) return null;

      const refPrice = closes[refIdx];
      if (!refPrice) return null;

      // Scan the next 15 minutes for the maximum absolute move
      let bestMove = 0;
      let bestIdx  = refIdx;
      const endSec = sinceSec + windowSec;
      for (let i = refIdx + 1; i < timestamps.length; i++) {
        if (timestamps[i] > endSec) break;
        const c = closes[i];
        if (c == null) continue;
        const move = Math.abs(c - refPrice);
        if (move > bestMove) { bestMove = move; bestIdx = i; }
      }

      const peakPrice  = closes[bestIdx];
      const rawMove    = peakPrice - refPrice;
      const movePct    = (rawMove / refPrice) * 100;
      // Require BOTH absolute threshold AND minimum % — filters out routine noise
      if (Math.abs(rawMove) < asset.threshold) return null;
      if (Math.abs(movePct) < asset.minPct)    return null;
      const minutes   = Math.max(1, Math.round((timestamps[bestIdx] - timestamps[refIdx]) / 60));

      return {
        label:     asset.label,
        sym:       asset.sym,
        refPrice:  +refPrice.toFixed(asset.decimals),
        peakPrice: +peakPrice.toFixed(asset.decimals),
        move:      (rawMove >= 0 ? '+' : '') + rawMove.toFixed(asset.decimals),
        movePct:   (movePct  >= 0 ? '+' : '') + movePct.toFixed(2) + '%',
        dir:       rawMove >= 0 ? 'up' : 'down',
        unit:      asset.unit,
        minutes,
      };
    } catch { return null; }
  }))).filter(Boolean);

  const result = { moves, ts: since };
  _moveCache.set(cacheKey, result);
  if (_moveCache.size > 300) _moveCache.delete(_moveCache.keys().next().value);
  res.json(result);
});

server.listen(PORT, async () => {
  // Seed admin user on first run
  await auth.seedAdmin();

  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║   DataTradingPro — Prime Terminal       ║`);
  console.log(`║   http://localhost:${PORT}                  ║`);
  console.log(`║   Admin panel : /admin                  ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
  _swLoadFile();
  _fetchSessionWraps(true).catch(() => {});
  _brLoadFile();
  _fetchBankResearch(true).catch(() => {});
});

// ─── Graceful shutdown (Railway/Render envoient SIGTERM avant de tuer le process) ─
function gracefulShutdown(signal) {
  console.log(`[Shutdown] ${signal} reçu — fermeture propre…`);

  // 1. Fermer toutes les connexions WebSocket proprement
  wss.clients.forEach(ws => {
    try { ws.close(1001, 'Server shutting down'); } catch {}
  });

  // 2. Arrêter d'accepter de nouvelles connexions HTTP
  server.close(() => {
    console.log('[Shutdown] Serveur HTTP fermé. À bientôt !');
    process.exit(0);
  });

  // 3. Forcer la sortie après 10s si des requêtes traînent
  setTimeout(() => {
    console.error('[Shutdown] Forçage exit après 10s');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));  // Ctrl+C en local
